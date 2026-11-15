/**
 * A soldier (OperatorFigure, operator/rig.js) going limp: his skeleton handed over to a ragdoll
 * (physics/ragdoll.js) in a PhysicsWorld, from the pose his animation has him in at that moment,
 * blended from the animation to the ragdoll over `blend` seconds (no pop).
 *
 *   const r = new FigureRagdoll(figure, physicsWorld, { blend: 0.3, velocity, impulse })
 *   ... each frame, after figure.update(dt):  r.apply(dt)     (the world is stepped by its owner)
 *   r.dispose()                                                (he gets up / the scene ends)
 *
 * The ragdoll's parts drive the bones they are on (hips, spine, neck, arms, thighs, shins) in the
 * world; the bones it has no part for go limp to their rest pose against their parent (chest, head,
 * hands, feet); the rest (the weapon, the pack) keep their animation. RAGDOLLS.on switches it for
 * the game (render/enemies.js: the guards and the squads when they die).
 */
import * as THREE from 'three';
import { BONES, REST } from './rig.js';
import { createRagdoll, soldierRagdollSpec } from '../physics/ragdoll.js';

export const RAGDOLLS = { on: true, blend: 0.3 };

const REST_ARR = Object.fromEntries(Object.entries(REST).map(([k, v]) => [k, v.toArray()]));
export const SOLDIER_RAGDOLL = soldierRagdollSpec(REST_ARR);
const LIMP = new Set(['chest', 'head', 'handR', 'handL', 'footR', 'footL']);
const IDENT = new THREE.Quaternion();
const _pq = new THREE.Quaternion(), _aq = new THREE.Quaternion(), _rq = new THREE.Quaternion();
const _ap = new THREE.Vector3(), _rp = new THREE.Vector3();

export class FigureRagdoll {
  constructor(figure, physics, { blend = RAGDOLLS.blend, velocity = null, impulse = null } = {}) {
    this.figure = figure;
    this.blend = blend;
    this.t = 0;
    figure.group.updateMatrixWorld(true);
    const pose = (name) => {
      const b = figure.bones[name];
      const p = b.getWorldPosition(new THREE.Vector3());
      const q = b.getWorldQuaternion(new THREE.Quaternion());
      return { position: p.toArray(), quaternion: [q.x, q.y, q.z, q.w] };
    };
    this.rd = createRagdoll(physics, SOLDIER_RAGDOLL, { pose, velocity });
    if (impulse) this.rd.applyImpulse(impulse.bone ?? 'spine', impulse.J, impulse.point ?? null);
  }
  get ragdoll() {
    return this.rd;
  }
  /** After the figure's animation: its bones from the ragdoll, blended in. */
  apply(dt) {
    this.t += dt;
    const w = this.blend > 0 ? Math.min(1, this.t / this.blend) : 1;
    const B = this.rd.bones();
    const bones = this.figure.bones;
    for (const [name] of BONES) {
      const bone = bones[name];
      const r = B.get(name);
      if (!r) {
        if (LIMP.has(name)) {
          bone.quaternion.slerp(IDENT, w);
          bone.updateMatrixWorld(true);
        }
        continue;
      }
      const pq = bone.parent.getWorldQuaternion(_pq);
      const aq = bone.getWorldQuaternion(_aq);
      aq.slerp(_rq.set(r.quaternion[0], r.quaternion[1], r.quaternion[2], r.quaternion[3]), w);
      bone.quaternion.copy(pq.invert().multiply(aq));
      if (name === 'hips') {
        const ap = bone.getWorldPosition(_ap);
        ap.lerp(_rp.set(r.position[0], r.position[1], r.position[2]), w);
        bone.parent.worldToLocal(ap);
        bone.position.copy(ap);
      }
      bone.updateMatrixWorld(true);
    }
  }
  dispose() {
    this.rd.remove();
  }
}
