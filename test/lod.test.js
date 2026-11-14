import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickLevel, applyBudget, screenSize, projection, REF_PROJECTION, updateEvery, LodManager } from '../src/render/lod.js';

test('screen size: radius over distance times the projection, and the bias', () => {
  assert.ok(Math.abs(REF_PROJECTION - 800 / (2 * Math.tan((25 * Math.PI) / 180))) < 1e-9);
  assert.ok(Math.abs(screenSize(1, 10, 1000) - 100) < 1e-9);
  assert.ok(Math.abs(screenSize(1, 20, 1000) - 50) < 1e-9, 'twice as far: half the size');
  assert.ok(Math.abs(screenSize(1, 10, 1000, 2) - 200) < 1e-9, 'the bias scales it');
  // a narrower field of view or a taller view: bigger on the screen
  assert.ok(projection(800, 25) > projection(800, 50));
  assert.ok(projection(1600, 50) > projection(800, 50));
});

test('levels by screen size, largest first; none yet: no hysteresis', () => {
  const L = [120, 40, 12];
  assert.equal(pickLevel(500, L), 0);
  assert.equal(pickLevel(121, L), 0);
  assert.equal(pickLevel(100, L), 1);
  assert.equal(pickLevel(30, L), 2);
  assert.equal(pickLevel(5, L), 3);
  assert.equal(pickLevel(0, L), 3);
  assert.equal(pickLevel(Infinity, L), 0, 'no camera: full detail');
});

test('hysteresis: a level holds until the size is a margin past the boundary', () => {
  const L = [100];
  // at full detail it stays down to 85 (15% under), and only comes back over 115
  assert.equal(pickLevel(90, L, 0), 0);
  assert.equal(pickLevel(84, L, 0), 1);
  assert.equal(pickLevel(110, L, 1), 1);
  assert.equal(pickLevel(116, L, 1), 0);
  // walking the size down and up: one switch each way, no flicker round 100
  let lv = 0;
  const seen = [];
  for (const s of [120, 105, 99, 95, 101, 90, 84, 90, 99, 101, 110, 114, 116, 105, 95]) {
    const n = pickLevel(s, L, lv);
    if (n !== lv) seen.push([s, n]);
    lv = n;
  }
  assert.deepEqual(seen, [[84, 1], [116, 0]]);
  // explicit [in, out] pairs (the detail patches' near and far)
  assert.equal(pickLevel(-4, [[-3.5, -4.5]], 0), 0, 'awake: stays within far');
  assert.equal(pickLevel(-4.6, [[-3.5, -4.5]], 0), 1);
  assert.equal(pickLevel(-4, [[-3.5, -4.5]], 1), 1, 'asleep: waits for near');
  assert.equal(pickLevel(-3.4, [[-3.5, -4.5]], 1), 0);
  // a big jump crosses several boundaries at once
  assert.equal(pickLevel(5, [120, 40, 12], 0), 3);
  assert.equal(pickLevel(500, [120, 40, 12], 3), 0);
});

test('budget: at most N at full detail, the biggest win', () => {
  const e = [10, 50, 30, 80, 20].map((size) => ({ size, level: 0 }));
  const kept = applyBudget(e, 2);
  assert.deepEqual(kept.map((x) => x.size), [80, 50]);
  assert.deepEqual(e.map((x) => x.level), [1, 0, 1, 0, 1]);
  // those already coarser are not counted, nor promoted
  const f = [{ size: 99, level: 2 }, { size: 5, level: 0 }];
  applyBudget(f, 1);
  assert.deepEqual(f.map((x) => x.level), [2, 0]);
  assert.equal(applyBudget([{ size: 1, level: 0 }], 0).length, 0);
});

test('update rates by level', () => {
  assert.deepEqual([0, 1, 2, 3, 9].map((l) => updateEvery(l)), [1, 2, 4, 8, 8]);
});

test('the manager: levels from the camera, the bias, and a budget settled from the frame before', () => {
  const M = new LodManager();
  const items = [2, 4, 6, 8, 30].map((x) => ({ x, s: {} }));
  // no camera: everything at full detail
  M.begin(null);
  assert.equal(M.level(items[0].s, 2, 0, 0, 1, [100, 10]), 0);
  // a soldier-sized item (r 1) at 2..8 m and 30 m, from the origin: 429, 214, 143, 107, 29 px
  const run = () => {
    M.begin([0, 0, 0]);
    return items.map((it) => M.level(it.s, it.x, 0, 0, 1, [100, 20], 'character'));
  };
  M.budgets.character = 2;
  run(); // (the first frame has no budget yet)
  assert.deepEqual(run(), [0, 0, 1, 1, 1], 'only the nearest two at full detail');
  assert.deepEqual(run(), [0, 0, 1, 1, 1], 'and it stays so');
  // the bias: less detail
  M.bias = 0.25;
  M.budgets.character = 10;
  run();
  assert.deepEqual(run(), [0, 1, 1, 1, 2]);
  assert.ok(M.equivalentDistance(10) > 39, 'a distance counts as four times as far');
  M.bias = 1;
  // out of view
  M.begin([0, 0, 0], REF_PROJECTION, (x) => x > 0);
  const s = {};
  M.level(s, -5, 0, 0, 1, [100]);
  assert.equal(s.inView, false);
  M.level(s, 5, 0, 0, 1, [100]);
  assert.equal(s.inView, true);
});
