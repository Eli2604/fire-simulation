import * as THREE from 'three';

/**
 * The whole carrier around the simulated slice of its flight deck (models/carrier.js,
 * carrierDeck): the slice is a box of voxels; this draws the ship it belongs to, in
 * the proportions of a Nimitz-class carrier (length ≈ 4.3 × the deck's width; when the slice is
 * most of the deck, the bow narrows beyond it):
 *
 *  - the hull, lofted from cross sections: a raked stem with the hull narrowing to
 *    it under a broad flight deck at the bow, flared sides, a round bilge, and a flat
 *    transom at the stern; haze grey above, a black boot-top at the waterline, red
 *    antifouling below; plating strakes and frames;
 *  - the flight deck beyond the slice: the bow, the stern round-down and the angled
 *    landing deck overhanging to port, with its markings (landing area centre line,
 *    edge lines, foul lines), the hull number on the bow;
 *  - deck-edge elevators (lowered and raised) and the hangar openings behind them,
 *    sponsons with catwalks and safety nets under the deck edge.
 *
 * All drawn only: the slice is what is simulated (and walked on). Local frame of the
 * prop: x along the ship (bow +x), z across (starboard +z), y up from the keel.
 */
export function buildCarrierHull(pr) {
  const g = new THREE.Group();
  const hx = pr.hx;
  const hz = pr.hz;
  const D = pr.D;
  const T = pr.draft;
  // the ship's ends: about 4.3 × the beam long, the slice a little aft of amidships
  // (a slice that is most of the deck: the stern just aft of it, the bow narrowing beyond it)
  const B = 2 * hz;
  const len = 4.3 * B;
  const xStern = -hx - Math.max(4, Math.min(len * 0.18, (len - 2 * hx) * 0.3));
  const xBow = Math.max(xStern + len, hx + B * 0.8);
  const xStem = xBow - 3.5; // the stem at the waterline (it rakes forward above)

  // ---- the hull
  // half width at (x, y): the slice is the full beam; it narrows to the stem at the
  // bow (raked) and a little to the transom at the stern; flared above the waterline
  const half = (x, y) => {
    let wW;
    let wTop;
    if (x > hx) {
      const t = (x - hx) / (xStem - hx);
      wW = hz * Math.max(0, 1 - t * t);
      wTop = hz * (1 - 0.55 * Math.pow(Math.min(1, (x - hx) / (xBow - hx)), 1.6));
    } else if (x < -hx) {
      const t = (-hx - x) / (-hx - xStern);
      wW = hz * (1 - 0.18 * t);
      wTop = hz * (1 - 0.05 * t);
    } else {
      wW = hz;
      wTop = hz;
    }
    const yTop = D - 0.6;
    let w;
    if (y >= T) w = wW + (wTop - wW) * Math.pow((y - T) / (yTop - T), 1.4);
    else {
      // the bilge: round towards the flat bottom
      const s = Math.max(0, y / T);
      w = wW * (0.72 + 0.28 * Math.sqrt(s));
    }
    // the stem rakes forward: beyond it there is no hull at this height
    const xEnd = xStem + (xBow - xStem) * Math.max(0, y / D);
    if (x > xEnd - 0.01) return 0;
    if (x > hx) w = Math.min(w, (xEnd - x) * 1.8);
    return Math.max(0, w);
  };
  // the bottom rises towards the stern (the run) and a little at the bow
  const yBot = (x) => (x < -hx ? Math.min(1.6, ((-hx - x) / (-hx - xStern)) * 1.6) : x > xStem - 6 ? Math.min(T * 0.6, ((x - xStem + 6) / 6) * T * 0.6) : 0);
  const NX = 140;
  const NY = 18;
  const pos = [];
  const col = [];
  const idx = [];
  const grey = [0.36, 0.385, 0.41];
  const boot = [0.05, 0.05, 0.055];
  const red = [0.33, 0.07, 0.05];
  const colour = (y) => (y < T - 0.25 ? red : y < T + 0.45 ? boot : grey);
  for (let i = 0; i <= NX; i++) {
    const x = xStern + ((xBow - xStern) * i) / NX;
    const yb = yBot(x);
    const yTop = D - 0.6;
    // port side top -> keel -> starboard side top
    for (let j = 0; j <= 2 * NY; j++) {
      const s = j <= NY ? j / NY : (2 * NY - j) / NY; // 0 at the top, 1 at the keel
      const y = yTop - (yTop - yb) * s;
      const side = j <= NY ? -1 : 1;
      const w = s >= 0.999 ? 0 : half(x, y); // the keel: on the centre line
      pos.push(x, y, side * w);
      col.push(...colour(y));
    }
  }
  const row = 2 * NY + 1;
  for (let i = 0; i < NX; i++)
    for (let j = 0; j < 2 * NY; j++) {
      const a = i * row + j;
      const b = a + row;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  // the transom: a flat plate across the stern
  const t0 = pos.length / 3;
  pos.push(xStern, (D - 0.6 + yBot(xStern)) / 2, 0);
  col.push(...grey);
  for (let j = 0; j < 2 * NY; j++) idx.push(t0, j + 1, j);
  const hullGeo = new THREE.BufferGeometry();
  hullGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  hullGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  hullGeo.setIndex(idx);
  hullGeo.computeVertexNormals();
  const hullMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35, side: THREE.DoubleSide });
  hullMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vHP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvHP = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vHP;').replace(
      '#include <color_fragment>',
      `#include <color_fragment>
// plating: strakes every 1.4 m, frames every 2.4 m, faint weld lines; streaks of rust below the scuppers
float strake = 1.0 - smoothstep(0.0, 0.025, abs(fract(vHP.y / 1.4) - 0.5) - 0.47);
float frame = 1.0 - smoothstep(0.0, 0.02, abs(fract(vHP.x / 2.4) - 0.5) - 0.48);
diffuseColor.rgb *= 1.0 - 0.12 * max(strake, frame * 0.7);
float streak = smoothstep(0.7, 1.0, fract(sin(floor(vHP.x / 1.7) * 91.7) * 4375.5)) * smoothstep(${(T + 0.5).toFixed(2)}, ${(D - 1.5).toFixed(2)}, vHP.y) * (1.0 - smoothstep(${(D - 1.5).toFixed(2)}, ${(D - 0.8).toFixed(2)}, vHP.y));
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.22, 0.13, 0.08), streak * 0.35 * smoothstep(0.3, 0.8, fract(vHP.x / 1.7)) * (1.0 - smoothstep(0.8, 1.0, fract(vHP.x / 1.7))));`,
    );
  };
  hullMat.customProgramCacheKey = () => 'carrier-hull-v1';
  g.add(new THREE.Mesh(hullGeo, hullMat));

  // ---- the flight deck: the outline of the whole deck (top view), the slice inside it
  const P = [
    [xStern, -hz * 0.95],
    [xStern, hz * 0.95],
    [-hx, hz],
    [hx, hz],
    [hx + (xBow - hx) * 0.45, hz * 0.92],
    [xBow - 2, hz * 0.45],
    [xBow, hz * 0.3],
    [xBow, -hz * 0.3],
    [xBow - 2, -hz * 0.45],
    [hx + (xBow - hx) * 0.3, -hz * 0.95],
    [hx * 0.35, -hz],
    // the angled landing deck overhangs to port, aft
    [-hx * 0.15, -hz * 1.48],
    [xStern + 3, -hz * 1.5],
    [xStern + 0.5, -hz * 1.25],
  ];
  const shape = new THREE.Shape(P.map(([x, z]) => new THREE.Vector2(x, -z)));
  const deckGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.6, bevelEnabled: false });
  deckGeo.rotateX(-Math.PI / 2);
  deckGeo.translate(0, D - 0.62, 0);
  const deckTex = deckTexture(P, xStern, xBow, hz, hx);
  // uv: from x, z (the extrusion's own uvs follow the shape)
  const uv = deckGeo.getAttribute('uv');
  const dp = deckGeo.getAttribute('position');
  for (let k = 0; k < uv.count; k++) uv.setXY(k, (dp.getX(k) - xStern) / (xBow - xStern), 1 - (dp.getZ(k) + hz * 1.6) / (hz * 3.2));
  const deckMat = new THREE.MeshStandardMaterial({ map: deckTex, color: deckTex ? 0xffffff : 0x55585b, roughness: 0.9, metalness: 0.1 });
  const deckMesh = new THREE.Mesh(deckGeo, deckMat);
  g.add(deckMesh);

  // the underside of the overhangs, and the angled deck's support: a dark shadowed box
  const M = {
    grey: new THREE.MeshStandardMaterial({ color: 0x5c6166, roughness: 0.6, metalness: 0.35 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.9, metalness: 0.1 }),
    net: new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.9, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
    white: new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: 0.7 }),
  };
  const box = (w, h, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  // sponson under the angled deck (port, aft): the overhang's structure down to the hull
  box(-hx * 0.15 - xStern - 3, 2.2, hz * 0.5, M.grey, (xStern + 3 - hx * 0.15) / 2, D - 1.7, -hz * 1.25);
  // sponsons with catwalks along both sides, just under the deck edge
  for (const [x0, x1, s] of [[-hx + 1, hx - 1, 1], [hx * 0.4, hx + (xBow - hx) * 0.35, -1], [xStern + 2, -hx * 0.3, 1]]) {
    box(x1 - x0, 0.25, 1.1, M.grey, (x0 + x1) / 2, D - 1.1, s * (hz + 0.55));
    const net = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, 0.9), M.net);
    net.position.set((x0 + x1) / 2, D - 0.6, s * (hz + 1.1));
    g.add(net);
  }
  // deck-edge elevators: two on the starboard side (one lowered to the hangar deck, one up),
  // one at the port side forward of the angled deck; the hangar openings behind them
  for (const [x, s, down] of [[-hx * 0.55, 1, false], [xStern + 6, 1, true], [hx + 3, -1, false]]) {
    const y = down ? T + 3.0 : D - 0.35;
    box(7, 0.35, 4.2, M.grey, x, y, s * (hz + 2.1));
    box(7.4, Math.min(2.8, D - T - 1.6), 0.1, M.dark, x, T + 0.6 + Math.min(2.8, D - T - 1.6) / 2, s * (hz + 0.03)); // the hangar opening in the side
    box(0.15, D - T - 1.5, 0.15, M.grey, x - 3.6, (D + T) / 2, s * (hz + 4.1)); // guides
  }
  // the hull number on the bow, both sides, and on the deck at the bow
  const num = pr.number ?? '68';
  for (const s of [-1, 1]) {
    const t = textTexture(num, 'rgba(255,255,255,0.92)');
    if (!t) break;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(5, 3.4), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }));
    const x = xStem - 4;
    plane.position.set(x, D - 2.4, s * (half(x, D - 2.4) + 0.05));
    plane.rotation.y = s > 0 ? 0 : Math.PI;
    g.add(plane);
  }
  // the anchors' hawse pipes at the bow
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.45, 14), M.dark);
    const x = xStem - 1.5;
    m.position.set(x, D - 2.0, s * (half(x, D - 2.0) + 0.04));
    m.rotation.y = s > 0 ? 0 : Math.PI;
    g.add(m);
  }
  g.traverse((c) => {
    if (c.isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  g.userData.waterline = [xStern, -hz, xStem, hz];
  return g;
}

/** The deck of the ship (canvas): non-skid grey, worn, with the markings. */
function deckTexture(P, xStern, xBow, hz, hx) {
  if (typeof document === 'undefined' || typeof document.createElement('canvas').getContext !== 'function') return null;
  const L = xBow - xStern;
  const W = hz * 3.2;
  const px = 10; // pixels per metre
  const c = document.createElement('canvas');
  c.width = Math.min(2048, Math.round(L * px));
  c.height = Math.min(1024, Math.round(W * px));
  const sx = c.width / L;
  const sz = c.height / W;
  const X = (x) => (x - xStern) * sx;
  const Z = (z) => (z + hz * 1.6) * sz;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#5e6266';
  ctx.fillRect(0, 0, c.width, c.height);
  // worn non-skid: noise, darker where the aircraft roll, oil and tyre streaks on the landing area
  const img = ctx.getImageData(0, 0, c.width, c.height);
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < img.data.length; k += 4) {
    const n = (rnd() - 0.5) * 22;
    img.data[k] += n;
    img.data[k + 1] += n;
    img.data[k + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  // the landing area: along the angled deck, from the stern towards the bow, angled to port
  const ang = -0.16;
  const a0 = [xStern + 2, -hz * 0.95];
  const a1 = [hx * 0.6, -hz * 0.95 + Math.tan(-ang) * (hx * 0.6 - xStern - 2) * 0.6];
  ctx.save();
  ctx.lineCap = 'butt';
  for (let k = 0; k < 40; k++) {
    // tyre marks
    ctx.strokeStyle = `rgba(20,20,22,${0.06 + rnd() * 0.1})`;
    ctx.lineWidth = 2 + rnd() * 4;
    const o = (rnd() - 0.5) * 3;
    const st = rnd() * 0.4;
    ctx.beginPath();
    ctx.moveTo(X(a0[0] + (a1[0] - a0[0]) * st), Z(a0[1] + (a1[1] - a0[1]) * st + o));
    ctx.lineTo(X(a0[0] + (a1[0] - a0[0]) * (st + 0.3)), Z(a0[1] + (a1[1] - a0[1]) * (st + 0.3) + o));
    ctx.stroke();
  }
  // the landing area's edge lines and its dashed centre line (white), the foul lines (red/white)
  const line = (p, q, w, colr, dash) => {
    ctx.strokeStyle = colr;
    ctx.lineWidth = w * sz;
    ctx.setLineDash(dash ? dash.map((d) => d * sx) : []);
    ctx.beginPath();
    ctx.moveTo(X(p[0]), Z(p[1]));
    ctx.lineTo(X(q[0]), Z(q[1]));
    ctx.stroke();
  };
  for (const off of [-3.2, 3.2]) line([a0[0], a0[1] + off], [a1[0], a1[1] + off], 0.2, 'rgba(235,235,230,0.85)');
  line(a0, a1, 0.25, 'rgba(240,240,235,0.9)', [3, 2.5]);
  line([a1[0] - 2, a1[1] - 5], [a1[0] + 4, a1[1] + 6], 0.3, 'rgba(200,40,30,0.85)', [1, 1]);
  // edge lines round the whole deck
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(230,230,225,0.8)';
  ctx.lineWidth = 0.2 * sz;
  ctx.beginPath();
  P.forEach(([x, z], k) => {
    const q = [X(x) + (X(0) - X(x)) * 0.015, Z(z) + (Z(0) - Z(z)) * 0.04];
    if (k === 0) ctx.moveTo(...q);
    else ctx.lineTo(...q);
  });
  ctx.closePath();
  ctx.stroke();
  // the bow catapults' tracks continuing forward (thin dark slots) and yellow taxi lines
  for (const z of [-3.0, 3.2]) line([hx, z], [xBow - 3, z * 0.7], 0.12, 'rgba(25,25,25,0.8)');
  line([hx, hz - 4.3], [hx + (xBow - hx) * 0.5, hz * 0.5], 0.18, 'rgba(240,195,30,0.85)');
  // the number on the deck at the bow
  ctx.save();
  ctx.translate(X(xBow - 7), Z(0));
  ctx.rotate(Math.PI / 2);
  ctx.fillStyle = 'rgba(235,235,230,0.85)';
  ctx.font = `bold ${Math.round(4.5 * sz)}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('68', 0, 0);
  ctx.restore();
  ctx.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function textTexture(text, colr) {
  if (typeof document === 'undefined' || typeof document.createElement('canvas').getContext !== 'function') return null;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 172;
  const ctx = c.getContext('2d');
  ctx.fillStyle = colr;
  ctx.font = 'bold 150px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // shadowed block numerals, as painted on the bow
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowOffsetX = 6;
  ctx.shadowOffsetY = 6;
  ctx.fillText(text, 128, 90);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
