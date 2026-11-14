import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SquadAI } from '../src/ai/squad.js';
import { assess, choose, exposure, STRATEGIES } from '../src/ai/strategy.js';

/** A flat range (solid below 0) with boxes [x0, z0, x1, z1, top]; sight is blocked by them. */
function range(boxes) {
  const solid = (x, y, z) => y < 0 || boxes.some(([x0, z0, x1, z1, top]) => x >= x0 && x < x1 && z >= z0 && z < z1 && y >= 0 && y < top);
  const floor = (x, z, from) => {
    for (let y = from; y > from - 3.5; y -= 0.05) if (solid(x, y - 0.025, z)) return Math.round(y / 0.05) * 0.05;
    return null;
  };
  const lineOfSight = (a, b) => {
    const A = [a[0], (a[1] ?? 0) + 1.5, a[2]], B = [b[0], (b[1] ?? 0) + 1.2, b[2]];
    const L = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
    for (let s = 0.2; s < L - 0.2; s += 0.2) {
      const t = s / L;
      if (solid(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t)) return false;
    }
    return true;
  };
  return { solid, floor, lineOfSight };
}
// (team A behind the wall; team B, the base of fire, off its end on the right, with the enemy in sight)
const team = (z = 10) => [['CMD', -1.5], ['R1', -0.5], ['MG', 7], ['R2', 8]].map(([r, x]) => ({ p: [x, 0, z], yaw: Math.PI, squad: r, unit: 'Alpha', health: 100, mag: 30, mags: 5 }));
function squad(boxes, members, o = {}) {
  const { solid, floor, lineOfSight } = range(boxes);
  const log = [];
  const sq = new SquadAI({
    unit: 'Alpha', members: () => members, solid, lineOfSight, seed: 5,
    floor: (x, z, who) => floor(x, z, (who ? who.p[1] : 0) + 1.2) ?? 0,
    bounds: [-16, -16, 16, 16], threat: [0, 0, -10], hostiles: () => [{ p: [0, 0, -10] }],
    radio: (m, text) => log.push(text),
    ...o,
  });
  return { sq, log };
}
// a wall in front of the team (they are behind it) and a long one down the left side: a covered way round on the left
const LEFT = [[-6, 7.8, 6, 8.2, 2], [-7, -9, -6, 8.2, 2]];

test('a covered way round and the enemy fixed: suppress and flank; the flankers\' route keeps out of its sight', () => {
  const ms = team();
  const { sq } = squad(LEFT, ms);
  for (let t = 0; t < 0.2; t += 0.05) sq.step(0.05); // (they see it)
  sq.rebuildNav();
  const a = assess(sq);
  assert.ok(a.flanks[1].ok && a.flanks[1].expo < 0.3, `left flank covered (${a.flanks[1].expo.toFixed(2)})`);
  assert.ok(a.flanks[-1].expo > a.flanks[1].expo + 0.3, `right flank in the open (${a.flanks[-1].expo.toFixed(2)})`);
  const s = choose(sq, a);
  assert.equal(s.kind, 'suppressFlank');
  assert.equal(s.side, 1, 'by the left');
  // the route it plans keeps out of sight; a straight one would not
  const from = ms[0].p;
  const planned = a.flanks[1].pts;
  assert.ok(exposure(sq, sq.threat, from, planned) < 0.3);
  assert.ok(exposure(sq, sq.threat, from, [a.flanks[1].to]) > 0.5, 'the straight way is in its sight');
  assert.ok(STRATEGIES[s.kind]);
});

test('the flank plays out: the call, team B suppresses, team A goes round, then assaults', () => {
  const ms = team();
  const { sq, log } = squad(LEFT, ms);
  const B = ms.filter((m) => m.squad === 'MG' || m.squad === 'R2');
  const seen = [];
  let shots = 0;
  sq.host.fire = (m) => (B.includes(m) ? shots++ : 0);
  for (let t = 0; t < 70 && sq.strategy?.phase !== 'done'; t += 0.05) {
    sq.step(0.05);
    if (sq.strategy && seen[seen.length - 1] !== sq.strategy.phase) seen.push(sq.strategy.phase);
  }
  assert.equal(sq.strategy?.kind, 'suppressFlank');
  assert.deepEqual(seen, ['move', 'assault', 'done']);
  assert.ok(log.some((l) => /team B base of fire, suppress; team A, flank left/.test(l)), log.join(' | '));
  assert.ok(log.findIndex((l) => /in position, assaulting/.test(l)) > log.findIndex((l) => /flank left/.test(l)), 'the assault after the flank');
  assert.ok(shots > 10, `team B kept firing (${shots} rounds)`);
  const A = ms.filter((m) => m.squad === 'CMD' || m.squad === 'R1');
  assert.ok(A.some((m) => Math.hypot(m.p[0], m.p[2] + 10) < 5), 'team A on the objective');
  // where team A went: round the left, behind the wall
  assert.ok(A.every((m) => m.track.some(([x, z]) => x < -7 && z < 0)), 'by the covered way');
});

test('outmatched: break contact; deterministic for a seed', () => {
  const ms = team();
  const foes = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ p: [-4 + i, 0, -10] }));
  const { sq, log } = squad([], ms, { hostiles: () => foes });
  for (let t = 0; t < 2; t += 0.05) sq.step(0.05);
  assert.equal(sq.strategy?.kind, 'withdraw', sq.strategy?.kind);
  assert.ok(log.some((l) => /break contact, outnumbered, fall back/.test(l)), log.join(' | '));
  // the first team runs back, away from them
  for (let t = 0; t < 9; t += 0.05) sq.step(0.05);
  const A = ms.filter((m) => m.squad === 'CMD' || m.squad === 'R1');
  assert.ok(A.every((m) => m.p[2] > 13), `back (${A.map((m) => m.p[2].toFixed(1))})`);
  // the same seed, the same choices
  const run = () => {
    const m2 = team();
    const { sq: s2 } = squad(LEFT, m2);
    for (let t = 0; t < 8; t += 0.05) s2.step(0.05);
    return JSON.stringify([s2.strategy?.kind, s2.strategy?.side, m2.map((m) => m.p.map((v) => v.toFixed(2)))]);
  };
  assert.equal(run(), run());
});

test('open ground, no way round: bounding overwatch as before; two men down: hold and defend', () => {
  const ms = team();
  const { sq } = squad([], ms);
  sq.rebuildNav();
  assert.equal(choose(sq, assess(sq)).kind, 'bound');
  ms[2].dead = true;
  ms[3].health = 20;
  assert.equal(choose(sq, assess(sq)).kind, 'defend', 'two of four out: hold in cover');
  ms[1].health = 20;
  assert.equal(choose(sq, assess(sq)).kind, 'withdraw', 'one man left standing: break contact');
});
