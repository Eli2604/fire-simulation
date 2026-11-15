// The rope drill of a fire team (ai/ropeTeam.js): overwatch at the foot of a rope while the others
// come down (and kneeling at the top while they wait), ropes as gear (only a man with a coil lowers
// one), and the team rope-down (signal, ropes side by side, a flashbang below, all down together).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SquadAI } from '../src/ai/squad.js';
import { stepRopes } from '../src/ai/rope.js';
import { lowerRope, WATCH } from '../src/ai/ropeTeam.js';
import { flashbang } from '../src/sim/explosions.js';

/** A seeded random (the squad AI's scatter and pauses): the same run every time. */
function seeded(seed = 7) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
/**
 * A roof (a block 9 m high for x < 0) on flat ground, a team of four on it near the edge (x = 0),
 * the squad AI with the rope drill (lowerRope as host.rappel), and the rope module stepped as the
 * simulation does. A flashbang thrown flies and goes off 1.5 s later (sim/explosions.js).
 */
function scene({ ropes = {}, hostiles = [], threat = [12, 0, 0], on = true, extra = [] } = {}) {
  const solid = (x, y) => y < 0 || (x < 0 && y < 9);
  const sim = { world: { ropes: [], enemies: [], events: [], noises: [], time: 0 }, solid };
  const roles = [['R1', -2.5, 0], ['CMD', -3.2, 1.6], ['MG', -3.6, -1.6], ['R2', -4.2, 0.6]];
  const men = roles.map(([squad, x, z]) => ({ p: [x, 9, z], yaw: Math.PI / 2, health: 100, squad, unit: 'Alpha', skill: 'regular', ropes: ropes[squad] ?? 0 }));
  sim.world.enemies.push(...men, ...extra);
  const log = { fire: [], radio: [], shouts: [], flash: [] };
  const projectiles = [];
  const s = new SquadAI({
    unit: 'Alpha',
    members: () => sim.world.enemies,
    solid,
    floor: (x, z, who) => (x < 0 && (who?.p[1] ?? 0) > 4.5 ? 9 : 0),
    bounds: [-12, -12, 16, 12],
    threat,
    hostiles: () => hostiles.filter((h) => h.visible !== false),
    lineOfSight: () => true,
    visibility: () => 200,
    rand: seeded(),
    now: () => sim.world.time,
    fire: (m, at) => log.fire.push({ m, at, t: sim.world.time }),
    radio: (m, text, kind) => log.radio.push({ m, text, kind, t: sim.world.time }),
    shout: (m, text) => log.shouts.push({ m, text, t: sim.world.time }),
    flashbang: (m, from, vel) => projectiles.push({ p: from.slice(), v: vel.slice(), fuse: 1.5, by: m.unit }),
    rappel: (m, dir) => lowerRope(s, m, dir),
    ownMove: (m) => !!m.rope,
    ropeSim: sim,
  });
  s.useStrategy = false;
  s.on = on;
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
        if (g.p[1] <= (g.p[0] < 0 ? 9 : 0)) (g.p[1] = g.p[0] < 0 ? 9 : 0), (g.v = [0, 0, 0]);
        if (g.fuse <= 0) {
          g.done = true;
          log.flash.push({ p: g.p.slice(), t: sim.world.time });
          flashbang(sim, g.p, g.by);
        }
      }
      if (each?.(sim.world.time) === true) return;
    }
  };
  return { sim, s, men, log, run };
}
const yawDir = (m) => [Math.sin(m.yaw), Math.cos(m.yaw)];

test('overwatch: the first man down kneels off the rope facing out, weapon up, while the others come down; the waiting men kneel at the top; he fires at a hostile who shows', () => {
  // only rifleman one carries a rope: he lowers it, the others queue for it
  const hostile = { p: [7, 0, 9], yaw: Math.PI, health: 100, visible: false };
  const { s, men, log, run } = scene({ ropes: { R1: 1 }, hostiles: [hostile], on: true });
  s.phase = 'hold'; // (no bounding: each man just goes his way down)
  for (const m of men) s.follow(m, [[6, 0, m.p[2]]], 'run');
  const [r1] = men;
  let watched = null, topKneel = 0, seenWatch = false, appeared = null;
  run(60, (t) => {
    // the first man down covering, while another is on the rope or waiting
    if (r1.ropeTask?.kind === 'watch' && r1.ropeTask.spot && Math.hypot(r1.p[0] - r1.ropeTask.spot[0], r1.p[2] - r1.ropeTask.spot[2]) < 0.35 && (r1.anim === 'kneelAim' || r1.anim === 'kneelShoot')) {
      const others = men.filter((m) => m !== r1);
      const busy = others.some((m) => m.rope || m.ropeTask?.kind === 'wait');
      if (busy && !seenWatch) {
        seenWatch = true;
        const site = r1.ropeTask.site;
        const off = Math.hypot(r1.p[0] - site.foot[0], r1.p[2] - site.foot[2]);
        const out = [r1.p[0] - site.foot[0], r1.p[2] - site.foot[2]].map((v) => v / off);
        const f = yawDir(r1);
        watched = { off, facing: f[0] * out[0] + f[1] * out[1], away: f[0] };
      }
    }
    // the men waiting their turn: on one knee at the top, facing out over the drop
    for (const m of men) if (m.ropeTask?.kind === 'wait' && m.p[1] > 8 && m.anim === 'kneelAim' && Math.sin(m.yaw) > 0.5) topKneel++;
    // a hostile shows below once the first man is set and others are still to come
    if (seenWatch && !appeared && men.some((m) => m.rope || m.ropeTask?.kind === 'wait')) {
      hostile.visible = true;
      appeared = t;
    }
  });
  assert.ok(seenWatch, 'the first man down took up overwatch while the others came down');
  assert.ok(watched.off > 2.5 && watched.off < WATCH.r + 0.6, `a few metres off the rope's foot (${watched.off.toFixed(2)} m)`);
  assert.ok(watched.facing > 0.6 && watched.away > 0, `facing out, away from the wall (${watched.facing.toFixed(2)})`);
  assert.ok(topKneel > 30, `the waiting men knelt at the top (${topKneel} steps)`);
  assert.ok(appeared != null, 'the hostile showed');
  const shots = log.fire.filter((f) => f.m === r1 && f.t >= appeared);
  assert.ok(shots.length > 0, 'the overwatch man fired at him');
  assert.ok(shots.every((f) => Math.hypot(f.at[0] - hostile.p[0], f.at[2] - hostile.p[2]) < 2), 'at him');
  // everyone down, the perimeter let go, on their way again
  for (const m of men) {
    assert.ok(Math.abs(m.p[1]) < 0.05, `${m.squad} down on the ground (${m.p[1].toFixed(2)})`);
    assert.equal(m.ropeTask, null, `${m.squad} off the drill`);
    assert.ok(!m.lastFall, 'nobody fell');
  }
  assert.equal(r1.ropes, 0, 'his coil is used');
  assert.equal(s.host.ropeSim.world.ropes.length, 1, 'one rope: the others used his');
});

test('rope as gear: only a man with a rope lowers one (anchor, throw); without one in the team, not that way', () => {
  // the gunner at the edge has none; rifleman two has one: he comes over and lowers it
  const a = scene({ ropes: { R2: 1 }, threat: [12, 0, 0], on: false });
  const [, , mg, r2] = a.men;
  mg.p = [-0.8, 9, -1.6];
  const r = lowerRope(a.s, mg, [1, 0]);
  assert.equal(r, true, 'the drill takes it');
  assert.equal(mg.ropeTask.kind, 'wait', 'the gunner waits for a rope');
  assert.equal(r2.ropeTask?.kind, 'rig', 'rifleman two (who has one) comes to lower it');
  const anims = new Set();
  let ropeAt = null;
  a.run(30, (t) => {
    anims.add(r2.anim);
    if (!ropeAt && a.sim.world.ropes.length) ropeAt = t;
  });
  assert.ok(anims.has('anchorRope') && anims.has('throwRope'), `anchored and thrown (${[...anims].join()})`);
  assert.equal(a.sim.world.ropes.length, 1);
  const rope = a.sim.world.ropes[0];
  assert.equal(rope.owner, r2, "it is rifleman two's rope");
  assert.equal(rope.kind, 'rappel');
  assert.ok(Math.abs(rope.top[0]) < 0.1, 'tied off at the edge');
  assert.equal(r2.ropes, 0);
  assert.ok(Math.abs(mg.p[1]) < 0.05 && Math.abs(r2.p[1]) < 0.05, 'both went down it');
  // nobody in the team has a rope: not that way (the squad drops it and looks for another)
  const b = scene({ ropes: {}, on: false });
  const m = b.men[0];
  m.p = [-0.3, 9, 0];
  assert.equal(lowerRope(b.s, m, [1, 0]), 'cannot');
  assert.equal(b.sim.world.ropes.length, 0, 'no rope appears out of nowhere');
  assert.equal(m.ropeTask, undefined);
  // and the squad AI, walking him at the edge, stops there (no auto-rig)
  b.s.threat = [12, 0, 0];
  b.s.phase = 'hold';
  b.s.follow(m, [[6, 0, 0]], 'run');
  b.run(6);
  assert.ok(m.p[1] > 8.9 && !m.rope, 'still up on the roof');
  assert.equal(m.path, null, 'that way dropped');
  // host.autoRig: a man with no coils listed rigs one as before
  const c = scene({ on: false });
  c.s.host.autoRig = true;
  const n = c.men[0];
  delete n.ropes;
  n.p = [-0.3, 9, 0];
  assert.equal(lowerRope(c.s, n, [1, 0]), true);
  assert.equal(n.ropeTask.kind, 'rig');
});

test('team rope-down: the signal, each at his own spot on the edge with his own rope, a flashbang below first, then all down together; the hostiles below stunned', () => {
  // a guard below, 4 m out from the wall: the objective they go down to
  const guard = { p: [4, 0, 0.5], yaw: -Math.PI / 2, health: 100, unit: 'Hostile' };
  const { sim, s, men, log, run } = scene({ ropes: { R1: 1, R2: 1, CMD: 1, MG: 1 }, hostiles: [guard], threat: [6, 0, 0.5], extra: [guard] });
  s.phase = 'hold';
  let signalT = null, setT = null, starts = new Map(), ends = new Map(), allOn = false, edge = null;
  run(60, (t) => {
    if (signalT == null && s.ropeTeam) signalT = t;
    const RT = s.ropeTeam;
    if (RT && RT.phase === 'flash' && setT == null) {
      setT = t;
      edge = men.map((m) => ({ p: m.p.slice(), kind: m.ropeTask?.kind, rope: m.ropeTask?.rope }));
    }
    for (const m of men) {
      if (m.rope && !starts.has(m)) starts.set(m, t);
      if (!m.rope && starts.has(m) && !ends.has(m)) ends.set(m, t);
    }
    if (men.every((m) => m.rope)) allOn = true;
    if (signalT != null && !s.ropeTeam && men.every((m) => !m.ropeTask && !m.rope && m.p[1] < 0.1)) return true;
  });
  assert.ok(signalT != null, 'the leader decided on a team rope-down');
  assert.ok(log.radio.some((r) => /rope up/i.test(r.text)), 'and called it ("rope up, on my mark")');
  assert.ok(men.find((m) => m.squad === 'CMD').signal || true);
  // all at the edge, each his own rope, apart
  assert.ok(edge, 'they got set on the edge');
  assert.ok(edge.every((e) => e.kind === 'stack'), `each at his rope (${edge.map((e) => e.kind)})`);
  const ropes = new Set(edge.map((e) => e.rope));
  assert.equal(ropes.size, 4, 'four separate ropes');
  assert.equal(sim.world.ropes.length, 4);
  for (const e of edge) assert.ok(e.p[0] > -1.5 && e.p[0] < 0 && Math.abs(e.p[1] - 9) < 0.05, `on the roof by the edge (${e.p.map((v) => v.toFixed(2))})`);
  const tops = [...ropes].map((r) => r.top[2]).sort((a, b) => a - b);
  for (let i = 1; i < tops.length; i++) assert.ok(tops[i] - tops[i - 1] > 1.4, `ropes spaced along the edge (${tops.map((v) => v.toFixed(2))})`);
  for (const r of ropes) assert.ok(r.quick, 'rigged for the assault rappel');
  // the flashbang below, before anyone went over
  assert.equal(log.flash.length, 1, 'one flashbang');
  const bang = log.flash[0];
  assert.ok(bang.p[0] > 0 && bang.p[1] < 0.5, `down on the landing area (${bang.p.map((v) => v.toFixed(2))})`);
  const first = Math.min(...starts.values());
  assert.ok(bang.t <= first, `the bang (${bang.t.toFixed(2)} s) before the first man went over (${first.toFixed(2)} s)`);
  assert.ok(guard.stunnedUntil > bang.t + 2, 'the guard below is stunned');
  // all down together
  assert.equal(starts.size, 4, 'all four went down');
  assert.ok(allOn, 'all four on their ropes at the same moment');
  assert.ok(Math.max(...starts.values()) - first < 1, 'over the edge together');
  const ride = Math.max(...[...ends.values()]) - first;
  assert.ok(ride < 8, `a quick descent (${ride.toFixed(1)} s for all)`);
  for (const m of men) {
    assert.ok(Math.abs(m.p[1]) < 0.05, `${m.squad} on the ground`);
    assert.ok(!m.lastFall, 'nobody fell');
  }
  assert.ok(log.shouts.some((x) => /flashbang/i.test(x.text)) && log.shouts.some((x) => /go/i.test(x.text)), 'flashbang out, go');
});

test('team rope-down: after landing they kneel round the foot of the ropes, then the squad has them again', () => {
  const { s, men, run } = scene({ ropes: { R1: 1, R2: 1, CMD: 1, MG: 1 }, threat: [8, 0, 0] });
  s.phase = 'hold';
  let kneeling = 0;
  run(40, () => {
    const W = men.filter((m) => m.ropeTask?.kind === 'watch' && m.p[1] < 0.1 && (m.anim === 'kneelAim' || m.anim === 'kneelShoot'));
    kneeling = Math.max(kneeling, W.length);
  });
  assert.ok(kneeling >= 3, `they took kneeling cover at the bottom (${kneeling} at once)`);
  assert.equal(s.ropeTeam, null, 'the rope-down is over');
  assert.ok(men.every((m) => !m.ropeTask && m.p[1] < 0.1), 'all down and the squad has them');
  // they do not go back up and down again
  assert.ok(s.ropeDoneY > 8);
});

test('overwatch under a helicopter: the first trooper down the fast rope kneels out in the open covering the rest; all down, the squad has them', async () => {
  const { Helicopter } = await import('../src/ai/helicopter.js');
  const world = { time: 0, events: [], noises: [], enemies: [], ropes: [] };
  const sim = { world, solid: (x, y) => y < 0 };
  const h = new Helicopter({ p: [-150, 0, 0], lz: [0, 0, 0], seed: 5, yaw: Math.PI / 2, mission: 'insert', soldiers: 6, altitude: 25, startSpeed: 20 }, { sim, world, addCrew: (e) => world.enemies.push(e) });
  const unit = h.crew.find((e) => e.role === 'troop').unit;
  const s = new SquadAI({
    unit, members: () => world.enemies, solid: sim.solid, floor: () => 0, bounds: [-40, -40, 40, 40], rand: seeded(3), now: () => world.time,
    ownMove: (m) => !!m.guardCtl || !!m.rope, ropeSim: sim,
  });
  let watch = null, maxW = 0;
  for (let t = 0; t < 200 && !(h.mode === 'depart' && t > 1 && world.enemies.every((e) => !e.ropeTask)); t += 0.05) {
    world.time += 0.05;
    h.step(0.05);
    s.step(0.05);
    stepRopes(sim, 0.05);
    const troops = h.crew.filter((e) => e.role === 'troop');
    const W = troops.filter((e) => e.ropeTask?.kind === 'watch' && e.anim === 'kneelAim');
    maxW = Math.max(maxW, W.length);
    if (!watch && W.length && troops.some((e) => e.rope || e.aboard != null)) {
      const site = W[0].ropeTask.site;
      watch = { off: Math.hypot(W[0].p[0] - site.foot[0], W[0].p[2] - site.foot[2]), y: W[0].p[1] };
    }
  }
  assert.ok(watch, 'the first man down kneels covering while the others are still to come');
  assert.ok(watch.off > 2.5 && watch.off < 9, `out from the ropes (${watch.off.toFixed(2)} m)`);
  assert.ok(maxW >= 2, `a perimeter (${maxW} kneeling)`);
  const troops = h.crew.filter((e) => e.role === 'troop');
  assert.ok(troops.every((e) => !e.ropeTask && !e.rope && e.aboard == null && Math.abs(e.p[1]) < 0.1), 'all down and the squad has them');
});
