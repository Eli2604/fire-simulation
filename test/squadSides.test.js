import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SquadAI } from '../src/ai/squad.js';
import { assess } from '../src/ai/strategy.js';
import { sideOf } from '../src/ai/sides.js';
import { SCENARIOS, cloneScene } from '../src/scenarios.js';
import { createSimulation } from '../src/sim/createSimulation.js';
import { MODELS, defaultParams } from '../src/models/index.js';

/** An open range (no cover), teams of the squad model at [x, z] with a side, a threat offset each. */
function clash(teams, o = {}) {
  const sim = createSimulation({
    world: { size: [40, 4, 60], h: 0.2, ground: 'quarrySand' },
    objects: teams.map(([unit, side, x, z, tx, tz]) => ({ type: 'squad', params: { unit, side, threatX: tx, threatZ: tz }, x, z })),
    noFire: true,
    ...o,
  });
  sim.step(sim.dt); // (the squad AIs are made on the first step)
  const sq = (u) => sim.squadFor(u);
  // every round each team fires: who fired it, at what, and how near that is (then) to a man of his own side and of another
  const shots = [];
  const nearest = (p, l) => Math.min(Infinity, ...l.map((m) => Math.hypot(m.p[0] - p[0], m.p[2] - p[2])));
  for (const s of sim.squads) {
    const f = s.host.fire;
    s.host.fire = (e, target, weapon) => {
      const live = sim.world.enemies.filter((m) => !m.dead && m !== e);
      const own = nearest(target, live.filter((m) => sideOf(m) === sideOf(e))), foe = nearest(target, live.filter((m) => sideOf(m) !== sideOf(e)));
      shots.push({ e, side: sideOf(e), target: target.slice(), own, foe });
      return f(e, target, weapon);
    };
  }
  return { sim, w: sim.world, sq, shots };
}
const near2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

test('the squad model has a side param (the editor shows it), on its men', () => {
  const P = MODELS.squad.params.side;
  assert.deepEqual(P.options.slice(0, 2), ['red', 'blue']);
  assert.equal(defaultParams('squad').side, 'red');
  const { w } = clash([['Alpha', 'blue', 20, 50, 0, -10], ['Charlie', 'red', 20, 10, 0, 10]]);
  assert.ok(w.enemies.filter((e) => e.unit === 'Alpha').every((e) => e.side === 'blue'));
  assert.ok(w.enemies.filter((e) => e.unit === 'Charlie').every((e) => e.side === 'red'));
});

test('two squads of different sides engage each other: each sees, aims at and hits the other side', () => {
  const { sim, w, sq, shots } = clash([['Alpha', 'blue', 20, 40, 0, -10], ['Charlie', 'red', 20, 16, 0, 10]]);
  const A = sq('Alpha'), C = sq('Charlie');
  const blue = w.enemies.filter((e) => e.side === 'blue'), red = w.enemies.filter((e) => e.side === 'red');
  let sawEach = false;
  const hurt = () => [...blue, ...red].some((e) => e.dead || (e.health ?? 100) < 100);
  const fired = (side) => shots.filter((s) => s.side === side).length;
  for (let t = 0; t < 25 && !(sawEach && hurt() && fired('blue') > 5 && fired('red') > 5); t += sim.dt) {
    sim.step(sim.dt);
    if (A.seen?.some((h) => red.includes(h)) && C.seen?.some((h) => blue.includes(h))) sawEach = true;
  }
  assert.ok(sawEach, 'each team made out the men of the other');
  assert.ok(!A.seen?.some((h) => blue.includes(h)) && !C.seen?.some((h) => red.includes(h)), 'never its own side as a hostile');
  // the threat: an enemy soldier (where they were seen), not the offset they started towards
  const nearest = (s, foes) => Math.min(...foes.map((h) => near2(s.threat, h.p)));
  assert.ok(A.threat && nearest(A, red) < 6, 'Alpha has a red soldier as its threat');
  assert.ok(C.threat && nearest(C, blue) < 6, 'Charlie has a blue soldier as its threat');
  // both fire, each at the other side (the round's aim point nearer an enemy than any man of his own)
  for (const side of ['blue', 'red']) assert.ok(fired(side) > 5, `the ${side} team fires (${fired(side)} rounds)`);
  const wrong = shots.filter((s) => s.own < s.foe);
  assert.ok(wrong.length <= shots.length * 0.1, `aimed nearer their own side than the enemy: ${wrong.length} of ${shots.length}`);
  // real rounds: someone is hit
  assert.ok(hurt(), 'someone is hit');
  assert.ok(w.playerHits.length === 0);
});

test('friendly squads do not shoot each other, nor you when you are on their side', () => {
  // two blue teams face each other across the range, you between them in plain sight
  const { sim, w, sq, shots } = clash([['Alpha', 'blue', 20, 50, 0, -8], ['Bravo', 'blue', 20, 10, 0, 8]]);
  sim.ai.player = { p: [20, 0.1, 30], head: [20, 1.75, 30], moving: true };
  for (let t = 0; t < 6; t += sim.dt) sim.step(sim.dt);
  for (const u of ['Alpha', 'Bravo']) {
    const s = sq(u);
    assert.equal(s.knownHostiles().length, 0, `${u} knows of no hostile`);
  }
  assert.ok(w.enemies.every((e) => !e.dead && (e.health ?? 100) === 100), 'nobody of theirs hurt');
  assert.equal(w.playerHits.length, 0, 'you are not hit');
  // (what rounds they fire, at the threat point they were given, go nowhere near you or the other team)
  for (const s of shots) assert.ok(near2(s.target, [20, 0, 30]) > 3, 'not at you');
  // a red team turns up: the blue ones fight it, still never you
  const red = clash([['Alpha', 'blue', 20, 50, 0, -8], ['Charlie', 'red', 20, 16, 0, 8]]);
  red.sim.ai.player = { p: [26, 0.1, 50], head: [26, 1.75, 50] };
  for (let t = 0; t < 6; t += red.sim.dt) red.sim.step(red.sim.dt);
  assert.ok(red.sq('Alpha').knownHostiles().every((h) => h.side === 'red'), 'blue: only red soldiers are hostile');
  assert.ok(red.sq('Charlie').knownHostiles().length > 0);
  assert.ok(red.shots.filter((s) => s.side === 'blue').every((s) => near2(s.target, [26, 0, 50]) > 2), 'blue rounds never at you');
});

test('the leader counts every hostile he knows of: seen lately, or seen by the friendly team beside him', () => {
  const members = [];
  const roles = [['CMD', -1, 0], ['MG', 1, 0.2], ['R1', -1.4, 1.6], ['R2', 1.4, 1.8]];
  for (const [unit, dx] of [['Alpha', 0], ['Bravo', 6]]) for (const [squad, x, z] of roles) members.push({ p: [x + dx, 0, z], yaw: Math.PI, squad, unit, side: 'blue', health: 100, mag: 30, mags: 4 });
  // six red men in the open to the north; a wall will hide four of them from Alpha
  const foes = [0, 1, 2, 3, 4, 5].map((k) => ({ p: [-5 + k * 2, 0, -16], side: 'red', squad: 'R1', unit: 'Charlie' }));
  let wall = false;
  const lineOfSight = (a, b) => !(wall && b[0] > -2 && a[0] < 4);
  const squads = [];
  for (const unit of ['Alpha', 'Bravo'])
    squads.push(new SquadAI({ unit, side: 'blue', members: () => members, solid: () => false, floor: () => 0, bounds: [-20, -20, 20, 20], threat: [0, 0, -16], hostiles: () => foes, lineOfSight, peers: () => squads }));
  const [A, B] = squads;
  for (let k = 0; k < 40; k++) for (const s of squads) s.step(0.05);
  assert.equal(A.seen.length, 6, 'Alpha sees all six');
  wall = true;
  for (let k = 0; k < 4; k++) for (const s of squads) s.step(0.05);
  assert.ok(A.seen.length < 6, 'now Alpha sees fewer');
  assert.equal(A.knownHostiles().length, 6, 'but remembers them all');
  assert.equal(assess(A).enemies, 6, 'and the leader counts them all');
  // forgotten after a while unless the friendly team beside them still sees them
  A.known.clear();
  assert.ok(B.seen.length > A.seen.length);
  assert.equal(A.knownHostiles().length, new Set([...A.seen, ...B.seen]).size, 'what Bravo sees counts for Alpha');
  // and the dead are not counted
  foes[5].dead = foes[4].dead = true;
  assert.ok(A.knownHostiles().every((h) => !h.dead));
});

test('squad against squad: the outnumbered red team retreats, the blue teams hold', () => {
  const sim = createSimulation(cloneScene(SCENARIOS.squadClash));
  const w = sim.world;
  assert.equal(w.enemies.filter((e) => e.side === 'blue').length, 8);
  assert.equal(w.enemies.filter((e) => e.side === 'red').length, 4);
  let red = null;
  for (let t = 0; t < 60 && !(red?.strategy?.kind === 'retreat'); t += sim.dt) {
    sim.step(sim.dt);
    red = sim.squadFor('Charlie');
  }
  assert.equal(red.strategy?.kind, 'retreat', `Charlie retreats (${red.strategy?.kind ?? red.phase}, ${red.members().filter((m) => !m.dead).length} alive, t ${w.time.toFixed(0)})`);
  // (the fight is not scripted: a blue team badly hit may fall back too, but not the both of them)
  assert.ok(sim.squads.filter((s) => s.unit !== 'Charlie' && s.strategy?.kind === 'retreat').length < 2, 'the blue side holds');
  const why = red.retreatWhy;
  assert.ok(why && why.facts.strength >= why.facts.fit, `the odds against them (${why?.text})`);
  assert.ok(red.retreatLog.some((s) => /^retreat:decide:/.test(s)), 'decided and logged by the leader');
  assert.ok(w.events.some((e) => e.type === 'shout' && /Fall back/.test(e.name)), 'the word shouted');
  assert.equal(w.playerHits.length, 0);
});
