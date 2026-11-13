import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SCENARIOS, SCENARIO_ALIASES, resolveScenario, placeBoxes, zoneScene, cloneScene } from '../src/scenarios.js';
import { PlacesOverlay, placeNear, farDistance } from '../src/render/places.js';
import { createSimulation } from '../src/sim/createSimulation.js';

const overlap = (a, b) => [0, 1, 2].every((k) => a.min[k] < b.max[k] && b.min[k] < a.max[k]);

// the tea house garden: the washing line and the veranda are places of one world
test('the tea house garden: its places side by side, each with a label and a box, none overlapping', () => {
  const sc = SCENARIOS.teaGarden;
  assert.ok(sc.places && sc.zones, 'a world of places');
  assert.ok(!SCENARIOS.laundry && !SCENARIOS.winterTea, 'no longer scenes of their own');
  const boxes = placeBoxes(sc);
  assert.deepEqual(boxes.map((b) => b.name).sort(), ['laundry', 'tea']);
  for (const b of boxes) {
    assert.ok(typeof b.label === 'string' && b.label.length > 3, `${b.name}: label`);
    assert.ok(b.max.every((v, k) => v > b.min[k]), `${b.name}: a box`);
  }
  assert.equal(boxes.find((b) => b.name === 'laundry').label, 'Washing line & barbecue');
  assert.equal(boxes.find((b) => b.name === 'tea').label, 'Tea on the veranda');
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!overlap(boxes[i], boxes[j]), `${boxes[i].name} / ${boxes[j].name} overlap`);
  // the garden sits by the island, across a strip of water: close, not far off
  const [tea, laundry] = ['tea', 'laundry'].map((n) => boxes.find((b) => b.name === n));
  const gap = Math.max(laundry.min[0] - tea.max[0], tea.min[0] - laundry.max[0], laundry.min[2] - tea.max[2], tea.min[2] - laundry.max[2]);
  assert.ok(gap >= 0 && gap < 3, `gap ${gap}`);
  // its lawn just above the island's water (sea level 1 m in the tea place)
  const lawn = laundry.min[1] + sc.zones.laundry.world.h;
  assert.ok(lawn > 1 && lawn < 1.3, `lawn at ${lawn}`);
  // one weather for the world: a mild autumn day, the wash can dry and the lake is open
  assert.equal(sc.weather.season, 'autumn');
  assert.ok(sc.weather.ambient > 10 && sc.weather.humidity < 0.6 && !sc.weather.iceCover && !sc.weather.snowCover);
  for (const z of Object.values(sc.zones)) assert.equal(z.weather, undefined, `${z.name}: the world's weather`);
});

test('old scenario keys open the world at their place', () => {
  assert.deepEqual(resolveScenario('laundry'), { scenario: 'teaGarden', zone: 'laundry' });
  assert.deepEqual(resolveScenario('winterTea'), { scenario: 'teaGarden', zone: 'tea' });
  assert.deepEqual(resolveScenario('carrier'), { scenario: 'carrier', zone: null });
  assert.equal(resolveScenario('nope'), null);
  for (const a of Object.values(SCENARIO_ALIASES)) assert.ok(SCENARIOS[a.scenario].zones[a.zone], `${a.scenario}.${a.zone}`);
  // a place on its own (as tests and headless runs take it): its world, the world's weather
  const z = zoneScene(cloneScene(SCENARIOS.teaGarden), 'laundry');
  assert.equal(z.world.h, 0.05);
  assert.equal(z.timeScale, 15);
  assert.equal(z.weather.season, 'autumn');
  const sim = createSimulation({ ...cloneScene(SCENARIOS.teaGarden), zone: 'laundry' });
  assert.equal(sim.world.h, 0.05);
  assert.ok(Math.abs(sim.weather.ambient - SCENARIOS.teaGarden.weather.ambient) < 1e-9);
});

test('the overview: boxes and names far off, the scenery close up; close to a place, it is the one', () => {
  const sc = SCENARIOS.teaGarden;
  const scene = new THREE.Scene();
  const ov = new PlacesOverlay(scene);
  const list = placeBoxes(sc).map((b) => ({ name: b.name, label: b.label, offset: b.min, size: b.max.map((v, k) => v - b.min[k]), active: b.name === 'tea' }));
  // over the veranda: both close enough to show their scenery
  let far = ov.update(list, [11, 6, 9]);
  assert.equal(far.get('tea'), false);
  assert.equal(far.get('laundry'), false);
  assert.ok(!ov.items.get('laundry').fill.visible && !ov.items.get('laundry').edges.visible);
  // high above: both are boxes (the other filled; the one you are in an outline)
  far = ov.update(list, [15, 150, 10]);
  assert.ok(far.get('tea') && far.get('laundry'));
  assert.ok(ov.items.get('laundry').fill.visible && ov.items.get('laundry').edges.visible);
  assert.ok(!ov.items.get('tea').fill.visible && ov.items.get('tea').edges.visible);
  // Edit world: the outlines all the time
  ov.editing = true;
  ov.update(list, [11, 6, 9]);
  assert.ok(ov.items.get('laundry').edges.visible);
  assert.ok(farDistance([7, 3, 5]) < farDistance([22, 7, 19]));
  // a click on the garden's box from above goes there
  const rc = new THREE.Raycaster(new THREE.Vector3(26, 50, 11), new THREE.Vector3(0, -1, 0));
  assert.equal(ov.pick(rc)?.name, 'laundry');
  // the camera come down to the lawn: the garden is the place; over the island it stays
  const q = list.map((p) => ({ name: p.name, active: p.active, min: p.offset, max: p.offset.map((v, k) => v + p.size[k]) }));
  assert.equal(placeNear(q, [26.5, 3, 11.5]), 'laundry');
  assert.equal(placeNear(q, [11, 6, 9]), null);
});
