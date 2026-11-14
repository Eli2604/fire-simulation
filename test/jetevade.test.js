import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FlightAI, EVADES, FLARE_DECOY } from '../src/ai/flight.js';
import { VEHICLE_ACTS } from '../src/rig/objects.js';

function flight(extra = {}) {
  const log = [];
  const ai = new FlightAI({ p: [0, 0, 0], count: 4, speed: 80, altitude: 150, auto: false, seed: 3, radio: (m, text, kind) => log.push({ who: m.call, text, kind }), ...extra });
  return { ai, log };
}
const run = (ai, s, dt = 0.05, each) => {
  for (let t = 0; t < s; t += dt) {
    ai.step(dt);
    each?.();
  }
};
/** A point d m behind member m (and a little below). */
const behind = (m, d) => [m.p[0] - Math.cos(m.h) * d, m.p[1] - 60, m.p[2] + Math.sin(m.h) * d];

test('a missile from behind: the wingman calls the break, the jet defends with flares, then rejoins', () => {
  const { ai, log } = flight();
  run(ai, 5);
  const m = ai.members[1];
  const h0 = m.h;
  const M = ai.launchMissile(behind(m, 1400), 1);
  let kind = null, flares = 0, maxBank = 0;
  run(ai, 30, 0.05, () => {
    if (m.evade) kind = m.evade.kind;
    flares = Math.max(flares, ai.flares.length);
    maxBank = Math.max(maxBank, Math.abs(m.bank));
  });
  assert.ok(['beam', 'barrelRoll'].includes(kind), kind);
  assert.ok(log.some((l) => l.who !== m.call && /Two, break (left|right)! Missile, \d+ o'clock/.test(l.text)), log.map((l) => l.text).join(' | '));
  assert.ok(log.some((l) => l.who === m.call && /flares/.test(l.text)));
  assert.ok(flares >= 2, 'flares out');
  assert.ok(m.flares < 30);
  assert.ok(maxBank > 1, 'it pulled hard');
  assert.ok(M.done && !M.hit, 'the missile did not get it');
  assert.equal(m.hp, 1);
  // rejoined: no manoeuvre on, the flight joined up again in formation
  assert.ok(!m.evade);
  assert.ok(log.some((l) => l.who === m.call && /rejoining/.test(l.text)));
  assert.equal(ai.mode, 'orbit');
  void h0;
});

test('flares decoy a tracking missile with the seeded probability (FLARE_DECOY a salvo)', () => {
  const outcome = (seed) => {
    const { ai } = flight({ seed, flares: 2 }); // one salvo only
    run(ai, 3);
    const m = ai.members[2];
    const M = ai.launchMissile(behind(m, 900), 2);
    run(ai, 15);
    return { decoyed: M.decoyedBy === 2, hit: !!M.hit };
  };
  const n = 60;
  const res = Array.from({ length: n }, (_, k) => outcome(k + 1));
  const rate = res.filter((r) => r.decoyed).length / n;
  assert.ok(Math.abs(rate - FLARE_DECOY) < 0.17, `decoyed ${Math.round(rate * 100)} % (want about ${FLARE_DECOY * 100} %)`);
  // the ones not decoyed: some still slip it by manoeuvring, the rest are hit
  assert.ok(res.some((r) => !r.decoyed && r.hit), 'some are hit');
  assert.ok(res.every((r) => !(r.decoyed && r.hit)), 'a decoyed one does not hit');
  // the same seed: the same outcome
  assert.deepEqual(outcome(7), outcome(7));
  assert.deepEqual(outcome(8), outcome(8));
});

test('evading lowers the chance of being hit (by its manoeuvre); flying straight it is 1', () => {
  const { ai } = flight();
  run(ai, 2);
  assert.equal(ai.hitChance(1), 1);
  const m = ai.members[1];
  ai.startEvade(m, { kind: 'missile', p: behind(m, 500) }, 2, 'barrelRoll');
  run(ai, 0.6);
  assert.ok(Math.abs(ai.hitChance(1) - EVADES.barrelRoll.hit) < 1e-9);
  let hits = 0;
  for (let k = 0; k < 400; k++) hits += ai.rollHit(1) ? 1 : 0;
  assert.ok(hits / 400 < 0.4 && hits / 400 > 0.2, `hit ${hits} of 400 rolling`);
  for (let k = 0; k < 50; k++) assert.ok(ai.rollHit(0), 'the lead flying straight is always hit');
  for (const e of Object.values(EVADES)) assert.ok(e.hit < 1 && e.hit > 0);
});

test('a rocket from the side: a hard break turn into it; guns: jinking; a dragon: down out of its way', () => {
  const { ai, log } = flight();
  run(ai, 3);
  const m = ai.members[0];
  const h0 = m.h;
  const rt = [Math.sin(m.h), 0, Math.cos(m.h)];
  // 300 m out on its right, 150 m/s, aimed to meet it
  const fw = [Math.cos(m.h), 0, -Math.sin(m.h)], tm = 300 / Math.sqrt(150 ** 2 - m.v ** 2);
  const p = [m.p[0] + rt[0] * 300, m.p[1], m.p[2] + rt[2] * 300];
  ai.warn({ kind: 'rocket', p, v: [0, 1, 2].map((k) => (fw[k] * m.v * tm - rt[k] * 300) / tm) });
  ai.step(0.05);
  assert.equal(m.evade?.kind, 'breakTurn');
  assert.ok(log.some((l) => /Lead, break right! Rocket, 3 o'clock/.test(l.text)), log.map((l) => l.text).join(' | '));
  let maxBank = 0;
  run(ai, 2.5, 0.05, () => (maxBank = Math.max(maxBank, m.bank)));
  assert.ok(maxBank > 1.3, `hard over (${maxBank.toFixed(2)})`);
  // turned right, towards it (h decreasing is a right turn)
  const dh = Math.atan2(Math.sin(m.h - h0), Math.cos(m.h - h0));
  assert.ok(dh < -0.8, `turned into it (${dh.toFixed(2)} rad)`);
  run(ai, 10);
  assert.ok(!m.evade, 'over');
  const g = ai.members[3];
  ai.startEvade(g, { kind: 'gun', p: behind(g, 300) }, 1);
  assert.equal(g.lastEvade, 'jink');
  // a dragon coming at them (o.threats): a dive (or a split-S with height enough)
  const { ai: hi } = flight({ altitude: 900 });
  run(hi, 3);
  const L = hi.members[0]; // (the lead: out ahead, the nearest to it)
  const dp = [L.p[0] + Math.cos(L.h) * 100, L.p[1], L.p[2] - Math.sin(L.h) * 100];
  hi.o.threats = () => [{ kind: 'dragon', p: dp, v: [-Math.cos(L.h) * 20, 0, Math.sin(L.h) * 20] }];
  hi.step(0.05);
  hi.o.threats = null;
  assert.equal(L.evade?.kind, 'splitS');
  const y0 = L.p[1];
  let minG = 0;
  run(hi, 8, 0.05, () => (minG = Math.min(minG, L.gamma)));
  assert.ok(minG < -1.2 && L.p[1] < y0 - 100, `down through a half loop (${minG.toFixed(2)}, ${(y0 - L.p[1]).toFixed(0)} m lower)`);
  assert.ok(!L.evade && Math.abs(L.gamma) < 0.5, 'and out of it');
});

test('the rig has the jet evade acts', () => {
  for (const k of ['jet', 'jetFlight']) {
    assert.equal(VEHICLE_ACTS[k].evadeBreak, 'Evade: break turn');
    assert.equal(VEHICLE_ACTS[k].evadeRoll, 'Evade: barrel roll + flares');
  }
});
