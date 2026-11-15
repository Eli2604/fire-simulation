/**
 * Peeking: a look over a low wall or round a corner from cover, to find an enemy he has lost
 * sight of, exposing as little of himself for as short a time as he can. Pure logic (no three.js),
 * for the squad AI (ai/squad.js: its covering men), the rig (operator/rig.js has the clips:
 * peekWall, leanLeft, leanRight, sliceLeft, sliceRight) and the player (walk/walk.js leans).
 *
 *  - Over a low wall (peekWall): crouched behind it, he rises just enough for his eyes to clear its
 *    top, looks, and drops back.
 *  - Round a corner (leanLeft / leanRight): at the edge of a wall he leans out, head and weapon,
 *    and back. A right-handed shooter leans out to the right more naturally (the rifle at his right
 *    shoulder: less of him shows), so he prefers that side when both are open; to the left he leans
 *    further. With a pistol he leans one-handed, the other hand on the wall.
 *  - Slicing the pie (sliceLeft / sliceRight): room beside the corner, he steps out round it in an
 *    arc, a slice at a time, the muzzle on each new piece of what is round the corner.
 *  - The AI peeks when it is in cover behind a low wall or at a corner and the enemy's last known
 *    place is not in sight. Exposure is limited in time: the more experienced, the shorter (PEEK_T),
 *    and the less predictable (another place, another side, an irregular wait between peeks).
 *  - The eye is where the peek puts it (ai/perception.js eyeOf, from m.peek), so a peek reveals what
 *    is there, and his head shows to the enemy while it lasts (headOf).
 */
import { HANDLING, handKind } from './weapons.js';

/** The clips (s, at speed 1) and what each does to the eye (perception: peek.kind). */
export const PEEK_CLIPS = { peekWall: 2.6, leanLeft: 2.2, leanRight: 2.2, sliceLeft: 2.8, sliceRight: 2.8 };
export const PEEK_KIND = { peekWall: 'over', leanLeft: 'left', leanRight: 'right', sliceLeft: 'sliceLeft', sliceRight: 'sliceRight' };
export const PEEK_LABELS = { peekWall: 'Peek over (low wall)', leanLeft: 'Peek round the corner (left)', leanRight: 'Peek round the corner (right)', sliceLeft: 'Slice the pie (left)', sliceRight: 'Slice the pie (right)' };
/** Exposure (s, the whole peek) by experience, and the wait between peeks: [min, spread]. */
export const PEEK_T = {
  recruit: { dur: 2.6, wait: [3.0, 0.4], vary: 0.2 },
  regular: { dur: 2.0, wait: [2.6, 1.5], vary: 0.5 },
  veteran: { dur: 1.5, wait: [2.0, 3.0], vary: 0.8 },
  elite: { dur: 1.1, wait: [1.6, 4.0], vary: 1.0 },
};
const WALL_LOW = [0.55, 1.35]; // a wall to peek over: its top between these (m above his feet)
const REACH = [0.25, 1.1]; // how far ahead the wall may be (m)

/**
 * What he can do from where he is, facing `to`: { over: { rise } | null, left, right, sliceLeft,
 * sliceRight }. solid(x, y, z): is it solid there (absolute). p: his feet.
 */
export function peekOptions(solid, p, to) {
  const dx = to[0] - p[0], dz = to[2] - p[2], l = Math.hypot(dx, dz) || 1;
  const fx = dx / l, fz = dz / l, rx = -fz, rz = fx;
  const at = (s, h, side = 0) => solid(p[0] + fx * s + rx * side, p[1] + h, p[2] + fz * s + rz * side);
  let over = null, tall = false;
  for (let s = REACH[0]; s <= REACH[1]; s += 0.15) {
    if (!at(s, 0.5)) continue;
    // a wall here: how high
    let top = 0.5;
    while (top < 2.2 && at(s, top + 0.1)) top += 0.1;
    if (top >= WALL_LOW[0] && top <= WALL_LOW[1]) over = { rise: Math.min(1.62, Math.max(1.25, top + 0.25)), at: s };
    else if (top > 1.7) tall = true;
    break;
  }
  if (!over) for (let s = REACH[0]; s <= REACH[1] && !tall; s += 0.15) if (at(s, 1.5)) tall = true;
  // round a corner: the wall ahead, and clear ahead past its edge on that side
  const clearAhead = (side) => {
    for (let s = 0; s <= 1.6; s += 0.2) if (at(s, 1.5, side) || at(s, 1.0, side)) return false;
    return true;
  };
  const side = (sgn) => (tall || over ? clearAhead(0.5 * sgn) : false);
  const slice = (sgn) => (tall ? clearAhead(0.95 * sgn) && !at(0, 1.0, 0.95 * sgn) : false);
  return { over, left: side(-1), right: side(1), sliceLeft: slice(-1), sliceRight: slice(1), tall };
}
/** Right-handed (default) or left-handed (m.hand === 'left'). */
const rightHanded = (m) => m.hand !== 'left';
/**
 * Pick a peek from the options: { clip, kind, dur, rise?, out? } or null. The experienced vary it
 * (not the same place twice running), the others take the natural one.
 */
export function choosePeek(m, opts, rand = Math.random) {
  const T = PEEK_T[m.skill] ?? PEEK_T.regular;
  const cand = [];
  const k = handKind(m);
  const oneHand = (HANDLING[k]?.hands ?? 2) < 2;
  const natural = rightHanded(m) ? 'right' : 'left';
  if (opts.over) cand.push({ clip: 'peekWall', w: 1.2 });
  for (const s of ['left', 'right']) {
    if (opts[s]) cand.push({ clip: s === 'left' ? 'leanLeft' : 'leanRight', w: s === natural || oneHand ? 1 : 0.55 });
    const sl = s === 'left' ? 'sliceLeft' : 'sliceRight';
    if (opts[sl]) cand.push({ clip: sl, w: 0.5 * (s === natural ? 1 : 0.8) });
  }
  if (!cand.length) return null;
  // the less predictable: away from what he did last time
  for (const c of cand) if (c.clip === m.lastPeek) c.w *= 1 - 0.8 * T.vary;
  let sum = cand.reduce((a, c) => a + c.w, 0), r = rand() * sum, pick = cand[0];
  for (const c of cand) {
    r -= c.w;
    if (r <= 0) {
      pick = c;
      break;
    }
  }
  const dur = T.dur * (1 + (rand() - 0.5) * 0.4 * T.vary);
  const kind = PEEK_KIND[pick.clip];
  // the off side leans further out (the weapon's at the other shoulder)
  const out = kind === 'left' || kind === 'right' ? (kind === natural || oneHand ? 0.42 : 0.52) : undefined;
  return { clip: pick.clip, kind, dur, rise: opts.over?.rise, out };
}
/** Start a peek: m.peek for the eye (perception), m.lastPeek, the wait until the next. */
export function startPeek(m, c, now, rand = Math.random) {
  const T = PEEK_T[m.skill] ?? PEEK_T.regular;
  m.peek = { kind: c.kind, t0: now, dur: c.dur, rise: c.rise, out: c.out, now, clip: c.clip };
  m.lastPeek = c.clip;
  m.peekNext = now + c.dur + T.wait[0] + rand() * T.wait[1];
  return m.peek;
}
/** Is a peek under way (and where in it: 0..1)? Clears it once over. */
export function peeking(m, now) {
  const pk = m.peek;
  if (!pk) return false;
  pk.now = now;
  if (now > pk.t0 + pk.dur) {
    m.peek = null;
    return false;
  }
  return true;
}
