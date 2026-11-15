/**
 * Car dynamics (pure: numbers in, numbers out; no world, no three.js). The world layer
 * (sim/cars.js) gives it the ground and the collisions; the driver (you: walk/carDrive.js; an AI:
 * ai/carDriver.js) gives it the pedals and the wheel.
 *
 * Frame: the model's (models/car.js): x forward, y up, z to the right; its origin on the ground
 * between the wheels. In the world it is turned by yaw about y (three.js), so forward is
 * (cos yaw, -sin yaw) and the right side (sin yaw, cos yaw): a positive yaw rate turns it left.
 *
 *  - Engine: a torque curve T(rpm) (petrol: a broad peak at ~4200 rpm; diesel: low down, ~2000),
 *    times the throttle, less its friction and pumping (∝ rpm: what brakes the car when you lift
 *    off); an idle governor holds it at its idle speed; a rev limiter at the redline. Below its
 *    stall speed with the clutch in it dies. It burns fuel at its brake-specific consumption
 *    (~250 g/kWh petrol, ~220 diesel) and an idle flow, from the tank (litres): empty, it stops.
 *  - Clutch / gearbox: an automatic; from rest the clutch slips (it takes up as the engine revs,
 *    like a torque converter at the launch) and locks once the wheels have the engine's speed;
 *    it shifts up at a speed that rises with the throttle (near the redline flat out), down when
 *    the revs fall low, the drive cut for ~0.3 s while it shifts. Reverse: held back from rest.
 *  - Driven axle (the rear): its wheels' spin ω from the torque through the gears (ratio × final
 *    drive × efficiency), the tyre's force back on it and the brakes; integrated implicitly (the
 *    tyre is stiff) so wheelspin and locked wheels come out of it: slip ratio κ = (ωR − v)/|v|.
 *  - Tyres: longitudinal force C_κ·κ, lateral force −C_α·α (α the slip angle of the wheel's
 *    velocity to the way it points), both within the friction circle μ·F_z (μ: the surface's);
 *    F_z per axle from the weight, the slope and the load moved by braking / accelerating.
 *  - Steering: a bicycle model (one front and one rear wheel per axle at the wheelbase): the front
 *    turned by δ (up to ~32°, less at speed), the yaw from the axles' lateral forces about the
 *    centre of mass (I_z ≈ m(L²+W²)/12).
 *  - Brakes (front-biased 65/35, to the friction limit: harder and the wheels lock and skid), the
 *    handbrake locks the rear; rolling resistance C_rr·F_z and air drag ½ρC_dA·v².
 *  - Ground: the height under each wheel (env.ground), the body set on them (pitch from front to
 *    rear, roll from side to side); it follows the slope (gravity along it) and falls off edges.
 *    The springs show it: the body pitches under braking and acceleration and rolls in a turn
 *    (a damped spring, for looks).
 *  - Collisions: env.collide(c, prev) (the world: voxels, other cars, people) may push it back.
 *
 *   const c = makeCar(carSpec({ length: 4.2 }), { x, y, z, yaw });
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

/** The car of models/car.js params (its size: a hatchback, a jeep, a truck): mass, engine, gears, tyres. */
export function carSpec(params = {}) {
  const L = params.length ?? 4.2, W = params.width ?? 1.8, H = params.height ?? 1.45;
  const heavy = H >= 1.75 || L >= 5;
  const mass = clamp(1250 * ((L * W * H) / (4.2 * 1.8 * 1.45)) ** 0.9, 650, 8000);
  const wheelX = 0.32 * L; // (models/car.js: the wheels at ±0.32 L)
  const cgX = 0.03 * L;
  const diesel = heavy;
  const engine = diesel
    ? { kind: 'diesel', cyl: L >= 5 ? 6 : 4, strokes: 4, idle: 750, redline: 4200, stall: 380, tmax: 0.2 * mass, inertia: 0.35, bsfc: 220 / 3.6e9, idleFlow: 0.9 / 3600, rho: 0.84 }
    : { kind: 'petrol', cyl: 4, strokes: 4, idle: 800, redline: 6400, stall: 420, tmax: 0.17 * mass, inertia: 0.17, bsfc: 250 / 3.6e9, idleFlow: 0.8 / 3600, rho: 0.74 };
  return {
    L, W, H, heavy, mass,
    a: wheelX - cgX, // centre of mass to the front axle
    b: wheelX + cgX, // ... to the rear axle
    wheelX, cgX,
    track: Math.max(1, W - 0.22),
    cgH: heavy ? 0.8 : 0.55,
    wheelR: 0.33,
    Iz: (mass * (L * L + W * W)) / 12,
    engine,
    gears: heavy ? [4.4, 2.6, 1.6, 1.15, 0.88] : [3.6, 2.1, 1.4, 1.0, 0.8],
    reverse: heavy ? 4.2 : 3.4,
    final: heavy ? 4.1 : 3.9,
    eff: 0.9,
    shiftTime: heavy ? 0.45 : 0.3,
    wheelI: heavy ? 6 : 2.4, // driven axle: two wheels, tyres, the half-shafts (kg m²)
    CdA: (heavy ? 0.5 : 0.32) * 0.85 * W * H,
    Crr: heavy ? 0.015 : 0.012,
    cAlpha: 16, // cornering stiffness per unit load (1/rad)
    cKappa: 20, // slip stiffness per unit load
    brake: 1.05, // the brakes' force at full pedal, × m g (front 65 %)
    brakeFront: 0.65,
    maxSteer: heavy ? 0.5 : 0.56,
    steerRate: 2.2, // rad/s at the wheels
    maxStep: 0.45, // m a wheel climbs (a kerb)
    tank: params.fuelLiters ?? 40,
  };
}

/** Engine torque (N m) at rpm, throttle 0..1 (its friction and pumping taken off). */
export function engineTorque(E, rpm, throttle) {
  const C = CURVES[E.kind] ?? CURVES.petrol;
  const x = Math.max(0, rpm) / E.redline;
  let k = C[C.length - 1][1];
  for (let i = 1; i < C.length; i++)
    if (x <= C[i][0]) {
      const [x0, y0] = C[i - 1], [x1, y1] = C[i];
      k = y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
      break;
    }
  const friction = E.tmax * (0.06 + 0.1 * (Math.max(0, rpm) / E.redline));
  return throttle * E.tmax * k - friction;
}

/** A car at rest on the ground at (x, y, z), heading yaw. */
export function makeCar(spec, { x = 0, y = 0, z = 0, yaw = 0, fuel } = {}) {
  return {
    spec,
    x, y, z, yaw, pitch: 0, roll: 0,
    vx: 0, vy: 0, vz: 0, wz: 0, // velocity (m/s, world), yaw rate (rad/s, + left)
    u: 0, v: 0, // forward, rightward speed
    ax: 0, ay: 0, // accelerations along, across (m/s²)
    steer: 0, // front wheels' angle (rad, + left)
    omega: 0, // driven wheels' spin (rad/s)
    spinF: 0, spinR: 0, // the wheels' turn (rad, drawn)
    rpm: 0,
    running: false, crank: 0, why: null,
    gear: 0, // -1 reverse, 0 neutral, 1.. forward
    mode: 'P', // P parked (no one at the wheel), D, R, N
    locked: false, // the clutch: locked or slipping
    clutch: 0, // how much it takes up 0..1 (drawn on the HUD)
    shiftT: 0,
    load: 0, // kg aboard (people, cargo)
    fuel: fuel ?? spec.tank,
    used: 0, // litres burnt
    power: 0, // the engine's power out (W)
    loadK: 0, // its load 0..1 (the sound)
    slipF: 0, slipR: 0, // slip ratio κ (driven) / lock (front)
    alphaF: 0, alphaR: 0, // slip angles
    skid: 0, // how hard the tyres slide (0..1+)
    brakeOn: 0,
    pitchS: 0, pitchW: 0, rollS: 0, rollW: 0, // the springs (for looks)
    pitchG: 0, rollG: 0, // the ground's
    air: false,
    odo: 0,
    damage: 0, // 0..1: crashes (1: wrecked)
    dead: false, // engine gone (burnt, wrecked)
    input: { throttle: 0, brake: 0, steer: 0, handbrake: false },
    sfx: [], // { n, kind: 'start'|'stall'|'shift'|'crash'|'land'|'horn', ... }
    sfxN: 0,
    t: 0,
  };
}

export function sfx(c, kind, o = {}) {
  c.sfx.push({ n: ++c.sfxN, kind, t: c.t, ...o });
  if (c.sfx.length > 24) c.sfx.splice(0, c.sfx.length - 24);
}

/** Mass with what it carries (and its fuel). */
export const massOf = (c) => c.spec.mass + c.load + c.fuel * c.spec.engine.rho;

/** Turn the key: it cranks, then fires (unless dead or dry). */
export function startEngine(c) {
  if (c.running || c.crank > 0) return false;
  if (c.dead) {
    sfx(c, 'crankFail');
    c.why = 'the engine is wrecked';
    return false;
  }
  c.crank = 0.7;
  c.why = null;
  sfx(c, 'start');
  return true;
}
export function stopEngine(c, why = 'off') {
  if (!c.running && c.crank <= 0) return;
  const was = c.running;
  c.running = false;
  c.crank = 0;
  c.why = why;
  if (was && why !== 'off') sfx(c, 'stall', { why });
}

/** The gear ratio of gear g (signed; with the final drive). */
export const ratioOf = (S, g) => (g > 0 ? S.gears[g - 1] * S.final : g < 0 ? -S.reverse * S.final : 0);

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
    c.shiftT = g ? c.spec.shiftTime : 0;
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

/** One sub-step: the engine, the driveline, the tyres, the body, the ground. */
export function subStep(c, dt, env) {
  const S = c.spec, E = S.engine;
  c.t += dt;
  const inp = c.input ?? {};
  const m = massOf(c);
  const R = S.wheelR;
  // ---- the wheel (rate-limited, less lock at speed)
  const vAbs = Math.hypot(c.vx, c.vz);
  const lock = S.maxSteer / (1 + (vAbs / 18) ** 2);
  const want = clamp(inp.steer ?? 0, -1, 1) * lock;
  c.steer += clamp(want - c.steer, -S.steerRate * dt, S.steerRate * dt);
  // ---- the engine's state: cranking, running, dying
  if (c.crank > 0) {
    c.crank -= dt;
    c.rpm = Math.max(c.rpm, 250);
    if (c.crank <= 0) {
      if (c.fuel > 0 && !c.dead) {
        c.running = true;
        c.rpm = E.idle * 1.3;
      } else {
        c.why = c.dead ? 'the engine is wrecked' : 'no fuel';
        sfx(c, 'crankFail');
      }
    }
  }
  if (c.running && c.fuel <= 0) stopEngine(c, 'out of fuel');
  if (c.running && c.dead) stopEngine(c, 'the engine died');
  if (c.shiftT > 0) c.shiftT -= dt;
  autoShift(c, clamp(inp.throttle ?? 0, 0, 1));
  let thr = c.running ? clamp(inp.throttle ?? 0, 0, 1) : 0;
  const brake = clamp(inp.brake ?? 0, 0, 1);
  c.brakeOn = brake;
  // the idle governor; the rev limiter
  if (c.running) {
    thr = Math.max(thr, clamp((E.idle - c.rpm) / 250, 0, 0.5));
    if (c.rpm > E.redline * 1.02) thr = 0;
  }
  if (c.shiftT > 0) thr = Math.min(thr, clamp((E.idle * 1.2 - c.rpm) / 300, 0, 0.3)); // (the drive cut while it shifts)
  // ---- the body's velocities in its own frame
  const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
  const fx = cy, fz = -sy, rx = sy, rz = cy;
  let u = c.vx * fx + c.vz * fz;
  let v = c.vx * rx + c.vz * rz;
  // ---- the ground under the wheels: heights, the slope, its grip
  const air = c.air;
  const gr = c.groundInfo ?? { mu: 1, road: true };
  const mu = air ? 0 : gr.mu ?? 1;
  // loads on the axles: the weight on the slope, moved by the acceleration
  const L = S.a + S.b;
  const gN = G * Math.cos(c.pitchG) * Math.cos(c.rollG);
  const shift = (m * c.ax * S.cgH) / L;
  const FzF = air ? 0 : Math.max(0, (m * gN * S.b) / L - shift);
  const FzR = air ? 0 : Math.max(0, (m * gN * S.a) / L + shift);
  // ---- front axle: steered, braked, rolling
  const cd = Math.cos(c.steer), sd = Math.sin(c.steer);
  const vfLat = v - S.a * c.wz; // (rightward speed of the front axle)
  // the wheel points (cos δ, −sin δ) in (fwd, right) (δ + left)
  const fLong = u * cd - vfLat * sd;
  const fLat = u * sd + vfLat * cd;
  const UMIN = 2;
  c.alphaF = Math.atan2(fLat, Math.max(Math.abs(fLong), UMIN));
  let FyF = -S.cAlpha * FzF * c.alphaF;
  const FbF = brake * S.brake * m * G * S.brakeFront;
  let FxF = 0;
  if (Math.abs(fLong) > 0.05) FxF = -Math.sign(fLong) * Math.min(FbF, mu * FzF);
  else FxF = clamp((-fLong * m * 0.5) / dt, -FbF, FbF); // (held)
  FxF -= Math.sign(fLong) * S.Crr * FzF * Math.min(1, Math.abs(fLong) * 2);
  const lockF = FbF > mu * FzF * 0.98 && Math.abs(fLong) > 1 ? 1 : 0;
  // friction circle
  {
    const t = Math.hypot(FxF, FyF), lim = mu * FzF;
    if (t > lim && t > 0) {
      FxF *= lim / t;
      FyF *= lim / t;
    }
  }
  // ---- the driveline: engine ω_e, clutch, gears, the driven (rear) wheels ω
  const Ie = E.inertia, Iw = S.wheelI;
  const Gr = c.shiftT > 0 ? 0 : ratioOf(S, c.gear);
  const we = c.rpm / RPM;
  const vrLat = v + S.b * c.wz;
  const rLong = u;
  const den = Math.max(Math.abs(rLong), 1);
  const Ck = S.cKappa * FzR;
  const hand = !!inp.handbrake;
  const FbR = brake * S.brake * m * G * (1 - S.brakeFront) + (hand ? 0.9 * m * G : 0);
  const Tb = FbR * R;
  const Te = c.running ? engineTorque(E, c.rpm, thr) : c.crank > 0 ? 0.2 * E.tmax : engineTorque(E, c.rpm, 0);
  let Twheel = 0; // driving torque at the wheels
  let weNew = we;
  let lockedNow = c.locked && Gr !== 0;
  if (lockedNow) {
    // the clutch opens at the bottom (the engine would stall): it slips again
    if (Math.abs(c.omega * Gr) * RPM < E.idle * 0.85) lockedNow = false;
  }
  c.clutch = Gr === 0 ? 0 : lockedNow ? 1 : clamp((c.rpm - E.idle * 1.02) / (900 + 1400 * thr), 0, 1);
  let omega = c.omega;
  if (lockedNow) {
    // engine and wheels as one: inertia at the wheels I_w + I_e G²
    const I = Iw + Ie * Gr * Gr;
    const T = Te * Gr * S.eff;
    omega = wheelSolve(omega, I, T, Tb, Ck, R, rLong, den, mu * FzR, dt);
    weNew = omega * Gr;
  } else {
    // slipping (or out of gear): the clutch passes Tc, its sign the way the slip goes
    let Tc = 0;
    let grips = false;
    if (Gr !== 0) {
      const slip = we - c.omega * Gr;
      Tc = Math.sign(slip) * 1.6 * E.tmax * c.clutch;
      // (it cannot pass more than takes the slip away this step: then it grips)
      const Ired = 1 / (1 / Ie + (Gr * Gr) / Iw);
      const most = (Math.abs(slip) * Ired) / dt;
      if (Math.abs(Tc) >= most) grips = true;
      Tc = clamp(Tc, -most, most);
    }
    weNew = we + ((Te - Tc) / Ie) * dt;
    Twheel = Tc * Gr * S.eff;
    omega = wheelSolve(omega, Iw, Twheel, Tb, Ck, R, rLong, den, mu * FzR, dt);
    if (Gr !== 0 && c.shiftT <= 0) {
      const s0 = we - c.omega * Gr, s1 = weNew - omega * Gr;
      if ((grips || Math.sign(s0) !== Math.sign(s1) || Math.abs(s1) < 3) && Math.abs(omega * Gr) * RPM >= E.idle * 0.9) {
        lockedNow = true;
        weNew = omega * Gr;
      }
    }
  }
  c.locked = lockedNow;
  c.omega = omega;
  // the engine: stalls if dragged below its stall speed while running (no load: it idles back)
  c.rpm = Math.max(0, weNew * RPM);
  if (!c.running && c.crank <= 0) c.rpm = Math.max(0, c.rpm - 1500 * dt * (lockedNow ? 0 : 1));
  if (c.running && c.rpm < E.stall) stopEngine(c, 'stalled');
  // the rear tyre's force from its slip
  c.slipR = (omega * R - rLong) / den;
  let FxR = clamp(Ck * c.slipR, -mu * FzR, mu * FzR);
  if (Math.abs(rLong) > 0.05 || Math.abs(omega) > 0.1) FxR -= Math.sign(rLong) * S.Crr * FzR * Math.min(1, Math.abs(rLong) * 2);
  c.alphaR = Math.atan2(vrLat, Math.max(Math.abs(rLong), UMIN));
  let FyR = -S.cAlpha * FzR * c.alphaR;
  if (hand && Math.abs(rLong) > 0.5) FyR *= 0.45; // (locked rear: it slides)
  {
    const t = Math.hypot(FxR, FyR), lim = mu * FzR;
    if (t > lim && t > 0) {
      FxR *= lim / t;
      FyR *= lim / t;
    }
  }
  c.slipF = lockF;
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
  if (!air && Math.abs(u) < 0.05 && Math.abs(v) < 0.05 && Math.abs(Twheel) < 1 && thr < 0.05 && (brake > 0.05 || hand) && Math.abs(slopeF) < mu * m * G * 0.5) {
    vx = 0;
    vz = 0;
    c.wz = 0;
    c.omega = 0;
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
  c.odo += Math.hypot(c.vx, c.vz) * dt;
  // ---- the ground: the body on its wheels
  followGround(c, dt, env);
  // ---- what it hits (the world's: voxels, other cars, people)
  env.collide?.(c, prev, dt);
  // ---- the wheels' turn (drawn), the skid, the springs, the fuel
  c.spinF += (fLong / R) * dt * (lockF ? 0 : 1);
  c.spinR += omega * dt;
  const latSlide = Math.max(Math.abs(c.alphaF), Math.abs(c.alphaR)) - 0.12;
  c.skid = clamp(Math.max(0, Math.abs(c.slipR) - 0.12) * 3 + (lockF ? 0.8 : 0) + (hand && Math.abs(u) > 1 ? 0.6 : 0) + Math.max(0, latSlide) * 5, 0, 1.5) * (air ? 0 : 1) * clamp(Math.hypot(u, v) / 3 + Math.abs(c.slipR) * 0.3, 0, 1);
  springs(c, dt);
  const P = c.running ? Math.max(0, Te) * (c.rpm / RPM) : 0;
  c.power = P;
  c.loadK = c.running ? clamp(thr * 0.85 + (Twheel > 0 || lockedNow ? 0.15 : 0) * thr, 0, 1) : 0;
  c.thr = thr;
  if (c.running) {
    // power × brake-specific consumption (kg/s), and what it burns just turning over
    const litres = ((P * E.bsfc) / E.rho + E.idleFlow) * dt;
    c.fuel = Math.max(0, c.fuel - litres);
    c.used += litres;
  }
}

/**
 * The driven wheels' spin after dt: I ω' = T − F_x R − brake, F_x = C (ωR − v)/den within ±limit;
 * implicit in the tyre (it is stiff), the brake stops it at 0 (locked) rather than turn it back.
 */
function wheelSolve(w, I, T, Tb, C, R, v, den, limit, dt) {
  const k = (dt / I) * ((C * R * R) / den);
  let wn = (w + (dt / I) * (T + (C * R * v) / den)) / (1 + k);
  let Fx = (C * (wn * R - v)) / den;
  if (Math.abs(Fx) > limit) {
    Fx = Math.sign(Fx) * limit;
    wn = w + (dt / I) * (T - Fx * R);
    // (sliding: the wheel spins up or down freely against the force it can still pass)
  }
  if (Tb > 0) {
    const d = ((dt / I) * Tb) / (Math.abs(Fx) >= limit ? 1 : 1 + k);
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

/** The body set on its wheels: height, pitch and roll from the ground under each; airborne off an edge. */
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
  c.groundInfo = { mu: g.reduce((s, q) => s + (q?.mu ?? 1), 0) / 4, road: g.filter((q) => q?.road).length >= 2, material: best?.material };
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
