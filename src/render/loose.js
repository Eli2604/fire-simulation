import * as THREE from 'three';

/**
 * Loose things a dragon can snatch up and throw (world.loose, ai/dragonAir.js): a steel drum, a
 * gas cylinder, a wooden crate, the rig's straw training dummy. Drawn at their middle (o.p) and
 * turned by o.rot (Euler, YXZ). A burst cylinder is drawn split; a broken crate flattened.
 */
export class LooseRenderer {
  constructor(parent) {
    this.group = new THREE.Group();
    parent.add(this.group);
    this.items = new Map();
    const std = (color, roughness = 0.6, metalness = 0.2) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
    this.m = { drum: std(0x2f5a8a, 0.45, 0.6), cylinder: std(0xb8322a, 0.4, 0.5), valve: std(0x9a9ea2, 0.3, 0.9), crate: std(0x9a7448, 0.85, 0), straw: std(0xc9a85e, 0.95, 0), sack: std(0x8a6e44, 0.9, 0), post: std(0x5a4128, 0.8, 0) };
  }

  build(o) {
    const g = new THREE.Group();
    const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, 0, rz);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
      return m;
    };
    if (o.kind === 'drum') {
      add(new THREE.CylinderGeometry(o.r, o.r, o.half * 2, 20), this.m.drum);
      for (const y of [-0.15, 0.15]) add(new THREE.TorusGeometry(o.r, 0.012, 6, 24), this.m.drum, 0, y * o.half * 2, 0, Math.PI / 2);
    } else if (o.kind === 'cylinder') {
      add(new THREE.CylinderGeometry(o.r, o.r, o.half * 1.6, 16), this.m.cylinder, 0, -o.half * 0.2);
      add(new THREE.SphereGeometry(o.r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), this.m.cylinder, 0, o.half * 0.6);
      g.userData.valve = add(new THREE.CylinderGeometry(0.03, 0.04, 0.12, 8), this.m.valve, 0, o.half * 0.6 + o.r + 0.04);
    } else if (o.kind === 'crate') {
      add(new THREE.BoxGeometry(o.r * 2, o.half * 2, o.r * 2), this.m.crate);
    } else {
      // the training dummy: a sack body on a post, a head, arms out stiff
      add(new THREE.CylinderGeometry(0.2, 0.17, 0.75, 12), this.m.sack, 0, 0.2);
      add(new THREE.SphereGeometry(0.14, 12, 10), this.m.sack, 0, 0.72);
      add(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 8), this.m.straw, 0, 0.28, 0, 0, Math.PI / 2);
      add(new THREE.CylinderGeometry(0.035, 0.035, 0.9, 8), this.m.post, 0, -0.45);
    }
    this.group.add(g);
    return g;
  }

  update(world) {
    const list = world?.loose ?? [];
    const seen = new Set();
    for (const o of list) {
      seen.add(o);
      let g = this.items.get(o);
      if (!g) this.items.set(o, (g = this.build(o)));
      g.visible = !o.gone;
      g.position.set(o.p[0], o.p[1], o.p[2]);
      g.rotation.set(o.rot[0], o.rot[1], o.rot[2], 'YXZ');
      g.scale.set(1, o.broken ? 0.35 : 1, 1);
      if (g.userData.valve) g.userData.valve.visible = !o.burst;
      if (o.burst) g.children[0].material = this.m.post; // (blackened, split)
    }
    for (const [o, g] of this.items)
      if (!seen.has(o)) {
        this.group.remove(g);
        this.items.delete(o);
      }
  }
}
