import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { P, operatorClips, OperatorFigure, weaponKit, solve, pose0, SWITCH_TIME, STAB_HIT, RELOAD_TIME, THROW_FLASH_RELEASE, ONCE, LABELS } from '../src/operator/rig.js';

const clips = operatorClips();

/** Stand-in assets: boxes for the sculpted meshes (no workers, no document), the real clips and weapon kit. */
function stubAssets() {
  const geo = () => new THREE.BoxGeometry(0.05, 0.05, 0.05);
  const mat = new THREE.MeshStandardMaterial();
  const sl = solve(Object.assign(pose0(), { sling: 1 })), sl2 = solve(Object.assign(pose0(), { sling2: 1 }));
  return Object.assign({
    person: [geo()], carrier: geo(), sling: geo(), rifle: geo(), mag: geo(), helmet: geo(), pack: geo(), secondary: geo(), antenna: geo(), mic: geo(), foam: geo(),
    cords: [], black: mat, grenade: geo(), grenadeFuse: geo(), grenadeMat: mat, flashTex: null,
    drone: new THREE.Group(), goggles: new THREE.Group(), ctrl: new THREE.Group(),
    slungPos: sl.weaponPos, slungQ: sl.weapon, slung2Pos: sl2.weaponPos, slung2Q: sl2.weapon, clips,
  }, weaponKit());
}
const run = (f, s) => {
  for (let t = 0; t < s; t += 1 / 30) f.update(1 / 30);
};

test('every clip (armed, unarmed, knife) bakes to finite tracks; the new ones are labelled', () => {
  for (const [k, c] of Object.entries(clips)) for (const tr of c.tracks) assert.ok(tr.values.every(Number.isFinite), `${k}: ${tr.name}`);
  for (const k of ['holsterRifle', 'drawRifle', 'drawKnife', 'sheathKnife', 'knifeReady', 'stab', 'throwFlash', 'rappel', 'rappelStart', 'rappelEnd', 'peekOver', 'peekOverAim']) {
    assert.ok(clips[k] && LABELS[k], k);
  }
  for (const k of ['stab', 'throwFlash', 'drawKnife', 'sheathKnife', 'holsterRifle', 'drawRifle', 'rappelStart', 'rappelEnd']) assert.ok(ONCE[k], k);
  assert.ok(clips.walk_k && clips.idle_k && clips.crouch_k, 'knife versions of the ordinary clips');
  assert.equal(clips.reload.duration, RELOAD_TIME);
  assert.ok(STAB_HIT > 0 && STAB_HIT < clips.stab.duration && THROW_FLASH_RELEASE < clips.throwFlash.duration);
});

test('switching weapons: put away, draw, the parts move between the bones; times match SWITCH_TIME', () => {
  const f = new OperatorFigure(stubAssets());
  const { knife, rifle, secondary, mag } = f.parts;
  assert.equal(knife.parent, f.bones.thighR, 'the knife starts in its sheath');
  assert.equal(f.switchWeapon('knife'), SWITCH_TIME.knife);
  assert.equal(f.shown, 'holsterRifle');
  run(f, SWITCH_TIME.knife + 0.1);
  assert.equal(f.weapon, 'knife');
  assert.equal(knife.parent, f.bones.handR, 'knife in hand');
  assert.equal(f.current.getClip().name, 'idle_k', 'back to idle, knife version');
  f.play('aim');
  assert.equal(f.current.getClip().name, 'knifeReady', 'aiming with a knife is the fighting stance');
  f.play('stab', { restart: true, fade: 0.15 });
  run(f, clips.stab.duration + 0.1);
  assert.equal(f.shown, 'aim', 'a stab returns to the stance');

  assert.equal(f.switchWeapon('secondary'), SWITCH_TIME.secondary);
  run(f, SWITCH_TIME.secondary + 0.1);
  assert.equal(f.weapon, 'secondary');
  assert.equal(knife.parent, f.bones.thighR, 'knife sheathed');
  assert.equal(secondary.parent, f.bones.weapon, 'carbine in hand');
  assert.equal(rifle.parent, f.bones.chest, 'rifle on the back');
  assert.equal(mag.parent, rifle, 'its magazine with it');

  assert.equal(f.switchWeapon('rifle'), SWITCH_TIME.rifle);
  run(f, SWITCH_TIME.rifle + 0.1);
  assert.equal(f.weapon, 'primary');
  assert.equal(rifle.parent, f.bones.weapon);
  assert.equal(mag.parent, f.bones.mag);
  assert.equal(secondary.parent, f.bones.chest);
  assert.equal(f.current.getClip().name, 'aim');
  assert.equal(f.switchWeapon('rifle'), 0, 'already has it');
});

test('reload speed, armour, look and the flash-bang', () => {
  const f = new OperatorFigure(stubAssets());
  f.play('reload', { speed: 1.5 });
  assert.equal(f.current.getEffectiveTimeScale(), 1.5);
  f.setClipSpeed('reload', 0.7);
  f.play('reload', { restart: true });
  assert.equal(f.current.getEffectiveTimeScale(), 0.7);
  f.setArmour(false);
  assert.equal(f.parts.carrier.visible, false);
  f.setArmour(true);
  assert.equal(f.parts.carrier.visible, true);

  f.play('aim', { fade: 0 });
  run(f, 0.5);
  const muzzle = () => new THREE.Vector3(...P.R.x).applyQuaternion(f.bones.weapon.getWorldQuaternion(new THREE.Quaternion()));
  const m0 = muzzle();
  f.setLook(0.8);
  run(f, 1);
  const m1 = muzzle();
  assert.ok(m1.y > m0.y + 0.4, `the rifle comes up with the look (${m0.y.toFixed(2)} -> ${m1.y.toFixed(2)})`);

  let thrown = null;
  f.onFlashRelease = (p) => (thrown = p.clone());
  f.setLook(0);
  f.play('throwFlash', { restart: true, fade: 0.1 });
  run(f, THROW_FLASH_RELEASE + 0.1);
  assert.ok(thrown && thrown.y > 0.5, 'the flash-bang leaves the hand');
});
