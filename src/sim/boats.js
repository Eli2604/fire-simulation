import { G, RHO_AIR, RHO_SEA, rot, toWorld, framePose, updateMass, stepBody, bodyFromSpec, placeAt } from './buoyancy.js';

/**
 * Boats that move: a rowing boat (models/rowBoat.js) afloat (sim/buoyancy.js: heave, roll, pitch
 * by Archimedes) also surges, sways and yaws on the water:
 *
 *   drift     the hull is dragged towards the water's own velocity (a river's current, a
 *             whirlpool: sim/stirrers.js waterStirAt; on the sea w.sea.current, and everywhere
 *             the wind's surface drift, ~3 % of the wind on the sea): surge resistance
 *             ½·ρ·C_T·S·|u|·u (C_T 0.012 on the wetted surface S: friction and waves made), sway
 *             ½·ρ·C_D·L·T·|u|·u (C_D 1: a flat plate side on), yaw ½·ρ·C_D·T·ω|ω|·(L/2)⁴/2, with
 *             the water's added mass (sway: ½·ρ·π·T²·L/2); the wind on its topsides
 *             ½·ρ_air·C_D·A·|U|·U (beam on: its windage, end on a quarter of it).
 *   mooring   moored, its painter (from the stem) is made fast to a point (a bollard, a ring on
 *             the pier): slack, it swings and drifts inside the line's length; taut, the line
 *             pulls it back (a stiff elastic line, damped).
 *   rowing    the rower on the rowing thwart (facing aft) works a pair of oars in the rowlocks:
 *             each stroke (2 s: drive 42 %, recovery) pushes the boat with the blade's force
 *             (up to 160 N an oar, sin-shaped over the drive: its impulse ~ 85 N·s), at the
 *             rowlock, so pulling one oar harder (or backing the other) turns it; both: ~1.4 m/s.
 *   holes     a bullet through the planking (boatShot: the ray against the hull's own shape, in
 *             its pose) or a blast's fragments (boatBlast) make holes: below the waterline the
 *             water comes in through them by Torricelli (sim/buoyancy.js inflow), its weight
 *             takes the boat deeper, the inflow grows; it swamps and sinks (a wooden one with
 *             people aboard, an aluminium one empty). Above the waterline they do nothing until
 *             it settles that deep.
 *
 * API (f: one of world.floats, a boat; its seats in its hull frame from models/rowBoat.js seatsOf)
 *
 *   f.seats                    [{ x, y, z (hull frame: y the thwart's top), role: 'rower' |
 *                              'passenger', who }]: who sits there (null: free)
 *   boardSeat(f, who, k?)      who (a soldier, the player: any object) takes seat k, or the
 *                              rower's seat if free, else the first free one → its index, or -1.
 *                              Their weight (who.mass ?? 80 kg) goes aboard at the seat: the
 *                              boat settles deeper. who.boat = f, who.boatSeat = k.
 *   leaveSeat(f, who)          out of the boat (their weight with them) → the seat index, or -1
 *   seatWorld(f, k)            the seat's top in the world (where a seated body's hips go) →
 *                              { p: [x, y, z], yaw (the boat's heading: radians, bow along
 *                              (cos yaw, −sin yaw)), facing (the yaw that person faces: the
 *                              rower aft, the others forward) }
 *   rower(f)                   who is at the oars (null: nobody: it does not row)
 *   row(f, pull, turn)         the rower's orders for now on: pull −1..1 (back water .. pull),
 *                              turn −1..1 (to port .. to starboard: one oar pulls, the other backs)
 *   rowToward(f, target, { radius = 2 })  orders for this step that row it to target ([x, z] or
 *                              [x, y, z]): it turns towards it, pulls, slows as it gets there
 *                              (casts off first) → { dist, arrived } or null (nobody to row)
 *   f.row.goal = { p, radius } the same every step until it is there (an AI rower: set it once;
 *                              f.row.arrived is set to the time it got there)
 *   castOff(f) / makeFast(f, anchor, length?)   untie its painter / tie it to a world point
 *   holeBoat(f, worldPoint, area)                a hole in its planking there (m²)
 *   boatAt(world, p, r)        the boat (not sunk) whose hull is within r m of p (null: none)
 *   boatShot(sim, from, dir, tMax, weapon)  a round against the boats → { boat, p, t, holes } | null
 *   boatBlast(sim, centre, R)  a blast's fragments hole the hulls within R, and push them
 *   launchBoat(f, { x, z, level, yaw, rho }) a float (models/rowBoat.js placeRowBoat(...).floats[0])
 *                              afloat outside a simulation (the tests, the rig)
 *   stepBoat(f, dt, env)       one step: Archimedes (stepBody), then drift, mooring and oars
 *                              (env: stepBody's, plus current: [vx, vz] | (x, z) → [vx, vz])
 *
 * The simulation (sim/buoyancy.js stepFloats) steps every boat of the world this way, with the
 * current where it is, keeps it off the shore, finds the water's level and the bottom under it as
 * it moves, and once it has left its berth takes its voxels out of the grid (they would stay
 * behind where it was built: from then on its damage is the holes shot in it, see limitations in
 * walk/boatRow.js).
 */

export const OARS = { period: 2.0, drive: 0.42, force: 160, catch: 0.65, finish: -0.55, inboard: 0.78, outboard: 1.55 };
export const PERSON_KG = 80;
const clamp = (v, a = -1, b = 1) => (v < a ? a : v > b ? b : v);

/** Seats, oars, the mooring: what a float needs to be a boat (once, when it is first stepped). */
export function initBoat(f) {
  const b = f.body;
  if (!f.seats) f.seats = [{ x: 0, y: b.hull.keel(0) + 0.3, z: 0, role: 'rower' }];
  f.seats = f.seats.map((s) => ({ who: null, ...s }));
  f.rowlocks ??= [-1, 1].map((sd) => [0.3, b.hull.sheer(0.3), sd * b.hull.half(0.3, b.hull.sheer(0.3) - 0.01)]);
  f.row = { pull: 0, turn: 0, goal: null, oars: [-1, 1].map((side) => ({ side, phase: 0, dir: 0, k: 0, sweep: 0, dip: 0, out: false })) };
  b.vx ??= 0;
  b.vz ??= 0;
  b.wy ??= 0;
  f.home = { X: b.X, Z: b.Z, yaw: b.yaw };
  if (f.moor?.moored && f.moor.length > 0) {
    const x = b.hull.x1 - 0.1;
    const at = [x, b.hull.sheer(x) - 0.03, 0];
    const p = toWorld(b, at);
    const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
    // (made fast ahead of its stem, with some slack: it swings on it)
    const reach = 0.6 * f.moor.length;
    f.mooring = { anchor: [p[0] + c * reach, p[1] + 0.3, p[2] - s * reach], length: f.moor.length, at };
  } else f.mooring = null;
  return f;
}

/** A float afloat outside a simulation (the tests, the rig): its body placed at rest, a boat. */
export function launchBoat(f, { x = 0, z = 0, level = 0, yaw = 0, rho = RHO_SEA } = {}) {
  const b = bodyFromSpec(f.spec, rho);
  f.body = b;
  f.rho = rho;
  f.yaw = yaw;
  placeAt(b, x, level, z, yaw);
  b.pose = framePose(b);
  f.water ??= { level, sea: rho === RHO_SEA, fresh: rho !== RHO_SEA };
  return initBoat(f);
}

/* ------------------------------------------------------------------ seats */

export function rower(f) {
  return f.seats?.find((s) => s.role === 'rower')?.who ?? null;
}

export function boardSeat(f, who, k) {
  if (!f.seats) initBoat(f);
  const had = f.seats.findIndex((s) => s.who === who);
  if (had >= 0) return had;
  if (k === undefined || k < 0 || k >= f.seats.length || f.seats[k].who) {
    k = f.seats.findIndex((s) => s.role === 'rower' && !s.who);
    if (k < 0) k = f.seats.findIndex((s) => !s.who);
  }
  if (k < 0) return -1;
  const s = f.seats[k];
  s.who = who;
  const b = f.body;
  // (its own list: the spec's loads are shared with the float's spec)
  b.loads = [...b.loads, { m: who.mass ?? PERSON_KG, p: [s.x, s.y + 0.22, s.z], label: 'person', who }];
  updateMass(b);
  who.boat = f;
  who.boatSeat = k;
  return k;
}

export function leaveSeat(f, who) {
  const k = f.seats?.findIndex((s) => s.who === who) ?? -1;
  if (k < 0) return -1;
  f.seats[k].who = null;
  const b = f.body;
  b.loads = b.loads.filter((L) => L.who !== who);
  updateMass(b);
  if (who.boat === f) {
    who.boat = null;
    who.boatSeat = -1;
  }
  if (f.seats[k].role === 'rower') row(f, 0, 0);
  return k;
}

export function seatWorld(f, k) {
  const s = typeof k === 'number' ? f.seats[k] : k;
  const b = f.body;
  return { p: toWorld(b, [s.x, s.y, s.z]), yaw: b.yaw, facing: s.role === 'rower' ? b.yaw + Math.PI : b.yaw };
}

/* ------------------------------------------------------------------ oars and mooring */

export function row(f, pull = 0, turn = 0) {
  f.row.pull = clamp(pull);
  f.row.turn = clamp(turn);
}

export function castOff(f) {
  f.mooring = null;
}

export function makeFast(f, anchor, length) {
  const b = f.body;
  const x = b.hull.x1 - 0.1;
  const at = [x, b.hull.sheer(x) - 0.03, 0];
  const p = toWorld(b, at);
  const d = Math.hypot(anchor[0] - p[0], anchor[2] - p[2]);
  f.mooring = { anchor: anchor.slice(), length: length ?? Math.max(0.5, d + 0.3), at };
  return f.mooring;
}

export function rowToward(f, target, { radius = 2 } = {}) {
  if (!rower(f)) return null;
  const b = f.body;
  if (f.mooring) castOff(f);
  const tz = target.length === 2 ? target[1] : target[2];
  const dx = target[0] - b.X, dz = tz - b.Z;
  const dist = Math.hypot(dx, dz);
  if (dist < radius) {
    row(f, 0, 0);
    return { dist, arrived: true };
  }
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  const a = Math.atan2(lz, lx); // (> 0: it lies to starboard)
  // (b.wy > 0: turning to port; damped so it does not swing past)
  const turn = clamp(1.6 * a + 1.2 * b.wy);
  const speed = b.vx * c - b.vz * s;
  let pull = Math.abs(a) > 1.0 ? 0 : Math.cos(a) * Math.min(1, (dist - radius * 0.5) / 5);
  if (dist < radius + 3 && speed > 0.25 + 0.3 * (dist - radius)) pull = -0.5; // (coming in too fast: back water)
  row(f, pull, turn);
  return { dist, arrived: false };
}

/** An oar's force (N, along the boat: + ahead) this instant, its phase advanced by h. */
function stepOar(o, demand, h, able) {
  if (o.phase === 0) {
    if (!able || Math.abs(demand) < 0.05) {
      o.dir = 0;
      o.sweep += (0 - o.sweep) * Math.min(1, h * 3);
      o.dip = 0;
      return 0;
    }
    o.dir = Math.sign(demand);
  }
  // (how hard: what is asked now, in the stroke's own direction; the other way: feathered)
  o.k = able ? Math.max(0, demand * o.dir) : 0;
  const D = OARS.drive;
  const ph = o.phase;
  let F = 0;
  const [a, z] = o.dir > 0 ? [OARS.catch, OARS.finish] : [OARS.finish, OARS.catch];
  if (ph < D) {
    F = o.dir * o.k * OARS.force * Math.sin((Math.PI * ph) / D);
    o.sweep = a + ((z - a) * ph) / D;
    o.dip = Math.min(1, Math.sin((Math.PI * ph) / D) * 4);
  } else {
    o.sweep = z + ((a - z) * (ph - D)) / (1 - D);
    o.dip = 0;
  }
  o.phase += h / OARS.period;
  if (o.phase >= 1) o.phase = 0;
  return F;
}

/* ------------------------------------------------------------------ the step */

/** Its draft now (m): its displacement over its waterplane. */
function draftNow(b) {
  const Awp = b.tuned?.Kh ? b.tuned.Kh / (b.rho * G) : b.hull.L * b.hull.B * 0.7;
  return Math.min(b.hull.D, Math.max(0.03, (b.M + b.rho * b.water) / (b.rho * Awp)));
}

/** One step of a boat: afloat (Archimedes), then drift, mooring and oars. */
export function stepBoat(f, dt, env = {}) {
  if (!f.row) initBoat(f);
  stepBody(f.body, dt, env);
  stepDrift(f, dt, env);
  return f;
}

/**
 * Surge, sway and yaw for dt: the water's drag towards its current, the wind, the mooring line,
 * the oars (see the top of this file). env: { current: [vx, vz] | (x, z) → [vx, vz], wind:
 * { speed, dir (radians, where it blows to: (cos, sin) in x, z) }, time }.
 */
export function stepDrift(f, dt, env = {}) {
  if (!f.row) initBoat(f);
  const b = f.body;
  const R = f.row;
  // an AI at the oars with somewhere to go
  if (R.goal && rower(f) && !rower(f).player) {
    const r = rowToward(f, R.goal.p, R.goal);
    if (r?.arrived) {
      R.goal = null;
      R.arrived = env.t ?? b.t;
    }
  }
  const cur = typeof env.current === 'function' ? env.current(b.X, b.Z) : env.current ?? [0, 0];
  const cx = cur[0] ?? 0, cz = cur[1] ?? 0;
  const wind = env.wind?.speed ? [env.wind.speed * Math.cos(env.wind.dir), env.wind.speed * Math.sin(env.wind.dir)] : [0, 0];
  const L = b.hull.L, B = b.hull.B;
  const T = draftNow(b);
  const mass = b.M + b.rho * b.water;
  const mSurge = mass * 1.05;
  const mSway = mass + 0.5 * b.rho * Math.PI * T * T * L * 0.5;
  const Iz = mass * (0.27 * L) ** 2 * 1.3 + 0.02 * b.rho * T * L ** 3;
  const S = L * (0.8 * B + 2 * T) * 0.75; // the wetted surface
  const Alat = 0.9 * L * T;
  const yawDrag = 0.5 * b.rho * 1.0 * T * (L / 2) ** 4 / 2;
  const wa = b.windage?.area ?? L * 0.4;
  const able = !!rower(f) && f.params?.oars !== false && !b.sunk && !b.swamped;
  const demand = [R.pull + R.turn, R.pull - R.turn]; // port, starboard
  const n = Math.max(1, Math.ceil(dt / 0.02));
  const h = dt / n;
  for (let s = 0; s < n; s++) {
    const c = Math.cos(b.yaw), sn = Math.sin(b.yaw);
    const ex = [c, -sn], ez = [sn, c];
    let Fx = 0, Fz = 0, tau = 0;
    const force = (fx, fz, rx, rz) => {
      Fx += fx;
      Fz += fz;
      tau += rz * fx - rx * fz; // (about +y: + turns the bow to port)
    };
    // the water: drag towards its own velocity
    const ux = b.vx - cx, uz = b.vz - cz;
    const us = ux * ex[0] + uz * ex[1], uw = ux * ez[0] + uz * ez[1];
    const Fs = -0.5 * b.rho * 0.012 * S * Math.abs(us) * us - 6 * us;
    const Fw = -0.5 * b.rho * 1.0 * Alat * Math.abs(uw) * uw - 20 * uw;
    force(Fs * ex[0] + Fw * ez[0], Fs * ex[1] + Fw * ez[1], 0, 0);
    tau += -yawDrag * Math.abs(b.wy) * b.wy - 0.02 * b.rho * T * L ** 3 * b.wy;
    // the wind on its topsides
    if (wind[0] || wind[1]) {
      const rx = wind[0] - b.vx, rz = wind[1] - b.vz;
      const U = Math.hypot(rx, rz);
      if (U > 1e-3) {
        const along = Math.abs((rx * ex[0] + rz * ex[1]) / U), across = Math.abs((rx * ez[0] + rz * ez[1]) / U);
        const A = wa * (across + 0.25 * along);
        const k = 0.5 * RHO_AIR * 1.0 * A * U;
        force(k * rx, k * rz, 0, 0);
      }
    }
    // the mooring line
    const m = f.mooring;
    if (m) {
      const p = toWorld(b, m.at);
      const rx = p[0] - b.X, rz = p[2] - b.Z;
      const dx = m.anchor[0] - p[0], dz = m.anchor[2] - p[2];
      const d = Math.hypot(dx, dz);
      m.taut = d > m.length;
      if (m.taut) {
        const nx = dx / d, nz = dz / d;
        const vpx = b.vx + b.wy * rz, vpz = b.vz - b.wy * rx; // (ω × r, ω about +y)
        const k = 4000;
        const cdamp = 1.2 * Math.sqrt(k * mass);
        const F = Math.max(0, k * (d - m.length) - cdamp * (vpx * nx + vpz * nz));
        force(F * nx, F * nz, rx, rz);
      }
    }
    // the oars: each at its rowlock
    for (let k = 0; k < 2; k++) {
      const o = R.oars[k];
      const F = stepOar(o, demand[k], h, able);
      o.out = able;
      if (!F) continue;
      const rl = f.rowlocks[k];
      const p = toWorld(b, rl);
      force(F * ex[0], F * ex[1], p[0] - b.X, p[2] - b.Z);
    }
    b.vx += ((Fx * ex[0] + Fz * ex[1]) / mSurge) * ex[0] * h + ((Fx * ez[0] + Fz * ez[1]) / mSway) * ez[0] * h;
    b.vz += ((Fx * ex[0] + Fz * ex[1]) / mSurge) * ex[1] * h + ((Fx * ez[0] + Fz * ez[1]) / mSway) * ez[1] * h;
    b.wy += (tau / Iz) * h;
    // on the bottom: it grinds to a stop
    if (b.aground) {
      const k = Math.exp(-4 * h);
      b.vx *= k;
      b.vz *= k;
      b.wy *= k;
    }
    b.X += b.vx * h;
    b.Z += b.vz * h;
    b.yaw += b.wy * h;
  }
  b.pose = framePose(b);
  return f;
}

/* ------------------------------------------------------------------ holes */

/** A world point in its hull frame (the inverse of toWorld). */
export function toLocal(b, p) {
  const R = rot(b.yaw, b.roll, b.pitch);
  const d = [p[0] - b.X, p[1] - b.Y, p[2] - b.Z];
  return [R[0] * d[0] + R[3] * d[1] + R[6] * d[2] + b.G[0], R[1] * d[0] + R[4] * d[1] + R[7] * d[2] + b.G[1], R[2] * d[0] + R[5] * d[1] + R[8] * d[2] + b.G[2]];
}

/** Inside its hull's envelope (planking and the open inside it encloses), hull frame. */
function inHull(hull, x, y, z) {
  if (x <= hull.x0 || x >= hull.x1) return false;
  return Math.abs(z) < hull.half(x, y);
}

/** Its holes: the spec's, where its planking burnt away (sim/buoyancy.js checkPlanking), shot. */
export function updateHoles(f) {
  f.body.holes = [...(f.spec?.holes ?? []), ...(f.plankHoles ?? []), ...(f.shotHoles ?? [])];
}

export function holeBoat(f, p, area) {
  const b = f.body;
  const l = toLocal(b, p);
  const hull = b.hull;
  // (on its planking: in its sheer, out of its keel)
  l[1] = Math.max(hull.keel(Math.max(hull.x0, Math.min(hull.x1, l[0]))) + 0.005, Math.min(hull.sheer(l[0]) - 0.005, l[1]));
  const H = (f.shotHoles ??= []);
  // (close to one already there: that one bigger)
  const near = H.find((q) => Math.hypot(q.p[0] - l[0], q.p[1] - l[1], q.p[2] - l[2]) < 0.04);
  if (near) near.area += area;
  else H.push({ p: l, area, shot: true });
  if (H.length > 60) {
    const tot = H.reduce((s, q) => s + q.area, 0);
    H.splice(0, H.length - 60);
    const left = H.reduce((s, q) => s + q.area, 0);
    for (const q of H) q.area *= tot / left;
  }
  updateHoles(f);
  return l;
}

/** The boat (afloat, not sunk) whose hull is within r m of p. */
export function boatAt(w, p, r = 1) {
  let best = null, bd = Infinity;
  for (const f of w.floats ?? []) {
    const b = f.body;
    if (!b || b.sunk || !f.row) continue;
    const l = toLocal(b, p);
    const hull = b.hull;
    const dx = Math.max(0, hull.x0 - l[0], l[0] - hull.x1);
    const dz = Math.max(0, Math.abs(l[2]) - hull.B / 2);
    const dy = Math.max(0, -0.3 - l[1], l[1] - hull.D - 1.2);
    const d = Math.hypot(dx, dy, dz);
    if (d < r && d < bd) {
      bd = d;
      best = f;
    }
  }
  return best;
}

/** How big a round's hole is in planking (m²): splintered wood more than its calibre. */
export const SHOT_HOLE = { rifle: 2.5e-4, pistol: 1.5e-4, mg: 6e-4, heavy: 1.2e-3, arrow: 1e-4 };

/**
 * A round from `from` along `dir` (≤ tMax m) against the boats: where it goes through the
 * planking it holes it (in and out: through the side, across the open boat, out of the other
 * side or the bottom; over the gunwale into it: only where it goes out). → the nearest boat hit
 * { boat, p (the first hole), t, holes } or null.
 */
export function boatShot(sim, from, dir, tMax, weapon = 'rifle') {
  const w = sim.world ?? sim;
  const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const d = [dir[0] / l, dir[1] / l, dir[2] / l];
  let best = null;
  for (const f of w.floats ?? []) {
    const b = f.body;
    if (!b || !f.row) continue;
    const hull = b.hull;
    // (its bounding sphere about amidships)
    const c = toWorld(b, [0, hull.D / 2, 0]);
    const rad = Math.hypot(hull.L / 2, hull.D, hull.B / 2);
    const oc = [c[0] - from[0], c[1] - from[1], c[2] - from[2]];
    const tc = oc[0] * d[0] + oc[1] * d[1] + oc[2] * d[2];
    const miss2 = oc[0] ** 2 + oc[1] ** 2 + oc[2] ** 2 - tc * tc;
    if (miss2 > rad * rad) continue;
    const t0 = Math.max(0, tc - rad), t1 = Math.min(tMax, tc + rad);
    if (t1 <= t0 || (best && t0 > best.t)) continue;
    const step = 0.01;
    const crossings = [];
    let prev = null, prevL = null;
    for (let t = t0; t <= t1; t += step) {
      const p = [from[0] + d[0] * t, from[1] + d[1] * t, from[2] + d[2] * t];
      const q = toLocal(b, p);
      const inside = inHull(hull, q[0], q[1], q[2]);
      if (prev !== null && inside !== prev) {
        // (through the open top, over the gunwale: no planking there)
        const top = (inside ? prevL : q)[1] >= hull.sheer(q[0]) - 0.012;
        if (!top) crossings.push({ p, t });
      }
      prev = inside;
      prevL = q;
    }
    if (!crossings.length || crossings[0].t > tMax) continue;
    if (best && crossings[0].t >= best.t) continue;
    best = { boat: f, p: crossings[0].p, t: crossings[0].t, crossings };
  }
  if (!best) return null;
  const area = SHOT_HOLE[weapon] ?? SHOT_HOLE.rifle;
  const mat = best.boat.body.material;
  // (aluminium and GRP: a cleaner hole, about the round's own size)
  const k = mat === 'wood' || !mat ? 1 : 0.45;
  for (const c of best.crossings) holeBoat(best.boat, c.p, area * k);
  best.holes = best.crossings.length;
  delete best.crossings;
  if (w.events) w.events.push({ type: 'boatHit', pos: best.p.slice(), time: w.time ?? 0, name: best.boat.label ?? 'a boat' });
  return best;
}

/** A blast at `centre` (radius R): its fragments hole the hulls near it and push them away. */
export function boatBlast(sim, centre, R) {
  const w = sim.world ?? sim;
  for (const f of w.floats ?? []) {
    const b = f.body;
    if (!b || !f.row) continue;
    const hull = b.hull;
    const l = toLocal(b, centre);
    // the nearest point of its planking (roughly: on its side, or its bottom under it)
    const x = Math.max(hull.x0 + 0.1, Math.min(hull.x1 - 0.15, l[0]));
    const k = hull.keel(x), s = hull.sheer(x);
    let p;
    if (l[1] < k + 0.05) p = [x, k + 0.01, Math.max(-1, Math.min(1, l[2])) * Math.min(Math.abs(l[2]), hull.half(x, k + 0.05))];
    else {
      const y = Math.min(s - 0.01, l[1]);
      p = [x, y, Math.sign(l[2] || 1) * hull.half(x, y)];
    }
    const dist = Math.hypot(l[0] - p[0], l[1] - p[1], l[2] - p[2]);
    if (dist >= R) continue;
    const f1 = 1 - dist / R;
    const wp = toWorld(b, p);
    // fragments: a spray of small holes round the nearest point; close in, the planks blown in
    const nFrag = Math.max(1, Math.round(10 * f1));
    for (let i = 0; i < nFrag; i++) {
      const a = (i / nFrag) * Math.PI * 2;
      const r = 0.12 * Math.sqrt((i + 0.5) / nFrag);
      holeBoat(f, [wp[0] + Math.cos(a) * r, wp[1] + Math.sin(a) * r * 0.6, wp[2] + Math.sin(a) * r], 2e-4);
    }
    if (f1 > 0.6) holeBoat(f, wp, 0.03 * (f1 - 0.6) / 0.4 + 0.004);
    // pushed away
    const dx = wp[0] - centre[0], dz = wp[2] - centre[2];
    const dl = Math.hypot(dx, dz) || 1;
    const dv = 1.5 * f1;
    b.vx = (b.vx ?? 0) + (dx / dl) * dv;
    b.vz = (b.vz ?? 0) + (dz / dl) * dv;
    b.vy += 0.8 * f1;
  }
}
