/**
 * A smith at work (models/smithy.js): the forge fire, the blade he makes, the slack tub and
 * the finished weapons, kept on their own (the blade is far thinner than the voxels; the
 * forge's fuel bed is a lump of glowing charcoal). Drawn by render/smithy.js.
 *
 * THE FORGE. Charcoal burns as fast as oxygen reaches it: C + O2 -> CO2 (32.8 MJ per kg of
 * carbon, 2.67 kg of O2 per kg). The air comes up through the tuyere: a little by the
 * chimney's draught alone (~2.5 g/s), far more while the bellows blow (each stroke ~12 g of
 * air, up to ~15 g/s). Below ~350 °C the bed hardly burns at all (the reaction is too slow),
 * it is fully alight from ~650 °C. The bed's heat balance:
 *
 *    C_bed dT/dt = burn·32.8 MJ − ṁ_air·c_p·(T − T_air)  (the gas going up the flue)
 *                              − ε σ A (T⁴ − T_air⁴)     (radiation from its open top)
 *                              − what the blade in it takes
 *
 * With the draught alone it settles at ~900 °C, too cool to bring steel to forging heat; on
 * the bellows it climbs to 1200–1400 °C (the oxygen supply sets the burn rate, the burn rate
 * the temperature). What the bed loses goes into the room's air as the forge heater's power
 * (up the hood and the flue), with a little smoke; the oxygen it takes comes from there too.
 *
 * THE BLADE: one lump of steel (mass m, surface A, c_p rising with temperature). In the fire
 * it takes radiation and the hot blast; in the air it loses radiation and convection; on the
 * anvil also what the cold anvil and hammer conduct away; in the water the boiling: a vapour
 * blanket while it is above ~450 °C (h ~2.5 kW/m²K, the blade moved about), then nucleate boiling (h ~12 kW/m²K),
 * then plain convection under 100 °C. The heat goes into the trough's water (its voxels warm),
 * part of it while the steel is over 100 °C boils water off: steam into the air over the tub.
 *
 * HARDNESS. Steel above ~780 °C is austenite. How fast it then cools through 800 → 500 °C
 * (t8/5) decides what it becomes: cooled in a few seconds (quenched in water) it is martensite,
 * hard (~64 HRC) and brittle; cooled in the air over tens of seconds it is soft pearlite
 * (~18 HRC). The martensite fraction here: f = 1 / (1 + (t8/5 / 4 s)⁴). Tempering (reheating
 * to 200–330 °C, watched by the temper colours: straw, bronze, purple, blue) trades some of the
 * hardness for toughness: HRC = 18 + 47 f − 0.09 f (T_temper − 150).
 *
 * THE SMITH works in a cycle: a blank into the fire, the bellows until it is at forging heat
 * (~1050 °C, yellow-orange), out with the tongs to the anvil and hammer it (each blow shapes it
 * the more the hotter it is; it cools under the hammer) until it is below working heat (~760 °C,
 * dull cherry: steel worked colder cracks), then back into the fire. Shaped, he heats it once
 * more to ~830 °C (cherry) and quenches it in the slack tub; then he tempers it over the edge of
 * the fire to its temper colour, grinds the edge on the grindstone and takes it into the shop:
 * onto the rack, the pegs or the counter. The shop holds 14; past that the oldest is sold.
 * Coal runs low: he fetches more from the bin.
 *
 * The bellows can be worked by anyone standing at the lever (E in the walk-through:
 * useSmithy()).
 */
import { O2_AIR } from './world.js';
import { MAT } from './materials.js';

const SIGMA = 5.670374e-8;
const K = 273.15;
const CP_AIR = 1150; // J/(kg·K), hot air / flue gas
const H_C = 32.8e6; // J/kg, charcoal (carbon) to CO2
const O2_PER_C = 2.667; // kg O2 per kg C
const LV = 2.257e6; // J/kg, water
const CW = 4186;

export const FORGE = {
  draught: 0.0025, // kg/s of air through the tuyere by the chimney's draught alone
  stroke: 0.012, // kg of air per stroke of the bellows
  blastMax: 0.015, // kg/s the bellows can blow through the tuyere
  area: 0.04, // m² of glowing bed radiating out (the open top of the fire pot)
  eps: 0.9,
  cBase: 1500, // J/K: the glowing heart of the bed and the fire pot's hot face
  cCoal: 300, // J/K per kg of charcoal in the forge (most of it lies round the heart, warming slowly)
  ignite: 350, // °C: below this the bed hardly burns
  full: 650, // °C: fully alight
};

export const HEATS = {
  forging: 1050, // °C: forging heat (yellow-orange)
  working: 760, // °C: below this he stops hammering (dull cherry)
  hardening: 830, // °C: heated to this to quench (cherry, just above the steel's Ac3)
  austenite: 780, // °C: above this the steel is austenite (hardenable)
  pumpForge: 1300, // he keeps the bed at least this hot while he forges
  pumpHarden: 950,
};

/** What he makes, in turn. heats: how many heats it takes to shape at full forging heat. */
export const WEAPONS = [
  { kind: 'sword', label: 'sword', mass: 1.1, area: 0.09, heats: 4, temper: 290 },
  { kind: 'axe', label: 'axe', mass: 0.9, area: 0.05, heats: 3, temper: 250 },
  { kind: 'spear', label: 'spear', mass: 0.4, area: 0.03, heats: 2, temper: 270 },
  { kind: 'dagger', label: 'dagger', mass: 0.35, area: 0.035, heats: 2, temper: 240 },
];

const WALK = 1.2; // m/s
const BLOW = 0.65; // s between hammer blows
const STROKE = 1.1; // s a stroke of the bellows
const SHOP_SLOTS = 14;

/** Specific heat of steel (J/(kg·K)), rising with temperature (a mean over the magnetic peak). */
export const steelCp = (T) => Math.min(760, 450 + 0.3 * Math.max(0, T));

/** Martensite fraction from the time (s) it took to cool from 800 to 500 °C. */
export const martensite = (t85) => 1 / (1 + (Math.max(0, t85) / 4) ** 4);

/** Rockwell C hardness of a blade from its martensite fraction and the temper it had. */
export function hardnessOf(b) {
  const f = b.martensite ?? 0;
  const tempered = Math.max(0, (b.temperMax ?? 0) - 150);
  return 18 + 47 * f - 0.09 * f * tempered;
}

/** The temper colour a steel surface shows after being at T °C. */
export function temperColour(T) {
  if (T < 200) return 'bright';
  if (T < 240) return 'straw';
  if (T < 265) return 'bronze';
  if (T < 285) return 'purple';
  if (T < 310) return 'blue';
  if (T < 340) return 'grey-blue';
  return 'grey';
}

/** The glow colour a smith reads off hot steel. */
export function heatColour(T) {
  if (T < 480) return 'black';
  if (T < 580) return 'faint red';
  if (T < 680) return 'blood red';
  if (T < 780) return 'dull cherry';
  if (T < 880) return 'cherry';
  if (T < 980) return 'orange';
  if (T < 1100) return 'yellow-orange';
  if (T < 1250) return 'yellow';
  return 'white';
}

/** A smithy record (built by models/smithy.js) placed in the world: its points in world coordinates. */
export function placeSmithy(s, toWorld, rot, owner, Ta = 20) {
  const st = {};
  for (const [k, v] of Object.entries(s.stations)) st[k] = Object.fromEntries(Object.entries(v).map(([n, q]) => [n, toWorld(...q)]));
  const tmin = toWorld(...s.trough.min);
  const tmax = toWorld(...s.trough.max);
  const S = {
    owner,
    heading: rot,
    fire: toWorld(...s.fire),
    stations: st,
    waypoints: Object.fromEntries(Object.entries(s.waypoints).map(([k, q]) => [k, toWorld(...q)])),
    bellowsBox: toWorld(...s.bellowsBox.p),
    trough: { min: tmin.map((v, k) => Math.min(v, tmax[k])), max: tmin.map((v, k) => Math.max(v, tmax[k])) },
    slots: s.rackSlots.map((r) => ({ ...r, p: toWorld(...r.p) })),
    init: { coal: s.coal, fireTemp: s.fireTemp, smith: s.smith, weapons: s.weapons, pace: s.pace, skill: s.skill },
  };
  return initSmithy(S, Ta);
}

/** The state of a smithy at the start (forge, smith, shop). */
export function initSmithy(S, Ta = 20) {
  const I = S.init ?? {};
  S.forge = { T: Math.max(Ta, I.fireTemp ?? 700), coal: I.coal ?? 8, blast: 0, air: 0, burn: 0, power: 0, toBlade: 0, strokes: 0 };
  S.weapons = [];
  S.made = 0;
  S.sold = 0;
  S.time = 0;
  S.sparks = 0;
  for (let k = 0; k < (I.weapons ?? 0); k++) shelve(S, { kind: WEAPONS[k % WEAPONS.length].kind, hardness: 55 + (k % 3), temper: WEAPONS[k % WEAPONS.length].temper, made: -1 });
  const st = S.stations;
  S.pace = I.pace ?? 1;
  S.skill = I.skill ?? 0.5;
  S.smith = I.smith === false ? null : { p: st.forge.p.slice(), yaw: yawTo(st.forge.p, st.forge.face), state: 'start', t: 0, path: null, then: null, pose: 'stand', phase: 0, blows: 0 };
  S.blade = null;
  S.water = { voxels: null, T: Ta, steam: 0, heat: 0 };
  S.ready = true;
  return S;
}

function yawTo(a, b) {
  return Math.atan2(b[0] - a[0], b[2] - a[2]);
}

function shelve(S, wpn) {
  const used = new Set(S.weapons.map((x) => x.slot));
  let slot = -1;
  for (let k = 0; k < S.slots.length && k < SHOP_SLOTS; k++)
    if (!used.has(k)) {
      slot = k;
      break;
    }
  if (slot < 0) {
    // full: the oldest has been sold
    const old = S.weapons.shift();
    S.sold++;
    slot = old.slot;
  }
  S.weapons.push({ ...wpn, slot });
}

/** A new blade blank of the next kind. */
function newBlade(S, Ta) {
  const W = WEAPONS[S.made % WEAPONS.length];
  return { kind: W.kind, label: W.label, m: W.mass, A: W.area, heats: W.heats, temperTarget: W.temper, T: Ta, Tmax: Ta, progress: 0, heat: 0, stage: 'forge', place: 'stock', aus: false, t800: null, martensite: 0, temperMax: 0, quenched: false, cooledFrom: 0 };
}

// ------------------------------------------------------------------ physics

/** Air through the tuyere this instant (kg/s), and the blast store's use over dt. */
function airFlow(F, dt) {
  // (the stroke's air leaves the bellows over ~0.6 s, as fast as the tuyere lets it)
  const rate = Math.min(FORGE.blastMax, F.blast / 0.6);
  const used = Math.min(F.blast, rate * dt);
  F.blast -= used;
  return FORGE.draught + used / Math.max(dt, 1e-9);
}

/** Heat (W) into a blade at T from the fuel bed at Tb (in the fire). */
function fireToBlade(b, Tb) {
  const inFire = 0.4; // the share of it in the fire
  const r = 0.85 * SIGMA * b.A * ((Tb + K) ** 4 - (b.T + K) ** 4);
  return inFire * (r + 80 * b.A * (Tb - b.T));
}

/** Heat (W) a blade at T loses to air at Ta (radiation and convection), more on the anvil. */
function airLoss(b, Ta, anvil = false) {
  const r = 0.8 * SIGMA * b.A * ((b.T + K) ** 4 - (Ta + K) ** 4);
  const c = 10 * b.A * (b.T - Ta);
  return r + c + (anvil ? 40 * b.A * (b.T - Ta) : 0);
}

/** Boiling heat-transfer coefficient (W/m²K) of a blade at T in water. */
export function quenchH(T) {
  if (T > 450) return 2500; // vapour blanket (film boiling; the smith works the blade about to break it up)
  if (T > 100) return 12000; // nucleate boiling
  return 1500;
}

/**
 * Advance a smithy by dt (s). env: { Ta (air at the forge and the shop), o2 (oxygen mass
 * fraction at the tuyere's intake), waterT, addWaterHeat(J), addSteam(kg, p), event(e), time }.
 */
export function advanceSmithy(S, dt, env) {
  if (!S.ready) initSmithy(S, env.Ta);
  const n = Math.max(1, Math.ceil(dt / 0.05));
  const h = dt / n;
  for (let k = 0; k < n; k++) {
    S.time += h;
    stepForge(S, h, env);
    stepBlade(S, h, env);
    if (S.smith) stepSmith(S, h, env);
  }
}

function stepForge(S, dt, env) {
  const F = S.forge;
  const Ta = env.Ta;
  const mAir = airFlow(F, dt);
  const y = Math.max(0, env.o2 ?? O2_AIR);
  const kin = Math.min(1, Math.max(0, (F.T - FORGE.ignite) / (FORGE.full - FORGE.ignite)));
  const burn = F.coal > 0 ? ((mAir * y) / O2_PER_C) * kin : 0;
  const P = burn * H_C;
  const gas = mAir * CP_AIR * Math.max(0, F.T - Ta);
  const rad = FORGE.eps * SIGMA * FORGE.area * ((F.T + K) ** 4 - (Ta + K) ** 4);
  const b = S.blade;
  const toBlade = b && b.place === 'fire' ? fireToBlade(b, F.T) : 0;
  const C = FORGE.cBase + F.coal * FORGE.cCoal;
  F.T += ((P - gas - rad - toBlade) * dt) / C;
  if (F.T < Ta) F.T = Ta;
  F.coal = Math.max(0, F.coal - burn * dt);
  F.air = mAir;
  F.burn = burn;
  F.combustion = P;
  F.toBlade = toBlade;
  // what goes into the room's air (up the hood): the hot gas and what it radiates
  F.power = Math.max(0, gas + rad);
}

function stepBlade(S, dt, env) {
  const b = S.blade;
  if (!b) return;
  const Ta = env.Ta;
  const T0 = b.T;
  let q = 0; // W into the blade
  if (b.place === 'fire') q = S.forge.toBlade;
  else if (b.place === 'temper') {
    // over the edge of the fire, out of the blast: warm gas and the bed's glow
    q = 60 * b.A * (450 - b.T);
  } else if (b.place === 'water') {
    const Tw = env.waterT;
    const out = quenchH(b.T) * b.A * (b.T - Tw);
    q = -out;
    // part of it boils water off while the steel is over 100 °C, the rest warms the trough
    const boil = b.T > 100 ? 0.12 * out : 0;
    env.addWaterHeat?.((out - boil) * dt);
    if (boil > 0) {
      const kg = (boil * dt) / (LV + CW * Math.max(0, 100 - Tw));
      S.water.steam += kg;
      env.addSteam?.(kg);
    }
    S.water.heat += out * dt;
  } else if (b.place !== 'rack') q = -airLoss(b, Ta, b.place === 'anvil');
  const C = b.m * steelCp(b.T);
  b.T += (q * dt) / C;
  if (b.T > b.Tmax) b.Tmax = b.T;
  // the steel's structure: austenite above 780 °C; how fast it then cools through 800 -> 500
  if (b.T >= HEATS.austenite) {
    b.aus = true;
    b.temperMax = 0;
  }
  if (b.aus && T0 >= 800 && b.T < 800) b.t800 = S.time;
  if (b.aus && b.t800 != null && T0 >= 500 && b.T < 500) {
    b.t85 = S.time - b.t800;
    b.martensite = martensite(b.t85);
    b.aus = false;
    b.t800 = null;
    b.armed = false;
  }
  // tempering: how hot the hardened steel has been since it was cold (its temper colour)
  if (!b.aus && b.martensite > 0) {
    if (b.T < 150) b.armed = true;
    if (b.armed && b.T > b.temperMax) b.temperMax = b.T;
  }
  b.hardness = hardnessOf(b);
}

// ------------------------------------------------------------------ the smith

function go(S, where, then) {
  const sm = S.smith;
  const st = S.stations[where];
  const target = st.p;
  const inShop = (p) => side(S, p) > 0;
  const path = [];
  // through the partition doorway when going between the rooms
  if (inShop(sm.p) !== inShop(target)) {
    const W = S.waypoints;
    if (inShop(sm.p)) path.push(W.shop, S.stations.door.p, W.workshop);
    else path.push(W.workshop, S.stations.door.p, W.shop);
  }
  path.push(target);
  sm.path = path.map((q) => q.slice());
  sm.dest = where;
  sm.then = then;
  sm.state = 'walk';
  sm.t = 0;
}

/** Which side of the partition (>0: the shop), along the line forge -> shop door. */
function side(S, p) {
  const a = S.stations.door.p;
  const f = S.stations.forge.p;
  const dx = a[0] - f[0];
  const dz = a[2] - f[2];
  return (p[0] - a[0]) * dx + (p[2] - a[2]) * dz;
}

function face(S, where) {
  const sm = S.smith;
  const st = S.stations[where];
  sm.yaw = yawTo(st.p, st.face ?? st.p);
}

function setState(sm, state) {
  sm.state = state;
  sm.t = 0;
}

function stepSmith(S, dt, env) {
  const sm = S.smith;
  const F = S.forge;
  const ev = (type, extra = {}) => env.event?.({ type, time: env.time ?? S.time, ...extra });
  sm.t += dt * (S.pace ?? 1); // (his work pace: the scene's setting, models/smithy.js)
  const b = S.blade;
  switch (sm.state) {
    case 'start': {
      S.blade = newBlade(S, env.Ta);
      S.blade.place = 'tongs';
      go(S, 'forge', 'load');
      break;
    }
    case 'walk': {
      sm.pose = 'walk';
      let left = WALK * dt;
      while (left > 0 && sm.path.length) {
        const q = sm.path[0];
        const dx = q[0] - sm.p[0];
        const dz = q[2] - sm.p[2];
        const d = Math.hypot(dx, dz);
        if (d < 1e-6) {
          sm.path.shift();
          continue;
        }
        sm.yaw = Math.atan2(dx, dz);
        const s = Math.min(d, left);
        sm.p[0] += (dx / d) * s;
        sm.p[2] += (dz / d) * s;
        sm.p[1] = q[1];
        left -= s;
        if (s >= d) sm.path.shift();
      }
      sm.phase += dt * 1.8;
      if (!sm.path.length) {
        face(S, sm.dest);
        setState(sm, sm.then);
      }
      break;
    }
    case 'load': {
      // the blank (or the blade) into the fire with the tongs
      sm.pose = 'tongs';
      // shaped and still hot enough to harden: let it come down to cherry red, then quench it
      if (b?.stage === 'harden' && b.T >= HEATS.hardening) {
        b.place = 'tongs';
        if (b.T <= HEATS.hardening + 50) go(S, 'trough', 'quench');
        break;
      }
      if (sm.t > 1.2) {
        if (b) b.place = 'fire';
        go(S, 'bellows', 'heat');
      }
      break;
    }
    case 'heat': {
      // at the bellows lever until it is hot enough (fetching charcoal when the bed is low)
      if (F.coal < 2) {
        go(S, 'coal', 'stoke');
        break;
      }
      const want = b?.stage === 'harden' ? HEATS.hardening : HEATS.forging;
      const keep = b?.stage === 'harden' ? HEATS.pumpHarden : HEATS.pumpForge;
      if (b && b.T >= want) {
        go(S, 'forge', 'take');
        break;
      }
      // pump while the bed is cooler than it should be (or the blast is spent)
      const pumping = F.T < keep || F.blast < FORGE.stroke * 0.5;
      sm.pose = pumping ? 'pump' : 'stand';
      if (pumping) {
        const prev = sm.phase;
        sm.phase += dt / STROKE;
        if (Math.floor(sm.phase) > Math.floor(prev)) {
          pumpBellows(S, 1);
          ev('bellows', { pos: S.bellowsBox.slice(), quiet: true });
        }
      }
      break;
    }
    case 'stoke': {
      sm.pose = 'tongs';
      if (sm.t > 2) {
        F.coal += 4;
        ev('stoke', { pos: S.fire.slice(), quiet: true });
        go(S, 'bellows', 'heat');
      }
      break;
    }
    case 'take': {
      sm.pose = 'tongs';
      if (sm.t > 0.8) {
        b.place = 'tongs';
        if (b.stage === 'harden') go(S, 'trough', 'quench');
        else go(S, 'anvil', 'hammer');
      }
      break;
    }
    case 'hammer': {
      sm.pose = 'hammer';
      b.place = 'anvil';
      const prev = sm.phase;
      sm.phase += (dt * (S.pace ?? 1)) / BLOW;
      if (Math.floor(sm.phase) > Math.floor(prev)) {
        // a blow: the hotter the steel, the more it moves
        const soft = Math.min(1.25, Math.max(0.05, (b.T - 650) / (HEATS.forging - 650)));
        // (a skilled smith moves more steel a blow: models/smithy.js smithSkill, 0.5 as he always was)
        b.progress = Math.min(1, b.progress + (soft / (b.heats * 12)) * (0.5 + (S.skill ?? 0.5)));
        sm.blows++;
        const top = S.stations.anvil.top;
        ev('impact', { pos: top.slice(), materials: ['steel', 'steel'], energy: 60, mass: 1.5, speed: 6, radius: 0.02, size: 0.4, sizeA: 0.3, name: 'anvil', kind: 'hammer', quiet: true });
        // scale flying off the hot steel: sparks (more, the hotter it is)
        if (b.T > 700) S.sparks += 1;
        ev('anvilBlow', { pos: top.slice(), T: b.T, quiet: true });
      }
      if (b.progress >= 1 || b.T < HEATS.working) {
        if (b.progress >= 1) b.stage = 'harden';
        b.heat++;
        b.place = 'tongs';
        go(S, 'forge', 'load');
      }
      break;
    }
    case 'quench': {
      sm.pose = 'quench';
      if (b.place !== 'water') {
        b.place = 'water';
        b.quenchFrom = b.T;
        ev('quench', { pos: S.stations.trough.water.slice(), T: b.T, name: `the ${b.label}`, quiet: false });
      }
      if (b.T < 60) {
        b.quenched = true;
        b.place = 'tongs';
        b.asQuenched = b.hardness;
        ev('quenched', { pos: S.stations.trough.water.slice(), name: `the ${b.label}`, hardness: b.hardness, quiet: true });
        go(S, 'forge', 'temper');
      }
      break;
    }
    case 'temper': {
      // held over the edge of the fire until it shows its temper colour
      sm.pose = 'tongs';
      b.place = 'temper';
      if (b.T >= b.temperTarget) {
        b.place = 'tongs';
        go(S, 'grinder', 'grind');
      }
      break;
    }
    case 'grind': {
      sm.pose = 'grind';
      b.place = 'grind';
      const prev = sm.phase;
      sm.phase += dt / 0.4;
      if (Math.floor(sm.phase) > Math.floor(prev)) ev('grind', { pos: S.stations.grinder.wheel.slice(), quiet: true });
      if (sm.t > 10) {
        b.place = 'tongs';
        go(S, 'rack', 'shelve');
      }
      break;
    }
    case 'shelve': {
      sm.pose = 'tongs';
      if (sm.t > 1.5) {
        shelve(S, { kind: b.kind, hardness: b.hardness, temper: b.temperMax, made: S.time });
        S.made++;
        ev('weaponDone', { pos: S.stations.rack.face.slice(), name: `a ${b.label}`, hardness: b.hardness, quiet: false });
        S.blade = null;
        setState(sm, 'start');
      }
      break;
    }
  }
}

/** Strokes of the bellows: air into the blast store (it blows through the tuyere over the next seconds). */
export function pumpBellows(S, strokes = 1) {
  if (!S.ready) return;
  S.forge.blast = Math.min(S.forge.blast + FORGE.stroke * strokes, FORGE.stroke * 6);
  S.forge.strokes += strokes;
  S.lastPump = S.time;
}

// ------------------------------------------------------------------ in the world

/** The trough's water voxels (found once, then while they are there). */
function troughWater(w, S) {
  if (S.water.voxels) return S.water.voxels.filter((i) => w.mat[i] === MAT.water);
  const out = [];
  const h = w.h;
  const { min, max } = S.trough;
  for (let x = Math.floor(min[0] / h); x <= Math.floor(max[0] / h); x++)
    for (let y = Math.floor(min[1] / h); y <= Math.floor(max[1] / h); y++)
      for (let z = Math.floor(min[2] / h); z <= Math.floor(max[2] / h); z++) {
        if (!w.inBounds(x, y, z)) continue;
        const i = w.idx(x, y, z);
        if (w.mat[i] === MAT.water) out.push(i);
      }
  S.water.voxels = out;
  return out;
}

/** Step every smithy of the world (sim/simulation.js). */
export function stepSmithies(sim, dt) {
  const w = sim.world;
  if (!w.smithies?.length || dt <= 0) return;
  for (const S of w.smithies) {
    if (!S.heater) S.heater = w.heaters.find((ht) => ht.forge && ht.owner === S.owner) ?? null;
    const a = sim.airCellAt(S.fire[0], S.fire[1] - w.h, S.fire[2]);
    const room = sim.airCellAt(S.stations.forge.p[0], S.stations.forge.p[1] + 1.2, S.stations.forge.p[2]);
    const Ta = room >= 0 ? w.airT[room] : w.ambient;
    const water = troughWater(w, S);
    const mW = water.length * w.h ** 3 * 1000;
    let Tw = Ta;
    if (water.length) {
      Tw = 0;
      for (const i of water) Tw += w.temp[i];
      Tw /= water.length;
    }
    S.water.T = Tw;
    S.water.mass = mW;
    const steamCell = sim.airCellAt(S.stations.trough.water[0], S.stations.trough.water[1] + 0.3, S.stations.trough.water[2]);
    advanceSmithy(S, dt, {
      Ta,
      o2: a >= 0 ? w.o2[a] : O2_AIR,
      waterT: Tw,
      time: w.time,
      addWaterHeat: (J) => {
        if (!water.length || mW <= 0) return;
        const dT = J / (mW * CW);
        for (const i of water) {
          w.temp[i] += dT;
          w.skin[i] += dT;
        }
        Tw += dT;
      },
      addSteam: (kg) => {
        if (steamCell >= 0) w.steam[steamCell] += kg;
      },
      event: (e) => w.events.push(e),
    });
    const ht = S.heater;
    if (ht) {
      ht.power = S.forge.power;
      ht.flameTemp = Math.max(600, S.forge.T);
      ht.on = S.forge.power > 0;
    }
  }
}

/**
 * Using the smithy (E in the walk-through) at p: at the bellows lever, a few strokes of the
 * bellows. Returns what to say, or null when there is nothing of a smithy within reach.
 */
export function useSmithy(sim, p) {
  for (const S of sim.world.smithies ?? []) {
    if (!S.ready) continue;
    const L = S.stations.bellows.lever;
    if (Math.hypot(L[0] - p[0], L[2] - p[2]) < 1.6) {
      pumpBellows(S, 3);
      sim.world.events.push({ type: 'bellows', pos: S.bellowsBox.slice(), time: sim.world.time, quiet: true, player: true });
      S.playerPump = sim.world.time;
      const F = S.forge;
      return `You work the bellows: the fire roars up (fuel bed ${F.T.toFixed(0)} °C, ${heatColour(F.T)})`;
    }
  }
  return null;
}

/** What the inspector says about a smithy (sim/inspectThings.js). */
export function describeSmithy(S) {
  if (!S?.ready) return null;
  const F = S.forge;
  const rows = [
    `Forge: fuel bed ${F.T.toFixed(0)} °C (${heatColour(F.T)}), ${F.coal.toFixed(1)} kg charcoal`,
    `Air through the tuyere ${(F.air * 1000).toFixed(1)} g/s${F.blast > 0.001 ? ' (bellows blowing)' : ' (draught only)'}, burning ${(F.burn * 1000).toFixed(2)} g/s: ${(F.combustion / 1000).toFixed(1)} kW`,
    `Slack tub: ${S.water.T.toFixed(1)} °C, ${(S.water.mass ?? 0).toFixed(0)} kg of water; ${(S.water.steam * 1000).toFixed(0)} g boiled off so far`,
  ];
  const b = S.blade;
  if (b) {
    const where = { fire: 'in the fire', anvil: 'on the anvil', water: 'quenching', temper: 'tempering over the fire', grind: 'at the grindstone', tongs: 'in the tongs', stock: 'in the stock' }[b.place] ?? b.place;
    rows.push(`Working: a ${b.label}, ${where}, ${b.T.toFixed(0)} °C (${b.T > 480 ? heatColour(b.T) : temperColour(b.temperMax || b.T)}), shaped ${(b.progress * 100).toFixed(0)} % after ${b.heat} heat${b.heat === 1 ? '' : 's'}`);
    rows.push(`Its steel: ${b.martensite > 0.5 ? `hardened (martensite ${(b.martensite * 100).toFixed(0)} %)` : 'soft (pearlite)'}, ${b.hardness?.toFixed(0) ?? 18} HRC${b.temperMax > 150 ? `, tempered at ${b.temperMax.toFixed(0)} °C (${temperColour(b.temperMax)})` : b.quenched ? ' – as quenched: hard and brittle' : ''}`);
  }
  rows.push(`Shop: ${S.weapons.length} weapon${S.weapons.length === 1 ? '' : 's'} on display, ${S.made} made${S.sold ? `, ${S.sold} sold` : ''}`);
  const sm = S.smith;
  if (sm) rows.push(`The smith: ${{ walk: 'walking', heat: sm.pose === 'pump' ? 'working the bellows' : 'watching the fire', hammer: 'hammering', quench: 'quenching', temper: 'tempering', grind: 'grinding', shelve: 'putting it in the shop', stoke: 'fetching charcoal', load: 'putting it in the fire', take: 'taking it out of the fire', start: 'starting a new piece' }[sm.state] ?? sm.state}`);
  return { title: "Smith's forge", sub: 'forge, smith and shop', rows };
}
