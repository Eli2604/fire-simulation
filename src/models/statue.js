import gothic from './data/gothicStatue.js';

/**
 * A stone statue from a photo scan (CC0, Poly Haven: "gothic_statue" by Benny Weimer).
 * Simulated as voxels of sandstone filling its shape (models/data/: the scan's solid
 * shape, as cells): it takes heat and soot, cracks and spalls in a fire, and blasts break
 * pieces off it, the rest falling if nothing holds it up. Its voxels are hidden and
 * render/statue.js draws the scan over them, losing the pieces that are gone.
 */
const SHAPES = {
  gothic: { data: gothic, polyhaven: 'gothic_statue' },
};

export default {
  label: 'Statue (scanned, stone)',
  params: {
    shape: { value: 'gothic', options: Object.keys(SHAPES), label: 'Statue' },
    scale: { value: 0.85, min: 0.3, max: 2, step: 0.05, label: 'Scale' },
  },
  build(p) {
    const S = SHAPES[p.shape] ?? SHAPES.gothic;
    const { cell, origin, dims, bits } = S.data;
    const b = typeof atob === 'function' ? Uint8Array.from(atob(bits), (c) => c.charCodeAt(0)) : Uint8Array.from(Buffer.from(bits, 'base64'));
    const k = p.scale;
    const c = cell * k;
    const prims = [];
    let lowest = Infinity;
    for (let z = 0; z < dims[2]; z++)
      for (let y = 0; y < dims[1]; y++)
        for (let x = 0; x < dims[0]; x++) {
          const i = x + dims[0] * (y + dims[1] * z);
          if (!(b[i >> 3] & (1 << (i & 7)))) continue;
          const x0 = (origin[0] + x * cell) * k;
          const y0 = (origin[1] + y * cell) * k;
          const z0 = (origin[2] + z * cell) * k;
          lowest = Math.min(lowest, y0);
          prims.push({ shape: 'box', min: [x0, y0, z0], max: [x0 + c, y0 + c, z0 + c], material: 'sandstone', color: [0.62, 0.58, 0.5], hidden: true });
        }
    // it stands on its base: the lowest layer rests on the floor (the rest is held by it)
    for (const q of prims) if (q.min[1] < lowest + c * 1.5) q.anchored = true;
    return { prims, props: [{ type: 'statueMesh', polyhaven: S.polyhaven, material: 'sandstone', p: [0, 0, 0], scale: k }] };
  },
};
