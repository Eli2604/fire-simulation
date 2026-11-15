import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../src/sim/createSimulation.js';
import { buildScene } from '../src/models/voxelizer.js';
import { MODELS, defaultParams } from '../src/models/index.js';
import { parseRoute } from '../src/ai/dragon.js';
import {
  parsePath,
  formatPath,
  parsePoly,
  formatPoly,
  drawnPatrol,
  pointInPolygon,
  outsidePoly,
  insertPoint,
  deletePoint,
  movePoint,
  insertIndex,
  nearestSegment,
  rectPoly,
  circlePoly,
  nextLeg,
  sweepPoints,
  holdAt,
  PATROL_PARAMS,
} from '../src/ai/patrol.js';

const PATH = '-8,-8; 8,-8 2s look; 8,8 run crouch; -8,8 patrol';
const AREA = '-7,-7; 7,-7; 7,7; -7,7';

test('drawn patrol params: text round trip, every patrolling model has them, saved with the scene', () => {
  const W = parsePath(PATH);
  assert.equal(W.length, 4);
  assert.deepEqual(W[1], { p: [8, -8], pause: 2, look: true });
  assert.deepEqual(W[2], { p: [8, 8], speed: 'run', stance: 'crouch' });
  assert.equal(formatPath(W), '-8,-8; 8,-8 2s look; 8,8 crouch run; -8,8 patrol');
  assert.deepEqual(parsePath(formatPath(W)), W);
  assert.deepEqual(parsePoly(formatPoly(parsePoly(AREA))), parsePoly(AREA));
  assert.deepEqual(parsePoly('1,2; 3,4'), [], 'fewer than 3 corners: no area');
  assert.deepEqual(parsePath('junk; 1,2 sniff rest; x,3'), [{ p: [1, 2] }], "bad entries skipped, a dragon's acts ignored");
  for (const t of ['squad', 'enemy', 'campPatrol']) for (const k of Object.keys(PATROL_PARAMS)) assert.ok(MODELS[t].params[k], `${t}.${k}`);
  // the guards' area from the params: a path (with its area as the zone), or an area
  const a = drawnPatrol({ patrolPath: PATH, patrolOrder: 'back and forth', patrolArea: AREA, leash: 12, level: 1 });
  assert.equal(a.mode, 'route');
  assert.equal(a.order, 'pingpong');
  assert.deepEqual(a.corners[1], [8, 1, -8]);
  assert.deepEqual(a.stops[1], { pause: 2, look: true, stance: 'stand', speed: 'walk' });
  assert.equal(a.zone.length, 4);
  assert.equal(a.leash, 12);
  const b = drawnPatrol({ patrolArea: AREA, areaSweep: 'sweep' });
  assert.equal(b.mode, 'area');
  assert.ok(b.poly && b.sweep === 'sweep');
  assert.equal(drawnPatrol(defaultParams('squad')), null, 'nothing drawn: none');
  // through the scene (JSON, as saved / undone) into the world: moved and turned with the object
  const scene = { world: { size: [40, 4, 40], h: 0.5 }, objects: [{ type: 'squad', params: { ...defaultParams('squad'), patrolPath: PATH, patrolArea: AREA }, x: 20, z: 20, rotation: 90 }] };
  const { world } = buildScene(JSON.parse(JSON.stringify(scene)));
  const e = world.enemies[0];
  assert.equal(e.area.mode, 'route');
  assert.equal(e.area.stops.length, 4);
  assert.ok(e.guard && !e.threat, 'a patrolling squad: guards of their own team until contact');
  const local = parsePath(PATH)[0].p;
  // (turned 90°: local x goes to world -z... whichever way: the same distance from the object)
  const [ox, , oz] = world.origins[0];
  assert.ok(Math.abs(Math.hypot(e.area.corners[0][0] - ox, e.area.corners[0][2] - oz) - Math.hypot(...local)) < 1e-6);
  assert.ok(Math.hypot(e.area.corners[0][0] - ox - local[0], e.area.corners[0][2] - oz - local[1]) > 1, 'turned with the object');
  assert.equal(e.area.zone.length, 4);
});

test('editing helpers: insert, delete, move a point; where a click goes; point in polygon; presets', () => {
  const P = [[0, 0], [10, 0], [10, 10]];
  assert.deepEqual(insertPoint(P, 1, [5, 0]), [[0, 0], [5, 0], [10, 0], [10, 10]]);
  assert.deepEqual(insertPoint(P, 3, [0, 10]), [...P, [0, 10]]);
  assert.deepEqual(deletePoint(P, 1), [[0, 0], [10, 10]]);
  assert.deepEqual(movePoint(P, 2, 9.123, 8), [[0, 0], [10, 0], [9.12, 8]]);
  assert.deepEqual(movePoint([{ p: [0, 0], pause: 3 }], 0, 1, 2), [{ p: [1, 2], pause: 3 }], 'a waypoint keeps its options');
  assert.equal(P.length, 3, 'a new list each time');
  // a click on a leg goes in there; elsewhere at the end of a path, into the nearest edge of an area
  assert.equal(insertIndex(P, 5, 0.3), 1);
  assert.equal(insertIndex(P, 20, 20), 3);
  assert.equal(insertIndex(P, -1, 6, true), 3, 'nearest the closing edge of the area');
  assert.equal(nearestSegment(P, 10.2, 5).i, 1);
  const sq = rectPoly(0, 0, 10, 10);
  assert.ok(pointInPolygon(sq, 0, 0) && pointInPolygon(sq, 4.9, -4.9));
  assert.ok(!pointInPolygon(sq, 5.1, 0));
  const L = [[0, 0], [10, 0], [10, 10], [5, 3], [0, 10]]; // concave
  assert.ok(!pointInPolygon(L, 5, 6), 'in the notch: out');
  assert.ok(pointInPolygon(L, 2, 2));
  assert.equal(outsidePoly(sq, 0, 0), 0);
  assert.ok(Math.abs(outsidePoly(sq, 8, 0) - 3) < 1e-9);
  const c = circlePoly(0, 0, 8);
  assert.equal(c.length, 16);
  assert.ok(c.every(([x, z]) => Math.abs(Math.hypot(x, z) - 8) < 0.02));
  // a sweep: rows across the area, every point in it, there and back
  const S = sweepPoints(rectPoly(0, 0, 24, 12), 6);
  assert.ok(S.length >= 6 && S.every(([x, z]) => pointInPolygon(rectPoly(0, 0, 24, 12), x, z)));
  assert.ok(S[0][0] < S[1][0] && S[S.length - 1][0] < S[S.length - 2][0], 'boustrophedon');
});

test('the order of a path: loop, back and forth, one way; a stop holds him, then on', () => {
  const walk = (order, n = 10) => {
    const a = { corners: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]], order };
    const e = { leg: -1 };
    return Array.from({ length: n }, () => (e.leg = nextLeg(e, a)));
  };
  assert.deepEqual(walk('loop'), [0, 1, 2, 3, 0, 1, 2, 3, 0, 1]);
  assert.deepEqual(walk(undefined), walk('loop'), 'an old round: a loop');
  assert.deepEqual(walk('pingpong'), [0, 1, 2, 3, 2, 1, 0, 1, 2, 3]);
  assert.deepEqual(walk('once'), [0, 1, 2, 3, 3, 3, 3, 3, 3, 3]);
  const a = { corners: [[0, 0, 0], [1, 0, 0]], stops: [{ pause: 4, look: true, stance: 'crouch' }, {}], order: 'loop' };
  const e = { leg: 0, yaw: 0 };
  assert.equal(holdAt(e, a, 10), true);
  assert.equal(e.holdStance, 'crouch');
  assert.equal(holdAt(e, a, 12), true);
  assert.notEqual(e.yaw, 0, 'looking round');
  assert.equal(holdAt(e, a, 14.1), false, 'the pause over: on');
  e.leg = 1;
  assert.equal(holdAt(e, a, 15), false, 'no stop there');
});

/** The guard team's leader now (the file turns round at times: another man leads). */
const leaderOf = (sim, E) => sim.ai.teamOf(E[0]).find((e) => !e.dead);
function walkPath(order, steps) {
  const sim = createSimulation({ world: { size: [36, 4, 36], h: 0.5 }, weather: { windSpeed: 0 }, noFire: true, objects: [{ type: 'squad', params: { patrolPath: '-8,-8; 8,-8 2s look; 8,8 run; -8,8', patrolOrder: order }, x: 18, z: 18 }] });
  const E = sim.world.enemies;
  const C = E[0].area.corners;
  // the waypoints the leader heads for, in turn (the leg is handed on when the file turns round),
  // and the ones somebody reached
  const seq = [];
  const reached = new Set();
  let ran = false;
  for (let k = 0; k < steps; k++) {
    sim.step(0.1);
    const L = leaderOf(sim, E);
    if (L.goal && seq[seq.length - 1] !== L.leg) seq.push(L.leg);
    for (const e of E) C.forEach((c, i) => Math.hypot(c[0] - e.p[0], c[2] - e.p[2]) < 1.2 && reached.add(i));
    if (L.pace === 'run') ran = true;
  }
  return { sim, E, seq, ran, reached };
}

test('a squad walks its drawn path in order: a loop', () => {
  const { E, seq, ran, reached } = walkPath('loop', 800);
  assert.equal(reached.size, 4, 'every waypoint reached');
  assert.equal(seq[0], 0, 'from the first waypoint');
  assert.ok(E.every((e) => e.state === 'patrol' && e.guard), 'on patrol, as guards');
  assert.deepEqual(E.map((e) => e.squad), ['CMD', 'MG', 'R1', 'R2'], 'still the fire team');
  assert.ok(seq.length >= 5, `waypoints reached: ${seq.join(' ')}`);
  for (let k = 1; k < seq.length; k++) assert.equal(seq[k], (seq[k - 1] + 1) % 4, `in order: ${seq.join(' ')}`);
  assert.ok(ran, 'the leg to waypoint 3 at a run');
});

test('a squad walks its drawn path back and forth', () => {
  const { seq, reached } = walkPath('back and forth', 800);
  assert.equal(reached.size, 4, 'every waypoint reached');
  assert.ok(seq.length >= 6, `waypoints reached: ${seq.join(' ')}`);
  for (let k = 1; k < seq.length; k++) assert.equal(Math.abs(seq[k] - seq[k - 1]), 1, `one step along at a time: ${seq.join(' ')}`);
  assert.ok(seq.includes(3) && seq.indexOf(3) < seq.length - 1 && seq[seq.indexOf(3) + 1] === 2, `turned round at the end: ${seq.join(' ')}`);
});

test('a squad with an area stays in it on patrol, and comes back after a pursuit beyond the leash', () => {
  const sim = createSimulation({ world: { size: [40, 4, 40], h: 0.5 }, weather: { windSpeed: 0 }, noFire: true, objects: [{ type: 'squad', params: { patrolArea: AREA, leash: 5 }, x: 14, z: 20 }] });
  const E = sim.world.enemies;
  let out = 0;
  const goals = new Set();
  for (let k = 0; k < 500; k++) {
    sim.step(0.1);
    for (const e of E) if (!sim.ai.inArea(e, e.p)) out++;
    const L = leaderOf(sim, E);
    if (L.goal) goals.add(L.goal.map((v) => v.toFixed(1)).join());
  }
  assert.equal(out, 0, 'all inside the area all along');
  assert.ok(goals.size >= 3, `spots in the area walked to: ${goals.size}`);
  const sq = sim.squadFor('Alpha');
  // a threat in the area: the squad AI has them
  sq.threat = [16, 0.5, 22];
  for (let k = 0; k < 10; k++) sim.step(0.1);
  assert.ok(E.every((e) => e.state === 'engage' && !e.guardCtl), 'in the fight');
  // it moves far beyond the leash and one man went after it: they break off; he runs back in
  sq.threat = [36, 0.5, 36];
  E[1].p = [30, E[1].p[1], 20]; // 9 m out of the east edge (x 21)
  for (let k = 0; k < 10; k++) sim.step(0.1);
  assert.ok(E.every((e) => e.state === 'patrol' && e.guardCtl), 'back on patrol');
  assert.ok(E[1].leashBack && E[1].pace === 'run', 'running back');
  for (let k = 0; k < 200; k++) sim.step(0.1);
  assert.ok(E.every((e) => sim.ai.inArea(e, e.p)), 'all back in the area');
  assert.ok(!E[1].leashBack);
});

test('old routes still load and walk: the enemy rectangle round, the camp patrol circle, a dragon route', () => {
  const { world } = buildScene({
    world: { size: [40, 4, 40], h: 0.5 },
    objects: [
      { type: 'enemy', params: { count: 1, spread: 0, patrol: 'route', patrolWidth: 6, patrolDepth: 6 }, x: 10, z: 10 },
      { type: 'campPatrol', params: { radius: 10, corners: 6 }, x: 25, z: 25 },
    ],
  });
  const [g, ...camp] = world.enemies;
  assert.equal(g.area.mode, 'route');
  assert.equal(g.area.corners.length, 4);
  assert.equal(g.area.order, undefined, 'no order: a loop, as before');
  assert.equal(camp[0].area.corners.length, 6);
  assert.ok(!camp[0].guard && camp[0].soldier, 'the camp patrol: enlisted soldiers as before');
  // the guard round steps corner to corner as before (ai/enemies.js patrolGoal)
  const sim = createSimulation({ world: { size: [20, 2.4, 20], h: 0.2, ground: 'stone' }, objects: [{ type: 'enemy', params: { count: 1, spread: 0, patrol: 'route', patrolWidth: 6, patrolDepth: 6 }, x: 10, z: 10 }], noFire: true });
  const e = sim.world.enemies[0];
  const legs = [];
  for (let k = 0; k < 6; k++) {
    sim.ai.patrolGoal(e);
    legs.push(e.leg);
  }
  assert.deepEqual(legs, [1, 2, 3, 0, 1, 2]);
  // the old rectangle area test still answers
  assert.ok(sim.ai.inArea({ area: { mode: 'area', corners: [[0, 0, 0], [4, 0, 0], [4, 0, 4], [0, 0, 4]] } }, [2, 0, 2]));
  // a dragon's route text is the dragon's (its acts), untouched
  assert.equal(parseRoute('30.6,20.8 rest; 51,21.6 climb').length, 2);
  // a drawn path in place of the camp patrol's circle
  const { world: w2 } = buildScene({ world: { size: [40, 4, 40], h: 0.5 }, objects: [{ type: 'campPatrol', params: { patrolPath: '0,0; 5,0; 5,5' }, x: 20, z: 20 }] });
  assert.equal(w2.enemies[0].area.corners.length, 3);
  const [ox2, , oz2] = w2.origins[0];
  assert.ok(Math.hypot(w2.enemies[0].p[0] - ox2, w2.enemies[0].p[2] - oz2) < 0.01, 'the leader starts at its first waypoint');
});
