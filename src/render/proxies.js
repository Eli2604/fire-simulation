import * as THREE from 'three';

/**
 * Cheap stand-ins for the zones you are not in (seen from the jet): the other
 * ship / island as columns from the sea up to the top of each voxel column,
 * coloured like the top voxel. Zones not built yet get a simple placeholder.
 */
export class ProxyRenderer {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.items = new Map(); // zone name -> { obj, version }
    this.box = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5);
    this.mat = new THREE.MeshStandardMaterial({ roughness: 0.9, vertexColors: false });
  }

  /** zones: [{ name, offset: [x,y,z] relative to the active zone, world?, hint?, size, sea }] */
  update(zones) {
    const keep = new Set();
    for (const z of zones) {
      keep.add(z.name);
      let it = this.items.get(z.name);
      const version = z.world ? z.world.geomVersion : -1;
      if (!it || it.version !== version) {
        if (it) this.drop(it);
        it = { obj: z.world ? this.fromWorld(z.world, z.sea) : this.placeholder(z), version };
        this.items.set(z.name, it);
        this.group.add(it.obj);
      }
      it.obj.position.set(...z.offset);
    }
    for (const [name, it] of this.items)
      if (!keep.has(name)) {
        this.drop(it);
        this.items.delete(name);
      }
  }

  drop(it) {
    this.group.remove(it.obj);
    it.obj.traverse?.((o) => {
      if (o.isInstancedMesh) o.dispose?.();
      if (o.geometry && o.geometry !== this.box) o.geometry.dispose();
    });
  }

  fromWorld(w, seaLevel) {
    const s = Math.max(1, Math.round(0.8 / w.h)); // ~0.8 m columns
    const { nx, nz, ny, h } = w;
    const base = seaLevel ?? 0;
    const cols = [];
    for (let z = 0; z < nz; z += s)
      for (let x = 0; x < nx; x += s) {
        let top = -1;
        let ti = -1;
        for (let dz = 0; dz < s && z + dz < nz; dz++)
          for (let dx = 0; dx < s && x + dx < nx; dx++) {
            const t = w.colTop[x + dx + nx * (z + dz)];
            if (t > top) {
              top = t;
              ti = w.idx(x + dx, t, z + dz);
            }
          }
        if (top < 1 || (top + 1) * h <= base + 0.05) continue;
        cols.push([x, z, (top + 1) * h, ti]);
      }
    const mesh = new THREE.InstancedMesh(this.box, this.mat, Math.max(1, cols.length));
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    cols.forEach(([x, z, top, ti], k) => {
      m.makeScale(s * h, top - base, s * h);
      m.setPosition(x * h, base, z * h);
      mesh.setMatrixAt(k, m);
      c.setRGB(w.tint[ti * 3] / 255, w.tint[ti * 3 + 1] / 255, w.tint[ti * 3 + 2] / 255, THREE.SRGBColorSpace);
      mesh.setColorAt(k, c);
    });
    mesh.count = cols.length;
    mesh.castShadow = true;
    void ny;
    return mesh;
  }

  placeholder(z) {
    const [sx, , sz] = z.size;
    const hint = z.hint ?? {};
    const geo = hint.shape === 'hill' ? new THREE.ConeGeometry(0.5, 1, 24).translate(0.5, 0.5, 0.5) : this.box.clone();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: new THREE.Color(hint.color ?? '#777777'), roughness: 1 }));
    mesh.scale.set(sx * (hint.fill ?? 0.9), hint.height ?? 4, sz * (hint.fill ?? 0.9));
    const g = new THREE.Group();
    mesh.position.set(sx * 0.05, z.sea ?? 0, sz * 0.05);
    g.add(mesh);
    return g;
  }
}
