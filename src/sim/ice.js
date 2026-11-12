import { MATERIALS } from './materials.js';

/**
 * Ice on still and running water: ponds, the canal, rivers, and the sea where it is
 * sheltered (a bay, an inlet, along the shore; not the open sea, whose waves break it up).
 *
 * Per voxel column whose top is water open to the air above (a tree over it is no roof),
 * or the sea over the ground below its level: the thickness of the ice on it (m). The water
 * under it stays water (it flows on, under the ice). Salt water freezes at -1.8 °C.
 *
 *  - It forms when the air is below freezing. Open water loses heat to the cold air (more in
 *    a wind) and to a clear sky, and a skin of ice forms, first along the banks (shallow,
 *    still). It then thickens from below, slower the thicker it is: the heat has to get out
 *    through the ice (Stefan's law). At -10 °C that is ~3 mm an hour at first; a hard frost
 *    of a few days makes 10-20 cm. (Weather `iceSpeed` runs it faster, to watch it.)
 *  - It melts from the top in air above freezing, in the sun (bare ice keeps about half of
 *    it), in a fire's heat (its radiation, hot gas), and from below where the water under it
 *    is warmer than ~1 °C (lava running into the river).
 *  - It bears a load as ice does (Gold's rule): P = A·h², A ≈ 4 kg/cm², h in cm. About 5 cm
 *    bears a firefighter in full gear (110 kg) but only just: it creaks and cracks and can
 *    give; 10 cm is safe; a dragon of a few tonnes needs ~30 cm. Too thin for what stands on
 *    it, it breaks: a hole, open water, that skins over again in the cold.
 *  - A blast breaks it round the crater.
 */
export const ICE = {
  rho: 917, // kg/m³
  latent: 334e3, // J/kg
  k: 2.2, // W/(m·K) conductivity
  A: 4, // kg/cm² in Gold's rule (between the safe 3.5 and the failing ~7)
};

/** What an ice sheet of thickness d (m) bears (kg). */
export function iceBears(d) {
  const cm = d * 100;
  return ICE.A * cm * cm;
}

const SEA = -2;
// (a tree's crown or a limb over the water is no roof over it)
const TREE = new Set(['leaves', 'needles', 'twigs', 'oak', 'pine', 'willow', 'bark', 'deadWood']);

export class IceField {
  constructor(world, thick = 0) {
    const n = world.nx * world.nz;
    this.thick = new Float32Array(n);
    this.top = new Int32Array(n).fill(-1); // the top water voxel of the column (-1: no open water; SEA: the sea)
    this.surf = new Float32Array(n); // height of the water's surface (the ice's top)
    this.shelter = new Float32Array(n).fill(1); // the sea: how sheltered (land round it); 1 for fresh water
    this.bank = new Uint8Array(n); // a bank next to it (shallow, still: it freezes first)
    this.stress = new Float32Array(n); // how near it is to giving (what stands on it, over time)
    this.version = 0;
    this.acc = 0;
    this.layout(world);
    if (thick > 0) for (let c = 0; c < n; c++) if (this.top[c] !== -1) this.thick[c] = thick * (this.bank[c] ? 1.1 : 1) * (this.top[c] === SEA ? 0.5 + 0.5 * this.shelter[c] : 1);
    this.seenGeom = world.geomVersion;
  }

  /** Which columns have open water at the top (after the scene's shape or its water changed). */
  layout(w) {
    const { nx, nz, colTop, mat, h } = w;
    const water = MATERIALS.findIndex((m) => m.name === 'water');
    const S = w.sea && !w.vacuum ? w.sea : null;
    const sea = S?.level ?? -Infinity;
    for (let cz = 0; cz < nz; cz++)
      for (let cx = 0; cx < nx; cx++) {
        const c = cx + nx * cz;
        let found = -1;
        let ground = -1;
        // from the top down, past a tree's crown and limbs over it: the first thing is water
        for (let y = Math.min(w.ny - 1, colTop[c] + 1); y >= 0; y--) {
          const m = mat[w.idx(cx, y, cz)];
          if (!m) continue;
          if (TREE.has(MATERIALS[m].name)) continue;
          if (m === water && (y + 1) * h > sea + 0.05) found = w.idx(cx, y, cz);
          else ground = (y + 1) * h;
          break;
        }
        // the sea over ground below its level (inside the world: the shore, a bay, the canal)
        const inHull = S?.box && (cx + 0.5) * h > S.box[0] && (cx + 0.5) * h < S.box[2] && (cz + 0.5) * h > S.box[1] && (cz + 0.5) * h < S.box[3];
        if (found < 0 && S && !inHull && ground < sea - 0.1) {
          this.top[c] = SEA;
          this.surf[c] = sea;
          continue;
        }
        if (found < 0) {
          // (the water that was here is gone: so is its ice)
          this.top[c] = -1;
          this.thick[c] = 0;
          continue;
        }
        this.top[c] = found;
        this.surf[c] = (Math.floor(found / nx) % w.ny + 1) * h;
      }
    // the sea: how sheltered each place is (the share of land within ~6 m): ice holds in an
    // inlet or a canal, along the shore; out in the open the waves keep breaking it up
    const R = Math.max(2, Math.round(6 / h));
    const land = new Float32Array((nx + 1) * (nz + 1)); // summed-area table of land columns
    for (let z = 0; z < nz; z++)
      for (let x = 0; x < nx; x++) {
        const v = this.top[x + nx * z] === SEA ? 0 : 1;
        land[x + 1 + (nx + 1) * (z + 1)] = v + land[x + (nx + 1) * (z + 1)] + land[x + 1 + (nx + 1) * z] - land[x + (nx + 1) * z];
      }
    for (let cz = 0; cz < nz; cz++)
      for (let cx = 0; cx < nx; cx++) {
        const c = cx + nx * cz;
        if (this.top[c] !== SEA) {
          this.shelter[c] = 1;
          continue;
        }
        const x0 = Math.max(0, cx - R), x1 = Math.min(nx, cx + R + 1), z0 = Math.max(0, cz - R), z1 = Math.min(nz, cz + R + 1);
        const sum = land[x1 + (nx + 1) * z1] - land[x0 + (nx + 1) * z1] - land[x1 + (nx + 1) * z0] + land[x0 + (nx + 1) * z0];
        // (the world's edge is open sea beyond)
        const all = (2 * R + 1) ** 2;
        this.shelter[c] = Math.min(1, (sum / all) * 2.2);
        if (this.shelter[c] < 0.3) {
          this.top[c] = -1;
          this.thick[c] = 0;
        }
      }
    for (let cz = 0; cz < nz; cz++)
      for (let cx = 0; cx < nx; cx++) {
        const c = cx + nx * cz;
        if (this.top[c] === -1) continue;
        let b = 0;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const X = cx + dx;
          const Z = cz + dz;
          if (X < 0 || Z < 0 || X >= nx || Z >= nz) continue;
          if (this.top[X + nx * Z] === -1) b = 1;
        }
        this.bank[c] = b;
      }
    this.version++;
  }

  col(w, x, z) {
    const cx = Math.floor(x / w.h);
    const cz = Math.floor(z / w.h);
    if (cx < 0 || cz < 0 || cx >= w.nx || cz >= w.nz) return -1;
    return cx + w.nx * cz;
  }

  /** The ice at (x, z) and the height of its top, or null where there is none. */
  at(w, x, z) {
    const c = this.col(w, x, z);
    if (c < 0 || this.top[c] === -1 || this.thick[c] <= 0) return null;
    return { c, thick: this.thick[c], y: this.surf[c], sea: this.top[c] === SEA };
  }

  /** On the sea (no voxel there): is (x, y, z) in ice that bears `kg`? (A floor at the sea's level.) */
  seaBears(w, x, y, z, kg) {
    const c = this.col(w, x, z);
    if (c < 0 || this.top[c] !== SEA) return false;
    return y < this.surf[c] && y > this.surf[c] - Math.max(0.25, this.thick[c]) && iceBears(this.thick[c]) >= kg;
  }

  /** Is voxel i the water under ice that bears `kg`? (Then it is a floor: its top is the ice.) */
  bearsAt(w, i, kg) {
    const c = i % w.nx + w.nx * Math.floor(i / (w.nx * w.ny));
    return this.top[c] === i && iceBears(this.thick[c]) >= kg;
  }

  /** It breaks: no ice within r of (x, z), open water (it skins over again in the cold). */
  breakAt(w, x, z, r) {
    const h = w.h;
    const n = Math.ceil(r / h);
    const cx0 = Math.floor(x / h);
    const cz0 = Math.floor(z / h);
    let broke = 0;
    for (let dz = -n; dz <= n; dz++)
      for (let dx = -n; dx <= n; dx++) {
        const X = cx0 + dx;
        const Z = cz0 + dz;
        if (X < 0 || Z < 0 || X >= w.nx || Z >= w.nz) continue;
        if (Math.hypot((X + 0.5) * h - x, (Z + 0.5) * h - z) > r + h * 0.5) continue;
        const c = X + w.nx * Z;
        if (this.thick[c] > 0) broke++;
        this.thick[c] = 0;
        this.stress[c] = 0;
      }
    if (broke) {
      this.version++;
      if (w.snow) w.snow.seenGeom = -1; // (the snow on it goes into the water)
      w.events.push({ type: 'iceBreak', pos: [x, this.at(w, x, z)?.y ?? 0, z], time: w.time, name: 'the ice', r });
    }
    return broke;
  }

  /**
   * `kg` standing on the ice at (x, z) for dt (`moving`: walking on it, which loads it more).
   * Returns 'holds' | 'creaks' (it bears it, only just: it cracks, it can give) | 'breaks'.
   */
  load(w, x, z, kg, dt, moving = false) {
    const ice = this.at(w, x, z);
    if (!ice) return 'none';
    const L = (kg * (moving ? 1.25 : 1)) / iceBears(ice.thick);
    const c = ice.c;
    if (L > 1) {
      this.breakAt(w, x, z, 0.6 + 0.3 * Math.min(2, L));
      return 'breaks';
    }
    if (L > 0.6) {
      // near what it bears: it gives after a while (sooner the nearer)
      this.stress[c] += dt * (L - 0.6) * 2.5;
      if (this.stress[c] > 1) {
        this.breakAt(w, x, z, 0.8);
        return 'breaks';
      }
      return 'creaks';
    }
    this.stress[c] = Math.max(0, this.stress[c] - dt * 0.2);
    return 'holds';
  }
}

/** Make the ice field for a world (outdoors, where there is fresh water), with an initial thickness (m). */
export function initIce(world, thick = 0) {
  if (world.dark || world.vacuum || world.indoor) return null;
  const f = new IceField(world, thick);
  if (!f.top.some((v) => v >= 0)) return null;
  world.ice = f;
  return f;
}

/** One step of the ice: it forms, thickens and melts (every ~0.5 s of scene time), and breaks in blasts. */
export function stepIce(sim, dt, D) {
  const w = sim.world;
  const I = w.ice;
  if (!I) return;
  for (I.seenEvents ??= w.events.length; I.seenEvents < w.events.length; I.seenEvents++) {
    const e = w.events[I.seenEvents];
    if (e.type !== 'explosion') continue;
    // (a grenade on the ice: a hole a couple of metres across, the sheet cracked round it)
    const r = Math.max(0.8, (e.radius ?? 1) * 0.45);
    const ice = I.at(w, e.pos[0], e.pos[2]);
    if (ice && Math.abs(e.pos[1] - ice.y) < r) I.breakAt(w, e.pos[0], e.pos[2], r * Math.max(0.3, 1 - Math.abs(e.pos[1] - ice.y) / r));
  }
  I.acc += dt;
  if (I.acc < 0.5) return;
  const T = I.acc * Math.max(1, sim.weather.iceSpeed ?? 1);
  I.acc = 0;
  if (w.geomVersion !== I.seenGeom) {
    if (w.listDirty) w.rebuildLists();
    I.layout(w);
    I.seenGeom = w.geomVersion;
  }
  const solar = w.dark || w.indoor ? 0 : D.solar ?? 0;
  const skyLoss = 40 * Math.min(1, solar / 500) + 5 + (sim.weather.rain > 0 ? 0 : 25); // (a clear night sky takes the most)
  const { thick, top, bank } = I;
  const { airT, radField, temp, vx, vz } = w;
  const RL = ICE.rho * ICE.latent;
  let changed = false;
  for (let c = 0; c < top.length; c++) {
    const i = top[c];
    if (i === -1) continue;
    const sea = i === SEA;
    const x = c % w.nx;
    const z = Math.floor(c / w.nx);
    const a = sim.airCellAt((x + 0.5) * w.h, I.surf[c] + 0.2 * w.h, (z + 0.5) * w.h);
    if (a < 0) continue;
    const Ta = airT[a];
    const wind = Math.hypot(vx[a], vz[a]);
    const hc = 8 + 4 * wind;
    let d = thick[c];
    // the heat the surface gets (W/m²): the sun through what the ice sends back (bare ice
    // about half, open water little), the air, the sky it loses heat to, a fire's infrared
    const albedo = d > 0.005 ? 0.45 : 0.1;
    const sun = (1 - albedo) * solar * (d > 0.005 ? 0.5 : 0.2); // (most of the sun into open water warms it deep down)
    // the temperature the surface would come to with the air, the sun and the sky (sol-air)
    // (salt water freezes at -1.8 °C)
    const Te = Ta + (sun - skyLoss) / hc + (sea ? 1.8 : 0);
    let dd = 0;
    if (Te < 0) {
      // freezing: the heat out of the water at 0 °C, through the ice and into the air
      const q = -Te / (d / ICE.k + 1 / hc);
      dd = ((q * T) / RL) * (bank[c] ? 1.3 : 1) * (sea ? I.shelter[c] * 0.7 : 1); // (the sea: the swell, its salt)
      // (open water must be cooled to freezing first: a skin only forms once the air is well under)
      if (d <= 0 && Ta > (sea ? -2.3 : -0.5)) dd = 0;
    } else if (d > 0) dd = -((hc * Te) * T) / RL;
    if (d > 0) dd -= ((0.9 * radField[a]) * T) / RL; // a fire's heat melts it
    // the water under it, warmer than freezing (lava in the river): from below
    const Tw = sea ? 2 : temp[i];
    if (d > 0 && Tw > 1 && !sea) dd -= ((400 * (Tw - 1)) * T) / RL;
    if (!dd) continue;
    const nd = Math.max(0, Math.min(1.5, d + dd));
    // (drawn in steps of a few mm: only then the mesh is rebuilt)
    if (Math.floor(nd * 300) !== Math.floor(d * 300) || (nd > 0) !== (d > 0)) changed = true;
    if ((nd > 0.03) !== (d > 0.03) && w.snow) w.snow.seenGeom = -1;
    thick[c] = nd;
  }
  if (changed) I.version++;
}
