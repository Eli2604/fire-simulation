import { F_HIDDEN } from './world.js';

/**
 * Moving voxel bodies: the voxels of something that moves as one rigid body (a boat afloat: sim/
 * buoyancy.js; a car could use it the same way), kept in the body's own frame together with their
 * material state (temperature, fuel, char, moisture, burning, colour...), and stamped into the
 * world's grid wherever the body is now. So what happens to its material goes with it: a boat set
 * alight at its berth and rowed away keeps burning where it is; one adrift catches from a fire it
 * drifts into; heat soaked up in one place is still in it in the next; what burnt away stays gone.
 *
 * Each restamp (restamp):
 *   1. gather   the state of every voxel still in the grid is read back from its cell (what the fire,
 *               the water, the shots did to it); a cell that no longer holds its material (burnt to
 *               nothing, blown away, molten and run off) means that voxel is gone for good;
 *   2. lift     its cells are emptied;
 *   3. place    every voxel goes to the cell its centre is in at the new pose (or, taken, the next
 *               nearest one): a cell that is empty, or holds what may be pushed aside (opts.displace:
 *               water), takes it with all of its state. A voxel that finds no room (rotated onto a
 *               neighbour, in a pier) is kept off the grid for now, its state with it, and placed
 *               again at the next restamp;
 *   4. envelope with opts.inside (the body's envelope: a hull and the open inside it encloses),
 *               liquid inside the envelope at the new pose is pushed out (no pond water inside a
 *               boat), and with opts.refill the cells it left (inside the envelope at the old pose,
 *               not at the new one, under opts.refill.below) get that liquid back.
 * It is cheap enough to do several times a second (a few thousand voxels plus the envelope's box),
 * but every restamp makes the world rebuild its list of solids (World.rebuildLists, a pass over the
 * grid), so call it only when the body has moved a good part of a voxel (needsRestamp) and not
 * every frame. It leaves World.structureDirty alone (the voxels are the body's: anchored, held up by
 * whatever moves the body, not by what is under them).
 *
 * API
 *   const B = makeMovingBody(world, cells, localOf, { pose, tags })
 *       cells    the world voxel indices of its voxels as built (they are in the grid there now)
 *       localOf  (i) → [x, y, z]: voxel i's centre in the body frame
 *       pose     { p: [x, y, z], R: [9] row-major } the pose they were built at (world = p + R·local)
 *       tags     optional (k) → 0..255: a tag per voxel kept with it (a boat: 1 its planking)
 *   B.n, B.local (Float32Array 3n), B.at (Int32Array: its cell now, -1 off the grid), B.tag,
 *   B.cells (Set: the cells it is in now), B.pose (where it was last stamped), B.stamps
 *   needsRestamp(B, pose, h, frac = 0.5)  → whether some corner of it has moved over frac·h since
 *   restamp(world, B, pose, opts)          → { placed, off, gone, displaced, refilled }
 *       opts.displace(mat) → true: that material is pushed aside (default: none)
 *       opts.inside(x, y, z) → body-frame point inside its envelope; opts.bounds [[x0,y0,z0],[x1,y1,z1]] its box
 *       opts.liquid  the material id inside the envelope that is pushed out (with opts.inside)
 *       opts.refill  { mat, below (world y), temp }: the cells it left under that get mat back
 *   displaceLiquid(world, B, opts)  only step 4's push at the pose it is at (liquid that ran in since)
 *   syncBody(world, B)        gather only (no move): B's state as the grid has it now
 *   alive(B, k)               voxel k is still there (in the grid or held off it)
 *   bodyStats(world, B, tag)  → { n, left, char } over its voxels (with that tag, or all)
 *   worldOf(B, k, pose = B.pose) → voxel k's centre in the world
 *   clearFlag(world, B, mask) a flag off on all of it, in the grid and off it (F_HIDDEN: show it)
 *   ownsCell(B, i)            cell i holds one of its voxels
 *
 * Limitations: registries that keep voxel indices (doors, pick-ups, gas pipes, vessels) are not
 * told where the voxels went (the tags travel, the lists do not); the air's heat and smoke stay
 * where they were (the hot gas round a burning boat is left behind as it moves and makes new
 * flames where it is); a rotation leaves gaps and doubles where cells collide (the doubles are
 * held off the grid until the next pose has room for them).
 */

// the per-voxel state carried with it: [world field, typed array constructor, elements per voxel]
const FIELDS = [
  ['mat', Uint8Array, 1], ['temp', Float32Array, 1], ['skin', Float32Array, 1], ['fuel', Float32Array, 1], ['moist', Float32Array, 1],
  ['melt', Float32Array, 1], ['char', Float32Array, 1], ['tmax', Uint8Array, 1], ['flags', Uint8Array, 1], ['hrr', Float32Array, 1],
  ['dens', Float32Array, 1], ['skinMelt', Float32Array, 1], ['coat', Float32Array, 1], ['wetSkin', Float32Array, 1], ['paint', Uint8Array, 1],
  ['crack', Float32Array, 1], ['owner', Int16Array, 1], ['group', Int32Array, 1], ['vesselTag', Int16Array, 1], ['pickupTag', Int16Array, 1],
  ['doorTag', Int16Array, 1], ['tint', Uint8Array, 3],
];

export function makeMovingBody(w, cells, localOf, { pose, tags } = {}) {
  const n = cells.length;
  const B = { n, local: new Float32Array(3 * n), at: new Int32Array(n), tag: new Uint8Array(n), s: {}, cells: new Set(), pose: pose ?? { p: [0, 0, 0], R: [1, 0, 0, 0, 1, 0, 0, 0, 1] }, stamps: 0 };
  for (const [k, T, e] of FIELDS) B.s[k] = new T(n * e);
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < n; k++) {
    const i = cells[k];
    const l = localOf(i);
    for (let a = 0; a < 3; a++) {
      B.local[3 * k + a] = l[a];
      lo[a] = Math.min(lo[a], l[a]);
      hi[a] = Math.max(hi[a], l[a]);
    }
    B.at[k] = i;
    B.tag[k] = tags ? tags(k) : 0;
    if (w.mat[i]) B.cells.add(i);
    else B.at[k] = -1;
  }
  B.box = n ? [lo, hi] : [[0, 0, 0], [0, 0, 0]];
  syncBody(w, B);
  return B;
}

const xf = (pose, x, y, z, out) => {
  const R = pose.R, p = pose.p;
  out[0] = p[0] + R[0] * x + R[1] * y + R[2] * z;
  out[1] = p[1] + R[3] * x + R[4] * y + R[5] * z;
  out[2] = p[2] + R[6] * x + R[7] * y + R[8] * z;
  return out;
};
const _a = [0, 0, 0], _b = [0, 0, 0];

/** Voxel k's centre in the world (at its last stamped pose, or another). */
export function worldOf(B, k, pose = B.pose) {
  return xf(pose, B.local[3 * k], B.local[3 * k + 1], B.local[3 * k + 2], [0, 0, 0]);
}

/** Whether some corner of its box has moved more than frac·h since it was last stamped. */
export function needsRestamp(B, pose, h, frac = 0.5) {
  const [lo, hi] = B.box;
  const lim = (frac * h) ** 2;
  for (let c = 0; c < 8; c++) {
    const x = c & 1 ? hi[0] : lo[0], y = c & 2 ? hi[1] : lo[1], z = c & 4 ? hi[2] : lo[2];
    xf(B.pose, x, y, z, _a);
    xf(pose, x, y, z, _b);
    if ((_a[0] - _b[0]) ** 2 + (_a[1] - _b[1]) ** 2 + (_a[2] - _b[2]) ** 2 > lim) return true;
  }
  return false;
}

export function alive(B, k) {
  return B.s.mat[k] !== 0;
}

export function ownsCell(B, i) {
  return !!B && B.cells.has(i);
}

/** Read the state of its voxels back from the grid; one whose cell lost its material is gone. Returns how many went. */
export function syncBody(w, B) {
  let gone = 0;
  const S = B.s;
  for (let k = 0; k < B.n; k++) {
    const c = B.at[k];
    if (c < 0) continue;
    const m = w.mat[c];
    if (!m || (S.mat[k] && m !== S.mat[k])) {
      // (burnt away, blown off, molten and run off: what is in its cell now is not it)
      S.mat[k] = 0;
      B.at[k] = -1;
      B.cells.delete(c);
      gone++;
      continue;
    }
    for (const [f, , e] of FIELDS) {
      const src = w[f], dst = S[f];
      if (e === 1) dst[k] = src[c];
      else for (let j = 0; j < e; j++) dst[k * e + j] = src[c * e + j];
    }
  }
  return gone;
}

function lift(w, c) {
  w.mat[c] = 0;
  w.flags[c] = 0;
  w.fuel[c] = 0;
  w.hrr[c] = 0;
  w.owner[c] = -1;
  w.vesselTag[c] = 0;
  w.pickupTag[c] = 0;
  w.doorTag[c] = 0;
  w.coat[c] = 0;
  w.group[c] = 0;
  w.paint[c] = 0;
  w.crack[c] = 0;
  w.temp[c] = w.ambient;
  w.skin[c] = w.ambient;
}

function put(w, B, k, c) {
  const S = B.s;
  for (const [f, , e] of FIELDS) {
    const dst = w[f], src = S[f];
    if (e === 1) dst[c] = src[k];
    else for (let j = 0; j < e; j++) dst[c * e + j] = src[k * e + j];
  }
  w.dE[c] = 0;
  w.waterIn[c] = 0;
  B.at[k] = c;
  B.cells.add(c);
}

/** The world cells of its envelope at a pose (opts.inside over the box opts.bounds), with fn(cell). */
function envelope(w, pose, opts, fn) {
  const [lo, hi] = opts.bounds;
  const h = w.h;
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let c = 0; c < 8; c++) {
    xf(pose, c & 1 ? hi[0] : lo[0], c & 2 ? hi[1] : lo[1], c & 4 ? hi[2] : lo[2], _a);
    for (let a = 0; a < 3; a++) {
      mn[a] = Math.min(mn[a], _a[a]);
      mx[a] = Math.max(mx[a], _a[a]);
    }
  }
  const x0 = Math.max(0, Math.floor(mn[0] / h)), x1 = Math.min(w.nx - 1, Math.floor(mx[0] / h));
  const y0 = Math.max(0, Math.floor(mn[1] / h)), y1 = Math.min(w.ny - 1, Math.floor(mx[1] / h));
  const z0 = Math.max(0, Math.floor(mn[2] / h)), z1 = Math.min(w.nz - 1, Math.floor(mx[2] / h));
  const R = pose.R, p = pose.p;
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const dx = (x + 0.5) * h - p[0], dy = (y + 0.5) * h - p[1], dz = (z + 0.5) * h - p[2];
        // (the inverse of the rotation: its transpose)
        const lx = R[0] * dx + R[3] * dy + R[6] * dz, ly = R[1] * dx + R[4] * dy + R[7] * dz, lz = R[2] * dx + R[5] * dy + R[8] * dz;
        if (opts.inside(lx, ly, lz)) fn(x + w.nx * (y + w.ny * z), y);
      }
}

/**
 * Move it to `pose` in the grid (see the top): its state read back, its old cells emptied, its
 * voxels placed at the new pose, liquid pushed out of its envelope and given back where it left.
 */
export function restamp(w, B, pose, opts = {}) {
  const gone = syncBody(w, B);
  const S = B.s;
  const h = w.h;
  let visible = false;
  // the cells it held and its envelope at the old pose: where liquid may come back
  const left = [];
  if (opts.inside && opts.refill) envelope(w, B.pose, opts, (c, y) => {
    if ((y + 0.5) * h < opts.refill.below) left.push(c);
  });
  for (let k = 0; k < B.n; k++) {
    const c = B.at[k];
    if (c < 0) continue;
    if (!(S.flags[k] & F_HIDDEN)) visible = true;
    if (opts.refill && (Math.floor(c / w.nx) % w.ny + 0.5) * h < opts.refill.below) left.push(c);
    lift(w, c);
    B.at[k] = -1;
  }
  B.cells.clear();
  // liquid inside its envelope at the new pose: pushed out
  let displaced = 0;
  const inNew = opts.inside ? new Set() : null;
  if (opts.inside) envelope(w, pose, opts, (c) => {
    inNew.add(c);
    if (w.mat[c] && w.mat[c] === opts.liquid) {
      lift(w, c);
      displaced++;
    }
  });
  // its voxels at the new pose
  const { nx, ny, nz } = w;
  let placed = 0, off = 0;
  for (let k = 0; k < B.n; k++) {
    if (!S.mat[k]) continue;
    xf(pose, B.local[3 * k], B.local[3 * k + 1], B.local[3 * k + 2], _a);
    const fx = _a[0] / h, fy = _a[1] / h, fz = _a[2] / h;
    const x = Math.floor(fx), y = Math.floor(fy), z = Math.floor(fz);
    let c = -1;
    // its own cell, else the neighbour across the face its centre is nearest
    const ox = fx - x - 0.5, oy = fy - y - 0.5, oz = fz - z - 0.5;
    const ax = Math.abs(ox), ay = Math.abs(oy), az = Math.abs(oz);
    const alt = ax >= ay && ax >= az ? [Math.sign(ox) || 1, 0, 0] : ay >= az ? [0, Math.sign(oy) || 1, 0] : [0, 0, Math.sign(oz) || 1];
    for (const [dx, dy, dz] of [[0, 0, 0], alt]) {
      const X = x + dx, Y = y + dy, Z = z + dz;
      if (X < 0 || Y < 1 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue;
      const j = X + nx * (Y + ny * Z);
      if (B.cells.has(j)) continue;
      const m = w.mat[j];
      if (m && !(opts.displace && opts.displace(m))) continue;
      if (m) {
        lift(w, j);
        displaced++;
      }
      c = j;
      break;
    }
    if (c < 0) {
      off++;
      continue;
    }
    put(w, B, k, c);
    placed++;
    if (!(S.flags[k] & F_HIDDEN)) visible = true;
  }
  // the liquid back where it left
  let refilled = 0;
  if (opts.refill) {
    const R = opts.refill;
    for (const c of left) {
      if (w.mat[c] || B.cells.has(c) || (inNew && inNew.has(c))) continue;
      const sd = w.structureDirty;
      w.setVoxel(c, R.mat, { temp: R.temp ?? w.ambient, variation: 0.03 });
      w.structureDirty = sd;
      refilled++;
    }
  }
  B.pose = { p: pose.p.slice(), R: pose.R.slice() };
  B.stamps++;
  w.listDirty = true;
  if (visible || displaced || refilled || gone) w.geomVersion++;
  return { placed, off, gone, displaced, refilled };
}

/**
 * Liquid inside its envelope where it is (opts as restamp's: inside, bounds, liquid) pushed out
 * without moving it: what ran in through the gaps a rotation leaves between its voxels (a liquid
 * flows: sim/water.js). → how many cells.
 */
export function displaceLiquid(w, B, opts) {
  if (!opts.inside) return 0;
  let n = 0;
  envelope(w, B.pose, opts, (c) => {
    if (w.mat[c] && w.mat[c] === opts.liquid && !B.cells.has(c)) {
      lift(w, c);
      n++;
    }
  });
  if (n) {
    w.listDirty = true;
    w.geomVersion++;
  }
  return n;
}

/** Over its voxels (with tag, or all): how many there were, how many are left, their mean char. */
export function bodyStats(w, B, tag = -1) {
  let n = 0, left = 0, ch = 0;
  for (let k = 0; k < B.n; k++) {
    if (tag >= 0 && B.tag[k] !== tag) continue;
    n++;
    const c = B.at[k];
    if (c >= 0) {
      if (!w.mat[c] || w.mat[c] !== B.s.mat[k]) continue;
      left++;
      ch += w.char[c];
    } else if (B.s.mat[k]) {
      left++;
      ch += B.s.char[k];
    }
  }
  return { n, left, char: left ? ch / left : 0 };
}

/** A flag off on all of it (in its cells and on those held off the grid). */
export function clearFlag(w, B, mask) {
  for (let k = 0; k < B.n; k++) {
    B.s.flags[k] &= ~mask;
    const c = B.at[k];
    if (c >= 0 && w.mat[c] === B.s.mat[k]) w.flags[c] &= ~mask;
  }
  w.geomVersion++;
}
