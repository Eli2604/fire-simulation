/**
 * Car dynamics (pure: numbers in, numbers out; no world, no three.js). The world layer
 * (sim/cars.js) gives it the ground and the collisions; the driver (you: walk/carDrive.js; an AI:
 * ai/carDriver.js) gives it the pedals and the wheel.
 *
 * Frame: the model's (models/car.js): x forward, y up, z to the right; its origin on the ground
 * between the wheels. In the world it is turned by yaw about y (three.js), so forward is
 * (cos yaw, -sin yaw) and the right side (sin yaw, cos yaw): a positive yaw rate turns it left.
 *
 * Powertrains (params.powertrain: 'auto' → a diesel for a jeep or a truck, petrol for a car):
 *  - petrol / diesel: an engine with a torque curve T(rpm) (petrol: a broad peak at ~4200 rpm;
 *    diesel: low down, ~2000), times the throttle, less its friction and pumping (∝ rpm: what
 *    brakes the car when you lift off); an idle governor holds it at its idle speed; a rev limiter
 *    at the redline. Below its stall speed with the clutch in it dies. It burns fuel at its
 *    brake-specific consumption (~250 g/kWh petrol, ~220 diesel) and an idle flow, from the tank
 *    (litres): empty, it stops. An automatic: from rest the clutch slips (it takes up as the engine
 *    revs, like a torque converter at the launch) and locks once the wheels have the engine's
 *    speed; it shifts up at a speed that rises with the throttle (near the redline flat out), down
 *    when the revs fall low, the drive cut for ~0.3 s while it shifts. Reverse: held back from rest.
 *  - electric: a motor on a single reduction gear (no gearbox, no clutch): its torque flat from
 *    0 rpm up to its base speed, then constant power (T = P / ω) to its top speed; reverse is the
 *    motor turning backwards. A battery pack (kWh, its state of charge c.soc instead of fuel): what
 *    the motor draws (its power / its efficiency, limited to what the pack gives) and an auxiliary
 *    load; regenerative braking: the brake pedal asks the motor first (as a generator, to its
 *    torque and the pack's charging power; fading out below ~5 km/h, none on a full pack), the
 *    friction brakes do the rest; lifting off it regenerates a little (~0.05 g). c.range: the km
 *    left at what it has been using (Wh/km). "Running" is the system ready (no engine to start).
 *  - hybrid (series / parallel, like a two-motor e-CVT): a motor drives the wheels as in an EV, from
 *    a small pack (~1.5 kWh); a petrol engine starts and stops by itself (c.ice): it starts when the
 *    power asked for is more than the pack gives, when the charge is low, at speed; it stops when
 *    the charge is back and little is asked (after a few seconds on; at walking pace it stays off).
 *    Running, below ~60 km/h it only turns a generator (series: its revs with the power it makes,
 *    the charge going to the motor and the pack), above it a clutch couples it to the wheels on a
 *    fixed ratio (parallel: its torque straight to them; what it makes over what is asked charges
 *    the pack). Started by the generator: no starter's crank, an 'iceStart' and an 'iceStop' (c.sfx).
 *
 * Drivetrains (params.drivetrain: 'auto' → permanent 4×4 for a jeep or a truck, rear-wheel drive for
 * a car): 'rwd', 'fwd', 'awd' (permanent 4×4 / AWD: a centre differential, a fixed torque split ~40 %
 * front, and a viscous coupling between the axles), '4x4' (the centre diff locked: both axles at one
 * speed: the most traction off the road; on a hard road in a tight turn it binds, the tyres scrubbing). The drive torque
 * goes to the driven axle(s); each axle's wheels have their own spin (ω_F, ω_R): the tyre's
 * longitudinal force from its slip, within the friction circle μ·F_z together with its cornering
 * force. So power through the front wheels uses the grip they steer with (FWD pushes wide:
 * understeer), through the rear the grip that holds the tail (RWD steps out: oversteer), and four
 * driven wheels put twice the grip down on a loose surface.
 *
 *  - Axles: ω integrated implicitly in the tyre (it is stiff) so wheelspin and locked wheels come
 *    out of it: slip ratio κ = (ωR − v)/|v|. Grip: μ per wheel (c.groundInfo.muW: FL, FR, RL, RR,
 *    from env.ground under each; an axle takes the mean of its two), F_z per axle from the weight,
 *    the slope and the load moved by braking / accelerating.
 *  - Tyres: longitudinal force C_κ·κ, lateral force −C_α·α (α the slip angle of the wheel's
 *    velocity to the way it points), both within the friction circle μ·F_z.
 *  - Steering: a bicycle model (one front and one rear wheel per axle at the wheelbase): the front
 *    turned by δ (up to ~32°, less at speed), the yaw from the axles' lateral forces about the
 *    centre of mass (I_z ≈ m(L²+W²)/12). The steering wheel turns δ × the steering ratio (~15:1:
 *    ~2.7 turns lock to lock; a truck's ~18:1): c.wheelAngle (+ left, rad), steeringWheelAngle(c).
 *  - Brakes (front-biased 65/35, to the friction limit: harder and the wheels lock and skid), the
 *    handbrake locks the rear (a locked 4×4: all four); rolling resistance C_rr·F_z and air drag ½ρC_dA·v².
 *  - Ground: the height under each wheel (env.ground), the body set on them (pitch from front to
 *    rear, roll from side to side); it follows the slope (gravity along it) and falls off edges.
 *    The springs show it: the body pitches under braking and acceleration and rolls in a turn
 *    (a damped spring, for looks).
 *  - Collisions: env.collide(c, prev) (the world: voxels, other cars, people) may push it back.
 *
 *   const c = makeCar(carSpec({ length: 4.2, powertrain: 'electric', drivetrain: 'fwd' }), { x, y, z, yaw });
 *   c.input = { throttle: 1, brake: 0, steer: 0, handbrake: false };   // steer +1: full left
 *   stepCar(c, dt, env);       // env: { ground(x, z, yFrom) → { y, mu, road }, collide?(c, prev) }
 */

export const G = 9.81;
const RHO_AIR = 1.2;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const RPM = 60 / TAU; // rad/s → rpm
/** Sub-step (s): the tyres are stiff. */
export const CAR_SUBSTEP = 1 / 300;

/** Normalised torque curves: [rpm / redline, T / Tmax]. */
const CURVES = {
  petrol: [[0, 0.5], [0.12, 0.62], [0.25, 0.8], [0.45, 0.95], [0.65, 1], [0.85, 0.9], [1, 0.74], [1.1, 0.5]],
  diesel: [[0, 0.55], [0.17, 0.72], [0.35, 0.95], [0.5, 1], [0.7, 0.92], [0.9, 0.78], [1, 0.62], [1.1, 0.4]],
};

export const POWERTRAINS = ['petrol', 'diesel', 'electric', 'hybrid'];
export const DRIVETRAINS = ['rwd', 'fwd', 'awd', '4x4'];
const isHeavy = (p) => (p.height ?? 1.45) >= 1.75 || (p.length ?? 4.2) >= 5;
/** The powertrain of a car's params ('auto': a diesel for a jeep or a truck, petrol for a car). */
export const powertrainOf = (p = {}) => (POWERTRAINS.includes(p.powertrain) ? p.powertrain : isHeavy(p) ? 'diesel' : 'petrol');
/** The drivetrain of a car's params ('auto': permanent 4×4 (awd) for a jeep or a truck, rear-wheel drive for a car). */
export const drivetrainOf = (p = {}) => (DRIVETRAINS.includes(p.drivetrain) ? p.drivetrain : isHeavy(p) ? 'awd' : 'rwd');
/** Its battery pack (kWh): params.batteryKWh, or an EV's ~60 (a truck's 120), a hybrid's 1.5, none. */
export function packKWh(p = {}) {
  const pt = powertrainOf(p);
  if (pt !== 'electric' && pt !== 'hybrid') return 0;
  if (p.batteryKWh > 0) return p.batteryKWh;
  return pt === 'electric' ? (isHeavy(p) ? 120 : 60) : 1.5;
}
/** Its fuel tank (litres): none in an EV, a hybrid's is small. */
export function tankLiters(p = {}) {
  const pt = powertrainOf(p);
  const l = p.fuelLiters ?? 40;
  return pt === 'electric' ? 0 : pt === 'hybrid' ? Math.min(l, 35) : l;
}
/** The torque split to the front axle of each drivetrain. */
const FRONT_SHARE = { rwd: 0, fwd: 1, awd: 0.4, '4x4': 0.5 };

/** The car of models/car.js params (its size: a hatchback, a jeep, a truck): mass, powertrain, drivetrain, tyres. */
export function carSpec(params = {}) {
  const L = params.length ?? 4.2, W = params.width ?? 1.8, H = params.height ?? 1.45;
  const heavy = H >= 1.75 || L >= 5;
  const powertrain = powertrainOf(params);
  const drive = drivetrainOf(params);
  const kWh = packKWh(params);
  const electric = powertrain === 'electric', hybrid = powertrain === 'hybrid';
  let mass = clamp(1250 * ((L * W * H) / (4.2 * 1.8 * 1.45)) ** 0.9, 650, 8000);
  // an EV: no engine, gearbox, tank (~9 %), a pack (~6.5 kg/kWh); a hybrid: its motors and small pack too
  if (electric) mass = mass * 0.91 + kWh * 6.5;
  else if (hybrid) mass = mass * 1.04 + kWh * 20;
  if (!heavy && (drive === 'awd' || drive === '4x4')) mass += 0.04 * mass; // (a car's 4×4 hardware: a jeep's is in its mass)
  const wheelX = 0.32 * L; // (models/car.js: the wheels at ±0.32 L)
  // (a front engine puts the weight forward; an EV's pack in the floor keeps it in the middle)
  const cgX = electric ? 0.005 * L : 0.03 * L;
  const engine = electric
    ? null
    : hybrid
    ? { kind: 'petrol', cyl: 4, strokes: 4, idle: 1000, redline: 6000, stall: 0, tmax: 0.13 * mass, inertia: 0.15, bsfc: 225 / 3.6e9, idleFlow: 0.5 / 3600, rho: 0.74 }
    : powertrain === 'diesel'
    ? { kind: 'diesel', cyl: L >= 5 ? 6 : 4, strokes: 4, idle: 750, redline: 4200, stall: 380, tmax: 0.2 * mass, inertia: 0.35, bsfc: 220 / 3.6e9, idleFlow: 0.9 / 3600, rho: 0.84 }
    : { kind: 'petrol', cyl: 4, strokes: 4, idle: 800, redline: 6400, stall: 420, tmax: 0.17 * mass, inertia: 0.17, bsfc: 250 / 3.6e9, idleFlow: 0.8 / 3600, rho: 0.74 };
  // the traction motor: torque flat to its base speed, then constant power; one reduction gear
  const motor = electric
    ? { tmax: 0.2 * mass, pmax: 100 * mass, rpmMax: heavy ? 12000 : 15000, ratio: heavy ? 12 : 9, inertia: 0.05 * (mass / 1500), eff: 0.9, polePairs: 4, slots: 48 }
    : hybrid
    ? { tmax: 0.22 * mass, pmax: 75 * mass, rpmMax: 13000, ratio: 7.5, inertia: 0.04, eff: 0.9, polePairs: 4, slots: 48 }
    : null;
  if (motor) motor.wMax = motor.rpmMax / RPM;
  const battery = kWh > 0 ? { kWh, pMax: electric ? (1.15 * motor.pmax) / motor.eff : 45e3, pRegen: electric ? 0.5 * motor.pmax : 35e3, aux: 400 } : null;
  return {
    L, W, H, heavy, mass, powertrain,
    single: !!motor, // (no gearbox: a single reduction)
    drive: { kind: drive, front: FRONT_SHARE[drive], visc: heavy ? 60 : 30 },
    a: wheelX - cgX, // centre of mass to the front axle
    b: wheelX + cgX, // ... to the rear axle
    wheelX, cgX,
    track: Math.max(1, W - 0.22),
    cgH: heavy ? 0.8 : electric ? 0.48 : 0.55,
    wheelR: 0.33,
    Iz: (mass * (L * L + W * W)) / 12,
    engine, motor, battery,
    hybrid: hybrid ? { socLow: 0.3, socMid: 0.45, socHigh: 0.55, socTarget: 0.6, vEv: 9, vHigh: 24, vLock: 17, ratio: 2.7, pGenMax: 55e3, pMin: 6e3, pCharge: 60e3, rpmGen: 4200, genEff: 0.9 } : null,
    gears: heavy ? [4.4, 2.6, 1.6, 1.15, 0.88] : [3.6, 2.1, 1.4, 1.0, 0.8],
    reverse: heavy ? 4.2 : 3.4,
    final: heavy ? 4.1 : 3.9,
    eff: motor ? 0.97 : 0.9,
    shiftTime: heavy ? 0.45 : 0.3,
    axleI: heavy ? 3 : 1.2, // an axle's two wheels and tyres (kg m²)
    shaftI: heavy ? 3 : 1.2, // the driveline to the driven axle(s): half-shafts, differential, propshaft
    CdA: (heavy ? 0.5 : electric ? 0.27 : 0.32) * 0.85 * W * H,
    Crr: heavy ? 0.015 : 0.012,
    cAlpha: 16, // cornering stiffness per unit load (1/rad)
    cAlphaR: 18.5, // ... the rear's (wider, stiffer: a road car is set up to understeer)
    rollFront: 0.7, // the front's share of the roll stiffness (the load moved across in a turn)
    cKappa: 20, // slip stiffness per unit load
    brake: 1.05, // the brakes' force at full pedal, × m g (front 65 %)
    brakeFront: 0.65,
    coastRegen: 0.05, // (an EV lifting off: × m g)
    maxSteer: heavy ? 0.5 : 0.56,
    steerRate: 2.2, // rad/s at the wheels
    steerRatio: heavy ? 18 : 15, // the steering wheel's turn per the road wheels'
    maxStep: 0.45, // m a wheel climbs (a kerb)
    tank: tankLiters(params),
    soc0: battery ? clamp(params.charge ?? (hybrid ? 0.55 : 0.8), 0, 1) : 0,
    whPerKm: heavy ? 320 : 160, // (what it is thought to use until it has driven)
  };
}

/** The torque curve's share of Tmax at rpm. */
function curveK(E, rpm) {
  const C = CURVES[E.kind] ?? CURVES.petrol;
  const x = Math.max(0, rpm) / E.redline;
  for (let i = 1; i < C.length; i++)
    if (x <= C[i][0]) {
      const [x0, y0] = C[i - 1], [x1, y1] = C[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  return C[C.length - 1][1];
}
const frictionOf = (E, rpm) => E.tmax * (0.06 + 0.1 * (Math.max(0, rpm) / E.redline));

/** Engine torque (N m) at rpm, throttle 0..1 (its friction and pumping taken off). */
export function engineTorque(E, rpm, throttle) {
  return throttle * E.tmax * curveK(E, rpm) - frictionOf(E, rpm);
}
/** The throttle that gives torque T at rpm (0..1). */
const throttleFor = (E, rpm, T) => clamp((T + frictionOf(E, rpm)) / Math.max(1, E.tmax * curveK(E, rpm)), 0, 1);

/** A motor's most torque (N m) at motor speed w (rad/s): flat, then constant power. */
export const motorTorqueMax = (Mo, w) => Math.min(Mo.tmax, Mo.pmax / Math.max(Math.abs(w), 1));

/** A car at rest on the ground at (x, y, z), heading yaw. */
export function makeCar(spec, { x = 0, y = 0, z = 0, yaw = 0, fuel } = {}) {
  return {
    spec,
    x, y, z, yaw, pitch: 0, roll: 0,
    vx: 0, vy: 0, vz: 0, wz: 0, // velocity (m/s, world), yaw rate (rad/s, + left)
    u: 0, v: 0, // forward, rightward speed
    ax: 0, ay: 0, // accelerations along, across (m/s²)
    steer: 0, // front wheels' angle (rad, + left)
    wheelAngle: 0, // the steering wheel's (rad, + left: steer × the steering ratio)
    omega: 0, // the drive's speed at the wheels (rad/s: the driven axle's; awd: the centre differential's)
    omegaF: 0, omegaR: 0, // the axles' wheel spin (rad/s)
    spinF: 0, spinR: 0, // the wheels' turn (rad, drawn)
    rpm: 0, // the engine's (an EV: its motor's)
    motorRpm: 0,
    running: false, crank: 0, why: null,
    gear: 0, // -1 reverse, 0 neutral, 1.. forward
    mode: 'P', // P parked (no one at the wheel), D, R, N
    locked: false, // the clutch: locked or slipping
    clutch: 0, // how much it takes up 0..1 (drawn on the HUD)
    shiftT: 0,
    load: 0, // kg aboard (people, cargo)
    fuel: fuel ?? spec.tank,
    used: 0, // litres burnt
    soc: spec.soc0, // the pack's state of charge 0..1
    kWhUsed: 0, kWhRegen: 0, // from the pack, back into it
    whPerKm: spec.whPerKm, range: spec.battery ? (spec.soc0 * spec.battery.kWh * 1000) / spec.whPerKm : 0,
    ice: spec.hybrid ? { on: false, rpm: 0, crank: 0, t: 9, mode: 'ev', power: 0 } : null,
    iceOn: false, // an engine firing (the sound)
    power: 0, // the power out (W)
    motorT: 0, // the motor's torque (N m; − regenerating)
    loadK: 0, // its load 0..1 (the sound)
    slipF: 0, slipR: 0, // slip ratio κ of the axles
    lockF: 0, // the front wheels locked
    alphaF: 0, alphaR: 0, // slip angles
    skid: 0, // how hard the tyres slide (0..1+)
    brakeOn: 0,
    pitchS: 0, pitchW: 0, rollS: 0, rollW: 0, // the springs (for looks)
    pitchG: 0, rollG: 0, // the ground's
    air: false,
    odo: 0,
    damage: 0, // 0..1: crashes (1: wrecked)
    dead: false, // engine (motor) gone (burnt, wrecked)
    input: { throttle: 0, brake: 0, steer: 0, handbrake: false },
    sfx: [], // { n, kind: 'start'|'ready'|'stall'|'shift'|'crash'|'land'|'iceStart'|'iceStop'..., ... }
    sfxN: 0,
    t: 0,
  };
}

export function sfx(c, kind, o = {}) {
  c.sfx.push({ n: ++c.sfxN, kind, t: c.t, ...o });
  if (c.sfx.length > 24) c.sfx.splice(0, c.sfx.length - 24);
}

/** Mass with what it carries (and its fuel). */
export const massOf = (c) => c.spec.mass + c.load + c.fuel * (c.spec.engine?.rho ?? 0.74);

/** The steering wheel's angle (rad, + left) for the road wheels' δ (or the car's now). */
export const steeringWheelAngle = (c, delta = c.steer) => delta * (c.spec.steerRatio ?? 15);
/** The steering wheel's angle each way that a driver's clip's phase spans (rad: a truck's full lock, 18 × 0.5). */
export const WHEEL_PHASE_RANGE = 9;
/** The driver's clip phase (operator/rig.js carDrive: 0.5 straight ahead) for a steering wheel angle (rad, + left). */
export const wheelPhase = (angle) => clamp(0.5 + angle / (2 * WHEEL_PHASE_RANGE), 0, 1);
/** Turns of the steering wheel lock to lock. */
export const lockToLock = (S) => (2 * S.maxSteer * (S.steerRatio ?? 15)) / TAU;

/** Has it what it runs on (fuel, charge)? */
export function hasEnergy(c) {
  const pt = c.spec.powertrain;
  if (pt === 'electric') return c.soc > 0.005;
  if (pt === 'hybrid') return c.soc > 0.02 || c.fuel > 0.05;
  return c.fuel > 0;
}
const outWhy = (c) => (c.spec.powertrain === 'electric' ? 'battery flat' : c.spec.powertrain === 'hybrid' ? 'out of fuel and charge' : 'out of fuel');

/** Turn the key: an engine cranks, then fires (unless dead or dry); an EV / hybrid gets ready. */
export function startEngine(c) {
  if (c.running || c.crank > 0) return false;
  if (c.dead) {
    sfx(c, 'crankFail');
    c.why = 'the engine is wrecked';
    return false;
  }
  c.crank = c.spec.single ? 0.3 : 0.7;
  c.why = null;
  sfx(c, c.spec.single ? 'key' : 'start');
  return true;
}
export function stopEngine(c, why = 'off') {
  if (!c.running && c.crank <= 0) return;
  const was = c.running;
  c.running = false;
  c.crank = 0;
  c.why = why;
  if (c.ice?.on) {
    c.ice.on = false;
    c.ice.t = 0;
    sfx(c, 'iceStop', { rpm: c.ice.rpm });
  }
  if (was && why !== 'off' && !c.spec.single) sfx(c, 'stall', { why });
}

/** The gear ratio of gear g (signed; with the final drive; an EV: its reduction). */
export const ratioOf = (S, g) => (S.single ? Math.sign(g) * S.motor.ratio : g > 0 ? S.gears[g - 1] * S.final : g < 0 ? -S.reverse * S.final : 0);

/**
 * W / S as a driver uses them in an automatic: W on, S brake; held S at a standstill puts it in
 * reverse (then S is on and W the brake), W at a standstill back into drive. Returns
 * { throttle, brake }. ahead, back: 0..1.
 */
export function pedals(c, ahead, back) {
  const slow = Math.abs(c.u) < 0.8;
  if (c.mode !== 'R' && back > 0.1 && ahead < 0.1 && slow) setMode(c, 'R');
  else if (c.mode === 'R' && ahead > 0.1 && back < 0.1 && slow) setMode(c, 'D');
  else if (c.mode === 'P' || c.mode === 'N') setMode(c, back > ahead ? 'R' : 'D');
  return c.mode === 'R' ? { throttle: back, brake: ahead } : { throttle: ahead, brake: back };
}

/** Into P / D / R / N. */
export function setMode(c, m) {
  if (c.mode === m) return;
  c.mode = m;
  const g = m === 'D' ? 1 : m === 'R' ? -1 : 0;
  if (g !== c.gear) {
    c.gear = g;
    c.locked = false;
    c.shiftT = g && !c.spec.single ? c.spec.shiftTime : 0;
  }
}

/** The automatic: up when the revs pass a point that rises with the throttle, down when they fall. */
function autoShift(c, thr) {
  const S = c.spec, E = S.engine;
  if (c.mode !== 'D' || c.shiftT > 0 || c.gear < 1 || c.t - (c.shiftAt ?? -9) < 1) return;
  const wheelRpm = Math.abs(c.omega) * RPM;
  const rpmIn = (g) => wheelRpm * ratioOf(S, g);
  const up = E.idle + (E.redline - E.idle) * (0.42 + 0.5 * thr);
  const down = E.idle + (E.redline - E.idle) * (0.08 + 0.3 * thr);
  if (c.gear < S.gears.length && c.locked && rpmIn(c.gear) > up && rpmIn(c.gear + 1) > E.idle * 1.1) {
    c.gear++;
    c.shiftAt = c.t;
    c.shiftT = S.shiftTime;
    c.locked = false;
    sfx(c, 'shift', { up: true, gear: c.gear, rpm: c.rpm });
  } else if (c.gear > 1 && rpmIn(c.gear) < down && rpmIn(c.gear - 1) < E.redline * 0.92) {
    c.gear--;
    c.shiftAt = c.t;
    c.shiftT = S.shiftTime * 0.8;
    c.locked = false;
    sfx(c, 'shift', { up: false, gear: c.gear, rpm: c.rpm });
  }
}

/** Advance dt (sub-stepped). env: { ground(x, z, yFrom) → { y, mu, road } | null, collide?(c, prev) }. */
export function stepCar(c, dt, env = {}) {
  let left = dt;
  while (left > 1e-9) {
    const h = Math.min(CAR_SUBSTEP, left);
    subStep(c, h, env);
    left -= h;
  }
}

const groundAt = (env, x, z, y) => env.ground?.(x, z, y) ?? { y: 0, mu: 1, road: true };

/** The key: cranking (an engine) or getting ready (an EV, a hybrid); out of fuel or charge it stops. */
function powerState(c, dt) {
  const S = c.spec, E = S.engine;
  if (c.crank > 0) {
    c.crank -= dt;
    if (!S.single) c.rpm = Math.max(c.rpm, 250);
    if (c.crank <= 0) {
      if (hasEnergy(c) && !c.dead) {
        c.running = true;
        if (!S.single) c.rpm = E.idle * 1.3;
        else sfx(c, 'ready');
      } else {
        c.why = c.dead ? 'the engine is wrecked' : S.powertrain === 'electric' ? 'battery flat' : 'no fuel';
        sfx(c, 'crankFail');
      }
    }
  }
  if (c.running && !hasEnergy(c)) stopEngine(c, outWhy(c));
  if (c.running && c.dead) stopEngine(c, 'the engine died');
}

/** One sub-step: the power, the driveline, the tyres, the body, the ground. */
export function subStep(c, dt, env) {
  const S = c.spec, E = S.engine;
  c.t += dt;
  const inp = c.input ?? {};
  const m = massOf(c);
  const R = S.wheelR;
  // ---- the wheel (rate-limited, less lock at speed); the steering wheel turns with it
  const vAbs = Math.hypot(c.vx, c.vz);
  const lock = S.maxSteer / (1 + (vAbs / 18) ** 2);
  const want = clamp(inp.steer ?? 0, -1, 1) * lock;
  c.steer += clamp(want - c.steer, -S.steerRate * dt, S.steerRate * dt);
  c.wheelAngle = c.steer * S.steerRatio;
  // ---- the power: cranking, running, dying
  powerState(c, dt);
  if (c.shiftT > 0) c.shiftT -= dt;
  if (!S.single) autoShift(c, clamp(inp.throttle ?? 0, 0, 1));
  let thr = c.running ? clamp(inp.throttle ?? 0, 0, 1) : 0;
  const brake = clamp(inp.brake ?? 0, 0, 1);
  c.brakeOn = brake;
  if (!S.single) {
    // the idle governor; the rev limiter
    if (c.running) {
      thr = Math.max(thr, clamp((E.idle - c.rpm) / 250, 0, 0.5));
      if (c.rpm > E.redline * 1.02) thr = 0;
    }
    if (c.shiftT > 0) thr = Math.min(thr, clamp((E.idle * 1.2 - c.rpm) / 300, 0, 0.3)); // (the drive cut while it shifts)
  }
  // ---- the body's velocities in its own frame
  const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
  const fx = cy, fz = -sy, rx = sy, rz = cy;
  const u = c.vx * fx + c.vz * fz;
  const v = c.vx * rx + c.vz * rz;
  // ---- the ground under the wheels: the slope, its grip (per wheel: FL, FR, RL, RR)
  const air = c.air;
  const gr = c.groundInfo ?? { mu: 1, road: true };
  const muW = gr.muW;
  const muF = air ? 0 : muW ? (muW[0] + muW[1]) / 2 : gr.mu ?? 1;
  const muR = air ? 0 : muW ? (muW[2] + muW[3]) / 2 : gr.mu ?? 1;
  // loads on the axles: the weight on the slope, moved by the acceleration
  const L = S.a + S.b;
  const gN = G * Math.cos(c.pitchG) * Math.cos(c.rollG);
  const shift = (m * c.ax * S.cgH) / L;
  const FzF = air ? 0 : Math.max(0, (m * gN * S.b) / L - shift);
  const FzR = air ? 0 : Math.max(0, (m * gN * S.a) / L + shift);
  // the load moved across in a turn: the more loaded outer tyre grips less per unit load (tyre load
  // sensitivity), so an axle's grip falls with it; the front takes most of it (it understeers at the limit)
  const dLat = (m * Math.abs(c.ay) * S.cgH) / S.track;
  const gripF = FzF > 0 ? 1 - Math.min(0.3, 0.8 * ((dLat * S.rollFront) / FzF) ** 2) : 1;
  const gripR = FzR > 0 ? 1 - Math.min(0.3, 0.8 * ((dLat * (1 - S.rollFront)) / FzR) ** 2) : 1;
  // ---- the front axle's way: steered
  const cd = Math.cos(c.steer), sd = Math.sin(c.steer);
  const vfLat = v - S.a * c.wz; // (rightward speed of the front axle)
  // the wheel points (cos δ, −sin δ) in (fwd, right) (δ + left)
  const fLong = u * cd - vfLat * sd;
  const fLat = u * sd + vfLat * cd;
  const UMIN = 2;
  c.alphaF = Math.atan2(fLat, Math.max(Math.abs(fLong), UMIN));
  let FyF = -S.cAlpha * FzF * c.alphaF;
  const vrLat = v + S.b * c.wz;
  const rLong = u;
  // ---- what drives: an engine through the clutch and gears, a motor through its reduction
  const hand = !!inp.handbrake;
  const FbDem = brake * S.brake * m * G;
  const D = S.drive;
  const IA = S.axleI;
  const Idrv = (D.kind === 'fwd' || D.kind === 'rwd' ? IA : 2 * IA) + S.shaftI; // (at the drive: its axles, its shafts)
  let Tsh = 0, Ix = 0, fric = 1;
  let cl = null;
  if (S.single) ({ Tsh, Ix, fric } = electricDrive(c, dt, thr, brake, FbDem, m));
  else {
    cl = clutchIn(c, dt, thr, Idrv);
    Tsh = cl.T;
    Ix = cl.Ix;
  }
  // ---- the axles: the drive's torque to them by the drivetrain, the brakes, the tyres
  const TbF = FbDem * S.brakeFront * fric * R;
  const TbR = (FbDem * (1 - S.brakeFront) * fric + (hand ? 0.9 * m * G : 0)) * R;
  const tF = { C: S.cKappa * FzF, v: fLong, den: Math.max(Math.abs(fLong), 1), lim: muF * FzF * gripF };
  const tR = { C: S.cKappa * FzR, v: rLong, den: Math.max(Math.abs(rLong), 1), lim: muR * FzR * gripR };
  const Ish = S.shaftI + Ix;
  let wF = c.omegaF, wR = c.omegaR, ws;
  if (D.kind === 'fwd') {
    wF = axleSolve(wF, IA + Ish, Tsh, TbF, R, dt, tF);
    wR = axleSolve(wR, IA, 0, TbR, R, dt, tR);
    ws = wF;
  } else if (D.kind === '4x4') {
    // (the centre locked: one speed; the handbrake holds all four)
    ws = axleSolve((wF + wR) / 2, 2 * IA + Ish, Tsh, TbF + TbR, R, dt, tF, tR);
    wF = wR = ws;
  } else if (D.kind === 'awd') {
    // a centre differential (its split s to the front) with a viscous coupling between the axles
    const s = D.front, Tv = D.visc * (wR - wF);
    wF = axleSolve(wF, IA + s * Ish, s * Tsh + Tv, TbF, R, dt, tF);
    wR = axleSolve(wR, IA + (1 - s) * Ish, (1 - s) * Tsh - Tv, TbR, R, dt, tR);
    ws = s * wF + (1 - s) * wR;
  } else {
    wR = axleSolve(wR, IA + Ish, Tsh, TbR, R, dt, tR);
    wF = axleSolve(wF, IA, 0, TbF, R, dt, tF);
    ws = wR;
  }
  c.omegaF = wF;
  c.omegaR = wR;
  c.omega = ws;
  if (cl) clutchOut(c, dt, cl, ws);
  else {
    // the motor turns with the wheels
    c.motorRpm = Math.abs(ws * S.motor.ratio) * RPM;
    if (S.powertrain === 'electric') c.rpm = c.motorRpm;
  }
  // the tyres' longitudinal forces from their slip; rolling resistance
  c.slipF = (wF * R - fLong) / tF.den;
  c.slipR = (wR * R - rLong) / tR.den;
  // the tyres: the longitudinal force from the slip ratio, the cornering force from the slip angle,
  // together within the friction circle; past it the force lies along the way the tyre slides
  // (combined slip: a spinning or a locked wheel has little cornering force left: power oversteer
  // through the rear, a front pushing wide with the power through it, a locked front that will not steer)
  c.alphaR = Math.atan2(vrLat, Math.max(Math.abs(rLong), UMIN));
  let FxF = tF.C * c.slipF;
  FyF /= 1 + Math.abs(c.slipF);
  {
    const t = Math.hypot(FxF, FyF), lim = tF.lim;
    if (t > lim && t > 0) {
      FxF *= lim / t;
      FyF *= lim / t;
    }
  }
  let FxR = tR.C * c.slipR;
  let FyR = (-S.cAlphaR * FzR * c.alphaR) / (1 + Math.abs(c.slipR));
  {
    const t = Math.hypot(FxR, FyR), lim = tR.lim;
    if (t > lim && t > 0) {
      FxR *= lim / t;
      FyR *= lim / t;
    }
  }
  if (Math.abs(fLong) > 0.05 || Math.abs(wF) > 0.1) FxF -= Math.sign(fLong) * S.Crr * FzF * Math.min(1, Math.abs(fLong) * 2);
  if (Math.abs(rLong) > 0.05 || Math.abs(wR) > 0.1) FxR -= Math.sign(rLong) * S.Crr * FzR * Math.min(1, Math.abs(rLong) * 2);
  const lockF = FbDem > 0 && wF === 0 && Math.abs(fLong) > 1 ? 1 : 0;
  c.lockF = lockF;
  // ---- the body: the forces in (fwd, right), drag, the slope
  const drag = 0.5 * RHO_AIR * S.CdA * u * Math.abs(u);
  const slopeF = -m * G * Math.sin(c.pitchG); // (nose up: it pulls back)
  const slopeR = m * G * Math.sin(c.rollG); // (right side down: it pulls right)
  // front forces into the body frame: wheel (long, lat) → (fwd, right)
  const Ffwd = FxF * cd + FyF * sd + FxR - drag + slopeF;
  const Fright = -FxF * sd + FyF * cd + FyR + slopeR;
  const Mz = -(S.a * (-FxF * sd + FyF * cd)) + S.b * FyR; // (+ left: a rightward force at the front turns it right)
  const au = Ffwd / m, av = Fright / m;
  // integrated in the world (the forces turned out of the body's frame)
  let vx = c.vx + (au * fx + av * rx) * dt;
  let vz = c.vz + (au * fz + av * rz) * dt;
  c.wz += (Mz / S.Iz) * dt;
  if (air) c.wz *= 1 - 0.5 * dt;
  // ---- at rest: it stays (static friction) rather than creep on the tyres' smallest slip
  if (!air && Math.abs(u) < 0.05 && Math.abs(v) < 0.05 && Math.abs(Tsh) < 1 && thr < 0.05 && (brake > 0.05 || hand) && Math.abs(slopeF) < Math.min(muF, muR) * m * G * 0.5) {
    vx = 0;
    vz = 0;
    c.wz = 0;
    c.omega = c.omegaF = c.omegaR = 0;
  }
  const yaw0 = c.yaw;
  c.yaw += c.wz * dt;
  // (what the springs and the load transfer feel: smoothed)
  c.ax += (au - c.ax) * Math.min(1, dt * 12);
  c.ay += (av - c.ay) * Math.min(1, dt * 12);
  c.vx = vx;
  c.vz = vz;
  c.u = vx * fx + vz * fz;
  c.v = vx * rx + vz * rz;
  const prev = { x: c.x, y: c.y, z: c.z, yaw: yaw0 };
  c.x += c.vx * dt;
  c.z += c.vz * dt;
  const ds = Math.hypot(c.vx, c.vz) * dt;
  c.odo += ds;
  // ---- the ground: the body on its wheels
  followGround(c, dt, env);
  // ---- what it hits (the world's: voxels, other cars, people)
  env.collide?.(c, prev, dt);
  // ---- the wheels' turn (drawn), the skid, the springs, the fuel and the charge
  c.spinF += c.omegaF * dt;
  c.spinR += c.omegaR * dt;
  const latSlide = Math.max(Math.abs(c.alphaF), Math.abs(c.alphaR)) - 0.12;
  const kappa = Math.max(Math.abs(c.slipR), lockF ? 0 : Math.abs(c.slipF));
  c.skid = clamp(Math.max(0, kappa - 0.12) * 3 + (lockF ? 0.8 : 0) + (hand && Math.abs(u) > 1 ? 0.6 : 0) + Math.max(0, latSlide) * 5, 0, 1.5) * (air ? 0 : 1) * clamp(Math.hypot(u, v) / 3 + kappa * 0.3, 0, 1);
  springs(c, dt);
  c.thr = thr;
  if (cl) {
    const P = c.running ? Math.max(0, cl.Te) * (c.rpm / RPM) : 0;
    c.power = P;
    c.loadK = c.running ? clamp(thr * 0.85 + (cl.T > 0 || c.locked ? 0.15 : 0) * thr, 0, 1) : 0;
    c.iceOn = c.running || c.crank > 0;
    if (c.running) {
      // power × brake-specific consumption (kg/s), and what it burns just turning over
      const litres = ((P * E.bsfc) / E.rho + E.idleFlow) * dt;
      c.fuel = Math.max(0, c.fuel - litres);
      c.used += litres;
    }
  } else {
    c.power = Math.abs(Tsh * ws);
    c.iceOn = !!c.ice?.on;
    // what it uses per km (smoothed over the last few km driven)
    if (ds > 0 && S.battery) {
      c._eAcc = (c._eAcc ?? 0) + (c._eStep ?? 0);
      c._dAcc = (c._dAcc ?? 0) + ds;
      if (c._dAcc > 50) {
        const whkm = c._eAcc / 3600 / (c._dAcc / 1000);
        c.whPerKm += (clamp(whkm, 40, 2000) - c.whPerKm) * Math.min(1, c._dAcc / 3000);
        c._eAcc = c._dAcc = 0;
      }
    }
    if (S.battery) c.range = (c.soc * S.battery.kWh * 1000) / Math.max(40, c.whPerKm) + (S.engine ? (c.fuel / 5.5) * 100 : 0);
  }
}

/**
 * An engine's drive before the axles are solved: the clutch locked (engine and wheels one: its
 * torque through the gears, its inertia G² at the wheels) or slipping (the torque it passes).
 */
function clutchIn(c, dt, thr, Iw) {
  const S = c.spec, E = S.engine;
  const Ie = E.inertia;
  const Gr = c.shiftT > 0 ? 0 : ratioOf(S, c.gear);
  const we = c.rpm / RPM;
  const Te = c.running ? engineTorque(E, c.rpm, thr) : c.crank > 0 ? 0.2 * E.tmax : engineTorque(E, c.rpm, 0);
  let locked = c.locked && Gr !== 0;
  // the clutch opens at the bottom (the engine would stall): it slips again
  if (locked && Math.abs(c.omega * Gr) * RPM < E.idle * 0.85) locked = false;
  c.clutch = Gr === 0 ? 0 : locked ? 1 : clamp((c.rpm - E.idle * 1.02) / (900 + 1400 * thr), 0, 1);
  if (locked) return { locked, Gr, we, Te, Tc: 0, grips: false, T: Te * Gr * S.eff, Ix: Ie * Gr * Gr };
  // slipping (or out of gear): the clutch passes Tc, its sign the way the slip goes
  let Tc = 0, grips = false;
  if (Gr !== 0) {
    const slip = we - c.omega * Gr;
    Tc = Math.sign(slip) * 1.6 * E.tmax * c.clutch;
    // (it cannot pass more than takes the slip away this step: then it grips)
    const Ired = 1 / (1 / Ie + (Gr * Gr) / Iw);
    const most = (Math.abs(slip) * Ired) / dt;
    if (Math.abs(Tc) >= most) grips = true;
    Tc = clamp(Tc, -most, most);
  }
  return { locked, Gr, we, Te, Tc, grips, T: Tc * Gr * S.eff, Ix: 0 };
}

/** ... and after: the engine's speed (with the wheels, or on its own), the clutch locking, a stall. */
function clutchOut(c, dt, cl, ws) {
  const S = c.spec, E = S.engine;
  const { Gr, we, Te, Tc } = cl;
  let locked = cl.locked, weNew;
  if (locked) weNew = ws * Gr;
  else {
    weNew = we + ((Te - Tc) / E.inertia) * dt;
    if (Gr !== 0 && c.shiftT <= 0) {
      const s0 = we - c.omega * Gr, s1 = weNew - ws * Gr;
      if ((cl.grips || Math.sign(s0) !== Math.sign(s1) || Math.abs(s1) < 3) && Math.abs(ws * Gr) * RPM >= E.idle * 0.9) {
        locked = true;
        weNew = ws * Gr;
      }
    }
  }
  c.locked = locked;
  // the engine: stalls if dragged below its stall speed while running (no load: it idles back)
  c.rpm = Math.max(0, weNew * RPM);
  if (!c.running && c.crank <= 0) c.rpm = Math.max(0, c.rpm - 1500 * dt * (locked ? 0 : 1));
  if (c.running && c.rpm < E.stall) stopEngine(c, 'stalled');
}

/**
 * An EV's or a hybrid's drive before the axles are solved: the motor's torque at the wheels (to its
 * curve, its top speed, what the pack gives), regenerative braking (the share of the pedal it takes
 * off the friction brakes: fric), a hybrid's engine (series: a generator; parallel: on the wheels).
 * The pack's charge follows. Returns { Tsh (N m at the wheels), Ix (inertia at the wheels), fric }.
 */
function electricDrive(c, dt, thr, brake, FbDem, m) {
  const S = c.spec, Mo = S.motor, B = S.battery;
  const R = S.wheelR;
  const dir = Math.sign(c.gear);
  const ratio = Mo.ratio;
  const wm = c.omega * ratio;
  const ready = c.running && !c.dead;
  const v = Math.abs(c.u);
  // a hybrid's engine first: what it makes for the pack and the motor (series), or puts on the wheels (parallel)
  const ice = c.ice ? hybridEngine(c, dt, thr, dir) : { Tw: 0, Ix: 0, Pgen: 0 };
  let Tm = 0; // the motor's driving torque (at the motor)
  if (ready && dir && (c.soc > 0.005 || ice.Pgen > 0)) {
    let k = thr;
    if (Math.abs(wm) > Mo.wMax) k *= clamp(1 - (Math.abs(wm) - Mo.wMax) / (0.03 * Mo.wMax), 0, 1); // (its top speed)
    if (dir < 0) k *= clamp((7 - v) / 2, 0, 1); // (reverse: no faster than ~25 km/h)
    Tm = dir * k * motorTorqueMax(Mo, wm);
    // what the pack (and the generator) can give
    const P = Math.abs(Tm * wm) / Mo.eff;
    const avail = (c.soc > 0.005 ? B.pMax : 0) + ice.Pgen;
    if (P > avail && P > 0) Tm *= avail / P;
  }
  // regenerative braking: the pedal (and lifting off), as much as the motor and the pack take
  let regenF = 0, fric = 1;
  if (ready && dir) {
    const fade = clamp((v - 1) / 3, 0, 1);
    const room = clamp((0.98 - c.soc) / 0.03, 0, 1);
    const most = Math.min((Mo.tmax * ratio) / R, B.pRegen / Math.max(v, 0.5)) * fade * room;
    const coast = thr < 0.02 && brake < 0.02 && c.ice?.mode !== 'parallel' ? S.coastRegen * m * G : 0;
    regenF = Math.min(most, FbDem + coast);
    fric = FbDem > 0 ? clamp(1 - regenF / FbDem, 0, 1) : 1;
  }
  const sgn = Math.sign(c.omega) || Math.sign(c.u) || 1;
  const Tsh = Tm * ratio * S.eff - sgn * regenF * R + ice.Tw;
  c.motorT = Tm - (sgn * regenF * R) / ratio;
  // the pack: the motor's draw (or what it gives back), the generator's charge, the auxiliaries
  const Pm = Tm * wm; // (mechanical, out of the motor)
  const Preg = regenF * v; // (back into it)
  const Pbat = (Pm > 0 ? Pm / Mo.eff : Pm * Mo.eff) - Preg * Mo.eff - ice.Pgen + (c.running ? B.aux : 0);
  const E = Pbat * dt;
  c.soc = clamp(c.soc - E / (B.kWh * 3.6e6), 0, 1);
  if (E > 0) c.kWhUsed += E / 3.6e6;
  else c.kWhRegen -= E / 3.6e6;
  c._eStep = E + (ice.fuelJ ?? 0);
  c.regenF = regenF;
  c.loadK = clamp(Math.abs(c.motorT) / Mo.tmax, 0, 1);
  return { Tsh, Ix: Mo.inertia * ratio * ratio + ice.Ix, fric };
}

/**
 * A hybrid's engine (c.ice): it starts and stops by itself (by the power asked for, the charge, the
 * speed: see the top); running, a generator (series) or on the wheels on a fixed ratio (parallel).
 * Returns { Tw (N m at the wheels), Ix, Pgen (W into the motor and the pack), fuelJ }.
 */
function hybridEngine(c, dt, thr, dir) {
  const S = c.spec, E = S.engine, H = S.hybrid, B = S.battery, Mo = S.motor;
  const I = c.ice;
  I.t += dt;
  const v = Math.abs(c.u);
  const Pdem = thr * Mo.pmax;
  const canRun = c.running && !c.dead && c.fuel > 0.05;
  const need = canRun && (c.soc < H.socLow || Pdem > B.pMax * 0.7 || v > H.vHigh || (c.soc < H.socMid && v > H.vEv));
  const rest = c.soc > H.socHigh && Pdem < B.pMax * 0.35 && v < H.vHigh - 3;
  if (!I.on && need && I.t > 1) {
    I.on = true;
    I.crank = 0.4;
    I.t = 0;
    sfx(c, 'iceStart', { rpm: E.idle });
  } else if (I.on && (!canRun || (rest && I.t > 4))) {
    I.on = false;
    I.crank = 0;
    I.t = 0;
    sfx(c, 'iceStop', { rpm: I.rpm });
  }
  const out = { Tw: 0, Ix: 0, Pgen: 0, fuelJ: 0 };
  I.power = 0;
  if (!I.on) {
    I.mode = 'ev';
    I.rpm = Math.max(0, I.rpm - 3000 * dt);
    c.rpm = I.rpm;
    return out;
  }
  if (I.crank > 0) {
    // spun up by the generator: it fires at once
    I.crank -= dt;
    I.mode = 'start';
    I.rpm += (E.idle * 1.2 - I.rpm) * Math.min(1, dt * 10);
    c.rpm = I.rpm;
    return out;
  }
  const weLock = Math.abs(c.omega) * H.ratio;
  let Te = 0;
  if (dir > 0 && v > H.vLock && weLock * RPM > E.idle * 1.1) {
    // parallel: the clutch in, the engine on the wheels; what it makes over the driver's ask charges the pack
    I.mode = 'parallel';
    I.rpm = weLock * RPM;
    const charge = c.soc < H.socTarget ? clamp((H.socTarget - c.soc) * 2, 0, 0.3) : 0;
    const Tdrive = engineTorque(E, I.rpm, thr);
    Te = engineTorque(E, I.rpm, clamp(thr + charge, 0, 1));
    out.Tw = Tdrive * H.ratio * S.eff * Math.sign(c.omega || 1);
    out.Ix = E.inertia * H.ratio * H.ratio;
    out.Pgen = Math.max(0, Te - Tdrive) * weLock * H.genEff;
  } else {
    // series: a generator; its revs with the power it makes
    I.mode = 'series';
    const want = clamp(Pdem * 1.05 + (H.socTarget - c.soc) * H.pCharge, H.pMin, H.pGenMax);
    const rpmT = E.idle + (want / H.pGenMax) * (H.rpmGen - E.idle);
    I.rpm += (rpmT - I.rpm) * Math.min(1, dt * 2.5);
    const we = I.rpm / RPM;
    Te = Math.max(0, engineTorque(E, I.rpm, throttleFor(E, I.rpm, want / we)));
    out.Pgen = Te * we * H.genEff;
  }
  c.rpm = I.rpm;
  const P = Math.max(0, Te) * (I.rpm / RPM);
  I.power = P;
  const litres = ((P * E.bsfc) / E.rho + E.idleFlow) * dt;
  c.fuel = Math.max(0, c.fuel - litres);
  c.used += litres;
  out.fuelJ = litres * 0.74 * 43e6 * 0.3; // (as electrical-equivalent energy for the consumption shown)
  return out;
}

/**
 * The drive's (an axle's, or the two locked together) spin after dt: I ω' = T − Σ F_x R − brake,
 * F_x = C (ωR − v)/den within ±lim per axle (tyres a, b); implicit in the tyres (they are stiff), a
 * tyre past its grip passes only its limit (sliding: the wheel spins up or down freely against it);
 * the brake stops it at 0 (locked) rather than turn it back.
 */
function axleSolve(w, I, T, Tb, R, dt, a, b = null) {
  let satA = 0, satB = 0, fixed = 0, k = 0, wn = w;
  for (let it = 0; it < 3; it++) {
    k = 0;
    let q = 0;
    if (!satA) {
      k += (a.C * R * R) / a.den;
      q += (a.C * R * a.v) / a.den;
    }
    if (b && !satB) {
      k += (b.C * R * R) / b.den;
      q += (b.C * R * b.v) / b.den;
    }
    wn = (w + (dt / I) * (T - fixed * R + q)) / (1 + (dt / I) * k);
    let changed = false;
    if (!satA) {
      const F = (a.C * (wn * R - a.v)) / a.den;
      if (Math.abs(F) > a.lim) {
        satA = Math.sign(F) || 1;
        fixed += satA * a.lim;
        changed = true;
      }
    }
    if (b && !satB) {
      const F = (b.C * (wn * R - b.v)) / b.den;
      if (Math.abs(F) > b.lim) {
        satB = Math.sign(F) || 1;
        fixed += satB * b.lim;
        changed = true;
      }
    }
    if (!changed) break;
  }
  if (Tb > 0) {
    const d = ((dt / I) * Tb) / (1 + (dt / I) * k);
    if (Math.abs(wn) <= d) wn = 0;
    else wn -= Math.sign(wn) * d;
  }
  return wn;
}

/** The wheels' points (world x, z) and the axles' x: FL, FR, RL, RR. */
export function wheelPoints(c) {
  const S = c.spec, cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
  const hw = S.track / 2;
  const pts = [];
  for (const [lx, lz] of [[S.wheelX, -hw], [S.wheelX, hw], [-S.wheelX, -hw], [-S.wheelX, hw]]) pts.push([c.x + lx * cy + lz * sy, c.z - lx * sy + lz * cy]);
  return pts;
}

/**
 * The body set on its wheels: height, pitch and roll from the ground under each; airborne off an
 * edge. The grip under each wheel goes into c.groundInfo.muW (FL, FR, RL, RR): the tyres take it.
 */
export function followGround(c, dt, env) {
  const S = c.spec;
  const pts = wheelPoints(c);
  const from = c.y + Math.max(S.maxStep, env.h ?? 0) + 0.05;
  const g = pts.map(([x, z]) => groundAt(env, x, z, from));
  const hs = g.map((q) => (q && Number.isFinite(q.y) ? q.y : -Infinity));
  const finite = hs.filter(Number.isFinite);
  const low = finite.length ? Math.min(...finite) : c.y - 10;
  for (let i = 0; i < 4; i++) if (!Number.isFinite(hs[i])) hs[i] = low;
  const hF = (hs[0] + hs[1]) / 2, hR = (hs[2] + hs[3]) / 2, hL = (hs[0] + hs[2]) / 2, hRt = (hs[1] + hs[3]) / 2;
  const target = (hs[0] + hs[1] + hs[2] + hs[3]) / 4;
  const L = 2 * S.wheelX;
  const pitchG = Math.atan2(hF - hR, L);
  const rollG = Math.atan2(hL - hRt, S.track);
  const best = g.reduce((a, q) => (q && (q.mu ?? 1) > (a?.mu ?? -1) ? q : a), null);
  const muW = g.map((q) => q?.mu ?? 1);
  c.groundInfo = { mu: (muW[0] + muW[1] + muW[2] + muW[3]) / 4, muW, road: g.filter((q) => q?.road).length >= 2, material: best?.material };
  if (target >= c.y - 0.04 || (!c.air && target >= c.y - 0.25 && c.vy >= -0.5)) {
    // on the ground (a dip of a few cm: it follows it down, on its springs)
    if (c.air && c.vy < -3) {
      c.damage = Math.min(1, c.damage + Math.max(0, -c.vy - 6) * 0.05);
      sfx(c, 'land', { v: -c.vy, p: [c.x, target, c.z] });
    }
    c.vy = (target - c.y) / Math.max(dt, 1e-4);
    if (c.vy > 6) c.vy = 6;
    c.y = target;
    c.air = false;
    c.pitchG = pitchG;
    c.rollG = rollG;
  } else {
    // off an edge: it falls
    c.air = true;
    c.vy -= G * dt;
    c.y += c.vy * dt;
    if (c.y < target) {
      c.y = target;
      c.air = false;
      if (c.vy < -3) {
        c.damage = Math.min(1, c.damage + Math.max(0, -c.vy - 6) * 0.05);
        sfx(c, 'land', { v: -c.vy, p: [c.x, target, c.z] });
      }
      c.vy = 0;
      c.pitchG = pitchG;
      c.rollG = rollG;
    }
  }
}

/** The springs: the body pitches with the acceleration, rolls in a turn (a damped spring each). */
function springs(c, dt) {
  const w0 = 9, z = 0.45;
  const tp = clamp(c.ax * 0.007, -0.08, 0.08); // (braking: the nose dips)
  const tr = clamp(-c.ay * 0.009, -0.1, 0.1); // (turning left: it leans right)
  c.pitchW += (-(w0 * w0) * (c.pitchS - tp) - 2 * z * w0 * c.pitchW) * dt;
  c.pitchS += c.pitchW * dt;
  c.rollW += (-(w0 * w0) * (c.rollS - tr) - 2 * z * w0 * c.rollW) * dt;
  c.rollS += c.rollW * dt;
  c.pitch = c.pitchG + c.pitchS;
  c.roll = c.rollG + c.rollS;
}

/** Speed (m/s, signed: + ahead). */
export const speedOf = (c) => c.u;

/**
 * The car's model frame in the world: the rotation R (row-major 3×3: R·local = world offset) of
 * yaw about y, then pitch about z (nose up), then roll about x (+: leaning right), and its origin.
 */
export function carRot(yaw, pitch = 0, roll = 0) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  // Ry = [cy 0 sy; 0 1 0; -sy 0 cy], Rz(p) = [cp -sp 0; sp cp 0; 0 0 1], Rx(r) = [1 0 0; 0 cr -sr; 0 sr cr]
  // R = Ry·Rz·Rx
  const a = [cy * cp, -cy * sp, sy, sp, cp, 0, -sy * cp, sy * sp, cy];
  // ·Rx
  return [a[0], a[1] * cr + a[2] * sr, -a[1] * sr + a[2] * cr, a[3], a[4] * cr + a[5] * sr, -a[4] * sr + a[5] * cr, a[6], a[7] * cr + a[8] * sr, -a[7] * sr + a[8] * cr];
}
export function carToWorld(c, l, R = carRot(c.yaw, c.pitch, c.roll)) {
  return [c.x + R[0] * l[0] + R[1] * l[1] + R[2] * l[2], c.y + R[3] * l[0] + R[4] * l[1] + R[5] * l[2], c.z + R[6] * l[0] + R[7] * l[1] + R[8] * l[2]];
}
