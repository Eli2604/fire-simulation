/**
 * The movie of a place as a timeline of camera clips, without three.js (test/cinemaTimeline.test.js).
 *
 *  place.movie: { version: 2, active (the sequence that plays), sequences: [{ name,
 *    clips: [{ camera (its name), start (s of movie time), dur (s), from (s into the camera's
 *    own move), transition ('cut' | 'dissolve' | 'fade': how it comes in), tdur (s) }],
 *    clock ('movie': the clips' times are seconds of the movie as it plays; 'sim': seconds of the
 *    simulation, which runs simSpeed times as fast, so a clip at 10 s of simulation time comes
 *    in at 10 / simSpeed s of movie time), simSpeed, fadeIn, fadeOut, restart }] }
 *
 * Clips lie on one track, sorted by their start, never on top of each other (a clip put down,
 * moved or trimmed goes into the nearest gap it fits): the camera cuts at a clip's start, a
 * gap between clips is black. A clip's transition is how it comes in: a dissolve from the clip
 * before it (when that one ends where it starts), a fade through black (the clip before, or the
 * gap, fading out over the first half of tdur, this one in over the second).
 *
 * The movie of the first film cameras (sequence.js: { shots: [...] } in turn) is migrated:
 * migrateMovie puts its shots one after the other in a sequence named 'Main'.
 */
import { TRANSITIONS, shotTimes, uniqueName } from './sequence.js';

export { TRANSITIONS };
export const CLOCKS = ['movie', 'sim'];
export const MIN_CLIP = 0.2;
const EPS = 1e-3;
const r3 = (v) => Math.round(v * 1000) / 1000;

export function newSequence(name = 'Main') {
  return { name, clips: [], clock: 'movie', simSpeed: 1, fadeIn: 0.5, fadeOut: 1, restart: true };
}

/** A new clip of a camera. */
export function newClip(camera, start = 0, dur = 4) {
  return { camera, start: r3(Math.max(0, start)), dur: r3(Math.max(MIN_CLIP, dur)), from: 0, transition: 'cut', tdur: 0.6 };
}

/**
 * A place's movie as a timeline (a new object; the old shot list migrated, a timeline as it is,
 * nothing: one empty sequence). The fields of the old movie (its speed, fades, restart) go to
 * its sequence.
 */
export function migrateMovie(movie) {
  if (movie && Array.isArray(movie.sequences)) {
    const sequences = movie.sequences.length ? movie.sequences.map((s, i) => normalizeSequence(s, `Sequence ${i + 1}`)) : [newSequence()];
    return { version: 2, active: Math.max(0, Math.min(sequences.length - 1, movie.active ?? 0)), sequences };
  }
  const seq = newSequence('Main');
  if (movie && typeof movie === 'object') {
    for (const k of ['simSpeed', 'fadeIn', 'fadeOut', 'restart']) if (movie[k] !== undefined) seq[k] = movie[k];
    const times = shotTimes(movie);
    seq.clips = (movie.shots ?? []).map((sh, i) => ({ camera: sh.camera, start: r3(times[i].start), dur: r3(Math.max(MIN_CLIP, sh.dur ?? 4)), from: sh.from ?? 0, transition: sh.transition ?? 'cut', tdur: sh.tdur ?? 0.6 })).filter((c) => c.dur > 0);
  }
  return { version: 2, active: 0, sequences: [seq] };
}

/** A sequence with every field, its clips sorted (in place). */
export function normalizeSequence(seq, name = 'Main') {
  const d = newSequence(seq?.name ?? name);
  const s = Object.assign(seq ?? {}, { ...d, ...(seq ?? {}) });
  s.clips = (s.clips ?? []).filter((c) => c && c.camera != null);
  for (const c of s.clips) {
    c.start = Math.max(0, +c.start || 0);
    c.dur = Math.max(MIN_CLIP, +c.dur || 0);
    c.from ??= 0;
    c.transition ??= 'cut';
    c.tdur ??= 0.6;
  }
  sortClips(s);
  return s;
}

export function sortClips(seq) {
  seq.clips.sort((a, b) => a.start - b.start);
  return seq.clips;
}

export const clipEnd = (c) => c.start + c.dur;

/** How long a sequence runs (s of movie time): to the end of its last clip. */
export function sequenceDuration(seq) {
  return (seq?.clips ?? []).reduce((m, c) => Math.max(m, clipEnd(c)), 0);
}

/** Movie time to simulation time and back (the sequence's simSpeed). */
export const toSim = (seq, t) => t * (seq?.simSpeed ?? 1);
export const fromSim = (seq, s) => s / Math.max(1e-6, seq?.simSpeed ?? 1);

/** The movie time of a sequence's clock reading (seconds of movie, or of simulation). */
export function clockToMovie(seq, v) {
  return seq?.clock === 'sim' ? fromSim(seq, v) : v;
}

/* ---------------- snapping ---------------- */
/** The times a clip snaps to: 0, the other clips' edges, extra (the playhead). */
export function snapTargets(seq, except = null, extra = []) {
  const out = [0, ...extra];
  for (const c of seq?.clips ?? []) if (c !== except) out.push(c.start, clipEnd(c));
  return out;
}

/**
 * t snapped: to the nearest target within threshold, else to the grid (s; 0: none).
 * Returns { t, to (the target snapped to, or null) }.
 */
export function snapTime(t, targets = [], threshold = 0.2, grid = 0) {
  let best = null, bd = threshold;
  for (const q of targets) {
    const d = Math.abs(q - t);
    if (d <= bd) (bd = d), (best = q);
  }
  if (best !== null) return { t: best, to: best };
  if (grid > 0) return { t: r3(Math.round(t / grid) * grid), to: null };
  return { t, to: null };
}

/** The gaps between clips (but `except`): [[from, to]], the last one open (to Infinity). */
export function gaps(seq, except = null) {
  const cs = (seq?.clips ?? []).filter((c) => c !== except).sort((a, b) => a.start - b.start);
  const out = [];
  let t = 0;
  for (const c of cs) {
    if (c.start > t + EPS) out.push([t, c.start]);
    t = Math.max(t, clipEnd(c));
  }
  out.push([t, Infinity]);
  return out;
}

/** The start nearest `start` where a clip of dur fits between the others (but `except`). */
export function fitStart(seq, start, dur, except = null) {
  let best = null;
  for (const [a, b] of gaps(seq, except)) {
    if (b - a < dur - EPS) continue;
    const s = Math.min(Math.max(start, a), b - dur);
    if (best === null || Math.abs(s - start) < Math.abs(best - start)) best = s;
  }
  return r3(Math.max(0, best ?? 0));
}

/**
 * A clip of a camera put down at start (snapped, then into the nearest gap it fits): the clip.
 *  opts: { snap (true), threshold (s), grid (s), playhead }
 */
export function addClip(seq, camera, start, dur = 4, opts = {}) {
  const c = newClip(camera, 0, dur);
  let s = Math.max(0, start);
  if (opts.snap !== false) s = snapEdges(seq, c, s, opts);
  c.start = fitStart(seq, s, c.dur);
  seq.clips.push(c);
  sortClips(seq);
  return c;
}

/** A clip's start snapped by either of its edges to the targets (or the grid). */
function snapEdges(seq, clip, start, { threshold = 0.2, grid = 0, playhead = null } = {}) {
  const targets = snapTargets(seq, clip, playhead != null ? [playhead] : []);
  const a = snapTime(start, targets, threshold, 0);
  const b = snapTime(start + clip.dur, targets, threshold, 0);
  if (a.to !== null && (b.to === null || Math.abs(a.t - start) <= Math.abs(b.t - start - clip.dur))) return a.t;
  if (b.to !== null) return b.t - clip.dur;
  return grid > 0 ? snapTime(start, [], 0, grid).t : start;
}

/** A clip moved to start (snapped by its edges, then into the nearest gap it fits): the clip. */
export function moveClip(seq, clip, start, opts = {}) {
  let s = Math.max(0, start);
  if (opts.snap !== false) s = snapEdges(seq, clip, s, opts);
  clip.start = fitStart(seq, s, clip.dur, clip);
  sortClips(seq);
  return clip;
}

/**
 * A clip trimmed: its start ('start': its content stays where it was, so `from` changes with
 * it, not below 0: earlier than that the move starts later) or its end ('end') to time t, snapped, never over its neighbours nor
 * shorter than MIN_CLIP.
 */
export function trimClip(seq, clip, edge, t, opts = {}) {
  const { snap = true, threshold = 0.2, grid = 0, playhead = null } = opts;
  if (snap) t = snapTime(t, snapTargets(seq, clip, playhead != null ? [playhead] : []), threshold, grid).t;
  const others = seq.clips.filter((c) => c !== clip);
  const end = clipEnd(clip);
  if (edge === 'end') {
    const next = others.filter((c) => c.start >= clip.start + EPS).reduce((m, c) => Math.min(m, c.start), Infinity);
    clip.dur = r3(Math.min(Math.max(t, clip.start + MIN_CLIP), next) - clip.start);
  } else {
    const prev = others.filter((c) => c.start < clip.start - EPS || clipEnd(c) <= clip.start + EPS).reduce((m, c) => Math.max(m, clipEnd(c)), 0);
    // (the content stays: from moves with the start, down to the start of the camera's move)
    const s = Math.min(Math.max(t, prev), end - MIN_CLIP);
    clip.from = r3(Math.max(0, (clip.from ?? 0) + (s - clip.start)));
    clip.start = r3(s);
    clip.dur = r3(end - s);
  }
  sortClips(seq);
  return clip;
}

/** A clip cut in two at t (inside it): the second half (its from follows on). */
export function splitClip(seq, clip, t) {
  if (t <= clip.start + MIN_CLIP || t >= clipEnd(clip) - MIN_CLIP) return null;
  const b = { ...clip, start: r3(t), dur: r3(clipEnd(clip) - t), from: r3((clip.from ?? 0) + (t - clip.start)), transition: 'cut' };
  clip.dur = r3(t - clip.start);
  seq.clips.push(b);
  sortClips(seq);
  return b;
}

/** A clip's start set exactly (the list view): into the nearest gap it fits, no snapping. */
export function setClipStart(seq, clip, start) {
  return moveClip(seq, clip, start, { snap: false });
}
/** A clip's length set exactly (the list view): up to the next clip. */
export function setClipDur(seq, clip, dur) {
  return trimClip(seq, clip, 'end', clip.start + Math.max(MIN_CLIP, dur), { snap: false });
}

/**
 * The sequence at movie time t: { index (-1: no clip there), clip, local (time in the camera's
 * move), start, end, dissolve (weight of the last picture before, 0..1), black (0..1), gap
 * (between clips), done (past the end) }.
 */
export function clipAt(seq, t) {
  const clips = seq?.clips ?? [];
  const total = sequenceDuration(seq);
  const none = { index: -1, clip: null, local: 0, start: 0, end: 0, dissolve: 0, black: 1, gap: false, done: t >= total };
  if (!clips.length || t < 0) return none;
  if (t >= total) return { ...none, done: true };
  // the clip there (the latest that started, should two lie on each other)
  let i = -1;
  for (let k = 0; k < clips.length; k++) if (clips[k].start <= t + 1e-9 && t < clipEnd(clips[k])) i = k;
  if (i < 0) return { ...none, gap: true, done: false };
  const c = clips[i];
  const start = c.start, end = clipEnd(c);
  const into = t - start;
  const tdur = Math.max(0, c.tdur ?? 0.6);
  const prev = clips[i - 1];
  const joined = prev && Math.abs(clipEnd(prev) - start) < 0.01;
  let dissolve = 0, black = 0;
  if (joined && c.transition === 'dissolve' && tdur > 0 && into < tdur) dissolve = 1 - into / tdur;
  if (c.transition === 'fade' && tdur > 0 && into < tdur / 2 && (prev || start > 0)) black = Math.max(black, 1 - into / (tdur / 2));
  const next = clips[i + 1];
  const ntd = Math.max(0, next?.tdur ?? 0.6);
  // fading out: into the next clip's fade, or into a gap after it
  if (next?.transition === 'fade' && ntd > 0 && end - t < ntd / 2) black = Math.max(black, 1 - (end - t) / (ntd / 2));
  // the movie's own fade in and out
  const fi = seq.fadeIn ?? 0, fo = seq.fadeOut ?? 0;
  if (fi > 0 && t < fi) black = Math.max(black, 1 - t / fi);
  if (fo > 0 && total - t < fo) black = Math.max(black, 1 - (total - t) / fo);
  return { index: i, clip: c, local: (c.from ?? 0) + into, start, end, dissolve, black: Math.min(1, black), gap: false, done: false };
}

/** The camera (its name) that is on at movie time t, or null (a gap, before, after). */
export function cameraAt(seq, t) {
  return clipAt(seq, t).clip?.camera ?? null;
}

/** The cuts of a sequence: [{ t, camera }] each time the picture changes camera (null: black). */
export function cuts(seq) {
  const out = [];
  let last;
  const ts = new Set([0]);
  for (const c of seq?.clips ?? []) ts.add(c.start), ts.add(clipEnd(c));
  for (const t of [...ts].sort((a, b) => a - b)) {
    const cam = cameraAt(seq, t);
    if (cam !== last) out.push({ t, camera: cam });
    last = cam;
  }
  return out;
}

/* ---------------- the movie's sequences ---------------- */
export function sequenceNames(movie) {
  return (movie?.sequences ?? []).map((s) => s.name);
}
/** A new sequence in the movie (a name of its own): its index. */
export function addSequence(movie, name = 'Sequence', copyOf = null) {
  const s = copyOf ? JSON.parse(JSON.stringify(copyOf)) : newSequence();
  s.name = uniqueName(name, sequenceNames(movie));
  movie.sequences.push(s);
  return movie.sequences.length - 1;
}
export function renameSequence(movie, i, name) {
  const others = sequenceNames(movie).filter((_, k) => k !== i);
  movie.sequences[i].name = uniqueName(String(name).trim() || 'Sequence', others);
  return movie.sequences[i].name;
}
export function removeSequence(movie, i) {
  movie.sequences.splice(i, 1);
  if (!movie.sequences.length) movie.sequences.push(newSequence());
  if (movie.active >= movie.sequences.length || movie.active > i) movie.active = Math.max(0, movie.active - 1);
  return movie.active;
}
/** The sequence named (or at index), else the active one. */
export function sequenceOf(movie, which) {
  const S = movie?.sequences ?? [];
  if (typeof which === 'number') return S[which] ?? null;
  if (typeof which === 'string') return S.find((s) => s.name === which) ?? null;
  return S[movie?.active ?? 0] ?? S[0] ?? null;
}
/** A camera renamed in every clip of every sequence. */
export function renameCamera(movie, from, to) {
  for (const s of movie?.sequences ?? []) for (const c of s.clips) if (c.camera === from) c.camera = to;
}
