/**
 * A whirlpool in the water (sim/stirrers.js): the water going round and in, its surface dipping
 * into a funnel with spiral streaks of foam (render/stirrers.js). It carries round and draws in
 * what floats: loose things, a swimmer. Put it on the sea, a lake or a pond (it finds the
 * surface under it). Optionally a few empty crates floating in it.
 */
export default {
  label: 'Water vortex (whirlpool)',
  params: {
    radius: { value: 6, min: 1, max: 40, step: 0.5, label: 'Radius (m)' },
    strength: { value: 3, min: 0.2, max: 12, step: 0.1, label: 'Rotation speed at the core (m/s)' },
    depth: { value: 1.5, min: 0.1, max: 10, step: 0.1, label: 'Depth of the funnel (m)' },
    direction: { value: 'anticlockwise', options: ['anticlockwise', 'clockwise'], label: 'Turns (seen from above)' },
    inflow: { value: 0.3, min: 0, max: 1, step: 0.05, label: 'Drawn in (share of the rotation)' },
    flotsam: { value: 4, min: 0, max: 16, step: 1, label: 'Floating crates in it' },
  },
  build(p) {
    const loose = [];
    for (let k = 0; k < p.flotsam; k++) {
      const a = (k / Math.max(1, p.flotsam)) * Math.PI * 2 + 0.4;
      const r = p.radius * (0.75 + 0.35 * ((k * 0.618) % 1));
      loose.push({ kind: 'crate', p: [Math.cos(a) * r, 0, Math.sin(a) * r], r: 0.25, half: 0.22, mass: 6, onWater: true });
    }
    return {
      prims: [],
      stirrers: [{ kind: 'vortex', p: [0, 0, 0], radius: p.radius, strength: p.strength, depth: p.depth, dir: p.direction === 'clockwise' ? -1 : 1, inflow: p.inflow }],
      loose,
    };
  },
};
