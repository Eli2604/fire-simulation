// Soldiers on ropes and cables (ai/rope.js): rappelling down a wall, fast-roping down a hanging
// rope (from a helicopter), riding a zipline; falling when hit on the rope; a moving top followed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startRope, stepRopes, rappelFrom, ropePoint, RAPPEL, FAST, ZIP } from '../src/ai/rope.js';
import { createSimulation } from '../src/sim/createSimulation.js';
import { shoot } from '../src/sim/wounds.js';

/** A bare world: the ground at y 0, a roof (a block 9 m high for x < 0) and whatever else solid says. */
function world(solid = (x, y) => y < 0 || (x < 0 && y < 9)) {
  return { world: { ropes: [], enemies: [], events: [], time: 0 }, solid };
}
const soldier = (p, o = {}) => ({ p: p.slice(), yaw: 0, health: 100, squad: 'R1', unit: 'Alpha', ...o });
function run(sim, t, each) {
  const dt = 1 / 30;
  for (let k = 0; k < t / dt; k++) {
    sim.world.time += dt;
    stepRopes(sim, dt);
    each?.(sim.world.time);
  }
}

test('rappel: over the edge, down the wall in bounds at a controlled speed, standing at the bottom', () => {
  const sim = world();
  const m = soldier([-1.2, 9, 3], { yaw: Math.PI / 2 }); // on the roof, walking towards the edge (+x)
  sim.world.enemies.push(m);
  assert.ok(rappelFrom(sim, m, [1, 0]), 'rigs a rope at the edge and goes');
  const rope = sim.world.ropes[0];
  assert.equal(rope.kind, 'rappel');
  assert.ok(Math.abs(rope.top[0]) < 0.06 && Math.abs(rope.top[1] - 9) < 1e-6, 'anchored on the edge');
  let vmax = 0, last = m.p[1], phases = new Set(), anims = new Set(), minX = Infinity;
  run(sim, 30, () => {
    if (!m.rope) return;
    phases.add(m.rope.phase);
    anims.add(m.anim);
    if (m.rope.phase === 'down') {
      vmax = Math.max(vmax, (last - m.p[1]) * 30);
      minX = Math.min(minX, m.p[0]);
      // facing the wall (-x), out from it by the clip's distance
      assert.ok(Math.abs(Math.sin(m.yaw) + 1) < 1e-6, 'faces the wall');
    }
    last = m.p[1];
  });
  assert.deepEqual([...phases], ['hook', 'over', 'down', 'off']);
  assert.ok(anims.has('rappelStart') && anims.has('rappel') && anims.has('rappelEnd'), [...anims].join());
  assert.ok(Math.abs(minX - RAPPEL.wall) < 0.05, 'feet on the wall: the root the clip distance out');
  assert.ok(vmax > 0.5 && vmax < 3, `controlled descent (peak ${vmax.toFixed(2)} m/s)`);
  assert.equal(m.rope, null, 'off the rope');
  assert.ok(Math.abs(m.p[1]) < 0.01, `standing on the ground (${m.p[1]})`);
  assert.ok(!m.lastFall, 'no fall');
  assert.equal(m.anim, 'idle');
});

test('rappel: too shallow to need a rope, no rope', () => {
  const sim = world((x, y) => y < 0 || (x < 0 && y < 1.5));
  const m = soldier([-0.5, 1.5, 0]);
  assert.equal(rappelFrom(sim, m, [1, 0]), false);
  assert.equal(sim.world.ropes.length, 0);
});

test('fast rope: three men keep their spacing, all land and clear the rope', () => {
  const sim = world((x, y) => y < 0);
  const rope = { id: 'heli-1', kind: 'fastrope', top: [5, 15, 5], bottom: [5, 0, 5], attached: true };
  sim.world.ropes.push(rope);
  const men = [0, 1, 2].map((k) => soldier([5 - 0.8, 15 - 1.9, 5 + k * 0.6], { squad: ['CMD', 'R1', 'R2'][k] }));
  sim.world.enemies.push(...men);
  assert.ok(startRope(sim, men[0], rope));
  assert.equal(startRope(sim, men[1], rope), false, 'not while the first is still near the top');
  let minGap = Infinity, vmax = 0;
  const landedV = [];
  const queue = men.slice(1);
  run(sim, 40, () => {
    if (queue.length && startRope(sim, queue[0], rope)) queue.shift();
    const on = men.filter((m) => m.rope && (m.rope.phase === 'slide' || m.rope.phase === 'mount')).sort((a, b) => a.rope.s - b.rope.s);
    for (let i = 1; i < on.length; i++) minGap = Math.min(minGap, on[i].rope.s - on[i - 1].rope.s);
    for (const m of men) {
      if (m.rope?.phase === 'slide') vmax = Math.max(vmax, m.rope.v);
      if (m.rope?.phase === 'land' && m.rope.t < 0.04) landedV.push(m);
    }
  });
  assert.equal(queue.length, 0, 'all three went down');
  assert.ok(minGap >= FAST.spacing - 0.3, `spacing kept (closest ${minGap.toFixed(2)} m)`);
  assert.ok(vmax > 3 && vmax <= FAST.vmax + 1e-6, `slid at speed, braked by hands and feet (${vmax.toFixed(2)} m/s)`);
  for (const m of men) {
    assert.equal(m.rope, null, 'off the rope');
    assert.ok(Math.abs(m.p[1]) < 0.01, 'on the ground');
    assert.ok(Math.hypot(m.p[0] - 5, m.p[2] - 5) > 1.5, 'cleared the rope for the next man');
    assert.ok(!m.lastFall, 'nobody fell');
  }
  // they spread out: not all to the same spot
  assert.ok(Math.hypot(men[0].p[0] - men[1].p[0], men[0].p[2] - men[1].p[2]) > 1);
});

test('fast rope: a moving top (a hovering helicopter drifting) is followed', () => {
  const sim = world((x, y) => y < 0);
  const rope = { id: 'heli-2', kind: 'fastrope', top: [5, 14, 5], bottom: [5, 0, 5], attached: true };
  sim.world.ropes.push(rope);
  const m = soldier([4.5, 12, 5]);
  sim.world.enemies.push(m);
  assert.ok(startRope(sim, m, rope));
  let worst = 0, n = 0;
  run(sim, 6, (t) => {
    rope.top = [5 + 1.5 * t, 14 + 0.3 * Math.sin(t * 2), 5 + 0.5 * t]; // drifting 1.6 m/s, bobbing
    if (m.rope?.phase === 'slide') {
      n++;
      const q = ropePoint(rope, m.rope.s);
      const hx = m.p[0] + Math.sin(m.yaw) * FAST.front, hz = m.p[2] + Math.cos(m.yaw) * FAST.front;
      worst = Math.max(worst, Math.hypot(hx - q[0], hz - q[2]), Math.abs(m.p[1] + FAST.grip - q[1]));
    }
  });
  // (the step after the top moved puts him on it again: within one step's drift)
  assert.ok(n > 20 && worst < 0.1, `hands on the moving rope (off by ${worst.toFixed(3)} m)`);
  assert.equal(m.rope, null);
  assert.ok(m.p[0] > 6, 'came down where the rope was by then');
});

function zipRide(drop) {
  const sim = world((x, y) => y < 0);
  const rope = { id: `zip-${drop}`, kind: 'zipline', top: [0, 2.3 + drop, 0], bottom: [40, 2.3, 0] };
  sim.world.ropes.push(rope);
  const m = soldier([0, drop, 0.3]);
  sim.world.enemies.push(m);
  assert.ok(startRope(sim, m, rope));
  let vmax = 0, hand = false;
  run(sim, 80, () => {
    if (m.rope?.phase === 'ride') (vmax = Math.max(vmax, m.rope.v)), (hand ||= m.rope.hand);
  });
  return { m, vmax, hand, rope };
}

test('zipline: faster down a steeper cable, braked in to the bottom anchor', () => {
  const shallow = zipRide(4), steep = zipRide(12), flat = zipRide(0);
  assert.ok(steep.vmax > shallow.vmax + 1, `steeper is faster (${shallow.vmax.toFixed(2)} vs ${steep.vmax.toFixed(2)} m/s)`);
  assert.ok(steep.vmax <= ZIP.vmax + 1e-6, 'the glove keeps it under the limit');
  for (const r of [shallow, steep, flat]) {
    assert.equal(r.m.rope, null, 'off the cable');
    assert.ok(Math.abs(r.m.p[1]) < 0.01, 'on the ground');
    assert.ok(Math.hypot(r.m.p[0] - 40, r.m.p[2]) < 1.5, `at the bottom anchor (${r.m.p.map((v) => v.toFixed(2))})`);
    assert.ok(!r.m.lastFall || r.m.lastFall.height < 1, `a short drop at the end, no hard fall (${r.m.lastFall?.height.toFixed(2)} m)`);
  }
  assert.ok(flat.hand && !steep.hand, 'a flat cable: hand over hand');
});

test('a soldier hit on the fast rope falls (the real wound code in a real world)', () => {
  const sim = createSimulation({
    world: { size: [8, 14, 8], h: 0.2, ground: 'stone' },
    objects: [
      { type: 'squad', params: { threatX: 0, threatZ: -30, armour: false }, x: 4, z: 6 },
      { type: 'rope', params: { kind: 'fastrope', length: 12, height: 12 }, x: 4, z: 3 },
    ],
    noFire: true,
  });
  const w = sim.world;
  assert.equal(w.ropes.length, 1, 'the rope object gives the world its rope');
  const rope = w.ropes[0];
  assert.equal(rope.kind, 'fastrope');
  const m = w.enemies[0];
  m.p = [rope.top[0] - 0.4, rope.top[1] - 1.9, rope.top[2]];
  m.yaw = Math.PI / 2; // (facing the rope, +x)
  assert.ok(startRope(sim, m, rope));
  // the simulation steps him (stepRopes hooked in), his squad AI leaves him alone
  const end = w.time + 1.6;
  while (w.time < end) sim.step(sim.dt);
  assert.equal(m.rope?.phase, 'slide', 'sliding down');
  const y = m.p[1];
  assert.ok(y < rope.top[1] - 2.5 && y > 3, `on the way down (${y.toFixed(2)})`);
  // a round from the side (along z, across his front): into his arm
  shoot(sim, [m.p[0], m.p[1] + 1.25, m.p[2] - 2.5], [0, 0, 1], { ignore: (o) => o !== m });
  assert.ok(Object.keys(m.wounds ?? {}).length, `hit (${JSON.stringify(m.wounds)})`);
  sim.step(sim.dt);
  assert.equal(m.rope?.phase, 'fall', 'lets go');
  const end2 = w.time + 3;
  while (w.time < end2 && m.rope) sim.step(sim.dt);
  assert.equal(m.rope, null);
  assert.ok(m.p[1] < 0.5, 'down on the ground');
  assert.ok(m.lastFall?.height > 2, `fell (${m.lastFall?.height?.toFixed(1)} m)`);
});

test('squad AI: a man whose way leads off a roof too high to jump rappels down it', async () => {
  const { SquadAI } = await import('../src/ai/squad.js');
  const sim = world();
  const m = soldier([-4, 9, 2], { squad: 'R1' });
  sim.world.enemies.push(m);
  const s = new SquadAI({
    unit: 'Alpha',
    members: () => [m],
    solid: sim.solid,
    floor: (x, z, who) => (x < 0 && (who?.p[1] ?? 0) > 4.5 ? 9 : 0),
    bounds: [-10, -10, 10, 10],
    threat: [8, 0, 2],
    rappel: (who, dir) => rappelFrom(sim, who, dir),
    ownMove: (who) => !!who.rope,
  });
  s.threat = [8, 0, 2];
  s.follow(m, [[4, 0, 2]], 'run');
  let roped = false;
  run(sim, 25, () => {
    if (m.rope) roped = true;
    else s.move(m, 1 / 30);
  });
  assert.ok(roped, 'went down a rope');
  assert.equal(sim.world.ropes[0]?.kind, 'rappel');
  assert.ok(Math.abs(m.p[1]) < 0.01, 'on the ground below');
  assert.ok(!m.lastFall, 'did not fall');
  assert.ok(m.p[0] > 1, `and on along his way (${m.p[0].toFixed(2)})`);
});

test('placed ropes (models/rope.js): a rappel tower turned with its object, a zipline between poles; ridden in the simulation', () => {
  const sim = createSimulation({
    world: { size: [24, 14, 12], h: 0.2, ground: 'stone' },
    objects: [
      { type: 'rope', params: { kind: 'rappel', height: 8, length: 9, structure: true }, x: 5, z: 6, rotation: 90 },
      { type: 'rope', params: { kind: 'zipline', height: 7, drop: 4, span: 12 }, x: 10, z: 3 },
      { type: 'squad', params: { threatX: 0, threatZ: -30, armour: false }, x: 18, z: 9 },
    ],
    noFire: true,
  });
  const w = sim.world;
  const rap = w.ropes.find((r) => r.kind === 'rappel'), zip = w.ropes.find((r) => r.kind === 'zipline');
  assert.ok(rap && zip);
  // turned 90 degrees: the drop (local +z) is now along +x
  assert.ok(rap.out[0] > 0.99, `out of the wall along +x (${rap.out})`);
  assert.ok(zip.top[1] - zip.bottom[1] > 3.9 && zip.bottom[0] - zip.top[0] > 11.9);
  const [a, b] = w.enemies;
  a.p = [rap.top[0] - 1.2, rap.top[1], rap.top[2]];
  b.p = [zip.top[0] + 0.3, zip.top[1] - 1.78 - 0.4, zip.top[2]];
  assert.ok(startRope(sim, a, rap), 'onto the tower rope');
  assert.ok(startRope(sim, b, zip), 'onto the cable');
  const end = w.time + 25;
  while (w.time < end && (a.rope || b.rope)) sim.step(sim.dt);
  assert.equal(a.rope, null);
  assert.equal(b.rope, null);
  const ground = w.h; // (the ground layer's top)
  assert.ok(Math.abs(a.p[1] - ground) < 0.05 && a.p[0] > rap.top[0], `at the foot of the tower (${a.p.map((v) => v.toFixed(2))})`);
  assert.ok(Math.abs(b.p[1] - ground) < 0.05 && Math.abs(b.p[0] - zip.bottom[0]) < 1.5, `at the low pole (${b.p.map((v) => v.toFixed(2))})`);
  assert.ok(!a.dead && !b.dead);
});
