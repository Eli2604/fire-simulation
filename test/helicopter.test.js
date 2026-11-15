import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Helicopter, HELI, heliSeats, heliHitZone, heliRayHit, heliToWorld, groundY } from '../src/ai/helicopter.js';
import { stepRopes } from '../src/ai/rope.js';
import { VEHICLE_ZONES, vehicleZones, zoneAt } from '../src/models/vehicleZones.js';
import { MODELS } from '../src/models/index.js';
import { RIG_KINDS, RIG_BUTTON, rigTargetFor, BODY_MASS, impactsOf } from '../src/rig/objects.js';
import { createHeliStage, HELI_ACTS } from '../src/rig/heliStage.js';
import { createSimulation } from '../src/sim/createSimulation.js';
import { shoot } from '../src/sim/wounds.js';

/** A bare world and a helicopter in it (ground at 0; the rope module stepped as the simulation would). */
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
/** Hovering high over the pad, still. */
const high = (o = {}) => rig({ startAlt: 80, startSpeed: 0, mission: 'hover', hoverAlt: 80, ropeLength: 90, ...o });

test('the model: placeable, builds a helicopter (not voxels) with its mission and crew; on the rig drop-down', () => {
  const M = MODELS.helicopter;
  assert.ok(M && M.label);
  const p = Object.fromEntries(Object.entries(M.params).map(([k, s]) => [k, s.value]));
  const b = M.build(p);
  assert.equal(b.prims.length, 0);
  assert.equal(b.helis.length, 1);
  assert.equal(b.helis[0].mission, 'insert');
  assert.equal(b.helis[0].soldiers, 6);
  assert.ok(RIG_KINDS.includes('helicopter') && RIG_BUTTON.helicopter);
  assert.deepEqual(rigTargetFor({ type: 'helicopter', params: { soldiers: 4 } }), { kind: 'helicopter', params: { soldiers: 4 } });
  assert.equal(BODY_MASS.helicopter, HELI.mass);
  assert.ok(impactsOf('helicopter', 'crashMain').length);
  for (const k of ['parked', 'startUp', 'hover', 'transit', 'approach', 'land', 'doors', 'fastRope', 'doorGun', 'troopsFire', 'crashTail', 'crashMain', 'crashEngine', 'fuelFire']) assert.ok(HELI_ACTS[k], k);
});

test('hit zones: every part asked for, each found at its own place, through the rotation and along a ray', () => {
  const keys = VEHICLE_ZONES.helicopter.map((z) => z.k).sort();
  assert.deepEqual(keys, ['cabin', 'cockpit', 'engine', 'fuel', 'mast', 'rotor', 'skids', 'tailBoom', 'tailRotor']);
  for (const Z of vehicleZones('helicopter')) {
    assert.ok(Z.zone.label && Z.zone.hp > 0 && Z.zone.mult > 0 && Z.zone.effect && Z.zone.sim, Z.k);
    // (the rotor's middle is the hub: the mast; its blades out along the disc)
    const c = Z.k === 'rotor' ? [5, 3.6, 0] : Z.boxes[0].c;
    assert.equal(zoneAt('helicopter', c)?.k, Z.k, Z.k);
  }
  // a helicopter turned and tilted: a world point on its tail rotor is the tail rotor
  const { h } = rig({ yaw: 1.1, startAlt: 30, startSpeed: 0 });
  h.pitch = -0.1;
  h.roll = 0.2;
  assert.equal(heliHitZone(h, heliToWorld(h, [-9.3, 3.0, 0.35]))?.k, 'tailRotor');
  assert.equal(heliHitZone(h, heliToWorld(h, [3.0, 1.4, 0.4]))?.k, 'cockpit');
  assert.equal(heliHitZone(h, heliToWorld(h, [0, 10, 0])), null);
  // a round from the side through the cabin; from above through the disc: a blade (chance 0) or on to the mast
  const side = heliToWorld(h, [0.5, 1.5, 30]);
  const into = heliToWorld(h, [0.5, 1.5, 0]);
  assert.equal(heliRayHit(h, side, into.map((v, i) => v - side[i]), 100)?.k, 'cabin');
  const above = heliToWorld(h, [0, 30, 0]);
  const down = heliToWorld(h, [0, 0, 0]).map((v, i) => v - above[i]);
  assert.equal(heliRayHit(h, above, down, 100, 0)?.k, 'rotor');
  assert.equal(heliRayHit(h, above, down, 100, 1)?.k, 'mast', 'between the blades: on to the hub');
});

test('seats: pilot, co-pilot, the door gunners and the troops; the crew are soldiers in the world, held in their seats', () => {
  const s = heliSeats(6, 'both');
  assert.equal(s.length, 8);
  assert.deepEqual(s.map((x) => x.role), ['pilot', 'copilot', 'gunner', 'gunner', 'troop', 'troop', 'troop', 'troop']);
  assert.equal(heliSeats(3, 'none').filter((x) => x.role === 'troop').length, 3);
  assert.equal(heliSeats(1, 'both').filter((x) => x.role === 'gunner').length, 1);
  assert.equal(heliSeats(20).length, 10, 'eight in the back at most');
  const { h, world } = rig({ soldiers: 5, doorGuns: 'left', startAlt: 20, startSpeed: 0 });
  assert.equal(world.enemies.length, 7);
  for (const e of world.enemies) {
    assert.ok(e.guardCtl && e.aboard === h.id && e.squad, 'his AI leaves him be while he is aboard');
    assert.ok(Math.abs(e.p[1] - (h.p[1] + HELI.floor)) < 0.01, 'on the cabin floor');
  }
  assert.equal(new Set(world.enemies.filter((e) => e.role === 'troop').map((e) => e.unit)).size, 1, 'the troops are one squad');
});

test('the tail rotor shot away: no yaw control, it spins faster and faster round the mast, a hard landing the crew survive', () => {
  const { h, run } = high();
  run(1);
  h.hit('tailRotor', 400);
  assert.equal(h.failure, 'tail');
  assert.ok(h.gone.has('tailRotor') && h.debris.some((d) => d.kind === 'tailRotor'), 'the tail rotor flies off');
  run(1);
  const r1 = Math.abs(h.yawRate);
  run(1.5);
  const r2 = Math.abs(h.yawRate);
  assert.ok(r1 > 0.8 && r2 > r1 + 1, `the spin grows (${r1.toFixed(2)} → ${r2.toFixed(2)} rad/s)`);
  assert.ok(h.v[1] < -2 && h.v[1] > -8, `a steep but slowed descent (${h.v[1].toFixed(1)} m/s)`);
  run(60, 0.05, () => h.crashed);
  assert.ok(h.crashed && h.severity === 'hard', h.severity);
  assert.ok(h.crew.every((e) => !e.dead), 'everyone lives');
});

test('the main rotor shot away: no lift, it drops and tumbles (much faster than the others), the blades fly off', () => {
  const descent = (part) => {
    const { h, run } = high();
    run(1);
    h.hit(part, 1000);
    run(3);
    return { h, vy: h.v[1] };
  };
  const main = descent('rotor');
  assert.equal(main.h.failure, 'main');
  assert.equal(main.h.blades, 0);
  assert.equal(main.h.debris.filter((d) => d.kind === 'blade').length, HELI.blades);
  assert.ok(main.vy < -20, `falling (${main.vy.toFixed(1)} m/s after 3 s)`);
  assert.ok(Math.abs(main.h.pitch) + Math.abs(main.h.roll) > 0.5, 'tumbling');
  const mast = descent('mast');
  assert.equal(mast.h.failure, 'main');
  // the engine: autorotation, a glide down at a steady ~9 m/s with some speed forward
  const eng = descent('engine');
  assert.equal(eng.h.failure, 'engine');
  assert.ok(eng.vy < -6 && eng.vy > -11, `autorotating (${eng.vy.toFixed(1)} m/s)`);
  assert.ok(eng.vy > main.vy + 10, 'far slower down than with no rotor');
  assert.ok(Math.hypot(eng.h.v[0], eng.h.v[2]) > 10, 'gliding forward');
  assert.ok(eng.h.omega > 0.85, 'the rotor kept turning by the air');
  // and where they come down: the engine's flare makes it a hard landing, the rotor's a wreck
  for (let t = 0; t < 40 && !eng.h.crashed; t += 0.05) eng.h.step(0.05);
  for (let t = 0; t < 40 && !main.h.crashed; t += 0.05) main.h.step(0.05);
  assert.equal(eng.h.severity, 'hard');
  assert.ok(eng.h.impactSpeed < HELI.hard, `flared to ${eng.h.impactSpeed.toFixed(1)} m/s`);
  assert.equal(main.h.severity, 'destroyed');
  assert.ok(main.h.crew.every((e) => e.dead));
});

test('a crash goes through sim/impact.js (force, shockwave, sound); the fuel tank alight: down at once, the wreck burns', () => {
  const ignites = [];
  const { h, world, run } = rig({ startAlt: 40, startSpeed: 0, mission: 'hover', hoverAlt: 40, ropeLength: 50 }, { ignite: (p, r) => ignites.push(p), torch: (p) => ignites.push(p) });
  run(1);
  h.hit('fuel', 400);
  assert.ok(h.fire > 0 && h.mode === 'emergency', 'burning: the pilot puts it down');
  run(40, 0.05, () => h.crashed);
  assert.ok(h.crashed);
  const imp = world.events.find((e) => e.type === 'impact' && e.kind === 'crash');
  assert.ok(imp && imp.force > 0 && imp.energy > 0 && imp.db > 0, 'the impact');
  assert.ok(ignites.length >= 2, 'the fire simulation gets the burning fuel');
  run(5);
  assert.ok(h.crew.every((e) => e.aboard == null), 'they got out');
  assert.ok(h.crew.filter((e) => !e.dead).every((e) => !e.guardCtl), 'their squads have them again');
  // a hard fall: a shockwave too
  const m = high();
  m.run(1);
  m.h.hit('rotor', 1000);
  m.run(20, 0.05, () => m.h.crashed);
  assert.ok(m.world.events.some((e) => e.type === 'shockwave'));
});

test('the door gunner fires at what he sees out of his door; the troop by the open door fires his own weapon', () => {
  const shots = [];
  // a target off its right side and below (it faces +z: right is -x)
  const { h, run } = rig({ startAlt: 15, startSpeed: 0, mission: 'hover', soldiers: 4, doorGuns: 'right' }, { targets: () => [[-40, 1, 3]], fire: (e, from, dir, weapon) => shots.push({ role: e.role, weapon, from, dir }) });
  run(6);
  assert.ok(h.doorOpen(1), 'the right door open');
  const gun = shots.filter((s) => s.role === 'gunner');
  assert.ok(gun.length > 10, `the gunner fired (${gun.length})`);
  assert.ok(gun.every((s) => s.weapon === 'mg' && s.dir[0] < -0.5), 'the machine gun, towards the target');
  assert.ok(h.guns.R.dir, 'the gun turned onto it');
  assert.ok(shots.some((s) => s.role === 'troop'), 'a trooper fires his rifle from the door');
  assert.equal(h.guns.L.flash, -1, 'nothing out of the left door');
});

test('fast-rope: cables out of the doors into w.ropes (top following the door), the troops down them, cut, away', () => {
  const { h, world, run } = rig({ p: [-150, 0, 0], yaw: Math.PI / 2, mission: 'insert', soldiers: 6, altitude: 25, startSpeed: 20 });
  assert.ok(run(60, 0.05, () => world.ropes.length > 0), 'cables out');
  const r = world.ropes[0];
  assert.equal(r.kind, 'fastrope');
  assert.equal(r.attached, true);
  assert.equal(r.owner, h.id);
  assert.ok(r.top[1] > r.bottom[1] + 8, 'hanging down');
  run(0.5);
  assert.ok(Math.hypot(r.top[0] - heliToWorld(h, [0.6, 2.3, r.side * 1.32])[0], r.top[1] - heliToWorld(h, [0.6, 2.3, r.side * 1.32])[1]) < 0.05, 'its top at the door');
  assert.ok(run(60, 0.05, () => h.crew.some((e) => e.rope)), 'a man on the cable (ai/rope.js)');
  run(60, 0.05, () => h.mode === 'depart');
  assert.equal(h.mode, 'depart');
  const troops = h.crew.filter((e) => e.role === 'troop');
  assert.ok(troops.every((e) => e.aboard == null && !e.rope && !e.guardCtl && Math.abs(e.p[1]) < 0.1), 'all four down on the ground, their squad has them');
  assert.ok(world.ropes.every((x) => !x.attached), 'cut');
  assert.ok(h.crew.filter((e) => e.role !== 'troop').every((e) => e.aboard === h.id), 'the crew and the gunners stay');
});

test('in the simulation: bullets find its parts, the crew are its soldiers, its guns fire real rounds at you', () => {
  const sim = createSimulation({ world: { size: [40, 12, 40], h: 1, ground: 'soil' }, objects: [{ type: 'helicopter', params: { mission: 'hover', fromX: 0, fromZ: -30, altitude: 15, soldiers: 4, doorGuns: 'both' }, x: 20, z: 20, rotation: 0 }], noFire: true });
  const w = sim.world;
  assert.equal(w.helis.length, 1);
  assert.ok(groundY(w, 20, 20) >= 1, 'the ground is the voxels\' top');
  sim.ai.player = { p: [4, 1, 20], dead: false }; // off its right side (it hovers facing +z)
  for (let i = 0; i < 120; i++) sim.step(0.05);
  const h = w.helis[0].ai;
  assert.ok(h, 'flying');
  assert.equal(w.enemies.length, 6, 'pilot, co-pilot, two gunners, four troops: in the world');
  // a round at its cabin from the ground
  const from = [20, 1.6, 4];
  const at = heliToWorld(h, [0, 1.5, 0]);
  const before = h.dmg.cabin ?? 0;
  const r = shoot(sim, from, at.map((v, i) => v - from[i]), { range: 100 });
  assert.ok(r?.heli === h, 'the round hit the helicopter');
  assert.ok((h.dmg[r.zone] ?? 0) > 0 || before > 0, `its ${r.zone} damaged`);
  assert.ok(h.shots > 0 && w.tracers.length > 0, 'the door gun fired real rounds (sim/wounds.js shoot: tracers)');
  assert.ok(w.playerHits.length > 0, 'and they hit you');
});

test('the rig stage: each act flies it the way it says (the guns at the targets, the crash acts come down)', () => {
  const st = createHeliStage();
  const run = (s) => {
    for (let t = 0; t < s; t += 1 / 30) st.step(1 / 30);
  };
  st.play('doorGun');
  run(12);
  assert.ok(st.h.shots > 0 && st.world.tracers.length > 0, 'the door gunners fire at the targets');
  st.play('crashTail');
  run(30);
  assert.ok(st.h.crashed && st.world.events.some((e) => e.type === 'heliFailure' && e.failure === 'tail'));
  st.play('parked');
  run(3);
  assert.equal(st.h.omega, 0);
  st.set({ soldiers: 2, doorGuns: 'none' });
  assert.equal(st.h.crew.length, 4);
});
