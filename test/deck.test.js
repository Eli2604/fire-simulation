// The squad range has a raised deck (models/deck.js) west of the walls: a slab 3 m up on pillars,
// a staircase, glass rails. It gives the world its lookouts; the fire teams use them (ai/squad.js):
// a gunner climbs the stairs to the deck as overwatch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, cloneScene } from '../src/scenarios.js';
import { createSimulation } from '../src/sim/createSimulation.js';
import { MODELS, defaultParams } from '../src/models/index.js';

test('the deck model: a slab up on pillars, stairs, glass rails, lookouts at deck height', () => {
  const p = defaultParams('deck');
  const built = MODELS.deck.build(p, { h: 0.2 });
  assert.ok(built.prims.some((q) => q.material === 'glass'), 'glass rails');
  assert.ok(built.lookouts.length >= 4 && built.lookouts.every((l) => Math.abs(l[1] - p.height) < 0.11), 'lookouts at deck height');
  assert.ok(built.lookouts.every((l) => Math.abs(l[0]) < p.width / 2 && Math.abs(l[2]) < p.depth / 2), 'lookouts on the deck');
});

test('the squad range: the deck stands, the world has lookouts, a soldier climbs the stairs to it', () => {
  const scene = cloneScene(SCENARIOS.squadRange);
  const obj = scene.objects.find((o) => o.type === 'deck');
  assert.ok(obj, 'a deck in the scenario');
  const sim = createSimulation(scene);
  const w = sim.world, h = w.h;
  const H = defaultParams('deck').height;
  const deckY = h + H; // the deck's top (the ground layer is one voxel)
  // the slab is there, 3 m up, with open air under it
  const solid = (x, y, z) => w.mat[w.voxelAt(x, y, z)] > 0;
  assert.ok(solid(obj.x, deckY - 0.1, obj.z), 'the slab at deck height');
  assert.ok(!solid(obj.x, 1.5, obj.z), 'room under it');
  assert.ok(w.lookouts.length >= 4, 'the world has lookouts');
  for (const l of w.lookouts) {
    assert.ok(Math.abs(l[1] - deckY) < 0.11, `a lookout at deck height: ${l}`);
    assert.ok(Math.abs(l[0] - obj.x) < 3.6 && Math.abs(l[2] - obj.z) < 3.1, `a lookout on the deck: ${l}`);
  }
  // the stairs, in world coordinates (the model's local frame: the deck centred on its origin)
  const { stairs } = MODELS.deck.build(defaultParams('deck'), { h });
  const sx = stairs.foot[0] + obj.x, sz0 = stairs.head[2] + obj.z, sz1 = stairs.foot[2] + obj.z;
  const onFlight = (e) => Math.abs(e.p[0] - sx) < 1.2 && e.p[2] > sz0 && e.p[2] < sz1 && e.p[1] > h + 0.8 && e.p[1] < deckY - 0.6;
  const onDeck = (e) => Math.abs(e.p[0] - obj.x) < 3.7 && Math.abs(e.p[2] - obj.z) < 3.2 && Math.abs(e.p[1] - deckY) < 0.25;
  const climbed = new Set();
  let up = null;
  for (let t = 0; t < 40 && !up; t += sim.dt) {
    sim.step(sim.dt);
    for (const e of w.enemies) {
      if (!e.squad || e.dead) continue;
      if (onFlight(e)) climbed.add(e);
      if (climbed.has(e) && onDeck(e)) up = e;
    }
  }
  assert.ok(up, `someone up on the deck by the stairs: ${w.enemies.filter((e) => e.squad).map((e) => `${e.unit} ${e.squad} ${e.p.map((v) => v.toFixed(1))}`).join('; ')}`);
  assert.ok(up.lookout, 'up there as a lookout');
  assert.ok(w.enemies.every((e) => !e.dead), 'no one shot by his own side');
});
