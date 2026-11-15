import { groundAt } from './dragon.js';

/**
 * The dragon getting out of the way (on top of ai/dragon.js, which moves and poses it; this only
 * bends its flight for a moment): rockets, arrows, a jet's attack, another dragon's fire pass.
 *
 *  - In the air: a barrel roll (a full roll about its length, slipping sideways), a wing-over (a
 *    sharp climbing turn that reverses through ~130 degrees, banked steeply), a dive (down steeply,
 *    gathering speed, levelling out above the ground) or folding the wings to drop like a stone
 *    (then opening them again). On the ground: a hop aside.
 *  - Evading, it is harder to hit: an arrow or a rocket at it, or a bullet, hits with the chance
 *    hitFactor(d) leaves (DRAGON_EVADES[kind].hit, eased in over the first moment), drawn from its
 *    own seeded numbers (d.evRng); in a fight with another dragon, the blow of a pass lands with
 *    that chance (ai/dragonAir.js pass).
 *  - sense(ai, d, w): what is coming at it (projectiles in the world, the rockets of a jet flight,
 *    a jet running in on it) and whether to evade (not always: an alert dragon mostly does).
 *
 * All state is plain data on the dragon: d.evade { kind, t, dur, side, ... }, d.evRng { seed }.
 */
export const DRAGON_EVADES = {
  barrelRoll: { label: 'Barrel roll', dur: 1.7, hit: 0.35, air: true },
  wingOver: { label: 'Wing-over', dur: 2.2, hit: 0.45, air: true },
  dive: { label: 'Dive', dur: 2.0, hit: 0.4, air: true },
  foldDrop: { label: 'Folded wings: drop', dur: 1.1, hit: 0.35, air: true },
  sideStep: { label: 'Hop aside', dur: 0.9, hit: 0.4, air: false },
};
const TAU = Math.PI * 2;
const G = 9.81;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const approach = (v, t, rate, dt) => v + (t - v) * Math.min(1, rate * dt);
const sm = (u) => {
  u = clamp(u, 0, 1);
  return u * u * (3 - 2 * u);
};

/** Its own seeded random number in [0, 1) (xorshift32 on d.evRng.seed). */
export function evRand(d) {
  const o = (d.evRng ??= { seed: (((d.seed ?? 7) * 2654435761) >>> 0) || 99991 });
  let x = o.seed >>> 0 || 0x9e3779b9;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  o.seed = x >>> 0;
  return o.seed / 4294967296;
}

/**
 * Start an evasion: side 1 towards (cos yaw, −sin yaw) from its heading (the way a positive bank leans
 * it and a rising yaw turns it), -1 the other way. Returns d.evade (null: not the place for it).
 */
export function startEvade(d, kind, side = 1, w = null, why = null) {
  const E = DRAGON_EVADES[kind];
  if (!E || d.health <= 0 || (E.air && d.mode !== 'air') || (!E.air && d.mode !== 'ground')) return null;
  d.evade = { kind, t: 0, dur: E.dur * (kind === 'dive' || kind === 'foldDrop' ? 1 : 1), side, yaw0: d.yaw, bank0: d.bank ?? 0, why, alt0: d.p[1] };
  d.evadeCool = E.dur + 1.5;
  d.evades = (d.evades ?? 0) + 1;
  if (w) w.events.push({ type: 'dragonEvade', pos: (d.chest ?? d.p).slice(), time: w.time, name: `the dragon (${E.label.toLowerCase()})` });
  return d.evade;
}

/** The chance that something aimed at it hits now: 1, less while it evades. */
export function hitFactor(d) {
  const E = d.evade;
  if (!E) return 1;
  return 1 - (1 - DRAGON_EVADES[E.kind].hit) * Math.min(1, E.t / 0.3);
}
/** Does this one hit (its own seeded numbers)? */
export function evadeRollHit(d) {
  return !d.evade || evRand(d) < hitFactor(d);
}

/**
 * One step of the evasion, after its behaviour has flown it this step (so this bends that):
 * bank, heading, climb or sink, the wings. At the end its flight is its behaviour's again.
 */
export function stepEvade(d, w, dt) {
  const E = d.evade;
  d.evadeCool = Math.max(0, (d.evadeCool ?? 0) - dt);
  if (!E) return;
  if (d.health <= 0 || d.mode === 'falling' || d.duel?.phase === 'grapple' || (DRAGON_EVADES[E.kind].air && d.mode !== 'air')) {
    endEvade(d);
    return;
  }
  const k = d.k ?? 1;
  E.t += dt;
  const u = E.t / E.dur;
  const s = E.side;
  const R = [Math.cos(d.yaw), 0, -Math.sin(d.yaw)]; // side +1 (forward is sin yaw, cos yaw)
  const floor = Math.max(groundAt(w, d.p[0], d.p[2], d.p[1] + 1).y, w.sea?.level ?? -Infinity);
  const clearance = d.p[1] - floor;
  switch (E.kind) {
    case 'barrelRoll': {
      // a full roll about its length, slipping a body-length sideways as it goes round
      d.bank = E.bank0 + s * TAU * sm(u);
      const slip = 5 * k * Math.sin(Math.PI * clamp(u, 0, 1)) * (Math.PI / E.dur);
      d.p[0] += R[0] * s * slip * dt * 0.5;
      d.p[2] += R[2] * s * slip * dt * 0.5;
      d.flapAmp = approach(d.flapAmp, 0.3, 4, dt);
      break;
    }
    case 'wingOver': {
      // up and over to one side: steep bank, heading round through ~130 degrees, then down out of it
      d.bank = s * 1.35 * Math.sin(Math.PI * clamp(u, 0, 1));
      d.yaw = E.yaw0 + s * 2.3 * sm(u);
      d.vy = (u < 0.5 ? 5 : -5) * Math.sqrt(k);
      d.p[1] += d.vy * dt * 0.6;
      d.pitch = approach(d.pitch ?? 0, u < 0.5 ? 0.5 : -0.4, 5, dt);
      d.flapAmp = approach(d.flapAmp, u < 0.4 ? 1.2 : 0.2, 4, dt);
      break;
    }
    case 'dive': {
      // down hard (wings half in), then level out above the ground
      const out = clearance < 3 * k || u > 0.7;
      d.vy = approach(d.vy ?? 0, out ? 1 : -10 * Math.sqrt(k), out ? 4 : 6, dt);
      d.p[1] += d.vy * dt * 0.5;
      d.speed = Math.min(20, d.speed + 6 * dt);
      d.pitch = approach(d.pitch ?? 0, out ? 0.1 : -0.75, 5, dt);
      d.fold = approach(d.fold ?? 0, out ? 0 : 0.45, 5, dt);
      d.bank = approach(d.bank, s * 0.4, 3, dt);
      d.flapAmp = approach(d.flapAmp, out ? 1.2 : 0.05, 4, dt);
      break;
    }
    case 'foldDrop': {
      // the wings folded in: it drops like a stone, then they open with a crack
      const open = u > 0.65 || clearance < 3 * k;
      d.fold = approach(d.fold ?? 0, open ? 0 : 1, open ? 6 : 8, dt);
      d.vy = open ? approach(d.vy ?? 0, 0.5, 5, dt) : (d.vy ?? 0) - G * dt * 1.4;
      d.p[1] += d.vy * dt * 0.5;
      d.flapAmp = approach(d.flapAmp, open ? 1.4 : 0, 6, dt);
      d.pitch = approach(d.pitch ?? 0, open ? 0 : -0.3, 4, dt);
      break;
    }
    case 'sideStep': {
      // a hop to one side on all fours: crouch, spring, land
      const v = (2.6 * k * Math.PI * Math.sin(Math.PI * clamp(u, 0, 1))) / (2 * E.dur);
      d.p[0] += R[0] * s * v * dt;
      d.p[2] += R[2] * s * v * dt;
      d.crouch = approach(d.crouch ?? 0, u < 0.25 || u > 0.8 ? 0.7 : 0, 8, dt);
      break;
    }
  }
  // (never through the ground)
  if (d.mode === 'air' && d.p[1] < floor + 1.2 * k) {
    d.p[1] = floor + 1.2 * k;
    d.vy = Math.max(d.vy ?? 0, 0);
  }
  if (E.t >= E.dur) endEvade(d);
}

/** Over: a full roll leaves the bank one turn round, taken off it and its trail together (the same attitude). */
export function endEvade(d) {
  const E = d.evade;
  if (!E) return;
  d.evade = null;
  d.lastEvade = E.kind;
  const turns = Math.round((d.bank ?? 0) / TAU);
  if (turns) {
    d.bank -= turns * TAU;
    for (const p of d.trail ?? []) if (p) p[3] -= turns * TAU;
  }
}

/** Which way out of a threat coming from p along v: the kind, and the side away from its line. */
export function pickEvade(d, t, rand = () => evRand(d)) {
  if (d.mode === 'ground') return { kind: 'sideStep', side: sideOf(d, t) };
  const floor = 0;
  void floor;
  const from = t.p;
  const above = from[1] - (d.chest ?? d.p)[1] > 4 * (d.k ?? 1);
  const r = rand();
  const kind = above ? (r < 0.5 ? 'dive' : 'foldDrop') : r < 0.45 ? 'barrelRoll' : r < 0.8 ? 'wingOver' : 'dive';
  return { kind, side: sideOf(d, t) };
}
/** The side (as startEvade's) away from the threat's line. */
function sideOf(d, t) {
  const c = d.chest ?? d.p;
  const R = [Math.cos(d.yaw), -Math.sin(d.yaw)];
  const v = t.v ?? [c[0] - t.p[0], 0, c[2] - t.p[2]];
  // where it will pass: the side of its line the dragon is on; away from that line
  const rel = [c[0] - t.p[0], c[2] - t.p[2]];
  const cr = rel[0] * v[2] - rel[1] * v[0];
  const nrm = [v[2], -v[0]];
  const awayX = cr >= 0 ? nrm : [-nrm[0], -nrm[1]];
  return awayX[0] * R[0] + awayX[1] * R[1] >= 0 ? 1 : -1;
}

/**
 * What is coming at dragon d in world w: arrows and rockets in the air (w.projectiles) and a jet
 * flight's rockets (w.flights) that pass within a few metres of its chest in the next 1.6 s, or a
 * flight's jet running in on it, nose on. The most urgent, or null.
 */
export function incoming(d, w) {
  const c = d.chest ?? d.p;
  const k = d.k ?? 1;
  let best = null;
  const consider = (p, v, kind) => {
    const vv = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
    if (vv < 4) return;
    const r = [c[0] - p[0], c[1] - p[1], c[2] - p[2]];
    const tc = (r[0] * v[0] + r[1] * v[1] + r[2] * v[2]) / vv;
    if (tc < 0.05 || tc > 1.6) return;
    const miss = Math.hypot(r[0] - v[0] * tc, r[1] - v[1] * tc, r[2] - v[2] * tc);
    if (miss > 4.5 * k) return;
    if (!best || tc < best.tc) best = { kind, p: p.slice(), v: v.slice(), tc };
  };
  for (const g of w.projectiles ?? []) if ((g.type === 'arrow' || g.type === 'rocket') && !g.resting && !g.dodged?.includes(d)) consider(g.p, g.v, g.type);
  for (const f of w.flights ?? []) {
    for (const r of f.ai?.rockets ?? []) consider(r.p, r.v, 'rocket');
    for (const m of f.ai?.members ?? []) {
      if (!m.alive) continue;
      const v = [Math.cos(m.h) * Math.cos(m.gamma) * m.v, Math.sin(m.gamma) * m.v, -Math.sin(m.h) * Math.cos(m.gamma) * m.v];
      const r = [c[0] - m.p[0], c[1] - m.p[1], c[2] - m.p[2]];
      const dd = Math.hypot(...r);
      if (dd > 250 || dd < 1) continue;
      const cs = (r[0] * v[0] + r[1] * v[1] + r[2] * v[2]) / (dd * (m.v || 1));
      if (cs > 0.97 && dd / Math.max(1, m.v) < 3 && !best) best = { kind: 'jet', p: m.p.slice(), v, tc: dd / m.v };
    }
  }
  return best;
}

/** Each step (ai/dragon.js): something coming at it, and it is free to: evade (mostly). */
export function sense(d, w) {
  if (d.evade || (d.evadeCool ?? 0) > 0 || d.health <= 0 || d.held || d.mode === 'falling' || d.duel?.phase === 'grapple') return null;
  if (d.mode !== 'air' && d.mode !== 'ground') return null;
  // (dozing in its lair, not yet roused: it does not see it coming)
  if (d.state === 'rest' && !(d.anger > 0)) return null;
  const t = incoming(d, w);
  if (!t) return null;
  // (seen once: an arrow it lets come is not looked at again)
  d.evadeCool = 0.4;
  if (evRand(d) > (d.evadeChance ?? 0.8)) return null;
  const pick = pickEvade(d, t);
  return startEvade(d, pick.kind, pick.side, w, t.kind);
}
