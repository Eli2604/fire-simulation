import { MATERIALS } from './materials.js';
import { F_BURNING, F_SMOLDER, F_LIQUID } from './world.js';
import { doorGlassBroken, doorDeltaP } from './doors.js';
import { describeSmithy } from './smithy.js';
import { describeBoat, describeCar, describePerson } from './inspectVehicles.js';

/**
 * What the inspector says about a thing clicked that is more than a voxel (render/pick.js hands
 * it as `hit.thing`): drawn by meshes of its own, over hidden voxels or with none at all, and
 * simulated as a whole elsewhere:
 *
 *   churchPart  a beam, the boards of a level, a pew, the altar, a stained-glass window
 *               (render/church.js): how much of it is left, charred, hot, burning; the glass
 *               intact, cracked or broken
 *   torch       a wall torch or candle (world.heaters): lit or out, its power, the oxygen at
 *               the flame, its head and handle (hidden voxels round it)
 *   door        world.doors (sim/doors.js): open / shut, locked (and its key), what it is made
 *               of, how much of it is left, charred, hot; glass broken; pressure across it
 *   generator   the camp's wind turbine or solar park (sim/power.js): state, wind at the hub,
 *               rotor speed, yaw, output; its grid
 *   grid        a camp on a grid: what it makes and takes, the battery, ops and lights
 *   carrier     the ship (sim/water.js stepBuoyancy, sim/buoyancy.js): draft, list, trim,
 *               water aboard and coming in, GM, foundering
 *   smithy      a smith's forge (sim/smithy.js): the fire's charcoal voxels, the bellows' air, the
 *               sword he works (its voxels: point and base), the slack tub's water and steam
 *               (its heat, hardness and temper), the slack tub, the shop
 *   volcano     world.volcanoes (sim/volcano.js): asleep / erupting / spent, how long, the
 *               lava in the crater and how hot it is
 *   vessel      world.vessels[k] (sim/vessels.js): a gas cylinder (a fuel tank): its pressure,
 *               liquid and wall temperatures, fill, relief valve, jet flame, and why it did or
 *               did not burst (burst: at what pressure, its energy, the fireball, the blast)
 *   boat        world.floats[index] (sim/boats.js, sim/inspectVehicles.js): afloat / aground /
 *               swamped / sunk, draft, freeboard, heel, trim, water aboard and coming in, holes,
 *               speed, moored or adrift, who is aboard, the outboard, the sail or the oars
 *   car         world.cars[index] (sim/cars.js): powertrain, speed, gear, rpm, fuel or charge,
 *               the pack, the engine, damage, fire, the ground under it, who is in it
 *   person      someone seated in a boat or a car ({ vehicle, index, seat }): who, health...
 *   (boat and car: k, the voxel of their moving body clicked, sim/movingBody.js; their
 *   description's voxelRows say what it is, read from its copy in the grid or from the body)
 *
 * describeThing(sim, thing) -> { title, sub, rows: [string], voxelRows? } or null (gone). Plain data in,
 * text out: tested without a view.
 */
export function describeThing(sim, thing) {
  const w = sim?.world;
  if (!w || !thing) return null;
  switch (thing.kind) {
    case 'churchPart':
      return churchPart(w, thing);
    case 'torch':
      return torch(w, thing.heater);
    case 'door':
      return door(w, thing.k);
    case 'generator':
      return generator(w, thing);
    case 'grid':
      return grid(w, thing.grid);
    case 'carrier':
      return carrier(sim);
    case 'smithy':
      return describeSmithy(w.smithies?.[thing.index]);
    case 'volcano':
      return volcano(w, thing.index);
    case 'vessel':
      return vessel(w, thing.k);
    case 'boat':
      return describeBoat(sim, thing.index, thing.k ?? -1, thing.cell ?? -1);
    case 'car':
      return describeCar(sim, thing.index, thing.k ?? -1, thing.cell ?? -1);
    case 'person':
      return describePerson(sim, thing);
    default:
      return null;
  }
}

// ------------------------------------------------------------------ helpers

const C = (t) => `${t.toFixed(0)} °C`;
const pct = (f) => `${(f * 100).toFixed(0)} %`;
export function fmtWatts(W) {
  const a = Math.abs(W);
  if (a >= 1e6) return `${(W / 1e6).toFixed(2)} MW`;
  if (a >= 1e3) return `${(W / 1e3).toFixed(1)} kW`;
  return `${W.toFixed(0)} W`;
}

/**
 * A set of voxels summed: how many are still there (of n0), their material(s), mean char,
 * mean and hottest temperature (core or skin), burning / smouldering / molten counts.
 */
export function voxelSummary(w, list, ok = (i) => w.mat[i]) {
  let left = 0;
  let ch = 0;
  let sumT = 0;
  let maxT = -Infinity;
  let burning = 0;
  let smoulder = 0;
  let molten = 0;
  let fuel = 0;
  let fuelN = 0;
  const mats = {};
  for (const i of list ?? []) {
    if (!ok(i)) continue;
    left++;
    ch += w.char[i];
    const T = Math.max(w.temp[i], w.skin[i]);
    sumT += w.temp[i];
    if (T > maxT) maxT = T;
    const f = w.flags[i];
    if (f & F_BURNING) burning++;
    else if (f & F_SMOLDER) smoulder++;
    if (f & F_LIQUID) molten++;
    const M = MATERIALS[w.mat[i]];
    if (M?.combustible) {
      fuel += w.fuel[i];
      fuelN++;
    }
    const lab = M?.label ?? '?';
    mats[lab] = (mats[lab] ?? 0) + 1;
  }
  const material = Object.entries(mats).sort((a, b) => b[1] - a[1]).map(([m]) => m);
  return { left, char: left ? ch / left : 0, meanT: left ? sumT / left : null, maxT: left ? maxT : null, burning, smoulder, molten, fuel: fuelN ? fuel / fuelN : null, material };
}

function burnState(s) {
  if (!s.left) return 'gone';
  if (s.burning) return `burning (${s.burning} voxel${s.burning > 1 ? 's' : ''})`;
  if (s.smoulder) return 'smouldering';
  if (s.char > 0.6) return 'charred';
  if (s.char > 0.1) return 'scorched';
  return 'sound';
}

function summaryRows(s, n0) {
  return [
    s.material.length ? `Material: ${s.material.slice(0, 2).join(', ')}` : '',
    n0 ? `Left: ${pct(Math.min(1, s.left / n0))} of ${n0} voxels` : `Voxels: ${s.left}`,
    s.left ? `Temperature: ${C(s.meanT)} mean, ${C(s.maxT)} hottest` : '',
    s.left ? `State: ${burnState(s)}` : '',
    s.char > 0.01 ? `Charred: ${pct(s.char)}` : '',
    s.fuel !== null && s.left ? `Fuel left: ${pct(s.fuel)}` : '',
  ].filter(Boolean);
}

/** Voxels of a sphere (sim frame) that `ok` accepts. */
function voxelsNear(w, p, r, ok) {
  const out = [];
  const h = w.h;
  for (let z = Math.floor((p[2] - r) / h); z <= Math.floor((p[2] + r) / h); z++)
    for (let y = Math.floor((p[1] - r) / h); y <= Math.floor((p[1] + r) / h); y++)
      for (let x = Math.floor((p[0] - r) / h); x <= Math.floor((p[0] + r) / h); x++) {
        if (!w.inBounds(x, y, z)) continue;
        const dx = (x + 0.5) * h - p[0];
        const dy = (y + 0.5) * h - p[1];
        const dz = (z + 0.5) * h - p[2];
        if (dx * dx + dy * dy + dz * dz > r * r) continue;
        const i = w.idx(x, y, z);
        if (ok(i)) out.push(i);
      }
  return out;
}

function airAt(w, p) {
  const ax = Math.floor(p[0] / w.ah);
  const ay = Math.floor(p[1] / w.ah);
  const az = Math.floor(p[2] / w.ah);
  if (ax < 0 || ay < 0 || az < 0 || ax >= w.anx || ay >= w.any || az >= w.anz) return -1;
  return w.airIdx(ax, ay, az);
}

// ------------------------------------------------------------------ the church

/** A part's name as people say it ('pew1-1' -> 'Pew', 'window3' -> 'Stained-glass window'...). */
export function churchPartLabel(name, glass) {
  if (glass) return /^rose/.test(name) ? 'Rose window' : 'Stained-glass window';
  if (/^pew/.test(name)) return 'Pew';
  if (name === 'altar') return 'Altar';
  if (name === 'partition') return 'Timber partition';
  if (name === 'crane') return 'Builders’ crane';
  if (/^struss/.test(name) || name === 'sridge') return 'Roof truss (south arm)';
  if (name === 'scenter') return 'Vault centering';
  if (name === 'tspire') return 'Spire frame';
  if (/^tlevel/.test(name)) return 'Tower timber floor';
  if (/^window/.test(name)) return 'Window armature';
  if (/^rose/.test(name)) return 'Rose window armature';
  return 'Scaffolding';
}

function churchPart(w, t) {
  const s = voxelSummary(w, t.voxels);
  const title = churchPartLabel(t.name, t.glass);
  if (t.glass) {
    const broken = t.n0 - s.left;
    const hot = s.maxT ?? 0;
    const glassState = !s.left ? 'gone' : broken > t.n0 * 0.5 ? 'broken out' : broken > 0 ? `cracked (${broken} of ${t.n0} pieces gone)` : hot > 150 ? 'intact, hot (it may crack)' : 'intact';
    return { title, sub: 'Church', rows: [`Glass: ${glassState}`, s.left ? `Temperature: ${C(s.meanT)} mean, ${C(s.maxT)} hottest` : '', s.molten ? `Molten: ${s.molten} voxels` : ''].filter(Boolean) };
  }
  const rows = summaryRows(s, t.n0);
  if (t.gone || s.left < t.n0 * 0.5) rows.push('Mostly burnt away: what is left shows as voxels');
  return { title, sub: 'Church', rows };
}

// ------------------------------------------------------------------ torches and candles

function torch(w, ht) {
  if (!ht || !w.heaters.includes(ht)) return { title: 'Torch', sub: 'gone', rows: ['Burnt out or taken away'] };
  const candle = ht.kind === 'candle';
  const a = airAt(w, [ht.pos[0], ht.pos[1] + 0.2, ht.pos[2]]);
  const o2 = a >= 0 ? w.o2[a] : null;
  const airT = a >= 0 ? w.airT[a] : null;
  // its head and handle: the hidden voxels round the flame's base
  const own = voxelsNear(w, ht.pos, candle ? Math.max(0.05, (ht.candle?.height ?? 0.1) + 0.02) : 0.55, (i) => w.mat[i] && MATERIALS[w.mat[i]]?.combustible);
  const s = voxelSummary(w, own);
  let state;
  if (!ht.on || ht.power <= 0) state = 'out';
  else if (o2 !== null && o2 < 0.135) state = 'smothered: too little oxygen';
  else if (o2 !== null && o2 < 0.18) state = 'lit, guttering (oxygen low)';
  else state = 'lit';
  const rows = [
    `Flame: ${state}`,
    ht.on && ht.power > 0 ? `Heat output: ${fmtWatts(ht.power)}` : '',
    o2 !== null ? `Oxygen at the flame: ${(o2 * 100).toFixed(1)} % (air 23.2 %)` : '',
    airT !== null ? `Air at the flame: ${C(airT)}` : '',
    ht.patchLive ? 'Seen close up: its head burns in detail' : '',
    s.left ? `${candle ? 'Wax' : 'Head and handle'}: ${s.material.join(', ')}, ${C(s.meanT)} mean, ${C(s.maxT)} hottest, ${burnState(s)}` : '',
    s.fuel !== null && s.left ? `Fuel left: ${pct(s.fuel)}` : '',
  ].filter(Boolean);
  return { title: candle ? 'Candle' : 'Wall torch', sub: ht.label ?? (candle ? 'candle' : 'torch'), rows };
}

// ------------------------------------------------------------------ doors

function door(w, k) {
  const d = w.doors?.[k];
  if (!d) return null;
  // shut: its voxels in the grid (those still tagged); open: those sim/doors.js keeps aside
  let s;
  if (d.open && d.saved) {
    const fake = { mat: [], temp: [], skin: [], char: [], flags: [], fuel: [] };
    d.saved.forEach((st, j) => {
      fake.mat[j] = st.mat;
      fake.temp[j] = st.temp;
      fake.skin[j] = st.skin;
      fake.char[j] = st.char;
      fake.flags[j] = st.flags;
      fake.fuel[j] = st.fuel;
    });
    s = voxelSummary(fake, d.saved.map((_, j) => j));
  } else s = voxelSummary(w, d.voxels, (i) => w.mat[i] && w.doorTag[i] === k + 1);
  const n0 = d.voxels.length;
  const kind = d.bars ? 'Barred gate' : d.glass?.length ? 'Glazed door' : 'Door';
  const lock = d.locked ? `locked${d.key ? ` (key: ${d.key})` : ''}` : 'unlocked';
  const dp = doorDeltaP(w, d);
  const rows = [
    `State: ${d.open ? 'open' : 'shut'}, ${lock}${d.equalize ? ', equalising the pressure' : ''}`,
    ...summaryRows(s, n0),
    d.glass?.length ? `Glass panel: ${doorGlassBroken(w, k) ? 'broken' : d.open ? 'intact (open)' : 'intact'}` : '',
    dp > 0.005 ? `Pressure across it: ${(dp * 101.3).toFixed(1)} kPa` : '',
  ].filter(Boolean);
  const damage = n0 ? 1 - s.left / n0 : 0;
  if (damage > 0.01) rows.splice(1, 0, `Damage: ${pct(damage)} burnt or broken away${damage > 0.25 && !d.open ? ' (no longer a door: what is left shows as voxels)' : ''}`);
  return { title: d.name ? `${kind}: ${d.name}` : kind, sub: 'Door', rows };
}

// ------------------------------------------------------------------ the camp's power

function generator(w, t) {
  const g = (w.generators ?? []).find((q) => q.kind === t.gen && (t.owner === undefined || q.owner === t.owner));
  if (!g) return null;
  const rows = [];
  if (g.kind === 'wind') {
    const rpm = ((g.omega ?? 0) * 60) / (2 * Math.PI);
    const STATE = { running: 'running', idle: 'idling (below cut-in)', cutOut: 'cut out: the wind is too strong, feathered and braked', broken: 'broken: the nacelle is gone' };
    rows.push(`State: ${STATE[g.state] ?? g.state ?? 'starting'}`);
    if (g.wind != null) rows.push(`Wind at the hub: ${g.wind.toFixed(1)} m/s (cut-in ${g.cutIn}, rated ${g.ratedWind}, cut-out ${g.cutOut})`);
    rows.push(`Rotor: ${rpm.toFixed(1)} rpm${g.R ? `, tip ${((g.omega ?? 0) * g.R).toFixed(0)} m/s` : ''}`);
    rows.push(`Output: ${fmtWatts(g.output ?? 0)}${g.rated ? ` of ${fmtWatts(g.rated)} rated (${pct((g.output ?? 0) / g.rated)})` : ''}`);
    if (g.yaw != null) rows.push(`Facing: ${(((-g.yaw * 180) / Math.PI + 360) % 360).toFixed(0)}° (yawing into the wind)`);
  } else {
    rows.push(`State: ${g.state ?? 'starting'}`);
    rows.push(`Output: ${fmtWatts(g.output ?? 0)}`);
    if (g.panelChecks) rows.push(`Panels: ${g.alive ?? g.panelChecks.length} of ${g.panelChecks.length} in place`);
    if (g.battery) rows.push(`Battery: ${g.batteryLost ? 'lost with its container' : `${g.battery} kWh`}`);
  }
  const G = w.power?.[g.grid ?? 'camp'];
  if (G) rows.push(gridLine(G));
  return { title: g.kind === 'wind' ? 'Wind turbine' : 'Solar park', sub: `grid: ${g.grid ?? 'camp'}`, rows };
}

function gridLine(G) {
  return `Grid: makes ${fmtWatts(G.gen)}, needs ${fmtWatts(G.demand)}${G.capacity > 0 ? `, battery ${pct(G.soc / G.capacity)}` : ''}${G.short ? ' – SHORT of power' : ''}`;
}

function grid(w, name) {
  const G = w.power?.[name];
  const rows = G
    ? [gridLine(G), `Wind ${fmtWatts(G.wind)}, solar ${fmtWatts(G.solar)}`, `Operations: ${G.ops ? 'on' : 'OFF'}`, `Lights: ${G.lights ? (G.night ? 'on' : 'off (day)') : 'OFF (no power)'}`]
    : ['No power worked out yet'];
  return { title: 'Drone camp', sub: `grid: ${name}`, rows };
}

// ------------------------------------------------------------------ the carrier

function carrier(sim) {
  const w = sim.world;
  const S = w.sea?.ship;
  const rows = [];
  if (!S) return { title: 'Aircraft carrier', sub: 'hull (drawn only)', rows: ['Not afloat in this scene'] };
  if (S.draft != null) rows.push(`Draft: ${S.draft.toFixed(2)} m${S.draft0 != null ? ` (${S.draft - S.draft0 >= 0 ? '+' : ''}${((S.draft - S.draft0) * 100).toFixed(0)} cm from at rest)` : ''}`);
  if (S.heelDeg != null) rows.push(`List: ${Math.abs(S.heelDeg).toFixed(2)}° ${S.heelDeg >= 0 ? 'to starboard' : 'to port'}`);
  if (S.trimDeg != null) rows.push(`Trim: ${Math.abs(S.trimDeg).toFixed(2)}° ${S.trimDeg >= 0 ? 'by the bow' : 'by the stern'}`);
  rows.push(`Water aboard: ${((S.water ?? 0) / 1000).toFixed(1)} t`);
  const fl = sim.stats?.flooding;
  rows.push(`Sea coming in: ${fl ? `${((fl * w.h ** 3) / (sim.dt || 1)).toFixed(2)} m³/s` : 'no'}`);
  if (S.GM != null) rows.push(`Metacentric height GM: ${S.GM.toFixed(2)} m`);
  if (S.displacement) rows.push(`Displacement: ${Math.round(S.displacement / 1000).toLocaleString('en')} t`);
  rows.push(S.foundering ? 'FOUNDERING: the sea is over the deck edge' : 'Afloat');
  return { title: 'Aircraft carrier', sub: 'hull', rows };
}

// ------------------------------------------------------------------ the volcano

/** The crater's lava: voxels in and over the vent, how many molten, the hottest. */
export function craterLava(w, v) {
  const r = Math.max(1, (v.craterRadius ?? 2) * 1.5);
  const h = w.h;
  const y0 = Math.max(0, Math.floor((v.crater[1] - 2) / h));
  const y1 = Math.min(w.ny - 1, Math.floor(((v.rim ?? v.crater[1]) + 3) / h));
  let n = 0;
  let molten = 0;
  let maxT = -Infinity;
  let sumT = 0;
  for (let z = Math.floor((v.crater[2] - r) / h); z <= Math.floor((v.crater[2] + r) / h); z++)
    for (let x = Math.floor((v.crater[0] - r) / h); x <= Math.floor((v.crater[0] + r) / h); x++) {
      if (Math.hypot((x + 0.5) * h - v.crater[0], (z + 0.5) * h - v.crater[2]) > r) continue;
      for (let y = y0; y <= y1; y++) {
        if (!w.inBounds(x, y, z)) continue;
        const i = w.idx(x, y, z);
        if (!w.mat[i]) continue;
        const T = w.temp[i];
        // (lava: the rock of the vent that is hot, or molten)
        if (T < 600 && !(w.flags[i] & F_LIQUID)) continue;
        n++;
        sumT += T;
        if (T > maxT) maxT = T;
        if (w.flags[i] & F_LIQUID) molten++;
      }
    }
  return { n, molten, maxT: n ? maxT : null, meanT: n ? sumT / n : null };
}

function volcano(w, index) {
  const v = w.volcanoes?.[index];
  if (!v) return null;
  const rows = [];
  if (v.state === 'dormant') rows.push(`State: dormant (wakes when a dragon passes within ${v.trigger?.toFixed?.(0) ?? '?'} m of the crater)`);
  else if (v.state === 'erupting') rows.push(`State: ERUPTING for ${v.t.toFixed(0)} s, ${Math.max(0, v.duration - v.t).toFixed(0)} s to go`);
  else rows.push(`State: ${v.state === 'spent' ? 'calmed down after its eruption' : v.state}`);
  const L = craterLava(w, v);
  rows.push(L.n ? `Lava in the crater: ${L.n} voxels hot, ${L.molten} molten; ${C(L.meanT)} mean, ${C(L.maxT)} hottest` : 'Lava in the crater: none (cold rock)');
  if (v.lavaRate && v.state === 'erupting') rows.push(`Lava welling up: ${v.lavaRate} m³/s`);
  if (v.column?.on) rows.push(`Ash column over the crater: ${fmtWatts(v.column.power)}`);
  rows.push(`Crater: vent radius ${(v.craterRadius ?? 0).toFixed(1)} m, rim at ${(v.rim ?? 0).toFixed(1)} m`);
  return { title: 'Volcano', sub: 'basalt cone', rows };
}

// ------------------------------------------------------------------ pressure vessels

const VESSEL_STATE = { sealed: 'sealed', holed: 'holed: a burning jet from the hole', leaking: 'leaking (shell failed)', ruptured: 'BURST', empty: 'empty' };
const bar = (p) => `${(p / 1e5).toFixed(1)} bar`;

/** A gas cylinder (or a fuel tank): its state, and why it did or did not burst. */
function vessel(w, k) {
  const v = w.vessels?.[k];
  if (!v) return null;
  const title = v.lumped ? 'Gas cylinder' : v.name === 'fuel' ? 'Fuel tank' : 'Pressure vessel';
  const rows = [`State: ${v.venting ? 'relief valve venting' : VESSEL_STATE[v.state] ?? v.state}`];
  if (v.why) rows.push(`Why: ${v.why}`);
  if (!v.lumped) {
    if (v.pressure != null) rows.push(`Pressure: ${bar(v.pressure)}${v.strength != null ? ` (holds ${bar(v.strength)})` : ''}`);
    return { title, sub: 'pressure vessel', rows };
  }
  if (v.state !== 'ruptured') {
    rows.push(`Pressure: ${bar(v.pressure ?? 0)} (gauge)${v.strength != null ? `; the wall holds ${bar(v.strength)} now (${pct(v.strengthFactor ?? 1)} of its cold ${bar(v.burstPressure)})` : ''}`);
    if (v.Tl != null) rows.push(`Liquid: ${C(v.Tl)}, ${(v.mass ?? 0).toFixed(1)} of ${(v.mass0 ?? 0).toFixed(1)} kg, fills ${pct(v.fill ?? 0)} of the cylinder${v.hydraulic ? ' – LIQUID-FULL' : ''}`);
    if (v.Tv != null) rows.push(`Wall: ${C(v.Tv)} above the liquid (dry), ${C(v.Tw)} where the liquid wets it`);
    if (v.phiDry != null) rows.push(`Heat on the wall: ${(v.phiDry / 1000).toFixed(0)} kW/m² (dry part), ${(v.phiWet / 1000).toFixed(0)} kW/m² (wetted)`);
  }
  rows.push(`Relief valve: ${v.ventPressure == null ? 'BLOCKED' : `working, opens at ${bar(v.ventPressure)}, ${v.prvOpen ? 'OPEN' : 'closed'}${v.prvOpened != null ? ` (first opened at ${v.prvOpened.toFixed(0)} s)` : ''}`}`);
  rows.push(`Cylinder valve: ${v.drawRate > 0 ? 'open, the gas burning at it' : 'closed'}`);
  if (v.jetPower > 0) rows.push(`Jet flame: ${fmtWatts(v.jetPower)}, ~${(v.jetLength ?? 0).toFixed(1)} m (${((v.mdot ?? 0) * 1000).toFixed(0)} g/s)`);
  if (v.vented > 0) rows.push(`Burnt off so far: ${v.vented.toFixed(1)} kg`);
  if (v.state === 'ruptured') {
    rows.push(`Burst at ${(v.burstAt ?? 0).toFixed(0)} s, ${bar(v.burstPressure0 ?? 0)}: ${((v.burstEnergy ?? 0) / 1e6).toFixed(2)} MJ (~${((v.burstEnergy ?? 0) / 4.6e6).toFixed(2)} kg TNT), ${pct(v.flash ?? 0)} of the liquid flashed`);
    if (v.fireball) rows.push(`Fireball: ${(v.fireballMass ?? 0).toFixed(1)} kg, ${v.fireball.diameter.toFixed(1)} m across, ${v.fireball.duration.toFixed(1)} s`);
    if (v.overpressure) rows.push(`Blast: ${v.overpressure.map((o) => `${o.kPa.toFixed(0)} kPa at ${o.r} m`).join(', ')}; fragments ~${(v.fragmentSpeed ?? 0).toFixed(0)} m/s`);
  }
  return { title, sub: v.fluid?.label ?? v.gas ?? 'gas', rows };
}
