/**
 * A wind hose (a tornado, a dust devil; over a fire, a fire whirl): air going round a vertical
 * axis, rising in its core, drawn in along the ground (sim/stirrers.js, into the air model:
 * smoke, flames and hot gas follow it). It travels over the scene, turning back at its edges.
 * Drawn as a funnel of dust and condensation (render/stirrers.js). It lifts light loose things
 * (optionally a few empty crates to show it) and the debris of the fire.
 */
export default {
  label: 'Wind hose / tornado',
  params: {
    radius: { value: 2.5, min: 0.3, max: 20, step: 0.1, label: 'Core radius (m)' },
    height: { value: 18, min: 2, max: 80, step: 1, label: 'Height (m)' },
    spin: { value: 18, min: 1, max: 80, step: 0.5, label: 'Rotation speed at the core (m/s)' },
    updraft: { value: 8, min: 0, max: 40, step: 0.5, label: 'Updraft in the core (m/s)' },
    direction: { value: 'anticlockwise', options: ['anticlockwise', 'clockwise'], label: 'Turns (seen from above)' },
    travel: { value: 0.6, min: 0, max: 15, step: 0.1, label: 'Travel speed (m/s)' },
    heading: { value: 0, min: 0, max: 360, step: 5, label: 'Travels towards (°, 0 = +X, 90 = +Z)' },
    debris: { value: 0, min: 0, max: 12, step: 1, label: 'Light crates lying round it' },
    dust: { value: true, label: 'Dust and condensation (drawn)' },
  },
  build(p) {
    const loose = [];
    for (let k = 0; k < p.debris; k++) {
      const a = (k / Math.max(1, p.debris)) * Math.PI * 2;
      const r = p.radius * (1.2 + 0.8 * ((k * 0.618) % 1));
      loose.push({ kind: 'crate', p: [Math.cos(a) * r, 0.2, Math.sin(a) * r], r: 0.2, half: 0.2, mass: 2 });
    }
    return {
      prims: [],
      stirrers: [{ kind: 'hose', p: [0, 0, 0], radius: p.radius, height: p.height, spin: p.spin, updraft: p.updraft, dir: p.direction === 'clockwise' ? -1 : 1, travel: p.travel, heading: p.heading, dust: p.dust }],
      loose,
    };
  },
};
