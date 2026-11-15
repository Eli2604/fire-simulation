/**
 * Narrowphase: contact points between two placed shapes. A placed shape is (shape, p, R): its frame
 * at p turned by the row-major rotation R. Every contact found is handed to emit(n, point, depth,
 * subA, subB) with the normal n pointing from the first shape to the second, depth > 0 for
 * overlap (and down to −margin for a speculative contact just apart), subA / subB the child index
 * (compound, voxel set) or −1.
 *
 * Pairs: sphere–sphere, sphere–capsule, capsule–capsule (two points when they lie side by side),
 * sphere–polyhedron (box, hull: closest feature), capsule–polyhedron (the segment's closest
 * point by a convex line search, plus its ends when they touch), polyhedron–polyhedron (separating
 * axes: face normals and edge pairs; a face contact clips the incident face against the reference
 * face, up to 4 points; an edge contact the closest points of the two edges), and compound /
 * voxel sets child by child (children whose boxes do not overlap the other shape skipped).
 */
import { vsub, vadd, vdot, vcross, vlen, vnorm, vscale, m3mulv, m3tmulv } from './math.js';

const T = () => [0, 0, 0];

/** R·B (rotation matrices, row-major). */
export function mulR(A, B, o = new Array(9)) {
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[3 * i + j] = A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j];
  return o;
}

const isMulti = (s) => s.type === 'compound' || s.type === 'voxels';
const overlap = (a, b) => a[0] <= b[3] && a[3] >= b[0] && a[1] <= b[4] && a[4] >= b[1] && a[2] <= b[5] && a[5] >= b[2];

/** All contacts between shape A at (pa, Ra) and shape B at (pb, Rb). */
export function collide(A, pa, Ra, B, pb, Rb, margin, emit, subA = -1, subB = -1) {
  if (isMulti(A)) {
    const bb = B.aabb(pb, Rb, [0, 0, 0, 0, 0, 0]);
    const cb = [0, 0, 0, 0, 0, 0];
    for (let k = 0; k < A.children.length; k++) {
      const c = A.children[k];
      const cp = vadd(T(), pa, m3mulv(T(), Ra, c.pos));
      const cR = mulR(Ra, c.R);
      c.shape.aabb(cp, cR, cb);
      cb[0] -= margin;
      cb[1] -= margin;
      cb[2] -= margin;
      cb[3] += margin;
      cb[4] += margin;
      cb[5] += margin;
      if (!overlap(cb, bb)) continue;
      collide(c.shape, cp, cR, B, pb, Rb, margin, emit, c.voxel ?? k, subB);
    }
    return;
  }
  if (isMulti(B)) {
    collide(B, pb, Rb, A, pa, Ra, margin, (n, p, d, sb, sa) => emit(vscale(n, n, -1), p, d, sa, sb), subB, subA);
    return;
  }
  const ta = A.type, tb = B.type;
  if (ta === 'sphere' && tb === 'sphere') return sphereSphere(pa, A.r, pb, B.r, margin, emit, subA, subB);
  if (ta === 'sphere' && tb === 'capsule') return sphereCapsule(pa, A.r, B, pb, Rb, margin, emit, subA, subB, false);
  if (ta === 'capsule' && tb === 'sphere') return sphereCapsule(pb, B.r, A, pa, Ra, margin, emit, subB, subA, true);
  if (ta === 'capsule' && tb === 'capsule') return capsuleCapsule(A, pa, Ra, B, pb, Rb, margin, emit, subA, subB);
  if (A.poly && tb === 'sphere') return polySphere(A, pa, Ra, pb, B.r, margin, emit, subA, subB, false);
  if (ta === 'sphere' && B.poly) return polySphere(B, pb, Rb, pa, A.r, margin, emit, subB, subA, true);
  if (A.poly && tb === 'capsule') return polyCapsule(A, pa, Ra, B, pb, Rb, margin, emit, subA, subB, false);
  if (ta === 'capsule' && B.poly) return polyCapsule(B, pb, Rb, A, pa, Ra, margin, emit, subB, subA, true);
  if (A.poly && B.poly) return polyPoly(A, pa, Ra, B, pb, Rb, margin, emit, subA, subB);
  throw new Error(`no collision routine for ${ta}–${tb}`);
}

function sphereSphere(ca, ra, cb, rb, margin, emit, sa, sb) {
  const d = vsub(T(), cb, ca);
  const l = vlen(d);
  const depth = ra + rb - l;
  if (depth < -margin) return;
  const n = l > 1e-9 ? vscale(d, d, 1 / l) : [0, 1, 0];
  const p = [ca[0] + n[0] * (ra - depth / 2), ca[1] + n[1] * (ra - depth / 2), ca[2] + n[2] * (ra - depth / 2)];
  emit(n, p, depth, sa, sb);
}

/** The ends of a placed capsule's segment. */
function segOf(C, p, R) {
  return [vadd(T(), p, m3mulv(T(), R, C.a)), vadd(T(), p, m3mulv(T(), R, C.b))];
}
/** The parameter t of the point on a–b closest to p. */
function closestT(p, a, b) {
  const ab = vsub(T(), b, a);
  const l2 = vdot(ab, ab);
  return l2 > 1e-12 ? Math.max(0, Math.min(1, vdot(vsub(T(), p, a), ab) / l2)) : 0;
}
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function sphereCapsule(c, r, C, p, R, margin, emit, ss, sc, flip) {
  const [a, b] = segOf(C, p, R);
  const q = lerp3(a, b, closestT(c, a, b));
  // the capsule's point as the first sphere, the sphere as the second (n: capsule → sphere)
  if (flip) sphereSphere(q, C.r, c, r, margin, emit, sc, ss);
  else sphereSphere(c, r, q, C.r, margin, emit, ss, sc);
}

/** Closest points between segments p1–q1 and p2–q2 → [s, t]. */
export function segSeg(p1, q1, p2, q2) {
  const d1 = vsub(T(), q1, p1), d2 = vsub(T(), q2, p2), r = vsub(T(), p1, p2);
  const a = vdot(d1, d1), e = vdot(d2, d2), f = vdot(d2, r);
  let s, t;
  if (a <= 1e-12 && e <= 1e-12) return [0, 0];
  if (a <= 1e-12) {
    s = 0;
    t = Math.max(0, Math.min(1, f / e));
  } else {
    const c = vdot(d1, r);
    if (e <= 1e-12) {
      t = 0;
      s = Math.max(0, Math.min(1, -c / a));
    } else {
      const b = vdot(d1, d2), den = a * e - b * b;
      s = den > 1e-12 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.max(0, Math.min(1, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.max(0, Math.min(1, (b - c) / a));
      }
    }
  }
  return [s, t];
}

function capsuleCapsule(A, pa, Ra, B, pb, Rb, margin, emit, sa, sb) {
  const [a0, a1] = segOf(A, pa, Ra), [b0, b1] = segOf(B, pb, Rb);
  const da = vsub(T(), a1, a0), db = vsub(T(), b1, b0);
  const la = vlen(da), lb = vlen(db);
  if (la > 1e-6 && lb > 1e-6 && Math.abs(vdot(da, db)) / (la * lb) > 0.985) {
    // side by side: up to two points over the overlap (a log on a log does not see-saw)
    const cand = [];
    for (const p of [a0, a1]) cand.push([p, lerp3(b0, b1, closestT(p, b0, b1))]);
    for (const p of [b0, b1]) cand.push([lerp3(a0, a1, closestT(p, a0, a1)), p]);
    const ok = cand.filter(([x, y]) => vlen(vsub(T(), y, x)) < A.r + B.r + margin);
    if (ok.length >= 2) {
      const ax = vscale(T(), da, 1 / la);
      ok.sort((u, v) => vdot(u[0], ax) - vdot(v[0], ax));
      const first = ok[0], last = ok[ok.length - 1];
      if (vdot(last[0], ax) - vdot(first[0], ax) > 1e-4) {
        for (const [x, y] of [first, last]) sphereSphere(x, A.r, y, B.r, margin, emit, sa, sb);
        return;
      }
    }
  }
  const [s, t] = segSeg(a0, a1, b0, b1);
  sphereSphere(lerp3(a0, a1, s), A.r, lerp3(b0, b1, t), B.r, margin, emit, sa, sb);
}

/* ---------- polyhedra ---------- */

/** Vertices and face planes of a placed polyhedron (world). */
function placePoly(S, p, R) {
  const V = S.verts.map((v) => vadd(T(), p, m3mulv(T(), R, v)));
  const F = S.faces.map((f) => {
    const n = m3mulv(T(), R, f.n);
    return { n, d: f.d + vdot(n, p), vi: f.vi };
  });
  return { V, F, S };
}

/**
 * The point of polyhedron S (shape frame) closest to x: { q, inside, n, dist }. Inside, n is the
 * face it is least deep under and dist minus its depth.
 */
export function closestOnPoly(S, x) {
  if (S.type === 'box') {
    const he = S.he;
    const q = [Math.max(-he[0], Math.min(he[0], x[0])), Math.max(-he[1], Math.min(he[1], x[1])), Math.max(-he[2], Math.min(he[2], x[2]))];
    if (q[0] !== x[0] || q[1] !== x[1] || q[2] !== x[2]) return { q, inside: false, dist: vlen(vsub(T(), x, q)) };
    let best = Infinity, ax = 0;
    for (let a = 0; a < 3; a++) {
      const d = he[a] - Math.abs(x[a]);
      if (d < best) (best = d), (ax = a);
    }
    const n = [0, 0, 0];
    n[ax] = x[ax] >= 0 ? 1 : -1;
    const qq = x.slice();
    qq[ax] = n[ax] * he[ax];
    return { q: qq, inside: true, n, dist: -best };
  }
  const [s, fi] = S.maxFace(x);
  if (s <= 0) {
    const f = S.faces[fi];
    return { q: vsub(T(), x, vscale(T(), f.n, s)), inside: true, n: f.n, dist: s };
  }
  let best = Infinity, bq = null;
  for (const f of S.faces) {
    const sd = vdot(f.n, x) - f.d;
    if (sd <= 0) continue;
    const proj = vsub(T(), x, vscale(T(), f.n, sd));
    // inside the polygon?
    let inPoly = true;
    for (let k = 0; k < f.vi.length && inPoly; k++) {
      const a = S.verts[f.vi[k]], b = S.verts[f.vi[(k + 1) % f.vi.length]];
      if (vdot(vcross(T(), vsub(T(), b, a), vsub(T(), proj, a)), f.n) < -1e-12) inPoly = false;
    }
    if (inPoly) {
      if (sd < best) (best = sd), (bq = proj);
      continue;
    }
    for (let k = 0; k < f.vi.length; k++) {
      const a = S.verts[f.vi[k]], b = S.verts[f.vi[(k + 1) % f.vi.length]];
      const q = lerp3(a, b, closestT(x, a, b));
      const d = vlen(vsub(T(), x, q));
      if (d < best) (best = d), (bq = q);
    }
  }
  return { q: bq, inside: false, dist: best };
}

/** Signed distance from x (shape frame) to polyhedron S. */
function polySD(S, x) {
  const c = closestOnPoly(S, x);
  return c.dist;
}

function polySphere(S, p, R, c, r, margin, emit, sp, ss, flip) {
  const xl = m3tmulv(T(), R, vsub(T(), c, p));
  const cl = closestOnPoly(S, xl);
  let nl, depth;
  if (cl.inside) {
    nl = cl.n;
    depth = r - cl.dist;
  } else {
    if (cl.dist > r + margin) return;
    nl = cl.dist > 1e-12 ? vscale(T(), vsub(T(), xl, cl.q), 1 / cl.dist) : [0, 1, 0];
    depth = r - cl.dist;
  }
  const n = m3mulv(T(), R, nl);
  const q = vadd(T(), p, m3mulv(T(), R, cl.q));
  // halfway between the polyhedron's surface and the sphere's deepest point
  const pt = [(q[0] + c[0] - n[0] * r) / 2, (q[1] + c[1] - n[1] * r) / 2, (q[2] + c[2] - n[2] * r) / 2];
  if (flip) emit(vscale(n, n, -1), pt, depth, ss, sp);
  else emit(n, pt, depth, sp, ss);
}

function polyCapsule(S, p, R, C, pc, Rc, margin, emit, sp, sc, flip) {
  const [a, b] = segOf(C, pc, Rc);
  const al = m3tmulv(T(), R, vsub(T(), a, p)), bl = m3tmulv(T(), R, vsub(T(), b, p));
  // the distance along a segment to a convex body is convex: golden-section search
  let lo = 0, hi = 1;
  const g = 0.6180339887;
  let x1 = hi - g * (hi - lo), x2 = lo + g * (hi - lo);
  let f1 = polySD(S, lerp3(al, bl, x1)), f2 = polySD(S, lerp3(al, bl, x2));
  for (let it = 0; it < 22; it++) {
    if (f1 < f2) {
      hi = x2;
      x2 = x1;
      f2 = f1;
      x1 = hi - g * (hi - lo);
      f1 = polySD(S, lerp3(al, bl, x1));
    } else {
      lo = x1;
      x1 = x2;
      f1 = f2;
      x2 = lo + g * (hi - lo);
      f2 = polySD(S, lerp3(al, bl, x2));
    }
  }
  const tm = (lo + hi) / 2;
  const L = vlen(vsub(T(), b, a));
  const ts = [tm];
  for (const te of [0, 1]) if (Math.abs(te - tm) * L > C.r * 0.5 && polySD(S, te ? bl : al) < C.r + margin) ts.push(te);
  for (const t of ts) polySphere(S, p, R, lerp3(a, b, t), C.r, margin, emit, sp, sc, flip);
}

/** Sutherland–Hodgman: the polygon pts kept on the side n·x ≤ d. */
function clipPoly(pts, n, d) {
  const out = [];
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k], b = pts[(k + 1) % pts.length];
    const da = vdot(n, a) - d, db = vdot(n, b) - d;
    if (da <= 0) out.push(a);
    if ((da <= 0) !== (db <= 0)) out.push(lerp3(a, b, da / (da - db)));
  }
  return out;
}

function polyPoly(A, pa, Ra, B, pb, Rb, margin, emit, sa, sb) {
  const PA = placePoly(A, pa, Ra), PB = placePoly(B, pb, Rb);
  const minProj = (V, n) => {
    let m = Infinity;
    for (const v of V) m = Math.min(m, vdot(n, v));
    return m;
  };
  const maxProj = (V, n) => {
    let m = -Infinity;
    for (const v of V) m = Math.max(m, vdot(n, v));
    return m;
  };
  let bestA = -Infinity, fa = -1;
  for (let k = 0; k < PA.F.length; k++) {
    const f = PA.F[k];
    const s = minProj(PB.V, f.n) - f.d;
    if (s > margin) return;
    if (s > bestA) (bestA = s), (fa = k);
  }
  let bestB = -Infinity, fb = -1;
  for (let k = 0; k < PB.F.length; k++) {
    const f = PB.F[k];
    const s = minProj(PA.V, f.n) - f.d;
    if (s > margin) return;
    if (s > bestB) (bestB = s), (fb = k);
  }
  const ca = centroid(PA.V), cb = centroid(PB.V);
  const dc = vsub(T(), cb, ca);
  let bestE = -Infinity, eAx = null, eiA = -1, eiB = -1;
  const ea = A.edgeDirs.map((e) => m3mulv(T(), Ra, e)), eb = B.edgeDirs.map((e) => m3mulv(T(), Rb, e));
  for (let i = 0; i < ea.length; i++)
    for (let j = 0; j < eb.length; j++) {
      const ax = vcross(T(), ea[i], eb[j]);
      const l = vlen(ax);
      if (l < 1e-5) continue;
      vscale(ax, ax, 1 / l);
      if (vdot(ax, dc) < 0) vscale(ax, ax, -1);
      const s = minProj(PB.V, ax) - maxProj(PA.V, ax);
      if (s > margin) return;
      if (s > bestE) (bestE = s), (eAx = ax), (eiA = i), (eiB = j);
    }
  const faceBest = Math.max(bestA, bestB);
  if (eAx && bestE > faceBest + 0.002 + 0.02 * Math.abs(faceBest)) {
    // edge against edge: the supporting edge of each along the axis, their closest points
    const pick = (P, S, R, dir, sign) => {
      let best = -Infinity, e = null;
      for (const [i, j] of S.edges) {
        const d = vsub(T(), P.V[j], P.V[i]);
        const l = vlen(d);
        if (l < 1e-9 || Math.abs(vdot(d, dir)) / l < 0.999) continue;
        const m = (sign * (vdot(eAx, P.V[i]) + vdot(eAx, P.V[j]))) / 2;
        if (m > best) (best = m), (e = [P.V[i], P.V[j]]);
      }
      return e;
    };
    const EA = pick(PA, A, Ra, ea[eiA], 1), EB = pick(PB, B, Rb, eb[eiB], -1);
    if (EA && EB) {
      const [s, t] = segSeg(EA[0], EA[1], EB[0], EB[1]);
      const x = lerp3(EA[0], EA[1], s), y = lerp3(EB[0], EB[1], t);
      emit(eAx, [(x[0] + y[0]) / 2, (x[1] + y[1]) / 2, (x[2] + y[2]) / 2], -bestE, sa, sb);
      return;
    }
  }
  // a face: the reference face (A's unless B's is clearly better), the incident face clipped to it
  const useA = bestA >= bestB - 0.001;
  const ref = useA ? PA : PB, inc = useA ? PB : PA;
  const rf = ref.F[useA ? fa : fb];
  let fi = -1, md = Infinity;
  for (let k = 0; k < inc.F.length; k++) {
    const d = vdot(inc.F[k].n, rf.n);
    if (d < md) (md = d), (fi = k);
  }
  let poly = inc.F[fi].vi.map((i) => inc.V[i]);
  const rv = rf.vi.map((i) => ref.V[i]);
  const rc = centroid(rv);
  for (let k = 0; k < rv.length && poly.length; k++) {
    const a = rv[k], b = rv[(k + 1) % rv.length];
    const sn = vnorm(T(), vcross(T(), vsub(T(), b, a), rf.n));
    if (vdot(sn, vsub(T(), a, rc)) < 0) vscale(sn, sn, -1);
    poly = clipPoly(poly, sn, vdot(sn, a));
  }
  const pts = [];
  for (const q of poly) {
    const depth = rf.d - vdot(rf.n, q);
    if (depth < -margin) continue;
    pts.push({ p: [q[0] + (rf.n[0] * depth) / 2, q[1] + (rf.n[1] * depth) / 2, q[2] + (rf.n[2] * depth) / 2], depth });
  }
  const n = useA ? rf.n.slice() : vscale(T(), rf.n, -1);
  for (const c of reduce4(pts)) emit(n.slice(), c.p, c.depth, sa, sb);
}

function centroid(V) {
  const c = [0, 0, 0];
  for (const v of V) vadd(c, c, v);
  return vscale(c, c, 1 / V.length);
}

/** At most 4 of a patch of contact points ({ p, depth }): the deepest, then those spanning the most area. */
export function reduce4(pts) {
  if (pts.length <= 4) return pts;
  let i0 = 0;
  for (let k = 1; k < pts.length; k++) if (pts[k].depth > pts[i0].depth) i0 = k;
  const P0 = pts[i0].p;
  let i1 = -1, best = -1;
  for (let k = 0; k < pts.length; k++) {
    const d = vlen(vsub(T(), pts[k].p, P0));
    if (d > best) (best = d), (i1 = k);
  }
  const P1 = pts[i1].p;
  let i2 = -1;
  best = -1;
  let nrm = null;
  for (let k = 0; k < pts.length; k++) {
    const c = vcross(T(), vsub(T(), P1, P0), vsub(T(), pts[k].p, P0));
    const a = vlen(c);
    if (a > best) (best = a), (i2 = k), (nrm = c);
  }
  const P2 = pts[i2].p;
  let i3 = -1;
  best = 0;
  if (nrm && vlen(nrm) > 1e-12) {
    vnorm(nrm, nrm);
    // the point making the largest triangle on the far side of the first three
    for (let k = 0; k < pts.length; k++) {
      if (k === i0 || k === i1 || k === i2) continue;
      const q = pts[k].p;
      const a1 = vdot(vcross(T(), vsub(T(), P1, P0), vsub(T(), q, P0)), nrm);
      const a2 = vdot(vcross(T(), vsub(T(), P2, P1), vsub(T(), q, P1)), nrm);
      const a3 = vdot(vcross(T(), vsub(T(), P0, P2), vsub(T(), q, P2)), nrm);
      const m = -Math.min(a1, a2, a3);
      if (m > best) (best = m), (i3 = k);
    }
  }
  const out = [pts[i0], pts[i1], pts[i2]];
  if (i3 >= 0) out.push(pts[i3]);
  return [...new Set(out)];
}
