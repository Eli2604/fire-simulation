import * as THREE from 'three';

/**
 * What wheels and keels leave on the ground and the water (sim/groundContact.js):
 *  - ruts and furrows: a decal per 10 cm cell over the voxels' top, darker and wetter-looking the
 *    deeper it is (pressed, glossy mud), the berms beside them lighter, water standing in them a
 *    glossy blue-grey; not where snow lies (the snow field draws its own tracks: render/snow.js);
 *  - the spray thrown off spinning wheels (mud, sand, gravel, snow, torn turf) and the splashes
 *    of puddles: points, each its material's colour;
 *  - a boat's wake: foam patches on the water spreading from its bow's shoulders and its stern,
 *    fading.
 */
const WAKE_VERT = /* glsl */ `
attribute float aAlpha;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vUv = uv;
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;
const WAKE_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vAlpha;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  if (r > 1.0) discard;
  // a ring of foam, broken up
  float ring = smoothstep(0.35, 0.8, r) * (1.0 - smoothstep(0.85, 1.0, r));
  float n = hash(floor(vUv * 18.0));
  float a = vAlpha * (0.35 * (1.0 - r) + ring) * (0.55 + 0.45 * n);
  gl_FragColor = vec4(0.93, 0.96, 0.97, a);
}
`;

const MAX_MARKS = 40000;
const MAX_SPRAY = 1500;
const MAX_WAKE = 600;

/** Colour of a rut by its ground (pressed and wet: darker than the ground round it). */
const RUT_COLOR = {
  mud: [0.17, 0.12, 0.08], soil: [0.26, 0.2, 0.13], soilWet: [0.2, 0.15, 0.1], grass: [0.24, 0.22, 0.12], grassWet: [0.2, 0.18, 0.1],
  sand: [0.62, 0.55, 0.4], sandWet: [0.48, 0.42, 0.3], gravel: [0.38, 0.37, 0.35], tephra: [0.15, 0.14, 0.13], snow: [0.7, 0.74, 0.8],
};

export class GroundMarksRenderer {
  constructor(root) {
    this.root = root;
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.rotateX(-Math.PI / 2);
    this.marks = new THREE.InstancedMesh(
      quad,
      new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0, transparent: true, opacity: 0.88, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      MAX_MARKS,
    );
    this.marks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_MARKS * 3), 3);
    this.marks.count = 0;
    this.marks.frustumCulled = false;
    this.marks.renderOrder = 1;
    this.marks.receiveShadow = true;
    root.add(this.marks);
    // spray
    const g = new THREE.BufferGeometry();
    this.sprayPos = new Float32Array(MAX_SPRAY * 3);
    this.sprayCol = new Float32Array(MAX_SPRAY * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.sprayPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.sprayCol, 3).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.spray = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.07, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false }));
    this.spray.frustumCulled = false;
    root.add(this.spray);
    // the wake
    const wq = new THREE.PlaneGeometry(1, 1);
    wq.rotateX(-Math.PI / 2);
    this.wakeAlpha = new THREE.InstancedBufferAttribute(new Float32Array(MAX_WAKE), 1).setUsage(THREE.DynamicDrawUsage);
    wq.setAttribute('aAlpha', this.wakeAlpha);
    this.wake = new THREE.InstancedMesh(wq, new THREE.ShaderMaterial({ vertexShader: WAKE_VERT, fragmentShader: WAKE_FRAG, transparent: true, depthWrite: false }), MAX_WAKE);
    this.wake.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.wake.count = 0;
    this.wake.frustumCulled = false;
    this.wake.renderOrder = 3;
    root.add(this.wake);
    this.m = new THREE.Matrix4();
    this.version = -1;
    this.lastBuild = -Infinity;
    this.world = null;
  }

  setWorld(world) {
    this.world = world;
    this.version = -1;
    this.marks.count = 0;
    this.wake.count = 0;
    this.spray.geometry.setDrawRange(0, 0);
  }

  /** The marks' decals again (when they have changed, at most ~4 times a second). */
  buildMarks(M, w) {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (M.version === this.version || now - this.lastBuild < 250) return;
    this.version = M.version;
    this.lastBuild = now;
    const S = w.snow;
    const col = this.marks.instanceColor.array;
    const cell = M.cell;
    let n = 0;
    for (const r of M.cells.values()) {
      if (n >= MAX_MARKS) break;
      if (r.d < 0.004 && r.berm < 0.006) continue;
      const x = (r.cx + 0.5) * cell, z = (r.cz + 0.5) * cell;
      if (S && S.depthAt(x, z) > 0.02) continue; // (the snow draws its own tracks)
      const base = RUT_COLOR[r.kind] ?? [0.3, 0.25, 0.18];
      let c;
      if (r.water > 0.004) c = [0.3, 0.34, 0.36];
      else if (r.d >= 0.004) {
        const k = Math.min(1, r.d / 0.15);
        c = base.map((v) => v * (0.85 - 0.35 * k));
      } else c = base.map((v) => Math.min(1, v * 1.25 + 0.03)); // (the berm: drier, lighter)
      this.m.makeScale(cell * 1.02, 1, cell * 1.02);
      this.m.setPosition(x, r.y0 + 0.004 + (r.d < 0.004 ? 0.002 : 0), z);
      this.marks.setMatrixAt(n, this.m);
      col[n * 3] = c[0];
      col[n * 3 + 1] = c[1];
      col[n * 3 + 2] = c[2];
      n++;
    }
    this.marks.count = n;
    this.marks.instanceMatrix.needsUpdate = true;
    this.marks.instanceColor.needsUpdate = true;
  }

  update() {
    const w = this.world;
    const M = w?.groundMarks;
    if (!M) {
      this.marks.count = 0;
      this.wake.count = 0;
      this.spray.geometry.setDrawRange(0, 0);
      return;
    }
    this.buildMarks(M, w);
    // spray
    const sp = M.spray;
    const n = Math.min(MAX_SPRAY, sp.length);
    for (let k = 0; k < n; k++) {
      const s = sp[k];
      this.sprayPos[k * 3] = s.p[0];
      this.sprayPos[k * 3 + 1] = s.p[1];
      this.sprayPos[k * 3 + 2] = s.p[2];
      this.sprayCol[k * 3] = s.color[0];
      this.sprayCol[k * 3 + 1] = s.color[1];
      this.sprayCol[k * 3 + 2] = s.color[2];
    }
    const g = this.spray.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.setDrawRange(0, n);
    // the wake
    const wk = M.wake;
    const m = Math.min(MAX_WAKE, wk.length);
    for (let k = 0; k < m; k++) {
      const p = wk[k];
      const d = 2 * p.r;
      this.m.makeScale(d, 1, d);
      this.m.setPosition(p.x, p.y, p.z);
      this.wake.setMatrixAt(k, this.m);
      this.wakeAlpha.array[k] = p.k * Math.max(0, 1 - p.age / p.life) * 0.8;
    }
    this.wake.count = m;
    this.wake.instanceMatrix.needsUpdate = true;
    this.wakeAlpha.needsUpdate = true;
  }
}
