import { MATERIALS } from './materials.js';

/**
 * Snow lying on the ground, the roofs and whatever else is out under the sky.
 *
 * A height field over the scene, finer than the voxels where they are coarse (cells of at
 * most 0.2 m, so that a trail of footprints is a trail): per cell its depth (m) and density
 * (kg/m³), lying on the top surface of its voxel column (the terrain under it smoothed, so
 * that snow fills the steps of the voxel terrain as it drifts into corners; under a tree's
 * crown on the ground beneath it, with less of it).
 *
 *  - It falls when the air is at freezing (the precipitation is snow below +0.5 °C, sleet up
 *    to +3 °C): fresh snow ~100 kg/m³, 10 cm for 10 mm of water. Lying, it settles: denser
 *    and thinner over days.
 *  - It melts (334 kJ per kg) when the heat it gets outweighs what it loses: the sun (fresh
 *    snow sends ~85% of it back, old and trodden snow less: it melts first), the air over it
 *    (a thaw, a fire's hot gas; air below freezing cools it instead), the radiation of
 *    flames, a hot surface under it (embers, lava, a hot steel deck); it loses heat to a
 *    clear sky. On a sunny day at a few degrees above freezing it shrinks visibly over an
 *    hour; in a frost under a weak winter sun it does not melt. The heat the air gives is
 *    taken from it: snow round a fire cools it. The melt water soaks into what it lies on:
 *    wet fuel under (and after) the snow burns badly or not at all.
 *  - What walks over it presses it down: a person (~13 kPa under the boots) packs fresh
 *    snow to ~400 kg/m³ (a quarter of its depth: the footprints, a trail), a dragon more.
 *  - A blast clears it round the crater; where the ground is gone (a crater), so is its snow.
 */
export const SNOW = {
  fresh: 100, // kg/m³ of new snow
  settled: 320, // what it settles towards
  settleTime: 3 * 86400, // s
  packed: 550, // as dense as feet press it
  latent: 334e3, // J/kg to melt
  hc: 15, // W/(m²·K) from the air over it
};

// (the ground and trees have no eaves: a step in a hillside, a branch, is not a roof's edge)
const NO_EAVE = new Set(['soil', 'grass', 'basalt', 'hillRock', 'bedrock', 'pine', 'oak', 'willow', 'bark', 'twigs', 'leaves', 'needles']);
const NO_SNOW_ON = new Set(['leaves', 'needles', 'twigs', 'water', 'gasoline']);

export class SnowField {
  constructor(world, depth = 0) {
    const h = world.h;
    this.k = Math.max(1, Math.ceil(h / 0.2 - 1e-9)); // cells per voxel column, each way
    this.sh = h / this.k;
    this.sx = world.nx * this.k;
    this.sz = world.nz * this.k;
    const n = this.sx * this.sz;
    this.depth = new Float32Array(n);
    this.rho = new Float32Array(n).fill(SNOW.fresh);
    this.base = new Float32Array(n); // height of the surface it lies on (m)
    this.cover = new Float32Array(n); // share of the snow falling that reaches it (0: none can lie here)
    this.air = new Int32Array(n); // air cell over it
    this.top = new Int32Array(n).fill(-1); // voxel under it
    // a roof's edge (an eave: the cell next to it more than a metre lower): where its melt
    // water drips off, onto that cell's ground. Per cell: the cell it drips onto, or -1
    this.eave = new Int32Array(n).fill(-1);
    this.drip = new Float32Array(n); // kg/s dripping off it now
    this.drips = []; // [{ x, y, z, to (height it falls to), rate (kg/s) }] (drawing)
    this.version = 0; // bumps when it has changed (drawing)
    this.geomVersion = 0; // bumps when what it lies on changed
    this.acc = 0;
    this.seaLevel = world.sea?.level ?? -Infinity;
    this.layout(world);
    if (depth > 0) for (let j = 0; j < n; j++) this.depth[j] = depth * this.cover[j];
    // lying snow is a few days old: settled a little
    if (depth > 0) this.rho.fill(180);
    this.seenGeom = world.geomVersion;
  }

  /** Where snow can lie, on what, and its air cell: after the scene's shape has changed. */
  layout(w) {
    const { nx, nz, h, colTop, mat, ah, anx, any, anz } = w;
    const { k, sh, sx, sz } = this;
    // per column: the surface snow lies on, skipping foliage (it lies under the crown)
    const surf = new Float32Array(nx * nz).fill(-1);
    const topV = new Int32Array(nx * nz).fill(-1);
    const shade = new Float32Array(nx * nz).fill(1);
    for (let cz = 0; cz < nz; cz++)
      for (let cx = 0; cx < nx; cx++) {
        const c = cx + nx * cz;
        let y = colTop[c];
        let cover = 1;
        while (y >= 0) {
          const i = w.idx(cx, y, cz);
          const m = mat[i];
          if (!m) {
            y--;
            continue;
          }
          const name = MATERIALS[m].name;
          if (name === 'leaves' || name === 'needles' || name === 'twigs') {
            cover = 0.45; // the crown holds much of it
            y--;
            continue;
          }
          // tall grass: the blades stand up through it, it lies on the turf
          if (name === 'grass' && y > 0 && mat[i - nx] === m) {
            y--;
            continue;
          }
          break;
        }
        if (y < 0) continue;
        const i = w.idx(cx, y, cz);
        if (NO_SNOW_ON.has(MATERIALS[mat[i]].name) && !((w.ice?.thick[c] ?? 0) > 0.03 && w.ice.top[c] === i)) continue;
        if ((y + 1) * h < this.seaLevel + 0.05) continue; // under the sea
        surf[c] = (y + 1) * h;
        topV[c] = i;
        shade[c] = cover;
      }
    for (let z = 0; z < sz; z++)
      for (let x = 0; x < sx; x++) {
        const j = x + sx * z;
        const cx = Math.floor(x / k);
        const cz = Math.floor(z / k);
        const c = cx + nx * cz;
        const own = surf[c];
        if (own < 0) {
          this.cover[j] = 0;
          this.top[j] = -1;
          this.depth[j] = 0;
          continue;
        }
        // smoothed over the neighbouring columns where they are steps of the terrain (not walls)
        const px = ((x + 0.5) * sh) / h - 0.5;
        const pz = ((z + 0.5) * sh) / h - 0.5;
        const x0 = Math.max(0, Math.min(nx - 2, Math.floor(px)));
        const z0 = Math.max(0, Math.min(nz - 2, Math.floor(pz)));
        const fx = Math.max(0, Math.min(1, px - x0));
        const fz = Math.max(0, Math.min(1, pz - z0));
        const q = [surf[x0 + nx * z0], surf[x0 + 1 + nx * z0], surf[x0 + nx * (z0 + 1)], surf[x0 + 1 + nx * (z0 + 1)]];
        let b = own;
        if (q.every((v) => v >= 0 && Math.abs(v - own) <= h * 1.01)) {
          const bil = (q[0] * (1 - fx) + q[1] * fx) * (1 - fz) + (q[2] * (1 - fx) + q[3] * fx) * fz;
          b = Math.max(own, bil);
        }
        // a voxel step left bare by the smoothing: the snow on it lies on its own top
        const old = this.base[j];
        this.base[j] = b;
        this.cover[j] = shade[c];
        this.top[j] = topV[c];
        // the ground went from under it (a crater, a collapsed roof): its snow went with it
        if (old > 0 && b < old - h * 0.75) this.depth[j] = 0;
        const ax = Math.min(anx - 1, Math.floor(((x + 0.5) * sh) / ah));
        const az = Math.min(anz - 1, Math.floor(((z + 0.5) * sh) / ah));
        const ay = Math.min(any - 1, Math.floor((b + 0.05) / ah));
        this.air[j] = ax + anx * (ay + any * az);
      }
    // the eaves: a roof (or wall top, a ledge) cell beside a drop of more than a metre (built:
    // not the ground or a tree)
    this.eave.fill(-1);
    for (let z = 0; z < sz; z++)
      for (let x = 0; x < sx; x++) {
        const j = x + sx * z;
        if (!this.cover[j] || this.top[j] < 0 || NO_EAVE.has(MATERIALS[w.mat[this.top[j]]].name)) continue;
        let best = -1;
        let low = this.base[j] - 1;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const X = x + dx;
          const Z = z + dz;
          if (X < 0 || Z < 0 || X >= sx || Z >= sz) continue;
          const k = X + sx * Z;
          if (this.top[k] >= 0 && this.base[k] < low) {
            low = this.base[k];
            best = k;
          }
        }
        this.eave[j] = best;
      }
    this.geomVersion++;
    this.version++;
  }

  /** Snow depth (m) at a point (0 where there is none). */
  depthAt(x, z) {
    const j = this.cell(x, z);
    return j < 0 ? 0 : this.depth[j];
  }

  /** Height of the snow surface (m) at a point, or null where there is no snow. */
  surfaceAt(x, z) {
    const j = this.cell(x, z);
    return j < 0 || this.depth[j] <= 0 ? null : this.base[j] + this.depth[j];
  }

  cell(x, z) {
    const cx = Math.floor(x / this.sh);
    const cz = Math.floor(z / this.sh);
    if (cx < 0 || cz < 0 || cx >= this.sx || cz >= this.sz) return -1;
    return cx + this.sx * cz;
  }

  /**
   * Something standing or walking on it at (x, z), feet at height y: a pressure p (Pa) over a
   * radius r (m) packs the snow under it.
   */
  press(x, y, z, r, p) {
    const { sh, sx, sz } = this;
    // packed to what the pressure can do: ~13 kPa (a person) gives ~400 kg/m³
    const target = Math.min(SNOW.packed, 230 + p / 80);
    const R = Math.ceil(r / sh);
    const cx = Math.floor(x / sh);
    const cz = Math.floor(z / sh);
    let changed = false;
    for (let dz = -R; dz <= R; dz++)
      for (let dx = -R; dx <= R; dx++) {
        const gx = cx + dx;
        const gz = cz + dz;
        if (gx < 0 || gz < 0 || gx >= sx || gz >= sz) continue;
        if ((dx * dx + dz * dz) * sh * sh > r * r + sh * sh * 0.25) continue;
        const j = gx + sx * gz;
        const d = this.depth[j];
        if (d <= 0 || this.rho[j] >= target) continue;
        // only what stands on this snow (not something passing over it, or on a roof above)
        if (Math.abs(y - this.base[j]) > d + 0.35) continue;
        this.depth[j] = (d * this.rho[j]) / target;
        this.rho[j] = target;
        changed = true;
      }
    if (changed) this.version++;
  }

  /** A blast: the snow round it is blown away (all of it near, thinner further out). */
  blast(p, R) {
    const { sh, sx, sz } = this;
    const n = Math.ceil(R / sh);
    const cx = Math.floor(p[0] / sh);
    const cz = Math.floor(p[2] / sh);
    for (let dz = -n; dz <= n; dz++)
      for (let dx = -n; dx <= n; dx++) {
        const gx = cx + dx;
        const gz = cz + dz;
        if (gx < 0 || gz < 0 || gx >= sx || gz >= sz) continue;
        const d = Math.hypot(dx, dz) * sh;
        if (d > R) continue;
        const j = gx + sx * gz;
        if (Math.abs(this.base[j] - p[1]) > R) continue;
        this.depth[j] *= Math.min(1, Math.max(0, (d / R - 0.45) / 0.55));
      }
    this.version++;
  }

  /** Total snow lying (kg of water) and the share of the ground it covers. */
  totals() {
    let kg = 0;
    let covered = 0;
    let cells = 0;
    const A = this.sh * this.sh;
    for (let j = 0; j < this.depth.length; j++) {
      if (!this.cover[j]) continue;
      cells++;
      const d = this.depth[j];
      if (d > 0.005) covered++;
      kg += d * this.rho[j] * A;
    }
    return { kg, cover: cells ? covered / cells : 0 };
  }
}

/** Share of the precipitation falling as snow at an air temperature (°C). */
export function snowShare(T) {
  return T <= 0.5 ? 1 : T >= 3 ? 0 : (3 - T) / 2.5;
}

/**
 * One step of the snow: what falls, settles and melts (every ~0.5 s of scene time, the
 * whole field), and what is pressed down by feet (every step).
 */
export function stepSnow(sim, dt, D) {
  const w = sim.world;
  const S = w.snow;
  if (!S) return;
  // what walks on it
  const pl = sim.ai?.player;
  if (pl) S.press(pl.p[0], pl.p[1], pl.p[2], 0.2, 13000);
  for (const e of w.enemies) S.press(e.p[0], e.p[1], e.p[2], e.dead ? 0.45 : 0.2, e.dead ? 2500 : 13000);
  for (const d of w.dragons) if (d.mode === 'ground') S.press(d.p[0], d.p[1], d.p[2], 0.9 * (d.k ?? 1), 40000);
  // blasts since last time
  for (S.seenEvents ??= w.events.length; S.seenEvents < w.events.length; S.seenEvents++) {
    const e = w.events[S.seenEvents];
    if (e.type === 'explosion') S.blast(e.pos, Math.max(1, (e.radius ?? 1) * 1.6));
  }
  S.acc += dt;
  if (S.acc < 0.5) return;
  const T = S.acc;
  S.acc = 0;
  if (w.geomVersion !== S.seenGeom) {
    if (w.listDirty) w.rebuildLists();
    S.layout(w);
    S.seenGeom = w.geomVersion;
  }
  const fall = D.snowRate ?? 0; // kg/(m²·s) of water falling as snow
  const solar = w.dark || w.indoor ? 0 : D.solar ?? 0;
  // longwave to the sky: ~40 W/m² under a clear one, little under cloud (or while it snows)
  const skyLoss = 40 * Math.min(1, solar / 500) + 5;
  const { depth, rho, base, cover, air, top } = S;
  const { airT, radField, temp, skin, airQ } = w;
  const A = S.sh * S.sh;
  const cap = 1.2 * 1005 * w.ah ** 3; // J/K of an air cell
  const settle = Math.min(1, T / SNOW.settleTime);
  const LF = SNOW.latent;
  let changed = false;
  let dripping = false;
  S.drip.fill(0);
  const qH = heaterFlux(S, w);
  for (let j = 0; j < depth.length; j++) {
    const cv = cover[j];
    if (!cv) continue;
    let d = depth[j];
    const a = air[j];
    const Ta = airT[a];
    if (fall > 0) {
      // new snow on top: the layer's mass and depth grow, its density drops towards fresh
      const add = fall * cv * T;
      const m = d * rho[j] + add;
      d += add / SNOW.fresh;
      rho[j] = m / d;
      changed = true;
    }
    if (d <= 0) continue;
    // heat into it (W/m²): the sun (what its whiteness does not send back; less under a
    // tree), the air over it (or out of it, below freezing), the clear sky it loses heat
    // to, flames' radiation, a hot surface under it
    const albedo = 0.88 - 0.3 * Math.min(1, Math.max(0, (rho[j] - 100) / 350));
    let q = (1 - albedo) * solar * cv + SNOW.hc * Ta - skyLoss;
    const qAir = Ta > 0 ? SNOW.hc * Ta : 0;
    q += 0.9 * radField[a]; // snow takes in nearly all of a fire's infrared
    if (qH) q += qH[j]; // a burner's or torch's flame near it, straight (not smeared over its air cell)
    const i = top[j];
    if (i >= 0) {
      const Tg = Math.max(temp[i], skin[i]);
      if (Tg > 5) q += (0.35 * (Tg - 5)) / Math.max(0.02, d);
    }
    // what lies under the snow is soaked by it: grass, leaves, wood under snow do not catch
    if (i >= 0 && d > 0.02) {
      const M = MATERIALS[w.mat[i]];
      if (M.combustible) {
        const wet = M.maxMoisture * 0.85; // (near what it can hold)
        if (w.moist[i] < wet) w.moist[i] = wet;
      }
    }
    let m = d * rho[j];
    if (q > 0.5) {
      const melt = Math.min(m, (q * T) / LF);
      if (melt > 0) {
        m -= melt;
        // the air pays for what it melted (no colder than freezing)
        const E = Math.min(melt * LF * Math.min(1, qAir / q) * A, Math.max(0, Ta) * cap * 0.5);
        airQ[a] -= E / dt;
        // the melt water soaks into what it lies on; off a roof's edge it drips down (the
        // melt of the slope above runs to its edge: ~4 cells of roof to a cell of eave), onto
        // the ground under it
        const k = S.eave[j];
        if (k >= 0) {
          const kg = melt * A * 4;
          if (S.top[k] >= 0) sim.addWater(S.top[k], kg);
          S.drip[j] = kg / T;
          dripping = true;
        } else if (i >= 0) sim.addWater(i, melt * A);
        changed = true;
      }
    }
    // it settles: denser, thinner
    let r = rho[j];
    if (r < SNOW.settled) r += (SNOW.settled - r) * settle;
    rho[j] = r;
    depth[j] = m > 1e-4 ? m / r : 0;
  }
  if (changed || fall > 0) S.version++;
  // where it drips (for drawing): the eaves dripping now
  S.drips.length = 0;
  if (dripping)
    for (let j = 0; j < S.drip.length; j++) {
      const r = S.drip[j];
      if (r <= 0) continue;
      const k = S.eave[j];
      const x = (j % S.sx) + 0.5;
      const z = Math.floor(j / S.sx) + 0.5;
      // at the edge, towards the cell it drips onto
      const ex = ((k % S.sx) + 0.5 - x) * 0.5;
      const ez = (Math.floor(k / S.sx) + 0.5 - z) * 0.5;
      S.drips.push({ x: (x + ex) * S.sh, y: S.base[j], z: (z + ez) * S.sh, to: S.base[k] + S.depth[k], rate: r });
    }
}

/**
 * Heat (W/m²) from the scene's small flames (burners, torches, a splash of the dragon's fire)
 * straight onto the snow round them: the air grid spreads a flame's heat over its whole
 * cell (0.4 m outdoors), so the snow by a 30 kW burner would hardly know it is there. Its
 * radiation (~30% of what it burns, from the flame's middle, on the snow's flat top), and
 * where the flame stands on the snow, its hot gas (~20 kW/m²).
 */
function heaterFlux(S, w) {
  const hs = w.heaters.filter((ht) => ht.on !== false && ht.power > 200 && !ht.jet);
  if (!hs.length) return null;
  const q = (S.qH ??= new Float32Array(S.depth.length));
  q.fill(0);
  const { sh, sx, sz, base, depth } = S;
  for (const ht of hs) {
    const P = ht.power;
    const hgt = ht.height ?? 0.3;
    const c = [ht.pos[0], ht.pos[1] + hgt * 0.4, ht.pos[2]];
    const R = Math.sqrt((0.3 * P) / (4 * Math.PI * 20)); // out to where it is ~20 W/m²
    const n = Math.ceil(R / sh);
    const gx0 = Math.floor(c[0] / sh);
    const gz0 = Math.floor(c[2] / sh);
    const rf = (ht.radius ?? 0.1) + 0.15;
    for (let dz = -n; dz <= n; dz++)
      for (let dx = -n; dx <= n; dx++) {
        const gx = gx0 + dx;
        const gz = gz0 + dz;
        if (gx < 0 || gz < 0 || gx >= sx || gz >= sz) continue;
        const j = gx + sx * gz;
        if (depth[j] <= 0) continue;
        const top = base[j] + depth[j];
        const ex = (gx + 0.5) * sh - c[0];
        const ez = (gz + 0.5) * sh - c[2];
        const ey = c[1] - top;
        const d2 = ex * ex + ey * ey + ez * ez + 0.01;
        if (ey > 0) q[j] += (0.3 * P * (ey / Math.sqrt(d2))) / (4 * Math.PI * d2);
        // the flame standing on (or in) the snow
        if (ex * ex + ez * ez < rf * rf && top > ht.pos[1] - 0.25 && top < ht.pos[1] + hgt) q[j] += 20000;
      }
  }
  return q;
}

/** Make the snow field for a world (outdoors only), with an initial depth (m). */
export function initSnow(world, depth = 0) {
  if (world.dark || world.vacuum || world.indoor) return null;
  world.snow = new SnowField(world, depth);
  return world.snow;
}

