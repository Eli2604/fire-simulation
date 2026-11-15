// The rope drill's ways (ai/ropeTeam.js): walking to the edge, to a rope and off its foot along the
// squad's routing (round a wall on the roof, not through it); rope or stairs (a walkable way down
// near and cheaper is taken instead of a rope, unless under fire or a team assault makes the rope
// worth it; the decision written down); the coil drawn on the man who carries one (carriesCoil).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SquadAI } from '../src/ai/squad.js';
import { stepRopes } from '../src/ai/rope.js';
import { lowerRope, wayFor, wayLength, chooseWayDown, edgeAhead, carriesCoil, STAIRS } from '../src/ai/ropeTeam.js';
import { flashbang } from '../src/sim/explosions.js';

function seeded(seed = 7) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
/**
 * A roof 9 m up (x < 0) on flat ground, a team of four on it near the edge (x = 0). Optional: a
 * wall on the roof (wall: [x0, x1, z0, z1], 1.6 m high), a ramp down off the roof's side (ramp:
 * { z0, z1, x1 }: from the roof's edge at x = 0 down to the ground at x = x1, between z0 and z1)
 * with the host's 3D path over it (path3d, as the guard AI's: a point every 0.4 m).
 */
function scene({ ropes = {}, hostiles = [], threat = [12, 0, 0], on = true, wall = null, ramp = null } = {}) {
  const inWall = (x, y, z) => !!wall && x >= wall[0] && x <= wall[1] && z >= wall[2] && z <= wall[3] && y >= 9 && y < 10.6;
  const onRamp = (x, z) => !!ramp && x >= 0 && x <= ramp.x1 && z >= ramp.z0 && z <= ramp.z1;
  const rampH = (x) => 9 * (1 - x / ramp.x1);
  const solid = (x, y, z) => y < 0 || (x < 0 && y < 9) || (onRamp(x, z) && y < rampH(x)) || inWall(x, y, z);
  // the highest floor at or below a man's feet (and a stair over them); with nobody: the roof's level (the team's)
  const floor = (x, z, who) => {
    const top = (who?.p[1] ?? 9) + 0.7;
    let y = 0;
    if (x < 0 && 9 <= top) y = 9;
    if (onRamp(x, z) && rampH(x) <= top) y = Math.max(y, rampH(x));
    return y;
  };
  const sim = { world: { ropes: [], enemies: [], events: [], noises: [], time: 0 }, solid };
  const roles = [['R1', -2.5, 0], ['CMD', -3.2, 1.6], ['MG', -3.6, -1.6], ['R2', -4.2, 0.6]];
  const men = roles.map(([squad, x, z]) => ({ p: [x, 9, z], yaw: Math.PI / 2, health: 100, squad, unit: 'Alpha', skill: 'regular', ropes: ropes[squad] ?? 0 }));
  sim.world.enemies.push(...men);
  const log = { radio: [], shouts: [], flash: [], path3d: 0 };
  const projectiles = [];
  // the 3D way: to the ramp's top, down it, on to b (a point every 0.4 m, the floor's height under each)
  const path3d = ramp
    ? (a, b) => {
        log.path3d++;
        const zc = (ramp.z0 + ramp.z1) / 2;
        const legs = Math.abs(a[1] - b[1]) < 1.5 ? [a, b] : a[1] > b[1] ? [a, [-0.3, 9, zc], [ramp.x1 + 0.3, 0, zc], [ramp.x1 + 0.3, 0, ramp.z0 - 0.5], b] : [a, [ramp.x1 + 0.3, 0, zc], [-0.3, 9, zc], b];
        const pts = [a.slice()];
        let y = a[1];
        for (let i = 1; i < legs.length; i++) {
          const p = legs[i - 1], q = legs[i], L = Math.hypot(q[0] - p[0], q[2] - p[2]), n = Math.max(1, Math.ceil(L / 0.4));
          for (let k = 1; k <= n; k++) {
            const x = p[0] + ((q[0] - p[0]) * k) / n, z = p[2] + ((q[2] - p[2]) * k) / n;
            y = floor(x, z, { p: [0, y, 0] });
            pts.push([x, y, z]);
          }
        }
        return pts;
      }
    : undefined;
  const s = new SquadAI({
    unit: 'Alpha',
    members: () => sim.world.enemies,
    solid,
    floor,
    bounds: [-12, -12, 22, 12],
    threat,
    hostiles: () => hostiles,
    lineOfSight: () => true,
    visibility: () => 200,
    rand: seeded(),
    now: () => sim.world.time,
    radio: (m, text, kind) => log.radio.push({ m, text, kind, t: sim.world.time }),
    shout: (m, text) => log.shouts.push({ m, text, t: sim.world.time }),
    flashbang: (m, from, vel) => projectiles.push({ p: from.slice(), v: vel.slice(), fuse: 1.5, by: m.unit }),
    rappel: (m, dir) => lowerRope(s, m, dir),
    ownMove: (m) => !!m.rope,
    ropeSim: sim,
    path3d,
  });
  s.useStrategy = false;
  s.on = on;
  s.log = [];
  const dt = 1 / 30;
  const run = (secs, each) => {
    for (let k = 0; k < secs / dt; k++) {
      sim.world.time += dt;
      s.step(dt);
      stepRopes(sim, dt);
      for (const g of projectiles) {
        if (g.done) continue;
        g.fuse -= dt;
        g.v[1] -= 9.81 * dt;
        for (let i = 0; i < 3; i++) g.p[i] += g.v[i] * dt;
        const fl = g.p[0] < 0 ? 9 : 0;
        if (g.p[1] <= fl) (g.p[1] = fl), (g.v = [0, 0, 0]);
        if (g.fuse <= 0) {
          g.done = true;
          log.flash.push({ p: g.p.slice(), t: sim.world.time });
          flashbang(sim, g.p, g.by);
        }
      }
      if (each?.(sim.world.time) === true) return;
    }
  };
  return { sim, s, men, log, run, inWall, solid };
}
/** Does the polyline from p along pts cross the wall (sampled every 5 cm, at chest height on the roof)? */
function crosses(inWall, p, pts) {
  let a = p;
  for (const q of pts) {
    const L = Math.hypot(q[0] - a[0], q[2] - a[2]);
    for (let s = 0; s <= L; s += 0.05) if (inWall(a[0] + ((q[0] - a[0]) * s) / (L || 1), 9.8, a[2] + ((q[2] - a[2]) * s) / (L || 1))) return true;
    a = q;
  }
  return false;
}

test('wayFor: to the edge round a wall on the roof along the squad grid, not straight through it; straight where the way is clear', () => {
  const { s, men, inWall } = scene({ wall: [-2.0, -1.6, -4, 4] });
  const m = men[0]; // (x -2.5, z 0: the wall between him and the edge)
  const to = [-0.75, 9, 0.85];
  assert.ok(crosses(inWall, m.p, [to]), 'the straight line goes through the wall');
  const way = wayFor(s, m, to);
  assert.ok(way.length > 2, `a way with turns (${way.length} points)`);
  assert.ok(!crosses(inWall, m.p, way), 'round the wall');
  assert.deepEqual(way[way.length - 1], to, 'ending on the spot');
  assert.ok(way.every((q) => Math.abs(q[1] - 9) < 0.01), 'on the roof all the way');
  assert.ok(wayLength(way, m.p) > 9, `the long way round (${wayLength(way, m.p).toFixed(1)} m)`);
  // nothing in the way: straight there
  const free = scene({});
  assert.equal(wayFor(free.s, free.men[0], to).length, 1);
});

test('team rope-down with a wall on the roof: each man walks round it to his spot on the edge (no one through it), and all get down', () => {
  const { s, men, run, inWall, sim } = scene({ ropes: { R1: 1, R2: 1, CMD: 1, MG: 1 }, threat: [8, 0, 0], wall: [-2.0, -1.6, -4, 4] });
  s.phase = 'hold';
  let through = null, rigged = false, maxZ = 0;
  run(70, () => {
    for (const m of men) {
      if (m.p[1] > 8.5 && inWall(m.p[0], 9.8, m.p[2])) through ??= `${m.squad} at ${m.p.map((v) => v.toFixed(2))}`;
      if (m.p[1] > 8.5) maxZ = Math.max(maxZ, Math.abs(m.p[2]));
      if (m.ropeTask?.kind === 'rig' && m.ropeTask.way?.length > 1) rigged = true;
    }
    if (s.ropeDoneY != null && !s.ropeTeam && men.every((m) => !m.ropeTask && !m.rope && m.p[1] < 0.1)) return true;
  });
  assert.equal(through, null, 'nobody walked through the wall');
  assert.ok(rigged, 'the riggers had routed ways to their spots');
  assert.ok(maxZ > 4, `round the end of the wall (|z| up to ${maxZ.toFixed(2)})`);
  assert.ok(sim.world.ropes.length >= 2, `ropes lowered (${sim.world.ropes.length})`);
  for (const m of men) assert.ok(Math.abs(m.p[1]) < 0.05, `${m.squad} on the ground (${m.p[1].toFixed(2)})`);
});

test('rope or stairs: a ramp down near enough is taken instead of lowering a rope (the coil kept), written down', () => {
  const { s, men, run, sim } = scene({ ropes: { R1: 1 }, ramp: { z0: 3, z1: 5, x1: 18 } });
  s.phase = 'hold';
  for (const m of men) s.follow(m, [[12, 0, m.p[2]]], 'run');
  run(40, () => men.every((m) => m.p[1] < 0.05 && !m.path) || undefined);
  assert.equal(sim.world.ropes.length, 0, 'no rope lowered');
  assert.equal(men[0].ropes, 1, 'rifleman one still has his coil');
  for (const m of men) {
    assert.ok(Math.abs(m.p[1]) < 0.05, `${m.squad} down on the ground (${m.p.map((v) => v.toFixed(2))})`);
    assert.ok(!m.lastFall, 'nobody fell');
  }
  const R1 = s.ropeLog.find((e) => e.who === 'R1');
  assert.equal(R1?.how, 'stairs', `rifleman one chose the stairs (${R1?.why})`);
  assert.ok(R1.stairsT < R1.ropeT * STAIRS.calm, 'cheaper (or not much dearer) than roping');
  assert.ok(s.log.some((l) => /^rope:decide:stairs:/.test(l)), 'in the squad log');
});

test('rope or stairs: under fire the same ramp is too long a way round; the man with the coil ropes down', () => {
  const { s, men, run, sim } = scene({ ropes: { R1: 1 }, ramp: { z0: 3, z1: 5, x1: 18 } });
  s.phase = 'hold';
  men[2].lastHitT = 0; // (the gunner just took a hit)
  const r1 = men[0];
  r1.p = [-0.3, 9, 0];
  assert.equal(lowerRope(s, r1, [1, 0]), true);
  assert.equal(r1.ropeTask?.kind, 'rig', 'he rigs his rope');
  const D = s.ropeLog[s.ropeLog.length - 1];
  assert.equal(D.how, 'rope');
  assert.match(D.why, /taking hits/);
  assert.ok(Number.isFinite(D.stairsT), 'the stairs were looked at');
  run(20, () => sim.world.ropes.length > 0 || undefined);
  assert.equal(sim.world.ropes.length, 1, 'his rope is down');
});

test('rope or stairs: the decision itself (no stairs known: rope; no rope at all: the stairs whatever they take; a team assault wants the stairs much quicker)', () => {
  const near = scene({ ropes: { R1: 1 }, ramp: { z0: 1.5, z1: 3.5, x1: 9 } });
  const m = near.men[0];
  m.p = [-0.3, 9, 0];
  const ed = edgeAhead(near.sim, m.p, [1, 0], 1.5);
  assert.ok(ed, 'an edge');
  const calm = chooseWayDown(near.s, m, ed, { ropeT: 18 });
  assert.equal(calm.how, 'stairs', calm.why);
  // (a long setup: the stairs at a third of the rope's time win even for a team; at most of it, not)
  const teamQuick = chooseWayDown(near.s, m, ed, { ropeT: calm.stairsT * 3, team: true });
  assert.equal(teamQuick.how, 'stairs', teamQuick.why);
  near.s.time += 10;
  const teamSlow = chooseWayDown(near.s, m, ed, { ropeT: calm.stairsT * 1.5, team: true });
  assert.equal(teamSlow.how, 'rope', teamSlow.why);
  assert.match(teamSlow.why, /team assault/);
  near.s.time += 10;
  const none = chooseWayDown(near.s, m, ed, { ropeT: Infinity });
  assert.equal(none.how, 'stairs');
  assert.match(none.why, /no rope/);
  // no 3D path at all (most scenes): the rope, as before
  const flat = scene({ ropes: { R1: 1 } });
  const f = flat.men[0];
  f.p = [-0.3, 9, 0];
  const D = chooseWayDown(flat.s, f, edgeAhead(flat.sim, f.p, [1, 0], 1.5), { ropeT: 18 });
  assert.equal(D.how, 'rope');
  assert.match(D.why, /no stairs/);
  // nobody in the team has a rope, but there is a way down: that way, not 'cannot'
  const b = scene({ ropes: {}, ramp: { z0: 1.5, z1: 3.5, x1: 9 } });
  const n = b.men[0];
  n.p = [-0.3, 9, 0];
  assert.equal(lowerRope(b.s, n, [1, 0]), true);
  assert.ok(n.path?.length > 1 && !n.ropeTask, 'on his way down the ramp');
});

test('team rope-down or stairs: a short ramp beside the team takes them all down it; no signal for ropes', () => {
  const { s, men, run, sim, log } = scene({ ropes: { R1: 1, R2: 1, CMD: 1, MG: 1 }, threat: [8, 0, 0.5], ramp: { z0: 1.5, z1: 3.5, x1: 9 } });
  s.phase = 'hold';
  run(30, () => men.every((m) => m.p[1] < 0.05) || undefined);
  const D = s.ropeLog.find((e) => e.team);
  assert.equal(D?.how, 'stairs', `the leader chose the stairs (${D?.why})`);
  assert.ok(log.radio.some((r) => /stairs/i.test(r.text)), 'and called it');
  assert.equal(sim.world.ropes.length, 0, 'no ropes');
  assert.ok(men.every((m) => m.ropes === 1), 'coils kept');
  for (const m of men) assert.ok(Math.abs(m.p[1]) < 0.05, `${m.squad} down (${m.p.map((v) => v.toFixed(2))})`);
});

test('the coil on his pack: drawn while he carries one, in his hands as he throws it, gone once lowered', () => {
  assert.equal(carriesCoil({ ropes: 1 }), true);
  assert.equal(carriesCoil({ ropes: 0 }), false);
  assert.equal(carriesCoil({}), false, '(an auto-rigging man with none listed: nothing drawn)');
  assert.equal(carriesCoil({ ropes: 1, dead: true }), false);
  assert.equal(carriesCoil({ ropes: 1, ropeTask: { kind: 'rig', phase: 'anchor' } }), true, 'on his back while he ties off');
  assert.equal(carriesCoil({ ropes: 1, ropeTask: { kind: 'rig', phase: 'throw' } }), false, 'in his hands as he throws it');
  // through the drill: on his back until the rope goes over the edge
  const { s, men, run } = scene({ ropes: { R1: 1 }, on: false });
  const r1 = men[0];
  r1.p = [-0.3, 9, 0];
  const seen = [];
  assert.equal(lowerRope(s, r1, [1, 0]), true);
  run(8, () => void seen.push(carriesCoil(r1)));
  assert.equal(seen[0], true, 'drawn at first');
  assert.equal(seen[seen.length - 1], false, 'gone at the end');
  assert.equal(r1.ropes, 0);
});
