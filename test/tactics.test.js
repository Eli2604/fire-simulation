import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SquadAI } from '../src/ai/squad.js';
import { rooms, junctionAt, moveGroup } from '../src/ai/tactics.js';

/** Free space as rectangles [x0, z0, x1, z1]; everything else is wall (up to 1.25 m). */
const fromRects = (rects) => (x, y, z) => y < 1.25 && !rects.some(([a, b, c, d]) => x >= a && x <= c && z >= b && z <= d);

function team({ solid, floor = () => 0, bounds, at = [0, 0, 0], threat = null, hostiles = [], host = {} }) {
  const members = [];
  for (const [squad, x, z] of [['CMD', -0.4, 0], ['MG', 0.4, 0.6], ['R1', -0.4, 1.2], ['R2', 0.4, 1.8]]) members.push({ p: [at[0] + x, at[1], at[2] + z], yaw: Math.PI, squad, unit: 'Alpha', health: 100 });
  const log = { radio: [], shouts: [], flash: [], signals: new Set() };
  const s = new SquadAI({
    unit: 'Alpha', members: () => members, solid, floor, bounds, threat,
    hostiles: () => hostiles, lineOfSight: () => false, visibility: () => 60,
    radio: (m, text, kind) => log.radio.push({ m, text, kind }),
    shout: (m, text) => log.shouts.push({ m, text }),
    flashbang: (m, from, vel) => log.flash.push({ m, from, vel }),
    fire: () => {},
    ...host,
  });
  const step = (t, each) => {
    for (let k = 0; k < t / 0.05; k++) {
      s.step(0.05);
      for (const m of members) if (m.signal) log.signals.add(m.signal.text);
      each?.();
    }
  };
  return { s, members, log, step };
}

test('the ground: widths, doorways, rooms, a T junction', () => {
  // a corridor (1.4 m) along z, a room off it through a 1 m door, a T at its north end
  const solid = fromRects([[-0.7, -6, 0.7, 10], [0.7, 2, 1.8, 3], [1.8, 0, 7, 5], [-6, -6.7, 6, -5.3]]);
  const { s } = team({ solid, bounds: [-8, -9, 9, 12] });
  s.rebuildNav();
  const wc = s.width[s.cellOf(0, 6)], wr = s.width[s.cellOf(4.4, 2.5)];
  assert.ok(wc < 1.6, `corridor narrow (${wc.toFixed(1)} m)`);
  assert.ok(wr > 3, `room wide (${wr.toFixed(1)} m)`);
  const R = rooms(s);
  assert.ok(R.some((r) => Math.abs(r.c[0] - 4.4) < 1.5 && r.door && r.door[0] > 0.3 && r.door[0] < 2.2), 'the room and its doorway');
  assert.ok(junctionAt(s, [0, 0, -6]), 'a T at the end of the corridor');
  assert.equal(junctionAt(s, [0, 0, 7]), null, 'no junction mid-corridor');
});

test('far off in the open: the commander signals a formation, they move as one, each watching a sector; bounding near the threat', () => {
  const { s, members, log, step } = team({ solid: () => false, bounds: [-50, -50, 50, 50], at: [0, 0, 40], threat: [0, 0, -30] });
  let maxSpread = 0, formed = false;
  const sectors = new Set();
  step(40, () => {
    if (s.phase !== 'formation') return;
    formed = true;
    for (const m of members) if (m.sector != null) sectors.add(m.sector);
    for (const a of members) for (const b of members) maxSpread = Math.max(maxSpread, Math.hypot(a.p[0] - b.p[0], a.p[2] - b.p[2]));
  });
  assert.ok(formed, 'moved in formation');
  assert.ok(log.signals.has('DIAMOND'), `the commander signalled a diamond (${[...log.signals]})`);
  assert.ok(sectors.has(0) && sectors.has(180) && sectors.has(-90) && sectors.has(90), 'front, flanks and rear covered');
  assert.ok(maxSpread < 10, `as one (spread ${maxSpread.toFixed(1)} m)`);
  step(40);
  const c = members.reduce((a, m) => a + m.p[2] / 4, 0);
  assert.ok(c < 0, `closed in (${c.toFixed(1)})`);
  assert.ok(log.signals.has('BOUNDING OVERWATCH'), 'back to bounding near the threat');
});

test('narrow: they line up in file, and at a T the commander splits the team; they join up at the objective', () => {
  // a corridor north to a T; both arms lead north to a room (the objective)
  const solid = fromRects([[-0.7, -0.7, 0.7, 14], [-8.7, -0.7, 8.7, 0.7], [-8.7, -12, -7.3, 0.7], [7.3, -12, 8.7, 0.7], [-9, -16, 9, -12]]);
  const { s, members, log, step } = team({ solid, bounds: [-11, -18, 11, 16], at: [0, 0, 11] });
  s.rebuildNav();
  moveGroup(s, members, [0, 0, -14]);
  let file = false, split = null;
  step(80, () => {
    // in the corridor: one behind the other
    if (members.every((m) => Math.abs(m.p[0]) < 0.75 && m.p[2] > 2 && m.p[2] < 12)) {
      const zs = members.map((m) => m.p[2]).sort((a, b) => a - b);
      if (zs.every((z, i) => !i || z - zs[i - 1] > 1.2)) file = true;
    }
    if (s.split && !split) split = { acting: s.split.acting.squad, groups: s.groups.length };
  });
  assert.ok(log.signals.has('FILE'), 'the commander signalled a file');
  assert.ok(file, 'in file through the corridor');
  assert.ok(split, 'split at the T');
  assert.equal(split.acting, 'MG', 'the gunner is acting commander of the other half');
  assert.equal(split.groups, 2);
  const xs = members.map((m) => m.p[0]);
  assert.ok(!s.split && log.signals.has('JOIN UP'), 'joined up again');
  assert.ok(members.every((m) => m.p[2] < -11), 'all at the objective');
  assert.ok(Math.max(...xs) - Math.min(...xs) < 12);
});

test('into a room: they stack up at the door, a flashbang goes in, then they enter', () => {
  // a corridor east into a room; the threat in the room
  const solid = fromRects([[-8, -0.7, 2, 0.7], [2, -0.5, 2.8, 0.5], [2.8, -4, 9, 4]]);
  const { s, members, log, step } = team({ solid, bounds: [-10, -6, 11, 6], at: [-6, 0, -0.8], threat: [7, 0, 0] });
  let stacked = false, flashAt = -1, inAt = -1;
  step(60, () => {
    if (s.breach) stacked = true;
    if (log.flash.length && flashAt < 0) flashAt = s.time;
    if (flashAt > 0 && inAt < 0 && members.some((m) => m.p[0] > 3.2)) inAt = s.time;
  });
  assert.ok(stacked, 'stacked at the door');
  assert.ok(log.flash.length >= 1, 'a flashbang thrown in');
  assert.ok(log.flash[0].vel[0] > 0, 'into the room');
  assert.ok(log.shouts.some((x) => /Flashbang out/.test(x.text)) && log.shouts.some((x) => /Go, go, go/.test(x.text)));
  assert.ok(inAt > flashAt + 1.5, `in after the bang (${(inAt - flashAt).toFixed(1)} s)`);
});

test('a building: they work their way up by the stairs and clear the floor room by room', () => {
  // ground floor open; a ramp (stairs) at x 7..9 from z 8 (y 0) to z 0 (y 3); upstairs a hall
  // (2 m wide) along z = 0 and two rooms off it, through 1 m doors
  const up = fromRects([[-10, -1, 10, 1], [-9, 2, -3, 8], [-6.5, 1, -5.5, 2], [-9, -8, -3, -2], [-6.5, -2, -5.5, -1]]);
  const ramp = (x, z) => x > 6.6 && x < 9.4 && z > -0.2 && z < 8.2;
  let refY = 0;
  const members = [];
  const floor = (x, z, m) => {
    const from = m ? m.p[1] : refY;
    if (ramp(x, z) && from < 3.4) return Math.max(0, Math.min(3, (3 * (8 - z)) / 8));
    return from > 1.5 ? 3 : 0;
  };
  const solid = (x, y, z) => (y > 3 ? up(x, y - 3, z) && !ramp(x, z) : false);
  const path3d = (a, b) => {
    const pts = [[8, 0, 9]];
    for (let z = 8; z >= 0; z -= 0.5) pts.push([8, (3 * (8 - z)) / 8, z]);
    for (let k = 1; k <= 6; k++) pts.push([8 + ((b[0] - 8) * k) / 6, 3, (b[2] * k) / 6]);
    return pts;
  };
  const T = team({ solid, floor, bounds: [-11, -11, 11, 11], at: [2, 0, 6], host: { path3d } });
  members.push(...T.members);
  const { s, log, step } = T;
  s.rebuildNav();
  s.investigate([-6, 3, 5], 'noise');
  step(160, () => (refY = members.reduce((a, m) => a + m.p[1], 0) / members.length));
  assert.ok(log.radio.some((r) => /floor by floor/.test(r.text)), 'the commander calls it');
  assert.ok(members.every((m) => m.p[1] > 2.5), 'all upstairs');
  assert.ok(log.flash.length >= 1, 'flashbangs at the doors');
  assert.ok(log.shouts.some((x) => /Clear/.test(x.text)), 'rooms called clear');
  assert.ok(log.radio.some((r) => /floor 1 clear/.test(r.text)), 'the floor called clear');
});
