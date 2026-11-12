/** A free-standing wall (cover on a range): brick or concrete blocks, 1.25 m high by default. */
export default {
  label: 'Wall (cover)',
  params: {
    length: { value: 3, min: 0.5, max: 20, step: 0.1, label: 'Length (m)' },
    height: { value: 1.25, min: 0.4, max: 4, step: 0.05, label: 'Height (m)' },
    thickness: { value: 0.3, min: 0.1, max: 1, step: 0.05, label: 'Thickness (m)' },
    material: { value: 'brick', options: ['brick', 'concrete'], label: 'Material' },
  },
  build(p) {
    const color = p.material === 'brick' ? [0.72, 0.66, 0.56] : [0.66, 0.65, 0.62];
    return { prims: [{ shape: 'box', min: [-p.length / 2, 0, -p.thickness / 2], max: [p.length / 2, p.height, p.thickness / 2], material: p.material, color }] };
  },
};
