/**
 * Thermal radiation further out than the blurred field reaches (sim/air.js blurRadiation).
 *
 * The blurred field spreads what radiates over ~0.6 m and fades out by ~1.2 m: right for the
 * flames licking along a log, but a car burning two metres from a house radiates onto its
 * wall, its windows and its eaves (10-30 kW/m² from a fully involved car), and that is how a
 * car fire sets a house alight. Here the fire's radiant power is gathered into blocks (~1 m),
 * and every surface further out takes P cosθ / (4π d²) from each block it can see:
 *  - the line from its air cell to the block is marched through the air grid, and solids in
 *    the way (a wall, an unbroken window pane, the car's own body) shade it, so the room
 *    behind a wall gets nothing until a window breaks;
 *  - in its cell, only the faces of a voxel open to the air and turned towards the fire take
 *    it (cosθ): the outside of a wall does, the sofa standing against its inside does not.
 * The result is per voxel (w.radFar, W/m² as the blurred field's: the solid pass takes in
 * half of it per open face, simulation.js), recomputed a few times a second (it changes
 * slowly), and only when something radiates enough to matter (a candle or a torch does not).
 */

// The blurred field takes 0.55 of the emission (the rest is re-absorbed inside the burning
// object itself). Out here the fire is a few point sources a metre apart, two or three metres
// from a wall: that underrates a tall flame close by (its view factor), which makes up for
// the re-absorbed share; together about 1 (a fully involved car, ~1 MW radiated, puts
// ~10 kW/m² on a wall 2 m off, as measured)
const FAR_VIEW = 1.0;
const FLAME_RAD = 0.3; // share of the heat of combustion radiated (simulation.js RAD_FRACTION)
const MIN_TOTAL = 15e3; // W radiated in all: below it there is no far field
const MIN_BLOCK = 2e3; // W radiated by a block for it to count as a source
const MIN_E = 150; // W/m²: less than this is not worth carrying
const MAX_SOURCES = 10;
const EVERY = 1; // s between updates
const MAX_IRRADIANCE = 200e3;
const WAKE = 31; // W/m² in the blurred field: keeps the cells it reaches awake (sim/activity.js: 30)

/** Updates w.radFar (once a second) and keeps the cells it reaches awake. Call after blurRadiation (with this step's flames, w.flameAcc, still in). */
export function farRadiation(w) {
  const t = w.time ?? 0;
  const st = (w.farRad ??= { next: -Infinity, cells: new Int32Array(1024), n: 0, vox: new Int32Array(1024), nv: 0 });
  if (t >= st.next) {
    st.next = t + EVERY;
    update(w, st);
  }
  if (!st.n) return;
  const f = w.radField;
  for (let k = 0; k < st.n; k++) {
    const a = st.cells[k];
    if (f[a] < WAKE) f[a] = WAKE;
  }
  w.radFieldZero = false;
}

const grow = (arr, n) => {
  if (n < arr.length) return arr;
  const b = new Int32Array(arr.length * 2);
  b.set(arr);
  return b;
};

function update(w, st) {
  // clear the last field
  if (w.radFar) for (let k = 0; k < st.nv; k++) w.radFar[st.vox[k]] = 0;
  st.n = 0;
  st.nv = 0;
  const { anx, any, anz, ah, occ } = w;
  // (near: the distance at which the blurred field is calibrated; it is gone by twice that)
  const r = Math.max(1, Math.min(4, Math.round(0.6 / ah)));
  const near = r * ah;
  // gather the sources into blocks of ~1.2 m (coarser if there are many)
  let B = Math.max(1, Math.round(1.2 / ah));
  let src = gather(w, B);
  if (!src) return;
  while (src.length > MAX_SOURCES) src = gather(w, (B *= 2));
  let total = 0;
  for (const s of src) total += s.P;
  if (total < MIN_TOTAL) return;
  // the source boxes' extent and the range beyond which nothing gets MIN_E
  const range = Math.sqrt((FAR_VIEW * total) / (4 * Math.PI * MIN_E));
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const s of src) {
    x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x);
    y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y);
    z0 = Math.min(z0, s.z); z1 = Math.max(z1, s.z);
  }
  const NA = anx * any * anz;
  if (!st.E || st.E.length !== NA) {
    st.E = new Float32Array(NA); // per cell: irradiance (0: not computed / nothing)
    st.u = new Float32Array(NA * 3); // its direction (towards the fire, unit)
    st.done = new Uint8Array(NA);
  } else st.done.fill(0);
  if (!w.radFar || w.radFar.length !== w.N) w.radFar = new Float32Array(w.N);
  const { nx, ny, nz, solids, solidCount, expo, mat } = w;
  const sxy = nx * ny;
  for (let k = 0; k < solidCount; k++) {
    const i = solids[k];
    const ex = expo[i];
    if (!ex) continue;
    const x = i % nx;
    const yz = (i - x) / nx;
    const y = yz % ny;
    if (y === 0) continue; // (the ground: what it takes in matters little)
    const z = (yz - y) / ny;
    const ax = x >> 1;
    const ay = y >> 1;
    const az = z >> 1;
    const a = ax + anx * (ay + any * az);
    if (!st.done[a]) {
      st.done[a] = 1;
      st.E[a] = 0;
      const cx = (ax + 0.5) * ah;
      const cy = (ay + 0.5) * ah;
      const cz = (az + 0.5) * ah;
      // (out of range of the whole fire: nothing)
      const dx = cx < x0 ? x0 - cx : cx > x1 ? cx - x1 : 0;
      const dy = cy < y0 ? y0 - cy : cy > y1 ? cy - y1 : 0;
      const dz = cz < z0 ? z0 - cz : cz > z1 ? cz - z1 : 0;
      if (dx * dx + dy * dy + dz * dz <= range * range) cellField(w, st, occ, a, ax, ay, az, cx, cy, cz, src, near);
    }
    const E = st.E[a];
    if (!E) continue;
    // the faces of this voxel open to the air, turned towards the fire
    const ux = st.u[a * 3], uy = st.u[a * 3 + 1], uz = st.u[a * 3 + 2];
    let c = 0;
    if (ux > 0 && x + 1 < nx && !mat[i + 1]) c += ux;
    if (ux < 0 && x > 0 && !mat[i - 1]) c -= ux;
    if (uy > 0 && y + 1 < ny && !mat[i + nx]) c += uy;
    if (uy < 0 && y > 0 && !mat[i - nx]) c -= uy;
    if (uz > 0 && z + 1 < nz && !mat[i + sxy]) c += uz;
    if (uz < 0 && z > 0 && !mat[i - sxy]) c -= uz;
    if (c <= 0.02) continue;
    // (the solid pass takes in eps · ½ · area · field over its ex open faces: this gives each
    // face turned towards the fire E cosθ)
    const v = (2 * E * c) / ex;
    w.radFar[i] = v > MAX_IRRADIANCE ? MAX_IRRADIANCE : v;
    st.vox = grow(st.vox, st.nv + 1);
    st.vox[st.nv++] = i;
  }
  // the cells it reaches (to keep them awake)
  for (let a = 0; a < NA; a++) {
    if (!st.done[a] || st.E[a] < MIN_E) continue;
    st.cells = grow(st.cells, st.n + 1);
    st.cells[st.n++] = a;
  }
}

/** The far irradiance in cell a (st.E) and the direction it comes from (st.u). */
function cellField(w, st, occ, a, ax, ay, az, cx, cy, cz, src, near) {
  let E = 0, vx = 0, vy = 0, vz = 0;
  for (const s of src) {
    const dx = s.x - cx;
    const dy = s.y - cy;
    const dz = s.z - cz;
    const d2 = dx * dx + dy * dy + dz * dz;
    const d = Math.sqrt(d2);
    // close in the blurred field has it: this takes over from `near` out to twice that
    if (d <= near) continue;
    const ramp = d >= 2 * near ? 1 : (d - near) / near;
    let e = (ramp * FAR_VIEW * s.P) / (4 * Math.PI * d2);
    if (e < MIN_E * 0.05) continue;
    e *= sight(w, occ, ax, ay, az, s, d);
    if (!e) continue;
    E += e;
    vx += (e * dx) / d;
    vy += (e * dy) / d;
    vz += (e * dz) / d;
  }
  if (E < MIN_E) return;
  const l = Math.hypot(vx, vy, vz) || 1;
  st.E[a] = E;
  st.u[a * 3] = vx / l;
  st.u[a * 3 + 1] = vy / l;
  st.u[a * 3 + 2] = vz / l;
}

/**
 * Radiant sources in blocks of B air cells: [{ x, y, z (power-weighted centre, m), P W }] or null.
 * The flames only (the share of the heat of combustion that leaves as radiation, where it
 * burns): what hot surfaces emit is mostly taken in again by the surfaces round them (a room
 * on fire: its walls, floor and ceiling), the blurred field has that.
 */
function gather(w, B) {
  const { anx, any, ah } = w;
  const src = w.flameAcc;
  const bx = Math.ceil(anx / B);
  const by = Math.ceil(any / B);
  const map = new Map();
  for (let a = 0; a < src.length; a++) {
    const p = src[a] * FLAME_RAD;
    if (!(p > 0)) continue;
    const x = a % anx;
    const yz = (a - x) / anx;
    const y = yz % any;
    const z = (yz - y) / any;
    const key = Math.floor(x / B) + bx * (Math.floor(y / B) + by * Math.floor(z / B));
    let s = map.get(key);
    if (!s) map.set(key, (s = { x: 0, y: 0, z: 0, P: 0 }));
    s.P += p;
    s.x += p * (x + 0.5) * ah;
    s.y += p * (y + 0.5) * ah;
    s.z += p * (z + 0.5) * ah;
  }
  if (!map.size) return null;
  const out = [];
  for (const s of map.values()) {
    if (s.P < MIN_BLOCK) continue;
    out.push({ x: s.x / s.P, y: s.y / s.P, z: s.z / s.P, P: s.P });
  }
  return out;
}

/**
 * How much of the way from cell (ax, ay, az) to source s is clear (0..1): the air cells
 * between are marched in half-cell steps; what is solid in them (occupancy) shades it. The
 * cell itself (it holds the surface) and the last cell before the source are not counted.
 */
function sight(w, occ, ax, ay, az, s, d) {
  const { anx, any, anz, ah } = w;
  const steps = Math.floor((d / ah) * 2);
  if (steps < 4) return 1;
  const sx = (ax + 0.5) * ah;
  const sy = (ay + 0.5) * ah;
  const sz = (az + 0.5) * ah;
  const ix = (s.x - sx) / steps;
  const iy = (s.y - sy) / steps;
  const iz = (s.z - sz) / steps;
  let T = 1;
  let last = ax + anx * (ay + any * az);
  for (let k = 1; k < steps - 2; k++) {
    const x = Math.floor((sx + ix * k) / ah);
    const y = Math.floor((sy + iy * k) / ah);
    const z = Math.floor((sz + iz * k) / ah);
    if (x < 0 || y < 0 || z < 0 || x >= anx || y >= any || z >= anz) continue;
    const a = x + anx * (y + any * z);
    if (a === last) continue;
    last = a;
    const o = occ[a];
    if (o > 0) {
      T *= o >= 0.5 ? 0 : 1 - 2 * o;
      if (T < 0.02) return 0;
    }
  }
  return T;
}
