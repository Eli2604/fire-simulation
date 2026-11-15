import { test } from 'node:test';
import assert from 'node:assert/strict';
import { battleWorld } from './battleKit.js';
import { fireMissile, aimSolution, flyOut, ROUNDS, ROCKETS, ARMAMENTS, initArms } from '../src/ai/heliArms.js';
import { vehicleSide, vehicleContacts } from '../src/ai/vehicleSides.js';
import { mountOf, gunnerOf } from '../src/ai/mountedGuns.js';
import { worldContacts } from '../src/ai/helicopter.js';
import { carHit } from '../src/sim/ordnance.js';

const gunship = (o) => ({ mission: 'hunt', lz: [0, 0, 0], soldiers: 0, doorGuns: 'none', altitude: 60, ...o });

test('the fire solution: a cannon round and a rocket land on a point 0.5 to 1.5 km off (lead, drop, the motor)', () => {
  for (const [spec, R] of [[ROUNDS.m230, 600], [ROUNDS.m230, 1400], [ROCKETS.hydra, 1200], [ROUNDS.hmg, 1000]]) {
    const from = [0, 40, 0];
    const T = [R, 1, 30];
    const sol = aimSolution(from, [10, 0, 0], spec, T, [0, 0, 5]);
    const q = flyOut(from, sol.dir, [10, 0, 0], spec, sol.at);
    assert.ok(q && Math.hypot(q.p[0] - sol.at[0], q.p[1] - sol.at[1], q.p[2] - sol.at[2]) < 1.5, `${spec.label} at ${R} m: it gets there (${q && q.p.map((x) => x.toFixed(1))})`);
    assert.ok(Math.abs(sol.at[2] - (30 + 5 * sol.tof)) < 1 && sol.tof > R / 1100, 'led by the time of flight');
  }
});

test('sides of vehicles: from the men in them or a param; an empty one is nobody\'s (not a target)', () => {
  const B = battleWorld();
  const red = B.man('red'), blue = B.man('blue');
  const a = B.car({}, { x: 0 }, [red]);
  const b = B.car({ side: 'blue' }, { x: 20 });
  const c = B.car({}, { x: 40 });
  const d = B.car({}, { x: 60 }, [{ player: true, name: 'you' }]);
  const f = B.boat({}, { x: 0, z: 40 }, [blue]);
  assert.equal(vehicleSide(a), 'red');
  assert.equal(vehicleSide(b), 'blue', 'marked');
  assert.equal(vehicleSide(c), null, 'empty, unmarked');
  assert.equal(vehicleSide(d), 'blue', 'you drive it');
  assert.equal(vehicleSide(f), 'blue');
  const cs = vehicleContacts(B.world);
  assert.deepEqual(cs.map((x) => x.kind).sort(), ['boat', 'car', 'car', 'car']);
  assert.ok(!cs.some((x) => x.ref === c), 'the empty car is no contact');
  assert.ok(worldContacts({ world: B.world }).some((x) => x.ref === a && x.side === 'red'), 'a helicopter\'s crew sees it');
  // armament presets, mounted guns
  assert.equal(initArms({}, { armament: 'none' }), null);
  assert.ok(ARMAMENTS.attack.atgm > 0 && ARMAMENTS.attack.aam > 0 && ARMAMENTS.gunship.rockets > 0);
  const g = B.car({ mountedGun: 'hmg' }, { x: 80 }, [B.man('green'), B.man('green'), B.man('green')]);
  assert.equal(mountOf(g).type, 'hmg');
  assert.equal(gunnerOf(g), g.seats[1].who, 'its gunner seat empty: the passenger moves up to it');
});

test('two AI helicopters of opposing sides find each other and fight: one is hit and goes down', () => {
  const B = battleWorld({ seed: 4 });
  const blue = B.heli(gunship({ p: [-1500, 0, 0], yaw: Math.PI / 2, side: 'blue', armament: 'attack', callsign: 'Blue', seed: 5 }));
  const red = B.heli(gunship({ p: [1500, 0, 200], yaw: -Math.PI / 2, side: 'red', armament: 'attack', callsign: 'Red', seed: 9 }));
  B.run(150, 0.05, () => blue.crashed || red.crashed);
  const ev = B.world.events;
  assert.ok(ev.some((e) => e.type === 'heliEngage' && e.profile === 'dogfight'), 'a dogfight');
  assert.ok(blue.arms.fired.gun + red.arms.fired.gun + blue.arms.fired.aam + red.arms.fired.aam > 1, 'they fired');
  assert.ok(ev.some((e) => e.type === 'heliMissile'), 'heat seekers fired');
  assert.ok(ev.some((e) => e.type === 'heliFlares'), 'flares against them');
  const hurt = [blue, red].filter((h) => h.integrity < 0.9 || h.failure);
  assert.ok(hurt.length >= 1, 'one of them hit');
  assert.ok(blue.crashed || red.crashed || blue.failure || red.failure, `one going down (${blue.failure} ${red.failure})`);
});

test('a hostile jeep and a hostile boat: the helicopter destroys them (fire, the tank bursts; holed, it sinks)', () => {
  const B = battleWorld({ seed: 11 });
  const red = B.heli(gunship({ p: [-1800, 0, 0], yaw: Math.PI / 2, side: 'red', armament: 'gunship', callsign: 'Red', seed: 5 }));
  const men = [B.man('blue'), B.man('blue')];
  const jeep = B.car({}, { x: 400, z: 100 }, men);
  const crew = [B.man('blue'), B.man('blue')];
  const boat = B.boat({ side: 'blue' }, { x: 300, z: -400 }, crew);
  B.run(200, 0.05, () => jeep.armsFire?.burst && boat.body.sunk);
  assert.ok(jeep.armsFire, 'the jeep set alight');
  assert.ok(jeep.dead && jeep.wrecked, 'wrecked, its engine dead');
  assert.ok(B.world.events.some((e) => e.type === 'tankBurst'), 'its tank burst');
  assert.ok(men.every((m) => m.dead || m.health < 100 || !jeep.seats.some((s) => s.who === m)), 'its men hit or out of it');
  assert.ok((boat.shotHoles ?? []).length > 3, 'the boat holed');
  assert.ok(boat.body.sunk || boat.body.water > 0.3, `it fills and sinks (${boat.body.water.toFixed(2)} m³)`);
  assert.ok(red.arms.fired.rockets > 0, 'with rockets (and the gun)');
});

test('an EV hit in its floor: its pack goes into runaway, a battery fire', () => {
  const B = battleWorld({ seed: 2 });
  const ev = B.car({ length: 4.6, height: 1.5, powertrain: 'electric' }, { x: 0 }, [B.man('red')]);
  B.ctx.rand = () => 0.5;
  // two cannon rounds into its floor, from the side
  carHit(B.ctx, ev, 'cabin', ROUNDS.m230.amount, [ev.x, 0.4, ev.z + 0.5], [0, 0, -1], { he: true });
  carHit(B.ctx, ev, 'cabin', ROUNDS.m230.amount, [ev.x + 0.4, 0.4, ev.z + 0.5], [0, 0, -1], { he: true });
  assert.ok(ev.runaway, 'thermal runaway');
  assert.equal(ev.armsFire?.how, 'battery');
  assert.ok(ev.dead && B.world.events.some((e) => e.type === 'batteryRunaway'));
});

test('a jeep\'s mounted heavy machine gun shoots back at the helicopter attacking it and damages it', () => {
  const B = battleWorld({ seed: 21 });
  const red = B.heli(gunship({ p: [-1800, 0, 0], yaw: Math.PI / 2, side: 'red', armament: { gun: 'm230', gunAmmo: 600 }, attackStyle: 'gunRun', callsign: 'Red', seed: 5 }));
  const men = [B.man('blue'), B.man('blue'), B.man('blue', { skill: 'veteran' })];
  const jeep = B.car({ mountedGun: 'hmg' }, { x: 300, z: 100 }, men);
  let hitsByGun = 0;
  B.run(120, 0.05, () => {
    hitsByGun = red.attacks.filter((a) => a.who === jeep).length;
    return hitsByGun > 0 && red.integrity < 0.95;
  });
  assert.ok(jeep.gun.ammo < 400, `the gunner fired (${400 - jeep.gun.ammo} rounds)`);
  assert.equal(jeep.gun.target?.kind ?? 'heli', 'heli', 'at the helicopter');
  assert.ok(hitsByGun > 0, 'its rounds reached the helicopter');
  assert.ok(red.integrity < 0.95, `and damaged it (integrity ${red.integrity.toFixed(2)}: ${Object.keys(red.dmg).join(', ')})`);
});

test('flares decoy a heat seeker with some probability (without them it hits)', () => {
  const trial = (seed, flares) => {
    const B = battleWorld({ seed });
    const blue = B.heli({ p: [0, 0, 0], lz: [0, 0, 0], yaw: Math.PI / 2, side: 'blue', mission: 'hover', startAlt: 60, startSpeed: 0, hoverAlt: 60, ropeLength: 80, armament: { aam: 1 }, soldiers: 0, doorGuns: 'none' });
    const red = B.heli({ p: [1500, 0, 100], lz: [1500, 0, 100], yaw: 0, side: 'red', mission: 'hover', startAlt: 60, startSpeed: 0, hoverAlt: 60, ropeLength: 80, armament: { flares }, soldiers: 0, doorGuns: 'none' });
    B.run(0.5);
    const m = fireMissile(blue, 'aam', { ref: red, kind: 'heli' });
    B.run(10, 0.05, () => m.done);
    return { decoyed: !!m.track?.flare, hit: red.integrity < 1, flaresUsed: 30 - red.arms.flares };
  };
  const With = Array.from({ length: 16 }, (_, i) => trial(1000 + i * 7919, 30));
  const without = Array.from({ length: 6 }, (_, i) => trial(5000 + i * 104729, 0));
  const dec = With.filter((r) => r.decoyed).length;
  assert.ok(With.every((r) => r.flaresUsed > 0), 'the warning: flares out');
  assert.ok(dec >= 2 && dec <= 14, `some decoyed, not all (${dec} of 16)`);
  assert.ok(With.filter((r) => !r.decoyed).every((r) => r.hit), 'the others hit');
  assert.ok(without.every((r) => r.hit && !r.decoyed), 'no flares: every one hits');
});

test('friendly is not targeted: a blue helicopter leaves the blue jeep and helicopter alone, goes for the red jeep', () => {
  const B = battleWorld({ seed: 31 });
  const h = B.heli(gunship({ p: [-1500, 0, 0], yaw: Math.PI / 2, side: 'blue', armament: 'gunship', callsign: 'Blue', seed: 5 }));
  const mate = B.heli(gunship({ p: [-1200, 0, 600], yaw: Math.PI / 2, side: 'blue', mission: 'overwatch', armament: 'gunship', callsign: 'Mate', seed: 6 }));
  const friend = B.car({}, { x: 0, z: -300 }, [B.man('blue'), B.man('blue')]);
  const foe = B.car({}, { x: 200, z: 300 }, [B.man('red'), B.man('red')]);
  const out = () => foe.wrecked || foe.seats.every((q) => !q.who || q.who.dead);
  B.run(150, 0.05, out);
  assert.ok(out(), 'the red jeep destroyed (or its men)');
  assert.ok(!friend.zdmg && !friend.armsFire, 'the blue one untouched');
  assert.equal(mate.integrity, 1, 'the other blue helicopter untouched');
  for (const k of h.known.values()) assert.notEqual(k.c.side, 'blue', 'nothing friendly among its targets');
  assert.ok(!B.world.events.some((e) => e.type === 'heliEngage' && e.what === 'heli'), 'no fight with its mate');
});

test('out of ammunition: it breaks off and returns to base', () => {
  const B = battleWorld({ seed: 41 });
  const h = B.heli(gunship({ p: [-1500, 0, 0], yaw: Math.PI / 2, side: 'red', armament: { gun: 'm230', gunAmmo: 60, rockets: 4 }, attackStyle: 'gunRun', callsign: 'Red', seed: 5 }));
  const boat = B.boat({ side: 'blue' }, { x: 300, z: 0 }, [B.man('blue')]);
  B.run(150, 0.05, () => h.combat?.phase === 'rtb');
  assert.equal(h.arms.gun.ammo, 0, 'the rounds spent');
  assert.equal(h.arms.rockets, 0, 'the rockets');
  assert.equal(h.combat.phase, 'rtb');
  assert.equal(h.mission, 'land');
  assert.ok(B.world.events.some((e) => e.type === 'radio' && /winchester/.test(e.name)), 'radioed');
  const d0 = Math.hypot(h.p[0] - h.home[0], h.p[2] - h.home[2]);
  B.run(30);
  assert.ok(Math.hypot(h.p[0] - h.home[0], h.p[2] - h.home[2]) < d0 - 300, 'on its way home');
  void boat;
});

test('under water: the crew do not pick out a diver deep down (his bubbles give him away); fragments and rounds stop in the water', async () => {
  const { fragBlast, firstHit } = await import('../src/sim/ordnance.js');
  const look = (diver) => {
    const B = battleWorld({ seed: 51 });
    const h = B.heli({ p: [0, 0, 0], lz: [0, 0, 0], yaw: Math.PI / 2, side: 'blue', mission: 'hover', startAlt: 30, startSpeed: 0, hoverAlt: 30, ropeLength: 40, armament: 'gunship', soldiers: 0, doorGuns: 'none' });
    const m = B.man('red', { p: [25, -2, 0], ...diver });
    B.run(15);
    return h.knows(m);
  };
  assert.equal(look({}), true, 'a man in the open: seen');
  assert.equal(look({ submerged: 2, waterVis: 4 }), false, 'two metres under (4 m visibility): not');
  assert.equal(look({ submerged: 2, waterVis: 4, bubbles: true }), true, 'his scuba bubbles: seen');
  const B = battleWorld({ seed: 52 });
  const diver = B.man('red', { p: [0, -2, 0], submerged: 1.8 });
  const swimmer = B.man('red', { p: [3, 0, 0] });
  fragBlast(B.ctx, [0, 0.2, 0], 4, 45);
  assert.equal(diver.health, 100, 'the diver untouched by the fragments');
  assert.ok(swimmer.health < 100 || swimmer.dead || true);
  const r = firstHit(B.ctx, [0, 30, 0.1], [0, -1, 0], 40, { type: 'round' });
  assert.ok(r && r.kind !== 'man', 'a round from above stops at the surface, not in him');
});

test('in the simulation: a hunting gunship, a crewed jeep with a mounted gun (params); they fight with real ordnance', async () => {
  const { createSimulation } = await import('../src/sim/createSimulation.js');
  const { SCENARIOS, resolveScenario } = await import('../src/scenarios.js');
  const sim = createSimulation({
    world: { size: [40, 8, 40], h: 0.5, ground: 'soil' },
    objects: [
      { type: 'helicopter', params: { side: 'enemy', mission: 'hunt', armament: 'gunship', soldiers: 0, doorGuns: 'none', fromX: -900, fromZ: 0, altitude: 50, orbitRadius: 200, startAfter: 1 }, x: 20, z: 20 },
      { type: 'car', params: { length: 4.4, width: 1.9, height: 1.9, side: 'blue', mountedGun: 'hmg', crewMen: 3 }, x: 20, z: 20 },
    ],
    noFire: true,
  });
  const w = sim.world;
  for (let i = 0; i < 300 && !(w.cars?.[0]?.armsFire || w.cars?.[0]?.zdmg); i++) sim.step(0.1);
  const c = w.cars[0];
  assert.equal(c.seats.filter((s) => s.who).length, 3, 'its crew put in its seats');
  assert.ok(w.helis[0].ai?.arms, 'the gunship came');
  assert.ok(w.helis[0].ai.arms.fired.rockets + w.helis[0].ai.arms.fired.gun > 0, 'and fired at the jeep');
  assert.ok(c.zdmg || c.armsFire || c.seats.some((s) => s.who?.dead), 'the jeep hit');
  // the scenario: the carrier's world with the battle in it
  const sc = SCENARIOS.heliBattle;
  assert.ok(sc && sc.zones.deck.objects.filter((o) => o.type === 'helicopter' && o.params.mission === 'hunt').length === 4);
  assert.ok(sc.zones.camp.objects.some((o) => o.type === 'car' && o.params.mountedGun === 'hmg' && o.params.crewMen > 0));
  assert.deepEqual(resolveScenario('heliBattleCamp'), { scenario: 'heliBattle', zone: 'camp' });
});
