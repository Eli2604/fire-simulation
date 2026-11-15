import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Helicopter, HELI, heliToWorld, heliRayHit, heliOccupantHit, cockpitOccupants } from '../src/ai/helicopter.js';
import { createSimulation } from '../src/sim/createSimulation.js';
import { shoot } from '../src/sim/wounds.js';

const F = HELI.floor;
/** A helicopter hovering in a bare world; host.playerHit records the rounds into you. */
function rig(o = {}) {
  const world = { time: 0, events: [], noises: [], enemies: [], ropes: [] };
  const hits = [];
  const h = new Helicopter({ p: [0, 0, 0], lz: [0, 0, 0], mission: 'hover', altitude: 20, seed: 9, ...o }, { world, sim: { world }, addCrew: (e) => world.enemies.push(e), playerHit: (zone, weapon, p) => hits.push({ zone, weapon, p }) });
  return { h, world, hits };
}
/** A round from local point a towards local point b (as HeliAI.shot does it: the part first, then on). */
function fire(h, a, b, weapon = 'rifle') {
  const from = heliToWorld(h, a), to = heliToWorld(h, b);
  const dir = to.map((v, i) => v - from[i]);
  const r = heliRayHit(h, from, dir, 100, 1);
  if (!r) return null;
  h.hit(r.k, 25, r.p, dir, weapon);
  return r;
}
const PILOT_TORSO = [2.75, F + 0.72, 0.5];

test('flying it yourself: a round through your side of the cockpit hits you (where it meets you), not before you are out', () => {
  const { h, hits, world } = rig();
  h.board();
  const r = fire(h, [PILOT_TORSO[0], PILOT_TORSO[1], 25], PILOT_TORSO);
  assert.equal(r?.k, 'cockpit', 'through the glass');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].zone, 'torso');
  assert.equal(hits[0].weapon, 'rifle');
  const ev = world.events.findLast((e) => e.type === 'heliHit');
  assert.equal(ev.occupant, 'player');
  // the head, the legs: where the round goes
  fire(h, [2.78, F + 1.12, 25], [2.78, F + 1.12, 0.5]);
  fire(h, [3.25, F + 0.35, 25], [3.25, F + 0.35, 0.5]);
  assert.deepEqual(hits.map((x) => x.zone), ['torso', 'head', 'legs']);
  // high over the men's heads, through the top of the glass: past you
  const n = hits.length;
  fire(h, [3.0, F + 1.4, 25], [3.0, F + 1.4, 0]);
  assert.equal(hits.length, n, 'over your head');
});

test('the seat\'s armour stops a round from behind; from the left the co-pilot is hit before you', () => {
  const { h, hits, world } = rig({ side: 'friendly' }); // (a friendly crew stay aboard when you take it)
  h.board();
  // from astern, low, along the right seat's line: through the cabin into the back of the seat
  const r = fire(h, [-14, F + 0.75, 0.5], [3.5, F + 0.75, 0.5]);
  assert.ok(r, 'it hit the helicopter');
  const ev = world.events.findLast((e) => e.type === 'heliHit');
  assert.equal(ev.occupantZone, 'seat', `${r.k}: the armoured seat back`);
  assert.equal(hits.length, 0, 'not you');
  // from the left: the co-pilot is in the way
  const co = h.crew.find((e) => e.role === 'copilot');
  const hp = co.health;
  fire(h, [PILOT_TORSO[0], PILOT_TORSO[1], -25], [PILOT_TORSO[0], PILOT_TORSO[1], 0.5]);
  assert.ok(co.health < hp, 'the co-pilot hit');
  assert.equal(hits.length, 0);
});

test('the same for its own pilot: the round that would hit you at the controls hits him', () => {
  const { h, hits } = rig({ side: 'friendly' });
  const pilot = h.crew.find((e) => e.role === 'pilot');
  assert.ok(cockpitOccupants(h).some((o) => o.who === pilot));
  fire(h, [PILOT_TORSO[0], PILOT_TORSO[1], 25], PILOT_TORSO);
  assert.ok(pilot.health < 100, 'the pilot hit');
  assert.equal(hits.length, 0, 'you are not in it');
  // you take the controls: he moves to the back (relieved): the seat is yours
  h.board();
  const occ = cockpitOccupants(h);
  assert.ok(occ.some((o) => o.who === 'player') && !occ.some((o) => o.who === pilot));
  assert.equal(heliOccupantHit(h, heliToWorld(h, [2.75, F + 0.72, 10]), heliToWorld(h, [0, 0, -1]).map((v, i) => v - h.p[i]), 20)?.who, 'player');
});

test('in the simulation: a soldier\'s rounds at the helicopter you fly hit you in it (world.playerHits at once)', () => {
  const sim = createSimulation({ world: { size: [40, 12, 40], h: 1, ground: 'soil' }, objects: [{ type: 'helicopter', params: { mission: 'hover', fromX: 0, fromZ: -30, altitude: 15, soldiers: 2, doorGuns: 'none', side: 'friendly' }, x: 20, z: 20, rotation: 0 }], noFire: true });
  const w = sim.world;
  for (let i = 0; i < 60; i++) sim.step(0.05);
  const h = w.helis[0].ai;
  h.board();
  sim.ai.player = null; // (flying: walk.js takes you off the ground; the helicopter is the contact)
  w.playerHits.length = 0;
  const shooter = { p: [0, 0, 0], side: 'red', squad: 'R1' };
  const from = heliToWorld(h, [PILOT_TORSO[0], PILOT_TORSO[1], 18]);
  const at = heliToWorld(h, PILOT_TORSO);
  const r = shoot(sim, from, at.map((v, i) => v - from[i]), { shooter, range: 60, weapon: 'rifle' });
  assert.equal(r?.heli, h);
  assert.equal(r.zone, 'cockpit');
  assert.equal(w.playerHits.length, 1, 'the round reached you behind the glass');
  assert.equal(w.playerHits[0].zone, 'torso');
});
