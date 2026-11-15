import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Helicopter, HELI, heliAxes, heliToWorld, BOOM_ROOT } from '../src/ai/helicopter.js';
import { hostile, sideOf, squadHostiles } from '../src/ai/sides.js';
import { stepRopes } from '../src/ai/rope.js';
import { createHeliStage, TARGET_HP } from '../src/rig/heliStage.js';
import { createSimulation } from '../src/sim/createSimulation.js';
import { HeliFlight } from '../src/walk/heliFlight.js';

/** A bare world and a helicopter in it (ground at 0), stepped with the rope module as the simulation would. */
function rig(o = {}, extra = {}) {
  const world = { time: 0, events: [], noises: [], enemies: [], ropes: [] };
  const sim = { world, solid: (x, y) => y < 0 };
  const h = new Helicopter({ p: [0, 0, 0], lz: [0, 0, 0], seed: 5, ...o }, { sim, world, addCrew: (e) => world.enemies.push(e), ...extra });
  const run = (s, dt = 0.05, until = null) => {
    for (let t = 0; t < s; t += dt) {
      world.time += dt;
      h.step(dt);
      stepRopes(sim, dt);
      if (until?.()) return true;
    }
    return false;
  };
  return { h, world, run };
}
const fwd = (h) => h.v[0] * Math.sin(h.yaw) + h.v[2] * Math.cos(h.yaw);

test('sides: you and friendly helicopters blue, the soldiers red, a dragon everybody\'s enemy', () => {
  assert.equal(sideOf({ squad: 'R1' }), 'red');
  assert.equal(sideOf({ isPlayer: true }), 'blue');
  assert.equal(sideOf({ spine: [] }), 'beast');
  assert.ok(hostile('red', 'blue') && hostile('beast', 'red') && !hostile('red', 'red') && !hostile('neutral', 'red'));
  const w = { enemies: [{ p: [0, 0, 0] }, { p: [1, 0, 0], side: 'blue' }, { p: [2, 0, 0], side: 'blue', aboard: 'x' }], helis: [] };
  const pl = { p: [5, 0, 5] };
  assert.deepEqual(squadHostiles(w, 'red', pl), [pl, w.enemies[1]], 'a red team: you and the blue man on the ground');
  assert.deepEqual(squadHostiles(w, 'blue', pl), [w.enemies[0]], 'a blue team: the red one');
});

test('you board it on the ground and fly it: the collective climbs, the cyclic speeds it up, the pedals turn it', () => {
  const { h, world, run } = rig({ airborne: false, autoStart: false, mission: 'land', side: 'friendly', soldiers: 4 });
  const pilot = h.crew.find((e) => e.role === 'pilot');
  assert.ok(h.board());
  assert.equal(h.mode, 'player');
  assert.ok(pilot.relieved && pilot.aboard === h.id, 'the friendly pilot hands over and sits in the back');
  assert.equal(h.pilots().length, 1, 'only the co-pilot at the controls with you');
  // the rotor runs up first: it does not lift before it can
  h.controls = { collective: 1, pitch: 0, roll: 0, pedal: 0 };
  run(3);
  assert.ok(h.landed && h.p[1] === 0, 'not before the rotor is up');
  run(10);
  assert.ok(!h.landed && h.p[1] > 5, `climbing (${h.p[1].toFixed(1)} m)`);
  // the collective in the middle: it holds its height
  h.controls = { collective: 0, pitch: 0, roll: 0, pedal: 0 };
  run(3);
  const y0 = h.p[1];
  run(3);
  assert.ok(Math.abs(h.p[1] - y0) < 1, `holds its height (${y0.toFixed(1)} → ${h.p[1].toFixed(1)})`);
  // the cyclic forward: the nose down, faster and faster along it
  const yaw0 = h.yaw;
  h.controls = { collective: 0.2, pitch: 1, roll: 0, pedal: 0 };
  run(6);
  assert.ok(h.pitch < -0.3, `nose down (${h.pitch.toFixed(2)})`);
  assert.ok(fwd(h) > 15, `speeding up forward (${fwd(h).toFixed(1)} m/s)`);
  assert.ok(Math.abs(h.yaw - yaw0) < 0.05, 'still the same heading');
  // the pedals: the nose round (at a hover)
  h.controls = { collective: 0, pitch: -0.6, roll: 0, pedal: 0 };
  run(10);
  const yaw1 = h.yaw;
  h.controls = { collective: 0, pitch: 0, roll: 0, pedal: 1 };
  run(2);
  assert.ok(h.yaw - yaw1 > 1, `turned left (${(h.yaw - yaw1).toFixed(2)} rad)`);
  // and down again, gently: a touchdown, and out
  h.controls = { collective: -0.5, pitch: 0, roll: 0, pedal: 0 };
  assert.ok(run(60, 0.05, () => h.landed));
  assert.ok(!h.crashed, 'landed, not crashed');
  assert.equal(h.mode, 'player', 'still yours on the ground');
  h.unboard();
  assert.equal(h.mode, 'shutdown');
  assert.ok(!pilot.relieved, 'the pilot back in his seat');
  assert.ok(world.events.some((e) => e.type === 'heliTouchdown'));
});

test('the keys and the mouse: W climbs, the mouse up raises the nose, A turns left (walk/heliFlight.js)', () => {
  const c = HeliFlight.controlsFrom(new Set(['KeyW', 'KeyA', 'ArrowUp']), [0, 0], 0, 1);
  assert.equal(c.collective, 1);
  assert.equal(c.pedal, 1);
  assert.equal(c.pitch, 1, 'the arrow up: forward');
  assert.equal(HeliFlight.controlsFrom(new Set(), [0.5, -0.3], 0, 0.1).pitch, -0.5, 'mouse up: nose up');
});

test('boarding an enemy helicopter: its crew get out and fight; it is yours (blue)', () => {
  const { h } = rig({ airborne: false, autoStart: false, mission: 'land', soldiers: 3 });
  assert.equal(h.side, 'red');
  h.board();
  assert.equal(h.side, 'blue');
  assert.ok(h.crew.every((e) => e.aboard == null && !e.guardCtl), 'all out, their squads have them');
});

test('a tail rotor shot away while you fly: the pedals do nothing, it spins faster and faster', () => {
  const { h, run } = rig({ startAlt: 60, startSpeed: 0, mission: 'hover', side: 'friendly' });
  h.board();
  h.controls = { collective: 0, pitch: 0, roll: 0, pedal: 0 };
  run(2);
  h.hit('tailRotor', 400);
  assert.equal(h.failure, 'tail');
  assert.equal(h.mode, 'player', 'still yours to fly');
  h.controls = { collective: 0, pitch: 0, roll: 0, pedal: 1 }; // full left pedal: nothing to push against
  run(1);
  const r1 = Math.abs(h.yawRate);
  run(1.5);
  const r2 = Math.abs(h.yawRate);
  assert.ok(h.yawRate < 0 && r1 > 0.8 && r2 > r1 + 0.8, `spinning nose right, faster (${r1.toFixed(2)} → ${r2.toFixed(2)} rad/s)`);
  // the main rotor gone too: nothing to fly with
  h.hit('rotor', 1000);
  assert.equal(h.mode, 'falling');
});

test('the crew tilt with it: a man\'s place, his eye and his axes turn with its pitch and roll', () => {
  const { h, world } = rig({ startAlt: 30, startSpeed: 0, mission: 'hover', soldiers: 4 });
  const e = world.enemies.find((x) => x.role === 'troop');
  const seat = h.seats[e.seat].at;
  h.placeCrew();
  const level = e.p.slice();
  h.pitch = 0.3;
  h.roll = -0.25;
  h.placeCrew();
  const want = heliToWorld(h, seat);
  assert.ok(Math.hypot(...e.p.map((v, i) => v - want[i])) < 1e-9, 'his feet at his seat in the tilted frame');
  assert.ok(Math.hypot(...e.p.map((v, i) => v - level[i])) > 0.05, 'moved with the tilt');
  const A = heliAxes(h.yaw, h.pitch, h.roll);
  assert.deepEqual(e.frame.u, A.u, 'his up is its up (render/enemies.js tilts the figure)');
  const up = norm(e.eye.map((v, i) => v - e.p[i]));
  assert.ok(up[0] * A.u[0] + up[1] * A.u[1] + up[2] * A.u[2] > 0.999, 'his eye straight up from his seat along its axis');
  assert.ok(up[1] < 0.99, 'not straight up in the world');
});
const norm = (a) => {
  const l = Math.hypot(...a) || 1;
  return a.map((v) => v / l);
};

test('the door gunner engages an enemy he has identified; not a friendly, not one nobody has seen; the rounds wound', () => {
  const sim = createSimulation({ world: { size: [40, 12, 40], h: 1, ground: 'soil' }, objects: [{ type: 'helicopter', params: { side: 'friendly', mission: 'hover', fromX: 0, fromZ: 15, altitude: 14, soldiers: 2, doorGuns: 'both' }, x: 20, z: 20, rotation: 0 }], noFire: true });
  const w = sim.world;
  const man = (p, side) => ({ p, home: p.slice(), health: 100, state: 'patrol', yaw: 0, side, guardCtl: true, name: `${side} man` });
  // it comes in from +z and hovers facing -z: the right door looks to +x, the left to -x; behind it
  // (+z, where it came from) neither a door nor the glass
  const foe = man([35, 1, 19], 'red');
  const friend = man([5, 1, 19], 'blue');
  const hidden = man([20, 1, 39], 'red');
  sim.step(0.05);
  w.enemies.push(foe, friend, hidden);
  const h = w.helis[0].ai;
  const ever = new Set();
  for (let i = 0; i < 160; i++) {
    sim.step(0.05);
    for (const x of [foe, friend, hidden]) if (h.knows(x)) ever.add(x);
  }
  assert.equal(h.side, 'blue');
  assert.ok(ever.has(foe), 'the enemy out of the right door: identified');
  assert.ok(!ever.has(friend), 'the friendly is not a contact to engage');
  assert.ok(!ever.has(hidden), 'the one behind it: nobody saw him');
  const shots = h.lastShots ?? [];
  assert.ok(h.shots > 0 && shots.length, 'the guns fired');
  assert.ok(shots.every((s) => s.at === foe), 'every round at the identified enemy');
  assert.ok(foe.dead || foe.health < 100, `he is hit (${foe.health.toFixed(0)} HP)`);
  assert.equal(friend.health, 100, 'the friendly untouched');
  assert.equal(hidden.health, 100, 'the unseen one untouched');
});

test('shot at, the crew pick out the one shooting first', () => {
  const { h, run } = rig({ startAlt: 15, startSpeed: 0, mission: 'hover', soldiers: 1, doorGuns: 'right', side: 'friendly' }, {
    contacts: () => [
      { key: 'a', ref: 'a', kind: 'soldier', side: 'red', p: [-30, 0, 0], at: [-30, 1.2, 0] },
      { key: 'b', ref: 'b', kind: 'soldier', side: 'red', p: [-45, 0, 8], at: [-45, 1.2, 8] },
    ],
    fire: () => null,
  });
  run(3);
  assert.ok(h.knows('a') && h.knows('b'));
  assert.equal(h.guns.R.target?.ref, 'a', 'the nearer one, at first');
  h.underFire([-45, 1.4, 8], null);
  run(0.5);
  assert.equal(h.guns.R.target?.ref, 'b', 'then the one shooting at them');
});

test('the tail boom shot through breaks off: one piece (boom, fin, tail rotor) falls and lies on the ground', () => {
  const { h, run } = rig({ startAlt: 50, startSpeed: 0, mission: 'hover', hoverAlt: 50, ropeLength: 60 });
  run(1);
  h.hit('tailBoom', 1000);
  assert.ok(h.gone.has('tailBoom') && h.gone.has('tailRotor') && h.failure === 'tail');
  const b = h.debris.find((d) => d.kind === 'tailBoom');
  assert.ok(b, 'the boom is a piece of its own');
  assert.ok(!h.debris.some((d) => d.kind === 'tailRotor'), 'the tail rotor goes with it');
  const root = heliToWorld(h, BOOM_ROOT);
  assert.ok(Math.hypot(...b.p.map((v, i) => v - root[i])) < 0.5, 'it broke at its root');
  run(1.5);
  assert.ok(b.p[1] < root[1] - 5 && Math.abs(b.pitch - h.pitch) > 0.3, 'falling, tumbling');
  run(10);
  assert.ok(b.rest && b.p[1] < 1, 'lying on the ground');
  assert.ok(h.pitch < -0.1 || h.crashed, 'without its weight aft the nose dropped');
});

test('you order the troops down: at a low steady hover they fast-rope, the ropes are cut, you fly on', () => {
  const { h, world, run } = rig({ startAlt: 10, startSpeed: 0, mission: 'hover', soldiers: 4, doorGuns: 'none', side: 'friendly', ropeLength: 20 });
  h.board();
  h.controls = { collective: 0, pitch: 0, roll: 0, pedal: 0 };
  run(2);
  assert.equal(h.playerRopes(), null);
  assert.ok(run(30, 0.05, () => world.ropes.length > 0), 'cables out');
  assert.ok(run(60, 0.05, () => h.ropesCut), 'all down, cut');
  assert.ok(h.crew.filter((e) => e.role === 'troop').every((e) => e.aboard == null), 'the troops are out');
  assert.equal(h.mode, 'player', 'still yours');
});

test('the rig stage: the door gunners\' rounds damage the targets, and knock them down', () => {
  const st = createHeliStage();
  st.play('doorGun');
  for (let t = 0; t < 30; t += 1 / 30) st.step(1 / 30);
  assert.ok(st.targetHp.some((v) => v < TARGET_HP), `targets hit (${st.targetHp.join(', ')})`);
  assert.ok(st.world.events.some((e) => e.type === 'targetHit' || e.type === 'targetDown'));
  const down = st.targetHp.findIndex((v) => v <= 0);
  if (down >= 0) assert.ok(!st.h.contacts().some((c) => c.ref === down), 'a fallen target is no longer one');
});
