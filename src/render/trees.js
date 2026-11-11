import * as THREE from 'three';
import { MATERIALS } from '../sim/materials.js';
import { F_HIDDEN, F_FALLING } from '../sim/world.js';

// the wind in the grass (vertex shader, in place of three.js project_vertex)
const WIND_GLSL = `vec4 mvPosition = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
mvPosition = instanceMatrix * mvPosition;
vec3 gBase = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
#else
vec3 gBase = vec3(0.0);
#endif
// the wind bends the blades: more at the tips, in gusts that roll across the field
float gH = clamp(position.y / uCardH, 0.0, 1.0);
float gust = 0.65 + 0.35 * sin(dot(gBase.xz, uWindDir) * 0.45 - uTime * 1.9) + 0.18 * sin(gBase.x * 2.1 + uTime * 3.3) * sin(gBase.z * 1.7 - uTime * 2.7);
float flutter = 0.06 * sin(uTime * 6.0 + gBase.x * 9.0 + gBase.z * 7.0);
float bend = (uWindStr * gust + flutter) * gH * gH;
mvPosition.xz += uWindDir * bend * uCardH;
mvPosition.y -= 0.45 * bend * bend * uCardH;
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`;

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
  return canvas(species === 'grass' ? 512 : 256, species === 'willow' || species === 'grass' ? 512 : 256, (ctx, w, h) => {
    const r = rnd(species.length * 31 + 7);
    ctx.clearRect(0, 0, w, h);
    const leafFill = () => {
      const v = 170 + r() * 70;
      return `rgb(${v * (0.85 + r() * 0.15)},${v},${v * (0.7 + r() * 0.2)})`;
    };
    if (species === 'grass') {
      // a meadow tuft: many thin tapering blades from the ground up, of every length,
      // some bending over, a few dry and straw-coloured, some seed heads on stalks;
      // darker low down (in the shade of the others)
      for (let k = 0; k < 120; k++) {
        const x = w * (0.04 + 0.92 * r());
        const hgt = h * (0.3 + 0.67 * r() ** 0.7);
        const bend = (r() - 0.5) * (40 + hgt * 0.25);
        const wd = 0.8 + r() * 1.6;
        const dry = r() < 0.12;
        const g = 120 + r() * 110;
        const top = dry ? `rgb(${g * 1.05},${g * 0.95},${g * 0.55})` : `rgb(${g * (0.62 + r() * 0.2)},${g},${g * (0.38 + r() * 0.2)})`;
        const grad = ctx.createLinearGradient(0, h, 0, h - hgt);
        grad.addColorStop(0, 'rgb(40,52,24)');
        grad.addColorStop(0.5, top);
        grad.addColorStop(1, top);
        ctx.fillStyle = grad;
        // the blade: a thin curved sliver, wide at its foot, pointed
        const tx = x + bend;
        const ty = h - hgt;
        const mx = x + bend * 0.35;
        const my = h - hgt * 0.6;
        ctx.beginPath();
        ctx.moveTo(x - wd, h);
        ctx.quadraticCurveTo(mx - wd * 0.6, my, tx, ty);
        ctx.quadraticCurveTo(mx + wd * 0.6, my, x + wd, h);
        ctx.closePath();
        ctx.fill();
      }
      // seed heads
      for (let k = 0; k < 9; k++) {
        const x = w * (0.1 + 0.8 * r());
        const hgt = h * (0.75 + 0.22 * r());
        const bend = (r() - 0.5) * 50;
        ctx.strokeStyle = 'rgb(150,150,95)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x, h);
        ctx.quadraticCurveTo(x + bend * 0.4, h - hgt * 0.5, x + bend, h - hgt);
        ctx.stroke();
        ctx.fillStyle = 'rgb(170,160,110)';
        ctx.beginPath();
        ctx.ellipse(x + bend, h - hgt, 2.2, 9, bend * 0.01, 0, Math.PI * 2);
        ctx.fill();
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

/**
 * A tuft of grass as real blades (not a picture on a card): thin tapering curved
 * ribbons of three segments, of different lengths, leaning every way, spread over a
 * voxel's footprint; dark at the foot, lighter towards the tip, a few dry ones.
 * Vertex colours (multiplied by the voxel's colour); y from 0 at the ground up to H.
 */
function grassTuft(H, foot) {
  const r = rnd(4242);
  const pos = [];
  const col = [];
  const idx = [];
  const blades = 36;
  for (let b = 0; b < blades; b++) {
    const x0 = (r() - 0.5) * foot * 0.95;
    const z0 = (r() - 0.5) * foot * 0.95;
    const len = H * (0.45 + 0.55 * r());
    const a = r() * Math.PI * 2; // the way it leans
    const lean = 0.15 + 0.5 * r();
    const w0 = 0.016 + 0.018 * r();
    const face = a + Math.PI / 2 + (r() - 0.5) * 0.8; // the blade's flat side
    const dry = r() < 0.1;
    const tip = dry ? [0.95, 0.85, 0.5] : [0.55 + 0.2 * r(), 0.9 + 0.1 * r(), 0.35 + 0.15 * r()];
    const base = [0.25, 0.32, 0.16];
    const n0 = pos.length / 3;
    const segs = 3;
    for (let k = 0; k <= segs; k++) {
      const t = k / segs;
      // a curve: rises, then bends over in the leaning direction
      const out = lean * len * t * t;
      const cx = x0 + Math.cos(a) * out;
      const cz = z0 + Math.sin(a) * out;
      const cy = len * (t - 0.18 * lean * t * t);
      const hw = w0 * (1 - t * 0.92);
      const ox = Math.cos(face) * hw;
      const oz = Math.sin(face) * hw;
      pos.push(cx - ox, cy, cz - oz, cx + ox, cy, cz + oz);
      const c = base.map((v, j) => v + (tip[j] - v) * Math.min(1, t * 1.3));
      col.push(...c, ...c);
      if (k < segs) {
        const q = n0 + k * 2;
        idx.push(q, q + 1, q + 3, q, q + 3, q + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // the blades are lit as the ground under them is (they mostly face up and out)
  const n = g.getAttribute('normal');
  for (let k = 0; k < n.count; k++) {
    const v = new THREE.Vector3(n.getX(k), n.getY(k) + 1.2, n.getZ(k)).normalize();
    n.setXYZ(k, v.x, v.y, v.z);
  }
  return g;
}

export class TreeRenderer {
  constructor(scene) {
    this.windU = { uTime: { value: 0 }, uWindStr: { value: 0.2 }, uWindDir: { value: new THREE.Vector2(1, 0) }, uCardH: { value: 0.4 } };
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

  /**
   * Grass: crossed cards of blades standing on every grass voxel. The lowest grass voxels
   * (the turf on the soil) stay visible as the ground, photographed grass on them, and the
   * blades stand on top; higher up in a tall patch the voxels are only the blades. They
   * bend in the wind (its strength and direction, gusts running through), more at their tips.
   */
  buildGrass(w, voxels) {
    const h = w.h;
    const cards = 1;
    const H = Math.min(h * 1.4, 0.55); // blades up to ~0.5 m
    const geo = grassTuft(H, h);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xffffff, side: THREE.DoubleSide, roughness: 0.85 });
    const U = this.windU;
    U.uCardH.value = H;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime, uWindStr, uCardH;\nuniform vec2 uWindDir;')
        .replace('#include <project_vertex>', () => WIND_GLSL);
    };
    mat.customProgramCacheKey = () => 'grass-wind-v1';
    const turf = (i) => {
      const [x, y, z] = w.coords(i);
      if (y === 0) return true;
      const b = w.idx(x, y - 1, z);
      return !w.mat[b] || MATERIALS[w.mat[b]].name !== 'grass';
    };
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, voxels.length * cards));
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, voxels.length * cards) * 3), 3);
    mesh.receiveShadow = true;
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    let n = 0;
    const isTurf = voxels.map(turf);
    for (const [j, i] of voxels.entries()) {
      const [x, y, z] = w.coords(i);
      // on the turf the blades stand on its top; in a patch they fill the voxel
      const y0 = isTurf[j] && H < h * 1.2 ? (y + 1) * h - h * 0.15 : y * h;
      for (let k = 0; k < cards; k++) {
        e.set((hash(i, k, 1) - 0.5) * 0.25, hash(i, k, 2) * Math.PI + k * (Math.PI / 3), 0, 'YXZ');
        pos.set((x + 0.1 + 0.8 * hash(i, k, 3)) * h, y0, (z + 0.1 + 0.8 * hash(i, k, 4)) * h);
        this.m.compose(pos, this.q.setFromEuler(e), one.set(1, 0.7 + 0.6 * hash(i, k, 5), 1));
        mesh.setMatrixAt(n++, this.m);
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    // the turf is the ground (drawn as a voxel); the rest is blades only
    voxels.forEach((i, j) => {
      if (isTurf[j]) w.flags[i] &= ~F_HIDDEN;
      else w.flags[i] |= F_HIDDEN;
    });
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

  /** The wind the grass bends in (m/s, towards +x / +z). */
  setWind(wx, wz) {
    const U = Math.hypot(wx, wz);
    this.windU.uWindStr.value = Math.min(1.25, U / 11);
    if (U > 1e-3) this.windU.uWindDir.value.set(wx / U, wz / U);
  }

  update(time) {
    this.windU.uTime.value = time;
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
