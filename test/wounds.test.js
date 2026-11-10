import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../src/sim/createSimulation.js';
import { hitZone, shoot } from '../src/sim/wounds.js';

const run = (sim, t) => {
  const end = sim.world.time + t;
  while (sim.world.time < end) sim.step(sim.dt);
};

/** A stone corridor with one guard standing at x = 5 facing +x (towards the shooter at x = 2 they face away... we set the yaw). */
function range() {
  const sim = createSimulation({
    world: { size: [12, 3, 4], h: 0.1, ground: 'stone' },
    objects: [{ type: 'enemy', params: { count: 1, spread: 0 }, x: 5, z: 2 }],
    noFire: true,
  });
  // a wall at the far end
  const w = sim.world;
  for (let y = 1; y < 28; y++) for (let z = 0; z < 40; z++) w.setVoxel(w.idx(100, y, z), 2, { anchored: true });
  w.rebuildLists();
  const e = w.enemies[0];
  e.yaw = -Math.PI / 2; // facing the shooter (towards -x)
  return { sim, w, e };
}

test('hit zones: head, torso, arms and legs, by height and side', () => {
  const e = { p: [0, 0, 0], yaw: 0 };
  assert.equal(hitZone(e, [0, 1.62, 0]), 'head');
  assert.equal(hitZone(e, [0, 1.2, 0]), 'torso');
  assert.equal(hitZone(e, [0.26, 1.2, 0]), 'armR');
  assert.equal(hitZone(e, [-0.26, 1.2, 0]), 'armL');
  assert.equal(hitZone(e, [0.1, 0.5, 0]), 'legR');
  assert.equal(hitZone(e, [0.6, 1.2, 0]), null, 'a miss beside them');
});

test('a shot in the arm stops them firing; in a leg they limp; wounds bleed and leave blood behind', () => {
  const { sim, w, e } = range();
  // in the right arm (their right, facing -x: right is +z)
  shoot(sim, [1, 1.2, 2.26], [1, 0, 0]);
  assert.equal(e.canFire, false, 'cannot hold the rifle');
  // in the left leg
  shoot(sim, [1, 0.5, 1.9], [1, 0, 0]);
  assert.ok(e.speedFactor < 0.6, 'limps');
  const h0 = e.health;
  assert.ok(e.bleed > 0, 'bleeding');
  run(sim, 3);
  assert.ok(e.health < h0, 'loses health while bleeding');
  assert.ok(w.decals.filter((d) => d.kind === 'blood').length > 3, 'blood on the floor and the wall behind');
  assert.ok(e.stains.length === 2, 'stains on the clothes where hit');
});

test('a head shot is fatal; a bullet that misses leaves a hole in the wall', () => {
  const { sim, w, e } = range();
  shoot(sim, [1, 1.62, 2], [1, 0, 0]);
  assert.ok(e.dead, 'down');
  shoot(sim, [1, 2.2, 2], [1, 0, 0]);
  assert.ok(w.decals.some((d) => d.kind === 'hole' && d.p[0] > 9.9), 'a hole in the end wall');
});

test('a guard who sees you fires bursts at you; one hit in the arm and they cannot', () => {
  const { sim, w, e } = range();
  e.alerted = true;
  sim.ai.player = { p: [2, 0.1, 2], head: [2, 1.75, 2] };
  for (let k = 0; k < 30; k++) {
    sim.ai.player = { p: [2, 0.1, 2], head: [2, 1.75, 2] };
    sim.step(sim.dt);
  }
  assert.ok(w.tracers.length >= 2, `${w.tracers.length} shots fired`);
  const shots = w.tracers.length;
  e.canFire = false;
  for (let k = 0; k < 20; k++) {
    sim.ai.player = { p: [2, 0.1, 2], head: [2, 1.75, 2] };
    sim.step(sim.dt);
  }
  assert.equal(w.tracers.length, shots, 'no more shots');
});
