const WALLS = { brick: 'brick', wood: 'wood', concrete: 'concrete' };
const ROOFS = { tiles: 'tiles', 'wood shingles': 'shingles', metal: 'steel' };
const ROOF_THICK = { tiles: 0.024, 'wood shingles': 0.012, metal: 0.0006 };

export default {
  label: 'House',
  params: {
    width: { value: 6, min: 3, max: 14, step: 0.1, label: 'Width X (m)' },
    depth: { value: 5, min: 3, max: 12, step: 0.1, label: 'Depth Z (m)' },
    wallHeight: { value: 2.6, min: 2.2, max: 4, step: 0.1, label: 'Wall height (m)' },
    wallThickness: { value: 0.2, min: 0.05, max: 0.5, step: 0.01, label: 'Wall thickness (m)' },
    wallMaterial: { value: 'brick', options: Object.keys(WALLS), label: 'Walls' },
    roofMaterial: { value: 'tiles', options: Object.keys(ROOFS), label: 'Roof covering' },
    roofPitch: { value: 35, min: 10, max: 55, step: 1, label: 'Roof pitch (°)' },
    windowsPerSide: { value: 2, min: 0, max: 5, step: 1, label: 'Windows per long side' },
    furnished: { value: true, label: 'Furnished' },
    doorOpen: { value: false, label: 'Front door open' },
    chimney: { value: true, label: 'Chimney' },
  },
  build(p, { h }) {
    const t = h;
    const Wd = p.width;
    const Dp = p.depth;
    const wh = p.wallHeight;
    const wt = Math.max(t, p.wallThickness);
    const wall = WALLS[p.wallMaterial];
    // real thicknesses as effective densities (see voxelizer: density)
    const thin = (m) => Math.min(1, Math.max(0.004, m / h));
    const wallD = Math.min(1, p.wallThickness / wt);
    const hx = Wd / 2;
    const hz = Dp / 2;
    const prims = [
      { shape: 'box', min: [-hx, 0, -hz], max: [hx, t, hz], material: 'concrete', density: thin(0.15) },
      { shape: 'box', min: [-hx, t, -hz], max: [hx, wh, hz], material: wall, density: wallD },
      { shape: 'box', min: [-hx + wt, t * 1.01, -hz + wt], max: [hx - wt, wh, hz - wt], mode: 'carve' },
      // ceiling / attic floor (wooden boards)
      { shape: 'box', min: [-hx, wh, -hz], max: [hx, wh + t, hz], material: 'wood', density: thin(0.022) },
    ];
    // roof: wooden rafters/sheathing with a covering on the outside
    const oh = 0.3;
    const pitch = (p.roofPitch * Math.PI) / 180;
    const half = hz + oh;
    const rise = half * Math.tan(pitch);
    const y0 = wh + t - oh * Math.tan(pitch);
    const roofCover = ROOFS[p.roofMaterial];
    prims.push(
      { shape: 'gable', x0: -hx - oh, x1: hx + oh, y0, half, rise, shell: t * 2.2, material: 'wood', density: thin(0.03) },
      { shape: 'gable', x0: -hx - oh, x1: hx + oh, y0, half, rise, shell: t * 1.05, material: roofCover, mode: 'replace', density: thin(ROOF_THICK[p.roofMaterial]) },
      // gable end walls
      { shape: 'gable', x0: -hx, x1: -hx + wt, y0: wh, half: hz, rise: hz * Math.tan(pitch), material: wall === 'brick' ? 'brick' : 'wood', mode: 'fill', density: wallD },
      { shape: 'gable', x0: hx - wt, x1: hx, y0: wh, half: hz, rise: hz * Math.tan(pitch), material: wall === 'brick' ? 'brick' : 'wood', mode: 'fill', density: wallD },
    );
    if (p.chimney) {
      const cx = hx * 0.5;
      prims.push({ shape: 'box', min: [cx - 0.25, wh, hz * 0.2], max: [cx + 0.25, wh + rise + 0.6, hz * 0.2 + 0.5], material: 'brick' });
    }
    // windows: hole through the wall, glass pane in the middle
    const winW = 1.0;
    const winY0 = 0.9;
    const winY1 = 2.0;
    const windowAt = (axis, pos, side) => {
      if (axis === 'z') {
        const zc = side * (hz - wt / 2);
        prims.push(
          { shape: 'box', min: [pos - winW / 2, winY0, zc - wt / 2 - 0.01], max: [pos + winW / 2, winY1, zc + wt / 2 + 0.01], mode: 'carve' },
          { shape: 'box', min: [pos - winW / 2, winY0, zc - t / 2], max: [pos + winW / 2, winY1, zc + t / 2], material: 'glass', density: thin(0.006) },
        );
      } else {
        const xc = side * (hx - wt / 2);
        prims.push(
          { shape: 'box', min: [xc - wt / 2 - 0.01, winY0, pos - winW / 2], max: [xc + wt / 2 + 0.01, winY1, pos + winW / 2], mode: 'carve' },
          { shape: 'box', min: [xc - t / 2, winY0, pos - winW / 2], max: [xc + t / 2, winY1, pos + winW / 2], material: 'glass', density: thin(0.006) },
        );
      }
    };
    const n = p.windowsPerSide;
    const dx = hx * 0.35; // front door position (at +z)
    for (let k = 0; k < n; k++) {
      const x = -hx + (Wd * (k + 1)) / (n + 1);
      windowAt('z', x, -1);
      if (Math.abs(x - dx) > 1.0) windowAt('z', x, 1);
    }
    if (n > 0) {
      windowAt('x', 0, -1);
      windowAt('x', 0, 1);
    }
    const zc = hz - wt / 2;
    prims.push({ shape: 'box', min: [dx - 0.45, t * 1.01, zc - wt / 2 - 0.01], max: [dx + 0.45, 2.05, zc + wt / 2 + 0.01], mode: 'carve' });
    if (!p.doorOpen) prims.push({ shape: 'box', min: [dx - 0.45, t * 1.01, zc - t / 2], max: [dx + 0.45, 2.05, zc + t / 2], material: 'wood', color: [0.45, 0.25, 0.15], density: thin(0.04) });

    let ignite = { p: [0, 1, 0], radius: 0.4, power: 8000 };
    if (p.furnished) {
      const ix = hx - wt;
      const iz = hz - wt;
      const f = t * 1.01; // floor top
      // carpet
      prims.push({ shape: 'box', min: [-ix * 0.6, f, -iz * 0.6], max: [ix * 0.4, f + t * 0.5, iz * 0.5], material: 'fabric', color: [0.55, 0.2, 0.2], density: thin(0.01) });
      // sofa against the back wall
      const sx0 = -ix + 0.2;
      const sz0 = -iz + 0.05;
      const sofa = { material: 'foam', color: [0.3, 0.42, 0.55] };
      prims.push(
        { shape: 'box', min: [sx0, f, sz0], max: [sx0 + 2.0, 0.45, sz0 + 0.9], ...sofa },
        { shape: 'box', min: [sx0, f, sz0], max: [sx0 + 2.0, 0.9, sz0 + 0.25], ...sofa },
        { shape: 'box', min: [sx0, f, sz0], max: [sx0 + 0.2, 0.65, sz0 + 0.9], ...sofa },
        { shape: 'box', min: [sx0 + 1.8, f, sz0], max: [sx0 + 2.0, 0.65, sz0 + 0.9], ...sofa },
      );
      ignite = { p: [sx0 + 1.0, 0.5, sz0 + 0.5], radius: 0.35, materials: ['foam', 'fabric'], power: 8000 };
      // coffee table
      const tx = sx0 + 1.0;
      const tz = sz0 + 1.6;
      prims.push({ shape: 'box', min: [tx - 0.5, 0.4, tz - 0.3], max: [tx + 0.5, 0.45, tz + 0.3], material: 'wood' });
      for (const sx of [-0.45, 0.45]) for (const sz of [-0.25, 0.25]) prims.push({ shape: 'box', min: [tx + sx - 0.02, f, tz + sz - 0.02], max: [tx + sx + 0.02, 0.4, tz + sz + 0.02], material: 'wood' });
      // bookshelf with paper (books) on the right wall
      const bx = ix - 0.35;
      prims.push(
        { shape: 'box', min: [bx, f, -iz * 0.3], max: [ix, 1.9, iz * 0.3], material: 'wood', density: 0.15 },
        { shape: 'box', min: [bx - 0.01, 0.3, -iz * 0.3 + 0.05], max: [ix - 0.05, 1.8, iz * 0.3 - 0.05], material: 'paper', color: [0.7, 0.55, 0.4], variation: 0.3 },
      );
      // bed with mattress in the far corner
      prims.push(
        { shape: 'box', min: [ix - 2.1, f, -iz + 0.05], max: [ix - 0.5, 0.3, -iz + 1.5], material: 'wood', density: 0.2 },
        { shape: 'box', min: [ix - 2.05, 0.3, -iz + 0.1], max: [ix - 0.55, 0.55, -iz + 1.45], material: 'foam', color: [0.9, 0.9, 0.88] },
      );
      // curtains inside the front windows
      for (let k = 0; k < n; k++) {
        const x = -hx + (Wd * (k + 1)) / (n + 1);
        prims.push({ shape: 'box', min: [x - winW / 2 - 0.2, winY0 - 0.2, -iz + t], max: [x - winW / 2 + 0.05, winY1 + 0.25, -iz + t * 1.8], material: 'fabric', color: [0.8, 0.75, 0.55], density: thin(0.003) });
      }
    }
    return { prims, ignite };
  },
};
