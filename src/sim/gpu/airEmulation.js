/**
 * JS reference emulation of the air model's WGSL kernels (sim/gpu/airKernels.js): the same
 * per-cell code, invocation by invocation, on the same buffer layout (sim/gpu/airLayout.js) and
 * the same uniform block. Node has no WebGPU, so this is what the tests run against the CPU
 * solver (sim/air.js) to check the GPU path's layout, indexing and boundary handling; with a
 * WebGPU implementation in node (the `webgpu` package) the tests also run the real kernels.
 *
 * Arithmetic is in doubles with f32 storage (like the CPU solver); the GPU computes in f32, so
 * it matches both to f32 rounding.
 */

import { F, GM, SR, N_ADVECTED, FLAG_AWAKE, FLAG_SUCK } from './airLayout.js';
import { RAD_PASSES } from './airKernels.js';

const CP_AIR = 1005;
const MAX_AIR_T = 1250;
const CEILING_JET = 0.006;
const ENTRAIN = 0.0005;
const FILL = 0.004;
const MAX_IRRADIANCE = 200e3;

const asleep = (P, geom, a) => (P.flags & FLAG_AWAKE) !== 0 && geom[GM.AWAKE * P.na + a] === 0;

/** Kernel `velocity` for every cell. */
export function emuVelocity(P, b) {
  const { fields, geom, tables } = b;
  const NA = P.na;
  const gv = (k, a) => geom[k * NA + a];
  for (let a = 0; a < NA; a++) {
    if (asleep(P, geom, a)) {
      fields[F.VX * NA + a] = fields[F.VY * NA + a] = fields[F.VZ * NA + a] = 0;
      continue;
    }
    const ax = a % P.anx;
    const ay = ((a / P.anx) | 0) % P.any;
    const az = (a / P.sxy) | 0;
    const T = fields[a];
    const dT = T - P.tamb;
    const pY = gv(GM.PY, a);
    const capped = gv(GM.CAPPED, a) !== 0;
    const notTop = ay + 1 < P.any;
    let dTb = dT;
    if (capped && notTop && pY > 0.5) dTb = T - Math.max(P.tamb, fields[a + P.anx]);
    let up = dTb > 0 ? tables[P.oBuoy + ay] * Math.sqrt(dTb / (T + 273.15)) : 0;
    if (up > 6) up = 6;
    const open = 1 - gv(GM.OCC, a);
    const o2 = open * open;
    const fl = fields[F.FLAME * NA + a];
    const tb = P.turbAmp * (1 + fl * 2);
    const xp = ax + 1 < P.anx ? fields[a + 1] : T;
    const xm = ax > 0 ? fields[a - 1] : T;
    const zp = az + 1 < P.anz ? fields[a + P.sxy] : T;
    const zm = az > 0 ? fields[a - P.sxy] : T;
    const gx = xp - xm;
    const gz = zp - zm;
    let ex = ENTRAIN * gx;
    let ez = ENTRAIN * gz;
    if (dT > 20 && notTop && pY < 0.5) {
      ex = -CEILING_JET * gx;
      ez = -CEILING_JET * gz;
    }
    if (ex > 1.5) ex = 1.5;
    else if (ex < -1.5) ex = -1.5;
    if (ez > 1.5) ez = 1.5;
    else if (ez < -1.5) ez = -1.5;
    const sw = gv(GM.SHELTER, a);
    const tbw = (P.turbAmp - P.windTurb * (1 - sw)) * (1 + fl * 2);
    const txv = tables[P.oTx + ax];
    const tx2v = tables[P.oTx2 + ax];
    const tyv = tables[P.oTy + ay];
    const tzv = tables[P.oTz + az];
    const tz2v = tables[P.oTz2 + az];
    let u = (tables[P.oWx + ay] * sw + ex + tbw * (txv * tzv * 0.6 + tyv * 0.4)) * o2;
    if (u > 0) {
      if (ax > 0) u *= gv(GM.PX, a - 1);
    } else u *= gv(GM.PX, a);
    let q = (tables[P.oWz + ay] * sw + ez + tbw * (tz2v * tx2v * 0.6 - tyv * 0.4)) * o2;
    if (q > 0) {
      if (az > 0) q *= gv(GM.PZ, a - P.sxy);
    } else q *= gv(GM.PZ, a);
    let v = (up + tb * 0.5 * tx2v * tyv) * open;
    if (v > 0) {
      if (ay > 0) v *= gv(GM.PY, a - P.anx);
    } else v *= pY;
    if (v > 0 && notTop && pY < 0.25) v *= pY * 4;
    if (capped && notTop && pY > 0.5) {
      const above = fields[a + P.anx] - T;
      if (above > 2) {
        let d = FILL * above;
        if (d > 0.12) d = 0.12;
        v -= d;
      }
    }
    if (ay === 0 && v < 0) v = 0;
    if (P.flags & FLAG_SUCK) {
      const s = GM.SUCK * NA + a * 3;
      u += geom[s];
      v += geom[s + 1];
      q += geom[s + 2];
    }
    fields[F.VX * NA + a] = u;
    fields[F.VY * NA + a] = v;
    fields[F.VZ * NA + a] = q;
  }
}

/** Kernel `advect` for every cell. */
export function emuAdvect(P, b) {
  const { fields, tmp, geom } = b;
  const NA = P.na;
  const { anx, any, anz, sxy } = P;
  for (let a = 0; a < NA; a++) {
    if (asleep(P, geom, a)) {
      for (let k = 0; k < N_ADVECTED; k++) tmp[k * NA + a] = fields[k * NA + a];
      continue;
    }
    const ax = a % anx;
    const ay = ((a / anx) | 0) % any;
    const az = (a / sxy) | 0;
    let px = ax - fields[F.VX * NA + a] * P.inv;
    let py = ay - fields[F.VY * NA + a] * P.inv;
    let pz = az - fields[F.VZ * NA + a] * P.inv;
    if (px < -0.5 || pz < -0.5 || px > anx - 0.5 || pz > anz - 0.5 || py > any - 0.5) {
      tmp[F.T * NA + a] = P.tamb;
      for (let k = 1; k < F.O; k++) tmp[k * NA + a] = 0;
      tmp[F.O * NA + a] = P.o2b;
      continue;
    }
    if (px < 0) px = 0;
    else if (px > anx - 1) px = anx - 1;
    if (py < 0) py = 0;
    else if (py > any - 1) py = any - 1;
    if (pz < 0) pz = 0;
    else if (pz > anz - 1) pz = anz - 1;
    const x0 = px | 0;
    const y0 = py | 0;
    const z0 = pz | 0;
    const dx = x0 + 1 < anx ? 1 : 0;
    const dy = y0 + 1 < any ? anx : 0;
    const dz = z0 + 1 < anz ? sxy : 0;
    const fx = px - x0;
    const fy = py - y0;
    const fz = pz - z0;
    const i0 = x0 + anx * y0 + sxy * z0;
    const i1 = i0 + dx;
    const i2 = i0 + dy;
    const i3 = i2 + dx;
    const i4 = i0 + dz;
    const i5 = i4 + dx;
    const i6 = i4 + dy;
    const i7 = i6 + dx;
    const gx = 1 - fx;
    const gy = 1 - fy;
    const gz = 1 - fz;
    const w0 = gx * gy * gz;
    const w1 = fx * gy * gz;
    const w2 = gx * fy * gz;
    const w3 = fx * fy * gz;
    const w4 = gx * gy * fz;
    const w5 = fx * gy * fz;
    const w6 = gx * fy * fz;
    const w7 = fx * fy * fz;
    for (let k = 0; k < N_ADVECTED; k++) {
      const o = k * NA;
      tmp[o + a] =
        fields[o + i0] * w0 + fields[o + i1] * w1 + fields[o + i2] * w2 + fields[o + i3] * w3 + fields[o + i4] * w4 + fields[o + i5] * w5 + fields[o + i6] * w6 + fields[o + i7] * w7;
    }
  }
}

/** Kernel `mixHeat` for every cell. */
export function emuMixHeat(P, b) {
  const { fields, tmp, geom, src } = b;
  const NA = P.na;
  const { anx, any, anz, sxy } = P;
  const gv = (k, a) => geom[k * NA + a];
  const nb = (k, i, bnd) => (i < 0 ? bnd : tmp[k * NA + i]);
  const f = { xm: 0, xp: 0, ym: 0, yp: 0, zm: 0, zp: 0, p0: 0, p1: 0, p2: 0, p3: 0, p4: 0, p5: 0 };
  const lap = (k, a, bnd, kk) => {
    const c = tmp[k * NA + a];
    const sum =
      (nb(k, f.xm, bnd) - c) * f.p0 + (nb(k, f.xp, bnd) - c) * f.p1 + (nb(k, f.ym, bnd) - c) * f.p2 + (nb(k, f.yp, bnd) - c) * f.p3 + (nb(k, f.zm, bnd) - c) * f.p4 + (nb(k, f.zp, bnd) - c) * f.p5;
    return c + kk * sum;
  };
  for (let a = 0; a < NA; a++) {
    const sleeping = asleep(P, geom, a);
    const occ = gv(GM.OCC, a);
    if (!sleeping) {
      const ax = a % anx;
      const ay = ((a / anx) | 0) % any;
      const az = (a / sxy) | 0;
      f.xm = ax > 0 ? a - 1 : -1;
      f.xp = ax + 1 < anx ? a + 1 : -1;
      f.ym = ay > 0 ? a - anx : a;
      f.yp = ay + 1 < any ? a + anx : -1;
      f.zm = az > 0 ? a - sxy : -1;
      f.zp = az + 1 < anz ? a + sxy : -1;
      f.p0 = ax > 0 ? gv(GM.PX, a - 1) : 1;
      f.p1 = gv(GM.PX, a);
      f.p2 = ay > 0 ? gv(GM.PY, a - anx) : 1;
      f.p3 = gv(GM.PY, a);
      f.p4 = az > 0 ? gv(GM.PZ, a - sxy) : 1;
      f.p5 = gv(GM.PZ, a);
      const k = P.alpha * (1 - occ * 0.8);
      const dTk = tmp[F.T * NA + a] - P.tamb;
      let T = lap(F.T, a, P.tamb, k);
      T += (P.tamb - T) * P.relaxT;
      fields[F.T * NA + a] = T;
      let sm = lap(F.S, a, 0, k) * P.smokeKeep;
      let sr = lap(F.R, a, 0, k) * P.smokeKeep;
      let sg = lap(F.G, a, 0, k) * P.smokeKeep;
      let sb = lap(F.B, a, 0, k) * P.smokeKeep;
      let st = lap(F.W, a, 0, k) * P.steamKeep;
      let kf = k;
      if (dTk > 0) {
        const fl = fields[F.FLAME * NA + a];
        kf += P.fireMix * (fl > 0.5 ? 1 : fl * 2 + (dTk > 300 ? 0.5 : dTk / 600));
        if (kf > 0.16) kf = 0.16;
      }
      fields[F.O * NA + a] = lap(F.O, a, P.o2b, kf);
      const sp = lap(F.X, a, 0, k) * P.suppKeep;
      fields[F.X * NA + a] = sp;
      let fg = lap(F.FG, a, 0, k) * P.fgasKeep * (sp > 0 ? Math.exp(-6 * sp * P.dt) : 1);
      if (fg < 1e-3) fg = 0;
      if (sm < 1e-12) sm = sr = sg = sb = 0;
      if (st < 1e-12) st = 0;
      fields[F.S * NA + a] = sm;
      fields[F.R * NA + a] = sr;
      fields[F.G * NA + a] = sg;
      fields[F.B * NA + a] = sb;
      fields[F.W * NA + a] = st;
      fields[F.FG * NA + a] = fg;
    }
    const G = src[SR.G * NA + a];
    const Q = src[SR.Q * NA + a];
    const facc = src[SR.FACC * NA + a];
    if (sleeping && Q === 0 && G === 0 && facc === 0) continue;
    const T = fields[F.T * NA + a];
    const rho = 353 / (T + 273.15);
    const Ca = rho * CP_AIR * P.ah3 * (1 - 0.9 * occ);
    let Tn = (Ca * T + P.dt * (src[SR.GT * NA + a] + Q)) / (Ca + P.dt * G);
    if (Tn > MAX_AIR_T) Tn = MAX_AIR_T;
    else if (Tn < P.tamb - 30 && Tn < T) Tn = Math.min(T, P.tamb - 30);
    fields[F.T * NA + a] = Tn;
    const g = fields[F.FG * NA + a] + facc * P.dt;
    fields[F.FG * NA + a] = g;
    let fl = Math.sqrt(g / P.flameRefJ);
    const hot = (Tn - 450) / 500;
    if (hot > fl) fl = hot;
    const sp = fields[F.X * NA + a];
    if (sp > 0) fl *= 1 - Math.min(1, sp);
    fields[F.FLAME * NA + a] = fl < 0 ? 0 : fl > 1 ? 1 : fl;
  }
}

/** Kernel `radiation`, one dispatch ({ axis, from, to, mode }: airKernels.js RAD_PASSES). */
export function emuRadiationPass(P, b, pass) {
  const { rad, src } = b;
  const NA = P.na;
  const r = P.radR;
  for (let a = 0; a < NA; a++) {
    if (pass.mode === 0) {
      rad[a] = src[SR.RAD * NA + a];
      continue;
    }
    if (pass.mode === 2) {
      const v = rad[a] * P.radGain;
      rad[a] = v > MAX_IRRADIANCE ? MAX_IRRADIANCE : v;
      continue;
    }
    let c, n, stride;
    if (pass.axis === 0) [c, n, stride] = [a % P.anx, P.anx, 1];
    else if (pass.axis === 1) [c, n, stride] = [((a / P.anx) | 0) % P.any, P.any, P.anx];
    else [c, n, stride] = [(a / P.sxy) | 0, P.anz, P.sxy];
    const base = pass.from * NA + a;
    let sum = 0;
    for (let t = -r; t <= r; t++) {
      const p = c + t;
      if (p < 0 || p >= n) continue;
      sum += rad[base + t * stride];
    }
    rad[pass.to * NA + a] = sum * P.radInv;
  }
}

/** One air step, as the GPU runs it: the kernels in their order, then the radiation passes. */
export function emuAirStep(P, b) {
  emuVelocity(P, b);
  emuAdvect(P, b);
  emuMixHeat(P, b);
  for (const pass of RAD_PASSES) emuRadiationPass(P, b, pass);
}
