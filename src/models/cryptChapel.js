/**
 * An underground church cut into the limestone (next to the catacombs): a short
 * passage leads in from the catacombs' passage to the west, into a barrel-vaulted
 * nave with pillars along its walls and rows of benches, a raised dais and a stone
 * altar under a wooden cross in a round apse at the far end, torches on the walls.
 * The candles on the altar and on their stands are separate objects (models/candle.js:
 * in a scene this coarse they are drawn, and burn as small flames that light it).
 *
 * Local frame: origin on the floor in the middle of the nave, the nave along z (the
 * altar at +z), the entrance passage leaving west (-x) for `passage` metres.
 */
export default {
  label: 'Underground church (crypt chapel)',
  params: {
    length: { value: 13, min: 8, max: 20, step: 0.5, label: 'Nave length (m)' },
    width: { value: 7.2, min: 4, max: 10, step: 0.2, label: 'Nave width (m)' },
    passage: { value: 8.6, min: 1, max: 15, step: 0.2, label: 'Passage west to the catacombs (m)' },
    benches: { value: 6, min: 0, max: 10, step: 1, label: 'Rows of benches' },
  },
  build(p, { h }) {
    const L = p.length / 2;
    const W = p.width / 2;
    const apseR = Math.min(W * 0.62, 2.4);
    const rock = { material: 'stone', anchored: true, variation: 0.06 };
    // the vault: an elliptical barrel from the tops of the walls (2.6 m) to the crown (3.9 m),
    // cut in slices a little above that curve; the smooth vault is drawn on it
    const SPRING = 2.6;
    const RISE = 1.3;
    const SA = 1.65; // the apse's half dome springs here (its crown stays inside the rock)
    const ashlar = { material: 'ashlar', anchored: true, color: [0.8, 0.76, 0.66], variation: 0.04 };
    const oak = { material: 'oak', color: [0.36, 0.25, 0.15], density: 0.6, anchored: true };
    const prims = [
      // the rock it is cut into (it fills only where there is nothing yet)
      // (from just beyond the passage it opens into, so it does not fill that one)
      { shape: 'box', min: [-p.passage + 1.9, 0, -L - 1.4], max: [W + 1.6, 4.2, L + apseR + 0.8], ...rock, mode: 'fill' },
      // the nave: upright walls, then the barrel vault
      { shape: 'box', min: [-W, 0, -L], max: [W, 2.6, L], mode: 'carve' },
      // the apse: a half-round end with a half dome (cut a little wider than it is drawn:
      // render/cryptVault.js draws its smooth surface in front of the voxels' steps)
      { shape: 'cylinder', a: [0, 0, L], b: [0, SA, L], r: apseR + 0.12, mode: 'carve' },
      { shape: 'sphere', c: [0, SA, L], r: apseR + 0.12, mode: 'carve' },
      // the passage in from the catacombs, and its doorway into the nave
      { shape: 'box', min: [-p.passage - 0.2, 0, -0.9], max: [-W + 0.01, 2.3, 0.9], mode: 'carve' },
      // a dais in the apse, the altar on it, a white cloth on the altar
      { shape: 'box', min: [-apseR - 0.4, 0, L - 1.6], max: [apseR + 0.4, Math.max(h, 0.2), L + apseR], ...ashlar },
      { shape: 'box', min: [-1.0, Math.max(h, 0.2), L - 0.9], max: [1.0, 1.2, L - 0.1], ...ashlar, color: [0.86, 0.82, 0.72] },
      { shape: 'box', min: [-1.05, 1.2, L - 0.95], max: [1.05, 1.2 + h, L - 0.05], material: 'fabric', color: [0.93, 0.92, 0.88], density: 0.2, anchored: true },
      // stone stands for the tall candles either side of the altar
      { shape: 'box', min: [-1.9, 0, L - 0.9], max: [-1.5, 1.0, L - 0.5], ...ashlar },
      { shape: 'box', min: [1.5, 0, L - 0.9], max: [1.9, 1.0, L - 0.5], ...ashlar },
      // the cross on the apse wall
      { shape: 'box', min: [-0.1, 1.2, L + apseR - 0.32], max: [0.1, 2.3, L + apseR - 0.14], ...oak },
      { shape: 'box', min: [-0.42, 1.85, L + apseR - 0.32], max: [0.42, 2.02, L + apseR - 0.14], ...oak },
    ];
    for (let x = -W; x < W - 1e-6; x += h) {
      const xm = Math.min(Math.abs(x), Math.abs(x + h)); // the slice's inner edge: the highest point of the curve over it
      const y = SPRING + RISE * Math.sqrt(Math.max(0, 1 - (xm / W) ** 2)) + h * 0.6;
      prims.push({ shape: 'box', min: [x, SPRING - h, -L], max: [x + h, Math.min(y, 4.0), L], mode: 'carve' });
    }
    // pillars along the walls, carrying the vault's ribs
    for (let z = -L + 1.6; z < L - 0.6; z += 3)
      for (const s of [-1, 1]) {
        prims.push({ shape: 'cylinder', a: [s * (W - 0.25), 0, z], b: [s * (W - 0.25), 2.6, z], r: 0.28, ...ashlar });
        prims.push({ shape: 'box', min: [s * W - 0.4, 2.5, z - 0.3], max: [s * W + 0.4, 2.7, z + 0.3], ...ashlar });
      }
    // rows of benches either side of the aisle, facing the altar
    for (let k = 0; k < p.benches; k++) {
      const z = -L + 1.4 + k * 1.15;
      if (z > L - 2.2) break;
      for (const s of [-1, 1]) {
        const x0 = s > 0 ? 0.6 : -W + 0.7;
        const x1 = s > 0 ? W - 0.7 : -0.6;
        prims.push({ shape: 'box', min: [x0, 0.4, z], max: [x1, 0.4 + h, z + 0.4], ...oak }); // seat
        prims.push({ shape: 'box', min: [x0, 0, z + 0.05], max: [x0 + h, 0.4, z + 0.35], ...oak }); // legs
        prims.push({ shape: 'box', min: [x1 - h, 0, z + 0.05], max: [x1, 0.4, z + 0.35], ...oak });
        prims.push({ shape: 'box', min: [x0, 0.4 + h, z - h], max: [x1, 0.95, z], ...oak }); // back
      }
    }
    // torches on the walls, between the pillars (drawn by render/torches.js, as in the catacombs)
    const heaters = [];
    for (const z of [-L + 3.1, -L + 6.1, -L + 9.1].filter((v) => v < L - 1))
      for (const s of [-1, 1]) {
        const base = [s * (W - 0.02), 1.55, z];
        const tip = [s * (W - 0.32), 1.85, z];
        prims.push(
          { shape: 'box', min: [s > 0 ? W - 0.16 : -W, 1.4, z - 0.08], max: [s > 0 ? W : -W + 0.16, 1.56, z + 0.08], material: 'steel', color: [0.12, 0.11, 0.1], anchored: true, hidden: true },
          { shape: 'capsule', a: base, b: tip, r: Math.max(0.025, h * 0.6), material: 'wood', density: 0.6, color: [0.3, 0.2, 0.12], anchored: true, hidden: true },
          { shape: 'sphere', c: tip, r: Math.max(0.06, h * 0.8), material: 'wood', density: 0.9, moisture: 0, color: [0.12, 0.07, 0.04], anchored: true, hidden: true },
        );
        heaters.push({ pos: [tip[0], tip[1] + 0.05, tip[2]], power: 1500, radius: 0.05, height: 0.35, light: true, label: 'torch' });
      }
    return { prims, heaters, props: [{ type: 'cryptVault', p: [0, 0, 0], W, L, spring: SPRING, rise: RISE, apseR, apseSpring: SA }] };
  },
};
