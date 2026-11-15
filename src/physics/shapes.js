/**
 * Collision shapes and their mass properties. Every shape lives in its own frame; a body places
 * that frame in the world (body.js). Mass properties are for a uniform density (kg/m³) unless a
 * shape carries its own masses (a voxel set: each voxel its material's mass).
 *
 *   new Sphere(r)
 *   new Box(hx, hy, hz)                       half extents
 *   new Capsule(r, a = [0,-hh,0], b = [0,hh,0]) a segment a–b swept by a sphere of radius r
 *   Capsule.y(r, halfHeight)                  the usual upright one
 *   new ConvexHull(points)                    the convex hull of a point cloud (quickhull-like,
 *                                             coplanar triangles merged into polygons)
 *   new Compound([{ shape, pos, quat, density? }])   several shapes as one rigid body
 *   new VoxelSet(h, centres, masses)          a chunk of voxels (detached debris): mass from every
 *                                             voxel, collision from its surface voxels (as boxes)
 *                                             and its outer corners (against the voxel world)
 *   cylinderHull(r, halfHeight, sides = 12)   a cylinder (a drum, a barrel) as a ConvexHull
 *
 * shape.massProps(density) → { mass, com, I }   (I: 3×3 about the centre of mass, shape frame)
 * shape.aabb(p, R, out)   world box of the shape placed at p with rotation matrix R
 * shape.samples(n)        points inside it with a volume each ({ p, vol }), for buoyancy
 */
import { vsub, vadd, vcross, vdot, vnorm, vlen, vscale, m3rotate, parallelAxis, m3add, mat3FromQuat, m3mulv, qfromTo, qident } from './math.js';

let SHAPE_ID = 0;

export class Sphere {
  constructor(r) {
    this.type = 'sphere';
    this.r = r;
    this.id = ++SHAPE_ID;
  }
  massProps(rho = 1000) {
    const m = rho * (4 / 3) * Math.PI * this.r ** 3;
    const i = 0.4 * m * this.r * this.r;
    return { mass: m, com: [0, 0, 0], I: [i, 0, 0, 0, i, 0, 0, 0, i], volume: (4 / 3) * Math.PI * this.r ** 3 };
  }
  aabb(p, R, out) {
    const r = this.r;
    out[0] = p[0] - r;
    out[1] = p[1] - r;
    out[2] = p[2] - r;
    out[3] = p[0] + r;
    out[4] = p[1] + r;
    out[5] = p[2] + r;
    return out;
  }
  get innerRadius() {
    return this.r;
  }
  samples(n = 3) {
    return gridSamples(this, [-this.r, -this.r, -this.r], [this.r, this.r, this.r], n, (p) => vlen(p) <= this.r);
  }
}

export class Capsule {
  constructor(r, a = [0, -0.5, 0], b = [0, 0.5, 0]) {
    this.type = 'capsule';
    this.r = r;
    this.a = a.slice();
    this.b = b.slice();
    this.id = ++SHAPE_ID;
  }
  static y(r, halfHeight) {
    return new Capsule(r, [0, -halfHeight, 0], [0, halfHeight, 0]);
  }
  get length() {
    return Math.hypot(this.b[0] - this.a[0], this.b[1] - this.a[1], this.b[2] - this.a[2]);
  }
  massProps(rho = 1000) {
    const r = this.r, L = this.length;
    const mc = rho * Math.PI * r * r * L, ms = rho * (4 / 3) * Math.PI * r ** 3;
    const iy = mc * r * r * 0.5 + ms * 0.4 * r * r;
    const ix = mc * (L * L / 12 + r * r / 4) + ms * (0.4 * r * r + L * L / 4 + (3 * L * r) / 8);
    const axis = L > 1e-9 ? vscale([0, 0, 0], vsub([0, 0, 0], this.b, this.a), 1 / L) : [0, 1, 0];
    const R = mat3FromQuat([], qfromTo([0, 0, 0, 1], [0, 1, 0], axis));
    const I = m3rotate([], R, [ix, 0, 0, 0, iy, 0, 0, 0, ix]);
    const com = [(this.a[0] + this.b[0]) / 2, (this.a[1] + this.b[1]) / 2, (this.a[2] + this.b[2]) / 2];
    return { mass: mc + ms, com, I, volume: Math.PI * r * r * L + (4 / 3) * Math.PI * r ** 3 };
  }
  aabb(p, R, out) {
    const A = m3mulv(CA, R, this.a), B = m3mulv(CB, R, this.b), r = this.r;
    for (let c = 0; c < 3; c++) {
      out[c] = p[c] + Math.min(A[c], B[c]) - r;
      out[c + 3] = p[c] + Math.max(A[c], B[c]) + r;
    }
    return out;
  }
  get innerRadius() {
    return this.r;
  }
  samples(n = 3) {
    const lo = [0, 1, 2].map((c) => Math.min(this.a[c], this.b[c]) - this.r), hi = [0, 1, 2].map((c) => Math.max(this.a[c], this.b[c]) + this.r);
    return gridSamples(this, lo, hi, n, (p) => segDist2(p, this.a, this.b) <= this.r * this.r);
  }
}

/** Squared distance from p to segment a–b. */
export function segDist2(p, a, b) {
  const ab = vsub([0, 0, 0], b, a), ap = vsub([0, 0, 0], p, a);
  const l2 = vdot(ab, ab);
  const t = l2 > 1e-12 ? Math.max(0, Math.min(1, vdot(ap, ab) / l2)) : 0;
  const d = [ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t];
  return vdot(d, d);
}

/**
 * A convex polyhedron: vertices, polygon faces (outward normal n, plane offset d: n·x = d on it,
 * vertex indices counter-clockwise seen from outside), edges (vertex pairs) and the distinct edge
 * directions (for the separating-axis test).
 */
class Polyhedron {
  finish(verts, faces) {
    this.verts = verts;
    this.faces = faces;
    const seen = new Set();
    this.edges = [];
    this.edgeDirs = [];
    for (const f of faces)
      for (let k = 0; k < f.vi.length; k++) {
        const a = f.vi[k], b = f.vi[(k + 1) % f.vi.length];
        const key = a < b ? a * 65536 + b : b * 65536 + a;
        if (seen.has(key)) continue;
        seen.add(key);
        this.edges.push([a, b]);
        const d = vnorm([0, 0, 0], vsub([0, 0, 0], verts[b], verts[a]));
        if (!this.edgeDirs.some((e) => Math.abs(vdot(e, d)) > 0.9999)) this.edgeDirs.push(d);
      }
    let r = 0;
    for (const v of verts) r = Math.max(r, vlen(v));
    this.boundRadius = r;
    // (the largest sphere about the shape origin inside it: what continuous collision sweeps)
    let ir = Infinity;
    for (const f of faces) ir = Math.min(ir, f.d);
    this.inner = Math.max(0, ir);
  }
  get innerRadius() {
    return this.inner;
  }
  aabb(p, R, out) {
    out[0] = out[1] = out[2] = Infinity;
    out[3] = out[4] = out[5] = -Infinity;
    const w = [0, 0, 0];
    for (const v of this.verts) {
      m3mulv(w, R, v);
      for (let c = 0; c < 3; c++) {
        if (w[c] < out[c]) out[c] = w[c];
        if (w[c] > out[c + 3]) out[c + 3] = w[c];
      }
    }
    for (let c = 0; c < 3; c++) {
      out[c] += p[c];
      out[c + 3] += p[c];
    }
    return out;
  }
  massProps(rho = 1000) {
    // tetrahedra from the vertices' mean to each face's triangle fan (covariance method)
    const o = [0, 0, 0];
    for (const v of this.verts) vadd(o, o, v);
    vscale(o, o, 1 / this.verts.length);
    let V = 0;
    const c = [0, 0, 0];
    const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const f of this.faces) {
      const p0 = vsub([0, 0, 0], this.verts[f.vi[0]], o);
      for (let k = 1; k + 1 < f.vi.length; k++) {
        const p1 = vsub([0, 0, 0], this.verts[f.vi[k]], o), p2 = vsub([0, 0, 0], this.verts[f.vi[k + 1]], o);
        const det = vdot(p0, vcross([0, 0, 0], p1, p2));
        const v = det / 6;
        V += v;
        for (let a = 0; a < 3; a++) c[a] += (v * (p0[a] + p1[a] + p2[a])) / 4;
        // ∫ x xᵀ over the tetrahedron (0, p0, p1, p2) = det/120 · (Σ pᵢpᵢᵀ + (Σpᵢ)(Σpᵢ)ᵀ)
        const s = [p0[0] + p1[0] + p2[0], p0[1] + p1[1] + p2[1], p0[2] + p1[2] + p2[2]];
        for (let a = 0; a < 3; a++)
          for (let b = 0; b < 3; b++) C[3 * a + b] += (det / 120) * (p0[a] * p0[b] + p1[a] * p1[b] + p2[a] * p2[b] + s[a] * s[b]);
      }
    }
    vscale(c, c, 1 / V);
    // covariance about the centre of mass
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[3 * a + b] = rho * (C[3 * a + b] - V * c[a] * c[b]);
    const tr = C[0] + C[4] + C[8];
    const I = [tr - C[0], -C[1], -C[2], -C[3], tr - C[4], -C[5], -C[6], -C[7], tr - C[8]];
    return { mass: rho * V, com: vadd([0, 0, 0], c, o), I, volume: V };
  }
  /** Signed distance of point x (shape frame) to the plane of each face: the largest (≤ 0 inside). */
  maxFace(x) {
    let best = -Infinity, bi = -1;
    for (let k = 0; k < this.faces.length; k++) {
      const f = this.faces[k];
      const s = vdot(f.n, x) - f.d;
      if (s > best) {
        best = s;
        bi = k;
      }
    }
    return [best, bi];
  }
  samples(n = 3) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const v of this.verts) for (let c = 0; c < 3; c++) (lo[c] = Math.min(lo[c], v[c])), (hi[c] = Math.max(hi[c], v[c]));
    return gridSamples(this, lo, hi, n, (p) => this.maxFace(p)[0] <= 0);
  }
}

export class Box extends Polyhedron {
  constructor(hx, hy = hx, hz = hx) {
    super();
    this.type = 'box';
    this.poly = true;
    this.he = [hx, hy, hz];
    this.id = ++SHAPE_ID;
    const v = [];
    for (let k = 0; k < 8; k++) v.push([k & 1 ? hx : -hx, k & 2 ? hy : -hy, k & 4 ? hz : -hz]);
    const F = (n, d, vi) => ({ n, d, vi });
    this.finish(v, [
      F([1, 0, 0], hx, [1, 3, 7, 5]), F([-1, 0, 0], hx, [0, 4, 6, 2]),
      F([0, 1, 0], hy, [2, 6, 7, 3]), F([0, -1, 0], hy, [0, 1, 5, 4]),
      F([0, 0, 1], hz, [4, 5, 7, 6]), F([0, 0, -1], hz, [0, 2, 3, 1]),
    ]);
  }
  massProps(rho = 1000) {
    const [x, y, z] = this.he;
    const m = rho * 8 * x * y * z;
    return { mass: m, com: [0, 0, 0], I: [(m * (4 * y * y + 4 * z * z)) / 12, 0, 0, 0, (m * (4 * x * x + 4 * z * z)) / 12, 0, 0, 0, (m * (4 * x * x + 4 * y * y)) / 12], volume: 8 * x * y * z };
  }
}

export class ConvexHull extends Polyhedron {
  constructor(points) {
    super();
    this.type = 'hull';
    this.poly = true;
    this.id = ++SHAPE_ID;
    const { verts, faces } = quickHull(points);
    this.finish(verts, faces);
  }
}

/** A cylinder along y (radius r, from −hh to +hh) as a convex hull with `sides` sides. */
export function cylinderHull(r, hh, sides = 12) {
  const pts = [];
  for (let k = 0; k < sides; k++) {
    const a = (k / sides) * Math.PI * 2;
    pts.push([r * Math.cos(a), -hh, r * Math.sin(a)], [r * Math.cos(a), hh, r * Math.sin(a)]);
  }
  return new ConvexHull(pts);
}

/** The convex hull of points: incremental (tetrahedron, then each point outside), faces merged. */
export function quickHull(points) {
  const P = points.map((p) => p.slice());
  const n = P.length;
  if (n < 4) throw new Error('ConvexHull needs at least 4 points');
  const eps = 1e-9 * (1 + P.reduce((m, p) => Math.max(m, Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2])), 0));
  // the starting tetrahedron
  let i0 = 0;
  for (let k = 1; k < n; k++) if (P[k][0] < P[i0][0]) i0 = k;
  let i1 = -1, best = -1;
  for (let k = 0; k < n; k++) {
    const d = vlen(vsub([0, 0, 0], P[k], P[i0]));
    if (d > best) (best = d), (i1 = k);
  }
  let i2 = -1;
  best = -1;
  const e01 = vsub([0, 0, 0], P[i1], P[i0]);
  for (let k = 0; k < n; k++) {
    const d = vlen(vcross([0, 0, 0], e01, vsub([0, 0, 0], P[k], P[i0])));
    if (d > best) (best = d), (i2 = k);
  }
  const nrm = vnorm([0, 0, 0], vcross([0, 0, 0], e01, vsub([0, 0, 0], P[i2], P[i0])));
  let i3 = -1;
  best = -1;
  for (let k = 0; k < n; k++) {
    const d = Math.abs(vdot(nrm, vsub([0, 0, 0], P[k], P[i0])));
    if (d > best) (best = d), (i3 = k);
  }
  if (best < eps * 10) throw new Error('ConvexHull: the points are flat');
  const inside = [0, 1, 2].map((c) => (P[i0][c] + P[i1][c] + P[i2][c] + P[i3][c]) / 4);
  let tris = [];
  const mk = (a, b, c) => {
    let nn = vcross([0, 0, 0], vsub([0, 0, 0], P[b], P[a]), vsub([0, 0, 0], P[c], P[a]));
    if (vdot(nn, vsub([0, 0, 0], inside, P[a])) > 0) {
      [b, c] = [c, b];
      nn = vscale(nn, nn, -1);
    }
    vnorm(nn, nn);
    return { v: [a, b, c], n: nn, d: vdot(nn, P[a]) };
  };
  tris.push(mk(i0, i1, i2), mk(i0, i1, i3), mk(i0, i2, i3), mk(i1, i2, i3));
  const used = new Set([i0, i1, i2, i3]);
  for (let k = 0; k < n; k++) {
    if (used.has(k)) continue;
    const p = P[k];
    const vis = tris.map((t) => vdot(t.n, p) - t.d > eps * 10);
    if (!vis.some(Boolean)) continue;
    // the horizon: edges of visible triangles whose twin is on a hidden one
    const edgeOwner = new Map();
    tris.forEach((t, ti) => {
      for (let e = 0; e < 3; e++) edgeOwner.set(t.v[e] * 1e6 + t.v[(e + 1) % 3], ti);
    });
    const next = [];
    tris.forEach((t, ti) => {
      if (!vis[ti]) return next.push(t);
      for (let e = 0; e < 3; e++) {
        const a = t.v[e], b = t.v[(e + 1) % 3];
        const twin = edgeOwner.get(b * 1e6 + a);
        if (twin !== undefined && !vis[twin]) {
          const nn = vnorm([0, 0, 0], vcross([0, 0, 0], vsub([0, 0, 0], P[b], P[a]), vsub([0, 0, 0], p, P[a])));
          next.push({ v: [a, b, k], n: nn, d: vdot(nn, P[a]) });
        }
      }
    });
    tris = next;
    used.add(k);
  }
  // merge coplanar triangles into polygons
  const groups = [];
  for (const t of tris) {
    const g = groups.find((G) => vdot(G.n, t.n) > 1 - 1e-6 && Math.abs(G.d - t.d) < eps * 100 + 1e-9);
    if (g) for (const v of t.v) g.vs.add(v);
    else groups.push({ n: t.n, d: t.d, vs: new Set(t.v) });
  }
  const remap = new Map();
  const verts = [];
  const faces = groups.map((g) => {
    const vs = [...g.vs];
    const c = [0, 0, 0];
    for (const v of vs) vadd(c, c, P[v]);
    vscale(c, c, 1 / vs.length);
    const u = [0, 0, 0], w = [0, 0, 0];
    {
      const t = Math.abs(g.n[0]) > 0.57 ? [g.n[1], -g.n[0], 0] : [0, g.n[2], -g.n[1]];
      vnorm(u, t);
      vcross(w, g.n, u);
    }
    const ang = (v) => {
      const d = vsub([0, 0, 0], P[v], c);
      return Math.atan2(vdot(d, w), vdot(d, u));
    };
    vs.sort((a, b) => ang(a) - ang(b));
    // (drop points in the middle of an edge: collinear with their neighbours)
    const keep = vs.filter((v, k) => {
      const a = P[vs[(k + vs.length - 1) % vs.length]], b = P[vs[(k + 1) % vs.length]];
      return vlen(vcross([0, 0, 0], vsub([0, 0, 0], P[v], a), vsub([0, 0, 0], b, a))) > eps * 100;
    });
    const vi = keep.map((v) => {
      if (!remap.has(v)) {
        remap.set(v, verts.length);
        verts.push(P[v].slice());
      }
      return remap.get(v);
    });
    return { n: g.n.slice(), d: g.d, vi };
  });
  return { verts, faces };
}

/** Several shapes as one: [{ shape, pos = [0,0,0], quat = [0,0,0,1], density? }]. */
export class Compound {
  constructor(children) {
    this.type = 'compound';
    this.id = ++SHAPE_ID;
    this.children = children.map((c) => {
      const quat = c.quat ? c.quat.slice() : qident();
      const R = mat3FromQuat([], quat);
      const ident = Math.abs(R[0] - 1) + Math.abs(R[4] - 1) + Math.abs(R[8] - 1) < 1e-12;
      return { shape: c.shape, pos: c.pos ? c.pos.slice() : [0, 0, 0], quat, R, ident, density: c.density, mass: c.mass };
    });
    this._cb = [0, 0, 0, 0, 0, 0];
    this._cp = [0, 0, 0];
  }
  massProps(rho = 1000) {
    const parts = this.children.map((c) => {
      let mp = c.shape.massProps(c.density ?? rho);
      if (c.mass !== undefined) {
        const s = c.mass / mp.mass;
        mp = { ...mp, mass: c.mass, I: mp.I.map((v) => v * s) };
      }
      return { m: mp.mass, com: vadd([0, 0, 0], c.pos, m3mulv([0, 0, 0], c.R, mp.com)), I: m3rotate([], c.R, mp.I), vol: mp.volume };
    });
    const M = parts.reduce((s, p) => s + p.m, 0);
    const com = [0, 0, 0];
    for (const p of parts) for (let a = 0; a < 3; a++) com[a] += (p.com[a] * p.m) / M;
    let I = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const p of parts) I = m3add(I, m3add([], p.I, parallelAxis(vsub([0, 0, 0], p.com, com), p.m)), I);
    return { mass: M, com, I, volume: parts.reduce((s, p) => s + p.vol, 0) };
  }
  aabb(p, R, out) {
    out[0] = out[1] = out[2] = Infinity;
    out[3] = out[4] = out[5] = -Infinity;
    const cb = this._cb;
    const cp = this._cp;
    for (const c of this.children) {
      const CR = c.ident ? R : mulR(R, c.R);
      vadd(cp, p, m3mulv(cp, R, c.pos));
      c.shape.aabb(cp, CR, cb);
      for (let a = 0; a < 3; a++) {
        out[a] = Math.min(out[a], cb[a]);
        out[a + 3] = Math.max(out[a + 3], cb[a + 3]);
      }
    }
    return out;
  }
  get innerRadius() {
    return (this._inner ??= Math.max(...this.children.map((c) => c.shape.innerRadius ?? 0)));
  }
  samples(n = 3) {
    const out = [];
    for (const c of this.children) for (const s of c.shape.samples(n)) out.push({ p: vadd([0, 0, 0], c.pos, m3mulv([0, 0, 0], c.R, s.p)), vol: s.vol });
    return out;
  }
}

const CA = [0, 0, 0], CB = [0, 0, 0]; // (scratch for Capsule.aabb)
const mulR = (A, B) => {
  const o = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[3 * i + j] = A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j];
  return o;
};

/**
 * A rigid chunk of voxels (h: the voxel size; centres: each voxel's centre in the shape frame, on
 * a lattice of pitch h; masses: kg each). Against other bodies it is a compound of boxes, one per
 * surface voxel; against the voxel world its outer corners are tested (and the world's corners
 * against its lattice: O(1) per corner).
 */
const KEY = (x, y, z) => x + 1024 + 2048 * (y + 1024 + 2048 * (z + 1024));
export class VoxelSet {
  constructor(h, centres, masses) {
    this.type = 'voxels';
    this.id = ++SHAPE_ID;
    this.h = h;
    this.n = centres.length;
    this.centres = centres.map((c) => c.slice());
    this.masses = masses ? Array.from(masses) : centres.map(() => 1000 * h ** 3);
    // the lattice: integer coordinates from the first voxel
    const o = this.centres[0];
    this.origin = o.slice();
    this.cell = this.centres.map((c) => [Math.round((c[0] - o[0]) / h), Math.round((c[1] - o[1]) / h), Math.round((c[2] - o[2]) / h)]);
    this.index = new Map();
    this.cell.forEach((c, k) => this.index.set(KEY(c[0], c[1], c[2]), k));
    const has = (x, y, z) => this.index.has(KEY(x, y, z));
    // surface voxels (a face open), and the outer corners (a corner some of whose 8 voxels are missing)
    this.surface = [];
    const corners = new Map();
    this.cell.forEach(([x, y, z], k) => {
      if (!has(x + 1, y, z) || !has(x - 1, y, z) || !has(x, y + 1, z) || !has(x, y - 1, z) || !has(x, y, z + 1) || !has(x, y, z - 1)) this.surface.push(k);
      for (let c = 0; c < 8; c++) {
        const cx = x + (c & 1), cy = y + ((c >> 1) & 1), cz = z + ((c >> 2) & 1); // corner (cx, cy, cz) at lattice offset −½
        const key = KEY(cx, cy, cz);
        if (corners.has(key)) continue;
        let full = true;
        for (let d = 0; d < 8 && full; d++) if (!has(cx - (d & 1), cy - ((d >> 1) & 1), cz - ((d >> 2) & 1))) full = false;
        corners.set(key, full ? null : [o[0] + (cx - 0.5) * h, o[1] + (cy - 0.5) * h, o[2] + (cz - 0.5) * h]);
      }
    });
    this.corners = [...corners.values()].filter(Boolean);
    const box = new Box(h / 2);
    this.box = box;
    this.children = this.surface.map((k) => ({ shape: box, pos: this.centres[k], quat: qident(), R: [1, 0, 0, 0, 1, 0, 0, 0, 1], voxel: k }));
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const c of this.centres) for (let a = 0; a < 3; a++) (lo[a] = Math.min(lo[a], c[a] - h / 2)), (hi[a] = Math.max(hi[a], c[a] + h / 2));
    this.lo = lo;
    this.hi = hi;
  }
  /** The voxel (index) whose cube holds shape-frame point x, or −1. */
  voxelAt(x) {
    const h = this.h, o = this.origin;
    const k = this.index.get(KEY(Math.round((x[0] - o[0]) / h), Math.round((x[1] - o[1]) / h), Math.round((x[2] - o[2]) / h)));
    return k === undefined ? -1 : k;
  }
  hasCell(x, y, z) {
    return this.index.has(KEY(x, y, z));
  }
  massProps() {
    const h = this.h;
    let M = 0;
    const com = [0, 0, 0];
    this.centres.forEach((c, k) => {
      M += this.masses[k];
      for (let a = 0; a < 3; a++) com[a] += c[a] * this.masses[k];
    });
    vscale(com, com, 1 / M);
    let I = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    this.centres.forEach((c, k) => {
      const m = this.masses[k], s = (m * h * h) / 6;
      I = m3add(I, I, parallelAxis(vsub([0, 0, 0], c, com), m));
      I[0] += s;
      I[4] += s;
      I[8] += s;
    });
    return { mass: M, com, I, volume: this.n * h ** 3 };
  }
  aabb(p, R, out) {
    const lo = this.lo, hi = this.hi;
    // the rotated box of its local bounds (conservative)
    const c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2], e = [(hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2, (hi[2] - lo[2]) / 2];
    const wc = m3mulv([0, 0, 0], R, c);
    for (let a = 0; a < 3; a++) {
      const ext = Math.abs(R[3 * a]) * e[0] + Math.abs(R[3 * a + 1]) * e[1] + Math.abs(R[3 * a + 2]) * e[2];
      out[a] = p[a] + wc[a] - ext;
      out[a + 3] = p[a] + wc[a] + ext;
    }
    return out;
  }
  get innerRadius() {
    return this.h / 2;
  }
  samples() {
    return this.centres.map((c) => ({ p: c.slice(), vol: this.h ** 3 }));
  }
}

/** n³ points over a box, those inside a shape, with an equal share of its volume. */
function gridSamples(shape, lo, hi, n, inside) {
  const pts = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      for (let k = 0; k < n; k++) {
        const p = [lo[0] + ((i + 0.5) / n) * (hi[0] - lo[0]), lo[1] + ((j + 0.5) / n) * (hi[1] - lo[1]), lo[2] + ((k + 0.5) / n) * (hi[2] - lo[2])];
        if (inside(p)) pts.push(p);
      }
  if (!pts.length) pts.push([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2]);
  const V = shape.massProps(1).volume;
  return pts.map((p) => ({ p, vol: V / pts.length }));
}
