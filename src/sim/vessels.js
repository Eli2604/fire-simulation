import { MATERIALS } from './materials.js';
import { F_BURNING, F_LIQUID, F_FALLING, F_ANCHOR } from './world.js';

/**
 * Pressure vessels: closed containers holding a volatile liquid (a car's fuel
 * tank, a propane cylinder).
 *
 *  - The liquid's vapour pressure rises with its temperature
 *    (Clausius–Clapeyron), on top of the heated air/vapour in the ullage.
 *  - The shell's strength falls as it heats up (steel loses most of its
 *    strength between 300 and 700 °C, plastics soften towards their melting point).
 *  - A working relief valve / vent releases vapour above its set pressure. The
 *    vapour burns as a jet flame, and boiling off cools the liquid.
 *  - If a shell voxel burns, melts or falls away, the vessel *leaks*: the
 *    liquid runs out (a pool fire, the usual fate of plastic car tanks).
 *  - If the pressure exceeds the (heat-weakened) strength, the vessel
 *    *ruptures*: a blast throws the shell and light nearby parts as debris,
 *    the flashing liquid forms a fireball (size and duration from the standard
 *    fireball correlations D = 5.8·m^(1/3), t = 0.45·m^(1/3)), nearby windows
 *    break and the rest of the liquid spills.
 *
 * Vessel spec (from the model): { fluid, burstPressure (Pa gauge at ambient),
 * ventPressure (Pa gauge, null = blocked/none), ventRate (kg/s per bar above
 * the set pressure), ullage (gas volume fraction) }.
 */

const P_ATM = 101325;
const R_HEAT_KIN = 0.25;
const SPLIT_PRESSURE = 1.5e5; // Pa gauge: failures below this tear the shell open instead of exploding // share of the burst energy that becomes kinetic energy of fragments

export function vaporPressure(fluid, T) {
  const v = fluid.vapor;
  if (!v) return 0;
  const Tk = T + 273.15;
  return v.refP * Math.exp(-v.B * (1 / Tk - 1 / (v.refT + 273.15)));
}

/** Remaining strength fraction of a shell material at temperature T (°C). */
export function strengthFactor(mat, T) {
  switch (mat.name) {
    case 'steel':
      if (T < 300) return 1;
      if (T < 700) return 1 - (0.9 * (T - 300)) / 400;
      return Math.max(0.02, 0.1 - (T - 700) / 3000);
    case 'aluminium':
      if (T < 150) return 1;
      if (T < 450) return 1 - (0.9 * (T - 150)) / 300;
      return 0.05;
    default: {
      // plastics: soften towards the melting point
      const mp = mat.meltingPoint;
      if (mp === Infinity) return 1;
      if (T < 50) return 1;
      return Math.max(0, 1 - (T - 50) / Math.max(10, mp - 50));
    }
  }
}

export function stepVessels(sim, dt) {
  const w = sim.world;
  if (!w.vessels.length) return;
  const { solids, vesselTag, mat, temp, skin, flags, fuel, dens, nx, ny } = w;
  const V = w.h ** 3;
  // gather per-vessel state in one pass
  const acc = w.vessels.map(() => ({ shell: [], contents: [], maxShellT: -Infinity, broken: false, mass: 0, heat: 0, cap: 0, top: -1, topY: -1, shellMat: null }));
  for (let k = 0; k < w.solidCount; k++) {
    const i = solids[k];
    const tag = vesselTag[i];
    if (!tag) continue;
    const a = acc[Math.abs(tag) - 1];
    if (!a) continue;
    if (tag > 0) {
      a.shell.push(i);
      a.shellMat ??= MATERIALS[mat[i]];
      const T = Math.max(temp[i], skin[i]);
      if (T > a.maxShellT) a.maxShellT = T;
      if (flags[i] & (F_LIQUID | F_FALLING)) a.broken = true;
      const y = ((i / nx) | 0) % ny;
      if (y > a.topY) {
        a.topY = y;
        a.top = i;
      }
    } else {
      a.contents.push(i);
      const M = MATERIALS[mat[i]];
      const m = M.density * dens[i] * V * fuel[i];
      a.mass += m;
      a.heat += m * temp[i];
      a.cap += m * M.specificHeat;
    }
  }

  w.vessels.forEach((v, k) => {
    if (v.state === 'ruptured' || v.state === 'leaking') return;
    const a = acc[k];
    v.shellCount0 ??= a.shell.length;
    v.mass0 ??= a.mass;
    if (!a.contents.length || a.mass <= 1e-6) {
      v.state = 'empty';
      v.pressure = 0;
      return;
    }
    const fluid = MATERIALS[w.mat[a.contents[0]]];
    v.fluid = fluid;
    const Tf = a.heat / a.mass;
    v.T0 ??= Tf;
    v.pAir0 ??= Math.max(0, P_ATM - vaporPressure(fluid, v.T0));
    v.volume ??= (a.contents.length * V) / (1 - (v.ullage ?? 0.15));
    v.liquidT = Tf;
    v.shellT = a.maxShellT;

    // a hole in the shell: the contents run out instead of building pressure
    if (a.broken || a.shell.length < v.shellCount0 * 0.97) {
      v.state = 'leaking';
      v.pressure = 0;
      release(w, a.contents);
      w.events.push({ type: 'leak', pos: w.center(...w.coords(a.contents[0])), time: w.time, name: v.name });
      return;
    }

    let pAbs = vaporPressure(fluid, Tf) + (v.pAir0 * (Tf + 273.15)) / (v.T0 + 273.15);
    // hydraulic overfill: the expanding liquid fills the vessel and the pressure shoots up
    const fill = (1 - (v.ullage ?? 0.15)) * (a.mass / v.mass0) * (1 + (fluid.vapor?.beta ?? 0.001) * (Tf - v.T0));
    v.fill = fill;
    if (fill > 0.97) pAbs += 2e8 * (fill - 0.97);
    const gauge = pAbs - P_ATM;
    v.pressure = gauge;
    v.strength = v.burstPressure * strengthFactor(a.shellMat, a.maxShellT);

    // relief valve / tank vent: vapour escapes and burns as a jet flame
    v.venting = false;
    if (v.ventPressure != null && gauge > v.ventPressure && a.top >= 0) {
      let mdot = (v.ventRate ?? 0.01) * ((gauge - v.ventPressure) / 1e5);
      mdot = Math.min(mdot, a.mass / dt / 4);
      if (mdot > 0) {
        v.venting = true;
        const m = mdot * dt;
        // take the mass from the liquid, and the latent heat of boiling from its temperature
        for (const i of a.contents) fuel[i] = Math.max(0, fuel[i] * (1 - m / a.mass));
        const dT = (m * (fluid.vapor?.Lv ?? 3e5)) / a.cap;
        for (const i of a.contents) temp[i] -= dT;
        // jet flame above the valve
        const [x, y, z] = w.coords(a.top);
        const q = mdot * fluid.heatOfCombustion;
        for (let up = 1; up <= 4; up++) {
          const yy = Math.min(w.ny - 1, y + up * 2);
          const ac = w.airIndexOfVoxel(x, yy, z);
          w.airQ[ac] += (q * 0.45) / 4;
          w.radSrc[ac] += (q * 0.3) / 4;
          w.flameAcc[ac] += q / 4;
        }
        sim.stats.ventHrr = (sim.stats.ventHrr ?? 0) + q;
      }
    }

    if (gauge > v.strength) {
      if (gauge < SPLIT_PRESSURE) {
        // a softened shell giving way at low pressure tears open: no blast, the contents pour out
        v.state = 'leaking';
        release(w, a.contents);
        w.events.push({ type: 'split', pos: w.center(...w.coords(a.contents[0])), time: w.time, name: v.name, pressure: gauge });
      } else rupture(sim, v, a, gauge, Tf);
    }
  });
}

/** Contents that are no longer contained: become ordinary (free flowing) liquid. */
function release(w, contents) {
  for (const i of contents) {
    w.vesselTag[i] = 0;
    w.flags[i] |= F_LIQUID;
    w.melt[i] = 1;
  }
  w.structureDirty = true;
}

function rupture(sim, v, a, gauge, Tf) {
  const w = sim.world;
  const h = w.h;
  const V = h ** 3;
  const fluid = v.fluid;
  v.state = 'ruptured';

  // centre of the vessel
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const i of a.shell) {
    const c = w.center(...w.coords(i));
    cx += c[0];
    cy += c[1];
    cz += c[2];
  }
  const ns = Math.max(1, a.shell.length);
  const center = [cx / ns, cy / ns, cz / ns];

  // burst energy: expansion of the pressurised gas plus flashing of superheated liquid
  const vap = fluid.vapor ?? { Tb: 100, Lv: 3e5 };
  const flash = Math.max(0, Math.min(1, (fluid.specificHeat * (Tf - vap.Tb)) / vap.Lv));
  // gas expansion (γ≈1.3) + flashing liquid (~1 kJ per kg per bar of superheat pressure, order of magnitude)
  const E = (gauge * v.volume * (v.ullage ?? 0.15)) / 0.3 + a.mass * flash * 1e5;
  v.burstEnergy = E;

  // fireball from the flashing / atomised liquid
  const mFb = a.mass * Math.min(1, 3 * flash + 0.05);
  if (mFb > 0) {
    const s = Math.cbrt(mFb);
    const radius = Math.min(Math.max(...w.size) * 0.45, 2.9 * s);
    const duration = Math.max(0.8, 0.45 * s);
    w.heaters.push({
      pos: [center[0], Math.max(h, center[1] - radius * 0.3), center[2]],
      power: (mFb * fluid.heatOfCombustion) / duration,
      radius,
      height: radius * 1.8,
      on: true,
      until: w.time + duration,
      temporary: true,
      fireball: true,
    });
    for (const i of a.contents) w.fuel[i] = Math.max(0, w.fuel[i] * (1 - mFb / a.mass));
  }

  // fragments: the shell, burning liquid droplets, and light parts nearby
  const mShell = a.shell.reduce((s, i) => s + MATERIALS[w.mat[i]].density * w.dens[i] * V, 0);
  const v0 = Math.max(5, Math.min(60, Math.sqrt((2 * R_HEAT_KIN * E) / Math.max(0.5, mShell))));
  const blastR = Math.max(3 * h, 0.4 * Math.cbrt(E / 1000));
  v.blastRadius = blastR;
  const launch = (i, speed) => {
    const p = w.center(...w.coords(i));
    let dx = p[0] - center[0];
    let dy = p[1] - center[1] + 0.3 * Math.hypot(p[0] - center[0], p[2] - center[2]) + 0.05;
    let dz = p[2] - center[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    const jitter = 0.35;
    dx = dx / len + (sim.rand() - 0.5) * jitter;
    dy = Math.abs(dy / len) + 0.2 + (sim.rand() - 0.5) * jitter;
    dz = dz / len + (sim.rand() - 0.5) * jitter;
    const l2 = Math.hypot(dx, dy, dz);
    launchVoxel(w, i, [(dx / l2) * speed, (dy / l2) * speed, (dz / l2) * speed]);
  };
  for (const i of a.shell) launch(i, v0 * (0.5 + sim.rand() * 0.7));
  // part of the remaining liquid is thrown out as burning droplets, the rest spills
  for (const i of a.contents) {
    w.vesselTag[i] = 0;
    w.flags[i] |= F_LIQUID;
    w.melt[i] = 1;
    if (w.fuel[i] <= 1e-4) {
      w.clearVoxel(i);
      continue;
    }
    if (sim.rand() < 0.4) {
      w.temp[i] = w.skin[i] = Math.max(w.temp[i], fluid.ignitionTemp + 100);
      w.flags[i] |= F_BURNING;
      launch(i, v0 * 0.4 * (0.4 + sim.rand()));
    }
  }

  // blast wave: light parts nearby fly, windows break
  const r2 = blastR * blastR;
  const glassR2 = (3 * blastR) ** 2;
  const n = w.solidCount;
  for (let k = 0; k < n; k++) {
    const i = w.solids[k];
    if (!w.mat[i]) continue;
    const [x, y, z] = w.coords(i);
    if (y === 0) continue;
    const p = w.center(x, y, z);
    const d2 = (p[0] - center[0]) ** 2 + (p[1] - center[1]) ** 2 + (p[2] - center[2]) ** 2;
    const M = MATERIALS[w.mat[i]];
    if (M.shatterTemp !== Infinity && d2 < glassR2) w.flags[i] |= F_FALLING;
    if (d2 > r2 || w.flags[i] & F_ANCHOR) continue;
    const m = M.density * w.dens[i] * V;
    const d = Math.sqrt(d2);
    const speed = v0 * (1 - d / blastR) ** 2 * Math.min(1, Math.sqrt(2 / Math.max(m, 1e-3)));
    if (speed > 3) launch(i, speed);
  }
  w.structureDirty = true;
  w.listDirty = true;
  w.events.push({ type: 'explosion', pos: center, time: w.time, energy: E, radius: blastR, name: v.name, pressure: gauge });
}

/** Take a voxel out of the grid and make it a flying fragment. */
export function launchVoxel(w, i, vel) {
  if (!w.mat[i]) return;
  const [x, y, z] = w.coords(i);
  const p = w.center(x, y, z);
  w.debris.push({
    p,
    v: vel,
    mat: w.mat[i],
    temp: w.temp[i],
    skin: w.skin[i],
    fuel: w.fuel[i],
    moist: w.moist[i],
    melt: w.melt[i],
    char: w.char[i],
    flags: w.flags[i] & ~F_FALLING,
    dens: w.dens[i],
    owner: w.owner[i],
    tint: [w.tint[i * 3], w.tint[i * 3 + 1], w.tint[i * 3 + 2]],
    age: 0,
  });
  w.clearVoxel(i);
}

/** Ballistic flight with air drag; fragments land back in the grid, still hot or burning. */
export function stepDebris(sim, dt) {
  const w = sim.world;
  if (!w.debris.length) return;
  const h = w.h;
  const keep = [];
  for (const d of w.debris) {
    d.age += dt;
    const M = MATERIALS[d.mat];
    // quadratic drag of a voxel-sized fragment: light panels slow down fast
    const k = Math.min(3, 0.6 / (M.density * d.dens * h));
    const sp = Math.hypot(...d.v);
    const steps = Math.min(30, Math.max(1, Math.ceil((sp * dt) / (0.5 * h))));
    const sdt = dt / steps;
    let landed = false;
    let gone = false;
    for (let s = 0; s < steps && !landed && !gone; s++) {
      const spd = Math.hypot(...d.v);
      for (let c = 0; c < 3; c++) d.v[c] -= k * spd * d.v[c] * sdt;
      d.v[1] -= 9.81 * sdt;
      const prev = d.p.slice();
      for (let c = 0; c < 3; c++) d.p[c] += d.v[c] * sdt;
      const x = Math.floor(d.p[0] / h);
      const y = Math.floor(d.p[1] / h);
      const z = Math.floor(d.p[2] / h);
      if (x < 0 || z < 0 || x >= w.nx || z >= w.nz || y >= w.ny + 20) {
        gone = true; // left the simulated area
        break;
      }
      if (y >= w.ny) continue;
      if (y < 1 || w.mat[w.idx(x, y, z)]) {
        landed = true;
        let px = Math.floor(prev[0] / h);
        let py = Math.max(1, Math.floor(prev[1] / h));
        let pz = Math.floor(prev[2] / h);
        px = Math.min(w.nx - 1, Math.max(0, px));
        pz = Math.min(w.nz - 1, Math.max(0, pz));
        let j = -1;
        for (let up = 0; up < 6 && py + up < w.ny; up++) {
          const c = w.idx(px, py + up, pz);
          if (!w.mat[c]) {
            j = c;
            break;
          }
        }
        if (j >= 0) place(w, j, d);
      }
    }
    // a burning fragment trails flames
    if (!landed && !gone && d.flags & F_BURNING && M.combustible && d.fuel > 0) {
      const ax = Math.floor(d.p[0] / w.ah);
      const ay = Math.floor(d.p[1] / w.ah);
      const az = Math.floor(d.p[2] / w.ah);
      if (ax >= 0 && ay >= 0 && az >= 0 && ax < w.anx && ay < w.any && az < w.anz) {
        const q = (M.burnTime > 0 ? (M.density * d.dens * h ** 3) / M.burnTime : M.burnRate * h * h * 4) * M.heatOfCombustion;
        const a = w.airIdx(ax, ay, az);
        w.flameAcc[a] += q;
        w.airQ[a] += q * 0.5;
      }
    }
    if (!landed && !gone) keep.push(d);
  }
  w.debris = keep;
}

function place(w, j, d) {
  w.setVoxel(j, d.mat, { temp: d.temp, moisture: d.moist, owner: d.owner, density: d.dens });
  w.skin[j] = d.skin;
  w.fuel[j] = d.fuel;
  w.melt[j] = d.melt;
  w.char[j] = d.char;
  w.flags[j] = d.flags;
  w.tint[j * 3] = d.tint[0];
  w.tint[j * 3 + 1] = d.tint[1];
  w.tint[j * 3 + 2] = d.tint[2];
}
