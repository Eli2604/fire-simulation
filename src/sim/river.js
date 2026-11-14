import { MAT } from './materials.js';
import { waterStirAt } from './stirrers.js';

/**
 * Running water: a stream, a waterfall, a river down to the sea (world.rivers, from the island's
 * waterfall: models/islandFall.js) and water mills turned by it (world.mills: models/mill.js).
 *
 * A river is a line of stations from its source to the sea, each with its cross-section (the
 * voxel columns across it) and the water's level there. Its water is voxels, held in level
 * reaches by sills of rock it pours over. The source gives a steady discharge Q (m³/s). Going
 * down the river, Q goes through every cross-section (continuity): the water there flows at
 * v = Q / A, A the open part of the section (water, less the ice on it). So it runs faster
 * where it is narrow or shallow (a mill race) and is slow in the pool; over a sill or the brink
 * of the fall it goes at the critical speed √(g·y_c), y_c = (q²/g)^⅓ (q = Q per metre of width).
 *
 *  - Dammed: a section with no open water and no room for any (a wall built across it, rubble
 *    filling it, a sill buried) lets nothing through: below it the river stands still.
 *  - Frozen: ice takes up the top of the section (sim/ice.js); frozen to the bottom, it is shut.
 *    Running water freezes more slowly than still water (it keeps stirring the cold surface
 *    water down): the river's speed per column is in `ice.run` for sim/ice.js.
 *  - Dried up (the water boiled off by lava, run out through a crater in the bank): the source
 *    fills it again, as fast as its Q allows, from the top down, as far as nothing blocks it.
 *  - The fall's spray keeps the ledge and the rocks round the pool wet.
 *
 * What floats goes with the current (riverCurrent: sim/stirrers.js waterStirAt, for loose things
 * and a swimmer), and it turns the water mills.
 *
 * A water wheel (undershot: its paddles dip into the current): the water pushes on the
 * immersed paddles with the drag of the flow relative to them, F = ½ ρ Cd A (v − u)|v − u|, u = ωR
 * the paddles' own speed; against that the friction of its bearings, gears and millstones (a
 * steady torque) and some damping. I dω/dt = F R − τ: it spins up over seconds (its inertia:
 * the wheel, the gearing, the runner stone), runs at a little less than the water's speed, and
 * runs down and stops when the water stops (dammed, dry), the paddles are out of the water, or
 * the ice grips them.
 */
const G = 9.81;
const RHO = 1000;
const TICK = 0.25; // s between updates of the river (the mills step every step)

/** The cross-sections of a river's stations: the voxel columns across each, the water's layers. */
function sections(w, r) {
  if (r._sec && r._secH === w.h && r._secN === w.nx) return r._sec;
  const { h, nx, nz } = w;
  r._sec = r.stations.map((s) => {
    const ax = -s.t[2];
    const az = s.t[0];
    const cols = new Set();
    const half = Math.max(s.half, h * 0.5);
    for (let d = -half + h * 0.25; d <= half - h * 0.25 + 1e-6; d += h * 0.5) {
      const cx = Math.floor((s.p[0] + ax * d) / h);
      const cz = Math.floor((s.p[2] + az * d) / h);
      if (cx >= 0 && cz >= 0 && cx < nx && cz < nz) cols.add(cx + nx * cz);
    }
    const level = s.p[1];
    return {
      cols: [...cols],
      y0: Math.max(0, Math.round(s.bed / h)), // the water's layers: y0 .. y1
      y1: Math.round(level / h) - 1,
      over: Math.round(level / h), // over a sill or the brink: the layer the water goes through
      width: 2 * half,
    };
  });
  r._secH = h;
  r._secN = nx;
  return r._sec;
}

/** One step of the rivers (every TICK s) and of the mills (every step). */
export function stepRivers(sim, dt) {
  const w = sim.world;
  for (const r of w.rivers ?? []) {
    r._acc = (r._acc ?? TICK) + dt;
    if (r._acc >= TICK) {
      updateRiver(sim, r, r._acc);
      r._acc = 0;
    }
  }
  for (const m of w.mills ?? []) stepMill(sim, m, dt);
}

function updateRiver(sim, r, T) {
  const w = sim.world;
  const { nx, ny, h, mat } = w;
  const sec = sections(w, r);
  const N = r.stations.length;
  if (!r.v || r.v.length !== N) {
    r.v = new Float32Array(N);
    r.area = new Float32Array(N);
  }
  const ice = w.ice;
  if (ice && !ice.run) ice.run = new Float32Array(w.nx * w.nz);
  const water = MAT.water;
  const Q0 = Math.max(0, r.flow ?? 0);
  let Q = Q0;
  let budget = Math.min(60, (Q0 * T) / h ** 3 + 1); // voxels of water the source can put back this tick
  const warm = Math.max(2, Math.min(16, w.ambient)); // (spring water)
  r.blockedAt = -1;
  r.fallQ = 0;
  let mouth = -1;
  for (let k = 0; k < N; k++) {
    const s = r.stations[k];
    const c = sec[k];
    if (Q <= 0) {
      r.v[k] = 0;
      r.area[k] = 0;
      continue;
    }
    if (s.kind === 'sea') {
      // out into the sea: it spreads and slows
      if (mouth < 0) mouth = k;
      const fade = Math.max(0, 1 - ((k - mouth) * 0.25) / 3);
      r.v[k] = (Q / (c.width * 0.8)) * fade;
      r.area[k] = c.width * 0.8;
      continue;
    }
    if (s.kind === 'sill' || s.kind === 'fall') {
      // over the top: the layer over the sill must be open (or water)
      let open = 0;
      for (const col of c.cols) {
        const x = col % nx;
        const z = (col - x) / nx;
        if (c.over >= ny) {
          open++;
          continue;
        }
        const m = mat[x + nx * (c.over + ny * z)];
        if (!m || m === water) open++;
      }
      if (!open) {
        block(r, k);
        Q = 0;
        r.v[k] = 0;
        continue;
      }
      const wd = (open / c.cols.length) * c.width;
      const yc = Math.cbrt(((Q / wd) ** 2) / G);
      r.v[k] = Math.sqrt(G * yc);
      r.area[k] = wd * yc;
      if (s.kind === 'fall') r.fallQ = Q;
      continue;
    }
    // a reach (the stream, the pool, the river): the open water across it
    let depth = 0;
    let room = 0;
    for (const col of c.cols) {
      const x = col % nx;
      const z = (col - x) / nx;
      let d = 0;
      for (let y = c.y0; y <= c.y1 && y < ny; y++) {
        const i = x + nx * (y + ny * z);
        const m = mat[i];
        if (m === water) d += h;
        else if (!m) {
          room++;
          // the source fills it again (from the bottom up), as fast as its flow allows
          if (budget >= 1 && (y === c.y0 || mat[i - nx])) {
            w.setVoxel(i, water, { temp: warm, variation: 0.03 });
            budget--;
            d += h;
          }
        }
      }
      // the ice on it takes up the top of it
      if (ice && ice.top[col] !== -1) d = Math.max(0, d - ice.thick[col]);
      depth += d;
    }
    const A = (depth / c.cols.length) * c.width;
    if (A < 0.01 && !room) {
      // dammed, or frozen to the bottom: nothing gets through
      block(r, k);
      Q = 0;
      r.v[k] = 0;
      r.area[k] = 0;
      continue;
    }
    r.area[k] = A;
    r.v[k] = Math.min(3, Q / Math.max(A, 0.03 * c.width));
    if (ice) for (const col of c.cols) ice.run[col] = r.v[k];
  }
  r.Q = Q0;
  r.Qout = Q;
  // the spray off the foot of the fall wets what is round it (the ledge behind it too)
  const F = r.fall;
  if (F && r.fallQ > 0) {
    const land = [F.pool[0] - F.dir[0] * F.poolR[0] * 0.3, F.pool[1] + 0.6, F.pool[2] - F.dir[2] * F.poolR[0] * 0.3];
    sim.douse(land, Math.max(1.5, F.width), Math.min(20, r.fallQ * T * 4));
    if (F.ledge) sim.douse([F.ledge.mid[0], F.ledge.y + 0.3, F.ledge.mid[2]], 1.2, Math.min(4, r.fallQ * T));
  }
}

function block(r, k) {
  if (r.blockedAt < 0) r.blockedAt = k;
}

/**
 * The current of the rivers at (x, z): [vx, vz] (m/s) added into out. Along the river, fastest in
 * its middle, with a little drift in towards its middle (what floats is kept off the banks).
 */
export function riverCurrent(w, x, z, out = [0, 0]) {
  for (const r of w.rivers ?? []) {
    if (!r.v) continue;
    let best = -1;
    let bd = Infinity;
    const st = r.stations;
    for (let k = 0; k < st.length; k++) {
      const s = st[k];
      const d2 = (x - s.p[0]) ** 2 + (z - s.p[2]) ** 2;
      if (d2 < bd) {
        bd = d2;
        best = k;
      }
    }
    if (best < 0 || bd > 36) continue;
    const s = st[best];
    const dx = x - s.p[0];
    const dz = z - s.p[2];
    const along = dx * s.t[0] + dz * s.t[2];
    const lat = -dx * s.t[2] + dz * s.t[0];
    const d = Math.abs(lat);
    if (Math.abs(along) > 0.8 || d > s.half + 0.4) continue;
    const prof = d < s.half ? 1.1 * (1 - 0.3 * (d / s.half) ** 2) : 0.7 * (1 - (d - s.half) / 0.4);
    const sp = r.v[best] * prof;
    const inward = -0.15 * sp * Math.max(-1, Math.min(1, lat / Math.max(0.3, s.half)));
    out[0] += s.t[0] * sp - s.t[2] * inward;
    out[1] += s.t[2] * sp + s.t[0] * inward;
  }
  return out;
}

/** The water's surface at (x, z) under the height `from` (the top of a column of water, or the sea), or null. */
function surfaceAt(w, x, z, from) {
  const cx = Math.floor(x / w.h);
  const cz = Math.floor(z / w.h);
  if (cx < 0 || cz < 0 || cx >= w.nx || cz >= w.nz) return null;
  // (from under the wheel's own axle, down: the first thing there)
  const y = Math.min(w.colTop[cx + w.nx * cz], Math.floor(from / w.h));
  for (let k = Math.min(y, w.ny - 1); k >= 0; k--) {
    const m = w.mat[w.idx(cx, k, cz)];
    if (!m) continue;
    if (m === MAT.water) return (k + 1) * w.h;
    break;
  }
  return w.sea && !w.vacuum ? w.sea.level : null;
}

/** One step of a water wheel (see the top of this file). */
export function stepMill(sim, m, dt) {
  const w = sim.world;
  const R = m.radius;
  const a = m.axis;
  // its axle: gone (burnt through, blown apart), the wheel is gone with it
  const hub = w.voxelAt ? w.voxelAt(m.p[0], m.p[1], m.p[2]) : -1;
  if (hub >= 0 && !w.mat[hub]) {
    if (!m.broken) w.events.push({ type: 'millBroken', pos: m.p, time: w.time, name: m.label ?? 'water wheel' });
    m.broken = true;
  }
  // the bottom of the wheel, and which way its rim goes there turning forwards (axis × down)
  const bx = m.p[0];
  const bz = m.p[2];
  const t = [a[2], 0, -a[0]];
  const low = m.p[1] - R;
  const surf = surfaceAt(w, bx, bz, low + m.paddle + w.h * 0.5); // (from over its paddle tips down)
  const immersion = m.broken || surf == null ? 0 : Math.max(0, Math.min(m.paddle, surf - low));
  const cur = waterStirAt(w, bx, bz); // (the rivers' current and the whirlpools')
  const vt = cur[0] * t[0] + cur[1] * t[2];
  // ice round its foot grips the paddles
  // (round its foot: the column under its axle itself is no open water)
  let frozen = false;
  if (w.ice && immersion > 0)
    for (const k of [0, -0.6, 0.6]) {
      const ice = w.ice.at(w, bx + t[0] * k * R, bz + t[2] * k * R);
      if (ice && ice.thick > 0.02) frozen = true;
    }
  const I = m.inertia;
  let om = m.omega;
  if (frozen || m.broken) om *= Math.exp(-dt / 0.3);
  else {
    const A = m.width * immersion;
    const k = 0.5 * RHO * m.cd * A * Math.abs(vt - om * R); // N per m/s of slip
    // (implicit in the water's drag: stable for any step)
    om = (I * om + dt * k * R * vt) / (I + dt * (k * R * R + m.damping));
    const dec = (dt * m.friction) / I;
    om = Math.sign(om) * Math.max(0, Math.abs(om) - dec);
    m.torque = k * R * (vt - om * R);
  }
  if (Math.abs(om) < 1e-4) om = 0;
  m.omega = om;
  m.angle = (m.angle + om * dt) % (Math.PI * 2);
  m.water = vt; // the water's speed along the rim at the bottom (m/s)
  m.immersion = immersion;
  m.frozen = frozen;
  m.rpm = (om * 60) / (2 * Math.PI);
}
