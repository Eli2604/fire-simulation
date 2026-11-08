import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/sim/world.js';
import { MAT } from '../src/sim/materials.js';
import { SurfaceRenderer } from '../src/render/surface.js';
import { VolumeRenderer } from '../src/render/volume.js';
import { SCENARIOS, cloneScene } from '../src/scenarios.js';
import { createSimulation } from '../src/sim/createSimulation.js';

function meshOf(world) {
  const s = new SurfaceRenderer(new THREE.Scene());
  s.setWorld(world);
  s.setVisible(true);
  s.update(0);
  return s;
}
const triangles = (s) => s.chunks.reduce((n, c) => n + (c.mesh ? c.mesh.geometry.index.count / 3 : 0), 0);

/** Every edge of a closed triangle mesh is shared by exactly two triangles. */
function isClosed(s) {
  const edges = new Map();
  for (const c of s.chunks) {
    if (!c.mesh) continue;
    const pos = c.mesh.geometry.attributes.position.array;
    const idx = c.mesh.geometry.index.array;
    const key = (i) => `${pos[i * 3].toFixed(5)},${pos[i * 3 + 1].toFixed(5)},${pos[i * 3 + 2].toFixed(5)}`;
    for (let t = 0; t < idx.length; t += 3)
      for (let e = 0; e < 3; e++) {
        const a = key(idx[t + e]);
        const b = key(idx[t + ((e + 1) % 3)]);
        const k = a < b ? `${a}|${b}` : `${b}|${a}`;
        edges.set(k, (edges.get(k) ?? 0) + 1);
      }
  }
  for (const n of edges.values()) if (n !== 2) return false;
  return edges.size > 0;
}

test('smooth surface of a floating block is a closed mesh', () => {
  const w = new World({ size: [2, 2, 2], h: 0.1 });
  for (let x = 5; x < 9; x++) for (let y = 5; y < 8; y++) for (let z = 5; z < 9; z++) w.setVoxel(w.idx(x, y, z), MAT.wood);
  w.rebuildLists();
  const s = meshOf(w);
  assert.ok(triangles(s) > 20);
  assert.ok(isClosed(s), 'watertight across chunk borders');
});

test('only changed chunks are rebuilt, and colours follow the voxels', () => {
  const w = new World({ size: [4, 2, 4], h: 0.1 });
  for (let x = 2; x < 38; x++) for (let z = 2; z < 38; z++) w.setVoxel(w.idx(x, 1, z), MAT.grass);
  w.rebuildLists();
  const s = meshOf(w);
  const before = s.chunks.map((c) => c.mesh);
  w.clearVoxel(w.idx(5, 1, 5));
  w.rebuildLists();
  s.lastMesh = -1e9;
  s.update(1);
  for (let k = 0; k < 50 && s.pending; k++) s.update(1); // rebuilds are spread over frames
  const changed = s.chunks.filter((c, k) => c.mesh !== before[k]).length;
  assert.ok(changed >= 1 && changed < s.chunks.length / 2, `${changed} of ${s.chunks.length} chunks rebuilt`);
  // heat one voxel: the vertices around it glow
  const i = w.idx(20, 1, 20);
  w.temp[i] = w.skin[i] = 1000;
  s.lastShade = -1e9;
  s.update(2);
  let maxGlow = 0;
  for (const c of s.chunks) if (c.mesh) for (const v of c.mesh.geometry.attributes.aGlow.array) maxGlow = Math.max(maxGlow, v);
  assert.ok(maxGlow > 0.5, `glow ${maxGlow.toFixed(2)}`);
});

test('smooth surfaces build for every scenario', () => {
  for (const [name, desc] of Object.entries(SCENARIOS)) {
    const sim = createSimulation(cloneScene(desc));
    const s = meshOf(sim.world);
    assert.ok(triangles(s) > 100, `${name}: ${triangles(s)} triangles`);
    for (const c of s.chunks) if (c.mesh) for (const v of c.mesh.geometry.attributes.position.array) assert.ok(Number.isFinite(v));
  }
});

test('volume textures encode smoke, steam and flames from the air grid', () => {
  const sim = createSimulation(cloneScene(SCENARIOS.campfire));
  for (let k = 0; k < 100; k++) sim.step(sim.dt);
  const vr = new VolumeRenderer({});
  vr.setWorld(sim.world);
  vr.upload(0.5);
  const m = vr.medium.image.data;
  const g = vr.glow.image.data;
  let smoky = 0;
  let flames = 0;
  for (let a = 0; a < sim.world.NA; a++) {
    if (m[a * 4 + 3] > 0) smoky++;
    if (g[a * 4] > 0) flames++;
  }
  assert.ok(smoky > 0, `${smoky} cells with smoke/steam`);
  assert.ok(flames > 0, `${flames} cells with flames`);
});
