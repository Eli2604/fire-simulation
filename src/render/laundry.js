import * as THREE from 'three';
import { garmentShape } from '../models/clothesline.js';

/**
 * The wash on the line (models/clothesline.js), drawn as cloth: every garment a panel of
 * fabric with soft folds and a woven texture in its colour (stripes on the towels, seams on
 * the jeans), the sheet folded over the line, the line itself with a slight sag, wooden pegs.
 * render/statue.js ties the cloth to its voxels (it chars, glows, burns through to holes,
 * falling pieces) and sways it in the wind; the line and the pegs stay (userData.unbound).
 */
let weave = null;
function weaveTexture() {
  if (weave || typeof document === 'undefined') return weave;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#dcdcdc';
  ctx.fillRect(0, 0, 128, 128);
  // warp and weft threads
  for (let k = 0; k < 128; k += 2) {
    ctx.fillStyle = `rgba(255,255,255,${0.25 + 0.2 * Math.random()})`;
    ctx.fillRect(k, 0, 1, 128);
    ctx.fillStyle = `rgba(0,0,0,${0.06 + 0.06 * Math.random()})`;
    ctx.fillRect(0, k, 128, 1);
  }
  weave = new THREE.CanvasTexture(c);
  weave.wrapS = weave.wrapT = THREE.RepeatWrapping;
  weave.repeat.set(12, 12);
  weave.colorSpace = THREE.SRGBColorSpace;
  return weave;
}

export function buildLaundry(pr) {
  const g = new THREE.Group();
  const { L, H } = pr.line;
  // the line, sagging a little between the posts
  const pts = [];
  for (let k = 0; k <= 20; k++) {
    const t = k / 20;
    pts.push(new THREE.Vector3(-L / 2 + L * t, H - 0.04 * Math.sin(Math.PI * t), 0));
  }
  const line = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.003, 5), new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.8 }));
  line.userData.unbound = true;
  g.add(line);
  const pegMat = new THREE.MeshStandardMaterial({ color: 0xb8925a, roughness: 0.7 });
  const top = H - 0.01;
  for (const w of pr.wash) {
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(w.color), map: weaveTexture(), roughness: 0.92, side: THREE.DoubleSide, vertexColors: true });
    const layers = w.kind === 'sheet' ? [-0.012, 0.012] : [0];
    const seed = w.x0 * 13.7;
    for (const zc of layers)
      for (const [ax, ay, bx, by] of garmentShape(w)) {
        const pw = bx - ax;
        const ph = by - ay;
        const nx = Math.max(2, Math.round(pw / 0.05));
        const ny = Math.max(2, Math.round(ph / 0.05));
        const geo = new THREE.PlaneGeometry(pw, ph, nx, ny);
        const pos = geo.getAttribute('position');
        const col = new Float32Array(pos.count * 3);
        for (let k = 0; k < pos.count; k++) {
          const x = pos.getX(k) + w.x0 + (ax + bx) / 2;
          const y = pos.getY(k) + top + (ay + by) / 2;
          // folds: soft vertical waves, deeper lower down; the cloth bellies a little
          const below = Math.max(0, top - y);
          const z = zc + (0.012 + 0.03 * below) * Math.sin(x * 23 + seed) + 0.01 * Math.sin(x * 61 + y * 9 + seed);
          pos.setXYZ(k, x, y, z);
          // stripes across a towel's ends, the seams of the jeans
          let c = 1;
          if (w.kind === 'towel') {
            const f = below / w.drop;
            if ((f > 0.08 && f < 0.12) || (f > 0.86 && f < 0.9)) c = 0.55;
          }
          if (w.kind === 'jeans' && (Math.abs(x - w.x0 - 0.02) < 0.006 || Math.abs(x - w.x0 - w.w + 0.02) < 0.006)) c = 1.35;
          col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = c;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        geo.computeVertexNormals();
        g.add(new THREE.Mesh(geo, mat));
      }
    // pegs: two on each garment (one on a sock)
    for (const px of w.kind === 'sock' ? [w.x0 + w.w / 2] : [w.x0 + 0.05, w.x0 + w.w - 0.05]) {
      const peg = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.07, 0.02), pegMat);
      peg.position.set(px, top + 0.01, 0);
      peg.userData.unbound = true;
      g.add(peg);
    }
  }
  return g;
}
