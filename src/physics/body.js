/**
 * A rigid body: a shape with mass, placed in the world by the pose of its centre of mass
 * (position + orientation quaternion), moving with linear and angular velocity.
 *
 *   type      'dynamic' (moved by forces and contacts), 'static' (never moves), 'kinematic'
 *             (moved by its velocity / setKinematicTarget, pushes dynamic bodies, is not pushed)
 *   shape     a shape from shapes.js, in its own frame; the body's frame is that frame moved to
 *             the centre of mass (shapeOffset = −com: where the shape frame sits in the body frame)
 *   mass      from density × volume, or set (the inertia tensor scaled with it); a voxel set
 *             carries its voxels' own masses
 *   material  a voxel material (id or name, sim/materials.js): friction and restitution come
 *             from it (physics/materials.js) unless set
 *   damping   linearDamping, angularDamping (1/s)
 *   sleeping  a body at rest for a while sleeps (with its island): no integration, no contacts
 *             among sleepers; anything moving that touches it wakes it
 *   ccd       continuous collision (a fast small body: a fragment) — on by default when it moves
 *             more than half its inner radius in a step
 *   filter    { group, mask }: bodies collide when (a.group & b.mask) && (b.group & a.mask)
 *
 * pos / quat / vel / angVel are plain arrays; read the pose for drawing with interpolated(alpha)
 * (the world's alpha between the last two fixed steps).
 */
import { mat3FromQuat, m3rotate, m3inverse, m3mulv, qnorm, vadd, qslerp, vlerp, qrot } from './math.js';
import { surfaceOf } from './materials.js';

let BODY_ID = 0;

export class Body {
  constructor(o = {}) {
    this.id = o.id ?? ++BODY_ID;
    this.type = o.type ?? 'dynamic';
    this.shape = o.shape;
    this.material = o.material ?? null;
    const mp = this.shape.massProps(o.density ?? 1000);
    let I = mp.I;
    let mass = mp.mass;
    if (o.mass !== undefined && mp.mass > 0) {
      const s = o.mass / mp.mass;
      mass = o.mass;
      I = I.map((v) => v * s);
    }
    this.volume = mp.volume;
    this.com = mp.com;
    this.shapeOffset = [-mp.com[0], -mp.com[1], -mp.com[2]];
    const dyn = this.type === 'dynamic';
    this.mass = dyn ? mass : Infinity;
    this.invMass = dyn && mass > 0 ? 1 / mass : 0;
    this.Ilocal = I;
    this.invIlocal = dyn ? m3inverse([], I) : [0, 0, 0, 0, 0, 0, 0, 0, 0];
    if (o.lockRotation) this.invIlocal = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    // the pose: given for the shape frame (position) like a scene object; kept for the centre of mass
    this.quat = qnorm([], o.quaternion ?? [0, 0, 0, 1]);
    this.R = mat3FromQuat([], this.quat);
    const p = o.position ?? [0, 0, 0];
    this.pos = vadd([], p, m3mulv([], this.R, mp.com));
    this.vel = (o.velocity ?? [0, 0, 0]).slice();
    this.angVel = (o.angularVelocity ?? [0, 0, 0]).slice();
    this.force = [0, 0, 0];
    this.torque = [0, 0, 0];
    this.invIworld = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    this.linearDamping = o.linearDamping ?? 0.02;
    this.angularDamping = o.angularDamping ?? 0.05;
    this.gravityScale = o.gravityScale ?? 1;
    const surf = surfaceOf(this.material);
    this.friction = o.friction ?? surf.friction;
    this.restitution = o.restitution ?? surf.restitution;
    this.filter = { group: o.group ?? 1, mask: o.mask ?? 0xffff };
    this.ccd = o.ccd ?? 'auto';
    this.sleeping = false;
    this.canSleep = o.canSleep ?? true;
    this.sleepTime = 0;
    this.island = -1;
    this.userData = o.userData ?? null;
    this.collideWorld = o.collideWorld ?? true;
    // the grid it meets (null: the world's collider; a vehicle has its own view of the voxels)
    this.collider = o.collider ?? null;
    // a body out of this step (physics/vehicleCore.js steps one kind of vehicle on its own: the
    // others held where they are, as obstacles)
    this.frozen = false;
    // (worldCache: keep a free box round it, physics/world.js worldFreeOf; worldFree: none this substep)
    this.worldCache = o.worldCache ?? false;
    this.worldFree = false;
    this._free = null;
    this.prevPos = this.pos.slice();
    this.prevQuat = this.quat.slice();
    this.aabb = [0, 0, 0, 0, 0, 0];
    this.forceGenerators = [];
    this.world = null;
    this.rollingResistance = o.rollingResistance ?? 0.08;
    // (solver and bookkeeping fields, all set here so every body has the same shape for the JIT)
    this.im = 0;
    this.iIw = this.invIworld;
    this.uF = [0, 0, 0];
    this.uT = [0, 0, 0];
    this.ccdFrom = [0, 0, 0];
    this.ccdHits = 0;
    this.margin = 0.01;
    this.aabbDone = false;
    this.sleepGroup = null;
    this.kTarget = null;
    this.voxelMaterial = null;
    this.restOrigin = null;
    this.submerged = 0;
    this.buoyant = true;
    this._buoy = null;
    this.updateDerived();
  }
  get isDynamic() {
    return this.type === 'dynamic';
  }
  /** Rotation matrix, world inverse inertia (after the orientation changed). */
  updateDerived() {
    mat3FromQuat(this.R, this.quat);
    if (this.invMass > 0) m3rotate(this.invIworld, this.R, this.invIlocal);
  }
  /** Where the shape's frame is in the world. */
  shapePos(out = [0, 0, 0]) {
    m3mulv(out, this.R, this.shapeOffset);
    return vadd(out, out, this.pos);
  }
  /** Body-frame point (relative to the centre of mass) → world. */
  toWorld(local, out = [0, 0, 0]) {
    m3mulv(out, this.R, local);
    return vadd(out, out, this.pos);
  }
  /** Shape-frame point → world. */
  shapeToWorld(local, out = [0, 0, 0]) {
    const l = [local[0] + this.shapeOffset[0], local[1] + this.shapeOffset[1], local[2] + this.shapeOffset[2]];
    return this.toWorld(l, out);
  }
  /** World point → body frame (relative to the centre of mass). */
  toLocal(world, out = [0, 0, 0]) {
    const d = [world[0] - this.pos[0], world[1] - this.pos[1], world[2] - this.pos[2]];
    const R = this.R;
    out[0] = R[0] * d[0] + R[3] * d[1] + R[6] * d[2];
    out[1] = R[1] * d[0] + R[4] * d[1] + R[7] * d[2];
    out[2] = R[2] * d[0] + R[5] * d[1] + R[8] * d[2];
    return out;
  }
  /** Velocity of the world point p moving with the body. */
  velocityAt(p, out = [0, 0, 0]) {
    const r = [p[0] - this.pos[0], p[1] - this.pos[1], p[2] - this.pos[2]];
    const w = this.angVel;
    out[0] = this.vel[0] + w[1] * r[2] - w[2] * r[1];
    out[1] = this.vel[1] + w[2] * r[0] - w[0] * r[2];
    out[2] = this.vel[2] + w[0] * r[1] - w[1] * r[0];
    return out;
  }
  /** A force (N) at world point p (default the centre of mass), for the next step. */
  applyForce(f, p = null) {
    this.force[0] += f[0];
    this.force[1] += f[1];
    this.force[2] += f[2];
    if (p) {
      const r = [p[0] - this.pos[0], p[1] - this.pos[1], p[2] - this.pos[2]];
      this.torque[0] += r[1] * f[2] - r[2] * f[1];
      this.torque[1] += r[2] * f[0] - r[0] * f[2];
      this.torque[2] += r[0] * f[1] - r[1] * f[0];
    }
  }
  applyTorque(t) {
    this.torque[0] += t[0];
    this.torque[1] += t[1];
    this.torque[2] += t[2];
  }
  /** An impulse (N·s) at world point p (default the centre of mass): the velocity changes now. */
  applyImpulse(J, p = null) {
    if (!this.invMass) return;
    this.wake();
    for (let a = 0; a < 3; a++) this.vel[a] += J[a] * this.invMass;
    if (p) {
      const r = [p[0] - this.pos[0], p[1] - this.pos[1], p[2] - this.pos[2]];
      const t = [r[1] * J[2] - r[2] * J[1], r[2] * J[0] - r[0] * J[2], r[0] * J[1] - r[1] * J[0]];
      const dw = m3mulv([0, 0, 0], this.invIworld, t);
      for (let a = 0; a < 3; a++) this.angVel[a] += dw[a];
    }
  }
  wake() {
    if (this.sleeping) this.world?.wakeBody(this);
    this.sleepTime = 0;
  }
  /** Teleport (the shape frame to position p). */
  setPose(position, quaternion = this.quat) {
    qnorm(this.quat, quaternion);
    this.updateDerived();
    const c = m3mulv([0, 0, 0], this.R, this.com);
    this.pos = vadd([], position, c);
    this.prevPos = this.pos.slice();
    this.prevQuat = this.quat.slice();
    this.aabbDone = false;
    this.wake();
  }
  /** A kinematic body moved to a pose by the next step (its velocity set to get there). */
  setKinematicTarget(position, quaternion, dt) {
    this.kTarget = { position: position.slice(), quaternion: quaternion.slice(), dt };
  }
  /** The pose drawn at alpha (0: the step before, 1: now) of the shape frame: { position, quaternion }. */
  interpolated(alpha = 1, out = { position: [0, 0, 0], quaternion: [0, 0, 0, 1] }) {
    vlerp(out.position, this.prevPos, this.pos, alpha);
    qslerp(out.quaternion, this.prevQuat, this.quat, alpha);
    const off = qrot([0, 0, 0], out.quaternion, this.shapeOffset);
    vadd(out.position, out.position, off);
    return out;
  }
  /** Kinetic energy (J). */
  kineticEnergy() {
    if (!this.invMass) return 0;
    const v2 = this.vel[0] ** 2 + this.vel[1] ** 2 + this.vel[2] ** 2;
    const wl = m3mulv([0, 0, 0], this.Ilocal, this.toLocalDir(this.angVel));
    const wloc = this.toLocalDir(this.angVel);
    return 0.5 * this.mass * v2 + 0.5 * (wl[0] * wloc[0] + wl[1] * wloc[1] + wl[2] * wloc[2]);
  }
  toLocalDir(v) {
    const R = this.R;
    return [R[0] * v[0] + R[3] * v[1] + R[6] * v[2], R[1] * v[0] + R[4] * v[1] + R[7] * v[2], R[2] * v[0] + R[5] * v[1] + R[8] * v[2]];
  }
}
