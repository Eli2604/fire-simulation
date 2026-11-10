import * as THREE from 'three';
import { MATERIALS } from '../sim/materials.js';
import { F_LIQUID, F_BURNING, F_HIDDEN } from '../sim/world.js';
import { addPatterns, PATTERN_OF_MAT, PATTERN_UNIFORMS } from './patterns.js';
import { blackbody, heatmap } from './colors.js';

/**
 * Renders the surface voxels of the world as one InstancedMesh. Geometry is
 * rebuilt when the world's geomVersion changes; colours/glow every frame.
 */
export class VoxelRenderer {
  constructor(scene) {
    this.scene = scene;
    this.mesh = null;
    this.capacity = 0;
    this.visible = new Int32Array(0);
    this.count = 0;
    this.version = -1;
    this.cut = 1; // section cut along z (0..1, 1 = no cut)
    this.mode = 'realistic';
    this.showGround = true;
    this.geometry = new THREE.BoxGeometry(1, 1, 1);
    this.material = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.0 });
    this.material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aGlow;\nvarying vec3 vGlow;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vGlow;');
      addPatterns(shader, true); // limestone blocks, ossuary walls...
    };
    this.matrix = new THREE.Matrix4();
  }

  setWorld(world) {
    this.world = world;
    this.version = -1;
  }

  ensureCapacity(n) {
    if (n <= this.capacity && this.mesh) return;
    const cap = Math.ceil(n * 1.3) + 256;
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.dispose();
    }
    const geo = this.geometry.clone();
    this.glowAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.glowAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aGlow', this.glowAttr);
    this.patAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    geo.setAttribute('aPat', this.patAttr);
    this.mesh = new THREE.InstancedMesh(geo, this.material, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.capacity = cap;
    this.visible = new Int32Array(cap);
  }

  rebuild() {
    const w = this.world;
    const { nx, ny, nz, mat, h, flags } = w;
    const nxy = nx * ny;
    const cutZ = this.cut >= 1 ? nz : Math.max(1, Math.round(this.cut * nz));
    if (w.listDirty) w.rebuildLists();
    const solids = w.solids;
    const n = w.solidCount;
    this.ensureCapacity(n);
    const vis = this.visible;
    let c = 0;
    for (let k = 0; k < n; k++) {
      const i = solids[k];
      const x = i % nx;
      const r = (i - x) / nx;
      const y = r % ny;
      const z = (r - y) / ny;
      if (z >= cutZ) continue;
      if (y === 0 && !this.showGround) continue;
      if (flags[i] & F_HIDDEN) continue; // drawn by its own mesh
      const exposed =
        z === cutZ - 1 ||
        x === 0 || x === nx - 1 || z === 0 || z === nz - 1 || y === ny - 1 ||
        !mat[i - 1] || !mat[i + 1] || !mat[i + nx] || (y > 0 && !mat[i - nx]) || !mat[i - nxy] || !mat[i + nxy];
      if (!exposed) continue;
      vis[c++] = i;
    }
    if (c > this.capacity) {
      this.ensureCapacity(c);
      return this.rebuild();
    }
    this.count = c;
    const m = this.matrix;
    const arr = this.mesh.instanceMatrix.array;
    const pat = this.patAttr.array;
    for (let k = 0; k < c; k++) {
      const i = vis[k];
      const x = i % nx;
      const r = (i - x) / nx;
      const y = r % ny;
      const z = (r - y) / ny;
      m.makeScale(h, h, h);
      m.setPosition((x + 0.5) * h, (y + 0.5) * h, (z + 0.5) * h);
      m.toArray(arr, k * 16);
      pat[k] = PATTERN_OF_MAT[mat[i]];
    }
    this.patAttr.needsUpdate = true;
    this.mesh.count = c;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.version = w.geomVersion;
  }

  update(time) {
    const w = this.world;
    if (!w) return;
    if (this.version !== w.geomVersion) this.rebuild();
    PATTERN_UNIFORMS.uPatOn.value = this.mode === 'thermal' ? 0 : 1;
    const col = this.mesh.instanceColor.array;
    const glow = this.glowAttr.array;
    const vis = this.visible;
    for (let k = 0; k < this.count; k++) shadeVoxel(w, vis[k], time, this.mode, col, glow, k * 3);
    this.mesh.instanceColor.needsUpdate = true;
    this.glowAttr.needsUpdate = true;
  }

  /** Map a raycast instance id back to a voxel index. */
  voxelOfInstance(id) {
    return id >= 0 && id < this.count ? this.visible[id] : -1;
  }
}

const tmp = [0, 0, 0];

/**
 * Colour (linear RGB) and emitted glow of voxel i, written to col/glow at offset o.
 * Shared by the voxel and the smooth surface renderers.
 */
export function shadeVoxel(w, i, time, mode, col, glow, o) {
  const { mat, temp, skin, char, flags, moist, tint, melt, waterIn, coat } = w;
  const M = MATERIALS[mat[i]];
  const T = skin[i] > temp[i] ? skin[i] : temp[i];
  if (mode === 'thermal') {
    heatmap(T, tmp);
    col[o] = tmp[0] * 0.35;
    col[o + 1] = tmp[1] * 0.35;
    col[o + 2] = tmp[2] * 0.35;
    glow[o] = tmp[0] * 0.75;
    glow[o + 1] = tmp[1] * 0.75;
    glow[o + 2] = tmp[2] * 0.75;
    return;
  }
  let r = tint[i * 3] / 255;
  let g = tint[i * 3 + 1] / 255;
  let b = tint[i * 3 + 2] / 255;
  const f = flags[i];
  if (f & F_LIQUID && M.liquidColor) {
    r = M.liquidColor[0];
    g = M.liquidColor[1];
    b = M.liquidColor[2];
  } else if (melt[i] > 0 && M.liquidColor) {
    const t = melt[i] * 0.6;
    r += (M.liquidColor[0] - r) * t;
    g += (M.liquidColor[1] - g) * t;
    b += (M.liquidColor[2] - b) * t;
  }
  // paint: intact (tint) -> yellowed/browned -> blistered and mottled -> peeled (bare wall)
  const pt = w.paint[i];
  if (pt === 1) {
    const n = 0.9 + 0.2 * ((i * 2654435761) % 1000) / 1000;
    r = M.color[0] * n;
    g = M.color[1] * n;
    b = M.color[2] * n;
  } else if (pt > 1 && pt < 250) {
    const d = 1 - pt / 255;
    r += (0.55 - r) * d * 0.8;
    g += (0.4 - g) * d * 0.8;
    b += (0.22 - b) * d * 0.8;
    if (pt < 128) {
      const m = 0.75 + 0.25 * (((i * 40503) % 997) / 997); // blisters
      r *= m;
      g *= m;
      b *= m;
    }
  }
  const ch = char[i] * 0.92;
  if (ch > 0) {
    const cc = M.charColor;
    r += (cc[0] - r) * ch;
    g += (cc[1] - g) * ch;
    b += (cc[2] - b) * ch;
  }
  // wet surfaces look darker: being rained on / sprayed, or soaked above their normal moisture
  let wet = (moist[i] - M.moisture) / (0.25 * M.maxMoisture + 0.02);
  if (waterIn[i] > 0 && wet < 0.7) wet = 0.7;
  if (wet > 0) {
    const d = 1 - 0.38 * Math.min(1, wet);
    r *= d;
    g *= d;
    b *= d;
  }
  // foam / powder blanket
  const ct = coat[i];
  if (ct > 0.02) {
    const c = Math.min(1, ct) * 0.85;
    r += (0.95 - r) * c;
    g += (0.95 - g) * c;
    b += (0.92 - b) * c;
  }
  col[o] = r * r; // tint is sRGB-ish, convert to linear
  col[o + 1] = g * g;
  col[o + 2] = b * b;
  blackbody(T, tmp);
  let gl = 1;
  if (f & F_BURNING) gl = 1.15 + 0.25 * Math.sin(time * 13 + i * 0.37);
  glow[o] = tmp[0] * gl;
  glow[o + 1] = tmp[1] * gl;
  glow[o + 2] = tmp[2] * gl;
}
