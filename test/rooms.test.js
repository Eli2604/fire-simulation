import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/sim/world.js';
import { Simulation } from '../src/sim/simulation.js';
import { MAT } from '../src/sim/materials.js';
import { defaultWeather } from '../src/sim/weather.js';
import { createSimulation } from '../src/sim/createSimulation.js';
import { toggleDoor } from '../src/sim/doors.js';
import { explode } from '../src/sim/explosions.js';

const run = (sim, t) => {
  while (sim.world.time < t) sim.step(sim.dt);
};

/** A closed concrete room (3 x 2.4 x 3 m) with a pile of wood, optionally a door gap. */
function room(open) {
  const w = new World({ size: [5, 3.6, 5], h: 0.1, ambient: 20 });
  for (let z = 0; z < w.nz; z++) for (let x = 0; x < w.nx; x++) w.setVoxel(w.idx(x, 0, z), MAT.soil, { anchored: true });
  for (let z = 9; z <= 41; z++)
    for (let y = 1; y <= 26; y++)
      for (let x = 9; x <= 41; x++) {
        const shell = x === 9 || x === 41 || z === 9 || z === 41 || y === 26;
        if (!shell) continue;
        // a door-sized opening in one wall
        if (open && x === 9 && y <= 20 && z >= 22 && z <= 28) continue;
        w.setVoxel(w.idx(x, y, z), MAT.concrete, { anchored: true });
      }
  for (let x = 22; x < 28; x++) for (let z = 22; z < 28; z++) for (let y = 1; y < 4; y++) w.setVoxel(w.idx(x, y, z), MAT.foam);
  w.rebuildLists();
  const sim = new Simulation(w, defaultWeather());
  sim.ignite([2.5, 0.25, 2.5], 0.4);
  sim.addTorch([2.5, 0.3, 2.5], 8000, 20, 0.2);
  return sim;
}

test('a fire in a closed room uses up the oxygen and dies; with a door open it keeps burning', () => {
  const closed = room(false);
  const opened = room(true);
  run(closed, 240);
  run(opened, 240);
  const o2Closed = closed.world.o2[closed.airCellAt(2.5, 2, 2.5)];
  assert.ok(o2Closed < 0.17, `oxygen in the closed room fell to ${(o2Closed / 0.232 * 20.9).toFixed(1)} %`);
  assert.ok(opened.stats.hrr > 3 * closed.stats.hrr + 1000, `open ${(opened.stats.hrr / 1000).toFixed(1)} kW vs closed ${(closed.stats.hrr / 1000).toFixed(1)} kW`);
});

test('removing the oxygen from a room puts the fire out', () => {
  const sim = room(false);
  run(sim, 30);
  assert.ok(sim.stats.burning > 0);
  const r = sim.inertRoom([2.5, 2, 2.5]);
  assert.equal(r.open, false, 'the room is closed');
  run(sim, 60);
  assert.equal(sim.stats.burning, 0, 'no flames left');
});

test('hallway doors open and close; office rooms, extinguisher and hose reel exist', () => {
  const sim = createSimulation({
    world: { size: [12, 4.2, 7.6], h: 0.1 },
    weather: { ambient: 18 },
    objects: [{ type: 'hallway', params: { length: 8, sprinklers: true, burstTrigger: 'only by fire or blast' }, x: 6.5, z: 2 }],
  });
  const w = sim.world;
  const office = w.doors.findIndex((d) => d.name === 'office 1');
  assert.ok(office >= 0);
  const count = () => w.doors[office].voxels.filter((i) => w.doorTag[i] && w.mat[i]).length;
  const n0 = count();
  assert.ok(n0 > 50, 'door is closed at start');
  toggleDoor(sim, office);
  assert.equal(count(), 0, 'opened');
  toggleDoor(sim, office);
  assert.equal(count(), n0, 'closed again');
  assert.ok(w.doors.find((d) => d.name === 'entrance').open, 'entrance starts open');
  assert.deepEqual(w.pickups.map((p) => p.type).sort(), ['extinguisher', 'hoseReel']);
  assert.ok(w.sprinklers.length >= 2, 'sprinklers');
});

test('a sprinkler goes off in the hot gas and its water collects on the floor', () => {
  const sim = createSimulation({
    world: { size: [12, 4.2, 7.6], h: 0.1 },
    weather: { ambient: 18 },
    objects: [{ type: 'hallway', params: { length: 8, sprinklers: true, burstAfter: 1 }, x: 6.5, z: 2 }],
  });
  run(sim, 240);
  const w = sim.world;
  assert.ok(w.sprinklers.some((s) => s.active), 'at least one sprinkler head opened');
  // ~5 mm/min: shallow water builds up on the floor (a full water voxel needs 10 cm)
  let collected = 0;
  for (const v of w.runoff) collected += v;
  for (let k = 0; k < w.solidCount; k++) if (w.mat[w.solids[k]] === MAT.water) collected += 1000 * w.h ** 3;
  assert.ok(collected > 1, `${collected.toFixed(1)} kg of water collected on the floor`);
});

test('water boils off on a hot surface', () => {
  const w = new World({ size: [1, 1, 1], h: 0.05, ambient: 20 });
  for (let z = 0; z < w.nz; z++) for (let x = 0; x < w.nx; x++) w.setVoxel(w.idx(x, 0, z), MAT.steel, { anchored: true, temp: 600 });
  const i = w.idx(10, 1, 10);
  w.setVoxel(i, MAT.water);
  w.rebuildLists();
  const sim = new Simulation(w, defaultWeather());
  run(sim, 30);
  assert.ok(sim.stats.steam > 0 || w.mat[i] !== MAT.water, 'steam produced');
});

test('a hole in the hull below the waterline floods the ship; above it, nothing comes in', () => {
  const make = () =>
    createSimulation({
      world: { size: [14, 7.2, 8.4], h: 0.2, ground: 'none' },
      weather: { ambient: 14 },
      objects: [{ type: 'shipSection', params: { length: 12, beam: 6, burstAfter: 9999 }, x: 7, z: 4.2 }],
    });
  const water = (sim) => {
    let n = 0;
    for (let k = 0; k < sim.world.solidCount; k++) if (sim.world.mat[sim.world.solids[k]] === MAT.water) n++;
    return n;
  };
  const below = make();
  below.step(below.dt);
  const sea = below.world.sea;
  // cross corridor at x = -L/4, hull side
  explode(below, [7 - 3, 0.2 + 0.7 + 1.0, sea.box[1] + 0.4], 8e5);
  run(below, 20);
  assert.ok(water(below) > 300, `${water(below)} water voxels inside`);

  const above = make();
  above.step(above.dt);
  explode(above, [7 - 3, 0.2 + 5.6, above.world.sea.box[1] + 0.4], 3e5);
  run(above, 20);
  assert.ok(water(above) < 30, `${water(above)} water voxels from a hole above the waterline`);
});
