import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAT, MATERIALS } from '../src/sim/materials.js';
import { createSimulation } from '../src/sim/createSimulation.js';
import { SCENARIOS, cloneScene } from '../src/scenarios.js';
import { toggleDoor } from '../src/sim/doors.js';
import { placeObject } from '../src/models/voxelizer.js';

const run = (sim, t) => {
  while (sim.world.time < t) sim.step(sim.dt);
};

test('carrier: only the starting zone is built; hatch and ladder lead between the zones', () => {
  const scene = cloneScene(SCENARIOS.carrier);
  const deck = createSimulation(scene);
  const w = deck.world;
  scene.zones.deck.world.size.forEach((s, k) => assert.ok(Math.abs(w.size[k] - s) < 1, 'deck zone size'));
  assert.ok(w.sea, 'at sea');
  assert.equal(w.portals[0].to, 'below');
  assert.equal(w.vehicles.length, 1, 'a jet to fly');
  const jet = w.vehicles[0];
  assert.ok(Math.abs(jet.base[1] - (w.h + 7)) < 1e-6, 'parked on the flight deck');
  let alu = 0;
  for (let i = 0; i < w.N; i++) if (w.mat[i] === MAT.aluminium && w.owner[i] === jet.owner) alu++;
  assert.ok(alu > 100, 'the jet is voxels while parked');
  const below = createSimulation({ ...scene, zone: 'below' });
  assert.equal(below.world.portals[0].to, 'deck');
  assert.equal(below.world.inertSystems.length, 1);
  assert.ok(below.world.enemies.length >= 2);
});

test('carrier: the jet is voxelised again where it stops', () => {
  const deck = createSimulation(cloneScene(SCENARIOS.carrier));
  const w = deck.world;
  const v = w.vehicles[0];
  // take it out (as boarding does) and park it 6 m further along the deck
  for (let i = 0; i < w.N; i++) if (w.mat[i] && w.owner[i] === v.owner) w.clearVoxel(i);
  w.vehicles.length = 0;
  placeObject(w, { ...v.obj, x: v.base[0] + 6, z: v.base[2], y: v.base[1] - w.h, rotation: 0 }, v.owner);
  assert.equal(w.vehicles.length, 1);
  assert.ok(Math.abs(w.vehicles[0].base[0] - (v.base[0] + 6)) < w.h, 'moved');
  let n = 0;
  let minY = Infinity;
  for (let i = 0; i < w.N; i++)
    if (w.mat[i] && w.owner[i] === v.owner) {
      n++;
      minY = Math.min(minY, w.coords(i)[1] * w.h);
    }
  assert.ok(n > 100);
  assert.ok(minY >= v.base[1] - w.h, 'standing on the deck, not in it');
});

test('server room: the inert-gas system puts out a rack fire when the door is shut, not when it is open', () => {
  const make = (open) => {
    const scene = cloneScene(SCENARIOS.carrier);
    scene.zones.below.objects = scene.zones.below.objects.slice(0, 1); // no enemies
    scene.zones.below.objects[0].params = { rackFireAfter: 1 };
    const sim = createSimulation({ ...scene, zone: 'below' });
    if (open) {
      const k = sim.world.doors.findIndex((d) => d.name === 'server room');
      sim.world.doors[k].locked = false;
      toggleDoor(sim, k, true);
    }
    return sim;
  };
  const shut = make(false);
  run(shut, 90);
  const s = shut.world.inertSystems[0];
  assert.ok(s.fired, 'the heat detector triggered');
  assert.equal(s.result.open, false, 'room sealed');
  let burning = 0;
  for (let k = 0; k < shut.world.solidCount; k++) if (shut.world.flags[shut.world.solids[k]] & 8) burning++;
  assert.equal(burning, 0, 'fire out');
  const opened = make(true);
  run(opened, 90);
  const s2 = opened.world.inertSystems[0];
  if (s2.fired) assert.equal(s2.result.open, true, 'with the door open the gas escapes');
});

test('catacombs: torches light the passages and the scene is dark', () => {
  const sim = createSimulation(cloneScene(SCENARIOS.catacombs));
  const w = sim.world;
  const torches = w.heaters.filter((h) => h.light);
  assert.ok(torches.length >= 10, `${torches.length} torches`);
  assert.ok(SCENARIOS.catacombs.view.dark);
  assert.ok(w.doors.some((d) => d.locked));
  const names = new Set();
  for (let k = 0; k < w.solidCount; k++) names.add(MATERIALS[w.mat[w.solids[k]]].name);
  for (const m of ['stone', 'bone', 'wood', 'fabric']) assert.ok(names.has(m), m);
  run(sim, 5);
  // each torch is a small flame: hot gas above it
  const t = torches[0];
  const a = sim.airCellAt(t.pos[0], t.pos[1] + 0.1, t.pos[2]);
  assert.ok(w.flame[a] > 0.05 && w.airT[a] > w.ambient + 2, `a flame and warm gas at a torch (${w.airT[a].toFixed(0)} °C)`);
});
