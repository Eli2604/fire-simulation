import * as THREE from 'three';
import { buildCarMesh } from '../rig/vehicleMeshes.js';
import { bodyLeft } from '../sim/carBody.js';

/**
 * The cars of the world (sim/cars.js world.cars) drawn while they move: a car's voxels are hidden
 * on the move (they snap from cell to cell; they still heat, burn and char where they are) and
 * this draws it in its pose (rig/vehicleMeshes.js buildCarMesh: the same boxes and wheels its
 * voxels are made of), smoothly: the body on its springs (pitching under the brakes, rolling in a
 * turn), the wheels turning (rear: the driven wheels' spin, wheelspin and all; front: rolling, or
 * locked under the brakes) and steering. It darkens with its voxels' char. At rest its voxels are
 * drawn again and the mesh goes. Its lamps light up while the engine runs.
 */
export class CarRenderer {
  constructor(parent) {
    this.group = new THREE.Group();
    parent.add(this.group);
    this.items = new Map(); // car → mesh
  }

  setWorld(world) {
    this.clear();
    this.world = world;
  }

  clear() {
    for (const m of this.items.values()) {
      this.group.remove(m.group);
      m.dispose();
    }
    this.items.clear();
  }

  update() {
    const w = this.world;
    const live = new Set();
    for (const c of w?.cars ?? []) {
      if (!c.body?.hidden) continue;
      live.add(c);
      let m = this.items.get(c);
      if (!m) {
        m = buildCarMesh(c.params ?? {});
        m.group.rotation.order = 'YZX'; // (R = Ry(yaw) · Rz(pitch) · Rx(roll): sim/carPhysics.js carRot)
        m.body.rotation.order = 'ZXY';
        this.group.add(m.group);
        this.items.set(c, m);
        m.tick = -1;
      }
      m.group.position.set(c.x, c.y, c.z);
      // the ground's slope on the whole; the springs on the body
      m.group.rotation.set(c.rollG ?? 0, c.yaw, c.pitchG ?? 0);
      m.body.rotation.set(c.rollS ?? 0, 0, c.pitchS ?? 0);
      for (const wl of m.wheels) {
        wl.steer.rotation.y = wl.front ? c.steer : 0;
        wl.spin.rotation.z = -(wl.front ? c.spinF : c.spinR);
      }
      // its char (every half second)
      const k = Math.floor((c.t ?? 0) * 2);
      if (k !== m.tick) {
        m.tick = k;
        const B = c.body;
        let ch = 0, n = 0;
        for (let i = 0; i < B.n; i += 3)
          if (B.s.mat[i]) {
            ch += B.state.char[i];
            n++;
          }
        const dark = 1 - 0.85 * (n ? ch / n : 0);
        m.group.visible = bodyLeft(B) > 0.35;
        m.group.traverse((o) => {
          if (!o.isMesh || !o.material?.color) return;
          o.material.userData.base ??= o.material.color.clone();
          o.material.color.copy(o.material.userData.base).multiplyScalar(dark);
          if (o.material.emissive && o.material.userData.em === undefined) o.material.userData.em = o.material.emissiveIntensity;
          if (o.material.userData.em !== undefined) o.material.emissiveIntensity = c.running ? 1.6 : o.material.userData.em * 0.3;
        });
      }
    }
    for (const [c, m] of this.items)
      if (!live.has(c)) {
        this.group.remove(m.group);
        m.dispose();
        this.items.delete(c);
      }
  }
}
