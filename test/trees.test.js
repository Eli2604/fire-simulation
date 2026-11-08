import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScene } from '../src/models/voxelizer.js';
import { Simulation } from '../src/sim/simulation.js';
import { MAT } from '../src/sim/materials.js';
import { F_FALLING } from '../src/sim/world.js';
import { defaultWeather } from '../src/sim/weather.js';
import { createSimulation } from '../src/sim/createSimulation.js';

const tree = (species, h = 0.2) => buildScene({ world: { size: [10, 12, 10], h }, objects: [{ type: 'tree', params: { species }, x: 5, z: 5 }] }).world;
const count = (w, id) => {
  let n = 0;
  for (let k = 0; k < w.solidCount; k++) if (w.mat[w.solids[k]] === id) n++;
  return n;
};

test('oak, willow and pine are built from their own wood, branches and foliage', () => {
  const oak = tree('oak');
  assert.ok(count(oak, MAT.oak) > 50 && count(oak, MAT.leaves) > 200, 'oak limbs and leaf clusters');
  const willow = tree('willow');
  assert.ok(count(willow, MAT.willow) > 50 && count(willow, MAT.leaves) > 100, 'willow limbs, whips and leaves');
  const pine = tree('pine');
  assert.ok(count(pine, MAT.pine) > 50 && count(pine, MAT.needles) > 200 && count(pine, MAT.deadWood) > 3, 'pine whorls, needles, dead branches');
  // weeping: willow foliage hangs low, oak foliage sits high
  const lowLeaves = (w) => {
    let low = 0;
    let all = 0;
    for (let k = 0; k < w.solidCount; k++) {
      const i = w.solids[k];
      if (w.mat[i] !== MAT.leaves) continue;
      all++;
      if (w.coords(i)[1] * w.h < 3) low++;
    }
    return low / all;
  };
  assert.ok(lowLeaves(willow) > lowLeaves(oak) + 0.2, 'willow leaves hang down');
});

test('charred willow branches snap off; oak limbs hold', () => {
  const broken = {};
  for (const species of ['willow', 'oak']) {
    const w = tree(species);
    const sim = new Simulation(w, defaultWeather());
    const id = MAT[species];
    for (let k = 0; k < w.solidCount; k++) {
      const i = w.solids[k];
      if (w.mat[i] === id) w.char[i] = 0.6;
    }
    for (let s = 0; s < 20; s++) sim.step(sim.dt);
    let n = 0;
    for (let k = 0; k < w.solidCount; k++) if (w.flags[w.solids[k]] & F_FALLING) n++;
    broken[species] = n + (sim.stats.failures ?? 0);
  }
  assert.ok(broken.willow > 20, `willow: ${broken.willow} pieces breaking`);
  assert.ok(broken.oak < broken.willow / 4, `oak: ${broken.oak}`);
});

test('the three-trees scenario burns all three species', () => {
  const sim = createSimulation({
    world: { size: [14, 11, 8], h: 0.2 },
    weather: { windSpeed: 3, humidity: 0.25, ambient: 30 },
    objects: [
      { type: 'grass', params: { width: 13.5, depth: 7.5, height: 0.4, density: 0.85, moisture: 0.06 }, x: 7, z: 4 },
      { type: 'grass', params: { width: 1.5, depth: 1.5, height: 0.05, moisture: 0.06 }, x: 1, z: 4, ignite: true },
      { type: 'tree', params: { species: 'pine', height: 8, crownRadius: 2 }, x: 7, z: 4 },
    ],
  });
  const needles = count(sim.world, MAT.needles);
  while (sim.world.time < 120) sim.step(sim.dt);
  assert.ok(count(sim.world, MAT.needles) < needles * 0.5, 'the pine crown burned');
});
