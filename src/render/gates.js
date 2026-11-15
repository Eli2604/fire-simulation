import * as THREE from 'three';

/**
 * The gates' arms as they swing (sim/gates.js): a barrier is its voxels while it is down (closed);
 * going up, up and coming down it is out of the grid and drawn here: the red and white arm
 * turning on its post (g.pivot → g.tip, raised by g.t × 85°).
 */
const UP = (85 * Math.PI) / 180;

export class GateRenderer {
  constructor(parent) {
    this.group = new THREE.Group();
    parent.add(this.group);
    this.items = new Map(); // gate → { group }
    this.mats = [new THREE.MeshStandardMaterial({ color: 0xcc1f1a, roughness: 0.6 }), new THREE.MeshStandardMaterial({ color: 0xe6e6e0, roughness: 0.6 })];
  }

  setWorld(world) {
    this.clear();
    this.world = world;
  }

  clear() {
    for (const m of this.items.values()) {
      this.group.remove(m.group);
      m.group.traverse((o) => o.geometry?.dispose());
    }
    this.items.clear();
  }

  /** The arm of gate g: segments in its colours along +x of its group (the pivot at the origin). */
  build(g) {
    const len = Math.hypot(g.tip[0] - g.pivot[0], g.tip[2] - g.pivot[2]) || 6;
    const group = new THREE.Group();
    const n = Math.max(2, Math.round(len / 0.5));
    for (let k = 0; k < n; k++) {
      const seg = new THREE.Mesh(new THREE.BoxGeometry(len / n, 0.14, 0.1), this.mats[k % 2]);
      seg.position.x = ((k + 0.5) * len) / n;
      group.add(seg);
    }
    this.group.add(group);
    return { group, len };
  }

  update() {
    const w = this.world;
    const live = new Set();
    for (const g of w?.gates ?? []) {
      if (!g.ready || !(g.state === 'opening' || g.state === 'open' || g.state === 'closing')) continue;
      live.add(g);
      let m = this.items.get(g);
      if (!m) this.items.set(g, (m = this.build(g)));
      // along the arm (horizontal), turned up about the road's direction by t × 85°
      const ax = g.tip[0] - g.pivot[0], az = g.tip[2] - g.pivot[2];
      const yaw = Math.atan2(-az, ax);
      const t = g.t * g.t * (3 - 2 * g.t); // (eased: it starts and stops gently)
      m.group.position.set(g.pivot[0], g.pivot[1], g.pivot[2]);
      m.group.rotation.set(0, yaw, t * UP, 'YXZ');
    }
    for (const [g, m] of this.items)
      if (!live.has(g)) {
        this.group.remove(m.group);
        m.group.traverse((o) => o.geometry?.dispose());
        this.items.delete(g);
      }
  }
}
