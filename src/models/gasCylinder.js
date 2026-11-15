import { hexToRgb } from './util.js';

/**
 * A liquefied-gas (LPG: propane or butane) cylinder, a pressure vessel simulated as one
 * (sim/vessels.js, its lumped model: the real cylinder's mass, volume and wall, whatever the
 * voxel size).
 *
 * In a fire the liquid heats up through the wall it wets and its vapour pressure climbs
 * (propane ≈ 8 bar at 20 °C, 17 at 50, 26 at 70). A working relief valve opens at 17.5 bar and
 * vents vapour, which burns as a jet flame (a torch from the valve) and boils the liquid cooler.
 * The danger is the wall above the liquid: only vapour behind it, it heats up in the flames and
 * loses its strength (steel above ~400 °C); as the valve vents, the level drops and more wall
 * dries out. When the pressure exceeds what the hot wall still holds, or the liquid swells till
 * the cylinder is full of it with the valve blocked (hydraulic rupture), it fails: a BLEVE, a
 * fireball (D ≈ 5.8·m^(1/3)), a blast and fragments.
 *
 * valve: the cylinder's own valve: closed, or open with the gas burning at it (a torn hose).
 * reliefValve: working, or blocked (painted over, corroded, an old cylinder without one).
 */
export const GASES = {
  propane: { material: 'propane', color: '#c8402e', label: 'propane' },
  butane: { material: 'butane', color: '#3a6fb0', label: 'butane' },
};

export default {
  label: 'Gas cylinder (LPG)',
  params: {
    gas: { value: 'propane', options: Object.keys(GASES), label: 'Gas' },
    capacity: { value: 11, min: 2, max: 50, step: 0.5, label: 'Size: gas when full (kg)' },
    fill: { value: 0.8, min: 0.05, max: 0.85, step: 0.05, label: 'Fill level (liquid share of the volume)' },
    valve: { value: 'closed', options: ['closed', 'open (lit)'], label: 'Cylinder valve' },
    reliefValve: { value: 'working', options: ['working', 'blocked'], label: 'Relief valve' },
    color: { value: '#c8402e', color: true, label: 'Colour' },
  },
  build(p, { h }) {
    const gas = GASES[p.gas] ?? GASES.propane;
    // a cylinder is filled to ~80 % of its volume with liquid at 15 °C
    const rho = gas.material === 'butane' ? 580 : 500;
    const volume = p.capacity / rho / 0.8;
    const r = 0.15 * Math.cbrt(p.capacity / 11);
    const height = volume / (Math.PI * r * r);
    const wall = 0.0025 + 0.0005 * Math.cbrt(p.capacity / 11); // m of steel (2.5–3.5 mm)
    const t = Math.max(h, 0.003);
    const shell = { material: 'steel', color: hexToRgb(p.color), density: Math.min(1, wall / h), vessel: 'cylinder', variation: 0.03 };
    const level = t + (height - 2 * t) * p.fill;
    const y0 = 0.03;
    const prims = [
      { shape: 'cylinder', a: [0, y0, 0], b: [0, y0 + height, 0], r, ...shell },
      { shape: 'cylinder', a: [0, y0 + t, 0], b: [0, y0 + height - t, 0], r: r - t, mode: 'carve' },
      { shape: 'cylinder', a: [0, y0 + t, 0], b: [0, y0 + level, 0], r: r - t, material: gas.material, vessel: 'cylinder', vesselRole: 'contents' },
      // foot ring and valve with its protective collar
      { shape: 'cylinder', a: [0, 0, 0], b: [0, y0, 0], r: r * 0.9, material: 'steel', color: [0.25, 0.25, 0.27], density: 0.2 },
      { shape: 'cylinder', a: [0, y0 + height, 0], b: [0, y0 + height + 0.06, 0], r: 0.02, ...shell, color: [0.75, 0.62, 0.3] },
    ];
    // a relief valve flows ~0.08 kg/s of vapour fully open on an 11 kg cylinder (sized for a fire on
    // its surface, CGA S-1.1: Q = 30.4·A^0.82 scfm of air), more on a bigger one
    const scale = (p.capacity / 11) ** (2 / 3);
    return {
      prims,
      vessels: {
        cylinder: {
          lumped: true, // (sim/vessels.js: the real cylinder, not its voxels)
          gas: gas.material,
          volume, // m³
          fill0: p.fill,
          radius: r,
          height,
          wall,
          burstPressure: 1e7, // Pa gauge, cold: ~3x the 30 bar test pressure
          ventPressure: p.reliefValve === 'working' ? 1.75e6 : null,
          ventCapacity: 0.08 * scale,
          drawRate: p.valve === 'open (lit)' ? 0.0015 * scale : 0, // kg/s burning at the open valve (~70 kW)
          base: [0, y0, 0],
          top: [0, y0 + height + 0.06, 0],
        },
      },
    };
  },
};
