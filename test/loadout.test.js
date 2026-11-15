import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BASE_KIT, REF_TOTAL, UNIFORM_KG, PRIMARY, FLAT, GRENADE_KG, ROLES, KIT_FIELDS, fullKit, kitMass, mobility, paceOf, applyKit, stepStamina, tiredK, armourPen, armourDamageK, defaultComposition, codesFor, kitOf, loadSummary } from '../src/ai/loadout.js';
import { EXPERIENCE, LEVELS, RANKS, defaultRank, nerveOf, moraleK } from '../src/ai/experience.js';
import { SKILL, kit, aimPoint } from '../src/ai/soldier.js';
import { SKILL_SENSES, senses } from '../src/ai/perception.js';
import { PEEK_T } from '../src/ai/peek.js';
import { armourStops } from '../src/sim/wounds.js';
import { choose } from '../src/ai/strategy.js';
import { ability } from '../src/ai/parkour.js';
import squadModel, { squadMen } from '../src/models/squad.js';
import enemyModel from '../src/models/enemy.js';
import { SquadAI } from '../src/ai/squad.js';
import { slotsFor, formationFor } from '../src/ai/tactics.js';
import { operatorClips, OperatorFigure, solve, pose0, weaponKit } from '../src/operator/rig.js';

const defaults = (M) => Object.fromEntries(Object.entries(M.params).map(([k, v]) => [k, v.value]));
const seeded = (s) => () => ((s = (s * 16807) % 2147483647) / 2147483647);

test('weights: every item counts, the total is the sum; a light kit and a heavy one', () => {
  const W = kitMass(BASE_KIT);
  assert.ok(Math.abs(W.items.reduce((s, [, kg]) => s + kg, 0) - W.total) < 0.05, 'the items add up to the total');
  assert.equal(W.total, REF_TOTAL);
  assert.ok(W.total > 28 && W.total < 40, `a rifleman's fighting load is realistic (${W.total} kg)`);
  // carry: without the weapon in his hands and the uniform (what ai/parkour.js and ai/rope.js read)
  assert.ok(Math.abs(W.carry - (W.total - PRIMARY.rifle.kg - UNIFORM_KG)) < 0.02);
  // nothing at all: the uniform only
  const bare = fullKit('rifleman', { primary: 'none', sidearm: 'none', frag: 0, smoke: 0, flash: 0, pack: 'none', armour: 'none', helmet: false, radio: 'none', medkit: 'none', knife: false, torch: false, water: 0 });
  assert.equal(kitMass(bare).total, UNIFORM_KG);
  // each item adds its own mass
  const plus = (over) => kitMass({ ...bare, ...over }).total - UNIFORM_KG;
  const near = (a, b) => assert.ok(Math.abs(a - b) < 0.011, `${a} ≈ ${b}`);
  near(plus({ helmet: true }), FLAT.helmet.kg);
  near(plus({ nvg: true }), FLAT.nvg.kg);
  near(plus({ rope: true }), FLAT.rope.kg);
  near(plus({ frag: 3 }), 3 * GRENADE_KG.frag);
  near(plus({ pack: 'rucksack' }), 18);
  near(plus({ armour: 'plates' }), 9);
  assert.ok(plus({ armour: 'heavy' }) > plus({ armour: 'plates' }) && plus({ armour: 'plates' }) > plus({ armour: 'soft' }));
  // the MG and its belts outweigh the rifle and its magazines
  assert.ok(kitMass(fullKit('gunner')).total > kitMass(fullKit('rifleman')).total + 8);
  // a radio operator's manpack and ruck, a flame trooper's tanks
  assert.ok(kitMass(fullKit('radio')).total > W.total + 15);
  assert.ok(kitMass(fullKit('flame')).total > W.total + 15);
});

test('speed falls with the load: 15 kg against 40 kg; walk, run, sprint, acceleration, climbing', () => {
  const L = mobility(15), H = mobility(40);
  assert.ok(L.run > H.run * 1.2, `run ${L.run.toFixed(2)} vs ${H.run.toFixed(2)} m/s`);
  assert.ok(L.sprint > H.sprint * 1.3, 'the sprint suffers most');
  assert.ok(L.walk > H.walk && L.walk / H.walk < L.sprint / H.sprint, 'the walk least');
  assert.ok(L.accel > H.accel);
  assert.ok(L.climb >= H.climb && mobility(70).climb < 1, 'heavily loaded he climbs less high');
  // monotonic, no cliffs
  let prev = Infinity;
  for (let kg = 0; kg <= 90; kg += 5) {
    const r = mobility(kg).run;
    assert.ok(r <= prev + 1e-9, `run falls with the load (${kg} kg)`);
    assert.ok(prev === Infinity || prev - r < 0.35, 'smoothly');
    prev = r;
  }
  assert.ok(Math.abs(mobility(4).run - 3.9) < 0.01, 'next to nothing: his full pace');
  // fitness carries it better
  assert.ok(mobility(40, { fitness: 1 }).run > mobility(40, { fitness: 0 }).run);
  // swimming: light swims, a fighting load struggles or sinks
  assert.equal(mobility(10).swim, 'swims');
  assert.equal(mobility(45).swim, 'sinks');
  // landings and the rattle he makes
  assert.ok(Math.abs(mobility(REF_TOTAL).fallK - 1) < 1e-9 && mobility(60).fallK > 1.2);
  assert.ok(mobility(40).noiseDb > mobility(10).noiseDb);
  // the AI's pace: 1 for a rifleman's load; less for more (the weapon's own pace is in ai/weapons.js)
  const ref = paceOf(REF_TOTAL, PRIMARY.rifle.kg);
  assert.ok(Math.abs(ref.run - 1) < 1e-9 && Math.abs(ref.walk - 1) < 1e-9);
  assert.ok(paceOf(REF_TOTAL + 20, PRIMARY.rifle.kg).run < 0.85);
  assert.match(loadSummary(BASE_KIT), /kg .* walk .* run .* sprint .* m\/s/);
});

test('stamina: running drains it, faster under a heavy load; rest brings it back; spent, he runs slower', () => {
  const light = applyKit({ kit: fullKit('rifleman', { pack: 'none', armour: 'none' }) });
  const heavy = applyKit({ kit: fullKit('radio', { armour: 'heavy' }) });
  for (let t = 0; t < 30; t += 0.1) {
    stepStamina(light, 0.1, 'run');
    stepStamina(heavy, 0.1, 'run');
  }
  assert.ok(heavy.stamina < light.stamina - 0.1, `heavy ${heavy.stamina.toFixed(2)} vs light ${light.stamina.toFixed(2)} after 30 s`);
  for (let t = 0; t < 40; t += 0.1) stepStamina(heavy, 0.1, 'run');
  assert.ok(stepStamina(heavy, 0.1, 'run') < 1, 'spent: slower');
  const s0 = heavy.stamina;
  for (let t = 0; t < 20; t += 0.1) stepStamina(heavy, 0.1, 'still');
  assert.ok(heavy.stamina > s0 + 0.15, 'rest brings it back');
  assert.equal(tiredK(1), 1);
  assert.ok(tiredK(0) < 0.7);
  // fitter: drains slower
  const fit = applyKit({ kit: fullKit('rifleman'), fitness: 1 }), unfit = applyKit({ kit: fullKit('rifleman'), fitness: 0 });
  assert.ok(fit.mob.staminaDrain < unfit.mob.staminaDrain);
});

test('armour per hit area: a soft vest stops pistol rounds, not rifle rounds; heavy armour more than plates, and the arms', () => {
  const rate = (e, zone, kind) => {
    const r = seeded(7);
    let n = 0;
    for (let i = 0; i < 2000; i++) if (armourStops(e, zone, kind, r)) n++;
    return n / 2000;
  };
  const soft = { armour: true, armourLevel: 'soft' }, plates = { armour: true, armourLevel: 'plates' }, heavy = { armour: true, armourLevel: 'heavy' }, none = { armour: false, armourLevel: 'none' };
  assert.ok(rate(soft, 'torso', 'pistol') > 0.8, 'a vest stops a pistol round');
  assert.ok(rate(soft, 'torso', 'rifle') < 0.1, 'not a rifle round');
  assert.ok(rate(plates, 'torso', 'rifle') > 0.6);
  assert.ok(rate(heavy, 'torso', 'rifle') > rate(plates, 'torso', 'rifle') + 0.1, 'heavy stops more');
  assert.ok(rate(heavy, 'armR', 'pistol') > 0.6 && rate(plates, 'armR', 'pistol') === 0, 'heavy armour covers the shoulders');
  assert.equal(rate(none, 'torso', 'pistol'), 0);
  // the old way (no level, e.armour true): the plates, as before
  assert.equal(rate({ armour: true }, 'torso', 'rifle'), rate(plates, 'torso', 'rifle'));
  // what gets through does less
  assert.ok(armourDamageK('heavy', 'torso') < 1 && armourDamageK('none', 'torso') === 1 && armourDamageK('plates', 'legL') === 1);
  assert.equal(armourPen('plates', 'legL', 'rifle', 0.3), null, 'no plate on the legs');
  // the kit sets them on the man
  const m = { squad: 'R1', kit: { armour: 'heavy' } };
  kit(m);
  assert.equal(m.armourLevel, 'heavy');
  assert.equal(m.armour, true);
});

test('experience: one table (aim, reaction, threat identification, reload, suppression); it tells', () => {
  // the old tables are the one table
  assert.equal(SKILL, EXPERIENCE);
  for (const l of LEVELS) {
    assert.equal(SKILL_SENSES[l].react, EXPERIENCE[l].notice);
    assert.equal(PEEK_T[l], EXPERIENCE[l].peek);
  }
  // spread: an elite shooter groups tighter
  const spread = (skill) => {
    const r = seeded(11);
    const m = { p: [0, 0, 0], skill };
    let s = 0;
    for (let i = 0; i < 400; i++) {
      const q = aimPoint(m, [0, 0, 40], r);
      s += Math.hypot(q[0], q[2] - 40);
    }
    return s / 400;
  };
  assert.ok(spread('elite') < spread('regular') && spread('regular') < spread('recruit'));
  // reaction and making out a threat, reload: quicker with experience
  assert.ok(senses({ skill: 'elite' }).react < senses({ skill: 'recruit' }).react);
  assert.ok(EXPERIENCE.veteran.reload < EXPERIENCE.recruit.reload);
  assert.ok(EXPERIENCE.elite.suppress < EXPERIENCE.recruit.suppress);
  // discipline steadies the nerve; morale: how far outmatched
  assert.ok(nerveOf({ skill: 'regular', discipline: 1 }) < nerveOf({ skill: 'regular', discipline: 0 }));
  assert.equal(nerveOf({ skill: 'regular' }), 1);
  assert.ok(moraleK({ morale: 1 }) > moraleK({}));
  // ranks for display
  assert.equal(defaultRank('recruit', 'rifleman'), 'Private');
  assert.ok(RANKS.indexOf(defaultRank('veteran', 'leader')) > RANKS.indexOf(defaultRank('veteran', 'rifleman')));
  // the leader's choices: a cautious team holds where an aggressive one presses on
  const sq = (o) => ({ members: () => [{ squad: 'CMD', p: [0, 0, 5], health: 100, ...o }, { squad: 'R1', p: [1, 0, 5], health: 100 }], host: { retreat: { auto: false } }, unit: 'Alpha', time: 0 });
  const a = { T: [0, 0, 0], men: 4, fit: 2, enemies: 1, down: 2, ammo: 1, flanks: {}, fixed: true };
  assert.equal(choose(sq({ aggression: 0.5 }), a).kind, 'defend');
  assert.notEqual(choose(sq({ aggression: 0.9 }), a).kind, 'defend');
  // a recruit leader takes only a well-covered way round, an elite one a more exposed one
  const b = { T: [0, 0, 0], men: 4, fit: 4, enemies: 2, down: 0, ammo: 1, fixed: true, flanks: { 1: { ok: true, expo: 0.45, L: 20 }, [-1]: { ok: false } } };
  assert.equal(choose(sq({ skill: 'elite' }), b).kind, 'suppressFlank');
  assert.equal(choose(sq({ skill: 'recruit' }), b).kind, 'bound');
});

test('squad settings: N soldiers with the composition for N, roles per man, any count 2..12', () => {
  const P = defaults(squadModel);
  for (let n = 2; n <= 12; n++) {
    const b = squadModel.build({ ...P, size: n });
    assert.equal(b.enemies.length, n, `${n} men`);
    const roles = b.enemies.map((e) => e.squadRole);
    assert.deepEqual(roles, defaultComposition(n));
    assert.equal(b.enemies.filter((e) => e.squad === 'CMD').length, 1, 'one commander');
    // the riflemen split over the two fire teams (A: the commander's, B: the gunner's)
    const A = b.enemies.filter((e) => e.squad === 'CMD' || e.squad === 'R1').length, B = b.enemies.filter((e) => e.squad === 'MG' || e.squad === 'R2').length;
    assert.ok(Math.abs(A - B) <= 1, `${n}: teams ${A} and ${B}`);
    // all start in different places
    const keys = new Set(b.enemies.map((e) => e.p.join()));
    assert.equal(keys.size, n);
    for (const e of b.enemies) assert.ok(e.kit && KIT_FIELDS.primary.options.includes(e.kit.primary));
  }
  // the old team, unchanged: commander, gunner, two riflemen (rifleman two a recruit), two rope coils
  const four = squadModel.build(P).enemies;
  assert.deepEqual(four.map((e) => e.squad), ['CMD', 'MG', 'R1', 'R2']);
  assert.deepEqual(four.map((e) => e.skill), ['veteran', 'regular', 'regular', 'recruit']);
  assert.deepEqual(four.map((e) => e.ropes), [0, 0, 1, 1]);
  // a drone operator: one more; a flame trooper: rifleman two
  const d = squadModel.build({ ...P, droneOperator: true, flameTrooper: true }).enemies;
  assert.equal(d.length, 5);
  assert.equal(d[4].squad, 'UAV');
  assert.equal(d[3].loadout, 'torch');
  // per man: a role, a level, a rank, an item of kit
  const men = [{}, {}, { role: 'medic', skill: 'elite', rank: 'Corporal' }, { kit: { pack: 'rucksack', nvg: true } }, { role: 'marksman' }];
  const c = squadMen({ ...P, size: 5, men });
  assert.equal(c[2].role, 'medic');
  assert.equal(c[2].skill, 'elite');
  assert.equal(c[2].rank, 'Corporal');
  assert.equal(c[2].kit.medkit, 'bag');
  assert.equal(c[3].kit.pack, 'rucksack');
  assert.ok(c[3].mass > c[2].mass - 5);
  assert.equal(c[4].kit.primary, 'marksman');
  // weapons per role
  const g = squadMen({ ...P, size: 6, wpn_gunner: 'rifle', wpn_marksman: 'carbine' });
  assert.equal(g[1].kit.primary, 'rifle');
  assert.equal(g[5].kit.primary, 'carbine');
  // codes for any list
  assert.deepEqual(codesFor(['leader', 'gunner', 'medic', 'drone', 'rifleman']), ['CMD', 'MG', 'R1', 'UAV', 'R2']);
  // guards: a loadout of their own (custom), or none as always
  const gE = enemyModel.build({ ...defaults(enemyModel), loadout: 'custom', armour: 'plates', helmet: true, pack: 'rucksack' }, { rng: seeded(3) }).enemies;
  assert.ok(gE.every((e) => e.kit?.armour === 'plates' && e.kit.pack === 'rucksack'));
  assert.ok(enemyModel.build(defaults(enemyModel), { rng: seeded(3) }).enemies.every((e) => !e.kit));
});

test('kit on a man: weapons, magazines, grenades, armour, carry and pace from his loadout; none given, the old defaults', () => {
  const g = { squad: 'R1', kit: fullKit('grenadier', { primary: 'marksman', sidearm: 'pistol', mags: 3 }) };
  kit(g);
  assert.equal(g.primary, 'marksman');
  assert.equal(g.mags, 3);
  assert.equal(g.secArms, 'pistol');
  assert.ok(g.carry > 20 && g.paceK.run < 1.12);
  const heavy = { squad: 'R2', kit: fullKit('radio', { armour: 'heavy' }) };
  kit(heavy);
  assert.ok(heavy.paceK.run < g.paceK.run, 'the heavier man is slower');
  assert.ok(ability(heavy).climb < ability({}).climb || heavy.carry > 38, 'and climbs less');
  // no kit given: as it always was (a rifle, the carbine, no pace change)
  const o = { squad: 'R1' };
  kit(o);
  assert.equal(o.primary, 'rifle');
  assert.equal(o.secArms, 'secondary');
  assert.equal(o.paceK, undefined);
  assert.equal(o.carry, undefined);
  const mg = { squad: 'MG' };
  kit(mg);
  assert.equal(mg.primary, 'mg');
  assert.equal(kitOf(mg).primary, 'mg');
});

/** A flat open range; the team built by the squad model (with their loadouts). */
function team(n, o = {}) {
  const P = { ...defaults(squadModel), size: n, ...o };
  const ms = squadModel.build(P).enemies.map((e) => ({ ...e, p: [e.p[0], 0, e.p[2] + 2], yaw: Math.PI, health: 100, unit: 'Alpha' }));
  const solid = (x, y) => y < 0;
  const foes = [{ p: [0, 0, -16] }];
  const log = [];
  const sq = new SquadAI({
    unit: 'Alpha', members: () => ms, solid, lineOfSight: () => true, seed: 3, floor: () => 0,
    bounds: [-20, -20, 20, 20], threat: [0, 0, -16], hostiles: () => foes, radio: (m, t) => log.push(t), shout: (m, t) => log.push(t), fire: () => {},
    ...(o.host ?? {}),
  });
  return { sq, ms, log };
}

test('odd and large teams: formations give every man his own place; a team of 7 peels back to the rally point', () => {
  for (let n = 2; n <= 13; n++)
    for (const type of new Set([formationFor(n, false), formationFor(n, true), 'wedge', 'diamond', 'square'])) {
      const slots = slotsFor(type, n);
      assert.equal(slots.length, n, `${type} of ${n}: a place for every man`);
      assert.equal(new Set(slots.map((s) => s.slice(0, 2).join())).size, n, `${type} of ${n}: all different`);
    }
  // a retreat with seven: man by man under cover, all at the rally point
  const { sq, ms, log } = team(7, { host: { retreat: { order: true, rally: [0, 0, 14] } } });
  for (let t = 0; t < 150 && sq.strategy?.phase !== 'done'; t += 0.05) sq.step(0.05);
  assert.equal(sq.strategy?.kind, 'retreat');
  assert.equal(sq.strategy.phase, 'done', 'the retreat is done');
  for (const m of ms) assert.ok(Math.hypot(m.p[0], m.p[2] - 14) < 6, `${m.squadRole} at the rally point (${m.p.map((v) => v.toFixed(1))})`);
  assert.ok(log.some((l) => /contact broken/.test(l)));
});

test('a team of five bounds on the threat with its loadouts; the heavy men keep up but are slower', () => {
  const { sq, ms } = team(5, { men: [{}, {}, {}, { kit: { pack: 'rucksack', armour: 'heavy', radio: 'manpack' } }, {}] });
  for (let t = 0; t < 40; t += 0.05) sq.step(0.05);
  assert.ok(ms.every((m) => !m.dead));
  const c = ms.reduce((s, m) => s + m.p[2], 0) / ms.length;
  assert.ok(c < 0, `they advanced on the threat (centre z ${c.toFixed(1)})`);
  assert.ok(ms[3].paceK.run < ms[2].paceK.run, 'the heavy man is slower');
  assert.ok(ms.every((m) => m.stamina == null || (m.stamina >= 0 && m.stamina <= 1)));
});

/** The operator figure on plain boxes (as test/gear.test.js). */
function figure(loadout = 'rifle') {
  const geo = () => new THREE.BoxGeometry(0.05, 0.05, 0.05);
  const mat = new THREE.MeshStandardMaterial();
  const sl = solve(Object.assign(pose0(), { sling: 1 })), sl2 = solve(Object.assign(pose0(), { sling2: 1 }));
  const tanks = new THREE.Group();
  tanks.add(new THREE.Mesh(geo(), mat));
  const torch = new THREE.Group();
  torch.add(new THREE.Mesh(geo(), mat));
  const A = Object.assign({
    person: [geo()], carrier: geo(), sling: geo(), rifle: geo(), mag: geo(), helmet: geo(), pack: geo(), secondary: geo(), antenna: geo(), mic: geo(), foam: geo(),
    cords: [], black: mat, grenade: geo(), grenadeFuse: geo(), grenadeMat: mat, flashTex: null, drone: new THREE.Group(), goggles: new THREE.Group(), ctrl: new THREE.Group(),
    torchGun: torch, torchTanks: tanks, nozzle: new THREE.Vector3(),
    slungPos: sl.weaponPos, slungQ: sl.weapon, slung2Pos: sl2.weaponPos, slung2Q: sl2.weapon, clips: operatorClips(),
  }, weaponKit());
  return new OperatorFigure(A, { loadout });
}

test('the rig draws the loadout: pack or rucksack, helmet and night vision, radio, armour, sidearm, grenades, medical', () => {
  const f = figure();
  let F = f.setLoadout(fullKit('radio', { nvg: true, armour: 'heavy', sidearm: 'pistol', medkit: 'bag', frag: 3, flash: 0, breach: true }));
  assert.equal(F.rucksack, true);
  assert.equal(F.manpack, true);
  assert.equal(F.nvg, true);
  assert.equal(F.shoulders, true);
  assert.equal(F.holster, true);
  assert.equal(F.medbag, true);
  assert.equal(F.frags, 3);
  assert.equal(F.breach, true);
  assert.equal(f.parts.secondary.visible, false, 'no carbine across the back');
  assert.equal(f.parts.carrier.visible, true);
  assert.equal(f.loParts.frags.children.filter((m) => m.visible).length, 3);
  f.update(0.1);
  assert.equal(f.flashBelt.visible, false, 'no flash-bang on the belt');
  // and back to a plain rifleman
  F = f.setLoadout(fullKit('rifleman', { armour: 'none', helmet: false, pack: 'none', radio: 'none' }));
  assert.equal(f.parts.pack.visible, false);
  assert.equal(f.parts.helmet.visible, false);
  assert.equal(f.parts.carrier.visible, false);
  assert.equal(F.nvg, false);
  assert.equal(F.manpack, false);
  assert.equal(f.loParts.nvg.visible, false);
  assert.equal(f.loParts.shoulders.every((m) => !m.visible), true);
  assert.equal(f.parts.secondary.visible, true);
  f.update(0.1);
  assert.equal(f.flashBelt.visible, true);
  // the primary on the weapon bone; the flame gun needs a figure of its own
  assert.equal(f.setLoadout({ primary: 'shotgun' }).primary, 'shotgun');
  assert.equal(f.primaryKind, 'shotgun');
  f.setLoadout({ primary: 'flamer' });
  assert.equal(f.needsRebuild, true);
  const t = figure('torch');
  t.setLoadout(fullKit('flame'));
  assert.equal(t.needsRebuild, false);
  assert.ok(Object.keys(ROLES).length >= 11);
});

test('in the world: a squad of 7 spawns 7 men with their roles and loadouts; other rigs carry their settings', async () => {
  const { createSimulation } = await import('../src/sim/createSimulation.js');
  const sim = createSimulation({
    world: { size: [40, 4, 40], h: 0.25, ground: 'quarrySand' },
    objects: [{ type: 'squad', params: { unit: 'Bravo', size: 7, men: [{}, {}, { role: 'rope' }] }, x: 20, z: 20 }],
    noFire: true,
  });
  sim.step(sim.dt);
  const men = sim.world.enemies.filter((e) => e.unit === 'Bravo');
  assert.equal(men.length, 7);
  assert.deepEqual(men.map((e) => e.squadRole), ['leader', 'gunner', 'rope', 'rifleman', 'medic', 'marksman', 'grenadier']);
  assert.ok(men.every((e) => e.kit && e.rank));
  assert.equal(men[2].ropes, 1, 'the rope man has his coil');
  for (let t = 0; t < 2; t += sim.dt) sim.step(sim.dt);
  assert.ok(men.every((e) => e.kitted && e.kitGiven && e.loadKg > 20));
  // the helicopter: its weight from fuel, men, guns and armour; lighter performs better
  const { heliMass, HELI } = await import('../src/ai/helicopter.js');
  assert.equal(heliMass({}), HELI.mass);
  assert.ok(heliMass({ fuel: 0.3, soldiers: 2 }) < HELI.mass - 1000);
  assert.ok(heliMass({ armour: 'armoured' }) > HELI.mass);
  const heli = (await import('../src/models/helicopter.js')).default;
  const hp = defaults(heli);
  assert.equal(heli.build({ ...hp, fuel: 0.5 }).helis[0].fuel, 0.5);
  // the dragon: age, fire capacity, aggression, armour scales
  const dragon = (await import('../src/models/dragon.js')).default;
  const dp = defaults(dragon);
  const old = dragon.build({ ...dp, age: 'ancient', scaleArmour: 0.3 }).dragons[0];
  assert.ok(old.health > dp.health && old.scaleArmour > 0.3);
  assert.equal(dragon.build({ ...dp, fireCapacity: 2 }).dragons[0].fireCapacity, 2);
  // the smith: pace and skill, into the workshop's simulation
  const smithy = (await import('../src/models/smithy.js')).default;
  const sp = defaults(smithy);
  assert.ok(smithy.params.smithPace && smithy.params.smithSkill);
  const built = smithy.build({ ...sp, smithPace: 1.5, smithSkill: 0.8 }, { rng: seeded(1) });
  assert.equal(built.smithies[0].pace, 1.5);
  assert.equal(built.smithies[0].skill, 0.8);
});
