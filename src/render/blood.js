import * as THREE from 'three';

/**
 * Marks on surfaces and shots in the air: blood splatter on walls and floors
 * (fresh red, drying to a dark brown), falling drops, bullet and arrow holes
 * (dark, with chipped stone round them), and the muzzle flash and a short
 * tracer of each shot.
 */
function splatTexture(kind) {
  if (typeof document === 'undefined' || typeof document.createElement('canvas').getContext !== 'function') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const r = (() => {
    let s = kind.length * 7919;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  })();
  if (kind === 'blood') {
    // a central splash with droplets and runs
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * Math.PI * 2;
      const rr = 26 + r() * 20;
      ctx.lineTo(64 + Math.cos(a) * rr, 64 + Math.sin(a) * rr);
    }
    ctx.fill();
    for (let k = 0; k < 26; k++) {
      const a = r() * Math.PI * 2;
      const d = 38 + r() * 24;
      ctx.beginPath();
      ctx.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 1 + r() * 4, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === 'chip') {
    // spalled stone: a lighter ragged ring
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      const rr = 34 + r() * 26;
      ctx.lineTo(64 + Math.cos(a) * rr, 64 + Math.sin(a) * rr);
    }
    ctx.fill();
  } else {
    // a hole: black centre, darker rim
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 60);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}

const MAX = 900;

export class BloodRenderer {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.meshes = {};
    const plane = new THREE.PlaneGeometry(1, 1);
    for (const kind of ['blood', 'hole', 'chip', 'arrow']) {
      const tex = splatTexture(kind === 'arrow' ? 'hole' : kind);
      const mat = new THREE.MeshStandardMaterial({
        map: tex, alphaMap: tex, transparent: true, depthWrite: false, roughness: kind === 'blood' ? 0.35 : 0.95,
        color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      });
      const m = new THREE.InstancedMesh(plane, mat, MAX);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
      m.count = 0;
      m.frustumCulled = false;
      m.renderOrder = 2;
      this.meshes[kind] = m;
      this.group.add(m);
    }
    // drops in the air
    this.dropGeo = new THREE.BufferGeometry();
    this.dropPos = new Float32Array(600 * 3);
    this.dropGeo.setAttribute('position', new THREE.BufferAttribute(this.dropPos, 3));
    this.drops = new THREE.Points(this.dropGeo, new THREE.PointsMaterial({ color: 0x6a0606, size: 0.025, sizeAttenuation: true }));
    this.drops.frustumCulled = false;
    this.group.add(this.drops);
    // tracers / muzzle flashes
    this.tracerGeo = new THREE.BufferGeometry();
    this.tracerPos = new Float32Array(40 * 6);
    this.tracerGeo.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3));
    this.tracers = new THREE.LineSegments(this.tracerGeo, new THREE.LineBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.7 }));
    this.tracers.frustumCulled = false;
    this.group.add(this.tracers);
    this.flash = new THREE.PointLight(0xffc070, 0, 6, 2);
    this.group.add(this.flash);
    this.version = -1;
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.z = new THREE.Vector3(0, 0, 1);
  }

  setWorld(world) {
    this.world = world;
    this.version = -1;
  }

  update(time) {
    const w = this.world;
    if (!w) return;
    // decals: rebuilt when there are new ones, recoloured as blood dries
    const counts = { blood: 0, hole: 0, chip: 0, arrow: 0 };
    const n = new THREE.Vector3();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const rebuild = this.version !== (w.decalVersion ?? 0);
    for (const d of w.decals ?? []) {
      const m = this.meshes[d.kind] ?? this.meshes.hole;
      const k = counts[d.kind in counts ? d.kind : 'hole']++;
      if (k >= MAX) continue;
      if (rebuild) {
        n.set(...d.n);
        this.q.setFromUnitVectors(this.z, n);
        // a random turn about the normal
        this.q.multiply(new THREE.Quaternion().setFromAxisAngle(this.z, d.seed * Math.PI * 2));
        p.set(d.p[0] + d.n[0] * 0.003, d.p[1] + d.n[1] * 0.003, d.p[2] + d.n[2] * 0.003);
        const r = d.r * 2;
        s.set(r, r, r);
        this.m.compose(p, this.q, s);
        m.setMatrixAt(k, this.m);
      }
      const c = m.instanceColor.array;
      if (d.kind === 'blood') {
        // fresh: bright red; dries in a few minutes to dark brown
        const age = Math.min(1, (w.time - d.t) / 240);
        c[k * 3] = 0.42 - 0.26 * age;
        c[k * 3 + 1] = 0.02 + 0.03 * age;
        c[k * 3 + 2] = 0.02 + 0.02 * age;
      } else if (d.kind === 'chip') {
        c[k * 3] = c[k * 3 + 1] = c[k * 3 + 2] = 0.65;
      } else {
        c[k * 3] = c[k * 3 + 1] = c[k * 3 + 2] = 0.03;
      }
    }
    for (const [kind, m] of Object.entries(this.meshes)) {
      m.count = Math.min(MAX, counts[kind]);
      if (rebuild) m.instanceMatrix.needsUpdate = true;
      m.instanceColor.needsUpdate = true;
    }
    this.version = w.decalVersion ?? 0;
    // drops
    const drops = w.drops ?? [];
    const nd = Math.min(600, drops.length);
    for (let k = 0; k < nd; k++) this.dropPos.set(drops[k].p, k * 3);
    this.dropGeo.setDrawRange(0, nd);
    this.dropGeo.attributes.position.needsUpdate = true;
    // shots: a tracer for 60 ms, and the flash of the last one
    let nt = 0;
    let last = null;
    for (const t of w.tracers ?? []) {
      if (w.time - t.t > 0.06) continue;
      this.tracerPos.set(t.a, nt * 6);
      this.tracerPos.set(t.b, nt * 6 + 3);
      nt++;
      last = t;
    }
    this.tracerGeo.setDrawRange(0, nt * 2);
    this.tracerGeo.attributes.position.needsUpdate = true;
    if (last) {
      this.flash.position.set(...last.a);
      this.flash.intensity = 6;
    } else this.flash.intensity *= 0.5;
    void time;
  }
}
