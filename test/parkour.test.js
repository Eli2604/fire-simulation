import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probe, moveFor, ability, rootAt, geoFor, durFor, MOVES, PARKOUR, LIMITS } from '../src/ai/parkour.js';
import { SquadAI } from '../src/ai/squad.js';
import { PARKOUR_ACTS, parkourHeight } from '../src/rig/objects.js';

/** A flat world (solid below y 0) with boxes [x0, z0, x1, z1, top]. */
function world(boxes) {
  const solid = (x, y, z) => y < 0 || boxes.some(([x0, z0, x1, z1, top, bot = 0]) => x >= x0 && x < x1 && z >= z0 && z < z1 && y >= bot && y < top);
  // the floor under (x, z) looking down from `from` (as the simulation's floorAt does)
  const floor = (x, z, from) => {
    for (let y = from; y > from - 3.5; y -= 0.05) if (solid(x, y - 0.025, z)) return Math.round(y / 0.05) * 0.05;
    return null;
  };
  return { solid, floor };
}
const ahead = (boxes, p = [0, 0, 0], dir = [0, 1]) => probe(world(boxes).solid, p, dir);

test('traversal is classified by the obstacle height', () => {
  const fit = ability({});
  // a thin wall 0.3 m thick, 0.7 m ahead, of each height
  const wall = (h) => ahead([[-2, 0.7, 2, 1.0, h]]);
  assert.equal(wall(0.3), null, 'a kerb: stepped over');
  assert.equal(moveFor(wall(0.6), fit, 'run'), 'vaultStep');
  assert.equal(moveFor(wall(0.9), fit, 'run'), 'vaultSpeed');
  assert.equal(moveFor(wall(0.9), fit, 'walk'), 'vaultSide');
  assert.equal(moveFor(wall(1.3), fit, 'run'), null, 'too high to vault, too thin to climb onto');
  const g = wall(0.9);
  assert.ok(Math.abs(g.face - 0.7) < 0.06 && Math.abs(g.h - 0.9) < 0.06 && g.thin && Math.abs(g.thick - 0.3) < 0.06, JSON.stringify(g));
  // a ledge (a block 3 m deep)
  const ledge = (h) => ahead([[-2, 0.6, 2, 3.6, h]]);
  assert.equal(moveFor(ledge(1.0), fit, 'walk'), 'mantle');
  assert.equal(moveFor(ledge(1.4), fit, 'walk'), 'mantle');
  assert.equal(moveFor(ledge(1.4), fit, 'run'), 'climbJump');
  assert.equal(moveFor(ledge(2.0), fit, 'walk'), 'climbJump');
  assert.equal(moveFor(ledge(2.6), fit, 'run'), null, 'out of reach');
  assert.equal(ahead([[-2, 0.6, 2, 3.6, 4]])?.type, 'wall');
  // a ledge under a roof with no room on top: not climbed
  assert.equal(moveFor(ahead([[-2, 0.6, 2, 3.6, 1.8], [-2, 0.6, 2, 3.6, 3, 2.5]]), fit, 'run'), null);
  // drops: standing on a block whose edge is 0.5 m ahead
  const drop = (h) => probe(world([[-3, -3, 3, 0.5, h, -9]]).solid, [0, h, 0], [0, 1]);
  assert.equal(drop(0.4), null, 'a step down');
  assert.equal(moveFor(drop(1.4), fit), 'dropDown');
  assert.equal(moveFor(drop(2.6), fit), 'dropRoll');
  assert.equal(moveFor(drop(3.4), fit), null, 'too deep');
  assert.ok(Math.abs(drop(1.4).h - 1.4) < 0.06 && Math.abs(drop(1.4).face - 0.5) < 0.06);
});

test('wounded men do not climb and vault slowly; a heavy load limits the climb', () => {
  const ledge = (h) => ahead([[-2, 0.6, 2, 3.6, h]]);
  const hurt = ability({ wounds: { legL: 1 } });
  assert.ok(hurt.wounded);
  assert.equal(moveFor(ledge(1.2), hurt, 'walk'), null);
  assert.equal(moveFor(ledge(2.0), hurt, 'run'), null);
  assert.equal(moveFor(ahead([[-2, 0.7, 2, 1.0, 0.9]]), hurt, 'run'), 'vaultSide', 'he still vaults, the slow way');
  assert.ok(durFor('vaultSide', hurt) > durFor('vaultSide', ability({})) * 1.4);
  assert.equal(moveFor(probe(world([[-3, -3, 3, 0.5, 2.6, -9]]).solid, [0, 2.6, 0], [0, 1]), hurt), null, 'no deep drop');
  assert.equal(moveFor(ledge(2.2), ability({ carry: 32 }), 'run'), null, 'loaded: not that high');
  assert.equal(moveFor(ledge(1.8), ability({ carry: 32 }), 'run'), 'climbJump');
  assert.equal(moveFor(ledge(1.2), ability({ carry: 45 }), 'walk'), null, 'too heavy to climb at all');
});

test('each move\'s root path ends where it should, at the right height', () => {
  for (const k of Object.keys(MOVES)) {
    const g = MOVES[k].geo;
    const [f0, u0] = rootAt(k, 0, g);
    assert.equal(f0, 0);
    assert.equal(u0, 0);
    const [f, up] = rootAt(k, 1, g);
    const want = k === 'slideCover' ? g.pre : g.pre + (g.thick && k.startsWith('vault') ? g.thick : 0) + g.post;
    assert.ok(Math.abs(f - want) < 1e-9, `${k}: ends ${f.toFixed(2)} m on (want ${want})`);
    const wantUp = k.startsWith('climb') || k === 'mantle' ? g.h : k.startsWith('drop') ? -g.h : -g.drop;
    assert.ok(Math.abs(up - wantUp) < 1e-9, `${k}: ends ${up.toFixed(2)} m up (want ${wantUp})`);
    // forward all the way (no stepping back), smoothly
    let prev = 0;
    for (let u = 0.02; u <= 1.0001; u += 0.02) {
      const [fu] = rootAt(k, u, g);
      assert.ok(fu >= prev - 1e-9, `${k}: never back (${u.toFixed(2)})`);
      prev = fu;
    }
  }
  // a higher wall: the same move, the root (and the body on it) goes higher over it
  const lo = rootAt('vaultSpeed', 0.44, { h: 0.8 }), hi = rootAt('vaultSpeed', 0.44, { h: 1.1 });
  assert.ok(Math.abs(hi[1] - lo[1] - 0.3) < 0.02);
  // a climb onto a 2.2 m ledge ends 2.2 m up, 0.5 m past its edge
  const g = geoFor('climbJump', ahead([[-2, 0.8, 2, 3.6, 2.2]]));
  const e = rootAt('climbJump', 1, g);
  assert.ok(Math.abs(e[1] - 2.2) < 0.06 && Math.abs(e[0] - 1.3) < 0.06, e.join());
});

test('the clips play on the root path: standing where the root ends, over the wall in the middle', async () => {
  const { operatorClips, LABELS, ONCE } = await import('../src/operator/rig.js');
  const c = operatorClips();
  for (const k of Object.keys(PARKOUR)) {
    assert.ok(c[k] && c[k + '_u'] && c[k + '_k'], `${k}: armed, unarmed and knife versions`);
    assert.ok(LABELS[k] && ONCE[k], k);
    assert.ok(Math.abs(c[k].duration - MOVES[k].dur) < 1e-6, k);
    const hp = c[k].tracks.find((t) => t.name === 'hips.position').values;
    const n = hp.length / 3;
    // the hips relative to the root at the start and the end: about where they are standing
    for (const i of [0, n - 1]) {
      const [x, y, z] = [hp[3 * i], hp[3 * i + 1], hp[3 * i + 2]];
      assert.ok(Math.abs(x) < 0.05 && Math.abs(z) < 0.1, `${k} ${i ? 'end' : 'start'}: hips over the root (${x.toFixed(2)}, ${z.toFixed(2)})`);
      if (k !== 'slideCover' || !i) assert.ok(y > 0.85 && y < 1.0, `${k}: standing height ${y.toFixed(2)}`);
    }
    if (!k.startsWith('vault')) continue;
    // halfway over: the hips (root + clip) above the wall's top
    const g = MOVES[k].geo, uo = { vaultSpeed: 0.44, vaultSide: 0.5, vaultStep: 0.53 }[k];
    const i = Math.round(uo * (n - 1)), y = hp[3 * i + 1] + rootAt(k, uo, g)[1];
    assert.ok(y > g.h + 0.15, `${k}: hips ${y.toFixed(2)} m over a ${g.h} m wall`);
  }
});

/** A squad AI on a flat range with these boxes; one man at p. */
function squadOn(boxes, m) {
  const { solid, floor } = world(boxes);
  const members = [m];
  return new SquadAI({ unit: 'Alpha', members: () => members, solid, floor: (x, z, who) => floor(x, z, (who ? who.p[1] : 0) + 1.2) ?? 0, bounds: [-10, -10, 10, 10], threat: [0, 0, -9] });
}
const pathLen = (p0, pts) => pts.reduce((a, p, i) => a + Math.hypot(p[0] - (i ? pts[i - 1] : p0)[0], p[2] - (i ? pts[i - 1] : p0)[2]), 0);

test('routes go over a low wall (a vault) when that is shorter, round a higher one', () => {
  const m = { p: [0, 0, 4], yaw: Math.PI, squad: 'R1', unit: 'Alpha' };
  // a 12 m long wall, 0.9 m high, across the way
  const sq = squadOn([[-6, -0.15, 6, 0.15, 0.9]], m);
  const pts = sq.route(m.p, [0, 0, -4], m);
  assert.ok(pts.some((p) => p.move === 'vaultSpeed'), 'over the wall: ' + pts.map((p) => p.move ?? '').join(','));
  assert.ok(pathLen(m.p, pts) < 9.5, `straight over (${pathLen(m.p, pts).toFixed(1)} m)`);
  // the same wall 1.6 m high: round its end
  const sq2 = squadOn([[-6, -0.15, 6, 0.15, 1.6]], m);
  const pts2 = sq2.route(m.p, [0, 0, -4], m);
  assert.ok(!pts2.some((p) => p.move), 'no move');
  assert.ok(pathLen(m.p, pts2) > 14, `round it (${pathLen(m.p, pts2).toFixed(1)} m)`);
  // a short low wall: going round costs less than the vault
  const sq3 = squadOn([[-0.6, -0.15, 0.6, 0.15, 0.9]], m);
  assert.ok(!sq3.route(m.p, [0, 0, -4], m).some((p) => p.move), 'round a short one');
});

test('he vaults the wall on his way, the root path carrying him over (not through it)', () => {
  const m = { p: [0.2, 0, 4], yaw: Math.PI, squad: 'R1', unit: 'Alpha' };
  const sq = squadOn([[-6, -0.15, 6, 0.15, 0.9]], m);
  sq.rebuildNav();
  sq.follow(m, sq.route(m.p, [0.2, 0, -4], m), 'run');
  const seen = new Set();
  let maxY = 0;
  for (let t = 0; t < 8 && m.path; t += 0.05) {
    sq.move(m, 0.05);
    if (m.trav) seen.add(m.anim);
    maxY = Math.max(maxY, m.p[1]);
    // never inside the wall below its top
    if (Math.abs(m.p[2]) < 0.15 && Math.abs(m.p[0]) < 6) assert.ok(m.p[1] > 0.5, `over the wall, not through it (y ${m.p[1].toFixed(2)})`);
  }
  assert.ok(seen.has('vaultSpeed'), [...seen].join());
  assert.ok(maxY > 0.8, 'up over it');
  assert.ok(m.p[2] < -3.5 && Math.abs(m.p[1]) < 0.05, `on the far side, on the ground (${m.p.map((v) => v.toFixed(2))})`);
});

test('a wounded man does not climb: he goes round, or stops at the ledge', () => {
  // a 1.8 m block (8 m wide, 3 m deep) between him and the goal on top of it
  const box = [[-4, -1.5, 4, 1.5, 1.8]];
  const fit = { p: [0, 0, 4], yaw: Math.PI, squad: 'R1', unit: 'Alpha' };
  const sq = squadOn(box, fit);
  const up = sq.route(fit.p, [0, 1.8, 0], fit);
  assert.ok(up.some((p) => p.move === 'climbJump'), 'a fit man climbs up');
  const hurt = { p: [0, 0, 4], yaw: Math.PI, squad: 'R1', unit: 'Alpha', wounds: { legR: 1 } };
  const sq2 = squadOn(box, hurt);
  assert.ok(!sq2.route(hurt.p, [0, 1.8, 0], hurt).some((p) => p.move), 'no climb in his route');
  // sent straight at it anyway: he stops at the foot of it
  sq2.rebuildNav();
  sq2.follow(hurt, [[0, 1.8, 0]], 'run');
  for (let t = 0; t < 4 && hurt.path; t += 0.05) sq2.move(hurt, 0.05);
  assert.ok(!hurt.trav && hurt.p[1] < 0.1 && hurt.p[2] > 1.5, `stopped below it (${hurt.p.map((v) => v.toFixed(2))})`);
});

test('the rig has the parkour acts, each with an obstacle height range', () => {
  for (const k of ['vaultSpeed', 'vaultSide', 'climbJump', 'mantle', 'dropRoll', 'slideCover']) assert.ok(PARKOUR_ACTS[k], k);
  assert.equal(PARKOUR_ACTS.vaultSpeed.label, 'Vault (speed)');
  assert.equal(PARKOUR_ACTS.dropRoll.label, 'Drop down (roll)');
  assert.equal(parkourHeight('climbJump', 5), PARKOUR_ACTS.climbJump.max);
  assert.equal(parkourHeight('mantle'), PARKOUR_ACTS.mantle.h);
  for (const [k, a] of Object.entries(PARKOUR_ACTS)) {
    assert.ok(PARKOUR[k], k);
    assert.ok(a.min <= a.h && a.h <= a.max, k);
  }
  assert.ok(PARKOUR_ACTS.climbJump.max <= LIMITS.climb[1] && PARKOUR_ACTS.vaultSpeed.max <= LIMITS.vault[1]);
});
