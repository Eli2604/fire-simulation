import * as THREE from 'three';
import { funnelDepth, swirlSpeed, vortexPhase, waterSurfaceAt } from '../sim/stirrers.js';
import { WATER_GLSL } from './waterOptics.js';
import { WATER_UNIFORMS } from './waterSurface.js';

/**
 * What stirs the water and the air, drawn (sim/stirrers.js):
 *  - a whirlpool: the water's surface dipping into a funnel, spiral streaks of foam turning
 *    round it, darker down its throat; it sits on the sea (render/ocean.js leaves a hole for
 *    it and calms its waves round it) or on a lake or a pond;
 *  - a wind hose: a funnel of dust whirled up off the ground and condensation higher up, turning
 *    and rising, narrow at the ground and wider aloft, a skirt of dust round its foot;
 *  - a wind jet: faint streaks of air along its cone.
 * Everything from the world's time: it turns as the simulation runs.
 */
const MAX_VORT = 4;

export class StirrerRenderer {
  constructor(parent) {
    this.parent = parent;
    this.group = new THREE.Group();
    parent.add(this.group);
    this.items = [];
    this.sprite = makeSprite();
  }

  setWorld(world) {
    this.world = world;
    for (const it of this.items) {
      this.group.remove(it.obj);
      it.obj.geometry.dispose();
      it.obj.material.dispose();
    }
    this.items = [];
    this.list = null;
  }

  /** The whirlpools on the sea, for its shader: [x, z, radius, depth] each (render/ocean.js). */
  vortices() {
    return (this.world?.stirrers ?? []).filter((s) => s.kind === 'vortex').slice(0, MAX_VORT);
  }

  build() {
    const w = this.world;
    this.list = w.stirrers;
    this.count = w.stirrers.length;
    for (const s of w.stirrers) {
      let obj;
      if (s.kind === 'vortex') obj = this.vortexMesh(s);
      else if (s.kind === 'hose') obj = s.dust === false ? null : this.hosePoints(s);
      else if (s.kind === 'jet') obj = this.jetPoints(s);
      if (!obj) continue;
      obj.frustumCulled = false;
      this.group.add(obj);
      this.items.push({ s, obj });
    }
  }

  vortexMesh(s) {
    const R = s.radius;
    const rings = 40;
    const segs = 96;
    const pos = [];
    const uv = [];
    const idx = [];
    pos.push(0, -funnelDepth(s, 0), 0);
    uv.push(0, 0);
    for (let i = 1; i <= rings; i++) {
      // finer towards the throat
      const r = R * Math.pow(i / rings, 1.6);
      for (let j = 0; j < segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        pos.push(Math.cos(a) * r, -funnelDepth(s, r), Math.sin(a) * r);
        uv.push(r / R, j / segs);
      }
    }
    for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
    for (let i = 1; i < rings; i++) {
      const a0 = 1 + (i - 1) * segs;
      const b0 = 1 + i * segs;
      for (let j = 0; j < segs; j++) {
        const j1 = (j + 1) % segs;
        idx.push(a0 + j, a0 + j1, b0 + j1, a0 + j, b0 + j1, b0 + j);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const U = { uVPhase: { value: 0 }, uVDir: { value: s.dir ?? 1 }, uVR: { value: R }, uVDepth: { value: s.depth }, uVInland: { value: 0 } };
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.08, metalness: 0, transparent: true, depthWrite: true });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, WATER_UNIFORMS, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vVW;\nvarying vec2 vVUv;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvVW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvVUv = uv;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vVW;\nvarying vec2 vVUv;\nuniform float uVPhase, uVDir, uVR, uVDepth, uVInland;\nuniform vec3 uWSky;\nfloat vFoam;\n${WATER_GLSL}`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
float vr = vVUv.x;
float th = vVUv.y * 6.2832;
// spiral arms of foam, wound tighter towards the throat, turning
float spiral = sin(3.0 * th + uVDir * 5.0 * log(max(vr, 0.03)) + uVPhase * 3.0);
float streak = smoothstep(0.55, 0.95, spiral * 0.6 + wNoise(vec2(th * 4.0, vr * 18.0 - uVPhase)) * 0.5);
vFoam = streak * smoothstep(0.08, 0.3, vr) * (1.0 - smoothstep(0.75, 1.0, vr)) * (0.7 + 0.6 * uWTurb) * (1.0 - 0.6 * uWGrease);
float tE = wTurbidAt(20.0);
vec3 body = wDeep(tE) * mix(0.35, 1.0, smoothstep(0.0, 0.6, vr));
diffuseColor.rgb = mix(body, vec3(0.9, 0.93, 0.94), vFoam);
// it fades out into the sea, the lake round it
// (clear towards its rim, where it is shallow: the floor, the sea round it show through)
// (on a pond or a lake: opaque, the voxels of its water are under it)
diffuseColor.a = (1.0 - smoothstep(0.86, 1.0, vr)) * max(max(mix(0.95, 0.3, smoothstep(0.25, 0.85, vr)), vFoam), 0.95 * uVInland);`,
        )
        .replace(
          '#include <opaque_fragment>',
          `{
  vec3 V = normalize(cameraPosition - vVW);
  vec3 Nw = normalize(inverseTransformDirection(normal, viewMatrix));
  float fr = 0.02 + 0.98 * pow(1.0 - abs(dot(Nw, V)), 5.0);
  outgoingLight = mix(outgoingLight, uWSky * 0.95, fr * 0.8 * (1.0 - vFoam));
  outgoingLight += wGlint(Nw, V, vVW.xz, 0.0) * (1.0 - vFoam);
}
#include <opaque_fragment>`,
        );
    };
    m.customProgramCacheKey = () => 'vortex-v1';
    const mesh = new THREE.Mesh(g, m);
    mesh.renderOrder = 2;
    mesh.userData.U = U;
    return mesh;
  }

  hosePoints(s) {
    const N = Math.round(Math.min(2600, 600 + s.height * 50));
    const seed = new Float32Array(N * 4);
    let q = 12345;
    const rnd = () => ((q = (Math.imul(q, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let k = 0; k < N * 4; k++) seed[k] = rnd();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const col = new Float32Array(N * 3);
    for (let k = 0; k < N; k++) {
      const hf = seed[k * 4];
      const skirt = seed[k * 4 + 3] < 0.22;
      // dust low down, grey-white condensation higher up
      const t = skirt ? 0 : Math.min(1, hf * 1.6);
      col[k * 3] = 0.42 + 0.36 * t;
      col[k * 3 + 1] = 0.36 + 0.42 * t;
      col[k * 3 + 2] = 0.27 + 0.55 * t;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({ size: Math.max(0.5, s.radius * 0.8), map: this.sprite, vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false, sizeAttenuation: true });
    const pts = new THREE.Points(g, m);
    pts.userData.seed = seed;
    pts.renderOrder = 3;
    return pts;
  }

  jetPoints(s) {
    const N = 260;
    const seed = new Float32Array(N * 3);
    let q = 777;
    const rnd = () => ((q = (Math.imul(q, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let k = 0; k < N * 3; k++) seed[k] = rnd();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.PointsMaterial({ size: Math.max(0.12, s.nozzle * 0.4), map: this.sprite, color: 0xdfe6ea, transparent: true, opacity: 0.22, depthWrite: false });
    const pts = new THREE.Points(g, m);
    pts.userData.seed = seed;
    pts.renderOrder = 3;
    return pts;
  }

  update(time) {
    const w = this.world;
    if (!w) return;
    if (w.stirrers !== this.list || w.stirrers.length !== this.count) {
      this.setWorld(w);
      this.build();
    }
    for (const { s, obj } of this.items) {
      if (s.kind === 'vortex') {
        const y = waterSurfaceAt(w, s.p[0], s.p[2]) ?? s.p[1];
        obj.userData.U.uVInland.value = w.sea && Math.abs(y - w.sea.level) < 0.05 ? 0 : 1;
        obj.position.set(s.p[0], y + 0.01, s.p[2]);
        obj.userData.U.uVPhase.value = vortexPhase(s, time);
      } else if (s.kind === 'hose') this.moveHose(s, obj, time);
      else this.moveJet(s, obj, time);
    }
  }

  moveHose(s, pts, t) {
    const seed = pts.userData.seed;
    const P = pts.geometry.attributes.position.array;
    const N = P.length / 3;
    const [cx, cy, cz] = s.p;
    const H = s.height;
    const d = s.dir ?? 1;
    for (let k = 0; k < N; k++) {
      const u = seed[k * 4];
      const a0 = seed[k * 4 + 1] * Math.PI * 2;
      const rj = seed[k * 4 + 2];
      const skirt = seed[k * 4 + 3] < 0.22;
      let x;
      let y;
      let z;
      if (skirt) {
        // the dust skirt round its foot: wide, low, turning fast
        const r = s.radius * (1.3 + 2.2 * rj);
        const om = swirlSpeed(r, s.radius, s.spin) / r;
        const a = a0 + d * om * t * 0.7;
        x = cx + Math.cos(a) * r;
        z = cz - Math.sin(a) * r;
        y = cy + ((u + t * 0.4) % 1) * s.radius * 0.9;
      } else {
        // rising up the funnel as it turns
        const hf = (u + (t * Math.max(0.5, s.updraft)) / (H * 1.8)) % 1;
        const rcy = s.radius * (0.7 + 0.6 * hf);
        const r = rcy * (0.55 + 0.9 * hf) * (0.75 + 0.5 * rj);
        const om = swirlSpeed(r, rcy, s.spin) / Math.max(0.2, r);
        const a = a0 + d * om * t * 0.6;
        // (the funnel sways a little)
        const sway = Math.sin(t * 0.5 + hf * 3) * s.radius * 0.25 * hf;
        x = cx + Math.cos(a) * r + sway;
        z = cz - Math.sin(a) * r;
        y = cy + hf * H;
      }
      P[k * 3] = x;
      P[k * 3 + 1] = y;
      P[k * 3 + 2] = z;
    }
    pts.geometry.attributes.position.needsUpdate = true;
  }

  moveJet(s, pts, t) {
    const seed = pts.userData.seed;
    const P = pts.geometry.attributes.position.array;
    const N = P.length / 3;
    const d = s.dir;
    // two directions across the axis
    const up = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const a = norm(cross(d, up));
    const b = cross(d, a);
    const tan = Math.tan((s.spread * Math.PI) / 180);
    for (let k = 0; k < N; k++) {
      const f = (seed[k * 3] + (t * s.speed * 0.35) / s.range) % 1;
      const x = f * s.range;
      const wdt = (s.nozzle + x * tan) * Math.sqrt(seed[k * 3 + 1]);
      const ang = seed[k * 3 + 2] * Math.PI * 2;
      const ca = Math.cos(ang) * wdt;
      const sa = Math.sin(ang) * wdt;
      for (let c = 0; c < 3; c++) P[k * 3 + c] = s.p[c] + d[c] * x + a[c] * ca + b[c] * sa;
    }
    pts.geometry.attributes.position.needsUpdate = true;
  }
}

const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const norm = (u) => {
  const l = Math.hypot(...u) || 1;
  return u.map((x) => x / l);
};

/** A soft round puff for the particles. */
function makeSprite() {
  const n = 32;
  const data = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const r = Math.hypot(i + 0.5 - n / 2, j + 0.5 - n / 2) / (n / 2);
      const a = Math.max(0, 1 - r) ** 1.6;
      const o = (i + n * j) * 4;
      data[o] = data[o + 1] = data[o + 2] = 255;
      data[o + 3] = Math.round(a * 255);
    }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}
