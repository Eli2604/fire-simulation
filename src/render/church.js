import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { F_HIDDEN } from '../sim/world.js';

/**
 * The gothic church (models/church.js) drawn over its voxels:
 *  - windows: bar tracery (two lancets and an oculus with a quatrefoil, single lancets,
 *    a rose of twelve petals) set in the window reveals, stained glass (painted on a
 *    canvas: blue grounds, ruby medallions, borders, leading) with its iron saddle bars;
 *    seen from inside it glows, from outside it is dark and glossy. Where the glass is
 *    still to come, only the iron armature stands in the opening.
 *  - the sun through the glass: each light of a window facing the sun is projected along
 *    the sunlight onto the floor and the walls behind (coloured patches, clipped to the
 *    room), with faint shafts of light through the air. The glass casts the shadow, so
 *    the sun only comes in coloured. Broken glass lets the plain sun in.
 *  - rib vaults (groin vaults of pointed arches, lunettes over the windows), the crossing
 *    arches, the west portal, pinnacles, the cornice, pews, the altar and the marble
 *    rosette in the crossing.
 *  - the unfinished tower and south arm: timber frame, trusses, iron ties, centering,
 *    scaffolding, ladders, the bell, the treadwheel crane.
 * Timber, boards, glass, pews and the altar are simulated as hidden voxels: a part chars
 * as they do and disappears when most of them have burnt or been blown away (what is
 * left of burnt timber then shows as voxels).
 */

// ---------------------------------------------------------------- textures

function canvas(w, h, draw) {
  if (typeof document === 'undefined' || typeof document.createElement('canvas').getContext !== 'function') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Deterministic random numbers for the painted textures. */
function rand(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const TEX = {};
function textures() {
  if (TEX.ready) return TEX;
  TEX.ready = true;
  // dressed limestone: fine grain, a few darker pits and stains
  TEX.stone = canvas(256, 256, (ctx, w, h) => {
    const r = rand(11);
    ctx.fillStyle = '#d3c8b2';
    ctx.fillRect(0, 0, w, h);
    for (let k = 0; k < 2600; k++) {
      const v = 150 + r() * 80;
      ctx.fillStyle = `rgba(${v},${v * 0.95},${v * 0.85},${0.08 + r() * 0.12})`;
      ctx.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3);
    }
    for (let k = 0; k < 40; k++) {
      ctx.fillStyle = `rgba(90,80,65,${0.05 + r() * 0.1})`;
      ctx.beginPath();
      ctx.arc(r() * w, r() * h, 1 + r() * 2.5, 0, 7);
      ctx.fill();
    }
  });
  if (TEX.stone) TEX.stone.wrapS = TEX.stone.wrapT = THREE.RepeatWrapping;
  // the plastered and limewashed vault webs, with the joints of the courses showing through
  TEX.vault = canvas(256, 256, (ctx, w, h) => {
    const r = rand(12);
    ctx.fillStyle = '#e4dccb';
    ctx.fillRect(0, 0, w, h);
    for (let k = 0; k < 1800; k++) {
      const v = 190 + r() * 50;
      ctx.fillStyle = `rgba(${v},${v * 0.96},${v * 0.88},0.12)`;
      ctx.fillRect(r() * w, r() * h, 2 + r() * 4, 2 + r() * 4);
    }
    ctx.strokeStyle = 'rgba(150,135,110,0.35)';
    ctx.lineWidth = 1;
    for (let y = 0; y < h; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
      ctx.stroke();
      const off = (y / 32) % 2 ? 0 : 40;
      for (let x = off; x < w; x += 80) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, y);
        ctx.lineTo(x + 0.5, y + 32);
        ctx.stroke();
      }
    }
  });
  if (TEX.vault) TEX.vault.wrapS = TEX.vault.wrapT = THREE.RepeatWrapping;
  // sawn oak: grain along v (the length of a beam), checks and knots
  const wood = (seed, base, dark) =>
    canvas(64, 512, (ctx, w, h) => {
      const r = rand(seed);
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, w, h);
      for (let k = 0; k < 70; k++) {
        ctx.strokeStyle = `rgba(${dark},${0.12 + r() * 0.25})`;
        ctx.lineWidth = 0.5 + r() * 1.8;
        const x = r() * w;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.bezierCurveTo(x + (r() - 0.5) * 8, h / 3, x + (r() - 0.5) * 8, (2 * h) / 3, x + (r() - 0.5) * 4, h);
        ctx.stroke();
      }
      for (let k = 0; k < 4; k++) {
        const x = r() * w;
        const y = r() * h;
        ctx.fillStyle = `rgba(${dark},0.5)`;
        ctx.beginPath();
        ctx.ellipse(x, y, 2 + r() * 3, 4 + r() * 6, 0, 0, 7);
        ctx.fill();
      }
      for (let k = 0; k < 6; k++) {
        ctx.strokeStyle = `rgba(${dark},0.6)`;
        ctx.lineWidth = 1;
        const x = r() * w;
        const y = r() * h;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (r() - 0.5) * 3, y + 20 + r() * 60);
        ctx.stroke();
      }
    });
  TEX.oak = wood(21, '#8a6a49', '50,32,18');
  TEX.pole = wood(22, '#a08765', '70,55,38');
  TEX.board = wood(23, '#a5835a', '80,55,30');
  for (const k of ['oak', 'pole', 'board']) if (TEX[k]) TEX[k].wrapS = TEX[k].wrapT = THREE.RepeatWrapping;
  return TEX;
}

// ---------------------------------------------------------------- pointed arches

/** Pointed arch through (±a, tS) with its apex at (0, tA): centre offset c and radius R. */
function arch(a, tS, tA) {
  const r = Math.max(1e-3, tA - tS);
  const c = (r * r - a * a) / (2 * a);
  return { a, tS, tA, r, c, R: a + c };
}
/** Height of the arch at |d| from its axis. */
function archAt(A, d) {
  const x = Math.abs(d);
  if (x >= A.a) return A.tS;
  return A.tS + Math.sqrt(Math.max(0, A.R * A.R - (x + A.c) * (x + A.c)));
}
/** Half width of the arch at height t (t above the springing). */
function archHalf(A, t) {
  if (t <= A.tS) return A.a;
  const q = A.R * A.R - (t - A.tS) * (t - A.tS);
  return q > 0 ? Math.max(0, -A.c + Math.sqrt(q)) : 0;
}
/** Points of a lancet (counter-clockwise), centred on sc, from tB up to its apex. */
function lancet(sc, a, tB, tS, tA, n = 14) {
  const A = arch(a, tS, tA);
  const end = Math.atan2(A.r, A.c);
  const pts = [new THREE.Vector2(sc - a, tB), new THREE.Vector2(sc + a, tB)];
  for (let i = 0; i <= n; i++) {
    const g = (end * i) / n;
    pts.push(new THREE.Vector2(sc - A.c + A.R * Math.cos(g), tS + A.R * Math.sin(g)));
  }
  for (let i = n - 1; i >= 0; i--) {
    const g = (end * i) / n;
    pts.push(new THREE.Vector2(sc + A.c - A.R * Math.cos(g), tS + A.R * Math.sin(g)));
  }
  return pts;
}
function circle(sc, tc, r, n = 32) {
  const pts = [];
  for (let i = 0; i < n; i++) pts.push(new THREE.Vector2(sc + r * Math.cos((i / n) * Math.PI * 2), tc + r * Math.sin((i / n) * Math.PI * 2)));
  return pts;
}
/** A quatrefoil: four lobes round (sc, tc) within radius r. */
function quatrefoil(sc, tc, r, n = 64) {
  const d = r * 0.45;
  const rl = r * 0.55;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const f = (i / n) * Math.PI * 2;
    let best = 0;
    for (let k = 0; k < 4; k++) {
      const D = f - (k * Math.PI) / 2;
      const sd = d * Math.sin(D);
      if (Math.abs(sd) > rl) continue;
      best = Math.max(best, d * Math.cos(D) + Math.sqrt(rl * rl - sd * sd));
    }
    pts.push(new THREE.Vector2(sc + best * Math.cos(f), tc + best * Math.sin(f)));
  }
  return pts;
}

/** The layout of a window in its own plane: outline, lights (glass), oculus. */
function windowLayout(w) {
  const W = w.w;
  const H = w.top - w.y0;
  const b = 0.08; // the stone frame inside the outline
  if (w.kind === 'rose') {
    const R = W / 2;
    const tc = R;
    const lights = [{ pts: quatrefoil(0, tc, R * 0.24), kind: 'centre' }];
    const n = 12;
    const r1 = R * 0.3;
    const r2 = R * 0.72;
    const r3 = R - b;
    for (let k = 0; k < n; k++) {
      const f0 = (k / n) * Math.PI * 2;
      const half = Math.PI / n - 0.06 / ((r1 + r2) / 2);
      const pts = [];
      // inner edge, the sides out to r2, a pointed cap out to r3
      for (let i = 0; i <= 4; i++) {
        const f = f0 - half + (2 * half * i) / 4;
        pts.push(new THREE.Vector2(r1 * Math.cos(f), tc + r1 * Math.sin(f)));
      }
      const hw2 = r2 * Math.sin(Math.PI / n) - 0.04;
      const cap = arch(hw2, 0, r3 - r2 * Math.cos(Math.PI / n));
      const ax = [Math.cos(f0), Math.sin(f0)];
      const tx = [-Math.sin(f0), Math.cos(f0)];
      for (let i = 0; i <= 10; i++) {
        const d = hw2 - (2 * hw2 * i) / 10;
        const out = r2 * Math.cos(Math.PI / n) + archAt(cap, d);
        pts.push(new THREE.Vector2(ax[0] * out + tx[0] * d, tc + ax[1] * out + tx[1] * d));
      }
      lights.push({ pts, kind: 'petal', f: f0 });
    }
    return { W, H, b, outline: circle(0, tc, R, 64), lights, rose: { tc, R } };
  }
  const tS = H - 1.732 * (W / 2); // equilateral outer arch
  const outer = lancet(0, W / 2, 0, tS, H);
  const lights = [];
  if (w.kind === 'two') {
    const m = 0.12;
    const la = (W - 2 * b - m) / 4;
    const lsc = m / 2 + la;
    const lA = tS + 1.732 * la;
    for (const s of [-1, 1]) lights.push({ pts: lancet(s * lsc, la, 0.06, tS, lA), kind: 'lancet', sc: s * lsc, a: la, tS, tA: lA });
    const oc = (lA + H) / 2 + 0.02;
    const or = 0.85 * Math.min((H - lA) / 2 - b * 0.9, archHalf(arch(W / 2, tS, H), oc) - b * 1.4);
    lights.push({ pts: quatrefoil(0, oc, or), kind: 'oculus', tc: oc, r: or });
  } else {
    const la = W / 2 - b;
    lights.push({ pts: lancet(0, la, 0.06, tS, H - b * 1.3), kind: 'lancet', sc: 0, a: la, tS, tA: H - b * 1.3 });
  }
  return { W, H, b, outline: outer, lights, tS };
}

// ---------------------------------------------------------------- stained glass

const BLUES = ['#16348a', '#1d3f97', '#2148a6', '#122c78', '#28509e'];
const REDS = ['#9a1420', '#b01c22', '#86101b', '#a8261c'];
const GOLDS = ['#d8a52a', '#e6bd3e', '#c98f1d'];
const GREENS = ['#1f6b3a', '#2a7d44', '#185a31'];
const WHITES = ['#e6e1c8', '#d9d4b8'];
const PURPLES = ['#5b2a6e', '#6d3780'];
const pick = (r, a) => a[Math.floor(r() * a.length)];

/** Paint a window's glass: ground, medallions, borders, leading; one canvas for the whole window. */
function paintGlass(w, L) {
  const k = 150; // px per metre
  const Wp = Math.ceil(L.W * k);
  const Hp = Math.ceil(L.H * k);
  return canvas(Wp, Hp, (ctx) => {
    const r = rand(w.seed * 97 + 13);
    const X = (s) => (s + L.W / 2) * k;
    const Yp = (t) => (L.H - t) * k;
    const path = (pts) => {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Yp(p.y)) : ctx.moveTo(X(p.x), Yp(p.y))));
      ctx.closePath();
    };
    const lead = (wd = 2.2) => {
      ctx.strokeStyle = '#17120e';
      ctx.lineWidth = wd;
      ctx.stroke();
    };
    const piece = (fill) => {
      ctx.fillStyle = fill;
      ctx.fill();
      lead();
    };
    ctx.fillStyle = '#17120e';
    ctx.fillRect(0, 0, Wp, Hp);
    const scheme = w.seed % 3; // blue ground with ruby medallions, ruby ground with blue, or grisaille with colour
    const ground = scheme === 1 ? REDS : scheme === 2 ? WHITES : BLUES;
    const medal = scheme === 1 ? BLUES : REDS;
    // the ground: a mosaic of small diamonds, a few red ones among the blue
    const q = 0.11 * k;
    for (let y = -q; y < Hp + q; y += q / 2) {
      const row = Math.round(y / (q / 2));
      for (let x = (row % 2) * (q / 2) - q; x < Wp + q; x += q) {
        ctx.beginPath();
        ctx.moveTo(x, y - q / 2);
        ctx.lineTo(x + q / 2, y);
        ctx.lineTo(x, y + q / 2);
        ctx.lineTo(x - q / 2, y);
        ctx.closePath();
        piece(r() < 0.1 ? pick(r, scheme === 1 ? BLUES : REDS) : r() < 0.06 ? pick(r, GOLDS) : pick(r, ground));
      }
    }
    // motifs inside a medallion
    const motif = (cx, cy, rr, kind) => {
      ctx.save();
      ctx.translate(cx, cy);
      if (kind === 0) {
        // an eight-pointed star
        ctx.beginPath();
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
          const d = i % 2 ? rr * 0.45 : rr;
          ctx.lineTo(Math.cos(a) * d, Math.sin(a) * d);
        }
        ctx.closePath();
        piece(pick(r, GOLDS));
        ctx.beginPath();
        ctx.arc(0, 0, rr * 0.28, 0, 7);
        piece(pick(r, WHITES));
      } else if (kind === 1) {
        // a cross pattée on a white disc
        ctx.beginPath();
        ctx.arc(0, 0, rr * 0.92, 0, 7);
        piece(pick(r, WHITES));
        for (let i = 0; i < 4; i++) {
          ctx.rotate(Math.PI / 2);
          ctx.beginPath();
          ctx.moveTo(-rr * 0.12, 0);
          ctx.lineTo(-rr * 0.38, -rr * 0.85);
          ctx.lineTo(rr * 0.38, -rr * 0.85);
          ctx.lineTo(rr * 0.12, 0);
          ctx.closePath();
          piece(i % 2 ? pick(r, REDS) : pick(r, GOLDS));
        }
      } else if (kind === 2) {
        // a fleur-de-lis
        const g = pick(r, GOLDS);
        ctx.beginPath();
        ctx.moveTo(0, -rr * 0.95);
        ctx.bezierCurveTo(rr * 0.35, -rr * 0.5, rr * 0.25, -rr * 0.1, 0, rr * 0.1);
        ctx.bezierCurveTo(-rr * 0.25, -rr * 0.1, -rr * 0.35, -rr * 0.5, 0, -rr * 0.95);
        piece(g);
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(s * rr * 0.1, -rr * 0.05);
          ctx.bezierCurveTo(s * rr * 0.9, -rr * 0.5, s * rr * 0.95, rr * 0.15, s * rr * 0.55, rr * 0.25);
          ctx.bezierCurveTo(s * rr * 0.6, -rr * 0.05, s * rr * 0.35, -rr * 0.1, s * rr * 0.1, rr * 0.1);
          ctx.closePath();
          piece(g);
        }
        ctx.beginPath();
        ctx.rect(-rr * 0.45, rr * 0.12, rr * 0.9, rr * 0.18);
        piece(pick(r, WHITES));
        ctx.beginPath();
        ctx.moveTo(-rr * 0.15, rr * 0.3);
        ctx.lineTo(rr * 0.15, rr * 0.3);
        ctx.lineTo(0, rr * 0.85);
        ctx.closePath();
        piece(g);
      } else {
        // a six-petalled flower
        for (let i = 0; i < 6; i++) {
          ctx.rotate(Math.PI / 3);
          ctx.beginPath();
          ctx.ellipse(0, -rr * 0.5, rr * 0.22, rr * 0.45, 0, 0, 7);
          piece(i % 2 ? pick(r, GOLDS) : pick(r, WHITES));
        }
        ctx.beginPath();
        ctx.arc(0, 0, rr * 0.22, 0, 7);
        piece(pick(r, GREENS));
      }
      ctx.restore();
    };
    const medallion = (cx, cy, rr, shape) => {
      // a ring of small pieces, the coloured ground, the motif
      if (shape === 'quatre') path(quatrefoil(0, 0, rr / k).map((p) => new THREE.Vector2(p.x + (cx / k - L.W / 2), p.y + L.H - cy / k)));
      else {
        ctx.beginPath();
        ctx.arc(cx, cy, rr, 0, 7);
      }
      piece(pick(r, GOLDS));
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(0.86, 0.86);
      ctx.translate(-cx, -cy);
      if (shape === 'quatre') path(quatrefoil(0, 0, rr / k).map((p) => new THREE.Vector2(p.x + (cx / k - L.W / 2), p.y + L.H - cy / k)));
      else {
        ctx.beginPath();
        ctx.arc(cx, cy, rr, 0, 7);
      }
      piece(pick(r, medal));
      ctx.restore();
      // a few lead lines across the ground
      for (let i = 0; i < 4; i++) {
        const a = r() * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * rr * 0.4, cy + Math.sin(a) * rr * 0.4);
        ctx.lineTo(cx + Math.cos(a) * rr * 0.8, cy + Math.sin(a) * rr * 0.8);
        lead(1.5);
      }
      motif(cx, cy, rr * 0.55, Math.floor(r() * 4));
    };
    for (const lt of L.lights) {
      if (lt.kind === 'lancet') {
        // medallions up the light, alternating round and quatrefoil, a star in the head
        const rr = lt.a * 0.86;
        const n = Math.max(1, Math.floor((lt.tS - 0.3) / (rr * 2.4)));
        const step = (lt.tS - 0.3) / n;
        for (let i = 0; i < n; i++) medallion(X(lt.sc), Yp(0.25 + step * (i + 0.5)), rr * k, i % 2 ? 'quatre' : 'round');
        medallion(X(lt.sc), Yp(lt.tS + (lt.tA - lt.tS) * 0.32), rr * 0.7 * k, 'round');
        // a border of small pieces along the light's edge
        path(lt.pts);
        ctx.save();
        ctx.clip();
        path(lt.pts);
        ctx.setLineDash([0.05 * k, 0.035 * k]);
        ctx.strokeStyle = pick(r, GOLDS);
        ctx.lineWidth = 0.11 * k;
        ctx.stroke();
        ctx.setLineDash([0.035 * k, 0.05 * k]);
        ctx.lineDashOffset = 0.05 * k;
        ctx.strokeStyle = pick(r, WHITES);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = '#17120e';
        ctx.lineWidth = 2;
        const inset = lt.pts.map((p) => new THREE.Vector2(lt.sc + (p.x - lt.sc) * (1 - 0.055 / lt.a), p.y * (1 - 0.01) + 0.03));
        path(inset);
        ctx.stroke();
        ctx.restore();
      } else if (lt.kind === 'oculus' || lt.kind === 'centre') {
        const c = lt.kind === 'oculus' ? lt.tc : L.rose.tc;
        const rr = (lt.kind === 'oculus' ? lt.r : L.W * 0.12) * k;
        // radiating petals round a golden sun
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          ctx.beginPath();
          ctx.ellipse(X(0) + Math.cos(a) * rr * 0.55, Yp(c) + Math.sin(a) * rr * 0.55, rr * 0.42, rr * 0.2, a, 0, 7);
          piece(i % 2 ? pick(r, REDS) : pick(r, BLUES));
        }
        ctx.beginPath();
        ctx.arc(X(0), Yp(c), rr * 0.32, 0, 7);
        piece(pick(r, GOLDS));
        motif(X(0), Yp(c), rr * 0.22, 0);
      } else if (lt.kind === 'petal') {
        // rose petals: alternating grounds, a medallion each
        const mid = new THREE.Vector2(0, 0);
        lt.pts.forEach((p) => mid.add(p));
        mid.multiplyScalar(1 / lt.pts.length);
        path(lt.pts);
        piece(Math.round(lt.f / ((Math.PI * 2) / 12)) % 2 ? pick(r, REDS) : pick(r, BLUES));
        ctx.save();
        path(lt.pts);
        ctx.clip();
        for (let i = 0; i < 3; i++) {
          const f = lt.f;
          const d = L.W * (0.17 + i * 0.1);
          ctx.beginPath();
          ctx.arc(X(Math.cos(f) * d), Yp(L.rose.tc + Math.sin(f) * d), L.W * 0.035 * k, 0, 7);
          piece(pick(r, i % 2 ? GOLDS : WHITES));
        }
        ctx.restore();
        medallion(X(mid.x), Yp(mid.y), L.W * 0.055 * k, 'round');
      }
    }
    // the glass itself: streaks, seeds and uneven thickness, a little grime at the bottom
    for (let i = 0; i < Wp * Hp * 0.004; i++) {
      const v = r() < 0.5 ? 255 : 0;
      ctx.fillStyle = `rgba(${v},${v},${v},${0.03 + r() * 0.06})`;
      ctx.beginPath();
      ctx.arc(r() * Wp, r() * Hp, 0.5 + r() * 2.2, 0, 7);
      ctx.fill();
    }
    const g = ctx.createLinearGradient(0, Hp, 0, Hp * 0.7);
    g.addColorStop(0, 'rgba(40,30,20,0.25)');
    g.addColorStop(1, 'rgba(40,30,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, Wp, Hp);
    // leading round every light
    for (const lt of L.lights) {
      path(lt.pts);
      lead(3);
    }
  });
}

// ---------------------------------------------------------------- the floor rosette

function paintRosette() {
  return canvas(1024, 1024, (ctx, w) => {
    const r = rand(77);
    const c = w / 2;
    const marble = (base, vein, n = 30) => {
      ctx.fillStyle = base;
      ctx.fill();
      ctx.save();
      ctx.clip();
      for (let i = 0; i < n; i++) {
        ctx.strokeStyle = vein;
        ctx.globalAlpha = 0.15 + r() * 0.25;
        ctx.lineWidth = 0.6 + r() * 1.8;
        let x = r() * w;
        let y = r() * w;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let k = 0; k < 6; k++) {
          x += (r() - 0.3) * 90;
          y += (r() - 0.5) * 90;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    };
    const ring = (r0, r1) => {
      ctx.beginPath();
      ctx.arc(c, c, r1, 0, 7);
      ctx.arc(c, c, r0, 0, 7, true);
    };
    const disc = (rr) => {
      ctx.beginPath();
      ctx.arc(c, c, rr, 0, 7);
    };
    const joint = () => {
      ctx.strokeStyle = 'rgba(30,25,20,0.55)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    };
    ctx.clearRect(0, 0, w, w);
    // outer bands: white, black with the inscription, a band of red and white teeth
    disc(c);
    marble('#e9e4d8', '#9a9488');
    joint();
    ring(c * 0.8, c * 0.95);
    marble('#1d1b1a', '#7c766c', 40);
    joint();
    ctx.save();
    ctx.translate(c, c);
    ctx.fillStyle = '#d9b45a';
    ctx.font = `bold ${Math.round(c * 0.085)}px "Times New Roman", Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = '✠ LVX · IN · TENEBRIS · LVCET · ET · TENEBRAE · EAM · NON · COMPREHENDERVNT · ';
    for (let i = 0; i < text.length; i++) {
      ctx.save();
      ctx.rotate((i / text.length) * Math.PI * 2);
      ctx.fillText(text[i], 0, -c * 0.875);
      ctx.restore();
    }
    ctx.restore();
    for (let i = 0; i < 48; i++) {
      const a0 = (i / 48) * Math.PI * 2;
      const a1 = ((i + 1) / 48) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a0) * c * 0.8, c + Math.sin(a0) * c * 0.8);
      ctx.lineTo(c + Math.cos((a0 + a1) / 2) * c * 0.72, c + Math.sin((a0 + a1) / 2) * c * 0.72);
      ctx.lineTo(c + Math.cos(a1) * c * 0.8, c + Math.sin(a1) * c * 0.8);
      ctx.closePath();
      marble(i % 2 ? '#8e2a22' : '#e8e2d2', i % 2 ? '#4c1410' : '#a59e90', 3);
      joint();
    }
    ring(c * 0.69, c * 0.72);
    marble('#c6a24a', '#7a5d1d', 6);
    joint();
    // a sixteen-pointed star in red, green and white marble
    disc(c * 0.69);
    marble('#ded8c8', '#9a9488', 20);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
      const long = i % 2 === 0;
      const tip = long ? c * 0.67 : c * 0.5;
      const half = Math.PI / 16;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(c, c);
        ctx.lineTo(c + Math.cos(a) * tip, c + Math.sin(a) * tip);
        ctx.lineTo(c + Math.cos(a + side * half) * c * 0.2, c + Math.sin(a + side * half) * c * 0.2);
        ctx.closePath();
        const col = long ? (side < 0 ? ['#a3271f', '#5a120e'] : ['#d84a3a', '#7c2219']) : side < 0 ? ['#235c3b', '#0e2d1b'] : ['#3d8458', '#16422a'];
        marble(col[0], col[1], 4);
        joint();
      }
    }
    // the sun at the centre: gilt rays and a disc
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const L = i % 2 ? c * 0.24 : c * 0.3;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a - 0.06) * c * 0.15, c + Math.sin(a - 0.06) * c * 0.15);
      ctx.quadraticCurveTo(c + Math.cos(a + 0.05) * L * 0.8, c + Math.sin(a + 0.05) * L * 0.8, c + Math.cos(a) * L, c + Math.sin(a) * L);
      ctx.lineTo(c + Math.cos(a + 0.06) * c * 0.15, c + Math.sin(a + 0.06) * c * 0.15);
      ctx.closePath();
      marble(i % 2 ? '#d4ab45' : '#e9c867', '#8a6a1c', 2);
      joint();
    }
    disc(c * 0.15);
    marble('#e7c25c', '#9c7726', 8);
    joint();
    disc(c * 0.1);
    marble('#1d1b1a', '#555', 4);
    joint();
    // a cross of gold in the black centre
    ctx.fillStyle = '#e2bd5a';
    ctx.fillRect(c - c * 0.012, c - c * 0.07, c * 0.024, c * 0.14);
    ctx.fillRect(c - c * 0.05, c - c * 0.035, c * 0.1, c * 0.024);
    // wear in the middle where people have walked across it
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, 'rgba(255,255,255,0.06)');
    g.addColorStop(0.7, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    disc(c);
    ctx.fill();
  });
}

// ---------------------------------------------------------------- light through the glass

const LIGHT_VERT = /* glsl */ `
  attribute float aFade;
  varying vec2 vUv;
  varying vec3 vLocal;
  varying float vFade;
  void main() {
    vUv = uv;
    vLocal = position;
    vFade = aFade;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const LIGHT_FRAG = /* glsl */ `
  uniform sampler2D map;
  uniform float strength;
  uniform float shaft;
  uniform float time;
  uniform vec3 bmin[2];
  uniform vec3 bmax[2];
  uniform int nb;
  uniform vec3 emin[8];
  uniform vec3 emax[8];
  uniform int ne;
  varying vec2 vUv;
  varying vec3 vLocal;
  varying float vFade;
  void main() {
    bool inside = false;
    for (int i = 0; i < 2; i++) {
      if (i >= nb) break;
      if (all(greaterThanEqual(vLocal, bmin[i])) && all(lessThanEqual(vLocal, bmax[i]))) inside = true;
    }
    if (!inside) discard;
    for (int i = 0; i < 8; i++) {
      if (i >= ne) break;
      if (all(greaterThanEqual(vLocal, emin[i])) && all(lessThanEqual(vLocal, emax[i]))) discard;
    }
    vec3 c = texture2D(map, vUv).rgb;
    float a = strength;
    if (shaft > 0.0) {
      // dust in the beam: fades away from the window, shimmers a little
      float n = sin(vLocal.x * 7.0 + time * 0.7) * sin(vLocal.y * 5.0 - time * 0.4) * sin(vLocal.z * 6.0 + time * 0.5);
      a *= shaft * pow(1.0 - vFade, 1.4) * (0.75 + 0.25 * n);
    }
    gl_FragColor = vec4(c * a, 1.0);
  }
`;

function lightMaterial(map, boxes, excl, shaft = 0) {
  const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  const pad = (arr, n) => {
    const out = arr.slice(0, n);
    while (out.length < n) out.push(new THREE.Vector3());
    return out;
  };
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map },
      strength: { value: 1 },
      shaft: { value: shaft },
      time: { value: 0 },
      bmin: { value: pad(boxes.map((b) => v3(b.slice(0, 3))), 2) },
      bmax: { value: pad(boxes.map((b) => v3(b.slice(3))), 2) },
      nb: { value: Math.min(2, boxes.length) },
      emin: { value: pad(excl.map((b) => v3(b.slice(0, 3))), 8) },
      emax: { value: pad(excl.map((b) => v3(b.slice(3))), 8) },
      ne: { value: Math.min(8, excl.length) },
    },
    vertexShader: LIGHT_VERT,
    fragmentShader: LIGHT_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: shaft ? THREE.DoubleSide : THREE.FrontSide,
    polygonOffset: !shaft,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    fog: false,
  });
}

// ---------------------------------------------------------------- the drawing

export class ChurchDrawing {
  constructor(spec, world, pr, sunDir, sunLight) {
    this.spec = spec;
    this.world = world;
    this.sunLight = sunLight;
    this.group = new THREE.Group();
    this.parts = new Map(); // name -> { group, geos: {matKey: [geo]}, anchors, ... }
    this.windowParts = [];
    this.lightMats = [];
    this.glassInner = [];
    this.flames = [];
    this.t = 0;
    this.check = 0;
    const T = textures();
    const std = (o) => new THREE.MeshStandardMaterial(o);
    this.M = {
      stone: std({ map: T.stone, color: 0xe2d8c4, roughness: 0.9 }),
      vault: std({ map: T.vault, color: 0xf0e8d8, roughness: 0.95, side: THREE.DoubleSide }),
      rib: std({ map: T.stone, color: 0xcfc3aa, roughness: 0.85 }),
      oak: std({ map: T.oak, color: 0xb59474, roughness: 0.85 }),
      pole: std({ map: T.pole, color: 0xc4ab88, roughness: 0.9 }),
      board: std({ map: T.board, color: 0xc49f74, roughness: 0.88 }),
      pew: std({ map: T.oak, color: 0x6e4c32, roughness: 0.6 }),
      iron: std({ color: 0x2a2826, roughness: 0.55, metalness: 0.75 }),
      bronze: std({ color: 0x9a7440, roughness: 0.32, metalness: 0.9 }),
      gold: std({ color: 0xd6aa48, roughness: 0.28, metalness: 1 }),
      linen: std({ color: 0xf2efe6, roughness: 0.85 }),
      wax: std({ color: 0xf3ead2, roughness: 0.6, emissive: 0x1a1408 }),
      rope: std({ color: 0x9b8763, roughness: 1 }),
      fir: std({ color: 0x2d5a2a, roughness: 0.9 }),
      block: std({ map: T.stone, color: 0xece2cc, roughness: 0.9 }),
    };
    // where the church stands: local -> world (to find its voxels), and the sun in its frame
    this.origin = new THREE.Vector3(...pr.p);
    this.heading = pr.heading ?? 0;
    const sd = (sunDir ?? new THREE.Vector3(0.6, 1.2, 0.4)).clone().normalize();
    this.sunLocal = sd.applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.heading);

    this.buildWindows();
    this.buildOpenings();
    this.buildVaults();
    this.buildPortal();
    this.buildPinnacles();
    this.buildInterior();
    this.buildTimber();
    this.buildPartition();
    this.buildCentering();
    this.buildCrane();
    this.finishParts();
  }

  // -------- helpers

  part(name = 'static') {
    let p = this.parts.get(name);
    if (!p) {
      p = { name, group: new THREE.Group(), geos: {}, anchors: [], extra: [] };
      this.parts.set(name, p);
      this.group.add(p.group);
    }
    return p;
  }
  add(partName, matKey, geo) {
    (this.part(partName).geos[matKey] ??= []).push(geo);
  }
  /** A box between two points (a beam): s = [width, depth]; wood grain along its length. */
  beamGeo(a, b, s, round = false) {
    const A = new THREE.Vector3(...a);
    const B = new THREE.Vector3(...b);
    const d = B.clone().sub(A);
    const len = d.length();
    if (len < 1e-4) return null;
    d.normalize();
    const geo = round ? new THREE.CylinderGeometry(s[0] / 2, s[0] / 2, len, 8) : new THREE.BoxGeometry(s[0], len, s[1]);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * len * 0.8);
    // the wide side stays horizontal
    let side = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0));
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const z = new THREE.Vector3().crossVectors(side, d).normalize();
    const m = new THREE.Matrix4().makeBasis(side, d, z).setPosition(A.clone().add(B).multiplyScalar(0.5));
    geo.applyMatrix4(m);
    return geo;
  }
  boxGeo(c, size, rotY = 0) {
    const g = new THREE.BoxGeometry(...size);
    if (rotY) g.rotateY(rotY);
    g.translate(...c);
    return g;
  }
  /** The frame of an opening in a wall: (u, up, n), origin on the mid-plane at height y0. */
  frame(o, n, y0) {
    const N = new THREE.Vector3(n[0], 0, n[2]).normalize();
    const U = new THREE.Vector3(N.z, 0, -N.x);
    return new THREE.Matrix4().makeBasis(U, new THREE.Vector3(0, 1, 0), N).setPosition(o[0], y0, o[2]);
  }
  extrude(pts, holes, depth, bevel = 0) {
    const shape = new THREE.Shape(pts);
    for (const h of holes) shape.holes.push(new THREE.Path(h));
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 1, curveSegments: 8 });
    g.translate(0, 0, -depth / 2);
    // world-ish texture coordinates (the stone grain)
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.6, uv.getY(i) * 0.6);
    return g;
  }
  tube(points, r, closed = false, seg = 6) {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => (p.isVector3 ? p : new THREE.Vector3(...p))), closed);
    return new THREE.TubeGeometry(curve, Math.max(8, points.length * 2), r, seg, closed);
  }
  /** World voxel index of a local point (the church's own frame). */
  voxelOf(p) {
    const v = new THREE.Vector3(...p).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.heading).add(this.origin);
    return this.world?.voxelAt?.(v.x, v.y, v.z) ?? -1;
  }

  // -------- windows

  buildWindows() {
    const S = this.spec;
    for (const w of S.windows) {
      const L = windowLayout(w);
      const F = this.frame(w.o, w.n, w.y0);
      const n = new THREE.Vector3(w.n[0], 0, w.n[2]).normalize();
      if (w.glass) {
        // stone infill of the reveal round the outline, and the tracery at the glass
        const m = S.h;
        const H = L.H;
        const rect =
          w.kind === 'rose'
            ? [new THREE.Vector2(-L.W / 2 - m, -m), new THREE.Vector2(L.W / 2 + m, -m), new THREE.Vector2(L.W / 2 + m, H + m), new THREE.Vector2(-L.W / 2 - m, H + m)]
            : [new THREE.Vector2(-L.W / 2 - m, 0), new THREE.Vector2(L.W / 2 + m, 0), new THREE.Vector2(L.W / 2 + m, H + m), new THREE.Vector2(-L.W / 2 - m, H + m)];
        const outline = L.outline;
        if (w.kind === 'rose') {
          const g = this.extrude(rect, [outline], w.d - 0.01);
          g.applyMatrix4(F);
          this.add('static', 'stone', g);
        } else {
          // (the outline touches the bottom of the rect: build the infill as one polygon)
          const infill = [new THREE.Vector2(-L.W / 2 - m, 0), ...outline.slice(0, 1).map((p) => p.clone()), ...outline.slice(2).reverse().map((p) => p.clone()), outline[1].clone(), new THREE.Vector2(L.W / 2 + m, 0), new THREE.Vector2(L.W / 2 + m, H + m), new THREE.Vector2(-L.W / 2 - m, H + m)];
          const g = this.extrude(infill, [], w.d - 0.01);
          g.applyMatrix4(F);
          this.add('static', 'stone', g);
        }
        const tr = this.extrude(outline, L.lights.map((l) => l.pts), 0.14, 0.025);
        tr.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, 0.12).premultiply(F));
        this.add('static', 'stone', tr);
        // the sill outside slopes away (a wedge under the window)
        const sill = new THREE.BoxGeometry(L.W + 0.1, 0.1, w.d / 2);
        sill.translate(0, -0.05, w.d / 4);
        sill.applyMatrix4(F);
        this.add('static', 'stone', sill);
        this.buildGlass(w, L, F, n);
      } else {
        // still to be glazed: the iron armature stands in the opening, the outline in iron
        const pts = L.outline.map((p) => new THREE.Vector3(p.x, p.y, 0.12).applyMatrix4(F));
        this.add('static', 'iron', this.tube(pts.slice(1), 0.022, w.kind === 'rose'));
        for (const l of L.lights) this.add('static', 'iron', this.tube(l.pts.map((p) => new THREE.Vector3(p.x, p.y, 0.12).applyMatrix4(F)), 0.014, true, 5));
        if (w.kind === 'rose') {
          // spokes, and the timber that holds it up until the wall reaches it
          for (let k = 0; k < 12; k++) {
            const f = (k / 12) * Math.PI * 2 + Math.PI / 12;
            const a = new THREE.Vector3(Math.cos(f) * L.W * 0.13, L.rose.tc + Math.sin(f) * L.W * 0.13, 0.12).applyMatrix4(F);
            const b = new THREE.Vector3(Math.cos(f) * L.W * 0.5, L.rose.tc + Math.sin(f) * L.W * 0.5, 0.12).applyMatrix4(F);
            this.add('static', 'iron', this.beamGeo(a.toArray(), b.toArray(), [0.03, 0.03]));
          }
          for (const s of [-1, 1]) {
            const a = new THREE.Vector3(s * L.W * 0.42, -w.y0, -0.2).applyMatrix4(F);
            const b = new THREE.Vector3(s * L.W * 0.42, L.H * 0.75, -0.2).applyMatrix4(F);
            this.add('scenter', 'oak', this.beamGeo(a.toArray(), b.toArray(), [0.16, 0.16]));
          }
          const a = new THREE.Vector3(-L.W * 0.55, L.rose.tc * 0.55, -0.12).applyMatrix4(F);
          const b = new THREE.Vector3(L.W * 0.55, L.rose.tc * 0.55, -0.12).applyMatrix4(F);
          this.add('scenter', 'oak', this.beamGeo(a.toArray(), b.toArray(), [0.14, 0.14]));
        } else {
          // the centering for the arch head, resting on two props
          const A = arch(L.W / 2, L.tS, L.H);
          const cpts = [];
          for (let i = 0; i <= 16; i++) {
            const s = -L.W / 2 + (L.W * i) / 16;
            cpts.push(new THREE.Vector3(s, archAt(A, s) - 0.05, -0.15).applyMatrix4(F));
          }
          this.add('scenter', 'board', this.tube(cpts, 0.05, false, 4));
          for (const s of [-1, 1]) {
            const a = new THREE.Vector3(s * (L.W / 2 - 0.1), 0, -0.15).applyMatrix4(F);
            const b = new THREE.Vector3(s * (L.W / 2 - 0.1), L.tS, -0.15).applyMatrix4(F);
            this.add('scenter', 'oak', this.beamGeo(a.toArray(), b.toArray(), [0.1, 0.1]));
          }
        }
        this.armature(w, L, F, 'static');
      }
    }
  }

  /** Iron saddle bars across the lights. */
  armature(w, L, F, partName) {
    for (const l of L.lights) {
      if (l.kind !== 'lancet') continue;
      const A = arch(l.a, l.tS, l.tA);
      for (let t = 0.42; t < l.tA - 0.2; t += 0.42) {
        const hw = archHalf(A, t);
        if (hw < 0.05) continue;
        const a = new THREE.Vector3(l.sc - hw - 0.03, t, 0.1).applyMatrix4(F);
        const b = new THREE.Vector3(l.sc + hw + 0.03, t, 0.1).applyMatrix4(F);
        this.add(partName, 'iron', this.beamGeo(a.toArray(), b.toArray(), [0.022, 0.03]));
      }
    }
  }

  buildGlass(w, L, F, n) {
    const tex = paintGlass(w, L);
    const geos = L.lights.map((l) => {
      const g = new THREE.ShapeGeometry(new THREE.Shape(l.pts), 12);
      const uv = g.attributes.uv;
      const pos = g.attributes.position;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + L.W / 2) / L.W, pos.getY(i) / L.H);
      return g;
    });
    const merged = mergeGeometries(geos);
    const glassF = new THREE.Matrix4().makeTranslation(0, 0, 0.12).premultiply(F);
    merged.applyMatrix4(glassF);
    const sunFacing = n.dot(this.sunLocal) > 0.05 && this.sunLocal.y > 0.02;
    // inside: glowing with the daylight coming through (brighter where the sun stands on it)
    const inner = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, color: 0xffffff, fog: true });
    inner.userData.base = sunFacing ? 1.9 : 1.0;
    this.glassInner.push(inner);
    // outside: dark, glossy coloured glass
    const outer = new THREE.MeshStandardMaterial({ map: tex, color: 0x4a4a58, roughness: 0.12, metalness: 0.35, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.04 });
    const p = this.part(w.part);
    const mi = new THREE.Mesh(merged, inner);
    const mo = new THREE.Mesh(merged, outer);
    mi.userData.glass = true;
    outer.shadowSide = THREE.DoubleSide;
    mo.castShadow = true; // the glass keeps the plain sun out: it comes in coloured (below)
    p.group.add(mi, mo);
    p.isGlass = true;
    this.armature(w, L, F, 'static');
    if (!sunFacing || !tex) return;

    // the sunlight through each light: projected onto the floor and the walls behind
    const S = this.spec;
    const Lt = this.sunLocal.clone().negate(); // the direction the light travels
    const planes = this.lightPlanes();
    const centre = new THREE.Vector3(0, L.H / 2, 0.12).applyMatrix4(F);
    for (const pl of planes) {
      const ax = pl.axis;
      const Lc = Lt.getComponent(ax);
      if (Math.abs(Lc) < 1e-3) continue;
      const tc = (pl.v - centre.getComponent(ax)) / Lc;
      if (tc <= 0.05) continue; // the light goes away from this surface
      // parallel projection along Lt onto the plane x[ax] = v: an affine map
      const P = new THREE.Matrix4().identity();
      const e = P.elements; // column major
      for (let r = 0; r < 3; r++) {
        // x'_r = x_r - Lt_r / Lc * (x_ax - v)
        e[ax * 4 + r] -= Lt.getComponent(r) / Lc;
        e[12 + r] += (Lt.getComponent(r) / Lc) * pl.v;
      }
      const g = merged.clone().applyMatrix4(P);
      g.setAttribute('aFade', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1));
      const mat = lightMaterial(tex, pl.boxes, pl.excl);
      mat.userData.base = 0.85 * Math.abs(Lc); // Lambert: how squarely it strikes the surface
      this.lightMats.push(mat);
      const mesh = new THREE.Mesh(g, mat);
      mesh.renderOrder = 2;
      mesh.userData.noShadow = true;
      mesh.userData.noAO = true; // not a surface: keep it out of the ambient occlusion
      p.group.add(mesh);
    }
    // shafts: the outline of every light swept along the sunlight down to the floor
    const floorT = (q) => (0.012 - q.y) / Lt.y;
    const pos = [];
    const uvs = [];
    const fade = [];
    for (const l of L.lights) {
      const ring = l.pts.map((q) => ({ p: new THREE.Vector3(q.x, q.y, 0.12).applyMatrix4(F), uv: [(q.x + L.W / 2) / L.W, q.y / L.H] }));
      for (let i = 0; i < ring.length; i++) {
        const A = ring[i];
        const B = ring[(i + 1) % ring.length];
        const A2 = A.p.clone().addScaledVector(Lt, floorT(A.p));
        const B2 = B.p.clone().addScaledVector(Lt, floorT(B.p));
        for (const [q, u, f] of [[A.p, A.uv, 0], [B.p, B.uv, 0], [B2, B.uv, 1], [A.p, A.uv, 0], [B2, B.uv, 1], [A2, A.uv, 1]]) {
          pos.push(q.x, q.y, q.z);
          uvs.push(u[0], u[1]);
          fade.push(f);
        }
      }
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    sg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    sg.setAttribute('aFade', new THREE.Float32BufferAttribute(fade, 1));
    const smat = lightMaterial(tex, S.room, [], 0.05);
    smat.userData.base = 1;
    this.lightMats.push(smat);
    const shaft = new THREE.Mesh(sg, smat);
    shaft.renderOrder = 3;
    shaft.userData.noShadow = true;
      shaft.userData.noAO = true; // not a surface: keep it out of the ambient occlusion
    shaft.frustumCulled = false;
    p.group.add(shaft);
  }

  /** The surfaces in the finished interior the coloured light can fall on, with the openings in them. */
  lightPlanes() {
    if (this._planes) return this._planes;
    const S = this.spec;
    const e = 0.012;
    const holes = (axis, v) => {
      const out = [];
      for (const w of S.windows) {
        if (Math.abs(w.o[axis] - v) > S.T * 0.75 + e || axis === 1) continue;
        const n = new THREE.Vector3(w.n[0], 0, w.n[2]);
        const u = new THREE.Vector3(n.z, 0, -n.x);
        const a = new THREE.Vector3(w.o[0], 0, w.o[2]).addScaledVector(u, -w.w / 2);
        const b = new THREE.Vector3(w.o[0], 0, w.o[2]).addScaledVector(u, w.w / 2);
        out.push([Math.min(a.x, b.x) - 0.05, w.y0 - 0.05, Math.min(a.z, b.z) - 0.05, Math.max(a.x, b.x) + 0.05, w.top + 0.05, Math.max(a.z, b.z) + 0.05].map((x, i) => (i % 3 === axis ? (i < 3 ? -99 : 99) : x)));
      }
      for (const o of S.openings) {
        if (Math.abs(o.o[axis] - v) > S.T * 0.75 + e) continue;
        const half = o.w / 2;
        const box = o.u[0] ? [o.o[0] - half, 0, -99, o.o[0] + half, o.h, 99] : [-99, 0, o.o[2] - half, 99, o.h, o.o[2] + half];
        out.push(box);
      }
      return out;
    };
    const { hw, xW, xE, xc, zA, WH, apseR } = S;
    this._planes = [
      { axis: 1, v: e, boxes: S.room, excl: [] },
      { axis: 2, v: -hw + e, boxes: [[xW, 0, -hw - 0.1, xE, WH, -hw + 0.1]], excl: holes(2, -hw) },
      { axis: 2, v: -zA + e, boxes: [[-xc, 0, -zA - 0.1, xc, WH, -zA + 0.1]], excl: holes(2, -zA) },
      { axis: 0, v: xW + e, boxes: [[xW - 0.1, 0, -hw, xW + 0.1, WH, hw]], excl: holes(0, xW) },
      { axis: 0, v: -xc + e, boxes: [[-xc - 0.1, 0, -zA, -xc + 0.1, WH, -hw - S.T]], excl: holes(0, -xc) },
    ];
    void xE;
    void apseR;
    return this._planes;
  }

  // -------- arches through walls

  buildOpenings() {
    const S = this.spec;
    for (const o of S.openings) {
      const F = this.frame(o.o, o.n, 0);
      const a = o.w / 2;
      const A = arch(a, o.spring, o.h);
      const m = S.h;
      const arc = [];
      for (let i = 0; i <= 24; i++) {
        const s = -a + (2 * a * i) / 24;
        arc.push(new THREE.Vector2(s, archAt(A, s)));
      }
      const poly = [new THREE.Vector2(-a - m, o.spring), ...arc, new THREE.Vector2(a + m, o.spring), new THREE.Vector2(a + m, o.h + m), new THREE.Vector2(-a - m, o.h + m)];
      const g = this.extrude(poly, [], o.d - 0.01);
      g.applyMatrix4(F);
      this.add('static', 'stone', g);
      // the moulded arch ring on both faces, and the imposts it springs from
      for (const side of [-1, 1]) {
        const ring = arc.map((p) => new THREE.Vector3(p.x, p.y + 0.06, side * (o.d / 2)).applyMatrix4(F));
        this.add('static', 'rib', this.tube(ring, 0.09));
        for (const s of [-1, 1]) {
          const ib = new THREE.BoxGeometry(0.3, 0.22, 0.2);
          ib.translate(s * (a - 0.05), o.spring - 0.11, side * (o.d / 2));
          ib.applyMatrix4(F);
          this.add('static', 'rib', ib);
          // a slim shaft down the jamb to the floor
          const sh = new THREE.CylinderGeometry(0.07, 0.07, o.spring - 0.22, 10);
          sh.translate(s * (a - 0.02), (o.spring - 0.22) / 2, side * (o.d / 2 - 0.04));
          sh.applyMatrix4(F);
          this.add('static', 'rib', sh);
        }
      }
    }
  }

  // -------- vaults

  buildVaults() {
    const S = this.spec;
    const { ys, yc } = S;
    for (const v of S.vaults) {
      if (v.kind === 'bay') this.bayVault(v.x0, v.x1, v.z0, v.z1, ys, yc, v.boss, 'vault', 'rib', 'static');
      else this.apseVault(v.cx, v.R, ys, yc);
    }
  }

  /** A quadripartite rib vault over a rectangle: the surface of two crossing pointed barrels. */
  bayVault(x0, x1, z0, z1, ys, yc, boss, webMat, ribMat, partName, web = true) {
    const xc = (x0 + x1) / 2;
    const zc = (z0 + z1) / 2;
    const Ax = arch((x1 - x0) / 2, ys, yc);
    const Az = arch((z1 - z0) / 2, ys, yc);
    const y = (x, z) => Math.max(archAt(Ax, x - xc), archAt(Az, z - zc));
    if (web) {
      const n = 28;
      const geo = new THREE.PlaneGeometry(1, 1, n, n);
      const pos = geo.attributes.position;
      const uv = geo.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        const u = pos.getX(i) + 0.5;
        const w = pos.getY(i) + 0.5;
        const x = x0 + (x1 - x0) * u;
        const z = z0 + (z1 - z0) * w;
        pos.setXYZ(i, x, y(x, z), z);
        uv.setXY(i, x * 0.45, (z + y(x, z)) * 0.45);
      }
      geo.computeVertexNormals();
      this.add(partName, webMat, geo);
    }
    // ribs: the two diagonals, transverse arches at both ends, wall ribs along the sides
    const curve = (f, n = 24) => {
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const [x, z] = f(i / n);
        pts.push(new THREE.Vector3(x, y(x, z) - 0.06, z));
      }
      return pts;
    };
    const r = ribMat === 'rib' ? 0.075 : 0.06;
    this.add(partName, ribMat, this.tube(curve((t) => [x0 + (x1 - x0) * t, z0 + (z1 - z0) * t]), r));
    this.add(partName, ribMat, this.tube(curve((t) => [x0 + (x1 - x0) * t, z1 - (z1 - z0) * t]), r));
    for (const x of [x0 + 0.04, x1 - 0.04]) this.add(partName, ribMat, this.tube(curve((t) => [x, z0 + (z1 - z0) * t]), r * 1.25));
    for (const z of [z0 + 0.04, z1 - 0.04]) this.add(partName, ribMat, this.tube(curve((t) => [x0 + (x1 - x0) * t, z]), r * 0.7));
    if (boss) {
      // a gilt boss where the ribs meet
      const b = new THREE.SphereGeometry(0.2, 16, 10);
      b.scale(1, 0.6, 1);
      b.translate(xc, yc - 0.12, zc);
      this.add(partName, 'gold', b);
      const ringG = new THREE.TorusGeometry(0.24, 0.05, 6, 20);
      ringG.rotateX(Math.PI / 2);
      ringG.translate(xc, yc - 0.08, zc);
      this.add(partName, 'rib', ringG);
    } else if (ribMat === 'rib') {
      const b = new THREE.SphereGeometry(0.13, 12, 8);
      b.scale(1, 0.7, 1);
      b.translate(xc, yc - 0.1, zc);
      this.add(partName, 'rib', b);
    }
    return y;
  }

  /** The vault over the half-octagon apse: a pointed dome cut by a lunette over each window. */
  apseVault(cx, R, ys, yc) {
    const a = R * Math.cos(Math.PI / 8); // apothem
    const hf = a * Math.tan(Math.PI / 8); // half a face
    const Ad = arch(R, ys, yc);
    const Al = arch(hf, ys, yc);
    const y = (rho, f) => {
      const k = Math.min(3, Math.max(0, Math.floor((f + Math.PI / 2) / (Math.PI / 4))));
      const th = -Math.PI / 2 + Math.PI / 8 + (k * Math.PI) / 4;
      const edge = a / Math.cos(f - th);
      const s = Math.min(1, rho / edge);
      const u = rho * Math.sin(f - th);
      return Math.max(archAt(Ad, s * R), archAt(Al, u));
    };
    const nr = 16;
    const nf = 48;
    const pos = [];
    const uvs = [];
    const idx = [];
    for (let j = 0; j <= nf; j++) {
      const f = -Math.PI / 2 + (Math.PI * j) / nf;
      const k = Math.min(3, Math.max(0, Math.floor((f + Math.PI / 2) / (Math.PI / 4))));
      const th = -Math.PI / 2 + Math.PI / 8 + (k * Math.PI) / 4;
      const edge = a / Math.cos(f - th);
      for (let i = 0; i <= nr; i++) {
        const rho = (edge * i) / nr;
        const x = cx + rho * Math.cos(f);
        const z = rho * Math.sin(f);
        const yy = y(rho, f);
        pos.push(x, yy, z);
        uvs.push(x * 0.45, (z + yy) * 0.45);
      }
    }
    for (let j = 0; j < nf; j++)
      for (let i = 0; i < nr; i++) {
        const A = j * (nr + 1) + i;
        const B = A + nr + 1;
        idx.push(A, B, A + 1, B, B + 1, A + 1);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.add('static', 'vault', geo);
    // ribs from each corner of the polygon up to the keystone
    for (const deg of [-45, 0, 45]) {
      const f = (deg * Math.PI) / 180;
      const pts = [];
      for (let i = 0; i <= 20; i++) {
        const rho = (R * (20 - i)) / 20;
        pts.push(new THREE.Vector3(cx + rho * Math.cos(f), y(Math.max(rho, 1e-3), f) - 0.06, rho * Math.sin(f)));
      }
      this.add('static', 'rib', this.tube(pts, 0.075));
      // a wall shaft down the corner to the floor
      const sh = new THREE.CylinderGeometry(0.08, 0.08, ys, 10);
      sh.translate(cx + (R - 0.05) * Math.cos(f), ys / 2, (R - 0.05) * Math.sin(f));
      this.add('static', 'rib', sh);
    }
    const b = new THREE.SphereGeometry(0.16, 12, 8);
    b.scale(1, 0.6, 1);
    b.translate(cx, yc - 0.1, 0);
    this.add('static', 'gold', b);
  }

  // -------- the west portal

  buildPortal() {
    const P = this.spec.portal;
    if (!P) return;
    const F = this.frame([P.o[0], 0, P.o[2]], [-1, 0, 0], 0);
    const a = P.w / 2;
    // three orders of archivolts, stepping out from the wall
    for (let k = 0; k < 3; k++) {
      const ak = a + 0.18 + k * 0.2;
      const A = arch(ak, P.h, P.apex + k * 0.2);
      const pts = [];
      for (let i = 0; i <= 24; i++) {
        const s = -ak + (2 * ak * i) / 24;
        pts.push(new THREE.Vector3(s, archAt(A, s), 0.06 + k * 0.1));
      }
      pts.forEach((p) => p.applyMatrix4(F));
      this.add('static', 'rib', this.tube(pts, 0.1));
      for (const s of [-1, 1]) {
        const c = new THREE.CylinderGeometry(0.075, 0.085, P.h, 10);
        c.translate(s * ak, P.h / 2, 0.06 + k * 0.1);
        c.applyMatrix4(F);
        this.add('static', 'rib', c);
        const cap = new THREE.CylinderGeometry(0.13, 0.08, 0.2, 10);
        cap.translate(s * ak, P.h - 0.08, 0.06 + k * 0.1);
        cap.applyMatrix4(F);
        this.add('static', 'rib', cap);
      }
    }
    // the tympanum over the door, with a carved rosette, and the lintel
    const A = arch(a + 0.18, P.h, P.apex);
    const tym = [];
    for (let i = 0; i <= 24; i++) {
      const s = -(a + 0.18) + (2 * (a + 0.18) * i) / 24;
      tym.push(new THREE.Vector2(s, archAt(A, s)));
    }
    tym.reverse();
    const g = this.extrude(tym, [], 0.12);
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, 0.04).premultiply(F));
    this.add('static', 'stone', g);
    const ros = this.extrude(quatrefoil(0, P.h + (P.apex - P.h) * 0.42, 0.42), [circle(0, P.h + (P.apex - P.h) * 0.42, 0.14, 16)], 0.08, 0.02);
    ros.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, 0.12).premultiply(F));
    this.add('static', 'rib', ros);
    const lint = new THREE.BoxGeometry(P.w + 0.5, 0.22, 0.24);
    lint.translate(0, P.h + 0.05, 0.1);
    lint.applyMatrix4(F);
    this.add('static', 'rib', lint);
    // a gable (wimperg) over the portal
    const top = P.apex + 1.5;
    const gab = this.extrude([new THREE.Vector2(-a - 0.75, P.apex - 0.4), new THREE.Vector2(a + 0.75, P.apex - 0.4), new THREE.Vector2(0, top)], [circle(0, P.apex + 0.35, 0.28, 20)], 0.14, 0.02);
    gab.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, 0.25).premultiply(F));
    this.add('static', 'stone', gab);
    const fin = new THREE.ConeGeometry(0.1, 0.4, 8);
    fin.translate(0, top + 0.15, 0.25);
    fin.applyMatrix4(F);
    this.add('static', 'rib', fin);
  }

  // -------- pinnacles and the cornice

  buildPinnacles() {
    const S = this.spec;
    for (const p of S.pinnacles) {
      const [x, y, z] = p;
      const shaft = new THREE.BoxGeometry(0.36, 1.1, 0.36);
      shaft.translate(x, y + 0.55, z);
      this.add('static', 'stone', shaft);
      for (let k = 0; k < 4; k++) {
        // little gables on the four faces
        const gab = new THREE.ConeGeometry(0.2, 0.36, 4, 1);
        gab.rotateY(Math.PI / 4);
        gab.scale(1, 1, 0.35);
        gab.rotateY((k * Math.PI) / 2);
        const d = 0.17;
        gab.translate(x + (k === 1 ? d : k === 3 ? -d : 0), y + 1.2, z + (k === 0 ? d : k === 2 ? -d : 0));
        this.add('static', 'stone', gab);
      }
      const spire = new THREE.ConeGeometry(0.2, 1.5, 8);
      spire.translate(x, y + 1.1 + 0.75, z);
      this.add('static', 'stone', spire);
      // crockets up the spire, a finial on top
      for (let k = 0; k < 4; k++)
        for (let j = 0; j < 4; j++) {
          const yy = y + 1.25 + j * 0.3;
          const rr = 0.2 * (1 - (yy - y - 1.1) / 1.5) + 0.03;
          const a = (k * Math.PI) / 2 + Math.PI / 4;
          const c = new THREE.SphereGeometry(0.045, 6, 4);
          c.translate(x + Math.cos(a) * rr, yy, z + Math.sin(a) * rr);
          this.add('static', 'stone', c);
        }
      const fin = new THREE.SphereGeometry(0.07, 8, 6);
      fin.translate(x, y + 2.65, z);
      this.add('static', 'stone', fin);
    }
    for (const c of S.cornices) {
      const g = this.beamGeo([c.a[0], c.a[1] - 0.12, c.a[2]], [c.b[0], c.b[1] - 0.12, c.b[2]], [0.34, 0.2]);
      if (g) this.add('static', 'rib', g);
      const g2 = this.beamGeo([c.a[0], c.a[1] - 0.28, c.a[2]], [c.b[0], c.b[1] - 0.28, c.b[2]], [0.24, 0.12]);
      if (g2) this.add('static', 'rib', g2);
    }
  }

  // -------- the interior: rosette, pews, altar

  buildInterior() {
    const S = this.spec;
    const tex = paintRosette();
    if (S.symbol) {
      const g = new THREE.CircleGeometry(S.symbol.r, 96);
      g.rotateX(-Math.PI / 2);
      g.translate(...S.symbol.c);
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.32, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
      m.receiveShadow = true;
      m.userData.floor = true;
      this.part('static').extra.push(m);
    }
    for (const p of S.pews) {
      // seat, back, two carved bench ends with poppyheads, a kneeler
      const L = p.z1 - p.z0;
      const zc = (p.z0 + p.z1) / 2;
      this.add(p.part, 'pew', this.boxGeo([p.x - 0.02, 0.45, zc], [0.4, 0.05, L]));
      // (they face the altar, east: the back is on the west side, the kneeler in front)
      const back = new THREE.BoxGeometry(0.04, 0.5, L);
      back.rotateZ(0.12);
      back.translate(p.x - 0.2, 0.75, zc);
      this.add(p.part, 'pew', back);
      this.add(p.part, 'pew', this.boxGeo([p.x + 0.42, 0.12, zc], [0.14, 0.1, L]));
      for (const z of [p.z0 + 0.03, p.z1 - 0.03]) {
        this.add(p.part, 'pew', this.boxGeo([p.x, 0.47, z], [0.5, 0.94, 0.06]));
        const ph = new THREE.SphereGeometry(0.07, 8, 6);
        ph.scale(1, 1.3, 0.6);
        ph.translate(p.x - 0.18, 0.98, z);
        this.add(p.part, 'pew', ph);
      }
    }
    const A = S.altar;
    if (A) {
      const [x, , z] = A.c;
      this.add(A.part, 'stone', this.boxGeo([x, A.hgt / 2 - 0.06, z], [A.w - 0.1, A.hgt - 0.12, A.l - 0.1]));
      this.add(A.part, 'rib', this.boxGeo([x, A.hgt - 0.06, z], [A.w + 0.1, 0.12, A.l + 0.16]));
      this.add(A.part, 'linen', this.boxGeo([x, A.hgt + 0.005, z], [A.w + 0.12, 0.01, A.l + 0.3]));
      this.add(A.part, 'linen', this.boxGeo([x - A.w / 2 - 0.065, A.hgt - 0.2, z], [0.01, 0.4, A.l + 0.3]));
      this.add(A.part, 'gold', this.boxGeo([x - A.w / 2 - 0.072, A.hgt - 0.38, z], [0.008, 0.04, A.l + 0.3]));
      // a gilt cross on a stepped foot, and two candlesticks
      this.add(A.part, 'gold', this.boxGeo([x + 0.1, A.hgt + 0.06, z], [0.18, 0.1, 0.18]));
      this.add(A.part, 'gold', this.boxGeo([x + 0.1, A.hgt + 0.45, z], [0.04, 0.7, 0.04]));
      this.add(A.part, 'gold', this.boxGeo([x + 0.1, A.hgt + 0.62, z], [0.04, 0.04, 0.32]));
      for (const s of [-1, 1]) {
        const cz = z + s * (A.l / 2 - 0.25);
        const st = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.08, 0), new THREE.Vector2(0.03, 0.05), new THREE.Vector2(0.02, 0.25), new THREE.Vector2(0.05, 0.27), new THREE.Vector2(0.045, 0.3), new THREE.Vector2(0, 0.3)], 12);
        st.translate(x, A.hgt + 0.01, cz);
        this.add(A.part, 'gold', st);
        const c = new THREE.CylinderGeometry(0.022, 0.022, 0.3, 10);
        c.translate(x, A.hgt + 0.46, cz);
        this.add(A.part, 'wax', c);
        // a small flame (drawn, flickering)
        const fl = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffc860 }));
        fl.scale.set(1, 2.2, 1);
        fl.position.set(x, A.hgt + 0.64, cz);
        fl.userData.noShadow = true;
      fl.userData.noAO = true; // not a surface: keep it out of the ambient occlusion
        this.flames.push(fl);
        this.part(A.part).extra.push(fl);
      }
    }
  }

  // -------- timber, iron and scaffolding

  buildTimber() {
    const S = this.spec;
    for (const b of S.beams) {
      const g = this.beamGeo(b.a, b.b, b.s, b.round || b.mat === 'pole');
      if (!g) continue;
      this.add(b.part, b.mat === 'iron' ? 'iron' : b.mat === 'pole' ? 'pole' : 'oak', g);
    }
    for (const d of S.boards) {
      // planks with small gaps between them
      const u = new THREE.Vector3(...d.u);
      const v = new THREE.Vector3(...d.v);
      const n = Math.max(1, Math.round(d.w / 0.24));
      for (let k = 0; k < n; k++) {
        const off = -d.w / 2 + ((k + 0.5) * d.w) / n;
        const c = new THREE.Vector3(...d.c).addScaledVector(v, off);
        const len = d.l * (0.96 + 0.04 * Math.sin(k * 7.3));
        const g = new THREE.BoxGeometry(len, d.t, d.w / n - 0.012);
        const uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i), uv.getX(i) * len * 0.8);
        const m = new THREE.Matrix4().makeBasis(u, new THREE.Vector3(0, 1, 0), new THREE.Vector3().crossVectors(u, new THREE.Vector3(0, 1, 0)).normalize()).setPosition(c.x, c.y - d.t / 2, c.z);
        g.applyMatrix4(m);
        this.add(d.part, 'board', g);
      }
    }
    for (const l of S.ladders ?? []) {
      const a = new THREE.Vector3(...l.a);
      const b = new THREE.Vector3(...l.b);
      // two rails 0.45 apart along the wall, rungs every 0.32 m
      const d = new THREE.Vector3(...(l.dir ?? [1, 0, 0]));
      const len = b.y - a.y;
      const at = (p, s, y) => [p.x + d.x * s, y, p.z + d.z * s];
      for (const s of [-0.22, 0.22]) this.add(l.part, 'pole', this.beamGeo(at(a, s, a.y), at(b, s * 0.9, b.y), [0.07, 0.07], true));
      for (let y = 0.3; y < len - 0.1; y += 0.32) this.add(l.part, 'pole', this.beamGeo(at(a, -0.22, a.y + y), at(a, 0.22, a.y + y), [0.04, 0.04], true));
    }
    // the bell, hung from its headstock
    if (S.bell) {
      const pr = [
        [0, 0],
        [0.98, 0],
        [0.98, 0.04],
        [0.9, 0.1],
        [0.72, 0.22],
        [0.6, 0.45],
        [0.56, 0.75],
        [0.5, 0.95],
        [0.3, 1.0],
        [0, 1.0],
      ].map(([x, y]) => new THREE.Vector2(x * S.bell.r, y * S.bell.r * 1.35));
      const g = new THREE.LatheGeometry(pr, 24);
      g.translate(S.bell.p[0], S.bell.p[1] - S.bell.r * 1.35, S.bell.p[2]);
      this.add(S.bell.part, 'bronze', g);
    }
    // a fir bough on the top of the spire frame: the topping out
    if (S.cross) {
      const f = new THREE.ConeGeometry(0.28, 0.9, 8);
      f.translate(S.cross.p[0], S.cross.p[1] + 0.45, S.cross.p[2]);
      this.add('tspire', 'fir', f);
    }
  }

  /** Boards closing the arch from the crossing into the unfinished south arm. */
  buildPartition() {
    const P = this.spec.partition;
    if (!P) return;
    const A = arch(P.w / 2, P.spring, P.h);
    const n = Math.round(P.w / 0.22);
    for (let k = 0; k < n; k++) {
      const s = -P.w / 2 + ((k + 0.5) * P.w) / n;
      const top = archAt(A, Math.abs(s) + P.w / n / 2) - 0.02;
      const g = new THREE.BoxGeometry(P.w / n - 0.008, top, 0.04);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * top * 0.8);
      g.translate(s, top / 2, P.z);
      this.add(P.part, 'board', g);
    }
    for (const y of [0.9, 2.6, 4.2]) {
      const half = y < P.spring ? P.w / 2 : archHalf(A, y);
      this.add(P.part, 'oak', this.boxGeo([0, y, P.z + 0.06], [2 * half - 0.1, 0.12, 0.05]));
    }
  }

  /** The centering of the south arm's vault: the ribs set out in timber, ready for the stone. */
  buildCentering() {
    const C = this.spec.centering;
    if (!C) return;
    const S = this.spec;
    this.bayVault(C.x0, C.x1, C.z0, C.z1, S.ys, S.yc, false, 'board', 'board', C.part, false);
  }

  buildCrane() {
    const C = this.spec.crane;
    if (!C) return;
    const [jx, jy, jz] = C.jib;
    // the pulley block at the end of the jib, the rope down to the load and to the wheel
    const pul = new THREE.CylinderGeometry(0.16, 0.16, 0.08, 14);
    pul.rotateZ(Math.PI / 2);
    pul.translate(jx, jy - 0.25, jz);
    this.add(C.part, 'oak', pul);
    this.add(C.part, 'iron', this.beamGeo([jx - 0.06, jy - 0.1, jz], [jx - 0.06, jy - 0.4, jz], [0.02, 0.06]));
    this.add(C.part, 'iron', this.beamGeo([jx + 0.06, jy - 0.1, jz], [jx + 0.06, jy - 0.4, jz], [0.02, 0.06]));
    const [lx, ly, lz] = C.load;
    this.add(C.part, 'rope', this.beamGeo([jx, jy - 0.4, jz + 0.15], [lx, ly + 0.55, lz], [0.025, 0.025], true));
    // a dressed block hanging in iron tongs
    this.add(C.part, 'block', this.boxGeo([lx, ly, lz], [0.7, 0.4, 0.45]));
    for (const s of [-1, 1]) {
      this.add(C.part, 'iron', this.beamGeo([lx, ly + 0.55, lz], [lx + s * 0.38, ly + 0.15, lz], [0.03, 0.03]));
      this.add(C.part, 'iron', this.beamGeo([lx + s * 0.38, ly + 0.15, lz], [lx + s * 0.36, ly, lz], [0.03, 0.03]));
    }
    // the treadwheel: two rims with spokes, treads between them, on an axle in A-frames
    const [wx, wy, wz] = C.wheel;
    const R = 1.5;
    const cy = wy + R + 0.25;
    for (const s of [-0.5, 0.5]) {
      const rim = new THREE.TorusGeometry(R, 0.05, 6, 40);
      rim.rotateY(Math.PI / 2);
      rim.translate(wx + s, cy, wz);
      this.add(C.part, 'oak', rim);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        this.add(C.part, 'oak', this.beamGeo([wx + s, cy, wz], [wx + s, cy + Math.sin(a) * R, wz + Math.cos(a) * R], [0.06, 0.06]));
      }
      // A-frame
      this.add(C.part, 'oak', this.beamGeo([wx + s * 1.5, wy, wz - 1.0], [wx + s * 0.75, cy, wz], [0.12, 0.12]));
      this.add(C.part, 'oak', this.beamGeo([wx + s * 1.5, wy, wz + 1.0], [wx + s * 0.75, cy, wz], [0.12, 0.12]));
    }
    for (let k = 0; k < 28; k++) {
      const a = (k / 28) * Math.PI * 2;
      this.add(C.part, 'board', this.beamGeo([wx - 0.52, cy + Math.sin(a) * (R - 0.04), wz + Math.cos(a) * (R - 0.04)], [wx + 0.52, cy + Math.sin(a) * (R - 0.04), wz + Math.cos(a) * (R - 0.04)], [0.06, 0.18]));
    }
    this.add(C.part, 'oak', this.beamGeo([wx - 0.85, cy, wz], [wx + 0.85, cy, wz], [0.16, 0.16], true));
    this.add(C.part, 'rope', this.beamGeo([wx, cy + 0.1, wz], [jx, jy - 0.4, jz - 0.15], [0.025, 0.025], true));
  }

  // -------- parts: merge their geometry, find their voxels

  finishParts() {
    const S = this.spec;
    for (const p of this.parts.values()) {
      for (const [k, geos] of Object.entries(p.geos)) {
        const list = geos.filter(Boolean).map((g) => (g.index ? g.toNonIndexed() : g));
        for (const g of list) {
          // only the attributes every geometry has
          for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
          if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
          if (!g.attributes.normal) g.computeVertexNormals();
        }
        if (!list.length) continue;
        const merged = mergeGeometries(list);
        const mesh = new THREE.Mesh(merged, this.M[k]);
        mesh.userData.mat = k;
        p.group.add(mesh);
      }
      for (const e of p.extra) p.group.add(e);
      // its voxels: hidden voxels under its anchor points
      const set = new Set();
      for (const a of S.parts[p.name] ?? []) {
        const i = this.voxelOf(a);
        if (i >= 0 && this.world.mat[i] && this.world.flags[i] & F_HIDDEN) set.add(i);
      }
      p.voxels = [...set];
      p.n0 = p.voxels.length;
      p.char = 0;
    }
  }

  // -------- per frame

  update(dt) {
    this.t += dt;
    // daylight through the glass: as bright as the sun is
    const sun = this.sunLight ? Math.min(1.3, this.sunLight.intensity / 2.4) : 1;
    for (const m of this.lightMats) {
      m.uniforms.strength.value = m.userData.base * sun;
      m.uniforms.time.value = this.t;
    }
    for (const m of this.glassInner) m.color.setScalar(m.userData.base * (0.25 + 0.75 * sun));
    for (const f of this.flames) {
      const k = 1 + 0.15 * Math.sin(this.t * 13 + f.position.z * 9) + 0.08 * Math.sin(this.t * 31);
      f.scale.set(1, 2.2 * k, 1);
    }
    this.check -= dt;
    if (this.check > 0 || !this.world) return;
    this.check = 0.5;
    const w = this.world;
    for (const p of this.parts.values()) {
      if (!p.n0 || !p.group.visible) continue;
      let left = 0;
      let ch = 0;
      for (const i of p.voxels)
        if (w.mat[i]) {
          left++;
          ch += w.char[i];
        }
      // gone (burnt, shattered, blown away): what remains of timber shows as voxels
      if (left < p.n0 * 0.5) {
        p.group.visible = false;
        if (!p.isGlass) for (const i of p.voxels) if (w.mat[i]) w.flags[i] &= ~F_HIDDEN;
        w.geomVersion++;
        continue;
      }
      // charring: blacken the part's materials as its voxels char
      const c = left ? ch / left : 0;
      if (Math.abs(c - p.char) > 0.04) {
        p.char = c;
        p.group.traverse((o) => {
          if (!o.isMesh || !o.userData.mat || o.userData.glass) return;
          if (!o.userData.own) {
            o.material = o.material.clone();
            o.userData.own = true;
            o.userData.c0 = o.material.color.clone();
          }
          o.material.color.copy(o.userData.c0).lerp(new THREE.Color(0x120d0a), Math.min(1, c * 1.1));
        });
      }
    }
  }
}
