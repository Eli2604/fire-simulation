/**
 * A solar park: rows of photovoltaic panels tilted towards the sun on steel frames (posts, rails),
 * and a container with the inverter and a battery at its end. Its output (sim/power.js) follows the
 * sun: how high it stands and where (a time-of-day sky, if there is one), the clouds, rain and fog
 * (the weather's sunlight), the angle it meets the panels at, the heat of the cells. Every panel is
 * a voxel of glass (hidden: drawn as a panel by render/campPower.js): broken by a blast or burnt,
 * it gives nothing; the container gone, the park gives nothing. Its power goes to a grid (`grid`:
 * the camp's), along a cable on the ground to (cableX, cableZ).
 *
 * Frame: the panels face `azimuth` (a compass bearing in the model's frame: 180 faces +z, which is
 * south in these worlds; the object's rotation turns it with the rest), rows one behind the other
 * along it, columns across.
 */
export default {
  label: 'Solar panel park',
  params: {
    rows: { value: 3, min: 1, max: 8, step: 1, label: 'Rows' },
    columns: { value: 8, min: 1, max: 24, step: 1, label: 'Panels in a row' },
    tilt: { value: 30, min: 0, max: 70, step: 1, label: 'Tilt (° from level)' },
    azimuth: { value: 180, min: 0, max: 359, step: 1, label: 'Facing (compass °; 180: south, +z)' },
    rowSpacing: { value: 4, min: 2, max: 10, step: 0.1, label: 'Row spacing (m)' },
    panelPower: { value: 400, min: 100, max: 700, step: 10, label: 'Panel peak power (W)' },
    battery: { value: 1, min: 0, max: 200, step: 0.5, label: 'Battery in the container (kWh; 0: none)' },
    charge: { value: 0.6, min: 0, max: 1, step: 0.05, label: 'Battery charged at the start (share)' },
    grid: { value: 'camp', label: 'Grid it feeds' },
    cableX: { value: 0, min: -60, max: 60, step: 0.5, label: 'Cable runs to X (m from the container)' },
    cableZ: { value: 0, min: -60, max: 60, step: 0.5, label: 'Cable runs to Z (m from the container)' },
  },
  build(p, { h }) {
    const d = Math.PI / 180;
    const az = p.azimuth * d;
    // facing (f) and across (a) in the model's frame: bearing 0 is -z (north), 90 is +x (east)
    const f = [Math.sin(az), 0, -Math.cos(az)];
    const a = [Math.cos(az), 0, Math.sin(az)];
    const tilt = p.tilt * d;
    const PW = 1.05; // a panel across, along its row
    const PL = 1.75; // and up its slope (portrait)
    const low = 0.55; // its lower edge above the ground
    const rise = PL * Math.sin(tilt);
    const run = PL * Math.cos(tilt);
    const n = [f[0] * Math.sin(tilt), Math.cos(tilt), f[2] * Math.sin(tilt)]; // the panels' normal
    const at = (u, v, y) => [a[0] * u + f[0] * v, y, a[2] * u + f[2] * v]; // u across, v along the facing
    const thin = (m) => Math.min(1, Math.max(0.004, m / h));
    const steel = { material: 'steel', color: [0.6, 0.62, 0.63], anchored: true };
    const prims = [];
    const panels = [];
    const width = p.columns * (PW + 0.03);
    for (let r = 0; r < p.rows; r++) {
      // rows from the back (the far side from the sun) to the front
      const v0 = (r - (p.rows - 1) / 2) * p.rowSpacing; // the row's middle, along the facing
      // posts: a low one under the front edge, a tall one under the back, every ~2.2 m
      const posts = Math.max(2, Math.ceil(width / 2.2) + 1);
      for (let k = 0; k < posts; k++) {
        const u = -width / 2 + (width * k) / (posts - 1);
        prims.push(
          { shape: 'cylinder', a: at(u, v0 + run / 2 - 0.1, -0.4), b: at(u, v0 + run / 2 - 0.1, low + 0.05), r: 0.05, ...steel, density: thin(0.006) },
          { shape: 'cylinder', a: at(u, v0 - run / 2 + 0.1, -0.4), b: at(u, v0 - run / 2 + 0.1, low + rise - 0.05), r: 0.05, ...steel, density: thin(0.006) },
        );
      }
      for (let c = 0; c < p.columns; c++) {
        const u = -width / 2 + (c + 0.5) * (PW + 0.03);
        // the panel's middle (the slope goes up towards the back: away from the facing)
        const mid = at(u, v0, low + rise / 2);
        panels.push({ c: mid, u, v: v0 });
        // its glass and frame as voxels (hidden; ~20 kg a panel: 3.2 mm glass, aluminium frame)
        const lo = at(u - PW / 2, v0 - run / 2, low);
        const hi = at(u + PW / 2, v0 + run / 2, low + rise);
        prims.push({ shape: 'box', min: [Math.min(lo[0], hi[0]), low + rise / 2 - Math.max(h * 0.4, 0.05), Math.min(lo[2], hi[2])], max: [Math.max(lo[0], hi[0]), low + rise / 2 + Math.max(h * 0.4, 0.05), Math.max(lo[2], hi[2])], material: 'glass', hidden: true, anchored: true, density: thin(0.006) });
      }
    }
    // the container (inverter, battery) at the east end of the rows, beside the front row
    const cu = width / 2 + 2.2;
    const cv = 0;
    const cc = at(cu, cv, 0);
    const [cx, cz] = [cc[0], cc[2]];
    const ext = [Math.abs(a[0]) * 1.2 + Math.abs(f[0]) * 1.5, Math.abs(a[2]) * 1.2 + Math.abs(f[2]) * 1.5];
    prims.push(
      { shape: 'box', min: [cx - ext[0], 0, cz - ext[1]], max: [cx + ext[0], 2.5, cz + ext[1]], material: 'steel', color: [0.36, 0.42, 0.34], density: thin(0.003), anchored: true },
      { shape: 'box', min: [cx - ext[0] + h, h, cz - ext[1] + h], max: [cx + ext[0] - h, 2.5 - h, cz + ext[1] - h], mode: 'carve' },
      // the inverter cabinets and the battery racks inside (what the check looks at)
      { shape: 'box', min: [cx - 0.6, 0, cz - 0.6], max: [cx + 0.6, 1.9, cz + 0.6], material: 'steel', color: [0.7, 0.72, 0.74], density: 0.15, anchored: true },
    );
    const cable = p.cableX || p.cableZ ? [[cx, 0.05, cz], [cx + p.cableX, 0.05, cz + p.cableZ]] : null;
    return {
      prims,
      generators: [
        {
          kind: 'solar',
          grid: p.grid,
          p: [cx, 1, cz],
          check: [cx, 1.0, cz], // the inverter
          n,
          peak: p.panelPower,
          panels: panels.length,
          panelChecks: panels.map((q) => q.c),
          battery: p.battery,
          charge: p.charge,
          output: 0,
          state: 'idle',
        },
      ],
      props: [{ type: 'solarPark', p: [0, 0, 0], panels: panels.map((q) => q.c), f, a, tilt, PW, PL, low, rows: p.rows, columns: p.columns, rowSpacing: p.rowSpacing, container: [cx, 0, cz], containerExt: ext, cable }],
    };
  },
};
