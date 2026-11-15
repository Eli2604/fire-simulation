import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VEHICLE_ZONES, VEHICLE_DIMS, VEHICLE_WEAPONS, vehicleZones, zoneAt, rayZone, hitPart, integrity } from '../src/models/vehicleZones.js';
import { RIG_OBJECTS, RIG_KINDS, VEHICLES, VEHICLE_ACTS, rigKind, rigTargetFor, RIG_BUTTON } from '../src/rig/objects.js';
import { MODELS } from '../src/models/index.js';

test('the Object drop-down: soldier, squad, dragon, phoenix, car, jet, boat; every vehicle has its acts', () => {
  assert.deepEqual(RIG_KINDS, ['soldier', 'squad', 'dragon', 'phoenix', 'car', 'jet', 'jetFlight', 'pilot', 'boat', 'helicopter']);
  assert.ok(RIG_OBJECTS.every((o) => o.label && RIG_BUTTON[o.kind]));
  for (const k of ['squad', 'car', 'jet', 'boat', 'dragon', 'phoenix', 'soldier']) assert.equal(rigKind({ kind: k }), k);
  assert.equal(rigKind({ kind: 'tank' }), 'soldier', 'an unknown kind: the soldier');
  assert.equal(rigKind(undefined), 'soldier');
  assert.deepEqual(Object.keys(VEHICLE_ACTS.car), ['idle', 'drive', 'steer', 'doors', 'burning']);
  assert.deepEqual(Object.keys(VEHICLE_ACTS.jet), ['idle', 'taxi', 'gearUp', 'gearDown', 'flaps', 'afterburner', 'bank', 'eject', 'hit', 'burning', 'critical', 'crash', 'evadeBreak', 'evadeRoll']);
  assert.deepEqual(Object.keys(VEHICLE_ACTS.boat), ['idle', 'cruise', 'turn', 'rough']);
  for (const v of VEHICLES) assert.ok(VEHICLE_ZONES[v] && VEHICLE_DIMS[v], v);
});

test('a scene object opens the rig on its kind (the editor: Rig the …, R)', () => {
  assert.deepEqual(rigTargetFor({ type: 'squad', params: { unit: 'Bravo', flameTrooper: true } }), { kind: 'squad', unit: 'Bravo', flameTrooper: true, droneOperator: false });
  assert.deepEqual(rigTargetFor({ type: 'enemy', params: {} }), { kind: 'soldier', loadout: 'rifle' });
  assert.deepEqual(rigTargetFor({ type: 'dragon' }), { kind: 'dragon' });
  // the catacombs open the rig on their phoenix (unless they have none)
  assert.deepEqual(rigTargetFor({ type: 'catacombs', params: {} }), { kind: 'phoenix' });
  assert.equal(rigTargetFor({ type: 'catacombs', params: { phoenix: false } }), null);
  assert.deepEqual(rigTargetFor({ type: 'car', params: { bodyColor: '#a8322f' } }), { kind: 'car', params: { bodyColor: '#a8322f' } });
  assert.equal(rigTargetFor({ type: 'jet', params: { rockets: 4 } }).kind, 'jet');
  assert.equal(rigTargetFor({ type: 'boat' }).kind, 'boat');
  assert.equal(rigTargetFor({ type: 'wall' }), null);
  assert.equal(rigTargetFor(undefined), null);
  // the editor's types exist (the boat has no scene model yet)
  for (const t of ['squad', 'enemy', 'dragon', 'car', 'jet', 'catacombs']) assert.ok(MODELS[t], t);
});

test('hit parts: each vehicle has the parts asked for, each found at its own centre', () => {
  const keys = (k) => VEHICLE_ZONES[k].map((z) => z.k).sort();
  assert.deepEqual(keys('car'), ['cabin', 'engine', 'fuel', 'tyres']);
  assert.deepEqual(keys('jet'), ['cockpit', 'engines', 'fuel', 'tail', 'wingL', 'wingR']);
  assert.deepEqual(keys('boat'), ['cabin', 'engine', 'fuel', 'hull']);
  for (const kind of VEHICLES)
    for (const Z of vehicleZones(kind)) {
      assert.ok(Z.zone.label && Z.zone.hp > 0 && Z.zone.mult > 0 && Z.zone.effect, `${kind}.${Z.k}`);
      for (const b of Z.boxes) assert.equal(zoneAt(kind, b.c)?.k, Z.k, `${kind}: the middle of ${Z.k}`);
    }
  // the jet's parts are the flight model's (walk/flight.js PARTS: wingL, wingR, engine, tail, fuel)
  assert.deepEqual(VEHICLE_ZONES.jet.map((z) => z.sim).filter(Boolean).sort(), ['engine', 'fuel', 'tail', 'wingL', 'wingR']);
  // left is -z
  assert.ok(vehicleZones('jet').find((z) => z.k === 'wingL').boxes[0].c[2] < 0);
  assert.equal(zoneAt('car', [0, 3, 0]), null, 'above the roof: nothing');
  // the fuel tank under the rear seat is inside the cabin box: the tank wins
  assert.equal(zoneAt('car', [-0.96, 0.6, 0])?.k, 'fuel');
});

test('tyres and engines are round: a corner of their box is not them', () => {
  const t = vehicleZones('car').find((z) => z.k === 'tyres').boxes[0];
  assert.equal(zoneAt('car', [t.c[0] + t.h[0] * 0.95, t.c[1] + t.h[1] * 0.95, t.c[2]]), null);
  assert.equal(zoneAt('car', [t.c[0] + t.h[0] * 0.6, t.c[1], t.c[2]])?.k, 'tyres');
});

test('a ray finds the first part it meets', () => {
  // down onto the car's bonnet: the engine; from the side through the doors: the cabin
  assert.equal(rayZone('car', [1.4, 5, 0], [0, -1, 0])?.k, 'engine');
  assert.equal(rayZone('car', [-0.2, 1.1, -6], [0, 0, 1])?.k, 'cabin');
  // from behind along a nacelle: the engine
  const r = rayZone('jet', [-20, 1.42, 0.95], [1, 0, 0]);
  assert.equal(r?.k, 'engines');
  assert.ok(Math.abs(r.p[0] - -7.0) < 0.05, 'at the back of the nacelle');
  // down onto the boat's middle: the cabin roof first, aft of it the hull
  assert.equal(rayZone('boat', [0.45, 5, 0], [0, -1, 0])?.k, 'cabin');
  assert.equal(rayZone('boat', [-1.0, 5, -0.4], [0, -1, 0])?.k, 'hull');
  assert.equal(rayZone('jet', [0, 30, 0], [0, 0, 1]), null, 'a miss');
  // past a tyre's rounded corner the ray goes on (to nothing here)
  assert.equal(rayZone('car', [1.344 + 0.32, 0.33 - 0.32, -6], [0, 0, 1]), null);
});

test('the zones scale with the sliders and the vehicle\'s size', () => {
  const eng = VEHICLE_ZONES.jet.find((z) => z.k === 'engines');
  const h0 = vehicleZones('jet').find((z) => z.k === 'engines').boxes[0].h.slice();
  eng.len = 1.5;
  eng.size = 0.5;
  const h1 = vehicleZones('jet').find((z) => z.k === 'engines').boxes[0].h;
  eng.len = eng.size = 1;
  assert.ok(Math.abs(h1[0] - h0[0] * 1.5) < 1e-9, 'length along its axis (x)');
  assert.ok(Math.abs(h1[1] - h0[1] * 0.5) < 1e-9 && Math.abs(h1[2] - h0[2] * 0.5) < 1e-9, 'size across');
  // a small car (the deck's 2.8 m one): the engine is still at its front
  const small = [2.8, 1.1, 1.6];
  const e = vehicleZones('car', small).find((z) => z.k === 'engine').boxes[0];
  assert.ok(e.c[0] > 0.5 && e.c[0] + e.h[0] <= 1.41, 'inside the 2.8 m car, at its front');
  assert.equal(zoneAt('car', e.c, small)?.k, 'engine');
});

test('damage: by multiplier and hit points, a part destroyed once, integrity goes down', () => {
  const dmg = {};
  const r = hitPart(dmg, 'car', 'engine', VEHICLE_WEAPONS.bullet);
  assert.equal(r.amount, 25 * 1.5);
  assert.ok(Math.abs(dmg.engine - 37.5 / 120) < 1e-9);
  assert.equal(r.destroyed, false);
  assert.ok(integrity(dmg, 'car') < 1);
  const r2 = hitPart(dmg, 'car', 'engine', VEHICLE_WEAPONS.rocket);
  assert.equal(r2.destroyed, true);
  assert.equal(dmg.engine, 1);
  assert.equal(hitPart(dmg, 'car', 'engine', 25).destroyed, false, 'already gone');
  assert.equal(hitPart(dmg, 'car', 'rotor', 25), null);
  // a rocket in the fuel tank of a boat: gone; everything gone: integrity 0
  assert.equal(hitPart({}, 'boat', 'fuel', VEHICLE_WEAPONS.rocket).destroyed, true);
  const all = Object.fromEntries(VEHICLE_ZONES.jet.map((z) => [z.k, 1]));
  assert.equal(integrity(all, 'jet'), 0);
  assert.equal(integrity({}, 'jet'), 1);
});
