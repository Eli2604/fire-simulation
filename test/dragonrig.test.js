import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../src/sim/createSimulation.js';
import { DRAGON_ZONES, dragonZones, dragonHitZone, dragonRayHit, dragonWoundPoint } from '../src/ai/dragon.js';
import { createDragonStage, DRAGON_ACTS } from '../src/rig/dragonStage.js';

/** A flat field with a dragon at (15, 15) facing +x, lying in its lair. */
function field() {
  const sim = createSimulation({
    world: { size: [44, 8, 30], h: 0.4, ground: 'soil' },
    objects: [{ type: 'dragon', params: {}, x: 15, z: 15, rotation: 90 }],
    noFire: true,
  });
  const d = sim.world.dragons[0];
  d.timer = 999; // (it stays in its lair)
  sim.step(0.05);
  return { sim, w: sim.world, d };
}
const mid = (Z) => Z.pts[Math.floor(Z.pts.length / 2)].p;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test('hit zones follow the pose: every zone is where its part of the body is, a miss is null', () => {
  const { w, d } = field();
  const zones = dragonZones(d, w);
  assert.deepEqual(zones.map((z) => z.k).sort(), Object.keys(DRAGON_ZONES).sort());
  // the head at the snout, the tail at its middle, the chest over the shoulders, a hind foot on the ground
  assert.equal(dragonHitZone(d, zones.find((z) => z.k === 'head').pts[2].p, w)?.k, 'head');
  assert.equal(dragonHitZone(d, mid(zones.find((z) => z.k === 'tail')), w)?.k, 'tail');
  assert.equal(dragonHitZone(d, [d.chest[0] - 0.3, d.chest[1] + 0.5, d.chest[2]], w)?.k, 'chest');
  const foot = zones.find((z) => z.k === 'hindL').pts.at(-1).p;
  assert.equal(dragonHitZone(d, foot, w)?.k, 'hindL');
  assert.ok(foot[1] < d.chest[1] - 0.2, 'the foot is down on the ground');
  // left is its left (facing +x, left is -z)
  assert.ok(foot[2] < d.chest[2], 'hindL on its left side');
  assert.equal(dragonHitZone(d, [d.chest[0], d.chest[1] + 4, d.chest[2]], w), null, 'well above it: no hit');
  // a ray down onto its back finds the chest; one beside it finds nothing
  assert.equal(dragonRayHit(d, [d.chest[0] - 0.3, 6, d.chest[2]], [0, -1, 0], 20, w)?.k, 'chest');
  assert.equal(dragonRayHit(d, [d.chest[0], 6, d.chest[2] + 9], [0, -1, 0], 20, w), null);
  // the zones scale (the rig page's sliders): a fatter head reaches further
  const p = [...d.head.p];
  p[1] += 0.45;
  const before = dragonHitZone(d, p, w)?.k;
  DRAGON_ZONES.head.r = 2;
  try {
    assert.equal(dragonHitZone(d, p, w)?.k, 'head');
  } finally {
    DRAGON_ZONES.head.r = 1;
  }
  assert.notEqual(before, 'head', 'not with the normal head');
});

test('in flight the wings are spread: a hit far out to the side is a wing', () => {
  const st = createDragonStage();
  st.play('fly');
  for (let i = 0; i < 150; i++) st.step(1 / 30);
  const d = st.dragon;
  assert.equal(d.mode, 'air');
  const zones = dragonZones(d, st.world);
  const wl = zones.find((z) => z.k === 'wingL');
  const tip = wl.pts.at(-1).p;
  assert.ok(dist(tip, d.chest) > 4, `the wing tip ${dist(tip, d.chest).toFixed(1)} m out`);
  assert.equal(dragonHitZone(d, tip, st.world)?.k, 'wingL');
});

test('an arrow does more in the head than in a wing, and the zone decides the bleeding', () => {
  const a = field();
  const b = field();
  const head = dragonZones(a.d, a.w).find((z) => z.k === 'head').pts[1].p;
  const wing = mid(dragonZones(b.d, b.w).find((z) => z.k === 'wingL'));
  assert.ok(a.sim.hitEnemy(head, 'arrow', { v: [0, -10, 30] }), 'the arrow hits the head');
  assert.ok(b.sim.hitEnemy(wing, 'arrow', { v: [0, -10, 30] }), 'the arrow hits the wing');
  const hurtHead = a.d.maxHealth - a.d.health;
  const hurtWing = b.d.maxHealth - b.d.health;
  assert.ok(hurtHead > hurtWing * 5, `head ${hurtHead} vs wing ${hurtWing}`);
  assert.equal(a.d.wounds.head, 1);
  assert.equal(b.d.wounds.wingL, 1);
  assert.ok(a.d.bleed > b.d.bleed * 4, `bleeding head ${a.d.bleed} vs wing ${b.d.bleed}`);
  assert.ok(a.w.events.some((e) => e.type === 'dragonWound' && e.zone === 'head'));
});

test('a real arrow in the simulation: it lands in a zone, the dragon bleeds, drips and stains', () => {
  const { sim, w, d } = field();
  // shot from the side, level, at the middle of its tail
  const chest = mid(dragonZones(d, w).find((z) => z.k === 'tail'));
  w.projectiles.push({ type: 'arrow', p: [chest[0], chest[1] + 0.05, chest[2] - 8], v: [0, 0.4, 45] });
  const h0 = d.health;
  let t = 0;
  while (!d.wounds && t < 2) {
    sim.step(0.02);
    t += 0.02;
  }
  assert.ok(d.wounds, 'the arrow hit it');
  const zone = Object.keys(d.wounds)[0];
  assert.equal(zone, 'tail', `hit in the ${zone}`);
  assert.ok(d.bleed > 0, 'the wound bleeds');
  assert.equal(d.stains.length, 1);
  // the stain sits on the body where it went in
  const at = dragonWoundPoint(d, d.stains[0], w);
  assert.ok(at && dist(at.p, chest) < 2.5, 'the stain is on its body');
  const decals0 = w.decals.length;
  assert.ok(decals0 > 0, 'blood sprayed on the ground');
  const hHit = d.health;
  for (let i = 0; i < 200; i++) sim.step(0.05);
  assert.ok(h0 - hHit > 0, 'the hit itself did damage');
  assert.ok(d.health < hHit - 2.5, `health drains while it bleeds (${hHit.toFixed(0)} → ${d.health.toFixed(0)}), and it does not heal meanwhile`);
  assert.ok(w.decals.length > decals0, `drops of blood land on the ground (${decals0} → ${w.decals.length})`);
});

test('it bleeds to death; a dead dragon soon stops bleeding', () => {
  const { sim, w, d } = field();
  d.health = 40;
  const neck = mid(dragonZones(d, w).find((z) => z.k === 'neck'));
  sim.hitEnemy(neck, 'arrow', { v: [0, -5, 30] });
  let t = 0;
  while (d.health > 0 && t < 60) {
    sim.step(0.1);
    t += 0.1;
  }
  assert.equal(d.health, 0, 'bled out');
  for (let i = 0; i < 400; i++) sim.step(0.1);
  assert.ok(d.bleed < 0.05, `stopped bleeding (${d.bleed.toFixed(3)})`);
});

test('the rig stage: every act runs on the same dragon code, and does what it says', () => {
  const st = createDragonStage();
  const run = (name, secs, each) => {
    st.play(name);
    for (let t = 0; t < secs; t += 1 / 30) {
      st.step(1 / 30);
      each?.(st.dragon);
    }
    return st.dragon;
  };
  let d = run('rest', 2);
  assert.ok(d.crouch > 0.9, 'lying down');
  const steps = d.steps;
  d = run('walk', 4);
  assert.ok(d.steps > steps + 3 && d.crouch < 0.1, 'walking, standing up');
  let jet = 0;
  run('breathe', 4, (dd) => (jet += dd.breathT > 0 ? 1 : 0));
  assert.ok(jet > 20, 'it breathes fire');
  assert.ok(st.world.heaters.some((h) => h.label === 'dragon fire'), 'a jet flame in its world');
  let cling = 0;
  run('climb', 15, (dd) => (cling += dd.cling ? 1 : 0));
  assert.ok(cling > 10, 'it climbs the wall');
  let maxBank = 0;
  d = run('takeoff', 6);
  assert.equal(d.mode, 'air');
  run('bank', 5, (dd) => (maxBank = Math.max(maxBank, Math.abs(dd.bank))));
  assert.ok(maxBank > 0.5, `banks hard (${maxBank.toFixed(2)})`);
  d = run('land', 20);
  assert.equal(d.mode, 'ground', 'landed');
  d = run('fall', 15);
  assert.ok(d.health <= 0 && d.mode === 'dead', 'shot down, it fell and lies dead');
  d = run('roar', 1);
  assert.ok(d.health > 0, 'an act revives it');
  assert.ok(st.world.events.some((e) => e.type === 'roar'));
  for (const k of Object.keys(DRAGON_ACTS)) run(k, 0.5); // (none throws)
  st.revive();
  const dmg = st.hitZone('neck', 'arrow');
  assert.ok(dmg > 30 && st.dragon.bleed > 0 && st.dragon.stains.length === 1, 'a hit by zone key');
});

test('a rifle round hits the dragon in a zone and it bleeds (sim/wounds.js shoot)', async () => {
  const { shoot } = await import('../src/sim/wounds.js');
  const { sim, w, d } = field();
  const h0 = d.health;
  const from = [d.chest[0] - 0.3, 7, d.chest[2]];
  const hit = shoot(sim, from, [0, -1, 0]);
  assert.ok(hit?.dragon === d, 'the round hit the dragon');
  assert.equal(hit.zone, 'chest');
  assert.ok(d.health < h0 && d.bleed > 0, 'hurt and bleeding');
  // beside it: the round goes into the ground
  assert.ok(!shoot(sim, [d.chest[0], 7, d.chest[2] + 9], [0, -1, 0])?.dragon);
});
