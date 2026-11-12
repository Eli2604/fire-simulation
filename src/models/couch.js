import { hexToRgb } from './util.js';

/**
 * A couch: a wooden frame on short legs, upholstered (polyurethane foam under a woven
 * cover), seat and back cushions, and a wool plaid over one arm. It faces -z (its back at +z).
 * Foam is what makes a couch burn as it does: easy to light, fast, a lot of black smoke.
 */
export default {
  label: 'Couch (upholstered, plaid over an arm)',
  params: {
    width: { value: 2.0, min: 1.2, max: 3, step: 0.1, label: 'Width (m)' },
    color: { value: '#6b4a3a', color: true, label: 'Cover colour' },
    cushions: { value: '#8a6a52', color: true, label: 'Cushion colour' },
    plaid: { value: '#9c2f2a', color: true, label: 'Plaid colour (empty: none)' },
  },
  build(p) {
    const W = p.width / 2;
    const D = 0.45; // half depth
    const cover = hexToRgb(p.color);
    const cush = hexToRgb(p.cushions);
    const up = { material: 'foam', color: cover, variation: 0.03 };
    const prims = [
      // the frame on its legs
      ...[[-W + 0.06, -D + 0.06], [W - 0.06, -D + 0.06], [-W + 0.06, D - 0.06], [W - 0.06, D - 0.06]].map(([x, z]) => ({ shape: 'box', min: [x - 0.03, 0, z - 0.03], max: [x + 0.03, 0.1, z + 0.03], material: 'wood', color: [0.3, 0.2, 0.12] })),
      { shape: 'box', min: [-W, 0.1, -D], max: [W, 0.22, D], material: 'wood', color: [0.35, 0.24, 0.15] },
      // the base and the back, the arms
      { shape: 'box', min: [-W, 0.22, -D], max: [W, 0.36, D], ...up },
      { shape: 'box', min: [-W, 0.22, D - 0.22], max: [W, 0.82, D], ...up },
      { shape: 'box', min: [-W, 0.22, -D], max: [-W + 0.18, 0.6, D], ...up },
      { shape: 'box', min: [W - 0.18, 0.22, -D], max: [W, 0.6, D], ...up },
    ];
    // two seat cushions and two back cushions (a seam between them)
    const inner = W - 0.18;
    for (const s of [-1, 1]) {
      const x0 = s < 0 ? -inner : 0.02;
      const x1 = s < 0 ? -0.02 : inner;
      prims.push(
        { shape: 'box', min: [x0, 0.36, -D + 0.02], max: [x1, 0.47, D - 0.22], material: 'foam', color: cush, variation: 0.03 },
        { shape: 'box', min: [x0, 0.47, D - 0.36], max: [x1, 0.78, D - 0.22], material: 'foam', color: cush, variation: 0.03 },
      );
    }
    // a wool plaid folded over the left arm, hanging down its side and onto the seat
    if (p.plaid) {
      const pc = hexToRgb(p.plaid);
      prims.push(
        { shape: 'box', min: [-W - 0.02, 0.6, -D + 0.1], max: [-W + 0.2, 0.64, D - 0.15], material: 'fabric', color: pc, variation: 0.12 },
        { shape: 'box', min: [-W - 0.04, 0.25, -D + 0.1], max: [-W - 0.01, 0.62, D - 0.15], material: 'fabric', color: pc, variation: 0.12 },
        { shape: 'box', min: [-inner, 0.47, -D + 0.12], max: [-inner + 0.25, 0.5, D - 0.4], material: 'fabric', color: pc, variation: 0.12 },
      );
    }
    return { prims };
  },
};
