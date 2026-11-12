/** A wooden crate: plank walls round an empty inside (it burns, and a blast breaks it up). */
export default {
  label: 'Wooden crate',
  params: {
    size: { value: 1.1, min: 0.3, max: 2.5, step: 0.05, label: 'Size (m)' },
    wall: { value: 0.05, min: 0.02, max: 0.2, step: 0.01, label: 'Plank thickness (m)' },
    moisture: { value: 0.12, min: 0.05, max: 0.6, step: 0.01, label: 'Wood moisture (kg/kg)' },
  },
  build(p, { h }) {
    const s = p.size / 2;
    const t = Math.max(p.wall, h);
    const wood = { material: 'wood', moisture: p.moisture, color: [0.54, 0.41, 0.26] };
    return {
      prims: [
        { shape: 'box', min: [-s, 0, -s], max: [s, t, s], ...wood },
        { shape: 'box', min: [-s, p.size - t, -s], max: [s, p.size, s], ...wood },
        { shape: 'box', min: [-s, 0, -s], max: [-s + t, p.size, s], ...wood },
        { shape: 'box', min: [s - t, 0, -s], max: [s, p.size, s], ...wood },
        { shape: 'box', min: [-s, 0, -s], max: [s, p.size, -s + t], ...wood },
        { shape: 'box', min: [-s, 0, s - t], max: [s, p.size, s], ...wood },
      ],
      ignite: { p: [0, p.size / 2, s], radius: 0.2, power: 3000 },
    };
  },
};
