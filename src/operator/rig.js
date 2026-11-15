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
 *    the drone spins up, climbs and circles over its target (droneTarget) while he stays put;
 *    given a droneGoal it flies there instead (scouting), higher and faster.
 *  - Weapon switching (switchWeapon): the rifle goes onto his back, the carbine back over the
 *    shoulder, the combat knife (sheathed on the right thigh) comes out into a fighting stance and
 *    stabs. Each put-away ends and each draw begins with the hands free at his sides. A flash-bang
 *    on the belt, bowled underarm.
 *  - Armour: the plate carrier is a mesh of its own over the shirt (setArmour). setLook bends the
 *    upper body up or down over any clip, the rifle with it. He rappels down a wall on a rope and
 *    peeks down over an edge lying prone.
 *  - Parkour (ai/parkour.js): vaults over a low wall (speed, side, step-over: the left hand
 *    planted, the rifle in the right), a jump climb and a mantle onto a ledge (the rifle swung onto
 *    the back, both hands on the edge), drops (with a landing roll) and a slide into cover. Their
 *    root moves along the move's path (whoever plays them carries the figure along rootAt), so
 *    the body stays on the obstacle whatever its height.
 *  - Primaries (setPrimary): the rifle, a pump shotgun, a pistol, the gunner's machine gun, each
 *    held its own way (WEAPON_STYLE, from ai/weapons.js HANDLING): grips (the shotgun's pump, worked
 *    after every round; the pistol cupped), carry, aim (the pistol square to the target at arm's
 *    length, the flame gun from the hip), reloads; a set of clips baked for each (weaponClips) and
 *    swapped in as the weapon in his hands changes. allows(act): what that weapon lets him do.
 *  - Hit zones: cylinders on the bones (head, torso, pelvis, arms, legs) with a damage
 *    multiplier each, for picking; they can be shown.
 */
import * as THREE from 'three';
import { SC } from './sculpt.js';
import { makeOperatorMaterial } from './shader.js';
import { rootKeys, mono, MOVES as PK_MOVES, PARKOUR } from '../ai/parkour.js';
import { rollKeys, rollAt, ROLLS, ROLL, ROLL_LABELS } from '../ai/evade.js';
import { recoilSpec, recoilAt, pullTime, pumpTimes } from '../ai/recoil.js';
import { allows as handlingAllows } from '../ai/weapons.js';
import { MELEE, REACT } from '../ai/melee.js';
import { PEEK_CLIPS, PEEK_LABELS } from '../ai/peek.js';
import { TORCH_T } from '../ai/flashlight.js';
import { FAST, ZIP } from '../ai/rope.js';
import { RT_T } from '../ai/retreat.js';

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
    aim: 0, recoil: 0, climb: 0, wOff: Z3(), wRot: Z3(), cw: 0, cButt: [-0.13, 1.33, 0.05], cDir: [0, 1, 0], cUp: [0, 0, -1], sling: 0,
    lT: Z3(), lG: 1, lH: 1, lPole: Z3(), rT: Z3(), rG: 1, rH: 1, rPole: Z3(), lMag: 0, lMagOff: Z3(), mag: 0, magFall: -1, magHide: 0,
    // hand targets in figure space (blended in by lW / rW), the backpack (its centre) and the drone
    lTW: Z3(), rTW: Z3(), lW: 0, rW: 0, bagP: PACK_C.slice(), bagR: Z3(), droneP: [0, 1.25, -0.25], droneR: Z3(),
    // the rifle slung across the back (the other diagonal from the carbine); the knife in the right
    // hand: kW turns the hand so the blade points along kDir with its edge towards kEdge (chest
    // space), and the right-hand target becomes the knife's grip instead of the wrist
    sling2: 0, kW: 0, kDir: [0, 0, 1], kEdge: [0, -1, 0],
    // the weapon's handling (ai/weapons.js, WEAPON_STYLE): where on it each hand grips (rifle-local
    // offsets from the rifle's own grips: x along the barrel, y up), and how it is aimed (aOff: the
    // aimed weapon moved, chest space; aYaw: turned, for a stance more square to the target; aPitch:
    // the muzzle raised, as from the hip)
    lGo: Z3(), rGo: Z3(), aOff: Z3(), aYaw: 0, aPitch: 0,
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
// the rifle on the back for the knife or the carbine: butt low on the right, muzzle up over the
// left shoulder, just outside the carbine (which crosses it the other way)
const SL2_DIR = new THREE.Vector3(0.45, 0.89, 0).normalize();
const SL2_UP = new THREE.Vector3(-0.89, 0.45, 0);
const SL2_BUTT = new THREE.Vector3(-0.2, 0.97, -0.435);
// the knife in the fist: held like the pistol grip, the blade out of the top of the fist (the
// grip's axis upwards), the edge where the fingers are
const K_B0 = rl2w(0.343, 0.939, 0);
const K_E0 = rl2w(0.939, -0.343, 0);
const K_GRIP = V3(P.rw(P.pg.c));
const K_G0 = K_GRIP.clone().sub(V3(P.WR));
const KQ0i = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(K_B0, K_E0, K_B0.clone().cross(K_E0))).invert();
/** The hand rotation (chest space) that points the blade along dir with the edge towards edge. */
function knifeQuat(dir, edge) {
  const x = dir.clone().normalize();
  const y = edge.clone().addScaledVector(x, -x.dot(edge)).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, x.clone().cross(y))).multiply(KQ0i);
}
const POLE = { R:[V3([-1, -0.45, -0.35]), V3([-1, -0.7, -0.1])], L: [V3([1, -0.5, -0.25]), V3([0.5, -1, 0])] };
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
    const dir = new THREE.Vector3(Math.sin(AIM_YAW + ps.aYaw), -0.03, Math.cos(AIM_YAW + ps.aYaw)).normalize();
    const side = new THREE.Vector3().crossVectors(dir, UP).normalize();
    // recoil (ai/recoil.js): the muzzle's climb (rad), the kick back into the shoulder (recoil: 1 a rifle round's)
    const qA = new THREE.Quaternion().setFromAxisAngle(side, ps.climb + ps.aPitch).multiply(frameQuat(dir, UP));
    const bA = AIM_BUTT.clone().add(V3(ps.wOff)).add(V3(ps.aOff)).addScaledVector(dir, -0.028 * ps.recoil);
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
  if (ps.sling2 > 0) {
    q.slerp(frameQuat(SL2_DIR, SL2_UP), ps.sling2);
    b.lerp(SL2_BUTT, ps.sling2);
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
  out.reach = {};
  for (const s of ['R', 'L']) {
    const l = s.toLowerCase();
    const S = REST['upperArm' + s], E0 = REST['foreArm' + s], W0 = REST['hand' + s];
    // the wrist where it is on the weapon (moved along it by the weapon's grip: lGo / rGo)
    const go = ps[l + 'Go'];
    const Wg = toW(go[0] || go[1] || go[2] ? W0.clone().add(rl2w(go[0], go[1], go[2])) : W0);
    const T = V3(ps[l + 'T']);
    if (s === 'L' && ps.lMag > 0) T.lerp(magGrab.clone().add(V3(ps.lMagOff)), ps.lMag);
    if (ps[l + 'W'] > 0) T.lerp(toChest(V3(ps[l + 'TW'])), ps[l + 'W']);
    // the knife hand: turned to the blade's direction, the target is where the grip goes
    const qK = s === 'R' && ps.kW > 0 ? knifeQuat(V3(ps.kDir), V3(ps.kEdge)) : null;
    if (qK) T.addScaledVector(K_G0.clone().applyQuaternion(qK), -ps.kW);
    const Wt = T.lerp(Wg, ps[l + 'G']);
    const cp = V3(ps[l + 'Pole']);
    const pole = cp.lengthSq() > 1e-6 ? cp : POLE[s][0].clone().lerp(POLE[s][1], ps.aim);
    const E1 = ikV(S, Wt, 0.29, 0.27, pole);
    // (how far short of its target the hand falls, the arm at full stretch: 0 when it gets there)
    out.reach[s] = Math.max(0, Wt.distanceTo(S) - 0.56);
    const qU = new THREE.Quaternion().setFromUnitVectors(E0.clone().sub(S).normalize(), E1.clone().sub(S).normalize());
    const qF = new THREE.Quaternion().setFromUnitVectors(W0.clone().sub(E0).normalize(), Wt.clone().sub(E1).normalize().applyQuaternion(qU.clone().invert()));
    const qArm = qU.clone().multiply(qF);
    const qHW = qArm.clone().slerp(q, ps[l + 'H']);
    if (qK) qHW.slerp(qK, ps.kW);
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
/**
 * The firing clips for a weapon's recoil R (ai/recoil.js recoilSpec: its kick, its muzzle rise,
 * its recovery, the fire mode's rounds) and the shooter's control (1 a regular; less, a better
 * shot): one trigger pull, the kick back into the shoulder each round, the climb piling up over a
 * burst and pulled down again. [duration, pose(t)] for shoot, crouchShoot, proneShoot.
 */
/* ---------- casualties: down wounded, dragged out, first aid (ai/casualty.js) ---------- */
/**
 * Where the dragged man's root goes, from the rescuer's (both facing the same way: the rescuer
 * looks at him, walking backwards; the casualty lies on his back, his head towards the rescuer,
 * his shoulders in the rescuer's hands): DRAG_OFF m ahead of the rescuer's root.
 */
export const DRAG_OFF = 1.05;
/** The rescuer's hands (figure space) on the casualty's vest collar while dragging. */
const DRAG_HANDS = [[0.13, 0.5, 0.52], [-0.13, 0.5, 0.52]];
/** Lying on his back, hurt: one hand pressed on the wound (the right thigh), a knee up, writhing a little. */
function downPose(p, f, lift = 0) {
  p.hips = [-1.5 + lift, 0.04 * sin(f), 0.05 * sin(f * 0.5)];
  p.hipsPos = [0, -0.8, 0];
  p.spine = [-0.1 - 0.04 * sin(f), 0, 0];
  p.neck = [0.2, 0, 0];
  p.head = [0.35 + 0.06 * sin(f), 0.2 * sin(f * 0.5), 0];
  p.thighR = [-0.55, 0, -0.12]; p.shinR = [1.05, 0, 0]; p.footR = [-0.3, 0, 0];
  p.thighL = [0.05, 0, 0.12]; p.shinL = [0.12, 0, 0]; p.footL = [0.6, 0, 0];
  p.sling = 1; p.lG = 0; p.lH = 0; p.rG = 0; p.rH = 0;
  // the left hand pressing the wound high on the right thigh; the right arm out on the ground
  p.lTW = [-0.1, 0.28 + 0.02 * sin(f), 0.28]; p.lW = 1; p.lPole = [1, 0.3, 0.6];
  p.rTW = [-0.42, 0.1, -0.35]; p.rW = 1;
  return p;
}
const CAS_CLIPS = {
  woundedDown: [2.6, (t, u) => downPose(pose0(), TAU * u)],
  // dragged by the collar: the shoulders lifted off the ground by the pull, the legs trailing, the
  // right arm limp at his side, a hand still on the wound
  dragged: [1.2, (t, u) => {
    const p = downPose(pose0(), TAU * u, 0.32);
    p.hipsPos = [0, -0.84, 0];
    p.thighR = [-0.15, 0, -0.08]; p.shinR = [0.25, 0, 0]; p.thighL = [0.05, 0, 0.08]; p.shinL = [0.1, 0, 0];
    p.footR = [0.5, 0, 0]; p.footL = [0.55, 0, 0];
    p.head = [0.1, 0.12 * sin(TAU * u), 0];
    p.rTW = [-0.3, 0.12, 0.15];
    return p;
  }],
  // the rescuer: bent low, walking backwards, both hands on the casualty's collar, the rifle on his back
  dragCasualty: [1.2, (t, u) => {
    const p = walkLegs(pose0(), -TAU * u, 0.3);
    p.hipsPos[1] -= 0.28; p.hipsPos[2] = 0.05;
    p.thighR[0] -= 0.45; p.thighL[0] -= 0.45; p.shinR[0] += 0.55; p.shinL[0] += 0.55;
    p.footR[0] -= 0.1; p.footL[0] -= 0.1;
    p.spine = [0.65, 0, 0]; p.chest = [0.2, 0, 0]; p.head = [-0.55, 0, 0];
    p.sling = 1; p.lG = 0; p.lH = 0; p.rG = 0; p.rH = 0;
    p.lTW = DRAG_HANDS[0].slice(); p.rTW = DRAG_HANDS[1].slice(); p.lW = 1; p.rW = 1;
    p.lPole = [1, -0.4, -0.3]; p.rPole = [-1, -0.4, -0.3];
    return p;
  }],
  // first aid: kneeling by him, a tourniquet on the leg: both hands working low ahead
  firstAid: [2.0, (t, u) => {
    const p = droneKneel(pose0(), 1);
    const f = TAU * u;
    p.spine = [0.55, 0, 0]; p.head = [-0.35, 0, 0]; p.sling = 1;
    p.lTW = [0.12 + 0.05 * sin(f), 0.3 + 0.04 * sin(2 * f), 0.5]; p.rTW = [-0.06 - 0.05 * sin(f), 0.3 - 0.04 * sin(2 * f), 0.52]; p.lW = 1; p.rW = 1;
    return p;
  }],
};
export const CASUALTY = { woundedDown: 1, dragged: 1, dragCasualty: 1, firstAid: 1, coverFire: 1 };

/* ---------- the retreat (ai/retreat.js): backing off aiming, the fireman's carry, the tripwire ---------- */
/**
 * The fireman's carry. The carried man's root rides on the carrier's, turned a quarter to his left
 * (ai/retreat.js: yaw + PI/2): in his own frame he lies face down across the carrier's shoulders,
 * his belly over the carrier's neck (his hips a hand behind it, towards his legs), his upper body
 * hanging down the carrier's left side, his legs down the right in front, his arms dangling. The
 * carrier: his weapon slung (sling2), a little bent under the load, the right arm round the man's
 * legs holding his wrist at the front, the left hand steadying him on the left shoulder.
 */
function carriedPose(p, f) {
  p.hips = [1.5, 0.03 * sin(f), 0.04 * sin(f)];
  p.hipsPos = [0.04, 0.62 + 0.012 * sin(2 * f), -0.2];
  p.spine = [0.55, 0, 0]; p.chest = [0.45, 0, 0]; p.neck = [0.25, 0, 0]; p.head = [0.25 + 0.06 * sin(f), 0.05 * sin(f), 0];
  p.thighR = [-1.0, 0, -0.06]; p.thighL = [-0.9, 0, 0.06]; p.shinR = [0.55 + 0.08 * sin(f), 0, 0]; p.shinL = [0.62 - 0.08 * sin(f), 0, 0];
  p.footR = [0.45, 0, 0]; p.footL = [0.45, 0, 0];
  p.sling = 1; p.lG = 0; p.lH = 0; p.rG = 0; p.rH = 0;
  p.lTW = [0.14, 0.86 + 0.04 * sin(f), 0.42 + 0.03 * cos(f)]; p.rTW = [-0.1, 0.84 - 0.04 * sin(f), 0.46]; p.lW = 1; p.rW = 1;
  p.lPole = [1, 0, -0.4]; p.rPole = [-1, 0, -0.4];
  return p;
}
function carrierPose(p, f, amp = 0.26) {
  walkLegs(p, f, amp);
  p.hipsPos[1] -= 0.07; p.thighR[0] -= 0.12; p.thighL[0] -= 0.12; p.shinR[0] += 0.22; p.shinL[0] += 0.22;
  p.spine = [0.22, 0.04 * sin(f), 0]; p.chest = [0.05, 0, 0]; p.head = [-0.25, 0, 0];
  handsFree(p);
  p.sling2 = 1;
  p.rTW = [-0.2, 1.32, 0.24]; p.lTW = [0.27, 1.5, -0.04]; p.rW = 1; p.lW = 1;
  p.rPole = [-1, -0.3, -0.5]; p.lPole = [1, 0.4, -0.6];
  return p;
}
/**
 * Up into the carry (the carrier, RT_T.lift s): down into a squat by him, hands under his arms,
 * pulls him up against his chest, dips a shoulder under his middle and stands with him. Played
 * backwards it puts him down again. The casualty's half ('lifted'): from lying, pulled up slumped
 * against the carrier, then over onto the shoulders.
 */
// (built on first use: handsFree needs FREE_R, defined further down)
let LIFT_K0 = null, LIFTED_K0 = null;
const LIFT_K = () => (LIFT_K0 ??= (() => {
  const squat = (e, o) => {
    const p = pose0();
    const c = crouchLegs(pose0());
    for (const k of ['hipsPos', 'thighR', 'thighL', 'shinR', 'shinL', 'footR', 'footL']) p[k] = c[k].map((v) => v * e);
    handsFree(p);
    p.sling2 = 1;
    p.lW = p.rW = 1;
    return Object.assign(p, o);
  };
  return [
    [0, squat(0, { lW: 0, rW: 0, lTW: [0.25, 0.97, 0.07], rTW: [-0.25, 0.97, 0.07] })],
    [0.7, squat(1, { spine: [0.6, 0, 0], head: [-0.2, 0, 0], lTW: [0.2, 0.35, 0.35], rTW: [-0.2, 0.35, 0.35] })],
    [1.5, squat(0.75, { spine: [0.35, 0, 0], head: [-0.1, 0, 0], lTW: [0.25, 1.0, 0.25], rTW: [-0.2, 0.9, 0.3] })],
    [2.0, squat(0.45, { spine: [0.45, 0, 0.1], head: [-0.2, 0, 0], lTW: [0.27, 1.25, 0.05], rTW: [-0.2, 1.1, 0.28] })],
    [RT_T.lift, carrierPose(pose0(), 0, 0)],
  ];
})());
const LIFTED_K = () => (LIFTED_K0 ??= [
  [0, downPose(pose0(), 0)],
  [0.7, downPose(pose0(), 0)],
  [1.5, Object.assign(downPose(pose0(), 0), { hips: [0.3, 0, 0], hipsPos: [0, -0.3, 0.05], spine: [0.5, 0, 0], neck: [0.3, 0, 0], head: [0.5, 0, 0], thighR: [-0.3, 0, -0.06], thighL: [-0.3, 0, 0.06], shinR: [0.7, 0, 0], shinL: [0.7, 0, 0], footR: [0.2, 0, 0], footL: [0.2, 0, 0], lTW: [0.18, 0.65, 0.3], rTW: [-0.18, 0.65, 0.3], lW: 1, rW: 1 })],
  [2.0, Object.assign(carriedPose(pose0(), 0), { hips: [1.0, 0, 0], hipsPos: [0.04, 0.3, -0.1] })],
  [RT_T.lift, carriedPose(pose0(), 0)],
]);
/**
 * The tripwire (RT_T.wire s): kneeling just past the doorway, facing back through it, his weapon
 * slung: the charge out of the pouch on his right hip, onto the right-hand jamb low down and
 * pressed home; the wire's end from the charge, run across to the left-hand jamb low, pulled taut
 * and tied off; up off the ground with his hands.
 */
const WIRE_HANDS = [
  // t, right hand, left hand, lean (to the side the work is on: + left)
  [0, [-0.25, 0.97, 0.07], [0.25, 0.97, 0.07], 0],
  [0.6, [-0.22, 0.95, -0.05], [0.2, 0.9, 0.2], 0],
  [1.2, [-0.38, 0.26, 0.55], [-0.22, 0.3, 0.55], -0.12],
  [1.8, [-0.4, 0.24, 0.56], [-0.26, 0.27, 0.56], -0.14],
  [2.4, [-0.38, 0.25, 0.55], [-0.3, 0.22, 0.55], -0.14],
  [2.8, [-0.38, 0.24, 0.55], [-0.36, 0.2, 0.56], -0.12],
  [4.0, [-0.3, 0.25, 0.5], [0.48, 0.18, 0.5], 0.14],
  [4.6, [0.36, 0.2, 0.52], [0.5, 0.18, 0.5], 0.16],
  [4.9, [0.4, 0.22, 0.5], [0.46, 0.2, 0.52], 0.15],
  [RT_T.wire, [-0.2, 0.6, 0.35], [0.2, 0.6, 0.35], 0],
];
function wirePose(t) {
  const p = droneKneel(pose0(), sm01(t / 0.5));
  handsFree(p);
  p.sling2 = 1;
  const K = (j) => WIRE_HANDS.map((k) => [k[0], Array.isArray(k[j]) ? k[j] : [k[j]]]);
  p.rTW = pathK(K(1), t); p.lTW = pathK(K(2), t);
  const lean = pathK(K(3), t)[0];
  // the fingers at work: a little to and fro while fixing and tying
  const work = env(t, 1.2, 1.4, 2.4, 2.7) + env(t, 4.5, 4.6, 4.9, 5.0);
  p.rTW[0] += 0.015 * work * sin(t * 22); p.lTW[2] += 0.012 * work * sin(t * 19);
  p.rW = p.lW = env(t, 0, 0.3, RT_T.wire - 0.2, RT_T.wire + 1);
  p.spine = [0.45 * env(t, 0.6, 1.2, RT_T.wire - 0.4, RT_T.wire), 0, -lean * 0.8];
  p.chest = [0.15, 0, -lean * 0.6];
  p.head = [0.2, lean * 1.6, 0];
  p.rPole = [-1, -0.6, -0.4]; p.lPole = [1, -0.6, -0.4];
  return p;
}
const RETREAT_CLIPS = {
  // backing away from the threat, crouched a little, the weapon up at it (the upper body turned to
  // the aim like aimWalk): the walk cycle run backwards
  aimWalkBack: [1.3, (t, u) => {
    const p = walkLegs(pose0(), -TAU * u, 0.26), f = TAU * u;
    p.hipsPos[1] -= 0.1; p.thighR[0] -= 0.2; p.thighL[0] -= 0.2; p.shinR[0] += 0.32; p.shinL[0] += 0.32;
    p.spine[0] = 0.12;
    aimUpper(p, 1); p.wOff = [0, 0.005 * sin(2 * f), 0];
    return p;
  }],
  fireCarry: [1.5, (t, u) => carrierPose(pose0(), TAU * u)],
  carried: [1.5, (t, u) => carriedPose(pose0(), TAU * u)],
  liftCasualty: [RT_T.lift, (t) => keyed(LIFT_K(), t)],
  lifted: [RT_T.lift, (t) => keyed(LIFTED_K(), t)],
  putDownCasualty: [RT_T.putDown, (t) => keyed(LIFT_K(), RT_T.lift * (1 - t / RT_T.putDown))],
  setDown: [RT_T.putDown, (t) => keyed(LIFTED_K(), RT_T.lift * (1 - t / RT_T.putDown))],
  setTripwire: [RT_T.wire, (t) => wirePose(t)],
  // the hand signal to fall back (ai/retreatRadio.js): the left arm straight up, the hand circling
  // over the helmet (rally), then swept back over the shoulder to the rear, the weapon in the right
  signalFallBack: [RT_T.signal, (t) => {
    const p = stance(pose0());
    const g = env(t, 0.05, 0.3, RT_T.signal - 0.3, RT_T.signal - 0.02);
    const a = TAU * 2 * Math.min(1, Math.max(0, (t - 0.3) / 1.0)); // two circles
    const back = env(t, 1.25, 1.5, RT_T.signal - 0.3, RT_T.signal + 1);
    p.lG = 1 - g; p.lH = 0; p.lPole = [1, 0.2, -0.2];
    const up = [0.12 + 0.1 * cos(a), 2.02, 0.04 + 0.1 * sin(a)], rear = [0.36, 1.55, -0.32];
    p.lT = up.map((v, i) => v + (rear[i] - v) * back);
    p.head = [0, 0.4 * g, 0]; p.chest = [0, 0.12 * g, 0]; p.wOff = [0, -0.04 * g, 0];
    return p;
  }],
};
/** The retreat's clips that place the weapons themselves (slung) or hold none. */
export const RETREAT = { fireCarry: 1, carried: 1, liftCasualty: 1, lifted: 1, putDownCasualty: 1, setDown: 1, setTripwire: 1 };
const RETREAT_ONCE = { signalFallBack: 1, liftCasualty: 1, lifted: 1, putDownCasualty: 1, setDown: 1, setTripwire: 1 };
const RETREAT_LABELS = { signalFallBack: 'Sig: fall back (rally, to the rear)', aimWalkBack: 'Aim-walk backwards', fireCarry: "Fireman's carry (carrier + casualty)", carried: 'Carried (casualty)', liftCasualty: 'Lift casualty (into the carry)', lifted: 'Lifted (casualty)', putDownCasualty: 'Put casualty down', setDown: 'Set down (casualty)', setTripwire: 'Set a tripwire (kneel, fix, string)' };

const SHOOT_CACHE = new Map();
export function shootClips(R = recoilSpec('rifle'), control = 1) {
  const dur = pullTime(R);
  // a pump action: after the round the support hand runs the pump back and forward along the barrel
  const pt = pumpTimes(R);
  const pump = (p, t) => {
    if (pt) p.lGo[0] -= PUMP_STROKE * env(t, pt[0], pt[0] + 0.42 * R.pump, pt[0] + 0.55 * R.pump, pt[1]);
    return p;
  };
  return {
    shoot: [dur, (t) => {
      const p = stance(pose0());
      aimUpper(p, 1);
      const { kick: r, climb } = recoilAt(R, t, control);
      p.recoil = r; p.climb = climb; p.chest[0] -= 0.03 * r + 0.3 * climb; p.head[0] -= 0.02 * r;
      return pump(p, t);
    }],
    crouchShoot: [dur, (t) => {
      const p = crouchLegs(pose0());
      p.spine[0] = 0.12; p.head[0] = -0.1; aimUpper(p, 1);
      const { kick: r, climb } = recoilAt(R, t, control);
      p.recoil = r; p.climb = climb; p.chest[0] -= 0.03 * r + 0.3 * climb;
      return pump(p, t);
    }],
    proneShoot: [dur, (t) => {
      const p = prone(pose0());
      const { kick: r, climb } = recoilAt(R, t, control);
      // (lying on it: the muzzle climbs off the ground ahead, the shoulder takes the kick)
      p.wOff = [0, -0.03 * r, -0.012 * r - 0.4 * climb]; p.head[0] -= 0.03 * r;
      return pump(p, t);
    }],
  };
}
/** How far the pump runs back along the barrel (m). */
export const PUMP_STROKE = 0.095;
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

/* ---------- weapons: the rifle slung, the carbine, the knife; the flash-bang ---------- */
/** The magazine change (s, at speed 1). */
export const RELOAD_TIME = 2.8;
const PUT_T = 0.8; // putting a weapon away: the rifle slung, the carbine over the shoulder, the knife sheathed
const DRAW_T = { rifle: 1.0, secondary: 1.2, knife: 0.8 };
/** Seconds to switch to a weapon from another (put that one away, then draw this one). */
export const SWITCH_TIME = { rifle: PUT_T + DRAW_T.rifle, secondary: PUT_T + DRAW_T.secondary, knife: PUT_T + DRAW_T.knife };
/** The hand closes on the knife in drawKnife, and lets go of it in sheathKnife (s). */
export const KNIFE_T = { grab: 0.3 };
KNIFE_T.release = PUT_T * (1 - KNIFE_T.grab / DRAW_T.knife);
/** When the blade lands in stab (s). */
export const STAB_HIT = 0.36;
/** When the flash-bang leaves the hand, and when it is in it (s into throwFlash). */
export const THROW_FLASH_RELEASE = 1.0;
export const FLASH_HOLD = [0.25, 1.0];
/**
 * Rappelling: the figure faces the wall, which is `wall` m ahead of its root; rappelStart begins
 * standing on the roof `top` m above the root, and rappelEnd ends standing on the ground at the
 * root. Over a peek-over edge (peekOver, peekOverAim) the edge is `peekEdge` m ahead of the root.
 */
export const RAPPEL = { wall: 0.56, top: 1.0, peekEdge: 0.25 };
// the knife's grip in its sheath on the right thigh (blade down), as the standing hand finds it
const KNIFE_SHEATH = [-0.205, 1.0, -0.065];
const FREE_R = [-0.25, 0.97, 0.07], FREE_L = [0.25, 0.97, 0.07];
/** Hands free at his sides: where every put-away ends and every draw begins. */
function handsFree(p) {
  p.rG = p.lG = p.rH = p.lH = 0;
  p.rT = FREE_R.slice();
  p.lT = FREE_L.slice();
  return p;
}
/**
 * Putting the rifle on the back (u: 0 at the ready .. 1 slung): muzzle up in front of the right
 * shoulder, round his right side, onto the sling across the back. The left hand lets go first,
 * the right once the rifle is behind him.
 */
function holster(u) {
  const p = stance(pose0());
  const k = (a, b) => pathK([[0, a], [0.35, a], [0.65, b], [1, b]], u);
  p.cw = sm01(u / 0.35);
  p.cButt = k([-0.22, 1.0, 0.3], [-0.36, 0.95, -0.05]);
  p.cDir = k([0, 1, 0.12], [0.05, 1, -0.25]);
  p.cUp = k([0, 0, -1], [-0.7, 0, -0.7]);
  p.sling2 = sm01((u - 0.6) / 0.4);
  p.rG = p.rH = 1 - sm01((u - 0.5) / 0.3);
  p.lG = p.lH = 1 - sm01(u / 0.25);
  p.rT = FREE_R.slice();
  p.lT = FREE_L.slice();
  p.head = [0, -0.3 * env(u, 0.25, 0.45, 0.7, 0.95), 0];
  return p;
}
/** The knife fighting stance: left foot forward, knees bent, weight forward; the knife low and forward, edge down, the free hand up guarding. */
function knifeStance(p, f = 0) {
  const b = sin(f);
  p.hipsPos = [0, -0.1 - 0.008 * b, 0.03];
  p.thighL = [-0.6, 0, 0.1]; p.shinL = [0.85, 0, 0]; p.footL = [-0.25, 0, 0];
  p.thighR = [0.3, 0, -0.12]; p.shinR = [0.35, 0, 0]; p.footR = [-0.65, 0, 0];
  p.spine = [0.2, 0.1, 0]; p.chest = [0.06 + 0.015 * b, 0.06, 0]; p.neck = [-0.08, 0, 0]; p.head = [-0.2, -0.14, 0];
  p.sling2 = 1;
  p.rG = p.lG = p.rH = p.lH = 0;
  p.kW = 1; p.kDir = [0.05, 0.3, 1]; p.kEdge = [0.15, -1, 0.3];
  p.rT = [-0.15, 1.1 + 0.008 * b, 0.36]; p.lT = [0.1, 1.42 + 0.01 * sin(f + 1), 0.3];
  p.rPole = [-1, -0.7, -0.2]; p.lPole = [1, -0.8, -0.3];
  return p;
}
/** Drawing the knife (t s): the right hand down to the sheath, the knife out and up into the stance. */
function knifeDraw(t) {
  const u = t / DRAW_T.knife, g = KNIFE_T.grab / DRAW_T.knife, m = (g + 1) / 2;
  const K = knifeStance(pose0());
  const p = lerpPose(stance(pose0()), K, sm01((t - KNIFE_T.grab) / (DRAW_T.knife - KNIFE_T.grab)));
  p.sling2 = 1;
  p.rG = p.lG = p.rH = p.lH = 0;
  p.kW = sm01(t / 0.22);
  const sh = KNIFE_SHEATH;
  p.rT = pathK([[0, FREE_R], [g, sh], [m, [-0.24, 1.12, 0.14]], [1, K.rT]], u);
  p.kDir = pathK([[0, [0, -1, 0]], [g, [0, -1, 0]], [m, [0, 0.3, 1]], [1, K.kDir]], u);
  p.kEdge = pathK([[0, [0, 0, 1]], [g, [0, 0, 1]], [m, [0, -1, 0.3]], [1, K.kEdge]], u);
  p.rPole = pathK([[0, [-1, -0.45, -0.35]], [g, [-1, 0.1, -0.6]], [1, K.rPole]], u);
  p.lT = lerpA(FREE_L, K.lT, sm01((t - 0.15) / 0.6));
  p.lPole = lerpA([1, -0.5, -0.25], K.lPole, sm01((t - 0.15) / 0.6));
  return p;
}
/** The lunge: chamber the knife back, step in off the front foot and drive it in at chest height, recover. */
function stabPose(t) {
  const p = knifeStance(pose0());
  const ch = env(t, 0, 0.12, 0.16, 0.26), th = env(t, 0.16, STAB_HIT, 0.42, 0.7);
  p.rT = lerpA(lerpA(p.rT, [-0.2, 1.16, 0.2], ch), [-0.3, 1.62, 0.55], th);
  p.kDir = lerpA(p.kDir, [0.08, 0.12, 1], th);
  p.kEdge = lerpA(p.kEdge, [0.1, -1, 0.12], th);
  p.lT = lerpA(p.lT, [0.17, 1.35, 0.16], th);
  p.spine[1] += 0.2 * th - 0.08 * ch; p.chest[1] += 0.1 * th; p.head[1] -= 0.4 * th; p.spine[0] += 0.04 * th;
  p.hipsPos = [0, -0.1 - 0.07 * th, 0.03 + 0.2 * th];
  p.thighL[0] -= 0.3 * th; p.shinL[0] += 0.15 * th; p.footL[0] += 0.15 * th;
  p.thighR[0] += 0.25 * th; p.shinR[0] -= 0.1 * th; p.footR[0] -= 0.15 * th;
  return p;
}
// the flash-bang, underarm: the right hand to the belt, up to the chest (the pin), swing back low, bowl it
const FLASH_K = [[0, [-0.2, 1.02, 0.14]], [0.25, [-0.13, 0.97, 0.13]], [0.45, [-0.08, 1.28, 0.28]], [0.8, [-0.26, 0.86, -0.2]], [1.0, [-0.14, 0.98, 0.42]], [1.15, [-0.08, 1.2, 0.55]], [1.6, [-0.2, 1.05, 0.15]]]
  .map(([k, v]) => [k / 1.6, v]);
/** On the rope: leaning back from the wall, feet flat on it; u: one bound (knees in, push off, swing out and back, land). */
function rappelPose(p, u) {
  const crouch = env(u, 0, 0.15, 0.2, 0.32), out = sin(Math.PI * sm01((u - 0.22) / 0.62)), land = env(u, 0.78, 0.86, 0.88, 1);
  const bend = crouch + 0.5 * land + 0.25 * out;
  p.hips = [-0.6 + 0.1 * out, 0, 0];
  const hz = -0.3 + 0.08 * crouch - 0.3 * out;
  p.hipsPos = [0, -0.1, hz];
  for (const [s, z] of [['R', -0.08], ['L', 0.08]]) {
    p['thigh' + s] = [-0.6 - 0.35 * bend, 0, z];
    p['shin' + s] = [0.2 + 0.7 * bend, 0, 0];
    p['foot' + s] = [-1.57 - p.hips[0] - p['thigh' + s][0] - p['shin' + s][0], 0, 0]; // soles flat on the wall
  }
  p.spine = [0.1, 0, 0]; p.chest = [0.05, 0, 0]; p.head = [0.35 + 0.2 * out, -0.5 * out, 0];
  p.sling2 = 1;
  handsFree(p);
  // the guide hand high on the rope, the brake hand low behind the hip (it eases off in the swing)
  p.lW = p.rW = 1;
  p.lTW = [0.05, 1.42, hz + 0.25];
  p.rTW = [-0.26 - 0.04 * out, 0.74, hz - 0.18 + 0.1 * out];
  p.lPole = [1, -0.5, -0.3]; p.rPole = [-1, 0, -0.5];
  return p;
}
const RAPPEL_START = (() => {
  const top = RAPPEL.top;
  const rope = (p) => {
    p.sling2 = 1;
    handsFree(p);
    p.lT = [0.06, 1.3, 0.38]; p.rT = [-0.22, 0.9, -0.15]; p.lPole = [1, -0.5, -0.3]; p.rPole = [-1, 0, -0.5];
    return p;
  };
  // standing on the roof, back to the drop; sitting back into the rope at the edge; feet onto the wall
  const k0 = rope(stance(pose0()));
  k0.hipsPos = [0, top - 0.02, 0.85];
  const k1 = rope(J({ hips: [-0.5, 0, 0], hipsPos: [0, top - 0.21, 0.25], thighR: [-0.5, 0, -0.08], thighL: [-0.5, 0, 0.08], shinR: [1.2, 0, 0], shinL: [1.2, 0, 0], footR: [-0.2, 0, 0], footL: [-0.2, 0, 0], spine: [0.15, 0, 0], head: [0.3, 0, 0] }));
  const k2 = rappelPose(pose0(), 0);
  Object.assign(k2, { hipsPos: [0, 0.35, -0.2], thighR: [-0.6, 0, -0.08], thighL: [-0.6, 0, 0.08], shinR: [0.55, 0, 0], shinL: [0.55, 0, 0], footR: [-0.92, 0, 0], footL: [-0.92, 0, 0], head: [0.4, 0, 0] });
  k2.lTW = [0.05, 1.7, -0.05]; k2.rTW = [-0.26, 1.05, -0.38];
  return [[0, k0], [0.7, k1], [1.2, k2], [1.8, rappelPose(pose0(), 0)]];
})();
const RAPPEL_END = (() => {
  const k1 = rappelPose(pose0(), 0);
  Object.assign(k1, { hips: [-0.15, 0, 0], hipsPos: [0, -0.04, -0.12], thighR: [0.05, 0, -0.08], thighL: [0.05, 0, 0.08], shinR: [0.15, 0, 0], shinL: [0.15, 0, 0], footR: [-0.05, 0, 0], footL: [-0.05, 0, 0], head: [0.2, 0, 0] });
  k1.lTW = [0.05, 1.42, 0.12]; k1.rTW = [-0.26, 0.85, -0.22];
  // unclipping: both hands at the harness, eyes on it
  const k2 = handsFree(stance(pose0()));
  Object.assign(k2, { sling2: 1, head: [0.4, 0, 0], lT: [0.05, 0.96, 0.21], rT: [-0.05, 0.96, 0.21], lPole: [1, -0.6, -0.4], rPole: [-1, -0.6, -0.4] });
  const k3 = handsFree(stance(pose0()));
  k3.sling2 = 1;
  return [[0, rappelPose(pose0(), 0)], [0.6, k1], [1.0, k2], [1.4, k3]];
})();
/*
 * Fast rope, zipline (ai/rope.js FAST, ZIP: the root is his feet; the rope runs down in front of
 * the chest ROPE_FRONT m ahead, a cable ROPE_HANG m over the root). The rifle slung on the back.
 */
export const ROPE_FRONT = FAST.front, ROPE_HANG = ZIP.hang, ROPE_GRIP = FAST.grip;
/** Fast-roping (u: one cycle): both hands on the rope in front of the face, the left above, knees up and the rope clamped between the boots; the grip eases and clamps, the body sways a little. */
function fastRopePose(p, u) {
  const f = TAU * u, s = sin(f), z = ROPE_FRONT;
  p.sling2 = 1;
  handsFree(p);
  // (squatting on the rope: the boots at the root, so they meet the ground as he lands)
  p.hipsPos = [0, -0.32 + 0.015 * s, -0.04];
  p.hips = [-0.12, 0.04 * s, 0];
  p.spine = [0.08, 0, 0]; p.chest = [0.04, 0, 0]; p.neck = [0.1, 0, 0]; p.head = [0.32 + 0.04 * s, 0.15 * sin(f * 0.5), 0];
  // the feet round the rope: the right instep under it, the left boot pressing on it from above
  p.thighR = [-0.75, 0, -0.03]; p.shinR = [1.05, 0, 0]; p.footR = [0.25, 0, 0];
  p.thighL = [-0.95, 0, 0.06]; p.shinL = [1.25, 0, 0]; p.footL = [0.1, 0, 0];
  p.lW = p.rW = 1;
  p.lTW = [0.03, ROPE_GRIP + 0.02 * s, z]; p.rTW = [-0.04, ROPE_GRIP - 0.26 - 0.02 * s, z];
  p.lPole = [1, -0.6, -0.2]; p.rPole = [-1, -0.6, -0.2];
  return p;
}
/** On the zipline: hanging from the pulley by both hands overhead, knees a little up, swaying along the cable. */
function ziplinePose(p, u) {
  const f = TAU * u, s = sin(f);
  p.sling2 = 1;
  handsFree(p);
  p.hips = [-0.25 + 0.06 * s, 0, 0];
  // (the knees up: the boots just over the root, so they meet the ground as he lets go)
  p.hipsPos = [0, -0.22, -0.06 * s];
  p.spine = [0.05, 0, 0]; p.chest = [-0.08, 0, 0]; p.neck = [0.05, 0, 0]; p.head = [-0.12, 0, 0];
  p.thighR = [-0.45, 0, -0.05]; p.shinR = [0.75, 0, 0]; p.footR = [0.35, 0, 0];
  p.thighL = [-0.55, 0, 0.05]; p.shinL = [0.85, 0, 0]; p.footL = [0.35, 0, 0];
  p.lW = p.rW = 1;
  p.lTW = [0.06, ROPE_HANG - 0.07, 0.02]; p.rTW = [-0.06, ROPE_HANG - 0.07, -0.02];
  p.lPole = [1, 0, 0.3]; p.rPole = [-1, 0, 0.3];
  return p;
}
/** Hand over hand along a cable too flat to run down: one hand reaching forward while the other pulls, the body swinging under. */
function zipHandPose(p, u) {
  ziplinePose(p, 0);
  // each hand: half a cycle gripping (sliding back as he goes forward), half reaching forward again
  const hand = (ph) => {
    const v = (u + ph) % 1;
    return v < 0.5 ? [0.25 - v, ROPE_HANG - 0.07] : [-0.25 + (v - 0.5) * 1.0, ROPE_HANG - 0.1 - 0.06 * sin(TAU * (v - 0.5))];
  };
  const [lz, ly] = hand(0), [rz, ry] = hand(0.5);
  p.lTW = [0.06, ly, lz]; p.rTW = [-0.06, ry, rz];
  p.hips[1] = 0.12 * sin(TAU * u * 2);
  p.chest[1] = -0.1 * sin(TAU * u * 2);
  p.thighR[0] = -0.3 - 0.2 * sin(TAU * u); p.thighL[0] = -0.3 + 0.2 * sin(TAU * u);
  return p;
}
/** Falling off a rope: arms flung up, legs bent and kicking. */
function ropeFallPose(p, u) {
  const f = TAU * u, s = sin(f);
  p.sling2 = 1;
  handsFree(p);
  p.hips = [-0.3, 0, 0.1 * s]; p.spine = [-0.15, 0, 0]; p.chest = [-0.1, 0.1 * s, 0]; p.head = [-0.3, 0, 0];
  p.thighR = [-0.6 - 0.4 * s, 0, -0.15]; p.shinR = [0.9 + 0.3 * s, 0, 0]; p.footR = [0.2, 0, 0];
  p.thighL = [-0.6 + 0.4 * s, 0, 0.15]; p.shinL = [0.9 - 0.3 * s, 0, 0]; p.footL = [0.2, 0, 0];
  p.lT = [0.45, 1.75 + 0.1 * s, 0.1]; p.rT = [-0.45, 1.75 - 0.1 * s, 0.1];
  p.lPole = [1, -0.3, -0.5]; p.rPole = [-1, -0.3, -0.5];
  return p;
}
/** Prone at an edge, head and shoulders out over it, looking down (about 60 degrees); aim: the rifle down at the shoulder too. */
function peek(p, f, aim) {
  prone(p);
  p.spine = [0.25, 0.04 * sin(f), 0]; p.chest = [0.35, 0, 0]; p.neck = [-0.2, 0, 0];
  p.head = [-0.8 + (aim ? 0 : 0.06 * sin(2 * f)), aim ? 0.12 : 0.35 * sin(f), 0];
  p.cButt = aim ? [-0.13, 1.3, -0.03] : [-0.1, 1.24, 0.02];
  p.cDir = aim ? [0.04, 1, 0.48] : [0.08, 1, 0.12];
  p.wOff = aim ? [0.003 * sin(f), 0, 0.002 * sin(2 * f)] : [0, 0, 0];
  return p;
}

/* ---------- parkour: vaults, climbs, drops, the slide into cover (ai/parkour.js) ---------- */
/**
 * A parkour clip from key poses laid out in the obstacle's frame (z forward from where the move
 * starts, y up from the floor it starts on, for the move's nominal obstacle: ai/parkour.js
 * MOVES[kind].geo). Each key: [t (s), pose, { hp: [x, y, z] the hips there (absolute in that
 * frame), lp / rp: [x, y, z] a hand planted there (figure space, absolute too) }]. The poses are
 * blended smoothly (monotone cubic per channel) and the root's path (ai/parkour.js rootAt) is
 * taken off, so the clip plays on a root that the AI (or the rig stage) carries along that path;
 * over a higher or lower obstacle the root path changes and the body goes with it.
 */
function pkClip(kind, build) {
  let keys = null, RF, RU;
  return (t) => {
    if (!keys) {
      const R = rootKeys(kind);
      RF = R.map((k) => [k[0], k[1]]);
      RU = R.map((k) => [k[0], k[2]]);
      keys = build().map(([kt, p, o = {}]) => {
        if (o.hp) p.hipsPos = [o.hp[0], o.hp[1] - REST.hips.y, o.hp[2]];
        if (o.lp) (p.lTW = o.lp.slice()), (p.lW = o.lw ?? 1);
        if (o.rp) (p.rTW = o.rp.slice()), (p.rW = o.rw ?? 1);
        return [kt, p];
      });
      // a hand not planted at a key keeps the plant's place (so it blends in and out there)
      for (const s of ['l', 'r']) {
        const planted = keys.filter(([, p]) => p[s + 'W'] > 0);
        for (const [kt, p] of keys)
          if (!(p[s + 'W'] > 0) && planted.length) {
            const n = planted.reduce((a, b) => (Math.abs(b[0] - kt) < Math.abs(a[0] - kt) ? b : a));
            p[s + 'TW'] = n[1][s + 'TW'].slice();
          }
      }
    }
    const p = pose0();
    for (const k in p) {
      if (Array.isArray(p[k])) p[k] = p[k].map((_, i) => mono(keys.map(([kt, kp]) => [kt, kp[k][i]]), t));
      else p[k] = mono(keys.map(([kt, kp]) => [kt, kp[k]]), t);
    }
    const u = t / PK_MOVES[kind].dur, f = mono(RF, u), up = mono(RU, u);
    p.hipsPos = [p.hipsPos[0], p.hipsPos[1] - up, p.hipsPos[2] - f];
    p.lTW = [p.lTW[0], p.lTW[1] - up, p.lTW[2] - f];
    p.rTW = [p.rTW[0], p.rTW[1] - up, p.rTW[2] - f];
    return p;
  };
}
/** Key-pose helpers: a base pose with changes; the hips where the base had them, moved to z (and up y). */
const PK = (base, o) => Object.assign(base, o);
const runAt = (u) => CLIPS.run[1](0, u);
const walkAt = (u) => CLIPS.walk[1](0, u);
const HY = REST.hips.y; // the hips' height standing
// the rifle in the right hand alone (the left is free to plant): run-style carry, muzzle low
const ONE_HAND = { lG: 0, lH: 0, rG: 1, rH: 1, wOff: [0.0, 0.0, 0.03], wRot: [0.25, 0.05, 0.08] };
// both hands free, the rifle swung onto the back on its sling
const SLUNG = { sling: 1, lG: 0, lH: 0, rG: 0, rH: 0 };
const flat = (p, s) => (p['foot' + s] = [-(p.hips[0] + p['thigh' + s][0] + p['shin' + s][0]), 0, 0]);
const legs = (p, tr, sr, tl, sl, zr = 0, zl = 0) => {
  p.thighR = [tr, 0, zr]; p.shinR = [sr, 0, 0]; p.thighL = [tl, 0, zl]; p.shinL = [sl, 0, 0];
  flat(p, 'R'); flat(p, 'L');
  return p;
};
const PK_KEYS = {
  // speed vault: run in, plant the left hand, legs tucked and swung over on the right side, the
  // rifle in the right hand out for balance, land on the right foot and run on
  vaultSpeed: () => [
    [0, runAt(0), { hp: [0, HY - 0.05, 0] }],
    [0.22, PK(legs(J({ ...ONE_HAND, spine: [0.45, 0, 0], head: [-0.3, 0, 0], lPole: [1, 0.2, -0.6] }), 0.4, 0.35, -1.2, 1.3, 0, 0.1), {}),
      { hp: [0, HY - 0.12, 0.5], lp: [0.12, 0.93, 0.82], lw: 0.85 }],
    [0.42, PK(legs(J({ ...ONE_HAND, hips: [0.1, 0.45, -0.35], spine: [0.25, 0, -0.1], head: [-0.1, -0.35, 0.1], lPole: [1, 0.3, -0.4], wOff: [-0.05, 0.08, 0.05] }), -1.4, 1.2, -1.3, 1.4, -0.6, -0.35), {}),
      { hp: [-0.15, 0.9 + 0.3, 0.95], lp: [0.12, 0.93, 0.82] }],
    [0.62, PK(legs(J({ ...ONE_HAND, hips: [0.05, 0.15, 0], spine: [0.3, 0, 0], head: [-0.2, 0, 0], lT: [0.3, 1.2, 0.25], lPole: [1, -0.2, -1] }), -0.6, 0.6, 0.1, 0.9, -0.05, 0.1), {}),
      { hp: [0, HY - 0.12, 1.45] }],
    [0.95, runAt(0.5), { hp: [0, HY - 0.05, 1.9] }],
  ],
  // side vault, one hand: slower and upright, the body turned side-on, both legs swung over
  // together, the rifle held off to the side in the right hand
  vaultSide: () => [
    [0, walkAt(0), { hp: [0, HY, 0] }],
    [0.28, PK(legs(J({ ...ONE_HAND, spine: [0.35, 0, 0], head: [-0.25, 0, 0], lPole: [1, 0.2, -0.6] }), 0.25, 0.3, -0.5, 0.4), {}),
      { hp: [0, HY - 0.1, 0.4], lp: [0.15, 0.93, 0.72] }],
    [0.58, PK(legs(J({ ...ONE_HAND, hips: [0, 1.0, -0.2], spine: [0.15, -0.3, 0], head: [0, -0.6, 0], lPole: [1, 0.4, -0.2], wOff: [-0.06, 0.1, 0.04] }), -1.45, 0.5, -1.4, 0.6, -0.25, -0.1), {}),
      { hp: [-0.1, 0.9 + 0.27, 0.8], lp: [0.15, 0.93, 0.72] }],
    [0.83, PK(legs(J({ ...ONE_HAND, hips: [0, 0.4, 0], spine: [0.2, -0.1, 0], head: [-0.1, -0.2, 0] }), -0.5, 0.7, -0.1, 0.6, 0, 0.05), {}),
      { hp: [0, HY - 0.15, 1.35], lp: [0.15, 0.93, 0.72], lw: 0.15 }],
    [1.15, walkAt(0.5), { hp: [0, HY, 1.8] }],
  ],
  // the lazy vault: a hand on it, the right leg lifted over, astride a moment, the left leg after
  vaultStep: () => [
    [0, walkAt(0), { hp: [0, HY, 0] }],
    [0.2, PK(legs(J({ ...ONE_HAND, spine: [0.3, 0, 0], head: [-0.2, 0, 0] }), -1.0, 1.2, 0.2, 0.2, -0.25, 0), {}),
      { hp: [0, HY - 0.06, 0.35], lp: [0.13, 0.63, 0.6] }],
    [0.45, PK(legs(J({ ...ONE_HAND, hips: [0, 0, 0.15], spine: [0.25, 0, 0] }), -0.7, 0.3, 0.3, 1.4, -0.35, 0.7), {}),
      { hp: [0, 1.02, 0.66], lp: [0.13, 0.63, 0.6] }],
    [0.65, PK(legs(J({ ...ONE_HAND, spine: [0.15, 0, 0] }), -0.1, 0.3, -1.1, 1.3, 0, 0.25), {}),
      { hp: [0, HY - 0.08, 1.0] }],
    [0.85, walkAt(0.5), { hp: [0, HY, 1.4] }],
  ],
  // jump climb: run in, the rifle swung onto the back, a step up the wall, both hands on the
  // edge, pull up, the right knee onto the top, stand up and the rifle comes back round
  climbJump: () => [
    [0, runAt(0), { hp: [0, HY - 0.05, 0] }],
    [0.25, PK(legs(J({ sling: 0.6, lG: 0, lH: 0, rG: 0.3, rH: 0.3, spine: [0.3, 0, 0], lT: [0.25, 1.0, -0.15], rT: [-0.25, 1.0, -0.15] }), 0.4, 0.6, -0.9, 0.9), {}),
      { hp: [0, HY - 0.12, 0.45] }],
    [0.45, PK(legs(J({ ...SLUNG, spine: [0.05, 0, 0], head: [-0.5, 0, 0], lPole: [1, -0.3, -0.4], rPole: [-1, -0.3, -0.4] }), 0.2, 0.8, -1.5, 1.3, 0, 0.1), {}),
      { hp: [0, 1.25, 0.4], lp: [0.22, 2.0, 0.75], rp: [-0.22, 2.0, 0.75] }],
    [0.65, PK(legs(J({ ...SLUNG, spine: [0.1, 0, 0], head: [-0.3, 0, 0], lPole: [1, -0.5, -0.3], rPole: [-1, -0.5, -0.3] }), -0.3, 0.8, -1.0, 1.4), {}),
      { hp: [0, 1.35, 0.6], lp: [0.22, 1.83, 0.95], rp: [-0.22, 1.83, 0.95] }],
    [0.95, PK(legs(J({ ...SLUNG, spine: [0.25, 0, 0], head: [-0.2, 0, 0], lPole: [1, -0.6, -0.2], rPole: [-1, -0.6, -0.2] }), -0.9, 1.3, -0.9, 1.3, -0.08, 0.08), {}),
      { hp: [0, 1.5, 0.65], lp: [0.22, 1.83, 0.95], rp: [-0.22, 1.83, 0.95] }],
    [1.2, PK(legs(J({ ...SLUNG, spine: [0.75, 0, 0], head: [-0.6, 0, 0], lPole: [1, -0.2, -0.6], rPole: [-1, -0.2, -0.6] }), -1.6, 1.9, -0.3, 0.8, -0.1, 0), {}),
      { hp: [0, 1.9, 0.8], lp: [0.22, 1.83, 0.95], rp: [-0.22, 1.83, 0.95] }],
    [1.5, PK(legs(J({ ...SLUNG, spine: [0.6, 0, 0], head: [-0.4, 0, 0] }), -1.3, 1.9, -0.6, 1.6), {}),
      { hp: [0, 1.8 + 0.55, 1.05], lp: [0.22, 1.83, 0.95], rp: [-0.22, 1.83, 0.95], lw: 0.5, rw: 0.5 }],
    [1.9, stance(pose0()), { hp: [0, 1.8 + HY - 0.02, 1.4] }],
  ],
  // mantle from a standstill: the rifle onto the back, hands on the edge, a little jump, press
  // up over the hands, the right knee on top, stand
  mantle: () => [
    [0, stance(pose0()), { hp: [0, HY - 0.02, 0] }],
    [0.3, PK(legs(J({ ...SLUNG, spine: [0.2, 0, 0], head: [-0.2, 0, 0] }), -0.35, 0.6, -0.35, 0.6), {}),
      { hp: [0, HY - 0.12, 0.0], lp: [0.22, 1.33, 0.36], rp: [-0.22, 1.33, 0.36] }],
    [0.55, PK(legs(J({ ...SLUNG, spine: [0.2, 0, 0], head: [-0.2, 0, 0], lPole: [1, -0.6, -0.2], rPole: [-1, -0.6, -0.2] }), -0.4, 0.9, -0.4, 0.9), {}),
      { hp: [0, 1.35, 0.02], lp: [0.22, 1.33, 0.36], rp: [-0.22, 1.33, 0.36] }],
    [0.85, PK(legs(J({ ...SLUNG, spine: [0.65, 0, 0], head: [-0.5, 0, 0], lPole: [1, 0, -0.6], rPole: [-1, 0, -0.6] }), -0.2, 0.6, -0.2, 0.6), {}),
      { hp: [0, 1.65, 0.15], lp: [0.22, 1.33, 0.36], rp: [-0.22, 1.33, 0.36] }],
    [1.1, PK(legs(J({ ...SLUNG, spine: [0.75, 0, 0], head: [-0.6, 0, 0] }), -1.6, 2.0, -0.2, 0.6, -0.1, 0), {}),
      { hp: [0, 1.3 + 0.6, 0.4], lp: [0.22, 1.33, 0.36], rp: [-0.22, 1.33, 0.36] }],
    [1.35, PK(legs(J({ ...SLUNG, spine: [0.4, 0, 0], head: [-0.3, 0, 0] }), -1.0, 1.6, -0.9, 1.6), {}),
      { hp: [0, 1.3 + 0.7, 0.55], lp: [0.22, 1.33, 0.36], rp: [-0.22, 1.33, 0.36], lw: 0.3, rw: 0.3 }],
    [1.7, stance(pose0()), { hp: [0, 1.3 + HY - 0.02, 0.8] }],
  ],
  // off a ledge: step off, the left arm out for balance, land on both feet and sink into it
  dropDown: () => [
    [0, walkAt(0), { hp: [0, HY, 0] }],
    [0.2, PK(legs(J({ ...ONE_HAND, lT: [0.45, 1.25, 0.2], lPole: [1, -0.2, -0.6] }), -0.6, 0.5, 0.15, 0.3), {}), { hp: [0, HY - 0.05, 0.2] }],
    [0.4, PK(J({ ...ONE_HAND, lT: [0.45, 1.5, 0.15], lPole: [1, 0, -0.6], thighR: [-0.3, 0, -0.05], thighL: [-0.3, 0, 0.05], shinR: [0.5, 0, 0], shinL: [0.5, 0, 0], footR: [0.2, 0, 0], footL: [0.2, 0, 0] }), {}),
      { hp: [0, HY - 0.55, 0.42] }],
    [0.56, PK(legs(J({ ...ONE_HAND, spine: [0.35, 0, 0], head: [-0.25, 0, 0], lT: [0.4, 1.3, 0.3], lPole: [1, -0.2, -0.6] }), -0.7, 1.2, -0.7, 1.2, -0.1, 0.1), {}),
      { hp: [0, -1.4 + 0.75, 0.6] }],
    [0.7, PK(legs(J({ ...ONE_HAND, spine: [0.45, 0, 0], head: [-0.3, 0, 0], lT: [0.3, 0.85, 0.4], lPole: [1, -0.2, -0.6] }), -1.1, 1.9, -1.1, 1.9, -0.12, 0.12), {}),
      { hp: [0, -1.4 + 0.55, 0.68] }],
    [0.9, stance(pose0()), { hp: [0, -1.4 + HY - 0.02, 0.8] }],
  ],
  // a long drop: land, dive forward into a roll over the back, come up on the feet, rifle tucked in
  dropRoll: () => {
    const tuck = (p, a, th = -1.9, sh = 2.2) => PK(J({ hips: [a, 0, 0], spine: [0.6, 0, 0], chest: [0.3, 0, 0], head: [0.7, 0, 0], thighR: [th, 0, -0.1], thighL: [th, 0, 0.1], shinR: [sh, 0, 0], shinL: [sh, 0, 0], footR: [-0.4, 0, 0], footL: [-0.4, 0, 0], wOff: [0, 0.05, -0.08] }), p);
    return [
      [0, walkAt(0), { hp: [0, HY, 0] }],
      [0.16, PK(legs(J({ ...ONE_HAND, lT: [0.45, 1.3, 0.2] }), -0.6, 0.5, 0.15, 0.3), {}), { hp: [0, HY - 0.05, 0.2] }],
      [0.35, PK(J({ ...ONE_HAND, lT: [0.45, 1.5, 0.15], thighR: [-0.3, 0, -0.05], thighL: [-0.3, 0, 0.05], shinR: [0.5, 0, 0], shinL: [0.5, 0, 0], footR: [0.2, 0, 0], footL: [0.2, 0, 0] }), {}), { hp: [0, HY - 0.9, 0.45] }],
      [0.54, PK(legs(J({ hips: [0.2, 0, 0], spine: [0.6, 0, 0], head: [-0.4, 0, 0] }), -1.2, 1.9, -1.2, 1.9, -0.12, 0.12), {}), { hp: [0, -2.6 + 0.6, 0.65] }],
      [0.7, tuck({}, 1.2, -1.6, 2.0), { hp: [0, -2.6 + 0.45, 0.95] }],
      [0.82, tuck({}, 3.0), { hp: [0, -2.6 + 0.5, 1.3] }],
      [0.96, tuck({}, 4.8), { hp: [0, -2.6 + 0.45, 1.6] }],
      [1.1, tuck({ head: [0.2, 0, 0], spine: [0.5, 0, 0] }, 6.0, -1.4, 2.0), { hp: [0, -2.6 + 0.55, 1.85] }],
      [1.3, PK(legs(J({ hips: [6.283 + 0.15, 0, 0], spine: [0.4, 0, 0], head: [-0.3, 0, 0] }), -1.0, 1.6, -1.0, 1.6, -0.1, 0.1), {}), { hp: [0, -2.6 + 0.7, 1.95] }],
      [1.6, PK(stance(pose0()), { hips: [6.283, 0, 0] }), { hp: [0, -2.6 + HY - 0.02, 2.0] }],
    ];
  },
  // a baseball slide in behind low cover: drop onto the left hip, the right leg out ahead, the left
  // hand trailing, the rifle up in the right; come up into a crouch, aiming
  slideCover: () => {
    const seat = (z) => PK(J({ ...ONE_HAND, rG: 1, hips: [0, 0.08, 0], thighR: [-1.35, 0, -0.1], shinR: [0.2, 0, 0], footR: [-0.2, 0, 0], thighL: [-1.0, 0, 0.18], shinL: [1.25, 0, 0], footL: [-0.3, 0, 0],
      spine: [-0.38, 0, 0.04], chest: [-0.05, 0.1, 0], head: [0.42, -0.08, 0], lPole: [1, -0.4, -0.6] }), {});
    const end = CLIPS.crouchAim[1](0, 0);
    return [
      [0, runAt(0), { hp: [0, HY - 0.05, 0] }],
      [0.22, PK(legs(J({ ...ONE_HAND, spine: [-0.1, 0, 0] }), -1.2, 0.4, -0.3, 1.6, -0.05, 0.1), {}), { hp: [0, HY - 0.4, 0.75], lp: [0.36, 0.35, 0.45], lw: 0.6 }],
      [0.4, seat(1.3), { hp: [0, HY - 0.72, 1.3], lp: [0.34, 0.22, 0.92] }],
      [0.75, seat(2.3), { hp: [0, HY - 0.72, 2.25], lp: [0.34, 0.22, 1.87] }],
      [0.92, PK(crouchLegs(J({ ...ONE_HAND })), { spine: [0.1, 0, 0] }), { hp: [0, HY - 0.45, 2.5], lp: [0.34, 0.22, 2.1], lw: 0 }],
      [1.1, end, { hp: [end.hipsPos[0], HY + end.hipsPos[1], 2.6 + end.hipsPos[2]] }],
    ];
  },
};

/* ---------- combat rolls (ai/evade.js): sideways log rolls, a shoulder roll, a dive to prone ---------- */
/**
 * A roll's clip, as a parkour clip (pkClip) but on a root that also goes sideways: key poses with
 * the hips (hp) at [x (his left), y, z (forward)] from where the roll starts, and the root path
 * (ai/evade.js rollAt: [side, forward, up]) taken off, so whoever carries the root along that
 * path (the AIs, the rig stage) has the body roll along the ground with it.
 */
function rlClip(kind, build) {
  let keys = null, RS, RF, RU;
  return (t) => {
    if (!keys) {
      const R = rollKeys(kind);
      RS = R.map((k) => [k[0], k[1]]);
      RF = R.map((k) => [k[0], k[2]]);
      RU = R.map((k) => [k[0], k[3]]);
      keys = build().map(([kt, p, o = {}]) => {
        if (o.hp) p.hipsPos = [o.hp[0], o.hp[1] - REST.hips.y, o.hp[2]];
        return [kt, p];
      });
    }
    const p = pose0();
    for (const k in p) {
      if (Array.isArray(p[k])) p[k] = p[k].map((_, i) => mono(keys.map(([kt, kp]) => [kt, kp[k][i]]), t));
      else p[k] = mono(keys.map(([kt, kp]) => [kt, kp[k]]), t);
    }
    const u = t / ROLLS[kind].dur, s = mono(RS, u), f = mono(RF, u), up = mono(RU, u);
    p.hipsPos = [p.hipsPos[0] - s, p.hipsPos[1] - up, p.hipsPos[2] - f];
    return p;
  };
}
// the rifle held in to the chest, muzzle up past the left shoulder, both hands on it (rolling over it)
const HUG = { wRot: [-0.9, 0.1, 0.5], wOff: [0.03, -0.08, -0.12] };
/** A side roll: sg 1 to his left, -1 to his right (ROLLS.rollLeft / rollRight: d 1.9 m in 1.1 s). */
function sideRoll(sg) {
  const D = ROLLS.rollLeft.geo.d;
  const at = (f) => sg * f * D; // the root's side at that fraction (SIDE_K in ai/evade.js)
  const st0 = aimUpper(stance(pose0()), 1);
  // lying along the ground on the front (prone), turned about the body's long axis by a (log roll)
  const log = (a, o = {}) => {
    const p = prone(pose0());
    Object.assign(p, HUG, { cw: 0, hips: [1.45, a, 0], thighR: [-0.02, 0, -0.06], thighL: [-0.02, 0, 0.06], shinR: [0.15, 0, 0], shinL: [0.15, 0, 0], footR: [0.4, 0, 0], footL: [0.4, 0, 0], head: [-0.7, 0, 0] }, o);
    return p;
  };
  const end = aimUpper(crouchLegs(pose0()), 1);
  end.spine[0] = 0.12;
  end.head[0] = -0.1;
  end.hips = [0, -sg * TAU, 0];
  return [
    [0, st0, { hp: [0, HY - 0.02, 0] }],
    // the step out to that side, down low, leaning into it
    [0.18, PK(crouchLegs(J({ ...HUG })), { hips: [0.55, -sg * 0.25, 0], spine: [0.35, 0, 0], thighR: [-1.3, 0, -0.12 - 0.25 * sg], thighL: [-1.3, 0, 0.12 - 0.25 * sg] }), { hp: [at(0.18), HY - 0.5, 0.08] }],
    // down on the front, already turning onto the shoulder
    [0.34, log(-sg * 0.7), { hp: [at(0.37), 0.24, 0.12] }],
    // over the back
    [0.52, log(-sg * Math.PI), { hp: [at(0.6), 0.26, 0.12] }],
    // onto the front again, the far side
    [0.7, log(-sg * (TAU - 0.5)), { hp: [at(0.79), 0.24, 0.12] }],
    // up onto a knee
    [0.86, PK(crouchLegs(J({ ...HUG })), { hips: [0.7, -sg * TAU, 0], spine: [0.45, 0, 0], head: [-0.4, 0, 0] }), { hp: [at(0.92), HY - 0.55, 0.05] }],
    [1.1, end, { hp: [at(1), HY - 0.36, -0.08] }],
  ];
}
const RL_KEYS = {
  rollLeft: () => sideRoll(1),
  rollRight: () => sideRoll(-1),
  // the shoulder roll: a lunge, the leading shoulder down, over the back diagonally, up in a crouch
  rollForward: () => {
    const D = ROLLS.rollForward.geo.d;
    const tuck = (a, o = {}) => PK(J({ ...HUG, hips: [a, 0, 0.15], spine: [0.6, 0, 0], chest: [0.3, 0, 0], head: [0.7, 0, 0], thighR: [-1.9, 0, -0.1], thighL: [-1.9, 0, 0.1], shinR: [2.2, 0, 0], shinL: [2.2, 0, 0], footR: [-0.4, 0, 0], footL: [-0.4, 0, 0] }), o);
    const end = aimUpper(crouchLegs(pose0()), 1);
    end.spine[0] = 0.12;
    end.head[0] = -0.1;
    end.hips = [TAU, 0, 0];
    return [
      [0, aimUpper(stance(pose0()), 1), { hp: [0, HY - 0.02, 0] }],
      [0.2, PK(legs(J({ ...HUG, spine: [0.7, 0, 0], head: [-0.3, 0, 0] }), -1.3, 1.4, 0.4, 0.4, -0.1, 0.05), {}), { hp: [0, HY - 0.38, 0.19 * D] }],
      [0.38, tuck(1.6), { hp: [0, 0.55, 0.4 * D] }],
      [0.55, tuck(3.1), { hp: [0, 0.5, 0.56 * D] }],
      [0.72, tuck(4.7), { hp: [0, 0.45, 0.73 * D] }],
      [0.9, tuck(6.0, { head: [0.2, 0, 0], spine: [0.5, 0, 0] }), { hp: [0, 0.5, 0.875 * D] }],
      [1.2, end, { hp: [0, HY - 0.36, D - 0.08] }],
    ];
  },
  // a dive forward: off the front foot, flat through the air, the rifle out ahead, onto the chest,
  // sliding a little, and down in the prone, aiming
  diveProne: () => {
    const D = ROLLS.diveProne.geo.d;
    const fly = PK(prone(pose0()), { hips: [1.3, 0, 0], thighR: [0.15, 0, -0.1], thighL: [0.3, 0, 0.1], shinR: [0.3, 0, 0], shinL: [0.1, 0, 0], footR: [0.6, 0, 0], footL: [0.6, 0, 0], head: [-0.9, 0, 0] });
    return [
      [0, aimUpper(stance(pose0()), 1), { hp: [0, HY - 0.02, 0] }],
      [0.25, PK(legs(aimUpper(J({ spine: [0.35, 0, 0], hips: [0.55, 0, 0] }), 1), -0.9, 0.9, 0.5, 0.3, -0.05, 0.05), {}), { hp: [0, HY - 0.2, 0.3 * D] }],
      [0.5, fly, { hp: [0, 0.62, 0.65 * D] }],
      [0.75, PK(prone(pose0()), { hips: [1.5, 0, 0], head: [-0.9, 0, 0] }), { hp: [0, 0.2, 0.9 * D] }],
      [1.25, prone(pose0()), { hp: [0, HY - 0.82, D] }],
    ];
  },
  // what stands in for a roll with a weapon that rules rolling out (ai/weapons.js): down into a
  // crouch, two quick shuffles to that side, the weapon kept up on the threat
  // a forward roll over something on the ground, the right hand taking it up on the way (the end: in his hands)
  rollPickup: () => RL_KEYS.rollForward().map(([t, p, o], i, a) => [t, i === a.length - 1 ? p : Object.assign({}, p, { rG: 0, rH: 0, rT: i === 2 || i === 3 ? [-0.2, 1.05, 0.55] : [-0.25, 0.97, 0.07], rPole: [-0.4, -0.2, -1] }), o]),
  sidestepLeft: () => sideStep(1),
  sidestepRight: () => sideStep(-1),
};
/** The crouched side step: sg 1 to his left, -1 to his right (ROLLS.sidestepLeft / Right). */
function sideStep(sg) {
  const kind = sg > 0 ? 'sidestepLeft' : 'sidestepRight', dur = ROLLS[kind].dur;
  const at = (t) => rollAt(kind, t / dur)[0]; // the hips over the root all along
  const low = (spread, drop, lean) => {
    const p = aimUpper(crouchLegs(pose0()), 1);
    p.spine[0] = 0.18; p.head[0] = -0.12;
    p.hips[2] = -sg * lean;
    // the leading leg (the left going left) out to the side, the other drawn in after it
    const lead = sg > 0 ? 'L' : 'R', trail = sg > 0 ? 'R' : 'L';
    p['thigh' + lead][2] += sg * spread;
    p['thigh' + trail][2] += sg * 0.04;
    p['foot' + lead][0] -= 0.1 * spread;
    return [p, drop];
  };
  const K = [[0.0, aimUpper(stance(pose0()), 1), 0.02], [0.14, ...low(0.05, 0.4, 0.04)], [0.3, ...low(0.42, 0.44, 0.1)], [0.42, ...low(0.02, 0.45, 0.05)], [0.58, ...low(0.42, 0.44, 0.1)], [0.68, ...low(0.02, 0.42, 0.04)], [0.8, ...low(0, 0.36, 0)]];
  return K.map(([t, p, drop]) => [t, p, { hp: [at(t), HY - drop, t === 0 ? 0 : -0.08] }]);
}

/* ---------- hand-to-hand (ai/melee.js): the boxing guard, strikes, kicks, defence, judo throws ---------- */
/**
 * No weapon in his hands (the rifle on his back, if he has one): fists up in a boxing guard, light
 * on his feet. Each strike is the guard with the striking limb thrown out and back (lands at
 * MELEE[k].hit); the throws and the clinch are pairs: the thrower's clip and the thrown man's
 * (`<move>_d`), both made for the two facing each other PAIR_D apart; the thrown man's ends on his
 * back where he lands (MELEE[k].land along his facing), as 'downed' then lies, and 'getUp' gets
 * him up again.
 */
/** The guard (f: the bounce on his feet): left foot and fist forward, the right fist by the chin, elbows in. */
function boxGuard(p, f = 0) {
  const b = sin(2 * f);
  p.hipsPos = [0, -0.1 + 0.015 * b, 0.02];
  p.thighL = [-0.6, 0, 0.1]; p.shinL = [0.85, 0, 0]; p.footL = [-0.25, 0, 0];
  p.thighR = [0.3, 0, -0.12]; p.shinR = [0.35, 0, 0]; p.footR = [-0.65, 0, 0];
  p.spine = [0.12, -0.22, 0]; p.chest = [0.05, -0.08, 0]; p.neck = [-0.05, 0.1, 0]; p.head = [-0.12, 0.2, 0];
  fistsFree(p);
  p.lT = [0.1, 1.5 + 0.01 * sin(f + 1), 0.32]; p.rT = [-0.1, 1.52 + 0.01 * b, 0.21];
  p.lPole = [1, -0.9, -0.2]; p.rPole = [-1, -0.9, -0.2];
  return p;
}
/** Hands off any weapon, the rifle on his back (when he has one). */
function fistsFree(p) {
  p.rG = p.lG = p.rH = p.lH = 0;
  p.sling = 0; p.sling2 = 1; p.cw = 0; p.aim = 0; p.kW = 0; p.mag = 0; p.lMag = 0;
  return p;
}
const G = () => boxGuard(pose0());
/** A strike: the guard, with what fn(p, e, t) does at e (0..1: thrown out, held, back) over env(t, a, b, c, d). */
const strike = (a, b, c, d, fn) => (t) => {
  const p = G();
  fn(p, env(t, a, b, c, d), t);
  return p;
};
/** Lying on his back (head back the way he came), hands by his sides: thrown, knocked down. */
function lying(p, f = 0, z = 0) {
  downPose(p, f);
  fistsFree(p);
  p.lW = p.rW = 0; p.lT = [0.3, 1.0, 0.0]; p.rT = [-0.3, 1.0, 0.0];
  p.hipsPos = [0, -0.8, z];
  return p;
}
/** Holding the other man in a clinch: a hand behind his neck, the other on his arm, heads together. */
function clinchPose(p, f = 0) {
  boxGuard(p, f);
  p.spine = [0.3, 0.05 * sin(f), 0]; p.chest = [0.1, 0, 0]; p.head = [-0.25, 0, 0];
  p.lT = [0.12, 1.42 + 0.01 * sin(f), 0.42]; p.rT = [-0.1, 1.3, 0.4];
  p.lPole = [1, -0.4, -0.3]; p.rPole = [-1, -0.7, -0.2];
  return p;
}
const T2 = Math.PI * 2;
/** The thrower's keys: in close, turned in under him (hips about), the lift, the throw, standing over him. */
function throwKeys(dur, low, hit) {
  const k = (o) => Object.assign(clinchPose(pose0()), o);
  return [
    [0, clinchPose(pose0())],
    [hit * 0.45, k({ hips: [0, Math.PI, 0], hipsPos: [0, -0.15 - low, 0.32], spine: [0.25, 0, 0], thighL: [-0.5, 0, 0.15], thighR: [-0.5, 0, -0.15], shinL: [0.9, 0, 0], shinR: [0.9, 0, 0], footL: [-0.4, 0, 0], footR: [-0.4, 0, 0], lT: [0.15, 1.2, 0.35], rT: [-0.15, 1.25, 0.3] })],
    [hit, k({ hips: [0, Math.PI, 0], hipsPos: [0, -0.1 - low, 0.32], spine: [0.9, 0, 0], head: [-0.4, 0, 0], thighL: [-0.4, 0, 0.15], thighR: [-0.4, 0, -0.15], shinL: [0.7, 0, 0], shinR: [0.7, 0, 0], footL: [-0.3, 0, 0], footR: [-0.3, 0, 0], lT: [0.2, 1.1, 0.45], rT: [-0.15, 1.05, 0.4] })],
    [dur, k({ hips: [0, Math.PI, 0], hipsPos: [0, -0.12, 0.32], spine: [0.45, 0, 0], head: [-0.3, 0, 0], thighL: [-0.3, 0, 0.12], thighR: [-0.2, 0, -0.12], shinL: [0.5, 0, 0], shinR: [0.4, 0, 0], footL: [-0.2, 0, 0], footR: [-0.2, 0, 0], lT: [0.2, 1.0, 0.45], rT: [-0.2, 1.0, 0.45] })],
  ];
}
/** The thrown man's keys: pulled onto the thrower's hip, over it (head first), onto his back `land` m on. */
function thrownKeys(dur, arc, hit, land) {
  const k = (o) => Object.assign(clinchPose(pose0()), o);
  const end = lying(pose0(), 0, land);
  end.hips[0] += T2; // (over forwards: a turn and a half, landing face up)
  return [
    [0, clinchPose(pose0())],
    [hit * 0.45, k({ spine: [0.45, 0, 0], hipsPos: [0, -0.05, 0.15], head: [-0.4, 0, 0] })],
    [hit * 0.82, k({ hips: [1.45, 0, 0], hipsPos: [0, 0.15 + arc, 0.55], spine: [0.1, 0, 0], thighL: [0.1, 0, 0.1], thighR: [0.1, 0, -0.1], shinL: [0.3, 0, 0], shinR: [0.2, 0, 0], footL: [0.3, 0, 0], footR: [0.3, 0, 0] })],
    [hit, k({ hips: [Math.PI, 0, 0], hipsPos: [0, 0.25 + arc, 0.5 + 0.45 * land], spine: [0.15, 0, 0], thighL: [-0.4, 0, 0.1], thighR: [-0.3, 0, -0.1], shinL: [0.5, 0, 0], shinR: [0.4, 0, 0] })],
    [hit + (dur - hit) * 0.45, end],
    [dur, lying(Object.assign(pose0(), {}), 0.5, land)],
  ].map(([t, p], i, a) => (i === a.length - 1 ? [t, Object.assign(p, { hips: [p.hips[0] + T2, p.hips[1], p.hips[2]] })] : [t, p]));
}
/** The foot sweep's thrown man: his leading foot swept out from under him, he goes over backwards. */
function sweptKeys(dur, hit, land) {
  const k = (o) => Object.assign(clinchPose(pose0()), o);
  return [
    [0, clinchPose(pose0())],
    [hit, k({ thighR: [-0.9, 0, -0.2], shinR: [0.1, 0, 0], hips: [-0.3, 0, 0], hipsPos: [0, -0.05, 0], spine: [-0.1, 0, 0], head: [0.3, 0, 0] })],
    [hit + 0.25, k({ thighR: [-1.2, 0, -0.2], thighL: [-0.6, 0, 0.1], shinL: [0.6, 0, 0], hips: [-1.0, 0, 0], hipsPos: [0, -0.45, land * 0.6], head: [0.6, 0, 0] })],
    [dur, lying(pose0(), 0, land)],
  ];
}
function sweepKeys(dur, hit) {
  const k = (o) => Object.assign(clinchPose(pose0()), o);
  return [
    [0, clinchPose(pose0())],
    [hit * 0.6, k({ thighL: [-0.3, 0, -0.1], shinL: [0.3, 0, 0], footL: [0.3, 0, 0], hipsPos: [0, -0.06, 0.05] })],
    [hit, k({ thighL: [-0.55, 0, -0.45], shinL: [0.1, 0, 0], footL: [0.5, 0, 0], chest: [0.1, 0.4, 0], lT: [0.12, 1.2, 0.45], rT: [-0.05, 1.15, 0.42], hipsPos: [0, -0.08, 0.05] })],
    [dur, G()],
  ];
}
const KNOCK_K = (() => {
  const back = -0.55;
  return [
    [0, G()],
    [0.2, Object.assign(G(), { head: [0.5, 0.2, 0], chest: [-0.25, 0, 0], hipsPos: [0, -0.15, -0.08] })],
    [0.55, Object.assign(G(), { hips: [-0.9, 0, 0], hipsPos: [0, -0.62, -0.3], thighL: [-0.9, 0, 0.1], thighR: [-0.9, 0, -0.1], shinL: [1.2, 0, 0], shinR: [1.2, 0, 0], head: [0.3, 0, 0], lT: [0.3, 0.9, -0.1], rT: [-0.3, 0.9, -0.1] })],
    [1.0, lying(pose0(), 0, back)],
  ];
})();
const GETUP_K = [
  [0, lying(pose0())],
  [0.35, Object.assign(lying(pose0()), { hips: [-0.7, 0, 0], hipsPos: [0, -0.68, 0], spine: [0.5, 0, 0], head: [0, 0, 0], thighR: [-1.2, 0, -0.1], shinR: [2.0, 0, 0], lT: [0.3, 0.9, -0.15] })],
  [0.8, (() => {
    const p = droneKneel(pose0(), 1);
    fistsFree(p);
    p.lT = [0.12, 1.25, 0.3]; p.rT = [-0.12, 1.25, 0.25];
    return p;
  })()],
  [1.3, G()],
];
/** The hand-to-hand clips: [duration, pose(t, u)]. */
const MELEE_CLIPS = {
  guard: [1.2, (t, u) => boxGuard(pose0(), TAU * u)],
  fistsUp: [0.5, (t) => lerpPose(handsFree(fistsFree(stance(pose0()))), G(), sm01(t / 0.5))],
  jab: [MELEE.jab.dur, strike(0.02, MELEE.jab.hit, MELEE.jab.hit + 0.04, MELEE.jab.dur, (p, e) => {
    p.lT = lerpA(p.lT, [0.04, 1.5, 0.66], e); p.spine[1] -= 0.12 * e; p.hipsPos[2] += 0.06 * e; p.lPole = [1, -0.6, -0.1];
  })],
  cross: [MELEE.cross.dur, strike(0.04, MELEE.cross.hit, MELEE.cross.hit + 0.05, MELEE.cross.dur, (p, e) => {
    p.rT = lerpA(p.rT, [-0.02, 1.5, 0.62], e); p.spine[1] += 0.5 * e; p.chest[1] += 0.25 * e; p.footR[1] = 0.4 * e; p.hipsPos[2] += 0.06 * e;
  })],
  hook: [MELEE.hook.dur, (t) => {
    const p = G(), w = env(t, 0, 0.12, 0.14, 0.24), e = env(t, 0.12, MELEE.hook.hit, MELEE.hook.hit + 0.04, MELEE.hook.dur);
    p.rT = lerpA(lerpA(p.rT, [-0.4, 1.48, 0.22], w), [0.08, 1.5, 0.42], e);
    p.rPole = lerpA(p.rPole, [-1, 0.5, -0.2], Math.max(w, e)); p.spine[1] += 0.65 * e - 0.15 * w; p.chest[1] += 0.2 * e;
    return p;
  }],
  uppercut: [MELEE.uppercut.dur, (t) => {
    const p = G(), dip = env(t, 0, 0.12, 0.15, 0.3), e = env(t, 0.15, MELEE.uppercut.hit, MELEE.uppercut.hit + 0.04, MELEE.uppercut.dur);
    p.rT = lerpA(lerpA(p.rT, [-0.12, 1.12, 0.26], dip), [-0.03, 1.64, 0.42], e);
    p.hipsPos[1] += -0.1 * dip + 0.05 * e; p.spine[0] -= 0.15 * e; p.spine[1] += 0.35 * e; p.rPole = [-1, -1, 0.2];
    return p;
  }],
  frontKick: [MELEE.frontKick.dur, (t) => {
    const p = G(), c = env(t, 0.04, 0.2, 0.42, 0.62), x = env(t, 0.2, MELEE.frontKick.hit, MELEE.frontKick.hit + 0.06, 0.5);
    p.thighR = [0.3 - 1.85 * c, 0, -0.08]; p.shinR = [0.35 + 1.6 * c - 1.75 * x, 0, 0]; p.footR = [-0.65 + 0.9 * c, 0, 0];
    p.thighL = [-0.25, 0, 0.08]; p.shinL = [0.35, 0, 0]; p.footL = [-0.1, 0, 0]; p.spine[0] -= 0.25 * c; p.hipsPos[2] -= 0.05 * c;
    return p;
  }],
  roundKick: [MELEE.roundKick.dur, (t) => {
    const p = G(), c = env(t, 0.05, 0.25, 0.5, 0.75), x = env(t, 0.25, MELEE.roundKick.hit, MELEE.roundKick.hit + 0.06, 0.6);
    p.hips = [0, 1.0 * c, 0]; p.spine[1] -= 0.6 * c; p.spine[2] = 0.35 * c;
    p.thighR = [0.3 - 0.8 * c, 0, -0.12 - 1.25 * c]; p.shinR = [0.35 + 1.5 * c - 1.65 * x, 0, 0]; p.footR = [-0.65 + 0.8 * c, 0, 0];
    p.thighL = [-0.25, 0, 0.1]; p.shinL = [0.35, 0, 0]; p.footL = [-0.1, 0, 0];
    return p;
  }],
  lowKick: [MELEE.lowKick.dur, (t) => {
    const p = G(), c = env(t, 0.04, MELEE.lowKick.hit, MELEE.lowKick.hit + 0.05, MELEE.lowKick.dur);
    p.hips = [0, 0.55 * c, 0]; p.spine[1] -= 0.35 * c;
    p.thighR = [0.3 - 0.7 * c, 0, -0.12 - 0.55 * c]; p.shinR = [0.35 - 0.15 * c, 0, 0]; p.footR = [-0.65 + 0.5 * c, 0, 0];
    return p;
  }],
  block: [MELEE.block.dur, strike(0, 0.12, 0.42, MELEE.block.dur, (p, e) => {
    p.lT = lerpA(p.lT, [0.09, 1.68, 0.22], e); p.rT = lerpA(p.rT, [-0.09, 1.68, 0.2], e); p.head[0] += 0.2 * e;
    p.lPole = lerpA(p.lPole, [1, -0.3, 0.6], e); p.rPole = lerpA(p.rPole, [-1, -0.3, 0.6], e);
  })],
  slip: [MELEE.slip.dur, strike(0, 0.12, 0.3, MELEE.slip.dur, (p, e) => {
    p.hipsPos[1] -= 0.14 * e; p.spine[2] = 0.3 * e; p.spine[0] += 0.15 * e; p.thighL[0] -= 0.2 * e; p.thighR[0] -= 0.2 * e; p.shinL[0] += 0.3 * e; p.shinR[0] += 0.3 * e;
  })],
  clinch: [MELEE.clinch.dur, (t, u) => clinchPose(pose0(), TAU * u)],
  clinch_d: [MELEE.clinch.dur, (t, u) => clinchPose(pose0(), TAU * u + 1)],
  hipThrow: [MELEE.hipThrow.dur, (t) => keyed(throwKeys(MELEE.hipThrow.dur, 0, MELEE.hipThrow.hit), t)],
  hipThrow_d: [MELEE.hipThrow.dur, (t) => keyed(thrownKeys(MELEE.hipThrow.dur, 0.1, MELEE.hipThrow.hit, MELEE.hipThrow.land), t)],
  shoulderThrow: [MELEE.shoulderThrow.dur, (t) => keyed(throwKeys(MELEE.shoulderThrow.dur, 0.25, MELEE.shoulderThrow.hit), t)],
  shoulderThrow_d: [MELEE.shoulderThrow.dur, (t) => keyed(thrownKeys(MELEE.shoulderThrow.dur, 0.3, MELEE.shoulderThrow.hit, MELEE.shoulderThrow.land), t)],
  footSweep: [MELEE.footSweep.dur, (t) => keyed(sweepKeys(MELEE.footSweep.dur, MELEE.footSweep.hit), t)],
  footSweep_d: [MELEE.footSweep.dur, (t) => keyed(sweptKeys(MELEE.footSweep.dur, MELEE.footSweep.hit, MELEE.footSweep.land), t)],
  hitHead: [REACT.hitHead.dur, strike(0, 0.06, 0.12, REACT.hitHead.dur, (p, e) => {
    p.head[0] += 0.5 * e; p.head[1] += 0.3 * e; p.neck[0] += 0.15 * e; p.chest[0] -= 0.15 * e; p.hipsPos[2] -= 0.06 * e; p.lT[1] -= 0.1 * e;
  })],
  hitBody: [REACT.hitBody.dur, strike(0, 0.08, 0.22, REACT.hitBody.dur, (p, e) => {
    p.spine[0] += 0.5 * e; p.head[0] -= 0.2 * e; p.hipsPos[2] -= 0.08 * e; p.lT = lerpA(p.lT, [0.08, 1.2, 0.25], e); p.rT = lerpA(p.rT, [-0.08, 1.2, 0.24], e);
  })],
  knockDown: [REACT.knockDown.dur, (t) => keyed(KNOCK_K, t)],
  downed: [2.6, (t, u) => lying(pose0(), TAU * u)],
  getUp: [REACT.getUp.dur, (t) => keyed(GETUP_K, t)],
};
export const MELEE_CLIP = Object.fromEntries(Object.keys(MELEE_CLIPS).map((k) => [k, 1]));
const MELEE_LOOP = { guard: 1, clinch: 1, clinch_d: 1, downed: 1 };
const MELEE_ONCE = Object.fromEntries(Object.keys(MELEE_CLIPS).filter((k) => !MELEE_LOOP[k]).map((k) => [k, 1]));
const MELEE_LABELS = {
  guard: 'Guard (boxing)', fistsUp: 'Fists up', ...Object.fromEntries(Object.entries(MELEE).map(([k, v]) => [k, v.label])),
  ...Object.fromEntries(Object.entries(REACT).map(([k, v]) => [k, v.label])), downed: 'Down (on his back)',
  clinch_d: 'Clinch (held)', hipThrow_d: 'Hip throw (thrown)', shoulderThrow_d: 'Shoulder throw (thrown)', footSweep_d: 'Foot sweep (swept)',
};
/** Unarmed (weapon 'fists'): what each clip becomes (the rest: the empty-handed versions). */
const FIST_AS = { aim: 'guard', shoot: 'guard', crouchAim: 'guard', crouchShoot: 'guard', knifeReady: 'guard', stab: 'jab', flame: 'guard', reload: 'guard', idle: 'guard', proneShoot: 'proneAim' };

/* ---------- gear: where each weapon is carried, dropping it, the pack off, picking things up ---------- */
/**
 * Where a weapon rides when it is put away (ai/weapons.js CARRY): the long guns slung across the
 * back (the clips' sling2), the pistol in a holster on the right hip, the flame gun's wand clipped
 * at the right side (its hose to the tanks); the weapon bone's place there (chest space: the butt
 * point, the barrel's direction, its top), for the put-away clip that takes it there (hipHolster).
 */
const HIP_SLOT = {
  pistol: { butt: [-0.235, 1.27, 0.0], dir: [0.0, -1, 0.06], up: [0, 0.06, 1] },
  torch: { butt: [-0.3, 1.32, -0.2], dir: [0.02, -0.82, 0.57], up: [0, 0.57, 0.82] },
};
/** Putting a pistol into its holster, the flame gun's wand onto its clip (u: 0 in hand .. 1 put away), as holster() does the rifle. */
function hipHolster(kind, u) {
  const H = HIP_SLOT[kind];
  const p = stance(pose0());
  p.cw = sm01(u / 0.75);
  p.cButt = H.butt.slice(); p.cDir = H.dir.slice(); p.cUp = H.up.slice();
  p.lG = p.lH = 1 - sm01(u / 0.3);
  p.lT = FREE_L.slice();
  p.rG = p.rH = 1 - sm01((u - 0.75) / 0.22);
  p.rT = FREE_R.slice();
  p.rPole = [-1, -0.3, -0.6];
  p.head = [0.25 * env(u, 0.3, 0.5, 0.8, 1), 0, 0];
  return p;
}
/** Dropping the weapon in his hands (lets go at DROP_T), the hands up into the guard after. */
export const DROP_T = 0.32;
function dropWeaponPose(t) {
  const p = stance(pose0());
  const r = sm01((t - DROP_T) / 0.12); // let go
  const g = sm01((t - 0.45) / 0.35); // fists up
  // the weapon held out a little and down, then let fall (the clip leaves it there: it is on the ground by then)
  p.wOff = [0, -0.12 * sm01(t / DROP_T), 0.12 * sm01(t / DROP_T)]; p.wRot = [0.35 * sm01(t / DROP_T), 0, 0];
  p.rG = p.rH = p.lG = p.lH = 1 - r;
  const G0 = boxGuard(pose0());
  p.rT = lerpA([-0.2, 1.0, 0.35], G0.rT, g); p.lT = lerpA([0.2, 1.0, 0.35], G0.lT, g);
  p.lPole = lerpA([1, -0.5, -0.25], G0.lPole, g); p.rPole = lerpA([-1, -0.45, -0.35], G0.rPole, g);
  for (const k of ['hipsPos', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR', 'spine', 'head']) p[k] = lerpA(p[k], G0[k], g);
  p.sling2 = r; // (no weapon left on the weapon bone: it goes where the empty-handed clips have it)
  return p;
}
/** Picking something small up (a pistol, the knife): one knee bent, the right hand down to it, up again. */
export const PICK_T = { pickup: 0.62, pickupOne: 0.5, rollPickup: 0.6 };
function pickupOnePose(t) {
  const p = pose0();
  const e = env(t, 0, 0.35, 0.6, 1.0);
  const c = crouchLegs(pose0());
  for (const k of ['hipsPos', 'thighR', 'thighL', 'shinR', 'shinL', 'footR', 'footL']) p[k] = c[k].map((v) => v * e * 0.85);
  p.spine = [0.6 * e, 0, 0]; p.chest = [0.25 * e, 0, 0]; p.head = [-0.3 * e, 0, 0];
  fistsFree(p);
  p.rT = lerpA([-0.25, 0.97, 0.07], [-0.12, 1.08, 0.58], e); p.lT = lerpA([0.25, 0.97, 0.07], [0.22, 1.12, 0.3], e);
  p.rPole = [-0.4, -0.2, -1]; p.lPole = [1, -0.4, -0.3];
  return p;
}
/**
 * The pack off: the right hand to the chest and waist buckles, the right shoulder strap off (the
 * pack sags to his left), the left one off, the pack swung round to the front in both hands,
 * lowered to the ground in front of him, and up again.
 */
const PACK_OFF_T = 4.2;
const PACK_K = (() => {
  const k = (o, lw = 0) => {
    const p = stance(pose0());
    handsFree(p);
    p.sling2 = 1;
    p.lW = p.rW = lw;
    return Object.assign(p, o);
  };
  const low = (e) => {
    const c = crouchLegs(pose0());
    const o = {};
    for (const n of ['hipsPos', 'thighR', 'thighL', 'shinR', 'shinL', 'footR', 'footL']) o[n] = c[n].map((v) => v * e);
    return o;
  };
  const front = [0, 0.98, 0.36], ground = [0, 0.2, 0.5];
  return [
    [0, k({})],
    [0.45, k({ rT: [-0.02, 1.32, 0.22], rPole: [-1, -0.8, 0], head: [0.35, 0, 0] })], // the chest strap
    [0.8, k({ rT: [0.0, 1.0, 0.2], rPole: [-1, -0.8, 0], head: [0.4, 0, 0] })], // the waist belt
    [1.3, k({ rT: [-0.14, 1.45, 0.14], rPole: [-1, -0.5, 0.2], head: [0.1, -0.3, 0] })], // the right strap
    [1.75, k({ rT: [-0.3, 1.3, -0.08], chest: [0, 0, -0.18], head: [0.05, -0.4, 0], bagP: [-0.04, 1.16, -0.27], bagR: [0, 0, 0.3] })], // off the right shoulder
    [2.2, k({ lT: [0.14, 1.45, 0.14], lPole: [1, -0.5, 0.2], rT: FREE_R.slice(), chest: [0, 0, 0.1], head: [0.1, 0.3, 0], bagP: [-0.04, 1.16, -0.27], bagR: [0, 0, 0.3] })], // the left strap
    [2.7, k({ head: [0.2, 0.4, 0], chest: [0, 0.3, 0], bagP: [0.3, 1.05, -0.02], bagR: [0, 1.4, 0.1], lTW: [0.38, 1.1, 0.12], rTW: [0.22, 1.05, 0.2] }, 1)], // swung round to the front
    [3.2, k({ head: [0.35, 0, 0], bagP: front, bagR: [0, Math.PI, 0], lTW: [0.18, 1.0, 0.36], rTW: [-0.18, 1.0, 0.36] }, 1)],
    [3.85, k({ ...low(1), spine: [0.55, 0, 0], head: [-0.2, 0, 0], bagP: ground, bagR: [0, Math.PI, 0], lTW: [0.18, 0.24, 0.5], rTW: [-0.18, 0.24, 0.5] }, 1)], // down in front of him
    [PACK_OFF_T, k({ ...low(0.7), spine: [0.35, 0, 0], bagP: ground, bagR: [0, Math.PI, 0], lTW: [0.18, 0.5, 0.45], rTW: [-0.18, 0.5, 0.45] }, 0)],
  ];
})();
const GEAR_CLIPS = {
  dropWeapon: [0.8, (t) => dropWeaponPose(t)],
  pickupOne: [1.0, (t) => pickupOnePose(t)],
  dropPack: [PACK_OFF_T, (t) => keyed(PACK_K, t)],
};
/* ---------- peeking (ai/peek.js) and the hand torch (ai/flashlight.js) ---------- */
/**
 * Over a low wall: from the crouch he rises just enough for his eyes to clear the top (the legs
 * straighten, the rifle up at the shoulder over it), looks left and right, and drops back.
 */
function peekWallPose(t) {
  const D = PEEK_CLIPS.peekWall;
  const r = env(t, 0.12, 0.55, D - 0.75, D - 0.2);
  const c = crouchLegs(pose0());
  const p = pose0();
  for (const k of ['hipsPos', 'thighR', 'thighL', 'shinR', 'shinL', 'footR', 'footL']) p[k] = c[k].map((v) => v * (1 - 0.85 * r));
  p.spine = [0.25 - 0.13 * r, 0, 0];
  p.head = [-0.18 + 0.08 * r, 0, 0];
  aimUpper(p, 1);
  // the look: a sweep left and right while up
  const sweep = Math.sin(((t - 0.55) / Math.max(0.5, D - 1.3)) * TAU) * r;
  p.chest[1] += 0.18 * sweep; p.head[1] += 0.12 * sweep;
  return p;
}
/**
 * Round a corner: from the aim stance he leans out (the weight onto the leg on that side, the
 * spine and chest rolled over it, the head kept level), looks, and comes back. side: 1 right, -1
 * left. A right-handed shooter leans out right more naturally; to the left he leans further (the
 * rifle stays at his right shoulder, his head over it).
 */
function leanPose(t, side) {
  const D = PEEK_CLIPS.leanRight;
  const e = env(t, 0.1, 0.42, D - 0.6, D - 0.12);
  const k = side > 0 ? 0.85 : 1.15;
  const p = stance(pose0());
  aimUpper(p, 1);
  p.hipsPos[0] += -side * 0.07 * e * k;
  p.hips[2] += side * 0.05 * e;
  p.spine[2] += side * 0.16 * e * k; p.chest[2] += side * 0.2 * e * k;
  p.neck[2] -= side * 0.08 * e; p.head[2] -= side * 0.14 * e * k;
  // the leg on that side takes the weight, the other trails
  if (side > 0) {
    p.thighR = [0.05, 0, -0.05 - 0.1 * e]; p.thighL = [-0.12, 0, 0.05 + 0.16 * e]; p.shinL[0] += 0.08 * e;
  } else {
    p.thighL = [0.05, 0, 0.05 + 0.1 * e]; p.thighR = [0.12, 0, -0.05 - 0.16 * e]; p.shinR[0] += 0.08 * e;
  }
  return p;
}
/**
 * Slicing the pie: side steps round the corner in an arc, the muzzle on each new slice (the upper
 * body turns a little further each step), then back. side: 1 right, -1 left.
 */
function slicePose(t, side) {
  const D = PEEK_CLIPS.sliceRight;
  const u = t / D;
  const p = walkLegs(pose0(), TAU * 3 * u, 0.18);
  p.hipsPos[1] -= 0.08; p.thighR[0] -= 0.18; p.thighL[0] -= 0.18; p.shinR[0] += 0.3; p.shinL[0] += 0.3;
  // the steps go sideways: the legs swing out and in
  p.thighR[2] += 0.1 * Math.sin(TAU * 3 * u); p.thighL[2] += 0.1 * Math.sin(TAU * 3 * u);
  aimUpper(p, 1);
  const arc = env(t, 0, D * 0.15, D * 0.65, D) * 0.45;
  p.spine[1] += -side * arc * 0.4; p.chest[1] += -side * arc * 0.6;
  p.spine[2] += side * 0.06 * arc;
  return p;
}
/**
 * The hand torch from the pouch on the left of the belt (or back into it): the free left hand
 * down to it and up to the front (the torch then held where the figure's torch hold puts it).
 */
const TORCH_POUCH = [0.2, 0.93, 0.1];
const TORCH_HOLD = [0.2, 1.3, 0.38];
function torchPose(t, draw) {
  const D = draw ? TORCH_T.draw : TORCH_T.stow;
  const u = draw ? t / D : 1 - t / D;
  const p = stance(pose0());
  const reach = env(u, 0, 0.1, 0.55, 1.0);
  // (the hand off the weapon at the start of the draw; back on it at the end of the stow)
  p.lG = 1 - sm01(u / 0.2);
  p.lH = 0; p.lPole = [1, -0.7, -0.3];
  p.lT = u < 0.5 ? lerpA(FREE_L, TORCH_POUCH, sm01(u / 0.5)) : lerpA(TORCH_POUCH, TORCH_HOLD, sm01((u - 0.5) / 0.5));
  p.head = [0.25 * reach * (u < 0.6 ? 1 : 0), 0.2 * reach * (u < 0.6 ? 1 : 0), 0];
  return p;
}
const PEEK_TORCH_CLIPS = {
  peekWall: [PEEK_CLIPS.peekWall, (t) => peekWallPose(t)],
  leanLeft: [PEEK_CLIPS.leanLeft, (t) => leanPose(t, -1)],
  leanRight: [PEEK_CLIPS.leanRight, (t) => leanPose(t, 1)],
  sliceLeft: [PEEK_CLIPS.sliceLeft, (t) => slicePose(t, -1)],
  sliceRight: [PEEK_CLIPS.sliceRight, (t) => slicePose(t, 1)],
  drawTorch: [TORCH_T.draw, (t) => torchPose(t, true)],
  stowTorch: [TORCH_T.stow, (t) => torchPose(t, false)],
};
/** The peek clips (one-shots, played at the pace the AI exposes him: ai/peek.js) and the torch's. */
export const PEEK = Object.fromEntries(Object.keys(PEEK_CLIPS).map((k) => [k, 1]));
export const TORCH_CLIPS = { drawTorch: 1, stowTorch: 1 };
const PEEK_TORCH_LABELS = { ...PEEK_LABELS, drawTorch: 'Torch: draw from the belt', stowTorch: 'Torch: back on the belt' };
const GEAR_LABELS = { dropWeapon: 'Drop weapon', pickupOne: 'Pick up (one hand)', dropPack: 'Pack off (unstrap, lower)', rollPickup: 'Roll pick-up' };

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

  crouchAim: [2.2, (t, u) => {
    const p = crouchLegs(pose0()), f = TAU * u;
    p.spine[0] = 0.12; p.head[0] = -0.1; aimUpper(p, 1); p.wOff = [0.003 * sin(f), 0.003 * sin(2 * f), 0];
    return p;
  }],

  aimWalk: [1.2, (t, u) => {
    const p = walkLegs(pose0(), TAU * u, 0.32), f = TAU * u;
    p.hipsPos[1] -= 0.06; p.thighR[0] -= 0.15; p.thighL[0] -= 0.15; p.shinR[0] += 0.25; p.shinL[0] += 0.25;
    aimUpper(p, 1); p.wOff = [0, 0.006 * sin(2 * f), 0];
    return p;
  }],
  // stairs (or a steep climb): the knee comes up high onto the next step, the body leans into it
  // and rises step by step; the rifle at the low ready
  stairsUp: [1.05, (t, u) => {
    const p = pose0(), f = TAU * u;
    for (const [k, o] of [['R', 0], ['L', Math.PI]]) {
      const g = f + o, up = mx0(sin(g));
      p['thigh' + k] = [-0.35 - 0.75 * up + 0.3 * mx0(-sin(g)), 0, 0];
      p['shin' + k] = [0.25 + 1.0 * Math.pow(mx0(sin(g + 0.5)), 1.2), 0, 0];
      p['foot' + k] = [-0.25 * up, 0, 0];
    }
    p.hipsPos = [0, -0.05 + 0.035 * sin(2 * f), 0.02];
    p.hips = [0, 0.06 * sin(f), 0.02 * cos(f)];
    p.spine = [0.2, -0.08 * sin(f), 0]; p.chest = [0.04, -0.03 * sin(f), 0]; p.head = [-0.16, 0.03 * sin(f), 0];
    p.wOff = [0, -0.012 * sin(2 * f), 0];
    return p;
  }],
  // down stairs: knees bent, the body upright and set back a little, eyes on the steps
  stairsDown: [1.0, (t, u) => {
    const p = pose0(), f = TAU * u;
    for (const [k, o] of [['R', 0], ['L', Math.PI]]) {
      const g = f + o;
      p['thigh' + k] = [-0.2 - 0.3 * sin(g), 0, 0];
      p['shin' + k] = [0.45 + 0.55 * Math.pow(mx0(-cos(g)), 1.3), 0, 0];
      p['foot' + k] = [0.15 * mx0(sin(g)), 0, 0];
    }
    p.hipsPos = [0, -0.09 + 0.03 * sin(2 * f), -0.02];
    p.hips = [0, 0.05 * sin(f), 0.025 * cos(f)];
    p.spine = [-0.04, -0.06 * sin(f), 0]; p.chest = [0, -0.02 * sin(f), 0]; p.head = [0.22, 0.02 * sin(f), 0];
    p.wOff = [0, 0.01 * sin(2 * f), 0];
    return p;
  }],
  // sliding down a steep hill: seated, feet first, leaning back; the leading leg out straight, the
  // other bent to steer; the left hand drags behind as a brake, the right keeps the rifle up
  slide: [1.2, (t, u) => {
    const p = pose0(), f = TAU * u, j = 0.012 * sin(6 * f) + 0.006 * sin(17 * f);
    p.hipsPos = [0, -0.72 + j, -0.12];
    p.hips = [0, 0.08, 0.04 * sin(f)];
    p.thighR = [-1.35, 0, -0.1]; p.shinR = [0.2, 0, 0]; p.footR = [-0.2, 0, 0];
    p.thighL = [-1.0, 0, 0.18]; p.shinL = [1.25, 0, 0]; p.footL = [-0.3, 0, 0];
    p.spine = [-0.38, 0, 0.04]; p.chest = [-0.05, 0.1, 0]; p.head = [0.42, -0.08 + 0.03 * sin(f), 0];
    p.lG = 0; p.lW = 1; p.lTW = [0.34, 0.22 + j, -0.38]; p.lPole = [1, -0.4, -0.6];
    p.wOff = [0, j, 0];
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
  // firing: one trigger pull of a rifle (a burst), its recoil (shootClips; a figure rebakes them for its weapon: setRecoil)
  ...shootClips(),
  // casualties (ai/casualty.js): down wounded, dragged, the rescuer dragging, first aid; cover fire (an
  // automatic string from a crouch, again and again: the man keeping their heads down)
  ...CAS_CLIPS,
  coverFire: shootClips(recoilSpec('rifle', { mode: 'auto', rounds: 8 })).crouchShoot,
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
  // at a desk: seated, the rifle slung, hands on the keyboard and mouse, eyes going from screen to screen
  deskSit: [6.0, (t, u) => {
    const p = pose0(), f = TAU * u;
    p.hipsPos = [0, -0.5, -0.04]; p.thighR = [-1.5, 0, -0.06]; p.thighL = [-1.5, 0, 0.06]; p.shinR = [1.5, 0, 0]; p.shinL = [1.5, 0, 0];
    p.spine = [0.1, 0, 0]; p.head = [-0.14 + 0.05 * sin(f * 2), 0.38 * sin(f) + 0.1 * sin(f * 3), 0];
    p.sling = 1; p.lG = 0; p.rG = 0; p.lH = 0; p.rH = 0; p.lW = 1; p.rW = 1; p.lPole = [1, -0.6, -0.5]; p.rPole = [-1, -0.6, -0.5];
    p.lTW = [0.17 + 0.015 * sin(f * 4), 0.79, 0.44]; p.rTW = [-0.19 + 0.04 * sin(f * 3 + 1), 0.79, 0.42 + 0.03 * sin(f * 5)];
    return p;
  }],
  // flying the drone on a search: bigger stick inputs, the head turning with it
  droneScout: [4.0, (t, u) => {
    const p = droneKneel(pose0(), 1);
    const f = TAU * u;
    p.lT = [0.075 + 0.014 * sin(f * 3), 1.12 + 0.006 * sin(f * 5), 0.28]; p.rT = [-0.075 + 0.016 * sin(f * 2 + 1), 1.12, 0.28 + 0.008 * sin(f * 4)];
    p.head = [-0.08 + 0.05 * sin(f * 2), 0.35 * sin(f), 0.06 * sin(f)]; p.spine[1] = 0.12 * sin(f);
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
  // weapon switching: each put-away ends with the hands free at his sides, each draw starts there
  holsterRifle: [PUT_T, (t) => holster(t / PUT_T)],
  drawRifle: [DRAW_T.rifle, (t) => holster(1 - t / DRAW_T.rifle)],
  holsterSecondary: [PUT_T, (t) => CLIPS.drawSecondary[1](DRAW_T.secondary * (1 - t / PUT_T))],
  drawKnife: [DRAW_T.knife, (t) => knifeDraw(t)],
  sheathKnife: [PUT_T, (t) => knifeDraw(DRAW_T.knife * (1 - t / PUT_T))],
  knifeReady: [2.0, (t, u) => knifeStance(pose0(), TAU * u)],
  stab: [0.7, (t) => stabPose(t)],
  throwFlash: [1.6, (t) => {
    const p = stance(pose0());
    const e = env(t, 0, 0.2, 1.25, 1.55);
    // the left hand keeps the rifle, muzzle down; the right bowls the flash-bang underarm
    p.wRot = [0.9 * e, 0.2 * e, 0.3 * e]; p.wOff = [0.06 * e, -0.08 * e, 0.08 * e];
    p.rG = 1 - e; p.rH = 0; p.rPole = [-1, -0.5, -0.2]; p.rT = pathK(FLASH_K, t / 1.6);
    const wind = env(t, 0.5, 0.8, 0.82, 1.0), thr = env(t, 0.85, 1.0, 1.1, 1.5), c = Math.max(wind, thr);
    p.hipsPos = [0, -0.1 * c, 0];
    p.thighL = [-0.12 - 0.45 * c, 0, 0.05]; p.shinL = [0.16 + 0.6 * c, 0, 0]; p.footL = [-0.15 * c, 0, 0];
    p.thighR = [0.12 + 0.05 * c, 0, -0.05]; p.shinR = [0.12 + 0.35 * c, 0, 0]; p.footR = [-0.2 - 0.3 * c, 0, 0];
    p.spine = [0.25 * c, -0.25 * wind + 0.15 * thr, 0]; p.head = [0.15 * env(t, 0.1, 0.3, 0.4, 0.55) - 0.2 * c, 0.3 * wind - 0.15 * thr, 0];
    return p;
  }],
  rappel: [1.8, (t, u) => rappelPose(pose0(), u)],
  rappelStart: [1.8, (t) => keyed(RAPPEL_START, t)],
  rappelEnd: [1.4, (t) => keyed(RAPPEL_END, t)],
  // ropes and cables (ai/rope.js): fast-roping, the zipline (on the pulley, hand over hand), falling off one
  fastRope: [1.2, (t, u) => fastRopePose(pose0(), u)],
  zipline: [1.6, (t, u) => ziplinePose(pose0(), u)],
  zipHand: [1.4, (t, u) => zipHandPose(pose0(), u)],
  ropeFall: [0.8, (t, u) => ropeFallPose(pose0(), u)],
  peekOver: [3.0, (t, u) => peek(pose0(), TAU * u, false)],
  peekOverAim: [2.4, (t, u) => peek(pose0(), TAU * u, true)],
  // parkour (ai/parkour.js MOVES: their durations and root paths)
  ...Object.fromEntries(Object.keys(PK_KEYS).map((k) => [k, [PK_MOVES[k].dur, pkClip(k, PK_KEYS[k])]])),
  // combat rolls (ai/evade.js ROLLS: their durations and root paths)
  ...Object.fromEntries(Object.keys(RL_KEYS).map((k) => [k, [ROLLS[k].dur, rlClip(k, RL_KEYS[k])]])),
  // hand-to-hand (ai/melee.js): the guard, strikes, kicks, defence, the clinch and throws (pairs), down and up again
  ...MELEE_CLIPS,
  // gear: the weapon dropped, the pack taken off and put down, picking things up
  ...GEAR_CLIPS,
  // the retreat: backing off aiming, the fireman's carry (both men), setting a tripwire
  ...RETREAT_CLIPS,
  // peeking over a wall and round corners, slicing the pie; the hand torch drawn and put away
  ...PEEK_TORCH_CLIPS,
};

export const ONCE = { deployDrone: 1, drawSecondary: 1, radio: 1, hit: 1, die: 1, reload: 1, jump: 1, signalMove: 1, signalHalt: 1, signalDown: 1, throwGrenade: 1, pickup: 1,
  holsterRifle: 1, drawRifle: 1, holsterSecondary: 1, drawKnife: 1, sheathKnife: 1, stab: 1, throwFlash: 1, rappelStart: 1, rappelEnd: 1, ...PARKOUR, ...ROLL, ...MELEE_ONCE, dropWeapon: 1, pickupOne: 1, dropPack: 1, ...PEEK, ...TORCH_CLIPS };
/** Ground speed each moving clip is made for (m/s). */
export const MOVING = { walk: 1.35, run: 3.4, aimWalk: 1.0, crawl: 0.35, swim: 0.6, stairsUp: 0.9, stairsDown: 1.0, slide: 2.6 };
export const AIMING = { aim: 1, shoot: 1, crouchAim: 1, crouchShoot: 1, aimWalk: 1, flame: 1, peekWall: 1, leanLeft: 1, leanRight: 1, sliceLeft: 1, sliceRight: 1 };
export const LABELS = { idle: 'Idle', walk: 'Walk', run: 'Run', stairsUp: 'Stairs up', stairsDown: 'Stairs down', slide: 'Slide (hill)', crouch: 'Crouch', aim: 'Aim', shoot: 'Shoot', crouchAim: 'Crouch aim', crouchShoot: 'Crouch fire', aimWalk: 'Aim-walk',
  reload: 'Reload', throwGrenade: 'Grenade', jump: 'Jump', crawl: 'Crawl', proneAim: 'Prone aim', proneShoot: 'Prone fire', drawSecondary: 'Draw 2nd', flame: 'Flame gun', deployDrone: 'Drone', droneControl: 'Drone ctrl', droneScout: 'Drone scout', deskSit: 'Desk', swim: 'Swim', signalMove: 'Sig: move', signalHalt: 'Sig: halt', signalDown: 'Sig: down', radio: 'Radio', hit: 'Hit', die: 'Die',
  holsterRifle: 'Sling rifle', drawRifle: 'Draw rifle', holsterSecondary: 'Sling 2nd', drawKnife: 'Draw knife', sheathKnife: 'Sheathe knife', knifeReady: 'Knife ready', stab: 'Stab',
  throwFlash: 'Flash-bang', rappelStart: 'Rappel: over', rappel: 'Rappel', rappelEnd: 'Rappel: off', fastRope: 'Fast rope', zipline: 'Zipline', zipHand: 'Cable: hand over hand', ropeFall: 'Fall off the rope', peekOver: 'Peek over', peekOverAim: 'Peek-over aim',
  vaultSpeed: 'Vault (speed)', vaultSide: 'Vault (side)', vaultStep: 'Vault (step-over)', climbJump: 'Climb up (jump)', mantle: 'Mantle', dropDown: 'Drop down', dropRoll: 'Drop down (roll)', slideCover: 'Slide into cover', ...ROLL_LABELS,
  woundedDown: 'Wounded down', dragCasualty: 'Drag casualty (rescuer + casualty)', dragged: 'Dragged (casualty)', firstAid: 'First aid', coverFire: 'Cover fire', ...MELEE_LABELS, ...GEAR_LABELS, ...PEEK_TORCH_LABELS };
export { PARKOUR, ROLL };
// the retreat's clips (ai/retreat.js): the one-shots, their walking speeds, the aimed one, their names
Object.assign(ONCE, RETREAT_ONCE);
Object.assign(MOVING, { aimWalkBack: 1.0, fireCarry: 0.85 });
Object.assign(AIMING, { aimWalkBack: 1 });
Object.assign(LABELS, RETREAT_LABELS);
/** Without a rifle: what each clip becomes. */
const UNARMED_AS = { shoot: 'aim', crouchShoot: 'crouchAim', proneShoot: 'proneAim', reload: 'idle', flame: 'aim' };
/** Clips that do not care whether he has a rifle (they say where the weapons are themselves). */
const NO_UNARMED = { ...MELEE_CLIP, dropWeapon: 1, pickupOne: 1, dropPack: 1, woundedDown: 1, dragged: 1, dragCasualty: 1, firstAid: 1, drawSecondary: 1, deployDrone: 1, droneControl: 1, droneScout: 1, deskSit: 1, pickup: 1, swim: 1,
  holsterRifle: 1, drawRifle: 1, holsterSecondary: 1, drawKnife: 1, sheathKnife: 1, knifeReady: 1, stab: 1, rappel: 1, rappelStart: 1, rappelEnd: 1, fastRope: 1, zipline: 1, zipHand: 1, ropeFall: 1 };
Object.assign(NO_UNARMED, RETREAT);
/** With the knife out (or empty-handed, the rifle on his back): what each clip becomes. */
const KNIFE_AS = { aim: 'knifeReady', shoot: 'knifeReady', crouchAim: 'crouch', crouchShoot: 'crouch', aimWalk: 'walk', proneShoot: 'proneAim', reload: 'knifeReady', flame: 'knifeReady' };
const PRONE = { crawl: 1, proneAim: 1, proneShoot: 1, peekOver: 1, peekOverAim: 1 };
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
    } else if (PRONE[name]) {
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
/**
 * The knife version of a clip: the rifle on his back, the knife in the right hand (low at his side
 * standing and walking, pumping when he runs, forward on guard crouched), the left hand free.
 * A hand the clip itself uses (a throw, a signal) keeps doing that.
 */
function knifeAs(name, base) {
  return (t, u) => {
    const p = base(t, u);
    const s = sin(TAU * u);
    const K = knifeStance(pose0(), TAU * u);
    let R = [-0.21, 1.0, 0.16], L = FREE_L, pr = [-0.6, -0.3, -1], pl = [0.4, -0.2, -1], kd = [0, 0.2, 1], ke = [0.1, -1, 0.2];
    if (name === 'walk') {
      R = [-0.21, 1.01, 0.16 - 0.08 * s];
      L = [0.25, 0.98, 0.07 + 0.14 * s];
    } else if (name === 'run') {
      R = [-0.24, 1.12 + 0.1 * mx0(-s) + 0.04 * mx0(s), 0.06 - 0.22 * s];
      L = [0.25, 1.14 + 0.1 * mx0(s) + 0.04 * mx0(-s), 0.04 + 0.25 * s];
      pr = [-1, -0.2, -1]; pl = [1, -0.2, -1]; kd = [0, 0.6, 1];
    } else if (name === 'crouch' || name === 'jump') {
      R = K.rT; L = K.lT; pr = K.rPole; pl = K.lPole; kd = K.kDir; ke = K.kEdge;
    } else if (PRONE[name]) {
      R = [-0.2, 1.78 + 0.08 * s, 0.13]; L = [0.2, 1.78 - 0.08 * s, 0.13];
      pr = [-1, 0, 0.6]; pl = [1, 0, 0.6]; kd = [0, 1, -0.2]; ke = [0, 0, 1];
    }
    const blend = (cur, def, g) => (g >= 1 ? def : lerpA(cur, def, g));
    p.rT = blend(p.rT, R, p.rG); p.lT = blend(p.lT, L, p.lG);
    if (p.rG > 0.5) p.rPole = pr;
    if (p.lG > 0.5) p.lPole = pl;
    p.kW = p.rG; p.kDir = kd; p.kEdge = ke;
    p.rG = 0; p.lG = 0; p.rH = 0; p.lH = 0; p.lMag = 0; p.mag = 0;
    p.aim = 0; p.cw = 0; p.sling = 0; p.sling2 = 1;
    return p;
  };
}
/* ---------- weapon handling (ai/weapons.js): each weapon's grips, carry, aim and firing ---------- */
/**
 * How each weapon is held, on top of the rifle's clips (a profile in ai/weapons.js HANDLING says
 * the same in words, with what it allows):
 *  - lGo / rGo: where the hands grip it, rifle-local offsets from the rifle's grips (x along the
 *    barrel, y up): the shotgun's pump, the machine gun's handguard top, the pistol's left hand
 *    cupping the right on the grip;
 *  - carry: the weapon moved (wOff, chest space) and turned (wRot) while he is not aiming (low
 *    ready, hip carry, compressed ready);
 *  - aim: aOff (the aimed weapon moved: the pistol out at arm's length, the flame gun at the hip),
 *    aPitch (the muzzle raised), square (0..1: how far the bladed rifle stance turns square to
 *    the target: the pistol's isosceles), lean (weight forward over the front foot), wide (feet);
 *  - oneHand: clips where only the right hand holds it (the pistol on the move);
 *  - muzzle: where the muzzle is along the barrel (m, rifle-local x: the flash).
 * The rifle and the carbine are the clips as they are (null).
 */
export const WEAPON_STYLE = {
  rifle: null,
  carbine: null,
  shotgun: {
    lGo: [0.015, 0.008, 0], carry: { wOff: [0, -0.02, 0], wRot: [0.14, 0, 0] }, lean: 0.07, wide: 0.04, muzzle: 0.97,
  },
  mg: {
    lGo: [-0.07, 0.075, 0.012], carry: { wOff: [0.03, -0.1, 0.04], wRot: [0.1, 0, 0.04] }, lean: 0.1, wide: 0.07, muzzle: 1.1,
  },
  pistol: {
    lGo: [-0.255, -0.05, -0.012],
    carry: { wOff: [0.1, 0.08, 0.03], wRot: [0.4, -0.9, 0] },
    aOff: [0.15, 0.0, 0.18], square: 0.75, muzzle: 0.43,
    oneHand: { run: 1, walk: 1, stairsUp: 1, stairsDown: 1, jump: 1, slide: 1 },
    // peeking round a corner with the pistol: one-handed, the left hand flat on the wall's edge
    oneHandAim: { leanLeft: [0.34, 1.42, 0.3], leanRight: [-0.1, 1.38, 0.34], sliceLeft: [0.3, 1.3, 0.25], sliceRight: [-0.05, 1.3, 0.3] },
  },
  torch: {
    carry: { wOff: [0.01, -0.08, 0.04], wRot: [0.2, 0, 0] }, aOff: [0.06, -0.22, 0.0], aPitch: 0.14, square: 0.3, muzzle: 1.0,
  },
};
const addA = (a, b, k = 1) => a.map((v, i) => v + b[i] * k);
/** A clip pose fn held the way weapon S says. */
function styled(S, name, base) {
  return (t, u) => {
    const p = base(t, u);
    const a = p.aim;
    if (S.lGo) p.lGo = addA(p.lGo, S.lGo);
    if (S.rGo) p.rGo = addA(p.rGo, S.rGo);
    if (S.oneHand?.[name] && a < 0.5) {
      // on the move: the pistol in the right hand only, the left arm swinging free
      const s = Math.sin(TAU * u);
      p.lT = lerpA(p.lT, [0.25, name === 'run' ? 1.14 + 0.1 * mx0(s) : 0.98, 0.07 + (name === 'run' ? 0.25 : 0.14) * s], p.lG);
      p.lPole = [1, -0.2, -1];
      p.lG = 0; p.lH = 0;
    }
    if (S.oneHandAim?.[name] && a > 0.5) {
      p.lT = S.oneHandAim[name].slice();
      p.lPole = [1, -0.5, -0.4];
      p.lG = 0; p.lH = 0;
    }
    const c = (1 - a) * (1 - p.cw) * (1 - p.sling) * (1 - p.sling2) * Math.max(p.rG, p.lG);
    if (S.carry && c > 0) {
      p.wOff = addA(p.wOff, S.carry.wOff, c);
      p.wRot = addA(p.wRot, S.carry.wRot, c);
    }
    if (a > 0) {
      if (S.aOff) p.aOff = addA(p.aOff, S.aOff);
      p.aPitch += S.aPitch ?? 0;
      if (S.square) {
        // square to the target: the twist of the bladed stance taken out, the aim turned with it
        const q = S.square * a;
        p.spine[1] += 0.35 * q; p.chest[1] += 0.45 * q; p.neck[1] -= 0.2 * q; p.head[1] -= 0.58 * q;
        p.aYaw -= AIM_YAW * S.square;
      }
      if (S.lean) {
        // (the muzzle kept on the target as the body leans over it)
        p.spine[0] += 0.5 * S.lean * a; p.chest[0] += S.lean * a; p.head[0] -= 1.2 * S.lean * a; p.aPitch += 1.5 * S.lean;
      }
    }
    if (S.wide && p.cw < 0.5 && Math.abs(p.hips[0]) < 0.5) {
      p.thighR[2] -= S.wide; p.thighL[2] += S.wide;
    }
    return p;
  };
}
/** Shells into the shotgun's tube one at a time: the left hand from the pouch on the belt to the loading port, four times. */
const SHELL_POUCH = [0.17, 1.0, 0.15];
export const SHOTGUN_RELOAD = 3.9;
function shotgunReload(t) {
  const p = stance(pose0());
  const e = env(t, 0, 0.35, SHOTGUN_RELOAD - 0.4, SHOTGUN_RELOAD);
  // turned on its side, the port up, the butt under the arm
  p.wOff = [0.03 * e, 0.07 * e, 0.07 * e]; p.wRot = [-0.15 * e, 0.2 * e, 0.85 * e];
  p.head = [0.32 * e, 0.22 * e, 0];
  // the hand: pump -> pouch -> port (a shell pushed in) -> pouch ... -> pump
  const port = [-0.21, -0.035, 0.0];
  const k = (t - 0.4) / 0.75;
  let g = 1, go = [0, 0, 0];
  if (k >= 0 && k < 4) {
    const f = k % 1;
    g = 1 - env(f, 0.0, 0.3, 0.45, 0.8); // off to the pouch and back
    go = k < 0.3 ? lerpA([0, 0, 0], port, sm01(k / 0.3)) : port.slice();
    if (f > 0.8) go = addA(port, [0.05 * env(f, 0.8, 0.9, 0.92, 1), 0, 0]); // pushing the shell home
  } else if (k >= 4) go = lerpA(port, [0, 0, 0], sm01((k - 4) / 0.4));
  p.lG = g; p.lH = 1; p.lGo = go;
  p.lT = SHELL_POUCH.slice(); p.lPole = [1, -0.8, 0];
  return p;
}
/** The pistol's magazine change: pulled in, the empty one dropped, a new one from the belt into the grip. */
export const PISTOL_RELOAD = 1.8;
function pistolReload(t) {
  const p = stance(pose0());
  const e = env(t, 0, 0.25, PISTOL_RELOAD - 0.3, PISTOL_RELOAD);
  p.wRot = [-0.25 * e, 0.1 * e, 0.35 * e]; p.wOff = [0.05 * e, 0.06 * e, 0.0];
  p.head = [0.3 * e, 0.15 * e, 0];
  const off = env(t, 0.25, 0.5, 0.85, 1.15); // the left hand away to the belt
  const seat = env(t, 1.0, 1.15, 1.25, 1.45); // the magazine pushed up into the grip
  p.lG = 1 - off; p.lH = 1;
  p.lGo = addA([0, 0, 0], [-0.3, -0.12, 0], seat);
  p.lT = [0.16, 1.03, 0.14]; p.lPole = [1, -0.8, 0];
  return p;
}
const RELOAD_AS = { shotgun: [SHOTGUN_RELOAD, shotgunReload], pistol: [PISTOL_RELOAD, pistolReload] };
/** Clips a weapon's style leaves alone (they place the weapons themselves, or hold none). */
const NO_STYLE = { ...CASUALTY, ...MELEE_CLIP, pickupOne: 1, dropPack: 1, deployDrone: 1, droneControl: 1, droneScout: 1, deskSit: 1, swim: 1, pickup: 1, drawSecondary: 1, holsterRifle: 1, drawRifle: 1, holsterSecondary: 1, drawKnife: 1, sheathKnife: 1, knifeReady: 1, stab: 1, rappel: 1, rappelStart: 1, rappelEnd: 1, fastRope: 1, zipline: 1, zipHand: 1, ropeFall: 1, die: 1 };
Object.assign(NO_STYLE, RETREAT);
const STYLE_CACHE = new Map();
/**
 * The clips for weapon kind (ai/weapons.js), baked once and shared: the armed clips held its way
 * (its own reload). {} for the rifle and the carbine (the clips as they are).
 */
export function weaponClips(kind) {
  const S = WEAPON_STYLE[kind];
  if (!S) return {};
  if (STYLE_CACHE.has(kind)) return STYLE_CACHE.get(kind);
  const c = {};
  for (const k in CLIPS) {
    if (NO_STYLE[k] || SHOOT[k]) continue;
    const [dur, fn] = k === 'reload' && RELOAD_AS[kind] ? RELOAD_AS[kind] : CLIPS[k];
    c[k] = makeClip(k, dur, styled(S, k, fn));
  }
  // put away to (and drawn from) a holster on the hip or a clip at the side, not the back
  if (HIP_SLOT[kind]) {
    c.holsterRifle = makeClip('holsterRifle', PUT_T, styled(S, 'holsterRifle', (t) => hipHolster(kind, t / PUT_T)));
    c.drawRifle = makeClip('drawRifle', DRAW_T.rifle, styled(S, 'drawRifle', (t) => hipHolster(kind, 1 - t / DRAW_T.rifle)));
  }
  STYLE_CACHE.set(kind, c);
  return c;
}
/** The firing clips for a recoil R held as weapon kind: shootClips styled. */
function weaponShootClips(R, control, kind) {
  const C = shootClips(R, control);
  const S = WEAPON_STYLE[kind];
  return Object.fromEntries(Object.keys(C).map((n) => [n, makeClip(n, C[n][0], S ? styled(S, n, C[n][1]) : C[n][1])]));
}
const SHOOT = { shoot: 1, crouchShoot: 1, proneShoot: 1 };
/** The pose of clip name at t (s) held as weapon kind, unbaked (to check: solve() it). */
export function weaponPose(kind, name, t = 0) {
  const S = WEAPON_STYLE[kind];
  const [dur, fn] = name === 'reload' && RELOAD_AS[kind] ? RELOAD_AS[kind] : SHOOT[name] ? shootClips(recoilSpec(GUN_OF[kind] ?? 'rifle'))[name] : CLIPS[name];
  return (S && !NO_STYLE[name] ? styled(S, name, fn) : fn)(t, t / dur);
}
let CLIP_CACHE = null;
/** The clips (baked once): armed ones by name, unarmed ones as name + '_u', knife ones as name + '_k'. */
export function operatorClips() {
  if (CLIP_CACHE) return CLIP_CACHE;
  const c = {};
  for (const k in CLIPS) {
    c[k] = makeClip(k, CLIPS[k][0], CLIPS[k][1]);
    if (k === 'swim') c.swim_u = c.swim;
    else if (!UNARMED_AS[k] && !NO_UNARMED[k]) c[k + '_u'] = makeClip(k + '_u', CLIPS[k][0], unarm(k, CLIPS[k][1]));
    if (!KNIFE_AS[k] && !NO_UNARMED[k]) c[k + '_k'] = makeClip(k + '_k', CLIPS[k][0], knifeAs(k, CLIPS[k][1]));
  }
  CLIP_CACHE = c;
  for (const k in c) BASE_CLIPS.add(c[k]);
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
const PARTS = ['person', 'carrier', 'legs', 'face', 'hands', 'pack', 'helmet', 'gun', 'mag'];
export const LOD = {
  full: { person: 0.0045, carrier: 0.0045, legs: 0.005, face: 0.0021, hands: 0.0026, pack: 0.0045, helmet: 0.0021, gun: 0.0026, mag: 0.0022 },
  game: { person: 0.006, carrier: 0.006, legs: 0.0065, face: 0.003, hands: 0.0035, pack: 0.006, helmet: 0.003, gun: 0.0035, mag: 0.003 },
  far: { person: 0.009, carrier: 0.009, legs: 0.009, face: 0.0045, hands: 0.005, pack: 0.009, helmet: 0.0045, gun: 0.005, mag: 0.0045 },
  // what a figure wears beyond a few metres (and what every figure's shadow is cast with):
  // about a fifteenth of the triangles of 'game'
  low: { person: 0.021, carrier: 0.021, legs: 0.022, face: 0.0095, hands: 0.011, pack: 0.021, helmet: 0.0095, gun: 0.011, mag: 0.01 },
};
/** Beyond this (m from the camera) a figure shows its 'low' meshes (setDetail). */
export const NEAR_DETAIL = 6;
const cache = {};
/** Overridable: how to create a sculpt worker (the single-file build inlines it). */
export const workerFactory = { make: () => new Worker(new URL('./sculpt.worker.js', import.meta.url), { type: 'module' }) };

/**
 * Sculpts and assembles the operator's geometry once per level of detail.
 * onProgress(part, 0..1). Resolves to the assets OperatorFigure is built from. Unless distant is
 * false, the 'low' set is sculpted after it and hung on the result as A.lo (figures far from the
 * camera, and every figure's shadow, use it from then on: OperatorFigure.setDetail).
 */
export function loadOperatorAssets({ lod = 'game', onProgress, sync = false, distant = !sync } = {}) {
  if (cache[lod]) return cache[lod];
  if (distant && lod !== 'low' && lod !== 'far') {
    const p = loadOperatorAssets({ lod, onProgress, sync, distant: false });
    return (cache[lod] = p.then((A) => {
      A.loReady = loadOperatorAssets({ lod: 'low', sync, distant: false }).then((lo) => (A.lo = lo));
      return A;
    }));
  }
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
    carrier: geometryOf(R.carrier, null, 'body'),
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
  Object.assign(A, secondaryAndTorch(A), droneKit(), weaponKit());
  A.clips = operatorClips();
  A.tris = [...A.person, A.carrier, A.pack, A.helmet, A.rifle, A.mag].reduce((s, g) => s + g.index.count / 3, 0);
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
  // where the rifle rides on the back when the carbine is in his hands
  const sl2 = solve(Object.assign(pose0(), { sling2: 1 }));
  return { secondary: g, slungPos: sl.weaponPos.clone(), slungQ: sl.weapon.clone(), slung2Pos: sl2.weaponPos.clone(), slung2Q: sl2.weapon.clone(), torchGun: torch, torchTanks: tanks, nozzle: rl2w(1.0, 0.03, 0) };
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
/**
 * The combat knife (knife-local: the grip's centre at the origin, the blade along +y, the edge
 * towards +x, the flats facing z): a clip-point blade with a fuller, a guard, a ribbed black grip
 * and a pommel; its sheath on the right thigh (thigh-bone space) and where the knife sits in the
 * fist (hand-bone space) and in the sheath.
 */
function knifeKit() {
  const steel = new THREE.MeshStandardMaterial({ color: '#3b3e42', roughness: 0.3, metalness: 0.85 });
  const fullerM = new THREE.MeshStandardMaterial({ color: '#202224', roughness: 0.45, metalness: 0.8 });
  const gripM = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.85, metalness: 0.05 });
  const polyM = new THREE.MeshStandardMaterial({ color: '#1c1d1b', roughness: 0.6, metalness: 0.1 });
  const webM = new THREE.MeshStandardMaterial({ color: '#5e5040', roughness: 0.95 });
  const knife = new THREE.Group();
  const add = (grp, geo, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    grp.add(m);
    return m;
  };
  // the blade: the spine straight, then the clip falling to the point; the edge with its belly
  const y0 = 0.062;
  const s = new THREE.Shape();
  s.moveTo(-0.012, y0);
  s.lineTo(-0.012, y0 + 0.112);
  s.quadraticCurveTo(-0.007, y0 + 0.15, 0.001, y0 + 0.178);
  s.quadraticCurveTo(0.016, y0 + 0.135, 0.016, y0 + 0.085);
  s.lineTo(0.016, y0 + 0.01);
  s.lineTo(0.011, y0);
  s.lineTo(-0.012, y0);
  const blade = new THREE.ExtrudeGeometry(s, { depth: 0.0024, bevelEnabled: true, bevelThickness: 0.0012, bevelSize: 0.0026, bevelSegments: 1, curveSegments: 10 });
  blade.translate(0, 0, -0.0012);
  add(knife, blade, steel);
  add(knife, new THREE.BoxGeometry(0.0045, 0.085, 0.0053), fullerM, -0.0045, y0 + 0.058); // the fuller, both flats
  add(knife, new THREE.BoxGeometry(0.058, 0.008, 0.017), fullerM, 0.001, y0 - 0.004); // guard
  add(knife, new THREE.CylinderGeometry(0.0125, 0.0135, 0.11, 12), gripM);
  for (let i = -2; i <= 2; i++) {
    const r = add(knife, new THREE.TorusGeometry(0.0132, 0.0018, 5, 14), gripM, 0, i * 0.019);
    r.rotation.x = Math.PI / 2;
  }
  add(knife, new THREE.CylinderGeometry(0.0135, 0.012, 0.012, 12), steel, 0, -0.061); // pommel
  // in the fist: as the pistol grip is held, the blade out of the top of the fist
  const knifeHand = { p: K_G0.clone(), q: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(K_E0, K_B0, K_E0.clone().cross(K_B0))) };
  // in the sheath: blade down, edge forward, on the outside of the right thigh
  const knifeSheath = { p: V3(KNIFE_SHEATH).sub(REST.thighR), q: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(V3([0, 0, 1]), V3([0, -1, 0]), V3([1, 0, 0]))) };
  const sheath = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.copy(knifeSheath.p);
  inner.quaternion.copy(knifeSheath.q);
  sheath.add(inner);
  add(inner, new THREE.BoxGeometry(0.05, 0.17, 0.021), polyM, 0.002, 0.145);
  add(inner, new THREE.BoxGeometry(0.056, 0.018, 0.027), polyM, 0.002, 0.066); // the mouth, the retention strap over the guard
  add(inner, new THREE.BoxGeometry(0.022, 0.03, 0.03), webM, -0.004, 0.047);
  const tip = add(inner, new THREE.CylinderGeometry(0.001, 0.034, 0.04, 4), polyM, 0.002, 0.25);
  tip.rotation.y = Math.PI / 4;
  tip.scale.set(1, 1, 0.45);
  // the leg strap round the thigh, and the hanger up to the belt
  const band = new THREE.TorusGeometry(0.086, 0.006, 6, 28);
  band.rotateX(Math.PI / 2);
  band.scale(1, 2.2, 1);
  const thighAt = (y) => V3([-0.1, 0.95, 0]).lerp(V3([-0.115, 0.52, 0.045]), (0.95 - y) / 0.43).sub(REST.thighR);
  add(sheath, band, webM, ...thighAt(0.82).toArray());
  add(sheath, new THREE.BoxGeometry(0.006, 0.07, 0.026), webM, ...V3([-0.195, 1.04, -0.065]).sub(REST.thighR).toArray());
  return { knife, knifeHand, knifeSheath, sheath };
}
/** The flash-bang (axis along y, centred): a short perforated cylinder, its fuse, spoon and pin; on the belt (hips space) and in the hand. */
function flashKit() {
  const body = new THREE.MeshStandardMaterial({ color: '#3a3f30', roughness: 0.55, metalness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: '#15171a', roughness: 0.6, metalness: 0.4 });
  const steel = new THREE.MeshStandardMaterial({ color: '#8a8d8f', roughness: 0.35, metalness: 0.9 });
  const g = new THREE.Group();
  const add = (geo, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  add(new THREE.CylinderGeometry(0.021, 0.021, 0.09, 16), body);
  for (const y of [-0.026, 0.026]) add(new THREE.CylinderGeometry(0.0215, 0.0215, 0.009, 16), dark, 0, y); // the vent holes
  add(new THREE.CylinderGeometry(0.009, 0.011, 0.022, 10), steel, 0, 0.056);
  add(new THREE.BoxGeometry(0.005, 0.075, 0.013), steel, 0.023, 0.02).rotation.z = 0.06;
  const ring = add(new THREE.TorusGeometry(0.011, 0.0017, 5, 14), steel, -0.016, 0.068);
  ring.rotation.y = Math.PI / 2;
  const flashBelt = { p: V3([-0.115, 1.0, 0.105]).sub(REST.hips), q: new THREE.Quaternion() };
  const flashHand = { p: V3(P.rw([0.285, -0.075, 0.035])).sub(REST.handR), q: new THREE.Quaternion().setFromUnitVectors(UP, K_B0.clone().normalize()) };
  return { flashbang: g, flashBelt, flashHand };
}
/**
 * The other primaries, in weapon-bone space (rifle-local laid out as the rifle: x along the
 * barrel, the pistol grip where the rifle's is, so the right hand fits each as it fits the rifle):
 * a pump shotgun (its pump a mesh of its own, slid along the barrel by the left hand: pumpAxis),
 * a pistol, and the machine gun's extras over the rifle (a heavy barrel, a box of belt, a bipod).
 */
function gunKit() {
  const steel = new THREE.MeshStandardMaterial({ color: '#2a2c2e', roughness: 0.42, metalness: 0.85 });
  const poly = new THREE.MeshStandardMaterial({ color: '#1b1c1a', roughness: 0.7, metalness: 0.1 });
  const wood = new THREE.MeshStandardMaterial({ color: '#5a3a22', roughness: 0.65, metalness: 0.05 });
  const olive = new THREE.MeshStandardMaterial({ color: '#4c5236', roughness: 0.7, metalness: 0.2 });
  // a part laid along the barrel (cylinder) or a box, both placed in rifle-local terms
  const tube = (g, r, x0, x1, y, z, mat, seg = 12) => {
    const c = new THREE.CylinderGeometry(r, r, x1 - x0, seg);
    c.rotateZ(-Math.PI / 2);
    c.translate((x0 + x1) / 2, y, z);
    return put(g, c, mat);
  };
  const box = (g, w, h, d, x, y, rz, mat, z = 0) => {
    const b = new THREE.BoxGeometry(w, h, d);
    b.rotateZ(rz);
    b.translate(x, y, z);
    return put(g, b, mat);
  };
  function put(g, geo, mat) {
    const p = geo.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      p.setXYZ(i, ...rl2w(v.x, v.y, v.z).toArray());
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    g.add(m);
    return m;
  }
  // the shotgun: stock, receiver, barrel over the magazine tube, the pump on the tube
  const shotgun = new THREE.Group();
  shotgun.name = 'shotgun';
  box(shotgun, 0.3, 0.05, 0.04, 0.02, -0.0, 0.1, wood); // the stock, dropping to the butt
  box(shotgun, 0.05, 0.13, 0.045, -0.12, -0.03, 0.1, poly); // the butt pad
  box(shotgun, 0.035, 0.11, 0.035, 0.28, -0.075, -0.35, wood); // the grip
  box(shotgun, 0.22, 0.065, 0.048, 0.3, 0.02, 0, steel); // the receiver
  tube(shotgun, 0.012, 0.4, 0.97, 0.035, 0, steel); // the barrel
  tube(shotgun, 0.0115, 0.4, 0.86, 0.0, 0, steel); // the magazine tube
  box(shotgun, 0.012, 0.012, 0.008, 0.95, 0.052, 0, steel); // the bead
  const pump = new THREE.Group();
  pump.name = 'pump';
  tube(pump, 0.022, 0.49, 0.65, 0.003, 0, wood, 14);
  shotgun.add(pump);
  // the pistol: slide over the frame, the grip where the rifle's is
  const pistol = new THREE.Group();
  pistol.name = 'pistol';
  box(pistol, 0.19, 0.032, 0.028, 0.335, 0.008, 0, steel); // the slide
  box(pistol, 0.15, 0.022, 0.026, 0.33, -0.018, 0, poly); // the frame, the dust cover
  box(pistol, 0.034, 0.11, 0.03, 0.28, -0.075, -0.35, poly); // the grip
  box(pistol, 0.05, 0.006, 0.02, 0.315, -0.045, 0, poly); // the trigger guard
  box(pistol, 0.008, 0.012, 0.008, 0.42, 0.028, 0, steel); // the front sight
  // the machine gun's extras over the rifle: a heavy barrel, a box of belt under it, a folded bipod
  const mg = new THREE.Group();
  mg.name = 'mgKit';
  tube(mg, 0.016, 0.62, 1.1, 0.045, 0, steel);
  box(mg, 0.12, 0.1, 0.07, 0.42, -0.1, 0, olive, 0.045);
  box(mg, 0.3, 0.01, 0.01, 0.88, 0.02, 0, steel, 0.018);
  box(mg, 0.3, 0.01, 0.01, 0.88, 0.02, 0, steel, -0.018);
  return { guns: { shotgun, pistol, mg }, pumpAxis: rl2w(1, 0, 0) };
}
/** The knife with its sheath and the flash-bang, the other primaries (shotgun, pistol, the MG's extras), and where they sit (plain three.js: tests use it headless). */
export function weaponKit() {
  return Object.assign(knifeKit(), flashKit(), gunKit());
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
// the primaries: the rifle's mesh as it is ('rifle'), with extras over it ('mg'), or hidden under one of their own
const PRIMARY_MESH = { rifle: 'rifle', mg: 'extra', shotgun: 'own', pistol: 'own' };
// each handling kind's gun (ai/recoil.js GUNS) for its firing clips when no recoil was set
const GUN_OF = { shotgun: 'shotgun', pistol: 'pistol', mg: 'mg' };
const HIDDEN = new THREE.MeshBasicMaterial({ visible: false });
const _pm = new THREE.Matrix4(), _pv = new THREE.Vector3();
// the pump at rest (rifle-local x of the palm on it) and the palm's place across the barrel
const PUMP_REST = P.fgp.c[0];
const PUMP_PERP = (() => {
  const ax = rl2w(1, 0, 0), v = V3(P.rw(P.fgp.c)).sub(REST.weapon);
  return v.addScaledVector(ax, -v.dot(ax));
})();
// every clip a weapon's style may replace (weaponClips), and the clips as baked first (operatorClips)
const STYLED = [...Object.keys(CLIPS).filter((k) => !NO_STYLE[k] && !SHOOT[k]), 'holsterRifle', 'drawRifle'];
const BASE_CLIPS = new Set();
const HEAD_FRAME = V3(P.H.o);
const NO_TWIST = 2.3;
const ROPE_L = V3(P.rw(P.fgp.c)).sub(REST.handL); // the left palm (where it holds the foregrip)
const ROPE_H = V3([0, 0.92, 0.17]).sub(REST.hips); // the belay device on the harness
// aiming at a point on the ground (where the target stands): at his chest, from the shooter's eyes
const AIM_H = 1.2;
const EYE_H = { crouchAim: 1.0, crouchShoot: 1.0 };
/**
 * An operator: build it from loaded assets, add .group to the scene, and each frame call
 * update(dt). play(name) cross-fades to a clip; setAim(point) twists the upper body towards a
 * point while moving; detach(part, physics) drops the rifle, helmet or pack.
 * onRelease(worldPos, figure) is called when a thrown grenade leaves the hand.
 */
/**
 * Two-bone inverse kinematics on the figure's own bones (world space): the upper arm turned so the
 * elbow is where the arm's lengths and the pole put it, the forearm so the wrist reaches T.
 */
const _q = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()];
function turnWorld(bone, from, to) {
  const q = _q[0].setFromUnitVectors(from.normalize(), to.normalize());
  const wq = bone.getWorldQuaternion(_q[1]);
  const pq = bone.parent.getWorldQuaternion(_q[2]);
  bone.quaternion.copy(pq.invert().multiply(q.multiply(wq)));
  bone.updateMatrixWorld(true);
}
export function armIK(upper, fore, hand, T, pole) {
  const S = upper.getWorldPosition(new THREE.Vector3()), E = fore.getWorldPosition(new THREE.Vector3()), W = hand.getWorldPosition(new THREE.Vector3());
  const a = S.distanceTo(E), b = E.distanceTo(W);
  const E1 = ikV(S, T, a, b, pole);
  turnWorld(upper, E.clone().sub(S), E1.clone().sub(S));
  const W1 = hand.getWorldPosition(new THREE.Vector3()), E2 = fore.getWorldPosition(new THREE.Vector3());
  turnWorld(fore, W1.sub(E2), T.clone().sub(E2));
}
/** A faint cone of light in the air (the beam: seen in smoke, fog and the dark); 1 m long, along +y from its tip. */
const BEAM_GEO = (() => {
  const geo = new THREE.ConeGeometry(Math.tan(0.3), 1, 16, 1, true);
  geo.translate(0, -0.5, 0);
  geo.rotateX(Math.PI);
  return geo;
})();
export function makeBeam(len = 9) {
  const m = new THREE.Mesh(BEAM_GEO, new THREE.MeshBasicMaterial({ color: '#fff1d0', transparent: true, opacity: 0.045, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  m.userData.len = len;
  m.visible = false;
  m.renderOrder = 4;
  m.raycast = () => {};
  return m;
}
const _Y = new THREE.Vector3(0, 1, 0);
export function placeBeam(m, from, dir) {
  m.position.copy(from);
  m.quaternion.setFromUnitVectors(_Y, dir.clone().normalize());
  m.scale.setScalar(m.userData.len);
}
export class OperatorFigure {
  constructor(A, { zones = true, loadout = 'rifle' } = {}) {
    this.A = A;
    this.loadout = loadout;
    // (unarmed: no weapon at all, fists up: hand-to-hand, ai/melee.js)
    this.weapon = loadout === 'torch' ? 'torch' : loadout === 'unarmed' ? 'fists' : 'primary';
    // the primary (setPrimary): the rifle, a shotgun, a pistol, the MG; the clips held its way (restyle)
    this.primaryKind = loadout === 'torch' ? 'torch' : 'rifle';
    this.styleKind = 'rifle';
    this.guns = {};
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
    this.lod = []; // [mesh, key in A, index or -1]: what setDetail swaps
    this.detail = true;
    A.person.forEach((geo, i) => {
      const m = new THREE.SkinnedMesh(geo, mat);
      this.lod.push([m, 'person', i]);
      m.frustumCulled = false;
      m.castShadow = m.receiveShadow = true;
      person.add(m);
      m.bind(skel);
    });
    // each frame, just before the body is drawn: full meshes near the camera, the low ones further off
    // (takes effect from the next frame; the shadow pass does not call it)
    this.autoDetail = true;
    person.children[0].onBeforeRender = (r, s, cam) => this.autoDetail && this.detailFor(cam);
    this.sling = new THREE.SkinnedMesh(A.sling, mat);
    this.sling.frustumCulled = false;
    this.sling.castShadow = true;
    person.add(this.sling);
    this.sling.bind(skel);
    const mk = (geo, key) => {
      const m = new THREE.Mesh(geo, mat);
      this.lod.push([m, key, -1]);
      m.castShadow = m.receiveShadow = true;
      return m;
    };
    const rifle = mk(A.rifle, 'rifle');
    rifle.name = 'rifle';
    bones.weapon.add(rifle);
    const mag = mk(A.mag, 'mag');
    mag.name = 'mag';
    bones.mag.add(mag);
    const helmet = new THREE.Group();
    helmet.name = 'helmet';
    helmet.add(mk(A.helmet, 'helmet'));
    A.cords.forEach((c) => helmet.add(new THREE.Mesh(c, A.black)));
    bones.head.add(helmet);
    const pack = new THREE.Group();
    pack.name = 'pack';
    pack.add(mk(A.pack, 'pack'));
    const ant = new THREE.Mesh(A.antenna, A.black);
    ant.castShadow = true;
    pack.add(ant);
    bones.chest.add(pack);
    // the secondary carbine, across the back
    const sec = mk(A.secondary, 'secondary');
    sec.name = 'secondary';
    sec.position.copy(A.slungPos);
    sec.quaternion.copy(A.slungQ);
    bones.chest.add(sec);
    // the plate carrier with its pouches: a skinned mesh of its own over the shirt (setArmour)
    const carrier = new THREE.SkinnedMesh(A.carrier, mat);
    this.lod.push([carrier, 'carrier', -1]);
    carrier.name = 'carrier';
    carrier.frustumCulled = false;
    carrier.castShadow = carrier.receiveShadow = true;
    person.add(carrier);
    carrier.bind(skel);
    this.armour = true;
    // the knife (in its sheath on the right thigh until drawn) and the flash-bang on the belt
    const knife = A.knife.clone();
    knife.name = 'knife';
    bones.thighR.add(A.sheath.clone());
    const flashBelt = A.flashbang.clone();
    flashBelt.position.copy(A.flashBelt.p);
    bones.hips.add(flashBelt);
    this.flashBelt = flashBelt;
    const flashHand = (this.flashHand = A.flashbang.clone());
    flashHand.position.copy(A.flashHand.p);
    flashHand.quaternion.copy(A.flashHand.q);
    flashHand.visible = false;
    bones.handR.add(flashHand);
    this.parts = { person, rifle, mag, helmet, pack, secondary: sec, knife, carrier };
    this.restParent = { rifle: bones.weapon, mag: bones.mag, helmet: bones.head, pack: bones.chest, secondary: bones.chest, knife: bones.thighR };
    this.holdKnife(false);
    // the rope, while he rappels: anchor - guide hand - harness - brake hand - the tail
    const ropeM = new THREE.MeshStandardMaterial({ color: '#2f3527', roughness: 0.9 });
    const ropeG = new THREE.CylinderGeometry(0.0055, 0.0055, 1, 6);
    this.rope = new THREE.Group();
    for (let i = 0; i < 4; i++) this.rope.add(new THREE.Mesh(ropeG, ropeM));
    this.rope.visible = false;
    this.rope.children.forEach((m) => (m.frustumCulled = false));
    g.add(this.rope);
    this.look = 0;
    this.bent = []; // [bone, undo] for the twist and look laid over the clip
    this.pitch = 0;
    this.clipSpeed = {};
    if (loadout === 'torch') {
      // a flame trooper: the flame gun in place of the rifle, the tanks on his back
      rifle.visible = mag.visible = this.sling.visible = false;
      this.parts.torch = A.torchGun.clone();
      bones.weapon.add(this.parts.torch);
      this.parts.tanks = A.torchTanks.clone();
      bones.chest.add(this.parts.tanks);
      this.restParent.torch = bones.weapon;
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
    // thermal monocular (flipped down over the right eye) and the weapon light
    const thermal = (this.thermal = new THREE.Group());
    const tm = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.07, 12), A.black);
    tm.rotation.x = Math.PI / 2;
    tm.position.set(-0.032, 0.026, 0.135);
    const tl = new THREE.Mesh(new THREE.CircleGeometry(0.016, 12), new THREE.MeshBasicMaterial({ color: '#3cff8a' }));
    tl.position.set(-0.032, 0.026, 0.1);
    tl.rotation.y = Math.PI;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.05, 0.012), A.black);
    arm.position.set(-0.03, 0.06, 0.12);
    thermal.add(tm, tl, arm);
    thermal.visible = false;
    hf.add(thermal);
    this.lightOn = false;
    // the hand torch (ai/flashlight.js): in its pouch on the left of the belt, or in the left hand
    const tMat = new THREE.MeshStandardMaterial({ color: '#1c1e21', roughness: 0.45, metalness: 0.6 });
    const torchBody = (tg) => {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.014, 0.15, 10), tMat);
      b.rotation.z = -Math.PI / 2;
      b.position.x = 0.02;
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.016, 0.04, 12), tMat);
      h.rotation.z = -Math.PI / 2;
      h.position.x = 0.11;
      tg.add(b, h);
      return tg;
    };
    const belt = (this.torchBelt = torchBody(new THREE.Group()));
    belt.rotation.z = Math.PI / 2;
    belt.position.set(0.2, -0.05, 0.1);
    bones.hips.add(belt);
    const held = (this.torchMesh = torchBody(new THREE.Group()));
    const lens = (this.torchLens = new THREE.Sprite(new THREE.SpriteMaterial({ map: A.flashTex, color: '#fff2c8', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })));
    lens.position.x = 0.135;
    lens.scale.setScalar(0.08);
    held.add(lens);
    held.visible = lens.visible = false;
    g.add(held);
    this.hasTorch = true;
    this.torchOut = false;
    this.torchOn = false;
    this.torchGrip = 'harries';
    this.torchBeam = makeBeam();
    g.add(this.torchBeam);
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
      if (ONCE[k.replace(/_[uk]$/, '')]) {
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
      // a weapon put away: empty-handed (the rifle on his back, the pistol in its holster, the
      // flame gun's wand on its clip) until he draws another
      if (was === 'holsterRifle' && HIP_SLOT[this.handling]) this.stowHip(this.weapon === 'torch' ? this.parts.torch : this.parts.rifle);
      if (was === 'holsterRifle' || was === 'sheathKnife') this.weapon = 'none';
      // the pack down on the ground in front of him (the flame gun's tanks and wand with it)
      if (was === 'dropPack')
        for (const o of [this.parts.pack, this.parts.tanks])
          if (o && o.parent === this.bones.bag) {
            this.group.parent?.attach(o);
            o.userData.onGround = true;
          }
      if (was === 'holsterSecondary') {
        this.stowSecondary();
        this.unstowRifle();
        this.weapon = 'none';
      }
      if (was === 'rappelEnd') this.resume = this.state = 'idle';
      this.onFinished?.(was, this);
      if (this.shown !== was) return;
      const next = this.switching;
      this.switching = null;
      // switching weapons: the draw follows the put-away (it starts where that ended)
      if (next) this.play(next, { fade: 0, restart: true });
      // off the rope, the rifle comes back round from his back
      else if (was === 'rappelEnd' && this.weapon === 'primary' && this.parts.rifle.parent === this.bones.weapon) this.play('drawRifle', { fade: 0.1 });
      else this.play(this.resume || 'idle', { fade: 0.2 });
    });
    if (loadout === 'unarmed') {
      // no rifle, no carbine: nothing but his hands
      rifle.visible = mag.visible = this.sling.visible = sec.visible = false;
    }
    if (PRIMARY_MESH[loadout]) this.setPrimary(loadout);
    else this.restyle();
    this.play('idle', { fade: 0 });
  }
  /**
   * The clip actually played for a name: unarmed versions without a rifle, knife versions with
   * the knife out or empty-handed after putting a weapon away (weapon 'knife' or 'none').
   */
  clipName(name) {
    if (NO_UNARMED[name]) return name;
    if (this.weapon === 'fists') {
      // fists up: the guard for the aimed clips, the hand-to-hand clips themselves, else empty-handed
      const n = FIST_AS[name] ?? KNIFE_AS[name] ?? name;
      return NO_UNARMED[n] ? n : n + '_k';
    }
    if (this.weapon === 'knife' || this.weapon === 'none') {
      const n = KNIFE_AS[name] ?? name;
      return NO_UNARMED[n] ? n : n + '_k';
    }
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
    } else if (this.shown === 'droneControl' || this.shown === 'droneScout') {
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
    let vmax = 4;
    if (F.t < 2.6) goal = F.start.clone().setY(g.y + 0.1 + 3.4 * sm01((F.t - 0.6) / 2));
    else if (this.droneGoal) {
      // scouting: straight to the next search point, higher and faster
      goal = this.droneGoal.clone().setY(g.y + 6);
      vmax = 6;
    } else {
      F.ang += dt * 0.55;
      goal = new THREE.Vector3(T.x + Math.cos(F.ang) * 3.5, g.y + 4, T.z + Math.sin(F.ang) * 3.5);
    }
    const want = goal.sub(d.position);
    const sp = Math.min(vmax, want.length() * 1.5);
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
    this.play('drawSecondary', { fade: 0.15 });
    return this.weapon === 'secondary';
  }
  /**
   * Switch weapons: put the one in his hands away (the rifle onto his back, the carbine back over
   * the shoulder, the knife into its sheath), then draw the other. to: 'rifle' | 'secondary' |
   * 'knife'. Returns the time it takes (s; SWITCH_TIME[to] when he had another weapon in his hands),
   * 0 when he cannot (he has it already, it is gone, he is down, or a flame trooper).
   */
  switchWeapon(to) {
    const want = to === 'rifle' || to === 'primary' ? 'primary' : to;
    const draw = { primary: 'drawRifle', secondary: 'drawSecondary', knife: 'drawKnife', fists: 'fistsUp' }[want];
    const P = this.parts, W = this.bones.weapon;
    // (a flame trooper's primary is the flame gun: its wand onto the clip at his side and back)
    const torch = this.loadout === 'torch';
    const have = torch && want === 'primary' ? 'torch' : want;
    if (!draw || this.shown === 'die' || have === this.weapon) return 0;
    if (this.loadout === 'unarmed' && want !== 'fists') return 0;
    if (want !== 'fists' && P[have === 'primary' ? 'rifle' : have]?.userData.pivot) return 0;
    if (torch && have === 'torch' && P.torch.parent !== W && P.torch.parent !== this.bones.hips) return 0; // (it went with the tanks)
    const put = this.weapon === 'knife' ? 'sheathKnife'
      : this.weapon === 'secondary' && P.secondary.parent === W ? 'holsterSecondary'
      : this.weapon === 'primary' && this.armed && P.rifle.parent === W ? 'holsterRifle'
      : this.weapon === 'torch' && P.torch?.parent === W ? 'holsterRifle' : null;
    const dur = (n) => (this.actions[n] ?? this.actions[n + '_k'])?.getClip().duration ?? this.A.clips[n].duration;
    this.play(put ?? draw, { fade: 0.15, restart: true });
    if (put) this.switching = draw;
    return (put ? dur(put) : 0) + dur(draw);
  }
  /**
   * Before a weapon clip: the weapons where the clip needs them (on the weapon bone, slung on the
   * chest, the knife in its sheath). Returns the clip to play, or null when he cannot.
   */
  arrange(name) {
    const P = this.parts, W = this.bones.weapon;
    const torch = this.loadout === 'torch';
    switch (name) {
      case 'holsterRifle':
        if (this.weapon === 'secondary') return P.secondary.parent === W ? 'holsterSecondary' : null;
        if (this.weapon === 'torch') return P.torch?.parent === W ? name : null;
        return !torch && this.weapon === 'primary' && this.armed && P.rifle.parent === W ? name : null;
      case 'holsterSecondary':
        return this.weapon === 'secondary' && P.secondary.parent === W ? name : null;
      case 'drawRifle':
        if (torch) {
          // the flame gun's wand off its clip at his side
          if (P.torch.userData.pivot || (P.torch.parent !== W && P.torch.parent !== this.bones.hips)) return null;
          this.stowSecondary();
          this.unstowHip(P.torch);
          this.weapon = 'torch';
          this.armed = true;
          return name;
        }
        if (P.rifle.userData.pivot) return null;
        this.stowSecondary();
        this.unstowRifle();
        this.unstowHip(P.rifle);
        this.weapon = 'primary';
        this.armed = true;
        return name;
      case 'drawSecondary':
        if (P.secondary.userData.pivot) return null;
        if (P.secondary.parent !== W) {
          // it rides on the weapon bone from the start: the clip begins with that bone in the slung pose
          this.stowRifle();
          W.add(P.secondary);
          P.secondary.position.set(0, 0, 0);
          P.secondary.quaternion.identity();
        }
        this.weapon = 'secondary';
        this.drawing = true;
        return name;
      case 'drawKnife':
        if (torch || P.knife.userData.pivot) return null;
        if (P.secondary.parent === W) {
          this.stowSecondary();
          this.unstowRifle();
        }
        this.weapon = 'knife';
        return name;
      case 'sheathKnife':
        return this.weapon === 'knife' ? name : null;
      case 'fistsUp':
        // hand-to-hand: the carbine back over the shoulder, the rifle on his back
        if (P.secondary.parent === W) {
          this.stowSecondary();
          this.unstowRifle();
        }
        this.weapon = 'fists';
        return name;
    }
    return name;
  }
  /** A weapon put away into its holster on the hip, or its clip at the side (HIP_SLOT): onto the hips, where the put-away left it. */
  stowHip(obj) {
    if (!obj || obj.parent !== this.bones.weapon) return;
    this.group.updateMatrixWorld(true);
    this.bones.hips.attach(obj);
  }
  /** Out of the holster (or off its clip) onto the weapon bone again. */
  unstowHip(obj) {
    if (!obj || obj.parent !== this.bones.hips) return;
    this.bones.weapon.add(obj);
    obj.position.set(0, 0, 0);
    obj.quaternion.identity();
  }
  /**
   * Drop the weapon in his hands (whatever it is: the rifle, shotgun, pistol or machine gun, the
   * carbine, the knife, the flame gun's wand): it leaves his hands DROP_T into the clip and falls
   * as a rigid body (physics, under scene); he is bare-handed after it (fists up). Returns
   * whether he does.
   */
  dropWeapon(physics, scene) {
    const part = { primary: 'rifle', secondary: 'secondary', knife: 'knife', torch: 'torch' }[this.weapon];
    if (!part || this.shown === 'die' || !this.parts[part] || this.parts[part].userData.pivot) return false;
    this.play('dropWeapon', { fade: 0.12, restart: true });
    this.dropping = { part, physics, scene };
    return true;
  }
  /**
   * Pick dropped gear up (names: 'rifle', 'secondary', 'knife', 'torch', 'helmet', 'pack'): bent
   * down, both hands for a long gun or the pack, one hand for a pistol, the knife or the helmet;
   * or (o.roll) in a forward roll over it. It is his again at the grab (PICK_T). Returns the clip,
   * or false (nothing of that lying about).
   */
  pickUp(names = ['rifle'], o = {}) {
    const P = this.parts;
    names = names.filter((n) => P[n]?.userData.pivot || (P[n]?.userData.onGround && n === 'pack'));
    if (!names.length || this.shown === 'die') return false;
    const small = names.every((n) => n === 'knife' || n === 'helmet' || (n === 'rifle' && this.primaryKind === 'pistol'));
    const clip = o.roll ? 'rollPickup' : small ? 'pickupOne' : 'pickup';
    this.play(clip, { restart: true, fade: 0.15, speed: o.speed });
    this.picking = { names, clip };
    return clip;
  }
  /**
   * The pack off: unstrapped (the chest and waist buckles, the right shoulder strap, then the
   * left), swung round to the front and lowered to the ground in front of him; it stays there.
   * A flame trooper's tanks come off with it (the wand with them).
   */
  dropPack() {
    const pack = this.parts.pack, bag = this.bones.bag;
    if (this.droneFly || pack.userData.pivot || pack.parent !== this.bones.chest || this.shown === 'die') return false;
    bag.add(pack);
    pack.position.set(0, 0, 0);
    pack.quaternion.identity();
    const tanks = this.parts.tanks;
    if (tanks && tanks.parent === this.bones.chest) {
      bag.add(tanks);
      tanks.position.set(0, 0, 0);
      tanks.quaternion.identity();
      const wand = this.parts.torch;
      if (wand && !wand.userData.pivot) {
        this.group.updateMatrixWorld(true);
        tanks.attach(wand);
        if (this.weapon === 'torch') this.weapon = 'fists';
      }
    }
    this.play('dropPack', { fade: 0.2, restart: true });
    return true;
  }
  /** The rifle (with its magazine) onto his back while the carbine is in his hands. */
  stowRifle() {
    const { rifle, mag } = this.parts;
    if (rifle.parent !== this.bones.weapon) return;
    rifle.add(mag);
    mag.position.copy(MGRAB).sub(REST.weapon);
    mag.quaternion.identity();
    mag.scale.set(1, 1, 1);
    this.bones.chest.add(rifle);
    rifle.position.copy(this.A.slung2Pos);
    rifle.quaternion.copy(this.A.slung2Q);
  }
  /** The rifle back on the weapon bone (and the magazine on its own). */
  unstowRifle() {
    const { rifle, mag } = this.parts;
    if (rifle.parent !== this.bones.chest) return;
    this.bones.weapon.add(rifle);
    rifle.position.set(0, 0, 0);
    rifle.quaternion.identity();
    this.bones.mag.add(mag);
    mag.position.set(0, 0, 0);
    mag.quaternion.identity();
    mag.scale.set(1, 1, 1);
  }
  /** The carbine back across his back. */
  stowSecondary() {
    const sec = this.parts.secondary;
    if (sec.parent !== this.bones.weapon) return;
    this.bones.chest.add(sec);
    sec.position.copy(this.A.slungPos);
    sec.quaternion.copy(this.A.slungQ);
  }
  /** The knife in the right hand, or in its sheath. */
  holdKnife(inHand) {
    const k = this.parts.knife;
    const par = inHand ? this.bones.handR : this.bones.thighR;
    if (k.userData.pivot || k.parent === par) return;
    par.add(k);
    const T = inHand ? this.A.knifeHand : this.A.knifeSheath;
    k.position.copy(T.p);
    k.quaternion.copy(T.q);
  }
  /** With armour (the plate carrier, its plates and pouches) or in his shirt. */
  setArmour(on) {
    this.armour = !!on;
    this.parts.carrier.visible = this.armour;
    return this;
  }
  /**
   * The weapon's recoil (ai/recoil.js recoilSpec: kick, muzzle rise, recovery, fire mode) and the
   * shooter's control: the firing clips rebaked for it (one trigger pull each loop).
   */
  setRecoil(R, control = 1) {
    this.recoil = R;
    this.recoilControl = control;
    this.rebake();
    return this;
  }
  /**
   * The handling kind of the weapon in his hands (ai/weapons.js HANDLING): his primary ('rifle',
   * 'shotgun', 'pistol', 'mg'), 'carbine' (the secondary), 'torch' (the flame gun), 'knife', 'none'.
   */
  get handling() {
    if (this.weapon === 'torch') return 'torch';
    if (this.weapon === 'secondary') return 'carbine';
    if (this.weapon === 'knife' || this.weapon === 'none') return this.weapon;
    if (this.weapon === 'fists') return 'unarmed';
    return this.primaryKind;
  }
  /** May he do act (a clip name: a roll, crawl, a parkour move...) with the weapon in his hands? (ai/weapons.js) */
  allows(act) {
    // (the flame gun's tanks on his back rule out what they rule out, whatever is in his hands)
    return handlingAllows(this.parts.tanks?.parent === this.bones.chest ? 'torch' : this.handling, act) && handlingAllows(this.handling, act);
  }
  /**
   * His primary weapon: 'rifle', 'shotgun', 'pistol' or 'mg' (not for a flame trooper): the
   * weapon on the weapon bone (its own mesh: the rifle's hidden under it), the clips held its way.
   */
  setPrimary(kind = 'rifle') {
    if (this.loadout === 'torch' || !PRIMARY_MESH[kind] || kind === this.primaryKind) return this;
    this.primaryKind = kind;
    const rifle = this.parts.rifle;
    for (const g of Object.values(this.guns)) g.removeFromParent();
    const own = PRIMARY_MESH[kind] === 'own';
    rifle.material = own ? HIDDEN : this.mat;
    this.parts.mag.visible = !own;
    const g = this.gunMesh(kind);
    if (g) rifle.add(g);
    this.restyle();
    return this;
  }
  /** The mesh of a primary (cloned once from the assets), or null for the rifle. */
  gunMesh(kind) {
    const src = this.A.guns?.[kind];
    if (!src) return null;
    if (!this.guns[kind]) {
      this.guns[kind] = src.clone();
      if (kind === 'shotgun') this.pump = this.guns[kind].getObjectByName('pump');
    }
    return this.guns[kind];
  }
  /** The clips held the way the weapon in his hands is (WEAPON_STYLE), when that changes. */
  restyle() {
    const k = this.handling;
    if (k === 'knife' || k === 'none' || k === 'unarmed') return; // (the knife, empty-handed and hand-to-hand clips are their own)
    const kind = WEAPON_STYLE[k] !== undefined ? k : 'rifle';
    if (kind === this.styleKind && this.bakedKey) return;
    this.styleKind = kind;
    this.rebake();
  }
  /**
   * The weapon's own clips (weaponClips) and its firing clips (its recoil: setRecoil, else the
   * weapon's own), baked once for each setting and shared by every figure with it.
   */
  rebake() {
    const kind = this.styleKind ?? 'rifle';
    const S = WEAPON_STYLE[kind];
    const R = this.recoil ?? (S && GUN_OF[kind] ? recoilSpec(GUN_OF[kind]) : null);
    const control = this.recoil ? this.recoilControl ?? 1 : 1;
    const rk = R ? `${R.kind}|${R.scale}|${R.mode}|${R.rounds}|${control}` : '-';
    const key = `${kind}|${rk}`;
    if (this.bakedKey === key) return;
    const was = this.bakedKey?.split('|')[0] ?? 'rifle';
    this.bakedKey = key;
    const clips = {};
    if (was !== kind) {
      const own = weaponClips(kind);
      for (const n of STYLED) clips[n] = own[n] ?? this.A.clips[n];
    }
    if (R && kind !== 'torch') {
      let sc = SHOOT_CACHE.get(key);
      if (!sc) SHOOT_CACHE.set(key, (sc = weaponShootClips(R, control, kind)));
      Object.assign(clips, sc);
    } else for (const n of Object.keys(SHOOT)) clips[n] = this.A.clips[n];
    this.swapClips(clips);
  }
  /** Put these clips in place of the ones of the same names (the one playing goes on where it was). */
  swapClips(clips) {
    for (const name in clips) {
      const old = this.actions[name];
      const clip = clips[name];
      if (!clip || old?.getClip() === clip) continue;
      const a = this.mixer.clipAction(clip);
      if (ONCE[name]) {
        a.setLoop(THREE.LoopOnce);
        a.clampWhenFinished = true;
      }
      this.actions[name] = a;
      if (!old) continue;
      if (this.current === old) {
        const t = old.time, k = old.getEffectiveTimeScale();
        old.stop();
        a.reset();
        a.setEffectiveTimeScale(k);
        a.setEffectiveWeight(1);
        a.time = Math.min(t, clip.duration);
        a.play();
        this.current = a;
      } else old.stop();
      if (!BASE_CLIPS.has(old.getClip())) this.mixer.uncacheAction(old.getClip());
    }
  }
  /** The shotgun's pump: where the left hand has it along the barrel (it slides back in the pump stroke). */
  updatePump() {
    const B = this.bones, pump = this.pump;
    if (!pump || pump.parent?.parent !== this.parts.rifle) return;
    for (const b of [B.upperArmL, B.foreArmL, B.handL, B.weapon]) b.updateMatrix();
    const m = _pm.copy(B.upperArmL.matrix).multiply(B.foreArmL.matrix).multiply(B.handL.matrix);
    const palm = _pv.copy(ROPE_L).applyMatrix4(m).applyMatrix4(_pm.copy(B.weapon.matrix).invert());
    const ax = this.A.pumpAxis;
    const x0 = PUMP_REST + WEAPON_STYLE.shotgun.lGo[0];
    const along = palm.dot(ax);
    // (only while the hand is on it: near the barrel's axis below it)
    const off = palm.clone().addScaledVector(ax, -along).sub(PUMP_PERP).length();
    const dx = off < 0.08 ? Math.max(-PUMP_STROKE * 1.1, Math.min(0, along - x0)) : 0;
    pump.position.copy(ax).multiplyScalar(dx);
  }
  /** How fast a clip plays from now on (e.g. a veteran's reload, 0.7..1.5). */
  setClipSpeed(name, k) {
    this.clipSpeed[name] = k;
    if (this.shown === name) this.current?.setEffectiveTimeScale(k);
    return this;
  }
  /** Look up (+) or down (-), radians (about +-1.1): the head, neck and upper body bend, the arms and rifle with them, over any clip. */
  setLook(pitch) {
    this.look = Math.max(-1.2, Math.min(1.2, pitch || 0));
    return this;
  }
  /**
   * Play a clip by name (o.fade: cross-fade s; o.restart; o.speed: its speed, else the one set by
   * setClipSpeed). Weapon clips (drawRifle, drawKnife, holsterRifle...) move the weapons too.
   */
  play(name, o = {}) {
    if (this.shown === 'die' && name !== 'die' && !o.force) return this;
    this.switching = null;
    name = this.arrange(name);
    if (!name) return this;
    this.restyle();
    const key = this.clipName(name);
    const a = this.actions[key];
    if (!a) return this;
    const fade = o.fade ?? 0.25;
    if (this.current === a && !ONCE[name] && !o.restart) return this;
    if (ONCE[name] && !ONCE[this.shown]) this.resume = this.state;
    a.reset();
    a.setEffectiveTimeScale(o.speed ?? o.timeScale ?? this.clipSpeed[name] ?? 1);
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
  /**
   * World point the upper body turns to while it moves (null: look where you go). Taken as where
   * the target stands: while aiming he pitches the rifle up or down at its chest (1.2 m above it).
   */
  setAim(p) {
    this.aimAt = p ? (Array.isArray(p) ? new THREE.Vector3(p[0], p[1], p[2]) : p.clone()) : null;
  }
  /**
   * Full meshes (true) or the 'low' ones (false, once A.lo is sculpted): the same bones, material
   * and attributes, so it is only a swap of geometry. Returns whether it changed.
   */
  setDetail(hi) {
    const lo = this.A.lo;
    if (!lo || hi === this.detail) return false;
    this.detail = hi;
    const src = hi ? this.A : lo;
    for (const [m, k, i] of this.lod) m.geometry = i < 0 ? src[k] : src[k][i];
    return true;
  }
  /**
   * setDetail by the camera's distance (camera: an Object3D; measured in the figure's own metres,
   * whatever its scale in the scene; a little hysteresis, so it does not flicker).
   */
  detailFor(camera, near = NEAR_DETAIL) {
    if (!this.A.lo) return false;
    const e = this.group.matrixWorld.elements, c = camera.matrixWorld.elements;
    const k = Math.hypot(e[0], e[1], e[2]) || 1; // the figure's world scale
    const d = Math.hypot(e[12] + e[4] * 1.2 - c[12], e[13] + e[5] * 1.2 - c[13], e[14] + e[6] * 1.2 - c[14]) / k;
    return this.setDetail(this.detail ? d < near * 1.15 : d < near);
  }
  update(dt) {
    this.clock += dt;
    const g = this.group;
    this.restyle();
    // last frame's twist and look off again first: the mixer only writes a bone when its clip moves it
    for (let i = this.bent.length - 1; i >= 0; i--) this.bent[i][0].quaternion.premultiply(this.bent[i][1]);
    this.bent.length = 0;
    const bend = (b, q) => {
      b.quaternion.premultiply(q);
      this.bent.push([b, q.clone().invert()]);
    };
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
      bend(this.bones.spine, q);
      bend(this.bones.chest, q);
    }
    // looking up or down (setLook, and the aim point's height while aiming): the spine and chest
    // bend about his side axis; the head, the arms and the rifle on the chest go with them
    let pitch = this.look;
    if (this.aimAt && AIMING[this.shown]) {
      const dx = this.aimAt.x - g.position.x, dz = this.aimAt.z - g.position.z;
      pitch += Math.atan2(this.aimAt.y + AIM_H - g.position.y - (EYE_H[this.shown] ?? 1.45), Math.max(0.5, Math.hypot(dx, dz)));
    }
    if (this.shown === 'die') pitch = 0;
    pitch = Math.max(-1.2, Math.min(1.2, pitch));
    this.pitch += (pitch - this.pitch) * Math.min(1, dt * 6);
    if (Math.abs(this.pitch) > 1e-3) {
      const side = new THREE.Vector3(Math.cos(this.twist), 0, -Math.sin(this.twist));
      const Pq = this.bones.hips.quaternion.clone();
      for (const [b, k] of [[this.bones.spine, 0.4], [this.bones.chest, 0.6]]) {
        const ax = side.clone().applyQuaternion(Pq.clone().invert());
        bend(b, new THREE.Quaternion().setFromAxisAngle(ax, -k * this.pitch));
        Pq.multiply(b.quaternion);
      }
    }
    // the hand torch held by the left arm over the clip; the weapon light's beam (ai/flashlight.js)
    this.holdTorch();
    this.placeLampBeam();
    const u = this.mat.userData.uHit;
    if (u.value > 0) u.value = Math.max(0, u.value - dt * 3.5);
    // muzzle flash: told (flashUntil) or from the firing clips
    const a = this.current;
    const hasRifle = this.armed && (this.weapon === 'secondary' || (this.weapon === 'primary' && !this.parts.rifle.userData.pivot));
    const firing = this.autoFlash && (this.shown === 'shoot' || this.shown === 'crouchShoot' || this.shown === 'proneShoot') && a;
    const pk = this.weapon === 'secondary' ? 'carbine' : this.primaryKind;
    this.flash.position.copy(rl2w(pk === 'carbine' ? 0.82 : WEAPON_STYLE[pk]?.muzzle ?? 1.03, pk === 'pistol' ? 0.012 : 0.045, 0));
    if (this.primaryKind === 'shotgun') this.updatePump();
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
    // the flash-bang: off the belt, in the hand, bowled (onFlashRelease(worldPos, figure))
    if (this.shown === 'throwFlash' && a) {
      this.flashHand.visible = a.time > FLASH_HOLD[0] && a.time < FLASH_HOLD[1];
      this.flashBelt.visible = a.time <= FLASH_HOLD[0];
      if (!this.released && a.time >= THROW_FLASH_RELEASE) {
        this.released = true;
        const p = new THREE.Vector3();
        this.flashHand.getWorldPosition(p);
        this.onFlashRelease?.(p, this);
      }
    } else {
      this.flashHand.visible = false;
      this.flashBelt.visible = true;
    }
    // the weapon dropped (dropWeapon): it leaves his hands, he is bare-handed
    if (this.dropping && this.shown === 'dropWeapon' && a && a.time >= DROP_T) {
      const { part, physics, scene } = this.dropping;
      this.dropping = null;
      this.weapon = 'fists';
      const f = new THREE.Vector3(Math.sin(g.rotation.y), 0, Math.cos(g.rotation.y));
      if (physics && scene) this.detach(part, physics, scene, f.multiplyScalar(0.5).add(new THREE.Vector3(0, 0.3, 0)));
    } else if (this.dropping && this.shown !== 'dropWeapon') this.dropping = null;
    // picking up (pickUp): his again at the grab
    if (this.picking && this.shown === this.picking.clip && a && a.time >= PICK_T[this.picking.clip]) {
      const names = this.picking.names;
      this.picking = null;
      this.reequip(names);
    } else if (this.picking && this.shown !== this.picking.clip) this.picking = null;
    // the knife: in the hand from the moment he grips it until he lets go in the sheath
    let inHand = this.weapon === 'knife';
    if (a && this.shown === 'drawKnife') inHand = a.time >= KNIFE_T.grab;
    else if (a && this.shown === 'sheathKnife') inHand = a.time < KNIFE_T.release;
    this.holdKnife(inHand);
    // the rifle's sling goes with the rifle (not with the carbine on the weapon bone)
    if (this.loadout !== 'torch' && this.loadout !== 'unarmed') this.sling.visible = this.parts.rifle.parent === this.bones.weapon && PRIMARY_MESH[this.primaryKind] !== 'own';
    const fast = this.shown === 'fastRope';
    const roped = fast || this.shown === 'rappel' || this.shown === 'rappelStart' || (this.shown === 'rappelEnd' && a && a.time < 1.0);
    this.rope.visible = !!roped;
    if (roped) this.updateRope(fast);
  }
  /**
   * The rope: rappelling, from its anchor (ropeTop: a world point, set by whoever drives the
   * figure; else high on the wall) through the guide hand, the harness and the brake hand, down
   * (to ropeTail, or 40 m); fast-roping, from the anchor through both hands and between the boots.
   */
  updateRope(fast = false) {
    const g = this.group;
    g.updateMatrixWorld(true);
    const loc = (bone, v) => g.worldToLocal(bone.localToWorld(v.clone()));
    const guide = loc(this.bones.handL, ROPE_L), brake = loc(this.bones.handR, K_G0);
    const mid = fast ? loc(this.bones.footL, new THREE.Vector3()).lerp(loc(this.bones.footR, new THREE.Vector3()), 0.5) : loc(this.bones.hips, ROPE_H);
    const top = this.ropeTop ? g.worldToLocal(V3(this.ropeTop)) : new THREE.Vector3(guide.x, guide.y + 40, fast ? ROPE_FRONT : RAPPEL.wall);
    const tail = this.ropeTail ? g.worldToLocal(V3(this.ropeTail)) : (fast ? mid : brake).clone().add(new THREE.Vector3(0, -40, 0));
    const pts = [top, guide, fast ? brake : mid, fast ? mid : brake, tail];
    this.rope.children.forEach((m, i) => {
      const d = pts[i + 1].clone().sub(pts[i]);
      m.position.copy(pts[i]).addScaledVector(d, 0.5);
      m.scale.set(1, Math.max(1e-3, d.length()), 1);
      m.quaternion.setFromUnitVectors(UP, d.normalize());
    });
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
  /** Gear the squad wears: thermal monocular down, weapon light on. */
  setGear({ thermal = false, light = false } = {}) {
    this.thermal.visible = thermal;
    if (light === this.lightOn) return;
    this.lightOn = light;
    // (the light itself: render/flashlights.js lights the nearest few from lightSource(); each
    // figure has only the lens's glow and a faint beam in the air)
    if (light && !this.lampGlow) {
      const glow = (this.lampGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.A.flashTex, color: '#fff2c8', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })));
      glow.position.copy(rl2w(0.76, 0.045, 0.052));
      glow.scale.setScalar(0.09);
      this.bones.weapon.add(glow);
      this.lampBeam = makeBeam();
      this.group.add(this.lampBeam);
    }
    if (this.lampGlow) this.lampGlow.visible = this.lampBeam.visible = light;
    if (this.lampGlow) this.lampGlow.position.copy(rl2w(this.lampX(), 0.045, 0.052));
  }
  /** Where the weapon light sits along the weapon in his hands (rifle-local x). */
  lampX() {
    const pk = this.weapon === 'secondary' ? 'carbine' : this.primaryKind;
    return pk === 'carbine' ? 0.6 : (WEAPON_STYLE[pk]?.muzzle ?? 1.03) - 0.27;
  }
  /**
   * The hand torch (ai/flashlight.js): out (in the left hand) and on; grip with a pistol: 'harries'
   * (the wrists back to back under the gun) or 'fbi' (out to the side, high). The drawTorch and
   * stowTorch clips take it from and put it back in the pouch on the belt; in between the left arm
   * holds it by its own inverse kinematics over whatever clip plays (holdTorch), pointing it
   * where he looks or aims.
   */
  setTorch(out, on = false, grip = this.torchGrip) {
    this.torchOut = !!out;
    this.torchOn = !!out && !!on;
    this.torchGrip = grip === 'fbi' ? 'fbi' : 'harries';
    return this;
  }
  /** The torch drawn or put away (plays the clip; the hand takes it at the pouch). */
  drawTorch(out = true) {
    this.play(out ? 'drawTorch' : 'stowTorch', { restart: true, fade: 0.12 });
    this.torchOut = out;
    if (!out) this.torchOn = false;
    return this;
  }
  /**
   * The light he shines (world space), for the light pool (render/flashlights.js): { pos, dir, kind:
   * 'weapon' | 'hand' } or null.
   */
  lightSource() {
    if (this.torchLens.visible && this.torchWorld) return { pos: this.torchWorld.clone(), dir: this.torchDirW.clone(), kind: 'hand' };
    if (this.lightOn && this.lampGlow?.visible) {
      const p = rl2w(this.lampX(), 0.045, 0.052);
      this.bones.weapon.localToWorld(p);
      const q = new THREE.Quaternion();
      this.bones.weapon.getWorldQuaternion(q);
      return { pos: p, dir: V3(P.R.x).applyQuaternion(q).normalize(), kind: 'weapon' };
    }
    return null;
  }
  /** Where he looks (world, unit): at the aim point, else ahead, pitched as he looks. */
  lookDir() {
    const g = this.group;
    const p = new THREE.Vector3();
    g.getWorldPosition(p);
    if (this.aimAt) {
      const d = this.aimAt.clone().add(new THREE.Vector3(0, AIM_H, 0)).sub(p.add(new THREE.Vector3(0, 1.45, 0)));
      if (d.lengthSq() > 0.25) return d.normalize();
    }
    const y = g.rotation.y + this.twist * 0.5, c = Math.cos(this.pitch);
    return new THREE.Vector3(Math.sin(y) * c, Math.sin(this.pitch) - 0.05, Math.cos(y) * c).normalize();
  }
  /**
   * The torch in his left hand, after the clip has posed him: the left arm reaches for where the
   * torch is held (two bones, by the elbow's pole), the torch along where he looks; with a pistol
   * aimed, under his right wrist (Harries) or out to the side and high (FBI).
   */
  holdTorch() {
    const a = this.current;
    let inHand = this.torchOut;
    const drawing = this.shown === 'drawTorch' || this.shown === 'stowTorch';
    if (a && this.shown === 'drawTorch') inHand = a.time >= TORCH_T.draw * 0.5;
    else if (a && this.shown === 'stowTorch') inHand = a.time < TORCH_T.stow * 0.5;
    this.torchMesh.visible = inHand;
    this.torchBelt.visible = this.hasTorch && !inHand;
    this.torchLens.visible = inHand && this.torchOn && !drawing;
    this.torchBeam.visible = this.torchLens.visible;
    if (!inHand) return;
    const g = this.group, B = this.bones;
    g.updateMatrixWorld(true);
    const dir = this.lookDir();
    const T = new THREE.Vector3();
    if (!drawing) {
      const pistol = this.weapon === 'primary' && this.primaryKind === 'pistol' && !!AIMING[this.shown];
      if (pistol && this.torchGrip === 'harries') {
        // the back of the left wrist against the back of the right, the torch under the gun
        B.handR.getWorldPosition(T);
        T.add(new THREE.Vector3(0, -0.075, 0)).addScaledVector(dir, -0.05);
      } else if (pistol) {
        // FBI: out to the left and high, away from the body
        B.upperArmL.getWorldPosition(T);
        const left = new THREE.Vector3(dir.z, 0, -dir.x).normalize();
        T.addScaledVector(left, 0.22).add(new THREE.Vector3(0, 0.12, 0)).addScaledVector(dir, 0.32);
      } else {
        // in front of the left shoulder, pointing where he looks
        B.chest.localToWorld(T.set(0.17, 0.03, 0.36));
      }
      armIK(B.upperArmL, B.foreArmL, B.handL, T, new THREE.Vector3(1, -0.8, -0.3).transformDirection(g.matrixWorld));
    }
    // the torch in the fist, along where he looks
    const hp = new THREE.Vector3();
    B.handL.localToWorld(hp.set(0.045, -0.06, 0.02));
    this.torchWorld = hp.clone();
    this.torchDirW = drawing ? new THREE.Vector3(0, -1, 0.3).transformDirection(g.matrixWorld) : dir.clone();
    const gi = g.matrixWorld.clone().invert();
    this.torchMesh.position.copy(hp.clone().applyMatrix4(gi));
    const dl = this.torchDirW.clone().transformDirection(gi);
    this.torchMesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dl);
    if (this.torchBeam.visible) placeBeam(this.torchBeam, this.torchMesh.position.clone().addScaledVector(dl, 0.14), dl);
  }
  /** The weapon light's beam in the air (group space), after the pose. */
  placeLampBeam() {
    if (!this.lampBeam?.visible) return;
    const src = this.lightSource();
    if (!src || src.kind !== 'weapon') return;
    this.group.updateMatrixWorld(true);
    const gi = this.group.matrixWorld.clone().invert();
    placeBeam(this.lampBeam, src.pos.applyMatrix4(gi), src.dir.transformDirection(gi));
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
      else if (this.weapon === 'knife' || this.weapon === 'none') this.armed = false; // the rifle off his back
    }
    if (name === 'knife' && this.weapon === 'knife') this.weapon = 'none';
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
    if (names.includes('pack')) {
      for (const o of [pack, this.parts.tanks]) {
        if (!o || !(o.userData.onGround || o.parent === this.bones.bag)) continue;
        this.bones.chest.add(o);
        o.position.set(0, 0, 0);
        o.quaternion.identity();
        o.userData.onGround = false;
      }
      // the flame gun's wand came off with its tanks: into his hands again
      const wand = this.parts.torch;
      if (wand && wand.parent === this.parts.tanks) {
        this.bones.weapon.add(wand);
        wand.position.set(0, 0, 0);
        wand.quaternion.identity();
        if (this.weapon === 'fists' || this.weapon === 'none') this.weapon = 'torch';
      }
    }
    for (const k of names) {
      const obj = this.parts[k], pv = obj.userData.pivot;
      if (!pv) continue;
      this.restParent[k].add(obj);
      obj.position.set(0, 0, 0);
      obj.quaternion.identity();
      obj.scale.set(1, 1, 1);
      if (k === 'knife') {
        obj.position.copy(this.A.knifeSheath.p);
        obj.quaternion.copy(this.A.knifeSheath.q);
      }
      if (k === 'secondary') {
        obj.position.copy(this.A.slungPos);
        obj.quaternion.copy(this.A.slungQ);
        if (this.weapon === 'secondary') this.weapon = 'fists';
      }
      if (k === 'torch' && (this.weapon === 'fists' || this.weapon === 'none')) this.weapon = 'torch';
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
    if (this.parts.tanks?.userData.onGround) this.parts.tanks.parent?.remove(this.parts.tanks);
    this.drone.parent?.remove(this.drone);
    if (this.parts.pack.userData.onGround) this.parts.pack.parent?.remove(this.parts.pack);
    for (const k of ['rifle', 'helmet', 'pack', 'knife', 'secondary', 'torch']) {
      const o = this.parts[k];
      if (!o) continue;
      if (o.userData.pivot) {
        o.userData.pivot.parent?.remove(o.userData.pivot);
        o.userData.physics.remove(o.userData.body);
      }
    }
    this.group.parent?.remove(this.group);
    this.mat.dispose();
  }
}
