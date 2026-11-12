import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../vendor/drones/src/core/sim.js';
import { SCENARIOS } from '../src/scenarios.js';

test('the camp flies the drones repo swarm: GNSS until jammed, links to the camp, jamming found', () => {
  assert.equal(SCENARIOS.droneCamp.page, 'camp.html');
  const sim = new Simulation({ seed: 11, swarm: { count: 6, formation: 'v', spacing: 22 }, terrain: { preset: 'hills' }, nav: { gnss: true },
    jammers: { custom: [{ x: -260, z: 300, type: 'gnss', r: 300 }, { x: 330, z: -260, type: 'comms', r: 300 }] } });
  sim.run(120);
  assert.equal(sim.drones.length, 6);
  assert.ok(sim.stats.gnssFixes > 0, 'GNSS fixes outside the jammers');
  assert.ok(sim.leader, 'a leader');
  assert.ok(sim.events.some((e) => e.type === 'ew'), 'electronic warfare events (jamming noticed, links lost)');
});
