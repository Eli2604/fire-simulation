import { MATERIALS } from './materials.js';
import { F_BURNING, F_SMOLDER, F_LIQUID } from './world.js';
import { toWorld } from './buoyancy.js';
import { crewOf } from './boatCrew.js';
import { carRot } from './carPhysics.js';
import { FRESH } from './batteries.js';

/**
 * The inspector on what moves as a body of voxels and is drawn by a mesh of its own: the boats
 * (world.floats: sim/buoyancy.js, sim/boats.js; drawn by render/floats.js) and the cars
 * (world.cars: sim/cars.js; drawn on the move by render/cars.js). Their voxels are a moving body
 * (sim/movingBody.js f.mb / c.body: the body frame `local`, the state `s`, the cells they are in
 * now) hidden under the mesh, or moved on since the mesh was put where it is: a click on the mesh
 * found no voxel. Here (pure maths, no three.js: tested without a view):
 *
 *   boatPose(f), carPose(c)          the body frame's pose now { p, R (row-major) }: world = p + R·local
 *                                    (a boat's hull frame, keel amidships, is its body's local frame)
 *   toBodyLocal(pose, q)             a sim-frame point in the body frame
 *   nearestBodyVoxel(B, l, maxD)     the voxel k of the body (still there) nearest body-frame point l
 *   bodyVoxelCell(w, B, k)           the grid cell that holds voxel k now (-1: none, held off the grid)
 *   bodyVoxelState(w, B, k)          its state (the grid copy when there is one, else what B.s keeps)
 *   boatVoxelAt(w, f, q), carVoxelAt(w, c, q)   a click there → { k, cell, local } | null
 *   seatsOf(w)                       the people in them, each a box in its vehicle's frame
 *   personAt(w, origin, dir)         a ray (sim frame) against those boxes → { thing, distance, point } | null
 *   describeBoat(sim, i, k), describeCar(sim, i, k), describePerson(sim, t)
 *                                    { title, sub, rows, voxelRows } for sim/inspectThings.js
 */

// ------------------------------------------------------------------ the maths

/** A sim-frame point in the frame of pose { p, R } (row-major: world = p + R·l): l = Rᵀ(q − p). */
export function toBodyLocal(pose, q) {
  const R = pose.R, dx = q[0] - pose.p[0], dy = q[1] - pose.p[1], dz = q[2] - pose.p[2];
  return [R[0] * dx + R[3] * dy + R[6] * dz, R[1] * dx + R[4] * dy + R[7] * dz, R[2] * dx + R[5] * dy + R[8] * dz];
}

/** A body-frame point in the sim frame. */
export function fromBodyLocal(pose, l) {
  const R = pose.R, p = pose.p;
  return [p[0] + R[0] * l[0] + R[1] * l[1] + R[2] * l[2], p[1] + R[3] * l[0] + R[4] * l[1] + R[5] * l[2], p[2] + R[6] * l[0] + R[7] * l[1] + R[8] * l[2]];
}

/** The body's voxel (still there) nearest body-frame point l within maxD m, or -1. */
export function nearestBodyVoxel(B, l, maxD = Infinity) {
  if (!B) return -1;
  let best = -1;
  let bd = maxD * maxD;
  const L = B.local, mat = B.s.mat;
  for (let k = 0; k < B.n; k++) {
    if (!mat[k]) continue;
    const dx = L[3 * k] - l[0], dy = L[3 * k + 1] - l[1], dz = L[3 * k + 2] - l[2];
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  return best;
}

/** Does grid cell c hold voxel k of B (its material, or its owner's residue)? */
function holdsK(w, B, c, k) {
  if (c < 0 || !w.mat[c]) return false;
  if (B.owner >= 0) return w.owner[c] === B.owner;
  return w.mat[c] === B.s.mat[k];
}

/** The grid cell that holds voxel k now (its own cell first, else a copy of it), or -1. */
export function bodyVoxelCell(w, B, k) {
  if (!B || k < 0) return -1;
  const a = B.at[k];
  if (holdsK(w, B, a, k)) return a;
  for (let j = 0; j < B.nCells; j++) if (B.cellK[j] === k && holdsK(w, B, B.cellList[j], k)) return B.cellList[j];
  return -1;
}

/** Voxel k's state: from its copy in the grid (live), else what the body keeps (B.s). */
export function bodyVoxelState(w, B, k) {
  if (!B || k < 0 || k >= B.n) return null;
  const c = bodyVoxelCell(w, B, k);
  const src = c >= 0 ? w : B.s;
  const i = c >= 0 ? c : k;
  const m = src.mat[i];
  if (!m) return null;
  const M = MATERIALS[m];
  const f = src.flags[i];
  return {
    k, cell: c, mat: m,
    material: M?.label ?? '?',
    temp: src.temp[i], skin: src.skin[i],
    moisture: src.moist[i], char: src.char[i],
    burning: !!(f & F_BURNING), smoulder: !!(f & F_SMOLDER), molten: !!(f & F_LIQUID),
    fuel: M?.combustible ? src.fuel[i] : null,
    rawFuel: src.fuel[i], // (a battery cell's charge left: sim/batteries.js)
    hrr: src.hrr?.[i] ?? 0,
    region: B.region?.[k] ?? null,
  };
}

/** The inspector's lines on one voxel of a body. */
export function voxelRows(st, partName = null) {
  if (!st) return ['This voxel: gone (burnt away or broken off)'];
  const state = st.burning ? 'BURNING' : st.smoulder ? 'smouldering' : st.molten ? 'molten' : st.char > 0.6 ? 'charred' : st.char > 0.1 ? 'scorched' : 'sound';
  return [
    `This voxel: ${st.material}${partName ? ` (${partName})` : ''}${st.cell < 0 ? ' – held by the body, off the grid' : ''}`,
    `Temperature: ${st.temp.toFixed(0)} °C core, ${st.skin.toFixed(0)} °C surface`,
    `Moisture: ${(st.moisture * 100).toFixed(0)} % of dry mass`,
    `Char: ${(st.char * 100).toFixed(0)} %, ${state}`,
    st.fuel !== null ? `Fuel left: ${(st.fuel * 100).toFixed(0)} %` : '',
    st.hrr > 0 ? `Heat release: ${st.hrr >= 1000 ? `${(st.hrr / 1000).toFixed(1)} kW` : `${st.hrr.toFixed(0)} W`}` : '',
  ].filter(Boolean);
}

// ------------------------------------------------------------------ poses

/** A boat's hull frame now (render/floats.js draws it there), or as built / as last stamped. */
export function boatPose(f) {
  const P = f?.body?.pose;
  if (P?.R) return { p: P.p, R: P.R };
  if (f?.mb?.pose) return f.mb.pose;
  if (!f?.at) return null;
  const y = f.yaw ?? 0, c = Math.cos(y), s = Math.sin(y);
  return { p: [f.at[0], f.at[1] + (f.spec?.keelY ?? 0), f.at[2]], R: [c, 0, s, 0, 1, 0, -s, 0, c] };
}

/** A car's frame now (its origin on the ground under its middle: sim/carBody.js bodyPose). */
export function carPose(c) {
  if (!c) return null;
  return { p: [c.x, c.y, c.z], R: carRot(c.yaw ?? 0, c.pitch ?? 0, c.roll ?? 0) };
}

// ------------------------------------------------------------------ a click on its mesh → its voxel

/** The world voxel nearest q of a list (grid cells) that are still there, or -1. */
function nearestCell(w, list, q, ok = (i) => w.mat[i]) {
  let best = -1;
  let bd = Infinity;
  for (const i of list ?? []) {
    if (!ok(i)) continue;
    const [x, y, z] = w.coords(i);
    const d = ((x + 0.5) * w.h - q[0]) ** 2 + ((y + 0.5) * w.h - q[1]) ** 2 + ((z + 0.5) * w.h - q[2]) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** A body's voxel at sim-frame point q, the body at `pose` (its pose now, as drawn). */
export function bodyVoxelAt(w, B, pose, q, maxD = Infinity) {
  if (!B || !pose) return null;
  const local = toBodyLocal(pose, q);
  const k = nearestBodyVoxel(B, local, maxD);
  if (k < 0) return null;
  return { k, cell: bodyVoxelCell(w, B, k), local };
}

/** A click on a boat's mesh at q (sim frame) → { k (its body's voxel, -1: no body yet), cell, local }. */
export function boatVoxelAt(w, f, q) {
  const pose = boatPose(f);
  if (f?.mb) return bodyVoxelAt(w, f.mb, pose, q);
  // (not simulated yet: its voxels where it was built, in the grid)
  const cell = nearestCell(w, f?.own?.length ? f.own : f?.voxels, q);
  return cell >= 0 ? { k: -1, cell, local: pose ? toBodyLocal(pose, q) : null } : null;
}

/** A click on a car (its mesh on the move, its steering wheel) at q → { k, cell, local }. */
export function carVoxelAt(w, c, q) {
  const pose = carPose(c);
  if (c?.body) return bodyVoxelAt(w, c.body, pose, q);
  // (never moved: its voxels as built, its owner's)
  if (!w?.mat || c.owner < 0) return null;
  const h = w.h;
  const cells = [];
  const lo = [q[0] - 1.5, q[1] - 1.5, q[2] - 1.5].map((v) => Math.floor(v / h));
  const hi = [q[0] + 1.5, q[1] + 1.5, q[2] + 1.5].map((v) => Math.floor(v / h));
  for (let z = lo[2]; z <= hi[2]; z++)
    for (let y = lo[1]; y <= hi[1]; y++)
      for (let x = lo[0]; x <= hi[0]; x++) if (w.inBounds(x, y, z)) cells.push(w.idx(x, y, z));
  const cell = nearestCell(w, cells, q, (i) => w.mat[i] && w.owner[i] === c.owner);
  return cell >= 0 ? { k: -1, cell, local: toBodyLocal(pose, q) } : null;
}

// ------------------------------------------------------------------ the people in them

/** A seated person as a box in the vehicle's frame: its centre and half sizes (m). */
const SEATED = { half: [0.28, 0.52, 0.26] };

/**
 * Everyone seated in a boat or a car: [{ vehicle: 'boat' | 'car', index, seat, crew, who, role,
 * label, pose, centre (vehicle frame), half }]. A boat's: its seats' and its boatmen (crewOf);
 * a car's: its seats with someone in them.
 */
export function seatsOf(w) {
  const out = [];
  (w?.floats ?? []).forEach((f, index) => {
    if (!f.body || !f.seats || f.body.sunk) return;
    const pose = boatPose(f);
    let j = 0;
    for (const o of crewOf(f)) {
      // (his feet on the floorboards; the box up to his head, seated)
      out.push({ vehicle: 'boat', index, seat: o.seat, crew: o.seat < 0 ? j++ : -1, who: o.who, role: o.role, label: null, pose, centre: [o.at[0], o.at[1] + SEATED.half[1], o.at[2]], half: SEATED.half });
    }
  });
  (w?.cars ?? []).forEach((c, index) => {
    const pose = carPose(c);
    c.seats?.forEach((s, seat) => {
      if (!s.who || s.who.dead) return;
      // (s.at: the seat's top, car frame; seated, his head ~0.85 m over it)
      out.push({ vehicle: 'car', index, seat, crew: -1, who: s.who, role: s.role, label: s.label, pose, centre: [s.at[0] - 0.05, s.at[1] + 0.3, s.at[2]], half: [0.3, 0.55, 0.25] });
    });
  });
  return out;
}

/** A ray (sim frame, dir a unit vector) against an axis-aligned box (centre, half): its entry distance, or null. */
export function rayBox(o, d, centre, half) {
  let t0 = 0, t1 = Infinity;
  for (let a = 0; a < 3; a++) {
    const lo = centre[a] - half[a] - o[a], hi = centre[a] + half[a] - o[a];
    if (Math.abs(d[a]) < 1e-12) {
      if (lo > 0 || hi < 0) return null;
      continue;
    }
    let ta = lo / d[a], tb = hi / d[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return t0;
}

/**
 * The person (seated in a boat or a car) a ray (sim frame) meets first → { thing: { kind:
 * 'person', vehicle, index, seat, crew }, distance, point (sim frame) } or null.
 */
export function personAt(w, origin, dir) {
  let best = null;
  for (const s of seatsOf(w)) {
    // the ray into the vehicle's frame (a rotation: the distance is the same)
    const o = toBodyLocal(s.pose, origin);
    const R = s.pose.R;
    const d = [R[0] * dir[0] + R[3] * dir[1] + R[6] * dir[2], R[1] * dir[0] + R[4] * dir[1] + R[7] * dir[2], R[2] * dir[0] + R[5] * dir[1] + R[8] * dir[2]];
    const t = rayBox(o, d, s.centre, s.half);
    if (t === null || (best && t >= best.distance)) continue;
    best = { thing: { kind: 'person', vehicle: s.vehicle, index: s.index, seat: s.seat, crew: s.crew }, distance: t, point: [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t] };
  }
  return best;
}

// ------------------------------------------------------------------ what they say

const deg = (r) => (r * 180) / Math.PI;
const pct = (f) => `${(f * 100).toFixed(0)} %`;
const kmh = (v) => `${(v * 3.6).toFixed(1)} km/h`;
const KIND = { row: 'Rowing boat', motor: 'Motor boat', sail: 'Sailing dinghy', canoe: 'Canoe' };
const ROLE = { rower: 'at the oars', helm: 'at the helm', paddler: 'paddling', crew: 'crew (hiking)', passenger: 'passenger', floor: 'on the floorboards', driver: 'driving' };

/** Who someone is, in a word or two. */
export function personName(m) {
  if (!m) return 'Boatman';
  if (m.player) return 'You';
  if (m.name) return m.name;
  const ROLE_NAME = { marksman: 'Marksman', grenadier: 'Grenadier', medic: 'Medic', radio: 'Radio operator', engineer: 'Engineer', rope: 'Rope man' };
  const NAME = { UAV: 'Drone operator', CMD: 'Commander', MG: 'Gunner', R1: 'Rifleman one', R2: 'Rifleman two' };
  return ROLE_NAME[m.squadRole] ?? NAME[m.squad] ?? m.label ?? (m.side ? `Soldier (${m.side})` : 'Soldier');
}

function aboard(seats) {
  const who = (seats ?? []).filter((s) => s.who).map((s) => `${personName(s.who)} (${s.label ?? ROLE[s.role] ?? s.role})`);
  return who;
}

/** The water's level round a boat (its pond's, the sea's). */
function levelOf(w, f) {
  return f.water?.level ?? w?.sea?.level ?? null;
}

/** A boat: the whole of it, then the voxel clicked (k of its body; cell for one not simulated yet). */
export function describeBoat(sim, index, k = -1, cell = -1) {
  const w = sim?.world;
  const f = w?.floats?.[index];
  if (!f) return null;
  const b = f.body;
  const kind = f.kind ?? f.params?.kind ?? 'row';
  const title = KIND[kind] ?? 'Boat';
  const rows = [];
  if (!b) {
    rows.push('State: at its berth (not afloat in the simulation yet)');
  } else {
    const st = b.sunk ? 'SUNK' : b.swamped ? 'SWAMPED (full of water)' : b.aground ? 'aground' : 'afloat';
    const ways = f.mooring ? 'moored' : f.seats?.some((s) => s.who && (s.drive || s.role === 'rower')) ? 'under way' : 'adrift';
    rows.push(`State: ${st}, ${ways}`);
    const L = levelOf(w, f);
    if (L !== null && b.hull) {
      const keel = toWorld(b, [0, b.hull.keel(0), 0]);
      rows.push(`Draft: ${Math.max(0, L - keel[1]).toFixed(2)} m${b.freeboard != null ? `, freeboard ${b.freeboard.toFixed(2)} m` : ''}`);
    } else rows.push(`Draft: none – no water under it${b.freeboard != null ? `; freeboard ${b.freeboard.toFixed(2)} m` : ''}`);
    const ang = (a, pos, neg) => (Math.abs(deg(a ?? 0)) < 0.05 ? 'level' : `${Math.abs(deg(a)).toFixed(1)}° ${a > 0 ? pos : neg}`);
    rows.push(`Heel: ${ang(b.roll, 'to starboard', 'to port')}, trim ${ang(b.pitch, 'by the stern (bow up)', 'by the bow')}`);
    const rho = b.rho ?? 1000;
    const water = (b.water ?? 0) * rho;
    const inflow = (b.inflow ?? 0) * 1000;
    rows.push(`Water aboard: ${water.toFixed(0)} kg${b.Vcap ? ` (${pct(Math.min(1, (b.water ?? 0) / b.Vcap))} of what it holds)` : ''}${Math.abs(inflow) > 0.01 ? `, ${inflow > 0 ? 'coming in' : 'running out'} ${Math.abs(inflow).toFixed(2)} l/s` : ''}`);
    const holes = b.holes ?? [];
    if (holes.length) {
      const below = L === null ? 0 : holes.filter((q) => toWorld(b, q.p)[1] < L).length;
      const area = holes.reduce((s, q) => s + (q.area ?? 0), 0);
      rows.push(`Holes: ${holes.length} (${below} below the waterline), ${(area * 1e4).toFixed(1)} cm²`);
    } else rows.push('Holes: none');
    rows.push(`Speed: ${Math.hypot(b.vx ?? 0, b.vz ?? 0).toFixed(2)} m/s (${kmh(Math.hypot(b.vx ?? 0, b.vz ?? 0))})`);
    // what drives it
    const M = f.motor;
    if (M) {
      const st = M.running ? 'running' : M.cranking > 0 ? 'starting (cranking)' : M.stalled ? `stalled${M.why ? ` (${M.why})` : ''}` : `off${M.why ? ` (${M.why})` : ''}`;
      rows.push(`Outboard (${M.power} kW): ${st}, ${(M.rpm ?? 0).toFixed(0)} rpm, throttle ${pct(Math.abs(M.throttle ?? 0))}${(M.throttle ?? 0) < 0 ? ' astern' : ''}${M.thrust ? `, thrust ${M.thrust.toFixed(0)} N` : ''}${M.racing ? ', RACING (out of the water)' : ''}${M.cav > 0.05 ? `, cavitating ${pct(M.cav)}` : ''}`);
      rows.push(`Fuel: ${M.fuel != null ? `${M.fuel.toFixed(1)} l` : 'in its tank (not simulated)'}`);
    }
    if (f.sail && f.sailState) {
      const S = f.sailState;
      rows.push(`Sail: sheet ${pct(f.row?.sheet ?? 0)} out${f.row?.autoTrim ? ' (trimmed to the wind)' : ''}, ${S.luff > 0.5 ? 'luffing' : `filled ${pct(S.fill ?? 0)}`}, angle of attack ${deg(S.alpha ?? 0).toFixed(0)}°`);
      rows.push(`Apparent wind: ${(S.U ?? 0).toFixed(1)} m/s; drive ${(S.drive ?? 0).toFixed(0)} N, side force ${(S.side ?? 0).toFixed(0)} N, heeling ${deg(S.heel ?? 0).toFixed(1)}°${S.hike ? `, crew hiking ${pct(S.hike)}` : ''}`);
    }
    if (!M && !f.sail && f.row) {
      const pull = f.row.pull ?? 0;
      rows.push(`${kind === 'canoe' ? 'Paddling' : 'Rowing'}: ${Math.abs(pull) < 0.02 ? 'resting' : `${pull > 0 ? 'pulling' : 'backing water'} ${pct(Math.abs(pull))}`}${Math.abs(f.row.turn ?? 0) > 0.05 ? `, turning to ${f.row.turn > 0 ? 'starboard' : 'port'}` : ''}`);
    }
  }
  const who = aboard(f.seats);
  const crew = (b?.loads ?? []).filter((L) => L.label === 'person' && !L.who).length;
  const men = crew ? `${crew} boatm${crew > 1 ? 'en' : 'an'}` : '';
  rows.push(`Aboard: ${[...who, men].filter(Boolean).join(', ') || 'nobody'}`);
  // the voxel clicked
  const st = f.mb && k >= 0 ? bodyVoxelState(w, f.mb, k) : cell >= 0 ? gridState(w, cell) : null;
  const part = f.mb && k >= 0 ? (f.mb.tag[k] === 1 ? 'planking' : 'fittings') : null;
  return { title, sub: f.params?.material ? `boat, ${f.params.material}` : 'boat', rows, voxelRows: voxelRows(st, part) };
}

/** A grid voxel's state as bodyVoxelState gives it. */
function gridState(w, i) {
  const m = w.mat[i];
  if (!m) return null;
  const M = MATERIALS[m];
  const f = w.flags[i];
  return { k: -1, cell: i, mat: m, material: M?.label ?? '?', temp: w.temp[i], skin: w.skin[i], moisture: w.moist[i], char: w.char[i], burning: !!(f & F_BURNING), smoulder: !!(f & F_SMOLDER), molten: !!(f & F_LIQUID), fuel: M?.combustible ? w.fuel[i] : null, hrr: w.hrr?.[i] ?? 0, region: null };
}

const GEAR = (c) => (c.spec?.single ? (c.mode ?? 'P') : c.gear < 0 ? 'R' : c.gear === 0 ? 'N' : String(c.gear));

/** A car: the whole of it, then the voxel clicked. */
export function describeCar(sim, index, k = -1, cell = -1) {
  const w = sim?.world;
  const c = w?.cars?.[index];
  if (!c) return null;
  const S = c.spec ?? {};
  const rows = [];
  const pt = S.powertrain ?? 'petrol';
  rows.push(`Powertrain: ${pt}${S.engine ? ` (${S.engine.cyl}-cylinder ${S.engine.kind})` : ''}${S.motor ? `, ${((S.motor.pmax ?? 0) / 1000).toFixed(0)} kW motor` : ''}; drive: ${S.drive?.kind ?? '?'}`);
  const v = Math.hypot(c.vx ?? 0, c.vz ?? 0);
  rows.push(`Speed: ${kmh(v)}${(c.u ?? 0) < -0.1 ? ' (reversing)' : ''}; gear ${GEAR(c)} (mode ${c.mode ?? 'P'}), ${(c.rpm ?? 0).toFixed(0)} rpm`);
  if (S.battery) {
    const range = c.range ?? 0;
    rows.push(`Battery: ${pct(c.soc ?? 0)} of ${S.battery.kWh} kWh, range ~${range.toFixed(0)} km`);
    const B = c.body;
    if (B?.region) {
      // (each cell as the grid has it now: sim/batteries.js, fuel 1 fresh, below FRESH in runaway, 0 spent)
      let n = 0, gone = 0, run = 0, hot = -Infinity;
      for (let q = 0; q < B.n; q++) {
        if (B.region[q] !== 'battery') continue;
        n++;
        const st = bodyVoxelState(w, B, q);
        if (!st || st.rawFuel <= 0) {
          gone++;
          continue;
        }
        if (st.rawFuel < FRESH) run++;
        hot = Math.max(hot, st.temp);
      }
      if (n) rows.push(`Pack: ${n} cells, ${run} in thermal runaway, ${gone} gone or spent${hot > -Infinity ? `, hottest ${hot.toFixed(0)} °C` : ''}${c.packLeft != null ? ` (${pct(c.packLeft)} fresh)` : ''}`);
    }
  }
  if (S.engine && pt !== 'electric') rows.push(`Fuel: ${(c.fuel ?? 0).toFixed(1)} of ${S.tank ?? '?'} l`);
  const E = c.engineState;
  const eng = c.dead ? `DEAD (${c.why ?? 'gone'})` : c.running ? 'running' : c.crank > 0 ? 'cranking' : 'off';
  rows.push(`${S.engine ? 'Engine' : 'Motor'}: ${eng}${E?.n ? `; its bay ${pct(E.alive / E.n)} left, ${pct(E.char)} charred${E.hot ? `, ${E.hot} voxels hot` : ''}` : ''}`);
  const left = c.body ? bodyLeft(c.body) : 1;
  rows.push(`Damage: ${pct(c.damage ?? 0)} from crashes, ${pct(1 - left)} of its voxels gone${c.wrecked ? ' – WRECKED' : ''}`);
  rows.push(`Fire: ${c.burning ? 'BURNING' : 'not burning'}`);
  const G = c.ground;
  if (G) {
    const surf = typeof G.surface === 'string' ? G.surface : G.surface?.kind ?? G.surface?.material ?? null;
    rows.push(`Ground: ${surf ?? '?'}, grip μ ${(G.mu ?? 1).toFixed(2)}${G.sink > 0.005 ? `, sinking ${(G.sink * 100).toFixed(0)} cm` : ''}${G.stuck ? ' – STUCK' : ''}${c.air ? ' (in the air)' : ''}`);
  }
  const who = aboard(c.seats);
  rows.push(`In it: ${who.length ? who.join(', ') : 'nobody'}`);
  const st = c.body && k >= 0 ? bodyVoxelState(w, c.body, k) : cell >= 0 ? gridState(w, cell) : null;
  const part = c.body && k >= 0 ? c.body.region?.[k] ?? null : null;
  const label = c.label ?? 'car';
  return { title: label[0].toUpperCase() + label.slice(1), sub: `${c.id ?? 'car'}${c.body?.hidden ? ', on the move' : c.running ? ', engine running' : ', parked'}`, rows, voxelRows: voxelRows(st, part === 'fuel' ? 'fuel tank' : part) };
}

function bodyLeft(B) {
  let a = 0;
  for (let k = 0; k < B.n; k++) if (B.s.mat[k]) a++;
  return a / Math.max(1, B.n);
}

/** Someone seated in a boat or a car (thing: { vehicle, index, seat, crew }): who, where, how he is. */
export function describePerson(sim, t) {
  const w = sim?.world;
  const v = t.vehicle === 'car' ? w?.cars?.[t.index] : w?.floats?.[t.index];
  if (!v) return null;
  const seat = t.seat >= 0 ? v.seats?.[t.seat] : null;
  const m = seat?.who ?? t.who ?? null;
  const vname = t.vehicle === 'car' ? v.label ?? 'car' : (KIND[v.kind] ?? 'boat').toLowerCase();
  const role = seat ? seat.label ?? ROLE[seat.role] ?? seat.role : 'one of its crew';
  const rows = [`In the ${vname}: ${role}${seat?.drive ? ' (in charge of it)' : ''}`];
  if (!m) {
    rows.push('A boatman: the boat’s own crew, 80 kg aboard');
    return { title: 'Boatman', sub: vname, rows };
  }
  if (m.player) rows.push('That is you');
  if (m.side) rows.push(`Side: ${m.side}`);
  const hp = m.health ?? 100;
  rows.push(`Health: ${m.dead ? 'DEAD' : `${hp.toFixed(0)} %`}${m.down ? ', DOWN' : ''}${(m.bleed ?? 0) > 0.05 ? `, bleeding ${(m.bleed).toFixed(1)}` : ''}`);
  const wounds = m.wounds ? Object.entries(m.wounds).filter(([, x]) => x).map(([z]) => z) : [];
  if (wounds.length) rows.push(`Wounds: ${wounds.join(', ')}`);
  if (m.onFire || m.burning) rows.push('ON FIRE');
  if (m.state) rows.push(`Doing: ${m.state}`);
  if (m.weapon || m.loadout) rows.push(`Armed: ${m.primary ?? m.weapon ?? m.loadout}${m.mag != null ? `, ${m.mag} rounds in the magazine, ${m.mags ?? 0} spare` : ''}`);
  if (m.mass) rows.push(`Weight: ${m.mass} kg`);
  return { title: personName(m), sub: vname, rows };
}


/** The body voxel k that grid cell i holds (one of its copies now), or -1. */
export function kOfCell(B, i) {
  if (!B || !B.cells?.has(i)) return -1;
  for (let j = 0; j < B.nCells; j++) if (B.cellList[j] === i) return B.cellK[j];
  return -1;
}

/**
 * A voxel clicked as itself (a parked car's, drawn as voxels; what is left of a burnt boat): the
 * boat or car it is part of → { kind: 'boat' | 'car', index, k, cell } or null.
 */
export function vehicleOfVoxel(w, i) {
  if (!w || i < 0 || !w.mat[i]) return null;
  const o = w.owner[i];
  const cars = w.cars ?? [];
  for (let index = 0; index < cars.length; index++) {
    const c = cars[index];
    if (c.body ? c.body.cells.has(i) || (c.owner >= 0 && o === c.owner) : c.owner >= 0 && o === c.owner) return { kind: 'car', index, k: kOfCell(c.body, i), cell: i };
  }
  const fl = w.floats ?? [];
  for (let index = 0; index < fl.length; index++) {
    const f = fl[index];
    if (f.mb ? f.mb.cells.has(i) || (f.mb.owner >= 0 && o === f.mb.owner) : (f.own ?? f.voxels ?? []).includes(i)) return { kind: 'boat', index, k: kOfCell(f.mb, i), cell: i };
  }
  return null;
}
