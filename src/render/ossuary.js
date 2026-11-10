import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MATERIALS } from '../sim/materials.js';

/**
 * Ossuary walls built of bones, laid out as in the catacombs of Paris: the
 * facade of each wall is long bones (femurs, tibias, humeri) stacked end-on, their
 * knobbly heads facing out, crossed by horizontal bands of skulls, and crowned at
 * the top with a row of skulls; set into the bone face are crosses and hearts of
 * skulls, and engraved stone tablets. Behind the facade (on top of the wall) lie
 * loose bones. All of it is real geometry, lit by the torches and the lamp.
 *
 * The layout is computed per wall column from its floor and its top, so the bands
 * sit at the same heights along a wall and the crown follows its top; each skull
 * and bone belongs to the voxel whose face it sits on. Blast a wall and the bones
 * with the voxels are gone; char it and they blacken. The voxels themselves are
 * the dark mass behind (the gaps between the bones).
 *
 * Cost: instanced meshes in 4 m chunks; chunks out of view or further than
 * DRAW_DIST are not drawn, and a chunk is only rebuilt when its voxels change.
 */
const CHUNK = 4; // m
const DRAW_DIST = 14; // m (the torches light ~9 m; the lamp further, but only where you look)
const SKULL = 0.165; // m between skulls in a row
const BONE_X = 0.068; // m between bone ends in a row
const BONE_Y = 0.064; // m between rows of bone ends
const BANDS = [0.56, 1.12]; // heights (above the floor) of the skull bands
const MOTIF = 3.2; // m between the crosses / hearts on a wall

function hash(a, b, c) {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A skull, about 1 unit in radius, face towards +z; vertex colours darken the cavities. */
function skullGeometry() {
  const g = new THREE.SphereGeometry(1, 16, 12);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  const gauss = (d, c, s) => Math.exp(-((d.x - c[0]) ** 2 + (d.y - c[1]) ** 2 + (d.z - c[2]) ** 2) / (s * s));
  const v = new THREE.Vector3();
  for (let k = 0; k < p.count; k++) {
    const d = v.fromBufferAttribute(p, k).clone();
    let sx = 0.78;
    let sy = 0.9;
    let sz = 1.0;
    if (d.y < -0.1) sx *= 1 - 0.38 * Math.min(1, (-d.y - 0.1) / 0.8); // the face narrows to the jaw
    if (d.z > 0.4 && d.y < 0.25) sz *= 0.9;
    const s = Math.max(gauss(d, [-0.36, 0, 0.93], 0.27), gauss(d, [0.36, 0, 0.93], 0.27)); // eye sockets
    const n = gauss(d, [0, -0.36, 0.93], 0.17) * (d.y < -0.2 ? 1 : 0.5); // nose cavity
    const brow = gauss(d, [0, 0.3, 0.92], 0.35) * 0.06;
    const cheek = Math.max(gauss(d, [-0.62, -0.25, 0.7], 0.22), gauss(d, [0.62, -0.25, 0.7], 0.22)) * 0.05;
    const teeth = gauss(d, [0, -0.72, 0.68], 0.25) * 0.05;
    const temple = Math.max(gauss(d, [-0.9, 0.05, 0.3], 0.3), gauss(d, [0.9, 0.05, 0.3], 0.3)) * 0.06;
    const r = 1 - 0.42 * s - 0.35 * n + brow + cheek + teeth - temple;
    p.setXYZ(k, d.x * sx * r, d.y * sy * r, d.z * sz * r);
    const ao = 1 - 0.85 * Math.min(1, s * 1.4 + n * 1.3) - 0.15 * gauss(d, [0, -0.45, 0.6], 0.5);
    col[k * 3] = ao;
    col[k * 3 + 1] = ao * 0.97;
    col[k * 3 + 2] = ao * 0.9;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function withAO(g, f) {
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let k = 0; k < p.count; k++) {
    const ao = f(p.getX(k), p.getY(k), p.getZ(k));
    col[k * 3] = ao;
    col[k * 3 + 1] = ao * 0.97;
    col[k * 3 + 2] = ao * 0.9;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function merged(parts) {
  for (const q of parts) q.deleteAttribute('uv');
  return mergeGeometries(parts.map((q) => q.toNonIndexed()));
}

/** The end of a long bone stacked end-on (the shaft goes into the wall, along -z). */
function boneEndGeometry(condyles) {
  const parts = [];
  const shaft = new THREE.CylinderGeometry(0.55, 0.6, 1.6, 6, 1, true);
  shaft.rotateX(Math.PI / 2);
  shaft.translate(0, 0, -0.75);
  parts.push(shaft);
  if (condyles) {
    for (const s of [-1, 1]) {
      const k = new THREE.SphereGeometry(0.62, 7, 5);
      k.scale(1, 1.1, 0.85);
      k.translate(s * 0.45, 0, 0.08);
      parts.push(k);
    }
  } else {
    const k = new THREE.SphereGeometry(0.85, 8, 6);
    k.scale(1, 1, 0.8);
    k.translate(0, 0, 0.05);
    parts.push(k);
  }
  return withAO(merged(parts), (x, y, z) => Math.max(0.15, Math.min(1, 0.85 + z * 0.6)));
}

/** A whole long bone lying down (along x): shaft with a head at one end, condyles at the other. */
function longBoneGeometry() {
  const shaft = new THREE.CylinderGeometry(0.5, 0.55, 14, 8, 1, true);
  shaft.rotateZ(Math.PI / 2);
  const head = new THREE.SphereGeometry(0.85, 10, 8);
  head.translate(7.2, 0, 0);
  const parts = [shaft, head];
  for (const s of [-1, 1]) {
    const k = new THREE.SphereGeometry(0.6, 9, 7);
    k.translate(-7.1, 0, s * 0.45);
    parts.push(k);
  }
  return withAO(merged(parts), (x, y) => Math.max(0.35, Math.min(1, 0.8 + y * 0.25)));
}

/** The skulls of the motif (a cross or a heart) centred at u, at height yc above the floor. */
function motifSkulls(kind, u, yc) {
  const out = [];
  if (kind === 0) {
    // a cross: upright of five skulls, arms of one each side, a little above the middle
    for (let k = -2; k <= 2; k++) out.push([u, yc + k * SKULL]);
    for (const s of [-1, 1]) out.push([u + s * SKULL, yc + SKULL * 0.9]);
  } else {
    // a heart
    for (let k = 0; k < 12; k++) {
      const t = (k / 12) * Math.PI * 2;
      const x = 16 * Math.sin(t) ** 3;
      const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      out.push([u + x * 0.016, yc + y * 0.016]);
    }
  }
  return out;
}

export class OssuaryRenderer {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.chunks = new Map();
    this.plaques = [];
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0 });
    this.geo = null;
    this.lastScan = -1e9;
    this.version = -1;
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
  }

  setWorld(world) {
    for (const ch of this.chunks.values()) this.disposeChunk(ch);
    this.chunks.clear();
    for (const p of this.plaques) this.group.remove(p);
    this.plaques = [];
    this.world = world;
    this.version = -1;
    this.lastScan = -1e9;
    this.ids = MATERIALS.map((m) => !!m.bones);
    this.buildPlaques();
  }

  disposeChunk(ch) {
    for (const m of ch.meshes) {
      this.group.remove(m);
      m.dispose();
    }
  }

  // ------------------------------------------------------------------ tablets
  buildPlaques() {
    const w = this.world;
    if (!w.plaques?.length || typeof document === 'undefined' || typeof document.createElement('canvas').getContext !== 'function') return;
    for (const pq of w.plaques) {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = Math.round((512 * pq.h) / pq.w);
      const ctx = c.getContext('2d');
      // white limestone, a carved border, black-filled engraved capitals
      const g = ctx.createLinearGradient(0, 0, c.width, c.height);
      g.addColorStop(0, '#e4ddcc');
      g.addColorStop(1, '#cfc6b2');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, c.width, c.height);
      for (let k = 0; k < 900; k++) {
        ctx.fillStyle = `rgba(90,80,60,${Math.random() * 0.12})`;
        ctx.fillRect(Math.random() * c.width, Math.random() * c.height, 2, 2);
      }
      ctx.strokeStyle = 'rgba(70,62,50,0.8)';
      ctx.lineWidth = 6;
      ctx.strokeRect(18, 18, c.width - 36, c.height - 36);
      ctx.lineWidth = 2;
      ctx.strokeRect(30, 30, c.width - 60, c.height - 60);
      const lines = pq.text.split('|');
      const size = Math.min(54, (c.height - 90) / lines.length);
      ctx.font = `600 ${size}px "Times New Roman", Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      lines.forEach((t, k) => {
        const y = c.height / 2 + (k - (lines.length - 1) / 2) * size * 1.15;
        ctx.fillStyle = 'rgba(255,250,235,0.6)';
        ctx.fillText(t, c.width / 2 + 1.5, y + 1.5);
        ctx.fillStyle = '#1b1712';
        ctx.fillText(t, c.width / 2, y);
      });
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const stone = new THREE.MeshStandardMaterial({ color: 0xc9c0ac, roughness: 0.9 });
      const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
      // a slab: the engraved face towards +z
      const slab = new THREE.Mesh(new THREE.BoxGeometry(pq.w, pq.h, 0.05), [stone, stone, stone, stone, face, stone]);
      // on the wall's actual surface: out from inside the wall until the air
      let d = -0.3;
      while (d < 0.4) {
        const i = w.voxelAt(pq.p[0] + pq.n[0] * d, pq.p[1], pq.p[2] + pq.n[2] * d);
        if (i < 0 || !w.mat[i]) break;
        d += 0.02;
      }
      slab.position.set(pq.p[0] + pq.n[0] * (d + 0.02), pq.p[1], pq.p[2] + pq.n[2] * (d + 0.02));
      slab.rotation.y = Math.atan2(pq.n[0], pq.n[2]);
      slab.castShadow = true;
      slab.receiveShadow = true;
      this.group.add(slab);
      this.plaques.push(slab);
    }
  }

  /** Is (u, y) on a wall plane covered by a tablet? (No bones there.) */
  underPlaque(axis, plane, u, y) {
    for (const pq of this.world.plaques ?? []) {
      const pAxis = Math.abs(pq.n[0]) > 0.5 ? 0 : 2;
      if (pAxis !== axis) continue;
      const pPlane = axis === 0 ? pq.p[0] : pq.p[2];
      if (Math.abs(pPlane - plane) > 0.15) continue;
      const pu = axis === 0 ? pq.p[2] : pq.p[0];
      if (Math.abs(u - pu) < pq.w / 2 + 0.03 && Math.abs(y - pq.p[1]) < pq.h / 2 + 0.03) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ layout
  /** Every face of a bone wall that faces the air, by chunk; and each wall column's floor and top. */
  scan() {
    const w = this.world;
    const { nx, ny, nz, mat, solids } = w;
    const byChunk = new Map();
    const cols = new Map(); // "axis,sign,plane,u" -> [ymin, ymax] (voxel rows)
    const h = w.h;
    for (let k = 0; k < w.solidCount; k++) {
      const i = solids[k];
      if (!this.ids[mat[i]]) continue;
      const x = i % nx;
      const r = (i - x) / nx;
      const y = r % ny;
      const z = (r - y) / ny;
      // only faces towards a covered space (a passage, a chamber): not the backs of the walls,
      // which face the empty rock between the passages
      const inside = (j, xx, zz) => !mat[j] && w.colTop[xx + nx * zz] > y;
      const faces = [];
      if (x + 1 < nx && inside(i + 1, x + 1, z)) faces.push(0, 1);
      if (x > 0 && inside(i - 1, x - 1, z)) faces.push(0, -1);
      if (z + 1 < nz && inside(i + nx * ny, x, z + 1)) faces.push(2, 1);
      if (z > 0 && inside(i - nx * ny, x, z - 1)) faces.push(2, -1);
      if (y + 1 < ny && !mat[i + nx]) faces.push(1, 1); // top of the wall
      if (!faces.length) continue;
      const key = Math.floor((x * h) / CHUNK) + ',' + Math.floor((z * h) / CHUNK);
      let list = byChunk.get(key);
      if (!list) byChunk.set(key, (list = []));
      for (let f = 0; f < faces.length; f += 2) {
        list.push(i, faces[f], faces[f + 1]);
        if (faces[f] === 1) continue;
        const ck = faces[f] + ',' + faces[f + 1] + ',' + (faces[f] === 0 ? x : z) + ',' + (faces[f] === 0 ? z : x);
        const c = cols.get(ck);
        if (!c) cols.set(ck, [y, y]);
        else {
          if (y < c[0]) c[0] = y;
          if (y > c[1]) c[1] = y;
        }
      }
    }
    this.cols = cols;
    return byChunk;
  }

  /** The skulls and bones on one voxel face: [kind, u, y, rand] (0 skull, 1 ball bone, 2 condyles, 3 lying bone). */
  features(w, i, axis, sign, out) {
    const h = w.h;
    const [x, y, z] = w.coords(i);
    if (axis === 1) {
      // on top of the wall: loose long bones lying every which way
      for (let k = 0; k < 2; k++) {
        const r = hash(i, k, 91);
        out.push(3, x * h + h * (0.2 + 0.6 * hash(i, k, 3)), (y + 1) * h, r, z * h + h * (0.2 + 0.6 * hash(i, k, 5)));
      }
      return;
    }
    const col = this.cols.get(axis + ',' + sign + ',' + (axis === 0 ? x : z) + ',' + (axis === 0 ? z : x));
    const floor = col[0] * h;
    const top = (col[1] + 1) * h;
    const height = top - floor;
    const u0 = (axis === 0 ? z : x) * h;
    const u1 = u0 + h;
    const y0 = y * h;
    const y1 = y0 + h;
    const vx = axis === 0 ? x + (sign > 0 ? 1 : 0) : z + (sign > 0 ? 1 : 0); // the wall plane (voxel lines)
    const plane = vx * h;
    const off = hash(vx, axis, sign + 7) * 3; // each wall its own phase
    const inFace = (u, yy) => u >= u0 && u < u1 && yy >= y0 && yy < y1;
    // the motifs on this wall near this face: crosses and hearts in turn
    const motif = [];
    if (height > 1.0)
      for (let j = Math.floor((u0 + off) / MOTIF) - 1; j <= Math.floor((u1 + off) / MOTIF) + 1; j++) {
        const uc = (j + 0.5) * MOTIF - off;
        const kind = ((j % 2) + 2) % 2;
        for (const pt of motifSkulls(kind, uc, floor + Math.min(0.85, height * 0.5))) motif.push(pt);
      }
    const nearMotif = (u, yy, d) => motif.some(([mu, my]) => Math.abs(mu - u) < d && Math.abs(my - yy) < d * 1.15);
    const free = (u, yy) => !this.underPlaque(axis, plane, u, yy);
    for (const [mu, my] of motif) if (inFace(mu, my) && free(mu, my)) out.push(0, mu, my, hash(Math.round(mu * 100), Math.round(my * 100), 17));
    // the crown: a row of skulls along the top
    const crownY = top - 0.095;
    const bandYs = BANDS.map((b) => floor + b).filter((b) => b < top - 0.3);
    for (const ys of [...bandYs, crownY]) {
      if (ys < y0 - 0.1 || ys >= y1 + 0.1 || ys < y0 || ys >= y1) continue;
      for (let j = Math.floor((u0 + off) / SKULL) - 1; j <= Math.ceil((u1 + off) / SKULL); j++) {
        const r = hash(j, Math.round(ys * 50), vx * 3 + axis);
        const u = (j + 0.5) * SKULL - off + (r - 0.5) * 0.015;
        if (!inFace(u, ys) || r < 0.03 || nearMotif(u, ys, 0.13) || !free(u, ys)) continue;
        out.push(0, u, ys + (hash(j, 3, vx) - 0.5) * 0.012, r);
      }
    }
    // the rest: long-bone ends, row upon row, staggered
    const r0 = Math.floor((y0 - floor) / BONE_Y) - 1;
    for (let row = r0; row <= r0 + 4; row++) {
      const yb = floor + 0.035 + row * BONE_Y;
      if (yb < y0 || yb >= y1 || yb > top - 0.2) continue;
      if (bandYs.some((b) => Math.abs(b - yb) < 0.1)) continue;
      const stagger = (((row % 2) + 2) % 2) * BONE_X * 0.5;
      for (let j = Math.floor((u0 + off - stagger) / BONE_X) - 1; j <= Math.ceil((u1 + off) / BONE_X); j++) {
        const r = hash(j, row, vx * 5 + axis);
        const u = j * BONE_X + stagger - off + (r - 0.5) * 0.01;
        if (!inFace(u, yb) || nearMotif(u, yb, 0.1) || !free(u, yb)) continue;
        out.push(r < 0.4 ? 2 : 1, u, yb + (hash(j, row, 9) - 0.5) * 0.01, r);
      }
    }
  }

  buildChunk(list) {
    const w = this.world;
    this.geo ??= [skullGeometry(), boneEndGeometry(false), boneEndGeometry(true), longBoneGeometry()];
    const feats = [];
    const tmp = [];
    for (let k = 0; k < list.length; k += 3) {
      tmp.length = 0;
      this.features(w, list[k], list[k + 1], list[k + 2], tmp);
      const axis = list[k + 1];
      const stride = axis === 1 ? 5 : 4;
      for (let f = 0; f < tmp.length; f += stride) feats.push(tmp[f], tmp[f + 1], tmp[f + 2], tmp[f + 3], axis, list[k + 2], list[k], axis === 1 ? tmp[f + 4] : 0);
    }
    const counts = [0, 0, 0, 0];
    for (let f = 0; f < feats.length; f += 8) counts[feats[f]]++;
    const meshes = counts.map((c, kind) => {
      const m = new THREE.InstancedMesh(this.geo[kind], this.material, Math.max(1, c));
      m.count = 0;
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, c) * 3), 3);
      m.castShadow = true;
      m.receiveShadow = true;
      m.userData.voxels = new Int32Array(Math.max(1, c));
      m.userData.tone = new Float32Array(Math.max(1, c));
      return m;
    });
    const h = w.h;
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    for (let f = 0; f < feats.length; f += 8) {
      const kind = feats[f];
      const u = feats[f + 1];
      const y = feats[f + 2];
      const r = feats[f + 3];
      const axis = feats[f + 4];
      const sign = feats[f + 5];
      const i = feats[f + 6];
      if (kind === 3) {
        // lying on top: random direction, a little tilted
        this.e.set((r - 0.5) * 0.3, r * 6.28, (hash(i, 7, 7) - 0.5) * 0.2, 'YXZ');
        const sc = 0.022 * (0.8 + r * 0.4);
        scl.set(sc, sc, sc);
        pos.set(u, y + sc * 0.6, feats[f + 7]);
      } else {
        const [vx, , vz] = w.coords(i);
        const plane = (axis === 0 ? vx : vz) * h + (sign > 0 ? h : 0);
        const yaw = axis === 0 ? (sign > 0 ? Math.PI / 2 : -Math.PI / 2) : sign > 0 ? 0 : Math.PI;
        let out;
        if (kind === 0) {
          this.e.set((r - 0.5) * 0.22, yaw + (hash(i, Math.round(u * 97), 2) - 0.5) * 0.45, (hash(i, 3, 4) - 0.5) * 0.25, 'YXZ');
          const k = 0.92 + r * 0.16;
          scl.set(0.072 * k, 0.085 * k, 0.09 * k);
          out = 0.022;
        } else {
          this.e.set((r - 0.5) * 0.18, yaw + (hash(i, 5, Math.round(u * 89)) - 0.5) * 0.22, r * 6.28, 'YXZ');
          const sc = 0.025 * (0.8 + r * 0.45);
          scl.set(sc, sc, sc);
          out = 0.004;
        }
        if (axis === 0) pos.set(plane + sign * out, y, u);
        else pos.set(u, y, plane + sign * out);
      }
      this.q.setFromEuler(this.e);
      this.m.compose(pos, this.q, scl);
      const mesh = meshes[kind];
      const n = mesh.count++;
      mesh.setMatrixAt(n, this.m);
      mesh.userData.voxels[n] = i;
      mesh.userData.tone[n] = 0.7 + 0.32 * hash(i, kind, Math.floor(u * 100));
    }
    for (const m of meshes) {
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
      this.group.add(m);
    }
    const ch = { meshes, signature: list.length + ':' + list[0] + ':' + list[list.length - 3] };
    const bs = meshes.find((m) => m.count)?.boundingSphere;
    ch.centre = bs ? bs.center.clone() : new THREE.Vector3();
    this.shade(ch);
    return ch;
  }

  /** Bone colour, darkened where the wall is charred, sooted or wet. */
  shade(ch) {
    const w = this.world;
    for (const m of ch.meshes) {
      const vox = m.userData.voxels;
      const tone = m.userData.tone;
      const arr = m.instanceColor.array;
      for (let k = 0; k < m.count; k++) {
        const t = tone[k] * (1 - 0.85 * w.char[vox[k]]);
        arr[k * 3] = 0.8 * t;
        arr[k * 3 + 1] = 0.72 * t;
        arr[k * 3 + 2] = 0.58 * t;
      }
      m.instanceColor.needsUpdate = true;
    }
  }

  update(time, cameraLocal) {
    const w = this.world;
    if (!w) return;
    // rescan at most once a second, and only when something in the world changed
    if (w.geomVersion !== this.version && time - this.lastScan > 1) {
      this.version = w.geomVersion;
      this.lastScan = time;
      const byChunk = this.scan();
      for (const [key, ch] of this.chunks)
        if (!byChunk.has(key)) {
          this.disposeChunk(ch);
          this.chunks.delete(key);
        }
      for (const [key, list] of byChunk) {
        const old = this.chunks.get(key);
        const sig = list.length + ':' + list[0] + ':' + list[list.length - 3];
        if (old && old.signature === sig) continue;
        if (old) this.disposeChunk(old);
        this.chunks.set(key, this.buildChunk(list));
      }
    }
    // only the chunks near you are drawn; their colours follow the walls' charring
    const shadeNow = Math.floor(time * 2) !== this.lastShade;
    this.lastShade = Math.floor(time * 2);
    for (const ch of this.chunks.values()) {
      const near = !cameraLocal || ch.centre.distanceTo(cameraLocal) < DRAW_DIST;
      for (const m of ch.meshes) m.visible = near && m.count > 0;
      if (near && shadeNow) this.shade(ch);
    }
    for (const p of this.plaques) p.visible = !cameraLocal || p.position.distanceTo(cameraLocal) < DRAW_DIST;
  }
}
