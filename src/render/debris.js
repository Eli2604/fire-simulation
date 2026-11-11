import * as THREE from 'three';
import { F_BURNING } from '../sim/world.js';
import { blackbody } from './colors.js';

/** Fragments flying after an explosion, tumbling, glowing when hot. */
export class DebrisRenderer {
  constructor(scene, max = 3000) {
    this.max = max;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.7, emissive: 0x000000 }), max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.s = new THREE.Vector3();
    this.p = new THREE.Vector3();
    this.c = [0, 0, 0];
  }

  update(world) {
    if (!world) return;
    const list = world.debris;
    const n = Math.min(this.max, list.length);
    const h = world.h;
    const col = this.mesh.instanceColor.array;
    for (let k = 0; k < n; k++) {
      const d = list[k];
      if (d.meshPiece) {
        // drawn as its piece of the mesh (a statue: render/statue.js)
        this.mesh.setMatrixAt(k, this.zero ??= new THREE.Matrix4().makeScale(0, 0, 0));
        continue;
      }
      this.e.set(d.age * 7 + k, d.age * 5 + k * 0.7, d.age * 3);
      this.q.setFromEuler(this.e);
      if (d.flake) this.s.set(h * 0.35, h * 0.04, h * 0.3);
      else this.s.set(h, h, h);
      this.p.set(d.p[0], d.p[1], d.p[2]);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(k, this.m);
      blackbody(Math.max(d.temp, d.skin), this.c);
      const burn = d.flags & F_BURNING ? 1.5 : 0;
      const ch = d.char * 0.8;
      col[k * 3] = ((d.tint[0] / 255) ** 2) * (1 - ch) + this.c[0] * 0.6 + burn;
      col[k * 3 + 1] = ((d.tint[1] / 255) ** 2) * (1 - ch) + this.c[1] * 0.6 + burn * 0.45;
      col[k * 3 + 2] = ((d.tint[2] / 255) ** 2) * (1 - ch) + this.c[2] * 0.6 + burn * 0.1;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}
