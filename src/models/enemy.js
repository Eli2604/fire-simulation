/** Where enemies start (they are characters, not voxels). */
export default {
  label: 'Enemies',
  params: {
    count: { value: 3, min: 1, max: 12, step: 1, label: 'Number' },
    spread: { value: 4, min: 0.5, max: 20, step: 0.5, label: 'Spread (m)' },
    level: { value: 0, min: 0, max: 20, step: 0.1, label: 'Floor height (m)' },
    seed: { value: 1, min: 1, max: 999, step: 1, label: 'Random seed' },
  },
  build(p, { rng }) {
    const enemies = [];
    for (let k = 0; k < p.count; k++) {
      const a = rng() * Math.PI * 2;
      const r = rng() * p.spread;
      enemies.push({ p: [Math.cos(a) * r, p.level, Math.sin(a) * r] });
    }
    return { prims: [], enemies };
  },
};
