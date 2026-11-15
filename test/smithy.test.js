// The smith's workshop (models/smithy.js, sim/smithy.js): a sword of steel voxels heated in a fire
// of charcoal voxels blown by the bellows through the air model, moved with the smith's tongs,
// cooled on the anvil, quenched in a trough of water voxels (steam into the air), hardened by its
// voxels' own cooling; the smith's cycle; the shop; the drawing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceSmithy, pumpBellows, useSmithy, describeSmithy, martensite, newBlade, swordVoxels, stepSmithies, HEATS } from '../src/sim/smithy.js';
import { SCENARIOS, cloneScene, resolveScenario } from '../src/scenarios.js';
import { smithyScene } from '../src/smithyPlace.js';

// the smithy scene on its own (in the app it is the Fantasy world's smithy place: ?scenario=metalBars)
const SMITHY_SCENE = { name: 'Smithy: forging a sword', ...smithyScene() };
import { createSimulation } from '../src/sim/createSimulation.js';
import { MAT } from '../src/sim/materials.js';

const DT = 0.2;

/** The smithy scene without the smith (the test moves the blade itself). */
function shop(params = {}) {
  const sc = cloneScene(SMITHY_SCENE);
  sc.objects[0].params = { smith: false, ...params };
  const sim = createSimulation(sc);
  return { sim, w: sim.world, S: sim.world.smithies[0] };
}

function run(sim, seconds, dt = DT, each = null) {
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    each?.(t);
    sim.step(dt);
  }
}

/** The glowing heart of the fire: the mean surface temperature of the charcoal over the tuyere. */
function heartT(w, S) {
  let s = 0, n = 0;
  for (const i of S.potList.heartCells) {
    if (w.mat[i] !== MAT.forgeCoal || !(w.hrr[i] > 0)) continue;
    s += w.skin[i];
    n++;
  }
  return n ? s / n : 0;
}

/** The blade's voxels' temperatures, in body order. */
function temps(w, b) {
  const B = b.body;
  return Array.from({ length: B.n }, (_, k) => (B.at[k] >= 0 ? w.temp[B.at[k]] : B.s.temp[k]));
}

test('the scene: a compact smithy at fine voxels, the forge a fire of charcoal voxels, a trough of water voxels; no metal bars', () => {
  assert.deepEqual(resolveScenario('metalBars'), { scenario: 'fantasy', zone: 'smithy' });
  assert.match(SCENARIOS.fantasy.zones.smithy.name, /sword/);
  const desc = SMITHY_SCENE;
  assert.match(desc.name, /[Ss]mith/);
  assert.match(desc.name, /sword/);
  assert.equal(desc.exposure, 'indoor');
  assert.ok(desc.world.h <= 0.04, 'fine voxels');
  assert.deepEqual(desc.objects.map((o) => o.type), ['smithy'], 'no metal bars, no burners');
  const { sim, w, S } = shop();
  assert.equal(w.heaters.length, 0, 'no lumped heater: the fire is its voxels');
  const count = (m) => {
    let n = 0;
    for (let k = 0; k < w.solidCount; k++) if (w.mat[w.solids[k]] === m) n++;
    return n;
  };
  assert.ok(count(MAT.forgeCoal) > 200, `charcoal voxels in the fire pot: ${count(MAT.forgeCoal)}`);
  assert.equal(count(MAT.aluminium) + count(MAT.copper), 0, 'no aluminium or copper bars');
  assert.ok(count(MAT.water) > 1000, 'the slack tub holds water voxels');
  // the sword as voxels: several long, two wide at its base, thinner (less steel) towards the point
  const sv = swordVoxels(w.h);
  const blade = sv.filter((v) => v.part === 'blade');
  assert.ok(new Set(blade.map((v) => v.x)).size >= 15, 'a blade ≥15 voxels long');
  assert.ok(blade.some((v) => v.z > 0), 'two voxels wide at the base');
  assert.ok(blade.at(-1).dens < blade[0].dens / 4, 'the point holds far less steel than the base');
  const mass = sv.reduce((s, v) => s + v.dens * w.h ** 3 * 7850, 0);
  assert.ok(mass > 0.6 && mass < 1.5, `a sword's weight of steel: ${mass.toFixed(2)} kg`);
  // budget: the grid and the air small enough to stay interactive
  assert.ok(w.N <= 400e3 && w.NA <= 50e3, `${w.N} voxels, ${w.NA} air cells`);
  assert.ok(Number.isFinite(sim.dt));
});

test('the bellows make the fire hotter through the air model: the tuyere jet and its oxygen', () => {
  const still = shop();
  const blown = shop();
  run(still.sim, 30);
  run(blown.sim, 30, DT, (t) => {
    if (Math.floor((t + DT) / 1.1) > Math.floor(t / 1.1)) pumpBellows(blown.S, 1);
  });
  const Ts = heartT(still.w, still.S);
  const Tb = heartT(blown.w, blown.S);
  assert.ok(Tb > Ts + 150, `the heart of the fire: ${Tb.toFixed(0)} °C on the bellows, ${Ts.toFixed(0)} °C on the draught`);
  assert.ok(Tb > HEATS.forging, 'on the bellows the heart is past forging heat');
  assert.ok(blown.S.forge.combustion > 1.5 * still.S.forge.combustion, `burning ${(blown.S.forge.combustion / 1e3).toFixed(1)} vs ${(still.S.forge.combustion / 1e3).toFixed(1)} kW`);
  // it is in the air model: the jet's speed up through the bed, its oxygen at the glowing charcoal
  const vy = (x) => x.S.potList.air.reduce((s, a) => s + x.w.vy[a], 0) / x.S.potList.air.length;
  assert.ok(vy(blown) > vy(still) + 0.5, `air up through the heart ${vy(blown).toFixed(2)} vs ${vy(still).toFixed(2)} m/s`);
  assert.ok(blown.S.forge.air > still.S.forge.air * 2);
  // the smoke and hot gas go up the chimney
  let up = 0;
  for (let a = 0; a < blown.w.NA; a++) if (blown.w.airT[a] > 60 && Math.floor(a / blown.w.anx) % blown.w.any > blown.w.any - 4) up++;
  assert.ok(up > 0, 'hot gas up the flue');
});

test('the sword is voxels: heated in the fire (point first), carried with its heat, cooled on the anvil, quenched in the water (steam), hardened', () => {
  const { sim, w, S } = shop();
  const b = (S.blade = newBlade(S, w.ambient));
  b.place = 'fire';
  const blow = (t) => {
    if (Math.floor((t + DT) / 1.1) > Math.floor(t / 1.1)) pumpBellows(S, 1);
  };
  run(sim, 15, DT, blow);
  assert.ok(b.body && b.body.n === swordVoxels(w.h).length, 'its voxels are in the world');
  for (let k = 0; k < b.body.n; k++) assert.equal(w.mat[b.body.at[k]], MAT.steel);
  let T = temps(w, b);
  assert.ok(b.tip > b.base + 150, `the point heats first: point ${b.tip.toFixed(0)} °C, base ${b.base.toFixed(0)} °C`);
  assert.ok(T.at(-1) > T[0], 'hotter at the point than at the tang');
  run(sim, 60, DT, blow);
  assert.ok(b.T > HEATS.working, `in the fire it reaches working heat: ${b.T.toFixed(0)} °C over the blade, point ${b.tip.toFixed(0)}`);
  assert.ok(b.Tpeak > HEATS.forging - 100, `its hottest part ${b.Tpeak.toFixed(0)} °C`);

  // out with the tongs to the anvil: the voxels go with their heat
  T = temps(w, b);
  const fireCells = [...b.body.cells];
  b.place = 'anvil';
  sim.step(0.01);
  const T2 = temps(w, b);
  for (let k = 0; k < T.length; k++) assert.ok(Math.abs(T2[k] - T[k]) < 1, `voxel ${k}: ${T[k].toFixed(1)} -> ${T2[k].toFixed(1)} °C`);
  assert.ok(fireCells.every((c) => !b.body.cells.has(c)), 'it left the fire');
  const anvilTop = S.stations.anvil.top;
  const under = w.voxelAt(anvilTop[0], anvilTop[1] - w.h, anvilTop[2]);
  assert.equal(w.mat[under], MAT.steel, 'the anvil face under it');
  assert.ok([...b.body.cells].some((c) => c === under + w.nx || Math.abs(c - (under + w.nx)) < 30), 'it lies on the anvil');
  const anvil0 = w.temp[under];
  const hot0 = b.T;
  const tip0 = b.tip;
  run(sim, 10);
  assert.ok(w.temp[under] > anvil0 + 3, `the anvil takes its heat by contact: ${anvil0.toFixed(0)} -> ${w.temp[under].toFixed(0)} °C`);
  assert.ok(b.T < hot0 - 50, `it cools on the anvil: ${hot0.toFixed(0)} -> ${b.T.toFixed(0)} °C`);
  assert.ok((tip0 - b.tip) / (tip0 - 20) > (hot0 - b.T) / (hot0 - 20), `the thin point cools first: ${tip0.toFixed(0)} -> ${b.tip.toFixed(0)} °C`);

  // quench: back to cherry red (every voxel austenite) and into the slack tub
  for (let k = 0; k < b.body.n; k++) {
    const c = b.body.at[k];
    w.temp[c] = w.skin[c] = 850;
  }
  sim.step(0.01);
  const water = S.water.voxels.length;
  const water0 = S.water.T;
  let steamAir0 = 0;
  for (let a = 0; a < w.NA; a++) steamAir0 += w.steam[a];
  b.place = 'water';
  run(sim, 2, 0.05);
  let steamAir = 0;
  for (let a = 0; a < w.NA; a++) steamAir += w.steam[a];
  assert.ok(S.water.steam > 0 && steamAir > steamAir0, `water boiled off into the air: ${(S.water.steam * 1000).toFixed(1)} g`);
  assert.ok(S.water.steamRate > 0, 'steaming now (the hiss)');
  run(sim, 20, 0.1);
  assert.ok(b.Tpeak < 100, `quenched cold: ${b.Tpeak.toFixed(0)} °C`);
  assert.ok(S.water.T > water0 + 0.05, `the water warmed: ${water0.toFixed(2)} -> ${S.water.T.toFixed(2)} °C`);
  assert.ok(S.water.heat > 0);
  assert.ok(b.martensite > 0.6, `its voxels cooled fast enough to harden: martensite ${(b.martensite * 100).toFixed(0)} %`);
  assert.ok(b.hardness > 50, `${b.hardness.toFixed(0)} HRC`);
  // lifted out: the water comes back where it was
  b.place = 'tongs';
  sim.step(0.01);
  const back = S.water.voxels ? S.water.voxels.length : 0;
  stepSmithies(sim, 0.01);
  assert.ok(Math.abs(S.water.voxels.length - water) <= 2, `water voxels ${water} -> ${S.water.voxels.length} (${back})`);
  assert.ok(martensite(1) > 0.99 && martensite(40) < 0.01);
  const d = describeSmithy(S);
  assert.ok(d.rows.some((r) => /point .* base/.test(r)));
  for (let a = 0; a < w.NA; a++) assert.ok(Number.isFinite(w.airT[a]) && Number.isFinite(w.steam[a]));
});

/** The smith's cycle on its own: the blade's heat stood in for by a lumped model (no world). */
function standIn(S, dt) {
  const b = S.blade;
  if (!b) return;
  const to = (T, tau) => (b.T += (T - b.T) * Math.min(1, dt / tau));
  if (b.place === 'fire') to(1250, 40);
  else if (b.place === 'anvil') to(20, 50);
  else if (b.place === 'water') to(20, 2);
  else if (b.place === 'temper') to(450, 40);
  else to(20, 200);
  b.Tpeak = b.tip = b.base = b.T;
}

test("the smith's cycle: heat, hammer, reheat, quench, temper, grind, rack; the hammer's blows are impacts with the steel's temperature", () => {
  const { w, S } = shop({ smith: true, weapons: 0 });
  const events = [];
  const env = { Ta: 20, time: 0, event: (e) => events.push(e), restock: () => 0 };
  const seen = new Set();
  for (let t = 0; t < 3000 && S.made < 1; t += 0.1) {
    standIn(S, 0.1);
    advanceSmithy(S, 0.1, env);
    env.time += 0.1;
    seen.add(S.smith.state);
  }
  assert.equal(S.made, 1, `a sword made (smith: ${S.smith.state})`);
  for (const st of ['pick', 'heat', 'hammer', 'quench', 'temper', 'grind', 'shelve']) assert.ok(seen.has(st), st);
  assert.equal(S.cooling.length, 1, 'it stands on the rack to cool');
  const blows = events.filter((e) => e.type === 'impact' && e.kind === 'hammer');
  assert.ok(blows.some((e) => !e.bare && e.bladeT > 700), 'blows on the hot blade, with its temperature');
  assert.ok(blows.some((e) => e.bare), 'taps on the bare anvil between them');
  assert.ok(blows.every((e) => e.mass > 0 && e.speed > 0 && e.materials[0] === 'steel'));
  assert.ok(events.some((e) => e.type === 'bellows') && events.some((e) => e.type === 'quench'));
  assert.ok(w.smithies[0] === S);
});

test('the bellows by E at the lever; the inspector; the shop', () => {
  const { sim, S } = shop({ weapons: 3 });
  const L = S.stations.bellows.lever;
  const before = S.forge.blast;
  assert.match(useSmithy(sim, [L[0], 1, L[2] + 0.5]), /bellows/);
  assert.ok(S.forge.blast > before);
  assert.equal(useSmithy(sim, [L[0] + 5, 1, L[2] + 5]), null);
  assert.equal(S.weapons.length, 3);
  sim.step(DT);
  const d = describeSmithy(S);
  assert.match(d.title, /forge/);
  assert.ok(d.rows.some((r) => /charcoal voxels glowing/.test(r)));
  assert.ok(d.rows.some((r) => /Slack tub/.test(r)));
  assert.ok(d.rows.some((r) => /3 weapons/.test(r)));
});

test('the smithy is drawn: the blade as its voxels (glowing by each voxel), the smith; clicking it inspects it', async () => {
  const THREE = await import('three');
  const { SmithyRenderer } = await import('../src/render/smithy.js');
  const { describeThing } = await import('../src/sim/inspectThings.js');
  const { sim, w, S } = shop({ smith: true });
  const scene = new THREE.Scene();
  const R = new SmithyRenderer(scene, { spawn() {} });
  R.setWorld(w);
  sim.step(DT);
  sim.step(DT);
  const b = S.blade;
  assert.ok(b?.body, 'a blank lies on the anvil');
  // the point red hot, the rest cold
  const B = b.body;
  w.temp[B.at[B.n - 1]] = 900;
  R.update(0.1, 0);
  const it = R.items[0];
  const d = it.blades.get(b);
  assert.equal(d.segs.length, B.n, 'a piece per voxel');
  assert.ok(d.segs.at(-1).material.emissive.r > d.segs[0].material.emissive.r + 0.1, 'the hot voxel glows');
  scene.updateMatrixWorld(true);
  const p = S.smith.p;
  const hit = R.pick(new THREE.Ray(new THREE.Vector3(p[0], 3, p[2]), new THREE.Vector3(0, -1, 0)));
  assert.ok(hit?.thing, 'the smith can be clicked');
  assert.match(describeThing(sim, hit.thing).title, /forge/);
  assert.equal(it.shop.children.length, S.weapons.length, 'the weapons on display are drawn');
});
