import { HULL_MATERIALS, rowBoatHull, bodyFromSpec, equilibrium, RHO_SEA, RHO_FRESH } from '../sim/buoyancy.js';
import { hexToRgb } from './util.js';

/**
 * A rowing boat: an open hull with a transom stern and a fine stem, thwarts (seats) across it,
 * floorboards, a pair of oars on the thwarts, a stripe along the sheer. Of wood (larch planks on
 * oak frames: it burns), aluminium or GRP. It floats by Archimedes (sim/buoyancy.js): its draft
 * comes from its weight (the hull from its planking's surface × thickness × density, its load,
 * the people on its thwarts) and the water it is on (sea 1025 kg/m³, a lake or pond 1000); on the
 * sea it heaves, rolls and pitches with the waves; it takes water through holes (planking burnt
 * or blown away below the waterline) and over the gunwale when it is overloaded, and sinks.
 *
 * Frame: its origin on the centre line amidships at its waterline at rest (put it at y = the
 * water's level), the bow to +x, port −z. Its voxels are hidden (simulated: they heat, char and
 * burn as their material does); render/floats.js draws the hull in its pose on the water.
 * With `goesTo`, it is a boat that takes you to another place (walk up to it and press E): you
 * step ashore there, and coming back you land at `arrive` (in its frame: the pier beside it).
 * The island (models/island.js) moors its boats at its pier with this.
 * Moored (`moored`, a `mooring` line from its stem to a point ahead of it) it swings on its line;
 * cast off it drifts with the current and the wind and can be rowed (sim/boats.js: its seats,
 * boardSeat / leaveSeat / row / rowToward, holes shot in its hull; walk/boatRow.js: you at the oars).
 */
export const ROW_BOAT_PARAMS = {
  length: { value: 4.3, min: 2.4, max: 7, step: 0.1, label: 'Length (m)' },
  beam: { value: 1.45, min: 0.9, max: 2.4, step: 0.05, label: 'Beam (m)' },
  depth: { value: 0.62, min: 0.35, max: 1.0, step: 0.01, label: 'Depth amidships, keel to gunwale (m)' },
  material: { value: 'wood', options: Object.keys(HULL_MATERIALS), label: 'Hull (wood planks / aluminium / GRP)' },
  hullColor: { value: '#b3332a', color: true, label: 'Hull colour' },
  insideColor: { value: '#c9b48a', color: true, label: 'Inside colour' },
  stripeColor: { value: '#efe9da', color: true, label: 'Stripe (along the sheer)' },
  thwarts: { value: 3, min: 0, max: 5, step: 1, label: 'Thwarts (seats)' },
  oars: { value: true, label: 'Oars' },
  crew: { value: 0, min: 0, max: 8, step: 1, label: 'People aboard (80 kg each, on the thwarts)' },
  load: { value: 0, min: 0, max: 2500, step: 10, label: 'Load on the floorboards (kg)' },
  flotation: { value: 0, min: 0, max: 0.6, step: 0.01, label: 'Buoyancy tanks (m³ that cannot flood)' },
  water: { value: 'auto', options: ['auto', 'sea', 'fresh'], label: 'Water (auto: the sea, or fresh on a pond)' },
  moored: { value: true, label: 'Moored (its painter made fast ahead of its bow; off: it drifts with the current and the wind)' },
  mooring: { value: 2, min: 0.5, max: 12, step: 0.1, label: 'Mooring line (m)' },
  goesTo: { value: '', label: 'Place it takes you to (empty: none)' },
  label: { value: 'Boat', label: 'What it is (its hint)' },
  arriveX: { value: 0, min: -12, max: 12, step: 0.1, label: 'Ashore here, along it (m)' },
  arriveY: { value: 0.6, min: -1, max: 4, step: 0.05, label: 'Ashore here, over its waterline (m)' },
  arriveZ: { value: 1.8, min: -12, max: 12, step: 0.1, label: 'Ashore here, across it (m, + starboard)' },
  arriveYaw: { value: 0, min: -180, max: 180, step: 5, label: 'Ashore facing (degrees from its bow)' },
  seed: { value: 1, min: 1, max: 999, step: 1, label: 'Seed' },
};

const PERSON = 80; // kg
const OAR = 4.5; // kg: a 2.3 m spruce oar

/** Where its thwarts are (x along it) and their seat height over the keel (hull frame). */
export function thwartsOf(p, hull = rowBoatHull(p)) {
  const n = p.thwarts;
  const out = [];
  for (let k = 0; k < n; k++) {
    const x = n === 1 ? 0 : -0.3 * p.length + (0.52 * p.length * k) / (n - 1);
    const y = Math.min(hull.sheer(x) - 0.2, hull.keel(x) + 0.32);
    out.push({ x, y, half: hull.half(x, y) });
  }
  return out;
}

/** What it carries: oars, people (on the thwarts, from the middle one out), load (on the floor). */
export function loadsOf(p, hull = rowBoatHull(p)) {
  const th = thwartsOf(p, hull);
  const loads = [];
  if (p.oars) for (const s of [-1, 1]) loads.push({ m: OAR, p: [0, (th[0]?.y ?? 0.35) + 0.05, s * 0.3], label: 'oar' });
  const order = th.map((t, k) => ({ t, d: Math.abs(t.x) + k * 1e-3 })).sort((a, b) => a.d - b.d).map((e) => e.t);
  // one to a thwart amidships first (on its middle), then two to a thwart (side by side), then on the floor
  const n = order.length;
  for (let k = 0; k < p.crew; k++) {
    const t = n ? order[k % n] : null;
    const pair = n && k < 2 * n && p.crew > n + (k % n); // (this thwart has two on it)
    const onFloor = !n || k >= 2 * n;
    const z = onFloor ? (k % 2 ? 0.3 : -0.3) : pair ? (k < n ? -0.24 : 0.24) : 0;
    // (a seated person's centre of mass ~0.22 m over the seat; on the floor ~0.3 m over the keel)
    loads.push({ m: PERSON, p: [t && !onFloor ? t.x : -0.05 * p.length, onFloor ? 0.3 : t.y + 0.22, z], label: 'person' });
  }
  if (p.load > 0) loads.push({ m: p.load, p: [-0.05 * p.length, 0.16, 0], label: 'load' });
  return loads;
}

/**
 * Its seats (hull frame: x along it, y the thwart's top over the keel, z across): one on the
 * rowing thwart (the middle one, by the rowlocks: the rower, facing aft), two on each other
 * thwart; and the rowlocks (where the oars pivot, on the gunwale either side).
 */
export function seatsOf(p, hull = rowBoatHull(p)) {
  const th = thwartsOf(p, hull);
  if (!th.length) return { seats: [{ x: 0, y: hull.keel(0) + 0.3, z: 0, role: 'rower' }], rowlocks: rowlocksAt(hull, 0) };
  const mid = th.reduce((a, b) => (Math.abs(b.x) < Math.abs(a.x) ? b : a));
  const seats = [{ x: mid.x, y: mid.y, z: 0, role: 'rower' }];
  // (the stern thwart first: the helmsman's place, then forward)
  for (const t of [...th].sort((a, b) => a.x - b.x)) if (t !== mid) for (const s of [-1, 1]) seats.push({ x: t.x, y: t.y, z: s * Math.min(0.25, t.half * 0.5), role: 'passenger' });
  return { seats, rowlocks: rowlocksAt(hull, mid.x) };
}
function rowlocksAt(hull, x0) {
  const x = x0 + 0.32;
  const s = hull.sheer(x);
  return [-1, 1].map((sd) => [x, s + 0.01, sd * hull.half(x, s - 0.01)]);
}

/** The float spec (sim/buoyancy.js bodyFromSpec) of a row boat with these params. */
export function rowBoatSpec(p) {
  const hull = { kind: 'rowBoat', length: p.length, beam: p.beam, depth: p.depth };
  const h = rowBoatHull(hull);
  return {
    hull,
    material: p.material,
    loads: loadsOf(p, h),
    flotation: p.flotation,
    windage: { area: p.length * p.depth * 0.7, height: p.depth * 0.75 },
  };
}

/** Its draft at rest (m, keel amidships to the waterline) in its water; Infinity: it sinks. */
export function rowBoatDraft(p) {
  const rho = p.water === 'fresh' ? RHO_FRESH : RHO_SEA;
  const b = bodyFromSpec(rowBoatSpec(p), rho);
  return equilibrium(b).draft;
}

export default {
  label: 'Rowing boat (floats: Archimedes; oars, thwarts)',
  params: ROW_BOAT_PARAMS,
  build: (p, ctx) => rowBoatBuild(p, ctx),
};

function rowBoatBuild(p, { h }) {
    const spec = rowBoatSpec(p);
    const hull = rowBoatHull(spec.hull);
    const mat = HULL_MATERIALS[p.material] ?? HULL_MATERIALS.wood;
    let T = rowBoatDraft(p);
    if (!Number.isFinite(T)) T = hull.D; // (it sinks: it starts with its gunwale at the water)
    spec.keelY = -T;
    // the hull frame (keel amidships) in the model's (the waterline): y + T
    const s = Math.max(h, 0.02); // (planking at least a voxel thick: its density is its thickness)
    const outer = (x, y, z) => Math.abs(z) < hull.half(x, y + T);
    const inner = (x, y, z) => {
      const yh = y + T;
      return x > hull.x0 + s && x < hull.x1 - s && yh - s >= hull.keel(x) && Math.abs(z) + s < hull.half(x, yh) && Math.abs(z) < hull.half(x, yh - s);
    };
    const bounds = [[hull.x0 - h, -T - h, -p.beam / 2 - h], [hull.x1 + h, hull.D - T + h, p.beam / 2 + h]];
    const thin = (m) => Math.min(1, Math.max(0.003, m / h));
    const wood = HULL_MATERIALS.wood.voxel;
    const hidden = true;
    const prims = [
      // the planking (the voxels it burns as; their holes let the water in: sim/buoyancy.js)
      { shape: 'custom', bounds, test: (x, y, z) => outer(x, y, z) && !inner(x, y, z), material: mat.voxel, density: thin(mat.t), color: hexToRgb(p.hullColor), variation: 0.03, hidden, floatHull: true },
      // its inside is open (on a pond, no pond water in it)
      { shape: 'custom', bounds, test: (x, y, z) => inner(x, y, z) && y + T < hull.sheer(x), mode: 'carve' },
      // the stripe along the sheer
      { shape: 'custom', bounds, test: (x, y, z) => outer(x, y, z) && y + T > hull.sheer(x) - 0.09, mode: 'replace', material: mat.voxel, density: thin(mat.t), color: hexToRgb(p.stripeColor), variation: 0.02, hidden },
    ];
    // the floorboards, the thwarts (and the people's places on them), the oars on the thwarts
    const inside = hexToRgb(p.insideColor);
    const fy = hull.keel(0) + 0.07 - T;
    prims.push({ shape: 'custom', bounds: [[-p.length * 0.36, fy - h, -p.beam / 2], [p.length * 0.3, fy + h, p.beam / 2]], test: (x, y, z) => Math.abs(y - fy) < Math.max(h * 0.5, 0.012) && x > -p.length * 0.36 && x < p.length * 0.3 && Math.abs(z) < hull.half(x, fy + T + 0.03) - s, material: wood, density: thin(0.02), color: inside, variation: 0.04, hidden });
    for (const t of thwartsOf(p, hull)) {
      const y = t.y - T;
      prims.push({ shape: 'custom', bounds: [[t.x - 0.12, y - 0.03 - h, -t.half], [t.x + 0.12, y + h, t.half]], test: (x, yy, z) => Math.abs(x - t.x) < 0.11 && yy < y && yy > y - 0.03 - h * 0.5 && Math.abs(z) < hull.half(x, yy + T), material: wood, density: thin(0.025), color: inside, variation: 0.04, hidden });
    }
    const th = thwartsOf(p, hull);
    if (p.oars && th.length) {
      const oy = Math.max(...th.map((t) => t.y)) - T + 0.03;
      for (const sd of [-1, 1]) {
        const z = sd * Math.min(0.32, p.beam * 0.22);
        prims.push(
          { shape: 'cylinder', a: [-p.length * 0.27, oy, z], b: [p.length * 0.24, oy, z], r: 0.022, material: wood, color: [0.78, 0.66, 0.46], hidden },
          { shape: 'box', min: [p.length * 0.24, oy - 0.006, z - 0.075], max: [p.length * 0.24 + 0.55, oy + 0.006, z + 0.075], material: wood, density: thin(0.012), color: [0.78, 0.66, 0.46], hidden },
        );
      }
    }
    const portals = [];
    if (p.goesTo) {
      const side = p.arriveZ >= 0 ? 1 : -1;
      // (at its side amidships, the side you come aboard from: its gunwale)
      const half = hull.half(0, hull.sheer(0) - 0.05);
      portals.push({ p: [0, p.arriveY, side * (half + 0.1)], r: 0.7, to: p.goesTo, label: p.label, arrive: { p: [p.arriveX, p.arriveY, p.arriveZ], yaw: ((p.arriveYaw ?? 0) * Math.PI) / 180 } });
    }
    for (const q of prims) q.float = 0; // (its voxels: sim/buoyancy.js, render/floats.js)
    // held up by the water, not by what is under it: the structure pass (simulation.js checkSupport)
    // would drop a hull afloat clear of the bottom as loose debris in the first step
    for (const q of prims) q.anchored = true;
    return {
      prims,
      floats: [{ model: 'rowBoat', spec, label: p.label || 'boat', waterKind: p.water, ...seatsOf(p, hull), moor: { moored: p.moored !== false, length: p.mooring ?? 2 }, params: { length: p.length, beam: p.beam, depth: p.depth, material: p.material, hullColor: p.hullColor, insideColor: p.insideColor, stripeColor: p.stripeColor, thwarts: p.thwarts, oars: p.oars, crew: p.crew, load: p.load } }],
      portals,
    };
}

/**
 * A rowing boat as part of another model (the island's boats at its pier): rowBoat's own build
 * with these params (over the defaults), moved to `at` in that model's frame (its waterline
 * amidships; along x, bow to +x); index: its float's index among that model's floats.
 * → { prims, floats, portals } to add to that model's.
 */
export function placeRowBoat(params, at, h, index = 0) {
  const p = { ...Object.fromEntries(Object.entries(ROW_BOAT_PARAMS).map(([k, s]) => [k, s.value])), ...params };
  const built = rowBoatBuild(p, { h });
  const [dx, dy, dz] = at;
  const mv = (v) => [v[0] + dx, v[1] + dy, v[2] + dz];
  const prims = built.prims.map((q0) => {
    const q = { ...q0, float: index }; // (the index of its float among the other model's)
    if (q.shape === 'custom') return { ...q, bounds: q.bounds.map(mv), test: (x, y, z) => q.test(x - dx, y - dy, z - dz) };
    if (q.shape === 'box') return { ...q, min: mv(q.min), max: mv(q.max) };
    if (q.shape === 'cylinder' || q.shape === 'capsule') return { ...q, a: mv(q.a), b: mv(q.b) };
    throw new Error(`placeRowBoat: shape ${q.shape}`);
  });
  return {
    prims,
    floats: built.floats.map((f) => ({ ...f, at: mv(f.at ?? [0, 0, 0]) })),
    portals: built.portals.map((pt) => ({ ...pt, p: mv(pt.p), arrive: pt.arrive && { ...pt.arrive, p: mv(pt.arrive.p) } })),
  };
}
