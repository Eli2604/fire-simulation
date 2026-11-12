import { MATERIALS, MAT } from './materials.js';
import { F_LIQUID, F_ANCHOR } from './world.js';

const LV = 2.26e6;
const CW = 4186;

/**
 * Liquid water: flowing water voxels, puddles from run-off, sprinklers and
 * sea water flooding a breached hull.
 *
 *  - Water that a surface cannot absorb any more (or that runs off steel,
 *    glass...) collects per column; every voxel's worth becomes a water voxel
 *    that flows down and spreads (cellular liquid flow), filling low spots.
 *  - Water voxels soak what they touch (cooling, wetting, putting fires out),
 *    boil off as steam when heated, drain into soil.
 *  - Sprinklers: a glass bulb heats with the gas around it (response time
 *    index RTI ≈ 50 (m·s)^½) and bursts at 68 °C; the head then sprays ~60 l/min
 *    over ~12 m², cooling the gas on the way down.
 *  - Sea: below the waterline, any opening in the hull footprint fills with
 *    sea water (inflow speed √(2gΔh), Torricelli), which then floods inwards.
 */
export function stepSprinklers(sim, dt) {
  const w = sim.world;
  if (!w.sprinklers.length) return;
  const { airT, vx, vy, vz, airQ, steam, fgas, nx, ny, mat, h } = w;
  for (const s of w.sprinklers) {
    const a = sim.airCellAt(...s.p);
    if (!s.active) {
      if (a < 0) continue;
      const u = Math.max(0.3, Math.abs(vx[a]) + Math.abs(vy[a]) + Math.abs(vz[a]));
      s.bulb += (airT[a] - s.bulb) * Math.min(1, (dt * Math.sqrt(u)) / s.rti);
      if (s.bulb >= s.actT) {
        s.active = true;
        w.events.push({ type: 'sprinkler', pos: s.p, time: w.time, name: 'sprinkler' });
      }
      continue;
    }
    // spray: water over the columns within reach, some evaporating in hot gas on the way
    const cols = [];
    const r = s.radius;
    const x0 = Math.max(0, Math.floor((s.p[0] - r) / h));
    const x1 = Math.min(w.nx - 1, Math.floor((s.p[0] + r) / h));
    const z0 = Math.max(0, Math.floor((s.p[2] - r) / h));
    const z1 = Math.min(w.nz - 1, Math.floor((s.p[2] + r) / h));
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const dx = (x + 0.5) * h - s.p[0];
        const dz = (z + 0.5) * h - s.p[2];
        if (dx * dx + dz * dz <= r * r) cols.push([x, z]);
      }
    if (!cols.length) continue;
    const per = (s.rate * dt) / cols.length;
    const ys = Math.floor(s.p[1] / h);
    for (const [x, z] of cols) {
      let m = per;
      for (let y = ys; y >= 0; y--) {
        const i = x + nx * (y + ny * z);
        if (mat[i]) {
          sim.addWater(i, m);
          break;
        }
        if (y % 2 === 0) {
          const c = sim.airCellAt((x + 0.5) * h, (y + 0.5) * h, (z + 0.5) * h);
          if (c >= 0 && airT[c] > 100) {
            const e = m * Math.min(0.3, (airT[c] - 100) / 1500);
            sim.coolGas(c, e, dt, airT, airQ, steam, fgas);
            m -= e;
          }
        }
      }
    }
  }
}

/** Water voxels: boil off, soak neighbours, drain into soil; run-off becomes new water voxels. */
export function stepWater(sim, dt) {
  const w = sim.world;
  const id = MAT.water;
  const { nx, ny, nz, mat, temp, fuel, flags, solids, h, steam } = w;
  const V = h ** 3;
  const voxelMass = 1000 * V;
  const remove = [];
  for (let k = 0; k < w.solidCount; k++) {
    const i = solids[k];
    if (mat[i] !== id) continue;
    // boiling
    if (temp[i] > 100) {
      const m = fuel[i] * voxelMass;
      const ev = Math.min(m, ((temp[i] - 100) * voxelMass * CW) / LV);
      fuel[i] -= ev / voxelMass;
      temp[i] = 100;
      steam[w.faceAir[i]] += ev;
      if (fuel[i] < 0.05) remove.push(i);
    }
    // soak what it touches: cools it, wets it, puts fires out
    const x = i % nx;
    const r = (i - x) / nx;
    const y = r % ny;
    const z = (r - y) / ny;
    const nb = [x > 0 ? i - 1 : -1, x + 1 < nx ? i + 1 : -1, y > 0 ? i - nx : -1, y + 1 < ny ? i + nx : -1, z > 0 ? i - nx * ny : -1, z + 1 < nz ? i + nx * ny : -1];
    for (const j of nb) {
      if (j < 0) continue;
      const mj = mat[j];
      if (!mj || mj === id) continue;
      sim.addWater(j, 0.05 * h * h * dt * 10); // ~0.5 kg/(m²·s) of contact wetting
      // drain into the ground
      // it seeps into the soil under it (~4 mm an hour) as far as that is not wet through: a
      // pond's or a canal's bed holds its water, a puddle on dry ground soaks away
      if (j === i - nx && MATERIALS[mj].name === 'soil') {
        const Mj = MATERIALS[mj];
        const soilMass = Mj.density * V;
        const room = (Mj.maxMoisture * 0.95 - w.moist[j]) * soilMass;
        if (room > 0) {
          const take = Math.min(room, fuel[i] * voxelMass, 1e-3 * h * h * dt * (1 + 20 * Math.min(1, room / soilMass)));
          w.moist[j] += take / soilMass;
          fuel[i] -= take / voxelMass;
          if (fuel[i] < 0.05) remove.push(i);
        }
      }
    }
  }
  for (const i of remove) if (mat[i] === id) w.clearVoxel(i);

  // shallow water on the floor: spreads to neighbouring columns of the same floor height,
  // evaporates on a hot floor, soaks the base of what stands in it
  const runoffY = (w.runoffY ??= new Int16Array(nx * nz));
  const spread = Math.min(0.25, dt * 1.5);
  for (let c = 0; c < w.runoff.length; c++) {
    const r0 = w.runoff[c];
    if (r0 < 0.002) continue;
    const x = c % nx;
    const z = (c - x) / nx;
    const y = runoffY[c];
    const floor = x + nx * (y + ny * z);
    if (!mat[floor]) {
      w.runoff[c] = 0; // the floor under it is gone: it drains away
      continue;
    }
    if (temp[floor] > 100) {
      const ev = Math.min(r0, ((temp[floor] - 100) * 0.002 * dt));
      w.runoff[c] -= ev;
      steam[w.faceAir[floor]] += ev;
    }
    if (y + 1 < ny && mat[floor + nx]) sim.addWater(floor + nx, Math.min(r0, 0.002) * dt);
    sim.addWater(floor, Math.min(r0, 0.001) * dt);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx;
      const zz = z + dz;
      if (xx < 0 || zz < 0 || xx >= nx || zz >= nz) continue;
      const j = xx + nx * (y + ny * zz);
      if (!mat[j] || (y + 1 < ny && mat[j + nx])) continue; // not a floor at the same height
      const cn = xx + nx * zz;
      if (w.runoff[cn] > 0.002 && runoffY[cn] !== y) continue;
      const d = (w.runoff[c] - w.runoff[cn]) * spread;
      if (d <= 0) continue;
      w.runoff[c] -= d;
      w.runoff[cn] += d;
      runoffY[cn] = y;
    }
  }

  // run-off: a voxel's worth of water collected in a column becomes a water voxel
  const runoff = w.runoff;
  for (let c = 0; c < runoff.length; c++) {
    if (runoff[c] < voxelMass) continue;
    const x = c % nx;
    const z = (c - x) / nx;
    const y0 = w.runoffY?.[c] ?? 1;
    let placed = false;
    for (let y = Math.max(1, y0 + 1); y < Math.min(ny, y0 + 6); y++) {
      const i = x + nx * (y + ny * z);
      if (!mat[i]) {
        w.setVoxel(i, id, { temp: w.ambient + 2, variation: 0.03 });
        placed = true;
        break;
      }
    }
    runoff[c] = placed ? runoff[c] - voxelMass : Math.min(runoff[c], voxelMass);
  }
}

/**
 * Burst water pipes: each pours `rate` litres a second. The water comes out as
 * water voxels next to the break (it then falls, spreads over the floor and
 * collects, like any other water), and wets and cools what is right under it.
 */
export function stepLeaks(sim, dt) {
  const w = sim.world;
  if (!w.leaks.length) return;
  const { nx, ny, nz, mat, h } = w;
  const litres = h * h * h * 1000;
  for (const l of w.leaks) {
    l.acc += l.rate * dt;
    const x = Math.min(nx - 1, Math.max(0, Math.floor(l.p[0] / h)));
    const z = Math.min(nz - 1, Math.max(0, Math.floor(l.p[2] / h)));
    let y = Math.min(ny - 1, Math.max(0, Math.floor(l.p[1] / h)));
    // the first free cell at or under the break (the pipe itself, or just below it)
    while (y > 0 && mat[x + nx * (y + ny * z)] && mat[x + nx * (y + ny * z)] !== MAT.water) y--;
    while (l.acc >= litres) {
      // spread a little around the jet so it does not stack in one column
      const xx = Math.min(nx - 1, Math.max(0, x + Math.round((sim.rand() - 0.5) * 2)));
      const zz = Math.min(nz - 1, Math.max(0, z + Math.round((sim.rand() - 0.5) * 2)));
      let j = -1;
      for (let yy = y; yy < ny; yy++) {
        const k = xx + nx * (yy + ny * zz);
        if (!mat[k]) {
          j = k;
          break;
        }
        if (mat[k] !== MAT.water) break;
      }
      if (j < 0) {
        l.acc = 0; // nowhere to go (it is all water around the break): the room is flooded up to here
        break;
      }
      w.setVoxel(j, MAT.water, { temp: w.ambient, variation: 0.03 });
      l.acc -= litres;
    }
    // the spray wets and cools what is under the break
    if (sim.rand() < dt * 2) sim.douse([l.p[0], Math.max(h, l.p[1] - 0.6), l.p[2]], 0.5, Math.min(5, l.rate * 0.3));
  }
}

const RHO_SEA = 1025;

/** The sea level against the hull at (x, z): higher where the ship has settled (it lists and trims). */
export function seaLevelAt(sea, x, z) {
  const cx = (sea.box[0] + sea.box[2]) / 2;
  const cz = (sea.box[1] + sea.box[3]) / 2;
  return sea.level + (sea.slopeX ?? 0) * (x - cx) + (sea.slopeZ ?? 0) * (z - cz);
}

/**
 * A ship floats where its weight equals the weight of the sea it displaces
 * (Archimedes). Water that comes aboard adds its weight: the ship settles deeper by
 * m / (ρ_sea · A_waterplane) until it balances again, and since the water lies off
 * the centre line (where the hole is) it lists and trims:
 *   tan θ = m · offset / (Δ · GM),  GM = KB + BM − KG,  KB = T/2,  BM = B² / (12 T)
 * (T the draft, B the beam, or L the length for trim; KG the centre of gravity
 * above the keel). Here the ship stays still in its own frame and the sea moves
 * instead: its level rises up the hull and its surface tilts against it. That puts
 * the holes deeper, so the sea comes in faster: the flooding feeds itself. When the
 * sea reaches the deck edge the ship loses its last reserve of buoyancy and founders:
 * the sea pours in over the deck until it is gone.
 */
export function stepBuoyancy(sim, dt) {
  const w = sim.world;
  const sea = w.sea;
  const S = sea?.ship;
  if (!S) return;
  const [bx0, bz0, bx1, bz1] = sea.box;
  const L = S.length ?? bx1 - bx0;
  const B = S.beam ?? bz1 - bz0;
  const A = S.waterplane ?? L * B;
  S.level0 ??= sea.level;
  const T0 = Math.max(0.3, S.level0 - S.keel);
  S.mass0 ??= S.displacement ?? RHO_SEA * A * T0;
  // the water aboard: how much, and where its centre is
  const { solids, mat, nx, ny, h } = w;
  const id = MAT.water;
  const V = h * h * h * 1000;
  let m = 0;
  let mx = 0;
  let mz = 0;
  for (let k = 0; k < w.solidCount; k++) {
    const i = solids[k];
    if (mat[i] !== id) continue;
    const x = ((i % nx) + 0.5) * h;
    const z = (Math.floor(i / (nx * ny)) + 0.5) * h;
    if (x < bx0 || x > bx1 || z < bz0 || z > bz1) continue;
    m += V;
    mx += V * x;
    mz += V * z;
  }
  S.water = m;
  const cx = (bx0 + bx1) / 2;
  const cz = (bz0 + bz1) / 2;
  const disp = S.mass0 + m;
  const T = T0 + m / (RHO_SEA * A); // the new draft
  const KG = S.kg ?? (S.deck - S.keel) * 0.55;
  const gm = (b) => Math.max(0.3, T / 2 + (b * b) / (12 * T) - KG);
  const lim = Math.tan((25 * Math.PI) / 180);
  let heel = m > 0 ? (m * (mz / m - cz)) / (disp * gm(B)) : 0;
  let trim = m > 0 ? (m * (mx / m - cx)) / (disp * gm(L)) : 0;
  heel = Math.max(-lim, Math.min(lim, heel));
  trim = Math.max(-lim, Math.min(lim, trim));
  // settle towards the balance (a ship takes some seconds to come to rest)
  const k = 1 - Math.exp(-dt / 4);
  let target = S.keel + T;
  // foundering: the sea is over the deck edge somewhere: no reserve buoyancy left
  const edge = Math.max(...[[bx0, bz0], [bx1, bz0], [bx0, bz1], [bx1, bz1]].map(([x, z]) => seaLevelAt(sea, x, z)));
  if (!S.foundering && edge > S.deck) {
    S.foundering = true;
    w.events.push({ type: 'foundering', pos: [cx, S.deck, cz], time: w.time, name: 'the ship' });
  }
  // going down, until it is under (the sea over the top of the world)
  if (S.foundering) target = Math.min(w.size[1] + 1, Math.max(target, sea.level + 0.25 * dt * 20));
  sea.level += (target - sea.level) * k;
  sea.slopeZ = (sea.slopeZ ?? 0) + (heel - (sea.slopeZ ?? 0)) * k;
  sea.slopeX = (sea.slopeX ?? 0) + (trim - (sea.slopeX ?? 0)) * k;
  S.heelDeg = (Math.atan(sea.slopeZ) * 180) / Math.PI;
  S.trimDeg = (Math.atan(sea.slopeX) * 180) / Math.PI;
  S.sunk = sea.level - S.level0;
  void ny;
}

/**
 * Sea water pours in through any opening in the hull below the waterline.
 *
 * Each hole lets in Cd·A·√(2 g Δh) (Torricelli), Δh being how far the sea level
 * is above the water already standing inside the hole (or above the hole itself
 * while the inside is still dry): the inflow slows as the compartment fills, and
 * stops when the inside level reaches the sea. The water goes where the sea
 * pushes it: into the lowest free cells of the space connected to the hole (a
 * flood fill through air and water, stopped by walls and closed doors), so the
 * room fills from the bottom up at the rate the holes allow.
 *
 * A sealed space (no way out for its air) only fills until its air is squeezed to
 * the sea pressure at that depth (Boyle): the air pocket stays, compressed.
 * Where it comes in, the water is a jet: `w.inflows` (position, inward direction,
 * speed) for the people in the way and for drawing it.
 */
export function stepFlood(sim, dt) {
  const w = sim.world;
  const sea = w.sea;
  if (!sea) return;
  const { nx, ny, nz, mat, h } = w;
  const id = MAT.water;
  const x0 = Math.max(0, Math.floor(sea.box[0] / h));
  const x1 = Math.min(nx - 1, Math.floor(sea.box[2] / h) - 1);
  const z0 = Math.max(0, Math.floor(sea.box[1] / h));
  const z1 = Math.min(nz - 1, Math.floor(sea.box[3] / h) - 1);
  stepBuoyancy(sim, dt); // the ship settles, lists and trims with the water aboard
  const lvl = (x, z) => seaLevelAt(sea, x, z);
  const seaTop = Math.max(sea.level, ...[[sea.box[0], sea.box[1]], [sea.box[2], sea.box[1]], [sea.box[0], sea.box[3]], [sea.box[2], sea.box[3]]].map(([x, z]) => lvl(x, z)));
  const yTop = Math.min(ny - 1, Math.floor(seaTop / h));
  const nxy = nx * ny;
  // cells outside the hull below the waterline are the sea itself (redone as the level rises)
  if (!w.seaMask || w._seaMaskTop !== yTop) {
    w._seaMaskTop = yTop;
    w.seaMask ??= new Uint8Array(w.N);
    w.seaMask.fill(0);
    for (let z = 0; z < nz; z++)
      for (let y = 0; y <= yTop; y++)
        for (let x = 0; x < nx; x++) if ((x < x0 || x > x1 || z < z0 || z > z1) && (y + 0.5) * h < lvl((x + 0.5) * h, (z + 0.5) * h)) w.seaMask[x + nx * (y + ny * z)] = 1;
  }
  const cx = (sea.box[0] + sea.box[2]) / 2;
  const cz = (sea.box[1] + sea.box[3]) / 2;
  w.inflows = [];
  // the holes: hull plating gone below the waterline, with the cell just inside
  const seeds = [];
  let units = 0;
  for (const i of w.hull ?? []) {
    if (mat[i] && mat[i] !== id) continue;
    const x = i % nx;
    const y = Math.floor(i / nx) % ny;
    const z = Math.floor(i / nxy);
    if (y > yTop) continue;
    const here = lvl((x + 0.5) * h, (z + 0.5) * h);
    const depth = here - (y + 0.5) * h;
    if (depth <= 0) continue;
    // inward: away from the nearest hull face (up through a hole in the bottom)
    const px = (x + 0.5) * h;
    const pz = (z + 0.5) * h;
    const fx = Math.abs(px - cx) / ((sea.box[2] - sea.box[0]) / 2);
    const fz = Math.abs(pz - cz) / ((sea.box[3] - sea.box[1]) / 2);
    let dx = 0, dy = 0, dz = 0;
    if (y <= 1 + (w.hullBottom ?? 1) && fx < 0.98 && fz < 0.98) dy = 1;
    else if (fx > fz) dx = px > cx ? -1 : 1;
    else dz = pz > cz ? -1 : 1;
    // the water standing inside, over the hole
    let top = y;
    while (top + 1 < ny && mat[x + dx + nx * (top + 1 + dy) + nxy * (z + dz)] === id) top++;
    const inside = mat[x + dx + nx * (y + dy) + nxy * (z + dz)] === id ? (top + 1) * h : (y + 0.5) * h;
    const head = here - Math.max(inside, (y + 0.5) * h);
    if (head <= 0) continue;
    const v = Math.sqrt(2 * 9.81 * head);
    units += (0.62 * v * dt) / h; // Cd 0.62 for a sharp-edged hole: m³ through h² per step, in voxels
    seeds.push(i);
    w.inflows.push({ p: [px, (y + 0.5) * h, pz], dir: [dx, dy, dz], speed: v });
  }
  if (sea.ship?.foundering) {
    // over the deck edge: the sea pours in from above, everywhere along the sides
    for (let x = x0; x <= x1; x++)
      for (const z of [z0, z1]) {
        const top = Math.min(ny - 1, Math.floor(lvl((x + 0.5) * h, (z + 0.5) * h) / h));
        for (let y = Math.floor(sea.ship.deck / h); y <= top; y++) {
          const i = x + nx * (y + ny * z);
          if (!mat[i]) {
            seeds.push(i);
            units += (0.5 * Math.sqrt(2 * 9.81 * Math.max(0.05, (top - y) * h)) * dt) / h;
            break;
          }
        }
      }
  }
  let inflow = 0;
  if (seeds.length && units > 0) {
    // the space the sea reaches through the holes (air and water, inside the hull)
    const seen = (w._floodSeen ??= new Uint32Array(w.N));
    const stamp = (w._floodStamp = ((w._floodStamp ?? 0) + 1) >>> 0);
    const queue = (w._floodQ ??= new Int32Array(Math.min(w.N, 400000)));
    const byY = Array.from({ length: ny }, () => []);
    let qh = 0;
    let qt = 0;
    let waterCells = 0;
    let airCells = 0;
    let open = false; // does the air of this space connect to the outside?
    for (const i of seeds) {
      seen[i] = stamp;
      queue[qt++] = i;
    }
    while (qh < qt && qt < queue.length - 6) {
      const i = queue[qh++];
      const x = i % nx;
      const y = Math.floor(i / nx) % ny;
      const z = Math.floor(i / nxy);
      if (mat[i] === id) waterCells++;
      else if (!w.seaMask[i]) {
        airCells++;
        if (!open) {
          const a = (x >> 1) + w.anx * ((y >> 1) + w.any * (z >> 1));
          const k = w.region?.[a] ?? -1;
          if (y === ny - 1 || (k >= 0 && w.regionOpen[k])) open = true;
        }
        // the sea pushes the water up to its own level, no higher
        if ((y + 0.5) * h < lvl((x + 0.5) * h, (z + 0.5) * h)) byY[y].push(i);
      }
      const nb = [x > x0 ? i - 1 : -1, x < x1 ? i + 1 : -1, y > 0 ? i - nx : -1, y + 1 < ny ? i + nx : -1, z > z0 ? i - nxy : -1, z < z1 ? i + nxy : -1];
      for (const j of nb) {
        if (j < 0 || seen[j] === stamp) continue;
        if (mat[j] && mat[j] !== id) continue; // a wall, a closed door
        if (w.seaMask[j]) continue;
        seen[j] = stamp;
        queue[qt++] = j;
      }
    }
    // a sealed space: its air can only be squeezed so far (Boyle)
    let allowed = Infinity;
    if (!open) {
      // Boyle: the air left ≥ its first volume · p0 / (p0 + ρ g Δh), Δh from the sea level down to the water inside
      w._floodAir0 ??= new Map();
      const key = seeds[0];
      if (!w._floodAir0.has(key)) w._floodAir0.set(key, airCells);
      const air0 = w._floodAir0.get(key);
      let levelIn = 0;
      for (let y = 0; y < ny; y++) if (byY[y].length) {
        levelIn = y * h;
        break;
      }
      const dh = Math.max(0, sea.level - levelIn);
      const minAir = air0 * (101325 / (101325 + 1000 * 9.81 * dh));
      allowed = Math.max(0, Math.floor(airCells - minAir));
    }
    let n = Math.min(Math.floor(units) + (sim.rand() < units % 1 ? 1 : 0), allowed);
    // fill from the bottom up
    for (let y = 0; y < ny && n > 0; y++) {
      const row = byY[y];
      for (let k = 0; k < row.length && n > 0; k++) {
        w.setVoxel(row[k], id, { temp: w.ambient - 3, variation: 0.03 });
        inflow++;
        n--;
      }
    }
  }
  // water that ends up outside the hull, down in the sea, rejoins it (not a pond or a canal on
  // an island, above the sea: an island's sea box is empty, it has no hull)
  for (let k = 0; k < w.solidCount; k++) {
    const i = w.solids[k];
    if (mat[i] !== id) continue;
    const x = i % nx;
    const z = Math.floor(i / nxy);
    if (!(x < x0 || x > x1 || z < z0 || z > z1)) continue;
    const y = Math.floor(i / nx) % ny;
    if (y * h <= lvl((x + 0.5) * h, (z + 0.5) * h)) w.clearVoxel(i);
  }
  sim.stats.flooding = inflow;
}

/** Water arriving at a hot brittle surface cracks it (thermal shock); soaked boards and tiles go soft. */
export function waterDamage(sim, i, M, Ts, water, dt, A) {
  const w = sim.world;
  if (M.brittle && water > 0 && Ts > 220) {
    const flux = water / (A * dt);
    w.crack[i] += Math.min(1, (Ts - 220) / 400) * Math.min(1, flux / 0.004) * dt * 0.6;
    if (w.crack[i] >= 1) return true;
  }
  return false;
}

export { F_LIQUID, F_ANCHOR };
