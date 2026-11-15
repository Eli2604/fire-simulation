import { MATERIALS, MAT } from './materials.js';
import { F_ANCHOR, F_LIQUID } from './world.js';
import { massOf, wheelPoints, G } from './carPhysics.js';
import { iceBears } from './ice.js';

/**
 * What wheels and keels do to the ground and the ground to them: grip, sinkage, resistance,
 * ruts, tracks in the snow, spray, a boat's furrow and wake.
 *
 * 1. The surface (surfaceAt): from the voxel under a wheel (its material, its moisture, its
 *    temperature), the snow lying on it (sim/snow.js: depth and density), lake ice (sim/ice.js),
 *    the water over it (a flooded column, a puddle's runoff, the water in a rut) and the rain
 *    falling now: one of the kinds of SURFACE with
 *      - a peak and a sliding friction coefficient (μ): dry asphalt 1.0 / 0.8, rock 0.9, gravel
 *        0.62, dry turf 0.6, wet grass 0.38, mud 0.3 (soaked 0.2), snow 0.22, ice 0.1;
 *        wet hard surfaces and a film of water lose some, more at speed (aquaplaning);
 *      - Bekker's pressure-sinkage law p = (k_c/b + k_φ)·zⁿ for what gives under a wheel (soil,
 *        mud, sand, ash, snow, turf), moisture moving it from firm (dry soil) to soft (mud,
 *        soaked mud: k_φ 400 → 60); frozen soil and mud do not give (and are slick when glazed).
 * 2. A wheel on it (wheelOn): a rigid wheel's sinkage under its load (Bekker: z₀ =
 *    [3W / ((3−n)(k_c + b·k_φ)√D)]^(2/(2n+1))), less for a tyre that flattens (×0.6); its
 *    compaction resistance R_c = (k_c + b·k_φ)·z^(n+1)/(n+1) (the work of pressing the rut, per
 *    metre; for a tyre ×0.35, its own hysteresis being carPhysics' C_rr) for what is pressed anew, bulldozing (½γz²bK_p) when it is deep, and the drag of
 *    the rut it runs in (deeper ruts in soft stuff: more). Snow gives only as far as it packs
 *    (to ~550 kg/m³). → its μ (peak while it grips, sliding as it spins or slides), the
 *    rolling-resistance coefficient, the sinkage, the height its tyre stands at.
 *       surfaceGrip(world, x, z, wheelState)  the same for any wheel (the drivetrains' tyres)
 * 3. A car (sim/cars.js): env.ground under each wheel is wheelContact (the rut's and the
 *    sinkage's height, the μ); groundDrag each sub-step (the soil's resistance, a high-centred
 *    belly's drag, the rut's walls steering the wheel into it); groundWork each frame:
 *      - ruts: the ground under each wheel's path pressed down (marks: a field of 10 cm cells
 *        over the voxels, rut depth and the berm pushed up beside it, persisting), deeper with
 *        each pass (soft ground is pushed aside as well as pressed), dug out by a spinning
 *        wheel (and thrown behind it: spray of mud, sand, gravel, snow, water);
 *      - the snow field pressed (packed, thinner) under the tyres and ploughed by the belly;
 *      - grass: tall blades flattened (gone) under the wheels, the turf torn to soil where it
 *        is worn (spinning, sliding, passes);
 *      - puddles and the water in ruts splash; rain fills ruts;
 *      - c.ground: { surface, mu, spin (m/s of wheelspin), slip, sink, rut, belly, stuck, rr }
 *        for the HUD, the sound (audio/carSound.js) and the AI.
 *    Wheelspin comes out of the tyre model with the low μ (the driven wheels spin up, drawn
 *    turning: render/cars.js), and so does the drift (the friction circle); high-centred
 *    (sinkage beyond the clearance) the belly carries the car: little grip, much drag: stuck.
 * 4. A boat (sim/buoyancy.js stepFloats → boatGround): its keel on a soft bed (sand, mud, soil
 *    under water) ploughs a furrow there, the bed resists (friction, ploughing), it slows and
 *    stops; the furrow lowers the bottom it lies on. Its wake: foam spreading from the bow's
 *    shoulders and the stern on the water (render/groundMarks.js).
 */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

/** Surface kinds: friction, Bekker (n, kc kN/m^(n+1), kphi kN/m^(n+2)), how it ruts and what it throws. */
export const SURFACE = {
  asphalt: { label: 'asphalt / concrete', muPeak: 1.0, muSlide: 0.8 },
  rock: { label: 'rock', muPeak: 0.9, muSlide: 0.72 },
  wood: { label: 'wood', muPeak: 0.7, muSlide: 0.55 },
  metal: { label: 'metal', muPeak: 0.6, muSlide: 0.45 },
  gravel: { label: 'gravel', muPeak: 0.62, muSlide: 0.52, bek: { n: 0.9, kc: 10, kphi: 3000 }, keep: 0.5, pass: 0.06, dig: 0.006, soft: 0.25, gamma: 17, spray: [0.5, 0.49, 0.46] },
  soil: { label: 'dry soil', muPeak: 0.7, muSlide: 0.58, bek: { n: 0.9, kc: 50, kphi: 6000 }, keep: 0.6, pass: 0.08, dig: 0.008, soft: 0.3, gamma: 16, spray: [0.4, 0.31, 0.21] },
  soilWet: { label: 'wet soil', muPeak: 0.5, muSlide: 0.38, bek: { n: 0.4, kc: 11.4, kphi: 808 }, keep: 0.75, pass: 0.12, dig: 0.014, soft: 0.6, gamma: 17, spray: [0.3, 0.23, 0.15] },
  grass: { label: 'turf', muPeak: 0.6, muSlide: 0.5, bek: { n: 0.8, kc: 30, kphi: 3200 }, keep: 0.5, pass: 0.05, dig: 0.006, soft: 0.25, gamma: 15, spray: [0.3, 0.38, 0.16] },
  grassWet: { label: 'wet grass', muPeak: 0.38, muSlide: 0.26, bek: { n: 0.6, kc: 18, kphi: 1600 }, keep: 0.6, pass: 0.08, dig: 0.01, soft: 0.4, gamma: 16, spray: [0.28, 0.33, 0.15] },
  mud: { label: 'mud', muPeak: 0.3, muSlide: 0.2, bek: { n: 0.5, kc: 4, kphi: 400 }, keep: 0.85, pass: 0.18, dig: 0.025, soft: 1, gamma: 15, spray: [0.25, 0.19, 0.12] },
  sand: { label: 'dry sand', muPeak: 0.55, muSlide: 0.5, bek: { n: 1.1, kc: 0.99, kphi: 1528 }, keep: 0.8, pass: 0.12, dig: 0.02, soft: 0.8, gamma: 15, spray: [0.78, 0.7, 0.52] },
  sandWet: { label: 'wet sand', muPeak: 0.62, muSlide: 0.52, bek: { n: 0.75, kc: 5.3, kphi: 1515 }, keep: 0.75, pass: 0.08, dig: 0.012, soft: 0.5, gamma: 18, spray: [0.6, 0.52, 0.38] },
  tephra: { label: 'volcanic ash and cinders', muPeak: 0.5, muSlide: 0.42, bek: { n: 1.0, kc: 1, kphi: 900 }, keep: 0.8, pass: 0.12, dig: 0.02, soft: 0.8, gamma: 11, spray: [0.24, 0.22, 0.21] },
  snow: { label: 'snow', muPeak: 0.22, muSlide: 0.15, bek: { n: 1.6, kc: 4.37, kphi: 196.7 }, keep: 1, pass: 0, dig: 0.03, soft: 0.6, gamma: 2.5, spray: [0.95, 0.96, 0.98] },
  frozen: { label: 'frozen ground', muPeak: 0.5, muSlide: 0.4 },
  ice: { label: 'ice', muPeak: 0.1, muSlide: 0.06 },
};

/** Which kind a voxel material is (by name); a material not here is rigid, with its car grip. */
const KIND_OF = {
  concrete: 'asphalt', asphalt: 'asphalt', stone: 'asphalt', ashlar: 'asphalt', brick: 'asphalt', tiles: 'asphalt',
  hillRock: 'rock', basalt: 'rock', bedrock: 'rock', sandstone: 'rock', granite: 'rock',
  wood: 'wood', oak: 'wood', pine: 'wood', steel: 'metal', aluminium: 'metal', iron: 'metal',
  soil: 'soil', grass: 'grass', mud: 'mud', beachSand: 'sand', quarrySand: 'gravel', tephra: 'tephra', ash: 'tephra', ice: 'ice',
};
const SOFT_GROUND = new Set(['soil', 'grass', 'mud', 'beachSand', 'quarrySand', 'tephra', 'ash']);
const SKIP = new Set(['leaves', 'needles', 'twigs', 'water']);
const NAME = MATERIALS.map((m) => m.name);
const KIND_M = NAME.map((n) => KIND_OF[n] ?? null);
const SKIP_M = Uint8Array.from(NAME, (n) => (SKIP.has(n) ? 1 : 0));
const SOFT_M = Uint8Array.from(NAME, (n) => (SOFT_GROUND.has(n) ? 1 : 0));

/** Tyre: a pneumatic tyre flattens and sinks (and resists) less than Bekker's rigid wheel. */
const TYRE = 0.6;
/** ... and what it costs to roll (the tyre's own hysteresis is carPhysics' C_rr): ~a third of the rigid wheel's. */
const TYRE_R = 0.35;
/** Deepest a wheel sinks or a rut goes (m): beyond it the car is on its belly anyway. */
const SINK_MAX = 0.4;
/** Cells of the marks field (m). */
export const MARK_CELL = 0.1;
const SPRAY_MAX = 1500;
const WAKE_MAX = 600;

/** A kind blended between two (a, b) by t: friction and the soil's constants (k_φ on a log scale). */
function blend(a, b, t) {
  const A = typeof a === 'string' ? SURFACE[a] : a, B = typeof b === 'string' ? SURFACE[b] : b;
  if (t <= 0) return { ...A };
  if (t >= 1) return { ...B };
  const out = { ...A, muPeak: lerp(A.muPeak, B.muPeak, t), muSlide: lerp(A.muSlide, B.muSlide, t) };
  if (A.bek && B.bek) {
    out.bek = { n: lerp(A.bek.n, B.bek.n, t), kc: lerp(A.bek.kc, B.bek.kc, t), kphi: Math.exp(lerp(Math.log(A.bek.kphi), Math.log(B.bek.kphi), t)) };
    for (const k of ['keep', 'pass', 'dig', 'soft', 'gamma']) out[k] = lerp(A[k], B[k], t);
    out.spray = A.spray.map((v, i) => lerp(v, B.spray[i], t));
  }
  out.label = t < 0.5 ? A.label : B.label;
  return out;
}

/**
 * The surface's properties for a kind in a state: { wet 0..1 (water on it / soaked), soak 0..1
 * (mud: how soaked), frozen, water (m of water over it), speed (m/s, for aquaplaning) }.
 * (Pure: the tests compare kinds by it.)
 */
export function surfaceProps(kind, st = {}) {
  const wet = clamp(st.wet ?? 0, 0, 1);
  let P;
  switch (kind) {
    case 'soil':
      P = blend('soil', 'soilWet', clamp((wet - 0.5) / 0.35, 0, 1));
      if (wet > 0.8) P = blend(P, 'mud', clamp((wet - 0.8) / 0.2, 0, 1) * 0.6);
      break;
    case 'grass':
      P = blend('grass', 'grassWet', wet);
      break;
    case 'mud': {
      const soak = clamp(st.soak ?? 0, 0, 1);
      P = { ...SURFACE.mud, bek: { ...SURFACE.mud.bek, kphi: Math.exp(lerp(Math.log(400), Math.log(60), soak)) }, muPeak: lerp(0.3, 0.2, soak), muSlide: lerp(0.2, 0.12, soak) };
      break;
    }
    case 'sand':
      P = blend('sand', 'sandWet', clamp(wet / 0.5, 0, 1));
      break;
    case 'snow': {
      // packed (trodden, driven) snow grips a little better and gives no more; fresh powder less
      const rho = st.rho ?? 200;
      const packed = clamp((rho - 250) / 300, 0, 1);
      P = { ...SURFACE.snow, muPeak: lerp(0.2, 0.25, packed) - 0.06 * wet, muSlide: lerp(0.14, 0.17, packed) - 0.05 * wet };
      break;
    }
    case 'ice':
      // wet ice (thawing, rain on it) is the slipperiest of all
      P = { ...SURFACE.ice, muPeak: lerp(0.1, 0.05, wet), muSlide: lerp(0.06, 0.03, wet) };
      break;
    default:
      P = { ...(SURFACE[kind] ?? { label: kind, muPeak: st.mu ?? 0.8, muSlide: 0.8 * (st.mu ?? 0.8) }) };
      // hard surfaces: wet loses ~25 % (asphalt 1.0 → 0.75)
      if (!P.bek && kind !== 'frozen') {
        P.muPeak *= 1 - 0.25 * wet;
        P.muSlide *= 1 - 0.3 * wet;
      }
  }
  if (st.frozen && P.bek && kind !== 'snow') {
    // frozen soil, mud, sand: hard; glazed with ice where it was wet
    P = { ...SURFACE.frozen, muPeak: lerp(0.5, 0.25, wet), muSlide: lerp(0.4, 0.17, wet), label: 'frozen ' + P.label };
  }
  // a film of water: less grip, and at speed the tyre rides up on it (aquaplaning)
  const film = st.water ?? 0;
  if (film > 0.001 && kind !== 'snow') {
    const k = clamp(film / 0.005, 0, 1);
    const plane = clamp(((st.speed ?? 0) - 14) / 14, 0, 1) * clamp(film / 0.01, 0, 1);
    const f = (1 - 0.2 * k) * (1 - 0.75 * plane);
    P.muPeak *= f;
    P.muSlide *= f;
  }
  P.kind = kind;
  return P;
}

/* ------------------------------------------------------------------ the marks: ruts, berms, furrows */

/** The marks field of a world (made when first needed): sparse 10 cm cells, kept as long as the world. */
export function marksOf(w) {
  if (w.groundMarks) return w.groundMarks;
  w.groundMarks = { cell: MARK_CELL, cells: new Map(), version: 0, spray: [], wake: [], seed: 12345, rainWet: 0, fxT: -1, wear: new Map() };
  return w.groundMarks;
}
const key = (cx, cz) => cx + cz * 65536;
function rand(M) {
  M.seed = (M.seed * 1103515245 + 12345) & 0x7fffffff;
  return M.seed / 0x7fffffff;
}

/** Rut depth (m below the ground as it was) at (x, z): 0 where nothing has passed. */
export function rutAt(w, x, z) {
  const M = w.groundMarks;
  if (!M || !M.cells.size) return 0;
  const r = M.cells.get(key(Math.floor(x / M.cell), Math.floor(z / M.cell)));
  return r ? r.d : 0;
}
/** The mark record at (x, z) (null: none). */
export function markAt(w, x, z) {
  const M = w.groundMarks;
  return M?.cells.get(key(Math.floor(x / M.cell), Math.floor(z / M.cell))) ?? null;
}
function markCell(M, cx, cz, y0, kind) {
  const k = key(cx, cz);
  let r = M.cells.get(k);
  if (!r) M.cells.set(k, (r = { cx, cz, d: 0, berm: 0, water: 0, y0, kind, passes: 0 }));
  return r;
}

/* ------------------------------------------------------------------ the ground under a point */

/**
 * The ground's top at (x, z) at or below yFrom: { y, i, material, mu } (null: none). Skips water,
 * leaves, twigs, a tree's crown, tall grass standing above the turf, the cars' own voxels (and
 * what opts.owns(i) says is the boat's).
 */
export function groundTop(w, x, z, yFrom, owns = null) {
  const h = w.h;
  const cx = Math.floor(x / h), cz = Math.floor(z / h);
  if (cx < 0 || cz < 0 || cx >= w.nx || cz >= w.nz) return null;
  let y = Math.min(w.ny - 1, Math.floor(yFrom / h));
  const yEnd = Math.max(0, Math.floor((yFrom - 8) / h));
  const own = w.carOwners;
  const grass = MAT.grass;
  for (; y >= yEnd; y--) {
    const i = cx + w.nx * (y + w.ny * cz);
    const m = w.mat[i];
    // (a liquid is no ground: spilt fuel, molten metal, bilge water; nor its own voxels, a car's)
    if (!m || SKIP_M[m] || w.flags[i] & F_LIQUID || (own && own.has(w.owner[i])) || (owns && owns(i))) continue;
    if (m === grass && y > 0 && w.mat[i - w.nx] === grass) continue; // (tall grass: the blades over the turf)
    return { y: (y + 1) * h, i, material: NAME[m], mu: null };
  }
  return null;
}

/** How deep the soft ground goes under voxel i (m; the world's bottom layer: the earth goes on). */
function softDepth(w, i) {
  const nx = w.nx;
  let y = Math.floor(i / nx) % w.ny;
  let d = 0;
  for (let k = 0, j = i; k < 6; k++, j -= nx, y--) {
    if (!SOFT_M[w.mat[j]]) return d;
    d += w.h;
    if (y === 0) return SINK_MAX + 0.2; // (the bottom of the world: the ground goes on down)
  }
  return d;
}

/**
 * The surface at a ground point g (groundTop / cars' voxelGround: { y, i, material, mu }) at (x, z):
 * its kind and properties (surfaceProps), what lies on it (snow, ice, water), the height its top is
 * at, and how deep it can give. opts: { speed, load (kg on the ice) }.
 */
export function surfaceAt(w, g, x, z, opts = {}) {
  const h = w.h;
  const M = w.groundMarks;
  const i = g.i ?? -1;
  const name = g.material ?? (i >= 0 ? NAME[w.mat[i]] : 'concrete');
  const m = i >= 0 ? w.mat[i] : 0;
  let kind = (i >= 0 ? KIND_M[m] : KIND_OF[name]) ?? null;
  const out = { kind: kind ?? 'other', material: name, y: g.y, i, snow: null, ice: false, water: 0, frozen: false, wet: 0, soft: 0, rut: 0, mark: null };
  const cx = Math.floor(x / h), cz = Math.floor(z / h);
  const col = cx + w.nx * cz;
  // lake ice over the water the voxels skipped (if it bears the load)
  const I = w.ice;
  if (I && col >= 0 && col < I.thick.length && I.thick[col] > 0.03 && I.surf[col] > g.y && iceBears(I.thick[col]) >= (opts.load ?? 400)) {
    out.kind = 'ice';
    out.ice = true;
    out.y = I.surf[col];
    Object.assign(out, surfaceProps('ice', { wet: (w.temp?.[i] ?? 0) > 0 ? 0.6 : 0 }));
    out.kind = 'ice';
    return out;
  }
  // snow lying on it
  const S = w.snow;
  if (S) {
    const j = S.cell(x, z);
    if (j >= 0 && S.depth[j] > 0.005 && Math.abs(S.base[j] - g.y) < h * 1.1) {
      out.snow = { j, depth: S.depth[j], rho: S.rho[j], base: S.base[j] };
      out.y = S.base[j] + S.depth[j];
    }
  }
  // the water over it: flooded voxels, a puddle (runoff), the water in a rut
  let water = 0;
  if (i >= 0) {
    for (let k = 1, j = i + w.nx; k < 12 && j < w.N && (j / w.nx | 0) % w.ny !== 0; k++, j += w.nx) {
      if (w.mat[j] !== MAT.water) break;
      water += h;
    }
    if (!water && w.runoff && col >= 0) water = (w.runoff[col] ?? 0) / (1000 * h * h);
  }
  const mark = M?.cells.size ? M.cells.get(key(Math.floor(x / MARK_CELL), Math.floor(z / MARK_CELL))) : null;
  if (mark) {
    out.mark = mark;
    out.rut = out.snow ? 0 : mark.d;
    water += mark.water;
  }
  out.water = water;
  // wet: the material's moisture (of what it can hold), water on it, the rain falling now
  const Mt = MATERIALS[m] ?? {};
  const rel = i >= 0 && Mt.maxMoisture ? w.moist[i] / Mt.maxMoisture : 0;
  const rain = M?.rainWet ?? 0;
  const temp = i >= 0 ? w.temp[i] : 15;
  out.frozen = !out.snow && temp < -0.5; // (the ground under snow may be frozen: the snow still gives)
  let st;
  if (out.snow) {
    kind = 'snow';
    st = { rho: out.snow.rho, wet: temp > 0 ? 0.5 : 0 };
  } else if (kind === 'grass') st = { wet: Math.max(rain, clamp((rel - 0.6) / 0.3, 0, 1), water > 0.002 ? 1 : 0) };
  else if (kind === 'mud') st = { soak: clamp((rel - 0.55) / 0.4, 0, 1) };
  else if (kind === 'soil' || kind === 'sand' || kind === 'tephra') st = { wet: Math.max(rel, rain * 0.5, water > 0.01 ? 1 : 0) };
  else st = { wet: Math.max(rain, water > 0.0005 ? 1 : 0), mu: g.mu ?? 0.8 };
  st.frozen = out.frozen;
  st.water = water;
  st.speed = opts.speed ?? 0;
  const P = surfaceProps(kind ?? 'other', st);
  Object.assign(out, P);
  out.kind = kind ?? 'other';
  out.wet = st.wet ?? 0;
  // how far it gives: the snow as far as it packs (to ~550 kg/m³); soft ground its layer
  if (out.snow) out.give = out.snow.depth * Math.max(0, 1 - out.snow.rho / 550);
  else if (P.bek && !out.frozen) out.give = Math.max(0, Math.min(SINK_MAX, i >= 0 ? softDepth(w, i) : SINK_MAX) - out.rut);
  else out.give = 0;
  return out;
}

/* ------------------------------------------------------------------ a wheel on it */

/**
 * A wheel on surface S (surfaceAt): load W (N), tyre width b, radius R (m), slide 0..1 (how much
 * it is spinning or sliding). → { z (sinkage below the surface's top, m), depth (its bottom below
 * the undisturbed top: rut or sinkage), rr (rolling resistance coefficient), Rn (N), mu }.
 */
export function wheelOn(S, W, b = 0.2, R = 0.33, slide = 0) {
  const mu = lerp(S.muPeak, S.muSlide, clamp(slide, 0, 1));
  const bek = S.bek;
  if (!bek || S.frozen || !(W > 0)) return { z: 0, depth: S.rut ?? 0, rr: 0, Rn: 0, mu, z0: 0 };
  const { n, kc, kphi } = bek;
  const Wk = W / 1000, D = 2 * R, k = kc + b * kphi;
  const z0 = TYRE * Math.pow((3 * Wk) / ((3 - n) * k * Math.sqrt(D)), 2 / (2 * n + 1));
  const rut = S.rut ?? 0;
  // in a rut: pressed already as deep as the rut; it sinks only beyond it
  const zNew = Math.min(Math.max(0, z0 - rut), S.give ?? SINK_MAX);
  const z = rut + zNew;
  const P = (zz) => (k * Math.pow(Math.max(0, zz), n + 1)) / (n + 1);
  // compaction: the new part, and some each pass (it springs back a little); bulldozing when deep
  let Rk = TYRE_R * (P(z) - P(rut * 0.85));
  Rk += 0.5 * (S.gamma ?? 15) * z * z * b * 3 * TYRE_R;
  let Rn = Rk * 1000;
  // the rut's drag: the slurry in it, its walls (soft stuff: mud, sand, snow)
  Rn += W * (S.soft ?? 0) * 0.35 * clamp(rut / R, 0, 1);
  // deep water: the wheel wades
  return { z, zNew, z0, depth: z, rr: Rn / W, Rn, mu };
}

/**
 * Grip for a wheel at (x, z) of the world (for any vehicle: the drivetrains' per-wheel μ).
 * wheel: { load N (3200), width m (0.2), radius m (0.33), slip (κ: (ωR − v)/|v|), slipAngle (rad),
 * speed m/s, y (from where to look down: default the top of the world) }.
 * → { surface, label, material, muPeak, muSlide, mu (at that slip), rr (rolling resistance
 *   coefficient), sink (m), rut (m), y (where the tyre stands), wet, frozen, snow (m), water (m) }
 *   or null (off the world).
 */
export function surfaceGrip(world, x, z, wheel = {}) {
  const g = groundTop(world, x, z, wheel.y ?? world.ny * world.h);
  if (!g) return null;
  const W = wheel.load ?? 3200;
  const S = surfaceAt(world, g, x, z, { speed: wheel.speed ?? 0, load: (W / G) * 2 });
  const slide = slideOf(Math.abs(wheel.slip ?? 0), Math.abs(wheel.slipAngle ?? 0));
  const T = wheelOn(S, W, wheel.width ?? 0.2, wheel.radius ?? 0.33, slide);
  return {
    surface: S.kind, label: S.label, material: S.material, muPeak: S.muPeak, muSlide: S.muSlide, mu: T.mu, rr: T.rr, sink: T.z, rut: S.rut,
    y: S.y - T.z, wet: S.wet, frozen: S.frozen, snow: S.snow?.depth ?? 0, water: S.water,
  };
}

/** How much a tyre is past its peak: 0 gripping, 1 sliding (slip ratio κ, slip angle α). */
const slideOf = (kappa, alpha) => clamp((Math.max(kappa, alpha * 2) - 0.15) / 0.35, 0, 1);

/* ------------------------------------------------------------------ a car on it (sim/cars.js) */

/** The car's ground-contact state (made once). */
function gcOf(c) {
  if (c.gc) return c.gc;
  const S = c.spec;
  c.gc = {
    wheels: [0, 1, 2, 3].map((k) => ({ k, x: NaN, z: NaN, px: NaN, pz: NaN, S: null, T: null, y: 0, load: 0 })),
    belly: 0, R: 0, lat: 0, stuckT: 0,
    width: S.tyreWidth ?? (S.heavy ? 0.28 : 0.2),
    clearance: S.clearance ?? (S.heavy ? 0.27 : 0.16),
  };
  c.ground = { surface: null, mu: 1, spin: 0, slip: 0, sink: 0, rut: 0, belly: 0, stuck: false, rr: 0 };
  return c.gc;
}

/** Wheel k's slip: its slip velocity along (m/s, + spinning ahead of the ground), across, κ, α. */
function wheelSlip(c, k) {
  const S = c.spec;
  const u = c.u ?? 0, v = c.v ?? 0, wz = c.wz ?? 0;
  const front = k < 2;
  const own = c.wheels?.[k];
  let sv;
  if (own && Number.isFinite(own.omega)) sv = own.omega * S.wheelR - u;
  else if (front) sv = c.slipF ? -u : 0;
  else sv = c.omega * S.wheelR - u;
  const lat = front ? Math.abs(u * Math.sin(c.steer ?? 0) + (v - S.a * wz) * Math.cos(c.steer ?? 0)) : Math.abs(v + S.b * wz);
  return { sv, lat, kappa: Math.abs(sv) / Math.max(Math.abs(u), 1), alpha: Math.abs(front ? c.alphaF ?? 0 : c.alphaR ?? 0) };
}

/**
 * env.ground for a car (sim/cars.js carEnv): the ground g the voxels give at a wheel's point
 * (x, z), with the rut it is in, the snow, its sinkage and its grip: { y, mu, road, material, ... }.
 * Which wheel: the nearest of the car's four.
 */
export function wheelContact(w, c, x, z, g) {
  if (!g) return g;
  const gc = gcOf(c);
  const pts = wheelPoints(c);
  let k = 0, best = Infinity;
  for (let q = 0; q < 4; q++) {
    const d = (pts[q][0] - x) ** 2 + (pts[q][1] - z) ** 2;
    if (d < best) {
      best = d;
      k = q;
    }
  }
  const Sp = c.spec, L = Sp.a + Sp.b;
  const m = massOf(c);
  const load = (m * G * (k < 2 ? Sp.b : Sp.a)) / L / 2;
  const S = surfaceAt(w, g, x, z, { speed: Math.abs(c.u ?? 0), load: (load / G) * 2 });
  const sl = wheelSlip(c, k);
  const T = wheelOn(S, load * (1 - gc.belly), gc.width, Sp.wheelR, slideOf(sl.kappa, sl.alpha));
  const wl = gc.wheels[k];
  wl.x = x;
  wl.z = z;
  wl.S = S;
  wl.T = T;
  wl.load = load;
  wl.y = S.y - T.z;
  // the belly carries what the wheels do not: they grip with what is left on them
  const mu = T.mu * (1 - 0.85 * gc.belly);
  return { ...g, y: wl.y, mu, road: g.road && !S.snow && !S.ice, material: S.snow ? 'snow' : S.ice ? 'ice' : g.material, surface: S.kind, sink: T.z, rr: T.rr };
}

/**
 * Each sub-step after the dynamics (sim/cars.js): what the ground holds back. The rolling
 * resistance of the soft ground (its compaction, the ruts) along the car's way, the belly's drag
 * when it is high-centred (every way), the rut's walls steering the wheels into it.
 */
export function groundDrag(c, ds) {
  const gc = c.gc;
  if (!gc || c.air) return;
  const m = massOf(c);
  const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
  const fx = cy, fz = -sy, rx = sy, rz = cy;
  let u = c.vx * fx + c.vz * fz;
  let v = c.vx * rx + c.vz * rz;
  // the soil's resistance on the wheels: against the way it rolls (never turning it back)
  const du = (gc.R / m) * ds;
  u = Math.abs(u) <= du ? 0 : u - Math.sign(u) * du;
  // the ruts' walls: a wheel on a rut's flank is pushed down into it
  v += (gc.lat / m) * ds;
  // high-centred: the belly drags every way
  if (gc.belly > 0) {
    const sp = Math.hypot(u, v);
    const dv = gc.bellyMu * gc.belly * G * ds;
    const k = sp <= dv ? 0 : (sp - dv) / sp;
    u *= k;
    v *= k;
    c.wz *= Math.max(0, 1 - 4 * gc.belly * ds);
  }
  c.vx = u * fx + v * rx;
  c.vz = u * fz + v * rz;
  c.u = u;
  c.v = v;
}

/**
 * Each frame (sim/cars.js, after the sub-steps): the ground's state from the wheels' contacts
 * (the resistance, the belly, the ruts' pull), and what the wheels do to it: ruts, the snow
 * pressed, grass flattened and torn, spray, splashes. ctx: { sim } (the weather's rain).
 */
export function groundWork(w, c, dt, ctx = {}) {
  const gc = gcOf(c);
  const M = marksOf(w);
  const Sp = c.spec, R = Sp.wheelR;
  if (ctx.sim) stepGroundFx(w, dt, ctx.sim);
  const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
  const fwd = [cy, -sy], right = [sy, cy];
  let Rsum = 0, lat = 0, spinMax = 0, slipMax = 0, sink = 0, rut = 0, muSum = 0, n = 0;
  let surface = null;
  for (const wl of gc.wheels) {
    if (!wl.S || !Number.isFinite(wl.x)) continue;
    const S = wl.S, T = wl.T;
    n++;
    surface ??= S.kind;
    muSum += T.mu;
    sink = Math.max(sink, T.z);
    rut = Math.max(rut, S.rut);
    Rsum += T.Rn;
    // the rut's flanks under this wheel: the difference across it pulls it to the deeper side
    if (S.rut > 0.02 && !S.snow) {
      const off = gc.width * 0.5 + 0.05;
      const dl = rutAt(w, wl.x - right[0] * off, wl.z - right[1] * off), dr = rutAt(w, wl.x + right[0] * off, wl.z + right[1] * off);
      lat += clamp((dr - dl) / (2 * off), -1, 1) * wl.load * 0.5;
    }
    // wading: water over the ground drags at the wheels
    if (S.water > 0.05) Rsum += 0.5 * 1000 * 1.0 * gc.width * Math.min(S.water, 2 * R) * c.u * c.u;
    const sl = wheelSlip(c, wl.k);
    spinMax = Math.max(spinMax, Math.abs(sl.sv));
    slipMax = Math.max(slipMax, sl.kappa);
    deform(w, M, c, wl, sl, dt, fwd);
    wl.px = wl.x;
    wl.pz = wl.z;
  }
  if (!n) return;
  // high-centred: the ground (snow, the ridge between the ruts) up against the belly
  const mid = groundTop(w, c.x, c.z, c.y + 1.5);
  let belly = 0, bellyMu = 0.5;
  if (mid) {
    const Sm = surfaceAt(w, mid, c.x, c.z);
    const top = Sm.snow ? Sm.y : Sm.y - Sm.rut;
    const pen = top - (c.y + gc.clearance);
    belly = clamp(pen / 0.06, 0, 1) * 0.9;
    bellyMu = Sm.snow ? 0.35 : Sm.kind === 'mud' ? 0.55 : 0.5;
    // the belly ploughs the snow it is on
    if (Sm.snow && pen > 0 && Math.hypot(c.vx, c.vz) > 0.1) plowSnow(w, c, c.y + gc.clearance);
  }
  gc.belly += (belly - gc.belly) * Math.min(1, dt * 6);
  gc.bellyMu = bellyMu;
  gc.R = Rsum;
  gc.lat = lat;
  // stuck: on its belly, or the throttle down, the wheels spinning and it not getting anywhere
  const v = Math.hypot(c.vx, c.vz);
  const trying = (c.thr ?? c.input?.throttle ?? 0) > 0.3;
  if (gc.belly > 0.5 || (trying && v < 0.3 && spinMax > 2)) gc.stuckT += dt;
  else gc.stuckT = Math.max(0, gc.stuckT - dt * 2);
  Object.assign(c.ground, {
    surface, mu: muSum / n, spin: spinMax, slip: slipMax, sink, rut, belly: gc.belly, stuck: gc.stuckT > 1, rr: Rsum / (massOf(c) * G),
  });
}

/** What wheel wl does to the ground this frame: presses and digs its rut, packs snow, wears grass, throws spray. */
function deform(w, M, c, wl, sl, dt, fwd) {
  const S = wl.S, T = wl.T;
  const gc = c.gc;
  const R = c.spec.wheelR;
  const ds = Number.isFinite(wl.px) ? Math.hypot(wl.x - wl.px, wl.z - wl.pz) : 0;
  const spin = Math.abs(sl.sv);
  const slide = sl.lat;
  const y0 = S.y;
  const gyY = S.snow ? S.snow.base : S.y;
  // material thrown: by a spinning wheel (what it digs), by one sliding sideways (less)
  let thrown = 0;
  if (S.snow) thrown = packSnow(w, wl, S, T, ds, spin, slide, dt, gc.width);
  else if (S.bek && !S.frozen && ds + spin * dt > 1e-4) thrown = rutGround(w, M, wl, S, T, ds, spin, slide, dt, gc.width, R);
  // grass: tall blades flattened, the turf worn and torn
  if (S.material === 'grass' && !S.snow && S.i >= 0) wearGrass(w, M, S.i, wl, ds, spin + slide, dt, c.u);
  // spray: what the wheel digs out is thrown behind it; water splashes at speed
  const speed = Math.hypot(c.vx, c.vz);
  const col = S.snow ? SURFACE.snow.spray : S.spray ?? [0.4, 0.35, 0.3];
  if (thrown > 0) emitSpray(M, wl.x, gyY + (S.snow?.depth ?? 0) * 0.5 + 0.05, wl.z, fwd, Math.sign(sl.sv) || 1, 0.6 + 0.45 * Math.min(spin, 12), col, Math.min(14, thrown * 2e4), R);
  if (S.water > 0.002 && speed > 1.5) {
    const k = Math.min(1, S.water / 0.02) * Math.min(1, speed / 10);
    emitSplash(M, wl.x, y0 + 0.02, wl.z, c.vx, c.vz, Math.min(16, speed * dt * 40 * k + (rand(M) < k ? 1 : 0)));
  }
}

/** The rut under a wheel: pressed to its sinkage, deeper each pass, dug by its spin; berms beside it. → m³ thrown. */
function rutGround(w, M, wl, S, T, ds, spin, slide, dt, b, R) {
  const cell = M.cell;
  const patch = Math.max(0.12, 2 * Math.sqrt(R * Math.max(T.z, 0.005)));
  const frac = Math.min(1, ds / patch);
  const maxD = Math.min(SINK_MAX, S.rut + (S.give ?? 0));
  // the wheel's path this frame: a capsule round the segment from where it was, half its width wide
  const ax = Number.isFinite(wl.px) && ds < 2 ? wl.px : wl.x, az = Number.isFinite(wl.pz) && ds < 2 ? wl.pz : wl.z;
  const r = b / 2, rb = r + 0.13;
  const x0 = Math.floor((Math.min(ax, wl.x) - rb) / cell), x1 = Math.floor((Math.max(ax, wl.x) + rb) / cell);
  const z0 = Math.floor((Math.min(az, wl.z) - rb) / cell), z1 = Math.floor((Math.max(az, wl.z) + rb) / cell);
  const sx = wl.x - ax, sz = wl.z - az, L2 = sx * sx + sz * sz;
  // what the spin digs (m of depth this frame), what sliding sideways scrapes
  const dig = digRate(S, spin, slide) * dt;
  let thrown = 0;
  const kindKey = S.kind;
  const area = cell * cell;
  const yTop = S.y; // (the ground as it was: the voxels' top)
  for (let cz = z0; cz <= z1; cz++)
    for (let cx = x0; cx <= x1; cx++) {
      const px = (cx + 0.5) * cell, pz = (cz + 0.5) * cell;
      const t = L2 > 1e-12 ? clamp(((px - ax) * sx + (pz - az) * sz) / L2, 0, 1) : 0;
      const d = Math.hypot(px - (ax + sx * t), pz - (az + sz * t));
      if (d > rb) continue;
      if (d <= r) {
        const m = markCell(M, cx, cz, yTop, kindKey);
        const before = m.d;
        // pressed as deep as the wheel sank (what stays of it); more with each pass (pushed aside)
        let nd = Math.max(m.d, T.z * (S.keep ?? 0.7));
        nd += (S.pass ?? 0.1) * Math.max(T.z0 ?? T.z, 0.01) * frac;
        nd += dig;
        nd = Math.min(nd, maxD);
        if (nd > before) {
          const dd = nd - before;
          m.d = nd;
          m.kind = kindKey;
          if (frac > 0.3) m.passes += frac;
          // what the spin dug out is thrown; what the pass pushed aside is in the berms
          thrown += Math.min(dd, dig) * area;
          M.version++;
        }
        // the water in it: a rut deeper than its water is filled up again when it rains (stepGroundFx)
      } else if (S.soft >= 0.4) {
        // the berm beside the rut: the soft stuff pushed out of it
        const m = markCell(M, cx, cz, yTop, kindKey);
        const add = ((S.pass ?? 0.1) * Math.max(T.z0 ?? T.z, 0.01) * frac + dig * 0.3) * 0.35 * S.soft;
        if (add > 1e-5 && m.d < 0.01) {
          m.berm = Math.min(0.12, m.berm + add);
          M.version++;
        }
      }
    }
  return thrown;
}

/** The snow under a wheel packed down (its mass kept) and dug out by a spinning wheel. → m³ thrown. */
function packSnow(w, wl, S, T, ds, spin, slide, dt, b) {
  const F = w.snow;
  const sh = F.sh;
  const r = b / 2 + sh * 0.3;
  const ax = Number.isFinite(wl.px) && ds < 2 ? wl.px : wl.x, az = Number.isFinite(wl.pz) && ds < 2 ? wl.pz : wl.z;
  const sx = wl.x - ax, sz = wl.z - az, L2 = sx * sx + sz * sz;
  const x0 = Math.floor((Math.min(ax, wl.x) - r) / sh), x1 = Math.floor((Math.max(ax, wl.x) + r) / sh);
  const z0 = Math.floor((Math.min(az, wl.z) - r) / sh), z1 = Math.floor((Math.max(az, wl.z) + r) / sh);
  const dig = digRate(S, spin, slide) * dt;
  let thrown = 0;
  let changed = false;
  for (let cz = z0; cz <= z1; cz++)
    for (let cx = x0; cx <= x1; cx++) {
      if (cx < 0 || cz < 0 || cx >= F.sx || cz >= F.sz) continue;
      const px = (cx + 0.5) * sh, pz = (cz + 0.5) * sh;
      const t = L2 > 1e-12 ? clamp(((px - ax) * sx + (pz - az) * sz) / L2, 0, 1) : 0;
      if (Math.hypot(px - (ax + sx * t), pz - (az + sz * t)) > r) continue;
      const j = cx + F.sx * cz;
      const d = F.depth[j];
      if (d <= 0.002 || Math.abs(F.base[j] - S.snow.base) > w.h * 1.1) continue;
      // pressed: to the tyre's sinkage, no denser than packed snow (~550 kg/m³)
      const rho = F.rho[j];
      const z = Math.min(T.z, d * Math.max(0, 1 - rho / 550));
      let nd = d - z;
      let nr = nd > 0 ? (rho * d) / nd : rho;
      // dug out by the spin
      const take = Math.min(nd, dig);
      if (take > 0) {
        thrown += take * sh * sh;
        nd -= take;
      }
      if (nd < d - 1e-5) {
        F.depth[j] = nd;
        F.rho[j] = Math.min(600, nr);
        changed = true;
      }
    }
  if (changed) F.version++;
  return thrown;
}

/** A car's belly ploughs the snow over its clearance: pushed aside (gone from under it). */
function plowSnow(w, c, yBelly) {
  const F = w.snow;
  const S = c.spec;
  const hw = S.W / 2 - 0.2, hl = S.wheelX - 0.4;
  const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
  let changed = false;
  for (let a = -hl; a <= hl; a += F.sh)
    for (let q = -hw; q <= hw; q += F.sh) {
      const x = c.x + a * cy + q * sy, z = c.z - a * sy + q * cy;
      const j = F.cell(x, z);
      if (j < 0 || F.depth[j] <= 0) continue;
      const top = F.base[j] + F.depth[j];
      if (top > yBelly) {
        F.depth[j] = Math.max(0, yBelly - F.base[j]);
        changed = true;
      }
    }
  if (changed) F.version++;
}

/** Grass under a wheel: tall blades over it flattened; the turf worn by the passes, torn by spin and slides (→ soil). */
function wearGrass(w, M, i, wl, ds, scrub, dt, u) {
  const nx = w.nx;
  // the blades standing over it: flattened (gone) as the wheel rolls over them
  if (ds > 0.005) for (let j = i + nx, k = 0; k < 8 && w.mat[j] === MAT.grass && (j / nx | 0) % w.ny !== 0; j += nx, k++) w.clearVoxel(j);
  const wear = (M.wear.get(i) ?? 0) + ds * 0.08 + scrub * dt * 0.6;
  if (wear < 1) {
    M.wear.set(i, wear);
    return;
  }
  M.wear.delete(i);
  // torn to the soil under it (its moisture, its owner, its temperature kept)
  const moist = Math.min(MATERIALS[MAT.soil].maxMoisture, w.moist[i] * 0.3 + 0.12);
  w.setVoxel(i, MAT.soil, { owner: w.owner[i], anchored: !!(w.flags[i] & F_ANCHOR), temp: w.temp[i], moisture: moist, color: [0.3, 0.23, 0.15], variation: 0.12 });
  emitSpray(M, wl.x, (Math.floor(i / nx) % w.ny + 1) * w.h + 0.03, wl.z, [Math.sign(u) || 1, 0], 1, 1.5, SURFACE.grass.spray, 6, 0.3);
}

/* ------------------------------------------------------------------ spray, splashes, the wake */

/** Bits thrown off a wheel at (x, y, z): back from the way the tyre's bottom runs (dir ±1 along fwd), at speed v. */
function emitSpray(M, x, y, z, fwd, dir, v, color, n, R = 0.33) {
  const list = M.spray;
  for (let k = 0; k < n; k++) {
    if (list.length >= SPRAY_MAX) list.shift();
    const a = (rand(M) - 0.5) * 0.9;
    const back = -dir * v * (0.6 + 0.6 * rand(M));
    const up = v * (0.5 + 0.7 * rand(M)) + 0.8;
    const side = v * a * 0.5;
    list.push({
      p: [x - fwd[0] * dir * R * 0.9, y + 0.05, z - fwd[1] * dir * R * 0.9],
      v: [fwd[0] * back + fwd[1] * side, up, fwd[1] * back - fwd[0] * side],
      age: 0, life: 0.6 + 0.6 * rand(M), floor: y - 0.3, color, size: 0.035 + 0.04 * rand(M),
    });
  }
}
/** Water splashed out sideways and up from a wheel going through it at (vx, vz). */
function emitSplash(M, x, y, z, vx, vz, n) {
  const sp = Math.hypot(vx, vz) || 1;
  for (let k = 0; k < n; k++) {
    if (M.spray.length >= SPRAY_MAX) M.spray.shift();
    const side = rand(M) < 0.5 ? -1 : 1;
    const out = sp * (0.2 + 0.3 * rand(M));
    M.spray.push({
      p: [x, y, z],
      v: [vx * 0.5 + (-vz / sp) * side * out, 1 + sp * 0.25 * rand(M), vz * 0.5 + (vx / sp) * side * out],
      age: 0, life: 0.5 + 0.5 * rand(M), floor: y - 0.2, color: [0.78, 0.86, 0.95], size: 0.04 + 0.05 * rand(M), water: true,
    });
  }
}

/**
 * Once a frame (from the cars and the boats; the first of them does it): the spray flies and
 * falls, the wake spreads and fades, the rain wets the ground and fills the ruts, they dry.
 */
export function stepGroundFx(w, dt, sim = null) {
  const M = marksOf(w);
  const t = w.time ?? 0;
  if (M.fxT === t) return;
  M.fxT = t;
  const list = M.spray;
  let k = 0;
  for (const s of list) {
    s.age += dt;
    s.v[1] -= G * dt;
    const drag = Math.max(0, 1 - 1.5 * dt);
    s.v[0] *= drag;
    s.v[2] *= drag;
    s.p[0] += s.v[0] * dt;
    s.p[1] += s.v[1] * dt;
    s.p[2] += s.v[2] * dt;
    if (s.age < s.life && s.p[1] > s.floor) list[k++] = s;
  }
  list.length = k;
  const wk = M.wake;
  k = 0;
  for (const p of wk) {
    p.age += dt;
    p.r += p.grow * dt;
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    p.vx *= Math.max(0, 1 - 0.4 * dt);
    p.vz *= Math.max(0, 1 - 0.4 * dt);
    if (p.age < p.life) wk[k++] = p;
  }
  wk.length = k;
  // the rain: the ground's surface wet (it dries in ~20 min after), water standing in the ruts
  const rain = sim?.weather?.rain ?? 0; // mm/h
  const target = clamp(rain / 2, 0, 1);
  M.rainWet += (target - M.rainWet) * Math.min(1, dt * (target > M.rainWet ? 1 / 60 : 1 / 1200));
  if (M.cells.size && (rain > 0 || M.anyWater)) {
    M.rainT = (M.rainT ?? 0) + dt;
    if (M.rainT >= 1) {
      const T = M.rainT;
      M.rainT = 0;
      let any = false;
      // (the rut gathers the rain off ~3 times its own area; it soaks away and dries at ~1 mm/h)
      const add = (rain / 1000 / 3600) * 3 * T, lose = (1 / 1000 / 3600) * T;
      for (const r of M.cells.values()) {
        if (r.d < 0.01) continue;
        const nwv = clamp(r.water + add - lose, 0, r.d);
        if (nwv !== r.water) {
          r.water = nwv;
          M.version++;
        }
        if (nwv > 0) any = true;
      }
      M.anyWater = any;
    }
  }
}

/* ------------------------------------------------------------------ boats (sim/buoyancy.js stepFloats) */

/**
 * A boat's keel on the bottom (after it has been stepped): on a soft bed (sand, mud, soil, ash)
 * its keel ploughs a furrow there as it goes, the bed holds it back (friction under the weight it
 * rests on it, the ploughing) and it slows and stops; on rock it only grinds (sim/boats.js).
 * Afloat and moving: its wake. opts: { owns(i) (its own voxels), toWorld(b, p), level }.
 */
export function boatGround(sim, f, dt, opts) {
  const w = sim.world;
  const b = f.body;
  if (!b || b.sunk) return;
  const M = marksOf(w);
  stepGroundFx(w, dt, sim);
  const hull = b.hull;
  const toW = opts.toWorld;
  const o = toW(b, [0, 0, 0]), a = toW(b, [1, 0, 0]);
  const fwd = [a[0] - o[0], a[2] - o[2]];
  const fl = Math.hypot(fwd[0], fwd[1]) || 1;
  fwd[0] /= fl;
  fwd[1] /= fl;
  const speed = Math.hypot(b.vx ?? 0, b.vz ?? 0);
  const level = opts.level ?? f.water?.level ?? 0;
  // the keel along its length
  const n = 7;
  const keelW = Math.max(0.12, Math.min(0.4, hull.B * 0.18));
  let F = 0, touching = 0, lift = 0, penSum = 0;
  const mass = b.M + (b.rho ?? 1000) * (b.water ?? 0);
  const pts = [];
  for (let s = 0; s < n; s++) {
    const x = hull.x0 + ((hull.x1 - hull.x0) * (s + 0.5)) / n;
    const p = toW(b, [x, hull.keel(x), 0]);
    // (the bed under the keel, looked for from a little above it: not what lies inside its hull, its
    // bilge water, spilt fuel, ash, which the scan from the surface down would meet first)
    const g = groundTop(w, p[0], p[2], Math.min(level + 0.2, p[1] + 0.15), opts.owns);
    if (!g) continue;
    const Sx = surfaceAt(w, g, p[0], p[2]);
    const pen = Sx.y - Sx.rut - p[1];
    if (pen < -0.005) continue;
    touching++;
    lift = Math.max(lift, pen);
    penSum += Math.max(0, pen) + 0.005;
    pts.push([p, Sx, pen]);
  }
  // the weight the bed takes: the buoyancy it lost being held up (ρ g A_wp × how far), at most all of it
  const Awp = 0.7 * hull.L * hull.B;
  const N = Math.min(mass * G, (b.rho ?? 1000) * G * Awp * (lift + 0.005));
  for (const [p, Sx, pen] of pts) {
    const soft = Sx.bek && !Sx.frozen;
    const Nk = (N * (Math.max(0, pen) + 0.005)) / penSum;
    F += Nk * (soft ? Sx.muSlide : 0.4);
    if (!soft) continue;
    // ploughing: the bed in the keel's way pushed aside (∝ the depth it cuts, its width, the
    // bottom's flanks beside the keel as it goes deeper); the furrow it leaves: what it pushed
    // aside (the rest is pressed under it: it still bears the boat)
    const width = keelW + 4 * Math.max(0, pen);
    F += 2.5e4 * Math.max(0, pen) * width * (Sx.soft ?? 0.5) * Math.min(1, speed / 0.3 + 0.2);
    if (speed > 0.03) furrow(M, p[0], p[2], fwd, width, Math.min(SINK_MAX, (Sx.y - p[1]) * (0.25 + 0.4 * (Sx.soft ?? 0.5)) + 0.005), Sx);
  }
  if (touching && speed > 1e-4) {
    const dv = (F / mass) * dt;
    const k = speed <= dv ? 0 : (speed - dv) / speed;
    b.vx *= k;
    b.vz *= k;
    if (b.wy) b.wy *= Math.max(0, 1 - 2 * dt * touching / n);
  }
  f.groundTouch = touching / n;
  // the wake: foam off the bow's shoulders (spreading at the Kelvin angle) and the stern
  if (!touching && speed > 0.4 && f.water) {
    f.wakeT = (f.wakeT ?? 0) - dt;
    if (f.wakeT <= 0) {
      f.wakeT = 0.12;
      const ys = level + 0.01;
      const s = Math.tan((19.5 * Math.PI) / 180);
      for (const side of [-1, 1]) {
        const p = toW(b, [hull.x1 - hull.L * 0.2, 0, side * hull.B * 0.45]);
        pushWake(M, { x: p[0], z: p[2], y: ys, r: 0.25, grow: 0.25 + 0.1 * speed, vx: -fwd[1] * side * speed * s * 0.6, vz: fwd[0] * side * speed * s * 0.6, life: 5 + speed, k: Math.min(1, speed / 3), age: 0 });
      }
      const st = toW(b, [hull.x0, 0, 0]);
      pushWake(M, { x: st[0], z: st[2], y: ys, r: hull.B * 0.3, grow: 0.3, vx: 0, vz: 0, life: 4 + speed, k: Math.min(1, speed / 3) * (f.motor?.running ? 1.4 : 0.8), age: 0 });
    }
  }
}
function pushWake(M, p) {
  if (M.wake.length >= WAKE_MAX) M.wake.shift();
  M.wake.push(p);
}

/** A keel's furrow at (x, z): cut to depth d over the keel's width, the berm pushed up beside it. */
function furrow(M, x, z, fwd, width, d, S) {
  const cell = M.cell;
  const r = width / 2, rb = r + 0.15;
  const n = Math.ceil(rb / cell);
  const cx0 = Math.floor(x / cell), cz0 = Math.floor(z / cell);
  const yTop = S.y;
  for (let dz = -n; dz <= n; dz++)
    for (let dx = -n; dx <= n; dx++) {
      const px = (cx0 + dx + 0.5) * cell - x, pz = (cz0 + dz + 0.5) * cell - z;
      const across = Math.abs(px * -fwd[1] + pz * fwd[0]);
      const along = Math.abs(px * fwd[0] + pz * fwd[1]);
      if (along > cell) continue;
      if (across <= r) {
        const m = markCell(M, cx0 + dx, cz0 + dz, yTop, S.kind);
        if (d > m.d) {
          m.d = d;
          m.keel = true;
          M.version++;
        }
      } else if (across <= rb) {
        const m = markCell(M, cx0 + dx, cz0 + dz, yTop, S.kind);
        if (m.d < 0.01 && m.berm < d * 0.5) {
          m.berm = Math.min(0.12, d * 0.5);
          M.version++;
        }
      }
    }
}

/** How fast a wheel spinning (m/s of slip) and sliding sideways digs into what it is on (m/s of depth: mud, ~4 cm/s flat out). */
function digRate(S, spin, slide) {
  return (S.dig ?? 0) * 0.15 * Math.min(10, spin + 0.4 * slide);
}
