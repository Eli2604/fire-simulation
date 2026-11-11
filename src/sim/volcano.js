import { MAT } from './materials.js';
import { explode } from './explosions.js';

/**
 * Volcanoes (models/volcano.js): asleep until a dragon comes within its trigger
 * distance of the crater (world.dragons, whatever moves them). Then it erupts:
 *
 *  - a blast in the crater (heard far off; it clears the crust, rocks fly);
 *  - lava wells up in the vent at `lavaRate` m³/s: molten basalt at ~1200 °C,
 *    which fills the crater, runs over the rim and down the slopes as a liquid,
 *    sets grass, trees and houses alight, and sets into dark rock as it cools;
 *  - lava bombs: glowing lumps thrown out of the crater that land around it;
 *  - an ash and gas column over the crater (heat and dark smoke).
 *
 * After `duration` seconds it dies down: no more lava, the column fades.
 */
const LAVA_T = 1200;

export function stepVolcanoes(sim, dt) {
  const w = sim.world;
  for (const v of w.volcanoes ?? []) {
    if (v.state === 'dormant') {
      for (const d of w.dragons ?? []) {
        if (!d?.p || d.dead) continue;
        // it has to pass by: be on the move (not asleep next to it)
        const last = (v.seen ??= new Map()).get(d);
        v.seen.set(d, d.p.slice());
        const moving = last && Math.hypot(d.p[0] - last[0], d.p[2] - last[2]) > 0.2 * dt;
        if (moving && Math.hypot(d.p[0] - v.crater[0], d.p[2] - v.crater[2]) < v.trigger) {
          erupt(sim, v);
          break;
        }
      }
      continue;
    }
    if (v.state !== 'erupting') continue;
    v.t += dt;
    if (v.t > v.duration) {
      v.state = 'spent';
      v.column.on = false;
      w.events.push({ type: 'eruptionEnd', pos: v.crater.slice(), time: w.time, name: 'the volcano' });
      continue;
    }
    // lava: welling up in the vent, as many voxels as the rate gives
    const vox = w.h ** 3;
    v.acc += (v.lavaRate * dt * (v.t < 8 ? 0.4 + v.t / 13 : 1)) / vox; // it builds up in the first seconds
    while (v.acc >= 1) {
      v.acc -= 1;
      if (!placeLava(sim, v)) {
        v.acc = 0;
        break;
      }
    }
    // lava bombs: a few glowing lumps a second
    v.bombAcc += dt * 3;
    while (v.bombAcc >= 1) {
      v.bombAcc -= 1;
      const a = sim.rand() * Math.PI * 2;
      const up = 8 + sim.rand() * 9;
      const out = 2 + sim.rand() * 5;
      w.debris.push({
        p: [v.crater[0], v.rim + 0.3, v.crater[2]],
        v: [Math.cos(a) * out, up, Math.sin(a) * out],
        mat: MAT.basalt, temp: LAVA_T, skin: LAVA_T, fuel: 1, moist: 0, melt: 1, char: 0, flags: 0, dens: 1, owner: -1,
        tint: [60, 30, 20], age: 0,
      });
    }
    // the column: strongest in the first minute
    v.column.power = 2.5e6 * (v.t < 60 ? 1 : Math.max(0.2, 1 - (v.t - 60) / (v.duration - 60)));
  }
}

/** It erupts: a blast in the crater, the lava starts, the ash column rises. */
export function erupt(sim, v) {
  const w = sim.world;
  if (v.state !== 'dormant') return;
  v.state = 'erupting';
  v.t = 0;
  v.acc = 0;
  v.bombAcc = 0;
  explode(sim, [v.crater[0], v.crater[1] + 0.5, v.crater[2]], 4e6, { name: 'eruption', flash: false });
  w.noises.push({ p: v.crater.slice(), loud: 400, time: w.time, kind: 'explosion' });
  w.events.push({ type: 'eruption', pos: v.crater.slice(), time: w.time, name: 'the volcano' });
  // the ash and gas column over the crater
  v.column = { pos: [v.crater[0], v.rim, v.crater[2]], power: 2.5e6, radius: v.craterRadius * 0.8, height: 6, on: true, label: 'eruption', smokeYield: 0.08, owner: -1 };
  w.heaters.push(v.column);
}

/** One voxel of lava, in the lowest free cell of the vent / crater (it rises as it fills). */
function placeLava(sim, v) {
  const w = sim.world;
  const { h, nx, ny, nz, mat } = w;
  const cx = Math.floor(v.crater[0] / h);
  const cz = Math.floor(v.crater[2] / h);
  const r = Math.max(1, Math.round(v.craterRadius / h));
  const y0 = Math.max(0, Math.floor(v.crater[1] / h) - 2);
  for (let y = y0; y < ny; y++)
    for (let k = 0; k < 12; k++) {
      // a random cell of this layer of the vent, nearer the middle first
      const rr = Math.min(r, 1 + Math.floor(k / 3));
      const x = cx + Math.round((sim.rand() - 0.5) * 2 * rr);
      const z = cz + Math.round((sim.rand() - 0.5) * 2 * rr);
      if (x < 0 || z < 0 || x >= nx || z >= nz) continue;
      const i = x + nx * (y + ny * z);
      if (mat[i]) continue;
      w.setVoxel(i, MAT.basalt, { temp: LAVA_T, color: [0.25, 0.12, 0.08], variation: 0.05 });
      return true;
    }
  return false;
}
