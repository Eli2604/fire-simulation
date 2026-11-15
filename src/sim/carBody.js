import { F_ANCHOR, F_HIDDEN, F_BURNING, F_SMOLDER } from './world.js';
import { carRot } from './carPhysics.js';

/**
 * A car's voxels as a body of its own that moves with it (sim/cars.js): the voxels it was built
 * of (by their owner), taken out of the grid at its pose and put back in at the next, carrying
 * everything a voxel is (its material, temperature, fuel left, moisture, char, burning, its
 * vessel tag: the fuel tank and its petrol, its colour). So a burning car keeps burning as it
 * drives, its fire and smoke going with it, and what has burnt away stays gone.
 *
 * In its own frame (the model's: x forward, y up, z right) each voxel sits on a lattice of the
 * grid's spacing h (where it was built). Put at a pose (position, yaw, pitch, roll) it is resampled
 * into the grid: every cell in its box takes the voxel of the lattice point nearest to where that
 * cell's centre falls in the car's frame (nearest neighbour: no holes when it is turned, a voxel
 * may land in two cells or none for a while). Before that what is in the grid is read back: a
 * voxel's state is that of its copy in the grid (its temperature the mean of its copies, burning if
 * any copy burns, the least fuel and the most char); a voxel none of whose copies is still there
 * (burnt out, blown away, broken off) is gone for good. Cells taken by something else (the ground,
 * a wall, a man) are left alone: the car's voxel is not put there this time.
 *
 *   const B = captureBody(world, owner, origin, yaw);   // its voxels as built (by owner)
 *   stampBody(world, B, { x, y, z, yaw, pitch, roll }, { hidden }); // out of the old cells, into the new
 *   releaseBody(world, B);                               // left where it is (as plain voxels)
 *
 * The grid keeps its voxels anchored (F_ANCHOR: the support check does not drop a car's panels
 * off it as it moves), hidden (F_HIDDEN: render/cars.js draws the car) while it is on the move.
 */

// per-voxel arrays of the World that are not a voxel's state
const SKIP = new Set(['scanBuf', 'solids', 'activeSolids', 'tint']);

/** The World's per-voxel arrays (length N): what a voxel carries when it moves. */
export function voxelFields(w) {
  if (w._voxFields) return w._voxFields;
  const out = [];
  for (const k of Object.keys(w)) {
    const a = w[k];
    if (SKIP.has(k) || !ArrayBuffer.isView(a) || a.length !== w.N) continue;
    out.push(k);
  }
  w._voxFields = out;
  return out;
}

const KEY = (ix, iy, iz) => ix + 512 + 1024 * (iy + 512 + 1024 * (iz + 512));

/**
 * Take the voxels of `owner` as a body: their state, where they are in the car's frame (origin:
 * the model's origin in the world, yaw: its heading). Options: region(l) → a label for a voxel
 * at local l ('engine', ...): the body's parts.
 */
export function captureBody(w, owner, origin, yaw, o = {}) {
  if (w.listDirty) w.rebuildLists();
  const h = w.h;
  const R = carRot(yaw, 0, 0);
  const cells = [];
  for (let k = 0; k < w.solidCount; k++) {
    const i = w.solids[k];
    if (w.owner[i] === owner) cells.push(i);
  }
  const fields = voxelFields(w);
  const keys = new Map();
  const lat = [];
  const cellK = new Int32Array(Math.max(16, cells.length));
  let n = 0;
  const idxOf = [];
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  cells.forEach((i, j) => {
    const [x, y, z] = w.coords(i);
    const d = [(x + 0.5) * h - origin[0], (y + 0.5) * h - origin[1], (z + 0.5) * h - origin[2]];
    // R^T d: into the car's frame
    const l = [R[0] * d[0] + R[3] * d[1] + R[6] * d[2], R[1] * d[0] + R[4] * d[1] + R[7] * d[2], R[2] * d[0] + R[5] * d[1] + R[8] * d[2]];
    const ix = Math.round(l[0] / h), iy = Math.round(l[1] / h - 0.5), iz = Math.round(l[2] / h);
    const key = KEY(ix, iy, iz);
    let k = keys.get(key);
    if (k === undefined) {
      k = n++;
      keys.set(key, k);
      lat.push(ix, iy, iz);
      idxOf.push(i);
      for (let c = 0; c < 3; c++) {
        const v = [ix * h, (iy + 0.5) * h, iz * h][c];
        if (v < min[c]) min[c] = v;
        if (v > max[c]) max[c] = v;
      }
    }
    cellK[j] = k;
  });
  const state = {};
  for (const f of fields) {
    const A = w[f];
    const S = new A.constructor(n);
    for (let k = 0; k < n; k++) S[k] = A[idxOf[k]];
    state[f] = S;
  }
  const tint = new Uint8Array(n * 3);
  for (let k = 0; k < n; k++) for (let c = 0; c < 3; c++) tint[k * 3 + c] = w.tint[idxOf[k] * 3 + c];
  const B = {
    owner, h, n, n0: n, keys, lat: Int32Array.from(lat), state, tint, fields,
    alive: new Uint8Array(n).fill(1),
    placed: new Uint16Array(n), // copies put in the grid at the last stamp
    hiddenOwn: new Uint8Array(n), // hidden as built (drawn by a mesh anyway)
    cells: Int32Array.from(cells), cellK, nCells: cells.length,
    min, max,
    region: null,
    pose: null,
  };
  for (let k = 0; k < n; k++) B.hiddenOwn[k] = state.flags[k] & F_HIDDEN ? 1 : 0;
  for (let k = 0; k < n; k++) B.placed[k] = 0;
  for (let j = 0; j < cells.length; j++) B.placed[cellK[j]]++;
  if (o.region) {
    B.region = new Array(n);
    for (let k = 0; k < n; k++) B.region[k] = o.region([B.lat[k * 3] * h, (B.lat[k * 3 + 1] + 0.5) * h, B.lat[k * 3 + 2] * h], k, B);
  }
  return B;
}

/** Read the body's voxels back from the grid (their state now); the ones gone from it are gone. */
export function gatherBody(w, B) {
  const { fields, state, owner, n } = B;
  const seen = (B._seen ??= new Uint16Array(n));
  const tsum = (B._tsum ??= new Float32Array(n));
  seen.fill(0);
  tsum.fill(0);
  const temp = w.temp, mat = w.mat, own = w.owner;
  for (let j = 0; j < B.nCells; j++) {
    const i = B.cells[j];
    const k = B.cellK[j];
    if (!mat[i] || own[i] !== owner) continue;
    if (!seen[k]) {
      for (const f of fields) state[f][k] = w[f][i];
      for (let c = 0; c < 3; c++) B.tint[k * 3 + c] = w.tint[i * 3 + c];
    } else {
      // another copy: burning if either burns, the least fuel (a tank's contents: what its copies hold between them), the most char
      state.flags[k] |= w.flags[i] & (F_BURNING | F_SMOLDER);
      if (state.vesselTag[k] < 0) state.fuel[k] += w.fuel[i];
      else if (w.fuel[i] < state.fuel[k]) state.fuel[k] = w.fuel[i];
      if (w.char[i] > state.char[k]) state.char[k] = w.char[i];
    }
    seen[k]++;
    tsum[k] += temp[i];
  }
  for (let k = 0; k < n; k++) {
    if (seen[k]) state.temp[k] = tsum[k] / seen[k];
    else if (B.placed[k] && B.alive[k]) B.alive[k] = 0;
  }
}

/** Out of the grid: the cells it holds (still its own) emptied. */
export function liftBody(w, B) {
  const amb = w.ambient;
  for (let j = 0; j < B.nCells; j++) {
    const i = B.cells[j];
    if (!w.mat[i] || w.owner[i] !== B.owner) continue;
    w.mat[i] = 0;
    w.flags[i] = 0;
    w.fuel[i] = 0;
    w.hrr[i] = 0;
    w.owner[i] = -1;
    w.vesselTag[i] = 0;
    w.coat[i] = 0;
    w.group[i] = 0;
    w.paint[i] = 0;
    w.crack[i] = 0;
    w.pickupTag[i] = 0;
    w.doorTag[i] = 0;
    w.temp[i] = amb;
    w.skin[i] = amb;
  }
  B.nCells = 0;
}

/**
 * Put the body in the grid at pose { x, y, z, yaw, pitch, roll } (its old cells read back and
 * emptied first). o.hidden: drawn by its mesh (render/cars.js), not as voxels. Returns the
 * number of cells it took and how many it found taken by something else (blocked).
 */
export function stampBody(w, B, pose, o = {}) {
  gatherBody(w, B);
  liftBody(w, B);
  const h = w.h;
  const R = carRot(pose.yaw, pose.pitch ?? 0, pose.roll ?? 0);
  // its box in the world
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let c = 0; c < 8; c++) {
    const l = [c & 1 ? B.max[0] + h : B.min[0] - h, c & 2 ? B.max[1] + h : B.min[1] - h, c & 4 ? B.max[2] + h : B.min[2] - h];
    const p = [pose.x + R[0] * l[0] + R[1] * l[1] + R[2] * l[2], pose.y + R[3] * l[0] + R[4] * l[1] + R[5] * l[2], pose.z + R[6] * l[0] + R[7] * l[1] + R[8] * l[2]];
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[k]);
      hi[k] = Math.max(hi[k], p[k]);
    }
  }
  const x0 = Math.max(0, Math.floor(lo[0] / h)), x1 = Math.min(w.nx - 1, Math.floor(hi[0] / h));
  const y0 = Math.max(1, Math.floor(lo[1] / h)), y1 = Math.min(w.ny - 1, Math.floor(hi[1] / h));
  const z0 = Math.max(0, Math.floor(lo[2] / h)), z1 = Math.min(w.nz - 1, Math.floor(hi[2] / h));
  const need = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
  if (B.cells.length < Math.min(need, B.n * 3 + 64)) {
    B.cells = new Int32Array(Math.min(need, B.n * 3 + 64));
    B.cellK = new Int32Array(B.cells.length);
  }
  B.placed.fill(0);
  const { fields, state, keys, alive } = B;
  const mat = w.mat;
  let n = 0, blocked = 0;
  const hide = !!o.hidden;
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const dx = (x + 0.5) * h - pose.x, dy = (y + 0.5) * h - pose.y, dz = (z + 0.5) * h - pose.z;
        const lx = R[0] * dx + R[3] * dy + R[6] * dz, ly = R[1] * dx + R[4] * dy + R[7] * dz, lz = R[2] * dx + R[5] * dy + R[8] * dz;
        const k = keys.get(KEY(Math.round(lx / h), Math.round(ly / h - 0.5), Math.round(lz / h)));
        if (k === undefined || !alive[k]) continue;
        const i = x + w.nx * (y + w.ny * z);
        if (mat[i]) {
          blocked++;
          continue;
        }
        if (n >= B.cells.length) {
          const c2 = new Int32Array(B.cells.length * 2), k2 = new Int32Array(B.cells.length * 2);
          c2.set(B.cells);
          k2.set(B.cellK);
          B.cells = c2;
          B.cellK = k2;
        }
        for (const f of fields) w[f][i] = state[f][k];
        for (let c = 0; c < 3; c++) w.tint[i * 3 + c] = B.tint[k * 3 + c];
        w.flags[i] = (state.flags[k] | F_ANCHOR) & (hide || B.hiddenOwn[k] ? 0xff : ~F_HIDDEN & 0xff);
        if (hide) w.flags[i] |= F_HIDDEN;
        B.cells[n] = i;
        B.cellK[n] = k;
        n++;
        B.placed[k]++;
      }
  // a vessel's contents put in more than one cell share what that voxel held (the tank holds what it held)
  for (let j = 0; j < n; j++) {
    const k = B.cellK[j];
    if (B.placed[k] > 1 && state.vesselTag[k] < 0) w.fuel[B.cells[j]] = state.fuel[k] / B.placed[k];
  }
  B.nCells = n;
  B.pose = { x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw, pitch: pose.pitch ?? 0, roll: pose.roll ?? 0 };
  B.hidden = hide;
  w.listDirty = true;
  w.structureDirty = true;
  w.geomVersion++;
  return { cells: n, blocked };
}

/** How much of it is left (0..1: voxels still there of those it was built of). */
export const bodyLeft = (B) => {
  let a = 0;
  for (let k = 0; k < B.n; k++) a += B.alive[k];
  return a / Math.max(1, B.n0);
};

/** Its voxels of a region (B.region labels): { n, alive, char (mean), hot (share over T °C), burning }. */
export function regionState(B, label, T = 350) {
  let n = 0, alive = 0, ch = 0, hot = 0, burning = 0;
  for (let k = 0; k < B.n; k++) {
    if (B.region?.[k] !== label) continue;
    n++;
    if (!B.alive[k]) continue;
    alive++;
    ch += B.state.char[k];
    if (B.state.temp[k] > T) hot++;
    if (B.state.flags[k] & (F_BURNING | F_SMOLDER)) burning++;
  }
  return { n, alive, char: alive ? ch / alive : 1, hot: alive ? hot / alive : 0, burning };
}

/** Is any of it burning (flaming)? */
export function bodyBurning(B) {
  for (let k = 0; k < B.n; k++) if (B.alive[k] && B.state.flags[k] & F_BURNING) return true;
  return false;
}
