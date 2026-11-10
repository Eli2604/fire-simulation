import * as THREE from 'three';
import { MATERIALS } from '../sim/materials.js';
import { F_HIDDEN, F_FALLING } from '../sim/world.js';

/**
 * Trees drawn as trees. A tree is simulated as voxels (wood that chars and breaks
 * off, foliage that dries and burns); those voxels are hidden and this draws:
 *
 *  - the trunk and every branch as tapered round segments with bark (oak: deep,
 *    dark vertical fissures; willow: grey criss-crossing ridges; pine: reddish
 *    plates in the upper crown, grey below);
 *  - the foliage as leaf cards, one set per leaf voxel: oak clusters of lobed
 *    leaves, willow narrow leaves on hanging strands, pine tufts of needles.
 *
 * A segment is drawn while most of its voxels are there and not falling (a branch
 * that burnt through and broke off falls as voxels); a leaf card while its voxel
 * is there. They darken as the wood or the leaves char, and leaves brown as they
 * dry (their voxel colour).
 */
const WOOD = new Set(['bark', 'oak', 'willow', 'pine', 'deadWood']);
const LEAF = new Set(['leaves', 'needles']);

function canvas(w, h, draw) {
  if (typeof document === 'undefined' || typeof document.createElement('canvas').getContext !== 'function') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function rnd(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Bark: long vertical fissures (oak), interlacing ridges (willow), plates (pine). */
function barkTexture(species) {
  return canvas(256, 512, (ctx, w, h) => {
    const r = rnd(species.length * 97);
    const base = { oak: '#4a3f35', willow: '#5a5448', pine: '#6a4632' }[species] ?? '#4a3f35';
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    if (species === 'pine') {
      // irregular plates with dark seams
      for (let y = 0; y < h; y += 30 + r() * 40)
        for (let x = 0; x < w; x += 25 + r() * 35) {
          ctx.fillStyle = `rgba(${150 + r() * 60},${80 + r() * 40},${50 + r() * 25},${0.35 + r() * 0.3})`;
          ctx.beginPath();
          ctx.ellipse(x, y, 12 + r() * 14, 16 + r() * 18, r() * 0.6, 0, Math.PI * 2);
          ctx.fill();
        }
      ctx.strokeStyle = 'rgba(20,12,8,0.8)';
      for (let k = 0; k < 120; k++) {
        ctx.lineWidth = 1 + r() * 2.5;
        const x = r() * w;
        const y = r() * h;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (r() - 0.5) * 40, y + (r() - 0.5) * 20);
        ctx.stroke();
      }
      return;
    }
    // ridges and fissures running up the trunk
    for (let k = 0; k < (species === 'willow' ? 70 : 55); k++) {
      const x = r() * w;
      ctx.strokeStyle = `rgba(${15 + r() * 15},${12 + r() * 10},${8},${0.6 + r() * 0.35})`;
      ctx.lineWidth = species === 'willow' ? 1.5 + r() * 3 : 2.5 + r() * 5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      let xx = x;
      for (let y = 0; y <= h; y += 24) {
        xx += (r() - 0.5) * (species === 'willow' ? 26 : 12);
        ctx.lineTo(xx, y);
      }
      ctx.stroke();
    }
    // lighter ridge tops, lichen
    for (let k = 0; k < 600; k++) {
      ctx.fillStyle = `rgba(${140 + r() * 60},${130 + r() * 50},${110 + r() * 40},${r() * 0.18})`;
      ctx.fillRect(r() * w, r() * h, 2 + r() * 6, 4 + r() * 16);
    }
    for (let k = 0; k < 30; k++) {
      ctx.fillStyle = `rgba(110,130,70,${0.1 + r() * 0.2})`;
      ctx.beginPath();
      ctx.arc(r() * w, r() * h, 3 + r() * 10, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** Leaf cards: a cluster drawn on a transparent canvas (white-ish: tinted per voxel). */
function leafTexture(species) {
  return canvas(256, species === 'willow' ? 512 : 256, (ctx, w, h) => {
    const r = rnd(species.length * 31 + 7);
    ctx.clearRect(0, 0, w, h);
    const leafFill = () => {
      const v = 170 + r() * 70;
      return `rgb(${v * (0.85 + r() * 0.15)},${v},${v * (0.7 + r() * 0.2)})`;
    };
    if (species === 'grass') {
      // a tuft of blades from the ground up, bending over
      for (let k = 0; k < 90; k++) {
        const x = w * (0.1 + 0.8 * r());
        const hgt = h * (0.45 + 0.55 * r());
        const bend = (r() - 0.5) * 60;
        ctx.strokeStyle = leafFill();
        ctx.lineWidth = 1.5 + r() * 2.5;
        ctx.beginPath();
        ctx.moveTo(x, h);
        ctx.quadraticCurveTo(x + bend * 0.3, h - hgt * 0.6, x + bend, h - hgt);
        ctx.stroke();
      }
      return;
    }
    if (species === 'pine') {
      // tufts of needles radiating from twigs
      for (let t = 0; t < 7; t++) {
        const cx = 40 + r() * (w - 80);
        const cy = 40 + r() * (h - 80);
        ctx.strokeStyle = 'rgba(110,90,70,0.9)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx - 30, cy + 20);
        ctx.lineTo(cx + 30, cy - 20);
        ctx.stroke();
        for (let k = 0; k < 70; k++) {
          const s = r();
          const x = cx - 30 + 60 * s;
          const y = cy + 20 - 40 * s;
          const a = r() * Math.PI * 2;
          const l = 18 + r() * 22;
          ctx.strokeStyle = leafFill();
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
          ctx.stroke();
        }
      }
      return;
    }
    if (species === 'willow') {
      // hanging strands with narrow leaves along them
      for (let s = 0; s < 5; s++) {
        const x0 = 30 + s * 48 + r() * 10;
        ctx.strokeStyle = 'rgba(150,150,90,0.6)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(x0, 0);
        ctx.quadraticCurveTo(x0 + (r() - 0.5) * 20, h / 2, x0 + (r() - 0.5) * 16, h);
        ctx.stroke();
        for (let y = 6; y < h; y += 9 + r() * 6) {
          for (const side of [-1, 1]) {
            ctx.fillStyle = leafFill();
            ctx.save();
            ctx.translate(x0 + (y / h) * (r() - 0.5) * 8, y);
            ctx.rotate(side * (0.4 + r() * 0.5));
            ctx.beginPath();
            ctx.ellipse(side * 10, 7, 4.5, 17, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }
      }
      return;
    }
    // oak: lobed leaves on twigs
    const lobed = (x, y, s, a) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      ctx.scale(s, s);
      ctx.fillStyle = leafFill();
      ctx.beginPath();
      ctx.moveTo(0, -20);
      for (let k = 0; k <= 8; k++) {
        const t = k / 8;
        const yy = -20 + 40 * t;
        const wdt = Math.sin(Math.PI * t) * (9 + 4 * Math.sin(t * Math.PI * 5));
        ctx.lineTo(wdt, yy);
      }
      for (let k = 8; k >= 0; k--) {
        const t = k / 8;
        const yy = -20 + 40 * t;
        const wdt = Math.sin(Math.PI * t) * (9 + 4 * Math.sin(t * Math.PI * 5));
        ctx.lineTo(-wdt, yy);
      }
      ctx.fill();
      ctx.strokeStyle = 'rgba(60,70,30,0.5)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(0, -18);
      ctx.lineTo(0, 20);
      ctx.stroke();
      ctx.restore();
    };
    for (let k = 0; k < 34; k++) lobed(20 + r() * (w - 40), 20 + r() * (h - 40), 0.8 + r() * 0.6, r() * Math.PI * 2);
  });
}

const tex = { bark: {}, leaf: {} };
const barkTex = (s) => (tex.bark[s] ??= barkTexture(s));
const leafTex = (s) => (tex.leaf[s] ??= leafTexture(s));

export class TreeRenderer {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.items = [];
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.v = new THREE.Vector3();
    this.s = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
  }

  setWorld(world) {
    for (const it of this.items) for (const m of it.meshes) this.group.remove(m);
    this.items = [];
    this.world = world;
    for (const t of world.trees ?? []) this.items.push(this.build(world, t));
    const grass = [];
    for (let k = 0; k < world.solidCount; k++) if (MATERIALS[world.mat[world.solids[k]]].name === 'grass') grass.push(world.solids[k]);
    if (grass.length) this.items.push(this.buildGrass(world, grass));
    world.geomVersion++;
  }

  build(w, t) {
    const h = w.h;
    // the tree's voxels: wood to its nearest segment, foliage as it is
    const wood = [];
    const leaves = [];
    for (let k = 0; k < w.solidCount; k++) {
      const i = w.solids[k];
      if (w.owner[i] !== t.owner) continue;
      const name = MATERIALS[w.mat[i]].name;
      if (WOOD.has(name)) wood.push(i);
      else if (LEAF.has(name)) leaves.push(i);
    }
    const segVox = t.segs.map(() => []);
    for (const i of wood) {
      const c = w.center(...w.coords(i));
      let best = -1;
      let bd = Infinity;
      t.segs.forEach((s, k) => {
        const d = distToSegment(c, s.a, s.b) - s.r;
        if (d < bd) {
          bd = d;
          best = k;
        }
      });
      if (best >= 0 && bd < h * 1.2) segVox[best].push(i);
    }
    // --- bark: one instanced, tapered unit cylinder per segment
    const geo = new THREE.CylinderGeometry(0.82, 1, 1, 10, 1, false);
    geo.translate(0, 0.5, 0);
    const bark = new THREE.MeshStandardMaterial({ map: barkTex(t.species), roughness: 0.95 });
    bark.color.setRGB(1.7, 1.6, 1.5); // the bark texture is dark; lit like the leaves
    if (bark.map) bark.map.repeat.set(1, 2);
    const segMesh = new THREE.InstancedMesh(geo, bark, t.segs.length);
    segMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(t.segs.length * 3).fill(1), 3);
    segMesh.castShadow = true;
    segMesh.receiveShadow = true;
    t.segs.forEach((s, k) => this.placeSeg(segMesh, k, s, h));
    segMesh.instanceMatrix.needsUpdate = true;
    // --- foliage: crossed leaf cards for every leaf voxel
    const cards = t.species === 'willow' ? 2 : 3;
    const size = Math.max(0.35, h * (t.species === 'pine' ? 2.4 : 2.8));
    const cardGeo = t.species === 'willow' ? new THREE.PlaneGeometry(size * 0.55, size * 1.6) : new THREE.PlaneGeometry(size, size);
    const leafMat = new THREE.MeshStandardMaterial({ map: leafTex(t.species), color: 0xffffff, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8 });
    const leafMesh = new THREE.InstancedMesh(cardGeo, leafMat, Math.max(1, leaves.length * cards));
    leafMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, leaves.length * cards) * 3), 3);
    leafMesh.castShadow = true;
    leafMesh.receiveShadow = true;
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    let n = 0;
    for (const i of leaves) {
      const c = w.center(...w.coords(i));
      for (let k = 0; k < cards; k++) {
        const r1 = hash(i, k, 1);
        const r2 = hash(i, k, 2);
        if (t.species === 'willow') e.set((r1 - 0.5) * 0.2, r2 * Math.PI * 2, (r1 - 0.5) * 0.15, 'YXZ');
        else e.set((r1 - 0.5) * 1.6, r2 * Math.PI * 2, (hash(i, k, 3) - 0.5) * 1.2, 'YXZ');
        pos.set(c[0] + (hash(i, k, 4) - 0.5) * h, c[1] + (hash(i, k, 5) - 0.5) * h, c[2] + (hash(i, k, 6) - 0.5) * h);
        this.m.compose(pos, this.q.setFromEuler(e), one);
        leafMesh.setMatrixAt(n++, this.m);
      }
    }
    leafMesh.count = n;
    leafMesh.instanceMatrix.needsUpdate = true;
    this.group.add(segMesh, leafMesh);
    for (const i of wood) w.flags[i] |= F_HIDDEN;
    for (const i of leaves) w.flags[i] |= F_HIDDEN;
    const it = { t, segMesh, leafMesh, segVox, leaves, cards, meshes: [segMesh, leafMesh], tick: -1 };
    this.shade(it);
    return it;
  }

  /** Grass: crossed cards of blades standing on every grass voxel. */
  buildGrass(w, voxels) {
    const h = w.h;
    const cards = 2;
    const geo = new THREE.PlaneGeometry(h * 1.6, h * 1.4);
    geo.translate(0, h * 0.7, 0); // stands on its foot
    const mat = new THREE.MeshStandardMaterial({ map: leafTex('grass'), color: 0xffffff, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9 });
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, voxels.length * cards));
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, voxels.length * cards) * 3), 3);
    mesh.receiveShadow = true;
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    let n = 0;
    for (const i of voxels) {
      const [x, y, z] = w.coords(i);
      for (let k = 0; k < cards; k++) {
        e.set((hash(i, k, 1) - 0.5) * 0.2, hash(i, k, 2) * Math.PI + k * (Math.PI / 2), 0, 'YXZ');
        pos.set((x + 0.2 + 0.6 * hash(i, k, 3)) * h, y * h, (z + 0.2 + 0.6 * hash(i, k, 4)) * h);
        this.m.compose(pos, this.q.setFromEuler(e), one.set(1, 0.7 + 0.6 * hash(i, k, 5), 1));
        mesh.setMatrixAt(n++, this.m);
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    for (const i of voxels) w.flags[i] |= F_HIDDEN;
    const it = { grass: true, leaves: voxels, leafMesh: mesh, cards, meshes: [mesh], tick: -1, owner: null };
    this.shadeLeaves(it);
    return it;
  }

  placeSeg(mesh, k, s, h) {
    const a = this.v.set(...s.a);
    const d = new THREE.Vector3(...s.b).sub(a);
    const len = d.length();
    const r = Math.max(s.r, 0.008);
    this.q.setFromUnitVectors(this.up, d.normalize());
    this.s.set(r, len + Math.min(r, h * 0.5), r);
    this.m.compose(a, this.q, this.s);
    mesh.setMatrixAt(k, this.m);
  }

  /** Colours and what is still there: from the voxels. */
  shade(it) {
    const w = this.world;
    const { t, segMesh, leafMesh, segVox, leaves, cards } = it;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const col = segMesh.instanceColor.array;
    t.segs.forEach((s, k) => {
      const vox = segVox[k];
      let left = 0;
      let ch = 0;
      let hot = 0;
      for (const i of vox)
        if (w.mat[i] && w.owner[i] === t.owner && !(w.flags[i] & F_FALLING)) {
          left++;
          ch += w.char[i];
          hot = Math.max(hot, w.skin[i]);
        }
      const there = vox.length === 0 ? true : left >= vox.length * 0.5;
      if (!there) segMesh.setMatrixAt(k, zero);
      const c = left ? 1 - 0.85 * (ch / left) : 1;
      const glow = Math.max(0, Math.min(1, (hot - 450) / 500));
      col[k * 3] = c + glow * 1.5;
      col[k * 3 + 1] = c + glow * 0.4;
      col[k * 3 + 2] = c;
    });
    segMesh.instanceMatrix.needsUpdate = true;
    segMesh.instanceColor.needsUpdate = true;
    this.shadeLeaves(it);
  }

  shadeLeaves(it) {
    const w = this.world;
    const { leafMesh, leaves, cards } = it;
    const owner = it.t?.owner;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const lc = leafMesh.instanceColor.array;
    let n = 0;
    for (const i of leaves) {
      const gone = !w.mat[i] || (owner != null && w.owner[i] !== owner) || (it.grass && MATERIALS[w.mat[i]].name !== 'grass');
      for (let k = 0; k < cards; k++, n++) {
        if (gone) {
          leafMesh.setMatrixAt(n, zero);
          continue;
        }
        // the voxel's own colour (dries and browns), charred towards black
        const c = 1 - 0.9 * w.char[i];
        const v = 0.85 + 0.3 * hash(i, k, 9);
        lc[n * 3] = (w.tint[i * 3] / 255) * c * v;
        lc[n * 3 + 1] = (w.tint[i * 3 + 1] / 255) * c * v;
        lc[n * 3 + 2] = (w.tint[i * 3 + 2] / 255) * c * v;
      }
    }
    leafMesh.instanceMatrix.needsUpdate = true;
    leafMesh.instanceColor.needsUpdate = true;
  }

  update(time) {
    if (!this.world) return;
    const tick = Math.floor(time * 2);
    for (const it of this.items) {
      if (it.tick === tick) continue;
      it.tick = tick;
      if (it.grass) this.shadeLeaves(it);
      else this.shade(it);
    }
  }
}

function hash(a, b, c) {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function distToSegment(p, a, b) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby + (p[2] - a[2]) * abz) / (abx * abx + aby * aby + abz * abz || 1)));
  return Math.hypot(p[0] - a[0] - abx * t, p[1] - a[1] - aby * t, p[2] - a[2] - abz * t);
}
