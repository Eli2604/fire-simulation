import { MATERIALS, MAT } from '../sim/materials.js';

/**
 * Terrain: the ground of a place, shaped by areas. A flat bed of ground (`base` metres thick, of
 * one surface: grass, rock, sand…) over the world's ground layer, and on it a list of areas, each
 * a footprint (a rectangle, an ellipse or a polygon: where it is, its size, its turn) with
 *
 *  - a height: raise a hill or a plateau (+), dig a pit, a basin or a lake bed (−), or level the
 *    ground at a height (flatten: a terrace, a pad), with an edge slope (how wide the flank is,
 *    0: a cliff) of a profile (smooth, linear, dome) and a roughness (noise: natural ground);
 *  - a surface: grass (real grass fuel: a turf voxel of grass on soil, optionally tall grass above
 *    it; it burns, and render/trees.js draws its blades), soil, mud, sand, gravel, rock, volcanic
 *    rock (basalt), volcanic ash and cinders (tephra), snow (the snow field, sim/snow.js, on frozen
 *    soil: it melts by the weather and by fire), water (a bed of mud, filled with water to its
 *    level) or lava (a basalt bed, filled to its level with molten basalt: it glows, flows, sets
 *    what it touches alight and crusts over as it cools); or 'keep' (the height only).
 *
 * Areas stack in their order: each one's height applies to the ground as the ones before left it
 * (a hill, then a pond dug into its side), and the surface of the last one covering a spot is the
 * one there. They are the object's `params.areas`, saved with the scene like any parameter; the
 * editor edits them in the terrain's properties and with the gizmo in the view
 * (editor/terrainPanel.js).
 *
 * It is a height field (like the island's, models/island.js), voxelised as columns (the voxelizer's
 * 'columns' shape): per cell of one voxel a column of ground from its surface down, only a shell of
 * it (`shell` metres; at least down to the lowest neighbour, so no gap shows at a step) under the
 * hills: nobody digs into them. Put it first in a scene, and the objects on it with y 'auto' (the
 * editor does both when you add one): they stand on its surface.
 *
 * Its frame: x and z from the centre of its footprint, y up from the world's ground layer.
 */

/** The surfaces: what the top is (and how thick, voxels), what is under it, what fills it. */
export const SURFACES = {
  grass: { label: 'Grass on soil', top: 'grass', under: 'soil', grass: true },
  soil: { label: 'Soil / dirt', top: 'soil', under: 'soil' },
  mud: { label: 'Mud', top: 'mud', under: 'soil', thick: 2 },
  sand: { label: 'Sand', top: 'beachSand', under: 'beachSand' },
  gravel: { label: 'Gravel', top: 'quarrySand', under: 'soil', color: [0.5, 0.49, 0.46] },
  rock: { label: 'Rock', top: 'hillRock', under: 'hillRock' },
  volcanic: { label: 'Volcanic rock (basalt)', top: 'basalt', under: 'basalt' },
  ash: { label: 'Volcanic ash and cinders', top: 'tephra', under: 'basalt', thick: 2 },
  snow: { label: 'Snow (on frozen soil)', top: 'soil', under: 'soil', snow: true, color: [0.4, 0.36, 0.3] },
  water: { label: 'Water (a lake bed of mud, filled to its level)', top: 'mud', under: 'soil', fluid: 'water' },
  lava: { label: 'Lava (molten basalt, filled to its level)', top: 'basalt', under: 'basalt', fluid: 'basalt', temp: 1180, fluidColor: [0.25, 0.12, 0.08] },
};
export const SURFACE_KEYS = Object.keys(SURFACES);

/** An area's fields: their defaults and how the editor shows them (as a model's params). */
export const AREA_PARAMS = {
  name: { value: 'Area', label: 'Name' },
  enabled: { value: true, label: 'On' },
  shape: { value: 'ellipse', options: ['rectangle', 'ellipse', 'polygon'], label: 'Shape' },
  x: { value: 0, min: -100, max: 100, step: 0.1, label: 'X in the terrain (m)' },
  z: { value: 0, min: -100, max: 100, step: 0.1, label: 'Z in the terrain (m)' },
  width: { value: 6, min: 0.2, max: 200, step: 0.1, label: 'Width X (m; ellipse: across)' },
  depth: { value: 6, min: 0.2, max: 200, step: 0.1, label: 'Depth Z (m; ellipse: across)' },
  rotation: { value: 0, min: 0, max: 360, step: 1, label: 'Turn (°)' },
  height: { value: 1.5, min: -10, max: 20, step: 0.05, label: 'Height (m; − digs a pit)' },
  mode: { value: 'add', options: { 'Raise / dig by the height': 'add', 'Level at the height (flatten)': 'level' }, label: 'Height is' },
  slope: { value: 2, min: 0, max: 40, step: 0.1, label: 'Edge slope width (m; 0: a cliff)' },
  profile: { value: 'smooth', options: ['smooth', 'linear', 'dome'], label: 'Slope profile' },
  noise: { value: 0, min: 0, max: 4, step: 0.05, label: 'Roughness (m)' },
  surface: { value: 'grass', options: [...SURFACE_KEYS, 'keep'], label: 'Surface (keep: height only)' },
  // (null: the terrain's own)
  moisture: { value: null, min: 0.03, max: 1.5, step: 0.01, label: 'Grass moisture (kg/kg): <0.15 dry, >0.6 green' },
  tall: { value: null, min: 0, max: 1.5, step: 0.05, label: 'Tall grass above the turf (m)' },
  level: { value: -0.2, min: -10, max: 20, step: 0.05, label: 'Water / lava level (m above the base ground)' },
  snow: { value: 0.3, min: 0, max: 2, step: 0.05, label: 'Snow depth (m)' },
};
const AREA_DEFAULTS = Object.fromEntries(Object.entries(AREA_PARAMS).map(([k, s]) => [k, s.value]));

/** A new area: the defaults and what is given (points: a polygon's corners, [[x, z], ...] in its frame). */
export const newArea = (over = {}) => ({ ...AREA_DEFAULTS, ...over });
/** An area with every field (the defaults for what it leaves out). */
export const resolveArea = (a) => ({ ...AREA_DEFAULTS, ...a });

/** What a new terrain has: a grassy hill with a rocky top, a sandy shore and a pond dug into it. */
export const DEFAULT_AREAS = [
  newArea({ name: 'Hill', x: -6, z: -5, width: 12, depth: 9, height: 3, slope: 4.5, noise: 0.3, surface: 'grass' }),
  newArea({ name: 'Rocky top', x: -6.5, z: -5.5, width: 4.5, depth: 3.5, rotation: 30, height: 0.4, slope: 1, noise: 0.25, surface: 'rock' }),
  newArea({ name: 'Shore', x: 6, z: 5, width: 10, depth: 8, height: 0, slope: 0, surface: 'sand' }),
  newArea({ name: 'Pond', x: 6, z: 5, width: 7.5, depth: 5.5, height: -1.2, slope: 2, surface: 'water', level: -0.2 }),
];

/** A polygon area's corners: its points, or a hexagon in its width and depth. */
export function areaPolygon(a) {
  if (Array.isArray(a.points) && a.points.length >= 3) return a.points;
  return Array.from({ length: 6 }, (_, k) => [(Math.cos((k * Math.PI) / 3) * a.width) / 2, (Math.sin((k * Math.PI) / 3) * a.depth) / 2]);
}

/** How far an area reaches from its centre (m). */
export function areaRadius(a) {
  if (a.shape === 'polygon') return Math.max(...areaPolygon(a).map(([x, z]) => Math.hypot(x, z)));
  return a.shape === 'rectangle' ? Math.hypot(a.width, a.depth) / 2 : Math.max(a.width, a.depth) / 2;
}

/** A point of the terrain's frame in an area's own (its centre, turned by its rotation). */
export function toArea(a, x, z) {
  const r = ((a.rotation ?? 0) * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const dx = x - a.x;
  const dz = z - a.z;
  // (the voxelizer's turn about y: world = R local, R = [c 0 s; 0 1 0; -s 0 c]; back: its transpose)
  return [c * dx - s * dz, s * dx + c * dz];
}
/** A point of an area's frame in the terrain's. */
export function fromArea(a, lx, lz) {
  const r = ((a.rotation ?? 0) * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [a.x + c * lx + s * lz, a.z - s * lx + c * lz];
}

/**
 * How far inside an area a point is (m, terrain frame; < 0: outside): its distance to the
 * outline (exact for a rectangle and a polygon, close for an ellipse).
 */
export function areaInside(a, x, z) {
  const [lx, lz] = toArea(a, x, z);
  if (a.shape === 'rectangle') {
    const qx = Math.abs(lx) - a.width / 2;
    const qz = Math.abs(lz) - a.depth / 2;
    return -(Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0));
  }
  if (a.shape === 'polygon') {
    const P = areaPolygon(a);
    let d = Infinity;
    let inside = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const [ax, az] = P[j];
      const [bx, bz] = P[i];
      const ex = bx - ax;
      const ez = bz - az;
      const t = Math.max(0, Math.min(1, ((lx - ax) * ex + (lz - az) * ez) / (ex * ex + ez * ez || 1e-9)));
      d = Math.min(d, Math.hypot(lx - ax - ex * t, lz - az - ez * t));
      if (bz > lz !== az > lz && lx < ((ax - bx) * (lz - bz)) / (az - bz) + bx) inside = !inside;
    }
    return inside ? d : -d;
  }
  // an ellipse: its implicit function over the length of its gradient (first order)
  const rx = Math.max(a.width / 2, 1e-3);
  const rz = Math.max(a.depth / 2, 1e-3);
  const k = Math.hypot(lx / rx, lz / rz);
  const g = Math.hypot(lx / (rx * rx), lz / (rz * rz));
  return g > 1e-9 ? ((1 - k) * k) / g : Math.min(rx, rz);
}

/** How much of an area's height a point gets (0..1), d metres inside its outline. */
export function areaWeight(a, d) {
  if (d <= 0) return 0;
  if (!(a.slope > 0)) return 1;
  const t = Math.min(1, d / a.slope);
  if (a.profile === 'linear') return t;
  if (a.profile === 'dome') return Math.sqrt(1 - (1 - t) * (1 - t));
  return t * t * (3 - 2 * t);
}

// value noise (two octaves, ~3 m and ~1.2 m), -1..1: rough ground
const hash2 = (i, k, s) => {
  let n = (Math.imul(i, 374761393) + Math.imul(k, 668265263) + Math.imul(s, 982451653)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
function noise1(x, z, s) {
  const i = Math.floor(x);
  const k = Math.floor(z);
  let fx = x - i;
  let fz = z - k;
  fx = fx * fx * (3 - 2 * fx);
  fz = fz * fz * (3 - 2 * fz);
  const a = hash2(i, k, s) + (hash2(i + 1, k, s) - hash2(i, k, s)) * fx;
  const b = hash2(i, k + 1, s) + (hash2(i + 1, k + 1, s) - hash2(i, k + 1, s)) * fx;
  return a + (b - a) * fz;
}
export const roughness = (x, z, s) => (noise1(x / 3, z / 3, s) - 0.5) * 1.4 + (noise1(x / 1.2, z / 1.2, s + 7) - 0.5) * 0.6;

/**
 * The terrain's height field at voxel size h: cells of h with their centres on whole multiples of
 * h (as the voxelizer puts a model's origin on a voxel centre: each cell is one voxel column, the
 * terrain unturned). Per cell (c = i + nx k, at x = x0 + (i + ½) h, z likewise):
 *   ground  its surface height (m above the world's ground layer; not yet on whole voxels)
 *   surf    its surface (index into SURFACE_KEYS)
 *   moist   grass moisture, tall  tall grass (m), fluid  the level water / lava fills to (or -∞),
 *   snow    the depth of snow lying on it (m)
 */
export function terrainField(p, h) {
  const hx = Math.max(1, Math.round(p.width / 2 / h));
  const hz = Math.max(1, Math.round(p.depth / 2 / h));
  const nx = 2 * hx + 1;
  const nz = 2 * hz + 1;
  const x0 = -(hx + 0.5) * h;
  const z0 = -(hz + 0.5) * h;
  const N = nx * nz;
  const base = p.base;
  const surf0 = Math.max(0, SURFACE_KEYS.indexOf(p.surface));
  const S0 = SURFACES[SURFACE_KEYS[surf0]];
  const ground = new Float32Array(N).fill(base);
  const surf = new Uint8Array(N).fill(surf0);
  const moist = new Float32Array(N).fill(p.moisture);
  const tall = new Float32Array(N).fill(p.tall ?? 0);
  const fluid = new Float32Array(N).fill(S0.fluid ? base + (p.level ?? -0.2) : -Infinity);
  const snow = new Float32Array(N).fill(S0.snow ? p.snow ?? 0.3 : 0);
  // the border: a slope down to the world's ground (or a cliff)
  if (p.edge > 0)
    for (let k = 0; k < nz; k++)
      for (let i = 0; i < nx; i++) {
        const d = Math.min(p.width / 2 - Math.abs((i - hx) * h), p.depth / 2 - Math.abs((k - hz) * h));
        const t = Math.max(0, Math.min(1, d / p.edge));
        ground[i + nx * k] = base * t * t * (3 - 2 * t);
      }
  (p.areas ?? []).forEach((a0, n) => {
    if (!a0 || a0.enabled === false) return;
    const a = resolveArea(a0);
    const S = SURFACES[a.surface];
    const si = SURFACE_KEYS.indexOf(a.surface);
    const R = areaRadius(a) + h;
    const i0 = Math.max(0, Math.floor((a.x - R - x0) / h));
    const i1 = Math.min(nx - 1, Math.ceil((a.x + R - x0) / h));
    const k0 = Math.max(0, Math.floor((a.z - R - z0) / h));
    const k1 = Math.min(nz - 1, Math.ceil((a.z + R - z0) / h));
    const seed = (p.seed ?? 1) * 131 + n * 17;
    for (let k = k0; k <= k1; k++)
      for (let i = i0; i <= i1; i++) {
        const x = (i - hx) * h;
        const z = (k - hz) * h;
        const d = areaInside(a, x, z);
        if (d <= 0) continue;
        const c = i + nx * k;
        const w = areaWeight(a, d);
        const rough = a.noise > 0 ? a.noise * roughness(x, z, seed) * w : 0;
        if (a.mode === 'level') ground[c] += (base + a.height + rough - ground[c]) * w;
        else ground[c] += a.height * w + rough;
        if (!S) continue; // ('keep': its height only)
        surf[c] = si;
        moist[c] = a.moisture ?? p.moisture;
        tall[c] = S.grass ? a.tall ?? p.tall ?? 0 : 0;
        fluid[c] = S.fluid ? base + a.level : -Infinity;
        snow[c] = S.snow ? a.snow : 0;
      }
  });
  for (let c = 0; c < N; c++) if (ground[c] < 0) ground[c] = 0;
  return { nx, nz, hx, hz, x0, z0, h, ground, surf, moist, tall, fluid, snow };
}

/** The colour of grass of a moisture (as the grass patch: cured straw to green). */
export function grassColor(m) {
  const g = Math.min(1, Math.max(0, (m - 0.1) / 0.6));
  return [0.62 - 0.27 * g, 0.58 - 0.12 * g, 0.28 - 0.08 * g];
}

/** The prims of a terrain (columns of each material) from its height field. */
export function terrainPrims(p, F) {
  const { nx, nz, x0, z0, h, ground, surf, moist, tall, fluid } = F;
  const N = nx * nz;
  const q = (v) => Math.round(v / h) * h; // (on whole voxels)
  const top = new Float32Array(N);
  for (let c = 0; c < N; c++) top[c] = q(ground[c]);
  const layers = new Map();
  const put = (key, spec, c, lo, hi) => {
    if (!(hi > lo)) return;
    let L = layers.get(key);
    if (!L) layers.set(key, (L = { shape: 'columns', x0, z0, cell: h, nx, nz, lo: new Float32Array(N), hi: new Float32Array(N), variation: 0.06, ...spec }));
    L.lo[c] = lo;
    L.hi[c] = hi;
  };
  const shell = Math.max(p.shell ?? 1.2, 2 * h);
  for (let k = 0; k < nz; k++)
    for (let i = 0; i < nx; i++) {
      const c = i + nx * k;
      const y = top[c];
      const key = SURFACE_KEYS[surf[c]];
      const S = SURFACES[key];
      // down at least to its lowest neighbour's top (outside the terrain: the world's ground), so a
      // step in the ground shows no gap under the shell
      const nb = Math.min(i > 0 ? top[c - 1] : 0, i < nx - 1 ? top[c + 1] : 0, k > 0 ? top[c - nx] : 0, k < nz - 1 ? top[c + nx] : 0);
      const bottom = Math.max(0, Math.min(y - shell, nb - h));
      const thick = (S.thick ?? 1) * h;
      const m = Math.round(moist[c] * 100) / 100;
      const topSpec = S.grass
        ? { material: 'grass', moisture: m, color: grassColor(m), anchored: true }
        : { material: S.top, color: S.color ?? MATERIALS[MAT[S.top]].color, anchored: true };
      const topKey = `top|${S.top}|${S.grass ? m : key}`;
      if (S.top === S.under) put(topKey, topSpec, c, bottom, y);
      else {
        // (under the turf: soil a shade darker, as on the island)
        put(`under|${S.under}|${S.grass ? 'turf' : ''}`, { material: S.under, color: S.grass ? [0.3, 0.24, 0.16] : MATERIALS[MAT[S.under]].color, anchored: true }, c, bottom, Math.max(bottom, y - thick));
        put(topKey, topSpec, c, Math.max(bottom, y - thick), y);
      }
      // tall grass over the turf: blades standing in the air (they let it through; a fire runs in them)
      if (S.grass && tall[c] >= h * 0.5) put(`tall|${m}`, { material: 'grass', moisture: m, color: grassColor(m), fill: 0.75, seed: p.seed ?? 1, variation: 0.18 }, c, y, y + q(tall[c]));
      // water to its level over the lake bed; lava (molten basalt) over its bed
      if (S.fluid) {
        const lv = q(fluid[c]);
        if (lv > y) put(`fluid|${key}`, { material: S.fluid, ...(S.temp ? { temp: S.temp, color: S.fluidColor, variation: 0.05 } : {}) }, c, y, lv);
      }
    }
  return [...layers.values()];
}

/** The surface height (m, terrain frame) at a point, as voxelised (on whole voxels), and its surface. */
export function terrainAt(p, h, x, z, F = terrainField(p, h)) {
  const i = Math.max(0, Math.min(F.nx - 1, Math.round(x / h) + F.hx));
  const k = Math.max(0, Math.min(F.nz - 1, Math.round(z / h) + F.hz));
  const c = i + F.nx * k;
  return { y: Math.round(F.ground[c] / h) * h, surface: SURFACE_KEYS[F.surf[c]], fluid: F.fluid[c], snow: F.snow[c] };
}

export default {
  label: 'Terrain (areas: hills, pits, grass, rock, sand, water…)',
  about: 'Ground shaped by areas: hills, plateaus, pits and lake beds, each with its surface (grass, rock, sand, volcanic, snow, water, lava…)',
  // (the editor puts it first in the scene, and the objects already there on it: y 'auto')
  ground: true,
  params: {
    width: { value: 30, min: 2, max: 200, step: 0.5, label: 'Width X (m)' },
    depth: { value: 30, min: 2, max: 200, step: 0.5, label: 'Depth Z (m)' },
    base: { value: 1, min: 0.2, max: 10, step: 0.1, label: 'Base ground thickness (m; pits dig into it)' },
    surface: { value: 'grass', options: SURFACE_KEYS, label: 'Base surface' },
    moisture: { value: 0.2, min: 0.03, max: 1.5, step: 0.01, label: 'Grass moisture (kg/kg): <0.15 dry, >0.6 green' },
    tall: { value: 0, min: 0, max: 1.5, step: 0.05, label: 'Tall grass above the turf (m)' },
    level: { value: -0.2, min: -10, max: 20, step: 0.05, label: 'Water / lava level (base surface water or lava, m)' },
    snow: { value: 0.3, min: 0, max: 2, step: 0.05, label: 'Snow depth (base surface snow, m)' },
    edge: { value: 0, min: 0, max: 20, step: 0.1, label: 'Border slope (m; 0: a cliff at its edge)' },
    shell: { value: 1.2, min: 0.4, max: 6, step: 0.1, label: 'Ground under the surface (m; hollow below)' },
    seed: { value: 1, min: 1, max: 999, step: 1, label: 'Random seed (roughness)' },
    areas: { value: DEFAULT_AREAS, list: true, label: 'Areas' },
  },
  /** A new one: its areas its own (not the defaults' arrays). */
  create(o) {
    o.params = { ...o.params, areas: JSON.parse(JSON.stringify(o.params?.areas ?? DEFAULT_AREAS)) };
    return o;
  },
  build(p, { h }) {
    const F = terrainField(p, h);
    const prims = terrainPrims(p, F);
    // burning at start: the grass nearest its centre (else whatever is there)
    let best = Infinity;
    let at = null;
    for (let k = 0; k < F.nz; k++)
      for (let i = 0; i < F.nx; i++) {
        const c = i + F.nx * k;
        if (!SURFACES[SURFACE_KEYS[F.surf[c]]].grass) continue;
        const x = (i - F.hx) * h;
        const z = (k - F.hz) * h;
        const d = x * x + z * z;
        if (d < best) (best = d), (at = [x, Math.round(F.ground[c] / h) * h - h / 2, z]);
      }
    const ignite = at ? { p: at, radius: Math.max(0.35, h * 1.5), materials: ['grass'] } : { p: [0, Math.round(F.ground[F.hx + F.nx * F.hz] / h) * h, 0], radius: Math.max(0.35, h * 1.5) };
    // the snow its snowfields lay (sim/snow.js takes it when it starts)
    const any = F.snow.some((d) => d > 0);
    const snow = any ? (x, z) => {
      const i = Math.round(x / h) + F.hx;
      const k = Math.round(z / h) + F.hz;
      return i < 0 || k < 0 || i >= F.nx || k >= F.nz ? 0 : F.snow[i + F.nx * k];
    } : null;
    return { prims, ignite, ...(snow ? { snow } : {}) };
  },
};
