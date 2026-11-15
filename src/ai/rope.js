/**
 * Ropes and cables: soldiers going down a rope or along a cable (pure logic, no three.js).
 *
 * A rope is a plain object in world.ropes (the agreed interface: the helicopter's ropes are in
 * there too, and models/rope.js places them in a scene):
 *   { id, kind: 'fastrope' | 'zipline' | 'rappel', top: [x, y, z], bottom: [x, y, z], owner?, attached? }
 * Its top may move every step (a hovering helicopter writes it); everything here is worked out
 * from where it is now, so whoever is on it goes with it. A fast rope that is `attached` hangs
 * straight down from its top (its length as it was first seen), wherever the top goes; any other
 * rope runs straight from top to bottom. Optional: `out` ([dx, dz]: for a rappel rope, the way
 * out from the wall, into the drop; found from the voxels round the anchor when not given).
 *
 * A man on a rope has m.rope = { rope, s, phase, t, v, ... } (s: metres from the top along it;
 * phase: what he is doing on it) and is moved and posed here (m.p his feet, m.yaw, m.anim the
 * clip: operator/rig.js), not by his AI: the squad AI (ai/squad.js, through the host's ownMove)
 * and the guard AI (ai/enemies.js) leave him alone until he is off it.
 *
 *  - Rappel (down a wall): at the top edge he clips in and turns his back to the drop (hook),
 *    sits back into the rope over the edge (the rig's rappelStart clip: he ends leaning back,
 *    feet flat on the wall, the guide hand high on the rope and the brake hand low behind the
 *    hip), then bounds down: knees in, push off, swing out while the brake hand lets rope run,
 *    feet back on the wall (one 'rappel' clip per bound, RAPPEL.hop metres a bound at most, the
 *    whole depth split into equal bounds so the last one lands him); on the ground he stands up
 *    and unclips (rappelEnd), and the rifle comes back round off his back. Hit (a wound): the
 *    brake hand lets go and he slides down the rope out of control (most of g), landing hard.
 *    A team going over together (ai/ropeTeam.js: a rope with quick) does the assault rappel:
 *    RAPPEL_QUICK, a short sit-back and long fast bounds (the rappelQuick clip).
 *  - Fast rope (from a helicopter, a high point): he steps out and grips the rope with both
 *    hands and his feet (the rope clamped between his boots), slides down braking with them
 *    (towards FAST.vmax, less with a heavy load; braking harder near the ground to land at
 *    FAST.land), lands in a crouch and runs a few metres clear of the rope for the next man.
 *    Men on one rope keep FAST.spacing apart (the man above brakes; startRope refuses a man
 *    while the one below is still that close to the top), and nobody comes down onto a man who
 *    has not cleared the bottom. Hit: his hands open and he falls.
 *  - Zipline ("vaulting along a cable"): from the high end he hooks a pulley (or his gloved
 *    hands) over the cable and hangs below it; he runs down it with the slope (g sin θ less
 *    the pulley's rolling friction ZIP.mu g cos θ and the air's drag), his gloved hand on the
 *    cable keeping him under ZIP.vmax, braking near the low end to come in at ZIP.arrive; he
 *    lets go there and drops to the ground. Too flat for the pulley to run (sin θ under the
 *    friction, or the cable rising): hand over hand at ZIP.hand. Hit: he lets go and falls.
 *  - The weapon: slung for the whole thing (its carry slot, ai/weapons.js HANDLING: the rifle
 *    across the back, the pistol in its holster); m.rope.slung says where. The clips sling it
 *    (the rifle on the back: sling2) and the rig draws it again off the rope.
 *  - Falling (a hit, the rope ending above the ground): free fall onto what is below, landing
 *    through sim/impact.js (bodyLanding: the force, its sound, harm from a high fall).
 *
 * The player (walk/walk.js) rides the same way: a stand-in rider ({ p, yaw, player }) in
 * world.ropeRiders, stepped here with everyone else; he copies its p to the camera.
 *
 * API:
 *   startRope(sim, m, rope)   on it if he can (false: occupied too close below the top, dead,
 *                             crawling, both arms hit, already on one)
 *   stepRopes(sim, dt)        everyone on a rope (the simulation's step, after the squads)
 *   rappelFrom(sim, m, dir)   at a drop too deep to jump (ahead of m along dir): rig a rope at
 *                             the edge (or use one already there) and start down it (the
 *                             player; a squad goes through ai/ropeTeam.js lowerRope: it needs
 *                             a man who carries a rope)
 *   ropeEnds(rope)            [top, bottom] as it hangs now (render/ropes.js draws it so)
 *   ropePoint(rope, s)        the point s m down it from the top
 *   nearRope(sim, p, r)       a rope whose top (or, for a cable, whose high end) is within reach
 */
import { bodyLanding } from '../sim/impact.js';
import { HANDLING, handKind } from './weapons.js';

const G = 9.81;
/** Rappelling (the clips' geometry: operator/rig.js RAPPEL; wall: the root's distance out from the wall face, top: how far below the roof the root starts). */
export const RAPPEL = { wall: 0.56, top: 1.0, edgeIn: 0.29, hook: 0.8, over: 1.8, bound: 1.8, hop: 1.7, off: 1.4, minDepth: 2.2, maxDepth: 45, slip: 0.55 };
/**
 * The quick (assault) rappel of a team going over an edge together (ai/ropeTeam.js; a rope with
 * `quick`, or a man with m.ropeQuick): a short sit-back over the edge, then long fast bounds (the
 * brake hand nearly open in each swing out): about 2.8 m/s down instead of 1.
 */
export const RAPPEL_QUICK = { hook: 0.45, over: 1.0, bound: 1.15, hop: 3.2 };
const QUICK = { ...RAPPEL, ...RAPPEL_QUICK };
/**
 * Lowering a rope (ai/ropeTeam.js; the rig's anchorRope and throwRope clips): kneeling at the edge
 * tying it off round an anchor (anchor s), then up and the coil thrown out over the edge (throw s;
 * it leaves his hands `release` s into the throw).
 */
export const ROPE_T = { anchor: 2.2, throw: 1.3, release: 0.75 };
/** Fast-roping: target slide speed, landing speed, braking (m/s²), spacing on one rope, hands above the feet, the rope in front of the chest. */
export const FAST = { vmax: 4.5, land: 1.6, brake: 6.5, spacing: 3.2, grip: 1.54, front: 0.22, s0: 0.6, mount: 0.7, settle: 0.45, clear: 3.0, run: 2.6 };
/** Zipline: hands above the feet, pulley friction, drag (1/m), the glove's limit, braking at the end, the gap ahead, hand over hand. */
export const ZIP = { hang: 1.78, mu: 0.045, drag: 0.004, vmax: 9, brake: 4, arrive: 1.5, end: 0.9, s0: 0.5, hook: 0.6, settle: 0.4, hand: 0.7, spacing: 5 };
/** The clips each phase plays (operator/rig.js). */
export const ROPE_CLIPS = { fastRope: 1, zipline: 1, zipHand: 1, ropeFall: 1 };
export const KINDS = ['fastrope', 'zipline', 'rappel'];

const len0 = new WeakMap(); // an attached fast rope's length, as first seen
const sm = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** [top, bottom] as the rope hangs now: an attached fast rope straight down from its top. */
export function ropeEnds(r) {
  if (r.kind === 'fastrope' && r.attached) {
    if (!len0.has(r)) len0.set(r, Math.max(1, Math.hypot(r.bottom[0] - r.top[0], r.bottom[1] - r.top[1], r.bottom[2] - r.top[2])));
    return [r.top, [r.top[0], r.top[1] - len0.get(r), r.top[2]]];
  }
  return [r.top, r.bottom];
}
export function ropeLength(r) {
  const [a, b] = ropeEnds(r);
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}
/** The point s m down the rope from its top. */
export function ropePoint(r, s) {
  const [a, b] = ropeEnds(r);
  const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1;
  return lerp3(a, b, s / L);
}

/** Is there something solid (the sim's voxels, or a test's function)? null: no world to ask. */
function solidOf(sim) {
  if (sim.solid) return sim.solid;
  if (sim.ai?.solidAt) return (x, y, z) => sim.ai.solidAt(x, y, z);
  return null;
}
/**
 * The ground under (x, z) below height y: the top of the first solid going down (to 1.5 mm), or
 * `fallback` (the rope's bottom) when there is nothing to ask or nothing within 80 m.
 */
export function groundBelow(sim, x, y, z, fallback = 0) {
  const solid = solidOf(sim);
  if (!solid) return fallback;
  let a = y + 0.05;
  if (solid(x, a, z)) return a; // (in something already)
  for (let k = 0; k < 800 && a > -1; k++) {
    const b = a - 0.1;
    if (solid(x, b, z)) {
      let lo = b, hi = a; // solid at lo, air at hi
      for (let i = 0; i < 6; i++) {
        const mid = (lo + hi) / 2;
        if (solid(x, mid, z)) lo = mid;
        else hi = mid;
      }
      return hi;
    }
    a = b;
  }
  return fallback;
}

/** The way out from the wall at a rappel rope's anchor ([dx, dz], unit). */
export function outward(sim, r) {
  if (r.out) {
    const l = Math.hypot(r.out[0], r.out[1]) || 1;
    return [r.out[0] / l, r.out[1] / l];
  }
  const dx = r.bottom[0] - r.top[0], dz = r.bottom[2] - r.top[2], l = Math.hypot(dx, dz);
  if (l > 0.05) return [dx / l, dz / l];
  // the roof is solid under the anchor on the inside: out is away from it
  const solid = solidOf(sim);
  let sx = 0, sz = 0;
  if (solid)
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, c = Math.sin(a), d = Math.cos(a);
      if (solid(r.top[0] + c * 0.5, r.top[1] - 0.15, r.top[2] + d * 0.5)) (sx -= c), (sz -= d);
    }
  const n = Math.hypot(sx, sz);
  return n > 1e-6 ? [sx / n, sz / n] : [0, 1];
}

const woundsOf = (m) => Object.values(m.wounds ?? {}).reduce((a, b) => a + b, 0);
/** The ropes in the world and the men on them (the soldiers, and stand-ins: the player). */
const ridersOf = (w) => [...(w.enemies ?? []).filter((e) => e.rope), ...(w.ropeRiders ?? []).filter((e) => e.rope)];
const onRope = (w, r) => ridersOf(w).filter((o) => o.rope.rope === r);

/** How much his load slows a controlled descent (the gunner's MG and belt, the flame gun's tanks). */
function loadK(m) {
  const wk = handKind(m);
  const kg = (m.carry ?? (m.squad === 'MG' ? 30 : 22)) + (HANDLING[wk]?.mass ?? 3.4);
  return kg > 35 ? 0.8 : 1;
}

/**
 * Put m on the rope. False when he cannot: dead, crawling (both legs hit), both arms hit, already
 * on one, or the rope is taken too close to its top (the man below has not got far enough down).
 */
export function startRope(sim, m, rope) {
  if (!m || !rope || m.dead || m.rope || m.crawling || !KINDS.includes(rope.kind)) return false;
  if (m.wounds?.armL && m.wounds?.armR) return false;
  const w = sim.world;
  const L = ropeLength(rope);
  const others = onRope(w, rope);
  if (rope.kind === 'fastrope') {
    if (L < 1.5) return false;
    if (others.some((o) => o.rope.phase !== 'clear' && o.rope.s < FAST.s0 + FAST.spacing)) return false;
  } else if (rope.kind === 'zipline') {
    if (L < 2) return false;
    if (others.some((o) => o.rope.phase !== 'land' && o.rope.s < ZIP.s0 + ZIP.spacing)) return false;
  } else {
    // one at a time over the edge; the next once the one below is a couple of bounds down
    if (others.some((o) => o.rope.phase === 'hook' || o.rope.phase === 'over' || (o.rope.phase === 'down' && o.rope.s < RAPPEL.top + 2 * RAPPEL.hop))) return false;
    const n = outward(sim, rope);
    const x = rope.top[0] + n[0] * RAPPEL.wall, z = rope.top[2] + n[1] * RAPPEL.wall;
    const g = groundBelow(sim, x, rope.top[1] - 0.3, z, rope.bottom[1]);
    const depth = rope.top[1] - g;
    if (depth < RAPPEL.minDepth || depth > RAPPEL.maxDepth) return false;
  }
  const wk = handKind(m);
  m.rope = {
    rope,
    kind: rope.kind,
    s: 0,
    phase: rope.kind === 'fastrope' ? 'mount' : 'hook',
    t: 0,
    v: 0,
    from: m.p.slice(),
    yaw0: m.yaw ?? 0,
    wounds0: woundsOf(m),
    t0: w.time ?? 0,
    // the weapon slung for the way down: where it goes (ai/weapons.js HANDLING slot)
    slung: HANDLING[wk]?.slot ?? 'slung across the back',
    // a team's assault rappel: quicker over the edge, longer bounds (RAPPEL_QUICK)
    quick: rope.kind === 'rappel' && !!(rope.quick || m.ropeQuick),
  };
  m.trav = null;
  m.moving = true;
  m.speed = 0;
  m.peek = null;
  w.events?.push({ type: 'rope', pos: m.p.slice(), time: w.time, name: `${rope.kind === 'rappel' ? 'rappelling' : rope.kind === 'fastrope' ? 'fast-roping' : 'on the cable'}` });
  return true;
}

/** An animation on m (one-shots restart: a new animT). */
function anim(sim, m, a) {
  if (m.anim === a) return;
  m.anim = a;
  m.animT = sim.world.time ?? 0;
  m.animDur = 0;
  m.animUntil = 0;
}

/** Off the rope, on his feet; his AI has him again. */
function finish(sim, m, a = 'idle') {
  m.rope = null;
  m.moving = false;
  m.speed = 0;
  m.arrived = true;
  m.animUntil = 0;
  anim(sim, m, m.dead ? 'die' : a);
}

/** Let go (a hit, or the end of a rope that stops short of the ground): falling, with the speed he had. */
function letGo(sim, m, R, vel, why) {
  R.phase = 'fall';
  R.t = 0;
  R.vel = vel;
  R.why = why;
  // a rappeller hit keeps the guide hand on the rope: a fast slide down it, not a free fall
  R.gk = R.kind === 'rappel' && why === 'hit' ? RAPPEL.slip : 1;
  if (why === 'hit') sim.world.events?.push({ type: 'ropeFall', pos: m.p.slice(), time: sim.world.time, name: 'fell from the rope' });
  anim(sim, m, m.dead ? 'die' : 'ropeFall');
}

function stepFall(sim, m, R, dt) {
  R.t += dt;
  R.vel[1] -= G * R.gk * dt;
  if (R.gk < 1) R.vel[0] = R.vel[2] = 0; // (down the rope, against the wall)
  const p = [m.p[0] + R.vel[0] * dt, m.p[1] + R.vel[1] * dt, m.p[2] + R.vel[2] * dt];
  const g = groundBelow(sim, p[0], m.p[1] + 0.1, p[2], R.rope.bottom[1]);
  if (p[1] <= g) {
    m.p = [p[0], g, p[2]];
    const speed = Math.max(0, -R.vel[1]);
    const height = (speed * speed) / (2 * G);
    // (the landing: its force and sound; a fall from a height hurts: sim/impact.js)
    if (sim.world.voxelAt) bodyLanding(sim, m, { speed, damage: R.why === 'hit' || height > 2.5, name: R.why === 'hit' ? 'a fall from the rope' : 'a drop off the rope' });
    m.lastFall = { height, speed, time: sim.world.time };
    finish(sim, m, R.why === 'hit' ? 'hit' : 'crouch');
    return;
  }
  m.p = p;
  m.moving = true;
  m.speed = Math.hypot(...R.vel);
}

/** Everyone on a rope, one step. */
export function stepRopes(sim, dt) {
  const w = sim.world;
  if (!w) return;
  w.ropes ??= [];
  for (const m of ridersOf(w)) {
    const R = m.rope;
    // gone from the world (a helicopter's rope cut, flown off with it): he falls from where he is
    if (R.phase !== 'fall' && R.phase !== 'clear' && R.phase !== 'land' && !w.ropes.includes(R.rope)) letGo(sim, m, R, [0, 0, 0], 'gone');
    // hit (a wound, not a round the plate stopped), killed, or the player's stand-in hit: he lets go
    if (R.phase !== 'fall' && R.phase !== 'clear' && R.phase !== 'land' && R.phase !== 'off' && R.phase !== 'hook') {
      if (m.dead || woundsOf(m) > R.wounds0 || m.ropeHit) {
        m.ropeHit = false;
        letGo(sim, m, R, R.kind === 'zipline' ? [...dirOf(R.rope).map((c) => c * R.v)] : [0, -R.v, 0], 'hit');
      }
    }
    if (R.phase === 'fall') stepFall(sim, m, R, dt);
    else if (R.kind === 'rappel') stepRappel(sim, m, R, dt);
    else if (R.kind === 'fastrope') stepFast(sim, m, R, dt, w);
    else stepZip(sim, m, R, dt, w);
  }
}

/* ---------- rappel ---------- */
function stepRappel(sim, m, R, dt) {
  const r = R.rope, n = (R.n ??= outward(sim, r));
  const Q = R.quick ? QUICK : RAPPEL; // (the assault rappel: quicker over the edge, longer bounds)
  const E = r.top;
  const yaw = Math.atan2(-n[0], -n[1]); // facing the wall
  const rx = E[0] + n[0] * RAPPEL.wall, rz = E[2] + n[1] * RAPPEL.wall; // the root on the rope
  R.t += dt;
  m.moving = true;
  if (R.phase === 'hook') {
    // to the edge, clipping in, turning his back to the drop
    const S = [E[0] - n[0] * RAPPEL.edgeIn, E[1], E[2] - n[1] * RAPPEL.edgeIn];
    const u = sm(R.t / Q.hook);
    m.p = lerp3(R.from, S, u);
    let dy = yaw - R.yaw0;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    m.yaw = R.yaw0 + dy * u;
    anim(sim, m, 'idle');
    if (R.t >= Q.hook) (R.phase = 'over'), (R.t = 0);
    return;
  }
  m.yaw = yaw;
  const y0 = E[1] - RAPPEL.top;
  if (R.phase === 'over') {
    // sitting back into the rope over the edge (the clip starts him standing on the roof)
    m.p = [rx, y0, rz];
    R.s = RAPPEL.top;
    anim(sim, m, 'rappelStart');
    if (R.t >= Q.over) {
      R.phase = 'down';
      R.t = 0;
      R.ground ??= groundBelow(sim, rx, y0, rz, r.bottom[1]);
      const D = Math.max(0, y0 - R.ground);
      R.bounds = Math.max(1, Math.ceil(D / (Q.hop * loadK(m))));
      R.hop = D / R.bounds;
    }
    return;
  }
  if (R.phase === 'down') {
    // bound after bound: the drop happens in the swing out (as the clip has it: u 0.22 .. 0.84)
    const b = Math.floor(R.t / Q.bound), u = R.t / Q.bound - b;
    const k = b >= R.bounds ? R.bounds : b + sm((u - 0.22) / 0.62);
    const y = y0 - R.hop * k;
    m.speed = Math.abs(y - m.p[1]) / Math.max(dt, 1e-3);
    R.v = m.speed;
    m.p = [rx, y, rz];
    R.s = E[1] - y;
    anim(sim, m, R.quick ? 'rappelQuick' : 'rappel');
    if (b >= R.bounds) (R.phase = 'off'), (R.t = 0);
    return;
  }
  // 'off': standing up on the ground, unclipping (the rig then draws the rifle again)
  m.p = [rx, R.ground, rz];
  R.v = 0;
  anim(sim, m, 'rappelEnd');
  if (R.t >= RAPPEL.off) finish(sim, m, 'idle');
}

/* ---------- fast rope ---------- */
function stepFast(sim, m, R, dt, w) {
  const r = R.rope;
  const fwd = [Math.sin(m.yaw ?? 0), Math.cos(m.yaw ?? 0)];
  // his feet for the hands at s (the rope runs down in front of his chest)
  const feetAt = (s) => {
    const q = ropePoint(r, s);
    return [q[0] - fwd[0] * FAST.front, q[1] - FAST.grip, q[2] - fwd[1] * FAST.front];
  };
  R.t += dt;
  m.moving = true;
  if (R.phase === 'mount') {
    // reaching out for the rope, swinging onto it, the feet clamping it
    R.s = FAST.s0;
    m.p = lerp3(R.from, feetAt(R.s), sm(R.t / FAST.mount));
    anim(sim, m, 'fastRope');
    if (R.t >= FAST.mount) (R.phase = 'slide'), (R.t = 0);
    return;
  }
  if (R.phase === 'slide') {
    const L = ropeLength(r);
    const p = feetAt(R.s);
    // the ground under him (looked up again only when he has moved over it)
    if (!R.gAt || Math.hypot(p[0] - R.gAt[0], p[2] - R.gAt[1]) > 0.2 || p[1] < R.ground) {
      R.gAt = [p[0], p[2]];
      R.ground = groundBelow(sim, p[0], p[1], p[2], ropeEnds(r)[1][1]);
    }
    const h = p[1] - R.ground;
    // braking to land softly, and for the man below (FAST.spacing above him; not onto a man who has not cleared)
    let vt = FAST.vmax * loadK(m);
    vt = Math.min(vt, Math.sqrt(FAST.land ** 2 + 2 * FAST.brake * Math.max(0, h - 0.15)));
    for (const o of onRope(w, r)) {
      if (o === m || o.rope.phase === 'fall') continue;
      const os = o.rope.phase === 'land' || (o.rope.phase === 'clear' && !o.rope.clearOf) ? o.rope.s : o.rope.phase === 'slide' || o.rope.phase === 'mount' ? o.rope.s : Infinity;
      if (os <= R.s) continue;
      const gap = os - R.s - FAST.spacing;
      vt = Math.min(vt, Math.max(0, gap / 0.5 + (o.rope.phase === 'slide' ? o.rope.v : 0)));
    }
    const a = Math.max(-FAST.brake * 1.6, Math.min(G, (vt - R.v) / 0.25));
    R.v = Math.max(0, R.v + a * dt);
    R.s += R.v * dt;
    m.speed = R.v;
    anim(sim, m, 'fastRope');
    const q = feetAt(Math.min(R.s, L));
    if (q[1] <= R.ground + 0.01) {
      // feet on the ground: down into a crouch
      m.p = [q[0], R.ground, q[2]];
      R.s = Math.min(R.s, L);
      R.phase = 'land';
      R.t = 0;
      if (w.voxelAt) bodyLanding(sim, m, { speed: R.v, name: 'off the fast rope' });
      R.v = 0;
      anim(sim, m, 'crouch');
      return;
    }
    if (R.s >= L) {
      // the end of the rope with nothing under it yet: he drops the rest
      m.p = q;
      letGo(sim, m, R, [0, -R.v, 0], 'end');
      return;
    }
    m.p = q;
    return;
  }
  if (R.phase === 'land') {
    anim(sim, m, 'crouch');
    if (R.t >= FAST.settle) {
      R.phase = 'clear';
      R.t = 0;
      // out of the way of the next man: each a different way round the rope (the first ahead)
      const k = (r.cleared = (r.cleared ?? 0) + 1) - 1;
      const a = (m.yaw ?? 0) + [0, 2.1, -2.1, 1.05, -1.05, Math.PI][k % 6];
      R.dir = [Math.sin(a), Math.cos(a)];
      R.start = m.p.slice();
      m.yaw = a;
    }
    return;
  }
  // 'clear': a few metres off at a run
  anim(sim, m, 'run');
  const solid = solidOf(sim);
  const d = Math.min(FAST.clear, FAST.run * R.t);
  const x = R.start[0] + R.dir[0] * d, z = R.start[2] + R.dir[1] * d;
  const g = groundBelow(sim, x, m.p[1] + 0.5, z, m.p[1]);
  const blocked = (solid && solid(x, g + 1.0, z)) || g - m.p[1] > 0.5;
  if (!blocked) m.p = [x, g, z];
  m.speed = FAST.run;
  R.clearOf = Math.hypot(m.p[0] - R.start[0], m.p[2] - R.start[2]) > 1.2 || blocked;
  if (d >= FAST.clear || blocked) finish(sim, m, 'crouchAim');
}

/* ---------- zipline ---------- */
function dirOf(r) {
  const [a, b] = ropeEnds(r);
  const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1;
  return [(b[0] - a[0]) / L, (b[1] - a[1]) / L, (b[2] - a[2]) / L];
}
function stepZip(sim, m, R, dt, w) {
  const r = R.rope, d = dirOf(r), L = ropeLength(r);
  const hangAt = (s) => {
    const q = ropePoint(r, s);
    return [q[0], q[1] - ZIP.hang, q[2]];
  };
  const yaw = Math.atan2(d[0], d[2]);
  R.t += dt;
  m.moving = true;
  if (R.phase === 'hook') {
    // the pulley over the cable, hanging from it
    R.s = ZIP.s0;
    m.p = lerp3(R.from, hangAt(R.s), sm(R.t / ZIP.hook));
    m.yaw = yaw;
    anim(sim, m, 'zipline');
    if (R.t >= ZIP.hook) (R.phase = 'ride'), (R.t = 0);
    return;
  }
  if (R.phase === 'ride') {
    m.yaw = yaw;
    const sinT = -d[1], cosT = Math.sqrt(Math.max(0, 1 - sinT * sinT));
    const left = L - ZIP.end - R.s;
    if (sinT <= ZIP.mu + 0.02) {
      // too flat (or uphill) for the pulley: hand over hand
      R.v = ZIP.hand;
      R.hand = true;
      anim(sim, m, 'zipHand');
    } else {
      const a = G * (sinT - ZIP.mu * cosT) - ZIP.drag * R.v * R.v;
      R.v = Math.max(0, R.v + a * dt);
      R.v = Math.min(R.v, ZIP.vmax); // (the gloved hand on the cable)
      // the brake near the low end: in at ZIP.arrive
      R.v = Math.min(R.v, Math.sqrt(ZIP.arrive ** 2 + 2 * ZIP.brake * Math.max(0, left)));
      R.hand = false;
      anim(sim, m, 'zipline');
    }
    // not into the man ahead
    for (const o of onRope(w, r)) {
      if (o === m || o.rope.phase !== 'ride' || o.rope.s <= R.s) continue;
      if (o.rope.s - R.s < ZIP.spacing) R.v = Math.min(R.v, o.rope.v * (o.rope.s - R.s) / ZIP.spacing);
    }
    R.s = Math.min(L - ZIP.end, R.s + R.v * dt);
    R.vmaxSeen = Math.max(R.vmaxSeen ?? 0, R.v);
    m.speed = R.v;
    m.p = hangAt(R.s);
    if (R.s >= L - ZIP.end - 1e-6) {
      // the low end: let go and drop to the ground (a short drop: no harm)
      const g = groundBelow(sim, m.p[0], m.p[1] + 0.2, m.p[2], r.bottom[1] - ZIP.hang);
      if (m.p[1] - g > 0.25) letGo(sim, m, R, [d[0] * R.v * 0.5, 0, d[2] * R.v * 0.5], 'end');
      else {
        m.p[1] = g;
        R.phase = 'land';
        R.t = 0;
        anim(sim, m, 'crouch');
      }
    }
    return;
  }
  // 'land'
  anim(sim, m, 'crouch');
  if (R.t >= ZIP.settle) finish(sim, m, 'crouchAim');
}

/* ---------- rigging a rope at an edge, finding one ---------- */
let ropeIds = 0;
/**
 * At a drop too deep to jump down, ahead of m along dir ([dx, dz]): the edge, the ground below,
 * a rope there (one already rigged within 1.5 m, else his own, tied off at the edge: it stays,
 * for the next man) and down it. False if there is no such drop (or it is too shallow: jump it).
 */
export function rappelFrom(sim, m, dir) {
  const solid = solidOf(sim);
  const w = sim.world;
  if (!solid || !m || m.dead || m.rope) return false;
  const l = Math.hypot(dir[0], dir[1]) || 1;
  const n = [dir[0] / l, dir[1] / l];
  // the edge: where the floor he stands on ends (within 1.5 m)
  let e = -1;
  for (let s = 0; s <= 1.5; s += 0.05)
    if (!solid(m.p[0] + n[0] * s, m.p[1] - 0.05, m.p[2] + n[1] * s)) {
      e = s;
      break;
    }
  if (e < 0) return false;
  const E = [m.p[0] + n[0] * e, m.p[1], m.p[2] + n[1] * e];
  const g = groundBelow(sim, E[0] + n[0] * RAPPEL.wall, E[1] - 0.3, E[2] + n[1] * RAPPEL.wall, -Infinity);
  if (!(E[1] - g >= RAPPEL.minDepth)) return false;
  w.ropes ??= [];
  let rope = w.ropes.find((r) => r.kind === 'rappel' && Math.hypot(r.top[0] - E[0], r.top[2] - E[2]) < 1.5 && Math.abs(r.top[1] - E[1]) < 0.5);
  if (!rope) {
    rope = { id: `rappel-${++ropeIds}`, kind: 'rappel', top: E, bottom: [E[0] + n[0] * 0.08, g, E[2] + n[1] * 0.08], out: n, owner: m, rigged: true };
    w.ropes.push(rope);
  }
  return startRope(sim, m, rope);
}

/**
 * A rope he can get on from p (feet): the top of a fast rope or a rappel rope within r m (a
 * rappel rope's anchor on the edge), or the high end of a zipline within reach overhead.
 */
export function nearRope(sim, p, r = 1.6) {
  let best = null, bd = r;
  for (const rope of sim.world.ropes ?? []) {
    const [a] = ropeEnds(rope);
    const dh = Math.hypot(a[0] - p[0], a[2] - p[2]);
    const dy = rope.kind === 'zipline' ? a[1] - (p[1] + ZIP.hang) : a[1] - p[1];
    if (Math.abs(dy) > (rope.kind === 'fastrope' ? 2.5 : 1.2)) continue;
    if (dh < bd) (bd = dh), (best = rope);
  }
  return best;
}
