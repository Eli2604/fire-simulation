import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SCENARIOS } from '../src/scenarios.js';
import { buildScene } from '../src/models/voxelizer.js';
import { MATERIALS } from '../src/sim/materials.js';
import { F_HIDDEN } from '../src/sim/world.js';
import { ChurchDrawing } from '../src/render/church.js';

const zone = SCENARIOS.carrier.zones.island;
const build = () => buildScene({ world: zone.world, objects: zone.objects, weather: SCENARIOS.carrier.weather }).world;

test('island: a gothic church stands on the plateau, glazed where finished, in scaffolding where not', () => {
  const world = build();
  const owner = zone.objects.findIndex((o) => o.type === 'church');
  const count = {};
  let hiddenGlass = 0;
  for (let i = 0; i < world.N; i++) {
    if (world.owner[i] !== owner || !world.mat[i]) continue;
    const m = MATERIALS[world.mat[i]].name;
    count[m] = (count[m] ?? 0) + 1;
    if (m === 'glass' && world.flags[i] & F_HIDDEN) hiddenGlass++;
  }
  assert.ok(count.ashlar > 5000, 'stone walls');
  assert.ok(count.tiles > 500, 'a slate roof over the finished parts');
  assert.ok(hiddenGlass > 300 && hiddenGlass === count.glass, 'stained glass: simulated, drawn by its own mesh');
  assert.ok(count.wood > 1000, 'timber frame and scaffolding');
  const pr = world.props.find((p) => p.type === 'church');
  assert.ok(pr, 'the church is drawn as a prop');
  assert.ok(pr.spec.windows.filter((w) => w.glass).length >= 10);
  assert.ok(pr.spec.windows.some((w) => !w.glass), 'windows still waiting for their glass (iron armature only)');
  assert.ok(world.doors.some((d) => d.name === 'west portal'), 'a west door');
});

test('church: the sun through the south windows of the nave falls on the rosette in the crossing', () => {
  const world = build();
  const { spec } = world.props.find((p) => p.type === 'church');
  const sun = new THREE.Vector3(...zone.view.sun).normalize();
  // the window of the east bay, south side: its glass centre, along the sunlight down to the floor
  const w = spec.windows.find((x) => x.n[2] > 0.9 && x.o[0] > 0 && x.kind === 'two');
  const c = new THREE.Vector3(w.o[0], (w.y0 + w.top) / 2, w.o[2]);
  const hit = c.clone().addScaledVector(sun, -c.y / sun.y);
  const d = Math.hypot(hit.x - spec.symbol.c[0], hit.z - spec.symbol.c[2]);
  assert.ok(d < spec.symbol.r, `the light lands ${d.toFixed(2)} m from the centre of the rosette (r ${spec.symbol.r.toFixed(2)})`);
});

test('church: drawn parts find their voxels; a part burnt away disappears and leaves its remains as voxels', () => {
  const world = build();
  const pr = world.props.find((p) => p.type === 'church');
  const d = new ChurchDrawing(pr.spec, world, pr, new THREE.Vector3(...zone.view.sun), { intensity: 2.4 });
  for (const p of d.parts.values()) if (p.name !== 'static') assert.ok(p.n0 > 0, `part ${p.name} has voxels`);
  let bad = 0;
  d.group.traverse((o) => {
    if (o.isMesh && !o.geometry.attributes.position.array.every(Number.isFinite)) bad++;
  });
  assert.equal(bad, 0, 'no broken geometry');
  // burn away most of the boarding that closes off the south arm
  const part = d.parts.get('partition');
  part.voxels.slice(0, Math.ceil(part.n0 * 0.7)).forEach((i) => world.clearVoxel(i));
  d.update(1);
  assert.equal(part.group.visible, false, 'the boards are gone');
  const left = part.voxels.filter((i) => world.mat[i]);
  assert.ok(left.length > 0 && left.every((i) => !(world.flags[i] & F_HIDDEN)), 'what is left shows as voxels');
  assert.ok(d.parts.get('splate').group.visible, 'the rest still stands');
});
