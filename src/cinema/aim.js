/**
 * Where a film camera (models/camera.js) points and what it follows, without three.js
 * (test/cinemaAim.test.js).
 *
 *  - Its direction as pan / tilt (degrees: pan the turn, 0 along +z, 90 along +x; tilt up +) and
 *    back: the camera object's turn is the pan, its Tilt X minus the tilt (down +).
 *  - What it follows (its position: follow, track, orbit) and what it looks at, each its own
 *    target: a moving thing of the world by its id (rig.js subjectsOf: 'dragon:koi:1',
 *    'soldier:Alpha:3', 'car:jeep:1'…) or an object of the scene by its name ('obj:House 1',
 *    a name given the object when it is first aimed at). A camera can stand still and look at
 *    the helicopter, or follow the car and look at the dragon.
 *  - Framing: the look target kept at a point of the frame (the rule of thirds) instead of the
 *    middle: the camera turned so that it lands there.
 *  - A click in the view picks a target: the subject nearest the ray, or the object (voxel) hit.
 */
import { forwardOf, rightOf, findSubject, pickSubject } from './rig.js';

const DEG = Math.PI / 180;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const r2 = (v) => Math.round(v * 100) / 100;

/** The direction of a pan / tilt (degrees, tilt up +): a unit vector. */
export function dirFromPanTilt(pan, tilt) {
  return forwardOf((pan ?? 0) * DEG, -(tilt ?? 0) * DEG);
}

/** Pan / tilt (degrees: pan 0..360, tilt -90..90 up +) of a direction. */
export function panTiltOf(dir) {
  const L = len(dir) || 1;
  const pan = ((Math.atan2(dir[0], dir[2]) / DEG) % 360 + 360) % 360;
  const tilt = Math.asin(Math.max(-1, Math.min(1, dir[1] / L))) / DEG;
  return { pan, tilt };
}

/** The point a pan / tilt looks at from pos, dist m away. */
export function aimFromPanTilt(pos, pan, tilt, dist = 10) {
  const d = dirFromPanTilt(pan, tilt);
  return [pos[0] + d[0] * dist, pos[1] + d[1] * dist, pos[2] + d[2] * dist];
}

/**
 * The aim from pos at a point: { pan, tilt (up +), dist, rotation, tiltX } (rotation and tiltX:
 * the camera object's fields, rounded to 0.01°).
 */
export function aimAt(pos, point) {
  const d = sub(point, pos);
  const dist = len(d);
  if (dist < 1e-6) return { pan: 0, tilt: 0, dist: 0, rotation: 0, tiltX: 0 };
  const { pan, tilt } = panTiltOf(d);
  return { pan, tilt, dist, rotation: r2(pan) % 360, tiltX: r2(-tilt) || 0 };
}

/* ---------------- framing ---------------- */
/** Where in the frame the look target is kept: [x, y] from the middle (-1..1 across; ±1/3: the thirds). */
export const FRAMINGS = {
  centre: [0, 0],
  'left third': [-1 / 3, 0],
  'right third': [1 / 3, 0],
  'upper left third': [-1 / 3, 1 / 3],
  'upper right third': [1 / 3, 1 / 3],
  'lower left third': [-1 / 3, -1 / 3],
  'lower right third': [1 / 3, -1 / 3],
  'upper third': [0, 1 / 3],
  'lower third': [0, -1 / 3],
  custom: null,
};
export const FRAMING_NAMES = Object.keys(FRAMINGS);

/** A camera's framing (its params): [x, y] in the frame. */
export function framingOf(P) {
  const f = FRAMINGS[P?.framing ?? 'centre'];
  if (f) return f;
  const c = (v) => Math.max(-0.95, Math.min(0.95, Number.isFinite(v) ? v : 0));
  return [c(P?.frameX), c(P?.frameY)];
}

/**
 * Where a camera at pos looks (its target point) so that `look` lands at [fx, fy] of its frame
 * (horizontal field of view hFov degrees, the frame's aspect): exact for a camera without roll
 * (pan about the vertical, then tilt). Returns a point as far from pos as look is.
 */
export function frameTarget(pos, look, fx, fy, hFov, aspect) {
  const d = sub(look, pos);
  const dist = len(d);
  if (dist < 1e-6 || (!fx && !fy)) return look.slice();
  const tx = Math.tan((hFov * DEG) / 2), ty = tx / (aspect || 1);
  // the target's direction in the camera's frame (x right, y up, z forward)
  const cx = fx * tx, cy = fy * ty;
  const n = Math.hypot(cx, cy, 1);
  const c = [cx / n, cy / n, 1 / n];
  const dh = d.map((v) => v / dist);
  // the tilt (pitch, down +): dh.y = c.y cos P - c.z sin P
  const A = Math.hypot(c[1], c[2]);
  const phi = Math.atan2(c[2], c[1]);
  const acos = Math.acos(Math.max(-1, Math.min(1, dh[1] / A)));
  const P0 = Math.asin(Math.max(-1, Math.min(1, -dh[1]))); // the pitch looking straight at it
  const cands = [acos - phi, -acos - phi].map((p) => Math.atan2(Math.sin(p), Math.cos(p)));
  let P = cands.reduce((b, p) => (Math.abs(p) <= Math.PI / 2 + 1e-9 && (b === null || Math.abs(p - P0) < Math.abs(b - P0)) ? p : b), null);
  if (P === null) P = P0;
  // the pan: the target's horizontal angle plus how far right of the middle it sits
  const B = c[1] * Math.sin(P) + c[2] * Math.cos(P);
  const Y = Math.atan2(dh[0], dh[2]) + Math.atan2(c[0], B);
  const f = forwardOf(Y, P);
  return [pos[0] + f[0] * dist, pos[1] + f[1] * dist, pos[2] + f[2] * dist];
}

/** Where a point lands in the frame of a camera at pos looking at target (no roll): [x, y] (-1..1), z (in front +). */
export function projectInFrame(pos, target, point, hFov, aspect) {
  const f = sub(target, pos).map((v, _, a) => v / (len(a) || 1));
  const yaw = Math.atan2(f[0], f[2]);
  const r = rightOf(yaw);
  const u = cross(r, f);
  const d = sub(point, pos);
  const z = dot(d, f);
  const tx = Math.tan((hFov * DEG) / 2), ty = tx / (aspect || 1);
  return { x: dot(d, r) / z / tx, y: dot(d, u) / z / ty, z };
}

/* ---------------- targets ---------------- */
/** The label of a model for an object's name: 'Watch tower (wood)' → 'Watch tower'. */
export function baseLabel(label) {
  return String(label ?? 'Object').replace(/ \(.*\)$/, '');
}
/** A name for an object aimed at, not among names: 'House 1', 'House 2'… */
export function objectName(label, names) {
  const used = new Set(names);
  const b = baseLabel(label);
  let n = 1;
  while (used.has(`${b} ${n}`)) n++;
  return `${b} ${n}`;
}

/**
 * The named objects of a scene's world as targets: [{ id: 'obj:<name>', label, kind: 'object',
 * index, p (its origin), yaw, aim: 0 }]. entries: flattenObjects(scene.objects); origins:
 * world.origins (where each one went).
 */
export function objectTargets(entries, origins = [], records = []) {
  const out = [];
  (entries ?? []).forEach((e, i) => {
    const n = e?.node;
    if (!n?.ref) return;
    const rec = records[i] ?? n;
    const o = origins?.[i] ?? [rec.x ?? 0, typeof rec.y === 'number' ? rec.y : 0, rec.z ?? 0];
    out.push({ id: `obj:${n.ref}`, label: n.ref, kind: 'object', index: i, p: o.slice(), yaw: ((rec.rotation ?? 0) * DEG) || 0, aim: 0 });
  });
  return out;
}

/** A target by its id among the subjects and named objects (null: not there). */
export function findTarget(targets, id) {
  if (!id) return null;
  return findSubject(targets, id);
}

/** A target's point to look at: its aim point (m above it), plus an offset in its own frame (turned with it). */
export function targetPoint(s, offset = null) {
  if (!s) return null;
  const base = add(s.p, [0, s.aim ?? 0, 0]);
  if (!offset) return base;
  const c = Math.cos(s.yaw ?? 0), sn = Math.sin(s.yaw ?? 0);
  // (local x right of +z forward is -x: the same frame as the scene's objects, turned by yaw)
  return [base[0] + offset[0] * c + offset[2] * sn, base[1] + offset[1], base[2] - offset[0] * sn + offset[2] * c];
}
/** The offset of a point from a target, in its own frame (the inverse of targetPoint). */
export function offsetFrom(s, point) {
  const base = add(s.p, [0, s.aim ?? 0, 0]);
  const d = sub(point, base);
  const c = Math.cos(s.yaw ?? 0), sn = Math.sin(s.yaw ?? 0);
  return [r2(d[0] * c - d[2] * sn), r2(d[1]), r2(d[0] * sn + d[2] * c)];
}

/**
 * What a camera follows and looks at: { follow (a subject or object, or null: its position does
 * not follow anything), look (a point, or null: along its own aim), lookTarget (what that point
 * is on), carrier (what its path is attached to, or null) }.
 *  cam: { params, follow (id), lookAt (id), lookOffset, aimPoint }; targets: subjects and named
 *  objects (subjectsOf + objectTargets).
 * Old cameras (no ids): the subject by kind and number (params.subject, subjectIndex) for both.
 */
export function resolveTargets(cam, targets) {
  const P = cam.params ?? {};
  const list = targets ?? [];
  const follow = cam.follow ? findTarget(list, cam.follow) : pickSubject(list.filter((s) => s.kind !== 'object'), P.subject, P.subjectIndex);
  let look = null, lookTarget = null;
  if (P.look === 'point' && Array.isArray(cam.aimPoint)) look = cam.aimPoint.slice();
  else if (P.look === 'subject') {
    lookTarget = cam.lookAt ? findTarget(list, cam.lookAt) : follow;
    look = targetPoint(lookTarget, cam.lookAt ? cam.lookOffset : null);
  }
  // what its path is attached to (cinema/path.js), if it is
  const carrier = cam.path?.on ? findTarget(list, cam.path.on) : null;
  return { follow, look, lookTarget, carrier };
}

/**
 * A click in the view as a target: the subject nearest the ray (within reach: 1.2 m, or 4 % of
 * its distance), not behind what the ray hit; else the object whose voxel was hit; else the
 * point hit; else null.
 *  ray: { origin, dir (unit) }; hit: { point, owner (the object's number, -1: none) } or null.
 * Returns { subject } | { owner, point } | { point } | null.
 */
export function pickTarget(ray, hit, subjects) {
  const o = ray.origin, d = ray.dir;
  const far = hit ? len(sub(hit.point, o)) + 2 : Infinity;
  let best = null, bestScore = Infinity;
  for (const s of subjects ?? []) {
    if (s.kind === 'object') continue;
    // the nearest of its foot, middle and aim point to the ray
    for (const k of [0, 0.5, 1]) {
      const q = add(s.p, [0, (s.aim ?? 0) * k, 0]);
      const v = sub(q, o);
      const along = dot(v, d);
      if (along <= 0 || along > far) continue;
      const off = len(sub(v, d.map((x) => x * along)));
      const reach = Math.max(1.2, along * 0.04);
      if (off <= reach && off / reach < bestScore) (bestScore = off / reach), (best = s);
    }
  }
  if (best) return { subject: best };
  if (hit && hit.owner >= 0) return { owner: hit.owner, point: hit.point.slice() };
  if (hit) return { point: hit.point.slice() };
  return null;
}
