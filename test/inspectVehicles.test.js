import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSimulation } from '../src/sim/createSimulation.js';
import { MAT } from '../src/sim/materials.js';
import { F_HIDDEN } from '../src/sim/world.js';
import { framePose, stampFloat } from '../src/sim/buoyancy.js';
import { holeBoat } from '../src/sim/boats.js';
import { initCars, boardCar } from '../src/sim/cars.js';
import { pedals, startEngine } from '../src/sim/carPhysics.js';
import { worldOf } from '../src/sim/movingBody.js';
import { pickScene } from '../src/render/pick.js';
import { FloatRenderer } from '../src/render/floats.js';
import { CarRenderer } from '../src/render/cars.js';
import { vehiclePicker } from '../src/render/pickVehicles.js';
import { describeThing } from '../src/sim/inspectThings.js';
import { toBodyLocal, fromBodyLocal, boatPose, carPose, nearestBodyVoxel, bodyVoxelState, boatVoxelAt, personAt, rayBox, vehicleOfVoxel } from '../src/sim/inspectVehicles.js';

// "Voxel inspect doesn't work on the boat": a boat's (and a moving car's) voxels are a moving body
// (sim/movingBody.js) hidden under a mesh of its own, or moved on from where the mesh is drawn, so
// a click on the mesh met no voxel. render/pickVehicles.js raycasts the meshes and maps the hit
// into the body's frame at its pose now (sim/inspectVehicles.js) to the voxel there; the inspector
// describes the boat or the car as a whole, the voxel clicked, and who sits in it.

/** A raycaster from `from` towards `to` (world = sim frame here). */
function rayFrom(from, to) {
  const rc = new THREE.Raycaster();
  const o = new THREE.Vector3(...from);
  rc.set(o, new THREE.Vector3(...to).sub(o).normalize());
  return rc;
}

/** A boat of `kind` (on a pond: water round it to its waterline), stepped once (so it is a body, its voxels a moving body). */
function boatScene(kind = 'row', { pond = false, ...params } = {}) {
  const sim = createSimulation({
    world: { size: [24, 3, 10], h: 0.1, ground: 'soil' },
    objects: [{ type: 'rowBoat', params: { crew: 1, moored: true, kind, ...params }, x: 6, z: 5, y: 0.9 }],
    weather: { windSpeed: 0 },
  });
  const w = sim.world;
  if (pond) {
    // (as test/boatFire.test.js: the water round the hull, not in it)
    const f0 = w.floats[0];
    const own = new Set(f0.own);
    for (let x = 0; x < w.nx; x++)
      for (let z = 0; z < w.nz; z++)
        for (let y = 1; y < 9; y++) {
          const i = w.idx(x, y, z);
          if (own.has(i)) continue;
          const c = w.center(x, y, z);
          if (Math.abs(c[0] - f0.at[0]) < 2.15 && Math.abs(c[2] - f0.at[2]) < 0.72 && !w.mat[i]) continue;
          if (!w.mat[i] || w.mat[i] === MAT.soil) w.setVoxel(i, MAT.water, { temp: w.ambient, variation: 0.03 });
        }
    w.rebuildLists();
  }
  sim.step(0.05);
  return { sim, w, f: w.floats[0] };
}

/** Moved and turned (yawed, heeled, trimmed), its voxels stamped there. */
function moveBoat(w, f, { dx = 6, dz = 0, yaw = 0.8, roll = 0.12, pitch = -0.05 } = {}) {
  const b = f.body;
  b.X += dx;
  b.Z += dz;
  b.yaw = yaw;
  b.roll = roll;
  b.pitch = pitch;
  b.pose = framePose(b);
  stampFloat(w, f, true);
}

test('the maths: body frame there and back; a ray against a box', () => {
  const pose = { p: [3, 1, 2], R: framePose({ yaw: 0.7, roll: 0.2, pitch: -0.1, G: [0, 0, 0], X: 3, Y: 1, Z: 2 }).R };
  const l = [0.4, -0.3, 1.1];
  const q = fromBodyLocal(pose, l);
  const back = toBodyLocal(pose, q);
  for (let a = 0; a < 3; a++) assert.ok(Math.abs(back[a] - l[a]) < 1e-9);
  assert.equal(rayBox([0, 0, -5], [0, 0, 1], [0, 0, 0], [1, 1, 1]), 4);
  assert.equal(rayBox([3, 0, -5], [0, 0, 1], [0, 0, 0], [1, 1, 1]), null);
});

test('a click on a moved and turned boat\'s hull maps to the voxel of its planking there (not the berth it left)', () => {
  const { sim, w, f } = boatScene('row');
  const B = f.mb;
  assert.ok(B && B.n > 100, 'its voxels a moving body');
  moveBoat(w, f);
  const pose = boatPose(f);
  // a planking voxel on its starboard side amidships, half way up
  let k0 = -1, best = Infinity;
  for (let k = 0; k < B.n; k++) {
    if (B.tag[k] !== 1 || !B.s.mat[k]) continue;
    const [x, y, z] = [B.local[3 * k], B.local[3 * k + 1], B.local[3 * k + 2]];
    if (z <= 0) continue;
    const d = Math.abs(x) + Math.abs(y - 0.3) - z; // (amidships, 0.3 m up, the outermost)
    if (d < best) {
      best = d;
      k0 = k;
    }
  }
  assert.ok(k0 >= 0);
  const target = worldOf(B, k0, pose);
  const out = [pose.R[2], pose.R[5], pose.R[8]]; // (its starboard)
  const from = target.map((v, a) => v + 4 * out[a]);
  // drawn as render/floats.js draws it, picked as View.pick does (its voxels hidden: no cubes hit)
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  scene.add(root);
  const floats = new FloatRenderer(root);
  floats.setWorld(w);
  root.updateMatrixWorld(true);
  const hit = pickScene(rayFrom(from, target), { world: w, root, voxels: null, drawings: [vehiclePicker({ floats })] });
  assert.ok(hit, 'the hull is hit');
  assert.equal(hit.thing?.kind, 'boat');
  const k = hit.thing.k;
  assert.ok(k >= 0, 'a voxel of its body');
  const dl = Math.hypot(...[0, 1, 2].map((a) => B.local[3 * k + a] - B.local[3 * k0 + a]));
  assert.ok(dl < 0.25, `the voxel under the click (${dl.toFixed(3)} m from the one aimed at)`);
  assert.equal(B.tag[k], 1, 'its planking');
  // that voxel is in the grid where the boat is now, hidden: the hit names that cell
  assert.ok(hit.voxel >= 0 && w.flags[hit.voxel] & F_HIDDEN);
  const c = w.center(...w.coords(hit.voxel));
  assert.ok(Math.hypot(c[0] - hit.point[0], c[1] - hit.point[1], c[2] - hit.point[2]) < 0.3, 'near the click');
  assert.ok(Math.abs(c[0] - f.at[0]) > 3, 'where it is now, not at its berth');
  // its state: the copy in the grid; heated there, the inspector says so
  w.temp[hit.voxel] = 222;
  const st = bodyVoxelState(w, B, k);
  assert.equal(st.cell, hit.voxel);
  assert.equal(Math.round(st.temp), 222);
  const d = describeThing(sim, hit.thing);
  assert.equal(d.title, 'Rowing boat');
  assert.ok(d.voxelRows.some((r) => /222 °C/.test(r)) && d.voxelRows.some((r) => /planking/.test(r)), d.voxelRows.join(' | '));
  for (const re of [/^Moisture/, /^Char/, /^Fuel left/]) assert.ok(d.voxelRows.some((r) => re.test(r)), `${re}: ${d.voxelRows.join(' | ')}`);
});

test('its oars, a clicked crewman (a box round his seat), and an unmoved boat (no body yet) pick too', () => {
  const { sim, w, f } = boatScene('row');
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  scene.add(root);
  const floats = new FloatRenderer(root);
  floats.setWorld(w);
  root.updateMatrixWorld(true);
  const P = vehiclePicker({ floats });
  // the boatman (crew: 1): straight down onto him, the open boat round him
  const seats = sim.world.floats[0].body.loads.filter((L) => L.label === 'person');
  assert.equal(seats.length, 1);
  const top = fromBodyLocal(boatPose(f), [seats[0].p[0], seats[0].p[1] + 0.3, seats[0].p[2]]);
  const hit = pickScene(rayFrom([top[0], top[1] + 3, top[2]], top), { world: w, root, voxels: null, drawings: [P] });
  assert.equal(hit?.thing?.kind, 'person', JSON.stringify(hit?.thing));
  const d = describeThing(sim, hit.thing);
  assert.equal(d.title, 'Boatman');
  // someone of the world in a seat: him, his health
  const man = { health: 64, bleed: 1.2, side: 'red', loadout: 'rifle', weapon: 'rifle', mag: 20, mags: 3, mass: 85, wounds: { armL: true } };
  f.seats[0].who = man;
  const pm = personAt(w, [0, 0, 0], [1, 0, 0]); // (a ray that misses everyone)
  assert.equal(pm, null);
  const s0 = fromBodyLocal(boatPose(f), [f.seats[0].x, f.seats[0].y + 0.2, f.seats[0].z]);
  const ph = personAt(w, [s0[0], s0[1] + 4, s0[2]], [0, -1, 0]);
  assert.equal(ph?.thing.seat, 0);
  const dm = describeThing(sim, ph.thing);
  assert.ok(dm.rows.some((r) => /Health: 64 %/.test(r)) && dm.rows.some((r) => /armL/.test(r)) && dm.rows.some((r) => /at the oars/.test(r)), dm.rows.join(' | '));
  // an oar (laid along the thwarts, or out in the rowlocks): a voxel of the boat
  const m = floats.items[0].m;
  let oar = null;
  m.group.traverse((o) => {
    if (!oar && o.isMesh && o.parent !== m.group && o.geometry?.type === 'CylinderGeometry') oar = o;
  });
  assert.ok(oar, 'an oar drawn');
  {
    const c = new THREE.Vector3();
    oar.getWorldPosition(c);
    const h = P.pick(new THREE.Ray(new THREE.Vector3(c.x, c.y + 5, c.z), new THREE.Vector3(0, -1, 0)), root);
    assert.ok(h && ['boat', 'person'].includes(h.thing.kind));
  }
  // a boat never stepped (no body): its voxels at its berth
  const sim2 = createSimulation({ world: { size: [24, 3, 10], h: 0.1, ground: 'soil' }, objects: [{ type: 'rowBoat', params: { crew: 0 }, x: 6, z: 5, y: 0.9 }] });
  const f2 = sim2.world.floats[0];
  assert.ok(!f2.mb);
  const v = boatVoxelAt(sim2.world, f2, [f2.at[0], f2.at[1] + 0.2, f2.at[2] + 0.6]);
  assert.ok(v && v.cell >= 0 && f2.own.includes(v.cell));
  const d2 = describeThing(sim2, { kind: 'boat', index: 0, k: -1, cell: v.cell });
  assert.ok(d2.rows[0].startsWith('State: at its berth') && /^This voxel/.test(d2.voxelRows[0]), d2.rows.join(' | '));
});

test('boat summaries: state, draft, freeboard, heel / trim, water aboard and inflow, holes, speed, moorings, crew; motor, sail, canoe', () => {
  for (const kind of ['row', 'motor', 'sail', 'canoe']) {
    const { sim, f } = boatScene(kind, { pond: true });
    if (kind === 'row') {
      const b = f.body;
      holeBoat(f, fromBodyLocal(boatPose(f), [0.3, b.hull.keel(0.3) + 0.05, 0.2]), 4e-4);
      sim.step(0.05);
    }
    const k = nearestBodyVoxel(f.mb, [0, 0.2, 0]);
    const d = describeThing(sim, { kind: 'boat', index: 0, k });
    const text = d.rows.join(' | ');
    for (const re of [/State: (afloat|aground|SWAMPED|SUNK)/, /moored|adrift|under way/, /Draft: [\d.]+ m, freeboard/, /Heel: .*trim/, /Water aboard: \d+ kg/, /Holes:/, /Speed:/, /Aboard:/]) assert.ok(re.test(text), `${kind}: ${re} in ${text}`);
    if (kind === 'row') assert.ok(/Holes: 1 \(1 below the waterline\)/.test(text) && /coming in/.test(text), text);
    if (kind === 'motor') assert.ok(/Outboard \(.* kW\): off.*rpm/.test(text) && /Fuel:/.test(text), text);
    if (kind === 'sail') assert.ok(/Sail: sheet/.test(text) && /Apparent wind/.test(text), text);
    if (kind === 'canoe' || kind === 'row') assert.ok(/(Rowing|Paddling):/.test(text), text);
    assert.ok(d.voxelRows.length >= 4, d.voxelRows.join(' | '));
  }
});

/** A street with a car on it (h 0.2 m). */
function street(params = {}) {
  const sim = createSimulation({ world: { size: [40, 5, 12], h: 0.2 }, weather: { ambient: 15, windSpeed: 0 }, objects: [{ type: 'car', params, x: 8, z: 6, rotation: 0 }] });
  const c = initCars(sim.world)[0];
  return { sim, w: sim.world, c };
}

test('a click on a moving car\'s door maps to a voxel of the car there; summaries for the car and its driver', () => {
  const { sim, w, c } = street();
  const me = { player: true, mass: 85 };
  boardCar(c, me, 0);
  c.player = true;
  startEngine(c);
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  scene.add(root);
  const cars = new CarRenderer(root, { assets: null });
  cars.A = null;
  cars.assets = () => null; // (no figures drawn in a test)
  cars.setWorld(w);
  for (let t = 0; t < 3.2; t += 1 / 30) {
    c.input = { ...pedals(c, t > 1 ? 0.5 : 0, 0), steer: t > 1.8 ? 0.6 : 0 };
    sim.step(1 / 30);
    cars.update(1 / 30);
  }
  assert.ok(c.body?.hidden && cars.items.has(c), 'on the move: drawn by its mesh, its voxels hidden');
  assert.ok(Math.abs(c.yaw) > 0.05, `turned (${c.yaw.toFixed(2)})`);
  root.updateMatrixWorld(true);
  const pose = carPose(c);
  const S = c.spec;
  // the driver's door: his side (−z), at the height of the door panel, in the middle of it
  const door = fromBodyLocal(pose, [0.2 * S.L - 0.75, 0.6, -S.W / 2]);
  const from = fromBodyLocal(pose, [0.2 * S.L - 0.75, 0.6, -S.W / 2 - 4]);
  const hit = pickScene(rayFrom(from, door), { world: w, root, voxels: null, drawings: [vehiclePicker({ cars })] });
  assert.equal(hit?.thing?.kind, 'car', JSON.stringify(hit?.thing));
  const k = hit.thing.k;
  assert.ok(k >= 0, 'a voxel of its body');
  const l = [0, 1, 2].map((a) => c.body.local[3 * k + a]);
  assert.ok(l[2] < -S.W / 2 + 0.45 && Math.abs(l[0] - (0.2 * S.L - 0.75)) < 0.6 && l[1] > 0.2 && l[1] < 1.1, `on the driver's side, at the door (${l.map((v) => v.toFixed(2))})`);
  // the hit point in the body frame lies by that voxel
  const lh = toBodyLocal(pose, hit.point);
  assert.ok(Math.hypot(lh[0] - l[0], lh[1] - l[1], lh[2] - l[2]) < 0.35);
  if (hit.voxel >= 0) assert.equal(w.owner[hit.voxel], c.owner);
  const d = describeThing(sim, hit.thing);
  const text = d.rows.join(' | ');
  for (const re of [/Powertrain: petrol.*drive: rwd/, /Speed: [\d.]+ km\/h; gear \S+ \(mode D\), \d+ rpm/, /Fuel: [\d.]+ of \d+ l/, /Engine: running/, /Damage:/, /Fire: not burning/, /Ground: .*grip μ/, /In it: You \(Driver\)/]) assert.ok(re.test(text), `${re} in ${text}`);
  assert.ok(/on the move/.test(d.sub));
  for (const re of [/^This voxel/, /^Temperature/, /^Moisture/, /^Char/]) assert.ok(d.voxelRows.some((r) => re.test(r)), d.voxelRows.join(' | '));
  // the driver, through the window from above (the roof is in the way: from the side, through the glass)
  const head = fromBodyLocal(pose, [0.2 * S.L - 0.75, 1.1, -0.35]);
  const ph = personAt(w, fromBodyLocal(pose, [0.2 * S.L - 0.75, 1.1, -5]), [head[0] - fromBodyLocal(pose, [0.2 * S.L - 0.75, 1.1, -5])[0], 0, head[2] - fromBodyLocal(pose, [0.2 * S.L - 0.75, 1.1, -5])[2]].map((v, a, arr) => v / Math.hypot(arr[0], arr[2])));
  assert.equal(ph?.thing.vehicle, 'car');
  assert.equal(ph.thing.seat, 0);
  const dp = describeThing(sim, ph.thing);
  assert.equal(dp.title, 'You');
  assert.ok(dp.rows.some((r) => /Driver.*in charge/.test(r)), dp.rows.join(' | '));
});

test('a parked car drawn as voxels and an EV: the car as a whole, its pack, from a voxel clicked as itself', () => {
  const { sim, w, c } = street({ powertrain: 'electric' });
  // never moved: its voxels as built; one of them clicked as a voxel (main.js: vehicleOfVoxel)
  if (w.listDirty) w.rebuildLists();
  let i = -1;
  for (let q = 0; q < w.solidCount; q++) if (w.owner[w.solids[q]] === c.owner) i = w.solids[q];
  assert.ok(i >= 0);
  const t = vehicleOfVoxel(w, i);
  assert.equal(t?.kind, 'car');
  let d = describeThing(sim, t);
  assert.ok(/parked/.test(d.sub) && d.rows.some((r) => /^Powertrain: electric/.test(r)) && d.rows.some((r) => /^Battery: \d+ % of 60 kWh, range/.test(r)), d.rows.join(' | '));
  assert.ok(d.voxelRows.some((r) => /^This voxel/.test(r)));
  // in it: its body, the pack's cells counted
  boardCar(c, { player: true, mass: 85 }, 0);
  assert.ok(c.body);
  const cell = [...c.body.cells].find((q) => c.body.region[c.body.cellK[[...c.body.cellList.subarray(0, c.body.nCells)].indexOf(q)]] === 'battery');
  assert.ok(cell !== undefined, 'a cell of its pack');
  w.temp[cell] = 400;
  w.fuel[cell] = 0.6; // (in runaway)
  d = describeThing(sim, vehicleOfVoxel(w, [...c.body.cells][0]));
  assert.ok(d.rows.some((r) => /^Pack: \d+ cells, 1 in thermal runaway, \d+ gone or spent, hottest 400 °C/.test(r)), d.rows.join(' | '));
  // not a car's voxel: nothing
  let other = -1;
  for (let q = 0; q < w.solidCount; q++) if (w.owner[w.solids[q]] !== c.owner && w.mat[w.solids[q]] !== MAT.air) other = w.solids[q];
  assert.equal(vehicleOfVoxel(w, other), null);
});
