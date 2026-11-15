import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SCENARIOS } from '../src/scenarios.js';
import { buildScene } from '../src/models/voxelizer.js';
import { createSimulation } from '../src/sim/createSimulation.js';
import { MAT, MATERIALS } from '../src/sim/materials.js';
import { F_HIDDEN, F_BURNING } from '../src/sim/world.js';
import { toggleDoor } from '../src/sim/doors.js';
import { pickScene } from '../src/render/pick.js';
import { raycastDrawn, nearestVoxel, nearestOf } from '../src/render/pickThings.js';
import { ChurchDrawing } from '../src/render/church.js';
import { TorchRenderer } from '../src/render/torches.js';
import { DoorRenderer } from '../src/render/doors.js';
import { VolcanoRenderer } from '../src/render/volcano.js';
import { campPowerDrawing } from '../src/render/campPower.js';
import { buildCarrierHull } from '../src/render/hull.js';
import { pickObject } from '../src/render/pickThings.js';
import { describeThing, churchPartLabel, voxelSummary } from '../src/sim/inspectThings.js';

// What the inspector could not click: things drawn by meshes of their own over hidden voxels
// (the church's timber and glass, torches, doors, the volcano's cone, the turbine's tower) or
// not voxels at all (the turbine's rotor, an open door, a torch's flame, the carrier's hull).
// render/pick.js now raycasts them as drawn and maps the hit to the voxel there and the thing;
// sim/inspectThings.js says what the thing is doing. All without WebGL, as View.pick does it.

/** A raycaster from `from` towards `to` (world frame). */
function rayFrom(from, to) {
  const rc = new THREE.Raycaster();
  const o = new THREE.Vector3(...from);
  rc.set(o, new THREE.Vector3(...to).sub(o).normalize());
  return rc;
}

/** The view's root (the sim frame) in a scene, its matrices up to date. */
function rootScene() {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  scene.add(root);
  return { scene, root };
}

// ---------------------------------------------------------------- the helpers

test('pick helpers: drawn meshes only (no sprites, light shafts or hidden parents); the nearest hidden voxel', () => {
  const { root } = rootScene();
  const g = new THREE.Group();
  root.add(g);
  const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  box.position.set(0, 0, 0);
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  shaft.position.set(0, 0, 2);
  shaft.userData.noShadow = true;
  g.add(box, shaft, new THREE.Sprite(new THREE.SpriteMaterial()));
  root.updateMatrixWorld(true);
  const ray = new THREE.Ray(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1));
  const h = raycastDrawn(ray, g);
  assert.ok(h && Math.abs(h.distance - 4.5) < 1e-6, 'through the light shaft to the box (and no sprite raycast without a camera)');
  assert.ok(h.normal.z > 0.99, 'the normal faces the ray');
  g.visible = false;
  assert.equal(raycastDrawn(ray, g), null, 'not drawn: not picked');

  const sim = createSimulation({ name: 't', world: { size: [2, 2, 2], h: 0.1 }, objects: [], noFire: true });
  const w = sim.world;
  const a = w.idx(5, 5, 5);
  const b = w.idx(7, 5, 5);
  w.setVoxel(a, MAT.wood);
  w.setVoxel(b, MAT.wood);
  w.flags[b] |= F_HIDDEN;
  assert.equal(nearestVoxel(w, [0.55, 0.55, 0.55], 0.4), b, 'hidden voxels only, by default');
  assert.equal(nearestVoxel(w, [0.55, 0.55, 0.55], 0.4, (i) => w.mat[i]), a);
  assert.equal(nearestVoxel(w, [0.55, 0.55, 0.55], 0.05), -1);
  assert.equal(nearestOf(w, [a, b], [0.8, 0.5, 0.5]), b);
});

// ---------------------------------------------------------------- the island: church, torches, door, volcano

const zone = SCENARIOS.fantasy.zones.island;
let island = null;
const islandWorld = () => (island ??= buildScene({ world: zone.world, objects: zone.objects, weather: SCENARIOS.fantasy.weather }).world);

/** The church drawn as render/props.js draws it, under a root. */
function church() {
  const world = islandWorld();
  const pr = world.props.find((p) => p.type === 'church');
  const { root } = rootScene();
  const d = new ChurchDrawing(pr.spec, world, pr, new THREE.Vector3(...zone.view.sun), { intensity: 2.4 });
  d.group.position.set(...pr.p);
  d.group.rotation.y = pr.heading ?? 0;
  root.add(d.group);
  root.updateMatrixWorld(true);
  const toWorld = (l) => new THREE.Vector3(...l).applyAxisAngle(new THREE.Vector3(0, 1, 0), pr.heading ?? 0).add(new THREE.Vector3(...pr.p));
  return { world, pr, root, d, toWorld };
}

test('church: a click on the stained glass finds its glass voxel and the window; on timber, its wood and the part', () => {
  const { world, pr, root, d, toWorld } = church();
  const sim = { world };
  // a glazed window, from outside, at one of its lights
  const win = pr.spec.windows.find((w) => w.glass && w.kind !== 'rose');
  const n = new THREE.Vector3(win.n[0], 0, win.n[2]).normalize();
  const u = new THREE.Vector3(n.z, 0, -n.x);
  let hit = null;
  for (const off of [0.25, -0.25, 0.15, -0.15, 0]) {
    const c = new THREE.Vector3(win.o[0], win.y0 + (win.top - win.y0) * 0.4, win.o[2]).addScaledVector(u, off * win.w);
    const out = c.clone().addScaledVector(n, 6);
    hit = pickScene(rayFrom(toWorld(out.toArray()).toArray(), toWorld(c.toArray()).toArray()), { world, root, drawings: [d] });
    if (hit?.thing?.glass) break;
  }
  assert.ok(hit, 'the glass is hit');
  assert.equal(hit.thing.kind, 'churchPart');
  assert.equal(hit.thing.glass, true);
  assert.equal(world.mat[hit.voxel], MAT.glass, 'its voxel is glass');
  assert.ok(world.flags[hit.voxel] & F_HIDDEN);
  const desc = describeThing(sim, hit.thing);
  assert.match(desc.title, /window/i);
  assert.match(desc.rows.join(' '), /Glass: intact/);
  // broken: most of its voxels gone
  const saved = hit.thing.voxels.map((i) => world.mat[i]);
  hit.thing.voxels.forEach((i, k) => k % 4 !== 0 && (world.mat[i] = 0));
  assert.match(describeThing(sim, hit.thing).rows.join(' '), /Glass: broken out/);
  hit.thing.voxels.forEach((i, k) => (world.mat[i] = saved[k]));

  // timber: a beam of the scaffolding / tower frame, from the side
  let th = null;
  for (const b of pr.spec.beams.filter((b) => b.mat !== 'iron')) {
    const p = d.parts.get(b.part);
    if (!p?.n0) continue;
    const mid = b.a.map((v, k) => (v + b.b[k]) / 2);
    const dir = new THREE.Vector3(...b.b).sub(new THREE.Vector3(...b.a)).normalize();
    const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0));
    if (side.lengthSq() < 1e-3) side.set(1, 0, 0);
    side.normalize();
    const from = new THREE.Vector3(...mid).addScaledVector(side, 2);
    const h = pickScene(rayFrom(toWorld(from.toArray()).toArray(), toWorld(mid).toArray()), { world, root, drawings: [d] });
    if (h?.thing?.kind === 'churchPart' && !h.thing.glass && h.voxel >= 0) {
      th = h;
      break;
    }
  }
  assert.ok(th, 'a beam is hit');
  assert.equal(MATERIALS[world.mat[th.voxel]].name, 'wood', 'its voxel is wood');
  const td = describeThing(sim, th.thing);
  assert.match(td.rows.join(' '), /Material: Wood/);
  assert.match(td.rows.join(' '), /State: sound/);
  // burning
  for (const i of th.thing.voxels) world.flags[i] |= F_BURNING;
  assert.match(describeThing(sim, th.thing).rows.join(' '), /burning/);
  for (const i of th.thing.voxels) world.flags[i] &= ~F_BURNING;
  assert.equal(churchPartLabel('pew1-1', false), 'Pew');
  assert.equal(churchPartLabel('rose-1', true), 'Rose window');
});

test('torches: a click on a wall torch or its flame is the torch (lit, out, short of air), its head the voxel there', () => {
  const world = islandWorld();
  const { root } = rootScene();
  const tr = new TorchRenderer(root);
  tr.setWorld(world);
  tr.update(0);
  root.updateMatrixWorld(true);
  const ht = world.heaters.find((h) => h.label === 'torch' && h.light);
  assert.ok(ht, 'a torch on the island');
  const it = tr.items.get(ht);
  assert.ok(it, 'drawn');
  // at the flame, from in front of it (the side away from the wall)
  const facing = new THREE.Vector3(1, 0, 0).applyQuaternion(it.obj.quaternion);
  const at = [ht.pos[0], ht.pos[1] + 0.1, ht.pos[2]];
  const from = new THREE.Vector3(...at).addScaledVector(facing, 3).toArray();
  const hit = pickScene(rayFrom(from, at), { world, root, drawings: [tr] });
  assert.ok(hit, 'the torch is hit');
  assert.equal(hit.thing.kind, 'torch');
  assert.equal(hit.thing.heater, ht);
  const sim = { world };
  assert.match(describeThing(sim, hit.thing).rows[0], /Flame: lit/);
  // its head: a little under the flame, a hidden wood voxel
  const headAt = [ht.pos[0], ht.pos[1] - 0.1, ht.pos[2]];
  const hh = pickScene(rayFrom(new THREE.Vector3(...headAt).addScaledVector(facing, 3).toArray(), headAt), { world, root, drawings: [tr] });
  assert.ok(hh?.thing?.kind === 'torch');
  assert.ok(hh.voxel >= 0 && world.flags[hh.voxel] & F_HIDDEN, 'its head or handle: a hidden voxel');
  assert.match(describeThing(sim, hh.thing).rows.join(' '), /Head and handle: Wood/);
  // the air round it gone bad, then put out
  const a = world.airIdx(Math.floor(ht.pos[0] / world.ah), Math.floor((ht.pos[1] + 0.2) / world.ah), Math.floor(ht.pos[2] / world.ah));
  const o2 = world.o2[a];
  world.o2[a] = 0.1;
  assert.match(describeThing(sim, hit.thing).rows[0], /smothered/);
  world.o2[a] = o2;
  ht.on = false;
  assert.match(describeThing(sim, hit.thing).rows[0], /Flame: out/);
  ht.on = true;
});

test('doors: a click on a shut door is its voxel and the door; swung open it is the door alone; locked, damaged', () => {
  const world = islandWorld();
  const { root } = rootScene();
  const dr = new DoorRenderer(root);
  dr.setWorld(world);
  root.updateMatrixWorld(true);
  const k = world.doors.findIndex((d) => d.name === 'west portal');
  assert.ok(k >= 0, 'the church portal is a door');
  const d = world.doors[k];
  const it = dr.items.find((x) => x.k === k);
  // from the thin side (its normal), a metre off
  const box = new THREE.Box3().setFromObject(it.pivot);
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const nrm = size.x < size.z ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  // (which side is outside does not matter: try both)
  let hit = null;
  for (const s of [1, -1]) {
    hit = pickScene(rayFrom(c.clone().addScaledVector(nrm, s * 1.5).toArray(), c.toArray()), { world, root, drawings: [dr] });
    if (hit) break;
  }
  assert.ok(hit, 'the door is hit');
  assert.deepEqual(hit.thing, { kind: 'door', k });
  assert.ok(d.voxels.includes(hit.voxel), 'its voxel is one of the door');
  const sim = { world, describeThing };
  let desc = describeThing(sim, hit.thing);
  assert.match(desc.title, /west portal/);
  assert.match(desc.rows[0], /State: shut, unlocked/);
  assert.match(desc.rows.join(' '), /Material: Wood/);
  // opened (sim/doors.js takes its voxels out): swung open it is still the door, with no voxel
  const fake = { world };
  toggleDoor(fake, k, true);
  for (let n = 0; n < 60; n++) dr.update(0.05);
  root.updateMatrixWorld(true);
  const leaf = new THREE.Box3().setFromObject(it.leaf).getCenter(new THREE.Vector3());
  const side = size.x < size.z ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0); // it swung round: now thin across the old wide axis
  let open = null;
  for (const s of [1, -1]) {
    for (const a of [side, nrm]) {
      open = pickScene(rayFrom(leaf.clone().addScaledVector(a, s * 1.5).toArray(), leaf.toArray()), { world, root, drawings: [dr] });
      if (open) break;
    }
    if (open) break;
  }
  assert.ok(open, 'the open leaf is hit');
  assert.equal(open.thing.kind, 'door');
  assert.equal(open.voxel, -1, 'open: its voxels are out of the grid');
  desc = describeThing(sim, open.thing);
  assert.match(desc.rows[0], /State: open/);
  assert.match(desc.rows.join(' '), /Material: Wood/, 'what it is made of, from the voxels kept aside');
  toggleDoor(fake, k, false);
  // locked, damaged
  d.locked = true;
  d.key = 'sexton';
  const gone = d.voxels.slice(0, Math.ceil(d.voxels.length * 0.4));
  const m0 = gone.map((i) => world.mat[i]);
  for (const i of gone) world.mat[i] = 0;
  desc = describeThing(sim, { kind: 'door', k });
  assert.match(desc.rows[0], /locked \(key: sexton\)/);
  assert.match(desc.rows.join(' '), /Damage: 4\d %/);
  gone.forEach((i, j) => (world.mat[i] = m0[j]));
  d.locked = false;
  delete d.key;
});

test('volcano: a click on the cone is its rock and the volcano: asleep, then erupting with hot lava in the crater', () => {
  const world = islandWorld();
  const { root } = rootScene();
  const vr = new VolcanoRenderer(root);
  vr.setWorld(world);
  root.updateMatrixWorld(true);
  const v = world.volcanoes[0];
  assert.ok(v, 'a volcano on the island');
  // half way down a flank, from the side and above
  const s = v.shape;
  const x = s.base[0] + s.radius * 0.5;
  const z = s.base[2];
  const y = VolcanoRenderer.surface(s, world.h, x, z);
  const hit = pickScene(rayFrom([x + 6, y + 4, z], [x, y, z]), { world, root, drawings: [vr] });
  assert.ok(hit, 'the cone is hit');
  assert.deepEqual(hit.thing, { kind: 'volcano', index: 0 });
  assert.ok(hit.voxel >= 0 && world.mat[hit.voxel], 'the rock under the surface');
  const sim = { world };
  let desc = describeThing(sim, hit.thing);
  assert.match(desc.rows[0], /dormant/);
  assert.match(desc.rows.join(' '), /none \(cold rock\)/);
  // erupting: lava in the vent
  const st = { state: v.state, t: v.t };
  v.state = 'erupting';
  v.t = 10;
  v.duration ??= 120;
  const h = world.h;
  const lava = [];
  const cx = Math.floor(v.crater[0] / h);
  const cz = Math.floor(v.crater[2] / h);
  for (let y = Math.floor(v.crater[1] / h); lava.length < 4 && y < world.ny; y++) {
    const i = world.idx(cx, y, cz);
    if (world.mat[i]) continue;
    world.setVoxel(i, MAT.basalt, { temp: 1200 });
    lava.push(i);
  }
  desc = describeThing(sim, hit.thing);
  assert.match(desc.rows[0], /ERUPTING/);
  assert.match(desc.rows.join(' '), /Lava in the crater: \d+ voxels hot.*1200 °C hottest/);
  for (const i of lava) world.clearVoxel(i);
  Object.assign(v, st);
});

// ---------------------------------------------------------------- the camp's wind turbine

test('wind turbine: its rotor (drawn only) and its tower (hidden voxels) are the turbine: state, rpm, power', () => {
  const sim = createSimulation({ world: { size: [20, 22, 20], h: 0.5 }, weather: { windSpeed: 7, windDir: 90, ambient: 15 }, objects: [{ type: 'windTurbine', params: {}, x: 10, z: 10 }], noFire: true });
  const w = sim.world;
  for (let k = 0; k < 120; k++) sim.step(0.25);
  const pr = w.props.find((p) => p.type === 'windTurbine');
  const { root } = rootScene();
  const d = campPowerDrawing(pr, w);
  d.group.position.set(...pr.p);
  d.group.rotation.y = pr.heading ?? 0;
  root.add(d.group);
  d.update(0.1);
  root.updateMatrixWorld(true);
  // the tower, low down
  const tower = pickScene(rayFrom([pr.p[0] + 6, 3, pr.p[2]], [pr.p[0], 3, pr.p[2]]), { world: w, root, drawings: [d] });
  assert.ok(tower, 'the tower is hit');
  assert.equal(tower.thing.kind, 'generator');
  assert.ok(tower.voxel >= 0 && MATERIALS[w.mat[tower.voxel]].name === 'steel', 'its tower: a hidden steel voxel');
  // the nacelle and the rotor, from far up the wind (the rotor faces it)
  const hub = [pr.p[0], pr.hub, pr.p[2]];
  const hits = [];
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const h = pickScene(rayFrom([hub[0] + dx * 15, hub[1] + 0.3, hub[2] + dz * 15], hub), { world: w, root, drawings: [d] });
    if (h) hits.push(h);
  }
  assert.ok(hits.length >= 3 && hits.every((h) => h.thing.kind === 'generator'));
  const desc = describeThing(sim, tower.thing);
  assert.equal(desc.title, 'Wind turbine');
  const text = desc.rows.join(' | ');
  assert.match(text, /State: running/);
  assert.match(text, /Rotor: \d+(\.\d)? rpm/);
  const g = w.generators.find((q) => q.kind === 'wind');
  const rpm = (g.omega * 60) / (2 * Math.PI);
  assert.ok(rpm > 5, `it turns (${rpm.toFixed(1)} rpm)`);
  assert.match(text, /Output: \d+(\.\d)? kW of 30\.0 kW rated/);
  assert.match(text, /Grid: makes/);
});

// ---------------------------------------------------------------- the carrier's hull

test('carrier: the hull (drawn only) is the ship: draft, list, trim, water aboard, foundering', () => {
  const { root } = rootScene();
  const pr = { type: 'carrierHull', p: [20, 0, 10], hx: 15, hz: 8, D: 12, draft: 7, number: '68' };
  const o = buildCarrierHull(pr);
  o.position.set(...pr.p);
  root.add(o);
  root.updateMatrixWorld(true);
  const drawing = { pick: (ray) => pickObject(ray, o, null, null, { kind: 'carrier' }) };
  // its side, below the deck edge, from abeam
  const hit = pickScene(rayFrom([20, 5, 60], [20, 5, 10]), { world: null, root, drawings: [drawing] });
  assert.ok(hit, 'the hull is hit');
  assert.equal(hit.voxel, -1);
  assert.deepEqual(hit.thing, { kind: 'carrier' });
  assert.ok(Math.abs(hit.point[2] - (10 + 8)) < 1.5, `on its side (z ${hit.point[2].toFixed(2)})`);
  // a voxel at the same distance wins: the drawn hull stands back a centimetre
  const vox = { pick: () => ({ distance: hit.distance, point: new THREE.Vector3(20, 5, 18), normal: new THREE.Vector3(0, 0, 1), voxel: 7 }) };
  assert.equal(pickScene(rayFrom([20, 5, 60], [20, 5, 10]), { world: null, root, drawings: [drawing, vox] }).voxel, 7);

  const sim = {
    dt: 0.05,
    stats: { flooding: 2 },
    world: { h: 0.1, sea: { ship: { draft: 11.6, draft0: 11.3, heelDeg: -1.5, trimDeg: 0.4, water: 350000, GM: 2.1, displacement: 1e8, foundering: false } } },
  };
  const desc = describeThing(sim, hit.thing);
  assert.equal(desc.title, 'Aircraft carrier');
  const t = desc.rows.join(' | ');
  assert.match(t, /Draft: 11\.60 m \(\+30 cm from at rest\)/);
  assert.match(t, /List: 1\.50° to port/);
  assert.match(t, /Trim: 0\.40° by the bow/);
  assert.match(t, /Water aboard: 350\.0 t/);
  assert.match(t, /Sea coming in: 0\.04 m³\/s/);
  assert.match(t, /Afloat/);
  sim.world.sea.ship.foundering = true;
  assert.match(describeThing(sim, hit.thing).rows.join(' '), /FOUNDERING/);
});

test('voxelSummary: what is left of a set of voxels, charred, hot, burning', () => {
  const sim = createSimulation({ name: 't', world: { size: [1, 1, 1], h: 0.1 }, objects: [], noFire: true });
  const w = sim.world;
  const list = [0, 1, 2, 3].map((x) => w.idx(x, 0, 0));
  for (const i of list) w.setVoxel(i, MAT.wood, { temp: 20 });
  w.temp[list[0]] = 400;
  w.char[list[1]] = 1;
  w.flags[list[0]] |= F_BURNING;
  w.clearVoxel(list[3]);
  const s = voxelSummary(w, list);
  assert.equal(s.left, 3);
  assert.equal(s.burning, 1);
  assert.ok(Math.abs(s.char - 1 / 3) < 1e-6);
  assert.equal(s.maxT >= 400, true);
  assert.equal(s.material.length, 1);
  assert.match(s.material[0], /^Wood/);
});
