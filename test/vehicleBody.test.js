import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../src/sim/createSimulation.js';
import { MAT } from '../src/sim/materials.js';
import { World, F_BURNING, F_ANCHOR } from '../src/sim/world.js';
import { rot, toWorld } from '../src/sim/buoyancy.js';
import { makeMovingBody, restamp, copiesOf, bodyLeft, syncBody } from '../src/sim/movingBody.js';
import { carRot, pedals, startEngine } from '../src/sim/carPhysics.js';
import { initCars, ensureBody, boardCar } from '../src/sim/cars.js';
import { stampBody } from '../src/sim/carBody.js';
import { stepVessels } from '../src/sim/vessels.js';
import { toggleDoor } from '../src/sim/doors.js';

/** A block of wood (nx × ny × nz voxels) at cell (x0, y0, z0) as a moving body, its pose at its centre. */
function block(w, [x0, y0, z0], [bx, by, bz], o = {}) {
  const cells = [];
  for (let x = x0; x < x0 + bx; x++)
    for (let y = y0; y < y0 + by; y++)
      for (let z = z0; z < z0 + bz; z++) {
        const i = w.idx(x, y, z);
        w.setVoxel(i, o.mat ?? MAT.wood, { owner: o.owner ?? 7 });
        cells.push(i);
      }
  w.rebuildLists();
  const h = w.h;
  const p = [(x0 + bx / 2) * h, (y0 + by / 2) * h, (z0 + bz / 2) * h];
  return { cells, p, B: makeMovingBody(w, cells, null, { pose: { p, R: rot(0, 0, 0) }, owner: o.owner ?? 7, ...o.body }) };
}

/** Its cells now, as a Set. */
const cellsOf = (B) => new Set(B.cellList.subarray(0, B.nCells));

/** From the edge of a box of cells, through what is empty (6-connected), with pass(i): the cells reached. */
function flood(w, box, pass) {
  const [x0, x1, y0, y1, z0, z1] = box;
  const seen = new Set();
  const q = [];
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (x !== x0 && x !== x1 && z !== z0 && z !== z1 && y !== y0) continue;
        const i = w.idx(x, y, z);
        if (!w.mat[i] && pass(i)) {
          seen.add(i);
          q.push(i);
        }
      }
  while (q.length) {
    const i = q.pop();
    const [x, y, z] = w.coords(i);
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const X = x + dx, Y = y + dy, Z = z + dz;
      if (X < x0 || X > x1 || Y < y0 || Y > y1 || Z < z0 || Z > z1) continue;
      const j = w.idx(X, Y, Z);
      if (seen.has(j) || w.mat[j] || !pass(j)) continue;
      seen.add(j);
      q.push(j);
    }
  }
  return seen;
}

test('moving body: a turned block has no gaps at any angle; its voxels keep their neighbours', () => {
  const w = new World({ size: [5, 3, 5], h: 0.1 });
  const { B, p } = block(w, [15, 10, 20], [16, 5, 8]);
  const h = w.h;
  for (let deg = 0; deg <= 360; deg += 9) {
    const a = (deg * Math.PI) / 180;
    // heading, and a little heel and trim as a car or a boat has
    const R = rot(a, 0.15 * Math.sin(a * 3), 0.1 * Math.cos(a * 2));
    const r = restamp(w, B, { p, R });
    assert.equal(r.gone, 0);
    const cells = cellsOf(B);
    // every cell whose centre is inside the turned block (less half a voxel all round) is filled
    let holes = 0;
    for (let x = 5; x < 45; x++)
      for (let y = 2; y < 28; y++)
        for (let z = 5; z < 45; z++) {
          const c = w.center(x, y, z);
          const d = [c[0] - p[0], c[1] - p[1], c[2] - p[2]];
          const l = [R[0] * d[0] + R[3] * d[1] + R[6] * d[2], R[1] * d[0] + R[4] * d[1] + R[7] * d[2], R[2] * d[0] + R[5] * d[1] + R[8] * d[2]];
          if (Math.abs(l[0]) < 0.8 - h / 2 && Math.abs(l[1]) < 0.25 - h / 2 && Math.abs(l[2]) < 0.4 - h / 2 && !cells.has(w.idx(x, y, z))) holes++;
        }
    assert.equal(holes, 0, `no holes at ${deg}°`);
    assert.ok(B.nCells >= B.n * 0.95 && B.nCells <= B.n * 1.12, `${B.nCells} cells for ${B.n} voxels at ${deg}°`);
    // and nothing of it is left where it was
    for (const i of w.solids.subarray(0, w.solidCount)) assert.ok(cells.has(i) || w.owner[i] !== 7);
  }
  // back where it was built: exactly the cells it was built in
  restamp(w, B, { p, R: rot(0, 0, 0) });
  assert.equal(B.nCells, B.n);
  for (let k = 0; k < B.n; k++) assert.deepEqual(copiesOf(B, k), [w.idx(B.lat[3 * k], B.lat[3 * k + 1], B.lat[3 * k + 2])]);
});

test("moving body: a boat's planking stays tight turned and heeled (no joint for the water to get in by)", () => {
  const sim = createSimulation({ world: { size: [8, 3, 8], h: 0.1, ground: 'soil' }, objects: [{ type: 'rowBoat', params: { crew: 0 }, x: 4, z: 4, y: 0.9 }], weather: { windSpeed: 0 }, noFire: true });
  const w = sim.world;
  sim.step(0.05);
  const f = w.floats[0], B = f.mb, hull = f.body.hull, h = w.h;
  const p = B.pose.p.slice();
  for (let deg = 0; deg < 360; deg += 15) {
    const a = (deg * Math.PI) / 180;
    const R = rot(a, 0.12 * Math.sin(a * 2), 0.05);
    restamp(w, B, { p, R }, {});
    // below its gunwale (a voxel and more under its sheer), from outside it: does the water get in?
    const loc = (i) => {
      const c = w.center(...w.coords(i));
      const d = [c[0] - p[0], c[1] - p[1], c[2] - p[2]];
      return [R[0] * d[0] + R[3] * d[1] + R[6] * d[2], R[1] * d[0] + R[4] * d[1] + R[7] * d[2], R[2] * d[0] + R[5] * d[1] + R[8] * d[2]];
    };
    const below = (i) => {
      const l = loc(i);
      return l[1] < hull.sheer(Math.max(hull.x0, Math.min(hull.x1, l[0]))) - 2.5 * h;
    };
    const box = [Math.floor((p[0] - 2.6) / h), Math.floor((p[0] + 2.6) / h), Math.floor((p[1] - 0.3) / h), Math.floor((p[1] + 0.8) / h), Math.floor((p[2] - 2.6) / h), Math.floor((p[2] + 2.6) / h)];
    const wet = flood(w, box, below);
    let inside = 0, reached = 0;
    for (let x = box[0]; x <= box[1]; x++)
      for (let y = box[2]; y <= box[3]; y++)
        for (let z = box[4]; z <= box[5]; z++) {
          const i = w.idx(x, y, z);
          if (w.mat[i] || !below(i)) continue;
          const l = loc(i);
          if (l[0] < hull.x0 + 0.25 || l[0] > hull.x1 - 0.25 || Math.abs(l[2]) > hull.half(l[0], l[1]) - 0.12 || l[1] < hull.keel(l[0]) + 0.1) continue;
          inside++;
          if (wet.has(i)) reached++;
        }
    assert.ok(inside > 100, `its inside (${inside} cells)`);
    assert.equal(reached, 0, `tight at ${deg}°`);
  }
});

/** A street with a car on it (h 0.2 m, as test/cars.test.js), its voxels its body. */
function street(fire = false) {
  const sim = createSimulation({ world: { size: [40, 5, 12], h: 0.2 }, weather: { ambient: 15, windSpeed: 0 }, objects: [{ type: 'car', params: {}, x: 6, z: 6, rotation: 0, ignite: fire }] });
  const w = sim.world;
  const c = initCars(w)[0];
  return { sim, w, c };
}
const petrol = (w, c) => {
  let s = 0, n = 0;
  for (let k = 0; k < w.solidCount; k++) {
    const i = w.solids[k];
    if (w.owner[i] === c.owner && w.vesselTag[i] < 0) {
      s += w.fuel[i] * w.dens[i];
      n++;
    }
  }
  return { s, n };
};

test('a car turned through 360°: its tank stays sealed (no false leak), its petrol in it, no way out for it', () => {
  const { sim, w, c } = street();
  sim.step(0.1);
  ensureBody(w, c);
  const p0 = petrol(w, c);
  assert.ok(p0.n > 5, 'petrol in its tank');
  const v = w.vessels.find((q) => q.owner === c.owner);
  assert.ok(v, 'its tank');
  // (how much of its petrol touches the open air outside: at this grid's 0.2 m its thin shell is not all round it as built)
  const exposed = () => {
    const cont = [];
    for (let j = 0; j < c.body.nCells; j++) if (w.vesselTag[c.body.cellList[j]] < 0) cont.push(w.coords(c.body.cellList[j]));
    const lo = [0, 1, 2].map((a) => Math.min(...cont.map((q) => q[a])) - 2), hi = [0, 1, 2].map((a) => Math.max(...cont.map((q) => q[a])) + 2);
    const reach = flood(w, [lo[0], hi[0], lo[1], hi[1], lo[2], hi[2]], () => true);
    let n = 0;
    // (sideways and down: where a liquid goes; not up)
    for (const [x, y, z] of cont) for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) if (reach.has(w.idx(x + dx, y + dy, z + dz))) n++;
    return n;
  };
  const open0 = exposed();
  for (let deg = 0; deg <= 360; deg += 10) {
    const yaw = (deg * Math.PI) / 180;
    stampBody(w, c.body, { x: c.x + deg / 120, y: c.y, z: c.z, yaw, pitch: 0.04 * Math.sin(yaw), roll: 0.03 }, { hidden: true });
    // the tank model looks at it (a hole: it leaks) and the petrol may flow (structure)
    stepVessels(sim, 0.1);
    sim.structure(0.1);
    assert.ok(!['leaking', 'ruptured'].includes(v.state), `sealed at ${deg}° (${v.state})`);
    const p = petrol(w, c);
    assert.ok(Math.abs(p.s - p0.s) < 0.02 * p0.s, `its petrol at ${deg}°: ${p.s.toFixed(2)} of ${p0.s.toFixed(2)}`);
    // from outside its tank, through what is empty: no more of its petrol open to it than as built
    if (deg % 30 === 0) {
      const open = exposed();
      assert.ok(open <= open0, `no new way out at ${deg}° (${open} open faces, ${open0} as built)`);
    }
  }
});

test('doors, pick-ups and gas pipes are told where their voxels went (and an open door shuts where the body is now)', () => {
  const w = new World({ size: [6, 3, 6], h: 0.1 });
  // a block with a door panel at its end, a pick-up on top, a pipe along it (as a model registers them)
  const cells = [];
  const door = { name: 'hatch', voxels: [], glass: [], owner: 3, open: false, center: [0, 0, 0] };
  w.doors.push(door);
  const pick = { id: 'axe', type: 'axe', p: [2.05, 1.25, 2.05], voxels: [], taken: false, owner: 3 };
  w.pickups.push(pick);
  const pipe = { voxels: [], power: 1e5, owner: 3 };
  w.gasPipes.push(pipe);
  for (let x = 15; x < 27; x++)
    for (let y = 8; y < 12; y++)
      for (let z = 18; z < 24; z++) {
        const i = w.idx(x, y, z);
        const isDoor = x === 26 && y > 8 && y < 11, isPick = y === 11 && x === 20 && z === 20, isPipe = y === 8 && z === 18;
        w.setVoxel(i, isPipe ? MAT.steel : MAT.wood, { owner: 3, doorTag: isDoor ? 1 : 0, pickupTag: isPick ? 1 : 0 });
        if (isDoor) door.voxels.push(i);
        if (isPick) pick.voxels.push(i);
        if (isPipe) pipe.voxels.push(i);
        cells.push(i);
      }
  door.center = w.center(26, 9, 21);
  w.rebuildLists();
  const p = [2.1, 1.0, 2.1];
  const B = makeMovingBody(w, cells, null, { pose: { p, R: rot(0, 0, 0) }, owner: 3 });
  const nDoor = door.voxels.length;
  const p2 = [3.4, 1.0, 3.0], R2 = rot(Math.PI / 3, 0, 0);
  restamp(w, B, { p: p2, R: R2 });
  // each list holds the cells its voxels are in now (all of them, and only those)
  assert.ok(door.voxels.length >= nDoor * 0.9, `${door.voxels.length} door cells (of ${nDoor})`);
  assert.ok(door.voxels.every((i) => w.doorTag[i] === 1 && w.mat[i] === MAT.wood && B.cells.has(i)), 'the door where it is now');
  assert.ok(pick.voxels.length >= 1 && pick.voxels.every((i) => w.pickupTag[i] === 1));
  assert.ok(pipe.voxels.length >= 10 && pipe.voxels.every((i) => w.mat[i] === MAT.steel && B.cells.has(i)), 'the pipe where it is now');
  // the door's centre and the pick-up's place went with it
  const want = [p2[0] + R2[0] * 0.55 + R2[2] * 0.05, 0, p2[2] + R2[6] * 0.55 + R2[8] * 0.05];
  assert.ok(Math.hypot(door.center[0] - want[0], door.center[2] - want[2]) < 0.15, `door centre ${door.center.map((v) => v.toFixed(2))} vs ${want.map((v) => v.toFixed(2))}`);
  assert.ok(Math.hypot(pick.p[0] - (p2[0] + R2[0] * -0.05 + R2[2] * -0.05), pick.p[2] - (p2[2] + R2[6] * -0.05 + R2[8] * -0.05)) < 0.2, 'the pick-up with it');
  // the door opened (its voxels out of the grid), the body moved on, the door shut: it shuts in the body
  const sim = { world: w };
  toggleDoor(sim, 0, true, { force: true });
  assert.equal(door.voxels.filter((i) => w.mat[i]).length, 0, 'open: out of the grid');
  const p3 = [3.6, 1.0, 3.3];
  const r = restamp(w, B, { p: p3, R: R2 });
  assert.equal(r.gone, 0, 'an open door is not burnt away');
  toggleDoor(sim, 0, false, { force: true });
  restamp(w, B, { p: p3, R: R2 });
  const shut = door.voxels.filter((i) => w.mat[i] && w.doorTag[i] === 1);
  assert.ok(shut.length >= nDoor * 0.8, `shut: ${shut.length} door cells`);
  for (const i of shut) {
    const c = w.center(...w.coords(i));
    const d = [c[0] - p3[0], c[2] - p3[2]];
    const lx = R2[0] * d[0] + R2[6] * d[1];
    assert.ok(lx > 0.45, `the door at its end of the body (${lx.toFixed(2)})`);
  }
  assert.ok(bodyLeft(B) > 0.99);
});

test('a panel burnt loose falls off a moving body as debris; the rest stays', () => {
  const w = new World({ size: [6, 3, 6], h: 0.1 });
  const { B, p } = block(w, [15, 10, 20], [10, 4, 6], { owner: 9 });
  // a panel hung off its end by one row of voxels
  const panel = [], neck = [];
  for (let y = 10; y < 14; y++)
    for (let z = 20; z < 26; z++) {
      const i = w.idx(26, y, z);
      w.setVoxel(i, MAT.steel, { owner: 9, density: 0.02 });
      panel.push(i);
    }
  for (let z = 20; z < 26; z++) {
    const i = w.idx(25, 13, z);
    w.setVoxel(i, MAT.steel, { owner: 9, density: 0.02 });
    neck.push(i);
  }
  w.rebuildLists();
  const cells = [...B.cellList.subarray(0, B.nCells), ...panel, ...neck];
  const C = makeMovingBody(w, cells, null, { pose: { p, R: rot(0, 0, 0) }, owner: 9, anchor: true });
  const vel = { v: [4, 0, 0], w: [0, 0, 0] };
  restamp(w, C, { p: [p[0] + 0.12, p[1], p[2]], R: rot(0, 0, 0) }, { vel });
  assert.equal(w.debris.length, 0, 'held on');
  // its neck burnt through
  for (const i of neck) {
    const j = copiesOf(C, cells.indexOf(i))[0];
    w.clearVoxel(j);
  }
  w.rebuildLists();
  const r = restamp(w, C, { p: [p[0] + 0.24, p[1], p[2]], R: rot(0, 0, 0) }, { vel });
  assert.equal(r.gone, neck.length);
  assert.equal(r.detached, panel.length, 'the panel came off');
  assert.equal(w.debris.length, panel.length, 'falling as debris');
  assert.ok(w.debris.every((d) => d.v[0] > 3 && !(d.flags & F_ANCHOR)), 'flying on with the speed it had, not held');
  // the block itself stays on it, whole
  const blockLeft = [...Array(C.n).keys()].filter((k) => C.s.mat[k] === MAT.wood).length;
  assert.equal(blockLeft, 240);
});

test('a burnt-through panel falls off a car as it drives', () => {
  const { sim, w, c } = street();
  sim.step(0.1);
  ensureBody(w, c);
  const B = c.body;
  // its rearmost slab of voxels, and the slab in front of it burnt away (its bumper hangs by nothing)
  let xmin = Infinity;
  for (let k = 0; k < B.n; k++) if (B.s.mat[k] && B.s.vesselTag[k] >= 0) xmin = Math.min(xmin, B.local[3 * k]);
  const rear = [], cut = [];
  for (let k = 0; k < B.n; k++) {
    if (!B.s.mat[k] || B.s.vesselTag[k] < 0) continue;
    const x = B.local[3 * k];
    if (x < xmin + 0.1) rear.push(k);
    else if (x < xmin + 0.3) cut.push(k);
  }
  assert.ok(rear.length > 5, `its rear (${rear.length} voxels)`);
  for (const k of cut) for (const i of copiesOf(B, k)) w.clearVoxel(i);
  // driven off
  boardCar(c, { player: true, mass: 85 }, 0);
  c.player = true;
  startEngine(c);
  for (let t = 0; t < 3; t += 1 / 30) {
    c.input = { ...pedals(c, t > 0.8 ? 0.5 : 0, 0), steer: 0 };
    sim.step(1 / 30);
  }
  const off = rear.filter((k) => !B.s.mat[k]).length;
  assert.ok(off >= rear.length * 0.8, `its rear fell off (${off} of ${rear.length})`);
  // it lies (or flies) behind the car, nobody's
  let behind = 0;
  for (let k = 0; k < w.solidCount; k++) {
    const i = w.solids[k];
    if (w.owner[i] !== -1 || !w.mat[i]) continue;
    const q = w.center(...w.coords(i));
    if (q[1] > c.y - 0.5 && q[0] < c.x - 1 && Math.abs(q[2] - c.z) < 1.5) behind++;
  }
  assert.ok(behind + w.debris.length >= rear.length * 0.5, `the pieces behind it (${behind} landed, ${w.debris.length} in the air)`);
  assert.ok(bodyLeft(B) > 0.7, 'the car itself goes on');
});

/** Smoke-weighted mean of air cells in a slab: [x, y, z, total]. */
function smokeAt(w, y0, y1, zc, dz) {
  const ah = w.ah;
  let s = 0, sx = 0, sy = 0;
  for (let az = 0; az < w.anz; az++) {
    const z = (az + 0.5) * ah;
    if (Math.abs(z - zc) > dz) continue;
    for (let ay = 0; ay < w.any; ay++) {
      const y = (ay + 0.5) * ah;
      if (y < y0 || y > y1) continue;
      for (let ax = 0; ax < w.anx; ax++) {
        const m = w.smoke[w.airIdx(ax, ay, az)];
        s += m;
        sx += m * (ax + 0.5) * ah;
        sy += m * y;
      }
    }
  }
  return [sx / (s || 1), sy / (s || 1), 0, s];
}

test('a burning car driven off: its plume leans back and trails behind it, close to it the smoke goes with it', () => {
  const { sim, w, c } = street(true);
  for (let t = 0; t < 30; t += 0.1) sim.step(0.1);
  assert.ok(c.burning || [...Array(w.solidCount).keys()].some((k) => w.flags[w.solids[k]] & F_BURNING), 'on fire');
  boardCar(c, { player: true, mass: 85 }, 0);
  c.player = true;
  startEngine(c);
  for (let t = 0; t < 4; t += 1 / 30) {
    c.input = { ...pedals(c, t > 0.6 ? 0.45 : 0, 0), steer: 0 };
    sim.step(1 / 30);
  }
  const v = Math.hypot(c.vx, c.vz);
  assert.ok(v > 3 && c.x > 12, `driving (${v.toFixed(1)} m/s at x ${c.x.toFixed(1)})`);
  // the smoke over it: higher up, further behind it
  const low = smokeAt(w, c.y + 1.2, c.y + 2.4, c.z, 2);
  const high = smokeAt(w, c.y + 2.4, c.y + 4.8, c.z, 2);
  assert.ok(low[3] > 0 && high[3] > 0, 'smoke over it');
  assert.ok(low[0] < c.x - 0.5, `its plume behind it (${(low[0] - c.x).toFixed(2)} m)`);
  assert.ok(high[0] < low[0], `leaning back: higher is further behind (${(high[0] - c.x).toFixed(2)} vs ${(low[0] - c.x).toFixed(2)} m)`);
  // and the air close to it is dragged along: the cells by its sides move with it
  // (beside it, just out of its box: 0.3 m from its sides, along its length)
  let sv = 0, n = 0;
  for (let x = c.x - 1.5; x <= c.x + 1.5; x += w.ah)
    for (const side of [1, -1]) {
      const a = w.airIdx(Math.floor(x / w.ah), Math.floor((c.y + 0.5) / w.ah), Math.floor((c.z + side * (c.spec.W / 2 + 0.3)) / w.ah));
      sv += w.vx[a];
      n++;
    }
  assert.ok(sv / n > 0.2 * c.vx, `the air beside it moves with it (${(sv / n).toFixed(2)} m/s, the car ${c.vx.toFixed(1)})`);
});

test("the air in a car's cabin goes with it: hot smoky air inside stays inside as it drives", () => {
  const { sim, w, c } = street();
  sim.step(0.1);
  ensureBody(w, c);
  const B = c.body;
  const [lo, hi] = B.box;
  const h = w.h, ah = w.ah;
  // its cabin's air hot and smoky (as if something smouldered in it)
  const cabin = (pose) => {
    const out = [];
    const R = pose.R, p = pose.p;
    for (let az = 0; az < w.anz; az++)
      for (let ay = 0; ay < w.any; ay++)
        for (let ax = 0; ax < w.anx; ax++) {
          const d = [(ax + 0.5) * ah - p[0], (ay + 0.5) * ah - p[1], (az + 0.5) * ah - p[2]];
          const l = [R[0] * d[0] + R[3] * d[1] + R[6] * d[2], R[1] * d[0] + R[4] * d[1] + R[7] * d[2], R[2] * d[0] + R[5] * d[1] + R[8] * d[2]];
          if (l[0] > lo[0] + h && l[0] < hi[0] - h && l[1] > lo[1] + h && l[1] < hi[1] - h && l[2] > lo[2] + h && l[2] < hi[2] - h) out.push(w.airIdx(ax, ay, az));
        }
    return out;
  };
  const pose0 = { p: [c.x, c.y, c.z], R: carRot(c.yaw, 0, 0) };
  const in0 = cabin(pose0);
  assert.ok(in0.length >= 4, `its cabin (${in0.length} air cells)`);
  for (const a of in0) {
    w.airT[a] = 120;
    w.smoke[a] = 2e-3;
    w.o2[a] = 0.17;
  }
  // driven 6 m on, in steps (as it drives)
  for (let s = 1; s <= 30; s++) stampBody(w, B, { x: c.x + s * 0.2, y: c.y, z: c.z, yaw: c.yaw, pitch: 0, roll: 0 }, { hidden: true, air: {} });
  const in1 = cabin({ p: [c.x + 6, c.y, c.z], R: carRot(c.yaw, 0, 0) });
  const mean = (cells, f) => cells.reduce((s, a) => s + w[f][a], 0) / cells.length;
  assert.ok(mean(in1, 'airT') > 80 && mean(in1, 'smoke') > 1.2e-3 && mean(in1, 'o2') < 0.19, `its cabin's air with it (${mean(in1, 'airT').toFixed(0)} °C)`);
  const left = in0.filter((a) => !in1.includes(a));
  assert.ok(left.length && mean(left, 'airT') < 30 && mean(left, 'smoke') < 1e-4, `fresh air where it was (${mean(left, 'airT').toFixed(0)} °C)`);
});

test('restamping patches the lists rather than rebuilding them: cheaper than the full rebuild it replaced', () => {
  const w = new World({ size: [24, 4, 24], h: 0.1 });
  // a world with plenty in it (a floor, walls) and a boat-sized body
  for (let x = 0; x < w.nx; x++) for (let z = 0; z < w.nz; z++) w.setVoxel(w.idx(x, 0, z), MAT.soil);
  for (let x = 0; x < w.nx; x += 7) for (let y = 1; y < 20; y++) for (let z = 0; z < w.nz; z++) w.setVoxel(w.idx(x, y, z), MAT.concrete);
  const { B, p } = block(w, [100, 10, 100], [40, 6, 14]);
  w.lazyDerived = false;
  w.rebuildLists();
  const run = (full) => {
    const t0 = performance.now();
    for (let s = 0; s < 40; s++) {
      if (full) w.listDirty = true; // (as before: the whole grid's list and derived fields again)
      restamp(w, B, { p: [p[0] + 0.03 * s, p[1] + 0.02 * Math.sin(s), p[2]], R: rot(0.01 * s, 0.03 * Math.sin(s), 0) });
      if (w.listDirty) w.rebuildLists();
    }
    return performance.now() - t0;
  };
  run(false);
  const tFull = Math.min(run(true), run(true));
  const tPatch = Math.min(run(false), run(false));
  // the lists are right: what is in the grid
  let n = 0;
  for (let i = 0; i < w.N; i++) if (w.mat[i]) n++;
  assert.equal(w.solidCount, n, 'the solid list holds what is in the grid');
  assert.equal(new Set(w.solids.subarray(0, w.solidCount)).size, n, 'each once');
  assert.ok(tPatch < tFull * 0.7, `patched ${tPatch.toFixed(1)} ms vs rebuilt ${tFull.toFixed(1)} ms`);
});

/**
 * A rowing boat moored on a swell (the sea: its level, its waves), a couple of litres of petrol spilt
 * in its stern sheets and lit; its planking dry (as built: 12 %) or wet (60 %, rained on, splashed).
 * → after T s: its voxels burning, the heat its wood gives off (W), the share of it gone or charred.
 */
function boatOnFire(wet, T) {
  const sim = createSimulation({ world: { size: [7, 2.5, 4], h: 0.1, ground: 'soil' }, objects: [{ type: 'rowBoat', params: { crew: 0, moored: true }, x: 3.5, z: 2, y: 0.9 }], weather: { windSpeed: 1.5 } });
  const w = sim.world;
  w.sea = { level: 0.9, box: [0, 0, 0, 0] };
  const f = w.floats[0];
  if (wet) for (const i of new Set(f.own)) if (w.mat[i] === MAT.wood) w.moist[i] = 0.6;
  sim.step(0.1);
  assert.ok(f.water?.sea, 'afloat on the sea');
  for (let dx = -0.2; dx <= 0.21; dx += 0.1)
    for (let dz = -0.2; dz <= 0.21; dz += 0.1) {
      const i = w.voxelAt(...toWorld(f.body, [-0.9 + dx, 0.2, dz]));
      if (i >= 0 && !w.mat[i]) w.setVoxel(i, MAT.gasoline, { density: 0.2 });
    }
  w.rebuildLists();
  sim.ignite(toWorld(f.body, [-0.9, 0.2, 0]), 0.3);
  for (let t = 0; t < T; t += 0.1) sim.step(0.1);
  const B = f.mb;
  syncBody(w, B);
  let burning = 0, hrr = 0;
  for (let j = 0; j < B.nCells; j++) {
    const i = B.cellList[j];
    if (w.flags[i] & F_BURNING) burning++;
    hrr += w.hrr[i];
  }
  let charred = 0;
  for (let k = 0; k < B.n; k++) if (!B.s.mat[k] || B.s.char[k] > 0.3 || B.s.flags[k] & F_BURNING) charred++;
  return { burning, hrr, charred: charred / B.n, n: B.n };
}

test('a dry wooden boat set alight burns up, flames all over it within two minutes; with wet planks the fire stays small', () => {
  const dry = boatOnFire(false, 100);
  const wet = boatOnFire(true, 100);
  // (the petrol burns out in about two minutes: ~600 kW, a pool of a quarter square metre)
  assert.ok(dry.burning > 0.2 * dry.n && dry.hrr > 80e3, `dry: ${dry.burning} of its ${dry.n} voxels burning, its wood ${(dry.hrr / 1e3).toFixed(0)} kW`);
  assert.ok(dry.charred > 0.18, `dry: ${(dry.charred * 100).toFixed(0)} % of it alight or charred`);
  assert.ok(wet.burning < 0.3 * dry.burning && wet.hrr < 0.3 * dry.hrr, `wet: ${wet.burning} burning, ${(wet.hrr / 1e3).toFixed(0)} kW`);
});
