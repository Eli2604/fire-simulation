import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../src/sim/createSimulation.js';
import { MATERIALS } from '../src/sim/materials.js';
import { buildScene } from '../src/models/voxelizer.js';

const count = (w, name) => {
  let n = 0;
  for (let k = 0; k < w.solidCount; k++) if (MATERIALS[w.mat[w.solids[k]]]?.name === name) n++;
  return n;
};

// fuel left (voxels × their remaining fuel share)
const fuelOf = (w, name) => {
  let n = 0;
  for (let k = 0; k < w.solidCount; k++) if (MATERIALS[w.mat[w.solids[k]]]?.name === name) n += w.fuel[w.solids[k]];
  return n;
};

const scene = (arrangement) => ({
  world: { size: [1.6, 1, 1.6], h: 0.025, ground: 'soil' },
  weather: { ambient: 15, humidity: 0.5, windSpeed: 0.5, rain: 0 },
  objects: [{ type: 'woodPile', params: { fuel: 'books', arrangement, logs: 10, kindling: true, stones: false }, x: 0.8, z: 0.8, ignite: true }],
});

test('a campfire can be a pile of books, in each arrangement', () => {
  for (const a of ['log cabin', 'stack', 'teepee']) {
    const { world } = buildScene(scene(a));
    assert.ok(count(world, 'books') > 100, `${a}: books as voxels`);
    assert.ok(count(world, 'pages') > 10, `${a}: torn-out pages as kindling`);
    assert.equal(count(world, 'wood'), 0, `${a}: no timber`);
  }
});

test('the pages flare up, the closed books char slowly', () => {
  const sim = createSimulation(scene('log cabin'));
  const w = sim.world;
  const books0 = fuelOf(w, 'books');
  const paper0 = fuelOf(w, 'pages');
  for (let t = 0; t < 300; t += 0.25) sim.step(0.25);
  const paper = count(w, 'paper');
  const books = fuelOf(w, 'books');
  assert.ok(paper < paper0 * 0.75, `the pages burn first (${paper0} → ${paper})`);
  assert.ok(books < books0 - 5, `the books catch (${books0} → ${books})`);
  assert.ok(books > books0 * 0.3, `but burn slowly, like logs (${books0} → ${books})`);
});
