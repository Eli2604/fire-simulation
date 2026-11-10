/**
 * Catacombs: vaulted limestone passages on a grid, domed burial chambers at
 * some crossings, niches in the walls with bones and old cloth, wooden coffins,
 * wooden doors (one locked), and burning torches on the walls every few metres
 * (each a small flame that lights its surroundings and uses oxygen: with the
 * entrance closed, the air slowly goes bad and the torches dim).
 *
 * Walls are only a couple of voxels thick around each passage, so the
 * solid volume (and the simulation) stays small.
 */
export default {
  label: 'Catacombs',
  params: {
    cellsX: { value: 3, min: 1, max: 5, step: 1, label: 'Passages along X' },
    cellsZ: { value: 3, min: 1, max: 5, step: 1, label: 'Passages along Z' },
    cell: { value: 5, min: 3, max: 8, step: 0.5, label: 'Spacing (m)' },
    width: { value: 1.6, min: 1, max: 3, step: 0.1, label: 'Passage width (m)' },
    height: { value: 2.6, min: 2, max: 4, step: 0.1, label: 'Height (m)' },
    torchSpacing: { value: 4, min: 2, max: 10, step: 0.5, label: 'Torch spacing (m)' },
    entranceOpen: { value: true, label: 'Entrance open to the surface' },
    seed: { value: 3, min: 1, max: 999, step: 1, label: 'Random seed' },
    exitTo: { value: '', label: 'Zone the entrance stairs lead up to (empty: none)' },
  },
  build(p, { h, rng }) {
    const prims = [];
    const heaters = [];
    const nxC = p.cellsX;
    const nzC = p.cellsZ;
    const C = p.cell;
    const cw = p.width / 2;
    const H = p.height;
    const T = Math.max(2 * h, 0.35); // wall thickness
    const sx = (nxC * C) / 2;
    const sz = (nzC * C) / 2;
    const stone = { material: 'stone', anchored: true, variation: 0.12 };
    const xs = Array.from({ length: nxC + 1 }, (_, k) => -sx + k * C);
    const zs = Array.from({ length: nzC + 1 }, (_, k) => -sz + k * C);
    // passages: a stone shell, then the vaulted void
    const passage = (a, b, alongX) => {
      if (alongX) {
        prims.push({ shape: 'box', min: [a[0] - T, 0, a[2] - cw - T], max: [b[0] + T, H + T, a[2] + cw + T], ...stone, mode: 'fill' });
      } else {
        prims.push({ shape: 'box', min: [a[0] - cw - T, 0, a[2] - T], max: [a[0] + cw + T, H + T, b[2] + T], ...stone, mode: 'fill' });
      }
    };
    const carve = (a, b, alongX) => {
      const yv = H - cw; // springing line of the vault
      if (alongX) {
        prims.push({ shape: 'box', min: [a[0] - cw, h * 0.5, a[2] - cw], max: [b[0] + cw, yv, a[2] + cw], mode: 'carve' });
        prims.push({ shape: 'cylinder', a: [a[0] - cw, yv, a[2]], b: [b[0] + cw, yv, a[2]], r: cw, mode: 'carve' });
      } else {
        prims.push({ shape: 'box', min: [a[0] - cw, h * 0.5, a[2] - cw], max: [a[0] + cw, yv, b[2] + cw], mode: 'carve' });
        prims.push({ shape: 'cylinder', a: [a[0], yv, a[2] - cw], b: [a[0], yv, b[2] + cw], r: cw, mode: 'carve' });
      }
    };
    const runs = [];
    for (const z of zs) runs.push([[xs[0], 0, z], [xs[xs.length - 1], 0, z], true]);
    for (const x of xs) runs.push([[x, 0, zs[0]], [x, 0, zs[zs.length - 1]], false]);
    for (const r of runs) passage(...r);
    // chambers at some crossings: a wider domed room
    const chambers = [];
    for (const x of xs.slice(1, -1).length ? xs.slice(1, -1) : xs)
      for (const z of zs.slice(1, -1).length ? zs.slice(1, -1) : zs) if (rng() < 0.6) chambers.push([x, z]);
    if (!chambers.length) chambers.push([xs[1] ?? xs[0], zs[1] ?? zs[0]]);
    const cr = Math.min(C * 0.4, 2.2);
    for (const [x, z] of chambers) prims.push({ shape: 'box', min: [x - cr - T, 0, z - cr - T], max: [x + cr + T, H + 0.8 + T, z + cr + T], ...stone, mode: 'fill' });
    // entrance: a stair up to the surface at one corner. Built before the passages are
    // carved, so its shell does not wall off the junction at its foot. The ceiling rises
    // with the steps (headroom everywhere), and the top runs out of the domain: open air.
    const ex = xs[0];
    const ez = zs[0];
    const HEAD = 2.3;
    for (let k = 0; k < 10; k++) {
      const z0 = ez - 6 + k * 0.6; // ten 0.6 m treads, 0.3 m risers, down to the passage
      const z1 = z0 + 0.6;
      const top = (H + T) * (1 - (k + 1) / 10);
      prims.push({ shape: 'box', min: [ex - cw - T, 0, z0 - (k ? 0 : T)], max: [ex + cw + T, top + HEAD + T, z1], ...stone, mode: 'fill' });
      prims.push({ shape: 'box', min: [ex - cw, h * 0.5, z0], max: [ex + cw, top + HEAD, z1], mode: 'carve' });
      if (top > 0) prims.push({ shape: 'box', min: [ex - cw, 0, z0], max: [ex + cw, top, z1], ...stone });
    }
    if (p.entranceOpen) prims.push({ shape: 'box', min: [ex - cw, H, ez - 6 - T - 0.01], max: [ex + cw, 99, ez - 5], mode: 'carve' });
    else prims.push({ shape: 'box', min: [ex - cw - T, 0, ez - 6 - T], max: [ex + cw + T, 99, ez - 5.8], ...stone });
    for (const r of runs) carve(...r);
    for (const [x, z] of chambers) {
      prims.push(
        { shape: 'box', min: [x - cr, h * 0.5, z - cr], max: [x + cr, H - 0.3, z + cr], mode: 'carve' },
        { shape: 'ellipsoid', c: [x, H - 0.3, z], r: [cr, 1.1, cr], mode: 'carve' },
      );
      // coffins in two opposite corners (clear of the passages crossing the chamber), a shroud on one
      const cl = Math.max(0.7, cr - cw - 0.25); // length that fits the corner
      for (const sg of [-1, 1]) {
        const xa = sg < 0 ? x - cr + 0.1 : x + cr - 0.1 - cl;
        const za = sg < 0 ? z - cr + 0.1 : z + cr - 0.7;
        prims.push({ shape: 'box', min: [xa, h * 0.5, za], max: [xa + cl, 0.6, za + 0.6], material: 'wood', density: 0.25, color: [0.38, 0.27, 0.17] });
        if (sg < 0) prims.push({ shape: 'box', min: [xa + 0.05, 0.6, za + 0.05], max: [xa + cl - 0.05, 0.6 + Math.max(h, 0.1), za + 0.55], material: 'fabric', color: [0.6, 0.55, 0.45] });
      }
    }
    // burial niches in the passage walls: bones and rags. Only where there is a wall:
    // not at crossings or inside chambers.
    const walled = (pt) =>
      !xs.some((x) => zs.some((z) => Math.abs(pt[0] - x) < cw + 0.6 && Math.abs(pt[2] - z) < cw + 0.6)) &&
      !chambers.some(([x, z]) => Math.abs(pt[0] - x) < cr + 0.6 && Math.abs(pt[2] - z) < cr + 0.6);
    for (const [a, b, alongX] of runs) {
      const len = alongX ? b[0] - a[0] : b[2] - a[2];
      for (let s = 1.2; s < len - 1; s += 1.6) {
        if (rng() < 0.35) continue;
        if (!walled(alongX ? [a[0] + s, 0, a[2]] : [a[0], 0, a[2] + s])) continue;
        for (const side of [-1, 1]) {
          if (rng() < 0.4) continue;
          const y0 = 0.5 + Math.floor(rng() * 2) * 0.7;
          if (alongX) {
            const x = a[0] + s;
            const zw = a[2] + side * cw;
            prims.push(
              { shape: 'box', min: [x - 0.5, y0, Math.min(zw, zw + side * 0.5)], max: [x + 0.5, y0 + 0.5, Math.max(zw, zw + side * 0.5)], mode: 'carve' },
              { shape: 'box', min: [x - 0.45, y0, Math.min(zw, zw + side * 0.45)], max: [x + 0.45, y0 + 0.12, Math.max(zw, zw + side * 0.45)], material: 'bone', mode: 'fill', fill: 0.6, variation: 0.2 },
              { shape: 'box', min: [x - 0.4, y0 + 0.12, Math.min(zw, zw + side * 0.4)], max: [x + 0.2, y0 + 0.18, Math.max(zw, zw + side * 0.4)], material: 'fabric', color: [0.5, 0.45, 0.35], fill: 0.7, mode: 'fill' },
            );
          } else {
            const z = a[2] + s;
            const xw = a[0] + side * cw;
            prims.push(
              { shape: 'box', min: [Math.min(xw, xw + side * 0.5), y0, z - 0.5], max: [Math.max(xw, xw + side * 0.5), y0 + 0.5, z + 0.5], mode: 'carve' },
              { shape: 'box', min: [Math.min(xw, xw + side * 0.45), y0, z - 0.45], max: [Math.max(xw, xw + side * 0.45), y0 + 0.12, z + 0.45], material: 'bone', mode: 'fill', fill: 0.6, variation: 0.2 },
              { shape: 'box', min: [Math.min(xw, xw + side * 0.4), y0 + 0.12, z - 0.4], max: [Math.max(xw, xw + side * 0.4), y0 + 0.18, z + 0.2], material: 'fabric', color: [0.5, 0.45, 0.35], fill: 0.7, mode: 'fill' },
            );
          }
        }
      }
      // torches on the walls: wooden stick, pitch-soaked head, a small flame that lights up
      // (every torchSpacing metres along the walled stretches; at least one per stretch)
      let last = -Infinity;
      for (let s = 0.3; s < len; s += 0.3) {
        if (!walled(alongX ? [a[0] + s, 0, a[2]] : [a[0], 0, a[2] + s])) {
          last = Math.max(last, s - p.torchSpacing + 1.1); // first torch ~1 m into the next stretch
          continue;
        }
        if (s - last < p.torchSpacing) continue;
        last = s;
        const side = rng() < 0.5 ? -1 : 1;
        const base = alongX ? [a[0] + s, 1.5, a[2] + side * cw] : [a[0] + side * cw, 1.5, a[2] + s];
        const out = alongX ? [0, 0, -side] : [-side, 0, 0];
        const tip = [base[0] + out[0] * 0.25, 1.85, base[2] + out[2] * 0.25];
        const bw = Math.max(h, 0.08); // at least a voxel
        prims.push(
          { shape: 'box', min: [base[0] - bw / 2 + Math.min(0, out[0]) * bw, 1.4, base[2] - bw / 2 + Math.min(0, out[2]) * bw], max: [base[0] + bw / 2 + Math.max(0, out[0]) * bw, 1.4 + 2 * bw, base[2] + bw / 2 + Math.max(0, out[2]) * bw], material: 'steel', color: [0.12, 0.11, 0.1], anchored: true },
          { shape: 'capsule', a: base, b: tip, r: Math.max(0.025, h * 0.6), material: 'wood', density: 0.6, color: [0.3, 0.2, 0.12], anchored: true },
          { shape: 'sphere', c: tip, r: Math.max(0.06, h * 0.8), material: 'wood', density: 0.9, moisture: 0, color: [0.12, 0.07, 0.04], anchored: true },
        );
        heaters.push({ pos: [tip[0], tip[1] + 0.05, tip[2]], power: 1500, radius: 0.05, height: 0.35, light: true, label: 'torch' });
      }
    }
    // doors between some passages and chambers: wooden, one locked
    const doors = [];
    chambers.forEach(([x, z], k) => {
      const dz = z - cr - T / 2;
      doors.push(
        { shape: 'box', min: [x - cw, h * 0.5, dz - T / 2], max: [x + cw, Math.min(2.1, H - 0.3), dz + T / 2], material: 'wood', density: Math.min(1, 0.05 / h), color: [0.33, 0.22, 0.13], door: `chamber ${k + 1}`, doorLocked: k === 0 },
      );
    });
    prims.push(...doors);
    return {
      prims,
      heaters,
      spawn: { p: [ex, 0, ez - 0.5], yaw: Math.PI / 2 },
      portals: p.exitTo ? [{ p: [ex, 0, ez - 2.5], r: 1.0, to: p.exitTo, label: 'Stairs: up to the surface', arrive: { p: [ex, 0, ez - 0.5], yaw: Math.PI / 2 } }] : [],
      ignite: { p: [chambers[0][0] - cr + 1, 0.65, chambers[0][1]], radius: 0.4, power: 3000, materials: ['fabric', 'wood'] },
    };
  },
};
