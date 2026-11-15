/**
 * Keyframes of a world camera (models/camera.js), without three.js (test/cinema.test.js).
 *
 * A key: { t (s), pos [x, y, z], target [x, y, z], focal, focus, fstop, roll, fx: { name: value },
 * ease } — any of them may be missing (a key that only pulls focus has only focus). Each value is
 * interpolated between the keys that have it; `ease` is the easing of the move from that key to
 * the next one. Positions (and targets) go along a Catmull-Rom spline through the keys (smooth),
 * or straight from key to key (linear).
 */

/** Easings: u in 0..1 to 0..1. */
export const EASINGS = {
  linear: (u) => u,
  easeIn: (u) => u * u * u,
  easeOut: (u) => 1 - (1 - u) ** 3,
  easeInOut: (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2),
  smooth: (u) => u * u * (3 - 2 * u),
  hold: (u) => (u < 1 ? 0 : 1),
};
export const EASE_NAMES = Object.keys(EASINGS);

export function ease(name, u) {
  const v = u < 0 ? 0 : u > 1 ? 1 : u;
  return (EASINGS[name] ?? EASINGS.linear)(v);
}

/** The numbers a key can carry (besides pos and target). */
export const KEY_NUMBERS = ['focal', 'focus', 'fstop', 'roll'];

/** Catmull-Rom (uniform) between p1 and p2 at u, p0 and p3 its neighbours. */
export function catmullRom(p0, p1, p2, p3, u) {
  const u2 = u * u, u3 = u2 * u;
  return p1.map((_, i) => 0.5 * (2 * p1[i] + (-p0[i] + p2[i]) * u + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * u2 + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * u3));
}

const lerp = (a, b, u) => a + (b - a) * u;
const lerp3 = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];

/** Keys sorted by time (a copy). */
export function sortKeys(keys) {
  return (keys ?? []).slice().sort((a, b) => a.t - b.t);
}

/** The time of the last key (0 with none): how long the camera's move is. */
export function keysDuration(keys) {
  return (keys ?? []).reduce((m, k) => Math.max(m, k.t ?? 0), 0);
}

/**
 * The segment of a track at t: the keys that have a value (get(k) !== undefined), the index i of
 * the key before t and the eased u to the next. Returns null when no key has it.
 */
function segment(keys, get, t) {
  const ks = keys.filter((k) => get(k) !== undefined && get(k) !== null);
  if (!ks.length) return null;
  if (ks.length === 1 || t <= ks[0].t) return { ks, i: 0, u: 0 };
  const last = ks.length - 1;
  if (t >= ks[last].t) return { ks, i: last, u: 0 };
  let i = 0;
  while (i < last - 1 && t >= ks[i + 1].t) i++;
  const span = ks[i + 1].t - ks[i].t;
  const u = span > 0 ? ease(ks[i].ease ?? 'easeInOut', (t - ks[i].t) / span) : 1;
  return { ks, i, u };
}

/** A number track at t (undefined: no key has it). */
export function sampleNumber(keys, name, t) {
  const get = (k) => (typeof k[name] === 'number' && Number.isFinite(k[name]) ? k[name] : undefined);
  const s = segment(keys, get, t);
  if (!s) return undefined;
  const { ks, i, u } = s;
  if (i >= ks.length - 1 || u === 0) return get(ks[i]);
  return lerp(get(ks[i]), get(ks[i + 1]), u);
}

/** A point track (pos, target) at t: along the spline (spline true) or straight. */
export function samplePoint(keys, name, t, spline = true) {
  const get = (k) => (Array.isArray(k[name]) && k[name].length === 3 ? k[name] : undefined);
  const s = segment(keys, get, t);
  if (!s) return undefined;
  const { ks, i, u } = s;
  if (i >= ks.length - 1 || u === 0) return get(ks[i]).slice();
  const p1 = get(ks[i]), p2 = get(ks[i + 1]);
  if (!spline || ks.length < 3) return lerp3(p1, p2, u);
  const p0 = i > 0 ? get(ks[i - 1]) : p1.map((v, k) => 2 * v - p2[k]);
  const p3 = i + 2 < ks.length ? get(ks[i + 2]) : p2.map((v, k) => 2 * v - p1[k]);
  return catmullRom(p0, p1, p2, p3, u);
}

/**
 * Everything the keys say at t: { pos, target, focal, focus, fstop, roll, fx } (each undefined
 * where no key has it; fx: the effect values that some key has).
 */
export function sampleKeys(keys, t, { spline = true } = {}) {
  const ks = sortKeys(keys);
  const out = { pos: samplePoint(ks, 'pos', t, spline), target: samplePoint(ks, 'target', t, spline) };
  for (const n of KEY_NUMBERS) out[n] = sampleNumber(ks, n, t);
  const names = new Set();
  for (const k of ks) for (const n of Object.keys(k.fx ?? {})) names.add(n);
  if (names.size) {
    out.fx = {};
    const flat = ks.map((k) => ({ t: k.t, ease: k.ease, ...(k.fx ?? {}) }));
    for (const n of names) {
      const v = sampleNumber(flat, n, t);
      if (v !== undefined) out.fx[n] = v;
    }
  }
  return out;
}

/** The path the camera's position takes, sampled (for drawing it): n points per segment. */
export function samplePath(keys, { spline = true, n = 12 } = {}) {
  const ks = sortKeys(keys).filter((k) => Array.isArray(k.pos));
  if (ks.length < 2) return ks.map((k) => k.pos.slice());
  const pts = [];
  for (let i = 0; i < ks.length - 1; i++) for (let j = 0; j < n; j++) pts.push(samplePoint(ks, 'pos', ks[i].t + ((ks[i + 1].t - ks[i].t) * j) / n, spline));
  pts.push(ks[ks.length - 1].pos.slice());
  return pts;
}

/**
 * A key put in at t (replacing one within 0.05 s of it): a new, sorted array.
 */
export function setKey(keys, key) {
  const out = (keys ?? []).filter((k) => Math.abs(k.t - key.t) > 0.05);
  out.push(key);
  return sortKeys(out);
}
