import * as THREE from 'three';

/**
 * Wall torches drawn as objects, not voxels: a forged iron bracket on the wall,
 * a tapered wooden handle leaning out of its ring, a head wrapped in pitch-soaked
 * cloth, and a flickering flame. The torch is still simulated as voxels and a
 * small burner (its heat, light, smoke and oxygen use); those voxels are hidden
 * and this mesh is drawn where they are. A torch whose flame has been put out, or
 * whose air has gone bad, burns down to a glow and goes dark.
 */

let woodTex = null;
let flameTex = null;

function canvasTexture(w, h, draw) {
  if (typeof document === 'undefined') return null;
  if (typeof document.createElement('canvas').getContext !== 'function') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function textures() {
  woodTex ??= canvasTexture(64, 256, (ctx, w, h) => {
    ctx.fillStyle = '#5a3d22';
    ctx.fillRect(0, 0, w, h);
    // grain along the handle, a few knots, darker and charred towards the head
    for (let k = 0; k < 60; k++) {
      ctx.strokeStyle = `rgba(${30 + Math.random() * 40},${18 + Math.random() * 20},8,${0.25 + Math.random() * 0.3})`;
      ctx.lineWidth = 1 + Math.random() * 2;
      const x = Math.random() * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + 6 * (Math.random() - 0.5), h / 3, x + 6 * (Math.random() - 0.5), (2 * h) / 3, x, h);
      ctx.stroke();
    }
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(10,6,3,0.85)');
    g.addColorStop(0.25, 'rgba(10,6,3,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  flameTex ??= canvasTexture(64, 128, (ctx, w, h) => {
    // a teardrop: white-yellow core, orange, red fringe
    const g = ctx.createRadialGradient(w / 2, h * 0.72, 2, w / 2, h * 0.62, h * 0.5);
    g.addColorStop(0, 'rgba(255,250,220,1)');
    g.addColorStop(0.25, 'rgba(255,200,90,0.95)');
    g.addColorStop(0.55, 'rgba(255,110,20,0.6)');
    g.addColorStop(1, 'rgba(120,20,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(w / 2, 2);
    ctx.bezierCurveTo(w * 0.95, h * 0.45, w * 0.95, h * 0.98, w / 2, h * 0.98);
    ctx.bezierCurveTo(w * 0.05, h * 0.98, w * 0.05, h * 0.45, w / 2, 2);
    ctx.fill();
  });
}

export class TorchRenderer {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.items = new Map();
    this.iron = new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.55, metalness: 0.8 });
    this.pitch = new THREE.MeshStandardMaterial({ color: 0x1a120b, roughness: 0.95, emissive: 0xff5a10, emissiveIntensity: 0 });
  }

  setWorld(world) {
    this.world = world;
    for (const it of this.items.values()) this.group.remove(it.obj);
    this.items.clear();
  }

  /** Which way the wall is from a torch: the nearest solid within 0.7 m, horizontally. */
  wallDir(p) {
    const w = this.world;
    let best = null;
    let bd = Infinity;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
      for (let d = 0.05; d < 0.7; d += w.h * 0.5) {
        const i = w.voxelAt(p[0] + dx * d, p[1] - 0.3, p[2] + dz * d);
        if (i >= 0 && w.mat[i] && !(w.flags[i] & 64)) {
          if (d < bd) {
            bd = d;
            best = [dx, dz, d];
          }
          break;
        }
      }
    return best ?? [1, 0, 0.3];
  }

  build(ht) {
    textures();
    const [dx, dz, d] = this.wallDir(ht.pos);
    // the torch's own frame: origin at the flame's base (the heater), +x away from the wall, y up
    const obj = new THREE.Group();
    obj.position.set(ht.pos[0], ht.pos[1], ht.pos[2]);
    obj.rotation.y = Math.atan2(dz, -dx);
    const wallX = -Math.max(0.12, d - 0.02);
    const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);
    // a part of length |b - a| along a -> b (geometry built along y)
    const between = (mesh, p, q) => {
      const dir = q.clone().sub(p);
      mesh.position.copy(p).addScaledVector(dir, 0.5);
      mesh.quaternion.setFromUnitVectors(V(0, 1), dir.normalize());
      return mesh;
    };
    const top = V(0, -0.05); // top of the head, under the flame
    const foot = V(wallX + 0.03, -0.5); // where the handle rests against the wall
    const axis = top.clone().sub(foot).normalize();
    const headLow = top.clone().addScaledVector(axis, -0.13);
    const ringAt = foot.clone().lerp(top, 0.45);
    const wood = new THREE.MeshStandardMaterial({ map: woodTex, color: woodTex ? 0xffffff : 0x5a3d22, roughness: 0.9 });
    const handle = between(new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.018, foot.distanceTo(headLow), 10), wood), foot, headLow);
    const head = between(new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.04, 0.13, 12), this.pitch.clone()), headLow, top);
    // cloth bands round the head
    const band = between(new THREE.Mesh(new THREE.TorusGeometry(0.046, 0.006, 5, 14), head.material), headLow.clone().addScaledVector(axis, 0.04), headLow.clone().addScaledVector(axis, 0.0401));
    band.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0), Math.PI / 2));
    // forged bracket: a plate on the wall with two rivets, an arm, a ring round the handle
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.22, 0.09), this.iron);
    plate.position.set(wallX + 0.01, ringAt.y - 0.03, 0);
    const arm = between(new THREE.Mesh(new THREE.BoxGeometry(0.022, 1, 0.022), this.iron), V(wallX + 0.02, ringAt.y - 0.03), ringAt);
    arm.scale.y = Math.max(0.02, ringAt.x - wallX - 0.02);
    const ring = between(new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.008, 6, 16), this.iron), ringAt, ringAt.clone().add(axis.clone().multiplyScalar(0.001)));
    ring.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0), Math.PI / 2));
    const parts = [handle, head, band, plate, arm, ring];
    for (const sgn of [-1, 1]) {
      const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.009, 6, 4), this.iron);
      rivet.position.set(wallX + 0.022, plate.position.y + sgn * 0.08, 0);
      parts.push(rivet);
    }
    for (const m of parts) obj.add(m);
    // the flame: an outer and an inner billboard, additive
    const fm = new THREE.SpriteMaterial({ map: flameTex, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    const flame = new THREE.Sprite(fm);
    const core = new THREE.Sprite(fm.clone());
    core.material.color = new THREE.Color(0xfff0c0);
    obj.add(flame, core);
    this.group.add(obj);
    return { obj, flame, core, head, seed: Math.random() * 100 };
  }

  update(time) {
    const w = this.world;
    if (!w) return;
    const live = new Set();
    for (const ht of w.heaters) {
      if (!ht.light) continue;
      live.add(ht);
      let it = this.items.get(ht);
      if (!it) {
        it = this.build(ht);
        this.items.set(ht, it);
      }
      // the flame dims as the oxygen goes (as the light does), and is gone when the torch is out
      const a = w.airIdx(Math.floor(ht.pos[0] / w.ah), Math.min(w.any - 1, Math.floor((ht.pos[1] + 0.2) / w.ah)), Math.floor(ht.pos[2] / w.ah));
      const o2 = w.o2[a] ?? 0.232;
      const f = ht.on ? Math.max(0, Math.min(1, (o2 - 0.135) / 0.097)) : 0;
      const s = it.seed;
      const flick = 0.85 + 0.15 * Math.sin(time * 17 + s) * Math.sin(time * 6.3 + s * 2);
      const hgt = (0.32 + 0.06 * Math.sin(time * 11 + s)) * f * flick;
      it.flame.visible = it.core.visible = f > 0.02;
      it.flame.scale.set(0.17 * f * (0.9 + 0.1 * Math.sin(time * 9 + s)), hgt, 1);
      it.flame.position.set(0, -0.05 + hgt * 0.42, 0);
      it.core.position.set(0, -0.05 + hgt * 0.25, 0);
      it.core.scale.set(0.08 * f, hgt * 0.55, 1);
      it.flame.material.opacity = 0.9 * flick;
      it.head.material.emissiveIntensity = 0.6 * f * flick + 0.15;
    }
    for (const [ht, it] of this.items)
      if (!live.has(ht)) {
        this.group.remove(it.obj);
        this.items.delete(ht);
      }
  }
}
