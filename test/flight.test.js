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
    open: () => Object.entries(scene.zones).filter(([, z]) => z.origin).map(([name, z]) => ({ name, origin: z.origin, size: z.world.size, approach: z.approach ?? 0 })),
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
    endFlight: (msg, at, zone, orphan) => {
      walk.ended = { msg, at, zone, orphan };
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
    // the simulation in its own (0.2 s) steps
    c.acc = (c.acc ?? 0) + dt;
    if (c.acc >= 0.2) {
      c.zones.sim(c.zones.current()).advance(c.acc, 1000);
      c.acc = 0;
    }
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

test('jet: flying into the sea is a crash; the seat fires, you come down in the sea and are brought back to the ship', () => {
  const c = carrierWorld();
  const f = c.board();
  f.onGround = false;
  f.pos.set(-30, f.seaLevel + 3, -30); // over open sea
  f.speed = 60;
  f.pitch = -0.6;
  fly(c, f, 1.5);
  assert.ok(f.jetGone && f.pilot, 'the jet is gone, you are out');
  for (let k = 0; k < 40 && !f.done; k++) fly(c, f, 0.5);
  assert.ok(f.done, 'down');
  assert.match(c.walk.ended.msg, /boat|fished/);
  assert.equal(c.walk.ended.zone, 'deck');
});

test('jet: shot to pieces in the air, it explodes; the seat fires you out and the parachute brings you down slowly', () => {
  const c = carrierWorld();
  const f = c.board();
  f.onGround = false;
  f.pos.set(-60, f.seaLevel + 250, -60);
  f.speed = 90;
  f.dmg.wingL = f.dmg.wingR = 1;
  fly(c, f, 0.4);
  assert.ok(f.jetGone, 'the jet broke up');
  assert.ok(f.pilot && !f.done, 'you are out, still in the air');
  fly(c, f, 4);
  assert.ok(f.pilot.chute, 'parachute open');
  assert.ok(-f.pilot.v.y < 7, `sinking slowly (${(-f.pilot.v.y).toFixed(1)} m/s)`);
  // and it steers
  const x0 = f.pilot.p.x;
  const z0 = f.pilot.p.z;
  f.keys = new Set(['KeyD']);
  fly(c, f, 3);
  assert.ok(Math.hypot(f.pilot.p.x - x0, f.pilot.p.z - z0) > 3, 'drifts where you steer');
});

test('stand-ins for the zones you are not in', () => {
  const c = carrierWorld();
  const r = new ProxyRenderer(new THREE.Scene());
  r.update([
    { name: 'deck', offset: [-105, 0, 30], world: c.deck.world, sea: c.deck.world.sea.level, size: c.deck.world.size },
    { name: 'island', offset: [0, 0, 0], hint: { shape: 'hill', color: '#5f7a3a' }, sea: 2.9, size: [40, 17, 36] },
  ]);
  // the carrier: its drawn hull and flight deck, and columns for what stands on the deck
  const deck = r.items.get('deck').obj;
  const cols = deck.children.find((o) => o.isInstancedMesh);
  assert.ok(cols.count > 20, `${cols.count} columns above the deck (island, jet)`);
  assert.ok(deck.children.length > 1, 'the hull drawn');
  assert.ok(r.items.get('island'), 'a placeholder for the unbuilt island');
});

test('jet: eject over the island, come down under the parachute and walk on there; the empty jet crashes and explodes', () => {
  const c = carrierWorld();
  c.scene.weather.windSpeed = 0;
  for (const s of Object.values(c.sims)) s.weather.windSpeed = 0;
  const f = c.board();
  const isl = c.scene.zones.island;
  const centre = new THREE.Vector3(isl.origin[0] + 13, 0, isl.origin[2] + 21); // the plateau (the middle of the island is the canal)
  f.onGround = false;
  f.pos.set(centre.x - 50, f.seaLevel + 35, centre.z);
  f.heading = 0;
  f.speed = 60;
  f.throttle = 0.6;
  fly(c, f, 0.2);
  f.eject();
  assert.ok(f.pilot, 'ejected');
  // steer the canopy round the middle of the island (as a player would)
  const t0 = performance.now();
  for (let k = 0; k < 30 * 40 && !c.walk.ended; k++) {
    if (f.pilot && !f.pilot.landed) f.pilot.heading = Math.atan2(-(centre.z - f.pilot.p.z), centre.x - f.pilot.p.x);
    f.update(1 / 30, new Set());
    if (k % 6 === 0) c.zones.sim(c.zones.current()).advance(0.2, 1000);
  }
  void t0;
  assert.ok(c.walk.ended, 'down');
  assert.ok(c.walk.ended.at, `landed on solid ground: ${c.walk.ended.msg}`);
  assert.equal(c.zones.current(), 'island');
  assert.ok(f.pilot.chute, 'under an open parachute');
  // the jet without pilot: it keeps flying until it comes down, then explodes
  const orphan = c.walk.ended.orphan ?? f;
  for (let k = 0; k < 30 * 60 && !orphan.jetGone; k++) orphan.update(1 / 30, new Set());
  assert.ok(orphan.jetGone, 'the jet came down');
  const blasts = Object.values(c.sims).flatMap((s) => s.world.events.filter((e) => e.name === 'jet crash'));
  assert.ok(blasts.length >= 1 || !orphan.zoneAt(orphan.pos), 'it exploded where it hit (if it hit a zone)');
});

test('jet: eject over open sea: the ship\'s boat picks you up', () => {
  const c = carrierWorld();
  const f = c.board();
  f.onGround = false;
  f.pos.set(-80, f.seaLevel + 25, -80);
  f.speed = 50;
  f.eject();
  for (let k = 0; k < 30 * 30 && !c.walk.ended; k++) f.update(1 / 30, new Set());
  assert.ok(c.walk.ended, 'down');
  assert.match(c.walk.ended.msg, /boat/);
  assert.equal(c.walk.ended.zone, 'deck');
});

test('jet: boost out of the atmosphere, fly to the spaceship (built on approach), dock, go aboard, undock', () => {
  const c = carrierWorld();
  const f = c.board();
  f.onGround = false;
  f.pos.set(30, f.seaLevel + 300, 60);
  f.speed = 120;
  f.pitch = 1.3; // nose up
  f.throttle = 1;
  f.keys = new Set(['KeyB', 'KeyW']);
  let climbed = false;
  fly(c, f, 25, (fl) => {
    fl.pitch = 1.3;
    if (fl.vel) climbed = true;
  });
  assert.ok(!f.done, c.walk.ended?.msg);
  assert.ok(climbed, `above the atmosphere (alt ${(f.pos.y - f.seaLevel).toFixed(0)} m, air ${(f.rho() * 100).toFixed(1)} %)`);
  assert.ok(f.gravity() < 3, 'hardly any gravity up here');
  assert.equal(c.zones.built('spaceship'), false, 'not built yet');
  // line up 40 m from the docking port and drift in slowly
  const ss = c.scene.zones.spaceship;
  const port = new THREE.Vector3(ss.origin[0] + 20, ss.origin[1] + 1.1, ss.origin[2] + 14);
  f.keys = new Set();
  f.throttle = 0;
  f.pos.copy(port).add(new THREE.Vector3(0, -1.6, 40));
  f.heading = Math.PI / 2; // nose towards -z, at the ship
  f.pitch = 0;
  f.roll = 0;
  f.vel = new THREE.Vector3(0, 0, -3);
  fly(c, f, 20);
  assert.ok(c.zones.built('spaceship'), 'the spaceship was built as we came close');
  assert.ok(c.walk.ended?.orphan?.docked, `docked: ${c.walk.ended?.msg}`);
  assert.equal(c.zones.current(), 'spaceship');
  assert.ok(c.walk.ended.at, 'you go aboard through the airlock');
  // back into the jet
  f.undock();
  assert.ok(!f.docked && f.vel.length() > 0, 'pulling away');
});

test('jet: too fast at the docking port: no docking; ramming the hull is a crash', () => {
  const c = carrierWorld();
  const f = c.board();
  const ss = c.scene.zones.spaceship;
  const port = new THREE.Vector3(ss.origin[0] + 20, ss.origin[1] + 1.1, ss.origin[2] + 14);
  f.onGround = false;
  f.pos.copy(port).add(new THREE.Vector3(0, -1.6, 30));
  f.heading = Math.PI / 2;
  f.vel = new THREE.Vector3(0, 0, -25);
  f.speed = 25;
  fly(c, f, 3);
  assert.ok(f.done, 'crashed');
  assert.match(c.walk.ended.msg, /rammed/);
  const w = c.sims.spaceship.world;
  assert.ok(w.events.some((e) => e.name === 'jet crash'), 'it exploded against the ship');
});
