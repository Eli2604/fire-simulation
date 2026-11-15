import { MATERIALS, MAT, enthalpyAt } from './materials.js';
import { F_LIQUID, F_ANCHOR } from './world.js';
import { carrierBody, makeBody, placeAt, stepBody, updateMass, framePose, waveSpectrum, RHO_SEA } from './buoyancy.js';

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

/**
 * kg of water solid voxel j can still take up in this step of dt s: what its material can hold
 * more (maxMoisture over its dry mass, less what it holds and what is already on its way to it),
 * soaking in over its moisture time lag (wood standing in water takes up ~10 % of what it can hold
 * in an hour: timeLag 10 h; fine fuels in minutes; materials without one: SOAK_TIME), and, if its
 * surface is over 100 °C, what its heat above 100 °C can boil off. Nothing for a sealed part (a
 * battery pack: waterReach). Water beyond that does not go into it: it stays where it is.
 */
const SOAK_TIME = 600; // s
export function soakRoom(w, j, dt) {
  const m = w.mat[j];
  const M = MATERIALS[m];
  if ((M.waterReach ?? 1) < 1 || M.name === 'water') return 0;
  const V = w.h ** 3;
  const massFrac = M.combustible ? M.residue + (1 - M.residue) * w.fuel[j] : 1;
  const dry = M.density * w.dens[j] * V * (massFrac > 0.05 ? massFrac : 0.05);
  let room = (M.maxMoisture - w.moist[j]) * dry * Math.min(1, dt / (M.timeLag ?? SOAK_TIME));
  if (room < 0) room = 0;
  const Ts = w.skin[j];
  if (Ts > 100) room += (dry * (enthalpyAt(m, Ts) - enthalpyAt(m, 100))) / (LV + CW * 80);
  room -= w.waterIn[j];
  return room > 0 ? room : 0;
}

/**
 * m kg of water running off at cell (x, y, z) collects as a puddle on the floor of its column:
 * the first solid at or under y (it drips down through the air). Out of the world under the
 * bottom it is gone.
 */
function toPuddle(w, x, y, z, m) {
  const { nx, ny, mat } = w;
  for (; y >= 0; y--) if (mat[x + nx * (y + ny * z)]) break;
  if (y < 0) return;
  const c = x + nx * z;
  w.runoff[c] += m;
  (w.runoffY ??= new Int16Array(nx * w.nz))[c] = y;
}

/**
 * Water voxels: boil off, soak neighbours, drain into soil; run-off becomes new water voxels.
 * Water is conserved: a solid takes up only what it can hold (soakRoom), taken out of the water
 * voxel that touches it; a puddle gives its floor and what stands in it only what they can take;
 * a voxel's worth of puddle becomes a water voxel only in a free cell on top of its floor (or of
 * the water already standing there), or, run off the side of a wall, in a free cell beside it.
 */
export function stepWater(sim, dt) {
  const w = sim.world;
  const id = MAT.water;
  const { nx, ny, nz, mat, temp, fuel, solids, h, steam } = w;
  const V = h ** 3;
  const voxelMass = 1000 * V;
  const remove = [];
  const wetRate = 0.5 * h * h * dt; // at most ~0.5 kg/(m²·s) through a face
  for (let k = 0; k < w.solidCount; k++) {
    const i = solids[k];
    if (mat[i] !== id) continue;
    const fuel0 = fuel[i];
    // boiling
    if (temp[i] > 100) {
      const m = fuel[i] * voxelMass;
      const ev = Math.min(m, ((temp[i] - 100) * voxelMass * CW) / LV);
      fuel[i] -= ev / voxelMass;
      temp[i] = 100;
      steam[w.faceAir[i]] += ev;
    }
    // soak what it touches: cools it, wets it, puts fires out (as much as it can take up)
    const x = i % nx;
    const r = (i - x) / nx;
    const y = r % ny;
    const z = (r - y) / ny;
    const nb = [x > 0 ? i - 1 : -1, x + 1 < nx ? i + 1 : -1, y > 0 ? i - nx : -1, y + 1 < ny ? i + nx : -1, z > 0 ? i - nx * ny : -1, z + 1 < nz ? i + nx * ny : -1];
    for (const j of nb) {
      if (j < 0 || fuel[i] <= 0) continue;
      const mj = mat[j];
      if (!mj || mj === id) continue;
      const take = Math.min(wetRate, soakRoom(w, j, dt), fuel[i] * voxelMass);
      if (take > 0) {
        sim.addWater(j, take);
        fuel[i] -= take / voxelMass;
      }
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
        }
      }
    }
    if (fuel[i] < 0.05 && fuel[i] < fuel0) remove.push(i); // (emptied this step: not water set up without its mass)
  }
  for (const i of remove) {
    if (mat[i] !== id) continue;
    // the last of it (a film): runs down onto what is under it
    const rest = Math.max(0, fuel[i]) * voxelMass;
    const x = i % nx;
    const r = (i - x) / nx;
    const y = r % ny;
    const z = (r - y) / ny;
    w.clearVoxel(i);
    if (rest > 0) {
      const below = y > 0 ? i - nx : -1;
      if (below >= 0 && mat[below] === id) fuel[below] += rest / voxelMass;
      else toPuddle(w, x, y - 1, z, rest);
    }
  }

  // shallow water on the floor: spreads to neighbouring columns of the same floor height,
  // evaporates on a hot floor, soaks the floor and the base of what stands in it (what they can take)
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
      // the floor under it is gone: it drains down to whatever is under it now
      w.runoff[c] = 0;
      toPuddle(w, x, y - 1, z, r0);
      continue;
    }
    if (temp[floor] > 100) {
      const ev = Math.min(r0, ((temp[floor] - 100) * 0.002 * dt));
      w.runoff[c] -= ev;
      steam[w.faceAir[floor]] += ev;
    }
    if (y + 1 < ny && mat[floor + nx] && mat[floor + nx] !== id) {
      const take = Math.min(w.runoff[c], 0.002 * dt, soakRoom(w, floor + nx, dt));
      if (take > 0) {
        sim.addWater(floor + nx, take);
        w.runoff[c] -= take;
      }
    }
    if (mat[floor] !== id) {
      const take = Math.min(w.runoff[c], 0.001 * dt, soakRoom(w, floor, dt));
      if (take > 0) {
        sim.addWater(floor, take);
        w.runoff[c] -= take;
      }
    }
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

  // run-off: a voxel's worth of water collected in a column becomes a water voxel, in the free
  // cell on its floor (on top of any water already standing there); off the side of a wall (no
  // room on top), in a free cell beside it, from where it flows. With no room at all it waits.
  const runoff = w.runoff;
  for (let c = 0; c < runoff.length; c++) {
    if (runoff[c] < voxelMass) continue;
    const x = c % nx;
    const z = (c - x) / nx;
    const y0 = runoffY[c];
    if (!mat[x + nx * (y0 + ny * z)]) continue; // (no floor: the pass above moves it down)
    let j = -1;
    for (let y = y0 + 1; y < ny; y++) {
      const i = x + nx * (y + ny * z);
      if (!mat[i]) {
        j = i;
        break;
      }
      if (mat[i] !== id) break;
    }
    if (j < 0)
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx;
        const zz = z + dz;
        if (xx < 0 || zz < 0 || xx >= nx || zz >= nz) continue;
        const i = xx + nx * (y0 + ny * zz);
        if (!mat[i]) {
          j = i;
          break;
        }
      }
    if (j < 0) continue;
    w.setVoxel(j, id, { temp: w.ambient + 2, variation: 0.03 });
    fuel[j] = 1;
    runoff[c] -= voxelMass;
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


/** The sea level against the hull at (x, z): higher where the ship has settled (it lists and trims). */
export function seaLevelAt(sea, x, z) {
  const cx = (sea.box[0] + sea.box[2]) / 2;
  const cz = (sea.box[1] + sea.box[3]) / 2;
  return sea.level + (sea.slopeX ?? 0) * (x - cx) + (sea.slopeZ ?? 0) * (z - cz);
}

/**
 * A ship floats where its weight equals the weight of the sea it displaces (Archimedes: the
 * floating body of sim/buoyancy.js, the same law the rowing boats float by). The carrier is
 * its real hull (a Nimitz: 317 m on the waterline, 40.8 m wide, ~100 000 t, its centre of
 * mass 15 m over the keel): it floats ~10.3 m deep, GM ~1.7 m, and rolls and pitches a little
 * in the sea of the weather (periods ~20 s and ~9 s: a fraction of a degree in a fresh breeze).
 * A ship section of its own (models/shipSection.js: no displacement given) is a box ship of
 * its footprint floating at its waterline (as stable as the ship it stands for: GM ≥ 0.3 m).
 *
 * Water that comes aboard adds its weight at its place: the ship settles deeper by about
 * m / (ρ_sea · A_waterplane) and, the water lying off the centre line (where the hole is),
 * lists and trims (tan θ ≈ m · offset / (Δ · GM)), as the body's moments come out.
 *
 * The flight deck and the decks below are worlds of their own, built in the ship's frame: the
 * ship stays still in them and the sea moves instead (the choice that keeps walking, the jets
 * landing on the deck, the hatches and every voxel where they are): the sea level here is the
 * world's waterline at rest plus how much deeper the hull floats now than at rest, its surface
 * tilted by the heel (slopeZ = tan φ) and trim (slopeX = −tan θ, + bow down); the ocean, the
 * flooding (holes deeper: the sea comes in faster, the flooding feeds itself) and the HUD go by
 * it. When the sea reaches the deck edge the ship loses its last reserve of buoyancy and
 * founders: the sea pours in over the deck until it is gone.
 */
export function stepBuoyancy(sim, dt) {
  const w = sim.world;
  const sea = w.sea;
  const S = sea?.ship;
  if (!S) return;
  const [bx0, bz0, bx1, bz1] = sea.box;
  const L = S.length ?? bx1 - bx0;
  const B = S.beam ?? bz1 - bz0;
  S.level0 ??= sea.level;
  const T0 = Math.max(0.3, S.level0 - S.keel);
  // the water aboard: how much, and where its centre is
  const { solids, mat, nx, ny, h } = w;
  const id = MAT.water;
  const V = h * h * h * 1000;
  let m = 0;
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (let k = 0; k < w.solidCount; k++) {
    const i = solids[k];
    if (mat[i] !== id) continue;
    const x = ((i % nx) + 0.5) * h;
    const z = (Math.floor(i / (nx * ny)) + 0.5) * h;
    if (x < bx0 || x > bx1 || z < bz0 || z > bz1) continue;
    const y = ((Math.floor(i / nx) % ny) + 0.5) * h;
    m += V;
    mx += V * x;
    my += V * y;
    mz += V * z;
  }
  S.water = m;
  const cx = (bx0 + bx1) / 2;
  const cz = (bz0 + bz1) / 2;
  // the ship as a floating body (its own frame: the still sea at 0, amidships over the origin)
  if (!S.body) {
    if (S.displacement >= 1e7) S.body = carrierBody({ displacement: S.displacement, kg: S.kg ?? 15 });
    else {
      const D = Math.max(T0 + 0.5, S.deck - S.keel);
      const Lb = bx1 - bx0, Bb = bz1 - bz0;
      const KM = T0 / 2 + (Bb * Bb) / (12 * T0);
      const kg = Math.min(S.kg ?? D * 0.55, KM - Math.max(0.3, 0.05 * Bb));
      S.body = makeBody({ hull: { kind: 'box', length: Lb, beam: Bb, depth: D }, solid: true, mass: RHO_SEA * Lb * Bb * T0, cg: [0, kg, 0], cells: { n: 12, m: 8, l: Math.max(6, Math.round(D / 0.5)) } });
      S.still = true; // (a section: no waves of its own)
    }
    const eq = placeAt(S.body, 0, 0, 0, 0);
    S.draft0 = eq.draft;
    S.acc = 0;
  }
  const body = S.body;
  // its weight where it is: a load in the hull's frame (the section's middle amidships)
  S.acc += dt;
  if (S.acc >= 0.2 || dt >= 0.2) {
    const was = body.loads[0]?.m ?? 0;
    if (Math.abs(m - was) > 1 || (m > 0) !== (was > 0)) {
      body.loads = m > 0 ? [{ m, p: [mx / m - cx + body.hullCg[0], my / m - S.keel, mz / m - cz], label: 'water aboard' }] : [];
      updateMass(body);
    }
    const W = sim.weather ?? {};
    if (!S.still && (S._wU !== W.windSpeed || S._wD !== W.windDir)) {
      S._wU = W.windSpeed;
      S._wD = W.windDir;
      S.waves = waveSpectrum(W);
    }
    stepBody(body, S.acc, { level: 0, t: w.time, waves: S.still ? null : S.waves });
    S.acc = 0;
  }
  const pose = body.pose ?? framePose(body);
  // (its draft along its own upright: what the sea is up its sides in its frame)
  const draft = -pose.p[1] / Math.max(0.5, pose.R[4]);
  const lim = Math.tan((25 * Math.PI) / 180);
  const heel = Math.max(-lim, Math.min(lim, Math.tan(body.roll)));
  const trim = Math.max(-lim, Math.min(lim, -Math.tan(body.pitch)));
  let target = S.level0 + (draft - S.draft0);
  // foundering: the sea is over the deck edge somewhere: no reserve buoyancy left
  const edge = Math.max(...[[bx0, bz0], [bx1, bz0], [bx0, bz1], [bx1, bz1]].map(([x, z]) => seaLevelAt(sea, x, z)));
  if (!S.foundering && edge > S.deck) {
    S.foundering = true;
    w.events.push({ type: 'foundering', pos: [cx, S.deck, cz], time: w.time, name: 'the ship' });
  }
  // going down, until it is under (the sea over the top of the world)
  if (S.foundering) target = Math.min(w.size[1] + 1, Math.max(target, sea.level + 0.25 * dt * 20));
  sea.level = target;
  sea.slopeZ = heel;
  sea.slopeX = trim;
  S.draft = draft + (S.foundering ? sea.level - target : 0);
  S.GM = body.tuned?.GM;
  S.heelDeg = (Math.atan(sea.slopeZ) * 180) / Math.PI;
  S.trimDeg = (Math.atan(sea.slopeX) * 180) / Math.PI;
  S.sunk = sea.level - S.level0;
  void L;
  void B;
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
