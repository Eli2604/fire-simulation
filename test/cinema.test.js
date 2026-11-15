// Film cameras and the in-game movie (src/cinema/, models/camera.js): lenses, depth of field,
// the look, keyframes and easing, the camera moves, the shot list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SENSORS, LENSES, FRAMES, horizontalFov, focalForFov, verticalFromHorizontal, lensView, cocMm, cocPx, cocScalePx, hyperfocal, dofLimits, acceptableCoc, distortRadius } from '../src/cinema/lens.js';
import { shutterTime, relativeExposure, exposureGain, kelvinToRgb, whiteBalanceGains, GRADES, gradeUniforms, applyGrade, motionBlurHistory, shake } from '../src/cinema/look.js';
import { EASINGS, ease, catmullRom, sampleNumber, samplePoint, sampleKeys, samplePath, setKey, keysDuration } from '../src/cinema/keyframes.js';
import { evalCamera, basePose, forwardOf, subjectsOf, pickSubject, smoothTowards, moveDuration, MOVES } from '../src/cinema/rig.js';
import { shotAt, movieDuration, shotTimes, newShot, defaultMovie, nextCameraName } from '../src/cinema/sequence.js';
import { camerasOf, cameraFrame, cameraParams } from '../src/cinema/director.js';
import { MODELS, defaultParams } from '../src/models/index.js';
import { buildScene } from '../src/models/voxelizer.js';
import { GROUPS } from '../src/editor/editor.js';

const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≈ ${b}`);

/* ---------------- lens ---------------- */
test('field of view from focal length and sensor', () => {
  // full frame 36 mm wide: 50 mm ≈ 39.6°, 24 mm ≈ 73.7°, 14 mm ≈ 104.3°
  near(horizontalFov(50, 36), 39.6, 0.1);
  near(horizontalFov(24, 36), 73.7, 0.1);
  near(horizontalFov(14, 36), 104.3, 0.1);
  // a longer lens narrows it; an anamorphic squeeze of 2 widens it as a lens of half the focal length
  assert.ok(horizontalFov(200, 36) < horizontalFov(85, 36));
  near(horizontalFov(50, 24.89, 2), horizontalFov(25, 24.89), 1e-9);
  // and back
  near(focalForFov(horizontalFov(35, SENSORS['Super 35'].w), SENSORS['Super 35'].w), 35, 1e-9);
  near(verticalFromHorizontal(90, 1), 90, 1e-9);
});

test('the lens fitted to the canvas: letterbox bars and the camera fov', () => {
  // a 2.39 frame on a 16:9 canvas: bars top and bottom, the frame as wide as the canvas
  const a = lensView({ focal: 50, sensor: 'Full frame', frame: 2.39, canvasAspect: 16 / 9 });
  near(a.bars.x, 0);
  near(a.bars.y, (1 - 16 / 9 / 2.39) / 2, 1e-9);
  near(a.fov, verticalFromHorizontal(horizontalFov(50, 36), 16 / 9), 1e-9);
  // a 1.33 frame on the same canvas: bars at the sides, the frame's height the canvas's
  const b = lensView({ focal: 50, sensor: 'Full frame', frame: 4 / 3, canvasAspect: 16 / 9 });
  assert.ok(b.bars.x > 0 && b.bars.y === 0);
  near(b.fov, verticalFromHorizontal(horizontalFov(50, 36), 4 / 3), 1e-9);
  // no frame: the canvas
  const c = lensView({ focal: 35, canvasAspect: 1.5 });
  assert.equal(c.bars.x + c.bars.y, 0);
  // never wider than a perspective camera can be
  assert.ok(lensView({ focal: 2, sensor: 'Full frame', canvasAspect: 0.5 }).fov <= 175);
  assert.ok(lensView({ focal: 4, fisheye: true }).hFov <= 150);
  for (const [k, L] of Object.entries(LENSES)) if (L.letterbox) assert.ok(FRAMES[L.letterbox], k);
});

test('depth of field: thin lens circle of confusion, hyperfocal distance, limits', () => {
  const o = { focal: 50, fstop: 2.8, focus: 5 };
  near(cocMm(5, o), 0, 1e-12, 'in focus');
  assert.ok(cocMm(2, o) > cocMm(4, o), 'nearer, blurrier');
  assert.ok(cocMm(50, o) > cocMm(10, o), 'further, blurrier');
  assert.ok(cocMm(20, { ...o, fstop: 1.4 }) > cocMm(20, { ...o, fstop: 11 }), 'wider aperture: shallower');
  assert.ok(cocMm(20, { ...o, focal: 135 }) > cocMm(20, { ...o, focal: 24 }), 'longer lens: shallower');
  // the shader's pixels agree with the millimetres
  const px = cocPx(20, { ...o, sensorWidth: 36, widthPx: 1920 });
  near(px, (cocMm(20, o) / 36) * 1920, 1e-6);
  assert.ok(cocScalePx({ ...o, sensorWidth: 36, widthPx: 1920 }) > 0);
  // hyperfocal of a 50 mm at f/8 with a 0.03 mm circle: ≈ 10.4 m
  near(hyperfocal({ focal: 50, fstop: 8, coc: 0.03 }), 10.47, 0.05);
  const L = dofLimits({ focal: 50, fstop: 8, focus: 5, coc: 0.03 });
  assert.ok(L.near < 5 && L.far > 5 && Number.isFinite(L.far));
  assert.equal(dofLimits({ focal: 50, fstop: 8, focus: 20, coc: 0.03 }).far, Infinity);
  near(acceptableCoc('Full frame'), Math.hypot(36, 24) / 1500, 1e-12);
});

test('lens distortion keeps the corners and the centre, swells the middle (barrel)', () => {
  near(distortRadius(1, 0.3), 1, 1e-12);
  near(distortRadius(0, 0.3), 0, 1e-12);
  assert.ok(distortRadius(0.5, 0.3) < 0.5, 'barrel: drawn from nearer the centre');
  assert.ok(distortRadius(0.5, -0.2) > 0.5, 'pincushion');
  near(distortRadius(0.4, 0), 0.4, 1e-12);
});

/* ---------------- look ---------------- */
test('exposure: shutter angle, ISO, aperture', () => {
  near(shutterTime(180, 24), 1 / 48, 1e-12);
  near(relativeExposure({ iso: 800, fstop: 2.8, shutter: 180, fps: 24 }), 1, 1e-12);
  near(relativeExposure({ iso: 1600, fstop: 2.8, shutter: 180, fps: 24 }), 2, 1e-12);
  near(relativeExposure({ iso: 800, fstop: 5.6, shutter: 180, fps: 24 }), 0.25, 1e-12);
  near(relativeExposure({ iso: 800, fstop: 2.8, shutter: 90, fps: 24 }), 0.5, 1e-12);
  near(exposureGain({ exposure: 1, auto: true, iso: 100, fstop: 22 }), 2, 1e-12);
  assert.ok(exposureGain({ exposure: 0, auto: false, iso: 100, fstop: 22, shutter: 45, fps: 24 }) < 0.01);
});

test('white balance: neutral at 6500 K, blue when set to tungsten, warm when set high', () => {
  const n = whiteBalanceGains(6500);
  for (const v of n) near(v, 1, 0.02);
  const t = whiteBalanceGains(3200);
  assert.ok(t[2] > t[0], 'set to 3200 K in daylight: bluish');
  const w = whiteBalanceGains(10000);
  assert.ok(w[0] > w[2], 'set to 10000 K: warm');
  assert.ok(kelvinToRgb(2000)[0] > kelvinToRgb(2000)[2]);
  assert.ok(whiteBalanceGains(6500, 0.5)[1] < 1, 'magenta tint: less green');
});

test('colour grades: neutral changes nothing, the others what they say', () => {
  const c = [0.3, 0.5, 0.7];
  const N = applyGrade(c, gradeUniforms('Neutral'));
  c.forEach((v, i) => near(N[i], v, 1e-9));
  // amount 0 is neutral whatever the grade
  const z = applyGrade(c, gradeUniforms('Bleach bypass', 0));
  c.forEach((v, i) => near(z[i], v, 1e-9));
  const bw = applyGrade(c, gradeUniforms('Black & white'));
  near(bw[0], bw[1], 1e-9);
  near(bw[1], bw[2], 1e-9);
  const warm = applyGrade([0.5, 0.5, 0.5], gradeUniforms('Warm'));
  assert.ok(warm[0] > warm[2]);
  const nv = applyGrade(c, gradeUniforms('Night vision'));
  assert.ok(nv[1] > nv[0] && nv[1] > nv[2], 'night vision: green');
  assert.ok(gradeUniforms('Thermal').thermal, 'thermal: the voxels by their heat');
  for (const k of Object.keys(GRADES)) for (const v of applyGrade(c, gradeUniforms(k))) assert.ok(v >= 0 && v <= 1, k);
});

test('motion blur from the shutter angle', () => {
  assert.equal(motionBlurHistory(0, 24, 1 / 60), 0);
  const a = motionBlurHistory(180, 24, 1 / 60);
  const b = motionBlurHistory(360, 24, 1 / 60);
  assert.ok(a > 0.3 && a < 0.45, `180°: ${a}`);
  assert.ok(b > a, 'a wider shutter blurs more');
  assert.ok(motionBlurHistory(180, 24, 1 / 30) < a, 'slower frames: less history needed');
  assert.ok(motionBlurHistory(360, 1, 1e-4) <= 0.9);
});

test('handheld shake: none at 0, small and smooth otherwise', () => {
  const z = shake(1.3, 0);
  assert.deepEqual([z.yaw, z.pitch, z.roll], [0, 0, 0]);
  const a = shake(1.3, 1), b = shake(1.31, 1);
  assert.ok(Math.abs(a.yaw) < 0.02 && Math.abs(a.pos[1]) < 0.02);
  assert.ok(Math.abs(a.yaw - b.yaw) < 0.002, 'smooth');
});

/* ---------------- keyframes ---------------- */
test('easings run from 0 to 1', () => {
  for (const [k, f] of Object.entries(EASINGS)) {
    near(f(0), 0, 1e-12, k);
    near(f(1), 1, 1e-12, k);
  }
  near(ease('easeInOut', 0.5), 0.5, 1e-12);
  assert.ok(ease('easeIn', 0.25) < 0.25 && ease('easeOut', 0.25) > 0.25);
  assert.equal(ease('linear', 2), 1, 'clamped');
});

test('keyframe interpolation: numbers, eased, linear and Catmull-Rom points', () => {
  const keys = [
    { t: 0, pos: [0, 0, 0], focal: 24, ease: 'linear' },
    { t: 2, pos: [10, 0, 0], focal: 50, ease: 'linear' },
    { t: 4, pos: [10, 0, 10], ease: 'easeInOut' },
    { t: 6, pos: [0, 0, 10], focal: 100 },
  ];
  near(sampleNumber(keys, 'focal', -1), 24, 1e-12, 'before the first');
  near(sampleNumber(keys, 'focal', 1), 37, 1e-12, 'linear');
  near(sampleNumber(keys, 'focal', 9), 100, 1e-12, 'after the last');
  // focal is missing on the key at 4 s: between 2 and 6, eased by the 2 s key's linear
  near(sampleNumber(keys, 'focal', 4), 75, 1e-12);
  assert.equal(sampleNumber(keys, 'fstop', 1), undefined);
  // straight
  assert.deepEqual(samplePoint(keys, 'pos', 1, false), [5, 0, 0]);
  // the spline passes through the keys
  assert.deepEqual(samplePoint(keys, 'pos', 2, true), [10, 0, 0]);
  const s = samplePoint(keys, 'pos', 3, true);
  assert.ok(s[0] > 10, `the spline bows out round the corner: ${s}`);
  // Catmull-Rom between p1 and p2
  assert.deepEqual(catmullRom([0, 0, 0], [1, 1, 1], [2, 2, 2], [3, 3, 3], 0), [1, 1, 1]);
  near(catmullRom([0, 0, 0], [1, 1, 1], [2, 2, 2], [3, 3, 3], 0.5)[0], 1.5, 1e-12);
  const all = sampleKeys(keys, 1);
  assert.ok(all.pos && all.focal && all.target === undefined);
  assert.equal(keysDuration(keys), 6);
  assert.ok(samplePath(keys, { n: 4 }).length === 13);
});

test('keys: put in sorted, one replaced at the same time; effects keyed too', () => {
  let K = setKey([], { t: 2, focal: 50 });
  K = setKey(K, { t: 0, focal: 24 });
  K = setKey(K, { t: 2.01, focal: 85 });
  assert.deepEqual(K.map((k) => [k.t, k.focal]), [[0, 24], [2.01, 85]]);
  const fx = sampleKeys([{ t: 0, fx: { grain: 0 }, ease: 'linear' }, { t: 1, fx: { grain: 1 } }], 0.25).fx;
  near(fx.grain, 0.25, 1e-12);
  // a hold: no change until the next key
  near(sampleNumber([{ t: 0, focus: 2, ease: 'hold' }, { t: 1, focus: 10 }], 'focus', 0.9), 2, 1e-12);
});

/* ---------------- the camera moves ---------------- */
const cam = (params, keys = [], base = basePose({ x: 10, z: 10, rotation: 0 }, 2)) => ({ params: { ...defaultParams('camera'), ...params }, keys, base });

test('the camera stands and looks along its pose when static', () => {
  const E = evalCamera(cam({ move: 'static' }), 3);
  assert.deepEqual(E.pos, [10, 2, 10]);
  near(E.target[2] - E.pos[2], 10, 1e-9, 'looks along +z (turn 0)');
  const f = forwardOf(Math.PI / 2, 0);
  near(f[0], 1, 1e-12);
  const down = forwardOf(0, 30 * (Math.PI / 180));
  assert.ok(down[1] < 0, 'tilt X + looks down');
  const b = basePose({ x: 1, z: 2, rotation: 90, tiltX: 10, tiltZ: 5 }, 3);
  near(b.yaw, Math.PI / 2, 1e-12);
  near(b.roll, 5 * (Math.PI / 180), 1e-12);
});

test('moves: dolly, truck, crane, orbit, keys, follow and track', () => {
  const d = evalCamera(cam({ move: 'dolly', travel: 4, duration: 2 }), 2);
  assert.deepEqual(d.pos.map((v) => +v.toFixed(6)), [10, 2, 14]);
  const tr = evalCamera(cam({ move: 'truck', travel: 3, duration: 2 }), 5);
  near(Math.hypot(tr.pos[0] - 10, tr.pos[2] - 10), 3, 1e-9);
  const cr = evalCamera(cam({ move: 'crane', travel: 6, duration: 1 }), 1);
  near(cr.pos[1], 8, 1e-9);
  near(cr.target[1], 2, 1e-9, 'still looking at what it looked at');
  // orbit round the point it looks at, starting where it stands, at its distance
  const o0 = evalCamera(cam({ move: 'orbit', radius: 6, speed: 90 }), 0);
  near(o0.pos[0], 10, 1e-9);
  near(o0.pos[2], 10, 1e-9);
  const o1 = evalCamera(cam({ move: 'orbit', radius: 6, speed: 90 }), 1);
  near(Math.hypot(o1.pos[0] - o1.target[0], o1.pos[2] - o1.target[2]), 6, 1e-9);
  // round a subject
  const subj = { p: [0, 0, 0], yaw: 0, aim: 1 };
  const os = evalCamera(cam({ move: 'orbit', radius: 5, height: 3, subject: 'dragon' }), 2, subj);
  near(Math.hypot(os.pos[0], os.pos[2]), 5, 1e-9);
  assert.deepEqual(os.target, [0, 1, 0]);
  // keys relative to where the camera stands
  const k = evalCamera(cam({ move: 'keys' }, [{ t: 0, pos: [0, 0, 0], target: [0, 0, 5], focal: 24, ease: 'linear' }, { t: 2, pos: [4, 0, 0], target: [4, 0, 5], focal: 85 }]), 1);
  assert.deepEqual(k.pos, [12, 2, 10]);
  near(k.focal, 54.5, 1e-9);
  // follow: behind the subject (its heading), track: beside it; both looking at it
  const fo = evalCamera(cam({ move: 'follow', radius: 8, height: 2 }), 0, { p: [0, 0, 0], yaw: 0, aim: 1 });
  assert.deepEqual(fo.pos, [0, 2, -8]);
  assert.ok(fo.smooth);
  const tk = evalCamera(cam({ move: 'track', radius: 6, height: 1 }), 0, { p: [0, 0, 0], yaw: 0, aim: 1 });
  near(Math.hypot(tk.pos[0], tk.pos[2]), 6, 1e-9);
  // look at the subject, focus on it
  const la = evalCamera(cam({ move: 'static', look: 'subject', focusMode: 'subject' }), 0, { p: [10, 0, 20], yaw: 0, aim: 2 });
  assert.deepEqual(la.target, [10, 2, 20]);
  near(la.focus, 10, 1e-9);
  // without a subject, follow stays put
  assert.deepEqual(evalCamera(cam({ move: 'follow' }), 0).pos, [10, 2, 10]);
  for (const m of MOVES) for (const v of evalCamera(cam({ move: m }), 1.5, subj).pos) assert.ok(Number.isFinite(v), m);
  assert.equal(moveDuration(cam({ move: 'dolly', duration: 3 })), 3);
  assert.equal(moveDuration(cam({ move: 'keys' }, [{ t: 0 }, { t: 7 }])), 7);
});

test('subjects: the moving things of a world, picked by kind and number', () => {
  const world = {
    dragons: [{ p: [1, 2, 3], yaw: 0.5 }],
    helis: [{ ai: { p: [5, 30, 5], yaw: 1 } }],
    enemies: [{ p: [0, 0, 0], yaw: 0 }, { p: [2, 0, 0], yaw: 0, dead: true }, { p: [4, 0, 0], yaw: 0 }],
    floats: [{ at: [9, 0, 9], yaw: 0, body: { pose: { p: [9, 0.2, 9.5], yaw: 0.3 } } }],
    vehicles: [{ type: 'jet', base: [0, 0, 0] }, { type: 'car', base: [3, 0, 3], heading: 0 }],
  };
  const S = subjectsOf(world);
  assert.equal(S.filter((s) => s.kind === 'soldier').length, 2, 'the dead not followed');
  assert.deepEqual(pickSubject(S, 'boat').p, [9, 0.2, 9.5]);
  assert.deepEqual(pickSubject(S, 'soldier', 2).p, [4, 0, 0]);
  assert.deepEqual(pickSubject(S, 'helicopter').p, [5, 30, 5]);
  assert.equal(pickSubject(S, 'car').kind, 'car');
  assert.equal(pickSubject(S, 'none'), null);
  assert.equal(pickSubject(S, 'phoenix'), null);
  assert.deepEqual(subjectsOf(null), []);
  // a lag: part of the way there, frame-rate independent
  const a = smoothTowards([0, 0, 0], [10, 0, 0], 0.5, 0.5);
  near(a[0], 10 * (1 - Math.exp(-1)), 1e-9);
  const b = smoothTowards(smoothTowards([0, 0, 0], [10, 0, 0], 0.25, 0.5), [10, 0, 0], 0.25, 0.5);
  near(a[0], b[0], 1e-9);
});

/* ---------------- the movie ---------------- */
test('the shot list: shots in turn, dissolves, fades through black, the end', () => {
  const movie = { ...defaultMovie(), fadeIn: 0, fadeOut: 0, shots: [newShot('Cam A', 4), { ...newShot('Cam B', 3), transition: 'dissolve', tdur: 1, from: 2 }, { ...newShot('Cam A', 2), transition: 'fade', tdur: 1 }] };
  assert.equal(movieDuration(movie), 9);
  assert.deepEqual(shotTimes(movie), [{ start: 0, end: 4 }, { start: 4, end: 7 }, { start: 7, end: 9 }]);
  const a = shotAt(movie, 1);
  assert.equal(a.index, 0);
  assert.equal(a.shot.camera, 'Cam A');
  assert.equal(a.local, 1);
  assert.equal(a.black, 0);
  const b = shotAt(movie, 4.25);
  assert.equal(b.index, 1);
  near(b.local, 2.25, 1e-12, 'from 2 s into its move');
  near(b.dissolve, 0.75, 1e-12);
  assert.equal(shotAt(movie, 5.5).dissolve, 0);
  // the fade: out over the end of shot 2, in over the start of shot 3
  near(shotAt(movie, 6.75).black, 0.5, 1e-12);
  near(shotAt(movie, 7.25).black, 0.5, 1e-12);
  assert.equal(shotAt(movie, 8).black, 0);
  assert.ok(shotAt(movie, 9).done);
  assert.equal(shotAt({ shots: [] }, 0).index, -1);
  // the movie's own fades
  const m2 = { ...movie, fadeIn: 1, fadeOut: 2 };
  near(shotAt(m2, 0.5).black, 0.5, 1e-12);
  near(shotAt(m2, 8).black, 0.5, 1e-12);
  assert.equal(nextCameraName(['Cam A', 'Cam B']), 'Cam C');
});

/* ---------------- the camera object ---------------- */
test('the film camera: an object of the world without voxels, in the Cinema group, its cameras found', () => {
  assert.ok(MODELS.camera);
  assert.ok(GROUPS.find(([g]) => g === 'Cinema')[1].includes('camera'));
  const p = defaultParams('camera');
  for (const k of Object.keys(MODELS.camera.params)) assert.notEqual(p[k], undefined, k);
  for (const [k, s] of Object.entries(MODELS.camera.params)) if (k !== 'name') assert.ok(MODELS.camera.paramGroups.includes(s.group), `${k} in a folder`);
  const o = MODELS.camera.create({ type: 'camera', params: p, x: 5, z: 6 });
  assert.equal(o.y, 1.6);
  assert.deepEqual(o.keys, []);
  const scene = { world: { size: [12, 6, 12], h: 0.2 }, objects: [{ type: 'crate', x: 3, z: 3 }, { ...o, rotation: 90, params: { ...p, name: 'Wide' } }] };
  const { world } = buildScene(scene);
  let n = 0;
  for (let k = 0; k < world.solidCount; k++) if (world.owner[world.solids[k]] === 1) n++;
  assert.equal(n, 0, 'no voxels');
  const cams = camerasOf(scene, world);
  assert.equal(cams.length, 1);
  assert.equal(cams[0].name, 'Wide');
  assert.equal(cams[0].index, 1);
  near(cams[0].base.origin[1], 0.2 + 1.6, 1e-9);
  near(cams[0].base.yaw, Math.PI / 2, 1e-12);
  assert.equal(cameraParams({ params: {} }).lens, '35 mm');
  // its picture: an anamorphic lens: 2.39 bars, oval bokeh, streaks; night vision adds grain
  const F = cameraFrame({ ...cams[0], params: { ...cams[0].params, lens: 'Anamorphic 50 mm (2×, 2.39:1)', focal: 50, grade: 'Night vision' } }, 0, { canvasAspect: 16 / 9, widthPx: 1600 });
  assert.ok(F.settings.final.bars[1] > 0.1);
  assert.equal(F.settings.dof.oval, 0.6);
  assert.ok(F.settings.final.streaks > 0.3);
  assert.ok(F.settings.final.grain > cams[0].params.grain);
  assert.ok(F.settings.motion > 0);
  assert.ok(F.settings.dof.maxCoc > 0 && F.settings.dof.maxCoc <= 40);
  // saved with the scene: keys and the movie are plain JSON
  const saved = JSON.parse(JSON.stringify({ ...scene, movie: { ...defaultMovie(), shots: [newShot('Wide')] } }));
  assert.equal(saved.movie.shots[0].camera, 'Wide');
});
