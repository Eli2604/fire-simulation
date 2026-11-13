import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../src/sim/createSimulation.js';
import { WING, canFly, wingDamage } from '../src/ai/dragon.js';
import { createDragonStage } from '../src/rig/dragonStage.js';

/** A dragon on the island's AI, sent out on a flight, and the time it took to get up. */
function airborne() {
  const sim = createSimulation({
    world: { size: [80, 10, 80], h: 0.4, ground: 'soil' },
    objects: [{ type: 'dragon', params: {}, x: 40, z: 40, rotation: 90 }],
    noFire: true,
  });
  const w = sim.world;
  const d = w.dragons[0];
  sim.step(0.05);
  d.state = 'roam';
  d.roam = { phase: 'takeoff', until: 999 };
  for (let i = 0; i < 400 && !(d.mode === 'air' && d.p[1] - d.chest[1] > -99 && d.p[1] > 8); i++) sim.dragonAI.step(1 / 20);
  assert.equal(d.mode, 'air', 'it got up');
  return { sim, w, d };
}
const run = (sim, d, secs, until) => {
  for (let t = 0; t < secs; t += 1 / 20) {
    sim.dragonAI.step(1 / 20);
    if (until?.()) return t;
  }
  return Infinity;
};

test('a badly hurt wing: it comes straight down, and cannot take off again until it mends', () => {
  const { sim, w, d } = airborne();
  const hp = d.health;
  const alt = d.p[1];
  d.wingHurt = { wingL: WING.hp * 0.6 };
  assert.equal(canFly(d), false);
  const t = run(sim, d, 20, () => d.mode === 'ground');
  console.log(`landed in ${t.toFixed(1)} s from ${alt.toFixed(1)} m`);
  assert.ok(t < 8, `down in ${t.toFixed(1)} s from ${alt.toFixed(1)} m`);
  assert.ok(w.events.some((e) => e.type === 'dragonWingHurt'));
  assert.ok(!w.events.some((e) => e.type === 'dragonCrash'), 'a landing, not a crash');
  assert.ok(d.health > hp - 1, 'the landing does not hurt it');
  // it walks about, but stays down
  d.state = 'roam';
  d.roam = { phase: 'takeoff', until: 999 };
  run(sim, d, 10);
  assert.equal(d.mode, 'ground', 'no take-off on a bad wing');
  // lying still, it mends, and flies again
  d.state = 'rest';
  d.timer = 999;
  run(sim, d, 90);
  assert.ok(canFly(d), `the wing mended (${wingDamage(d)[0].toFixed(2)})`);
});

test('a useless wing: it falls, spinning towards the bad wing, and the crash hurts', () => {
  const { sim, w, d } = airborne();
  run(sim, d, 3); // (higher up)
  const hp = d.health;
  const yaw = d.yaw;
  d.wingHurt = { wingR: WING.hp * 1.1 };
  run(sim, d, 0.5);
  assert.equal(d.mode, 'falling');
  assert.ok(w.events.some((e) => e.type === 'dragonFalls'));
  assert.ok(d.yaw < yaw, 'it turns towards its right (the bad) wing');
  const t = run(sim, d, 20, () => d.mode !== 'falling');
  assert.ok(t < 6, `on the ground in ${t.toFixed(1)} s`);
  const crash = w.events.find((e) => e.type === 'dragonCrash');
  assert.ok(crash, 'it crashed');
  console.log(`crash: ${t.toFixed(1)} s, ${crash.damage.toFixed(0)} damage`);
  assert.ok(d.health < hp, `the fall hurt it (${crash.damage.toFixed(0)})`);
});

test('wing hits tear the wing; the rig stage shows the landing and the fall', () => {
  const st = createDragonStage();
  const d = st.dragon;
  for (let n = 0; n < 5; n++) st.hitZone('wingL', 'arrow');
  assert.ok(wingDamage(d)[0] >= WING.hurt && wingDamage(d)[1] === 'wingL', 'five arrows: badly hurt');
  assert.equal(canFly(d), false);
  // on the page: up, then the wing goes, and it falls to the ground
  st.revive();
  st.play('wingGone');
  let fell = false;
  for (let i = 0; i < 30 * 25; i++) {
    st.step(1 / 30);
    if (st.dragon.mode === 'falling') fell = true;
    if (fell && st.dragon.mode === 'ground') break;
  }
  assert.ok(fell && st.dragon.mode === 'ground', 'fell and is down');
});
