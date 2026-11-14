import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../src/sim/createSimulation.js';
import { canFly, initDragon, WING } from '../src/ai/dragon.js';
import { intercept, startSnatch, startFight, addLoose, lift, blow, stepThrown, SNATCH, canCarry } from '../src/ai/dragonAir.js';
import { createDragonStage } from '../src/rig/dragonStage.js';

/** A big flat field with a dragon (in the air) and whatever else. */
function field(objects = [], start = 'fly') {
  const sim = createSimulation({
    world: { size: [120, 3, 120], h: 0.4, ground: 'soil' },
    objects: [{ type: 'dragon', params: { start }, x: 20, z: 60, rotation: 90 }, ...objects],
    noFire: true,
  });
  return sim;
}
/** Only the dragons (the rest of the simulation is not what is tested, and slow on a big field). */
const tick = (sim, dt = 0.05) => {
  sim.world.time += dt;
  sim.dragonAI.step(dt);
};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test('intercept: it aims at where a moving target will be, not where it is', () => {
  const from = [0, 10, 0];
  const p = [40, 0, 0];
  const v = [0, 0, 5]; // crossing at 5 m/s
  const { p: aim, t } = intercept(from, 17, p, v);
  assert.ok(t > 2 && t < 3.5, `time to go ${t.toFixed(2)}`);
  // the meeting point: on the target's path, t seconds on, and the chaser gets there in the same time
  assert.ok(Math.abs(aim[2] - 5 * t) < 1e-6 && aim[0] === 40);
  assert.ok(Math.abs(dist(from, aim) - 17 * t) < 1e-6);
  // a target standing still: aim straight at it
  const still = intercept(from, 17, p, [0, 0, 0]);
  assert.deepEqual(still.p, p);
  // one it cannot catch (faster, going away): a finite aim ahead of it
  const away = intercept(from, 5, p, [20, 0, 0]);
  assert.ok(away.p[0] > 40 && Number.isFinite(away.t));
});

test('snatch: it climbs, dives at a guard, the jaws close on him, it carries him, tosses him on an arc, he hits the ground; it goes on', () => {
  const sim = field([{ type: 'enemy', params: { count: 1 }, x: 70, z: 60 }]);
  const w = sim.world;
  const d = w.dragons[0];
  const e = w.enemies[0];
  tick(sim);
  e.stunnedUntil = 1e9; // (he stands still: it is about the dragon)
  assert.ok(startSnatch(sim.dragonAI, d, { kind: 'enemy', ref: e }, 5));
  const phases = new Set();
  let carried = null;
  let peakAlt = 0;
  let thrownAt = null;
  let landed = null;
  for (let i = 0; i < 1600 && !landed; i++) {
    tick(sim);
    if (d.snatch) phases.add(d.snatch.phase);
    if (d.snatch?.phase === 'climb') peakAlt = Math.max(peakAlt, d.p[1]);
    if (d.snatch?.phase === 'carry') {
      carried ??= e.p.slice();
      assert.ok(e.held, 'held while carried');
      assert.ok(dist(e.p, d.mouth) < 1.0, 'in its jaws');
    }
    if (e.thrown && !thrownAt) thrownAt = { p: e.p.slice(), t: w.time };
    landed = w.events.find((ev) => ev.type === 'thrownLanded');
  }
  assert.ok(phases.has('climb') && phases.has('dive') && phases.has('carry') && phases.has('toss'), [...phases].join(','));
  assert.ok(peakAlt > 10, `climbed to ${peakAlt.toFixed(1)} m`);
  assert.ok(carried, 'carried');
  assert.ok(thrownAt, 'thrown');
  assert.ok(landed, 'landed');
  assert.ok(!e.held && !e.thrown, 'let go');
  assert.ok(d.state !== 'snatch' && !d.snatch, `back to ${d.state}`);
  assert.ok(landed.speed > 8, `hit the ground at ${landed.speed.toFixed(1)} m/s`);
  assert.ok(e.health < 100 || e.dead, 'the fall hurt him');
});

test('snatch: the thrown arc keeps the carried speed plus the toss, and is ballistic', () => {
  const sim = field();
  const w = sim.world;
  const o = addLoose(w, 'crate', [60, 20, 60]);
  o.flying = true;
  const v0 = [12, 4, 0];
  w.thrown = [{ kind: 'object', ref: o, p: o.p.slice(), v: v0.slice(), spin: [0, 0, 0], t: 0 }];
  const pts = [];
  for (let i = 0; i < 60 && w.thrown.length; i++) {
    stepThrown(sim, 0.02);
    pts.push(o.p.slice());
  }
  // after 1.2 s (within the drag): x ≈ 12·t, y ≈ 20 + 4t − g t²/2
  const t = 1.2;
  assert.ok(Math.abs(pts[59][0] - (60 + 12 * t)) < 0.6, `x ${pts[59][0].toFixed(2)}`);
  assert.ok(Math.abs(pts[59][1] - (20 + 4 * t - 0.5 * 9.81 * t * t)) < 0.4, `y ${pts[59][1].toFixed(2)}`);
});

test('snatch: too heavy is refused; a gas cylinder thrown hard bursts where it lands', () => {
  const sim = field();
  const w = sim.world;
  const d = w.dragons[0];
  const car = addLoose(w, 'drum', [60, 1, 60], { mass: 1200 });
  assert.equal(canCarry(d, 1200), false);
  assert.equal(startSnatch(sim.dragonAI, d, { kind: 'object', ref: car }), false);
  const cyl = addLoose(w, 'cylinder', [60, 15, 60]);
  cyl.flying = true;
  w.thrown = [{ kind: 'object', ref: cyl, p: cyl.p.slice(), v: [15, -10, 0], spin: [0, 0, 0], t: 0 }];
  for (let i = 0; i < 100 && w.thrown.length; i++) stepThrown(sim, 0.02);
  assert.ok(cyl.burst, 'burst');
  assert.ok(w.events.some((e) => e.type === 'explosion' || e.type === 'thrownLanded'));
});

test('snatch: a dodge makes it miss; it turns for another pass (at most SNATCH.passes)', () => {
  const sim = field();
  const w = sim.world;
  const d = w.dragons[0];
  const o = addLoose(w, 'dummy', [70, 0.9, 60], { canDodge: true, dodgeChance: 1 });
  assert.ok(startSnatch(sim.dragonAI, d, { kind: 'object', ref: o }, 9));
  let misses = 0;
  for (let i = 0; i < 2400 && d.snatch; i++) {
    tick(sim);
    misses = w.events.filter((e) => e.type === 'snatchMiss').length;
    // the dummy gets back on its feet in the middle (and dodges every pass)
  }
  assert.ok(misses >= 1, `${misses} misses`);
  assert.ok(misses <= SNATCH.passes);
  assert.ok(!d.snatch, 'gave up or caught it');
});

/** Two dragons in the air over the field. */
function duel(seed) {
  const sim = createSimulation({
    world: { size: [120, 3, 120], h: 0.4, ground: 'soil' },
    objects: [
      { type: 'dragon', params: { start: 'fly' }, x: 40, z: 60, rotation: 90 },
      { type: 'dragon', params: { start: 'fly', colours: 'koi' }, x: 80, z: 60, rotation: -90 },
    ],
    noFire: true,
  });
  sim.seed = 12345;
  const [a, b] = sim.world.dragons;
  tick(sim);
  startFight(sim.dragonAI, a, b, seed);
  return { sim, a, b };
}

test('fight: two dragons circle, joust, trade blows on hit zones, and it ends with a loser', () => {
  const { sim, a, b } = duel(42);
  const w = sim.world;
  const phases = new Set();
  const D = a.duel;
  for (let i = 0; i < 3600 && D.phase !== 'over'; i++) {
    tick(sim);
    phases.add(D.phase);
  }
  assert.ok(phases.has('circle') && phases.has('joust'), [...phases].join(','));
  assert.ok(D.blows.length > 0, 'blows landed');
  assert.ok(D.blows.every((x) => x.dmg >= 0 && x.key));
  assert.equal(D.phase, 'over', `still ${D.phase} after ${w.time.toFixed(0)} s`);
  assert.ok(a.health < a.maxHealth || b.health < b.maxHealth, 'someone is hurt');
});

test('fight: a torn wing takes its lift: it cannot stay up and comes down', () => {
  const { sim, a, b } = duel(3);
  assert.equal(lift(b), 1);
  blow(sim.dragonAI, b, 'wingL', 'bite', a);
  blow(sim.dragonAI, b, 'wingL', 'bite', a);
  assert.ok(lift(b) < 0.5, `lift ${lift(b).toFixed(2)}`);
  assert.equal(canFly(b), false);
  const y0 = b.p[1];
  for (let i = 0; i < 400 && b.mode === 'air'; i++) tick(sim);
  assert.notEqual(b.mode, 'air', 'down');
  assert.ok(b.p[1] < y0);
  assert.ok(!a.duel, 'the fight is over');
});

test('fight: deterministic for a seed', () => {
  const run = (seed) => {
    const { sim, a, b } = duel(seed);
    const D = a.duel;
    for (let i = 0; i < 900; i++) tick(sim);
    return JSON.stringify({ blows: D.blows.map((x) => [x.to, x.key, x.type, x.dmg]), ha: Math.round(a.health), hb: Math.round(b.health), g: D.grapples });
  };
  assert.equal(run(77), run(77));
});

test('rig stage: the snatch and the fight play and loop', () => {
  const st = createDragonStage();
  st.play('snatch');
  const seen = new Set();
  for (let i = 0; i < 1500; i++) {
    st.step(1 / 30);
    if (st.dragon.snatch) seen.add(st.dragon.snatch.phase);
  }
  assert.ok(seen.has('dive') && seen.has('carry'), [...seen].join(','));
  st.play('fight');
  assert.equal(st.world.dragons.length, 2);
  const fs = new Set();
  for (let i = 0; i < 1500; i++) {
    st.step(1 / 30);
    if (st.world.dragons[0].duel) fs.add(st.world.dragons[0].duel.phase);
  }
  assert.ok(fs.has('joust'), [...fs].join(','));
  st.play('fly');
  st.step(1 / 30);
  assert.equal(st.world.dragons.length, 1);
  void initDragon;
  void WING;
});
