// Water is conserved (sim/water.js): a water voxel wets what it touches only as far as that can
// take it up (its material's maxMoisture, what it holds already), taken out of the water voxel;
// no water is made; puddles form only in a free cell on top of a solid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../src/sim/createSimulation.js';
import { MAT, MATERIALS } from '../src/sim/materials.js';

/** A tub (walls and floor of `wall`) standing on a concrete floor, full of water. */
function tub(wall, { floor = wall } = {}) {
  const sim = createSimulation({
    world: { size: [1.6, 1.0, 1.6], h: 0.1, ground: 'concrete' },
    exposure: 'indoor',
    objects: [],
    weather: { windSpeed: 0, rainRate: 0 },
  });
  const w = sim.world;
  const water = [];
  // the tub: 6 × 6 cells outside, 4 cells high, from y = 1 (on the floor)
  for (let x = 4; x < 10; x++)
    for (let z = 4; z < 10; z++)
      for (let y = 1; y <= 4; y++) {
        const i = w.idx(x, y, z);
        const edge = x === 4 || x === 9 || z === 4 || z === 9;
        if (y === 1) w.setVoxel(i, MAT[floor], { temp: w.ambient, variation: 0 });
        else if (edge) w.setVoxel(i, MAT[wall], { temp: w.ambient, variation: 0 });
        else if (y <= 3) {
          w.setVoxel(i, MAT.water, { temp: w.ambient, variation: 0 });
          water.push(i);
        }
      }
  w.rebuildLists();
  return { sim, w };
}

/** kg of water: in the water voxels, in puddles, taken up by the solids (over what they held at the start) and on its way to them (waterIn: taken up next step). */
function waterBudget(w, moist0) {
  const V = w.h ** 3;
  let voxels = 0;
  let n = 0;
  let held = 0;
  let maxHeld = 0;
  for (let i = 0; i < w.N; i++) {
    const m = w.mat[i];
    if (!m) continue;
    if (m === MAT.water) {
      voxels += w.fuel[i] * 1000 * V;
      n++;
      continue;
    }
    const M = MATERIALS[m];
    const massFrac = M.combustible ? M.residue + (1 - M.residue) * w.fuel[i] : 1;
    const dry = M.density * w.dens[i] * V * Math.max(0.05, massFrac);
    held += (w.moist[i] - moist0[i]) * dry;
    maxHeld += Math.max(0, M.maxMoisture - moist0[i]) * dry;
  }
  let puddles = 0;
  for (const r of w.runoff) puddles += r;
  for (const i of w.waterList) held += w.waterIn[i];
  return { voxels, n, held, puddles, total: voxels + held + puddles, maxHeld };
}

function run(sim, seconds, dt = 0.5) {
  for (let t = 0; t < seconds - 1e-9; t += dt) sim.step(dt);
}

test('a steel tub of water conserves its water over minutes: no water made where it touches the steel, no flood round it', () => {
  const { sim, w } = tub('steel', { floor: 'steel' });
  const moist0 = Float32Array.from(w.moist);
  const b0 = waterBudget(w, moist0);
  run(sim, 300);
  const b1 = waterBudget(w, moist0);
  assert.ok(Math.abs(b1.total - b0.total) < 1e-3 * b0.total, `water ${b0.total.toFixed(3)} -> ${b1.total.toFixed(3)} kg`);
  assert.ok(b1.puddles < 0.01, `no run-off: ${b1.puddles.toFixed(4)} kg`);
  assert.ok(b1.n <= b0.n, `no new water voxels: ${b0.n} -> ${b1.n}`);
  // the steel only takes a wet film (maxMoisture 0.001 kg/kg: ~8 g on a 10 cm voxel)
  assert.ok(b1.held <= b1.maxHeld + 1e-9 && b0.voxels - b1.voxels <= b1.maxHeld + 1e-6, `a film on the steel: ${(b1.held * 1000).toFixed(1)} g`);
  // nothing outside the tub
  let outside = 0;
  for (let k = 0; k < w.solidCount; k++) {
    const i = w.solids[k];
    if (w.mat[i] !== MAT.water) continue;
    const [x, , z] = w.coords(i);
    if (x <= 4 || x >= 9 || z <= 4 || z >= 9) outside++;
  }
  assert.equal(outside, 0, 'no water outside the tub');
});

test('glass and stone tubs: no water made either', () => {
  for (const wall of ['glass', 'stone']) {
    const { sim, w } = tub(wall);
    const moist0 = Float32Array.from(w.moist);
    const b0 = waterBudget(w, moist0);
    run(sim, 120);
    const b1 = waterBudget(w, moist0);
    assert.ok(Math.abs(b1.total - b0.total) < 1e-3 * b0.total, `${wall}: water ${b0.total.toFixed(3)} -> ${b1.total.toFixed(3)} kg`);
    assert.ok(b1.held <= b1.maxHeld + 1e-9, `${wall}: held ${b1.held.toFixed(3)} of at most ${b1.maxHeld.toFixed(3)} kg`);
  }
});

test('a wooden tub on soil: the wood and the soil take up a bounded amount, taken out of the water', () => {
  const { sim, w } = tub('wood', { floor: 'soil' });
  const moist0 = Float32Array.from(w.moist);
  const b0 = waterBudget(w, moist0);
  run(sim, 300);
  const b1 = waterBudget(w, moist0);
  assert.ok(b1.held > 0.05, `the wood and soil soak some up: ${b1.held.toFixed(3)} kg`);
  assert.ok(b1.held <= b1.maxHeld + 1e-6, `no more than they can hold: ${b1.held.toFixed(3)} of ${b1.maxHeld.toFixed(3)} kg`);
  // what they took came out of the water (the wood, a dead fuel, also slowly dries into the air)
  assert.ok(b1.total <= b0.total + 1e-6, `no water made: ${b0.total.toFixed(3)} -> ${b1.total.toFixed(3)} kg`);
  assert.ok(b0.total - b1.total < 0.02 * b0.total, `and not much lost: ${b0.total.toFixed(3)} -> ${b1.total.toFixed(3)} kg`);
  for (let i = 0; i < w.N; i++) {
    const m = w.mat[i];
    if (m && m !== MAT.water) assert.ok(w.moist[i] <= MATERIALS[m].maxMoisture + 1e-6, `${MATERIALS[m].name} over its max moisture: ${w.moist[i]}`);
  }
});

test('run-off makes a water voxel only in a free cell on top of its floor, never inside or on top of other solids', () => {
  const { sim, w } = tub('steel');
  const V = w.h ** 3;
  // a voxel's worth of run-off on the tub's rim (y = 4, free above it)
  const c = 4 + w.nx * 6;
  (w.runoffY ??= new Int16Array(w.nx * w.nz))[c] = 4;
  w.runoff[c] = 1000 * V * 3;
  const moist0 = Float32Array.from(w.moist);
  const b0 = waterBudget(w, moist0);
  sim.step(0.1);
  const above = w.idx(4, 5, 6);
  assert.equal(w.mat[above], MAT.water, 'on the rim');
  // a column with no room on top or beside (a solid block): it waits, nothing is lost
  const blk = 12 + w.nx * 12;
  for (let y = 1; y < w.ny; y++) w.setVoxel(w.idx(12, y, 12), MAT.steel, { temp: w.ambient });
  for (const [x, z] of [[11, 12], [13, 12], [12, 11], [12, 13]]) for (let y = 1; y < w.ny; y++) w.setVoxel(w.idx(x, y, z), MAT.steel, { temp: w.ambient });
  w.rebuildLists();
  w.runoffY[blk] = 3;
  w.runoff[blk] = 1000 * V * 1.5;
  sim.step(0.1);
  assert.ok(Math.abs(w.runoff[blk] - 1000 * V * 1.5) < 1e-3, `it waits: ${w.runoff[blk]}`);
  const b1 = waterBudget(w, moist0);
  assert.ok(Math.abs(b1.total - (b0.total + 1000 * V * 1.5)) < 0.01, `conserved: ${b0.total.toFixed(3)} + 1.5 -> ${b1.total.toFixed(3)} kg`);
});
