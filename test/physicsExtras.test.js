// The rigid-body engine in the simulation, further (physics/simPhysics.js): a burst gas cylinder's
// shell as rigid fragments (sim/vessels.js), the dragon going limp as a ragdoll (physics/
// dragonRagdoll.js, ai/dragon.js), a chunk's fire burning on in flight (physics/chunkFire.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../src/sim/createSimulation.js';
import { defaultWeather } from '../src/sim/weather.js';

const LONG = { timeout: 5 * 60 * 1000 };
const len = (v) => Math.hypot(v[0], v[1], v[2]);

/** A gas cylinder on a soil floor; its wall made to give way at once (900 °C dry wall, warm liquid). */
function cylinderAboutToBurst(rigidBodies, h = 0.1, size = 8) {
  const sim = createSimulation({
    world: { size: [size, 5, size], h, ground: 'soil' },
    weather: { ...defaultWeather(), ambient: 15, windSpeed: 0 },
    objects: [{ type: 'gasCylinder', params: { reliefValve: 'blocked' }, x: size / 2, z: size / 2 }],
    noFire: true,
    rigidBodies,
  });
  sim.step(sim.dt);
  const v = sim.world.vessels[0];
  assert.equal(v.state, 'sealed');
  v.Tv = 900; // (the dry wall glowing: ~2 % of its strength)
  v.Tl = 55;
  return { sim, v };
}

test('BLEVE with rigid bodies: the shell flies as a few steel pieces that land with impacts', LONG, () => {
  const { sim, v } = cylinderAboutToBurst(true, 0.4, 40);
  const w = sim.world;
  for (let k = 0; k < 5 && v.state !== 'ruptured'; k++) sim.step(sim.dt);
  assert.equal(v.state, 'ruptured', v.why);
  const R = sim.rigid;
  const F = v.fragmentBodies;
  assert.ok(F && F.length >= 4 && F.length <= 6, `${F?.length} pieces: two ends and the side in strips`);
  assert.equal(w.rigidFragments.length, F.length, 'listed for drawing');
  const frags = F.map((b) => b.userData.fragment);
  const mass = frags.reduce((s, f) => s + f.mass, 0);
  const mShell = 7850 * v.wall * (2 * Math.PI * v.radius * v.height + 2 * Math.PI * v.radius ** 2);
  assert.ok(Math.abs(mass - mShell) < 0.25 * mShell, `the cylinder's steel: ${mass.toFixed(1)} kg of ${mShell.toFixed(1)}`);
  const valve = frags.find((f) => f.name === 'valve end');
  assert.ok(valve && valve.thrust && valve.body.vel[1] > 10, `the valve end rockets up (${valve?.body.vel[1].toFixed(1)} m/s)`);
  assert.ok(valve.temp > 500 && frags.every((f) => f.temp >= 50), `the pieces are as hot as the wall was (the dry top ${valve.temp.toFixed(0)} °C)`);
  assert.ok(!w.debris.some((d) => w.mat && d.mat === 0), 'no shell voxels thrown the old way');
  let peak = 0;
  for (let t = 0; t < 25; t += sim.dt) {
    sim.step(sim.dt);
    peak = Math.max(peak, valve.body.pos[1]);
  }
  assert.ok(peak > 4, `the valve end flew high (${peak.toFixed(1)} m)`);
  const imp = w.events.filter((e) => e.type === 'impact' && e.kind === 'rigid' && e.materials.includes('steel'));
  assert.ok(imp.length >= 2, `the pieces were heard landing (${imp.length})`);
  const still = R.fragments.filter((f) => f.body.sleeping || len(f.body.vel) < 0.2);
  assert.ok(still.length >= Math.min(3, R.fragments.length) && R.fragments.length >= 2, `they come to rest (${still.length} of ${R.fragments.length} still in the scene)`);
  for (const f of still) assert.ok(f.body.pos[1] < 1.2, `${f.name} lies on the ground (${f.body.pos[1].toFixed(2)} m)`);
  assert.ok(Math.min(...R.fragments.map((f) => f.temp)) < Math.max(...frags.map((f) => f.temp)), 'and cool');
});

test('BLEVE without rigid bodies: the shell voxels fly the old way', LONG, () => {
  const { sim, v } = cylinderAboutToBurst(false);
  for (let k = 0; k < 5 && v.state !== 'ruptured'; k++) sim.step(sim.dt);
  assert.equal(v.state, 'ruptured', v.why);
  assert.equal(sim.rigid, undefined);
  assert.equal(v.fragmentBodies, undefined);
  assert.ok(sim.world.debris.length > 0, 'flying voxels');
});

test('a fragment holes a thin board, but not a thick wall; a hot one lights what it hits', LONG, async () => {
  const { MAT } = await import('../src/sim/materials.js');
  const sim = createSimulation({ world: { size: [6, 4, 6], h: 0.1, ground: 'soil' }, weather: { ...defaultWeather(), windSpeed: 0 }, noFire: true, rigidBodies: true });
  const w = sim.world;
  // a thin pine board (1 cm: a tenth of a voxel) and a stone wall
  for (let y = 1; y < 25; y++)
    for (let z = 20; z < 40; z++) {
      w.setVoxel(w.idx(30, y, z), MAT.pine, { anchored: true, density: 0.1 });
      w.setVoxel(w.idx(45, y, z), MAT.stone, { anchored: true });
    }
  const n0 = (x) => {
    let n = 0;
    for (let y = 1; y < 25; y++) for (let z = 20; z < 40; z++) n += w.mat[w.idx(x, y, z)] ? 1 : 0;
    return n;
  };
  const before = [n0(30), n0(45)];
  sim.rigid.launchFragment({ p: [1.5, 1.2, 3], v: [60, 0, 0], size: 0.06, mass: 1.5, temp: 600, av: [0, 0, 0] });
  sim.rigid.launchFragment({ p: [3.6, 1.2, 3], v: [60, 0, 0], size: 0.06, mass: 1.5, av: [0, 0, 0] });
  for (let t = 0; t < 1; t += sim.dt) sim.step(sim.dt);
  assert.ok(n0(30) < before[0], `the board is holed (${before[0] - n0(30)} voxels out)`);
  assert.equal(n0(45), before[1], 'the stone wall is not');
  assert.ok(sim.rigid.stats.holes >= 1);
  assert.ok(sim.rigid.stats.ignitions >= 1, 'the hot piece lit the board');
});

test('a burning chunk thrown by a blast burns on in flight (fuel used, heat along its path) and lands burning', LONG, async () => {
  const { World, F_BURNING } = await import('../src/sim/world.js');
  const { Simulation } = await import('../src/sim/simulation.js');
  const { MAT } = await import('../src/sim/materials.js');
  const { enableRigidBodies } = await import('../src/physics/simPhysics.js');
  const w = new World({ size: [4, 3, 4], h: 0.05 });
  for (let z = 0; z < w.nz; z++) for (let x = 0; x < w.nx; x++) w.setVoxel(w.idx(x, 0, z), MAT.soil, { anchored: true });
  // a burning pine beam, 30 × 10 × 10 cm, hanging in the air (it falls as one body)
  const cells = [];
  for (let x = 20; x < 26; x++) for (let y = 20; y < 22; y++) for (let z = 38; z < 40; z++) cells.push(w.idx(x, y, z));
  for (const i of cells) {
    w.setVoxel(i, MAT.pine, { temp: 650 });
    w.skin[i] = 700;
    w.moist[i] = 0;
    w.flags[i] |= F_BURNING;
  }
  const sim = new Simulation(w, defaultWeather());
  const R = enableRigidBodies(sim);
  sim.step(sim.dt);
  assert.equal(R.chunks.length, 1, 'it falls as a body');
  const c = R.chunks[0];
  assert.ok(c.hot, 'a chunk on fire');
  // the blast under it throws it up and away
  const { explode } = await import('../src/sim/explosions.js');
  const q = c.body.pos;
  explode(sim, [q[0] - 0.5, q[1] - 0.6, q[2]], 3e4, { flash: false });
  assert.ok(c.body.vel[1] > 2, `thrown up (${c.body.vel.map((x) => x.toFixed(1))} m/s)`);
  const fuel = () => Array.from(c.B.s.fuel).reduce((s, f, k) => s + (c.B.s.mat[k] ? f : 0), 0);
  const f0 = fuel();
  const a0 = sim.airCellAt(...c.body.pos);
  let flew = 0, maxBurning = 0;
  const cellsHeated = new Set();
  while (R.chunks.includes(c) && w.time < 6) {
    sim.step(1 / 60);
    flew += 1 / 60;
    maxBurning = Math.max(maxBurning, c.burning ?? 0);
    for (const a of c.path) cellsHeated.add(a);
  }
  assert.ok(flew > 0.5, `it flew ${flew.toFixed(2)} s`);
  assert.ok(maxBurning > 10, `burning in flight (${maxBurning} voxels)`);
  assert.ok(fuel() < f0 - 1e-3, `it used fuel in the air (${(f0 - fuel()).toFixed(3)} voxel-fuels)`);
  assert.ok(c.heat > 1e4, `and released its heat: ${(c.heat / 1e3).toFixed(0)} kJ`);
  assert.ok(cellsHeated.size >= 4 && !cellsHeated.has(-1), `into the air along its path (${cellsHeated.size} air cells, from ${a0})`);
  assert.ok(R.stats.flightHeat > 0 && R.stats.flightFuel > 0);
  // it landed and was stamped back, still burning
  assert.ok(!R.chunks.includes(c), 'landed');
  let n = 0, burning = 0;
  for (let i = 0; i < w.N; i++)
    if (w.mat[i] === MAT.pine) {
      n++;
      if (w.flags[i] & F_BURNING) burning++;
    }
  assert.equal(R.stats.lost, 0, `none lost (${JSON.stringify(R.stats)})`);
  assert.ok(n > 0 && burning > 0, `back in the grid burning (${burning} of ${n} pine voxels)`);
});

test('dragon ragdoll: killed in flight it goes limp, plummets, crashes and comes to rest in one piece; a blast pushes it', LONG, async () => {
  const { groundAt, dragonZones } = await import('../src/ai/dragon.js');
  const { explode } = await import('../src/sim/explosions.js');
  const sim = createSimulation({ world: { size: [60, 8, 40], h: 0.4, ground: 'soil' }, objects: [{ type: 'dragon', params: { start: 'fly' }, x: 15, z: 20, rotation: 90 }], noFire: true, rigidBodies: true });
  const w = sim.world;
  const d = w.dragons[0];
  for (let i = 0; i < 20; i++) sim.step(0.05);
  assert.equal(d.mode, 'air');
  const g0 = groundAt(w, d.p[0], d.p[2]).y;
  const h0 = d.p[1] - g0;
  assert.ok(h0 > 8, `flying ${h0.toFixed(1)} m up`);
  const v0 = [Math.sin(d.yaw) * d.speed, 0, Math.cos(d.yaw) * d.speed];
  d.health = 0;
  sim.step(0.05);
  const R = d.ragdoll;
  assert.ok(R, 'it went limp: a ragdoll');
  assert.equal(Object.keys(R.bodies).length, 22, 'head, 3 neck, chest, belly, 4 tail, 8 leg and 4 wing parts');
  const mass = Object.values(R.bodies).reduce((s, b) => s + b.mass, 0);
  assert.ok(Math.abs(mass - 3000) < 1, `3000 kg (${mass.toFixed(0)})`);
  // it fell on as it flew, from the pose it was in
  const vc = R.velocity();
  assert.ok(Math.hypot(vc[0] - v0[0], vc[2] - v0[2]) < 1.5, 'moving as it was');
  assert.ok(Math.abs(d.spine[d.iShoulder][1] - (g0 + h0)) < 1, 'from where it was');
  let gap = 0, over = 0, maxV = 0, crashT = null, minY = Infinity;
  const t0 = w.time;
  while (w.time < t0 + 20 && !(d.mode === 'dead' && R.atRest())) {
    sim.step(0.05);
    for (const j of R.joints) {
      const a = j.a.toWorld(j.la), b = j.b.toWorld(j.lb);
      gap = Math.max(gap, len([a[0] - b[0], a[1] - b[1], a[2] - b[2]]));
      if (j.type === 'hinge') over = Math.max(over, j.angle() - j.upper, j.lower - j.angle());
    }
    maxV = Math.max(maxV, R.maxSpeed());
    for (const b of Object.values(R.bodies)) minY = Math.min(minY, b.pos[1] - groundAt(w, b.pos[0], b.pos[2]).y);
    if (d.mode === 'dead' && crashT === null) crashT = w.time - t0;
  }
  const tFall = Math.sqrt((2 * h0) / 9.81);
  assert.ok(crashT !== null && crashT > tFall * 0.7 && crashT < tFall * 1.6, `it plummeted and crashed after ${crashT?.toFixed(2)} s (free fall ${tFall.toFixed(2)} s)`);
  assert.ok(w.events.some((e) => e.type === 'dragonDown'), 'the crash');
  assert.ok(w.events.some((e) => e.type === 'impact' && e.kind === 'rigid'), 'heard');
  assert.ok(gap < 0.15, `the joints hold together (${gap.toFixed(3)} m)`);
  assert.ok(over < 0.12, `knees, elbows and wrists bend only their way (${over.toFixed(3)} rad past a limit)`);
  assert.ok(maxV < Math.hypot(...v0) + Math.sqrt(2 * 9.81 * h0) + 6, `nothing flies off (fastest ${maxV.toFixed(1)} m/s)`);
  assert.ok(minY > -0.6, `nothing sank through the ground (${minY.toFixed(2)} m)`);
  assert.ok(R.atRest(), 'it comes to rest');
  // the pose the renderer and the hit zones use is the ragdoll's
  const chest = d.spine[d.iShoulder];
  assert.ok(chest[1] - groundAt(w, chest[0], chest[2]).y < 2, `lying on the ground (chest ${chest[1].toFixed(2)})`);
  assert.equal(d.spine.length, R.spec.spine.length);
  assert.ok(d.ragLegs?.foreL && d.ragWing?.wingL, 'legs and wings from the ragdoll');
  const zones = dragonZones(d, w);
  assert.ok(zones.find((z) => z.k === 'foreL').pts[2].p === d.ragLegs.foreL.foot, 'the hit zones follow it');
  // a blast beside it pushes it
  const before = Object.values(R.bodies).map((b) => b.pos.slice());
  explode(sim, [chest[0] + 1.5, chest[1], chest[2]], 4e6, { flash: false });
  for (let k = 0; k < 10; k++) sim.step(0.05);
  const moved = Math.max(...Object.values(R.bodies).map((b, i) => len([b.pos[0] - before[i][0], b.pos[1] - before[i][1], b.pos[2] - before[i][2]])));
  assert.ok(moved > 0.1, `the blast moved it (${moved.toFixed(2)} m)`);
});

test('without rigid bodies a dead dragon falls the old way', LONG, () => {
  const sim = createSimulation({ world: { size: [60, 8, 40], h: 0.4, ground: 'soil' }, objects: [{ type: 'dragon', params: { start: 'fly' }, x: 15, z: 20, rotation: 90 }], noFire: true });
  const d = sim.world.dragons[0];
  sim.step(0.05);
  d.health = 0;
  for (let i = 0; i < 80 && d.mode !== 'dead'; i++) sim.step(0.05);
  assert.equal(d.ragdoll, undefined);
  assert.equal(d.mode, 'dead');
});
