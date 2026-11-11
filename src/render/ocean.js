import * as THREE from 'three';

/**
 * The open sea around a ship or an island.
 *
 *  - Waves: a sum of Gerstner (trochoidal) waves, travelling with the wind. Their
 *    height follows the wind speed of the weather (a fully developed sea:
 *    significant wave height ≈ 0.025·U², capped for the scale of the scenes), with
 *    a low swell even in a calm; longer waves travel faster (deep-water dispersion,
 *    ω = √(g·k)). Small ripples and rain rings are added to the normals only.
 *  - Colour: from the depth of the water down to the real bottom under it (the
 *    voxels: a depth map rebuilt as the ground changes, e.g. when lava runs into
 *    the sea). Shallow water over sand is clear and turquoise (you see the bottom),
 *    deep water is dark blue; out beyond the scene the bottom falls away as a shelf.
 *    The sky is reflected by the Fresnel law, more at grazing angles; a grey sky
 *    makes a grey-green sea.
 *  - Against land: the waves shoal (they get lower and steeper in shallow water)
 *    and break: lines of surf run in to the beach, foam lies along the waterline.
 *  - Against a hull: the waves are damped in its lee and slap against it, with
 *    foam along the waterline of the hull. Whitecaps on the crests in a strong wind.
 *
 * It is a MeshStandardMaterial with the waves and the colour patched in, so the
 * sun, its shadows, fog and tone mapping work as on everything else.
 */
const MAX_WAVES = 8;
const DEEP = 12; // depth (m) the depth map saturates at

export class Ocean {
  constructor() {
    this.uniforms = {
      uTime: { value: 0 },
      uWaves: { value: Array.from({ length: MAX_WAVES }, () => new THREE.Vector4()) },
      uSteep: { value: 0.6 },
      uHs: { value: 0.3 },
      uWind: { value: 0 },
      uRain: { value: 0 },
      uGrey: { value: 0 },
      uDir: { value: new THREE.Vector2(1, 0) }, // where the wind blows
      uSky: { value: new THREE.Color(0x8fb7dc) },
      uDepthTex: { value: null },
      uDepthBox: { value: new THREE.Vector4(0, 0, 1, 1) },
      uHole: { value: new THREE.Vector4(0, 0, 0, 0) },
      uHasHole: { value: 0 },
      uBathy: { value: null },
      uBathyBox: { value: new THREE.Vector4(0, 0, 1, 1) },
      uHasBathy: { value: 0 },
      uHull: { value: new THREE.Vector4(0, 0, 0, 0) }, // the waterline of the whole ship (foam, damping)
      uLevel: { value: 0 },
    };
    this.material = this.makeMaterial();
    this.weather = { windSpeed: 3, windDir: 0, rain: 0, fog: 0 };
  }

  /** The mesh: a polar grid around the scene, dense near the middle, out to the horizon. */
  build(world, diag) {
    const [sx, , sz] = world.size;
    const cx = sx / 2;
    const cz = sz / 2;
    // out to the horizon, beyond the island group round it (render/archipelago.js)
    const R = Math.max(diag * 12, (this.extent ?? 0) * 2.5);
    const rings = 230;
    const segs = 300;
    const inner = Math.max(diag * 0.75, 12); // fine grid out to here
    const pos = [];
    const idx = [];
    pos.push(cx, -cz, 0);
    for (let i = 1; i <= rings; i++) {
      const t = i / rings;
      // linear to `inner` over the first 60 % of the rings, then growing fast to R
      const r = t < 0.6 ? (inner * t) / 0.6 : inner * Math.pow(R / inner, (t - 0.6) / 0.4);
      for (let j = 0; j < segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        pos.push(cx + Math.cos(a) * r, -(cz + Math.sin(a) * r), 0);
      }
    }
    for (let j = 0; j < segs; j++) idx.push(0, 1 + j, 1 + ((j + 1) % segs));
    for (let i = 1; i < rings; i++) {
      const a0 = 1 + (i - 1) * segs;
      const b0 = 1 + i * segs;
      for (let j = 0; j < segs; j++) {
        const j1 = (j + 1) % segs;
        idx.push(a0 + j, b0 + j, b0 + j1, a0 + j, b0 + j1, a0 + j1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, k) => (k % 3 === 2 ? 1 : 0)), 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    g.boundingSphere.radius = R * 1.1;
    const mesh = new THREE.Mesh(g, this.material);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    this.world = world;
    this.mesh = mesh;
    const s = world.sea;
    const [x0, z0, x1, z1] = s.box;
    this.uniforms.uHasHole.value = x1 - x0 > 0.01 && z1 - z0 > 0.01 ? 1 : 0;
    this.uniforms.uHole.value.set(x0, z0, x1, z1);
    // a drawn ship round the simulated slice (render/hull.js): its waterline, for the foam
    const ship = (world.props ?? []).find((q) => q.type === 'carrierHull');
    if (ship) {
      const xs = -ship.hx - Math.max(4, 4.3 * 2 * ship.hz * 0.18);
      const xe = xs + 4.3 * 2 * ship.hz - 3.5;
      this.uniforms.uHull.value.set(ship.p[0] + xs, ship.p[2] - ship.hz, ship.p[0] + xe, ship.p[2] + ship.hz);
    } else this.uniforms.uHull.value.set(x0, z0, x1, z1);
    this.uniforms.uLevel.value = s.level;
    this.uniforms.uDepthBox.value.set(0, 0, sx, sz);
    this.depthStamp = -1;
    this.updateDepth(true);
    this.setWeather(this.weather, this.uniforms.uSky.value, this.uniforms.uGrey.value);
    return mesh;
  }

  /** The island group's sea floor round the zone (render/archipelago.js), or null. */
  setBathy(info) {
    const u = this.uniforms;
    u.uHasBathy.value = info ? 1 : 0;
    this.updateDepth(true);
    if (!info) return;
    u.uBathy.value = info.depthTex;
    u.uBathyBox.value.set(...info.box);
  }

  dispose() {
    this.mesh?.geometry.dispose();
    this.depthTex?.dispose();
    this.mesh = null;
  }

  /**
   * The depth of the water down to the first solid under the sea surface, per column
   * (0 where there is land). Bytes: depth / DEEP · 255, sampled with linear filtering.
   */
  updateDepth(force = false) {
    const w = this.world;
    if (!w?.sea) return;
    if (!force && (w.time ?? 0) - this.depthStamp < 3) return;
    this.depthStamp = w.time ?? 0;
    const { nx, ny, nz, h, mat } = w;
    if (!this.depthData || this.depthData.length !== nx * nz) {
      this.depthTex?.dispose();
      this.depthData = new Uint8Array(nx * nz);
      this.depthTex = new THREE.DataTexture(this.depthData, nx, nz, THREE.RedFormat, THREE.UnsignedByteType);
      this.depthTex.magFilter = THREE.LinearFilter;
      this.depthTex.minFilter = THREE.LinearFilter;
      this.depthTex.wrapS = this.depthTex.wrapT = THREE.ClampToEdgeWrapping;
      this.uniforms.uDepthTex.value = this.depthTex;
    }
    const level = w.sea.level;
    const yTop = Math.min(ny - 1, Math.floor((level + 0.25) / h));
    const D = this.depthData;
    // a ship at sea: open water under and around it (its hull is not the bottom)
    if (w.sea.box[2] - w.sea.box[0] > 0.01) {
      D.fill(255);
      this.depthTex.needsUpdate = true;
      return;
    }
    for (let z = 0; z < nz; z++)
      for (let x = 0; x < nx; x++) {
        let d = DEEP;
        for (let y = yTop; y >= 0; y--)
          if (mat[x + nx * (y + ny * z)]) {
            d = Math.max(0, level - (y + 1) * h);
            break;
          }
        D[x + nx * z] = Math.round((Math.min(d, DEEP) / DEEP) * 255);
      }
    // the sea floor drops away from the shore (a shelf of ~30 %): the bottom the voxels give
    // is only the first metres, flat out to the edge of the scene
    const dist = (this.distBuf ??= new Float32Array(nx * nz));
    if (dist.length !== nx * nz) this.distBuf = new Float32Array(nx * nz);
    const dd = this.distBuf;
    for (let k = 0; k < nx * nz; k++) dd[k] = D[k] === 0 ? 0 : 1e6;
    const c1 = 1;
    const c2 = Math.SQRT2;
    for (let z = 0; z < nz; z++)
      for (let x = 0; x < nx; x++) {
        const k = x + nx * z;
        if (x > 0) dd[k] = Math.min(dd[k], dd[k - 1] + c1);
        if (z > 0) dd[k] = Math.min(dd[k], dd[k - nx] + c1);
        if (x > 0 && z > 0) dd[k] = Math.min(dd[k], dd[k - nx - 1] + c2);
        if (x < nx - 1 && z > 0) dd[k] = Math.min(dd[k], dd[k - nx + 1] + c2);
      }
    for (let z = nz - 1; z >= 0; z--)
      for (let x = nx - 1; x >= 0; x--) {
        const k = x + nx * z;
        if (x < nx - 1) dd[k] = Math.min(dd[k], dd[k + 1] + c1);
        if (z < nz - 1) dd[k] = Math.min(dd[k], dd[k + nx] + c1);
        if (x < nx - 1 && z < nz - 1) dd[k] = Math.min(dd[k], dd[k + nx + 1] + c2);
        if (x > 0 && z < nz - 1) dd[k] = Math.min(dd[k], dd[k + nx - 1] + c2);
      }
    for (let k = 0; k < nx * nz; k++) {
      if (this.uniforms.uHasBathy.value > 0.5) break; // the island group's sea floor goes on outside: no made-up shelf
      if (D[k] === 0 || dd[k] >= 1e6) continue;
      const d = (D[k] / 255) * DEEP + Math.max(0, dd[k] * h - 2) * 0.3;
      D[k] = Math.round((Math.min(d, DEEP) / DEEP) * 255);
    }
    this.depthTex.needsUpdate = true;
  }

  /** Waves from the wind: their height, length, direction and spread. */
  setWeather(weather, sky, grey) {
    this.weather = weather;
    const U = weather.windSpeed ?? 0;
    const dir = ((weather.windDir ?? 0) * Math.PI) / 180;
    // significant wave height of a fully developed sea, capped for the scale of the scenes;
    // a low swell from far away even when it is calm here
    // (in a storm, above ~10 m/s, it keeps growing more slowly: up to 4.5 m)
    const Hs = Math.min(U <= 9.5 ? 2.2 : 2.2 + (U - 9.5) * 0.16, 4.5, 0.15 + 0.0246 * U * U);
    // the peak wavelength: grows with the wind (deep water, L = g·T²/2π, T ≈ 0.73·U)
    const Lp = Math.min(110, Math.max(7, 0.83 * U * U));
    const f = [1, 0.63, 0.41, 0.27, 0.18, 0.12, 0.08, 0.055];
    const spread = [0, 0.45, -0.38, 0.8, -0.7, 1.05, -0.95, 0.25];
    const u = this.uniforms;
    let sum = 0;
    for (let k = 0; k < MAX_WAVES; k++) sum += f[k];
    for (let k = 0; k < MAX_WAVES; k++) {
      const L = Lp * f[k];
      const a = dir + spread[k] * (0.5 + 0.5 * Math.min(1, U / 8)); // a short-crested sea in a wind
      const amp = (Hs / 2) * (f[k] / sum) * 1.6;
      u.uWaves.value[k].set(Math.cos(a), Math.sin(a), (2 * Math.PI) / L, amp);
    }
    u.uHs.value = Hs;
    u.uWind.value = U;
    u.uSteep.value = 0.35 + 0.45 * Math.min(1, U / 12); // choppier in a strong wind
    u.uRain.value = Math.min(1, (weather.rain ?? 0) / 20);
    if (sky) u.uSky.value.copy(sky);
    u.uGrey.value = grey ?? 0;
    u.uDir.value.set(Math.cos(dir), Math.sin(dir));
  }

  update(time) {
    this.uniforms.uTime.value = time;
    this.updateDepth();
  }

  /**
   * Height of the waves (m, relative to the still sea level) at world (x, z) now: the same
   * waves as the shader (their vertical part), lower in shallow water and in a hull's lee.
   * A swimmer rides on them.
   */
  heightAt(x, z) {
    const u = this.uniforms;
    if (!this.mesh) return 0;
    const t = u.uTime.value;
    const b = u.uDepthBox.value;
    let dep = DEEP;
    if (this.depthData && this.world) {
      const { nx, nz } = this.world;
      const ix = Math.floor(((x - b.x) / (b.z - b.x)) * nx);
      const iz = Math.floor(((z - b.y) / (b.w - b.y)) * nz);
      if (ix >= 0 && iz >= 0 && ix < nx && iz < nz) dep = (this.depthData[ix + nx * iz] / 255) * DEEP;
    }
    const Hs = u.uHs.value;
    const shoal = Math.min(1, Math.max(0.12, dep / Math.max(0.6, 1.3 * Hs)));
    let damp = shoal;
    if (u.uHasHole.value > 0.5) {
      const hb = u.uHull.value;
      const qx = Math.abs(x - (hb.x + hb.z) / 2) - (hb.z - hb.x) / 2;
      const qz = Math.abs(z - (hb.y + hb.w) / 2) - (hb.w - hb.y) / 2;
      const d = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
      const s = Math.min(1, Math.max(0, (d + 1) / (7 + 3 * Hs)));
      damp *= 0.6 + 0.4 * s * s * (3 - 2 * s);
    }
    let y = 0;
    u.uWaves.value.forEach((wv, k) => {
      const om = Math.sqrt(9.81 * wv.z);
      y += wv.w * damp * Math.sin(wv.z * (wv.x * x + wv.y * z) - om * t + k * 1.7);
    });
    return y;
  }

  makeMaterial() {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.07, metalness: 0.0, transparent: true, side: THREE.DoubleSide, depthWrite: true });
    const U = this.uniforms;
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, U);
      const common = /* glsl */ `
uniform float uTime, uSteep, uHs, uWind, uRain, uGrey, uLevel, uHasHole;
uniform vec2 uDir;
uniform vec4 uWaves[${MAX_WAVES}];
uniform vec3 uSky;
uniform sampler2D uDepthTex;
uniform vec4 uDepthBox, uHole, uHull, uBathyBox;
uniform sampler2D uBathy;
uniform float uHasBathy;
float oHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float oNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(oHash(i), oHash(i + vec2(1, 0)), u.x), mix(oHash(i + vec2(0, 1)), oHash(i + vec2(1, 1)), u.x), u.y);
}
// depth of the water at world (x, z): the map inside the scene, a shelf falling away outside it
float oDepth(vec2 xz) {
  vec2 uv = (xz - uDepthBox.xy) / (uDepthBox.zw - uDepthBox.xy);
  float d = texture2D(uDepthTex, clamp(uv, 0.0, 1.0)).r * ${DEEP.toFixed(1)};
  vec2 size = uDepthBox.zw - uDepthBox.xy;
  vec2 o = max(max(-uv, uv - 1.0), 0.0) * size;
  // the bottom falls away towards the edge of the scene (the voxels stop there): no square shelf
  vec2 inside = min(uv, 1.0 - uv) * size;
  float edge = max(0.0, 5.0 - min(inside.x, inside.y));
  if (uHasBathy > 0.5) {
    // the island group's sea floor (render/archipelago.js) outside the zone, blending into
    // the voxels' own depth over the last metres inside it
    vec2 ub = (xz - uBathyBox.xy) / (uBathyBox.zw - uBathyBox.xy);
    float b = texture2D(uBathy, clamp(ub, 0.0, 1.0)).r;
    if (d > ${(DEEP - 0.5).toFixed(1)}) return b; // no ground of the zone's own here (its edge, or under a ship)
    if (length(o) > 0.0) return b;
    return mix(b, d, smoothstep(0.0, 6.0, min(inside.x, inside.y)));
  }
  return d + edge * edge * 0.45 + length(o) * 0.6;
}
// distance (m) from the hull's footprint (0 inside it), large without a hull
float oHull(vec2 xz) {
  if (uHasHole < 0.5) return 1e4;
  vec2 c = 0.5 * (uHull.xy + uHull.zw), e = 0.5 * (uHull.zw - uHull.xy);
  vec2 q = abs(xz - c) - e;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}
// waves are lower and steeper in shallow water, and damped in the lee of a hull
float oDamp(vec2 xz, float depth) {
  float shoal = clamp(depth / max(0.6, 1.3 * uHs), 0.12, 1.0);
  float hull = smoothstep(-1.0, 6.0 + 3.0 * uHs, oHull(xz));
  return shoal * mix(0.6, 1.0, hull);
}
// Gerstner waves at world (x, z): displacement (x, y, z) and the normal
vec3 oWaves(vec2 xz, float damp, out vec3 n) {
  vec3 d = vec3(0.0);
  vec3 dx = vec3(1.0, 0.0, 0.0), dz = vec3(0.0, 0.0, 1.0);
  for (int k = 0; k < ${MAX_WAVES}; k++) {
    vec4 w = uWaves[k];
    float kk = w.z, a = w.w * damp;
    float om = sqrt(9.81 * kk);
    float ph = kk * dot(w.xy, xz) - om * uTime + float(k) * 1.7;
    float s = sin(ph), c = cos(ph);
    float q = uSteep / (kk * max(w.w, 1e-4) * ${MAX_WAVES.toFixed(1)});
    q = min(q, 1.0);
    d += vec3(q * a * w.x * c, a * s, q * a * w.y * c);
    float wa = kk * a;
    dx += vec3(-q * w.x * w.x * wa * s, w.x * wa * c, -q * w.x * w.y * wa * s);
    dz += vec3(-q * w.x * w.y * wa * s, w.y * wa * c, -q * w.y * w.y * wa * s);
  }
  n = normalize(cross(dz, dx));
  return d;
}
varying vec3 vOWorld;
varying vec2 vOLocal;
varying float vOCrest;
`;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + common)
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
vOLocal = position.xy;
vec3 oW = (modelMatrix * vec4(position, 1.0)).xyz;
float oDep = oDepth(oW.xz);
vec3 oN;
vec3 oD = oWaves(oW.xz, oDamp(oW.xz, oDep), oN);
// local frame of the sea plane: x = world x, y = -world z, z = up
transformed += vec3(oD.x, -oD.z, oD.y);
vOCrest = oD.y / max(uHs * 0.5, 0.05);
vOWorld = oW + oD;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + common)
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
// the hull's footprint: no sea inside the ship
if (uHasHole > 0.5 && vOLocal.x > uHole.x && vOLocal.x < uHole.z && -vOLocal.y > uHole.y && -vOLocal.y < uHole.w) discard;
vec2 oxz = vOWorld.xz;
float oDep = oDepth(oxz);
float oHd = oHull(oxz);
float oDmp = oDamp(oxz, oDep);
vec3 oN;
oWaves(oxz, oDmp, oN);
// ripples (wind) and rain rings: only in the normal
float rip = 0.02 + 0.012 * min(uWind, 12.0) + 0.05 * uRain;
vec2 p1 = oxz * 1.7 + vec2(uTime * 0.6, uTime * 0.2);
vec2 p2 = oxz * 4.3 - vec2(uTime * 0.3, -uTime * 0.7);
float e = 0.05;
float r0 = oNoise(p1) + 0.5 * oNoise(p2);
float rx = oNoise(p1 + vec2(e, 0.0)) + 0.5 * oNoise(p2 + vec2(e, 0.0));
float rz = oNoise(p1 + vec2(0.0, e)) + 0.5 * oNoise(p2 + vec2(0.0, e));
oN = normalize(oN + vec3(-(rx - r0) / e, 0.0, -(rz - r0) / e) * rip);
if (uRain > 0.0) {
  vec2 cell = floor(oxz * 3.0);
  float t0 = oHash(cell);
  float age = fract(uTime * 1.3 + t0);
  vec2 ctr = (cell + vec2(oHash(cell + 3.1), oHash(cell + 7.7))) / 3.0;
  float rr = length(oxz - ctr);
  float ring = exp(-pow((rr - age * 0.22) * 40.0, 2.0)) * (1.0 - age) * step(t0, uRain);
  oN = normalize(oN + vec3((oxz - ctr) / max(rr, 1e-3), 0.0).xzy * ring * 0.4);
}
vec3 oV = normalize(cameraPosition - vOWorld);
float oCos = abs(dot(oN, oV));
float oFres = 0.02 + 0.98 * pow(1.0 - oCos, 5.0);
// water colour by depth: clear turquoise over sand, dark blue deep down
float dep = max(oDep, 0.0);
vec3 shallow = vec3(0.26, 0.62, 0.56);
vec3 mid = vec3(0.04, 0.33, 0.42);
vec3 deep = vec3(0.012, 0.075, 0.15);
vec3 wcol = mix(shallow, mid, 1.0 - exp(-dep / 1.4));
wcol = mix(wcol, deep, 1.0 - exp(-dep / 7.0));
// under a grey sky the sea goes grey-green
wcol = mix(wcol, vec3(0.16, 0.22, 0.23) * (0.6 + 0.4 * (1.0 - exp(-dep / 3.0))), uGrey * 0.55);
// light scattered in the crests (thin water lit through)
wcol += vec3(0.02, 0.10, 0.09) * clamp(vOCrest, 0.0, 1.0) * (1.0 - uGrey * 0.6);
// foam: surf breaking on the shore, along the waterline, against the hull, whitecaps
float fn = oNoise(oxz * 2.2 + uTime * 0.15) * 0.6 + oNoise(oxz * 7.0 - uTime * 0.3) * 0.4;
float surf = 0.0;
if (dep < 1.4 * max(0.6, uHs)) {
  float band = sin(dep * 7.0 / max(0.5, uHs) + uTime * 1.5 - fn * 2.0);
  surf = smoothstep(0.55, 1.0, band) * (1.0 - dep / (1.4 * max(0.6, uHs)));
}
float edge = 1.0 - smoothstep(0.03, 0.22 + 0.15 * uHs, dep);
float hull = (1.0 - smoothstep(0.0, 0.8 + 0.6 * uHs, oHd)) * (0.55 + 0.45 * sin(uTime * 1.9 + oxz.x * 0.7 + oxz.y * 0.5));
// whitecaps: on the steepest crests, streaked along the wind
float caps = smoothstep(0.75, 1.25, vOCrest + 0.35 * (fn - 0.5)) * smoothstep(5.0, 12.0, uWind);
// foam is lacy: bubbles and streaks, thinning out at its edges
float lace = smoothstep(0.42, 0.78, oNoise(oxz * 5.0 + uTime * 0.2) * 0.65 + oNoise(oxz * 17.0 - uTime * 0.4) * 0.35);
// spindrift: in a gale the wind tears the foam off the crests into long streaks along it
float along = dot(oxz, uDir), across = dot(oxz, vec2(-uDir.y, uDir.x));
// (broken up: patches of streaks that come and go, not lines across the whole sea)
float drift = smoothstep(0.66, 0.92, oNoise(vec2(along * 0.12 - uTime * 0.9, across * 2.6)) * 0.7 + oNoise(vec2(along * 0.4, across * 7.0)) * 0.3) * smoothstep(0.45, 0.75, oNoise(oxz * 0.08 + uTime * 0.05)) * smoothstep(12.0, 20.0, uWind);
caps = max(caps, smoothstep(0.55, 1.1, vOCrest) * smoothstep(14.0, 22.0, uWind));
float cover = max(max(surf, edge), max(max(hull * 0.9, caps), drift * 0.8));
float foam = clamp(cover * mix(lace, 1.0, cover * cover * 0.6) * smoothstep(0.3, 0.6, fn + 0.2), 0.0, 1.0) * 0.9;
diffuseColor.rgb = mix(wcol, vec3(0.92, 0.95, 0.96), foam);
// clear where it is shallow (you see the bottom), opaque deep down and at grazing angles
float alpha = mix(0.32, 1.0, pow(smoothstep(0.0, 5.0, dep), 0.6)); // opaque where it is deep
diffuseColor.a = clamp(max(alpha + oFres * 0.5, foam), 0.0, 1.0);
vOFoam = foam;
vONw = oN;
vOFres = oFres;`,
        )
        .replace('varying vec3 vOWorld;', 'varying vec3 vOWorld;\nvec3 vONw; float vOFoam; float vOFres;')
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `#include <normal_fragment_maps>
normal = normalize((viewMatrix * vec4(vONw, 0.0)).xyz) * (gl_FrontFacing ? 1.0 : -1.0);`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          /* glsl */ `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor + 0.08 * uRain, 0.9, vOFoam);`,
        )
        .replace(
          '#include <opaque_fragment>',
          /* glsl */ `// the sky mirrored in the water (Fresnel), not on the foam
outgoingLight = mix(outgoingLight, uSky * 0.95, vOFres * (1.0 - vOFoam) * 0.85);
#include <opaque_fragment>`,
        );
    };
    m.customProgramCacheKey = () => 'ocean-v1';
    return m;
  }
}
