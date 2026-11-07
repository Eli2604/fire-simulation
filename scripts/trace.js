// Trace voxels of given materials near a point over time. usage: node scripts/trace.js scenario mats seconds
import { SCENARIOS, cloneScene } from '../src/scenarios.js';
import { createSimulation } from '../src/sim/createSimulation.js';
import { MATERIALS } from '../src/sim/materials.js';
const [, , name, mats, secs = '10', step = '1'] = process.argv;
const sim = createSimulation(cloneScene(SCENARIOS[name]));
const w = sim.world;
const want = mats.split(',');
const show = () => {
  const rows = [];
  for (let k = 0; k < w.solidCount; k++) {
    const i = w.solids[k];
    const n = MATERIALS[w.mat[i]].name;
    if (!want.includes(n)) continue;
    rows.push(i);
  }
  rows.sort((a, b) => Math.max(w.skin[b], w.temp[b]) - Math.max(w.skin[a], w.temp[a]));
  console.log(`t=${w.time.toFixed(1)} HRR=${sim.stats.hrr.toFixed(0)}W burning=${sim.stats.burning} count=${rows.length}`);
  for (const i of rows.slice(0, 5)) {
    const [x, y, z] = w.coords(i);
    const a = w.faceAir[i];
    console.log(`   ${MATERIALS[w.mat[i]].name} ${x},${y},${z} core=${w.temp[i].toFixed(0)} skin=${w.skin[i].toFixed(0)} ex=${w.expo[i]} fl=${w.flags[i]} fuel=${w.fuel[i].toFixed(3)} mo=${w.moist[i].toFixed(3)} ws=${w.wetSkin[i].toFixed(2)} hrr=${w.hrr[i].toFixed(1)} air=${w.airT[a].toFixed(0)} flame=${w.flame[a].toFixed(2)}`);
  }
};
show();
let next = Number(step);
while (w.time < Number(secs)) { sim.step(sim.dt); if (w.time >= next) { show(); next += Number(step); } }
