import { buildJetMesh } from './jetMesh.js';

/**
 * Parked vehicles drawn as objects: the jet on the flight deck is simulated as
 * voxels (aluminium airframe, fuel tank, rockets) that are hidden; this draws the
 * aircraft itself over them. It darkens with the charring of its voxels and is
 * gone once most of them have burnt or been blown away.
 */
export class VehicleRenderer {
  constructor(scene) {
    this.scene = scene;
    this.items = new Map();
  }

  setWorld(world) {
    for (const it of this.items.values()) this.scene.remove(it.group);
    this.items.clear();
    this.world = world;
  }

  update(time) {
    const w = this.world;
    if (!w) return;
    const live = new Set();
    for (const v of w.vehicles) {
      if (v.type !== 'jet') continue;
      live.add(v);
      let it = this.items.get(v);
      if (!it) {
        it = buildJetMesh(v.color ?? '#7a8590', v.rockets ?? 0);
        it.flame.visible = false;
        it.group.position.set(v.base[0], v.base[1], v.base[2]);
        it.group.rotation.y = v.heading ?? 0;
        // its voxels: to follow their state
        it.voxels = [];
        for (let k = 0; k < w.solidCount; k++) if (w.owner[w.solids[k]] === v.owner) it.voxels.push(w.solids[k]);
        it.n0 = Math.max(1, it.voxels.length);
        this.scene.add(it.group);
        this.items.set(v, it);
      }
      if (Math.floor(time * 2) !== it.tick) {
        it.tick = Math.floor(time * 2);
        let left = 0;
        let ch = 0;
        for (const i of it.voxels)
          if (w.mat[i] && w.owner[i] === v.owner) {
            left++;
            ch += w.char[i];
          }
        it.group.visible = left > it.n0 * 0.6;
        const dark = 1 - 0.8 * (left ? ch / left : 0);
        it.group.traverse((o) => {
          if (!o.isMesh || !o.material.color) return;
          o.material.userData.base ??= o.material.color.clone();
          o.material.color.copy(o.material.userData.base).multiplyScalar(dark);
        });
      }
    }
    for (const [v, it] of this.items)
      if (!live.has(v)) {
        this.scene.remove(it.group);
        this.items.delete(v);
      }
  }
}
