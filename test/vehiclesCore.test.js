import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carSpec, makeCar, stepCar, pedals, startEngine, massOf } from '../src/sim/carPhysics.js';
import { newCar, stepCarList } from '../src/sim/cars.js';
import { placeRowBoat } from '../src/models/rowBoat.js';
import { launchBoat, stepBoat, stepBoats, castOff } from '../src/sim/boats.js';
import { toWorld } from '../src/sim/buoyancy.js';
import { boatSfxSound } from '../src/audio/boatSound.js';
import { Helicopter } from '../src/ai/helicopter.js';
import { DistanceJoint } from '../src/physics/joints.js';
import { VEHICLE_PHYSICS, vehiclePhysics } from '../src/physics/vehicleCore.js';

/*
 * The vehicles on the rigid-body core (physics/carCore.js, boatCore.js, heliCore.js): what the old
 * models could not do. (The old behaviour itself is the other vehicle tests', run on the core.)
 */

test('the core is the default for cars, boats and the helicopter; a vehicle can be set back to the old model', () => {
  for (const k of ['car', 'boat', 'heli']) assert.equal(VEHICLE_PHYSICS[k], process.env.VEHICLE_PHYSICS === 'legacy' ? 'legacy' : 'core');
  assert.equal(vehiclePhysics({ physics: 'legacy' }, 'car'), 'legacy');
});

/** A car on a heightfield, driven at speed v straight along +x, then the wheel put over (steer, + left). */
function swerve(params, slopeDeg, v, steer) {
  const k = Math.tan((slopeDeg * Math.PI) / 180);
  // (the ground falls away to its right: +z)
  const env = { ground: (x, z) => ({ y: -k * z, mu: 1, road: true }) };
  const c = makeCar(carSpec(params), {});
  startEngine(c);
  for (let t = 0; t < 1.5; t += 0.02) {
    c.input = { throttle: 0, brake: 1, steer: 0 };
    stepCar(c, 0.02, env);
  }
  let maxRoll = 0, speed = 0;
  for (let t = 0; t < 14; t += 0.02) {
    const turn = t > 8;
    if (!turn) speed = c.u;
    c.input = { ...pedals(c, turn ? 0 : Math.max(0, Math.min(1, (v - c.u) * 0.5)), 0), steer: turn ? steer : 0 };
    stepCar(c, 0.02, env);
    maxRoll = Math.max(maxRoll, Math.abs(c.roll));
  }
  return { c, maxRoll, speed };
}

test('rollover: a jeep put hard over at speed across a steep slope tips onto its side; on the flat, or a low car, it does not', { skip: process.env.VEHICLE_PHYSICS === 'legacy' }, () => {
  const jeep = { length: 4.4, width: 1.9, height: 1.9 };
  const slope = swerve(jeep, 20, 15, 1);
  assert.ok(slope.speed > 13, `at speed (${slope.speed.toFixed(1)} m/s)`);
  assert.ok(slope.maxRoll > 1.4 && Math.abs(slope.c.roll) > 1.2, `rolled over (${slope.c.roll.toFixed(2)} rad, at most ${slope.maxRoll.toFixed(2)})`);
  assert.ok(slope.c.air, 'its wheels off the ground');
  // the same on the flat: it slides and leans, but stays on its wheels
  const flat = swerve(jeep, 0, 20, 1);
  assert.ok(flat.maxRoll < 0.3 && !flat.c.air && !flat.c.upturned, `upright on the flat (${flat.maxRoll.toFixed(2)} rad)`);
  // a low car on the slope: it slides down it rather than tip
  const car = swerve({}, 20, 20, 1);
  assert.ok(car.maxRoll < 0.6 && !car.c.upturned, `the car stays upright (${car.maxRoll.toFixed(2)} rad)`);
});

test('two cars: the one rolling into the other hands it its momentum (a real contact, not a box push)', { skip: process.env.VEHICLE_PHYSICS === 'legacy' }, () => {
  const a = newCar({}, { x: 0, z: 0, yaw: 0, id: 'a' }), b = newCar({}, { x: 9, z: 0, yaw: 0, id: 'b' });
  for (const c of [a, b]) Object.assign(c, { player: true, mode: 'N', gear: 0, input: { throttle: 0, brake: 0, steer: 0 } });
  a.vx = a.u = 10;
  const ma = massOf(a), mb = massOf(b);
  const p = () => ma * a.vx + mb * b.vx;
  let gap = Infinity, p0 = p(), p1 = null, n = 0;
  for (let t = 0; t < 2.5; t += 0.02) {
    stepCarList([a, b], 0.02, {});
    gap = Math.min(gap, b.x - a.x);
    if (b.vx < 0.01) p0 = p();
    else if (++n === 3) p1 = p(); // (just after: before b's wheels, spun up from rest, take some back)
  }
  assert.ok(p1 !== null, 'b was hit');
  assert.ok(b.vx > 4 && a.vx < 4, `momentum handed on: a ${a.vx.toFixed(2)} m/s, b ${b.vx.toFixed(2)} m/s`);
  assert.ok(Math.abs(p1 - p0) / p0 < 0.03, `kept through the impact: ${p0.toFixed(0)} → ${p1.toFixed(0)} kg m/s`);
  assert.ok(gap > (a.spec.L + b.spec.L) / 2 - 0.15, `not through each other (${gap.toFixed(2)} m apart)`);
  assert.ok(a.damage > 0 && b.damage > 0 && a.sfx.some((e) => e.kind === 'crash'), 'both damaged, the crash heard');
  assert.ok(Math.abs(a.yaw) < 0.15 && Math.abs(b.yaw) < 0.15 && Math.abs(b.z) < 1, `square on: along the line (yaw ${a.yaw.toFixed(2)}, ${b.yaw.toFixed(2)})`);
});

const boat = (at = {}, params = {}) => launchBoat(placeRowBoat({ moored: false, ...params }, [0, 0, 0], 0.1).floats[0], at);

test('two boats: one drifting into the other bumps it along (hull against hull); on the old model they pass through', () => {
  const run = (physics) => {
    const a = boat({ x: 0, z: 0 }), b = boat({ x: 6, z: 0 });
    a.physics = b.physics = physics;
    a.body.vx = 1.5;
    let minGap = Infinity;
    for (let t = 0; t < 8; t += 0.05) {
      stepBoats([a, b], 0.05, { level: 0 });
      minGap = Math.min(minGap, b.body.X - a.body.X);
    }
    return { a, b, minGap };
  };
  if (process.env.VEHICLE_PHYSICS === 'legacy') return;
  const { a, b, minGap } = run('core');
  const L = a.body.hull.L;
  assert.ok(b.body.X > 6.5 && b.body.vx > 0.15, `b pushed on (${b.body.X.toFixed(2)} m, ${b.body.vx.toFixed(2)} m/s)`);
  assert.ok(minGap > L - 0.35, `the hulls met, not through (centres ${minGap.toFixed(2)} m apart, ${L} m long)`);
  assert.ok(b.body.X > a.body.X, 'a behind b');
  const bump = [...a.sfx, ...b.sfx].find((e) => e.kind === 'bump');
  assert.ok(bump && boatSfxSound(bump).layers.length > 0, 'the knock heard');
  const old = run('legacy');
  assert.ok(old.minGap < L - 1, `the old model: through each other (${old.minGap.toFixed(2)} m)`);
});

test('moored: the painter is a rope joint from the stem to the ring, slack inside its length, taut it holds the boat against the current; cast off, it goes', { skip: process.env.VEHICLE_PHYSICS === 'legacy' }, () => {
  const m = launchBoat(placeRowBoat({ moored: true, mooring: 2 }, [0, 0, 0], 0.1).floats[0]);
  const run = (s, env) => {
    for (let t = 0; t < s; t += 0.05) stepBoat(m, 0.05, { level: 0, ...env });
  };
  run(0.1, {});
  assert.ok(m.core.joint instanceof DistanceJoint && m.core.joint.min === 0, 'a rope (max only)');
  run(60, { current: [-0.6, 0.3] });
  const bow = toWorld(m.body, m.mooring.at);
  const d = Math.hypot(bow[0] - m.mooring.anchor[0], bow[2] - m.mooring.anchor[2]);
  assert.ok(d < m.mooring.length + 0.1 && d > m.mooring.length - 0.3, `at the end of its line (${d.toFixed(2)} m of ${m.mooring.length})`);
  assert.ok(m.mooring.taut && m.mooring.tension > 5, `taut (${m.mooring.tension.toFixed(0)} N)`);
  assert.ok(Math.hypot(m.body.vx, m.body.vz) < 0.1, 'held there');
  // the current downstream of the ring lies along the line: the stem points up-current
  const head = [Math.cos(m.body.yaw), -Math.sin(m.body.yaw)];
  assert.ok(head[0] * 0.6 - head[1] * 0.3 > 0.4, 'it swung head to the current');
  castOff(m);
  run(0.1, {});
  assert.equal(m.core.joint, null, 'the joint gone with the line');
  run(20, { current: [-0.6, 0.3] });
  assert.ok(Math.hypot(m.body.X - bow[0], m.body.Z - bow[2]) > 6, 'cast off, it drifts away');
});

/** A helicopter hovering over flat ground (y = 0); a part shot away. */
function heliDown(part, alt, side = 0) {
  const world = { time: 0, events: [], noises: [], enemies: [], ropes: [] };
  const h = new Helicopter({ p: [0, 0, 0], lz: [0, 0, 0], seed: 5, startAlt: alt, startSpeed: 0, mission: 'hover', hoverAlt: alt, ropeLength: alt + 10 }, { world, sim: { world, solid: (x, y) => y < 0 }, addCrew: (e) => world.enemies.push(e) });
  for (let t = 0; t < 1; t += 0.05) h.step(0.05);
  h.v[0] = side;
  h.hit(part, 2000);
  for (let t = 0; t < 30 && !(h.core?.free && h.core.body.sleeping); t += 0.05) {
    world.time += 0.05;
    h.step(0.05);
  }
  // its lowest point (the airframe's parts: the skids, the cabin's corners, the boom)
  const B = h.core.body;
  let low = Infinity;
  for (const c of B.shape.children) {
    const r = c.shape.r ?? 0;
    for (const q of c.shape.verts ?? [c.shape.a, c.shape.b]) low = Math.min(low, B.shapeToWorld([q[0] + c.pos[0], q[1] + c.pos[1], q[2] + c.pos[2]])[1] - r);
  }
  return { h, B, low, up: B.R[4] };
}

test('a helicopter coming down: autorotated to a hard landing it stands on its skids; the rotor shot away with way on sideways, it rolls over and lies on its side or roof', { skip: process.env.VEHICLE_PHYSICS === 'legacy' }, () => {
  const eng = heliDown('engine', 40);
  assert.equal(eng.h.severity, 'hard');
  assert.ok(eng.h.core.free && eng.B.sleeping, 'a free body, come to rest');
  assert.ok(eng.up > 0.95 && Math.abs(eng.h.p[1]) < 0.05, `on its skids (up ${eng.up.toFixed(2)}, skids at ${eng.h.p[1].toFixed(2)} m)`);
  assert.ok(Math.abs(eng.low) < 0.05, `on the ground, not in it (${eng.low.toFixed(3)} m)`);
  const rolled = heliDown('rotor', 30, 8);
  assert.equal(rolled.h.severity, 'destroyed');
  assert.ok(rolled.B.sleeping, 'come to rest');
  assert.ok(rolled.up < 0.5 && Math.abs(rolled.h.roll) > 1, `over (up ${rolled.up.toFixed(2)}, roll ${rolled.h.roll.toFixed(2)} rad)`);
  assert.ok(rolled.low > -0.05 && rolled.low < 0.05, `lying on the ground (${rolled.low.toFixed(3)} m)`);
  assert.ok(rolled.h.p[1] > 0.5, `its skids off the ground (${rolled.h.p[1].toFixed(2)} m)`);
});
