/**
 * A volcano: a cone of basalt with a crater on top and a vent down its middle,
 * old lava flows as ridges down the flanks. It sleeps until something big comes
 * by (the dragon); then it erupts (see sim/volcano.js): a blast clears the crater,
 * lava wells up and runs over the rim and down the slopes, glowing bombs are
 * thrown out, an ash column rises.
 *
 * Only a shell of the cone is voxels (it is hollow inside, like the island's hills).
 */
export default {
  label: 'Volcano',
  params: {
    radius: { value: 6, min: 3, max: 12, step: 0.5, label: 'Base radius (m)' },
    height: { value: 6.5, min: 3, max: 12, step: 0.5, label: 'Height (m)' },
    crater: { value: 1.6, min: 0.6, max: 4, step: 0.1, label: 'Crater radius (m)' },
    triggerDistance: { value: 6, min: 2, max: 40, step: 1, label: 'Erupts when a moving dragon comes within (m)' },
    duration: { value: 180, min: 20, max: 900, step: 10, label: 'Eruption lasts (s)' },
    lavaRate: { value: 1.5, min: 0.1, max: 6, step: 0.1, label: 'Lava (m³/s)' },
    seed: { value: 4, min: 1, max: 999, step: 1, label: 'Random seed' },
  },
  build(p, { h, rng }) {
    const R = p.radius;
    const H = p.height;
    const cr = p.crater;
    const T = Math.max(2 * h, 0.8); // shell thickness
    const rock = { material: 'basalt', anchored: true, variation: 0.1 };
    const prims = [
      // the cone (a little below the ground so it sits in the slope), hollowed out
      { shape: 'cone', base: [0, -4, 0], height: H + 4.6, r: R * 1.3, ...rock, mode: 'fill' },
      // (hollow only in its lower half: the vent and the crater sit in solid rock)
      { shape: 'cone', base: [0, -4, 0], height: (H + 4.6) * 0.6, r: R * 1.3 - T, mode: 'carve' },
      // the crater: a bowl at the top, and the vent below it
      { shape: 'ellipsoid', c: [0, H + 0.3, 0], r: [cr, cr * 0.8, cr], mode: 'carve' },
      { shape: 'cylinder', a: [0, H - 2.5, 0], b: [0, H + 0.5, 0], r: Math.max(h * 1.5, cr * 0.45), mode: 'carve' },
      // the floor of the vent: lava under a crust (it melts and rises when it erupts)
      { shape: 'cylinder', a: [0, H - 2.6, 0], b: [0, H - 2.0, 0], r: Math.max(h * 1.5, cr * 0.5), ...rock, color: [0.25, 0.12, 0.08] },
    ];
    // old lava flows: ridges down the flanks
    for (let k = 0; k < 6; k++) {
      const a = rng() * Math.PI * 2;
      const top = [Math.cos(a) * cr * 1.1, H - 0.3, Math.sin(a) * cr * 1.1];
      const bot = [Math.cos(a) * R * 1.05, 0, Math.sin(a) * R * 1.05];
      prims.push({ shape: 'capsule', a: top, b: bot, r: 0.35 + rng() * 0.3, ...rock, color: [0.12, 0.11, 0.1] });
    }
    return {
      prims,
      volcano: { crater: [0, H - 1.8, 0], rim: H + 0.3, craterRadius: cr, trigger: p.triggerDistance, duration: p.duration, lavaRate: p.lavaRate },
    };
  },
};
