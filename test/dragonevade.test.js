import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../src/sim/createSimulation.js';
import { startFight, startSnatch } from '../src/ai/dragonAir.js';
import { DRAGON_EVADES, startEvade, hitFactor, evadeRollHit, stepEvade } from '../src/ai/dragonEvade.js';
import { createDragonStage, DRAGON_ACTS } from '../src/rig/dragonStage.js';

function field(objects = [], start = 'fly') {
  return createSimulation({
    world: { size: [120, 3, 120], h: 0.4, ground: 'soil' },
    objects: [{ type: 'dragon', params: { start }, x: 20, z: 60, rotation: 90 }, ...objects],
    noFire: true,
  });
}
const tick = (sim, dt = 0.05) => {
  sim.world.time += dt;
  sim.dragonAI.step(dt);
};

test('an arrow at a flying dragon: it evades (the act plays), and evading it is hit less', () => {
  const sim = field();
  const w = sim.world;
  const d = w.dragons[0];
  for (let i = 0; i < 40; i++) tick(sim);
  assert.equal(d.mode, 'air');
  d.evadeChance = 1;
  // an arrow from 30 m off its side, aimed at its chest
  const c = d.chest;
  const from = [c[0] + Math.cos(d.yaw) * 30, c[1] - 2, c[2] - Math.sin(d.yaw) * 30];
  const r = [c[0] - from[0], c[1] - from[1], c[2] - from[2]], l = Math.hypot(...r);
  w.projectiles.push({ type: 'arrow', p: from, v: r.map((x) => (x / l) * 45), resting: false });
  const bank0 = d.bank;
  let kind = null, maxDB = 0, minY = d.p[1], y0 = d.p[1];
  for (let i = 0; i < 60; i++) {
    tick(sim);
    // (the arrow flies on: only the dragon's AI is stepped here, so move it by hand)
    for (const g of w.projectiles) for (let k = 0; k < 3; k++) g.p[k] += g.v[k] * 0.05;
    if (d.evade) kind = d.evade.kind;
    maxDB = Math.max(maxDB, Math.abs(d.bank - bank0));
    minY = Math.min(minY, d.p[1]);
  }
  assert.ok(kind && DRAGON_EVADES[kind].air, `evaded: ${kind}`);
  assert.ok(w.events.some((e) => e.type === 'dragonEvade'));
  if (kind === 'barrelRoll') assert.ok(maxDB > Math.PI, 'rolled right round');
  else if (kind === 'wingOver') assert.ok(maxDB > 0.8, 'banked hard');
  else assert.ok(minY < y0 - 1, 'went down');
  assert.ok(Math.abs(d.bank) < Math.PI, 'the roll taken off its bank afterwards');
  // the chance of a hit: 1 flying straight, the manoeuvre's while evading (its own seeded numbers)
  assert.equal(hitFactor(d), 1);
  startEvade(d, 'barrelRoll', 1, w);
  for (let i = 0; i < 8; i++) stepEvade(d, w, 0.05);
  assert.ok(Math.abs(hitFactor(d) - DRAGON_EVADES.barrelRoll.hit) < 1e-9);
  let hits = 0;
  for (let i = 0; i < 400; i++) hits += evadeRollHit(d) ? 1 : 0;
  assert.ok(hits > 90 && hits < 190, `${hits} of 400 hit while it rolls`);
});

test('arrows that would hit it: fewer land while it evades', () => {
  const sim = field();
  const w = sim.world;
  const d = w.dragons[0];
  for (let i = 0; i < 40; i++) tick(sim);
  const shoot = (n) => {
    let hits = 0;
    for (let i = 0; i < n; i++) {
      const g = { type: 'arrow', p: d.chest.slice(), v: [1, 0, 0] };
      if (sim.dragonAI.hit(d.chest.slice(), 'arrow', g)) hits++;
      d.health = d.maxHealth; // (it does not die of it: it is about the chance)
      d.bleed = 0;
    }
    return hits;
  };
  assert.equal(shoot(40), 40, 'flying straight: every one');
  startEvade(d, 'wingOver', -1, w);
  d.evade.t = 0.5;
  d.evade.dur = 1e9; // (held in the manoeuvre for the count)
  const h = shoot(200);
  assert.ok(h < 0.65 * 200 && h > 0.25 * 200, `${h} of 200 while it evades (hit ${DRAGON_EVADES.wingOver.hit})`);
  assert.ok(w.events.some((e) => e.type === 'dragonDodged'));
});

test('a dragon fight: each one twists out of the other\'s fire passes, and blows are dodged', () => {
  let evades = 0, dodged = 0, over = 0;
  for (const seed of [42, 5, 11]) {
    const sim = createSimulation({
      world: { size: [120, 3, 120], h: 0.4, ground: 'soil' },
      objects: [
        { type: 'dragon', params: { start: 'fly' }, x: 40, z: 60, rotation: 90 },
        { type: 'dragon', params: { start: 'fly', colours: 'koi' }, x: 80, z: 60, rotation: -90 },
      ],
      noFire: true,
    });
    const [a, b] = sim.world.dragons;
    tick(sim);
    startFight(sim.dragonAI, a, b, seed);
    const D = a.duel;
    for (let i = 0; i < 3600 && D.phase !== 'over'; i++) tick(sim);
    evades += (a.evades ?? 0) + (b.evades ?? 0);
    dodged += D.dodged ?? 0;
    over += D.phase === 'over' ? 1 : 0;
  }
  assert.ok(evades >= 2, `${evades} evasions`);
  assert.ok(dodged >= 1, `${dodged} blows dodged`);
  assert.equal(over, 3, 'and every fight still ends');
});

test('on the ground it hops aside; the rig has the evade acts and they play', () => {
  const st = createDragonStage();
  assert.equal(DRAGON_ACTS.evadeRoll, 'Evade: barrel roll');
  assert.equal(DRAGON_ACTS.evadeWingOver, 'Evade: wing-over');
  assert.equal(DRAGON_ACTS.evadeDive, 'Evade: dive');
  const seen = {};
  for (const [act, kind] of [['evadeRoll', 'barrelRoll'], ['evadeWingOver', 'wingOver'], ['evadeDive', 'dive']]) {
    st.play(act);
    let got = false, maxB = 0, yawSpan = 0, drop = 0, y0 = null, yaw0 = null;
    for (let i = 0; i < 900; i++) {
      st.step(1 / 30);
      const d = st.dragon;
      if (d.evade?.kind === kind) {
        if (!got) (y0 = d.p[1]), (yaw0 = d.yaw);
        got = true;
        maxB = Math.max(maxB, Math.abs(d.bank));
        yawSpan = Math.max(yawSpan, Math.abs(d.yaw - yaw0));
        drop = Math.max(drop, y0 - d.p[1]);
      }
    }
    seen[act] = { got, maxB, yawSpan, drop };
  }
  assert.ok(seen.evadeRoll.got && seen.evadeRoll.maxB > Math.PI, JSON.stringify(seen.evadeRoll));
  assert.ok(seen.evadeWingOver.got && seen.evadeWingOver.yawSpan > 1.5 && seen.evadeWingOver.maxB > 1, JSON.stringify(seen.evadeWingOver));
  assert.ok(seen.evadeDive.got && seen.evadeDive.drop > 2, JSON.stringify(seen.evadeDive));
  // on the ground: a hop aside
  st.play('walk');
  for (let i = 0; i < 600 && st.dragon.mode !== 'ground'; i++) st.step(1 / 30);
  const d = st.dragon;
  const p0 = d.p.slice();
  assert.ok(startEvade(d, 'sideStep', 1, st.world));
  assert.equal(startEvade(d, 'barrelRoll', 1, st.world), null, 'no barrel roll on the ground');
  d.evade = null;
  startEvade(d, 'sideStep', 1, st.world);
  for (let i = 0; i < 30; i++) stepEvade(d, st.world, 1 / 30);
  assert.ok(Math.hypot(d.p[0] - p0[0], d.p[2] - p0[2]) > 1.5, 'hopped aside');
  void startSnatch;
});
