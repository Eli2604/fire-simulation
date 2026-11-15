/**
 * Ray and sphere casts against a placed shape: raycastShape(shape, p, R, from, dir, maxT, r = 0)
 * → { t, point, normal } (dir a unit vector; r > 0: a sphere of that radius swept along the ray,
 * t how far its centre got). Exact for spheres, boxes and hulls (slabs / face planes) with r = 0;
 * sphere tracing on the shape's distance otherwise (capsules, swept spheres).
 */
import { vsub, vadd, vdot, vlen, vscale, m3mulv, m3tmulv } from './math.js';
import { closestOnPoly, mulR } from './collide.js';

const T = () => [0, 0, 0];

export function raycastShape(S, p, R, from, dir, maxT, r = 0) {
  if (S.type === 'compound' || S.type === 'voxels') {
    let best = null;
    for (const c of S.children) {
      const cp = vadd(T(), p, m3mulv(T(), R, c.pos));
      const hit = raycastShape(c.shape, cp, mulR(R, c.R), from, dir, best ? best.t : maxT, r);
      if (hit && (!best || hit.t < best.t)) best = hit;
    }
    return best;
  }
  if (S.type === 'sphere') {
    const rr = S.r + r;
    const m = vsub(T(), from, p);
    const b = vdot(m, dir), c = vdot(m, m) - rr * rr;
    if (c > 0 && b > 0) return null;
    const disc = b * b - c;
    if (disc < 0) return null;
    const t = Math.max(0, -b - Math.sqrt(disc));
    if (t > maxT) return null;
    const pt = [from[0] + dir[0] * t, from[1] + dir[1] * t, from[2] + dir[2] * t];
    const n = vsub(T(), pt, p);
    vscale(n, n, 1 / (vlen(n) || 1));
    return { t, point: r ? vsub(T(), pt, vscale(T(), n, r)) : pt, normal: n };
  }
  if (S.poly && r === 0) {
    // the ray in the shape frame, clipped by every face plane
    const o = m3tmulv(T(), R, vsub(T(), from, p)), d = m3tmulv(T(), R, dir);
    let t0 = 0, t1 = maxT, fn = -1;
    for (let k = 0; k < S.faces.length; k++) {
      const f = S.faces[k];
      const den = vdot(f.n, d), dist = f.d - vdot(f.n, o);
      if (Math.abs(den) < 1e-12) {
        if (dist < 0) return null;
        continue;
      }
      const t = dist / den;
      if (den < 0) {
        if (t > t0) (t0 = t), (fn = k);
      } else if (t < t1) t1 = t;
      if (t0 > t1) return null;
    }
    const pt = [from[0] + dir[0] * t0, from[1] + dir[1] * t0, from[2] + dir[2] * t0];
    return { t: t0, point: pt, normal: fn >= 0 ? m3mulv(T(), R, S.faces[fn].n) : vscale(T(), dir, -1) };
  }
  // sphere tracing on the distance to the shape
  const dist = (x) => {
    const l = m3tmulv(T(), R, vsub(T(), x, p));
    if (S.type === 'capsule') {
      const ab = vsub(T(), S.b, S.a);
      const l2 = vdot(ab, ab);
      const t = l2 > 1e-12 ? Math.max(0, Math.min(1, vdot(vsub(T(), l, S.a), ab) / l2)) : 0;
      const q = [S.a[0] + ab[0] * t, S.a[1] + ab[1] * t, S.a[2] + ab[2] * t];
      const dd = vsub(T(), l, q);
      const L = vlen(dd);
      return [L - S.r - r, L > 1e-9 ? m3mulv(T(), R, vscale(dd, dd, 1 / L)) : vscale(T(), dir, -1)];
    }
    const c = closestOnPoly(S, l);
    const n = c.inside ? c.n : vscale(T(), vsub(T(), l, c.q), 1 / (c.dist || 1));
    return [c.dist - r, m3mulv(T(), R, n)];
  };
  let t = 0;
  for (let it = 0; it < 96; it++) {
    const x = [from[0] + dir[0] * t, from[1] + dir[1] * t, from[2] + dir[2] * t];
    const [d, n] = dist(x);
    if (d < 1e-4) return { t, point: r ? vsub(T(), x, vscale(T(), n, r)) : x, normal: n };
    t += d;
    if (t > maxT) return null;
  }
  return null;
}
