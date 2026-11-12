/**
 * A cup of tea on its saucer: a porcelain cup, tea just poured. Far smaller than the voxels
 * of a scene, it is not voxels: it is drawn (render/tea.js) and its heat is kept on its own
 * (sim/tea.js): it cools into the air round it, steams while it is hot (more in the cold),
 * and in a frost freezes over in the end.
 */
export default {
  label: 'Cup of tea (hot, steaming)',
  params: {
    temp: { value: 85, min: 0, max: 100, step: 1, label: 'Tea temperature (°C)' },
    volume: { value: 0.25, min: 0.05, max: 0.4, step: 0.01, label: 'Tea (litres)' },
    color: { value: '#f1ece2', color: true, label: 'Cup colour' },
    tea: { value: '#7a3d12', color: true, label: 'Tea colour' },
  },
  build(p) {
    return {
      prims: [],
      cups: [{ p: [0, 0, 0], T: p.temp, m: p.volume, color: p.color, tea: p.tea }],
    };
  },
};
