import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../src/sim/createSimulation.js';
import { SCENARIOS, cloneScene } from '../src/scenarios.js';
import { explode } from '../src/sim/explosions.js';
import { groundAt, PLAN } from '../src/ai/dragon.js';
import { F_BURNING } from '../src/sim/world.js';
import { MATERIALS } from '../src/sim/materials.js';

const run = (sim, t, each, dt = 0.05) => {
  while (sim.world.time < t) {
    each?.(sim);
    sim.step(dt);
  }
};

/** A flat field (grass on soil) with a dragon at (8, 15) facing +x, and whatever else. */
function field(objects = [], grass = false) {
  return createSimulation({
    world: { size: [44, 8, 30], h: 0.4, ground: 'soil' },
    objects: [
      ...(grass ? [{ type: 'grass', params: { width: 40, depth: 26, height: 0.3, density: 0.8, moisture: 0.05 }, x: 22, z: 15 }] : []),
      { type: 'dragon', params: {}, x: 8, z: 15, rotation: 90 },
      ...objects,
    ],
    noFire: true,
  });
}

/** Someone standing at p, as the walk-through tells the AI. */
const player = (sim, p) => (sim.ai.player = { p: p.slice(), head: [p[0], p[1] + 1.7, p[2]] });

test('the island has a dragon lying in its lair, its body on the ground', () => {
  const sc = cloneScene(SCENARIOS.carrier);
  sc.startZone = 'island';
  sc.noFire = true;
  const sim = createSimulation(sc);
  const w = sim.world;
  assert.equal(w.dragons.length, 1);
  const d = w.dragons[0];
  assert.equal(d.state, 'rest');
  assert.ok(d.spine.length > 35, `spine of ${d.spine.length} points`);
  // nose to tail ~9 m
  let L = 0;
  for (let i = 1; i < d.spine.length; i++) L += Math.hypot(...[0, 1, 2].map((c) => d.spine[i][c] - d.spine[i - 1][c]));
  assert.ok(Math.abs(L + PLAN.head - 9) < 1.2, `length ${(L + PLAN.head).toFixed(1)} m`);
  // every point near the ground (lying down), none under it
  for (const p of d.spine) {
    const g = groundAt(w, p[0], p[2], p[1] + 1.5).y;
    assert.ok(p[1] > g - 0.15 && p[1] < g + 1.6, `spine point ${p.map((v) => v.toFixed(1))} vs ground ${g.toFixed(1)}`);
  }
});

test('a blast wakes it: it takes off and flies like a bird (climbs, banks into turns)', () => {
  const sim = field();
  const d = sim.world.dragons[0];
  run(sim, 1);
  explode(sim, [30, 1, 15], 3e5, { name: 'test' });
  let maxAlt = 0;
  let maxBank = 0;
  let beats = 0;
  run(sim, 20, () => {
    const g = groundAt(sim.world, d.p[0], d.p[2]).y;
    maxAlt = Math.max(maxAlt, d.p[1] - g);
    maxBank = Math.max(maxBank, Math.abs(d.bank));
    beats = d.beats;
  });
  assert.ok(sim.world.events.some((e) => e.type === 'roar'), 'it roars');
  assert.ok(maxAlt > 6, `it flew (${maxAlt.toFixed(1)} m up)`);
  assert.ok(maxBank > 0.3, `banked into a turn (${maxBank.toFixed(2)} rad)`);
  assert.ok(beats > 5, `flapped (${beats} wingbeats)`);
  // the tail follows the body: it stays one length behind the chest
  const tip = d.spine[d.spine.length - 1];
  const dd = Math.hypot(tip[0] - d.chest[0], tip[1] - d.chest[1], tip[2] - d.chest[2]);
  assert.ok(dd > 4 && dd < 6.4, `tail tip ${dd.toFixed(1)} m behind the chest`);
});

test('it crawls after prey on the ground, legs sprawled, the body swinging like a lizard', () => {
  const sim = field();
  const d = sim.world.dragons[0];
  d.timer = 999; // no flight round
  d.fuel = 0; // and no fire: it comes for you
  const p = [19, 0.4, 15];
  let maxUnd = 0;
  let x0 = d.p[0];
  run(sim, 3, () => {
    player(sim, p);
    maxUnd = Math.max(maxUnd, d.undulate);
  });
  assert.equal(d.mode, 'ground');
  assert.ok(d.p[0] > x0 + 1.5, `it came closer (${x0.toFixed(1)} → ${d.p[0].toFixed(1)})`);
  assert.ok(maxUnd > 0.3, 'its body swings side to side');
  assert.ok(d.steps > 2, 'its feet step');
});

test('its fire is a real flame jet: it sets the grass alight and burns whoever stands in it', () => {
  const sim = field([], true);
  const w = sim.world;
  const d = w.dragons[0];
  d.timer = 999;
  const p = [17, 0.4, 15];
  let jet = 0;
  let burnt = 0;
  run(sim, 8, () => {
    player(sim, p);
    if (w.heaters.some((h) => h.label === 'dragon fire' && h.until > w.time)) jet++;
    burnt = w.events.filter((e) => e.type === 'dragonFire').length;
  });
  assert.ok(jet > 10, 'a jet flame in the simulation');
  let burning = 0;
  for (let k = 0; k < w.solidCount; k++) if (w.flags[w.solids[k]] & F_BURNING && MATERIALS[w.mat[w.solids[k]]].name === 'grass') burning++;
  assert.ok(burning > 5, `the grass burns (${burning} voxels)`);
  assert.ok(burnt > 0, 'the player was in the fire');
  assert.ok(sim.stats.hrr > 2e5, `heat release ${(sim.stats.hrr / 1e6).toFixed(2)} MW`);
});

test('it devours a guard: seized, held in the jaws, swallowed; then it is sated', () => {
  const sim = field([{ type: 'enemy', params: { count: 1, spread: 0 }, x: 16, z: 15 }]);
  const w = sim.world;
  const d = w.dragons[0];
  d.timer = 999;
  d.fuel = 0; // no fire (it would burn the guard first): it has to catch them
  const e = w.enemies[0];
  let held = false;
  run(sim, 40, () => {
    held ||= !!e.held;
  });
  assert.ok(held, 'the guard was held in its jaws');
  assert.ok(e.devoured, 'and swallowed');
  assert.ok(d.sated > 0, 'it is sated');
});

test('it devours you', () => {
  const sim = field();
  const w = sim.world;
  const d = w.dragons[0];
  d.timer = 999;
  d.fuel = 0; // no fire: straight for the bite
  let held = false;
  run(sim, 30, () => {
    if (!w.events.some((e) => e.type === 'devoured')) player(sim, [15, 0.4, 15]);
    else sim.ai.player = null;
    held ||= !!w.playerHeld;
  });
  assert.ok(held, 'held in the jaws');
  assert.ok(w.events.some((e) => e.type === 'devoured'), 'swallowed');
});

test('arrows and rockets hurt it, fire does not; killed, it falls', () => {
  const sim = field();
  const w = sim.world;
  const d = w.dragons[0];
  run(sim, 0.5);
  const h0 = d.health;
  // an arrow into its flank
  const c = d.spine[d.iShoulder + 3];
  sim.shootArrow([c[0], c[1], c[2] - 6], [0, 2, 40]);
  run(sim, 1.5);
  assert.ok(d.health < h0, `the arrow hurt it (${h0} → ${d.health.toFixed(0)})`);
  assert.ok(d.anger > 0, 'and angered it');
  // standing in a fire does nothing
  const h1 = d.health;
  sim.addTorch(d.chest, 2e5, 2, 0.5);
  run(sim, 3);
  assert.ok(d.health >= h1 - 1, 'fire does not hurt it');
  // rockets
  for (let n = 0; n < 3 && d.health > 0; n++) {
    const q = d.spine[d.iShoulder + 4];
    sim.fireRocket([q[0], q[1] + 0.2, q[2] - 5], [0, 0, 30]);
    run(sim, w.time + 1);
  }
  assert.equal(d.health, 0, 'dead');
  run(sim, w.time + 3);
  assert.equal(d.mode, 'dead');
  assert.ok(w.events.some((e) => e.type === 'dragonDown'));
});

test('on the island it walks its round: the hilltop, up the church walls and over the roof, to the catacomb stairs; its feet are heard', () => {
  const sc = cloneScene(SCENARIOS.carrier);
  sc.startZone = 'island';
  sc.noFire = true;
  // (without the volcano: it would erupt as the dragon passes, and set the island's grass alight)
  sc.zones.island.objects = sc.zones.island.objects.filter((o) => o.type !== 'enemy' && o.type !== 'volcano');
  const sim = createSimulation(sc);
  const w = sim.world;
  const d = w.dragons[0];
  assert.equal(d.routePts.length, 5, 'route parsed');
  // where things are: the hilltop and the church on its route, the catacomb stairs
  const [, hillTop, church] = d.routePts.map((q) => q.p);
  const stairs = w.portals.find((q) => q.to === 'catacombs').p;
  d.timer = 0.5; // done resting
  let hill = 0;
  let roof = 0;
  let wall = 0;
  let sniffed = false;
  run(sim, 60, () => {
    const g = groundAt(w, d.p[0], d.p[2], d.p[1] + 1).y;
    if (Math.hypot(d.p[0] - hillTop[0], d.p[2] - hillTop[2]) < 3) hill = Math.max(hill, g);
    if (Math.hypot(d.p[0] - church[0], d.p[2] - church[2]) < 3 && d.mode === 'ground') roof = Math.max(roof, g);
    if (d.cling) wall++;
    sniffed ||= d.sniffT > 0 && !!d.look && Math.hypot(d.look[0] - stairs[0], d.look[2] - stairs[2]) < 1.5;
  }, 0.1);
  assert.ok(hill > 9, `on the hilltop (${hill.toFixed(1)} m)`);
  assert.ok(roof > 12, `crawled on the church roof (${roof.toFixed(1)} m)`);
  assert.ok(wall > 20, 'clung to a wall');
  assert.ok(sniffed, 'looked into the catacomb stairs');
  assert.ok(d.footfalls.length > 0 && d.steps > 40, `${d.steps} footfalls`);
  assert.ok(w.noises.some((n) => n.kind === 'dragon'), 'its steps make noise');
});

test('a noise that keeps coming from one place (an eruption) does not keep it circling for ever', () => {
  const sim = field();
  const w = sim.world;
  const d = w.dragons[0];
  let flew = false;
  let backDown = false;
  let next = 0;
  run(sim, 90, () => {
    if (w.time >= next) {
      next += 2;
      w.noises.push({ p: [34, 1, 15], loud: 250, time: w.time, kind: 'eruption' });
    }
    flew ||= d.mode === 'air';
    if (flew && w.time > 40 && d.mode === 'ground' && d.state === 'rest') backDown = true;
  }, 0.1);
  assert.ok(flew, 'it went to look');
  assert.ok(backDown, `it came back down and lay down again (now ${d.state}, ${d.mode})`);
});

test('guards run from it', () => {
  const sim = field([{ type: 'enemy', params: { count: 1, spread: 0 }, x: 14, z: 15 }]);
  const e = sim.world.enemies[0];
  sim.world.dragons[0].sated = 999; // not hungry
  run(sim, 4);
  assert.equal(e.state, 'flee');
  assert.ok(e.p[0] > 14.5, `ran away (x ${e.p[0].toFixed(1)})`);
});
