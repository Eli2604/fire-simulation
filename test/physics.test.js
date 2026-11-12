import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, F_LIQUID, F_BURNING } from '../src/sim/world.js';
import { Simulation } from '../src/sim/simulation.js';
import { MAT, MATERIALS } from '../src/sim/materials.js';
import { defaultWeather } from '../src/sim/weather.js';
import { createSimulation } from '../src/sim/createSimulation.js';

/** Small world with a soil floor. */
function makeWorld(size = [1, 1, 1], h = 0.05, ambient = 20) {
  const w = new World({ size, h, ambient });
  for (let z = 0; z < w.nz; z++) for (let x = 0; x < w.nx; x++) w.setVoxel(w.idx(x, 0, z), MAT.soil, { anchored: true });
  return w;
}
const run = (sim, seconds) => {
  while (sim.world.time < seconds) sim.step(sim.dt);
};

test('material table resolves residues and wick fuels', () => {
  assert.equal(MATERIALS[MAT.wood].residueId, MAT.charcoal);
  assert.equal(MATERIALS[MAT.charcoal].residueId, MAT.ash);
  assert.deepEqual(MATERIALS[MAT.wick].wickIds, [MAT.wax, MAT.beeswax, MAT.pitch]); // (a torch's rags draw pitch)
  for (const m of MATERIALS.slice(1)) {
    assert.ok(m.density > 0 && m.specificHeat > 0 && m.conductivity > 0, `${m.name} has thermal properties`);
  }
});

test('heat conducts along a metal bar, faster in copper than in steel', () => {
  const far = {};
  for (const metal of ['steel', 'copper']) {
    const w = makeWorld([1.2, 0.3, 0.2], 0.02);
    const y = 5;
    const z = 5;
    for (let x = 5; x < 55; x++) w.setVoxel(w.idx(x, y, z), MAT[metal], { anchored: true });
    const sim = new Simulation(w, defaultWeather());
    // hold one end at 600 °C
    const hot = w.idx(5, y, z);
    while (w.time < 120) {
      w.temp[hot] = w.skin[hot] = 600;
      sim.step(sim.dt);
    }
    const t = (x) => w.temp[w.idx(x, y, z)];
    assert.ok(t(6) > t(15) && t(15) > t(30), `${metal}: temperature falls along the bar`);
    far[metal] = t(15);
  }
  assert.ok(far.copper > far.steel + 20, `copper (${far.copper.toFixed(0)}) conducts better than steel (${far.steel.toFixed(0)})`);
});

test('a torch ignites wood, which burns, releases heat and smoke and chars', () => {
  const w = makeWorld([1, 1, 1], 0.05);
  for (let x = 6; x < 14; x++) for (let z = 8; z < 12; z++) for (let y = 1; y < 4; y++) w.setVoxel(w.idx(x, y, z), MAT.wood, { moisture: 0.1 });
  const sim = new Simulation(w, defaultWeather());
  sim.addTorch([0.5, 0.06, 0.5], 6000, 60, 0.1);
  run(sim, 90);
  assert.ok(sim.stats.burning > 0, 'wood is burning');
  assert.ok(sim.stats.hrr > 500, `heat release ${sim.stats.hrr.toFixed(0)} W`);
  assert.ok(sim.stats.smoke > 0, 'smoke is produced');
  let charred = 0;
  for (let k = 0; k < w.solidCount; k++) if (w.char[w.solids[k]] > 0.3) charred++;
  assert.ok(charred > 0, 'surface is charred');
});

test('wet grass does not ignite where dry grass does', () => {
  const result = {};
  for (const moisture of [0.08, 1.2]) {
    const w = makeWorld([2, 1, 1], 0.1);
    for (let x = 0; x < w.nx; x++) for (let z = 0; z < w.nz; z++) w.setVoxel(w.idx(x, 1, z), MAT.grass, { moisture });
    const sim = new Simulation(w, { ...defaultWeather(), windSpeed: 2, humidity: moisture > 0.5 ? 0.95 : 0.3 });
    sim.ignite([0.15, 0.15, 0.5], 0.2);
    run(sim, 90);
    let ash = 0;
    for (let k = 0; k < w.solidCount; k++) if (w.mat[w.solids[k]] === MAT.ash) ash++;
    result[moisture] = ash;
  }
  assert.ok(result[0.08] > 3 * Math.max(1, result[1.2]), `dry burnt ${result[0.08]} voxels, wet ${result[1.2]}`);
});

test('wax melts, flows down and solidifies again', () => {
  const w = makeWorld([0.4, 0.4, 0.4], 0.02);
  const i = w.idx(10, 10, 10);
  w.setVoxel(i, MAT.wax, { temp: 90 });
  w.flags[i] |= 0; // detached from anything: will fall as a liquid
  const sim = new Simulation(w, defaultWeather());
  sim.step(sim.dt);
  assert.ok(w.melt[w.solids.find((j) => w.mat[j] === MAT.wax)] > 0.5 || sim.stats.liquid > 0, 'wax is molten');
  run(sim, 30);
  let wax = -1;
  for (let k = 0; k < w.solidCount; k++) if (w.mat[w.solids[k]] === MAT.wax) wax = w.solids[k];
  const [, y] = w.coords(wax);
  assert.equal(y, 1, 'molten wax ran down to the ground');
  run(sim, 900);
  assert.ok(!(w.flags[wax] & F_LIQUID) || w.temp[wax] < 60, 'wax solidified after cooling');
});

test('aluminium melts in a hot flame, steel does not', () => {
  const w = makeWorld([0.4, 0.4, 0.4], 0.02);
  const al = w.idx(8, 1, 10);
  const st = w.idx(12, 1, 10);
  w.setVoxel(al, MAT.aluminium, { temp: 700 });
  w.setVoxel(st, MAT.steel, { temp: 700 });
  const sim = new Simulation(w, defaultWeather());
  sim.step(sim.dt);
  assert.ok(w.melt[al] > 0, 'aluminium (660 °C) starts melting');
  assert.equal(w.melt[st], 0, 'steel (1450 °C) stays solid');
});

test('unsupported structure falls when its support burns away', () => {
  const w = makeWorld([1, 1, 1], 0.05);
  // a beam on a post; remove the post and the beam must fall
  for (let y = 1; y < 8; y++) w.setVoxel(w.idx(10, y, 10), MAT.wood);
  for (let x = 6; x < 15; x++) w.setVoxel(w.idx(x, 8, 10), MAT.wood);
  const sim = new Simulation(w, defaultWeather());
  sim.step(sim.dt);
  w.clearVoxel(w.idx(10, 4, 10));
  run(sim, 5);
  let maxY = 0;
  for (let k = 0; k < w.solidCount; k++) {
    const i = w.solids[k];
    if (w.mat[i] === MAT.wood) maxY = Math.max(maxY, w.coords(i)[1]);
  }
  assert.ok(maxY < 8, `beam fell (highest wood voxel now at y=${maxY})`);
});

test('rain wets exposed fuel; hot surfaces in rain make steam', () => {
  const w = makeWorld([0.6, 0.6, 0.6], 0.05);
  const g = w.idx(5, 1, 5);
  const s = w.idx(8, 1, 5);
  w.setVoxel(g, MAT.grass, { moisture: 0.1 });
  w.setVoxel(s, MAT.steel, { temp: 400 });
  const sim = new Simulation(w, { ...defaultWeather(), rain: 30 });
  run(sim, 60);
  assert.ok(w.moist[g] > 0.1, `grass got wetter (${w.moist[g].toFixed(2)})`);
  assert.ok(sim.stats.steam > 0, 'steam was produced');
});

test('burning rubber makes darker smoke than burning grass', () => {
  const darkness = {};
  for (const mat of ['rubber', 'grass']) {
    const w = makeWorld([0.6, 0.6, 0.6], 0.05);
    for (let x = 4; x < 8; x++) for (let z = 4; z < 8; z++) w.setVoxel(w.idx(x, 1, z), MAT[mat], { moisture: 0.05 });
    const sim = new Simulation(w, defaultWeather());
    sim.ignite([0.3, 0.08, 0.3], 0.2);
    sim.addTorch([0.3, 0.06, 0.3], 3000, 20, 0.08);
    run(sim, 15);
    let s = 0;
    let r = 0;
    for (let a = 0; a < w.NA; a++) {
      s += w.smoke[a];
      r += w.smokeR[a];
    }
    assert.ok(s > 0, `${mat} smokes`);
    darkness[mat] = 1 - r / s;
  }
  assert.ok(darkness.rubber > darkness.grass, `rubber ${darkness.rubber.toFixed(2)} vs grass ${darkness.grass.toFixed(2)}`);
});

test('a candle burns steadily at a realistic power', () => {
  const sim = createSimulation({
    world: { size: [0.16, 0.2, 0.16], h: 0.008 },
    weather: { ambient: 20 },
    objects: [{ type: 'candle', params: { height: 0.08, radius: 0.022 }, x: 0.08, z: 0.08, ignite: true }],
  });
  run(sim, 120);
  assert.ok(sim.stats.hrr > 10 && sim.stats.hrr < 120, `candle flame ${sim.stats.hrr.toFixed(0)} W`);
  let burningWick = 0;
  for (let k = 0; k < sim.world.solidCount; k++) {
    const i = sim.world.solids[k];
    if (sim.world.mat[i] === MAT.wick && sim.world.flags[i] & F_BURNING) burningWick++;
  }
  assert.ok(burningWick > 0, 'the wick is lit');
});
