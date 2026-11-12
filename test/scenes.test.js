import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SCENARIOS, cloneScene } from '../src/scenarios.js';
import { createSimulation } from '../src/sim/createSimulation.js';
import { MODELS, defaultParams } from '../src/models/index.js';
import { buildScene } from '../src/models/voxelizer.js';
import { VoxelRenderer } from '../src/render/voxels.js';
import { FlameRenderer } from '../src/render/flames.js';
import { SmokeRenderer } from '../src/render/smoke.js';
import { RainRenderer } from '../src/render/rain.js';

const countOwned = (world, owner) => {
  let n = 0;
  for (let k = 0; k < world.solidCount; k++) if (world.owner[world.solids[k]] === owner) n++;
  return n;
};

test('every model builds voxels with its default parameters', () => {
  for (const type of Object.keys(MODELS)) {
    const { world } = buildScene({ world: { size: [10, 8, 10], h: 0.1 }, objects: [{ type, x: 5, z: 5 }] });
    if (type === 'enemy' || type === 'squad') {
      assert.ok(world.enemies.length > 0, 'enemies are characters, not voxels');
      continue;
    }
    if (type === 'candle') {
      // smaller than these voxels: it is drawn, and burns as a small flame with its light
      assert.ok(world.heaters.some((h) => h.kind === 'candle' && h.light), 'a candle in a coarse scene is its flame');
      continue;
    }
    if (type === 'teaCup') {
      // far smaller than the voxels: drawn, its heat kept on its own (sim/tea.js)
      assert.equal(world.cups.length, 1, 'a cup of tea is a cup, not voxels');
      continue;
    }
    if (type === 'dragon') {
      assert.ok(world.dragons.length > 0, 'a dragon is a creature, not voxels');
      continue;
    }
    assert.ok(countOwned(world, 0) > 0, `${type} produced voxels`);
  }
});

test('model parameters change the result (bigger tree = more voxels)', () => {
  const small = buildScene({ world: { size: [10, 10, 10], h: 0.1 }, objects: [{ type: 'tree', params: { height: 3, crownRadius: 1 }, x: 5, z: 5 }] });
  const big = buildScene({ world: { size: [10, 10, 10], h: 0.1 }, objects: [{ type: 'tree', params: { height: 7, crownRadius: 2.5 }, x: 5, z: 5 }] });
  assert.ok(countOwned(big.world, 0) > 2 * countOwned(small.world, 0));
});

test('rotation keeps a model roughly the same size', () => {
  const at = (rotation) => buildScene({ world: { size: [10, 4, 10], h: 0.1 }, objects: [{ type: 'car', x: 5, z: 5, rotation }] });
  const a = countOwned(at(0).world, 0);
  const b = countOwned(at(37).world, 0);
  assert.ok(Math.abs(a - b) / a < 0.2, `0°: ${a} voxels, 37°: ${b}`);
});

test('default params are complete for every model', () => {
  for (const [type, M] of Object.entries(MODELS)) {
    const p = defaultParams(type);
    for (const k of Object.keys(M.params)) assert.notEqual(p[k], undefined, `${type}.${k}`);
  }
});

test('all scenarios run without NaN and the render layers update', () => {
  for (const [name, desc] of Object.entries(SCENARIOS)) {
    if (desc.page) continue; // a link to a page of its own (the soldier rig test)
    const sim = createSimulation(cloneScene(desc));
    const w = sim.world;
    for (let k = 0; k < 15; k++) sim.step(sim.dt);
    for (let k = 0; k < w.solidCount; k++) {
      const i = w.solids[k];
      assert.ok(Number.isFinite(w.temp[i]) && Number.isFinite(w.skin[i]), `${name}: finite temperatures`);
    }
    for (let a = 0; a < w.NA; a++) assert.ok(Number.isFinite(w.airT[a]) && Number.isFinite(w.smoke[a]), `${name}: finite air`);

    // render layers (no WebGL needed to fill the buffers)
    const scene = new THREE.Scene();
    const vox = new VoxelRenderer(scene);
    vox.setWorld(w);
    vox.update(0);
    assert.ok(vox.count > 0, `${name}: visible voxels`);
    for (let k = 0; k < vox.count * 3; k++) assert.ok(Number.isFinite(vox.glowAttr.array[k]), `${name}: finite glow`);
    vox.mode = 'thermal';
    vox.update(0);
    const flames = new FlameRenderer(scene, 2000);
    flames.setWorld(w);
    flames.update(1 / 60, 800);
    const smoke = new SmokeRenderer(scene);
    smoke.setWorld(w);
    smoke.update(800, 0.5);
    for (let k = 0; k < smoke.color.length; k++) assert.ok(Number.isFinite(smoke.color[k]), `${name}: finite smoke colour`);
    new RainRenderer(scene, 100).update(1 / 60, w, { ...sim.weather, rain: 10 });
  }
});

test('scene descriptions survive a JSON round trip', () => {
  for (const desc of Object.values(SCENARIOS)) {
    const copy = JSON.parse(JSON.stringify(desc));
    assert.deepEqual(copy, cloneScene(desc));
  }
});
