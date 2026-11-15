// The old office hallway's gas pipe burst, now in the carrier: the main passageway below deck has
// a gas line under its deckhead that bursts and burns (after the server rack fire has had its
// time), and glass-bulb sprinklers; ?scenario=hallway opens it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation, buildWorld } from '../src/sim/createSimulation.js';
import { SCENARIOS, SCENARIO_ALIASES, openScenario, cloneScene } from '../src/scenarios.js';
import { MODELS } from '../src/models/index.js';

const run = (sim, t) => {
  while (sim.world.time < t) sim.step(sim.dt);
};

test('the hallway scene is gone: its key opens the carrier below deck', () => {
  assert.equal(SCENARIOS.hallway, undefined);
  assert.deepEqual(SCENARIO_ALIASES.hallway, { scenario: 'carrier', zone: 'below' });
  assert.equal(openScenario('hallway').startZone, 'below');
  // (the office corridor stays an object: the headquarters of the base has one, with sprinklers)
  assert.ok(MODELS.hallway);
  assert.ok(SCENARIO_ALIASES.hallwaySprinklers);
});

test('below deck: a gas line along the main passageway overhead, sprinklers, the burst staggered after the rack fire', () => {
  const { world: w } = buildWorld({ ...cloneScene(SCENARIOS.carrier), zone: 'below' });
  const gas = w.gasPipes.filter((g) => !g.water);
  assert.equal(gas.length, 1, 'one gas line');
  // it runs the passageway's length under the deckhead
  const ys = gas[0].voxels.map((i) => w.coords(i)[1] * w.h);
  const xs = gas[0].voxels.map((i) => w.coords(i)[0] * w.h);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 25, 'along the passageway');
  assert.ok(Math.min(...ys) > 2.4, 'under the deckhead');
  assert.ok(w.sprinklers.length >= 6, `${w.sprinklers.length} sprinklers`);
  const rack = w.heaters.find((h) => h.label === 'server rack');
  const pipe = w.heaters.find((h) => h.label === 'gas pipe');
  assert.ok(pipe.jet && pipe.start > rack.start + 30, `the gas line bursts at ${pipe.start} s, the rack at ${rack.start} s`);
});

test('the gas line bursts and burns; the sprinklers over it go off', { timeout: 10 * 60 * 1000 }, () => {
  const sc = cloneScene(SCENARIOS.carrier);
  const below = sc.zones.below.objects.find((o) => o.type === 'carrierBelow');
  Object.assign(below.params, { gasPipeBurstAfter: 2, rackFireAfter: 600 }); // (sooner, as tests go)
  const sim = createSimulation({ ...sc, zone: 'below' });
  const w = sim.world;
  run(sim, 10);
  assert.ok(w.events.some((e) => e.type === 'pipeBurst'), 'the gas line bursts');
  while (w.time < 240 && !w.sprinklers.some((s) => s.active)) sim.step(sim.dt);
  const on = w.events.find((e) => e.type === 'sprinkler');
  assert.ok(on, `a sprinkler goes off (the hottest bulb ${Math.max(...w.sprinklers.map((s) => s.bulb)).toFixed(0)} °C)`);
  assert.ok(Math.abs(on.pos[2] - 8.5) < 0.8, 'in the main passageway');
});
