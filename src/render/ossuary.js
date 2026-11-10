import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MATERIALS } from '../sim/materials.js';

/**
 * Ossuary walls built of bones, as in the catacombs of Paris: the facade of each
 * wall is long bones stacked end-on, so tightly that only their ends show (ball
 * heads, double knuckles, broken shafts, knobbly ends, every size, each a little
 * in or out, tilted, brown with age and grime), crossed by bands of skulls and
 * crowned at the top with a row of skulls (many turned so the back of the cranium
 * shows), with loose bones heaped on top. Round pillars of bones ("tonneaux")
 * are laid the same way on a curve. Here and there a cross or a heart of skulls
 * and engraved tablets, some on a white-washed pedestal. All real geometry, lit
 * by the torches and the lamp.
 *
 * The layout is computed per wall column from its floor and its top, so the bands
 * run at one height along a wall; each bone belongs to the voxel whose face it
 * sits on: blast a wall and its bones are gone, char it and they blacken. The
 * voxels are the dark mass behind (the gaps).
 *
 * Cost: instanced meshes in 4 m chunks; chunks out of view or further than
 * DRAW_DIST are not drawn, and a chunk is only rebuilt when its voxels change.
 */
const CHUNK = 4; // m
const DRAW_DIST = 14; // m (the torches light ~9 m; the lamp further, but only where you look)
const SKULL = 0.15; // m between skulls in a band (they touch)
const BONE_X = 0.05; // m between bone ends in a row
const BONE_Y = 0.046; // m between rows of bone ends
const MOTIF = 6.4; // m between the crosses / hearts on a wall
// kinds of instance
const K_SKULL = 0;
const K_BALL = 1;
const K_KNUCKLE = 2;
const K_LYING = 3;
const K_BROKEN = 4;
const K_KNOB = 5;
const KINDS = 6;

function hash(a, b, c) {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Push every vertex in or out a little (old bone is not smooth). */
function rough(g, amount, seed) {
  const p = g.attributes.position;
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k);
    const y = p.getY(k);
    const z = p.getZ(k);
    const n = Math.sin(x * 7.1 + seed) * Math.sin(y * 6.3 - seed) * Math.sin(z * 5.7 + seed * 2) + 0.5 * Math.sin(x * 15 + y * 13 + z * 11 + seed);
    const s = 1 + n * amount;
    p.setXYZ(k, x * s, y * s, z * s);
  }
  return g;
}

/** A skull, about 1 unit in radius, face towards +z; vertex colours darken the cavities. */
function skullGeometry() {
  const g = new THREE.SphereGeometry(1, 18, 14);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  const gauss = (d, c, s) => Math.exp(-((d.x - c[0]) ** 2 + (d.y - c[1]) ** 2 + (d.z - c[2]) ** 2) / (s * s));
  const v = new THREE.Vector3();
  for (let k = 0; k < p.count; k++) {
    const d = v.fromBufferAttribute(p, k).clone();
    let sx = 0.8;
    let sy = 0.86;
    let sz = 1.02;
    if (d.y < -0.1) sx *= 1 - 0.38 * Math.min(1, (-d.y - 0.1) / 0.8); // the face narrows to the jaw
    if (d.z > 0.4 && d.y < 0.25) sz *= 0.88;
    if (d.z < -0.3) sz *= 1.05; // the occiput bulges at the back
    const s = Math.max(gauss(d, [-0.36, 0, 0.93], 0.27), gauss(d, [0.36, 0, 0.93], 0.27)); // eye sockets
    const n = gauss(d, [0, -0.36, 0.93], 0.17) * (d.y < -0.2 ? 1 : 0.5); // nose cavity
    const brow = gauss(d, [0, 0.3, 0.92], 0.35) * 0.06;
    const cheek = Math.max(gauss(d, [-0.62, -0.25, 0.7], 0.22), gauss(d, [0.62, -0.25, 0.7], 0.22)) * 0.05;
    const teeth = gauss(d, [0, -0.72, 0.68], 0.25) * 0.05;
    const temple = Math.max(gauss(d, [-0.9, 0.05, 0.3], 0.3), gauss(d, [0.9, 0.05, 0.3], 0.3)) * 0.06;
    const r = 1 - 0.42 * s - 0.35 * n + brow + cheek + teeth - temple;
    p.setXYZ(k, d.x * sx * r, d.y * sy * r, d.z * sz * r);
    // bone, darker in the cavities and the cheek hollows; grime in the sutures at the back
    const suture = gauss(d, [0, 0.55, -0.6], 0.25) * 0.25 + Math.abs(Math.sin(d.x * 9 + d.y * 4)) * (d.z < 0 ? 0.08 : 0);
    const ao = 1 - 0.85 * Math.min(1, s * 1.4 + n * 1.3) - 0.15 * gauss(d, [0, -0.45, 0.6], 0.5) - suture;
    col[k * 3] = ao;
    col[k * 3 + 1] = ao * 0.95;
    col[k * 3 + 2] = ao * 0.86;
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
    col[k * 3 + 1] = ao * 0.95;
    col[k * 3 + 2] = ao * 0.85;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function merged(parts) {
  for (const q of parts) q.deleteAttribute('uv');
  return mergeGeometries(parts.map((q) => q.toNonIndexed()));
}

/** The shaft going into the wall (along -z). */
function shaft(r = 0.55) {
  const s = new THREE.CylinderGeometry(r, r * 1.08, 1.6, 6, 1, true);
  s.rotateX(Math.PI / 2);
  s.translate(0, 0, -0.75);
  return s;
}

/** Bone ends stacked end-on, facing +z, about 1 unit across. */
function boneEndGeometry(kind) {
  const parts = [shaft()];
  if (kind === K_KNUCKLE) {
    // a femur's lower end: two condyles side by side
    for (const s of [-1, 1]) {
      const k = new THREE.SphereGeometry(0.62, 7, 5);
      k.scale(1, 1.15, 0.8);
      k.translate(s * 0.46, 0, 0.05);
      parts.push(rough(k, 0.08, s * 3));
    }
  } else if (kind === K_BROKEN) {
    // a broken-off shaft: a ring with the dark marrow hollow in it
    const ring = new THREE.CylinderGeometry(0.62, 0.62, 0.18, 9, 1, true);
    ring.rotateX(Math.PI / 2);
    const cap = new THREE.RingGeometry(0.3, 0.62, 9);
    cap.translate(0, 0, 0.09);
    const hole = new THREE.CircleGeometry(0.3, 8);
    hole.translate(0, 0, -0.05);
    parts.push(ring, cap, hole);
    return withAO(merged(parts), (x, y, z) => (Math.hypot(x, y) < 0.31 && z < 0.08 ? 0.12 : Math.max(0.2, Math.min(1, 0.8 + z * 0.6))));
  } else if (kind === K_KNOB) {
    // a humerus head: lopsided, with a knob beside it
    const k = new THREE.SphereGeometry(0.8, 8, 6);
    k.scale(1.1, 0.9, 0.75);
    parts.push(rough(k, 0.12, 5));
    const t = new THREE.SphereGeometry(0.35, 6, 4);
    t.translate(0.55, 0.35, -0.05);
    parts.push(t);
  } else {
    const k = new THREE.SphereGeometry(0.85, 8, 6);
    k.scale(1, 1, 0.8);
    k.translate(0, 0, 0.05);
    parts.push(rough(k, 0.1, 1));
  }
  return withAO(merged(parts), (x, y, z) => Math.max(0.15, Math.min(1, 0.82 + z * 0.65)));
}

/** A whole long bone lying down (along x): shaft with a head at one end, condyles at the other. */
function longBoneGeometry() {
  const s = new THREE.CylinderGeometry(0.5, 0.55, 14, 7, 1, true);
  s.rotateZ(Math.PI / 2);
  const head = rough(new THREE.SphereGeometry(0.85, 8, 6), 0.1, 2);
  head.translate(7.2, 0, 0);
  const parts = [s, head];
  for (const sg of [-1, 1]) {
    const k = new THREE.SphereGeometry(0.6, 7, 5);
    k.translate(-7.1, 0, sg * 0.45);
    parts.push(k);
  }
  return withAO(merged(parts), (x, y) => Math.max(0.35, Math.min(1, 0.8 + y * 0.25)));
}

/** The skulls of a motif (a cross or a heart) centred at u, height yc. */
function motifSkulls(kind, u, yc) {
  const out = [];
  if (kind === 0) {
    for (let k = -2; k <= 2; k++) out.push([u, yc + k * SKULL]);
    for (const s of [-1, 1]) out.push([u + s * SKULL, yc + SKULL * 0.9]);
  } else {
    for (let k = 0; k < 12; k++) {
      const t = (k / 12) * Math.PI * 2;
      const x = 16 * Math.sin(t) ** 3;
      const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      out.push([u + x * 0.015, yc + y * 0.015]);
    }
  }
  return out;
}

/** Heights (above the floor) of the skull bands of a wall `height` tall, and of its crown. */
function bandsFor(height) {
  const bands = [];
  if (height > 0.9) bands.push(height * 0.34);
  if (height > 1.5) bands.push(height * 0.66);
  return { bands, crown: height - 0.085 };
}

/** A bone end of a random kind (most are ball heads and knuckles). */
function boneKind(r) {
  return r < 0.38 ? K_BALL : r < 0.66 ? K_KNUCKLE : r < 0.84 ? K_KNOB : K_BROKEN;
}

export class OssuaryRenderer {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.chunks = new Map();
    this.plaques = [];
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });
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

  geometries() {
    this.geo ??= [skullGeometry(), boneEndGeometry(K_BALL), boneEndGeometry(K_KNUCKLE), longBoneGeometry(), boneEndGeometry(K_BROKEN), boneEndGeometry(K_KNOB)];
    return this.geo;
  }

  // ------------------------------------------------------------------ tablets
  buildPlaques() {
    const w = this.world;
    if (!w.plaques?.length || typeof document === 'undefined' || typeof document.createElement('canvas').getContext !== 'function') return;
    const whitewash = new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.95 });
    for (const pq of w.plaques) {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = Math.round((512 * pq.h) / pq.w);
      const ctx = c.getContext('2d');
      // weathered limestone, black-filled engraved capitals, a carved border
      const g = ctx.createLinearGradient(0, 0, c.width, c.height);
      g.addColorStop(0, '#a99f8a');
      g.addColorStop(1, '#8f8572');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, c.width, c.height);
      for (let k = 0; k < 2500; k++) {
        ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '40,34,26' : '200,190,170'},${Math.random() * 0.14})`;
        ctx.fillRect(Math.random() * c.width, Math.random() * c.height, 2 + Math.random() * 3, 2 + Math.random() * 3);
      }
      ctx.strokeStyle = 'rgba(40,34,26,0.6)';
      ctx.lineWidth = 3;
      ctx.strokeRect(14, 14, c.width - 28, c.height - 28);
      const lines = pq.text.split('|');
      const size = Math.min(50, (c.height - 70) / lines.length);
      ctx.font = `600 ${size}px "Times New Roman", Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      lines.forEach((t, k) => {
        const y = c.height / 2 + (k - (lines.length - 1) / 2) * size * 1.18;
        ctx.fillStyle = 'rgba(220,210,190,0.45)';
        ctx.fillText(t, c.width / 2 + 1.2, y + 1.2);
        ctx.fillStyle = '#16120d';
        ctx.fillText(t, c.width / 2, y);
      });
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const stone = new THREE.MeshStandardMaterial({ color: 0x9c927e, roughness: 0.9 });
      const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
      // where the wall's surface is: out from inside the wall until the air
      let d = -0.3;
      while (d < 0.4) {
        const i = w.voxelAt(pq.p[0] + pq.n[0] * d, pq.p[1], pq.p[2] + pq.n[2] * d);
        if (i < 0 || !w.mat[i]) break;
        d += 0.02;
      }
      const out = d + (pq.pedestal ? 0.09 : 0.02); // a pedestal stands proud of the bones
      const obj = new THREE.Group();
      obj.position.set(pq.p[0] + pq.n[0] * out, pq.p[1], pq.p[2] + pq.n[2] * out);
      obj.rotation.y = Math.atan2(pq.n[0], pq.n[2]);
      const slab = new THREE.Mesh(new THREE.BoxGeometry(pq.w, pq.h, 0.05), [stone, stone, stone, stone, face, stone]);
      obj.add(slab);
      // a shaped top: a low gable with stepped shoulders
      const crest = new THREE.Shape();
      crest.moveTo(-pq.w / 2, 0);
      crest.lineTo(-pq.w / 2, 0.05);
      crest.lineTo(-pq.w * 0.3, 0.05);
      crest.lineTo(0, 0.11);
      crest.lineTo(pq.w * 0.3, 0.05);
      crest.lineTo(pq.w / 2, 0.05);
      crest.lineTo(pq.w / 2, 0);
      const cg = new THREE.ExtrudeGeometry(crest, { depth: 0.05, bevelEnabled: false });
      cg.translate(0, pq.h / 2, -0.025);
      obj.add(new THREE.Mesh(cg, stone));
      if (pq.pedestal) {
        // a white-washed pillar under it, down to the floor
        const base = pq.p[1] - pq.h / 2;
        const ph = base - w.h;
        const ped = new THREE.Mesh(new THREE.BoxGeometry(0.24, ph, 0.12), whitewash);
        ped.position.set(0, -pq.h / 2 - ph / 2, -0.04);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.05, 0.16), whitewash);
        cap.position.set(0, -pq.h / 2 - 0.025, -0.04);
        obj.add(ped, cap);
      }
      obj.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      this.group.add(obj);
      this.plaques.push(obj);
    }
  }

  /** Is (u, y) on a wall plane covered by a tablet (or its pedestal)? No bones there. */
  underPlaque(axis, plane, u, y) {
    for (const pq of this.world.plaques ?? []) {
      const pAxis = Math.abs(pq.n[0]) > 0.5 ? 0 : 2;
      if (pAxis !== axis) continue;
      const pPlane = axis === 0 ? pq.p[0] : pq.p[2];
      if (Math.abs(pPlane - plane) > 0.15) continue;
      const pu = axis === 0 ? pq.p[2] : pq.p[0];
      if (Math.abs(u - pu) < pq.w / 2 + 0.02 && Math.abs(y - pq.p[1]) < pq.h / 2 + 0.12) return true;
      if (pq.pedestal && Math.abs(u - pu) < 0.14 && y < pq.p[1]) return true;
    }
    return false;
  }

  inBarrel(x, z) {
    for (const b of this.world.barrels ?? []) if (Math.hypot(x - b.c[0], z - b.c[1]) < b.r + this.world.h * 1.2) return true;
    return false;
  }

  // ------------------------------------------------------------------ layout
  /** Every face of a bone wall that faces a covered space, by chunk; each wall column's floor and top. */
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
      if (this.inBarrel((x + 0.5) * h, (z + 0.5) * h)) continue; // drawn as a round pillar
      // only faces towards a covered space (a passage, a chamber): not the backs of the walls
      const inside = (j, xx, zz) => !mat[j] && w.colTop[xx + nx * zz] > y;
      const faces = [];
      if (x + 1 < nx && inside(i + 1, x + 1, z)) faces.push(0, 1);
      if (x > 0 && inside(i - 1, x - 1, z)) faces.push(0, -1);
      if (z + 1 < nz && inside(i + nx * ny, x, z + 1)) faces.push(2, 1);
      if (z > 0 && inside(i - nx * ny, x, z - 1)) faces.push(2, -1);
      if (y + 1 < ny && !mat[i + nx] && w.colTop[x + nx * z] > y + 1) faces.push(1, 1); // top of the wall
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

  /**
   * The skulls and bones on one voxel face, appended to `out` as
   * [kind, u, y, rand, out, flip] (out: m proud of the face; flip: a skull turned to show its back).
   * Top faces append [kind, x, y, rand, z, 0].
   */
  features(w, i, axis, sign, out) {
    const h = w.h;
    const [x, y, z] = w.coords(i);
    if (axis === 1) {
      // on top of the wall: loose long bones heaped every which way, now and then a skull
      for (let k = 0; k < 4; k++) {
        const r = hash(i, k, 91);
        out.push(r < 0.06 ? K_SKULL : K_LYING, x * h + h * hash(i, k, 3), (y + 1) * h + hash(i, k, 8) * 0.05, r, z * h + h * hash(i, k, 5), 0);
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
    const vx = axis === 0 ? x + (sign > 0 ? 1 : 0) : z + (sign > 0 ? 1 : 0);
    const plane = vx * h;
    const off = hash(vx, axis, sign + 7) * 6; // each wall its own phase
    const inFace = (u, yy) => u >= u0 && u < u1 && yy >= y0 && yy < y1;
    const free = (u, yy) => !this.underPlaque(axis, plane, u, yy);
    const { bands, crown } = bandsFor(height);
    // the motifs near this face (rare: a cross or a heart now and then)
    const motif = [];
    if (height > 1.2)
      for (let j = Math.floor((u0 + off) / MOTIF) - 1; j <= Math.floor((u1 + off) / MOTIF) + 1; j++) {
        if (hash(j, vx, 77) < 0.5) continue;
        const uc = (j + 0.5) * MOTIF - off;
        const yc = floor + (bands[0] + (bands[1] ?? crown)) / 2;
        for (const pt of motifSkulls(hash(j, vx, 78) < 0.5 ? 0 : 1, uc, yc)) motif.push(pt);
      }
    const nearMotif = (u, yy, d) => motif.some(([mu, my]) => Math.abs(mu - u) < d && Math.abs(my - yy) < d * 1.15);
    for (const [mu, my] of motif) if (inFace(mu, my) && free(mu, my)) out.push(K_SKULL, mu, my, hash(Math.round(mu * 100), Math.round(my * 100), 17), 0.04, 0);
    // the skull bands and the crown
    for (const ys of [...bands.map((b) => floor + b), floor + crown]) {
      if (ys < y0 || ys >= y1) continue;
      for (let j = Math.floor((u0 + off) / SKULL) - 1; j <= Math.ceil((u1 + off) / SKULL); j++) {
        const r = hash(j, Math.round(ys * 50), vx * 3 + axis);
        const u = (j + 0.5) * SKULL - off + (r - 0.5) * 0.02;
        if (!inFace(u, ys) || nearMotif(u, ys, 0.12) || !free(u, ys)) continue;
        out.push(K_SKULL, u, ys + (hash(j, 3, vx) - 0.5) * 0.02, r, 0.035 + hash(j, 4, vx) * 0.025, hash(j, 5, vx) < 0.4 ? 1 : 0);
      }
    }
    // everything else: bone ends, row upon row, irregular
    const r0 = Math.floor((y0 - floor) / BONE_Y) - 1;
    for (let row = r0; row <= r0 + 6; row++) {
      const yb = floor + 0.025 + row * BONE_Y;
      if (yb < y0 || yb >= y1 || yb > floor + crown - 0.08) continue;
      if (bands.some((b) => Math.abs(floor + b - yb) < 0.085)) continue;
      const stagger = (((row % 2) + 2) % 2) * BONE_X * 0.5 + hash(row, vx, 1) * 0.02;
      for (let j = Math.floor((u0 + off - stagger) / BONE_X) - 1; j <= Math.ceil((u1 + off) / BONE_X); j++) {
        const r = hash(j, row, vx * 5 + axis);
        const u = j * BONE_X + stagger - off + (r - 0.5) * 0.026;
        const yy = yb + (hash(j, row, 9) - 0.5) * 0.022;
        if (!inFace(u, yy) || nearMotif(u, yy, 0.09) || !free(u, yy)) continue;
        out.push(boneKind(hash(j, row, 13)), u, yy, r, (hash(j, row, 21) - 0.4) * 0.035, 0);
      }
    }
  }

  /** The bones of a round pillar: the same courses, on a circle. Appends [kind, x, y, z, nx, nz, rand, out, flip]. */
  barrelFeatures(b, out) {
    const height = b.y1 - b.y0;
    const { bands, crown } = bandsFor(height);
    const put = (kind, a, y, r, o, flip) => out.push(kind, b.c[0] + Math.cos(a) * b.r, y, b.c[1] + Math.sin(a) * b.r, Math.cos(a), Math.sin(a), r, o, flip);
    const circ = 2 * Math.PI * b.r;
    for (const ys of [...bands, crown]) {
      const n = Math.floor(circ / SKULL);
      for (let j = 0; j < n; j++) put(K_SKULL, (j / n) * Math.PI * 2, b.y0 + ys, hash(j, Math.round(ys * 50), 3), 0.035, hash(j, 7, 1) < 0.4 ? 1 : 0);
    }
    for (let row = 0; b.y0 + 0.025 + row * BONE_Y < b.y0 + crown - 0.08; row++) {
      const yb = 0.025 + row * BONE_Y;
      if (bands.some((bb) => Math.abs(bb - yb) < 0.085)) continue;
      const n = Math.floor(circ / BONE_X);
      for (let j = 0; j < n; j++) {
        const a = ((j + (row % 2) * 0.5) / n) * Math.PI * 2 + (hash(j, row, 3) - 0.5) * 0.02;
        put(boneKind(hash(j, row, 13)), a, b.y0 + yb + (hash(j, row, 9) - 0.5) * 0.02, hash(j, row, 5), (hash(j, row, 21) - 0.4) * 0.03, 0);
      }
    }
    // the top of the pillar: a heap of loose bones
    for (let k = 0; k < Math.round(b.r * b.r * 60); k++) {
      const a = hash(k, 1, 9) * Math.PI * 2;
      const rr = Math.sqrt(hash(k, 2, 9)) * b.r * 0.85;
      out.push(K_LYING, b.c[0] + Math.cos(a) * rr, b.y1 + hash(k, 3, 9) * 0.06, b.c[1] + Math.sin(a) * rr, 0, 0, hash(k, 4, 9), 0, 0);
    }
  }

  makeMeshes(counts) {
    const geo = this.geometries();
    return counts.map((c, kind) => {
      const m = new THREE.InstancedMesh(geo[kind], this.material, Math.max(1, c));
      m.count = 0;
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, c) * 3), 3);
      m.castShadow = true;
      m.receiveShadow = true;
      m.userData.voxels = new Int32Array(Math.max(1, c));
      m.userData.tone = new Float32Array(Math.max(1, c) * 3);
      return m;
    });
  }

  /** Put one bone / skull: at p, facing along the horizontal normal (nx, nz) (or lying, for K_LYING). */
  place(meshes, kind, p, nx, nz, r, outward, flip, voxel, salt) {
    const pos = new THREE.Vector3(p[0] + nx * outward, p[1], p[2] + nz * outward);
    const scl = new THREE.Vector3();
    if (kind === K_LYING) {
      this.e.set((r - 0.5) * 0.6, r * 6.28, (hash(voxel, salt, 7) - 0.5) * 0.4, 'YXZ');
      const sc = 0.02 * (0.75 + r * 0.5);
      scl.set(sc, sc, sc);
      pos.y += sc * 0.6;
    } else {
      const yaw = Math.atan2(nx, nz) + (kind === K_SKULL && flip ? Math.PI : 0);
      if (kind === K_SKULL) {
        this.e.set((r - 0.5) * 0.35, yaw + (hash(voxel, salt, 2) - 0.5) * 0.6, (hash(voxel, salt, 4) - 0.5) * 0.35, 'YXZ');
        const k = 0.9 + r * 0.22;
        scl.set(0.075 * k, 0.078 * k, 0.088 * k);
      } else {
        this.e.set((r - 0.5) * 0.45, yaw + (hash(voxel, salt, 6) - 0.5) * 0.5, r * 6.28, 'YXZ');
        const sc = 0.023 * (0.7 + 0.65 * hash(voxel, salt, 11));
        scl.set(sc, sc, sc);
      }
    }
    this.q.setFromEuler(this.e);
    this.m.compose(pos, this.q, scl);
    const mesh = meshes[kind];
    const n = mesh.count++;
    mesh.setMatrixAt(n, this.m);
    mesh.userData.voxels[n] = voxel;
    // colour: brown-ochre bone of every shade, some dark with grime, skulls a little paler
    const t = 0.55 + 0.5 * hash(voxel, salt, 31);
    const warm = hash(voxel, salt, 33);
    const tone = mesh.userData.tone;
    const pale = kind === K_SKULL ? 1.12 : 1;
    tone[n * 3] = (0.62 + 0.12 * warm) * t * pale;
    tone[n * 3 + 1] = (0.5 + 0.08 * warm) * t * pale;
    tone[n * 3 + 2] = (0.34 + 0.04 * warm) * t * pale;
  }

  buildChunk(list) {
    const w = this.world;
    const h = w.h;
    const feats = [];
    const tmp = [];
    for (let k = 0; k < list.length; k += 3) {
      tmp.length = 0;
      this.features(w, list[k], list[k + 1], list[k + 2], tmp);
      for (let f = 0; f < tmp.length; f += 6) feats.push(list[k], list[k + 1], list[k + 2], ...tmp.slice(f, f + 6));
    }
    const counts = new Array(KINDS).fill(0);
    for (let f = 0; f < feats.length; f += 9) counts[feats[f + 3]]++;
    const meshes = this.makeMeshes(counts);
    for (let f = 0; f < feats.length; f += 9) {
      const [i, axis, sign, kind, a, y, r, o, flip] = feats.slice(f, f + 9);
      if (axis === 1) {
        this.place(meshes, kind, [a, y, o], 0, 0, r, 0, 0, i, f);
        continue;
      }
      const [vx, , vz] = w.coords(i);
      const plane = (axis === 0 ? vx : vz) * h + (sign > 0 ? h : 0);
      const p = axis === 0 ? [plane, y, a] : [a, y, plane];
      this.place(meshes, kind, p, axis === 0 ? sign : 0, axis === 2 ? sign : 0, r, o, flip, i, Math.round(a * 1000));
    }
    return this.finish(meshes, list.length + ':' + list[0] + ':' + list[list.length - 3]);
  }

  buildBarrel(b) {
    const w = this.world;
    const tmp = [];
    this.barrelFeatures(b, tmp);
    const counts = new Array(KINDS).fill(0);
    for (let f = 0; f < tmp.length; f += 9) counts[tmp[f]]++;
    const meshes = this.makeMeshes(counts);
    for (let f = 0; f < tmp.length; f += 9) {
      const [kind, x, y, z, nx, nz, r, o, flip] = tmp.slice(f, f + 9);
      // the voxel behind it (inside the pillar), for charring and for being blown away
      const vi = w.voxelAt(x - nx * w.h * 0.6, Math.max(w.h * 1.5, y), z - nz * w.h * 0.6);
      this.place(meshes, kind, [x, y, z], nx, nz, r, o, flip, Math.max(0, vi), f);
    }
    return this.finish(meshes, 'barrel');
  }

  finish(meshes, signature) {
    for (const m of meshes) {
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
      this.group.add(m);
    }
    const ch = { meshes, signature };
    const bs = meshes.find((m) => m.count)?.boundingSphere;
    ch.centre = bs ? bs.center.clone() : new THREE.Vector3();
    this.shade(ch);
    return ch;
  }

  /** Bone colour, darkened where the wall is charred or sooted; gone where its voxel is gone. */
  shade(ch) {
    const w = this.world;
    for (const m of ch.meshes) {
      const vox = m.userData.voxels;
      const tone = m.userData.tone;
      const arr = m.instanceColor.array;
      for (let k = 0; k < m.count; k++) {
        const i = vox[k];
        const c = w.mat[i] ? 1 - 0.85 * w.char[i] : 0;
        arr[k * 3] = tone[k * 3] * c;
        arr[k * 3 + 1] = tone[k * 3 + 1] * c;
        arr[k * 3 + 2] = tone[k * 3 + 2] * c;
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
      (w.barrels ?? []).forEach((b, k) => {
        const key = 'barrel ' + k;
        if (!this.chunks.has(key)) this.chunks.set(key, this.buildBarrel(b));
      });
      for (const [key, ch] of this.chunks)
        if (!key.startsWith('barrel') && !byChunk.has(key)) {
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
