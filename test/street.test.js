import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, SCENARIO_ALIASES, resolveScenario, openScenario, zoneScene, placeBoxes } from '../src/scenarios.js';
import { MODELS, defaultParams } from '../src/models/index.js';
import { buildScene } from '../src/models/voxelizer.js';
import { buildWorld, createSimulation } from '../src/sim/createSimulation.js';
import { farRadiation } from '../src/sim/farRadiation.js';
import { MATERIALS, MAT } from '../src/sim/materials.js';
import { F_BURNING } from '../src/sim/world.js';
import { GROUPS } from '../src/editor/editor.js';

const carrier = SCENARIOS.carrier;

// the old Car fire next to a house and Garden on a dry day are places of the carrier's world
// (the street by the lake house): old links open them there
test('the car fire by a house and the garden on a dry day: places of the carrier world, old links open them', () => {
  assert.equal(SCENARIOS.carHouse, undefined);
  assert.equal(SCENARIOS.neighbourhood, undefined);
  assert.deepEqual(resolveScenario('carHouse'), { scenario: 'carrier', zone: 'carHouse' });
  assert.deepEqual(resolveScenario('neighbourhood'), { scenario: 'carrier', zone: 'dryGarden' });
  for (const [key, zone] of [['carHouse', 'carHouse'], ['neighbourhood', 'dryGarden']]) {
    assert.ok(SCENARIO_ALIASES[key]);
    const sc = openScenario(key);
    assert.equal(sc.startZone, zone);
    assert.ok(sc.places && sc.zones[zone].origin, `${zone}: a place in the open`);
    assert.equal(sc.zones[zone].group, 'lake', 'a neighbour of the lake house');
    // it builds and runs as its own scene
    const sim = createSimulation(sc);
    assert.equal(sim.world.h, sc.zones[zone].world.h);
    for (let k = 0; k < 3; k++) sim.step(sim.dt);
  }
  // their old weather, time scale, size and fire start
  const ch = carrier.zones.carHouse;
  assert.equal(ch.timeScale, 10);
  assert.equal(ch.weather.windSpeed, 1.5);
  assert.equal(ch.weather.windDir, 90);
  assert.deepEqual(ch.world, { size: [14, 8, 11], h: 0.15 });
  assert.deepEqual(ch.objects.filter((o) => o.ignite).map((o) => o.type), ['car']);
  const zs = zoneScene(carrier, 'carHouse');
  assert.equal(zs.weather.ambient, 15, 'its own weather, not the carrier\'s');
  const dg = carrier.zones.dryGarden;
  assert.equal(dg.timeScale, 10);
  assert.equal(dg.weather.windSpeed, 2);
  assert.equal(dg.weather.windDir, 30);
  assert.equal(dg.weather.humidity, 0.3);
  assert.equal(dg.weather.ambient, 25);
  assert.deepEqual(dg.world, { size: [22, 9, 18], h: 0.2 });
  assert.deepEqual(dg.objects.filter((o) => o.ignite).map((o) => o.type), ['house'], 'the fire starts on the sofa');
  for (const t of ['house', 'car', 'woodPile', 'fence', 'hedge', 'tree', 'grass']) assert.ok(dg.objects.some((o) => o.type === t), `the garden has a ${t}`);
  // lawns level with the garden's and the meadow's (a little above the lake), boxes clear of the others
  const water = carrier.zones.lake.origin[1] + 1.0;
  for (const z of [ch, dg]) {
    const ground = z.origin[1] + z.world.h;
    assert.ok(ground > water && ground < water + 0.4, `ground at ${ground}`);
  }
  const boxes = placeBoxes(carrier).filter((b) => !b.schematic);
  const overlap = (a, b) => [0, 1, 2].every((k) => a.min[k] < b.max[k] && b.min[k] < a.max[k]);
  for (const n of ['carHouse', 'dryGarden']) {
    const b = boxes.find((x) => x.name === n);
    for (const o of boxes) if (o !== b) assert.ok(!overlap(b, o), `${n} / ${o.name} overlap`);
  }
});

test('the house, the car, the hedge, the living room, the fence and the woodpile are objects of the catalogue', () => {
  const listed = new Set(GROUPS.flatMap(([, ks]) => ks));
  for (const t of ['house', 'car', 'hedge', 'livingRoom', 'fence', 'woodPile', 'tree']) {
    assert.ok(MODELS[t], `${t}: a model`);
    assert.ok(listed.has(t), `${t}: in the Add-an-object menu`);
    const p = defaultParams(t);
    for (const k of Object.keys(MODELS[t].params)) assert.notEqual(p[k], undefined);
  }
  for (const k of ['storeys', 'windowFrame', 'eaves', 'gutter', 'windowWidth', 'backDoor', 'curtains', 'furnished']) assert.ok(MODELS.house.params[k], `house.${k}`);
  for (const k of ['fuelLiters', 'tankMaterial', 'tankVent', 'igniteAt']) assert.ok(MODELS.car.params[k], `car.${k}`);
  const count = (params, h = 0.15) => {
    const { world: w } = buildScene({ world: { size: [12, 12, 10], h }, objects: [{ type: 'house', params, x: 6, z: 5 }] });
    const c = {};
    for (let k = 0; k < w.solidCount; k++) {
      const m = MATERIALS[w.mat[w.solids[k]]].name;
      c[m] = (c[m] ?? 0) + 1;
    }
    return { c, doors: w.doors.length };
  };
  const one = count({});
  const two = count({ storeys: 2, backDoor: true });
  assert.ok(one.c.plastic > 0, 'a uPVC gutter');
  assert.ok(one.c.fabric > 0 && one.c.foam > 0 && one.c.paper > 0, 'furnished');
  assert.equal(one.doors, 1, 'the front door opens');
  assert.equal(two.doors, 2, 'and the back door');
  assert.ok(two.c.brick > 1.6 * one.c.brick && two.c.glass > 1.6 * one.c.glass, 'two storeys: twice the walls and windows');
  assert.ok(count({ windowFrame: 'aluminium', gutter: 'none', eaves: 'uPVC' }).c.aluminium > 0);
  assert.ok(!count({ gutter: 'none', eaves: 'open' }).c.plastic, 'no gutter, open eaves: no plastic');
  // a hedge: a dried-out conifer hedge is drier than a watered privet
  const hedge = (params) => {
    const { world: w } = buildScene({ world: { size: [8, 4, 4], h: 0.1 }, weather: { humidity: 0.5 }, objects: [{ type: 'hedge', params, x: 4, z: 2 }] });
    let n = 0, mo = 0;
    for (let k = 0; k < w.solidCount; k++) {
      const i = w.solids[k];
      if (w.mat[i] === MAT.needles || w.mat[i] === MAT.leaves) (n++, (mo += w.moist[i]));
    }
    return { n, mo: mo / n };
  };
  const dry = hedge({ kind: 'conifer', dryness: 1 });
  const wet = hedge({ kind: 'privet', dryness: 0 });
  assert.ok(dry.n > 100 && wet.n > 100);
  assert.ok(dry.mo < 0.5 * wet.mo, `${dry.mo} vs ${wet.mo}`);
});

// a fire's radiation further out than the blurred field: the wall facing it takes it, the room
// behind it only once the window is gone
test('far radiation: the wall facing a burning car takes it in, the curtains behind the windows only once the panes are gone', () => {
  const sc = zoneScene(openScenario('carHouse'), 'carHouse');
  const { world: w } = buildWorld(sc);
  const house = sc.objects.findIndex((o) => o.type === 'house');
  // (what the solid pass keeps: the faces open to the air)
  const exposeAll = () => {
    for (let k = 0; k < w.solidCount; k++) {
      const i = w.solids[k];
      const [x, y, z] = w.coords(i);
      let e = 0;
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const X = x + dx, Y = y + dy, Z = z + dz;
        if (X < 0 || Y < 0 || Z < 0 || X >= w.nx || Y >= w.ny || Z >= w.nz || !w.mat[X + w.nx * (Y + w.ny * Z)]) e++;
      }
      w.expo[i] = e;
    }
  };
  const field = () => {
    w.updateDerived();
    exposeAll();
    w.flameAcc.fill(0);
    // a fully involved car: ~1 MW radiated from the flames round and over it
    const cells = new Set();
    for (let x = 4.6; x <= 8.4; x += w.ah) for (let y = 1.2; y <= 3.0; y += w.ah) for (let z = 1.7; z <= 3.5; z += w.ah) cells.add(w.airIdx(Math.floor(x / w.ah), Math.floor(y / w.ah), Math.floor(z / w.ah)));
    for (const a of cells) w.flameAcc[a] = 1e6 / 0.3 / cells.size; // (its flames: 0.3 of their heat radiated)
    w.time = (w.time ?? 0) + 10;
    farRadiation(w);
  };
  field();
  // the wall facing the car (z = 5 to 5.2 m, its outside at 5.1), above the car's bonnet
  const wallAt = (x, y) => w.voxelAt(x, y, 5.15);
  const outside = [];
  for (let x = 4; x <= 10; x += 0.5) {
    const i = wallAt(x, 1.5);
    if (i >= 0 && w.owner[i] === house && w.mat[i] === MAT.wood) outside.push(w.radFar[i]);
  }
  assert.ok(outside.length > 5);
  const mean = outside.reduce((a, b) => a + b, 0) / outside.length;
  assert.ok(mean > 3000 && mean < 40000, `the wall facing the car: ${mean} W/m²`);
  // the sofa stands against that wall inside: nothing reaches it through the wall
  // the curtains hang inside the windows facing it: the panes shade them
  const curtains = () => {
    const out = [];
    for (let k = 0; k < w.solidCount; k++) {
      const i = w.solids[k];
      const [, y, z] = w.coords(i);
      if (w.owner[i] === house && w.mat[i] === MAT.fabric && z * w.h < 5.6 && y * w.h > 0.8) out.push(w.radFar[i]);
    }
    assert.ok(out.length > 20, 'curtains');
    return Math.max(...out);
  };
  assert.equal(curtains(), 0, 'behind the glass: nothing');
  // and the sofa against that wall gets next to nothing through it
  let sofa = 0, nSofa = 0;
  for (let k = 0; k < w.solidCount; k++) {
    const i = w.solids[k];
    if (w.owner[i] === house && w.mat[i] === MAT.foam) (nSofa++, (sofa += w.radFar[i]));
  }
  assert.ok(nSofa > 50 && sofa / nSofa < 0.05 * mean, `the sofa: ${sofa / nSofa} W/m²`);
  // the far side of the house (z = 10) gets nothing
  const back = w.voxelAt(7, 1.2, 9.9);
  assert.equal(w.radFar[back] ?? 0, 0, 'the far wall is in the shade');
  // the windows facing the car crack and fall out: now the curtains take it
  for (let k = w.solidCount - 1; k >= 0; k--) {
    const i = w.solids[k];
    const [, , z] = w.coords(i);
    if (w.owner[i] === house && w.mat[i] === MAT.glass && z * w.h < 6) w.clearVoxel(i);
  }
  w.rebuildLists();
  field();
  assert.ok(curtains() > 3000, `through the open windows: ${curtains()} W/m²`);
});

// the whole thing, as it runs: the engine fire spreads into the cabin (the scuttle panel and
// the bulkhead), the car burns fully, and its heat and flames set the wooden house next to it
// alight (the gutter, the fascia, the wall, the shingles) within a quarter of an hour
test('the car fire by the house: the house catches within a plausible time', { timeout: 3_600_000 }, () => {
  const sc = openScenario('carHouse');
  const zone = sc.zones.carHouse;
  const sim = createSimulation(sc);
  const w = sim.world;
  const houseIdx = zone.objects.findIndex((o) => o.type === 'house');
  const burning = (owner) => {
    let n = 0;
    for (let k = 0; k < w.solidCount; k++) {
      const i = w.solids[k];
      if (w.owner[i] === owner && w.flags[i] & F_BURNING) n++;
    }
    return n;
  };
  let t = 0;
  let cabin = null; // when the car is fully alight (over 0.5 MW)
  let house = 0;
  while (t < 900) {
    sim.step(sim.dt);
    t += sim.dt;
    if (cabin === null && sim.stats.hrr > 5e5) cabin = t;
    if (Math.round(t / sim.dt) % 50 === 0) {
      house = burning(houseIdx);
      if (house > 30) break;
    }
  }
  assert.ok(cabin !== null && cabin < 480, `the car fully alight within 8 minutes (${cabin?.toFixed(0)} s)`);
  assert.ok(house > 30, `the house is burning (${house} voxels after ${t.toFixed(0)} s)`);
  assert.ok(t > cabin + 60, 'not before the car has burned a while');
});
