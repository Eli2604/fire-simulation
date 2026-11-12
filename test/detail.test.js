import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, cloneScene } from '../src/scenarios.js';
import { createSimulation } from '../src/sim/createSimulation.js';
import { DetailPatches, PATCH } from '../src/sim/patches.js';
import { SnowField, initSnow, snowShare, stepSnow } from '../src/sim/snow.js';
import { deriveWeather, SEASONS } from '../src/sim/weather.js';


const catacombs = () => {
  const sc = cloneScene(SCENARIOS.carrier);
  sc.zone = 'catacombs';
  return createSimulation(sc);
};

test('candles get detail patches; only the ones near the camera run, burning steadily', () => {
  const sim = catacombs();
  const P = sim.patches;
  assert.ok(P instanceof DetailPatches);
  // the six altar and stand candles and the candelabras' eleven (and the wall torches)
  const candles = P.list.filter((p) => p.type === 'candle');
  assert.equal(candles.length, 17);
  const thin = candles.filter((p) => p.h < PATCH.h);
  assert.equal(thin.length, 11, 'the candelabra candles are thin: finer voxels');
  // far away: none awake
  P.update([2, 1.7, 2], 50);
  assert.equal(P.list.filter((p) => p.awake).length, 0);
  // at the altar: the nearest wake, at most maxActive
  const eye = [30, 1.9, 22.3];
  for (let t = 0; t < 16; t += 0.5) {
    sim.advance(0.5, 1e9);
    P.update(eye, 1e9);
  }
  const awake = candles.filter((p) => p.awake);
  assert.ok(awake.length > 0 && awake.length <= PATCH.maxActive);
  for (const p of awake) {
    assert.ok(p.live, 'warmed up and shown');
    assert.ok(p.ht.on && p.ht.power > 20 && p.ht.power < 200, `burning like a candle: ${p.ht.power.toFixed(0)} W`);
    assert.ok(p.ht.flamePos, 'its flame stands on its wick');
  }
  // walking away: they sleep, the drawn candle as tall as the patch's
  P.update([2, 1.7, 2], 50);
  for (const p of awake) {
    assert.ok(!p.awake && !p.ht.patchLive);
    assert.ok(p.ht.candle.height <= p.ht.detail.params.height + 1e-9);
  }
});

test('a blast nearby blows the candles out', async () => {
  const sim = catacombs();
  const P = sim.patches;
  const { explode } = await import('../src/sim/explosions.js');
  explode(sim, [30, 1.7, 22.2], 3e5);
  P.update(null, 10);
  const near = P.list.filter((p) => p.type === 'candle' && Math.hypot(p.ht.pos[0] - 30, p.ht.pos[2] - 22.2) < 2);
  assert.ok(near.length && near.every((p) => !p.ht.on));
});

test('a coarse candle is no flame filling its air cell (it burns no one walking past)', () => {
  const sim = catacombs();
  sim.advance(3, 1e9);
  const w = sim.world;
  const ht = w.heaters.find((h) => h.kind === 'candle');
  const a = sim.airCellAt(ht.pos[0], ht.pos[1] + 0.05, ht.pos[2]);
  assert.ok(w.flame[a] < 0.3);
});

test('precipitation is snow at freezing, rain above +3 °C', () => {
  assert.equal(snowShare(-5), 1);
  assert.equal(snowShare(5), 0);
  const D = deriveWeather({ ambient: -2, humidity: 0.8, windSpeed: 0, windDir: 0, rain: 3.6, fog: 0 });
  assert.equal(D.rainRate, 0);
  assert.ok(Math.abs(D.snowRate - 0.001) < 1e-9);
  assert.ok(SEASONS.winter.ambient < 0 && SEASONS.winter.snowCover > 0);
});

/** A small outdoor world with grass on soil, snow lying on it. */
function snowyLawn(depth = 0.2) {
  const sc = { world: { size: [6, 3, 6], h: 0.1, ground: 'soil' }, weather: { ambient: -3, humidity: 0.85, snowCover: depth }, objects: [{ type: 'grass', params: { width: 5, depth: 5, height: 0.1, density: 0.8 }, x: 3, z: 3 }], noFire: true };
  return createSimulation(sc);
}

test('snow lies where it is open to the sky, falls, settles and is pressed down by feet', () => {
  const sim = snowyLawn(0.2);
  const S = sim.world.snow;
  assert.ok(S instanceof SnowField);
  assert.ok(Math.abs(S.depthAt(3, 3) - 0.2) < 1e-6);
  // snowing: it grows (10 mm of water ~ 10 cm of fresh snow)
  const D = { snowRate: 10 / 3600 };
  const before = S.depthAt(3, 3);
  for (let t = 0; t < 3600; t += 0.5) stepSnow(sim, 0.5, D);
  assert.ok(S.depthAt(3, 3) > before + 0.05, 'an hour of 10 mm/h snow adds several cm');
  // a person walking packs it: the trail is thinner and denser
  const j = S.cell(3, 3);
  const d0 = S.depth[j];
  S.press(3, S.base[j], 3, 0.2, 13000);
  assert.ok(S.depth[j] < d0 * 0.75 && S.rho[j] > 350);
});

test('a fire melts the snow round it; grass under snow does not catch', () => {
  const sim = snowyLawn(0.15);
  const w = sim.world;
  const S = w.snow;
  for (let t = 0; t < 2; t += 0.5) sim.advance(0.5, 1e9);
  // the grass under the snow is soaked
  const j = S.cell(3, 3);
  assert.ok(w.moist[S.top[j]] > 1, 'soaked under the snow');
  // a 30 kW burner standing on it melts it (the hot air over it, the flame's radiation)
  sim.addTorch([3, S.base[j] + 0.3, 3], 30000, 120, 0.3);
  sim.advance(90, 1e9);
  const near = S.depthAt(3, 3);
  const far = S.depthAt(0.5, 0.5);
  assert.ok(near < 0.15 - 0.03, `melting where the fire is (${(near * 100).toFixed(1)} cm left)`);
  assert.ok(far > near + 0.03, "it melts by the fire, not away from it");
});

test('no snow indoors or underground', () => {
  const sc = cloneScene(SCENARIOS.carrier);
  sc.zone = 'catacombs';
  sc.weather = { ...(sc.weather ?? {}), snowCover: 0.3 };
  assert.equal(createSimulation(sc).world.snow ?? null, null);
  sc.zone = 'below';
  assert.equal(createSimulation(sc).world.snow ?? null, null);
  assert.equal(initSnow(createSimulation(sc).world, 0.2), null);
});

test("the voxel size is a scene setting: a factor on each scene's (zone's) own", () => {
  const sc = cloneScene(SCENARIOS.carrier);
  sc.zone = 'deck';
  sc.voxelScale = 1.5;
  const sim = createSimulation(sc);
  assert.ok(Math.abs(sim.world.h - 0.75) < 1e-9); // (the deck's own 0.5 m × 1.5)
  sim.advance(1, 1e9);
});

test('the nearest candle goes finer within reach of the hand, and carries its wax and flame over', () => {
  const sim = catacombs();
  const P = sim.patches;
  const c = P.list.find((p) => p.type === 'candle' && !p.thin);
  const at = (d) => [c.ht.pos[0], c.ht.pos[1] + 0.4, c.ht.pos[2] - d];
  const run = (eye, T) => {
    for (let t = 0; t < T; t += 0.25) {
      sim.advance(0.25, 1e9);
      P.update(eye, 1e9);
    }
  };
  run(at(2.5), 16);
  assert.equal(c.tier, 0);
  const wax = c.waxHeight();
  run(at(0.8), 6);
  assert.equal(c.tier, 1);
  assert.ok(Math.abs(c.h - c.baseH * PATCH.fineScale) < 1e-9);
  assert.ok(c.ht.on && c.ht.power > 30 && c.ht.power < 150, `still a candle flame: ${c.ht.power.toFixed(0)} W`);
  assert.ok(Math.abs(c.waxHeight() - wax) <= 0.011, 'as tall as it was');
  run(at(2.5), 1);
  assert.equal(c.tier, 0);
  assert.ok(c.ht.on);
});

test('a wall torch gets its head in detail: pitch and rags, burning like a torch', () => {
  const sim = catacombs();
  const P = sim.patches;
  const t = P.list.find((p) => p.type === 'torch');
  assert.ok(t, 'torches have patches');
  const eye = [t.ht.pos[0], t.ht.pos[1], t.ht.pos[2]];
  for (let s = 0; s < 20; s += 0.5) {
    sim.advance(0.5, 1e9);
    P.update(eye, 1e9);
  }
  assert.ok(t.live && t.ht.patchLive);
  assert.ok(t.ht.on && t.ht.power > 500 && t.ht.power < 4000, `${t.ht.power.toFixed(0)} W`);
  assert.ok(Math.hypot(t.ht.flamePos[0] - t.ht.pos[0], t.ht.flamePos[2] - t.ht.pos[2]) < 0.15, 'its flame on its head');
  // further off it sleeps, the coarse torch burning on
  P.update([eye[0] + 6, eye[1], eye[2]], 10);
  assert.ok(!t.awake && t.ht.on && t.ht.power === 1500);
});

test('a burning campfire gets a patch started from its coarse voxels; an unlit pile none', () => {
  const sc = cloneScene(SCENARIOS.carrier);
  sc.zone = 'islet';
  const sim = createSimulation(sc);
  const P = sim.patches;
  const f = P.list.find((p) => p.type === 'campfire');
  assert.ok(f);
  for (let s = 0; s < 6; s += 0.5) sim.advance(0.5, 1e9);
  const eye = [f.ht.pos[0] + 3, f.ht.pos[1] + 1.5, f.ht.pos[2]];
  for (let s = 0; s < 8; s += 0.5) {
    sim.advance(0.5, 1e9);
    P.update(eye, 1e9);
  }
  assert.ok(f.live, 'shown');
  assert.ok(f.sim.stats.hrr > 2000, `burning in detail: ${f.sim.stats.hrr.toFixed(0)} W`);
  const w = sim.world;
  assert.ok(f.coarseVoxels().every((i) => w.flags[i] & 64), 'its coarse voxels not drawn');
  P.update([eye[0] + 30, eye[1], eye[2]], 10);
  assert.ok(!f.awake && f.coarseVoxels().every((i) => !(w.flags[i] & 64)), 'drawn again');
  // the island's woodpile by the house is not lit: no patch runs for it
  const sc2 = cloneScene(SCENARIOS.carrier);
  sc2.zone = 'island';
  const s2 = createSimulation(sc2);
  const piles = s2.patches.list.filter((p) => p.type === 'campfire');
  assert.equal(piles.length, 2);
  s2.advance(2, 1e9);
  const unlit = piles.find((p) => p.ht.detail.params.arrangement === 'stack');
  unlit.checked = -Infinity;
  assert.ok(!unlit.wanted());
});

test('the sun melts the snow in a thaw and wets what is under it; not in a frost', () => {
  const run = (weather) => {
    const sc = { world: { size: [6, 3, 6], h: 0.1, ground: 'soil' }, weather: { humidity: 0.7, snowCover: 0.1, ...weather }, objects: [], noFire: true };
    const sim = createSimulation(sc);
    const S = sim.world.snow;
    const j = S.cell(3, 3);
    const m0 = sim.world.moist[S.top[j]];
    const D = deriveWeather({ windSpeed: 0, windDir: 0, rain: 0, fog: 0, ...sim.weather });
    for (let t = 0; t < 3600; t += 0.5) stepSnow(sim, 0.5, D);
    // (the melt water arriving at the ground: taken in at the simulation's next step)
    return { d: S.depth[j], kg: S.depth[j] * S.rho[j], wet: sim.world.moist[S.top[j]] - m0 + sim.world.waterIn[S.top[j]] };
  };
  const thaw = run({ ambient: 5, sunshine: 1, season: 'spring' });
  assert.ok(thaw.d < 0.1 - 0.01, `an hour of sun at +5 °C: ${(thaw.d * 100).toFixed(1)} cm left of 10`);
  assert.ok(thaw.wet > 0, 'the melt water soaks the ground');
  const frost = run({ ambient: -4, sunshine: 1, season: 'winter' });
  assert.ok(frost.kg > 0.1 * 180 - 1e-3, 'a weak winter sun in a frost melts nothing (it only settles)');
  const dull = run({ ambient: 5, sunshine: 0, season: 'spring' });
  assert.ok(dull.d > thaw.d + 0.003, 'overcast, it melts more slowly');
});

test('lava in a pond boils it and sets; a pond on wet ground keeps its water', async () => {
  const { quenchInWater } = await import('../src/sim/volcano.js');
  const { MAT } = await import('../src/sim/materials.js');
  const pond = (lava) => {
    const sim = createSimulation({ world: { size: [1, 1, 1], h: 0.1, ground: 'soil' }, weather: { ambient: 15 }, objects: [], noFire: true });
    const w = sim.world;
    for (let z = 3; z < 7; z++) for (let x = 3; x < 7; x++) for (let y = 1; y < 3; y++) w.setVoxel(w.idx(x, y, z), MAT.water);
    if (lava) w.setVoxel(w.idx(2, 1, 5), MAT.basalt, { temp: 1200 });
    w.rebuildLists();
    return sim;
  };
  const count = (w) => {
    let n = 0;
    for (let i = 0; i < w.N; i++) if (w.mat[i] === MAT.water) n++;
    return n;
  };
  // left alone, it keeps its water (its bed soaks up only what it can hold; it may spread)
  const a = pond(false);
  for (let t = 0; t < 30; t += 0.5) a.step(0.5);
  assert.equal(count(a.world), 32);
  // lava against it: the water boils off as steam, the rock sets
  const b = pond(true);
  const w = b.world;
  const lava = w.idx(2, 1, 5);
  const v = { crater: [0, 0, 0] };
  for (let t = 0; t < 60; t += 0.5) {
    w.temp[lava] = Math.max(w.temp[lava], 1150); // lava still coming
    quenchInWater(b, v, 0.5);
  }
  const steam = w.steam.reduce((s, x) => s + x, 0);
  assert.ok(w.temp[w.idx(3, 1, 5)] >= 99, 'the water it touches boils');
  assert.ok(steam > 0.2, `it goes up as steam: ${steam.toFixed(2)} kg`);
  for (let t = 0; t < 120; t += 0.5) quenchInWater(b, v, 0.5);
  // a dark crust against the water at once; the lava set solid again (below its melting point)
  const { MATERIALS } = await import('../src/sim/materials.js');
  assert.ok(w.skin[lava] < 400, `crust: ${w.skin[lava].toFixed(0)} °C`);
  assert.ok(w.temp[lava] < MATERIALS[MAT.basalt].meltingPoint, `set: ${w.temp[lava].toFixed(0)} °C`);
});

test('a grenade shreds a tree\'s leaves and snaps its branches; against the trunk it fells it', async () => {
  const { explode } = await import('../src/sim/explosions.js');
  const { MATERIALS } = await import('../src/sim/materials.js');
  const oak = () => createSimulation({ world: { size: [12, 9, 12], h: 0.1, ground: 'soil' }, weather: { ambient: 15 }, objects: [{ type: 'tree', params: { species: 'oak', height: 6, crownRadius: 2.4 }, x: 6, z: 6 }], noFire: true });
  const count = (sim, test) => {
    const w = sim.world;
    let n = 0;
    for (let k = 0; k < w.solidCount; k++) if (test(w.solids[k], w)) n++;
    return n;
  };
  const leaves = (i, w) => MATERIALS[w.mat[i]].name === 'leaves';
  const high = (i, w) => w.owner[i] === w.trees[0].owner && w.coords(i)[1] * w.h > 3 && MATERIALS[w.mat[i]].name !== 'leaves';
  // in the crown: leaves shredded and blown off, branches snapped, they fall
  const a = oak();
  const l0 = count(a, leaves);
  const b0 = count(a, high);
  explode(a, [7.5, 3.5, 6], 3e5);
  a.advance(6, 1e9);
  assert.ok(count(a, leaves) < l0 * 0.8, 'leaves stripped');
  assert.ok(count(a, high) < b0 * 0.95, 'branches snapped and fallen');
  // against the trunk, one on each side: cut through, the tree comes down as one, lying along the
  // ground (drawn as the tree lying there: render/trees.js follows its voxels)
  const c = oak();
  explode(c, [6.4, 0.5, 6], 3e5);
  explode(c, [5.6, 0.5, 6], 3e5);
  const t = c.world.trees[0];
  assert.ok(t.fall, 'felled');
  c.advance(6, 1e9);
  const above = (m) => (i, w) => w.owner[i] === t.owner && w.coords(i)[1] * w.h > m;
  assert.equal(count(c, above(4)), 0, 'nothing of it stands up any more');
  assert.ok(count(c, (i, w) => w.owner[i] === t.owner && MATERIALS[w.mat[i]].name !== 'leaves') > 300, 'its wood lies there');
});

test('lightning in a storm strikes what stands highest, sets it alight, splits a tree; none indoors', async () => {
  const { strike } = await import('../src/sim/lightning.js');
  const { F_BURNING } = await import('../src/sim/world.js');
  const sim = createSimulation({ world: { size: [12, 9, 12], h: 0.2, ground: 'soil' }, weather: { ambient: 15, humidity: 0.5 }, objects: [{ type: 'tree', params: { species: 'pine', height: 7, crownRadius: 1.8 }, x: 6, z: 6 }], noFire: true });
  const w = sim.world;
  const p = strike(sim, [4, 6]);
  assert.ok(p && Math.hypot(p[0] - 6, p[2] - 6) < 2.5 && p[1] > 5, `it went to the tree's top (${p.map((v) => v.toFixed(1))})`);
  assert.equal(w.trees[0].struck, 1);
  sim.advance(3, 1e9);
  let burning = 0;
  for (let k = 0; k < w.solidCount; k++) if (w.flags[w.solids[k]] & F_BURNING) burning++;
  assert.ok(burning > 0, 'set alight');
  // a storm: strikes come at the rate set
  sim.weather.lightning = 30;
  const n0 = w.events.filter((e) => e.type === 'lightning').length;
  sim.advance(20, 1e9);
  assert.ok(w.events.filter((e) => e.type === 'lightning').length - n0 >= 4, 'strikes in the storm');
  // under cover: none
  const sc = cloneScene(SCENARIOS.carrier);
  sc.zone = 'catacombs';
  const under = createSimulation(sc);
  under.weather.lightning = 60;
  under.advance(5, 1e9);
  assert.equal(under.world.events.filter((e) => e.type === 'lightning').length, 0);
});
