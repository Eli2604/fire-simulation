/**
 * A rope or a cable for the soldiers (ai/rope.js): it gives the world a rope (world.ropes) and,
 * if asked, what holds it up.
 *  - fastrope: a rope hanging from a high beam (a gantry: two steel posts and the beam at
 *    `height`), `length` m long (it lies on the ground if longer than the beam is high). The
 *    training stand-in for a helicopter's rope.
 *  - zipline: a cable from a tall pole (its top at `height`) down to a shorter one `span` m along
 *    x, `drop` m lower; ridden from the tall end.
 *  - rappel: an anchor at a roof edge: the rope from the origin (on the edge) down `length` m,
 *    the wall's face along x, the drop on the +z side. With `structure` a rappel tower of its own
 *    (a concrete block `height` high behind the edge, -z), so it works anywhere; without, place
 *    it on a roof's edge (y: the roof's height).
 * Local frame: the origin on the ground (a rappel: at the edge, on the roof), x along the beam or
 * the cable. The rope itself is drawn by render/ropes.js, not voxels (it would be a line of one
 * voxel, and a rope moves).
 */
export default {
  label: 'Rope / zipline (fast rope, rappel, cable)',
  params: {
    kind: { value: 'fastrope', options: ['fastrope', 'zipline', 'rappel'], label: 'Kind (fast rope from a beam, zipline cable, rappel anchor at an edge)' },
    height: { value: 8, min: 2.5, max: 40, step: 0.5, label: 'Height of the beam / the high end / the tower (m)' },
    length: { value: 8, min: 2, max: 45, step: 0.5, label: 'Rope length (fast rope, rappel; m)' },
    span: { value: 30, min: 5, max: 150, step: 1, label: 'Zipline: how far along (m)' },
    drop: { value: 6, min: 0, max: 40, step: 0.5, label: 'Zipline: how much lower the far end is (m)' },
    structure: { value: true, label: 'Build what holds it (the gantry, the poles, a rappel tower)' },
  },
  build(p) {
    const steel = { material: 'steel', color: [0.38, 0.4, 0.42], anchored: true };
    const wood = { material: 'wood', color: [0.42, 0.32, 0.22], anchored: true };
    const prims = [];
    const ropes = [];
    if (p.kind === 'fastrope') {
      const H = p.height;
      if (p.structure)
        prims.push(
          { shape: 'box', min: [-2.1, 0, -0.1], max: [-1.9, H + 0.25, 0.1], ...steel },
          { shape: 'box', min: [1.9, 0, -0.1], max: [2.1, H + 0.25, 0.1], ...steel },
          { shape: 'box', min: [-2.1, H, -0.1], max: [2.1, H + 0.25, 0.1], ...steel },
        );
      ropes.push({ kind: 'fastrope', top: [0, H - 0.02, 0], bottom: [0, Math.max(0, H - p.length), 0] });
    } else if (p.kind === 'zipline') {
      const H = p.height, H2 = Math.max(2.4, H - p.drop), S = p.span;
      if (p.structure)
        prims.push(
          { shape: 'cylinder', a: [0, 0, 0], b: [0, H + 0.3, 0], r: 0.14, ...wood },
          { shape: 'cylinder', a: [S, 0, 0], b: [S, H2 + 0.3, 0], r: 0.12, ...wood },
          // a platform to start from on the tall pole (if it is high)
          ...(H > 3 ? [{ shape: 'box', min: [-1.2, H - 2.3, -0.8], max: [0.2, H - 2.15, 0.8], ...wood }] : []),
        );
      ropes.push({ kind: 'zipline', top: [0, H, 0], bottom: [S, H2, 0] });
    } else {
      const H = p.structure ? p.height : 0;
      if (p.structure) prims.push({ shape: 'box', min: [-1.5, 0, -3], max: [1.5, H, 0], material: 'concrete', color: [0.66, 0.65, 0.62], anchored: true });
      // the anchor: a steel eye on the roof by the edge
      prims.push({ shape: 'box', min: [-0.06, H, -0.35], max: [0.06, H + 0.1, -0.15], ...steel });
      ropes.push({ kind: 'rappel', top: [0, H, 0], bottom: [0, Math.max(H - p.length, -60), 0.08], out: [0, 1] });
    }
    return { prims, ropes };
  },
};
