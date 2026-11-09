/**
 * A spaceship in orbit: an aluminium pressure hull with a main corridor, the
 * bridge at the front (big windows), the engine room at the back (machinery,
 * cable trays, a tank of propellant), and along the corridor crew quarters, a
 * mess, a cargo bay, a lab and the airlock with the docking port.
 *
 * Outside there is vacuum (`vacuum: true`, see sim/vacuum.js): breach the hull
 * (a grenade, a rocket, a window shot out, the outer airlock door opened) and
 * the air rushes out of every space connected to the hole. Closed doors hold.
 * Artificial gravity keeps your feet on the floor.
 */
const thinOf = (h) => (m) => Math.min(1, Math.max(0.003, m / h));

export default {
  label: 'Spaceship (vacuum outside)',
  params: {
    length: { value: 30, min: 20, max: 50, step: 1, label: 'Length (m)' },
    width: { value: 9, min: 7, max: 16, step: 0.5, label: 'Width (m)' },
    height: { value: 4.4, min: 3.2, max: 6, step: 0.1, label: 'Hull height (m)' },
    fireAfter: { value: 40, min: 0, max: 600, step: 1, label: 'Engine room cable fire after (s, 0: none)' },
    windows: { value: true, label: 'Windows (bridge, mess, lab)' },
  },
  build(p, { h, rng }) {
    const thin = thinOf(h);
    const L = p.length;
    const B = p.width;
    const hx = L / 2;
    const hz = B / 2;
    const y0 = 0.6; // the hull floats clear of the domain bottom: vacuum all round
    const H = p.height;
    const y1 = y0 + H;
    const t = Math.max(1.5 * h, 0.3); // hull and bulkheads: thick enough to survive carving on both sides
    const fl = y0 + t; // the deck you walk on
    const cw = 0.8; // half corridor width
    const xb = hx - 5; // bridge / engine room bulkheads
    const hull = { material: 'aluminium', density: thin(0.008), color: [0.78, 0.8, 0.84], anchored: true, hull: true };
    const panel = { material: 'aluminium', density: thin(0.003), color: [0.86, 0.87, 0.88] };
    const prims = [
      // the pressure hull, then the inside: everything solid (bulkheads), corridors and rooms carved out
      { shape: 'box', min: [-hx, y0, -hz], max: [hx, y1, hz], ...hull },
      { shape: 'box', min: [-hx + t, fl, -hz + t], max: [hx - t, y1 - t, hz - t], ...panel, hull: false, anchored: false, mode: 'replace' },
      // engines sticking out at the back, a dish and radiator panels on top
      { shape: 'cylinder', a: [-hx - 1.6, y0 + H * 0.3, -2], b: [-hx, y0 + H * 0.3, -2], r: 0.8, material: 'steel', density: thin(0.01), anchored: true, color: [0.35, 0.33, 0.32] },
      { shape: 'cylinder', a: [-hx - 1.6, y0 + H * 0.3, 2], b: [-hx, y0 + H * 0.3, 2], r: 0.8, material: 'steel', density: thin(0.01), anchored: true, color: [0.35, 0.33, 0.32] },
      { shape: 'box', min: [-6, y1, -hz + 0.5], max: [6, y1 + 0.12, -hz + 2.5], material: 'aluminium', density: 0.05, anchored: true, color: [0.2, 0.25, 0.45] },
      { shape: 'box', min: [-6, y1, hz - 2.5], max: [6, y1 + 0.12, hz - 0.5], material: 'aluminium', density: 0.05, anchored: true, color: [0.2, 0.25, 0.45] },
      { shape: 'cylinder', a: [3, y1, 0], b: [3, y1 + 1.2, 0], r: 0.08, material: 'aluminium', anchored: true },
      { shape: 'ellipsoid', c: [3, y1 + 1.3, 0], r: [0.9, 0.2, 0.9], material: 'aluminium', density: 0.1, anchored: true },
    ];
    const carve = (x0, x1, z0, z1, top = y1 - t - 0.01) => prims.push({ shape: 'box', min: [x0, fl, z0], max: [x1, top, z1], mode: 'carve' });
    // corridor, bridge, engine room
    carve(-xb, xb, -cw, cw);
    carve(xb + t, hx - t, -hz + t, hz - t);
    carve(-hx + t, -xb - t, -hz + t, hz - t);
    const doors = [];
    // doors at both ends of the corridor
    for (const [x, name] of [[xb + t / 2, 'bridge'], [-xb - t / 2, 'engine room']]) {
      prims.push({ shape: 'box', min: [x - t, fl, -0.45], max: [x + t, fl + 2.0, 0.45], mode: 'carve' });
      doors.push({ shape: 'box', min: [x - h / 2, fl, -0.45], max: [x + h / 2, fl + 2.0, 0.45], ...panel, color: [0.6, 0.62, 0.66], door: name });
    }
    // side rooms: [x0, x1, side, name]
    const rooms = [
      [-xb + t, -1, -1, 'crew quarters'],
      [1, xb - t, -1, 'mess'],
      [-xb + t, -1, 1, 'cargo bay'],
      [1, 4, 1, 'airlock'],
      [4 + t, xb - t, 1, 'lab'],
    ];
    const inside = {};
    for (const [x0, x1, side, name] of rooms) {
      const z0 = side > 0 ? cw + t : -hz + t;
      const z1 = side > 0 ? hz - t : -cw - t;
      carve(x0, x1, z0, z1);
      inside[name] = { x0, x1, z0, z1 };
      const xd = (x0 + x1) / 2;
      const zc = side > 0 ? cw + t / 2 : -cw - t / 2;
      prims.push({ shape: 'box', min: [xd - 0.45, fl, zc - t], max: [xd + 0.45, fl + 2.0, zc + t], mode: 'carve' });
      doors.push({ shape: 'box', min: [xd - 0.45, fl, zc - h / 2], max: [xd + 0.45, fl + 2.0, zc + h / 2], ...panel, color: [0.6, 0.62, 0.66], door: name === 'airlock' ? 'airlock (inner)' : name });
    }
    // the outer airlock door, in the hull itself: open it and the airlock decompresses
    const al = inside.airlock;
    const ax = (al.x0 + al.x1) / 2;
    prims.push(
      { shape: 'box', min: [ax - 0.5, fl, hz - t - 0.01], max: [ax + 0.5, fl + 2.0, hz + 0.01], mode: 'carve' },
      { shape: 'box', min: [ax - 0.5, fl, hz - t / 2 - h / 2], max: [ax + 0.5, fl + 2.0, hz - t / 2 + h / 2], material: 'steel', density: thin(0.02), color: [0.85, 0.7, 0.1], door: 'airlock (outer)', hull: true, anchored: true },
      // the docking collar round it
      { shape: 'box', min: [ax - 0.9, fl - 0.3, hz], max: [ax + 0.9, fl + 2.4, hz + 0.25], material: 'steel', density: thin(0.01), anchored: true, color: [0.85, 0.7, 0.1] },
      { shape: 'box', min: [ax - 0.55, fl - 0.01, hz - 0.01], max: [ax + 0.55, fl + 2.05, hz + 0.26], mode: 'carve' },
    );
    prims.push(...doors);
    // windows: the bridge front and sides, the mess and the lab
    if (p.windows) {
      prims.push({ shape: 'box', min: [hx - t - 0.01, fl + 1.0, -hz + 1.2], max: [hx + 0.01, fl + 2.4, hz - 1.2], material: 'glass', density: thin(0.02), mode: 'replace', hull: true, anchored: true });
      for (const z of [-hz, hz]) prims.push({ shape: 'box', min: [xb + 1, fl + 1.2, z - t - 0.01], max: [hx - 1, fl + 2.2, z + 0.01], material: 'glass', density: thin(0.02), mode: 'replace', hull: true, anchored: true });
      const m = inside.mess;
      prims.push({ shape: 'box', min: [m.x0 + 1, fl + 1.2, -hz - 0.01], max: [m.x1 - 1, fl + 2.0, -hz + t + 0.01], material: 'glass', density: thin(0.02), mode: 'replace', hull: true, anchored: true });
      const lb = inside.lab;
      prims.push({ shape: 'box', min: [lb.x0 + 0.8, fl + 1.2, hz - t - 0.01], max: [lb.x1 - 0.8, fl + 2.0, hz + 0.01], material: 'glass', density: thin(0.02), mode: 'replace', hull: true, anchored: true });
    }
    // the bridge: consoles, seats, papers
    prims.push(
      { shape: 'box', min: [hx - t - 1.4, fl, -hz + 1.2], max: [hx - t - 0.6, fl + 1.0, hz - 1.2], material: 'plastic', density: 0.25, color: [0.15, 0.17, 0.2], anchored: true },
      { shape: 'box', min: [hx - 3.4, fl, -1.2], max: [hx - 2.8, fl + 0.5, -0.6], material: 'foam', color: [0.3, 0.3, 0.35], anchored: true },
      { shape: 'box', min: [hx - 3.4, fl, 0.6], max: [hx - 2.8, fl + 0.5, 1.2], material: 'foam', color: [0.3, 0.3, 0.35], anchored: true },
      { shape: 'box', min: [xb + t + 0.3, fl + 0.9, -hz + t + 0.2], max: [xb + t + 1.5, fl + 1.0, -hz + t + 0.9], material: 'paper', density: 0.5 },
    );
    // the engine room: machinery, cable trays, the propellant tank (a pressure vessel)
    const e0 = -hx + t;
    const e1 = -xb - t;
    prims.push(
      { shape: 'box', min: [e0 + 0.3, fl, -1.6], max: [e0 + 2.2, fl + 1.8, 1.6], material: 'steel', density: thin(0.02), color: [0.3, 0.32, 0.35] },
      { shape: 'box', min: [e0 + 0.3, y1 - t - 0.35, -hz + t + 0.2], max: [e1 - 0.3, y1 - t - 0.2, -hz + t + 0.6], material: 'cable', density: 0.4 },
      { shape: 'box', min: [e0 + 0.3, y1 - t - 0.35, hz - t - 0.6], max: [e1 - 0.3, y1 - t - 0.2, hz - t - 0.2], material: 'cable', density: 0.4 },
      { shape: 'box', min: [e1 - 1.9, fl, hz - t - 1.7], max: [e1 - 0.5, fl + 1.8, hz - t - 0.3], material: 'steel', density: thin(0.006), vessel: 'propellant', color: [0.8, 0.8, 0.82], anchored: true },
      { shape: 'box', min: [e1 - 1.9 + 2 * h, fl + 2 * h, hz - t - 1.7 + 2 * h], max: [e1 - 0.5 - 2 * h, fl + 1.8 - 2 * h, hz - t - 0.3 - 2 * h], material: 'gasoline', vessel: 'propellant', vesselRole: 'contents' },
    );
    // the corridor: ceiling panels with cables above, handrails
    prims.push({ shape: 'box', min: [-xb, y1 - t - 0.45, -cw + 0.1], max: [xb, y1 - t - 0.35, -cw + 0.4], material: 'cable', density: 0.4 });
    for (let x = -xb; x < xb - 0.3; x += 0.6)
      prims.push({ shape: 'box', min: [x, y1 - t - 0.6, -cw], max: [Math.min(xb, x + 0.6), y1 - t - 0.6 + h * 0.9, cw], material: 'ceilingTile', density: thin(0.012), group: true });
    // crew quarters: bunks; mess: table and benches; cargo: crates and tanks; lab: benches, papers
    const q = inside['crew quarters'];
    for (let x = q.x0 + 0.2; x < q.x1 - 2; x += 2.3)
      for (const y of [fl + 0.3, fl + 1.3])
        prims.push(
          { shape: 'box', min: [x, y, q.z0 + 0.05], max: [x + 2, y + 0.06, q.z0 + 0.85], material: 'aluminium', density: thin(0.003), anchored: true },
          { shape: 'box', min: [x + 0.05, y + 0.06, q.z0 + 0.1], max: [x + 1.95, y + 0.22, q.z0 + 0.8], material: 'foam', color: [0.25, 0.35, 0.55], anchored: true },
          { shape: 'box', min: [x + 0.1, y + 0.22, q.z0 + 0.12], max: [x + 1.3, y + 0.28, q.z0 + 0.78], material: 'fabric', color: [0.7, 0.72, 0.75], anchored: true },
        );
    const m = inside.mess;
    prims.push(
      { shape: 'box', min: [m.x0 + 0.8, fl + 0.72, (m.z0 + m.z1) / 2 - 0.4], max: [m.x1 - 0.8, fl + 0.78, (m.z0 + m.z1) / 2 + 0.4], material: 'plastic', density: 0.4, color: [0.8, 0.8, 0.78], anchored: true },
      { shape: 'box', min: [m.x0 + 0.8, fl, (m.z0 + m.z1) / 2 - 0.95], max: [m.x1 - 0.8, fl + 0.45, (m.z0 + m.z1) / 2 - 0.6], material: 'foam', color: [0.5, 0.2, 0.2], anchored: true },
      { shape: 'box', min: [m.x0 + 0.8, fl, (m.z0 + m.z1) / 2 + 0.6], max: [m.x1 - 0.8, fl + 0.45, (m.z0 + m.z1) / 2 + 0.95], material: 'foam', color: [0.5, 0.2, 0.2], anchored: true },
    );
    const c = inside['cargo bay'];
    for (let x = c.x0 + 0.3; x < c.x1 - 0.8; x += 0.8)
      for (let k = 0; k < 1 + Math.floor(rng() * 3); k++)
        prims.push({ shape: 'box', min: [x, fl + k * 0.6, c.z1 - 1.4], max: [x + 0.7, fl + (k + 1) * 0.6 - 0.02, c.z1 - 0.2], material: rng() < 0.5 ? 'wood' : 'plastic', density: 0.3, color: [0.55, 0.45, 0.3], variation: 0.2 });
    const lb = inside.lab;
    prims.push(
      { shape: 'box', min: [lb.x0 + 0.2, fl + 0.85, lb.z1 - 0.8], max: [lb.x1 - 0.2, fl + 0.9, lb.z1 - 0.1], material: 'plastic', density: 0.4, color: [0.9, 0.9, 0.9], anchored: true },
      { shape: 'box', min: [lb.x0 + 0.4, fl + 0.9, lb.z1 - 0.7], max: [lb.x0 + 1.4, fl + 1.0, lb.z1 - 0.2], material: 'paper', density: 0.5 },
      { shape: 'box', min: [lb.x1 - 1.2, fl + 0.9, lb.z1 - 0.6], max: [lb.x1 - 0.6, fl + 1.3, lb.z1 - 0.2], material: 'glass', density: thin(0.004) },
    );
    const heaters = [];
    if (p.fireAfter > 0) heaters.push({ pos: [e0 + 3, y1 - t - 0.5, -hz + t + 0.9], power: 15000, radius: 0.2, height: 0.4, igniteRadius: 0.5, start: p.fireAfter, until: p.fireAfter + 90, label: 'engine room cables', event: 'rackFire' });
    const dockP = [ax, fl, hz + 3];
    return {
      prims,
      vacuum: true,
      heaters,
      vessels: { propellant: { burstPressure: 2.5e6, ventPressure: 1.2e6, ventRate: 0.02, ullage: 0.1, volume: 1.4 * 1.8 * 1.4 * 0.4 } },
      docks: [{ p: dockP, dir: [0, 0, 1], label: 'Docking port', arrive: [ax, fl, (al.z0 + al.z1) / 2] }],
      portals: [{ p: [ax, fl, al.z1 - 0.5], r: 0.9, to: 'jet', label: 'Docking port: back into the jet' }],
      spawn: { p: [ax, fl, cw - 0.4], yaw: 0 },
    };
  },
};
