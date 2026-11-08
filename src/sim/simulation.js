import { MATERIALS, TBL } from './materials.js';
import { F_LIQUID, F_FALLING, F_ANCHOR, F_BURNING, F_SMOLDER } from './world.js';
import { deriveWeather } from './weather.js';
import { stepVessels, stepDebris } from './vessels.js';
import { stepAir, blurRadiation, radiationGain, FLAME_TEMP } from './air.js';

const SIGMA = 5.670374e-8; // Stefan–Boltzmann
const LV = 2.26e6; // latent heat of vaporisation of water, J/kg
const CW = 4186; // specific heat of water, J/(kg·K)
const RAD_FRACTION = 0.3; // share of combustion heat leaving as radiation
const MAX_TEMP = 3000;
const SKIN_DEPTH = 0.004; // m, thickness of the surface layer of bulk materials
const LIQUID_MIXING = 10; // effective conductivity boost for convecting melts
const POOL_FEEDBACK = 0.2; // share of a candle flame heating its melt pool
const CONTACT_SHARE = 0.5; // max share of the total heat release reaching surfaces by flame contact
const W_CRIT = 0.004; // kg/(m²·s): water application rate that quenches a flaming surface (fire research: ~2–6 g/m²·s)

/** Hand-held extinguishers (typical 6–9 kg/l units). rate kg/s, range m (nozzle to target). */
export const AGENTS = {
  water: { label: "Water (9 l)", capacity: 9, rate: 0.45, range: 6, radius: 0.5 },
  foam: { label: "Foam AFFF (9 l)", capacity: 9, rate: 0.45, range: 5, radius: 0.6 },
  co2: { label: "CO2 (5 kg)", capacity: 5, rate: 0.5, range: 2.5, radius: 0.6 },
  powder: { label: "Dry powder ABC (6 kg)", capacity: 6, rate: 0.5, range: 4, radius: 0.7 },
};

/**
 * Advances a World in time. All physics lives here and in air.js; the
 * renderer only reads the World's arrays.
 *
 * Per step:
 *  1. heaters (burners, torches) inject heat into the air
 *  2. solid pass A: conduction between touching voxels, convection to the air
 *     cell in front of every exposed face, radiation emission/absorption
 *  3. solid pass B: temperature update, rain wetting, drying/boiling of
 *     moisture (steam), melting/solidifying, pyrolysis smoke, ignition,
 *     burning (heat, flames, smoke), burn-out to char/ash, glass breaking
 *  4. air: implicit heat exchange with solids, buoyancy + wind velocity field,
 *     semi-Lagrangian advection of heat/smoke/steam, mixing, weather decay
 *  5. structure: liquids flow, ash piles, unsupported parts fall
 */
export class Simulation {
  constructor(world, weather) {
    this.world = world;
    this.weather = weather;
    this.radScale = 1;
    this.contactScale = 1;
    this.lastStructureCheck = -1e9;
    this.seed = 12345;
    this.dt = this.computeDt();
    this.radGain = radiationGain(world);
    this.stats = { hrr: 0, burning: 0, maxT: world.ambient, smoke: 0, steam: 0, liquid: 0, falling: 0, steps: 0 };
    this.burnouts = [];
    this.movers = [];
    if (world.listDirty) world.rebuildLists();
  }

  rand() {
    // xorshift32, deterministic for tests
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 4294967296;
  }

  /** Stable explicit time step for the materials and resolution in use. */
  computeDt() {
    // The solid update is linearised-implicit (unconditionally stable), so the
    // step is limited by the air: keep the semi-Lagrangian backtrace within
    // ~3 cells for a 3 m/s plume, and never above 0.2 s.
    return Math.min(0.2, this.world.ah);
  }

  /** Run as many steps as needed to advance `simSeconds`, within a wall-clock budget. */
  advance(simSeconds, budgetMs = 25) {
    const t0 = performance.now();
    let done = 0;
    while (done + 1e-9 < simSeconds) {
      const dt = Math.min(this.dt, simSeconds - done);
      this.step(dt);
      done += dt;
      if (performance.now() - t0 > budgetMs) break;
    }
    return done;
  }

  step(dt) {
    const w = this.world;
    if (w.listDirty) w.rebuildLists();
    const W = this.weather;
    const D = deriveWeather(W);
    w.ambient = W.ambient;
    w.airG.fill(0);
    w.airGT.fill(0);
    w.airQ.fill(0);
    w.radSrc.fill(0);
    w.flameAcc.fill(0);

    this.stats.ventHrr = 0;

    this.applyHeaters(dt);
    this.applyWater(dt, D);
    stepVessels(this, dt);
    this.solidPassA(dt, D);
    this.solidPassB(dt, D);
    stepAir(w, W, D, dt, this);
    blurRadiation(w, this.radGain);
    this.structure(dt);
    stepDebris(this, dt);
    // jet flames from vents and fireballs count as heat release too
    let extra = this.stats.ventHrr;
    for (const ht of w.heaters) if (ht.fireball) extra += ht.power;
    this.stats.hrr += extra;
    w.time += dt;
    this.stats.steps++;
  }

  /**
   * Water and extinguishing agents arriving this step.
   * Rain falls down every column: each surface it meets intercepts part of it
   * (porous fuels and thin parts let some drip through to what is below), and
   * the drops falling through hot gas partly evaporate (cooling the plume and
   * damping the flames, making steam).
   */
  applyWater(dt, D) {
    const w = this.world;
    const { waterIn, waterList, mat, dens, colTop, nx, ny, nz, h } = w;
    for (const i of waterList) waterIn[i] = 0;
    waterList.length = 0;
    if (D.rainRate > 0) {
      const per = D.rainRate * h * h * dt;
      for (let z = 0; z < nz; z++)
        for (let x = 0; x < nx; x++) {
          const top = colTop[x + nx * z];
          if (top < 0) continue;
          let water = per;
          for (let y = top; y >= 0 && water > per * 0.03; y--) {
            const i = x + nx * (y + ny * z);
            const m = mat[i];
            if (!m) continue;
            const M = MATERIALS[m];
            const intercept = y === 0 ? 1 : M.burnTime > 0 ? 0.45 : dens[i] < 0.2 ? 0.7 : 0.9;
            const take = water * intercept;
            this.addWater(i, take);
            water -= take;
          }
        }
      const { anx, any, anz, ah, airT, airQ, steam, fgas, occ } = w;
      const perCell = D.rainRate * ah * ah * dt;
      for (let az = 0; az < anz; az++)
        for (let ax = 0; ax < anx; ax++) {
          let m = perCell;
          for (let ay = any - 1; ay >= 0; ay--) {
            const a = ax + anx * (ay + any * az);
            if (occ[a] > 0.6) break; // under a roof
            this.coolGas(a, m * Math.min(0.5, (airT[a] - 100) / 1500), dt, airT, airQ, steam, fgas);
          }
        }
    }
    if (this.spray) this.applySpray(dt);
  }

  addWater(i, m) {
    const w = this.world;
    if (!w.waterIn[i]) w.waterList.push(i);
    w.waterIn[i] += m;
  }

  /** Evaporate water mass m (kg) in air cell a if it is hot: cooling, steam, weaker flames. */
  coolGas(a, m, dt, airT, airQ, steam, fgas) {
    if (m <= 0 || airT[a] <= 100) return;
    const E = m * (LV + CW * 80);
    airQ[a] -= E / dt;
    steam[a] += m;
    fgas[a] = Math.max(0, fgas[a] - E * 0.5);
  }

  /**
   * A hand-held extinguisher: `spray` = { agent, nozzle, target, radius, tank: { remaining } }.
   * Mechanisms per agent:
   *  water   cools (boiling off), wets, and quenches above the critical application rate
   *  foam    mostly water (cooling) + a blanket that smothers and insulates surfaces
   *  co2     displaces oxygen in the gas around the fire (inerting), slight cooling
   *  powder  interrupts the flame chemistry in the gas (very effective per kg) and
   *          leaves a thin smothering layer on surfaces
   */
  applySpray(dt) {
    const w = this.world;
    const s = this.spray;
    const ag = AGENTS[s.agent];
    const m = Math.min(ag.rate * dt, s.tank.remaining);
    if (m <= 0) return;
    s.tank.remaining -= m;
    const { airT, airQ, steam, fgas, supp, smoke, smokeR, smokeG, smokeB, ah, h } = w;
    const A = h * h;

    // along the jet: water droplets cross the hot gas above the fire
    const [nx0, ny0, nz0] = s.nozzle;
    const [tx, ty, tz] = s.target;
    if (s.agent === 'water' || s.agent === 'foam') {
      for (let k = 1; k <= 12; k++) {
        const t = k / 12;
        const a = this.airCellAt(nx0 + (tx - nx0) * t, ny0 + (ty - ny0) * t, nz0 + (tz - nz0) * t);
        if (a >= 0) this.coolGas(a, (m * 0.25 * Math.min(0.5, (airT[a] - 100) / 1500)) / 12, dt, airT, airQ, steam, fgas);
      }
    }

    // where it lands
    const r = Math.max(s.radius, h);
    if (s.agent === 'water' || s.agent === 'foam') {
      const hits = [];
      this.forSphere(s.target, r, (i) => {
        if (w.expo[i] > 0) hits.push(i);
      });
      if (!hits.length) return;
      const share = (m * 0.85) / hits.length;
      for (const i of hits) {
        this.addWater(i, s.agent === 'foam' ? share * 0.7 : share);
        // foam: expanded ~8x, 1 = a ~2 cm blanket
        if (s.agent === 'foam') w.coat[i] = Math.min(1.5, w.coat[i] + (share * 0.4) / A);
      }
      return;
    }
    // gaseous / powder agents fill the air cells around the target
    const cells = [];
    const rr = r * 1.5;
    for (let az = Math.max(0, Math.floor((tz - rr) / ah)); az <= Math.min(w.anz - 1, Math.floor((tz + rr) / ah)); az++)
      for (let ay = Math.max(0, Math.floor((ty - rr) / ah)); ay <= Math.min(w.any - 1, Math.floor((ty + rr) / ah)); ay++)
        for (let ax = Math.max(0, Math.floor((tx - rr) / ah)); ax <= Math.min(w.anx - 1, Math.floor((tx + rr) / ah)); ax++) {
          const dx = (ax + 0.5) * ah - tx;
          const dy = (ay + 0.5) * ah - ty;
          const dz = (az + 0.5) * ah - tz;
          if (dx * dx + dy * dy + dz * dz <= rr * rr) cells.push(w.airIdx(ax, ay, az));
        }
    if (!cells.length) return;
    const airMass = 1.2 * ah ** 3;
    const per = m / cells.length;
    for (const a of cells) {
      if (s.agent === 'co2') {
        // design concentration ~35 % by volume ≈ 0.5 kg CO2 per kg of air
        supp[a] = Math.min(1.5, supp[a] + per / airMass / 0.5);
        airQ[a] -= (per * (843 * (airT[a] + 78) + 571e3)) / dt; // cold gas + sublimation
        steam[a] += per * 0.3; // the cold jet condenses moisture: a white cloud
      } else {
        // dry chemical: ~0.2 kg per kg of air near the flame is enough
        supp[a] = Math.min(1.5, supp[a] + (per * 0.7) / airMass / 0.2);
        const vis = per * 0.04; // visible powder cloud
        smoke[a] += vis;
        smokeR[a] += vis * 0.95;
        smokeG[a] += vis * 0.95;
        smokeB[a] += vis * 0.9;
      }
    }
    if (s.agent === 'powder') {
      const hits = [];
      this.forSphere(s.target, r, (i) => {
        if (w.expo[i] > 0) hits.push(i);
      });
      for (const i of hits) w.coat[i] = Math.min(1.2, w.coat[i] + (m * 0.3 * 0.3) / hits.length / A);
    }
  }

  airCellAt(px, py, pz) {
    const w = this.world;
    const ax = Math.floor(px / w.ah);
    const ay = Math.floor(py / w.ah);
    const az = Math.floor(pz / w.ah);
    if (ax < 0 || ay < 0 || az < 0 || ax >= w.anx || ay >= w.any || az >= w.anz) return -1;
    return w.airIdx(ax, ay, az);
  }

  applyHeaters(dt) {
    const w = this.world;
    const { anx, any, anz, ah } = w;
    w.heaters = w.heaters.filter((ht) => ht.until === undefined || ht.until > w.time);
    for (const ht of w.heaters) {
      if (!ht.on || ht.power <= 0) continue;
      const [px, py, pz] = ht.pos;
      const r = Math.max(ht.radius, ah * 0.5);
      const hgt = Math.max(ht.height, ah);
      const cells = [];
      const x0 = Math.max(0, Math.floor((px - r) / ah));
      const x1 = Math.min(anx - 1, Math.floor((px + r) / ah));
      const z0 = Math.max(0, Math.floor((pz - r) / ah));
      const z1 = Math.min(anz - 1, Math.floor((pz + r) / ah));
      const y0 = Math.max(0, Math.floor(py / ah));
      const y1 = Math.min(any - 1, Math.floor((py + hgt) / ah));
      for (let az = z0; az <= z1; az++)
        for (let ay = y0; ay <= y1; ay++)
          for (let ax = x0; ax <= x1; ax++) {
            const cx = (ax + 0.5) * ah - px;
            const cz = (az + 0.5) * ah - pz;
            // flame narrows with height
            const frac = ((ay + 0.5) * ah - py) / hgt;
            const rr = r * Math.max(0.35, 1 - 0.6 * frac) + ah * 0.5;
            const a = w.airIdx(ax, ay, az);
            // flames go around solid objects, not through them
            if (cx * cx + cz * cz <= rr * rr && w.occ[a] < 0.75) cells.push(a);
          }
      if (!cells.length) continue;
      let wsum = 0;
      for (const a of cells) wsum += 1 - w.occ[a];
      for (const a of cells) {
        const share = (ht.power * (1 - w.occ[a])) / wsum;
        w.airQ[a] += share * (1 - RAD_FRACTION);
        w.radSrc[a] += share * RAD_FRACTION;
        w.flameAcc[a] += share;
      }
    }
    void dt;
  }

  solidPassA(dt, D) {
    const w = this.world;
    const { nx, ny, nz, h, mat, temp, dE, expo, faceAir, anx, any, flags, dens } = w;
    const { airT, airG, airGT, radSrc, radField, flame, vx, vy, vz, waterIn, coat, supp, sfac } = w;
    const contactScale = this.contactScale;
    let contactDemand = 0;
    const A = h * h;
    const K = TBL.k;
    const SF = TBL.sf;
    const EPS = TBL.eps;
    const TambK = w.ambient + 273.15;
    const TambK4 = TambK * TambK * TambK * TambK;
    const solids = w.solids;
    const n = w.solidCount;
    const radScale = this.radScale;
    const windBoost = Math.sqrt(Math.hypot(D.windX, D.windZ));
    let radDemand = 0;
    let radEmit = 0;

    const { gsum, dEs, gext, skin } = w;
    for (let k = 0; k < n; k++) {
      const i = solids[k];
      dE[i] = 0;
      gsum[i] = 0;
    }
    const nxy = nx * ny;
    const sxy = anx * any;

    for (let k = 0; k < n; k++) {
      const i = solids[k];
      const m = mat[i];
      const Ti = temp[i]; // core: conduction with neighbouring voxels
      const Ts = skin[i]; // surface: exchange with gas and radiation
      const burningNow = flags[i] & F_BURNING; // its own flame feedback is in selfHeating
      // Suppression of combustion at this surface (1 = burns freely):
      //  water arriving faster than the critical application rate quenches it,
      //  a foam/powder blanket smothers it, CO2/powder in the gas starves the flame.
      let sf = 1;
      const wIn = waterIn[i];
      if (wIn > 0) sf *= Math.max(0, 1 - wIn / (A * dt * W_CRIT));
      const ct = coat[i];
      if (ct > 0) sf *= 1 - Math.min(1, ct);
      const sp0 = supp[faceAir[i]];
      if (sp0 > 0) sf *= Math.max(0, 1 - sp0);
      sfac[i] = sf;
      const shield = 1 - 0.85 * Math.min(1, ct); // a foam blanket insulates against heat
      const x = i % nx;
      const r = (i - x) / nx;
      const y = r % ny;
      const z = (r - y) / ny;
      const ki = (flags[i] & F_LIQUID ? K[m] * LIQUID_MIXING : K[m]) * dens[i]; // melts circulate; sheets conduct less
      const sfi = SF[m];
      const own = (x >> 1) + anx * ((y >> 1) + any * (z >> 1));
      let dEi = 0; // core energy change
      let gs = 0; // core conductances (implicit diagonal)
      let dEx = 0; // surface energy change
      let gx = 0; // surface conductances
      let ex = 0;
      let fa = -1;

      for (let d = 0; d < 6; d++) {
        // faces: +x, -x, +z, -z, -y, +y (+y last so flames prefer leaving upwards)
        let xn = x;
        let yn = y;
        let zn = z;
        let off;
        if (d === 0) { xn++; off = 1; }
        else if (d === 1) { xn--; off = -1; }
        else if (d === 2) { zn++; off = nxy; }
        else if (d === 3) { zn--; off = -nxy; }
        else if (d === 4) { yn--; off = -nx; }
        else { yn++; off = nx; }
        let a;
        if (xn < 0 || zn < 0 || xn >= nx || zn >= nz || yn >= ny) {
          a = own; // open domain boundary
        } else if (yn < 0) {
          continue; // insulating ground below the bottom layer
        } else {
          const j = i + off;
          const mj = mat[j];
          if (mj) {
            // conduction, each pair handled once (from the positive direction)
            if (d === 0 || d === 2 || d === 5) {
              const kj = (flags[j] & F_LIQUID ? K[mj] * LIQUID_MIXING : K[mj]) * dens[j];
              const G = ((2 * ki * kj) / (ki + kj)) * h;
              const q = G * (temp[j] - Ti) * dt;
              dEi += q;
              dE[j] -= q;
              gs += G;
              gsum[j] += G;
            }
            continue;
          }
          a = (xn >> 1) + anx * (yn >> 1) + sxy * (zn >> 1);
        }
        // convection with the gas in front of the face (flame contact included)
        const sp = Math.abs(vx[a]) + Math.abs(vy[a]) + Math.abs(vz[a]);
        const fl = flame[a];
        const g = (6 + 3.5 * Math.sqrt(sp) + windBoost + 100 * fl) * A * sfi;
        const Ta = airT[a];
        dEx += g * (Ta - Ts) * dt;
        gx += g;
        airG[a] += g;
        airGT[a] += g * Ts;
        // Flame contact: the gas touching the surface is at flame temperature.
        // That heat comes out of the flames' heat release (global budget below).
        const fT = FLAME_TEMP * fl;
        if (fT > Ta && fT > Ts) {
          const want = g * (fT - (Ta > Ts ? Ta : Ts));
          if (burningNow) dEx += want * sf * dt; // a burning surface sits inside its own flame
          else {
            contactDemand += want;
            dEx += want * contactScale * shield * dt;
          }
        }
        ex++;
        if (fa < 0 || d === 5) fa = a;
      }
      if (fa < 0) fa = own;
      expo[i] = ex;
      faceAir[i] = fa;

      if (ex > 0) {
        // Thermal radiation: emit (net vs. ambient surroundings) and absorb.
        // Same effective area for both, so nothing gets hotter than its source.
        const eps = EPS[m];
        const Tk = Ts + 273.15;
        const area = A * ex * (sfi < 3 ? sfi : 3);
        const Tk3 = Tk * Tk * Tk;
        const P = eps * SIGMA * (Tk3 * Tk - TambK4) * area;
        dEx -= P * dt;
        gx += 4 * eps * SIGMA * Tk3 * area;
        if (P > 0) {
          radSrc[own] += P;
          radEmit += P;
        }
        const absorb = eps * 0.5 * area * radField[own];
        radDemand += absorb;
        dEx += absorb * radScale * shield * dt;
      }
      dE[i] += dEi;
      gsum[i] += gs;
      dEs[i] = dEx;
      gext[i] = gx;
    }

    // Keep the approximate radiation exchange from creating energy: total
    // absorption may not exceed what was emitted.
    const target = radDemand > 0 ? Math.min(1, (0.85 * (radEmit + this.lastHeaterRad())) / radDemand) : 1;
    this.radScale += (target - this.radScale) * 0.5;
    // Flame contact may take at most a share of all flames' heat release.
    const flamePower = this.stats.hrr + this.heaterPower();
    const cTarget = contactDemand > 0 ? Math.min(1, (CONTACT_SHARE * flamePower) / contactDemand) : 1;
    this.contactScale += (cTarget - this.contactScale) * 0.5;
  }

  heaterPower() {
    let p = 0;
    for (const ht of this.world.heaters) if (ht.on) p += ht.power;
    return p;
  }

  lastHeaterRad() {
    let p = 0;
    for (const ht of this.world.heaters) if (ht.on) p += ht.power * RAD_FRACTION;
    return p + this.stats.hrr * RAD_FRACTION;
  }

  solidPassB(dt, D) {
    const w = this.world;
    const { nx, ny, h, mat, temp, fuel, moist, melt, char, flags, hrr, dE, dEs, gext, skin, wetSkin, skinMelt, expo, faceAir, colTop, waterIn, coat, sfac } = w;
    const { airQ, radSrc, flameAcc, smoke, smokeR, smokeG, smokeB, steam } = w;
    const A = h * h;
    const V = A * h;
    const solids = w.solids;
    const n = w.solidCount;
    const Tamb = w.ambient;
    const windO2 = 1 + 0.08 * Math.hypot(D.windX, D.windZ);
    const rainRate = D.rainRate;
    const burnouts = this.burnouts;
    burnouts.length = 0;
    let hrrTotal = 0;
    let burning = 0;
    let maxT = -Infinity;
    let liquids = 0;

    for (let k = 0; k < n; k++) {
      const i = solids[k];
      const m = mat[i];
      const M = MATERIALS[m];
      const rho = M.density * w.dens[i]; // thin sheets/panels have a lower effective density
      const c = M.specificHeat;
      const res = M.residue;
      const comb = M.combustible;
      const massFrac = comb ? res + (1 - res) * fuel[i] : 1;
      const dry = rho * V * (massFrac > 0.05 ? massFrac : 0.05);
      let mo = moist[i];
      let f = flags[i];
      const ex = expo[i];
      const fa = faceAir[i];
      const x = i % nx;
      const ry = (i - x) / nx;
      const y = ry % ny;
      const z = (ry - y) / ny;
      const Ctot = dry * (c + mo * CW);

      // --- temperature update. Bulk materials use two nodes: a thin skin that
      // exchanges heat with the gas and radiation, and the core that conducts
      // to the neighbouring voxels. Both solved implicitly together.
      let T;
      let Ts;
      let Cs = 0;
      let C = Ctot;
      // (thin sheets are all "skin": single node)
      const skinFrac = ex > 0 && !(f & F_LIQUID) && M.burnTime === 0 ? (ex * SKIN_DEPTH) / (h * w.dens[i]) : 0;
      const twoNode = skinFrac > 0 && skinFrac < 0.45;
      if (twoNode) {
        Cs = Ctot * skinFrac;
        C = Ctot - Cs;
        const g = ((M.conductivity * A * ex) / (0.5 * h)) * dt;
        const a1 = Cs + dt * gext[i];
        const b1 = C + dt * w.gsum[i];
        const R1 = a1 * skin[i] + dEs[i];
        const R2 = b1 * temp[i] + dE[i];
        const det = (a1 + g) * (b1 + g) - g * g;
        Ts = (R1 * (b1 + g) + g * R2) / det;
        T = (R2 * (a1 + g) + g * R1) / det;
        // A melting surface stays at the melting point until the thin skin
        // layer has taken up its latent heat; after that the molten surface
        // can heat further (thermoplastics pyrolyse and ignite this way).
        const mp = M.meltingPoint;
        if (Ts > mp && melt[i] < 1 && M.latentHeat > 0) {
          let sm = skinMelt[i];
          if (sm < 1) {
            const skinLatent = M.latentHeat * dry * (Cs / Ctot);
            const excess = (Ts - mp) * Cs;
            const need = (1 - sm) * skinLatent;
            if (excess <= need) {
              sm += excess / skinLatent;
              Ts = mp;
            } else {
              sm = 1;
              Ts = mp + (excess - need) / Cs;
            }
            skinMelt[i] = sm;
          }
        } else if (Ts < mp - 5 && skinMelt[i] > 0) skinMelt[i] = 0;
      } else {
        T = temp[i] + (dE[i] + dEs[i]) / (Ctot + dt * (w.gsum[i] + gext[i]));
        Ts = T;
      }
      // energy removal / addition helpers act on the skin when there is one
      const Csurf = Cs > 0 ? Cs : Ctot;

      // --- water arriving (rain, extinguisher): boils off a hot surface (cooling,
      // steam); whatever does not boil soaks in / wets the surface
      let ws = wetSkin[i];
      const water = waterIn[i];
      if (water > 0) {
        let rest = water;
        if (Ts > 100) {
          const per = CW * (100 - Tamb) + LV;
          const evap = Math.min(water, ((Ts - 100) * Csurf) / per);
          Ts -= (evap * per) / Csurf;
          steam[fa] += evap;
          rest -= evap;
        }
        if (rest > 0) {
          if (Ts > Tamb) Ts -= Math.min(Ts - Tamb, (rest * CW * (Ts - Tamb)) / Csurf);
          mo = Math.min(M.maxMoisture, mo + rest / dry);
          ws = 1;
        }
      }
      // a foam or powder blanket slowly breaks down, faster on hot surfaces
      if (coat[i] > 0) coat[i] *= Math.exp(-dt / (Ts > 100 ? 90 : 900));

      // --- dead fuels exchange moisture with the air
      if (M.deadFuel && T < 60) mo += (D.emc - mo) * Math.min(1, dt / M.timeLag);

      // --- drying and boiling off moisture -> steam (surface first, then core)
      if (mo > 0) {
        if (Cs > 0) {
          // only the water in the skin layer has to go before the surface heats up
          if (Ts > 100 && ws > 0) {
            const water = mo * dry * (Cs / Ctot) * ws;
            const ev = Math.min(water, ((Ts - 100) * Cs) / LV);
            ws = water > 0 ? ws * (1 - ev / water) : 0;
            mo -= ev / dry;
            Ts -= (ev * LV) / Cs;
            steam[fa] += ev;
          } else if (Ts < 60 && ws < 1) ws += (1 - ws) * Math.min(1, dt / 600); // moisture migrates back
        } else if (Ts > 100) {
          const ev = Math.min(mo * dry, ((Ts - 100) * Csurf) / LV);
          mo -= ev / dry;
          Ts -= (ev * LV) / Csurf;
          steam[fa] += ev;
        }
        if (Cs > 0 && T > 100 && mo > 0) {
          const ev = Math.min(mo * dry, ((T - 100) * C) / LV);
          mo -= ev / dry;
          T -= (ev * LV) / C;
          steam[fa] += ev;
        } else if (Ts > Tamb + 3 && Ts <= 100 && ex > 0) {
          const ev = Math.min(mo * dry, mo * dry * 4e-4 * ((Ts - Tamb) / 60) * (1.1 - D.rh) * ex * dt);
          mo -= ev / dry;
          Ts -= (ev * LV) / Csurf;
          steam[fa] += ev;
        }
        if (mo < 0) mo = 0;
      }
      if (Cs === 0) {
        T = Ts;
        C = dry * (c + mo * CW);
      }

      // --- melting / solidifying (latent heat)
      const mp = M.meltingPoint;
      if (mp !== Infinity) {
        const L = M.latentHeat;
        let me = melt[i];
        if (T > mp && me < 1) {
          if (L <= 0) me = 1;
          else {
            const dm = ((T - mp) * C) / (L * dry);
            if (me + dm >= 1) {
              T = mp + ((me + dm - 1) * L * dry) / C;
              me = 1;
            } else {
              me += dm;
              T = mp;
            }
          }
          if (me >= 1 && !(f & F_LIQUID)) {
            f |= F_LIQUID;
            w.structureDirty = true;
          }
        } else if (T < mp && me > 0) {
          if (L <= 0) me = 0;
          else {
            const dm = ((mp - T) * C) / (L * dry);
            if (me - dm <= 0) {
              T = mp - ((dm - me) * L * dry) / C;
              me = 0;
            } else {
              me -= dm;
              T = mp;
            }
          }
          if (me < 1 && f & F_LIQUID) {
            f &= ~F_LIQUID;
            w.structureDirty = true;
          }
        }
        melt[i] = me;
        if (Cs === 0 || f & F_LIQUID) Ts = T;
      }

      const Thot = Ts > T ? Ts : T;
      // --- thermal shock: glass panes crack and fall out
      if (Thot > M.shatterTemp && !(f & (F_FALLING | F_LIQUID)) && this.rand() < dt * 0.08) {
        f |= F_FALLING;
        w.structureDirty = true;
      }

      // --- metals / paint / masonry discolour when hot
      if (Thot > M.oxidizeTemp && char[i] < 1) char[i] = Math.min(1, char[i] + (dt * (Thot - M.oxidizeTemp)) / 4000);

      // --- combustion: driven by the surface temperature
      let q = 0;
      const sf = sfac[i];
      // sealed contents of a tank have no oxygen and cannot burn
      if (comb && fuel[i] > 0 && w.vesselTag[i] >= 0) {
        const fuelMass0 = rho * V * (1 - res);
        // a dry skin can burn on a still-moist core
        const wetOk = Cs > 0 ? ws < 0.2 || mo < M.extinctionMoisture : mo < M.extinctionMoisture;
        if (ex > 0 && !(f & F_BURNING) && Ts >= M.ignitionTemp && wetOk && sf > 0.5) {
          f |= F_BURNING;
        }
        if (f & F_BURNING) {
          // quenched, smothered or starved of oxygen: the flame goes out
          if (ex === 0 || Ts < M.ignitionTemp - 120 || !wetOk || (sf < 0.35 && this.rand() < (0.35 - sf) * dt * 3)) {
            f &= ~F_BURNING;
          } else {
            // hotter surfaces pyrolyse faster; more exposed faces = more oxygen
            let tf = 0.6 + (Ts - M.ignitionTemp) / 500;
            if (tf > 1.2) tf = 1.2;
            const faces = ex < 3 ? ex : 3;
            let dm =
              M.burnTime > 0
                ? ((fuelMass0 / M.burnTime) * tf * windO2 * dt * faces) / 3 // fine fuel: residence time
                : M.burnRate * A * faces * tf * windO2 * dt; // bulk fuel: regression per surface area
            dm *= sf; // water, foam, powder or CO2 slow the burning down
            let Hc = M.heatOfCombustion;
            let smokeYield = M.smokeYield;
            let sc = M.smokeColor;
            // only the tip of a wick draws wax; a fixed mass rate per wick (resolution independent)
            if (M.wickIds && !(y + 1 < ny && mat[i + nx] === m)) {
              // A burning wick draws molten wax up and burns that instead.
              const src = this.findWickFuel(x, y, z, M.wickIds);
              if (src >= 0) {
                const S = MATERIALS[mat[src]];
                const srcMass0 = S.density * V * w.dens[src];
                // molten wax feeds the wick fully; solid wax only through the
                // small melt pool at the wick's base (below voxel resolution)
                let feed = 1;
                if (!(flags[src] & F_LIQUID)) {
                  feed = (temp[src] - (S.meltingPoint - 30)) / 30;
                  feed = feed < 0.3 ? 0.3 : feed > 1 ? 1 : feed;
                }
                const want = M.wickRate * dt * feed * sf;
                const take = Math.min(want, fuel[src] * srcMass0);
                fuel[src] -= take / srcMass0;
                if (fuel[src] <= 1e-6) burnouts.push(src);
                Hc = S.heatOfCombustion;
                smokeYield = S.smokeYield;
                sc = S.smokeColor;
                q = (take * Hc) / dt;
                dm *= 0.02; // the wick itself is barely consumed while fed
              }
            }
            dm = Math.min(dm, fuel[i] * fuelMass0);
            fuel[i] -= dm / fuelMass0;
            q += (dm * M.heatOfCombustion) / dt;
            // part of the heat keeps the fuel surface hot (pyrolysis)...
            const selfQ = q * M.selfHeating * dt;
            const cap = M.maxBurnTemp;
            let toAir = q * (1 - M.selfHeating - RAD_FRACTION);
            if (Ts < cap) {
              const room = (cap - Ts) * Csurf;
              if (selfQ <= room) Ts += selfQ / Csurf;
              else {
                Ts = cap;
                toAir += (selfQ - room) / dt;
              }
            } else toAir += selfQ / dt;
            // ...the rest heats the gas above (flames) and radiates. A wick flame
            // sits around the wick, down to the wax surface (that melts the pool).
            const fc = M.wickIds ? (x >> 1) + w.anx * ((y >> 1) + w.any * (z >> 1)) : fa;
            if (M.wickIds && q > 0) {
              // part of a candle flame's heat goes back into the wax around the wick
              const back = q * POOL_FEEDBACK;
              if (this.heatPool(x, y, z, back * dt, M.wickIds)) toAir -= back;
            }
            airQ[fc] += toAir;
            radSrc[fc] += q * RAD_FRACTION;
            // a candle flame stands off the pool: its burning gas starts above the wick tip
            flameAcc[M.wickIds && y + 2 < ny ? (x >> 1) + w.anx * (((y + 2) >> 1) + w.any * (z >> 1)) : fa] += q;
            const sm = (q * dt * smokeYield) / Hc;
            smoke[fc] += sm;
            smokeR[fc] += sm * sc[0];
            smokeG[fc] += sm * sc[1];
            smokeB[fc] += sm * sc[2];
            const ch = 0.35 + 0.65 * (1 - fuel[i]);
            if (char[i] < ch) char[i] = ch;
            if (fuel[i] <= 1e-6) burnouts.push(i);
            burning++;
          }
        }
        if (!(f & F_BURNING) && Ts > M.pyrolysisTemp && ex > 0) {
          // Smouldering / pyrolysis: smoke without flame, slow mass loss.
          const s = Math.min(1, (Ts - M.pyrolysisTemp) / Math.max(20, M.ignitionTemp - M.pyrolysisTemp));
          const base = M.burnTime > 0 ? fuelMass0 / M.burnTime / 3 : M.burnRate * A;
          const dm = Math.min(base * ex * 0.04 * s * dt, fuel[i] * fuelMass0);
          fuel[i] -= dm / fuelMass0;
          const sm = dm * Math.min(0.5, M.smokeYield * 6 + 0.05);
          const sc = M.smolderColor;
          smoke[fa] += sm;
          smokeR[fa] += sm * sc[0];
          smokeG[fa] += sm * sc[1];
          smokeB[fa] += sm * sc[2];
          f |= F_SMOLDER;
          if (char[i] < s * 0.4) char[i] = s * 0.4;
          if (fuel[i] <= 1e-6) burnouts.push(i);
        } else f &= ~F_SMOLDER;
      }
      hrr[i] = q;
      hrrTotal += q;

      if (Cs === 0) T = Ts;
      if (T > MAX_TEMP) T = MAX_TEMP;
      else if (T < -60) T = -60;
      if (Ts > MAX_TEMP) Ts = MAX_TEMP;
      else if (Ts < -60) Ts = -60;
      if (Ts > maxT) maxT = Ts;
      if (T > maxT) maxT = T;
      if (f & F_LIQUID) liquids++;
      temp[i] = T;
      skin[i] = ex > 0 ? Ts : T;
      wetSkin[i] = mo > 0 ? ws : 0;
      moist[i] = mo;
      flags[i] = f;
    }

    // Burnt-out voxels turn into their residue (char -> ash) or vanish.
    for (const i of burnouts) {
      const m = mat[i];
      if (!m || fuel[i] > 1e-6) continue;
      const M = MATERIALS[m];
      if (M.residueId) {
        const T = Math.max(temp[i], skin[i]);
        const R = MATERIALS[M.residueId];
        w.setVoxel(i, M.residueId, { temp: T, moisture: 0, owner: w.owner[i], variation: 0.15 });
        w.char[i] = 1;
        if (R.combustible && T >= R.ignitionTemp) w.flags[i] |= F_BURNING;
      } else {
        // the voxel is consumed; its remaining heat goes into the gas
        const C = M.density * w.dens[i] * V * 0.05 * M.specificHeat;
        airQ[faceAir[i]] += ((temp[i] - Tamb) * C) / dt;
        w.clearVoxel(i);
      }
    }

    const s = this.stats;
    s.hrr = hrrTotal;
    s.burning = burning;
    s.maxT = maxT === -Infinity ? Tamb : maxT;
    s.liquid = liquids;
  }

  /** Spread energy E (J) over the exposed wax surface around a wick. */
  heatPool(x, y, z, E, ids) {
    const w = this.world;
    const { nx, ny, nz, mat, expo, temp, skin } = w;
    const V = w.h ** 3;
    const list = this._pool ?? (this._pool = []);
    list.length = 0;
    for (let dy = 0; dy >= -3; dy--) {
      const yy = y + dy;
      if (yy < 0) break;
      for (let dz = -2; dz <= 2; dz++)
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          const zz = z + dz;
          if (xx < 0 || zz < 0 || xx >= nx || zz >= nz) continue;
          const j = xx + nx * (yy + ny * zz);
          if (mat[j] && ids.includes(mat[j]) && expo[j] > 0) list.push(j);
        }
    }
    if (!list.length) return false;
    const e = E / list.length;
    for (const j of list) {
      const S = MATERIALS[mat[j]];
      const dT = e / (S.density * w.dens[j] * S.specificHeat * V);
      temp[j] += dT;
      skin[j] += dT;
    }
    return true;
  }

  /** Find wax a wick can draw: same level or up to 3 voxels below, molten preferred. */
  findWickFuel(x, y, z, ids) {
    const w = this.world;
    const { nx, ny, nz, mat, flags } = w;
    let fallback = -1;
    for (let dy = 0; dy >= -3; dy--) {
      const yy = y + dy;
      if (yy < 0) break;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const zz = z + dz;
          if (xx < 0 || zz < 0 || xx >= nx || zz >= nz) continue;
          const j = xx + nx * (yy + ny * zz);
          const mj = mat[j];
          if (!mj || !ids.includes(mj)) continue;
          if (flags[j] & F_LIQUID) return j;
          if (fallback < 0) fallback = j;
        }
    }
    return fallback;
  }

  // ---------------------------------------------------------------------------
  // Structure: liquids flow, granular ash settles, unsupported parts fall.
  structure(dt) {
    const w = this.world;
    if (w.listDirty) w.rebuildLists();
    const { nx, ny, nz, mat, flags, solids } = w;
    const n = w.solidCount;
    const nxy = nx * ny;

    if (w.structureDirty && w.time - this.lastStructureCheck > 0.5) {
      this.checkSupport();
      this.lastStructureCheck = w.time;
    }

    // collect movers
    const movers = this.movers;
    movers.length = 0;
    for (let k = 0; k < n; k++) {
      const i = solids[k];
      const f = flags[i];
      if (f & (F_FALLING | F_LIQUID) || MATERIALS[mat[i]].granular) movers.push(k);
    }
    if (!movers.length) {
      this.stats.falling = 0;
      return;
    }
    // bottom first so stacked voxels move together
    movers.sort((a, b) => (((solids[a] / nx) | 0) % ny) - (((solids[b] / nx) | 0) % ny));

    let falling = 0;
    let moved = false;
    for (const k of movers) {
      const i = solids[k];
      const m = mat[i];
      if (!m) continue;
      const f = flags[i];
      const x = i % nx;
      const y = ((i - x) / nx) % ny;
      const z = ((i - x) / nx - y) / ny;
      if (y === 0) {
        if (f & F_FALLING) flags[i] &= ~F_FALLING;
        continue;
      }
      const below = i - nx;
      if (!mat[below]) {
        w.moveVoxel(i, below);
        solids[k] = below;
        moved = true;
        if (f & F_FALLING) falling++;
        continue;
      }
      if (f & F_FALLING) {
        if (flags[below] & F_FALLING) {
          falling++;
          continue; // wait for the voxel below
        }
        flags[i] &= ~F_FALLING; // landed
        w.structureDirty = true;
        if (!(f & F_LIQUID) && !MATERIALS[m].granular) continue;
      }
      const M = MATERIALS[m];
      const p = Math.min(1, M.fluidity * dt * 20);
      if (this.rand() > p) continue;
      // try to slide diagonally down
      const start = (this.rand() * 4) | 0;
      let done = false;
      for (let t = 0; t < 4 && !done; t++) {
        const d = (start + t) & 3;
        const dx = d === 0 ? 1 : d === 1 ? -1 : 0;
        const dz = d === 2 ? 1 : d === 3 ? -1 : 0;
        const xx = x + dx;
        const zz = z + dz;
        if (xx < 0 || zz < 0 || xx >= nx || zz >= nz) continue;
        const side = i + dx + nxy * dz;
        if (mat[side]) continue;
        const diag = side - nx;
        if (!mat[diag]) {
          w.moveVoxel(i, diag);
          solids[k] = diag;
          done = true;
        } else if (!M.granular && f & F_LIQUID && (y + 1 < ny && flags[i + nx] & F_LIQUID ? true : this.rand() < 0.15)) {
          // spread sideways over a surface (pushed by liquid above)
          w.moveVoxel(i, side);
          solids[k] = side;
          done = true;
        }
      }
      if (done) moved = true;
    }
    if (moved) w.updateDerived();
    this.stats.falling = falling;
  }

  /** Flood fill from the ground/anchors through structural voxels (26-connected). */
  checkSupport() {
    const w = this.world;
    const { nx, ny, nz, mat, flags, solids } = w;
    const n = w.solidCount;
    if (!this.visit || this.visit.length !== w.N) {
      this.visit = new Uint32Array(w.N);
      this.gen = 0;
    }
    const visit = this.visit;
    const gen = ++this.gen;
    if (!this.queue || this.queue.length < n) this.queue = new Int32Array(n + 1024);
    const queue = this.queue;
    let qh = 0;
    let qt = 0;
    const structural = (i) => {
      const m = mat[i];
      return m !== 0 && !(flags[i] & (F_LIQUID | F_FALLING)) && !MATERIALS[m].granular;
    };
    for (let k = 0; k < n; k++) {
      const i = solids[k];
      if (!structural(i)) continue;
      const y = ((i / nx) | 0) % ny;
      if (y === 0 || flags[i] & F_ANCHOR) {
        visit[i] = gen;
        queue[qt++] = i;
      }
    }
    while (qh < qt) {
      const i = queue[qh++];
      const x = i % nx;
      const y = ((i - x) / nx) % ny;
      const z = ((i - x) / nx - y) / ny;
      for (let dz = -1; dz <= 1; dz++) {
        const zz = z + dz;
        if (zz < 0 || zz >= nz) continue;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= ny) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= nx) continue;
            const j = xx + nx * (yy + ny * zz);
            if (visit[j] === gen || !structural(j)) continue;
            visit[j] = gen;
            queue[qt++] = j;
          }
        }
      }
    }
    let detached = 0;
    for (let k = 0; k < n; k++) {
      const i = solids[k];
      if (visit[i] !== gen && structural(i)) {
        flags[i] |= F_FALLING;
        detached++;
      }
    }
    w.structureDirty = false;
    return detached;
  }

  // ---------------------------------------------------------------------------
  // Interaction tools

  /** Light everything combustible within `radius` metres of a point (a match / lighter). */
  ignite(p, radius, materials = null) {
    const w = this.world;
    let count = 0;
    this.forSphere(p, radius, (i) => {
      const M = MATERIALS[w.mat[i]];
      if (!M.combustible) return;
      if (materials && !materials.includes(w.mat[i])) return;
      w.moist[i] = Math.min(w.moist[i], M.extinctionMoisture * 0.3);
      // a flame heats the surface; the core only warms (and must not melt)
      w.temp[i] = M.burnTime > 0 ? Math.max(w.temp[i], M.ignitionTemp + 150) : Math.max(w.temp[i], Math.min(M.ignitionTemp, M.meltingPoint - 10) * 0.6);
      w.skin[i] = Math.max(w.skin[i], M.ignitionTemp + 150);
      w.flags[i] |= F_BURNING;
      count++;
    });
    return count;
  }

  /** A blow torch / burner held at a point for `duration` seconds. */
  addTorch(p, power, duration, radius) {
    const w = this.world;
    const ht = { pos: [p[0], p[1] - radius, p[2]], power, radius, height: radius * 3, on: true, until: w.time + duration, temporary: true };
    w.heaters.push(ht);
    return ht;
  }

  /** Douse with water: cools, wets and extinguishes. */
  douse(p, radius, litres = 5) {
    const w = this.world;
    const cells = [];
    this.forSphere(p, radius, (i) => cells.push(i));
    if (!cells.length) return 0;
    const V = w.h ** 3;
    const perVoxel = litres / cells.length;
    for (const i of cells) {
      const M = MATERIALS[w.mat[i]];
      const dry = M.density * w.dens[i] * V;
      let water = perVoxel;
      const C = dry * M.specificHeat;
      if (w.temp[i] > 100) {
        const need = ((w.temp[i] - 100) * C) / (CW * 85 + LV);
        const used = Math.min(water, need);
        w.temp[i] -= (used * (CW * 85 + LV)) / C;
        w.skin[i] = Math.min(w.skin[i], w.temp[i]);
        water -= used;
        const [x, y, z] = w.coords(i);
        w.steam[w.airIndexOfVoxel(x, Math.min(w.ny - 1, y + 1), z)] += used;
      }
      w.moist[i] = Math.min(M.maxMoisture, w.moist[i] + water / dry);
      w.flags[i] &= ~(F_BURNING | F_SMOLDER);
    }
    // cool the air too
    const ah = w.ah;
    const r = radius * 1.5;
    for (let az = 0; az < w.anz; az++)
      for (let ay = 0; ay < w.any; ay++)
        for (let ax = 0; ax < w.anx; ax++) {
          const dx = (ax + 0.5) * ah - p[0];
          const dy = (ay + 0.5) * ah - p[1];
          const dz = (az + 0.5) * ah - p[2];
          if (dx * dx + dy * dy + dz * dz < r * r) {
            const a = w.airIdx(ax, ay, az);
            w.airT[a] = Math.min(w.airT[a], 100);
          }
        }
    return cells.length;
  }

  forSphere(p, radius, fn) {
    const w = this.world;
    const h = w.h;
    const r = Math.max(radius, h * 0.75);
    const x0 = Math.max(0, Math.floor((p[0] - r) / h));
    const x1 = Math.min(w.nx - 1, Math.floor((p[0] + r) / h));
    const y0 = Math.max(0, Math.floor((p[1] - r) / h));
    const y1 = Math.min(w.ny - 1, Math.floor((p[1] + r) / h));
    const z0 = Math.max(0, Math.floor((p[2] - r) / h));
    const z1 = Math.min(w.nz - 1, Math.floor((p[2] + r) / h));
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const i = w.idx(x, y, z);
          if (!w.mat[i]) continue;
          const dx = (x + 0.5) * h - p[0];
          const dy = (y + 0.5) * h - p[1];
          const dz = (z + 0.5) * h - p[2];
          if (dx * dx + dy * dy + dz * dz <= r * r) fn(i);
        }
  }

  /** Human readable state of one voxel (inspect tool). */
  describe(i) {
    const w = this.world;
    const m = w.mat[i];
    if (!m) return null;
    const M = MATERIALS[m];
    const f = w.flags[i];
    const state = [];
    if (f & F_BURNING) state.push('burning');
    if (f & F_SMOLDER) state.push('smouldering');
    if (f & F_LIQUID) state.push('molten');
    else if (w.melt[i] > 0) state.push(`melting ${(w.melt[i] * 100).toFixed(0)}%`);
    if (f & F_FALLING) state.push('falling');
    if (!state.length) state.push('solid');
    return {
      material: M.label,
      temperature: w.temp[i],
      surface: w.skin[i],
      fuel: M.combustible ? w.fuel[i] : null,
      moisture: w.moist[i],
      heatRelease: w.hrr[i],
      state: state.join(', '),
      owner: w.owner[i],
    };
  }
}
