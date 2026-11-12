import * as THREE from 'three';

/**
 * Draws the snow lying in the scene (sim/snow.js): one mesh over its cells, each vertex on
 * the surface the snow lies on and raised by the snow's depth there (read from a float
 * texture the simulation's field is copied into a few times a second). Where it is thin it
 * thins out to patches; packed snow (a trail of footprints, where a dragon lay) is greyer
 * and smoother than fresh powder, and lies lower. Its normals come from the neighbouring
 * cells, so trails and the melted ring round a fire are seen by their light and shade.
 * Cells over a wall's edge are not joined (no curtains of snow down a wall).
 */
const VERT_HEAD = /* glsl */ `
uniform sampler2D uSnow;
uniform float uCell;
attribute vec2 aCell;
varying float vDepth;
varying float vRho;
varying vec3 vSnowPos;
float snowTop(ivec2 c) {
  vec4 s = texelFetch(uSnow, c, 0);
  return s.b + s.r;
}
`;
const VERT_BEGIN = /* glsl */ `
vec4 snowS = texelFetch(uSnow, ivec2(aCell), 0);
vec3 transformed = vec3(position.x, snowS.b + snowS.r, position.z);
vDepth = snowS.r;
vRho = snowS.g;
vSnowPos = transformed;
`;
const FRAG_HEAD = /* glsl */ `
varying float vDepth;
varying float vRho;
varying vec3 vSnowPos;
float snowHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float snowNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(snowHash(i), snowHash(i + vec2(1, 0)), f.x), mix(snowHash(i + vec2(0, 1)), snowHash(i + vec2(1, 1)), f.x), f.y);
}
`;

export class SnowRenderer {
  constructor(root) {
    this.root = root;
    this.mesh = null;
    this.uniforms = { uSnow: { value: null }, uCell: { value: 0.2 } };
    const U = this.uniforms;
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, metalness: 0 });
    this.material.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + VERT_HEAD)
        .replace(
          '#include <beginnormal_vertex>',
          `#include <beginnormal_vertex>
          {
            ivec2 c0 = ivec2(aCell);
            vec4 s0 = texelFetch(uSnow, c0, 0);
            ivec2 sz0 = textureSize(uSnow, 0);
            float m0 = s0.b + s0.r;
            float l0 = snowTop(ivec2(max(c0.x - 1, 0), c0.y));
            float r0 = snowTop(ivec2(min(c0.x + 1, sz0.x - 1), c0.y));
            float d0 = snowTop(ivec2(c0.x, max(c0.y - 1, 0)));
            float u0 = snowTop(ivec2(c0.x, min(c0.y + 1, sz0.y - 1)));
            if (abs(l0 - m0) > uCell * 3.0) l0 = m0;
            if (abs(r0 - m0) > uCell * 3.0) r0 = m0;
            if (abs(d0 - m0) > uCell * 3.0) d0 = m0;
            if (abs(u0 - m0) > uCell * 3.0) u0 = m0;
            objectNormal = normalize(vec3(l0 - r0, 2.0 * uCell, d0 - u0));
          }`,
        )
        .replace('#include <begin_vertex>', VERT_BEGIN);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            // thin snow lies in patches (the ground shows between), deep snow everywhere
            float n = snowNoise(vSnowPos.xz * 3.1) * 0.6 + snowNoise(vSnowPos.xz * 11.0) * 0.4;
            if (vDepth < 0.002 + 0.03 * n) discard;
            // fresh powder bright, packed snow (trodden, settled) greyer and bluer
            float packed = clamp((vRho - 200.0) / 250.0, 0.0, 1.0);
            vec3 fresh = vec3(0.93, 0.95, 0.98);
            vec3 trod = vec3(0.70, 0.74, 0.80);
            diffuseColor.rgb = mix(fresh, trod, packed) * (0.94 + 0.06 * n);
          }`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          // glints of the crystals in fresh snow; packed snow is smoother, a little glossy
          roughnessFactor = mix(0.8, 0.55, clamp((vRho - 200.0) / 250.0, 0.0, 1.0)) - 0.35 * step(0.985, snowHash(floor(vSnowPos.xz * 140.0)));`,
        );
    };
    this.material.customProgramCacheKey = () => 'snow-v1';
    this.version = -1;
    this.geomVersion = -1;
    this.lastUpload = -1;
  }

  setWorld(world) {
    this.world = world;
    this.drop();
  }

  drop() {
    if (this.mesh) {
      this.root.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    this.tex?.dispose();
    this.tex = null;
    this.field = null;
    this.version = this.geomVersion = -1;
  }

  /** Share of the ground covered (0..1), for the land beyond the scene (render/archipelago.js). */
  cover() {
    return this.coverShare ?? 0;
  }

  update(time) {
    const w = this.world;
    const S = w?.snow;
    if (!S) {
      if (this.mesh) this.drop();
      this.coverShare = 0;
      return;
    }
    if (S !== this.field) {
      this.drop();
      this.field = S;
      this.data = new Float32Array(S.sx * S.sz * 4);
      this.tex = new THREE.DataTexture(this.data, S.sx, S.sz, THREE.RGBAFormat, THREE.FloatType);
      this.tex.minFilter = this.tex.magFilter = THREE.NearestFilter;
      this.uniforms.uSnow.value = this.tex;
      this.uniforms.uCell.value = S.sh;
    }
    if (S.geomVersion !== this.geomVersion) this.build(S, w);
    // copy the field over a few times a second at most (and when footprints are made)
    const now = performance.now();
    if (S.version !== this.version && now - this.lastUpload > 200) {
      const d = this.data;
      let covered = 0;
      let cells = 0;
      for (let j = 0; j < S.depth.length; j++) {
        d[j * 4] = S.depth[j];
        d[j * 4 + 1] = S.rho[j];
        d[j * 4 + 2] = S.base[j];
        if (S.cover[j]) {
          cells++;
          if (S.depth[j] > 0.01) covered++;
        }
      }
      this.coverShare = cells ? covered / cells : 0;
      this.tex.needsUpdate = true;
      this.version = S.version;
      this.lastUpload = now;
    }
    void time;
  }

  build(S, w) {
    if (this.mesh) {
      this.root.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    this.geomVersion = S.geomVersion;
    const { sx, sz, sh, base, cover } = S;
    const n = sx * sz;
    const pos = new Float32Array(n * 3);
    const cell = new Float32Array(n * 2);
    for (let z = 0; z < sz; z++)
      for (let x = 0; x < sx; x++) {
        const j = x + sx * z;
        pos[j * 3] = (x + 0.5) * sh;
        pos[j * 3 + 1] = base[j];
        pos[j * 3 + 2] = (z + 0.5) * sh;
        cell[j * 2] = x;
        cell[j * 2 + 1] = z;
      }
    // quads between four cells that can all hold snow, not over a wall's edge
    const step = w.h * 0.8;
    const idx = [];
    for (let z = 0; z + 1 < sz; z++)
      for (let x = 0; x + 1 < sx; x++) {
        const a = x + sx * z;
        const b = a + 1;
        const c = a + sx;
        const d = c + 1;
        if (!cover[a] || !cover[b] || !cover[c] || !cover[d]) continue;
        const lo = Math.min(base[a], base[b], base[c], base[d]);
        const hi = Math.max(base[a], base[b], base[c], base[d]);
        if (hi - lo > step) continue;
        idx.push(a, c, b, b, c, d);
      }
    if (!idx.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aCell', new THREE.BufferAttribute(cell, 2));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(...w.size.map((v) => v / 2)), Math.hypot(...w.size));
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
    this.version = -1; // fill the texture
    this.lastUpload = -1;
  }
}
