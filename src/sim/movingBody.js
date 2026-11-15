import { F_HIDDEN, F_ANCHOR, F_BURNING, F_SMOLDER, F_FALLING, F_LIQUID } from './world.js';
import { MATERIALS } from './materials.js';
import { launchVoxel } from './vessels.js';
import { carryAir } from './bodyAir.js';

/**
 * Moving voxel bodies: the voxels of something that moves as one rigid body (a boat afloat:
 * sim/buoyancy.js stampFloat; a car: sim/cars.js through sim/carBody.js), kept in the body's own
 * frame together with their material state (temperature, fuel, char, moisture, burning, colour,
 * vessel tags...), and stamped into the world's grid wherever the body is now. So what happens to
 * its material goes with it: a boat set alight at its berth and rowed away keeps burning where it
 * is; a car's tank keeps its petrol; heat soaked up in one place is still in it in the next; what
 * burnt away stays gone; a panel burnt loose falls off.
 *
 * Its frame is the grid it was built in (its build pose P0): voxel k is the build cell (bx, by,
 * bz). Put at a pose P every grid cell in its box takes the voxel of the build cell its centre
 * falls in, mapped back through P0·P⁻¹ (nearest neighbour on the build lattice): no gaps when it
 * is turned, whatever the angle (a voxel may be in two cells or in none for a while, as the
 * lattice and the grid cross: its state is kept, it comes back at the next pose).
 *
 * Each restamp (restamp):
 *   1. gather   the state of every voxel is read back from its copies in the grid (temperature their
 *               mean, burning if any burns, the most char, the least fuel; a vessel's contents: what
 *               all of its copies hold between them, so a tank holds what it held); a voxel none of
 *               whose copies is still there (burnt to nothing, blown away, molten and run off) is
 *               gone for good; a door's voxels taken out by opening it are held, not lost;
 *   2. lift     its cells are emptied;
 *   3. place    each cell of its box at the new pose takes its voxel (above): a cell that is empty,
 *               or holds what may be pushed aside (opts.displace: water), takes it with all of its
 *               state; one taken by something else (the ground, a pier, a man) is left alone;
 *   4. envelope with opts.inside (the body's envelope: a hull and the open inside it encloses),
 *               liquid inside the envelope at the new pose is pushed out (no pond water inside a
 *               boat), and with opts.refill the cells it left (inside the envelope at the old pose,
 *               not at the new one, under opts.refill.below) get that liquid back;
 *   5. seals    each vessel whose shell is part of it (a car's fuel tank) is checked again: a shell
 *               voxel really gone is a hole (it leaks), the shell's count as it lies now is what the
 *               vessel model (sim/vessels.js) compares with (no false leak from turning it);
 *   6. pieces   a part only held on by voxels that are gone now (a panel burnt through, a plank
 *               burnt loose) separates: its voxels fall as debris with the body's speed;
 *   7. lists    what keeps voxel indices (doors, pick-ups, gas pipes) is told where they are now;
 *               the world's solid list and the air's view of the solids are patched for the cells
 *               that changed (no pass over the whole grid);
 *   8. air      with opts.air the air inside its envelope (a cabin, a hull) goes with it
 *               (sim/bodyAir.js carryAir: temperature, smoke, steam, burning gas, oxygen).
 * Call it when it has moved a good part of a voxel (needsRestamp), not every frame.
 *
 * API
 *   const B = makeMovingBody(world, cells, localOf?, { pose, tags, owner, anchor })
 *       cells    the world voxel indices of its voxels as built (they are in the grid there now)
 *       pose     { p: [x, y, z], R: [9] row-major } the pose they were built at (world = p + R·local)
 *       tags     optional (k, cell) → 0..255: a tag per voxel kept with it (a boat: 1 its planking)
 *       owner    its voxels' owner (w.owner): a copy whose material changed to its residue (wood to
 *                charcoal) is still it; without one a changed material means it is gone
 *       anchor   F_ANCHOR on its voxels in the grid (held by what moves it, not by what is under it)
 *       seal     optional (k, cell) → true: voxel k is of a shell that must stay tight (a boat's
 *                planking, a tank's shell): placed a little wider (see place), so a liquid finds
 *                no joint between its voxels at any angle
 *       (localOf is not needed: the local frame is the build pose's)
 *   B.n, B.local (Float32Array 3n: body frame), B.at (Int32Array: a cell it is in now, -1 none),
 *   B.tag, B.s (its voxels' state: B.s.mat[k] 0 = gone), B.cells (Set: the cells it is in now),
 *   B.pose (where it was last stamped), B.stamps
 *   needsRestamp(B, pose, h, frac = 0.5)  → whether some corner of it has moved over frac·h since
 *   restamp(world, B, pose, opts)          → { placed, blocked, off, gone, displaced, refilled, detached }
 *       opts.displace(mat) → true: that material is pushed aside (default: none)
 *       opts.inside(x, y, z) → body-frame point inside its envelope; opts.bounds [[x0,y0,z0],[x1,y1,z1]] its box
 *       opts.liquid  the material id inside the envelope that is pushed out (with opts.inside)
 *       opts.refill  { mat, below (world y), temp }: the cells it left under that get mat back
 *       opts.hidden  true: hidden in the grid (a mesh draws it); false: as built; undefined: as they are
 *       opts.vel     { v: [3], w: [3] } its velocity and spin (what falls off flies with it)
 *       opts.air     { inside(x, y, z) } its air (a cabin) goes with it (sim/bodyAir.js)
 *   displaceLiquid(world, B, opts)  only step 4's push at the pose it is at (liquid that ran in since)
 *   syncBody(world, B)        gather only (no move): B's state as the grid has it now → how many went
 *   releaseBody(world, B)     its voxels left where they are as plain voxels (no longer anchored by it)
 *   alive(B, k)               voxel k is still there (in the grid or held off it)
 *   bodyStats(world, B, tag)  → { n, left, char } over its voxels (with that tag, or all)
 *   bodyLeft(B)               0..1 of its voxels still there
 *   worldOf(B, k, pose = B.pose) → voxel k's centre in the world
 *   clearFlag(world, B, mask) a flag off on all of it, in the grid and off it (F_HIDDEN: show it)
 *   ownsCell(B, i)            cell i holds one of its voxels
 *   copiesOf(B, k)            the cells voxel k is in now
 *
 * Limitations: a voxel may be in two cells or none while the lattice is turned against the grid
 * (a turned body is a resampling of the one built); cells taken by something else are not taken
 * (it passes through what it hits only if its driver lets it: sim/cars.js); what falls off falls
 * as debris (sim/vessels.js stepDebris), not as a rigid piece.
 */

// the per-voxel state carried with it: [world field, typed array constructor, elements per voxel]
const FIELDS = [
  ['mat', Uint8Array, 1], ['temp', Float32Array, 1], ['skin', Float32Array, 1], ['fuel', Float32Array, 1], ['moist', Float32Array, 1],
  ['melt', Float32Array, 1], ['char', Float32Array, 1], ['tmax', Uint8Array, 1], ['flags', Uint8Array, 1], ['hrr', Float32Array, 1],
  ['dens', Float32Array, 1], ['skinMelt', Float32Array, 1], ['coat', Float32Array, 1], ['wetSkin', Float32Array, 1], ['paint', Uint8Array, 1],
  ['crack', Float32Array, 1], ['owner', Int16Array, 1], ['group', Int32Array, 1], ['vesselTag', Int16Array, 1], ['pickupTag', Int16Array, 1],
  ['doorTag', Int16Array, 1], ['tint', Uint8Array, 3],
];
const SCALARS = FIELDS.filter((f) => f[2] === 1).map((f) => f[0]);
const GRANULAR = Uint8Array.from(MATERIALS, (m) => (m.granular ? 1 : 0));
const IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function makeMovingBody(w, cells0, localOf, { pose, tags, owner = -1, anchor = false, seal = null } = {}) {
  const h = w.h;
  // (each cell once)
  const cells = [...new Set(cells0)];
  const n = cells.length;
  const P0 = pose ? { p: pose.p.slice(), R: pose.R.slice() } : { p: [0, 0, 0], R: IDENT.slice() };
  const B = {
    n, h, owner, anchor,
    local: new Float32Array(3 * n), at: new Int32Array(n).fill(-1), tag: new Uint8Array(n), s: {},
    lat: new Int32Array(3 * n), // its build cell
    copies: new Uint16Array(n), // its copies in the grid at the last stamp
    held: new Int32Array(n).fill(-1), // a voxel taken out by its door opening: the cell it goes back to
    hiddenOwn: new Uint8Array(n), anchorOwn: new Uint8Array(n),
    cells: new Set(),
    cellList: new Int32Array(Math.max(64, n * 2)), cellK: new Int32Array(Math.max(64, n * 2)), nCells: 0,
    prim: new Uint8Array(Math.max(64, n * 2)), // a copy where its lattice cell is (not one put wider to keep a shell tight)
    pose: P0, pose0: P0, airPose: P0,
    stamps: 0,
    refs: [],
    vesselSum: new Map(), // a vessel's contents (tag) → Σ fuel·dens over its copies
  };
  for (const [k, T, e] of FIELDS) B.s[k] = new T(n * e);
  B.state = B.s; // (as sim/carBody.js had it)
  // its build lattice: the grid cells it was built in, in a box of its own
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const llo = [Infinity, Infinity, Infinity], lhi = [-Infinity, -Infinity, -Infinity];
  const R0 = P0.R, p0 = P0.p;
  for (let k = 0; k < n; k++) {
    const c = w.coords(cells[k]);
    for (let a = 0; a < 3; a++) {
      B.lat[3 * k + a] = c[a];
      lo[a] = Math.min(lo[a], c[a]);
      hi[a] = Math.max(hi[a], c[a]);
    }
    const dx = (c[0] + 0.5) * h - p0[0], dy = (c[1] + 0.5) * h - p0[1], dz = (c[2] + 0.5) * h - p0[2];
    const l = [R0[0] * dx + R0[3] * dy + R0[6] * dz, R0[1] * dx + R0[4] * dy + R0[7] * dz, R0[2] * dx + R0[5] * dy + R0[8] * dz];
    for (let a = 0; a < 3; a++) {
      B.local[3 * k + a] = l[a];
      llo[a] = Math.min(llo[a], l[a]);
      lhi[a] = Math.max(lhi[a], l[a]);
    }
    B.tag[k] = tags ? tags(k, cells[k]) : 0;
    if (seal && seal(k, cells[k])) (B.seal ??= new Uint8Array(n))[k] = 1;
  }
  void localOf;
  if (!n) {
    lo.fill(0);
    hi.fill(0);
    llo.fill(0);
    lhi.fill(0);
  }
  B.box = [llo, lhi];
  B.latLo = lo;
  B.latDim = [hi[0] - lo[0] + 1, hi[1] - lo[1] + 1, hi[2] - lo[2] + 1];
  B.latIdx = new Int32Array(B.latDim[0] * B.latDim[1] * B.latDim[2]).fill(-1);
  for (let k = 0; k < n; k++) B.latIdx[latKey(B, B.lat[3 * k], B.lat[3 * k + 1], B.lat[3 * k + 2])] = k;
  // (the lattice cells next to a shell voxel: only there is a cell put a little wider: place)
  if (B.seal) {
    const [DX, DY, DZ] = B.latDim;
    B.nearSeal = new Uint8Array(B.latIdx.length);
    for (let k = 0; k < n; k++) {
      if (!B.seal[k]) continue;
      const x = B.lat[3 * k] - lo[0], y = B.lat[3 * k + 1] - lo[1], z = B.lat[3 * k + 2] - lo[2];
      for (let dz = -1; dz <= 1; dz++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const X = x + dx, Y = y + dy, Z = z + dz;
            if (X >= 0 && Y >= 0 && Z >= 0 && X < DX && Y < DY && Z < DZ) B.nearSeal[X + DX * (Y + DY * Z)] = 1;
          }
    }
  }
  // in the grid as built
  for (let k = 0; k < n; k++) {
    const i = cells[k];
    if (!w.mat[i]) continue;
    B.cellList[B.nCells] = i;
    B.prim[B.nCells] = 1;
    B.cellK[B.nCells++] = k;
    B.copies[k] = 1;
    B.at[k] = i;
    B.cells.add(i);
    B.hiddenOwn[k] = w.flags[i] & F_HIDDEN ? 1 : 0;
    B.anchorOwn[k] = w.flags[i] & F_ANCHOR ? 1 : 0;
    for (const [f, , e] of FIELDS) for (let j = 0; j < e; j++) B.s[f][k * e + j] = w[f][i * e + j];
  }
  syncBody(w, B);
  // the parts it is made of as built (what is in one piece now and comes apart later falls off)
  B.part = components(B, null);
  // the vessels whose shell is part of it (sim/vessels.js): their shells' voxels as built
  B.vessels = new Map();
  for (let k = 0; k < n; k++) {
    const t = B.s.vesselTag[k];
    if (t > 0) B.vessels.set(t, (B.vessels.get(t) ?? 0) + (B.s.mat[k] ? 1 : 0));
  }
  // registries that keep voxel indices: doors, pick-ups, gas pipes (by voxel, to be told where they are)
  const kOf = new Map(cells.map((c, k) => [c, k]));
  const ref = (obj, key) => {
    const arr = obj?.[key];
    if (!Array.isArray(arr) || !arr.length) return;
    const ks = [];
    for (const i of arr) {
      const k = kOf.get(i);
      if (k !== undefined) ks.push(k);
    }
    if (ks.length) B.refs.push({ obj, key, ks: Int32Array.from(ks), all: ks.length === arr.length });
  };
  for (const d of w.doors ?? []) {
    ref(d, 'voxels');
    ref(d, 'glass');
  }
  for (const p of w.pickups ?? []) ref(p, 'voxels');
  for (const g of w.gasPipes ?? []) ref(g, 'voxels');
  return B;
}

const latKey = (B, x, y, z) => x - B.latLo[0] + B.latDim[0] * (y - B.latLo[1] + B.latDim[1] * (z - B.latLo[2]));

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

/** Whether some corner of its box has moved more than frac·h since it was last stamped (or since `from`). */
export function needsRestamp(B, pose, h, frac = 0.5, from = B.pose) {
  const [lo, hi] = B.box;
  const lim = (frac * h) ** 2;
  for (let c = 0; c < 8; c++) {
    const x = c & 1 ? hi[0] : lo[0], y = c & 2 ? hi[1] : lo[1], z = c & 4 ? hi[2] : lo[2];
    xf(from, x, y, z, _a);
    xf(pose, x, y, z, _b);
    if ((_a[0] - _b[0]) ** 2 + (_a[1] - _b[1]) ** 2 + (_a[2] - _b[2]) ** 2 > lim) return true;
  }
  return false;
}

export function alive(B, k) {
  return B.s.mat[k] !== 0;
}

/** 0..1: how much of it is left (voxels still there of those it was built of). */
export function bodyLeft(B) {
  let a = 0;
  for (let k = 0; k < B.n; k++) if (B.s.mat[k]) a++;
  return a / Math.max(1, B.n);
}

export function ownsCell(B, i) {
  return !!B && B.cells.has(i);
}

/** The cells voxel k is in now. */
export function copiesOf(B, k) {
  const out = [];
  for (let j = 0; j < B.nCells; j++) if (B.cellK[j] === k) out.push(B.cellList[j]);
  return out;
}

/** Does cell c still hold body voxel k (not something else that took its place)? */
function holds(w, B, c, k) {
  const m = w.mat[c];
  if (!m || w.flags[c] & F_FALLING) return false;
  if (B.owner >= 0) return w.owner[c] === B.owner && !GRANULAR[m] && (m === B.s.mat[k] || !(w.flags[c] & F_LIQUID) || B.s.vesselTag[k] < 0);
  return m === B.s.mat[k];
}

/**
 * Read the state of its voxels back from the grid (see the top: gather); one none of whose copies
 * is still there is gone. Returns how many went (their indices in B.goneNow).
 */
export function syncBody(w, B) {
  const S = B.s;
  const n = B.n;
  const seen = (B._seen ??= new Uint16Array(n));
  const tsum = (B._tsum ??= new Float32Array(n));
  seen.fill(0);
  B.vesselSum.clear();
  const src = SCALARS.map((f) => w[f]), dst = SCALARS.map((f) => S[f]);
  const nf = src.length;
  const { temp, flags, fuel, char, dens, vesselTag } = w;
  const wt = w.tint, st = S.tint;
  const goneNow = (B.goneNow ??= []);
  goneNow.length = 0;
  let keep = 0;
  const heldCell = (B.heldCell ??= new Map());
  const sec = (B._sec ??= []);
  sec.length = 0;
  // a copy of voxel k in cell c: the first its state; the others: burning if either burns, the most char, the least fuel
  const take = (c, k) => {
    if (!seen[k]) {
      for (let f = 0; f < nf; f++) dst[f][k] = src[f][c];
      st[3 * k] = wt[3 * c];
      st[3 * k + 1] = wt[3 * c + 1];
      st[3 * k + 2] = wt[3 * c + 2];
      tsum[k] = temp[c];
    } else {
      S.flags[k] |= flags[c] & (F_BURNING | F_SMOLDER);
      if (fuel[c] < S.fuel[k]) S.fuel[k] = fuel[c];
      if (char[c] > S.char[k]) S.char[k] = char[c];
      tsum[k] += temp[c];
    }
    seen[k]++;
  };
  for (let j = 0; j < B.nCells; j++) {
    const c = B.cellList[j], k = B.cellK[j];
    if (!S.mat[k] || !holds(w, B, c, k)) {
      // (its door opened: these voxels are held, not lost; toggleDoor puts them back where they were)
      const dt = S.doorTag[k];
      if (S.mat[k] && dt && w.doors?.[dt - 1]?.open && !w.mat[c]) heldCell.set(c, k);
      continue;
    }
    // (its main copies first: a copy put a little wider to keep a shell tight sits where the voxel
    // is not, under the waterline perhaps; it does not set its moisture or its temperature)
    if (B.prim[j]) take(c, k);
    else sec.push(c, k);
    // a vessel's contents: what its copies hold between them
    const vt = vesselTag[c];
    if (vt < 0) B.vesselSum.set(vt, (B.vesselSum.get(vt) ?? 0) + fuel[c] * dens[c]);
    B.prim[keep] = B.prim[j];
    B.cellList[keep] = c;
    B.cellK[keep++] = k;
  }
  for (let q = 0; q < sec.length; q += 2) {
    const c = sec[q], k = sec[q + 1];
    if (!seen[k]) take(c, k);
    else {
      S.flags[k] |= flags[c] & (F_BURNING | F_SMOLDER);
      if (fuel[c] < S.fuel[k]) S.fuel[k] = fuel[c];
      if (char[c] > S.char[k]) S.char[k] = char[c];
    }
  }
  // (copies no longer its own: dropped from its cells)
  if (keep !== B.nCells) {
    B.cells.clear();
    for (let j = 0; j < keep; j++) B.cells.add(B.cellList[j]);
    B.nCells = keep;
  }
  const doors = B.refs.length ? w.doors : null;
  for (let k = 0; k < n; k++) {
    if (!S.mat[k]) continue;
    if (seen[k]) {
      if (seen[k] > 1) S.temp[k] = tsum[k] / seen[k];
      continue;
    }
    // held off the grid by an open door: back in its cell once it is shut
    const dt = S.doorTag[k];
    if (dt && doors?.[dt - 1]?.open) {
      if (B.held[k] < 0) B.held[k] = B.at[k];
      continue;
    }
    if (B.held[k] >= 0) {
      const c = B.held[k];
      B.held[k] = -1;
      if (w.mat[c] && w.doorTag[c] === dt && holds(w, B, c, k)) {
        for (let f = 0; f < nf; f++) dst[f][k] = src[f][c];
        B.cellList[B.nCells] = c;
        B.prim[B.nCells] = 1;
        B.cellK[B.nCells++] = k;
        B.cells.add(c);
        B.copies[k] = 1;
        B.at[k] = c;
        continue;
      }
    }
    if (B.copies[k] && S.vesselTag[k] < 0) continue; // (a sealed vessel's contents: what they held is in its sum)
    if (B.copies[k]) {
      // (burnt away, blown off, molten and run off: what is in its cell now is not it)
      S.mat[k] = 0;
      B.at[k] = -1;
      goneNow.push(k);
    }
  }
  return goneNow.length;
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

/** The 26-connected pieces of its voxels still there (not its vessels' contents, nor what has run liquid): a piece id per voxel, -1 none. */
function components(B, onlyIn) {
  const n = B.n, S = B.s;
  const id = new Int32Array(n).fill(-1);
  const q = new Int32Array(n);
  const [dx, dy] = B.latDim;
  const L = B.latIdx, lat = B.lat;
  const solid = (k) => S.mat[k] && S.vesselTag[k] >= 0 && !(S.flags[k] & F_LIQUID);
  let next = 0;
  for (let s = 0; s < n; s++) {
    if (id[s] >= 0 || !solid(s) || (onlyIn && !onlyIn[s])) continue;
    let qh = 0, qt = 0;
    q[qt++] = s;
    id[s] = next;
    while (qh < qt) {
      const k = q[qh++];
      const x = lat[3 * k] - B.latLo[0], y = lat[3 * k + 1] - B.latLo[1], z = lat[3 * k + 2] - B.latLo[2];
      for (let oz = -1; oz <= 1; oz++) {
        const zz = z + oz;
        if (zz < 0 || zz >= B.latDim[2]) continue;
        for (let oy = -1; oy <= 1; oy++) {
          const yy = y + oy;
          if (yy < 0 || yy >= dy) continue;
          for (let ox = -1; ox <= 1; ox++) {
            const xx = x + ox;
            if (xx < 0 || xx >= dx) continue;
            const j = L[xx + dx * (yy + dy * zz)];
            if (j < 0 || id[j] >= 0 || !solid(j) || (onlyIn && !onlyIn[j])) continue;
            id[j] = next;
            q[qt++] = j;
          }
        }
      }
    }
    next++;
  }
  id.count = next;
  return id;
}

/**
 * The parts that came loose: each of the pieces it was built of that has come apart (voxels of
 * it gone: burnt through, blown away) keeps its biggest piece; the rest of it is loose. → voxel
 * indices.
 */
function loosePieces(B) {
  const now = components(B, null);
  const size = new Int32Array(now.count);
  for (let k = 0; k < B.n; k++) if (now[k] >= 0) size[now[k]]++;
  // the biggest piece now of each part as built
  const best = new Map();
  for (let k = 0; k < B.n; k++) {
    const c = now[k], p = B.part[k];
    if (c < 0 || p < 0) continue;
    const b = best.get(p);
    if (b === undefined || size[c] > size[b]) best.set(p, c);
  }
  const out = [];
  for (let k = 0; k < B.n; k++) {
    const c = now[k], p = B.part[k];
    if (c < 0 || p < 0) continue;
    if (best.get(p) !== c) out.push(k);
  }
  return out;
}

/** Its velocity at a world point (opts.vel: { v, w } its velocity and spin about its origin). */
function velAt(vel, pose, p) {
  if (!vel) return [0, 0, 0];
  const v = vel.v ?? [0, 0, 0], om = vel.w ?? [0, 0, 0];
  const r = [p[0] - pose.p[0], p[1] - pose.p[1], p[2] - pose.p[2]];
  return [v[0] + om[1] * r[2] - om[2] * r[1], v[1] + om[2] * r[0] - om[0] * r[2], v[2] + om[0] * r[1] - om[1] * r[0]];
}

/**
 * Move it to `pose` in the grid (see the top): its state read back, its old cells emptied, its
 * voxels placed at the new pose, liquid pushed out of its envelope and given back where it left,
 * its vessels' seals checked, loose parts dropped, the lists told.
 */
export function restamp(w, B, pose, opts = {}) {
  const listOk = !w.listDirty; // (else the world rebuilds its lists anyway)
  const gone = syncBody(w, B);
  const S = B.s;
  const h = w.h;
  const { nx, ny, nz, mat } = w;
  let visible = false;
  // the cells it held (emptied now) and its envelope at the old pose: where liquid may come back
  const lifted = (B._lifted ??= new Set());
  lifted.clear();
  const left = [];
  if (opts.inside && opts.refill) envelope(w, B.pose, opts, (c, y) => {
    if ((y + 0.5) * h < opts.refill.below) left.push(c);
  });
  for (let j = 0; j < B.nCells; j++) {
    const c = B.cellList[j];
    if (!(w.flags[c] & F_HIDDEN)) visible = true;
    if (opts.refill && (Math.floor(c / nx) % ny + 0.5) * h < opts.refill.below) left.push(c);
    lift(w, c);
    lifted.add(c);
  }
  B.cells.clear();
  B.nCells = 0;
  B.copies.fill(0);
  B.at.fill(-1);
  const added = (B._added ??= []);
  added.length = 0;
  // liquid inside its envelope at the new pose: pushed out
  let displaced = 0;
  const inNew = opts.inside ? new Set() : null;
  if (opts.inside) envelope(w, pose, opts, (c) => {
    inNew.add(c);
    if (mat[c] && mat[c] === opts.liquid) {
      lift(w, c);
      lifted.add(c);
      displaced++;
    }
  });
  // its voxels at the new pose: each cell of its box the voxel of the build cell it maps to
  // (c0 = P0·P⁻¹·c: M = R0·Rᵀ, t = p0 − M·p)
  const R = pose.R, p = pose.p, R0 = B.pose0.R, p0 = B.pose0.p;
  const M = new Float64Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) M[3 * r + c] = R0[3 * r] * R[3 * c] + R0[3 * r + 1] * R[3 * c + 1] + R0[3 * r + 2] * R[3 * c + 2];
  const t = [0, 1, 2].map((r) => p0[r] - (M[3 * r] * p[0] + M[3 * r + 1] * p[1] + M[3 * r + 2] * p[2]));
  const [lo, hi] = B.box;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let c = 0; c < 8; c++) {
    xf(pose, c & 1 ? hi[0] + h : lo[0] - h, c & 2 ? hi[1] + h : lo[1] - h, c & 4 ? hi[2] + h : lo[2] - h, _a);
    for (let a = 0; a < 3; a++) {
      mn[a] = Math.min(mn[a], _a[a]);
      mx[a] = Math.max(mx[a], _a[a]);
    }
  }
  const x0 = Math.max(0, Math.floor(mn[0] / h)), x1 = Math.min(nx - 1, Math.floor(mx[0] / h));
  const y0 = Math.max(1, Math.floor(mn[1] / h)), y1 = Math.min(ny - 1, Math.floor(mx[1] / h));
  const z0 = Math.max(0, Math.floor(mn[2] / h)), z1 = Math.min(nz - 1, Math.floor(mx[2] / h));
  const hide = opts.hidden;
  const anchor = opts.anchor ?? B.anchor;
  const fsrc = SCALARS.map((f) => S[f]), fdst = SCALARS.map((f) => w[f]);
  const nf = fsrc.length;
  const [LX, LY, LZ] = B.latLo, [DX, DY, DZ] = B.latDim;
  const L = B.latIdx;
  const ih = 1 / h;
  const seal = B.seal;
  const SR = 0.3 * h;
  const sealAt = (bx, by, bz) => {
    for (let q = 0; q < 8; q++) {
      const jx = Math.floor((bx + (q & 1 ? SR : -SR)) * ih) - LX, jy = Math.floor((by + (q & 2 ? SR : -SR)) * ih) - LY, jz = Math.floor((bz + (q & 4 ? SR : -SR)) * ih) - LZ;
      if (jx < 0 || jy < 0 || jz < 0 || jx >= DX || jy >= DY || jz >= DZ) continue;
      const j = L[jx + DX * (jy + DY * jz)];
      if (j >= 0 && seal[j] && S.mat[j]) return j;
    }
    return -1;
  };
  const contents = (B._contents ??= []);
  contents.length = 0;
  let placed = 0, blocked = 0;
  if (B.cellList.length < B.n * 2) {
    B.cellList = new Int32Array(B.n * 2 + 64);
    B.cellK = new Int32Array(B.n * 2 + 64);
    B.prim = new Uint8Array(B.n * 2 + 64);
  }
  for (let z = z0; z <= z1; z++) {
    const cz = (z + 0.5) * h;
    for (let y = y0; y <= y1; y++) {
      const cy = (y + 0.5) * h;
      let cx = (x0 + 0.5) * h;
      let bx = M[0] * cx + M[1] * cy + M[2] * cz + t[0];
      let by = M[3] * cx + M[4] * cy + M[5] * cz + t[1];
      let bz = M[6] * cx + M[7] * cy + M[8] * cz + t[2];
      const sx = M[0] * h, sy = M[3] * h, sz = M[6] * h;
      for (let x = x0; x <= x1; x++, bx += sx, by += sy, bz += sz) {
        const ix = Math.floor(bx * ih) - LX, iy = Math.floor(by * ih) - LY, iz = Math.floor(bz * ih) - LZ;
        const inLat = !(ix < 0 || iy < 0 || iz < 0 || ix >= DX || iy >= DY || iz >= DZ);
        let k = inLat ? L[ix + DX * (iy + DY * iz)] : -1;
        // (a shell that must hold water or petrol: taken a little wider, so turned it has no
        // joints a liquid gets through: a cell its voxel's lattice cell overlaps by 0.3 h at a corner)
        let direct = 1;
        if (seal && (k < 0 || !S.mat[k])) {
          // (only next to its shell: inside its lattice's box next to a shell voxel, or just outside the box)
          const near = inLat ? B.nearSeal[ix + DX * (iy + DY * iz)] : ix >= -1 && iy >= -1 && iz >= -1 && ix <= DX && iy <= DY && iz <= DZ;
          k = near ? sealAt(bx, by, bz) : -1;
          direct = 0;
        }
        if (k < 0 || !S.mat[k]) continue;
        if (B.nCells >= B.cellList.length) {
          const c2 = new Int32Array(B.cellList.length * 2), k2 = new Int32Array(B.cellList.length * 2), p2 = new Uint8Array(B.cellList.length * 2);
          c2.set(B.cellList);
          k2.set(B.cellK);
          p2.set(B.prim);
          B.cellList = c2;
          B.cellK = k2;
          B.prim = p2;
        }
        if (B.held[k] >= 0) {
          // (its door is open: the cell it goes back to when it shuts)
          B.held[k] = x + nx * (y + ny * z);
          continue;
        }
        const c = x + nx * (y + ny * z);
        const m = mat[c];
        if (m && B.owner >= 0 && w.owner[c] === B.owner && w.vesselTag[c] < 0) {
          // (its own vessel's contents that ran within it since: taken in again)
          const vt = w.vesselTag[c];
          B.vesselSum.set(vt, (B.vesselSum.get(vt) ?? 0) + w.fuel[c] * w.dens[c]);
          lift(w, c);
          lifted.add(c);
        } else if (m) {
          if (!(opts.displace && opts.displace(m))) {
            blocked++;
            continue;
          }
          lift(w, c);
          lifted.add(c);
          displaced++;
        } else if (!lifted.has(c)) added.push(c);
        for (let f = 0; f < nf; f++) fdst[f][c] = fsrc[f][k];
        w.tint[3 * c] = S.tint[3 * k];
        w.tint[3 * c + 1] = S.tint[3 * k + 1];
        w.tint[3 * c + 2] = S.tint[3 * k + 2];
        let fl = S.flags[k];
        if (hide === true) fl |= F_HIDDEN;
        else if (hide === false) fl = B.hiddenOwn[k] ? fl | F_HIDDEN : fl & ~F_HIDDEN;
        if (anchor) fl |= F_ANCHOR;
        w.flags[c] = fl;
        w.dE[c] = 0;
        w.waterIn[c] = 0;
        if (!(fl & F_HIDDEN)) visible = true;
        if (S.vesselTag[k] < 0) contents.push(B.nCells);
        if (B.at[k] < 0) B.at[k] = c;
        B.copies[k]++;
        B.cellList[B.nCells] = c;
        B.prim[B.nCells] = direct;
        B.cellK[B.nCells++] = k;
        B.cells.add(c);
        placed++;
      }
    }
  }
  // a vessel's contents: what it held, shared out over the cells its contents are in now
  if (contents.length) {
    const D = new Map();
    for (const j of contents) {
      const c = B.cellList[j];
      D.set(w.vesselTag[c], (D.get(w.vesselTag[c]) ?? 0) + w.dens[c]);
    }
    for (const j of contents) {
      const c = B.cellList[j];
      const vt = w.vesselTag[c];
      const sum = B.vesselSum.get(vt);
      if (sum !== undefined) w.fuel[c] = sum / D.get(vt);
    }
  }
  let off = 0;
  for (let k = 0; k < B.n; k++) if (S.mat[k] && !B.copies[k]) off++;
  // the liquid back where it left
  let refilled = 0;
  if (opts.refill) {
    const RF = opts.refill;
    const sd = w.structureDirty, ld = w.listDirty;
    const fill = (c) => {
      w.setVoxel(c, RF.mat, { temp: RF.temp ?? w.ambient, variation: 0.03 });
      if (!lifted.has(c)) added.push(c);
      refilled++;
    };
    const free = (c) => !mat[c] && !B.cells.has(c) && !(inNew && inNew.has(c));
    for (const c of left) {
      if (free(c)) fill(c);
      // (and what is empty under it, down to the bottom: the water closes in from below too)
      for (let d = c - nx, y = Math.floor(c / nx) % ny - 1; y >= 1; d -= nx, y--) {
        if (mat[d] && !B.cells.has(d)) break;
        if (free(d)) fill(d);
      }
    }
    w.structureDirty = sd;
    w.listDirty = ld;
  }
  const oldPose = B.pose;
  B.pose = { p: pose.p.slice(), R: pose.R.slice() };
  B.stamps++;
  // what has come loose (a panel burnt through) falls off, flying with it
  let detached = 0;
  if (gone || B.checkLoose) {
    B.checkLoose = false;
    const loose = loosePieces(B);
    const max = 600;
    if (loose.length > max) B.checkLoose = true;
    for (const k of loose.slice(0, max)) detached += dropVoxel(w, B, k, opts.vel);
  }
  // its vessels: sealed still, as it lies now
  if (B.vessels.size) checkSeals(w, B, pose);
  // the registries told where its voxels are now
  if (B.refs.length) remapRefs(w, B, oldPose);
  // the world's lists and the air's view of the solids: patched for what changed (not rebuilt)
  if (listOk && !w.listDirty) {
    patchSolids(w, lifted, added);
    for (const c of added) lifted.add(c);
    if (w.patchDerived && !(w.lazyDerived && w.derivedDirty)) w.patchDerived(lifted);
    else if (w.lazyDerived) w.derivedDirty = true;
  } else w.listDirty = true;
  // its air (a cabin's, a hull's) along with it
  if (opts.air && needsRestamp(B, pose, w.ah, 0.5, B.airPose)) {
    carryAir(w, B, B.airPose, B.pose, opts.air);
    B.airPose = B.pose;
  }
  if (visible || displaced || refilled || gone || detached) w.geomVersion++;
  return { placed, blocked, off, gone, displaced, refilled, detached };
}

/** Voxel k off the body as debris (each of its copies), flying with the body. → how many cells. */
function dropVoxel(w, B, k, vel) {
  let n = 0;
  for (let j = 0; j < B.nCells; j++) {
    if (B.cellK[j] !== k) continue;
    const c = B.cellList[j];
    if (!w.mat[c]) continue;
    // (no longer its: not anchored, drawn as what it is, nobody's)
    w.flags[c] &= ~(F_ANCHOR | F_HIDDEN);
    w.owner[c] = -1;
    const p = w.center(...w.coords(c));
    const v = velAt(vel, B.pose, p);
    // (a little scatter, the same each run)
    const r1 = ((c * 2654435761) >>> 0) / 4294967296 - 0.5, r2 = ((c * 2246822519) >>> 0) / 4294967296 - 0.5;
    launchVoxel(w, c, [v[0] + r1 * 0.4, v[1], v[2] + r2 * 0.4]);
    B.cells.delete(c);
    n++;
  }
  if (n) {
    let keep = 0;
    for (let j = 0; j < B.nCells; j++) {
      if (B.cellK[j] === k) continue;
      B.cellList[keep] = B.cellList[j];
      B.prim[keep] = B.prim[j];
      B.cellK[keep++] = B.cellK[j];
    }
    B.nCells = keep;
  }
  B.s.mat[k] = 0;
  B.at[k] = -1;
  B.copies[k] = 0;
  return n;
}

/**
 * Its vessels after it moved: the vessel model (sim/vessels.js) counts its shell's cells to see a
 * hole, and turned they are more or fewer than it was built with. So its count is taken again each
 * time; a shell voxel really gone (burnt or blown through) is a hole: it leaks.
 */
function checkSeals(w, B, pose) {
  for (const [tag, n0] of B.vessels) {
    const v = w.vessels?.[tag - 1];
    if (!v || v.state === 'leaking' || v.state === 'ruptured' || v.state === 'empty') continue;
    let alive = 0, cells = 0;
    for (let k = 0; k < B.n; k++) if (B.s.vesselTag[k] === tag && B.s.mat[k]) alive++;
    for (let j = 0; j < B.nCells; j++) if (w.vesselTag[B.cellList[j]] === tag) cells++;
    const ref = v.bodyShell ?? n0;
    if (alive < ref) {
      // a hole: the contents run out (as sim/vessels.js has a tank leak)
      v.state = 'leaking';
      v.pressure = 0;
      for (let j = 0; j < B.nCells; j++) {
        const c = B.cellList[j];
        if (w.vesselTag[c] === -tag) {
          w.vesselTag[c] = 0;
          w.flags[c] |= F_LIQUID;
          w.melt[c] = 1;
          B.s.vesselTag[B.cellK[j]] = 0;
        }
      }
      w.events?.push({ type: 'leak', pos: pose.p.slice(), time: w.time, name: v.name });
      continue;
    }
    v.bodyShell = alive;
    v.shellCount0 = cells;
  }
}

/** Doors, pick-ups, gas pipes: their voxel lists where those voxels are now (a door's centre, a pick-up's place with them). */
function remapRefs(w, B, oldPose) {
  const head = new Int32Array(B.n).fill(-1), next = new Int32Array(B.nCells);
  for (let j = B.nCells - 1; j >= 0; j--) {
    const k = B.cellK[j];
    next[j] = head[k];
    head[k] = j;
  }
  for (const r of B.refs) {
    const arr = r.obj[r.key];
    if (!Array.isArray(arr)) continue;
    const out = [];
    for (const k of r.ks) {
      if (B.held[k] >= 0) out.push(B.held[k]);
      for (let j = head[k]; j >= 0; j = next[j]) out.push(B.cellList[j]);
    }
    if (r.all) {
      arr.length = 0;
      for (const c of out) arr.push(c);
    } else {
      // (only some of its voxels are this body's: those replaced)
      const mine = new Set(r.prev ?? []);
      const rest = arr.filter((c) => !mine.has(c) && !B.cells.has(c));
      arr.length = 0;
      for (const c of rest) arr.push(c);
      for (const c of out) arr.push(c);
    }
    r.prev = out;
    const o = r.obj;
    // a door's centre and the cells it goes back to while it is open; a pick-up where it is now
    if (r.key === 'voxels' && o.center && out.length) {
      const s = [0, 0, 0];
      for (const c of out) {
        const q = w.center(...w.coords(c));
        s[0] += q[0];
        s[1] += q[1];
        s[2] += q[2];
      }
      o.center = s.map((v) => v / out.length);
      o.sides = null;
    }
    if (r.key === 'voxels' && Array.isArray(o.p) && !o.taken) o.p = movePoint(o.p, oldPose, B.pose);
    if (r.key === 'voxels' && o.saved) for (const st of o.saved) {
      const k = B.heldCell?.get(st.i);
      if (k === undefined || B.held[k] < 0) continue;
      B.heldCell.delete(st.i);
      st.i = B.held[k];
      B.heldCell.set(st.i, k);
    }
  }
}

/** A world point that moves with it: from one of its poses to another. */
export function movePoint(q, from, to) {
  const R = from.R, p = from.p;
  const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
  const l = [R[0] * d[0] + R[3] * d[1] + R[6] * d[2], R[1] * d[0] + R[4] * d[1] + R[7] * d[2], R[2] * d[0] + R[5] * d[1] + R[8] * d[2]];
  return xf(to, l[0], l[1], l[2], [0, 0, 0]);
}

/**
 * The world's solid list after a move: the cells emptied out of it, those filled into it (no pass
 * over the whole grid: World.rebuildLists). Only while the list is up to date.
 */
function patchSolids(w, emptied, added) {
  let s = w.solids, n = w.solidCount;
  const old = s;
  if (emptied.size) {
    const mat = w.mat;
    let keep = 0;
    for (let k = 0; k < n; k++) {
      const i = s[k];
      if (mat[i]) s[keep++] = i;
    }
    n = keep;
  }
  if (n + added.length > s.length) {
    const s2 = new Int32Array(Math.ceil((n + added.length) * 1.25) + 64);
    s2.set(s.subarray(0, n));
    s = w.solids = s2;
  }
  for (const c of added) if (w.mat[c]) s[n++] = c;
  w.solidCount = n;
  // (the awake list, if it is the whole list; else it is made again at the next heat step: sim/activity.js)
  if (w.activeSolids === old || w.activeSolids === s) {
    w.activeSolids = s;
    w.activeCount = n;
  }
}

/**
 * Liquid inside its envelope where it is (opts as restamp's: inside, bounds, liquid) pushed out
 * without moving it: what ran in through the gaps between its voxels (a liquid flows:
 * sim/water.js). → how many cells.
 */
export function displaceLiquid(w, B, opts) {
  if (!opts.inside) return 0;
  const inn = [];
  envelope(w, B.pose, opts, (c) => {
    if (w.mat[c] && w.mat[c] === opts.liquid && !B.cells.has(c)) inn.push(c);
  });
  if (!inn.length) return 0;
  // each pushed back out over its side (the nearer one, along its beam: its local z), into the
  // first free cell outside it in the same layer (gone if there is none)
  const out = new Set(), added = [];
  const { nx, ny, h } = w;
  const R = B.pose.R, p = B.pose.p;
  const ez = [R[2], R[5], R[8]];
  const [lo, hi] = opts.bounds;
  const reach = Math.ceil((Math.max(Math.abs(lo[2]), Math.abs(hi[2])) * 2 + 0.6) / h);
  for (const c of inn) {
    const [x, y, z] = w.coords(c);
    const q = w.center(x, y, z);
    const lz = (q[0] - p[0]) * ez[0] + (q[1] - p[1]) * ez[1] + (q[2] - p[2]) * ez[2];
    const sg = lz >= 0 ? 1 : -1;
    let to = -1;
    for (let st = 1; st <= reach && to < 0; st++) {
      const X = Math.floor((q[0] + sg * ez[0] * st * h) / h), Z = Math.floor((q[2] + sg * ez[2] * st * h) / h);
      if (X < 0 || Z < 0 || X >= nx || Z >= w.nz) break;
      const j = X + nx * (y + ny * Z);
      if (w.mat[j] || B.cells.has(j) || out.has(j)) continue;
      const qq = w.center(X, y, Z);
      const d = [qq[0] - p[0], qq[1] - p[1], qq[2] - p[2]];
      if (opts.inside(R[0] * d[0] + R[3] * d[1] + R[6] * d[2], R[1] * d[0] + R[4] * d[1] + R[7] * d[2], R[2] * d[0] + R[5] * d[1] + R[8] * d[2])) continue;
      to = j;
    }
    if (to >= 0) {
      w.moveVoxel(c, to);
      added.push(to);
    } else lift(w, c);
    out.add(c);
  }
  // (the lists patched, not rebuilt: see restamp)
  if (!w.listDirty) {
    patchSolids(w, out, added);
    for (const j of added) out.add(j);
    if (w.patchDerived && !(w.lazyDerived && w.derivedDirty)) w.patchDerived(out);
  }
  w.geomVersion++;
  return inn.length;
}

/** Its voxels left where they are as plain voxels (not anchored unless they were built so, drawn as voxels). */
export function releaseBody(w, B) {
  syncBody(w, B);
  for (let j = 0; j < B.nCells; j++) {
    const c = B.cellList[j], k = B.cellK[j];
    if (!B.anchorOwn[k]) w.flags[c] &= ~F_ANCHOR;
    if (!B.hiddenOwn[k]) w.flags[c] &= ~F_HIDDEN;
  }
  w.structureDirty = true;
  w.geomVersion++;
}

/** Over its voxels (with tag, or all): how many there were, how many are left, their mean char. */
export function bodyStats(w, B, tag = -1) {
  let n = 0, left = 0, ch = 0;
  for (let k = 0; k < B.n; k++) {
    if (tag >= 0 && B.tag[k] !== tag) continue;
    n++;
    if (!B.s.mat[k]) continue;
    const c = B.at[k];
    if (c >= 0 && w.mat[c] && holds(w, B, c, k)) {
      left++;
      ch += w.char[c];
    } else if (c < 0) {
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
    if (mask & F_HIDDEN) B.hiddenOwn[k] = 0;
  }
  for (let j = 0; j < B.nCells; j++) {
    const c = B.cellList[j];
    if (w.mat[c]) w.flags[c] &= ~mask;
  }
  w.geomVersion++;
}
