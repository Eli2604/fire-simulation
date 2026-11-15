import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../src/sim/createSimulation.js';
import { MAT } from '../src/sim/materials.js';
import { F_BURNING, F_HIDDEN, World } from '../src/sim/world.js';
import { toWorld, rot } from '../src/sim/buoyancy.js';
import { boardSeat, toLocal } from '../src/sim/boats.js';
import { makeMovingBody, restamp, needsRestamp, bodyStats, syncBody, worldOf } from '../src/sim/movingBody.js';

/** A rowing boat on a pond (fresh water voxels round it, to its waterline), fire on. */
function pondBoat(params = {}) {
  const sim = createSimulation({
    world: { size: [24, 3, 10], h: 0.1, ground: 'soil' },
    objects: [{ type: 'rowBoat', params: { crew: 0, moored: false, ...params }, x: 6, z: 5, y: 0.9 }],
    weather: { windSpeed: 0 },
  });
  const w = sim.world;
  const own = new Set(w.floats[0].own);
  // (the pond: water up to the boat's waterline, round it, not in it: its inside is carved out)
  const f0 = w.floats[0];
  for (let x = 0; x < w.nx; x++)
    for (let z = 0; z < w.nz; z++)
      for (let y = 1; y < 9; y++) {
        const i = w.idx(x, y, z);
        if (own.has(i)) continue;
        const c = w.center(x, y, z);
        const l = [c[0] - f0.at[0], c[1] - f0.at[1], c[2] - f0.at[2]];
        // (not in the hull's inside as built)
        if (Math.abs(l[0]) < 2.15 && Math.abs(l[2]) < 0.72 && !w.mat[i]) continue;
        if (!w.mat[i] || w.mat[i] === MAT.soil) w.setVoxel(i, MAT.water, { temp: w.ambient, variation: 0.03 });
      }
  w.rebuildLists();
  return { sim, w, f: w.floats[0] };
}

/** Its envelope at its pose now: hull frame inside its planking (and the open inside). */
const inHull = (f, p) => {
  const l = toLocal(f.body, p);
  const hull = f.body.hull;
  return l[0] > hull.x0 + 0.05 && l[0] < hull.x1 - 0.05 && Math.abs(l[2]) < hull.half(l[0], l[1]) - 0.05;
};

test('moving body: its voxels and their heat move with it; what burnt away stays gone; water is pushed out and comes back', () => {
  const w = new World({ size: [6, 2, 6], h: 0.1 });
  // a 1 × 0.3 × 0.5 m block of wood at (2, 0.5, 2), a hot spot in it; water round and under it
  const cells = [];
  for (let x = 20; x < 30; x++)
    for (let y = 5; y < 8; y++)
      for (let z = 20; z < 25; z++) {
        const i = w.idx(x, y, z);
        w.setVoxel(i, MAT.wood, { hidden: true });
        cells.push(i);
      }
  const hot = w.idx(25, 7, 22);
  w.temp[hot] = 420;
  w.char[hot] = 0.6;
  w.flags[hot] |= F_BURNING;
  const pose0 = { p: [2, 0.5, 2], R: rot(0, 0, 0) };
  const local = (i) => {
    const c = w.center(...w.coords(i));
    return [c[0] - 2, c[1] - 0.5, c[2] - 2];
  };
  const B = makeMovingBody(w, cells, local, { pose: pose0 });
  const k = cells.indexOf(hot);
  // one voxel burnt away where it is
  const lost = cells[3];
  w.clearVoxel(lost);
  // 1.5 m along x and turned 90°
  const pose1 = { p: [3.5, 0.5, 3], R: rot(Math.PI / 2, 0, 0) };
  assert.ok(needsRestamp(B, pose1, w.h) && !needsRestamp(B, pose0, w.h));
  const r = restamp(w, B, pose1);
  assert.equal(r.gone, 1, 'the burnt one gone');
  assert.equal(B.s.mat[3], 0);
  assert.ok(r.placed >= cells.length - 1 - 3, `placed ${r.placed} of ${cells.length - 1}`);
  // the hot one: where it should be, its heat, char and fire with it
  const c = B.at[k];
  assert.ok(c >= 0, 'placed');
  const want = worldOf(B, k, pose1);
  const got = w.center(...w.coords(c));
  assert.ok(Math.hypot(want[0] - got[0], want[1] - got[1], want[2] - got[2]) < 0.1, 'at its place in the turned pose');
  assert.equal(w.temp[c], 420);
  assert.ok(Math.abs(w.char[c] - 0.6) < 1e-6 && w.flags[c] & F_BURNING && w.flags[c] & F_HIDDEN, 'char, fire, hidden: carried');
  // the old place is empty, and nothing of it is still there
  for (const i of cells) if (!B.cells.has(i)) assert.equal(w.mat[i], 0);
  // heat added in the grid between moves goes along on the next
  w.temp[c] = 500;
  restamp(w, B, { p: [3.5, 0.5, 2.2], R: rot(Math.PI / 2, 0, 0) });
  assert.equal(w.temp[B.at[k]], 500, 'heat state carried across moves');
  const st = bodyStats(w, B);
  assert.equal(st.n, cells.length);
  assert.equal(st.left, cells.length - 1);
  // water: a block "boat" with an envelope, liquid pushed out of it and back where it left
  const w2 = new World({ size: [4, 2, 4], h: 0.1 });
  for (let x = 0; x < w2.nx; x++) for (let z = 0; z < w2.nz; z++) for (let y = 1; y < 6; y++) w2.setVoxel(w2.idx(x, y, z), MAT.water);
  const box = [];
  for (let x = 10; x < 15; x++) for (let z = 10; z < 15; z++) {
    const i = w2.idx(x, 3, z);
    w2.setVoxel(i, MAT.wood);
    box.push(i);
  }
  const B2 = makeMovingBody(w2, box, (i) => w2.center(...w2.coords(i)).map((v, a) => v - [1.25, 0, 1.25][a]), { pose: { p: [1.25, 0, 1.25], R: rot(0, 0, 0) } });
  const opts = { displace: (m) => m === MAT.water, inside: (x, y, z) => Math.abs(x) < 0.25 && Math.abs(z) < 0.25 && y > 0.3 && y < 0.65, bounds: [[-0.25, 0.3, -0.25], [0.25, 0.65, 0.25]], liquid: MAT.water, refill: { mat: MAT.water, below: 0.6 } };
  restamp(w2, B2, { p: [1.25, 0, 1.25], R: rot(0, 0, 0) }, opts);
  // (its inside cleared: above it, under the water's level)
  assert.equal(w2.mat[w2.idx(12, 4, 12)], 0, 'no water inside it');
  restamp(w2, B2, { p: [2.75, 0, 2.75], R: rot(0, 0, 0) }, opts);
  assert.equal(w2.mat[w2.idx(27, 4, 27)], 0, 'none inside it where it is now');
  assert.equal(w2.mat[w2.idx(12, 4, 12)], MAT.water, 'the water back where it was');
  assert.equal(w2.mat[w2.idx(12, 3, 12)], MAT.water, 'where its bottom was too');
});

test('a boat set alight at its berth then rowed away keeps burning, its fire with it; no pond water inside it', () => {
  const { sim, w, f } = pondBoat();
  sim.step(0.1);
  // the rower aboard, heading east
  boardSeat(f, { name: 'rower' });
  f.row.goal = { p: [16, 5], radius: 1 };
  // lit in its stern sheets (the stern thwart and the topsides by it: above the waterline, which the pond keeps wet)
  const b = f.body;
  const at = toWorld(b, [-1.25, 0.6, 0]);
  const lit = sim.ignite(at, 0.45);
  assert.ok(lit > 5, `lit ${lit} voxels`);
  const home = [b.X, b.Z];
  const burningIn = () => {
    let n = 0, out = 0;
    for (const i of f.mb.cells) {
      if (!(w.flags[i] & F_BURNING)) continue;
      n++;
      if (!inHull(f, w.center(...w.coords(i)))) out++;
    }
    return { n, out };
  };
  for (let k = 0; k < 120; k++) sim.step(0.1);
  const moved = Math.hypot(b.X - home[0], b.Z - home[1]);
  assert.ok(moved > 3, `rowed ${moved.toFixed(1)} m away`);
  const fire = burningIn();
  assert.ok(fire.n >= 3, `still burning: ${fire.n} of its voxels`);
  assert.equal(fire.out, 0, 'its fire is in its hull where it is now');
  // (its burning voxels are its own, where the boat is now)
  let stray = 0;
  for (const i of f.own) if (w.mat[i] === MAT.wood && !f.mb.cells.has(i)) stray++;
  assert.equal(stray, 0, 'nothing of it left behind at its berth');
  assert.ok(f.mb.stamps > 5, `restamped ${f.mb.stamps}×`);
  const st = bodyStats(w, f.mb);
  assert.ok(st.char > 0.001, 'charring');
  // no water inside the hull where it is now (below the waterline: it is pushed out)
  let wet = 0;
  const hull = b.hull;
  for (let x = 0; x < w.nx; x++)
    for (let z = 0; z < w.nz; z++)
      for (let y = 1; y < 12; y++) {
        const i = w.idx(x, y, z);
        if (w.mat[i] !== MAT.water) continue;
        const l = toLocal(b, w.center(x, y, z));
        if (l[0] > hull.x0 + 0.1 && l[0] < hull.x1 - 0.1 && Math.abs(l[2]) < hull.half(l[0], l[1]) - 0.1) wet++;
      }
  assert.equal(wet, 0, 'no pond water inside the hull');
  // and its berth is pond again
  // (a layer under the level: the pond's water that filled the hollow it was built in leaves its top layer lower)
  const old = w.voxelAt(home[0], f.water.level - 0.15, home[1]);
  assert.equal(w.mat[old], MAT.water, 'the water closed in over its old berth');
  // the fire burns where it is: the air over the boat is hot, not over its berth
  syncBody(w, f.mb);
  assert.ok(f.left < 1 || f.char > 0 || st.char > 0, 'it is burning down');
});

test('adrift, it catches from a fire lit where it is now; under the waterline it does not burn', () => {
  const { sim, w, f } = pondBoat({ moored: false });
  sim.step(0.1);
  const b = f.body;
  // pushed 4 m east (as if it had drifted), then lit there
  b.X += 4;
  for (let k = 0; k < 10; k++) sim.step(0.1);
  assert.ok(f.mb.stamps >= 1);
  const lit = sim.ignite(toWorld(b, [0.4, 0.45, 0]), 0.4);
  assert.ok(lit > 5, `caught: ${lit}`);
  for (let k = 0; k < 40; k++) sim.step(0.1);
  let below = 0;
  for (const i of f.mb.cells) if (w.flags[i] & F_BURNING && w.center(...w.coords(i))[1] < f.water.level - 0.05) below++;
  assert.equal(below, 0, 'nothing burns under the water');
});
