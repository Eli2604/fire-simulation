import * as THREE from 'three';
import { makeArchipelago } from '../models/archipelago.js';
import { PATTERN_UNIFORMS, PHOTO_GLSL, PHOTO, photoAtlas } from './patterns.js';

/**
 * The island group round the zone you are in (models/archipelago.js), drawn: the sea
 * floor and the other islands as one terrain, from the zone out to the horizon. Its
 * depth also goes to the sea (render/ocean.js) as a map, so the water over the reefs and
 * lagoons is light and clear, deep blue over the deep floor, and the waves break on
 * the other islands' shores.
 *
 *  - under water: sand (photographed), coral heads on the reefs, darker and bluer deeper;
 *  - on land: beaches, then grass and forest (darker, rough), rock where it is steep or
 *    high, bare rock and ash on the volcanic cones.
 *
 * Inside the simulated zone the voxels are the ground: the terrain is not drawn there.
 */
const A_NOISE = /* glsl */ `
float aHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float aNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(aHash(i), aHash(i + vec2(1.0, 0.0)), u.x), mix(aHash(i + vec2(0.0, 1.0)), aHash(i + vec2(1.0, 1.0)), u.x), u.y);
}`;

/** Snow on the islands round the scene (0..1: as much of the scene's ground as is covered; render/snow.js). */
export const SNOW_COVER = { uSnowCover: { value: 0 } };

export class ArchipelagoRenderer {
  constructor(root) {
    this.root = root;
    this.mesh = null;
  }

  /**
   * spec: the scenario's archipelago; origin: the zone's place in the shared sea; world:
   * the zone's world. Returns { depthTex, box } for the sea (or null).
   */
  set(spec, origin, world) {
    if (this.mesh) {
      this.root.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.mesh = null;
    }
    if (!spec || !origin || !world.sea) return null;
    const A = makeArchipelago(spec);
    const sea = world.sea.level;
    const [sx, , sz] = world.size;
    const cx = sx / 2;
    const cz = sz / 2;
    const R = A.extent;
    const H = (x, z) => A.heightAt(x + origin[0], z + origin[2]);
    // ---- the terrain: a polar grid round the zone, fine near it, coarse far off
    const rings = 200;
    const segs = 320;
    const inner = Math.max(Math.hypot(sx, sz) * 0.75, 40);
    const pos = [];
    const idx = [];
    pos.push(cx, sea + H(cx, cz), cz);
    for (let i = 1; i <= rings; i++) {
      const t = i / rings;
      const r = t < 0.35 ? (inner * t) / 0.35 : inner * Math.pow(R / inner, (t - 0.35) / 0.65);
      for (let j = 0; j < segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        const x = cx + Math.cos(a) * r;
        const z = cz + Math.sin(a) * r;
        pos.push(x, sea + H(x, z), z);
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
    g.computeBoundingSphere();
    // the zone's own box: the voxels are the ground there (a ship: open water)
    // (for an island: its voxel terrain, as the scenario gives it in spec.zones)
    const own = (spec.zones ?? []).find((q) => q.box[0] - origin[0] >= -0.5 && q.box[2] - origin[0] <= sx + 0.5 && q.box[1] - origin[2] >= -0.5 && q.box[3] - origin[2] <= sz + 0.5);
    const [x0, z0, x1, z1] = world.sea.box[2] - world.sea.box[0] > 0.01 ? world.sea.box : own ? [own.box[0] - origin[0], own.box[1] - origin[2], own.box[2] - origin[0], own.box[3] - origin[2]] : [0, 0, sx, sz];
    const U = {
      ...SNOW_COVER,
      uSea: { value: sea },
      uZone: { value: new THREE.Vector4(x0 + 0.01, z0 + 0.01, x1 - 0.01, z1 - 0.01) },
    };
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
    m.onBeforeCompile = (sh) => {
      photoAtlas();
      Object.assign(sh.uniforms, PATTERN_UNIFORMS, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vAW;\nvarying vec3 vAN;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvAW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvAN = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vAW;\nvarying vec3 vAN;\nuniform float uSea;\nuniform float uSnowCover;\nuniform vec4 uZone;\nvec3 aLocal;\n${A_NOISE}\n${PHOTO_GLSL}`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
aLocal = vAW;
// the zone itself: its voxels are the ground there
if (vAW.x > uZone.x && vAW.x < uZone.z && vAW.z > uZone.y && vAW.z < uZone.w) discard;
float ht = vAW.y - uSea; // above (+) or below (-) the sea
vec3 N = normalize(vAN);
float steep = 1.0 - N.y;
vec3 Pp = vAW;
float on = uPhotoOn;
vec3 sandC = vec3(0.62, 0.55, 0.4) * mix(vec3(1.0), photoColour(${PHOTO.sand}, Pp * 0.6, N), on);
vec3 grassC = vec3(0.1, 0.16, 0.05) * mix(vec3(1.0), photoColour(${PHOTO.grass}, Pp * 0.15, N), on);
vec3 rockC = vec3(0.24, 0.22, 0.2) * mix(vec3(1.0), photoColour(${PHOTO.rocks}, Pp * 0.3, N), on);
vec3 ashC = vec3(0.07, 0.065, 0.06) * mix(vec3(1.0), photoColour(${PHOTO.ash}, Pp * 0.4, N), on);
vec3 col;
if (ht < 0.0) {
  // the sea floor: sand, coral heads on the reefs (shallow, rough), darker deep down
  float coral = smoothstep(0.58, 0.78, aNoise(vAW.xz / 6.0) * 0.65 + aNoise(vAW.xz / 1.7) * 0.35) * smoothstep(-9.0, -1.5, ht);
  col = mix(sandC, vec3(0.26, 0.22, 0.18) * (0.75 + 0.5 * aNoise(vAW.xz * 1.3)), coral * 0.65);
  col *= mix(0.35, 1.0, exp(ht / 18.0));
} else {
  // beaches, then grass and forest, rock where it is steep or high
  float beach = 1.0 - smoothstep(1.2, 2.6, ht);
  float rocky = smoothstep(0.35, 0.6, steep) + smoothstep(55.0, 90.0, ht);
  col = mix(grassC, sandC, beach);
  col = mix(col, rockC, clamp(rocky, 0.0, 1.0) * (1.0 - beach));
  col = mix(col, ashC, smoothstep(45.0, 70.0, ht) * smoothstep(0.25, 0.45, steep) * 0.6);
}
// snow lying on the land as it does in the scene: on the open slopes above the shore
col = mix(col, vec3(0.9, 0.92, 0.95), uSnowCover * smoothstep(0.5, 0.85, normalize(vAN).y) * smoothstep(0.4, 1.6, ht));
diffuseColor.rgb = col;`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
if (uPhotoOn > 0.5) normal = normalize((viewMatrix * vec4(photoNormal(vAW.y < uSea + 1.5 ? ${PHOTO.sand} : ${PHOTO.rocks}, vAW * 0.3, normalize(vAN), 1.0), 0.0)).xyz);`,
        );
    };
    m.customProgramCacheKey = () => 'archipelago-v1';
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);

    // ---- the depth map for the sea: a square round the zone, metres of water (0 on land)
    const N = 640;
    const D = new Uint16Array(N * N);
    const half = R;
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const x = cx - half + ((i + 0.5) / N) * 2 * half;
        const z = cz - half + ((j + 0.5) / N) * 2 * half;
        // a little finer near the zone: the map is sampled from the function directly
        D[i + N * j] = THREE.DataUtils.toHalfFloat(Math.max(0, -H(x, z)));
      }
    const tex = new THREE.DataTexture(D, N, N, THREE.RedFormat, THREE.HalfFloatType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    this.depthTex = tex;
    return { depthTex: tex, box: [cx - half, cz - half, cx + half, cz + half] };
  }
}
