/**
 * Air grid physics: gas temperature, buoyant + wind driven flow, transport of
 * smoke and steam, flames, and a blurred radiation field.
 *
 * The air grid is coarser than the voxel grid (2x2x2 voxels per cell).
 */

import { O2_AIR } from './world.js';
import { conserveO2 } from './oxygen.js';

const CP_AIR = 1005;
const MAX_AIR_T = 1250;
export const FLAME_TAU = 0.5; // s, burn-out time of released fuel gas
export const FLAME_REF = 1.5e5; // J/m³ of burning gas that makes a cell fully flame
export const FLAME_TEMP = 1100; // °C, gas temperature inside a flame
const CEILING_JET = 0.006; // m/s per K across 2 cells, hot layer spreading under a ceiling
const ENTRAIN = 0.0005;
const FILL = 0.004; // m/s per K: descent of a smoke layer collecting under a ceiling // m/s per K of temperature difference across 2 cells
// The blurred field ignores shadowing by solids; this accounts for the part
// of the emission that is re-absorbed inside the burning object itself.
const RAD_VIEW = 0.55;

/** Radius (cells) of the radiation blur and the gain that turns blurred power into irradiance. */
export function radiationGain(w) {
  const r = radiusCells(w);
  // Two passes of a box blur of radius r give a triangular 1D kernel:
  // k(d) = (2r+1-|d|)/(2r+1)^2. Calibrate so that, at distance r cells from
  // a point source P, irradiance equals P / (4π d²).
  const s = 2 * r + 1;
  const k0 = s / (s * s);
  const kr = (s - r) / (s * s);
  const kAt = kr * k0 * k0;
  const d = r * w.ah;
  return RAD_VIEW / (4 * Math.PI * d * d * kAt);
}

function radiusCells(w) {
  return Math.max(1, Math.min(4, Math.round(0.6 / w.ah)));
}

export function blurRadiation(w, gain) {
  const r = radiusCells(w);
  const { anx, any, anz } = w;
  const f = w.radField;
  const b = w.tmpA;
  f.set(w.radSrc);
  for (let pass = 0; pass < 2; pass++) {
    box1D(f, b, anx, any, anz, r, 0);
    box1D(b, f, anx, any, anz, r, 1);
    box1D(f, b, anx, any, anz, r, 2);
    f.set(b);
  }
  // Irradiance can not exceed that of a black body at flame temperature.
  for (let i = 0; i < f.length; i++) {
    const v = f[i] * gain;
    f[i] = v > MAX_IRRADIANCE ? MAX_IRRADIANCE : v;
  }
}

const MAX_IRRADIANCE = 200e3; // W/m²

function box1D(src, dst, nx, ny, nz, r, axis) {
  const inv = 1 / (2 * r + 1);
  const stride = axis === 0 ? 1 : axis === 1 ? nx : nx * ny;
  const len = axis === 0 ? nx : axis === 1 ? ny : nz;
  const n1 = axis === 0 ? ny : nx;
  const n2 = axis === 2 ? ny : nz;
  for (let b2 = 0; b2 < n2; b2++)
    for (let b1 = 0; b1 < n1; b1++) {
      let base;
      if (axis === 0) base = nx * (b1 + ny * b2);
      else if (axis === 1) base = b1 + nx * ny * b2;
      else base = b1 + nx * b2;
      let sum = 0;
      for (let t = 0; t <= r && t < len; t++) sum += src[base + t * stride];
      for (let t = 0; t < len; t++) {
        dst[base + t * stride] = sum * inv;
        const add = t + r + 1;
        const rem = t - r;
        if (add < len) sum += src[base + add * stride];
        if (rem >= 0) sum -= src[base + rem * stride];
      }
    }
}

/**
 * One air step:
 *  1. velocity: buoyancy from the gas temperature, wind with a height profile,
 *     a little turbulence; solids block the flow
 *  2. semi-Lagrangian advection of temperature, smoke (+colour), steam and
 *     burning gas
 *  3. turbulent mixing and weather: relaxation to ambient, rain wash-out,
 *     steam condensation / evaporation depending on humidity
 *  4. implicit heat exchange with the solids + heat sources (flames, burners)
 *  5. flame presence from burning gas and hot gas
 */
export function stepAir(w, W, D, dt, sim) {
  const { anx, any, anz, ah, airT, airG, airGT, airQ, flame, flameAcc, occ, vx, vy, vz } = w;
  const { smoke, smokeR, smokeG, smokeB, steam, fgas, supp, passX, passY, passZ, capped, o2 } = w;
  const NA = w.NA;
  const ah3 = ah * ah * ah;
  const Tamb = W.ambient;
  const sxy = anx * any;

  // --- 1. velocity
  const t = w.time;
  const fog = W.fog;
  const inversionH = w.size[1] * 0.55;
  const turbAmp = 0.15 + 0.05 * Math.hypot(D.windX, D.windZ);
  // separable turbulence: products of per-axis waves, recomputed per step
  const tx = turbTable(w, 'tx', anx, 1.7, 2.3, t);
  const ty = turbTable(w, 'ty', any, 0.9, -3.1, t);
  const tz = turbTable(w, 'tz', anz, 1.3, -1.9, t);
  const tx2 = turbTable(w, 'tx2', anx, 1.1, -2.7, t + 3);
  const tz2 = turbTable(w, 'tz2', anz, 0.8, 2.1, t + 7);
  for (let az = 0; az < anz; az++)
    for (let ay = 0; ay < any; ay++) {
      const height = (ay + 0.5) * ah;
      let prof = Math.pow(Math.max(height, 0.05) / 2, 0.2);
      if (prof > 1.3) prof = 1.3;
      let buoyF = 2.0;
      if (fog > 0 && height > inversionH) buoyF *= 1 - 0.85 * fog; // inversion caps the plume
      const wx = D.windX * prof;
      const wz = D.windZ * prof;
      const tyv = ty[ay];
      const tzv = tz[az];
      const tz2v = tz2[az];
      let a = anx * (ay + any * az);
      for (let ax = 0; ax < anx; ax++, a++) {
        const T = airT[a];
        const dT = T - Tamb;
        // in a stratified layer under a ceiling, gas only rises if it is hotter than the gas above it
        const layered = capped[a] && ay + 1 < any && passY[a] > 0.5;
        const dTb = layered ? T - Math.max(Tamb, airT[a + anx]) : dT;
        let up = dTb > 0 ? buoyF * Math.sqrt(dTb / (T + 273.15)) : 0;
        if (up > 6) up = 6;
        const open = 1 - occ[a];
        const o2 = open * open;
        const tb = turbAmp * (1 + flame[a] * 2);
        // entrainment: a rising plume draws surrounding air in towards it
        const gx = (ax + 1 < anx ? airT[a + 1] : T) - (ax > 0 ? airT[a - 1] : T);
        const gz = (az + 1 < anz ? airT[a + sxy] : T) - (az > 0 ? airT[a - sxy] : T);
        let ex = ENTRAIN * gx;
        let ez = ENTRAIN * gz;
        // ceiling jet: hot gas trapped under a ceiling flows away from the hot
        // spot along it (that is how smoke fills a corridor from the top down)
        if (dT > 20 && ay + 1 < any && passY[a] < 0.5) {
          ex = -CEILING_JET * gx;
          ez = -CEILING_JET * gz;
        }
        if (ex > 1.5) ex = 1.5;
        else if (ex < -1.5) ex = -1.5;
        if (ez > 1.5) ez = 1.5;
        else if (ez < -1.5) ez = -1.5;
        // flow only through the open part of the face it comes through
        let u = (wx + ex + tb * (tx[ax] * tzv * 0.6 + tyv * 0.4)) * o2;
        u *= u > 0 ? (ax > 0 ? passX[a - 1] : 1) : passX[a];
        vx[a] = u;
        let q = (wz + ez + tb * (tz2v * tx2[ax] * 0.6 - tyv * 0.4)) * o2;
        q *= q > 0 ? (az > 0 ? passZ[a - sxy] : 1) : passZ[a];
        vz[a] = q;
        let v = (up + tb * 0.5 * tx2[ax] * tyv) * open;
        v *= v > 0 ? (ay > 0 ? passY[a - anx] : 1) : passY[a];
        if (v > 0 && ay + 1 < any && passY[a] < 0.25) v *= passY[a] * 4; // under a ceiling
        // Under a ceiling the hot layer deepens: the plume keeps adding gas, which
        // pushes the layer interface down (the air model has no volume balance of its own)
        if (capped[a] && ay + 1 < any && passY[a] > 0.5) {
          const above = airT[a + anx] - T;
          if (above > 2) {
            let d = FILL * above;
            if (d > 0.12) d = 0.12;
            v -= d;
          }
        }
        if (ay === 0 && v < 0) v = 0;
        vy[a] = v;
      }
    }

  // --- 2. advection into the tmp buffers
  const oT = w.tmpA;
  const oS = w.tmpB;
  const oR = w.tmpC;
  const oG = w.tmpD;
  const oB = w.tmpE;
  const oW = w.tmpF;
  const oF = w.tmpG;
  const oX = w.tmpH;
  const oO = w.tmpI;
  const inv = dt / ah;
  for (let az = 0; az < anz; az++)
    for (let ay = 0; ay < any; ay++) {
      let a = anx * (ay + any * az);
      for (let ax = 0; ax < anx; ax++, a++) {
        let px = ax - vx[a] * inv;
        let py = ay - vy[a] * inv;
        let pz = az - vz[a] * inv;
        if (px < -0.5 || pz < -0.5 || px > anx - 0.5 || pz > anz - 0.5 || py > any - 0.5) {
          oT[a] = Tamb;
          oS[a] = oR[a] = oG[a] = oB[a] = oW[a] = oF[a] = oX[a] = 0;
          oO[a] = O2_AIR; // fresh air from outside the domain
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
        oT[a] = airT[i0] * w0 + airT[i1] * w1 + airT[i2] * w2 + airT[i3] * w3 + airT[i4] * w4 + airT[i5] * w5 + airT[i6] * w6 + airT[i7] * w7;
        oS[a] = smoke[i0] * w0 + smoke[i1] * w1 + smoke[i2] * w2 + smoke[i3] * w3 + smoke[i4] * w4 + smoke[i5] * w5 + smoke[i6] * w6 + smoke[i7] * w7;
        oR[a] = smokeR[i0] * w0 + smokeR[i1] * w1 + smokeR[i2] * w2 + smokeR[i3] * w3 + smokeR[i4] * w4 + smokeR[i5] * w5 + smokeR[i6] * w6 + smokeR[i7] * w7;
        oG[a] = smokeG[i0] * w0 + smokeG[i1] * w1 + smokeG[i2] * w2 + smokeG[i3] * w3 + smokeG[i4] * w4 + smokeG[i5] * w5 + smokeG[i6] * w6 + smokeG[i7] * w7;
        oB[a] = smokeB[i0] * w0 + smokeB[i1] * w1 + smokeB[i2] * w2 + smokeB[i3] * w3 + smokeB[i4] * w4 + smokeB[i5] * w5 + smokeB[i6] * w6 + smokeB[i7] * w7;
        oW[a] = steam[i0] * w0 + steam[i1] * w1 + steam[i2] * w2 + steam[i3] * w3 + steam[i4] * w4 + steam[i5] * w5 + steam[i6] * w6 + steam[i7] * w7;
        oF[a] = fgas[i0] * w0 + fgas[i1] * w1 + fgas[i2] * w2 + fgas[i3] * w3 + fgas[i4] * w4 + fgas[i5] * w5 + fgas[i6] * w6 + fgas[i7] * w7;
        oX[a] = supp[i0] * w0 + supp[i1] * w1 + supp[i2] * w2 + supp[i3] * w3 + supp[i4] * w4 + supp[i5] * w5 + supp[i6] * w6 + supp[i7] * w7;
        oO[a] = o2[i0] * w0 + o2[i1] * w1 + o2[i2] * w2 + o2[i3] * w3 + o2[i4] * w4 + o2[i5] * w5 + o2[i6] * w6 + o2[i7] * w7;
      }
    }

  // --- 3. mixing + weather decay, written back into the main fields
  const Dturb = 0.004 + 0.01 * Math.hypot(D.windX, D.windZ);
  let alpha = (Dturb * dt) / (ah * ah);
  if (alpha > 0.14) alpha = 0.14;
  const relaxT = 1 - Math.exp(-(0.03 + 0.08 * D.rainFrac) * dt);
  const smokeKeep = Math.exp(-(0.0005 + 0.03 * D.rainFrac) * dt); // soot deposits slowly
  // steam: droplets evaporate quickly in dry air, linger in humid air / fog
  const steamKeep = Math.exp(-(0.01 + 0.12 * (1.02 - D.rh)) * dt);
  const fgasKeep = Math.exp(-dt / FLAME_TAU);
  const suppKeep = Math.exp(-0.05 * dt);
  for (let az = 0; az < anz; az++)
    for (let ay = 0; ay < any; ay++) {
      let a = anx * (ay + any * az);
      for (let ax = 0; ax < anx; ax++, a++) {
        // neighbour indices; open boundaries mix with ambient (-1), the ground is closed
        const xm = ax > 0 ? a - 1 : -1;
        const xp = ax + 1 < anx ? a + 1 : -1;
        const ym = ay > 0 ? a - anx : a;
        const yp = ay + 1 < any ? a + anx : -1;
        const zm = az > 0 ? a - sxy : -1;
        const zp = az + 1 < anz ? a + sxy : -1;
        // mixing only through open faces
        P[0] = ax > 0 ? passX[a - 1] : 1;
        P[1] = passX[a];
        P[2] = ay > 0 ? passY[a - anx] : 1;
        P[3] = passY[a];
        P[4] = az > 0 ? passZ[a - sxy] : 1;
        P[5] = passZ[a];
        const k = alpha * (1 - occ[a] * 0.8);
        let T = lap(oT, a, xm, xp, ym, yp, zm, zp, Tamb, k);
        T += (Tamb - T) * relaxT;
        airT[a] = T;
        smoke[a] = lap(oS, a, xm, xp, ym, yp, zm, zp, 0, k) * smokeKeep;
        smokeR[a] = lap(oR, a, xm, xp, ym, yp, zm, zp, 0, k) * smokeKeep;
        smokeG[a] = lap(oG, a, xm, xp, ym, yp, zm, zp, 0, k) * smokeKeep;
        smokeB[a] = lap(oB, a, xm, xp, ym, yp, zm, zp, 0, k) * smokeKeep;
        steam[a] = lap(oW, a, xm, xp, ym, yp, zm, zp, 0, k) * steamKeep;
        // CO2 / powder: carried with the gas, slowly diluting and settling; it
        // starves and inhibits the flames in its cell
        o2[a] = lap(oO, a, xm, xp, ym, yp, zm, zp, O2_AIR, k);
        const sp = lap(oX, a, xm, xp, ym, yp, zm, zp, 0, k) * suppKeep;
        supp[a] = sp;
        fgas[a] = lap(oF, a, xm, xp, ym, yp, zm, zp, 0, k) * fgasKeep * (sp > 0 ? Math.exp(-6 * sp * dt) : 1);
      }
    }

  // --- 4 + 5. heat exchange with solids (implicit, unconditionally stable),
  // sources, and flame presence
  const flameRefJ = FLAME_REF * ah3;
  let smokeTotal = 0;
  let steamTotal = 0;
  for (let a = 0; a < NA; a++) {
    const T = airT[a];
    const rho = 353 / (T + 273.15);
    const Ca = rho * CP_AIR * ah3 * (1 - 0.9 * occ[a]);
    let Tn = (Ca * T + dt * (airGT[a] + airQ[a])) / (Ca + dt * airG[a]);
    if (Tn > MAX_AIR_T) Tn = MAX_AIR_T;
    else if (Tn < Tamb - 30 && Tn < T) Tn = Math.min(T, Tamb - 30);
    airT[a] = Tn;
    const g = (fgas[a] += flameAcc[a] * dt);
    let f = Math.sqrt(g / flameRefJ);
    const hot = (Tn - 450) / 500;
    if (hot > f) f = hot;
    if (supp[a] > 0) f *= 1 - Math.min(1, supp[a]);
    flame[a] = f < 0 ? 0 : f > 1 ? 1 : f;
    smokeTotal += smoke[a];
    steamTotal += steam[a];
  }
  // closed spaces hold exactly their oxygen inventory
  conserveO2(w);
  sim.stats.smoke = smokeTotal;
  sim.stats.steam = steamTotal;
}

const P = new Float32Array(6); // open fraction of the 6 faces of the current cell

function lap(s, a, xm, xp, ym, yp, zm, zp, b, k) {
  const c = s[a];
  const sum =
    ((xm >= 0 ? s[xm] : b) - c) * P[0] +
    ((xp >= 0 ? s[xp] : b) - c) * P[1] +
    (s[ym] - c) * P[2] +
    ((yp >= 0 ? s[yp] : b) - c) * P[3] +
    ((zm >= 0 ? s[zm] : b) - c) * P[4] +
    ((zp >= 0 ? s[zp] : b) - c) * P[5];
  return c + k * sum;
}

function turbTable(w, key, n, freq, speed, t) {
  const name = '_turb_' + key;
  let arr = w[name];
  if (!arr || arr.length !== n) arr = w[name] = new Float32Array(n);
  for (let i = 0; i < n; i++) arr[i] = Math.sin(i * freq + t * speed);
  return arr;
}

