import { groundAt, canFly, wingDamage, WING, dragonZones, dragonWoundPoint, initDragon } from './dragon.js';
import { splatter } from '../sim/wounds.js';
import { explode } from '../sim/explosions.js';
import { startRoll, stepRoll, pathClear, ROLLS } from './evade.js';
import { evadeKind } from './weapons.js';
import { startEvade as dragonEvade, hitFactor } from './dragonEvade.js';

/**
 * The dragon in the air, against something: two acts on top of ai/dragon.js (which moves and
 * poses it; these only say where to fly, when to strike, what to hold).
 *
 *  - The snatch (`startSnatch`, `stepSnatch`): it picks something up from the ground or out of
 *    the air (a guard, you, a loose object: a drum, a gas cylinder, a crate, the rig's training
 *    dummy; nothing heavier than it can lift: SNATCH.maxKg). It climbs to an attack height away
 *    from it, turns in, and dives straight at it, leading a moving target (`intercept`: where the
 *    jaws and the target meet). In the last half second the neck strikes forward and the jaws
 *    open; within reach they close: the target hangs in its jaws (a guard struggling), and it flies
 *    on with it, slower and beating harder for the weight. Then a toss of the head, and it lets go:
 *    the target flies on a ballistic arc with the speed it was carried at plus the toss
 *    (`stepThrown`), and the dragon goes on with what it was doing (its route). Where it lands it
 *    hits hard: a guard is hurt or killed by the speed (you too), a gas cylinder bursts, a crate
 *    breaks. A guard can jump aside at the last moment (`SNATCH.dodge`): it overshoots, climbs,
 *    turns and comes in again, up to SNATCH.passes times.
 *  - The fight (`startFight`, `stepFight`): two dragons. They circle, climbing, to gain position,
 *    then fly at each other head on, breathing fire (it does not hurt a dragon); as they pass,
 *    the higher one mostly gets its blow in (a bite at the neck or a wing, a rake of the talons,
 *    a lash of the tail; the other may buffet it with a wing). Or they lock talons: the grapple,
 *    both spinning down together, biting and buffeting, and letting go before the ground. Every
 *    blow lands on a hit zone (ai/dragon.js DRAGON_ZONES: its damage multiplier, bleeding, the
 *    wings tearing: WING). A torn wing loses its lift (`lift`): it has to come down (or falls,
 *    the wing useless). Badly hurt, the loser flees; the winner roars and goes back to its round.
 *    Every choice comes from the duel's own seeded random numbers: the same seed, the same fight.
 *
 * All state is plain data on the dragon (`d.snatch`, `d.duel`) and the world (`w.loose`: objects
 * it can carry; `w.thrown`: what is flying through the air after a throw).
 */
const G = 9.81;

/** The snatch: attack height and stand-off (m at 9 m), weight limit (kg at 9 m), passes, timings. */
export const SNATCH = { height: 13, range: 24, maxKg: 400, passes: 3, reach: 1.4, strike: 0.6, dive: 17, carry: 3.4, toss: 7, dodge: 0.35 };

/** What things weigh (kg). */
export const MASS = { enemy: 90, player: 90, cylinder: 35, drum: 180, crate: 25, dummy: 70, car: 1200 };

/** Raw damage of a blow in a fight (before the zone's multiplier) and how much it tears a wing. */
export const BLOWS = { bite: { dmg: 90, tear: 55 }, claw: { dmg: 55, tear: 45 }, tail: { dmg: 45, tear: 30 }, buffet: { dmg: 20, tear: 12 } };

/** What the events say (main.js shows them in its log). */
export const AIR_EVENT_TEXT = { dragonEvade: 'evades', dragonDodged: 'slipped a shot', dragonPassDodged: 'twisted away from the blow', snatched: 'snatched its prey out of the air', snatchMiss: 'missed: it turns for another pass', thrown: 'threw its prey away', thrownLanded: 'hit the ground', dragonDuel: 'turns on the other dragon', dragonGrapple: 'locked talons: both spinning down', dragonBlow: 'is struck', dragonDuelEnd: 'won the fight' };

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const dist = (a, b) => len(sub(a, b));
const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const approach = (v, t, rate, dt) => v + (t - v) * Math.min(1, rate * dt);

/** A seeded random number in [0, 1) from state object o (o.seed: xorshift32, kept in the plain data). */
export function rnd(o) {
  let x = o.seed >>> 0 || 0x9e3779b9;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  o.seed = x >>> 0;
  return o.seed / 4294967296;
}

/**
 * Where to aim to meet a target now at p moving at v (constant), flying from `from` at `speed`:
 * the smallest t > 0 with |p + v·t − from| = speed·t. Returns { p: the meeting point, t }. If it
 * cannot be caught (faster than the chaser, going away), the point it will be at after the
 * straight-line time.
 */
export function intercept(from, speed, p, v = [0, 0, 0]) {
  const r = sub(p, from);
  const a = dot(v, v) - speed * speed;
  const b = 2 * dot(r, v);
  const c = dot(r, r);
  let t = null;
  if (Math.abs(a) < 1e-9) t = b < 0 ? -c / b : null;
  else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      const ts = [(-b - s) / (2 * a), (-b + s) / (2 * a)].filter((x) => x > 0);
      if (ts.length) t = Math.min(...ts);
    }
  }
  if (!(t > 0)) t = Math.sqrt(c) / Math.max(1e-3, speed);
  t = Math.min(t, 8);
  return { p: add(p, v, t), t };
}

/** Can dragon d lift `kg`? */
export const canCarry = (d, kg) => kg <= SNATCH.maxKg * (d.k ?? 1) ** 3;

/** How much of its lift a dragon has left (1 whole; its worse wing torn: less; useless: 0). */
export const lift = (d) => clamp(1 - wingDamage(d)[0], 0, 1);

const massOf = (T) => (T.kind === 'object' ? T.ref.mass ?? MASS[T.ref.kind] ?? 50 : MASS[T.kind] ?? 90);

/** A loose object it can carry (in w.loose): kind 'drum' | 'cylinder' | 'crate' | 'dummy', at p (its middle). */
export function addLoose(w, kind, p, extra = {}) {
  w.loose ??= [];
  const r = { drum: 0.3, cylinder: 0.16, crate: 0.3, dummy: 0.3 }[kind] ?? 0.3;
  const half = { drum: 0.44, cylinder: 0.32, crate: 0.3, dummy: 0.9 }[kind] ?? 0.3;
  const o = { kind, p: p.slice(), rot: [0, 0, 0], v: [0, 0, 0], r, half, mass: MASS[kind] ?? 50, held: false, flying: false, ...extra };
  w.loose.push(o);
  return o;
}

// -----------------------------------------------------------------------------
// the snatch

/** Where the target's middle is now (null: gone). Its velocity is kept, smoothed, in T.v. */
function track(ai, T, dt) {
  let c = null;
  if (T.kind === 'enemy') {
    const e = T.ref;
    if (e.devoured || (e.dead && !e.held)) return null;
    c = [e.p[0], e.p[1] + (e.held ? 0 : 0.9), e.p[2]];
  } else if (T.kind === 'player') {
    const w = ai.world;
    const pl = ai.sim.ai?.player;
    if (w.playerHeld?.carry || w.playerThrown) c = T.c;
    else if (!pl) return null;
    else c = [pl.p[0], pl.p[1] + 0.9, pl.p[2]];
  } else {
    const o = T.ref;
    if (!o || o.burst || o.gone) return null;
    c = o.p.slice();
  }
  if (!c) return null;
  if (T.c && dt > 0) {
    const v = sub(c, T.c).map((x) => x / dt);
    // (a jump of metres in one step is a teleport, not a speed)
    if (len(v) < 40) T.v = (T.v ?? [0, 0, 0]).map((x, i) => x + (v[i] - x) * Math.min(1, dt * 6));
  }
  T.v ??= [0, 0, 0];
  T.c = c;
  return c;
}

/**
 * Off to snatch T ({ kind: 'enemy' | 'player' | 'object', ref }): returns false if it cannot
 * (too heavy, cannot fly, dead). `seed`: its random choices (the dodges it allows for).
 */
export function startSnatch(ai, d, T, seed = 7) {
  if (!d || d.health <= 0 || !canFly(d) || !T) return false;
  if (!canCarry(d, massOf(T))) return false;
  if (d.snatch) endSnatch(ai, d, 'again');
  if (d.duel) return false;
  const resume = ['route', 'roam'].includes(d.state) ? d.state : 'roam';
  d.snatch = { T: { kind: T.kind, ref: T.ref }, phase: d.mode === 'air' ? 'climb' : 'takeoff', t: 0, passes: 0, resume, seed: seed >>> 0 || 7 };
  d.state = 'snatch';
  d.airAct = 'snatch';
  d.target = null;
  d.hunt = null;
  d.breathT = d.windT = 0;
  track(ai, d.snatch.T, 0);
  return true;
}

/** Fly the chest so that the mouth meets `aim` (a dive: steeper and faster than airMove allows). */
function diveMove(d, w, dt, aim, speed, maxTurn = 1.6) {
  const k = d.k;
  d.mode = 'air';
  const goal = sub(aim, sub(d.mouth, d.p));
  const dx = goal[0] - d.p[0];
  const dz = goal[2] - d.p[2];
  const dh = Math.hypot(dx, dz);
  const err = wrap(Math.atan2(dx, dz) - d.yaw);
  const turn = clamp(err * 2.4, -maxTurn, maxTurn);
  d.yaw += turn * dt;
  d.bank = approach(d.bank, clamp(Math.atan((d.speed * turn) / G), -0.8, 0.8), 4, dt);
  const tgo = dh / Math.max(4, d.speed);
  let vyWant = clamp((goal[1] - d.p[1]) / Math.max(0.35, tgo), -14, 5);
  const floor = Math.max(groundAt(w, d.p[0], d.p[2], d.p[1] + 1).y, w.sea?.level ?? -Infinity);
  if (d.p[1] + vyWant * 0.3 < floor + 0.9 * k) vyWant = Math.max(vyWant, (floor + 0.9 * k - d.p[1]) * 3);
  d.vy += clamp(vyWant - d.vy, -14 * dt, 10 * dt);
  d.speed += clamp(speed - d.speed - 0.35 * d.vy, -5 * dt, 4 * dt);
  d.speed = clamp(d.speed, 4, 22);
  d.p[0] += Math.sin(d.yaw) * d.speed * dt;
  d.p[2] += Math.cos(d.yaw) * d.speed * dt;
  d.p[1] = Math.max(floor + 0.6 * k, d.p[1] + d.vy * dt);
  d.pitch = approach(d.pitch, Math.atan2(d.vy, d.speed), 4, dt);
  // stooping: the wings half folded, beating again as it levels out
  d.fold = approach(d.fold, d.vy < -3 ? 0.3 : 0, 3, dt);
  d.flapAmp = approach(d.flapAmp, d.vy < -2 ? 0.15 : 1.1, 3, dt);
  d.crouch = approach(d.crouch, 0, 3, dt);
  d.groundF = approach(d.groundF, 0, 1.5, dt);
  d.undulate = approach(d.undulate, 0, 2, dt);
  d.flare = 0;
}

/** Never into the ground (pulling out of a dive, flying on low with a load). */
function keepUp(d, w) {
  const floor = Math.max(groundAt(w, d.p[0], d.p[2], d.p[1] + 1).y, w.sea?.level ?? -Infinity) + 0.8 * d.k;
  if (d.p[1] < floor) {
    d.p[1] = floor;
    d.vy = Math.max(d.vy, 0);
  }
}

/** Hold what it carries in its jaws (crosswise, hanging from them). */
function hold(ai, d, w) {
  const S = d.snatch;
  const T = S.T;
  const { dir, up } = d.head;
  const k = d.k;
  const m = d.mouth;
  const yaw = Math.atan2(dir[0], dir[2]);
  if (T.kind === 'enemy') {
    const e = T.ref;
    e.p = add(m, dir, -0.15 * k);
    e.heldYaw = yaw;
    e.heldPitch = Math.asin(clamp(dir[1], -1, 1));
    T.c = e.p.slice();
  } else if (T.kind === 'player') {
    const H = d.head.p;
    w.playerHeld = { eye: [0, 1, 2].map((c) => H[c] + dir[c] * 1.25 * k * 0.3 - up[c] * 0.02 * k), dir: dir.slice(), up: up.slice(), jaw: d.jaw, t: 0, carry: true };
    T.c = add(m, up, -0.4);
  } else {
    const o = T.ref;
    o.p = add(add(m, up, -o.r * 0.6), dir, -0.1 * k);
    o.rot = [Math.asin(clamp(dir[1], -1, 1)) * -1, yaw + Math.PI / 2, Math.PI / 2];
    o.v = [Math.sin(d.yaw) * d.speed, d.vy, Math.cos(d.yaw) * d.speed];
    T.c = o.p.slice();
  }
}

/** After the pose (ai/dragon.js, the rig's stage): what it carries, where its jaws are now. */
export function holdCarried(ai, d, w) {
  if (d.snatch && d.carrying && !d.snatch.released) hold(ai, d, w);
}

/** The jaws close on it. */
function attach(ai, d, w) {
  const S = d.snatch;
  const T = S.T;
  S.phase = 'carry';
  S.ct = 0;
  S.alt = Math.max(d.p[1], groundAt(w, d.p[0], d.p[2], d.p[1]).y + 8 * d.k) + 3 * d.k;
  S.load = clamp(massOf(T) / (SNATCH.maxKg * d.k ** 3), 0, 1);
  d.carrying = T.kind;
  if (T.kind === 'enemy') {
    const e = T.ref;
    e.held = true;
    e.onFire = 0;
    e.dodge = null;
    e.stunnedUntil = Infinity; // (the guard AI leaves him alone: he is in the jaws)
    ai.sim.ai?.damage?.(e, 25);
    w.events.push({ type: 'snatched', pos: e.p.slice(), time: w.time, name: 'the dragon' });
  } else if (T.kind === 'player') {
    w.events.push({ type: 'seized', pos: d.mouth.slice(), time: w.time, name: 'the dragon' });
  } else {
    T.ref.held = true;
    T.ref.flying = false;
    w.events.push({ type: 'snatched', pos: d.mouth.slice(), time: w.time, name: 'the dragon' });
  }
  hold(ai, d, w);
}

/** The toss: let go, with the speed it carries plus the flick of the head. */
function release(ai, d, w) {
  const S = d.snatch;
  const T = S.T;
  S.released = true;
  const dir = d.head.dir;
  const v = [Math.sin(d.yaw) * d.speed + dir[0] * SNATCH.toss, (d.vy ?? 0) + dir[1] * SNATCH.toss + 3, Math.cos(d.yaw) * d.speed + dir[2] * SNATCH.toss];
  const spin = [(rnd(S) - 0.5) * 8, (rnd(S) - 0.5) * 6, 2 + rnd(S) * 4];
  w.thrown ??= [];
  const th = { kind: T.kind, ref: T.kind === 'player' ? null : T.ref, p: T.c.slice(), v, spin, t: 0, by: d };
  if (T.kind === 'enemy') T.ref.thrown = true;
  else if (T.kind === 'player') {
    w.playerHeld = null;
    w.playerThrown = { p: th.p.slice(), v: v.slice(), t: 0 };
  } else {
    T.ref.held = false;
    T.ref.flying = true;
    T.ref.v = v.slice();
  }
  w.thrown.push(th);
  d.carrying = null;
  S.thrownV = v.slice();
  w.events.push({ type: 'thrown', pos: d.mouth.slice(), time: w.time, name: 'the dragon' });
}

/** The snatch is over: on with what it was doing (its route). */
export function endSnatch(ai, d, why = 'done') {
  const S = d.snatch;
  if (!S) return;
  const w = ai.world;
  if (d.carrying && !S.released) release(ai, d, w);
  d.snatch = null;
  d.airAct = null;
  d.strike = 0;
  d.jawWant = null;
  d.carrying = null;
  d.snatchCool = 40;
  d.lastSnatch = { why, passes: S.passes };
  if (S.resume === 'route' && d.routePts) {
    d.state = 'route';
    d.legFly = d.mode === 'air';
  } else {
    d.state = 'roam';
    d.roam = { phase: d.mode === 'air' ? 'fly' : 'walk', until: 12 };
  }
}

/**
 * A guard (or the rig's dummy) sees it coming and gets out from under it. A guard rolls (ai/evade.js:
 * turned to face the dragon, a log roll to his left or right, across its line of attack: the
 * roll's own root path, which this carries him along: stepThrown); the dummy jumps aside.
 */
function dodge(S, x, d, w) {
  let side = rnd(S) < 0.5 ? 1 : -1;
  const f = [Math.sin(d.yaw), 0, Math.cos(d.yaw)];
  S.dodged = (S.dodged ?? 0) + 1;
  if (S.T.kind === 'enemy' && x.health !== undefined && !x.crawling) {
    // facing the dragon (its track reversed), his left is across its track
    const yaw = Math.atan2(-f[0], -f[2]);
    let kind = side > 0 ? 'rollLeft' : 'rollRight';
    const host = { solid: (a, b, c) => { const i = w.voxelAt?.(a, b, c) ?? -1; return i >= 0 && !!w.mat[i]; } };
    if (!pathClear(x, kind, yaw, host)) kind = kind === 'rollLeft' ? 'rollRight' : 'rollLeft';
    // (his weapon may rule the roll out, ai/weapons.js: a crouched side step that way instead)
    kind = evadeKind(x, kind) ?? (kind === 'rollLeft' ? 'sidestepLeft' : 'sidestepRight');
    // (flung out quick and far: all he has)
    const r = startRoll(x, { kind, yaw }, w.time, { ext: true, why: 'dragon', cool: 1, slow: 0.8 });
    r.geo.d = ROLLS[kind].geo.d * 1.25; // (flung out further: all he has)
    return;
  }
  x.dodge = { v: [f[2] * side * 7, 0, -f[0] * side * 7], until: w.time + 0.6 };
  if (x.stunnedUntil !== undefined || x.health !== undefined) x.stunnedUntil = Math.max(x.stunnedUntil ?? 0, w.time + 0.8);
}

/** One step of the snatch (ai/dragon.js calls it for state 'snatch'). */
export function stepSnatch(ai, d, w, dt) {
  const S = d.snatch;
  if (!S) return;
  const k = d.k;
  S.t += dt;
  d.jawWant = null;
  if (S.phase === 'carry' || S.phase === 'toss') {
    if (!S.released) hold(ai, d, w);
  } else if (!track(ai, S.T, dt)) return endSnatch(ai, d, 'lost');
  const c = S.T.c;
  switch (S.phase) {
    case 'takeoff':
      if (ai.takeoff(d, w, dt)) S.phase = 'climb';
      else if (!canFly(d)) endSnatch(ai, d, 'grounded');
      return;
    case 'climb': {
      // away from it to a stand-off, up at the attack height, then turn in
      const gy = Math.max(groundAt(w, c[0], c[2], c[1] + 2).y, w.sea?.level ?? -Infinity);
      const alt = Math.max(c[1], gy) + SNATCH.height * k;
      const dh = Math.hypot(c[0] - d.p[0], c[2] - d.p[2]);
      if (!S.turned && dh > SNATCH.range * k * 0.9) S.turned = true;
      const goal = S.turned ? c : [d.p[0] + Math.sin(d.yaw) * 20, 0, d.p[2] + Math.cos(d.yaw) * 20];
      ai.airMove(d, w, dt, goal, alt, 12);
      keepUp(d, w);
      d.strike = approach(d.strike ?? 0, 0, 4, dt);
      d.look = S.turned ? c : null;
      const facing = Math.cos(wrap(Math.atan2(c[0] - d.p[0], c[2] - d.p[2]) - d.yaw)) > 0.9;
      if (S.turned && facing && d.p[1] > alt - 3 * k && dh > 10 * k) {
        S.phase = 'dive';
        S.dodgeTried = false;
        S.dt = 0;
        ai.roar(d, w);
      }
      if (S.t > 60) endSnatch(ai, d, 'gave up');
      return;
    }
    case 'dive': {
      S.dt += dt;
      const sp = Math.max(d.speed, 10);
      const aim = intercept(d.mouth, sp, c, S.T.v);
      S.aim = aim.p;
      S.tgo = aim.t;
      // (committed in the last half second: it can hardly turn any more)
      if (!S.committed && aim.t < 0.6) {
        S.committed = true;
        S.strikeAt = aim.p.slice(); // (the strike goes where it reckoned the target would be)
      }
      // (committed: for where it reckoned the target would be, not where it goes now)
      diveMove(d, w, dt, S.committed ? S.strikeAt : aim.p, SNATCH.dive, S.committed ? 0.2 : 1.6);
      d.look = S.committed ? S.strikeAt : c;
      const dm = dist(d.mouth, c);
      // the strike: in the last moments the neck shoots forward, the jaws open wide
      const striking = aim.t < SNATCH.strike + 0.2 || dm < 5 * k;
      d.strike = approach(d.strike ?? 0, striking ? 1 : 0, striking ? 10 : 4, dt);
      if (striking) d.jawWant = 1;
      // a guard (or the dummy) may jump aside when it is a second away
      const dodger = S.T.kind === 'enemy' ? !S.T.ref.dead : S.T.kind === 'object' && S.T.ref.canDodge;
      if (!S.dodgeTried && aim.t < 0.55 && dodger) {
        S.dodgeTried = true;
        if (rnd(S) < (S.T.ref.dodgeChance ?? SNATCH.dodge)) dodge(S, S.T.ref, d, w);
      }
      if (dm < SNATCH.reach * k) return attach(ai, d, w);
      // gone past it (or pulled out of a dive that would not reach): a miss
      const F = [Math.sin(d.yaw), 0, Math.cos(d.yaw)];
      const behind = dot(F, sub(c, d.mouth)) < -0.3 * k;
      if ((behind && S.dt > 0.5) || S.dt > 9) {
        S.passes++;
        d.strike = 0;
        w.events.push({ type: 'snatchMiss', pos: d.mouth.slice(), time: w.time, name: 'the dragon' });
        w.events.push({ type: 'dragonSnap', pos: d.mouth.slice(), time: w.time, name: 'the dragon' });
        if (S.passes >= SNATCH.passes) return endSnatch(ai, d, 'missed');
        S.phase = 'climb';
        S.turned = false;
        S.committed = false;
      }
      return;
    }
    case 'carry': {
      // on with it: slower and beating harder for the weight, climbing slowly
      S.ct += dt;
      const L = S.load;
      ai.airMove(d, w, dt, [d.p[0] + Math.sin(d.yaw) * 30, 0, d.p[2] + Math.cos(d.yaw) * 30], S.alt, 12 * (1 - 0.4 * L));
      keepUp(d, w);
      d.speed = Math.min(d.speed, 14 * (1 - 0.35 * L));
      if (d.vy > 0) d.p[1] -= d.vy * 0.5 * L * dt;
      d.flapAmp = Math.max(d.flapAmp, 1 + 0.35 * L);
      d.strike = approach(d.strike ?? 0, 0.25, 4, dt);
      d.look = null;
      d.jawWant = 0.3;
      if (S.ct > SNATCH.carry) {
        S.phase = 'toss';
        S.tt = 0;
      }
      return;
    }
    case 'toss': {
      // a toss of the head: up and forward, and it lets go at the top
      S.tt += dt;
      ai.airMove(d, w, dt, [d.p[0] + Math.sin(d.yaw) * 30, 0, d.p[2] + Math.cos(d.yaw) * 30], S.alt + 2 * k, 12);
      keepUp(d, w);
      const H = d.head.p;
      d.look = [H[0] + Math.sin(d.yaw) * 3 * k, H[1] + (S.tt < 0.3 ? 4 : -1) * k, H[2] + Math.cos(d.yaw) * 3 * k];
      d.strike = approach(d.strike ?? 0, 1, 12, dt);
      d.jawWant = S.tt < 0.3 ? 0.3 : 0.9;
      if (!S.released && S.tt >= 0.3) release(ai, d, w);
      if (S.tt > 1.1) endSnatch(ai, d, 'thrown');
      return;
    }
  }
}

/**
 * What a throw sent through the air (w.thrown), falling: gravity and a little air drag, the
 * body tumbling; where it comes down, the impact. And the jumps aside (dodges) of guards and
 * dummies. Called every step (ai/dragon.js; the rig's stage).
 */
export function stepThrown(sim, dt) {
  const w = sim.world;
  for (const x of [...(w.enemies ?? []), ...(w.loose ?? [])]) {
    // a guard rolling out from under a dive: along the roll's root path, on the ground
    if (x.trav?.ext && x.trav.roll) {
      if (x.held || x.dead) x.trav = null;
      else stepRoll(x, dt, (a, b) => groundAt(w, a, b, x.p[1] + 0.6).y);
      continue;
    }
    if (!x.dodge) continue;
    if (w.time > x.dodge.until || x.held) x.dodge = null;
    else {
      x.p[0] += x.dodge.v[0] * dt;
      x.p[2] += x.dodge.v[2] * dt;
    }
  }
  const list = w.thrown;
  if (!list?.length) return;
  for (let i = list.length - 1; i >= 0; i--) {
    const th = list[i];
    th.t += dt;
    const v = th.v;
    const sp = len(v);
    for (let c = 0; c < 3; c++) v[c] -= 0.004 * sp * v[c] * dt; // drag (a body: ~50 m/s at most)
    v[1] -= G * dt;
    for (let c = 0; c < 3; c++) th.p[c] += v[c] * dt;
    const r = th.kind === 'object' ? th.ref.r ?? 0.3 : 0.3;
    // the body tumbling
    if (th.kind === 'enemy') {
      const e = th.ref;
      e.p = th.p.slice();
      e.heldYaw = (e.heldYaw ?? 0) + th.spin[1] * dt;
      e.heldPitch = (e.heldPitch ?? 0) + th.spin[2] * dt;
    } else if (th.kind === 'player') {
      if (w.playerThrown) {
        w.playerThrown.p = th.p.slice();
        w.playerThrown.v = v.slice();
        w.playerThrown.t = th.t;
      }
    } else {
      const o = th.ref;
      o.p = th.p.slice();
      o.v = v.slice();
      for (let c = 0; c < 3; c++) o.rot[c] += th.spin[c] * dt;
    }
    const g = groundAt(w, th.p[0], th.p[2], th.p[1] + 1);
    const surface = g.y + g.water;
    if (th.p[1] - r > surface && th.p[1] > -30) continue;
    // down
    list.splice(i, 1);
    const water = g.water > 0.6;
    const speed = len(v);
    const at = [th.p[0], g.y, th.p[2]];
    let damage = 0;
    if (th.kind === 'enemy') {
      const e = th.ref;
      e.held = false;
      e.thrown = false;
      e.p = [th.p[0], water ? surface - 1 : g.y, th.p[2]];
      e.stunnedUntil = w.time + 2.5;
      damage = Math.max(0, speed - 8) * 14 * (water ? 0.25 : 1);
      if (damage > 0) {
        if (sim.ai?.damage) sim.ai.damage(e, damage);
        else {
          e.health = (e.health ?? 100) - damage;
          if (e.health <= 0) e.dead = true;
        }
        if (!water) splatter(sim, [at[0], at[1] + 0.3, at[2]], [v[0], -Math.abs(v[1]), v[2]], Math.min(2, damage / 60));
      }
    } else if (th.kind === 'player') {
      w.playerThrown = null;
      damage = Math.max(0, speed - 8) * 7 * (water ? 0.25 : 1);
      w.events.push({ type: 'playerLanded', pos: at.slice(), time: w.time, name: 'you', damage, water });
    } else {
      const o = th.ref;
      o.flying = false;
      o.v = [0, 0, 0];
      o.p = [th.p[0], (water ? surface - 0.2 : g.y) + (o.kind === 'dummy' || o.kind === 'crate' ? o.r : o.r), th.p[2]];
      o.rot = [0, o.rot[1], Math.PI / 2]; // on its side
      if (o.kind === 'cylinder' && speed > 11 && !water && !o.burst) {
        // the valve snaps off, the shell splits: the gas goes up
        o.burst = true;
        explode(sim, [at[0], at[1] + 0.3, at[2]], 4e5, { name: 'cylinder' });
      } else if (o.kind === 'crate' && speed > 9) o.broken = true;
      damage = speed;
    }
    w.events.push({ type: 'thrownLanded', pos: at, time: w.time, name: th.kind === 'enemy' ? 'a guard' : th.kind === 'player' ? 'you' : `a ${th.ref.kind}`, speed, damage, water });
    w.noises.push({ p: at, loud: 12 + speed, time: w.time, kind: 'impact' });
  }
}

// -----------------------------------------------------------------------------
// two dragons

/** Two dragons fight (seed: the duel's random choices). Returns the duel, or null. */
export function startFight(ai, a, b, seed) {
  if (!a || !b || a === b || a.health <= 0 || b.health <= 0) return null;
  const w = ai.world;
  for (const d of [a, b]) {
    if (d.snatch) endSnatch(ai, d, 'fight');
  }
  const mid = [(a.p[0] + b.p[0]) / 2, 0, (a.p[2] + b.p[2]) / 2];
  mid[1] = Math.max(groundAt(w, mid[0], mid[2]).y, w.sea?.level ?? -Infinity);
  const D = {
    seed: (seed ?? ((a.seed ?? 1) * 7919 + (b.seed ?? 2) * 104729)) >>> 0 || 1,
    phase: 'circle',
    t: 0,
    c: mid,
    ang: Math.atan2(a.p[2] - mid[2], a.p[0] - mid[0]),
    blows: [],
    grapples: 0,
    grappleCool: 6,
    a,
    b,
  };
  D.circleT = 4 + rnd(D) * 3;
  a.duel = b.duel = D;
  a.foe = b;
  b.foe = a;
  a.duelSide = 1;
  b.duelSide = -1;
  for (const d of [a, b]) {
    d.state = 'fight';
    d.airAct = 'fight';
    d.target = null;
    d.hunt = null;
    d.joustFired = false;
  }
  ai.roar(a, w);
  w.events.push({ type: 'dragonDuel', pos: a.chest?.slice() ?? a.p.slice(), time: w.time, name: 'the dragon' });
  return D;
}

/** A hit on dragon d in zone `key` by blow `type` from dragon `by`: the damage (by DRAGON_ZONES), a wound, a torn wing. */
export function blow(ai, d, key, type, by) {
  const w = ai.world;
  if (!d.spine || d.health <= 0) return 0;
  const Z = dragonZones(d, w).find((z) => z.k === key);
  if (!Z) return 0;
  const s = { k: key, u: 0.5, a: 0 };
  const at = dragonWoundPoint(d, s, w);
  const i = Math.max(1, Math.round(0.5 * (Z.pts.length - 1)));
  const hz = { k: key, zone: Z.z, Z, i, t: 0.5, u: 0.5, q: Z.pts[i].p, p: at.p };
  const from = by?.mouth ?? at.p;
  const dir = norm(sub(at.p, from));
  const before = canFly(d);
  const dmg = ai.strike(d, hz, type, at.p, len(dir) > 0 ? dir : at.n.map((v) => -v), by);
  const D = d.duel;
  D?.blows.push({ t: w.time, to: D.a === d ? 'a' : 'b', key, type, dmg: Math.round(dmg) });
  w.events.push({ type: 'dragonBlow', pos: at.p.slice(), time: w.time, name: `${Z.z.label} (${type})`, damage: dmg });
  // a wing torn in the air: down it must come (straight ahead, where it can)
  if (before && !canFly(d) && d.mode === 'air' && wingDamage(d)[0] < WING.useless) {
    const k = d.k;
    const f = [Math.sin(d.yaw), 0, Math.cos(d.yaw)];
    const x = clamp(d.p[0] + f[0] * (d.speed * 1.5 + 6 * k), 3 * k, w.size[0] - 3 * k);
    const z = clamp(d.p[2] + f[2] * (d.speed * 1.5 + 6 * k), 3 * k, w.size[2] - 3 * k);
    d.forcedSpot = [x, groundAt(w, x, z).y, z];
    w.events.push({ type: 'dragonWingHurt', pos: d.chest.slice(), time: w.time, name: 'the dragon' });
  }
  return dmg;
}

const pick = (D, table) => {
  let r = rnd(D) * table.reduce((a, [, p]) => a + p, 0);
  for (const [k, p] of table) if ((r -= p) <= 0) return k;
  return table[table.length - 1][0];
};

/** Is a fighter out of it (dead, fleeing, falling, grounded by a wing, or on the ground)? */
const out = (d) => d.health <= 0 || d.state === 'flee' || d.health < d.maxHealth * 0.25 || d.mode === 'falling' || !canFly(d) || d.forcedSpot;

/** The duel is decided: the loser flees (or is down), the winner roars and goes back to its round. */
function endDuel(ai, D, w, loser) {
  const winner = loser === D.a ? D.b : D.a;
  D.phase = 'over';
  D.winner = winner === D.a ? 'a' : 'b';
  for (const d of [D.a, D.b]) {
    d.duel = null;
    d.foe = null;
    d.airAct = null;
    d.strike = 0;
    d.jawWant = null;
    d.breathLen = null;
  }
  if (loser.health > 0 && loser.health < loser.maxHealth * 0.6 && canFly(loser) && loser.mode !== 'falling') loser.state = 'flee';
  else if (loser.health > 0) {
    loser.state = 'roam';
    loser.roam = { phase: 'walk', until: 15 };
  }
  if (winner.health > 0) {
    winner.state = winner.routePts ? 'route' : 'roam';
    winner.legFly = winner.mode === 'air';
    winner.roam = { phase: winner.mode === 'air' ? 'fly' : 'walk', until: 10 };
    winner.lastRoar = -99;
    ai.roar(winner, w);
  }
  w.events.push({ type: 'dragonDuelEnd', pos: winner.chest?.slice() ?? winner.p.slice(), time: w.time, name: 'the dragon' });
}

/** Locked talons: both spinning down together. */
function startGrapple(ai, D, w) {
  const A = D.a;
  const B = D.b;
  D.phase = 'grapple';
  D.t = 0;
  D.g = [(A.p[0] + B.p[0]) / 2, (A.p[1] + B.p[1]) / 2, (A.p[2] + B.p[2]) / 2];
  D.gv = 0;
  D.spin = Math.atan2(A.p[2] - B.p[2], A.p[0] - B.p[0]);
  D.spinW = (rnd(D) < 0.5 ? 1 : -1) * 2.4;
  D.drift = [(Math.sin(A.yaw) * A.speed + Math.sin(B.yaw) * B.speed) / 2, 0, (Math.cos(A.yaw) * A.speed + Math.cos(B.yaw) * B.speed) / 2];
  D.nextBlow = 0.5;
  D.grapples++;
  w.events.push({ type: 'dragonGrapple', pos: D.g.slice(), time: w.time, name: 'the dragons' });
}

/** The pass: as they meet head on, one gets its blow in (the higher one, mostly); the other may buffet back. */
function pass(ai, D) {
  const A = D.a;
  const B = D.b;
  const hi = A.p[1] >= B.p[1] ? A : B;
  const att = rnd(D) < 0.65 ? hi : hi === A ? B : A;
  const def = att === A ? B : A;
  const move = pick(D, [['bite', 0.45], ['claw', 0.3], ['tail', 0.25]]);
  const zone =
    move === 'bite' ? pick(D, [['neck', 0.4], ['head', 0.1], ['chest', 0.2], ['wingL', 0.15], ['wingR', 0.15]]) :
    move === 'claw' ? pick(D, [['chest', 0.3], ['belly', 0.3], ['wingL', 0.2], ['wingR', 0.2]]) :
    pick(D, [['head', 0.25], ['neck', 0.35], ['wingL', 0.2], ['wingR', 0.2]]);
  att.strikeT = 0.45;
  // the one struck at evading (a roll, a wing-over, a dive: ai/dragonEvade.js): the blow may miss
  if (def.evade && rnd(D) >= hitFactor(def)) {
    D.dodged = (D.dodged ?? 0) + 1;
    ai.world.events.push({ type: 'dragonPassDodged', pos: (def.chest ?? def.p).slice(), time: ai.world.time, name: 'the dragon' });
    return;
  }
  blow(ai, def, zone, move, att);
  if (rnd(D) < 0.35 && def.health > 0) {
    blow(ai, att, pick(D, [['head', 0.5], ['neck', 0.5]]), 'buffet', def);
    att.vy -= 3;
    att.yaw += (rnd(D) < 0.5 ? 1 : -1) * 0.35;
  }
}

/** One blow in the grapple: a bite at the neck or a wing, a rake of the talons, a buffet of a wing. */
function grappleBlow(ai, D) {
  const att = rnd(D) < 0.5 ? D.a : D.b;
  const def = att === D.a ? D.b : D.a;
  const move = pick(D, [['bite', 0.5], ['claw', 0.3], ['buffet', 0.2]]);
  const zone =
    move === 'bite' ? pick(D, [['neck', 0.5], ['wingL', 0.25], ['wingR', 0.25]]) :
    move === 'claw' ? pick(D, [['chest', 0.4], ['belly', 0.4], ['tail', 0.2]]) :
    pick(D, [['head', 0.6], ['neck', 0.4]]);
  att.strikeT = 0.4;
  blow(ai, def, zone, move, att);
}

/** The duel's own clock and phases (run once a step, by the first dragon). */
function advanceDuel(ai, D, w, dt) {
  const A = D.a;
  const B = D.b;
  for (const x of [A, B]) if (out(x)) return endDuel(ai, D, w, x);
  D.grappleCool -= dt;
  if (A.mode !== 'air' || B.mode !== 'air') return; // (one still taking off)
  D.t += dt;
  D.ang += dt * 0.55;
  const k = Math.max(A.k, B.k);
  const dd = A.chest && B.chest ? dist(A.chest, B.chest) : 99;
  switch (D.phase) {
    case 'circle':
      if (D.t > D.circleT) {
        D.phase = 'joust';
        D.t = 0;
        D.lastDD = null;
        D.meet = [(A.p[0] + B.p[0]) / 2, (A.p[1] + B.p[1]) / 2, (A.p[2] + B.p[2]) / 2];
        A.joustFired = B.joustFired = false;
        A.joustOut = B.joustOut = true;
        D.passes = (D.passes ?? 0) + 1;
      }
      break;
    case 'joust': {
      // they meet: close, or as close as they get (a near miss within a neck's reach)
      const closest = dd < 6.5 * k && dd > (D.lastDD ?? 99);
      D.lastDD = dd;
      if (dd < 4.5 * k || closest) {
        D.lastDD = null;
        const floor = Math.max(groundAt(w, A.p[0], A.p[2]).y, w.sea?.level ?? -Infinity);
        const high = Math.min(A.p[1], B.p[1]) - floor > 14 * k;
        if (D.grappleCool <= 0 && high && rnd(D) < 0.55) return startGrapple(ai, D, w);
        pass(ai, D);
        D.phase = 'separate';
        D.t = 0;
      } else if (D.t > 22) {
        D.phase = 'circle';
        D.t = 0;
        D.circleT = 2 + rnd(D) * 2;
      }
      break;
    }
    case 'separate':
      if (D.t > 3.2) {
        D.phase = 'circle';
        D.t = 0;
        D.circleT = 2.5 + rnd(D) * 2.5;
      }
      break;
    case 'grapple': {
      D.gv = Math.max(-7, D.gv - 5 * dt);
      D.g[0] += D.drift[0] * 0.3 * dt;
      D.g[2] += D.drift[2] * 0.3 * dt;
      D.g[1] += D.gv * dt;
      D.spin += D.spinW * dt;
      D.nextBlow -= dt;
      if (D.nextBlow <= 0) {
        D.nextBlow = 0.6 + rnd(D) * 0.35;
        grappleBlow(ai, D);
        for (const x of [A, B]) if (out(x)) return endDuel(ai, D, w, x);
      }
      // they let go before the ground
      const floor = Math.max(groundAt(w, D.g[0], D.g[2], D.g[1]).y, w.sea?.level ?? -Infinity);
      if (D.g[1] - floor < 8 * k || D.t > 4.5) {
        D.phase = 'separate';
        D.t = 0;
        D.grappleCool = 10;
        for (const [d, s] of [[A, 1], [B, -1]]) {
          d.yaw = Math.atan2(Math.cos(D.spin) * s, Math.sin(D.spin) * s); // apart
          d.speed = 9;
          d.vy = 3;
        }
      }
      break;
    }
  }
}

/** One step of the fight for dragon d (ai/dragon.js calls it for state 'fight'). */
export function stepFight(ai, d, w, dt) {
  const D = d.duel;
  if (!D) {
    d.state = 'roam';
    d.airAct = null;
    return;
  }
  // (run by the first dragon; by the other once the first is dead: its AI no longer steps the fight)
  if (d === D.a || D.a.health <= 0) advanceDuel(ai, D, w, dt);
  if (!d.duel) return; // (it ended)
  const foe = d.foe;
  const k = d.k;
  d.jawWant = null;
  d.strikeT = Math.max(0, (d.strikeT ?? 0) - dt);
  d.strike = approach(d.strike ?? 0, d.strikeT > 0 ? 1 : 0, d.strikeT > 0 ? 12 : 4, dt);
  if (d.strikeT > 0.15) d.jawWant = 1;
  d.look = foe.head?.p ?? foe.chest;
  if (d.mode !== 'air') {
    if (!ai.takeoff(d, w, dt)) return;
  }
  const s = d.duelSide;
  const alt = D.c[1] + 20 * k;
  switch (D.phase) {
    case 'circle': {
      // round the duel's middle, on opposite sides, climbing to gain the height
      const a = D.ang + (s > 0 ? 0 : Math.PI) + 0.6;
      const R = 16 * k;
      ai.airMove(d, w, dt, [D.c[0] + Math.cos(a) * R, 0, D.c[2] + Math.sin(a) * R], alt + s * 1.5 * k, 12);
      break;
    }
    case 'joust': {
      // straight at each other (one a little higher), fire as they close
      // (both for the same meeting point between them, then at each other: head on)
      // (first out to a run-up long enough to turn in, then straight at it: it cannot turn tighter than ~15 m)
      const m = D.meet ?? foe.p;
      const dm = Math.hypot(m[0] - d.p[0], m[2] - d.p[2]);
      if (d.joustOut && dm > 26 * k) d.joustOut = false;
      if (d.joustOut) {
        const o = [d.p[0] - m[0], 0, d.p[2] - m[2]].map((v) => (v / Math.max(1e-3, dm)) * 40);
        ai.airMove(d, w, dt, [d.p[0] + o[0], 0, d.p[2] + o[2]], alt, 13);
        break;
      }
      ai.airMove(d, w, dt, dm < 10 * k ? foe.p : m, (foe.p[1] + d.p[1]) / 2 + s * 0.8 * k, 15);
      const dd = dist(d.chest, foe.chest);
      // the other's fire pass coming at it: once a pass, it may twist out of it (a roll, a wing-over, a dive)
      if (foe.joustFired && dd < 15 * k && dd > 5 * k && d.evadeTried !== D.passes && !d.evade) {
        d.evadeTried = D.passes;
        if (rnd(D) < 0.5) {
          const kind = pick(D, [['barrelRoll', 0.4], ['wingOver', 0.3], ['dive', 0.3]]);
          dragonEvade(d, kind, rnd(D) < 0.5 ? 1 : -1, w, 'dragon');
        }
      }
      if (!d.joustFired && dd < 22 * k && dd > 8 * k) {
        d.joustFired = true;
        d.breathLen = 1.1;
        d.lastRoar = -99;
        ai.startBreath(d, foe.chest, 0.3);
      }
      break;
    }
    case 'separate':
      d.breathT = Math.min(d.breathT, 0.2);
      ai.airMove(d, w, dt, [d.p[0] + Math.sin(d.yaw) * 30, 0, d.p[2] + Math.cos(d.yaw) * 30], alt + 2 * k, 13);
      d.look = null;
      break;
    case 'grapple': {
      // chest to chest, talons locked, spinning down
      const r = 1.3 * (d.k + foe.k) * 0.5;
      const ca = Math.cos(D.spin) * s;
      const sa = Math.sin(D.spin) * s;
      d.mode = 'air';
      d.p = [D.g[0] + ca * r, D.g[1], D.g[2] + sa * r];
      d.yaw = Math.atan2(-ca, -sa); // facing the other
      d.speed = 3;
      d.vy = D.gv;
      d.bank = s * (0.5 + 0.3 * Math.sin(D.t * 3));
      d.pitch = approach(d.pitch, 0.7, 4, dt);
      d.flapAmp = approach(d.flapAmp, 1.4, 4, dt);
      d.fold = approach(d.fold, 0, 4, dt);
      d.groundF = approach(d.groundF, 0, 2, dt);
      d.crouch = approach(d.crouch, 0, 3, dt);
      d.breathT = d.windT = 0;
      // at its neck
      const n = foe.spine?.[Math.min(4, (foe.spine?.length ?? 1) - 1)];
      d.look = n ?? foe.chest;
      if (d.strikeT <= 0) d.strike = approach(d.strike, 0.45, 4, dt);
      break;
    }
  }
}

/** The route act 'fight': the nearest other living dragon (within `range` m), or null. */
export function rival(w, d, range = 160) {
  let best = null;
  let bd = range;
  for (const o of w.dragons ?? []) {
    if (o === d || o.health <= 0 || !o.chest || o.duel) continue;
    const x = dist(o.chest, d.chest ?? d.p);
    if (x < bd) {
      bd = x;
      best = o;
    }
  }
  return best;
}

// -----------------------------------------------------------------------------
// the Play buttons (main.js)

/** "Snatch target": the first living dragon that can fly goes for the nearest guard, you, or a loose object (one is put down if there is none). */
export function playSnatch(sim) {
  const ai = sim?.dragonAI;
  const w = sim?.world;
  const d = w?.dragons?.find((x) => x.health > 0 && x.spine && canFly(x) && !x.duel);
  if (!ai || !d) return 'No dragon here that can fly.';
  const from = d.chest;
  let best = null;
  let bd = 90;
  const near = (p) => Math.hypot(p[0] - from[0], p[2] - from[2]);
  for (const e of w.enemies ?? []) {
    if (e.dead || e.held || e.devoured) continue;
    if (near(e.p) < bd) (bd = near(e.p)), (best = { kind: 'enemy', ref: e });
  }
  const pl = sim.ai?.player;
  if (pl && !w.playerHeld && near(pl.p) < bd) (bd = near(pl.p)), (best = { kind: 'player', ref: 'player' });
  for (const o of w.loose ?? []) {
    if (o.held || o.flying || o.burst || !canCarry(d, o.mass)) continue;
    if (near(o.p) < bd) (bd = near(o.p)), (best = { kind: 'object', ref: o });
  }
  if (!best) {
    // nothing about: a gas cylinder on open ground ahead of it
    const f = [Math.sin(d.yaw), 0, Math.cos(d.yaw)];
    const x = clamp(from[0] + f[0] * 18, 4, w.size[0] - 4);
    const z = clamp(from[2] + f[2] * 18, 4, w.size[2] - 4);
    const o = addLoose(w, 'cylinder', [x, groundAt(w, x, z).y + 0.32, z]);
    best = { kind: 'object', ref: o };
  }
  d.timer = Math.max(d.timer ?? 0, 1);
  return startSnatch(ai, d, best, Math.floor(w.time * 1000) + 1) ? `The dragon goes for ${best.kind === 'enemy' ? 'a guard' : best.kind === 'player' ? 'you' : `the ${best.ref.kind}`}.` : 'It cannot lift that.';
}

/** "Dragons fight": the first two living dragons fight (a second one flies in if there is only one). */
export function playFight(sim) {
  const ai = sim?.dragonAI;
  const w = sim?.world;
  if (!ai || !w?.dragons?.length) return 'No dragon here.';
  let alive = w.dragons.filter((x) => x.health > 0 && x.spine && !x.duel);
  if (!alive.length) return 'No dragon here.';
  if (alive.length < 2) {
    const a = alive[0];
    const x = clamp(a.p[0] + 30, 6, w.size[0] - 6);
    const z = clamp(a.p[2] + 10, 6, w.size[2] - 6);
    const b = { p: [x, 0, z], yaw: a.yaw + Math.PI, length: (a.length ?? 9) * 0.92, colours: a.colours === 'koi' ? 'bronze' : 'koi', health: a.maxHealth, startState: 'fly', seed: 2 };
    w.dragons.push(b);
    initDragon(b, w);
    alive = [a, b];
  }
  return startFight(ai, alive[0], alive[1], Math.floor(w.time * 1000) + 11) ? 'The dragons fight.' : 'They will not fight.';
}
