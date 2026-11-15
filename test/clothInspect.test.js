import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSimulation } from '../src/sim/createSimulation.js';
import { MAT } from '../src/sim/materials.js';
import { F_HIDDEN } from '../src/sim/world.js';
import { VoxelRenderer } from '../src/render/voxels.js';
import { StatueDrawing, swayZ } from '../src/render/statue.js';
import { buildLaundry } from '../src/render/laundry.js';
import { pickScene } from '../src/render/pick.js';
import { TreeRenderer } from '../src/render/trees.js';
import { describeCloth, clothRows, clothPieces, toLocal } from '../src/sim/cloth.js';

// The wash on the line is voxels of cotton / polyester, hidden: render/laundry.js draws the cloth
// over them. A click is raycast by render/pick.js (View.pick): the drawn cloth too, mapped back
// to its voxel and its garment (sim/cloth.js), which the inspector describes as a whole.

/** A washing line on its own (turned 30°: the pick must follow the heading), drawn as the app draws it. */
function setup() {
  const sim = createSimulation({
    name: 'line',
    world: { size: [7, 3, 6], h: 0.05 },
    objects: [{ type: 'clothesline', params: { length: 5, height: 1.9, wet: 0, sparkAfter: 0 }, x: 3.5, z: 3, rotation: 30 }],
    noFire: true,
  });
  const w = sim.world;
  const root = new THREE.Scene();
  const voxels = new VoxelRenderer(root);
  voxels.setWorld(w);
  voxels.update(0);
  const pr = w.props.find((p) => p.procedural === 'laundry');
  const g = new THREE.Group();
  g.position.set(...pr.p);
  g.rotation.y = pr.heading ?? 0;
  root.add(g);
  const drawing = new StatueDrawing(pr, w, g);
  drawing.build(buildLaundry(pr));
  root.updateMatrixWorld(true);
  return { sim, w, root, voxels, pr, drawing };
}

/** A camera `back` m in front of the point (prop frame, along its z) looking at it: the ray of a click there. */
function rayAt(env, local, back = 4) {
  const { pr } = env;
  const toWorld = (l) => new THREE.Vector3(...l).applyAxisAngle(new THREE.Vector3(0, 1, 0), pr.heading ?? 0).add(new THREE.Vector3(...pr.p));
  const target = toWorld(local);
  const cam = new THREE.PerspectiveCamera(50, 1.5, 0.05, 100);
  cam.position.copy(toWorld([local[0], local[1] + 0.3, local[2] + back]));
  cam.lookAt(target);
  cam.updateMatrixWorld(true);
  const rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2(0, 0), cam);
  return rc;
}

const pick = (env, rc) => pickScene(rc, { world: env.w, root: env.root, voxels: env.voxels, drawings: [env.drawing] });

test('clicking the wash on the line finds its garment, cold and while it burns; other voxels still pick', () => {
  const env = setup();
  const { sim, w, pr, drawing } = env;
  const top = pr.line.H - 0.01;
  // the garment the test clicks: the towel (second on the line), half way down
  const towel = pr.wash.findIndex((g) => g.kind === 'towel');
  const tw = pr.wash[towel];
  const at = (f) => [tw.x0 + tw.w / 2, top - tw.drop * f, 0];

  // the cloth's voxels are hidden: the voxel cubes alone do not have them (the old pick saw the lawn behind)
  const rc = rayAt(env, at(0.5));
  const behind = rc.intersectObject(env.voxels.mesh, false)[0];
  assert.ok(!behind || !(w.flags[env.voxels.voxelOfInstance(behind.instanceId)] & F_HIDDEN));

  // the click (the same function as View.pick) hits the drawn towel, and names it
  const hit = pick(env, rc);
  assert.ok(hit, 'a hit');
  assert.ok(hit.cloth, 'on the cloth');
  assert.equal(hit.cloth.piece, towel);
  assert.equal(w.mat[hit.voxel], MAT.cotton);
  assert.ok(clothPieces(w, pr).pieces[towel].voxels.includes(hit.voxel), 'its voxel is one of the towel');
  const cold = describeCloth(w, pr, towel);
  assert.equal(cold.kind, 'towel');
  assert.match(cold.material, /Cotton/);
  assert.ok(cold.voxels > 50 && cold.inPlace === cold.voxels, `voxels ${cold.inPlace}/${cold.voxels}`);
  assert.ok(cold.mass0 > 0.05 && cold.mass0 < 2, `dry mass ${cold.mass0} kg`);
  assert.ok(cold.temperature < 30 && cold.burnt < 0.01 && !cold.burning, JSON.stringify(cold));
  assert.ok(cold.pins > 0 && cold.pinned === cold.pins, 'pegged');
  const rows = clothRows(cold);
  assert.match(rows[0], /Towel/);
  assert.ok(rows.some((r) => /Pegged/.test(r)) && rows.some((r) => /Temperature/.test(r)));

  // every garment on the line is found where it hangs (the sheet, the shirts' bodies, the socks)
  pr.wash.forEach((g, k) => {
    const h = pick(env, rayAt(env, [g.x0 + g.w / 2, top - Math.min(0.2, g.drop * 0.4), 0]));
    assert.equal(h?.cloth?.piece, k, `${g.kind} ${k}`);
  });

  // in a breeze the drawn cloth swings out of its plane (up to ~0.2 m at the hem): the pick follows it
  // (the sheet, the longest: at its hem it swings furthest)
  const sheet = pr.wash.findIndex((g) => g.kind === 'sheet');
  const sg = pr.wash[sheet];
  const hem = [sg.x0 + sg.w / 2, top - sg.drop * 0.92, 0];
  const still = pick(env, rayAt(env, hem));
  let t = 0;
  for (let s = 0; s < 8; s += 0.05) if (Math.abs(swayZ(pr.line.H, hem[0], hem[1], s)) > Math.abs(swayZ(pr.line.H, hem[0], hem[1], t))) t = s;
  const off = swayZ(pr.line.H, hem[0], hem[1], t);
  assert.ok(Math.abs(off) > 0.07, `sway ${off}`);
  drawing.uniforms.uTime.value = t;
  const swung = pick(env, rayAt(env, hem));
  assert.equal(swung?.cloth?.piece, sheet);
  // (hit where it is drawn now: moved out by the change in its sway since time 0)
  const dz = toLocal(pr, swung.point)[2] - toLocal(pr, still.point)[2];
  const moved = off - swayZ(pr.line.H, hem[0], hem[1], 0);
  assert.ok(Math.abs(moved) > 0.1, `moved ${moved}`);
  assert.ok(Math.abs(dz - moved) < 0.02, `hit ${dz.toFixed(3)} m further out, swung ${moved.toFixed(3)}`);
  drawing.uniforms.uTime.value = 0;

  // set the towel alight at its hem: it heats, burns, chars and goes
  sim.ignite(new THREE.Vector3(...at(0.95)).applyAxisAngle(new THREE.Vector3(0, 1, 0), pr.heading).add(new THREE.Vector3(...pr.p)).toArray(), 0.12);
  let peakT = cold.temperature;
  let sawBurning = false;
  let last = cold;
  for (let k = 0; k < 400 && last.burnt < 0.3; k++) {
    sim.step(sim.dt);
    drawing.refresh();
    if (k % 10) continue;
    // clicked again (up at the pegs, which go last), the towel as it is now
    const h = pick(env, rayAt(env, at(0.1)));
    assert.equal(h?.cloth?.piece, towel, `still the towel at ${w.time.toFixed(1)} s`);
    last = describeCloth(w, pr, h.cloth.piece);
    peakT = Math.max(peakT, last.maxTemperature ?? 0);
    if (last.burning > 0) {
      sawBurning = true;
      assert.ok(last.heatRelease > 0, 'burning: it releases heat');
      assert.ok(clothRows(last).some((r) => /burning/.test(r)));
    }
  }
  assert.ok(sawBurning, 'seen burning');
  assert.ok(peakT > 250, `hottest ${peakT.toFixed(0)} °C`);
  assert.ok(last.burnt > cold.burnt + 0.05, `burnt ${last.burnt}`);
  if (process.env.CLOTH_DEBUG) console.log([...clothRows(cold), '---', ...clothRows(last), `${w.time.toFixed(1)} s`].join('\n'));
  assert.ok(last.char > 0 || last.ashed > 0, 'charred');

  // and a voxel drawn as itself (a post of the line) is still picked as before
  const post = [-pr.line.L / 2, 1.0, 0];
  const ph = pick(env, rayAt(env, post));
  assert.ok(ph && !ph.cloth, 'the post');
  assert.equal(w.mat[ph.voxel], MAT.wood);
});

// trees are drawn the same way (bark segments and leaf cards over hidden voxels, render/trees.js):
// a click on the crown used to find nothing; it finds a leaf voxel now
test('clicking a tree crown finds its leaves', () => {
  const sim = createSimulation({ name: 'tree', world: { size: [10, 8, 10], h: 0.1 }, objects: [{ type: 'tree', params: { height: 6, crownRadius: 2 }, x: 5, z: 5 }], noFire: true });
  const w = sim.world;
  const root = new THREE.Scene();
  const voxels = new VoxelRenderer(root);
  const trees = new TreeRenderer(root);
  trees.setWorld(w); // (hides its voxels: they are drawn as bark and leaves)
  voxels.setWorld(w);
  voxels.update(0);
  trees.update(0, [5, 3, 15]);
  root.updateMatrixWorld(true);
  const rc = new THREE.Raycaster(new THREE.Vector3(5.05, 4.2, 15), new THREE.Vector3(0, 0, -1));
  assert.equal(rc.intersectObject(voxels.mesh, false).length, 0, 'the voxel cubes have no crown');
  const h = pickScene(rc, { world: w, root, voxels, trees });
  assert.ok(h, 'a hit');
  assert.equal(w.mat[h.voxel], MAT.leaves);
  assert.ok(sim.describe(h.voxel).material, 'and the inspector describes it');
});
