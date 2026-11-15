// The smith's workshop (models/smithy.js, sim/smithy.js): the forge and its bellows, the smith's
// work cycle, the quench and the steel's hardness, the shop filling up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import smithyModel from '../src/models/smithy.js';
import { resolveParams } from '../src/models/index.js';
import { placeSmithy, advanceSmithy, pumpBellows, useSmithy, describeSmithy, martensite, HEATS, FORGE } from '../src/sim/smithy.js';
import { SCENARIOS, cloneScene, resolveScenario } from '../src/scenarios.js';
import { createSimulation } from '../src/sim/createSimulation.js';
import { MAT } from '../src/sim/materials.js';

/** A smithy record as the voxelizer places it (here at the origin, unturned). */
function smithy(params = {}) {
  const built = smithyModel.build(resolveParams(smithyModel, params), { h: 0.1 });
  return placeSmithy(built.smithies[0], (x, y, z) => [x, y, z], 0, 0, 20);
}

/** A room for it: still air at 20 °C, a trough of 100 kg water whose temperature it changes. */
function room() {
  const env = { Ta: 20, o2: 0.232, waterT: 20, time: 0, events: [], steam: 0 };
  env.addWaterHeat = (J) => (env.waterT += J / (100 * 4186));
  env.addSteam = (kg) => (env.steam += kg);
  env.event = (e) => env.events.push(e);
  return env;
}

function run(S, env, seconds, dt = 0.1, until = null) {
  for (let t = 0; t < seconds; t += dt) {
    advanceSmithy(S, dt, env);
    env.time += dt;
    if (until?.()) return t;
  }
  return seconds;
}

test('the forge: the bellows (more air, more oxygen) make it burn faster and hotter', () => {
  const still = smithy({ smith: false, fireTemp: 700 });
  const blown = smithy({ smith: false, fireTemp: 700 });
  const e1 = room();
  const e2 = room();
  for (let t = 0; t < 120; t += 0.1) {
    advanceSmithy(still, 0.1, e1);
    // someone at the lever: a stroke a second
    if (Math.floor(t + 0.1) > Math.floor(t)) pumpBellows(blown, 1);
    advanceSmithy(blown, 0.1, e2);
  }
  assert.ok(blown.forge.T > still.forge.T + 200, `on the bellows ${blown.forge.T.toFixed(0)} °C, draught only ${still.forge.T.toFixed(0)} °C`);
  assert.ok(blown.forge.T > HEATS.forging, 'the bellows bring it above forging heat');
  assert.ok(still.forge.T < HEATS.forging, 'the draught alone does not');
  assert.ok(blown.forge.burn > 2 * still.forge.burn, 'more air: more charcoal burnt a second');
  assert.ok(blown.forge.power > still.forge.power, 'and more heat into the room (up the flue)');
  // with less oxygen in the air it burns slower
  const stale = smithy({ smith: false, fireTemp: 900 });
  const fresh = smithy({ smith: false, fireTemp: 900 });
  const e3 = { ...room(), o2: 0.15 };
  advanceSmithy(stale, 1, e3);
  advanceSmithy(fresh, 1, room());
  assert.ok(stale.forge.burn < fresh.forge.burn * 0.8);
});

test('the smith completes a weapon: forges, quenches, tempers, grinds and puts it in his shop', () => {
  const S = smithy({ weapons: 0 });
  const env = room();
  const seen = new Set();
  const t = run(S, env, 1800, 0.1, () => {
    if (S.smith) seen.add(S.smith.state);
    return S.made >= 1;
  });
  assert.equal(S.made, 1, `a weapon made (smith ${S.smith.state} at ${t.toFixed(0)} s)`);
  assert.equal(S.weapons.length, 1, 'it is in the shop');
  const wpn = S.weapons[0];
  assert.equal(wpn.kind, 'sword');
  assert.ok(S.slots[wpn.slot], 'on a rack slot');
  for (const st of ['heat', 'hammer', 'quench', 'temper', 'grind', 'shelve']) assert.ok(seen.has(st), st);
  assert.ok(env.events.some((e) => e.type === 'impact' && e.name === 'anvil'), 'hammer blows ring on the anvil');
  assert.ok(env.events.some((e) => e.type === 'bellows'), 'he worked the bellows');
  assert.ok(env.events.some((e) => e.type === 'quench'), 'a hiss as it went into the water');
  assert.ok(wpn.hardness > 40 && wpn.hardness < 60, `hardened and tempered: ${wpn.hardness.toFixed(1)} HRC`);
  assert.ok(wpn.temper > 240 && wpn.temper < 340, `tempered at ${wpn.temper.toFixed(0)} °C`);
  // the next one is under way, and they keep coming (an axe, a spear...)
  const t2 = run(S, env, 3600, 0.1, () => S.made >= 3);
  assert.ok(S.made >= 3, `three made after ${(t + t2).toFixed(0)} s`);
  assert.equal(S.weapons.length, S.made);
  assert.deepEqual(S.weapons.map((x) => x.kind), ['sword', 'axe', 'spear']);
  assert.ok(describeSmithy(S).rows.some((r) => r.includes('3 weapons')));
});

test('quenching warms the water, boils some off, and hardens the steel (cooling in air does not)', () => {
  const quenched = smithy({ smith: false });
  const env = room();
  const b = { kind: 'dagger', label: 'dagger', m: 0.35, A: 0.035, heats: 2, temperTarget: 240, T: 840, Tmax: 840, progress: 1, heat: 0, stage: 'harden', place: 'water', aus: true, t800: null, martensite: 0, temperMax: 0 };
  quenched.blade = b;
  run(quenched, env, 20, 0.05);
  assert.ok(b.T < 60, `cold after 20 s in water (${b.T.toFixed(0)} °C)`);
  assert.ok(env.waterT > 20.3, `the water warmed: ${env.waterT.toFixed(2)} °C`);
  assert.ok(env.steam > 0, 'some boiled off');
  assert.ok(b.t85 < 4, `800 -> 500 °C in ${b.t85.toFixed(1)} s`);
  assert.ok(b.martensite > 0.7 && b.hardness > 55, `martensite ${b.martensite.toFixed(2)}, ${b.hardness.toFixed(0)} HRC`);
  // the same blade left to cool in the air stays soft
  const aired = smithy({ smith: false });
  const a = { ...b, T: 840, place: 'tongs', aus: true, t800: null, martensite: 0 };
  aired.blade = a;
  run(aired, room(), 300, 0.1);
  assert.ok(a.t85 > 15 && a.hardness < 25, `air cooled: ${a.t85.toFixed(0)} s, ${a.hardness.toFixed(0)} HRC`);
  // tempering takes some of the hardness back
  const hard = b.hardness;
  b.place = 'temper';
  run(quenched, env, 300, 0.1, () => b.T > 290);
  assert.ok(b.hardness < hard - 3, `tempered at ${b.temperMax.toFixed(0)} °C: ${b.hardness.toFixed(0)} HRC (was ${hard.toFixed(0)})`);
  assert.ok(martensite(1) > 0.99 && martensite(40) < 0.01);
});

test('the shop holds 14 weapons: past that the oldest is sold', () => {
  const S = smithy({ weapons: 14 });
  assert.equal(S.weapons.length, 14);
  assert.equal(new Set(S.weapons.map((w) => w.slot)).size, 14);
});

test('smithy scene: the old metalBars key, a smith, the trough, the bars; the forge heats the room and the quench the water', () => {
  assert.deepEqual(resolveScenario('metalBars'), { scenario: 'metalBars', zone: null });
  const desc = SCENARIOS.metalBars;
  assert.match(desc.name, /[Ss]mith/);
  assert.equal(desc.exposure, 'indoor');
  const sim = createSimulation(cloneScene(desc));
  const w = sim.world;
  assert.equal(w.smithies.length, 1);
  const S = w.smithies[0];
  // the three test bars are still there (steel, aluminium, copper)
  for (const m of ['steel', 'aluminium', 'copper']) {
    let n = 0;
    for (let k = 0; k < w.solidCount; k++) if (w.mat[w.solids[k]] === MAT[m]) n++;
    assert.ok(n > 5, `${m} voxels`);
  }
  const forge = w.heaters.find((ht) => ht.forge);
  assert.ok(forge, 'the forge fire is a heater');
  for (let k = 0; k < 40; k++) sim.step(0.05);
  assert.ok(forge.power > 1000, `the forge heats the air: ${forge.power.toFixed(0)} W`);
  // a hot blade into the trough: its water voxels warm
  const water0 = S.water.T;
  S.smith = null;
  S.blade = { kind: 'sword', label: 'sword', m: 1.1, A: 0.09, heats: 4, temperTarget: 290, T: 850, Tmax: 850, progress: 1, heat: 0, stage: 'harden', place: 'water', aus: true, t800: null, martensite: 0, temperMax: 0 };
  for (let k = 0; k < 200; k++) sim.step(0.05);
  assert.ok(S.water.T > water0 + 0.5, `trough ${water0.toFixed(1)} -> ${S.water.T.toFixed(1)} °C`);
  assert.ok(S.blade.hardness > 50);
  // the bellows by E in the walk-through
  const L = S.stations.bellows.lever;
  const before = S.forge.blast;
  assert.match(useSmithy(sim, [L[0], 1, L[2] + 0.5]), /bellows/);
  assert.ok(S.forge.blast > before);
  assert.equal(useSmithy(sim, [0, 1, 0]), null);
  for (let a = 0; a < w.NA; a++) assert.ok(Number.isFinite(w.airT[a]));
});

test('the smithy is drawn: the smith, the blade, the bellows, the shop; clicking it inspects it', async () => {
  const THREE = await import('three');
  const { SmithyRenderer } = await import('../src/render/smithy.js');
  const { describeThing } = await import('../src/sim/inspectThings.js');
  const sim = createSimulation(cloneScene(SCENARIOS.metalBars));
  const w = sim.world;
  const scene = new THREE.Scene();
  const spawned = [];
  const R = new SmithyRenderer(scene, { spawn: (...a) => spawned.push(a) });
  R.setWorld(w);
  const S = w.smithies[0];
  // through a whole weapon (the smithy on its own, quickly), drawing as it goes
  const env = { Ta: 20, o2: 0.232, waterT: 20, time: 0, addWaterHeat() {}, addSteam() {}, event: (e) => w.events.push({ ...e }) };
  for (let t = 0; t < 900 && S.made < 1; t += 0.5) {
    advanceSmithy(S, 0.5, env);
    R.update(0.5, t);
  }
  assert.equal(S.made, 1);
  const it = R.items[0];
  assert.equal(it.shop.children.length, S.weapons.length, 'every weapon in the shop is drawn');
  assert.ok(spawned.length > 0, 'sparks off the anvil and the grindstone');
  scene.updateMatrixWorld(true);
  // a ray down onto the smith
  const p = S.smith.p;
  const ray = new THREE.Ray(new THREE.Vector3(p[0], 3, p[2]), new THREE.Vector3(0, -1, 0));
  const hit = R.pick(ray);
  assert.ok(hit?.thing, 'the smith can be clicked');
  const d = describeThing(sim, hit.thing);
  assert.match(d.title, /forge/);
  assert.ok(d.rows.some((r) => /Forge: fuel bed/.test(r)));
});
