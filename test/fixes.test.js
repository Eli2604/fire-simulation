import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAT } from '../src/sim/materials.js';
import { F_HIDDEN } from '../src/sim/world.js';
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
  // the grid of passages: 5 x 5 crossings, 5 m apart
  const xs = [2, 7, 12, 17, 22];
  const zs = [7, 12, 17, 22, 27];
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
  // the torches are drawn as objects: their voxels are hidden from the voxel view
  let hidden = 0;
  for (let k = 0; k < w.solidCount; k++) if (w.flags[w.solids[k]] & F_HIDDEN) hidden++;
  assert.ok(hidden >= torches.length * 3, `${hidden} hidden torch voxels`);
  // walls of stacked bones, and limestone
  assert.ok(count(w, MAT.ossuary) > 1000, `ossuary walls (${count(w, MAT.ossuary)})`);
  assert.ok(count(w, MAT.bedrock) > count(w, MAT.ossuary), 'the rock they are cut into');
  assert.ok(count(w, MAT.stone) > 100, 'masonry walls');
  assert.ok(w.barrels.length >= 1, 'round pillars of bones');
});

test('catacombs: the guards walk their rounds through the passages, opening (and closing) doors', () => {
  const sim = createSimulation({ ...cloneScene(SCENARIOS.carrier), zone: 'catacombs' });
  const w = sim.world;
  assert.ok(w.enemies.length >= 5);
  const start = w.enemies.map((e) => e.p.slice());
  // nobody starts inside the rock
  for (const e of w.enemies) assert.ok(!sim.ai.blocked(e.p[0], e.p[2], e.p[1]), `guard at ${e.p.map((v) => v.toFixed(1))} is free`);
  run(sim, 60);
  const moved = w.enemies.filter((e, k) => Math.hypot(e.p[0] - start[k][0], e.p[2] - start[k][2]) > 4).length;
  assert.ok(moved >= 3, `${moved} guards got around`);
  const opened = w.events.filter((e) => e.type === 'doorOpen').length;
  const closed = w.events.filter((e) => e.type === 'doorClose').length;
  assert.ok(opened >= 1, `${opened} doors opened`);
  assert.ok(closed >= 1, `${closed} doors closed behind them`);
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

test('ship: the fuel line bursts as an explosion that holes the hull; the sea fills the lower deck from the bottom up, to the waterline', async () => {
  const sim = createSimulation(cloneScene(SCENARIOS.ship));
  const w = sim.world;
  run(sim, 31);
  assert.ok(w.events.some((e) => e.type === 'explosion'), 'the vapour explodes');
  const holes = w.hull.filter((i) => !w.mat[i] || w.mat[i] === MAT.water).length;
  assert.ok(holes > 5, `${holes} hull voxels torn out`);
  run(sim, 15);
  let water = 0;
  let top = 0;
  for (let k = 0; k < w.solidCount; k++) {
    const i = w.solids[k];
    if (w.mat[i] !== MAT.water) continue;
    water++;
    top = Math.max(top, w.coords(i)[1] * w.h);
  }
  assert.ok(water * w.h ** 3 > 30, `fast inflow (${(water * w.h ** 3).toFixed(0)} m³ in 15 s)`);
  // and not above the sea (a few voxels thrown by the blast aside)
  let above = 0;
  for (let k = 0; k < w.solidCount; k++) if (w.mat[w.solids[k]] === MAT.water && w.coords(w.solids[k])[1] * w.h > w.sea.level + 0.3) above++;
  assert.ok(above < 20, `${above} water voxels above the waterline`);
});

test('walk-through: water is no floor; deep water with air above it floats you, full to the ceiling it does not', async () => {
  globalThis.document ??= { createElement: () => ({ style: {}, remove() {} }), body: { appendChild() {} }, getElementById: () => null, querySelector: () => null };
  const { Walkthrough } = await import('../src/walk/walk.js');
  const sim = createSimulation(cloneScene(SCENARIOS.hallway));
  const w = sim.world;
  const P = Walkthrough.prototype;
  const me = { hooks: { getSim: () => sim } };
  for (const k of ['solidAt', 'isWater', 'floorAt', 'waterAt']) me[k] = P[k].bind(me);
  const [x, , z] = sim.spawn.p;
  const x2 = x + 3;
  const floor = me.floorAt(x2, z, 2);
  // flood 1.6 m of water over the floor
  for (let y = floor + w.h / 2; y < floor + 1.6; y += w.h) {
    const i = w.voxelAt(x2, y, z);
    if (i >= 0 && !w.mat[i]) w.setVoxel(i, MAT.water);
  }
  assert.ok(Math.abs(me.floorAt(x2, z, floor + 2) - floor) < 1e-6, 'standing on the floor, not on the water');
  const wa = me.waterAt(x2, z, floor);
  assert.ok(wa.depth > 1.4 && wa.air, `deep water with air above (${wa.depth.toFixed(2)} m)`);
  // up to the ceiling
  for (let y = floor + w.h / 2; y < w.size[1]; y += w.h) {
    const i = w.voxelAt(x2, y, z);
    if (i >= 0 && !w.mat[i]) w.setVoxel(i, MAT.water);
  }
  assert.equal(me.waterAt(x2, z, floor).air, false, 'no air left: you are under water');
});

test('catacombs: bone walls as in Paris – bone ends in rows, bands and a crown of skulls, crosses and hearts, tablets', async () => {
  const THREE = await import('three');
  const { OssuaryRenderer } = await import('../src/render/ossuary.js');
  const sim = createSimulation(cloneScene(SCENARIOS.catacombs));
  const r = new OssuaryRenderer(new THREE.Scene());
  r.setWorld(sim.world);
  r.update(5, null);
  const tot = [0, 0, 0, 0];
  for (const ch of r.chunks.values()) ch.meshes.forEach((m, k) => (tot[k] += m.count));
  assert.ok(tot[0] > 500, `${tot[0]} skulls`);
  assert.ok(tot[1] + tot[2] > 5 * tot[0], `${tot[1] + tot[2]} bone ends, most of the wall`);
  assert.ok(sim.world.plaques.length >= 8, `${sim.world.plaques.length} engraved tablets`);
  // only on the faces you can see: none on the backs of the walls (towards the rock)
  const w = sim.world;
  for (const ch of r.chunks.values())
    for (const m of ch.meshes)
      for (let k = 0; k < Math.min(m.count, 50); k++) {
        const i = m.userData.voxels[k];
        const [x, y, z] = w.coords(i);
        assert.ok(w.colTop[x + w.nx * z] >= y, 'a bone wall voxel under the vault');
      }
});

test('catacombs: a lamp lighting up a dark spot draws the guard who sees it; a spot by a torch does not', () => {
  const sim = createSimulation({ ...cloneScene(SCENARIOS.carrier), zone: 'catacombs' });
  const w = sim.world;
  assert.ok(w.dark, 'underground: dark');
  const ai = sim.ai;
  const e = w.enemies[0];
  const head = [e.p[0], e.p[1] + 1.6, e.p[2]];
  // a spot this guard can see, away from torches
  let spot = null;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
    for (let d = 3; d < 9 && !spot; d += 0.5) {
      const p = [e.p[0] + dx * d, e.p[1] + 0.3, e.p[2] + dz * d];
      if (ai.suspiciousLight(e, head, { spot: p })) spot = p;
    }
  assert.ok(spot, 'a dark spot in view');
  ai.player = { p: [1, 0.2, 1], head: [1, 1.8, 1] }; // somewhere else, out of sight
  ai.lamp = { from: [1, 1.8, 1], spot, time: w.time };
  e.lightCooldown = 0;
  ai.step(0.2);
  assert.equal(e.state, 'investigate', 'comes to look');
  assert.ok(Math.hypot(e.goal[0] - spot[0], e.goal[2] - spot[2]) < 0.5, 'at the lit spot');
  assert.ok(w.events.some((ev) => ev.type === 'lightSeen'));
  // next to a burning torch a light is nothing strange
  const t = w.heaters.find((h) => h.light);
  assert.equal(ai.suspiciousLight(e, head, { spot: [t.pos[0], t.pos[1] - 0.3, t.pos[2]] }), false);
  // and in a lit scene a lamp is nothing strange at all
  w.dark = false;
  const e2 = w.enemies[1];
  e2.state = 'patrol';
  e2.lightCooldown = 0;
  ai.lamp = { from: [1, 1.8, 1], spot, time: w.time };
  ai.step(0.2);
  assert.notEqual(e2.state === 'investigate' && Math.hypot(e2.goal[0] - spot[0], e2.goal[2] - spot[2]) < 0.5, true);
});

test('catacombs: a blast brings the guards running, and they search the place', () => {
  const sim = createSimulation(cloneScene(SCENARIOS.catacombs));
  const w = sim.world;
  run(sim, 1);
  const at = [2, 1, 22];
  explode(sim, at, 6e5, { name: 'grenade' });
  run(sim, 0.6);
  const coming = w.enemies.filter((e) => e.state === 'investigate' && e.urgent);
  assert.ok(coming.length >= 3, `${coming.length} guards on their way`);
  // how close each one gets while they search (they pick random spots round it)
  const closest = w.enemies.map(() => Infinity);
  for (let t = 0; t < 14; t += 0.5) {
    run(sim, 0.5);
    w.enemies.forEach((e, k) => (closest[k] = Math.min(closest[k], Math.hypot(e.p[0] - at[0], e.p[2] - at[2]))));
  }
  const there = closest.filter((d) => d < 4).length;
  assert.ok(there >= 2, `${there} guards reached the blast`);
});

test('ship: water aboard adds its weight – the ship settles deeper and lists towards the flooded side', () => {
  const sim = createSimulation(cloneScene(SCENARIOS.ship));
  const w = sim.world;
  const level0 = w.sea.level;
  run(sim, 31); // the fuel line bursts against the hull (aft cross corridor, port side)
  run(sim, 30);
  const S = w.sea.ship;
  assert.ok(S.water > 20000, `water aboard (${(S.water / 1000).toFixed(0)} t)`);
  // Archimedes: deeper by about m / (ρ A)
  const A = (w.sea.box[2] - w.sea.box[0]) * (w.sea.box[3] - w.sea.box[1]);
  const expected = S.water / (1025 * A);
  assert.ok(w.sea.level - level0 > expected * 0.5, `settled ${(w.sea.level - level0).toFixed(2)} m (balance: ${expected.toFixed(2)} m)`);
  // the water lies to the side of the hole: a list towards it
  assert.ok(Math.abs(S.heelDeg) > 0.3, `list ${S.heelDeg.toFixed(1)}°`);
});

test('carrier: a flooded compartment hardly moves 100 000 tonnes', () => {
  const sim = createSimulation({ ...cloneScene(SCENARIOS.carrier), zone: 'below' });
  const w = sim.world;
  const level0 = w.sea.level;
  explode(sim, [21, 1.0, 1.6], 8e5);
  run(sim, 8);
  assert.ok(w.sea.ship.water > 1000, 'water aboard');
  assert.ok(w.sea.level - level0 < 0.05, `settled only ${((w.sea.level - level0) * 100).toFixed(1)} cm`);
});
