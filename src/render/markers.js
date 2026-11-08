import * as THREE from 'three';

/**
 * Markers for fire starts and pending sources (a pipe that will burst):
 * a bobbing cone pointing at the spot, a ring around it and a text label.
 * Also draws thrown grenades.
 */
export class MarkerRenderer {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.renderOrder = 5;
    scene.add(this.group);
    this.visible = true;
    this.items = [];
    const g = new THREE.SphereGeometry(1, 12, 8);
    this.grenades = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: 0x3d4a2a, roughness: 0.6, metalness: 0.3 }), 32);
    this.grenades.count = 0;
    this.grenades.frustumCulled = false;
    scene.add(this.grenades);
    this.m = new THREE.Matrix4();
  }

  label(text, color) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 96;
    const ctx = c.getContext('2d');
    ctx.font = 'bold 44px system-ui, sans-serif';
    const w = Math.min(500, ctx.measureText(text).width + 40);
    ctx.fillStyle = 'rgba(20,20,24,0.75)';
    ctx.fillRect((512 - w) / 2, 10, w, 76);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 50);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sp.renderOrder = 6;
    return sp;
  }

  setMarkers(markers, world) {
    for (const it of this.items) {
      this.group.remove(it.obj);
      it.obj.traverse((o) => {
        o.geometry?.dispose();
        o.material?.map?.dispose();
        o.material?.dispose();
      });
    }
    this.items = [];
    const s = Math.max(0.15, Math.min(1.2, Math.hypot(...world.size) * 0.025));
    this.scale = s;
    for (const mk of markers) {
      const color = mk.kind === 'start' ? '#ff6a2a' : '#ffd23a';
      const obj = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 });
      const cone = new THREE.Mesh(new THREE.ConeGeometry(s * 0.25, s * 0.6, 16), mat);
      cone.rotation.x = Math.PI; // pointing down
      cone.renderOrder = 6;
      const ring = new THREE.Mesh(new THREE.RingGeometry(s * 0.3, s * 0.38, 32), mat.clone());
      ring.rotation.x = -Math.PI / 2;
      ring.renderOrder = 6;
      const lbl = this.label(mk.label, color);
      lbl.scale.set(s * 3, s * 0.56, 1);
      obj.add(cone, ring, lbl);
      obj.position.set(...mk.p);
      this.group.add(obj);
      this.items.push({ obj, cone, ring, lbl, mk });
    }
  }

  update(time, world) {
    this.group.visible = this.visible;
    const s = this.scale ?? 0.5;
    for (const it of this.items) {
      const started = it.mk.heater?.started;
      it.obj.visible = !(it.mk.kind === 'pending' && started);
      it.cone.position.y = s * (0.7 + 0.15 * Math.sin(time * 3));
      it.lbl.position.y = s * 1.35;
      const k = 1 + 0.15 * Math.sin(time * 4);
      it.ring.scale.set(k, k, k);
    }
    const list = world?.projectiles ?? [];
    const r = Math.max(0.04, (world?.h ?? 0.1) * 0.5);
    for (let k = 0; k < Math.min(32, list.length); k++) {
      this.m.makeScale(r, r * 1.3, r);
      this.m.setPosition(...list[k].p);
      this.grenades.setMatrixAt(k, this.m);
    }
    this.grenades.count = Math.min(32, list.length);
    this.grenades.instanceMatrix.needsUpdate = true;
  }
}
