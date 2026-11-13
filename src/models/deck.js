/**
 * A raised deck (a lookout): a concrete slab on pillars, a straight staircase up from the
 * ground at one end of its +z side, and glass rails round the deck and along the flight (they
 * stop you, and at ~1 m high you look out over them), open at the head of the stairs.
 *
 * Local frame: the deck's footprint is centred on the origin; the flight runs out from the deck's
 * +z edge at its +x end, its foot `run` metres further out. The steps are a solid flight (a
 * column of voxels per step), each one voxel layer (≈0.2 m) up: the guards' and soldiers' 3D
 * paths (ai/enemies.js path, 0.45 m step-up limit) and the walk-through climb them.
 *
 * It gives the world its lookouts (world.lookouts): points on the deck inside the rails, at the
 * corners and the middles of the open sides, at deck height. A fire team (ai/squad.js) sends a
 * rifleman up to look round before contact, and its gunner up as overwatch on contact.
 */
export default {
  label: 'Raised deck with stairs (a lookout)',
  params: {
    width: { value: 7.2, min: 3, max: 16, step: 0.1, label: 'Width X (m)' },
    depth: { value: 6, min: 3, max: 16, step: 0.1, label: 'Depth Z (m)' },
    height: { value: 3, min: 1, max: 8, step: 0.1, label: 'Deck height (m)' },
    stairWidth: { value: 1.4, min: 1, max: 3, step: 0.1, label: 'Stair width (m)' },
    railHeight: { value: 1.0, min: 0.6, max: 1.4, step: 0.05, label: 'Glass rail height (m)' },
  },
  build(p, { h }) {
    // voxel centres sit at whole multiples of h in x and z (the origin is snapped to one), and
    // half-way between multiples of h in y: put the faces between them
    const sx = (v) => (Math.round(v / h - 0.5) + 0.5) * h;
    const sy = (v) => Math.max(1, Math.round(v / h)) * h;
    const H = sy(p.height);
    const W2 = sx(p.width / 2), D2 = sx(p.depth / 2);
    const t = h; // a rail: one voxel thick
    const slab = Math.max(h, 0.3);
    const concrete = { material: 'concrete', color: [0.64, 0.63, 0.6], variation: 0.04, anchored: true };
    const glass = { material: 'glass', density: Math.min(1, Math.max(0.002, 0.012 / h)), variation: 0.02, anchored: true };
    const railH = p.railHeight;
    const prims = [];
    const box = (x0, y0, z0, x1, y1, z1, m) => prims.push({ shape: 'box', min: [x0, y0, z0], max: [x1, y1, z1], ...m });

    // the slab and its pillars (corners, and every ~3.5 m between them)
    box(-W2, H - slab, -D2, W2, H, D2, concrete);
    const pil = 0.3;
    const along = (a, b) => {
      const n = Math.max(1, Math.ceil((b - a) / 3.5));
      return Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
    };
    for (const x of along(-W2 + pil / 2, W2 - pil / 2))
      for (const z of [-D2 + pil / 2, D2 - pil / 2]) box(sx(x - pil / 2), 0, sx(z - pil / 2), sx(x + pil / 2), H - slab, sx(z + pil / 2), concrete);
    for (const z of along(-D2 + pil / 2, D2 - pil / 2).slice(1, -1))
      for (const x of [-W2 + pil / 2, W2 - pil / 2]) box(sx(x - pil / 2), 0, sx(z - pil / 2), sx(x + pil / 2), H - slab, sx(z + pil / 2), concrete);

    // the stairs: out from the +z edge at the +x end; walkable width sw between two rails (on
    // the flight's edges), one column of voxels per step, rising ~0.6 m per metre
    const sw = Math.max(1, p.stairWidth);
    const sX1 = W2, sX0 = sx(W2 - sw - 2 * t); // the flight, rails included
    const run = Math.max(H / 0.6, (H / h) * 0.25);
    const n = Math.round(run / h); // voxel columns along the flight
    const zTop = D2, zFoot = D2 + n * h;
    for (let c = 0; c < n; c++) {
      const z0 = zTop + c * h, z1 = z0 + h;
      // the height of this column: from the deck down to the ground at the foot
      const y = Math.max(h, Math.round((H * (n - c - 0.5)) / n / h) * h);
      box(sX0, 0, z0, sX1, y, z1, concrete);
      box(sX0, y, z0, sX0 + t, y + railH, z1, glass);
      box(sX1 - t, y, z0, sX1, y + railH, z1, glass);
    }

    // glass rails round the deck (on its outer ring of voxels), open at the head of the stairs
    box(-W2, H, -D2, W2, H + railH, -D2 + t, glass); // -z
    box(-W2, H, -D2, -W2 + t, H + railH, D2, glass); // -x
    box(W2 - t, H, -D2, W2, H + railH, D2, glass); // +x (the flight's outer rail goes on from it)
    box(-W2, H, D2 - t, sX0 + t, H + railH, D2, glass); // +z, up to the flight's inner rail

    // lookouts: inside the rails at the corners and the middles of the open sides (not the side
    // the stairs come up)
    const i = 0.7;
    const lookouts = [
      [-W2 + i, H, -D2 + i], [0, H, -D2 + i], [W2 - i, H, -D2 + i],
      [-W2 + i, H, 0], [W2 - i, H, 0],
      [-W2 + i, H, D2 - i],
    ];
    return {
      prims,
      lookouts,
      // where the stairs start and end (local): for whoever wants to know
      stairs: { foot: [(sX0 + sX1) / 2, 0, zFoot + 0.4], head: [(sX0 + sX1) / 2, H, zTop - 0.4] },
    };
  },
};
