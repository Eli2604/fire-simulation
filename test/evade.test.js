import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROLLS, ROLL, rollAt, rollPoint, pickRoll, startRoll, stepRoll, dangers, escapeDir } from '../src/ai/evade.js';
import { SquadAI } from '../src/ai/squad.js';
import { moveGroup, stepGroups } from '../src/ai/tactics.js';
import { EVADE_ACTS } from '../src/rig/objects.js';

/** A flat world (solid below y 0) with boxes [x0, z0, x1, z1, top]. */
function world(boxes = []) {
  const solid = (x, y, z) => y < 0 || boxes.some(([x0, z0, x1, z1, top, bot = 0]) => x >= x0 && x < x1 && z >= z0 && z < z1 && y >= bot && y < top);
  const floor = (x, z, from) => {
    for (let y = from; y > from - 3.5; y -= 0.05) if (solid(x, y - 0.025, z)) return Math.round(y / 0.05) * 0.05;
    return null;
  };
  return { solid, floor };
}
function squadOn(boxes, members, o = {}) {
  const { solid, floor } = world(boxes);
  return new SquadAI({ unit: 'Alpha', members: () => members, solid, floor: (x, z, who) => floor(x, z, (who ? who.p[1] : 0) + 1.2) ?? 0, bounds: [-10, -10, 10, 10], ...o });
}
const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

test('the rolls: root paths go the way they should, the clips are baked round them', async () => {
  for (const k of Object.keys(ROLLS)) {
    const [s0, f0, u0] = rollAt(k, 0);
    assert.ok(Math.abs(s0) + Math.abs(f0) + Math.abs(u0) < 1e-12, k);
    const [s, f, u] = rollAt(k, 1);
    const d = ROLLS[k].geo.d;
    // (sideways: the rolls and the crouched side steps that stand in for them, ai/weapons.js)
    if (ROLLS[k].side) assert.ok(Math.abs(s - ROLLS[k].side * d) < 1e-9 && f === 0, k);
    else assert.ok(Math.abs(f - d) < 1e-9 && s === 0, k);
    assert.equal(u, 0);
    // never back (monotone), quick off the mark sideways (half the way in under half the time)
    let prev = 0;
    for (let x = 0.05; x <= 1.0001; x += 0.05) {
      const r = rollAt(k, x);
      const v = Math.abs(r[0]) + r[1];
      assert.ok(v >= prev - 1e-9, `${k} never back`);
      prev = v;
    }
  }
  assert.ok(Math.abs(rollAt('rollLeft', 0.5)[0]) > 0.55 * ROLLS.rollLeft.geo.d);
  // facing +z (yaw 0) his left is +x
  assert.ok(rollPoint('rollLeft', 1, [0, 0, 0], 0)[0] > 1.8);
  assert.ok(rollPoint('rollRight', 1, [0, 0, 0], 0)[0] < -1.8);
  const { operatorClips, LABELS, ONCE } = await import('../src/operator/rig.js');
  const c = operatorClips();
  for (const k of Object.keys(ROLL)) {
    assert.ok(c[k] && c[k + '_u'] && c[k + '_k'] && LABELS[k] && ONCE[k], k);
    assert.ok(Math.abs(c[k].duration - ROLLS[k].dur) < 1e-6);
    const hp = c[k].tracks.find((t) => t.name === 'hips.position').values;
    const n = hp.length / 3;
    // over the root at the start and the end (standing; a crouch, or flat on the ground)
    for (const i of [0, n - 1]) assert.ok(Math.abs(hp[3 * i]) < 0.05 && Math.abs(hp[3 * i + 2]) < 0.1, `${k}: hips over the root`);
    assert.ok(hp[1] > 0.85, `${k} starts standing`);
    assert.ok(hp[3 * (n - 1) + 1] < (k === 'diveProne' ? 0.3 : 0.7), `${k} ends low`);
    // in the middle: down on the ground (rolling), the hips low
    const m = Math.round(n * 0.5);
    assert.ok(hp[3 * m + 1] < 0.6, `${k} low in the middle (${hp[3 * m + 1].toFixed(2)})`);
  }
  assert.equal(LABELS.rollLeft, 'Roll (left)');
  assert.equal(LABELS.diveProne, 'Dive roll to prone');
  for (const k of ['rollLeft', 'rollRight', 'rollForward', 'diveProne']) assert.ok(EVADE_ACTS[k], k);
});

test('a grenade lands by a soldier: he rolls away from it, ending well clear', () => {
  const m = { p: [0, 0, 0], yaw: 0, squad: 'R1', unit: 'Alpha' };
  const g = [0.6, 0.1, -0.9]; // just behind him on his right
  const sq = squadOn([], [m], { threat: [0, 0, 9], dangers: (x) => (x === m && !m.trav ? [{ kind: 'grenade', p: g }] : []) });
  for (let t = 0; t < 3; t += 0.05) sq.step(0.05);
  assert.ok(m.rolls >= 1, 'he rolled');
  assert.ok(m.lastRoll && ROLL[m.lastRoll.kind] && m.lastRoll.why === 'grenade', JSON.stringify(m.lastRoll));
  const d0 = flat([0, 0, 0], g), d1 = flat(m.p, g);
  assert.ok(d1 > d0 + 1.5 && d1 > 2.6, `from ${d0.toFixed(2)} m to ${d1.toFixed(2)} m from it`);
  // and the way away from it (not past it)
  const e = escapeDir({ p: [0, 0, 0], yaw: 0 }, { kind: 'grenade', p: g });
  assert.ok((m.p[0] * e[0] + m.p[2] * e[1]) / Math.hypot(m.p[0], m.p[2]) > 0.8);
});

test('rounds cracking past: a man on the move rolls out of the line of fire (seeded), not into a wall', () => {
  const m = { p: [0, 0, 0], yaw: 0, squad: 'R1', unit: 'Alpha' };
  // fire from straight ahead along -z (the line through him); a wall close on his left (+x)
  const shot = { kind: 'fire', from: [0, 1.4, 20], dir: [0, 0, -1], p: [0, 1.4, 20], time: 1 };
  const sq = squadOn([[0.9, -3, 1.3, 3, 2]], [m], { threat: [0, 0, 20], rand: () => 0, dangers: (x) => (!x.trav ? [shot] : []) });
  sq.rebuildNav();
  sq.follow(m, [[0, 0, 6]], 'run');
  for (let t = 0; t < 1.6; t += 0.05) sq.step(0.05);
  assert.equal(m.rolls, 1, 'once for that burst');
  assert.ok(['rollLeft', 'rollRight'].includes(m.lastRoll?.kind ?? m.trav?.kind), m.lastRoll?.kind);
  // out of the line (x), on the open side (not into the wall at +0.9)
  assert.ok(m.p[0] < -1.4, `off the line to the open side: x ${m.p[0].toFixed(2)}`);
  // a soldier standing still under fire with nowhere to roll aside: a dive to prone, ahead
  const n = { p: [0, 0, 0], yaw: Math.PI, squad: 'R2', unit: 'Alpha' };
  const box = [[-1.3, -3, -0.9, 3, 2], [0.9, -3, 1.3, 3, 2]];
  const pick = pickRoll(n, { kind: 'fire', from: [0, 1.4, 20], dir: [0, 0, -1], p: [0, 1.4, 20] }, world(box));
  assert.equal(pick, null, 'boxed in: no roll');
  const pick2 = pickRoll(n, { kind: 'grenade', p: [0, 0, 1] }, world());
  assert.equal(pick2.kind, 'diveProne', 'facing away from a grenade: a dive to prone');
  startRoll(n, pick2, 0);
  for (let t = 0; t < 2 && n.trav; t += 0.05) stepRoll(n, 0.05);
  assert.ok(n.p[2] < -1.9, 'dove away from it');
});

test('dangers: a grenade by him, a rocket coming his way, rounds past him, a dragon diving on him', () => {
  const m = { p: [10, 0, 10], yaw: 0 };
  const w = { time: 5, projectiles: [{ p: [11, 0.1, 10], v: [0, 0, 0], fuse: 1.5, resting: true }, { type: 'rocket', p: [10, 1, 30], v: [0, 0, -40] }, { type: 'arrow', p: [0, 0, 0], v: [1, 0, 0] }], dragons: [] };
  m.shotAt = { time: 4.9, from: [0, 1, 10], dir: [1, 0, 0] };
  const k = dangers(w, m).map((t) => t.kind);
  assert.deepEqual(k.sort(), ['fire', 'grenade', 'rocket']);
  w.projectiles = [];
  m.shotAt = null;
  w.dragons = [{ health: 100, k: 1, chest: [10, 6, 2], mode: 'air', yaw: 0, speed: 16, vy: -5 }];
  assert.deepEqual(dangers(w, m).map((t) => t.kind), ['dragon']);
  w.dragons[0].yaw = Math.PI; // flying away
  assert.deepEqual(dangers(w, m), []);
});

test('on routine moves no vaults or climbs (round the wall); in action, over it (the traversal links)', () => {
  const m = { p: [0, 0, 4], yaw: Math.PI, squad: 'R1', unit: 'Alpha' };
  const wall = [[-6, -0.15, 6, 0.15, 0.9]];
  const calm = squadOn(wall, [m]);
  const pts = calm.route(m.p, [0, 0, -4], m);
  assert.ok(!pts.some((p) => p.move), 'on patrol: no move');
  assert.ok(Math.hypot(pts[pts.length - 1][0], pts[pts.length - 1][2] + 4) < 0.6, 'but it gets there');
  const len = pts.reduce((a, p, i) => a + flat(p, i ? pts[i - 1] : m.p), 0);
  assert.ok(len > 14, `round the end of the wall (${len.toFixed(1)} m)`);
  // walking it, he never goes over the wall
  calm.rebuildNav();
  calm.follow(m, pts, 'walk');
  for (let t = 0; t < 30 && m.path; t += 0.05) {
    calm.move(m, 0.05);
    assert.ok(!m.trav, 'no parkour on patrol');
  }
  assert.ok(m.p[2] < -3.4, 'got round');
  // the same squad with a threat (or something to look into): straight over it
  const n = { p: [0, 0, 4], yaw: Math.PI, squad: 'R1', unit: 'Alpha' };
  const hot = squadOn(wall, [n], { threat: [0, 0, -9] });
  assert.ok(hot.route(n.p, [0, 0, -4], n).some((p) => p.move === 'vaultSpeed'), 'in action: a vault');
  const inv = squadOn(wall, [n]);
  inv.inv = { p: [0, 0, -4], men: [n] };
  assert.ok(inv.route(n.p, [0, 0, -4], n).some((p) => p.move), 'investigating: a vault');
  inv.inv = null;
  assert.ok(!inv.route(n.p, [0, 0, -4], n).some((p) => p.move), 'calm again: round');
});

test('a team moving in formation under threat routes each man over the wall (the links), not just as it comes', () => {
  const ms = ['CMD', 'R1', 'R2', 'MG'].map((r, i) => ({ p: [-1.5 + i, 0, 4], yaw: Math.PI, squad: r, unit: 'Alpha' }));
  const sq = squadOn([[-8, -0.15, 8, 0.15, 0.9]], ms, { threat: [0, 0, -9] });
  sq.rebuildNav();
  sq.time = 0;
  moveGroup(sq, ms, [0, 0, -4], { quiet: true });
  const seen = new Set();
  let routed = 0;
  for (let t = 0; t < 25; t += 0.05) {
    sq.time += 0.05;
    // (only the formation and the moving: ai/tactics.js stepGroups, ai/squad.js move)
    stepGroups(sq, 0.05);
    for (const m of ms) {
      if (m.formRoute) routed++;
      sq.move(m, 0.05);
      if (m.trav) seen.add(m.trav.kind);
      if (Math.abs(m.p[2]) < 0.15 && Math.abs(m.p[0]) < 8) assert.ok(m.p[1] > 0.5 || m.trav, 'over the wall, not through it');
    }
  }
  assert.ok([...seen].some((k) => k.startsWith('vault')), 'vaults: ' + [...seen].join());
  assert.ok(routed > 0, 'each man had his own route to his place');
  for (const m of ms) assert.ok(m.p[2] < -0.6 && m.p[1] < 0.1, `${m.squad} over, on the far side (${m.p.map((v) => v.toFixed(1))})`);
});

test('a guard on his patrol (the guard AI) rolls away from a grenade at his feet', async () => {
  const { createSimulation } = await import('../src/sim/createSimulation.js');
  const sim = createSimulation({ world: { size: [30, 4, 30], h: 0.2, ground: 'soil' }, objects: [{ type: 'enemy', params: { count: 1 }, x: 15, z: 15 }], noFire: true });
  const w = sim.world, e = w.enemies[0];
  const g = [e.p[0] + 0.8, e.p[1] + 0.1, e.p[2] + 0.5];
  w.projectiles.push({ p: g.slice(), v: [0, 0, 0], fuse: 2.5, energy: 8e5, resting: true });
  const d0 = flat(e.p, g);
  for (let i = 0; i < 30; i++) {
    w.time += 0.05;
    sim.ai.step(0.05);
  }
  assert.ok(e.guardCtl, 'a guard on his patrol');
  assert.equal(e.lastRoll?.why, 'grenade');
  assert.ok(ROLL[e.lastRoll.kind]);
  assert.ok(flat(e.p, g) > d0 + 1.2, `away from it: ${d0.toFixed(2)} -> ${flat(e.p, g).toFixed(2)} m`);
});

test('the dragon dives on a guard: he rolls out from under it (no more shifting him aside), and it misses', async () => {
  const { createSimulation } = await import('../src/sim/createSimulation.js');
  const { startSnatch } = await import('../src/ai/dragonAir.js');
  const sim = createSimulation({ world: { size: [120, 3, 120], h: 0.4, ground: 'soil' }, objects: [{ type: 'dragon', params: { start: 'fly' }, x: 20, z: 60, rotation: 90 }, { type: 'enemy', params: { count: 1 }, x: 70, z: 60 }], noFire: true });
  const w = sim.world, d = w.dragons[0], e = w.enemies[0];
  const tick = () => {
    w.time += 0.05;
    sim.dragonAI.step(0.05);
  };
  tick();
  e.stunnedUntil = 1e9; // (only the dragon's side is stepped: the roll is the snatch's own)
  e.dodgeChance = 1;
  assert.ok(startSnatch(sim.dragonAI, d, { kind: 'enemy', ref: e }, 1));
  const kinds = new Set();
  for (let i = 0; i < 2400 && d.snatch; i++) {
    tick();
    if (e.trav?.roll) kinds.add(e.trav.kind);
    assert.ok(!e.dodge, 'not shifted aside');
  }
  assert.ok(kinds.has('rollLeft') || kinds.has('rollRight'), [...kinds].join());
  assert.ok(e.rolls >= 1 && e.lastRoll?.why === 'dragon');
  assert.ok(w.events.some((x) => x.type === 'snatchMiss'), 'it missed him');
});
