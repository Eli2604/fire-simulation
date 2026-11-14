import { test } from 'node:test';
import assert from 'node:assert/strict';
import { impact, computeImpact, actImpactArgs, KNOCK, shakeAt, bodyLanding, ACT_FORCE, actForce } from '../src/sim/impact.js';
import { ACT_IMPACTS, impactsOf, declareImpacts, BODY_MASS } from '../src/rig/objects.js';
import { mechanics, MECHANICS_NAMES } from '../src/sim/materials.js';
import { createDragonStage } from '../src/rig/dragonStage.js';
import { jetImpact } from '../src/sim/jetDamage.js';

const man = (p = [1, 0, 0]) => ({ p: p.slice(), health: 100, state: 'patrol', yaw: 0 });
const kick = (scale = 1, v = 11) => computeImpact({ ...actImpactArgs({ part: 'footR', target: 'opponent', v, zone: 'torso' }, { scale, target: man() }) });

test('every material has mechanical properties (stiffness, damping, hardness), voxel or not', () => {
  for (const n of MECHANICS_NAMES) {
    const M = mechanics(n);
    assert.ok(M.E > 0 && M.density > 0 && M.eta > 0 && M.hardness > 0, n);
  }
  assert.ok(mechanics('steel').eta < mechanics('wood').eta && mechanics('wood').eta < mechanics('flesh').eta, 'steel rings longest, flesh not at all');
  assert.ok(mechanics('glass').brittle && !mechanics('steel').brittle);
});

test('the force scales with the contact speed and with the Force × parameter', () => {
  const a = kick(1, 6), b = kick(1, 11);
  assert.ok(b.impulse > a.impulse * 1.7 && b.force > a.force * 1.7 && b.energy > a.energy * 3, 'faster: more impulse, force, energy');
  const x1 = kick(1), x2 = kick(2);
  assert.ok(Math.abs(x2.impulse / x1.impulse - 2) < 1e-9, 'Force ×2: twice the impulse');
  assert.ok(Math.abs(x2.energy / x1.energy - 4) < 1e-9, 'and four times the energy');
  assert.ok(x2.force > 1.9 * x1.force, `and about twice the force (${x1.force.toFixed(0)} → ${x2.force.toFixed(0)} N)`);
  // the object's and the act's Force × multiply (the rig stage's sliders)
  ACT_FORCE['soldier:kick'] = 1.5;
  ACT_FORCE.soldier = 2;
  assert.equal(actForce('soldier', 'kick'), 3);
  delete ACT_FORCE['soldier:kick'];
  delete ACT_FORCE.soldier;
  // and a source's own (a scene object's param: models/*.js force)
  const s = computeImpact({ mass: 10, velocity: 5, materials: ['flesh', 'flesh'], source: { forceScale: 2 } });
  const s1 = computeImpact({ mass: 10, velocity: 5, materials: ['flesh', 'flesh'] });
  assert.ok(Math.abs(s.impulse / s1.impulse - 2) < 1e-9);
  // the readout's numbers are consistent: F = J / contact time, E = ½ μ v²
  assert.ok(Math.abs(b.force - b.impulse / b.contactTime) < 1e-6);
  assert.ok(Math.abs(b.energy - 0.5 * b.mu * b.speed ** 2) < 1e-6);
});

test('damage and knock-down thresholds: a punch hurts a little, a kick staggers, a hard kick knocks down', () => {
  const punch = computeImpact(actImpactArgs({ part: 'fist', target: 'opponent', v: 8, zone: 'torso' }, { target: man() }));
  const k1 = kick(1), k2 = kick(1.6);
  assert.equal(punch.knock, 'none');
  assert.equal(k1.knock, 'stagger');
  assert.equal(k2.knock, 'knockdown');
  assert.ok(k1.dv >= KNOCK.stagger && k1.dv < KNOCK.knockdown && k2.dv >= KNOCK.knockdown);
  assert.ok(punch.damage > 0 && punch.damage < k1.damage && k1.damage < k2.damage, `${punch.damage.toFixed(1)} < ${k1.damage.toFixed(1)} < ${k2.damage.toFixed(1)} HP`);
  const head = computeImpact(actImpactArgs({ part: 'footR', target: 'opponent', v: 11, zone: 'head' }, { target: man() }));
  assert.ok(head.damage > 2 * k1.damage, 'to the head: much worse');
  // applied: the target is hurt and staggers / goes down (stunned for a while)
  const w = { time: 10, events: [], enemies: [] };
  const e = man();
  w.enemies.push(e);
  impact(w, { ...actImpactArgs({ part: 'footR', target: 'opponent', v: 11 }, { target: e, scale: 1.6 }) });
  assert.ok(e.health < 100 && e.knockedDown > 12 && e.stunnedUntil > 12, 'knocked down');
  assert.ok(w.events.some((x) => x.type === 'impact') && w.events.some((x) => x.type === 'knockdown'));
  // a landing on your feet from a ledge does not hurt; from high up it does; a roll spreads it
  const drop = (h, roll) => computeImpact({ mass: 85, velocity: [0, -Math.sqrt(2 * 9.81 * h), 0], normal: [0, 1, 0], materials: ['flesh', 'soil'], kind: 'landing', contactTime: roll ? 0.35 : 0.09 });
  assert.equal(drop(1.4).damage, 0);
  assert.ok(drop(4).damage > 0 && drop(4, true).damage < drop(4).damage);
  assert.ok(drop(4, true).force < drop(4).force / 2, 'a roll: far less force');
});

test('a dragon landing makes a shockwave: a soldier near it staggers, one far off does not', () => {
  const st = createDragonStage();
  const w = st.world;
  const d = st.dragon;
  const near = { p: [d.p[0] + 4, 0.4, d.p[2]], health: 100, state: 'patrol' };
  const far = { p: [d.p[0] + 30, 0.4, d.p[2]], health: 100, state: 'patrol' };
  w.enemies.push(near, far);
  const n0 = w.events.length;
  const r = st.ai.impactOf(d, w, 'landing', [3, -6, 0]);
  assert.ok(r.energy > 3e4, `its weight: ${r.energy.toFixed(0)} J`);
  assert.ok(r.shock && r.shock.radius > 5 && r.shock.radius < 25, `shockwave ${r.shock?.radius.toFixed(1)} m`);
  assert.ok(near.stunnedUntil > w.time && (near.staggered > w.time || near.knockedDown > w.time), 'the near one staggers');
  assert.equal(far.stunnedUntil, undefined, 'the far one does not');
  const ev = w.events.slice(n0);
  assert.ok(ev.some((e) => e.type === 'shockwave') && ev.some((e) => e.type === 'impact' && e.materials[0] === 'scales' && e.db > 130));
  assert.ok(w.debris.some((x) => x.dust), 'a ring of dust kicked up');
  assert.ok(shakeAt(ev.find((e) => e.type === 'shockwave'), 3) > shakeAt(ev.find((e) => e.type === 'shockwave'), 30), 'the camera shakes more near it');
  // and the real thing: flown, then landed, by the simulation's own code
  w.enemies.length = 0;
  const run = (name, secs) => {
    st.play(name);
    for (let t = 0; t < secs && !(name === 'land' && st.dragon.mode === 'ground'); t += 1 / 30) st.step(1 / 30);
  };
  run('takeoff', 5);
  const n1 = w.events.length;
  run('land', 20);
  assert.equal(st.dragon.mode, 'ground');
  const land = w.events.slice(n1).find((e) => e.type === 'impact' && e.kind === 'landing');
  assert.ok(land && land.energy > 1e4, `its landing is an impact (${land?.energy.toFixed(0)} J)`);
});

test('wired: a jet crash, a body landing, an act declares its contacts', () => {
  const w = { time: 0, events: [], enemies: [man([20, 0, 10])], noises: [] };
  jetImpact({ world: w }, [10, 0, 10], { energy: 1e7, fuel: 0, explodeFn: () => {} });
  const ji = w.events.find((e) => e.type === 'impact');
  assert.ok(ji && ji.kind === 'crash' && ji.materials[0] === 'aluminium' && ji.shock > 20, 'the wreck hits: a big shockwave');
  assert.ok(w.enemies[0].knockedDown > 0, '10 m away: knocked down');
  const w2 = { time: 0, events: [] };
  assert.equal(bodyLanding(w2, man(), { height: 0.1 }), null, 'a step is no landing');
  assert.ok(bodyLanding(w2, man(), { height: 2 }).event.kind === 'landing');
  // every act's keyframe is well formed
  for (const [kind, acts] of Object.entries(ACT_IMPACTS))
    for (const [act, list] of Object.entries(acts))
      for (const k of list) {
        assert.ok(k.part && k.target, `${kind}.${act}`);
        assert.ok(k.sim || k.trigger || (k.t >= 0 && k.t <= 1), `${kind}.${act}: a time in the act`);
        assert.ok(k.sim || k.trigger || k.v > 0 || k.fromHeight, `${kind}.${act}: a speed`);
      }
  assert.ok(BODY_MASS.dragon > BODY_MASS.soldier);
  declareImpacts('soldier', 'testKick', [{ t: 0.5, part: 'footL', target: 'opponent', v: 9 }]);
  assert.equal(impactsOf('squad', 'testKick')[0].part, 'footL');
  delete ACT_IMPACTS.soldier.testKick;
});
