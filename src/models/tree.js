/**
 * Trees built from real branch structures.
 *
 *  oak    thick trunk forking into heavy limbs, a broad crown of leaf clusters
 *         at the twig ends; dense hardwood whose branches mostly burn in place
 *  willow (weeping) short trunk, limbs rising and arching out, long thin whips
 *         hanging almost to the ground with leaves along them; soft brittle
 *         wood: charred branches snap and drop, burning
 *  pine   straight trunk, whorls of near-horizontal branches getting shorter
 *         towards the top, needle clusters along them, and dead dry branches
 *         low on the trunk; resinous needles carry a crown fire
 *
 * Branches thinner than a voxel get an effective density (real cross-section /
 * voxel cross-section), so they carry the right fuel and burn through quickly.
 * Leaves hang on their twigs: when a branch breaks off (charred past its
 * species' strength), everything beyond it falls.
 */
const SPECIES = {
  oak: { wood: 'oak', leaves: 'leaves', leafColor: [0.22, 0.4, 0.13] },
  willow: { wood: 'willow', leaves: 'leaves', leafColor: [0.45, 0.58, 0.22] },
  pine: { wood: 'pine', leaves: 'needles', leafColor: [0.12, 0.3, 0.13] },
};

export default {
  label: 'Tree',
  params: {
    species: { value: 'oak', options: ['oak', 'willow', 'pine'], label: 'Species' },
    height: { value: 7, min: 2, max: 16, step: 0.1, label: 'Height (m)' },
    trunkRadius: { value: 0.22, min: 0.05, max: 0.8, step: 0.01, label: 'Trunk radius (m)' },
    crownRadius: { value: 2.6, min: 0.5, max: 6, step: 0.05, label: 'Crown radius (m)' },
    foliageDensity: { value: 0.6, min: 0.1, max: 1, step: 0.05, label: 'Foliage density' },
    foliageMoisture: { value: 1.0, min: 0.1, max: 2, step: 0.05, label: 'Foliage moisture (kg/kg)' },
    trunkMoisture: { value: 0.5, min: 0.1, max: 1, step: 0.05, label: 'Wood moisture (kg/kg)' },
    branches: { value: 6, min: 2, max: 14, step: 1, label: 'Main branches' },
    seed: { value: 1, min: 1, max: 999, step: 1, label: 'Random seed' },
  },
  build(p, { h, rng }) {
    // older scenes used 'deciduous' / 'conifer'
    const species = p.species === 'conifer' ? 'pine' : p.species === 'deciduous' ? 'oak' : p.species;
    const S = SPECIES[species] ?? SPECIES.oak;
    const prims = [];
    // the skeleton (every trunk and branch segment): drawn as bark by render/trees.js
    const skeleton = [];
    const H = p.height;
    const CR = Math.min(p.crownRadius, H * 0.6);
    const moist = p.trunkMoisture;
    // a branch segment; thin ones get their real cross-section as density
    const seg = (a, b, r, material = S.wood) => {
      const density = r < h / 2 ? Math.max(0.02, (Math.PI * r * r) / (h * h)) : 1;
      prims.push({ shape: 'capsule', a, b, r, material, moisture: material === 'deadWood' ? undefined : moist, density });
      skeleton.push({ a, b, r, dead: material === 'deadWood' });
    };
    const leafBall = (c, r) =>
      prims.push({
        shape: 'sphere', c, r, material: S.leaves, mode: 'fill', fill: p.foliageDensity, moisture: p.foliageMoisture,
        color: S.leafColor, variation: 0.18, seed: rng(),
      });
    const add = (v, d, l) => [v[0] + d[0] * l, v[1] + d[1] * l, v[2] + d[2] * l];
    const norm = (d) => {
      const l = Math.hypot(...d) || 1;
      return [d[0] / l, d[1] / l, d[2] / l];
    };
    // a tapered trunk in a few segments
    const trunk = (top, r0, r1) => {
      const n = 4;
      for (let k = 0; k < n; k++) {
        const y0 = (top * k) / n;
        const y1 = (top * (k + 1)) / n;
        const r = r0 + ((r1 - r0) * (k + 0.5)) / n;
        prims.push({ shape: 'cylinder', a: [0, y0, 0], b: [0, y1 + h * 0.5, 0], r, material: 'bark', moisture: moist });
        skeleton.push({ a: [0, y0, 0], b: [0, y1 + h * 0.5, 0], r: r * (1 + 0.04), r1: r0 + ((r1 - r0) * (k + 1)) / n, trunk: true });
      }
    };
    let ignite;

    if (species === 'pine') {
      trunk(H * 0.97, p.trunkRadius, p.trunkRadius * 0.35);
      const crownBase = H * 0.3;
      // dead, self-pruned branches low on the trunk
      for (let k = 0; k < 4; k++) {
        const y = H * (0.12 + k * 0.045);
        const a = rng() * Math.PI * 2;
        const l = CR * (0.35 + rng() * 0.3);
        seg([0, y, 0], [Math.cos(a) * l, y - l * 0.15, Math.sin(a) * l], 0.025, 'deadWood');
      }
      // whorls of branches, shorter towards the top (cone)
      const whorls = Math.max(3, Math.round((H - crownBase) / 0.6));
      for (let wi = 0; wi < whorls; wi++) {
        const f = wi / whorls;
        const y = crownBase + (H * 0.95 - crownBase) * f;
        const len = CR * (1 - f) * (0.8 + rng() * 0.3) + 0.25;
        const nb = 4 + Math.floor(rng() * 3);
        const a0 = rng() * Math.PI * 2;
        for (let b = 0; b < nb; b++) {
          const a = a0 + (b / nb) * Math.PI * 2 + (rng() - 0.5) * 0.4;
          const d = norm([Math.cos(a), -0.12 - 0.15 * (1 - f), Math.sin(a)]);
          const end = add([0, y, 0], d, len);
          seg([0, y, 0], end, Math.max(0.02, p.trunkRadius * 0.22 * (1 - f * 0.6)));
          // needle clusters along the outer part of the branch, drooping a little at the tip
          const nc = Math.max(1, Math.round(len / 0.45));
          for (let c = 1; c <= nc; c++) leafBall(add([0, y, 0], d, (len * c) / nc), 0.22 + 0.25 * (1 - f) * (c / nc));
        }
      }
      leafBall([0, H * 0.96, 0], 0.35);
      ignite = { p: [0, H * 0.14, 0], radius: Math.max(0.3, h * 2), power: 20000 };
      return { prims, ignite, tree: { species, skeleton } };
    }

    if (species === 'willow') {
      const tTop = H * 0.32;
      trunk(tTop, p.trunkRadius * 1.15, p.trunkRadius * 0.85);
      // limbs rising and arching outwards
      const limbs = p.branches;
      for (let k = 0; k < limbs; k++) {
        const a = (k / limbs) * Math.PI * 2 + rng() * 0.6;
        const out = CR * (0.45 + rng() * 0.25);
        const peak = [Math.cos(a) * out * 0.6, H * (0.85 + rng() * 0.12), Math.sin(a) * out * 0.6];
        const tip = [Math.cos(a) * out, H * (0.78 + rng() * 0.1), Math.sin(a) * out];
        const r = p.trunkRadius * 0.45;
        seg([0, tTop, 0], peak, r);
        seg(peak, tip, r * 0.6);
        // long hanging whips with leaves along them, from the arching limb
        const whips = 5 + Math.floor(rng() * 4);
        for (let wq = 0; wq < whips; wq++) {
          const t = 0.3 + 0.7 * (wq / whips);
          const from = [peak[0] + (tip[0] - peak[0]) * t, peak[1] + (tip[1] - peak[1]) * t, peak[2] + (tip[2] - peak[2]) * t];
          const spread = 0.3 + rng() * 0.5;
          const sa = rng() * Math.PI * 2;
          const mid = [from[0] + Math.cos(sa) * spread * 0.6, from[1] + 0.25, from[2] + Math.sin(sa) * spread * 0.6];
          const drop = from[1] * (0.65 + rng() * 0.3);
          const end = [mid[0] + Math.cos(sa) * spread * 0.4, Math.max(0.4, from[1] - drop), mid[2] + Math.sin(sa) * spread * 0.4];
          seg(from, mid, 0.015);
          seg(mid, end, 0.012);
          // leaves hang as a narrow curtain along the whip
          prims.push({
            shape: 'capsule', a: mid, b: end, r: 0.16, material: S.leaves, mode: 'fill', fill: p.foliageDensity * 0.8,
            moisture: p.foliageMoisture, color: S.leafColor, variation: 0.18, seed: rng(),
          });
        }
      }
      ignite = { p: [0, H * 0.25, 0], radius: Math.max(0.3, h * 2), power: 20000 };
      return { prims, ignite, tree: { species, skeleton } };
    }

    // oak: trunk forking into heavy limbs that branch again; leaf clusters at the ends
    const tTop = H * 0.35;
    trunk(tTop, p.trunkRadius * 1.1, p.trunkRadius * 0.85);
    const grow = (start, dir, len, r, depth) => {
      const end = add(start, dir, len);
      seg(start, end, r);
      if (depth === 0 || len < 0.35) {
        leafBall(end, Math.max(0.45, len * 0.9));
        return;
      }
      const kids = depth === 3 ? 2 : 2 + Math.floor(rng() * 2);
      for (let k = 0; k < kids; k++) {
        const a = rng() * Math.PI * 2;
        const d = norm([dir[0] + Math.cos(a) * 0.75, dir[1] + 0.15 + rng() * 0.25, dir[2] + Math.sin(a) * 0.75]);
        // oaks spread wide: limbs flatten out
        d[1] *= 0.75;
        grow(end, norm(d), len * (0.62 + rng() * 0.12), r * 0.62, depth - 1);
      }
    };
    for (let k = 0; k < p.branches; k++) {
      const a = (k / p.branches) * Math.PI * 2 + rng() * 0.5;
      const up = 0.6 + rng() * 0.35;
      const dir = norm([Math.cos(a), up, Math.sin(a)]);
      grow([0, tTop * (0.85 + rng() * 0.15), 0], dir, CR * 0.55, p.trunkRadius * 0.5, 3);
    }
    ignite = { p: [0, tTop * 0.6, 0], radius: Math.max(0.3, h * 2), power: 20000 };
    return { prims, ignite, tree: { species, skeleton } };
  },
};
