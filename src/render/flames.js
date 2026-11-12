import * as THREE from 'three';
import { F_BURNING } from '../sim/world.js';
import { MATERIALS } from '../sim/materials.js';

const VERT = /* glsl */ `
  attribute float aSize;
  attribute vec4 aColor;
  uniform float uScale;
  varying vec4 vColor;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aColor.a <= 0.001 ? 0.0 : aSize * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAG = /* glsl */ `
  uniform sampler2D uDepth;
  uniform float uUseDepth;
  uniform vec2 uRes;
  varying vec4 vColor;
  void main() {
    // drawn after the volumetric pass: hide behind opaque geometry using the scene depth
    if (uUseDepth > 0.5 && gl_FragCoord.z > texture2D(uDepth, gl_FragCoord.xy / uRes).r + 1e-6) discard;
    vec2 p = gl_PointCoord - 0.5;
    float r = length(p) * 2.0;
    if (r > 1.0) discard;
    float a = vColor.a * pow(1.0 - r, 1.6);
    gl_FragColor = vec4(vColor.rgb, a);
  }
`;

/**
 * Flames are drawn as short-lived additive particles spawned from the
 * simulation's flame field (burning gas in the air grid), so they appear
 * exactly where the model has flames, lean with the wind and grow with
 * the heat release. Burning wood and charcoal also throw sparks.
 */
export class FlameRenderer {
  constructor(scene, max = 16000) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.kind = new Uint8Array(max); // 0 flame, 1 spark
    this.heat = new Float32Array(max);
    this.alive = 0;
    this.color = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.color, 4).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aColor', this.colAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 800 }, uDepth: { value: null }, uUseDepth: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
    this.enabled = true;
    this.intensity = 1;
    this.skip = []; // boxes [x0, y0, z0, x1, y1, z1] whose flames are drawn by another (a detail patch's)
  }

  setWorld(world) {
    this.world = world;
    this.alive = 0;
  }

  spawn(x, y, z, vx, vy, vz, life, size, kind, heat) {
    if (this.alive >= this.max) return;
    const k = this.alive++;
    this.pos[k * 3] = x;
    this.pos[k * 3 + 1] = y;
    this.pos[k * 3 + 2] = z;
    this.vel[k * 3] = vx;
    this.vel[k * 3 + 1] = vy;
    this.vel[k * 3 + 2] = vz;
    this.age[k] = 0;
    this.life[k] = life;
    this.size0[k] = size;
    this.kind[k] = kind;
    this.heat[k] = heat;
  }

  skipped(x, y, z) {
    for (const b of this.skip) if (x > b[0] && y > b[1] && z > b[2] && x < b[3] && y < b[4] && z < b[5]) return true;
    return false;
  }

  update(dt, uScale) {
    const w = this.world;
    this.material.uniforms.uScale.value = uScale;
    this.points.visible = this.enabled;
    if (!w || !this.enabled) return;
    dt = Math.min(dt, 0.05);
    const { anx, any, anz, ah, flame, vx, vy, vz, airT } = w;
    const h = w.h;

    // --- spawn flame particles from the flame field
    let total = 0;
    for (let a = 0; a < w.NA; a++) if (flame[a] > 0.04) total += flame[a];
    // particles per second per unit of flame, limited by the pool size
    const lifeBase = 0.22 + 0.12 * Math.sqrt(ah / 0.1);
    const targetAlive = this.max * 0.85;
    const perUnit = total > 0 ? Math.min(90, targetAlive / (total * lifeBase)) : 0;
    const rate = perUnit * dt;
    if (total > 0) {
      const sxy = anx * any;
      for (let a = 0; a < w.NA; a++) {
        const fl = flame[a];
        if (fl <= 0.04) continue;
        let n = fl * rate;
        const ax = a % anx;
        const ay = ((a - ax) / anx) % any;
        const az = (a - ax - ay * anx) / sxy;
        if (this.skip.length && this.skipped((ax + 0.5) * ah, (ay + 0.5) * ah, (az + 0.5) * ah)) continue;
        while (n > 0) {
          if (n < 1 && Math.random() > n) break;
          n -= 1;
          const px = (ax + Math.random()) * ah;
          const py = (ay + Math.random()) * ah;
          const pz = (az + Math.random()) * ah;
          const up = 0.4 + Math.sqrt(Math.max(0, airT[a] - 20) / 1000) * 1.2;
          this.spawn(
            px, py, pz,
            vx[a] * 0.8 + (Math.random() - 0.5) * 0.2, Math.max(vy[a] * 0.6, up) * (0.7 + Math.random() * 0.5), vz[a] * 0.8 + (Math.random() - 0.5) * 0.2,
            lifeBase * (0.5 + Math.random() * 0.8),
            ah * (1.0 + fl * 1.1),
            0,
            fl,
          );
        }
      }
      void anz;
    }

    // --- sparks / embers from burning woody fuels
    const { solids, flags, mat, hrr } = w;
    const sparkChance = dt * 0.02;
    for (let k = 0; k < w.solidCount; k++) {
      const i = solids[k];
      if (!(flags[i] & F_BURNING)) continue;
      const M = MATERIALS[mat[i]];
      if (M.name !== 'wood' && M.name !== 'charcoal' && M.name !== 'bark' && M.name !== 'twigs' && M.name !== 'needles') continue;
      if (Math.random() > sparkChance * Math.min(3, hrr[i] / (h * h * 2e5))) continue;
      const [x, y, z] = w.coords(i);
      if (this.skip.length && this.skipped((x + 0.5) * h, (y + 0.5) * h, (z + 0.5) * h)) continue;
      const a = w.airIndexOfVoxel(x, Math.min(w.ny - 1, y + 1), z);
      this.spawn(
        (x + Math.random()) * h, (y + 1) * h, (z + Math.random()) * h,
        vx[a] + (Math.random() - 0.5) * 0.8, 1.2 + vy[a] * 0.8 + Math.random() * 1.5, vz[a] + (Math.random() - 0.5) * 0.8,
        1.2 + Math.random() * 1.8,
        Math.max(0.006, h * 0.18),
        1,
        1,
      );
    }

    // --- integrate & write attributes
    const pos = this.pos;
    const vel = this.vel;
    const col = this.color;
    const size = this.size;
    let k = 0;
    while (k < this.alive) {
      this.age[k] += dt;
      const t = this.age[k] / this.life[k];
      if (t >= 1) {
        // swap-remove
        const last = --this.alive;
        if (k !== last) {
          for (let c = 0; c < 3; c++) {
            pos[k * 3 + c] = pos[last * 3 + c];
            vel[k * 3 + c] = vel[last * 3 + c];
          }
          this.age[k] = this.age[last];
          this.life[k] = this.life[last];
          this.size0[k] = this.size0[last];
          this.kind[k] = this.kind[last];
          this.heat[k] = this.heat[last];
        }
        continue;
      }
      if (this.kind[k] === 1) {
        // sparks: drag towards the air flow, gravity
        const ax = Math.min(anx - 1, Math.max(0, Math.floor(pos[k * 3] / ah)));
        const ay = Math.min(any - 1, Math.max(0, Math.floor(pos[k * 3 + 1] / ah)));
        const az = Math.min(anz - 1, Math.max(0, Math.floor(pos[k * 3 + 2] / ah)));
        const a = ax + anx * (ay + any * az);
        const drag = Math.min(1, dt * 2.5);
        vel[k * 3] += (vx[a] - vel[k * 3]) * drag;
        vel[k * 3 + 1] += (vy[a] - vel[k * 3 + 1]) * drag - 2.0 * dt;
        vel[k * 3 + 2] += (vz[a] - vel[k * 3 + 2]) * drag;
      } else {
        vel[k * 3 + 1] += 1.5 * dt; // flames accelerate upwards
      }
      pos[k * 3] += vel[k * 3] * dt;
      pos[k * 3 + 1] += vel[k * 3 + 1] * dt;
      pos[k * 3 + 2] += vel[k * 3 + 2] * dt;
      const o = k * 4;
      if (this.kind[k] === 1) {
        const f = 1 - t;
        col[o] = 1.0 * this.intensity;
        col[o + 1] = (0.45 + 0.3 * f) * this.intensity;
        col[o + 2] = 0.1 * f;
        col[o + 3] = f * 0.9;
        size[k] = this.size0[k];
      } else {
        // yellow-white core -> orange -> deep red, fading out
        const hgt = this.heat[k];
        const r = 1.0;
        const g = Math.max(0.12, 0.85 - t * 0.75) * (0.75 + 0.25 * hgt);
        const b = Math.max(0.02, 0.45 - t * 1.2) * hgt;
        const a = (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85) * (0.18 + 0.22 * hgt);
        col[o] = r * this.intensity;
        col[o + 1] = g * this.intensity;
        col[o + 2] = b * this.intensity;
        col[o + 3] = a;
        size[k] = this.size0[k] * (1 - 0.55 * t);
      }
      k++;
    }
    this.points.geometry.setDrawRange(0, this.alive);
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
  }
}
