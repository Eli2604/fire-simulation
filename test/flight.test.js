import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSimulation } from '../src/sim/createSimulation.js';
import { SCENARIOS, cloneScene } from '../src/scenarios.js';
import { Flight } from '../src/walk/flight.js';
import { ProxyRenderer } from '../src/render/proxies.js';

// the flight code runs in the browser; give it the little it needs
globalThis.document ??= { createElement: () => ({ style: {}, remove() {} }), body: { appendChild() {} } };

/** The carrier scene with zones built on demand, like main.js does. */
function carrierWorld() {
  const scene = cloneScene(SCENARIOS.carrier);
  const sims = {};
  let current = scene.startZone;
  const get = (name) => (sims[name] ??= createSimulation({ ...scene, zone: name }));
  const zones = {
    current: () => current,
    origin: (name) => scene.zones[name]?.origin ?? null,
    open: () => Object.entries(scene.zones).filter(([, z]) => z.origin).map(([name, z]) => ({ name, origin: z.origin, size: z.world.size })),
    built: (name) => !!sims[name],
    sim: get,
    activate: (name) => {
      current = name;
      return get(name);
    },
  };
  const said = [];
  const walk = {
    view: { scene: new THREE.Scene(), flames: { spawn() {} }, camera: new THREE.PerspectiveCamera() },
    hooks: { zones },
    sound: { running: false },
    say: (t) => said.push(t),
    endFlight: (msg, at, zone) => {
      walk.ended = { msg, at, zone };
    },
  };
  const deck = get('deck');
  return { scene, sims, zones, walk, said, deck, board: () => new Flight(walk, deck, deck.world.vehicles[0]) };
}

/** Advance the flight and the simulation of the zone being shown. */
function fly(c, f, seconds, control = () => {}) {
  const dt = 1 / 30;
  for (let t = 0; t < seconds && !f.done; t += dt) {
    control(f, t);
    f.update(dt, f.keys ?? new Set());
    c.zones.sim(c.zones.current()).advance(dt, 1000);
  }
}

test('jet: catapult take-off, climb, fly to the island (built on the way) and rocket it', () => {
  const c = carrierWorld();
  const f = c.board();
  assert.equal(c.deck.world.vehicles.length, 0, 'boarded: the parked voxels are gone');
  // point at the island
  const isl = c.scene.zones.island;
  const target = new THREE.Vector3(isl.origin[0] + 20, 6, isl.origin[2] + 14);
  f.heading = Math.atan2(-(target.z - f.pos.z), target.x - f.pos.x);
  f.keys = new Set(['KeyW']);
  f.throttle = 1;
  fly(c, f, 1.2);
  assert.ok(f.speed > 40, `catapult speed ${f.speed.toFixed(0)} m/s`);
  fly(c, f, 0.6, (fl) => (fl.pitchIn = 0.8));
  assert.ok(!f.done, 'still flying');
  assert.ok(f.pos.y > f.seaLevel + 4, `airborne (alt ${(f.pos.y - f.seaLevel).toFixed(1)} m)`);
  assert.equal(c.zones.built('island'), false, `the island is not built yet (jet at x ${f.pos.x.toFixed(0)})`);
  // 120 m out at 30 m altitude: aim at the island and fire a salvo, pulling up in between
  f.pos.set(target.x - 120, f.seaLevel + 30, target.z);
  f.heading = 0;
  f.speed = 70;
  const aim = (fl) => {
    const d = target.clone().sub(fl.pos);
    fl.heading = Math.atan2(-d.z, d.x);
    fl.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  };
  for (let k = 0; k < 3; k++) {
    aim(f);
    f.fireRequested = true;
    fly(c, f, 0.4, (fl, t) => {
      if (t > 0.05) {
        fl.pitch = 0.2;
        fl.vy = Math.max(fl.vy, 0);
      }
    });
  }
  // climb away and let the rockets arrive
  fly(c, f, 3, (fl) => {
    fl.pitch = 0.35;
    fl.vy = Math.max(fl.vy, 2);
  });
  assert.ok(!f.done, c.walk.ended?.msg);
  assert.ok(c.zones.built('island'), 'the rockets brought the island in');
  const w = c.sims.island.world;
  const blasts = w.events.filter((e) => e.type === 'explosion' && e.name === 'rocket');
  assert.ok(blasts.length >= 1, `${blasts.length} rocket explosions on the island`);
  assert.equal(f.rockets, (c.deck.world.vehicles[0]?.rockets ?? 8) - 3);
});

test('jet: blasts damage the parts nearby; a damaged wing rolls the jet, a dead engine gives no thrust', () => {
  const c = carrierWorld();
  const f = c.board();
  const { q } = f.axes();
  f.blastDamage(f.at(q, [-0.8, 1.5, 4]), 3, q);
  assert.ok(f.dmg.wingR > 0.3, `right wing ${f.dmg.wingR.toFixed(2)}`);
  assert.ok(f.dmg.wingR > f.dmg.wingL, 'the far wing less');
  // in the air, hands off: it rolls towards the damaged (right) wing
  f.onGround = false;
  f.pos.y += 60;
  f.speed = 80;
  f.roll = 0;
  fly(c, f, 0.3);
  assert.ok(f.roll > 0.1, `rolled right (${f.roll.toFixed(2)} rad)`);
  // a destroyed engine: no thrust, the jet slows down
  const g = carrierWorld().board();
  g.dmg.engine = 1;
  g.keys = new Set(['KeyW']);
  g.throttle = 1;
  fly(c, g, 2);
  assert.ok(g.speed < 5, `no thrust (${g.speed.toFixed(1)} m/s)`);
});

test('jet: flying into the sea is a crash; you are brought back to the ship', () => {
  const c = carrierWorld();
  const f = c.board();
  f.onGround = false;
  f.pos.set(-30, f.seaLevel + 3, -30); // over open sea
  f.speed = 60;
  f.pitch = -0.6;
  fly(c, f, 3);
  assert.ok(f.done, 'crashed');
  assert.match(c.walk.ended.msg, /sea/);
  assert.equal(c.walk.ended.zone, 'deck');
});

test('stand-ins for the zones you are not in', () => {
  const c = carrierWorld();
  const r = new ProxyRenderer(new THREE.Scene());
  r.update([
    { name: 'deck', offset: [-105, 0, 30], world: c.deck.world, sea: c.deck.world.sea.level, size: c.deck.world.size },
    { name: 'island', offset: [0, 0, 0], hint: { shape: 'hill', color: '#5f7a3a' }, sea: 2.9, size: [40, 17, 36] },
  ]);
  const deck = r.items.get('deck').obj;
  assert.ok(deck.count > 300, `${deck.count} deck columns`);
  assert.ok(r.items.get('island'), 'a placeholder for the unbuilt island');
});
