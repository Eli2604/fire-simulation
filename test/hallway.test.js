import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../src/sim/createSimulation.js';
import { explode } from '../src/sim/explosions.js';
import { MAT } from '../src/sim/materials.js';
import { F_FALLING } from '../src/sim/world.js';

const hallway = (params = {}, extra = {}) =>
  createSimulation({
    world: { size: [10, 4.2, 4], h: 0.1 },
    weather: { ambient: 18 },
    objects: [{ type: 'hallway', params: { length: 7, ...params }, x: 5.5, z: 2 }],
    ...extra,
  });
const run = (sim, t) => {
  while (sim.world.time < t) sim.step(sim.dt);
};
const count = (w, id, pred = () => true) => {
  let n = 0;
  for (let k = 0; k < w.solidCount; k++) {
    const i = w.solids[k];
    if (w.mat[i] === id && pred(i)) n++;
  }
  return n;
};

test('the hallway has a suspended ceiling, hidden services, painted walls and a spawn point', () => {
  const sim = hallway();
  const w = sim.world;
  assert.ok(count(w, MAT.ceilingTile) > 100, 'ceiling tiles');
  assert.ok(count(w, MAT.steelProfile) > 50, 'grid and hangers');
  assert.ok(count(w, MAT.cable) > 10, 'cables in the void');
  assert.equal(w.gasPipes.length, 1, 'one gas line');
  assert.ok(count(w, MAT.concrete, (i) => w.paint[i] === 255) > 100, 'painted walls');
  assert.ok(sim.spawn && sim.spawn.p[0] < 2, 'spawn outside the entrance');
  assert.ok(sim.markers.some((m) => m.kind === 'pending'), 'pending pipe burst marker');
});

test('the gas pipe bursts on its timer and the fire spreads into the void', () => {
  const sim = hallway({ burstAfter: 2 });
  run(sim, 60);
  const w = sim.world;
  assert.ok(w.events.some((e) => e.type === 'pipeBurst'), 'pipe burst event');
  assert.ok(sim.stats.hrr > 150000, `heat release ${(sim.stats.hrr / 1000).toFixed(0)} kW (jet + cables)`);
});

test('tiles rest on the grid: a tile panel falls when its grid is gone', () => {
  const sim = hallway({ burstTrigger: 'only by fire or blast' });
  const w = sim.world;
  sim.step(sim.dt);
  // take away all grid and hangers: every tile panel must come down
  for (let k = 0; k < w.solidCount; k++) {
    const i = w.solids[k];
    if (w.mat[i] === MAT.steelProfile && w.vesselTag[i] === 0) {
      const [, y] = w.coords(i);
      if (y > 20) w.clearVoxel(i);
    }
  }
  sim.lastStructureCheck = -1e9;
  sim.step(sim.dt);
  const falling = count(w, MAT.ceilingTile, (i) => w.flags[i] & F_FALLING);
  assert.ok(falling > 100, `${falling} tile voxels falling`);
});

test('heated ceiling tiles break down and drop; heated paint blisters and peels', () => {
  const sim = hallway({ burstTrigger: 'only by fire or blast' });
  const w = sim.world;
  sim.step(sim.dt);
  for (let k = 0; k < w.solidCount; k++) {
    const i = w.solids[k];
    if (w.mat[i] === MAT.ceilingTile) w.temp[i] = w.skin[i] = 600;
    if (w.paint[i] === 255) w.skin[i] = 400;
  }
  run(sim, 5);
  assert.ok(sim.stats.failures > 20, `${sim.stats.failures} parts failed`);
  const peeled = count(w, MAT.concrete, (i) => w.paint[i] === 1);
  assert.ok(peeled > 20, `${peeled} wall voxels with paint peeled off`);
});

test('a grenade blast throws debris, breaks windows and bursts a nearby gas pipe', () => {
  const sim = hallway({ burstTrigger: 'only by fire or blast', pipeIn: 'wall', ceiling: 'plain' });
  const w = sim.world;
  sim.step(sim.dt);
  const gp = w.gasPipes[0];
  const c = w.center(...w.coords(gp.voxels[Math.floor(gp.voxels.length / 2)]));
  explode(sim, [c[0], c[1], c[2] + 0.5], 8e5);
  assert.ok(w.events.some((e) => e.type === 'explosion'));
  assert.ok(w.events.some((e) => e.type === 'pipeBurst'), 'pipe burst by the blast');
  assert.ok(w.debris.length > 0, 'debris flying');
  assert.ok(w.heaters.some((h) => h.jet && h.gasPipe), 'burning gas jet');
});

test('a thrown grenade flies, lands and explodes after its fuse', () => {
  const sim = hallway({ burstTrigger: 'only by fire or blast' });
  sim.throwGrenade([0.5, 1.5, 2], [6, 2, 0], 8e5, 1.5);
  run(sim, 1);
  assert.equal(sim.world.projectiles.length, 1);
  run(sim, 2);
  assert.equal(sim.world.projectiles.length, 0);
  assert.ok(sim.world.events.some((e) => e.type === 'explosion'));
});

test('fire heating a gas line makes it burst', () => {
  const sim = hallway({ burstTrigger: 'only by fire or blast' });
  const w = sim.world;
  sim.step(sim.dt);
  for (const i of w.gasPipes[0].voxels.slice(20, 25)) w.temp[i] = w.skin[i] = 600;
  run(sim, 10);
  assert.ok(w.events.some((e) => e.type === 'pipeBurst'), 'joint failure → burst');
});

test('a chosen fire start replaces the scenario default and gets a marker', () => {
  const sim = hallway({ burstTrigger: 'only by fire or blast' }, { fireStarts: [{ p: [4, 0.4, 1.3] }] });
  assert.equal(sim.markers.filter((m) => m.kind === 'start').length, 1);
  assert.ok(sim.world.heaters.some((h) => h.temporary), 'ignition source at the chosen spot');
  const none = hallway({ burstTrigger: 'only by fire or blast' }, { noFire: true });
  assert.equal(none.markers.length, 0);
});
