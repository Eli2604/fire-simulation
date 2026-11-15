import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RIG_OBJECTS, RIG_KINDS, RIG_TYPES, RIG_BUTTON, rigKind, rigTargetFor } from '../src/rig/objects.js';
import { createPhoenixStage, PHOENIX_ACTS, PHOENIX_PARAMS } from '../src/rig/phoenixStage.js';
import { PHOENIX, PHOENIX_ZONES, phoenixZones, phoenixZoneAt, phoenixRayHit } from '../src/ai/phoenix.js';
import { PhoenixRenderer } from '../src/render/phoenix.js';

const run = (st, t, each) => {
  for (let i = 0; i < Math.round(t * 30); i++) {
    st.step(1 / 30);
    each?.(st.bird);
  }
};
const zone = (f, k) => phoenixZones(f).find((z) => z.k === k);
const mid = (Z) => Z.a.map((v, c) => (v + Z.b[c]) / 2);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test('the rig lists the phoenix: after the dragon, its button, the catacombs open it', () => {
  assert.equal(RIG_KINDS[RIG_KINDS.indexOf('dragon') + 1], 'phoenix');
  assert.equal(RIG_OBJECTS.find((o) => o.kind === 'phoenix').label, 'Phoenix');
  assert.match(RIG_BUTTON.phoenix, /Rig the phoenix/);
  assert.equal(rigKind({ kind: 'phoenix' }), 'phoenix');
  assert.equal(RIG_TYPES.catacombs, 'phoenix');
  assert.deepEqual(rigTargetFor({ type: 'catacombs', params: { phoenix: true } }), { kind: 'phoenix' });
  assert.equal(rigTargetFor({ type: 'catacombs', params: { phoenix: false } }), null, 'no phoenix in them: no rig');
});

test('its acts and tunables', () => {
  assert.deepEqual(Object.keys(PHOENIX_ACTS), ['perch', 'stretch', 'call', 'takeoff', 'fly', 'hover', 'glide', 'bank', 'dive', 'flare', 'land', 'settle', 'die', 'rebirth']);
  assert.deepEqual(Object.keys(PHOENIX_PARAMS), ['span', 'heat', 'size', 'speed']);
  for (const p of Object.values(PHOENIX_PARAMS)) assert.ok(p.min <= p.value && p.value <= p.max && p.label);
  assert.deepEqual(Object.keys(PHOENIX_ZONES), ['body', 'head', 'wingL', 'wingR', 'tail']);
});

test('on its perch: sitting still, wings folded (no wing zones), watching you; the zones where its parts are', () => {
  const st = createPhoenixStage();
  st.viewer = [st.perch[0] + 4, st.perch[1] + 0.5, st.perch[2]];
  run(st, 2);
  const f = st.bird;
  assert.equal(f.state, 'caged');
  assert.ok(dist(f.pos, st.perch) < 0.1, 'on the perch');
  assert.ok(st.perch[1] > st.ground + 1, 'up on its block of stone');
  // turned to you (+x): its head is on your side of the body, its tail on the other
  assert.ok(mid(zone(f, 'head'))[0] > f.pos[0] + 0.1);
  assert.ok(mid(zone(f, 'tail'))[0] < f.pos[0] - 0.2);
  assert.ok(Math.abs(f.look[0] - st.viewer[0]) < 1e-9);
  assert.ok(!zone(f, 'wingL') && !zone(f, 'wingR'), 'folded: the wings lie along the body');
  // each zone found at its own middle; well above it, nothing
  for (const k of ['head', 'body', 'tail']) assert.equal(phoenixZoneAt(f, mid(zone(f, k)))?.k, k);
  assert.equal(phoenixZoneAt(f, [f.pos[0], f.pos[1] + 1, f.pos[2]]), null);
  // a ray down onto its back: the body; beside it: nothing
  assert.equal(phoenixRayHit(f, [f.pos[0], f.pos[1] + 5, f.pos[2]], [0, -1, 0])?.k, 'body');
  assert.equal(phoenixRayHit(f, [f.pos[0] + 3, f.pos[1] + 5, f.pos[2]], [0, -1, 0]), null);
  // the simulation's bullets use the same zones
  assert.equal(st.ai.hitAt(mid(zone(f, 'head')))?.k, 'head');
  assert.equal(st.ai.at(mid(zone(f, 'body'))), f);
  // a bigger head zone (the rig's slider) reaches further
  const p = [...mid(zone(f, 'head'))];
  p[1] += 0.2;
  assert.notEqual(phoenixZoneAt(f, p)?.k, 'head');
  PHOENIX_ZONES.head.r = 0.3;
  try {
    assert.equal(phoenixZoneAt(f, p)?.k, 'head');
  } finally {
    PHOENIX_ZONES.head.r = 0.12;
  }
});

test('take off, fly, glide, dive: in the air with its wings spread; the wing zones out to its sides', () => {
  const st = createPhoenixStage();
  st.play('takeoff');
  run(st, 4);
  const f = st.bird;
  assert.equal(f.state, 'follow');
  assert.ok(f.pos[1] > st.perch[1] + 0.5, `up (${f.pos[1].toFixed(2)} m)`);
  assert.ok(f.wing > 0.9 && f.flapRate > 0, 'beating its wings');
  const L = zone(f, 'wingL');
  const R = zone(f, 'wingR');
  assert.ok(L && R && dist(L.b, R.b) > 0.8, 'spread: the tips far apart');
  // a wider span (the slider): the wing tips further out
  const span0 = dist(L.b, R.b);
  st.set({ span: 1.5 });
  assert.ok(dist(zone(f, 'wingL').b, zone(f, 'wingR').b) > span0 * 1.3);
  st.set({ span: 1 });
  run(st, 3);
  assert.equal(st.act, 'fly', 'after the take-off, it flies on');
  // the glide: wings spread and still
  st.play('glide');
  let still = 0;
  run(st, 8, (b) => (still += b.flapRate === 0 && b.wing > 0.9 ? 1 : 0));
  assert.ok(still > 30, 'gliding, wings still');
  // the dive: steeply down, wings half folded, its fire flaring as it pulls out at the bottom
  st.play('dive');
  let low = 99, steep = 0, flared = 0, tucked = 1;
  run(st, 20, (b) => {
    low = Math.min(low, b.pos[1] - st.ground);
    steep = Math.min(steep, b.pitch);
    flared = Math.max(flared, b.flare);
    tucked = Math.min(tucked, b.wing);
  });
  assert.ok(steep < -0.7, `nose down (${steep.toFixed(2)})`);
  assert.ok(low < 2 && low > 0, `down near the ground (${low.toFixed(2)} m)`);
  assert.ok(tucked < 0.6, 'wings half folded in the stoop');
  assert.ok(flared > 0.5, 'its fire flares at the bottom');
});

test('land: back onto its perch; settle: down on the ground', () => {
  const st = createPhoenixStage();
  st.play('land');
  let perched = false;
  run(st, 16, (b) => (perched ||= st.phase === 'down' && dist(b.pos, st.perch) < 0.1));
  assert.ok(perched, 'it came down on its perch');
  st.play('settle');
  run(st, 10);
  const f = st.bird;
  assert.ok(Math.abs(f.pos[1] - (st.ground + PHOENIX.PERCH_HEIGHT)) < 0.15, `on the ground (${f.pos[1].toFixed(2)})`);
  assert.ok(f.wing < 0.1, 'wings folded');
});

test('hit zones do damage by their multiplier; killed it bursts into flame, lies in its ash and is born again', () => {
  const st = createPhoenixStage();
  run(st, 0.5);
  const f = st.bird;
  assert.equal(st.hitZone('head', 'bullet'), 22 * PHOENIX_ZONES.head.mult);
  assert.equal(f.health, 100 - 22 * PHOENIX_ZONES.head.mult);
  assert.ok(f.hurtFlash > 0);
  assert.equal(st.hitZone('wingL', 'bullet'), 0, 'folded: no wing to hit');
  st.hitZone('body', 'blast');
  assert.equal(f.state, 'ashes');
  assert.equal(st.act, 'die');
  assert.ok(st.world.events.some((e) => e.type === 'phoenixBurns'));
  assert.equal(phoenixZones(f).length, 0, 'ash: nothing to hit');
  run(st, PHOENIX.ASH_TIME + PHOENIX.REBIRTH_TIME + 1);
  assert.ok(st.world.events.some((e) => e.type === 'phoenixReborn'));
  assert.equal(f.health, PHOENIX.MAX_HEALTH);
  assert.equal(st.act, 'perch', 'born again: back to its perch');
  // Rise from the ashes: straight to the rising
  st.play('rebirth');
  run(st, 1);
  assert.equal(st.bird.state, 'reborn');
  // Revive: whole, on its perch
  st.revive();
  assert.equal(st.bird.health, PHOENIX.MAX_HEALTH);
  assert.equal(st.act, 'perch');
});

test('every act runs, and the renderer draws it with its tunables without a DOM', () => {
  const st = createPhoenixStage();
  st.set({ span: 1.4, heat: 2, size: 1.3, speed: 5 });
  assert.deepEqual([st.bird.span, st.bird.heat, st.bird.size], [1.4, 2, 1.3]);
  st.set({ span: 99 });
  assert.equal(st.params.span, PHOENIX_PARAMS.span.max, 'kept within its range');
  const r = new PhoenixRenderer(new THREE.Group(), null);
  for (const a of Object.keys(PHOENIX_ACTS)) {
    st.play(a);
    run(st, 1.5);
    const f = st.bird;
    assert.ok(f.pos.every(Number.isFinite), a);
    r.update(st.world, st.world.time, 1 / 30);
  }
  st.play('flare');
  run(st, 0.2);
  assert.ok(st.bird.flare > 0.5, 'the flame burst');
  r.update(st.world, st.world.time, 1 / 30);
  const b = r.birds[0];
  assert.ok(b.g.visible);
  assert.ok(Math.abs(b.wings[0].root.scale.y - PHOENIX_PARAMS.span.max) < 1e-9, 'the wings scaled by the span');
  assert.ok(Math.abs(b.wings[0].root.scale.x) === b.wings[0].root.scale.y, 'mirrored, the same size');
});
