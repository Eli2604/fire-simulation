/**
 * Aircraft carrier zones.
 *
 *  carrierDeck   a section of the flight deck above the sea: steel deck with
 *                markings, the island (bridge with windows), a hatch down below
 *                deck (a portal to the below-deck zone)
 *  jet           a jet fighter parked on deck: aluminium airframe, canopy glass,
 *                fuel tank (a pressure vessel), rockets under the wings; it can
 *                be boarded and flown (see walk/flight.js)
 *  carrierBelow  below deck: corridors, mess, berthing, a store room and a server
 *                room (raised floor with cables, racks, suspended ceiling, a locked
 *                glass door and an automatic inert-gas system that floods the room
 *                when its ceiling gets hot, if the room is closed)
 */
const thinOf = (h) => (m) => Math.min(1, Math.max(0.003, m / h));

export const carrierDeck = {
  label: 'Carrier flight deck',
  params: {
    length: { value: 46, min: 20, max: 80, step: 1, label: 'Deck length (m)' },
    beam: { value: 18, min: 10, max: 30, step: 0.5, label: 'Deck width (m)' },
    deckHeight: { value: 7, min: 4, max: 15, step: 0.5, label: 'Deck above the keel (m)' },
    draft: { value: 2.5, min: 1, max: 6, step: 0.1, label: 'Waterline above the keel (m)' },
  },
  build(p, { h }) {
    const thin = thinOf(h);
    const L = p.length;
    const B = p.beam;
    const D = p.deckHeight;
    const hx = L / 2;
    const hz = B / 2;
    const steel = { material: 'steel', anchored: true };
    const prims = [
      // hull sides and the flight deck (the space below it is another zone)
      { shape: 'box', min: [-hx, 0, -hz], max: [hx, D, hz], ...steel, density: thin(0.02), color: [0.42, 0.44, 0.46], hull: true },
      { shape: 'box', min: [-hx + h, h, -hz + h], max: [hx - h, D - h, hz - h], mode: 'carve' },
      { shape: 'box', min: [-hx - 0.01, -0.01, -hz - 0.01], max: [hx + 0.01, p.draft, hz + 0.01], material: 'steel', mode: 'replace', density: thin(0.02), anchored: true, color: [0.5, 0.15, 0.12], hull: true },
      // deck surface: non-skid grey with yellow and white markings
      { shape: 'box', min: [-hx, D - h, -hz], max: [hx, D, hz], ...steel, density: thin(0.03), color: [0.3, 0.31, 0.32] },
      { shape: 'box', min: [-hx, D - h, -0.12], max: [hx, D, 0.12], ...steel, density: thin(0.03), color: [0.9, 0.9, 0.85], mode: 'replace' },
      { shape: 'box', min: [-hx, D - h, hz - 3.2], max: [hx, D, hz - 3.0], ...steel, density: thin(0.03), color: [0.95, 0.8, 0.1], mode: 'replace' },
    ];
    // the island on the starboard side: a steel tower with a glazed bridge
    const ix = hx * 0.25;
    const iz = -hz + 3;
    const IL = 10;
    const IW = 4.5;
    const top = D + 6;
    prims.push(
      { shape: 'box', min: [ix - IL / 2, D, iz - IW / 2], max: [ix + IL / 2, top, iz + IW / 2], ...steel, density: thin(0.01), color: [0.55, 0.57, 0.6] },
      { shape: 'box', min: [ix - IL / 2 + h, D, iz - IW / 2 + h], max: [ix + IL / 2 - h, top - h, iz + IW / 2 - h], mode: 'carve' },
      { shape: 'box', min: [ix - IL / 2 + h, D + 3, iz - IW / 2 + h], max: [ix + IL / 2 - h, D + 3 + h, iz + IW / 2 - h], ...steel, density: thin(0.008), color: [0.5, 0.5, 0.5] },
      // bridge windows all round
      { shape: 'box', min: [ix - IL / 2 - 0.01, top - 2, iz - IW / 2 - 0.01], max: [ix + IL / 2 + 0.01, top - 0.8, iz + IW / 2 + 0.01], material: 'glass', mode: 'replace', density: thin(0.012) },
      // consoles and chairs on the bridge, papers
      { shape: 'box', min: [ix - IL / 2 + 0.6, D + 3 + h, iz + IW / 2 - 1.2], max: [ix + IL / 2 - 0.6, D + 4.2, iz + IW / 2 - 0.6], material: 'plastic', density: 0.2, color: [0.2, 0.22, 0.25] },
      { shape: 'box', min: [ix - 1, D + 3 + h, iz - 0.5], max: [ix + 1, D + 3.6, iz + 0.5], material: 'paper', density: 0.4, color: [0.85, 0.85, 0.8] },
      // a door into the island and a mast
      { shape: 'box', min: [ix + IL / 2 - 0.01, D + h, iz - 0.5], max: [ix + IL / 2 + 0.01, D + 2.1, iz + 0.5], mode: 'carve' },
      { shape: 'box', min: [ix + IL / 2 - h / 2, D + h, iz - 0.5], max: [ix + IL / 2 + h / 2, D + 2.1, iz + 0.5], material: 'steel', density: thin(0.01), color: [0.7, 0.7, 0.68], door: 'island door' },
      { shape: 'cylinder', a: [ix, top, iz], b: [ix, top + 4, iz], r: 0.15, ...steel, density: thin(0.01) },
    );
    // the hatch down below deck, next to the island
    const hatch = [ix - IL / 2 - 2.5, D, iz + 1];
    prims.push(
      // (the hatch itself is a painted cover with a coaming: E takes you below)
      { shape: 'box', min: [hatch[0] - 0.6, D - h, hatch[2] - 0.6], max: [hatch[0] + 0.6, D, hatch[2] + 0.6], ...steel, density: thin(0.03), color: [0.85, 0.75, 0.1], mode: 'replace' },
      { shape: 'box', min: [hatch[0] - 0.7, D, hatch[2] - 0.7], max: [hatch[0] + 0.7, D + 0.3, hatch[2] - 0.6], ...steel, density: thin(0.01), color: [0.8, 0.75, 0.2] },
      // stacked crates and a fuel drum cart on deck
      { shape: 'box', min: [-hx + 4, D, hz - 5], max: [-hx + 6, D + 1.2, hz - 3.6], material: 'wood', density: 0.3, color: [0.55, 0.42, 0.25] },
      { shape: 'box', min: [-hx + 4.2, D + 1.2, hz - 4.8], max: [-hx + 5.8, D + 2.2, hz - 3.8], material: 'paper', density: 0.3, color: [0.6, 0.5, 0.35] },
    );
    return {
      prims,
      sea: { level: p.draft, box: [-hx, -hz, hx, hz] },
      spawn: { p: [hatch[0] + 2, D, hatch[2] + 2], yaw: 0 },
      portals: [{ p: [hatch[0], D, hatch[2]], r: 1.0, to: 'below', label: 'Hatch: below deck' }],
      ignite: { p: [-hx + 5, D + 0.5, hz - 4.3], radius: 0.4, power: 5000 },
    };
  },
};

export const jet = {
  label: 'Jet fighter (flyable)',
  params: {
    color: { value: '#7a8590', color: true, label: 'Paint' },
    fuelLiters: { value: 2000, min: 0, max: 6000, step: 50, label: 'Fuel (litres)' },
    rockets: { value: 8, min: 0, max: 16, step: 1, label: 'Rockets' },
  },
  build(p, { h }) {
    const thin = thinOf(h);
    const hex = parseInt(String(p.color).replace('#', ''), 16);
    const paint = [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
    const al = { material: 'aluminium', color: paint, density: thin(0.003), variation: 0.03 };
    const prims = [
      // fuselage, nose, tail cone
      { shape: 'capsule', a: [-6, 1.6, 0], b: [5, 1.6, 0], r: 0.75, ...al },
      { shape: 'cone', base: [5, 1.6, 0], r: 0.6, height: 2.4, ...al },
      // cockpit canopy
      { shape: 'ellipsoid', c: [3, 2.35, 0], r: [1.4, 0.45, 0.5], material: 'glass', density: thin(0.012), mode: 'set' },
      // wings, tail and fins
      { shape: 'box', min: [-2.5, 1.4, -5], max: [1, 1.55, 5], ...al },
      { shape: 'box', min: [-6.5, 1.5, -2.2], max: [-5, 1.6, 2.2], ...al },
      { shape: 'box', min: [-6.5, 1.6, -0.06], max: [-4.8, 4.2, 0.06], ...al },
      // engine nozzle
      { shape: 'cylinder', a: [-7.2, 1.6, 0], b: [-6, 1.6, 0], r: 0.5, material: 'steel', density: thin(0.006), color: [0.25, 0.22, 0.2] },
      // landing gear
      { shape: 'cylinder', a: [3.5, 0, -0.15], b: [3.5, 0, 0.15], r: 0.3, material: 'rubber', density: 0.3 },
      { shape: 'cylinder', a: [-1.5, 0, -1.6], b: [-1.5, 0, -1.2], r: 0.35, material: 'rubber', density: 0.3 },
      { shape: 'cylinder', a: [-1.5, 0, 1.2], b: [-1.5, 0, 1.6], r: 0.35, material: 'rubber', density: 0.3 },
      { shape: 'box', min: [3.45, 0.3, -0.05], max: [3.55, 1.1, 0.05], material: 'steel', density: 0.2 },
      { shape: 'box', min: [-1.55, 0.35, -1.45], max: [-1.45, 1.4, -1.35], material: 'steel', density: 0.2 },
      { shape: 'box', min: [-1.55, 0.35, 1.35], max: [-1.45, 1.4, 1.45], material: 'steel', density: 0.2 },
    ];
    // rockets under the wings
    const n = p.rockets;
    for (let k = 0; k < n; k++) {
      const side = k % 2 ? 1 : -1;
      const z = side * (1.8 + Math.floor(k / 2) * 0.7);
      prims.push({ shape: 'cylinder', a: [-1.5, 1.2, z], b: [0.5, 1.2, z], r: 0.08, material: 'steel', density: 0.3, color: [0.85, 0.85, 0.8] });
    }
    // internal fuel tank: a pressure vessel of jet fuel
    if (p.fuelLiters > 0)
      prims.push(
        { shape: 'box', min: [-3, 1.2, -0.45], max: [1, 2.0, 0.45], material: 'aluminium', density: thin(0.003), vessel: 'fuel' },
        { shape: 'box', min: [-2.8, 1.3, -0.35], max: [0.8, 1.9, 0.35], material: 'gasoline', vessel: 'fuel', vesselRole: 'contents' },
      );
    return {
      prims,
      vessels: p.fuelLiters > 0 ? { fuel: { burstPressure: 3e5, ventPressure: 3e4, ventRate: 0.01, ullage: 0.1, volume: p.fuelLiters / 1000 / 0.9 } } : {},
      vehicle: { type: 'jet', seat: [3, 2.4, 0], rockets: n, color: p.color },
      ignite: { p: [-6, 1.6, 0], radius: 0.6, power: 20000, materials: ['gasoline', 'rubber'] },
    };
  },
};

export const carrierBelow = {
  label: 'Carrier below deck (corridors, server room)',
  params: {
    length: { value: 30, min: 16, max: 50, step: 1, label: 'Length (m)' },
    width: { value: 15, min: 10, max: 24, step: 0.5, label: 'Width (m)' },
    height: { value: 2.8, min: 2.4, max: 4, step: 0.1, label: 'Deck height (m)' },
    rackFireAfter: { value: 25, min: 0, max: 600, step: 1, label: 'Server rack fire after (s)' },
    inertSystem: { value: true, label: 'Server room inert-gas system' },
  },
  build(p, { h, rng }) {
    const thin = thinOf(h);
    const L = p.length;
    const B = p.width;
    const H = p.height;
    const hx = L / 2;
    const hz = B / 2;
    const cw = 0.8; // half corridor width
    const t = Math.max(1.5 * h, 0.25); // bulkheads: thick enough that carving on both sides always leaves a voxel
    const bulk = { material: 'steel', density: thin(0.008), color: [0.82, 0.83, 0.8] };
    const prims = [
      // floor, overhead, outer bulkheads
      { shape: 'box', min: [-hx, 0, -hz], max: [hx, h, hz], material: 'steel', density: thin(0.015), anchored: true, color: [0.35, 0.37, 0.38] },
      { shape: 'box', min: [-hx, H, -hz], max: [hx, H + h, hz], material: 'steel', density: thin(0.015), anchored: true, color: [0.6, 0.6, 0.58] },
      { shape: 'box', min: [-hx, h, -hz], max: [hx, H, hz], ...bulk },
      // the main corridor and a cross corridor
      { shape: 'box', min: [-hx + 1, h * 1.01, -cw], max: [hx - 1, H - 0.01, cw], mode: 'carve' },
      { shape: 'box', min: [-cw, h * 1.01, -hz + 1], max: [cw, H - 0.01, hz - 1], mode: 'carve' },
      // the spaces beyond (tanks, voids) are closed and empty: keeps the steel volume small
      { shape: 'box', min: [hx - 1 + t, h * 1.01, -hz + t], max: [hx - t, H - 0.01, hz - t], mode: 'carve' },
      { shape: 'box', min: [-hx + t, h * 1.01, -hz + t], max: [-hx + 1 - t, H - 0.01, hz - t], mode: 'carve' },
      { shape: 'box', min: [-hx + 1, h * 1.01, hz - 1 + t], max: [hx - 1, H - 0.01, hz - t], mode: 'carve' },
      { shape: 'box', min: [-hx + 1, h * 1.01, -hz + t], max: [hx - 1, H - 0.01, -hz + 1 - t], mode: 'carve' },
    ];
    // cable runs along the corridor overhead
    prims.push({ shape: 'box', min: [-hx + 1, H - 0.25, -cw + 0.1], max: [hx - 1, H - 0.15, -cw + 0.45], material: 'cable', density: 0.4 });
    const doors = [];
    const room = (x0, x1, z0, z1, name, fill) => {
      prims.push({ shape: 'box', min: [x0 + t, h * 1.01, z0 + t], max: [x1 - t, H - 0.01, z1 - t], mode: 'carve' });
      // door from the corridor
      const zc = z0 > 0 ? z0 + t / 2 : z1 - t / 2;
      const xd = (x0 + x1) / 2;
      prims.push({ shape: 'box', min: [xd - 0.45, h * 1.01, zc - t], max: [xd + 0.45, 2.0, zc + t], mode: 'carve' });
      doors.push({ xd, zc, name });
      fill?.(x0 + t, x1 - t, z0 + t, z1 - t);
    };
    // port side (z < 0): mess, berthing; starboard (z > 0): store room, server room
    room(-hx + 1, -cw - 0.2, -hz + 1, -cw, 'mess', (a0, a1, b0, b1) => {
      for (let x = a0 + 1.2; x < a1 - 1; x += 2.4)
        prims.push(
          { shape: 'box', min: [x - 0.9, 0.72, (b0 + b1) / 2 - 0.4], max: [x + 0.9, 0.76, (b0 + b1) / 2 + 0.4], material: 'plastic', density: 0.4, color: [0.7, 0.68, 0.6] },
          { shape: 'box', min: [x - 0.8, h, (b0 + b1) / 2 - 0.9], max: [x + 0.8, 0.45, (b0 + b1) / 2 - 0.55], material: 'foam', color: [0.3, 0.32, 0.4] },
          { shape: 'box', min: [x - 0.8, h, (b0 + b1) / 2 + 0.55], max: [x + 0.8, 0.45, (b0 + b1) / 2 + 0.9], material: 'foam', color: [0.3, 0.32, 0.4] },
        );
    });
    room(cw + 0.2, hx - 1, -hz + 1, -cw, 'berthing', (a0, a1, b0) => {
      for (let x = a0 + 0.2; x < a1 - 2; x += 2.3)
        for (const y of [h + 0.35, 1.3])
          prims.push(
            { shape: 'box', min: [x, y, b0 + 0.05], max: [x + 2, y + 0.06, b0 + 0.85], material: 'steel', density: thin(0.003) },
            { shape: 'box', min: [x + 0.05, y + 0.06, b0 + 0.1], max: [x + 1.95, y + 0.22, b0 + 0.8], material: 'foam', color: [0.35, 0.4, 0.5] },
          );
    });
    room(-hx + 1, -cw - 0.2, cw, hz - 1, 'store', (a0, a1, b0, b1) => {
      for (let x = a0 + 0.3; x < a1 - 0.6; x += 0.7)
        for (let k = 0; k < 2 + Math.floor(rng() * 2); k++)
          prims.push({ shape: 'box', min: [x, h + k * 0.5, b1 - 0.6], max: [x + 0.6, h + (k + 1) * 0.5 - 0.02, b1 - 0.05], material: 'paper', density: 0.25, color: [0.65, 0.5, 0.32], variation: 0.15 });
    });
    // the server room: raised floor with cables underneath, racks, suspended ceiling
    const sx0 = cw + 0.2;
    const sx1 = hx - 1;
    const sz0 = cw;
    const sz1 = hz - 1;
    let rackFire = null;
    room(sx0, sx1, sz0, sz1, 'server room', (a0, a1, b0, b1) => {
      const rf = Math.max(0.4, 3 * h); // raised floor height
      prims.push(
        { shape: 'box', min: [a0, h, b0], max: [a1, rf - h, b1], material: 'cable', density: 0.15, mode: 'fill', fill: 0.6 },
        { shape: 'box', min: [a0, rf - h, b0], max: [a1, rf, b1], material: 'steel', density: thin(0.006), color: [0.75, 0.76, 0.78] },
      );
      for (let x = a0 + 1, k = 0; x < a1 - 0.8; x += 2.2, k++) {
        // an electrical fault in the second row, at mid height inside the rack
        if (k === 1 || !rackFire) rackFire = [x + 0.85, rf + 0.6, (b0 + b1) / 2]; // against the side of the rack
        // a row of racks: servers (plastic, boards, cables) behind perforated
        // front and back doors (open to the air), steel tops and end panels
        prims.push(
          { shape: 'box', min: [x, rf, b0 + 1], max: [x + 0.7, rf + 1.9, b1 - 1], material: 'plastic', density: 0.15, color: [0.15, 0.16, 0.18], variation: 0.1 },
          { shape: 'box', min: [x, rf + 1.85, b0 + 1], max: [x + 0.7, rf + 2.0, b1 - 1], material: 'steel', density: thin(0.002), color: [0.12, 0.12, 0.14] },
          { shape: 'box', min: [x, rf, b0 + 1], max: [x + 0.7, rf + 2.0, b0 + 1.05], material: 'steel', density: thin(0.002), color: [0.12, 0.12, 0.14] },
          { shape: 'box', min: [x, rf, b1 - 1.05], max: [x + 0.7, rf + 2.0, b1 - 1], material: 'steel', density: thin(0.002), color: [0.12, 0.12, 0.14] },
          { shape: 'box', min: [x + 0.2, rf + 1.9, b0 + 1.1], max: [x + 0.5, rf + 2.05, b1 - 1.1], material: 'cable', density: 0.4 },
        );
      }
      // suspended ceiling (tiles in a grid) under the overhead
      const ceil = H - 0.35;
      for (let x = a0; x < a1 - 0.3; x += 0.6)
        for (let z = b0; z < b1 - 0.3; z += 0.6)
          prims.push({ shape: 'box', min: [x, ceil, z], max: [Math.min(a1, x + 0.6), ceil + h * 0.9, Math.min(b1, z + 0.6)], material: 'ceilingTile', density: thin(0.015), group: true });
      for (let x = a0; x <= a1; x += 1.2) prims.push({ shape: 'box', min: [x - 0.01, ceil, b0], max: [x + 0.01, H, b1], material: 'steelProfile', density: thin(0.0015) });
    });
    // doors: steel, with the server room door a locked glass door
    for (const d of doors) {
      if (d.name === 'server room') {
        prims.push(
          { shape: 'box', min: [d.xd - 0.45, h * 1.01, d.zc - h / 2], max: [d.xd + 0.45, 2.0, d.zc + h / 2], material: 'aluminium', density: thin(0.004), color: [0.75, 0.76, 0.78], door: d.name, doorLocked: true },
          { shape: 'box', min: [d.xd - 0.3, 0.6, d.zc - h / 2], max: [d.xd + 0.3, 1.85, d.zc + h / 2], material: 'glass', density: thin(0.01), door: d.name, doorLocked: true },
        );
      } else {
        prims.push({ shape: 'box', min: [d.xd - 0.45, h * 1.01, d.zc - h / 2], max: [d.xd + 0.45, 2.0, d.zc + h / 2], material: 'steel', density: thin(0.008), color: [0.7, 0.72, 0.7], door: d.name });
      }
    }
    // ladder up to the flight deck at the aft end of the corridor
    const lx = -hx + 1.6;
    prims.push({ shape: 'box', min: [lx - 0.4, H - 0.01, -0.5], max: [lx + 0.4, H + h + 0.01, 0.5], mode: 'carve' });
    return {
      prims,
      heaters: [{ pos: rackFire, power: 15000, radius: 0.2, height: 0.6, igniteRadius: 0.5, start: p.rackFireAfter, label: 'server rack', event: 'rackFire', until: p.rackFireAfter + 120 }],
      spawn: { p: [lx + 1.2, h, 0], yaw: 0 },
      portals: [{ p: [lx, h, 0], r: 0.9, to: 'deck', label: 'Ladder: flight deck' }],
      inertSystems: p.inertSystem ? [{ p: [(sx0 + sx1) / 2, H - 0.6, (sz0 + sz1) / 2], trigger: 57, label: 'server room inert-gas system' }] : [],
    };
  },
};
