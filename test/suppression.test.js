import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/sim/world.js';
import { Simulation, AGENTS } from '../src/sim/simulation.js';
import { MAT } from '../src/sim/materials.js';
import { defaultWeather } from '../src/sim/weather.js';
import { createSimulation } from '../src/sim/createSimulation.js';

const run = (sim, t) => {
  while (sim.world.time < t) sim.step(sim.dt);
};

/** A burning wood crib in a small world; returns the simulation after `warm` s. */
function crib(weather = {}, warm = 120) {
  const w = new World({ size: [1.6, 1.6, 1.6], h: 0.05, ambient: 15 });
  for (let z = 0; z < w.nz; z++) for (let x = 0; x < w.nx; x++) w.setVoxel(w.idx(x, 0, z), MAT.soil, { anchored: true });
  // layers of sticks with gaps (air can get in)
  for (let layer = 0; layer < 4; layer++)
    for (let k = 0; k < 4; k++)
      for (let s = 0; s < 10; s++) {
        const a = 11 + k * 3;
        const b = 11 + s;
        const y = 1 + layer;
        w.setVoxel(layer % 2 ? w.idx(a, y, b) : w.idx(b, y, a), MAT.wood, { moisture: 0.08 });
      }
  const sim = new Simulation(w, { ...defaultWeather(), ...weather });
  sim.addTorch([0.8, 0.1, 0.8], 15000, 60, 0.25);
  sim.ignite([0.8, 0.15, 0.8], 0.3);
  run(sim, warm);
  return sim;
}

test('heavy rain weakens a fire, a downpour suppresses most of it', () => {
  const hrrAfter = (rain) => {
    const sim = crib();
    sim.weather.rain = rain;
    const t0 = sim.world.time;
    run(sim, t0 + 180);
    return sim.stats.hrr;
  };
  const dry = hrrAfter(0);
  const heavy = hrrAfter(50);
  assert.ok(dry > 1000, `the crib burns (${dry.toFixed(0)} W)`);
  assert.ok(heavy < dry * 0.6, `rain 50 mm/h: ${heavy.toFixed(0)} W vs dry ${dry.toFixed(0)} W`);
});

test('every extinguisher agent knocks the fire down', () => {
  const sim0 = crib();
  run(sim0, sim0.world.time + 25);
  const control = sim0.stats.hrr;
  for (const agent of Object.keys(AGENTS)) {
    const sim = crib();
    const tank = { remaining: AGENTS[agent].capacity };
    sim.spray = { agent, nozzle: [0.2, 0.8, 0.8], target: [0.8, 0.15, 0.8], radius: 0.45, tank };
    run(sim, sim.world.time + 25);
    assert.ok(tank.remaining < AGENTS[agent].capacity, `${agent} was discharged`);
    assert.ok(sim.stats.hrr < control * 0.5, `${agent}: ${sim.stats.hrr.toFixed(0)} W vs ${control.toFixed(0)} W without`);
  }
});

test('foam leaves a smothering blanket, CO2 and powder suppress the gas around the fire', () => {
  const foam = crib();
  foam.spray = { agent: 'foam', nozzle: [0.2, 0.8, 0.8], target: [0.8, 0.15, 0.8], radius: 0.45, tank: { remaining: 9 } };
  run(foam, foam.world.time + 5);
  let coated = 0;
  for (let k = 0; k < foam.world.solidCount; k++) if (foam.world.coat[foam.world.solids[k]] > 0.3) coated++;
  assert.ok(coated > 5, `${coated} voxels under foam`);
  // powder inhibits the flame chemistry in the gas
  const powder = crib();
  powder.spray = { agent: 'powder', nozzle: [0.2, 0.8, 0.8], target: [0.8, 0.15, 0.8], radius: 0.45, tank: { remaining: 5 } };
  run(powder, powder.world.time + 3);
  const max = powder.world.supp.reduce((m, v) => Math.max(m, v), 0);
  assert.ok(max > 0.5, `powder suppression in the gas: ${max.toFixed(2)}`);
  // CO2 pushes the oxygen out
  const co2 = crib();
  co2.spray = { agent: 'co2', nozzle: [0.2, 0.8, 0.8], target: [0.8, 0.15, 0.8], radius: 0.45, tank: { remaining: 5 } };
  run(co2, co2.world.time + 3);
  const minO2 = co2.world.o2.reduce((m, v) => Math.min(m, v), 1);
  assert.ok(minO2 < 0.14, `oxygen around the fire fell to ${((minO2 / 0.232) * 20.9).toFixed(1)} %`);
});

/** A propane cylinder whose liquid we heat directly. */
function cylinder(reliefValve) {
  const sim = createSimulation({
    world: { size: [3, 2, 3], h: 0.05 },
    weather: { ambient: 20 },
    objects: [{ type: 'gasCylinder', params: { reliefValve }, x: 1.5, z: 1.5 }],
  });
  sim.step(sim.dt);
  return sim;
}
const heatContents = (sim, T) => {
  const w = sim.world;
  for (let k = 0; k < w.solidCount; k++) {
    const i = w.solids[k];
    if (w.vesselTag[i] < 0) w.temp[i] = w.skin[i] = T;
  }
};

test('a heated propane cylinder with a blocked relief valve bursts: fireball and fragments', () => {
  const sim = cylinder('blocked');
  const v = sim.world.vessels[0];
  assert.ok(v.pressure > 5e5 && v.pressure < 1e6, `≈8 bar at 20 °C (${(v.pressure / 1e5).toFixed(1)})`);
  heatContents(sim, 110); // liquid-full: the pressure climbs ~5 bar per K
  sim.step(sim.dt);
  assert.equal(v.state, 'ruptured');
  assert.ok(sim.world.events.some((e) => e.type === 'explosion'));
  assert.ok(sim.world.debris.length > 0, 'fragments fly');
  assert.ok(sim.world.heaters.some((h) => h.fireball), 'fireball');
});

test('with a working relief valve the cylinder vents a jet flame instead', () => {
  const sim = cylinder('working');
  const v = sim.world.vessels[0];
  heatContents(sim, 65);
  for (let k = 0; k < 5; k++) sim.step(sim.dt);
  assert.equal(v.state, 'sealed');
  assert.ok(v.venting, 'relief valve open');
  assert.ok(sim.stats.ventHrr > 1000, `jet flame ${(sim.stats.ventHrr / 1000).toFixed(0)} kW`);
});

test('a plastic fuel tank softens and leaks instead of exploding', () => {
  const sim = createSimulation({
    world: { size: [6, 3, 4], h: 0.1 },
    weather: { ambient: 20 },
    objects: [{ type: 'car', params: { tankMaterial: 'plastic', tankVent: 'blocked' }, x: 3, z: 2 }],
  });
  sim.step(sim.dt);
  const w = sim.world;
  for (let k = 0; k < w.solidCount; k++) {
    const i = w.solids[k];
    if (w.vesselTag[i] > 0) w.temp[i] = w.skin[i] = 150; // shell near its melting point
  }
  heatContents(sim, 60);
  sim.step(sim.dt);
  const v = w.vessels[0];
  assert.ok(v.state === 'leaking', `state ${v.state}`);
  assert.ok(!w.events.some((e) => e.type === 'explosion'));
});
