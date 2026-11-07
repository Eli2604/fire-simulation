export default {
  label: 'Gas burner',
  params: {
    power: { value: 5000, min: 100, max: 100000, step: 100, label: 'Power (W)' },
    flameRadius: { value: 0.08, min: 0.01, max: 1, step: 0.01, label: 'Flame radius (m)' },
    flameHeight: { value: 0.3, min: 0.05, max: 3, step: 0.01, label: 'Flame height (m)' },
    nozzleHeight: { value: 0.1, min: 0.02, max: 1, step: 0.01, label: 'Nozzle height (m)' },
  },
  build(p, { h }) {
    return {
      prims: [{ shape: 'cylinder', a: [0, 0, 0], b: [0, p.nozzleHeight, 0], r: Math.max(0.02, p.flameRadius * 0.5), material: 'steel', color: [0.25, 0.25, 0.28] }],
      heaters: [{ pos: [0, p.nozzleHeight + h, 0], power: p.power, radius: p.flameRadius, height: p.flameHeight }],
    };
  },
};
