/**
 * Fire on a chunk in flight (physics/simPhysics.js): while a voxel chunk is a rigid body its voxels
 * are off the grid (their state held in the moving body, sim/movingBody.js), so the solid pass of
 * sim/simulation.js does not see them. This steps their combustion where the body is now, with
 * the same laws the solid pass uses for a voxel with exposed faces:
 *
 *  - a burning voxel with fuel pyrolyses at its material's rate (fine fuel: its residence time
 *    burnTime; bulk fuel: burnRate per exposed face area), faster the hotter its surface, and the
 *    rush of air past it (a tumbling brand burns brighter; it is not blown out at these speeds);
 *  - the heat it releases goes into the air cell it is passing through (flames, hot gas,
 *    radiation, the oxygen it uses) and its smoke with it: a burning chunk leaves a trail of hot
 *    smoke and flames along its path instead of the fire pausing until it lands;
 *  - part of the heat keeps its surface at burning temperature; its neighbours in the chunk heat
 *    up and catch; voxels that are not burning cool towards the air they fly through;
 *  - burnt out it turns into its residue (char, ash) or is gone, as in the grid.
 *
 * The air round it is dragged along (simPhysics.js: sim/bodyAir.js dragAir, as a moving car).
 * The heat and flames go into the air sources (airQ, flameAcc, radSrc) and the smoke into the
 * smoke fields: both reach the GPU air (sim/gpu: sources each step, CPU edits uploaded).
 *
 * Everything stays in the body's state (B.s), so the restamp when it lands puts it back into the
 * grid as it is now: still burning, with the fuel it has left.
 */
import { MATERIALS, cpAt } from '../sim/materials.js';

import { F_BURNING } from '../sim/world.js';
const RAD_FRACTION = 0.3; // (as sim/simulation.js)

/** The chunk's neighbour table (6 per voxel, -1: none) and exposed faces, from its body-frame voxel centres. */
export function chunkTopology(c) {
  const B = c.B, n = B.n, h = c.h;
  const key = (x, y, z) => `${Math.round(x / h)},${Math.round(y / h)},${Math.round(z / h)}`;
  const at = new Map();
  for (let k = 0; k < n; k++) at.set(key(B.local[3 * k], B.local[3 * k + 1], B.local[3 * k + 2]), k);
  const nbr = new Int32Array(6 * n).fill(-1);
  const D = [[h, 0, 0], [-h, 0, 0], [0, h, 0], [0, -h, 0], [0, 0, h], [0, 0, -h]];
  for (let k = 0; k < n; k++)
    for (let f = 0; f < 6; f++) {
      const j = at.get(key(B.local[3 * k] + D[f][0], B.local[3 * k + 1] + D[f][1], B.local[3 * k + 2] + D[f][2]));
      if (j !== undefined) nbr[6 * k + f] = j;
    }
  c.nbr = nbr;
  return nbr;
}

/** Is anything on the chunk burning or hot (worth stepping)? */
export function chunkIsHot(c) {
  const S = c.B.s;
  for (let k = 0; k < c.B.n; k++) if (S.mat[k] && (S.flags[k] & F_BURNING || S.skin[k] > 120 || S.temp[k] > 120)) return true;
  return false;
}

/**
 * One step of the chunk's fire (dt s) at the body's pose now. sim: the simulation (its air,
 * airShare, consumeO2Near). Returns { burning, q (W released), fuelUsed (kg) }.
 */
export function stepChunkFire(sim, c, dt) {
  const w = sim.world;
  const B = c.B, S = B.s, n = B.n, h = c.h;
  const body = c.body;
  const V = h ** 3;
  const nbr = c.nbr ?? chunkTopology(c);
  const share = sim.airShare ?? 1;
  const Tamb = w.ambient ?? 15;
  const speed = Math.hypot(body.vel[0], body.vel[1], body.vel[2]);
  // the rush of air past a flying brand feeds it (forced convection: ~√ of the speed), up to 2.5×
  const windO2 = Math.min(2.5, 1 + 0.35 * Math.sqrt(speed));
  // forced-convection film coefficient for cooling (W/m²K)
  const hc = 10 + 6 * Math.sqrt(speed);
  const p = [0, 0, 0], l = [0, 0, 0];
  let burning = 0, Q = 0, used = 0, gone = 0;
  for (let k = 0; k < n; k++) {
    const m = S.mat[k];
    if (!m) continue;
    const M = MATERIALS[m];
    let f = S.flags[k];
    let ex = 0;
    for (let q = 0; q < 6; q++) {
      const j = nbr[6 * k + q];
      if (j < 0 || !S.mat[j]) ex++;
    }
    if (ex === 0) continue; // (inside the chunk: nothing reaches it)
    let Ts = S.skin[k], T = S.temp[k];
    const hot = f & F_BURNING || Ts > 60 || T > 60;
    if (!hot && !(M.combustible && Ts >= M.ignitionTemp)) continue;
    // where it is: its air cell
    l[0] = B.local[3 * k];
    l[1] = B.local[3 * k + 1];
    l[2] = B.local[3 * k + 2];
    body.shapeToWorld(l, p);
    const ax = Math.floor(p[0] / w.ah), ay = Math.floor(p[1] / w.ah), az = Math.floor(p[2] / w.ah);
    const a = ax >= 0 && ay >= 0 && az >= 0 && ax < w.anx && ay < w.any && az < w.anz ? w.airIdx(ax, ay, az) : -1;
    const Tair = a >= 0 ? w.airT[a] : Tamb;
    const dens = S.dens[k] || 1;
    const Cvox = M.density * dens * V * cpAt(m, T); // (its specific heat at its temperature: sim/materials.js)
    const A = ex * h * h;
    let q = 0;
    if (M.combustible && S.fuel[k] > 0) {
      const mo = S.moist[k];
      const wetOk = mo < (M.extinctionMoisture ?? 0.3);
      if (!(f & F_BURNING) && Ts >= M.ignitionTemp && wetOk) f |= F_BURNING;
      if (f & F_BURNING) {
        if (Ts < M.ignitionTemp - 120 || !wetOk) f &= ~F_BURNING;
        else {
          const res = M.residue ?? 0;
          const fuelMass0 = M.density * dens * V * (1 - res);
          let tf = 0.6 + (Ts - M.ignitionTemp) / 500;
          if (tf > 1.2) tf = 1.2;
          const faces = ex < 3 ? ex : 3;
          let dm = M.burnTime > 0 ? ((fuelMass0 / M.burnTime) * tf * windO2 * dt * faces) / 3 : M.burnRate * h * h * faces * tf * windO2 * dt;
          dm = Math.min(dm, S.fuel[k] * fuelMass0);
          S.fuel[k] -= dm / fuelMass0;
          used += dm;
          q = (dm * M.heatOfCombustion) / Math.max(dt, 1e-6);
          // the surface held at burning temperature by its own flame
          const cap = M.maxBurnTemp ?? 900;
          if (Ts < cap) Ts = Math.min(cap, Ts + (q * (M.selfHeating ?? 0.1) * dt) / Math.max(1e-6, Cvox * 0.3));
          const toAir = q * (1 - (M.selfHeating ?? 0.1) - RAD_FRACTION);
          if (a >= 0) {
            w.airQ[a] += toAir * share;
            w.radSrc[a] += q * RAD_FRACTION * share;
            w.flameAcc[a] += q * share;
            const Hc = M.heatOfCombustion || 1;
            const sm = (q * dt * (M.smokeYield ?? 0.01)) / Hc;
            w.smoke[a] += sm;
            const sc = M.smokeColor ?? [0.3, 0.3, 0.3];
            w.smokeR[a] += sm * sc[0];
            w.smokeG[a] += sm * sc[1];
            w.smokeB[a] += sm * sc[2];
            sim.consumeO2Near?.(a, q * share, dt);
            if (c.path && c.path[c.path.length - 1] !== a) {
              c.path.push(a);
              if (c.path.length > 64) c.path.shift();
            }
          }
          const ch = 0.35 + 0.65 * (1 - S.fuel[k]);
          if (S.char[k] < ch) S.char[k] = ch;
          // its neighbours on the chunk heat up (and catch)
          for (let e = 0; e < 6; e++) {
            const j = nbr[6 * k + e];
            if (j < 0 || !S.mat[j]) continue;
            const N = MATERIALS[S.mat[j]];
            const Cj = N.density * (S.dens[j] || 1) * V * cpAt(S.mat[j], S.skin[j]) * 0.3;
            S.skin[j] = Math.min(Math.max(S.skin[j], Ts), S.skin[j] + (q * 0.03 * dt) / Math.max(1e-6, Cj));
          }
          burning++;
          Q += q;
          if (S.fuel[k] <= 1e-6) {
            // burnt out: its residue, or gone
            if (M.residueId) {
              const R = MATERIALS[M.residueId];
              S.mat[k] = M.residueId;
              S.fuel[k] = 1;
              S.char[k] = 1;
              f = R.combustible && Ts >= R.ignitionTemp ? f | F_BURNING : f & ~F_BURNING;
            } else {
              S.mat[k] = 0;
              f = 0;
              gone++;
            }
          }
        }
      }
    }
    if (!(f & F_BURNING)) {
      // cooling towards the air it flies through (convection; radiation when hot)
      const sig = 5.67e-8 * (M.emissivity ?? 0.9);
      const loss = (hc * (Ts - Tair) + sig * ((Ts + 273) ** 4 - (Tair + 273) ** 4)) * A * dt;
      const dT = loss / Math.max(1e-6, Cvox * 0.3);
      Ts -= Math.abs(dT) > Math.abs(Ts - Tair) ? Ts - Tair : dT;
      if (a >= 0) w.airQ[a] += (loss / Math.max(dt, 1e-6)) * share; // (the heat it gives off warms the air there)
      T += (Ts - T) * Math.min(1, dt * 0.5);
    } else T += (Ts - T) * Math.min(1, dt * 0.3);
    S.skin[k] = Ts;
    S.temp[k] = T;
    S.flags[k] = f;
  }
  if (gone) w.geomVersion++;
  return { burning, q: Q, fuelUsed: used };
}
