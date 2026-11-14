import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HANDLING, PRIMARIES, allows, paceOf, gaitK, evadeKind, handKind, whyNot, moveTable } from '../src/ai/weapons.js';
import { pickRoll, ROLLS } from '../src/ai/evade.js';
import { ability, moveFor, durFor } from '../src/ai/parkour.js';
import { recoilSpec, pullTime, pumpTimes, GUNS } from '../src/ai/recoil.js';
import { kit, recoilOf, aimPoint, weaponKind, ARMS } from '../src/ai/soldier.js';
import { WEAPONS } from '../src/sim/wounds.js';
import { P, REST, solve, pose0, weaponPose, weaponClips, operatorClips, OperatorFigure, weaponKit, WEAPON_STYLE, PUMP_STROKE, SHOTGUN_RELOAD, PISTOL_RELOAD } from '../src/operator/rig.js';
import { driveFromAI } from '../src/operator/drive.js';

const V = (a) => new THREE.Vector3(...a);

test('the handling profiles: what each weapon allows', () => {
  for (const k of PRIMARIES) assert.ok(HANDLING[k]?.label && HANDLING[k].grip && HANDLING[k].carry && HANDLING[k].aim, k);
  // rifle, shotgun, pistol: every roll; the flame gun none of them, nor crawling or going prone
  for (const k of ['rifle', 'shotgun', 'pistol', 'carbine']) for (const a of ['rollLeft', 'rollRight', 'rollForward', 'diveProne', 'crawl', 'proneAim', 'climbJump', 'vaultSpeed']) assert.ok(allows(k, a), `${k} ${a}`);
  for (const a of ['rollLeft', 'rollRight', 'rollForward', 'diveProne', 'crawl', 'proneAim', 'proneShoot', 'climbJump', 'mantle', 'vaultSpeed', 'dropRoll', 'slideCover']) assert.ok(!allows('torch', a), `torch ${a}`);
  assert.ok(allows('torch', 'vaultSide') && allows('torch', 'vaultStep') && allows('torch', 'sidestepLeft'));
  // the machine gun: no roll, but a dive into cover; slow vaults, no jump climb
  assert.ok(!allows('mg', 'rollLeft') && !allows('mg', 'rollForward') && allows('mg', 'diveProne') && allows('mg', 'crawl'));
  assert.ok(paceOf('mg', 'vaultSide') > 1 && paceOf('mg', 'mantle') > 1 && !allows('mg', 'climbJump'));
  assert.ok(gaitK('mg', 'run') < 1 && gaitK('torch', 'run') < gaitK('mg', 'run') && gaitK('pistol', 'run') >= 1 && gaitK('rifle', 'run') === 1);
  assert.equal(gaitK('torch', 'crawl'), 0.5, 'a flame trooper down on both legs drags himself, slowly');
  // stand-ins for the rolls
  assert.equal(evadeKind('rifle', 'rollLeft'), 'rollLeft');
  assert.equal(evadeKind('torch', 'rollLeft'), 'sidestepLeft');
  assert.equal(evadeKind('torch', 'rollRight'), 'sidestepRight');
  assert.equal(evadeKind('torch', 'rollForward'), null);
  assert.equal(evadeKind('mg', 'rollForward'), 'diveProne');
  assert.equal(evadeKind('mg', 'rollLeft'), 'sidestepLeft');
  assert.match(whyNot('torch', 'rollLeft'), /tanks/);
  assert.equal(whyNot('rifle', 'rollLeft'), '');
  assert.equal(moveTable('torch').rollLeft, false);
  // whose weapon: the man's
  assert.equal(handKind({}), 'rifle');
  assert.equal(handKind({ squad: 'MG' }), 'mg');
  assert.equal(handKind({ loadout: 'torch', weapon: 'torch' }), 'torch');
  assert.equal(handKind({ primary: 'shotgun', weapon: 'rifle' }), 'shotgun');
  assert.equal(handKind({ primary: 'shotgun', weapon: 'secondary' }), 'carbine');
  assert.equal(handKind({ handling: 'handTorch', weapon: 'rifle' }), 'handTorch');
});

test('the AI respects them: a flame trooper side-steps instead of rolling, a gunner dives into cover', () => {
  const grenade = { kind: 'grenade', p: [0.6, 0.1, -0.9] }; // behind him on his right
  const rifleman = { p: [0, 0, 0], yaw: 0, squad: 'R1' };
  const k0 = pickRoll(rifleman, grenade).kind;
  assert.ok(ROLLS[k0] && !ROLLS[k0].step, `a rifleman rolls (${k0})`);
  const flamer = { p: [0, 0, 0], yaw: 0, squad: 'R2', loadout: 'torch', weapon: 'torch' };
  for (const t of [grenade, { kind: 'grenade', p: [0, 0.1, -1] }, { kind: 'fire', from: [0, 1.4, 20], p: [0, 1.4, 20], dir: [0, 0, -1] }, { kind: 'dragon', p: [5, 3, 5], v: [-6, -2, -6] }]) {
    const k = pickRoll(flamer, t)?.kind;
    assert.ok(k === 'sidestepLeft' || k === 'sidestepRight', `flame trooper from ${t.kind}: ${k}`);
  }
  const gunner = { p: [0, 0, 0], yaw: 0, squad: 'MG' };
  const ahead = pickRoll(gunner, { kind: 'grenade', p: [0, 0.1, -1.2] }); // behind him: away is forward
  assert.equal(ahead.kind, 'diveProne', 'the gunner dives flat away from it');
  const side = pickRoll(gunner, { kind: 'grenade', p: [1.5, 0.1, 0] });
  assert.ok(side.kind.startsWith('sidestep') || side.kind === 'diveProne', side.kind);
  // parkour: no jump climb with the MG or the tanks, the speed vault becomes a side vault, slower
  const ledge = { type: 'up', h: 1.8, standable: true, face: 0.5 };
  const wall = { type: 'up', h: 0.95, thin: true, over: true, land: 0, face: 0.6, thick: 0.3 };
  assert.equal(moveFor(ledge, ability({ squad: 'R1' }), 'run'), 'climbJump');
  assert.equal(moveFor(ledge, ability({ squad: 'MG' }), 'run'), null);
  assert.equal(moveFor(ledge, ability({ loadout: 'torch' }), 'run'), null);
  assert.equal(moveFor({ ...ledge, h: 1.2 }, ability({ loadout: 'torch' }), 'walk'), null, 'no mantle with the tanks');
  assert.equal(moveFor({ ...ledge, h: 1.2 }, ability({ squad: 'MG' }), 'walk'), 'mantle');
  assert.equal(moveFor(wall, ability({ squad: 'R1' }), 'run'), 'vaultSpeed');
  assert.equal(moveFor(wall, ability({ loadout: 'torch' }), 'run'), 'vaultSide');
  assert.ok(durFor('vaultSide', ability({ loadout: 'torch' })) > durFor('vaultSide', ability({ squad: 'R1' })) * 1.3);
  assert.equal(moveFor({ type: 'down', h: 2.6, room: true, face: 0.3 }, ability({ loadout: 'torch' }), 'run'), null, 'no deep drop');
  assert.equal(moveFor({ type: 'down', h: 1.4, room: true, face: 0.3 }, ability({ loadout: 'torch' }), 'run'), 'dropDown');
  assert.equal(moveFor({ type: 'down', h: 2.6, room: true, face: 0.3 }, ability({ primary: 'shotgun' }), 'run'), 'dropRoll');
});

test('the shotgun and the pistol: kit, recoil (the pump between rounds), damage', () => {
  const s = { squad: 'R1', loadout: 'shotgun' };
  kit(s);
  assert.equal(s.primary, 'shotgun');
  assert.equal(s.mag, ARMS.shotgun.size);
  assert.equal(weaponKind(s), 'shotgun');
  const R = recoilOf(s);
  assert.equal(R.kind, 'shotgun');
  assert.equal(R.rounds, 1);
  assert.ok(R.kick > recoilSpec('rifle').kick * 2, 'a 12 gauge kicks harder than a 5.56');
  assert.ok(pumpTimes(R) && pullTime(R) > R.recovery + R.pump);
  assert.equal(pumpTimes(recoilSpec('rifle')), null);
  assert.ok(WEAPONS.shotgun.dmg > WEAPONS.rifle.dmg && WEAPONS.shotgun.pen < WEAPONS.rifle.pen);
  const p = { squad: 'CMD', loadout: 'pistol' };
  kit(p);
  assert.equal(recoilOf(p).kind, 'pistol');
  assert.ok(GUNS.shotgun && GUNS.pistol);
  // buckshot opens: a wider spread than a rifle at 15 m
  const spread = (m) => {
    let sum = 0;
    let i = 0;
    const rand = () => ((i = (i * 9301 + 49297) % 233280) / 233280);
    for (let n = 0; n < 200; n++) {
      const q = aimPoint({ ...m, p: [0, 0, 0] }, [0, 0, 15], rand);
      sum += Math.abs(q[0]);
    }
    return sum / 200;
  };
  assert.ok(spread(s) > spread({ squad: 'R1', primary: 'rifle', skill: 'regular' }) * 1.5);
});

/** Where the muzzle points, and both hands' shortfall from their grips, for a pose. */
function check(kind, name, t = 0) {
  const o = solve(weaponPose(kind, name, t));
  const Q = o.hips.clone().multiply(o.spine).multiply(o.chest).multiply(o.weapon);
  const d = V(P.R.x).applyQuaternion(Q);
  return { yaw: Math.atan2(d.x, d.z), pitch: Math.asin(d.y), reach: o.reach, o };
}

test('each weapon is held its own way: the hands on its grips, aimed straight ahead', () => {
  for (const kind of ['rifle', 'shotgun', 'pistol', 'mg', 'torch']) {
    for (const name of ['aim', 'crouchAim', 'shoot', 'aimWalk']) {
      const c = check(kind, name);
      assert.ok(Math.abs(c.yaw) < 0.12, `${kind} ${name}: aimed ahead (yaw ${c.yaw.toFixed(2)})`);
      assert.ok(Math.abs(c.pitch) < 0.3, `${kind} ${name}: level (pitch ${c.pitch.toFixed(2)})`);
      assert.ok(c.reach.R < 0.015 && c.reach.L < 0.015, `${kind} ${name}: both hands on it (${c.reach.R.toFixed(3)}, ${c.reach.L.toFixed(3)})`);
    }
    for (const name of ['idle', 'walk', 'crouch']) {
      const c = check(kind, name);
      assert.ok(c.reach.R < 0.015 && c.reach.L < 0.015, `${kind} ${name}: hands on it`);
    }
  }
  // the grips differ: the pistol's hands close together, the shotgun's left hand on the pump
  const hands = (kind, name) => {
    const p = weaponPose(kind, name, 0);
    return [p.lGo, p.rGo];
  };
  assert.ok(hands('pistol', 'aim')[0][0] < -0.2, 'the pistol: the left hand back by the right on the grip');
  assert.ok(Math.abs(hands('shotgun', 'aim')[0][0]) < 0.05, 'the shotgun: the left hand on the pump');
  // the pistol is held out at arm's length, square to the target; the flame gun at the hip
  const gunAt = (kind) => {
    const { o } = check(kind, 'aim');
    return o.weaponPos.clone().applyQuaternion(o.hips.clone().multiply(o.spine).multiply(o.chest));
  };
  assert.ok(gunAt('pistol').z > gunAt('rifle').z + 0.15, 'the pistol out in front');
  assert.ok(gunAt('torch').y < gunAt('rifle').y - 0.12, 'the flame gun lower, from the hip');
  const sq = (kind) => Math.abs(weaponPose(kind, 'aim').chest[1] + weaponPose(kind, 'aim').spine[1]);
  assert.ok(sq('pistol') < sq('rifle') * 0.5, 'the pistol stance is square to the target, the rifle bladed');
  // the carry differs too: the pistol at the chest, muzzle down; the MG at the hip
  const carry = (kind) => check(kind, 'idle');
  assert.ok(carry('pistol').pitch < -0.8, 'compressed ready: muzzle down');
  assert.ok(carry('shotgun').pitch < carry('rifle').pitch - 0.03, 'the shotgun carried muzzle lower');
  // one hand on the pistol at a run, both on the rifle
  assert.equal(weaponPose('pistol', 'run', 0.1).lG, 0);
  assert.equal(weaponPose('pistol', 'aim', 0.1).lG, 1);
});

test('the shotgun pump cycle: the left hand runs the pump back and forward after each round', () => {
  const R = recoilSpec('shotgun');
  const [t0, t1] = pumpTimes(R);
  const lx = (t) => weaponPose('shotgun', 'shoot', t).lGo[0];
  const base = lx(0);
  const mid = lx((t0 + t1) / 2);
  assert.ok(base - mid > PUMP_STROKE * 0.9, `back by the stroke (${(base - mid).toFixed(3)})`);
  assert.ok(Math.abs(lx(t1 + 0.02) - base) < 1e-3, 'and home again');
  assert.ok(check('shotgun', 'shoot', (t0 + t1) / 2).reach.L < 0.015, 'the hand stays on it');
  // reloads: shells one at a time; the pistol's magazine
  const W = weaponClips('shotgun');
  assert.ok(Math.abs(W.reload.duration - SHOTGUN_RELOAD) < 1e-6);
  assert.ok(Math.abs(weaponClips('pistol').reload.duration - PISTOL_RELOAD) < 1e-6);
  let away = 0;
  for (let t = 0; t < SHOTGUN_RELOAD; t += 0.05) if (weaponPose('shotgun', 'reload', t).lG < 0.5) away++;
  assert.ok(away > 10, 'the hand goes back and forth to the shells');
  // baked once, shared
  assert.equal(weaponClips('shotgun'), W);
  assert.deepEqual(weaponClips('rifle'), {});
  for (const k of ['shotgun', 'pistol', 'mg', 'torch']) for (const [n, c] of Object.entries(weaponClips(k))) for (const tr of c.tracks) assert.ok(tr.values.every(Number.isFinite), `${k} ${n} ${tr.name}`);
  assert.ok(WEAPON_STYLE.pistol.oneHand.run && !WEAPON_STYLE.rifle);
});

/** Stand-in assets (as test/operatorweapons.test.js): boxes for the sculpted meshes, the real clips and weapon kit. */
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
const run = (f, s) => {
  for (let t = 0; t < s; t += 1 / 30) f.update(1 / 30);
};

test('the figure: its primary\'s mesh and clips, swapped as the weapon in his hands changes; what it allows', () => {
  const A = stubAssets();
  const f = new OperatorFigure(A, { loadout: 'shotgun' });
  assert.equal(f.primaryKind, 'shotgun');
  assert.equal(f.handling, 'shotgun');
  assert.ok(f.parts.rifle.getObjectByName('shotgun'), 'the shotgun on the weapon bone');
  assert.equal(f.parts.mag.visible, false, 'no rifle magazine');
  assert.equal(f.actions.aim.getClip(), weaponClips('shotgun').aim, 'its own aim');
  assert.equal(f.actions.reload.getClip().duration, SHOTGUN_RELOAD);
  f.play('shoot', { fade: 0 });
  run(f, 0.1);
  const R = recoilSpec('shotgun');
  // the pump follows the left hand back in the stroke
  const [t0, t1] = pumpTimes(R);
  f.current.time = (t0 + t1) / 2;
  f.update(0);
  assert.ok(f.pump.position.length() > PUMP_STROKE * 0.6, `the pump slides back (${f.pump.position.length().toFixed(3)})`);
  // the carbine drawn: the clips as the rifle's again
  f.switchWeapon('secondary');
  run(f, 2.2);
  assert.equal(f.handling, 'carbine');
  assert.equal(f.actions.aim.getClip(), A.clips.aim);
  f.switchWeapon('rifle');
  run(f, 2.2);
  assert.equal(f.handling, 'shotgun');
  assert.equal(f.actions.aim.getClip(), weaponClips('shotgun').aim);
  assert.ok(f.allows('rollLeft') && f.allows('crawl'));
  // another primary
  f.setPrimary('pistol');
  assert.ok(f.parts.rifle.getObjectByName('pistol') && !f.parts.rifle.getObjectByName('shotgun'));
  assert.equal(f.actions.aim.getClip(), weaponClips('pistol').aim);
  f.setPrimary('rifle');
  assert.equal(f.parts.mag.visible, true);
  assert.equal(f.actions.aim.getClip(), A.clips.aim);
  // a flame trooper: no roll, no crawl
  const t = new OperatorFigure(A, { loadout: 'torch' });
  assert.equal(t.handling, 'torch');
  assert.ok(!t.allows('rollLeft') && !t.allows('crawl') && !t.allows('diveProne') && t.allows('sidestepLeft') && t.allows('flame'));
  assert.equal(t.actions.flame.getClip(), weaponClips('torch').flame, 'the flame gun from the hip');
  // the AI's member drives it: his primary, his recoil
  const g = new OperatorFigure(A);
  const m = { squad: 'MG', p: [0, 0, 0] };
  kit(m);
  driveFromAI(g, Object.assign(m, { anim: 'crouchAim' }), {});
  assert.equal(g.primaryKind, 'mg');
  assert.ok(g.parts.rifle.getObjectByName('mgKit'));
  assert.equal(g.actions.crouchAim.getClip(), weaponClips('mg').crouchAim);
  assert.ok(!g.allows('rollLeft') && g.allows('diveProne'));
});
