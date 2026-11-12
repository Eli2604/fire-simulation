// Run scenarios without rendering and print what happens over time.
// Usage: node scripts/headless.js [scenario] [simSeconds]
import { SCENARIOS, cloneScene } from '../src/scenarios.js';
import { createSimulation } from '../src/sim/createSimulation.js';
import { MATERIALS } from '../src/sim/materials.js';
import { F_LIQUID } from '../src/sim/world.js';

const names = process.argv[2] && process.argv[2] !== 'all' ? [process.argv[2]] : Object.keys(SCENARIOS).filter((k) => !SCENARIOS[k].page);
const total = Number(process.argv[3] ?? 120);

for (const name of names) {
  const scene = cloneScene(SCENARIOS[name]);
  const t0 = performance.now();
  const sim = createSimulation(scene);
  const w = sim.world;
  console.log(`\n== ${name}: grid ${w.nx}x${w.ny}x${w.nz} h=${w.h} solids=${w.solidCount} dt=${sim.dt.toFixed(3)} build=${(performance.now() - t0).toFixed(0)}ms`);
  const report = Math.max(total / 8, sim.dt);
  let next = 0;
  const tStart = performance.now();
  while (w.time < total) {
    sim.step(sim.dt);
    if (w.time >= next) {
      next += report;
      const byMat = {};
      for (let k = 0; k < w.solidCount; k++) {
        const i = w.solids[k];
        const n = MATERIALS[w.mat[i]].name;
        byMat[n] = (byMat[n] ?? 0) + 1;
      }
      let maxAir = -1e9;
      for (let a = 0; a < w.NA; a++) if (w.airT[a] > maxAir) maxAir = w.airT[a];
      let liquids = 0;
      for (let k = 0; k < w.solidCount; k++) if (w.flags[w.solids[k]] & F_LIQUID) liquids++;
      const s = sim.stats;
      console.log(
        `t=${w.time.toFixed(1).padStart(6)}s HRR=${(s.hrr / 1000).toFixed(1).padStart(7)}kW burning=${String(s.burning).padStart(5)} maxT=${s.maxT.toFixed(0).padStart(5)} maxAir=${maxAir.toFixed(0).padStart(5)} smoke=${(s.smoke * 1000).toFixed(1)}g steam=${(s.steam * 1000).toFixed(1)}g liquid=${liquids} falling=${s.falling} radScale=${sim.radScale.toFixed(2)} NaN=${Number.isNaN(s.maxT)}`,
      );
      if (w.time + report >= total) console.log('   materials:', JSON.stringify(byMat));
    }
  }
  const ms = performance.now() - tStart;
  console.log(`   ${sim.stats.steps} steps, ${(ms / sim.stats.steps).toFixed(2)} ms/step`);
}
