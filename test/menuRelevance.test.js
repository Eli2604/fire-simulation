// The Play menu shows only what applies to where you are (src/ui/menuRelevance.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../src/sim/createSimulation.js';
import { SCENARIOS, cloneScene } from '../src/scenarios.js';
import { liftPlaces } from '../src/models/composite.js';
import { summarizeWorld, menuRelevance, MENU_KEYS } from '../src/ui/menuRelevance.js';

/** The menu keys of a real scenario (and a zone of it), built as the app builds it. */
function menuOf(key, zone) {
  const scene = cloneScene(SCENARIOS[key]);
  liftPlaces(scene);
  const sim = createSimulation(zone ? { ...scene, zone } : scene);
  const place = scene.zones ? scene.zones[zone ?? scene.startZone ?? Object.keys(scene.zones)[0]] : scene;
  const summary = summarizeWorld(sim.world, place);
  return { summary, menu: menuRelevance(summary) };
}

test('menuRelevance: rules on summaries', () => {
  const none = menuRelevance({ exposure: 'outdoor', dragons: 0, flights: 0, enemies: 0, doors: 0, water: false, freshWater: false });
  assert.deepEqual([...none].sort(), ['preset.lightning', 'weather.outdoor']);
  const all = menuRelevance({ exposure: 'outdoor', dragons: 1, flights: 2, enemies: 3, doors: 1, water: true, freshWater: true });
  assert.deepEqual([...all].sort(), [...MENU_KEYS].sort());
  // indoors / underground / in a sealed cabin: only the air (no ice, no lightning, no cold snap)
  for (const exposure of ['indoor', 'underground', 'sealed']) {
    const m = menuRelevance({ exposure, dragons: 0, flights: 0, enemies: 1, doors: 2, water: true, freshWater: true });
    assert.deepEqual([...m].sort(), ['squads', 'tool.door', 'tool.squadThreat']);
  }
  // the sea, no fresh water: ice and the water's look, not the lake's cold snap
  const sea = menuRelevance({ exposure: 'outdoor', water: true, freshWater: false });
  assert.ok(sea.has('weather.ice') && sea.has('weather.water') && !sea.has('preset.coldSnap'));
});

test('the smithy (the old metal bars): indoors, its shop door; no dragon, jets, squads or ice (its slack tub is no pond)', () => {
  const { summary, menu } = menuOf('metalBars');
  assert.equal(summary.exposure, 'indoor');
  assert.ok(menu.has('tool.door'));
  for (const k of ['dragon', 'flights', 'squads', 'tool.squadThreat', 'weather.outdoor', 'weather.ice', 'weather.water', 'preset.coldSnap']) assert.ok(!menu.has(k), k);
});

test('squad range: the squads, no dragon or jets', () => {
  const { menu } = menuOf('squadRange');
  assert.ok(menu.has('squads') && menu.has('tool.squadThreat'));
  assert.ok(!menu.has('dragon') && !menu.has('flights'));
});

test('office hallway: indoors (only the air), its doors', () => {
  const { summary, menu } = menuOf('hallway');
  assert.equal(summary.exposure, 'indoor');
  assert.ok(menu.has('tool.door'));
  for (const k of ['weather.outdoor', 'weather.ice', 'preset.lightning', 'dragon', 'squads']) assert.ok(!menu.has(k), k);
});

test('carrier world, the island: its dragons, guards, the pond (ice, cold snap)', () => {
  const { menu } = menuOf('carrier', 'island');
  for (const k of ['dragon', 'squads', 'weather.outdoor', 'weather.ice', 'preset.coldSnap']) assert.ok(menu.has(k), k);
  assert.ok(!menu.has('flights'));
});

test('carrier world, the flight deck: the jet flights, the sea (no cold snap), no dragon', () => {
  const { menu } = menuOf('carrier', 'deck');
  assert.ok(menu.has('flights') && menu.has('weather.ice'));
  assert.ok(!menu.has('dragon') && !menu.has('preset.coldSnap'));
});
