import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAT } from '../src/sim/materials.js';
import { createSimulation, spawnFloor } from '../src/sim/createSimulation.js';
import { SCENARIOS, cloneScene } from '../src/scenarios.js';
import { explode, burstPipeAt } from '../src/sim/explosions.js';

const run = (sim, t) => {
  const end = sim.world.time + t;
  while (sim.world.time < end) sim.step(sim.dt);
};
const count = (w, m) => {
  let n = 0;
  for (let k = 0; k < w.solidCount; k++) if (w.mat[w.solids[k]] === m) n++;
  return n;
};

/** Where a firefighter can walk from (x, z): a flood fill over a 0.25 m grid with the walk-through's rules. */
function walkable(w, from) {
  const h = w.h;
  const solid = (x, y, z) => {
    const i = w.voxelAt(x, y, z);
    return i >= 0 && w.mat[i] !== 0;
  };
  const floorAt = (x, z, top) => {
    for (let y = top; y > 0; y -= h * 0.5) if (solid(x, y - h * 0.25, z)) return Math.floor((y - h * 0.25) / h) * h + h;
    return h;
  };
  const blocked = (x, z, y) => {
    for (let hy = y + 0.45; hy <= y + 1.77; hy += h * 0.5)
      for (const [dx, dz] of [[0, 0], [0.25, 0], [-0.25, 0], [0, 0.25], [0, -0.25]]) if (solid(x + dx, hy, z + dz)) return true;
    return false;
  };
  const S = 0.25;
  const key = (i, j) => i + ',' + j;
  const seen = new Map();
  const q = [[Math.round(from[0] / S), Math.round(from[2] / S), spawnFloor(w, from)]];
  seen.set(key(q[0][0], q[0][1]), q[0][2]);
  while (q.length) {
    const [i, j, y] = q.pop();
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di;
      const nj = j + dj;
      if (seen.has(key(ni, nj)) || ni < 1 || nj < 1 || ni * S > w.size[0] - 0.3 || nj * S > w.size[2] - 0.3) continue;
      const f = floorAt(ni * S, nj * S, y + 0.45);
      if (f - y > 0.42 || blocked(ni * S, nj * S, f)) continue;
      seen.set(key(ni, nj), f);
      q.push([ni, nj, f]);
    }
  }
  return (x, z) => seen.has(key(Math.round(x / S), Math.round(z / S)));
}

test('catacombs: you can walk from the stairs through every passage and crossing; the torches are on the walls', () => {
  const sim = createSimulation({ ...cloneScene(SCENARIOS.carrier), zone: 'catacombs' });
  const w = sim.world;
  assert.ok(spawnFloor(w, sim.spawn.p) < 0.5, 'you start on the floor, not on the vault');
  const reach = walkable(w, sim.spawn.p);
  // the grid of passages: 4 x 4 crossings, 5 m apart, centred in the world
  const xs = [2, 7, 12, 17];
  const zs = [7, 12, 17, 22];
  for (const x of xs) for (const z of zs) assert.ok(reach(x, z), `crossing at ${x}, ${z} reachable`);
  // and up the stairs to the way out
  const exit = w.portals.find((p) => p.to === 'island');
  assert.ok([...Array(9)].some((_, k) => reach(exit.p[0], exit.p[2] + 0.2 * (k - 4))), 'the stairs up to the exit');
  // every torch: a bracket and a stick big enough to be voxels
  const torches = w.heaters.filter((h) => h.light);
  assert.ok(torches.length >= 12, `${torches.length} torches`);
  for (const t of torches) {
    let n = 0;
    for (let dx = -0.4; dx <= 0.4; dx += w.h)
      for (let dy = -0.6; dy <= 0.1; dy += w.h)
        for (let dz = -0.4; dz <= 0.4; dz += w.h) {
          const i = w.voxelAt(t.pos[0] + dx, t.pos[1] + dy, t.pos[2] + dz);
          if (i >= 0 && (w.mat[i] === MAT.wood || w.mat[i] === MAT.steel)) n++;
        }
    assert.ok(n >= 3, `torch at ${t.pos.map((v) => v.toFixed(1))} has ${n} voxels`);
  }
});

test('walk-in start: the scene shows it as a marker, and a start you choose replaces it', () => {
  const sim = createSimulation(cloneScene(SCENARIOS.rainyHouse));
  const mk = sim.markers.find((m) => m.kind === 'walk');
  assert.ok(mk, 'a walk-in marker');
  assert.ok(Math.abs(mk.p[0] - sim.spawn.p[0]) < 1e-9);
  const scene = cloneScene(SCENARIOS.rainyHouse);
  scene.walkStart = { p: [2, 0.2, 3], yaw: 1 };
  const s2 = createSimulation(scene);
  assert.deepEqual(s2.spawn, scene.walkStart);
  assert.ok(s2.markers.some((m) => m.kind === 'walk' && m.p[0] === 2 && m.yaw === 1));
});

test('rain stays outside a house, and so does the wind', () => {
  const scene = cloneScene(SCENARIOS.rainyHouse);
  scene.noFire = true;
  const sim = createSimulation(scene);
  const w = sim.world;
  const moist0 = new Map();
  const house = scene.objects.findIndex((o) => o.type === 'house');
  for (let k = 0; k < w.solidCount; k++) {
    const i = w.solids[k];
    if (w.owner[i] === house && (w.mat[i] === MAT.foam || w.mat[i] === MAT.paper)) moist0.set(i, w.moist[i]);
  }
  assert.ok(moist0.size > 50, 'furniture inside');
  run(sim, 20);
  let wetter = 0;
  for (const [i, m] of moist0) if (w.moist[i] > m + 0.01) wetter++;
  assert.equal(wetter, 0, 'the furniture stays dry');
  // wind: inside the house the air hardly feels it
  const inside = sim.airCellAt(5, 1.2, 5);
  const outside = sim.airCellAt(1, 1.2, 1);
  assert.ok(w.shelter[inside] < 0.2, `sheltered inside (${w.shelter[inside]})`);
  assert.equal(w.shelter[outside], 1);
});

test('a burst water pipe floods the hallway', () => {
  const sim = createSimulation(cloneScene(SCENARIOS.hallway));
  const w = sim.world;
  const gp = w.gasPipes.find((g) => g.water);
  assert.ok(gp && gp.voxels.length > 20, 'a water pipe made of voxels');
  burstPipeAt(sim, gp, gp.voxels[gp.voxels.length >> 1]);
  assert.ok(w.events.some((e) => e.type === 'waterBurst'));
  const before = count(w, MAT.water);
  run(sim, 8);
  assert.ok(count(w, MAT.water) > before + 15, `water collects (${count(w, MAT.water) - before} voxels)`);
});

test('carrier below deck is under the waterline: a hole in the hull lets the sea in', () => {
  const sim = createSimulation({ ...cloneScene(SCENARIOS.carrier), zone: 'below' });
  const w = sim.world;
  assert.ok(w.sea && w.hull?.length > 100, 'a hull with the sea outside');
  assert.ok(w.gasPipes.some((g) => g.water), 'and a sea-water main');
  // a grenade against the outer bulkhead of the berthing (port side)
  explode(sim, [21, 1.0, 1.6], 8e5);
  const before = count(w, MAT.water);
  run(sim, 6);
  assert.ok(count(w, MAT.water) > before + 50, `the sea comes in (${count(w, MAT.water) - before} voxels)`);
});
