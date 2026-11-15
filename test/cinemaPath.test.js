// Film cameras along a drawn path (cinema/path.js; the move 'path' of cinema/rig.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPath, measured, pointAt, distanceAt, evalPath, pathDuration, knotTimes, centripetal, carry, uncarry, controlPoints } from '../src/cinema/path.js';
import { evalCamera, basePose, moveDuration } from '../src/cinema/rig.js';
import { resolveTargets } from '../src/cinema/aim.js';
import { camerasOf } from '../src/cinema/director.js';
import { defaultParams, MODELS } from '../src/models/index.js';

const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≈ ${b}`);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const cam = (params, extra = {}) => ({ params: { ...defaultParams('camera'), move: 'path', ...params }, keys: [], base: basePose({ x: 0, z: 0 }, 2), ...extra });
// points bunched at one end, spread at the other: an uneven parameterisation would show
const uneven = { points: [[0, 2, 0], [1, 2, 0], [2, 2, 0.5], [20, 2, 4], [40, 2, 0]].map((p) => ({ p })) };
const square = { closed: true, points: [[0, 2, 0], [20, 2, 0], [20, 2, 20], [0, 2, 20]].map((p) => ({ p })) };

test('the spline goes through its points; centripetal: no overshoot on a straight line', () => {
  const M = buildPath(uneven);
  for (let i = 0; i < 5; i++) {
    const q = pointAt(M, M.knots[i]).pos;
    near(dist(q, uneven.points[i].p), 0, 1e-6, `point ${i}`);
  }
  // straight points: the curve stays on the line between them
  const line = buildPath({ points: [[0, 0, 0], [1, 0, 0], [10, 0, 0]].map((p) => ({ p })) });
  for (const q of line.pts) assert.ok(q[0] >= -1e-9 && q[0] <= 10 + 1e-9 && Math.abs(q[1]) < 1e-9);
  near(line.length, 10, 1e-6);
  near(dist(centripetal([0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0], 0.5), [1.5, 0, 0]), 0, 1e-9);
  assert.deepEqual(controlPoints({ points: [{ p: [1, 2, 3] }, [4, 5, 6], { p: 'x' }] }), [[1, 2, 3], [4, 5, 6]]);
});

test('arc length: a constant speed moves evenly however the points are spaced', () => {
  const P = { pathSpeed: 4, pathEnd: 'once' };
  const M = measured(uneven);
  let prev = evalPath(uneven, 0, P).pos;
  const steps = [];
  for (let t = 0.25; t * 4 < M.length - 0.5; t += 0.25) {
    const q = evalPath(uneven, t, P).pos;
    steps.push(dist(q, prev));
    prev = q;
  }
  // every quarter second, 1 m along the curve (a chord a hair shorter on the bends)
  for (const s of steps) near(s, 1, 0.02);
  near(distanceAt(uneven, 2.5, P), 10, 1e-9);
  near(pathDuration(uneven, P), M.length / 4, 1e-9);
  // once: stops at its end; start further along; start later
  near(distanceAt(uneven, 1e4, P), M.length, 1e-9);
  near(distanceAt(uneven, 1, { ...P, pathStart: 3 }), 7, 1e-9);
  near(distanceAt(uneven, 1, { ...P, pathDelay: 0.5 }), 2, 1e-9);
  // ping-pong: back the way it came
  near(distanceAt(uneven, M.length / 4 + 1, { ...P, pathEnd: 'ping-pong' }), M.length - 4, 1e-9);
  const back = evalPath(uneven, M.length / 4 + 1, { ...P, pathEnd: 'ping-pong' });
  assert.ok(back.tangent[0] < 0, 'facing back along it');
});

test('a closed loop: continuous through its start, round and round', () => {
  const M = measured(square);
  assert.ok(M.closed);
  const P = { pathSpeed: 10, pathEnd: 'loop' };
  const T = M.length / 10;
  // just before and just after the seam: close together, the same heading
  const a = evalPath(square, T - 0.01, P), b = evalPath(square, T + 0.01, P);
  assert.ok(dist(a.pos, b.pos) < 0.25, `seam gap ${dist(a.pos, b.pos)}`);
  assert.ok(a.tangent[0] * b.tangent[0] + a.tangent[2] * b.tangent[2] > 0.98, 'the same heading');
  near(dist(evalPath(square, 0, P).pos, evalPath(square, T, P).pos), 0, 1e-6, 'one lap: back at the start');
  near(dist(evalPath(square, 0.3, P).pos, evalPath(square, 0.3 + 2 * T, P).pos), 0, 1e-6);
  // the curve is smooth round the corners: no sample-to-sample turn above ~20°
  for (let i = 1; i < M.pts.length - 1; i++) {
    const u = M.pts[i].map((v, k) => v - M.pts[i - 1][k]), w = M.pts[i + 1].map((v, k) => v - M.pts[i][k]);
    const c = (u[0] * w[0] + u[2] * w[2]) / (Math.hypot(u[0], u[2]) * Math.hypot(w[0], w[2]) || 1);
    assert.ok(c > Math.cos((20 * Math.PI) / 180), `sample ${i}`);
  }
});

test('timed per point: at each point at its time, eased between, missing times from the speed', () => {
  const path = { points: [{ p: [0, 0, 0], t: 0 }, { p: [10, 0, 0], t: 5, ease: 'easeInOut' }, { p: [20, 0, 0] }] };
  const P = { pathTiming: 'per point', pathSpeed: 5, pathEnd: 'once' };
  const M = measured(path);
  const T = knotTimes(path, M, 5);
  assert.deepEqual(T.slice(0, 2), [0, 5]);
  near(T[2], 5 + (M.knots[2] - M.knots[1]) / 5, 1e-9);
  near(distanceAt(path, 0, P), 0, 1e-9);
  near(distanceAt(path, 5, P), M.knots[1], 1e-9);
  near(distanceAt(path, 2.5, P), M.knots[1] / 2, 1e-9, 'linear (the first point has no easing)');
  near(evalPath(path, 5, P).pos[0], 10, 1e-6);
  // eased: slow at both ends of the second leg
  const mid = (T[1] + T[2]) / 2;
  near(distanceAt(path, mid, P), (M.knots[1] + M.knots[2]) / 2, 1e-6);
  assert.ok(distanceAt(path, T[1] + 0.25, P) - M.knots[1] < 0.25 * 5 * 0.5, 'eased in');
  near(pathDuration(path, P), T[2], 1e-9);
});

test('orientation: along the tangent, a look-ahead, or what the camera looks at; banking', () => {
  const c = cam({ pathSpeed: 2 }, { path: uneven });
  const E = evalCamera(c, 3, null);
  const d = E.target.map((v, i) => v - E.pos[i]);
  const L = Math.hypot(...d);
  const tan = evalPath(uneven, 3, c.params).tangent;
  near((d[0] * tan[0] + d[1] * tan[1] + d[2] * tan[2]) / L, 1, 1e-9, 'looks along the tangent');
  // look ahead: at the point further on
  const la = evalCamera(cam({ pathSpeed: 2, pathLookAhead: 5 }, { path: uneven }), 3, null);
  const M = measured(uneven);
  near(dist(la.target, pointAt(M, distanceAt(uneven, 3, { pathSpeed: 2 }) + 5).pos), 0, 1e-9);
  // the look overrides: still on the path, looking at the helicopter
  const T = [{ kind: 'helicopter', id: 'helicopter:1', p: [5, 30, 5], yaw: 0, aim: 1.5 }];
  const lc = cam({ pathSpeed: 2, look: 'subject' }, { path: uneven, lookAt: 'helicopter:1' });
  const R = resolveTargets(lc, T);
  const EL = evalCamera(lc, 3, R.follow, { look: R.look, carrier: R.carrier });
  near(dist(EL.pos, E.pos), 0, 1e-9, 'the same place on the path');
  assert.deepEqual(EL.target, [5, 31.5, 5]);
  // banking: none on a straight, into the curve on a bend, both ways alike
  const straight = { points: [[0, 0, 0], [50, 0, 0]].map((p) => ({ p })) };
  near(evalPath(straight, 2, { pathSpeed: 10, pathBank: 1 }).roll, 0, 1e-9);
  const left = { points: [[0, 0, 0], [20, 0, 0], [30, 0, 10], [30, 0, 30]].map((p) => ({ p })) };
  const right = { points: left.points.map(({ p }) => ({ p: [p[0], p[1], -p[2]] })) };
  const P = { pathSpeed: 15, pathBank: 1 };
  const t = measured(left).knots[2] / 15;
  const rl = evalPath(left, t, P).roll, rr = evalPath(right, t, P).roll;
  assert.ok(Math.abs(rl) > 5, `banks ${rl}`);
  near(rl, -rr, 1e-6);
  near(evalPath(left, t, { ...P, pathBank: 0 }).roll, 0, 1e-12);
  assert.ok(moveDuration(c) > 0);
});

test('a path attached to a moving thing, and one path shared by several cameras', () => {
  const ship = { id: 'boat:1', kind: 'boat', p: [100, 0, 50], yaw: Math.PI / 2, aim: 0.8 };
  near(dist(uncarry(ship, carry(ship, [1, 2, 3])), [1, 2, 3]), 0, 1e-9);
  const path = { on: 'boat:1', points: [[0, 5, -10], [0, 5, 10]].map((p) => ({ p })) };
  const c = cam({ pathSpeed: 5, pathEnd: 'once' }, { path });
  const R = resolveTargets(c, [ship]);
  assert.equal(R.carrier, ship);
  const E0 = evalCamera(c, 0, null, { carrier: R.carrier });
  near(dist(E0.pos, [90, 5, 50]), 0, 1e-9, 'its stern: 10 m back of a ship heading +x');
  // the ship sails on: the camera with it
  const moved = { ...ship, p: [130, 0, 50] };
  near(dist(evalCamera(c, 0, null, { carrier: moved }).pos, [120, 5, 50]), 0, 1e-9);
  // shared: another camera travels the first one's path (by its name), 10 m behind
  const p = defaultParams('camera');
  const a = { ...MODELS.camera.create({ type: 'camera', x: 0, z: 0 }), params: { ...p, name: 'Lead', move: 'path' }, path: square };
  const b = { ...MODELS.camera.create({ type: 'camera', x: 5, z: 5 }), params: { ...p, name: 'Chase', move: 'path', pathStart: 10 }, pathFrom: 'Lead' };
  const cams = camerasOf({ objects: [a, b] }, { h: 0.2 });
  assert.equal(cams[1].path, square);
  const ea = evalCamera(cams[0], 2, null), eb = evalCamera(cams[1], 2, null);
  near(distanceAt(square, 2, cams[1].params) - distanceAt(square, 2, cams[0].params), 10, 1e-9);
  assert.ok(dist(ea.pos, eb.pos) > 5);
});
