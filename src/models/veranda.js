/**
 * A timber veranda: a plank deck on sleepers, a log wall at the back and half walls at the
 * sides, posts at the front and a shingled roof over it all, open to the front (-z) — to sit
 * out of the snow and the wind and look out over the water.
 */
export default {
  label: 'Veranda (deck, back wall, roof; open at the front)',
  params: {
    width: { value: 3.6, min: 2, max: 8, step: 0.1, label: 'Width (m)' },
    depth: { value: 2.6, min: 1.6, max: 5, step: 0.1, label: 'Depth (m)' },
    height: { value: 2.4, min: 2, max: 3.5, step: 0.1, label: 'Height under the roof (m)' },
  },
  build(p, { h }) {
    const W = p.width / 2;
    const D = p.depth / 2;
    const H = p.height;
    const deck = 0.18; // the deck's top
    const wood = { material: 'wood', color: [0.48, 0.34, 0.22], variation: 0.06 };
    const logs = { material: 'wood', color: [0.44, 0.3, 0.18], variation: 0.08 };
    const t = Math.max(h, 0.12); // a wall's thickness
    const prims = [
      // sleepers on the ground, the plank deck on them
      ...[-W + 0.15, 0, W - 0.15].map((x) => ({ shape: 'box', min: [x - 0.06, 0, -D], max: [x + 0.06, deck - 0.05, D], ...wood })),
      { shape: 'box', min: [-W, deck - 0.05, -D], max: [W, deck, D], ...wood, anchored: true },
      // the log wall at the back, the half walls at the sides (their back half)
      { shape: 'box', min: [-W, deck, D - t], max: [W, H + deck, D], ...logs, anchored: true },
      { shape: 'box', min: [-W, deck, 0], max: [-W + t, H + deck, D], ...logs, anchored: true },
      { shape: 'box', min: [W - t, deck, 0], max: [W, H + deck, D], ...logs, anchored: true },
      // the front posts
      { shape: 'box', min: [-W, deck, -D], max: [-W + 0.12, H + deck, -D + 0.12], ...wood, anchored: true },
      { shape: 'box', min: [W - 0.12, deck, -D], max: [W, H + deck, -D + 0.12], ...wood, anchored: true },
      // the beam over the front, and the roof: rafters under shingles, overhanging all round
      { shape: 'box', min: [-W, H + deck - 0.12, -D], max: [W, H + deck, -D + 0.12], ...wood, anchored: true },
      { shape: 'box', min: [-W - 0.3, H + deck, -D - 0.5], max: [W + 0.3, H + deck + 0.06, D + 0.3], ...wood, anchored: true },
      { shape: 'box', min: [-W - 0.3, H + deck + 0.06, -D - 0.5], max: [W + 0.3, H + deck + 0.12, D + 0.3], material: 'shingles', color: [0.3, 0.27, 0.25], variation: 0.08, anchored: true },
    ];
    return { prims };
  },
};
