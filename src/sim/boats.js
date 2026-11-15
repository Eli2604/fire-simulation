import { G, RHO_AIR, RHO_SEA, rot, toWorld, framePose, updateMass, stepBody, bodyFromSpec, placeAt, surfaceOf } from './buoyancy.js';

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
 *   motor     an outboard (models/rowBoat.js motor: 'outboard', motorPower kW) on the transom: its
 *             speed n (rpm / max rpm) from the engine's torque (the throttle; idle ~950 rpm) against
 *             the propeller's (∝ n², less as the boat's speed through the water approaches the
 *             prop's pitch speed, J = v / (n·V_pitch)); thrust T = T₀·n²·(1 − J)·immersion (T₀ ~130 N
 *             a kW: a 7.5 kW one pushes the boat at ~4 m/s), steered by turning it (the tiller). Out
 *             of the water on a wave it races (no load: to the rev limiter) and ventilates; shallow it
 *             cavitates (cav 0..1, less thrust); its powerhead under water (swamped, sunk) stalls it.
 *             Started by pulling the cord (startMotor: ~1.2 s of cranking).
 *   sail      a sailing dinghy (f.sail: models/rowBoat.js sailRigOf): the apparent wind (the true
 *             wind less its velocity) on a una rig sheeted out to at most its sheet's angle, the boom to
 *             the lee; lift ⊥ the flow by the angle of attack (~2π·α to a stall at ~17°, then down to a
 *             flat plate's drag), drag along it, at the centre of effort; a centreboard's lift against
 *             the leeway (C_L 5.5·β, stalling at 1.2) and its induced drag; a rudder that steers with way
 *             on. Its side force × the height of the centre of effort heels it (sim/buoyancy.js stepBody
 *             env.external) against its righting moment and the crew hiking out (~0.55 m over the side
 *             each). So: no drive in the no-go zone (< ~49° off the wind), a beam reach fastest; the
 *             boom swings across in a gybe. f.sailState: { boom, alpha, CL, fill, luff, lee, U, drive,
 *             side, heel, hike, hikeSide }; f.row.sheet 0 (in) .. 1 (out), f.row.autoTrim (trimmed to
 *             the wind). The crew hiking out (hikeCrew) move their weight: the loads go out over the
 *             windward side, the centre of mass with them, and that is what rights it.
 *   paddle    a canoe: the stern paddler's strokes (1.3 s), on the side that turns it, else
 *             alternating; a bow paddler adds his on the other side.
 *   kinds     f.kind: 'row' | 'motor' | 'sail' | 'canoe' (models/rowBoat.js BOAT_PRESETS); the drive
 *             seat (seats[i].drive): the rower, the helmsman, the stern paddler.
 *   sound     what happens to it that is heard (audio/boatSound.js): f.sfx, a short list of events
 *             { kind: 'slap' (the bow meeting the water: v, the closing speed), 'catch' / 'release'
 *             (an oar's blade in / out: k), 'hit' (a round), 'start', 'stall', t, n (a counter) };
 *             the motor's state, the speed through the water, the line's tension, the water aboard.
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
 *   (with a motor, the one in the rower's seat is its helmsman: pull is the throttle −1..1 (astern
 *   .. full ahead), turn the tiller; rowToward and f.row.goal start it and motor there; if it will
 *   not run (swamped, drowned) they row)
 *   startMotor(f), stopMotor(f)  pull the cord / switch it off
 *   row(f, pull, turn)         the rower's orders for now on: pull −1..1 (back water .. pull),
 *                              turn −1..1 (to port .. to starboard: one oar pulls, the other backs)
 *   sailToward(f, target)      a sailing dinghy's (rowToward hands it on): steer for it, or beat
 *                              towards it close-hauled, tacking, the sheet trimmed
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
 *   stepBoats(fs, dt, env)     several at once: on the rigid-body core they meet (hull against hull)
 *
 * On the rigid-body core (the default; f.physics = 'legacy' for the old model alone) the hull is a
 * body carried where this model moves it (physics/boatCore.js): another boat, a pier, a rock in the
 * way is a contact whose change goes back into its velocities; the painter is a rope joint.
 *
 * The simulation (sim/buoyancy.js stepFloats) steps every boat of the world this way, with the
 * current where it is, keeps it off the shore, finds the water's level and the bottom under it as
 * it moves, and takes its voxels with it (sim/movingBody.js: their heat, fire and char too; a boat
 * set alight burns wherever it goes, down to its waterline, and its burnt planking lets the water
 * in). The people aboard are seated and posed by sim/boatCrew.js (drawn: render/boatCrew.js,
 * render/enemies.js); a sailing crew's weight goes out over the side as they hike (hikeCrew).
 */

export const OARS = { period: 2.0, drive: 0.42, force: 160, catch: 0.65, finish: -0.55, inboard: 0.78, outboard: 1.55 };
export const PERSON_KG = 80;
/** An outboard: speeds (rpm), cylinders, strokes, thrust per kW (N), the prop's pitch speed at full rpm (m/s). */
export const MOTOR = { idleRpm: 950, maxRpm: 5500, limit: 1.08, idleThr: 0.07, thrustPerKw: 130, pitchSpeed: 8, crank: 1.2 };

/** A motor's state from its spec ({ power (kW), cyl, strokes }). */
export function makeMotor(spec = {}) {
  const power = spec.power ?? 7.5;
  return { kind: 'outboard', power, cyl: spec.cyl ?? (power > 15 ? 3 : 2), strokes: spec.strokes ?? 4, n: 0, rpm: 0, running: false, cranking: 0, throttle: 0, steer: 0, load: 0, cav: 0, imm: 1, thrust: 0, racing: false, stalled: false, why: '' };
}
const clamp = (v, a = -1, b = 1) => (v < a ? a : v > b ? b : v);
import { isCore } from '../physics/vehicleCore.js';
import { stepBoatsCore } from '../physics/boatCore.js';

/** Seats, oars, the mooring: what a float needs to be a boat (once, when it is first stepped). */
export function initBoat(f) {
  const b = f.body;
  if (!f.seats) f.seats = [{ x: 0, y: b.hull.keel(0) + 0.3, z: 0, role: 'rower' }];
  f.seats = f.seats.map((s) => ({ who: null, ...s }));
  f.rowlocks ??= [-1, 1].map((sd) => [0.3, b.hull.sheer(0.3), sd * b.hull.half(0.3, b.hull.sheer(0.3) - 0.01)]);
  if (f.outboard && !f.motor) f.motor = makeMotor(f.outboard);
  f.sfx = [];
  f.sfxN = 0;
  f.kind = f.boatKind ?? f.params?.kind ?? 'row';
  f.sailState = f.sail ? { boom: 0, alpha: 0, CL: 0, fill: 0, luff: 1, U: 0, drive: 0, side: 0, heel: 0, hike: 0 } : null;
  f.heelTorque = { tx: 0, tz: 0 };
  f.row = { pull: 0, turn: 0, goal: null, sheet: 0.6, autoTrim: false, tack: 0, paddle: { phase: 0, side: 1, dir: 0, k: 0, sweep: 0, dip: 0 }, oars: [-1, 1].map((side) => ({ side, phase: 0, dir: 0, k: 0, sweep: 0, dip: 0, out: false })) };
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
  return f.seats?.find((s) => s.drive || s.role === 'rower')?.who ?? null;
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

export function startMotor(f) {
  const M = f.motor;
  if (!M || M.running || M.cranking > 0) return false;
  M.cranking = MOTOR.crank;
  sfx(f, 'start', 1);
  return true;
}

export function stopMotor(f) {
  const M = f.motor;
  if (!M) return;
  M.running = false;
  M.cranking = 0;
  M.why = 'off';
}

/** Something that happened to it, to be heard (audio/boatSound.js; see the top). */
export function sfx(f, kind, v = 1, extra = null) {
  const q = (f.sfx ??= []);
  f.sfxN = (f.sfxN ?? 0) + 1;
  q.push({ kind, v, t: f.body?.t ?? 0, n: f.sfxN, ...(extra ?? {}) });
  if (q.length > 24) q.splice(0, q.length - 24);
}

/** Under power: the motor is running (or being started). */
export function underPower(f) {
  return !!f.motor && (f.motor.running || f.motor.cranking > 0);
}

export function rowToward(f, target, { radius = 2 } = {}) {
  if (!rower(f)) return null;
  if (f.kind === 'sail') return sailToward(f, target, { radius: Math.max(radius, 3) });
  const b = f.body;
  if (f.mooring) castOff(f);
  // a motor: start it (it will not start swamped, its powerhead under water)
  if (f.motor && !underPower(f) && !b.swamped && !b.sunk && f.motor.why !== 'drowned') startMotor(f);
  const motor = underPower(f);
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
  let pull = Math.abs(a) > 1.0 ? 0 : Math.cos(a) * Math.min(1, (dist - radius * 0.5) / (motor ? 12 : 5));
  if (motor && Math.abs(a) > 1.0) pull = 0.25; // (a motor boat turns under way: the prop's wash on it)
  if (dist < radius + 3 && speed > 0.25 + 0.3 * (dist - radius)) pull = -0.5; // (coming in too fast: back water, astern)
  if (motor && dist < radius + 12 && speed > 0.6 + 0.35 * (dist - radius)) pull = -0.6;
  row(f, pull, turn);
  return { dist, arrived: false };
}

const wrap = (a) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
/** How close to the wind a sailing dinghy is sailed when it beats (rad off the true wind: ~49°). */
export const CLOSE_HAULED = 0.85;

/**
 * A sailing dinghy's helmsman's orders for this step to get to target: steer for it, or, when it
 * lies in the no-go zone (closer to the wind than CLOSE_HAULED), beat towards it close-hauled on
 * one tack and then the other (he tacks when the target has fallen well over on the other side);
 * the sheet trimmed to the apparent wind (autoTrim). Arriving, he lets the sheet fly.
 */
export function sailToward(f, target, { radius = 4 } = {}) {
  if (!rower(f)) return null;
  const b = f.body;
  const R = f.row;
  if (f.mooring) castOff(f);
  const tz = target.length === 2 ? target[1] : target[2];
  const dx = target[0] - b.X, dz = tz - b.Z;
  const dist = Math.hypot(dx, dz);
  R.autoTrim = true;
  R.pull = 0;
  if (dist < radius) {
    R.turn = 0;
    R.autoTrim = false;
    R.sheet = 1;
    return { dist, arrived: true };
  }
  const w = f.windNow ?? [0, 0];
  const bt = Math.atan2(dz, dx);
  let head = bt;
  if (Math.hypot(w[0], w[1]) > 0.5) {
    const from = Math.atan2(-w[1], -w[0]);
    const d = wrap(bt - from);
    if (Math.abs(d) < CLOSE_HAULED + 0.05) {
      R.tack ||= Math.sign(d) || 1;
      if (R.tack * d < -0.3) R.tack = -R.tack;
      head = from + R.tack * CLOSE_HAULED;
    } else R.tack = Math.sign(d);
  }
  // its heading as an angle in (x, z): −yaw; + turn: to starboard (the heading angle grows)
  const e = wrap(head - -b.yaw);
  R.turn = clamp(1.5 * e + 0.8 * b.wy);
  // going astern (in irons, blown back): the rudder works the other way round
  const ahead = b.vx * Math.cos(b.yaw) - b.vz * Math.sin(b.yaw);
  if (ahead < -0.05) R.turn = -R.turn;
  return { dist, arrived: false, tack: R.tack };
}

/** The canoe's paddle (the stern paddler's; strokes on the side that turns it, else alternating): its force (N, ahead). */
function stepPaddle(P, dp, ds, h, able) {
  const D = 0.5, period = 1.3;
  if (P.phase === 0) {
    if (!able || Math.max(Math.abs(dp), Math.abs(ds)) < 0.05) {
      P.dir = 0;
      P.dip = 0;
      P.sweep *= Math.max(0, 1 - h * 3);
      return 0;
    }
    P.side = Math.abs(Math.abs(dp) - Math.abs(ds)) > 0.3 ? (Math.abs(dp) > Math.abs(ds) ? -1 : 1) : -P.side;
    const dem = P.side < 0 ? dp : ds;
    P.dir = Math.sign(dem) || 1;
    P.k = Math.min(1, Math.abs(dem));
    P.ev = 'catch';
  }
  const ph = P.phase;
  let F = 0;
  if (ph < D) {
    F = P.dir * P.k * 140 * Math.sin((Math.PI * ph) / D);
    P.sweep = P.dir * (0.7 - (1.4 * ph) / D);
    P.dip = Math.min(1, Math.sin((Math.PI * ph) / D) * 4);
  } else {
    P.sweep = P.dir * (-0.7 + (1.4 * (ph - D)) / (1 - D));
    P.dip = 0;
  }
  P.phase += h / period;
  if (ph < D && P.phase >= D) P.ev = 'release';
  if (P.phase >= 1) P.phase = 0;
  return F;
}

/**
 * The sail's force for this instant (boat frame: x ahead, z to starboard) from the apparent wind
 * (the true wind less the boat's own velocity): the sail sheeted out to at most its sheet's
 * angle, the boom to the lee; lift ⊥ the flow (to the lee) and drag along it, by the angle of
 * attack (lift ~2π·α to its stall at ~17°, then down to a flat plate's drag square to the wind);
 * heeled, less of it to the wind. A boom swinging across with the wind from astern: a gybe.
 */
function sailForce(f, h, wind, ex, ez) {
  const b = f.body, S = f.sailState, rig = f.sail, R = f.row;
  const ax = wind[0] - b.vx, az = wind[1] - b.vz;
  const U = Math.hypot(ax, az);
  S.U = U;
  if (U < 0.05) {
    S.alpha = S.CL = S.fill = S.drive = S.side = 0;
    S.luff = 1;
    return null;
  }
  const ux = (ax * ex[0] + az * ex[1]) / U, uz = (ax * ez[0] + az * ez[1]) / U;
  const phi = Math.atan2(uz, -ux); // (the flow's direction from dead aft: + to starboard)
  S.phi = phi;
  // (trimmed to the apparent wind; overpowered, heeled past ~17°, the sheet eased to spill wind)
  if (R.autoTrim) R.sheet = clamp((Math.abs(phi) - 0.42) / 1.35 + clamp((Math.abs(b.roll) - 0.3) * 2.5, 0, 0.6), 0, 1);
  const out = 0.1 + 1.35 * clamp(R.sheet, 0, 1);
  const want = (Math.sign(phi) || 1) * Math.min(Math.abs(phi), out);
  // (the wind from astern crossing over: the boom, well out, swings across: a gybe)
  if (Math.sign(want) !== Math.sign(S.boom) && Math.abs(S.boom) > 0.6 && Math.abs(phi) > 1.6 && !S.swinging) {
    S.swinging = true;
    sfx(f, 'gybe', U);
  }
  if (Math.sign(want) === Math.sign(S.boom)) S.swinging = false;
  S.boom += clamp(want - S.boom, -3 * h, 3 * h);
  let alpha = Math.abs(wrap(phi - S.boom));
  alpha = Math.min(alpha, Math.PI / 2);
  const CL = alpha < 0.3 ? 4.67 * alpha : 1.4 * Math.cos(((alpha - 0.3) / (Math.PI / 2 - 0.3)) * (Math.PI / 2));
  const CD = 0.06 + 1.2 * Math.sin(alpha) ** 2;
  const q = 0.5 * RHO_AIR * U * U * rig.area * Math.cos(b.roll) ** 2;
  // the lee side of the sail: its normal the flow passes through (n · u > 0); the lift that way
  let nx = Math.sin(S.boom), nz = Math.cos(S.boom);
  S.lee = 1;
  if (nx * ux + nz * uz < 0) {
    nx = -nx;
    nz = -nz;
    S.lee = -1;
  }
  let px = uz, pz = -ux;
  if (px * nx + pz * nz < 0) {
    px = -px;
    pz = -pz;
  }
  const Fx = q * (CL * px + CD * ux), Fz = q * (CL * pz + CD * uz);
  S.alpha = alpha;
  S.CL = CL;
  S.fill = clamp((CL + CD) / 1.3, 0, 1);
  S.luff = alpha < 0.14 ? 1 - alpha / 0.14 : 0;
  S.drive = Fx;
  S.side = Fz;
  // (at its centre of effort: a third of the way along the boom, swung out with it; the drive out
  // over the side turns it less than the bare geometry says: the hull's own asymmetry heeled, ignored)
  return { Fx, Fz, at: [rig.ceX - (rig.boom / 3) * (Math.cos(S.boom) - 1) * 0.5, rig.ceH, 0.3 * (rig.boom / 3) * Math.sin(S.boom)] };
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
    o.ev = 'catch';
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
  if (ph < D && o.phase >= D) o.ev = 'release';
  if (o.phase >= 1) o.phase = 0;
  return F;
}

/* ------------------------------------------------------------------ the step */

/** Its draft now (m): its displacement over its waterplane. */
function draftNow(b) {
  const Awp = b.tuned?.Kh ? b.tuned.Kh / (b.rho * G) : b.hull.L * b.hull.B * 0.7;
  return Math.min(b.hull.D, Math.max(0.03, (b.M + b.rho * b.water) / (b.rho * Awp)));
}

/**
 * One step of a boat: afloat (Archimedes), then drift, mooring and oars. On the rigid-body core
 * (physics/boatCore.js; unless f.physics = 'legacy') its hull is a body that carries it there: its
 * painter a rope joint, what it bumps into a contact.
 */
export function stepBoat(f, dt, env = {}) {
  if (!f.row) initBoat(f);
  if (isCore(f, 'boat')) stepBoatsCore([f], dt, env, stepBoatModel);
  else stepBoatModel(f, dt, env);
  return f;
}
/** Boats stepped together (outside a simulation): on the core they meet each other (one world). */
export function stepBoats(fs, dt, env = {}) {
  for (const f of fs) if (!f.row) initBoat(f);
  const core = fs.filter((f) => isCore(f, 'boat'));
  if (core.length) stepBoatsCore(core, dt, env, stepBoatModel);
  for (const f of fs) if (!isCore(f, 'boat')) stepBoatModel(f, dt, typeof env === 'function' ? env(f) : env);
  return fs;
}
/** The model's step (afloat, then drift, mooring and oars). */
function stepBoatModel(f, dt, env = {}) {
  stepBody(f.body, dt, f.sail ? { ...env, external: f.heelTorque } : env);
  stepDrift(f, dt, env);
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
  const M = f.motor;
  const powered = underPower(f);
  const crewed = !!rower(f) && !b.sunk && !b.swamped;
  const able = crewed && (f.kind === 'row' || f.kind === 'motor') && f.params?.oars !== false && !powered;
  const paddling = crewed && f.kind === 'canoe';
  f.windNow = wind;
  let heel = 0, heelN = 0;
  if (M) {
    // the helmsman's hand on the twist grip and the tiller (the throttle follows in ~0.5 s)
    const helm = !!rower(f);
    const want = helm && powered ? R.pull : 0;
    M.throttle += clamp(want - M.throttle, -2 * dt, 2 * dt);
    M.steer = helm ? R.turn : M.steer * 0.9;
  }
  const surf = surfaceOf({ ...env, t: env.t ?? b.t });
  const hull = b.hull;
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
    // the mooring line (on the rigid-body core a rope joint holds it: physics/boatCore.js)
    const m = f.mooring;
    if (m && !(f.coreMooring && isCore(f, 'boat'))) {
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
        m.tension = F;
        force(F * nx, F * nz, rx, rz);
      } else m.tension = 0;
    }
    // the motor: its thrust at the prop, turned by the tiller
    if (M) {
      const T = stepMotor(f, h, us, surf);
      if (T) {
        const dl = 0.6 * M.steer; // (+: the bow to starboard: the thrust aimed to port at the stern)
        const lx = Math.cos(dl), lz = -Math.sin(dl);
        const p = toWorld(b, [hull.x0 - 0.25, hull.keel(hull.x0) - 0.15, 0]);
        force(T * (lx * ex[0] + lz * ez[0]), T * (lx * ex[1] + lz * ez[1]), p[0] - b.X, p[2] - b.Z);
      }
    }
    // the sail, the centreboard, the rudder
    if (f.sail) {
      const rig = f.sail;
      const sf = sailForce(f, h, wind, ex, ez);
      if (sf) {
        const p = toWorld(b, sf.at);
        force(sf.Fx * ex[0] + sf.Fz * ez[0], sf.Fx * ex[1] + sf.Fz * ez[1], p[0] - b.X, p[2] - b.Z);
        // its heeling moment: the side force over the board's centre of lateral resistance
        heel += sf.Fz * (rig.ceH + rig.board.depth / 2);
      }
      heelN++;
      const U2 = us * us + uw * uw;
      if (U2 > 1e-4) {
        const beta = Math.atan2(uw, Math.abs(us));
        const cl = clamp(5.5 * beta, -1.2, 1.2);
        const qb = 0.5 * b.rho * rig.board.area * U2;
        const bp = toWorld(b, [rig.board.x, 0, 0]);
        const fl = -qb * cl, fd = -qb * ((cl * cl) / (Math.PI * 3)) * Math.sign(us);
        force(fd * ex[0] + fl * ez[0], fd * ex[1] + fl * ez[1], bp[0] - b.X, bp[2] - b.Z);
      }
      if (crewed) {
        const qr = 0.5 * b.rho * rig.rudder.area * us * Math.abs(us);
        const fr = -qr * clamp(2 * R.turn, -1.1, 1.1);
        const rp = toWorld(b, [hull.x0 - 0.1, 0, 0]);
        force(fr * ez[0], fr * ez[1], rp[0] - b.X, rp[2] - b.Z);
      }
    }
    // the paddle(s): the stern paddler's strokes, the bow paddler's on the other side
    if (f.kind === 'canoe') {
      const P = R.paddle;
      const F = stepPaddle(P, R.pull + R.turn, R.pull - R.turn, h, paddling);
      if (P.ev) {
        sfx(f, P.ev, P.k || 0.5, { side: P.side });
        P.ev = null;
      }
      if (F) {
        const st = f.seats[0];
        const half = hull.half(st.x, hull.sheer(st.x) - 0.05) + 0.15;
        const p = toWorld(b, [st.x, 0, P.side * half]);
        force(F * ex[0], F * ex[1], p[0] - b.X, p[2] - b.Z);
        const bow = f.seats.find((s, i) => i > 0 && s.role === 'paddler' && s.who);
        if (bow) {
          const q = toWorld(b, [bow.x, 0, -P.side * (hull.half(bow.x, hull.sheer(bow.x) - 0.05) + 0.15)]);
          force(F * ex[0], F * ex[1], q[0] - b.X, q[2] - b.Z);
        }
      }
    }
    // the oars: each at its rowlock
    for (let k = 0; k < 2; k++) {
      const o = R.oars[k];
      const F = stepOar(o, demand[k], h, able);
      o.out = able;
      if (o.ev) {
        sfx(f, o.ev, o.k || 0.5, { side: o.side });
        o.ev = null;
      }
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
  if (f.sail) {
    // the heeling moment, against the crew hiking out over the windward side (hikeCrew: their
    // weight moves out, the centre of mass with it: the righting moment grows)
    const S = f.sailState;
    const Mh = heelN ? heel / heelN : 0;
    hikeCrew(f, Mh, dt);
    S.heel = Mh;
    // (a moment about its long axis: a side force to starboard heels it to starboard)
    f.heelTorque = { tx: Mh * Math.cos(b.yaw), tz: -Mh * Math.sin(b.yaw) };
  }
  listen(f, dt, surf, [cx, cz]);
  return f;
}

/** How far out over the side a sailing crew gets their weight hiking (m, from where they sit), the helmsman less. */
export const HIKE = { reach: 0.55, helm: 0.3, rate: 1.2 };

/**
 * A sailing dinghy's people hike out against the heeling moment Mh (N·m; > 0 heels it to
 * starboard): their loads (and the boatmen's) go out over the windward side, as far as it takes to
 * hold ~80 % of it (at most HIKE.reach each, the helmsman HIKE.helm), at a man's pace; the boat's
 * centre of mass goes with them (updateMass), so it is their weight that rights it. The one on
 * the floor (a man down) stays where he is. f.sailState.hike 0..1 how far out, hikeSide ±1 (+z).
 */
export function hikeCrew(f, Mh, dt) {
  const b = f.body, S = f.sailState;
  // (its own: the spec's loads are shared with the float's spec)
  if (!b.ownLoads) {
    b.loads = b.loads.map((L) => ({ ...L }));
    b.ownLoads = true;
  }
  const out = [];
  let max = 0;
  for (const L of b.loads) {
    if (L.label !== 'person') continue;
    const k = L.who ? f.seats.findIndex((s) => s.who === L.who) : -1;
    const role = k >= 0 ? f.seats[k].role : L.p[1] < 0.32 ? 'floor' : 'crew';
    if (role === 'floor' || L.who?.down || L.who?.dead) continue;
    L.base ??= L.p.slice();
    const reach = role === 'helm' ? HIKE.helm : HIKE.reach;
    out.push([L, reach]);
    max += L.m * G * reach;
  }
  const want = max ? Math.min(1, (Math.abs(Mh) * 0.8) / max) : 0;
  if (Math.abs(Mh) > 30) S.hikeSide = Mh > 0 ? -1 : 1;
  S.hikeSide ??= 1;
  // (across the boat, they come in first: a tack, a gybe)
  const k0 = S.hike ?? 0;
  S.hike = k0 + clamp(want - k0, -HIKE.rate * dt, HIKE.rate * dt);
  let moved = false;
  for (const [L, reach] of out) {
    const z = L.base[2] + S.hikeSide * S.hike * reach;
    const zz = clamp(z, L.p[2] - HIKE.rate * dt * 1.5, L.p[2] + HIKE.rate * dt * 1.5);
    if (Math.abs(zz - L.p[2]) > 0.004) {
      L.p = [L.p[0], L.p[1], zz];
      moved = true;
    }
  }
  if (moved) updateMass(b);
}

/**
 * The motor for h s at the boat's speed through the water `us` (m/s, ahead): its speed from the
 * engine's torque against the prop's, the prop's thrust (N, ahead) back. See the top.
 */
function stepMotor(f, h, us, surf) {
  const M = f.motor;
  const b = f.body;
  const hull = b.hull;
  // the prop (below the transom) and the powerhead (over it): in the water, out of it
  const prop = toWorld(b, [hull.x0 - 0.25, hull.keel(hull.x0) - 0.15, 0]);
  const head = toWorld(b, [hull.x0 - 0.2, hull.sheer(hull.x0) + 0.35, 0]);
  const depth = surf(prop[0], prop[2]) - prop[1];
  M.imm = clamp(depth / 0.12 + 0.3, 0, 1);
  M.depth = depth;
  const drowned = surf(head[0], head[2]) > head[1] || b.sunk;
  if (drowned || (b.swamped && M.running)) {
    if (M.running || M.cranking > 0) {
      M.running = false;
      M.cranking = 0;
      M.stalled = true;
      M.why = drowned ? 'drowned' : 'swamped';
      sfx(f, 'stall', M.n);
    }
  }
  if (M.cranking > 0) {
    M.cranking -= h;
    M.n = Math.max(M.n, 0.05 + 0.03 * Math.sin(M.cranking * 40));
    if (M.cranking <= 0) {
      M.cranking = 0;
      M.running = !drowned && !b.swamped;
      M.stalled = !M.running;
      M.why = M.running ? '' : 'flooded';
    }
  }
  const dir = Math.abs(M.throttle) > 0.05 ? Math.sign(M.throttle) : 0;
  const n = M.n;
  const thr = M.running ? Math.max(MOTOR.idleThr, Math.abs(M.throttle)) : 0;
  // advance ratio: how much of the prop's pitch speed the boat already goes (in its direction)
  const J = dir ? clamp((dir * us) / (Math.max(0.05, n) * MOTOR.pitchSpeed), -0.5, 1.2) : 0;
  // shallow, or loaded hard at low speed: it cavitates / ventilates (loses grip on the water)
  const cav = dir ? clamp((1 - M.imm) * 1.4 + Math.max(0, n - 0.75) * clamp(1 - (us * dir) / 2.5, 0, 1) * 0.9, 0, 1) : 0;
  const grip = M.imm * (1 - 0.55 * cav);
  const Qe = thr * (1.1 - 0.3 * n);
  const Ql = (dir ? grip * n * n * (1 - 0.6 * clamp(J, 0, 1)) : 0.04 * n * n) + 0.03 * n;
  M.n = clamp(n + (Qe - Ql) * 3 * h, 0, MOTOR.limit);
  // (in gear and lugged down below ~400 rpm: it stalls)
  if (M.running && dir && M.n < 0.07) {
    M.running = false;
    M.stalled = true;
    M.why = 'lugged';
    sfx(f, 'stall', M.n);
  }
  M.rpm = M.n * MOTOR.maxRpm;
  M.cav = cav;
  M.racing = M.running && dir !== 0 && M.imm < 0.5 && M.n > 0.95;
  M.load = dir ? grip * (1 - clamp(J, 0, 1)) : 0;
  M.thrust = dir ? dir * MOTOR.thrustPerKw * M.power * M.n * M.n * Math.max(0, 1 - J) * grip * (dir < 0 ? 0.6 : 1) : 0;
  return M.thrust;
}

/** What the hull does that is heard: the bow meeting the water (a slap, v its closing speed), grounding. */
function listen(f, dt, surf, cur) {
  const b = f.body;
  const hull = b.hull;
  const x = hull.x1 - 0.35;
  const bow = toWorld(b, [x, hull.keel(x) + 0.03, 0]);
  const gap = bow[1] - surf(bow[0], bow[2]);
  const A = (f.acoustic ??= { gap, slam: 0 });
  const closing = dt > 0 ? (A.gap - gap) / dt : 0;
  // (out of the water and back into it, coming down at more than a few dm/s)
  if (A.gap > 0 && gap <= 0 && closing > 0.25) sfx(f, 'slap', closing);
  A.slam = closing;
  A.gap = gap;
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  A.through = (b.vx - cur[0]) * c - (b.vz - cur[1]) * s; // (ahead, through the water)
  A.side = (b.vx - cur[0]) * s + (b.vz - cur[1]) * c;
  A.ground = b.aground ? Math.hypot(b.vx, b.vz) : 0;
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
  sfx(best.boat, 'hit', area * k * 1e4, { p: best.p.slice(), weapon });
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
