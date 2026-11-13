// The squad on the rig page's range: a deck 3 m up with a staircase. Before contact a rifleman
// climbs it to look round; on contact the gunner takes it as his overwatch (it sees over the
// walls), and the climb goes by the stairs, not up the side.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SquadAI } from '../src/ai/squad.js';

const DECK = { x0: -13, x1: -5.8, z0: -4, z1: 2, h: 3 };
const STAIRS = { x0: -7, x1: -5.8, z0: 2, z1: 8 };
const stairY = (z) => (DECK.h * (STAIRS.z1 - z)) / (STAIRS.z1 - STAIRS.z0);
const onStairs = (x, z) => x >= STAIRS.x0 && x <= STAIRS.x1 && z >= STAIRS.z0 && z <= STAIRS.z1;
const onDeck = (x, z) => x >= DECK.x0 && x <= DECK.x1 && z >= DECK.z0 && z <= DECK.z1;
const floorAt = (x, z, from = 0) => {
  if (onStairs(x, z) && from > stairY(z) - 1.2) return stairY(z);
  if (onDeck(x, z) && from > DECK.h / 2) return DECK.h;
  return 0;
};
const walls = [[-3.5, 5.5, 3, 0.3], [4.6, 1.5, 0.3, 3], [-1.5, -3.6, 3, 0.3], [5.4, -7.4, 3, 0.3], [-5, -6.5, 0.3, 3]];
const wall = (x, y, z) => y < 1.25 && walls.some(([cx, cz, w, d]) => Math.abs(x - cx) < w / 2 && Math.abs(z - cz) < d / 2);
const slab = (x, y, z) => onDeck(x, z) && y > DECK.h - 0.25 && y < DECK.h;
const solid = (x, y, z) => wall(x, y, z) || slab(x, y, z);
function path3d(a, b) {
  const up = b[1] > a[1] + 1.5;
  const sx = (STAIRS.x0 + STAIRS.x1) / 2, foot = [sx, 0, STAIRS.z1 + 0.6], head = [sx, DECK.h, STAIRS.z0 - 0.6];
  const flight = [];
  for (let z = STAIRS.z1; z >= STAIRS.z0 - 0.01; z -= 0.5) flight.push([sx, stairY(z), z]);
  if (up) return [foot, ...flight, head, b.slice()];
  return [head, ...flight.reverse(), foot, b.slice()];
}
const lineOfSight = (a, b) => {
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.3);
  for (let k = 1; k < n; k++) {
    const t = k / n;
    if (solid(a[0] + (b[0] - a[0]) * t, 1 + a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)) return false;
  }
  return true;
};

function run() {
  const members = [];
  for (const [squad, x, z] of [['CMD', -1, 10], ['MG', 1, 10.2], ['R1', -1.4, 11.6], ['R2', 1.4, 11.8]]) members.push({ p: [x, 0, z], yaw: Math.PI, squad, unit: 'Alpha' });
  const hostile = { p: [-2, 0, -12], dead: false };
  let visible = false;
  const s = new SquadAI({
    unit: 'Alpha',
    members: () => members,
    solid,
    floor: (x, z, m) => floorAt(x, z, m ? m.p[1] : 0),
    path3d,
    lookouts: () => [[DECK.x1 - 0.6, DECK.h, DECK.z0 + 0.6], [(DECK.x0 + DECK.x1) / 2, DECK.h, DECK.z0 + 0.6], [DECK.x1 - 0.6, DECK.h, (DECK.z0 + DECK.z1) / 2]],
    indoors: (p) => onDeck(p[0], p[2]) || onStairs(p[0], p[2]),
    lineOfSight,
    hostiles: () => (visible ? [hostile] : []),
    bounds: [-16, -16, 16, 16],
    threat: null,
    fire: () => {},
  });
  s.on = true;
  s.threat = null;
  return { s, members, show: () => (visible = true) };
}

test('before contact a rifleman climbs the stairs to the deck and watches from up there', () => {
  const { s, members } = run();
  const r1 = members.find((m) => m.squad === 'R1');
  let onFlight = false;
  for (let t = 0; t < 30; t += 0.05) {
    s.step(0.05);
    if (onStairs(r1.p[0], r1.p[2]) && r1.p[1] > 0.5 && r1.p[1] < 2.5) onFlight = true;
  }
  assert.ok(onFlight, 'he went up the flight');
  assert.ok(r1.p[1] > 2.9 && onDeck(r1.p[0], r1.p[2]), `on the deck: ${r1.p.map((v) => v.toFixed(1))}`);
});

test('on contact the gunner takes the deck as overwatch; the team advances on the ground', () => {
  const { s, members, show } = run();
  const mg = members.find((m) => m.squad === 'MG');
  for (let t = 0; t < 3; t += 0.05) s.step(0.05);
  show();
  let mgUp = false;
  for (let t = 0; t < 60; t += 0.05) {
    s.step(0.05);
    if (mg.p[1] > 2.9 && onDeck(mg.p[0], mg.p[2])) mgUp = true;
  }
  assert.ok(mgUp, `the gunner went up: ${mg.p.map((v) => v.toFixed(1))}`);
  const down = members.filter((m) => m.squad === 'CMD' || m.squad === 'R2');
  assert.ok(down.every((m) => m.p[1] < 0.5), 'the others are on the ground');
});
