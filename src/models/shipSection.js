/**
 * A section of a ship afloat: steel hull, a lower deck below the waterline and
 * an upper deck above it, each with a corridor along the ship and two cross
 * corridors running out to the hull sides, cabins in between, a stair between
 * the decks, watertight doors and cabin doors that open and close.
 *
 * A gas / fuel line runs along the lower corridor and bursts after a delay
 * (or by fire or a blast). Below the waterline, any hole in the hull plating
 * lets the sea pour in (see water.js) and the corridors flood.
 *
 * Local frame: origin at the keel, centre of the footprint; x along the ship.
 */
export default {
  label: 'Ship section (decks and corridors)',
  params: {
    length: { value: 16, min: 10, max: 30, step: 0.5, label: 'Length (m)' },
    beam: { value: 7, min: 5, max: 14, step: 0.1, label: 'Beam (m)' },
    depth: { value: 6.2, min: 5, max: 9, step: 0.1, label: 'Keel to main deck (m)' },
    draft: { value: 3.8, min: 1, max: 6, step: 0.1, label: 'Draft: waterline above keel (m)' },
    corridorWidth: { value: 1.4, min: 1, max: 2.5, step: 0.1, label: 'Corridor width (m)' },
    furnished: { value: true, label: 'Furnished cabins' },
    sprinklers: { value: false, label: 'Sprinklers' },
    burstAfter: { value: 30, min: 0, max: 600, step: 1, label: 'Fuel line bursts after (s)' },
    burstPower: { value: 200000, min: 20000, max: 1000000, step: 10000, label: 'Burning jet (W)' },
    burstBlast: { value: 1e6, min: 0, max: 6e6, step: 1e5, label: 'Vapour explosion at the burst (J; 0: none)' },
    upTo: { value: '', label: 'Zone the ladder at the aft end leads up to (empty: none)' },
  },
  build(p, { h }) {
    const L = p.length;
    const B = p.beam;
    const D = p.depth;
    const t = h; // plating, one voxel
    const thin = (m) => Math.min(1, Math.max(0.004, m / h));
    const hx = L / 2;
    const hz = B / 2;
    const cw = p.corridorWidth / 2;
    const plate = { material: 'steel', density: thin(0.012), anchored: true };
    const bulkhead = { material: 'steel', density: thin(0.006), color: [0.86, 0.86, 0.84] };
    const floor1 = 0.7; // tank top (double bottom below)
    const deck2 = 3.3; // between the decks
    const deckH = 2.4; // clear height of a deck
    const prims = [
      // hull: plating all round, painted red below the waterline, dark blue above
      { shape: 'box', min: [-hx, 0, -hz], max: [hx, D, hz], ...plate, color: [0.12, 0.17, 0.3], hull: true },
      { shape: 'box', min: [-hx + t, t, -hz + t], max: [hx - t, D - t, hz - t], mode: 'carve' },
      { shape: 'box', min: [-hx - 0.01, -0.01, -hz - 0.01], max: [hx + 0.01, p.draft, hz + 0.01], material: 'steel', mode: 'replace', density: thin(0.012), anchored: true, color: [0.55, 0.12, 0.1], hull: true },
      // tank top and the deck between the two levels
      { shape: 'box', min: [-hx, floor1 - t, -hz], max: [hx, floor1, hz], ...plate, color: [0.45, 0.45, 0.43] },
      { shape: 'box', min: [-hx, deck2 - t, -hz], max: [hx, deck2, hz], ...plate, color: [0.45, 0.45, 0.43] },
    ];
    const bursts = [];
    const doors = (level) => `deck ${level}`;
    // one deck level: fill with cabin blocks, carve corridors and cabins
    const level = (y0, lv) => {
      const y1 = y0 + deckH;
      prims.push({ shape: 'box', min: [-hx + t, y0, -hz + t], max: [hx - t, y1, hz - t], ...bulkhead });
      // corridor along the ship, and two cross corridors to the hull sides
      const xc = [-L / 4, L / 4];
      prims.push({ shape: 'box', min: [-hx + 1, y0, -cw], max: [hx - 1, y1, cw], mode: 'carve' });
      for (const x of xc) prims.push({ shape: 'box', min: [x - cw, y0, -hz + t], max: [x + cw, y1, hz - t], mode: 'carve' });
      // cabins: between the cross corridors and at the ends, both sides
      const segs = [
        [-hx + 1, xc[0] - cw],
        [xc[0] + cw, xc[1] - cw],
        [xc[1] + cw, hx - 1],
      ];
      let n = 0;
      for (const [sx0, sx1] of segs) {
        const len = sx1 - sx0;
        const per = Math.max(1, Math.round(len / 3));
        for (let k = 0; k < per; k++) {
          const a0 = sx0 + (len * k) / per + t;
          const a1 = sx0 + (len * (k + 1)) / per - t;
          for (const s of [-1, 1]) {
            const z0 = s > 0 ? cw + t : -hz + 2 * t;
            const z1 = s > 0 ? hz - 2 * t : -cw - t;
            prims.push({ shape: 'box', min: [a0, y0, z0], max: [a1, y1 - 0.01, z1], mode: 'carve' });
            // door from the corridor into the cabin
            const dx = (a0 + a1) / 2;
            const dz = s > 0 ? cw + t / 2 : -cw - t / 2;
            prims.push(
              { shape: 'box', min: [dx - 0.4, y0, dz - t], max: [dx + 0.4, y0 + 2.0, dz + t], mode: 'carve' },
              { shape: 'box', min: [dx - 0.4, y0, dz - t / 2], max: [dx + 0.4, y0 + 2.0, dz + t / 2], material: 'wood', density: thin(0.04), color: [0.6, 0.5, 0.36], door: `${doors(lv)} cabin ${++n}` },
            );
            if (p.furnished) {
              const zb = s > 0 ? z1 : z0;
              const zi = s > 0 ? -1 : 1;
              prims.push(
                // bunk with mattress along the hull side, locker, papers
                { shape: 'box', min: [a0 + 0.1, y0, Math.min(zb, zb + zi * 0.8)], max: [Math.min(a1 - 0.1, a0 + 2.0), y0 + 0.45, Math.max(zb, zb + zi * 0.8)], material: 'wood', density: 0.3 },
                { shape: 'box', min: [a0 + 0.15, y0 + 0.45, Math.min(zb, zb + zi * 0.75)], max: [Math.min(a1 - 0.15, a0 + 1.95), y0 + 0.62, Math.max(zb, zb + zi * 0.75)], material: 'foam', color: [0.3, 0.38, 0.55] },
                { shape: 'box', min: [a1 - 0.5, y0, Math.min(z0, z1) + 0.1], max: [a1 - 0.05, y0 + 1.9, Math.min(z0, z1) + 0.6], material: 'steel', density: thin(0.002), color: [0.7, 0.72, 0.7] },
                { shape: 'box', min: [a1 - 0.45, y0 + 0.2, Math.min(z0, z1) + 0.15], max: [a1 - 0.1, y0 + 1.6, Math.min(z0, z1) + 0.55], material: 'fabric', color: [0.5, 0.45, 0.35], density: 0.3 },
              );
            }
          }
        }
      }
      // watertight doors between the long corridor and the cross corridors (steel)
      for (const x of xc)
        for (const s of [-1, 1]) {
          const dx = x + s * (cw + 0.4);
          prims.push({ shape: 'box', min: [dx - t / 2, y0, -cw], max: [dx + t / 2, y0 + 2.0, cw], material: 'steel', density: thin(0.012), color: [0.8, 0.8, 0.78], door: `${doors(lv)} watertight ${x < 0 ? 'aft' : 'fwd'} ${s < 0 ? 'A' : 'B'}`, doorOpen: true });
        }
      return y1;
    };
    level(floor1, 1);
    level(deck2, 2);
    // stair opening between the decks at the forward end of the corridor, with steps
    const sx = hx - 2.2;
    prims.push({ shape: 'box', min: [sx - 0.9, deck2 - t - 0.01, -cw], max: [sx + 0.9, deck2 + 0.01, cw], mode: 'carve' });
    const steps = 12;
    for (let k = 0; k < steps; k++) {
      const x = sx + 0.9 - ((k + 1) * 1.8) / steps;
      const y = floor1 + ((k + 1) * (deck2 - floor1)) / steps;
      prims.push({ shape: 'box', min: [x, y - 0.08, -cw + 0.05], max: [x + 1.8 / steps + 0.02, y, cw - 0.05], material: 'steel', density: thin(0.006), color: [0.5, 0.5, 0.5] });
    }
    // fuel line along the lower corridor, under its ceiling
    const gy = floor1 + deckH - 0.25;
    const gz = -cw + 0.1;
    prims.push({ shape: 'cylinder', a: [-hx + 1, gy, gz], b: [hx - 1, gy, gz], r: Math.max(0.03, h * 0.6), material: 'steel', color: [0.85, 0.7, 0.1], density: thin(0.003), anchored: true, gasPipe: { power: p.burstPower, jetHeight: 1.6, dir: [0.2, -0.6, 0.78] } });
    // the sea-water fire main along the other side: a blast or the fire breaks it, and it floods the corridor
    prims.push({ shape: 'cylinder', a: [-hx + 1, gy, -gz], b: [hx - 1, gy, -gz], r: Math.max(0.04, h * 0.6), material: 'steel', color: [0.2, 0.45, 0.25], density: thin(0.004), anchored: true, waterPipe: { rate: 20, label: 'sea-water main' } });
    // a branch runs down the aft cross corridor to the fuel tank outboard; it bursts there,
    // against the hull below the waterline: the vapour explodes, tears the plating open
    // (the sea comes in), and the leaking fuel burns as a jet
    const bx = -L / 4;
    const bz = -hz + 0.7;
    prims.push({ shape: 'cylinder', a: [bx + cw - 0.15, gy, gz], b: [bx + cw - 0.15, gy, -hz + t + 0.05], r: Math.max(0.03, h * 0.6), material: 'steel', color: [0.85, 0.7, 0.1], density: thin(0.003), anchored: true, gasPipe: { power: p.burstPower, jetHeight: 1.6, dir: [0, -0.6, 0.8] } });
    bursts.push({
      pos: [bx + cw - 0.25, gy, bz], power: p.burstPower, radius: 0.2, height: 1.6, dir: [-0.3, -0.6, 0.7], start: p.burstAfter,
      label: 'fuel line', event: 'pipeBurst', jet: true, smokeYield: 0.01,
      blast: p.burstBlast > 0 ? { p: [bx, floor1 + 0.6, -hz + t + 0.25], energy: p.burstBlast } : undefined,
    });

    const sprinklers = [];
    if (p.sprinklers)
      for (const y of [floor1 + deckH - 0.05, deck2 + deckH - 0.05]) for (let x = -hx + 2; x < hx - 1; x += 3) sprinklers.push({ p: [x, y, 0] });

    return {
      prims,
      heaters: bursts,
      sprinklers,
      // floating: its weight is what it displaces at its draft; water aboard sinks it deeper
      sea: { level: p.draft, box: [-hx, -hz, hx, hz], ship: { keel: 0, deck: D, kg: D * 0.55 } },
      // start on the lower deck at the aft end of the corridor
      spawn: { p: [-hx + 1.6, floor1, 0], yaw: 0 },
      // (in a larger ship: a ladder up to the decks above, another zone)
      portals: p.upTo ? [{ p: [-hx + 0.8, floor1, 0], r: 0.8, to: p.upTo, label: 'Ladder: up to the hangar deck', arrive: { p: [-hx + 1.8, floor1, 0], yaw: 0 } }] : [],
      ignite: { p: [-L / 8, floor1 + 0.4, cw + 0.8], radius: 0.4, power: 8000 },
    };
  },
};
