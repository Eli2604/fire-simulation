import * as THREE from 'three';
import { buildCarrierHull } from './hull.js';
import { F_HIDDEN } from '../sim/world.js';

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

  /**
   * zones: [{ name, offset: [x,y,z] relative to the active zone, world?, hint?, size, sea }];
   * hint.cell: the columns' size (m; ~0.8 by default, finer for the places of a world)
   */
  update(zones) {
    const keep = new Set();
    for (const z of zones) {
      keep.add(z.name);
      let it = this.items.get(z.name);
      const version = z.world ? z.world.geomVersion : -1;
      if (!it || it.version !== version) {
        if (it) this.drop(it);
        it = { obj: z.world ? this.fromWorld(z.world, z.sea, z.hint?.cell) : this.placeholder(z), version, allowed: it?.allowed ?? true, covered: false };
        this.items.set(z.name, it);
        this.group.add(it.obj);
        it.obj.visible = it.allowed;
      }
      it.zone = z; // (its place: render/scenery.js draws its real scenery close up)
      it.obj.position.set(...z.offset);
    }
    for (const [name, it] of this.items)
      if (!keep.has(name)) {
        this.drop(it);
        this.items.delete(name);
      }
  }

  /** Show or hide a zone's stand-in (a place far off is drawn as its box: render/places.js). */
  setVisible(name, v) {
    const it = this.items.get(name);
    if (!it) return;
    it.allowed = v;
    it.obj.visible = v && !it.covered;
  }

  /** Whether a zone's stand-in is drawn by its real scenery instead (render/scenery.js). */
  setCovered(name, c) {
    const it = this.items.get(name);
    if (!it) return;
    it.covered = c;
    it.obj.visible = it.allowed && !c;
  }

  drop(it) {
    this.group.remove(it.obj);
    it.obj.traverse?.((o) => {
      if (o.isInstancedMesh) o.dispose?.();
      if (o.geometry && o.geometry !== this.box) o.geometry.dispose();
    });
  }

  fromWorld(w, seaLevel, cell = 0.8) {
    const s = Math.max(1, Math.round(cell / w.h)); // ~0.8 m columns
    const { nx, nz, ny, h } = w;
    const base = seaLevel ?? 0;
    const cols = [];
    // a ship drawn round its simulated slice (render/hull.js): drawn the same here, and only
    // what stands above its deck (the island, aircraft) as columns
    const ship = (w.props ?? []).find((q) => q.type === 'carrierHull');
    const above = ship ? ship.p[1] + ship.D + 0.3 : -Infinity;
    for (let z = 0; z < nz; z += s)
      for (let x = 0; x < nx; x += s) {
        let top = -1;
        let ti = -1;
        for (let dz = 0; dz < s && z + dz < nz; dz++)
          for (let dx = 0; dx < s && x + dx < nx; dx++) {
            let t = w.colTop[x + dx + nx * (z + dz)];
            // (under what is drawn as a mesh, not as voxels: the wash on a line, a torch)
            while (t > 0 && (w.flags[w.idx(x + dx, t, z + dz)] & F_HIDDEN || !w.mat[w.idx(x + dx, t, z + dz)])) t--;
            if (t > top) {
              top = t;
              ti = w.idx(x + dx, t, z + dz);
            }
          }
        if (top < 1 || (top + 1) * h <= base + 0.05 || (top + 1) * h < above) continue;
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
    if (!ship) return mesh;
    const g = new THREE.Group();
    g.add(mesh);
    const hull = buildCarrierHull(ship);
    hull.position.set(...ship.p);
    hull.rotation.y = ship.heading ?? 0;
    g.add(hull);
    return g;
  }

  placeholder(z) {
    const [sx, , sz] = z.size;
    const hint = z.hint ?? {};
    if (hint.shape === 'carrier') {
      // a carrier not built yet: its hull and a block for its island
      const g = new THREE.Group();
      const L = hint.length ?? 40;
      const B = hint.beam ?? 18;
      const Dk = hint.deck ?? 7;
      const hull = buildCarrierHull({ hx: L / 2, hz: B / 2, D: Dk, draft: hint.draft ?? 2.5 });
      const at = hint.at ?? [sx / 2, 0, sz / 2];
      hull.position.set(...at);
      g.add(hull);
      // (its island as models/carrier.js has it)
      const IL = Math.max(11, B * 0.45);
      const IW = Math.max(4.5, B * 0.15);
      const IH = Math.max(6, B * 0.19) + 3;
      const tower = new THREE.Mesh(new THREE.BoxGeometry(IL, IH, IW), new THREE.MeshStandardMaterial({ color: 0x8a8f95, roughness: 0.7 }));
      tower.position.set(at[0] + (L / 2) * (L > 80 ? 0.15 : 0.25), at[1] + Dk + IH / 2, at[2] + B / 2 - IW / 2 - 0.75);
      g.add(tower);
      return g;
    }
    const geo = hint.shape === 'hill' ? new THREE.ConeGeometry(0.5, 1, 24).translate(0.5, 0.5, 0.5) : this.box.clone();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: new THREE.Color(hint.color ?? '#777777'), roughness: 1 }));
    mesh.scale.set(sx * (hint.fill ?? 0.9), hint.height ?? 4, sz * (hint.fill ?? 0.9));
    const g = new THREE.Group();
    mesh.position.set(sx * 0.05, z.sea ?? 0, sz * 0.05);
    g.add(mesh);
    return g;
  }
}
