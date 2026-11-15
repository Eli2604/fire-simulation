import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, SCENARIO_ALIASES, resolveScenario, openScenario, placeBoxes, placeOrigin, cloneScene, zoneScene } from '../src/scenarios.js';
import { createSimulation } from '../src/sim/createSimulation.js';
import { F_BURNING } from '../src/sim/world.js';
import { MAT } from '../src/sim/materials.js';
import { makeArchipelago } from '../src/models/archipelago.js';
import { dragonIsleHeight, SEA_Y, FOREST, CASTLE, VILLAGE, CORE } from '../src/models/fantasyIsland.js';
import { smithyScene } from '../src/smithyPlace.js';
import { MODELS } from '../src/models/index.js';
import { GROUPS } from '../src/editor/editor.js';

const fw = SCENARIOS.fantasy;
const boxes = placeBoxes(fw);
const box = (n) => boxes.find((b) => b.name === n);
const overlap = (a, b) => [0, 1, 2].every((k) => a.min[k] < b.max[k] && b.min[k] < a.max[k]);
const gap = (a, b) => Math.max(a.min[0] - b.max[0], b.min[0] - a.max[0], a.min[2] - b.max[2], b.min[2] - a.max[2]);
const centre = (b) => [(b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2];

test('the Fantasy world: a world of places of its own, the dragon island and its catacombs moved there from the carrier', () => {
  assert.equal(fw.name, 'Fantasy world');
  assert.ok(fw.places && fw.zones);
  assert.deepEqual(Object.keys(fw.zones).sort(), ['castle', 'catacombs', 'forest', 'island', 'smithy', 'village']);
  assert.equal(fw.startZone, 'village', 'you arrive at the harbour village');
  assert.ok(fw.weather.time !== undefined && fw.weather.day !== undefined, 'its own time of day');
  for (const k of ['island', 'catacombs']) assert.equal(SCENARIOS.carrier.zones[k], undefined, `${k}: no longer in the carrier's world`);
  assert.ok(!SCENARIOS.foggyForest, 'the forest in fog: no longer a scene of its own');
  // every place a box; those in the open do not overlap; the catacombs schematic under the church
  assert.deepEqual(boxes.map((b) => b.name).sort(), Object.keys(fw.zones).sort());
  const open = boxes.filter((b) => !b.schematic);
  for (let i = 0; i < open.length; i++) for (let j = i + 1; j < open.length; j++) assert.ok(!overlap(open[i], open[j]), `${open[i].name} / ${open[j].name} overlap`);
  const church = fw.zones.island.objects.find((o) => o.type === 'church');
  const [cx, cz] = [fw.zones.island.origin[0] + church.x, fw.zones.island.origin[2] + church.z];
  const cat = box('catacombs');
  assert.ok(cat.schematic && Math.abs(centre(cat)[0] - cx) < 1 && Math.abs(centre(cat)[1] - cz) < 1, 'under the church');
  assert.ok(cat.max[1] <= fw.zones.island.origin[1] + 1e-9, 'underground');
  assert.equal(placeOrigin(fw.zones.catacombs), fw.zones.catacombs.box);
  // the village, the smithy, the castle and the forest: neighbours
  for (const n of ['village', 'smithy', 'castle', 'forest']) assert.equal(fw.zones[n].group, 'isle');
  assert.equal(fw.zones.island.group, undefined);
});

test('old keys open the Fantasy world at their place (the catacombs, the forest in fog)', () => {
  assert.deepEqual(resolveScenario('catacombs'), { scenario: 'fantasy', zone: 'catacombs' });
  assert.deepEqual(resolveScenario('foggyForest'), { scenario: 'fantasy', zone: 'forest' });
  assert.deepEqual(resolveScenario('fantasy'), { scenario: 'fantasy', zone: null });
  assert.equal(openScenario('foggyForest').startZone, 'forest');
  assert.equal(openScenario('catacombs').startZone, 'catacombs');
  for (const a of Object.values(SCENARIO_ALIASES)) assert.ok(SCENARIOS[a.scenario].zones[a.zone], `${a.scenario}.${a.zone}`);
});

test('the island is larger: the old island in the west, the land running on east (hills, the castle hill, the valley, the ridge)', () => {
  // the land's extent (above the sea), against the old island's 64 × 58 m
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (let x = -20; x < 220; x += 1)
    for (let z = -40; z < 140; z += 1)
      if (dragonIsleHeight(x, z) > 0.2) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        z0 = Math.min(z0, z);
        z1 = Math.max(z1, z);
      }
  assert.ok(x1 - x0 > 1.5 * 64, `${x1 - x0} m east–west`);
  assert.ok(z1 - z0 > 1.5 * 58, `${z1 - z0} m north–south`);
  // the drawn ground round a place is the same ground its voxels are made of
  const A = makeArchipelago(fw.archipelago);
  for (const [x, z] of [[85, 55], [128, 39], [128, 66], [100, 10], [40, 30]]) assert.ok(Math.abs(A.heightAt(x, z) - dragonIsleHeight(x, z)) < 1e-9, `drawn at ${x}, ${z}`);
  // the old island's ground runs on into it: its east edge is land, its west coast the sea
  assert.ok(dragonIsleHeight(CORE.size[0] - 1, 50) > 0 && dragonIsleHeight(CORE.size[0] + 1, 50) > 0, 'land across its east edge');
  assert.ok(dragonIsleHeight(1, 31) < 0, 'its west coast');
});

test('the forest in fog lies in a valley far from the volcano, lower than the ground either side; the castle above it', () => {
  const v = fw.zones.island.objects.find((o) => o.type === 'volcano');
  const vx = fw.zones.island.origin[0] + v.x;
  const vz = fw.zones.island.origin[2] + v.z;
  const [fx, fz] = centre(box('forest'));
  assert.ok(Math.hypot(fx - vx, fz - vz) > 60, `${Math.hypot(fx - vx, fz - vz).toFixed(0)} m from the volcano`);
  const floor = dragonIsleHeight(fx, fz);
  // the castle hill north of it, the ridge along the south coast
  let north = -Infinity;
  let south = -Infinity;
  for (let d = 8; d < 30; d += 0.5) {
    north = Math.max(north, dragonIsleHeight(fx, fz - d));
    south = Math.max(south, dragonIsleHeight(fx, fz + d));
  }
  assert.ok(north > floor + 4 && south > floor + 4, `valley floor ${floor.toFixed(1)} m, north ${north.toFixed(1)} m, south ${south.toFixed(1)} m`);
  // its ground level with the valley floor, its fog its own (the old scene's)
  const zd = fw.zones.forest;
  assert.ok(Math.abs(zd.origin[1] + zd.world.h - (SEA_Y + floor)) < 1e-6);
  assert.deepEqual([zd.weather.fog, zd.weather.humidity, zd.weather.ambient, zd.weather.windSpeed], [0.8, 0.9, 8, 0.5]);
  assert.equal(zd.timeScale, 6);
  assert.deepEqual(zd.world.size, FOREST.size);
  // the castle: near the forest, on higher ground
  assert.ok(gap(box('castle'), box('forest')) < 10, 'the castle by the forest');
  assert.ok(dragonIsleHeight(...centre(box('castle'))) > floor + 5);
});

test('the forest in the fog valley burns in the fog: the woodpile lights the grass and the pines, the smoke stays low', { timeout: 5 * 60 * 1000 }, () => {
  const sim = createSimulation({ ...cloneScene(fw), zone: 'forest' });
  const w = sim.world;
  assert.ok(sim.weather.fog > 0.5 && sim.weather.humidity > 0.8, 'in fog');
  assert.equal(w.trees.length, 8, 'its stand of pines');
  assert.ok(w.portals.some((p) => p.to === 'village') && w.portals.some((p) => p.to === 'castle'), 'paths out');
  let burning = 0;
  while (w.time < 20) sim.step(sim.dt);
  for (let k = 0; k < w.solidCount; k++) if (w.flags[w.solids[k]] & F_BURNING) burning++;
  assert.ok(burning > 10, `${burning} voxels burning`);
});

test('the castle builds: stone walls and towers, a gatehouse with a portcullis and gates (doors), the keep, timber that burns; a way in on foot', () => {
  assert.ok(MODELS.castle && GROUPS.some(([, types]) => types.includes('castle')), 'a model, in the editor');
  const sim = createSimulation({ ...cloneScene(fw), zone: 'castle' });
  const w = sim.world;
  assert.deepEqual(w.doors.map((d) => d.name).sort(), ['castle gate', 'keep door', 'portcullis']);
  const count = {};
  for (let k = 0; k < w.solidCount; k++) {
    const m = w.mat[w.solids[k]];
    count[m] = (count[m] ?? 0) + 1;
  }
  assert.ok(count[MAT.stone] > 3000, `${count[MAT.stone]} stone voxels`);
  assert.ok((count[MAT.wood] ?? 0) + (count[MAT.shingles] ?? 0) > 300, 'timber and shingles');
  assert.ok(w.enemies.length >= 3, 'its garrison');
  // the way in: through the gate passage (west, -x) along the castle's axis, at walking height, nothing in the way
  const c = fw.zones.castle.objects.find((o) => o.type === 'castle');
  const oi = fw.zones.castle.objects.indexOf(c);
  const [ox, oy, oz] = w.origins[oi];
  const half = c.params.width / 2;
  for (let x = ox - half - 2; x < ox - half + 4; x += w.h)
    for (const y of [oy + 0.4, oy + 1.5]) {
      const i = w.idx(Math.floor(x / w.h), Math.floor(y / w.h), Math.floor(oz / w.h));
      assert.equal(w.mat[i], 0, `the passage is open at x ${x.toFixed(1)}, y ${y.toFixed(1)}`);
    }
  // the portcullis down: it shuts the way
  const shut = cloneScene(fw);
  shut.zones.castle.objects.find((o) => o.type === 'castle').params.portcullisDown = true;
  const s2 = createSimulation({ ...shut, zone: 'castle' });
  assert.equal(s2.world.doors.find((d) => d.name === 'portcullis').startOpen, false);
});

test('the places of the isle are joined: every road has its way back, the boats run between the village and the island', () => {
  const sc = cloneScene(fw);
  const ports = {};
  for (const n of Object.keys(fw.zones)) {
    ports[n] = createSimulation({ ...sc, zone: n, noFire: true }).world.portals;
    for (const p of ports[n]) assert.ok(fw.zones[p.to], `${n} → ${p.to}`);
  }
  for (const [n, list] of Object.entries(ports))
    for (const p of list.filter((q) => q.kind === 'road')) assert.ok(ports[p.to].some((q) => q.kind === 'road' && q.to === n), `the road ${n} → ${p.to} has its way back`);
  // the village: where you arrive (on its landing stage), its roads to every other place
  const v = ports.village;
  for (const to of ['island', 'smithy', 'castle', 'forest']) assert.ok(v.some((p) => p.to === to), `village → ${to}`);
  assert.ok(v.some((p) => p.to === 'island' && p.kind !== 'road') && ports.island.some((p) => p.to === 'village' && p.kind !== 'road'), 'a boat each way');
  assert.equal(VILLAGE.origin[0] > CORE.origin[0] + CORE.size[0], true);
});

test('the smithy in the village is the smithy scene: the same workshop, air and time', () => {
  const zd = fw.zones.smithy;
  const sc = smithyScene();
  const types = (list) => list.filter((o) => o.type !== 'fantasyLand' && o.type !== 'signpost').map((o) => [o.type, o.x, o.z]);
  assert.deepEqual(types(zd.objects), types(sc.objects));
  assert.equal(zd.exposure, 'indoor');
  assert.equal(zd.timeScale, sc.timeScale);
  assert.deepEqual(zd.world.size, sc.world.size);
  // standing on the village square's level ground
  assert.ok(Math.abs(zd.origin[1] + zd.world.h - (SEA_Y + dragonIsleHeight(zd.origin[0] + 4, zd.origin[2] + 3.5))) < 1e-6);
  const z = zoneScene(cloneScene(fw), 'smithy');
  assert.equal(z.weather.ambient, 18);
  assert.ok(CASTLE.h >= 0.25, 'the castle in coarse voxels');
});
