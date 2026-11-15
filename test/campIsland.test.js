import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, SCENARIO_ALIASES, cloneScene, placeBoxes, openScenario } from '../src/scenarios.js';
import { CAMP_AT, PAD_TOP, campDeployPoint, CAMP_ISLAND_SEA } from '../src/campIsland.js';
import { buildWorld, createSimulation, spawnFloor } from '../src/sim/createSimulation.js';
import { traceVoxels } from '../src/ai/sight.js';
import { MATERIALS } from '../src/sim/materials.js';
import { MODELS } from '../src/models/index.js';
import { hubWind, turbinePower, stepTurbine, panelIrradiance, sunNow } from '../src/sim/power.js';

const sc = SCENARIOS.carrier;
const zone = sc.zones.camp;
const LONG = { timeout: 20 * 60 * 1000 };

test('the camp island: a place of its own in the carrier world, with the camp, its solar park, its turbine and a squad', () => {
  assert.ok(zone, 'a camp zone');
  assert.ok(zone.origin && zone.label && !zone.group && !zone.indoor, 'outdoors, in the world by its origin');
  const types = zone.objects.map((o) => o.type);
  for (const t of ['campIsland', 'droneCamp', 'solarPark', 'windTurbine', 'campPatrol']) assert.equal(types.filter((x) => x === t).length, 1, t);
  for (const t of ['campIsland', 'droneCamp', 'solarPark', 'windTurbine', 'campPatrol']) assert.ok(MODELS[t]?.params && MODELS[t].label, `${t}: a model with parameters (the editor's)`);
  // its own box, clear of every other place in the open
  const boxes = placeBoxes(sc).filter((b) => !b.schematic);
  const me = boxes.find((b) => b.name === 'camp');
  for (const b of boxes) if (b !== me) assert.ok([0, 2].some((k) => me.min[k] >= b.max[k] || b.min[k] >= me.max[k]), `clear of ${b.name}`);
  // its sea level with the others' (2.9 m), its sea floor noted for the archipelago
  const terrain = zone.objects[0];
  assert.ok(Math.abs(zone.origin[1] + zone.world.h + terrain.params.seaLevel - 2.9) < 1e-9);
  assert.ok(sc.archipelago.zones.includes(CAMP_ISLAND_SEA));
  // the places list can put you down there; ?scenario=campIsland opens the world there
  assert.ok(zone.deploy?.label);
  assert.deepEqual(SCENARIO_ALIASES.campIsland, { scenario: 'carrier', zone: 'camp' });
  assert.equal(openScenario('campIsland').startZone, 'camp');
  // the cables run from the park's container and the turbine's foot to the camp's power panel
  const park = zone.objects.find((o) => o.type === 'solarPark');
  const wt = zone.objects.find((o) => o.type === 'windTurbine');
  assert.ok(Math.hypot(park.params.cableX, park.params.cableZ) > 5 && Math.hypot(wt.params.cableX, wt.params.cableZ) > 5);
});

// the camp island's world, built once (as createSimulation builds it)
let built = null;
const world = () => (built ??= buildWorld({ ...cloneScene(sc), zone: 'camp' })).world;

test('the camp island built: generators and a load on one grid, a squad of soldiers on a round about the camp', LONG, () => {
  const w = world();
  assert.deepEqual(w.generators.map((g) => g.kind).sort(), ['solar', 'wind']);
  assert.ok(w.generators.every((g) => g.grid === 'camp'));
  assert.equal(w.loads.length, 1);
  assert.equal(w.loads[0].grid, 'camp');
  // the turbine's nacelle and the inverter are there (voxels at their check points)
  for (const g of w.generators) {
    const i = w.voxelAt(...g.check);
    assert.ok(i >= 0 && w.mat[i], `${g.kind}: its ${g.kind === 'wind' ? 'nacelle' : 'inverter'}`);
  }
  // the squad: four soldiers of one team on a round of 8 corners about the camp's middle
  const E = w.enemies;
  assert.equal(E.length, 4);
  assert.ok(E.every((e) => e.soldier && e.unit === 'Kilo' && e.armour && e.lureCooldown === Infinity));
  const corners = E[0].area.corners;
  assert.equal(E[0].area.mode, 'route');
  assert.equal(corners.length, 8);
  assert.ok(E.every((e) => e.area.corners === corners || JSON.stringify(e.area.corners) === JSON.stringify(corners)), 'one round');
  const r = corners.map((c) => Math.hypot(c[0] - CAMP_AT[0], c[2] - CAMP_AT[1]));
  assert.ok(r.every((d) => Math.abs(d - 12.5) < 0.6), 'round the camp');
  // outside the bastions (9 m), on the level pad: the ground at each corner and half way to the
  // next is the pad's, and nothing stands there
  const camp = zone.objects.find((o) => o.type === 'droneCamp');
  for (let k = 0; k < corners.length; k++) {
    const a = corners[k];
    const b = corners[(k + 1) % corners.length];
    for (const t of [0, 0.5]) {
      const p = [a[0] + (b[0] - a[0]) * t, a[1], a[2] + (b[2] - a[2]) * t];
      assert.ok(Math.hypot(p[0] - camp.x, p[2] - camp.z) > 9.5 + (t ? -1.5 : 0));
      assert.ok(Math.abs(spawnFloor(w, [p[0], PAD_TOP + 0.3, p[2]]) - PAD_TOP) < 1e-6, `pad at corner ${k} (+${t})`);
      for (let y = PAD_TOP + 0.25; y < PAD_TOP + 1.8; y += w.h) assert.ok(!w.mat[w.voxelAt(p[0], y, p[2])], `clear at corner ${k} (+${t}), ${y.toFixed(2)} m`);
    }
  }
  assert.ok(E.every((e) => Math.abs(e.p[1] - PAD_TOP) < 1e-6), 'they stand on the pad');
});

test('the landing ground behind the ridge: the walk-in start, out of sight of the camp and its patrol', LONG, () => {
  const w = world();
  const dp = campDeployPoint();
  // the walk-in start (its terrain's spawn) is the deploy point
  assert.ok(Math.hypot(built.spawn.p[0] - dp.p[0], built.spawn.p[2] - dp.p[2]) < 0.5);
  const floor = spawnFloor(w, built.spawn.p);
  assert.ok(Math.abs(floor - dp.ground) < 0.6, `on the ground (${floor} / ${dp.ground})`);
  const eye = [dp.p[0], floor + 1.6, dp.p[2]];
  const blocked = (a, b) => traceVoxels(w, a, b, (i) => i >= 0 && w.mat[i] !== 0 && MATERIALS[w.mat[i]].fluidity < 0.95);
  // every corner of the round, every soldier where he starts, the camp's middle, the mast's top: no line of sight
  const corners = w.enemies[0].area.corners;
  const fromCamp = [...corners.map((c) => [c[0], c[1] + 1.6, c[2]]), ...w.enemies.map((e) => [e.p[0], e.p[1] + 1.6, e.p[2]]), [CAMP_AT[0] + 4, PAD_TOP + 1.6, CAMP_AT[1]], [CAMP_AT[0] - 6.8, PAD_TOP + 9, CAMP_AT[1] + 1.6]];
  for (const p of fromCamp) assert.ok(blocked(p, eye), `seen from ${p.map((v) => v.toFixed(1)).join(', ')}`);
  // ... and none of them within the guards' sight anyway; standing up on the crest, both are in view
  let crest = null;
  const x0 = Math.round((CAMP_AT[0] + dp.p[0]) / 2);
  for (let x = x0 - 12; x <= x0 + 12; x += w.h) {
    const y = spawnFloor(w, [x, null, dp.p[2]]);
    if (!crest || y > crest[1]) crest = [x, y, dp.p[2]];
  }
  const top = [crest[0], crest[1] + 1.6, crest[2]];
  assert.ok(crest[1] > PAD_TOP + 5, `a ridge between (${crest[1].toFixed(1)} m)`);
  assert.ok(!blocked(top, eye), 'the landing seen from the crest');
  assert.ok(!blocked(top, [CAMP_AT[0] + 12.5, PAD_TOP + 1.6, CAMP_AT[1]]), 'the round seen from the crest');
});

test('a wind turbine: its power curve, turning with the wind, yawing into it, stopped above cut-out', () => {
  const g = { R: 6.5, rated: 30000, cutIn: 3, ratedWind: 11, cutOut: 25, restart: 20, hub: 16, yawRate: 6 };
  assert.equal(turbinePower(2.5, g), 0);
  assert.ok(turbinePower(6, g) > 0 && turbinePower(6, g) < turbinePower(8, g));
  assert.ok(Math.abs(turbinePower(8, g) / turbinePower(6, g) - (8 / 6) ** 3) < 1e-9, 'cubic below rated');
  assert.equal(turbinePower(14, g), 30000);
  assert.equal(turbinePower(26, g), 0);
  assert.ok(hubWind(8, 16) > 10 && hubWind(8, 16) < 11.5, 'stronger at the hub');
  // in a small world: the model on its own, the weather's wind
  const sim = createSimulation({ world: { size: [20, 22, 20], h: 0.5 }, weather: { windSpeed: 7, windDir: 90, ambient: 15 }, objects: [{ type: 'windTurbine', params: {}, x: 10, z: 10 }] });
  const t = sim.world.generators[0];
  t.yaw = 0; // facing east; the wind blows towards +z (from the north): it should turn to face -z
  const run = (s) => {
    for (let k = 0; k < s / 0.1; k++) sim.step(0.1);
  };
  run(30);
  assert.equal(t.state, 'running');
  assert.ok(t.omega > 1, `turning (${t.omega.toFixed(2)} rad/s)`);
  assert.ok(t.output > 5000, `making power (${Math.round(t.output)} W)`);
  assert.ok(Math.abs(Math.atan2(Math.sin(t.yaw + Math.PI / 2), Math.cos(t.yaw + Math.PI / 2))) < 0.05, `into the wind (${t.yaw.toFixed(2)})`);
  const a0 = t.angle;
  run(1);
  assert.notEqual(t.angle, a0, 'its rotor turns');
  // a storm: above cut-out it is feathered and braked to a stop
  sim.weather.windSpeed = 28;
  run(25);
  assert.equal(t.state, 'cutOut');
  assert.equal(t.output, 0);
  assert.ok(t.omega < 0.02, `stopped (${t.omega.toFixed(3)} rad/s)`);
  // still too windy to start again (hysteresis), then back on
  sim.weather.windSpeed = 16; // ~21.5 m/s at the hub: above its restart speed
  run(5);
  assert.equal(t.state, 'cutOut');
  sim.weather.windSpeed = 10;
  run(30);
  assert.equal(t.state, 'running');
  assert.ok(t.output > 0);
  // a calm: it idles, making nothing
  sim.weather.windSpeed = 1;
  run(40);
  assert.equal(t.output, 0);
  assert.ok(t.omega < 0.1);
  // the nacelle blown away: nothing
  const st = { ...g, omega: 3, yaw: 0, state: 'running' };
  stepTurbine(st, { windSpeed: 9, windDir: 180 }, 1, false);
  assert.equal(st.state, 'broken');
  assert.equal(st.output, 0);
});

test('the sun on the panels: facing it, they get more; set, nothing; the sun read from a sky if there is one', () => {
  const south = [0, Math.cos(0.5), Math.sin(0.5)]; // tilted 0.5 rad towards +z (south)
  const north = [0, Math.cos(0.5), -Math.sin(0.5)];
  const sun = [0, Math.sin(0.7), Math.cos(0.7)]; // 40° up in the south
  assert.ok(panelIrradiance(south, sun, 800, 1) > panelIrradiance(north, sun, 800, 1) * 1.5);
  assert.ok(panelIrradiance(south, sun, 800, 0.2) < panelIrradiance(south, sun, 800, 1), 'less under cloud (more of it diffuse)');
  assert.equal(panelIrradiance(south, [0, -0.2, 0.98], 800, 1), 0, 'the sun down');
  // where the sun is: a sky's direction when the simulation has one, else a midday sun of the season (south)
  assert.deepEqual(sunNow({ sky: { sunDir: [0, 2, 0] } }).dir, [0, 1, 0]);
  assert.equal(sunNow({ weather: { sunDir: { x: 0, y: -1, z: 0 } } }).dir[1], -1);
  const fb = sunNow({ weather: { season: 'summer' } });
  assert.ok(!fb.known && fb.dir[1] > 0.7 && fb.dir[2] > 0, 'high, from the south');
  const dusk = sunNow({ weather: { season: 'autumn', timeOfDay: 19 } });
  assert.ok(dusk.dir[1] < 0.1 && dusk.dir[0] < 0, 'evening: low, in the west');
});

test('the camp on its power: wind or sun keeps it running; neither, and its monitors and lights go dark', () => {
  const scene = (battery) => ({
    world: { size: [40, 22, 30], h: 0.5 },
    weather: { windSpeed: 0, ambient: 15, sunshine: 1, season: 'summer' },
    objects: [
      { type: 'droneCamp', params: {}, x: 12, z: 15 },
      { type: 'solarPark', params: { battery, rows: 2, columns: 6 }, x: 30, z: 8 },
      { type: 'windTurbine', params: {}, x: 31, z: 23 },
    ],
  });
  const sim = createSimulation(scene(0));
  const w = sim.world;
  const run = (s) => {
    for (let k = 0; k < s / 0.1; k++) sim.step(0.1);
  };
  const grid = () => w.power.camp;
  // night, no wind, no battery: dark (monitors and floodlights)
  sim.weather.time = 23; // (the sky's clock: sim/sky.js)
  run(3);
  assert.equal(grid().gen, 0);
  assert.equal(grid().ops, false, 'the monitors dark');
  assert.equal(grid().lights, false, 'the floodlights dark');
  assert.equal(w.loads[0].powered, false);
  // a breeze at night: the turbine runs the camp, and the floodlights come on
  sim.weather.windSpeed = 8;
  run(30);
  assert.ok(grid().wind > 3000, `wind ${Math.round(grid().wind)} W`);
  assert.equal(grid().ops, true);
  assert.equal(grid().lights, true);
  assert.ok(w.loads[0].lit);
  // a calm sunny noon: the panels run it (no lights needed by day)
  sim.weather.windSpeed = 0;
  sim.weather.time = 13;
  run(40);
  assert.equal(grid().wind, 0);
  assert.ok(grid().solar > 2000, `solar ${Math.round(grid().solar)} W`);
  assert.equal(grid().ops, true);
  assert.equal(grid().night, false);
  // the panels blown away: nothing from them, dark again
  for (const p of w.generators.find((g) => g.kind === 'solar').panelChecks) for (let dy = -1; dy <= 1; dy++) {
    const i = w.voxelAt(p[0], p[1] + dy * w.h, p[2]);
    if (i >= 0 && w.mat[i]) w.clearVoxel(i);
  }
  run(2);
  assert.equal(grid().solar, 0);
  assert.equal(grid().ops, false);
  // with a battery, the camp carries on a while through a still night, then goes dark
  const s2 = createSimulation(scene(0.05)); // 50 Wh: ~1.5 min of the operations at 1.6 kW (lights first)
  s2.weather.time = 23;
  for (let k = 0; k < 30; k++) s2.step(0.1);
  assert.equal(s2.world.power.camp.ops, true, 'on the battery');
  for (let k = 0; k < 1500; k++) s2.step(0.1);
  assert.equal(s2.world.power.camp.ops, false, 'the battery flat');
});

test('the squad walks its round in file, corner to corner (a patrol, not a fight)', LONG, () => {
  const sim = createSimulation({ world: { size: [36, 6, 36], h: 0.5 }, weather: { windSpeed: 0 }, objects: [{ type: 'campPatrol', params: { radius: 12, corners: 8 }, x: 18, z: 18 }] });
  const E = sim.world.enemies;
  const corners = E[0].area.corners;
  const visited = new Set();
  let maxGap = 0;
  const start = E.map((e) => e.p.slice());
  for (let k = 0; k < 450; k++) {
    sim.step(0.1);
    for (const e of E) corners.forEach((c, i) => Math.hypot(e.p[0] - c[0], e.p[2] - c[2]) < 1.2 && visited.add(i));
    // (each man's nearest: the one ahead of him or behind him in the file)
    if (k > 100) maxGap = Math.max(maxGap, ...E.map((e) => Math.min(...E.filter((o) => o !== e).map((o) => Math.hypot(e.p[0] - o.p[0], e.p[2] - o.p[2])))));
  }
  assert.ok(E.every((e, i) => Math.hypot(e.p[0] - start[i][0], e.p[2] - start[i][2]) > 3), 'they all moved on');
  // guards enlisted as a fire team: a commander, a gunner and riflemen of one call sign
  assert.deepEqual(E.map((e) => e.squad).sort(), ['CMD', 'MG', 'R1', 'R2']);
  assert.ok(E.every((e) => e.unit === 'Kilo' && e.state === 'patrol'));
  assert.ok(visited.size >= 4, `corners reached: ${[...visited]}`);
  // the others following him in file, a few metres apart (not bunched, not left behind)
  assert.ok(maxGap < 7, `in file (largest gap ${maxGap.toFixed(1)} m)`);
  for (const e of E) assert.ok(Math.abs(Math.hypot(e.p[0] - 18, e.p[2] - 18) - 12) < 4, 'on the round');
});
