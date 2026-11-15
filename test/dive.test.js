import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SquadAI } from '../src/ai/squad.js';
import { kit } from '../src/ai/soldier.js';
import { fullKit, kitMass, diveStowage, KIT_FIELDS, BREATHER } from '../src/ai/loadout.js';
import { perceive } from '../src/ai/perception.js';
import { stepSwim, ditchGear } from '../src/ai/swim.js';
import { breathHoldCap, diveAbility, buoyancy, stepGas, gasOf, submergedRange, waterLoad, gearUpTime, WATER_VIS, O2_DEPTH } from '../src/ai/dive.js';

const LIGHT = { pack: 'none', armour: 'none', frag: 0, smoke: 0, flash: 0, mags: 2, sidearm: 'none', radio: 'none', water: 0, torch: false };

/** A field with water over x0 < x < x1 (3 m deep, its surface at -0.2), dry ground either side. */
function pond(x0, x1, { bounds = [-14, -6, x1 + 16, 6], solid = () => false, vis } = {}) {
  const wet = (x) => x > x0 && x < x1;
  const members = [], log = [];
  const sq = new SquadAI({
    unit: 'Alpha', members: () => members, solid, bounds,
    floor: (x, z) => (wet(x) ? -3.2 : 0),
    water: (x, z, y) => (wet(x) ? { depth: -0.2 - y, surface: -0.2, vis } : null),
    log: (m, text) => log.push(text),
    now: () => sq.time,
  });
  return { sq, members, log, wet };
}
/** An enemy on the far bank, watching the water (a soldier's senses, all round). */
const watcher = (x) => ({ p: [x, 0, 0], squad: 'R1', yaw: -Math.PI / 2, anim: 'aim' });

test('breath hold: a fit, trained man rested holds longest; winded or wounded, much less', () => {
  const fit = { fitness: 0.9, skill: 'veteran', stamina: 1, health: 100 };
  const tired = { ...fit, stamina: 0.1 };
  const hurt = { ...fit, health: 40, wounds: { torso: 1 }, bleed: 0.5 };
  const recruit = { fitness: 0.2, skill: 'recruit', stamina: 1, health: 100 };
  const elite = { fitness: 1, skill: 'elite', stamina: 1, health: 100 };
  const [a, b, c, r, e] = [fit, tired, hurt, recruit, elite].map(breathHoldCap);
  assert.ok(a > b + 15 && a > c + 15, `fit rested ${a.toFixed(0)} s > exhausted ${b.toFixed(0)} s, wounded ${c.toFixed(0)} s`);
  assert.ok(r >= 30 && r < 45 && e > 80 && e <= 90, `30–90 s: recruit ${r.toFixed(0)}, elite ${e.toFixed(0)}`);
  // under water a load and a negative buoyancy make him work harder (his breath goes faster) and slower
  const light = { kit: fullKit('rifleman', { ...LIGHT }) }, plates = { kit: fullKit('rifleman', { ...LIGHT, armour: 'plates' }) };
  for (const q of [light, plates]) q.loadKg = kitMass(q.kit).total;
  assert.ok(buoyancy(plates) < buoyancy(light) - 4, 'plates sink him');
  assert.ok(diveAbility(plates).effort > diveAbility(light).effort && diveAbility(plates).speed < diveAbility(light).speed);
  const fins = { kit: fullKit('rifleman', { ...LIGHT, fins: true, diveWorn: true }) };
  fins.loadKg = kitMass(fins.kit).total;
  assert.ok(diveAbility(fins).speed > diveAbility(light).speed && diveAbility(fins).effort < diveAbility(light).effort, 'fins: faster for less effort');
});

test('under fire in the water a soldier dives and crosses submerged; the enemy on the bank cannot see him under water beyond the visibility', () => {
  const P = pond(-6, 6);
  const m = { p: [-10, 0, 0], yaw: Math.PI / 2, squad: 'R1', unit: 'Alpha', kit: { ...LIGHT } };
  P.members.push(m);
  P.sq.step(0.05);
  P.sq.follow(m, P.sq.route(m.p, [10, 0, 0], m), 'walk');
  const E = watcher(20);
  let under = 0, hiddenFar = 0, seenFar = 0, surfaceSeen = 0;
  for (let t = 0; t < 120 && !m.dead; t += 0.05) {
    // rounds cracking past him from the far bank
    m.shotAt = { time: P.sq.time, from: [20, 1.6, 0], dir: [-1, 0, 0] };
    P.sq.step(0.05);
    const r = perceive(E, m, 0.05, { now: P.sq.time, instant: true, light: 1 });
    if (m.submerged > 0.3) {
      under += 0.05;
      if (r.d > submergedRange(m.submerged, WATER_VIS)) {
        if (r.visible) seenFar++;
        else hiddenFar++;
      }
    } else if (m.swimming && r.visible) surfaceSeen++;
    if (!m.path && m.p[0] > 9) break;
  }
  assert.ok(P.log.some((s) => /dives to cross under fire/.test(s)), `logged: ${P.log}`);
  assert.ok(under > 4, `submerged a while (${under.toFixed(1)} s)`);
  assert.ok(hiddenFar > 40 && seenFar === 0, `not seen while under (${hiddenFar} steps hidden, ${seenFar} seen)`);
  assert.ok(surfaceSeen > 0, 'seen at the surface before he went under');
  assert.ok(!m.dead && m.p[0] > 6, `across (${m.p[0].toFixed(1)})`);
  // close to him, in clear water, he can be made out under it
  const near = { p: [m.p[0], 0, 0] };
  assert.ok(perceive({ p: [0, 0, 1.5], squad: 'R1' }, { p: [0, -2, 0], submerged: 1, waterVis: 15 }, 0.1, { instant: true, light: 1 }).visible, 'near, clear water: seen');
  assert.ok(near);
});

test('a soldier with a rebreather in his rucksack gears up at the edge (time, logged, covered), then swims far under water without surfacing and without bubbles', () => {
  const P = pond(0, 60);
  const k = { ...LIGHT, pack: 'rucksack', breather: 'rebreather', fins: true, drybag: true };
  assert.equal(fullKit('rifleman', k).diveWorn, false, 'packed in the rucksack');
  const m = { p: [-8, 0, 0], yaw: Math.PI / 2, squad: 'R1', unit: 'Alpha', kit: { ...k } };
  const mate = { p: [-9, 0, 2], yaw: Math.PI / 2, squad: 'CMD', unit: 'Alpha', kit: { ...LIGHT } };
  P.members.push(m, mate);
  P.sq.step(0.05);
  P.sq.follow(m, P.sq.route(m.p, [66, 0, 0], m), 'walk');
  const T = gearUpTime(m);
  assert.ok(T > 60, `gearing up takes a while (${T.toFixed(0)} s)`);
  let tGear = null, tGeared = null, surfaced = 0, bubbles = 0, under = 0, mateCovering = false, maxD = 0;
  for (let t = 0; t < 600 && !m.dead; t += 0.1) {
    P.sq.step(0.1);
    if (m.gearUp && tGear == null) tGear = P.sq.time;
    if (m.gearUp && mate.anim === 'crouchAim' && mate.coverFor === m) mateCovering = true;
    if (tGear != null && tGeared == null && m.kit.diveWorn) tGeared = P.sq.time;
    if (m.bubbles) bubbles++;
    if (m.submerged > 0.3) {
      under += 0.1;
      maxD = Math.max(maxD, m.submerged);
    }
    // in the middle of the pond (well clear of either bank): never up at the surface
    if (m.swimming && m.p[0] > 8 && m.p[0] < 52 && !(m.submerged > 0.3)) surfaced++;
    if (!m.path && m.p[0] > 62) break;
  }
  assert.ok(tGear != null && tGeared - tGear >= T - 0.5, `geared up at the edge (${(tGeared - tGear).toFixed(0)} s)`);
  assert.ok(P.log.some((s) => /gears up at the water's edge: rebreather, mask and fins and dry bag out of his rucksack/.test(s)), P.log.join('\n'));
  assert.ok(P.log.some((s) => /team covering him/.test(s)) && mateCovering, 'the team covers him');
  assert.ok(P.log.some((s) => /geared up, his rucksack towed in the dry bag, his weapon sealed/.test(s)));
  assert.ok(P.log.some((s) => /dives to swim across under water \(on his rebreather, no bubbles, finning\)/.test(s)), P.log.join('\n'));
  assert.ok(under > 40, `under water a long way (${under.toFixed(0)} s)`);
  assert.equal(surfaced, 0, 'never surfaced in the middle');
  assert.equal(bubbles, 0, 'no bubbles');
  assert.ok(maxD <= O2_DEPTH, `kept within the oxygen limit (${maxD.toFixed(1)} m)`);
  assert.ok(!m.dead && m.p[0] > 60, `across (${m.p[0].toFixed(1)})`);
  assert.ok(m.diveGas.litres > 0.9 * m.diveGas.full, 'a little of his oxygen used');
  assert.equal(m.weaponWet, false, 'his weapon dry in its bag');
});

test('scuba: air goes faster deeper, and its bubbles give him away; the rebreather leaves none', () => {
  const diver = (breather) => {
    const q = { kit: fullKit('rifleman', { ...LIGHT, breather, fins: true, diveWorn: true }) };
    gasOf(q);
    return q;
  };
  const sh = diver('scuba'), dp = diver('scuba');
  for (let t = 0; t < 60; t += 0.1) {
    stepGas(sh, 0.1, 1, 0.6);
    stepGas(dp, 0.1, 10, 0.6);
  }
  const usedS = sh.diveGas.full - sh.diveGas.litres, usedD = dp.diveGas.full - dp.diveGas.litres;
  assert.ok(usedD > 1.7 * usedS, `deeper, more air (${usedS.toFixed(0)} l at 1 m, ${usedD.toFixed(0)} l at 10 m a minute)`);
  assert.ok(stepGas(sh, 0.1, 2, 0.5).bubbles, 'open circuit: bubbles');
  const rb = diver('rebreather');
  assert.ok(!stepGas(rb, 0.1, 2, 0.5).bubbles, 'closed circuit: none');
  // swimming under at 2 m: the bubbles seen from the bank 25 m off; the rebreather diver not
  const sea = { depth: 4, surface: 0, floor: -4 };
  const seen = {};
  for (const kind of ['scuba', 'rebreather']) {
    const q = Object.assign(diver(kind), { p: [0, -2, 0], squad: 'R1', diving: true, diveDepth: 2 });
    kit(q);
    const E = { p: [25, 0.5, 0], squad: 'R1' };
    for (let t = 0; t < 30; t += 0.1) {
      stepSwim(q, 0.1, sea, { now: t, moving: true });
      q.p[1] = sea.surface - 2;
      if (perceive(E, q, 0.1, { now: t, light: 1 }).seen && q.submerged > 1.5) seen[kind] ??= t;
    }
    assert.ok(q.submerged > 1.5, `${kind}: under (${q.submerged})`);
  }
  assert.ok(seen.scuba != null, 'the scuba diver\'s bubbles noticed');
  assert.ok(seen.rebreather == null, 'the rebreather diver unseen');
  // and heard: a burble at the surface each breath (host.sound)
  const heard = [];
  const q = Object.assign(diver('scuba'), { p: [0, -2, 0], squad: 'R1', diving: true });
  kit(q);
  for (let t = 0; t < 10; t += 0.1) stepSwim(q, 0.1, sea, { now: t, moving: true, sound: (m, dB) => heard.push(dB) });
  assert.ok(heard.length >= 2 && heard[0] > 40, `bubbles heard (${heard.length})`);
});

test('the rebreather deeper than its oxygen allows: toxicity builds, he convulses and loses the mouthpiece (logged)', () => {
  const q = { kit: fullKit('rifleman', { ...LIGHT, breather: 'rebreather', fins: true, diveWorn: true }), p: [0, -9, 0], squad: 'R1', diving: true, diveDepth: 10 };
  kit(q);
  const log = [];
  for (let t = 0; t < 400 && !q.diveGas?.lost; t += 0.1) stepSwim(q, 0.1, { depth: 12, surface: 0, floor: -12 }, { now: t, moving: false, log: (m, s) => log.push(s) });
  assert.ok(q.diveGas.lost && log.some((s) => /convulses \(oxygen toxicity/.test(s)), log.join('\n'));
  // within its limit: none
  const r = { kit: fullKit('rifleman', { ...LIGHT, breather: 'rebreather', diveWorn: true }) };
  for (let t = 0; t < 1200; t += 1) stepGas(r, 1, 5, 0.5);
  assert.ok(!r.diveGas.lost && !(r.oxTox > 0));
});

test('diving kit: in the backpack only if there is room; no backpack, it has to be worn; it goes with a ditched pack', () => {
  const none = fullKit('rifleman', { ...LIGHT, pack: 'none', breather: 'rebreather', fins: true });
  assert.equal(diveStowage({ ...none, diveWorn: false }).fits, false);
  assert.equal(none.diveWorn, true, 'no backpack: worn');
  const day = fullKit('rifleman', { ...LIGHT, pack: 'assault', breather: 'scuba' });
  assert.equal(day.diveWorn, true, 'a scuba set does not go in a day pack');
  const finsOnly = fullKit('rifleman', { ...LIGHT, pack: 'assault', fins: true, drybag: true });
  assert.equal(finsOnly.diveWorn, false, 'mask, fins and a dry bag do');
  const ruck = fullKit('rifleman', { ...LIGHT, pack: 'rucksack', breather: 'scuba', fins: true });
  assert.equal(ruck.diveWorn, false, 'the scuba set and fins in the rucksack');
  assert.ok(kitMass(ruck).items.some(([n, kg]) => /Scuba set .*in the pack/.test(n) && kg === BREATHER.scuba.kg));
  assert.ok(KIT_FIELDS.breather.options.includes('rebreather') && KIT_FIELDS.fins.bool && KIT_FIELDS.diveWorn.bool);
  // no packed kit: nothing to gear up with, a breath-hold dive only
  const m = { kit: { ...ruck }, squad: 'R1', p: [0, 0, 0] };
  kit(m);
  assert.equal(ditchGear(m), 'rucksack');
  assert.equal(m.kit.breather, 'none', 'the packed scuba set went with the rucksack');
  // worn, in the water: about neutral, he swims with it
  const w = { kit: { ...LIGHT, breather: 'scuba', fins: true, diveWorn: true }, squad: 'R1', p: [0, 0, 0] };
  kit(w);
  assert.ok(waterLoad(w) < w.loadKg - 10);
  assert.equal(w.mob.swim, 'sinks', 'by its weight in air he would sink');
  stepSwim(w, 0.1, { depth: 3, surface: 0, floor: -3 }, { now: 0 });
  assert.notEqual(w.swim, 'sinks', 'in the water the set is about neutral');
});

test('a boom across the water at the surface: the swimmer dives under it', () => {
  // a log boom across the pond at x = 4..4.6, from the surface to 0.6 m under it
  const solid = (x, y) => x > 4 && x < 4.6 && y > -0.8 && y < 0.3;
  const P = pond(-4, 12, { solid });
  const m = { p: [-8, 0, 0], yaw: Math.PI / 2, squad: 'R1', unit: 'Alpha', kit: { ...LIGHT } };
  P.members.push(m);
  P.sq.step(0.05);
  P.sq.follow(m, [[-3, 0, 0], [3, -1.7, 0], [9, -1.7, 0], [15, 0, 0]], 'walk');
  let underAtBoom = false;
  for (let t = 0; t < 120 && !m.dead; t += 0.05) {
    P.sq.step(0.05);
    if (m.p[0] > 4 && m.p[0] < 4.6) underAtBoom ||= m.submerged > 0.6;
    if (!m.path && m.p[0] > 14) break;
  }
  assert.ok(P.log.some((s) => /dives under an obstacle/.test(s)), P.log.join('\n'));
  assert.ok(underAtBoom, 'under it as he passed');
  assert.ok(m.p[0] > 12 && !m.dead);
});

test('the rig: the diving clips (duck dive, breaststroke under water, fin kick, surfacing, gearing up) and the kit drawn on the figure', async () => {
  const THREE = await import('three');
  const { operatorClips, OperatorFigure, LABELS, WATER, DIVE, solve, pose0, weaponKit } = await import('../src/operator/rig.js');
  const clips = operatorClips();
  for (const k of Object.keys(DIVE)) {
    assert.ok(clips[k] && LABELS[k], k);
    for (const tr of clips[k].tracks) assert.ok(tr.values.every(Number.isFinite), `${k} ${tr.name}`);
  }
  for (const k of ['swimUnder', 'finKick', 'duckDive', 'surfacing']) assert.ok(WATER[k], `${k} is a water clip`);
  assert.ok(!WATER.gearUp, 'gearing up is on land');
  // drawn when worn: the mask, the fins, the rebreather on the chest or the tank on the back; nothing while packed
  const geo = () => new THREE.BoxGeometry(0.05, 0.05, 0.05);
  const mat = new THREE.MeshStandardMaterial();
  const sl = solve(Object.assign(pose0(), { sling: 1 })), sl2 = solve(Object.assign(pose0(), { sling2: 1 }));
  const A = Object.assign({
    person: [geo()], carrier: geo(), sling: geo(), rifle: geo(), mag: geo(), helmet: geo(), pack: geo(), secondary: geo(), antenna: geo(), mic: geo(), foam: geo(),
    cords: [], black: mat, grenade: geo(), grenadeFuse: geo(), grenadeMat: mat, flashTex: null,
    drone: new THREE.Group(), goggles: new THREE.Group(), ctrl: new THREE.Group(), torchGun: new THREE.Group(), torchTanks: new THREE.Group(), nozzle: new THREE.Vector3(),
    slungPos: sl.weaponPos, slungQ: sl.weapon, slung2Pos: sl2.weaponPos, slung2Q: sl2.weapon, clips,
  }, weaponKit());
  const f = new OperatorFigure(A);
  let fl = f.setLoadout({ ...LIGHT, pack: 'rucksack', breather: 'rebreather', fins: true, drybag: true });
  assert.ok(!fl.diveMask && !fl.fins && !fl.rebreather, 'packed: not on him');
  fl = f.setLoadout({ ...LIGHT, pack: 'rucksack', breather: 'rebreather', fins: true, drybag: true, diveWorn: true, weights: 2 });
  assert.ok(fl.diveMask && fl.fins && fl.rebreather && !fl.scuba && fl.weights && fl.drybag && fl.towed);
  assert.equal(f.loParts.finL.parent, f.bones.footL);
  fl = f.setLoadout({ ...LIGHT, breather: 'scuba', diveWorn: true });
  assert.ok(fl.scuba && !fl.rebreather && !fl.fins && fl.diveMask);
  for (const k of Object.keys(DIVE)) f.play(k);
  for (let i = 0; i < 20; i++) f.update(1 / 30);
});
