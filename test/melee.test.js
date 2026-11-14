import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MELEE, REACT, PAIRED, PAIR_D, inReach, pickMelee, startMelee, resolveMelee, applyMelee, stepKnocked, playerMove } from '../src/ai/melee.js';
import { allows, handKind, HANDLING, gaitK } from '../src/ai/weapons.js';
import { pickRoll } from '../src/ai/evade.js';
import { ability, moveFor } from '../src/ai/parkour.js';
import { kit, canShoot } from '../src/ai/soldier.js';
import { SquadAI } from '../src/ai/squad.js';
import { operatorClips, LABELS, ONCE, OperatorFigure, solve, pose0, weaponKit } from '../src/operator/rig.js';
import { MELEE_ACTS } from '../src/rig/objects.js';

test('unarmed: the most agile profile; every move allowed, a roll included', () => {
  assert.ok(HANDLING.unarmed);
  assert.equal(handKind({ weapon: 'fists' }), 'unarmed');
  assert.equal(handKind({ loadout: 'unarmed' }), 'unarmed');
  for (const a of ['rollLeft', 'rollRight', 'rollForward', 'diveProne', 'crawl', 'proneAim', 'vaultSpeed', 'climbJump', 'mantle', 'dropRoll', 'slideCover', 'run']) assert.ok(allows('unarmed', a), a);
  assert.ok(gaitK('unarmed', 'run') > gaitK('rifle', 'run'));
  const m = { p: [0, 0, 0], yaw: 0, loadout: 'unarmed', weapon: 'fists' };
  assert.ok(pickRoll(m, { kind: 'grenade', p: [0.6, 0.1, -0.9] }).kind.match(/^roll|diveProne/), 'he rolls');
  assert.equal(moveFor({ type: 'up', h: 1.8, standable: true, face: 0.5 }, ability(m), 'run'), 'climbJump');
  const s = { squad: 'R1', loadout: 'unarmed' };
  kit(s);
  assert.equal(s.weapon, 'fists');
  assert.equal(canShoot(s), false);
});

test('a strike in range hits, out of range misses; a block takes most of it, a slip none', () => {
  const a = { p: [0, 0, 0], yaw: 0 }, d = () => ({ p: [0, 0, 0.8], yaw: Math.PI, health: 100 });
  const r = resolveMelee(a, d(), 'cross', 0.8, { now: 0, rand: () => 0.9 });
  assert.ok(r.hit && r.dmg === MELEE.cross.dmg && r.react === 'hitHead');
  const miss = resolveMelee(a, d(), 'cross', 1.6, { now: 0 });
  assert.ok(!miss.hit && /reach/.test(miss.why));
  assert.ok(!resolveMelee(a, d(), 'frontKick', 0.4).hit, 'too close for a front kick');
  assert.ok(resolveMelee(a, d(), 'frontKick', 1.2).hit);
  const blocking = Object.assign(d(), { guardKind: 'block', guardUntil: 1 });
  const b = resolveMelee(a, blocking, 'cross', 0.8, { now: 0.5 });
  assert.ok(b.hit && b.blocked && b.dmg < MELEE.cross.dmg / 2);
  const slipping = Object.assign(d(), { guardKind: 'slip', guardUntil: 1 });
  assert.ok(!resolveMelee(a, slipping, 'jab', 0.8, { now: 0.5 }).hit, 'slipped');
  assert.ok(resolveMelee(a, slipping, 'lowKick', 0.9, { now: 0.5 }).hit, 'a slip does not take the legs out of a low kick');
  // applied: health, the daze, the reaction clip
  const h = d();
  applyMelee(h, r, 2, a);
  assert.equal(h.health, 100 - MELEE.cross.dmg);
  assert.equal(h.anim, 'hitHead');
  assert.ok(h.meleeStunUntil > 2);
  // the move picked fits the distance: kicks out there, hands close in, nothing out of reach
  const rand = () => 0.99;
  assert.ok(MELEE[pickMelee(a, d(), 1.35, { rand })].limb === 'foot');
  assert.ok(MELEE[pickMelee(a, d(), 0.6, { rand })].limb === 'hand');
  assert.equal(pickMelee(a, d(), 2.5, { rand }), null);
  assert.ok(inReach('jab', 0.9) && !inReach('jab', 1.4));
  assert.equal(playerMove('kick', 1.2, 0), 'frontKick');
  assert.equal(playerMove('throw', 0.6, 0), 'hipThrow');
});

test('a throw lands the defender on his back on the ground, over the thrower; he gets up again', () => {
  const a = { p: [0, 0, 0], yaw: 0 };
  const h = { p: [0, 0, PAIR_D], yaw: Math.PI, health: 100, squad: 'R1' };
  startMelee(a, 'hipThrow', 0);
  assert.equal(a.meleeAt, MELEE.hipThrow.hit);
  const r = resolveMelee(a, h, 'hipThrow', PAIR_D, { now: a.meleeAt });
  assert.ok(r.hit && r.down && r.react === 'hipThrow_d');
  applyMelee(h, r, a.meleeAt, a);
  assert.equal(h.anim, 'hipThrow_d');
  assert.ok(stepKnocked(h, 1.0), 'down');
  // his clip over: where he landed, beyond the thrower, lying there
  const end = a.meleeAt + MELEE.hipThrow.dur;
  assert.ok(stepKnocked(h, end));
  assert.equal(h.anim, 'downed');
  assert.ok(h.p[2] < 0 && Math.abs(h.p[2] - (PAIR_D - MELEE.hipThrow.land)) < 1e-9, `landed over him (${h.p[2].toFixed(2)})`);
  assert.ok(!resolveMelee(a, h, 'jab', 0.8, { now: end }).hit, 'a man on the ground is not punched');
  // up again
  let t = end;
  while (stepKnocked(h, t) && t < end + 10) t += 0.1;
  assert.ok(t < end + 10 && !h.knockedUntil);
  // the clips: the thrown man's ends lying on the ground where he lands
  const c = operatorClips();
  for (const [k, dk] of Object.entries(PAIRED)) {
    assert.ok(c[k] && c[dk] && Math.abs(c[k].duration - c[dk].duration) < 1e-6, `${k}: a pair in step`);
  }
  const hp = c.hipThrow_d.tracks.find((tr) => tr.name === 'hips.position').values;
  const n = hp.length / 3;
  assert.ok(hp[3 * (n - 1) + 1] < 0.3, 'on the ground');
  assert.ok(Math.abs(hp[3 * (n - 1) + 2] - MELEE.hipThrow.land) < 0.02, 'where he lands');
  const mid = hp[3 * Math.round(n * (MELEE.hipThrow.hit / MELEE.hipThrow.dur)) + 1];
  assert.ok(mid > 0.9, `up over the hip (${mid.toFixed(2)})`);
});

test('the rig: every hand-to-hand clip, labelled; an unarmed figure fights from the guard; the rig acts', () => {
  const c = operatorClips();
  for (const k of [...Object.keys(MELEE), ...Object.keys(REACT), 'guard', 'downed', 'fistsUp']) {
    assert.ok(c[k] && LABELS[k], k);
    for (const tr of c[k].tracks) assert.ok(tr.values.every(Number.isFinite), `${k} ${tr.name}`);
  }
  for (const k of ['jab', 'hipThrow', 'knockDown', 'getUp']) assert.ok(ONCE[k], k);
  for (const [k, A] of Object.entries(MELEE_ACTS)) {
    assert.ok(c[k], k);
    if (A.partner) assert.ok(c[A.partner], A.partner);
    if (A.react) assert.ok(c[A.react], A.react);
  }
  const geo = () => new THREE.BoxGeometry(0.05, 0.05, 0.05);
  const mat = new THREE.MeshStandardMaterial();
  const sl = solve(Object.assign(pose0(), { sling: 1 })), sl2 = solve(Object.assign(pose0(), { sling2: 1 }));
  const A = Object.assign({
    person: [geo()], carrier: geo(), sling: geo(), rifle: geo(), mag: geo(), helmet: geo(), pack: geo(), secondary: geo(), antenna: geo(), mic: geo(), foam: geo(),
    cords: [], black: mat, grenade: geo(), grenadeFuse: geo(), grenadeMat: mat, flashTex: null, drone: new THREE.Group(), goggles: new THREE.Group(), ctrl: new THREE.Group(),
    slungPos: sl.weaponPos, slungQ: sl.weapon, slung2Pos: sl2.weaponPos, slung2Q: sl2.weapon, clips: c,
  }, weaponKit());
  const f = new OperatorFigure(A, { loadout: 'unarmed' });
  assert.equal(f.weapon, 'fists');
  assert.equal(f.handling, 'unarmed');
  assert.equal(f.parts.rifle.visible, false);
  f.play('aim');
  assert.equal(f.current.getClip().name, 'guard', 'aiming: the guard');
  f.play('jab', { restart: true });
  assert.equal(f.current.getClip().name, 'jab');
  assert.ok(f.allows('rollLeft'));
  // an armed man puts his rifle on his back and puts his fists up
  const g = new OperatorFigure(A);
  assert.ok(g.switchWeapon('fists') > 0);
  for (let t = 0; t < 2; t += 1 / 30) g.update(1 / 30);
  assert.equal(g.weapon, 'fists');
  assert.equal(g.current.getClip().name, 'guard');
});

test('the squad AI: an unarmed man closes in and fights hand-to-hand; his blows land', () => {
  const H = { p: [0, 0, 5], yaw: Math.PI, health: 100, dead: false };
  const members = [{ p: [0, 0, 10], yaw: Math.PI, squad: 'R1', unit: 'Alpha', skill: 'regular', health: 100, loadout: 'unarmed' }];
  const s = new SquadAI({ unit: 'Alpha', members: () => members, solid: () => false, floor: () => 0, bounds: [-30, -30, 30, 30], hostiles: () => [H], lineOfSight: () => true, visibility: () => 60 });
  const m = members[0];
  const seen = new Set();
  for (let k = 0; k < 400 && H.health > 40; k++) {
    s.step(0.05);
    if (MELEE[m.anim]) seen.add(m.anim);
  }
  assert.ok(Math.hypot(m.p[0] - H.p[0], m.p[2] - H.p[2]) < 2.1, 'closed in'); // (a front kick lands up to 1.5 m off and pushes him 0.5 m back)
  assert.ok(seen.size >= 2, `several moves: ${[...seen]}`);
  assert.ok(H.health < 100, `hurt him (${H.health})`);
});
