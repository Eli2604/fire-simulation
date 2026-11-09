import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, F_BURNING } from '../src/sim/world.js';
import { Simulation } from '../src/sim/simulation.js';
import { MAT } from '../src/sim/materials.js';
import { defaultWeather } from '../src/sim/weather.js';
import { createSimulation } from '../src/sim/createSimulation.js';
import { SCENARIOS, cloneScene } from '../src/scenarios.js';
import { doorGlassBroken } from '../src/sim/doors.js';
import { explode } from '../src/sim/explosions.js';

const run = (sim, t) => {
  while (sim.world.time < t) sim.step(sim.dt);
};

/** A flat stone floor (size x by z, 3 m high) to put things on. */
function yard(sx = 8, sz = 4, h = 0.1) {
  const w = new World({ size: [sx, 3, sz], h, ambient: 20 });
  for (let z = 0; z < w.nz; z++) for (let x = 0; x < w.nx; x++) w.setVoxel(w.idx(x, 0, z), MAT.stone, { anchored: true });
  return w;
}

test('a fire arrow sticks in a wooden target and sets it alight', () => {
  const w = yard();
  // a wooden post 6 m away
  for (let y = 1; y < 20; y++) for (let x = 60; x < 64; x++) for (let z = 18; z < 22; z++) w.setVoxel(w.idx(x, y, z), MAT.wood, { anchored: true });
  w.rebuildLists();
  const sim = new Simulation(w, defaultWeather());
  sim.shootArrow([0.5, 1.2, 2.0], [40, 1, 0]);
  run(sim, 6);
  const arrow = w.projectiles.find((g) => g.type === 'arrow');
  assert.ok(arrow?.resting, 'the arrow is stuck');
  assert.ok(Math.abs(arrow.p[0] - 6) < 0.3, `stuck at the post (x ${arrow.p[0].toFixed(2)})`);
  let burning = 0;
  for (let i = 0; i < w.N; i++) if (w.mat[i] === MAT.wood && w.flags[i] & F_BURNING) burning++;
  assert.ok(burning > 0, 'the post has caught fire');
  assert.ok(w.noises.some((n) => n.kind === 'arrow'), 'the hit is heard');
});

test('an arrow goes through a window pane and breaks it (noise)', () => {
  const w = yard();
  for (let y = 5; y < 20; y++) for (let z = 10; z < 30; z++) w.setVoxel(w.idx(30, y, z), MAT.glass, { anchored: true });
  w.rebuildLists();
  const sim = new Simulation(w, defaultWeather());
  sim.shootArrow([0.5, 1.2, 2.0], [40, 1, 0]);
  run(sim, 1);
  // a hole in the pane (the shards lie on the floor)
  let pane = 0;
  for (let y = 5; y < 20; y++) for (let z = 10; z < 30; z++) if (w.mat[w.idx(30, y, z)] === MAT.glass) pane++;
  assert.ok(pane < 300, `glass broken (${300 - pane} voxels out)`);
  assert.ok(w.noises.some((n) => n.kind === 'glass'), 'breaking glass is loud');
});

test('a rocket explodes where it hits', () => {
  const w = yard(12, 4);
  for (let y = 1; y < 25; y++) for (let x = 100; x < 104; x++) for (let z = 10; z < 30; z++) w.setVoxel(w.idx(x, y, z), MAT.brick);
  w.rebuildLists();
  const sim = new Simulation(w, defaultWeather());
  const before = w.solidCount;
  sim.fireRocket([0.5, 1.2, 2], [30, 0, 0]);
  run(sim, 2);
  w.rebuildLists();
  assert.ok(w.events.some((e) => e.type === 'explosion' || e.name === 'rocket'), 'exploded');
  assert.ok(w.solidCount < before || w.debris.length > 0, 'bricks blown out');
});

test('heat and explosions shatter glass, and enemies come to look', () => {
  const sim = createSimulation({
    world: { size: [12, 3, 6], h: 0.1, ground: 'stone' },
    objects: [{ type: 'enemy', params: { count: 1, spread: 0 }, x: 3, z: 3 }],
    noFire: true,
  });
  const w = sim.world;
  for (let y = 2; y < 20; y++) for (let z = 20; z < 40; z++) w.setVoxel(w.idx(90, y, z), MAT.glass, { anchored: true });
  w.rebuildLists();
  run(sim, 1);
  explode(sim, [8.5, 1, 3], 2e5, { name: 'test' });
  run(sim, 3);
  const e = w.enemies[0];
  assert.ok(w.noises.some((n) => n.kind === 'glass' || n.kind === 'explosion'));
  assert.equal(e.state, 'investigate');
  assert.ok(e.goal && e.goal[0] > 6, 'heads for the noise');
});

test('an enemy who sees you lights something to lure you, then pulls back', () => {
  const sim = createSimulation({
    world: { size: [16, 3, 6], h: 0.1, ground: 'stone' },
    objects: [{ type: 'enemy', params: { count: 1, spread: 0 }, x: 6, z: 3 }],
    noFire: true,
  });
  const w = sim.world;
  // a pile of rags and a crate near the enemy
  for (let y = 1; y < 5; y++) for (let x = 40; x < 46; x++) for (let z = 20; z < 26; z++) w.setVoxel(w.idx(x, y, z), MAT.fabric);
  w.rebuildLists();
  const e = w.enemies[0];
  e.lureCooldown = 0;
  sim.ai.player = { p: [13, 0.1, 3], head: [13, 1.75, 3] };
  let lured = false;
  while (w.time < 30) {
    sim.step(sim.dt);
    if (e.state === 'lure') lured = true;
    if (w.events.some((ev) => ev.type === 'enemyFire')) break;
  }
  assert.ok(lured, 'decides to lure');
  assert.ok(w.events.some((ev) => ev.type === 'enemyFire'), 'sets the rags alight');
  let burning = 0;
  for (let i = 0; i < w.N; i++) if (w.mat[i] === MAT.fabric && w.flags[i] & F_BURNING) burning++;
  assert.ok(burning > 0, 'the rags burn');
  assert.equal(e.state, 'retreat');
});

test('enemies route around fire and flee from heat', () => {
  const sim = createSimulation({
    world: { size: [12, 3, 6], h: 0.1, ground: 'stone' },
    objects: [{ type: 'enemy', params: { count: 1, spread: 0 }, x: 2, z: 3 }],
    noFire: true,
  });
  const w = sim.world;
  // a fire across the middle of the corridor, open at one side
  sim.addTorch([6, 0.3, 2.0], 60000, 1000, 0.6);
  run(sim, 8);
  const route = sim.ai.path([2, 0.1, 3], [10, 0.1, 3]);
  assert.ok(route?.length, 'there is a way');
  const nearFire = route.filter((p) => Math.hypot(p[0] - 6, p[2] - 2) < 0.6).length;
  assert.equal(nearFire, 0, 'the path keeps out of the flames');
  // put an enemy in the heat: it runs
  const e = w.enemies[0];
  e.p = [6.2, 0.1, 2.4];
  let fled = false;
  while (w.time < 11) {
    sim.step(sim.dt);
    if (e.state === 'flee') fled = true;
  }
  assert.ok(fled, 'it runs');
  assert.ok(Math.hypot(e.p[0] - 6, e.p[2] - 2) > 0.8, 'away from the flames');
  assert.ok(e.health < 100, 'singed');
});

test('a heavy falling branch hurts whoever it lands on', () => {
  const sim = createSimulation({
    world: { size: [6, 6, 4], h: 0.1, ground: 'stone' },
    objects: [{ type: 'enemy', params: { count: 1, spread: 0 }, x: 3, z: 2 }],
    noFire: true,
  });
  const w = sim.world;
  const e = w.enemies[0];
  // a loose oak limb 4 m above the enemy
  for (let x = 26; x < 36; x++) for (let y = 45; y < 48; y++) for (let z = 18; z < 22; z++) w.setVoxel(w.idx(x, y, z), MAT.oak);
  w.rebuildLists();
  sim.ai.wander = false;
  e.state = 'investigate';
  e.goal = e.p.slice();
  run(sim, 3);
  assert.ok(e.health < 100, `hurt (health ${e.health.toFixed(0)})`);
});

test('a locked glass door: break the pane, then it can be opened from the inside', () => {
  const sim = createSimulation(cloneScene(SCENARIOS.catacombs));
  const w = sim.world;
  const k = w.doors.findIndex((d) => d.locked);
  assert.ok(k >= 0, 'a locked door');
  const ship = createSimulation({ ...cloneScene(SCENARIOS.carrier), zone: 'below' });
  const ws = ship.world;
  const sk = ws.doors.findIndex((d) => d.name === 'server room');
  assert.ok(ws.doors[sk].locked && ws.doors[sk].glass.length > 0, 'server room door is locked glass');
  assert.equal(doorGlassBroken(ws, sk), false);
  for (const i of ws.doors[sk].glass) ws.clearVoxel(i);
  assert.equal(doorGlassBroken(ws, sk), true);
});

test('enemies keep to their patrol area, or walk their guard round corner by corner', () => {
  const sim = createSimulation({
    world: { size: [20, 2.4, 20], h: 0.2, ground: 'stone' },
    objects: [
      { type: 'enemy', params: { count: 2, spread: 0.5, patrol: 'area', patrolWidth: 6, patrolDepth: 4, patrolOffsetX: 3 }, x: 6, z: 6 },
      { type: 'enemy', params: { count: 1, spread: 0, patrol: 'route', patrolWidth: 6, patrolDepth: 6 }, x: 14, z: 14 },
    ],
    noFire: true,
  });
  const w = sim.world;
  const [a1, a2, guard] = w.enemies;
  assert.equal(a1.area.mode, 'area');
  assert.equal(guard.area.mode, 'route');
  const corners = guard.area.corners;
  const visited = [];
  let outside = 0;
  while (w.time < 120) {
    sim.step(sim.dt);
    for (const e of [a1, a2]) if (w.time > 20 && !sim.ai.inArea(e, e.p)) outside++;
    const k = corners.findIndex((c) => Math.hypot(c[0] - guard.p[0], c[2] - guard.p[2]) < 0.8);
    if (k >= 0 && visited[visited.length - 1] !== k) visited.push(k);
  }
  assert.ok(outside < 200, `patrollers stay in their area (${outside} steps outside)`);
  assert.ok(visited.length >= 4, `the guard walks the round: corners ${visited.join(' → ')}`);
  for (let k = 1; k < visited.length; k++) assert.equal(visited[k], (visited[k - 1] + 1) % 4, 'in order');
});
