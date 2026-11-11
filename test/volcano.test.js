import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../src/sim/createSimulation.js';
import { SCENARIOS, cloneScene } from '../src/scenarios.js';
import { MAT } from '../src/sim/materials.js';
import { stepVolcanoes } from '../src/sim/volcano.js';

const run = (sim, t) => {
  const end = sim.world.time + t;
  while (sim.world.time < end) sim.step(sim.dt);
};

test('the volcano on the island sleeps until a dragon passes, then erupts: lava runs down its flanks and sets things alight', () => {
  const sim = createSimulation({ ...cloneScene(SCENARIOS.carrier), zone: 'island' });
  const w = sim.world;
  assert.equal(w.volcanoes.length, 1);
  const v = w.volcanoes[0];
  assert.equal(v.state, 'dormant');
  // a dragon lying still next to it does not wake it; one crawling past does
  const real = w.dragons;
  const d = { p: [v.crater[0] + 3, v.rim, v.crater[2]] };
  w.dragons = [d];
  stepVolcanoes(sim, 0.2);
  stepVolcanoes(sim, 0.2);
  assert.equal(v.state, 'dormant', 'asleep while the dragon lies still');
  d.p = [d.p[0] + 0.5, d.p[1], d.p[2] + 0.3];
  stepVolcanoes(sim, 0.2);
  w.dragons = real;
  assert.equal(v.state, 'erupting', 'erupts as the dragon passes');
  assert.ok(w.events.some((e) => e.type === 'eruption'));
  run(sim, 40);
  let lava = 0;
  let molten = 0;
  let lowest = Infinity;
  for (let k = 0; k < w.solidCount; k++) {
    const i = w.solids[k];
    if (w.mat[i] !== MAT.basalt || w.temp[i] < 700) continue;
    lava++;
    if (w.temp[i] > 1100) molten++;
    lowest = Math.min(lowest, w.coords(i)[1] * w.h);
  }
  assert.ok(lava > 60, `${lava} voxels of fresh lava`);
  assert.ok(molten > 10, `${molten} still molten`);
  assert.ok(lowest < v.rim - 1, `it ran down the flanks (lowest ${lowest.toFixed(1)} m, rim ${v.rim.toFixed(1)} m)`);
  assert.ok(sim.stats.burning > 0 || w.debris.length > 0, 'bombs flying, things burning');
});

test('lava that runs into the sea is quenched: it sets in seconds and boils the sea off in steam', () => {
  const sim = createSimulation({ ...cloneScene(SCENARIOS.carrier), zone: 'island' });
  const w = sim.world;
  const v = w.volcanoes[0];
  v.state = 'spent';
  v.column = { on: false };
  // a tongue of lava just below the sea surface, off the shore
  const y = Math.floor(w.sea.level / w.h) - 1;
  const lava = [];
  for (let x = 2; x < 6; x++)
    for (let z = 2; z < 4; z++) {
      const i = w.idx(x, y, z);
      if (w.mat[i]) w.clearVoxel(i);
      w.setVoxel(i, MAT.basalt, { temp: 1200, anchored: true });
      lava.push(i);
    }
  w.rebuildLists();
  const steam0 = w.steam.reduce((s, q) => s + q, 0);
  run(sim, 6);
  const hottest = Math.max(...lava.map((i) => w.temp[i]));
  assert.ok(hottest < 800, `set in the water (hottest ${hottest.toFixed(0)} °C)`);
  assert.ok(lava.every((i) => !(w.flags[i] & 1)), 'no longer liquid');
  assert.ok(w.steam.reduce((s, q) => s + q, 0) > steam0 + 1, 'steam over the sea');
  assert.ok(w.events.some((e) => e.type === 'laze'));
});
