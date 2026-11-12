import * as THREE from 'three';

/**
 * Ice on the water (sim/ice.js): a sheet over each frozen column. A first skin is clear
 * and dark (you see the water through it: black ice), it grows grey and then white as it
 * thickens (frozen in air, snow ice), with cracks in it; where it broke, open water.
 */
export class IceRenderer {
  constructor(scene) {
    this.scene = scene;
    this.mesh = null;
    this.m = new THREE.Matrix4();
    this.c = new THREE.Color();
    this.seen = -1;
  }

  setWorld(world) {
    this.world = world;
    this.seen = -1;
    this.seenIce = null;
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.dispose();
      this.mesh = null;
    }
  }

  build() {
    const w = this.world;
    const cap = Math.min(w.nx * w.nz, 80000);
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    // (the plane's uv is per column: the cracks are drawn in world space, see onBeforeCompile)
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.12, metalness: 0.05, transparent: true, opacity: 0.88, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, map: crackTexture() });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n  vMapUv = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xz / 3.0;');
    };
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.receiveShadow = true;
    this.scene.add(this.mesh);
    this.cap = cap;
  }

  update() {
    const w = this.world;
    const I = w?.ice;
    if (!I) {
      if (this.mesh) this.mesh.count = 0;
      return;
    }
    if (I === this.seenIce && I.version === this.seen) return;
    this.seenIce = I;
    this.seen = I.version;
    if (!this.mesh) this.build();
    const { nx, h } = w;
    let n = 0;
    for (let c = 0; c < I.top.length && n < this.cap; c++) {
      const d = I.thick[c];
      const i = I.top[c];
      if (i === -1 || d < 0.001) continue;
      const x = c % nx;
      const z = (c - x) / nx;
      this.m.makeScale(h, 1, h);
      this.m.setPosition((x + 0.5) * h, I.surf[c] + 0.006, (z + 0.5) * h);
      this.mesh.setMatrixAt(n, this.m);
      // clear dark skin -> grey -> white with the thickness
      const k = Math.min(1, d / 0.15);
      this.c.setRGB(0.32 + 0.6 * k, 0.4 + 0.54 * k, 0.48 + 0.48 * k);
      this.mesh.setColorAt(n, this.c);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/** Cracks and air bubbles frozen into the ice, tiling every 3 m. */
function crackTexture() {
  const S = 256;
  const cv = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!cv) return null;
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#e8eef2';
  g.fillRect(0, 0, S, S);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // bubbles
  for (let k = 0; k < 140; k++) {
    g.fillStyle = `rgba(255,255,255,${0.3 + rnd() * 0.5})`;
    g.beginPath();
    g.arc(rnd() * S, rnd() * S, 0.5 + rnd() * 1.5, 0, Math.PI * 2);
    g.fill();
  }
  // cracks: long, branching, wrapped round the tile
  for (let k = 0; k < 9; k++) {
    let x = rnd() * S;
    let y = rnd() * S;
    let a = rnd() * Math.PI * 2;
    g.strokeStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '120,135,150'},${0.35 + rnd() * 0.4})`;
    g.lineWidth = 0.6 + rnd();
    for (let s = 0; s < 30; s++) {
      const l = 6 + rnd() * 10;
      a += (rnd() - 0.5) * 0.8;
      const nx = x + Math.cos(a) * l;
      const ny = y + Math.sin(a) * l;
      for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
        g.beginPath();
        g.moveTo(x + ox, y + oy);
        g.lineTo(nx + ox, ny + oy);
        g.stroke();
      }
      x = ((nx % S) + S) % S;
      y = ((ny % S) + S) % S;
      if (Math.abs(nx - x) > 1 || Math.abs(ny - y) > 1) {
        // (wrapped: carry on from the other side)
      }
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
