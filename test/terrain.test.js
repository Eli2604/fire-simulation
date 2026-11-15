import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '../src/sim/createSimulation.js';
import { buildScene } from '../src/models/voxelizer.js';
import { MATERIALS, MAT, mechanics } from '../src/sim/materials.js';
import { F_LIQUID } from '../src/sim/world.js';
import { MODELS, defaultParams } from '../src/models/index.js';
import { GROUPS } from '../src/editor/editor.js';
import { cloneScene } from '../src/scenarios.js';
import { SURFACES, newArea, terrainField, terrainAt, areaInside } from '../src/models/terrain.js';
import { areaGizmoPose, areaFromGizmo, terrainFrame, areaAt, textToPoints, pointsToText, areaOutline } from '../src/editor/terrainPanel.js';

const H = 0.2;
// a terrain filling a 24 × 24 m world, its centre at (12, 12): terrain x, z = world x − 12, z − 12
const scene = (params, extra = {}) => ({
  world: { size: [24, 7, 24], h: H },
  weather: { ambient: 15, windSpeed: 0, rain: 0 },
  objects: [{ type: 'terrain', x: 12, z: 12, params: { width: 24, depth: 24, base: 1, surface: 'grass', ...params } }],
  ...extra,
});
/** The top voxel of the world column at terrain point (x, z): its height (m above the ground layer) and material. */
function column(world, x, z, skipWater = false, [ox, oz] = [12, 12]) {
  const cx = Math.floor((x + ox) / H);
  const cz = Math.floor((z + oz) / H);
  for (let y = world.ny - 1; y >= 0; y--) {
    const i = world.idx(cx, y, cz);
    const m = world.mat[i];
    if (m && !(skipWater && m === MAT.water)) return { top: +((y + 1) * H - H).toFixed(3), mat: MATERIALS[m].name, i };
  }
  return { top: 0, mat: 'air', i: -1 };
}
const near = (a, b, tol = H * 0.51) => Math.abs(a - b) <= tol;

test('the terrain model: registered, in the palette (Nature), its materials and surfaces exist', () => {
  assert.ok(MODELS.terrain);
  assert.ok(GROUPS.find(([g]) => g === 'Nature')[1].includes('terrain'));
  for (const [k, S] of Object.entries(SURFACES)) {
    for (const m of [S.top, S.under, S.fluid].filter(Boolean)) assert.ok(MAT[m] !== undefined, `${k}: material ${m}`);
  }
  // the new ground materials: physically sensible
  const mud = MATERIALS[MAT.mud];
  const tephra = MATERIALS[MAT.tephra];
  assert.ok(!mud.combustible && !tephra.combustible);
  assert.ok(mud.specificHeat > MATERIALS[MAT.soil].specificHeat && mud.moisture > MATERIALS[MAT.soil].moisture, 'mud: wet, slow to heat');
  assert.ok(tephra.conductivity < MATERIALS[MAT.basalt].conductivity && tephra.density < MATERIALS[MAT.basalt].density, 'cinders: porous, insulating');
  assert.ok(Math.abs(tephra.meltingPoint - MATERIALS[MAT.basalt].meltingPoint) < 100, 'cinders melt as basalt does');
  assert.equal(mechanics('mud').shape, 'granular');
  // a new one gets its own areas (not the model's defaults)
  const o = MODELS.terrain.create({ type: 'terrain', params: defaultParams('terrain') });
  o.params.areas[0].height = 99;
  assert.notEqual(MODELS.terrain.params.areas.value[0].height, 99);
});

test('areas build the right heights and depths, the right surfaces, water to its level', () => {
  const areas = [
    newArea({ name: 'hill', shape: 'rectangle', x: -6, z: -6, width: 6, depth: 4, height: 2, slope: 0, surface: 'rock' }),
    newArea({ name: 'smooth hill', shape: 'ellipse', x: 6, z: -6, width: 8, depth: 8, height: 2, slope: 3, surface: 'volcanic' }),
    newArea({ name: 'pond', shape: 'ellipse', x: 6, z: 6, width: 6, depth: 6, height: -0.8, slope: 0, surface: 'water', level: -0.2 }),
    newArea({ name: 'sand', shape: 'rectangle', x: -6, z: 6, width: 4, depth: 4, height: 0, slope: 0, surface: 'sand' }),
    newArea({ name: 'ash', shape: 'rectangle', x: 0, z: 0, width: 2, depth: 2, height: 0, slope: 0, surface: 'ash' }),
    newArea({ name: 'mud', shape: 'rectangle', x: 0, z: 4, width: 2, depth: 2, height: 0, slope: 0, surface: 'mud' }),
    newArea({ name: 'gravel', shape: 'rectangle', x: 0, z: -4, width: 2, depth: 2, height: 0, slope: 0, surface: 'gravel' }),
    newArea({ name: 'deep pit', shape: 'rectangle', x: -10, z: 0, width: 2, depth: 2, height: -3, slope: 0, surface: 'soil' }),
  ];
  const { world } = buildScene(scene({ areas }));
  // the base ground: 1 m of it, grass on soil
  let c = column(world, 3, 0);
  assert.ok(near(c.top, 1), `base at 1 m (${c.top})`);
  assert.equal(c.mat, 'grass');
  assert.equal(MATERIALS[world.mat[c.i - world.nx]].name, 'soil', 'soil under the turf');
  // a cliff-edged hill: 2 m up all over its footprint, rock; just outside it the base
  c = column(world, -6, -6);
  assert.ok(near(c.top, 3), `hill top at 3 m (${c.top})`);
  assert.equal(c.mat, 'hillRock');
  assert.ok(near(column(world, -6 + 2.8, -6).top, 3), 'cliff: full height at its edge');
  assert.ok(near(column(world, -6 + 3.3, -6).top, 1), 'and the base outside it');
  // a smooth hill: full height in the middle, half way up its slope half of it
  assert.ok(near(column(world, 6, -6).top, 3));
  assert.equal(column(world, 6, -6).mat, 'basalt');
  const mid = column(world, 6 + 4 - 1.5, -6).top;
  assert.ok(mid > 1.6 && mid < 2.4, `half way up the slope (${mid})`);
  // the pond: dug 0.8 m, a bed of mud, water to 0.2 m below the base ground
  c = column(world, 6, 6, true);
  assert.ok(near(c.top, 0.2), `pond bed at 0.2 m (${c.top})`);
  assert.equal(c.mat, 'mud');
  const wtop = column(world, 6, 6);
  assert.equal(wtop.mat, 'water');
  assert.ok(near(wtop.top, 0.8), `water up to 0.8 m (${wtop.top})`);
  // surfaces
  assert.equal(column(world, -6, 6).mat, 'beachSand');
  assert.equal(column(world, 0, 0).mat, 'tephra');
  assert.equal(MATERIALS[world.mat[column(world, 0, 0).i - 2 * world.nx]].name, 'basalt', 'cinders lie on basalt');
  assert.equal(column(world, 0, 4).mat, 'mud');
  assert.equal(column(world, 0, -4).mat, 'quarrySand');
  // a pit deeper than the base: down to the world's own ground layer, not through it
  c = column(world, -10, 0);
  assert.equal(c.top, 0);
  assert.equal(MATERIALS[world.mat[c.i]].name, 'soil');
  // the model's own height field agrees (terrainAt)
  const p = { width: 24, depth: 24, base: 1, surface: 'grass', moisture: 0.2, areas };
  assert.ok(near(terrainAt(p, H, -6, -6).y, 2 + 1, 1e-6));
  assert.equal(terrainAt(p, H, 6, 6).surface, 'water');
});

test('areas stack in order: heights add up, the last surface wins; level flattens what is under it', () => {
  const A = newArea({ shape: 'rectangle', x: 0, z: 0, width: 8, depth: 8, height: 1, slope: 0, surface: 'rock' });
  const B = newArea({ shape: 'ellipse', x: 2, z: 0, width: 6, depth: 6, height: 0.6, slope: 0, surface: 'sand' });
  const f1 = terrainAt({ width: 24, depth: 24, base: 1, surface: 'grass', moisture: 0.2, areas: [A, B] }, H, 2, 0);
  assert.ok(near(f1.y, 2.6, 1e-6), `1 + 1 + 0.6 (${f1.y})`);
  assert.equal(f1.surface, 'sand');
  const f2 = terrainAt({ width: 24, depth: 24, base: 1, surface: 'grass', moisture: 0.2, areas: [B, A] }, H, 2, 0);
  assert.ok(near(f2.y, 2.6, 1e-6));
  assert.equal(f2.surface, 'rock', 'reversed: rock on top');
  // where only the first reaches, its own
  assert.equal(terrainAt({ width: 24, depth: 24, base: 1, surface: 'grass', moisture: 0.2, areas: [A, B] }, H, -3, 0).surface, 'rock');
  // a level area flattens the hill under it to its height (0.4 m over the base)
  const L = newArea({ shape: 'rectangle', x: 0, z: 0, width: 3, depth: 3, height: 0.4, mode: 'level', slope: 0, surface: 'keep' });
  const f3 = terrainAt({ width: 24, depth: 24, base: 1, surface: 'grass', moisture: 0.2, areas: [A, B, L] }, H, 0, 0);
  assert.ok(near(f3.y, 1.4, 1e-6), `levelled (${f3.y})`);
  assert.equal(f3.surface, 'sand', "'keep': the surface under it stays");
  // switched off: as if it were not there
  assert.equal(terrainAt({ width: 24, depth: 24, base: 1, surface: 'grass', moisture: 0.2, areas: [A, { ...B, enabled: false }] }, H, 2, 0).surface, 'rock');
  // and in the voxels: the later area's material on top
  const { world } = buildScene(scene({ areas: [A, B] }));
  assert.equal(column(world, 2, 0).mat, 'beachSand');
  assert.ok(near(column(world, 2, 0).top, 2.6));
});

test('a polygon area, a turned area; the editor helpers (gizmo pose, corners as text, picking)', () => {
  const P = newArea({ shape: 'polygon', x: 0, z: 0, points: [[-2, -2], [3, -2], [0, 3]], height: 1, slope: 0, surface: 'rock' });
  assert.ok(areaInside(P, 0, 0) > 0);
  assert.ok(areaInside(P, 2.5, 2.5) < 0);
  assert.ok(Math.abs(areaInside(P, 0, -1) - 1) < 1e-9, 'a metre in from its edge');
  // a long rectangle turned 90°: along z now
  const T = newArea({ shape: 'rectangle', x: 0, z: 0, width: 8, depth: 1, rotation: 90, height: 1, slope: 0 });
  assert.ok(areaInside(T, 0, 3.5) > 0 && areaInside(T, 3.5, 0) < 0);
  // the outline goes round its footprint
  for (const [x, z] of areaOutline(T)) assert.ok(Math.abs(areaInside(T, x, z)) < 1e-6);
  assert.deepEqual(textToPoints(pointsToText(P.points)), P.points);
  assert.equal(textToPoints('1 2; 3'), null, 'fewer than three corners: refused');
  // the gizmo on an area of a turned terrain, and back: the same area
  const frame = terrainFrame({ x: 10, z: 10, rotation: 30 }, [10.1, 0.2, 10.1]);
  const a = newArea({ x: 3, z: -2, rotation: 15, height: 1.5 });
  const pose = areaGizmoPose(frame, { base: 1 }, a);
  assert.ok(Math.abs(pose.y - (0.2 + 1 + 1.5)) < 1e-9);
  // (with the voxel size: on the ground there, as built: a 1.5 m hill on 1 m of base)
  const onGround = areaGizmoPose(frame, { base: 1, areas: [a] }, a, H);
  assert.ok(Math.abs(onGround.y - (0.2 + 2.5)) < H * 0.51, `on the hill (${onGround.y})`);
  const back = areaFromGizmo(frame, { base: 1 }, a, pose, pose);
  assert.deepEqual({ x: back.x, z: back.z, rotation: back.rotation, height: back.height }, { x: 3, z: -2, rotation: 15, height: 1.5 });
  // dragged up a metre: a metre higher
  assert.equal(areaFromGizmo(frame, { base: 1 }, a, { ...pose, y: pose.y + 1 }, pose).height, 2.5);
  // a click picks the topmost area there
  assert.equal(areaAt([P, newArea({ x: 0, z: 0, width: 2, depth: 2 })], 0, 0), 1);
  assert.equal(areaAt([P, newArea({ x: 0, z: 0, width: 2, depth: 2 })], 1.5, -1.5), 0);
  assert.equal(areaAt([P], 9, 9), -1);
});

test('saved and loaded with the scene: the same world after a JSON round trip', () => {
  const areas = [
    newArea({ name: 'hill', x: -4, z: 0, width: 8, depth: 6, rotation: 20, height: 2, slope: 2, noise: 0.3, surface: 'rock' }),
    newArea({ name: 'lake', shape: 'polygon', x: 5, z: 3, points: [[-3, -2], [3, -2], [2, 3], [-2, 2]], height: -1, slope: 1, surface: 'water', level: -0.2 }),
  ];
  const sc = scene({ areas, seed: 7 });
  const json = JSON.stringify(sc);
  const loaded = cloneScene(JSON.parse(json));
  assert.deepEqual(loaded.objects[0].params.areas, JSON.parse(JSON.stringify(areas)));
  const a = buildScene(sc).world;
  const b = buildScene(loaded).world;
  assert.equal(a.mat.length, b.mat.length);
  let diff = 0;
  for (let i = 0; i < a.mat.length; i++) if (a.mat[i] !== b.mat[i]) diff++;
  assert.equal(diff, 0, 'the same voxels');
  // and an object on it with y 'auto' stands on its surface
  const { world } = buildScene({ ...sc, objects: [...sc.objects, { type: 'crate', x: 8, z: 12, y: 'auto' }] });
  assert.ok(Math.abs(world.origins[1][1] - (H + terrainAt({ ...sc.objects[0].params, moisture: 0.2 }, H, -4, 0).y)) < H * 1.01, 'the crate on the hill');
});

test('snow areas lay snow (sim/snow.js) when it is cold; lava areas start molten', () => {
  const areas = [
    newArea({ shape: 'rectangle', x: -5, z: 0, width: 6, depth: 6, height: 0.5, slope: 0, surface: 'snow', snow: 0.4 }),
    newArea({ shape: 'ellipse', x: 6, z: 0, width: 5, depth: 5, height: -0.8, slope: 0, surface: 'lava', level: -0.2 }),
  ];
  const sim = createSimulation(scene({ areas }, { weather: { ambient: -5, windSpeed: 0, rain: 0, snowCover: 0 }, noFire: true }));
  const w = sim.world;
  assert.ok(w.snow, 'a snow field');
  const S = w.snow;
  const at = (x, z) => S.depth[Math.floor(((x + 12) / H) * S.k) + S.sx * Math.floor(((z + 12) / H) * S.k)];
  assert.ok(Math.abs(at(-5, 0) - 0.4) < 0.02, `0.4 m of snow (${at(-5, 0)})`);
  assert.equal(at(0, 8), 0, 'none elsewhere');
  // the lava: molten basalt, glowing hot, over a basalt bed
  const c = column(w, 6, 0);
  assert.equal(c.mat, 'basalt');
  assert.ok(w.flags[c.i] & F_LIQUID, 'molten');
  assert.ok(w.temp[c.i] > 1100);
});

test('grass areas are grass fuel: lit, the fire runs over them (and not over the rock beside them)', () => {
  const areas = [
    newArea({ name: 'meadow', shape: 'rectangle', x: 0, z: 0, width: 9, depth: 6, height: 0, slope: 0, surface: 'grass', moisture: 0.06, tall: 0.3 }),
  ];
  const sim = createSimulation({
    world: { size: [14, 5, 10], h: H },
    weather: { ambient: 28, humidity: 0.2, windSpeed: 2, windDir: 0, rain: 0 },
    objects: [{ type: 'terrain', x: 7, z: 5, ignite: true, params: { width: 14, depth: 10, base: 0.6, surface: 'rock', areas } }],
  });
  const w = sim.world;
  const grass = [];
  let rock = 0;
  for (let i = 0; i < w.mat.length; i++) {
    if (w.mat[i] === MAT.grass) grass.push(i);
    if (w.mat[i] === MAT.hillRock) rock++;
  }
  assert.ok(grass.length > 2000, `grass voxels: the turf and the tall grass on it (${grass.length})`);
  // the turf on the meadow is grass (tall grass stands on it); the rock round it has none
  assert.equal(MATERIALS[w.mat[column(w, 0, 0, false, [7, 5]).i]].name, 'grass');
  assert.equal(column(w, 6, 4, false, [7, 5]).mat, 'hillRock');
  while (w.time < 30) sim.step(sim.dt);
  // burnt (ash now, or charred) from end to end of the meadow, from the middle where it was lit
  const burnt = grass.filter((i) => w.mat[i] !== MAT.grass || w.char[i] > 0.3);
  const xs = burnt.map((i) => (i % w.nx) * H - 7);
  assert.ok(burnt.length > grass.length * 0.5, `the meadow burned (${burnt.length} of ${grass.length})`);
  assert.ok(Math.min(...xs) < -4 && Math.max(...xs) > 4, 'from end to end');
  let rock1 = 0;
  for (let i = 0; i < w.mat.length; i++) if (w.mat[i] === MAT.hillRock) rock1++;
  assert.equal(rock1, rock, 'the rock did not burn');
});
