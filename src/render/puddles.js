import * as THREE from 'three';

/** Shallow water on floors (less than a voxel deep): a glossy water surface per column. */
export class PuddleRenderer {
  constructor(scene) {
    this.scene = scene;
    this.mesh = null;
    this.m = new THREE.Matrix4();
    this.lastUpdate = 0;
  }

  setWorld(world) {
    this.world = world;
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.dispose();
    }
    const cap = Math.min(world.nx * world.nz, 60000);
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(
      geo,
      new THREE.MeshStandardMaterial({ color: 0x3a5a70, roughness: 0.05, metalness: 0.35, transparent: true, opacity: 0.72, depthWrite: false }),
      cap,
    );
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.scene.add(this.mesh);
    this.cap = cap;
  }

  update() {
    const w = this.world;
    if (!w || !this.mesh) return;
    const now = performance.now();
    if (now - this.lastUpdate < 100) return;
    this.lastUpdate = now;
    const { runoff, runoffY, nx, h } = w;
    if (!runoffY) {
      this.mesh.count = 0;
      return;
    }
    let n = 0;
    for (let c = 0; c < runoff.length && n < this.cap; c++) {
      const r = runoff[c];
      if (r < 0.003) continue;
      const depth = Math.min(h, r / (1000 * h * h));
      const x = c % nx;
      const z = (c - x) / nx;
      this.m.makeScale(h, 1, h);
      this.m.setPosition((x + 0.5) * h, (runoffY[c] + 1) * h + depth + 0.002, (z + 0.5) * h);
      this.mesh.setMatrixAt(n++, this.m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
