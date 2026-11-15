import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SCENARIOS } from '../src/scenarios.js';
import { defaultParams } from '../src/models/index.js';
import { createSimulation, buildWorld } from '../src/sim/createSimulation.js';
import { Prebuild, packBuilt, unpackBuilt } from '../src/sim/prebuild.js';
import { World } from '../src/sim/world.js';
import { PlaceScenery, coarseSurface, PLACE_LOD } from '../src/render/scenery.js';
import { lod } from '../src/render/lod.js';

/** A place of the carrier's world, as main.js builds it (zoneDesc). */
function desc(name) {
  const zd = SCENARIOS.carrier.zones[name];
  const objects = zd.objects.map((o) => ({ ...o, params: { ...defaultParams(o.type), ...(o.params ?? {}) } }));
  return { name: zd.name, world: zd.world, objects, weather: { ambient: 15 }, view: zd.view };
}

test('a world built ahead comes back whole through a message, and a simulation runs on it', () => {
  const d = desc('meadow');
  const { msg, transfer } = packBuilt(buildWorld(d));
  const back = unpackBuilt(structuredClone(msg, { transfer }));
  assert.ok(back.world instanceof World);
  const ref = createSimulation(d);
  const sim = createSimulation(d, back);
  assert.equal(sim.world, back.world, 'the zone takes the world built ahead');
  assert.equal(sim.world.solidCount, ref.world.solidCount);
  assert.equal(sim.world.idx(3, 2, 1), ref.world.idx(3, 2, 1));
  sim.advance(0.5, 4); // (it runs)
});

test('prebuild: the biggest first, after its delay; take gives it only for the same description', async () => {
  const pb = new Prebuild({ makeWorker: () => null, delay: 0 });
  const order = [];
  await new Promise((resolve) => {
    pb.onReady = (n) => {
      order.push(n);
      if (order.length === 2) resolve();
    };
    pb.since = -1e9;
    pb.busy = { name: 'hold' }; // (queue both before the first starts)
    pb.want('garden', desc('garden'), 10);
    pb.want('meadow', desc('meadow'), 50);
    pb.busy = null;
    pb.pump();
  });
  assert.deepEqual(order, ['meadow', 'garden']);
  assert.ok(pb.world('meadow') instanceof World);
  const other = desc('garden');
  other.objects = other.objects.slice(1);
  assert.equal(pb.take('garden', other), null, 'edited since: built again');
  const t = pb.take('meadow', desc('meadow'));
  assert.ok(t?.world);
  assert.equal(pb.world('meadow'), null, 'taken: the zone owns it now');
  pb.reset();
  assert.equal(pb.world('garden'), null);
});

test('coarse surface: merged cells, far fewer than the voxels, none under the sea', () => {
  const w = buildWorld(desc('islet')).world;
  let mesh = null;
  const job = coarseSurface(w, 2.5, new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), (m) => (mesh = m));
  let steps = 0;
  while (!job.next().done) steps++;
  assert.ok(steps > 1, 'built in slices');
  assert.ok(mesh && mesh.count > 50, `cells: ${mesh?.count}`);
  assert.ok(mesh.count < w.solidCount / 20, `${mesh.count} cells for ${w.solidCount} voxels`);
  assert.ok(mesh.userData.cell >= 0.4 && mesh.userData.cell <= 0.8);
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  for (let j = 0; j < mesh.count; j += 7) {
    mesh.getMatrixAt(j, m);
    p.setFromMatrixPosition(m);
    assert.ok(p.y + mesh.userData.cell >= 2.5 - 0.6 - 1e-6);
  }
});

test('scenery levels: stand-in far off, coarse closer, full close by (one place at a time)', () => {
  const w = buildWorld(desc('garden')).world;
  const root = new THREE.Group();
  const sc = new PlaceScenery(root);
  sc.sliceMs = 1e9; // (all at once here)
  const covered = new Map();
  const proxies = {
    items: new Map([['garden', { allowed: true, zone: { name: 'garden', offset: [100, 0, 0], world: w, size: w.size, sea: 0 } }]]),
    setCovered: (n, c) => covered.set(n, c),
  };
  const view = { voxels: { mode: 'realistic' }, time: 0 };
  const frame = (cam) => {
    lod.begin(cam);
    sc.update(proxies, view, 1 / 60);
  };
  frame([100 + 3.5, 1, 2000]); // ~2 km off: the stand-in
  assert.equal(sc.items.get('garden').level, 2);
  assert.equal(covered.get('garden'), false);
  // a few tens of metres: coarse (built over the next frames), and the stand-in hidden
  for (let k = 0; k < 4; k++) frame([103.5, 2, 2.5 + 40]);
  const it = sc.items.get('garden');
  assert.equal(it.level, 1);
  assert.ok(it.coarse.ready && it.coarse.mesh.visible);
  assert.equal(covered.get('garden'), true);
  // close by: in full
  for (let k = 0; k < 4; k++) frame([103.5, 2, 2.5 + 6]);
  assert.equal(it.level, 0);
  assert.ok(it.full?.ready && it.full.group.visible);
  assert.ok(!it.coarse.mesh.visible, 'the coarse one hidden under the full one');
  assert.ok(it.full.voxels.count > it.coarse.mesh.count);
  // and the levels are those of render/lod.js
  assert.ok(PLACE_LOD[0][0] > PLACE_LOD[1][0]);
  // gone from the list (you went there): dropped
  proxies.items.clear();
  frame([0, 0, 0]);
  assert.equal(sc.items.size, 0);
});

test('prebuild: a memory budget; the world not asked for the longest goes first', async () => {
  const pb = new Prebuild({ makeWorker: () => null, delay: 0 });
  pb.since = -1e9;
  const built = (n) => new Promise((resolve) => (pb.onReady = (m) => m === n && resolve()));
  let p = built('meadow');
  pb.want('meadow', desc('meadow'), 10);
  await p;
  const one = pb.bytes();
  assert.ok(one > 1e6);
  pb.maxBytes = 120 * 140 * 60 * 100 + 1; // (room for the garden, as it is reckoned before: not for both)
  pb.keep = 0;
  pb.built.get('meadow').seen -= 10; // (not asked for since)
  p = built('garden');
  pb.want('garden', desc('garden'), 5);
  await p;
  assert.equal(pb.world('meadow'), null, 'evicted');
  assert.ok(pb.world('garden'));
  assert.equal(pb.stats.evicted, 1);
  // asked for just now, and no room: kept, the other waits
  pb.keep = 60;
  pb.want('garden', desc('garden'), 5);
  pb.want('meadow', desc('meadow'), 10);
  assert.ok(pb.world('garden'));
  assert.equal(pb.busy, null, 'no room: not built');
});
