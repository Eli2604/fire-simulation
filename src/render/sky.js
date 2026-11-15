import * as THREE from 'three';

/**
 * The sky over an outdoor scene by the time of day (sim/sky.js): a dome shaded from the
 * horizon to the zenith (day blue; the golden hour; the sunset's orange and red round the sun;
 * the civil and nautical twilight; the dark blue night), the sun's disc and glow, the stars
 * coming out as it darkens, and the moon: a disc lit on the side the sun is (its phase, from
 * where the two really stand).
 */

// the sky by the sun's elevation (°): [elevation, zenith, horizon, glow round the sun, glow strength]
const KEYS = [
  [-18, 0x03050c, 0x0a0f1e, 0x000000, 0],
  [-10, 0x0a1230, 0x1c2648, 0x2a2048, 0.25],
  [-5, 0x1f2f62, 0x6a5a7c, 0xb0506a, 0.6],
  [-1, 0x3a5488, 0xc8805a, 0xff6a30, 1],
  [3, 0x52749e, 0xe0a070, 0xff8a40, 0.9],
  [10, 0x6a95c6, 0xbcc8d0, 0xffd29a, 0.45],
  [25, 0x6f9fd2, 0x8fb7dc, 0xfff0d0, 0.25],
];
const C = KEYS.map(([e, z, h, g, k]) => [e, new THREE.Color(z), new THREE.Color(h), new THREE.Color(g), k]);

/** The sky's colours with the sun at an elevation (°): zenith, horizon, glow, glowK (into `out`). */
export function skyColors(el, out = { zenith: new THREE.Color(), horizon: new THREE.Color(), glow: new THREE.Color(), glowK: 0 }) {
  let i = 0;
  while (i < C.length - 2 && el > C[i + 1][0]) i++;
  const a = C[i];
  const b = C[i + 1];
  const t = Math.max(0, Math.min(1, (el - a[0]) / (b[0] - a[0])));
  out.zenith.copy(a[1]).lerp(b[1], t);
  out.horizon.copy(a[2]).lerp(b[2], t);
  out.glow.copy(a[3]).lerp(b[3], t);
  out.glowK = a[4] + (b[4] - a[4]) * t;
  return out;
}

/** The sunlight's colour by its elevation (°): white high up, golden low, orange-red at the horizon. */
export function sunColor(el, out = new THREE.Color()) {
  const hi = new THREE.Color(0xfff2dd);
  if (el >= 20) return out.copy(hi);
  if (el >= 6) return out.set(0xffd9a8).lerp(hi, (el - 6) / 14);
  return out.set(0xff8040).lerp(new THREE.Color(0xffd9a8), Math.max(0, el) / 6);
}

const domeVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // on the far plane
}`;
const domeFrag = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform float uGlowK;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform float uSunDisc;
uniform float uFlash;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(smoothstep(0.0, 1.0, max(h, 0.0)), 0.55));
  // under the horizon (the sea's far edge, below the islands): the horizon, darkening
  col = mix(col, uHorizon * 0.7, smoothstep(0.0, -0.25, h));
  // the glow round the sun, and the band of the sunset along the horizon towards it
  float c = max(dot(d, uSunDir), 0.0);
  vec2 hd = normalize(d.xz + 1e-5);
  vec2 hs = normalize(uSunDir.xz + 1e-5);
  float side = max(dot(hd, hs), 0.0);
  float band = pow(side, 2.5) * exp(-abs(h) * 7.0);
  col = mix(col, uGlow, clamp(uGlowK * (0.75 * band + 0.6 * pow(c, 6.0)), 0.0, 0.9));
  col += uGlow * uGlowK * pow(c, 90.0) * 0.6;
  // the sun's disc
  col += uSunCol * uSunDisc * smoothstep(0.99955, 0.99975, c) * 4.0;
  col = mix(col, vec3(0.87, 0.9, 0.95), uFlash);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const moonVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const moonFrag = /* glsl */ `
uniform vec3 uLight; // the sun's direction in the disc's frame (x right, y up, z towards the eye)
uniform float uAlpha;
uniform vec3 uTint;
varying vec2 vUv;
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  vec3 n = vec3(vUv, sqrt(1.0 - r2));
  float lit = smoothstep(-0.04, 0.08, dot(n, uLight));
  // its seas: a few darker patches
  float mare = 0.82 + 0.18 * smoothstep(0.35, 0.0, length(vUv - vec2(-0.25, 0.2))) * -1.0 + 0.1 * smoothstep(0.3, 0.0, length(vUv - vec2(0.3, -0.25))) * -1.0;
  vec3 col = uTint * mare * (0.06 + 0.94 * lit); // (the dark side: a trace of earthshine)
  float edge = smoothstep(1.0, 0.92, r2);
  gl_FragColor = vec4(col, uAlpha * edge * max(lit, 0.18));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class SkyRenderer {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.visible = false;
    this.group.renderOrder = -2;
    scene.add(this.group);
    this.uniforms = {
      uZenith: { value: new THREE.Color(0x6f9fd2) },
      uHorizon: { value: new THREE.Color(0x8fb7dc) },
      uGlow: { value: new THREE.Color(0xffffff) },
      uGlowK: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunCol: { value: new THREE.Color(0xfff2dd) },
      uSunDisc: { value: 1 },
      uFlash: { value: 0 },
    };
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1, 48, 24),
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: domeVert, fragmentShader: domeFrag, side: THREE.BackSide, depthWrite: false, fog: false }),
    );
    dome.renderOrder = -3;
    dome.frustumCulled = false;
    this.dome = dome;
    this.group.add(dome);
    // the stars (fixed: they do not wheel with the hours)
    const n = 1800;
    const pos = new Float32Array(n * 3);
    let s = 12345;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < n; k++) {
      const u = rnd() * 1.1 - 0.1;
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      pos.set([Math.cos(a) * r * 0.97, u * 0.97, Math.sin(a) * r * 0.97], k * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xdfe6ff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.renderOrder = -2;
    this.stars.frustumCulled = false;
    this.group.add(this.stars);
    // the moon (drawn ~4× its size: a real one would be a speck)
    this.moonU = { uLight: { value: new THREE.Vector3(0, 0, 1) }, uAlpha: { value: 1 }, uTint: { value: new THREE.Color(0xf4f1e6) } };
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({ uniforms: this.moonU, vertexShader: moonVert, fragmentShader: moonFrag, transparent: true, depthWrite: false, fog: false }));
    this.moon.renderOrder = -1;
    this.moon.frustumCulled = false;
    this.group.add(this.moon);
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.moonDir = new THREE.Vector3(0, -1, 0);
    this.cols = skyColors(45);
  }

  /**
   * The sky for the state of the moment (sim/sky.js skyState) and the weather's grey (0 clear
   * .. 1 overcast). Returns its horizon colour (the fog, the background, the water's mirror).
   */
  set(state, grey = 0, horizon = new THREE.Color()) {
    const el = state.sun.elevation;
    skyColors(el, this.cols);
    const U = this.uniforms;
    this.sunDir.fromArray(state.sun.dir);
    this.moonDir.fromArray(state.moon.dir);
    U.uSunDir.value.copy(this.sunDir);
    sunColor(el, U.uSunCol.value);
    // under cloud: grey, as bright as the sky is
    const lum = (c) => 0.3 * c.r + 0.59 * c.g + 0.11 * c.b;
    const greyOf = (c) => new THREE.Color().setScalar(lum(c) * 0.95);
    U.uZenith.value.copy(this.cols.zenith).lerp(greyOf(this.cols.zenith), grey);
    U.uHorizon.value.copy(this.cols.horizon).lerp(greyOf(this.cols.horizon), grey);
    U.uGlow.value.copy(this.cols.glow);
    U.uGlowK.value = this.cols.glowK * (1 - 0.85 * grey);
    U.uSunDisc.value = el > -1 ? 1 - grey : 0;
    this.stars.material.opacity = Math.max(0, Math.min(1, (-el - 4) / 8)) * (1 - grey) * 0.9;
    this.stars.visible = this.stars.material.opacity > 0.01;
    // the moon: above the horizon, fainter by day, hidden by cloud
    const m = state.moon;
    const night = Math.max(0, Math.min(1, (2 - el) / 10));
    this.moon.visible = m.elevation > -1;
    this.moonU.uAlpha.value = (0.35 + 0.65 * night) * (1 - 0.9 * grey);
    this.moonU.uTint.value.set(0xf4f1e6).multiplyScalar(0.55 + 0.45 * night);
    return horizon.copy(U.uHorizon.value);
  }

  /** Each frame: round the camera, just inside its far plane; the moon faces it, lit from the sun. */
  update(camera) {
    if (!this.group.visible) return;
    const R = camera.far * 0.85;
    this.group.position.copy(camera.position);
    this.dome.scale.setScalar(R);
    this.stars.scale.setScalar(R);
    const md = this.moonDir;
    this.moon.position.copy(md).multiplyScalar(R * 0.9);
    this.moon.scale.setScalar(R * 0.9 * Math.tan((2.2 * Math.PI) / 180));
    // facing the eye (the dome's centre), upright
    this.moon.quaternion.setFromRotationMatrix((this._m ??= new THREE.Matrix4()).lookAt((this._o ??= new THREE.Vector3()), this.moon.position, (this._y ??= new THREE.Vector3(0, 1, 0))));
    // the sun's direction in the disc's frame: its right, its up, towards the eye
    const q = this.moon.quaternion;
    const right = (this._r ??= new THREE.Vector3()).set(1, 0, 0).applyQuaternion(q);
    const up = (this._u ??= new THREE.Vector3()).set(0, 1, 0).applyQuaternion(q);
    const eye = (this._e ??= new THREE.Vector3()).set(0, 0, 1).applyQuaternion(q);
    // (seen from the moon the sun lies along sunDir − a little of the moon's own direction: far off, the same)
    const L = (this._l ??= new THREE.Vector3()).copy(this.sunDir).sub((this._t ??= new THREE.Vector3()).copy(md).multiplyScalar(0.0026)).normalize();
    this.moonU.uLight.value.set(L.dot(right), L.dot(up), L.dot(eye));
  }
}
