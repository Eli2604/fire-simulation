/**
 * A water mill: a small mill house of rubble stone with a timbered gable and a shingle roof,
 * millstones, a hopper and sacks inside, and an undershot water wheel on its river side, its
 * axle through the wall to the gearing. The wheel's outer bearing sits on a low stone wall in
 * the river (the race wall): it narrows the river at the wheel, so the water runs faster
 * there (sim/river.js: v = Q / A).
 *
 * Put it on a river bank with the river along +x (downstream) at its +z side, the wheel's
 * paddles in the water (`axleHeight`: the axle above the floor; the floor is the object's
 * y). The wheel turns with the water (sim/river.js: drag on its paddles, its inertia, the
 * friction of the gearing and the stones): it stops when the river is dammed or dry, when
 * the ice grips it, when it is lifted out of the water. In a whirlpool's current it turns
 * too. Drawn turning (render/waterworks.js); its axle is voxels (hidden): burnt or blown
 * through, the wheel is gone.
 *
 * Local frame: origin on the floor in the middle of the house, x along the river, the
 * river at +z, y up.
 */
export default {
  label: 'Water mill',
  params: {
    width: { value: 4.4, min: 3, max: 8, step: 0.1, label: 'House length along the river (m)' },
    depth: { value: 3.6, min: 2.5, max: 7, step: 0.1, label: 'House depth (m)' },
    wallHeight: { value: 2.6, min: 2, max: 4, step: 0.1, label: 'Wall height (m)' },
    wheelRadius: { value: 1.2, min: 0.5, max: 3, step: 0.05, label: 'Wheel radius (m)' },
    wheelWidth: { value: 1, min: 0.3, max: 2, step: 0.05, label: 'Wheel width (m)' },
    paddles: { value: 12, min: 6, max: 24, step: 1, label: 'Paddles' },
    paddleDepth: { value: 0.4, min: 0.1, max: 0.8, step: 0.05, label: 'Paddle depth (m)' },
    axleHeight: { value: 0.4, min: -2, max: 3, step: 0.05, label: 'Axle above the floor (m)' },
    raceWall: { value: true, label: 'Race wall in the river (outer bearing)' },
    grinding: { value: true, label: 'Millstones grinding (a load on the wheel)' },
  },
  build(p, { h }) {
    const W = p.width / 2;
    const D = p.depth / 2;
    const t = Math.max(h, 0.45); // rubble stone walls
    const wh = p.wallHeight;
    const sh = Math.min(wh, 1.8); // stone up to here, then the timbered part
    const stone = { material: 'stone', color: [0.55, 0.52, 0.46], variation: 0.12, anchored: true };
    const timber = { material: 'wood', color: [0.42, 0.3, 0.2], variation: 0.08 };
    const prims = [
      // the footing: down into the bank wherever it is lower
      { shape: 'box', min: [-W, -2.4, -D], max: [W, 0, D], ...stone, mode: 'fill' },
      // floor of stone flags
      { shape: 'box', min: [-W, -h, -D], max: [W, 0, D], ...stone, color: [0.5, 0.48, 0.44] },
      { shape: 'box', min: [-W, 0, -D], max: [W, sh, D], ...stone },
      { shape: 'box', min: [-W, sh, -D], max: [W, wh, D], ...timber, density: 0.5 },
      { shape: 'box', min: [-W + t, 0.01, -D + t], max: [W - t, wh + 0.01, D - t], mode: 'carve' },
      // the loft floor
      { shape: 'box', min: [-W, wh, -D], max: [W, wh + Math.min(h, 0.2), D], material: 'wood', density: Math.min(1, 0.03 / h) },
    ];
    // the roof: ridge along the river, shingles on boards; timbered gable ends
    const oh = 0.35;
    const pitch = (45 * Math.PI) / 180;
    const half = D + oh;
    const rise = half * Math.tan(pitch);
    const y0 = wh + h - oh * Math.tan(pitch);
    prims.push(
      { shape: 'gable', x0: -W - oh, x1: W + oh, y0, half, rise, shell: h * 2.2, material: 'wood', density: Math.min(1, 0.03 / h), color: [0.4, 0.3, 0.2] },
      { shape: 'gable', x0: -W - oh, x1: W + oh, y0, half, rise, shell: h * 1.05, material: 'shingles', mode: 'replace', color: [0.36, 0.3, 0.26] },
      { shape: 'gable', x0: -W, x1: -W + t, y0: wh, half: D, rise: D * Math.tan(pitch), ...timber, mode: 'fill', density: 0.5 },
      { shape: 'gable', x0: W - t, x1: W, y0: wh, half: D, rise: D * Math.tan(pitch), ...timber, mode: 'fill', density: 0.5 },
    );
    // the door (land side), a window at each end, a small one over the wheel
    prims.push(
      { shape: 'box', min: [-0.5, 0.01, -D - 0.05], max: [0.5, 2.0, -D + t + 0.05], mode: 'carve' },
      { shape: 'box', min: [-0.5, 0.01, -D + t * 0.4], max: [0.5, 2.0, -D + t * 0.6], material: 'wood', color: [0.36, 0.22, 0.13], density: Math.min(1, 0.05 / h) },
      { shape: 'box', min: [-W - 0.05, 1.0, -0.4], max: [-W + t + 0.05, 1.7, 0.4], mode: 'carve' },
      { shape: 'box', min: [W - t - 0.05, 1.0, -0.4], max: [W + 0.05, 1.7, 0.4], mode: 'carve' },
      { shape: 'box', min: [-W + t * 0.4, 1.0, -0.4], max: [-W + t * 0.6, 1.7, 0.4], material: 'glass', density: Math.min(1, 0.006 / h) },
      { shape: 'box', min: [W - t * 0.6, 1.0, -0.4], max: [W - t * 0.4, 1.7, 0.4], material: 'glass', density: Math.min(1, 0.006 / h) },
    );
    // inside: the millstones on their wooden stand (the hurst), the hopper over them, sacks
    const mx = -0.3;
    const mz = 0.2;
    prims.push(
      { shape: 'box', min: [mx - 0.8, 0, mz - 0.8], max: [mx + 0.8, 0.5, mz + 0.8], material: 'wood', density: 0.4, color: [0.45, 0.33, 0.22] },
      { shape: 'cylinder', a: [mx, 0.5, mz], b: [mx, 0.75, mz], r: 0.6, material: 'stone', color: [0.62, 0.6, 0.56] },
      { shape: 'cylinder', a: [mx, 0.75, mz], b: [mx, 0.95, mz], r: 0.58, material: 'stone', color: [0.66, 0.64, 0.6] },
      { shape: 'cone', base: [mx, 1.25, mz], r: 0.4, height: 0.5, material: 'wood', density: 0.15, color: [0.5, 0.38, 0.25] },
      { shape: 'box', min: [W - t - 0.7, 0, -D + t + 0.1], max: [W - t - 0.1, 0.8, -D + t + 0.6], material: 'fabric', color: [0.78, 0.72, 0.58] },
      { shape: 'box', min: [W - t - 0.7, 0, -D + t + 0.7], max: [W - t - 0.1, 0.7, -D + t + 1.2], material: 'fabric', color: [0.8, 0.75, 0.6] },
    );
    // the wheel: beside the river-side wall, its axle through the wall to the gearing
    const R = p.wheelRadius;
    const ww = p.wheelWidth;
    const z0 = D + 0.2;
    const z1 = z0 + ww;
    const ay = p.axleHeight;
    const race = p.raceWall;
    const zr = z1 + 0.2;
    prims.push({ shape: 'cylinder', a: [0, ay, mz], b: [0, ay, race ? zr + 0.2 : z1 + 0.1], r: 0.14, material: 'wood', color: [0.4, 0.3, 0.2], hidden: true });
    if (race) {
      const top = ay - R + p.paddleDepth + 0.3; // (above the water)
      const tw = Math.max(h, 0.45);
      prims.push(
        { shape: 'box', min: [-R - 0.6, Math.min(-2.4, ay - R - 1.6), zr], max: [R + 0.6, top, zr + tw], ...stone },
        // the outer bearing on it
        { shape: 'box', min: [-0.3, top, zr], max: [0.3, ay - 0.1, zr + tw], ...stone },
      );
    }
    return {
      prims,
      mills: [
        {
          label: 'water wheel',
          p: [0, ay, (z0 + z1) / 2],
          axis: [0, 0, 1],
          radius: R,
          width: ww,
          paddle: p.paddleDepth,
          paddles: p.paddles,
          cd: 1.8, // a flat paddle across the flow
          // the wheel (~400 kg of oak), the pit wheel and the stone nut, the runner stone geared
          // up ~6×: as felt at the wheel's axle (kg·m²)
          inertia: 450 * R * R + (p.grinding ? 1100 : 300),
          friction: p.grinding ? 45 : 15, // N·m: bearings and gears, and the stones grinding
          damping: 30, // N·m per rad/s
        },
      ],
      ignite: { p: [W - t - 0.4, 0.5, -D + t + 0.4], radius: 0.4, materials: ['fabric'], power: 6000 },
    };
  },
};
