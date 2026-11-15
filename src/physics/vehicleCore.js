/**
 * The vehicles on the rigid-body core (cars: physics/carCore.js, boats: physics/boatCore.js, the
 * helicopter: physics/heliCore.js): what they share.
 *
 *   vehiclePhysics(v, kind)     'core' | 'legacy' for a vehicle: v.physics if set, else the default
 *                               of its kind (VEHICLE_PHYSICS[kind]: 'core' for all three; the
 *                               environment variable VEHICLE_PHYSICS=legacy sets them back for a
 *                               headless run, to compare)
 *   vehicleWorld(w, kind)       the PhysicsWorld a sim World's vehicles of one kind live in (made on
 *                               demand, whether sim.rigid is on or not: the tests run headless):
 *                               fixed steps of 1/120 s on the voxel grid through vehicleCollider
 *   vehicleCollider(w, o)       the grid as the vehicles meet it: solid voxels that are not liquid,
 *                               not soft (grass, leaves, twigs, snow: a car drives through them) and
 *                               not a vehicle's own (a car's, a boat's moving-body voxels: they are
 *                               stamped where the body is); the world's edges walls (o.edges); for
 *                               boats the soft beds too (o.beds false: a keel ploughs a furrow in
 *                               them, sim/groundContact.js) and only the hull's points (maxCorners 0)
 *   groundWorld(ground)         a PhysicsWorld of its own for a vehicle stepped with no voxel world
 *                               (a test's range): ground(x, z) → y as a heightfield
 *   setMassProps(b, m, com, I)  a body's mass, centre of mass (shape frame) and inertia (about it,
 *                               in the shape's axes) set, its shape kept where it is in the world
 *   trackPose(b, p, q, dt)      the velocities that take b to a pose in dt; trackedChange(b) what
 *                               the world's step changed beyond them; stepExact(PW, dt) the step
 *
 * Two ways the old models drive their bodies:
 *  - forces (cars): the model's stiff part (the tyres, the drivetrain) runs inside the body's force
 *    generator every substep, from the body's velocity; the change it makes is applied as a force
 *    at the ground and a torque. Gravity, the springs and every contact act on the body itself.
 *  - tracking (boats, the helicopter): the model moves its vehicle as before (Archimedes and the
 *    water's forces; the pilot model); the body is given the velocities that take it there and the
 *    world steps; unless something got in the way it arrives exactly (the old results are kept);
 *    what a contact or a joint changed (trackedChange) goes back into the model's velocities, so
 *    two boats bump, a painter holds, a helicopter stops against a wall or crashes on its boom.
 */
import { PhysicsWorld } from './world.js';
import { VoxelGridCollider } from './voxelCollider.js';
import { m3inverse, m3mulv, vadd, mat3FromQuat, qmul, qconj } from './math.js';
import { MATERIALS } from '../sim/materials.js';

const F_LIQUID = 1;
const ENV = typeof process !== 'undefined' ? process.env?.VEHICLE_PHYSICS : undefined;
/** The default per kind (switched to 'core' once that kind's whole test suite passes under it). */
export const VEHICLE_PHYSICS = {
  car: ENV === 'legacy' ? 'legacy' : 'core',
  boat: ENV === 'legacy' ? 'legacy' : 'core',
  heli: ENV === 'legacy' ? 'legacy' : 'core',
};
export const vehiclePhysics = (v, kind) => (v?.physics === 'legacy' || v?.physics === 'core' ? v.physics : VEHICLE_PHYSICS[kind]);
export const isCore = (v, kind) => vehiclePhysics(v, kind) === 'core';

export const VEHICLE_DT = 1 / 120;

/** What a car or a boat passes through (not solid for them). */
const SOFT = new Set(['grass', 'leaves', 'needles', 'twigs', 'snow', 'water']);
const SOFT_M_ = Uint8Array.from(MATERIALS, (m) => (SOFT.has(m.name) ? 1 : 0));
/** A soft bed a keel ploughs into (sim/groundContact.js boatGround's furrow and drag), not a hard stop for a boat. */
const BED = new Set([...SOFT, 'soil', 'beachSand', 'quarrySand', 'mud', 'ash', 'tephra']);
const BED_M = Uint8Array.from(MATERIALS, (m) => (BED.has(m.name) ? 1 : 0));

/** The owners whose voxels are vehicles' own (stamped where their bodies are). */
export function vehicleOwners(w) {
  const s = (w._vehicleOwners ??= new Set());
  s.clear();
  for (const c of w.cars ?? []) if (c.owner >= 0) s.add(c.owner);
  for (const f of w.floats ?? []) if (f.mb?.owner >= 0) s.add(f.mb.owner);
  return s;
}

export function vehicleCollider(w, { edges = true, maxCorners = 24000, beds = true } = {}) {
  const { nx, ny, nz } = w;
  const nxy = nx * ny;
  const owners = vehicleOwners(w);
  const SOFT_M = beds ? SOFT_M_ : BED_M;
  const C = new VoxelGridCollider({
    h: w.h, nx, ny, nz,
    solid: (x, y, z) => {
      const i = x + nx * y + nxy * z;
      const m = w.mat[i];
      return m !== 0 && !SOFT_M[m] && !(w.flags[i] & F_LIQUID) && !(owners.size && owners.has(w.owner[i]));
    },
    material: (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz ? MATERIALS.findIndex((m) => m.name === 'concrete') : w.mat[x + nx * y + nxy * z]),
  });
  C.maxCorners = maxCorners;
  // (the edges of the world: walls, as the old models had them)
  C.solid = function (x, y, z) {
    if (y < 0) return true;
    if (y >= ny) return false;
    if (x < 0 || z < 0 || x >= nx || z >= nz) return edges;
    return this.solidFn(x, y, z);
  };
  return C;
}

/** The PhysicsWorld of a sim World's vehicles of a kind ('car', 'boat', 'heli'). */
export function vehicleWorld(w, kind) {
  const all = (w._vehicleWorlds ??= {});
  if (all[kind]) {
    vehicleOwners(w); // (owners come and go: a car's voxels, a boat's)
    return all[kind];
  }
  // (boats: their hull's points against the voxels, the old model keeping them off the shore and in
  // the world; cars: their box's corners and the voxels' corners inside it, the world's edge a wall)
  const world = new PhysicsWorld({ collider: kind === 'boat' ? vehicleCollider(w, { edges: false, maxCorners: 0, beds: false }) : vehicleCollider(w), fixedDt: VEHICLE_DT, substeps: 1, maxSteps: 40, iterations: 10, seed: 11 });
  world.onImpact((e) => dispatchImpact(e));
  all[kind] = world;
  return world;
}

/** A world of its own on a heightfield ground(x, z) → y (a vehicle stepped with no voxel world). */
export function groundWorld(ground = () => 0) {
  const C = new VoxelGridCollider({ h: 1, nx: 0, ny: 0, nz: 0, solid: () => false, floor: false, ground: (x, z) => ground(x, z) });
  C.maxCorners = 0;
  const world = new PhysicsWorld({ collider: C, fixedDt: VEHICLE_DT, substeps: 1, maxSteps: 40, iterations: 10, seed: 11 });
  world.onImpact((e) => dispatchImpact(e));
  return world;
}

/** An impact to the vehicles it involves (body.userData.onImpact(e, self, other)). */
function dispatchImpact(e) {
  e.a?.userData?.onImpact?.(e, e.a, e.b);
  e.b?.userData?.onImpact?.(e, e.b, e.a);
}

/** Mass m, centre of mass com (shape frame) and inertia I (3×3 about it, shape axes) of a dynamic body. */
export function setMassProps(b, m, com, I) {
  const shapeAt = b.shapePos();
  b.mass = m;
  b.invMass = m > 0 ? 1 / m : 0;
  b.Ilocal = I.slice();
  b.invIlocal = m3inverse([], I);
  b.com = com.slice();
  b.shapeOffset = [-com[0], -com[1], -com[2]];
  b.pos = vadd([], shapeAt, m3mulv([0, 0, 0], b.R, com));
  b.prevPos = b.pos.slice();
  b.updateDerived();
  return b;
}

/** A box's inertia (full sizes lx, ly, lz) for mass m: a diagonal 3×3. */
export const boxInertia = (m, lx, ly, lz) => [(m * (ly * ly + lz * lz)) / 12, 0, 0, 0, (m * (lx * lx + lz * lz)) / 12, 0, 0, 0, (m * (lx * lx + ly * ly)) / 12];

/** The moment of inertia of body b about the world axis a (unit). */
export function inertiaAbout(b, a) {
  const R = b.R;
  const l = [R[0] * a[0] + R[3] * a[1] + R[6] * a[2], R[1] * a[0] + R[4] * a[1] + R[7] * a[2], R[2] * a[0] + R[5] * a[1] + R[8] * a[2]];
  const I = b.Ilocal;
  return l[0] * (I[0] * l[0] + I[1] * l[1] + I[2] * l[2]) + l[1] * (I[3] * l[0] + I[4] * l[1] + I[5] * l[2]) + l[2] * (I[6] * l[0] + I[7] * l[1] + I[8] * l[2]);
}

/** Yaw, pitch, roll of a row-major rotation R in the car/heli convention R = Ry(yaw)·Rz(pitch)·Rx(roll). */
export function yprOf(R, out = [0, 0, 0]) {
  const sp = Math.max(-1, Math.min(1, R[3]));
  out[1] = Math.asin(sp);
  if (Math.abs(sp) < 0.99999) {
    out[0] = Math.atan2(-R[6], R[0]);
    out[2] = Math.atan2(-R[5], R[4]);
  } else {
    out[0] = Math.atan2(R[2], R[8]);
    out[2] = 0;
  }
  return out;
}

/* ---------- pose tracking: a model that moves its vehicle itself, carried by a body ---------- */
/**
 * Set b's velocity and angular velocity so that in dt it gets to the pose (p: where its shape
 * frame's origin is to be, q: its orientation) the vehicle's own model moved it to. The world's
 * step then carries it there, unless something in the way (a contact, a joint) stops or turns it:
 * what the step changed beyond these targets is what the world did to it (trackedChange).
 */
export function trackPose(b, p, q, dt) {
  const R = mat3FromQuat([], q);
  const c = m3mulv([0, 0, 0], R, b.com);
  const v = [(p[0] + c[0] - b.pos[0]) / dt, (p[1] + c[1] - b.pos[1]) / dt, (p[2] + c[2] - b.pos[2]) / dt];
  const d = qmul([0, 0, 0, 1], q, qconj([0, 0, 0, 1], b.quat));
  if (d[3] < 0) for (let a = 0; a < 4; a++) d[a] = -d[a];
  const s = Math.hypot(d[0], d[1], d[2]);
  const ang = 2 * Math.atan2(s, d[3]);
  const w = s > 1e-12 ? [(d[0] / s) * (ang / dt), (d[1] / s) * (ang / dt), (d[2] / s) * (ang / dt)] : [0, 0, 0];
  b.vel = v.slice();
  b.angVel = w.slice();
  if (b.sleeping) b.wake();
  b.track = { v, w };
  return b.track;
}
/** What the world did to a tracked body in its step: { dv, dw } (world frame), beyond its targets. */
export function trackedChange(b) {
  const t = b.track;
  if (!t) return { dv: [0, 0, 0], dw: [0, 0, 0] };
  return { dv: [b.vel[0] - t.v[0], b.vel[1] - t.v[1], b.vel[2] - t.v[2]], dw: [b.angVel[0] - t.w[0], b.angVel[1] - t.w[1], b.angVel[2] - t.w[2]] };
}
/** Step a world by exactly dt: whole fixed steps of about VEHICLE_DT. */
export function stepExact(PW, dt) {
  if (dt <= 0) return;
  const n = Math.max(1, Math.ceil(dt / VEHICLE_DT - 1e-6));
  PW.fixedDt = dt / n;
  for (let k = 0; k < n; k++) PW.stepFixed();
  PW.alpha = 1;
}
