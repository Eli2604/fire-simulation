export default {
  label: 'Wooden fence',
  params: {
    length: { value: 5, min: 1, max: 30, step: 0.1, label: 'Length (m)' },
    height: { value: 1.2, min: 0.4, max: 2.5, step: 0.05, label: 'Height (m)' },
    style: { value: 'boards', options: ['boards', 'rails'], label: 'Style' },
    moisture: { value: 0.12, min: 0.05, max: 0.8, step: 0.01, label: 'Wood moisture (kg/kg)' },
  },
  build(p, { h }) {
    const prims = [];
    const L = p.length;
    const wood = { material: 'wood', moisture: p.moisture, color: [0.5, 0.36, 0.24] };
    const n = Math.max(2, Math.round(L / 1.8) + 1);
    for (let k = 0; k < n; k++) {
      const x = -L / 2 + (L * k) / (n - 1);
      prims.push({ shape: 'box', min: [x - 0.05, 0, -0.05], max: [x + 0.05, p.height + 0.1, 0.05], ...wood });
    }
    if (p.style === 'boards') {
      prims.push({ shape: 'box', min: [-L / 2, 0.05, 0.05], max: [L / 2, p.height, 0.05 + Math.max(h, 0.02)], ...wood, density: Math.min(1, 0.02 / h) });
    } else {
      for (const y of [0.3, p.height * 0.6, p.height - 0.05]) prims.push({ shape: 'box', min: [-L / 2, y, 0.05], max: [L / 2, y + 0.1, 0.05 + 0.04], ...wood });
    }
    return { prims, ignite: { p: [-L / 2 + 0.2, 0.4, 0.06], radius: 0.25, power: 4000 } };
  },
};
