import { MATERIALS, MAT, cpAt, heatTo } from './materials.js';
import { emitSound, LOUDNESS } from '../ai/perception.js';
import { airStirAt } from './stirrers.js';
import { breachFlowAt } from './breach.js';
import { inHull } from './vacuum.js';
import { F_BURNING, F_LIQUID, F_FALLING, F_ANCHOR } from './world.js';
import { blastVehicles } from '../physics/vehicleCore.js';

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
const U_WET = 3000; // W/(m²·K): wetted wall to boiling liquid
const SPLIT_PRESSURE = 1.5e5; // Pa gauge: failures below this tear the shell open instead of exploding // share of the burst energy that becomes kinetic energy of fragments

export function vaporPressure(fluid, T) {
  const v = fluid.vapor;
  if (!v) return 0;
  const Tk = T + 273.15;
  return v.refP * Math.exp(-v.B * (1 / Tk - 1 / (v.refT + 273.15)));
}

/** Remaining strength fraction of a shell material at temperature T (°C). */
export function strengthFactor(mat, T) {
  // a vessel smaller than the voxels has no wall voxels of its own (a fuel tank or a gas
  // bottle in a coarse scene): count it as a steel wall at the temperature of its contents
  if (!mat) return T > 400 ? Math.max(0.1, 1 - (T - 400) / 500) : 1;
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
  const acc = w.vessels.map(() => ({ shell: [], contents: [], maxShellT: -Infinity, liqTopY: -1, broken: false, mass: 0, heat: 0, cap: 0, top: -1, topY: -1, shellMat: null }));
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
      const yc = ((i / nx) | 0) % ny;
      if (yc > a.liqTopY) a.liqTopY = yc;
      const M = MATERIALS[mat[i]];
      const m = M.density * dens[i] * V * fuel[i];
      a.mass += m;
      a.heat += m * temp[i];
      a.cap += m * M.specificHeat;
    }
  }

  w.vessels.forEach((v, k) => {
    if (v.lumped) return stepLumped(sim, v, acc[k], k, dt);
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
    let Tf = a.heat / a.mass;
    // The liquid cools the wall it wets: through a few mm of steel into a boiling
    // liquid the heat flows fast, so the heat the flames put into the lower shell
    // goes into the contents (the thin-sheet voxels would otherwise hold it back).
    // The wall above the liquid has only vapour behind it: that is the part that
    // gets red hot and loses its strength.
    {
      let q = 0;
      const A = 2 * w.h * w.h;
      for (const i of a.shell) {
        const y = ((i / nx) | 0) % ny;
        if (y > a.liqTopY) continue;
        const Ts = Math.max(temp[i], skin[i]);
        if (Ts <= Tf) continue;
        const M = MATERIALS[mat[i]];
        const mass = M.density * dens[i] * V;
        const mC = mass * cpAt(mat[i], Ts);
        const dQ = Math.min(U_WET * A * (Ts - Tf) * dt, mC * (Ts - Tf) * 0.8);
        // (through the steel's enthalpy: its c(T), materials.js)
        const T1 = heatTo(mat[i], temp[i], -dQ / mass);
        const dT = temp[i] - T1;
        temp[i] = T1;
        skin[i] = Math.max(Tf, skin[i] - dT);
        q += dQ;
      }
      if (q > 0 && a.cap > 0) {
        const dT = q / a.cap;
        for (const c of a.contents) temp[c] += dT;
        Tf += dT;
      }
    }
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

// ------------------------------------------------------------------ liquefied gas cylinders

const SIGMA = 5.67e-8;
const STEEL_RHO_C = 7850 * 500; // J/(m³·K)
const U_BOIL = 3000; // W/(m²·K): wetted wall to the boiling liquid
const H_VAPOUR = 10; // W/(m²·K): dry wall to the vapour behind it (natural convection, poor)
// a shell voxel takes the flames' heat in through every face it has open: outside, and into the
// hollow inside the shell (the air grid, coarser than the voxels, has the flames in there too); the
// real wall only through its outside
const SENSOR = 0.5;
const PHI_MAX = 2e5;
const HOLE_RATE = 0.4; // kg/s through a hole torn in the shell (per 11 kg cylinder)

/** Density of a liquefied gas at T °C (kg/m³): it swells as it warms (materials.js vapor.expansion). */
export function liquidDensity(fluid, T) {
  const e = fluid.vapor?.expansion;
  const d = T - 15;
  if (!e) return fluid.density * (1 - (fluid.vapor?.beta ?? 0.001) * d);
  return fluid.density * Math.exp(-(e.a * d + (d > 0 ? e.b * d * d : 0)));
}

/**
 * Peak side-on overpressure (kPa) at r m of a burst of energy E J at the ground (Sadovsky's
 * fit in Hopkinson-scaled distance Z = r / W^(1/3), W the TNT equivalent: 4.6 MJ/kg; half
 * the energy goes into the blast, the ground doubles it).
 */
export function blastOverpressure(E, r) {
  const W = E / 4.6e6;
  const Z = Math.max(0.5, r / Math.cbrt(Math.max(W, 1e-9)));
  return 100 * (0.85 / Z + 3 / Z ** 2 + 8 / Z ** 3);
}

/**
 * A liquefied-gas cylinder as the real one (models/gasCylinder.js: its mass, volume, radius,
 * height, wall), whatever the voxel size (an 11 kg cylinder is one voxel at 0.4 m, ~1 kg of
 * voxel liquid at 8 cm). Its voxels are its sensors and its look:
 *
 *  - the heat the scene's flames put into its shell voxels (each a thin sheet of the wall's
 *    thickness, so their temperature rise is the real wall's) is the flux on the wall, W/m²,
 *    for the part wetted by the liquid and the part above it; the voxels are then set back to
 *    the model's wall temperatures (they glow where the real wall would);
 *  - the wetted wall passes its heat to the boiling liquid (it stays a few tens of degrees above
 *    it); the dry wall only warms the vapour, and heats up: that is the wall that weakens;
 *  - the pressure is the liquid's vapour pressure (Clausius–Clapeyron); the liquid swells as it
 *    warms, and once it fills the cylinder (> 97 %) the pressure shoots up (hydraulic);
 *  - the relief valve pops open at its set pressure and closes at 90 % of it (blowdown); its
 *    flow is choked vapour (∝ absolute pressure), liquid if it is full: a burning jet whose boil-
 *    off cools the liquid, and the level falls, drying out more of the wall;
 *  - it bursts when the pressure exceeds what the hot wall holds (BLEVE), or tears open at low
 *    pressure (a burning jet from the hole until it is empty).
 *
 * Why it did or did not burst: v.why (the inspector: sim/inspectThings.js 'vessel').
 */
function stepLumped(sim, v, a, k, dt) {
  const w = sim.world;
  const { temp, skin, dens, mat, nx, ny } = w;
  const h = w.h;
  if (v.state === 'ruptured' || v.state === 'empty') return setJet(w, v, 0);
  const fluid = (v.fluid ??= MATERIALS[MAT[v.gas ?? 'propane']]);
  const vap = fluid.vapor;
  const cp = fluid.specificHeat;
  // first step: the liquid at the temperature it was placed at, the mass from the fill
  if (v.Tl === undefined) {
    let T = w.ambient ?? 15;
    if (a.contents.length) T = a.contents.reduce((s, i) => s + temp[i], 0) / a.contents.length;
    v.Tl = v.T0 = v.Tv = T;
    v.Tw = T;
    v.mass0 = v.mass = v.volume * (v.fill0 ?? 0.8) * liquidDensity(fluid, T);
    v.shellCount0 = a.shell.length;
    v.lastSet = new Map();
    v.prvOpen = false;
    v.vented = 0;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const i of a.shell) {
      const y = ((i / nx) | 0) % ny;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    v.rows = [y0, y1];
    if (!v.base && a.shell.length) {
      const c = w.center(...w.coords(a.shell[0]));
      v.base = [c[0], (y0 + 0.5) * h, c[2]];
      v.top = [c[0], (y1 + 1) * h, c[2]];
    }
  }
  if (!v.base) return;
  // a hole in the shell (a fragment, a bullet, burnt through): the gas jets out of it, burning
  if (v.state === 'sealed' && v.shellCount0 > 0 && (a.broken || a.shell.length < v.shellCount0 * 0.97)) {
    v.state = 'holed';
    v.why = 'holed: the shell was broken open – the gas jets out of the hole, burning, until the cylinder is empty (no pressure left to burst it)';
    w.events.push({ type: 'leak', pos: v.top.slice(), time: w.time, name: v.name });
  }

  const r = v.radius;
  const H = v.height;
  const fill = v.mass / (v.volume * liquidDensity(fluid, v.Tl));
  const level = Math.max(0, Math.min(1, fill));
  const Aend = Math.PI * r * r;
  const Aside = 2 * Math.PI * r * H;
  const Awet = Aend + Aside * level;
  const Adry = Aend + Aside * (1 - level);

  // the flux on the wall from the scene: what its voxels took in since they were last set
  let qWet = 0;
  let nWet = 0;
  let qDry = 0;
  let nDry = 0;
  const [ry0, ry1] = v.rows;
  const zoneOf = (i) => (((((i / nx) | 0) % ny) - ry0 + 0.5) / (ry1 - ry0 + 1) <= level ? 'wet' : 'dry');
  if (dt > 0)
    for (const i of a.shell) {
      const was = v.lastSet.get(i);
      if (was === undefined) continue;
      const M = MATERIALS[mat[i]];
      const q = (SENSOR * M.density * cpAt(mat[i], was) * dens[i] * h * (0.5 * (temp[i] + skin[i]) - was)) / dt;
      if (zoneOf(i) === 'wet') {
        qWet += q;
        nWet++;
      } else {
        qDry += q;
        nDry++;
      }
    }
  let phiWet = nWet ? qWet / nWet : null;
  let phiDry = nDry ? qDry / nDry : null;
  // (a cylinder smaller than its voxels: the air round it, the flames in it)
  if (phiWet === null && phiDry === null) {
    // (the open air cells it stands in)
    const cells = [];
    for (let y = v.base[1]; y < v.top[1] + w.ah; y += w.ah / 2) {
      const ac = sim.airCellAt(v.base[0], y, v.base[2]);
      if (ac >= 0 && w.occ[ac] < 0.75 && !cells.includes(ac)) cells.push(ac);
    }
    phiWet = airFlux(sim, v, cells, v.Tw);
    phiDry = airFlux(sim, v, cells, v.Tv);
  }
  phiWet ??= phiDry;
  phiDry ??= phiWet;
  // (no fire puts much more than ~200 kW/m² on a wall, a jet flame playing on it; a coarse voxel can say more)
  phiWet = Math.max(-PHI_MAX, Math.min(PHI_MAX, phiWet));
  phiDry = Math.max(-PHI_MAX, Math.min(PHI_MAX, phiDry));

  // the dry wall: heated from outside, it loses a little to the vapour and radiates to the liquid
  const wallC = STEEL_RHO_C * (v.wall ?? 0.003);
  const TvK = v.Tv + 273.15;
  const TlK = v.Tl + 273.15;
  const qIn = (H_VAPOUR + (v.venting ? 15 : 0)) * (v.Tv - v.Tl) + 0.25 * SIGMA * (TvK ** 4 - TlK ** 4);
  v.Tv += ((phiDry - qIn) * dt) / wallC;
  // (the wall a falling level leaves dry starts at the wetted wall's temperature)
  if (v.Tv < v.Tw) v.Tv = v.Tw;
  // the wetted wall: as hot as it must be to pass the flux to the boiling liquid
  v.Tw = v.Tl + Math.max(-30, phiWet / U_BOIL);
  v.phiWet = phiWet;
  v.phiDry = phiDry;

  // the liquid: what the wall gives it, less the latent heat of what boils off through a valve
  const Q = phiWet * Awet + qIn * Adry;
  const mC = Math.max(0.05, v.mass) * cp;
  v.Tl += (Q * dt) / mC;

  // the pressure: vapour pressure, and hydraulic once the swelling liquid fills the cylinder
  const fillNow = v.mass / (v.volume * liquidDensity(fluid, v.Tl));
  v.fill = fillNow;
  let pAbs = vaporPressure(fluid, v.Tl);
  const full = fillNow > 0.97;
  if (full) pAbs += 2e8 * (fillNow - 0.97);
  const gauge = v.state === 'holed' ? Math.max(0, pAbs - P_ATM) * 0.3 : pAbs - P_ATM; // (holed: what is left in it, venting freely)
  v.pressure = gauge;
  v.hydraulic = full;
  v.strengthFactor = strengthFactor(MATERIALS[MAT.steel], v.Tv);
  v.strength = v.burstPressure * v.strengthFactor;

  // what leaves it: the relief valve, the open cylinder valve, a hole
  let mdot = 0;
  let liquidOut = false;
  if (v.state === 'holed') {
    mdot = HOLE_RATE * (v.ventCapacity / 0.08) * Math.min(1, Math.max(0.1, gauge / 8e5));
  } else {
    if (v.ventPressure != null) {
      const set = v.ventPressure;
      if (!v.prvOpen && gauge > set) {
        v.prvOpen = true;
        if (v.prvOpened === undefined) {
          v.prvOpened = w.time;
          w.events.push({ type: 'reliefValve', pos: v.top.slice(), time: w.time, name: v.name, pressure: gauge });
        }
      } else if (v.prvOpen && gauge < 0.9 * set) v.prvOpen = false;
      if (v.prvOpen) {
        const lift = Math.max(0.1, Math.min(1, (gauge - 0.9 * set) / (0.15 * set)));
        mdot += v.ventCapacity * lift * (pAbs / (set + P_ATM));
        // a cylinder full of liquid relieves liquid: far more mass through the same seat
        if (full) {
          mdot *= 5;
          liquidOut = true;
        }
      }
    }
    if (v.drawRate > 0 && gauge > 0) mdot += v.drawRate * Math.min(2, pAbs / 9e5);
  }
  mdot = Math.min(mdot, v.mass / Math.max(dt, 1e-3));
  v.venting = mdot > 0 && v.state === 'sealed' && v.prvOpen;
  v.mdot = mdot;
  if (mdot > 0) {
    const m = mdot * dt;
    v.mass -= m;
    v.vented += m;
    if (!liquidOut) v.Tl -= (m * vap.Lv) / mC; // (boiling off: the latent heat comes from the liquid)
  }
  setJet(w, v, mdot);

  // the voxels: the wall as the model has it, the liquid's temperature, how much is left
  const left = v.mass0 > 0 ? v.mass / v.mass0 : 0;
  for (const i of a.shell) {
    const T = zoneOf(i) === 'wet' ? v.Tw : v.Tv;
    temp[i] = skin[i] = T;
    v.lastSet.set(i, T);
  }
  for (const i of a.contents) {
    temp[i] = skin[i] = v.Tl;
    w.fuel[i] = Math.max(0.02, left);
  }

  if (v.mass <= v.mass0 * 0.01) {
    const through = v.state === 'holed' ? 'hole' : v.prvOpened ? 'relief valve' : 'valve';
    v.state = 'empty';
    v.pressure = 0;
    setJet(w, v, 0);
    v.why = `empty: ${v.vented.toFixed(1)} kg burnt off through the ${through} – nothing left to burst it`;
    return;
  }
  if (v.state === 'sealed' && gauge > v.strength) {
    if (gauge < SPLIT_PRESSURE) {
      v.state = 'holed';
      v.why = `the softened wall (${v.Tv.toFixed(0)} °C) tore open at ${(gauge / 1e5).toFixed(1)} bar: a burning jet from the tear, no blast`;
      w.events.push({ type: 'split', pos: v.top.slice(), time: w.time, name: v.name, pressure: gauge });
      return;
    }
    v.why =
      `BURST (BLEVE) at ${(gauge / 1e5).toFixed(1)} bar: ` +
      (full
        ? `liquid-full (${(fillNow * 100).toFixed(0)} % at ${v.Tl.toFixed(0)} °C) with the relief valve ${v.ventPressure == null ? 'blocked' : 'unable to keep up'}: hydraulic rupture (the wall, ${v.Tv.toFixed(0)} °C at its hottest, held ${(v.strength / 1e5).toFixed(0)} bar)`
        : `the dry wall above the liquid at ${v.Tv.toFixed(0)} °C held only ${(v.strength / 1e5).toFixed(0)} bar (${(v.strengthFactor * 100).toFixed(0)} % of its strength)`);
    ruptureLumped(sim, v, a, k, gauge);
    return;
  }
  // why not (yet)
  const p = (gauge / 1e5).toFixed(1);
  const hold = `the wall (dry part ${v.Tv.toFixed(0)} °C) holds ${(v.strength / 1e5).toFixed(0)} bar`;
  if (v.state === 'holed') v.why = `holed: jetting out burning, ${v.mass.toFixed(1)} kg left`;
  else if (v.prvOpen) v.why = `relief valve venting at ${p} bar (a jet flame): ${hold}; level ${(level * 100).toFixed(0)} %`;
  else if (v.ventPressure == null) v.why = `relief valve blocked: ${p} bar and rising with the liquid's temperature; ${hold}; ${(fillNow * 100).toFixed(0)} % full of liquid (hydraulic at 97 %)`;
  else v.why = `${p} bar, below the relief valve's ${(v.ventPressure / 1e5).toFixed(1)} bar; ${hold}`;
}

/**
 * Heat flux (W/m²) onto a wall at Tw from the air round it (a cylinder smaller than its voxels:
 * the air cells are coarser still, and a flame fills only part of one). f: how much of it the
 * flames engulf, from the flame field of the cells about it and the heaters (a burner, a jet)
 * whose flame it is in; engulfed, a sooty flame at ~900 °C radiates ~100 kW/m² onto it.
 */
function airFlux(sim, v, cells, Tw) {
  const w = sim.world;
  if (!cells.length) return 0;
  let f = 0;
  let Tg = -Infinity;
  let G = 0;
  for (const c of cells) {
    f = Math.max(f, Math.min(1, 1.5 * (w.flame[c] ?? 0)));
    Tg = Math.max(Tg, w.airT[c]);
    G = Math.max(G, w.radField[c] ?? 0);
  }
  const mid = [v.base[0], (v.base[1] + v.top[1]) / 2, v.base[2]];
  for (const ht of w.heaters) {
    if (!ht.on || ht.power <= 0 || ht === v.jet || (ht.start !== undefined && w.time < ht.start)) continue;
    const d = ht.dir ?? [0, 1, 0];
    const dl = Math.hypot(...d) || 1;
    const q = [mid[0] - ht.pos[0], mid[1] - ht.pos[1], mid[2] - ht.pos[2]];
    const t = (q[0] * d[0] + q[1] * d[1] + q[2] * d[2]) / dl;
    if (t < -v.height / 2 || t > (ht.height ?? 1)) continue;
    const off = Math.sqrt(Math.max(0, q[0] ** 2 + q[1] ** 2 + q[2] ** 2 - t * t));
    if (off < (ht.radius ?? 0.2) + v.radius) f = 1;
  }
  const TwK = Tw + 273.15;
  const TaK = (w.ambient ?? 15) + 273.15;
  const flameT = 850; // °C: a sooty pool-fire flame (its emissive power ~80 kW/m²)
  const engulfed = 0.9 * SIGMA * (flameT + 273.15) ** 4 + 20 * (flameT - Tw);
  const open = 15 * (Tg - Tw) + 0.85 * (G + SIGMA * TaK ** 4);
  return f * engulfed + (1 - f) * open - 0.85 * SIGMA * TwK ** 4;
}

/** The burning jet from the valve (or a hole): a heater of its own, as long as gas comes out. */
function setJet(w, v, mdot) {
  if (!v.jet) {
    if (mdot <= 0) return;
    v.jet = { pos: v.top.slice(), power: 0, radius: 0.1, height: 0.5, on: false, jet: true, label: 'gas jet', smokeYield: 0.001 };
    w.heaters.push(v.jet);
  }
  const Q = mdot * (v.fluid?.heatOfCombustion ?? 46e6);
  v.jetPower = Q;
  v.jet.on = Q > 0;
  v.jet.power = Q;
  // a jet flame's length: L ≈ 0.12·Q^0.4 (Q in kW): ~3 m at 3 MW, ~0.7 m for a 70 kW torch
  const L = Q > 0 ? Math.max(0.3, 0.12 * (Q / 1000) ** 0.4) : 0;
  v.jetLength = L;
  v.jet.height = L;
  v.jet.radius = 0.06 + 0.08 * L;
  if (v.state === 'holed' && !v.jet.dir) v.jet.dir = [0.7, 0.3, 0.2]; // (out of the side of the shell)
}

/**
 * The cylinder bursts: the flashing liquid (the share that boils at once on the drop to 1 atm)
 * and the vapour expand: a blast; what flashes and the spray it carries burn as a fireball
 * (mass m: D = 5.8·m^(1/3), t = 0.45·m^(1/3)); the shell flies apart, its top (the valve end)
 * rocketing off; the rest of the liquid spills, burning.
 */
function ruptureLumped(sim, v, a, k, gauge) {
  const w = sim.world;
  const h = w.h;
  const fluid = v.fluid;
  const vap = fluid.vapor;
  v.state = 'ruptured';
  setJet(w, v, 0);
  const center = [v.base[0], (v.base[1] + v.top[1]) / 2, v.base[2]];
  const m = v.mass;
  const pAbs = gauge + P_ATM;
  // flash fraction: cp·(T - Tb)/Lv
  const flash = Math.max(0, Math.min(1, (fluid.specificHeat * (v.Tl - vap.Tb)) / vap.Lv));
  // the expanding vapour (ullage + the flashing liquid at the burst pressure; Brode: p·V/(γ-1))
  const R = 8.314 / (fluid.name === 'butane' ? 0.0581 : 0.0441);
  const rhoV = pAbs / (R * (v.Tl + 273.15));
  const Vgas = Math.max(0, v.volume * (1 - Math.min(1, v.fill))) + (m * flash) / rhoV;
  const E = (gauge * Vgas) / 0.3;
  v.burstEnergy = E;
  v.burstAt = w.time;
  v.burstPressure0 = gauge;
  v.flash = flash;
  // fireball: the flashing liquid and the spray it drags along (3x the flash fraction, all of it at ~35 %)
  const mFb = m * Math.min(1, 3 * flash);
  v.fireballMass = mFb;
  if (mFb > 0.01) {
    const s = Math.cbrt(mFb);
    const radius = Math.min(Math.max(...w.size) * 0.45, 2.9 * s);
    const duration = Math.max(0.8, 0.45 * s);
    v.fireball = { diameter: 5.8 * s, duration };
    w.heaters.push({ pos: [center[0], Math.max(h, center[1] + radius * 0.3), center[2]], power: (mFb * fluid.heatOfCombustion) / duration, radius, height: radius * 1.8, on: true, until: w.time + duration, temporary: true, fireball: true });
    sim.ignite?.(center, Math.min(radius, 3));
  }
  const left = Math.max(0, (m - mFb) / Math.max(1e-6, v.mass0));
  v.mass = 0;
  v.pressure = 0;
  v.overpressure = [2, 5, 10, 20].map((r) => ({ r, kPa: blastOverpressure(E, r) }));

  // fragments: the shell's voxels; the top (the valve end) rockets off upward
  const V = h ** 3;
  const mShell = 7850 * (v.wall ?? 0.003) * (2 * Math.PI * v.radius * v.height + 2 * Math.PI * v.radius ** 2);
  // (a tenth of the energy goes into the fragments: tens of m/s, as BLEVE fragments fly; Baum)
  const v0 = Math.max(8, Math.min(45, Math.sqrt((2 * 0.1 * E) / Math.max(1, mShell))));
  const blastR = Math.max(3 * h, 0.4 * Math.cbrt(E / 1000));
  v.blastRadius = blastR;
  v.fragmentSpeed = v0;
  // with rigid bodies (physics/simPhysics.js): the shell flies as a few real pieces of its steel
  // (the blast pushes the bodies that are there first, not the pieces it makes)
  sim.rigid?.explosion(center, E, blastR * 1.5);
  blastVehicles(sim.world, center, E, blastR * 1.5); // (the vehicles' bodies: physics/vehicleCore.js)
  const rigidShell = !!sim.rigid && v.radius > 0 && v.height > 0;
  if (rigidShell) {
    const level = Math.max(0, Math.min(1, v.fill ?? 0.8));
    v.fragmentBodies = cylinderFragments(sim, {
      center, radius: v.radius, height: v.height, wall: v.wall ?? 0.003, mShell, eKin: 0.1 * E, gauge,
      Tdry: v.Tv ?? 15, Twet: v.Tw ?? 15, level, fluid, carried: 0.05 * m, valve: true,
    });
    for (const i of a.shell) {
      w.pieceOf?.delete(i);
      w.clearVoxel(i);
    }
  }
  const launch = (i, speed, up = 0) => {
    const p = w.center(...w.coords(i));
    let dx = p[0] - center[0];
    let dy = p[1] - center[1] + 0.3 * Math.hypot(p[0] - center[0], p[2] - center[2]) + 0.05 + up;
    let dz = p[2] - center[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    dx = dx / len + (sim.rand() - 0.5) * 0.35;
    dy = Math.abs(dy / len) + 0.2 + (sim.rand() - 0.5) * 0.35;
    dz = dz / len + (sim.rand() - 0.5) * 0.35;
    const l2 = Math.hypot(dx, dy, dz);
    launchVoxel(w, i, [(dx / l2) * speed, (dy / l2) * speed, (dz / l2) * speed]);
  };
  const topRow = v.rows?.[1] ?? Infinity;
  if (!rigidShell)
    for (const i of a.shell) {
      const y = ((i / w.nx) | 0) % w.ny;
      if (y >= topRow) launch(i, v0 * (1.2 + 0.4 * sim.rand()), 3);
      else launch(i, v0 * (0.5 + sim.rand() * 0.7));
    }
  // the rest of the liquid: burning droplets, the rest spills
  for (const i of a.contents) {
    w.vesselTag[i] = 0;
    w.flags[i] |= F_LIQUID;
    w.melt[i] = 1;
    w.fuel[i] = left;
    if (left <= 1e-3) {
      w.clearVoxel(i);
      continue;
    }
    w.temp[i] = w.skin[i] = Math.max(w.temp[i], fluid.ignitionTemp + 100);
    w.flags[i] |= F_BURNING;
    if (sim.rand() < 0.5) launch(i, v0 * 0.3 * (0.4 + sim.rand()));
  }
  // the blast: light things nearby fly, windows break further out (other cylinders stand: knocked, not torn apart)
  const r2 = blastR * blastR;
  const glassR2 = (3 * blastR) ** 2;
  for (let n = 0; n < w.solidCount; n++) {
    const i = w.solids[n];
    if (!w.mat[i] || w.vesselTag[i]) continue;
    const [x, y, z] = w.coords(i);
    if (y === 0) continue;
    const p = w.center(x, y, z);
    const d2 = (p[0] - center[0]) ** 2 + (p[1] - center[1]) ** 2 + (p[2] - center[2]) ** 2;
    const M = MATERIALS[w.mat[i]];
    if (M.shatterTemp !== Infinity && d2 < glassR2) w.flags[i] |= F_FALLING;
    if (d2 > r2 || w.flags[i] & F_ANCHOR) continue;
    const mv = M.density * w.dens[i] * V;
    const d = Math.sqrt(d2);
    const speed = v0 * 0.5 * (1 - d / blastR) ** 2 * Math.min(1, Math.sqrt(2 / Math.max(mv, 1e-3)));
    if (speed > 3) launch(i, speed);
  }
  w.structureDirty = true;
  w.listDirty = true;
  w.events.push({ type: 'explosion', pos: center, time: w.time, energy: E, radius: blastR, name: v.name, pressure: gauge, bleve: true, fireball: v.fireball?.diameter });
  emitSound(w, { pos: center, loudness_dB: LOUDNESS.explosion, kind: 'explosion' });
  sim.ai?.blast?.(center, blastR);
  sim.dragonAI?.blast?.(center, blastR);
  sim.phoenixAI?.blast?.(center, blastR);
  sim.heliAI?.blast?.(center, blastR);
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
  // with rigid bodies: the shell's voxels torn into a few pieces (by sector round the middle),
  // each a hull body of its voxels' mass; without, every shell voxel flies on its own
  sim.rigid?.explosion(center, E, blastR * 1.5);
  blastVehicles(sim.world, center, E, blastR * 1.5); // (the vehicles' bodies: physics/vehicleCore.js)
  if (sim.rigid && a.shell.length >= 2) v.fragmentBodies = shellFragments(sim, a.shell, center, v0);
  else for (const i of a.shell) launch(i, v0 * (0.5 + sim.rand() * 0.7));
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

/**
 * A fragment hits something: its kinetic energy ½mv² breaks glass, cracks
 * brittle material and knocks ceiling tiles / boards down; a burning piece
 * starts a spot fire where it lands. Loud impacts are heard by enemies.
 */
function impact(sim, d, x, y, z, M) {
  const w = sim.world;
  const m = M.density * d.dens * w.h ** 3;
  const E = 0.5 * m * (d.v[0] ** 2 + d.v[1] ** 2 + d.v[2] ** 2);
  d.impactE = E;
  let hitName = 'soil';
  if (y >= 0 && y < w.ny && x >= 0 && z >= 0 && x < w.nx && z < w.nz) {
    const j = w.idx(x, y, z);
    const T = MATERIALS[w.mat[j]];
    if (w.mat[j]) hitName = T.name;
    if (w.mat[j] && !(w.flags[j] & F_ANCHOR)) {
      if (T.shatterTemp !== Infinity && E > 5) {
        w.flags[j] |= F_FALLING;
        sim.glassNoise?.(j);
      } else if ((T.brittle || T.wetFail !== Infinity) && E > 20) {
        w.crack[j] += E / 400;
        if (w.crack[j] >= 1) w.flags[j] |= F_FALLING;
      }
      w.structureDirty = true;
    }
  }
  if (d.flags & F_BURNING && M.combustible) sim.ignite(d.p, w.h * 1.2);
  if (E > 50 && !d.silent) {
    w.noises.push({ p: d.p.slice(), loud: Math.min(40, 5 + Math.sqrt(E) * 0.5), time: w.time, kind: 'impact' });
    // (its sound: the fragment's material on what it hit, from its mass and speed: audio/physics.js)
    if (E > 300) w.events.push({ type: 'impact', pos: d.p.slice(), time: w.time, energy: E, name: M.label, materials: [M.name, hitName], mass: m, speed: Math.hypot(d.v[0], d.v[1], d.v[2]), size: 1, sizeA: w.h, radius: w.h * 0.3, kind: 'debris' });
  }
}

/**
 * A burst cylinder's shell as rigid fragments (sim.rigid.launchFragment: hull bodies with
 * continuous collision). The steel (mShell) tears as cylinders do in a BLEVE: the two ends come
 * off and the side splits lengthwise into strips (two, three at higher pressure), each a curved
 * plate of the wall's thickness with its share of the steel. The kinetic energy given to the
 * fragments (eKin: a share of the burst energy, Baker / Brode partition) is shared out by mass
 * (the same speed each, ±30 %); the strips fly out sideways, the bottom into the ground, the
 * valve end up along the axis, and with `carried` kg of liquid still in it flashing out of its
 * open end it rockets: thrust = carried · u / 0.5 s, u = √(2Δp/ρ) (the two-phase jet). Each piece
 * is as hot as the wall it was (the dry wall above the liquid, the wetted wall below).
 * → the bodies.
 */
function cylinderFragments(sim, { center, radius: r, height: H, wall: t, mShell, eKin, gauge, Tdry, Twet, level, fluid, carried = 0, valve = true }) {
  const R = sim.rigid;
  const rnd = () => sim.rand();
  const Aside = 2 * Math.PI * r * H;
  const Aend = Math.PI * r * r;
  const A = Aside + 2 * Aend;
  const pieces = [];
  // the side: strips torn lengthwise
  const nb = gauge > 25e5 ? 3 : 2;
  const th0 = rnd() * Math.PI * 2;
  for (let j = 0; j < nb; j++) {
    const arc = (Math.PI * 2) / nb;
    const a0 = th0 + j * arc;
    const pts = [];
    for (let s = 0; s <= 4; s++) {
      const th = a0 + (arc * s) / 4;
      for (const y of [-H / 2, H / 2]) for (const rr of [r, r - t]) pts.push([rr * Math.cos(th), y, rr * Math.sin(th)]);
    }
    const tc = a0 + arc / 2;
    pieces.push({ pts, mass: (mShell * Aside) / A / nb, dir: [Math.cos(tc), 0.3 + 0.3 * rnd(), Math.sin(tc)], temp: Twet * level + Tdry * (1 - level), name: 'shell', area: (Aside / nb) * 2 });
  }
  // the ends: dished discs (the top with the valve and its collar)
  const end = (sgn, extra) => {
    const pts = [];
    for (let s = 0; s < 10; s++) {
      const th = (s / 10) * Math.PI * 2;
      pts.push([r * Math.cos(th), 0, r * Math.sin(th)], [r * Math.cos(th), -sgn * t, r * Math.sin(th)]);
    }
    pts.push([0, sgn * 0.22 * r, 0], [0, sgn * (0.22 * r - t), 0]);
    for (const q of extra) pts.push(q);
    return pts.map((q) => [q[0], q[1] + sgn * H * 0.5, q[2]]);
  };
  const collar = valve ? [[0.05, 0.22 * r + 0.07, 0], [-0.05, 0.22 * r + 0.07, 0], [0, 0.22 * r + 0.07, 0.05], [0, 0.22 * r + 0.07, -0.05]] : [];
  const hx = rnd() - 0.5, hz = rnd() - 0.5;
  pieces.push({ pts: end(-1, []), mass: ((mShell * Aend) / A) * 1.3, dir: [hx, -0.5, hz], temp: Twet, name: 'bottom', area: Aend * 2 });
  const top = { pts: end(1, collar), mass: (mShell * Aend) / A + (valve ? 0.6 : 0), dir: [(rnd() - 0.5) * 0.4, 1, (rnd() - 0.5) * 0.4], temp: Tdry, name: valve ? 'valve end' : 'top', area: Aend * 2, top: true };
  pieces.push(top);
  // the speeds: eKin shared out by mass
  const M = pieces.reduce((s, p) => s + p.mass, 0);
  const vBase = Math.min(45, Math.sqrt((2 * eKin) / Math.max(0.5, M)));
  const rhoL = fluid?.vapor ? liquidDensity(fluid, 20) : 500;
  const u = Math.max(20, Math.min(120, Math.sqrt((2 * Math.max(0, gauge)) / rhoL)));
  const bodies = [];
  for (const P of pieces) {
    const c = [0, 0, 0];
    for (const q of P.pts) for (let a = 0; a < 3; a++) c[a] += q[a] / P.pts.length;
    const pts = P.pts.map((q) => [q[0] - c[0], q[1] - c[1], q[2] - c[2]]);
    const l = Math.hypot(...P.dir) || 1;
    const sp = vBase * (0.7 + 0.6 * rnd()) * (P.top ? 1.15 : 1);
    const v = P.dir.map((x) => (x / l) * sp + (rnd() - 0.5) * 0.15 * sp);
    const av = P.top ? [(rnd() - 0.5) * 2, 15 + 10 * rnd(), (rnd() - 0.5) * 2] : [(rnd() - 0.5) * 25, (rnd() - 0.5) * 25, (rnd() - 0.5) * 25];
    const thrust = P.top && carried > 0 ? { force: (carried * u) / 0.5, time: 0.5, axis: [0, 1, 0] } : null;
    bodies.push(R.launchFragment({ p: [center[0] + c[0], center[1] + c[1], center[2] + c[2]], v, av, points: pts, mass: P.mass, material: 'steel', temp: P.temp, area: P.area, thrust, life: 600, name: P.name }));
  }
  return bodies;
}

/**
 * A ruptured vessel's own shell voxels torn into a few pieces (by sector round its middle), each
 * a rigid hull of its voxels with their mass, thrown out from the middle at about v0. → the bodies.
 */
function shellFragments(sim, shell, center, v0) {
  const w = sim.world;
  const h = w.h;
  const V = h ** 3;
  const nb = Math.max(2, Math.min(6, Math.round(shell.length / 25)));
  const th0 = sim.rand() * Math.PI * 2;
  const groups = Array.from({ length: nb }, () => []);
  for (const i of shell) {
    const p = w.center(...w.coords(i));
    let th = Math.atan2(p[2] - center[2], p[0] - center[0]) - th0;
    th = ((th % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    groups[Math.min(nb - 1, Math.floor((th / (Math.PI * 2)) * nb))].push(i);
  }
  const bodies = [];
  for (const g of groups) {
    if (!g.length) continue;
    let M = 0;
    let T = 0;
    const c = [0, 0, 0];
    const cs = g.map((i) => w.center(...w.coords(i)));
    const counts = new Map();
    g.forEach((i, k) => {
      const m = MATERIALS[w.mat[i]].density * w.dens[i] * V;
      M += m;
      T += Math.max(w.temp[i], w.skin[i]) * m;
      for (let a = 0; a < 3; a++) c[a] += cs[k][a] * m;
      counts.set(w.mat[i], (counts.get(w.mat[i]) ?? 0) + 1);
    });
    for (let a = 0; a < 3; a++) c[a] /= M;
    const mat = [...counts].sort((x, y) => y[1] - x[1])[0][0];
    const pts = [];
    const step = Math.max(1, Math.floor(g.length / 30));
    for (let k = 0; k < g.length; k += step)
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) pts.push([cs[k][0] - c[0] + (dx * h) / 2, cs[k][1] - c[1] + (dy * h) / 2, cs[k][2] - c[2] + (dz * h) / 2]);
    for (const i of g) {
      w.pieceOf?.delete(i);
      w.clearVoxel(i);
    }
    let dx = c[0] - center[0];
    let dy = c[1] - center[1] + 0.3 * Math.hypot(c[0] - center[0], c[2] - center[2]) + 0.05;
    let dz = c[2] - center[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    dx = dx / l + (sim.rand() - 0.5) * 0.3;
    dy = Math.abs(dy / l) + 0.2;
    dz = dz / l + (sim.rand() - 0.5) * 0.3;
    const l2 = Math.hypot(dx, dy, dz);
    const sp = v0 * (0.5 + sim.rand() * 0.7);
    bodies.push(sim.rigid.launchFragment({ p: c, v: [(dx / l2) * sp, (dy / l2) * sp, (dz / l2) * sp], points: pts, mass: M, material: MATERIALS[mat].name, temp: T / M, life: 600, name: 'shell' }));
  }
  return bodies;
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
    tmax: w.tmax[i],
    flags: w.flags[i] & ~F_FALLING & ~64, // (no longer hidden: debris is drawn as what it is)
    dens: w.dens[i],
    owner: w.owner[i],
    tint: [w.tint[i * 3], w.tint[i * 3 + 1], w.tint[i * 3 + 2]],
    age: 0,
    // where it came from (through earlier landings), and whether a mesh draws it (a statue)
    origin: w.pieceOf?.get(i) ?? i,
    meshPiece: !!(w.flags[i] & 64) || w.pieceOf?.has(i),
  });
  w.pieceOf?.delete(i);
  w.clearVoxel(i);
}

/** Ballistic flight with air drag; fragments land back in the grid, still hot or burning. */
const AIR = [0, 0, 0];
export function stepDebris(sim, dt) {
  const w = sim.world;
  if (!w.debris.length) return;
  const h = w.h;
  const keep = [];
  for (const d of w.debris) {
    d.age += dt;
    const M = MATERIALS[d.mat];
    // quadratic drag of a voxel-sized fragment: light panels slow down fast
    const k = d.flake ? 6 : Math.min(3, 0.6 / (M.density * d.dens * h));
    const sp = Math.hypot(...d.v);
    const steps = Math.min(30, Math.max(1, Math.ceil((sp * dt) / (0.5 * h))));
    const sdt = dt / steps;
    let landed = false;
    let gone = false;
    // (the drag is against the air: a wind hose or a jet carries the fragments with it, sim/stirrers.js)
    let stir = w.stirrers.length ? airStirAt(w, d.p, AIR) : null;
    // a hull breach (sim/breach.js): the air streaming out to a hole in space, the sea's jet
    // coming in; in space itself nothing (no air to drag, no gravity outside the ship's own)
    let rho = 1.2;
    let space = false;
    if (w.vacuum || w.sea?.ship) {
      const u = [0, 0, 0];
      rho = breachFlowAt(sim, d.p, u);
      if (u[0] || u[1] || u[2]) stir = stir ? [stir[0] + u[0], stir[1] + u[1], stir[2] + u[2]] : u;
      space = !!w.vacuum && !inHull(w, d.p);
    }
    const kk = (k * rho) / 1.2;
    for (let s = 0; s < steps && !landed && !gone; s++) {
      if (w.vacuum && s > 0) space = !inHull(w, d.p);
      const rv = stir ? [d.v[0] - stir[0], d.v[1] - stir[1], d.v[2] - stir[2]] : d.v.slice();
      const spd = Math.hypot(...rv);
      const f = Math.min(1, kk * spd * sdt); // (in the sea's jet: it takes the water's speed at once)
      for (let c = 0; c < 3; c++) d.v[c] -= f * rv[c];
      if (!space) d.v[1] -= 9.81 * sdt;
      const prev = d.p.slice();
      for (let c = 0; c < 3; c++) d.p[c] += d.v[c] * sdt;
      const x = Math.floor(d.p[0] / h);
      const y = Math.floor(d.p[1] / h);
      const z = Math.floor(d.p[2] / h);
      if (space && (x < 0 || y < 1 || z < 0 || x >= w.nx || y >= w.ny || z >= w.nz)) {
        // drifting off into space: kept (drawn) until it is far away
        if (Math.hypot(d.p[0] - w.size[0] / 2, d.p[1] - w.size[1] / 2, d.p[2] - w.size[2] / 2) > 600) gone = true;
        continue;
      }
      if (x < 0 || z < 0 || x >= w.nx || z >= w.nz || y >= w.ny + 20) {
        gone = true; // left the simulated area
        break;
      }
      if (y >= w.ny) continue;
      // at sea, what reaches the floor of the scene below the surface has sunk into deep water
      // (set down there it would have nothing under it and fall, and land, again and again)
      if (y < 1 && w.sea && d.p[1] < w.sea.level) {
        gone = true;
        break;
      }
      if (y < 1 || w.mat[w.idx(x, y, z)]) {
        landed = true;
        if (d.flake) break; // paint flakes just settle, they do not become voxels
        impact(sim, d, x, y, z, M);
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
        w.flameAcc[a] += q * (sim.airShare ?? 1);
        w.airQ[a] += q * 0.5 * (sim.airShare ?? 1);
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
  w.tmax[j] = d.tmax ?? 0;
  w.flags[j] = d.flags;
  w.tint[j * 3] = d.tint[0];
  w.tint[j * 3 + 1] = d.tint[1];
  w.tint[j * 3 + 2] = d.tint[2];
  // a piece of something drawn by a mesh: it lies there as that piece (still hidden as a voxel)
  if (d.meshPiece) {
    (w.pieceOf ??= new Map()).set(j, d.origin);
    w.flags[j] |= 64;
  }
}
