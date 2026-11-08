import { MATERIALS, MAT } from './materials.js';

// how much a voxel of each material blocks the air flow
const OCC_WEIGHT = Float32Array.from(MATERIALS, (m) => (m.burnTime > 0 ? 0.25 : m.granular ? 0.5 : 1));

export const F_LIQUID = 1; // molten / liquid, flows
export const F_FALLING = 2; // detached from structure, falls under gravity
export const F_ANCHOR = 4; // always considered supported (e.g. bolted down)
export const F_BURNING = 8; // flaming combustion
export const F_SMOLDER = 16; // pyrolysing / smoking without flame
export const F_BROKEN = 32; // has broken away once (a fallen branch, a dropped tile): does not break again

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
    this.coat = new Float32Array(N); // foam / powder blanket 0..1 (smothers, insulates)
    this.waterIn = new Float32Array(N); // kg of water arriving this step (rain, extinguisher)
    this.sfac = new Float32Array(N).fill(1); // combustion suppression factor 0..1 (1 = free burning)
    this.vesselTag = new Int16Array(N); // +k: shell of vessel k-1, -k: its contents
    this.group = new Int32Array(N); // rigid panels (ceiling tiles): voxels of different groups do not hold each other up
    this.paint = new Uint8Array(N); // 0 never painted, 1 paint gone (bare), 2..255 paint condition (255 = intact)
    this.crack = new Float32Array(N); // thermal-shock cracking 0..1 (1 = breaks off)
    this.pickupTag = new Int16Array(N); // voxels of an item that can be picked up (k+1)
    this.groupCounter = 0;
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
    // open fraction (0..1) of the face between an air cell and its +x / +y / +z neighbour:
    // a wall one voxel thick sits inside a 2-voxel air cell, so occupancy alone lets
    // gas through it; these block exactly the faces a wall closes
    this.passX = fa().fill(1);
    this.passY = fa().fill(1);
    this.passZ = fa().fill(1);
    this.capped = new Uint8Array(NA); // 1 if there is a (nearly) closed ceiling somewhere above this cell
    this.flame = fa(); // flame presence 0..1
    this.flameAcc = fa(); // W of flaming combustion deposited this step
    this.fgas = fa(); // J of burning gas in the cell (transported, burns out in ~0.5 s)
    this.tmpG = fa();
    this.supp = fa(); // flame suppression in the gas: CO2 (inerting) or dry powder (inhibition), 1 = fully suppressed
    this.tmpH = fa();
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
    this.vessels = []; // pressure vessels (fuel tanks, gas cylinders), see vessels.js
    this.debris = []; // flying fragments after an explosion
    this.gasPipes = []; // { voxels, power }: gas lines that can burst (blast, heat)
    this.projectiles = []; // thrown grenades
    this.sprinklers = []; // { p, bulb, actT, rti, rate, radius, active }
    this.pickups = []; // { type, agent?, capacity?, length?, p, taken }
    this.pool = new Float32Array(nx * nz); // standing water depth on the floor, m
    this.floorTop = new Int16Array(nx * nz); // first empty voxel above the floor in each column
    this.floorVersion = -1;
    this.events = []; // { type: 'explosion' | 'leak' | 'vent', pos, time, ... } for the renderer/HUD
    this.waterList = [];
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
    this.coat[i] = 0;
    this.vesselTag[i] = o.vesselTag ?? 0;
    this.group[i] = o.group ?? 0;
    this.paint[i] = o.paint ? 255 : 0;
    this.crack[i] = 0;
    this.pickupTag[i] = o.pickupTag ?? 0;
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
    this.vesselTag[i] = 0;
    this.coat[i] = 0;
    this.group[i] = 0;
    this.paint[i] = 0;
    this.crack[i] = 0;
    this.pickupTag[i] = 0;
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
    this.coat[j] = this.coat[i];
    this.vesselTag[j] = this.vesselTag[i];
    this.vesselTag[i] = 0;
    this.group[j] = this.group[i];
    this.group[i] = 0;
    this.paint[j] = this.paint[i];
    this.paint[i] = 0;
    this.crack[j] = this.crack[i];
    this.crack[i] = 0;
    this.pickupTag[j] = this.pickupTag[i];
    this.pickupTag[i] = 0;
    this.coat[i] = 0;
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
    this.updatePass();
    void mat;
    void nz;
  }

  /** Open fraction of every air-cell face, from the voxel pairs on both sides of it. */
  updatePass() {
    const { nx, ny, nz, anx, any, anz, mat, passX, passY, passZ } = this;
    const nxy = nx * ny;
    const blocks = (i) => mat[i] !== 0 && OCC_WEIGHT[mat[i]] >= 1; // porous fuels let gas through
    for (let az = 0; az < anz; az++)
      for (let ay = 0; ay < any; ay++)
        for (let ax = 0; ax < anx; ax++) {
          const a = ax + anx * (ay + any * az);
          // +x face: voxel columns 2ax+1 | 2ax+2
          let open = 0;
          if (ax + 1 < anx) {
            const x1 = 2 * ax + 1;
            for (let dy = 0; dy < 2; dy++)
              for (let dz = 0; dz < 2; dz++) {
                const i = x1 + nx * (2 * ay + dy) + nxy * (2 * az + dz);
                if (!blocks(i) && !blocks(i + 1)) open++;
              }
            passX[a] = open / 4;
          } else passX[a] = 1;
          open = 0;
          if (ay + 1 < any) {
            const y1 = 2 * ay + 1;
            for (let dx = 0; dx < 2; dx++)
              for (let dz = 0; dz < 2; dz++) {
                const i = 2 * ax + dx + nx * y1 + nxy * (2 * az + dz);
                if (!blocks(i) && !blocks(i + nx)) open++;
              }
            passY[a] = open / 4;
          } else passY[a] = 1;
          open = 0;
          if (az + 1 < anz) {
            const z1 = 2 * az + 1;
            for (let dx = 0; dx < 2; dx++)
              for (let dy = 0; dy < 2; dy++) {
                const i = 2 * ax + dx + nx * (2 * ay + dy) + nxy * z1;
                if (!blocks(i) && !blocks(i + nxy)) open++;
              }
            passZ[a] = open / 4;
          } else passZ[a] = 1;
        }
    // which cells have a ceiling above them (smoke collects and the layer deepens there)
    const capped = this.capped;
    for (let az = 0; az < anz; az++)
      for (let ax = 0; ax < anx; ax++) {
        let cap = 0;
        for (let ay = any - 1; ay >= 0; ay--) {
          const a = ax + anx * (ay + any * az);
          if (passY[a] < 0.3 && ay + 1 < any) cap = 1;
          capped[a] = cap;
        }
      }
    void ny;
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
