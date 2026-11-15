/**
 * Ragdolls: a character's skeleton as capsule bodies held by joints with limits.
 *
 * A spec lists the parts, each on one bone of the rig: the capsule (two points and a radius, in the
 * rig's rest space), its share of the mass, the part it hangs from and the joint to it (ball with a
 * swing cone and twist limit: shoulders, hips, spine, neck; hinge with angle limits: elbows, knees).
 * The ragdoll is built in the rest pose (so every joint's limits are measured from the rest pose,
 * whatever pose the character is in when it goes limp), then each body is moved to its bone's pose
 * at that moment (pose(bone) → { position, quaternion } of the bone frame in the world) with its
 * velocity (velocity(bone) → [vx, vy, vz]).
 *
 *   const rd = createRagdoll(world, soldierRagdollSpec(REST), { pose, velocity, mass: 80 })
 *   rd.bones(alpha) → Map(bone → { position, quaternion })   where each bone frame is now (drawing)
 *   rd.applyImpulse(bone, J, point)      a shot, a blast
 *   rd.atRest()                          every part asleep
 *   rd.remove()
 *
 * Its bodies are in collision group RAGDOLL and do not collide with each other (nor with another
 * ragdoll); joint friction makes it limp rather than floppy.
 * soldierRagdollSpec(rest) maps the operator rig (operator/rig.js BONES: rest positions by bone
 * name, plain [x, y, z] arrays): pelvis, torso, head, upper and fore arms, thighs and shins.
 */
import { Capsule, Box } from './shapes.js';
import { BallJoint, HingeJoint } from './joints.js';
import { vsub, vnorm, vcross, vlen, vdot, vadd, vscale } from './math.js';

export const RAGDOLL_GROUP = 1 << 4;

const sub = (a, b) => vsub([0, 0, 0], a, b);
const dirOf = (a, b) => vnorm([0, 0, 0], sub(b, a));
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** a moved d towards b. */
const toward = (a, b, d) => vadd([0, 0, 0], a, vscale([0, 0, 0], dirOf(a, b), d));

/** The soldier (operator rig) ragdoll from the rig's rest bone positions ({ bone: [x, y, z] }). */
export function soldierRagdollSpec(R) {
  const parts = [
    { name: 'pelvis', bone: 'hips', a: [R.thighR[0] - 0.02, R.hips[1] - 0.02, 0], b: [R.thighL[0] + 0.02, R.hips[1] - 0.02, 0], radius: 0.12, mass: 0.15 },
    { name: 'torso', bone: 'spine', a: [0, R.spine[1] + 0.04, 0], b: [0, R.neck[1] - 0.08, 0], radius: 0.15, mass: 0.31, parent: 'pelvis',
      joint: { type: 'ball', at: R.spine, axis: [0, 1, 0], cone: 0.55, twist: 0.45 } },
    { name: 'head', bone: 'neck', a: [R.neck[0], R.neck[1] + 0.07, R.neck[2]], b: [R.head[0], R.head[1] + 0.06, R.head[2] + 0.01], radius: 0.1, mass: 0.08, parent: 'torso',
      joint: { type: 'ball', at: R.neck, axis: [0, 1, 0], cone: 0.7, twist: 0.9 } },
  ];
  for (const s of ['R', 'L']) {
    const sh = R['upperArm' + s], el = R['foreArm' + s], wr = R['hand' + s];
    const hand = toward(wr, el, -0.08); // (the hand beyond the wrist: on the forearm)
    const thigh = R['thigh' + s], knee = R['shin' + s], ankle = R['foot' + s];
    parts.push(
      { name: 'upperArm' + s, bone: 'upperArm' + s, a: toward(sh, el, 0.05), b: toward(el, sh, 0.04), radius: 0.05, mass: 0.03, parent: 'torso',
        joint: { type: 'ball', at: sh, axis: dirOf(sh, el), cone: 1.5, twist: 1.0 } },
      { name: 'foreArm' + s, bone: 'foreArm' + s, a: toward(el, wr, 0.04), b: hand, radius: 0.045, mass: 0.025, parent: 'upperArm' + s,
        joint: { type: 'hinge', at: el, bend: [sh, el, wr], max: 2.5 } },
      { name: 'thigh' + s, bone: 'thigh' + s, a: toward(thigh, knee, 0.07), b: toward(knee, thigh, 0.05), radius: 0.075, mass: 0.1, parent: 'pelvis',
        joint: { type: 'ball', at: thigh, axis: dirOf(thigh, knee), cone: 1.2, twist: 0.5 } },
      { name: 'shin' + s, bone: 'shin' + s, a: toward(knee, ankle, 0.05), b: [ankle[0], ankle[1] - 0.02, ankle[2] + 0.06], radius: 0.055, mass: 0.06, parent: 'thigh' + s,
        joint: { type: 'hinge', at: knee, bend: [thigh, knee, ankle], max: 2.4 } },
    );
  }
  return { mass: 80, parts, material: 'flesh', rest: R };
}

/** Build a ragdoll in `world` from a spec (see the top). */
export function createRagdoll(world, spec, { pose = null, velocity = null, mass = spec.mass ?? 80, rest = spec.rest ?? null, material = spec.material ?? 'flesh', friction = 0.03 } = {}) {
  const total = spec.parts.reduce((s, p) => s + p.mass, 0);
  const massRef = spec.frictionMass ?? 80;
  const bodies = {};
  const boneOf = {};
  const restPos = (p) => rest?.[p.bone] ?? null;
  // 1. the bodies in the rest pose: each body's frame is its bone's (at the bone's rest position)
  for (const p of spec.parts) {
    // (a plate, a wing: a box about its centre; else a capsule between a and b)
    const origin = p.box ? p.center : restPos(p) ?? lerp(p.a, p.b, 0.5);
    const shape = p.box ? new Box(...p.box) : new Capsule(p.radius, sub(p.a, origin), sub(p.b, origin));
    const b = world.createBody({
      shape, position: origin, mass: (mass * p.mass) / total, material, group: RAGDOLL_GROUP, mask: 0xffff & ~RAGDOLL_GROUP,
      linearDamping: spec.linearDamping ?? 0.05, angularDamping: spec.angularDamping ?? 0.6, userData: { ragdoll: true, part: p.name, bone: p.bone },
    });
    b.restOrigin = origin;
    bodies[p.name] = b;
    boneOf[p.name] = p.bone;
  }
  // 2. the joints, measured from the rest pose
  const joints = [];
  for (const p of spec.parts) {
    if (!p.parent) continue;
    const a = bodies[p.parent], b = bodies[p.name], J = p.joint;
    const fr = friction * (mass / massRef) * 40 * (spec.frictionScale ?? 1);
    let j;
    if (J.type === 'hinge' && J.axis) {
      // (an explicit axis and limits, measured from the rest pose)
      j = new HingeJoint(a, b, J.at, J.axis, { lower: J.lower ?? null, upper: J.upper ?? null, friction: fr * 0.5 });
    } else if (J.type === 'hinge') {
      const [s, e, w] = J.bend;
      const u = dirOf(s, e), f = dirOf(e, w);
      let ax = vcross([0, 0, 0], u, f);
      const bend = Math.acos(Math.max(-1, Math.min(1, vdot(u, f))));
      ax = vlen(ax) > 1e-4 ? vnorm(ax, ax) : [1, 0, 0];
      j = new HingeJoint(a, b, J.at, ax, { lower: -bend + 0.03, upper: J.max - bend, friction: fr * 0.5 });
    } else j = new BallJoint(a, b, J.at, { axis: J.axis, cone: J.cone, twist: J.twist, friction: fr });
    world.addJoint(j);
    joints.push(j);
  }
  // 3. into the pose they are in now, moving as they were
  for (const p of spec.parts) {
    const b = bodies[p.name];
    if (pose) {
      const P = pose(p.bone);
      // (the body's frame is the bone's frame shifted to the rest origin we built it at)
      const off = sub(b.restOrigin, rest?.[p.bone] ?? b.restOrigin);
      const q = P.quaternion;
      const o = rotate(q, off);
      b.setPose(vadd([0, 0, 0], P.position, o), q);
    }
    if (velocity) {
      const v = typeof velocity === 'function' ? velocity(p.bone) : velocity;
      if (v) b.vel = v.slice();
    }
  }
  return new Ragdoll(world, spec, bodies, joints, boneOf, rest);
}

function rotate(q, v) {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}

export class Ragdoll {
  constructor(world, spec, bodies, joints, boneOf, rest) {
    this.world = world;
    this.spec = spec;
    this.bodies = bodies;
    this.joints = joints;
    this.boneOf = boneOf;
    this.rest = rest;
  }
  /** Each part's bone frame in the world now (alpha: between the last two fixed steps). */
  bones(alpha = this.world.alpha) {
    const out = new Map();
    for (const [name, b] of Object.entries(this.bodies)) {
      const ip = b.interpolated(alpha);
      // the shape frame sits at the rest origin; the bone frame at the bone's rest position
      const bone = this.boneOf[name];
      const off = this.rest?.[bone] ? sub(this.rest[bone], b.restOrigin) : [0, 0, 0];
      out.set(bone, { position: vadd([0, 0, 0], ip.position, rotate(ip.quaternion, off)), quaternion: ip.quaternion });
    }
    return out;
  }
  partOfBone(bone) {
    for (const [name, b] of Object.entries(this.boneOf)) if (b === bone) return this.bodies[name];
    return null;
  }
  applyImpulse(bone, J, point = null) {
    const b = this.partOfBone(bone) ?? this.bodies[bone];
    if (b) b.applyImpulse(J, point);
  }
  atRest() {
    return Object.values(this.bodies).every((b) => b.sleeping);
  }
  /** Highest speed of any part (m/s). */
  maxSpeed() {
    let v = 0;
    for (const b of Object.values(this.bodies)) v = Math.max(v, vlen(b.vel));
    return v;
  }
  remove() {
    for (const j of this.joints) this.world.removeJoint(j);
    for (const b of Object.values(this.bodies)) this.world.removeBody(b);
  }
}
