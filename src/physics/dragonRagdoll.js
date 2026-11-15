/**
 * The dragon going limp (ai/dragon.js: killed on the ground, or shot down in flight): its body as
 * a ragdoll (physics/ragdoll.js createRagdoll) in the simulation's rigid-body world, from the pose
 * it is in when it dies, moving as it was; the AI then reads its pose back from the ragdoll every
 * step (DragonRagdoll.apply: d.spine, d.rolls, d.head, the legs and the wings), so render/dragon.js
 * draws it and the hit zones follow it as they follow the living animal.
 *
 * dragonRagdollSpec(d) builds the dragon straight and level in its own rest frame (x its left, y
 * up, z towards the head; the head's base at the origin), from its body plan (ai/dragon.js PLAN,
 * bodyRadius) and size k:
 *
 *  - the spine in segments of capsules as thick as the body there: three for the neck, two for
 *    the trunk (chest, belly), four for the tail, and the head; chained by ball joints with swing
 *    cones and twist limits (a neck bends ~0.6 rad a joint, the trunk little, the tail more);
 *  - four legs, sprawled as it stands: the upper leg on a ball joint at the shoulder / hip, the
 *    lower on a hinge (the knee and elbow bend one way, under the body, and straighten);
 *  - two wings as hinged plates: the arm plate (arm and forearm) on a ball joint at the shoulder
 *    (it swings up, down and back along the flank), the hand plate on a hinge at the wrist that
 *    folds it back on the arm (folded limit) and not forward past straight;
 *  - masses: 3000 kg at 9 m (∝ k³; younger lighter, ancient heavier), shared by volume along the
 *    spine, with fixed shares for the head, legs and wings (a thin membrane: a few % each).
 *
 * Air drag on the wing plates (½ρ·Cd·A·v_n² against their normal) lets the wings trail up as it
 * falls; the body falls ballistically: a dragon killed in flight plummets and crashes.
 */
import { createRagdoll } from './ragdoll.js';
import { quatFromMat3, qrot, qmul, qaxis, qfromTo } from './math.js';
import { PLAN, bodyRadius } from '../ai/dragon.js';

export const DRAGON_RAGDOLL = { on: true, kg: 3000, wingCd: 1.3 };
const AGE_MASS = { young: 0.8, adult: 1, ancient: 1.15 };

const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const toward = (a, b, d) => add(a, norm(sub(b, a)), d);

/** The spine's segments by spine index (d.spine: head base 0 → tail tip), as [name, from, to]. */
export function dragonSegments(nn, iH, n) {
  const iM = Math.round((nn + iH) / 2);
  const t = (f) => iH + Math.round((n - 1 - iH) * f);
  return [
    ['neck0', 0, Math.round(nn / 3)], ['neck1', Math.round(nn / 3), Math.round((2 * nn) / 3)], ['neck2', Math.round((2 * nn) / 3), nn],
    ['chest', nn, iM], ['belly', iM, iH],
    ['tail0', iH, t(0.2)], ['tail1', t(0.2), t(0.42)], ['tail2', t(0.42), t(0.68)], ['tail3', t(0.68), n - 1],
  ];
}

/** The ragdoll spec of dragon d (its size k, its spine's layout: d.spine, d.iShoulder, d.iHip). */
export function dragonRagdollSpec(d) {
  const k = d.k ?? 1;
  const nn = d.iShoulder, iH = d.iHip, n = d.spine.length;
  const neck = PLAN.neck * k, ds = PLAN.ds * k;
  // the spine straight along −z, the head's base at the origin
  const spine = [];
  for (let i = 0; i < n; i++) spine.push([0, 0, i <= nn ? -(neck * i) / nn : -neck - (i - nn) * ds]);
  const R = (i) => bodyRadius(i * PLAN.ds).map((v) => v * k); // (as ai/dragon.js dragonZones)
  const rest = {};
  const parts = [];
  const segs = dragonSegments(nn, iH, n);
  // the spine's shares by volume
  let vol = 0;
  const vols = segs.map(([, a, b]) => {
    let v = 0;
    for (let i = a; i < b; i++) {
      const [rx, ry] = R(i + 0.5);
      v += Math.PI * rx * ry * len(sub(spine[i + 1], spine[i]));
    }
    vol += v;
    return v;
  });
  const SH = { head: 0.05, foreUp: 0.026, foreLo: 0.018, hindUp: 0.034, hindLo: 0.022, wingIn: 0.028, wingOut: 0.016 };
  const fixed = SH.head + 2 * (SH.foreUp + SH.foreLo + SH.hindUp + SH.hindLo + SH.wingIn + SH.wingOut);
  const parentOf = { neck0: 'neck1', neck1: 'neck2', neck2: 'chest', belly: 'chest', tail0: 'belly', tail1: 'tail0', tail2: 'tail1', tail3: 'tail2' };
  const cone = { neck0: 0.6, neck1: 0.6, neck2: 0.5, belly: 0.3, tail0: 0.45, tail1: 0.5, tail2: 0.55, tail3: 0.6 };
  segs.forEach(([name, a, b], s) => {
    const mid = Math.floor((a + b) / 2);
    const [rx, ry] = R(mid);
    const radius = Math.max(0.03 * k, Math.min(rx, ry) * 0.85);
    const L = len(sub(spine[b], spine[a]));
    const cut = Math.min(radius, 0.35 * L);
    rest[name] = spine[a];
    const p = { name, bone: name, a: toward(spine[a], spine[b], cut), b: toward(spine[b], spine[a], cut), radius, mass: Math.max(0.012, ((1 - fixed) * vols[s]) / vol) };
    // the joint to the next segment towards the chest: where the two meet
    if (parentOf[name]) {
      const at = name === 'belly' || name.startsWith('tail') ? spine[a] : spine[b];
      p.parent = parentOf[name];
      p.joint = { type: 'ball', at, axis: [0, 0, 1], cone: cone[name], twist: name.startsWith('tail') ? 0.3 : 0.25 };
    }
    parts.push(p);
  });
  // the head: from its base forward
  rest.head = [0, 0, 0];
  parts.push({ name: 'head', bone: 'head', a: [0, -0.02 * k, 0.15 * k], b: [0, -0.05 * k, PLAN.head * 0.85 * k], radius: 0.24 * k, mass: SH.head, parent: 'neck0', joint: { type: 'ball', at: [0, 0, 0], axis: [0, 0, 1], cone: 0.8, twist: 0.4 } });
  // the legs, sprawled
  const legs = {};
  for (const [front, side] of [[1, 1], [1, -1], [0, 1], [0, -1]]) {
    const key = (front ? 'fore' : 'hind') + (side > 0 ? 'L' : 'R');
    const i = front ? nn : iH;
    const [rx, ry] = R(i);
    const root = [side * rx * 0.78, -ry * 0.25, spine[i][2]];
    const a = (front ? 0.85 : 1.0) * k, b = (front ? 0.75 : 0.85) * k;
    const upDir = norm([side * 0.8, -0.6, 0]);
    const knee = add(root, upDir, a);
    const foot = add(knee, [0, -1, 0], b);
    const up = key + 'Up', lo = key + 'Lo';
    rest[up] = root;
    rest[lo] = knee;
    legs[key] = { up, lo, root, knee, foot };
    parts.push(
      { name: up, bone: up, a: toward(root, knee, 0.1 * k), b: toward(knee, root, 0.05 * k), radius: (front ? 0.14 : 0.18) * k, mass: front ? SH.foreUp : SH.hindUp, parent: front ? 'chest' : 'belly',
        joint: { type: 'ball', at: root, axis: upDir, cone: 1.4, twist: 0.6 } },
      { name: lo, bone: lo, a: toward(knee, foot, 0.06 * k), b: toward(foot, knee, 0.04 * k), radius: (front ? 0.09 : 0.11) * k, mass: front ? SH.foreLo : SH.hindLo, parent: up,
        joint: { type: 'hinge', at: knee, axis: [0, 0, side], lower: -1.6, upper: 1.0 } },
    );
  }
  // the wings, spread level: an arm plate and a hand plate
  const wings = {};
  const iw = Math.min(n - 1, nn + 1);
  const [wrx, wry] = R(iw);
  for (const side of [1, -1]) {
    const key = side > 0 ? 'wingL' : 'wingR';
    const W0 = [side * wrx * 0.5, wry * 0.72, spine[iw][2]];
    const sIn = 3.3 * k, cIn = 1.8 * k, sOut = 2.8 * k, cOut = 2.0 * k, t = 0.06 * k;
    const wrist = add(W0, [side * sIn, 0, 0]);
    const inn = key + 'In', out = key + 'Out';
    rest[inn] = W0;
    rest[out] = wrist;
    wings[key] = { inn, out, side, W0, wrist, tip: add(wrist, [side * sOut, 0, 0]) };
    parts.push(
      { name: inn, bone: inn, box: [sIn / 2, t, cIn / 2], center: add(W0, [(side * sIn) / 2, 0, -0.3 * cIn]), mass: SH.wingIn, parent: 'chest', wing: true, area: sIn * cIn,
        joint: { type: 'ball', at: W0, axis: [side, 0, 0], cone: 1.45, twist: 0.5 } },
      { name: out, bone: out, box: [sOut / 2, t, cOut / 2], center: add(wrist, [(side * sOut) / 2, 0, -0.3 * cOut]), mass: SH.wingOut, parent: inn, wing: true, area: sOut * cOut,
        joint: { type: 'hinge', at: wrist, axis: [0, side, 0], lower: -0.3, upper: 2.4 } },
    );
  }
  const mass = DRAGON_RAGDOLL.kg * k ** 3 * (AGE_MASS[d.age] ?? 1);
  return { mass, parts, rest, material: 'flesh', spine, segs, legs, wings, k, frictionMass: 80, frictionScale: 5 * k, angularDamping: 0.4, linearDamping: 0.02 };
}

/** The knee between root and end (lengths a, b) bent towards pole (as render/dragon.js ik). */
function ik(root, end, a, b, pole) {
  const d = sub(end, root);
  const L = Math.max(Math.abs(a - b) + 1e-3, Math.min(a + b - 1e-3, len(d)));
  const dn = norm(d);
  const ca = (a * a + L * L - b * b) / (2 * a * L);
  const sa = Math.sqrt(Math.max(0, 1 - ca * ca));
  const po = norm(sub(pole, dn.map((x) => x * dot(pole, dn))));
  return add(add(root, dn, a * ca), po, a * sa);
}

/** A frame (columns s, u, t: left, up, forward) → quaternion. */
function frameQuat(s, u, t) {
  return quatFromMat3([0, 0, 0, 1], [s[0], u[0], t[0], s[1], u[1], t[1], s[2], u[2], t[2]]);
}
/** The frame along direction t (forward) with up as near `up` as it can be. */
function frameAlong(t, up) {
  t = norm(t);
  let u = sub(up, t.map((x) => x * dot(up, t)));
  if (len(u) < 1e-4) u = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  u = norm(sub(u, t.map((x) => x * dot(u, t))));
  return { s: norm(cross(u, t)), u, t };
}

export class DragonRagdoll {
  /**
   * d: the dragon (posed: d.spine, d.head, d.rolls); physics: a PhysicsWorld; legs: where its legs
   * are now ({ foreL: [hip, knee, foot], ... }: ai/dragon.js dragonZones, the feet on the ground).
   */
  constructor(d, physics, { velocity = null, legs = null } = {}) {
    this.d = d;
    this.physics = physics;
    const spec = (this.spec = dragonRagdollSpec(d));
    const P = d.spine;
    const yawU = (i) => {
      // its up there (as ai/dragon.js spineFrame: rolled with the bank)
      const t = norm(sub(P[Math.max(0, i - 1)], P[Math.min(P.length - 1, i + 1)]));
      const F = frameAlong(t, [0, 1, 0]);
      const r = d.rolls?.[i] ?? 0;
      return norm(add(F.u.map((x) => x * Math.cos(r)), F.s, Math.sin(r)));
    };
    const frames = {};
    for (const [name, a, b] of spec.segs) {
      const F = frameAlong(sub(P[a], P[b]), yawU(a));
      frames[name] = { position: P[a], quaternion: frameQuat(F.s, F.u, F.t) };
    }
    {
      const F = frameAlong(d.head.dir, d.head.up);
      frames.head = { position: d.head.p, quaternion: frameQuat(F.s, F.u, F.t) };
    }
    // limbs: carried by their segment as in the rest pose; the wings swung back as far as they are folded
    const rel = (parent, bone, extraQ = null, pivot = null) => {
      const pf = frames[parent];
      const q = extraQ ? qmul([0, 0, 0, 1], pf.quaternion, extraQ) : pf.quaternion;
      const base = pivot ?? bone;
      const p0 = add(pf.position, qrot([0, 0, 0], pf.quaternion, sub(spec.rest[base], spec.rest[parent])));
      const p = pivot ? add(p0, qrot([0, 0, 0], q, sub(spec.rest[bone], spec.rest[pivot]))) : p0;
      return { position: p, quaternion: q };
    };
    for (const [key, L] of Object.entries(spec.legs)) {
      const par = L.up.startsWith('fore') ? 'chest' : 'belly';
      frames[L.up] = rel(par, L.up);
      frames[L.lo] = rel(par, L.lo);
      const now = legs?.[key];
      if (!now) continue;
      // as the leg is now: the thigh / upper arm along hip → knee, the shin along knee → foot
      // (turned the shortest way from how the body carries them in the rest pose)
      const q0 = frames[L.up].quaternion;
      const turn = (from, to) => qfromTo([0, 0, 0, 1], norm(qrot([0, 0, 0], q0, from)), norm(to));
      // (two-bone IK with the ragdoll's own lengths, the knee bent towards where it is)
      const kneeNow = ik(now[0], now[2], len(sub(L.knee, L.root)), len(sub(L.foot, L.knee)), sub(now[1], now[0]));
      const qa = qmul([0, 0, 0, 1], turn(sub(L.knee, L.root), sub(kneeNow, now[0])), q0);
      const knee = add(now[0], qrot([0, 0, 0], qa, sub(L.knee, L.root)));
      const qb = qmul([0, 0, 0, 1], turn(sub(L.foot, L.knee), sub(now[2], knee)), q0);
      frames[L.up] = { position: now[0], quaternion: qa };
      frames[L.lo] = { position: knee, quaternion: qb };
    }
    const fold = Math.max(0, Math.min(1, d.fold ?? 0));
    for (const W of Object.values(spec.wings)) {
      const qa = qaxis([0, 0, 0, 1], [0, 1, 0], W.side * 1.25 * fold);
      const qb = qaxis([0, 0, 0, 1], [0, 1, 0], W.side * (1.25 * fold + 1.4 * fold));
      frames[W.inn] = rel('chest', W.inn, qa);
      frames[W.out] = rel('chest', W.out, qb, W.inn);
      // (the hand: at the wrist where the swung arm puts it)
      frames[W.out].position = add(frames[W.inn].position, qrot([0, 0, 0], frames[W.inn].quaternion, sub(spec.rest[W.out], spec.rest[W.inn])));
    }
    this.rd = createRagdoll(physics, spec, { pose: (bone) => frames[bone], velocity });
    for (const b of Object.values(this.rd.bodies)) b.userData.dragon = d;
    // air drag on the wing plates, against their normal
    for (const p of spec.parts) {
      if (!p.wing) continue;
      const body = this.rd.bodies[p.name];
      const kA = 0.5 * 1.2 * DRAGON_RAGDOLL.wingCd * p.area;
      body.forceGenerators.push((b) => {
        const n = qrot([0, 0, 0], b.quat, [0, 1, 0]);
        const vn = dot(b.vel, n);
        const F = -kA * vn * Math.abs(vn);
        b.applyForce([n[0] * F, n[1] * F, n[2] * F]);
      });
    }
  }

  get bodies() {
    return this.rd.bodies;
  }
  get joints() {
    return this.rd.joints;
  }
  atRest() {
    return this.rd.atRest();
  }
  maxSpeed() {
    return this.rd.maxSpeed();
  }
  /** The chest's velocity (m/s). */
  velocity() {
    return this.rd.bodies.chest.vel.slice();
  }
  remove() {
    this.rd.remove();
  }

  /** The dragon's pose (d.spine, d.rolls, d.head, d.mouth, d.ragLegs, d.ragWing...) from the ragdoll now. */
  apply(d = this.d, alpha = 1) {
    const spec = this.spec;
    const B = this.rd.bones(alpha);
    const at = (bone, restPt) => {
      const F = B.get(bone);
      return add(F.position, qrot([0, 0, 0], F.quaternion, sub(restPt, spec.rest[bone])));
    };
    const n = spec.spine.length;
    const segOf = new Array(n);
    for (const [name, a, b] of spec.segs) for (let i = a; i <= b; i++) segOf[i] ??= name;
    const spine = [];
    for (let i = 0; i < n; i++) spine.push(at(segOf[i], spec.spine[i]));
    // its roll along the body: the segment's up against the unrolled frame (as the renderer builds it)
    const rolls = [];
    for (let i = 0; i < n; i++) {
      const t = norm(sub(spine[Math.max(0, i - 1)], spine[Math.min(n - 1, i + 1)]));
      const F = frameAlong(t, [0, 1, 0]);
      const ur = qrot([0, 0, 0], B.get(segOf[i]).quaternion, [0, 1, 0]);
      rolls.push(Math.atan2(dot(ur, F.s), dot(ur, F.u)));
    }
    const iS = d.iShoulder;
    d.spine = spine;
    d.rolls = rolls;
    const C = spine[iS];
    const tc = norm(sub(spine[iS], spine[Math.min(n - 1, iS + 2)]));
    d.chest = C;
    d.p = C.slice();
    d.forward = tc;
    if (Math.hypot(tc[0], tc[2]) > 0.2) d.yaw = Math.atan2(tc[0], tc[2]);
    const H = B.get('head');
    const dir = qrot([0, 0, 0], H.quaternion, [0, 0, 1]);
    const up = qrot([0, 0, 0], H.quaternion, [0, 1, 0]);
    d.head = { p: H.position, dir, up };
    d.headDir = dir;
    d.neckOff = sub(H.position, C);
    const k = d.k, L = PLAN.head * k;
    d.mouth = [0, 1, 2].map((c) => H.position[c] + dir[c] * L * 0.9 - up[c] * 0.12 * k);
    d.eye = [0, 1, 2].map((c) => H.position[c] + dir[c] * L * 0.35 + up[c] * 0.18 * k);
    // the legs as the ragdoll has them
    const legs = {};
    for (const [key, Lg] of Object.entries(spec.legs)) legs[key] = { root: at(Lg.up, Lg.root), knee: at(Lg.lo, Lg.knee), foot: at(Lg.lo, Lg.foot) };
    d.ragLegs = legs;
    // the wings: how far each is swung back (folded) and hangs (droop), for the wing pose
    const Cq = B.get('chest').quaternion;
    const cs = qrot([0, 0, 0], Cq, [1, 0, 0]), cu = qrot([0, 0, 0], Cq, [0, 1, 0]), ct = qrot([0, 0, 0], Cq, [0, 0, 1]);
    const wing = {};
    for (const [key, W] of Object.entries(spec.wings)) {
      const dirIn = qrot([0, 0, 0], B.get(W.inn).quaternion, [W.side, 0, 0]);
      const out = dot(dirIn, cs) * W.side, back = -dot(dirIn, ct), upc = dot(dirIn, cu);
      const sweep = Math.atan2(back, out);
      const hinge = this.rd.joints.find((j) => j.b === this.rd.bodies[W.out]);
      const hand = hinge?.angle?.() ?? 0;
      const fold = Math.max(0, Math.min(1, 0.7 * (sweep / 1.25) + 0.3 * (hand / 1.4)));
      const droop = Math.max(-1, Math.min(1.2, 0.12 - Math.atan2(upc, Math.hypot(out, back))));
      wing[key] = { fold, droop, root: at(W.inn, W.W0), wrist: at(W.out, W.wrist), tip: at(W.out, W.tip) };
    }
    d.ragWing = wing;
    return d;
  }
}
