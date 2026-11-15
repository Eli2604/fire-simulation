import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PhysicsWorld, Box, Sphere, Capsule, ConvexHull, VoxelSet, cylinderHull, VoxelGridCollider,
  BallJoint, HingeJoint, FixedJoint, DistanceJoint, SliderJoint, surfaceOf, buoyancy, RaycastVehicle, RotorForce,
} from '../src/physics/index.js';
import { qaxis, qrot } from '../src/physics/math.js';
import { createRagdoll, soldierRagdollSpec } from '../src/physics/ragdoll.js';
import { enableRigidBodies } from '../src/physics/simPhysics.js';
import { World } from '../src/sim/world.js';
import { Simulation } from '../src/sim/simulation.js';
import { MAT } from '../src/sim/materials.js';
import { defaultWeather } from '../src/sim/weather.js';
import { createSimulation } from '../src/sim/createSimulation.js';
import { explode } from '../src/sim/explosions.js';
import { addLoose } from '../src/ai/dragonAir.js';
import { REST } from '../src/operator/rig.js';

/** A flat voxel floor (its top at y = h). */
const floor = (h = 0.1, n = 60, mat = 0) => new VoxelGridCollider({ h, nx: n, ny: 30, nz: n, solid: (x, y) => y === 0, material: () => mat });
const run = (w, s) => {
  for (let i = 0; i < Math.round(s * 60); i++) w.step(1 / 60);
};
const len = (v) => Math.hypot(v[0], v[1], v[2]);

test('a stack of boxes stands still and goes to sleep', () => {
  const w = new PhysicsWorld({ collider: floor() });
  const boxes = [];
  for (let k = 0; k < 6; k++) boxes.push(w.createBody({ shape: new Box(0.2, 0.2, 0.2), position: [2, 0.3 + k * 0.405, 2], density: 500 }));
  run(w, 4);
  boxes.forEach((b, k) => {
    assert.ok(Math.abs(b.pos[1] - (0.3 + k * 0.4)) < 0.02, `box ${k} at ${b.pos[1].toFixed(3)}`);
    assert.ok(Math.hypot(b.pos[0] - 2, b.pos[2] - 2) < 0.01, `box ${k} has not slid off (${b.pos[0].toFixed(3)}, ${b.pos[2].toFixed(3)})`);
    assert.ok(b.sleeping, `box ${k} sleeps`);
  });
});

test('friction on a slope: holds below the friction angle, slides at g(sin θ − μ cos θ) above', () => {
  const th = (20 * Math.PI) / 180;
  for (const mu of [0.6, 0.2]) {
    const w = new PhysicsWorld({});
    const q = qaxis([], [0, 0, 1], th);
    w.createBody({ type: 'static', shape: new Box(6, 0.2, 2), position: [0, 0, 0], quaternion: q, friction: 1 });
    const up = qrot([], q, [0, 1, 0]);
    // (a pair combines as √(μa·μb): μ² against the ramp's 1 gives μ)
    const b = w.createBody({ shape: new Box(0.2, 0.2, 0.2), position: [up[0] * 0.401, up[1] * 0.401, 0], quaternion: q, friction: mu * mu });
    run(w, 0.5);
    const p0 = b.pos.slice(), v0 = len(b.vel);
    run(w, 1);
    const d = len([b.pos[0] - p0[0], b.pos[1] - p0[1], 0]);
    const a = Math.max(0, 9.81 * (Math.sin(th) - mu * Math.cos(th)));
    if (mu > Math.tan(th)) assert.ok(d < 0.005, `μ ${mu}: it holds (moved ${d.toFixed(4)} m)`);
    else assert.ok(Math.abs(d - (v0 + a / 2)) < 0.05 * (v0 + a / 2), `μ ${mu}: slid ${d.toFixed(3)} m, expected ${(v0 + a / 2).toFixed(3)}`);
    assert.ok(len(b.angVel) < 0.05, 'it slides, it does not tumble');
  }
});

test('restitution: a ball bounces back to e² of its drop', () => {
  for (const e of [0.3, 0.6, 0.9]) {
    const w = new PhysicsWorld({});
    w.createBody({ type: 'static', shape: new Box(3, 0.1, 3), position: [0, -0.1, 0], restitution: 1 });
    // (√(e²·1) = e)
    const b = w.createBody({ shape: new Sphere(0.1), position: [0, 1.1, 0], restitution: e * e, rollingResistance: 0 });
    let up = false, peak = 0;
    for (let i = 0; i < 150; i++) {
      w.step(1 / 60);
      if (b.vel[1] > 0) up = true;
      if (up) peak = Math.max(peak, b.pos[1] - 0.1);
    }
    assert.ok(Math.abs(peak - e * e) < 0.06 + 0.1 * e * e, `e ${e}: back up ${peak.toFixed(3)} m of 1 m (e² = ${(e * e).toFixed(2)})`);
  }
});

test('contact properties come from the voxel materials', () => {
  const s = (n) => surfaceOf(n);
  assert.ok(s('steel').restitution > s('oak').restitution && s('oak').restitution > s('soil').restitution, 'steel rings back more than wood, wood more than soil');
  assert.ok(s('ice').friction < 0.1 && s('rubber').friction > 0.9, 'ice is slippery, rubber grips');
  assert.equal(surfaceOf(MAT.concrete).name, 'concrete');
  // a steel crate slides further on ice than on concrete
  const slide = (mat) => {
    const C = new VoxelGridCollider({ h: 0.1, nx: 200, ny: 10, nz: 20, solid: (x, y) => y === 0, material: () => mat }); // (a name will do: ice is not a voxel)
    const w = new PhysicsWorld({ collider: C });
    const b = w.createBody({ shape: new Box(0.2, 0.2, 0.2), position: [1, 0.3, 1], velocity: [4, 0, 0], material: 'steel' });
    run(w, 3);
    return b.pos[0] - 1;
  };
  assert.ok(slide('ice') > 3 * slide('concrete'), `on ice ${slide('ice').toFixed(2)} m, on concrete ${slide('concrete').toFixed(2)} m`);
});

test('joints: hinge limits, ball cone, rope, slider, fixed', () => {
  // a bar on a hinge to the world, limited to ±0.5 rad, dropped from horizontal
  const w = new PhysicsWorld({});
  const bar = w.createBody({ shape: new Box(0.5, 0.05, 0.05), position: [0.5, 2, 0], density: 800 });
  const hinge = w.addJoint(new HingeJoint(null, bar, [0, 2, 0], [0, 0, 1], { lower: -0.5, upper: 0.5 }));
  let worst = 0, gap = 0;
  for (let i = 0; i < 180; i++) {
    w.step(1 / 60);
    worst = Math.min(worst, hinge.angle());
    gap = Math.max(gap, len(bar.toWorld(hinge.lb).map((v, k) => v - [0, 2, 0][k])));
  }
  assert.ok(worst > -0.56 && worst < -0.4, `the hinge stops at its lower limit (${worst.toFixed(3)} rad)`);
  assert.ok(gap < 0.01, `the hinge holds together (${gap.toFixed(4)} m)`);

  // a ball joint with a 0.4 rad cone: a hanging rod pushed sideways swings no further
  const w2 = new PhysicsWorld({});
  const rod = w2.createBody({ shape: Capsule.y(0.03, 0.4), position: [0, 1.5, 0] });
  const ball = w2.addJoint(new BallJoint(null, rod, [0, 1.95, 0], { axis: [0, -1, 0], cone: 0.4 }));
  rod.applyImpulse([6, 0, 0], [0, 1.1, 0]);
  let maxCone = 0;
  for (let i = 0; i < 120; i++) {
    w2.step(1 / 60);
    const d = rod.toWorld([0, -1, 0]).map((v, k) => v - rod.pos[k]);
    maxCone = Math.max(maxCone, Math.acos(Math.max(-1, Math.min(1, -d[1] / len(d)))));
  }
  assert.ok(maxCone < 0.46, `the cone holds it (${maxCone.toFixed(3)} rad of 0.4)`);
  assert.ok(ball.active.length >= 3);

  // a rope: slack above, taut at its length
  const w3 = new PhysicsWorld({});
  const bob = w3.createBody({ shape: new Sphere(0.1), position: [0, 1.5, 0] });
  const rope = w3.addJoint(new DistanceJoint(null, bob, [0, 3, 0], [0, 1.5, 0], { rope: true, max: 2 }));
  run(w3, 2);
  assert.ok(Math.abs(rope.length - 2) < 0.02 && Math.abs(bob.pos[1] - 1) < 0.03, `it hangs at the rope's length (${rope.length.toFixed(3)} m)`);

  // a slider: a block on a rail only moves along it, between its limits
  const w4 = new PhysicsWorld({ gravity: [0, -9.81, 0] });
  const rail = w4.createBody({ type: 'static', shape: new Box(1, 0.05, 0.05), position: [0, 1, 0] });
  const car = w4.createBody({ shape: new Box(0.1, 0.1, 0.1), position: [0, 1, 0] });
  const sl = w4.addJoint(new SliderJoint(rail, car, [0, 1, 0], [1, 0, 0], { lower: -0.3, upper: 0.3 }));
  car.applyImpulse([5, 3, 2]);
  run(w4, 1);
  assert.ok(Math.abs(car.pos[1] - 1) < 0.01 && Math.abs(car.pos[2]) < 0.01, 'it stays on the rail');
  assert.ok(sl.position() <= 0.31 && sl.position() > 0.2, `it stops at the end (${sl.position().toFixed(3)} m)`);

  // fixed: two boxes glued, dropped: they land as one
  const w5 = new PhysicsWorld({ collider: floor() });
  const A = w5.createBody({ shape: new Box(0.2, 0.2, 0.2), position: [2, 1, 2] });
  const B = w5.createBody({ shape: new Box(0.2, 0.2, 0.2), position: [2.4, 1.2, 2] });
  w5.addJoint(new FixedJoint(A, B, [2.2, 1.1, 2]));
  run(w5, 3);
  assert.ok(Math.abs(len([B.pos[0] - A.pos[0], B.pos[1] - A.pos[1], B.pos[2] - A.pos[2]]) - Math.hypot(0.4, 0.2)) < 0.01, 'still the same distance apart');
});

test('continuous collision: a fast fragment does not pass through a one-voxel wall', () => {
  const C = new VoxelGridCollider({ h: 0.05, nx: 200, ny: 40, nz: 40, solid: (x) => x === 100, floor: false });
  const tunnelled = { off: 0, on: 0 };
  for (const ccd of [false, 'auto'])
    for (let k = 0; k < 12; k++) {
      const w = new PhysicsWorld({ collider: C, gravity: [0, 0, 0] });
      const b = w.createBody({ shape: new Sphere(0.01), position: [0.5 + k * 0.137, 1, 1], velocity: [400, 0, 0], ccd, density: 7800 });
      run(w, 0.5);
      if (b.pos[0] > 5.05) tunnelled[ccd ? 'on' : 'off']++;
    }
  assert.ok(tunnelled.off > 0, `without it some get through (${tunnelled.off} of 12)`);
  assert.equal(tunnelled.on, 0, 'with it none do');
  // and against a thin body
  const w = new PhysicsWorld({ gravity: [0, 0, 0] });
  w.createBody({ type: 'static', shape: new Box(0.005, 1, 1), position: [3, 1, 1] });
  const b = w.createBody({ shape: new ConvexHull([[0.01, 0, 0], [-0.01, 0, 0], [0, 0.008, 0], [0, -0.008, 0], [0, 0, 0.01], [0, 0, -0.01]]), position: [0.5, 1, 1], velocity: [300, 0, 0] });
  run(w, 0.5);
  assert.ok(b.pos[0] < 3, `stopped at the plate (${b.pos[0].toFixed(3)})`);
});

test('sleeping: at rest it sleeps; hit, it wakes', () => {
  const w = new PhysicsWorld({ collider: floor() });
  const a = w.createBody({ shape: new Box(0.2, 0.2, 0.2), position: [2, 0.3, 2] });
  run(w, 1.5);
  assert.ok(a.sleeping, 'asleep on the floor');
  const ms = w.stats.ms;
  assert.ok(ms < 5, `a sleeping world costs nothing (${ms.toFixed(2)} ms)`);
  const ball = w.createBody({ shape: new Sphere(0.1), position: [1, 0.3, 2], velocity: [6, 0, 0], density: 7800 });
  run(w, 0.3);
  assert.ok(!a.sleeping || a.pos[0] > 2.02, 'the ball woke it and pushed it');
  assert.ok(a.pos[0] > 2.02, `pushed (${a.pos[0].toFixed(3)})`);
  a.applyImpulse([0, 0, 0]);
  run(w, 4);
  assert.ok(a.sleeping && ball.sleeping, 'and both sleep again');
});

test('deterministic: the same scene twice gives the same numbers', () => {
  const scene = () => {
    const w = new PhysicsWorld({ collider: floor(), seed: 11 });
    const r = w.rng;
    for (let k = 0; k < 40; k++) {
      const sh = k % 3 === 0 ? new Box(0.1 + r() * 0.1, 0.1, 0.12) : k % 3 === 1 ? new Sphere(0.08 + r() * 0.05) : Capsule.y(0.06, 0.12);
      w.createBody({ shape: sh, position: [1 + r() * 2, 0.4 + r() * 2, 1 + r() * 2], quaternion: qaxis([], [r(), r(), r()], r() * 3) });
    }
    w.explosion([2, 0.2, 2], { energy: 2e5, radius: 3 });
    run(w, 2);
    return w.bodies.flatMap((b) => [...b.pos, ...b.quat]);
  };
  assert.deepEqual(scene(), scene());
});

test('mass properties: hulls, voxel sets and capsules', () => {
  const box = new Box(0.5, 0.25, 0.1).massProps(1000);
  const pts = [];
  for (let k = 0; k < 8; k++) pts.push([k & 1 ? 0.5 : -0.5, k & 2 ? 0.25 : -0.25, k & 4 ? 0.1 : -0.1]);
  const hull = new ConvexHull(pts);
  assert.equal(hull.faces.length, 6, 'coplanar triangles merged into 6 faces');
  const hp = hull.massProps(1000);
  assert.ok(Math.abs(hp.mass - box.mass) < 1e-6 * box.mass);
  for (let k = 0; k < 9; k++) assert.ok(Math.abs(hp.I[k] - box.I[k]) < 1e-6 * box.I[0] + 1e-9, `inertia ${k}`);
  // 2×2×2 voxels of h = 0.5 are a 1 m cube
  const c = [];
  for (let k = 0; k < 8; k++) c.push([k & 1 ? 0.25 : -0.25, k & 2 ? 0.25 : -0.25, k & 4 ? 0.25 : -0.25]);
  const vs = new VoxelSet(0.5, c, c.map(() => 125)).massProps();
  const cube = new Box(0.5).massProps(1000);
  assert.ok(Math.abs(vs.mass - cube.mass) < 1e-9 && Math.abs(vs.I[0] - cube.I[0]) < 1e-6, 'a voxel set has the inertia of the solid it fills');
  const cyl = cylinderHull(0.3, 0.44, 24).massProps(1000);
  assert.ok(Math.abs(cyl.mass - 1000 * Math.PI * 0.09 * 0.88) / cyl.mass < 0.02, 'a 24-sided drum is close to a cylinder');
  const cap = Capsule.y(0.1, 0.3).massProps(1000);
  assert.ok(cap.I[0] > cap.I[4], 'a capsule is easier to spin about its axis');
});

test('raycasts and sphere casts hit the voxel world and bodies', () => {
  const w = new PhysicsWorld({ collider: floor() });
  const b = w.createBody({ type: 'static', shape: new Box(0.3, 0.3, 0.3), position: [3, 1, 3] });
  const r1 = w.raycast([3, 3, 3], [0, -1, 0], 10);
  assert.equal(r1.body, b);
  assert.ok(Math.abs(r1.point[1] - 1.3) < 1e-6 && r1.normal[1] > 0.99);
  const r2 = w.raycast([1, 3, 1], [0, -1, 0], 10);
  assert.equal(r2.body, null, 'the floor');
  assert.ok(Math.abs(r2.point[1] - 0.1) < 1e-6 && r2.normal[1] === 1);
  const s = w.sphereCast([1, 1, 3], [1, 0, 0], 0.2, 10);
  assert.equal(s.body, b);
  assert.ok(Math.abs(s.t - (2.7 - 0.2 - 1)) < 1e-3, `the sphere stops short by its radius (${s.t.toFixed(4)})`);
  assert.equal(w.raycast([1, 3, 1], [0, 1, 0], 10), null, 'nothing above');
  assert.deepEqual(w.overlapSphere([3, 1.5, 3], 0.25), [b]);
});

test('impact events: materials, impulse, speed and the point', () => {
  const w = new PhysicsWorld({ collider: floor(0.1, 60, MAT.soil) });
  const ev = [];
  w.onImpact((e) => ev.push(e));
  const b = w.createBody({ shape: new Box(0.15, 0.15, 0.15), position: [2, 1.25, 2], material: 'steel' });
  run(w, 1.5);
  assert.ok(ev.length >= 1, 'it was heard');
  const e = ev[0];
  assert.deepEqual(e.materials, ['soil', 'steel']);
  assert.equal(e.a, null);
  assert.equal(e.b, b);
  assert.ok(Math.abs(e.speed - Math.sqrt(2 * 9.81 * 1)) < 0.4, `it hit at ${e.speed.toFixed(2)} m/s`);
  assert.ok(e.impulse > b.mass * 2 && e.energy > 0.4 * b.mass * 9.81, `impulse ${e.impulse.toFixed(1)} N·s, energy ${e.energy.toFixed(0)} J`);
  assert.ok(Math.abs(e.point[1] - 0.1) < 0.05, 'at the floor');
  assert.ok(ev.length < 6, `no stream of events while it lies there (${ev.length})`);
});

test('buoyancy: wood floats half under, steel sinks', () => {
  const w = new PhysicsWorld({ collider: floor() });
  w.addForceGenerator(buoyancy({ level: () => 1.0 }));
  const wood = w.createBody({ shape: new Box(0.2, 0.2, 0.2), position: [1, 1.5, 1], density: 500 });
  const steel = w.createBody({ shape: new Box(0.1, 0.1, 0.1), position: [2, 1.5, 2], density: 7800 });
  run(w, 8);
  assert.ok(Math.abs(wood.pos[1] - 1.0) < 0.04, `the wood floats with its middle at the waterline (${wood.pos[1].toFixed(3)})`);
  assert.ok(Math.abs(steel.pos[1] - 0.2) < 0.02, 'the steel lies on the bottom');
});

test('raycast vehicle: settles on its springs, drives, steers and brakes', () => {
  const G = new VoxelGridCollider({ h: 0.25, nx: 400, ny: 8, nz: 400, solid: (x, y) => y === 0, material: () => MAT.concrete });
  const w = new PhysicsWorld({ collider: G });
  const ch = w.createBody({ shape: new Box(0.85, 0.3, 2.0), position: [50, 1.2, 20], mass: 1200, material: 'steel' });
  const wheels = [[0.8, 1.4, 1], [-0.8, 1.4, 1], [0.8, -1.4, 0], [-0.8, -1.4, 0]].map(([x, z, f]) => ({ pos: [x, -0.2, z], radius: 0.33, rest: 0.35, stiffness: 35000, damping: 3500, steer: !!f, drive: !f }));
  const car = new RaycastVehicle(w, ch, { wheels });
  run(w, 2);
  const sag = (1200 * 9.81) / 4 / 35000;
  for (const wh of car.wheels) assert.ok(wh.contact && Math.abs(wh.compression - sag) < 0.01, `each spring carries a quarter (${wh.compression.toFixed(3)} m)`);
  assert.ok(len(ch.vel) < 0.02, 'standing');
  car.controls.throttle = 1;
  run(w, 4);
  assert.ok(car.speed > 8 && Math.abs(ch.pos[0] - 50) < 0.1, `drives straight ahead (${car.speed.toFixed(1)} m/s)`);
  const yaw = () => Math.atan2(ch.R[2], ch.R[8]);
  const y0 = yaw();
  car.controls.steer = 0.3;
  run(w, 2);
  assert.ok(yaw() - y0 > 0.4, `turns left (${(yaw() - y0).toFixed(2)} rad)`);
  Object.assign(car.controls, { steer: 0, throttle: 0, brake: 1 });
  run(w, 5);
  assert.ok(Math.abs(car.speed) < 0.1, 'brakes to a stop');
  assert.ok(ch.pos[1] > 0.7, 'on its wheels');
});

test('rotor force: the hover collective holds it, more climbs', () => {
  const w = new PhysicsWorld({});
  const heli = w.createBody({ shape: new Box(1, 0.8, 3), position: [0, 50, 0], mass: 2500 });
  const r = new RotorForce(heli, { hub: [0, 1, 0], maxThrust: 50000, torqueRatio: 0 });
  r.controls.collective = r.hoverCollective();
  run(w, 3);
  assert.ok(Math.abs(heli.pos[1] - 50) < 0.01, `hovers (${heli.pos[1].toFixed(3)})`);
  r.controls.collective *= 1.2;
  run(w, 2);
  assert.ok(heli.pos[1] > 53 && heli.vel[1] > 3, 'climbs');
  r.controls.pitch = 0.1;
  run(w, 2);
  assert.ok(heli.vel[2] < -0.5 || heli.vel[2] > 0.5, 'tilting the disc moves it along');
});

test('ragdoll: the soldier falls in a heap without exploding', () => {
  const R = Object.fromEntries(Object.entries(REST).map(([k, v]) => [k, v.toArray()]));
  const w = new PhysicsWorld({ collider: floor(0.1, 60) });
  const q = qaxis([], [1, 0, 0.3], 0.25);
  const rd = createRagdoll(w, soldierRagdollSpec(R), { pose: (b) => { const p = qrot([], q, R[b]); return { position: [p[0] + 3, p[1] + 0.2, p[2] + 3], quaternion: q }; }, velocity: [0.6, 0, 1.2] });
  assert.equal(Object.keys(rd.bodies).length, 11);
  assert.ok(Math.abs(Object.values(rd.bodies).reduce((s, b) => s + b.mass, 0) - 80) < 1e-6, '80 kg');
  let maxV = 0, gap = 0;
  for (let i = 0; i < 300; i++) {
    w.step(1 / 60);
    maxV = Math.max(maxV, rd.maxSpeed());
    for (const j of rd.joints) gap = Math.max(gap, len(j.a.toWorld(j.la).map((v, k) => v - j.b.toWorld(j.lb)[k])));
  }
  assert.ok(maxV < 9, `no part flies off (fastest ${maxV.toFixed(2)} m/s)`);
  assert.ok(gap < 0.03, `the joints hold (${gap.toFixed(3)} m)`);
  for (const b of Object.values(rd.bodies)) assert.ok(b.pos[1] > 0.1 && b.pos[1] < 0.6, `${b.userData.part} lies on the floor (${b.pos[1].toFixed(2)})`);
  for (const j of rd.joints.filter((j) => j.type === 'hinge')) assert.ok(j.angle() > j.lower - 0.1 && j.angle() < j.upper + 0.1, 'elbows and knees bend only their way');
  run(w, 3);
  assert.ok(rd.atRest(), 'and lies still');
  const bones = rd.bones();
  assert.ok(bones.has('hips') && bones.has('shinL') && bones.get('hips').position[1] < 0.5);
  rd.remove();
  assert.equal(w.bodies.length, 0);
  assert.equal(w.joints.length, 0);
});

test('voxel debris: a detached chunk falls as one body, rests and is stamped back with its state', () => {
  const w = new World({ size: [2, 2, 2], h: 0.05 });
  for (let z = 0; z < w.nz; z++) for (let x = 0; x < w.nx; x++) w.setVoxel(w.idx(x, 0, z), MAT.soil, { anchored: true });
  const cells = [];
  for (let x = 14; x < 24; x++) for (let y = 20; y < 23; y++) for (let z = 18; z < 21; z++) cells.push(w.idx(x, y, z));
  for (const i of cells) w.setVoxel(i, MAT.oak);
  for (const i of cells) w.char[i] = 0.6; // (charred: that goes with it)
  const sim = new Simulation(w, defaultWeather());
  const R = enableRigidBodies(sim);
  const ev = [];
  R.onImpact((e) => ev.push(e));
  let flew = false, landed = false;
  for (let k = 0; k < 120 && !landed; k++) {
    sim.step(sim.dt);
    if (R.chunks.length) {
      flew = true;
      assert.equal(R.chunks[0].n, 90);
      assert.equal(w.rigidChunks.length, 1, 'listed for drawing');
    } else if (flew) landed = true;
  }
  assert.ok(flew && landed, 'it flew and landed');
  assert.ok(ev.length >= 1 && ev[0].materials.includes('oak'), 'it hit the ground');
  assert.ok(w.events.some((e) => e.type === 'impact' && e.kind === 'rigid'), 'and the sound got it');
  let n = 0, top = 0, ch = 0;
  for (let i = 0; i < w.N; i++)
    if (w.mat[i] === MAT.oak) {
      n++;
      top = Math.max(top, w.coords(i)[1]);
      ch += w.char[i];
    }
  assert.equal(n, 90, 'every voxel is back in the grid');
  assert.ok(top <= 4, `on the ground (top row ${top})`);
  assert.ok(Math.abs(ch / n - 0.6) < 1e-6, 'with its char');
  assert.equal(R.stats.lost, 0);
  // stamped back it stays: supported by the ground, it is not taken again
  for (let k = 0; k < 10; k++) sim.step(sim.dt);
  assert.equal(R.chunks.length, 0);
});

test('a blast knocks a loose crate flying as a rigid body; it lands where it lands', () => {
  const sim = createSimulation({ world: { size: [12, 6, 12], h: 0.2 }, weather: { ...defaultWeather(), windSpeed: 0 }, noFire: true, rigidBodies: true });
  const w = sim.world;
  const groundY = (() => {
    for (let y = w.ny - 1; y >= 0; y--) if (w.mat[w.idx(30, y, 30)]) return (y + 1) * w.h;
    return 0;
  })();
  const crate = addLoose(w, 'crate', [6, groundY + 0.3, 6]);
  explode(sim, [5.2, groundY + 0.2, 6], 2e5, { flash: false });
  assert.ok(sim.rigid.loose.has(crate), 'the crate is a body now');
  const b = sim.rigid.loose.get(crate);
  assert.ok(len(b.vel) > 1, `thrown (${len(b.vel).toFixed(1)} m/s)`);
  for (let t = 0; t < 8; t += sim.dt) sim.step(sim.dt);
  assert.ok(crate.p[0] > 6.3, `away from the blast (${crate.p[0].toFixed(2)})`);
  assert.ok(Math.abs(crate.p[1] - groundY) < 0.45, `back on the ground (${crate.p[1].toFixed(2)} over ${groundY.toFixed(2)})`);
  assert.ok(b.sleeping && !crate.flying, 'at rest');
});

test('performance: two hundred bodies settle and sleep within budget', () => {
  const w = new PhysicsWorld({ collider: floor(0.1, 100), seed: 3 });
  const r = w.rng;
  for (let k = 0; k < 200; k++) {
    const t = k % 3;
    const sh = t === 0 ? new Box(0.15 + r() * 0.1, 0.15, 0.15) : t === 1 ? new Sphere(0.12 + r() * 0.05) : Capsule.y(0.08, 0.15);
    w.createBody({ shape: sh, position: [1 + r() * 8, 0.4 + r() * 1.5, 1 + r() * 8], density: 600 });
  }
  let total = 0;
  for (let i = 0; i < 360; i++) {
    w.step(1 / 60);
    total += w.stats.ms;
  }
  assert.equal(w.stats.awake, 0, 'all asleep');
  assert.ok(total / 360 < 60, `mean ${(total / 360).toFixed(1)} ms per step`);
  w.step(1 / 60);
  assert.ok(w.stats.ms < 5, `asleep they cost almost nothing (${w.stats.ms.toFixed(2)} ms)`);
});

test('floating debris: a wooden chunk that falls into a pond floats (and is not stamped into the water)', () => {
  const w = new World({ size: [2, 2, 2], h: 0.05 });
  for (let z = 0; z < w.nz; z++) for (let x = 0; x < w.nx; x++) w.setVoxel(w.idx(x, 0, z), MAT.soil, { anchored: true });
  // a pond 0.5 m deep with walls
  for (let z = 0; z < w.nz; z++)
    for (let x = 0; x < w.nx; x++)
      for (let y = 1; y <= 10; y++) {
        const edge = x === 0 || z === 0 || x === w.nx - 1 || z === w.nz - 1;
        w.setVoxel(w.idx(x, y, z), edge ? MAT.stone : MAT.water, edge ? { anchored: true } : {});
      }
  for (let x = 16; x < 24; x++) for (let y = 26; y < 28; y++) for (let z = 18; z < 22; z++) w.setVoxel(w.idx(x, y, z), MAT.pine);
  const sim = new Simulation(w, defaultWeather());
  const R = enableRigidBodies(sim);
  for (let t = 0; t < 6; t += sim.dt) sim.step(sim.dt);
  assert.equal(R.chunks.length, 1, 'still a body: afloat');
  const b = R.chunks[0].body;
  assert.ok(b.submerged > 0, 'in the water');
  assert.ok(b.pos[1] > 0.45 && b.pos[1] < 0.6, `floating at the surface (${b.pos[1].toFixed(3)}, the water's top at 0.55)`);
});

test('figure ragdoll: blends from the animated pose to the ragdoll and lies down', async () => {
  const THREE = await import('three');
  const { BONES } = await import('../src/operator/rig.js');
  const { FigureRagdoll } = await import('../src/operator/ragdoll.js');
  // the operator figure's skeleton (as OperatorFigure builds it), standing at (3, 0.1, 3)
  const group = new THREE.Group();
  group.position.set(3, 0.1, 3);
  const bones = {};
  for (const [n, par] of BONES) {
    const b = new THREE.Bone();
    b.position.copy(REST[n]).sub(par ? REST[par] : new THREE.Vector3());
    bones[n] = b;
    if (par) bones[par].add(b);
  }
  group.add(bones.root);
  bones.spine.rotation.x = 0.4; // (bent forward, as he was hit)
  group.updateMatrixWorld(true);
  const figure = { group, bones };
  const hip0 = bones.hips.getWorldPosition(new THREE.Vector3());
  const spineQ = bones.spine.getWorldQuaternion(new THREE.Quaternion());
  const w = new PhysicsWorld({ collider: floor(0.1, 60), substeps: 3 });
  const r = new FigureRagdoll(figure, w, { blend: 0.3, velocity: [0, 0, 1] });
  r.apply(0);
  assert.ok(bones.hips.getWorldPosition(new THREE.Vector3()).distanceTo(hip0) < 1e-6, 'at first exactly the animated pose');
  assert.ok(bones.spine.getWorldQuaternion(new THREE.Quaternion()).angleTo(spineQ) < 1e-4);
  for (let i = 0; i < 240; i++) {
    w.step(1 / 60);
    r.apply(1 / 60);
  }
  const hip = bones.hips.getWorldPosition(new THREE.Vector3());
  assert.ok(hip.y < 0.45, `lying down (hips at ${hip.y.toFixed(2)} m)`);
  const head = bones.head.getWorldPosition(new THREE.Vector3());
  assert.ok(head.y < 0.5 && head.y > 0.1, `the head on the floor (${head.y.toFixed(2)})`);
  // the bones follow the bodies
  const spineBody = r.ragdoll.bodies.torso;
  const q = bones.spine.getWorldQuaternion(new THREE.Quaternion());
  assert.ok(q.angleTo(new THREE.Quaternion(...spineBody.quat)) < 0.05, 'the spine bone is the torso body');
  r.dispose();
  assert.equal(w.bodies.length, 0);
});
