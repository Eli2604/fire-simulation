/**
 * The buffer layout of the air model on the GPU (sim/gpu/gpuAir.js), shared with its JS
 * reference emulation (sim/gpu/airEmulation.js) and the tests: which World arrays live in which
 * storage buffer at which offset, the uniform block, and the per-step parameters.
 *
 * Every buffer is structure-of-arrays, f32, one field of NA cells after another, cells in the
 * World's order (a = ax + anx * (ay + any * az)). Six storage buffers and one uniform block (the
 * WebGPU minimum is 8 storage buffers per stage):
 *
 *   FIELDS  state the air step carries from step to step (and the CPU reads back)
 *   TMP     the advected copies of the transported fields (scratch between kernels)
 *   GEOM    what the solids and the CPU logic decide about each cell (occupancy, open faces...)
 *   SRC     what the solids, heaters and flames put into the air this step (cleared after)
 *   RAD     the blurred radiation field and its scratch
 *   TABLES  per-row / per-column tables (turbulence waves, wind profile, buoyancy factor)
 */

import { O2_AIR } from '../world.js';
import { FLAME_REF, FLAME_TAU, radiationGain } from '../air.js';

// --- FIELDS: index of each field (offset = index * NA)
export const F = { T: 0, S: 1, R: 2, G: 3, B: 4, W: 5, FG: 6, X: 7, O: 8, FLAME: 9, VX: 10, VY: 11, VZ: 12 };
export const N_FIELDS = 13;
/** World array of each FIELDS entry. */
export const FIELD_NAMES = ['airT', 'smoke', 'smokeR', 'smokeG', 'smokeB', 'steam', 'fgas', 'supp', 'o2', 'flame', 'vx', 'vy', 'vz'];
/** The fields the air step transports (advected, mixed): TMP holds their copies in this order. */
export const N_ADVECTED = 9;
/**
 * The fields whose next value depends on their current one: the CPU's edits to them (heaters
 * adding smoke, water cooling the gas, combustion taking oxygen) are uploaded before each step.
 * The velocities are recomputed from scratch every step, so they are only read back.
 */
export const UPLOADED_FIELDS = 10;

// --- GEOM: scalar fields, then the vacuum's suction velocity interleaved (3 per cell)
export const GM = { OCC: 0, PX: 1, PY: 2, PZ: 3, CAPPED: 4, SHELTER: 5, AWAKE: 6, SUCK: 7 };
export const GEOM_SCALARS = 7;
export const GEOM_LEN = (NA) => (GEOM_SCALARS + 3) * NA;

// --- SRC
export const SR = { G: 0, GT: 1, Q: 2, FACC: 3, RAD: 4 };
export const SRC_NAMES = ['airG', 'airGT', 'airQ', 'flameAcc', 'radSrc'];
export const N_SRC = 5;

// --- RAD: the field and a scratch copy
export const N_RAD = 2;

// --- TABLES: tx, tx2 (anx each), ty, tz, tz2 (any / anz), wind x / z and buoyancy factor per row
export function tableOffsets(anx, any, anz) {
  const o = {};
  let p = 0;
  o.tx = p; p += anx;
  o.tx2 = p; p += anx;
  o.ty = p; p += any;
  o.tz = p; p += anz;
  o.tz2 = p; p += anz;
  o.wx = p; p += any;
  o.wz = p; p += any;
  o.buoy = p; p += any;
  o.length = p;
  return o;
}

// --- the uniform block (WGSL struct Params in airKernels.js, same order; every member 4 bytes)
export const PARAM_U32 = ['anx', 'any', 'anz', 'na', 'sxy', 'flags', 'radR', 'pad0', 'oTx', 'oTx2', 'oTy', 'oTz', 'oTz2', 'oWx', 'oWz', 'oBuoy'];
export const PARAM_F32 = ['tamb', 'ah', 'inv', 'dt', 'windTurb', 'turbAmp', 'o2b', 'alpha', 'fireMix', 'relaxT', 'smokeKeep', 'steamKeep', 'fgasKeep', 'suppKeep', 'flameRefJ', 'ah3', 'radGain', 'radInv', 'pad1', 'pad2'];
export const PARAM_BYTES = (PARAM_U32.length + PARAM_F32.length) * 4; // 144, a multiple of 16
export const FLAG_AWAKE = 1; // w.airAwake in use (sleeping cells keep their state)
export const FLAG_SUCK = 2; // a vacuum's suction (w.suck) adds to the velocity

/** Write the parameters into a uniform block (an ArrayBuffer of PARAM_BYTES). */
export function packParams(p, buf = new ArrayBuffer(PARAM_BYTES)) {
  const dv = new DataView(buf);
  let o = 0;
  for (const k of PARAM_U32) {
    dv.setUint32(o, p[k] ?? 0, true);
    o += 4;
  }
  for (const k of PARAM_F32) {
    dv.setFloat32(o, p[k] ?? 0, true);
    o += 4;
  }
  return buf;
}

/** Read a uniform block back (what the kernels see: the f32 members rounded to f32). */
export function unpackParams(buf) {
  const dv = new DataView(buf);
  const p = {};
  let o = 0;
  for (const k of PARAM_U32) {
    p[k] = dv.getUint32(o, true);
    o += 4;
  }
  for (const k of PARAM_F32) {
    p[k] = dv.getFloat32(o, true);
    o += 4;
  }
  return p;
}

const CEIL = 1.3;
/**
 * The parameters of one air step: the same numbers sim/air.js stepAir derives from the weather
 * and the time step (kept in step with it: test/gpuAir.test.js compares the two solvers), and
 * the per-row / per-column tables it computes, written into `tables`.
 */
export function airStepParams(w, W, D, dt, tables) {
  const { anx, any, anz, ah } = w;
  const off = tableOffsets(anx, any, anz);
  const t = w.time;
  // separable turbulence (air.js turbTable)
  const wave = (o, n, freq, speed, tt) => {
    for (let i = 0; i < n; i++) tables[o + i] = Math.sin(i * freq + tt * speed);
  };
  wave(off.tx, anx, 1.7, 2.3, t);
  wave(off.ty, any, 0.9, -3.1, t);
  wave(off.tz, anz, 1.3, -1.9, t);
  wave(off.tx2, anx, 1.1, -2.7, t + 3);
  wave(off.tz2, anz, 0.8, 2.1, t + 7);
  const fog = W.fog;
  const inversionH = w.size[1] * 0.55;
  for (let ay = 0; ay < any; ay++) {
    const height = (ay + 0.5) * ah;
    let prof = Math.pow(Math.max(height, 0.05) / 2, 0.2);
    if (prof > CEIL) prof = CEIL;
    let buoyF = 2.0;
    if (fog > 0 && height > inversionH) buoyF *= 1 - 0.85 * fog;
    tables[off.wx + ay] = D.windX * prof;
    tables[off.wz + ay] = D.windZ * prof;
    tables[off.buoy + ay] = buoyF;
  }
  const windTurb = 0.05 * Math.hypot(D.windX, D.windZ);
  const Dturb = 0.004 + 0.01 * Math.hypot(D.windX, D.windZ);
  let alpha = (Dturb * dt) / (ah * ah);
  if (alpha > 0.14) alpha = 0.14;
  const r = Math.max(1, Math.min(4, Math.round(0.6 / ah))); // air.js radiusCells
  const ah3 = ah * ah * ah;
  return {
    anx,
    any,
    anz,
    na: w.NA,
    sxy: anx * any,
    flags: (w.airAwake ? FLAG_AWAKE : 0) | (w.vacuum && w.suck ? FLAG_SUCK : 0),
    radR: r,
    oTx: off.tx,
    oTx2: off.tx2,
    oTy: off.ty,
    oTz: off.tz,
    oTz2: off.tz2,
    oWx: off.wx,
    oWz: off.wz,
    oBuoy: off.buoy,
    tamb: W.ambient,
    ah,
    inv: dt / ah,
    dt,
    windTurb,
    turbAmp: 0.15 + windTurb,
    o2b: w.vacuum ? 0 : w.o2Out ?? O2_AIR,
    alpha,
    fireMix: Math.min(0.15, (0.25 * dt) / (ah * ah)),
    relaxT: 1 - Math.exp(-(0.03 + 0.08 * D.rainFrac) * dt),
    smokeKeep: Math.exp(-(0.0005 + 0.03 * D.rainFrac) * dt),
    steamKeep: Math.exp(-(0.01 + 0.12 * (1.02 - D.rh)) * dt),
    fgasKeep: Math.exp(-dt / FLAME_TAU),
    suppKeep: Math.exp(-0.05 * dt),
    flameRefJ: FLAME_REF * ah3,
    ah3,
    radGain: radiationGain(w),
    radInv: 1 / (2 * r + 1),
  };
}

/**
 * The World arrays the GPU mirrors, where they go, and which way they travel:
 *   up: CPU -> GPU before a step (only the blocks that changed), down: GPU -> CPU after it.
 * `get(w)` is the World's array (null: not there, uploaded as zeros once).
 */
export function mirrorPlan(w) {
  const NA = w.NA;
  const plan = [];
  for (let k = 0; k < N_FIELDS; k++) {
    const name = FIELD_NAMES[k];
    plan.push({ name, buf: 'fields', offset: k * NA, len: NA, get: (w) => w[name], up: k < UPLOADED_FIELDS, down: true });
  }
  const geom = ['occ', 'passX', 'passY', 'passZ', 'capped', 'shelter', 'airAwake'];
  geom.forEach((name, k) => plan.push({ name, buf: 'geom', offset: k * NA, len: NA, get: (w) => w[name] ?? null, up: true, down: false }));
  plan.push({ name: 'suck', buf: 'geom', offset: GEOM_SCALARS * NA, len: 3 * NA, get: (w) => (w.vacuum ? w.suck ?? null : null), up: true, down: false });
  SRC_NAMES.forEach((name, k) => plan.push({ name, buf: 'src', offset: k * NA, len: NA, get: (w) => w[name], up: true, down: false }));
  plan.push({ name: 'radField', buf: 'rad', offset: 0, len: NA, get: (w) => w.radField, up: false, down: true });
  return plan;
}

/** Pack a World's air state into fresh SoA buffers (the GPU's layout): for the emulation and tests. */
export function packWorld(w) {
  const NA = w.NA;
  const bufs = {
    fields: new Float32Array(N_FIELDS * NA),
    tmp: new Float32Array(N_ADVECTED * NA),
    geom: new Float32Array(GEOM_LEN(NA)),
    src: new Float32Array(N_SRC * NA),
    rad: new Float32Array(N_RAD * NA),
    tables: new Float32Array(tableOffsets(w.anx, w.any, w.anz).length),
  };
  for (const m of mirrorPlan(w)) {
    const a = m.get(w);
    const dst = bufs[m.buf];
    if (a) for (let i = 0; i < m.len; i++) dst[m.offset + i] = a[i];
    else if (m.name === 'airAwake') dst.fill(1, m.offset, m.offset + m.len);
  }
  return bufs;
}

/** Copy the GPU-layout buffers back into a World's arrays (what a readback does). */
export function unpackWorld(w, bufs) {
  for (const m of mirrorPlan(w)) {
    if (!m.down) continue;
    const a = m.get(w);
    a.set(bufs[m.buf].subarray(m.offset, m.offset + m.len));
  }
}
