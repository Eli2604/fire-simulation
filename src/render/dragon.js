import * as THREE from 'three';
import { PLAN, bodyRadius, smoothGround, dragonZones, dragonWoundPoint } from '../ai/dragon.js';
import { splatTexture } from './blood.js';

/**
 * Draws the dragons from their simulated pose (ai/dragon.js: d.spine, d.head, legs from
 * the gait, wings from the wingbeat). Built on real animals:
 *
 *  - Skin like a fish: overlapping cycloid scales (each one's free edge facing the
 *    tail, growth rings on it, a lip where it lifts over the next row), painted on a
 *    canvas and bump mapped, over a countershaded body as on a tarpon or a carp: a
 *    dark back, metallic flanks, a pale belly. A wet clearcoat (fish mucus) and a
 *    thin-film iridescence, as on real scales. Along the back a fin of bony rays
 *    with skin between them; the tail ends in a fin above and below; gill covers
 *    behind the jaws.
 *  - Teeth after the great white shark (Carcharodon carcharias): flat triangular
 *    blades with serrated edges, broad in the upper jaw and narrow, more pointed in
 *    the lower, in two rows: the working row standing up and the replacement row
 *    folded back behind it.
 *  - The head and jaws of a big monitor lizard, slit-pupilled eyes under bony brows,
 *    a forked tongue that flicks out to taste the air.
 *  - Wings built like a bird's: arm, forearm and hand, folded in a Z on its back on
 *    the ground. Instead of feathers, long bony rays (as in a fish's fin) carry a
 *    skin; they fan out like flight feathers, the outer ones slotted apart at the tip
 *    like an eagle's primaries. On the upstroke the wrist flexes and the wing
 *    shortens; the ray tips bend with the air.
 *  - Four sprawling lizard legs: upper arm and thigh out to the side, elbows and
 *    knees bent, five clawed toes; feet planted on the ground through the stride, or
 *    gripping a wall when it climbs.
 *  - Its wounds: blood on the scales where a hit went in (d.stains, placed on its hit
 *    zones so they move with the body), fresh red, drying dark.
 */

const PALETTES = {
  bronze: { back: '#1d3830', flank: '#7d6d3e', belly: '#ddd6bd', fin: '#4f3a22', ray: '#1e140a', iris: ['#ffe06a', '#d88a14', '#5a2a04'] },
  tarpon: { back: '#1b2a3c', flank: '#b9c0c9', belly: '#f0f2f4', fin: '#5d6875', ray: '#1e252d', iris: ['#f4f0d0', '#c8b060', '#403418'] },
  koi: { back: '#7c1a0a', flank: '#e27a2a', belly: '#f6ecda', fin: '#c4561e', ray: '#4a1406', iris: ['#fff0a0', '#e0a020', '#603008'] },
};
const lin = (hex) => new THREE.Color(hex); // three converts sRGB hex to linear

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** The scale pattern: colour (luminance) and height maps, 8 x 8 scales, tiling both ways. */
function scaleTextures() {
  const N = 512;
  const cols = 8;
  const rows = 8;
  const cw = N / cols;
  const rh = N / rows;
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = c.height = N;
    return c;
  };
  const cc = mk();
  const hc = mk();
  const g = cc.getContext('2d');
  const h = hc.getContext('2d');
  g.fillStyle = '#7a7a7a';
  g.fillRect(0, 0, N, N);
  h.fillStyle = '#000';
  h.fillRect(0, 0, N, N);
  const r = rh * 0.86;
  // tail-wards (+x) scales first: the ones nearer the head lie over them
  for (let i = cols + 1; i >= -2; i--) {
    const im = ((i % cols) + cols) % cols;
    for (let j = -2; j <= rows + 1; j++) {
      const jm = ((j % rows) + rows) % rows;
      const cx = (i + 0.5) * cw;
      const cy = (j + 0.5 + (im & 1) * 0.5) * rh;
      // a little variation per scale (the same on every repeat of the tile)
      const vary = Math.sin(im * 12.9898 + jm * 78.233) * 43758.5453;
      const v = (vary - Math.floor(vary) - 0.5) * 0.12;
      const L = (x) => `rgb(${Math.round(255 * Math.min(1, x + v))},${Math.round(255 * Math.min(1, x + v))},${Math.round(255 * Math.min(1, x + v))})`;
      // colour: darker where it dips under the row in front, bright towards the free edge
      const gr = g.createRadialGradient(cx + r * 0.25, cy - r * 0.15, r * 0.1, cx, cy, r);
      gr.addColorStop(0, L(0.98));
      gr.addColorStop(0.7, L(0.86));
      gr.addColorStop(1, L(0.62));
      g.fillStyle = gr;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.fill();
      // growth rings (circuli) on the exposed part
      g.strokeStyle = L(0.74);
      g.lineWidth = 1;
      for (const f of [0.45, 0.62, 0.78]) {
        g.beginPath();
        g.arc(cx - r * 0.25, cy, r * f, -1.1, 1.1);
        g.stroke();
      }
      // the free edge: a bright lip and the dark gap under it
      g.strokeStyle = L(1.0);
      g.lineWidth = 2;
      g.beginPath();
      g.arc(cx, cy, r - 2.5, -1.45, 1.45);
      g.stroke();
      g.strokeStyle = 'rgb(40,40,40)';
      g.lineWidth = 2.5;
      g.beginPath();
      g.arc(cx, cy, r, -1.5, 1.5);
      g.stroke();
      // height: rising towards the free edge, then the step down to the next scale
      const hg = h.createLinearGradient(cx - r, cy, cx + r, cy);
      hg.addColorStop(0, '#202020');
      hg.addColorStop(0.75, '#c8c8c8');
      hg.addColorStop(1, '#ffffff');
      h.fillStyle = hg;
      h.beginPath();
      h.arc(cx, cy, r, 0, Math.PI * 2);
      h.fill();
      h.strokeStyle = '#000';
      h.lineWidth = 2.5;
      h.beginPath();
      h.arc(cx, cy, r, -1.5, 1.5);
      h.stroke();
    }
  }
  const tex = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: tex(cc, true), bump: tex(hc, false) };
}

/** A reptile's eye: a gold iris with fibres and a vertical slit pupil, centred on +x of a sphere. */
function eyeTexture(iris) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#1a1206';
  g.fillRect(0, 0, 256, 128);
  const cx = 128;
  const cy = 64;
  const R = 30;
  const gr = g.createRadialGradient(cx, cy, 2, cx, cy, R);
  gr.addColorStop(0, iris[0]);
  gr.addColorStop(0.6, iris[1]);
  gr.addColorStop(1, iris[2]);
  g.fillStyle = gr;
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(80,40,0,0.35)';
  for (let k = 0; k < 60; k++) {
    const a = (k / 60) * Math.PI * 2;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * 6, cy + Math.sin(a) * 6);
    g.lineTo(cx + Math.cos(a + 0.1) * R, cy + Math.sin(a + 0.1) * R);
    g.stroke();
  }
  g.fillStyle = '#000';
  g.beginPath();
  g.ellipse(cx, cy, 3.2, R * 0.92, 0, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A tube along points with a radius tapering from r0 to r1. */
function taperTube(points, r0, r1, radial = 8, seg = 10) {
  const curve = new THREE.CatmullRomCurve3(points);
  const g = new THREE.TubeGeometry(curve, seg, 1, radial, false);
  const pos = g.attributes.position;
  for (let i = 0; i <= seg; i++) {
    const c = curve.getPointAt(i / seg);
    const r = r0 + (r1 - r0) * (i / seg);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      _v.fromBufferAttribute(pos, k).sub(c).multiplyScalar(r).add(c);
      pos.setXYZ(k, _v.x, _v.y, _v.z);
    }
  }
  g.computeVertexNormals();
  return g;
}

/** A shark tooth: a flat serrated triangle, base at y = 0, point at y = h, blade in the yz plane, curving back (-z). */
function toothGeometry(h, ratio) {
  const bw = h * ratio;
  const s = new THREE.Shape();
  const n = 8;
  const edge = (ax, ay, bx, by, out) => {
    const L = Math.hypot(bx - ax, by - ay);
    const nx = ((by - ay) / L) * out;
    const ny = (-(bx - ax) / L) * out;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const o = i % 2 ? 0.045 * bw : 0;
      s.lineTo(ax + (bx - ax) * t + nx * o, ay + (by - ay) * t + ny * o);
    }
  };
  s.moveTo(-bw / 2, 0);
  edge(-bw / 2, 0, 0.04 * bw, h, -1);
  edge(0.04 * bw, h, bw / 2, 0, -1);
  s.quadraticCurveTo(0, -0.12 * bw, -bw / 2, 0);
  const depth = 0.18 * bw;
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.05 * bw, bevelSize: 0.03 * bw, bevelSegments: 1, curveSegments: 3 });
  g.translate(0, 0, -depth / 2);
  g.rotateY(Math.PI / 2); // the blade along the jaw
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setZ(i, p.getZ(i) - 0.22 * h * (Math.max(0, y) / h) ** 2);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * A loft along +z: `ring(z)` gives a closed outline [[x, y], ...] (the same number of
 * points at every station). `mat(j)` picks the material group of the face after point j.
 */
function loft(zs, ring, mat = () => 0, uvScale = 1) {
  const pos = [];
  const uv = [];
  const rings = zs.map((z) => ring(z));
  const n = rings[0].length;
  zs.forEach((z, i) => {
    for (let j = 0; j <= n; j++) {
      const [x, y] = rings[i][j % n];
      pos.push(x, y, z);
      uv.push((z / uvScale) * 1.0, (j / n) * 4);
    }
  });
  const groups = new Map();
  for (let i = 0; i < zs.length - 1; i++)
    for (let j = 0; j < n; j++) {
      const a = i * (n + 1) + j;
      const b = a + n + 1;
      const m = mat(j);
      if (!groups.has(m)) groups.set(m, []);
      groups.get(m).push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const idx = [];
  for (const [m, list] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    g.addGroup(idx.length, list.length, m);
    idx.push(...list);
  }
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Vertex colours by how a surface faces: the back colour on top, the belly colour below. */
function countershade(g, pal, lift = 0) {
  const n = g.attributes.normal;
  const col = new Float32Array(n.count * 3);
  const back = lin(pal.back);
  const flank = lin(pal.flank);
  const belly = lin(pal.belly);
  const c = new THREE.Color();
  for (let i = 0; i < n.count; i++) {
    const y = Math.max(-1, Math.min(1, n.getY(i) + lift));
    if (y > 0.25) c.copy(flank).lerp(back, Math.min(1, (y - 0.25) / 0.55));
    else c.copy(flank).lerp(belly, Math.min(1, (0.25 - y) / 0.75));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** A unit limb segment along +y (base radius r0, end radius r1); scaled in y to its length. */
function segmentGeometry(r0, r1, pal) {
  const g = new THREE.CylinderGeometry(r1, r0, 1, 12, 1, true);
  g.translate(0, 0.5, 0);
  g.attributes.uv.array.forEach((v, i, a) => (a[i] = v * (i % 2 ? 1 : 3)));
  return countershade(g, pal, 0.3);
}

export class DragonRenderer {
  constructor(scene, flames) {
    this.scene = scene;
    this.flames = flames;
    this.figures = [];
    this.tex = null;
  }

  /** Materials for one colour scheme (shared by the dragons that wear it). */
  materials(name) {
    this.mats ??= {};
    if (this.mats[name]) return this.mats[name];
    const pal = PALETTES[name] ?? PALETTES.bronze;
    this.tex ??= scaleTextures();
    const skin = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      map: this.tex.map,
      bumpMap: this.tex.bump,
      bumpScale: 2.2,
      roughness: 0.38,
      metalness: 0.35,
      clearcoat: 0.6,
      clearcoatRoughness: 0.28,
      iridescence: 0.6,
      iridescenceIOR: 1.4,
      iridescenceThicknessRange: [160, 460],
    });
    // the body: as the skin, plus the throat glowing through the scales before it breathes fire
    const body = skin.clone();
    body.userData.glow = { value: 0 };
    body.onBeforeCompile = (sh) => {
      sh.uniforms.uGlow = body.userData.glow;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vGlow;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uGlow;\nvarying float vGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.32, 0.04) * vGlow * uGlow * 6.0;');
    };
    body.customProgramCacheKey = () => 'dragon-body';
    const fin = new THREE.MeshPhysicalMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.1, clearcoat: 0.4, clearcoatRoughness: 0.4, iridescence: 0.5, iridescenceIOR: 1.35, sheen: 0.6, sheenColor: lin(pal.flank) });
    const mouth = new THREE.MeshStandardMaterial({ color: 0x5a1412, roughness: 0.32, side: THREE.DoubleSide });
    const tooth = new THREE.MeshPhysicalMaterial({ color: 0xf2ead2, roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.15 });
    const claw = new THREE.MeshStandardMaterial({ color: 0x1c1712, roughness: 0.35, metalness: 0.1 });
    const horn = new THREE.MeshStandardMaterial({ color: 0x2a221a, roughness: 0.55 });
    const tongue = new THREE.MeshStandardMaterial({ color: 0x4a2f52, roughness: 0.25, side: THREE.DoubleSide });
    const eyeTex = eyeTexture(pal.iris);
    const eye = new THREE.MeshPhysicalMaterial({ map: eyeTex, emissiveMap: eyeTex, emissive: 0x6a4a10, emissiveIntensity: 0.6, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02 });
    return (this.mats[name] = { pal, skin, body, fin, mouth, tooth, claw, horn, tongue, eye });
  }

  mesh(geo, mat, parent) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  /** Build the meshes of one dragon (body size k). */
  figure(d) {
    const k = d.k;
    const M = this.materials(d.colours);
    const pal = M.pal;
    const root = new THREE.Group();
    this.scene.add(root);
    const f = { root, k, M };

    // --- body tube (rebuilt every frame from the spine)
    const nSp = d.spine.length;
    const rings = (nSp - 1) * 2 + 1;
    const RS = 28;
    f.rings = rings;
    f.RS = RS;
    const nv = rings * (RS + 1);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    bg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const col = new Float32Array(nv * 3);
    const uv = new Float32Array(nv * 2);
    const glow = new Float32Array(nv);
    const ds = (PLAN.ds * k) / 2;
    const back = lin(pal.back);
    const flank = lin(pal.flank);
    const belly = lin(pal.belly);
    const c = new THREE.Color();
    for (let m = 0; m < rings; m++) {
      const s = m * ds;
      for (let j = 0; j <= RS; j++) {
        const th = (j / RS) * Math.PI * 2;
        const sn = Math.sin(th);
        const i = m * (RS + 1) + j;
        if (sn > 0.2) c.copy(flank).lerp(back, Math.min(1, (sn - 0.2) / 0.55));
        else c.copy(flank).lerp(belly, Math.min(1, (0.2 - sn) / 0.7));
        // a dark lateral line along the flanks, as on a fish
        if (Math.abs(sn - 0.12) < 0.08 && s > PLAN.neck * k && s < (PLAN.neck + PLAN.trunk + PLAN.tail * 0.8) * k) c.multiplyScalar(0.72);
        col[i * 3] = c.r;
        col[i * 3 + 1] = c.g;
        col[i * 3 + 2] = c.b;
        uv[i * 2] = s / (0.9 * k);
        uv[i * 2 + 1] = (j / RS) * 6;
        // the throat (under the neck) glows before the fire comes
        const sn2 = s / k;
        glow[i] = sn < 0.15 && sn2 > 0.1 && sn2 < 1.9 ? Math.min(1, (0.15 - sn) * 1.6) * Math.sin(Math.PI * Math.min(1, (sn2 - 0.1) / 1.8)) : 0;
      }
    }
    bg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    bg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    bg.setAttribute('glow', new THREE.BufferAttribute(glow, 1));
    const idx = [];
    for (let m = 0; m < rings - 1; m++)
      for (let j = 0; j < RS; j++) {
        const a = m * (RS + 1) + j;
        const b = a + RS + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    bg.setIndex(idx);
    f.body = this.mesh(bg, M.body, root);
    f.body.frustumCulled = false;
    f.frames = Array.from({ length: rings }, () => ({ p: new THREE.Vector3(), t: new THREE.Vector3(), u: new THREE.Vector3(), s: new THREE.Vector3(), rx: 0, ry: 0 }));

    // --- the dorsal fin, and the tail fin above and below (rebuilt every frame)
    const cg = new THREE.BufferGeometry();
    const nc = rings * 2 * 2;
    cg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nc * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const ccol = new Float32Array(nc * 3);
    const finC = lin(pal.fin);
    const rayC = lin(pal.ray);
    for (let m = 0; m < rings; m++)
      for (let side = 0; side < 2; side++) {
        const base = (side * rings + m) * 2;
        for (const [o, cc] of [[0, finC.clone().multiplyScalar(0.8)], [1, m % 2 ? finC : rayC]]) {
          ccol[(base + o) * 3] = cc.r;
          ccol[(base + o) * 3 + 1] = cc.g;
          ccol[(base + o) * 3 + 2] = cc.b;
        }
      }
    cg.setAttribute('color', new THREE.BufferAttribute(ccol, 3));
    const cidx = [];
    const s0 = Math.round((0.35 * k) / ds);
    const sv = Math.round((6.1 * k) / ds);
    for (let m = s0; m < rings - 1; m++) {
      const a = m * 2;
      cidx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
    for (let m = sv; m < rings - 1; m++) {
      const a = (rings + m) * 2;
      cidx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
    cg.setIndex(cidx);
    f.crest = this.mesh(cg, M.fin, root);
    f.crest.frustumCulled = false;

    // --- the head
    f.head = this.buildHead(M, k);
    root.add(f.head.g);

    // --- legs: upper and lower segment, joints, a foot with five clawed toes
    f.legs = [];
    for (const [front, side] of [[1, 1], [1, -1], [0, 1], [0, -1]]) {
      const a = (front ? 0.85 : 1.0) * k;
      const b = (front ? 0.75 : 0.85) * k;
      const r = front ? [0.17, 0.12, 0.12, 0.08] : [0.24, 0.14, 0.14, 0.09];
      const up = this.mesh(segmentGeometry(r[0] * k, r[1] * k, pal), M.skin, root);
      const lo = this.mesh(segmentGeometry(r[2] * k, r[3] * k, pal), M.skin, root);
      const joint = this.mesh(countershade(new THREE.SphereGeometry(r[1] * k, 12, 10), pal, 0.3), M.skin, root);
      const hipJ = this.mesh(countershade(new THREE.SphereGeometry(r[0] * k, 12, 10), pal, 0.3), M.skin, root);
      const foot = this.buildFoot(M, k, front, side);
      root.add(foot);
      // the gait: diagonal pairs (left front with right hind) step together
      const phase = (front ? 0 : 0.5) + (side > 0 ? 0 : 0.5);
      f.legs.push({ front, side, a, b, up, lo, joint, hipJ, foot, phase: phase % 1, plant: null });
    }
    for (const m of [...f.legs.flatMap((l) => [l.up, l.lo])]) m.frustumCulled = false;

    // --- wings: bones and a skin on fin rays
    f.wings = [1, -1].map((side) => this.buildWing(M, k, side, root));

    // --- the fire: a light at the mouth
    f.fireLight = new THREE.PointLight(0xff8a2a, 0, 30 * k, 1.6);
    root.add(f.fireLight);

    // --- wounds: blood on the scales (splashes on the skin, up to 40)
    this.stainTex ??= splatTexture('blood');
    const sm = new THREE.MeshStandardMaterial({ map: this.stainTex, alphaMap: this.stainTex, transparent: true, depthWrite: false, roughness: 0.3, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide });
    f.stains = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), sm, 40);
    f.stains.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(40 * 3), 3);
    f.stains.count = 0;
    f.stains.frustumCulled = false;
    f.stains.renderOrder = 2;
    root.add(f.stains);
    return f;
  }

  buildHead(M, k) {
    const L = PLAN.head * k;
    const pal = M.pal;
    const g = new THREE.Group();
    // upper head: cranium, cheeks, a long snout (lofted along +z)
    const prof = [
      [0, 0.3, 0.3, -0.12],
      [0.2, 0.32, 0.28, -0.1],
      [0.35, 0.27, 0.22, -0.08],
      [0.6, 0.18, 0.15, -0.06],
      [0.85, 0.13, 0.11, -0.05],
      [0.97, 0.08, 0.08, -0.045],
      [1.0, 0.03, 0.05, -0.04],
    ];
    const at = (zf) => {
      for (let i = 1; i < prof.length; i++)
        if (zf <= prof[i][0]) {
          const a = prof[i - 1];
          const b = prof[i];
          const t = (zf - a[0]) / (b[0] - a[0]);
          return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t].map((v) => v * k);
        }
      return prof[prof.length - 1].slice(1).map((v) => v * k);
    };
    const zs = [];
    for (let i = 0; i <= 24; i++) zs.push((i / 24) * L);
    const N = 32;
    const upper = loft(zs, (z) => {
      const [w, t, b] = at(z / L);
      const pts = [];
      for (let j = 0; j < N; j++) {
        const ph = (j / N) * Math.PI * 2;
        const c = Math.cos(ph);
        const s = Math.sin(ph);
        // a flat palate below, a domed skull above; a ridge over the snout
        pts.push([w * c, s >= 0 ? b + (t - b) * Math.pow(s, 0.7) * (1 + 0.06 * Math.exp(-((c / 0.25) ** 2))) : b + 0.012 * k * s]);
      }
      return pts;
    }, () => 0, 0.5 * k);
    countershade(upper, pal, -0.15);
    this.mesh(upper, M.skin, g);
    // the palate (the roof of the mouth)
    const pal0 = [];
    for (let i = 4; i <= 23; i++) {
      const z = (i / 24) * L;
      const [w, , b] = at(z / L);
      pal0.push(new THREE.Vector3(-w * 0.86, b - 0.004 * k, z), new THREE.Vector3(w * 0.86, b - 0.004 * k, z));
    }
    const pg = new THREE.BufferGeometry().setFromPoints(pal0);
    const pidx = [];
    for (let i = 0; i < pal0.length / 2 - 1; i++) pidx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
    pg.setIndex(pidx);
    pg.computeVertexNormals();
    this.mesh(pg, M.mouth, g);
    // brows, nostrils, eyes, gill covers, horns
    for (const sx of [-1, 1]) {
      const brow = this.mesh(countershade(new THREE.SphereGeometry(1, 16, 10), pal, 0.2), M.skin, g);
      brow.scale.set(0.085 * k, 0.05 * k, 0.2 * L);
      brow.position.set(sx * 0.19 * k, 0.205 * k, 0.33 * L);
      brow.rotation.z = sx * 0.35;
      const nos = this.mesh(new THREE.SphereGeometry(0.022 * k, 8, 6), M.claw, g);
      nos.position.set(sx * 0.04 * k, 0.07 * k, 0.955 * L);
      nos.scale.set(1, 0.6, 1.4);
      const eye = this.mesh(new THREE.SphereGeometry(0.068 * k, 24, 16), M.eye, g);
      eye.position.set(sx * 0.215 * k, 0.15 * k, 0.32 * L);
      eye.rotation.y = sx > 0 ? -0.35 : Math.PI + 0.35;
      // gill cover (operculum) behind the jaw, as on a fish
      const gill = this.mesh(countershade(new THREE.SphereGeometry(0.3 * k, 18, 10, -Math.PI * 0.3, Math.PI * 0.6, Math.PI * 0.25, Math.PI * 0.5), pal, -0.1), M.skin, g);
      gill.position.set(sx * 0.02 * k, -0.02 * k, 0.03 * L);
      gill.scale.set(sx, 0.9, 0.8);
      gill.rotation.y = sx > 0 ? Math.PI / 2 - 0.1 : -Math.PI / 2 + 0.1;
      gill.userData.side = sx;
      (g.userData.gills ??= []).push(gill);
      // swept-back horns from behind the brows
      const hg = taperTube([new THREE.Vector3(sx * 0.15 * k, 0.24 * k, 0.12 * L), new THREE.Vector3(sx * 0.2 * k, 0.36 * k, -0.08 * L), new THREE.Vector3(sx * 0.24 * k, 0.42 * k, -0.35 * L), new THREE.Vector3(sx * 0.26 * k, 0.4 * k, -0.6 * L)], 0.06 * k, 0.006 * k, 8, 12);
      this.mesh(hg, M.horn, g);
    }
    // upper teeth, both rows
    const broad = toothGeometry(0.1 * k, 0.62);
    const upperT = broad.clone().rotateZ(Math.PI);
    const narrow = toothGeometry(0.1 * k, 0.42);
    const n = 13;
    for (const sx of [-1, 1])
      for (let i = 0; i < n; i++) {
        const fr = i / (n - 1);
        for (const row of [0, 1]) {
          const z = (0.36 + 0.6 * (fr + row * 0.5 / n)) * L;
          if (z > 0.97 * L) continue;
          const [w, , b] = at(z / L);
          const t = this.mesh(upperT, M.tooth, g);
          const sc = (0.5 + 0.5 * fr) * (row ? 0.82 : 1);
          t.scale.setScalar(sc);
          t.position.set(sx * (w * 0.88 - row * 0.05 * k), b + 0.004 * k, z);
          t.rotation.set(row ? 0.6 : 0.05, sx * 0.08, -sx * 0.06);
        }
      }
    for (const sx of [-1, 1]) {
      const t = this.mesh(upperT, M.tooth, g);
      t.position.set(sx * 0.03 * k, at(0.985)[2], 0.975 * L);
      t.scale.setScalar(0.9);
    }
    // the lower jaw, hinged behind the eye
    const jaw = new THREE.Group();
    const hingeZ = 0.1 * L;
    jaw.position.set(0, at(0.1)[2] - 0.015 * k, hingeZ);
    g.add(jaw);
    const Lj = 0.87 * L;
    const th = 0.04 * k;
    const jzs = [];
    for (let i = 0; i <= 20; i++) jzs.push((i / 20) * Lj);
    const NO = 16;
    const NI = 10;
    const lower = loft(jzs, (z) => {
      const zf = Math.min(1, (z + hingeZ) / L);
      const wl = at(zf)[0] * 0.93 * (z > Lj * 0.97 ? 0.5 : 1);
      const dl = (0.16 - 0.1 * (z / Lj)) * k;
      const pts = [];
      for (let a = 0; a <= NO; a++) {
        const an = (Math.PI * a) / NO;
        pts.push([wl * Math.cos(an), -dl * Math.sin(an)]);
      }
      for (let a = 0; a < NI; a++) {
        const an = Math.PI * (1 - a / (NI - 1));
        pts.push([(wl - th) * Math.cos(an), -(dl - th) * 0.75 * Math.sin(an)]);
      }
      return pts;
    }, (j) => (j >= NO + 1 && j < NO + NI ? 1 : 0), 0.5 * k);
    countershade(lower, pal, -0.6);
    const lm = new THREE.Mesh(lower, [M.skin, M.mouth]);
    lm.castShadow = lm.receiveShadow = true;
    jaw.add(lm);
    for (const sx of [-1, 1])
      for (let i = 0; i < 12; i++) {
        const fr = i / 11;
        for (const row of [0, 1]) {
          const z = (0.3 + 0.64 * (fr + row * 0.5 / 12)) * Lj;
          if (z > 0.96 * Lj) continue;
          const wl = at(Math.min(1, (z + hingeZ) / L))[0] * 0.93;
          const t = this.mesh(narrow, M.tooth, jaw);
          t.scale.setScalar((0.55 + 0.45 * fr) * (row ? 0.8 : 0.95));
          t.position.set(sx * (wl - th * 0.5 - row * 0.045 * k), 0.002 * k, z);
          t.rotation.set(row ? -0.6 : -0.05, sx * 0.08, sx * 0.06);
        }
      }
    // the forked tongue, lying in the floor of the mouth
    const ts = new THREE.Shape();
    const tl = 0.75 * L;
    const tw = 0.05 * k;
    ts.moveTo(-tw, 0);
    ts.lineTo(-tw * 0.6, tl * 0.8);
    ts.lineTo(-tw * 0.9, tl);
    ts.lineTo(0, tl * 0.84);
    ts.lineTo(tw * 0.9, tl);
    ts.lineTo(tw * 0.6, tl * 0.8);
    ts.lineTo(tw, 0);
    const tg = new THREE.ShapeGeometry(ts);
    tg.rotateX(Math.PI / 2);
    const tongue = this.mesh(tg, M.tongue, jaw);
    tongue.position.set(0, -0.06 * k, 0.05 * Lj);
    return { g, jaw, tongue, L, Lj };
  }

  buildFoot(M, k, front, side) {
    const g = new THREE.Group();
    const palm = this.mesh(countershade(new THREE.SphereGeometry(1, 14, 10), M.pal, 0.4), M.skin, g);
    palm.scale.set(0.13 * k, 0.055 * k, 0.15 * k);
    palm.position.y = 0.05 * k;
    const angles = [-0.95, -0.45, 0, 0.42, 0.85];
    const lens = front ? [0.16, 0.24, 0.28, 0.25, 0.17] : [0.18, 0.26, 0.32, 0.38, 0.2];
    angles.forEach((a0, i) => {
      const a = a0 * side;
      const L = lens[i] * k;
      const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
      const p0 = dir.clone().multiplyScalar(0.07 * k).setY(0.05 * k);
      const p1 = dir.clone().multiplyScalar(0.07 * k + L * 0.55).setY(0.05 * k);
      const p2 = dir.clone().multiplyScalar(0.07 * k + L).setY(0.025 * k);
      this.mesh(taperTube([p0, p1, p2], 0.035 * k, 0.022 * k, 7, 6), M.skin, g);
      // a hooked claw
      const c0 = p2.clone();
      const c1 = dir.clone().multiplyScalar(0.07 * k + L + 0.06 * k).setY(0.02 * k);
      const c2 = dir.clone().multiplyScalar(0.07 * k + L + 0.1 * k).setY(-0.01 * k);
      this.mesh(taperTube([c0, c1, c2], 0.02 * k, 0.002 * k, 6, 6), M.claw, g);
    });
    return g;
  }

  buildWing(M, k, side, root) {
    const segs = [
      [0.1, 0.07, 1.5],
      [0.07, 0.045, 1.8],
      [0.045, 0.025, 1.1],
    ].map(([r0, r1, len]) => {
      const m = this.mesh(segmentGeometry(r0 * k, r1 * k, M.pal), M.skin, root);
      m.frustumCulled = false;
      return { m, len: len * k };
    });
    // joints only as thick as the bones (no knobs)
    const joints = [0.1, 0.07, 0.045].map((r) => this.mesh(countershade(new THREE.SphereGeometry(r * k, 10, 8), M.pal, 0.3), M.skin, root));
    // the thumb claw at the wrist
    const thumb = this.mesh(taperTube([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.05 * k, 0.1 * k), new THREE.Vector3(0, 0.01 * k, 0.18 * k)], 0.03 * k, 0.003 * k, 6, 6), M.claw, root);
    // rays: [bone, position along it, length, spread direction (out, up, fwd)]
    const rays = [];
    [0.3, 0.6, 0.92].forEach((fr, i) => rays.push([0, fr, [1.1, 1.4, 1.65][i], [0.05, 0, -1]]));
    for (let i = 0; i < 7; i++) rays.push([1, 0.08 + (0.92 * i) / 6, 1.75 + 0.05 * i, [0.04 + 0.05 * i, 0, -1]]);
    for (let i = 0; i < 8; i++) {
      const t = i / 7;
      const a = 0.35 + t * 1.15; // fanning from back-out to out along the hand
      rays.push([2, 0.06 + 0.94 * t, 2.0 + 0.55 * t, [Math.sin(a), 0, -Math.cos(a)]]);
    }
    // the skin between the rays: 3 columns (ray, between, ray) x 5 rows per pair
    const NR = rays.length;
    const per = 15;
    const nvM = (NR - 1) * per + 3;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nvM * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const col = new Float32Array(nvM * 3);
    const finC = lin(M.pal.fin);
    const rayC = lin(M.pal.ray);
    const idx = [];
    for (let p = 0; p < NR - 1; p++) {
      for (let r = 0; r < 5; r++)
        for (let c = 0; c < 3; c++) {
          const i = p * per + r * 3 + c;
          const cc = c === 1 ? finC.clone().multiplyScalar(1 + 0.15 * (r / 4)) : rayC.clone().lerp(finC, 0.25);
          if (r === 4) cc.multiplyScalar(0.7);
          col[i * 3] = cc.r;
          col[i * 3 + 1] = cc.g;
          col[i * 3 + 2] = cc.b;
        }
      for (let r = 0; r < 4; r++)
        for (let c = 0; c < 2; c++) {
          const a = p * per + r * 3 + c;
          idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
        }
    }
    const pb = (NR - 1) * per;
    for (let c = 0; c < 3; c++) {
      col[(pb + c) * 3] = finC.r * 0.85;
      col[(pb + c) * 3 + 1] = finC.g * 0.85;
      col[(pb + c) * 3 + 2] = finC.b * 0.85;
    }
    idx.push(pb, pb + 1, pb + 2);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    const skin = this.mesh(g, M.fin, root);
    skin.frustumCulled = false;
    return { side, segs, joints, thumb, rays, skin, geo: g };
  }

  // ---------------------------------------------------------------------------

  update(world, time, dt = 1 / 60) {
    const list = world?.dragons ?? [];
    while (this.figures.length > list.length) {
      const f = this.figures.pop();
      this.scene.remove(f.root);
    }
    list.forEach((d, n) => {
      if (!d.spine) return;
      let f = this.figures[n];
      if (!f || f.k !== d.k || f.M !== this.materials(d.colours) || f.rings !== (d.spine.length - 1) * 2 + 1) {
        if (f) this.scene.remove(f.root);
        f = this.figures[n] = this.figure(d);
      }
      this.pose(f, d, world, time, dt);
    });
  }

  /** The body: points along the spine (doubled, Catmull-Rom), each with a frame, and the tube round them. */
  poseBody(f, d) {
    const k = d.k;
    const P = d.spine;
    const n = P.length;
    const F = f.frames;
    const get = (i) => P[Math.max(0, Math.min(n - 1, i))];
    for (let i = 0; i < n; i++) {
      F[i * 2].p.set(...P[i]);
      if (i < n - 1) {
        const p0 = get(i - 1);
        const p1 = P[i];
        const p2 = P[i + 1];
        const p3 = get(i + 2);
        F[i * 2 + 1].p.set(...[0, 1, 2].map((c) => 0.5 * p1[c] + 0.5 * p2[c] + 0.125 * (p1[c] - p0[c]) + 0.125 * (p2[c] - p3[c]) - 0.0 * p0[c]));
      }
    }
    const R = f.rings;
    for (let m = 0; m < R; m++) {
      const a = F[Math.max(0, m - 1)].p;
      const b = F[Math.min(R - 1, m + 1)].p;
      F[m].t.subVectors(a, b).normalize(); // towards the head
    }
    // up: from the chest, carried along the body (parallel transport), so it stays
    // right on a wall and over an edge; then rolled by the bank
    const ic = d.iShoulder * 2;
    const fc = F[ic];
    const facing = _v.set(Math.sin(d.yaw), 0, Math.cos(d.yaw));
    const vert = Math.abs(fc.t.y);
    const aW = Math.min(1, Math.max(0, (vert - 0.55) / 0.35));
    fc.u.copy(UP).multiplyScalar(1 - aW).addScaledVector(facing, -Math.sign(fc.t.y || 1) * aW);
    fc.u.addScaledVector(fc.t, -fc.u.dot(fc.t)).normalize();
    for (let m = ic + 1; m < R; m++) F[m].u.copy(F[m - 1].u).addScaledVector(F[m].t, -F[m - 1].u.dot(F[m].t)).normalize();
    for (let m = ic - 1; m >= 0; m--) F[m].u.copy(F[m + 1].u).addScaledVector(F[m].t, -F[m + 1].u.dot(F[m].t)).normalize();
    for (let m = 0; m < R; m++) {
      const fr = F[m];
      const roll = (d.rolls[Math.floor(m / 2)] + d.rolls[Math.ceil(m / 2)]) / 2;
      fr.s.crossVectors(fr.u, fr.t).normalize();
      if (roll) {
        const cr = Math.cos(roll);
        const sr = Math.sin(roll);
        const ux = fr.u.x * cr + fr.s.x * sr;
        const uy = fr.u.y * cr + fr.s.y * sr;
        const uz = fr.u.z * cr + fr.s.z * sr;
        fr.u.set(ux, uy, uz);
        fr.s.crossVectors(fr.u, fr.t).normalize();
      }
      const [rx, ry] = bodyRadius((m * PLAN.ds) / 2);
      // breathing: the chest rises and falls
      const breathe = 1 + 0.025 * Math.sin((d.time ?? 0) * (d.state === 'rest' ? 1.4 : 3)) * Math.exp(-(((m / 2) * PLAN.ds - 2.6) ** 2));
      fr.rx = rx * k * breathe;
      fr.ry = ry * k * breathe;
    }
    const pos = f.body.geometry.attributes.position.array;
    const nor = f.body.geometry.attributes.normal.array;
    const RS = f.RS;
    for (let m = 0; m < R; m++) {
      const fr = F[m];
      for (let j = 0; j <= RS; j++) {
        const th = (j / RS) * Math.PI * 2;
        const c = Math.cos(th);
        const s = Math.sin(th);
        const fy = s < 0 ? 0.85 : 1; // a flatter belly
        const x = fr.rx * c;
        const y = fr.ry * fy * s;
        let nx = c / fr.rx;
        let ny = s / (fr.ry * fy);
        const nl = Math.hypot(nx, ny);
        nx /= nl;
        ny /= nl;
        const i = (m * (RS + 1) + j) * 3;
        pos[i] = fr.p.x + fr.s.x * x + fr.u.x * y;
        pos[i + 1] = fr.p.y + fr.s.y * x + fr.u.y * y;
        pos[i + 2] = fr.p.z + fr.s.z * x + fr.u.z * y;
        nor[i] = fr.s.x * nx + fr.u.x * ny;
        nor[i + 1] = fr.s.y * nx + fr.u.y * ny;
        nor[i + 2] = fr.s.z * nx + fr.u.z * ny;
      }
    }
    f.body.geometry.attributes.position.needsUpdate = true;
    f.body.geometry.attributes.normal.needsUpdate = true;
    // the fins on the back and under the tail
    const cp = f.crest.geometry.attributes.position.array;
    const tailEnd = (PLAN.neck + PLAN.trunk + PLAN.tail) * k;
    for (let m = 0; m < R; m++) {
      const fr = F[m];
      const sn = (m * PLAN.ds) / 2;
      // fin height along the body (m at 9 m): low on the neck, a sail over the shoulders, a tail fin at the end
      const H = (sn < 1.8 ? 0.1 + 0.32 * (sn / 1.8) : sn < 4.2 ? 0.42 - 0.2 * ((sn - 1.8) / 2.4) : 0.22 + 0.33 * Math.max(0, (sn - 5.5) / 2.3) ** 1.5) * k * (m % 2 ? 0.72 : 1);
      const Hv = sn > 6.1 ? 0.42 * k * ((sn - 6.1) / 1.7) ** 1.2 * (m % 2 ? 0.72 : 1) : 0;
      const put = (side, sign, h) => {
        const i = (side * R + m) * 2 * 3;
        const bx = fr.p.x + fr.u.x * fr.ry * 0.9 * sign;
        const by = fr.p.y + fr.u.y * fr.ry * 0.9 * sign;
        const bz = fr.p.z + fr.u.z * fr.ry * 0.9 * sign;
        cp[i] = bx;
        cp[i + 1] = by;
        cp[i + 2] = bz;
        cp[i + 3] = bx + (fr.u.x * 0.88 * sign - fr.t.x * 0.47) * h;
        cp[i + 4] = by + (fr.u.y * 0.88 * sign - fr.t.y * 0.47) * h;
        cp[i + 5] = bz + (fr.u.z * 0.88 * sign - fr.t.z * 0.47) * h;
      };
      put(0, 1, H);
      put(1, -1, Hv);
    }
    void tailEnd;
    f.crest.geometry.attributes.position.needsUpdate = true;
    f.crest.geometry.computeVertexNormals();
  }

  pose(f, d, world, time, dt) {
    const k = d.k;
    this.poseBody(f, d);
    const F = f.frames;
    const M = f.M;
    // --- head
    const H = f.head;
    const { p, dir, up } = d.head;
    const zA = new THREE.Vector3(...dir);
    const yA = new THREE.Vector3(...up);
    const xA = new THREE.Vector3().crossVectors(yA, zA).normalize();
    yA.crossVectors(zA, xA);
    H.g.position.set(...p);
    H.g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xA, yA, zA));
    H.jaw.rotation.x = d.jaw * 0.85;
    H.tongue.position.z = 0.05 * H.Lj + d.tongue * 0.75 * H.L;
    H.tongue.visible = d.tongue > 0.02 || d.jaw > 0.25;
    for (const gl of H.g.userData.gills ?? []) gl.rotation.z = gl.userData.side * (0.05 + 0.08 * Math.max(0, Math.sin((d.time ?? 0) * 2)) + 0.25 * d.jaw);
    M.body.userData.glow.value = d.glow * (0.75 + 0.25 * Math.sin(time * 23)) + (d.hurtFlash > 0 ? 0.3 : 0);

    // --- legs
    const grounded = d.groundF;
    for (const L of f.legs) this.poseLeg(f, d, L, world, grounded);

    // --- wings
    for (const W of f.wings) this.poseWing(f, d, W);

    // --- fire
    const breathing = d.breathT > 0;
    const m = d.mouth;
    const fl = f.fireLight;
    if (breathing) {
      fl.position.set(m[0] + dir[0] * 2.5, m[1] + dir[1] * 2.5, m[2] + dir[2] * 2.5);
      fl.intensity = 45 * k * k * (0.8 + 0.2 * Math.sin(time * 31));
      if (this.flames) {
        const L = d.jetLen ?? 8;
        const n = Math.min(90, Math.round(220 * dt * 60 * 0.4));
        for (let i = 0; i < n; i++) {
          const sp = 14 + Math.random() * 7;
          const spread = 0.12 + Math.random() * 0.1;
          const vx = dir[0] * sp + (Math.random() - 0.5) * sp * spread;
          const vy = dir[1] * sp + (Math.random() - 0.5) * sp * spread;
          const vz = dir[2] * sp + (Math.random() - 0.5) * sp * spread;
          const o = Math.random() * 0.4;
          this.flames.spawn(m[0] + dir[0] * o, m[1] + dir[1] * o, m[2] + dir[2] * o, vx, vy, vz, Math.min(0.9, (L / sp) * (0.7 + Math.random() * 0.5)), (0.2 + Math.random() * 0.35) * k, 0, 1);
        }
        for (let i = 0; i < 4; i++) this.flames.spawn(m[0], m[1], m[2], dir[0] * 16 + (Math.random() - 0.5) * 6, dir[1] * 16 + Math.random() * 3, dir[2] * 16 + (Math.random() - 0.5) * 6, 1 + Math.random(), 0.02 * k, 1, 1);
      }
    } else if (d.windT > 0 || d.glow > 0.05) {
      // smoke and a few flames licking from the jaws as it winds up
      fl.position.set(m[0], m[1], m[2]);
      fl.intensity = 6 * k * k * d.glow;
      if (this.flames && Math.random() < 0.6) this.flames.spawn(m[0] + (Math.random() - 0.5) * 0.2 * k, m[1], m[2] + (Math.random() - 0.5) * 0.2 * k, dir[0] * 1.5, 0.8, dir[2] * 1.5, 0.3, 0.1 * k, 0, 0.6);
    } else fl.intensity = 0;
    this.poseStains(f, d, world);
    void F;
  }

  /** The blood on its scales where it was hit (on the hit zones, so it moves with the body). */
  poseStains(f, d, world) {
    const S = d.stains ?? [];
    const st = f.stains;
    st.count = 0;
    if (!S.length) return;
    const zones = dragonZones(d, world);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const n = new THREE.Vector3();
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const Z = new THREE.Vector3(0, 0, 1);
    const c = st.instanceColor.array;
    for (let i = 0; i < S.length && st.count < 40; i++) {
      const s = S[i];
      const at = dragonWoundPoint(d, s, world, zones);
      if (!at) continue;
      n.set(...at.n);
      q.setFromUnitVectors(Z, n).multiply(_q.setFromAxisAngle(Z, i * 2.4));
      p.set(...at.p).addScaledVector(n, 0.01 * d.k);
      const r = s.r * 2;
      m.compose(p, q, sc.set(r, r * 1.3, r));
      st.setMatrixAt(st.count, m);
      // fresh: bright red; drying dark over a few minutes
      const age = Math.min(1, Math.max(0, (world?.time ?? 0) - s.t) / 240);
      c[st.count * 3] = 0.42 - 0.26 * age;
      c[st.count * 3 + 1] = 0.02 + 0.03 * age;
      c[st.count * 3 + 2] = 0.02 + 0.02 * age;
      st.count++;
    }
    st.instanceMatrix.needsUpdate = true;
    st.instanceColor.needsUpdate = true;
  }

  /** A leg: the foot planted on the ground (or the wall) through the stride, swung forward between; 2-bone IK. */
  poseLeg(f, d, L, world, grounded) {
    const k = d.k;
    const F = f.frames;
    const gi = (L.front ? d.iShoulder : d.iHip) * 2;
    const fr = F[Math.min(F.length - 1, gi)];
    const out = fr.s.clone().multiplyScalar(L.side);
    const root = fr.p.clone().addScaledVector(out, fr.rx * 0.78).addScaledVector(fr.u, -fr.ry * 0.25);
    // horizontal forward and outward at the girdle
    const fwd = fr.t.clone();
    let foot;
    const onWall = d.mode === 'ground' && Math.abs(fr.t.y) > 0.5;
    if (grounded > 0.01 && !onWall) {
      const fh = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
      const oh = new THREE.Vector3(fh.z, 0, -fh.x).multiplyScalar(L.side * Math.sign(out.x * fh.z - out.z * fh.x || 1));
      const spread = (fr.rx + (0.55 + 0.25 * d.crouch) * k) * (L.front ? 1 : 1.05);
      const rest = root.clone().addScaledVector(oh, spread - fr.rx * 0.78).addScaledVector(fh, (L.front ? 0.3 : -0.05) * k);
      const moving = Math.min(1, d.speed / (0.6 * k));
      const stride = (1.3 + 0.12 * d.speed) * k * moving;
      const u = (((d.gait + L.phase) % 1) + 1) % 1;
      const duty = 0.62;
      let along;
      let lift = 0;
      if (u < duty) along = stride / 2 - (stride * u) / duty;
      else {
        const t = (u - duty) / (1 - duty);
        along = -stride / 2 + stride * t;
        lift = 0.3 * k * Math.sin(Math.PI * t) * moving;
      }
      rest.addScaledVector(fh, along);
      const gy = smoothGround(world, rest.x, rest.z, root.y + 0.5 * k);
      rest.y = gy + lift;
      foot = rest;
      // tucked in flight (and on the way there)
      if (grounded < 1) foot.lerp(this.tucked(fr, L, root, k), 1 - grounded);
    } else if (onWall) {
      // on a wall: the feet grip it, out to the sides and under the belly
      const u = (((d.gait + L.phase) % 1) + 1) % 1;
      const along = (u < 0.62 ? 0.35 - (0.7 * u) / 0.62 : -0.35 + (0.7 * (u - 0.62)) / 0.38) * k;
      foot = root.clone().addScaledVector(out, 0.55 * k).addScaledVector(fr.u, -(fr.ry + 0.15 * k)).addScaledVector(fwd, along + (L.front ? 0.3 : 0) * k);
    } else foot = this.tucked(fr, L, root, k);
    const ankle = foot.clone().addScaledVector(UP, 0.09 * k);
    // two-bone IK, the elbow/knee out and up (sprawling), elbows back, knees forward
    // (in flight the legs fold under the body: the joints point down and back)
    const pole = out.clone().multiplyScalar(grounded).addScaledVector(fr.u, 1.4 * grounded - 1).addScaledVector(fwd, L.front ? -0.35 - (1 - grounded) * 0.6 : 0.35 - (1 - grounded) * 0.8);
    const knee = ik(root, ankle, L.a, L.b, pole);
    place(L.up, root, knee);
    place(L.lo, knee, ankle);
    L.joint.position.copy(knee);
    L.hipJ.position.copy(root);
    L.foot.position.copy(foot);
    const fyaw = Math.atan2(fwd.x, fwd.z) + L.side * (L.front ? 0.35 : 0.2) * (fwd.x * out.z - fwd.z * out.x > 0 ? -1 : 1);
    if (onWall) L.foot.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), fwd, fr.u.clone().negate()).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)));
    else L.foot.rotation.set(0, fyaw, 0);
  }

  /** Where a foot goes in flight: the front ones folded under the chest, the hind ones trailing. */
  tucked(fr, L, root, k) {
    return root.clone().addScaledVector(fr.t, L.front ? -0.35 * k : -1.2 * k).addScaledVector(fr.u, L.front ? -0.5 * k : -0.25 * k).addScaledVector(fr.s, L.side * 0.05 * k);
  }

  /** A wing: bones by the fold and the wingbeat, rays fanned from them, the skin between. */
  poseWing(f, d, W) {
    const k = d.k;
    const F = f.frames;
    const fr = F[Math.min(F.length - 1, d.iShoulder * 2 + 2)];
    const out = fr.s.clone().multiplyScalar(W.side);
    const upV = fr.u;
    const fwd = fr.t;
    const W0 = fr.p.clone().addScaledVector(upV, fr.ry * 0.72).addScaledVector(out, fr.rx * 0.5);
    const toW = (o, u, z) => new THREE.Vector3().addScaledVector(out, o).addScaledVector(upV, u).addScaledVector(fwd, z);
    const ph = (d.flapPhase ?? 0) * Math.PI * 2;
    const amp = d.flapAmp ?? 0;
    const fold = Math.max(0, Math.min(1, d.fold ?? 0));
    const flex = amp * 0.4 * Math.max(0, -Math.sin(ph)); // upstroke: the wrist bends, the wing shortens
    const fl = d.flare ?? 0;
    const th = [0.12 + amp * 0.6 * Math.cos(ph), 0.08 + amp * 0.65 * Math.cos(ph - 0.35), 0.1 + amp * 0.75 * Math.cos(ph - 0.7)];
    const spread = [[1, 0.1, -0.15 + 0.3 * fl], [1, 0, 0.12 + 0.2 * fl], [1, -0.05, -0.1]];
    // folded in a Z against its flank, as a bird folds its wing
    const folded = [[0.3, 0.08, -1], [0.18, -0.06, 1], [0.12, -0.1, -1]];
    const fEff = [fold, Math.min(1, fold + flex * 0.6), Math.min(1, fold + flex)];
    const rot = (v, a) => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a), v[2]];
    const lerp3 = (a, b, t) => {
      const v = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      const l = Math.hypot(...v) || 1;
      return v.map((x) => x / l);
    };
    const pts = [W0];
    const dirs = [];
    for (let b = 0; b < 3; b++) {
      const loc = rot(lerp3(spread[b], folded[b], fEff[b]), th[b] * (1 - fold));
      dirs.push(loc);
      const dw = toW(...loc);
      pts.push(pts[b].clone().addScaledVector(dw, W.segs[b].len));
    }
    for (let b = 0; b < 3; b++) {
      place(W.segs[b].m, pts[b], pts[b + 1]);
      W.joints[b].position.copy(pts[b]);
    }
    W.thumb.position.copy(pts[2]);
    W.thumb.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), fwd.clone().negate(), upV));
    // rays and the skin between them
    const bend = 0.22 * amp * Math.sin(ph); // the air bends the ray tips up on the downstroke
    const pos = W.geo.attributes.position.array;
    const rayPts = W.rays.map(([b, fr0, len, sp]) => {
      const base = pts[b].clone().lerp(pts[b + 1], fr0);
      const loc = rot(lerp3(sp, [0.22, -0.4, -1], fEff[b] * 0.95), th[b] * (1 - fold)); // folded: the rays lie down along the flank
      const dw = toW(...loc);
      const nrm = toW(...rot([0, 1, 0], th[b] * (1 - fold)));
      const l = len * k * (1 - 0.3 * fEff[b]);
      return (t) => base.clone().addScaledVector(dw, l * t).addScaledVector(nrm, bend * l * t * t * (1 - fold));
    });
    const NR = W.rays.length;
    const slotFrom = NR - 5;
    for (let p = 0; p < NR - 1; p++) {
      for (let r = 0; r < 5; r++) {
        const t = r / 4;
        const A = rayPts[p](t);
        let B = rayPts[p + 1](t);
        // the outer primaries part at the tips (slots, as on an eagle's wing)
        if (p >= slotFrom && t > 0.55) {
          const w = A.distanceTo(B);
          const vane = Math.min(w, 0.16 * k * (1 - (t - 0.55)));
          B = A.clone().addScaledVector(B.sub(A).normalize(), vane);
        }
        const mid = A.clone().lerp(B, 0.5);
        const nrm = toW(...rot([0, 1, 0], th[1] * (1 - fold)));
        mid.addScaledVector(nrm, 0.05 * k * Math.sin(Math.PI * t) * (1 + amp * Math.sin(ph)) * (1 - fold));
        const i = (p * 15 + r * 3) * 3;
        for (const [c, v] of [[0, A], [1, mid], [2, B]]) {
          pos[i + c * 3] = v.x;
          pos[i + c * 3 + 1] = v.y;
          pos[i + c * 3 + 2] = v.z;
        }
      }
    }
    // the leading edge skin: shoulder, elbow, wrist
    const pb = (NR - 1) * 15 * 3;
    [pts[0], pts[1], pts[2]].forEach((v, c) => {
      pos[pb + c * 3] = v.x;
      pos[pb + c * 3 + 1] = v.y;
      pos[pb + c * 3 + 2] = v.z;
    });
    W.geo.attributes.position.needsUpdate = true;
    W.geo.computeVertexNormals();
    void dirs;
  }
}

/** The knee between root and end (lengths a, b), bending towards `pole`. */
function ik(root, end, a, b, pole) {
  const d = new THREE.Vector3().subVectors(end, root);
  let L = d.length();
  L = Math.max(Math.abs(a - b) + 1e-3, Math.min(a + b - 1e-3, L));
  d.normalize();
  const ca = (a * a + L * L - b * b) / (2 * a * L);
  const sa = Math.sqrt(Math.max(0, 1 - ca * ca));
  const po = pole.clone().addScaledVector(d, -pole.dot(d)).normalize();
  return root.clone().addScaledVector(d, a * ca).addScaledVector(po, a * sa);
}

/** Put a unit +y segment mesh between two points. */
function place(mesh, a, b) {
  _v.subVectors(b, a);
  const len = _v.length();
  mesh.position.copy(a);
  mesh.quaternion.copy(_q.setFromUnitVectors(UP, _v.normalize()));
  mesh.scale.set(1, Math.max(1e-3, len), 1);
}
