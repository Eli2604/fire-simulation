import * as THREE from 'three';
import { ropeEnds, ropePoint } from '../ai/rope.js';

/**
 * The world's ropes and cables (world.ropes: ai/rope.js, models/rope.js, a helicopter's): each a
 * line from its top to its bottom as it hangs now (a moving top every frame): a fast rope thick
 * and dark, a zipline's steel cable thin and grey, a rappel rope olive. A rappel rope someone is
 * on is the figure's own (operator/rig.js draws it through his hands), so it is not drawn here
 * then; a man on a zipline hangs from a pulley on the cable over his hands.
 */
const STYLE = {
  fastrope: { r: 0.022, color: '#2b2a24' },
  zipline: { r: 0.007, color: '#8a8f94' },
  rappel: { r: 0.0055, color: '#2f3527' },
};
const UP = new THREE.Vector3(0, 1, 0);

export class RopeRenderer {
  constructor(parent) {
    this.group = new THREE.Group();
    parent.add(this.group);
    this.geo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    this.mats = Object.fromEntries(Object.entries(STYLE).map(([k, s]) => [k, new THREE.MeshStandardMaterial({ color: s.color, roughness: k === 'zipline' ? 0.4 : 0.9, metalness: k === 'zipline' ? 0.7 : 0 })]));
    this.meshes = new Map(); // rope -> mesh
    this.pulleyGeo = new THREE.TorusGeometry(0.05, 0.018, 6, 12);
    this.pulleyMat = new THREE.MeshStandardMaterial({ color: '#555b60', metalness: 0.8, roughness: 0.35 });
    this.pulleys = [];
    this.a = new THREE.Vector3();
    this.b = new THREE.Vector3();
  }

  setWorld(world) {
    this.world = world;
    for (const m of this.meshes.values()) this.group.remove(m);
    this.meshes.clear();
  }

  update() {
    const w = this.world;
    const ropes = w?.ropes ?? [];
    const riders = [...(w?.enemies ?? []), ...(w?.ropeRiders ?? [])].filter((e) => e.rope);
    // gone from the world: their meshes go too
    for (const [r, m] of this.meshes)
      if (!ropes.includes(r)) {
        this.group.remove(m);
        this.meshes.delete(r);
      }
    for (const r of ropes) {
      let m = this.meshes.get(r);
      if (!m) {
        m = new THREE.Mesh(this.geo, this.mats[r.kind] ?? this.mats.rappel);
        m.castShadow = true;
        m.frustumCulled = false;
        this.meshes.set(r, m);
        this.group.add(m);
      }
      const [top, bot] = ropeEnds(r);
      this.a.set(top[0], top[1], top[2]);
      this.b.set(bot[0], bot[1], bot[2]);
      const d = this.b.clone().sub(this.a), L = d.length();
      m.visible = L > 1e-3 && !(r.kind === 'rappel' && riders.some((e) => e.rope.rope === r && e.rope.phase !== 'hook'));
      if (!m.visible) continue;
      const rad = (STYLE[r.kind] ?? STYLE.rappel).r;
      m.position.copy(this.a).addScaledVector(d, 0.5);
      m.scale.set(rad, L, rad);
      m.quaternion.setFromUnitVectors(UP, d.normalize());
    }
    // the pulleys over the men on a zipline
    const zip = riders.filter((e) => e.rope.kind === 'zipline' && e.rope.phase !== 'fall');
    while (this.pulleys.length < zip.length) {
      const p = new THREE.Mesh(this.pulleyGeo, this.pulleyMat);
      this.pulleys.push(p);
      this.group.add(p);
    }
    this.pulleys.forEach((p, k) => {
      const e = zip[k];
      p.visible = !!e;
      if (!e) return;
      const q = ropePoint(e.rope.rope, e.rope.s);
      p.position.set(q[0], q[1] + 0.02, q[2]);
      p.rotation.set(0, e.yaw ?? 0, 0);
      p.rotateY(Math.PI / 2);
    });
  }
}
