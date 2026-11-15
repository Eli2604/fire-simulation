import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SquadAI } from '../src/ai/squad.js';
import { assess, choose, apply } from '../src/ai/strategy.js';
import { retreatCase, enemyStrength, strengthOf, sideOf } from '../src/ai/retreatRadio.js';

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
const ROLES = [['CMD', -2, 0], ['R1', -0.7, 0.4], ['MG', 0.7, 0.2], ['R2', 2, 0.5]];
/**
 * A team (unit, its men at `at` + the role offsets, or `pos` per role), the enemy at (0, -14);
 * all: the shared list of men (several teams), log: the radio and shouts heard, tagged by team.
 */
function team(o = {}) {
  const unit = o.unit ?? 'Alpha', at = o.at ?? [0, 0, 0];
  const { solid, floor, lineOfSight } = range(o.boxes ?? []);
  const all = o.all ?? [];
  const ms = ROLES.map(([r, x, z]) => {
    const p = o.pos?.[r] ?? [at[0] + x, 0, at[2] + z];
    return { p: p.slice(), yaw: Math.PI, squad: r, unit, health: 100, mag: 30, mags: 5, skill: 'regular' };
  });
  all.push(...ms);
  const foes = o.foes ?? [{ p: [0, 0, -14] }];
  const log = o.log ?? [];
  const sq = new SquadAI({
    unit, members: () => all, solid, lineOfSight, seed: o.seed ?? 3,
    floor: (x, z, who) => floor(x, z, (who ? who.p[1] : 0) + 1.2) ?? 0,
    bounds: o.bounds ?? [-16, -16, 16, 16], threat: o.threat === undefined ? [0, 0, -14] : o.threat, hostiles: () => foes,
    radio: (m, text, kind) => log.push(`${unit} radio: ${text}`),
    shout: (m, t) => log.push(`${unit} ${m.squad}: ${t}`),
    retreat: { order: false, rally: [0, 0, 13], ...(o.retreat ?? {}) },
    ...(o.host ?? {}),
  });
  return { sq, ms, log, foes, all };
}
const run = (sqs, t, each) => {
  for (let k = 0; k < t / 0.05; k++) {
    for (const s of sqs) s.step(0.05);
    each?.();
  }
};

test('the squad decides by itself, for each main reason, and logs why', () => {
  const three = [{ p: [-2, 0, -14] }, { p: [0, 0, -14] }, { p: [2, 0, -14] }];
  const cases = [
    ['the commander is down', { foes: three }, (ms) => (ms[0].health = 20)],
    ['heavy casualties', { foes: three }, (ms) => (ms[1].health = 30)],
    // (what they took for a man turns out the dragon; a helicopter with two men)
    ['outgunned', { foes: [{ p: [0, 0, -14] }] }, (ms, sq, foes) => (foes[0].kind = 'dragon')],
    ['outgunned', { foes: [{ p: [0, 0, -14] }, { p: [3, 0, -14] }, { p: [-3, 0, -14] }] }, (ms, sq, foes) => (foes[0].kind = 'helicopter')],
    // (one of the three works round to their right, level with them)
    ['flanked', { foes: three.map((f) => ({ p: f.p.slice() })) }, (ms, sq, foes) => (foes[2].p = [14, 0, 6])],
    ['pinned down', { foes: [0, 1, 2, 3].map((i) => ({ p: [-3 + 2 * i, 0, -14] })) }, (ms, sq) => (ms[0].lastHitT = ms[2].lastHitT = sq.time)],
    ['low on ammunition', {}, (ms) => ms.forEach((m) => ((m.mag = 2), (m.mags = m.secMag = m.secMags = 0)))],
    ['ordered', { retreat: { order: true } }, () => {}],
  ];
  for (const [why, o, hurt] of cases) {
    const { sq, ms, foes } = team(o);
    run([sq], 2);
    sq.rebuildNav();
    if (why !== 'ordered') assert.notEqual(choose(sq, assess(sq)).kind, 'retreat', `${why}: nothing wrong yet`);
    hurt(ms, sq, foes);
    const a = assess(sq);
    const s = choose(sq, a);
    assert.deepEqual(s, { kind: 'retreat', why }, `${why}: ${JSON.stringify(sq.retreatWhy?.facts)}`);
    assert.ok(sq.retreatWhy.reasons.includes(why) && sq.retreatWhy.text.length > why.length - 1);
    apply(sq, s, a);
    assert.ok(sq.retreatLog.some((l) => l.startsWith(`retreat:decide:${why}`)), sq.retreatLog.join(' | '));
  }
  // the strengths: a helicopter, the dragon count for several men
  assert.ok(strengthOf({ kind: 'dragon' }) > strengthOf({ kind: 'helicopter' }) && strengthOf({ kind: 'helicopter' }) > strengthOf({}));
  // 'no retreat': none of it
  const { sq, ms } = team({ foes: three, retreat: { auto: false } });
  run([sq], 2);
  ms[1].health = 30;
  assert.equal(retreatCase(sq, assess(sq), { order: false, auto: false }), null);
  assert.ok(enemyStrength(sq).strength >= 3);
});

test('the word goes round: shouted and signalled, each man acknowledges, and no man moves before he has it', () => {
  const { sq, ms, log } = team({ retreat: { order: true }, host: { din: () => 65 } });
  // (where each man was when the leader decided: what he does before that is the fight's)
  let start = null;
  const moved = new Map();
  run([sq], 40, () => {
    if (!sq.strategy?.word) return;
    start ??= new Map(ms.map((m) => [m, m.p.slice()]));
    for (const m of ms) if (!moved.has(m) && Math.hypot(m.p[0] - start.get(m)[0], m.p[2] - start.get(m)[2]) > 0.4) moved.set(m, sq.time);
  });
  const W = sq.strategy.word;
  assert.ok(log.some((l) => /CMD: Fall back! Fall back to the rally point!/.test(l)), log.join(' | '));
  assert.equal(W.mode, 'voice');
  for (const m of ms) {
    const g = W.men.get(m);
    assert.ok(g.how, `${m.squad} has the word`);
    assert.ok(g.ack != null && g.ack >= g.t, `${m.squad} acknowledged`);
    assert.ok(moved.has(m), `${m.squad} fell back`);
    assert.ok(moved.get(m) >= g.t, `${m.squad} moved at ${moved.get(m)} only after the word at ${g.t}`);
    if (m.squad !== 'CMD') {
      assert.ok(['heard', 'seen', 'relayed'].includes(g.how), g.how);
      assert.ok(g.t > W.t0 + 0.2, 'a moment to react');
      assert.ok(sq.retreatLog.includes(`retreat:ack:${m.squad}`));
    }
  }
  assert.ok(log.filter((l) => /Falling back!/.test(l)).length >= 3, 'acknowledged out loud');
  assert.ok(sq.retreatLog.some((l) => l.startsWith('retreat:word:MG:heard')), sq.retreatLog.join(' | '));
});

test('under radio silence: no shout, the hand signal, seen and passed on', () => {
  const { sq, ms, log } = team({ retreat: { order: true }, host: { din: () => 65 } });
  sq.silentUntil = 1e9;
  let signalled = false;
  run([sq], 12, () => (signalled ||= ms[0].anim === 'signalFallBack'));
  const W = sq.strategy.word;
  assert.equal(W.mode, 'silent');
  assert.ok(signalled, 'the commander gave the hand signal');
  assert.ok(!log.some((l) => /Fall back! Fall back/.test(l)), 'no shout');
  for (const m of ms.slice(1)) assert.ok(['seen', 'relayed'].includes(W.men.get(m).how), `${m.squad}: ${W.men.get(m).how}`);
  assert.ok(sq.retreatLog.some((l) => /retreat:signal:hand \(radio silence\)/.test(l)));
});

test('a man out of earshot and out of sight gets it relayed by the next man, later', () => {
  // a tall wall between the commander and rifleman two; the gunner sees both (a few seeds: the
  // glances and reaction times are the squad's own dice)
  for (const seed of [3, 7, 11]) {
    const pos = { CMD: [-2, 0, 0], R1: [-1, 0, 0.6], MG: [9, 0, 4], R2: [12, 0, 2] };
    const { sq, ms, log } = team({ seed, pos, boxes: [[8, -2, 8.4, 1.8, 3]], retreat: { order: true }, host: { din: () => 65 } });
    const R2 = ms[3];
    let start = null, movedT = null;
    run([sq], 30, () => {
      if (!sq.strategy?.word) return;
      start ??= R2.p.slice();
      if (movedT == null && Math.hypot(R2.p[0] - start[0], R2.p[2] - start[2]) > 0.4) movedT = sq.time;
    });
    const W = sq.strategy.word, g = W.men.get(R2), gMG = W.men.get(ms[2]);
    assert.equal(g.how, 'relayed', `seed ${seed}: ${g.how} (${sq.retreatLog.join(' | ')})`);
    assert.equal(g.from, ms[2], 'from the gunner');
    assert.ok(g.t > gMG.t + 0.5, 'after the gunner had it');
    assert.ok(log.some((l) => /MG: rifleman two, fall back, pass it on!/.test(l)), log.join(' | '));
    assert.ok(movedT != null && movedT >= g.t, `he stayed till then (${movedT} / ${g.t})`);
    assert.ok(g.ack != null);
  }
});

test('called in: a near friendly team moves up to cover, a far one acknowledges and holds; an enemy team hears nothing', () => {
  const all = [], log = [];
  const big = [-200, -200, 200, 200];
  const A = team({ all, log, retreat: { order: true }, host: { din: () => 65 } });
  const B = team({ all, log, unit: 'Bravo', at: [-20, 0, 2], foes: [], threat: null, bounds: big });
  const C = team({ all, log, unit: 'Charlie', at: [0, 0, 150], foes: [], threat: null, bounds: big });
  const R = team({ all, log, unit: 'Red', at: [20, 0, 2], foes: [], threat: null, bounds: big, host: { side: 'red' } });
  const sqs = [A.sq, B.sq, C.sq, R.sq];
  for (const s of sqs) s.host.peers = () => sqs;
  assert.equal(sideOf(B.sq), sideOf(A.sq));
  assert.notEqual(sideOf(R.sq), sideOf(A.sq));
  const bStart = B.ms.map((m) => m.p.slice());
  run(sqs, 16);
  const call = log.find((l) => /Alpha radio: All stations, Alpha, falling back/.test(l));
  assert.ok(call, log.join(' | '));
  assert.ok(/Enemy one man, 14 metres north/.test(call) && /Rally point \d+ metres south/.test(call) && /grid/.test(call), call);
  // Bravo, 20 m off: moves up to an overwatch, suppressive fire on them
  assert.ok(log.some((l) => /Bravo radio: Bravo, copy Alpha, moving to support/.test(l)), log.join(' | '));
  assert.equal(B.sq.retreatCalls?.[0]?.react, 'support');
  assert.ok(B.sq.supporting && B.sq.threat, 'Bravo has the threat and covers them');
  run(sqs, 20);
  const to = B.sq.supporting.to;
  const closer = B.ms.filter((m, i) => Math.hypot(m.p[0] - to[0], m.p[2] - to[2]) < Math.hypot(bStart[i][0] - to[0], bStart[i][2] - to[2]) - 3);
  assert.ok(closer.length >= 3, `Bravo moving up (${B.ms.map((m) => m.p.map((v) => v.toFixed(1)))} → ${to.map((v) => v.toFixed(1))})`);
  // Charlie, 150 m off: acknowledges, holds, notes the rally point
  assert.ok(log.some((l) => /Charlie radio: Charlie, copy Alpha, holding our position/.test(l)), log.join(' | '));
  assert.equal(C.sq.retreatCalls?.[0]?.react, 'hold');
  assert.ok(C.sq.friendRally && !C.sq.supporting);
  // the order: the call before the answers, Bravo first
  const iCall = log.indexOf(call), iB = log.findIndex((l) => /^Bravo radio: Bravo, copy Alpha/.test(l)), iC = log.findIndex((l) => /^Charlie radio: Charlie, copy Alpha/.test(l));
  assert.ok(iCall < iB && iB < iC);
  // Red: not on their side, nothing
  assert.equal(R.sq.retreatCalls, undefined);
  assert.ok(!log.some((l) => /^Red radio: .*Alpha/.test(l)), 'Red never answers Alpha');
  assert.ok(A.sq.retreatLog.includes('retreat:radio:2 friendly'), A.sq.retreatLog.join(' | '));
});

test('a team in contact whose flank the retreat leaves open falls back too', () => {
  const all = [], log = [];
  const A = team({ all, log, retreat: { order: true }, host: { din: () => 65 } });
  // Delta, 60 m along the line, as close to the enemy as Alpha's rally point, in a fight of its own
  const D = team({ all, log, unit: 'Delta', at: [60, 0, 0], foes: [], threat: [60, 0, -14], bounds: [40, -20, 80, 20] });
  const sqs = [A.sq, D.sq];
  for (const s of sqs) s.host.peers = () => sqs;
  run(sqs, 16);
  assert.equal(D.sq.retreatCalls?.[0]?.react, 'fall back', JSON.stringify(D.sq.retreatCalls?.map((c) => c.react)));
  assert.ok(log.some((l) => /Delta radio: Delta, copy Alpha, our flank is open/.test(l)), log.join(' | '));
  run(sqs, 6);
  assert.equal(D.sq.strategy?.kind, 'retreat', D.sq.strategy?.kind);
  assert.ok(D.sq.retreatLog.some((l) => l.startsWith('retreat:decide:our flank is exposed')), D.sq.retreatLog.join(' | '));
});
