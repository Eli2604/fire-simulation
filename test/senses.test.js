import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../src/sim/createSimulation.js';
import { perceive, senses, eyeOf, headOf, hears, emitSound, LOUDNESS, footstepDb, rangeFromDb, dbFromRange, ambientLight, lightAt, BEAM } from '../src/ai/perception.js';
import { peekOptions, choosePeek, startPeek, PEEK_T } from '../src/ai/peek.js';
import { lightSource, stepLight, canUseTorch, hasWeaponLight, TORCH_T } from '../src/ai/flashlight.js';
import { SquadAI } from '../src/ai/squad.js';
import { shoot } from '../src/sim/wounds.js';

/** A small voxel range with walls (models `wall`): [x, z, length, height, rotation°]. */
function walls(list, size = [24, 4, 24]) {
  return createSimulation({
    world: { size, h: 0.1, ground: 'stone' },
    objects: list.map(([x, z, length, height, rotation = 0]) => ({ type: 'wall', params: { length, height, thickness: 0.3 }, x, z, rotation })),
    noFire: true,
  });
}
/** Watch a target for `secs` (s) in steps of dt: the first time he is seen (s), or null. */
function watch(obs, target, secs, ctx, dt = 0.1) {
  for (let t = 0; t < secs; t += dt) {
    const now = (ctx.now0 ?? 0) + t;
    if (obs.peek) obs.peek.now = now;
    const r = perceive(obs, target, dt, { ...ctx, now });
    if (r.seen) return t;
  }
  return null;
}

test('a peek over a low wall reveals the enemy hidden while crouched behind it', () => {
  // a 1.2 m wall across the range at z = 10; he crouches 0.6 m behind it, the enemy is 8 m beyond, crouched in the open
  const sim = walls([[12, 10, 10, 1.2]]);
  const ai = sim.ai;
  const los = (a, b) => ai.sightLine(a, b);
  const m = { p: [12, 0, 9.25], yaw: 0, anim: 'crouchAim', squad: 'R1', skill: 'regular' };
  const enemy = { p: [12.5, 0, 18], anim: 'crouchAim', squad: 'X', id: 'e1' };
  const ctx = { los, prof: senses(m, 'soldier'), range: 60, light: 1 };
  assert.equal(watch(m, enemy, 4, ctx), null, 'crouched behind the wall he does not see him');
  // he looks for a place to peek from: over the wall
  const opts = peekOptions((x, y, z) => ai.solidAt(x, y, z), m.p, enemy.p);
  assert.ok(opts.over, 'a low wall in front: a peek over it');
  assert.ok(opts.over.rise > 1.3 && opts.over.rise < 1.65, `his eye rises just over the top (${opts.over.rise.toFixed(2)} m)`);
  const c = choosePeek(m, opts, () => 0.1);
  assert.equal(c.clip, 'peekWall');
  startPeek(m, c, 4, () => 0.5);
  const t = watch(m, enemy, c.dur, { ...ctx, now0: 4 });
  assert.ok(t !== null && t < c.dur, `the peek finds him (${t?.toFixed(2)} s into it)`);
  // and his head shows over the wall while he is up: the enemy can see it
  const up = headOf(m, 4 + c.dur / 2);
  assert.ok(up[1] > 1.3, 'his head is up over the wall');
  assert.ok(ai.sightLine(eyeOf(enemy), up), 'the enemy sees his head during the peek');
  assert.ok(!ai.sightLine(eyeOf(enemy), headOf({ ...m, peek: null })), 'and not once he is down again');
});

test('a lean round the corner sees down the corridor', () => {
  // a tall wall in front of him, its end just to his right; the corridor goes on past the end
  const sim = walls([[9, 3, 12, 3]]); // x 3..15 at z = 3
  const ai = sim.ai;
  const los = (a, b) => ai.sightLine(a, b);
  const m = { p: [3.25, 0, 2.2], yaw: 0, anim: 'aim', squad: 'R1', skill: 'veteran' }; // facing +z; his right is -x
  const enemy = { p: [1.6, 0, 14], anim: 'aim', id: 'e2' };
  const ctx = { los, prof: senses(m, 'soldier'), range: 60, light: 1 };
  assert.equal(watch(m, enemy, 3, ctx), null, 'behind the corner he does not see down the corridor');
  const opts = peekOptions((x, y, z) => ai.solidAt(x, y, z), m.p, [m.p[0], 0, 12]);
  assert.ok(opts.right && !opts.left, 'open round the right edge only');
  const c = choosePeek(m, opts, () => 0.01);
  assert.ok(c.kind === 'right' || c.kind === 'sliceRight', `he leans (or slices) out to the right (${c.clip})`);
  startPeek(m, c, 3, () => 0.5);
  const t = watch(m, enemy, c.dur, { ...ctx, now0: 3 });
  assert.ok(t !== null, 'leaning out he sees the man down the corridor');
  // the experienced show themselves for less time
  assert.ok(PEEK_T.elite.dur < PEEK_T.regular.dur && PEEK_T.regular.dur < PEEK_T.recruit.dur);
});

test('the squad peeks when it has lost sight of the enemy behind a low wall', () => {
  // a mock range: a 1.2 m wall across at z = 0 (x -5..5); the team behind it at z = -0.6
  const wallAt = (x, y, z) => Math.abs(z) < 0.15 && Math.abs(x) < 5 && y >= 0 && y < 1.2;
  const sightLine = (a, b) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    for (let s = 0.05; s < L - 0.05; s += 0.05) {
      const t = s / L;
      if (wallAt(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)) return false;
    }
    return true;
  };
  const ms = [['CMD', -1], ['R1', 1]].map(([r, x]) => ({ p: [x, 0, -0.6], yaw: 0, squad: r, unit: 'Alpha', skill: 'regular' }));
  const hostile = { p: [0.5, 0, 9], id: 'h', anim: 'crouchAim', squad: 'X' };
  const sq = new SquadAI({ unit: 'Alpha', members: () => ms, solid: wallAt, floor: () => 0, bounds: [-12, -12, 12, 12], threat: [0, 0, 9], hostiles: () => [hostile], sightLine, radio: () => {} });
  sq.phase = 'hold';
  for (const m of ms) {
    m.arrived = true;
    m.anim = 'crouchAim';
  }
  sq.step(0.05);
  sq.lastSeen = sq.time - 5; // seen five seconds ago, lost since
  let peeked = null, found = false;
  const t0 = sq.time;
  for (let i = 0; i < 160 && !found; i++) {
    sq.step(0.05);
    for (const m of ms) if (m.peek) peeked = m.peek.clip;
    found = sq.lastSeen > t0;
  }
  assert.equal(peeked, 'peekWall', 'a man in cover peeks over the wall');
  assert.ok(found, 'and the peek finds the enemy again');
});

test('the torch only with a hand free; with a two-handed weapon and no light on it, none', () => {
  assert.equal(lightSource({ primary: 'rifle', weaponLight: false }).src, null, 'a rifle without a light: no hand for the torch');
  assert.match(lightSource({ primary: 'rifle', weaponLight: false }).why, /switch/);
  assert.equal(lightSource({ primary: 'mg' }).src, null, 'the machine gun: no light, both hands');
  assert.equal(lightSource({ primary: 'pistol' }).src, 'hand', 'a pistol one-handed, the torch in the other');
  assert.equal(lightSource({ weapon: 'knife' }).src, 'hand', 'the knife');
  assert.equal(lightSource({ loadout: 'unarmed' }).src, 'hand', 'bare hands');
  assert.equal(lightSource({ weapon: 'knife', flashlight: false }).src, null, 'no torch on his belt');
  assert.ok(canUseTorch({ primary: 'pistol' }) && !canUseTorch({ primary: 'shotgun' }));
  // drawn from the belt first, then it shines
  const m = { p: [0, 0, 0], yaw: 0, primary: 'pistol', squad: 'R1' };
  assert.equal(stepLight(m, true, 0.1), 'drawTorch');
  assert.ok(!m.lightOn, 'not yet: the hand is at the belt');
  for (let t = 0; t < TORCH_T.draw; t += 0.1) stepLight(m, true, 0.1);
  assert.ok(m.torchOut && m.lightOn && m.lightSrc === 'hand' && m.beam, 'the torch out and on');
  // he takes the rifle (no light on it): the torch goes back on the belt, no light
  Object.assign(m, { primary: 'rifle', weaponLight: false });
  assert.equal(stepLight(m, true, 0.1), 'stowTorch');
  for (let t = 0; t < 1; t += 0.1) stepLight(m, true, 0.1);
  assert.ok(!m.torchOut && !m.lightOn, 'both hands on the rifle: no torch');
});

test('a weapon light works with a rifle, along the muzzle, and lights up what he looks at in the dark', () => {
  assert.ok(hasWeaponLight({ primary: 'rifle' }), 'the rifle has one by default');
  assert.ok(!hasWeaponLight({ primary: 'pistol' }) && hasWeaponLight({ primary: 'pistol', weaponLight: true }), 'the pistol only when fitted');
  const m = { p: [0, 0, 0], yaw: 0, primary: 'rifle', squad: 'R1', aimAt: [0, 0, 30] };
  assert.equal(stepLight(m, true, 0.05), null, 'no torch to draw');
  assert.ok(m.lightOn && m.lightSrc === 'weapon', 'on at once');
  assert.ok(m.beam.dir[2] > 0.95, 'along where he aims');
  // night (a world light level of 0.005, his eyes not adapted): a man 25 m ahead
  const w = { light: { level: 0.005 } };
  const target = { p: [0, 0, 25], id: 't', anim: 'aim' };
  const prof = { ...senses(m, 'soldier'), nightSight: 0 };
  const dark = { p: [0, 0, 0], yaw: 0, squad: 'R1' };
  assert.equal(watch(dark, target, 4, { world: w, prof, los: () => true }), null, 'in the dark, without a light, unseen');
  const lit = { ...m, aware: null };
  assert.ok(watch(lit, target, 4, { world: w, prof, los: () => true, beams: [m.beam] }) !== null, 'in his beam, seen');
  assert.ok(lightAt([m.beam], [0, 1.6, 20]) > 0 && lightAt([m.beam], [10, 1.6, 5]) === 0, 'the beam lights only its cone');
  // a carrier with his light on shows from far off in the dark
  const carrier = { p: [0, 0, 120], id: 'c', lightOn: true, beam: { from: [0, 1.5, 120], dir: [0, 0, -1], range: 40, cone: 0.3 } };
  assert.ok(watch({ p: [0, 0, 0], yaw: 0, squad: 'R1' }, carrier, 6, { world: w, prof, los: () => true }) !== null, 'his light gives him away');
  assert.equal(ambientLight({ dark: true }).level < 0.15, true, 'the world\'s dark flag is the fallback');
});

test('sight range and field of view change what is picked up, and how soon', () => {
  const target = { p: [0, 0, 100], id: 't', anim: 'aim' };
  const near = { p: [0, 0, 0], yaw: 0, squad: 'R1', sightRange: 50 };
  const far = { p: [0, 0, 0], yaw: 0, squad: 'R1', sightRange: 150 };
  const ctx = { los: () => true, light: 1 };
  assert.equal(watch(near, target, 10, { ...ctx, prof: senses(near, 'soldier') }), null, '50 m sight: not at 100 m');
  assert.ok(watch(far, target, 10, { ...ctx, prof: senses(far, 'soldier') }) !== null, '150 m sight: seen');
  // experience: an elite man sees further and notices sooner than a recruit
  assert.ok(senses({ skill: 'elite' }).sightRange > senses({ skill: 'recruit' }).sightRange);
  const close = { p: [0, 0, 60], id: 'c' };
  const tE = watch({ p: [0, 0, 0], yaw: 0, skill: 'elite' }, close, 10, { ...ctx, prof: senses({ skill: 'elite', sightRange: 150 }) });
  const tR = watch({ p: [0, 0, 0], yaw: 0, skill: 'recruit' }, close, 10, { ...ctx, prof: senses({ skill: 'recruit', sightRange: 150 }) });
  assert.ok(tE < tR, `the elite first (${tE.toFixed(1)} s against ${tR.toFixed(1)} s)`);
  // field of view: behind him, out of a 120° view; all round (360°) it is seen
  const behind = { p: [0, 0, -20], id: 'b' };
  const narrow = { p: [0, 0, 0], yaw: 0, fov: 120 };
  assert.equal(watch(narrow, behind, 5, { ...ctx, prof: senses(narrow, 'soldier') }), null, 'behind him: unseen');
  assert.ok(watch({ p: [0, 0, 0], yaw: 0 }, behind, 5, { ...ctx, prof: senses({}, 'soldier') }) !== null, 'all round: seen');
  // at the edge of the view it takes longer than straight ahead
  const side = { p: [17, 0, 10], id: 's' }, ahead = { p: [0, 0, 20], id: 'a' };
  const tSide = watch({ p: [0, 0, 0], yaw: 0, fov: 130 }, side, 10, { ...ctx, prof: senses({ fov: 130, sightRange: 60 }, 'soldier') });
  const tAhead = watch({ p: [0, 0, 0], yaw: 0, fov: 130 }, ahead, 10, { ...ctx, prof: senses({ fov: 130, sightRange: 60 }, 'soldier') });
  assert.ok(tSide > tAhead, 'peripheral vision is slower');
});

test('a gunshot is heard 200 m off, footsteps there are not; walls muffle; the place heard is uncertain', () => {
  const w = { time: 0, noises: [] };
  const shot = emitSound(w, { pos: [200, 1.5, 0], loudness_dB: LOUDNESS.rifle, kind: 'gunshot' });
  const step = emitSound(w, { pos: [200, 0, 0], loudness_dB: footstepDb(1.4, 'stone'), kind: 'footstep' });
  const near = emitSound(w, { pos: [5, 0, 0], loudness_dB: footstepDb(1.4, 'stone'), kind: 'footstep' });
  const man = { p: [0, 0, 0], squad: 'R1' };
  const h = hears(man, shot, { rand: () => 0.5 });
  assert.ok(h, 'the shot is heard');
  assert.ok(Math.hypot(h.p[0] - 200, h.p[2]) > 1 && h.err < 40, `where it was only roughly (±${h.err.toFixed(1)} m)`);
  assert.equal(hears(man, step), null, 'footsteps 200 m off: not');
  assert.ok(hears(man, near), 'footsteps 5 m off: heard');
  assert.ok(footstepDb(3.5, 'stone') > footstepDb(1.2, 'grass'), 'running on stone is louder than walking on grass');
  assert.ok(rangeFromDb(LOUDNESS.rifle) > 1000, 'a rifle carries kilometres');
  assert.ok(Math.abs(rangeFromDb(dbFromRange(30)) - 30) < 0.5, 'the older ranges (m) are the same thing in dB');
  // a wall between: muffled (a 2.5 m wall at x = 3)
  const solid = (x, y) => x > 2.9 && x < 3.2 && y < 2.5;
  assert.equal(hears(man, near, { solid }), null, 'through the wall: not');
  // the hearing factor (a keen ear)
  const far = emitSound(w, { pos: [25, 0, 0], loudness_dB: footstepDb(1.4, 'stone'), kind: 'footstep' });
  assert.equal(hears(man, far), null);
  assert.ok(hears({ ...man, hearing: 2 }, far), 'a keen ear hears it');
  // the simulation's gunshots go through it: heard 200 m off
  const sim = walls([], [260, 4, 20]);
  const before = sim.world.noises.length;
  shoot(sim, [250, 1.5, 10], [-1, 0, 0], { weapon: 'rifle' });
  const n = sim.world.noises.slice(before).find((x) => x.kind === 'gunshot');
  assert.ok(n && n.dB >= 150, 'the shot is a sound of its loudness');
  assert.ok(hears({ p: [40, 0, 10], squad: 'R1' }, n), 'heard 210 m away');
});

test('a dragon with keener sight picks you up sooner', () => {
  const field = (sightRange) =>
    createSimulation({
      world: { size: [44, 8, 30], h: 0.4, ground: 'soil' },
      objects: [{ type: 'dragon', params: sightRange ? { sightRange } : {}, x: 8, z: 15, rotation: 90 }],
      noFire: true,
    });
  // perception: walking towards it from 120 m, the keener eye sees you first
  const prof = senses({}, 'dragon'), keen = senses({ sightRange: 90 }, 'dragon');
  const when = (P) => {
    const d = { p: [0, 2, 0], yaw: 0 };
    for (let t = 0; t < 40; t += 0.3) {
      const T = { key: 'player', head: [0, 1.7, 120 - 3 * t], p: [0, 0, 120 - 3 * t], moving: true };
      if (perceive(d, T, 0.3, { now: t, prof: P, los: () => true, eye: [0, 3, 0] }).seen) return t;
    }
    return Infinity;
  };
  assert.ok(when(keen) < when(prof), `the keener eye first (${when(keen).toFixed(1)} s against ${when(prof).toFixed(1)} s)`);
  // in the simulation: dozing in its lair, you 20 m off: the ordinary one does not notice, the keen one does
  const a = field(), b = field(100);
  for (const sim of [a, b]) {
    sim.world.dragons[0].timer = 999;
    for (let t = 0; t < 3; t += 0.05) {
      sim.ai.player = { p: [28, 0.4, 15], head: [28, 2.1, 15] };
      sim.step(0.05);
    }
  }
  assert.ok(!a.world.dragons[0].target, 'sight 45 m (13 m dozing): you are not noticed at 20 m');
  assert.ok(b.world.dragons[0].target?.kind === 'player', 'sight 100 m (29 m dozing): it has you');
});

test('the rig has the peek and torch clips; with a pistol he leans round a corner one-handed', async () => {
  const R = await import('../src/operator/rig.js');
  const { PEEK_ACTS } = await import('../src/rig/objects.js');
  for (const k of ['peekWall', 'leanLeft', 'leanRight', 'sliceLeft', 'sliceRight', 'drawTorch', 'stowTorch']) {
    assert.ok(R.LABELS[k] && R.ONCE[k] && PEEK_ACTS[k], `${k}: a clip, a once-only act, in the rig's Peek group`);
  }
  const rifle = R.weaponPose('rifle', 'leanLeft', 1.0), pistol = R.weaponPose('pistol', 'leanLeft', 1.0);
  assert.ok(rifle.lG > 0.9 && rifle.aim > 0.9, 'the rifle: both hands on it, aimed');
  assert.ok(pistol.lG === 0 && pistol.aim > 0.9, 'the pistol: aimed one-handed, the left hand off it (on the wall)');
  // the eye over the wall in the clip rises as perception says (about 1.4 m)
  const up = R.solve(R.weaponPose('rifle', 'peekWall', 1.3)), down = R.solve(R.weaponPose('rifle', 'peekWall', 0));
  assert.ok(up.hipsPos.y - down.hipsPos.y > 0.25, 'he rises out of the crouch');
});

test('the figure holds the torch in its left hand where he looks, and the weapon light shines along the muzzle', async () => {
  const THREE = await import('three');
  const R = await import('../src/operator/rig.js');
  const clips = R.operatorClips();
  const geo = () => new THREE.BoxGeometry(0.05, 0.05, 0.05);
  const mat = new THREE.MeshStandardMaterial();
  const sl = R.solve(Object.assign(R.pose0(), { sling: 1 })), sl2 = R.solve(Object.assign(R.pose0(), { sling2: 1 }));
  const grp = () => new THREE.Group().add(new THREE.Mesh(geo(), mat));
  const A = Object.assign({
    person: [geo()], carrier: geo(), sling: geo(), rifle: geo(), mag: geo(), helmet: geo(), pack: geo(), secondary: geo(), antenna: geo(), mic: geo(), foam: geo(),
    cords: [], black: mat, grenade: geo(), grenadeFuse: geo(), grenadeMat: mat, flashTex: null, drone: new THREE.Group(), goggles: new THREE.Group(), ctrl: new THREE.Group(),
    torchGun: grp(), torchTanks: grp(), nozzle: new THREE.Vector3(),
    slungPos: sl.weaponPos, slungQ: sl.weapon, slung2Pos: sl2.weaponPos, slung2Q: sl2.weapon, clips,
  }, R.weaponKit());
  const scene = new THREE.Scene();
  const f = new R.OperatorFigure(A, { loadout: 'rifle' });
  scene.add(f.group);
  // the rifle's light: along the barrel
  f.play('aim');
  f.setGear({ light: true });
  for (let i = 0; i < 5; i++) f.update(0.1);
  f.update(0.1);
  const w = f.lightSource();
  assert.equal(w?.kind, 'weapon');
  assert.ok(w.dir.z > 0.8, `forward, along the muzzle (${w.dir.toArray().map((v) => v.toFixed(2))})`);
  // the pistol, the torch drawn from the belt: in the left hand, in front, shining where he looks
  f.setGear({ light: false });
  f.setPrimary('pistol');
  f.play('aim', { fade: 0 });
  f.drawTorch(true);
  f.setTorch(true, true, 'harries');
  for (let i = 0; i < 12; i++) f.update(0.1);
  f.play('aim', { fade: 0 });
  f.update(0.1);
  const t = f.lightSource();
  assert.equal(t?.kind, 'hand', 'the torch shines');
  const hand = f.bones.handL.getWorldPosition(new THREE.Vector3()), gun = f.bones.handR.getWorldPosition(new THREE.Vector3());
  assert.ok(hand.z > 0.2 && hand.y > 1.0, `the left hand out in front (${hand.toArray().map((v) => v.toFixed(2))})`);
  assert.ok(hand.distanceTo(gun) < 0.25, 'Harries: under the pistol hand');
  assert.ok(t.dir.z > 0.8, 'the beam ahead');
  assert.ok(!f.torchBelt.visible && f.torchMesh.visible, 'out of the pouch, in the hand');
  f.drawTorch(false);
  for (let i = 0; i < 10; i++) f.update(0.1);
  assert.ok(f.torchBelt.visible && !f.torchMesh.visible && !f.lightSource(), 'back on the belt, off');
});
