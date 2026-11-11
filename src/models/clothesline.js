/**
 * A washing line in the garden: two wooden T-posts, a line between them, and the wash
 * hanging on it: a bedsheet folded over the line, towels, shirts (polyester: they melt
 * and drip before they burn), jeans, a pillowcase, socks. Wet from the machine, it dries
 * in the sun and the wind (cotton: models its moisture as dead fuel); dry, a spark sets
 * it alight and the fire runs along the line.
 *
 * Every garment is voxels of its cloth (hidden), held up where it is pegged to the line:
 * burnt through at the top, the rest falls. render/laundry.js draws the cloth over them,
 * folds, colours and the sway in the wind, and burns holes in it where its voxels go.
 *
 * Local frame: the line along x from -length/2 to +length/2 at height `height`, z = 0.
 */
const WASH = [
  // kind, width (m), drop (m), material, colour
  { kind: 'sheet', w: 1.5, drop: 1.05, mat: 'cotton', color: '#f2f1ec' },
  { kind: 'towel', w: 0.55, drop: 0.85, mat: 'cotton', color: '#3f6fa8' },
  { kind: 'shirt', w: 0.5, drop: 0.72, mat: 'polyester', color: '#c84a3a' },
  { kind: 'jeans', w: 0.42, drop: 1.0, mat: 'cotton', color: '#34495e' },
  { kind: 'towel', w: 0.5, drop: 0.8, mat: 'cotton', color: '#e9c46a' },
  { kind: 'shirt', w: 0.48, drop: 0.7, mat: 'polyester', color: '#5d8a5e' },
  { kind: 'pillow', w: 0.5, drop: 0.65, mat: 'cotton', color: '#e8dfd0' },
  { kind: 'sock', w: 0.1, drop: 0.32, mat: 'cotton', color: '#2b2b2b' },
  { kind: 'sock', w: 0.1, drop: 0.32, mat: 'cotton', color: '#2b2b2b' },
];

/** The flat pieces of a garment (rectangles in the x-y plane, top at y = 0, x from 0): [x0, y0, x1, y1]. */
export function garmentShape(g) {
  const { w, drop } = g;
  switch (g.kind) {
    case 'shirt':
      // body, two sleeves hanging from the shoulders
      return [
        [0, -drop, w, 0],
        [-0.16, -0.42, 0, -0.04],
        [w, -0.42, w + 0.16, -0.04],
      ];
    case 'jeans': {
      // the waistband, two legs with a gap between them
      const leg = w * 0.45;
      return [
        [0, -0.3, w, 0],
        [0, -drop, leg, -0.3],
        [w - leg, -drop, w, -0.3],
      ];
    }
    default:
      return [[0, -drop, w, 0]];
  }
}

export default {
  label: 'Washing line with laundry',
  params: {
    length: { value: 5, min: 2, max: 10, step: 0.5, label: 'Line length (m)' },
    height: { value: 1.9, min: 1.4, max: 2.4, step: 0.05, label: 'Line height (m)' },
    wet: { value: 0.8, min: 0, max: 1.5, step: 0.05, label: 'Wet from the machine (water per dry weight)' },
    sparkAfter: { value: 300, min: 0, max: 3600, step: 10, label: 'A spark lands at the foot of the sheet after (s; 0: none)' },
    seed: { value: 3, min: 1, max: 999, step: 1, label: 'Random seed' },
  },
  build(p, { h }) {
    const L = p.length;
    const H = p.height;
    const wood = { material: 'wood', color: [0.42, 0.32, 0.22], anchored: true };
    const prims = [
      // the posts and their cross arms
      { shape: 'cylinder', a: [-L / 2, 0, 0], b: [-L / 2, H + 0.12, 0], r: 0.045, ...wood },
      { shape: 'cylinder', a: [L / 2, 0, 0], b: [L / 2, H + 0.12, 0], r: 0.045, ...wood },
      { shape: 'box', min: [-L / 2 - 0.04, H, -0.3], max: [-L / 2 + 0.04, H + 0.08, 0.3], ...wood },
      { shape: 'box', min: [L / 2 - 0.04, H, -0.3], max: [L / 2 + 0.04, H + 0.08, 0.3], ...wood },
    ];
    // the wash along the line, a little apart
    const placed = [];
    let x = -L / 2 + 0.3;
    for (const g of WASH) {
      if (x + g.w > L / 2 - 0.2) break;
      placed.push({ ...g, x0: x });
      x += g.w + (g.kind === 'shirt' ? 0.4 : 0.12);
    }
    // cloth: about half a millimetre (its density says how much of a voxel it fills)
    const thin = Math.min(1, 0.0006 / h);
    for (const g of placed) {
      const top = H - 0.01;
      // a sheet hangs folded over the line: two layers (in front and behind)
      const layers = g.kind === 'sheet' ? [-h * 0.5, h * 0.5] : [0];
      for (const zc of layers)
        for (const [ax, ay, bx, by] of garmentShape(g))
          prims.push({
            shape: 'box',
            min: [g.x0 + ax, top + ay, zc - h * 0.5],
            max: [g.x0 + bx, top + by, zc + h * 0.5],
            material: g.mat,
            density: thin * (g.kind === 'jeans' || g.kind === 'towel' ? 3 : 1),
            moisture: g.mat === 'cotton' ? p.wet : Math.min(0.2, p.wet * 0.15),
            color: hexRgb(g.color),
            hidden: true,
          });
      // held by its pegs at the line: the top row
      prims.push({ shape: 'box', min: [g.x0, top - h, -h], max: [g.x0 + g.w, top + 0.005, h], material: g.mat, density: thin, moisture: p.wet, color: hexRgb(g.color), hidden: true, anchored: true, mode: 'replace' });
    }
    // a spark (from a barbecue, a cigarette) at the hem of the first garment, after a while: it
    // catches only if the cloth has dried enough by then
    const first = placed[0];
    const heaters = p.sparkAfter > 0 && first
      ? [{ pos: [first.x0 + first.w * 0.3, H - 0.01 - first.drop + 0.02, 0], power: 800, radius: 0.02, height: 0.06, start: p.sparkAfter, until: p.sparkAfter + 20, label: 'a spark', igniteRadius: 0.06, igniteDry: true }]
      : [];
    return {
      prims,
      heaters,
      props: [{ type: 'statueMesh', procedural: 'laundry', wash: placed, line: { L, H }, materials: ['cotton', 'polyester'], p: [0, 0, 0], radius: L / 2 + 1, sway: true }],
    };
  },
};

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
