// Film cameras: their direction (pan / tilt), what they aim at and follow, framing (cinema/aim.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirFromPanTilt, panTiltOf, aimFromPanTilt, aimAt, frameTarget, projectInFrame, framingOf, FRAMINGS, resolveTargets, objectTargets, findTarget, targetPoint, offsetFrom, pickTarget, objectName } from '../src/cinema/aim.js';
import { evalCamera, basePose, subjectsOf, findSubject } from '../src/cinema/rig.js';
import { cameraFrame, camerasOf, targetsOf } from '../src/cinema/director.js';
import { defaultParams } from '../src/models/index.js';
import { buildScene } from '../src/models/voxelizer.js';
import { flattenObjects } from '../src/models/composite.js';

const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≈ ${b}`);
const near3 = (a, b, eps = 1e-6, msg) => a.forEach((v, i) => near(v, b[i], eps, msg));
const cam = (params, extra = {}, base = basePose({ x: 0, z: 0, rotation: 0 }, 2)) => ({ params: { ...defaultParams('camera'), ...params }, keys: [], base, ...extra });

test('direction as pan and tilt, and back; aiming at a point', () => {
  near3(dirFromPanTilt(0, 0), [0, 0, 1], 1e-12, 'pan 0: along +z');
  near3(dirFromPanTilt(90, 0), [1, 0, 0], 1e-12, 'pan 90: along +x');
  const up = dirFromPanTilt(0, 30);
  assert.ok(up[1] > 0, 'tilt + looks up');
  near(up[1], 0.5, 1e-12);
  for (const [p, t] of [[0, 0], [45, 10], [200, -35], [359, 80]]) {
    const b = panTiltOf(dirFromPanTilt(p, t));
    near(b.pan, p, 1e-9);
    near(b.tilt, t, 1e-9);
  }
  near3(aimFromPanTilt([1, 2, 3], 90, 0, 5), [6, 2, 3], 1e-12);
  // aim at a point: the camera object's turn and Tilt X (down +), and the distance
  const a = aimAt([0, 2, 0], [10, 2, 10]);
  near(a.pan, 45, 1e-9);
  near(a.tilt, 0, 1e-9);
  near(a.dist, Math.hypot(10, 10), 1e-9);
  assert.equal(a.rotation, 45);
  const b = aimAt([0, 10, 0], [0, 0, 10]);
  near(b.tilt, -45, 1e-9);
  assert.equal(b.tiltX, 45, 'looking down: Tilt X +');
  // the pose made from it looks at the point
  const base = basePose({ x: 0, z: 0, rotation: b.rotation, tiltX: b.tiltX }, 10);
  const E = evalCamera(cam({ move: 'static' }, { aimDist: b.dist }, base), 0);
  near3(E.target, [0, 0, 10], 1e-6);
});

test('aim at a point of its own, or at a subject; position and look on separate targets', () => {
  // its aim point
  const P = evalCamera(cam({ look: 'point' }, { aimPoint: [5, 0, 5] }), 0);
  assert.deepEqual(P.target, [5, 0, 5]);
  assert.deepEqual(P.lookPoint, [5, 0, 5]);
  const world = {
    dragons: [{ p: [50, 20, 50], yaw: 0, colours: 'koi' }],
    helis: [{ ai: { p: [-30, 40, 10], yaw: 0 } }],
    cars: [{ x: 10, y: 0, z: 0, yaw: Math.PI / 2, label: 'jeep' }],
  };
  const T = subjectsOf(world);
  // position fixed, looking at the helicopter
  const c1 = cam({ move: 'static', look: 'subject' }, { lookAt: 'helicopter:1' });
  const R1 = resolveTargets(c1, T);
  assert.equal(R1.follow, null);
  assert.deepEqual(R1.look, [-30, 41.5, 10]);
  const E1 = evalCamera(c1, 0, R1.follow, { look: R1.look });
  assert.deepEqual(E1.pos, [0, 2, 0]);
  assert.deepEqual(E1.target, [-30, 41.5, 10]);
  // following the jeep, looking at the dragon
  const c2 = cam({ move: 'follow', look: 'subject', radius: 6, height: 2 }, { follow: 'car:jeep:1', lookAt: 'dragon:koi:1' });
  const R2 = resolveTargets(c2, T);
  assert.equal(R2.follow.label, 'Jeep 1');
  assert.equal(R2.lookTarget.label, 'Dragon (koi)');
  const E2 = evalCamera(c2, 0, R2.follow, { look: R2.look });
  near3(E2.pos, [10 - 6, 2, 0], 1e-9, 'behind the jeep (heading +x)');
  assert.deepEqual(E2.target, [50, 21, 50], 'at the dragon');
  assert.ok(E2.smooth);
  // a follow offset sideways (its right: +z when it heads +x)
  const E3 = evalCamera(cam({ move: 'follow', radius: 6, height: 2, side: 3 }), 0, R2.follow);
  near3(E3.pos, [4, 2, 3], 1e-9);
  // focus on what it looks at
  const E4 = evalCamera(cam({ move: 'static', look: 'subject', focusMode: 'subject' }), 0, null, { look: [0, 2, 7] });
  near(E4.focus, 7, 1e-9);
  // an old camera (no ids): the subject by kind follows and is looked at
  const old = resolveTargets(cam({ move: 'orbit', look: 'subject', subject: 'car', subjectIndex: 1 }), T);
  assert.equal(old.follow.id, 'car:jeep:1');
  assert.deepEqual(old.look, [10, 0.8, 0]);
  // a target that is gone: nothing (the camera keeps its own aim)
  assert.equal(resolveTargets(cam({ look: 'subject' }, { lookAt: 'dragon:bronze:4' }), T).look, null);
});

test('subjects have ids and names: dragons by scales, soldiers by squad, cars by kind', () => {
  const world = {
    dragons: [{ p: [0, 0, 0], colours: 'koi' }, { p: [1, 0, 0], colours: 'koi' }, { p: [2, 0, 0] }],
    enemies: [
      { p: [0, 0, 0], unit: 'Alpha', squad: 'CMD' },
      { p: [1, 0, 0], unit: 'Alpha', squad: 'MG', dead: true },
      { p: [2, 0, 0], unit: 'Alpha', squad: 'R1' },
      { p: [3, 0, 0], unit: 'Bravo', squad: 'CMD' },
      { p: [4, 0, 0] },
    ],
    cars: [{ x: 0, y: 0, z: 0, label: 'jeep' }, { x: 1, y: 0, z: 0, label: 'car' }, { x: 2, y: 0, z: 0, label: 'jeep' }],
  };
  const S = subjectsOf(world);
  const labels = S.map((s) => s.label);
  for (const l of ['Dragon (koi)', 'Dragon (koi) 2', 'Dragon (bronze)', 'Alpha squad – man 1 (commander)', 'Alpha squad – man 3 (rifleman)', 'Bravo squad – man 1 (commander)', 'Soldier 1', 'Jeep 1', 'Car 1', 'Jeep 2']) assert.ok(labels.includes(l), l);
  assert.ok(!labels.some((l) => l.startsWith('Alpha squad – man 2')), 'the dead not listed, the others keep their numbers');
  assert.deepEqual(findSubject(S, 'soldier:Alpha:3').p, [2, 0, 0]);
  assert.deepEqual(findSubject(S, 'car:jeep:2').p, [2, 0, 0]);
  assert.equal(findSubject(S, 'nope'), null);
  // ids stay when the world moves on
  world.enemies[0].p = [9, 0, 9];
  assert.deepEqual(findSubject(subjectsOf(world), 'soldier:Alpha:1').p, [9, 0, 9]);
});

test('aim at an object: named, found in the world, an offset on it that turns with it', () => {
  assert.equal(objectName('Watch tower (wood)', ['Watch tower 1']), 'Watch tower 2');
  const scene = { world: { size: [12, 6, 12], h: 0.2 }, objects: [{ type: 'crate', x: 3, z: 4, ref: 'Crate 1' }, { type: 'crate', x: 8, z: 8 }, { type: 'camera', x: 6, z: 1, y: 1.6, params: defaultParams('camera'), keys: [], lookAt: 'obj:Crate 1', lookOffset: [0, 0.5, 0] }] };
  scene.objects[2].params.look = 'subject';
  const { world } = buildScene(scene);
  const objs = objectTargets(flattenObjects(scene.objects), world.origins);
  assert.equal(objs.length, 1, 'only the named ones');
  assert.equal(objs[0].id, 'obj:Crate 1');
  const T = targetsOf(scene, world);
  const c = camerasOf(scene, world)[0];
  assert.equal(c.lookAt, 'obj:Crate 1');
  const R = resolveTargets(c, T);
  near3(R.look, [world.origins[0][0], world.origins[0][1] + 0.5, world.origins[0][2]], 1e-9);
  // an offset in a target's own frame turns with it
  const s = { p: [0, 0, 0], yaw: Math.PI / 2, aim: 1 };
  const q = targetPoint(s, [0, 0, 2]);
  near3(q, [2, 1, 0], 1e-9, 'ahead of it: +x when it heads +x');
  near3(offsetFrom(s, q), [0, 0, 2], 1e-9);
  assert.equal(findTarget(T, 'obj:Crate 1').label, 'Crate 1');
});

test('framing: what it looks at kept on a third of the frame', () => {
  near3(framingOf({ framing: 'left third' }), [-1 / 3, 0]);
  near3(framingOf({ framing: 'custom', frameX: 0.5, frameY: -2 }), [0.5, -0.95]);
  assert.deepEqual(framingOf({}), [0, 0]);
  const pos = [0, 2, 0];
  for (const look of [[10, 2, 30], [-5, 20, 8], [3, -4, -12]]) {
    for (const name of Object.keys(FRAMINGS)) {
      const f = FRAMINGS[name];
      if (!f) continue;
      const target = frameTarget(pos, look, f[0], f[1], 60, 16 / 9);
      const pr = projectInFrame(pos, target, look, 60, 16 / 9);
      assert.ok(pr.z > 0, 'in front');
      near(pr.x, f[0], 1e-6, `${name} x`);
      near(pr.y, f[1], 1e-6, `${name} y`);
    }
  }
  // through the director's frame: the subject on the right third of what the lens sees
  const c = cam({ move: 'static', look: 'subject', framing: 'right third' });
  const F = cameraFrame(c, 0, { look: [20, 2, 20], canvasAspect: 16 / 9 });
  const pr = projectInFrame(F.E.pos, F.E.target, [20, 2, 20], F.lv.hFov, F.lv.frameAspect);
  near(pr.x, 1 / 3, 1e-6);
  near(pr.y, 0, 1e-6);
});

test('a click picks a target: the subject near the ray, else the object hit, else the point', () => {
  const S = [{ kind: 'soldier', id: 'soldier:Alpha:1', p: [0, 0, 10], aim: 1.3 }, { kind: 'dragon', id: 'dragon:koi:1', p: [0, 5, 40], aim: 1 }];
  const ray = { origin: [0, 1, 0], dir: [0, 0, 1] };
  assert.equal(pickTarget(ray, null, S).subject.id, 'soldier:Alpha:1');
  // a wall in between: not the soldier behind it, the wall's object
  const wall = { point: [0, 1, 5], owner: 3 };
  assert.deepEqual(pickTarget(ray, wall, S), { owner: 3, point: [0, 1, 5] });
  // far off to the side: the ground there
  const r2 = { origin: [0, 1, 0], dir: [Math.SQRT1_2, 0, Math.SQRT1_2] };
  assert.deepEqual(pickTarget(r2, { point: [20, 0, 20], owner: -1 }, S), { point: [20, 0, 20] });
  assert.equal(pickTarget(r2, null, S), null);
  // the dragon far away, a little off the ray: within 4 % of its distance
  const r3 = { origin: [0, 6, 0], dir: [0.03, 0, Math.sqrt(1 - 0.03 * 0.03)] };
  assert.equal(pickTarget(r3, null, S).subject.id, 'dragon:koi:1');
});
