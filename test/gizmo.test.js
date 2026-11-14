import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildScene, rotationMatrix } from '../src/models/voxelizer.js';
import { recordToPose, poseToRecord, applyRecord, norm360 } from '../src/editor/gizmoPose.js';

const H = 0.2;
const wall = (o) => buildScene({ world: { size: [8, 6, 8], h: H }, objects: [{ type: 'wall', params: { length: 3, height: 1, thickness: 0.2 }, x: 4, z: 4, ...o }] }).world;
/** The extent of object 0's voxels, in metres: { min: [x,y,z], max: [x,y,z] }. */
function extent(w) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < w.owner.length; i++)
    if (w.owner[i] === 0 && w.mat[i]) {
      const c = w.coords(i);
      for (let k = 0; k < 3; k++) (min[k] = Math.min(min[k], c[k] * w.h)), (max[k] = Math.max(max[k], (c[k] + 1) * w.h));
    }
  return { min, max, size: max.map((v, k) => +(v - min[k]).toFixed(2)) };
}

test('buildScene: a numeric y lifts the object that far above the ground layer', () => {
  const low = extent(wall({}));
  const high = extent(wall({ y: 1.4 }));
  assert.ok(Math.abs(low.min[1] - H) < 1e-9, 'on the ground layer');
  assert.ok(Math.abs(high.min[1] - (H + 1.4)) < 1e-9, `at 1.4 m: ${high.min[1]}`);
  assert.deepEqual(high.size, low.size);
});

test('buildScene: rotation turns the object about the vertical; tiltZ stands it on its end', () => {
  const flat = extent(wall({}));
  assert.ok(flat.size[0] > 2.9 && flat.size[2] < 0.5);
  const turned = extent(wall({ rotation: 90 }));
  assert.ok(turned.size[2] > 2.9 && turned.size[0] < 0.5, JSON.stringify(turned.size));
  // tilted 90° about z, raised so it clears the ground: its length goes up
  const tilted = extent(wall({ tiltZ: 90, y: 2 }));
  assert.ok(tilted.size[1] > 2.9 && tilted.size[0] < 1.3, JSON.stringify(tilted.size));
});

test('buildScene records where each object\'s origin went (the editor\'s gizmo sits there)', () => {
  assert.ok(Math.abs(wall({ y: 1 }).origins[0][1] - (H + 1)) < 1e-9);
  assert.ok(Math.abs(wall({}).origins[0][1] - H) < 1e-9);
});

test('rotationMatrix is three.js Euler(tiltX, rotation, tiltZ, YXZ)', () => {
  for (const [r, tx, tz] of [[0, 0, 0], [90, 0, 0], [37, 20, -50], [200, -80, 120]]) {
    const d = Math.PI / 180;
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(tx * d, r * d, tz * d, 'YXZ')).elements; // column-major
    const R = rotationMatrix(r, tx, tz);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) assert.ok(Math.abs(R[i * 3 + j] - m[j * 4 + i]) < 1e-12, `${r},${tx},${tz} [${i}${j}]`);
  }
});

test('gizmo -> record: dragging up gives an auto-height object a numeric height', () => {
  const o = { type: 'car', x: 5, z: 3, y: 'auto' };
  const opts = { size: [10, 6, 10], h: 0.15 };
  const start = recordToPose(o, { h: 0.15, originY: 0.9 }); // resting on something 0.75 m up
  assert.equal(start.y, 0.9);
  // sideways only: it keeps sitting
  const side = poseToRecord(o, { ...start, x: 6.234 }, { ...opts, start });
  assert.equal(side.y, 'auto');
  assert.equal(side.x, 6.23);
  // up by half a metre: 0.75 + 0.5 above the ground layer, on whole voxels (1.2 m)
  const up = poseToRecord(o, { ...start, y: start.y + 0.5 }, { ...opts, start });
  assert.equal(up.y, 1.2);
  applyRecord(o, up);
  assert.equal(o.y, 1.2);
  assert.equal('tiltX' in o, false);
  // and back where the gizmo puts it
  assert.ok(Math.abs(recordToPose(o, { h: 0.15 }).y - (0.15 + 1.2)) < 1e-9);
  // never below the ground layer
  assert.equal(poseToRecord(o, { ...start, y: -3 }, { ...opts, start }).y, 0);
});

test('gizmo -> record: turns are degrees in [0, 360), tilts only when there is one', () => {
  const o = { type: 'car', x: 5, z: 3, rotation: 10 };
  const start = recordToPose(o, { h: 0.15 });
  assert.ok(Math.abs(start.ry - (10 * Math.PI) / 180) < 1e-12);
  const r = poseToRecord(o, { ...start, ry: -Math.PI / 2 }, { size: [10, 6, 10], h: 0.15, start });
  assert.equal(r.rotation, 270);
  assert.equal(r.y, undefined);
  assert.equal(r.tiltX, undefined);
  const t = poseToRecord(o, { ...start, rx: (15 * Math.PI) / 180, rz: (-200 * Math.PI) / 180 }, { size: [10, 6, 10], h: 0.15, start });
  assert.equal(t.tiltX, 15);
  assert.equal(t.tiltZ, 160);
  assert.equal(norm360(-0.4), 0);
  assert.equal(norm360(359.6), 0);
  assert.equal(norm360(725), 5);
});
