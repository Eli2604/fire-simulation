import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { P, solve, pose0, operatorClips, OperatorFigure, weaponKit, weaponClips, weaponPose, gunPoints, SWITCH_TIME, PISTOL_RELOAD, LABELS, ONCE, WATER } from '../src/operator/rig.js';
import { driveFromAI } from '../src/operator/drive.js';
import { kit, switchTo, canShoot, TIMES } from '../src/ai/soldier.js';
import { handKind } from '../src/ai/weapons.js';
import { kitMass, mobility } from '../src/ai/loadout.js';
import { stepNoise, emitSound, hears, senses, rangeFromDb } from '../src/ai/perception.js';
import { SquadAI } from '../src/ai/squad.js';
import { stepSwim, swimAbility, ditchGear, playerGear, waterCost, SWIM_DEPTH } from '../src/ai/swim.js';
import { footstepVoice, groundKind } from '../src/audio/footsteps.js';

/* ---------------------------------------------------------------- 1. weapons drawn right */
function stubAssets() {
  const geo = () => new THREE.BoxGeometry(0.05, 0.05, 0.05);
  const mat = new THREE.MeshStandardMaterial();
  const sl = solve(Object.assign(pose0(), { sling: 1 })), sl2 = solve(Object.assign(pose0(), { sling2: 1 }));
  return Object.assign({
    person: [geo()], carrier: geo(), sling: geo(), rifle: geo(), mag: geo(), helmet: geo(), pack: geo(), secondary: geo(), antenna: geo(), mic: geo(), foam: geo(),
    cords: [], black: mat, grenade: geo(), grenadeFuse: geo(), grenadeMat: mat, flashTex: null,
    drone: new THREE.Group(), goggles: new THREE.Group(), ctrl: new THREE.Group(), torchGun: new THREE.Group(), torchTanks: new THREE.Group(), nozzle: new THREE.Vector3(),
    slungPos: sl.weaponPos, slungQ: sl.weapon, slung2Pos: sl2.weaponPos, slung2Q: sl2.weapon, clips: operatorClips(),
  }, weaponKit());
}
const run = (f, s, each) => {
  for (let t = 0; t < s; t += 1 / 30) {
    f.update(1 / 30);
    each?.(f);
  }
};
/** A gun's extent in rifle-local terms (x along the barrel, y up). */
function extent(g) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const ax = [P.R.x, P.R.y, P.R.z].map((a) => new THREE.Vector3(...a));
  g.updateMatrixWorld(true);
  g.traverse((m) => {
    if (!m.isMesh) return;
    const pos = m.geometry.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      for (let k = 0; k < 3; k++) {
        const c = v.dot(ax[k]);
        lo[k] = Math.min(lo[k], c);
        hi[k] = Math.max(hi[k], c);
      }
    }
  });
  return { lo, hi, n: g.children.length };
}
const inside = (p, e, pad = 0.03) => p.every((v, k) => v >= e.lo[k] - pad && v <= e.hi[k] + pad);

test('the carbine, the marksman rifle and the pistol each have a mesh of their own, with the hands\' points on it', () => {
  const { guns } = weaponKit();
  const E = Object.fromEntries(['carbine', 'marksman', 'pistol', 'shotgun'].map((k) => [k, extent(guns[k])]));
  const len = (k) => E[k].hi[0] - E[k].lo[0];
  assert.ok(len('pistol') < 0.35, `the pistol short (${len('pistol').toFixed(2)})`);
  assert.ok(len('carbine') < len('marksman') - 0.3, `the carbine shorter than the marksman rifle (${len('carbine').toFixed(2)} / ${len('marksman').toFixed(2)})`);
  assert.ok(E.carbine.hi[0] < 0.9 && E.marksman.hi[0] > 1.2, 'a short barrel, a long one');
  assert.ok(E.carbine.lo[0] < -0.05 && E.carbine.lo[0] > -0.15, 'the carbine\'s stock pushed in short');
  assert.ok(E.marksman.hi[1] > 0.11, 'a scope over the marksman rifle');
  assert.ok(E.marksman.lo[1] < -0.02 && guns.marksman.children.length > guns.carbine.children.length, 'and its bipod under the handguard');
  assert.notEqual(guns.carbine, guns.marksman);
  for (const k of ['carbine', 'marksman', 'pistol', 'shotgun']) {
    const pts = guns[k].userData.points;
    assert.ok(pts && pts.grip && pts.fore, `${k}: hand points`);
    assert.ok(inside(pts.grip, E[k]), `${k}: the right hand on it (${pts.grip.map((v) => v.toFixed(2))})`);
    assert.ok(inside(pts.fore, E[k], 0.05), `${k}: the left hand on it (${pts.fore.map((v) => v.toFixed(2))})`);
    assert.ok(Math.abs(pts.muzzle - E[k].hi[0]) < 0.08, `${k}: the muzzle at its end`);
  }
  assert.deepEqual(gunPoints('marksman').fore, guns.marksman.userData.points.fore);
  // held: the hands reach those points (both on it, aimed and carried)
  for (const name of ['aim', 'shoot', 'idle', 'walk', 'crouchAim']) {
    const o = solve(weaponPose('marksman', name, 0.1));
    assert.ok(o.reach.R < 0.015 && o.reach.L < 0.015, `marksman ${name}: both hands on it`);
  }
  // on the figure: each its own mesh, the rifle's magazine kept in the carbine's and the marksman's well
  const A = stubAssets();
  const f = new OperatorFigure(A);
  f.setPrimary('carbine');
  assert.ok(f.parts.rifle.getObjectByName('carbine') && f.parts.mag.visible);
  f.setPrimary('marksman');
  assert.ok(f.parts.rifle.getObjectByName('marksman') && !f.parts.rifle.getObjectByName('carbine'));
  assert.equal(f.actions.aim.getClip(), weaponClips('marksman').aim, 'held its own way');
  f.setLoadout({ primary: 'carbine' });
  assert.equal(f.primaryKind, 'carbine');
});

test('a pistol sidearm: drawn from its holster, held, fired and reloaded as a pistol; back to the rifle', () => {
  const A = stubAssets();
  const f = new OperatorFigure(A);
  f.setLoadout({ sidearm: 'pistol' });
  assert.equal(f.sidearm, 'pistol');
  const sp = f.parts.sidePistol;
  assert.equal(sp.parent, f.bones.hips, 'in its holster');
  assert.equal(f.parts.secondary.visible, false, 'no carbine on his back');
  const T = f.switchWeapon('secondary');
  assert.ok(Math.abs(T - SWITCH_TIME.pistol) < 1e-6, `the switch takes ${T}`);
  assert.equal(f.shown, 'holsterRifle', 'the rifle slung first');
  const seen = new Set();
  run(f, T + 0.2, (g) => seen.add(g.shown));
  assert.ok(seen.has('drawPistol') && !seen.has('drawSecondary'), 'the pistol draw, not the carbine\'s');
  assert.equal(f.weapon, 'secondary');
  assert.equal(f.handling, 'pistol');
  assert.equal(sp.parent, f.bones.weapon, 'the pistol in his hands');
  assert.equal(f.parts.rifle.parent, f.bones.chest, 'the rifle on his back');
  assert.equal(f.actions.aim.getClip(), weaponClips('pistol').aim, 'pistol aim');
  assert.equal(f.actions.reload.getClip().duration, PISTOL_RELOAD, 'pistol reload');
  assert.notEqual(f.actions.shoot.getClip(), A.clips.shoot, 'pistol firing');
  // the draw: the right hand down at the holster first, then both hands on it
  const p0 = weaponPose('pistol', 'drawPistol', 0.05), p1 = solve(weaponPose('pistol', 'drawPistol', 0.85));
  assert.ok(p0.rG < 0.3 && p1.reach.R < 0.02 && weaponPose('pistol', 'drawPistol', 0.85).lG > 0.9, 'from the holster into a two-handed grip');
  assert.ok(ONCE.drawPistol && ONCE.holsterPistol && LABELS.drawPistol);
  // and back
  const T2 = f.switchWeapon('rifle');
  assert.equal(f.shown, 'holsterPistol');
  run(f, T2 + 0.2);
  assert.equal(f.handling, 'rifle');
  assert.equal(sp.parent, f.bones.hips, 'holstered again');
  assert.equal(f.parts.rifle.parent, f.bones.weapon);
  assert.equal(f.actions.aim.getClip(), A.clips.aim);
});

test('the AI switches to a pistol sidearm with the pistol draw; the figure follows it', () => {
  const m = { p: [0, 0, 0], squad: 'R1', kit: { sidearm: 'pistol' } };
  kit(m);
  assert.equal(m.secArms, 'pistol');
  const sq = { time: 0, setAnim: (q, a, d) => ((q.anim = a), (q.animT = sq.time), (q.animDur = d)) };
  switchTo(sq, m, 'secondary');
  assert.equal(m.anim, 'drawPistol');
  assert.ok(Math.abs(m.switching.until - TIMES.toPistol) < 1e-9);
  assert.equal(handKind({ ...m, weapon: 'secondary' }), 'pistol');
  const f = new OperatorFigure(stubAssets());
  const st = {};
  driveFromAI(f, m, st);
  assert.equal(f.sidearm, 'pistol');
  assert.equal(f.switching, 'drawPistol', 'the rifle slung, the pistol drawn next');
  run(f, SWITCH_TIME.pistol + 0.2, () => driveFromAI(f, m, st));
  assert.equal(f.handling, 'pistol');
});

/* ---------------------------------------------------------------- 2. gear noise heard */
const HEAVY = { primary: 'mg', pack: 'rucksack', armour: 'heavy', radio: 'manpack', frag: 4 };
const LIGHT = { pack: 'none', armour: 'none', frag: 0, smoke: 0, flash: 0, mags: 2, sidearm: 'none', radio: 'none', water: 0, torch: false };
const gearDb = (k) => mobility(kitMass(k).total).noiseDb;

test('footsteps: a loaded man sprinting is louder than a light one walking, a crawler quietest; the ground and care count', () => {
  const sprint = stepNoise({ pace: 'sprint', gearDb: gearDb(HEAVY) });
  const walk = stepNoise({ pace: 'walk', gearDb: gearDb(LIGHT) });
  const crawl = stepNoise({ pace: 'crawl', gearDb: gearDb(LIGHT) });
  assert.ok(sprint.dB > walk.dB + 12 && walk.dB > crawl.dB + 10, `${sprint.dB.toFixed(1)} > ${walk.dB.toFixed(1)} > ${crawl.dB.toFixed(1)} dB`);
  assert.ok(stepNoise({ pace: 'run', gearDb: gearDb(HEAVY) }).dB > stepNoise({ pace: 'run', gearDb: gearDb(LIGHT) }).dB + 2, 'the heavy kit rattles');
  assert.ok(stepNoise({ pace: 'walk', surface: 'concrete' }).dB > stepNoise({ pace: 'walk', surface: 'grass' }).dB + 8, 'concrete rings, grass deadens');
  assert.ok(stepNoise({ pace: 'walk', stealth: true }).dB < stepNoise({ pace: 'walk' }).dB, 'with care, quieter');
  // heard further: a guard's ears
  const guard = { p: [0, 0, 0] }, prof = senses(guard, 'guard');
  const heardAt = (dB) => {
    for (let d = 200; d > 0; d -= 0.5) if (hears(guard, { p: [d, 1.6, 0], dB, loud: rangeFromDb(dB) }, { prof, at: [0, 1.6, 0], rand: () => 0.5 })) return d;
    return 0;
  };
  assert.ok(heardAt(sprint.dB) > 3 * heardAt(walk.dB) && heardAt(walk.dB) > heardAt(crawl.dB), 'heard from further off');
  // the audio: the ground and the kit in the sound
  assert.equal(groundKind('concrete'), 'hard');
  assert.equal(groundKind('grass'), 'grass');
  const v1 = footstepVoice({ surface: 'concrete', pace: 'run', step: 57, rattle: 0 }), v2 = footstepVoice({ surface: 'grass', pace: 'run', step: 57, rattle: 0 });
  assert.ok(v1[0].freq > 2 * v2[0].freq && v2.length > v1.length, 'a click on concrete, a thud and a swish on grass');
  assert.ok(footstepVoice({ pace: 'sprint', step: 61, rattle: 66 }).length > footstepVoice({ pace: 'walk', step: 45, rattle: 42 }).length, 'more of the kit rattling');
});

/** Alpha (red) comes at a guard team (Bravo, blue) on open ground; returns how far off Bravo heard them first. */
function approach(kitOf, mode) {
  const world = { time: 0, noises: [] };
  const members = [];
  for (const [i, squad] of ['CMD', 'R1', 'R2'].entries()) members.push({ p: [-1 + i, 0, 120], yaw: Math.PI, squad, unit: 'Alpha', kit: { ...kitOf } });
  for (const [i, squad] of ['CMD', 'R1'].entries()) members.push({ p: [-1 + 2 * i, 0, 0], yaw: 0, squad, unit: 'Bravo', side: 'blue' });
  const base = { members: () => members, solid: () => false, floor: () => 0, bounds: [-20, -10, 20, 130] };
  const alpha = new SquadAI({ ...base, unit: 'Alpha', sound: (n) => emitSound(world, n) });
  const bravo = new SquadAI({ ...base, unit: 'Bravo', noises: () => world.noises });
  let heard = null;
  bravo.investigate = (p) => (heard ??= Math.min(...members.filter((m) => m.unit === 'Alpha').map((m) => Math.hypot(m.p[0], m.p[2]))));
  alpha.step(0.05);
  for (const m of members) if (m.unit === 'Alpha') {
    alpha.follow(m, [[m.p[0], 0, 3]], mode);
    if (mode === 'crawl') m.crawling = true;
  }
  for (let t = 0; t < 120 && heard == null; t += 0.05) {
    world.time = t;
    alpha.step(0.05);
    bravo.step(0.05);
  }
  return heard ?? 0;
}

test('a guard team hears a running, heavily loaded squad sooner (further off) than a light one, and a crawling one hardly at all', () => {
  const heavyRun = approach(HEAVY, 'run');
  const lightRun = approach(LIGHT, 'run');
  const lightCrawl = approach(LIGHT, 'crawl');
  assert.ok(heavyRun > 25, `the loaded runners heard ${heavyRun.toFixed(1)} m off`);
  assert.ok(heavyRun > lightRun + 5, `sooner than light runners (${heavyRun.toFixed(1)} vs ${lightRun.toFixed(1)} m)`);
  assert.ok(lightCrawl < lightRun / 3, `crawling, only close (${lightCrawl.toFixed(1)} m)`);
});

/* ---------------------------------------------------------------- 3. in the water */
/** A field with a channel of deep water across it (|x| < 2: 2.3 m deep), optionally a ford at z > 8. */
function channel({ ford = false } = {}) {
  const wet = (x, z) => Math.abs(x) < 2 && !(ford && z > 8);
  const members = [], log = [];
  const sq = new SquadAI({
    unit: 'Alpha', members: () => members, solid: () => false, bounds: [-16, -16, 16, 16],
    floor: (x, z) => (wet(x, z) ? -2.5 : 0),
    water: (x, z, y) => (wet(x, z) ? { depth: -0.2 - y, surface: -0.2 } : null),
    log: (m, text) => log.push(text),
  });
  return { sq, members, log, wet };
}
function cross(kitOf, extra = {}) {
  const C = channel();
  const m = Object.assign({ p: [-6, 0, 0], yaw: Math.PI / 2, squad: 'R1', unit: 'Alpha', kit: { ...kitOf } }, extra);
  C.members.push(m);
  C.sq.step(0.05);
  const swim0 = m.swim;
  C.sq.follow(m, C.sq.route(m.p, [6, 0, 0], m), 'walk');
  const anims = new Set();
  let swam = 0;
  for (let t = 0; t < 120 && !m.dead; t += 0.05) {
    C.sq.step(0.05);
    if (m.swimming) (swam += 0.05), anims.add(m.anim);
    if (!m.path && m.p[0] > 5) break;
  }
  return { m, swam, anims, log: C.log, swim0 };
}

test('a light soldier swims across a channel', () => {
  const { m, swam, anims, swim0 } = cross(LIGHT);
  assert.equal(swim0, 'swims');
  assert.ok(m.p[0] > 5 && !m.dead, `across (${m.p[0].toFixed(1)})`);
  assert.ok(swam > 3 && anims.has('swim'), `swimming a while (${swam.toFixed(1)} s: ${[...anims]})`);
  assert.ok(!m.ditched, 'kept all his kit');
  assert.ok(m.weaponWet, 'his weapon got wet');
  assert.ok(swimAbility(kitMass(LIGHT).total).speed > swimAbility(kitMass({ ...LIGHT, pack: 'assault' }).total).speed, 'lighter, faster');
});

test('a heavily loaded soldier ditches gear to stay up (logged); one who cannot get it off drowns', () => {
  const h = cross(HEAVY);
  assert.equal(h.swim0, 'sinks');
  assert.ok(h.m.ditched?.length >= 2 && h.m.ditched.includes('rucksack'), `ditched: ${h.m.ditched}`);
  assert.ok(!h.m.dead && h.m.p[0] > 5, 'made it across');
  assert.ok(h.log.some((s) => /ditches his rucksack/.test(s)), 'logged');
  assert.equal(h.m.swim, 'swims');
  assert.ok(h.anims.has('swimStruggle'), 'struggling first');
  // both arms hit: he cannot get the straps off, and goes down
  const d = cross(HEAVY, { wounds: { armL: 1, armR: 1 } });
  assert.ok(d.m.dead && d.m.drowned, 'drowned');
  assert.ok(!d.m.ditched, 'with all his kit');
  assert.ok(d.anims.has('drown') && d.log.some((s) => /drowned/.test(s)));
  // and the rig has the clips for it
  const clips = operatorClips();
  for (const k of Object.keys(WATER)) {
    assert.ok(clips[k] && LABELS[k], k);
    for (const tr of clips[k].tracks) assert.ok(tr.values.every(Number.isFinite), `${k} ${tr.name}`);
  }
});

test('a struggling man tires fast and goes under when spent; out of the water his weapon is cleared before it fires', () => {
  const m = { p: [0, 0, 0], squad: 'R1', kit: { ...LIGHT, pack: 'assault' }, noDitch: true };
  kit(m);
  assert.equal(m.swim, 'struggles');
  let under = 0;
  for (let t = 0; t < 60 && !m.dead; t += 0.1) if (stepSwim(m, 0.1, { depth: 3, surface: 0, floor: -3 }, { now: t, moving: true })?.under) under += 0.1;
  assert.ok(m.stamina === 0 && under > 0, 'spent, under');
  const q = { p: [0, 0, 0], squad: 'R1', kit: LIGHT };
  kit(q);
  stepSwim(q, 0.1, { depth: 3, surface: 0, floor: -3 }, { now: 0 });
  assert.equal(canShoot({ ...q, mag: 30 }), false, 'no firing while swimming');
  stepSwim(q, 0.1, { depth: 0 }, { now: 1 });
  assert.ok(q.drainUntil > 1, 'the water out of it first');
});

test('routes keep out of deep water when there is a dry way round; without one a light man swims it', () => {
  const C = channel({ ford: true });
  const m = { p: [-6, 0, 0], yaw: 0, squad: 'R1', unit: 'Alpha' };
  C.members.push(m);
  C.sq.step(0.05);
  const r = C.sq.route(m.p, [6, 0, 0], m);
  const pts = [m.p, ...r];
  let wetLen = 0;
  for (let i = 1; i < pts.length; i++) {
    assert.ok(!C.wet(pts[i][0], pts[i][2]), `the route stays dry (${pts[i][0].toFixed(1)}, ${pts[i][2].toFixed(1)})`);
    const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]);
    for (let k = 0; k < 40; k++) {
      const x = pts[i - 1][0] + ((pts[i][0] - pts[i - 1][0]) * (k + 0.5)) / 40, z = pts[i - 1][2] + ((pts[i][2] - pts[i - 1][2]) * (k + 0.5)) / 40;
      if (C.wet(x, z)) wetLen += L / 40;
    }
  }
  assert.ok(wetLen < 0.6, `round by the ford, not through the water (${wetLen.toFixed(2)} m wet)`);
  assert.ok(Math.max(...r.map((p) => p[2])) > 8, 'by the ford');
  // no ford: straight through (a short swim)
  const D = channel();
  const n = { p: [-6, 0, 0], yaw: 0, squad: 'R1', unit: 'Alpha' };
  D.members.push(n);
  D.sq.step(0.05);
  const r2 = D.sq.route(n.p, [6, 0, 0], n);
  assert.ok(r2.length && r2[r2.length - 1][0] > 5 && Math.max(...r2.map((p) => Math.abs(p[2]))) < 3, 'across, not round');
  assert.ok(waterCost(SWIM_DEPTH + 1, 'swims') < waterCost(SWIM_DEPTH + 1, 'struggles') && waterCost(0.6) < waterCost(2), 'swimming costs more for the heavy, wading little');
});

test('the player swims by the same rule: light he swims, a heavy kit sinks him until he ditches it', () => {
  const g = playerGear();
  assert.equal(swimAbility(g.loadKg, g.fitness).cls, 'swims');
  const h = playerGear({ pack: 'rucksack', armour: 'plates' });
  assert.equal(swimAbility(h.loadKg, h.fitness).cls, 'sinks');
  const out = [];
  while (swimAbility(h.loadKg, h.fitness).cls !== 'swims') out.push(ditchGear(h));
  assert.deepEqual(out.slice(0, 1), ['rucksack']);
  assert.ok(h.loadKg < 20);
});
