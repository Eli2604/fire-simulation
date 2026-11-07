import * as THREE from 'three';

const VERT = /* glsl */ `
  attribute vec4 aColor;
  uniform float uScale;
  uniform float uSize;
  varying vec4 vColor;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aColor.a < 0.004 ? 0.0 : uSize * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAG = /* glsl */ `
  varying vec4 vColor;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float r2 = dot(p, p) * 4.0;
    if (r2 > 1.0) discard;
    float a = vColor.a * exp(-r2 * 2.5) * (1.0 - r2);
    gl_FragColor = vec4(vColor.rgb, a);
  }
`;

// Mass extinction coefficients (m²/kg): soot is very opaque, water droplets less so per kg.
const K_SOOT = 8700;
const K_STEAM = 250;

/**
 * Smoke and steam are drawn from the air grid: one soft billboard per air
 * cell, opacity from the optical depth of the particulate in that cell
 * (Beer–Lambert), colour from the material-dependent smoke colour, lit by
 * the sky and by flames below.
 */
export class SmokeRenderer {
  constructor(scene) {
    this.scene = scene;
    this.points = null;
    this.enabled = true;
    this.showSteam = true;
    this.light = 1;
    this.density = 1;
  }

  setWorld(world) {
    this.world = world;
    if (this.points) {
      this.scene.remove(this.points);
      this.points.geometry.dispose();
    }
    const { anx, any, anz, ah, NA } = world;
    const pos = new Float32Array(NA * 3);
    for (let az = 0; az < anz; az++)
      for (let ay = 0; ay < any; ay++)
        for (let ax = 0; ax < anx; ax++) {
          const a = ax + anx * (ay + any * az);
          pos[a * 3] = (ax + 0.2 + Math.random() * 0.6) * ah;
          pos[a * 3 + 1] = (ay + 0.2 + Math.random() * 0.6) * ah;
          pos[a * 3 + 2] = (az + 0.2 + Math.random() * 0.6) * ah;
        }
    this.color = new Float32Array(NA * 4);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.colAttr = new THREE.BufferAttribute(this.color, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aColor', this.colAttr);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 800 }, uSize: { value: ah * 2.6 } },
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    this.scene.add(this.points);
  }

  update(uScale, ambientRH) {
    const w = this.world;
    if (!w || !this.points) return;
    this.points.visible = this.enabled;
    if (!this.enabled) return;
    this.material.uniforms.uScale.value = uScale;
    const { NA, ah, smoke, smokeR, smokeG, smokeB, steam, airT, flame } = w;
    const vol = ah * ah * ah;
    const col = this.color;
    const L = this.light;
    const dens = this.density;
    const showSteam = this.showSteam;
    for (let a = 0; a < NA; a++) {
      const s = smoke[a];
      const st = showSteam ? steam[a] : 0;
      const o = a * 4;
      if (s < 1e-9 && st < 1e-9) {
        col[o + 3] = 0;
        continue;
      }
      // condensed (visible) part of the water vapour: hot vapour is invisible
      const T = airT[a];
      let cond = (95 - T) / 60;
      cond = cond < 0 ? 0 : cond > 1 ? 1 : cond;
      cond *= 0.55 + 0.45 * ambientRH;
      const tauS = (K_SOOT * s * ah) / vol;
      const tauW = (K_STEAM * st * cond * ah) / vol;
      const tau = (tauS + tauW) * dens;
      if (tau < 0.004) {
        col[o + 3] = 0;
        continue;
      }
      const alpha = 1 - Math.exp(-tau);
      // colour: mix of soot colour and white droplets, weighted by optical depth
      const ws = tauS / (tauS + tauW);
      let r = s > 0 ? smokeR[a] / s : 0.5;
      let g = s > 0 ? smokeG[a] / s : 0.5;
      let b = s > 0 ? smokeB[a] / s : 0.5;
      r = r * ws + 0.92 * (1 - ws);
      g = g * ws + 0.93 * (1 - ws);
      b = b * ws + 0.95 * (1 - ws);
      // lit by the sky, and from below by the fire
      const fl = flame[a];
      const hot = Math.max(0, Math.min(1, (T - 150) / 600));
      col[o] = r * L + (fl * 0.9 + hot * 0.4) * 1.0;
      col[o + 1] = g * L + (fl * 0.35 + hot * 0.12);
      col[o + 2] = b * L + fl * 0.05;
      col[o + 3] = Math.min(0.92, alpha * 0.85);
    }
    this.colAttr.needsUpdate = true;
  }
}
