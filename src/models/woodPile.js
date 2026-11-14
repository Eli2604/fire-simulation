export default {
  label: 'Wood pile / campfire (timber or books)',
  params: {
    fuel: { value: 'timber', options: ['timber', 'books'], label: 'Fuel (timber, or a pile of books)' },
    arrangement: { value: 'log cabin', options: ['log cabin', 'teepee', 'stack'], label: 'Arrangement' },
    logs: { value: 8, min: 2, max: 30, step: 1, label: 'Number of logs' },
    logLength: { value: 0.7, min: 0.2, max: 2, step: 0.05, label: 'Log length (m)' },
    logRadius: { value: 0.06, min: 0.02, max: 0.2, step: 0.005, label: 'Log radius (m)' },
    moisture: { value: 0.15, min: 0.05, max: 0.8, step: 0.01, label: 'Wood moisture (kg/kg): seasoned 0.15' },
    kindling: { value: true, label: 'Kindling inside' },
    stones: { value: true, label: 'Stone ring' },
  },
  build(p, { h }) {
    if (p.fuel === 'books') return bookFire(p, h);
    const prims = [];
    const r = p.logRadius;
    const L = p.logLength;
    const wood = { material: 'wood', moisture: p.moisture };
    if (p.arrangement === 'teepee') {
      const R = L * 0.45;
      const apex = L * 0.85;
      for (let k = 0; k < p.logs; k++) {
        const a = (k / p.logs) * Math.PI * 2;
        prims.push({ shape: 'capsule', a: [Math.cos(a) * R, r, Math.sin(a) * R], b: [Math.cos(a) * r, apex, Math.sin(a) * r], r, ...wood });
      }
    } else if (p.arrangement === 'stack') {
      let left = p.logs;
      let row = 0;
      let perRow = Math.max(1, Math.ceil(Math.sqrt(p.logs * 2)));
      while (left > 0 && perRow > 0) {
        const n = Math.min(perRow, left);
        for (let k = 0; k < n; k++) {
          const z = (k - (n - 1) / 2) * 2 * r * 1.02;
          const y = r + row * r * 1.75;
          prims.push({ shape: 'cylinder', a: [-L / 2, y, z], b: [L / 2, y, z], r, ...wood });
        }
        left -= n;
        perRow--;
        row++;
      }
    } else {
      // log cabin: alternating pairs
      const layers = Math.ceil(p.logs / 2);
      const off = L * 0.35;
      for (let k = 0; k < layers; k++) {
        const y = r + k * r * 1.8;
        for (const s of [-1, 1]) {
          if (k * 2 + (s > 0 ? 1 : 0) >= p.logs) continue;
          if (k % 2 === 0) prims.push({ shape: 'cylinder', a: [-L / 2, y, s * off], b: [L / 2, y, s * off], r, ...wood });
          else prims.push({ shape: 'cylinder', a: [s * off, y, -L / 2], b: [s * off, y, L / 2], r, ...wood });
        }
      }
    }
    if (p.kindling) {
      const kr = Math.max(0.06, L * 0.3 - r);
      prims.push({ shape: 'sphere', c: [0, kr * 0.6, 0], r: kr, material: 'twigs', mode: 'fill', fill: 0.7 });
    }
    stoneRing(prims, p, h);
    return { prims, heaters: closeUp(p, h), ignite: { p: [0, 0.08, 0], radius: Math.max(0.12, h * 1.5), materials: ['twigs', 'wood'] } };
  },
};

function stoneRing(prims, p, h) {
  if (!p.stones) return;
  const R = p.logLength * 0.75 + 0.1;
  const n = Math.max(8, Math.round((2 * Math.PI * R) / 0.16));
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    prims.push({ shape: 'sphere', c: [Math.cos(a) * R, 0.04, Math.sin(a) * R], r: Math.max(0.07, h * 0.6), material: 'concrete', color: [0.5, 0.5, 0.48], variation: 0.25 });
  }
}

// in a coarse scene (an island at 0.4 m voxels) a campfire is a few big voxels: close up
// it gets a world of its own at a few cm (sim/patches.js), started from those voxels.
// (A marker: no heat of its own; its `dir` carries the pile's rotation into the scene.)
function closeUp(p, h) {
  return h > 0.06 ? [{ pos: [0, 0, 0], dir: [1, 0, 0], power: 0, on: false, label: 'campfire', kind: 'campfire', detail: { type: 'campfire', params: { ...p } } }] : [];
}

// cover colours of old books: oxblood, bottle green, navy, tan, black, faded red
const COVERS = [[0.45, 0.12, 0.1], [0.14, 0.3, 0.18], [0.14, 0.18, 0.36], [0.62, 0.48, 0.3], [0.12, 0.11, 0.1], [0.66, 0.26, 0.2], [0.76, 0.7, 0.55]];

/**
 * A fire of books: "Number of logs" books, each about "Log length" long (a big volume ~0.3 m),
 * "Log radius" its half thickness. Log cabin: crossed layers of books; stack: neat piles; teepee:
 * a jumbled heap. Crumpled and torn-out pages in the middle are the kindling (they catch at once;
 * the closed books then char slowly, page by page). Deterministic per pile.
 */
function bookFire(p, h) {
  const prims = [];
  let seed = 1234 + p.logs * 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const L = Math.min(0.45, Math.max(0.12, p.logLength * 0.4)); // a book's height (its long side)
  const W = L * 0.72; // its width
  const T = Math.max(0.02, p.logRadius * 0.9); // its thickness
  const moisture = Math.min(p.moisture, 0.3);
  const book = (cx, y, cz, alongX, k, lean = 0) => {
    const l = L * (0.8 + 0.35 * rnd());
    const w = W * (0.85 + 0.2 * rnd());
    const t = T * (0.6 + 0.9 * rnd());
    const [hx, hz] = alongX ? [l / 2, w / 2] : [w / 2, l / 2];
    prims.push({ shape: 'box', min: [cx - hx, y + lean, cz - hz], max: [cx + hx, y + lean + t, cz + hz], material: 'books', color: COVERS[k % COVERS.length], variation: 0.12, moisture });
    return t;
  };
  if (p.arrangement === 'stack') {
    // piles side by side, books flat
    const piles = Math.max(1, Math.round(Math.sqrt(p.logs / 3)));
    let k = 0;
    for (let q = 0; q < piles && k < p.logs; q++) {
      const cx = (q - (piles - 1) / 2) * W * 1.15;
      let y = 0;
      const n = Math.ceil((p.logs - k) / (piles - q));
      for (let j = 0; j < n && k < p.logs; j++, k++) y += book(cx + (rnd() - 0.5) * 0.03, y, (rnd() - 0.5) * 0.03, false, k);
    }
  } else if (p.arrangement === 'teepee') {
    // a heap: books thrown together, the lower ones spread wide, the upper ones on top of them
    let k = 0;
    let layer = 0;
    while (k < p.logs) {
      const n = Math.max(1, 6 - layer * 2);
      const R = Math.max(0, (L * 0.9) * (1 - layer * 0.35));
      for (let j = 0; j < n && k < p.logs; j++, k++) {
        const a = (j / n) * Math.PI * 2 + layer * 0.7 + rnd() * 0.4;
        book(Math.cos(a) * R * (0.6 + 0.4 * rnd()), layer * T * 1.3, Math.sin(a) * R * (0.6 + 0.4 * rnd()), (j + layer) % 2 === 0, k);
      }
      layer++;
    }
  } else {
    // log cabin: pairs of books crossed layer on layer, a hollow in the middle for the pages
    const off = L * 0.45;
    let y = 0;
    for (let k = 0, layer = 0; k < p.logs; layer++) {
      let top = 0;
      for (const sgn of [-1, 1]) {
        if (k >= p.logs) break;
        top = Math.max(top, layer % 2 === 0 ? book(0, y, sgn * off, true, k) : book(sgn * off, y, 0, false, k));
        k++;
      }
      y += top;
    }
  }
  if (p.kindling) {
    // crumpled and torn-out pages
    const kr = Math.max(0.1, L * 0.6);
    prims.push({ shape: 'sphere', c: [0, kr * 0.55, 0], r: kr, material: 'pages', mode: 'fill', fill: 0.75, variation: 0.08 });
  }
  stoneRing(prims, p, h);
  return { prims, heaters: closeUp(p, h), ignite: { p: [0, 0.06, 0], radius: Math.max(0.18, h * 1.5), materials: ['pages', 'books'] } };
}
