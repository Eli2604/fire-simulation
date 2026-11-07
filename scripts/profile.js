import { SCENARIOS, cloneScene } from '../src/scenarios.js';
import { createSimulation } from '../src/sim/createSimulation.js';
import { stepAir, blurRadiation } from '../src/sim/air.js';
import { deriveWeather } from '../src/sim/weather.js';
const sim = createSimulation(cloneScene(SCENARIOS[process.argv[2] ?? 'metalBars']));
const w = sim.world; const D = deriveWeather(sim.weather);
for (let i = 0; i < 20; i++) sim.step(sim.dt);
const t = {};
const time = (k, f) => { const a = performance.now(); f(); t[k] = (t[k] ?? 0) + performance.now() - a; };
for (let i = 0; i < 100; i++) {
  time('heaters', () => sim.applyHeaters(sim.dt));
  time('passA', () => sim.solidPassA(sim.dt, D));
  time('passB', () => sim.solidPassB(sim.dt, D));
  time('air', () => stepAir(w, sim.weather, D, sim.dt, sim));
  time('rad', () => blurRadiation(w, sim.radGain));
  time('structure', () => sim.structure(sim.dt));
}
for (const k in t) console.log(k.padEnd(10), (t[k] / 100).toFixed(3), 'ms');
console.log('solids', w.solidCount, 'air', w.NA);
