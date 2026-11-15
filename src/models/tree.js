/**
 * Trees, generated procedurally from their kind (models/treeKinds.js: the parameters of the
 * generator; the branch structure comes from the seed).
 *
 *  oak    thick trunk forking into heavy limbs, a broad crown of leaf clusters
 *         at the twig ends; dense hardwood whose branches mostly burn in place
 *  willow (weeping) short trunk, limbs rising and arching out, long thin whips
 *         hanging almost to the ground with leaves along them; soft brittle
 *         wood: charred branches snap and drop, burning
 *  pine   straight trunk, whorls of near-horizontal branches getting shorter
 *         towards the top, needle clusters along them, and dead dry branches
 *         low on the trunk; resinous needles carry a crown fire
 *  others (birch, maple, plane, poplar, spruce, fir, apple: 'branching') a leader to the top
 *         with lateral branches (whorled, or spiralled by the divergence angle), or a bole
 *         breaking up into limbs, each branching again by order, bent by gravitropism, their
 *         reach set by the crown's shape; (palm) a leaning stem, arching fronds, a skirt of
 *         dead ones
 *
 * Branches thinner than a voxel get an effective density (real cross-section /
 * voxel cross-section), so they carry the right fuel and burn through quickly.
 * Leaves hang on their twigs: when a branch breaks off (charred past its
 * species' strength), everything beyond it falls.
 */
import { TREE_KINDS, treeKind } from './treeKinds.js';

export default {
  label: 'Tree',
  params: {
    species: { value: 'oak', options: Object.keys(TREE_KINDS), label: 'Kind' },
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
    // (older scenes used 'deciduous' / 'conifer')
    const kind = treeKind(p.species);
    const S = TREE_KINDS[kind];
    const species = S.render; // (the drawn family: render/trees.js)
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
    // dead, self-pruned branches low on the trunk (from `from` up to `to` m), drooping a little
    const deadBranches = (n, from, to) => {
      for (let k = 0; k < n; k++) {
        const y = from + (n > 1 ? ((to - from) * k) / (n - 1) : 0);
        const a = rng() * Math.PI * 2;
        const l = CR * (0.35 + rng() * 0.3);
        seg([0, y, 0], [Math.cos(a) * l, y - l * 0.15, Math.sin(a) * l], 0.025, 'deadWood');
      }
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

    const tree = () => ({ species, kind, skeleton });
    const G = { p, S, h, rng, H, CR, prims, seg, leafBall, trunk, deadBranches, add, norm, tree };
    if (S.form === 'branching') return branching(G);
    if (S.form === 'palm') return palm(G);

    if (S.form === 'pine') {
      trunk(H * 0.97, p.trunkRadius, p.trunkRadius * 0.35);
      const crownBase = H * 0.3;
      // dead, self-pruned branches low on the trunk
      for (let k = 0; k < (p.deadBranches ?? 4); k++) {
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
      return { prims, ignite, tree: tree() };
    }

    if (S.form === 'willow') {
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
      if (p.deadBranches > 0) deadBranches(p.deadBranches, tTop * 0.35, tTop * 0.9);
      ignite = { p: [0, H * 0.25, 0], radius: Math.max(0.3, h * 2), power: 20000 };
      return { prims, ignite, tree: tree() };
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
    if (p.deadBranches > 0) deadBranches(p.deadBranches, tTop * 0.3, tTop * 0.85);
    ignite = { p: [0, tTop * 0.6, 0], radius: Math.max(0.3, h * 2), power: 20000 };
    return { prims, ignite, tree: tree() };
  },
};

const DEG = Math.PI / 180;

/** How far a lateral reaches (of the crown radius) at height f (0 crown base .. 1 top). */
function crownShape(shape, f) {
  if (shape === 'cone') return 1 - f;
  if (shape === 'column') return 0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, f * 1.1 + 0.05));
  if (shape === 'ovoid') return Math.sqrt(Math.max(0, 1 - ((f - 0.35) / 0.68) ** 2));
  return Math.sqrt(Math.max(0, 1 - (2 * f - 1) ** 2)); // round
}

/** A direction `angle` away from axis u, at azimuth `az` round it. */
function spreadFrom(u, angle, az, norm) {
  // a basis across u
  const t = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const v = norm([u[1] * t[2] - u[2] * t[1], u[2] * t[0] - u[0] * t[2], u[0] * t[1] - u[1] * t[0]]);
  const w = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const ca = Math.cos(az);
  const sa = Math.sin(az);
  return norm([0, 1, 2].map((i) => u[i] * c + (v[i] * ca + w[i] * sa) * s));
}

/**
 * The general tree: a leader to the top with laterals (excurrent: conifers, birch, poplar),
 * or a bole that breaks up into limbs (decurrent: maple, plane, fruit trees). Every branch
 * carries `kids` branches of the next order at `branchAngle` from it, turned round it by the
 * divergence angle, `lengthRatio` and `radiusRatio` of it; gravitropism bends each towards
 * the sky (+) or the ground (-) along its length. Leaves (or needles) at the tips, and along
 * the branches for conifers.
 */
function branching({ p, S: K, h, rng, H, CR, seg, leafBall, trunk, deadBranches, add, norm, tree, prims }) {
  const div = (K.divergence ?? 137.5) * DEG;
  const ang = (K.branchAngle ?? 45) * DEG;
  let phase = rng() * Math.PI * 2;
  const leaf = K.leafSize ?? 0.4;
  // a branch: two half-segments, the second bent by gravitropism; then its children
  const limb = (start, dir, len, r, depth) => {
    const mid = add(start, dir, len / 2);
    seg(start, mid, r);
    const d2 = norm([dir[0], dir[1] + (K.gravitropism ?? 0), dir[2]]);
    const end = add(mid, d2, len / 2);
    seg(mid, end, Math.max(0.01, r * 0.75));
    if (K.needlesAlong) leafBall(mid, leaf * 0.8);
    if (depth <= 1 || len < 0.3) {
      leafBall(end, Math.max(leaf, len * 0.7));
      return;
    }
    const kids = K.kids + (rng() < 0.4 ? 1 : 0);
    for (let k = 0; k < kids; k++) {
      phase += div;
      const t = 0.45 + (0.55 * (k + 1)) / kids;
      const from = t < 0.5 ? add(start, dir, len * t) : add(mid, d2, len * (t - 0.5));
      const cd = spreadFrom(t < 0.5 ? dir : d2, Math.min(ang, 70 * DEG) * (0.8 + rng() * 0.4), phase, norm);
      limb(from, cd, len * K.lengthRatio * (0.85 + rng() * 0.3), Math.max(0.01, r * K.radiusRatio), depth - 1);
    }
    if (K.needlesAlong) leafBall(end, Math.max(leaf * 0.8, len * 0.3));
  };
  const S = 1 + K.lengthRatio + K.lengthRatio ** 2; // (how far a limb and its children reach, in limb lengths)
  let crownBase;
  if (K.excurrent) {
    crownBase = H * K.crownBase;
    trunk(H * 0.97, p.trunkRadius, p.trunkRadius * K.taper);
    const top = H * 0.95;
    // where the laterals leave the leader: in whorls, or one by one round it by the divergence
    const at = [];
    if (K.whorl) {
      const n = Math.max(3, Math.round((top - crownBase) / K.whorlGap));
      for (let wi = 0; wi < n; wi++) {
        const nb = K.whorl - 1 + Math.floor(rng() * 3);
        const a0 = rng() * Math.PI * 2;
        for (let b = 0; b < nb; b++) at.push([wi / n, a0 + (b / nb) * Math.PI * 2 + (rng() - 0.5) * 0.4]);
      }
    } else {
      const n = Math.max(4, Math.round(p.branches * K.laterals));
      for (let k = 0; k < n; k++) at.push([(k + rng() * 0.6) / n, (phase += div)]);
    }
    for (const [f, a] of at) {
      const y = crownBase + (top - crownBase) * f;
      const reach = CR * crownShape(K.shape, f) * (0.8 + rng() * 0.3) + 0.2;
      const d = spreadFrom([0, 1, 0], ang, a, norm);
      const r = Math.max(0.015, p.trunkRadius * 0.3 * (1 - f * 0.6));
      limb([0, y, 0], d, reach / (1 + K.lengthRatio * 0.5), r, K.orders);
    }
    leafBall([0, H * 0.96, 0], leaf);
  } else {
    // the bole, then limbs from its top reaching out to the crown's edge and up to its top
    crownBase = H * K.crownBase;
    trunk(crownBase, p.trunkRadius * 1.05, p.trunkRadius * K.taper);
    const up = H * 0.9 - crownBase;
    for (let k = 0; k < p.branches; k++) {
      const a = (k / p.branches) * Math.PI * 2 + rng() * 0.5;
      const out = CR * crownShape(K.shape, 0.5) * (0.75 + rng() * 0.3);
      const d = norm([Math.cos(a) * out, up * (0.7 + rng() * 0.4) * (1 + (K.gravitropism ?? 0)), Math.sin(a) * out]);
      const len = Math.hypot(out, up) / (S * 1.3); // (its children spread it wider)
      limb([0, crownBase * (0.85 + rng() * 0.15), 0], d, len, p.trunkRadius * 0.5, K.orders);
    }
  }
  if (p.deadBranches > 0) deadBranches(p.deadBranches, Math.max(h, crownBase * 0.3), Math.max(h * 2, crownBase * 0.95));
  const ignite = { p: [0, Math.max(h, Math.min(crownBase * 0.6, H * 0.2)), 0], radius: Math.max(0.3, h * 2), power: 20000 };
  return { prims, ignite, tree: tree() };
}

/** A palm: a leaning stem, a crown of arching fronds (leaves along them), dead fronds hanging under it. */
function palm({ p, S: K, h, rng, H, CR, seg, add, norm, tree, prims }) {
  const lean = rng() * Math.PI * 2;
  const bend = H * (0.04 + rng() * 0.06);
  const n = 6;
  const at = (k) => {
    const f = k / n;
    return [Math.cos(lean) * bend * f * f, H * 0.92 * f, Math.sin(lean) * bend * f * f];
  };
  for (let k = 0; k < n; k++) seg(at(k), at(k + 1), p.trunkRadius * (1 - 0.25 * (k / n)), 'bark');
  const top = at(n);
  const frond = (a, rise, droop, dead) => {
    let q = top;
    let d = norm([Math.cos(a), rise, Math.sin(a)]);
    const L = CR / 3;
    for (let s = 0; s < 3; s++) {
      const e = add(q, d, L);
      if (dead) seg(q, e, 0.03, 'deadWood');
      else {
        seg(q, e, 0.025);
        prims.push({ shape: 'capsule', a: q, b: e, r: 0.28, material: K.leaves, mode: 'fill', fill: p.foliageDensity * 0.8, moisture: p.foliageMoisture, color: K.leafColor, variation: 0.18, seed: rng() });
      }
      q = e;
      d = norm([d[0], d[1] - droop, d[2]]);
    }
  };
  for (let k = 0; k < p.branches; k++) frond((k / p.branches) * Math.PI * 2 + rng() * 0.3, 0.5 + rng() * 0.4, 0.55 + rng() * 0.2, false);
  // the skirt: last years' fronds, dry, hanging down the stem
  for (let k = 0; k < (p.deadBranches ?? 0); k++) frond(rng() * Math.PI * 2, -1.6, 0.3, true);
  const ignite = { p: [top[0], top[1] - 0.5, top[2]], radius: Math.max(0.3, h * 2), power: 20000 };
  return { prims, ignite, tree: tree() };
}
