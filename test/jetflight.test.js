import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FlightAI, FORMATION_KEYS, slotOffset, slotPoint, elementsOf } from '../src/ai/flight.js';
import { JetDamage, jetImpact } from '../src/sim/jetDamage.js';
import { MODELS } from '../src/models/index.js';

/** The worst distance of a member from its slot. */
function slotError(ai) {
  const al = ai.ranked();
  const L = al[0];
  return Math.max(0, ...al.slice(1).map((m, r) => {
    const S = slotPoint(L.p, L.h, slotOffset(ai.formation, r + 1, ai.spacing));
    return Math.hypot(S[0] - m.p[0], S[1] - m.p[1], S[2] - m.p[2]);
  }));
}
function run(ai, s, dt = 0.05) {
  for (let t = 0; t < s; t += dt) ai.step(dt);
}
function flight(extra = {}) {
  const log = [];
  const ai = new FlightAI({ p: [0, 0, 0], count: 4, speed: 80, altitude: 150, target: [1500, 0, 300], auto: false, seed: 3, radio: (m, text, kind) => log.push({ who: m.call, text, kind }), ...extra });
  return { ai, log };
}

test('slots: every formation puts each rank in its own place behind or beside the leader', () => {
  for (const f of FORMATION_KEYS) {
    const pts = [0, 1, 2, 3, 4, 5, 6, 7].map((r) => slotOffset(f, r, 30));
    assert.deepEqual(pts[0], [0, 0, 0]);
    for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) assert.ok(Math.hypot(pts[a][0] - pts[b][0], pts[a][2] - pts[b][2]) > 20, `${f}: ${a} and ${b} apart`);
    for (const p of pts) assert.ok(p[0] <= 0, `${f}: nobody ahead of the lead`);
  }
  assert.ok(slotOffset('echelonRight', 2, 30)[2] > 0 && slotOffset('echelonLeft', 2, 30)[2] < 0);
  assert.deepEqual(elementsOf(4), [[0, 1], [2, 3]]);
  assert.deepEqual(elementsOf(2), [[0], [1]]);
  assert.deepEqual(elementsOf(5), [[0, 1], [2, 3], [4]]);
});

test('form up: scattered jets converge on their slots and hold them in the turn', () => {
  const { ai, log } = flight();
  ai.scatter();
  const e0 = slotError(ai);
  assert.ok(e0 > 60, 'scattered');
  ai.order('formUp');
  run(ai, 60);
  assert.equal(ai.mode, 'orbit', 'joined up, holding');
  assert.ok(slotError(ai) < 8, `in their slots (${slotError(ai).toFixed(1)} m)`);
  // and they stay there round the orbit, and change formation on the leader's call
  ai.order('formation', { formation: 'echelonRight' });
  run(ai, 60);
  assert.equal(ai.formation, 'echelonRight');
  assert.ok(slotError(ai) < 8);
  // they fly like jets: banked no more than allowed, at sensible speeds
  for (const m of ai.members) assert.ok(Math.abs(m.bank) <= ai.bankMax + 0.01 && m.v >= 0.59 * ai.cruise && m.v <= 1.46 * ai.cruise);
  assert.ok(log.some((l) => /form up on me/.test(l.text)) && log.some((l) => l.text === 'Two, copy'), 'the leader calls, the wingman answers');
});

test('flank: the elements split to bracket the target from both sides, fire, and rejoin', () => {
  let impacts = 0;
  const { ai, log } = flight({ impact: () => impacts++ });
  run(ai, 5);
  assert.ok(ai.order('flank'));
  const els = ai.elements;
  assert.equal(els.length, 2);
  assert.deepEqual(els.map((e) => e.ids.map((m) => m.i)), [[0, 1], [2, 3]]);
  let maxApart = 0;
  let both = false;
  for (let t = 0; t < 300 && ai.mode === 'flank'; t += 0.05) {
    ai.step(0.05);
    if (ai.elements) {
      const [a, b] = ai.elements.map((e) => e.ids[0]);
      maxApart = Math.max(maxApart, Math.hypot(a.p[0] - b.p[0], a.p[2] - b.p[2]));
      both ||= ai.elements.every((e) => e.phase === 'in');
    }
  }
  assert.ok(maxApart > 3 * ai.R, `the elements split (${maxApart.toFixed(0)} m apart)`);
  assert.ok(both, 'both in at once');
  assert.ok(ai.members.every((m) => m.rockets < 4), 'every jet fired');
  assert.ok(impacts >= 8, 'rockets came down');
  assert.equal(ai.mode, 'join');
  run(ai, 150);
  assert.equal(ai.mode, 'orbit');
  assert.ok(slotError(ai) < 8, 'back in formation');
  assert.ok(log.some((l) => /in, in, now/.test(l.text)) && log.some((l) => /rejoin on me/.test(l.text)));
});

test('leader loss: the next jet takes the lead and the flight forms up on him', () => {
  const { ai, log } = flight();
  run(ai, 5);
  ai.hit(0, 'wingL', 400); // a wing shot off: critical
  assert.equal(ai.members[0].alive, false);
  run(ai, 3);
  assert.equal(ai.lead, 1, 'Two has the lead');
  assert.ok(log.some((l) => /Viper 2 has the lead/.test(l.text)));
  run(ai, 90);
  assert.equal(ai.ranked().length, 3);
  assert.equal(ai.mode, 'orbit');
  assert.ok(slotError(ai) < 8);
  assert.ok(ai.members[0].gone, 'the old lead came down');
});

test('determinism: the same seed flies the same, every order', () => {
  const go = () => {
    const { ai } = flight({ auto: true, holdTime: 8 });
    ai.scatter();
    run(ai, 200);
    ai.hit(2, 'engines', 60);
    run(ai, 60);
    return JSON.stringify(ai.snapshot());
  };
  assert.equal(go(), go());
});

test('the leader runs his own programme when the AI is on', () => {
  const { ai, log } = flight({ auto: true, holdTime: 5 });
  run(ai, 400);
  const said = log.map((l) => l.text).join('\n');
  assert.match(said, /go /);
  assert.match(said, /split/);
});

test('jet damage: hit → burning → critical → falling → crashed', () => {
  const d = new JetDamage();
  assert.equal(d.state, 'ok');
  const r = d.hit('engines', 60); // 0.75 of the engines
  assert.ok(r.fire, 'the engines catch fire');
  assert.equal(d.state, 'burning');
  let t = 0;
  for (; t < 60 && d.state === 'burning'; t += 0.1) d.step(0.1);
  assert.equal(d.state, 'falling', 'the fire made it critical');
  assert.equal(d.cause, 'engines');
  assert.ok(t > 2, 'not at once');
  assert.equal(d.control().thrust, 0);
  assert.ok(d.emitters().some((e) => e.k === 'engines' && e.fire > 0), 'flames from the engines');
  const imp = d.impact(false);
  assert.equal(d.state, 'crashed');
  assert.ok(imp.energy > 3e6);
  // a wing torn off: at once, and a spin towards it
  const w = new JetDamage();
  w.hit('wingR', 400);
  assert.equal(w.state, 'falling');
  assert.ok(w.control().roll > 2);
  // a few bullets: damaged, nothing worse
  const b = new JetDamage();
  b.hit('tail', 25);
  assert.equal(b.state, 'damaged');
  // a blast near the tail hurts the tail most
  const c = new JetDamage();
  c.blast([-6, 3, 0], 3);
  assert.ok((c.dmg.tail ?? 0) > (c.dmg.cockpit ?? 0));
});

test('impact: the blast, the crater and the fire go into the simulation (on water a slick)', () => {
  const calls = [];
  const sim = { world: { events: [], time: 0 }, ignite: (p, r) => calls.push(['ignite', r]), addTorch: (p, pw, dur) => calls.push(['torch', dur]) };
  const boom = (s, p, E, o) => calls.push(['explode', E, o.name]);
  const r = jetImpact(sim, [10, 1, 10], { energy: 1e7, fuel: 1, explodeFn: boom });
  assert.deepEqual(r, { blast: true, fire: true, slick: false });
  assert.deepEqual(calls[0], ['explode', 1e7, 'jet crash']);
  assert.ok(calls.some((c) => c[0] === 'ignite') && calls.some((c) => c[0] === 'torch' && c[1] > 20), 'the fuel left burning');
  assert.equal(sim.world.events[0].type, 'jetCrash');
  calls.length = 0;
  const w = jetImpact(sim, [10, 0, 10], { energy: 1e7, fuel: 1, water: true, explodeFn: boom });
  assert.ok(w.slick && !w.fire);
  assert.ok(calls.some((c) => c[0] === 'torch' && c[1] <= 10), 'a short burning slick');
  assert.ok(!calls.some((c) => c[0] === 'ignite'));
});

test('a flight member hit: the wingmen call it, the flight breaks, it goes down and the crash is reported', () => {
  const crashes = [];
  const { ai, log } = flight({ crash: (m, p, info) => crashes.push({ m: m.i, p, info }) });
  run(ai, 5);
  ai.hit(2, 'engines', 60);
  assert.equal(ai.mode, 'break', 'the leader breaks the flight');
  run(ai, 120);
  assert.ok(log.some((l) => /Three's hit/.test(l.text)));
  assert.equal(ai.members[2].alive, false);
  assert.equal(crashes.length, 1);
  assert.equal(crashes[0].m, 2);
  assert.ok(crashes[0].info.energy > 0);
  assert.equal(ai.members[2].dmg.state, 'crashed');
});

test('the scene model: a jetFlight object builds a flight record', () => {
  const M = MODELS.jetFlight;
  const p = Object.fromEntries(Object.entries(M.params).map(([k, s]) => [k, s.value]));
  const b = M.build(p);
  assert.equal(b.flights.length, 1);
  assert.equal(b.flights[0].count, 4);
  assert.deepEqual(b.flights[0].target, [p.targetX, 0, p.targetZ]);
});

test('in the simulation: a flight flies in the world and a jet crashing inside it leaves a blast and a fire', async () => {
  const { createSimulation } = await import('../src/sim/createSimulation.js');
  const sim = createSimulation({
    world: { size: [40, 6, 40], h: 0.25, ground: 'soil' },
    objects: [{ type: 'jetFlight', params: { count: 2, altitude: 60, speed: 40, orbitRadius: 150, auto: false }, x: 20, z: 20 }],
    noFire: true,
  });
  const w = sim.world;
  assert.equal(w.flights.length, 1);
  for (let k = 0; k < 20; k++) sim.step(sim.dt);
  const ai = w.flights[0].ai;
  assert.ok(ai && ai.members.length === 2);
  assert.ok(ai.members.every((m) => m.p[1] > 40), 'airborne');
  // the second one, out of control right over the world: it comes down in it
  const m = ai.members[1];
  m.p = [8, 12, 20];
  m.h = 0;
  m.v = 12;
  ai.hit(1, 'fuel', 400);
  for (let k = 0; k < 2000 && !m.gone; k++) sim.step(sim.dt);
  assert.ok(m.gone, 'it came down');
  assert.ok(m.p[0] > 0 && m.p[0] < 40, 'inside the world');
  assert.ok(w.events.some((e) => e.type === 'jetCrash' && !e.far), 'the crash is an event');
  assert.ok(w.events.some((e) => e.name === 'jet crash'), 'the blast');
  assert.ok(w.events.some((e) => e.type === 'flightRadio' && /going down/.test(e.name)), 'called on the radio');
  assert.ok(w.heaters.some((h) => h.temporary), 'the fuel burns on');
});

test('ejection envelope: out only with time for it', async () => {
  const { ejectionEnvelope } = await import('../src/sim/ejection.js');
  assert.ok(ejectionEnvelope({ height: 200, sink: 10 }).ok, 'high up: out');
  assert.ok(ejectionEnvelope({ height: 0, sink: 0 }).ok === false && ejectionEnvelope({ height: 3, sink: 0 }).ok, 'zero-zero: level and slow, just off the ground');
  assert.equal(ejectionEnvelope({ height: 40, sink: 40 }).ok, false, 'sinking fast, low: no');
  assert.equal(ejectionEnvelope({ height: 50, sink: 5, roll: Math.PI }).ok, false, 'inverted, low: the seat would fire him into the ground');
  assert.ok(ejectionEnvelope({ height: 200, sink: 5, roll: Math.PI }).ok, 'inverted but high: out');
  assert.equal(ejectionEnvelope({ height: 500, cockpit: 1 }).ok, false, 'the cockpit destroyed: the pilot is hit');
});

test('the parachute: seat, separation, canopy; ~5 m/s down, toggles turn it, a flare slows it, PLF or splashdown', async () => {
  const { Chute, CANOPY } = await import('../src/sim/ejection.js');
  const ground = () => ({ y: 0, water: false });
  const c = new Chute({ p: [0, 300, 0], v: [80, 0, 0], heading: 0 });
  const seen = [];
  for (let t = 0; t < 12; t += 0.05) seen.push(...c.step(0.05, {}, [0, 0], ground));
  assert.deepEqual(seen.slice(0, 2), ['separate', 'open']);
  assert.equal(c.phase, 'open');
  assert.ok(Math.abs(-c.v[1] - CANOPY.sink) < 0.3, `steady sink (${(-c.v[1]).toFixed(2)} m/s)`);
  assert.ok(c.p[1] > 250, 'the seat took him up first');
  // a toggle: it turns; both: the sink slows
  const h0 = c.heading;
  for (let t = 0; t < 2; t += 0.05) c.step(0.05, { left: true }, [0, 0], ground);
  assert.ok(c.heading - h0 > 1.5, 'left toggle: turns left');
  assert.equal(c.pose(), 'steerLeft');
  for (let t = 0; t < 1.5; t += 0.05) c.step(0.05, { flare: true }, [0, 0], ground);
  assert.ok(-c.v[1] < 3, 'flared: sinks slower');
  assert.equal(c.pose(), 'flare');
  // wind drifts it
  const x0 = c.p[0];
  for (let t = 0; t < 5; t += 0.05) c.step(0.05, {}, [6, 0], ground);
  assert.ok(c.p[0] - x0 > 10, 'drifts downwind');
  // down without a flare: a parachute landing fall, then on his feet
  const ev = [];
  for (let t = 0; t < 120 && c.phase !== 'landed'; t += 0.05) ev.push(...c.step(0.05, {}, [0, 0], ground));
  assert.ok(ev.includes('plf') && ev.includes('land'));
  assert.equal(c.pose(), 'stand');
  // over water: splashdown, afloat
  const w = new Chute({ p: [0, 20, 0], heading: 0 });
  Object.assign(w, { phase: 'open', inflate: 1 });
  const ev2 = [];
  for (let t = 0; t < 20; t += 0.05) ev2.push(...w.step(0.05, {}, [0, 0], () => ({ y: 0, water: true })));
  assert.ok(ev2.includes('splashdown'));
  assert.equal(w.pose(), 'float');
});

test('a flight pilot ejects when he can, comes down under his canopy and walks off (evading); too low he rides it in', () => {
  const { ai, log } = flight({ water: () => false });
  run(ai, 5);
  ai.hit(1, 'wingR', 400);
  assert.ok(ai.members[1].pilot, 'out');
  run(ai, 120);
  const P = ai.pilots[0];
  assert.ok(P.chute.events.includes('open'));
  assert.ok(['evade', 'hide'].includes(P.state), `on the ground, evading (${P.state})`);
  assert.ok(log.some((l) => /good chute/.test(l.text)) && log.some((l) => /on the ground, evading/.test(l.text)));
  // a jet low and inverted: no ejection
  const { ai: b, log: lb } = flight();
  run(b, 5);
  const m = b.members[2];
  m.p[1] = b.ground + 20;
  m.bank = Math.PI;
  b.hit(2, 'wingL', 400);
  assert.ok(!m.pilot && m.noEject, 'no seat: ' + m.noEject);
  run(b, 3);
  assert.ok(lb.some((l) => /no chute/.test(l.text)));
});
