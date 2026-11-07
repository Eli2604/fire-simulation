export default {
  label: 'Metal bar on burner',
  params: {
    material: { value: 'steel', options: ['steel', 'aluminium', 'copper'], label: 'Metal' },
    length: { value: 1.0, min: 0.2, max: 3, step: 0.01, label: 'Length (m)' },
    thickness: { value: 0.04, min: 0.01, max: 0.2, step: 0.005, label: 'Thickness (m)' },
    elevation: { value: 0.25, min: 0.1, max: 1, step: 0.01, label: 'Height above ground (m)' },
    burnerPower: { value: 3000, min: 0, max: 30000, step: 100, label: 'Burner power (W)' },
    burnerAt: { value: 0.08, min: 0, max: 1, step: 0.01, label: 'Burner position along bar' },
    supports: { value: true, label: 'Brick supports' },
  },
  build(p, { h }) {
    const L = p.length;
    const th = p.thickness;
    const y = p.elevation;
    const prims = [{ shape: 'box', min: [-L / 2, y, -th / 2], max: [L / 2, y + th, th / 2], material: p.material }];
    if (p.supports) {
      for (const sx of [-L * 0.25, L * 0.35]) {
        prims.push({ shape: 'box', min: [sx - 0.04, 0, -0.06], max: [sx + 0.04, y - h * 0.01, 0.06], material: 'brick', anchored: true });
      }
    }
    const bx = -L / 2 + p.burnerAt * L;
    const nozzleTop = Math.max(h, y - 0.12);
    prims.push({ shape: 'cylinder', a: [bx, 0, 0], b: [bx, nozzleTop, 0], r: 0.02, material: 'steel', color: [0.25, 0.25, 0.28] });
    const heaters =
      p.burnerPower > 0
        ? [{ pos: [bx, nozzleTop + h, 0], power: p.burnerPower, radius: Math.max(0.04, th * 1.2), height: y + th + 0.08 - nozzleTop }]
        : [];
    return { prims, heaters };
  },
};
