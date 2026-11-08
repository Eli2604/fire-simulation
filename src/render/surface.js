import * as THREE from 'three';
import { shadeVoxel } from './voxels.js';

const C = 16; // chunk size in voxels

/**
 * Smooth surface rendering of the voxel world (naive surface nets).
 *
 * The voxel centres are samples (solid / empty). Every 2x2x2 block of
 * samples that is partly solid gets one vertex, placed at the average of
 * the edge crossings, and every sample edge that crosses the surface becomes
 * a quad. The result is a closed, smooth-ish mesh that follows the burning,
 * melting and collapsing objects. The mesh is built per 16³ chunk, and only
 * chunks whose occupancy changed are rebuilt. Colours and glow come from the
 * same per-voxel shading as the voxel view, averaged over the solid voxels
 * around each vertex, so char, wetness, foam, incandescence and the thermal
 * view all carry over.
 */
export class SurfaceRenderer {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
    this.material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aGlow;\nvarying vec3 vGlow;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vGlow;');
    };
    this.mode = 'realistic';
    this.cut = 1;
    this.showGround = true;
    this.visible = false;
    this.lastMesh = -1;
    this.lastShade = -1;
  }

  setWorld(world) {
    this.world = world;
    for (const ch of this.chunks ?? []) this.disposeChunk(ch);
    const cx = Math.ceil(world.nx / C);
    const cy = Math.ceil(world.ny / C);
    const cz = Math.ceil(world.nz / C);
    this.cdim = [cx, cy, cz];
    this.chunks = [];
    for (let z = 0; z < cz; z++) for (let y = 0; y < cy; y++) for (let x = 0; x < cx; x++) this.chunks.push({ x, y, z, hash: -1, mesh: null, corners: null });
    this.cache = new Int32Array((C + 1) ** 3);
    this.slot = new Int32Array(world.N);
    this.version = -1;
    this.forceAll = true;
    this.staged = [];
    this.pending = false;
  }

  setVisible(v) {
    this.visible = v;
    this.group.visible = v;
    if (v) this.forceAll = true;
  }

  invalidate() {
    this.forceAll = true;
  }

  disposeChunk(ch) {
    if (ch.mesh) {
      this.group.remove(ch.mesh);
      ch.mesh.geometry.dispose();
      ch.mesh = null;
    }
  }

  /** Is the sample at voxel (x,y,z) solid? */
  solid(x, y, z) {
    const w = this.world;
    if (y < 0) return 1; // closed underneath
    if (x < 0 || z < 0 || x >= w.nx || z >= w.nz || y >= w.ny) return 0;
    if (z >= this.cutZ) return 0;
    if (y === 0 && !this.showGround) return 0;
    return w.mat[x + w.nx * (y + w.ny * z)] ? 1 : 0;
  }

  update(time) {
    const w = this.world;
    if (!w || !this.visible) return;
    const now = performance.now();
    this.cutZ = this.cut >= 1 ? w.nz : Math.max(1, Math.round(this.cut * w.nz));
    // re-mesh changed chunks a few times per second at most
    this.time = time;
    if (this.forceAll || this.pending || (this.version !== w.geomVersion && now - this.lastMesh > 250)) {
      this.remesh();
      this.version = w.geomVersion;
      this.lastMesh = now;
      this.forceAll = false;
    }
    if (now - this.lastShade > 60) {
      this.shade(time);
      this.lastShade = now;
    }
  }

  /** Rebuild changed chunks; spread over frames (time budget) unless everything must be redone. */
  remesh() {
    const t0 = performance.now();
    const n = this.chunks.length;
    this.cursor ??= 0;
    for (let k = 0; k < n; k++) {
      const ch = this.chunks[(this.cursor + k) % n];
      const hash = this.chunkHash(ch);
      if (!this.forceAll && hash === ch.hash) continue;
      ch.hash = hash;
      this.buildChunk(ch);
      if (!this.staged.includes(ch)) this.staged.push(ch);
      if (!this.forceAll && performance.now() - t0 > 8) {
        this.cursor = (this.cursor + k + 1) % n;
        this.pending = true; // continue next frame
        return;
      }
    }
    this.pending = false;
    // Swap all rebuilt chunks in at once (no cracks between old and new
    // neighbours) and colour them before they are ever drawn (no black flashes).
    for (const ch of this.staged) {
      this.disposeChunk(ch);
      ch.mesh = ch.next;
      ch.corners = ch.nextCorners;
      ch.next = null;
      if (ch.mesh) this.group.add(ch.mesh);
    }
    if (this.staged.length) {
      this.shade(this.time ?? 0);
      this.lastShade = performance.now();
    }
    this.staged.length = 0;
  }

  /** Occupancy hash of the samples a chunk's mesh depends on. */
  chunkHash(ch) {
    const w = this.world;
    const x0 = ch.x * C - 1;
    const y0 = ch.y * C - 1;
    const z0 = ch.z * C - 1;
    let hsh = 2166136261 ^ this.cutZ;
    for (let z = z0; z <= z0 + C + 1; z++)
      for (let y = y0; y <= y0 + C + 1; y++)
        for (let x = x0; x <= x0 + C + 1; x++) {
          hsh = Math.imul(hsh ^ this.solid(x, y, z), 16777619);
        }
    return hsh >>> 0;
  }

  buildChunk(ch) {
    if (ch.next) ch.next.geometry.dispose(); // rebuilt again before it was swapped in
    const w = this.world;
    const h = w.h;
    const x0 = ch.x * C;
    const y0 = ch.y * C;
    const z0 = ch.z * C;
    const x1 = Math.min(x0 + C, w.nx);
    const y1 = Math.min(y0 + C, w.ny);
    const z1 = Math.min(z0 + C, w.nz);
    const cache = this.cache.fill(-1);
    const S = C + 1;
    const pos = [];
    const corners = []; // cube base (sample) per vertex, for colouring
    const idx = [];
    const vert = (cx, cy, cz) => {
      // cube cx..cx+1, cached within [x0-1, x0+C-1]
      const key = cx - x0 + 1 + S * (cy - y0 + 1 + S * (cz - z0 + 1));
      const c = cache[key];
      if (c !== -1) return c;
      let mask = 0;
      for (let k = 0; k < 8; k++) if (this.solid(cx + (k & 1), cy + ((k >> 1) & 1), cz + ((k >> 2) & 1))) mask |= 1 << k;
      if (mask === 0 || mask === 255) {
        cache[key] = -2;
        return -2;
      }
      // average of the edge crossings
      let ax = 0;
      let ay = 0;
      let az = 0;
      let n = 0;
      for (let k = 0; k < 8; k++)
        for (let b = 0; b < 3; b++) {
          const j = k | (1 << b);
          if (j === k) continue;
          if (((mask >> k) & 1) !== ((mask >> j) & 1)) {
            ax += ((k & 1) + (j & 1)) / 2;
            ay += (((k >> 1) & 1) + ((j >> 1) & 1)) / 2;
            az += (((k >> 2) & 1) + ((j >> 2) & 1)) / 2;
            n++;
          }
        }
      const id = pos.length / 3;
      pos.push((cx + 0.5 + ax / n) * h, (cy + 0.5 + ay / n) * h, (cz + 0.5 + az / n) * h);
      corners.push(cx, cy, cz);
      cache[key] = id;
      return id;
    };
    const quad = (a, b, c, d, flip) => {
      if (a < 0 || b < 0 || c < 0 || d < 0) return;
      if (flip) idx.push(a, c, b, a, d, c);
      else idx.push(a, b, c, a, c, d);
    };
    for (let z = z0; z < z1; z++)
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const s = this.solid(x, y, z);
          // edge +x
          if (s !== this.solid(x + 1, y, z)) quad(vert(x, y - 1, z - 1), vert(x, y, z - 1), vert(x, y, z), vert(x, y - 1, z), !s);
          // edge +y
          if (s !== this.solid(x, y + 1, z)) quad(vert(x - 1, y, z - 1), vert(x - 1, y, z), vert(x, y, z), vert(x, y, z - 1), !s);
          // edge +z
          if (s !== this.solid(x, y, z + 1)) quad(vert(x - 1, y - 1, z), vert(x, y - 1, z), vert(x, y, z), vert(x - 1, y, z), !s);
        }
    if (!idx.length) {
      ch.next = null;
      ch.nextCorners = null;
      return;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const nv = pos.length / 3;
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    ch.next = mesh; // swapped in by remesh() once the whole pass is done
    ch.nextCorners = Int32Array.from(corners);
  }

  /** Colour every vertex from the solid voxels around it. */
  shade(time) {
    const w = this.world;
    const n = w.solidCount;
    if (!this.colBuf || this.colBuf.length < n * 3) {
      this.colBuf = new Float32Array(Math.ceil(n * 1.3) * 3 + 300);
      this.glowBuf = new Float32Array(this.colBuf.length);
    }
    const { colBuf, glowBuf, slot } = this;
    for (let k = 0; k < n; k++) {
      const i = w.solids[k];
      slot[i] = k;
      shadeVoxel(w, i, time, this.mode, colBuf, glowBuf, k * 3);
    }
    const { nx, ny, nz, mat } = w;
    for (const ch of this.chunks) {
      if (!ch.mesh) continue;
      const col = ch.mesh.geometry.attributes.color.array;
      const glow = ch.mesh.geometry.attributes.aGlow.array;
      const cr = ch.corners;
      for (let v = 0; v < cr.length / 3; v++) {
        const cx = cr[v * 3];
        const cy = cr[v * 3 + 1];
        const cz = cr[v * 3 + 2];
        let r = 0;
        let g = 0;
        let b = 0;
        let gr = 0;
        let gg = 0;
        let gb = 0;
        let cnt = 0;
        for (let k = 0; k < 8; k++) {
          const x = cx + (k & 1);
          const y = cy + ((k >> 1) & 1);
          const z = cz + ((k >> 2) & 1);
          if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) continue;
          const i = x + nx * (y + ny * z);
          if (!mat[i]) continue;
          const o = slot[i] * 3;
          r += colBuf[o];
          g += colBuf[o + 1];
          b += colBuf[o + 2];
          gr += glowBuf[o];
          gg += glowBuf[o + 1];
          gb += glowBuf[o + 2];
          cnt++;
        }
        if (!cnt) continue;
        const o = v * 3;
        col[o] = r / cnt;
        col[o + 1] = g / cnt;
        col[o + 2] = b / cnt;
        glow[o] = gr / cnt;
        glow[o + 1] = gg / cnt;
        glow[o + 2] = gb / cnt;
      }
      ch.mesh.geometry.attributes.color.needsUpdate = true;
      ch.mesh.geometry.attributes.aGlow.needsUpdate = true;
    }
  }

  /** Raycast the smooth surface; returns the voxel behind the hit. */
  pick(raycaster) {
    const meshes = this.chunks.filter((c) => c.mesh).map((c) => c.mesh);
    const hits = raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;
    const hit = hits[0];
    const w = this.world;
    const p = hit.point;
    const nrm = hit.face ? hit.face.normal : new THREE.Vector3(0, 1, 0);
    // the voxel just inside the surface (or the nearest solid one around it)
    let best = -1;
    let bestD = Infinity;
    const bx = p.x - nrm.x * w.h * 0.5;
    const by = p.y - nrm.y * w.h * 0.5;
    const bz = p.z - nrm.z * w.h * 0.5;
    for (let dz = -1; dz <= 1; dz++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const i = w.voxelAt(bx + dx * w.h, by + dy * w.h, bz + dz * w.h);
          if (i < 0 || !w.mat[i]) continue;
          const c = w.center(...w.coords(i));
          const d = (c[0] - bx) ** 2 + (c[1] - by) ** 2 + (c[2] - bz) ** 2;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
    return { voxel: best, point: [p.x, p.y, p.z], normal: [nrm.x, nrm.y, nrm.z] };
  }
}
