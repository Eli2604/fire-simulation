import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../src/sim/createSimulation.js';
import { initCars, stepCarList, boardCar } from '../src/sim/cars.js';
import { carSpec, makeCar, stepCar, pedals, startEngine } from '../src/sim/carPhysics.js';
import { placeRowBoat } from '../src/models/rowBoat.js';
import { launchBoat, stepBoat } from '../src/sim/boats.js';
import { Helicopter } from '../src/ai/helicopter.js';

/*
 * The vehicles on the shared physics engine (physics/vehicleCore.js): what a step costs on the core
 * against the old models. In a file of its own: a fresh process (a heap full of earlier tests'
 * simulations slows the collector, and the core allocates more than the old models).
 */
const legacyRun = process.env.VEHICLE_PHYSICS === 'legacy';

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
