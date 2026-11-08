import * as THREE from 'three';

const VERT = /* glsl */ `
  attribute vec4 aColor;
  attribute float aSize;
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
  varying vec4 vColor;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float r2 = dot(p, p) * 4.0;
    if (r2 > 1.0) discard;
    gl_FragColor = vec4(vColor.rgb, vColor.a * (1.0 - r2));
  }
`;

const LOOK = {
  water: { color: [0.72, 0.84, 1.0], size: 0.6, alpha: 0.55, speed: 9, spread: 0.06, gravity: 4 },
  foam: { color: [0.98, 0.98, 0.96], size: 1.2, alpha: 0.75, speed: 7, spread: 0.08, gravity: 3 },
  co2: { color: [0.95, 0.97, 1.0], size: 3.5, alpha: 0.22, speed: 6, spread: 0.18, gravity: 0 },
  powder: { color: [0.96, 0.94, 0.86], size: 3.0, alpha: 0.3, speed: 7, spread: 0.15, gravity: 0.5 },
};

/** Visual jet of an extinguisher, from the nozzle to the aimed point. */
export class SprayRenderer {
  constructor(scene, max = 4000) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.color = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.alive = 0;
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
      uniforms: { uScale: { value: 800 } },
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    scene.add(this.points);
    this.spray = null;
    this.baseSize = 0.03;
  }

  setScale(world) {
    this.baseSize = Math.max(0.01, Math.min(0.08, world.h * 0.6));
  }

  update(dt, uScale, spray) {
    this.material.uniforms.uScale.value = uScale;
    dt = Math.min(dt, 0.05);
    if (spray && spray.tank.remaining > 0) {
      const L = LOOK[spray.agent];
      const [nx, ny, nz] = spray.nozzle;
      const dx = spray.target[0] - nx;
      const dy = spray.target[1] - ny;
      const dz = spray.target[2] - nz;
      const dist = Math.hypot(dx, dy, dz) || 1;
      const n = Math.min(this.max - this.alive, Math.round(900 * dt));
      for (let k = 0; k < n; k++) {
        const i = this.alive++;
        const sp = L.speed * (0.85 + Math.random() * 0.3);
        const s = L.spread * dist;
        // aim slightly above the target so gravity brings droplets onto it
        const lift = (L.gravity * dist) / (2 * sp);
        this.pos[i * 3] = nx;
        this.pos[i * 3 + 1] = ny;
        this.pos[i * 3 + 2] = nz;
        this.vel[i * 3] = (dx / dist) * sp + (Math.random() - 0.5) * s;
        this.vel[i * 3 + 1] = (dy / dist) * sp + lift + (Math.random() - 0.5) * s;
        this.vel[i * 3 + 2] = (dz / dist) * sp + (Math.random() - 0.5) * s;
        this.age[i] = 0;
        this.life[i] = (dist / sp) * (0.9 + Math.random() * 0.35);
        this.color[i * 4] = L.color[0];
        this.color[i * 4 + 1] = L.color[1];
        this.color[i * 4 + 2] = L.color[2];
        this.color[i * 4 + 3] = L.alpha;
        this.size[i] = this.baseSize * L.size;
        this.grav = L.gravity;
      }
    }
    let k = 0;
    while (k < this.alive) {
      this.age[k] += dt;
      const t = this.age[k] / this.life[k];
      if (t >= 1) {
        const last = --this.alive;
        if (k !== last) {
          for (let c = 0; c < 3; c++) {
            this.pos[k * 3 + c] = this.pos[last * 3 + c];
            this.vel[k * 3 + c] = this.vel[last * 3 + c];
          }
          for (let c = 0; c < 4; c++) this.color[k * 4 + c] = this.color[last * 4 + c];
          this.age[k] = this.age[last];
          this.life[k] = this.life[last];
          this.size[k] = this.size[last];
        }
        continue;
      }
      this.vel[k * 3 + 1] -= (this.grav ?? 0) * dt;
      for (let c = 0; c < 3; c++) this.pos[k * 3 + c] += this.vel[k * 3 + c] * dt;
      this.size[k] *= 1 + dt * 0.8; // the jet widens
      k++;
    }
    this.points.geometry.setDrawRange(0, this.alive);
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
  }
}
