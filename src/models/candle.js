import { hexToRgb } from './util.js';

export default {
  label: 'Candle',
  params: {
    height: { value: 0.12, min: 0.03, max: 0.4, step: 0.005, label: 'Height (m)' },
    radius: { value: 0.025, min: 0.008, max: 0.08, step: 0.001, label: 'Radius (m)' },
    wax: { value: 'paraffin', options: ['paraffin', 'beeswax'], label: 'Wax' },
    color: { value: '#f2ede0', color: true, label: 'Wax colour' },
    wickLength: { value: 0.012, min: 0.004, max: 0.03, step: 0.001, label: 'Wick above wax (m)' },
    holder: { value: true, label: 'Ceramic holder' },
  },
  build(p, { h }) {
    // in a coarse scene (a crypt at 0.2 m voxels) a candle is far smaller than a voxel: it
    // is drawn (render/torches.js) and simulated as its flame only, a small burner with its
    // light (~80 W: heat, a little soot, the air it uses)
    if (h > p.radius * 1.5) {
      const top = (p.holder ? 0.012 : 0) + p.height + p.wickLength;
      return {
        prims: [],
        heaters: [{ pos: [0, top, 0], power: 80, radius: 0.01, height: 0.05, light: true, label: 'candle', kind: 'candle', candle: { height: p.height, radius: p.radius, wick: p.wickLength, color: p.color, holder: p.holder } }],
      };
    }
    const wax = p.wax === 'beeswax' ? 'beeswax' : 'wax';
    const base = p.holder ? h : 0;
    const prims = [];
    if (p.holder) prims.push({ shape: 'cylinder', a: [0, 0, 0], b: [0, h, 0], r: p.radius * 2.2, material: 'ceramic' });
    prims.push(
      { shape: 'cylinder', a: [0, base, 0], b: [0, base + p.height, 0], r: p.radius, material: wax, color: hexToRgb(p.color), variation: 0.02 },
      { shape: 'cylinder', a: [0, base + h, 0], b: [0, base + p.height + p.wickLength, 0], r: 0.0005, material: 'wick' },
    );
    return {
      prims,
      ignite: { p: [0, base + p.height + p.wickLength - h / 2, 0], radius: h, materials: ['wick'] },
    };
  },
};
