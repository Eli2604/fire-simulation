import * as THREE from 'three';
import { MATERIALS, MAT } from '../sim/materials.js';
import { WATER_GLSL, waterColour, waterSettings } from './waterOptics.js';

/**
 * The water's light, shared by everything drawn in or under it (render/waterOptics.js has the
 * optics): the sun (its direction, colour and strength, for the glitter on the waves and the
 * caustics on the floor), the water's clarity, turbidity, grease and turbulence (the weather's
 * settings), the time; and for floors under the sea: its level, its depth map, a ship's hole.
 *
 *  - addUnderwater(shader, P): a floor under the sea (the island group's, the voxels) seen
 *    through the water: red going first, the deep water's colour in front, caustics in the shallows.
 *  - InlandWaterRenderer: the surface of ponds, lakes and canals (voxel water): the colour of
 *    the water over its bed per column (waterColour), ripples, the sky mirrored (Fresnel), the
 *    sun's glitter, an oil film's rainbow sheen.
 */
export const WATER_UNIFORMS = {
  uWSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
  uWSunCol: { value: new THREE.Color(1, 0.95, 0.87) },
  uWSun: { value: 1 },
  uWTime: { value: 0 },
  uWClarity: { value: 0.9 },
  uWTurbid: { value: 0 },
  uWGrease: { value: 0 },
  uWTurb: { value: 0 },
  uWSky: { value: new THREE.Color(0x8fb7dc) },
  uWWind: { value: 0 },
  // the sea, for the floors under it
  uWHasSea: { value: 0 },
  uWSeaLevel: { value: 0 },
  uWDepthTex: { value: null },
  uWDepthBox: { value: new THREE.Vector4(0, 0, 1, 1) },
  uWHole: { value: new THREE.Vector4(0, 0, 0, 0) },
};

/** The weather's water settings into the shared uniforms. */
export function setWaterWeather(weather) {
  const s = waterSettings(weather);
  const U = WATER_UNIFORMS;
  U.uWClarity.value = s.clarity;
  U.uWTurbid.value = s.turbidity;
  U.uWGrease.value = s.grease;
  U.uWTurb.value = s.turbulence;
  U.uWWind.value = weather.windSpeed ?? 0;
  return s;
}

/** The sun as it is now: the direction its light comes from, its colour, its strength (0..~1). */
export function setWaterSun(dir, color, strength) {
  WATER_UNIFORMS.uWSunDir.value.copy(dir).normalize();
  WATER_UNIFORMS.uWSunCol.value.copy(color);
  WATER_UNIFORMS.uWSun.value = Math.max(0, strength);
}

/** The sea (its level, depth map, a ship's hole), or none. */
export function setWaterSea(world, ocean) {
  const U = WATER_UNIFORMS;
  const s = world?.sea && !world.vacuum ? world.sea : null;
  U.uWHasSea.value = s ? 1 : 0;
  if (!s) return;
  U.uWSeaLevel.value = s.level;
  U.uWDepthTex.value = ocean?.uniforms.uDepthTex.value ?? null;
  U.uWDepthBox.value.copy(ocean?.uniforms.uDepthBox.value ?? new THREE.Vector4(0, 0, world.size[0], world.size[2]));
  const [x0, z0, x1, z1] = s.box;
  U.uWHole.value.set(x0, z0, x1, z1);
}

/**
 * Patch a floor's fragment shader: what lies under the sea is seen through the water. P: a
 * GLSL expression for the fragment's world position. voxels: check the depth map (only what is
 * the bottom of open water, not a cellar under the shore).
 */
export function addUnderwater(shader, P, { voxels = false } = {}) {
  Object.assign(shader.uniforms, WATER_UNIFORMS);
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
uniform float uWHasSea, uWSeaLevel;
uniform sampler2D uWDepthTex;
uniform vec4 uWDepthBox, uWHole;
${WATER_GLSL}`,
    )
    .replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
{
  vec3 uwP = ${P};
  float uwD = uWSeaLevel - uwP.y;
  bool uwIn = uWHasSea > 0.5 && uwD > 0.0;
  ${
    voxels
      ? `if (uwIn) {
    vec2 uv = (uwP.xz - uWDepthBox.xy) / (uWDepthBox.zw - uWDepthBox.xy);
    float col = texture2D(uWDepthTex, clamp(uv, 0.0, 1.0)).r * 12.0;
    // (not inside a ship's hull: its hold is dry)
    uwIn = (col > 11.5 || uwD <= col + 0.6) && !(uwP.x > uWHole.x && uwP.x < uWHole.z && uwP.z > uWHole.y && uwP.z < uWHole.w);
  }`
      : ''
  }
  if (uwIn) {
    float tE = wTurbidAt(uwD);
    // caustics: sharp near the surface, fading with depth and in murky water
    float cg = wAbsorb(tE).g + wScatter(tE);
    float ca = wCaustic(uwP.xz, uWTime) * min(uWSun, 1.0) * exp(-uwD * cg * 1.2) * smoothstep(0.0, 0.5, uwD) * (1.0 - 0.6 * uWGrease);
    diffuseColor.rgb = wSeenK(diffuseColor.rgb * (1.0 + 0.8 * ca), uwD, tE, wPath(normalize(cameraPosition - uwP)));
  }
}`,
    );
}

/**
 * The surface of fresh water held in the voxels (ponds, lakes, the canal): a quad over every
 * column whose top is water, coloured by the water over its bed (render/waterOptics.js), with
 * the ripples, the sky, the sun and the grease done in its shader.
 */
export class InlandWaterRenderer {
  constructor(parent) {
    this.parent = parent;
    this.mesh = null;
    this.key = '';
    this.t = 0;
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.06, metalness: 0 });
    this.material.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, WATER_UNIFORMS);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vIW;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvIW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vIW;\nuniform vec3 uWSky;\nuniform float uWWind;\nvec3 iwN; float iwSlick;\n${WATER_GLSL}`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
iwSlick = wSlick(vIW.xz);
// ripples: the wind's, choppier when stirred, calmed by an oil film
float iwRip = (0.03 + 0.012 * min(uWWind, 12.0)) * (1.0 + 2.5 * uWTurb) * (1.0 - 0.85 * iwSlick);
vec2 iq1 = vIW.xz * 2.1 + vec2(uWTime * 0.5, uWTime * 0.2);
vec2 iq2 = vIW.xz * 5.3 - vec2(uWTime * 0.3, -uWTime * 0.6);
float ie = 0.05;
float ir0 = wNoise(iq1) + 0.5 * wNoise(iq2);
float irx = wNoise(iq1 + vec2(ie, 0.0)) + 0.5 * wNoise(iq2 + vec2(ie, 0.0));
float irz = wNoise(iq1 + vec2(0.0, ie)) + 0.5 * wNoise(iq2 + vec2(0.0, ie));
iwN = normalize(vec3(-(irx - ir0) / ie * iwRip, 1.0, -(irz - ir0) / ie * iwRip));
// stirred-up water: flecks of foam
float iwFoam = uWTurb * smoothstep(0.62, 0.9, wNoise(vIW.xz * 3.0 + uWTime * 0.4) * 0.7 + wNoise(vIW.xz * 11.0) * 0.3) * (1.0 - 0.7 * iwSlick);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.88, 0.88), iwFoam);`,
        )
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(iwN, 0.0)).xyz);')
        .replace(
          '#include <opaque_fragment>',
          `{
  vec3 V = normalize(cameraPosition - vIW);
  float fr = 0.02 + 0.98 * pow(1.0 - abs(dot(iwN, V)), 5.0);
  outgoingLight = mix(outgoingLight, uWSky * 0.95, fr * 0.85);
  outgoingLight += wGlint(iwN, V, vIW.xz, iwSlick) + wSheen(iwN, V, vIW.xz, iwSlick) * uWSky;
}
#include <opaque_fragment>`,
        );
    };
    this.material.customProgramCacheKey = () => 'inland-water-v1';
  }

  setWorld(world) {
    this.world = world;
    this.key = '';
    this.clear();
  }

  clear() {
    if (!this.mesh) return;
    this.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh = null;
  }

  /** Rebuilt when the water, its settings or the ice change (a few times a second at most). */
  update(dt, weather) {
    const w = this.world;
    if (!w) return;
    this.t += dt;
    if (this.t < 0.25 && this.mesh) return;
    this.t = 0;
    const s = waterSettings(weather ?? {});
    const vort = (w.stirrers ?? []).filter((q) => q.kind === 'vortex');
    const key = [w.geomVersion, w.ice?.version ?? -1, s.clarity, s.turbidity, s.grease, s.turbulence, vort.map((q) => q.p.join(',') + q.radius).join(';')].join('|');
    if (key === this.key) return;
    this.key = key;
    this.build(s, vort);
  }

  build(s, vort) {
    const w = this.world;
    const { nx, nz, ny, h, mat, colTop } = w;
    const water = MAT.water;
    const pos = [];
    const col = [];
    const idx = [];
    const ice = w.ice;
    let n = 0;
    for (let cz = 0; cz < nz && n < 60000; cz++)
      for (let cx = 0; cx < nx; cx++) {
        const c = cx + nx * cz;
        const y = colTop[c];
        if (y < 0 || mat[cx + nx * (y + ny * cz)] !== water) continue;
        if (ice && ice.thick[c] > 0.003) continue; // frozen: the ice is drawn (render/ice.js)
        const x0 = cx * h;
        const z0 = cz * h;
        // a whirlpool's funnel is drawn there (render/stirrers.js)
        if (vort.some((q) => Math.hypot(x0 + h / 2 - q.p[0], z0 + h / 2 - q.p[2]) < q.radius * 0.9)) continue;
        // down to the bed
        let yb = y;
        while (yb > 0 && mat[cx + nx * (yb - 1 + ny * cz)] === water) yb--;
        const depth = (y + 1 - yb) * h;
        const bed = yb > 0 ? MATERIALS[mat[cx + nx * (yb - 1 + ny * cz)]] : null;
        const floor = (bed?.color ?? [0.4, 0.35, 0.28]).map((v) => v * 0.9);
        const rgb = waterColour(depth, floor, s);
        const top = (y + 1) * h + 0.004;
        pos.push(x0, top, z0, x0 + h, top, z0, x0 + h, top, z0 + h, x0, top, z0 + h);
        for (let k = 0; k < 4; k++) col.push(rgb[0], rgb[1], rgb[2]);
        idx.push(n * 4, n * 4 + 2, n * 4 + 1, n * 4, n * 4 + 3, n * 4 + 2);
        n++;
      }
    this.clear();
    if (!n) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
    this.parent.add(this.mesh);
  }
}
