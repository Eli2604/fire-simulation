import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepCup, cupLosses } from '../src/sim/tea.js';
import { mistOnMixing } from '../src/render/breath.js';
import { createSimulation } from '../src/sim/createSimulation.js';
import { SCENARIOS, cloneScene } from '../src/scenarios.js';
import { defaultParams } from '../src/models/index.js';
import { MATERIALS } from '../src/sim/materials.js';

const cup = (T = 85) => ({ T, m: 0.25, ice: 0 });
const run = (c, s, Ta, RH = 0.5, v = 0) => {
  for (let t = 0; t < s; t += 1) stepCup(c, 1, Ta, RH, v);
  return c;
};

test('tea cools as tea does: ~60 °C after a quarter of an hour in a room', () => {
  const c = run(cup(85), 900, 20);
  assert.ok(c.T > 52 && c.T < 68, `T ${c.T.toFixed(1)}`);
  // most of the loss is evaporation while it is hot
  const L = cupLosses(cup(85), 20, 0.5, 0);
  assert.ok(L.evap > L.conv && L.evap > L.rad, JSON.stringify(L));
  // a few grams of it are gone into the air
  assert.ok(c.m < 0.25 && c.m > 0.235, `m ${c.m}`);
});

test('in a frost with a breeze it cools faster, and in the end freezes', () => {
  const room = run(cup(85), 600, 20).T;
  const cold = run(cup(85), 600, -6, 0.85, 2).T;
  assert.ok(cold < room - 8, `room ${room.toFixed(1)} cold ${cold.toFixed(1)}`);
  const c = run(cup(85), 6 * 3600, -6, 0.85, 2);
  assert.ok(c.ice > 0.1, `ice ${c.ice}`);
  assert.ok(c.T <= 0);
});

test('its steam shows more in the cold than in a warm room, and not at all once it is cool', () => {
  // (tea gone lukewarm: a thin mist in a room, still thick in a frost)
  assert.ok(mistOnMixing(-4, 0.85, 50) > 3 * mistOnMixing(22, 0.5, 50));
  assert.ok(mistOnMixing(-4, 0.85, 30) > 0.3);
  assert.ok(mistOnMixing(22, 0.5, 80) > 0);
  assert.equal(mistOnMixing(22, 0.5, 21), 0);
});

test('Tea by the lake: the cup stands on the table, under the roof, by a frozen lake', () => {
  const sc = cloneScene(SCENARIOS.winterTea);
  for (const o of sc.objects) o.params = { ...defaultParams(o.type), ...o.params };
  const sim = createSimulation(sc);
  const w = sim.world;
  assert.equal(w.cups.length, 1);
  const c = w.cups[0];
  const under = w.voxelAt(c.p[0], c.p[1] - w.h / 2, c.p[2]);
  assert.equal(MATERIALS[w.mat[under]].name, 'wood');
  // a roof over it
  let roof = false;
  for (let y = c.p[1] + 0.3; y < w.size[1]; y += w.h) {
    const i = w.voxelAt(c.p[0], y, c.p[2]);
    if (i >= 0 && w.mat[i]) roof = true;
  }
  assert.ok(roof);
  for (let k = 0; k < 6; k++) sim.step(0.5);
  assert.ok(c.T < 88 && c.T > 80, `T ${c.T}`);
  assert.ok(c.vapour > 0);
  // the lake is frozen over, thick enough to walk on
  const lake = w.ice.at(w, 11.5, 7.0);
  assert.ok(lake && !lake.sea && lake.thick > 0.08, JSON.stringify(lake));
});
