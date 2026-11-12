/**
 * A small round side table in oak: a top on a turned pedestal and a cross foot.
 * Put a cup of tea, a candle or a book on it with `y: 'auto'`.
 */
export default {
  label: 'Side table (oak, round)',
  params: {
    height: { value: 0.55, min: 0.35, max: 0.9, step: 0.01, label: 'Height (m)' },
    radius: { value: 0.28, min: 0.15, max: 0.6, step: 0.01, label: 'Top radius (m)' },
    book: { value: true, label: 'A book on it' },
  },
  build(p) {
    const H = p.height;
    const R = p.radius;
    const oak = { material: 'wood', color: [0.42, 0.28, 0.16], variation: 0.04 };
    const prims = [
      { shape: 'box', min: [-R * 0.8, 0, -0.03], max: [R * 0.8, 0.04, 0.03], ...oak },
      { shape: 'box', min: [-0.03, 0, -R * 0.8], max: [0.03, 0.04, R * 0.8], ...oak },
      { shape: 'cylinder', a: [0, 0, 0], b: [0, H - 0.03, 0], r: 0.035, ...oak },
      { shape: 'cylinder', a: [0, H - 0.03, 0], b: [0, H, 0], r: R, ...oak },
    ];
    // a paperback, off to the side (where the cup is not)
    if (p.book) prims.push({ shape: 'box', min: [-R * 0.75, H, -R * 0.35], max: [-R * 0.15, H + 0.03, R * 0.35], material: 'paper', color: [0.25, 0.33, 0.45], variation: 0.05 });
    return { prims };
  },
};
