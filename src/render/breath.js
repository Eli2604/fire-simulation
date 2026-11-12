import * as THREE from 'three';

export const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  uniform float uScale;
  varying float vA;
  void main() {
    vA = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aAlpha <= 0.001 ? 0.0 : aSize * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;
export const FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vA;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float r2 = dot(p, p) * 4.0;
    if (r2 > 1.0) discard;
    gl_FragColor = vec4(uColor, vA * exp(-r2 * 2.2) * (1.0 - r2));
  }
`;

/**
 * Breath in the cold: what people breathe out is air at ~34 °C, saturated with water
 * vapour (~38 g/m³). Mixing with cold air, the mix holds less than it carries and the
 * surplus condenses: a small cloud in front of the mouth that drifts off and evaporates
 * again within a second or two. In mild air the mix never reaches saturation and nothing
 * shows; the colder and damper the air, the more of it and the longer it lasts.
 *
 * Drawn here only (half a gram of water a breath is nothing to the air grid): the guards'
 * and your own, every few seconds, faster when running; not under water or in vacuum.
 */
export class BreathRenderer {
  constructor(scene, max = 1200) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.n = 0;
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    geo.setAttribute('aAlpha', this.alphaAttr);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 800 }, uColor: { value: new THREE.Color(0.9, 0.92, 0.95) } },
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
    this.phase = new WeakMap(); // who -> time of their next breath out
    this.light = 1;
  }

  /**
   * How much of an exhaled breath condenses in air at T (°C) and relative humidity RH:
   * the deepest the mixing line between the breath and the air goes over saturation (0..1).
   */
  static visibility(T, RH) {
    if (T > 16) return 0;
    return mistOnMixing(T, RH, 34);
  }

  /**
   * `mouths`: [{ id, p (mouth), dir (facing, unit), rate (breaths a second) }]; `air(p)`:
   * the air there { T, RH, wind:[x,y,z] } or null (no air: water, vacuum).
   */
  update(dt, time, uScale, mouths, air) {
    this.material.uniforms.uScale.value = uScale;
    for (const m of mouths) {
      let next = this.phase.get(m.id);
      if (next == null) next = time + Math.random() * 3;
      if (time >= next) {
        next = time + (1 / m.rate) * (0.85 + Math.random() * 0.3);
        const A = air(m.p);
        const v = A ? BreathRenderer.visibility(A.T, A.RH) : 0;
        if (v > 0.02) this.exhale(m, v, A);
      }
      this.phase.set(m.id, next);
    }
    // drift with the air, slow down, grow, fade
    let j = 0;
    for (let i = 0; i < this.n; i++) {
      const age = (this.age[i] += dt);
      if (age >= this.life[i]) continue;
      const damp = Math.exp(-dt * 2.5);
      for (let c = 0; c < 3; c++) {
        this.vel[i * 3 + c] *= damp;
        this.pos[i * 3 + c] += this.vel[i * 3 + c] * dt;
      }
      this.pos[i * 3 + 1] += 0.05 * dt; // a little warmer: it rises
      const t = age / this.life[i];
      this.size[i] = this.s0[i] * (1 + 2.2 * t);
      this.alpha[i] = t <= 0 ? 0 : this.a0[i] * Math.min(1, t * 8) * (1 - t) ** 1.5 * this.light;
      if (j !== i) this.copy(i, j);
      j++;
    }
    for (let i = j; i < this.n; i++) this.alpha[i] = 0;
    this.n = j;
    this.posAttr.needsUpdate = this.sizeAttr.needsUpdate = this.alphaAttr.needsUpdate = true;
    this.points.geometry.setDrawRange(0, Math.max(1, this.n));
  }

  exhale(m, v, A) {
    const k = 7;
    for (let q = 0; q < k && this.n < this.max; q++) {
      const i = this.n++;
      const sp = 0.7 + Math.random() * 0.6;
      const delay = q / k; // the breath goes on for a moment: later puffs start closer
      for (let c = 0; c < 3; c++) {
        const jit = (Math.random() - 0.5) * 0.35;
        this.vel[i * 3 + c] = (m.dir[c] + jit) * sp + (A.wind?.[c] ?? 0) * 0.6;
        this.pos[i * 3 + c] = m.p[c] + m.dir[c] * 0.03 * (1 - delay);
      }
      this.vel[i * 3 + 1] -= 0.25; // out through the nose and mouth: a little downwards
      this.age[i] = -delay * 0.5;
      this.life[i] = 0.9 + 1.6 * v + Math.random() * 0.4;
      this.s0[i] = 0.05 + Math.random() * 0.03;
      this.a0[i] = 0.18 + 0.3 * v;
      this.alpha[i] = 0;
    }
  }

  copy(i, j) {
    for (let c = 0; c < 3; c++) {
      this.pos[j * 3 + c] = this.pos[i * 3 + c];
      this.vel[j * 3 + c] = this.vel[i * 3 + c];
    }
    this.age[j] = this.age[i];
    this.life[j] = this.life[i];
    this.s0[j] = this.s0[i];
    this.a0[j] = this.a0[i];
    this.size[j] = this.size[i];
    this.alpha[j] = this.alpha[i];
  }

  clear() {
    this.n = 0;
    this.alpha.fill(0);
  }
}

/**
 * Saturated air at Tb °C (a breath, the air over a hot cup) mixing into air at T °C and
 * relative humidity RH: how far over saturation the mix goes on its way (0..1), i.e. how
 * much of it condenses into a visible mist.
 */
export function mistOnMixing(T, RH, Tb) {
  if (Tb <= T) return 0;
  let worst = 0;
  const vb = sat(Tb);
  const va = sat(T) * RH;
  for (let f = 0.05; f < 1; f += 0.05) {
    const Tm = T + (Tb - T) * f;
    const over = (va + (vb - va) * f) / sat(Tm) - 1;
    if (over > worst) worst = over;
  }
  return Math.min(1, worst * 1.2);
}

/** Saturation vapour density (kg/m³) at T °C (Magnus). */
function sat(T) {
  return (611.2 * Math.exp((17.67 * T) / (T + 243.5))) / (461.5 * (T + 273.15));
}
