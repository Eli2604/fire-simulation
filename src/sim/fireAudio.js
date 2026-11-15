/**
 * What the fire sounds like, gathered from the simulation as it runs (sim/simulation.js calls
 * this from its solid pass only while something listens: sim.fireAudio set, e.g. by the
 * walk-through when its sound starts; otherwise it costs nothing). The burning voxels are binned
 * into regions of `cell` metres; every `every` seconds each region becomes a sound source:
 *
 *   { pos, hrr (W), count (burning voxels), diameter (m), mats: [{ name, count, moisture, temp }],
 *     steam (kg/s boiled off hot surfaces: the hiss), metal: { material, dTdt (K/s), count } | null,
 *     power (W of sound: audio/physics.js fireRoar) }
 *
 * audio/sound.js turns them into the roar (heat release, flame size, wind), the crackle (per
 * material: its moisture, resin, grain), the hiss of water on hot surfaces and the ticking of
 * metal heating and cooling, aggregating distant ones into few voices.
 */
import { MATERIALS } from './materials.js';
import { fireRoar } from '../audio/physics.js';

export class FireAudio {
  constructor({ cell = 2.5, every = 0.25 } = {}) {
    this.cell = cell;
    this.every = every;
    this.bins = new Map();
    this.sources = [];
    this.elapsed = 0;
    this.steps = 0;
    this.version = 0;
  }

  /** Before a solid pass of dt s: the sources are refreshed every `every` s. */
  step(w, dt) {
    this.h = w.h;
    this.elapsed += dt;
    this.steps++;
    if (this.elapsed >= this.every) this.flush();
  }

  bin(x, y, z) {
    const k = this.h / this.cell;
    const bx = Math.floor(x * k), by = Math.floor(y * k), bz = Math.floor(z * k);
    const key = bx + 4096 * (by + 4096 * bz);
    let b = this.bins.get(key);
    if (!b) this.bins.set(key, (b = { q: 0, n: 0, px: 0, py: 0, pz: 0, mats: new Map(), steam: 0, mDT: 0, mN: 0, mMat: 0 }));
    return b;
  }

  /** A voxel burning at q W (material id m, moisture mo kg/kg, surface temperature T °C). */
  burn(x, y, z, q, m, mo, T) {
    const b = this.bin(x, y, z);
    const h = this.h;
    b.q += q;
    b.n++;
    b.px += (x + 0.5) * h * q;
    b.py += (y + 0.5) * h * q;
    b.pz += (z + 0.5) * h * q;
    let s = b.mats.get(m);
    if (!s) b.mats.set(m, (s = [0, 0, 0]));
    s[0]++;
    s[1] += mo;
    s[2] += T;
  }

  /** kg of water flashed to steam on a hot surface at the voxel. */
  steam(x, y, z, kg) {
    this.bin(x, y, z).steam += kg;
  }

  /** A metal voxel changed its temperature by dT this step. */
  metal(x, y, z, dT, m) {
    if (Math.abs(dT) < 1e-4) return;
    const b = this.bin(x, y, z);
    b.mDT += Math.abs(dT);
    b.mN++;
    b.mMat = m;
  }

  flush() {
    const steps = Math.max(1, this.steps);
    const T = Math.max(1e-6, this.elapsed);
    const dtStep = T / steps;
    const out = [];
    const c = this.cell;
    for (const [key, b] of this.bins) {
      if (b.q <= 0 && b.steam <= 0 && b.mN === 0) continue;
      const bx = key % 4096, by = Math.floor(key / 4096) % 4096, bz = Math.floor(key / 4096 / 4096);
      const pos = b.q > 0 ? [b.px / b.q, b.py / b.q, b.pz / b.q] : [(bx + 0.5) * c, (by + 0.5) * c, (bz + 0.5) * c];
      const hrr = b.q / steps;
      const count = b.n / steps;
      const mats = [];
      for (const [m, s] of b.mats) mats.push({ name: MATERIALS[m].name, count: s[0] / steps, moisture: s[1] / s[0], temp: s[2] / s[0] });
      mats.sort((a, b2) => b2.count - a.count);
      const diameter = Math.max(this.h, Math.sqrt(count) * this.h);
      const metal = b.mN ? { material: MATERIALS[b.mMat]?.name ?? 'steel', dTdt: b.mDT / b.mN / dtStep, count: b.mN / steps } : null;
      const roar = fireRoar({ hrr, diameter });
      out.push({ pos, hrr, count, diameter, mats, steam: b.steam / T, metal, power: roar.power + b.steam * 0.01 + (metal ? 1e-6 * metal.count : 0) });
    }
    this.sources = out;
    this.bins.clear();
    this.elapsed = 0;
    this.steps = 0;
    this.version++;
  }
}
