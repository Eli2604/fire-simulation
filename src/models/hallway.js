import { hexToRgb } from './util.js';

/**
 * A corridor in an office building.
 *
 *  - Painted walls (the paint discolours, blisters and peels; damp concrete spalls).
 *  - A suspended ceiling: mineral-fibre tiles laid in a light steel grid that hangs
 *    on wires from the concrete slab. Every tile is its own panel: it rests on
 *    the grid, not on its neighbours. Heat makes tiles break down and drop; when
 *    the grid or its hangers lose their strength whole sections come down.
 *  - Hidden in the ceiling void: a gas pipe, a copper water pipe and a cable
 *    tray with PVC cables (very smoky fuel).
 *  - After a delay the gas pipe bursts and the escaping gas ignites: a jet
 *    flame, out of sight in the ceiling void by default. Smoke leaks through
 *    the tile joints, spreads under the ceiling and fills the corridor from the
 *    top down.
 *
 * Local frame: the corridor runs along x, the entrance is at -x.
 */
const WALLS = { concrete: 'concrete', brick: 'brick', plasterboard: 'plaster' };

export default {
  label: 'Building hallway (gas pipe burst)',
  params: {
    length: { value: 12, min: 4, max: 30, step: 0.5, label: 'Length (m)' },
    width: { value: 2, min: 1.2, max: 4, step: 0.1, label: 'Width (m)' },
    height: { value: 2.6, min: 2.2, max: 4, step: 0.1, label: 'Ceiling height (m)' },
    walls: { value: 'concrete', options: Object.keys(WALLS), label: 'Walls' },
    paintColor: { value: '#d9d4c3', color: true, label: 'Wall paint' },
    ceiling: { value: 'suspended', options: ['suspended', 'plain'], label: 'Ceiling' },
    voidDepth: { value: 0.6, min: 0.3, max: 1.2, step: 0.05, label: 'Ceiling void depth (m)' },
    cables: { value: true, label: 'Cable tray in the void' },
    doorsPerSide: { value: 3, min: 0, max: 8, step: 1, label: 'Doors per side' },
    entranceOpen: { value: true, label: 'Entrance door open' },
    endWindow: { value: true, label: 'Window at the far end' },
    pipeIn: { value: 'hallway', options: ['hallway', 'ceiling void'], label: 'Gas pipe runs' },
    burstAt: { value: 0.6, min: 0.05, max: 0.95, step: 0.01, label: 'Burst position along pipe' },
    burstTrigger: { value: 'after delay', options: ['after delay', 'only by fire or blast'], label: 'Pipe burst' },
    burstAfter: { value: 20, min: 0, max: 600, step: 1, label: 'Pipe bursts after (s)' },
    burstPower: { value: 150000, min: 10000, max: 1000000, step: 5000, label: 'Burning gas jet (W)' },
    boxes: { value: true, label: 'Cardboard boxes stored' },
    noticeBoard: { value: true, label: 'Notice board' },
    carpet: { value: true, label: 'Carpet runner' },
  },
  build(p, { h }) {
    const L = p.length;
    const W = p.width;
    const H = p.height;
    const t = h; // floor slab
    const wt = Math.max(h, 0.2);
    const wall = WALLS[p.walls];
    const thin = (m) => Math.min(1, Math.max(0.002, m / h));
    const hx = L / 2;
    const hz = W / 2;
    const suspended = p.ceiling === 'suspended';
    const ceil = t + H; // underside of the (suspended) ceiling
    const slab = suspended ? ceil + p.voidDepth : ceil; // underside of the concrete slab
    const wallD = p.walls === 'plasterboard' ? thin(0.025) : 1;
    const paint = { paint: true, color: hexToRgb(p.paintColor), variation: 0.03 };

    const prims = [
      { shape: 'box', min: [-hx - wt, 0, -hz - wt], max: [hx + wt, t, hz + wt], material: 'concrete' },
      { shape: 'box', min: [-hx - wt, t, -hz - wt], max: [hx + wt, slab, hz + wt], material: wall, density: wallD },
      { shape: 'box', min: [-hx - wt, slab, -hz - wt], max: [hx + wt, slab + 0.25, hz + wt], material: 'concrete', anchored: true },
      { shape: 'box', min: [-hx, t * 1.01, -hz], max: [hx, slab - 0.001, hz], mode: 'carve' },
      // paint on the inside of the walls (the visible part, below the ceiling)
      { shape: 'box', min: [-hx - h, t * 1.01, -hz - h], max: [hx + h, ceil, -hz], material: wall, mode: 'replace', density: wallD, ...paint },
      { shape: 'box', min: [-hx - h, t * 1.01, hz], max: [hx + h, ceil, hz + h], material: wall, mode: 'replace', density: wallD, ...paint },
      { shape: 'box', min: [-hx - h, t * 1.01, -hz], max: [-hx, ceil, hz], material: wall, mode: 'replace', density: wallD, ...paint },
      { shape: 'box', min: [hx, t * 1.01, -hz], max: [hx + h, ceil, hz], material: wall, mode: 'replace', density: wallD, ...paint },
      // entrance at -x
      { shape: 'box', min: [-hx - wt - 0.01, t * 1.01, -0.5], max: [-hx + 0.01, t + 2.1, 0.5], mode: 'carve' },
    ];
    if (!p.entranceOpen) prims.push({ shape: 'box', min: [-hx - wt / 2 - t / 2, t * 1.01, -0.5], max: [-hx - wt / 2 + t / 2, t + 2.1, 0.5], material: 'wood', density: thin(0.04), color: [0.45, 0.3, 0.18] });
    if (p.endWindow) {
      prims.push(
        { shape: 'box', min: [hx - 0.01, t + 0.9, -0.6], max: [hx + wt + 0.01, t + 2.0, 0.6], mode: 'carve' },
        { shape: 'box', min: [hx + wt / 2 - t / 2, t + 0.9, -0.6], max: [hx + wt / 2 + t / 2, t + 2.0, 0.6], material: 'glass', density: thin(0.006) },
      );
    }
    // closed office doors along both walls
    const n = p.doorsPerSide;
    for (let k = 0; k < n; k++) {
      const x = -hx + (L * (k + 0.75)) / (n + 0.5);
      for (const s of [-1, 1]) {
        const zc = s * (hz + wt / 2);
        prims.push(
          { shape: 'box', min: [x - 0.45, t * 1.01, zc - wt / 2 - 0.01], max: [x + 0.45, t + 2.05, zc + wt / 2 + 0.01], mode: 'carve' },
          { shape: 'box', min: [x - 0.45, t * 1.01, zc - t / 2], max: [x + 0.45, t + 2.05, zc + t / 2], material: 'wood', density: thin(0.04), color: [0.55, 0.38, 0.22] },
        );
      }
    }
    if (p.carpet) prims.push({ shape: 'box', min: [-hx + 0.3, t, -W * 0.3], max: [hx - 0.3, t + 0.01, W * 0.3], material: 'fabric', color: [0.35, 0.22, 0.25], density: thin(0.008), mode: 'fill' });

    // --- suspended ceiling: tiles (one rigid panel each) in a steel grid on hangers
    const P = 0.6; // tile size
    if (suspended) {
      const nxp = Math.max(1, Math.round(L / P));
      const nzp = Math.max(1, Math.round(W / P));
      const px = L / nxp;
      const pz = W / nzp;
      for (let a = 0; a < nxp; a++)
        for (let b = 0; b < nzp; b++)
          prims.push({
            shape: 'box', min: [-hx + a * px, ceil, -hz + b * pz], max: [-hx + (a + 1) * px, ceil + h * 0.9, -hz + (b + 1) * pz],
            material: 'ceilingTile', density: thin(0.015), group: true, variation: 0.02,
          });
      const grid = { material: 'steelProfile', density: thin(0.0015), color: [0.85, 0.85, 0.86] };
      for (let a = 0; a <= nxp; a++) {
        const x = -hx + a * px;
        prims.push({ shape: 'box', min: [x - 0.01, ceil, -hz], max: [x + 0.01, ceil + h * 0.9, hz], ...grid });
      }
      for (let b = 0; b <= nzp; b++) {
        const z = -hz + b * pz;
        prims.push({ shape: 'box', min: [-hx, ceil, z - 0.01], max: [hx, ceil + h * 0.9, z + 0.01], ...grid });
      }
      // hanger wires every ~1.2 m
      for (let x = -hx + px; x < hx; x += 2 * px)
        for (let z = -hz + pz; z < hz - 0.01; z += 2 * pz)
          prims.push({ shape: 'box', min: [x - 0.01, ceil, z - 0.01], max: [x + 0.01, slab, z + 0.01], material: 'steelProfile', density: thin(0.0005) });
    }

    // --- services: gas pipe (yellow), copper water pipe, cable tray with PVC cables
    // by default the gas line runs exposed along the corridor wall, just under the ceiling
    const inVoid = suspended && p.pipeIn === 'ceiling void';
    const voidMid = (ceil + h + slab) / 2;
    const gasZ = inVoid ? -hz + 0.3 : -(hz - 0.1);
    const gasY = inVoid ? voidMid : ceil - 0.3;
    // the gas line can burst: on its own timer, when a blast hits it, or when fire heats a joint
    prims.push({ shape: 'cylinder', a: [-hx, gasY, gasZ], b: [hx, gasY, gasZ], r: 0.025, material: 'steel', color: [0.85, 0.7, 0.1], density: thin(0.003), anchored: true, gasPipe: { power: p.burstPower, ...(inVoid ? { jetHeight: Math.max(0.3, slab - gasY) } : { jetHeight: W * 1.15, dir: [0.15, -0.55, 0.82] }) } });
    if (suspended) {
      prims.push({ shape: 'cylinder', a: [-hx, voidMid, 0], b: [hx, voidMid, 0], r: 0.02, material: 'copper', density: thin(0.001), anchored: true });
      if (p.cables) {
        // in the void the tray runs right next to the gas pipe, as services often do
        const cz = inVoid ? gasZ + 0.4 : -hz + 0.4;
        const ty = inVoid ? gasY - 0.12 : ceil + p.voidDepth * 0.35;
        prims.push(
          { shape: 'box', min: [-hx, ty, cz - 0.15], max: [hx, ty + 0.01, cz + 0.15], material: 'steelProfile', density: thin(0.0015), anchored: true },
          { shape: 'box', min: [-hx, ty + h, cz - 0.12], max: [hx, ty + h + 0.06, cz + 0.12], material: 'cable', density: 0.35 },
        );
      }
    }
    const bx = -hx + p.burstAt * L;

    if (p.boxes) {
      // stored against the opposite wall, where the jet from a burst in the corridor lands
      const box = (x0, y0, z0, sx, sy, sz) => ({ shape: 'box', min: [x0, y0, z0], max: [x0 + sx, y0 + sy, z0 + sz], material: 'paper', density: 0.25, color: [0.68, 0.52, 0.32], variation: 0.15 });
      const zb = hz - 0.47;
      prims.push(
        box(bx + 0.6, t, zb, 0.5, 0.4, 0.45),
        box(bx + 1.15, t, zb, 0.5, 0.4, 0.45),
        box(bx + 0.85, t + 0.4, zb, 0.5, 0.4, 0.45),
        box(bx - 1.15, t, zb, 0.45, 0.35, 0.4),
      );
    }
    if (p.noticeBoard) {
      prims.push(
        { shape: 'box', min: [bx - 1.6, t + 1.2, -hz], max: [bx - 0.4, t + 1.9, -hz + 0.02], material: 'wood', density: thin(0.015), color: [0.6, 0.45, 0.3] },
        { shape: 'box', min: [bx - 1.5, t + 1.25, -hz + 0.02], max: [bx - 0.5, t + 1.85, -hz + 0.03], material: 'paper', color: [0.92, 0.9, 0.82], variation: 0.2, density: thin(0.003) },
      );
    }
    prims.push({ shape: 'box', min: [bx - 0.5, t, hz - 0.45], max: [bx + 0.5, t + 1.9, hz], material: 'wood', density: 0.3, color: [0.5, 0.35, 0.2] });

    return {
      prims,
      heaters: p.burstTrigger !== 'after delay' ? [] : [
        {
          pos: [bx, gasY, gasZ + (inVoid ? 0 : 0.08)],
          power: p.burstPower,
          radius: inVoid ? 0.3 : 0.2,
          // in the corridor the jet shoots across and down, onto the cabinet and boxes opposite
          ...(inVoid ? { height: Math.max(0.2, slab - gasY) } : { height: W * 1.15, dir: [0.15, -0.55, 0.82] }),
          start: p.burstAfter,
          label: 'gas pipe',
          event: 'pipeBurst',
          jet: true,
          smokeYield: 0.004, // under-ventilated gas fire in a confined void: some soot
        },
      ],
      // where a firefighter starts: outside the entrance, looking in
      spawn: { p: [-hx - wt - 1.5, 0, 0], yaw: 0 },
    };
  },
};
