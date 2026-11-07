export default {
  label: 'Wood pile / campfire',
  params: {
    arrangement: { value: 'log cabin', options: ['log cabin', 'teepee', 'stack'], label: 'Arrangement' },
    logs: { value: 8, min: 2, max: 30, step: 1, label: 'Number of logs' },
    logLength: { value: 0.7, min: 0.2, max: 2, step: 0.05, label: 'Log length (m)' },
    logRadius: { value: 0.06, min: 0.02, max: 0.2, step: 0.005, label: 'Log radius (m)' },
    moisture: { value: 0.15, min: 0.05, max: 0.8, step: 0.01, label: 'Wood moisture (kg/kg): seasoned 0.15' },
    kindling: { value: true, label: 'Kindling inside' },
    stones: { value: true, label: 'Stone ring' },
  },
  build(p, { h }) {
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
    if (p.stones) {
      const R = L * 0.75 + 0.1;
      const n = Math.max(8, Math.round((2 * Math.PI * R) / 0.16));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        prims.push({ shape: 'sphere', c: [Math.cos(a) * R, 0.04, Math.sin(a) * R], r: Math.max(0.07, h * 0.6), material: 'concrete', color: [0.5, 0.5, 0.48], variation: 0.25 });
      }
    }
    return { prims, ignite: { p: [0, 0.08, 0], radius: Math.max(0.12, h * 1.5), materials: ['twigs', 'wood'] } };
  },
};
