import { hexToRgb } from './util.js';

/**
 * A propane (LPG) cylinder. In a fire the liquid heats up and its vapour
 * pressure climbs (≈8 bar at 20 °C, ≈20 bar at 60 °C). A working relief
 * valve opens at ~17.5 bar and vents burning vapour (a jet flame). The real
 * danger is the shell above the liquid: it is not cooled by liquid, heats
 * up in the flames and loses strength; when it can no longer hold the
 * pressure the cylinder fails: a BLEVE with a fireball and fragments.
 */
export default {
  label: 'Gas cylinder (propane)',
  params: {
    capacity: { value: 11, min: 2, max: 50, step: 0.5, label: 'Propane capacity (kg)' },
    fill: { value: 0.8, min: 0.05, max: 0.85, step: 0.05, label: 'Fill level' },
    reliefValve: { value: 'working', options: ['working', 'blocked'], label: 'Relief valve' },
    color: { value: '#c8402e', color: true, label: 'Colour' },
  },
  build(p, { h }) {
    // liquid propane ~500 kg/m³, cylinders are filled to ~80 %
    const volume = p.capacity / 500 / 0.8;
    const r = 0.15 * Math.cbrt(p.capacity / 11);
    const height = volume / (Math.PI * r * r);
    const t = Math.max(h, 0.003);
    const shell = { material: 'steel', color: hexToRgb(p.color), density: Math.min(1, 0.003 / h), vessel: 'cylinder', variation: 0.03 };
    const level = t + (height - 2 * t) * p.fill;
    const prims = [
      { shape: 'cylinder', a: [0, 0.03, 0], b: [0, 0.03 + height, 0], r, ...shell },
      { shape: 'cylinder', a: [0, 0.03 + t, 0], b: [0, 0.03 + height - t, 0], r: r - t, mode: 'carve' },
      { shape: 'cylinder', a: [0, 0.03 + t, 0], b: [0, 0.03 + level, 0], r: r - t, material: 'propane', vessel: 'cylinder', vesselRole: 'contents' },
      // foot ring and valve with its protective collar
      { shape: 'cylinder', a: [0, 0, 0], b: [0, 0.03, 0], r: r * 0.9, material: 'steel', color: [0.25, 0.25, 0.27], density: 0.2 },
      { shape: 'cylinder', a: [0, 0.03 + height, 0], b: [0, 0.03 + height + 0.06, 0], r: 0.02, ...shell, color: [0.75, 0.62, 0.3] },
    ];
    return {
      prims,
      vessels: {
        cylinder: {
          burstPressure: 1e7, // ~4x the 30 bar test pressure
          ventPressure: p.reliefValve === 'working' ? 1.75e6 : null,
          ventRate: 0.02,
          ullage: 1 - p.fill,
          volume, // m³ of the real cylinder (independent of voxel size)
        },
      },
    };
  },
};
