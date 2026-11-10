import { F_BURNING, F_SMOLDER, F_LIQUID, F_FALLING, O2_AIR } from './world.js';

/**
 * Sleeping parts of the world.
 *
 * Most of a big scene does nothing most of the time: stone walls at the air
 * temperature, still air with no smoke in it, far from any fire. Computing them
 * every step changes nothing. The world is split into blocks (AB air cells =
 * 2·AB voxels a side); a block is *awake* when anything in it is not at rest:
 *
 *  - gas warmer or colder than ambient, smoke, steam, burning gas, suppressant,
 *    oxygen that is not fresh air, flames, or thermal radiation arriving;
 *  - a solid off the air temperature, burning, smouldering, molten, falling, wet
 *    with arriving water or under foam;
 *  - a heater (a torch, a burst pipe, the fire torch in your hand), debris, a
 *    projectile.
 *
 * Awake blocks also wake their neighbours (further downwind in a strong wind),
 * so heat, smoke and fire spread into sleeping parts the normal way: a block
 * wakes as soon as something reaches its edge. Rain, an extinguisher in use or
 * a hull breach in space keep everything awake. Only awake blocks go through
 * the solid passes and the air model; sleeping ones keep their state.
 */
export const AB = 2; // air cells per block edge (0.8 m at 0.2 m voxels)

const T_AIR = 0.5; // °C off ambient that counts as activity (gas)
const T_SOLID = 1.0; // ... (solids)
const RAD = 30; // W/m² of thermal radiation arriving
const SMOKE = 3e-7; // kg of smoke / steam per cell (less is not even a haze)
const FGAS = 1; // J of burning gas per cell (a flame of 1 % or less)

export function updateActivity(sim, D) {
  const w = sim.world;
  const { anx, any, anz } = w;
  const bx = Math.ceil(anx / AB);
  const by = Math.ceil(any / AB);
  const bz = Math.ceil(anz / AB);
  const NB = bx * by * bz;
  if (!w.blockAct || w.blockAct.length !== NB) {
    w.blockAct = new Uint8Array(NB);
    w.blockRaw = new Uint8Array(NB);
    w.blockDim = [bx, by, bz];
  }
  if (!w.airAwake || w.airAwake.length !== w.NA) w.airAwake = new Uint8Array(w.NA);
  const act = w.blockAct;
  const raw = w.blockRaw;
  // the first step, and every 50th, run fully awake: exposed faces, the faces that touch
  // the air and the like are kept up to date for everything
  const all =
    sim.noSleep || (sim.stats.steps ?? 0) % 50 === 0 || D.rainRate > 0 || sim.spray || (w.vacuum && w.decompressing) || w.sprinklers.some((s) => s.active);
  if (all) {
    act.fill(1);
    w.airAwake.fill(1);
    w.activeSolids = w.solids;
    w.activeCount = w.solidCount;
    w.asleep = 0;
    return;
  }
  raw.fill(0);
  const Tamb = w.ambient;
  const { airT, smoke, steam, fgas, supp, o2, flame, radField } = w;
  const o2Rest = w.vacuum ? -1 : O2_AIR;
  // gas
  for (let az = 0; az < anz; az++) {
    const bzo = ((az / AB) | 0) * bx * by;
    for (let ay = 0; ay < any; ay++) {
      const byo = bzo + ((ay / AB) | 0) * bx;
      let a = anx * (ay + any * az);
      for (let ax = 0; ax < anx; ax++, a++) {
        const T = airT[a] - Tamb;
        if (
          T > T_AIR || T < -T_AIR ||
          smoke[a] > SMOKE || steam[a] > SMOKE || fgas[a] > FGAS || supp[a] > 1e-6 || flame[a] > 0.01 ||
          radField[a] > RAD ||
          (o2Rest > 0 && (o2[a] < o2Rest - 0.002 || o2[a] > o2Rest + 0.002) && o2[a] > 1e-4)
        )
          raw[byo + ((ax / AB) | 0)] = 1;
      }
    }
  }
  // solids
  const { solids, temp, skin, flags, waterIn, coat, nx, ny } = w;
  const n = w.solidCount;
  const V = 2 * AB; // voxels per block edge
  for (let k = 0; k < n; k++) {
    const i = solids[k];
    const f = flags[i];
    const dT = temp[i] - Tamb;
    const dS = skin[i] - Tamb;
    if (
      f & (F_BURNING | F_SMOLDER | F_LIQUID | F_FALLING) ||
      dT > T_SOLID || dT < -T_SOLID || dS > T_SOLID || dS < -T_SOLID ||
      waterIn[i] > 0 || coat[i] > 0.001
    ) {
      const x = i % nx;
      const r = (i - x) / nx;
      const y = r % ny;
      const z = (r - y) / ny;
      raw[((x / V) | 0) + bx * (((y / V) | 0) + by * ((z / V) | 0))] = 1;
    }
  }
  // sources and moving things
  const mark = (p, rad) => {
    const ah = w.ah * AB;
    const x0 = Math.max(0, Math.floor((p[0] - rad) / ah));
    const x1 = Math.min(bx - 1, Math.floor((p[0] + rad) / ah));
    const y0 = Math.max(0, Math.floor((p[1] - rad) / ah));
    const y1 = Math.min(by - 1, Math.floor((p[1] + rad) / ah));
    const z0 = Math.max(0, Math.floor((p[2] - rad) / ah));
    const z1 = Math.min(bz - 1, Math.floor((p[2] + rad) / ah));
    for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) raw[x + bx * (y + by * z)] = 1;
  };
  for (const ht of w.heaters) if (ht.on && !(ht.start !== undefined && w.time < ht.start - 1)) mark(ht.pos, Math.max(ht.radius, ht.height ?? 0) + w.ah);
  for (const d of w.debris) mark(d.p, w.ah);
  for (const p of w.projectiles) mark(p.p, w.ah * 2);
  for (const l of w.leaks) mark(l.p, 1);
  // wake the neighbours (further downwind: the air moves ~wind·dt a step)
  const reach = 1 + Math.ceil((Math.hypot(D.windX, D.windZ) * sim.dt) / (w.ah * AB));
  dilate(raw, act, bx, by, bz, reach);
  // per air cell, for the air model
  const awake = w.airAwake;
  for (let az = 0; az < anz; az++) {
    const bzo = ((az / AB) | 0) * bx * by;
    for (let ay = 0; ay < any; ay++) {
      const byo = bzo + ((ay / AB) | 0) * bx;
      let a = anx * (ay + any * az);
      for (let ax = 0; ax < anx; ax++, a++) awake[a] = act[byo + ((ax / AB) | 0)];
    }
  }
  // the solids to compute this step
  // (its own buffer: never the world's list of solids itself)
  if (!w.activeBuf || w.activeBuf.length < n) w.activeBuf = new Int32Array(Math.ceil(n * 1.2) + 64);
  const list = w.activeBuf;
  w.activeSolids = list;
  let c = 0;
  for (let k = 0; k < n; k++) {
    const i = solids[k];
    const x = i % nx;
    const r = (i - x) / nx;
    const y = r % ny;
    const z = (r - y) / ny;
    if (act[((x / V) | 0) + bx * (((y / V) | 0) + by * ((z / V) | 0))]) list[c++] = i;
  }
  w.activeCount = c;
  let sleeping = 0;
  for (let b = 0; b < NB; b++) if (!act[b]) sleeping++;
  w.asleep = sleeping / NB;
}

/** act = raw grown by `r` blocks in every direction (separable max filter). */
function dilate(raw, act, bx, by, bz, r) {
  const tmp = (dilate.tmp && dilate.tmp.length === raw.length ? dilate.tmp : (dilate.tmp = new Uint8Array(raw.length)));
  const pass = (src, dst, stride, len, n1, s1, n2, s2) => {
    for (let b = 0; b < n2; b++)
      for (let a = 0; a < n1; a++) {
        const base = a * s1 + b * s2;
        let last = -1e9;
        // forward: distance since the last active cell
        for (let k = 0; k < len; k++) {
          if (src[base + k * stride]) last = k;
          dst[base + k * stride] = k - last <= r ? 1 : 0;
        }
        last = 1e9;
        for (let k = len - 1; k >= 0; k--) {
          if (src[base + k * stride]) last = k;
          if (last - k <= r) dst[base + k * stride] = 1;
        }
      }
  };
  pass(raw, tmp, 1, bx, by, bx, bz, bx * by); // along x
  pass(tmp, act, bx, by, bx, 1, bz, bx * by); // along y
  tmp.set(act);
  pass(tmp, act, bx * by, bz, bx, 1, by, bx); // along z
}

