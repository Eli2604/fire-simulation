// The movie as a timeline of camera clips (cinema/timeline.js): sequences, clips put down,
// moved, trimmed and snapped, which camera is on when, and the old shot list migrated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateMovie, newSequence, newClip, addClip, moveClip, trimClip, splitClip, setClipStart, setClipDur, snapTime, snapTargets, fitStart, gaps, clipAt, cameraAt, cuts, sequenceDuration, toSim, fromSim, clockToMovie, addSequence, renameSequence, removeSequence, sequenceOf, renameCamera, MIN_CLIP } from '../src/cinema/timeline.js';
import { defaultMovie, newShot } from '../src/cinema/sequence.js';

const near = (a, b, eps = 1e-9, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≈ ${b}`);
const seqOf = (...clips) => ({ ...newSequence('T'), fadeIn: 0, fadeOut: 0, clips });

test('the old shot list becomes a timeline: shots one after the other in "Main"', () => {
  const old = { ...defaultMovie(), simSpeed: 2, fadeIn: 0.2, shots: [newShot('Cam A', 4), { ...newShot('Cam B', 3), transition: 'dissolve', tdur: 1, from: 2 }, newShot('Cam A', 2)] };
  const m = migrateMovie(JSON.parse(JSON.stringify(old)));
  assert.equal(m.version, 2);
  assert.equal(m.active, 0);
  assert.equal(m.sequences.length, 1);
  const s = m.sequences[0];
  assert.equal(s.name, 'Main');
  assert.equal(s.simSpeed, 2);
  assert.equal(s.fadeIn, 0.2);
  assert.deepEqual(s.clips.map((c) => [c.camera, c.start, c.dur, c.from, c.transition]), [['Cam A', 0, 4, 0, 'cut'], ['Cam B', 4, 3, 2, 'dissolve'], ['Cam A', 7, 2, 0, 'cut']]);
  assert.equal(sequenceDuration(s), 9);
  // the same pictures at the same times as the shot list played
  near(clipAt({ ...s, fadeIn: 0 }, 4.25).dissolve, 0.75);
  near(clipAt(s, 4.25).local, 2.25);
  // a timeline stays as it is (idempotent); nothing becomes one empty sequence
  assert.deepEqual(migrateMovie(m), m);
  const e = migrateMovie(undefined);
  assert.equal(e.sequences.length, 1);
  assert.deepEqual(e.sequences[0].clips, []);
  assert.deepEqual(migrateMovie({ shots: [] }).sequences[0].clips, []);
});

test('which camera is on at time t: cuts at clip boundaries, gaps are black', () => {
  const s = seqOf(newClip('A', 0, 3), newClip('B', 3, 2), newClip('C', 6, 2));
  assert.equal(cameraAt(s, 0), 'A');
  assert.equal(cameraAt(s, 2.999), 'A');
  assert.equal(cameraAt(s, 3), 'B', 'the cut at the clip start');
  assert.equal(cameraAt(s, 5.5), null, 'a gap');
  const g = clipAt(s, 5.5);
  assert.ok(g.gap && g.black === 1 && !g.done);
  assert.equal(cameraAt(s, 6), 'C');
  assert.ok(clipAt(s, 8).done);
  assert.equal(cameraAt(s, -1), null);
  assert.deepEqual(cuts(s), [{ t: 0, camera: 'A' }, { t: 3, camera: 'B' }, { t: 5, camera: null }, { t: 6, camera: 'C' }, { t: 8, camera: null }]);
  // a clip from 2 s into its camera's move
  s.clips[1].from = 2;
  near(clipAt(s, 4).local, 3);
  // transitions: a dissolve from the clip before (joined), fades through black (also out of / into a gap)
  s.clips[1].transition = 'dissolve';
  s.clips[1].tdur = 1;
  near(clipAt(s, 3.5).dissolve, 0.5);
  s.clips[2].transition = 'fade';
  s.clips[2].tdur = 2;
  near(clipAt(s, 6.5).black, 0.5, 1e-9, 'fading in after the gap');
  near(clipAt(s, 4.5).black, 0.5, 1e-9, 'the clip before fades out');
  // simulation time: at speed 2, 10 s of simulation are 5 s of movie
  s.simSpeed = 2;
  assert.equal(toSim(s, 5), 10);
  assert.equal(fromSim(s, 10), 5);
  assert.equal(clockToMovie(s, 10), 10, 'movie clock: as it is');
  s.clock = 'sim';
  assert.equal(clockToMovie(s, 10), 5);
});

test('snapping: to clip edges, the playhead, the grid', () => {
  assert.deepEqual(snapTime(2.93, [0, 3, 5], 0.2), { t: 3, to: 3 });
  assert.deepEqual(snapTime(2.5, [0, 3, 5], 0.2), { t: 2.5, to: null });
  assert.deepEqual(snapTime(2.37, [0, 3], 0.2, 0.5), { t: 2.5, to: null });
  const s = seqOf(newClip('A', 0, 3), newClip('B', 5, 2));
  assert.deepEqual(snapTargets(s, s.clips[1], [4]).sort(), [0, 0, 3, 4].sort());
});

test('clips put down, moved, trimmed: never on top of each other', () => {
  const s = newSequence('T');
  const a = addClip(s, 'A', 0, 3);
  const b = addClip(s, 'B', 1, 2); // on A: into the nearest gap (after A)
  assert.equal(b.start, 3);
  const c = addClip(s, 'C', 7.5, 2, { threshold: 0.2 });
  assert.equal(c.start, 7.5);
  const d = addClip(s, 'D', 5.15, 2, { threshold: 0.2 }); // snaps its start to B's end (5)
  assert.equal(d.start, 5);
  assert.deepEqual(gaps(s), [[7, 7.5], [9.5, Infinity]]);
  // moved: snapped by either edge, kept out of the others
  moveClip(s, c, 7.05, { threshold: 0.2 });
  assert.equal(c.start, 7, 'its start snapped to D’s end');
  moveClip(s, a, 4, { snap: false }); // no room among B, D, C: the nearest gap that fits
  assert.ok(a.start === 0 || a.start >= 9, `A at ${a.start}`);
  assert.equal(a.start, 0);
  moveClip(s, a, 20, { snap: false });
  assert.equal(a.start, 20);
  assert.equal(s.clips[s.clips.length - 1], a, 'sorted by start');
  moveClip(s, a, 0.1, { threshold: 0.2 });
  assert.equal(a.start, 0);
  // trimmed: the end up to the next clip; the start with its content (from)
  trimClip(s, a, 'end', 10, { snap: false });
  assert.equal(a.dur, 3, 'not over B');
  trimClip(s, a, 'end', 0.05, { snap: false });
  assert.equal(a.dur, MIN_CLIP);
  trimClip(s, b, 'start', 4, { snap: false });
  assert.equal(b.start, 4);
  assert.equal(b.dur, 1);
  assert.equal(b.from, 1, 'the content stays where it was');
  trimClip(s, b, 'start', 0, { snap: false });
  assert.equal(b.start, MIN_CLIP, 'not over A');
  assert.equal(b.from, 0);
  trimClip(s, b, 'end', 4.93, { threshold: 0.2 });
  assert.equal(b.dur, 5 - MIN_CLIP, 'snapped to D’s start');
  // exact times (the list view)
  setClipStart(s, c, 12.5);
  assert.equal(c.start, 12.5);
  setClipDur(s, c, 4);
  assert.equal(c.dur, 4);
  // cut in two
  const half = splitClip(s, c, 14);
  assert.equal(c.dur, 1.5);
  assert.deepEqual([half.start, half.dur, half.from, half.camera], [14, 2.5, 1.5, 'C']);
  for (let i = 1; i < s.clips.length; i++) assert.ok(s.clips[i].start >= s.clips[i - 1].start + s.clips[i - 1].dur - 1e-9, 'no overlaps');
  assert.equal(fitStart(s, 3, 100), 16.5, 'a long clip goes after the last');
});

test('sequences: several per place, named, one plays', () => {
  const m = migrateMovie(undefined);
  const i = addSequence(m, 'Chase');
  assert.equal(m.sequences[i].name, 'Chase');
  const j = addSequence(m, 'Chase', m.sequences[0]);
  assert.equal(m.sequences[j].name, 'Chase 2');
  m.sequences[0].clips.push(newClip('A', 0, 2));
  assert.equal(m.sequences[j].clips.length, 0, 'a copy, not the same');
  assert.equal(renameSequence(m, 1, 'Main'), 'Main 2');
  m.active = 2;
  assert.equal(sequenceOf(m).name, 'Chase 2');
  assert.equal(sequenceOf(m, 'Main').clips.length, 1);
  assert.equal(sequenceOf(m, 0).name, 'Main');
  removeSequence(m, 0);
  assert.equal(m.active, 1);
  assert.equal(sequenceOf(m).name, 'Chase 2');
  removeSequence(m, 0);
  removeSequence(m, 0);
  assert.equal(m.sequences.length, 1, 'always one');
  m.sequences[0].clips.push(newClip('A', 0, 2));
  renameCamera(m, 'A', 'Wide');
  assert.equal(m.sequences[0].clips[0].camera, 'Wide');
  // plain JSON, saved with the scene
  assert.deepEqual(JSON.parse(JSON.stringify(m)), m);
});
