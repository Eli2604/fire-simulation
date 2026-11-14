/**
 * A drone camp in the world (the props of the Military camp page, src/camp/stage.js, as objects of
 * the voxel world): a ring of HESCO bastions (earth-filled wire baskets) with a gate, the command
 * tent with the drone operations desk (a monitor per drone and the tactical map), two tents for
 * the crews, launch pads with quadcopters parked on them, a radio mast, jammers (electronic
 * warfare: they cut GNSS or the radio link round them), floodlights on poles and the power panel
 * where the cables from the solar park and the wind turbine come in.
 *
 * It runs on its grid (`grid`, sim/power.js): the operations (monitors, radios, chargers) take
 * `opsLoad`, the floodlights `lightsLoad` at night. Short of power the lights go out first, then
 * the monitors go dark (render/campPower.js).
 *
 * Tents, desk, bastions, mast and lamp poles are voxels (fabric burns; a blast tears them); the
 * small things (screens, drones, lamps, antennas) are drawn.
 */
export default {
  label: 'Drone camp (tents, ops desk, launch pads, mast, jammers)',
  params: {
    radius: { value: 9, min: 5, max: 16, step: 0.5, label: 'Bastion ring radius (m)' },
    gate: { value: 90, min: 0, max: 359, step: 5, label: 'Gate faces (compass °; 90: east, +x)' },
    drones: { value: 4, min: 0, max: 8, step: 1, label: 'Drones on launch pads' },
    monitors: { value: 6, min: 1, max: 9, step: 1, label: 'Monitors on the ops desk' },
    jammers: { value: 2, min: 0, max: 4, step: 1, label: 'Jammers' },
    opsLoad: { value: 1.6, min: 0.1, max: 20, step: 0.1, label: 'Operations load (kW: monitors, radios, chargers)' },
    lightsLoad: { value: 1.2, min: 0, max: 10, step: 0.1, label: 'Floodlights (kW, at night)' },
    grid: { value: 'camp', label: 'Grid it runs on' },
    tentMoisture: { value: 0.08, min: 0.02, max: 1, step: 0.01, label: 'Tent canvas moisture (kg/kg)' },
  },
  build(p, { h }) {
    const thin = (m) => Math.min(1, Math.max(0.004, m / h));
    const R = p.radius;
    const prims = [];
    const canvas = { material: 'fabric', color: [0.36, 0.4, 0.28], moisture: p.tentMoisture, density: thin(0.0015) };
    // the bastion ring (1 m baskets of earth, 1.3 m high), a gap for the gate
    const gate = (p.gate * Math.PI) / 180;
    const gateDir = Math.atan2(-Math.cos(gate), Math.sin(gate)); // (compass → angle in x-z: 0 = +x)
    const n = Math.round((2 * Math.PI * R) / 1.05);
    for (let k = 0; k < n; k++) {
      const t = (k / n) * Math.PI * 2;
      const off = Math.abs(Math.atan2(Math.sin(t - gateDir), Math.cos(t - gateDir)));
      if (off < 2.2 / R) continue; // (the gate: ~4.4 m wide)
      const x = Math.cos(t) * R;
      const z = Math.sin(t) * R;
      prims.push({ shape: 'box', min: [x - 0.5, 0, z - 0.5], max: [x + 0.5, 1.3, z + 0.5], material: 'soil', color: [0.7, 0.62, 0.46], variation: 0.06, anchored: true });
    }
    // a tent: walls of canvas, a gable roof; ridge along x; open (no wall) at its east end if `open`
    const tent = (cx, cz, w, d, open = false) => {
      const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
      const t = Math.max(h, 0.05);
      const wh = 1.9;
      prims.push(
        { shape: 'box', min: [x0, 0, z0], max: [x1, wh, z0 + t], ...canvas },
        { shape: 'box', min: [x0, 0, z1 - t], max: [x1, wh, z1], ...canvas },
        { shape: 'box', min: [x0, 0, z0], max: [x0 + t, wh, z1], ...canvas },
      );
      // the roof: two sloping slabs of canvas, layer by layer (a gable prism is centred on z = 0)
      const layers = Math.max(2, Math.round(1.1 / h));
      for (let k = 0; k < layers; k++) {
        const y0 = wh + (1.1 * k) / layers;
        const y1 = wh + (1.1 * (k + 1)) / layers;
        const half = (d / 2 + 0.2) * (1 - (k + 0.5) / layers);
        const sh = Math.min(half, t * 1.6);
        prims.push(
          { shape: 'box', min: [x0 - 0.15, y0, cz - half], max: [x1 + 0.15, y1, cz - half + sh], ...canvas },
          { shape: 'box', min: [x0 - 0.15, y0, cz + half - sh], max: [x1 + 0.15, y1, cz + half], ...canvas },
        );
      }
      if (!open) prims.push({ shape: 'box', min: [x1 - t, 0, z0], max: [x1, wh, z1], ...canvas });
    };
    // the command tent: open to the east (the gate); the desk inside
    tent(1.6, 0, 6, 5, true);
    tent(-4.2, -5.2, 5, 3.6);
    tent(-4.2, 5.2, 5, 3.6);
    // the operations desk (steel frame, a wooden top) across the tent, the screens on it facing east
    const desk = [2.6, 0, 0];
    prims.push(
      { shape: 'box', min: [desk[0] - 0.4, 0.7, -1.2], max: [desk[0] + 0.4, 0.78, 1.2], material: 'wood', color: [0.38, 0.33, 0.27], anchored: true },
      { shape: 'box', min: [desk[0] - 0.35, 0, -1.15], max: [desk[0] + 0.35, 0.7, -1.05], material: 'steel', density: thin(0.004), anchored: true },
      { shape: 'box', min: [desk[0] - 0.35, 0, 1.05], max: [desk[0] + 0.35, 0.7, 1.15], material: 'steel', density: thin(0.004), anchored: true },
      // the electronics under it (racks: what burns and what a blast wrecks)
      { shape: 'box', min: [desk[0] - 0.9, 0, 1.6], max: [desk[0] - 0.2, 1.4, 2.2], material: 'steel', color: [0.15, 0.16, 0.17], density: 0.12, anchored: true },
    );
    // the launch pads: concrete slabs east of the tents, inside the ring
    const padSpots = [[5.2, -5.4], [7.2, -2.6], [5.2, 5.4], [7.2, 2.6], [3, -7.2], [3, 7.2], [-1, -7.6], [-1, 7.6]];
    const pads = padSpots.slice(0, Math.max(p.drones, 2)).filter(([x, z]) => Math.hypot(x, z) < R - 1.2);
    for (const [x, z] of pads) prims.push({ shape: 'box', min: [x - 1, -0.2, z - 1], max: [x + 1, 0.12, z + 1], material: 'concrete', color: [0.55, 0.55, 0.53], anchored: true });
    // the radio mast (its foot: a steel box), the jammers (cases on the ground), the power panel
    const mast = [-6.8, 0, 1.6];
    prims.push(
      { shape: 'box', min: [mast[0] - 0.4, 0, mast[2] - 0.4], max: [mast[0] + 0.4, 0.5, mast[2] + 0.4], material: 'concrete', anchored: true },
      { shape: 'cylinder', a: [mast[0], 0.5, mast[2]], b: [mast[0], 9, mast[2]], r: 0.15, material: 'steel', density: thin(0.004), anchored: true, hidden: true },
    );
    const jammers = [[-6.6, -1.8], [-7.6, -0.4], [-6.2, 3.9], [-5.6, -3.4]].slice(0, p.jammers).map(([x, z], k) => ({ p: [x, 0, z], kind: k % 2 ? 'comms' : 'gnss' }));
    for (const j of jammers) prims.push({ shape: 'box', min: [j.p[0] - 0.35, 0, j.p[2] - 0.25], max: [j.p[0] + 0.35, 0.55, j.p[2] + 0.25], material: 'plastic', color: [0.3, 0.33, 0.27], density: 0.3, anchored: true });
    const panel = [-1.2, 0, 3.4]; // where the cables come in
    prims.push({ shape: 'box', min: [panel[0] - 0.4, 0, panel[2] - 0.25], max: [panel[0] + 0.4, 1.6, panel[2] + 0.25], material: 'steel', color: [0.55, 0.57, 0.5], density: 0.1, anchored: true });
    // floodlights on poles
    const lamps = [[-1.5, -R + 1.6], [-1.5, R - 1.6], [R - 2.2, 0.2], [-R + 1.8, -2.6]].map(([x, z]) => [x, 5.2, z]);
    for (const [x, , z] of lamps) prims.push({ shape: 'cylinder', a: [x, 0, z], b: [x, 5.2, z], r: 0.08, material: 'steel', density: thin(0.004), anchored: true, hidden: true });
    // sandbags by the gate
    const gx = Math.cos(gateDir) * (R - 1.6);
    const gz = Math.sin(gateDir) * (R - 1.6);
    prims.push({ shape: 'box', min: [gx - 0.4, 0, gz - 1.2], max: [gx + 0.4, 0.9, gz - 0.4], material: 'quarrySand', color: [0.62, 0.55, 0.4], anchored: true });
    return {
      prims,
      loads: [{ grid: p.grid, ops: p.opsLoad * 1000, lights: p.lightsLoad * 1000, p: desk.slice(), label: 'drone camp' }],
      props: [
        {
          type: 'droneCamp',
          p: [0, 0, 0],
          grid: p.grid,
          desk,
          monitors: p.monitors,
          pads: pads.map(([x, z]) => [x, 0.12, z]),
          drones: p.drones,
          mast,
          jammers,
          lamps,
          panel,
          ring: R,
        },
      ],
    };
  },
};
