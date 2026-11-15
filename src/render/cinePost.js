/**
 * The picture of a world camera (models/camera.js; cinema/director.js): post-processing over the
 * frame the view has drawn (render/view.js), only while a camera is looked through or a movie
 * plays — the normal view never comes here.
 *
 * The frame on the screen (whatever path drew it: plain, ambient occlusion, volumetric smoke,
 * with the flames over it) is copied into a texture and run through an EffectComposer
 * (three/addons/postprocessing):
 *   input      the frame (TexturePass)
 *   dof        depth of field: a gather blur, each pixel's blur from the thin lens (cinema/lens.js
 *              cocScalePx) and a depth pre-pass of the scene; oval for an anamorphic lens
 *   bloom      bloom / glare (UnrealBloomPass)
 *   motion     motion blur: the frame mixed with the ones before, by the shutter angle
 *              (cinema/look.js motionBlurHistory)
 *   final      exposure and white balance, the grade (cinema/look.js applyGrade), anamorphic
 *              streaks, lens distortion, chromatic aberration, vignette, film grain, the letterbox
 * then onto the screen, with a dissolve from the last picture of the shot before, and fades.
 * The values are display values (the frame is tone mapped already), as the grade's are.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { TexturePass } from 'three/addons/postprocessing/TexturePass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/** Depth of field: a gather over a golden-angle disc, each sample counted where its own blur reaches here. */
const DOF = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    cameraNear: { value: 0.1 },
    cameraFar: { value: 1000 },
    focus: { value: 5 },
    cocScale: { value: 0 },
    maxCoc: { value: 12 },
    oval: { value: 1 },
    resolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
#include <packing>
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform float cameraNear, cameraFar, focus, cocScale, maxCoc, oval;
uniform vec2 resolution;
varying vec2 vUv;
float distAt(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  return -perspectiveDepthToViewZ(d, cameraNear, cameraFar);
}
float cocOf(float z) { return min(maxCoc, cocScale * abs(z - focus) / max(z, 1e-3)); }
void main() {
  float z0 = distAt(vUv);
  float c0 = cocOf(z0);
  vec4 sum = texture2D(tDiffuse, vUv);
  float wsum = 1.0;
  const int N = 48;
  for (int i = 1; i < N; i++) {
    float fi = float(i);
    float r = sqrt(fi / float(N)) * maxCoc;
    float a = fi * 2.39996323;
    vec2 uv = vUv + vec2(cos(a) * oval, sin(a)) * r / resolution;
    float z = distAt(uv);
    float cs = cocOf(z);
    // behind this pixel: no further than this pixel's own blur (sharp things keep their edges)
    float c = z > z0 ? min(cs, c0) : cs;
    float w = smoothstep(r - 1.5, r + 0.5, c);
    sum += texture2D(tDiffuse, uv) * w;
    wsum += w;
  }
  gl_FragColor = sum / wsum;
}`,
};

/** The look: exposure, white balance, the grade, streaks, distortion, aberration, vignette, grain, bars. */
const FINAL = {
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    time: { value: 0 },
    gainExp: { value: 1 },
    wb: { value: new THREE.Vector3(1, 1, 1) },
    lift: { value: new THREE.Vector3(0, 0, 0) },
    gamma: { value: new THREE.Vector3(1, 1, 1) },
    gain: { value: new THREE.Vector3(1, 1, 1) },
    sat: { value: 1 },
    contrast: { value: 1 },
    mono: { value: 0 },
    bleach: { value: 0 },
    nightVision: { value: 0 },
    grain: { value: 0 },
    vignette: { value: 0 },
    chromatic: { value: 0 },
    distortion: { value: 0 },
    streaks: { value: 0 },
    bars: { value: new THREE.Vector2(0, 0) },
    frameAspect: { value: 1.78 },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 resolution, bars;
uniform float time, gainExp, sat, contrast, mono, bleach, nightVision, grain, vignette, chromatic, distortion, streaks, frameAspect;
uniform vec3 wb, lift, gamma, gain;
varying vec2 vUv;
float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec2 toUv(vec2 q) { return bars + (q / vec2(frameAspect, 1.0) + 0.5) * (1.0 - 2.0 * bars); }
void main() {
  vec2 f = (vUv - bars) / (1.0 - 2.0 * bars);
  if (f.x < 0.0 || f.x > 1.0 || f.y < 0.0 || f.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  // lens distortion in the frame (the corners stay the corners: cinema/lens.js distortRadius)
  vec2 p = (f - 0.5) * vec2(frameAspect, 1.0);
  float rc2 = 0.25 * (frameAspect * frameAspect + 1.0);
  float r2 = dot(p, p) / rc2;
  vec2 q = p * (1.0 + distortion * r2) / (1.0 + distortion);
  // chromatic aberration: red and blue apart towards the edges
  float ca = chromatic * 0.008 * r2;
  vec2 uvR = toUv(q * (1.0 + ca)), uvG = toUv(q), uvB = toUv(q * (1.0 - ca));
  vec3 col = vec3(texture2D(tDiffuse, uvR).r, texture2D(tDiffuse, uvG).g, texture2D(tDiffuse, uvB).b);
  vec2 qf = q / vec2(frameAspect, 1.0) + 0.5;
  if (qf.x < 0.0 || qf.x > 1.0 || qf.y < 0.0 || qf.y > 1.0) col = vec3(0.0);
  // anamorphic streaks: the bright spots smeared sideways, bluish
  if (streaks > 0.0) {
    vec3 st = vec3(0.0);
    float stepPx = resolution.x * 0.01;
    for (int i = -14; i <= 14; i++) {
      vec3 c = texture2D(tDiffuse, uvG + vec2(float(i) * stepPx / resolution.x, 0.0)).rgb;
      float b = max(0.0, max(c.r, max(c.g, c.b)) - 0.75) * 4.0;
      st += c * b * (1.0 - abs(float(i)) / 15.0);
    }
    col += st * streaks * 0.05 * vec3(0.45, 0.65, 1.25);
  }
  // exposure and white balance (in linear light)
  col = pow(max(col, 0.0), vec3(2.2)) * gainExp * wb;
  col = pow(col, vec3(1.0 / 2.2));
  // the grade: lift, gamma, gain; saturation; contrast; bleach bypass; black and white; night vision
  col = clamp(col * gain + lift * (1.0 - col), 0.0, 1.0);
  col = pow(col, 1.0 / gamma);
  float y = luma(col);
  col = mix(vec3(y), col, sat);
  col = (col - 0.5) * contrast + 0.5;
  if (bleach > 0.0) {
    float yy = clamp(luma(col), 0.0, 1.0);
    vec3 ov = yy < 0.5 ? 2.0 * col * yy : 1.0 - 2.0 * (1.0 - col) * (1.0 - yy);
    col = mix(col, ov, bleach);
  }
  col = mix(col, vec3(luma(col)), mono);
  if (nightVision > 0.0) {
    float yy = min(1.0, luma(col) * 1.6) + (hash(vUv * resolution + time * 61.0) - 0.5) * 0.18;
    col = mix(col, vec3(0.15, 1.0, 0.25) * yy, nightVision);
    col *= mix(1.0, 1.0 - smoothstep(0.35, 0.75, length(f - 0.5)), nightVision);
  }
  // vignette
  col *= mix(1.0, 1.0 - smoothstep(0.25, 1.25, sqrt(r2)), vignette);
  // film grain: strongest in the mid-tones
  if (grain > 0.0) {
    float n = hash(floor(vUv * resolution / 1.5) + fract(time * 7.13) * 97.0) - 0.5;
    float m = 1.0 - abs(luma(col) - 0.5) * 1.2;
    col += n * grain * 0.22 * m;
  }
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`,
};

const COPY = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `uniform sampler2D tDiffuse; varying vec2 vUv; void main() { gl_FragColor = texture2D(tDiffuse, vUv); }`,
};

/** Onto the screen: the dissolve from the frozen picture, the fades to black. */
const OUT = {
  uniforms: { tDiffuse: { value: null }, tFrozen: { value: null }, dissolve: { value: 0 }, black: { value: 0 } },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse, tFrozen; uniform float dissolve, black; varying vec2 vUv;
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  if (dissolve > 0.0) c = mix(c, texture2D(tFrozen, vUv), dissolve);
  gl_FragColor = vec4(c.rgb * (1.0 - black), 1.0);
}`,
};

const mat = (S) => new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.clone(S.uniforms), vertexShader: S.vertexShader, fragmentShader: S.fragmentShader, depthTest: false, depthWrite: false });

/** Motion blur: the frame mixed with its history (the frames before), by the shutter. */
class MotionBlurPass extends Pass {
  constructor() {
    super();
    this.history = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.mix = new THREE.ShaderMaterial({
      uniforms: { tNew: { value: null }, tOld: { value: null }, k: { value: 0 } },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `uniform sampler2D tNew, tOld; uniform float k; varying vec2 vUv; void main() { gl_FragColor = mix(texture2D(tNew, vUv), texture2D(tOld, vUv), k); }`,
      depthTest: false,
      depthWrite: false,
    });
    this.copy = mat(COPY);
    this.quad = new FullScreenQuad(null);
    this.k = 0;
    this.fresh = true;
  }
  setSize(w, h) {
    this.history.setSize(w, h);
    this.fresh = true;
  }
  render(r, writeBuffer, readBuffer) {
    this.mix.uniforms.tNew.value = readBuffer.texture;
    this.mix.uniforms.tOld.value = this.history.texture;
    this.mix.uniforms.k.value = this.fresh ? 0 : this.k;
    this.quad.material = this.mix;
    r.setRenderTarget(writeBuffer);
    this.quad.render(r);
    this.copy.uniforms.tDiffuse.value = writeBuffer.texture;
    this.quad.material = this.copy;
    r.setRenderTarget(this.history);
    this.quad.render(r);
    this.fresh = false;
  }
  dispose() {
    this.history.dispose();
    this.mix.dispose();
    this.copy.dispose();
    this.quad.dispose();
  }
}

export class CinePost {
  constructor(renderer) {
    this.r = renderer;
    this.size = new THREE.Vector2();
    this.composer = new EffectComposer(renderer);
    this.composer.renderToScreen = false;
    this.frameTex = new THREE.FramebufferTexture(1, 1);
    this.input = new TexturePass(this.frameTex);
    this.dof = new ShaderPass(mat(DOF));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.5, 0.78);
    this.motion = new MotionBlurPass();
    this.final = new ShaderPass(mat(FINAL));
    for (const p of [this.input, this.dof, this.bloom, this.motion, this.final]) this.composer.addPass(p);
    // the depth of the scene for the depth of field (a pre-pass: depth only)
    this.depthRT = new THREE.WebGLRenderTarget(1, 1, { depthTexture: new THREE.DepthTexture(1, 1), depthBuffer: true });
    this.depthMat = new THREE.MeshBasicMaterial({ colorWrite: false });
    this.frozen = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.copyMat = mat(COPY);
    this.outMat = mat(OUT);
    this.quad = new FullScreenQuad(null);
    this.hidden = new Map();
  }

  /** The sizes follow the drawing buffer (the view's quality steps change it). */
  fit() {
    const r = this.r;
    const s = r.getDrawingBufferSize(new THREE.Vector2());
    if (s.equals(this.size)) return;
    this.size.copy(s);
    this.frameTex.dispose();
    this.frameTex = new THREE.FramebufferTexture(s.x, s.y);
    this.input.map = this.frameTex;
    this.composer.setPixelRatio(1);
    this.composer.setSize(s.x, s.y);
    this.depthRT.setSize(s.x, s.y);
    this.frozen.setSize(s.x, s.y);
    this.motion.fresh = true;
  }

  /** The motion blur starts again (a cut). */
  cut() {
    this.motion.fresh = true;
  }

  /** The picture now (the last one drawn) kept, to dissolve from. */
  freeze() {
    if (!this.size.x) return;
    this.copyMat.uniforms.tDiffuse.value = this.composer.readBuffer.texture;
    this.quad.material = this.copyMat;
    this.r.setRenderTarget(this.frozen);
    this.quad.render(this.r);
    this.r.setRenderTarget(null);
  }

  /** The scene's depth, without points, lines, sprites and see-through glows (as the AO leaves them out). */
  renderDepth(scene, camera) {
    const r = this.r;
    const hidden = this.hidden;
    hidden.clear();
    scene.traverse((o) => {
      if (o.visible && (o.isPoints || o.isLine || o.isSprite || o.userData.noAO)) {
        hidden.set(o, true);
        o.visible = false;
      }
    });
    const auto = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    const om = scene.overrideMaterial;
    scene.overrideMaterial = this.depthMat;
    r.setRenderTarget(this.depthRT);
    r.clear();
    r.render(scene, camera);
    r.setRenderTarget(null);
    scene.overrideMaterial = om;
    r.shadowMap.autoUpdate = auto;
    for (const o of hidden.keys()) o.visible = true;
  }

  /**
   * The frame on the screen through the camera's look (s: render settings from the director):
   * { dof: { focus, cocScale, maxCoc, oval } | null, bloom, motion (history weight), final
   *   uniforms (see FINAL), dissolve, black, time }.
   */
  render(scene, camera, s) {
    const r = this.r;
    this.fit();
    r.setRenderTarget(null);
    r.copyFramebufferToTexture(this.frameTex);
    // depth of field
    const dof = s.dof && s.dof.maxCoc >= 0.75 ? s.dof : null;
    this.dof.enabled = !!dof;
    if (dof) {
      this.renderDepth(scene, camera);
      const u = this.dof.uniforms;
      u.tDepth.value = this.depthRT.depthTexture;
      u.cameraNear.value = camera.near;
      u.cameraFar.value = camera.far;
      u.focus.value = dof.focus;
      u.cocScale.value = dof.cocScale;
      u.maxCoc.value = dof.maxCoc;
      u.oval.value = dof.oval ?? 1;
      u.resolution.value.copy(this.size);
    }
    this.bloom.enabled = s.bloom > 0.01;
    this.bloom.strength = s.bloom;
    this.motion.enabled = s.motion > 0.01;
    this.motion.k = s.motion;
    if (!this.motion.enabled) this.motion.fresh = true;
    const fu = this.final.uniforms;
    for (const [k, v] of Object.entries(s.final)) {
      const U = fu[k];
      if (!U) continue;
      if (U.value?.isVector3) U.value.set(v[0], v[1], v[2]);
      else if (U.value?.isVector2) U.value.set(v[0], v[1]);
      else U.value = v;
    }
    fu.resolution.value.copy(this.size);
    fu.time.value = s.time ?? 0;
    this.composer.render(1 / 60);
    // onto the screen
    const o = this.outMat.uniforms;
    o.tDiffuse.value = this.composer.readBuffer.texture;
    o.tFrozen.value = this.frozen.texture;
    o.dissolve.value = s.dissolve ?? 0;
    o.black.value = s.black ?? 0;
    this.quad.material = this.outMat;
    r.setRenderTarget(null);
    this.quad.render(r);
  }

  dispose() {
    this.composer.dispose();
    this.frameTex.dispose();
    this.depthRT.dispose();
    this.frozen.dispose();
    this.motion.dispose();
    this.quad.dispose();
  }
}
