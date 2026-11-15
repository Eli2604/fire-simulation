import island, { islandTerrain } from './island.js';
import { placeRowBoat } from './rowBoat.js';

/**
 * The dragon isle of the Fantasy world (src/fantasyWorld.js): one land, several places on it.
 *
 * In its west the old dragon island (models/island.js, its own place: the church on its plateau,
 * the volcano on its main hill, the waterfall, the river and the mill); east of it the land runs
 * on (`extension`): a lowland with the harbour village and the smithy on the south coast, hills
 * along the north coast, a castle on a steep hill in the east and south of it, between the castle
 * hill and a ridge along the south coast, a valley with a forest (fog pools there). Roads and
 * paths join them (gravel on the ground).
 *
 * One height function for all of it, in the world's frame (metres, x east, z south; heights
 * above the sea): each place voxelises its window of it (the island its own way, the others with
 * `fantasyLand`), and the archipelago (models/archipelago.js: spec.lands) draws the rest round
 * the place you are in, so the ground runs on past its edge without a seam.
 */

/** The sea's level in the world (the island's: its zone at y 0, a 0.4 m voxel, its sea 2.5 m up). */
export const SEA_Y = 2.9;
/** The old dragon island: its zone (world frame), its voxels, and its centre in that zone. */
export const CORE = { origin: [0, 0, 0], size: [68, 22, 62], h: 0.4, centre: [34, 31] };
/** The island model's params for it (its ground joins the land's beyond its coast). */
export const CORE_ISLAND = {
  width: 64,
  depth: 58,
  seaLevel: 2.5,
  plateauEast: 0.6,
  pierLength: 9,
  catacombs: '',
  boatTo: 'village',
  boatLabel: 'Boat: round the coast to the harbour village',
  ferryTo: '',
  hut: false,
  waterfall: true,
  land: 'dragonIsle',
  landX: CORE.centre[0],
  landZ: CORE.centre[1],
  margin: 2,
};

/**
 * The places on the land beyond the old island (zone origins in the world, sizes, voxels).
 * floor: the ground's height above the sea where it is level (the village square, the valley floor).
 */
export const VILLAGE = { origin: [70, 0.5, 48], size: [32, 11, 30], h: 0.25 };
export const SMITHY = { origin: [78, null, 39.5], size: [8, 4.6, 7], h: 0.1 };
export const FOREST = { origin: [120, null, 60], size: [16, 10, 12], h: 0.2 };
export const CASTLE = { origin: [112, 1.0, 23], size: [32, 23, 32], h: 0.3 };
/** Level ground: the village square (and the smithy on it), the forest's valley floor, the castle's hilltop. */
export const PLAZA = { x0: 72, x1: 101, z0: 37, z1: 65, level: 1.2 };
export const VALLEY = { level: 2.0 };
export const CASTLE_HILL = { c: [128, 39], r: 15, level: 9 };
// (where the smithy and the forest stand on the level ground: their floors a voxel up from their origin)
SMITHY.origin[1] = SEA_Y + PLAZA.level - SMITHY.h;
FOREST.origin[1] = SEA_Y + VALLEY.level - FOREST.h;

/** Roads and paths (polylines, world x, z; half their width). */
export const ROADS = [
  // from the harbour village west into the old island: past the house and the campfire to the church
  { half: 1.3, pts: [[96, 60], [82, 57], [70, 56], [60, 54], [50, 53.5], [40, 52], [31, 48]] },
  // a branch up to the foot of the volcano
  { half: 1.0, pts: [[60, 54], [57, 46], [56, 36], [54, 27]] },
  // the smithy's yard off the square
  { half: 1.1, pts: [[82, 57], [82, 47]] },
  // east from the square up the castle hill to its gate (west side)
  { half: 1.3, pts: [[96, 60], [104, 55], [109, 48], [112, 42], [115.5, 39]] },
  // from the square along the valley to the forest
  { half: 1.0, pts: [[96, 60], [106, 64], [114, 66], [121, 66]] },
  // a steep path from the castle's back down into the valley
  { half: 0.9, pts: [[134, 52], [132, 57], [131, 61]] },
];
const LOBES = [
  { c: [92, 36], rx: 50, rz: 40 },
  { c: [128, 62], rx: 34, rz: 34 },
];
const HILLS = [
  { c: [100, 9], r: 11, hgt: 9 }, // the north coast's hills
  { c: [78, 10], r: 8, hgt: 6 },
  { c: [116, 16], r: 7, hgt: 5 },
];
// the ridge along the south coast, south of the valley
const RIDGE = { a: [104, 82], b: [152, 76], r: 5.5, hgt: 7.5 };
// the canal of the old island runs on into a basin (sea water) just east of it
const BASIN = { c: [74, 27], rx: 6, rz: 4.5 };

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const segDist = (x, z, a, b) => {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
};
const boxDist = (x, z, b) => Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.z0 - z, 0, z - b.z1));
/** Level the ground at `level` inside, blending back over `edge` metres. */
const flatten = (y, d, level, edge) => (d <= 0 ? level : d >= edge ? y : level + (y - level) * smooth(d / edge));

/** The land beyond the old island: height above the sea (world x, z). */
function extension(x, z) {
  let r = Infinity;
  for (const L of LOBES) r = Math.min(r, Math.hypot((x - L.c[0]) / L.rx, (z - L.c[1]) / L.rz));
  r *= 1 + 0.05 * Math.sin(x * 0.21 + 1.3) * Math.cos(z * 0.17) + 0.03 * Math.sin(z * 0.43 - x * 0.11);
  if (r > 1.25) return -1.6 - (r - 1.25) * 30; // off the coast: the sea floor falls away
  const land = smooth((0.97 - r) / 0.2);
  let y = 1.0 + 0.35 * Math.sin(x * 0.13) * Math.cos(z * 0.11) + 0.25 * Math.sin(x * 0.05 + z * 0.07);
  for (const H of HILLS) y += H.hgt * Math.exp(-((x - H.c[0]) ** 2 + (z - H.c[1]) ** 2) / (2 * H.r * H.r));
  y += RIDGE.hgt * Math.exp(-(segDist(x, z, RIDGE.a, RIDGE.b) ** 2) / (2 * RIDGE.r * RIDGE.r)) * (0.85 + 0.15 * Math.sin(x * 0.3));
  // the castle hill: a level top, steep flanks
  const dc = Math.hypot(x - CASTLE_HILL.c[0], z - CASTLE_HILL.c[1]);
  y = Math.max(y, dc <= CASTLE_HILL.r ? CASTLE_HILL.level : CASTLE_HILL.level - (dc - CASTLE_HILL.r) ** 1.35 * 0.95);
  // the valley floor under the forest (and the valley running west from it to the square)
  const fb = { x0: FOREST.origin[0], x1: FOREST.origin[0] + FOREST.size[0], z0: FOREST.origin[2], z1: FOREST.origin[2] + FOREST.size[2] };
  const dv = Math.min(boxDist(x, z, fb), segDist(x, z, [100, 64], [fb.x0, 66]) - 2.5);
  y = flatten(y, dv, VALLEY.level, 6);
  // the village square and the smithy's yard
  y = flatten(y, boxDist(x, z, PLAZA), PLAZA.level, 5);
  y = -1.6 + land * (y + 1.6);
  // the basin at the canal's end
  const db = Math.hypot((x - BASIN.c[0]) / BASIN.rx, (z - BASIN.c[1]) / BASIN.rz);
  const cz = canalZ(x);
  const dch = x < BASIN.c[0] && x > CORE.origin[0] + CORE.size[0] - 4 ? Math.abs(z - cz) : Infinity;
  if (db < 1.4 || dch < 2.4) y = Math.min(y, db < 1 || dch < 1.4 ? -0.8 : -0.8 + Math.min((db - 1) / 0.4, (dch - 1.4) / 1.0) * (y + 0.8));
  return y;
}
// (the old island's canal, in the world frame: models/island.js)
function canalZ(x) {
  const D = CORE_ISLAND.depth / 2;
  const lx = x - CORE.centre[0];
  return CORE.centre[1] - D * 0.05 + Math.sin(lx * 0.35) * D * 0.08;
}

/** Whether a spot (world x, z) is on a road or path. */
export function onRoad(x, z) {
  for (const R of ROADS) for (let k = 1; k < R.pts.length; k++) if (segDist(x, z, R.pts[k - 1], R.pts[k]) < R.half) return true;
  return false;
}

// the old island's ground (its own height field, with the waterfall), for drawing it round the other places
let core = null;
function coreHeight(x, z) {
  // (the island model's defaults under the scenario's params, as the voxelizer resolves them)
  core ??= islandTerrain({ ...Object.fromEntries(Object.entries(island.params).map(([k, s]) => [k, s.value])), ...CORE_ISLAND }, CORE.h);
  // (its frame: x, z from its centre, y up from a voxel over the zone's floor; its sea at seaLevel)
  return core.height(x - CORE.origin[0] - CORE.centre[0], z - CORE.origin[2] - CORE.centre[1]) - CORE_ISLAND.seaLevel;
}

/** The whole land: height above the sea (world x, z): the old island in its zone, the extension beyond. */
export function dragonIsleHeight(x, z) {
  const [x0, , z0] = CORE.origin;
  if (x >= x0 && x <= x0 + CORE.size[0] && z >= z0 && z <= z0 + CORE.size[2]) return coreHeight(x, z);
  return extension(x, z);
}

/** The lands a place can be part of (models/island.js `land`, fantasyLand, the archipelago's `lands`). */
export const LANDS = {
  dragonIsle: { height: extension, road: onRoad, drawn: dragonIsleHeight },
};

/**
 * A window of a land, as ground: the place's share of it, in voxels (columns from its surface
 * down, a shell of them). Grass on soil, sand on the shore, rock on the steep and high ground,
 * gravel on the roads. Put it at (h/2, h/2) in its place with wx/wz/wy the world position of that
 * point a voxel up (scenario helpers: src/fantasyWorld.js); it covers width × depth from there.
 */
export const fantasyLand = {
  label: 'Land (a window of a larger land: the dragon isle)',
  params: {
    land: { value: 'dragonIsle', options: ['dragonIsle'], label: 'Land' },
    wx: { value: 80, min: -2000, max: 2000, step: 0.1, label: 'World X of its origin (m)' },
    wy: { value: 3, min: -100, max: 2000, step: 0.05, label: 'World Y of its origin (m)' },
    wz: { value: 50, min: -2000, max: 2000, step: 0.1, label: 'World Z of its origin (m)' },
    width: { value: 20, min: 2, max: 200, step: 0.5, label: 'Width (m)' },
    depth: { value: 20, min: 2, max: 200, step: 0.5, label: 'Depth (m)' },
    grass: { value: true, label: 'Grass on the soil' },
    shell: { value: 1.2, min: 0.3, max: 5, step: 0.1, label: 'Ground under the surface (m)' },
  },
  build(p, { h }) {
    const L = LANDS[p.land] ?? LANDS.dragonIsle;
    const nx = Math.max(1, Math.round(p.width / h));
    const nz = Math.max(1, Math.round(p.depth / h));
    const N = nx * nz;
    const x0 = -h / 2;
    const z0 = -h / 2;
    const sea = SEA_Y - p.wy; // (its frame)
    const q = (v) => Math.round(v / h) * h;
    const top = new Float32Array(N);
    const kind = new Uint8Array(N); // 0 grass, 1 soil, 2 sand, 3 rock, 4 road
    for (let k = 0; k < nz; k++)
      for (let i = 0; i < nx; i++) {
        const x = p.wx + x0 + (i + 0.5) * h;
        const z = p.wz + z0 + (k + 0.5) * h;
        const y = L.drawn(x, z);
        const c = i + nx * k;
        top[c] = Math.max(0, q(SEA_Y + y - p.wy));
        const slope = Math.max(Math.abs(L.drawn(x + 1, z) - L.drawn(x - 1, z)), Math.abs(L.drawn(x, z + 1) - L.drawn(x, z - 1))) / 2;
        kind[c] = y < 0.45 ? 2 : slope > 1.1 || y > 10.5 ? 3 : L.road(x, z) ? 4 : p.grass ? 0 : 1;
      }
    const layers = new Map();
    const SPEC = [
      { material: 'grass', moisture: 0.2, color: [0.32, 0.42, 0.2], anchored: true },
      { material: 'soil', anchored: true },
      { material: 'beachSand', color: [0.78, 0.7, 0.5], anchored: true },
      { material: 'hillRock', color: [0.37, 0.35, 0.32], anchored: true },
      { material: 'quarrySand', color: [0.52, 0.46, 0.35], anchored: true },
    ];
    const put = (key, spec, c, lo, hi) => {
      if (!(hi > lo)) return;
      let Ly = layers.get(key);
      if (!Ly) layers.set(key, (Ly = { shape: 'columns', x0, z0, cell: h, nx, nz, lo: new Float32Array(N), hi: new Float32Array(N), variation: 0.06, ...spec }));
      Ly.lo[c] = lo;
      Ly.hi[c] = hi;
    };
    const shell = Math.max(p.shell, 2 * h);
    for (let k = 0; k < nz; k++)
      for (let i = 0; i < nx; i++) {
        const c = i + nx * k;
        const y = top[c];
        const nb = Math.min(i > 0 ? top[c - 1] : y, i < nx - 1 ? top[c + 1] : y, k > 0 ? top[c - nx] : y, k < nz - 1 ? top[c + nx] : y);
        // (from a voxel under its origin: the place's floor layer)
        const bottom = Math.max(-h, Math.min(y - shell, nb - h));
        if (kind[c] === 0) {
          put('soil-turf', { material: 'soil', color: [0.3, 0.24, 0.16], anchored: true }, c, bottom, y - h);
          put('grass', SPEC[0], c, y - h, y);
        } else put(`k${kind[c]}`, SPEC[kind[c]], c, bottom, y);
      }
    return { prims: [...layers.values()], sea: { level: sea, box: [0, 0, 0, 0] } };
  },
};

/**
 * A signpost at a road's end: walk up to it and press E to go along the road to another place
 * (a portal); coming back from there you arrive here at `arrive` (its frame).
 */
export const signpost = {
  label: 'Signpost (a road to another place)',
  params: {
    to: { value: '', label: 'Place the road goes to' },
    label: { value: 'Road', label: 'What it says (its hint)' },
    arriveX: { value: 1.5, min: -10, max: 10, step: 0.1, label: 'Coming back: arrive here, X (m)' },
    arriveZ: { value: 0, min: -10, max: 10, step: 0.1, label: 'Coming back: arrive here, Z (m)' },
    arriveYaw: { value: 0, min: -180, max: 180, step: 5, label: 'Coming back: facing (degrees)' },
  },
  build(p, { h }) {
    const wood = { material: 'wood', color: [0.42, 0.3, 0.18], anchored: true };
    const prims = [
      { shape: 'box', min: [-0.06, 0, -0.06], max: [0.06, 2.1, 0.06], ...wood },
      { shape: 'box', min: [-0.05, 1.6, -0.45], max: [0.05, 1.95, 0.45], material: 'wood', color: [0.62, 0.48, 0.3], anchored: true },
    ];
    return {
      prims,
      portals: p.to ? [{ p: [0, 0, 0], r: Math.max(0.9, h * 3), to: p.to, label: p.label, kind: 'road', arrive: { p: [p.arriveX, 0, p.arriveZ], yaw: (p.arriveYaw * Math.PI) / 180 } }] : [],
    };
  },
};

/**
 * A wooden landing stage running out from the shore along +z, a rowing boat moored at its end
 * (models/rowBoat.js; E: it takes you to `boatTo`), and where you come ashore: on it, at its
 * landward end (the place's walk-in start). sea: the sea's level in its frame.
 */
export const landingStage = {
  label: 'Landing stage with a boat',
  params: {
    length: { value: 8, min: 3, max: 20, step: 0.5, label: 'Length (m)' },
    sea: { value: 2.4, min: -5, max: 10, step: 0.05, label: "The sea's level (its frame, m)" },
    boatTo: { value: '', label: 'Place the boat takes you to' },
    boatLabel: { value: 'Boat', label: 'What the boat is (its hint)' },
    seed: { value: 3, min: 1, max: 999, step: 1, label: 'Seed' },
  },
  build(p, { h }) {
    const ph = p.sea + 0.6;
    const L = p.length;
    const prims = [
      { shape: 'box', min: [-0.8, ph - 0.12, 0], max: [0.8, ph, L], material: 'wood', density: 0.3, color: [0.5, 0.38, 0.24], anchored: true },
      ...Array.from({ length: Math.floor(L / 2) + 1 }, (_, k) => Math.min(L - 0.2, k * 2 + 0.3)).flatMap((z) => [
        { shape: 'cylinder', a: [-0.7, -1.5, z], b: [-0.7, ph, z], r: 0.1, material: 'wood', anchored: true },
        { shape: 'cylinder', a: [0.7, -1.5, z], b: [0.7, ph, z], r: 0.1, material: 'wood', anchored: true },
      ]),
    ];
    const portals = [];
    let floats = [];
    if (p.boatTo) {
      // (moored across the stage's end, its bow to +x: you step in from the end of the stage)
      const b = placeRowBoat({ goesTo: p.boatTo, label: p.boatLabel, hullColor: '#2f6b4f', stripeColor: '#e8d8a0', seed: p.seed, arriveX: 0, arriveY: ph - p.sea, arriveZ: -1.9 }, [0, p.sea, L + 1.6], h, 0);
      prims.push(...b.prims);
      floats = b.floats;
      portals.push(...b.portals);
    }
    return { prims, portals, floats, spawn: { p: [0, ph, 1.2], yaw: -Math.PI / 2 } };
  },
};
