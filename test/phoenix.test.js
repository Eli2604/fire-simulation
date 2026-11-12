import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSimulation } from '../src/sim/createSimulation.js';
import { SCENARIOS, cloneScene } from '../src/scenarios.js';
import { toggleDoor } from '../src/sim/doors.js';
import { shoot } from '../src/sim/wounds.js';
import { PhoenixRenderer } from '../src/render/phoenix.js';

const catacombs = (guards = true) => {
  const sc = cloneScene(SCENARIOS.catacombs);
  sc.noFire = true;
  if (!guards) sc.objects = sc.objects.filter((o) => o.type !== 'enemy');
  return createSimulation(sc);
};
const player = (sim, p) => (sim.ai.player = { p: p.slice(), head: [p[0], p[1] + 1.7, p[2]], moving: false });
const run = (sim, t, each, dt = 0.1) => {
  const end = sim.world.time + t;
  while (sim.world.time < end) {
    each?.(sim);
    sim.step(dt);
  }
};
const gateOf = (w) => w.doors.findIndex((d) => d.name === 'dungeon cell');
const events = (w, type) => w.events.filter((e) => e.type === type);

test('a phoenix sits caged behind a locked, barred gate that takes a key', () => {
  const sim = catacombs();
  const w = sim.world;
  assert.equal(w.phoenixes.length, 1);
  const f = w.phoenixes[0];
  assert.equal(f.state, 'caged');
  // it is inside the world, on its perch, in free air
  assert.ok(f.pos[2] < w.size[2] - 1 && f.pos[2] > 27, `at z ${f.pos[2].toFixed(1)}`);
  assert.ok(!sim.phoenixAI.solidAt(f.pos), 'not inside stone');
  const g = gateOf(w);
  assert.ok(g >= 0);
  const d = w.doors[g];
  assert.ok(d.locked && d.key === 'dungeon' && d.bars);
  // bars with gaps: the gate does not fill the passage
  assert.ok(d.voxels.length > 20);
  // guards cannot open it, and it stays shut
  run(sim, 5);
  assert.equal(f.state, 'caged');
  // one guard carries the key
  assert.equal(w.enemies.filter((e) => e.key === 'dungeon').length, 1);
});

test('the jailer drops his keys when he dies', () => {
  const sim = catacombs();
  const w = sim.world;
  const jailer = w.enemies.find((e) => e.key);
  sim.ai.damage(jailer, 500);
  run(sim, 0.3);
  const keys = w.pickups.filter((p) => p.type === 'key');
  assert.equal(keys.length, 1);
  assert.equal(keys[0].key, 'dungeon');
  assert.ok(Math.hypot(keys[0].p[0] - jailer.p[0], keys[0].p[2] - jailer.p[2]) < 0.6);
  assert.equal(events(w, 'keysDropped').length, 1);
});

test('freed, it follows you through the passages and flies out up the stairs', () => {
  const sim = catacombs(false);
  const w = sim.world;
  const f = w.phoenixes[0];
  // you stand outside the gate: it calls to you
  const outside = [f.pos[0], 0.2, f.pos[2] - 4.5];
  player(sim, outside);
  run(sim, 1);
  assert.ok(events(w, 'phoenixCalls').length >= 1, 'it calls to you');
  toggleDoor(sim, gateOf(w), true);
  run(sim, 0.3);
  assert.equal(f.state, 'follow');
  run(sim, 6);
  const near = Math.hypot(f.pos[0] - outside[0], f.pos[2] - outside[2]);
  assert.ok(near < 3.2, `it came out to you (${near.toFixed(1)} m)`);
  // you walk off down the passages: it keeps up, flying under the ceiling
  const spot = [12.2, 0.2, 17.2];
  player(sim, spot);
  run(sim, 15);
  const d2 = Math.hypot(f.pos[0] - spot[0], f.pos[2] - spot[2]);
  assert.ok(d2 < 3.5, `it followed you (${d2.toFixed(1)} m behind)`);
  assert.ok(f.pos[1] > 0.9 && f.pos[1] < 2.3, `flying at ${f.pos[1].toFixed(2)} m`);
  assert.ok(!sim.phoenixAI.solidAt(f.pos));
  // to the foot of the entrance stairs: out it goes
  player(sim, [f.exit[0], 0.2, f.exit[2] + 1.2]);
  let t = 0;
  run(sim, 30, () => {
    if (f.state !== 'free') t = w.time;
  });
  assert.equal(f.state, 'free', `still ${f.state} at ${f.pos.map((v) => v.toFixed(1))}`);
  assert.equal(events(w, 'phoenixEscape').length, 1);
  assert.equal(events(w, 'phoenixFree').length, 1);
  void t;
});

test('it cannot open a closed door: it waits there', () => {
  const sim = catacombs(false);
  const w = sim.world;
  const f = w.phoenixes[0];
  toggleDoor(sim, gateOf(w), true);
  // you went into the chamber nearest the cell and shut its door behind you
  const k = w.doors.findIndex((d) => !d.bars && !d.locked && Math.abs(d.center[0] - f.pos[0]) < 1.5);
  assert.ok(k >= 0, 'a door between the cell and the middle');
  const d = w.doors[k];
  toggleDoor(sim, k, false);
  const inside = [d.center[0], 0.2, d.center[2] + (d.center[2] < f.pos[2] ? -1.5 : 1.5)];
  player(sim, inside);
  run(sim, 20);
  const ev = events(w, 'phoenixWaits').pop();
  if (ev) {
    // it waits at the door it names, and that door is shut
    const dk = w.doors.findIndex((x) => x.name === ev.door);
    assert.equal(w.doors[dk].open, false);
    assert.ok(Math.hypot(f.pos[0] - w.doors[dk].center[0], f.pos[2] - w.doors[dk].center[2]) < 2.5);
    toggleDoor(sim, dk, true);
    run(sim, 6);
    assert.notEqual(f.state, 'wait');
  } else {
    // there was a way round: it came to you all the same
    assert.ok(Math.hypot(f.pos[0] - inside[0], f.pos[2] - inside[2]) < 3.5);
  }
});

test('guards shoot at it; it burns to ash and is born again from it', () => {
  const sim = catacombs();
  const w = sim.world;
  const f = w.phoenixes[0];
  toggleDoor(sim, gateOf(w), true);
  run(sim, 0.3);
  // a guard who sees it from down the passage
  const g = w.enemies[0];
  const at = [f.pos[0], 0.2, f.pos[2] - 7];
  g.p = at.slice();
  g.state = 'patrol';
  for (const e of w.enemies.slice(1)) e.dead = true;
  const head = [at[0], at[1] + 1.6, at[2]];
  const target = sim.phoenixAI.seenBy(head);
  if (target) {
    // he fires at the bird, not at a player who is not there
    let hits = 0;
    for (let k = 0; k < 60 && f.state !== 'ashes'; k++) if (shoot(sim, head, [0, 1, 2].map((c) => f.pos[c] - head[c]), { shooter: g })?.phoenix) hits++;
    assert.ok(hits >= 1);
  } else sim.phoenixAI.wound(f, 1000);
  if (f.state !== 'ashes') sim.phoenixAI.wound(f, 1000);
  assert.equal(f.state, 'ashes');
  assert.equal(events(w, 'phoenixBurns').length, 1);
  // a real flame where it burst
  assert.ok(w.heaters.some((h) => h.temporary && Math.hypot(h.pos[0] - f.ash[0], h.pos[2] - f.ash[2]) < 0.5));
  // bullets pass through the ash
  assert.equal(sim.phoenixAI.at([f.ash[0], f.ash[1] + 0.3, f.ash[2]]), null);
  for (const e of w.enemies) e.dead = true;
  run(sim, 13);
  assert.equal(events(w, 'phoenixReborn').length, 1);
  assert.equal(f.health, 100);
  assert.ok(['follow', 'wait'].includes(f.state), f.state);
});

test('a gate blown out frees it too, and fire does not hurt it', () => {
  const sim = catacombs(false);
  const w = sim.world;
  const f = w.phoenixes[0];
  const d = w.doors[gateOf(w)];
  // fire round it: nothing
  const a = sim.airCellAt(...f.pos);
  w.airT[a] = 900;
  run(sim, 1);
  assert.equal(f.health, 100);
  // the bars gone
  for (const i of d.voxels) w.clearVoxel(i);
  run(sim, 0.3);
  assert.equal(f.state, 'follow');
});

test('the renderer draws it in every state without a DOM', () => {
  const sim = catacombs();
  const w = sim.world;
  const r = new PhoenixRenderer(new THREE.Group(), null);
  r.update(w, 0, 0.016);
  assert.equal(r.birds.length, 1);
  assert.ok(r.birds[0].g.visible);
  // the jailer's key ring at his belt
  assert.ok(r.keyMeshes.some((m) => m.visible));
  const f = w.phoenixes[0];
  for (const st of ['follow', 'ashes', 'reborn', 'escape']) {
    f.state = st;
    f.ash = f.pos.slice();
    f.t = 1;
    f.wing = 1;
    r.update(w, 1, 0.016);
  }
  f.state = 'free';
  r.update(w, 2, 0.016);
  assert.equal(r.birds[0].g.visible, false);
});
