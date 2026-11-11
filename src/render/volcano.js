import * as THREE from 'three';

/**
 * Volcanoes drawn as mountains (models/volcano.js, sim/volcano.js). The cone's
 * voxels are hidden; this draws its surface smooth over them:
 *
 *  - the cone with its crater bowl and the vent in the middle of it, old lava
 *    flows as ridges down the flanks, gullies cut by rain down the slopes;
 *  - the rock: dark basalt, rough and blocky on the old flows ('a'ā), reddish-brown
 *    oxidised scoria and yellowish sulphur crusts around the crater, grey ash streaks
 *    down the slopes, some scrub and grass on the lower flanks;
 *  - while it erupts: the crater and the vent glow orange-red, flickering, and the
 *    upper slopes are lit from below by it. As it dies down the glow fades.
 *
 * The fresh lava itself is voxels (they flow, glow while molten and darken as they
 * set): they lie on this surface.
 */
export class VolcanoRenderer {
  constructor(root) {
    this.group = new THREE.Group();
    root.add(this.group);
    this.items = [];
  }

  setWorld(world) {
    for (const it of this.items) {
      this.group.remove(it.mesh);
      it.mesh.geometry.dispose();
      it.mesh.material.dispose();
    }
    this.items = [];
    this.world = world;
    for (const v of world.volcanoes ?? []) if (v.shape) this.items.push(this.build(world, v));
  }

  /** Height of the surface at (x, z), world coordinates. */
  static surface(s, h, x, z) {
    const bx = s.base[0];
    const bz = s.base[2];
    const r = Math.hypot(x - bx, z - bz);
    // the cone (the outside of its voxels: half a voxel above the true surface)
    let y = s.base[1] + s.height * (1 - r / s.radius) + h * 0.5;
    // the old lava flows: rounded ridges down the flanks
    for (const rd of s.ridges) {
      const ax = rd.a[0];
      const az = rd.a[2];
      const dx = rd.b[0] - ax;
      const dz = rd.b[2] - az;
      const L2 = dx * dx + dz * dz;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
      const d = Math.hypot(x - ax - t * dx, z - az - t * dz);
      if (d >= rd.r * 1.3) continue;
      const cy = rd.a[1] + t * (rd.b[1] - rd.a[1]);
      const top = cy + Math.sqrt(Math.max(0, (rd.r * 1.3) ** 2 - d * d)) * 0.75 + h * 0.3;
      y = Math.max(y, top);
    }
    // gullies down the slopes
    const a = Math.atan2(z - bz, x - bx);
    const rf = r / s.radius;
    y -= 0.12 * Math.pow(Math.abs(Math.sin(a * 9 + Math.sin(a * 3 + s.seed) * 1.5 + rf * 3)), 3) * Math.min(1, rf * 3);
    // the crater: a bowl, the vent in the middle of it
    const [cx, cy, cz] = s.bowl;
    const rc = Math.hypot(x - cx, z - cz);
    const [br, bh] = s.bowlR;
    if (rc < br) y = Math.min(y, cy - bh * Math.sqrt(1 - (rc / br) ** 2));
    if (rc < s.vent) y = Math.min(y, cy - bh - 0.6 - (1 - rc / s.vent) * 0.4);
    return y;
  }

  build(w, v) {
    const s = v.shape;
    const h = w.h;
    const rings = 90;
    const segs = 160;
    const pos = [];
    const idx = [];
    const R = s.radius;
    const bx = s.base[0];
    const bz = s.base[2];
    // denser rings near the crater
    const radiusAt = (i) => R * Math.pow(i / rings, 1.35);
    pos.push(bx, VolcanoRenderer.surface(s, h, bx, bz), bz);
    for (let i = 1; i <= rings; i++) {
      const r = radiusAt(i);
      for (let j = 0; j < segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        const x = bx + Math.cos(a) * r;
        const z = bz + Math.sin(a) * r;
        pos.push(x, VolcanoRenderer.surface(s, h, x, z), z);
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
    g.setIndex(idx);
    g.computeVertexNormals();
    const uniforms = {
      uHeat: { value: 0 },
      uTime: { value: 0 },
      uBowl: { value: new THREE.Vector4(s.bowl[0], s.bowl[1], s.bowl[2], s.bowlR[0]) },
      uBase: { value: new THREE.Vector4(s.base[0], s.base[1], s.base[2], s.height) },
      uVent: { value: s.vent },
      uSeed: { value: s.seed ?? 1 },
    };
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93, metalness: 0 });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      const common = /* glsl */ `
uniform float uHeat, uTime, uVent, uSeed;
uniform vec4 uBowl, uBase;
varying vec3 vVW;
float vHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(vHash(i), vHash(i + vec3(1, 0, 0)), u.x), mix(vHash(i + vec3(0, 1, 0)), vHash(i + vec3(1, 1, 0)), u.x), u.y),
             mix(mix(vHash(i + vec3(0, 0, 1)), vHash(i + vec3(1, 0, 1)), u.x), mix(vHash(i + vec3(0, 1, 1)), vHash(i + vec3(1, 1, 1)), u.x), u.y), u.z);
}
float vFbm(vec3 p) { float s = 0.0, a = 0.5; for (int k = 0; k < 5; k++) { s += a * vNoise(p); p *= 2.03; a *= 0.5; } return s; }
// rough blocky rock: cells of clinker
float vClinker(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  float d = 1.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 o = vec3(x, y, z);
    vec3 c = o + vec3(vHash(i + o), vHash(i + o + 7.1), vHash(i + o + 3.3)) - f;
    d = min(d, dot(c, c));
  }
  return sqrt(d);
}
`;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vVW;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvVW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + common)
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
vec3 P = vVW + uSeed * 13.0;
float hf = clamp((vVW.y - uBase.y - 8.0) / max(uBase.w - 8.0, 1.0), 0.0, 1.0); // 0 at the foot, 1 at the rim
float rc = length(vVW.xz - uBowl.xz);
float inBowl = 1.0 - smoothstep(uBowl.w * 0.9, uBowl.w * 1.25, rc);
float n1 = vFbm(P * 0.6);
float n2 = vFbm(P * 3.1);
float cl = vClinker(P * 2.4);
// dark basalt, a little lighter and browner where weathered
vec3 col = mix(vec3(0.018, 0.017, 0.017), vec3(0.05, 0.044, 0.04), n1 * 0.9);
col *= 0.75 + 0.5 * n2;
// rough clinker: light edges, dark gaps
col *= 0.7 + 0.6 * smoothstep(0.15, 0.6, cl);
// grey ash streaks down the slopes
float streak = smoothstep(0.55, 0.8, vNoise(vec3(atan(vVW.z - uBase.z, vVW.x - uBase.x) * 9.0, vVW.y * 0.25, uSeed)));
col = mix(col, vec3(0.11, 0.105, 0.1) * (0.8 + 0.3 * n2), streak * 0.5 * smoothstep(0.15, 0.6, hf));
// oxidised red-brown scoria round the crater, sulphur crusts at its lip
col = mix(col, vec3(0.11, 0.035, 0.016) * (0.6 + 0.6 * n2), smoothstep(0.7, 0.95, hf + 0.15 * (n1 - 0.5)) * 0.8);
col = mix(col, vec3(0.32, 0.27, 0.05), smoothstep(0.86, 0.95, n2) * smoothstep(0.8, 1.0, hf) * (1.0 - inBowl) * 0.7);
// scrub and grass on the lower flanks
float veg = smoothstep(0.32, 0.12, hf + 0.25 * (n1 - 0.5)) * smoothstep(0.45, 0.65, vNoise(P * 1.3));
col = mix(col, vec3(0.035, 0.06, 0.015) * (0.7 + 0.5 * n2), veg * 0.8);
// the crater floor: burnt, black and glassy
col = mix(col, vec3(0.012, 0.011, 0.011), inBowl * 0.7);
diffuseColor.rgb = col;
float vBumpH = n2 * 0.6 + (1.0 - cl) * 0.35 * (1.0 - veg);`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `#include <normal_fragment_maps>
{
  // bump: the relief of the clinker and the noise
  vec3 dpdx = dFdx(-vViewPosition), dpdy = dFdy(-vViewPosition);
  float hx = dFdx(vBumpH), hy = dFdy(vBumpH);
  vec3 R1 = cross(dpdy, normal), R2 = cross(normal, dpdx);
  float det = dot(dpdx, R1);
  vec3 grad = sign(det) * (hx * R1 + hy * R2) * 0.06;
  normal = normalize(abs(det) * normal - grad);
}`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `#include <emissivemap_fragment>
// the eruption: the crater glows, brightest down the vent, flickering
float flick = 0.75 + 0.25 * sin(uTime * 7.0 + rc * 3.0) * sin(uTime * 3.1 + vVW.y);
float vent = 1.0 - smoothstep(uVent * 0.6, uVent * 1.6, rc);
float glow = uHeat * (inBowl * (0.35 + 0.65 * (1.0 - hf)) + vent * 1.5) * flick;
// cracks in the crust glow too
glow += uHeat * inBowl * smoothstep(0.12, 0.02, cl) * 1.2;
totalEmissiveRadiance += vec3(1.0, 0.32, 0.06) * glow * 2.2;`,
        );
    };
    m.customProgramCacheKey = () => 'volcano-v1';
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return { v, mesh, uniforms };
  }

  update(time) {
    for (const it of this.items) {
      const v = it.v;
      // the glow builds up in a few seconds and fades as it dies down
      const target = v.state === 'erupting' ? (v.t < v.duration - 20 ? 1 : Math.max(0.15, (v.duration - v.t) / 20)) : v.state === 'spent' ? 0.05 : 0;
      it.uniforms.uHeat.value += (target - it.uniforms.uHeat.value) * 0.05;
      it.uniforms.uTime.value = time;
    }
  }
}
