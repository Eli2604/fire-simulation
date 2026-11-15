/**
 * Room acoustics from the voxel world (pure: no Web Audio here, see audio/roomReverb.js).
 *
 *  - materials: absorption coefficients α in four octave-ish bands (BANDS: 125 / 500 / 2k / 8k Hz,
 *    standing for <250, 250-1k, 1k-4k, >4k), a scattering coefficient (how diffusely a surface sends
 *    the sound back: rough stone, bones, books, foliage) and, for foliage and grass, a porosity
 *    (an extinction per metre: a ray goes some way into a bush before it is turned back).
 *  - the probe (probeSpace, AcousticProbe: amortised over frames): rays from the listener through
 *    the voxel grid (3D DDA), each followed for a few bounces (specular, or diffuse by the
 *    surface's scattering). From the first hits: the enclosed volume (star-shaped estimate
 *    4π/3·⟨r³⟩), the surface area, the mean free path 4V/S, the openness (rays escaping to the sky
 *    or off the world), the planar reflectors (walls, floor, a cliff, a ship's hull: their
 *    perpendicular distance, direction, absorption, how much of the sphere they fill) and the
 *    clutter (furniture, trees, crates: short or scattering hits). From the bounces: the energy
 *    left after K reflections per band (escaping = gone) over the time they took → the decay
 *    rate per band (Eyring/Millington-like, plus air absorption) → RT60 per band.
 *  - spaceParams: what the renderer needs: RT60 per band, pre-delay, the early reflections
 *    (delay 2d/c, gain, direction), discrete echoes from large distant reflectors in the open
 *    (delay 2d/c, one delay line each), the diffusion and the reverberant level (from the
 *    critical distance r_c = 0.057·√(V/RT60)).
 *  - occlusion: a source behind walls (mass law per crossed voxel, a flanking/diffraction floor,
 *    a low-pass), foliage a little.
 *  - impulseResponse: the convolution IR from those parameters (band-filtered sparse→dense noise,
 *    each band decaying at its RT60, early reflections as taps), deterministic with a seed.
 */
import { MATERIALS, MAT } from '../sim/materials.js';

export const BANDS = [125, 500, 2000, 8000];
export const C_SOUND = 343;
/** air absorption (energy, 1/m) per band at ~20 °C, 50 % RH */
export const AIR_M = [0.0001, 0.0006, 0.0024, 0.02];
const F_HIDDEN = 64;

/**
 * Per material name: α per band, scattering 0..1, porosity σ (1/m: a ray is turned back after
 * ~1/σ metres of it; 0 = solid surface). Representative values from the usual tables.
 */
const STONE = { a: [0.02, 0.02, 0.03, 0.05], s: 0.25 };
const METAL = { a: [0.08, 0.04, 0.04, 0.05], s: 0.05 };
const WOOD = { a: [0.15, 0.1, 0.07, 0.08], s: 0.15 };
const FOLIAGE = { a: [0.1, 0.3, 0.5, 0.6], s: 0.9, p: 2.5 };
const CLOTH = { a: [0.12, 0.5, 0.7, 0.7], s: 0.4 };
const GROUNDY = { a: [0.15, 0.3, 0.5, 0.6], s: 0.3 };
export const ACOUSTIC = {
  default: { a: [0.05, 0.07, 0.09, 0.11], s: 0.2 },
  concrete: { a: [0.01, 0.02, 0.02, 0.03], s: 0.1 },
  brick: { a: [0.03, 0.03, 0.04, 0.07], s: 0.15 },
  stone: STONE, ashlar: STONE, basalt: STONE, bedrock: STONE, hillRock: STONE, sandstone: STONE,
  ossuary: { a: [0.1, 0.15, 0.2, 0.25], s: 0.75 },
  bone: { a: [0.08, 0.12, 0.15, 0.2], s: 0.6 },
  tiles: { a: [0.01, 0.01, 0.02, 0.02], s: 0.05 },
  ceramic: { a: [0.01, 0.01, 0.02, 0.02], s: 0.05 },
  glass: { a: [0.25, 0.1, 0.05, 0.03], s: 0.03 },
  plaster: { a: [0.2, 0.06, 0.05, 0.06], s: 0.1 },
  ceilingTile: { a: [0.4, 0.6, 0.75, 0.7], s: 0.3 },
  steel: METAL, deckSteel: METAL, steelProfile: { ...METAL, s: 0.4 }, aluminium: METAL, copper: METAL, brass: METAL, cable: { ...METAL, s: 0.5 },
  wood: WOOD, oak: WOOD, willow: WOOD, pine: WOOD, deadWood: WOOD, bark: { a: [0.12, 0.12, 0.12, 0.14], s: 0.4 }, pitch: WOOD, shingles: { a: [0.1, 0.1, 0.1, 0.1], s: 0.2 },
  leaves: FOLIAGE, needles: FOLIAGE, twigs: { ...FOLIAGE, p: 1.5 },
  grass: { a: [0.1, 0.3, 0.6, 0.7], s: 0.6, p: 8 },
  fabric: CLOTH, cotton: CLOTH, polyester: CLOTH,
  foam: { a: [0.2, 0.7, 0.95, 0.95], s: 0.3 },
  books: { a: [0.3, 0.35, 0.4, 0.45], s: 0.6 }, pages: { a: [0.2, 0.3, 0.4, 0.45], s: 0.5 }, paper: { a: [0.15, 0.25, 0.35, 0.4], s: 0.4 },
  rubber: { a: [0.04, 0.05, 0.08, 0.1], s: 0.1 }, plastic: { a: [0.05, 0.05, 0.05, 0.07], s: 0.1 },
  wax: { a: [0.03, 0.04, 0.05, 0.06], s: 0.1 }, beeswax: { a: [0.03, 0.04, 0.05, 0.06], s: 0.1 },
  soil: GROUNDY, mud: { a: [0.1, 0.15, 0.2, 0.25], s: 0.2 }, ash: { a: [0.2, 0.4, 0.5, 0.6], s: 0.3 }, charcoal: { a: [0.15, 0.25, 0.35, 0.4], s: 0.5 },
  tephra: { a: [0.2, 0.35, 0.45, 0.5], s: 0.5 },
  beachSand: { a: [0.15, 0.35, 0.4, 0.5], s: 0.3 }, quarrySand: { a: [0.15, 0.35, 0.4, 0.5], s: 0.3 },
  snow: { a: [0.45, 0.75, 0.9, 0.95], s: 0.3 },
  ice: { a: [0.01, 0.02, 0.02, 0.03], s: 0.05 },
  water: { a: [0.01, 0.01, 0.02, 0.02], s: 0.02 },
};

/** Flat per-material-id tables (α: 4 per id). */
const NM = MATERIALS.length;
export const ALPHA = new Float32Array(NM * 4);
export const SCATTER = new Float32Array(NM);
export const POROUS = new Float32Array(NM);
export const DENSITY = new Float32Array(NM);
for (let id = 0; id < NM; id++) {
  const m = MATERIALS[id];
  const A = ACOUSTIC[m.name] ?? ACOUSTIC.default;
  for (let b = 0; b < 4; b++) ALPHA[id * 4 + b] = A.a[b];
  SCATTER[id] = A.s;
  POROUS[id] = A.p ?? 0;
  DENSITY[id] = m.density;
}
const ID_WATER = MAT.water ?? 0;
const ID_GROUND = MAT.soil ?? 0;

/** Deterministic random numbers (mulberry32). */
export function rng32(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** N unit directions spread evenly over the sphere (Fibonacci), turned by `twist` (radians). */
export function sphereDirections(N, twist = 0) {
  const out = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (2 * (i + 0.5)) / N;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * ga + twist;
    out.push([r * Math.cos(th), y, r * Math.sin(th)]);
  }
  return out;
}

/**
 * One ray through the voxel grid (Amanatides–Woo). Returns a hit { t, id, n: [nx,ny,nz], i }
 * (`i` the voxel, -1 for the sea or the ground beyond the grid) or null when it escapes (to the
 * sky, off the world, beyond maxDist). Porous voxels (foliage, grass) let the ray in for ~1/σ m.
 * The sea (world.sea: { level, box, ship? }) is a water plane outside a ship's box; below the
 * grid, and beyond it, the ground is a plane at y = 0. `skipFirst`: ignore the voxel it starts in.
 */
export function castRay(world, o, d, maxDist = 150, skipFirst = true) {
  const h = world.h;
  const nx = world.nx, ny = world.ny, nz = world.nz;
  const S = [nx * h, ny * h, nz * h];
  const sea = world.sea && !world.vacuum ? world.sea : null;
  // where it meets the water plane / the ground plane (outside the voxels)
  const seaHitAt = (t) => {
    if (!sea || d[1] >= 0 || o[1] <= sea.level) return Infinity;
    const ts = (sea.level - o[1]) / d[1];
    if (ts < t - 1e-9 || ts > maxDist) return Infinity;
    if (sea.ship) {
      const x = o[0] + d[0] * ts, z = o[2] + d[2] * ts;
      const B = sea.box;
      if (x >= B[0] && x <= B[2] && z >= B[1] && z <= B[3]) return Infinity;
    }
    return ts;
  };
  const groundAt = () => (d[1] < 0 && o[1] > 0 ? -o[1] / d[1] : Infinity);
  const outside = (tFrom) => {
    const ts = seaHitAt(tFrom);
    if (ts < Infinity) return { t: ts, id: ID_WATER, n: [0, 1, 0], i: -1 };
    const tg = groundAt();
    if (!sea && tg >= tFrom && tg <= maxDist) return { t: tg, id: ID_GROUND, n: [0, 1, 0], i: -1 };
    return null;
  };
  // clip to the grid's box
  let t0 = 0, t1 = maxDist;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-12) {
      if (o[a] < 0 || o[a] > S[a]) return outside(0);
    } else {
      const ta = (0 - o[a]) / d[a], tb = (S[a] - o[a]) / d[a];
      t0 = Math.max(t0, Math.min(ta, tb));
      t1 = Math.min(t1, Math.max(ta, tb));
    }
  }
  if (t0 > t1) return outside(0);
  const inside0 = t0 === 0;
  const p0 = o[0] + d[0] * (t0 + 1e-7), p1 = o[1] + d[1] * (t0 + 1e-7), p2 = o[2] + d[2] * (t0 + 1e-7);
  let x = Math.min(nx - 1, Math.max(0, Math.floor(p0 / h)));
  let y = Math.min(ny - 1, Math.max(0, Math.floor(p1 / h)));
  let z = Math.min(nz - 1, Math.max(0, Math.floor(p2 / h)));
  const sx = d[0] > 0 ? 1 : -1, sy = d[1] > 0 ? 1 : -1, sz = d[2] > 0 ? 1 : -1;
  const inv = (v) => (Math.abs(v) < 1e-12 ? Infinity : 1 / Math.abs(v));
  const dx = inv(d[0]) * h, dy = inv(d[1]) * h, dz = inv(d[2]) * h;
  const next = (pc, cell, s, dv) => (Math.abs(dv) < 1e-12 ? Infinity : t0 + (((s > 0 ? cell + 1 : cell) * h - pc) / dv));
  let tx = next(p0, x, sx, d[0]), ty = next(p1, y, sy, d[1]), tz = next(p2, z, sz, d[2]);
  // the face it came in by (for a ray entering from outside the grid)
  let axis = -1;
  if (!inside0) {
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-12) continue;
      const ta = (0 - o[a]) / d[a], tb = (S[a] - o[a]) / d[a];
      if (Math.abs(Math.min(ta, tb) - t0) < 1e-9) axis = a;
    }
  }
  const mat = world.mat, flags = world.flags;
  const nxy = nx * ny;
  let t = t0;
  let tau = 0;
  let first = skipFirst && inside0;
  const tSea = seaHitAt(0);
  const normal = (a) => {
    const n = [0, 0, 0];
    if (a >= 0) n[a] = -(a === 0 ? sx : a === 1 ? sy : sz);
    else { n[0] = -d[0]; n[1] = -d[1]; n[2] = -d[2]; }
    return n;
  };
  for (;;) {
    const tNext = Math.min(tx, ty, tz);
    if (t > maxDist) return null;
    const i = x + nx * y + nxy * z;
    const m = mat[i];
    if (m && !first && !(flags[i] & F_HIDDEN)) {
      const sig = POROUS[m];
      if (sig > 0) {
        tau += sig * (Math.min(tNext, maxDist) - t);
        if (tau >= 1) return { t, id: m, n: normal(axis), i, porous: true };
      } else return { t, id: m, n: normal(axis), i };
    } else if (!m && tSea <= tNext && tSea >= t - 1e-9) return { t: tSea, id: ID_WATER, n: [0, 1, 0], i: -1 };
    first = false;
    if (tNext >= t1) {
      // leaving the grid: by the bottom onto the ground, else out (the sea, the ground beyond)
      if (ty === tNext && sy < 0 && y === 0) return { t: tNext, id: ID_GROUND, n: [0, 1, 0], i: -1 };
      return outside(tNext);
    }
    if (tNext === tx) { x += sx; tx += dx; axis = 0; }
    else if (tNext === ty) { y += sy; ty += dy; axis = 1; }
    else { z += sz; tz += dz; axis = 2; }
    t = tNext;
    if (y < 0) return { t, id: ID_GROUND, n: [0, 1, 0], i: -1 };
    if (x < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return outside(t);
  }
}

/** A direction around the normal n, cosine-weighted (diffuse reflection). */
function diffuse(n, rnd) {
  const u = rnd(), v = rnd();
  const r = Math.sqrt(u), th = 2 * Math.PI * v;
  const a = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const t1 = norm(cross(a, n));
  const t2 = cross(n, t1);
  const k = Math.sqrt(Math.max(0, 1 - u));
  return norm([t1[0] * r * Math.cos(th) + t2[0] * r * Math.sin(th) + n[0] * k, t1[1] * r * Math.cos(th) + t2[1] * r * Math.sin(th) + n[1] * k, t1[2] * r * Math.cos(th) + t2[2] * r * Math.sin(th) + n[2] * k]);
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * Follow one ray from p in direction dir for up to `bounces` reflections. Returns its record:
 * the first hit (distance, material, normal, porous), the energy left per band after the bounces
 * (0 once it escaped), the time it took (to its last reflection) and how many it made.
 */
export function traceRay(world, p, dir, o = {}, rnd = Math.random) {
  const K = o.bounces ?? 4;
  const maxDist = o.maxDist ?? 150;
  const e = [1, 1, 1, 1];
  let len = 0;
  let hits = 0;
  let first = null;
  let org = p;
  let d = dir;
  for (let k = 0; k < K; k++) {
    const hit = castRay(world, org, d, maxDist, k === 0);
    if (!hit) {
      e[0] = e[1] = e[2] = e[3] = 0;
      break;
    }
    if (k === 0) first = { t: hit.t, id: hit.id, n: hit.n, porous: !!hit.porous };
    len += hit.t;
    hits++;
    for (let b = 0; b < 4; b++) e[b] *= 1 - ALPHA[hit.id * 4 + b];
    const hp = [org[0] + d[0] * hit.t, org[1] + d[1] * hit.t, org[2] + d[2] * hit.t];
    const n = hit.n;
    const s = hit.porous ? 1 : SCATTER[hit.id];
    let nd;
    if (rnd() < s) nd = diffuse(n, rnd);
    else {
      const k2 = 2 * dot(d, n);
      nd = [d[0] - k2 * n[0], d[1] - k2 * n[1], d[2] - k2 * n[2]];
    }
    const off = world.h * 0.02;
    org = [hp[0] + n[0] * off, hp[1] + n[1] * off, hp[2] + n[2] * off];
    d = nd;
  }
  return { dir, first, e, time: len / C_SOUND, len, hits };
}

/**
 * The space around p from ray records (traceRay): volume, area, mean free path, openness,
 * absorption, clutter, RT60 per band, reflectors.
 */
export function summarize(recs, o = {}) {
  const N = recs.length;
  const out = { rays: N, openness: 1, volume: 0, area: 0, mfp: 0, alpha: [0, 0, 0, 0], scatter: 0, clutter: 0, rt60: [0, 0, 0, 0], reflectors: [] };
  if (!N) return out;
  let open = 0, V = 0, S = 0, nHit = 0, scat = 0, clut = 0;
  const alpha = [0, 0, 0, 0];
  const E = [0, 0, 0, 0];
  let T = 0;
  const side = [];
  for (const r of recs) {
    for (let b = 0; b < 4; b++) E[b] += r.e[b];
    T += r.time;
    const f = r.first;
    if (!f) {
      open++;
      continue;
    }
    nHit++;
    V += f.t ** 3;
    const c = Math.abs(dot(r.dir, f.n));
    S += (f.t * f.t) / Math.max(0.3, c);
    for (let b = 0; b < 4; b++) alpha[b] += ALPHA[f.id * 4 + b];
    const sc = f.porous ? 1 : SCATTER[f.id];
    scat += sc;
    if (!(f.n[1] > 0.9)) side.push({ t: f.t, sc, porous: f.porous });
  }
  out.openness = open / N;
  out.volume = ((4 * Math.PI) / 3) * (V / N);
  out.area = ((4 * Math.PI) / N) * S;
  out.mfp = out.area > 0 ? (4 * out.volume) / out.area : 0;
  if (nHit) {
    out.alpha = alpha.map((a) => a / nHit);
    out.scatter = scat / nHit;
  }
  // clutter: of the hits off the floor, the share on scattering things (foliage, furniture, bones)
  // or much nearer than the rest (an object standing in the space)
  if (side.length) {
    const ts = side.map((s) => s.t).sort((a, b) => a - b);
    const med = ts[ts.length >> 1];
    for (const s of side) if (s.porous || s.sc >= 0.5 || s.t < 0.35 * med) clut++;
    out.clutter = clut / side.length;
  }
  // the decay: the energy left after the bounces (escaped rays: none) over the time they took
  T /= N;
  for (let b = 0; b < 4; b++) {
    const Eb = E[b] / N;
    if (!nHit || T <= 0) {
      out.rt60[b] = 0;
      continue;
    }
    const lam = -Math.log(Math.max(Eb, 1e-6)) / T + C_SOUND * AIR_M[b];
    out.rt60[b] = Math.min(o.maxRt ?? 8, 13.8 / lam);
  }
  out.reflectors = reflectors(recs, N);
  return out;
}

/** Group the first hits into planes (normal, perpendicular distance): walls, floor, a cliff. */
function reflectors(recs, N) {
  const groups = new Map();
  for (const r of recs) {
    const f = r.first;
    if (!f || f.porous) continue;
    const dp = f.t * Math.abs(dot(r.dir, f.n));
    if (dp < 0.05) continue;
    const ax = Math.abs(f.n[0]) > 0.5 ? (f.n[0] > 0 ? 0 : 1) : Math.abs(f.n[1]) > 0.5 ? (f.n[1] > 0 ? 2 : 3) : f.n[2] > 0 ? 4 : 5;
    const key = ax * 1000 + Math.round(Math.log(dp) / 0.1);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { n: f.n, count: 0, dsum: 0, a: [0, 0, 0, 0] }));
    g.count++;
    g.dsum += dp;
    for (let b = 0; b < 4; b++) g.a[b] += ALPHA[f.id * 4 + b];
  }
  const out = [];
  for (const g of groups.values()) {
    const dist = g.dsum / g.count;
    out.push({ dist, dir: [-g.n[0], -g.n[1], -g.n[2]], cover: g.count / N, alpha: g.a.map((a) => a / g.count), delay: (2 * dist) / C_SOUND });
  }
  return out.sort((a, b) => b.cover - a.cover);
}

/** Probe the space around p synchronously (tests, a first estimate): N rays, `bounces` each. */
export function probeSpace(world, p, o = {}) {
  const rnd = rng32(o.seed ?? 7);
  const dirs = sphereDirections(o.rays ?? 192, rnd() * Math.PI * 2);
  const recs = dirs.map((d) => traceRay(world, p, d, o, rnd));
  return summarize(recs, o);
}

/**
 * The probe amortised over frames: step() traces `perFrame` rays around the listener; each full
 * sweep (turned a little every time, so the directions do not alias) gives a new summary.
 */
export class AcousticProbe {
  constructor(o = {}) {
    this.o = { rays: 128, bounces: 4, maxDist: 150, perFrame: 12, ...o };
    this.rnd = rng32(o.seed ?? 11);
    this.recs = [];
    this.cursor = 0;
    this.dirs = sphereDirections(this.o.rays, 0);
    this.result = null;
    this.from = null;
    this.sweeps = 0;
  }

  /** Trace the next rays from p; returns the new summary when a sweep completes, else null. */
  step(world, p, perFrame = this.o.perFrame) {
    if (!world?.mat) return null;
    // moved far since the sweep began (a teleport, a new place): start afresh
    if (this.from && Math.hypot(p[0] - this.from[0], p[1] - this.from[1], p[2] - this.from[2]) > 6) this.reset();
    if (!this.from) this.from = p.slice();
    for (let k = 0; k < perFrame; k++) {
      this.recs[this.cursor] = traceRay(world, p, this.dirs[this.cursor], this.o, this.rnd);
      this.cursor++;
      if (this.cursor >= this.dirs.length) {
        this.result = summarize(this.recs, this.o);
        this.sweeps++;
        this.cursor = 0;
        this.recs = [];
        this.from = p.slice();
        this.dirs = sphereDirections(this.o.rays, this.rnd() * Math.PI * 2);
        return this.result;
      }
    }
    return null;
  }

  reset() {
    this.recs = [];
    this.cursor = 0;
    this.from = null;
  }
}

/** Rough reference distance for "a source near you" (direct/reverberant level), m. */
export const R_NEAR = 2;

/**
 * What the renderer needs from a probe summary: rt60 per band, pre-delay (s), early reflections
 * [{ delay, gain, dir }], echoes [{ delay, gain, dir, cutoff, dist }], diffusion 0..1, the
 * reverberant energy relative to the direct sound of a source R_NEAR away (wet), the critical
 * distance rc (m).
 */
export function spaceParams(sum) {
  const rt = sum.rt60.slice();
  const rtMid = (rt[1] + rt[2]) / 2;
  const V = Math.max(1, sum.volume);
  const rc = Math.min(100, Math.max(0.25, 0.057 * Math.sqrt(V / Math.max(0.05, rtMid))));
  const wet = rtMid > 0.02 ? Math.min(1.5, (R_NEAR / rc) ** 2) : 0;
  const diffusion = Math.min(1, 0.15 + 0.5 * sum.scatter + 0.5 * sum.clutter);
  const predelay = Math.min(0.08, Math.max(0.004, sum.mfp / C_SOUND));
  const refl = sum.reflectors.map((r) => {
    const a = (r.alpha[1] + r.alpha[2]) / 2;
    const gain = Math.sqrt(1 - a) * (R_NEAR / (R_NEAR + 2 * r.dist)) * Math.sqrt(Math.min(1, r.cover / 0.08));
    return { ...r, gain };
  });
  const early = refl.filter((r) => r.delay <= 0.1 && r.gain > 0.01).sort((a, b) => b.gain - a.gain).slice(0, 10).map((r) => ({ delay: r.delay, gain: r.gain, dir: r.dir, dist: r.dist }));
  // discrete echoes: big reflectors far enough to be heard apart (≥ ~70 ms), in the open
  const echoes = sum.openness < 0.15 ? [] : refl
    .filter((r) => r.delay >= 0.07 && r.cover >= 0.01)
    .map((r) => ({ delay: r.delay, dist: r.dist, dir: r.dir, gain: Math.min(0.5, 1.6 * r.gain), cutoff: Math.max(1500, 16000 / (1 + (2 * r.dist) / 120)) }))
    .sort((a, b) => b.gain - a.gain)
    .slice(0, 3);
  return { rt60: rt, rtMid, predelay, early, echoes, diffusion, wet, rc, volume: sum.volume, openness: sum.openness, mfp: sum.mfp, clutter: sum.clutter };
}

/**
 * How much of the sound gets to the listener at b from a source at a through what is between
 * (3D DDA through the voxels): the mass per area of the solid voxels crossed (mass law, at
 * 500 Hz), a flanking / diffraction floor (it gets round, less the thicker), foliage a little.
 * Solids within `skip` m of either end are ignored (a sound on a wall, the listener's own head).
 * Returns { gain, cutoff, thickness (m solid), walls (solid runs crossed), foliage (m) }.
 */
export function occlusion(world, a, b, skip = 0.35) {
  const D = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const L = Math.hypot(D[0], D[1], D[2]);
  const res = { gain: 1, cutoff: 20000, thickness: 0, walls: 0, foliage: 0 };
  if (!world?.mat || L < 2 * skip + 1e-6) return res;
  const d = [D[0] / L, D[1] / L, D[2] / L];
  const h = world.h;
  const step = h * 0.5;
  let mass = 0, inSolid = false;
  const mat = world.mat, flags = world.flags, dens = world.dens;
  // half-voxel steps are plenty for this (and robust at the edges of the grid)
  for (let t = skip; t <= L - skip; t += step) {
    const x = Math.floor((a[0] + d[0] * t) / h), y = Math.floor((a[1] + d[1] * t) / h), z = Math.floor((a[2] + d[2] * t) / h);
    if (x < 0 || y < 0 || z < 0 || x >= world.nx || y >= world.ny || z >= world.nz) { inSolid = false; continue; }
    const i = x + world.nx * (y + world.ny * z);
    const m = mat[i];
    if (!m || (flags[i] & F_HIDDEN)) { inSolid = false; continue; }
    if (POROUS[m] > 0) { res.foliage += step; inSolid = false; continue; }
    mass += DENSITY[m] * (dens ? dens[i] : 1) * step;
    res.thickness += step;
    if (!inSolid) res.walls++;
    inSolid = true;
  }
  if (res.walls) {
    const tl = Math.max(0, 20 * Math.log10(Math.max(1e-9, mass * 500)) - 47);
    const tx = 10 ** (-tl / 20);
    const flank = 0.22 / (1 + 0.6 * (res.walls - 1)) / (1 + res.thickness / 3);
    res.gain = Math.max(tx, flank);
    res.cutoff = Math.min(20000, 250 + 1500 * (res.gain / 0.22));
  }
  if (res.foliage > 0) {
    // ~0.5 dB per metre of foliage, the highs more
    res.gain *= 10 ** (-(0.5 * res.foliage) / 20);
    res.cutoff = Math.min(res.cutoff, Math.max(1500, 20000 * Math.exp(-res.foliage / 6)));
  }
  return res;
}

/** The send level of a source d metres away (its reverberant share grows with distance). */
export function sendLevel(d, rNear = R_NEAR) {
  return Math.min(5, Math.max(1, d / rNear));
}

/* ---------------- the impulse response ---------------- */

/** RBJ biquad coefficients. */
function biquad(type, f, q, sr) {
  const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr;
  const c = Math.cos(w), s = Math.sin(w), al = s / (2 * q);
  let b0, b1, b2;
  if (type === 'lowpass') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
  else if (type === 'highpass') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
  else { b0 = al; b1 = 0; b2 = -al; } // bandpass (0 dB peak)
  const a0 = 1 + al;
  return [b0 / a0, b1 / a0, b2 / a0, (-2 * c) / a0, (1 - al) / a0];
}
/** Filter x in place (n samples) with a biquad. */
export function filterInPlace(x, n, co) {
  const [b0, b1, b2, a1, a2] = co;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < n; i++) {
    const v = x[i];
    const y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = y;
    x[i] = y;
  }
}
const BAND_FILTERS = [
  [['lowpass', 250, 0.707]],
  [['highpass', 250, 0.707], ['lowpass', 1000, 0.707]],
  [['highpass', 1000, 0.707], ['lowpass', 4000, 0.707]],
  [['highpass', 4000, 0.707]],
];
export function bandFilters(band, sr) {
  return BAND_FILTERS[band].map(([t, f, q]) => biquad(t, f, q, sr));
}

/**
 * A stereo impulse response: { left, right, length, sampleRate }. p: { rt60: [4], predelay,
 * early: [{ delay, gain, pan (-1..1) }], diffusion 0..1, wet (energy of the late part), maxLength
 * (s) }. The late part: per band, noise that starts sparse (few, distinct reflections) and grows
 * dense (sooner the more diffuse the space), band-filtered and decaying at that band's RT60
 * (60 dB in rt60 s); its energy scaled to `wet`. The early reflections as taps (equal-power pan).
 */
export function impulseResponse(p, sampleRate = 48000, seed = 1) {
  const g = impulseResponseSteps(p, sampleRate, seed);
  for (;;) {
    const s = g.next();
    if (s.done) return s.value;
  }
}

/**
 * impulseResponse() as a generator: it yields after each band of each channel (8 steps), so a
 * long IR can be made over a few frames; its return value is the IR.
 */
export function* impulseResponseSteps(p, sampleRate = 48000, seed = 1) {
  const rnd = rng32(seed);
  const sr = sampleRate;
  const rt = p.rt60.map((r) => Math.max(0.02, r));
  const pre = Math.max(0, p.predelay ?? 0.01);
  const diff = Math.min(1, Math.max(0, p.diffusion ?? 0.5));
  const maxRt = Math.max(...rt);
  const lateLen = Math.min(p.maxLength ?? 5, maxRt * 1.15);
  const earlyEnd = Math.max(0, ...(p.early ?? []).map((e) => e.delay));
  const length = Math.max(64, Math.ceil((Math.max(pre + lateLen, earlyEnd + 0.01)) * sr));
  const chans = [new Float32Array(length), new Float32Array(length)];
  const tmp = new Float32Array(length);
  const n0 = Math.floor(pre * sr);
  // echo density: from ~ (300..2500)/s at the start to dense within (1 - diffusion)·0.2 + 0.02 s
  const dens0 = 300 + 2200 * diff;
  const tDense = 0.02 + (1 - diff) * 0.2;
  const build = Math.max(0.002, 0.004 + (1 - diff) * 0.02); // onset ramp, s
  for (let ch = 0; ch < 2; ch++) {
    const out = chans[ch];
    for (let b = 0; b < 4; b++) {
      const nb = Math.min(length, n0 + Math.ceil(rt[b] * 1.35 * sr)); // to −80 dB
      tmp.fill(0, 0, nb);
      const r = Math.exp(-6.9078 / rt[b] / sr); // the envelope's decay per sample
      let env = 1;
      for (let i = n0; i < nb; i++, env *= r) {
        if (((i - n0) & 0xffff) === 0xffff) yield -1; // (a pause every 64k samples)
        const t = (i - n0) / sr;
        if (t >= tDense) {
          tmp[i] = (rnd() * 2 - 1) * 1.7320508 * env * (t < build ? (t + 1 / sr) / build : 1);
          continue;
        }
        const pr = Math.min(1, (dens0 + (sr - dens0) * (t / tDense) ** 2) / sr);
        if (rnd() >= pr) continue;
        tmp[i] = ((rnd() < 0.5 ? -1 : 1) / Math.sqrt(pr)) * env * Math.min(1, (t + 1 / sr) / build);
      }
      yield -1;
      for (const co of bandFilters(b, sr)) filterInPlace(tmp, nb, co);
      for (let i = 0; i < nb; i++) out[i] += tmp[i];
      yield b + 4 * ch;
    }
  }
  // scale the late part to the asked energy (mean of the two channels)
  let e = 0;
  for (let i = 0; i < length; i++) e += chans[0][i] ** 2 + chans[1][i] ** 2;
  e /= 2;
  const g = e > 0 ? Math.sqrt((p.wet ?? 1) / e) : 0;
  for (const c of chans) for (let i = 0; i < length; i++) c[i] *= g;
  // the early reflections
  for (const r of p.early ?? []) {
    const i = Math.round(r.delay * sr);
    if (i >= length) continue;
    const th = ((Math.max(-1, Math.min(1, r.pan ?? 0)) + 1) * Math.PI) / 4;
    const gl = r.gain * Math.cos(th) * Math.SQRT2, gr = r.gain * Math.sin(th) * Math.SQRT2;
    // smeared over a few samples the rougher the surfaces are
    const w = 1 + Math.round(diff * 3);
    for (let j = 0; j < w && i + j < length; j++) {
      chans[0][i + j] += gl / w;
      chans[1][i + j] += gr / w;
    }
  }
  return { left: chans[0], right: chans[1], length, sampleRate: sr };
}

/** RT60 measured from an IR channel (Schroeder backward integration, a T20 fit −5…−25 dB). */
export function measureRt60(x, sr) {
  const n = x.length;
  const sch = new Float64Array(n);
  let acc = 0;
  for (let i = n - 1; i >= 0; i--) {
    acc += x[i] * x[i];
    sch[i] = acc;
  }
  const tot = sch[0] || 1;
  let i5 = -1, i25 = -1;
  for (let i = 0; i < n; i++) {
    const db = 10 * Math.log10(sch[i] / tot);
    if (i5 < 0 && db <= -5) i5 = i;
    if (db <= -25) {
      i25 = i;
      break;
    }
  }
  if (i5 < 0 || i25 < 0) return NaN;
  return ((i25 - i5) / sr) * 3;
}

/** A short line on the measured space (for the Sound menu). */
export function describeSpace(P) {
  if (!P) return 'no measurement yet';
  const open = P.openness;
  const vol = open > 0.4 ? 'open air' : `${P.volume < 1000 ? P.volume.toFixed(0) : (P.volume / 1000).toFixed(1) + 'k'} m³`;
  const rt = P.rt60.map((r) => r.toFixed(2)).join('/');
  const ech = P.echoes?.length ? ` · echo ${P.echoes.map((e) => (e.delay * 1000).toFixed(0)).join(',')} ms` : '';
  return `${vol} · RT60 ${rt} s · open ${(open * 100).toFixed(0)}% · clutter ${(P.clutter * 100).toFixed(0)}%${ech}`;
}
