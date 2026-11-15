import * as THREE from 'three';
import { F_HIDDEN } from '../sim/world.js';
import { buildRowBoatMesh } from './rowBoatMesh.js';

/**
 * What floats (world.floats: rowing boats, models/rowBoat.js), drawn in its pose on the water:
 * where sim/buoyancy.js has it (heave, roll, pitch: Archimedes on the waves), or, in a place
 * not simulated yet, as it was built (at rest at its draft). Its voxels are hidden: they heat,
 * char and burn as its wood (or aluminium, GRP) does, and the hull blackens with them; when most
 * of its planking has gone (burnt, blown away), what is left of it shows as voxels.
 */
export class FloatRenderer {
  constructor(parent) {
    this.group = new THREE.Group();
    parent.add(this.group);
    this.items = [];
    this.check = 0;
  }

  setWorld(world) {
    this.clear();
    this.world = world;
    for (const f of world.floats ?? []) {
      const m = buildRowBoatMesh(f.params ?? {});
      m.group.rotation.order = 'YXZ'; // (R = Ry(yaw) · Rx(roll) · Rz(pitch): sim/buoyancy.js rot)
      this.group.add(m.group);
      this.items.push({ f, m, char: 0, gone: false });
      this.place(this.items[this.items.length - 1]);
    }
  }

  clear() {
    for (const it of this.items) {
      this.group.remove(it.m.group);
      it.m.dispose();
    }
    this.items = [];
  }

  /** In its pose: the hull's frame (keel amidships) where the simulation has it, or as built. */
  place(it) {
    const { f, m } = it;
    const pose = f.body?.pose;
    if (pose) {
      m.group.position.set(pose.p[0], pose.p[1], pose.p[2]);
      m.group.rotation.set(pose.roll, pose.yaw, pose.pitch);
    } else {
      const k = f.spec?.keelY ?? 0;
      m.group.position.set(f.at[0], f.at[1] + k, f.at[2]);
      m.group.rotation.set(0, f.yaw ?? 0, 0);
    }
  }

  update(dt) {
    for (const it of this.items) if (!it.gone) this.place(it);
    this.check -= dt;
    if (this.check > 0 || !this.world) return;
    this.check = 0.5;
    const w = this.world;
    for (const it of this.items) {
      const f = it.f;
      if (it.gone || !f.voxels?.length) continue;
      let left = 0;
      let ch = 0;
      for (const i of f.voxels)
        if (w.mat[i]) {
          left++;
          ch += w.char[i];
        }
      // gone (burnt, shattered): what is left of it shows as voxels
      if (left < f.voxels.length * 0.35) {
        it.gone = true;
        it.m.group.visible = false;
        for (const i of f.own ?? f.voxels) if (w.mat[i]) w.flags[i] &= ~F_HIDDEN;
        w.geomVersion++;
        continue;
      }
      // charring: the paint and the wood blacken as its voxels char
      const c = left ? ch / left : 0;
      if (Math.abs(c - it.char) > 0.03) {
        it.char = c;
        for (const mt of [...it.m.hullMats, ...it.m.woodMats]) mt.color.copy(mt.userData.base).multiplyScalar(1 - 0.85 * c);
      }
    }
  }
}
