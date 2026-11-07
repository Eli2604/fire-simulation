export default {
  label: 'Tree',
  params: {
    species: { value: 'deciduous', options: ['deciduous', 'conifer'], label: 'Species' },
    height: { value: 5, min: 1.5, max: 12, step: 0.1, label: 'Height (m)' },
    trunkRadius: { value: 0.15, min: 0.04, max: 0.6, step: 0.01, label: 'Trunk radius (m)' },
    crownRadius: { value: 1.6, min: 0.4, max: 4, step: 0.05, label: 'Crown radius (m)' },
    foliageDensity: { value: 0.55, min: 0.1, max: 1, step: 0.05, label: 'Foliage density' },
    foliageMoisture: { value: 1.0, min: 0.1, max: 2, step: 0.05, label: 'Foliage moisture (kg/kg)' },
    trunkMoisture: { value: 0.5, min: 0.1, max: 1, step: 0.05, label: 'Wood moisture (kg/kg)' },
    branches: { value: 7, min: 0, max: 20, step: 1, label: 'Branches' },
    seed: { value: 1, min: 1, max: 999, step: 1, label: 'Random seed' },
  },
  build(p, { h, rng }) {
    const prims = [];
    const H = p.height;
    const cr = Math.min(p.crownRadius, H * 0.45);
    const wood = { material: 'bark', moisture: p.trunkMoisture };
    const branchR = Math.max(0.03, p.trunkRadius * 0.35);

    if (p.species === 'conifer') {
      const base = H * 0.18;
      const coneH = H - base;
      prims.push({ shape: 'cylinder', a: [0, 0, 0], b: [0, H * 0.97, 0], r: p.trunkRadius, ...wood });
      for (let k = 0; k < p.branches; k++) {
        const y = base + (coneH * 0.8 * (k + 0.5)) / Math.max(1, p.branches);
        const ang = rng() * Math.PI * 2;
        const len = cr * (1 - (y - base) / coneH) * 0.9;
        prims.push({
          shape: 'capsule', a: [0, y, 0], b: [Math.cos(ang) * len, y - 0.15 * len, Math.sin(ang) * len], r: branchR * 0.8, ...wood,
        });
      }
      prims.push({
        shape: 'cone', base: [0, base, 0], r: cr, height: coneH, material: 'needles', mode: 'fill',
        fill: p.foliageDensity, moisture: p.foliageMoisture, seed: p.seed,
      });
      return { prims, ignite: { p: [0, base + 0.2, 0], radius: Math.max(0.3, h * 2), power: 20000 } };
    }

    const cy = H - cr * 0.85;
    const trunkTop = Math.max(cy, H * 0.5);
    prims.push({ shape: 'cylinder', a: [0, 0, 0], b: [0, trunkTop, 0], r: p.trunkRadius, ...wood });
    for (let k = 0; k < p.branches; k++) {
      const y = Math.max(cy - cr * 0.6, H * 0.35) + rng() * cr * 0.6;
      const ang = rng() * Math.PI * 2;
      const len = cr * (0.55 + rng() * 0.3);
      prims.push({
        shape: 'capsule', a: [0, y, 0], b: [Math.cos(ang) * len, Math.min(H - 0.3, y + len * 0.6), Math.sin(ang) * len],
        r: branchR, ...wood,
      });
    }
    prims.push({
      shape: 'ellipsoid', c: [0, cy, 0], r: [cr, cr * 0.85, cr], material: 'leaves', mode: 'fill',
      fill: p.foliageDensity, moisture: p.foliageMoisture, seed: p.seed,
    });
    return { prims, ignite: { p: [0, cy - cr * 0.6, 0], radius: Math.max(0.3, h * 2), power: 20000 } };
  },
};
