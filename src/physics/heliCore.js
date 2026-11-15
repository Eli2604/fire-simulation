/**
 * The helicopter on the rigid-body core (the 'core' physics of ai/helicopter.js; h.physics = 'legacy'
 * keeps the old one). Its airframe is one body (physics/vehicleCore.js: a world of its own on the
 * simulation's voxels, or on host.ground as a heightfield when there are none):
 *
 *   the cabin (a box over the skids), the tail boom (a capsule aft at the cabin's roof) and the
 *   two skids (capsules either side at the bottom: what it stands and lands on), ~HELI.mass, its
 *   centre of mass in the cabin over the skids; the frame the helicopter's own (x forward, y up,
 *   z right, the origin at the skids' bottom under the mast: h.p).
 *
 *  - In the air and on its skids its pilot model flies it as before (the pilot's velocity, the
 *    attitude from the disc's tilt; you on the controls; the failures' descents: the tail rotor's
 *    spin, the main rotor's fall and tumble, autorotation): each step the body is given the
 *    velocities that take it where the model put it (vehicleCore.trackPose), with gravity off, and
 *    the world steps. Something in the way (a building, a tree trunk, the ground under a skid the
 *    model's ground height missed) stops or turns it: what the world changed is handed back to the
 *    model (its velocity, its rates, its pose) when it is more than a nudge.
 *  - The crash (the model's crash(): how hard decides the severity, the hurt, the fire, as before)
 *    lets go of it: from then on it is a free body under gravity with the velocity and the spin it
 *    hit with, and real contacts with the ground: it comes down on its skids, or tips over a skid
 *    and rolls onto its side when it hit sideways or spinning; the wreck lies where it ends up
 *    (h.p, yaw, pitch, roll from the body: ai/helicopter.js stepWreck).
 *
 *   heliBegin(h)        before its model's step: its body (made the first time) in its world
 *   heliTrack(h, dt)    after: the body set to get there (in the air), or let go (a wreck)
 *   heliEnd(h, dt)      after the world's step: the model's state from the body
 *   heliStep(h, dt, fn) all three round fn (the model's step)
 */
import { Box, Capsule, Compound } from './shapes.js';
import { Body } from './body.js';
import { quatFromMat3 } from './math.js';
import { vehicleCollider, groundWorld, setMassProps, boxInertia, trackPose, trackedChange, stepExact, VEHICLE_DT } from './vehicleCore.js';
import { PhysicsWorld } from './world.js';

const WRAP = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** The row-major rotation of the helicopter's axes (columns f, u, r). */
export function heliRot(yaw, pitch, roll) {
  const sy = Math.sin(yaw), cy = Math.cos(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  const f0 = [sy, 0, cy], r0 = [-cy, 0, sy];
  const f = [f0[0] * cp, sp, f0[2] * cp];
  const u1 = [-f0[0] * sp, cp, -f0[2] * sp];
  const r = [r0[0] * cr - u1[0] * sr, -u1[1] * sr, r0[2] * cr - u1[2] * sr];
  const u = [u1[0] * cr + r0[0] * sr, u1[1] * cr, u1[2] * cr + r0[2] * sr];
  return [f[0], u[0], r[0], f[1], u[1], r[1], f[2], u[2], r[2]];
}
/** Yaw, pitch, roll back from such a rotation. */
export function heliAngles(R) {
  const pitch = Math.asin(Math.max(-1, Math.min(1, R[3])));
  const yaw = Math.atan2(R[0], R[6]);
  const roll = Math.atan2(-R[5], R[4]);
  return { yaw, pitch, roll };
}

/** Its airframe: cabin, boom, skids. */
export function heliShape() {
  return new Compound([
    { shape: new Box(2.6, 0.85, 1.05), pos: [0.3, 1.45, 0] }, // the cabin (5.2 m × 1.7 m × 2.1 m), over the skids
    { shape: new Capsule(0.32, [-2.2, 0, 0], [-8.6, 0.25, 0]), pos: [0, 1.95, 0] }, // the tail boom
    { shape: new Capsule(0.06, [-1.6, 0, 0], [2.3, 0, 0]), pos: [0, 0.06, 1.2] }, // the skids
    { shape: new Capsule(0.06, [-1.6, 0, 0], [2.3, 0, 0]), pos: [0, 0.06, -1.2] },
  ]);
}

function worldOf(h) {
  const host = h.host ?? {};
  const w = host.sim?.world ?? host.world;
  // (one world per helicopter: they do not meet each other here)
  if (w?.mat?.length && w.flags && w.nx > 0) return new PhysicsWorld({ collider: vehicleCollider(w), fixedDt: VEHICLE_DT, substeps: 1, maxSteps: 40, iterations: 10, seed: 17 });
  return groundWorld((x, z) => h.ground(x, z));
}

function bodyOf(h) {
  const K = (h.core ??= { body: null, world: null, free: false, seen: null });
  if (K.body) return K.body;
  K.world = worldOf(h);
  const R = heliRot(h.yaw, h.pitch, h.roll);
  const B = new Body({ shape: heliShape(), position: h.p.slice(), quaternion: quatFromMat3([0, 0, 0, 1], R), material: 'aluminium', linearDamping: 0.02, angularDamping: 0.1, gravityScale: 0 });
  const m = h.mass ?? 7000;
  // (its centre of mass high in the cabin: the engines and the gearbox are on its roof)
  setMassProps(B, m, [0.2, 1.6, 0], boxInertia(m, 11, 2.6, 2.6));
  // (skids dig in: a slide sideways on them trips it over)
  B.friction = 0.9;
  B.restitution = 0.1;
  B.buoyant = false;
  B.canSleep = false;
  B.userData = { heli: h };
  K.world.addBody(B);
  K.body = B;
  K.seen = null;
  return B;
}

const SEEN = (h) => [h.p[0], h.p[1], h.p[2], h.yaw, h.pitch, h.roll];

/** Before its model's step: its body; a pose written from outside (placed) taken over. */
export function heliBegin(h) {
  const B = bodyOf(h), K = h.core;
  const s = SEEN(h);
  if (K.seen && s.some((v, k) => Math.abs(v - K.seen[k]) > 1e-9)) B.setPose(h.p.slice(), quatFromMat3([0, 0, 0, 1], heliRot(h.yaw, h.pitch, h.roll)));
  return B;
}

/** After its model's step: carried there (in the air, on its skids), or let go (crashed). */
export function heliTrack(h, dt) {
  const K = h.core, B = K.body;
  if (h.crashed) {
    if (!K.free) {
      // let go: the velocity and the spin it hit with (crash() keeps them: the model zeroes its own)
      letGo(h, B);
      B.vel = (h.crashV ?? [0, 0, 0]).slice();
      // the rates: pitch (nose up) about its right axis r, roll (right side down) about its forward
      // axis f, yaw about the world's up
      const [pr, rr, yr] = h.crashRates ?? [0, 0, 0];
      const R = B.R;
      const f = [R[0], R[3], R[6]], r = [R[2], R[5], R[8]];
      B.angVel = [pr * r[0] + rr * f[0], pr * r[1] + rr * f[1] + yr, pr * r[2] + rr * f[2]];
      B.wake();
    }
    return;
  }
  K.free = false;
  B.gravityScale = 0;
  trackPose(B, h.p, quatFromMat3([0, 0, 0, 1], heliRot(h.yaw, h.pitch, h.roll)), dt);
}

/** A free body from now on (a wreck): gravity, its own contacts, it may sleep. */
function letGo(h, B) {
  h.core.free = true;
  B.track = null;
  B.gravityScale = 1;
  B.canSleep = true;
  B.wake();
}

/** After the world's step: the model's state from its body. */
export function heliEnd(h, dt) {
  const K = h.core, B = K.body;
  const p = B.shapePos();
  const a = heliAngles(B.R);
  if (K.free) syncFree(h, B, a, p);
  else if (B.track) {
    const { dv, dw } = trackedChange(B);
    // (a nudge, the skids settling on the voxels: the model keeps its own; more is what it hit. Near
    // the ground its touchdown or crash is the model's own: it decides how hard, then lets go)
    const low = h.p[1] - h.ground(h.p[0], h.p[2]) < 1.0;
    const hit = Math.hypot(dv[0], dv[1], dv[2]) + 2 * Math.hypot(dw[0], dw[1], dw[2]);
    if (!low && hit > 2.5 && !h.landed) {
      // it flew (or tumbled) into something: the boom, the rotor, the cabin against a wall, the
      // ground under a tail pointing down: that is its crash (how hard: the model's), and from
      // here it is a free body going on from the contact
      h.v = B.track.v.slice();
      h.crash();
      letGo(h, B);
      syncFree(h, B, a, p);
      K.seen = SEEN(h);
      return;
    }
    if (!low && hit > 0.3) {
      h.p = p;
      h.yaw = h.yaw + WRAP(a.yaw - h.yaw);
      h.pitch = a.pitch;
      h.roll = a.roll;
      for (let i = 0; i < 3; i++) h.v[i] += dv[i];
      h.yawRate = (h.yawRate ?? 0) + dw[1];
      h.bumped = (h.bumped ?? 0) + 1;
    }
  }
  K.seen = SEEN(h);
}

function syncFree(h, B, a, p) {
  h.p = p;
  h.yaw = h.yaw + WRAP(a.yaw - h.yaw);
  h.pitch = a.pitch;
  h.roll = a.roll;
  h.v = B.vel.slice();
}

/** The model's step fn() between: the body carried to where it flew, or tumbling free as a wreck. */
export function heliStep(h, dt, fn) {
  heliBegin(h);
  const K = h.core;
  fn();
  heliTrack(h, dt);
  stepExact(K.world, dt);
  heliEnd(h, dt);
}
