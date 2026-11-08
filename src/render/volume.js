import * as THREE from 'three';

// Mass extinction coefficients (m²/kg), as in the particle smoke renderer.
const K_SOOT = 8700;
const K_STEAM = 250;
const SIGMA_MAX = 80; // 1/m, encoding range of the extinction texture

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform highp sampler3D tMedium;   // rgb: scattering colour, a: sqrt(extinction / SIGMA_MAX)
  uniform highp sampler3D tGlow;     // r: flame, g: hot gas
  uniform mat4 uInvProj;
  uniform mat4 uCamWorld;
  uniform vec3 uCamPos;
  uniform vec3 uSize;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyColor;
  uniform float uSigmaMax;
  uniform float uDensity;
  uniform float uCell;
  uniform float uFlameGain;
  uniform int uSteps;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

  vec4 medium(vec3 p) {
    vec4 m = texture(tMedium, p / uSize);
    m.a = m.a * m.a * uSigmaMax * uDensity;
    return m;
  }

  void main() {
    vec4 base = texture(tColor, vUv);
    float depth = texture(tDepth, vUv).r;
    vec2 ndc = vUv * 2.0 - 1.0;
    // view ray and distance to the opaque surface behind this pixel
    vec4 farV = uInvProj * vec4(ndc, 1.0, 1.0);
    vec3 dirV = normalize(farV.xyz / farV.w);
    vec3 dir = normalize((uCamWorld * vec4(dirV, 0.0)).xyz);
    vec4 hitV = uInvProj * vec4(ndc, depth * 2.0 - 1.0, 1.0);
    float sceneDist = depth >= 1.0 ? 1e9 : length(hitV.xyz / hitV.w);

    // intersect with the simulated box
    vec3 inv = 1.0 / dir;
    vec3 t0 = (vec3(0.0) - uCamPos) * inv;
    vec3 t1 = (uSize - uCamPos) * inv;
    vec3 tmin = min(t0, t1);
    vec3 tmax = max(t0, t1);
    float tNear = max(max(max(tmin.x, tmin.y), tmin.z), 0.0);
    float tFar = min(min(min(tmax.x, tmax.y), tmax.z), sceneDist);

    vec3 col = base.rgb;
    if (tFar > tNear) {
      float len = tFar - tNear;
      float ds = max(len / float(uSteps), uCell * 0.35);
      float t = tNear + ds * hash(gl_FragCoord.xy);
      float T = 1.0;          // transmittance
      vec3 L = vec3(0.0);     // in-scattered + emitted light
      for (int s = 0; s < 256; s++) {
        if (s >= uSteps || t > tFar || T < 0.01) break;
        vec3 p = uCamPos + dir * t;
        vec4 m = medium(p);
        vec2 g = texture(tGlow, p / uSize).rg;
        // flames and hot gas emit light (roughly constant luminance per flame, independent of cell size)
        float fl = g.r;
        m.a *= 1.0 - 0.85 * fl; // soot inside a flame glows (emission below) instead of darkening it
        vec3 emit = mix(vec3(1.0, 0.28, 0.03), vec3(1.0, 0.78, 0.35), fl) * (fl * fl) * uFlameGain / uCell
                  + vec3(0.9, 0.25, 0.04) * g.g * 0.6 / uCell * 0.1;
        if (m.a > 1e-4) {
          // cheap self-shadowing towards the sun
          float sh = medium(p + uSunDir * uCell * 1.5).a + medium(p + uSunDir * uCell * 4.0).a;
          float sun = exp(-sh * uCell * 2.0);
          vec3 light = uSkyColor + uSunColor * sun + vec3(1.0, 0.45, 0.15) * g.g * 3.0; // lit from below by fire
          float a = 1.0 - exp(-m.a * ds);
          L += T * a * (m.rgb * light);
          T *= 1.0 - a;
        }
        L += T * emit * ds;
        t += ds;
      }
      col = col * T + L;
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Volumetric smoke, steam and flames, ray-marched from the air grid.
 * The scene is rendered into a render target with a depth texture; a
 * full-screen pass then marches through 3D textures built from the air
 * grid (extinction + scattering colour, flame + hot gas emission) and
 * composites the result, stopping at the opaque geometry.
 */
export class VolumeRenderer {
  constructor(renderer) {
    this.renderer = renderer;
    this.enabled = false;
    this.steps = 96;
    this.density = 1;
    this.flameGain = 2.5; // HDR luminance of a fully developed flame one cell thick
    this.showSteam = true;
    this.quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          tColor: { value: null },
          tDepth: { value: null },
          tMedium: { value: null },
          tGlow: { value: null },
          uInvProj: { value: new THREE.Matrix4() },
          uCamWorld: { value: new THREE.Matrix4() },
          uCamPos: { value: new THREE.Vector3() },
          uSize: { value: new THREE.Vector3(1, 1, 1) },
          uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
          uSunColor: { value: new THREE.Color(1, 1, 1) },
          uSkyColor: { value: new THREE.Color(0.5, 0.55, 0.6) },
          uSigmaMax: { value: SIGMA_MAX },
          uDensity: { value: 1 },
          uCell: { value: 0.1 },
          uFlameGain: { value: 0.05 },
          uSteps: { value: 96 },
        },
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.target = null;
  }

  setWorld(world) {
    this.world = world;
    const { anx, any, anz } = world;
    const mk = () => {
      const tex = new THREE.Data3DTexture(new Uint8Array(anx * any * anz * 4), anx, any, anz);
      tex.format = THREE.RGBAFormat;
      tex.type = THREE.UnsignedByteType;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
      tex.unpackAlignment = 1;
      tex.needsUpdate = true;
      return tex;
    };
    this.medium?.dispose();
    this.glow?.dispose();
    this.medium = mk();
    this.glow = mk();
    const u = this.quad.material.uniforms;
    u.tMedium.value = this.medium;
    u.tGlow.value = this.glow;
    u.uSize.value.set(...world.size);
    u.uCell.value = world.ah;
  }

  ensureTarget() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    if (this.target && this.target.width === size.x && this.target.height === size.y) return;
    this.target?.dispose();
    this.target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType });
    this.target.depthTexture = new THREE.DepthTexture(size.x, size.y);
    this.target.depthTexture.type = THREE.UnsignedIntType;
  }

  /** Fill the 3D textures from the air grid. */
  upload(rh) {
    const w = this.world;
    const { NA, ah, smoke, smokeR, smokeG, smokeB, steam, airT, flame } = w;
    const vol = ah ** 3;
    const m = this.medium.image.data;
    const g = this.glow.image.data;
    const steamOn = this.showSteam;
    for (let a = 0; a < NA; a++) {
      const s = smoke[a];
      const T = airT[a];
      let cond = (95 - T) / 60;
      cond = cond < 0 ? 0 : cond > 1 ? 1 : cond;
      cond *= 0.55 + 0.45 * rh;
      const sigS = (K_SOOT * s) / vol;
      const sigW = steamOn ? (K_STEAM * steam[a] * cond) / vol : 0;
      const sig = sigS + sigW;
      const o = a * 4;
      if (sig < 1e-3) {
        m[o + 3] = 0;
      } else {
        const ws = sigS / sig;
        const r = s > 0 ? smokeR[a] / s : 0.5;
        const gg = s > 0 ? smokeG[a] / s : 0.5;
        const b = s > 0 ? smokeB[a] / s : 0.5;
        m[o] = Math.min(255, (r * ws + 0.92 * (1 - ws)) * 255);
        m[o + 1] = Math.min(255, (gg * ws + 0.93 * (1 - ws)) * 255);
        m[o + 2] = Math.min(255, (b * ws + 0.95 * (1 - ws)) * 255);
        m[o + 3] = Math.min(255, Math.sqrt(Math.min(1, sig / SIGMA_MAX)) * 255);
      }
      g[o] = flame[a] * 255;
      const hot = (T - 150) / 900;
      g[o + 1] = (hot < 0 ? 0 : hot > 1 ? 1 : hot) * 255;
    }
    this.medium.needsUpdate = true;
    this.glow.needsUpdate = true;
  }

  /** Render the scene with volumetric smoke. */
  render(scene, camera, view) {
    this.ensureTarget();
    this.upload(view.rh ?? 0.5);
    const u = this.quad.material.uniforms;
    camera.updateMatrixWorld();
    u.uInvProj.value.copy(camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(camera.matrixWorld);
    u.uCamPos.value.copy(camera.position);
    u.uDensity.value = this.density;
    u.uSteps.value = this.steps;
    u.uFlameGain.value = this.flameGain;
    u.uSunDir.value.copy(view.sun.position).sub(view.sun.target.position).normalize();
    const sunI = view.sun.intensity / 2.4;
    u.uSunColor.value.setRGB(0.9 * sunI, 0.85 * sunI, 0.75 * sunI);
    const sky = scene.background ?? new THREE.Color(0.6, 0.65, 0.7);
    u.uSkyColor.value.copy(sky).multiplyScalar(0.45 * (view.hemi.intensity / 1.2));
    u.tColor.value = this.target.texture;
    u.tDepth.value = this.target.depthTexture;
    const r = this.renderer;
    r.setRenderTarget(this.target);
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCam);
  }
}
