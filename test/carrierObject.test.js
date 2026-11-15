import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS, cloneScene, placeBoxes } from '../src/scenarios.js';
import { buildScene } from '../src/models/voxelizer.js';
import { createSimulation } from '../src/sim/createSimulation.js';
import { MODELS, defaultParams } from '../src/models/index.js';
import { carrierObject } from '../src/models/carrier.js';
import { flattenObjects, resolveTree, childRecord, toLocal, poseOf, liftPlaces, uniquifyPlaces, placeKeys, matrixToEuler, rotationMatrix, isPlace } from '../src/models/composite.js';

const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

// the carrier's deck as it was written before it was one object: the same objects, flat
const OLD_DECK = [
  { type: 'carrierDeck', params: { length: 210, beam: 48, deckHeight: 11, draft: 4, helipads: 3, boatTo: 'islet', boatLabel: 'Boat ladder: to the islet' }, x: 106, z: 26 },
  ...[[145, 20], [145, 30], [85, 10.4], [85, 21.2]].map(([x, z], k) => ({ type: 'jet', params: { color: k % 2 ? '#7a8590' : '#6f7b86' }, x, z, y: 11, rotation: 0 })),
  ...[150, 161, 172, 183].map((x) => ({ type: 'jet', params: { rockets: 4 }, x, z: 42.5, y: 11, rotation: 90 })),
  ...[160, 171, 182, 193].map((x) => ({ type: 'jet', params: { rockets: 4 }, x, z: 7.4, y: 11, rotation: -90 })),
  ...[62, 73, 84, 95].map((x) => ({ type: 'jet', params: { rockets: 0, fuelLiters: 800 }, x, z: 42.5, y: 11, rotation: 90 })),
  { type: 'jetFlight', params: { count: 4, altitude: 160, orbitRadius: 600 }, x: 106, z: 26 },
  { type: 'car', params: { length: 2.8, width: 1.6, height: 1.1, bodyColor: '#d8b21c', fuelLiters: 30, tankMaterial: 'steel' }, x: 104.5, z: 39.5, y: 'auto', rotation: 90 },
  { type: 'gasCylinder', params: { capacity: 40, fill: 0.9, color: '#2f6b3a' }, x: 107.6, z: 48.2, y: 'auto' },
  { type: 'gasCylinder', params: { capacity: 11, fill: 0.8 }, x: 108.3, z: 48.3, y: 'auto' },
  { type: 'scannedProp', params: { asset: 'drum' }, x: 109.4, z: 48.1, y: 'auto' },
  { type: 'scannedProp', params: { asset: 'drum' }, x: 110.1, z: 48.2, y: 'auto', rotation: 40 },
];

test('the carrier is one object of objects: its jets and deck equipment in it, below deck a place in it', () => {
  const deck = SCENARIOS.carrier.zones.deck;
  assert.equal(deck.objects.length, 1, 'one object in the flight deck zone');
  const c = deck.objects[0];
  assert.equal(c.type, 'carrier');
  assert.ok(MODELS.carrier.children, 'a new carrier comes with its objects');
  const kids = c.children;
  assert.equal(kids.filter((k) => k.type === 'jet').length, 16, '16 jets, each an object of its own');
  assert.ok(kids.some((k) => k.type === 'jetFlight') && kids.some((k) => k.type === 'car') && kids.some((k) => k.type === 'gasCylinder'));
  const below = kids.find(isPlace);
  assert.equal(below.key, 'below');
  // below deck is a place holding objects, and a place again (the lower decks)
  assert.ok(below.objects.some((o) => o.type === 'carrierBelow') && below.objects.some((o) => o.type === 'enemy'));
  const lower = below.objects.find(isPlace);
  assert.equal(lower.key, 'lower');
  assert.ok(lower.objects.some((o) => o.type === 'shipSection'));
  // the places are zones of the world: the zone IS the place object (editing one edits the other)
  assert.equal(SCENARIOS.carrier.zones.below, below);
  assert.equal(SCENARIOS.carrier.zones.lower, lower);
  assert.equal(below.within, 'deck');
  assert.equal(lower.within, 'below');
  // still inside places: no origin, a schematic box in the hull (where they were before)
  const boxes = placeBoxes(SCENARIOS.carrier);
  const b = (n) => boxes.find((q) => q.name === n);
  assert.deepEqual(b('below').min, [-70, 5.6, 7.5]);
  assert.deepEqual(b('lower').min, [-63, -1.6, 11.4]);
  assert.ok(b('below').schematic && b('lower').schematic);
  assert.equal(below.origin, undefined);
  // and a copy keeps that (one object, not two copies after the JSON round trip)
  const sc = cloneScene(SCENARIOS.carrier);
  assert.equal(sc.zones.below, sc.zones.deck.objects[0].children.find(isPlace));
  assert.equal(sc.zones.lower, sc.zones.below.objects.find(isPlace));
  assert.deepEqual(Object.keys(sc.zones), Object.keys(SCENARIOS.carrier.zones));
});

test('the flight deck built from the carrier object is the deck it was (same voxels, same owners)', () => {
  const sc = cloneScene(SCENARIOS.carrier);
  const zd = sc.zones.deck;
  const scene = { world: zd.world, weather: sc.weather, objects: zd.objects };
  const a = buildScene(scene).world;
  const b = buildScene({ ...scene, objects: JSON.parse(JSON.stringify(OLD_DECK)) }).world;
  assert.equal(a.N, b.N);
  let diff = 0;
  for (let i = 0; i < a.N; i++) if (a.mat[i] !== b.mat[i] || a.owner[i] !== b.owner[i]) diff++;
  assert.equal(diff, 0, 'voxels differ');
  assert.equal(a.vehicles.length, b.vehicles.length);
  assert.equal(a.vehicles.length, 16);
  a.vehicles.forEach((v, k) => v.seat.forEach((s, j) => assert.ok(near(s, b.vehicles[k].seat[j]), 'jet seat')));
  assert.deepEqual(a.origins, b.origins);
  assert.deepEqual(a.portals.map((p) => p.to), b.portals.map((p) => p.to));
  // numbered depth first: the carrier 0, its objects after it (the place is not built here)
  assert.equal(a.objectTree.length, OLD_DECK.length);
  assert.equal(a.objectTree[0].end, OLD_DECK.length);
  assert.ok(a.objectTree.slice(1).every((e) => e.parent === 0 && e.depth === 1));
});

test('the places of the carrier: their ladders lead back up to the place they are in', () => {
  const sc = cloneScene(SCENARIOS.carrier);
  // the hull's insides as they were: below deck a world of its own, its ladder up to the deck
  const below = buildScene({ world: sc.zones.below.world, objects: sc.zones.below.objects.slice(0, 1), within: 'deck' }).world;
  assert.ok(below.portals.some((p) => p.to === 'deck'));
  assert.ok(below.portals.some((p) => p.to === 'lower'));
  // as createSimulation takes it (the zone's `within`)
  const lower = createSimulation({ ...sc, zone: 'lower' });
  assert.ok(lower.world.portals.some((p) => p.to === 'below'), 'the lower decks lead up to below deck');
});

test('objects in objects: moved and turned with their parent, each an object of its own', () => {
  const crate = (x, z, extra = {}) => ({ type: 'crate', params: { width: 0.6, depth: 0.6, height: 0.6 }, x, z, ...extra });
  const scene = (rotation) => ({
    world: { size: [12, 4, 12], h: 0.1, ground: 'concrete' },
    objects: [{ type: 'group', x: 6, z: 6, rotation, children: [crate(2, 0), crate(0, 0, { y: 1, children: [crate(0, 1.5)] })] }],
  });
  const w0 = buildScene(scene(0)).world;
  const w90 = buildScene(scene(90)).world;
  // the group 0, the first crate 1, the second 2, the crate on it 3
  assert.equal(w0.objectTree.length, 4);
  assert.deepEqual(w0.objectTree.map((e) => e.parent), [-1, 0, 0, 2]);
  assert.deepEqual(w0.objectTree.map((e) => e.path), [[0], [0, 0], [0, 1], [0, 1, 0]]);
  // unturned: 2 m along x; turned 90°: 2 m along -z (Ry turns +x to -z)
  assert.ok(near(w0.objectTree[1].rec.x, 8) && near(w0.objectTree[1].rec.z, 6));
  assert.ok(near(w90.objectTree[1].rec.x, 6) && near(w90.objectTree[1].rec.z, 4));
  assert.equal(w90.objectTree[1].rec.rotation, 90);
  // the crate on the lifted crate: 1 m up (its parent's origin), and 1.5 m along that one's z
  assert.ok(near(w90.origins[3][1], w0.origins[3][1]));
  assert.ok(near(w0.origins[3][1], w0.origins[0][1] + 1));
  assert.ok(near(w90.objectTree[3].rec.x, 7.5) && near(w90.objectTree[3].rec.z, 6));
  // each has voxels of its own (the owner: its number); the group none
  const owners = new Set();
  for (let i = 0; i < w90.N; i++) if (w90.mat[i] && w90.owner[i] >= 0) owners.add(w90.owner[i]);
  assert.deepEqual([...owners].sort(), [1, 2, 3]);
  // the voxels of the first crate are where its record says (turned with the group)
  let sx = 0, sz = 0, n = 0;
  for (let i = 0; i < w90.N; i++)
    if (w90.mat[i] && w90.owner[i] === 1) {
      const [x, y, z] = w90.coords(i);
      const c = w90.center(x, y, z);
      sx += c[0];
      sz += c[2];
      n++;
    }
  assert.ok(n > 0 && Math.abs(sx / n - 6) < 0.15 && Math.abs(sz / n - 4) < 0.15);
});

test('a carrier turned and moved: its jets go with it', () => {
  const objs = [carrierObject({ x: 300, z: 300, rotation: 90 })];
  const tree = resolveTree(objs, { h: 0.5 });
  const jets = tree.filter((e) => e.node.type === 'jet');
  assert.equal(jets.length, 16);
  // the first jet sits 39 m forward, 6 m to port of the carrier's middle: turned 90°, forward is -z
  const j = jets[0];
  assert.ok(near(j.rec.x, 300 - 6) && near(j.rec.z, 300 - 39), `${j.rec.x}, ${j.rec.z}`);
  assert.equal(j.rec.rotation, 90);
  assert.ok(near(j.rec.y, 11), 'on the deck, 11 m above the keel');
  // the ones parked at -90 face the other way, turned with it
  assert.equal(jets[8].rec.rotation, 0);
});

test('the pose of a child: to its world and back (turned and tilted parents)', () => {
  for (const parent of [{ x: 3, z: 4, rotation: 30 }, { x: -2, z: 1, rotation: 200, tiltX: 15, tiltZ: -10 }]) {
    const pp = poseOf(parent, { h: 0.1 });
    const child = { x: 1.5, z: -0.7, y: 2, rotation: 45, tiltZ: 5 };
    const rec = childRecord(pp, child, 0.1);
    const back = toLocal(pp, { x: rec.x, z: rec.z, oy: rec.y + 0.1, rotation: rec.rotation, tiltX: rec.tiltX, tiltZ: rec.tiltZ }, 4);
    assert.ok(near(back.x, 1.5, 1e-3) && near(back.z, -0.7, 1e-3) && near(back.y, 2, 1e-3), JSON.stringify(back));
    assert.equal(back.rotation, 45);
    assert.equal(back.tiltZ, 5);
    assert.equal(back.tiltX, undefined);
  }
  // the Euler angles of rotationMatrix come back out
  const e = matrixToEuler(rotationMatrix(123, 20, -35));
  assert.ok(near(e.rotation, 123, 1e-4) && near(e.tiltX, 20, 1e-4) && near(e.tiltZ, -35, 1e-4));
});

test('a carrier put into a world of one place: its places become places of that world', () => {
  const scene = {
    name: 'Open sea',
    world: { size: [240, 26, 60], h: 0.5, ground: 'none' },
    objects: [carrierObject({ x: 120, z: 30, params: { boatTo: '' } })],
  };
  liftPlaces(scene);
  assert.deepEqual(Object.keys(scene.zones), ['main', 'below', 'lower']);
  const objects = scene.zones.main.objects;
  assert.equal(objects[0].type, 'carrier');
  assert.equal(scene.world, undefined, 'its world is the zone main now');
  assert.equal(scene.zones.below.within, 'main');
  assert.ok(scene.places);
  // the below deck's ladder up leads to the world it is in
  const sim = createSimulation({ ...scene, zone: 'below' });
  assert.ok(sim.world.portals.some((p) => p.to === 'main'));
  // a second carrier: its places get names of their own, and its hatch and ladders follow
  const second = carrierObject({ x: 120, z: 30 });
  const renames = uniquifyPlaces(second, placeKeys(scene));
  assert.deepEqual(renames, { below: 'below2', lower: 'lower2' });
  assert.equal(second.params.hatchTo, 'below2', 'its hatch leads to its own below deck');
  const below2 = second.children.find(isPlace);
  assert.equal(below2.key, 'below2');
  assert.equal(below2.objects.find((o) => o.type === 'carrierBelow').params.downTo, 'lower2');
  // a place taken out of its object is no longer a zone (lifting again drops it)
  objects[0].children = objects[0].children.filter((k) => !isPlace(k));
  liftPlaces(scene);
  assert.deepEqual(Object.keys(scene.zones), ['main']);
});

test('the palette: a new carrier comes with its objects; numbering skips places', () => {
  const p = defaultParams('carrier');
  assert.equal(p.hatchTo, 'below');
  const kids = MODELS.carrier.children(p);
  const flat = flattenObjects([{ type: 'carrier', params: p, x: 0, z: 0, children: kids }]);
  assert.equal(flat.length, 1 + kids.filter((k) => !isPlace(k)).length);
  assert.ok(flat.every((e) => !isPlace(e.node)));
  assert.ok(MODELS.group && MODELS.place);
});
