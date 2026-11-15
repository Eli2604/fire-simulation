// Gas (LPG) cylinders as objects (models/gasCylinder.js) and their physics (sim/vessels.js, the
// lumped model): pressure from the liquid's temperature, the relief valve's jet flame, the wall
// above the liquid weakening, the BLEVE with its fireball and blast; where they stand in the
// worlds (the carrier, the military base); the old bonfire scene's key as an alias.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation, buildWorld } from '../src/sim/createSimulation.js';
import { vaporPressure, liquidDensity, blastOverpressure } from '../src/sim/vessels.js';
import { MATERIALS, MAT } from '../src/sim/materials.js';
import { describeThing } from '../src/sim/inspectThings.js';
import { defaultWeather } from '../src/sim/weather.js';
import { SCENARIOS, SCENARIO_ALIASES, resolveScenario, openScenario, cloneScene } from '../src/scenarios.js';
import { carrierChildren } from '../src/models/carrier.js';
import { campIslandZone } from '../src/campIsland.js';
import { MODELS } from '../src/models/index.js';

const LONG = { timeout: 10 * 60 * 1000 };
const run = (sim, t, stop = () => false) => {
  while (sim.world.time < t && !stop()) sim.step(sim.dt);
};
const bar = (p) => p / 1e5;

/** A cylinder standing in the flame of a big burner (engulfed), at voxel size h. */
function engulfed(params = {}, h = 0.1) {
  return createSimulation({
    world: { size: [4, 5, 4], h },
    weather: { ...defaultWeather(), ambient: 15, windSpeed: 0.5 },
    objects: [
      { type: 'burner', params: { power: 400000, flameRadius: 0.45, flameHeight: 2, nozzleHeight: 0.02 }, x: 2, z: 2 },
      { type: 'gasCylinder', params, x: 2, z: 2 },
    ],
  });
}

test('propane: vapour pressure and liquid density as in the tables', () => {
  const P = MATERIALS[MAT.propane];
  const g = (T) => bar(vaporPressure(P, T) - 101325);
  assert.ok(Math.abs(g(20) - 7.4) < 0.5, `20 °C: ${g(20).toFixed(1)} bar gauge`);
  assert.ok(Math.abs(g(50) - 16.1) < 1.2, `50 °C: ${g(50).toFixed(1)}`);
  assert.ok(Math.abs(g(70) - 24.8) < 1.5, `70 °C: ${g(70).toFixed(1)}`);
  // the liquid swells: 80 % full at 15 °C is full of liquid near 65 °C
  const fill = (T) => (0.8 * liquidDensity(P, 15)) / liquidDensity(P, T);
  assert.ok(fill(55) < 0.97 && fill(70) > 0.97, `fill ${fill(55).toFixed(3)} at 55 °C, ${fill(70).toFixed(3)} at 70 °C`);
  // butane: far less pressure
  const B = MATERIALS[MAT.butane];
  assert.ok(bar(vaporPressure(B, 20) - 101325) < 1.5);
  // the blast of an 11 kg cylinder (~1.5 MJ): ~20 kPa at 5 m, a few at 20 m
  assert.ok(blastOverpressure(1.5e6, 5) > 10 && blastOverpressure(1.5e6, 5) < 40);
  assert.ok(blastOverpressure(1.5e6, 20) < 6);
});

test('a gas cylinder is a placeable object with its parameters (gas, size, fill, valve, relief valve)', () => {
  const M = MODELS.gasCylinder;
  for (const k of ['gas', 'capacity', 'fill', 'valve', 'reliefValve']) assert.ok(M.params[k], k);
  assert.deepEqual(M.params.gas.options, ['propane', 'butane']);
  assert.deepEqual(M.params.reliefValve.options, ['working', 'blocked']);
  const sim = createSimulation({ world: { size: [2, 2, 2], h: 0.05 }, weather: { ambient: 20 }, objects: [{ type: 'gasCylinder', params: { capacity: 11, fill: 0.8 }, x: 1, z: 1 }] });
  sim.step(sim.dt);
  const v = sim.world.vessels[0];
  // the real cylinder's mass (not its voxels'), ~7.4 bar at 20 °C
  assert.ok(Math.abs(v.mass - 11) < 0.6, `${v.mass.toFixed(1)} kg`);
  assert.ok(Math.abs(bar(v.pressure) - 7.4) < 0.6, `${bar(v.pressure).toFixed(1)} bar`);
  assert.equal(v.state, 'sealed');
  // the inspector: the cylinder as a whole and why it has not burst
  const d = describeThing(sim, { kind: 'vessel', k: 0 });
  assert.equal(d.title, 'Gas cylinder');
  for (const s of ['Why:', 'Pressure:', 'Liquid:', 'Wall:', 'Relief valve: working']) assert.ok(d.rows.some((r) => r.startsWith(s)), s);
});

test('in a fire the pressure follows the liquid temperature; a working relief valve opens and jets a flame', LONG, () => {
  const sim = engulfed({ reliefValve: 'working' });
  const w = sim.world;
  const v = w.vessels[0];
  run(sim, 15);
  assert.ok(v.Tl > 20 && bar(v.pressure) > 8, `warming: ${v.Tl.toFixed(0)} °C, ${bar(v.pressure).toFixed(1)} bar`);
  // the pressure is the vapour pressure of the liquid at its temperature
  assert.ok(Math.abs(v.pressure + 101325 - vaporPressure(v.fluid, v.Tl)) < 1e4);
  run(sim, 120, () => v.prvOpened !== undefined);
  assert.ok(v.prvOpened > 10 && v.prvOpened < 120, `relief valve opens after ${v.prvOpened?.toFixed(0)} s`);
  assert.ok(w.events.some((e) => e.type === 'reliefValve'));
  run(sim, w.time + 3);
  assert.ok(v.jetPower > 3e5 && v.jet?.on && w.heaters.includes(v.jet), `a jet flame (${(v.jetPower / 1e3).toFixed(0)} kW, ${v.jetLength.toFixed(1)} m)`);
  assert.ok(v.mass < v.mass0, 'gas burns off');
  // the venting keeps the pressure near the set pressure (it does not climb with the fire)
  assert.ok(bar(v.pressure) < 30, `${bar(v.pressure).toFixed(1)} bar`);
  const d = describeThing(sim, { kind: 'vessel', k: 0 });
  assert.ok(d.rows.some((r) => r.startsWith('Jet flame:')) && d.rows.some((r) => /OPEN/.test(r)));
});

test('engulfed, even with a working relief valve: the dry wall overheats and the cylinder BLEVEs within minutes', LONG, () => {
  const sim = engulfed({ reliefValve: 'working' });
  const w = sim.world;
  const v = w.vessels[0];
  run(sim, 600, () => v.state !== 'sealed');
  assert.equal(v.state, 'ruptured', v.why);
  assert.ok(v.burstAt > 30 && v.burstAt < 300, `burst after ${v.burstAt.toFixed(0)} s`);
  assert.ok(v.Tv > 500, `the dry wall at ${v.Tv.toFixed(0)} °C`);
  assert.match(v.why, /dry wall/);
  assert.ok(v.prvOpened < v.burstAt, 'it had been venting');
});

test('blocked relief valve: the swelling liquid fills it and it bursts (BLEVE): fireball, blast, fragments', LONG, () => {
  const sim = engulfed({ reliefValve: 'blocked' });
  const w = sim.world;
  const v = w.vessels[0];
  let debris = 0;
  run(sim, 600, () => v.state !== 'sealed');
  debris = w.debris.length;
  assert.equal(v.state, 'ruptured', v.why);
  assert.ok(v.burstAt > 20 && v.burstAt < 300, `burst after ${v.burstAt.toFixed(0)} s`);
  assert.ok(v.prvOpened === undefined && !w.events.some((e) => e.type === 'reliefValve'), 'no relief');
  const ex = w.events.find((e) => e.type === 'explosion' && e.bleve);
  assert.ok(ex && ex.pressure > 17e5, `burst at ${bar(ex.pressure).toFixed(0)} bar`);
  // fireball: D ≈ 5.8·m^(1/3) of the mass that flashes and the spray it carries (all of an 11 kg cylinder)
  assert.ok(Math.abs(v.fireball.diameter - 5.8 * Math.cbrt(v.fireballMass)) < 0.01);
  assert.ok(v.fireballMass > 8 && v.fireball.diameter > 10 && v.fireball.diameter < 14, `${v.fireball.diameter.toFixed(1)} m`);
  assert.ok(w.heaters.some((h) => h.fireball), 'a fireball');
  assert.ok(v.burstEnergy > 3e5 && v.burstEnergy < 5e6, `${(v.burstEnergy / 1e6).toFixed(2)} MJ`);
  assert.ok(v.overpressure.find((o) => o.r === 5).kPa > 8, 'a blast');
  assert.ok(debris > 0, 'fragments fly');
  assert.ok(!w.heaters.some((h) => h === v.jet && h.on), 'no jet left');
  const d = describeThing(sim, { kind: 'vessel', k: 0 });
  assert.ok(d.rows.some((r) => r.startsWith('Fireball:')) && d.rows.some((r) => r.startsWith('Blast:')));
});

test('a cylinder smaller than the voxels (coarse worlds: the flight deck, the base) still holds its gas and bursts in a fire', LONG, () => {
  const sim = engulfed({ reliefValve: 'blocked' }, 0.4);
  const v = sim.world.vessels[0];
  run(sim, 2);
  assert.ok(Math.abs(v.mass - 11) < 0.6 && v.state === 'sealed', `${v.mass.toFixed(1)} kg, ${v.state}`);
  run(sim, 600, () => v.state !== 'sealed');
  assert.equal(v.state, 'ruptured', v.why);
});

test('two cylinders in a bonfire (the old scene): the blocked one bursts; the blast knocks, but does not take apart, the other', LONG, () => {
  const sim = createSimulation({
    world: { size: [5, 4, 5], h: 0.1 },
    weather: { ...defaultWeather(), windSpeed: 1, humidity: 0.4 },
    objects: [
      { type: 'woodPile', params: { arrangement: 'stack', logs: 14, logLength: 1.4, logRadius: 0.07, moisture: 0.1, stones: false }, x: 2.5, z: 2.5, ignite: true },
      { type: 'burner', params: { power: 150000, flameRadius: 0.7, flameHeight: 1.6, nozzleHeight: 0.04 }, x: 2.5, z: 2.5 },
      { type: 'gasCylinder', params: { reliefValve: 'working' }, x: 1.9, z: 3.1 },
      { type: 'gasCylinder', params: { reliefValve: 'blocked', color: '#3b6fb0' }, x: 3.1, z: 2.0 },
    ],
  });
  const w = sim.world;
  const [ok, blocked] = w.vessels;
  run(sim, 600, () => blocked.state !== 'sealed');
  assert.equal(blocked.state, 'ruptured', blocked.why);
  assert.ok(blocked.burstAt < 480, `burst after ${blocked.burstAt.toFixed(0)} s`);
  run(sim, w.time + 2);
  assert.ok(ok.state === 'sealed' && ok.mass > 5, `the other still holds its gas (${ok.state}, ${ok.mass.toFixed(1)} kg)`);
});

test('gas cylinders on the carrier (on deck, a rack in the store room below deck) and at the military base', () => {
  const kids = carrierChildren();
  assert.ok(kids.filter((k) => k.type === 'gasCylinder').length >= 2, 'by the island');
  const below = kids.find((k) => k.type === 'place' && k.key === 'below');
  assert.ok(below.objects.filter((o) => o.type === 'gasCylinder').length >= 3, 'the store room rack');
  const camp = campIslandZone();
  assert.ok(camp.objects.filter((o) => o.type === 'gasCylinder').length >= 3, 'the vehicle park, the barracks');
  // built: the store room's cylinders stand on the deck plating below deck
  const { world: w } = buildWorld({ ...cloneScene(SCENARIOS.carrier), zone: 'below' });
  const cyl = w.vessels.filter((v) => v.lumped);
  assert.equal(cyl.length, 3);
  for (const v of cyl) assert.ok(v.base[1] < 0.5, `on the floor (${v.base[1].toFixed(2)} m)`);
});

test('the bonfire scene is gone: its key opens the carrier below deck, by the store room and the gas line', () => {
  assert.equal(SCENARIOS.gasCylinders, undefined);
  assert.deepEqual(SCENARIO_ALIASES.gasCylinders, { scenario: 'carrier', zone: 'below' });
  assert.deepEqual(resolveScenario('gasCylinders'), { scenario: 'carrier', zone: 'below' });
  assert.equal(openScenario('gasCylinders').startZone, 'below');
});
