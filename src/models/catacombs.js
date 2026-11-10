/**
 * Catacombs (after the quarries under Paris): galleries cut into the limestone
 * bedrock on a grid, low and flat-ceilinged (or vaulted), with a sandy floor and
 * the black guide line along the ceiling. Long stretches are lined with ossuary
 * walls of stacked bones up to just under the ceiling (drawn as bones by
 * render/ossuary.js), others with masonry or bare rock; engraved tablets, some on
 * white pedestals; burial chambers at some crossings with bone walls, a round
 * pillar of bones ("tonneau") and coffins, niches in the walls with bones and old cloth, wooden coffins,
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
    cellsX: { value: 4, min: 1, max: 6, step: 1, label: 'Passages along X' },
    cellsZ: { value: 4, min: 1, max: 6, step: 1, label: 'Passages along Z' },
    cell: { value: 5, min: 3, max: 8, step: 0.5, label: 'Spacing (m)' },
    width: { value: 1.8, min: 1, max: 3, step: 0.1, label: 'Passage width (m)' },
    ossuary: { value: 0.5, min: 0, max: 1, step: 0.05, label: 'Share of walls of stacked bones (ossuary)' },
    height: { value: 2.3, min: 2, max: 4, step: 0.1, label: 'Height (m)' },
    ceiling: { value: 'flat', options: ['flat', 'vaulted'], label: 'Ceiling' },
    masonry: { value: 0.5, min: 0, max: 1, step: 0.05, label: 'Share of the other walls in masonry (else bare rock)' },
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
    const stone = { material: 'bedrock', anchored: true, variation: 0.12 };
    const flat = p.ceiling === 'flat';
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
      if (flat) {
        // a gallery cut square into the rock, a flat ceiling
        if (alongX) prims.push({ shape: 'box', min: [a[0] - cw, h * 0.5, a[2] - cw], max: [b[0] + cw, H, a[2] + cw], mode: 'carve' });
        else prims.push({ shape: 'box', min: [a[0] - cw, h * 0.5, a[2] - cw], max: [a[0] + cw, H, b[2] + cw], mode: 'carve' });
        return;
      }
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
    for (const [a, b, alongX] of runs) {
      const line = { material: 'stone', color: [0.06, 0.055, 0.05], variation: 0.02, anchored: true, mode: 'replace' };
      if (alongX) prims.push({ shape: 'box', min: [a[0] - cw, H - h * 0.9, a[2] - h * 0.6], max: [b[0] + cw, H + h, a[2] + h * 0.6], ...line });
      else prims.push({ shape: 'box', min: [a[0] - h * 0.6, H - h * 0.9, a[2] - cw], max: [a[0] + h * 0.6, H + h, b[2] + cw], ...line });
    }
    for (const [x, z] of chambers) {
      if (flat) prims.push({ shape: 'box', min: [x - cr, h * 0.5, z - cr], max: [x + cr, H + 0.3, z + cr], mode: 'carve' });
      else
        prims.push(
          { shape: 'box', min: [x - cr, h * 0.5, z - cr], max: [x + cr, H - 0.3, z + cr], mode: 'carve' },
          { shape: 'ellipsoid', c: [x, H - 0.3, z], r: [cr, 1.1, cr], mode: 'carve' },
        );
      // coffins in two opposite corners (clear of the passages crossing the chamber), a shroud on one
      const cl = Math.max(0.6, cr - cw - 0.5); // length that fits the corner (clear of the bone walls)
      for (const sg of [-1, 1]) {
        const xa = sg < 0 ? x - cr + 0.35 : x + cr - 0.35 - cl;
        const za = sg < 0 ? z - cr + 0.35 : z + cr - 0.95;
        prims.push({ shape: 'box', min: [xa, h * 0.5, za], max: [xa + cl, 0.6, za + 0.6], material: 'wood', density: 0.25, color: [0.38, 0.27, 0.17] });
        if (sg < 0) prims.push({ shape: 'box', min: [xa + 0.05, 0.6, za + 0.05], max: [xa + cl - 0.05, 0.6 + Math.max(h, 0.1), za + 0.55], material: 'fabric', color: [0.6, 0.55, 0.45] });
      }
    }
    // ossuary walls: in some stretches (and round every chamber) the lower walls are skulls
    // and long bones stacked in rows, the rest dressed limestone with carved inscriptions
    const OSS = Math.min(2.0, H - 0.3); // height of the bone walls: up to just under the ceiling
    const bones = { material: 'ossuary', anchored: true, variation: 0.06, mode: 'replace' };
    const ossStretch = [];
    for (const [a, b, alongX] of runs) {
      const ends = alongX ? xs : zs;
      for (let k = 0; k + 1 < ends.length; k++) {
        const s0 = ends[k] + cw + 0.2;
        const s1 = ends[k + 1] - cw - 0.2;
        if (s1 <= s0) continue;
        if (rng() >= p.ossuary) {
          // no bones here: dressed masonry, or the bare rock
          if (rng() < p.masonry) {
            const mason = { material: 'stone', anchored: true, variation: 0.08, mode: 'replace' };
            if (alongX) prims.push({ shape: 'box', min: [s0, h * 1.01, a[2] - cw - T], max: [s1, OSS, a[2] + cw + T], ...mason });
            else prims.push({ shape: 'box', min: [a[0] - cw - T, h * 1.01, s0], max: [a[0] + cw + T, OSS, s1], ...mason });
          }
          continue;
        }
        ossStretch.push([alongX, alongX ? a[2] : a[0], s0, s1]);
        if (alongX) prims.push({ shape: 'box', min: [s0, h * 1.01, a[2] - cw - T], max: [s1, OSS, a[2] + cw + T], ...bones });
        else prims.push({ shape: 'box', min: [a[0] - cw - T, h * 1.01, s0], max: [a[0] + cw + T, OSS, s1], ...bones });
      }
    }
    // the chambers: bone walls on all four sides (not the coffins inside)
    const e = h * 1.5;
    for (const [x, z] of chambers)
      prims.push(
        { shape: 'box', min: [x - cr - T, h * 1.01, z - cr - T], max: [x - cr + e, OSS + 0.2, z + cr + T], ...bones },
        { shape: 'box', min: [x + cr - e, h * 1.01, z - cr - T], max: [x + cr + T, OSS + 0.2, z + cr + T], ...bones },
        { shape: 'box', min: [x - cr - T, h * 1.01, z - cr - T], max: [x + cr + T, OSS + 0.2, z - cr + e], ...bones },
        { shape: 'box', min: [x - cr - T, h * 1.01, z + cr - e], max: [x + cr + T, OSS + 0.2, z + cr + T], ...bones },
      );
    // a round pillar of bones in a free corner of each chamber (a "tonneau")
    const barrels = [];
    for (const [x, z] of chambers) {
      const r = Math.max(0.3, (cr - cw - 0.35) / 2); // clear of the passages crossing the chamber
      const c = [x - cr + 0.15 + r, z + cr - 0.15 - r];
      barrels.push({ c, r, y0: h, y1: OSS });
      prims.push({ shape: 'cylinder', a: [c[0], h * 1.01, c[1]], b: [c[0], OSS, c[1]], r, material: 'ossuary', anchored: true, variation: 0.06 });
    }
    // engraved stone tablets set into the bone walls (one per stretch, and one in each chamber)
    // (lines separated by |)
    const VERSES = [
      'OSSEMENTS|DU CIMETIÈRE|DES INNOCENTS|DÉPOSÉS EN 1786',
      'MEMENTO HOMO|QUIA PULVIS ES|ET IN PULVEREM|REVERTERIS',
      'ICI REPOSENT|EN ATTENDANT|LA RÉSURRECTION',
      'QUÆRIS QUO|JACEANT IN LOCO|QUÆ NON|NATA JACENT',
      'OSSEMENTS|DU CIMETIÈRE|SAINT-LAURENT|1804',
      'BEATI MORTUI|QUI IN DOMINO|MORIUNTUR',
    ];
    const plaques = [];
    ossStretch.forEach(([alongX, line, s0, s1], k) => {
      if (s1 - s0 < 1.6) return;
      const side = k % 2 ? 1 : -1;
      const mid = (s0 + s1) / 2;
      const p = alongX ? [mid, 0.95, line + side * cw] : [line + side * cw, 0.95, mid];
      const n = alongX ? [0, 0, -side] : [-side, 0, 0];
      // some on a white-washed pedestal standing against the wall
      const ped = k % 3 === 0;
      if (ped) p[1] = 1.25;
      plaques.push({ p, n, w: 0.62, h: 0.42, text: VERSES[k % VERSES.length], pedestal: ped });
    });
    chambers.forEach(([x, z], k) => plaques.push({ p: [x + cr, 1.3, z - cr * 0.7], n: [-1, 0, 0], w: 0.66, h: 0.46, text: VERSES[(k + 3) % VERSES.length], pedestal: true }));
    const inOssuary = (pt) => ossStretch.some(([alongX, line, s0, s1]) => {
      const along = alongX ? pt[0] : pt[2];
      const across = alongX ? pt[2] : pt[0];
      return Math.abs(across - line) < cw + 0.1 && along > s0 - 0.3 && along < s1 + 0.3;
    });
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
        if (inOssuary(alongX ? [a[0] + s, 0, a[2]] : [a[0], 0, a[2] + s])) continue; // the bones are the wall there
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
          { shape: 'box', min: [base[0] - bw / 2 + Math.min(0, out[0]) * bw, 1.4, base[2] - bw / 2 + Math.min(0, out[2]) * bw], max: [base[0] + bw / 2 + Math.max(0, out[0]) * bw, 1.4 + 2 * bw, base[2] + bw / 2 + Math.max(0, out[2]) * bw], material: 'steel', color: [0.12, 0.11, 0.1], anchored: true, hidden: true },
          { shape: 'capsule', a: base, b: tip, r: Math.max(0.025, h * 0.6), material: 'wood', density: 0.6, color: [0.3, 0.2, 0.12], anchored: true, hidden: true },
          { shape: 'sphere', c: tip, r: Math.max(0.06, h * 0.8), material: 'wood', density: 0.9, moisture: 0, color: [0.12, 0.07, 0.04], anchored: true, hidden: true },
        );
        heaters.push({ pos: [tip[0], tip[1] + 0.05, tip[2]], power: 1500, radius: 0.05, height: 0.35, light: true, label: 'torch' });
      }
    }
    // doors between some passages and chambers: wooden, one locked
    const doors = [];
    chambers.forEach(([x, z], k) => {
      for (const side of [-1, 1]) {
        const dz = z + side * (cr + T / 2);
        doors.push({
          shape: 'box', min: [x - cw, h * 0.5, dz - T / 2], max: [x + cw, Math.min(2.1, H - 0.3), dz + T / 2],
          material: 'wood', density: Math.min(1, 0.05 / h), color: [0.33, 0.22, 0.13],
          door: `chamber ${k + 1} ${side < 0 ? 'north' : 'south'}`, doorLocked: k === 0 && side < 0,
        });
      }
    });
    prims.push(...doors);
    return {
      prims,
      heaters,
      spawn: { p: [ex, 0, ez - 0.5], yaw: Math.PI / 2 },
      plaques,
      barrels,
      portals: p.exitTo ? [{ p: [ex, 0, ez - 2.5], r: 1.0, to: p.exitTo, label: 'Stairs: up to the surface', arrive: { p: [ex, 0, ez - 0.5], yaw: Math.PI / 2 } }] : [],
      ignite: { p: [chambers[0][0] - cr + 1, 0.65, chambers[0][1]], radius: 0.4, power: 3000, materials: ['fabric', 'wood'] },
    };
  },
};
