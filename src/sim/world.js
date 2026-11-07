import { MATERIALS, MAT } from './materials.js';

// how much a voxel of each material blocks the air flow
const OCC_WEIGHT = Float32Array.from(MATERIALS, (m) => (m.burnTime > 0 ? 0.25 : m.granular ? 0.5 : 1));

export const F_LIQUID = 1; // molten / liquid, flows
export const F_FALLING = 2; // detached from structure, falls under gravity
export const F_ANCHOR = 4; // always considered supported (e.g. bolted down)
export const F_BURNING = 8; // flaming combustion
export const F_SMOLDER = 16; // pyrolysing / smoking without flame

/**
 * The world is a regular voxel grid of size nx*ny*nz with cell size h (metres).
 * Every solid voxel carries its own thermal / chemical state. On top of it
 * lives a coarser air grid (2x2x2 voxels per air cell) carrying gas temperature,
 * smoke, steam and the flame / radiation fields.
 *
 * Voxel index: i = x + nx * (y + ny * z). y is up. y = 0 is the ground layer.
 */
export class World {
  constructor({ size = [10, 6, 10], h = 0.125, ambient = 15 } = {}) {
    const nx = evenCeil(size[0] / h);
    const ny = evenCeil(size[1] / h);
    const nz = evenCeil(size[2] / h);
    this.h = h;
    this.nx = nx;
    this.ny = ny;
    this.nz = nz;
    this.N = nx * ny * nz;
    this.size = [nx * h, ny * h, nz * h];
    this.ambient = ambient;

    const N = this.N;
    this.mat = new Uint8Array(N);
    this.temp = new Float32Array(N).fill(ambient);
    this.fuel = new Float32Array(N); // remaining fuel fraction 0..1
    this.moist = new Float32Array(N); // kg water / kg dry material
    this.melt = new Float32Array(N); // melted fraction 0..1
    this.char = new Float32Array(N); // visual charring / oxidation 0..1
    this.flags = new Uint8Array(N);
    this.hrr = new Float32Array(N); // current heat release rate, W
    this.dE = new Float32Array(N); // per step energy accumulator, J
    this.dens = new Float32Array(N).fill(1); // effective density factor (thin sheets, panels)
    this.skinMelt = new Float32Array(N); // melted share of the skin layer 0..1
    this.gsum = new Float32Array(N); // core conductances (implicit update), W/K
    this.skin = new Float32Array(N).fill(ambient); // surface temperature of bulk materials
    this.dEs = new Float32Array(N); // surface energy accumulator, J
    this.wetSkin = new Float32Array(N).fill(1); // share of the skin layer still holding its water 0..1
    this.gext = new Float32Array(N); // surface conductances, W/K
    this.expo = new Uint8Array(N); // number of faces exposed to air
    this.faceAir = new Int32Array(N); // air cell receiving this voxel's flames/fumes
    this.tint = new Uint8Array(N * 3); // per voxel base colour (paint, variation)
    this.owner = new Int16Array(N).fill(-1); // scene object index

    this.solids = new Int32Array(1024);
    this.solidCount = 0;

    // Air grid
    this.af = 2;
    this.ah = h * 2;
    const anx = nx / 2;
    const any = ny / 2;
    const anz = nz / 2;
    this.anx = anx;
    this.any = any;
    this.anz = anz;
    const NA = anx * any * anz;
    this.NA = NA;
    const fa = () => new Float32Array(NA);
    this.airT = fa().fill(ambient);
    this.smoke = fa(); // kg particulate in the cell
    this.smokeR = fa(); // smoke-mass weighted colour channels
    this.smokeG = fa();
    this.smokeB = fa();
    this.steam = fa(); // kg water vapour/droplets
    this.vx = fa();
    this.vy = fa();
    this.vz = fa();
    this.occ = fa(); // solid occupancy 0..1
    this.flame = fa(); // flame presence 0..1
    this.flameAcc = fa(); // W of flaming combustion deposited this step
    this.fgas = fa(); // J of burning gas in the cell (transported, burns out in ~0.5 s)
    this.tmpG = fa();
    this.radSrc = fa(); // W emitted as radiation in this cell this step
    this.radField = fa(); // irradiance W/m² (previous step)
    this.airG = fa(); // sum of convective conductances to solids, W/K
    this.airGT = fa(); // sum G*T_solid
    this.airQ = fa(); // direct heat input, W
    this.tmpA = fa();
    this.tmpB = fa();
    this.tmpC = fa();
    this.tmpD = fa();
    this.tmpE = fa();
    this.tmpF = fa();

    this.colTop = new Int16Array(nx * nz).fill(-1);
    this.heaters = [];
    this.time = 0;
    this.geomVersion = 0;
    this.structureDirty = true;
    this.listDirty = true;
  }

  idx(x, y, z) {
    return x + this.nx * (y + this.ny * z);
  }

  inBounds(x, y, z) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.nx && y < this.ny && z < this.nz;
  }

  coords(i) {
    const nx = this.nx;
    const x = i % nx;
    const r = (i - x) / nx;
    const y = r % this.ny;
    const z = (r - y) / this.ny;
    return [x, y, z];
  }

  airIndexOfVoxel(x, y, z) {
    return (x >> 1) + this.anx * ((y >> 1) + this.any * (z >> 1));
  }

  airIdx(ax, ay, az) {
    return ax + this.anx * (ay + this.any * az);
  }

  /** World position (m) of a voxel centre. */
  center(x, y, z) {
    const h = this.h;
    return [(x + 0.5) * h, (y + 0.5) * h, (z + 0.5) * h];
  }

  voxelAt(px, py, pz) {
    const h = this.h;
    const x = Math.floor(px / h);
    const y = Math.floor(py / h);
    const z = Math.floor(pz / h);
    return this.inBounds(x, y, z) ? this.idx(x, y, z) : -1;
  }

  /**
   * Place a voxel of material `id`. Options: moisture, temp, color [r,g,b] 0..1,
   * owner, anchored, liquid, variation (0..1 colour noise).
   */
  setVoxel(i, id, o = {}) {
    const m = MATERIALS[id];
    this.mat[i] = id;
    this.temp[i] = o.temp ?? this.ambient;
    this.skin[i] = this.temp[i];
    this.wetSkin[i] = 1;
    this.dens[i] = o.density ?? 1;
    this.skinMelt[i] = 0;
    this.fuel[i] = 1;
    this.moist[i] = o.moisture ?? m.moisture;
    const liquid = o.liquid ?? m.meltingPoint < this.temp[i];
    this.melt[i] = liquid ? 1 : 0;
    this.char[i] = 0;
    this.hrr[i] = 0;
    this.flags[i] = (liquid ? F_LIQUID : 0) | (o.anchored ? F_ANCHOR : 0);
    this.owner[i] = o.owner ?? -1;
    const col = o.color ?? m.color;
    const v = o.variation ?? 0.08;
    const n = 1 + (hash3(i) - 0.5) * 2 * v;
    this.tint[i * 3] = clamp255(col[0] * n * 255);
    this.tint[i * 3 + 1] = clamp255(col[1] * n * 255);
    this.tint[i * 3 + 2] = clamp255(col[2] * n * 255);
    this.listDirty = true;
    this.structureDirty = true;
    this.geomVersion++;
  }

  clearVoxel(i) {
    this.mat[i] = 0;
    this.flags[i] = 0;
    this.fuel[i] = 0;
    this.hrr[i] = 0;
    this.owner[i] = -1;
    this.listDirty = true;
    this.structureDirty = true;
    this.geomVersion++;
  }

  /** Move a voxel's full state from i to empty cell j. */
  moveVoxel(i, j) {
    this.mat[j] = this.mat[i];
    this.temp[j] = this.temp[i];
    this.skin[j] = this.skin[i];
    this.wetSkin[j] = this.wetSkin[i];
    this.dens[j] = this.dens[i];
    this.skinMelt[j] = this.skinMelt[i];
    this.fuel[j] = this.fuel[i];
    this.moist[j] = this.moist[i];
    this.melt[j] = this.melt[i];
    this.char[j] = this.char[i];
    this.flags[j] = this.flags[i];
    this.hrr[j] = this.hrr[i];
    this.owner[j] = this.owner[i];
    this.tint[j * 3] = this.tint[i * 3];
    this.tint[j * 3 + 1] = this.tint[i * 3 + 1];
    this.tint[j * 3 + 2] = this.tint[i * 3 + 2];
    this.mat[i] = 0;
    this.flags[i] = 0;
    this.hrr[i] = 0;
    this.fuel[i] = 0;
    this.owner[i] = -1;
    this.temp[i] = this.ambient;
    this.geomVersion++;
  }

  /** Rebuild the compact list of solid voxel indices plus derived fields. */
  rebuildLists() {
    const { N, mat } = this;
    let count = 0;
    for (let i = 0; i < N; i++) if (mat[i]) count++;
    if (this.solids.length < count) this.solids = new Int32Array(Math.ceil(count * 1.25) + 64);
    let k = 0;
    for (let i = 0; i < N; i++) if (mat[i]) this.solids[k++] = i;
    this.solidCount = count;
    this.listDirty = false;
    this.updateDerived();
  }

  /** Occupancy of the air cells and the top-most solid per column (for rain). */
  updateDerived() {
    const { nx, ny, nz, anx, any, mat, occ, colTop } = this;
    occ.fill(0);
    colTop.fill(-1);
    const solids = this.solids;
    for (let k = 0; k < this.solidCount; k++) {
      const i = solids[k];
      const x = i % nx;
      const r = (i - x) / nx;
      const y = r % ny;
      const z = (r - y) / ny;
      // The ground layer is the floor of the domain, not an obstacle; porous
      // fine fuels (grass, foliage) let air through.
      if (y > 0) occ[(x >> 1) + anx * ((y >> 1) + any * (z >> 1))] += 0.125 * OCC_WEIGHT[mat[i]];
      const c = x + nx * z;
      if (y > colTop[c]) colTop[c] = y;
    }
    void mat;
    void nz;
  }

  totalSolidCount() {
    return this.solidCount;
  }
}

export function evenCeil(v) {
  let n = Math.max(4, Math.ceil(v - 1e-6));
  if (n % 2) n++;
  return n;
}

export function hash3(i) {
  let x = (i ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 4294967296;
}

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

export { MAT };
