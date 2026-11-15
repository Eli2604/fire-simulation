/**
 * The rope drill of a fire team (pure logic, no three.js). ai/rope.js takes one man down one rope;
 * this is what the rest of the team does round it, and how a rope gets there at all.
 *
 *  - Overwatch on a descent (any rope the team goes down: a helicopter's fast ropes, a gantry, a
 *    rappel rope off a roof): the first man down does not just walk on; he goes a few metres off
 *    the rope's foot (WATCH.r), drops to one knee facing out (kneelAim: his sector away from the
 *    rope), weapon up, and scans; a hostile the team has identified (ai/perception.js, through
 *    the squad's senses: sq.seen) in his line of sight he engages in bursts (kneelShoot), covering
 *    the man on the rope. Each man down after him joins: the sectors are split again between them
 *    (off a wall: an arc away from it, WATCH.arc either side of straight out; in the open, under a
 *    helicopter: the full circle) and each shuffles to his place in the perimeter. The men still at
 *    the top wait their turn kneeling back from the edge (WAIT.back, one behind the other, either
 *    side), facing out over the drop and covering the ground below, and go as soon as the rope
 *    takes them (ai/rope.js startRope: one at a time over the edge). When the last man is down the
 *    perimeter holds a moment (WATCH.linger) and the squad has them again: on along the way each was
 *    going (m.ropeSaved), or the squad's next bound. (A helicopter's troops still aboard are its
 *    own, ai/helicopter.js: the men by the doors crouch in them covering; their stick on the
 *    ground covers the rest down in the same way.)
 *  - Rope as gear: a man carries rope coils (m.ropes, a number; the squad model's `ropes` param
 *    hands them out). A man whose way leads over a drop too deep to jump (host.rappel →
 *    lowerRope) uses a rope already there (his team's, or a placed one), queueing for it; or, with
 *    a coil, anchors his own (kneeling, tying it off round a solid point near the edge: anchorRope)
 *    and throws it down (throwRope; the rope is in world.ropes from the moment it leaves his hands),
 *    then goes down it; or, without one, calls the nearest man who has one over to lower it and
 *    waits for it. Nobody in the team has a rope: 'cannot' (ai/squad.js parkourAhead drops the
 *    way: the squad looks for another). host.autoRig: a man with no m.ropes at all counts as
 *    carrying as many as he needs (the old auto-rig).
 *  - Team rope-down (an assault descent): the leader, up on a roof or a cliff with the objective
 *    (the team's goal, the threat, what they investigate) below it and an edge towards it within
 *    TEAM.search m, decides they all go down together when at least TEAM.minCoils men carry a
 *    rope. He signals it (signalMove; on the radio too unless they keep radio silence: "rope up,
 *    on my mark"); each man with a rope goes to his own spot along the edge (TEAM.spacing apart),
 *    anchors and drops his rope and kneels there ready (a man without one waits behind the
 *    nearest rope). When they are set, one throws a flashbang down onto the landing area (the
 *    squad's throwFlash: sim/explosions.js flashbang blinds and deafens whoever is below with it
 *    in view); on the bang ("Go!") they all go over at once, a quick assault rappel (ai/rope.js
 *    RAPPEL_QUICK), land, take kneeling cover round the foot of the ropes (the overwatch above),
 *    and then the squad carries on from down there.
 *
 * A man the drill has (m.ropeTask: { kind: 'watch' | 'wait' | 'rig' | 'stack' | 'hold', ... }) is
 * not the squad AI's to move (its host's ownMove, ai/squad.js); a man on a rope is ai/rope.js's.
 * The host (the squad AI's, ai/squad.js) gives, besides the usual: ropeSim (the { world, solid }
 * ai/rope.js works on: the simulation), and optionally autoRig and teamRope (false: no team
 * rope-down), path3d (a way between levels: the stairs; without it nobody looks for one).
 *
 *  - The drill's men walk as the squad routes them (wayFor): to the edge, to their place at a
 *    rope, off its foot to the perimeter, along the squad's grid (ai/squad.js route) round walls
 *    and gear on the roof, or the host's 3D path where the grid is not on their level; straight
 *    only where the way is clear.
 *  - Rope or stairs (chooseWayDown): before a rope is lowered (a man at a drop, the leader's team
 *    rope-down) a walkable way down near (host.path3d: stairs, a ramp, a slope; STAIRS.reach) is
 *    weighed against the rope's time (rigging, the queue, the descent): taken when not much dearer
 *    (it is the safer way and the coil is kept), only when much quicker under fire or for a team
 *    assault (the rope is the quicker, surprising way in), and always when nobody has a rope. The
 *    decision is written down (sq.ropeLog; sq.log 'rope:decide:<how>:<why>'; the squad's status).
 *
 * API:
 *   stepRopeTeam(sq, dt)     each squad step (ai/squad.js step, after the senses)
 *   lowerRope(sq, m, dir)    host.rappel: at a drop too deep to jump ahead of m along dir
 *   edgeAhead(S, p, n, reach) the edge ahead of p and the ground below it, or null
 *   wayFor(sq, m, to)        his way to `to` on his level ([points])
 *   chooseWayDown(sq, m, ed, { ropeT, team, goal })  rope or stairs at edge ed
 *   carriesCoil(m)           a coil to draw on him (render/enemies.js)
 */
import { startRope, groundBelow, outward, ropeEnds, RAPPEL, ROPE_T } from './rope.js';
import { kit, manage, aimPoint, canShoot, spend, weaponKind, recoilOf, skillOf, TIMES } from './soldier.js';
import { stepClimb } from './recoil.js';

/** Overwatch at the foot: how far out (off a wall, in the open), the arc either side of straight out, the hold after the last man, the paces, the look-out distance, the bursts. */
export const WATCH = { r: 4.5, rFast: 5, arc: 1.25, linger: 2.0, aimWalk: 1.0, run: 2.6, look: 12, burst: 0.7, pause: [1.2, 2.4] };
/** Waiting at the top: back from the edge, the next man behind, either side. */
export const WAIT = { back: 1.4, row: 0.9, side: 0.7 };
/** The team rope-down: spacing along the edge, how far back from it each kneels, how far to look for an edge, how often the leader looks, the longest wait for the ropes and for the bang, the go after it. */
export const TEAM = { spacing: 1.7, back: 0.75, search: 22, every: 2, minCoils: 2, rigMax: 18, bangMax: 3.5, go: 0.25, signal: 1.6 };
/**
 * Rope or stairs (chooseWayDown): the longest way down on foot looked at (reach m), how near the
 * drop his way's end must be to walk to it instead of to the foot of the wall (near), how long a
 * look is remembered (memo s), the deepest step a way down may have (drop m: more is a jump), the
 * pace on it (m/s), the rappel's pace down (slow, quick: ai/rope.js RAPPEL, RAPPEL_QUICK), what a
 * coil used up counts for (gear s), and the factor on the rope's time the stairs must beat: calm
 * (they are safer: more than the rope's time is still worth it), under fire, a team assault.
 */
export const STAIRS = { reach: 45, near: 15, memo: 8, drop: 1.3, pace: 2.6, slow: 0.95, quick: 2.8, gear: 4, calm: 1.25, fire: 0.45, team: 0.5 };

const hyp = Math.hypot;
const d2 = (a, b) => hyp(a[0] - b[0], a[2] - b[2]);
const simOf = (sq) => sq.host.ropeSim ?? null;
const solidOf = (S) => S?.solid ?? (S?.ai?.solidAt ? (x, y, z) => S.ai.solidAt(x, y, z) : null);
/** A rope coil to draw on him (render/enemies.js → operator/rig.js setCoil): coils left (m.ropes), not the one in his hands being thrown down, not dead. */
export function carriesCoil(e) {
  if (e.dead || !(Number.isFinite(e.ropes) && e.ropes > 0)) return false;
  return !(e.ropeTask?.kind === 'rig' && e.ropeTask.phase === 'throw');
}
/** How many rope coils he has (host.autoRig: a man with none listed rigs as many as he needs). */
export const coils = (sq, m) => m.ropes ?? (sq.host.autoRig ? Infinity : 0);
const rnd = (sq) => (sq.host.rand ?? Math.random)();

/**
 * The edge ahead of p (feet) along n ([dx, dz], unit) within reach m: where the floor he stands on
 * ends, and the ground below it (deep enough to need a rope, not too deep for one):
 * { E: [x, y, z] (on the edge), n, g (the ground's height) } or null.
 */
export function edgeAhead(S, p, n, reach = 1.5) {
  const solid = solidOf(S);
  if (!solid) return null;
  let e = -1;
  for (let s = 0; s <= reach; s += 0.05)
    if (!solid(p[0] + n[0] * s, p[1] - 0.05, p[2] + n[1] * s)) {
      e = s;
      break;
    }
  if (e < 0) return null;
  const E = [p[0] + n[0] * e, p[1], p[2] + n[1] * e];
  const g = groundBelow(S, E[0] + n[0] * RAPPEL.wall, E[1] - 0.3, E[2] + n[1] * RAPPEL.wall, -Infinity);
  const depth = E[1] - g;
  if (!(depth >= RAPPEL.minDepth && depth <= RAPPEL.maxDepth)) return null;
  return { E, n: n.slice(), g };
}

/** Something solid to tie off to near the edge (a parapet, a post, a rail), else the edge itself (a sling round the roof's edge). */
function anchorFor(S, E, n) {
  const solid = solidOf(S);
  const t = [-n[1], n[0]];
  for (let back = 0.3; back <= 1.8; back += 0.3)
    for (const side of [0, 0.5, -0.5, 1, -1])
      for (let h = 0.25; h <= 1.0; h += 0.25) {
        const q = [E[0] - n[0] * back + t[0] * side, E[1] + h, E[2] - n[1] * back + t[1] * side];
        if (solid(q[0], q[1], q[2])) return { p: q, kind: 'structure' };
      }
  return { p: [E[0] - n[0] * 0.15, E[1], E[2] - n[1] * 0.15], kind: 'edge' };
}

let ropeIds = 0;
/** His rope, anchored and thrown down over the edge: in world.ropes from now on (it stays). */
function makeRope(sq, m, ed, quick) {
  const S = simOf(sq), w = S.world;
  const { E, n, g } = ed;
  const rope = { id: `rope-${sq.unit}-${++ropeIds}`, kind: 'rappel', top: E.slice(), bottom: [E[0] + n[0] * 0.08, g, E[2] + n[1] * 0.08], out: n.slice(), owner: m, rigged: true, lowered: true, anchor: anchorFor(S, E, n), quick: !!quick };
  (w.ropes ??= []).push(rope);
  if (Number.isFinite(m.ropes)) m.ropes = Math.max(0, m.ropes - 1);
  w.events?.push({ type: 'ropeDown', pos: E.slice(), time: w.time, name: `${sq.name(m)} lowers a rope` });
  // "Rope!": called as it goes over, for anyone below
  sq.host.shout?.(m, 'Rope!');
  // whoever waits for this one has it now
  for (const o of sq.members())
    if (o.ropeTask?.kind === 'wait' && o.ropeTask.rigger === m && !o.ropeTask.rope) {
      o.ropeTask.rope = rope;
      o.ropeTask.site = siteOf(sq, rope);
    }
  return rope;
}

/* ---------- where a descent comes down: its sites ---------- */
/** The place the team comes down (the ropes whose feet are close together), made on first sight of a rope. */
function siteOf(sq, rope) {
  sq.ropeSites ??= [];
  let s = sq.ropeSites.find((x) => x.ropes.has(rope));
  if (s) return s;
  const S = simOf(sq);
  const [a, b] = ropeEnds(rope);
  let foot, out = null;
  if (rope.kind === 'rappel') {
    out = outward(S, rope);
    foot = [a[0] + out[0] * RAPPEL.wall, b[1], a[2] + out[1] * RAPPEL.wall];
  } else foot = [b[0], groundBelow(S, b[0], Math.max(a[1] - 1, b[1]), b[2], b[1]), b[2]];
  s = sq.ropeSites.find((x) => d2(x.foot, foot) < 8 && Math.abs(x.foot[1] - foot[1]) < 3);
  if (!s) sq.ropeSites.push((s = { ropes: new Set(), feet: [], foot, out, down: [], doneAt: null }));
  s.ropes.add(rope);
  s.feet.push(foot);
  s.foot = [0, 1, 2].map((k) => s.feet.reduce((acc, f) => acc + f[k], 0) / s.feet.length);
  if (out) s.out ??= out;
  return s;
}
/** Someone of the team still to come down here: on its ropes, waiting at the top, still aboard the helicopter whose ropes they are. */
function busy(sq, site, ms) {
  const w = simOf(sq).world;
  return ms.some((m) => !m.dead && ((m.rope && site.ropes.has(m.rope.rope)) || (m.ropeTask && m.ropeTask.site === site && m.ropeTask.kind !== 'watch') || (m.aboard != null && [...site.ropes].some((r) => r.attached && w.ropes?.includes(r)))));
}

/** The watchers' places round the foot: their sectors split between them (off a wall an arc away from it; in the open the full circle). */
function spread(sq, site) {
  const W = site.down.filter((o) => !o.dead && o.ropeTask?.kind === 'watch' && o.ropeTask.site === site);
  const N = W.length;
  if (!N) return;
  const open = !site.out;
  if (open && site.base == null) {
    const f = W[0], dx = f.p[0] - site.foot[0], dz = f.p[2] - site.foot[2];
    site.base = hyp(dx, dz) > 0.5 ? Math.atan2(dx, dz) : f.yaw ?? 0;
  }
  const base = open ? site.base : Math.atan2(site.out[0], site.out[1]);
  W.forEach((o, i) => {
    const a = open ? base + (2 * Math.PI * i) / N : N === 1 ? base : base - WATCH.arc + (2 * WATCH.arc * i) / (N - 1);
    const dir = [Math.sin(a), Math.cos(a)];
    // a spot he can kneel at (level with the foot, not up on something or down a hole): else nearer in
    let spot = null;
    for (let r = open ? WATCH.rFast : WATCH.r; r >= 1.5 && !spot; r -= 1) {
      const x = site.foot[0] + dir[0] * r, z = site.foot[2] + dir[1] * r;
      const y = sq.host.floor(x, z, o);
      if (y != null && Math.abs(y - site.foot[1]) < 0.6) spot = [x, y, z];
    }
    o.ropeTask.spot = spot ?? o.p.slice();
    o.ropeTask.face = a;
  });
}

/* ---------- moving and fighting while the drill has him ---------- */
/** A step towards `to` on his own feet (running if far: `left`, the way still to go), over the floor the host gives; 'blocked' at a wall or a drop. */
function walkTo(sq, m, to, dt, run, left) {
  const dx = to[0] - m.p[0], dz = to[2] - m.p[2], d = hyp(dx, dz);
  if (d < 0.05) return true;
  let dy = Math.atan2(dx, dz) - (m.yaw ?? 0);
  dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  m.yaw = (m.yaw ?? 0) + Math.max(-6 * dt, Math.min(6 * dt, dy));
  const fast = run && (left ?? d) > 1.5;
  const sp = Math.min(fast ? WATCH.run : WATCH.aimWalk, d / Math.max(dt, 1e-3));
  const nx = m.p[0] + (dx / d) * sp * dt, nz = m.p[2] + (dz / d) * sp * dt;
  const fy = sq.host.floor(nx, nz, m);
  if (fy != null && (fy - m.p[1] > 0.6 || m.p[1] - fy > 0.8)) {
    m.moving = false;
    m.speed = 0;
    return 'blocked';
  }
  m.p = [nx, fy ?? m.p[1], nz];
  m.moving = true;
  m.speed = sp;
  sq.setAnim(m, fast ? 'run' : 'aimWalk');
  return false;
}
/* ---------- the way there: the squad's routing, not a straight line ---------- */
/** Straight from p to `to` on his level: no wall at body height, no step up or drop on the way (the floor the host gives). */
function straightClear(sq, m, p, to) {
  const H = sq.host, L = d2(p, to);
  let y = p[1];
  for (let s = 0.2; s < L + 0.1; s += 0.2) {
    const u = Math.min(1, s / Math.max(L, 1e-6)), x = p[0] + (to[0] - p[0]) * u, z = p[2] + (to[2] - p[2]) * u;
    const fy = H.floor(x, z, m) ?? y;
    if (fy - y > 0.6 || y - fy > 0.8) return false;
    y = fy;
    if (H.solid) for (const hy of [0.5, 1.0, 1.45]) if (H.solid(x, y + hy, z)) return false;
  }
  return true;
}
/** Only the turns of a dense path (a point every 0.4 m: host.path3d's): where it changes direction or slope. */
function turns(pts) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
    const u = [b[0] - a[0], b[2] - a[2]], v = [c[0] - b[0], c[2] - b[2]];
    const lu = hyp(u[0], u[1]) || 1, lv = hyp(v[0], v[1]) || 1;
    const bent = Math.abs(u[0] * v[1] - u[1] * v[0]) / (lu * lv) > 0.05;
    const sloped = Math.abs((c[1] - b[1]) / lv - (b[1] - a[1]) / lu) > 0.15;
    if (bent || sloped) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
/** The length of a way (m, from `from` along its points; up and down counted). */
export function wayLength(pts, from) {
  let L = 0, a = from ?? pts[0];
  for (const q of pts) {
    L += hyp(q[0] - a[0], (q[1] ?? a[1]) - (a[1] ?? 0), q[2] - a[2]);
    a = q;
  }
  return L;
}
/**
 * His way to `to` on his own level (to the edge, to his place at a rope, off the rope's foot to
 * the perimeter): as the squad routes its men (ai/squad.js route: its grid, round walls, keeping
 * along them), or the host's 3D path (host.path3d: the guard AI's, on any floor) where the squad's
 * grid is not on his level (it is built on the team's level: half of them up on the roof, half
 * down, it may be on neither); straight at it when the way is clear or neither gets there.
 * [points], the last one `to`.
 */
export function wayFor(sq, m, to) {
  const p = m.p;
  if (straightClear(sq, m, p, to)) return [to.slice()];
  const fits = (pts) => {
    if (!pts?.length) return false;
    const e = pts[pts.length - 1], s = pts[0];
    if (d2(e, to) > 1.0 || Math.abs((e[1] ?? to[1]) - to[1]) > 0.7) return false;
    if (Math.abs((s[1] ?? p[1]) - p[1]) > 0.7 || d2(s, p) > 1.5) return false;
    for (let i = 1; i < pts.length; i++) if (Math.abs((pts[i][1] ?? 0) - (pts[i - 1][1] ?? 0)) > 0.9) return false;
    return !pts.some((q) => q.move); // (a parkour move on it: the drill's men walk)
  };
  const done = (pts) => {
    const out = pts.filter((q, i) => i === pts.length - 1 || d2(q, p) > 0.35).map((q) => [q[0], q[1] ?? p[1], q[2]]);
    if (d2(out[out.length - 1], to) > 0.05) out.push(to.slice());
    return out;
  };
  if (sq.route) {
    try {
      const r = sq.route(p, to, m, { links: false });
      if (r.length > 1 && fits(r)) return done(r);
    } catch {
      /* (no grid to route on: the next way) */
    }
  }
  // (the 3D path is costly where there is no way: only near, and a failed look not again soon)
  if (!sq.host.path3d || d2(p, to) > 15) return [to.slice()];
  const key = [p, to].map((q) => q.map((v) => Math.round(v * 2)).join(',')).join('>');
  const memo = (sq.wayMemo ??= new Map());
  if (memo.has(key) && sq.time - memo.get(key) < STAIRS.memo) return [to.slice()];
  const via = sq.host.path3d(p, to);
  if (via?.length > 1 && fits(via)) return done(turns(via));
  if (memo.size > 64) memo.clear();
  memo.set(key, sq.time);
  return [to.slice()];
}

/** Towards his spot along his way (wayFor; worked out again when the spot moves); true once there (a spot he cannot get to: where he is). */
function toSpot(sq, m, T, dt, run = true) {
  if (d2(m.p, T.spot) <= 0.3) {
    m.moving = false;
    m.speed = 0;
    return true;
  }
  if (!T.way || !T.wayTo || d2(T.wayTo, T.spot) > 0.25 || Math.abs(T.wayTo[1] - T.spot[1]) > 0.5) {
    T.wayTo = T.spot.slice();
    T.way = wayFor(sq, m, T.spot);
    T.wayI = 0;
    T.wayLen = wayLength(T.way, m.p);
  }
  while (T.wayI < T.way.length - 1 && d2(m.p, T.way[T.wayI]) < 0.3) T.wayI++;
  const last = T.wayI === T.way.length - 1;
  const tgt = last ? T.spot : T.way[T.wayI];
  const left = last ? d2(m.p, T.spot) : wayLength(T.way.slice(T.wayI), m.p);
  if (walkTo(sq, m, tgt, dt, run, left) === 'blocked') {
    T.spot = m.p.slice();
    T.way = null;
  }
  return false;
}
/** The nearest hostile the team has identified (sq.seen: ai/perception.js through the squad's senses) that he can see from where he kneels. */
function targetFor(sq, m) {
  const H = sq.host;
  let best = null, bd = Infinity;
  const R = sq.sight?.() ?? 60;
  for (const h of sq.seen ?? []) {
    if (h.dead) continue;
    const d = hyp(h.p[0] - m.p[0], h.p[1] - m.p[1], h.p[2] - m.p[2]);
    if (d > R || d >= bd) continue;
    if (H.lineOfSight && !H.lineOfSight(m.p, h.p)) continue;
    bd = d;
    best = h;
  }
  return best;
}
/** On one knee, the weapon up at `look` (a point out in his sector, or a target), bursts at a target (the squad's fire: host.fire). */
function kneelCover(sq, m, T, look, dt, canFire = true) {
  const tgt = canFire ? targetFor(sq, m) : null;
  const at = tgt ? tgt.p : look;
  T.aim = at;
  m.aimAt = at;
  sq.face(m, at, dt, 4);
  m.moving = false;
  m.speed = 0;
  const R = recoilOf(m);
  stepClimb(m, R, dt, false, skillOf(m).control);
  T.fireT = (T.fireT ?? 0.3) - dt;
  if (m.anim === 'kneelShoot') {
    T.shotT = (T.shotT ?? 0) - dt;
    if (tgt && T.shotT <= 0 && T.rounds > 0 && canShoot(m)) {
      T.rounds--;
      T.shotT = R.gap;
      spend(m);
      sq.host.fire?.(m, aimPoint(m, tgt.p), weaponKind(m));
      stepClimb(m, R, 0, true);
      T.shots = (T.shots ?? 0) + 1;
    }
    if (T.fireT <= 0 || !tgt) {
      sq.setAnim(m, 'kneelAim');
      T.fireT = WATCH.pause[0] + rnd(sq) * (WATCH.pause[1] - WATCH.pause[0]);
    }
    return;
  }
  sq.setAnim(m, 'kneelAim');
  if (tgt && T.fireT <= 0 && canShoot(m)) {
    sq.setAnim(m, 'kneelShoot');
    T.fireT = WATCH.burst;
    T.rounds = R.rounds;
    T.shotT = 0;
  }
}
/** Off the drill: the squad has him again (on his way, if he still has one, or the one he had). */
function letGo(sq, m) {
  m.ropeTask = null;
  m.aimAt = sq.threat;
  m.moving = false;
  const S = m.ropeSaved;
  m.ropeSaved = null;
  if (!m.path && S?.path?.length && Math.abs(S.path[S.path.length - 1][1] - m.p[1]) < 1.5) Object.assign(m, { path: S.path, pathI: Math.min(S.pathI ?? 0, S.path.length - 1), then: S.then, moveMode: S.mode, arrived: false });
  if (!m.path) sq.setAnim(m, 'crouchAim');
}
const save = (m) => (m.ropeSaved ??= m.path ? { path: m.path, pathI: m.pathI, then: m.then, mode: m.moveMode } : null);

/* ---------- the tasks ---------- */
function stepTask(sq, m, dt, ms) {
  const T = m.ropeTask;
  const S = simOf(sq);
  if (m.dead) return (m.ropeTask = null);
  kit(m);
  sq.release(m, null); // (a flashbang leaving his hand: ai/squad.js)
  T.t = (T.t ?? 0) + dt;
  // blinded by a flashbang (one of theirs gone wrong, the enemy's): nothing for a few seconds
  if (m.stunnedUntil && m.stunnedUntil > (sq.host.now?.() ?? sq.time)) return sq.setAnim(m, 'crouch');
  if (T.kind === 'rig') return rig(sq, m, T, dt, ms);
  if (sq.busy(m)) return; // (a one-shot: the flashbang thrown, a reload, a signal)
  if (T.kind !== 'hold' && manage(sq, m, dt, sq.host.hostiles?.() ?? [])) return; // (reloading)
  if (T.kind === 'watch') {
    if (!T.spot) spread(sq, T.site);
    if (!toSpot(sq, m, T, dt)) return;
    const look = [T.spot[0] + Math.sin(T.face) * WATCH.look, T.spot[1] + 0.3, T.spot[2] + Math.cos(T.face) * WATCH.look];
    return kneelCover(sq, m, T, look, dt);
  }
  if (T.kind === 'hold') {
    // the leader's signal: down on a knee where he is, facing the edge
    const RT = sq.ropeTeam;
    if (RT) kneelCover(sq, m, T, [RT.ed.E[0] + RT.n[0] * 6, RT.ed.g, RT.ed.E[2] + RT.n[1] * 6], dt, false);
    return;
  }
  if (T.kind === 'stack') {
    // at his rope, on a knee back from the edge, covering the ground below; down it on the go
    const n = T.rope.out;
    if (!toSpot(sq, m, T, dt, false)) return;
    return kneelCover(sq, m, T, [T.rope.top[0] + n[0] * 5, T.rope.bottom[1], T.rope.top[2] + n[1] * 5], dt);
  }
  // 'wait': his turn on a rope (or for one being lowered)
  if (!T.rope) {
    const rg = T.rigger;
    if (!rg || rg.dead || rg.ropeTask?.kind !== 'rig') {
      // the man with the rope is gone: another rope near, else not this way
      return letGo(sq, m);
    }
    T.spot ??= [rg.ropeTask.ed.E[0] - rg.ropeTask.ed.n[0] * (WAIT.back + 0.6), m.p[1], rg.ropeTask.ed.E[2] - rg.ropeTask.ed.n[1] * (WAIT.back + 0.6)];
    if (!toSpot(sq, m, T, dt, false)) return;
    const ed = rg.ropeTask.ed;
    return kneelCover(sq, m, T, [ed.E[0] + ed.n[0] * 5, ed.g, ed.E[2] + ed.n[1] * 5], dt);
  }
  const r = T.rope, n = r.out ?? outward(S, r);
  T.site ??= siteOf(sq, r);
  const q = ms.filter((o) => !o.dead && o.ropeTask?.kind === 'wait' && o.ropeTask.rope === r).sort((a, b) => a.ropeTask.t0 - b.ropeTask.t0);
  const i = Math.max(0, q.indexOf(m));
  const tn = [-n[1], n[0]], side = i % 2 ? -1 : 1, back = WAIT.back + WAIT.row * Math.floor(i / 2);
  T.spot = [r.top[0] - n[0] * back + tn[0] * side * WAIT.side * (i ? 1 : 0.4), r.top[1], r.top[2] - n[1] * back + tn[1] * side * WAIT.side * (i ? 1 : 0.4)];
  if (!toSpot(sq, m, T, dt, false)) return;
  // a team going down together: not before the go (the flashbang first)
  const RT = sq.ropeTeam;
  const held = T.team && RT && RT.phase !== 'go' && RT.phase !== 'down';
  if (i === 0 && !held && startRope(S, m, r)) {
    m.ropeTask = null;
    m.ropeWas = r;
    return;
  }
  kneelCover(sq, m, T, [r.top[0] + n[0] * 5, r.bottom[1], r.top[2] + n[1] * 5], dt);
}

/** Lowering a rope: to the edge, kneel and tie it off (anchorRope), up and throw it down (throwRope); then down it, or stack up by it (a team rope-down). */
function rig(sq, m, T, dt, ms) {
  const S = simOf(sq);
  m.moving = false;
  m.speed = 0;
  if (T.phase === 'walk') {
    // (as long as the way there takes at a walk, and some)
    if (!toSpot(sq, m, T, dt, false) && T.t < Math.max(12, (T.wayLen ?? 0) / WATCH.aimWalk + 4)) return;
    T.phase = 'anchor';
    T.t = 0;
  }
  if (T.phase === 'anchor') {
    m.yaw = Math.atan2(T.ed.n[0], T.ed.n[1]);
    m.aimAt = null;
    if (m.anim !== 'anchorRope') sq.setAnim(m, 'anchorRope', ROPE_T.anchor);
    if (T.t >= ROPE_T.anchor) {
      T.phase = 'throw';
      T.t = 0;
      sq.setAnim(m, 'throwRope', ROPE_T.throw);
    }
    return;
  }
  // 'throw'
  if (!T.rope && T.t >= ROPE_T.release) T.rope = makeRope(sq, m, T.ed, T.quick);
  if (T.t < ROPE_T.throw) return;
  const site = siteOf(sq, T.rope);
  if (T.then === 'stack') {
    m.ropeTask = { kind: 'stack', rope: T.rope, site, team: true, spot: [T.ed.E[0] - T.ed.n[0] * TEAM.back, m.p[1], T.ed.E[2] - T.ed.n[1] * TEAM.back], t: 0 };
    return;
  }
  if (startRope(S, m, T.rope)) {
    m.ropeTask = null;
    m.ropeWas = T.rope;
  } else m.ropeTask = { kind: 'wait', rope: T.rope, site, t0: sq.time, t: 0 };
  void ms;
}

/* ---------- rope or stairs: the way down ---------- */
/** Under fire (taking hits in the team, rounds or a grenade coming at him, a hostile in sight): why, or null. */
export function underFire(sq, m) {
  const now = sq.host.now?.() ?? sq.time;
  if (sq.members().some((o) => !o.dead && o.lastHitT != null && now - o.lastHitT < 6)) return 'taking hits';
  if (m && sq.host.dangers?.(m)?.length) return 'rounds coming in';
  if (sq.threat && (sq.seen ?? []).some((h) => !h.dead)) return 'enemy in sight';
  return null;
}
/** Where a way down ends: his way's end when it is down there and near the drop (else the ground at the foot of the wall, a step out). */
function landing(ed, goal) {
  const foot = [ed.E[0] + ed.n[0] * (RAPPEL.wall + 1), ed.g, ed.E[2] + ed.n[1] * (RAPPEL.wall + 1)];
  return goal && Math.abs(goal[1] - ed.g) < 1 && d2(goal, foot) < STAIRS.near ? goal.slice() : foot;
}
/**
 * A walkable way down (stairs, a ramp, a slope: the host's 3D path, host.path3d) from `from` to
 * `to` below: { path (its turns), len (m) } or null (none, or longer than STAIRS.reach, or it
 * drops somewhere a man would have to jump). Looked up once a while for the same edge (sq.stairMemo).
 */
export function wayDown(sq, from, to) {
  const H = sq.host;
  if (!H.path3d || hyp(to[0] - from[0], to[2] - from[2]) > STAIRS.reach) return null;
  const key = [from, to].map((q) => q.map((v) => Math.round(v)).join(',')).join('>');
  const memo = (sq.stairMemo ??= new Map());
  const hit = memo.get(key);
  if (hit && sq.time - hit.t < STAIRS.memo) return hit.W;
  let W = null;
  const via = H.path3d(from, to);
  if (via?.length > 1) {
    const e = via[via.length - 1];
    let ok = d2(e, to) < 1.5 && Math.abs((e[1] ?? to[1]) - to[1]) < 0.8 && d2(via[0], from) < 1 && Math.abs((via[0][1] ?? from[1]) - from[1]) < 0.6;
    for (let i = 1; ok && i < via.length; i++) if ((via[i - 1][1] ?? 0) - (via[i][1] ?? 0) > STAIRS.drop) ok = false;
    const len = ok ? wayLength(via, from) : Infinity;
    if (ok && len <= STAIRS.reach) {
      const path = turns(via).map((q) => [q[0], q[1], q[2]]);
      if (d2(path[path.length - 1], to) > 0.05) path.push(to.slice());
      W = { path, len };
    }
  }
  if (memo.size > 32) memo.clear();
  memo.set(key, { t: sq.time, W });
  return W;
}
/** The time down a rope (s): to the edge and the rope ready (setup), over the edge, down the wall at the rappel's pace. */
export function ropeTime(depth, setup = 0, quick = false) {
  return setup + (quick ? 1.0 : 1.8) + depth / (quick ? STAIRS.quick : STAIRS.slow);
}
/**
 * Rope or stairs: a walkable way down near enough (wayDown) is taken when its time on foot is no
 * more than the rope's time ×k: k = STAIRS.calm normally (the stairs are the safer way: nobody
 * hangs on a wall, the coil is kept), STAIRS.fire under fire, STAIRS.team for a team assault
 * (the flashbang and all of them down at once: the rope is the assault, the stairs only when
 * much quicker); ropeT Infinity: no rope to be had (the stairs whatever they take). Written down
 * (noteWay). { how: 'stairs' | 'rope', W, why, stairsT, ropeT }.
 */
export function chooseWayDown(sq, m, ed, { ropeT, team = false, goal = null } = {}) {
  const to = landing(ed, goal);
  const W = wayDown(sq, m.p, to);
  const fire = underFire(sq, m);
  const k = Math.min(team ? STAIRS.team : STAIRS.calm, fire ? STAIRS.fire : Infinity);
  const stairsT = W ? W.len / STAIRS.pace : Infinity;
  let how = 'rope', why;
  if (!W) why = !Number.isFinite(ropeT) ? 'no rope in the team, no way down on foot' : sq.host.path3d ? 'no way down on foot near' : 'no stairs known';
  else if (!Number.isFinite(ropeT)) (how = 'stairs'), (why = 'no rope in the team');
  else if (stairsT <= ropeT * k) (how = 'stairs'), (why = `${team ? 'team: ' : ''}the stairs ${stairsT.toFixed(0)} s against the rope ${ropeT.toFixed(0)} s${fire ? ` (${fire})` : ''}`);
  else why = `${fire ? `${fire}: ` : team ? 'team assault: ' : ''}the rope ${ropeT.toFixed(0)} s against the stairs ${stairsT.toFixed(0)} s`;
  const D = { how, W, why, stairsT, ropeT, fire, team, to };
  noteWay(sq, m, D);
  return D;
}
/** Write the decision down (as the other decisions are: sq.ropeLog always, the host's sq.log if it keeps one; the squad's status). */
function noteWay(sq, m, D) {
  const last = sq.ropeLog?.[sq.ropeLog.length - 1];
  if (last && last.who === m?.squad && last.how === D.how && last.team === D.team && sq.time - last.t < 3) return; // (the same look again: once)
  (sq.ropeLog ??= []).push({ t: sq.time, who: m?.squad, how: D.how, why: D.why, stairsT: D.stairsT, ropeT: D.ropeT, team: D.team });
  if (sq.ropeLog.length > 40) sq.ropeLog.shift();
  sq.log?.push(`rope:decide:${D.how}:${D.why}`);
  sq.status = D.how === 'stairs' ? `Way down: by the stairs (${D.why}).` : `Way down: by rope (${D.why}).`;
}
/** Down by the stairs: along the way down (m.then on arrival when it ends where he was going). */
function takeStairs(sq, m, W, goalReached, mode) {
  const then = goalReached ? m.then : null;
  sq.follow(m, W.path.map((q) => q.slice()), mode, (q) => {
    q.arrived = true;
    sq.navAge = Infinity; // (a new level: the grid on it)
    then?.(q);
  });
}

/**
 * host.rappel: m at a drop too deep to jump, ahead along dir. A rope there (within a few metres
 * along the edge): to it, and down when it is his turn; one being lowered: wait for it; his own
 * coil: lower it; a man near with one: he lowers it, m waits. True: the drill has him (or the
 * rope); 'cannot': nobody has a rope, not this way; false: no such drop here.
 */
export function lowerRope(sq, m, dir) {
  const S = simOf(sq);
  if (!S?.world || !m || m.dead || m.rope || m.ropeTask) return false;
  const l = hyp(dir[0], dir[1]) || 1;
  const n = [dir[0] / l, dir[1] / l];
  const ed = edgeAhead(S, m.p, n, 1.5);
  if (!ed) return false;
  const ms = sq.members();
  // a rope there already
  const r = (S.world.ropes ?? []).filter((x) => x.kind === 'rappel' && Math.abs(x.top[1] - ed.E[1]) < 0.6 && d2(x.top, ed.E) < 6).sort((a, b) => d2(a.top, ed.E) - d2(b.top, ed.E))[0];
  // one of us lowering one near here; the nearest man with one (on this level)
  const rg = !r && ms.find((o) => !o.dead && o.ropeTask?.kind === 'rig' && d2(o.ropeTask.ed.E, ed.E) < 6);
  const c = !r && !rg && !(coils(sq, m) > 0) && ms
    .filter((o) => o !== m && !o.dead && coils(sq, o) > 0 && !o.rope && !o.ropeTask && !o.guardCtl && !o.down && !o.rescueRole && Math.abs(o.p[1] - m.p[1]) < 1 && d2(o.p, m.p) < 14)
    .sort((a, b) => d2(a.p, m.p) - d2(b.p, m.p))[0];
  // rope or stairs: the rope's time in each case against a walkable way down near (chooseWayDown)
  const depth = ed.E[1] - ed.g, rig = ROPE_T.anchor + ROPE_T.throw;
  const queue = r ? ms.filter((o) => (o.ropeTask?.kind === 'wait' && o.ropeTask.rope === r) || o.rope?.rope === r).length : 0;
  const ropeT = r ? ropeTime(depth, d2(r.top, ed.E) / WATCH.aimWalk + queue * ropeTime(depth)) : rg ? ropeTime(depth, rig) : coils(sq, m) > 0 ? ropeTime(depth, rig + STAIRS.gear) : c ? ropeTime(depth, d2(c.p, m.p) / WATCH.aimWalk + rig + STAIRS.gear) : Infinity;
  const goal = m.path?.length ? m.path[m.path.length - 1] : null;
  const D = chooseWayDown(sq, m, ed, { ropeT, goal });
  if (D.how === 'stairs') {
    takeStairs(sq, m, D.W, !!goal && d2(D.to, goal) < 0.01 && Math.abs(D.to[1] - goal[1]) < 0.01, D.fire ? 'run' : m.moveMode ?? 'run');
    m.signal = { text: 'STAIRS', until: sq.time + 1.5 };
    return true;
  }
  if (r) {
    const queued = ms.some((o) => o.ropeTask?.kind === 'wait' && o.ropeTask.rope === r);
    save(m);
    if (!queued && d2(r.top, ed.E) < 1.5 && startRope(S, m, r)) {
      m.ropeWas = r;
      siteOf(sq, r);
      return true;
    }
    m.ropeTask = { kind: 'wait', rope: r, site: siteOf(sq, r), t0: sq.time, t: 0 };
    return true;
  }
  // one of us lowering one near here: wait for it
  if (rg) {
    save(m);
    m.ropeTask = { kind: 'wait', rigger: rg, t0: sq.time, t: 0 };
    return true;
  }
  // his own coil: anchor it here and throw it down
  if (coils(sq, m) > 0) {
    save(m);
    m.ropeTask = { kind: 'rig', ed, spot: m.p.slice(), phase: 'anchor', then: 'down', t: 0 };
    return true;
  }
  // the nearest man with one (on this level) comes and lowers it beside him
  if (c) {
    const t = [-n[1], n[0]];
    const ed2 = edgeAhead(S, [ed.E[0] - n[0] * 1.2 + t[0] * 1.3, m.p[1], ed.E[2] - n[1] * 1.2 + t[1] * 1.3], n, 2.5) ?? ed;
    save(c);
    c.ropeTask = { kind: 'rig', ed: ed2, spot: [ed2.E[0] - n[0] * TEAM.back, c.p[1], ed2.E[2] - n[1] * TEAM.back], phase: 'walk', then: 'down', t: 0 };
    save(m);
    m.ropeTask = { kind: 'wait', rigger: c, t0: sq.time, t: 0 };
    m.signal = { text: 'ROPE UP HERE', until: sq.time + 2 };
    sq.host.shout?.(m, `${sq.name(c)}, rope up here!`);
    return true;
  }
  // nobody has a rope: not this way
  m.noRopeAt = ed.E;
  return 'cannot';
}

/* ---------- the team rope-down ---------- */
/** The leader's look: objective below, an edge towards it, ropes enough; then the signal. */
function considerTeam(sq, ms, dt) {
  if (!sq.on || sq.ropeTeam || sq.host.teamRope === false) return;
  sq.rtCheck = (sq.rtCheck ?? 0.5) - dt;
  if (sq.rtCheck > 0) return;
  sq.rtCheck = TEAM.every;
  if (sq.breach || sq.clearing || sq.retreating || sq.pursuit || sq.split) return;
  const O = sq.goal ?? sq.threat ?? sq.inv?.p;
  if (!O) return;
  const al = ms.filter((m) => !m.dead);
  if (al.length < 2 || al.some((m) => m.rope || m.guardCtl || m.aboard != null || m.down || m.rescueRole || m.crawling || m.ropeTask || m.trav || m.teamRope === false)) return;
  const ys = al.map((m) => m.p[1]).sort((a, b) => a - b), y0 = ys[ys.length >> 1];
  if (al.some((m) => Math.abs(m.p[1] - y0) > 1) || !(O[1] < y0 - RAPPEL.minDepth)) return;
  if (sq.ropeDoneY != null && Math.abs(sq.ropeDoneY - y0) < 1) return;
  const ropers = al.filter((m) => coils(sq, m) > 0);
  if (ropers.length < Math.min(TEAM.minCoils, al.length)) return;
  const S = simOf(sq), solid = solidOf(S);
  if (!solid) return;
  // the edge: from the team towards the objective, where the roof (the cliff top) ends
  const c = [al.reduce((a, m) => a + m.p[0], 0) / al.length, y0, al.reduce((a, m) => a + m.p[2], 0) / al.length];
  const dl = d2(O, c);
  if (dl < 0.5) return;
  const dir = [(O[0] - c[0]) / dl, (O[2] - c[2]) / dl];
  let ed = null, on = false;
  for (let s = 0; s <= Math.min(TEAM.search, dl); s += 0.25) {
    const q = [c[0] + dir[0] * s, y0, c[2] + dir[1] * s];
    const here = solid(q[0], y0 - 0.05, q[2]);
    if (here) on = true;
    else if (on) {
      ed = edgeAhead(S, [q[0] - dir[0] * 0.5, y0, q[2] - dir[1] * 0.5], dir, 1);
      break;
    }
  }
  if (!ed) return;
  // its true line (the roof's edge, not the way to the objective): out is away from the solid
  const n = outward(S, { top: ed.E, bottom: ed.E });
  const t = [-n[1], n[0]];
  // a spot each along it, TEAM.spacing apart, centred on where they reached it
  const k = Math.min(ropers.length, 6), spots = [];
  for (let j = 0; spots.length < k && j < 4 * k; j++) {
    const o = (j % 2 ? -1 : 1) * Math.ceil(j / 2) * TEAM.spacing + (k % 2 ? 0 : TEAM.spacing / 2);
    const e = edgeAhead(S, [ed.E[0] - n[0] * 1.5 + t[0] * o, y0, ed.E[2] - n[1] * 1.5 + t[1] * o], n, 3);
    if (e && Math.abs(e.E[1] - y0) < 0.3 && e.E[1] - e.g >= RAPPEL.minDepth) spots.push(e);
  }
  if (spots.length < Math.min(TEAM.minCoils, al.length)) return;
  const cmd = al.find((m) => m.squad === 'CMD') ?? al[0];
  // rope or stairs: a walkable way down near, quicker by enough (a team assault favours the rope:
  // the flashbang and all of them down at once) takes them down on foot instead
  const walkIn = Math.max(...ropers.slice(0, spots.length).map((m) => d2(m.p, spots[0].E))) / WATCH.aimWalk;
  const ropeT = ropeTime(ed.E[1] - ed.g, TEAM.signal + walkIn + ROPE_T.anchor + ROPE_T.throw + TEAM.bangMax + TEAM.go, true);
  const D = chooseWayDown(sq, cmd, ed, { ropeT, team: true, goal: O[1] < y0 - RAPPEL.minDepth ? O : null });
  if (D.how === 'stairs') {
    sq.ropeDoneY = y0; // (not again from up here)
    const mode = 'run';
    for (const m of al) takeStairs(sq, m, m === cmd ? D.W : wayDown(sq, m.p, D.to) ?? { path: [cmd.p.slice(), ...D.W.path] }, false, mode);
    sq.setAnim(cmd, 'signalMove');
    cmd.signal = { text: 'STAIRS · ON ME', until: sq.time + 2.5 };
    const text = `${sq.unit}, down the stairs, on me`;
    if (sq.time >= (sq.silentUntil ?? 0)) sq.host.radio?.(cmd, text, 'order');
    S.world.events?.push({ type: 'ropeTeam', pos: cmd.p.slice(), time: S.world.time, name: text });
    return;
  }
  // go: the leader's signal; everyone down on a knee where he is, facing the edge
  sq.ropeTeam = { phase: 'signal', t: 0, ed, n, y0, cmd, men: al, spots, ropers: ropers.slice(0, spots.length) };
  for (const m of al) {
    m.path = null;
    m.then = null;
    m.ropeSaved = null;
    m.ropeTask = { kind: 'hold', team: true, t: 0 };
  }
  sq.setAnim(cmd, 'signalMove');
  cmd.signal = { text: 'ROPE UP · ON MY MARK', until: sq.time + 2.5 };
  const text = `${sq.unit}, rope up, on my mark`;
  if (sq.time >= (sq.silentUntil ?? 0)) sq.host.radio?.(cmd, text, 'order');
  S.world.events?.push({ type: 'ropeTeam', pos: cmd.p.slice(), time: S.world.time, name: text });
  sq.status = 'Objective below: the leader signals a team rope-down.';
}

/** The rope-down, phase by phase: the signal, to the edge (ropes down), the flashbang, the go, the descent. */
function stepTeam(sq, ms, dt) {
  const RT = sq.ropeTeam;
  if (!RT) return;
  RT.t += dt;
  const S = simOf(sq), w = S.world;
  const al = RT.men.filter((m) => !m.dead);
  if (!al.length || RT.t > 120) return endTeam(sq, al);
  if (RT.phase === 'signal') {
    if (RT.t < TEAM.signal) return;
    RT.phase = 'edge';
    RT.t = 0;
    // each man with a rope to his spot on the edge; the others behind the nearest rope
    const ropers = RT.ropers.filter((m) => !m.dead);
    const free = RT.spots.slice();
    for (const m of ropers) {
      free.sort((a, b) => d2(a.E, m.p) - d2(b.E, m.p));
      const ed = free.shift();
      if (!ed) break;
      m.ropeTask = { kind: 'rig', ed, spot: [ed.E[0] - RT.n[0] * TEAM.back, RT.y0, ed.E[2] - RT.n[1] * TEAM.back], phase: 'walk', then: 'stack', quick: true, team: true, t: 0 };
    }
    for (const m of al)
      if (m.ropeTask?.kind === 'hold') {
        const rg = al.filter((o) => o.ropeTask?.kind === 'rig').sort((a, b) => d2(a.p, m.p) - d2(b.p, m.p))[0];
        if (rg) m.ropeTask = { kind: 'wait', rigger: rg, team: true, t0: sq.time + d2(rg.p, m.p) * 0.01, t: 0 };
        else m.ropeTask = null;
      }
    sq.status = 'Rope-down: each man with a rope to his spot on the edge, anchoring it and throwing it down.';
    return;
  }
  const stack = al.filter((m) => m.ropeTask?.kind === 'stack');
  if (RT.phase === 'edge') {
    const rigging = al.some((m) => m.ropeTask?.kind === 'rig');
    if (rigging && RT.t < TEAM.rigMax) return;
    if (!stack.length) return endTeam(sq, al);
    // set: one throws a flashbang down onto the landing area
    const mid = [stack.reduce((a, m) => a + m.ropeTask.rope.top[0], 0) / stack.length, 0, stack.reduce((a, m) => a + m.ropeTask.rope.top[2], 0) / stack.length];
    const land = [mid[0] + RT.n[0] * 3.5, RT.ed.g, mid[2] + RT.n[1] * 3.5];
    RT.land = land;
    const th = stack.filter((m) => m.squad !== 'MG' && (m.flashbangs ?? 2) > 0).sort((a, b) => d2(a.p, mid) - d2(b.p, mid))[0];
    if (th) {
      th.flashbangs = (th.flashbangs ?? 2) - 1;
      sq.face(th, land, 1, 10);
      sq.setAnim(th, 'throwFlash');
      th.throwAt = sq.time + TIMES.flashRelease;
      th.throwTarget = land;
      th.throwKind = 'flash';
      th.signal = { text: 'FLASHBANG', until: sq.time + 1.8 };
      sq.host.shout?.(th, 'Flashbang out!');
      RT.thrower = th;
      RT.flashT = w.time ?? sq.time;
      RT.phase = 'flash';
      sq.status = 'Rope-down: set on the edge; a flashbang down onto the landing area.';
    } else RT.phase = 'go'; // (none left: on the leader's mark)
    RT.t = 0;
    RT.goAt = sq.time + (th ? Infinity : TEAM.go);
    return;
  }
  if (RT.phase === 'flash') {
    // the bang (sim/explosions.js puts it in the events), or long enough for it
    let bang = false;
    for (let i = (w.events?.length ?? 0) - 1; i >= 0; i--) {
      const e = w.events[i];
      if ((e.time ?? 0) < RT.flashT) break;
      if (e.type === 'flashbang') bang = true;
    }
    if (!bang && RT.t < TEAM.bangMax) return;
    RT.bangT = sq.time;
    RT.phase = 'go';
    RT.goAt = sq.time + TEAM.go;
    return;
  }
  if (RT.phase === 'go' && sq.time < RT.goAt) return;
  if (RT.phase === 'go' && !RT.called) {
    RT.called = true;
    RT.goT = w.time ?? sq.time;
    const cmd = RT.cmd.dead ? al[0] : RT.cmd;
    cmd.signal = { text: 'GO GO GO', until: sq.time + 1.5 };
    sq.host.shout?.(cmd, 'Go, go, go!');
    sq.status = 'Rope-down: on the bang, all over the edge at once.';
  }
  // over the edge, all at once (a man whose rope went down late: as soon as it is there)
  for (const m of stack) {
    const r = m.ropeTask.rope;
    if (startRope(S, m, r)) {
      m.ropeTask = null;
      m.ropeWas = r;
      m.ropeSaved = null;
    }
  }
  if (RT.phase === 'go' && !al.some((m) => m.ropeTask?.kind === 'stack')) RT.phase = 'down';
  // 'down': until every man is off the ropes and the perimeter at the bottom has let go
  if (RT.phase !== 'down' || al.some((m) => m.rope || m.ropeWas || m.ropeTask)) return;
  endTeam(sq, al);
}
function endTeam(sq, al) {
  const RT = sq.ropeTeam;
  sq.ropeTeam = null;
  sq.ropeDoneY = RT?.y0;
  for (const m of al) if (m.ropeTask && m.ropeTask.kind !== 'watch') letGo(sq, m);
  // a new level: the grid again, the next bound from down here
  sq.assigned = false;
  sq.navAge = Infinity;
}

/* ---------- each squad step ---------- */
export function stepRopeTeam(sq, dt) {
  const S = simOf(sq);
  if (!S?.world) return;
  const ms = sq.members();
  considerTeam(sq, ms, dt);
  stepTeam(sq, ms, dt);
  // who went down a rope, who is down now
  for (const m of ms) {
    if (m.rope?.rope) {
      if (m.rope.rope.kind !== 'zipline') {
        m.ropeWas = m.rope.rope;
        siteOf(sq, m.ropeWas);
      }
      continue;
    }
    if (!m.ropeWas || m.guardCtl) continue; // (a helicopter's man: his squad's once it lets him go)
    const rope = m.ropeWas;
    m.ropeWas = null;
    if (m.dead) continue;
    const site = siteOf(sq, rope);
    site.down.push(m);
    // more to come down (or a perimeter to join): on a knee in it, covering them
    if (busy(sq, site, ms) || site.down.some((o) => o !== m && !o.dead && o.ropeTask?.kind === 'watch' && o.ropeTask.site === site)) {
      m.ropeTask = { kind: 'watch', site, t: 0, fireT: 0.3 };
      site.doneAt = null;
      spread(sq, site);
    } else if (m.ropeSaved) letGo(sq, m);
  }
  for (const m of ms) if (m.ropeTask) stepTask(sq, m, dt, ms);
  // everyone down: a moment in the perimeter, then on
  for (const site of sq.ropeSites ?? []) {
    const W = ms.filter((m) => !m.dead && m.ropeTask?.kind === 'watch' && m.ropeTask.site === site);
    if (!W.length) continue;
    if (busy(sq, site, ms)) {
      site.doneAt = null;
      continue;
    }
    site.doneAt ??= sq.time + WATCH.linger;
    if (sq.time >= site.doneAt) for (const m of W) letGo(sq, m);
  }
  if (sq.ropeSites?.length > 8) sq.ropeSites = sq.ropeSites.filter((s) => ms.some((m) => m.ropeTask?.site === s || (m.rope && s.ropes.has(m.rope.rope))));
}
