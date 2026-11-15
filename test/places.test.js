import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SCENARIOS, SCENARIO_ALIASES, LAKESIDE_AUTUMN, resolveScenario, openScenario, placeBoxes, placeOrigin, zoneScene, cloneScene } from '../src/scenarios.js';
import { PlacesOverlay, placeNear, farDistance } from '../src/render/places.js';
import { createSimulation } from '../src/sim/createSimulation.js';
import { F_BURNING } from '../src/sim/world.js';
import { placeFacts } from '../src/editor/editor.js';

const overlap = (a, b) => [0, 1, 2].every((k) => a.min[k] < b.max[k] && b.min[k] < a.max[k]);
const inside = (a, b) => [0, 1, 2].every((k) => a.min[k] >= b.min[k] && a.max[k] <= b.max[k]);
const sc = SCENARIOS.carrier;
const boxes = placeBoxes(sc);
const box = (n) => boxes.find((b) => b.name === n);

// the carrier's world is a world of places: the old Garden by the tea house (the veranda on the
// lake island and the garden with the washing line), the Wind-driven grass fire (a meadow by the
// lake house) and the Catacombs are places of it
test('the carrier world: every place a box with a label; the lake house, its garden and its meadow side by side', () => {
  assert.ok(sc.places && sc.zones, 'a world of places');
  for (const k of ['teaGarden', 'laundry', 'winterTea', 'grassFire', 'catacombs', 'hallwaySprinklers', 'foggyForest']) assert.ok(!SCENARIOS[k], `${k}: no longer a scene of its own`);
  // every place shows as a box (those inside or under another at a schematic spot)
  assert.deepEqual(boxes.map((b) => b.name).sort(), Object.keys(sc.zones).sort());
  for (const b of boxes) {
    assert.ok(typeof b.label === 'string' && b.label.length > 3, `${b.name}: label`);
    assert.ok(b.max.every((v, k) => v > b.min[k]), `${b.name}: a box`);
    assert.equal(b.schematic, !sc.zones[b.name].origin);
  }
  assert.deepEqual(boxes.filter((b) => b.schematic).map((b) => b.name).sort(), ['below', 'headquarters', 'lower']);
  assert.equal(box('garden').label, 'Washing line & barbecue');
  // the places in the open do not overlap
  const open = boxes.filter((b) => !b.schematic);
  for (let i = 0; i < open.length; i++) for (let j = i + 1; j < open.length; j++) assert.ok(!overlap(open[i], open[j]), `${open[i].name} / ${open[j].name} overlap`);
  // the garden and the meadow by the lake island, across a strip of water
  const gap = (a, b) => Math.max(a.min[0] - b.max[0], b.min[0] - a.max[0], a.min[2] - b.max[2], b.min[2] - a.max[2]);
  assert.ok(gap(box('garden'), box('lake')) >= 0 && gap(box('garden'), box('lake')) < 3);
  assert.ok(gap(box('meadow'), box('lake')) >= 0 && gap(box('meadow'), box('lake')) < 3);
  // the lawn and the meadow just above the lake island's water (its sea level 1 m up in it)
  const water = sc.zones.lake.origin[1] + 1.0;
  for (const n of ['garden', 'meadow']) {
    const ground = box(n).min[1] + sc.zones[n].world.h;
    assert.ok(ground > water && ground < water + 0.4, `${n}: ground at ${ground}`);
  }
  // neighbours: one group; the ship, the islands and orbit are not
  for (const n of ['lake', 'garden', 'meadow']) assert.equal(sc.zones[n].group, 'lake');
  for (const n of ['deck', 'below', 'lower', 'islet', 'spaceship', 'camp']) assert.equal(sc.zones[n].group, undefined);
  // the schematic spots: below deck in the hull under the flight deck, the lower decks under it
  // (the catacombs under the church: the Fantasy world, test/fantasy.test.js)
  assert.ok(inside(box('below'), box('deck')) && inside(box('lower'), box('deck')));
  assert.ok(box('below').max[1] <= sc.zones.deck.origin[1] + 11 && box('lower').max[1] <= box('below').min[1] + 1e-9);
  assert.equal(placeOrigin(sc.zones.below), sc.zones.below.box);
});

test('the lake house places: a mild early-autumn day of their own (the garden shares it), the meadow hot, dry and windy', () => {
  const lake = sc.zones.lake.weather;
  assert.equal(lake.season, 'autumn');
  assert.ok(lake.ambient > 10 && lake.humidity < 0.6 && !lake.iceCover && !lake.snowCover);
  assert.equal(sc.zones.garden.weatherOf, 'lake');
  assert.equal(sc.zones.garden.weather, undefined);
  const g = createSimulation({ ...cloneScene(sc), zone: 'garden' });
  assert.equal(g.world.h, 0.05);
  assert.ok(Math.abs(g.weather.ambient - LAKESIDE_AUTUMN.ambient) < 1e-9 && Math.abs(g.weather.windSpeed - LAKESIDE_AUTUMN.windSpeed) < 1e-9);
  // the meadow: the old grass fire's wind and dryness, its field and its time scale
  const m = sc.zones.meadow;
  assert.equal(m.weather.windSpeed, 4);
  assert.equal(m.weather.windDir, 0);
  assert.equal(m.weather.humidity, 0.25);
  assert.equal(m.weather.ambient, 28);
  assert.equal(m.timeScale, 3);
  assert.deepEqual(m.world.size, [24, 9, 14]);
  assert.equal(m.world.h, 0.2);
  assert.equal(m.objects.filter((o) => o.ignite).length, 1);
});

test('old scenario keys open the carrier world at their place', () => {
  assert.deepEqual(resolveScenario('laundry'), { scenario: 'carrier', zone: 'garden' });
  assert.deepEqual(resolveScenario('teaGarden'), { scenario: 'carrier', zone: 'lake' });
  assert.deepEqual(resolveScenario('grassFire'), { scenario: 'carrier', zone: 'meadow' });
  assert.deepEqual(resolveScenario('catacombs'), { scenario: 'fantasy', zone: 'catacombs' });
  assert.deepEqual(resolveScenario('foggyForest'), { scenario: 'fantasy', zone: 'forest' });
  assert.deepEqual(resolveScenario('hallwaySprinklers'), { scenario: 'carrier', zone: 'headquarters' });
  assert.equal(resolveScenario('winterTea').zone, 'lake');
  assert.deepEqual(resolveScenario('carrier'), { scenario: 'carrier', zone: null });
  assert.equal(resolveScenario('nope'), null);
  for (const a of Object.values(SCENARIO_ALIASES)) assert.ok(SCENARIOS[a.scenario].zones[a.zone], `${a.scenario}.${a.zone}`);
  for (const [k, a] of Object.entries(SCENARIO_ALIASES)) assert.equal(openScenario(k).startZone, a.zone, k);
  assert.equal(openScenario('carrier').startZone, 'deck');
  // winterTea: the lake house in its cold snap (and so its garden: it shares the weather)
  const wt = openScenario('winterTea');
  assert.equal(wt.zones.lake.weather.season, 'winter');
  assert.ok(wt.zones.lake.weather.iceCover > 0.05);
  assert.equal(zoneScene(wt, 'garden').weather.season, 'winter');
  assert.equal(SCENARIOS.carrier.zones.lake.weather.season, 'autumn', 'the original is left as it was');
  // a place on its own (as tests and headless runs take it): its world, its weather
  const z = zoneScene(cloneScene(sc), 'garden');
  assert.equal(z.world.h, 0.05);
  assert.equal(z.timeScale, 15);
  assert.equal(z.weather.season, 'autumn');
});

test('the catacombs under the church are the old Catacombs scene: the same passages, guards, torches, doors and air', () => {
  const fw = SCENARIOS.fantasy;
  const zd = fw.zones.catacombs;
  assert.deepEqual(zd.world, { size: [36, 4.2, 34], h: 0.2, ground: 'quarrySand' });
  assert.equal(zd.view.dark, true);
  assert.equal(zd.timeScale, 1);
  assert.equal(zd.exposure, 'underground');
  assert.deepEqual(zd.weather, { ambient: 12, humidity: 0.8 });
  const count = (t) => zd.objects.filter((o) => o.type === t).length;
  assert.deepEqual(
    ['catacombs', 'enemy', 'cryptChapel', 'statue', 'candelabra', 'scannedProp', 'candle'].map(count),
    [1, 3, 1, 1, 1, 2, 6],
  );
  assert.equal(zd.objects.filter((o) => o.type === 'enemy').reduce((n, o) => n + o.params.count, 0), 5, 'five guards');
  assert.ok(zd.objects.some((o) => o.type === 'enemy' && o.params.key), 'the jailer with the key');
  assert.equal(zd.objects[0].params.exitTo, 'island', 'the stairs up into the church');
  const sim = createSimulation({ ...cloneScene(fw), zone: 'catacombs' });
  const w = sim.world;
  assert.ok(w.dark && w.indoor, 'dark, no sky');
  assert.ok(Math.abs(sim.weather.ambient - 12) < 1e-9 && Math.abs(sim.weather.humidity - 0.8) < 1e-9, 'its cool damp air');
  assert.equal(sim.weather.windSpeed, 0);
  assert.ok(w.heaters.filter((h) => h.light).length >= 10, 'torches');
  assert.ok(w.doors.some((d) => d.locked), 'a locked door');
  assert.equal(w.enemies.length, 5);
  assert.ok(w.portals.some((p) => p.to === 'island'));
});

test('the hallway with sprinklers is the corridor inside the headquarters of the military base: its gas pipe bursts, its sprinklers go off', { timeout: 5 * 60 * 1000 }, () => {
  // ?scenario=hallwaySprinklers opens the carrier's world in it
  const open = openScenario('hallwaySprinklers');
  assert.equal(open.startZone, 'headquarters');
  const zd = sc.zones.headquarters;
  assert.equal(zd.within, 'camp', 'inside a building of the camp island');
  assert.ok(sc.zones.camp.objects.some((o) => o.type === 'hqBuilding' && o.params.doorTo === 'headquarters' && o.children?.includes(zd)));
  // the old scene's corridor, air and view
  assert.deepEqual(zd.world, { size: [17, 4.2, 7.6], h: 0.1 });
  assert.equal(zd.exposure, 'indoor');
  assert.equal(zd.timeScale, 1);
  const hallway = zd.objects.find((o) => o.type === 'hallway');
  assert.equal(hallway.params.sprinklers, true);
  // built: indoors, its 18 °C, sprinklers, the extinguisher and the hose reel, the way out to the base
  open.zones.headquarters.objects.find((o) => o.type === 'hallway').params.burstAfter = 1; // (sooner, as tests go)
  const sim = createSimulation({ ...open, zone: 'headquarters' });
  const w = sim.world;
  assert.ok(w.indoor);
  assert.ok(Math.abs(sim.weather.ambient - 18) < 1e-9);
  assert.equal(sim.weather.windSpeed, 0);
  assert.ok(w.sprinklers.length >= 3, 'sprinkler heads');
  assert.deepEqual(w.pickups.map((p) => p.type).sort(), ['extinguisher', 'hoseReel']);
  const out = w.portals.find((p) => p.to === 'camp');
  assert.ok(out && out.arrive && out.arrive.p[0] > out.p[0], 'the entrance leads out; in, you stand inside it');
  // the gas pipe bursts; the hot gas bursts the bulbs
  while (w.time < 120 && !w.sprinklers.some((s) => s.active)) sim.step(sim.dt);
  assert.ok(w.events.some((e) => e.type === 'pipeBurst'), 'the pipe burst');
  assert.ok(w.sprinklers.some((s) => s.active), `a sprinkler head opened (by ${w.time.toFixed(0)} s)`);
  assert.ok(w.events.some((e) => e.type === 'sprinkler'));
});

test('the meadow by the lake house: the grass fire runs downwind across it to the trees and the fence', { timeout: 10 * 60 * 1000 }, () => {
  const sim = createSimulation({ ...cloneScene(sc), zone: 'meadow' });
  const w = sim.world;
  const front = () => {
    let f = 0;
    for (let k = 0; k < w.solidCount; k++) {
      const i = w.solids[k];
      if (w.flags[i] & F_BURNING) f = Math.max(f, w.coords(i)[0] * w.h);
    }
    return f;
  };
  while (w.time < 20) sim.step(sim.dt);
  const f20 = front();
  // (the old scene: 16 m by 20 s)
  assert.ok(f20 > 12, `front at ${f20.toFixed(1)} m after 20 s`);
  while (w.time < 30) sim.step(sim.dt);
  assert.ok(front() > 20, `front at ${front().toFixed(1)} m after 30 s: past the trees`);
});

test('the overview: boxes and names far off, the scenery close up; close to a neighbour, it is the one', () => {
  const scene = new THREE.Scene();
  const ov = new PlacesOverlay(scene);
  const here = sc.zones.lake.origin;
  const list = boxes.map((b) => ({ name: b.name, label: b.label, offset: b.min.map((v, k) => v - here[k]), size: b.max.map((v, k) => v - b.min[k]), active: b.name === 'lake', schematic: b.schematic }));
  // over the veranda: the garden close enough to show its scenery
  let far = ov.update(list, [11, 6, 9]);
  assert.equal(far.get('lake'), false);
  assert.equal(far.get('garden'), false);
  assert.ok(!ov.items.get('garden').fill.visible && !ov.items.get('garden').edges.visible);
  assert.equal(far.get('spaceship'), true, 'the spaceship far off: its box');
  // high above: all boxes (the others filled; the one you are in an outline)
  far = ov.update(list, [15, 300, 10]);
  assert.ok(far.get('lake') && far.get('garden') && far.get('meadow'));
  assert.ok(ov.items.get('garden').fill.visible && ov.items.get('garden').edges.visible);
  assert.ok(!ov.items.get('lake').fill.visible && ov.items.get('lake').edges.visible);
  // Edit world: the outlines all the time
  ov.editing = true;
  ov.update(list, [11, 6, 9]);
  assert.ok(ov.items.get('garden').edges.visible && ov.items.get('below').edges.visible);
  assert.ok(farDistance([7, 3, 5]) < farDistance([22, 7, 19]));
  // a click on the garden's box from above goes there
  const g = box('garden');
  const rc = new THREE.Raycaster(new THREE.Vector3((g.min[0] + g.max[0]) / 2 - here[0], 50, (g.min[2] + g.max[2]) / 2 - here[2]), new THREE.Vector3(0, -1, 0));
  assert.equal(ov.pick(rc)?.name, 'garden');
  // a click on the ship's box over the decks below it: the place inside
  const b = box('below');
  rc.set(new THREE.Vector3((b.min[0] + b.max[0]) / 2 - here[0], 200, (b.min[2] + b.max[2]) / 2 - here[2]), new THREE.Vector3(0, -1, 0));
  assert.ok(['below', 'lower'].includes(ov.pick(rc)?.name), ov.pick(rc)?.name);
  // the camera come down to the lawn: the garden is the place; over the island it stays
  const q = list.filter((p) => ['lake', 'garden', 'meadow'].includes(p.name)).map((p) => ({ name: p.name, active: p.active, min: p.offset, max: p.offset.map((v, k) => v + p.size[k]) }));
  const lawn = [g.min[0] + 3.5 - here[0], g.min[1] + 1.5 - here[1], g.min[2] + 2.5 - here[2]];
  assert.equal(placeNear(q, lawn), 'garden');
  assert.equal(placeNear(q, [11, 6, 9]), null);
  // going to a neighbour puts the camera where it stays there (not closer to another one)
  for (const n of ['lake', 'garden', 'meadow']) {
    const zd = sc.zones[n];
    const cam = zd.origin.map((v, k) => v + zd.view.camera[k] - here[k]);
    assert.equal(placeNear(q.map((p) => ({ ...p, active: p.name === n })), cam), null, `${n}: its camera keeps it`);
  }
});

test('the places list says of every place where it is, its size in metres and its voxels', () => {
  const f = (n) => placeFacts(sc.zones[n] ?? SCENARIOS.fantasy.zones[n]);
  assert.deepEqual([f('catacombs').where, f('below').where, f('spaceship').where, f('deck').where, f('garden').where], ['Underground', 'Indoors', 'Sealed', 'Outdoors', 'Outdoors']);
  assert.equal(f('catacombs').size, '36 × 34 × 4.2 m');
  assert.equal(f('catacombs').voxels, '20 cm voxels');
  assert.equal(f('garden').voxels, '5 cm voxels');
  assert.equal(f('garden').size, '7 × 5 × 3 m');
  assert.match(f('catacombs').title, /Underground/);
  assert.match(f('catacombs').title, /36 m wide × 34 m deep × 4.2 m high/);
  assert.match(f('catacombs').title, /schematic/);
  assert.match(f('lake').title, /At 240, 1.8, 150 m in the world/);
});
