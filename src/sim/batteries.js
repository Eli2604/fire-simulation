import { MATERIALS, MAT } from './materials.js';
import { F_BURNING, O2_AIR } from './world.js';

/**
 * Lithium-ion battery packs (an electric car's floor pack, a hybrid's small one: models/car.js;
 * the material 'liion': sim/materials.js). Their voxels are cells (a voxel: a stretch of a module,
 * hundreds of cells) and they do not burn as a fuel does: they go into thermal runaway.
 *
 *  - A cell holds its charge as chemical energy: runaway.energy J per m³ of cells (~250 Wh/l),
 *    × the voxel's density factor (the share of it that is cells: models/car.js sizes the pack's
 *    density so the voxels hold its kWh). w.fuel of a cell voxel is what of it has not gone yet:
 *    1 fresh, 0 spent; between (< FRESH) it is in runaway.
 *  - Onset: a fresh cell goes when it is hotter than ~170 °C (the separator melts, the electrolyte
 *    and the cathode react), sooner the more it is damaged (w.crack: a round through it, crushed in
 *    a crash, the heat it has already had): onset = 170 − 300 × crack. A cell shot through or
 *    crushed (crack ≥ ~0.5) shorts inside: it goes at once.
 *  - Runaway: once going a cell finishes, whatever is done to it (water on it, no air round it:
 *    the cathode gives the oxygen), in ~TAU s. Its heat (internal × its charge) goes into it (it
 *    glows at ~600-900 °C) and a share (SPREAD) straight into the fresh cells beside it (through the
 *    can walls, the hot gas in the module); the pack conducts between its voxels (GPACK), and the
 *    cells of a fresh voxel against a hot one that has gone are damaged through that face (the front
 *    crossing into it: K_FACE): cell-to-cell propagation through the pack, a minute or a few per
 *    voxel, a car's pack in ten minutes or more (unless the cells are kept cold).
 *  - Venting: each cell vents a jet of flammable gas (~0.4 g per Wh: electrolyte vapour, H2, CO,
 *    CH4) and toxic HF (~90 mg per Wh): out of the pack's nearest open face, a jet flame some cells
 *    long where there is oxygen (vent × its charge of heat, a hot radiating flame: sim/air.js's
 *    flames); where there is none it goes as unburnt gas into the smoke, whitish-grey and thick
 *    (the air's smoke: what you breathe: walk/walk.js). w.batteryGas keeps the HF and the gas let
 *    out (kg).
 *  - Water: the pack is sealed (IP67) and under the floor: of the water on it only waterReach (8 %)
 *    reaches the cells (sim/simulation.js douse and the water pass take it so). It cools the cells
 *    it reaches, slows the spread where it keeps them under the onset, but a cell going does not
 *    stop: a pack fire takes thousands of litres and a long time.
 *  - Re-ignition: a fresh cell heated over 90 °C is damaged (crack up to 0.3) and a damaged cell
 *    heats itself (a slow internal short, faster as it gets hotter: SELF × crack × e^((T−20)/60)
 *    °C/s): cooled down after the fire it can go again hours later.
 *  - Damage: cellsShot (a round's way through a car: sim/wounds.js shoot), crushCells (a crash:
 *    sim/cars.js).
 *
 *   stepBatteries(sim, dt)        the thermo step (sim/simulation.js), after the vessels
 *   cellsOf(w)                    the world's cell voxels (cached)
 *   packState(w, owner?)          { n, fresh, active, spent, maxT, energy (J left), hf }
 *   cellsShot(sim, p, dir, len)   a round going on through thin sheet: the cells on its way
 *   crushCells(w, p, r, sev)      cells within r of p damaged by sev (0..1+)
 */

const LI = MAT.liion;
const SPEC = MATERIALS[LI].runaway;
/** Under this a cell is fresh (w.fuel 1 at build). */
export const FRESH = 0.999;
/** A voxel of cells runs through in TAU s (at h = 0.2 m; a smaller voxel is fewer cells: quicker). */
export const TAU = 60;
/** Share of a cell's runaway heat that goes straight into the fresh cells beside it. */
export const SPREAD = 0.4;
/** Conductance (W/K) between two cell voxels of 0.15 m through the pack's structure. */
export const GPACK = 2;
/** A fresh voxel against a gone one hotter than T_FACE (°C) is damaged at K_FACE per K·s (at h = 0.2 m): the runaway front crossing into it. */
export const T_FACE = 150, K_FACE = 6e-6;
/** Self-heating of a damaged cell (°C/s per unit crack at 20 °C). */
export const SELF = 0.012;
/** Hottest a cell gets (°C): what is more goes into the gas round it. */
const TCELL_MAX = 900;
/** kg of vent gas, of it HF, per Wh of charge; smoke per kg of gas. */
export const GAS_PER_WH = 0.4e-3, HF_PER_WH = 90e-6;
const SMOKE_PER_GAS = 0.25;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** The world's cell voxels (rescanned when its voxels changed). */
export function cellsOf(w) {
  if (w.noCells) return [];
  const C = (w._cells ??= { ver: -1, list: [] });
  if (C.ver === w.geomVersion) return C.list;
  if (w.listDirty) w.rebuildLists();
  const list = [];
  for (let k = 0; k < w.solidCount; k++) {
    const i = w.solids[k];
    if (w.mat[i] === LI) list.push(i);
  }
  C.ver = w.geomVersion;
  C.list = list;
  // (a world built without a pack never gets one: not looked for again)
  if (!list.length && !C.had) w.noCells = true;
  if (list.length) C.had = true;
  return list;
}

/** Onset temperature (°C) of a cell damaged by crack. */
export const onsetOf = (crack) => SPEC.onset - 300 * crack;

/** The stored energy (J of charge) of cell voxel i, all of it fresh. */
export function cellCharge(w, i) {
  return SPEC.energy * w.h ** 3 * w.dens[i];
}

/** Step the packs by dt (s): onset, runaway, spread, venting, self-heating. */
export function stepBatteries(sim, dt) {
  const w = sim.world;
  const cells = cellsOf(w);
  if (!cells.length) return;
  const { nx, ny, nz, h, mat, temp, skin, fuel, crack, flags, dens, char } = w;
  const M = MATERIALS[LI];
  const V = h ** 3;
  const tau = clamp(TAU * (h / 0.2), 6, 60);
  const G = (w.batteryGas ??= { hf: 0, gas: 0, runaways: 0, active: 0, cells: 0 });
  const nb = [0, 0, 0, 0, 0, 0];
  let active = 0;
  // the heat through the pack: cell to cell (their cans, the cooling plates and busbars between
  // them: GPACK W/K per face of a 0.15 m voxel), on top of what the solids pass between them
  const Gc = GPACK * (h / 0.15);
  for (const i of cells) {
    if (mat[i] !== LI) continue;
    const x = i % nx, r = (i - x) / nx, y = r % ny, z = (r - y) / ny;
    const Ci = M.density * dens[i] * V * M.specificHeat;
    for (let d = 0; d < 3; d++) {
      const j = d === 0 ? (x < nx - 1 ? i + 1 : -1) : d === 1 ? (y < ny - 1 ? i + nx : -1) : z < nz - 1 ? i + nx * ny : -1;
      if (j < 0 || mat[j] !== LI) continue;
      const Cj = M.density * dens[j] * V * M.specificHeat;
      const dT = temp[i] - temp[j];
      // (no more than evens them out)
      const q = Math.sign(dT) * Math.min(Math.abs(dT) * Gc * dt, (Math.abs(dT) * Ci * Cj) / (Ci + Cj) * 0.5);
      temp[i] -= q / Ci;
      temp[j] += q / Cj;
      // the front: the cells of a fresh voxel against one that has gone (hot) are damaged through
      // their face (their separators melt) well before its mean temperature says so
      const fi = fuel[i] >= FRESH, fj = fuel[j] >= FRESH;
      if (fi !== fj) {
        const [cold, hot] = fi ? [i, j] : [j, i];
        if (temp[hot] > T_FACE) crack[cold] += (dt * K_FACE * (temp[hot] - T_FACE)) / (h / 0.2);
      }
    }
  }
  for (const i of cells) {
    if (mat[i] !== LI) continue;
    const C = M.density * dens[i] * V * M.specificHeat;
    let f = fuel[i], T = temp[i], cr = crack[i];
    if (f >= FRESH) {
      // heat damage (the SEI layer breaks down, the separator shrinks): it heats itself later
      if (T > 90 && cr < 0.3) cr = Math.min(0.3, cr + (dt * (T - 90)) / (110 * 900));
      // a damaged cell: a slow internal short, quicker as it gets hotter
      if (cr > 0.02) T += dt * SELF * cr * Math.exp(Math.min(6, (T - 20) / 60));
      if (T >= onsetOf(cr)) {
        f = 0.998;
        G.runaways++;
        const p = w.center(...w.coords(i));
        w.noises?.push({ p, loud: 30, time: w.time, kind: 'vent' });
        const own = w.owner[i];
        const seen = (w._runawayOwners ??= new Set());
        if (!seen.has(own)) {
          seen.add(own);
          w.events?.push({ type: 'runaway', pos: p, time: w.time, name: 'battery thermal runaway' });
          w.events?.push({ type: 'toxicGas', pos: p, time: w.time, name: 'battery vent gas (HF, CO)', gas: 'HF' });
        }
      }
    }
    if (f < FRESH && f > 0) {
      active++;
      flags[i] |= F_BURNING;
      const df = Math.min(f, dt / tau);
      f -= df;
      const Eel = SPEC.energy * V * dens[i] * df; // J of its charge gone
      const Qint = Eel * SPEC.internal;
      // the fresh cells beside it take their share
      let n = 0;
      const x = i % nx, r = (i - x) / nx, y = r % ny, z = (r - y) / ny;
      if (x > 0) nb[n++] = i - 1;
      if (x < nx - 1) nb[n++] = i + 1;
      if (y > 0) nb[n++] = i - nx;
      if (y < ny - 1) nb[n++] = i + nx;
      if (z > 0) nb[n++] = i - nx * ny;
      if (z < nz - 1) nb[n++] = i + nx * ny;
      let m = 0;
      for (let k = 0; k < n; k++) if (mat[nb[k]] === LI && fuel[nb[k]] >= FRESH) nb[m++] = nb[k];
      let own = Qint;
      if (m) {
        const share = (Qint * SPREAD) / m;
        for (let k = 0; k < m; k++) {
          const j = nb[k];
          const Cj = M.density * dens[j] * V * M.specificHeat;
          temp[j] += share / Cj;
          if (skin[j] < temp[j]) skin[j] = temp[j];
        }
        own -= Qint * SPREAD;
      }
      T += own / C;
      let spill = 0;
      if (T > TCELL_MAX) {
        spill = (T - TCELL_MAX) * C;
        T = TCELL_MAX;
      }
      vent(sim, i, x, y, z, Eel, spill, dt, G);
      if (f <= 1e-6) {
        f = 0;
        flags[i] &= ~F_BURNING;
        char[i] = 1;
      }
    } else if (f <= 0) flags[i] &= ~F_BURNING;
    fuel[i] = f;
    temp[i] = T;
    if (skin[i] < T) skin[i] = T;
    crack[i] = cr;
  }
  G.active = active;
  G.cells = cells.length;
}

/** The gas a cell lets out (its charge Eel gone this step): a jet out of the pack's nearest open face, burning where there is air. */
function vent(sim, i, x, y, z, Eel, spill, dt, G) {
  const w = sim.world;
  const { nx, ny, nz, mat } = w;
  // the nearest open face: out of the side or the bottom of the pack, else up
  let ox = x, oy = y, oz = z, dx = 0, dy = 1, dz = 0;
  for (let s = 1; s <= 4; s++) {
    let found = false;
    for (const [ax, ay, az] of DIRS) {
      const X = x + ax * s, Y = y + ay * s, Z = z + az * s;
      if (X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue;
      if (!mat[X + nx * (Y + ny * Z)]) {
        ox = X; oy = Y; oz = Z; dx = ax; dy = ay; dz = az;
        found = true;
        break;
      }
    }
    if (found) break;
  }
  const gas = (Eel / 3600) * GAS_PER_WH;
  G.gas += gas;
  G.hf += (Eel / 3600) * HF_PER_WH;
  const q = (Eel * SPEC.vent) / Math.max(dt, 1e-6); // W, if it all burns
  // the jet: along the face's way, then up (a flame ~0.5-1.5 m)
  const steps = 4;
  const sm = gas * SMOKE_PER_GAS;
  for (let k = 0; k < steps; k++) {
    // (out of the face two voxels at a time, then rising: the air's cells are two voxels)
    const o = 2 * Math.min(k, 1);
    const X = clamp(ox + dx * o, 0, nx - 1), Y = clamp(oy + Math.max(0, dy) * o + 2 * Math.max(0, k - 1), 0, ny - 1), Z = clamp(oz + dz * o, 0, nz - 1);
    const a = w.airIndexOfVoxel(X, Y, Z);
    const o2 = w.o2?.[a] ?? O2_AIR;
    const ox2 = clamp((o2 / O2_AIR - 0.55) / 0.45, 0, 1); // (flames weaken below fresh air, out below ~12 % O2)
    const burn = (q / steps) * ox2;
    w.airQ[a] += burn * 0.55 + (k === 0 ? spill / Math.max(dt, 1e-6) : 0);
    w.radSrc[a] += burn * 0.3;
    w.flameAcc[a] += burn;
    if (burn > 0) sim.consumeO2?.(a, burn, dt);
    if (sim.stats) sim.stats.ventHrr = (sim.stats.ventHrr ?? 0) + burn;
    // the smoke: soot where it burns, the thick whitish unburnt vapour where it does not
    const s = (sm / steps) * (1 + 2 * (1 - ox2));
    w.smoke[a] += s;
    const c = 0.25 + 0.4 * (1 - ox2);
    w.smokeR[a] += s * c;
    w.smokeG[a] += s * c;
    w.smokeB[a] += s * (c + 0.03);
  }
}
const DIRS = [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]];

/** The packs' state (one owner's, or every cell): { n, fresh, active, spent, maxT, energy (J left), hf (kg let out, all packs) }. */
export function packState(w, owner = null) {
  let n = 0, fresh = 0, active = 0, spent = 0, maxT = -Infinity, energy = 0;
  for (const i of cellsOf(w)) {
    if (w.mat[i] !== LI || (owner != null && w.owner[i] !== owner)) continue;
    n++;
    const f = w.fuel[i];
    if (f >= FRESH) fresh++;
    else if (f > 0) active++;
    else spent++;
    if (w.temp[i] > maxT) maxT = w.temp[i];
    energy += cellCharge(w, i) * f;
  }
  return { n, fresh, active, spent, maxT, energy, hf: w.batteryGas?.hf ?? 0, gas: w.batteryGas?.gas ?? 0 };
}

/**
 * A round that went into a wall at p along dir: through thin sheet (a car's skin, its floor: the
 * density factor under 0.2) it goes on, ≤ len m; the cells on its way are holed (crack: they short
 * inside and go into runaway). Stops in anything thick. Returns how many cells it holed.
 */
export function cellsShot(sim, p, dir, len = 1.2) {
  const w = sim.world;
  if (w.noCells) return 0;
  const l = Math.hypot(...dir) || 1;
  const d = dir.map((v) => v / l);
  const step = w.h * 0.3;
  let last = -1, hit = 0;
  for (let t = 0; t < len; t += step) {
    const i = w.voxelAt(p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t);
    if (i < 0) break;
    if (i === last || !w.mat[i]) continue;
    last = i;
    if (w.mat[i] === LI) {
      w.crack[i] += hit ? 0.35 : 0.7;
      if (++hit >= 2) break;
      continue;
    }
    if (w.dens[i] > 0.2 && MATERIALS[w.mat[i]].fluidity < 0.95) break;
  }
  return hit;
}

/** A crash or a crush at p: the cells within r damaged by sev × (1 − d / r). Returns how many. */
export function crushCells(w, p, r, sev) {
  if (w.noCells || sev <= 0 || r <= 0) return 0;
  let n = 0;
  for (const i of cellsOf(w)) {
    if (w.mat[i] !== LI) continue;
    const c = w.center(...w.coords(i));
    const d = Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]);
    if (d >= r) continue;
    w.crack[i] += sev * (1 - d / r);
    n++;
  }
  return n;
}
