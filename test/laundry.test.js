import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSimulation } from '../src/sim/createSimulation.js';
import { SCENARIOS, cloneScene } from '../src/scenarios.js';
import { MAT } from '../src/sim/materials.js';
import { F_BURNING, F_HIDDEN } from '../src/sim/world.js';
import { StatueDrawing } from '../src/render/statue.js';
import { buildLaundry } from '../src/render/laundry.js';

// the washing line in the garden by the lake house (a place of the carrier's world): the wash on the line catches from the barbecue's spark, burns with flame,
// chars and burns away; the drawn cloth (render/statue.js over render/laundry.js) loses it
test('laundry on the line catches, burns and is gone within two minutes; the drawn cloth gets holes', { timeout: 20 * 60 * 1000 }, () => {
  const sim = createSimulation({ ...cloneScene(SCENARIOS.carrier), zone: 'garden' });
  const w = sim.world;
  const cloth = new Set([MAT.cotton, MAT.polyester]);
  const ids = [];
  for (let k = 0; k < w.solidCount; k++) if (cloth.has(w.mat[w.solids[k]])) ids.push(w.solids[k]);
  assert.ok(ids.length > 1000, `cloth voxels ${ids.length}`);
  assert.ok(ids.every((i) => w.flags[i] & F_HIDDEN), 'the cloth is drawn as cloth, over hidden voxels');

  // the cloth drawing, tied to those voxels (as the app builds it, without the textures)
  const pr = w.props.find((p) => p.procedural === 'laundry');
  const scene = new THREE.Scene();
  const g = new THREE.Group();
  g.position.set(...pr.p);
  g.rotation.y = pr.heading ?? 0;
  scene.add(g);
  const drawing = new StatueDrawing(pr, w, g);
  drawing.build(buildLaundry(pr));
  assert.equal(drawing.slots.length, ids.length, 'every cloth voxel is part of the drawing');
  const tris = drawing.src.flatMap((s) => Array.from({ length: s.slot.length / 3 }, (_, t) => s.slot[t * 3]));
  const drawn = () => {
    drawing.refresh();
    return tris.filter((k) => drawing.data[k * 4] > 0.5).length / tris.length;
  };
  assert.equal(drawn(), 1);

  let ignited = -1;
  let gone = -1;
  let peakBurning = 0;
  let maxChar = 0;
  while (w.time < 240 && gone < 0) {
    sim.step(sim.dt);
    let there = 0;
    let burning = 0;
    for (const i of ids) {
      if (!cloth.has(w.mat[i])) continue;
      there++;
      if (w.flags[i] & F_BURNING) burning++;
      if (w.char[i] > maxChar) maxChar = w.char[i];
    }
    if (burning > 0 && ignited < 0) ignited = w.time;
    peakBurning = Math.max(peakBurning, burning);
    if (there < ids.length * 0.1) gone = w.time;
  }
  // damp, not wet: the spark (after 30 s) catches at once
  assert.ok(ignited >= 30 && ignited < 60, `ignited at ${ignited.toFixed(1)} s`);
  // flames run along the line: hundreds of voxels alight at once, the cloth chars black
  assert.ok(peakBurning > 300, `peak burning ${peakBurning}`);
  assert.ok(maxChar > 0.5, `char ${maxChar}`);
  // nine tenths of the wash burnt away within two minutes of the spark
  assert.ok(gone > 0 && gone < 150, `gone by ${gone.toFixed(1)} s`);
  // the drawn cloth lost what burnt (holes, then nothing left on the line)
  assert.ok(drawn() < 0.15, `drawn ${drawn()}`);
});
