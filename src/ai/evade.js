/**
 * Combat rolls: a man on foot getting out of the way. Pure logic, no three.js, in the style of
 * ai/parkour.js: each roll has a duration and a root path (where the figure's root is through
 * it), the operator rig (operator/rig.js) bakes its clip round the very same path, and whoever
 * plays it (the squad AI, the guard AI, the dragon's snatch, the player's walk, the rig stage)
 * carries the man along it.
 *
 *  - rollLeft / rollRight: down onto the front, a log roll sideways over the back (the rifle held
 *    to the chest), up into a crouch, aiming: out of a line of fire, from under a dragon's dive or
 *    its fire, away from a grenade or a rocket off to one side.
 *  - rollForward: a shoulder roll forward (from a run, or after a jump), up into a crouch.
 *  - diveProne: a dive forward onto the chest, down flat (prone, aiming): from standing into cover
 *    from fire, away from a blast.
 *  - sidestepLeft / sidestepRight: a quick crouched side step (two shuffles, the weapon kept up):
 *    what a man does instead of a roll when his weapon rules rolling out (ai/weapons.js: the
 *    flame gun's tanks, a machine gun: that one dives flat into cover instead, if it can).
 *
 * Root paths are [side, forward, up] (m) from where the roll starts, in the frame of the way he
 * faced when it started (side: + to his left). A man's facing (yaw) in the AIs: forward is
 * (sin yaw, cos yaw) on (x, z), so his left is (cos yaw, −sin yaw).
 *
 *  - dangers(w, m, o): what threatens m in a simulated world (a grenade on the ground near him,
 *    a rocket coming his way, rounds cracking past him, a dragon diving on him or breathing fire
 *    at him): [{ kind, p, ... }], most urgent first.
 *  - pickRoll(m, threat, host): which roll, facing which way, gets him out of it (the end of its
 *    path clear of the threat and of walls), or null.
 *  - startRoll(m, pick, now) and stepRoll(m, dt, floor): on the way, the man's m.trav (the same
 *    slot a parkour move uses: an AI moving him leaves him alone while it lasts).
 */
import { mono, clear } from './parkour.js';
import { handKind, evadeKind } from './weapons.js';

/** The rolls: their clip duration (s) and the distance the root goes (m). */
export const ROLLS = {
  rollLeft: { dur: 1.1, geo: { d: 1.9 }, side: 1 },
  rollRight: { dur: 1.1, geo: { d: 1.9 }, side: -1 },
  rollForward: { dur: 1.2, geo: { d: 2.4 } },
  diveProne: { dur: 1.25, geo: { d: 2.0 } },
  sidestepLeft: { dur: 0.8, geo: { d: 1.3 }, side: 1, step: true },
  sidestepRight: { dur: 0.8, geo: { d: 1.3 }, side: -1, step: true },
};
export const ROLL = Object.fromEntries(Object.keys(ROLLS).map((k) => [k, 1]));
/** How the rolls are shown (the rig's buttons). */
export const ROLL_LABELS = { rollLeft: 'Roll (left)', rollRight: 'Roll (right)', rollForward: 'Roll (forward)', diveProne: 'Dive roll to prone', sidestepLeft: 'Side step (left, crouched)', sidestepRight: 'Side step (right, crouched)' };

// fraction of the way at u: sideways quick off the mark (out of the line first), then the roll
const SIDE_K = [[0, 0], [0.16, 0.18], [0.31, 0.37], [0.47, 0.6], [0.64, 0.79], [0.78, 0.92], [1, 1]];
const FWD_K = [[0, 0], [0.167, 0.19], [0.317, 0.4], [0.458, 0.56], [0.6, 0.73], [0.75, 0.875], [1, 1]];
const DIVE_K = [[0, 0], [0.2, 0.3], [0.4, 0.65], [0.6, 0.9], [1, 1]];

/** The root's keys for a roll over geometry g: [u, side, forward, up]. */
export function rollKeys(kind, g = ROLLS[kind].geo) {
  const d = g.d ?? ROLLS[kind].geo.d;
  const s = ROLLS[kind].side;
  if (s) return SIDE_K.map(([u, f]) => [u, s * f * d, 0, 0]);
  return (kind === 'diveProne' ? DIVE_K : FWD_K).map(([u, f]) => [u, 0, f * d, 0]);
}
/** Where the root is at u (0..1) through the roll: [side (+ left), forward, up] (m). */
export function rollAt(kind, u, g) {
  const K = rollKeys(kind, g);
  return [1, 2, 3].map((c) => mono(K.map((k) => [k[0], k[c]]), u));
}
/** How much lower than standing the eyes are through it (for the player's camera; m). */
const EYE = {
  rollLeft: [[0, 0], [0.16, 0.45], [0.31, 1.3], [0.64, 1.3], [0.78, 0.9], [0.9, 0.5], [1, 0]],
  rollForward: [[0, 0], [0.17, 0.4], [0.32, 1.1], [0.6, 1.25], [0.75, 0.9], [0.9, 0.4], [1, 0]],
  diveProne: [[0, 0], [0.2, 0.15], [0.4, 0.75], [0.6, 0.95], [1, 0.95]],
};
EYE.rollRight = EYE.rollLeft;
EYE.sidestepLeft = EYE.sidestepRight = [[0, 0], [0.25, 0.45], [0.75, 0.5], [1, 0]];
export const rollEyeDip = (kind, u) => mono(EYE[kind], u);

/** World direction (x, z) of a roll for a man facing yaw: where its root goes. */
export function rollDir(kind, yaw) {
  const f = [Math.sin(yaw), Math.cos(yaw)], l = [Math.cos(yaw), -Math.sin(yaw)];
  const s = ROLLS[kind].side;
  return s ? [l[0] * s, l[1] * s] : f;
}
/** Where a roll started at p facing yaw has him at u: [x, y, z]. */
export function rollPoint(kind, u, from, yaw, g) {
  const [s, f, up] = rollAt(kind, u, g);
  const fw = [Math.sin(yaw), Math.cos(yaw)], l = [Math.cos(yaw), -Math.sin(yaw)];
  return [from[0] + fw[0] * f + l[0] * s, from[1] + up, from[2] + fw[1] * f + l[1] * s];
}

const len2 = (x, z) => Math.hypot(x, z);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * The way out of a threat, on the ground plan (unit [x, z]), and how good each direction is:
 *  grenade / rocket / blast: away from where it goes off;
 *  fire: across the line it comes along (the side he is on, else the side away from its source's
 *  aim, else his left);
 *  dragon (its dive): across its track, on the side he already is; breath: out of the jet sideways.
 */
export function escapeDir(m, t) {
  const p = m.p;
  if (t.kind === 'fire' || t.kind === 'breath' || t.kind === 'dragon') {
    const d = t.dir ?? t.v ?? [p[0] - t.p[0], 0, p[2] - t.p[2]];
    let dx = d[0], dz = d[2];
    const l = len2(dx, dz);
    if (l < 1e-6) return [Math.cos(m.yaw ?? 0), -Math.sin(m.yaw ?? 0)];
    dx /= l;
    dz /= l;
    // which side of the line he is on (from its source through... along its direction)
    const o = t.from ?? t.p;
    const side = (p[0] - o[0]) * dz - (p[2] - o[2]) * dx;
    const s = Math.abs(side) > 0.15 ? Math.sign(side) : t.prefer ?? 1;
    return [dz * s, -dx * s];
  }
  const dx = p[0] - t.p[0], dz = p[2] - t.p[2], l = len2(dx, dz);
  if (l < 0.05) return [Math.cos(m.yaw ?? 0), -Math.sin(m.yaw ?? 0)];
  return [dx / l, dz / l];
}

/**
 * The roll (and the facing to do it in) that takes m out of threat t: { kind, yaw, end } or null
 * (he cannot roll: down, crawling, badly hurt in the legs, no room). With a weapon that rules a
 * roll out (ai/weapons.js evadeKind) the kind is what stands in for it: a crouched side step, a
 * dive into cover. host: { solid(x, y, z),
 * floor(x, z, m) } to keep the roll off walls and edges (optional).
 */
export function pickRoll(m, t, host = {}) {
  if (m.dead || m.crawling || (m.wounds?.legL ?? 0) + (m.wounds?.legR ?? 0) > 1) return null;
  const e = escapeDir(m, t);
  const want = Math.atan2(e[0], e[1]); // the heading of the way out
  const yaw = m.yaw ?? 0;
  const a = wrap(want - yaw);
  const tries = [];
  // facing the way out (or nearly): forward; a fire fight from standing: down flat
  const fwdKind = t.kind === 'fire' && !m.path ? 'diveProne' : t.kind === 'grenade' || t.kind === 'rocket' ? 'diveProne' : 'rollForward';
  if (Math.abs(a) < 0.9) tries.push([fwdKind, want]);
  // to one side: the roll to that side, turned so it goes exactly the way out (a quarter turn at most)
  const sideKind = a > 0 ? 'rollLeft' : 'rollRight'; // (his left is heading yaw + π/2)
  // (left of facing yaw is heading yaw + π/2 in this frame: sin/cos of yaw + π/2 = cos, −sin)
  tries.push([sideKind, sideKind === 'rollLeft' ? want - Math.PI / 2 : want + Math.PI / 2]);
  tries.push([sideKind === 'rollLeft' ? 'rollRight' : 'rollLeft', sideKind === 'rollLeft' ? want + Math.PI / 2 : want - Math.PI / 2]);
  // across a line (fire, a dive): the other side too, if this one is blocked
  if (t.kind === 'fire' || t.kind === 'dragon' || t.kind === 'breath') {
    const back = Math.atan2(-e[0], -e[1]);
    tries.push(['rollLeft', back - Math.PI / 2], ['rollRight', back + Math.PI / 2]);
  }
  // the weapon in his hands may rule a roll out (ai/weapons.js): a side step, or a dive into cover, stands in
  const wk = handKind(m);
  for (const [want0, y0] of tries) {
    const kind = evadeKind(wk, want0);
    if (!kind) continue;
    const y = wrap(y0);
    // (it must go the way it is meant to: the root's direction against the way out)
    const dir = rollDir(kind, y);
    const ok = Math.abs(dir[0] - e[0]) + Math.abs(dir[1] - e[1]) < 0.2 || (t.kind === 'fire' || t.kind === 'dragon' || t.kind === 'breath');
    if (!ok) continue;
    if (!pathClear(m, kind, y, host)) continue;
    return { kind, yaw: y, end: rollPoint(kind, 1, m.p, y) };
  }
  return null;
}

/** Room along the roll: no wall in the way (knee to chest height), the floor about level. */
export function pathClear(m, kind, yaw, host = {}) {
  if (!host.solid) return true;
  for (const u of [0.25, 0.5, 0.75, 1]) {
    const q = rollPoint(kind, u, m.p, yaw);
    if (!clear(host.solid, q[0], q[2], m.p[1], 0.25, 0.85)) return false;
    const fy = host.floor?.(q[0], q[2], m);
    if (fy != null && Math.abs(fy - m.p[1]) > 0.5) return false;
  }
  return true;
}

/** Start roll `pick` ({ kind, yaw } from pickRoll) for m at time now. */
export function startRoll(m, pick, now = 0, o = {}) {
  const R = ROLLS[pick.kind];
  const dur = R.dur * (o.slow ?? 1);
  m.trav = { kind: pick.kind, t: 0, dur, geo: { ...R.geo }, from: m.p.slice(), yaw: pick.yaw, roll: true, ext: !!o.ext, why: o.why ?? null };
  m.yaw = pick.yaw;
  m.anim = pick.kind;
  m.animT = now;
  m.animDur = dur;
  m.animUntil = now + dur;
  m.moving = true;
  m.rollCd = now + dur + (o.cool ?? 2.5);
  m.rolls = (m.rolls ?? 0) + 1;
  return m.trav;
}

/**
 * One step along a roll: m.p carried along its root path (on the floor under it: floor(x, z, m),
 * if given). Returns true when it is over (m.trav is then null).
 */
export function stepRoll(m, dt, floor) {
  const T = m.trav;
  if (!T?.roll) return true;
  if (m.dead) {
    m.trav = null;
    return true;
  }
  T.t += dt;
  const u = Math.min(1, T.t / T.dur);
  const q = rollPoint(T.kind, u, T.from, T.yaw, T.geo);
  const px = m.p[0], pz = m.p[2];
  const fy = floor?.(q[0], q[2], m);
  m.p = [q[0], fy != null && Math.abs(fy - T.from[1]) < 0.6 ? fy : q[1], q[2]];
  m.yaw = T.yaw;
  m.moving = true;
  m.speed = Math.hypot(m.p[0] - px, m.p[2] - pz) / Math.max(dt, 1e-3);
  if (u < 1) return false;
  m.trav = null;
  m.animUntil = 0;
  m.lastRoll = { kind: T.kind, why: T.why };
  return true;
}

/* ---------- what threatens a man in a simulated world ---------- */
const GRENADE_R = 6; // within this a grenade on the ground is worth rolling from (m)
/**
 * What threatens m (feet at m.p) right now in world w: grenades fizzing nearby, rockets that
 * will pass close, rounds that just cracked past him (m.shotAt: sim/wounds.js shoot), a dragon
 * diving on him or breathing fire his way. Most urgent first.
 */
export function dangers(w, m) {
  const out = [];
  const c = [m.p[0], m.p[1] + 1, m.p[2]];
  for (const g of w.projectiles ?? []) {
    const type = g.type ?? 'grenade';
    if (type === 'grenade' && g.fuse > 0.15) {
      const d = Math.hypot(g.p[0] - m.p[0], g.p[2] - m.p[2]);
      if (d < GRENADE_R && Math.abs(g.p[1] - m.p[1]) < 2.5) out.push({ kind: 'grenade', p: g.p.slice(), d, urgency: 3 - d * 0.2 });
    } else if (type === 'rocket' && !g.resting) {
      // its closest approach within the next 1.5 s
      const v = g.v, vv = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
      if (vv < 1) continue;
      const r = [c[0] - g.p[0], c[1] - g.p[1], c[2] - g.p[2]];
      const tc = (r[0] * v[0] + r[1] * v[1] + r[2] * v[2]) / vv;
      if (tc < 0 || tc > 1.5) continue;
      const q = [g.p[0] + v[0] * tc, g.p[1] + v[1] * tc, g.p[2] + v[2] * tc];
      const miss = Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]);
      if (miss < 5) out.push({ kind: 'rocket', p: q, v: v.slice(), d: miss, urgency: 2.8 - tc });
    }
  }
  if (m.shotAt && (w.time ?? 0) - m.shotAt.time < 0.35) out.push({ kind: 'fire', p: m.shotAt.from.slice(), from: m.shotAt.from.slice(), dir: m.shotAt.dir.slice(), time: m.shotAt.time, urgency: 1 });
  for (const d of w.dragons ?? []) {
    if (!(d.health > 0) || !d.chest) continue;
    const dd = Math.hypot(d.chest[0] - c[0], d.chest[1] - c[1], d.chest[2] - c[2]);
    // breathing fire his way (the jet reaches ~10 m and more)
    if (d.breathT > 0 && d.headDir && d.mouth && dd < 16 * Math.sqrt(d.k ?? 1)) {
      const r = [c[0] - d.mouth[0], c[1] - d.mouth[1], c[2] - d.mouth[2]];
      const rl = Math.hypot(...r) || 1;
      const cs = (r[0] * d.headDir[0] + r[1] * d.headDir[1] + r[2] * d.headDir[2]) / rl;
      if (cs > 0.9) out.push({ kind: 'breath', p: d.mouth.slice(), from: d.mouth.slice(), dir: d.headDir.slice(), urgency: 2.5 });
    }
    // diving on him (not in a snatch: that one decides itself, ai/dragonAir.js)
    if (d.mode === 'air' && !(d.snatch?.T?.ref === m) && dd < 14 * (d.k ?? 1)) {
      const v = [Math.sin(d.yaw) * d.speed, d.vy ?? 0, Math.cos(d.yaw) * d.speed];
      const r = [c[0] - d.chest[0], c[1] - d.chest[1], c[2] - d.chest[2]];
      const closing = (r[0] * v[0] + r[1] * v[1] + r[2] * v[2]) / (dd || 1);
      if (closing > 6 && (d.vy ?? 0) < -1.5) out.push({ kind: 'dragon', p: d.chest.slice(), v, urgency: 2.2 });
    }
  }
  return out.sort((a, b) => b.urgency - a.urgency);
}

/**
 * Should m roll from threat t now? Grenades, rockets, a diving dragon and its fire: always (if he
 * can); rounds cracking past: now and then (rand() < chance, more for a man in the open).
 */
export function worthRolling(m, t, rand = Math.random, now = 0) {
  if (m.trav || (m.rollCd ?? -Infinity) > now || m.dead || m.crawling) return false;
  if (t.kind === 'fire') {
    // (once for each crack past him)
    if (m.fireSeen === t.time) return false;
    m.fireSeen = t.time;
    return rand() < (m.inCover ? 0.1 : 0.45);
  }
  return true;
}
