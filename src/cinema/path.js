/**
 * A camera path (models/camera.js `path`, move 'path'), without three.js (test/cinemaPath.test.js).
 *
 *  path: { points: [{ p: [x, y, z], t (s; optional: when the camera is there, 'per point'
 *          timing), ease (to the next point) }], closed (a loop back to the first point),
 *          on (optional: the id of a subject or object it is attached to, cinema/aim.js: its
 *          points are then in that thing's own frame and the path moves and turns with it) }
 *
 * The curve is a centripetal Catmull-Rom spline through the points (no loops or cusps where
 * points bunch up), sampled finely and parameterised by arc length, so a camera at a constant
 * speed in m/s moves evenly along it however the points are spaced. Timing:
 *   speed      along it at params.pathSpeed m/s
 *   per point  at each point at its time (missing times worked out from the speed), eased between
 * and at its end (params.pathEnd): stop ('once'), go round again ('loop'; an open path jumps back
 * to its start), or back and forth ('ping-pong'). A camera can start further along (pathStart, m)
 * or later (pathDelay, s): cameras sharing one path, spaced out on it.
 * Orientation: along the path (its tangent, or at the point pathLookAhead m further on), unless
 * the camera looks at something (its Aim); banking (pathBank) rolls it into the curves as a
 * plane would for its speed.
 */
import { ease } from './keyframes.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const lerp3 = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
const norm = (a) => {
  const L = len(a);
  return L > 1e-9 ? a.map((v) => v / L) : [0, 0, 1];
};

export const PATH_ENDS = ['once', 'loop', 'ping-pong'];
export const PATH_TIMINGS = ['speed', 'per point'];

/** The control points of a path: [[x, y, z]]. */
export function controlPoints(path) {
  return (path?.points ?? []).map((q) => (Array.isArray(q) ? q : q?.p)).filter((p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite));
}

/** Centripetal Catmull-Rom (Barry–Goldman) between p1 and p2 at u (0..1); alpha 0.5: centripetal. */
export function centripetal(p0, p1, p2, p3, u, alpha = 0.5) {
  const knot = (a, b, t) => t + Math.max(1e-6, len(sub(b, a)) ** alpha);
  const t0 = 0, t1 = knot(p0, p1, t0), t2 = knot(p1, p2, t1), t3 = knot(p2, p3, t2);
  const t = t1 + (t2 - t1) * u;
  const L = (a, b, ta, tb) => lerp3(a, b, (t - ta) / (tb - ta));
  const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
  const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
  return L(B1, B2, t1, t2);
}

/**
 * A path sampled and measured: { pts (samples), s (arc length at each), length, closed,
 * knots (arc length at each control point; closed: and the first again at the end), n (points) }.
 */
export function buildPath(path, { per = 24 } = {}) {
  const P = controlPoints(path);
  const closed = !!path?.closed && P.length >= 3;
  const n = P.length;
  if (n === 0) return { pts: [], s: [], length: 0, closed: false, knots: [], n: 0 };
  if (n === 1) return { pts: [P[0].slice()], s: [0], length: 0, closed: false, knots: [0], n: 1 };
  const get = (i) => {
    if (closed) return P[((i % n) + n) % n];
    if (i < 0) return P[0].map((v, k) => 2 * v - P[1][k]);
    if (i >= n) return P[n - 1].map((v, k) => 2 * v - P[n - 2][k]);
    return P[i];
  };
  const segs = closed ? n : n - 1;
  const pts = [], s = [], knots = [];
  let acc = 0;
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < per; j++) {
      const q = centripetal(get(i - 1), get(i), get(i + 1), get(i + 2), j / per);
      if (pts.length) acc += len(sub(q, pts[pts.length - 1]));
      if (j === 0) knots.push(acc);
      pts.push(q);
      s.push(acc);
    }
  }
  const last = closed ? P[0] : P[n - 1];
  acc += len(sub(last, pts[pts.length - 1]));
  pts.push(last.slice());
  s.push(acc);
  knots.push(acc);
  return { pts, s, length: acc, closed, knots, n };
}

/** A path's cache: built once per change of its points (keyed by the path object). */
const cache = new WeakMap();
export function measured(path) {
  if (!path || typeof path !== 'object') return buildPath(null);
  const key = JSON.stringify([path.points, !!path.closed]);
  const c = cache.get(path);
  if (c && c.key === key) return c.M;
  const M = buildPath(path);
  cache.set(path, { key, M });
  return M;
}

/** The point and unit tangent at arc length d (closed: round and round; open: clamped). */
export function pointAt(M, d) {
  const { pts, s, length } = M;
  if (!pts.length) return { pos: [0, 0, 0], tangent: [0, 0, 1], d: 0 };
  if (pts.length === 1 || length <= 0) return { pos: pts[0].slice(), tangent: [0, 0, 1], d: 0 };
  if (M.closed) d = ((d % length) + length) % length;
  else d = Math.max(0, Math.min(length, d));
  // binary search for the sample span
  let lo = 0, hi = s.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s[mid] <= d) lo = mid;
    else hi = mid;
  }
  const span = s[hi] - s[lo];
  const u = span > 0 ? (d - s[lo]) / span : 0;
  return { pos: lerp3(pts[lo], pts[hi], u), tangent: norm(sub(pts[hi], pts[lo])), d };
}

/**
 * The times of the control points (per point timing): their own t where given, the others from
 * the speed (m/s) along the curve; closed: one more, back at the first point.
 */
export function knotTimes(path, M, speed = 5) {
  const pts = path?.points ?? [];
  const v = Math.max(0.01, speed);
  const out = [];
  for (let i = 0; i < M.knots.length; i++) {
    const own = i < pts.length ? pts[i]?.t : undefined;
    if (Number.isFinite(own) && (!out.length || own >= out[out.length - 1])) out.push(own);
    else if (!out.length) out.push(0);
    else out.push(out[out.length - 1] + (M.knots[i] - M.knots[i - 1]) / v);
  }
  return out;
}

/** How long one run along the path takes (s). */
export function pathDuration(path, P = {}) {
  const M = measured(path);
  if (P.pathTiming === 'per point') {
    const T = knotTimes(path, M, P.pathSpeed);
    return T.length ? T[T.length - 1] - T[0] : 0;
  }
  return M.length / Math.max(0.01, P.pathSpeed ?? 5);
}

/** A distance along a run (0..L) for a time along it, by the end mode. */
function wrap(x, L, end) {
  if (L <= 0) return 0;
  if (end === 'loop') return ((x % L) + L) % L;
  if (end === 'ping-pong') {
    const q = ((x % (2 * L)) + 2 * L) % (2 * L);
    return q <= L ? q : 2 * L - q;
  }
  return Math.max(0, Math.min(L, x));
}

/**
 * How far along the path (m) the camera is at time t of its move.
 *  P: { pathTiming, pathSpeed, pathEnd, pathStart (m), pathDelay (s) }
 */
export function distanceAt(path, t, P = {}) {
  const M = measured(path);
  const L = M.length;
  const end = P.pathEnd ?? 'once';
  const tt = t - (P.pathDelay ?? 0);
  if (P.pathTiming === 'per point' && M.knots.length >= 2) {
    const T = knotTimes(path, M, P.pathSpeed);
    const T0 = T[0], dur = T[T.length - 1] - T0;
    if (!(dur > 0)) return wrap(P.pathStart ?? 0, L, end);
    // the time along one run, by the end mode, then its place between the points
    const run = wrap(tt - T0, dur, end) + T0;
    let i = 0;
    while (i < T.length - 2 && run >= T[i + 1]) i++;
    const span = T[i + 1] - T[i];
    const u = span > 0 ? ease(path.points?.[i]?.ease ?? 'linear', (run - T[i]) / span) : 1;
    const d = M.knots[i] + (M.knots[i + 1] - M.knots[i]) * u;
    return (P.pathStart ?? 0) ? wrap(d + P.pathStart, L, M.closed ? 'loop' : 'once') : d;
  }
  const v = P.pathSpeed ?? 5;
  return wrap((P.pathStart ?? 0) + v * Math.max(0, tt), L, M.closed && end === 'once' ? 'once' : end);
}

/** A local point of an attached path in the world (the carrier: { p, yaw }). */
export function carry(carrier, q) {
  if (!carrier) return q.slice();
  const c = Math.cos(carrier.yaw ?? 0), s = Math.sin(carrier.yaw ?? 0);
  return [carrier.p[0] + q[0] * c + q[2] * s, carrier.p[1] + q[1], carrier.p[2] - q[0] * s + q[2] * c];
}
/** A world point into an attached path's frame (the inverse of carry). */
export function uncarry(carrier, q) {
  if (!carrier) return q.slice();
  const c = Math.cos(carrier.yaw ?? 0), s = Math.sin(carrier.yaw ?? 0);
  const d = [q[0] - carrier.p[0], q[1] - carrier.p[1], q[2] - carrier.p[2]];
  return [d[0] * c - d[2] * s, d[1], d[0] * s + d[2] * c];
}
const carryDir = (carrier, d) => (carrier ? sub(carry(carrier, d), carry(carrier, [0, 0, 0])) : d);

/**
 * The camera on its path at time t: { pos, tangent (unit, world), ahead (the point it looks at
 * along the path), roll (degrees: banking), d (m along it), length }. carrier: what the path is
 * attached to ({ p, yaw }) or null.
 */
export function evalPath(path, t, P = {}, carrier = null) {
  const M = measured(path);
  const d = distanceAt(path, t, P);
  const at = pointAt(M, d);
  // which way it is going (ping-pong: back along the tangent on the way back)
  const dt = 0.05;
  const d2 = distanceAt(path, t + dt, P);
  const dir = d2 < d - 1e-9 && !(M.closed && d - d2 > M.length / 2) ? -1 : 1;
  const tangent = norm(carryDir(carrier, at.tangent.map((v) => v * dir)));
  const pos = carry(carrier, at.pos);
  const la = Math.max(0, P.pathLookAhead ?? 0);
  const ahead = la > 0 ? carry(carrier, pointAt(M, d + dir * la).pos) : pos.map((v, i) => v + tangent[i] * 10);
  // banking: into the curve, as a plane turning at this speed would (tan roll = v² k / g)
  let roll = 0;
  const bank = P.pathBank ?? 0;
  if (bank > 0 && M.length > 0) {
    const h = Math.min(1, M.length / 20);
    const ta = pointAt(M, d - h).tangent, tb = pointAt(M, d + h).tangent;
    const turn = Math.atan2(ta[2] * tb[0] - ta[0] * tb[2], ta[0] * tb[0] + ta[2] * tb[2]); // + : turning left (towards +x of +z)
    const k = turn / (2 * h);
    let v = Math.abs(d2 - d) / dt;
    if (M.closed && v > M.length / 2 / dt) v = Math.abs(M.length - Math.abs(d2 - d)) / dt;
    roll = Math.max(-45, Math.min(45, (Math.atan((v * v * k * dir) / 9.81) * 180) / Math.PI)) * bank;
  }
  return { pos, tangent, ahead, roll, d, length: M.length };
}

/** The path drawn: its samples in the world (an attached path carried). */
export function pathPolyline(path, carrier = null) {
  return measured(path).pts.map((q) => carry(carrier, q));
}
