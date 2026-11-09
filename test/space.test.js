import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../src/sim/createSimulation.js';
import { SCENARIOS, cloneScene } from '../src/scenarios.js';
import { explode } from '../src/sim/explosions.js';
import { toggleDoor } from '../src/sim/doors.js';
import { pressureAt } from '../src/sim/vacuum.js';

const run = (sim, t) => {
  while (sim.world.time < t) sim.step(sim.dt);
};

function ship(params = {}) {
  const scene = cloneScene(SCENARIOS.carrier);
  const z = scene.zones.spaceship;
  z.objects = z.objects.slice(0, 1);
  z.objects[0].params = { fireAfter: 0, ...params };
  return createSimulation({ ...scene, zone: 'spaceship' });
}
// points in the spaceship zone (world coordinates of the zone)
const CORRIDOR = [17.5, 2, 6.5];
const BRIDGE = [31, 2, 6.5];
const CREW = [12, 2, 3.5];
const OUTSIDE = [17.5, 2, 12.6];

test('spaceship: air inside, vacuum outside, the hull holds', () => {
  const sim = ship();
  const w = sim.world;
  assert.ok(w.vacuum);
  assert.equal(pressureAt(sim, CORRIDOR), 1);
  assert.equal(pressureAt(sim, OUTSIDE), 0);
  assert.equal(w.o2[sim.airCellAt(...OUTSIDE)], 0, 'no oxygen in space');
  assert.equal(sim.weather.windSpeed, 0, 'no wind in space');
  run(sim, 15);
  assert.ok(pressureAt(sim, CORRIDOR) > 0.99, 'still pressurised');
  assert.ok(w.o2[sim.airCellAt(...CORRIDOR)] > 0.2);
  assert.equal(w.docks.length, 1);
});

test('spaceship: a hull breach decompresses everything connected to it; a closed door holds', () => {
  const sim = ship();
  const w = sim.world;
  toggleDoor(sim, w.doors.findIndex((d) => d.name === 'crew quarters'), true);
  toggleDoor(sim, w.doors.findIndex((d) => d.name === 'cargo bay'), true);
  run(sim, 2);
  explode(sim, [12, 2, 11.2], 2e6, { name: 'rocket' }); // through the cargo bay's hull
  run(sim, 8);
  assert.ok(w.breach > 0, 'hull plating gone');
  assert.ok(w.events.some((e) => e.type === 'decompression'), 'decompression');
  assert.ok(pressureAt(sim, CORRIDOR) < 0.05, `corridor emptied (${pressureAt(sim, CORRIDOR).toFixed(2)})`);
  assert.ok(pressureAt(sim, CREW) < 0.05, 'crew quarters (door open) emptied');
  assert.ok(pressureAt(sim, BRIDGE) > 0.95, 'bridge (door shut) still has its air');
  assert.ok(w.o2[sim.airCellAt(...CORRIDOR)] < 0.02, 'no oxygen left in the corridor');
});

test('spaceship: decompression puts a fire out', () => {
  const sim = ship({ fireAfter: 1 });
  const w = sim.world;
  for (const d of ['engine room']) toggleDoor(sim, w.doors.findIndex((q) => q.name === d), true);
  run(sim, 15);
  let burning = 0;
  for (let k = 0; k < w.solidCount; k++) if (w.flags[w.solids[k]] & 8) burning++;
  assert.ok(burning > 0, 'the cable fire burns');
  // open the airlock to space: inner and outer door
  toggleDoor(sim, w.doors.findIndex((d) => d.name === 'airlock (inner)'), true);
  toggleDoor(sim, w.doors.findIndex((d) => d.name === 'airlock (outer)'), true);
  run(sim, 30);
  let still = 0;
  for (let k = 0; k < w.solidCount; k++) if (w.flags[w.solids[k]] & 8) still++;
  assert.ok(pressureAt(sim, CORRIDOR) < 0.05, 'vented');
  assert.ok(still < burning * 0.3, `the fire dies without air (${burning} → ${still})`);
});
