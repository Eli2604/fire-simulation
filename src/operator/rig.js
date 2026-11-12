/**
 * The operator rig: the sculpt (sculpt.js) skinned to a 21-bone skeleton, a library of
 * animation clips baked from key poses, and OperatorFigure, one animated soldier.
 *
 *  - Separate objects: the person (skinned), the rifle, its magazine, the helmet and the
 *    backpack are meshes on their own bones. Any of them can be detached into a rigid body
 *    (PhysicsWorld) and put back.
 *  - The hands hold the rifle by inverse kinematics: every key pose places the rifle first and
 *    solves both arms to its grips, so a hand can let go (running arm swing, reload, throwing,
 *    signals, swimming) and come back.
 *  - Armed and unarmed: without a rifle every clip has an unarmed version (arms free), and the
 *    clips that need the rifle (shoot, reload) fall back to what an unarmed man would do.
 *  - Weapons: every soldier carries a compact carbine across his back as a secondary; when the
 *    rifle is gone he reaches over his shoulder, draws it and fights on. A flame trooper
 *    (loadout 'torch') has a flame gun and a fuel tank instead of the rifle: it fires only
 *    standing (the 'flame' clip); crouched or prone he just holds it.
 *  - Drone: a trooper with a backpack slips it off, kneels, sets it down and opens it, lifts a
 *    quadcopter out, places it ahead of him, pulls his FPV goggles down and takes the controller;
 *    the drone spins up, climbs and circles over its target (droneTarget) while he stays put.
 *  - Hit zones: cylinders on the bones (head, torso, pelvis, arms, legs) with a damage
 *    multiplier each, for picking; they can be shown.
 */
import * as THREE from 'three';
import { SC } from './sculpt.js';
import { makeOperatorMaterial } from './shader.js';

const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const UP = new THREE.Vector3(0, 1, 0);
export const P = SC.P;
const TAU = Math.PI * 2;
const { sin, cos } = Math;
const mx0 = (v) => Math.max(0, v);
export const sm01 = (t) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};

/* ================= skeleton ================= */
export const MGRAB = V3(P.rw([0.452, -0.175, 0]));
const FG0 = V3(P.rw([0.56, -0.046, 0]));
export const BONES = [
  ['root', null, [0, 0, 0]], ['hips', 'root', [0, 0.97, 0]], ['spine', 'hips', [0, 1.1, 0]], ['chest', 'spine', [0, 1.28, 0]],
  ['neck', 'chest', [0, 1.47, 0.005]], ['head', 'neck', [0, 1.6, 0.01]],
  ['upperArmR', 'chest', P.SR], ['foreArmR', 'upperArmR', SC.ARMS[0].E], ['handR', 'foreArmR', P.WR],
  ['upperArmL', 'chest', P.SL], ['foreArmL', 'upperArmL', SC.ARMS[1].E], ['handL', 'foreArmL', P.WL],
  ['weapon', 'chest', P.B], ['mag', 'weapon', MGRAB.toArray()],
  ['bag', 'root', [0, 1.28, 0]], ['drone', 'root', [0, 1.25, -0.25]],
  ['thighR', 'hips', [-0.1, 0.95, 0]], ['shinR', 'thighR', [-0.115, 0.52, 0.045]], ['footR', 'shinR', [-0.125, 0.1, 0]],
  ['thighL', 'hips', [0.1, 0.95, 0]], ['shinL', 'thighL', [0.115, 0.52, 0.045]], ['footL', 'shinL', [0.125, 0.1, 0]],
];
export const BI = {};
export const REST = {};
BONES.forEach((b, i) => {
  BI[b[0]] = i;
  REST[b[0]] = V3(b[2]);
});

function segParam(p, a, b) {
  const ab = b.clone().sub(a);
  const t = p.clone().sub(a).dot(ab) / ab.lengthSq();
  const tc = Math.max(0, Math.min(1, t));
  return { t, d: p.distanceTo(a.clone().addScaledVector(ab, tc)) };
}
function trunk(y) {
  if (y < 0.98) return [['hips', 1]];
  if (y < 1.12) {
    const t = sm01((y - 0.98) / 0.14);
    return [['hips', 1 - t], ['spine', t]];
  }
  if (y < 1.28) {
    const t = sm01((y - 1.12) / 0.16);
    return [['spine', 1 - t], ['chest', t]];
  }
  return [['chest', 1]];
}
/** Skin weights for the person's parts (by which sculpted group a vertex belongs to). */
function skinWeights(name, pos, lb) {
  const n = pos.length / 3;
  const SI = new Uint16Array(n * 4);
  const SW = new Float32Array(n * 4);
  const p = new THREE.Vector3();
  const A = [0, 1].map((i) => ({ S: V3(SC.ARMS[i].S), E: V3(SC.ARMS[i].E), C: V3(SC.ARMS[i].C) }));
  const legs = [-1, 1].map((sx) => ({ hip: V3([sx * 0.1, 0.95, 0]), knee: V3([sx * 0.115, 0.52, 0.045]), ank: V3([sx * 0.125, 0.12, 0.005]) }));
  for (let i = 0; i < n; i++) {
    p.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    let w;
    if (name === 'hands') w = [[lb[i] === 4 ? 'handR' : 'handL', 1]];
    else if (name === 'face') {
      const t = sm01((1.555 - p.y) / 0.05);
      w = [['head', 1 - t], ['neck', t]];
    } else if (name === 'legs') {
      const L = legs[p.x < 0 ? 0 : 1];
      const side = p.x < 0 ? 'R' : 'L';
      const u = segParam(p, L.hip, L.knee);
      const v = segParam(p, L.knee, L.ank);
      const a = v.d < u.d ? 1 + v.t : u.t;
      const wH = 1 - sm01((a + 0.04) / 0.26);
      const wS = sm01((a - 0.9) / 0.2);
      const wT = Math.max(0, 1 - wH - wS);
      const wF = sm01((0.16 - p.y) / 0.07);
      w = [['hips', wH * (1 - wF)], ['thigh' + side, wT * (1 - wF)], ['shin' + side, wS * (1 - wF)], ['foot' + side, wF]];
    } else {
      const l = lb[i];
      if (l === 3 || l === 4) {
        const a = A[l - 3];
        const side = l === 3 ? 'R' : 'L';
        const u = segParam(p, a.S, a.E);
        const v = segParam(p, a.E, a.C);
        const t = v.d < u.d ? 1 + v.t : u.t;
        const wC = 1 - sm01((t + 0.05) / 0.3);
        const wF = sm01((t - 0.88) / 0.24);
        const wU = Math.max(0, 1 - wC - wF);
        w = [...trunk(p.y).map(([b, x]) => [b, x * wC]), ['upperArm' + side, wU], ['foreArm' + side, wF]];
      } else if (l === 5) {
        const t = sm01((p.y - 1.47) / 0.06) * 0.7;
        w = [['chest', 1 - t], ['neck', t]];
      } else w = trunk(p.y);
    }
    w = w.filter((x) => x[1] > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const s = w.reduce((a, x) => a + x[1], 0) || 1;
    for (let k = 0; k < 4; k++) {
      SI[i * 4 + k] = w[k] ? BI[w[k][0]] : 0;
      SW[i * 4 + k] = w[k] ? w[k][1] / s : 0;
    }
  }
  return { SI, SW };
}
function toFigure(F, d) {
  if (!F) return;
  const { pos, nrm } = d;
  const n = pos.length / 3;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2], a = nrm[i * 3], b = nrm[i * 3 + 1], c = nrm[i * 3 + 2];
    for (let k = 0; k < 3; k++) {
      pos[i * 3 + k] = F.o[k] + F.x[k] * x + F.y[k] * y + F.z[k] * z;
      nrm[i * 3 + k] = F.x[k] * a + F.y[k] * b + F.z[k] * c;
    }
  }
}
function geometryOf(d, off, skin) {
  if (off) for (let i = 0; i < d.pos.length; i += 3) for (let k = 0; k < 3; k++) d.pos[i + k] -= off.getComponent(k);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(d.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(d.nrm, 3));
  g.setAttribute('aId', new THREE.BufferAttribute(d.id, 1));
  g.setAttribute('aUV', new THREE.BufferAttribute(d.uv, 2));
  g.setAttribute('aAO', new THREE.BufferAttribute(d.ao, 1));
  g.setIndex(new THREE.BufferAttribute(d.idx, 1));
  if (skin) {
    const { SI, SW } = skinWeights(skin, d.pos, d.lb);
    g.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
  }
  g.computeBoundingSphere();
  return g;
}

/* ================= pose solver ================= */
const Z3 = () => [0, 0, 0];
const PACK_C = [0, 1.22, -0.245]; // the backpack's centre when worn
export function pose0() {
  return {
    hipsPos: Z3(), hips: Z3(), spine: Z3(), chest: Z3(), neck: Z3(), head: Z3(),
    thighR: Z3(), shinR: Z3(), footR: Z3(), thighL: Z3(), shinL: Z3(), footL: Z3(),
    aim: 0, recoil: 0, wOff: Z3(), wRot: Z3(), cw: 0, cButt: [-0.13, 1.33, 0.05], cDir: [0, 1, 0], cUp: [0, 0, -1], sling: 0,
    lT: Z3(), lG: 1, lH: 1, lPole: Z3(), rT: Z3(), rG: 1, rH: 1, rPole: Z3(), lMag: 0, lMagOff: Z3(), mag: 0, magFall: -1, magHide: 0,
    // hand targets in figure space (blended in by lW / rW), the backpack (its centre) and the drone
    lTW: Z3(), rTW: Z3(), lW: 0, rW: 0, bagP: PACK_C.slice(), bagR: Z3(), droneP: [0, 1.25, -0.25], droneR: Z3(),
  };
}
function lerpPose(a, b, t) {
  const o = {};
  for (const k in a) o[k] = Array.isArray(a[k]) ? a[k].map((v, i) => v + (b[k][i] - v) * t) : a[k] + (b[k] - a[k]) * t;
  return o;
}
function keyed(K, t) {
  let i = 0;
  while (i < K.length - 2 && t > K[i + 1][0]) i++;
  const a = K[i], b = K[i + 1];
  return lerpPose(a[1], b[1], sm01((t - a[0]) / (b[0] - a[0])));
}
const R0q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(V3(P.R.x), V3(P.R.y), V3(P.R.z)));
function frameQuat(dir, upHint) {
  const x = dir.clone().normalize();
  const y = upHint.clone().sub(x.clone().multiplyScalar(x.dot(upHint))).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)).multiply(R0q.clone().invert());
}
const AIM_YAW = 0.8;
const AIM_BUTT = new THREE.Vector3(-0.15, 1.43, 0.1);
const SL_DIR = new THREE.Vector3(-0.45, 0.89, 0).normalize();
const SL_UP = new THREE.Vector3(0.89, 0.45, 0);
const SL_BUTT = new THREE.Vector3(0.2, 0.97, -0.375);
const POLE = { R: [V3([-1, -0.45, -0.35]), V3([-1, -0.7, -0.1])], L: [V3([1, -0.5, -0.25]), V3([0.5, -1, 0])] };
const REL = [0, -0.14, 0.06];
function ikV(S, H, a, b, pole) {
  const dir = H.clone().sub(S);
  const d = Math.min(dir.length(), a + b - 1e-3);
  dir.normalize();
  const c = (a * a + d * d - b * b) / (2 * a * d), s = Math.sqrt(Math.max(0, 1 - c * c));
  const pp = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
  return S.clone().addScaledVector(dir, a * c).addScaledVector(pp, a * s);
}
const eq = (e) => new THREE.Quaternion().setFromEuler(new THREE.Euler(e[0], e[1], e[2], 'XYZ'));
/** A pose (joint angles, rifle placement, hand targets) to bone rotations and positions. */
export function solve(ps) {
  const out = {};
  for (const k of ['hips', 'spine', 'chest', 'neck', 'head', 'thighR', 'shinR', 'footR', 'thighL', 'shinL', 'footL']) out[k] = eq(ps[k]);
  out.hipsPos = REST.hips.clone().add(V3(ps.hipsPos));
  const B = REST.weapon;
  const q = eq(ps.wRot);
  const b = B.clone().add(V3(ps.wOff));
  if (ps.aim > 0) {
    const dir = new THREE.Vector3(Math.sin(AIM_YAW), -0.03, Math.cos(AIM_YAW)).normalize();
    const side = new THREE.Vector3().crossVectors(dir, UP).normalize();
    const qA = new THREE.Quaternion().setFromAxisAngle(side, 0.075 * ps.recoil).multiply(frameQuat(dir, UP));
    const bA = AIM_BUTT.clone().add(V3(ps.wOff)).addScaledVector(dir, -0.028 * ps.recoil);
    q.slerp(qA, ps.aim);
    b.lerp(bA, ps.aim);
  }
  if (ps.cw > 0) {
    q.slerp(frameQuat(V3(ps.cDir), V3(ps.cUp)), ps.cw);
    b.lerp(V3(ps.cButt).add(V3(ps.wOff)), ps.cw);
  }
  if (ps.sling > 0) {
    q.slerp(frameQuat(SL_DIR, SL_UP), ps.sling);
    b.lerp(SL_BUTT, ps.sling);
  }
  out.weapon = q;
  out.weaponPos = b.clone().sub(REST.chest);
  const toW = (v) => b.clone().add(v.clone().sub(B).applyQuaternion(q));
  const FGo = FG0.clone().sub(REST.handL);
  const magGrab = toW(MGRAB).sub(FGo.clone().applyQuaternion(q));
  // where the chest is (figure space), to turn figure-space hand targets into chest space
  const M = new THREE.Matrix4().compose(out.hipsPos ?? REST.hips.clone().add(V3(ps.hipsPos)), out.hips, new THREE.Vector3(1, 1, 1))
    .multiply(new THREE.Matrix4().compose(REST.spine.clone().sub(REST.hips), out.spine, new THREE.Vector3(1, 1, 1)))
    .multiply(new THREE.Matrix4().compose(REST.chest.clone().sub(REST.spine), out.chest, new THREE.Vector3(1, 1, 1)));
  const Mi = M.clone().invert();
  const toChest = (v) => v.clone().applyMatrix4(Mi).add(REST.chest);
  const hand = {};
  for (const s of ['R', 'L']) {
    const l = s.toLowerCase();
    const S = REST['upperArm' + s], E0 = REST['foreArm' + s], W0 = REST['hand' + s];
    const Wg = toW(W0);
    const T = V3(ps[l + 'T']);
    if (s === 'L' && ps.lMag > 0) T.lerp(magGrab.clone().add(V3(ps.lMagOff)), ps.lMag);
    if (ps[l + 'W'] > 0) T.lerp(toChest(V3(ps[l + 'TW'])), ps[l + 'W']);
    const Wt = T.lerp(Wg, ps[l + 'G']);
    const cp = V3(ps[l + 'Pole']);
    const pole = cp.lengthSq() > 1e-6 ? cp : POLE[s][0].clone().lerp(POLE[s][1], ps.aim);
    const E1 = ikV(S, Wt, 0.29, 0.27, pole);
    const qU = new THREE.Quaternion().setFromUnitVectors(E0.clone().sub(S).normalize(), E1.clone().sub(S).normalize());
    const qF = new THREE.Quaternion().setFromUnitVectors(W0.clone().sub(E0).normalize(), Wt.clone().sub(E1).normalize().applyQuaternion(qU.clone().invert()));
    const qArm = qU.clone().multiply(qF);
    const qHW = qArm.clone().slerp(q, ps[l + 'H']);
    out['upperArm' + s] = qU;
    out['foreArm' + s] = qF;
    out['hand' + s] = qArm.clone().invert().multiply(qHW);
    hand[s] = { pos: E1.clone().add(W0.clone().sub(E0).applyQuaternion(qArm)), q: qHW };
  }
  const qi = q.clone().invert();
  const mp = MGRAB.clone().sub(B);
  const mq = new THREE.Quaternion();
  if (ps.mag > 0) {
    let wp, wq;
    if (ps.magFall >= 0) {
      wp = magGrab.clone().add(V3(REL)).add(FGo.clone().applyQuaternion(q));
      wp.y -= 4.9 * ps.magFall * ps.magFall;
      wq = q.clone();
    } else {
      wp = hand.L.pos.clone().add(FGo.clone().applyQuaternion(hand.L.q));
      wq = hand.L.q.clone();
    }
    mp.lerp(wp.sub(b).applyQuaternion(qi), ps.mag);
    mq.slerp(qi.clone().multiply(wq), ps.mag);
  }
  out.mag = mq;
  out.magPos = mp;
  const sc = Math.max(1e-3, 1 - ps.magHide);
  out.magScale = new THREE.Vector3(sc, sc, sc);
  out.hipsPos = REST.hips.clone().add(V3(ps.hipsPos));
  const bq = eq(ps.bagR);
  out.bag = bq;
  out.bagPos = V3(ps.bagP).sub(V3(PACK_C).sub(REST.chest).applyQuaternion(bq));
  out.drone = eq(ps.droneR);
  out.dronePos = V3(ps.droneP);
  return out;
}
const QB = ['hips', 'spine', 'chest', 'neck', 'head', 'upperArmR', 'foreArmR', 'handR', 'upperArmL', 'foreArmL', 'handL', 'weapon', 'mag', 'thighR', 'shinR', 'footR', 'thighL', 'shinL', 'footL', 'bag', 'drone'];
function makeClip(name, dur, fn) {
  const n = Math.max(2, Math.round(dur * 30) + 1);
  const times = [], q = {}, hp = [], wp = [], mp = [], ms = [], bp = [], dp = [];
  QB.forEach((b) => (q[b] = []));
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * dur;
    times.push(t);
    const s = solve(fn(t, t / dur));
    QB.forEach((b) => q[b].push(s[b].x, s[b].y, s[b].z, s[b].w));
    hp.push(...s.hipsPos.toArray());
    wp.push(...s.weaponPos.toArray());
    mp.push(...s.magPos.toArray());
    ms.push(...s.magScale.toArray());
    bp.push(...s.bagPos.toArray());
    dp.push(...s.dronePos.toArray());
  }
  const tr = QB.map((b) => new THREE.QuaternionKeyframeTrack(b + '.quaternion', times, q[b]));
  tr.push(new THREE.VectorKeyframeTrack('hips.position', times, hp), new THREE.VectorKeyframeTrack('weapon.position', times, wp),
    new THREE.VectorKeyframeTrack('mag.position', times, mp), new THREE.VectorKeyframeTrack('mag.scale', times, ms),
    new THREE.VectorKeyframeTrack('bag.position', times, bp), new THREE.VectorKeyframeTrack('drone.position', times, dp));
  return new THREE.AnimationClip(name, dur, tr);
}

/* ================= clip library ================= */
const env = (t, a, b, c, d) => (t < a || t > d ? 0 : t < b ? sm01((t - a) / (b - a)) : t < c ? 1 : 1 - sm01((t - c) / (d - c)));
const lerpA = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
function pathK(K, u) {
  let i = 0;
  while (i < K.length - 2 && u > K[i + 1][0]) i++;
  const a = K[i], b = K[i + 1];
  return lerpA(a[1], b[1], sm01((u - a[0]) / (b[0] - a[0])));
}
function stance(p) {
  p.thighR = [0.12, 0, -0.05]; p.thighL = [-0.12, 0, 0.05]; p.shinR = [0.12, 0, 0]; p.shinL = [0.16, 0, 0]; p.footR = [-0.2, 0, 0]; p.hipsPos = [0, -0.02, 0];
  return p;
}
function walkLegs(p, f, amp) {
  for (const [s, o] of [['R', 0], ['L', Math.PI]]) {
    const g = f + o;
    p['thigh' + s] = [-amp * sin(g), 0, 0];
    p['shin' + s] = [0.12 + 0.62 * Math.pow(mx0(-cos(g)), 1.4), 0, 0];
    p['foot' + s] = [-0.5 * (p['thigh' + s][0] + p['shin' + s][0]) + 0.1 * sin(g), 0, 0];
  }
  p.hipsPos = [0, -0.025 * Math.pow(sin(f), 2), 0];
  p.hips = [0, 0.08 * sin(f), 0.03 * cos(f)];
  return p;
}
function crouchLegs(p) {
  p.hipsPos = [0, -0.36, -0.08]; p.thighR = [-1.1, 0, -0.12]; p.thighL = [-1.1, 0, 0.12]; p.shinR = [1.9, 0, 0]; p.shinL = [1.9, 0, 0];
  p.footR = [-0.8, 0, 0]; p.footL = [-0.8, 0, 0]; p.spine = [0.25, 0, 0]; p.head = [-0.22, 0, 0];
  return p;
}
function prone(p) {
  p.hips = [1.45, 0, 0]; p.hipsPos = [0, -0.82, 0]; p.spine = [-0.05, 0, 0]; p.neck = [-0.3, 0, 0]; p.head = [-1.05, 0, 0];
  p.thighR = [-0.05, 0, -0.25]; p.thighL = [-0.05, 0, 0.25]; p.shinR = [0.1, 0, 0]; p.shinL = [0.1, 0, 0]; p.footR = [0.5, 0, 0]; p.footL = [0.5, 0, 0];
  // the rifle at the shoulder, along the ground ahead (chest-local +y is forward, -z is up when prone)
  p.cw = 1; p.cButt = [-0.13, 1.3, -0.03]; p.cDir = [0.06, 1, 0.02]; p.cUp = [0, 0, -1]; p.rPole = [-1, 0, 0.6]; p.lPole = [1, 0, 0.6];
  return p;
}
function aimUpper(p, w) {
  p.aim = w; p.spine[1] += -0.35 * w; p.chest[1] += -0.45 * w; p.neck[1] += 0.2 * w; p.head[1] += 0.58 * w; p.head[0] += 0.1 * w;
  return p;
}
function burst(t) {
  let r = 0;
  for (const ts of [0, 0.12, 0.24]) if (t >= ts) r = Math.max(r, Math.exp(-(t - ts) / 0.035));
  return r;
}
const J = (o) => Object.assign(pose0(), o);
/** Kneeling on the right knee (e: 0 standing .. 1 down), the rifle hanging at the front, hands free. */
function droneKneel(p, e) {
  const K = { hipsPos: [0, -0.45, 0], thighR: [0.05, 0, -0.05], shinR: [1.5, 0, 0], footR: [-0.1, 0, 0], thighL: [-1.45, 0, 0.08], shinL: [1.45, 0, 0], footL: [0, 0, 0], spine: [0.22, 0, 0], head: [-0.12, 0, 0] };
  for (const k in K) p[k] = K[k].map((v) => v * e);
  p.wRot = [0.9, 0.2, 0.3]; p.wOff = [0.05, -0.15, 0.12];
  p.lG = 0; p.rG = 0; p.lH = 0; p.rH = 0; p.lPole = [1, -0.6, -0.4]; p.rPole = [-1, -0.6, -0.4];
  p.lT = [0.25, 0.97, 0.07]; p.rT = [-0.25, 0.97, 0.07];
  return p;
}
/** Slip the pack off, kneel, open it, take the drone out, put it down, goggles, controller, launch. */
const DRONE_K = [
  // t, kneel, lT, rT, lTW, rTW, lW, bagP, bagR, droneP, spine lean
  [0.0, 0, [0.25, 0.97, 0.07], [-0.25, 0.97, 0.07], null, null, 0, PACK_C, [0, 0, 0], [0, 1.25, -0.25], 0],
  [0.5, 0, [0.13, 1.42, 0.15], [-0.13, 1.42, 0.15], null, null, 0, PACK_C, [0, 0, 0], [0, 1.25, -0.25], 0],
  [1.0, 0, [0.22, 1.42, -0.18], [-0.13, 1.42, 0.15], null, null, 0, [0.1, 1.15, -0.28], [0, 0, -0.3], [0, 1.25, -0.25], 0],
  [1.6, 0.2, null, null, [0.44, 1.02, 0.25], [0.17, 1.02, 0.3], 1, [0.3, 1.0, 0.25], [0, 1.6, 0], [0, 1.25, -0.25], 0.1],
  [2.3, 1, null, null, [0.19, 0.3, 0.62], [-0.09, 0.3, 0.62], 1, [0.05, 0.16, 0.62], [-1.5, 3.14, 0], [0.05, 0.2, 0.62], 0.35],
  [3.0, 1, null, null, [0.27, 0.33, 0.5], [-0.17, 0.33, 0.5], 1, [0.05, 0.16, 0.62], [-1.5, 3.14, 0], [0.05, 0.2, 0.62], 0.35],
  [3.6, 1, null, null, [0.2, 0.74, 0.5], [-0.1, 0.74, 0.5], 1, [0.05, 0.16, 0.62], [-1.5, 3.14, 0], [0.05, 0.74, 0.5], 0.15],
  [4.4, 1, null, null, [0.2, 0.13, 1.08], [-0.1, 0.13, 1.08], 1, [0.05, 0.16, 0.62], [-1.5, 3.14, 0], [0.05, 0.05, 1.15], 0.6],
  [5.0, 1, [0.08, 1.62, 0.12], [-0.08, 1.62, 0.12], null, null, 0, [0.05, 0.16, 0.62], [-1.5, 3.14, 0], [0.05, 0.05, 1.15], 0.2],
  [5.6, 1, [0.075, 1.12, 0.28], [-0.075, 1.12, 0.28], null, null, 0, [0.05, 0.16, 0.62], [-1.5, 3.14, 0], [0.05, 0.05, 1.15], 0.22],
  [7.0, 1, [0.075, 1.12, 0.28], [-0.075, 1.12, 0.28], null, null, 0, [0.05, 0.16, 0.62], [-1.5, 3.14, 0], [0.05, 0.05, 1.15], 0.22],
];
/** When the drone shows (taken out), lifts off; the goggles and the controller (s into deployDrone). */
export const DRONE_T = { show: 2.9, goggles: 5.2, controller: 5.5, launch: 6.0, packDown: 2.3 };
function droneDeploy(t) {
  let i = 0;
  while (i < DRONE_K.length - 2 && t > DRONE_K[i + 1][0]) i++;
  const a = DRONE_K[i], b = DRONE_K[i + 1], f = sm01((t - a[0]) / (b[0] - a[0]));
  const L = (x, y) => lerpA(x, y, f);
  const p = droneKneel(pose0(), a[1] + (b[1] - a[1]) * f);
  const cs = (k, d) => a[k] ?? b[k] ?? d;
  const cs2 = (k, d) => b[k] ?? a[k] ?? d;
  p.lT = L(cs(2, p.lT), cs2(2, p.lT)); p.rT = L(cs(3, p.rT), cs2(3, p.rT));
  p.lTW = L(cs(4) ?? [0, 0, 0], cs2(4) ?? [0, 0, 0]); p.rTW = L(cs(5) ?? [0, 0, 0], cs2(5) ?? [0, 0, 0]);
  p.lW = p.rW = a[6] + (b[6] - a[6]) * f;
  p.bagP = L(a[7], b[7]); p.bagR = L(a[8], b[8]); p.droneP = L(a[9], b[9]);
  p.spine[0] += a[10] + (b[10] - a[10]) * f;
  p.head[0] += 0.25 * env(t, 1.4, 1.8, 4.6, 5.0) - 0.15 * env(t, 4.8, 5.0, 5.3, 5.5);
  return p;
}
const DIE_KEYS = (() => {
  const k3 = J({ hips: [-1.45, 0.15, 0.05], hipsPos: [0, -0.71, -0.78], thighR: [0.32, 0, -0.1], shinR: [0.22, 0, 0], thighL: [0.2, 0, 0.15], shinL: [0.5, 0, 0], chest: [-0.08, 0, 0], head: [-0.25, 0.5, 0], wOff: [0, -0.06, 0.12], wRot: [0.3, 0.3, -0.8] });
  return [[0, J({})],
    [0.3, J({ hipsPos: [0, -0.12, -0.05], thighR: [-0.25, 0, 0], shinR: [0.6, 0, 0], thighL: [-0.1, 0, 0], shinL: [0.4, 0, 0], footR: [-0.3, 0, 0], chest: [-0.28, 0.1, 0], head: [0.25, 0, 0], wOff: [0, -0.05, 0.05], wRot: [0, 0, -0.3] })],
    [0.72, J({ hips: [-0.75, 0.1, 0], hipsPos: [0, -0.48, -0.38], thighR: [-0.5, 0, 0], shinR: [0.9, 0, 0], thighL: [-0.35, 0, 0], shinL: [0.7, 0, 0], chest: [-0.2, 0, 0], head: [-0.2, 0, 0], wOff: [0, -0.08, 0.1], wRot: [0, 0.2, -0.6] })],
    [1.08, k3], [1.2, Object.assign(J({}), k3, { hipsPos: [0, -0.67, -0.78], chest: [-0.16, 0, 0] })], [1.45, k3]];
})();
const JUMP_KEYS = [
  [0, J({})],
  [0.22, J({ hipsPos: [0, -0.2, 0], thighR: [-0.65, 0, 0], thighL: [-0.65, 0, 0], shinR: [1.2, 0, 0], shinL: [1.2, 0, 0], footR: [-0.55, 0, 0], footL: [-0.55, 0, 0], spine: [0.3, 0, 0], head: [-0.2, 0, 0], wOff: [0, -0.03, 0] })],
  [0.36, J({ hipsPos: [0, 0.12, 0], thighR: [0.15, 0, 0], thighL: [0.1, 0, 0], shinR: [0.1, 0, 0], shinL: [0.1, 0, 0], footR: [0.35, 0, 0], footL: [0.35, 0, 0], spine: [-0.05, 0, 0], wOff: [0, 0.04, 0] })],
  [0.57, J({ hipsPos: [0, 0.48, 0], thighR: [-0.85, 0, 0], thighL: [-0.7, 0, 0], shinR: [1.4, 0, 0], shinL: [1.2, 0, 0], footR: [-0.3, 0, 0], footL: [-0.3, 0, 0], spine: [0.15, 0, 0], wOff: [0, 0.05, 0] })],
  [0.76, J({ hipsPos: [0, 0.08, 0], thighR: [-0.25, 0, 0], thighL: [-0.25, 0, 0], shinR: [0.4, 0, 0], shinL: [0.4, 0, 0], footR: [0.2, 0, 0], footL: [0.2, 0, 0] })],
  [0.86, J({ hipsPos: [0, -0.24, 0], thighR: [-0.75, 0, 0], thighL: [-0.75, 0, 0], shinR: [1.35, 0, 0], shinL: [1.35, 0, 0], footR: [-0.6, 0, 0], footL: [-0.6, 0, 0], spine: [0.35, 0, 0], head: [-0.2, 0, 0], wOff: [0, -0.04, 0] })],
  [1.1, J({})],
];
const RELOAD_KEYS = [ // [t, lMag, lMagOff, lT, lPole]
  [0, 1, [0, 0, 0], [0, 0, 0], [0, 0, 0]], [0.35, 1, [0, 0, 0], [0, 0, 0], [0.5, -1, 0.2]], [0.45, 1, [0, 0, 0], [0, 0, 0], [0.5, -1, 0.2]], [0.75, 1, REL, [0, 0, 0], [0.5, -1, 0.2]], [0.85, 1, REL, [0, 0, 0], [0.5, -1, 0.2]],
  [1.25, 0, [0, 0, 0], [0.21, 1.0, -0.17], [1, -0.3, -1]], [1.36, 0, [0, 0, 0], [0.21, 1.0, -0.17], [1, -0.3, -1]], [1.85, 1, [0, -0.13, 0.05], [0.21, 1.0, -0.17], [0.5, -1, 0.2]],
  [2.1, 1, [0, 0, 0], [0, 0, 0], [0.5, -1, 0.2]], [2.22, 1, [0, -0.025, 0], [0, 0, 0], [0.5, -1, 0.2]], [2.4, 1, [0, -0.005, 0], [0, 0, 0], [0.5, -1, 0.2]], [2.8, 1, [0, 0, 0], [0, 0, 0], [0, 0, 0]]];
const SWIM_K = [[0, [0.07, 1.93, 0.1]], [0.3, [0.38, 1.72, 0.22]], [0.55, [0.22, 1.45, 0.24]], [0.75, [0.08, 1.55, 0.12]], [1, [0.07, 1.93, 0.1]]];
// the throw: the right hand to the grenade pouch on the belt, up to the chest (pin), wind up over the shoulder, throw
const THROW_K = [[0, [-0.2, 1.02, 0.14]], [0.25, [-0.19, 0.99, 0.13]], [0.45, [-0.08, 1.3, 0.28]], [0.8, [-0.33, 1.68, -0.18]], [1.0, [-0.12, 1.62, 0.5]], [1.15, [0.02, 1.25, 0.55]], [1.6, [-0.2, 1.05, 0.15]]];
const THROW_UK = THROW_K.map(([k, v]) => [k / 1.6, v]); // keyed in seconds -> clip fraction
/** When the grenade leaves the hand, and when it is in it (s). */
export const THROW_RELEASE = 1.0;
export const THROW_HOLD = [0.25, 1.0];

const CLIPS = {
  idle: [2.4, (t, u) => {
    const p = pose0(), f = TAU * u;
    p.chest = [0.025 * sin(f), 0, 0]; p.spine = [0.01 * sin(f), 0, 0]; p.head = [0.03 * sin(f), 0.16 * sin(f), 0]; p.wOff = [0, 0.006 * sin(f), 0];
    return p;
  }],
  walk: [1.1, (t, u) => {
    const p = walkLegs(pose0(), TAU * u, 0.42), f = TAU * u;
    p.spine = [0.05, -0.1 * sin(f), 0]; p.chest = [0.02, -0.03 * sin(f), 0]; p.head = [-0.04, 0.03 * sin(f), 0];
    p.wOff = [0, -0.01 * sin(2 * f), 0]; p.wRot = [0, 0, 0.02 * sin(f)];
    return p;
  }],
  run: [0.66, (t, u) => {
    const p = pose0(), f = TAU * u, s = sin(f);
    for (const [k, o] of [['R', 0], ['L', Math.PI]]) {
      const g = f + o;
      p['thigh' + k] = [-0.18 - 0.72 * sin(g), 0, 0];
      p['shin' + k] = [0.3 + 1.15 * Math.pow(mx0(-cos(g)), 1.2), 0, 0];
      p['foot' + k] = [-0.45 * (p['thigh' + k][0] + p['shin' + k][0]), 0, 0];
    }
    p.hipsPos = [0, -0.05 + 0.045 * Math.abs(cos(f)), 0]; p.hips = [0.05, 0.12 * s, 0]; p.spine = [0.2, -0.15 * s, 0]; p.chest = [0.08, -0.06 * s, 0]; p.head = [-0.22, 0.06 * s, 0];
    // the left arm pumps free; the rifle swings in the right hand against it
    p.lG = 0; p.lH = 0; p.lT = [0.25, 1.14 + 0.1 * mx0(s) + 0.04 * mx0(-s), 0.04 + 0.25 * s]; p.lPole = [1, -0.2, -1];
    p.wOff = [0, 0.03 - 0.035 * s, 0.02 - 0.05 * s]; p.wRot = [-0.12 * s, 0.06 * s, 0.06];
    return p;
  }],
  crouch: [2.2, (t, u) => {
    const p = crouchLegs(pose0()), f = TAU * u;
    p.chest = [0.03 * sin(f), 0, 0]; p.head[1] = 0.2 * sin(f); p.wOff = [0, 0.005 * sin(f), 0];
    return p;
  }],
  aim: [2.4, (t, u) => {
    const p = stance(pose0()), f = TAU * u;
    aimUpper(p, 1); p.wOff = [0.004 * sin(f), 0.004 * sin(2 * f), 0]; p.chest[0] += 0.015 * sin(f);
    return p;
  }],
  shoot: [0.36, (t) => {
    const p = stance(pose0());
    aimUpper(p, 1);
    const r = burst(t);
    p.recoil = r; p.chest[0] -= 0.03 * r; p.head[0] -= 0.02 * r;
    return p;
  }],
  crouchAim: [2.2, (t, u) => {
    const p = crouchLegs(pose0()), f = TAU * u;
    p.spine[0] = 0.12; p.head[0] = -0.1; aimUpper(p, 1); p.wOff = [0.003 * sin(f), 0.003 * sin(2 * f), 0];
    return p;
  }],
  crouchShoot: [0.36, (t) => {
    const p = crouchLegs(pose0());
    p.spine[0] = 0.12; p.head[0] = -0.1; aimUpper(p, 1);
    const r = burst(t);
    p.recoil = r; p.chest[0] -= 0.03 * r;
    return p;
  }],
  aimWalk: [1.2, (t, u) => {
    const p = walkLegs(pose0(), TAU * u, 0.32), f = TAU * u;
    p.hipsPos[1] -= 0.06; p.thighR[0] -= 0.15; p.thighL[0] -= 0.15; p.shinR[0] += 0.25; p.shinL[0] += 0.25;
    aimUpper(p, 1); p.wOff = [0, 0.006 * sin(2 * f), 0];
    return p;
  }],
  reload: [2.8, (t) => {
    const p = stance(pose0());
    const tl = env(t, 0, 0.3, 2.45, 2.8);
    p.wOff = [0.03 * tl, 0.09 * tl, 0.06 * tl]; p.wRot = [-0.1 * tl, 0.25 * tl, 0.5 * tl];
    const lk = env(t, 0.2, 0.45, 2.2, 2.55);
    p.head = [0.35 * lk, 0.25 * lk, 0]; p.spine = [0.05 * lk, 0, 0];
    let i = 0;
    const K = RELOAD_KEYS;
    while (i < K.length - 2 && t > K[i + 1][0]) i++;
    const a = K[i], b = K[i + 1], s = sm01((t - a[0]) / (b[0] - a[0]));
    p.lMag = a[1] + (b[1] - a[1]) * s; p.lMagOff = lerpA(a[2], b[2], s); p.lT = lerpA(a[3], b[3], s); p.lPole = lerpA(a[4], b[4], s);
    p.lG = 1 - env(t, 0.0, 0.35, 2.4, 2.8); p.lH = 1;
    p.mag = t >= 0.45 && t < 2.12 ? 1 : 0; p.magFall = t >= 0.85 && t < 1.3 ? t - 0.85 : -1; p.magHide = t >= 1.15 && t < 1.33 ? 1 : 0;
    return p;
  }],
  throwGrenade: [1.6, (t) => {
    const p = stance(pose0());
    const e = env(t, 0, 0.2, 1.25, 1.55);
    // the left hand keeps the rifle, muzzle down; the right hand throws
    p.wRot = [0.9 * e, 0.2 * e, 0.3 * e]; p.wOff = [0.06 * e, -0.08 * e, 0.08 * e];
    p.rG = 1 - e; p.rH = 0; p.rPole = [-1, -0.4, -0.4]; p.rT = pathK(THROW_UK, t / 1.6);
    const wind = env(t, 0.45, 0.8, 0.82, 1.0), thr = env(t, 0.85, 1.0, 1.15, 1.5);
    p.spine = [-0.1 * wind + 0.2 * thr, -0.45 * wind + 0.35 * thr, 0]; p.chest = [-0.08 * wind + 0.1 * thr, -0.15 * wind + 0.15 * thr, 0];
    p.thighL = [-0.12 - 0.25 * thr, 0, 0.05]; p.shinL = [0.16 + 0.2 * thr, 0, 0]; p.thighR = [0.12 + 0.12 * thr, 0, -0.05];
    p.head = [0.15 * env(t, 0.1, 0.3, 0.4, 0.55), 0.35 * wind - 0.2 * thr, 0];
    return p;
  }],
  jump: [1.1, (t) => keyed(JUMP_KEYS, t)],
  proneAim: [2.4, (t, u) => {
    const p = prone(pose0());
    p.wOff = [0.003 * sin(TAU * u), 0, 0.002 * sin(2 * TAU * u)];
    return p;
  }],
  proneShoot: [0.36, (t) => {
    const p = prone(pose0());
    const r = burst(t);
    p.wOff = [0, -0.03 * r, -0.012 * r]; p.head[0] -= 0.03 * r;
    return p;
  }],
  // the secondary from the back: the right hand over the shoulder, the carbine round to the front
  drawSecondary: [1.2, (t) => {
    const p = stance(pose0());
    const e = sm01((t - 0.35) / 0.6);
    p.sling = 1 - e;
    p.rG = sm01((t - 0.75) / 0.3); p.rH = 0; p.rPole = [-1, -0.2, -0.3];
    p.rT = pathK([[0, [-0.25, 0.97, 0.07]], [0.3, [-0.2, 1.62, -0.12]], [0.5, [-0.2, 1.62, -0.12]], [1, [-0.12, 1.25, 0.2]]], t / 1.2);
    p.lG = sm01((t - 0.85) / 0.3); p.lH = 0; p.lT = [0.25, 0.97, 0.07];
    p.head = [0, -0.35 * env(t, 0.05, 0.25, 0.45, 0.7), 0];
    return p;
  }],
  deployDrone: [7.0, (t) => droneDeploy(t)],
  droneControl: [3.0, (t, u) => {
    const p = droneKneel(pose0(), 1);
    p.lT = [0.075 + 0.006 * sin(TAU * u * 2), 1.12, 0.28]; p.rT = [-0.075 + 0.005 * sin(TAU * u * 3 + 1), 1.12, 0.28];
    p.head = [-0.05, 0.08 * sin(TAU * u), 0];
    return p;
  }],
  // the flame gun: only standing, aimed from the hip
  flame: [2.0, (t, u) => {
    const p = stance(pose0()), f = TAU * u;
    aimUpper(p, 1);
    p.wOff = [0.006 * sin(f * 3), -0.05, 0.004 * sin(f * 5)];
    return p;
  }],
  crawl: [2.0, (t, u) => {
    const p = pose0(), f = TAU * u, s = sin(f);
    p.hips = [1.45, 0.06 * s, 0.04 * s]; p.hipsPos = [0, -0.82, 0]; p.spine = [-0.05, -0.05 * s, 0]; p.neck = [-0.25, 0, 0]; p.head = [-1.0, 0.1 * s, 0];
    p.cw = 1; p.cButt = [-0.13, 1.3, 0.05]; p.cDir = [0.12, 1, 0]; p.cUp = [0, 0, -1]; p.wOff = [0, 0.05 * s, 0]; p.rPole = [-1, 0, 0.6]; p.lPole = [1, 0, 0.6];
    p.thighR = [-0.1, 0, -(0.12 + 0.5 * mx0(s))]; p.shinR = [0.2 + 0.6 * mx0(s), 0, 0]; p.thighL = [-0.1, 0, 0.12 + 0.5 * mx0(-s)]; p.shinL = [0.2 + 0.6 * mx0(-s), 0, 0];
    p.footR = [0.4, 0, 0]; p.footL = [0.4, 0, 0];
    return p;
  }],
  swim: [1.6, (t, u) => {
    const p = pose0(), f = TAU * u;
    p.hips = [1.45, 0, 0]; p.hipsPos = [0, -0.6 + 0.03 * sin(f), 0]; p.neck = [-0.3, 0, 0]; p.head = [-0.9, 0, 0]; p.sling = 1;
    p.lG = 0; p.rG = 0; p.lH = 0; p.rH = 0;
    const lt = pathK(SWIM_K, u);
    p.lT = lt; p.rT = [-lt[0], lt[1], lt[2]]; p.lPole = [1, 0, -0.6]; p.rPole = [-1, 0, -0.6];
    p.thighR = [0.22 * sin(2 * f), 0, 0]; p.thighL = [-0.22 * sin(2 * f), 0, 0]; p.shinR = [0.3 + 0.25 * sin(2 * f + 1), 0, 0]; p.shinL = [0.3 - 0.25 * sin(2 * f + 1), 0, 0];
    p.footR = [0.6, 0, 0]; p.footL = [0.6, 0, 0];
    return p;
  }],
  signalMove: [1.6, (t) => {
    const p = stance(pose0());
    const g = env(t, 0.05, 0.25, 1.25, 1.55);
    p.lG = 1 - g; p.lH = 0; p.lPole = [1, -0.6, -0.4];
    p.lT = pathK([[0, [0.3, 1.72, 0.22]], [0.35, [0.3, 1.72, 0.22]], [0.55, [0.28, 1.74, 0.26]], [0.8, [0.22, 1.42, 0.62]], [1, [0.22, 1.42, 0.62]]], t / 1.6);
    p.head = [0, 0.45 * env(t, 0.1, 0.35, 1.1, 1.4), 0]; p.chest = [0, 0.15 * g, 0]; p.wOff = [0, -0.04 * g, 0];
    return p;
  }],
  signalHalt: [1.6, (t) => {
    const p = stance(pose0());
    const g = env(t, 0.05, 0.3, 1.2, 1.5);
    p.lG = 1 - g; p.lH = 0; p.lPole = [1, -0.2, 0]; p.lT = [0.48, 1.7, 0.06]; p.head = [0, 0.3 * g, 0]; p.wOff = [0, -0.04 * g, 0];
    return p;
  }],
  signalDown: [1.6, (t) => {
    const p = stance(pose0());
    const g = env(t, 0.05, 0.25, 1.25, 1.5);
    p.lG = 1 - g; p.lH = 0; p.lPole = [1, -0.5, -0.3];
    p.lT = [0.32, 1.3 - 0.08 * mx0(sin((t - 0.25) * TAU * 2)), 0.45]; p.head = [0, 0.35 * g, 0]; p.chest = [0.05 * g, 0.1 * g, 0]; p.wOff = [0, -0.04 * g, 0];
    return p;
  }],
  // keying the radio on the chest (the push-to-talk on the left shoulder strap), head to the mic
  radio: [2.4, (t) => {
    const p = stance(pose0());
    const g = env(t, 0.05, 0.35, 1.95, 2.35);
    p.lG = 1 - g; p.lH = 0; p.lPole = [1, -0.9, 0.1]; p.lT = [0.1, 1.36, 0.21];
    p.head = [0.12 * g, 0.25 * g, 0.18 * g]; p.chest = [0.04 * g, 0.12 * g, 0]; p.wOff = [0, -0.04 * g, 0];
    return p;
  }],
  hit: [0.6, (t, u) => {
    const p = pose0();
    const e = u < 0.14 ? sm01(u / 0.14) : 1 - sm01((u - 0.14) / 0.86);
    p.chest = [-0.36 * e, 0.25 * e, 0.1 * e]; p.spine = [-0.15 * e, 0.12 * e, 0]; p.head = [-0.35 * e, -0.2 * e, 0]; p.thighR = [-0.18 * e, 0, 0]; p.shinR = [0.38 * e, 0, 0]; p.footR = [-0.15 * e, 0, 0];
    p.hipsPos = [0, -0.045 * e, -0.04 * e]; p.wOff = [0, 0.035 * e, -0.025 * e]; p.wRot = [0, 0, 0.25 * e];
    return p;
  }],
  die: [1.45, (t) => keyed(DIE_KEYS, t)],
  // picking a rifle up from the ground (unarmed only): crouch, reach, stand
  pickup: [1.3, (t) => {
    const p = pose0();
    const e = env(t, 0, 0.4, 0.8, 1.25);
    const c = crouchLegs(pose0());
    for (const k of ['hipsPos', 'thighR', 'thighL', 'shinR', 'shinL', 'footR', 'footL']) p[k] = c[k].map((v) => v * e);
    p.spine = [0.55 * e, 0, 0]; p.chest = [0.3 * e, 0, 0]; p.head = [-0.3 * e, 0, 0];
    p.rG = 0; p.lG = 0; p.rH = 0; p.lH = 0;
    p.rT = lerpA([-0.25, 0.97, 0.07], [-0.08, 1.12, 0.56], e); p.lT = lerpA([0.25, 0.97, 0.07], [0.12, 1.1, 0.52], e);
    p.rPole = [-0.4, -0.2, -1]; p.lPole = [0.4, -0.2, -1];
    return p;
  }],
};

export const ONCE = { deployDrone: 1, drawSecondary: 1, radio: 1, hit: 1, die: 1, reload: 1, jump: 1, signalMove: 1, signalHalt: 1, signalDown: 1, throwGrenade: 1, pickup: 1 };
/** Ground speed each moving clip is made for (m/s). */
export const MOVING = { walk: 1.35, run: 3.4, aimWalk: 1.0, crawl: 0.35, swim: 0.6 };
export const AIMING = { aim: 1, shoot: 1, crouchAim: 1, crouchShoot: 1, aimWalk: 1, flame: 1 };
export const LABELS = { idle: 'Idle', walk: 'Walk', run: 'Run', crouch: 'Crouch', aim: 'Aim', shoot: 'Shoot', crouchAim: 'Crouch aim', crouchShoot: 'Crouch fire', aimWalk: 'Aim-walk',
  reload: 'Reload', throwGrenade: 'Grenade', jump: 'Jump', crawl: 'Crawl', proneAim: 'Prone aim', proneShoot: 'Prone fire', drawSecondary: 'Draw 2nd', flame: 'Flame gun', deployDrone: 'Drone', droneControl: 'Drone ctrl', swim: 'Swim', signalMove: 'Sig: move', signalHalt: 'Sig: halt', signalDown: 'Sig: down', radio: 'Radio', hit: 'Hit', die: 'Die' };
/** Without a rifle: what each clip becomes. */
const UNARMED_AS = { shoot: 'aim', crouchShoot: 'crouchAim', proneShoot: 'proneAim', reload: 'idle', flame: 'aim' };
/** Clips that do not care whether he has a rifle. */
const NO_UNARMED = { drawSecondary: 1, deployDrone: 1, droneControl: 1, pickup: 1, swim: 1 };
/** A flame trooper cannot shoot or reload; he fires the flame gun standing only. */
const TORCH_AS = { shoot: 'flame', crouchShoot: 'crouchAim', proneShoot: 'proneAim', reload: 'idle' };

/** The unarmed version of a clip: hands that were on the rifle are free (hanging, swinging, guard). */
function unarm(name, base) {
  return (t, u) => {
    const p = base(t, u);
    const f = TAU * u, s = sin(f);
    let R = [-0.25, 0.97, 0.07], L = [0.25, 0.97, 0.07];
    let pr = [-0.4, -0.2, -1], pl = [0.4, -0.2, -1];
    if (name === 'walk' || name === 'aimWalk') {
      R = [-0.25, 0.98, 0.07 - 0.14 * s];
      L = [0.25, 0.98, 0.07 + 0.14 * s];
    } else if (name === 'run') {
      R = [-0.25, 1.14 + 0.1 * mx0(-s) + 0.04 * mx0(s), 0.04 - 0.25 * s];
      L = [0.25, 1.14 + 0.1 * mx0(s) + 0.04 * mx0(-s), 0.04 + 0.25 * s];
      pr = [-1, -0.2, -1]; pl = [1, -0.2, -1];
    } else if (name === 'crouch') {
      R = [-0.17, 1.0, 0.3]; L = [0.17, 1.0, 0.3];
    } else if (name === 'aim' || name === 'crouchAim' || name === 'shoot' || name === 'crouchShoot') {
      R = [-0.13, 1.28, 0.27]; L = [0.13, 1.3, 0.3];
      pr = [-1, -1, 0]; pl = [1, -1, 0];
    } else if (name === 'crawl' || name === 'proneAim') {
      R = [-0.2, 1.78 + 0.08 * s, 0.13]; L = [0.2, 1.78 - 0.08 * s, 0.13];
      pr = [-1, 0, 0.6]; pl = [1, 0, 0.6];
    }
    const blend = (cur, def, g) => (g >= 1 ? def : lerpA(cur, def, g));
    p.rT = blend(p.rT, R, p.rG); p.lT = blend(p.lT, L, p.lG);
    if (p.rG > 0.5) p.rPole = pr;
    if (p.lG > 0.5) p.lPole = pl;
    p.rG = 0; p.lG = 0; p.rH = 0; p.lH = 0; p.lMag = 0;
    if (name === 'aim' || name === 'shoot' || name === 'crouchAim' || name === 'crouchShoot') {
      // no rifle to aim: turn back to face forward
      p.spine[1] = 0; p.chest[1] = 0; p.neck[1] = 0; p.head[1] = 0;
    }
    return p;
  };
}
let CLIP_CACHE = null;
/** The clips (baked once): armed ones by name, unarmed ones as name + '_u'. */
export function operatorClips() {
  if (CLIP_CACHE) return CLIP_CACHE;
  const c = {};
  for (const k in CLIPS) {
    c[k] = makeClip(k, CLIPS[k][0], CLIPS[k][1]);
    if (k === 'swim') c.swim_u = c.swim;
    else if (!UNARMED_AS[k] && !NO_UNARMED[k]) c[k + '_u'] = makeClip(k + '_u', CLIPS[k][0], unarm(k, CLIPS[k][1]));
  }
  CLIP_CACHE = c;
  return c;
}

/* ================= hit zones ================= */
export const ZONES = [
  { k: 'head', label: 'Head', bone: 'head', a: [0, 1.52, 0.01], b: [0, 1.79, 0], r: 0.12, mult: 4, color: '#e0604a', sim: 'head' },
  { k: 'torso', label: 'Torso', bone: 'chest', a: [0, 1.12, 0], b: [0, 1.5, 0], r: 0.21, mult: 1, color: '#e7c35a', sim: 'torso' },
  { k: 'pelvis', label: 'Pelvis', bone: 'hips', a: [0, 0.84, 0], b: [0, 1.12, 0], r: 0.18, mult: 1, color: '#e7c35a', sim: 'torso' },
  { k: 'upperArmR', label: 'Upper arm R', bone: 'upperArmR', a: P.SR, b: SC.ARMS[0].E, r: 0.068, mult: 0.6, color: '#5aa9e6', sim: 'armR' },
  { k: 'foreArmR', label: 'Forearm R', bone: 'foreArmR', a: SC.ARMS[0].E, b: P.WR, r: 0.058, mult: 0.6, color: '#5aa9e6', sim: 'armR' },
  { k: 'upperArmL', label: 'Upper arm L', bone: 'upperArmL', a: P.SL, b: SC.ARMS[1].E, r: 0.068, mult: 0.6, color: '#5aa9e6', sim: 'armL' },
  { k: 'foreArmL', label: 'Forearm L', bone: 'foreArmL', a: SC.ARMS[1].E, b: P.WL, r: 0.058, mult: 0.6, color: '#5aa9e6', sim: 'armL' },
  { k: 'thighR', label: 'Thigh R', bone: 'thighR', a: [-0.1, 0.95, 0], b: [-0.115, 0.52, 0.045], r: 0.095, mult: 0.7, color: '#7cc46a', sim: 'legR' },
  { k: 'shinR', label: 'Shin R', bone: 'shinR', a: [-0.115, 0.52, 0.045], b: [-0.125, 0.06, 0.02], r: 0.075, mult: 0.6, color: '#7cc46a', sim: 'legR' },
  { k: 'thighL', label: 'Thigh L', bone: 'thighL', a: [0.1, 0.95, 0], b: [0.115, 0.52, 0.045], r: 0.095, mult: 0.7, color: '#7cc46a', sim: 'legL' },
  { k: 'shinL', label: 'Shin L', bone: 'shinL', a: [0.115, 0.52, 0.045], b: [0.125, 0.06, 0.02], r: 0.075, mult: 0.6, color: '#7cc46a', sim: 'legL' },
];
ZONES.forEach((z) => {
  z.len = 1;
  z.fill = new THREE.MeshBasicMaterial({ color: z.color, transparent: true, opacity: 0.2, depthWrite: false, visible: false });
  z.wire = new THREE.LineBasicMaterial({ color: z.color, transparent: true, opacity: 0.9, visible: false });
});
const ZGEO = new THREE.CylinderGeometry(1, 1, 1, 16, 1);
const ZWIRE = (() => {
  const pts = [];
  const ring = (y) => {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU, b = ((i + 1) / 24) * TAU;
      pts.push(cos(a), y, sin(a), cos(b), y, sin(b));
    }
  };
  ring(-0.5);
  ring(0.5);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    pts.push(cos(a), -0.5, sin(a), cos(a), 0.5, sin(a));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
})();
export function showZones(v) {
  ZONES.forEach((z) => {
    z.fill.visible = v;
    z.wire.visible = v;
  });
}
export function placeZone(m, z) {
  const a = V3(z.a), b = V3(z.b), mid = a.clone().add(b).multiplyScalar(0.5);
  m.position.copy(mid).sub(REST[z.bone]);
  m.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
  m.scale.set(z.r, a.distanceTo(b) * z.len, z.r);
}

/* ================= assets: sculpt every part (in workers), skin, split ================= */
const PARTS = ['person', 'legs', 'face', 'hands', 'pack', 'helmet', 'gun', 'mag'];
export const LOD = {
  full: { person: 0.0045, legs: 0.005, face: 0.0021, hands: 0.0026, pack: 0.0045, helmet: 0.0021, gun: 0.0026, mag: 0.0022 },
  game: { person: 0.006, legs: 0.0065, face: 0.003, hands: 0.0035, pack: 0.006, helmet: 0.003, gun: 0.0035, mag: 0.003 },
  far: { person: 0.009, legs: 0.009, face: 0.0045, hands: 0.005, pack: 0.009, helmet: 0.0045, gun: 0.005, mag: 0.0045 },
};
const cache = {};
/** Overridable: how to create a sculpt worker (the single-file build inlines it). */
export const workerFactory = { make: () => new Worker(new URL('./sculpt.worker.js', import.meta.url), { type: 'module' }) };

/**
 * Sculpts and assembles the operator's geometry once per level of detail.
 * onProgress(part, 0..1). Resolves to the assets OperatorFigure is built from.
 */
export function loadOperatorAssets({ lod = 'game', onProgress, sync = false } = {}) {
  if (cache[lod]) return cache[lod];
  const H = LOD[lod];
  cache[lod] = new Promise((resolve) => {
    const results = {};
    const queue = PARTS.slice();
    let running = 0;
    const done = (d) => {
      results[d.n] = d;
      onProgress?.(d.n, 1);
      running--;
      if (Object.keys(results).length === PARTS.length) resolve(assemble(results));
      else next();
    };
    const runSync = (n) => setTimeout(() => done(Object.assign({ n }, SC.polygonize(n, null, H[n]))), 0);
    const pool = Math.max(1, Math.min(4, (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2));
    function next() {
      while (running < pool && queue.length) {
        const n = queue.shift();
        running++;
        let w = null;
        if (!sync && typeof Worker !== 'undefined') {
          try {
            w = workerFactory.make();
          } catch {
            w = null;
          }
        }
        if (!w) {
          runSync(n);
          continue;
        }
        w.onerror = () => {
          w.terminate();
          runSync(n);
        };
        w.onmessage = (e) => {
          const d = e.data;
          if (d.t === 'p') onProgress?.(n, d.p);
          else {
            w.terminate();
            done(d);
          }
        };
        w.postMessage({ n, h: H[n] });
      }
    }
    next();
  });
  return cache[lod];
}

function assemble(R) {
  toFigure(P.H, R.face);
  toFigure(P.H, R.helmet);
  toFigure(P.R, R.gun);
  toFigure(P.R, R.mag);
  toFigure(P.R, R.hands);
  const A = {
    person: [geometryOf(R.person, null, 'body'), geometryOf(R.legs, null, 'legs'), geometryOf(R.face, null, 'face'), geometryOf(R.hands, null, 'hands')],
    pack: geometryOf(R.pack, REST.chest),
    helmet: geometryOf(R.helmet, REST.head),
    rifle: geometryOf(R.gun, REST.weapon),
    mag: geometryOf(R.mag, MGRAB),
  };
  const black = new THREE.MeshStandardMaterial({ color: '#18191a', roughness: 0.5, metalness: 0.3 });
  A.black = black;
  A.sling = slingGeometry();
  A.mic = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([[0.128, -0.005, 0.03], [0.11, -0.035, 0.08], [0.07, -0.055, 0.108], [0.042, -0.058, 0.113]].map(V3)), 16, 0.0035, 6);
  A.foam = new THREE.SphereGeometry(0.013, 12, 8);
  A.antenna = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([[-0.1, 1.46, -0.26], [-0.115, 1.7, -0.255], [-0.14, 1.95, -0.24], [-0.16, 2.05, -0.235]].map((a) => V3(a).sub(REST.chest))), 16, 0.0045, 6);
  // the helmet's shock cords, on the shell, in head-bone space
  const HF = SC.HF, C = V3(HF.C), F = P.H;
  const hp = (d, off) => {
    const n = d.clone().normalize();
    const t = 1 / Math.sqrt((n.x / HF.A) ** 2 + (n.y / HF.B) ** 2 + (n.z / HF.Cc) ** 2);
    const q = n.clone().multiplyScalar(t).add(C);
    const nn = new THREE.Vector3((q.x - C.x) / (HF.A * HF.A), (q.y - C.y) / (HF.B * HF.B), (q.z - C.z) / (HF.Cc * HF.Cc)).normalize();
    q.add(nn.multiplyScalar(off));
    return new THREE.Vector3(...[0, 1, 2].map((k) => F.o[k] + F.x[k] * q.x + F.y[k] * q.y + F.z[k] * q.z)).sub(REST.head);
  };
  A.cords = [[[0.95, 0.22, 0.32], [0, 1, 0.12], [-0.95, 0.22, -0.32]], [[0.95, 0.22, -0.36], [0, 1, -0.18], [-0.95, 0.22, 0.36]]].map(([a, m, b]) => {
    const Av = V3(a), M = V3(m), Bv = V3(b), pts = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      pts.push(hp(Av.clone().lerp(M, t).lerp(M.clone().lerp(Bv, t), t), 0.0024));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.0019, 6);
  });
  // a hand grenade: an egg-shaped body with fragmentation grooves, the fuse and its lever
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI;
    pts.push(new THREE.Vector2(Math.sin(a) * 0.029 * (1 + 0.08 * Math.cos(a * 8)), -Math.cos(a) * 0.04));
  }
  A.grenade = new THREE.LatheGeometry(pts, 14);
  A.grenadeFuse = new THREE.CylinderGeometry(0.008, 0.01, 0.025, 8).translate(0, 0.05, 0);
  A.grenadeMat = new THREE.MeshStandardMaterial({ color: 0x3d4a2a, roughness: 0.6, metalness: 0.3 });
  A.flashTex = flashTexture();
  Object.assign(A, secondaryAndTorch(A), droneKit());
  A.clips = operatorClips();
  A.tris = [...A.person, A.pack, A.helmet, A.rifle, A.mag].reduce((s, g) => s + g.index.count / 3, 0);
  return A;
}
/** Rifle-local (x along the barrel) to weapon-bone space. */
function rl2w(x, y, z) {
  return new THREE.Vector3(...[0, 1, 2].map((k) => P.R.x[k] * x + P.R.y[k] * y + P.R.z[k] * z));
}
function secondaryAndTorch(A) {
  // the compact carbine: the rifle with its stock folded short and its barrel cut down; the
  // grips stay where they are, so the hands fit it as they do the rifle
  const g = A.rifle.clone();
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    let x = v.dot(V3(P.R.x));
    const y = v.dot(V3(P.R.y)), z = v.dot(V3(P.R.z));
    if (x > 0.6) x = 0.6 + (x - 0.6) * 0.45;
    else if (x < 0.22) x = 0.22 - (0.22 - x) * 0.55;
    pos.setXYZ(i, ...rl2w(x, y, z).toArray());
  }
  pos.needsUpdate = true;
  g.computeBoundingSphere();
  // where it rides on the back (the weapon bone's slung pose, relative to the chest)
  const sl = solve(Object.assign(pose0(), { sling: 1 }));
  // the flame gun, along the rifle's axis with its grips where the rifle's are
  const steel = new THREE.MeshStandardMaterial({ color: '#5a5d60', roughness: 0.4, metalness: 0.8 });
  const olive = new THREE.MeshStandardMaterial({ color: '#4c5236', roughness: 0.7, metalness: 0.2 });
  const dark = A.black;
  const parts = [];
  const along = (r, x0, x1, y, mat, seg = 14) => {
    const c = new THREE.CylinderGeometry(r, r, x1 - x0, seg);
    c.rotateZ(-Math.PI / 2);
    c.translate((x0 + x1) / 2, y, 0);
    parts.push([c, mat]);
  };
  along(0.024, 0.12, 0.9, 0.03, steel);
  along(0.034, 0.9, 0.97, 0.03, dark);
  along(0.012, 0.3, 0.92, -0.012, olive, 8); // the fuel line under the barrel
  const box = (w, h, d, x, y, rz, mat) => {
    const b = new THREE.BoxGeometry(w, h, d);
    b.rotateZ(rz);
    b.translate(x, y, 0);
    parts.push([b, mat]);
  };
  box(0.035, 0.11, 0.04, 0.28, -0.075, -0.35, dark); // pistol grip
  box(0.03, 0.09, 0.03, 0.56, -0.046, 0, dark); // front grip
  box(0.2, 0.06, 0.06, 0.2, 0.03, 0, olive); // valve body
  box(0.05, 0.03, 0.03, 0.94, -0.02, 0, steel); // igniter
  const torch = new THREE.Group();
  for (const [geo, mat] of parts) {
    const p2 = geo.attributes.position;
    for (let i = 0; i < p2.count; i++) {
      v.fromBufferAttribute(p2, i);
      p2.setXYZ(i, ...rl2w(v.x, v.y, v.z).toArray());
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    torch.add(m);
  }
  // twin fuel tanks and a gas bottle on the back, over the pack
  const tanks = new THREE.Group();
  for (const [x, r] of [[-0.075, 0.068], [0.075, 0.068], [0, 0.04]]) {
    const c = new THREE.Mesh(new THREE.CapsuleGeometry(r, 0.42, 6, 16), x === 0 ? steel : olive);
    c.position.set(x, 1.25 - REST.chest.y, -0.4 - (x === 0 ? 0.07 : 0));
    c.castShadow = true;
    tanks.add(c);
  }
  return { secondary: g, slungPos: sl.weaponPos.clone(), slungQ: sl.weapon.clone(), torchGun: torch, torchTanks: tanks, nozzle: rl2w(1.0, 0.03, 0) };
}
/** A small quadcopter (in drone-bone space, ~0.3 m across), FPV goggles (head frame) and a controller. */
function droneKit() {
  const body = new THREE.MeshStandardMaterial({ color: '#2b2d30', roughness: 0.45, metalness: 0.3 });
  const accent = new THREE.MeshStandardMaterial({ color: '#d8742a', roughness: 0.5, emissive: '#3a1a05' });
  const propM = new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.6, transparent: true, opacity: 0.85 });
  const glass = new THREE.MeshStandardMaterial({ color: '#0c1a26', roughness: 0.05, metalness: 0.8 });
  const drone = new THREE.Group();
  const add = (g, m, x, y, z, ry = 0) => {
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    o.rotation.y = ry;
    o.castShadow = true;
    drone.add(o);
    return o;
  };
  add(new THREE.BoxGeometry(0.1, 0.045, 0.15), body, 0, 0.06, 0);
  add(new THREE.BoxGeometry(0.06, 0.02, 0.1), accent, 0, 0.088, -0.01);
  add(new THREE.SphereGeometry(0.018, 12, 8), glass, 0, 0.06, 0.08);
  for (const a of [Math.PI / 4, -Math.PI / 4]) add(new THREE.BoxGeometry(0.27, 0.014, 0.02), body, 0, 0.06, 0, a);
  const props = [];
  for (const [x, z] of [[0.095, 0.095], [-0.095, 0.095], [0.095, -0.095], [-0.095, -0.095]]) {
    add(new THREE.CylinderGeometry(0.017, 0.017, 0.026, 12), body, x, 0.07, z);
    const pr = add(new THREE.BoxGeometry(0.13, 0.002, 0.014), propM, x, 0.086, z);
    props.push(pr);
  }
  for (const x of [0.04, -0.04]) add(new THREE.BoxGeometry(0.008, 0.04, 0.12), body, x, 0.02, 0);
  // goggles in the head frame, over the glasses; a strap round the back of the helmet
  const goggles = new THREE.Group();
  const gb = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.068, 0.075), body);
  gb.position.set(0, 0.024, 0.122);
  const gf = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.05, 0.004), glass);
  gf.position.set(0, 0.024, 0.161);
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.008, 6, 28), new THREE.MeshStandardMaterial({ color: '#1b1b1b', roughness: 0.9 }));
  strap.rotation.x = Math.PI / 2;
  strap.position.set(0, 0.026, 0.0);
  strap.scale.set(1, 1.18, 1);
  goggles.add(gb, gf, strap);
  // the controller, held in front of the chest (chest-bone space)
  const ctrl = new THREE.Group();
  const cb = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.035, 0.1), new THREE.MeshStandardMaterial({ color: '#3a3d40', roughness: 0.6 }));
  ctrl.add(cb);
  for (const x of [0.045, -0.045]) {
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.03, 8), body);
    st.position.set(x, 0.03, 0);
    ctrl.add(st);
  }
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.12, 6), body);
  ant.position.set(0.07, 0.06, -0.04);
  ant.rotation.z = -0.3;
  ctrl.add(ant);
  ctrl.position.set(0, 1.12 - REST.chest.y, 0.3);
  ctrl.rotation.x = -0.5;
  return { drone, droneProps: props.length, goggles, ctrl };
}
function flashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,250,220,1)');
  gr.addColorStop(0.25, 'rgba(255,200,90,.9)');
  gr.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = gr;
  g.translate(64, 64);
  for (let i = 0; i < 6; i++) {
    g.rotate(Math.PI / 3);
    g.beginPath();
    g.moveTo(0, -6);
    g.lineTo(64, 0);
    g.lineTo(0, 6);
    g.fill();
  }
  g.beginPath();
  g.arc(0, 0, 30, 0, 7);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function slingGeometry() {
  const pts = [P.rw([0.03, -0.05, -0.022]), [-0.2, 1.45, 0.135], [-0.16, 1.532, 0.03], [-0.07, 1.535, -0.118], [0.07, 1.535, -0.118], [0.163, 1.532, 0.03], [0.19, 1.4, 0.16], [0.185, 1.22, 0.215], P.rw([0.5, 0.004, -0.042])].map(V3);
  const cv = new THREE.CatmullRomCurve3(pts);
  const N = 120, w = 0.0125, t = 0.0016;
  const pos = [], nrm = [], ids = [], uvs = [], aos = [], si = [], sw = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N, c = cv.getPoint(u), tg = cv.getTangent(u);
    const out = new THREE.Vector3(c.x, 0, c.z).normalize();
    const side = new THREE.Vector3().crossVectors(tg, out).normalize(), nn = new THREE.Vector3().crossVectors(side, tg).normalize();
    const ww = Math.min(1, mx0(1 - u / 0.2) + mx0((u - 0.82) / 0.18));
    for (const [a, b] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
      const v = c.clone().addScaledVector(side, a * w).addScaledVector(nn, b * t);
      pos.push(v.x, v.y, v.z);
      const vv = nn.clone().multiplyScalar(b).addScaledVector(side, a * 0.4).normalize();
      nrm.push(vv.x, vv.y, vv.z);
      ids.push(12);
      uvs.push(0, 0);
      aos.push(0.85);
      si.push(BI.weapon, BI.chest, 0, 0);
      sw.push(ww, 1 - ww, 0, 0);
    }
  }
  for (let i = 0; i < N; i++)
    for (let k = 0; k < 4; k++) {
      const a = i * 4 + k, b = i * 4 + ((k + 1) % 4), c = a + 4, d = b + 4;
      idx.push(a, c, b, b, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aId', new THREE.Float32BufferAttribute(ids, 1));
  g.setAttribute('aUV', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('aAO', new THREE.Float32BufferAttribute(aos, 1));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(idx);
  return g;
}

/* ================= physics: lightweight rigid bodies for dropped gear ================= */
/**
 * Gravity, bounce and friction for detached objects. Collides with the ground (ground(x, z)),
 * axis-aligned boxes ({ box: THREE.Box3 }) and, if given, solid(x, y, z) (a voxel world).
 */
export class PhysicsWorld {
  constructor({ ground = () => 0, boxes = () => [], solid = null } = {}) {
    this.bodies = [];
    this.ground = ground;
    this.boxes = boxes;
    this.solid = solid;
  }
  add(o, pts) {
    const b = { o, pts, v: new THREE.Vector3(), w: new THREE.Vector3(), sl: 0, asleep: false, I: Math.max(0.004, pts.reduce((m, p) => Math.max(m, p.lengthSq()), 0) * 0.35) };
    this.bodies.push(b);
    return b;
  }
  remove(b) {
    const i = this.bodies.indexOf(b);
    if (i >= 0) this.bodies.splice(i, 1);
  }
  step(dt, sub = 3) {
    for (let s = 0; s < sub; s++) for (const b of this.bodies) this.stepBody(b, dt / sub);
  }
  stepBody(b, dt) {
    if (b.asleep || dt <= 0) return;
    const { o, v, w } = b;
    v.y -= 9.81 * dt;
    o.position.addScaledVector(v, dt);
    const wl = w.length();
    if (wl > 1e-5) o.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(w.clone().divideScalar(wl), wl * dt));
    o.updateMatrixWorld();
    const wp = new THREE.Vector3(), n = new THREE.Vector3();
    const boxes = this.boxes();
    for (const p of b.pts) {
      wp.copy(p).applyMatrix4(o.matrixWorld);
      let pen = 0;
      const gy = this.ground(wp.x, wp.z);
      if (wp.y < gy) {
        pen = gy - wp.y;
        n.set(0, 1, 0);
      } else if (this.solid && this.solid(wp.x, wp.y, wp.z)) {
        let k = 0;
        while (k < 12 && this.solid(wp.x, wp.y + k * 0.05, wp.z)) k++;
        pen = k * 0.05;
        n.set(0, 1, 0);
      } else
        for (const ob of boxes) {
          const bx = ob.box;
          if (wp.x > bx.min.x && wp.x < bx.max.x && wp.z > bx.min.z && wp.z < bx.max.z && wp.y < bx.max.y && wp.y > bx.min.y) {
            const c = [[wp.x - bx.min.x, -1, 0, 0], [bx.max.x - wp.x, 1, 0, 0], [bx.max.y - wp.y, 0, 1, 0], [wp.z - bx.min.z, 0, 0, -1], [bx.max.z - wp.z, 0, 0, 1]].sort((a, c2) => a[0] - c2[0])[0];
            pen = c[0];
            n.set(c[1], c[2], c[3]);
            break;
          }
        }
      if (pen > 0) {
        o.position.addScaledVector(n, pen);
        wp.addScaledVector(n, pen);
        const r = wp.clone().sub(o.position);
        const vp = v.clone().add(new THREE.Vector3().crossVectors(w, r));
        const vn = vp.dot(n);
        if (vn < 0) {
          const rn = new THREE.Vector3().crossVectors(r, n);
          const j = (-1.25 * vn) / (1 + rn.lengthSq() / b.I);
          const imp = n.clone().multiplyScalar(j);
          const vt = vp.clone().addScaledVector(n, -vn);
          const vtl = vt.length();
          if (vtl > 1e-4) imp.addScaledVector(vt, -Math.min(0.6 * j, vtl * 0.8) / vtl);
          v.add(imp);
          w.add(new THREE.Vector3().crossVectors(r, imp).divideScalar(b.I));
        }
      }
    }
    w.multiplyScalar(0.985);
    v.x *= 0.998;
    v.z *= 0.998;
    if (v.length() < 0.06 && w.length() < 0.2) {
      b.sl += dt;
      if (b.sl > 0.6) b.asleep = true;
    } else b.sl = 0;
  }
}

/* ================= one animated soldier ================= */
const HEAD_FRAME = V3(P.H.o);
const NO_TWIST = 2.3;
/**
 * An operator: build it from loaded assets, add .group to the scene, and each frame call
 * update(dt). play(name) cross-fades to a clip; setAim(point) twists the upper body towards a
 * point while moving; detach(part, physics) drops the rifle, helmet or pack.
 * onRelease(worldPos, figure) is called when a thrown grenade leaves the hand.
 */
export class OperatorFigure {
  constructor(A, { zones = true, loadout = 'rifle' } = {}) {
    this.A = A;
    this.loadout = loadout;
    this.weapon = loadout === 'torch' ? 'torch' : 'primary';
    this.armed = true;
    this.state = 'idle';
    this.shown = 'idle';
    this.twist = 0;
    this.aimAt = null;
    this.flashUntil = 0;
    this.autoFlash = true;
    this.clock = 0;
    const g = (this.group = new THREE.Group());
    g.userData.figure = this;
    const bones = {};
    BONES.forEach(([n, par]) => {
      const b = new THREE.Bone();
      b.name = n;
      b.position.copy(REST[n]).sub(par ? REST[par] : new THREE.Vector3());
      bones[n] = b;
      if (par) bones[par].add(b);
    });
    this.bones = bones;
    g.add(bones.root);
    g.updateMatrixWorld(true);
    const skel = new THREE.Skeleton(BONES.map((b) => bones[b[0]]));
    const mat = (this.mat = makeOperatorMaterial());
    const person = new THREE.Group();
    person.name = 'person';
    g.add(person);
    for (const geo of A.person) {
      const m = new THREE.SkinnedMesh(geo, mat);
      m.frustumCulled = false;
      m.castShadow = m.receiveShadow = true;
      person.add(m);
      m.bind(skel);
    }
    this.sling = new THREE.SkinnedMesh(A.sling, mat);
    this.sling.frustumCulled = false;
    this.sling.castShadow = true;
    person.add(this.sling);
    this.sling.bind(skel);
    const mk = (geo) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = m.receiveShadow = true;
      return m;
    };
    const rifle = mk(A.rifle);
    rifle.name = 'rifle';
    bones.weapon.add(rifle);
    const mag = mk(A.mag);
    mag.name = 'mag';
    bones.mag.add(mag);
    const helmet = new THREE.Group();
    helmet.name = 'helmet';
    helmet.add(mk(A.helmet));
    A.cords.forEach((c) => helmet.add(new THREE.Mesh(c, A.black)));
    bones.head.add(helmet);
    const pack = new THREE.Group();
    pack.name = 'pack';
    pack.add(mk(A.pack));
    const ant = new THREE.Mesh(A.antenna, A.black);
    ant.castShadow = true;
    pack.add(ant);
    bones.chest.add(pack);
    // the secondary carbine, across the back
    const sec = mk(A.secondary);
    sec.name = 'secondary';
    sec.position.copy(A.slungPos);
    sec.quaternion.copy(A.slungQ);
    bones.chest.add(sec);
    this.parts = { person, rifle, mag, helmet, pack, secondary: sec };
    this.restParent = { rifle: bones.weapon, mag: bones.mag, helmet: bones.head, pack: bones.chest, secondary: bones.chest };
    if (loadout === 'torch') {
      // a flame trooper: the flame gun in place of the rifle, the tanks on his back
      rifle.visible = mag.visible = this.sling.visible = false;
      this.parts.torch = A.torchGun.clone();
      bones.weapon.add(this.parts.torch);
      bones.chest.add(A.torchTanks.clone());
      this.flames = [];
    }
    const hf = new THREE.Group();
    hf.position.copy(HEAD_FRAME).sub(REST.head);
    hf.rotation.set(P.rot.rx, P.rot.ry, 0, 'XYZ');
    bones.head.add(hf);
    hf.add(new THREE.Mesh(A.mic, A.black));
    const foam = new THREE.Mesh(A.foam, A.black);
    foam.position.set(0.036, -0.059, 0.115);
    hf.add(foam);
    // the drone kit: the quadcopter (in the pack until taken out), goggles, controller
    this.drone = A.drone.clone();
    this.drone.visible = false;
    bones.drone.add(this.drone);
    this.props = this.drone.children.filter((c) => c.geometry?.parameters?.width === 0.13);
    this.goggles = A.goggles.clone();
    this.goggles.visible = false;
    hf.add(this.goggles);
    this.ctrl = A.ctrl.clone();
    this.ctrl.visible = false;
    bones.chest.add(this.ctrl);
    // the grenade in the right hand while throwing
    const nade = (this.nade = new THREE.Group());
    nade.add(new THREE.Mesh(A.grenade, A.grenadeMat), new THREE.Mesh(A.grenadeFuse, A.black));
    nade.position.copy(V3(P.rw([0.285, -0.075, 0.035]))).sub(REST.handR);
    nade.visible = false;
    bones.handR.add(nade);
    // muzzle flash
    const fl = (this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: A.flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })));
    fl.position.copy(V3(P.rw([1.03, 0.045, 0]))).sub(REST.weapon);
    fl.scale.setScalar(0.22);
    fl.visible = false;
    bones.weapon.add(fl);
    // hit zones
    this.zones = zones
      ? ZONES.map((z) => {
          const m = new THREE.Mesh(ZGEO, z.fill);
          m.userData = { figure: this, zone: z };
          m.renderOrder = 5;
          const l = new THREE.LineSegments(ZWIRE, z.wire);
          l.renderOrder = 6;
          m.add(l);
          placeZone(m, z);
          bones[z.bone].add(m);
          return m;
        })
      : [];
    this.mixer = new THREE.AnimationMixer(g);
    this.actions = {};
    for (const k in A.clips) {
      const a = this.mixer.clipAction(A.clips[k]);
      if (ONCE[k.replace('_u', '')]) {
        a.setLoop(THREE.LoopOnce);
        a.clampWhenFinished = true;
      }
      this.actions[k] = a;
    }
    this.mixer.addEventListener('finished', (e) => {
      if (e.action !== this.current || !ONCE[this.shown] || this.shown === 'die') return;
      const was = this.shown;
      if (was === 'deployDrone') {
        // the pack stays on the ground where he put it; he keeps flying
        this.group.parent?.attach(this.parts.pack);
        this.parts.pack.userData.onGround = true;
        this.droneStage = 'flying';
        this.resume = 'droneControl';
        this.play('droneControl', { fade: 0.2 });
        return;
      }
      if (was === 'drawSecondary') {
        this.drawing = false;
        this.armed = true;
      }
      this.onFinished?.(was, this);
      if (this.shown === was) this.play(this.resume || 'idle', { fade: 0.2 });
    });
    this.play('idle', { fade: 0 });
  }
  /** The clip actually played for a name (unarmed versions without a rifle). */
  clipName(name) {
    if (NO_UNARMED[name]) return name;
    if (!this.armed) return (UNARMED_AS[name] ?? name) + '_u';
    if (this.weapon === 'torch') return TORCH_AS[name] ?? name;
    return name === 'flame' ? 'aim' : name;
  }
  /**
   * Deploy the drone from the backpack (needs the pack on his back); then he kneels at the
   * controls. The drone circles over droneTarget (a point; default: 8 m ahead).
   */
  deployDrone() {
    const pack = this.parts.pack;
    if (this.droneFly || pack.userData.pivot || pack.parent !== this.bones.chest || this.shown === 'die') return false;
    this.bones.bag.add(pack);
    pack.position.set(0, 0, 0);
    pack.quaternion.identity();
    this.droneStage = 'deploying';
    this.play('deployDrone', { fade: 0.25 });
    return true;
  }
  updateDrone(dt) {
    const a = this.current;
    const deploying = this.shown === 'deployDrone' && a;
    const at = deploying ? a.time : 0;
    if (deploying) {
      this.drone.visible = !this.droneFly && at > DRONE_T.show;
      this.goggles.visible = at > DRONE_T.goggles;
      this.ctrl.visible = at > DRONE_T.controller;
      if (!this.droneFly && at >= DRONE_T.launch && this.group.parent) {
        // lift-off: from here on it flies on its own
        const scene = this.group.parent;
        this.group.updateMatrixWorld(true);
        scene.attach(this.drone);
        this.droneFly = { t: 0, start: this.drone.position.clone(), ang: 0, v: new THREE.Vector3() };
        this.onDroneLaunch?.(this);
      }
    } else if (this.shown === 'droneControl') {
      this.goggles.visible = this.ctrl.visible = true;
    } else this.goggles.visible = this.ctrl.visible = false;
    const F = this.droneFly;
    if (!F) return;
    F.t += dt;
    const d = this.drone;
    for (const pr of this.props) pr.rotation.y += dt * (F.down ? 0 : 60);
    if (this.shown === 'die' || F.down) {
      // the pilot is down: it falls
      F.down = true;
      F.v.y -= 9.81 * dt;
      d.position.addScaledVector(F.v, dt);
      const gy = this.group.position.y;
      if (d.position.y < gy) {
        d.position.y = gy;
        F.v.set(0, 0, 0);
      }
      return;
    }
    if (F.t < 0.6) return; // spinning up on the ground
    const g = this.group.position;
    const T = this.droneTarget ?? new THREE.Vector3(g.x + Math.sin(this.group.rotation.y) * 8, g.y, g.z + Math.cos(this.group.rotation.y) * 8);
    let goal;
    if (F.t < 2.6) goal = F.start.clone().setY(g.y + 0.1 + 3.4 * sm01((F.t - 0.6) / 2));
    else {
      F.ang += dt * 0.55;
      goal = new THREE.Vector3(T.x + Math.cos(F.ang) * 3.5, g.y + 4, T.z + Math.sin(F.ang) * 3.5);
    }
    const want = goal.sub(d.position);
    const sp = Math.min(4, want.length() * 1.5);
    const vt = want.normalize().multiplyScalar(sp);
    F.v.lerp(vt, Math.min(1, dt * 2));
    d.position.addScaledVector(F.v, dt);
    // banks into its motion, nose along it
    const hv = Math.hypot(F.v.x, F.v.z);
    if (hv > 0.2) d.rotation.y += Math.atan2(Math.sin(Math.atan2(F.v.x, F.v.z) - d.rotation.y), Math.cos(Math.atan2(F.v.x, F.v.z) - d.rotation.y)) * Math.min(1, dt * 3);
    d.rotation.x = Math.min(0.35, hv * 0.08);
  }
  /** Has he a carbine on his back to draw? */
  get hasSecondary() {
    return this.parts.secondary.parent === this.bones.chest && !this.parts.secondary.userData.pivot;
  }
  /** Reach back and draw the carbine (when the rifle is gone). */
  drawSecondary() {
    if (!this.hasSecondary || this.weapon === 'secondary' || this.shown === 'die') return false;
    // it rides on the weapon bone from the start: the clip begins with that bone in the slung pose
    const sec = this.parts.secondary;
    this.bones.weapon.add(sec);
    sec.position.set(0, 0, 0);
    sec.quaternion.identity();
    this.weapon = 'secondary';
    this.drawing = true;
    this.play('drawSecondary', { fade: 0.15 });
    return true;
  }
  play(name, o = {}) {
    if (this.shown === 'die' && name !== 'die' && !o.force) return this;
    const key = this.clipName(name);
    const a = this.actions[key];
    if (!a) return this;
    const fade = o.fade ?? 0.25;
    if (this.current === a && !ONCE[name] && !o.restart) return this;
    if (ONCE[name] && !ONCE[this.shown]) this.resume = this.state;
    a.reset();
    a.setEffectiveTimeScale(o.timeScale ?? 1);
    a.setEffectiveWeight(1);
    a.time = ONCE[name] || o.restart ? 0 : Math.random() * a.getClip().duration;
    a.play();
    if (this.current && this.current !== a) {
      if (fade > 0) this.current.crossFadeTo(a, fade, false);
      else this.current.stop();
    }
    this.current = a;
    this.shown = name;
    if (!ONCE[name]) this.state = name;
    this.released = false;
    return this;
  }
  setArmed(v) {
    if (this.armed === v) return;
    this.armed = v;
    const n = this.shown;
    this.current = null;
    this.play(ONCE[n] && n !== 'die' ? this.state : n, { fade: 0.2, force: n === 'die' });
  }
  setSpeed(k) {
    this.current?.setEffectiveTimeScale(k);
  }
  /** World point the upper body turns to while it moves (null: look where you go). */
  setAim(p) {
    this.aimAt = p ? (Array.isArray(p) ? new THREE.Vector3(p[0], p[1], p[2]) : p.clone()) : null;
  }
  update(dt) {
    this.clock += dt;
    const g = this.group;
    this.mixer.update(dt);
    // upper-body twist towards the aim point while moving (not when it is behind: no spinning)
    let want = 0;
    if (this.aimAt && MOVING[this.state] && AIMING[this.shown]) {
      const dx = this.aimAt.x - g.position.x, dz = this.aimAt.z - g.position.z;
      let dy = Math.atan2(dx, dz) - g.rotation.y;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      if (Math.abs(dy) < NO_TWIST) want = Math.max(-1.15, Math.min(1.15, dy));
    }
    this.twist += (want - this.twist) * Math.min(1, dt * 5);
    if (Math.abs(this.twist) > 1e-3) {
      const q = new THREE.Quaternion().setFromAxisAngle(UP, this.twist * 0.5);
      this.bones.spine.quaternion.premultiply(q);
      this.bones.chest.quaternion.premultiply(q);
    }
    const u = this.mat.userData.uHit;
    if (u.value > 0) u.value = Math.max(0, u.value - dt * 3.5);
    // muzzle flash: told (flashUntil) or from the firing clips
    const a = this.current;
    const hasRifle = this.armed && this.weapon !== 'torch' && (this.weapon === 'secondary' || !this.parts.rifle.userData.pivot);
    const firing = this.autoFlash && (this.shown === 'shoot' || this.shown === 'crouchShoot' || this.shown === 'proneShoot') && a;
    this.flash.position.copy(rl2w(this.weapon === 'secondary' ? 0.82 : 1.03, 0.045, 0));
    if (this.loadout === 'torch') this.updateFlame(dt);
    this.updateDrone(dt);
    const on = hasRifle && ((firing && a.time % 0.12 < 0.04) || this.flashUntil > this.clock);
    this.flash.visible = !!on;
    if (on) {
      this.flash.material.rotation = Math.random() * 6;
      this.flash.scale.setScalar(0.16 + Math.random() * 0.12);
    }
    // the grenade: in the hand, then thrown
    if (this.shown === 'throwGrenade' && a) {
      this.nade.visible = a.time > THROW_HOLD[0] && a.time < THROW_HOLD[1];
      if (!this.released && a.time >= THROW_RELEASE) {
        this.released = true;
        const p = new THREE.Vector3();
        this.nade.getWorldPosition(p);
        this.onRelease?.(p, this);
      }
    } else this.nade.visible = false;
  }
  /** The flame gun: a stream of burning fuel from the nozzle while he fires standing. */
  updateFlame(dt) {
    const firing = this.weapon === 'torch' && this.armed && this.shown === 'flame' && !this.parts.torch.userData.pivot;
    this.flaming = firing;
    const scene = this.group.parent;
    if (!scene) return;
    const pool = this.flames;
    if (firing) {
      const p = this.A.nozzle.clone();
      this.bones.weapon.localToWorld(p);
      const q = new THREE.Quaternion();
      this.bones.weapon.getWorldQuaternion(q);
      const dir = V3(P.R.x).applyQuaternion(q);
      this.nozzleWorld = p;
      this.flameDir = dir;
      for (let k = 0; k < 3; k++) {
        let s = pool.find((x) => !x.visible);
        if (!s && pool.length < 90) {
          s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.A.flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
          pool.push(s);
          scene.add(s);
        }
        if (!s) break;
        s.visible = true;
        s.position.copy(p);
        s.userData.v = dir.clone().multiplyScalar(10 + Math.random() * 3).add(new THREE.Vector3((Math.random() - 0.5) * 1.2, (Math.random() - 0.3) * 1.2, (Math.random() - 0.5) * 1.2));
        s.userData.age = 0;
      }
    }
    for (const s of pool) {
      if (!s.visible) continue;
      s.userData.age += dt;
      const a = s.userData.age;
      if (a > 0.55) {
        s.visible = false;
        continue;
      }
      s.userData.v.y -= 6 * dt;
      s.userData.v.multiplyScalar(1 - 2.2 * dt);
      s.userData.v.y += 3.5 * dt;
      s.position.addScaledVector(s.userData.v, dt);
      s.scale.setScalar(0.12 + a * 2.2);
      s.material.color.setHSL(0.09 - a * 0.12, 1, 0.6 - a * 0.6);
      s.material.opacity = 1 - a / 0.55;
    }
  }
  hitFlash() {
    this.mat.userData.uHit.value = 1;
  }
  /** Muzzle flash for a moment (seconds), for hosts that fire on their own schedule. */
  muzzle(s = 0.06) {
    this.flashUntil = this.clock + s;
  }
  /** Drop a part: it becomes a rigid body in physics (a PhysicsWorld) under scene. */
  detach(name, physics, scene, imp) {
    const obj = this.parts[name];
    if (!obj || obj.userData.pivot) return null;
    this.group.updateMatrixWorld(true);
    if (name === 'rifle') {
      if (this.weapon === 'torch') return null;
      obj.attach(this.parts.mag);
      this.sling.visible = false;
      if (this.weapon === 'primary') this.setArmed(false);
    }
    const box = new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3());
    const pivot = new THREE.Group();
    pivot.position.copy(c);
    scene.add(pivot);
    pivot.updateMatrixWorld();
    pivot.attach(obj);
    pivot.updateMatrixWorld(true);
    const pts = [];
    obj.traverse((m) => {
      if (!m.isMesh || m.geometry === this.A.antenna || this.A.cords.includes(m.geometry)) return;
      m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox;
      for (let i = 0; i < 8; i++) {
        const v = new THREE.Vector3(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z).applyMatrix4(m.matrixWorld);
        pts.push(pivot.worldToLocal(v));
      }
    });
    const b = physics.add(pivot, pts);
    const fwd = new THREE.Vector3(Math.sin(this.group.rotation.y), 0, Math.cos(this.group.rotation.y));
    b.v.copy(imp || fwd.multiplyScalar(1.2).add(new THREE.Vector3(0, 1.8, 0)));
    b.w.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
    obj.userData.pivot = pivot;
    obj.userData.body = b;
    obj.userData.physics = physics;
    return b;
  }
  /** Where a dropped part lies (world), or null. */
  partAt(name) {
    const pv = this.parts[name]?.userData.pivot;
    return pv ? pv.position.clone() : null;
  }
  reequip(names = ['rifle', 'helmet', 'pack']) {
    const pack = this.parts.pack;
    if (names.includes('pack') && (pack.userData.onGround || pack.parent === this.bones.bag)) {
      this.bones.chest.add(pack);
      pack.position.set(0, 0, 0);
      pack.quaternion.identity();
      pack.userData.onGround = false;
    }
    for (const k of names) {
      const obj = this.parts[k], pv = obj.userData.pivot;
      if (!pv) continue;
      this.restParent[k].add(obj);
      obj.position.set(0, 0, 0);
      obj.quaternion.identity();
      obj.scale.set(1, 1, 1);
      pv.parent?.remove(pv);
      obj.userData.physics.remove(obj.userData.body);
      obj.userData.pivot = obj.userData.body = obj.userData.physics = null;
      if (k === 'rifle') {
        const m = this.parts.mag;
        this.restParent.mag.add(m);
        m.position.set(0, 0, 0);
        m.quaternion.identity();
        m.scale.set(1, 1, 1);
        this.sling.visible = true;
        // the carbine goes back over the shoulder
        const sec = this.parts.secondary;
        if (sec.parent === this.bones.weapon) {
          this.bones.chest.add(sec);
          sec.position.copy(this.A.slungPos);
          sec.quaternion.copy(this.A.slungQ);
        }
        this.weapon = 'primary';
        this.setArmed(true);
      }
    }
    return this;
  }
  dispose() {
    for (const s of this.flames ?? []) s.parent?.remove(s);
    this.drone.parent?.remove(this.drone);
    if (this.parts.pack.userData.onGround) this.parts.pack.parent?.remove(this.parts.pack);
    for (const k of ['rifle', 'helmet', 'pack']) {
      const o = this.parts[k];
      if (o.userData.pivot) {
        o.userData.pivot.parent?.remove(o.userData.pivot);
        o.userData.physics.remove(o.userData.body);
      }
    }
    this.group.parent?.remove(this.group);
    this.mat.dispose();
  }
}
