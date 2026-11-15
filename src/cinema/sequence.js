/**
 * The movie of a place (its shot list), without three.js (test/cinema.test.js).
 *
 *  movie: { shots: [{ camera (its name), dur (s), from (s into the camera's own move: its keys,
 *           its orbit...; 0), transition ('cut' | 'dissolve' | 'fade'), tdur (s) }],
 *           fadeIn (s), fadeOut (s), simSpeed (the simulation's time scale while it plays; 1:
 *           real time), restart (the scene from its start when it begins) }
 *
 * Shots follow each other; a shot's transition is how it comes in: a cut, a dissolve (the last
 * picture of the shot before fading into this one) or a fade through black (the shot before
 * fading out over the first half of tdur, this one in over the second).
 */

export const TRANSITIONS = ['cut', 'dissolve', 'fade'];

export function defaultMovie() {
  return { shots: [], fadeIn: 0.5, fadeOut: 1, simSpeed: 1, restart: true };
}

/** How long the movie runs (s). */
export function movieDuration(movie) {
  return (movie?.shots ?? []).reduce((s, sh) => s + Math.max(0, sh.dur ?? 0), 0);
}

/** Where each shot starts and ends: [{ start, end }]. */
export function shotTimes(movie) {
  let t = 0;
  return (movie?.shots ?? []).map((sh) => {
    const start = t;
    t += Math.max(0, sh.dur ?? 0);
    return { start, end: t };
  });
}

/**
 * The movie at time t: { index (-1: none / over), shot, local (time in the camera's move),
 * start, end, dissolve (weight of the last picture of the shot before, 0..1), black (0..1: the
 * fades), done (past the end) }.
 */
export function shotAt(movie, t) {
  const shots = movie?.shots ?? [];
  const times = shotTimes(movie);
  const total = times.length ? times[times.length - 1].end : 0;
  const none = { index: -1, shot: null, local: 0, start: 0, end: 0, dissolve: 0, black: 1, done: t >= total };
  if (!shots.length || t < 0) return none;
  if (t >= total) return { ...none, done: true };
  let i = 0;
  while (i < shots.length - 1 && t >= times[i].end) i++;
  const sh = shots[i];
  const { start, end } = times[i];
  const into = t - start;
  const tdur = Math.max(0, sh.tdur ?? 0.6);
  let dissolve = 0, black = 0;
  if (i > 0 && sh.transition === 'dissolve' && tdur > 0 && into < tdur) dissolve = 1 - into / tdur;
  if (i > 0 && sh.transition === 'fade' && tdur > 0 && into < tdur / 2) black = Math.max(black, 1 - into / (tdur / 2));
  const next = shots[i + 1];
  const ntd = Math.max(0, next?.tdur ?? 0.6);
  if (next?.transition === 'fade' && ntd > 0 && end - t < ntd / 2) black = Math.max(black, 1 - (end - t) / (ntd / 2));
  // the movie's own fade in and out
  const fi = movie.fadeIn ?? 0, fo = movie.fadeOut ?? 0;
  if (fi > 0 && t < fi) black = Math.max(black, 1 - t / fi);
  if (fo > 0 && total - t < fo) black = Math.max(black, 1 - (total - t) / fo);
  return { index: i, shot: sh, local: (sh.from ?? 0) + into, start, end, dissolve, black: Math.min(1, black), done: false };
}

/** A new shot for a camera, as long as its move (or 4 s). */
export function newShot(camera, dur = 4) {
  return { camera, dur: Math.max(0.5, Math.round(dur * 10) / 10), from: 0, transition: 'cut', tdur: 0.6 };
}

/** A name not yet used among names: base, base 2, base 3… */
export function uniqueName(base, names) {
  const used = new Set(names);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** A new camera's name: Cam A, Cam B, … Cam Z, then Cam 27, Cam 28… (not among names). */
export function nextCameraName(names) {
  const used = new Set(names);
  for (let i = 0; i < 26; i++) {
    const n = `Cam ${String.fromCharCode(65 + i)}`;
    if (!used.has(n)) return n;
  }
  let k = 27;
  while (used.has(`Cam ${k}`)) k++;
  return `Cam ${k}`;
}
