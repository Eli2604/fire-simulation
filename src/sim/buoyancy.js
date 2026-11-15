import { MAT, MATERIALS } from './materials.js';
import { waterStirAt } from './stirrers.js';
import { initBoat, stepDrift, updateHoles } from './boats.js';
import { makeMovingBody, needsRestamp, restamp, syncBody, ownsCell, displaceLiquid } from './movingBody.js';
import { dragAir } from './bodyAir.js';
import { F_BURNING, F_SMOLDER } from './world.js';
import { placeCrew } from './boatCrew.js';
import { boatGround, rutAt } from './groundContact.js';

/**
 * Floating bodies: Archimedes for a rigid hull (a rowing boat, the aircraft carrier).
 *
 * A hull is a shape: its keel line, its sheer line (the top of its sides) and its half-breadth at
 * every height of every station (hull frame: origin on the keel amidships, x forward to the bow,
 * y up, z to starboard). It is sampled once into cells (~1500 for a boat, ~13 000 for a carrier),
 * each with
 *   v    the volume of the hull's envelope in it (planking and the air it encloses: what it
 *        displaces when it is under water), and
 *   vin  the part of it that is the open inside of the boat (where water that comes aboard goes).
 * The planking's own volume (Σ v − vin) is made to come out at the hull's material volume (its
 * surface area × plank thickness × a factor for frames, thwarts and gunwales), so a swamped
 * wooden boat still floats on its wood and an aluminium one goes down.
 *
 * Every step, in the pose it is in (heave, roll, pitch) and on the water as it is there (still,
 * or the waves of the weather: waveSpectrum, the same as render/ocean.js draws):
 *   buoyancy  B = ρ_w · g · V_submerged, each cell's share (its submerged fraction from the
 *             water height over it) acting at the cell: their sum acts at the centre of buoyancy;
 *   weight    m · g of the hull, its load and the people aboard at their centre of mass G, and
 *             the water aboard at its own centre (it runs to the low side: the free-surface
 *             effect comes with it).
 * The boat moves in heave, roll and pitch (surge, sway and yaw: sim/boats.js) as a rigid body with the
 * water's added mass (heave: ½·ρ·π/8·B²·L, about a strip of half a cylinder) and inertia, and
 * damping from making waves and from drag: a linear part at a damping ratio ζ (heave 0.25, roll
 * 0.08, pitch 0.3: ships roll long, heave and pitch die out in a few swings) plus a quadratic
 * drag ½·ρ·C_d·A·|v|·v. So the equilibrium draft emerges (where B = m·g; a 4.3 m wooden rowing
 * boat: ~6 cm empty, ~15 cm with two aboard), as does its stability: tilted, the centre of
 * buoyancy moves out to the low side, ahead of G as long as the metacentre M is above G
 * (GM = KB + BM − KG, BM = I_waterplane / V > 0): the righting moment Δ·g·GM·sin φ brings it
 * back (a rowing boat GM ~ 1–3 m, rolling in ~1 s; the carrier GM ~ 2 m, ~20 s).
 *
 * Water comes aboard through holes below the waterline (Torricelli: Q = C_d·A·√(2·g·Δh), Δh
 * the outside level over the inside one) and over the gunwale where it dips under (a sharp
 * crested weir: q = 0.6·⅔·√(2g)·d^1.5 per metre of gunwale under by d). It adds its weight, the
 * freeboard shrinks, the inflow grows: overloaded or holed, it swamps and (unless its material
 * or buoyancy tanks float it) sinks to the bottom.
 *
 *   const hull = rowBoatHull({ length: 4.3, beam: 1.45, depth: 0.62 });
 *   const body = makeBody({ hull, material: 'wood', loads: [{ m: 80, p: [0, 0.35, 0] }] });
 *   const eq = equilibrium(body);              // { Y, draft, roll, pitch, V, sinks }
 *   placeAt(body, eq, [x, level, z], yaw);     // moored there, at rest
 *   stepBody(body, dt, { level, t, waves });   // heave, roll and pitch on the water
 *
 * In the simulation (stepFloats): world.floats (models/rowBoat.js; island.js makes its boats of
 * it) float on the sea or a pond of their world; their voxels (hidden: render/floats.js draws
 * the hull in its pose) burn as their material does, and go with it wherever it goes (a moving
 * body, sim/movingBody.js: stampFloat restamps them at its pose when it has moved half a voxel,
 * with their heat, fire and char, its planking kept tight at any heel; the pond's water is pushed
 * out of the hull and closes in where it was; the air in its hull goes with it and the air round
 * it is dragged along: sim/bodyAir.js). Where planking has burnt away below the waterline the water comes in, and with less
 * planking it has less shell to float on (shellLoss); what is under the water does not burn. The carrier (sim/water.js stepBuoyancy) floats by the same
 * law, see carrierBody.
 */

export const G = 9.81;
export const RHO_SEA = 1025; // kg/m³: sea water (35 ‰ salt, 15 °C)
export const RHO_FRESH = 1000; // a lake, a pond
export const RHO_AIR = 1.2;

/**
 * Hull materials: density (kg/m³), the plank / sheet thickness (m), a factor for what is more
 * than the shell (frames, thwarts, gunwale, floorboards, knees), and the voxel material it
 * burns as. A 4.3 m clinker boat of larch on oak: ~9.5 m² of planking 16 mm thick, ~85 kg,
 * ~140 kg built; an aluminium dinghy of 3 mm sheet ~105 kg; a GRP one ~140 kg.
 */
export const HULL_MATERIALS = {
  wood: { label: 'Wood planks (larch on oak)', rho: 560, t: 0.016, structure: 1.65, voxel: 'wood' },
  aluminium: { label: 'Aluminium (3 mm sheet)', rho: 2700, t: 0.003, structure: 1.35, voxel: 'aluminium' },
  grp: { label: 'GRP (glass-fibre laminate)', rho: 1850, t: 0.0065, structure: 1.3, voxel: 'plastic' },
};

/* ------------------------------------------------------------------ hull shapes */

/** A box: L × B × D, flat bottom, vertical sides (the analytic check: draft = D·ρ_hull/ρ_w). */
export function boxHull({ length, beam, depth }) {
  const L = length, B = beam, D = depth;
  return {
    kind: 'box', L, B, D, x0: -L / 2, x1: L / 2,
    keel: () => 0,
    sheer: () => D,
    half: (x, y) => (x < -L / 2 || x > L / 2 || y < 0 || y > D ? 0 : B / 2),
  };
}

/**
 * A rowing boat: a transom stern (t = −1) and a fine stem (t = +1), the sheer rising to both
 * ends (more at the bow), the keel rockered up to them, round bilges (section half-breadth
 * b·η^bilge at the height fraction η between keel and sheer).
 */
export function rowBoatHull({ length = 4.3, beam = 1.45, depth = 0.62, sheer = 0.14, transom = 0.62, bilge = 0.26 } = {}) {
  const L = length, B = beam, D = depth;
  const tOf = (x) => (2 * x) / L;
  const width = (t) => {
    if (t >= -0.1) return (B / 2) * Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, (t + 0.1) / 1.1), 2.2)));
    const u = (-0.1 - t) / 0.9;
    return (B / 2) * (1 - (1 - transom) * u * u);
  };
  const keel = (x) => {
    const t = tOf(x);
    return t > 0 ? 0.62 * D * t * t * t * t : 0.28 * D * t * t;
  };
  const sh = (x) => {
    const t = tOf(x);
    return D + sheer * t * t * (t > 0 ? 1 : 0.5);
  };
  return {
    kind: 'rowBoat', L, B, D: D + sheer, x0: -L / 2, x1: L / 2, keel, sheer: sh, width,
    half(x, y) {
      if (x < -L / 2 || x > L / 2) return 0;
      const k = keel(x);
      const s = sh(x);
      if (y < k || y > s) return 0;
      return width(tOf(x)) * Math.pow((y - k) / (s - k), bilge);
    },
  };
}

/**
 * A big ship's hull (the aircraft carrier: a Nimitz is 317 m on the waterline, 40.8 m wide
 * there, ~11.3 m deep at ~100 000 t; the flight deck's overhang above is not hull under water).
 * Nearly vertical sides over a flat bottom with round bilges, a fine bow, a broad transom.
 */
export function shipHull({ length = 317, beam = 40.8, depth = 28, bilge = 0.14, transom = 0.45, fine = 0.8 } = {}) {
  const L = length, B = beam, D = depth;
  const tOf = (x) => (2 * x) / L;
  const width = (t, y) => {
    // the bow fines out, finer low down (the forefoot); aft it narrows to the transom
    if (t > 0) return (B / 2) * Math.pow(Math.max(0, 1 - Math.pow(t, 2.4 - 0.8 * Math.min(1, y / D))), fine);
    const u = -t;
    return (B / 2) * (1 - (1 - transom) * Math.pow(u, 3));
  };
  const keel = (x) => {
    const t = tOf(x);
    return t < -0.7 ? 0.32 * 11 * ((-t - 0.7) / 0.3) ** 2 : 0; // the run aft lifts towards the transom
  };
  return {
    kind: 'ship', L, B, D, x0: -L / 2, x1: L / 2, keel, sheer: () => D,
    half(x, y) {
      if (x < -L / 2 || x > L / 2) return 0;
      const k = keel(x);
      if (y < k || y > D) return 0;
      const eta = Math.min(1, (y - k) / 6); // round bilge over the bottom 6 m, vertical sides above
      return width(tOf(x), y) * Math.pow(eta, bilge);
    },
  };
}

export function hullFrom(spec) {
  if (spec.kind === 'box') return boxHull(spec);
  if (spec.kind === 'ship') return shipHull(spec);
  return rowBoatHull(spec);
}

/** The hull's wetted-and-dry surface (m²): both sides of every section, the transom. */
export function hullArea(hull, n = 80, m = 24) {
  let A = 0;
  const dx = (hull.x1 - hull.x0) / n;
  for (let i = 0; i < n; i++) {
    const x = hull.x0 + (i + 0.5) * dx;
    const k = hull.keel(x);
    const s = hull.sheer(x);
    let arc = 0;
    let py = k, pz = hull.half(x, k + 1e-6);
    arc += pz; // (a flat bottom: half its width each side)
    for (let j = 1; j <= m; j++) {
      const y = k + ((s - k) * j) / m;
      const z = hull.half(x, Math.min(s - 1e-6, y));
      arc += Math.hypot(y - py, z - pz);
      py = y;
      pz = z;
    }
    A += 2 * arc * dx;
  }
  // the transom: the stern section's area
  const x = hull.x0 + 1e-6;
  const k = hull.keel(x), s = hull.sheer(x);
  for (let j = 0; j < m; j++) A += 2 * hull.half(x, k + ((s - k) * (j + 0.5)) / m) * ((s - k) / m);
  return A;
}

/**
 * The hull as cells (n along, m across, l up), each sub-sampled sub³ times for the envelope
 * (v) and the open inside (vin, the envelope less `shell` m of planking; `solid`: none).
 * `material`: the planking's volume Σ(v − vin) is set to it. Also the gunwale: points along
 * both sheer lines with the length of gunwale each stands for.
 */
export function sampleHull(hull, { n = 32, m = 12, l = 7, sub = 3, shell = 0.016, solid = false, material = null } = {}) {
  const dx = (hull.x1 - hull.x0) / n;
  const dz = hull.B / m;
  const top = hull.D;
  const dy = top / l;
  const X = [], Y = [], Z = [], V = [], VI = [], C = [];
  const inner = (x, y, z) => {
    if (solid) return false;
    if (x < hull.x0 + shell || x > hull.x1 - shell) return false;
    if (y > hull.sheer(x)) return false;
    return Math.abs(z) + shell < hull.half(x, y) && hull.half(x, y - shell) > Math.abs(z) && y - shell >= hull.keel(x);
  };
  const s3 = sub * sub * sub;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < l; j++)
      for (let k = 0; k < m; k++) {
        const cx = hull.x0 + (i + 0.5) * dx;
        const cy = (j + 0.5) * dy;
        const cz = -hull.B / 2 + (k + 0.5) * dz;
        let o = 0, ii = 0;
        for (let a = 0; a < sub; a++)
          for (let b = 0; b < sub; b++)
            for (let c = 0; c < sub; c++) {
              const x = cx + ((a + 0.5) / sub - 0.5) * dx;
              const y = cy + ((b + 0.5) / sub - 0.5) * dy;
              const z = cz + ((c + 0.5) / sub - 0.5) * dz;
              if (Math.abs(z) < hull.half(x, y)) {
                o++;
                if (inner(x, y, z)) ii++;
              }
            }
        if (!o) continue;
        const cv = dx * dy * dz;
        X.push(cx); Y.push(cy); Z.push(cz); V.push((cv * o) / s3); VI.push((cv * ii) / s3); C.push(i * m + k);
      }
  const N = X.length;
  // (each cell's column: the waves are asked for once a column, at its middle height)
  const cells = { n: N, x: Float32Array.from(X), y: Float32Array.from(Y), z: Float32Array.from(Z), v: Float64Array.from(V), vin: Float64Array.from(VI), col: Int32Array.from(C), ncol: n * m, colMid: [n, m, top / 2], dx, dy, dz };
  let Vout = 0, Vin = 0;
  for (let i = 0; i < N; i++) {
    Vout += cells.v[i];
    Vin += cells.vin[i];
  }
  // the planking's volume: as the material makes it (the sampling only resolves it roughly)
  if (material != null && !solid && Vout - Vin > 0) {
    const s = material / (Vout - Vin);
    Vin = 0;
    for (let i = 0; i < N; i++) {
      cells.vin[i] = Math.max(0, cells.v[i] - (cells.v[i] - cells.vin[i]) * s);
      Vin += cells.vin[i];
    }
  }
  cells.Vout = Vout;
  cells.Vin = Vin;
  // the gunwale: where water comes over the side
  const gun = [];
  const ng = 24;
  const gl = (hull.x1 - hull.x0) / ng;
  for (let i = 0; i < ng; i++) {
    const x = hull.x0 + (i + 0.5) * gl;
    const s = hull.sheer(x) - 1e-4;
    const w = hull.half(x, s);
    if (w <= 0) continue;
    gun.push([x, s, w, gl], [x, s, -w, gl]);
  }
  cells.gunwale = gun;
  return cells;
}

/* ------------------------------------------------------------------ the body */

/**
 * A floating body from a hull: its cells, mass and centre of mass (hull, loads, people),
 * inertia, added mass, damping. opts:
 *   material   HULL_MATERIALS key (the hull's mass and planking from its surface), or
 *   mass, cg   given (a box of one density: solid; the carrier: its displacement, KG)
 *   loads      [{ m, p: [x, y, z] (hull frame), label }]: cargo, people, oars
 *   flotation  m³ of sealed buoyancy tanks (water cannot come in there)
 *   holes      [{ p, area }]: holes in the planking (m²)
 *   rho        the water's density (RHO_SEA or RHO_FRESH)
 *   cells      sampleHull options (n, m, l: resolution)
 *   gyration   [roll, pitch] radii of gyration as fractions of B and L (0.38, 0.26)
 *   windage    { area, height }: the side area above the water (m²) and its centre's height
 *              over the keel: the wind heels it
 */
export function makeBody(opts) {
  const hull = opts.hull.half ? opts.hull : hullFrom(opts.hull);
  const mat = opts.material ? HULL_MATERIALS[opts.material] ?? HULL_MATERIALS.wood : null;
  let hullMass = opts.mass ?? 0;
  let Vmat = null;
  if (mat) {
    const area = hullArea(hull);
    hullMass = area * mat.t * mat.rho * mat.structure;
    Vmat = hullMass / mat.rho;
  }
  const cells = opts.cellsData ?? sampleHull(hull, { ...(opts.cells ?? {}), shell: Math.max(mat?.t ?? 0.02, 0.02), solid: !!opts.solid, material: Vmat });
  // the hull's own centre of mass: given, or the planking's (the cells' shell part)
  let cg = opts.cg;
  if (!cg) {
    let s = 0, gx = 0, gy = 0, gz = 0;
    for (let i = 0; i < cells.n; i++) {
      const w = opts.solid ? cells.v[i] : cells.v[i] - cells.vin[i];
      s += w; gx += w * cells.x[i]; gy += w * cells.y[i]; gz += w * cells.z[i];
    }
    cg = s > 0 ? [gx / s, gy / s, gz / s] : [0, hull.D / 2, 0];
  }
  const body = {
    hull, cells, material: opts.material ?? null, hullMass, hullMass0: hullMass, hullCg: cg, loads: opts.loads ?? [],
    rho: opts.rho ?? RHO_SEA, flotation: opts.flotation ?? 0, holes: opts.holes ?? [], windage: opts.windage ?? null,
    gyration: opts.gyration ?? [0.38, 0.26], zeta: { h: 0.25, r: 0.08, p: 0.3, ...(opts.zeta ?? {}) },
    // the state: the reference point (the dry centre of mass) in the world, the angles, rates
    X: 0, Y: 0, Z: 0, yaw: 0, roll: 0, pitch: 0, vy: 0, wr: 0, wp: 0, water: 0, t: 0,
    sunk: false, swamped: false, aground: false,
  };
  updateMass(body);
  return body;
}

/** Mass, centre of mass and inertia after the loads (or the hull) changed. */
export function updateMass(b) {
  let M = b.hullMass;
  let gx = b.hullMass * b.hullCg[0], gy = b.hullMass * b.hullCg[1], gz = b.hullMass * b.hullCg[2];
  for (const L of b.loads) {
    M += L.m;
    gx += L.m * L.p[0]; gy += L.m * L.p[1]; gz += L.m * L.p[2];
  }
  const newG = [gx / M, gy / M, gz / M];
  // keep the hull where it is in the world: the reference point moves with G
  if (b.G) {
    const R = rot(b.yaw, b.roll, b.pitch);
    const d = mulv(R, [newG[0] - b.G[0], newG[1] - b.G[1], newG[2] - b.G[2]]);
    b.X += d[0]; b.Y += d[1]; b.Z += d[2];
  }
  b.M = M;
  b.G = newG;
  const { L, B } = b.hull;
  b.Iroll = M * (b.gyration[0] * B) ** 2 * 1.2; // (+20 %: the water rolled with it)
  b.Ipitch = M * (b.gyration[1] * L) ** 2 * 1.5;
  b.addedMass = 0.35 * b.rho * (Math.PI / 8) * (0.9 * B) ** 2 * (0.9 * L);
  // what can flood: the open inside, less its buoyancy tanks (a sealed double bottom: the lowest
  // of it, foam under the floorboards; they displace, but no water gets in)
  if (b._vflFor !== b.flotation || !b.vfl) {
    const c = b.cells;
    b.vfl = Float64Array.from(c.vin);
    let left = b.flotation;
    const order = [...Array(c.n).keys()].filter((i) => c.vin[i] > 0).sort((p, q) => c.y[p] - c.y[q]);
    for (const i of order) {
      if (left <= 0) break;
      const t = Math.min(left, b.vfl[i]);
      b.vfl[i] -= t;
      left -= t;
    }
    b._vflFor = b.flotation;
  }
  b.Vcap = Math.max(0, b.cells.Vin - b.flotation);
  // (its damping is tuned again when its mass has changed by 5 %: stepBody)
  return b;
}

/** Row-major R = Ry(yaw) · Rx(roll) · Rz(pitch) (radians: as models/composite.js rotationMatrix). */
export function rot(yaw, roll, pitch) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(roll), sx = Math.sin(roll), cz = Math.cos(pitch), sz = Math.sin(pitch);
  const a = [cz, -sz, 0, cx * sz, cx * cz, -sx, sx * sz, sx * cz, cx];
  return [cy * a[0] + sy * a[6], cy * a[1] + sy * a[7], cy * a[2] + sy * a[8], a[3], a[4], a[5], -sy * a[0] + cy * a[6], -sy * a[1] + cy * a[7], -sy * a[2] + cy * a[8]];
}
const mulv = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];

/** A hull-frame point in the world, in the body's pose (or another: { Y, roll, pitch }). */
export function toWorld(b, p, pose = b) {
  const R = rot(b.yaw, pose.roll, pose.pitch);
  const d = mulv(R, [p[0] - b.G[0], p[1] - b.G[1], p[2] - b.G[2]]);
  return [b.X + d[0], pose.Y + d[1], b.Z + d[2]];
}

/** The hull frame's origin (keel amidships) in the world and the rotation: what is drawn. */
export function framePose(b) {
  const R = rot(b.yaw, b.roll, b.pitch);
  const d = mulv(R, b.G);
  return { p: [b.X - d[0], b.Y - d[1], b.Z - d[2]], R, yaw: b.yaw, roll: b.roll, pitch: b.pitch };
}

/* ------------------------------------------------------------------ the water */

/**
 * The waves of a weather (as render/ocean.js draws them): significant height of a fully
 * developed sea Hs ≈ 0.15 + 0.0246·U² (capped for the scale of the scenes; above ~10 m/s it grows
 * more slowly, up to 4.5 m), the peak wavelength 0.83·U² (7–110 m), eight components spread round
 * the wind, each travelling at the deep-water speed ω = √(g·k).
 */
export const WAVE_SHARE = [1, 0.63, 0.41, 0.27, 0.18, 0.12, 0.08, 0.055];
export const WAVE_SPREAD = [0, 0.45, -0.38, 0.8, -0.7, 1.05, -0.95, 0.25];
export function waveSpectrum(weather = {}) {
  const U = weather.windSpeed ?? 0;
  const dir = ((weather.windDir ?? 0) * Math.PI) / 180;
  const Hs = Math.min(U <= 9.5 ? 2.2 : 2.2 + (U - 9.5) * 0.16, 4.5, 0.15 + 0.0246 * U * U);
  const Lp = Math.min(110, Math.max(7, 0.83 * U * U));
  const turb = Math.max(0, Math.min(1, weather.waterTurbulence ?? 0));
  const sum = WAVE_SHARE.reduce((a, b) => a + b, 0);
  const waves = WAVE_SHARE.map((f, k) => {
    const L = Lp * f;
    const a = dir + WAVE_SPREAD[k] * (0.5 + 0.5 * Math.min(1, U / 8));
    const amp = (Hs / 2) * (f / sum) * 1.6 * (k >= 3 ? 1 + 1.5 * turb : 1);
    const kk = (2 * Math.PI) / L;
    return { dx: Math.cos(a), dz: Math.sin(a), k: kk, amp, omega: Math.sqrt(G * kk), phase: k * 1.7 };
  });
  return { Hs, Lp, U, dir, waves };
}

/** The height of those waves (m, over the still level) at (x, z) at time t. */
export function waveHeight(spec, x, z, t) {
  let y = 0;
  for (const w of spec.waves) y += w.amp * Math.sin(w.k * (w.dx * x + w.dz * z) - w.omega * t + w.phase);
  return y;
}

/** The water surface an env gives: its level, plus its waves (a function, or a spectrum). */
export function surfaceOf(env) {
  const lvl = env.level ?? 0;
  if (env.surface) return env.surface;
  if (env.waves?.waves?.length && env.waves.Hs > 0) {
    const sp = env.waves;
    const t = env.t ?? 0;
    return (x, z) => lvl + waveHeight(sp, x, z, t);
  }
  return () => lvl;
}

/* ------------------------------------------------------------------ the forces */

/**
 * Buoyancy and its moment about the reference point (world axes), in a pose: { F (N), tx, tz
 * (N·m about world x and z), V (m³ submerged), cb (centre of buoyancy), minY (the lowest point) }.
 */
export function hydro(b, pose, surf, ampMax = Infinity) {
  const R = rot(b.yaw, pose.roll, pose.pitch);
  const c = b.cells;
  const [gx, gy, gz] = b.G;
  let V = 0, mx = 0, my = 0, mz = 0, minY = Infinity;
  const dy = c.dy;
  const still = surf.still;
  const shell = b.shellLoss || 0;
  // the water's height over each column of the hull (its middle in this pose), when it has waves
  const eta = (b._eta && b._eta.length === c.ncol ? b._eta : (b._eta = new Float32Array(c.ncol))).fill(NaN);
  for (let i = 0; i < c.n; i++) {
    const lx = c.x[i] - gx, ly = c.y[i] - gy, lz = c.z[i] - gz;
    const wx = R[0] * lx + R[1] * ly + R[2] * lz;
    const wy = pose.Y + R[3] * lx + R[4] * ly + R[5] * lz;
    const wz = R[6] * lx + R[7] * ly + R[8] * lz;
    if (wy < minY) minY = wy;
    let f;
    // (deep under any wave, or high over it: no need to ask the waves)
    if (still !== undefined && wy + dy < still - ampMax) f = 1;
    else if (still !== undefined && wy - dy > still + ampMax) f = 0;
    else {
      const k = c.col[i];
      let e = eta[k];
      if (e !== e) {
        // (the column's middle: where the cell is, at the hull's mid-height)
        const up = c.colMid[2] - ly - gy;
        e = eta[k] = surf(b.X + wx + R[1] * up, b.Z + wz + R[7] * up);
      }
      f = (e - (wy - dy / 2)) / dy;
      f = f < 0 ? 0 : f > 1 ? 1 : f;
    }
    if (!f) continue;
    // (its planking burnt away: less of its shell to float on, checkPlanking)
    const v = (shell ? c.v[i] - shell * (c.v[i] - c.vin[i]) : c.v[i]) * f;
    V += v;
    mx += v * wx; my += v * wy; mz += v * wz;
  }
  const F = b.rho * G * V;
  // moment of the upward forces about the reference point: r × (0, F, 0) = (−rz·F, 0, rx·F)
  const cb = V > 0 ? [mx / V, my / V, mz / V] : [0, pose.Y, 0];
  return { F, V, tx: -cb[2] * F, tz: cb[0] * F, cb: [b.X + cb[0], cb[1], b.Z + cb[2]], minY };
}

/**
 * The water aboard in a pose: where it lies (it fills the open inside from its lowest cells up:
 * bisection on its level) → { level (world y), c: [x, y, z] relative to the reference point }.
 */
export function waterAboard(b, pose) {
  const V = b.water;
  if (V <= 1e-9) return null;
  const R = rot(b.yaw, pose.roll, pose.pitch);
  const c = b.cells;
  const vin = b.vfl ?? c.vin;
  const [gx, gy, gz] = b.G;
  const n = c.n;
  const ys = (b._ys ??= new Float32Array(n));
  const xs = (b._xs ??= new Float32Array(n));
  const zs = (b._zs ??= new Float32Array(n));
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) {
    if (!vin[i]) continue;
    const lx = c.x[i] - gx, ly = c.y[i] - gy, lz = c.z[i] - gz;
    xs[i] = R[0] * lx + R[1] * ly + R[2] * lz;
    ys[i] = R[3] * lx + R[4] * ly + R[5] * lz;
    zs[i] = R[6] * lx + R[7] * ly + R[8] * lz;
    lo = Math.min(lo, ys[i] - c.dy);
    hi = Math.max(hi, ys[i] + c.dy);
  }
  const filled = (lvl) => {
    let s = 0;
    for (let i = 0; i < n; i++) {
      if (!vin[i]) continue;
      const f = Math.min(1, Math.max(0, (lvl - (ys[i] - c.dy / 2)) / c.dy));
      s += vin[i] * f;
    }
    return s;
  };
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2;
    if (filled(mid) < V) lo = mid;
    else hi = mid;
  }
  const lvl = (lo + hi) / 2;
  let s = 0, cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) {
    if (!vin[i]) continue;
    const f = Math.min(1, Math.max(0, (lvl - (ys[i] - c.dy / 2)) / c.dy));
    const v = vin[i] * f;
    s += v; cx += v * xs[i]; cy += v * ys[i]; cz += v * zs[i];
  }
  return { level: pose.Y + lvl, c: s > 0 ? [cx / s, cy / s, cz / s] : [0, 0, 0] };
}

/* ------------------------------------------------------------------ at rest */

/**
 * Where it floats at rest on still water at `level`: the heave where buoyancy carries the weight
 * (bisection), then the heel and trim where their moments vanish (Newton on the numerical
 * stiffness), again. → { Y, roll, pitch, draft (keel amidships to the waterline), V, sinks }.
 * `sinks`: even wholly under it does not carry its weight (overloaded, or a dense hull swamped).
 */
export function equilibrium(b, { level = 0, roll = 0, pitch = 0 } = {}) {
  const surf = () => level;
  const W = (b.M + b.rho * b.water) * G;
  const pose = { Y: level, roll, pitch };
  const lo0 = level - b.hull.D * 2 - 1, hi0 = level + b.hull.D * 2 + 1;
  const heave = () => {
    let lo = lo0, hi = hi0;
    for (let k = 0; k < 50; k++) {
      pose.Y = (lo + hi) / 2;
      if (hydro(b, pose, surf).F > W) lo = pose.Y; // (it carries more than its weight: it rides higher)
      else hi = pose.Y;
    }
    pose.Y = (lo + hi) / 2;
  };
  const full = hydro(b, { Y: lo0, roll: 0, pitch: 0 }, surf);
  if (full.F < W) return { Y: lo0, roll: 0, pitch: 0, draft: Infinity, V: full.V, sinks: true };
  const moments = () => {
    const h = hydro(b, pose, surf);
    const wm = waterMoment(b, pose);
    const R = rot(b.yaw, pose.roll, pose.pitch);
    const ax = [R[0], R[3], R[6]], az = [R[2], R[5], R[8]];
    const tx = h.tx + wm.tx, tz = h.tz + wm.tz;
    return [tx * ax[0] + tz * ax[2], tx * az[0] + tz * az[2]];
  };
  for (let it = 0; it < 6; it++) {
    heave();
    const [r0, p0] = moments();
    const d = 0.004;
    pose.roll += d;
    const [r1] = moments();
    pose.roll -= d;
    pose.pitch += d;
    const [, p1] = moments();
    pose.pitch -= d;
    const kr = (r1 - r0) / d, kp = (p1 - p0) / d;
    if (kr < 0) pose.roll = Math.max(-0.6, Math.min(0.6, pose.roll - r0 / kr));
    if (kp < 0) pose.pitch = Math.max(-0.6, Math.min(0.6, pose.pitch - p0 / kp));
  }
  heave();
  const h = hydro(b, pose, surf);
  const origin = toWorld(b, [0, 0, 0], pose);
  // (the draft along its own upright, keel amidships to the waterline: what its sides show)
  const R = rot(b.yaw, pose.roll, pose.pitch);
  return { Y: pose.Y, roll: pose.roll, pitch: pose.pitch, draft: (level - origin[1]) / Math.max(0.3, R[4]), V: h.V, sinks: false };
}

/** The weight of the water aboard and its moment about the reference point (world axes). */
function waterMoment(b, pose) {
  if (b.water <= 1e-9) return { F: 0, tx: 0, tz: 0 };
  const wa = waterAboard(b, pose);
  const F = b.rho * b.water * G;
  // r × (0, −F, 0) = (rz·F, 0, −rx·F)
  return { F, tx: wa.c[2] * F, tz: -wa.c[0] * F, level: wa.level };
}

/**
 * Stability: heeled by `deg` (its heave found again for the same displacement), the righting
 * arm GZ (m) and from it the metacentric height GM ≈ GZ / sin φ (m).
 */
export function stability(b, { level = 0, deg = 3 } = {}) {
  const eq = equilibrium(b, { level });
  if (eq.sinks) return { GZ: 0, GM: -Infinity, eq };
  const phi = (deg * Math.PI) / 180;
  const surf = () => level;
  const pose = { Y: eq.Y, roll: eq.roll + phi, pitch: eq.pitch };
  const W = (b.M + b.rho * b.water) * G;
  let lo = eq.Y - b.hull.D, hi = eq.Y + b.hull.D;
  for (let k = 0; k < 50; k++) {
    pose.Y = (lo + hi) / 2;
    if (hydro(b, pose, surf).F > W) lo = pose.Y;
    else hi = pose.Y;
  }
  const h = hydro(b, pose, surf);
  const wm = waterMoment(b, pose);
  const R = rot(b.yaw, pose.roll, pose.pitch);
  const tr = (h.tx + wm.tx) * R[0] + (h.tz + wm.tz) * R[6];
  const GZ = -tr / W; // (heeled to starboard: a moment back to port rights it)
  return { GZ, GM: GZ / Math.sin(phi), eq };
}

/** Put it at rest on still water: its reference point over (x, z), afloat at `level`, heading yaw. */
export function placeAt(b, x, level, z, yaw = 0) {
  b.yaw = yaw;
  const eq = equilibrium(b, { level });
  // its keel amidships over (x, z): the reference point is G
  const R = rot(yaw, eq.roll, eq.pitch);
  const d = mulv(R, b.G);
  b.X = x + d[0];
  b.Z = z + d[2];
  b.Y = eq.Y;
  b.roll = eq.roll;
  b.pitch = eq.pitch;
  b.vy = b.wr = b.wp = 0;
  b.eq = eq;
  return eq;
}

/* ------------------------------------------------------------------ in motion */

/** Stiffness and natural periods at rest (for the damping and the step size). */
function tune(b, level) {
  const surf = () => level;
  const eq = equilibrium(b, { level });
  if (eq.sinks) {
    // (it cannot float: it keeps the damping it had afloat, or one from its size, as it goes down)
    if (b.tuned?.Kh) return Object.assign(b.tuned, { M: b.M });
    const Kh = b.rho * G * b.hull.L * b.hull.B * 0.7;
    const mh = b.M + b.addedMass;
    const Kr = Kh * b.hull.B * b.hull.B * 0.05, Kp = Kh * b.hull.L * b.hull.L * 0.05;
    b.tuned = { Kh, Kr, Kp, GM: -Infinity, ch: 2 * b.zeta.h * Math.sqrt(Kh * mh), cr: 2 * b.zeta.r * Math.sqrt(Kr * b.Iroll), cp: 2 * b.zeta.p * Math.sqrt(Kp * b.Ipitch), h: 0.05, eqY: eq.Y, M: b.M, periods: [] };
    return b.tuned;
  }
  const d = Math.max(0.002, b.hull.D * 0.005);
  const F0 = hydro(b, { Y: eq.Y - d, roll: eq.roll, pitch: eq.pitch }, surf).F;
  const F1 = hydro(b, { Y: eq.Y + d, roll: eq.roll, pitch: eq.pitch }, surf).F;
  const Kh = Math.max(1, (F0 - F1) / (2 * d));
  const st = stability(b, { level, deg: 2 });
  const W = (b.M + b.rho * b.water) * G;
  const Kr = Math.max(1, W * Math.max(0.02 * b.hull.B, st.GM));
  // pitch: GM_L ≈ BM_L = I_L / V ≈ L² / (12 T) · (waterplane fullness): from Kh as A_wp
  const Awp = Kh / (b.rho * G);
  const Kp = Math.max(1, b.rho * G * Awp * (0.7 * b.hull.L) ** 2 / 12);
  const mh = b.M + b.addedMass;
  const z = b.zeta;
  const wh = Math.sqrt(Kh / mh), wr = Math.sqrt(Kr / b.Iroll), wp = Math.sqrt(Kp / b.Ipitch);
  b.tuned = {
    ch: 2 * z.h * Math.sqrt(Kh * mh), cr: 2 * z.r * Math.sqrt(Kr * b.Iroll), cp: 2 * z.p * Math.sqrt(Kp * b.Ipitch),
    Kh, Kr, Kp, GM: st.GM, periods: [2 * Math.PI / wh, 2 * Math.PI / wr, 2 * Math.PI / wp],
    h: Math.min(0.25, (2 * Math.PI) / Math.max(wh, wr, wp) / 30), eqY: eq.Y, M: b.M,
  };
  return b.tuned;
}

/**
 * One step (dt s, cut into stable sub-steps) on the water of `env`:
 *   { level, t, waves (waveSpectrum) | surface(x, z) (absolute height), bottom (y), wind:
 *     { speed, dir (radians, where it blows to) }, rain (mm/h), external: { tx, tz } }.
 * Water comes in (holes, over the gunwale); the body heaves, rolls and pitches. Returns it.
 */
export function stepBody(b, dt, env = {}) {
  const level = env.level ?? 0;
  if (!b.tuned || Math.abs(b.tuned.M - b.M) > 0.05 * b.M) tune(b, level);
  b.t = env.t ?? b.t + dt;
  const surf0 = surfaceOf({ ...env, t: b.t });
  const surf = (x, z) => surf0(x, z);
  surf.still = level;
  const amp = env.waves ? env.waves.waves.reduce((s, w) => s + w.amp, 0) : env.surface ? env.ampMax ?? 3 : 0;
  // the water aboard: in through the holes and over the gunwale (out through holes above it)
  inflow(b, dt, surf, env);
  const T = b.tuned;
  const n = Math.max(1, Math.ceil(dt / T.h));
  const h = dt / n;
  const wa = b.water > 1e-9 ? waterMoment(b, b) : { F: 0, tx: 0, tz: 0 };
  // the wind on the side above the water: F = ½·ρ_a·C_d·A·U⊥², at the centre of that area
  let wtx = env.external?.tx ?? 0, wtz = env.external?.tz ?? 0;
  if (b.windage && env.wind?.speed) {
    const across = Math.sin(env.wind.dir - b.yaw); // (the wind's part across the boat)
    const U = env.wind.speed * across;
    const Fw = 0.5 * RHO_AIR * 1.1 * b.windage.area * U * Math.abs(U);
    const arm = b.windage.height - (b.eq?.draft ?? 0) / 2;
    // heels it away from the wind: about its long axis (world, from its heading)
    wtx += Fw * arm * Math.cos(b.yaw);
    wtz += -Fw * arm * Math.sin(b.yaw);
  }
  for (let s = 0; s < n; s++) {
    const hy = hydro(b, b, surf, amp);
    const R = rot(b.yaw, b.roll, b.pitch);
    const W = (b.M + b.rho * b.water) * G;
    const mh = b.M + b.addedMass + b.rho * b.water;
    // heave: buoyancy less weight, damped (waves made, drag ½·ρ·1.0·A_wp·|v|·v)
    const Awp = T.Kh / (b.rho * G);
    const Fy = hy.F - W - T.ch * b.vy - 0.5 * b.rho * 1.0 * Awp * Math.abs(b.vy) * b.vy;
    b.vy += (Fy / mh) * h;
    b.Y += b.vy * h;
    // roll and pitch: the moments about the body's own axes
    const tx = hy.tx + wa.tx + wtx, tz = hy.tz + wa.tz + wtz;
    const tr = tx * R[0] + tz * R[6];
    const tp = tx * R[2] + tz * R[8];
    const qr = 0.5 * b.rho * 1.2 * b.hull.L * (b.hull.B / 2) ** 4 * 0.25; // (bilge drag of a rolling hull)
    b.wr += ((tr - T.cr * b.wr - qr * Math.abs(b.wr) * b.wr) / b.Iroll) * h;
    b.wp += ((tp - T.cp * b.wp) / b.Ipitch) * h;
    b.roll += b.wr * h;
    b.pitch += b.wp * h;
    // on the bottom: it rests there
    if (env.bottom !== undefined && hy.minY < env.bottom) {
      b.Y += env.bottom - hy.minY;
      if (b.vy < 0) b.vy = 0;
      b.wr *= 0.9;
      b.wp *= 0.9;
      b.aground = true;
    } else b.aground = false;
  }
  // the state: swamped (full of water), sunk (under, or down on the bottom full of water)
  const pose = framePose(b);
  const top = Math.min(...[[b.hull.x0 * 0.7, 0], [b.hull.x1 * 0.7, 0], [0, b.hull.B * 0.45], [0, -b.hull.B * 0.45]].map(([x, z]) => {
    const w = toWorld(b, [x, b.hull.sheer(x), z]);
    return w[1] - surf(w[0], w[2]);
  }));
  b.freeboard = top;
  b.swamped = b.Vcap > 0 && b.water >= b.Vcap * 0.98;
  const deck = toWorld(b, [0, b.hull.sheer(0), 0]);
  b.sunk = deck[1] < surf(deck[0], deck[2]) - 0.05 && (b.swamped || b.Vcap === 0) && b.vy <= 0.05;
  b.pose = pose;
  return b;
}

/** Water in (or out) through the holes and over the gunwale, for dt. */
function inflow(b, dt, surf, env) {
  if (b.Vcap <= 0) return;
  const inside = b.water > 1e-9 ? waterAboard(b, b).level : -Infinity;
  let Q = 0;
  for (const hole of b.holes) {
    const w = toWorld(b, hole.p);
    const out = surf(w[0], w[2]);
    const yin = Math.max(inside, w[1]);
    if (out > yin) Q += 0.62 * hole.area * Math.sqrt(2 * G * (out - yin)); // Torricelli, C_d 0.62
    else if (inside > w[1] && inside > out) Q -= 0.62 * hole.area * Math.sqrt(2 * G * (inside - Math.max(out, w[1])));
  }
  // over the gunwale where it is under: a sharp-crested weir, 0.6·⅔·√(2g) ≈ 1.77
  for (const [x, y, z, len] of b.cells.gunwale) {
    const w = toWorld(b, [x, y, z]);
    const d = surf(w[0], w[2]) - w[1];
    if (d > 0) Q += 1.77 * len * Math.pow(d, 1.5);
  }
  // rain into the open boat (mm/h over its plan)
  if (env.rain) Q += (env.rain / 3.6e6) * b.hull.L * b.hull.B * 0.7;
  b.inflow = Q;
  b.water = Math.max(0, Math.min(b.Vcap, b.water + Q * dt));
}

/* ------------------------------------------------------------------ the carrier */

/**
 * The aircraft carrier's hull as a floating body: a Nimitz-class hull (317 m on the waterline,
 * 40.8 m wide there), ~100 000 t with its centre of mass 15 m over the keel (KG). Floats at
 * ~11 m: its draft, heel and trim come from Archimedes as for the boat. The flight deck the
 * game simulates is a section of it (models/carrier.js); water aboard there adds its weight
 * at its place (sim/water.js stepBuoyancy).
 */
export function carrierBody({ displacement = 1.0e8, kg = 15, length = 317, beam = 40.8, rho = RHO_SEA } = {}) {
  const b = makeBody({
    hull: { kind: 'ship', length, beam, depth: 28 },
    solid: true, // (its watertight volume: the sea comes in only where the game floods it)
    mass: displacement,
    cg: [0, kg, 0],
    rho,
    gyration: [0.4, 0.25],
    zeta: { h: 0.3, r: 0.06, p: 0.35 },
    cells: { n: 60, m: 16, l: 14, sub: 2 },
  });
  // loaded to float level (as a ship is trimmed): its centre of mass over the centre of buoyancy
  const surf = () => 0;
  const W = b.M * G;
  let lo = -40, hi = 40;
  for (let k = 0; k < 50; k++) {
    const Y = (lo + hi) / 2;
    if (hydro(b, { Y, roll: 0, pitch: 0 }, surf).F > W) lo = Y;
    else hi = Y;
  }
  const cb = hydro(b, { Y: lo, roll: 0, pitch: 0 }, surf).cb;
  b.hullCg = [b.hullCg[0] + cb[0] - b.X, kg, 0];
  b.G = null;
  return updateMass(b);
}

/* ------------------------------------------------------------------ in the simulation */

const bodyCache = new Map();

/** A floating body for a model's float spec (models/rowBoat.js floatSpec), cells shared by shape. */
export function bodyFromSpec(spec, rho = RHO_SEA) {
  const key = JSON.stringify([spec.hull, spec.material, spec.cells ?? null]);
  let proto = bodyCache.get(key);
  if (!proto) {
    proto = makeBody({ hull: spec.hull, material: spec.material, cells: spec.cells });
    if (bodyCache.size > 32) bodyCache.clear();
    bodyCache.set(key, proto);
  }
  // (the cells and the planking as the prototype's: no need to sample the hull again)
  const b = makeBody({ hull: proto.hull, cellsData: proto.cells, mass: proto.hullMass, cg: proto.hullCg, loads: spec.loads, flotation: spec.flotation, rho, windage: spec.windage });
  b.material = spec.material;
  return b;
}

/**
 * The floating things of a world (world.floats: rowing boats), one step: each on the water
 * under it (the sea: its level and the waves of the weather, or what the view draws:
 * world.waveAt; a pond: its still surface, fresh water), its burnt planking letting the water in.
 */
export function stepFloats(sim, dt) {
  const w = sim.world;
  if (!w.floats?.length) return;
  for (const f of w.floats) {
    if (!f.body) initFloat(sim, f);
    if (!f.water) continue; // (on dry land: it stays as it was put)
    // its planking: burnt or blown away below the sheer it lets the water in (every half second)
    f.check = (f.check ?? 0) - dt;
    if (f.check <= 0 && f.mb) {
      f.check = 0.5;
      checkPlanking(w, f);
    }
    const env = {
      level: f.water.level,
      t: w.time,
      bottom: f.bottom,
      wind: sim.weather?.windSpeed ? { speed: sim.weather.windSpeed, dir: ((sim.weather.windDir ?? 0) * Math.PI) / 180 } : null,
      rain: sim.weather?.rain ?? 0,
    };
    if (f.water.sea) {
      if (w.waveAt) {
        env.surface = (x, z) => f.water.level + w.waveAt(x, z);
        env.ampMax = 3;
      } else {
        // (no view drawing the sea: the weather's waves, lower in the shallows by the shore as
        // render/ocean.js has them: shoaling, down to 12 % where it is shallower than 1.3·Hs)
        const W = sim.weather ?? {};
        if (!f.waves || f.wavesU !== W.windSpeed || f.wavesD !== W.windDir) {
          f.wavesU = W.windSpeed;
          f.wavesD = W.windDir;
          const sp = waveSpectrum(W);
          const shoal = Math.min(1, Math.max(0.12, (f.water.level - f.bottom) / Math.max(0.6, 1.3 * sp.Hs)));
          f.waves = { ...sp, Hs: sp.Hs * shoal, waves: sp.waves.map((wv) => ({ ...wv, amp: wv.amp * shoal })) };
        }
        env.waves = f.waves;
      }
    }
    stepBody(f.body, dt, env);
    f.surf = surfaceOf(env); // (the water's surface round it now, its waves too: quenchBelow)
    if (f.row) moveBoat(sim, f, dt, env);
    // its keel on a soft bottom: a furrow, held back; its wake (sim/groundContact.js)
    if (f.row) boatGround(sim, f, dt, { owns: (i) => floatOwns(f, i), toWorld, level: f.water.level });
    // its voxels (and their heat, fire, char) where it is now (sim/movingBody.js)
    f.stampT = (f.stampT ?? 0) - dt;
    if (f.mb && f.stampT <= 0) stampFloat(w, f);
    // (on a pond: what ran in through the joints between its voxels since, out again, every step)
    else if (f.mb && f.water && !f.water.sea && f.mb.stamps > 0) displaceLiquid(w, f.mb, hullOpts(f.body.hull));
    // the air round it dragged along as it goes (its plume trails behind it: sim/bodyAir.js)
    if (f.mb && f.body.pose && Math.hypot(f.body.vx ?? 0, f.body.vz ?? 0) > 0.3) dragAir(w, f.mb, f.body.pose, [f.body.vx, 0, f.body.vz], [0, f.body.wy ?? 0, 0]);
    if (f.seats) placeCrew(f);
    if (f.body.sunk && !f.sunkNoted) {
      f.sunkNoted = true;
      w.events.push({ type: 'sinking', pos: f.body.pose.p, time: w.time, name: f.label ?? 'a boat' });
    }
  }
}

/** The water it is on (the sea, or a pond under it), its density, the bottom; its body, at rest. */
export function initFloat(sim, f) {
  const w = sim.world;
  const at = f.at;
  // the sea, if its level is near the boat's waterline; else water voxels under the boat
  let water = null;
  if (w.sea && Math.abs(w.sea.level - at[1]) < 1.0 && !w.sea.ship) water = { level: w.sea.level, sea: true, fresh: !!w.sea.fresh };
  else {
    // (under it, or beside it: its own hull keeps the water out of the column it is in)
    const hl = f.spec.hull.length / 2 + 0.3, hb = f.spec.hull.beam / 2 + 0.3;
    const c = Math.cos(f.yaw), sn = Math.sin(f.yaw);
    let top = null;
    for (const [lx, lz] of [[0, 0], [0, hb], [0, -hb], [hl, 0], [-hl, 0]]) {
      top = surfaceUnder(w, at[0] + lx * c + lz * sn, at[2] - lx * sn + lz * c, at[1] + 0.6);
      if (top !== null) break;
    }
    if (top !== null && Math.abs(top - at[1]) < 1.0) water = { level: top, sea: false, fresh: true };
  }
  const rho = f.waterKind === 'fresh' ? RHO_FRESH : f.waterKind === 'sea' ? RHO_SEA : water?.fresh ? RHO_FRESH : water && !water.sea ? RHO_FRESH : RHO_SEA;
  f.water = water;
  f.rho = rho;
  const b = bodyFromSpec(f.spec, rho);
  f.body = b;
  const R0 = rot(f.yaw, 0, 0);
  // the hull's keel amidships: under the model's origin (its design waterline) by its draft
  const keel = [at[0] + R0[1] * f.spec.keelY, at[1] + f.spec.keelY, at[2] + R0[7] * f.spec.keelY];
  if (water) {
    placeAt(b, keel[0], water.level, keel[2], f.yaw);
    f.bottom = bottomUnder(w, keel[0], keel[2], water.level, f);
  } else {
    b.yaw = f.yaw;
    const d = mulv(R0, b.G);
    b.X = keel[0] + d[0];
    b.Y = keel[1] + d[1];
    b.Z = keel[2] + d[2];
    b.aground = true;
    b.pose = framePose(b);
  }
  // its voxels in its own frame (where they were built: at rest, level), their state with them:
  // a moving body (sim/movingBody.js) stamped into the grid wherever it is (stampFloat)
  if (f.own?.length || f.voxels?.length) {
    const h = w.h;
    const local = (i) => {
      const [x, y, z] = w.coords(i);
      const dx = (x + 0.5) * h - keel[0], dy = (y + 0.5) * h - keel[1], dz = (z + 0.5) * h - keel[2];
      // (the inverse of the heading: its transpose)
      return [R0[0] * dx + R0[6] * dz, dy, R0[2] * dx + R0[8] * dz];
    };
    const cells = f.own?.length ? f.own : f.voxels;
    const hullSet = new Set(f.voxels ?? []);
    f.mb = makeMovingBody(w, cells, local, { pose: { p: keel, R: R0 }, owner: w.owner[cells[0]], tags: (k, i) => (hullSet.has(i) ? 1 : 0), seal: (k, i) => hullSet.has(i) });
    f.n0 = hullSet.size;
  }
  b.pose = framePose(b);
  if (f.model === 'rowBoat' || f.seats) initBoat(f);
  return f;
}

/**
 * A boat's surge, sway and yaw in the world (sim/boats.js stepDrift): the current where it is
 * (rivers, whirlpools; on the sea w.sea.current) and the wind's surface drift (~3 % of the wind on
 * the sea, 1.5 % on a pond); kept off the shore (it stops against what is solid at its waterline);
 * the water's level and the bottom under it found again as it goes (a river's reaches, over the
 * fall); f.detached once it is off its berth (its voxels go with it: stampFloat).
 */
function moveBoat(sim, f, dt, env) {
  const w = sim.world;
  const b = f.body;
  const wind = env.wind;
  const drift = wind ? (f.water.sea ? 0.03 : 0.015) * wind.speed : 0;
  const sc = f.water.sea ? w.sea?.current : null;
  const cur = [0, 0];
  env.current = (x, z) => {
    waterStirAt(w, x, z, cur);
    if (sc) {
      cur[0] += sc[0];
      cur[1] += sc[1];
    }
    if (drift) {
      cur[0] += drift * Math.cos(wind.dir);
      cur[1] += drift * Math.sin(wind.dir);
    }
    return cur;
  };
  const was = [b.X, b.Z, b.yaw];
  // (built touching something: free to move until it is clear of it)
  f.jammed ??= boatBlocked(w, f);
  stepDrift(f, dt, env);
  if (Math.abs(b.X - was[0]) + Math.abs(b.Z - was[1]) + Math.abs(b.yaw - was[2]) < 1e-7) return;
  const blocked = boatBlocked(w, f);
  if (f.jammed) f.jammed = blocked;
  else if (blocked) {
    b.X = was[0];
    b.Z = was[1];
    b.yaw = was[2];
    b.vx *= -0.2;
    b.vz *= -0.2;
    b.wy *= -0.2;
    b.pose = framePose(b);
    return;
  }
  // off its berth (its voxels go with it: stampFloat)
  const home = f.home;
  if (!f.detached && home && (Math.hypot(b.X - home.X, b.Z - home.Z) > 0.4 || Math.abs(b.yaw - home.yaw) > 0.12)) f.detached = true;
  // where it is now: the water's level (not the sea: a pond, a river's reach) and the bottom
  f.look = (f.look ?? 0) - dt;
  if (f.look <= 0) {
    f.look = 0.25;
    const k = toWorld(b, [0, 0, 0]);
    if (!f.water.sea) {
      // (round it: in its own column its hull keeps the water out, and the
      // first water under its keel is not the surface: the level read there sank with every look)
      // (the most of four round it: the top layer of a pond's voxels has holes for a moment where
      // its water flows into the room its hull leaves)
      const hb = b.hull.B / 2 + 0.3, hl = b.hull.L / 2 + 0.3;
      let top = null;
      for (const [lx, lz] of [[0, hb], [0, -hb], [hl, 0], [-hl, 0]]) {
        const q = toWorld(b, [lx, 0, lz]);
        const t = surfaceUnder(w, q[0], q[2], f.water.level + 0.6);
        if (t !== null && (top === null || t > top)) top = t;
      }
      top ??= surfaceUnder(w, k[0], k[2], f.water.level + 0.6);
      if (top !== null) f.water.level = top;
    }
    f.bottom = bottomUnder(w, k[0], k[2], f.water.level, f);
  }
}

/** Something solid (not water, not its own planking) where its hull is at its waterline, or the world's edge. */
function boatBlocked(w, f) {
  const b = f.body;
  const hull = b.hull;
  const lvl = f.water.level;
  for (const [x, z] of [[hull.x1 - 0.05, 0], [hull.x0 + 0.05, hull.B * 0.3], [hull.x0 + 0.05, -hull.B * 0.3], [0, hull.B / 2], [0, -hull.B / 2], [hull.L * 0.3, hull.B * 0.35], [hull.L * 0.3, -hull.B * 0.35]]) {
    const p = toWorld(b, [x, 0, z]);
    if (p[0] < 0 || p[2] < 0 || p[0] >= w.size[0] || p[2] >= w.size[2]) return true;
    for (const y of [lvl - 0.05, lvl + 0.2]) {
      const i = w.voxelAt(p[0], y, p[2]);
      if (i < 0) continue;
      const m = w.mat[i];
      if (m && m !== MAT.water && !floatOwns(f, i)) return true;
    }
  }
  return false;
}

function surfaceUnder(w, x, z, from) {
  const cx = Math.floor(x / w.h), cz = Math.floor(z / w.h);
  if (cx < 0 || cz < 0 || cx >= w.nx || cz >= w.nz) return null;
  let y = Math.min(w.ny - 1, Math.floor(from / w.h));
  // down through air (and the boat itself) to the first water
  for (; y >= 0; y--) {
    const m = w.mat[w.idx(cx, y, cz)];
    if (m === MAT.water) return (y + 1) * w.h;
    if (m && y * w.h < from - 1.5) return null;
  }
  return null;
}

function bottomUnder(w, x, z, level, f) {
  const cx = Math.max(0, Math.min(w.nx - 1, Math.floor(x / w.h))), cz = Math.max(0, Math.min(w.nz - 1, Math.floor(z / w.h)));
  for (let y = Math.min(w.ny - 1, Math.floor(level / w.h)); y >= 0; y--) {
    const i = w.idx(cx, y, cz);
    const m = w.mat[i];
    if (m && m !== MAT.water && !floatOwns(f, i)) return (y + 1) * w.h - rutAt(w, x, z); // (less a furrow cut in it: sim/groundContact.js)
  }
  return 0;
}

/** Cell i holds one of this float's own voxels (its planking, thwarts, oars: wherever it is now). */
export function floatOwns(f, i) {
  return f.mb ? ownsCell(f.mb, i) : (f.ownSet ??= new Set(f.own ?? f.voxels ?? [])).has(i);
}

/** Its envelope (hull frame): the planking and the open inside it encloses. */
const inHullEnvelope = (hull) => (x, y, z) => x > hull.x0 && x < hull.x1 && Math.abs(z) < hull.half(x, y);
const hullOpts = (hull) => (hull._env ??= { inside: inHullEnvelope(hull), bounds: [[hull.x0, -0.02, -hull.B / 2], [hull.x1, hull.D + 0.02, hull.B / 2]], liquid: MAT.water });

/**
 * Its voxels where it is now (sim/movingBody.js restamp), once it has moved half a voxel or more
 * (at most ten times a second): their heat, fire and char go with them; the pond's water is
 * pushed out of its hull and comes back where it was. → the restamp's counts, or null (no need).
 */
export function stampFloat(w, f, force = false) {
  const b = f.body, mb = f.mb;
  if (!mb || !b?.pose) return null;
  const hull = b.hull;
  const pond = !!f.water && !f.water.sea;
  const opts = {
    displace: (m) => m === MAT.water,
    inside: inHullEnvelope(hull),
    bounds: [[hull.x0, -0.02, -hull.B / 2], [hull.x1, hull.D + 0.02, hull.B / 2]],
    liquid: MAT.water,
    refill: pond ? { mat: MAT.water, below: f.water.level } : null,
    // (what falls off it drifts with it; the air in its hull goes with it: sim/bodyAir.js)
    vel: { v: [b.vx ?? 0, b.vy ?? 0, b.vz ?? 0], w: [0, b.wy ?? 0, 0] },
    air: { inside: inHullEnvelope(hull) },
  };
  if (!force && !needsRestamp(mb, b.pose, w.h, 0.5)) {
    // (lying still off its berth: the pond's water that ran in through the gaps between its voxels, out again)
    if (pond && mb.stamps > 0) {
      f.stampT = 0.3;
      displaceLiquid(w, mb, opts);
    }
    return null;
  }
  f.stampT = 0.1;
  return restamp(w, mb, b.pose, opts);
}

/**
 * What is left of its planking: its mass, its shell's volume, and the holes where it is gone (below
 * the sheer); what is under the water is wet through (it does not burn: a burning boat burns down
 * to its waterline).
 */
function checkPlanking(w, f) {
  const mb = f.mb;
  syncBody(w, mb);
  let left = 0, ch = 0, n = 0;
  const holes = [];
  const area = w.h * w.h;
  const hull = f.body.hull;
  const S = mb.s;
  for (let k = 0; k < mb.n; k++) {
    if (mb.tag[k] !== 1) continue;
    n++;
    if (S.mat[k]) {
      left++;
      ch += S.char[k];
      continue;
    }
    const p = [mb.local[3 * k], mb.local[3 * k + 1], mb.local[3 * k + 2]];
    if (p[1] < hull.sheer(p[0]) - 0.02) holes.push({ p, area });
  }
  f.left = n ? left / n : 1;
  f.char = left ? ch / left : 1;
  // (a hole is no bigger than the hull: the planks gone, at most the bottom's area)
  if (holes.length > 40) {
    const s = holes.length / 40;
    holes.length = 40;
    for (const h of holes) h.area *= s;
  }
  f.plankHoles = holes;
  updateHoles(f);
  // (its shell burnt away: less wood to float on once it is swamped: hydro)
  f.body.shellLoss = 1 - f.left;
  const m = f.body.hullMass0 * (0.3 + 0.7 * f.left);
  if (Math.abs(m - f.body.hullMass) > 1) {
    f.body.hullMass = m;
    updateMass(f.body);
  }
  if (f.water) quenchBelow(w, f, f.water.level);
}

/**
 * Its voxels under the water's surface: wet through, no hotter than boiling, not burning. The
 * surface where each is (on the sea its waves: it heaves with them, so what is under the still
 * level in a trough is not under the water there).
 */
function quenchBelow(w, f, level) {
  const mb = f.mb;
  const { nx, ny, h } = w;
  const surf = f.surf;
  for (let j = 0; j < mb.nCells; j++) {
    const c = mb.cellList[j];
    const y = ((Math.floor(c / nx) % ny) + 0.5) * h;
    if (y > level + 0.6) continue;
    let lv = level;
    if (surf) {
      const x = c % nx, z = Math.floor(c / (nx * ny));
      lv = surf((x + 0.5) * h, (z + 0.5) * h);
    }
    if (y > lv - 0.25 * h) continue;
    const m = w.mat[c];
    if (!m) continue;
    w.flags[c] &= ~(F_BURNING | F_SMOLDER);
    w.hrr[c] = 0;
    if (w.temp[c] > 100) w.temp[c] = 100;
    if (w.skin[c] > 100) w.skin[c] = 100;
    const wet = (MATERIALS[m]?.maxMoisture ?? 0) * 0.9;
    if (w.moist[c] < wet) w.moist[c] = wet;
    w.wetSkin[c] = 1;
  }
}
