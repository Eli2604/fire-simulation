import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../src/sim/createSimulation.js';

/** A crate fire on a small field, `secs` of it in steps of dt: the heat in the air and what burns. */
function fire(dt, secs) {
  const sim = createSimulation({
    world: { size: [10, 4, 10], h: 0.2, ground: 'soil' },
    objects: [{ type: 'crate', params: {}, x: 5, z: 5, rotation: 0 }],
    weather: { windSpeed: 0 },
  });
  const w = sim.world;
  sim.step(0.05);
  sim.ignite([5, 0.6, 5], 0.4);
  for (let t = 0; t < secs - 1e-9; t += dt) sim.step(dt);
  let heat = 0;
  for (let a = 0; a < w.NA; a++) heat += Math.max(0, w.airT[a] - w.ambient);
  let burned = 0;
  for (let k = 0; k < w.solidCount; k++) burned += 1 - w.fuel[w.solids[k]];
  return { sim, heat, burned, time: w.time };
}

test('the heat and air step at 20 Hz at most: a fire run at 60 frames a second is the fire run at 20', () => {
  const a = fire(1 / 60, 15);
  const b = fire(1 / 20, 15);
  console.log(`60 fps: heat ${a.heat.toFixed(0)}, burned ${a.burned.toFixed(4)}; 20 Hz: heat ${b.heat.toFixed(0)}, burned ${b.burned.toFixed(4)}`);
  assert.ok(Math.abs(a.time - b.time) < 1e-6);
  assert.ok(b.heat > 50, `the fire heats the air (${b.heat.toFixed(0)})`);
  assert.ok(Math.abs(a.heat - b.heat) / b.heat < 0.3, `air heat ${a.heat.toFixed(0)} vs ${b.heat.toFixed(0)}`);
  assert.ok(b.burned > 0.003, `it burns (${b.burned.toFixed(2)})`);
  assert.ok(Math.abs(a.burned - b.burned) / Math.max(1e-6, b.burned) < 0.3, `fuel burned ${a.burned.toFixed(2)} vs ${b.burned.toFixed(2)}`);
  // at 60 frames a second the air stepped a third as often
  assert.ok(Math.abs(a.sim.thermoSteps - b.sim.thermoSteps) <= 2, `${a.sim.thermoSteps} air steps vs ${b.sim.thermoSteps}`);
});
