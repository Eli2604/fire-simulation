/**
 * The static world as a voxel grid: what bodies collide with besides each other.
 *
 *   new VoxelGridCollider({ h, nx, ny, nz, solid(x, y, z) → bool, material(x, y, z) → id,
 *                           floor = true, ground(x, z) → y | null })
 *   VoxelGridCollider.fromWorld(world, { ignore(i) → bool })   over a sim World (sim/world.js):
 *       solid = a voxel that is not liquid (water, molten metal) and not ignored (a moving body's
 *       own voxels); below the grid is solid (floor), beside and above it open.
 *
 * Contacts against it (collideWorld) have their normal from the world into the body and are found
 *   - for a sphere (and the spheres along a capsule): against each solid cell near it, the
 *     closest point on the cell with the components that point into a solid neighbour dropped
 *     (no ghost bumps at the seams of a flat voxel floor);
 *   - for a polyhedron / voxel set: each of its vertices (outer corners) in a solid cell, pushed
 *     out through that cell's nearest open face, a speculative contact when it is within the
 *     margin above an open face; and the grid's exposed corners inside it (a box lying over a
 *     one-voxel bump), pushed out through its nearest face.
 * A heightfield ground(x, z) can stand in for (or add to) the grid: points under it are pushed up
 * along its slope.
 */
import { vdot, vsub, vlen, vscale, m3mulv, m3tmulv, vadd } from './math.js';
import { closestOnPoly, mulR } from './collide.js';

const T = () => [0, 0, 0];
const F_LIQUID = 1;

export class VoxelGridCollider {
  constructor({ h, nx, ny, nz, solid, material = () => 0, floor = true, ground = null, origin = [0, 0, 0] }) {
    this.h = h;
    this.nx = nx;
    this.ny = ny;
    this.nz = nz;
    this.solidFn = solid;
    this.materialFn = material;
    this.floor = floor;
    this.ground = ground;
    this.origin = origin;
    this.maxCorners = 4000; // the exposed-corner test is skipped for bodies over this many grid corners
  }
  static fromWorld(w, { ignore = null } = {}) {
    const { nx, ny, nz } = w;
    const nxy = nx * ny;
    return new VoxelGridCollider({
      h: w.h,
      nx,
      ny,
      nz,
      solid: (x, y, z) => {
        const i = x + nx * y + nxy * z;
        return w.mat[i] !== 0 && !(w.flags[i] & F_LIQUID) && !(ignore && ignore(i));
      },
      material: (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz ? 0 : w.mat[x + nx * y + nxy * z]),
    });
  }
  /** Whether cell (x, y, z) is solid (below the grid: the floor; beside and above: open). */
  solid(x, y, z) {
    if (y < 0) return this.floor;
    if (x < 0 || z < 0 || x >= this.nx || y >= this.ny || z >= this.nz) return false;
    return this.solidFn(x, y, z);
  }
  material(x, y, z) {
    return this.materialFn(Math.max(0, Math.min(this.nx - 1, x)), Math.max(0, y), Math.max(0, Math.min(this.nz - 1, z)));
  }
  cellIndex(x, y, z) {
    return x + this.nx * (y + this.ny * z);
  }
  /**
   * Whether the world box bb [x0, y0, z0, x1, y1, z1] holds nothing solid (no cell, no floor, no
   * ground under it): a body inside it has no contacts with the grid. Scanned from the bottom up
   * (the ground is what is usually there).
   */
  emptyBox(bb) {
    const h = this.h, o = this.origin;
    if (this.ground) {
      // (the heightfield at the box's corners and middle: a plane or a gentle slope is caught)
      const xs = [bb[0], bb[3], (bb[0] + bb[3]) / 2], zs = [bb[2], bb[5], (bb[2] + bb[5]) / 2];
      let top = -Infinity;
      for (const x of xs)
        for (const z of zs) {
          const g = this.ground(x, z);
          if (g != null && g > top) top = g;
        }
      if (top > -Infinity && bb[1] <= top + 0.05) return false;
    }
    const x0 = Math.floor((bb[0] - o[0]) / h), x1 = Math.floor((bb[3] - o[0]) / h);
    const y0 = Math.floor((bb[1] - o[1]) / h), y1 = Math.floor((bb[4] - o[1]) / h);
    const z0 = Math.floor((bb[2] - o[2]) / h), z1 = Math.floor((bb[5] - o[2]) / h);
    const { nx, ny, nz } = this;
    const cx = Math.max(0, Math.min(nx - 1, x0)), cz = Math.max(0, Math.min(nz - 1, z0));
    if (y0 < 0 && this.solid(cx, -1, cz)) return false; // (the floor)
    if (y1 < 0 || y0 >= ny) return true;
    const ya = Math.max(0, y0), yb = Math.min(ny - 1, y1);
    // beside the grid (open, or a wall: the vehicles' world edge)
    if ((x0 < 0 || z0 < 0 || x1 >= nx || z1 >= nz) && this.solid(x0 < 0 ? -1 : x1 >= nx ? nx : cx, ya, z0 < 0 ? -1 : z1 >= nz ? nz : cz)) return false;
    const xa = Math.max(0, x0), xb = Math.min(nx - 1, x1), za = Math.max(0, z0), zb = Math.min(nz - 1, z1);
    if (xa > xb || za > zb) return true;
    const f = this.solidFn;
    for (let y = ya; y <= yb; y++)
      for (let z = za; z <= zb; z++)
        for (let x = xa; x <= xb; x++) if (f(x, y, z)) return false;
    return true;
  }
  /** Solid at world point p. */
  solidAt(p) {
    const h = this.h, o = this.origin;
    return this.solid(Math.floor((p[0] - o[0]) / h), Math.floor((p[1] - o[1]) / h), Math.floor((p[2] - o[2]) / h));
  }
}

const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/**
 * Point x (world) in solid cell (ix, iy, iz): the way out through the nearest open face of that cell
 * → [n, depth], or deep in the solid: up, as far as the solid goes (a few cells).
 */
function pushOut(C, x, ix, iy, iz) {
  const h = C.h, o = C.origin;
  let best = Infinity, bn = null;
  for (let d = 0; d < 6; d++) {
    const D = DIRS[d];
    if (C.solid(ix + D[0], iy + D[1], iz + D[2])) continue;
    const a = d >> 1;
    const face = o[a] + ([ix, iy, iz][a] + (D[a] > 0 ? 1 : 0)) * h;
    const dist = D[a] > 0 ? face - x[a] : x[a] - face;
    if (dist < best) (best = dist), (bn = D);
  }
  if (bn) return [bn.slice(), Math.max(0, best)];
  let k = 1;
  while (k < 6 && C.solid(ix, iy + k, iz)) k++;
  return [[0, 1, 0], o[1] + (iy + k) * h - x[1]];
}

/**
 * Contacts of a placed shape against the grid: emit(n, point, depth, sub, cell, material), n from
 * the world into the body. margin: how far apart a speculative contact may be.
 */
export function collideWorld(C, S, p, R, margin, emit, sub = -1) {
  const h = C.h;
  if (S.type === 'compound') {
    for (let k = 0; k < S.children.length; k++) {
      const c = S.children[k];
      collideWorld(C, c.shape, vadd(T(), p, m3mulv(T(), R, c.pos)), mulR(R, c.R), margin, emit, k);
    }
    return;
  }
  if (S.type === 'sphere') return sphereGrid(C, p, S.r, margin, emit, sub);
  if (S.type === 'capsule') {
    const a = vadd(T(), p, m3mulv(T(), R, S.a)), b = vadd(T(), p, m3mulv(T(), R, S.b));
    const L = vlen(vsub(T(), b, a));
    const n = Math.max(2, Math.min(8, Math.ceil(L / Math.max(S.r, h * 0.5)) + 1));
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1);
      sphereGrid(C, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], S.r, margin, emit, sub);
    }
    return;
  }
  // polyhedra and voxel sets: their corners in the grid, the grid's corners in them
  const pts = S.type === 'voxels' ? S.corners : S.verts;
  const x = T();
  for (let k = 0; k < pts.length; k++) {
    vadd(x, p, m3mulv(x, R, pts[k]));
    pointGrid(C, x, margin, emit, S.type === 'voxels' ? -1 : sub);
  }
  gridCornersIn(C, S, p, R, emit, sub);
  if (C.ground) groundPoints(C, pts, p, R, margin, emit, sub);
}

function pointGrid(C, x, margin, emit, sub) {
  const h = C.h, o = C.origin;
  const fx = (x[0] - o[0]) / h, fy = (x[1] - o[1]) / h, fz = (x[2] - o[2]) / h;
  const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
  if (C.solid(ix, iy, iz)) {
    const [n, depth] = pushOut(C, x, ix, iy, iz);
    emit(n, x.slice(), depth, sub, C.cellIndex(ix, Math.max(0, iy), iz), C.material(ix, iy, iz));
    return;
  }
  if (margin <= 0) return;
  // speculative: a solid cell across a face of this one, within the margin
  const fr = [fx - ix, fy - iy, fz - iz];
  for (let d = 0; d < 6; d++) {
    const D = DIRS[d], a = d >> 1;
    const gap = (D[a] > 0 ? 1 - fr[a] : fr[a]) * h;
    if (gap > margin) continue;
    const jx = ix + D[0], jy = iy + D[1], jz = iz + D[2];
    if (!C.solid(jx, jy, jz)) continue;
    emit([-D[0], -D[1], -D[2]], x.slice(), -gap, sub, C.cellIndex(jx, Math.max(0, jy), jz), C.material(jx, jy, jz));
  }
}

function sphereGrid(C, c, r, margin, emit, sub) {
  const h = C.h, o = C.origin;
  const R = r + margin;
  const x0 = Math.floor((c[0] - R - o[0]) / h), x1 = Math.floor((c[0] + R - o[0]) / h);
  const y0 = Math.floor((c[1] - R - o[1]) / h), y1 = Math.floor((c[1] + R - o[1]) / h);
  const z0 = Math.floor((c[2] - R - o[2]) / h), z1 = Math.floor((c[2] + R - o[2]) / h);
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (!C.solid(x, y, z)) continue;
        const lo = [o[0] + x * h, o[1] + y * h, o[2] + z * h];
        const q = [Math.max(lo[0], Math.min(lo[0] + h, c[0])), Math.max(lo[1], Math.min(lo[1] + h, c[1])), Math.max(lo[2], Math.min(lo[2] + h, c[2]))];
        const d = vsub(T(), c, q);
        // components that point into a solid neighbour are inside the solid mass: not a way out
        const cell = [x, y, z];
        for (let a = 0; a < 3; a++) {
          if (d[a] === 0) continue;
          const nb = cell.slice();
          nb[a] += d[a] > 0 ? 1 : -1;
          if (C.solid(nb[0], nb[1], nb[2])) d[a] = 0;
        }
        const l = vlen(d);
        let n, depth, pt;
        if (l > 1e-9) {
          if (l > R) continue;
          n = vscale(d, d, 1 / l);
          depth = r - l;
          pt = q;
          // (q moved with the dropped components: on the cell's open face under the centre)
          pt = [c[0] - n[0] * l, c[1] - n[1] * l, c[2] - n[2] * l];
        } else {
          const [nn, dd] = pushOut(C, c, x, y, z);
          // the centre is inside (or on) the cell: deep
          const inCell = c[0] >= lo[0] && c[0] <= lo[0] + h && c[1] >= lo[1] && c[1] <= lo[1] + h && c[2] >= lo[2] && c[2] <= lo[2] + h;
          if (!inCell) {
            // the centre is off the cell but over a solid neighbour on every way out: that neighbour answers
            continue;
          }
          n = nn;
          depth = r + dd;
          pt = c.slice();
        }
        emit(n, pt, depth, sub, C.cellIndex(x, Math.max(0, y), z), C.material(x, y, z));
      }
  if (C.ground) {
    const gy = C.ground(c[0], c[2]);
    if (gy != null && c[1] - r - gy < margin) {
      const n = groundNormal(C, c[0], c[2]);
      emit(n, [c[0], gy, c[2]], (gy - (c[1] - r)) * n[1], sub, -1, 0);
    }
  }
}

function groundNormal(C, x, z) {
  const e = 0.05;
  const gx = (C.ground(x + e, z) - C.ground(x - e, z)) / (2 * e), gz = (C.ground(x, z + e) - C.ground(x, z - e)) / (2 * e);
  const l = Math.hypot(gx, 1, gz);
  return [-gx / l, 1 / l, -gz / l];
}
function groundPoints(C, pts, p, R, margin, emit, sub) {
  const x = T();
  for (const v of pts) {
    vadd(x, p, m3mulv(x, R, v));
    const gy = C.ground(x[0], x[2]);
    if (gy == null || x[1] - gy > margin) continue;
    const n = groundNormal(C, x[0], x[2]);
    emit(n, x.slice(), (gy - x[1]) * n[1], sub, -1, 0);
  }
}

/** The grid's exposed solid corners inside a polyhedron / voxel set: pushed out through its nearest face. */
function gridCornersIn(C, S, p, R, emit, sub) {
  const h = C.h, o = C.origin;
  const bb = S.aabb(p, R, [0, 0, 0, 0, 0, 0]);
  const x0 = Math.ceil((bb[0] - o[0]) / h), x1 = Math.floor((bb[3] - o[0]) / h);
  const y0 = Math.max(0, Math.ceil((bb[1] - o[1]) / h)), y1 = Math.floor((bb[4] - o[1]) / h);
  const z0 = Math.ceil((bb[2] - o[2]) / h), z1 = Math.floor((bb[5] - o[2]) / h);
  if (x1 < x0 || y1 < y0 || z1 < z0) return;
  if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > C.maxCorners) return;
  // the cells round the corners, looked up once each (a corner has 8 of them): only an exposed
  // corner (some of its cells solid, some open) can push, so the inside test is done for those only
  const ox = x0 - 1, oy = y0 - 1, oz = z0 - 1;
  const sx = x1 - x0 + 2, sy = y1 - y0 + 2, sz = z1 - z0 + 2;
  const occ = occBuf(sx * sy * sz);
  let nSolid = 0;
  for (let z = 0, k = 0; z < sz; z++)
    for (let y = 0; y < sy; y++)
      for (let x = 0; x < sx; x++, k++) {
        const s = C.solid(ox + x, oy + y, oz + z) ? 1 : 0;
        occ[k] = s;
        nSolid += s;
      }
  if (nSolid === 0) return;
  const sxy = sx * sy;
  const w = T(), l = T();
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        // exposed and solid: one of the 8 cells round it solid, one open
        const k0 = x - ox + sx * (y - oy) + sxy * (z - oz);
        const sol = occ[k0] + occ[k0 - 1] + occ[k0 - sx] + occ[k0 - sx - 1] + occ[k0 - sxy] + occ[k0 - sxy - 1] + occ[k0 - sxy - sx] + occ[k0 - sxy - sx - 1];
        if (sol === 0 || sol === 8) continue;
        w[0] = o[0] + x * h;
        w[1] = o[1] + y * h;
        w[2] = o[2] + z * h;
        m3tmulv(l, R, vsub(l, w, p));
        let n, depth;
        if (S.type === 'voxels') {
          const k = S.voxelAt(l);
          // (a corner on its surface is not inside: only one strictly in a voxel's cube)
          if (k < 0) continue;
          const [cx, cy, cz] = S.cell[k];
          const c = S.centres[k];
          let best = Infinity, bn = null;
          for (let d = 0; d < 6; d++) {
            const D = DIRS[d];
            if (S.hasCell(cx + D[0], cy + D[1], cz + D[2])) continue;
            const a = d >> 1;
            const dist = h / 2 - D[a] * (l[a] - c[a]);
            if (dist < best) (best = dist), (bn = D);
          }
          if (!bn || best <= 1e-6) continue;
          n = m3mulv(T(), R, [-bn[0], -bn[1], -bn[2]]);
          depth = best;
        } else {
          let s, fi;
          if (S.type === 'box') {
            const he = S.he;
            s = -Infinity;
            for (let a = 0; a < 3; a++) {
              const d = Math.abs(l[a]) - he[a];
              if (d > s) (s = d), (fi = a);
            }
            if (s >= -1e-6) continue;
            const nl = [0, 0, 0];
            nl[fi] = l[fi] >= 0 ? -1 : 1;
            n = m3mulv(T(), R, nl);
          } else {
            [s, fi] = S.maxFace(l);
            if (s >= -1e-6) continue;
            n = m3mulv(T(), R, vscale(T(), S.faces[fi].n, -1));
          }
          depth = -s;
        }
        // (the cell the push leaves from: the solid one round the corner most against n)
        let cx = x, cy = y, cz = z, bd = -Infinity;
        for (let d = 0; d < 8; d++) {
          const X = x - (d & 1), Y = y - ((d >> 1) & 1), Z = z - ((d >> 2) & 1);
          if (!occ[X - ox + sx * (Y - oy) + sxy * (Z - oz)]) continue;
          const v = -((X + 0.5 - x) * n[0] + (Y + 0.5 - y) * n[1] + (Z + 0.5 - z) * n[2]);
          if (v > bd) (bd = v), (cx = X), (cy = Y), (cz = Z);
        }
        emit(n, w.slice(), depth, sub, C.cellIndex(cx, Math.max(0, cy), cz), C.material(cx, cy, cz));
      }
}

let OCC = new Uint8Array(4096);
const occBuf = (n) => (OCC.length >= n ? OCC : (OCC = new Uint8Array(n)));

/** Raycast against the grid (3D DDA): → { t, point, normal, cell, material } or null. */
export function rayGrid(C, from, dir, maxT) {
  const h = C.h, o = C.origin;
  let x = Math.floor((from[0] - o[0]) / h), y = Math.floor((from[1] - o[1]) / h), z = Math.floor((from[2] - o[2]) / h);
  const step = [Math.sign(dir[0]), Math.sign(dir[1]), Math.sign(dir[2])];
  const tD = [0, 1, 2].map((a) => (dir[a] !== 0 ? Math.abs(h / dir[a]) : Infinity));
  const next = [0, 1, 2].map((a) => {
    if (dir[a] === 0) return Infinity;
    const c = [x, y, z][a];
    const b = o[a] + (c + (dir[a] > 0 ? 1 : 0)) * h;
    return (b - from[a]) / dir[a];
  });
  let t = 0;
  let n = [0, 0, 0];
  for (let it = 0; it < 100000 && t <= maxT; it++) {
    if (C.solid(x, y, z)) {
      if (it === 0) n = [-step[0], -step[1], -step[2]];
      return { t, point: [from[0] + dir[0] * t, from[1] + dir[1] * t, from[2] + dir[2] * t], normal: n, cell: C.cellIndex(x, Math.max(0, y), z), material: C.material(x, y, z) };
    }
    // leave through the nearest boundary
    let a = 0;
    if (next[1] < next[a]) a = 1;
    if (next[2] < next[a]) a = 2;
    t = next[a];
    next[a] += tD[a];
    if (a === 0) x += step[0];
    else if (a === 1) y += step[1];
    else z += step[2];
    n = [0, 0, 0];
    n[a] = -step[a];
    // gone off the grid upward or sideways with nothing more to hit
    if (y >= C.ny && dir[1] >= 0) break;
    if ((x < 0 && dir[0] <= 0) || (x >= C.nx && dir[0] >= 0) || (z < 0 && dir[2] <= 0) || (z >= C.nz && dir[2] >= 0)) {
      if (!C.floor || dir[1] >= 0) break;
    }
  }
  if (C.ground) {
    // march for the heightfield
    for (let s = 0; s <= maxT; s += h * 0.5) {
      const q = [from[0] + dir[0] * s, from[1] + dir[1] * s, from[2] + dir[2] * s];
      const gy = C.ground(q[0], q[2]);
      if (gy != null && q[1] <= gy) return { t: s, point: q, normal: groundNormal(C, q[0], q[2]), cell: -1, material: 0 };
    }
  }
  return null;
}

/** Whether a sphere at c of radius r overlaps any solid cell. */
export function sphereHitsGrid(C, c, r) {
  const h = C.h, o = C.origin;
  const x0 = Math.floor((c[0] - r - o[0]) / h), x1 = Math.floor((c[0] + r - o[0]) / h);
  const y0 = Math.floor((c[1] - r - o[1]) / h), y1 = Math.floor((c[1] + r - o[1]) / h);
  const z0 = Math.floor((c[2] - r - o[2]) / h), z1 = Math.floor((c[2] + r - o[2]) / h);
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (!C.solid(x, y, z)) continue;
        const lo = [o[0] + x * h, o[1] + y * h, o[2] + z * h];
        let d2 = 0;
        for (let a = 0; a < 3; a++) {
          const v = Math.max(lo[a], Math.min(lo[a] + h, c[a])) - c[a];
          d2 += v * v;
        }
        if (d2 < r * r) return true;
      }
  if (C.ground) {
    const gy = C.ground(c[0], c[2]);
    if (gy != null && c[1] - r < gy) return true;
  }
  return false;
}

export { closestOnPoly };
