import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScene } from '../src/models/voxelizer.js';
import { MODELS, defaultParams } from '../src/models/index.js';
import { TREE_KINDS, treeKind } from '../src/models/treeKinds.js';
import { TREE_OBJECTS } from '../src/models/treeObjects.js';
import { MAT } from '../src/sim/materials.js';
import { SCENARIOS, SCENARIO_ALIASES, openScenario, resolveScenario, zoneScene, placeBoxes } from '../src/scenarios.js';
import { createSimulation } from '../src/sim/createSimulation.js';
import { F_BROKEN } from '../src/sim/world.js';

const build = (objects, size = [12, 14, 12], h = 0.2) => buildScene({ world: { size, h }, objects }).world;
const fingerprint = (w) => {
  const parts = [w.solidCount];
  for (const f of ['mat', 'dens', 'moist', 'fuel']) {
    let s = 0;
    for (let i = 0; i < w[f].length; i++) if (w[f][i]) s = (s * 31 + Math.round(w[f][i] * 1000) + i) % 1e9;
    parts.push(s);
  }
  return parts.join(':') + JSON.stringify(w.trees.map((t) => [t.species, t.segs]));
};
const count = (w, ...names) => {
  const ids = new Set(names.map((n) => MAT[n]));
  let n = 0;
  for (let k = 0; k < w.solidCount; k++) if (ids.has(w.mat[w.solids[k]])) n++;
  return n;
};

test('every kind of tree is an object of its own in the palette, with its own defaults and the tree knobs', () => {
  for (const k of ['oak', 'willow', 'pine', 'birch', 'maple', 'plane', 'poplar', 'spruce', 'fir', 'apple', 'palm']) {
    const M = MODELS[`${k}Tree`];
    assert.ok(M && M.label && M.about, `${k}Tree`);
    for (const p of ['height', 'crownRadius', 'trunkRadius', 'foliageDensity', 'foliageMoisture', 'trunkMoisture', 'branches', 'deadBranches', 'seed']) assert.ok(M.params[p], `${k}Tree.${p}`);
    assert.equal(M.params.species, undefined, 'its kind is fixed');
  }
  assert.deepEqual(Object.keys(TREE_OBJECTS).sort(), Object.keys(TREE_KINDS).map((k) => `${k}Tree`).sort());
  // the generic tree still picks any kind; the old names still work
  assert.deepEqual(MODELS.tree.params.species.options.sort(), Object.keys(TREE_KINDS).sort());
  assert.equal(treeKind('conifer'), 'pine');
  assert.equal(treeKind('deciduous'), 'oak');
  assert.equal(treeKind('nonsense'), 'oak');
  assert.equal(defaultParams('pineTree').deadBranches, 4);
  assert.equal(defaultParams('oakTree').deadBranches, 0);
});

test('the oak, willow and pine objects build exactly as the old scene\'s trees did (and old tree saves are unchanged)', () => {
  const old = {
    oak: { species: 'oak', height: 8, crownRadius: 3 },
    willow: { species: 'willow', height: 7, crownRadius: 2.6, seed: 2 },
    pine: { species: 'pine', height: 9, crownRadius: 2.2, seed: 3 },
  };
  for (const [k, params] of Object.entries(old)) {
    const a = build([{ type: 'tree', params, x: 6, z: 6 }]);
    const b = build([{ type: `${k}Tree`, params: {}, x: 6, z: 6 }]);
    assert.equal(fingerprint(b), fingerprint(a), `${k}Tree with its defaults = the old scene's ${k}`);
    // the generic tree with a kind and the kind's object, same parameters: the same tree
    const c = build([{ type: 'tree', params: { ...params, deadBranches: defaultParams(`${k}Tree`).deadBranches }, x: 6, z: 6 }]);
    assert.equal(fingerprint(c), fingerprint(a));
    assert.equal(a.trees[0].kind, k);
  }
});

test('each kind grows its own structure: wood, foliage, form; the seed makes another tree of the same kind', () => {
  const shape = (type, params = {}) => {
    const w = build([{ type, params, x: 6, z: 6 }], [16, 16, 16]);
    let top = 0;
    let r = 0;
    for (let k = 0; k < w.solidCount; k++) {
      if (w.owner[w.solids[k]] !== w.trees[0].owner) continue; // (not the ground)
      const [x, y, z] = w.coords(w.solids[k]);
      top = Math.max(top, (y + 1) * w.h);
      r = Math.max(r, Math.hypot((x + 0.5) * w.h - 8, (z + 0.5) * w.h - 8));
    }
    return { w, top, r };
  };
  const conifers = ['spruceTree', 'firTree'];
  for (const t of conifers) {
    const { w } = shape(t);
    assert.ok(count(w, 'needles') > 300 && count(w, 'pine') > 100, `${t}: needles on resinous wood`);
  }
  const birch = shape('birchTree');
  assert.ok(count(birch.w, 'leaves') > 200 && count(birch.w, 'willow') > 100, 'birch: leaves, soft wood');
  const poplar = shape('poplarTree');
  const maple = shape('mapleTree');
  // a column against a round crown
  assert.ok(poplar.top / poplar.r > 2 * (maple.top / maple.r), `poplar ${poplar.top}/${poplar.r} vs maple ${maple.top}/${maple.r}`);
  assert.ok(poplar.top > 11, 'the poplar is tall');
  const apple = shape('appleTree');
  assert.ok(apple.top < 5.5, 'the apple tree is small');
  const palm = shape('palmTree');
  assert.ok(count(palm.w, 'deadWood') > 30 && count(palm.w, 'leaves') > 100, 'palm: fronds and a skirt of dead ones');
  // the seed: same kind, other branches
  const a = build([{ type: 'mapleTree', params: { seed: 1 }, x: 6, z: 6 }]);
  const b = build([{ type: 'mapleTree', params: { seed: 2 }, x: 6, z: 6 }]);
  assert.notEqual(JSON.stringify(a.trees[0].segs), JSON.stringify(b.trees[0].segs));
  // dead lower branches (age) on any kind
  const young = build([{ type: 'oakTree', params: {}, x: 6, z: 6 }]);
  const old = build([{ type: 'oakTree', params: { deadBranches: 6 }, x: 6, z: 6 }]);
  assert.equal(count(young, 'deadWood'), 0);
  assert.ok(count(old, 'deadWood') > 5, 'an old oak with dead branches');
});

test('Oak, willow and pine in a grass fire is a place of the carrier world now; its old link opens it there', () => {
  assert.equal(SCENARIOS.threeTrees, undefined, 'no longer a scene of its own');
  assert.deepEqual(SCENARIO_ALIASES.threeTrees, { scenario: 'carrier', zone: 'trees' });
  assert.deepEqual(resolveScenario('threeTrees'), { scenario: 'carrier', zone: 'trees' });
  const sc = openScenario('threeTrees');
  assert.equal(sc.startZone, 'trees');
  const z = sc.zones.trees;
  assert.equal(z.group, 'lake', 'a neighbour of the lake house, its garden and its meadow');
  assert.equal(z.timeScale, 4);
  assert.equal(z.weather.windSpeed, 3);
  assert.equal(z.weather.windDir, 0);
  assert.equal(z.weather.humidity, 0.25);
  assert.equal(z.weather.ambient, 30);
  assert.deepEqual(z.objects.map((o) => o.type), ['grass', 'grass', 'oakTree', 'willowTree', 'pineTree']);
  assert.ok(z.objects[1].ignite, 'lit on its upwind edge');
  // beside the meadow, not on top of anything
  const boxes = placeBoxes(sc);
  const me = boxes.find((b) => b.name === 'trees');
  const meadow = boxes.find((b) => b.name === 'meadow');
  assert.ok(me.min[0] >= meadow.max[0] && me.min[0] - meadow.max[0] < 3, 'east of the meadow');
  for (const b of boxes) if (b !== me && !b.schematic) assert.ok(![0, 1, 2].every((k) => me.min[k] < b.max[k] && b.min[k] < me.max[k]), `overlaps ${b.name}`);
  // its trees are the old scene's trees, voxel for voxel
  const old = buildScene({
    world: { size: [22, 11, 12], h: 0.2 },
    objects: [
      { type: 'grass', params: { width: 21.5, depth: 11.5, height: 0.4, density: 0.85, moisture: 0.06 }, x: 11, z: 6 },
      { type: 'grass', params: { width: 1.5, depth: 1.5, height: 0.05, density: 1, moisture: 0.06 }, x: 1.2, z: 6, ignite: true },
      { type: 'tree', params: { species: 'oak', height: 8, crownRadius: 3 }, x: 8, z: 6 },
      { type: 'tree', params: { species: 'willow', height: 7, crownRadius: 2.6, seed: 2 }, x: 13.5, z: 6 },
      { type: 'tree', params: { species: 'pine', height: 9, crownRadius: 2.2, seed: 3 }, x: 18.5, z: 6 },
    ],
  }).world;
  const now = buildScene(zoneScene(sc, 'trees')).world;
  assert.equal(fingerprint(now), fingerprint(old));
});

test('the oak, willow and pine place: the grass fire runs under them, the pine crowns, the willow drops burning branches, the oak holds', { timeout: 30 * 60 * 1000 }, () => {
  const sim = createSimulation(openScenario('threeTrees'));
  const w = sim.world;
  const own = Object.fromEntries(w.trees.map((t) => [t.kind, t.owner]));
  assert.deepEqual(Object.keys(own).sort(), ['oak', 'pine', 'willow']);
  const tally = () => {
    const o = { oak: { leaf: 0, broken: 0 }, willow: { leaf: 0, broken: 0 }, pine: { leaf: 0, broken: 0 } };
    for (let k = 0; k < w.solidCount; k++) {
      const i = w.solids[k];
      const kind = Object.keys(own).find((n) => own[n] === w.owner[i]);
      if (!kind) continue;
      if (w.mat[i] === MAT.needles || w.mat[i] === MAT.leaves) o[kind].leaf++;
      if (w.flags[i] & F_BROKEN) o[kind].broken++;
    }
    return o;
  };
  const t0 = tally();
  while (w.time < 170) sim.step(sim.dt);
  const t1 = tally();
  assert.ok(t1.pine.leaf < t0.pine.leaf * 0.4, `the pine's crown burned: ${t1.pine.leaf} of ${t0.pine.leaf} needles left`);
  assert.ok(t1.willow.broken > 50, `the willow's charred branches snapped: ${t1.willow.broken}`);
  assert.ok(t1.oak.broken < t1.willow.broken / 4, `the oak's limbs mostly hold: ${t1.oak.broken} broken`);
  assert.ok(t1.oak.leaf < t0.oak.leaf * 0.5, 'the oak burned too');
});

test('radiation reaches beyond the blur: a fire warms what stands metres off, and not behind a wall', () => {
  const at = (withWall) => {
    const sim = createSimulation({
      world: { size: [10, 5, 4], h: 0.2 },
      weather: { windSpeed: 0, ambient: 15 },
      noFire: true,
      objects: [
        { type: 'burner', params: { power: 100000, flameRadius: 0.5, flameHeight: 2, nozzleHeight: 0.2 }, x: 1.5, z: 2 },
        ...(withWall ? [{ type: 'wall', params: { length: 3.6, height: 3.5, thickness: 0.4, material: 'concrete' }, x: 3.4, z: 2, rotation: 90 }] : []),
        { type: 'wall', params: { length: 3, height: 3, thickness: 0.2 }, x: 5.5, z: 2, rotation: 90 },
      ],
    });
    const w = sim.world;
    while (w.time < 3) sim.step(sim.dt);
    const target = withWall ? 2 : 1; // (the far wall)
    let E = 0;
    for (let k = 0; k < w.solidCount; k++) {
      const i = w.solids[k];
      if (w.owner[i] !== target) continue;
      const [x, y, z] = w.coords(i);
      E = Math.max(E, w.radField[w.airIdx(x >> 1, y >> 1, z >> 1)]);
    }
    return E;
  };
  const open = at(false);
  const shaded = at(true);
  // 30 % of 100 kW radiated, 0.55 of it out of the flame, 4 m off: some tens of W/m² (the blur alone reaches 1.6 m)
  assert.ok(open > 15 && open < 400, `in the open: ${open.toFixed(0)} W/m²`);
  assert.ok(shaded < open * 0.3, `behind a wall: ${shaded.toFixed(0)} W/m²`);
});

// (the Car fire next to a house: its tree stood upwind of nothing and 2 m from the car's flames,
// and radiation stopped a metre from what radiated, so it never even warmed. Now a car-sized
// fire's radiation dries and heats the near side of a crown; its flames, leaning on the wind
// into the crown, light it)
test('a tree beside a car-sized fire: scorched and dried across the wind, set alight downwind', { timeout: 20 * 60 * 1000 }, () => {
  const run = (windDir) => {
    const sim = createSimulation({
      world: { size: [12, 9, 8], h: 0.2 },
      weather: { windSpeed: 1.5, windDir, ambient: 15, humidity: 0.5 },
      noFire: true,
      objects: [
        { type: 'burner', params: { power: 1.5e6, flameRadius: 0.9, flameHeight: 2.5, nozzleHeight: 0.4 }, x: 3, z: 4 },
        { type: 'oakTree', params: { height: 5, crownRadius: 1.5 }, x: 6.5, z: 4 },
      ],
    });
    const w = sim.world;
    const own = w.trees[0].owner;
    let hot = 0;
    let burning = 0;
    while (w.time < 40) {
      sim.step(sim.dt);
      for (let k = 0; k < w.solidCount; k++) {
        const i = w.solids[k];
        if (w.owner[i] !== own) continue;
        if (w.mat[i] === MAT.leaves) hot = Math.max(hot, w.skin[i]);
        if (w.flags[i] & 8) burning++;
      }
    }
    return { hot, burning };
  };
  const across = run(90);
  assert.ok(across.hot > 60, `across the wind the near leaves heat up: ${across.hot.toFixed(0)} °C`);
  const downwind = run(0);
  assert.ok(downwind.burning > 100, `downwind the crown catches: ${downwind.burning}`);
});
