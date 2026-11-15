import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../src/sim/createSimulation.js';
import { SCENARIOS, cloneScene } from '../src/scenarios.js';
import { MAT } from '../src/sim/materials.js';
import { stepRivers } from '../src/sim/river.js';
import { stepStirrers, waterStirAt } from '../src/sim/stirrers.js';
import { initIce } from '../src/sim/ice.js';
import { MODELS, resolveParams } from '../src/models/index.js';

// one island for all the tests (it takes a while to build)
let built = null;
const island = () => (built ??= createSimulation({ ...cloneScene(SCENARIOS.carrier), zone: 'island' }));
const fresh = () => createSimulation({ ...cloneScene(SCENARIOS.carrier), zone: 'island' });
/** Only the water: the rivers, the mills and what floats (the rest of the world is not needed). */
const runWater = (sim, t, dt = 0.05) => {
  for (let s = 0; s < t; s += dt) {
    stepRivers(sim, dt);
    stepStirrers(sim, dt);
    sim.world.time += dt;
  }
};

test('the waterfall is on the far side of the island from the volcano, and its river runs to the sea', () => {
  const sim = island();
  const w = sim.world;
  assert.equal(w.rivers?.length, 1, 'one river');
  const r = w.rivers[0];
  const F = r.fall;
  const v = w.volcanoes[0];
  // the island's middle (the island object is at x 34, z 31)
  const c = [34, 31];
  const a = [F.lip[0] - c[0], F.lip[2] - c[1]];
  const b = [v.crater[0] - c[0], v.crater[2] - c[1]];
  // the volcano in the east, the fall in the west, both well off the middle; more than a right angle apart
  assert.ok(b[0] > 8 && a[0] < -8, `volcano east (${b[0].toFixed(1)} m), fall west (${a[0].toFixed(1)} m)`);
  const cos = (a[0] * b[0] + a[1] * b[1]) / Math.hypot(...a) / Math.hypot(...b);
  assert.ok(cos < 0, `the fall and the volcano on opposite sides (cos ${cos.toFixed(2)})`);
  assert.ok(F.drop > 3.5, `a fall of ${F.drop.toFixed(1)} m`);
  // water in the stream above, the pool, and every reach of the river down to the mouth
  const kinds = new Set(r.stations.map((s) => s.kind));
  for (const k of ['stream', 'fall', 'pool', 'water', 'sill', 'sea']) assert.ok(kinds.has(k), `has ${k}`);
  let wet = 0;
  let n = 0;
  for (const s of r.stations) {
    if (s.kind !== 'water' && s.kind !== 'pool' && s.kind !== 'stream') continue;
    n++;
    if (w.mat[w.voxelAt(s.p[0], s.p[1] - w.h / 2, s.p[2])] === MAT.water) wet++;
  }
  assert.ok(wet > 0.9 * n, `water all along it (${wet} of ${n} stations)`);
  // it goes down all the way: each station no higher than the one before, from the pool on
  const from = r.stations.findIndex((s) => s.kind === 'pool');
  for (let k = from + 1; k < r.stations.length; k++) assert.ok(r.stations[k].p[1] <= r.stations[k - 1].p[1] + 1e-6, `downhill at ${k}`);
  // and ends in the sea: the last stations are below the sea's level, over open sea bed
  const last = r.stations[r.stations.length - 1];
  assert.equal(last.kind, 'sea');
  assert.ok(last.bed < w.sea.level, 'its bed runs out under the sea');
  const mouth = r.stations[r.stations.findIndex((s) => s.kind === 'sea') + 4];
  const col = w.colTop[Math.floor(mouth.p[0] / w.h) + w.nx * Math.floor(mouth.p[2] / w.h)];
  assert.ok((col + 1) * w.h < w.sea.level, 'the sea comes up into its mouth');
});

test('the water flows: Q over the fall, v = Q/A down the river; what floats drifts down to the sea', () => {
  const sim = fresh();
  const w = sim.world;
  const r = w.rivers[0];
  runWater(sim, 2);
  assert.ok(r.fallQ > 0.5, `water over the fall (${r.fallQ} m³/s)`);
  assert.equal(r.blockedAt, -1);
  const all = r.stations.map((s, k) => ({ s, v: r.v[k], A: r.area[k] })).filter((q) => q.s.kind === 'water');
  // (the full sections, not those on the lip of a sill)
  const Am = all.map((q) => q.A).sort((x, y) => x - y)[all.length >> 1];
  const water = all.filter((q) => q.A > 0.6 * Am);
  assert.ok(water.length > all.length * 0.6);
  for (const q of all) {
    assert.ok(q.v > 0.2 && q.v <= 3, `${q.v.toFixed(2)} m/s`);
    if (q.v < 3) assert.ok(Math.abs(q.v * q.A - r.Q) < 0.05, 'continuity: v·A = Q');
  }
  for (const q of water) assert.ok(q.v < 2, `${q.v.toFixed(2)} m/s in a full section`);
  const pool = r.stations.findIndex((s) => s.kind === 'pool' && Math.hypot(s.p[0] - r.fall.pool[0], s.p[2] - r.fall.pool[2]) < 0.3);
  assert.ok(r.v[pool] < Math.min(...water.map((q) => q.v)), 'slow in the deep pool');
  // the current at a point in the river runs downstream
  const s = water[Math.floor(water.length / 2)].s;
  const c = waterStirAt(w, s.p[0], s.p[2]);
  assert.ok(c[0] * s.t[0] + c[1] * s.t[2] > 0.2, 'downstream');
  // a crate put in the river is carried down it and out into the sea
  const start = r.stations.find((q) => q.kind === 'water' && w.mat[w.voxelAt(q.p[0], q.p[1] - w.h / 2, q.p[2])] === MAT.water);
  const crate = { kind: 'crate', p: [start.p[0], start.p[1] + 0.1, start.p[2]], r: 0.2, half: 0.2, mass: 5, rot: [0, 0, 0], v: [0, 0, 0] };
  w.loose = [crate];
  runWater(sim, 60, 0.1);
  const mouth = r.stations.find((q) => q.kind === 'sea');
  const d0 = Math.hypot(start.p[0] - mouth.p[0], start.p[2] - mouth.p[2]);
  const d1 = Math.hypot(crate.p[0] - mouth.p[0], crate.p[2] - mouth.p[2]);
  // (out past the mouth it drifts on along the river's run into the sea and comes to rest there)
  const atSea = Math.min(...r.stations.filter((q) => q.kind === 'sea').map((q) => Math.hypot(crate.p[0] - q.p[0], crate.p[2] - q.p[2])));
  assert.ok(atSea < 1 && d0 > 5, `the crate went down the river and out to sea (${d0.toFixed(1)} m from the mouth → ${d1.toFixed(1)} m, ${atSea.toFixed(1)} m off its run into the sea)`);
});

test('the mill wheel turns with the river (slower than the water), and stops when the river is dammed', () => {
  const sim = fresh();
  const w = sim.world;
  assert.equal(w.mills?.length, 1, 'a mill on the river');
  const m = w.mills[0];
  runWater(sim, 30);
  assert.ok(m.immersion > 0.1, `its paddles in the water (${m.immersion.toFixed(2)} m)`);
  assert.ok(m.water > 0.4, `the water at the wheel runs ${m.water.toFixed(2)} m/s`);
  assert.ok(m.omega > 0.15, `it turns (${m.rpm.toFixed(1)} rpm)`);
  const rim = m.omega * m.radius;
  assert.ok(rim < m.water && rim > 0.3 * m.water, `its rim (${rim.toFixed(2)} m/s) a little slower than the water`);
  // inertia: it does not stop at once
  const r = w.rivers[0];
  // a dam across the river above the mill: stone filling the section of a reach
  const k = r.stations.findIndex((s) => s.kind === 'water');
  const s = r.stations[k];
  for (let d = -s.half - 0.6; d <= s.half + 0.6; d += w.h / 2)
    for (let y = s.bed - w.h; y < s.p[1] + w.h * 2; y += w.h / 2)
      for (let a = -0.3; a <= 0.3; a += w.h / 2) {
        const i = w.voxelAt(s.p[0] + s.t[0] * a - s.t[2] * d, y, s.p[2] + s.t[2] * a + s.t[0] * d);
        if (i >= 0) w.setVoxel(i, MAT.stone, { anchored: true });
      }
  const om0 = m.omega;
  runWater(sim, 1);
  assert.ok(r.blockedAt >= 0, 'the river is dammed');
  assert.ok(m.omega > 0.3 * om0, 'it runs on for a while (inertia)');
  runWater(sim, 40);
  assert.equal(m.omega, 0, 'it has stopped');
  assert.ok(Math.abs(m.water) < 0.01, 'the water below the dam stands still');
});

test('the mill wheel stops when the river freezes over at the wheel', () => {
  const sim = fresh();
  const w = sim.world;
  const m = w.mills[0];
  runWater(sim, 20);
  assert.ok(m.omega > 0.15);
  initIce(w, 0.1);
  runWater(sim, 5);
  assert.ok(m.frozen, 'the ice grips its paddles');
  assert.equal(m.omega, 0);
});

test('the walkway behind the fall: reachable on foot from the plateau, under the brink, the water falling in front of it', async () => {
  const sim = island();
  const w = sim.world;
  const F = w.rivers[0].fall;
  const L = F.ledge;
  assert.ok(L, 'a ledge behind the fall');
  // rock over it (the brink) and the falling water clear in front of it at head height
  const solid = (x, y, z) => {
    const i = w.voxelAt(x, y, z);
    return i >= 0 && w.mat[i] && w.mat[i] !== MAT.water;
  };
  assert.ok(solid(L.mid[0], L.y - w.h / 2, L.mid[2]), 'a floor');
  assert.ok(solid(L.mid[0], L.ceil + w.h / 2, L.mid[2]), 'rock overhead');
  for (let y = L.y + 0.2; y < L.y + 1.9; y += w.h / 2) assert.ok(!solid(L.mid[0], y, L.mid[2]), 'room to stand');
  const { brinkSpeed } = await import('../src/render/waterworks.js');
  const vb = brinkSpeed(w.rivers[0].flow, F.width).v;
  const tHead = Math.sqrt((2 * (F.lip[1] - (L.y + 1.7))) / 9.81);
  assert.ok(vb * tHead > 0.4, `the sheet passes ${(vb * tHead).toFixed(2)} m out from the cliff at head height`);
  // walk there: the walk-through's own rules (step up 0.42 m at most, room for the body,
  // no swimming), from the plateau south of the river
  const { Walkthrough } = await import('../src/walk/walk.js');
  const P = Walkthrough.prototype;
  const me = { hooks: { getSim: () => sim } };
  me.solidAt = P.solidAt.bind(me);
  const floorAt = P.floorAt.bind(me);
  const blocked = P.blocked.bind(me);
  const step = 0.2;
  const start = [20, 34];
  const y0 = floorAt(start[0], start[1], w.size[1] - 1);
  const key = (x, z) => `${Math.round(x / step)},${Math.round(z / step)}`;
  const seen = new Map([[key(...start), y0]]);
  const queue = [[start[0], start[1], y0]];
  let reached = null;
  const across = new Set();
  while (queue.length) {
    const [x, z, y] = queue.shift();
    // behind the fall: in the alcove, at the ledge's height
    const a = (x - F.lip[0]) * F.dir[0] + (z - F.lip[2]) * F.dir[2];
    const b = (x - F.lip[0]) * F.across[0] + (z - F.lip[2]) * F.across[2];
    if (a < -0.3 && Math.abs(y - L.y) < 0.05) {
      if (Math.abs(b) < 0.3) reached ??= [x, z];
      across.add(Math.round(b));
    }
    for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 4 || nz < 8 || nx > 36 || nz > 40) continue;
      const fl = floorAt(nx, nz, y + 0.45);
      if (fl - y > 0.42 || blocked(nx, nz, fl, 1.65)) continue;
      // (on foot: not into water over the knees)
      const wi = w.voxelAt(nx, fl + 0.5, nz);
      if (wi >= 0 && w.mat[wi] === MAT.water) continue;
      if (fl < w.sea.level) continue;
      const k = key(nx, nz);
      if (seen.has(k) && seen.get(k) >= fl - 0.01) continue;
      seen.set(k, fl);
      queue.push([nx, nz, fl]);
    }
  }
  assert.ok(reached, 'the ledge behind the fall is reached on foot');
  // and through: from one side of the alcove to the other
  const bs = [...across];
  assert.ok(Math.min(...bs) <= -1 && Math.max(...bs) >= 1, `along the ledge behind the water (${Math.min(...bs)} … ${Math.max(...bs)} m)`);
});

test('the mill is an object of its own: placed anywhere, its wheel turns in a whirlpool', () => {
  const p = resolveParams(MODELS.mill, {});
  const b = MODELS.mill.build(p, { h: 0.2, rng: Math.random });
  assert.equal(b.mills.length, 1);
  assert.ok(b.prims.some((q) => q.hidden), 'its axle is voxels');
  // in the open sea by a whirlpool
  const sim = createSimulation({
    name: 'mill test',
    world: { size: [16, 6, 16], h: 0.2, ground: 'none' },
    objects: [
      { type: 'mill', params: { raceWall: false, axleHeight: 0.6 }, x: 8, z: 5, y: 1.2 },
      { type: 'waterVortex', params: { radius: 4, strength: 1.5 }, x: 8, z: 9.6, y: 1.0 },
    ],
    noFire: true,
  });
  const w = sim.world;
  w.sea = { level: 1.2 + 0.2, box: [0, 0, 0, 0] };
  const m = w.mills[0];
  for (let t = 0; t < 20; t += 0.05) {
    stepRivers(sim, 0.05);
    w.time += 0.05;
  }
  assert.ok(m.immersion > 0, 'in the water');
  assert.ok(Math.abs(m.omega) > 0.05, `turned by the whirlpool's current (${m.rpm.toFixed(1)} rpm)`);
});
