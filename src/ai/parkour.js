/**
 * Parkour: getting over, up and down obstacles on foot (vaulting a low wall, jump-climbing or
 * mantling onto higher ground, dropping off a ledge, sliding into cover). Pure logic, no
 * three.js: the squad AI (ai/squad.js) routes and moves its men with it, the player's walk
 * (walk/walk.js) does the same moves on Space, and the operator rig (operator/rig.js) bakes
 * its clips round the very same root paths, so the body and the point that moves (m.p, the
 * figure's root) always agree.
 *
 *  - probe(solid, p, dir): what lies ahead of a man standing at p (feet) looking along dir
 *    (unit [dx, dz] on the ground plan): a raised obstacle (its face distance, height above his
 *    floor, thickness, where he lands beyond it, whether he can stand on top), a drop (its
 *    depth), a wall too high to get over, or nothing (open ground, stairs, a kerb).
 *  - moveFor(geo, ability, mode): which move gets him over it (or null): the thresholds below.
 *  - rootAt(kind, u, geo): where the root is at u (0..1) through the move: [forward, up] from
 *    where it started (metres). The clips put the body round this point.
 *  - ability(m): what a man can do with his wounds and his load (wounded: no climbing, slower
 *    vaults, shorter drops; a heavy load: lower climbs, or none).
 */
import { handKind, allows, paceOf, dropMax } from './weapons.js';

/** Rises he simply steps up (stairs, a kerb) and drops he steps down. */
export const STEP = 0.45;
export const DROP_MIN = 0.6;
/** Obstacle heights (m above his floor) for each kind of move. */
export const LIMITS = {
  stepOver: [0.45, 0.75], // a lazy vault: one hand on it, the legs stepped over
  vault: [0.75, 1.15], // a speed vault (running) or a side vault
  mantle: [0.75, 1.5], // from a standstill: hands on the edge, press up, knee on top
  climb: [1.15, 2.3], // run, jump, a step on the wall, hands on the edge, pull up
  drop: [DROP_MIN, 3.3], // off a ledge; a landing roll from ROLL_FROM
};
export const ROLL_FROM = 2.0;
/** Thicker than this (m, along his way) the top is somewhere to stand, not a wall to vault. */
export const THIN = 0.6;

/**
 * The moves: clip duration (s, at speed 1) and the nominal geometry the clip is made for:
 * pre (m from the start to the obstacle's face), thick (its thickness), post (from its far
 * side, or its edge, to where the move ends), h (height above the floor he starts on; for a drop
 * the depth), drop (for a vault: how much lower he lands than he started).
 */
export const MOVES = {
  vaultStep: { dur: 0.85, geo: { pre: 0.5, thick: 0.3, post: 0.6, h: 0.6, drop: 0 } },
  vaultSpeed: { dur: 0.95, geo: { pre: 0.7, thick: 0.4, post: 0.8, h: 0.9, drop: 0 } },
  vaultSide: { dur: 1.15, geo: { pre: 0.6, thick: 0.4, post: 0.8, h: 0.9, drop: 0 } },
  climbJump: { dur: 1.9, geo: { pre: 0.9, thick: 1, post: 0.5, h: 1.8, drop: 0 } },
  mantle: { dur: 1.7, geo: { pre: 0.3, thick: 1, post: 0.5, h: 1.3, drop: 0 } },
  dropDown: { dur: 0.9, geo: { pre: 0.2, thick: 0, post: 0.6, h: 1.4, drop: 0 } },
  dropRoll: { dur: 1.6, geo: { pre: 0.2, thick: 0, post: 1.8, h: 2.6, drop: 0 } },
  slideCover: { dur: 1.1, geo: { pre: 2.6, thick: 0, post: 0, h: 0, drop: 0 } },
};
export const PARKOUR = Object.fromEntries(Object.keys(MOVES).map((k) => [k, 1]));
/** What kind of obstacle each move is for (the rig's prop). */
export const PROP = { vaultStep: 'wall', vaultSpeed: 'wall', vaultSide: 'wall', climbJump: 'ledge', mantle: 'ledge', dropDown: 'drop', dropRoll: 'drop', slideCover: 'cover' };

/* ---------- root paths ---------- */
/** Monotone cubic through keys [[t, v], ...] (Fritsch-Carlson: smooth, no overshoot). */
export function mono(K, t) {
  const n = K.length;
  if (t <= K[0][0]) return K[0][1];
  if (t >= K[n - 1][0]) return K[n - 1][1];
  let i = 0;
  while (i < n - 2 && t > K[i + 1][0]) i++;
  const sl = (j) => (K[j + 1][1] - K[j][1]) / (K[j + 1][0] - K[j][0] || 1e-9);
  const tan = (j) => {
    if (j <= 0) return 0;
    if (j >= n - 1) return 0;
    const a = sl(j - 1), b = sl(j);
    return a * b <= 0 ? 0 : (2 * a * b) / (a + b);
  };
  const [t0, v0] = K[i], [t1, v1] = K[i + 1], h = t1 - t0 || 1e-9, s = (t - t0) / h;
  const m0 = tan(i) * h, m1 = tan(i + 1) * h;
  const s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * v0 + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * v1 + (s3 - s2) * m1;
}

/**
 * The root's keys for a move over geometry g: [u, forward, up]. The landmarks (the face, the far
 * side, the top) come from g, so the same clip fits any obstacle within the move's range: the
 * body is carried by the root, which goes where this obstacle needs it.
 */
const ROOT = {
  vaultStep: (g) => [[0, 0, 0], [0.24, g.pre - 0.05, 0], [0.53, g.pre + g.thick / 2, g.h], [0.76, g.pre + g.thick + 0.3, -g.drop], [1, g.pre + g.thick + g.post, -g.drop]],
  vaultSpeed: (g) => [[0, 0, 0], [0.23, g.pre - 0.25, 0], [0.44, g.pre + g.thick / 2 + 0.05, g.h], [0.65, g.pre + g.thick + 0.35, -g.drop], [1, g.pre + g.thick + g.post, -g.drop]],
  vaultSide: (g) => [[0, 0, 0], [0.24, g.pre - 0.2, 0], [0.5, g.pre + g.thick / 2, g.h], [0.72, g.pre + g.thick + 0.35, -g.drop], [1, g.pre + g.thick + g.post, -g.drop]],
  climbJump: (g) => [[0, 0, 0], [0.13, g.pre - 0.45, 0], [0.34, g.pre - 0.4, g.h * 0.55], [0.5, g.pre - 0.3, g.h], [0.63, g.pre - 0.15, g.h], [0.79, g.pre + 0.2, g.h], [1, g.pre + g.post, g.h]],
  mantle: (g) => [[0, 0, 0], [0.18, 0, 0], [0.32, g.pre - 0.15, g.h], [0.65, g.pre + 0.1, g.h], [0.8, g.pre + 0.3, g.h], [1, g.pre + g.post, g.h]],
  dropDown: (g) => [[0, 0, 0], [0.22, g.pre, 0], [0.4, g.pre + 0.22, -g.h * 0.3], [0.62, g.pre + 0.4, -g.h], [1, g.pre + g.post, -g.h]],
  dropRoll: (g) => [[0, 0, 0], [0.1, g.pre, 0], [0.22, g.pre + 0.25, -g.h * 0.35], [0.34, g.pre + 0.45, -g.h], [0.62, g.pre + 1.0, -g.h], [0.8, g.pre + 1.5, -g.h], [1, g.pre + g.post, -g.h]],
  slideCover: (g) => [[0, 0, 0], [0.25, g.pre * 0.35, 0], [0.75, g.pre * 0.9, 0], [1, g.pre, 0]],
};
/** The keys themselves (operator/rig.js lines the clip up with them). */
export const rootKeys = (kind, g = MOVES[kind].geo) => ROOT[kind]({ ...MOVES[kind].geo, ...g });

/** Where the root is at u (0..1) through the move over g: [forward, up] (m) from its start. */
export function rootAt(kind, u, g) {
  const K = rootKeys(kind, g);
  return [mono(K.map((k) => [k[0], k[1]]), u), mono(K.map((k) => [k[0], k[2]]), u)];
}
/** How far it goes in all: [forward, up] at the end. */
export const rootEnd = (kind, g) => rootAt(kind, 1, g);

/** How much lower than standing his eyes are through the move (for the player's camera). */
const EYE = {
  vaultStep: [[0, 0], [0.3, 0.15], [0.55, 0.25], [0.8, 0.1], [1, 0]],
  vaultSpeed: [[0, 0], [0.25, 0.25], [0.45, 0.5], [0.7, 0.3], [1, 0]],
  vaultSide: [[0, 0], [0.25, 0.25], [0.5, 0.55], [0.75, 0.3], [1, 0]],
  climbJump: [[0, 0], [0.13, 0.15], [0.34, 0.75], [0.5, 1.15], [0.63, 0.75], [0.79, 0.65], [0.9, 0.3], [1, 0]],
  mantle: [[0, 0], [0.18, 0.2], [0.32, 1.0], [0.5, 0.6], [0.65, 0.6], [0.8, 0.45], [1, 0]],
  dropDown: [[0, 0], [0.22, 0.05], [0.62, 0.7], [0.8, 0.35], [1, 0]],
  dropRoll: [[0, 0], [0.22, 0.05], [0.34, 0.8], [0.5, 1.2], [0.62, 1.2], [0.8, 0.7], [1, 0]],
  slideCover: [[0, 0], [0.25, 0.6], [0.75, 0.85], [1, 0.6]],
};
export const eyeDip = (kind, u) => mono(EYE[kind], u);

/* ---------- what lies ahead ---------- */
const S = 0.05; // the probe's step (m)
/**
 * The surface he would stand on in the column at (x, z) near height y0: up through solid (to
 * its top; Infinity if it goes on more than `up` m), or down through air (to the next solid;
 * -Infinity if more than `down` m).
 */
export function surface(solid, x, z, y0, up = 2.6, down = 3.6) {
  let y = y0;
  if (solid(x, y + S / 2, z)) {
    while (solid(x, y + S / 2, z)) {
      y += S;
      if (y - y0 > up) return Infinity;
    }
    return y;
  }
  while (!solid(x, y - S / 2, z)) {
    y -= S;
    if (y0 - y > down) return -Infinity;
  }
  return y;
}
/** Free air from y + from to y + to (m) at (x, z)? */
export function clear(solid, x, z, y, from = 0.1, to = 1.7) {
  if (!Number.isFinite(y)) return false; // (no surface there: a drop with no floor, say an open hatch into space)
  for (let a = y + from; a <= y + to; a += 0.2) if (solid(x, a, z)) return false;
  return true;
}

/**
 * What is ahead of p (feet: [x, y, z]) along dir ([dx, dz], unit), within `range` m:
 *   { type: 'up', face, h, thick, thin, land, top, standable, over }   a raised obstacle
 *   { type: 'down', face, h, room }                                    a drop of h m
 *   { type: 'wall', face }                                             too high to get over
 *   null                                                               open ground, a step, stairs
 * face: m from p to it; h: above his floor (a drop: its depth); thin: a wall to vault (not a top
 * to stand on); land: for a thin one, the floor beyond it relative to his (negative: lower);
 * standable: room to stand up on top; over: room above it to vault through.
 */
export function probe(solid, p, dir, { range = 1.6 } = {}) {
  const [x0, y0, z0] = p, [dx, dz] = dir;
  let base = y0;
  const at = (s) => [x0 + dx * s, z0 + dz * s];
  for (let s = 0.1; s <= range + 1e-6; s += S) {
    const [x, z] = at(s);
    const g = surface(solid, x, z, base);
    const d = g - base;
    if (d > STEP) {
      if (g === Infinity) return { type: 'wall', face: s };
      // how far the raised part goes along his way (up to 1.2 m), and its top
      let top = g, e = s;
      for (; e <= s + 1.2 + 1e-6; e += S) {
        const [xe, ze] = at(e);
        const t = surface(solid, xe, ze, base);
        if (t - base <= STEP) break;
        if (t === Infinity) return { type: 'wall', face: s };
        top = Math.max(top, t);
      }
      const thick = e - s, h = top - base;
      const thin = thick < THIN;
      const [xm, zm] = at(s + Math.min(thick, 0.6) / 2);
      const over = clear(solid, xm, zm, top, 0.15, 1.1);
      let land = 0, standable = false;
      if (thin) {
        const [xl, zl] = at(e + 0.25);
        const f = surface(solid, xl, zl, top);
        land = f === -Infinity ? -Infinity : f - base;
      } else {
        const [xt, zt] = at(s + 0.5);
        standable = clear(solid, xt, zt, surface(solid, xt, zt, top), 0.1, 1.75);
      }
      return { type: 'up', face: s, h, thick, thin, land, top, standable, over, base };
    }
    if (d < -DROP_MIN) {
      const [xl, zl] = at(s + 0.4);
      const f = surface(solid, xl, zl, base);
      const room = f > -Infinity && clear(solid, xl, zl, f, 0.1, 1.75);
      return { type: 'down', face: s, h: base - Math.max(g, f), room, base };
    }
    // a small step (stairs, a kerb, a slope): walked; carry on from its height
    if (Math.abs(d) > 0.02) base = g;
  }
  return null;
}

/**
 * What a man can do: m.wounds (legL / legR), m.health, m.bleed, m.crawling; m.carry (kg of
 * kit; default by role: the gunner's MG and ammunition is the heaviest); the weapon in his hands
 * (ai/weapons.js handKind: m.handling, m.weapon, m.primary, m.loadout): what it allows (no jump
 * climb with a machine gun or the flame gun's tanks, slower vaults, no speed vault, shorter drops).
 */
export function ability(m = {}) {
  if (m.crawling || m.dead) return { none: true };
  const legs = (m.wounds?.legL ?? 0) + (m.wounds?.legR ?? 0);
  const wounded = legs > 0 || (m.health ?? 100) < 45 || (m.bleed ?? 0) > 2.5;
  const carry = m.carry ?? (m.squad === 'MG' ? 30 : m.squad === 'UAV' ? 27 : 22);
  const wk = handKind(m);
  const no = {};
  for (const k of ['vaultSpeed', 'vaultSide', 'vaultStep', 'slideCover']) if (!allows(wk, k)) no[k] = true;
  return {
    wounded,
    carry,
    weapon: wk,
    // wounded: no climbing at all; loaded: the jump climb only so high, very heavy none
    climb: wounded || carry > 38 || !allows(wk, 'climbJump') ? 0 : carry > 28 ? 1.9 : LIMITS.climb[1],
    mantle: !wounded && carry <= 38 && allows(wk, 'mantle'),
    vaultK: (wounded ? 1.6 : carry > 28 ? 1.1 : 1) * paceOf(wk, 'vaultSide'), // how much slower his vaults are
    mantleK: paceOf(wk, 'mantle'),
    climbK: paceOf(wk, 'climbJump'),
    drop: Math.min(wounded ? 1.5 : LIMITS.drop[1], dropMax(wk)),
    roll: !wounded && allows(wk, 'dropRoll'),
    no, // moves the weapon rules out
  };
}

/**
 * The move that gets him over geo (from probe) with ability a (from ability()), moving as `mode`
 * ('run' | 'walk' | 'aimWalk'): a key of MOVES, or null (no move: walk it, or go round).
 */
export function moveFor(geo, a = ability(), mode = 'run') {
  if (!geo || a.none) return null;
  if (geo.type === 'down') {
    if (!geo.room || geo.h < DROP_MIN || geo.h > Math.min(a.drop, LIMITS.drop[1])) return null;
    return geo.h >= ROLL_FROM && a.roll ? 'dropRoll' : geo.h >= ROLL_FROM ? null : 'dropDown';
  }
  if (geo.type !== 'up') return null;
  const h = geo.h;
  if (geo.thin) {
    if (!geo.over || !(geo.land >= -1.6 && geo.land <= STEP) || h > LIMITS.vault[1]) return null;
    const no = a.no ?? {};
    if (h < LIMITS.stepOver[1]) return no.vaultStep ? null : 'vaultStep';
    // (the weapon may rule the speed vault out: then the side vault, slower)
    const k = mode === 'run' && !a.wounded && !no.vaultSpeed ? 'vaultSpeed' : 'vaultSide';
    return no[k] ? null : k;
  }
  if (!geo.standable || h < LIMITS.mantle[0]) return null;
  if (h <= LIMITS.mantle[1] && a.mantle && (mode !== 'run' || h <= LIMITS.vault[1] || h > a.climb)) return 'mantle';
  if (h >= LIMITS.climb[0] && h <= Math.min(a.climb, LIMITS.climb[1])) return 'climbJump';
  return null;
}

/** The geometry a move goes by, from what the probe found (pre: from where he is now). */
export function geoFor(kind, geo) {
  const n = MOVES[kind].geo;
  if (kind === 'slideCover') return { ...n, pre: geo.d ?? n.pre };
  if (geo.type === 'down') return { ...n, pre: Math.max(0.05, geo.face), h: geo.h };
  if (geo.thin) return { ...n, pre: geo.face, thick: geo.thick, h: geo.h, drop: -Math.min(STEP, geo.land) };
  return { ...n, pre: geo.face, h: geo.h };
}
/** How long it takes (s) for a man of ability a. */
export const durFor = (kind, a = ability()) => MOVES[kind].dur * (kind.startsWith('vault') ? a.vaultK ?? 1 : kind === 'mantle' ? a.mantleK ?? 1 : kind === 'climbJump' ? a.climbK ?? 1 : 1);
/** Where it ends: [forward, up] from the start. */
export const endOf = (kind, g) => rootEnd(kind, g);
/**
 * Its cost for route planning, in metres of running (the whole link, the ground it covers
 * included): the time it takes at a run (3.4 m/s), plus a little for the effort.
 */
export function costOf(kind, g, a) {
  return durFor(kind, a) * 3.4 + 0.5;
}
