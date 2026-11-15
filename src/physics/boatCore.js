/**
 * Boats on the rigid-body core (the 'core' physics of sim/boats.js and sim/buoyancy.js; f.physics =
 * 'legacy' keeps the old model alone). One boat = one hull body in a PhysicsWorld
 * (physics/vehicleCore.js: a sim World's boats share one; boats stepped outside a simulation share
 * the world of the list they are stepped in, stepBoatsCore, or have one of their own).
 *
 *  - The hull: the convex hull of its lines (keel, sheer and half-breadths at stations along it:
 *    the envelope the displacement cells fill), in the hull frame (x to the bow, y up, z to
 *    starboard, the origin on the keel amidships); its mass the hull's, its load's and the water
 *    aboard's (buoyancy.js updateMass: M + ρ·water), its centre of mass G, its inertia the old
 *    model's (roll, pitch, yaw: Iroll, Ipitch, the surge/sway model's I_z).
 *  - What floats and drives it stays buoyancy.js and boats.js: Archimedes over its displacement
 *    cells on the waves, the water aboard (holes, the gunwale: Torricelli and the weir), the added
 *    mass and the tuned damping, drift, wind, oars, outboard, sail, paddles. Each frame they move it
 *    as before; the body is then given the velocities that take it there (vehicleCore.trackPose)
 *    and the world steps: unless something is in the way it gets there exactly (the old results
 *    are kept); a contact (another boat, a shore, a carrier's hull, a pier) or the mooring line
 *    changes that, and that change is handed back to the model's velocities (trackedChange: added
 *    to its surge, sway, heave, yaw, roll and pitch rates), so it bounces off, is held, swings.
 *  - Mooring: the painter is a rope joint (DistanceJoint, max only) from its stem to the ring:
 *    slack inside its length, taut it holds (f.mooring.taut, .tension from the joint's impulse);
 *    the old elastic line is off for a core boat (f.coreMooring).
 *  - Grounding: the old model's (its keel on the bottom: env.bottom, groundContact.boatGround's
 *    furrow and drag), and the hull's contacts with the voxels as for anything else; a boat built
 *    touching something (f.jammed: a pier) does not collide with the world until it is clear.
 *
 *   beginBoat(f, PW)    before its model's step: its body (made the first time) in PW, what was
 *                       written to it from outside (placed, set moving) taken over
 *   trackBoat(f, dt)    after its model's step: the body set to get to where the model put it
 *   endBoat(f)          after the world's step: the model's pose and velocities from the body
 *   stepBoatsCore(fs, dt, env, stepOne)   boats outside a simulation, one world for the list
 */
import { ConvexHull } from './shapes.js';
import { Body } from './body.js';
import { DistanceJoint } from './joints.js';
import { PhysicsWorld } from './world.js';
import { quatFromMat3 } from './math.js';
import { setMassProps, trackPose, trackedChange, stepExact, vehicleOwners, VEHICLE_DT } from './vehicleCore.js';
import { framePose, toWorld } from '../sim/buoyancy.js';

const SEEN = ['X', 'Y', 'Z', 'yaw', 'roll', 'pitch', 'vx', 'vy', 'vz', 'wy', 'wr', 'wp'];

/** The convex hull of a hull's lines (hull frame). */
export function hullShape(hull) {
  const pts = [];
  const n = 9;
  for (let i = 0; i <= n; i++) {
    const x = hull.x0 + ((hull.x1 - hull.x0) * i) / n;
    const xi = Math.max(hull.x0 + 1e-3, Math.min(hull.x1 - 1e-3, x));
    const k = hull.keel(xi), s = hull.sheer(xi);
    for (const t of [0, 0.35, 1]) {
      const y = k + (s - k) * t;
      const hb = hull.half(xi, Math.min(s - 1e-4, Math.max(k + 1e-4, y)));
      pts.push([x, y, hb], [x, y, -hb]);
    }
  }
  return new ConvexHull(pts);
}

/** Its mass, centre of mass and inertia from the model now (with the water aboard). */
function setBoatMass(f) {
  const K = f.core, b = f.body;
  const m = b.M + b.rho * (b.water ?? 0);
  const L = b.hull.L;
  const Iz = m * (0.27 * L) ** 2 * 1.3;
  const key = `${m.toFixed(1)}|${b.G.map((v) => v.toFixed(3)).join(',')}`;
  if (K.massKey === key) return;
  K.massKey = key;
  const s = m / Math.max(1e-6, b.M);
  setMassProps(K.body, m, b.G, [b.Iroll * s, 0, 0, 0, Iz, 0, 0, 0, b.Ipitch * s]);
}

/** Its hull body (made on first use) in world PW. */
function hullBodyOf(f, PW) {
  const K = (f.core ??= { body: null, world: null, joint: null, seen: null, massKey: '' });
  if (!K.body) {
    const b = f.body;
    const pose = framePose(b);
    const B = new Body({ shape: (b.hull._shape ??= hullShape(b.hull)), position: pose.p, quaternion: quatFromMat3([0, 0, 0, 1], pose.R), material: f.spec?.material === 'aluminium' ? 'aluminium' : 'wood', linearDamping: 0, angularDamping: 0, gravityScale: 0, mass: Math.max(1, b.M) });
    B.buoyant = false;
    B.canSleep = false;
    B.restitution = 0.2;
    B.rollingResistance = 0;
    B.userData = { boat: f, onImpact: (e) => (f.core.impacts ??= []).push(e) };
    K.body = B;
    setBoatMass(f);
  }
  if (K.body.world !== PW) {
    K.body.world?.removeBody(K.body);
    PW.addBody(K.body);
    if (K.joint) PW.addJoint(K.joint);
  }
  K.world = PW;
  return K.body;
}

/** The painter as a rope joint (made, changed or let go as f.mooring is). */
function mooringJoint(f) {
  const K = f.core, PW = K.world, m = f.mooring;
  f.coreMooring = true;
  if (K.joint && (!m || K.joint.mooring !== m || K.joint.pw !== PW)) {
    K.joint.pw?.removeJoint(K.joint);
    K.joint = null;
  }
  if (!m || K.joint) return;
  const stem = toWorld(f.body, m.at);
  const dy = m.anchor[1] - stem[1];
  const J = new DistanceJoint(K.body, null, stem, m.anchor, { rope: true, max: Math.hypot(m.length, dy), collideConnected: true });
  J.mooring = m;
  J.pw = PW;
  PW.addJoint(J);
  K.joint = J;
}

/** Before its model's step. */
export function beginBoat(f, PW, w = null) {
  // (its own voxels are not in its way: the world's vehicle owners again once it has them)
  if (w && f.mb?.owner >= 0 && !w._vehicleOwners?.has(f.mb.owner)) vehicleOwners(w);
  const B = hullBodyOf(f, PW);
  const b = f.body, K = f.core;
  // written from outside since the last step (placed there, set going): the body takes it
  if (K.seen) {
    let pose = false;
    for (let k = 0; k < 6; k++) if (Math.abs((b[SEEN[k]] ?? 0) - K.seen[k]) > 1e-9) pose = true;
    if (pose) {
      const P = framePose(b);
      B.setPose(P.p, quatFromMat3([0, 0, 0, 1], P.R));
    }
  }
  setBoatMass(f);
  mooringJoint(f);
  K.impacts = [];
  return B;
}

/** After its model's step: the body set to get to where the model has put it in dt. */
export function trackBoat(f, dt) {
  const B = f.core?.body;
  if (!B) return;
  const P = framePose(f.body);
  // (built touching something: no world contacts until it is clear: sim/buoyancy.js moveBoat)
  B.collideWorld = f.jammed === false;
  trackPose(B, P.p, quatFromMat3([0, 0, 0, 1], P.R), dt);
  f.core.v1 = [f.body.vx ?? 0, f.body.vy ?? 0, f.body.vz ?? 0];
}

/** After the world's step: the model's pose and velocities from the body (what the world added, added). */
export function endBoat(f, dt) {
  const K = f.core, B = K?.body;
  if (!B?.track) return;
  const b = f.body;
  const { dv, dw } = trackedChange(B);
  // the pose: the reference point is G, the body's centre of mass
  b.X = B.pos[0];
  b.Y = B.pos[1];
  b.Z = B.pos[2];
  const R = B.R;
  b.roll = Math.asin(Math.max(-1, Math.min(1, -R[5])));
  b.pitch = Math.atan2(R[3], R[4]);
  const yaw = Math.atan2(R[2], R[8]);
  b.yaw = b.yaw + Math.atan2(Math.sin(yaw - b.yaw), Math.cos(yaw - b.yaw));
  // the velocities: the model's own, and what the world did on top
  b.vx = (b.vx ?? 0) + dv[0];
  b.vy = (b.vy ?? 0) + dv[1];
  b.vz = (b.vz ?? 0) + dv[2];
  b.wy = (b.wy ?? 0) + dw[1];
  b.wr = (b.wr ?? 0) + (dw[0] * R[0] + dw[1] * R[3] + dw[2] * R[6]);
  b.wp = (b.wp ?? 0) + (dw[0] * R[2] + dw[1] * R[5] + dw[2] * R[8]);
  b.pose = framePose(b);
  // the painter's pull
  const m = f.mooring;
  if (m && K.joint) {
    // (what the line took out of its velocity towards the ring over the step: its pull)
    const stem = toWorld(b, m.at);
    const d = [m.anchor[0] - stem[0], m.anchor[1] - stem[1], m.anchor[2] - stem[2]];
    const dl = Math.hypot(d[0], d[1], d[2]) || 1;
    const pull = (B.mass * (dv[0] * d[0] + dv[1] * d[1] + dv[2] * d[2])) / dl / Math.max(1e-6, dt);
    m.taut = K.joint.length > K.joint.max - 0.03;
    m.tension = m.taut ? Math.max(0, pull) : 0;
  }
  K.seen = SEEN.map((k) => b[k] ?? 0);
  // what it knocked against (another boat, a pier, a rock): heard (audio/boatSound.js 'bump')
  K.bumped = K.impacts ?? [];
  for (const e of K.bumped) {
    if (e.speed < 0.3) continue;
    const other = e.a?.userData?.boat === f ? e.b : e.a;
    f.sfx ??= [];
    f.sfxN = (f.sfxN ?? 0) + 1;
    f.sfx.push({ kind: 'bump', v: e.speed, t: b.t, n: f.sfxN, material: other?.userData?.boat ? 'wood' : e.materials.find((m) => m && m !== 'wood' && m !== 'unknown') ?? 'stone' });
    if (f.sfx.length > 24) f.sfx.splice(0, f.sfx.length - 24);
  }
}

/** A world for boats stepped outside a simulation (no voxels: open water). */
export function openWater() {
  const PW = new PhysicsWorld({ collider: null, fixedDt: VEHICLE_DT, substeps: 1, maxSteps: 40, iterations: 10, seed: 13 });
  PW.onImpact((e) => {
    e.a?.userData?.onImpact?.(e);
    e.b?.userData?.onImpact?.(e);
  });
  return PW;
}

/**
 * Boats outside a simulation, one world for them all: stepOne(f, dt, env) is each one's model step
 * (sim/boats.js stepBoat's legacy part); then the world (their contacts, their lines); then each
 * takes what the world did.
 */
export function stepBoatsCore(fs, dt, env, stepOne) {
  let PW = fs.find((f) => f.core?.world?.openWater)?.core.world;
  if (!PW) {
    PW = openWater();
    PW.openWater = true;
  }
  for (const f of fs) beginBoat(f, PW);
  for (const f of fs) {
    stepOne(f, dt, typeof env === 'function' ? env(f) : env);
    trackBoat(f, dt);
  }
  stepExact(PW, dt);
  for (const f of fs) endBoat(f, dt);
}
