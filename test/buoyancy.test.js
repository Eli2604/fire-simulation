import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBody, equilibrium, stability, placeAt, stepBody, updateMass, carrierBody, waveSpectrum, stepFloats, framePose, RHO_SEA, RHO_FRESH } from '../src/sim/buoyancy.js';
import { ROW_BOAT_PARAMS, rowBoatSpec, rowBoatDraft } from '../src/models/rowBoat.js';
import { bodyFromSpec } from '../src/sim/buoyancy.js';
import { MODELS } from '../src/models/index.js';
import { SCENARIOS, cloneScene } from '../src/scenarios.js';
import { createSimulation } from '../src/sim/createSimulation.js';
import { stepBuoyancy } from '../src/sim/water.js';
import { MAT } from '../src/sim/materials.js';
import { GROUPS } from '../src/editor/editor.js';
import * as THREE from 'three';
import { FloatRenderer } from '../src/render/floats.js';
import { RIG_KINDS, rigTargetFor } from '../src/rig/objects.js';

const ROW = Object.fromEntries(Object.entries(ROW_BOAT_PARAMS).map(([k, s]) => [k, s.value]));
const rowBody = (p = {}, rho = RHO_SEA) => bodyFromSpec(rowBoatSpec({ ...ROW, ...p }), rho);
const deg = (r) => (r * 180) / Math.PI;

test('Archimedes: a box of uniform density floats at draft = depth · ρ_body / ρ_water', () => {
  for (const [rhoB, rhoW] of [[600, RHO_SEA], [600, RHO_FRESH], [250, RHO_SEA], [900, RHO_FRESH]]) {
    const L = 4, B = 2, D = 1;
    const b = makeBody({ hull: { kind: 'box', length: L, beam: B, depth: D }, solid: true, mass: rhoB * L * B * D, rho: rhoW, cells: { n: 16, m: 8, l: 10 } });
    const e = equilibrium(b);
    const want = (D * rhoB) / rhoW;
    assert.ok(Math.abs(e.draft - want) < 1e-4, `ρ ${rhoB} in ${rhoW}: draft ${e.draft.toFixed(4)} m, want ${want.toFixed(4)}`);
    assert.ok(Math.abs(deg(e.roll)) < 0.01 && Math.abs(deg(e.pitch)) < 0.01, 'level');
    // the displaced water weighs what the box does
    assert.ok(Math.abs(e.V * rhoW - rhoB * L * B * D) < 1, 'displacement = weight');
  }
  // denser than the water: it sinks
  const lead = makeBody({ hull: { kind: 'box', length: 1, beam: 1, depth: 1 }, solid: true, mass: 1100, rho: RHO_FRESH, cells: { n: 4, m: 4, l: 4 } });
  assert.equal(equilibrium(lead).sinks, true);
});

test('a rowing boat: ~120 kg of wood, sits ~10 cm deep, deeper with every one aboard, deeper in fresh water', () => {
  const b = rowBody();
  assert.ok(b.hullMass > 90 && b.hullMass < 180, `hull ${b.hullMass.toFixed(0)} kg`);
  const drafts = [0, 1, 2, 4].map((crew) => rowBoatDraft({ ...ROW, crew }));
  assert.ok(drafts[0] > 0.05 && drafts[0] < 0.12, `empty ${drafts[0].toFixed(3)} m`);
  assert.ok(drafts[2] > 0.1 && drafts[2] < 0.2, `two aboard ${drafts[2].toFixed(3)} m`);
  for (let k = 1; k < drafts.length; k++) assert.ok(drafts[k] > drafts[k - 1] + 0.01, `deeper with more aboard: ${drafts.map((d) => d.toFixed(3))}`);
  // a load on the floorboards too
  assert.ok(rowBoatDraft({ ...ROW, load: 300 }) > drafts[0] + 0.05);
  // fresh water (1000) carries less than sea water (1025): it floats ~2.5 % deeper
  const sea = rowBoatDraft({ ...ROW, crew: 2, water: 'sea' });
  const fresh = rowBoatDraft({ ...ROW, crew: 2, water: 'fresh' });
  assert.ok(fresh > sea && fresh < sea * 1.05, `fresh ${fresh.toFixed(4)} m, sea ${sea.toFixed(4)} m`);
  // aluminium is lighter built: it floats higher; all three hulls float
  assert.ok(rowBoatDraft({ ...ROW, material: 'aluminium' }) < drafts[0]);
  assert.ok(Number.isFinite(rowBoatDraft({ ...ROW, material: 'grp' })));
});

test('pushed down it bobs back up and settles: damped heave about the equilibrium', () => {
  const b = rowBody({ crew: 1 });
  const eq = placeAt(b, 0, 0, 0, 0);
  b.Y += 0.1;
  const ys = [];
  for (let i = 0; i < 300; i++) {
    stepBody(b, 1 / 30, { level: 0 });
    ys.push(b.Y - eq.Y);
  }
  // it overshoots (an oscillation), each swing smaller, then it is at rest at its draft
  let crossings = 0;
  for (let i = 1; i < ys.length; i++) if (Math.sign(ys[i]) !== Math.sign(ys[i - 1]) && Math.abs(ys[i] - ys[i - 1]) > 1e-4) crossings++;
  assert.ok(crossings >= 2, `${crossings} swings`);
  const first = Math.min(...ys.slice(0, 45));
  assert.ok(first < -0.005 && first > -0.1, `overshoot ${first.toFixed(3)} m, less than it was pushed`);
  assert.ok(Math.abs(ys[ys.length - 1]) < 0.002 && Math.abs(b.vy) < 0.01, `at rest ${ys[ys.length - 1].toFixed(4)} m`);
  const T = b.tuned.periods[0];
  assert.ok(T > 0.5 && T < 3, `heave period ${T.toFixed(2)} s`);
});

test('heeled it rights itself: positive metacentric height, the centre of buoyancy moves to the low side', () => {
  for (const crew of [0, 2]) {
    const b = rowBody({ crew });
    const st = stability(b, { deg: 3 });
    assert.ok(st.GM > 0.1, `GM ${st.GM.toFixed(2)} m (${crew} aboard)`);
    placeAt(b, 0, 0, 0, 0);
    b.roll = (15 * Math.PI) / 180;
    let max = 0;
    for (let i = 0; i < 450; i++) {
      stepBody(b, 1 / 30, { level: 0 });
      if (i > 300) max = Math.max(max, Math.abs(deg(b.roll)));
    }
    assert.ok(max < 1, `rolled back upright: within ${max.toFixed(2)}° after 10 s`);
  }
  // the carrier too (GM of a couple of metres)
  assert.ok(stability(carrierBody()).GM > 0.5);
});

test('overloaded it swamps over the gunwale and sinks; holed it fills: aluminium goes down, wood floats waterlogged', () => {
  // two and a half tonnes on the floorboards (it displaces ~2.5 m³ to the gunwale): it goes under, the water pours in
  const o = rowBody({ crew: 1 });
  placeAt(o, 0, 0, 0, 0);
  o.loads.push({ m: 2500, p: [0, 0.16, 0] });
  updateMass(o);
  let swamped = false;
  for (let i = 0; i < 1200; i++) {
    stepBody(o, 0.05, { level: 0, bottom: -5 });
    swamped ||= o.swamped;
  }
  assert.ok(swamped && o.sunk, `swamped ${swamped}, sunk ${o.sunk} (${(o.water * 1000).toFixed(0)} l aboard)`);
  assert.ok(o.Y < -3, 'down on the bottom');
  // a plank stove in below the waterline (14 × 14 cm): an aluminium boat (no buoyancy tanks) sinks
  const a = rowBody({ material: 'aluminium' });
  placeAt(a, 0, 0, 0, 0);
  a.holes.push({ p: [0.2, 0.02, 0.1], area: 0.02 });
  let t = 0;
  for (; t < 600 && !a.sunk; t += 0.1) stepBody(a, 0.1, { level: 0, bottom: -5 });
  assert.ok(a.sunk, `aluminium holed: sunk after ${t.toFixed(0)} s (${(a.water * 1000).toFixed(0)} l aboard)`);
  // the wooden one fills to the outside level and floats on its planking, its freeboard less
  const w = rowBody();
  placeAt(w, 0, 0, 0, 0);
  stepBody(w, 0.1, { level: 0 });
  const fb0 = w.freeboard;
  w.holes.push({ p: [0.2, 0.02, 0.1], area: 0.02 });
  for (let k = 0; k < 3000; k++) stepBody(w, 0.1, { level: 0, bottom: -5 });
  assert.ok(!w.sunk && w.water > 0.1, `wood holed: ${(w.water * 1000).toFixed(0)} l aboard, afloat`);
  assert.ok(w.freeboard < fb0 - 0.05, `freeboard ${fb0.toFixed(2)} → ${w.freeboard.toFixed(2)} m`);
  // with buoyancy tanks the aluminium one stays up too
  const f = rowBody({ material: 'aluminium', flotation: 0.25 });
  placeAt(f, 0, 0, 0, 0);
  f.holes.push({ p: [0.2, 0.02, 0.1], area: 0.02 });
  for (let k = 0; k < 3000; k++) stepBody(f, 0.1, { level: 0, bottom: -5 });
  assert.ok(!f.sunk, 'buoyancy tanks keep it afloat');
});

test('on the waves it heaves, rolls and pitches with them, and does not take water in a moderate sea', () => {
  const b = rowBody({ crew: 1 });
  const eq = placeAt(b, 0, 0, 0, 0);
  const waves = waveSpectrum({ windSpeed: 5, windDir: 40 });
  let hi = -Infinity, lo = Infinity, roll = 0;
  for (let i = 0; i < 600; i++) {
    stepBody(b, 1 / 30, { level: 0, t: i / 30, waves });
    hi = Math.max(hi, b.Y - eq.Y);
    lo = Math.min(lo, b.Y - eq.Y);
    roll = Math.max(roll, Math.abs(deg(b.roll)));
  }
  assert.ok(hi - lo > waves.Hs * 0.4 && hi - lo < waves.Hs * 2.5, `heave ${(hi - lo).toFixed(2)} m in Hs ${waves.Hs.toFixed(2)} m`);
  assert.ok(roll > 0.2 && roll < 30, `roll up to ${roll.toFixed(1)}°`);
  assert.ok(b.water < 0.02, 'dry');
  // the same weather, the same waves as the ocean draws (render/ocean.js uses waveSpectrum)
  assert.equal(waveSpectrum({ windSpeed: 5 }).waves.length, 8);
});

test('the carrier floats by the same law: ~10–11 m deep at 100 000 t, level-ish in a sea, settles and lists as it floods', () => {
  const c = carrierBody();
  const eq = placeAt(c, 0, 0, 0, 0);
  assert.ok(eq.draft > 9.8 && eq.draft < 11.5, `draft ${eq.draft.toFixed(2)} m`);
  assert.ok(Math.abs(deg(eq.roll)) < 0.05 && Math.abs(deg(eq.pitch)) < 0.05, 'level');
  // a fresh breeze: it hardly moves (its periods far longer than these waves')
  const waves = waveSpectrum({ windSpeed: 9, windDir: 70 });
  let roll = 0, pitch = 0, heave = 0;
  for (let t = 0; t < 120; t += 0.2) {
    stepBody(c, 0.2, { level: 0, t, waves });
    roll = Math.max(roll, Math.abs(deg(c.roll)));
    pitch = Math.max(pitch, Math.abs(deg(c.pitch)));
    heave = Math.max(heave, Math.abs(c.Y - eq.Y));
  }
  assert.ok(roll < 1 && pitch < 0.5 && heave < 0.3, `roll ${roll.toFixed(2)}°, pitch ${pitch.toFixed(2)}°, heave ${heave.toFixed(2)} m`);
  assert.ok(c.tuned.periods[1] > 10, `roll period ${c.tuned.periods[1].toFixed(0)} s`);
  // 1000 t of sea in a compartment to starboard amidships: deeper by about m / (ρ·A_waterplane)
  // (~0.1 m on its ~10 000 m²), a list to starboard (tan φ ≈ m·y / (Δ·GM)); aft, down by the stern
  const f = carrierBody();
  const e0 = placeAt(f, 0, 0, 0, 0);
  f.loads.push({ m: 1.0e6, p: [f.G[0], 4, 12] });
  updateMass(f);
  const e1 = equilibrium(f);
  assert.ok(e1.draft - e0.draft > 0.07 && e1.draft - e0.draft < 0.2, `settled ${(e1.draft - e0.draft).toFixed(2)} m`);
  assert.ok(deg(e1.roll) > 0.2 && deg(e1.roll) < 5, `list ${deg(e1.roll).toFixed(2)}° to starboard`);
  f.loads[0].p = [-80, 4, 0];
  updateMass(f);
  const e2 = equilibrium(f);
  assert.ok(deg(e2.pitch) > 0.03 && Math.abs(deg(e2.roll)) < 0.05, `down by the stern (its bow up): trim ${deg(e2.pitch).toFixed(2)}°`);
});

test('the flight deck: the sea against the carrier from its hull, the deck staying where it is', () => {
  const sim = createSimulation({ ...cloneScene(SCENARIOS.carrier), zone: 'deck' });
  const w = sim.world;
  const level0 = w.sea.level;
  for (let k = 0; k < 20; k++) stepBuoyancy(sim, 0.25);
  const S = w.sea.ship;
  assert.ok(S.body && S.draft > 9.8 && S.draft < 11.5, `its hull floats ${S.draft?.toFixed(2)} m deep`);
  assert.ok(S.GM > 0.5, `GM ${S.GM?.toFixed(2)} m`);
  assert.ok(Math.abs(w.sea.level - level0) < 0.05 && Math.abs(S.heelDeg) < 0.5 && Math.abs(S.trimDeg) < 0.5, 'level, at its waterline');
  // the deck stays put (walking, jets, hatches): the sea moves against it
  assert.equal(S.deck, 11 + w.h);
});

test('the islet\'s red and blue boats are rowing boats afloat at the pier, and they still take you places', () => {
  assert.ok(MODELS.rowBoat, 'a model of its own');
  assert.ok(GROUPS.find(([g]) => g === 'Vehicles')[1].includes('rowBoat'), 'in the editor under Vehicles');
  const scene = cloneScene(SCENARIOS.carrier);
  const sim = createSimulation({ ...scene, zone: 'islet' });
  const w = sim.world;
  assert.equal(w.floats.length, 2, 'two boats');
  assert.deepEqual(w.floats.map((f) => f.model), ['rowBoat', 'rowBoat']);
  assert.deepEqual(w.floats.map((f) => f.params.hullColor), ['#b3332a', '#33598f'], 'red and blue');
  // each a portal: to the island and to the lake house, landing you on the pier
  for (const to of ['island', 'lake']) {
    const pt = w.portals.find((p) => p.to === to);
    assert.ok(pt?.arrive, `a boat to ${to}`);
    const [x, y, z] = pt.arrive.p;
    const below = w.mat[w.idx(Math.floor(x / w.h), Math.floor((y - 0.05) / w.h), Math.floor(z / w.h))];
    assert.ok(below, `you step ashore on the pier (${to})`);
  }
  // their hulls are voxels of wood (they burn), hidden: drawn afloat in their pose
  for (const f of w.floats) {
    assert.ok(f.voxels.length > 50 && f.voxels.every((i) => w.mat[i] === MAT.wood), 'planked in wood');
  }
  for (let k = 0; k < 90; k++) sim.step(1 / 30);
  for (const f of w.floats) {
    assert.equal(f.rho, RHO_SEA, 'on the sea');
    const pose = framePose(f.body);
    const draft = f.water.level - pose.p[1];
    assert.ok(draft > 0.03 && draft < 0.25, `${f.label}: keel ${draft.toFixed(3)} m under the sea`);
    assert.ok(!f.body.sunk && f.body.water < 0.01, 'afloat and dry');
  }
  // burn a hole in the red one's bottom: the sea comes in
  const red = w.floats[0];
  const low = red.voxLocal.map((p, k) => [p, red.voxels[k]]).filter(([p]) => p[1] < 0.06 && Math.abs(p[0]) < 1).map(([, i]) => i);
  assert.ok(low.length > 2, 'planking under the waterline');
  for (const i of low.slice(0, 6)) w.clearVoxel(i);
  for (let k = 0; k < 300; k++) sim.step(1 / 30);
  assert.ok(red.body.holes.length > 0 && red.body.water > 0.002, `${(red.body.water * 1000).toFixed(1)} l aboard through the hole`);
  // the trip there and back: the island's boat back to the islet lands you on its pier
  const island = createSimulation({ ...scene, zone: 'island' });
  assert.equal(island.world.floats.length, 2);
  assert.ok(island.world.portals.some((p) => p.to === 'islet' && p.arrive) && island.world.portals.some((p) => p.to === 'deck' && p.arrive));
});

test('a rowing boat on a pond floats in fresh water, still', () => {
  const sim = createSimulation({
    world: { size: [8, 3, 6], h: 0.1, ground: 'soil' },
    objects: [{ type: 'rowBoat', params: { crew: 2 }, x: 4, z: 3, y: 0.9 }],
    noFire: true,
    weather: { windSpeed: 0 },
  });
  const w = sim.world;
  // a pond round it up to its waterline (1.0 m: h + y), not in it (its hull keeps it out)
  const inBoat = (x, z) => Math.abs((x + 0.5) * w.h - 4) < 2.3 && Math.abs((z + 0.5) * w.h - 3) < 0.8;
  for (let x = 2; x < w.nx - 2; x++) for (let z = 1; z < w.nz - 1; z++) for (let y = 1; y < 10; y++) {
    const i = w.idx(x, y, z);
    if (!w.mat[i] && !inBoat(x, z)) w.setVoxel(i, MAT.water, {});
  }
  w.rebuildLists();
  stepFloats(sim, 0.1);
  const f = w.floats[0];
  assert.ok(f.water && !f.water.sea && f.rho === RHO_FRESH, 'a pond: fresh water');
  for (let k = 0; k < 60; k++) stepFloats(sim, 0.1);
  assert.ok(!f.body.sunk && Math.abs(deg(f.body.roll)) < 2, 'afloat, level');
  // drawn afloat where the simulation has it (render/floats.js): the hull's keel at its pose
  const r = new FloatRenderer(new THREE.Group());
  r.setWorld(w);
  r.update(0.1);
  assert.equal(r.items.length, 1);
  const g = r.items[0].m.group;
  assert.ok(Math.abs(g.position.y - f.body.pose.p[1]) < 1e-9 && g.position.y < f.water.level && g.position.y > f.water.level - 0.3, 'its keel under the surface');
  // and the rig has it (its Row boat: models/rowBoat.js params)
  assert.ok(RIG_KINDS.includes('rowBoat'));
  assert.equal(rigTargetFor({ type: 'rowBoat', params: {} }).kind, 'rowBoat');
});
