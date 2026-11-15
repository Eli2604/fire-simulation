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
 *   path     along a drawn path (cinema/path.js: a spline at a speed or timed per point, looping
 *            or back and forth, banking; attached to a moving thing or not), looking along it
 * and what it looks at (params.look): along its own aim ('forward'), at its aim point ('point'), or
 * at a subject ('subject': what it follows, or a target of its own: cinema/aim.js resolveTargets).
 * The subject: one of the world's moving things (subjectsOf): the dragon, a helicopter, a soldier
 * of a squad, a boat, a car, a jet, the phoenix.
 */
import { sampleKeys, keysDuration, ease } from './keyframes.js';
import { evalPath, pathDuration } from './path.js';

export const MOVES = ['static', 'keys', 'path', 'dolly', 'truck', 'crane', 'orbit', 'follow', 'track'];
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

/** A soldier's role in his squad (models/squad.js). */
const ROLES = { CMD: 'commander', MG: 'gunner', R1: 'rifleman', R2: 'rifleman', UAV: 'drone operator' };
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

/**
 * The moving things of a world a camera can follow, look at or orbit: [{ kind, id, label, p,
 * yaw, aim (m above p to look at) }]. Each has an id that stays the same while the world runs
 * and from one build of the scene to the next (numbered by kind: the soldiers by their squad,
 * the dragons by their scales, the cars by what they are; the dead counted too):
 *   'dragon:koi:1' Dragon (koi) · 'helicopter:1' Helicopter 1 · 'soldier:Alpha:3' Alpha squad –
 *   man 3 (rifleman) · 'soldier:2' Soldier 2 · 'boat:1' Boat 1 · 'car:jeep:1' Jeep 1 ·
 *   'jet:1' Jet 1 · 'phoenix:1' Phoenix 1.
 * Defensive: the world's lists are whatever the simulation keeps.
 */
export function subjectsOf(world) {
  const out = [];
  if (!world) return out;
  const counts = new Map();
  const next = (key) => {
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    return n;
  };
  const put = (kind, id, label, p, yaw = 0, aim = 0) => {
    if (Array.isArray(p) && p.length >= 3 && p.every(Number.isFinite)) out.push({ kind, id, label, p: [p[0], p[1], p[2]], yaw: Number.isFinite(yaw) ? yaw : 0, aim });
  };
  for (const d of world.dragons ?? []) {
    const c = d.colours ?? 'bronze';
    const n = next(`dragon:${c}`);
    put('dragon', `dragon:${c}:${n}`, `Dragon (${c})${n > 1 ? ` ${n}` : ''}`, d.p, d.yaw, 1);
  }
  for (const h of world.helis ?? []) {
    const a = h.ai ?? h;
    const n = next('helicopter');
    put('helicopter', `helicopter:${n}`, `Helicopter ${n}`, a.p, a.yaw, 1.5);
  }
  for (const e of world.enemies ?? []) {
    // (numbered with the dead, so the living keep their numbers; the dead not followed)
    const unit = e.unit && e.squad ? e.unit : null;
    const n = next(unit ? `soldier:${unit}` : 'soldier');
    if (e.dead || e.health === 0) continue;
    const role = unit ? ROLES[e.squad] : null;
    put('soldier', unit ? `soldier:${unit}:${n}` : `soldier:${n}`, unit ? `${unit} squad – man ${n}${role ? ` (${role})` : ''}` : `Soldier ${n}`, e.p, e.yaw, 1.3);
  }
  for (const f of world.floats ?? []) {
    const pose = f.body?.pose;
    const n = next('boat');
    put('boat', `boat:${n}`, `Boat ${n}`, pose?.p ?? f.at, pose?.yaw ?? f.yaw, 0.8);
  }
  // the world's cars (sim/cars.js: driven by you or an AI), then any other vehicle listed
  const car = (what, p, yaw) => {
    const w = String(what ?? 'car').toLowerCase();
    const n = next(`car:${w}`);
    put('car', `car:${w}:${n}`, `${cap(w)} ${n}`, p, yaw, 0.8);
  };
  for (const c of world.cars ?? []) car(c.label, [c.x, c.y, c.z], c.yaw);
  for (const v of world.vehicles ?? []) if (v.type !== 'jet') car(v.label ?? 'vehicle', v.pos ?? v.p ?? v.base, v.yaw ?? v.heading);
  for (const fl of world.flights ?? []) {
    const n = next('jet');
    put('jet', `jet:${n}`, `Jet ${n}`, fl.jets?.[0]?.p ?? fl.p, fl.jets?.[0]?.yaw ?? fl.yaw, 0);
  }
  for (const ph of world.phoenixes ?? []) {
    const n = next('phoenix');
    put('phoenix', `phoenix:${n}`, `Phoenix ${n}`, ph.p, ph.yaw, 0.3);
  }
  return out;
}

/** A subject (or any target with an id) by its id; null when it is not (or no longer) there. */
export function findSubject(subjects, id) {
  if (!id) return null;
  return (subjects ?? []).find((s) => s.id === id) ?? null;
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
 *  cam: { params, keys, base (basePose), aimPoint, aimDist }; subject: what its position
 *  follows (follow, track, orbit): { p, yaw, aim } or null; look: the point it looks at when it
 *  looks at something of its own (params.look 'subject' or 'point': cinema/aim.js
 *  resolveTargets), else the subject's aim point.
 * Also returns lookPoint: what it looks at (null: along its own aim), for framing and focus.
 */
export function evalCamera(cam, t, subject = null, { look = null, carrier = null } = {}) {
  const P = cam.params ?? {};
  const B = cam.base ?? { origin: [0, 1.6, 0], yaw: 0, pitch: 0, roll: 0 };
  const fwd = forwardOf(B.yaw, B.pitch);
  const right = rightOf(B.yaw);
  const o = B.origin;
  const aimPoint = subject ? add(subject.p, [0, subject.aim ?? 0, 0]) : null;
  const dur = Math.max(0.1, P.duration ?? 6);
  const u = ease(P.moveEase ?? 'easeInOut', t / dur);
  const travel = P.travel ?? 5;
  const aimDist = cam.aimDist > 0.5 ? cam.aimDist : 10;
  const ahead = (p) => add(p, scale(fwd, aimDist));
  let pos = o, target = ahead(o), smooth = false;
  let keyed = {};
  switch (P.move) {
    case 'keys': {
      keyed = sampleKeys(cam.keys ?? [], t, { spline: P.path !== 'linear' });
      if (keyed.pos) pos = add(o, keyed.pos);
      target = keyed.target ? add(o, keyed.target) : ahead(pos);
      break;
    }
    case 'path': {
      // along its path (cinema/path.js; attached: carried by what it is on), looking along it
      if (!cam.path?.points?.length) break;
      const E = evalPath(cam.path, t, P, carrier);
      pos = E.pos;
      target = E.ahead;
      keyed = { roll: (P.roll ?? 0) + E.roll };
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
      const sf = [Math.sin(subject.yaw ?? 0), 0, Math.cos(subject.yaw ?? 0)];
      const sr = rightOf(subject.yaw);
      const r = P.radius ?? 8;
      // the follow offset: back (follow) or beside (track) by the radius, up by the height,
      // sideways (follow: to its right) or ahead (track) by side
      const side = P.side ?? 0;
      const off = P.move === 'follow' ? add(scale(sf, -r), scale(sr, side)) : add(scale(sr, r), scale(sf, side));
      pos = add(add(subject.p, off), [0, P.height ?? 2, 0]);
      target = aimPoint;
      smooth = true;
      break;
    }
    default:
      break;
  }
  // what it looks at, if not along its own aim: a point of its own, or a target (cinema/aim.js)
  let lookPoint = null;
  if (P.look === 'point') lookPoint = look ?? (Array.isArray(cam.aimPoint) ? cam.aimPoint.slice() : null);
  else if (P.look === 'subject') lookPoint = look ?? aimPoint;
  if (lookPoint) target = lookPoint;
  if (len(sub(target, pos)) < 1e-4) target = ahead(pos);
  const focal = keyed.focal ?? P.focal ?? 50;
  const fstop = keyed.fstop ?? P.fstop ?? 2.8;
  let focus = keyed.focus ?? P.focus ?? 5;
  const onWhat = lookPoint ?? aimPoint;
  if (P.focusMode === 'target') focus = len(sub(target, pos));
  else if (P.focusMode === 'subject' && onWhat) focus = len(sub(onWhat, pos));
  const roll = (keyed.roll ?? P.roll ?? 0) + B.roll / DEG;
  return { pos, target, lookPoint, roll, focal, focus: Math.max(0.1, focus), fstop, fx: keyed.fx ?? {}, smooth };
}

/** How long a camera's move runs by itself (s): its keys, or its duration; 0: as long as you like. */
export function moveDuration(cam) {
  const P = cam.params ?? {};
  if (P.move === 'keys') return keysDuration(cam.keys);
  if (P.move === 'path') return cam.path?.points?.length ? pathDuration(cam.path, P) + (P.pathDelay ?? 0) : 0;
  if (['dolly', 'truck', 'crane'].includes(P.move)) return P.duration ?? 6;
  return 0;
}

/** A point eased towards another with a lag (s): exponential, frame-rate independent. */
export function smoothTowards(prev, next, dt, lag) {
  if (!prev || !(lag > 0)) return next.slice();
  const k = 1 - Math.exp(-dt / lag);
  return prev.map((v, i) => v + (next[i] - v) * k);
}
