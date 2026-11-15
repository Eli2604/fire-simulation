import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../src/sim/createSimulation.js';
import { initCars, newCar, stepCarList, boardCar } from '../src/sim/cars.js';
import { carSpec, makeCar, stepCar, pedals, startEngine } from '../src/sim/carPhysics.js';
import { explode } from '../src/sim/explosions.js';
import { MAT } from '../src/sim/materials.js';
import { placeRowBoat } from '../src/models/rowBoat.js';
import { launchBoat, stepBoat, stepBoats } from '../src/sim/boats.js';
import { Helicopter } from '../src/ai/helicopter.js';
import { heliBodyMass } from '../src/physics/heliCore.js';

/*
 * One physics world for everything (physics/vehicleCore.js sharedWorld): the cars, the boats, the
 * helicopters, sim.rigid's debris, the people near a car and the carrier's hull meet each other.
 */
const legacyRun = process.env.VEHICLE_PHYSICS === 'legacy';

/** Helicopters in a simulation (flat soil), spec objects as a scene places them in world.helis. */
function heliScene(size, objects = [], h = 0.5) {
  return createSimulation({ world: { size, h, ground: 'soil' }, objects, noFire: true });
}
const heliSpec = (o) => ({ yaw: 0, mission: 'hover', startSpeed: 0, seed: 3, soldiers: 0, doorGuns: 'none', side: 'friendly', ...o });

test('two helicopters flown into each other: both crash (damaged), tumble as free bodies and come down apart, not through each other', { skip: legacyRun }, () => {
  const sim = heliScene([80, 6, 30]);
  const w = sim.world;
  w.helis = [
    heliSpec({ p: [10, 0, 15], lz: [75, 0, 15], yaw: Math.PI / 2, altitude: 10, startAlt: 10, hoverAlt: 10, startSpeed: 15, seed: 3 }),
    heliSpec({ p: [70, 0, 15], lz: [5, 0, 15], yaw: -Math.PI / 2, altitude: 10, startAlt: 10, hoverAlt: 10, startSpeed: 15, seed: 4 }),
  ];
  let spin = 0;
  for (let t = 0; t < 10; t += 0.05) {
    sim.step(0.05);
    for (const s of w.helis) if (s.ai.core?.free) spin = Math.max(spin, Math.hypot(...s.ai.core.body.angVel));
  }
  const [a, b] = w.helis.map((s) => s.ai);
  assert.equal(a.core.world, b.core.world, 'one world');
  assert.ok(a.crashed && b.crashed, 'both crashed');
  assert.ok(a.severity && b.severity, `both damaged (${a.severity}, ${b.severity})`);
  assert.ok(a.core.free && b.core.free, 'free bodies');
  assert.ok(spin > 0.3, `they tumbled (${spin.toFixed(2)} rad/s)`);
  assert.ok(b.p[0] - a.p[0] > 5, `apart, each on its own side (${a.p[0].toFixed(1)}, ${b.p[0].toFixed(1)})`);
  assert.ok(a.p[1] < 1.5 && b.p[1] < 1.5, 'come down');
});

test('a helicopter on a car: landing, it stands on its roof; its rotor shot away above it, it comes down on it: the car crushed down, damaged, the wreck lying on it', { skip: legacyRun }, () => {
  const car = { type: 'car', params: { length: 5.5, width: 2.3, height: 2.2 }, x: 20, z: 15, rotation: 0 };
  // landing on it
  {
    const sim = heliScene([40, 6, 30], [car], 0.25);
    const w = sim.world;
    const c = initCars(w)[0];
    for (let t = 0; t < 0.5; t += 0.05) sim.step(0.05);
    w.helis = [heliSpec({ p: [20.3, 0, 15], lz: [20.3, 0, 15], mission: 'land', altitude: 8, startAlt: 8 })];
    for (let t = 0; t < 15; t += 0.05) sim.step(0.05);
    const h = w.helis[0].ai;
    assert.ok(h.landed && !h.crashed, `landed (${h.mode})`);
    assert.ok(h.p[1] > c.y + c.spec.H * 0.9, `on the roof (skids at ${h.p[1].toFixed(2)} m, the car ${c.spec.H} m tall)`);
  }
  // coming down on it
  {
    const sim = heliScene([40, 6, 30], [car], 0.25);
    const w = sim.world;
    const c = initCars(w)[0];
    for (let t = 0; t < 0.5; t += 0.05) sim.step(0.05);
    w.helis = [heliSpec({ p: [20.3, 0, 15], lz: [20.3, 0, 15], altitude: 9, startAlt: 9, hoverAlt: 9 })];
    for (let t = 0; t < 1; t += 0.05) sim.step(0.05);
    const h = w.helis[0].ai;
    const y0 = c.y;
    h.hit('rotor', 2000);
    let low = Infinity;
    for (let t = 0; t < 12; t += 0.05) {
      sim.step(0.05);
      low = Math.min(low, c.y);
    }
    assert.ok(h.crashed && h.core.free, 'a wreck');
    assert.ok(c.struck?.by === 'heli' && c.damage > 0.1, `the car hit by it, damaged (${c.damage.toFixed(2)})`);
    assert.ok(low < y0 - 0.1, `pressed down on its springs (${(y0 - low).toFixed(2)} m)`);
    assert.ok(h.p[1] > 1, `the wreck on the car, not through it (${h.p[1].toFixed(2)} m)`);
    assert.equal(h.core.under?.body?.userData?.vehicle, 'car', 'lying on the car');
  }
});

test('debris: a chunk knocked flying into a parked car pushes it and dents it (damage, a knock heard)', { skip: legacyRun }, () => {
  const sim = createSimulation({ world: { size: [20, 5, 14], h: 0.2 }, weather: { ambient: 15, windSpeed: 0 }, noFire: true, rigidBodies: true, objects: [{ type: 'car', params: {}, x: 8, z: 7, rotation: 0 }] });
  const w = sim.world;
  const c = initCars(w)[0];
  for (let t = 0; t < 1; t += 1 / 30) sim.step(1 / 30);
  assert.equal(w._physicsWorld, sim.rigid.physics, 'the cars are in sim.rigid\'s world');
  assert.ok(c.core.body.sleeping, 'parked: asleep');
  const z0 = c.z;
  // a 0.6 m block of concrete (~500 kg) beside it, knocked at it
  const cells = [];
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++) {
    const i = w.idx(38 + x, 3 + y, 50 + z);
    w.setVoxel(i, MAT.concrete);
    cells.push(i);
  }
  sim.rigid.knockChunk(cells, [0, 1, -12]);
  let vmax = 0;
  for (let t = 0; t < 3; t += 1 / 30) {
    sim.step(1 / 30);
    vmax = Math.max(vmax, Math.hypot(c.vx, c.vz));
  }
  assert.ok(vmax > 1 && c.z < z0 - 0.5, `pushed (${vmax.toFixed(2)} m/s, ${(z0 - c.z).toFixed(2)} m)`);
  assert.ok(c.dents >= 1 && c.damage > 0.01 && c.struck.by === 'debris', `dented (${c.damage.toFixed(3)})`);
  assert.ok(c.sfx.some((e) => e.kind === 'crash' || e.kind === 'thud'), 'heard');
});

test('an explosion under one side of a car rolls it over onto its side; damaged', { skip: legacyRun }, () => {
  const sim = createSimulation({ world: { size: [20, 5, 12], h: 0.2 }, weather: { ambient: 15, windSpeed: 0 }, noFire: true, objects: [{ type: 'car', params: {}, x: 8, z: 6, rotation: 0 }] });
  const w = sim.world;
  const c = initCars(w)[0];
  for (let t = 0; t < 1; t += 1 / 30) sim.step(1 / 30);
  explode(sim, [c.x, 0.1, c.z + 0.6], 2e7, { name: 'charge', flash: false });
  let maxRoll = 0;
  for (let t = 0; t < 5; t += 1 / 30) {
    sim.step(1 / 30);
    maxRoll = Math.max(maxRoll, Math.abs(c.roll));
  }
  assert.ok(c.blasted?.dv > 1, 'the blast pushed its body');
  assert.ok(maxRoll > 1.4 && Math.abs(c.roll) > 1.1, `over on its side (roll ${c.roll.toFixed(2)}, at most ${maxRoll.toFixed(2)})`);
  assert.ok(c.y > 0.5, `lying on its side (${c.y.toFixed(2)} m up)`);
  assert.ok(c.damage > 0.2, `damaged (${c.damage.toFixed(2)})`);
});

test('two cars head on, square: they bounce back symmetrically (the restitution of all the contact points together), no yaw', { skip: legacyRun }, () => {
  for (const v of [8, 15]) {
    const a = newCar({}, { x: 0, z: 0, yaw: 0, id: 'a' }), b = newCar({}, { x: 9, z: 0, yaw: Math.PI, id: 'b' });
    for (const c of [a, b]) Object.assign(c, { player: true, mode: 'N', gear: 0, input: { throttle: 0, brake: 0, steer: 0 } });
    a.vx = v;
    b.vx = -v;
    let yaw = 0, side = 0;
    for (let t = 0; t < 2; t += 0.02) {
      stepCarList([a, b], 0.02, {});
      yaw = Math.max(yaw, Math.abs(a.yaw), Math.abs(Math.atan2(Math.sin(b.yaw - Math.PI), Math.cos(b.yaw - Math.PI))));
      side = Math.max(side, Math.abs(a.z), Math.abs(b.z));
    }
    // (at 8 m/s each they bounce back, e = 0.2; at 15 the crumpling takes it all)
    if (v === 8) assert.ok(a.vx < -0.3 && b.vx > 0.3, `they bounced apart (${a.vx.toFixed(2)}, ${b.vx.toFixed(2)} m/s)`);
    assert.ok(Math.abs(a.vx + b.vx) < 0.02 && Math.abs(a.x + b.x - 9) < 0.02, `symmetric (${a.vx.toFixed(3)} / ${b.vx.toFixed(3)} m/s)`);
    assert.ok(yaw < 0.01 && side < 0.01, `no spurious yaw at ${v} m/s each (${yaw.toExponential(1)} rad, ${side.toExponential(1)} m aside)`);
    assert.ok(a.damage > 0 && Math.abs(a.damage - b.damage) < 1e-9, 'both damaged alike');
  }
});

test('the carrier\'s hull is a body: a boat set against its side by the current stops there (a knock on steel); on the old model it goes through', () => {
  const ship = { type: 'carrierHull', p: [0, -4, 0], hx: 30, hz: 10, D: 11, draft: 4, heading: 0 };
  const run = (physics) => {
    const f = launchBoat(placeRowBoat({ moored: false }, [0, 0, 0], 0.1).floats[0], { x: 0, z: 12.5 });
    f.physics = physics;
    f.body.vz = -2.5;
    let minZ = Infinity;
    for (let t = 0; t < 8; t += 0.05) {
      stepBoats([f], 0.05, { level: 0, ship, current: [0, -0.8] });
      minZ = Math.min(minZ, f.body.Z);
    }
    return { f, minZ };
  };
  if (legacyRun) return;
  const { f, minZ } = run('core');
  const halfB = f.body.hull.B / 2;
  assert.ok(minZ > 10 + halfB - 0.15, `stopped at its side (z ${minZ.toFixed(2)}, the side at 10)`);
  assert.ok(Math.abs(f.body.vz) < 0.1, `held there (${f.body.vz.toFixed(2)} m/s)`);
  assert.ok(f.sfx?.some((e) => e.kind === 'bump' && e.material === 'steel'), 'a knock on steel');
  assert.ok(run('legacy').minZ < 9, 'the old model: into it');
});

test('a person in a car\'s way is a body: hit fast he is knocked down (an impact) and the car gives up his share of its momentum; slow, he is pushed aside', { skip: legacyRun }, () => {
  const sim = createSimulation({ world: { size: [30, 5, 12], h: 0.2 }, weather: { ambient: 15, windSpeed: 0 }, noFire: true, objects: [{ type: 'car', params: {}, x: 5, z: 6, rotation: 0 }] });
  const w = sim.world;
  const c = initCars(w)[0];
  const man = { p: [14, c.y, 6], health: 100, squad: 'R1', unit: 'X' };
  w.enemies.push(man);
  boardCar(c, { player: true, mass: 85 }, 0);
  c.player = true;
  startEngine(c);
  let before = null, after = null;
  for (let t = 0; t < 6 && !after; t += 1 / 30) {
    c.input = { ...pedals(c, t > 1 ? 1 : 0, 0), steer: 0 };
    const u0 = c.u;
    sim.step(1 / 30);
    if (c.sfx.some((e) => e.kind === 'thud') && !after) (before = u0), (after = c.u);
  }
  assert.ok(after !== null, 'he was struck');
  assert.ok(man.health < 100 || man.knockedDown || man.dead, 'hurt, knocked down');
  assert.ok(Math.abs(man.p[2] - 6) > c.spec.W / 2, `thrown off its side (${man.p[2].toFixed(2)})`);
  assert.ok(after < before, `the car slowed by him (${before.toFixed(2)} → ${after.toFixed(2)} m/s)`);
  assert.ok(w._physicsWorld._people instanceof Map, 'people as bodies');
});

test('the helicopter\'s body weighs what it carries: lighter as its fuel burns', { skip: legacyRun }, () => {
  const world = { time: 0, events: [], noises: [], enemies: [], ropes: [] };
  const h = new Helicopter({ p: [0, 0, 0], lz: [0, 0, 0], seed: 5, startAlt: 20, mission: 'hover', hoverAlt: 20 }, { world, sim: { world }, addCrew: (e) => world.enemies.push(e) });
  h.step(0.05);
  const m0 = h.core.body.mass;
  h.fuel -= 0.5;
  h.step(0.05);
  assert.ok(Math.abs(m0 - h.core.body.mass - 680) < 2, `${m0.toFixed(0)} → ${h.core.body.mass.toFixed(0)} kg`);
  assert.equal(heliBodyMass(h), h.core.body.mass);
});

/** The quickest of n runs of fn(physics) (the least disturbed by whatever else the machine does) → ms per simulated second, legacy and core interleaved. */
function cost(fn, n = 5) {
  const L = [], C = [];
  fn('legacy');
  fn('core');
  for (let k = 0; k < n; k++) {
    L.push(fn('legacy'));
    C.push(fn('core'));
  }
  return { legacy: Math.min(...L), core: Math.min(...C) };
}

test('performance: a vehicle\'s step on the core costs at most ~1.3× the old model (car alone, in a voxel street; boat); the helicopter within 1.3× + 0.3 ms per simulated second', { skip: legacyRun }, () => {
  const now = () => performance.now();
  const carAlone = (physics) => {
    const c = makeCar(carSpec({}), {});
    c.physics = physics;
    startEngine(c);
    for (let t = 0; t < 1; t += 0.02) (c.input = { throttle: 0, brake: 1, steer: 0 }), stepCar(c, 0.02, {});
    const a = now();
    for (let t = 0; t < 10; t += 0.02) {
      c.input = { ...pedals(c, 0.5, 0), steer: t > 5 ? 0.3 : 0 };
      stepCar(c, 0.02, {});
    }
    return (now() - a) / 10;
  };
  const carStreet = (physics) => {
    const sim = createSimulation({ world: { size: [60, 5, 16], h: 0.2 }, weather: { ambient: 15, windSpeed: 0 }, noFire: true, objects: [{ type: 'car', params: {}, x: 6, z: 8, rotation: 0 }] });
    const w = sim.world;
    const c = initCars(w)[0];
    c.physics = physics;
    boardCar(c, { player: true, mass: 85 }, 0);
    c.player = true;
    startEngine(c);
    sim.step(1 / 30);
    const a = now();
    for (let t = 0; t < 3; t += 1 / 30) {
      c.input = { ...pedals(c, 0.5, 0), steer: t > 2 ? 0.3 : 0 };
      w.time += 1 / 30;
      stepCarList(w.cars, 1 / 30, w._carCtx);
    }
    return (now() - a) / 3;
  };
  const boat = (physics) => {
    const f = launchBoat(placeRowBoat({ moored: false }, [0, 0, 0], 0.1).floats[0], { x: 0, z: 0 });
    f.physics = physics;
    f.body.vx = 1;
    const a = now();
    for (let t = 0; t < 10; t += 0.05) stepBoat(f, 0.05, { level: 0 });
    return (now() - a) / 10;
  };
  const heli = (physics) => {
    const world = { time: 0, events: [], noises: [], enemies: [], ropes: [] };
    const h = new Helicopter({ p: [0, 0, 0], lz: [0, 0, 0], seed: 5, startAlt: 30, startSpeed: 10, mission: 'hover', hoverAlt: 30 }, { world, sim: { world, solid: (x, y) => y < 0 }, addCrew: (e) => world.enemies.push(e) });
    h.physics = physics;
    for (let t = 0; t < 1; t += 0.05) h.step(0.05);
    const a = now();
    for (let t = 0; t < 30; t += 0.05) {
      world.time += 0.05;
      h.step(0.05);
    }
    return (now() - a) / 30;
  };
  const out = [];
  for (const [name, fn, extra] of [['car alone', carAlone, 0], ['car in a street', carStreet, 0], ['boat', boat, 0], ['helicopter', heli, 0.3]]) {
    const r = cost(fn);
    out.push(`${name}: ${r.legacy.toFixed(2)} → ${r.core.toFixed(2)} ms/s`);
    assert.ok(r.core <= r.legacy * 1.3 + extra + 0.05, `${name}: ${r.core.toFixed(2)} ms/s on the core, ${r.legacy.toFixed(2)} on the old model`);
  }
  console.log(out.join('; '));
});
