/**
 * Vehicle adapters on the rigid-body core: what drives a vehicle is a set of forces on one chassis
 * body (a force generator on it), so cars, boats and the helicopter can all run on PhysicsWorld
 * and meet everything else (debris, crates, ragdolls, the voxel world) through its contacts.
 *
 *   RaycastVehicle(world, chassis, { wheels, maxDriveForce, maxBrakeForce })
 *       wheels: [{ pos (chassis shape frame: where the strut is mounted), radius, rest (suspension
 *       length at rest), stiffness (N/m), damping (N·s/m), friction (μ of the tyre), steer,
 *       drive, brake }]. Each substep each wheel casts a ray down the chassis' −y from its mount
 *       (rest + radius long); where it touches: a spring–damper force up the chassis, and the
 *       tyre's grip in the ground plane — lateral −μN·clamp(v_lat/0.4) (a slip curve), drive
 *       (throttle × maxDriveForce shared by the driven wheels), brake — limited to the friction
 *       circle μN, applied at the contact point (and the opposite on a body it stands on).
 *       Chassis frame: +z forward, +y up, +x to the left. controls = { throttle −1..1, brake 0..1,
 *       steer (rad, + to the left) }. wheel state: contact, compression, load, spin, rotation.
 *   RotorForce(body, { hub, axis, maxThrust, torqueRatio, maxYawTorque })
 *       a main rotor: thrust collective × maxThrust along the rotor axis tilted by the cyclic
 *       (pitch about the body's x, roll about its z), at the hub; its reaction torque about the
 *       axis (torqueRatio × thrust) and the tail rotor's yaw torque (yaw −1..1 × maxYawTorque).
 *       controls = { collective 0..1, pitch, roll, yaw }.
 *   HullBuoyancy(body, { cells, level, density, drag })
 *       a hull's buoyancy from its own cells (shape-frame points with a volume each: the
 *       displacement cells sim/buoyancy.js builds from a boat's voxels) through forces.buoyancy.
 *
 * Migration of the existing vehicles (cars: sim/carPhysics.js, boats: sim/buoyancy.js, the
 * helicopter: ai/helicopter.js) onto these is planned for after their current work lands; see the
 * README section "Rigid-body physics" → "Vehicle adapters".
 */
import { vdot, vcross, vnorm, vscale, m3mulv, qaxis, qrot, clamp } from './math.js';
import { buoyancy } from './forces.js';

export class RaycastVehicle {
  constructor(world, chassis, { wheels, maxDriveForce = 4000, maxBrakeForce = 9000, rollingResistance = 0.012 } = {}) {
    this.world = world;
    this.chassis = chassis;
    this.maxDriveForce = maxDriveForce;
    this.maxBrakeForce = maxBrakeForce;
    this.rollingResistance = rollingResistance;
    this.controls = { throttle: 0, brake: 0, steer: 0 };
    this.wheels = wheels.map((w) => ({
      pos: w.pos.slice(), radius: w.radius ?? 0.35, rest: w.rest ?? 0.3, stiffness: w.stiffness ?? 30000, damping: w.damping ?? 2500,
      friction: w.friction ?? 1.0, steer: !!w.steer, drive: !!w.drive, brake: w.brake ?? true,
      contact: false, compression: 0, load: 0, spin: 0, rotation: 0, hit: null,
    }));
    this.gen = (b, dt) => this.apply(dt);
    chassis.forceGenerators.push(this.gen);
    chassis.canSleep = false;
  }
  remove() {
    const i = this.chassis.forceGenerators.indexOf(this.gen);
    if (i >= 0) this.chassis.forceGenerators.splice(i, 1);
  }
  /** Speed along the chassis' forward axis (m/s). */
  get speed() {
    const f = m3mulv([0, 0, 0], this.chassis.R, [0, 0, 1]);
    return vdot(this.chassis.vel, f);
  }
  apply(dt) {
    const C = this.chassis, W = this.world;
    const up = m3mulv([0, 0, 0], C.R, [0, 1, 0]);
    const fwd0 = m3mulv([0, 0, 0], C.R, [0, 0, 1]);
    const down = vscale([0, 0, 0], up, -1);
    const n = this.wheels.length;
    const nDrive = this.wheels.filter((w) => w.drive).length || 1;
    const share = C.mass / n;
    const ctl = this.controls;
    for (const w of this.wheels) {
      const mount = C.shapeToWorld(w.pos);
      const len = w.rest + w.radius;
      const hit = W.raycast(mount, down, len, { ignore: C });
      w.hit = hit;
      if (!hit) {
        w.contact = false;
        w.compression = 0;
        w.load = 0;
        w.rotation += w.spin * dt;
        continue;
      }
      w.contact = true;
      w.compression = len - hit.t;
      const vRel = C.velocityAt(hit.point);
      if (hit.body) {
        const vb = hit.body.velocityAt(hit.point);
        for (let a = 0; a < 3; a++) vRel[a] -= vb[a];
      }
      const vUp = vdot(vRel, up);
      const Fs = Math.max(0, w.stiffness * w.compression - w.damping * vUp);
      const nrm = hit.normal;
      // the tyre's axes in the ground plane
      let f = fwd0;
      if (w.steer && ctl.steer) f = qrot([0, 0, 0], qaxis([0, 0, 0, 1], up, ctl.steer), fwd0);
      const fwd = vnorm([0, 0, 0], [f[0] - nrm[0] * vdot(f, nrm), f[1] - nrm[1] * vdot(f, nrm), f[2] - nrm[2] * vdot(f, nrm)]);
      const side = vcross([0, 0, 0], nrm, fwd);
      const vLong = vdot(vRel, fwd), vLat = vdot(vRel, side);
      const N = Fs * Math.max(0, vdot(up, nrm));
      w.load = N;
      const muN = w.friction * N;
      // lateral grip: a slip curve, and never more than stops the sideways slide this substep
      let Flat = -muN * clamp(vLat / 0.4, -1, 1);
      Flat = clamp(Flat, -(share * Math.abs(vLat)) / dt, (share * Math.abs(vLat)) / dt);
      let Flong = w.drive ? (clamp(ctl.throttle, -1, 1) * this.maxDriveForce) / nDrive : 0;
      if (w.brake && ctl.brake > 0) Flong -= Math.sign(vLong) * Math.min((ctl.brake * this.maxBrakeForce) / n, (share * Math.abs(vLong)) / dt);
      Flong -= Math.sign(vLong) * Math.min(this.rollingResistance * N, (share * Math.abs(vLong)) / dt);
      // the friction circle
      const Ft = Math.hypot(Flat, Flong);
      if (Ft > muN && Ft > 0) {
        Flat *= muN / Ft;
        Flong *= muN / Ft;
      }
      const F = [up[0] * Fs + fwd[0] * Flong + side[0] * Flat, up[1] * Fs + fwd[1] * Flong + side[1] * Flat, up[2] * Fs + fwd[2] * Flong + side[2] * Flat];
      C.applyForce(F, hit.point);
      if (hit.body && hit.body.isDynamic) hit.body.applyForce(vscale([0, 0, 0], F, -1), hit.point);
      w.spin = vLong / w.radius;
      w.rotation += w.spin * dt;
    }
  }
}

export class RotorForce {
  constructor(body, { hub = [0, 1, 0], axis = [0, 1, 0], maxThrust = 30000, torqueRatio = 0.04, maxYawTorque = 3000 } = {}) {
    this.body = body;
    this.hub = hub.slice();
    this.axis = vnorm([0, 0, 0], axis);
    this.maxThrust = maxThrust;
    this.torqueRatio = torqueRatio;
    this.maxYawTorque = maxYawTorque;
    this.controls = { collective: 0, pitch: 0, roll: 0, yaw: 0 };
    this.gen = () => this.apply();
    body.forceGenerators.push(this.gen);
    body.canSleep = false;
  }
  remove() {
    const i = this.body.forceGenerators.indexOf(this.gen);
    if (i >= 0) this.body.forceGenerators.splice(i, 1);
  }
  apply() {
    const B = this.body, c = this.controls;
    // the disc tilted by the cyclic (in the body frame), then into the world
    let a = qrot([0, 0, 0], qaxis([0, 0, 0, 1], [1, 0, 0], c.pitch), this.axis);
    a = qrot([0, 0, 0], qaxis([0, 0, 0, 1], [0, 0, 1], c.roll), a);
    const aw = m3mulv([0, 0, 0], B.R, a);
    const T = clamp(c.collective, 0, 1) * this.maxThrust;
    B.applyForce(vscale([0, 0, 0], aw, T), B.shapeToWorld(this.hub));
    const yawAxis = m3mulv([0, 0, 0], B.R, this.axis);
    const tq = -T * this.torqueRatio + clamp(c.yaw, -1, 1) * this.maxYawTorque;
    B.applyTorque(vscale([0, 0, 0], yawAxis, tq));
  }
  /** The collective that holds the body's weight (hover), for its mass and gravity g. */
  hoverCollective(g = 9.81) {
    return (this.body.mass * g) / this.maxThrust;
  }
}

export class HullBuoyancy {
  constructor(body, { cells, level, density = 1025, drag = 1.5 } = {}) {
    this.body = body;
    // (its own displacement cells in place of the shape's samples)
    body._buoy = { shape: body.shape, pts: cells.map((c) => ({ p: [c.p[0] + body.shapeOffset[0], c.p[1] + body.shapeOffset[1], c.p[2] + body.shapeOffset[2]], vol: c.vol, half: Math.cbrt(c.vol) / 2 })) };
    this.gen = buoyancy({ level, density, drag });
    body.forceGenerators.push(this.gen);
  }
  remove() {
    const i = this.body.forceGenerators.indexOf(this.gen);
    if (i >= 0) this.body.forceGenerators.splice(i, 1);
  }
  get submerged() {
    return this.body.submerged ?? 0;
  }
}


