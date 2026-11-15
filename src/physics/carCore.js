/**
 * Cars on the rigid-body core (the 'core' physics of sim/carPhysics.js; c.physics = 'legacy' keeps
 * the old planar model). One car = one chassis body in a PhysicsWorld (physics/vehicleCore.js: the
 * world's cars share one, a car stepped on its own (stepCar with no world) has its own on the
 * env's ground as a heightfield).
 *
 *  - The chassis: a box (convex hull) of the car's length and width from its ground clearance (the
 *    old model's: what is lower is climbed, a kerb up to maxStep) to the roof, its mass massOf(c)
 *    (the car, its load, its fuel: set again as they change), its centre of mass where carSpec puts
 *    it (cgX ahead of the middle, cgH up), the inertia of the box (yaw: m(L²+W²)/12, as the old
 *    model's I_z). The model frame (x forward, y up, z right, the origin on the ground between the
 *    wheels) is the shape frame: c.x, c.y, c.z, c.yaw, c.pitch, c.roll are the body's pose.
 *  - The suspension: a spring–damper per wheel (FL, FR, RL, RR at ±wheelX, ±track/2), at ~1.6 Hz,
 *    ζ 0.55, preloaded with the wheel's static share of the weight (so at rest the model origin sits
 *    on the ground, as before), pushing along the ground's normal (the plane of the four ground
 *    points) at the wheel; the ground under each wheel is env.ground as before (the voxels, the
 *    ruts and sinkage of sim/groundContact.js, its grip μ per wheel). A wheel more than its droop
 *    over the ground is off it; with none on, the car is in the air (no grip). Landing hard: the
 *    'land' event and its damage, as before.
 *  - The tyres, drivetrain, EV / hybrid, ESP, steering, brakes: carPhysics.js subStep, unchanged,
 *    run every physics substep (1/120 s) in its own sub-steps (1/360 s: the tyres are stiff) over
 *    the body's velocity (env.core: it does not move the car itself); the change it makes to the
 *    velocity and the yaw rate (less the slope's pull, which gravity gives the body) is applied as a
 *    force at the ground under the centre of mass and a torque about the vertical. The tyres' loads
 *    are what the springs carry on each axle (the load moved across in a turn, onto the low side
 *    on a slope; nothing on a wheel in the air). The tyre forces act at ground level, so the body pitches when it
 *    brakes, leans in a turn, and with enough side force (a sharp turn across a slope, a kerb hit
 *    sideways) rolls over: then its wheels are off the ground and it lies on its side or its roof
 *    (c.upturned).
 *  - What it hits is the engine's: the voxels (vehicleCollider: not soft ground cover, not its own
 *    or another vehicle's stamped voxels; the world's edge a wall), the other cars' bodies; each
 *    impact (closing speed, point, normal, material) is handed to sim/cars.js (damage, the crash
 *    sound, crushed cells, sim/impact.js).
 *
 *   stepCarCore(c, dt, env)       carPhysics.stepCar for a core car (a world of its own on env.ground)
 *   carCoreWorld(cars, ctx)       the world for a list of cars (sim/cars.js stepCarList)
 *   attachCar(c, PW, env, h)      its chassis body in PW (made the first time); env: its ground
 *   prepareCar(c, active)         its mass and sleep before a step (an active car does not sleep)
 *   syncCar(c)                    the car's pose and velocity from its body after a step
 *   pushCarVelocity(c)            the car's velocity (changed by the world layer: people) to its body
 *   takeImpacts(c)                the impacts on it since the last call
 */
import { ConvexHull } from './shapes.js';
import { Body } from './body.js';
import { quatFromMat3 } from './math.js';
import { groundWorld, vehicleWorld, vehicleColliderOf, vehicleFilter, setMassProps, boxInertia, inertiaAbout, yprOf } from './vehicleCore.js';
import { subStep, massOf, sfx, G, carRot } from '../sim/carPhysics.js';
import { groundDrag } from '../sim/groundContact.js';

const W_SPRING = 2 * Math.PI * 1.6;
/**
 * The tyres' sub-step on the core (carPhysics' subStep inside the force generator): one per world
 * substep (1/120 s) on the move; at walking pace and below, where the slip angle's floor (UMIN) makes
 * the tyres stiffest (the side slip decays at ~85/s: k·dt 0.7 at 1/120 s), 1/240 s. The old model ran
 * at 1/300 s; the paths agree within a few per cent (a slalom on the flat and across a slope).
 */
export const CORE_TYRE_STEP = 1 / 120;
const CORE_TYRE_STEP_SLOW = 1 / 240;
const Z_SPRING = 0.55;
const WRAP = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const groundAt = (env, x, z, y) => env?.ground?.(x, z, y) ?? { y: 0, mu: 1, road: true };

/** The height the chassis box starts at: what is lower than this the wheels climb (a kerb). */
export const chassisClearance = (S, h = 0) => Math.max(S.maxStep, h * 1.05) + 0.03;

function coreOf(c) {
  return (c.core ??= { body: null, world: null, env: null, inner: { core: true, loadF: undefined, loadR: undefined, h: 0, ground: null }, m: 0, impacts: [], wheels: [0, 1, 2, 3].map(() => ({ contact: false, load: 0, gap: 0 })), upturned: false });
}

/** The chassis of c (its body: made on first use). */
function chassisOf(c, h) {
  const K = coreOf(c);
  if (K.body) return K.body;
  const S = c.spec;
  const clear = chassisClearance(S, h);
  const top = Math.max(clear + 0.35, S.H * 0.96);
  const hl = S.L / 2 - 0.02, hw = S.W / 2 - 0.02;
  // (its underside bevelled all round, as a car's is: a step it meets slides it up rather than snag it)
  const bev = Math.min(0.3, (top - clear) * 0.3);
  const pts = [];
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    pts.push([x * (hl - bev), clear, z * (hw - bev * 0.7)]);
    pts.push([x * hl, clear + bev, z * hw], [x * hl, top, z * hw]);
  }
  const R = carRot(c.yaw, c.pitch ?? 0, c.roll ?? 0);
  const B = new Body({ shape: new ConvexHull(pts), position: [c.x, c.y, c.z], quaternion: quatFromMat3([0, 0, 0, 1], R), material: 'steel', linearDamping: 0, angularDamping: 0.05, mass: 1000 });
  B.buoyant = false;
  // (a car's body crumples: little bounce; nothing like a ball's rolling resistance)
  B.restitution = 0.2; // (as the old model's car–car e)
  B.rollingResistance = 0;
  B.vel = [c.vx ?? 0, c.vy ?? 0, c.vz ?? 0];
  B.angVel = [0, c.wz ?? 0, 0];
  B.userData = { car: c, onImpact: (e, self, other) => K.impacts.push({ e, other }), onBlast: (dv) => carBlast(c, dv) };
  vehicleFilter(B, 'car');
  B.forceGenerators.push((b, dt) => carForces(c, b, dt));
  K.body = B;
  setCarMass(c);
  return B;
}

/** A blast pushed it by dv (its body takes the push: vehicleCore.blastVehicles): the damage, the bang heard on it. */
function carBlast(c, dv) {
  const v = Math.hypot(dv[0], dv[1], dv[2]);
  if (v < 0.2) return;
  c.damage = Math.min(1, (c.damage ?? 0) + (v / 5) ** 2);
  c.blasted = { dv: v, time: c.t };
  sfx(c, 'crash', { v: v * 4, p: [c.x, c.y + 0.5, c.z], material: 'steel' });
  if (c.damage >= 1 && !c.dead) {
    c.dead = true;
    c.wrecked = true;
    c.why = 'wrecked';
  }
}

/** Its mass, centre of mass and inertia from what it carries now. */
function setCarMass(c) {
  const K = c.core, S = c.spec, m = massOf(c);
  if (Math.abs(m - K.m) <= 0.002 * m) return;
  K.m = m;
  setMassProps(K.body, m, [S.cgX, S.cgH, 0], boxInertia(m, S.L, S.H, S.W));
}

/** Its chassis in world PW (moved there from another world if need be); env: its ground; w: the sim World (its voxels as a car meets them). */
export function attachCar(c, PW, env, h = 0, w = null) {
  const K = coreOf(c);
  const B = chassisOf(c, h);
  if (B.world !== PW) {
    B.world?.removeBody(B);
    PW.addBody(B);
  }
  B.collider = w?.mat ? vehicleColliderOf(w, 'car') : null;
  K.world = PW;
  K.env = env;
  return B;
}

/** Before a step: its mass now; an active car (running, cranking, pushed on) stays awake. */
export function prepareCar(c, active) {
  const B = c.core.body;
  adoptWrites(c);
  setCarMass(c);
  B.canSleep = !active;
  if (active && B.sleeping) B.wake();
}

/** The world a list of cars is stepped in: their sim World's, or one of their own on ctx.ground. */
export function carCoreWorld(cars, ctx = {}) {
  const w = ctx.world;
  if (w?.mat) return vehicleWorld(w, 'car');
  let PW = null;
  for (const c of cars) if (c.core?.world?.ownGround && !c.core.world.mine) PW = c.core.world;
  if (!PW) {
    PW = groundWorld((x, z) => groundAt(PW.groundEnv, x, z, 1e6)?.y ?? null);
    PW.ownGround = true;
    PW.accumulate = true; // (stepped as before: its fixed steps and the remainder carried)
  }
  PW.groundEnv = { ground: ctx.ground ? (x, z) => ctx.ground(x, z) : null };
  return PW;
}

/** carPhysics.stepCar on the core: its own world on env's ground. */
export function stepCarCore(c, dt, env = {}) {
  const K = coreOf(c);
  if (!K.world?.ownGround || K.world.mine !== c) {
    const PW = groundWorld((x, z) => groundAt(K.env, x, z, 1e6)?.y ?? null);
    PW.ownGround = true;
    PW.mine = c;
    K.world = PW;
  }
  attachCar(c, K.world, env, env.h ?? 0);
  const inp = c.input ?? {};
  prepareCar(c, c.running || c.crank > 0 || (inp.throttle ?? 0) > 0);
  stepWorld(K.world, dt);
  syncCar(c);
  K.impacts.length = 0;
  return c;
}

/** Step a world by dt (in pieces of at most maxSteps fixed steps). */
export function stepWorld(PW, dt) {
  let left = dt;
  const chunk = PW.fixedDt * (PW.maxSteps - 1);
  while (left > 1e-12) {
    const d = Math.min(left, chunk);
    PW.step(d);
    left -= d;
  }
}

const SEEN = ['x', 'y', 'z', 'yaw', 'pitch', 'roll', 'vx', 'vy', 'vz', 'wz'];
/** What was written to the car from outside since the last sync (put it there, set it going): to the body. */
function adoptWrites(c) {
  const K = c.core, B = K.body, s = K.seen;
  if (!s) return;
  let pose = false, vel = false;
  for (let k = 0; k < 10; k++) {
    const v = c[SEEN[k]] ?? 0;
    if (Math.abs(v - s[k]) > 1e-9) k < 6 ? (pose = true) : (vel = true);
  }
  if (pose) B.setPose([c.x, c.y, c.z], quatFromMat3([0, 0, 0, 1], carRot(c.yaw, c.pitch ?? 0, c.roll ?? 0)));
  if (vel) {
    B.vel = [c.vx ?? 0, c.vy ?? 0, c.vz ?? 0];
    B.angVel = [B.angVel[0], c.wz ?? 0, B.angVel[2]];
  }
  if (pose || vel) B.wake();
}

/** The car's pose and velocity from its body. */
export function syncCar(c, light = false) {
  const B = c.core?.body;
  if (!B) return;
  const p = B.shapePos();
  c.x = p[0];
  c.y = p[1];
  c.z = p[2];
  const e = yprOf(B.R);
  c.yaw = (c.yaw ?? 0) + WRAP(e[0] - (c.yaw ?? 0));
  c.pitch = e[1];
  c.roll = e[2];
  c.vx = B.vel[0];
  c.vy = B.vel[1];
  c.vz = B.vel[2];
  c.wz = B.angVel[1];
  const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
  c.u = c.vx * cy - c.vz * sy;
  c.v = c.vx * sy + c.vz * cy;
  c.upturned = B.R[4] < 0.2;
  c.core.upturned = c.upturned;
  if (light) return; // (inside a step: the last sync of the step records what it left)
  const s = (c.core.seen ??= new Array(10));
  for (let k = 0; k < 10; k++) s[k] = c[SEEN[k]];
}

/** Its velocity (as the world layer left it: a man in the way) back to the body. */
export function pushCarVelocity(c) {
  const B = c.core?.body;
  if (!B) return;
  if (B.vel[0] !== c.vx || B.vel[2] !== c.vz) {
    B.vel[0] = c.vx;
    B.vel[2] = c.vz;
    if (B.sleeping && Math.hypot(c.vx, c.vz) > 0.01) B.wake();
  }
}

/** The impacts on it since the last call: [{ e (the world's event), other (body or null) }]. */
export function takeImpacts(c) {
  const K = c.core;
  if (!K?.impacts.length) return [];
  const out = K.impacts.slice();
  K.impacts.length = 0;
  return out;
}

/** Its body is moving (awake and not still). */
export function carBodyMoving(c) {
  const B = c.core?.body;
  if (!B || B.sleeping) return false;
  return Math.hypot(B.vel[0], B.vel[1], B.vel[2]) > 0.02 || Math.hypot(B.angVel[0], B.angVel[1], B.angVel[2]) > 0.02;
}

/* ------------------------------------------------------------------ the force generator */

const WHEELS = [[1, -1], [1, 1], [-1, -1], [-1, 1]]; // FL, FR, RL, RR: (± wheelX, ± track/2)

/** Each substep h: the springs on the ground under the wheels, then the tyres (carPhysics) as a force. */
function carForces(c, B, h) {
  const K = c.core, S = c.spec, env = K.env;
  syncCar(c, true);
  const m = B.mass;
  const R = B.R;
  const upY = R[4];
  const L = S.a + S.b, hw = S.track / 2;
  // ---- the ground under each wheel
  // (scratch kept on the car: this runs every substep)
  const p = (K.p ??= [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]);
  const g = (K.g ??= [null, null, null, null]);
  const wl = (K.wl ??= WHEELS.map(([fx, fz]) => [fx * S.wheelX, 0, fz * hw]));
  const from = Math.max(S.maxStep, env?.h ?? 0) + 0.05;
  for (let q = 0; q < 4; q++) {
    B.shapeToWorld(wl[q], p[q]);
    const gq = upY > 0.25 ? groundAt(env, p[q][0], p[q][2], p[q][1] + from) : null;
    g[q] = gq && Number.isFinite(gq.y) ? gq : null;
  }
  // the ground's slope (as the old model read it: from the four heights)
  const hs = g.map((q, k) => (q ? q.y : p[k][1] - 1));
  const pitchG = Math.atan2((hs[0] + hs[1]) / 2 - (hs[2] + hs[3]) / 2, 2 * S.wheelX);
  const rollG = Math.atan2((hs[0] + hs[2]) / 2 - (hs[1] + hs[3]) / 2, S.track);
  const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
  // its normal: (right, down the roll) × (forward, up the pitch)
  const tp = Math.tan(pitchG), tr = Math.tan(rollG);
  const Fv = [cy, tp, -sy], Rv = [sy, -tr, cy];
  let n = [Rv[1] * Fv[2] - Rv[2] * Fv[1], Rv[2] * Fv[0] - Rv[0] * Fv[2], Rv[0] * Fv[1] - Rv[1] * Fv[0]];
  const nl = Math.hypot(n[0], n[1], n[2]) || 1;
  n = [n[0] / nl, n[1] / nl, n[2] / nl];
  // ---- the springs
  const droop = G / (W_SPRING * W_SPRING) + 0.03;
  let nF = 0, nR = 0;
  const v = [0, 0, 0];
  for (let q = 0; q < 4; q++) {
    const W = K.wheels[q];
    const gq = g[q];
    W.contact = false;
    W.load = 0;
    if (!gq) continue;
    const gap = p[q][1] - gq.y;
    W.gap = gap;
    if (gap > droop) continue;
    const mw = (m * (q < 2 ? S.b : S.a)) / L / 2;
    const k = mw * W_SPRING * W_SPRING, d = 2 * Z_SPRING * W_SPRING * mw;
    B.velocityAt(p[q], v);
    const vn = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
    const Fs = Math.min(mw * G * 6, Math.max(0, mw * G - k * gap - d * vn));
    W.contact = true;
    W.load = Fs;
    if (q < 2) nF++;
    else nR++;
    if (Fs > 0) B.applyForce([n[0] * Fs, n[1] * Fs, n[2] * Fs], p[q]);
  }
  // what the tyres stand on (as followGround had it)
  const muW = g.map((q) => q?.mu ?? 1);
  const best = g.reduce((a, q) => (q && (q.mu ?? 1) > (a?.mu ?? -1) ? q : a), null);
  c.groundInfo = { mu: (muW[0] + muW[1] + muW[2] + muW[3]) / 4, muW, road: g.filter((q) => q?.road).length >= 2, material: best?.material };
  const wasAir = c.air;
  c.air = nF + nR === 0;
  if (wasAir && !c.air && c.vy < -3) {
    c.damage = Math.min(1, c.damage + Math.max(0, -c.vy - 6) * 0.05);
    sfx(c, 'land', { v: -c.vy, p: [c.x, c.y, c.z] });
  }
  c.pitchG = c.air ? 0 : pitchG;
  c.rollG = c.air ? 0 : rollG;
  // ---- the tyres: carPhysics over the body's velocity, sub-stepped
  const E = K.inner;
  // (the axles' loads: the springs', smoothed over a few substeps: their dampers' jitter is not the tyres')
  const k = Math.min(1, h * 40);
  const LF = K.wheels[0].load + K.wheels[1].load, LR = K.wheels[2].load + K.wheels[3].load;
  E.loadF = nF ? (E.loadF ?? LF) + (LF - (E.loadF ?? LF)) * k : 0;
  E.loadR = nR ? (E.loadR ?? LR) + (LR - (E.loadR ?? LR)) * k : 0;
  E.h = env?.h ?? 0;
  E.ground = env?.ground;
  const v0x = c.vx, v0z = c.vz, w0 = c.wz;
  const slow = Math.abs(c.u ?? 0) < 4;
  const ns = Math.max(1, Math.ceil(h / (slow ? CORE_TYRE_STEP_SLOW : CORE_TYRE_STEP) - 1e-6)), ds = h / ns;
  for (let s = 0; s < ns; s++) {
    subStep(c, ds, E);
    if (K.groundDrag) groundDrag(c, ds);
  }
  const dvx = c.vx - v0x, dvz = c.vz - v0z, dwz = c.wz - w0;
  // (the slope's pull the old model adds is gravity's: the body has that already)
  const aF = -G * Math.sin(c.pitchG), aR = G * Math.sin(c.rollG);
  const ax = aF * cy + aR * sy, az = -aF * sy + aR * cy;
  const F = [m * (dvx / h - ax), 0, m * (dvz / h - az)];
  B.applyForce(F, B.shapeToWorld([S.cgX, 0, 0]));
  B.applyTorque([0, (inertiaAbout(B, [0, 1, 0]) * dwz) / h, 0]);
  // (what the old model's springs showed: the body's own pitch and roll now)
  c.pitchS = c.pitch - c.pitchG;
  c.rollS = c.roll - c.rollG;
}

