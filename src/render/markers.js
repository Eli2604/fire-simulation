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
    // arrows (shaft + fletching as one thin box) and rockets
    const ag = new THREE.BoxGeometry(0.02, 0.02, 0.8);
    this.arrows = new THREE.InstancedMesh(ag, new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.8 }), 64);
    this.arrows.count = 0;
    this.arrows.frustumCulled = false;
    scene.add(this.arrows);
    const rg = new THREE.CylinderGeometry(0.07, 0.07, 1.4, 10);
    rg.rotateX(Math.PI / 2);
    this.rockets = new THREE.InstancedMesh(rg, new THREE.MeshStandardMaterial({ color: 0xd8d8d0, roughness: 0.4, metalness: 0.5 }), 32);
    this.rockets.count = 0;
    this.rockets.frustumCulled = false;
    scene.add(this.rockets);
    this.q = new THREE.Quaternion();
    this.fwd = new THREE.Vector3(0, 0, 1);
    this.dv = new THREE.Vector3();
    this.pv = new THREE.Vector3();
    this.sv = new THREE.Vector3(1, 1, 1);
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
    // enemies' patrol areas / rounds: an outline on the floor
    const seen = new Set();
    for (const e of world.enemies ?? []) {
      const a = e.area;
      if (!a) continue;
      const key = JSON.stringify(a.corners);
      if (seen.has(key)) continue;
      seen.add(key);
      const pts = a.corners.map((c) => new THREE.Vector3(c[0], c[1] + 0.05, c[2]));
      const line = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineDashedMaterial({ color: a.mode === 'route' ? '#ff4040' : '#ff8080', dashSize: s * 0.6, gapSize: s * 0.4, depthTest: false, transparent: true }),
      );
      line.computeLineDistances();
      line.renderOrder = 6;
      const lbl = this.label(a.mode === 'route' ? 'Guard round' : 'Patrol area', '#ff6060');
      lbl.scale.set(s * 3, s * 0.56, 1);
      lbl.position.set(pts[0].x, pts[0].y + s, pts[0].z);
      const obj = new THREE.Group();
      obj.add(line, lbl);
      this.group.add(obj);
      this.items.push({ obj, cone: null, ring: null, lbl, mk: { kind: 'area', p: [0, 0, 0] } });
    }
  }

  update(time, world) {
    this.group.visible = this.visible;
    const s = this.scale ?? 0.5;
    for (const it of this.items) {
      const started = it.mk.heater?.started;
      it.obj.visible = !(it.mk.kind === 'pending' && started);
      if (!it.cone) continue; // patrol outline
      it.cone.position.y = s * (0.7 + 0.15 * Math.sin(time * 3));
      it.lbl.position.y = s * 1.35;
      const k = 1 + 0.15 * Math.sin(time * 4);
      it.ring.scale.set(k, k, k);
    }
    const list = world?.projectiles ?? [];
    const r = Math.max(0.04, (world?.h ?? 0.1) * 0.5);
    let ng = 0;
    let na = 0;
    let nr = 0;
    for (const g of list) {
      const type = g.type ?? 'grenade';
      if (type === 'grenade' && ng < 32) {
        this.m.makeScale(r, r * 1.3, r);
        this.m.setPosition(...g.p);
        this.grenades.setMatrixAt(ng++, this.m);
        continue;
      }
      const d = g.resting ? g.dir ?? [0, 0, 1] : g.v;
      this.dv.set(d[0], d[1], d[2]).normalize();
      this.q.setFromUnitVectors(this.fwd, this.dv);
      if (type === 'arrow' && na < 64) {
        // a stuck arrow sits half in what it hit
        this.pv.set(g.p[0] - this.dv.x * 0.3, g.p[1] - this.dv.y * 0.3, g.p[2] - this.dv.z * 0.3);
        this.m.compose(this.pv, this.q, this.sv);
        this.arrows.setMatrixAt(na++, this.m);
        if (g.burnLeft > 0 && this.flames) this.flames.spawn(g.p[0], g.p[1], g.p[2], 0, 0.6, 0, 0.25, 0.12, 0, 0.7);
      } else if (type === 'rocket' && nr < 32) {
        this.pv.set(...g.p);
        this.m.compose(this.pv, this.q, this.sv);
        this.rockets.setMatrixAt(nr++, this.m);
        if (this.flames && g.age < (g.burn ?? 3))
          for (let k = 0; k < 6; k++) this.flames.spawn(g.p[0] - this.dv.x * 0.8, g.p[1] - this.dv.y * 0.8, g.p[2] - this.dv.z * 0.8, -this.dv.x * 6 + (Math.random() - 0.5), -this.dv.y * 6 + (Math.random() - 0.5), -this.dv.z * 6 + (Math.random() - 0.5), 0.3, 0.35, 0, 1);
      }
    }
    this.grenades.count = ng;
    this.arrows.count = na;
    this.rockets.count = nr;
    this.grenades.instanceMatrix.needsUpdate = true;
    this.arrows.instanceMatrix.needsUpdate = true;
    this.rockets.instanceMatrix.needsUpdate = true;
  }
}
