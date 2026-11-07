export default {
  label: 'Grass patch',
  params: {
    width: { value: 6, min: 0.5, max: 40, step: 0.1, label: 'Width X (m)' },
    depth: { value: 6, min: 0.5, max: 40, step: 0.1, label: 'Depth Z (m)' },
    height: { value: 0.3, min: 0.05, max: 1.5, step: 0.05, label: 'Grass height (m)' },
    density: { value: 0.8, min: 0.1, max: 1, step: 0.05, label: 'Density' },
    moisture: { value: 0.1, min: 0.03, max: 1.5, step: 0.01, label: 'Moisture (kg/kg): <0.15 dry, >0.6 green' },
    shape: { value: 'rectangle', options: ['rectangle', 'ellipse'], label: 'Shape' },
    clearRadius: { value: 0, min: 0, max: 10, step: 0.05, label: 'Bare circle in the middle (m)' },
    seed: { value: 1, min: 1, max: 999, step: 1, label: 'Random seed' },
  },
  build(p) {
    // cured grass is straw coloured, green grass is green
    const green = Math.min(1, Math.max(0, (p.moisture - 0.1) / 0.6));
    const color = [0.62 - 0.25 * green, 0.58 - 0.02 * green, 0.28 - 0.1 * green];
    const common = { material: 'grass', mode: 'fill', fill: p.density, moisture: p.moisture, color, variation: 0.18, seed: p.seed };
    const prim =
      p.shape === 'ellipse'
        ? { shape: 'ellipsoid', c: [0, 0, 0], r: [p.width / 2, p.height, p.depth / 2], ...common }
        : { shape: 'box', min: [-p.width / 2, 0, -p.depth / 2], max: [p.width / 2, p.height, p.depth / 2], ...common };
    const prims = [prim];
    if (p.clearRadius > 0) prims.push({ shape: 'cylinder', a: [0, -0.01, 0], b: [0, p.height + 0.01, 0], r: p.clearRadius, mode: 'carve' });
    return { prims, ignite: { p: [-p.width / 2 + 0.3, p.height / 2, 0], radius: 0.35 } };
  },
};
