import * as THREE from 'three';
import { MATERIALS } from '../sim/materials.js';

/**
 * Surface relief for materials that are more than a colour (dressed limestone
 * with carved inscriptions). Two maps are painted procedurally on a canvas (no
 * image files): colour and height. They are mapped in world space, so a wall
 * reads as one continuous surface over many voxels (or over the smooth surface),
 * and the shader gives the height real depth:
 *
 *  - parallax occlusion mapping: the view ray is marched into the height field,
 *    so joints, chips and carved letters sit *in* the stone and shift with the
 *    viewing angle;
 *  - normal mapping from the height field: the torches, the helmet lamp and the
 *    fire light the relief correctly (a lit upper lip on each joint, shadowed
 *    letters).
 *
 * The texture modulates the voxel's own colour, so soot, charring, wetting and
 * heat glow still show on it. Bones in ossuary walls are real geometry (render/ossuary.js).
 */

export const PATTERNS = ['limestone', 'rock', 'gravel', 'deck', 'ashlar'];
const TILE = 1024; // px per tile
export const PATTERN_SIZE = 2.4; // metres covered by one tile
const RELIEF = 0.03; // m: depth of the deepest joint

/**
 * Photographed surfaces (CC0 scans from Poly Haven, polyhaven.com; files in render/photo/):
 * the colour and the normal map of each, mapped in world space on all three axes
 * (triplanar), size metres per tile (about the scan's real size, smaller where the
 * scene is seen close up). Loaded in the background; until then the voxels keep their
 * plain colours.
 */
export const PHOTOS = [
  { name: 'grass', file: 'aerial_grass_rock', size: 7 }, // Rob Tuytel
  { name: 'sand', file: 'coast_sand_01', size: 6 }, // Rob Tuytel
  { name: 'rocks', file: 'aerial_rocks_02', size: 12 }, // Rob Tuytel
  { name: 'basalt', file: 'dark_rock', size: 2.4 }, // Amal Kumar
  { name: 'ash', file: 'burned_ground_01', size: 2 }, // Rob Tuytel
];
export const PHOTO = Object.fromEntries(PHOTOS.map((p, k) => [p.name, k]));
const PHOTO_COLS = 4;
const PHOTO_ROWS = 2;
const PHOTO_TILE = 1024;

/** Pattern id (1-based, 0 = none) of every material id; the photos come after the patterns. */
export const PATTERN_OF_MAT = Uint8Array.from(MATERIALS, (m) => (m.pattern ? PATTERNS.indexOf(m.pattern) + 1 : m.photo ? PATTERNS.length + 1 + PHOTO[m.photo] : 0));

// shared by every material that uses the patterns (switched off in thermal view)
export const PATTERN_UNIFORMS = {
  uPatMap: { value: null },
  uPatHeight: { value: null },
  uPatOn: { value: 1 },
  uPatBase: { value: PATTERNS.map(() => new THREE.Vector3(0.5, 0.5, 0.5)) },
  uPhotoMap: { value: null },
  uPhotoNrm: { value: null },
  uPhotoOn: { value: 0 },
  uPhotoBase: { value: PHOTOS.map(() => new THREE.Vector3(0.216, 0.216, 0.216)) }, // (mid grey, linear)
  uPhotoSize: { value: PHOTOS.map((p) => p.size) },
};

let photos = null;

/** The photo atlases (colour, normal map), filled in as the images arrive. */
export function photoAtlas() {
  if (photos || typeof document === 'undefined' || typeof Image === 'undefined') return photos;
  const make = () => {
    const c = document.createElement('canvas');
    c.width = PHOTO_TILE * PHOTO_COLS;
    c.height = PHOTO_TILE * PHOTO_ROWS;
    return c;
  };
  const col = make();
  const nrm = make();
  const cc = col.getContext('2d', { willReadFrequently: true });
  const nc = nrm.getContext('2d');
  nc.fillStyle = 'rgb(128,128,255)';
  nc.fillRect(0, 0, nrm.width, nrm.height);
  // neutral until a photo arrives (its colour relative to its mean: 1)
  cc.fillStyle = 'rgb(128,128,128)';
  cc.fillRect(0, 0, col.width, col.height);
  const tex = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = 8;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  };
  photos = { col: tex(col, true), nrm: tex(nrm, false) };
  PATTERN_UNIFORMS.uPhotoMap.value = photos.col;
  PATTERN_UNIFORMS.uPhotoNrm.value = photos.nrm;
  let left = PHOTOS.length * 2;
  PHOTOS.forEach((p, k) => {
    const ox = (k % PHOTO_COLS) * PHOTO_TILE;
    const oy = Math.floor(k / PHOTO_COLS) * PHOTO_TILE;
    for (const kind of ['diff', 'nor']) {
      const img = new Image();
      img.onload = () => {
        if (kind === 'diff') {
          cc.drawImage(img, ox, oy, PHOTO_TILE, PHOTO_TILE);
          // its mean colour (linear): the photo is applied relative to it, on the voxel's own colour
          const d = cc.getImageData(ox, oy, PHOTO_TILE, PHOTO_TILE).data;
          const sum = [0, 0, 0];
          let n = 0;
          for (let i = 0; i < d.length; i += 4 * 41, n++) for (let j = 0; j < 3; j++) sum[j] += (d[i + j] / 255) ** 2.2;
          PATTERN_UNIFORMS.uPhotoBase.value[k].set(sum[0] / n, sum[1] / n, sum[2] / n);
          photos.col.needsUpdate = true;
        } else {
          nc.drawImage(img, ox, oy, PHOTO_TILE, PHOTO_TILE);
          photos.nrm.needsUpdate = true;
        }
        // on as soon as the first one is there (the others are neutral grey until they come)
        PATTERN_UNIFORMS.uPhotoOn.value = 1;
        left--;
      };
      img.onerror = () => left--;
      img.src = new URL(`./photo/${p.file}_${kind}.jpg`, import.meta.url).href;
    }
  });
  return photos;
}

/**
 * GLSL: triplanar sampling of photo pid at world position P (m), world normal N:
 * photoColour (relative to the photo's mean) and photoNormal. Uses PATTERN_UNIFORMS.
 */
export const PHOTO_GLSL = /* glsl */ `
uniform sampler2D uPhotoMap;
uniform sampler2D uPhotoNrm;
uniform float uPhotoOn;
uniform vec3 uPhotoBase[${PHOTOS.length}];
uniform float uPhotoSize[${PHOTOS.length}];
vec2 photoUV(vec2 q, int pid) {
  vec2 f = 0.004 + 0.992 * fract(q);
  float cx = float(pid - (pid / ${PHOTO_COLS}) * ${PHOTO_COLS});
  float cy = float(pid / ${PHOTO_COLS});
  // canvas row 0 is at the top of the texture (v = 1)
  return vec2((cx + f.x) / ${PHOTO_COLS}.0, 1.0 - (cy + f.y) / ${PHOTO_ROWS}.0);
}
vec3 photoW(vec3 N) { vec3 w = pow(abs(N), vec3(4.0)); return w / (w.x + w.y + w.z); }
vec4 photoTap(sampler2D t, vec2 q, int pid) {
  vec2 gx = dFdx(q) / vec2(${PHOTO_COLS}.0, ${PHOTO_ROWS}.0);
  vec2 gy = dFdy(q) / vec2(${PHOTO_COLS}.0, ${PHOTO_ROWS}.0);
  return textureGrad(t, photoUV(q, pid), gx, gy);
}
float photoSizeOf(int pid) { float s = uPhotoSize[0]; for (int k = 1; k < ${PHOTOS.length}; k++) if (k == pid) s = uPhotoSize[k]; return s; }
vec3 photoBaseOf(int pid) { vec3 b = uPhotoBase[0]; for (int k = 1; k < ${PHOTOS.length}; k++) if (k == pid) b = uPhotoBase[k]; return b; }
// linear colour of the photo relative to its mean (1 = average)
vec3 photoColour(int pid, vec3 P, vec3 N) {
  vec3 w = photoW(N);
  vec3 q = P / photoSizeOf(pid);
  vec3 c = photoTap(uPhotoMap, q.zy, pid).rgb * w.x + photoTap(uPhotoMap, q.xz, pid).rgb * w.y + photoTap(uPhotoMap, q.xy, pid).rgb * w.z;
  return c / max(photoBaseOf(pid), vec3(0.02));
}
// the surface normal N (world) bent by the photo's normal map
vec3 photoNormal(int pid, vec3 P, vec3 N, float strength) {
  vec3 w = photoW(N);
  vec3 q = P / photoSizeOf(pid);
  vec2 nx = (photoTap(uPhotoNrm, q.zy, pid).xy * 2.0 - 1.0) * strength;
  vec2 ny = (photoTap(uPhotoNrm, q.xz, pid).xy * 2.0 - 1.0) * strength;
  vec2 nz = (photoTap(uPhotoNrm, q.xy, pid).xy * 2.0 - 1.0) * strength;
  vec3 a = vec3(0.0, nx.y, nx.x) * sign(N.x);
  vec3 b = vec3(ny.x, 0.0, ny.y);
  vec3 c = vec3(nz.x, nz.y, 0.0) * sign(N.z);
  return normalize(N + a * w.x + b * w.y + c * w.z);
}
`;

let atlas = null;

/** Seeded random numbers, so the walls look the same every time. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Draw fn(x) at x and wrapped by one tile width, so the tile repeats seamlessly in x. */
function wrapX(x, w, fn) {
  fn(x);
  if (x + w > TILE) fn(x - TILE);
  if (x < 0) fn(x + TILE);
}

function mottle(ctx, ox, r, n, light, dark, size) {
  for (let k = 0; k < n; k++) {
    const x = ox + r() * TILE;
    const y = r() * TILE;
    const rad = size * (0.3 + r());
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, r() < 0.5 ? light : dark);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
}

function grain(ctx, ox, r, n, alpha, lo = 0, hi = 255) {
  for (let k = 0; k < n; k++) {
    const v = r() < 0.5 ? lo : hi;
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha * r()})`;
    ctx.fillRect(ox + r() * TILE, r() * TILE, 1 + r() * 2, 1 + r() * 2);
  }
}

const INSCRIPTIONS = ['MEMENTO MORI', 'HIC REQVIESCVNT', 'QVOD TV ES EGO FVI', 'ANNO MDCCLXXXVI', 'R · I · P', 'OSSA ARIDA', 'SILENTIVM', 'VANITAS', 'MDCCCX', 'IN PACE'];
const JOINT = 7; // px

/** The block layout of the limestone tile: courses of 0.3 m, blocks 0.4 - 0.95 m, some carved. */
function limestoneLayout(plain = false) {
  const r = rng(7);
  const course = TILE / 8;
  const blocks = [];
  for (let row = 0; row < 8; row++) {
    let x = r() * 200;
    const start = x;
    while (x < start + TILE) {
      const len = 180 + r() * 220;
      const end = Math.min(x + len, start + TILE);
      blocks.push({ x, y: row * course, w: end - x, h: course, row, tone: r() * 0.18 - 0.09, chip: r() < 0.45 ? [10 + r() * 16, 8 + r() * 14] : null, bulge: r() });
      x = end;
    }
  }
  // (ashlar: the same coursed blocks, none carved)
  const carved = plain ? [] : blocks.filter((b) => b.w > 300 && b.row % 2 === 1).slice(0, 6);
  carved.forEach((b, k) => (b.text = INSCRIPTIONS[(k * 5 + 3) % INSCRIPTIONS.length]));
  return blocks;
}

function inscribe(ctx, ox, b, fill, under) {
  const size = Math.min(54, (b.w * 1.4) / Math.max(4, b.text.length));
  ctx.font = `600 ${size}px "Times New Roman", Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cy = b.y + b.h / 2 + 3;
  wrapX(b.x, b.w, (x) => {
    const px = ox + x + b.w / 2;
    if (under) {
      ctx.fillStyle = under;
      ctx.fillText(b.text, px + 1.5, cy + 2);
    }
    ctx.fillStyle = fill;
    ctx.fillText(b.text, px, cy);
    ctx.strokeStyle = fill;
    ctx.lineWidth = 3;
    ctx.strokeRect(ox + x + 16, b.y + 16, b.w - 32, b.h - 28);
  });
}

/** Colour of the dressed limestone. */
function limestoneColour(ctx, ox, blocks) {
  const r = rng(17);
  ctx.fillStyle = '#b3a68b';
  ctx.fillRect(ox, 0, TILE, TILE);
  mottle(ctx, ox, r, 260, 'rgba(214,204,178,0.35)', 'rgba(120,108,86,0.3)', 90);
  grain(ctx, ox, r, 9000, 0.25);
  for (const b of blocks)
    wrapX(b.x, b.w, (x) => {
      ctx.fillStyle = b.tone > 0 ? `rgba(230,220,196,${b.tone})` : `rgba(90,80,62,${-b.tone})`;
      ctx.fillRect(ox + x, b.y, b.w, b.h);
      // dirt collects at the bottom of each block
      const g = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.8, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(60,50,38,0.25)');
      ctx.fillStyle = g;
      ctx.fillRect(ox + x, b.y, b.w, b.h);
    });
  // mortar: greyer and darker than the stone
  for (const b of blocks)
    wrapX(b.x, b.w, (x) => {
      ctx.fillStyle = 'rgba(96,88,74,0.95)';
      ctx.fillRect(ox + x, b.y, b.w, JOINT);
      ctx.fillRect(ox + x, b.y, JOINT, b.h);
      if (b.chip) {
        ctx.fillStyle = 'rgba(140,128,104,0.8)';
        ctx.beginPath();
        ctx.moveTo(ox + x + JOINT, b.y + JOINT);
        ctx.lineTo(ox + x + JOINT + b.chip[0], b.y + JOINT);
        ctx.lineTo(ox + x + JOINT, b.y + JOINT + b.chip[1]);
        ctx.fill();
      }
    });
  for (const b of blocks) if (b.text) inscribe(ctx, ox, b, 'rgba(78,68,54,0.75)');
  // water stains running down, soot from old candles and torches
  for (let k = 0; k < 14; k++) {
    const x = ox + r() * TILE;
    const g = ctx.createLinearGradient(0, 0, 0, TILE);
    g.addColorStop(0, 'rgba(70,60,45,0)');
    g.addColorStop(0.3 + r() * 0.4, 'rgba(70,60,45,0.18)');
    g.addColorStop(1, 'rgba(70,60,45,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 6 + r() * 20, TILE);
  }
}

/** Height of the dressed limestone (white = block face, black = bottom of a joint). */
function limestoneHeight(ctx, ox, blocks) {
  const r = rng(29);
  ctx.fillStyle = '#000';
  ctx.fillRect(ox, 0, TILE, TILE);
  for (const b of blocks)
    wrapX(b.x, b.w, (x) => {
      // a slightly cushioned block face with rounded arrises down into the joints
      const x0 = ox + x + JOINT;
      const y0 = b.y + JOINT;
      const w = b.w - JOINT;
      const h = b.h - JOINT;
      for (let k = 0; k < 10; k++) {
        const v = Math.round(110 + (130 + 15 * b.bulge) * Math.sin(((k + 1) / 10) * (Math.PI / 2)));
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(x0 + k, y0 + k, w - 2 * k, h - 2 * k);
      }
      if (b.chip) {
        ctx.fillStyle = 'rgb(70,70,70)';
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 + b.chip[0], y0);
        ctx.lineTo(x0, y0 + b.chip[1]);
        ctx.fill();
      }
    });
  // tool marks and pitting on the faces
  grain(ctx, ox, r, 14000, 0.18, 80, 255);
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 1.5;
  for (let k = 0; k < 2500; k++) {
    const x = ox + r() * TILE;
    const y = r() * TILE;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 12, y - 9);
    ctx.stroke();
  }
  // the carved letters and frames: V-cut grooves
  for (const b of blocks) if (b.text) inscribe(ctx, ox, b, 'rgb(95,95,95)');
}

/** Quarried bedrock: brown-grey strata, cracks, pick marks; a rough, lumpy surface. */
function rockColour(ctx, ox) {
  const r = rng(41);
  ctx.fillStyle = '#7d725f';
  ctx.fillRect(ox, 0, TILE, TILE);
  // strata: horizontal bands of slightly different stone
  for (let y = 0; y < TILE; ) {
    const hgt = 30 + r() * 120;
    const t = r() * 0.25 - 0.12;
    ctx.fillStyle = t > 0 ? `rgba(190,178,150,${t})` : `rgba(40,34,26,${-t})`;
    ctx.fillRect(ox, y, TILE, hgt);
    y += hgt;
  }
  mottle(ctx, ox, r, 500, 'rgba(170,158,130,0.28)', 'rgba(45,38,28,0.32)', 70);
  mottle(ctx, ox, r, 900, 'rgba(200,190,165,0.18)', 'rgba(30,25,18,0.25)', 18);
  grain(ctx, ox, r, 16000, 0.3);
  // cracks
  ctx.strokeStyle = 'rgba(25,20,14,0.7)';
  for (let k = 0; k < 26; k++) {
    let x = ox + r() * TILE;
    let y = r() * TILE;
    ctx.lineWidth = 1 + r() * 2.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 8; s++) {
      x += (r() - 0.3) * 60;
      y += (r() - 0.5) * 30;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // soot from centuries of candles and lamps
  mottle(ctx, ox, r, 40, 'rgba(0,0,0,0)', 'rgba(20,16,12,0.35)', 160);
}

function rockHeight(ctx, ox) {
  const r = rng(43);
  ctx.fillStyle = 'rgb(150,150,150)';
  ctx.fillRect(ox, 0, TILE, TILE);
  // big lumps and hollows, then smaller ones
  mottle(ctx, ox, r, 260, 'rgba(255,255,255,0.35)', 'rgba(0,0,0,0.35)', 120);
  mottle(ctx, ox, r, 900, 'rgba(255,255,255,0.25)', 'rgba(0,0,0,0.25)', 35);
  mottle(ctx, ox, r, 2500, 'rgba(255,255,255,0.2)', 'rgba(0,0,0,0.2)', 10);
  // ledges along the strata
  for (let y = 0; y < TILE; ) {
    const hgt = 40 + r() * 140;
    const g = ctx.createLinearGradient(0, y, 0, y + 12);
    g.addColorStop(0, 'rgba(0,0,0,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(ox, y, TILE, 12);
    y += hgt;
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  for (let k = 0; k < 26; k++) {
    let x = ox + r() * TILE;
    let y = r() * TILE;
    ctx.lineWidth = 2 + r() * 3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 8; s++) {
      x += (r() - 0.3) * 60;
      y += (r() - 0.5) * 30;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // pick marks: short gouges
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 3;
  for (let k = 0; k < 900; k++) {
    const x = ox + r() * TILE;
    const y = r() * TILE;
    const a = r() * Math.PI;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * 14, y + Math.sin(a) * 14);
    ctx.stroke();
  }
}

/** The sandy, gravelly floor of the quarries: pale, trodden, with small stones. */
function gravelColour(ctx, ox) {
  const r = rng(53);
  ctx.fillStyle = '#b9ac93';
  ctx.fillRect(ox, 0, TILE, TILE);
  mottle(ctx, ox, r, 400, 'rgba(220,210,190,0.3)', 'rgba(120,108,88,0.3)', 60);
  grain(ctx, ox, r, 30000, 0.35);
  for (let k = 0; k < 2600; k++) {
    const v = 120 + r() * 100;
    ctx.fillStyle = `rgb(${v},${v * 0.93},${v * 0.8})`;
    ctx.beginPath();
    ctx.ellipse(ox + r() * TILE, r() * TILE, 2 + r() * 6, 2 + r() * 5, r() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function gravelHeight(ctx, ox) {
  const r = rng(53); // same stones as the colour
  ctx.fillStyle = 'rgb(140,140,140)';
  ctx.fillRect(ox, 0, TILE, TILE);
  for (let k = 0; k < 400; k++) r(), r(), r(), r(), r(); // keep in step with the mottle of the colour map (roughly)
  mottle(ctx, ox, r, 300, 'rgba(255,255,255,0.15)', 'rgba(0,0,0,0.15)', 80);
  for (let k = 0; k < 2600; k++) {
    const x = ox + r() * TILE;
    const y = r() * TILE;
    const rad = 2 + r() * 6;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
}

/** A carrier flight deck: dark non-skid grit, tyre marks, oil and fuel stains, weld seams of the plates. */
function deckColour(ctx, ox) {
  const r = rng(61);
  ctx.fillStyle = '#5a5d60';
  ctx.fillRect(ox, 0, TILE, TILE);
  grain(ctx, ox, r, 60000, 0.35);
  mottle(ctx, ox, r, 300, 'rgba(120,124,128,0.25)', 'rgba(30,30,32,0.35)', 60);
  // tyre marks: long dark streaks along the deck (x)
  for (let k = 0; k < 40; k++) {
    const y = r() * TILE;
    const g = ctx.createLinearGradient(ox, 0, ox + TILE, 0);
    g.addColorStop(0, 'rgba(15,15,15,0)');
    g.addColorStop(0.3 + r() * 0.4, `rgba(15,15,15,${0.15 + r() * 0.25})`);
    g.addColorStop(1, 'rgba(15,15,15,0)');
    ctx.fillStyle = g;
    ctx.fillRect(ox, y, TILE, 4 + r() * 8);
  }
  // oil and fuel stains
  mottle(ctx, ox, r, 30, 'rgba(0,0,0,0)', 'rgba(20,18,15,0.5)', 70);
  // plate seams every 1.2 m
  ctx.fillStyle = 'rgba(30,30,32,0.6)';
  for (let k = 0; k < 2; k++) {
    ctx.fillRect(ox + k * (TILE / 2), 0, 3, TILE);
    ctx.fillRect(ox, k * (TILE / 2), TILE, 3);
  }
}

function deckHeight(ctx, ox) {
  const r = rng(67);
  ctx.fillStyle = 'rgb(150,150,150)';
  ctx.fillRect(ox, 0, TILE, TILE);
  grain(ctx, ox, r, 90000, 0.6, 60, 230); // the grit
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  for (let k = 0; k < 2; k++) {
    ctx.fillRect(ox + k * (TILE / 2), 0, 3, TILE);
    ctx.fillRect(ox, k * (TILE / 2), TILE, 3);
  }
}

/** Build the two atlas textures (in a browser; in Node there is no canvas and no relief). */
export function patternAtlas() {
  if (atlas || typeof document === 'undefined' || typeof document.createElement('canvas').getContext !== 'function') return atlas;
  const make = () => {
    const c = document.createElement('canvas');
    c.width = TILE * PATTERNS.length;
    c.height = TILE;
    return c;
  };
  const col = make();
  const hgt = make();
  const cc = col.getContext('2d', { willReadFrequently: true });
  const hc = hgt.getContext('2d');
  PATTERNS.forEach((name, k) => {
    const ox = k * TILE;
    const clip = (ctx, fn) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, 0, TILE, TILE);
      ctx.clip();
      fn();
      ctx.restore();
    };
    if (name === 'limestone' || name === 'ashlar') {
      const blocks = limestoneLayout(name === 'ashlar');
      clip(cc, () => limestoneColour(cc, ox, blocks));
      clip(hc, () => limestoneHeight(hc, ox, blocks));
    } else if (name === 'rock') {
      clip(cc, () => rockColour(cc, ox));
      clip(hc, () => rockHeight(hc, ox));
    } else if (name === 'gravel') {
      clip(cc, () => gravelColour(cc, ox));
      clip(hc, () => gravelHeight(hc, ox));
    } else if (name === 'deck') {
      clip(cc, () => deckColour(cc, ox));
      clip(hc, () => deckHeight(hc, ox));
    }
    // the mean colour (linear): the texture is applied relative to it
    const d = cc.getImageData(ox, 0, TILE, TILE).data;
    const sum = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4 * 37) for (let j = 0; j < 3; j++) sum[j] += (d[i + j] / 255) ** 2.2;
    const cnt = d.length / (4 * 37);
    PATTERN_UNIFORMS.uPatBase.value[k].set(sum[0] / cnt, sum[1] / cnt, sum[2] / cnt);
  });
  const tex = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = 8;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  };
  atlas = tex(col, true);
  PATTERN_UNIFORMS.uPatMap.value = atlas;
  PATTERN_UNIFORMS.uPatHeight.value = tex(hgt, false);
  return atlas;
}

/**
 * Add the relief code to a MeshStandardMaterial's shader (inside its onBeforeCompile).
 * `instanced`: positions come from the instance matrix (voxel cubes), else from the vertices.
 */
export function addPatterns(shader, instanced) {
  if (!patternAtlas()) return;
  photoAtlas();
  Object.assign(shader.uniforms, PATTERN_UNIFORMS);
  const n = PATTERNS.length.toFixed(1);
  const S = PATTERN_SIZE.toFixed(3);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\nattribute float aPat;\nvarying float vPat;\nvarying vec3 vPatPos;\nvarying vec3 vPatWorld;\nvarying vec3 vPatN;`)
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
vPat = aPat;
vPatN = normal;
${instanced ? 'vPatPos = (instanceMatrix * vec4(position, 1.0)).xyz;' : 'vPatPos = position;'}
vPatWorld = (modelMatrix * vec4(vPatPos, 1.0)).xyz;`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
varying float vPat;
varying vec3 vPatPos;
varying vec3 vPatWorld;
varying vec3 vPatN;
uniform sampler2D uPatMap;
uniform sampler2D uPatHeight;
uniform float uPatOn;
uniform vec3 uPatBase[${PATTERNS.length}];
// tile coordinates (1 = one tile) -> atlas uv of pattern id
vec2 patUV(vec2 q, float id) {
  vec2 f = fract(vec2(q.x, -q.y));
  return vec2((id + f.x) / ${n}, f.y);
}
float patH(vec2 q, float id, vec2 gx, vec2 gy) {
  return textureGrad(uPatHeight, patUV(q, id), gx, gy).r;
}
${PHOTO_GLSL}`,
    )
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
bool patOn = vPat > 0.5 && vPat < ${n} + 0.5 && uPatOn > 0.5;
bool photoOn = vPat > ${n} + 0.5 && uPatOn > 0.5 && uPhotoOn > 0.5;

vec3 patNw = vec3(0.0);
if (photoOn) {
  // a photographed surface: grass, sand, rock, basalt (on the voxel's own colour)
  int pid = int(floor(vPat + 0.5)) - ${PATTERNS.length} - 1;
  vec3 Nw = normalize(vPatN);
  diffuseColor.rgb *= clamp(photoColour(pid, vPatWorld, Nw), 0.0, 2.5);
  patNw = photoNormal(pid, vPatWorld, Nw, 1.0);
}
if (patOn) {
  float id = floor(vPat + 0.5) - 1.0;
  // the wall plane: the dominant axis of the surface normal, with its tangents (world axes)
  vec3 Nw = normalize(vPatN);
  vec3 an = abs(Nw);
  vec2 q;
  vec3 T;
  vec3 B;
  vec3 Ng;
  // u runs to the right for someone facing the wall (so carved text is not mirrored)
  if (an.x >= an.y && an.x >= an.z) { float sx = sign(Nw.x); q = vec2(-sx * vPatPos.z, vPatPos.y); T = vec3(0.0, 0.0, -sx); B = vec3(0.0, 1.0, 0.0); Ng = vec3(sx, 0.0, 0.0); }
  else if (an.y >= an.z) { q = vPatPos.xz; T = vec3(1.0, 0.0, 0.0); B = vec3(0.0, 0.0, 1.0); Ng = vec3(0.0, sign(Nw.y), 0.0); }
  else { float sz = sign(Nw.z); q = vec2(sz * vPatPos.x, vPatPos.y); T = vec3(sz, 0.0, 0.0); B = vec3(0.0, 1.0, 0.0); Ng = vec3(0.0, 0.0, sz); }
  q /= ${S};
  vec2 gx = dFdx(q) / vec2(${n}, 1.0);
  vec2 gy = dFdy(q) / vec2(${n}, 1.0);
  // parallax occlusion: march the view ray into the stone until it is below the surface
  vec3 V = normalize(cameraPosition - vPatWorld);
  float vn = max(dot(V, Ng), 0.2);
  // tangential move of the ray per unit of depth (q grows along T and B)
  vec2 shift = vec2(dot(V, T), dot(V, B)) / vn * (${RELIEF.toFixed(3)} / ${S});
  const int STEPS = 12;
  float layer = 1.0 / float(STEPS);
  vec2 dq = shift * layer;
  float depth = 0.0;
  float hd = 1.0 - patH(q, id, gx, gy);
  vec2 qPrev = q;
  float hPrev = hd;
  for (int s = 0; s < STEPS; s++) {
    if (depth >= hd) break;
    qPrev = q;
    hPrev = hd;
    q -= dq;
    depth += layer;
    hd = 1.0 - patH(q, id, gx, gy);
  }
  // refine between the last two samples
  float a = hd - depth;
  float b = hPrev - (depth - layer);
  float t = a / (a - b + 1e-5);
  q = mix(q, qPrev, clamp(t, 0.0, 1.0));
  // colour
  vec3 base = uPatBase[0];
  for (int k = 1; k < ${PATTERNS.length}; k++) if (float(k) == id) base = uPatBase[k];
  vec3 c = textureGrad(uPatMap, patUV(q, id), gx, gy).rgb;
  diffuseColor.rgb *= clamp(c / max(base, vec3(0.02)), 0.0, 2.5);
  // normal from the height field (slopes in metres per metre along T and B)
  float e = 1.5 / ${TILE.toFixed(1)};
  float hx = patH(q + vec2(e, 0.0), id, gx, gy) - patH(q - vec2(e, 0.0), id, gx, gy);
  float hy = patH(q + vec2(0.0, e), id, gx, gy) - patH(q - vec2(0.0, e), id, gx, gy);
  float k = ${RELIEF.toFixed(3)} / (2.0 * e * ${S});
  patNw = normalize(Ng - (hx * k) * T - (hy * k) * B);
  // the deepest parts of the joints get less light from around (cavity)
  float cav = patH(q, id, gx, gy);
  diffuseColor.rgb *= 0.55 + 0.45 * smoothstep(0.0, 0.5, cav);
}`,
    )
    .replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
if (patOn || photoOn) normal = normalize((viewMatrix * vec4(patNw, 0.0)).xyz);`,
    );
}
