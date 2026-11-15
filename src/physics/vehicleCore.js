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

/* ---------- one world for everything: the vehicles, the debris, the people near a car ---------- */

/** Collision groups (body.filter): who meets whom. */
export const GROUP = { DEFAULT: 1, DEBRIS: 1 << 1, CAR: 1 << 3, BOAT: 1 << 4, HELI: 1 << 5, PERSON: 1 << 6, SHIP: 1 << 7 };
const ALL = 0xffff;
/** Each kind's mask: people meet cars only; the carrier's hull meets boats, helicopters and debris (the deck is voxels). */
export const MASK = {
  car: ALL & ~GROUP.SHIP,
  boat: ALL & ~GROUP.PERSON,
  heli: ALL & ~GROUP.PERSON,
  person: GROUP.CAR,
  ship: GROUP.DEFAULT | GROUP.DEBRIS | GROUP.BOAT | GROUP.HELI,
};
/** A vehicle body's group and mask (and what it is: body.userData.vehicle). */
export function vehicleFilter(b, kind) {
  b.filter = { group: { car: GROUP.CAR, boat: GROUP.BOAT, heli: GROUP.HELI, person: GROUP.PERSON, ship: GROUP.SHIP }[kind] ?? GROUP.DEFAULT, mask: MASK[kind] ?? ALL };
  b.userData = { ...(b.userData ?? {}), vehicle: kind };
  // (a vehicle keeps a free box round it: the voxel grid is not scanned every substep, world.js)
  if (kind !== 'ship') b.worldCache = true;
  return b;
}
const kindOf = (b) => b.userData?.vehicle ?? null;

/** The grid as a kind of vehicle meets it (cars and helicopters; boats: their hull's points, the soft beds left to the keel's furrow). */
export function vehicleColliderOf(w, kind) {
  const all = (w._vehColliders ??= {});
  if (kind === 'boat') return (all.boat ??= vehicleCollider(w, { edges: false, maxCorners: 0, beds: false }));
  return (all.car ??= vehicleCollider(w));
}

/**
 * The one PhysicsWorld of a sim World: sim.rigid's when it has one (debris chunks, loose things,
 * fragments, ragdolls: physics/simPhysics.js), else one made here (and taken over by sim.rigid if it
 * is enabled later). Its own collider is the grid as debris meets it (the vehicles' stamped voxels
 * left out: their bodies stand for them); each vehicle body has its kind's (vehicleColliderOf).
 */
export function sharedWorld(w) {
  let PW = w._physicsWorld;
  if (!PW) {
    PW = new PhysicsWorld({ collider: debrisCollider(w), fixedDt: VEHICLE_DT, substeps: 1, maxSteps: 40, iterations: 10, seed: 11, timing: false });
    w._physicsWorld = PW;
  }
  if (!PW._vehicles) {
    PW._vehicles = true;
    PW.iterations = Math.max(PW.iterations, 10);
    PW.onImpact((e) => dispatchImpact(e));
  }
  vehicleOwners(w); // (owners come and go: a car's voxels, a boat's)
  return PW;
}
/** The grid as debris and loose things meet it: not liquid, not a vehicle's own stamped voxels. */
export function debrisCollider(w) {
  const owners = (w._vehicleOwners ??= new Set());
  return VoxelGridCollider.fromWorld(w, { ignore: (i) => owners.size > 0 && owners.has(w.owner[i]) });
}

/** The PhysicsWorld of a sim World's vehicles (all kinds share it: sharedWorld). */
export function vehicleWorld(w, kind) {
  void kind;
  return sharedWorld(w);
}

/** A world of its own on a heightfield ground(x, z) → y (vehicles stepped with no voxel world). */
export function groundWorld(ground = () => 0) {
  const C = new VoxelGridCollider({ h: 1, nx: 0, ny: 0, nz: 0, solid: () => false, floor: false, ground: (x, z) => ground(x, z) });
  C.maxCorners = 0;
  const world = new PhysicsWorld({ collider: C, fixedDt: VEHICLE_DT, substeps: 1, maxSteps: 40, iterations: 10, seed: 11, timing: false });
  world._vehicles = true;
  world.onImpact((e) => dispatchImpact(e));
  return world;
}

/** An impact to the vehicles it involves (body.userData.onImpact(e, self, other)). */
function dispatchImpact(e) {
  e.a?.userData?.onImpact?.(e, e.a, e.b);
  e.b?.userData?.onImpact?.(e, e.b, e.a);
}

/*
 * Stepping. In a simulation's frame (sim/simulation.js motionStep: beginVehicleFrame … endVehicleFrame)
 * each kind does its part before the world's step (the models move their vehicles, the drivers
 * drive) and hands what it does after (stepVehicles(w, PW, bodies, dt, post)); at the end of the
 * frame the world steps once for all of them together (and sim.rigid's debris), then the posts run.
 * Outside a frame (a test stepping the cars, the boats or a helicopter alone) the world steps at
 * once with only those bodies moving (stepAlone): the rest are held where they are, as obstacles.
 */
export function beginVehicleFrame(w, dt) {
  w._vehFrame = { dt, n: (w._vehFrameN = (w._vehFrameN ?? 0) + 1), posts: [], vehicles: false, rigid: null };
}
/** At the end of the frame: one step of the world for everything that took part, then each kind's post. */
export function endVehicleFrame(w) {
  const F = w._vehFrame;
  w._vehFrame = null;
  if (!F || (!F.vehicles && !F.rigid)) return;
  const PW = w._physicsWorld;
  if (PW) {
    const moving = (b) => (kindOf(b) ? b._frame === F.n : !!F.rigid);
    if (F.vehicles) stepAlone(PW, moving, F.dt, 'exact');
    else stepAlone(PW, moving, F.dt, 'accumulate');
  }
  for (const post of F.posts) post();
}
/** The kind's bodies stepped by dt (in the frame, or at once), then post(). */
export function stepVehicles(w, PW, bodies, dt, post) {
  const F = w?._vehFrame;
  if (F && PW === w._physicsWorld) {
    F.vehicles = true;
    for (const b of bodies) b._frame = F.n;
    F.posts.push(post);
    return;
  }
  const one = bodies.length === 1 ? bodies[0] : null;
  const set = one ? null : new Set(bodies);
  stepAlone(PW, one ? (b) => b === one : (b) => set.has(b), dt, PW.accumulate ? 'accumulate' : 'exact');
  post();
}
/** sim.rigid's step in the frame (its post: what it does with its chunks, loose things, fragments). → deferred */
export function deferRigid(w, post) {
  const F = w?._vehFrame;
  if (!F) return false;
  F.rigid = true;
  F.posts.push(post);
  return true;
}
/**
 * Step PW by dt with only the bodies moving(b) moving: the other dynamic bodies are held (no
 * velocity, not integrated: obstacles) for this step. mode 'exact': whole fixed steps of about its
 * nominal step (stepExact); 'accumulate': PW.step's fixed steps and remainder.
 */
export function stepAlone(PW, moving, dt, mode = 'exact') {
  const held = [];
  // a carried vehicle (a boat, a helicopter) with nothing in its way all the way to where its model
  // put it is moved there without the world's steps (it would arrive exactly anyway)
  const carried = [];
  for (const b of PW.bodies) if (b.track && b.trackTo && b.type === 'dynamic' && !b.sleeping && moving(b) && clearWay(PW, b, dt)) carried.push(b);
  for (const b of carried) b._carried = true;
  let live = false;
  for (const b of PW.bodies) {
    if (b.type !== 'dynamic') continue;
    if (moving(b) && !b._carried) {
      if (!b.sleeping) live = true;
      continue;
    }
    b.frozen = true;
    held.push(b, b.vel[0], b.vel[1], b.vel[2], b.angVel[0], b.angVel[1], b.angVel[2]);
    b.vel[0] = b.vel[1] = b.vel[2] = 0;
    b.angVel[0] = b.angVel[1] = b.angVel[2] = 0;
  }
  // (all it moves asleep, the rest held: nothing can happen; parked cars cost nothing)
  if (!live) PW.time += dt;
  else if (mode === 'exact') stepExact(PW, dt);
  else {
    // (in pieces of at most maxSteps fixed steps)
    let left = dt;
    const chunk = PW.fixedDt * (PW.maxSteps - 1);
    while (left > 1e-12) {
      const d = Math.min(left, chunk);
      PW.step(d);
      left -= d;
    }
  }
  for (let k = 0; k < held.length; k += 7) {
    const b = held[k];
    b.frozen = false;
    b.vel[0] = held[k + 1];
    b.vel[1] = held[k + 2];
    b.vel[2] = held[k + 3];
    b.angVel[0] = held[k + 4];
    b.angVel[1] = held[k + 5];
    b.angVel[2] = held[k + 6];
  }
  for (const b of carried) {
    b._carried = false;
    const T = b.trackTo;
    const p0 = b.pos.slice(), q0 = b.quat.slice();
    b.setPose(T.p, T.q);
    b.prevPos = p0;
    b.prevQuat = q0;
    b.vel = b.track.v.slice();
    b.angVel = b.track.w.slice();
    // (its box there: clearWay's, fattened as the world's step would)
    const m = 0.01 + Math.hypot(b.vel[0], b.vel[1], b.vel[2]) * (PW.fixedDt / PW.substeps) * 2;
    const tb = T.box;
    for (let a = 0; a < 3; a++) {
      b.aabb[a] = tb[a] - m;
      b.aabb[a + 3] = tb[a + 3] + m;
    }
    b.aabbDone = true;
  }
}

const AB = [0, 0, 0, 0, 0, 0], AB2 = [0, 0, 0, 0, 0, 0];
/** Whether nothing (the grid, a body it meets, a joint) is in a carried body's way from its pose to its target over dt. */
function clearWay(PW, b, dt) {
  for (const j of PW.joints) if (j.a === b || j.b === b) return false;
  const T = b.trackTo;
  // (where it is: its box from the last step; where it goes: its shape's box there)
  if (b.aabbDone) for (let a = 0; a < 6; a++) AB[a] = b.aabb[a];
  else b.shape.aabb(b.shapePos(), b.R, AB);
  b.shape.aabb(T.p, mat3FromQuat(T.R ??= [], T.q), AB2);
  T.box = AB2.slice();
  const pad = 0.05;
  const box = [Math.min(AB[0], AB2[0]) - pad, Math.min(AB[1], AB2[1]) - pad, Math.min(AB[2], AB2[2]) - pad, Math.max(AB[3], AB2[3]) + pad, Math.max(AB[4], AB2[4]) + pad, Math.max(AB[5], AB2[5]) + pad];
  const C = b.collider ?? PW.collider;
  if (b.collideWorld && C) {
    if (!C.emptyBox) return false;
    const F = b._free;
    const inF = F && F[7] === C && PW.time < F[6] && box[0] >= F[0] && box[1] >= F[1] && box[2] >= F[2] && box[3] <= F[3] && box[4] <= F[4] && box[5] <= F[5];
    if (!inF) {
      const e = Math.max(0.3, C.h * 2);
      const big = [box[0] - e, box[1] - e, box[2] - e, box[3] + e, box[4] + e, box[5] + e];
      if (!C.emptyBox(big)) return false;
      b._free = [...big, PW.time + 0.1, C];
    }
  }
  for (const o of PW.bodies) {
    if (o === b || !(o.filter.group & b.filter.mask) || !(b.filter.group & o.filter.mask)) continue;
    const ob = o.aabb;
    const e = o.type === 'static' ? 0 : Math.hypot(o.vel[0], o.vel[1], o.vel[2]) * dt + 0.05;
    if (ob[0] - e > box[3] || ob[3] + e < box[0] || ob[1] - e > box[4] || ob[4] + e < box[1] || ob[2] - e > box[5] || ob[5] + e < box[2]) continue;
    return false;
  }
  return true;
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
  b.trackTo = { p: p.slice(), q: q.slice(), R: R };
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
  // (its nominal fixed step: 1/120 s for a world of the vehicles', sim.rigid's 1/60 s in two substeps)
  const base = (PW.nominalDt ??= PW.fixedDt);
  const n = Math.max(1, Math.ceil(dt / base - 1e-6));
  PW.fixedDt = dt / n;
  for (let k = 0; k < n; k++) PW.stepFixed();
  PW.fixedDt = base;
  PW.alpha = 1;
}

/* ---------- a blast ---------- */
/**
 * A blast of energy E (J) at center: every vehicle body within radius pushed as debris is
 * (sim.rigid's explosion: v0 = min(80, 8 + √(E/2000)) m/s falling off as (1 − d/R)², heavy things
 * less: an impulse v0·k·√(2m)), away from the blast at the point of its box nearest it (so a blast
 * under one side of a car rolls it over). A car takes it on its body (and its damage: (Δv / 5)²);
 * a carried one (a boat, a flying helicopter) in its model's velocities (vehicle.onBlast(dv, dw)),
 * the helicopter's parts being hit by HeliAI.blast as before. → the bodies pushed
 */
export function blastVehicles(w, center, E, radius) {
  const PW = w?._physicsWorld;
  if (!PW || !(E > 0)) return [];
  const v0 = Math.min(80, 8 + Math.sqrt(E / 2000));
  const out = [];
  for (const b of PW.bodies) {
    const kind = kindOf(b);
    if (!kind || kind === 'ship' || kind === 'person' || b.type !== 'dynamic') continue;
    const bb = b.aabb;
    const q = [Math.max(bb[0], Math.min(bb[3], center[0])), Math.max(bb[1], Math.min(bb[4], center[1])), Math.max(bb[2], Math.min(bb[5], center[2]))];
    const d = Math.hypot(q[0] - center[0], q[1] - center[1], q[2] - center[2]);
    if (d > radius) continue;
    const k = (1 - d / radius) ** 2;
    const J = v0 * k * Math.sqrt(2 * b.mass);
    // (the push: square to the face of its box that the blast is off; from inside its box, out
    // through its middle)
    let n = d > 0.05 ? [q[0] - center[0], q[1] - center[1], q[2] - center[2]] : [b.pos[0] - center[0], b.pos[1] - center[1], b.pos[2] - center[2]];
    const l = Math.hypot(n[0], n[1], n[2]);
    n = l > 1e-6 ? [n[0] / l, n[1] / l, n[2] / l] : [0, 1, 0];
    const imp = [n[0] * J, n[1] * J, n[2] * J];
    const dv = [imp[0] / b.mass, imp[1] / b.mass, imp[2] / b.mass];
    const r = [q[0] - b.pos[0], q[1] - b.pos[1], q[2] - b.pos[2]];
    const tq = [r[1] * imp[2] - r[2] * imp[1], r[2] * imp[0] - r[0] * imp[2], r[0] * imp[1] - r[1] * imp[0]];
    const dw = m3mulv([0, 0, 0], b.invIworld, tq);
    const onBlast = b.userData?.onBlast;
    if (onBlast) onBlast(dv, dw, { center, E, point: q, impulse: J });
    if (!b.track || kind === 'car') b.applyImpulse(imp, q);
    out.push(b);
  }
  return out;
}
