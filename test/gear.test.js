import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { operatorClips, OperatorFigure, PhysicsWorld, solve, pose0, weaponKit, LABELS, ONCE, DROP_T, PICK_T } from '../src/operator/rig.js';
import { HANDLING, carried, allows } from '../src/ai/weapons.js';
import { SKILL, SKILL_INFO } from '../src/ai/soldier.js';
import { worthRolling, ROLLS } from '../src/ai/evade.js';
import { IMPACTS, MELEE, meleeDamage } from '../src/ai/melee.js';
import enemyModel from '../src/models/enemy.js';
import squadModel from '../src/models/squad.js';

const clips = operatorClips();
function assets() {
  const geo = () => new THREE.BoxGeometry(0.05, 0.05, 0.05);
  const mat = new THREE.MeshStandardMaterial();
  const sl = solve(Object.assign(pose0(), { sling: 1 })), sl2 = solve(Object.assign(pose0(), { sling2: 1 }));
  const tanks = new THREE.Group();
  tanks.add(new THREE.Mesh(geo(), mat));
  const torch = new THREE.Group();
  torch.add(new THREE.Mesh(geo(), mat));
  return Object.assign({
    person: [geo()], carrier: geo(), sling: geo(), rifle: geo(), mag: geo(), helmet: geo(), pack: geo(), secondary: geo(), antenna: geo(), mic: geo(), foam: geo(),
    cords: [], black: mat, grenade: geo(), grenadeFuse: geo(), grenadeMat: mat, flashTex: null, drone: new THREE.Group(), goggles: new THREE.Group(), ctrl: new THREE.Group(),
    torchGun: torch, torchTanks: tanks, nozzle: new THREE.Vector3(),
    slungPos: sl.weaponPos, slungQ: sl.weapon, slung2Pos: sl2.weaponPos, slung2Q: sl2.weapon, clips,
  }, weaponKit());
}
const A = assets();
function figure(loadout) {
  const scene = new THREE.Scene();
  const f = new OperatorFigure(A, { loadout });
  scene.add(f.group);
  return { f, scene, physics: new PhysicsWorld() };
}
const run = (f, s) => {
  for (let t = 0; t < s; t += 1 / 30) f.update(1 / 30);
};

test('drop weapon: whatever is in his hands falls, he is bare-handed after', () => {
  for (const [loadout, sw, part] of [['rifle', null, 'rifle'], ['shotgun', null, 'rifle'], ['pistol', null, 'rifle'], ['torch', null, 'torch'], ['rifle', 'knife', 'knife'], ['rifle', 'secondary', 'secondary']]) {
    const { f, scene, physics } = figure(loadout);
    if (sw) run(f, f.switchWeapon(sw) + 0.2);
    assert.ok(f.dropWeapon(physics, scene), `${loadout}/${sw}: drops`);
    assert.equal(f.shown, 'dropWeapon');
    run(f, DROP_T + 0.1);
    assert.ok(f.parts[part].userData.pivot, `${loadout}/${sw}: the ${part} on the ground`);
    assert.equal(f.weapon, 'fists');
    assert.equal(f.handling, 'unarmed');
    run(f, 1);
    assert.equal(f.current.getClip().name, 'guard', 'fists up');
    assert.ok(!f.dropWeapon(physics, scene), 'nothing left to drop');
    // and picked up again: bent down (one hand for a pistol or the knife), his at the grab
    const clip = f.pickUp([part]);
    assert.equal(clip, part === 'knife' || loadout === 'pistol' ? 'pickupOne' : 'pickup');
    run(f, PICK_T[clip] + 0.1);
    assert.ok(!f.parts[part].userData.pivot, `${part} back`);
  }
  // in a roll
  const { f, scene, physics } = figure('rifle');
  f.dropWeapon(physics, scene);
  run(f, 1);
  assert.equal(f.pickUp(['rifle'], { roll: true }), 'rollPickup');
  run(f, PICK_T.rollPickup + 0.1);
  assert.equal(f.parts.rifle.parent, f.bones.weapon);
  assert.equal(f.weapon, 'primary');
  assert.ok(ROLLS.rollPickup && LABELS.dropWeapon && LABELS.dropPack && ONCE.pickupOne);
});

test('switching: each weapon put away to its place on him (the pistol to the hip, the flame gun\'s wand to its clip) and drawn from it', () => {
  const { f } = figure('pistol');
  run(f, f.switchWeapon('knife') + 0.2);
  assert.equal(f.weapon, 'knife');
  assert.equal(f.parts.rifle.parent, f.bones.hips, 'the pistol in its holster on the hip');
  run(f, f.switchWeapon('rifle') + 0.2);
  assert.equal(f.parts.rifle.parent, f.bones.weapon, 'drawn');
  assert.equal(f.handling, 'pistol');
  // the flame trooper: the carbine from his back, the wand on its clip, and back
  const t = figure('torch').f;
  run(t, t.switchWeapon('secondary') + 0.2);
  assert.equal(t.weapon, 'secondary');
  assert.equal(t.parts.torch.parent, t.bones.hips, 'the wand clipped at his side');
  assert.ok(allows(t.handling, 'rollLeft') && !t.allows('rollLeft'), 'the carbine allows a roll, the tanks on his back do not');
  run(t, t.switchWeapon('rifle') + 0.2);
  assert.equal(t.weapon, 'torch');
  assert.equal(t.parts.torch.parent, t.bones.weapon);
  // fists from any of them
  run(t, t.switchWeapon('fists') + 0.2);
  assert.equal(t.handling, 'unarmed');
  // where each rides, and what he carries
  for (const k of ['rifle', 'shotgun', 'pistol', 'mg', 'torch', 'carbine', 'knife']) assert.ok(HANDLING[k].slot, k);
  assert.deepEqual(carried({ loadout: 'pistol' }), ['pistol', 'carbine', 'knife', 'unarmed']);
  assert.deepEqual(carried({ loadout: 'unarmed' }), ['unarmed']);
  assert.deepEqual(carried({ squad: 'MG', noKnife: true }), ['mg', 'carbine', 'unarmed']);
});

test('pack off: unstrapped, lowered in front of him, left on the ground; the flame gun\'s tanks with it; and back on', () => {
  const { f, scene } = figure('rifle');
  assert.ok(f.dropPack());
  assert.equal(f.parts.pack.parent, f.bones.bag);
  run(f, clips.dropPack.duration + 0.2);
  assert.equal(f.parts.pack.parent, scene, 'on the ground');
  assert.ok(f.parts.pack.userData.onGround);
  const p = new THREE.Vector3();
  f.parts.pack.getWorldPosition(p);
  // (the pack's origin is the chest's: lowered, the pack sits a metre and more below where it rode)
  assert.ok(p.y < 0.6, `lowered (${p.y.toFixed(2)})`);
  assert.equal(f.pickUp(['pack']), 'pickup');
  run(f, PICK_T.pickup + 0.1);
  assert.equal(f.parts.pack.parent, f.bones.chest, 'on his back again');
  const t = figure('torch');
  assert.ok(t.f.dropPack());
  assert.equal(t.f.parts.tanks.parent, t.f.bones.bag);
  assert.equal(t.f.parts.torch.parent, t.f.parts.tanks, 'the wand with its tanks');
  assert.equal(t.f.handling, 'unarmed');
  run(t.f, clips.dropPack.duration + 0.2);
  assert.equal(t.f.parts.tanks.parent, t.scene);
  assert.ok(t.f.allows('rollLeft'), 'the tanks off: he can roll');
  t.f.reequip(['pack']);
  assert.equal(t.f.parts.torch.parent, t.f.bones.weapon);
  assert.equal(t.f.weapon, 'torch');
});

test('experience: one setting for aim, recoil control, reaction, speed, nerve and hand-to-hand; in the models', () => {
  const order = ['recruit', 'regular', 'veteran', 'elite'];
  for (const k of ['aim', 'reload', 'react', 'control', 'nerve']) for (let i = 1; i < 4; i++) assert.ok(SKILL[order[i]][k] < SKILL[order[i - 1]][k], `${k} better with experience`);
  for (const k of ['melee', 'judgement']) for (let i = 1; i < 4; i++) assert.ok(SKILL[order[i]][k] > SKILL[order[i - 1]][k], k);
  assert.match(SKILL_INFO, /recoil control/);
  // nerve: a recruit flinches into a roll under fire more often than an elite man
  const rolls = (skill) => {
    let n = 0, r = 1;
    const rand = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < 400; i++) if (worthRolling({ skill, p: [0, 0, 0] }, { kind: 'fire', time: i }, rand, 0)) n++;
    return n;
  };
  assert.ok(rolls('recruit') > rolls('elite') * 1.6, `${rolls('recruit')} vs ${rolls('elite')}`);
  const g = enemyModel.build({ ...Object.fromEntries(Object.entries(enemyModel.params).map(([k, v]) => [k, v.value])), skill: 'elite', weapon: 'unarmed' }, { rng: Math.random });
  assert.ok(g.enemies.every((e) => e.skill === 'elite' && e.loadout === 'unarmed'));
  assert.ok(squadModel.params.skill.label.includes('recoil control'));
});

test('impacts: contacts declared as plain data for the impact model; one damage function', () => {
  for (const [k, list] of Object.entries(IMPACTS)) {
    assert.ok(clips[k], k);
    for (const c of list) {
      assert.ok(c.t > 0 && c.t <= clips[k].duration, `${k}: in the clip`);
      assert.ok(c.part && c.material && ['opponent', 'ground'].includes(c.target), k);
    }
  }
  assert.equal(MELEE.jab.impacts, IMPACTS.jab);
  assert.equal(meleeDamage('cross'), MELEE.cross.dmg);
  assert.equal(meleeDamage('cross', { blocked: true }), MELEE.cross.dmg / 4);
});
