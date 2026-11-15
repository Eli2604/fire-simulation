import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeRowBoat } from '../src/models/rowBoat.js';
import { launchBoat, stepBoat, boardSeat, leaveSeat, seatWorld, rower, row, rowToward, holeBoat, boatShot, castOff, toLocal } from '../src/sim/boats.js';
import { toWorld, updateMass, stepFloats } from '../src/sim/buoyancy.js';
import { createSimulation } from '../src/sim/createSimulation.js';
import { shoot } from '../src/sim/wounds.js';
import { MAT } from '../src/sim/materials.js';

/** A rowing boat afloat outside a simulation: its float (seats, rowlocks, mooring) as models/rowBoat.js builds it. */
const boat = (params = {}, at = {}) => launchBoat(placeRowBoat({ moored: false, ...params }, [0, 0, 0], 0.1).floats[0], at);
const run = (f, s, env = {}, dt = 0.05) => {
  for (let t = 0; t < s; t += dt) stepBoat(f, dt, { level: 0, ...env });
};

test('drift: cast off it goes with the current, held back a little by the wind against it; moored it stays on its line', () => {
  const f = boat();
  run(f, 60, { current: [0.5, 0] });
  const b = f.body;
  assert.ok(Math.abs(b.vx - 0.5) < 0.05 && Math.abs(b.vz) < 0.05, `at the current's speed: ${b.vx.toFixed(3)}, ${b.vz.toFixed(3)} m/s`);
  assert.ok(b.X > 22 && b.X < 30, `carried ${b.X.toFixed(1)} m in a minute`);
  assert.ok(!b.sunk && b.water < 1e-6, 'dry, afloat');
  // a crosswind on it, no current: it drifts downwind, slower than the wind (the water drags it)
  const g = boat();
  run(g, 60, { wind: { speed: 10, dir: Math.PI / 2 } });
  assert.ok(g.body.Z > 5 && g.body.vz > 0.1 && g.body.vz < 2, `blown ${g.body.Z.toFixed(1)} m at ${g.body.vz.toFixed(2)} m/s`);
  // the current a function of where it is: a stream only on x < 10 → it stops past it
  const r = boat();
  run(r, 120, { current: (x) => (x < 10 ? [0.8, 0] : [0, 0]) });
  assert.ok(r.body.X > 10 && r.body.X < 25 && r.body.vx < 0.2, `out of the stream at x ${r.body.X.toFixed(1)}, ${r.body.vx.toFixed(2)} m/s`);
  // moored: it swings on its painter, no further than the line lets it
  const m = launchBoat(placeRowBoat({ moored: true, mooring: 2 }, [0, 0, 0], 0.1).floats[0]);
  assert.ok(m.mooring, 'made fast');
  run(m, 120, { current: [-0.6, 0.3], wind: { speed: 8, dir: Math.PI } });
  const bow = toWorld(m.body, m.mooring.at);
  const d = Math.hypot(bow[0] - m.mooring.anchor[0], bow[2] - m.mooring.anchor[2]);
  assert.ok(d < m.mooring.length + 0.15, `its stem ${d.toFixed(2)} m from the ring (line ${m.mooring.length} m)`);
  assert.ok(Math.hypot(m.body.vx, m.body.vz) < 0.1, 'held there');
  // let go: it goes
  castOff(m);
  run(m, 30, { current: [-0.6, 0.3] });
  assert.ok(Math.hypot(m.body.X - bow[0], m.body.Z - bow[2]) > 8, 'cast off, it drifts away');
});

test('rowing: the rower pulls and it goes ahead at a rowing boat\'s speed; one oar harder turns it; nobody at the oars, nothing', () => {
  const f = boat();
  const me = { name: 'rower' };
  row(f, 1, 0);
  run(f, 10);
  assert.ok(Math.hypot(f.body.X, f.body.Z) < 0.05, 'no rower: it does not move');
  const k = boardSeat(f, me);
  assert.equal(f.seats[k].role, 'rower');
  assert.equal(rower(f), me);
  assert.equal(me.boat, f);
  const draft0 = f.body.Y;
  run(f, 5);
  assert.ok(f.body.Y < draft0, 'deeper with someone aboard');
  row(f, 1, 0);
  const speeds = [];
  for (let t = 0; t < 40; t += 0.05) {
    stepBoat(f, 0.05, { level: 0 });
    speeds.push(f.body.vx * Math.cos(f.body.yaw) - f.body.vz * Math.sin(f.body.yaw));
  }
  const v = speeds.slice(-200).reduce((s, x) => s + x, 0) / 200;
  assert.ok(v > 0.9 && v < 2.5, `rowing at ${v.toFixed(2)} m/s`);
  assert.ok(f.body.X > 30, `${f.body.X.toFixed(1)} m ahead (bow +x)`);
  assert.ok(Math.abs(f.body.yaw) < 0.05, 'straight');
  // the strokes surge: it goes faster in the drive than in the recovery
  const last = speeds.slice(-80);
  assert.ok(Math.max(...last) - Math.min(...last) > 0.05, 'stroke by stroke');
  // the oars sweep and dip
  assert.ok(f.row.oars.every((o) => o.out), 'oars out');
  // to starboard: the port oar pulls, the starboard one backs → it turns right (yaw falls)
  row(f, 0, 1);
  run(f, 10);
  assert.ok(f.body.yaw < -0.8, `turned to starboard: ${((f.body.yaw * 180) / Math.PI).toFixed(0)}°`);
  // back water: it goes astern
  const g = boat();
  boardSeat(g, { name: 'b' });
  row(g, -1, 0);
  run(g, 20);
  assert.ok(g.body.X < -5, `astern ${g.body.X.toFixed(1)} m`);
  // the seats: a second one aboard takes another seat; out, their weight goes too
  const p2 = { name: 'passenger' };
  const k2 = boardSeat(g, p2);
  assert.ok(k2 > 0 && g.seats[k2].role === 'passenger');
  const M = g.body.M;
  assert.equal(leaveSeat(g, p2), k2);
  assert.ok(Math.abs(g.body.M - (M - 80)) < 1e-6 && p2.boat === null);
  const sw = seatWorld(g, 0);
  assert.ok(Math.hypot(sw.p[0] - g.body.X, sw.p[2] - g.body.Z) < 0.5 && sw.p[1] > -0.2, 'the rower sits amidships, over the water');
});

test('rowToward: an AI at the oars rows to a point and stops there', () => {
  const f = boat();
  boardSeat(f, { name: 'soldier' });
  f.row.goal = { p: [-20, 15], radius: 2 };
  for (let t = 0; t < 120 && f.row.goal; t += 0.05) stepBoat(f, 0.05, { level: 0, t });
  assert.ok(!f.row.goal && f.row.arrived > 0, 'got there');
  assert.ok(Math.hypot(f.body.X + 20, f.body.Z - 15) < 3, `at ${f.body.X.toFixed(1)}, ${f.body.Z.toFixed(1)}`);
  // nobody to row: null
  const g = boat();
  assert.equal(rowToward(g, [5, 5]), null);
});

test('holes: below the waterline it fills (Torricelli) and with two aboard it sinks; above it, it stays dry', () => {
  const f = boat({ material: 'wood' });
  boardSeat(f, { name: 'a' });
  boardSeat(f, { name: 'b' });
  run(f, 5);
  const b = f.body;
  // three heavy machine-gun rounds through the bottom (splintered holes), at the keel amidships
  for (const dx of [-0.3, 0, 0.3]) holeBoat(f, toWorld(b, [dx, 0.01, 0.1]), 6e-4);
  assert.equal(f.shotHoles.length, 3);
  const water = [];
  let t = 0;
  for (; t < 1200 && !b.sunk; t += 0.5) {
    stepBoat(f, 0.5, { level: 0, bottom: -6 });
    if (Math.round(t * 2) % 120 === 0) water.push(b.water);
  }
  assert.ok(water[1] > 0 && water[2] > water[1], `filling: ${water.slice(0, 4).map((x) => (x * 1000).toFixed(0)).join(', ')} l`);
  assert.ok(b.sunk, `sunk after ${(t / 60).toFixed(1)} min (${(b.water * 1000).toFixed(0)} l aboard)`);
  assert.ok(t > 120, `not at once: ${t.toFixed(0)} s`);
  // holes above the waterline: nothing comes in
  const g = boat();
  boardSeat(g, { name: 'a' });
  run(g, 5);
  for (const dx of [-0.5, 0, 0.5]) holeBoat(g, toWorld(g.body, [dx, 0.22, g.body.hull.half(dx, 0.22)]), 1e-3);
  const above = g.shotHoles.every((h) => toWorld(g.body, h.p)[1] > 0.05);
  assert.ok(above, 'the holes are above the water');
  run(g, 600, {}, 0.25);
  assert.ok(g.body.water < 1e-6 && !g.body.sunk, `dry: ${(g.body.water * 1000).toFixed(2)} l`);
  // until it settles that deep: a heavy load takes them under, and in it comes
  for (const n of ['b', 'c', 'd', 'e']) boardSeat(g, { name: n });
  g.body.loads.push({ m: 250, p: [0, 0.2, 0], label: 'load' });
  updateMass(g.body);
  run(g, 120, { bottom: -6 }, 0.25);
  assert.ok(g.body.water > 0.01, `settled, it takes water: ${(g.body.water * 1000).toFixed(0)} l`);
});

test('a round fired into the boat from above holes its bottom; one over it misses', () => {
  const f = boat();
  run(f, 2);
  const b = f.body;
  const world = { floats: [f], events: [], time: 0 };
  // from up and to the side, down into the open boat: in over the gunwale, out through the bottom
  const target = toWorld(b, [0.2, 0.05, 0]);
  const from = [target[0], target[1] + 6, target[2] + 3];
  const hit = boatShot(world, from, [target[0] - from[0], target[1] - from[1], target[2] - from[2]], 50);
  assert.ok(hit && hit.boat === f, 'hit');
  assert.equal(hit.holes, 1, 'one hole: it came in over the gunwale');
  const h = f.shotHoles[0];
  assert.ok(h.p[1] < 0.06, `in the bottom: ${h.p.map((x) => x.toFixed(2))}`);
  assert.ok(toWorld(b, h.p)[1] < 0, 'below the waterline');
  // through both sides, beam on
  const side = toWorld(b, [0, 0.3, 0]);
  const hit2 = boatShot(world, [side[0], side[1], side[2] - 10], [0, 0, 1], 50);
  assert.equal(hit2.holes, 2, 'in and out');
  // over it: nothing
  assert.equal(boatShot(world, [side[0], side[1] + 3, side[2] - 10], [0, 0, 1], 50), null);
  // the point of a hole back in its frame
  const l = toLocal(b, toWorld(b, [0.4, 0.2, -0.3]));
  assert.ok(Math.hypot(l[0] - 0.4, l[1] - 0.2, l[2] + 0.3) < 1e-9);
});

test('in the simulation: a boat cast off on a pond drifts downwind, takes its voxels with it, and shots hole it', () => {
  const sim = createSimulation({
    world: { size: [24, 3, 10], h: 0.1, ground: 'soil' },
    objects: [{ type: 'rowBoat', params: { crew: 0, moored: false }, x: 6, z: 5, y: 0.9 }],
    noFire: true,
    weather: { windSpeed: 9, windDir: 0 },
  });
  const w = sim.world;
  // a pond up to its waterline, round it (not in it)
  const own = new Set(w.floats[0].own);
  for (let x = 0; x < w.nx; x++)
    for (let z = 0; z < w.nz; z++)
      for (let y = 1; y < 10; y++) {
        const i = w.idx(x, y, z);
        if (!w.mat[i] && !own.has(i)) w.mat[i] = MAT.water;
        else if (w.mat[i] === MAT.soil && y > 0 && !own.has(i)) w.mat[i] = MAT.water;
      }
  const f = w.floats[0];
  stepFloats(sim, 0.1);
  assert.ok(f.row && f.water && !f.water.sea, 'a boat on a pond');
  const x0 = f.body.X;
  for (let k = 0; k < 300; k++) stepFloats(sim, 0.1);
  assert.ok(f.body.X > x0 + 2, `drifted downwind ${(f.body.X - x0).toFixed(1)} m`);
  assert.ok(f.detached && f.own.every((i) => w.mat[i] !== MAT.wood || f.mb.cells.has(i)), 'its voxels gone from where it was');
  // (where it is now: sim/movingBody.js)
  assert.ok(f.mb.cells.size > 0.8 * f.own.length && [...f.mb.cells].every((i) => w.mat[i] === MAT.wood && Math.abs(w.center(...w.coords(i))[0] - f.body.X) < 2.5), 'its voxels where it is');
  assert.ok(!f.body.sunk && f.body.holes.length === 0, 'whole');
  // stopped at the pond's edge (the world's): it does not leave it
  for (let k = 0; k < 1200; k++) stepFloats(sim, 0.1);
  assert.ok(toWorld(f.body, [f.body.hull.x1 - 0.1, 0, 0])[0] < w.size[0] && !f.body.sunk, 'kept in');
  // shot at from the bank, low across the water: it holes it
  const c = toWorld(f.body, [0, 0.2, 0]);
  const hit = shoot(sim, [c[0], c[1] + 0.05, c[2] - 4], [0, -0.02, 1]);
  assert.ok(hit?.boat === f, `hit the boat: ${Object.keys(hit ?? {})}`);
  assert.ok(f.body.holes.length >= 1);
});

test('drawn: the oars out and sweeping while someone rows, shipped when nobody does; the painter while moored', async () => {
  const THREE = await import('three');
  const { FloatRenderer } = await import('../src/render/floats.js');
  const f = launchBoat(placeRowBoat({ moored: true }, [0, 0, 0], 0.1).floats[0]);
  const r = new FloatRenderer(new THREE.Group());
  r.setWorld({ floats: [f] });
  const it = r.items[0];
  r.update(0.1);
  assert.ok(it.line.visible, 'the mooring line drawn');
  assert.ok(it.m.oars.every((o) => o.visible), 'oars shipped');
  boardSeat(f, { name: 'r' });
  row(f, 1, 0);
  run(f, 0.5);
  r.update(0.1);
  assert.ok(it.m.oars.every((o) => !o.visible), 'not laid along the thwarts');
  const pivots = it.m.group.children.filter((c) => c.isGroup && c.visible && c.children.length === 1);
  assert.equal(pivots.length, 2, 'two oars out');
  assert.ok(pivots.some((p) => Math.abs(p.rotation.y) > 0.05), 'swept');
  castOff(f);
  r.update(0.1);
  assert.ok(!it.line.visible, 'cast off: no line');
});
