/**
 * A wind turbine (the camp's "windmill"): a tapered steel tower on a concrete foundation, a
 * nacelle on top and a three-bladed rotor facing the wind (sim/power.js: it yaws into the wind,
 * turns with the weather's wind from cut-in, makes up to its rating, and is feathered and braked
 * above cut-out). The tower and the nacelle are voxels (steel: a blast or a fire can take them;
 * hidden, drawn smooth by render/campPower.js), the rotor is drawn only. Its power goes to a grid
 * (`grid`: the camp's), along a cable laid on the ground to (cableX, cableZ) from its foot.
 */
export default {
  label: 'Wind turbine (windmill)',
  params: {
    hubHeight: { value: 16, min: 6, max: 26, step: 0.5, label: 'Hub height (m)' },
    rotorRadius: { value: 6.5, min: 2, max: 12, step: 0.1, label: 'Rotor radius (m)' },
    ratedPower: { value: 30, min: 1, max: 300, step: 1, label: 'Rated power (kW)' },
    cutIn: { value: 3, min: 1, max: 6, step: 0.1, label: 'Cut-in wind at the hub (m/s)' },
    ratedWind: { value: 11, min: 6, max: 16, step: 0.1, label: 'Rated wind at the hub (m/s)' },
    cutOut: { value: 25, min: 12, max: 35, step: 0.5, label: 'Cut-out wind at the hub (m/s)' },
    restart: { value: 20, min: 8, max: 30, step: 0.5, label: 'Restarts below (m/s, after a cut-out)' },
    yawRate: { value: 6, min: 0.5, max: 30, step: 0.5, label: 'Yaw rate (°/s)' },
    grid: { value: 'camp', label: 'Grid it feeds' },
    cableX: { value: 0, min: -60, max: 60, step: 0.5, label: 'Cable runs to X (m from its foot)' },
    cableZ: { value: 0, min: -60, max: 60, step: 0.5, label: 'Cable runs to Z (m from its foot)' },
  },
  build(p, { h }) {
    const H = p.hubHeight;
    const thin = (m) => Math.min(1, Math.max(0.004, m / h));
    const steel = { material: 'steel', color: [0.86, 0.87, 0.86], hidden: true, anchored: true };
    const r0 = 0.75; // the tower at its foot, and at the top
    const r1 = 0.45;
    const prims = [
      // the foundation, flush with the ground, and its plinth
      { shape: 'box', min: [-2, -0.6, -2], max: [2, 0.25, 2], material: 'concrete', anchored: true, color: [0.62, 0.61, 0.58] },
      // the tower in four tapering sections (a steel tube ~20 mm thick)
      ...[0, 1, 2, 3].map((k) => {
        const y0 = 0.25 + ((H - 1.6) * k) / 4;
        const y1 = 0.25 + ((H - 1.6) * (k + 1)) / 4;
        const r = r0 + ((r1 - r0) * (k + 0.5)) / 4;
        return { shape: 'cylinder', a: [0, y0, 0], b: [0, y1, 0], r, ...steel, density: thin(0.02 * 2 * Math.PI * r / Math.max(h, 2 * r)) };
      }),
      // the nacelle (gearbox, generator: heavy) on the yaw bearing
      { shape: 'box', min: [-1.4, H - 1.4, -0.7], max: [1.6, H + 0.6, 0.7], ...steel, density: 0.25 },
    ];
    // where its power goes: a cable from its foot to the camp (drawn on the ground)
    const cable = p.cableX || p.cableZ ? [[0.8, 0.05, 0], [p.cableX, 0.05, p.cableZ]] : null;
    return {
      prims,
      generators: [
        {
          kind: 'wind',
          grid: p.grid,
          p: [0, H, 0],
          check: [0, H - 0.4, 0], // (the nacelle: gone, it makes nothing)
          hub: H,
          R: p.rotorRadius,
          rated: p.ratedPower * 1000,
          cutIn: p.cutIn,
          ratedWind: p.ratedWind,
          cutOut: p.cutOut,
          restart: Math.min(p.restart, p.cutOut - 0.5),
          yawRate: p.yawRate,
          omega: 0,
          angle: 0,
          output: 0,
          state: 'idle',
        },
      ],
      props: [{ type: 'windTurbine', p: [0, 0, 0], hub: H, R: p.rotorRadius, r0, r1, cable }],
    };
  },
};
