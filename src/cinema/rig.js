/**
 * Where a world camera (models/camera.js) is and what it looks at, at a time in its move, without
 * three.js (test/cinema.test.js).
 *
 * The camera object's own pose (x, z, height, turn, tilt X = pitch, tilt Z = roll) is where it
 * stands and looks when it does not move. Its moves (params.move):
 *   static   it stays where it stands
 *   keys     along its keyframes (positions and targets relative to where it stands: moving the
 *            camera object moves the whole path)
 *   dolly    forward (travel m; negative: back) over the duration
 *   truck    sideways (travel m to its right) over the duration
 *   crane    up (travel m) over the duration, still looking at what it looked at (tilting down)
 *   orbit    round the subject (or the point it looks at, radius m ahead), speed °/s
 *   follow   behind the subject (radius m back, height m up), with a lag
 *   track    alongside the subject (radius m to its right, height m up), with a lag
 * and what it looks at (params.look): along its own aim ('forward'), or at the subject.
 * The subject: one of the world's moving things (subjectsOf): the dragon, a helicopter, a soldier
 * of a squad, a boat, a car, a jet, the phoenix.
 */
import { sampleKeys, keysDuration, ease } from './keyframes.js';

export const MOVES = ['static', 'keys', 'dolly', 'truck', 'crane', 'orbit', 'follow', 'track'];
export const SUBJECTS = ['none', 'dragon', 'helicopter', 'soldier', 'boat', 'car', 'jet', 'phoenix'];

const DEG = Math.PI / 180;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

/** The aim of a pose (yaw, pitch in radians; three.js Euler 'YXZ' of the object, +z forward, pitch + down). */
export function forwardOf(yaw, pitch) {
  return [Math.cos(pitch) * Math.sin(yaw), -Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)];
}
/** Its right hand (horizontal). */
export function rightOf(yaw) {
  return [-Math.cos(yaw), 0, Math.sin(yaw)];
}

/** The base pose of a camera object from its record: { origin, yaw, pitch, roll } (radians). */
export function basePose(rec, originY) {
  return { origin: [rec.x ?? 0, originY ?? (typeof rec.y === 'number' ? rec.y : 1.6), rec.z ?? 0], yaw: (rec.rotation ?? 0) * DEG, pitch: (rec.tiltX ?? 0) * DEG, roll: (rec.tiltZ ?? 0) * DEG };
}

/**
 * The moving things of a world a camera can follow, look at or orbit: [{ kind, p, yaw, aim (m
 * above p to look at) }]. Defensive: the world's lists are whatever the simulation keeps.
 */
export function subjectsOf(world) {
  const out = [];
  if (!world) return out;
  const put = (kind, p, yaw = 0, aim = 0) => {
    if (Array.isArray(p) && p.length >= 3 && p.every(Number.isFinite)) out.push({ kind, p: [p[0], p[1], p[2]], yaw: Number.isFinite(yaw) ? yaw : 0, aim });
  };
  for (const d of world.dragons ?? []) put('dragon', d.p, d.yaw, 1);
  for (const h of world.helis ?? []) {
    const a = h.ai ?? h;
    put('helicopter', a.p, a.yaw, 1.5);
  }
  for (const e of world.enemies ?? []) if (!e.dead && e.health !== 0) put('soldier', e.p, e.yaw, 1.3);
  for (const f of world.floats ?? []) {
    const pose = f.body?.pose;
    put('boat', pose?.p ?? f.at, pose?.yaw ?? f.yaw, 0.8);
  }
  // the world's cars (sim/cars.js: driven by you or an AI), then any other vehicle listed
  for (const c of world.cars ?? []) put('car', [c.x, c.y, c.z], c.yaw, 0.8);
  for (const v of world.vehicles ?? []) if (v.type !== 'jet') put('car', v.pos ?? v.p ?? v.base, v.yaw ?? v.heading, 0.8);
  for (const fl of world.flights ?? []) put('jet', fl.jets?.[0]?.p ?? fl.p, fl.jets?.[0]?.yaw ?? fl.yaw, 0);
  for (const ph of world.phoenixes ?? []) put('phoenix', ph.p, ph.yaw, 0.3);
  return out;
}

/** The subject a camera asks for: its kind and which one (1: the first). */
export function pickSubject(subjects, kind, n = 1) {
  if (!kind || kind === 'none') return null;
  const of = subjects.filter((s) => s.kind === kind);
  if (!of.length) return null;
  return of[(Math.max(1, Math.round(n)) - 1) % of.length];
}

/**
 * A camera at time t: { pos, target, roll (degrees), focal, focus, fstop, fx (keyed effect
 * values), smooth (true: follow / track, to be eased in with a lag) }.
 *  cam: { params, keys, base (basePose) }; subject: { p, yaw, aim } or null.
 */
export function evalCamera(cam, t, subject = null) {
  const P = cam.params ?? {};
  const B = cam.base ?? { origin: [0, 1.6, 0], yaw: 0, pitch: 0, roll: 0 };
  const fwd = forwardOf(B.yaw, B.pitch);
  const right = rightOf(B.yaw);
  const o = B.origin;
  const aimPoint = subject ? add(subject.p, [0, subject.aim ?? 0, 0]) : null;
  const dur = Math.max(0.1, P.duration ?? 6);
  const u = ease(P.moveEase ?? 'easeInOut', t / dur);
  const travel = P.travel ?? 5;
  const ahead = (p) => add(p, scale(fwd, 10));
  let pos = o, target = ahead(o), smooth = false;
  let keyed = {};
  switch (P.move) {
    case 'keys': {
      keyed = sampleKeys(cam.keys ?? [], t, { spline: P.path !== 'linear' });
      if (keyed.pos) pos = add(o, keyed.pos);
      target = keyed.target ? add(o, keyed.target) : ahead(pos);
      break;
    }
    case 'dolly':
      pos = add(o, scale(fwd, travel * u));
      target = ahead(pos);
      break;
    case 'truck':
      pos = add(o, scale(right, travel * u));
      target = ahead(pos);
      break;
    case 'crane':
      pos = add(o, [0, travel * u, 0]);
      target = ahead(o);
      break;
    case 'orbit': {
      // round the subject, or round the point it looks at (radius m along its aim): starting where it stands
      const R = Math.max(0.5, P.radius ?? 8);
      const center = aimPoint ?? add(o, scale(fwd, R));
      const r = aimPoint ? R : Math.max(0.5, Math.hypot(o[0] - center[0], o[2] - center[2]));
      const a0 = aimPoint ? B.yaw + Math.PI : Math.atan2(o[0] - center[0], o[2] - center[2]);
      const a = a0 + (P.speed ?? 20) * DEG * t;
      const h = aimPoint ? P.height ?? 2 : o[1] - center[1];
      pos = [center[0] + Math.sin(a) * r, center[1] + h, center[2] + Math.cos(a) * r];
      target = center;
      break;
    }
    case 'follow':
    case 'track': {
      if (!subject) break;
      const sf = [Math.sin(subject.yaw), 0, Math.cos(subject.yaw)];
      const sr = rightOf(subject.yaw);
      const r = P.radius ?? 8;
      const off = P.move === 'follow' ? scale(sf, -r) : scale(sr, r);
      pos = add(add(subject.p, off), [0, P.height ?? 2, 0]);
      target = aimPoint;
      smooth = true;
      break;
    }
    default:
      break;
  }
  if (P.look === 'subject' && aimPoint) target = aimPoint;
  if (len(sub(target, pos)) < 1e-4) target = ahead(pos);
  const focal = keyed.focal ?? P.focal ?? 50;
  const fstop = keyed.fstop ?? P.fstop ?? 2.8;
  let focus = keyed.focus ?? P.focus ?? 5;
  if (P.focusMode === 'target') focus = len(sub(target, pos));
  else if (P.focusMode === 'subject' && aimPoint) focus = len(sub(aimPoint, pos));
  const roll = (keyed.roll ?? P.roll ?? 0) + B.roll / DEG;
  return { pos, target, roll, focal, focus: Math.max(0.1, focus), fstop, fx: keyed.fx ?? {}, smooth };
}

/** How long a camera's move runs by itself (s): its keys, or its duration; 0: as long as you like. */
export function moveDuration(cam) {
  const P = cam.params ?? {};
  if (P.move === 'keys') return keysDuration(cam.keys);
  if (['dolly', 'truck', 'crane'].includes(P.move)) return P.duration ?? 6;
  return 0;
}

/** A point eased towards another with a lag (s): exponential, frame-rate independent. */
export function smoothTowards(prev, next, dt, lag) {
  if (!prev || !(lag > 0)) return next.slice();
  const k = 1 - Math.exp(-dt / lag);
  return prev.map((v, i) => v + (next[i] - v) * k);
}
