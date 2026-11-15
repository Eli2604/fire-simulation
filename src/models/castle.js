/**
 * A castle on a hilltop: a curtain wall round a courtyard with a round tower at each corner, a
 * gatehouse in the west wall (its passage through the wall, an iron portcullis that drops in a
 * slot at its outer end and a pair of oak gates behind it: both doors, E opens and shuts them),
 * battlements along the tops of the walls (merlons on the outer edge, a wall-walk behind them,
 * stone stairs up to it in the courtyard), a square keep (three storeys on timber floors, arrow
 * slits, a door to the courtyard), and in the courtyard the wooden buildings that burn: the
 * great hall (timber walls under a shingled roof) along the north wall and the stables (an open
 * timber shed with hay in it) along the south wall; a well. Torches by the gate.
 *
 * Frame: origin at the middle of the courtyard on the ground (put it with y 'auto' on level
 * ground; the walls and towers go `foundation` metres into it, so a little unevenness leaves no gap), the gate
 * to −x. Stone is anchored; the timber, the hay and the roofs are not (they burn and fall).
 */
export default {
  label: 'Castle (curtain wall, towers, gatehouse and portcullis, keep, hall, stables)',
  params: {
    width: { value: 24, min: 14, max: 40, step: 0.5, label: 'Outer width along X (m)' },
    depth: { value: 20, min: 12, max: 36, step: 0.5, label: 'Outer depth along Z (m)' },
    wallHeight: { value: 6, min: 3, max: 12, step: 0.1, label: 'Curtain wall height (m)' },
    wallThickness: { value: 1.2, min: 0.6, max: 3, step: 0.1, label: 'Wall thickness (m)' },
    towerRadius: { value: 2.4, min: 1.5, max: 4, step: 0.1, label: 'Corner tower radius (m)' },
    towerHeight: { value: 9, min: 5, max: 16, step: 0.1, label: 'Corner tower height (m)' },
    gateWidth: { value: 3, min: 2, max: 5, step: 0.1, label: 'Gate passage width (m)' },
    portcullisDown: { value: false, label: 'Portcullis down' },
    gateOpen: { value: true, label: 'Gates open' },
    keep: { value: true, label: 'Keep' },
    keepHeight: { value: 12, min: 6, max: 20, step: 0.5, label: 'Keep height (m)' },
    hall: { value: true, label: 'Great hall (timber)' },
    stables: { value: true, label: 'Stables with hay' },
    roofs: { value: true, label: 'Wooden roofs on the corner towers' },
    foundation: { value: 3, min: 0, max: 8, step: 0.1, label: 'Foundations into the ground (m)' },
  },
  build(p, { h }) {
    const W = p.width / 2;
    const D = p.depth / 2;
    const T = p.wallThickness;
    const Hw = p.wallHeight;
    const base = -p.foundation; // (foundations into the hill)
    const gw = p.gateWidth / 2;
    const gh = 3.4; // the gate passage's height
    const prims = [];
    const stone = { material: 'stone', color: [0.56, 0.54, 0.5], variation: 0.14, anchored: true };
    const dark = { ...stone, color: [0.48, 0.46, 0.42] };
    const oak = { material: 'oak', color: [0.4, 0.28, 0.16], variation: 0.1 };
    const timber = { material: 'wood', color: [0.5, 0.36, 0.22], variation: 0.12 };
    const shingle = { material: 'shingles', color: [0.33, 0.24, 0.17], variation: 0.12 };
    const box = (x0, y0, z0, x1, y1, z1, spec) => prims.push({ shape: 'box', min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)], max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)], ...spec });
    const carve = (x0, y0, z0, x1, y1, z1) => box(x0, y0, z0, x1, y1, z1, { ...stone, mode: 'carve' });
    // merlons along a line on a wall top (a, b: its ends in x-z; at height y; on the outer edge)
    const merlons = (a, b, y) => {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const count = Math.max(1, Math.floor(L / 1.2));
      // (inwards from the outer face: away from it, towards the middle)
      const n = a[1] === b[1] ? [0, -Math.sign(a[1]) || 1] : [-Math.sign(a[0]) || 1, 0];
      for (let k = 0; k < count; k++) {
        const t0 = (k + 0.25) / count;
        const t1 = (k + 0.75) / count;
        const p0 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
        const p1 = [a[0] + (b[0] - a[0]) * t1 + n[0] * 0.45, a[1] + (b[1] - a[1]) * t1 + n[1] * 0.45];
        box(p0[0], y, p0[1], p1[0], y + 1.0, p1[1], stone);
      }
    };
    // ---- the curtain wall
    box(-W, base, -D, W, Hw, -D + T, stone); // north
    box(-W, base, D - T, W, Hw, D, stone); // south
    box(W - T, base, -D, W, Hw, D, stone); // east
    box(-W, base, -D, -W + T, Hw, D, stone); // west
    // battlements: merlons on the outer edge of the wall-walk
    merlons([-W + 2.5, -D], [W - 2.5, -D], Hw);
    merlons([-W + 2.5, D], [W - 2.5, D], Hw);
    merlons([W, -D + 2.5], [W, D - 2.5], Hw);
    merlons([-W, -D + 2.5], [-W, -gw - 3.2], Hw);
    merlons([-W, gw + 3.2], [-W, D - 2.5], Hw);
    // stone stairs up to the wall-walk, along the inside of the south wall (east of the stables)
    const steps = Math.ceil(Hw / 0.3);
    const sx0 = W - T - 2.4 - steps * 0.35;
    for (let k = 0; k < steps; k++) box(sx0 + k * 0.35, base + 2, D - T - 1.2, sx0 + (k + 1) * 0.35, Math.min(Hw, (k + 1) * 0.3), D - T, dark);
    // ---- the corner towers: hollow, a door from the courtyard, merlons round the top
    const R = p.towerRadius;
    const Ht = p.towerHeight;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const cx = sx * W;
      const cz = sz * D;
      prims.push({ shape: 'cylinder', a: [cx, base, cz], b: [cx, Ht, cz], r: R, ...stone });
      prims.push({ shape: 'cylinder', a: [cx, 0, cz], b: [cx, Ht - 0.6, cz], r: R - 0.7, ...stone, mode: 'carve' });
      // its door, on the courtyard side (diagonally in), and a slit
      const dx = -sx * (R - 0.35);
      const dz = -sz * (R - 0.35);
      carve(cx + dx - 0.55, 0, cz + dz - 0.55, cx + dx + 0.55, 2.2, cz + dz + 0.55);
      carve(cx - sx * 0.2, 0, cz - sz * 0.2, cx + dx, 2.2, cz + dz);
      carve(cx + sx * (R - 0.8), 3.2, cz - 0.15, cx + sx * (R + 0.1), 4.4, cz + 0.15);
      if (p.roofs && sx > 0) {
        // the two east towers under conical roofs of shingles on a timber ring (they burn)
        box(cx - R, Ht - 0.3, cz - R, cx + R, Ht, cz + R, timber);
        prims.push({ shape: 'cone', base: [cx, Ht, cz], r: R + 0.4, height: 4.2, ...shingle });
      } else {
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const mx = cx + Math.cos(a) * (R - 0.3);
          const mz = cz + Math.sin(a) * (R - 0.3);
          box(mx - 0.3, Ht, mz - 0.3, mx + 0.3, Ht + 1.0, mz + 0.3, stone);
        }
      }
    }
    // ---- the gatehouse in the west wall: two storeys over the passage, merlons on top
    const gx0 = -W - 1.5;
    const gx1 = -W + T + 1.2;
    const Hg = Hw + 2.5;
    box(gx0, base, -gw - 3, gx1, Hg, gw + 3, stone);
    carve(gx0 - 0.1, 0, -gw, gx1 + 0.1, gh, gw); // the passage
    carve(gx0 + 0.6, gh + 0.4, -gw - 2.4, gx1 - 0.6, Hg - 0.4, gw + 2.4); // the room over it (the winch)
    carve(gx1 - 0.6, gh + 0.4, -0.6, gx1 + 0.1, gh + 2.6, 0.6); // its door onto the wall-walk side
    for (const z of [-gw - 3, gw + 3]) merlons([gx0, z], [gx1, z], Hg);
    merlons([gx0, -gw - 2.6], [gx0, gw + 2.6], Hg);
    // the portcullis: iron bars in a slot at the outer end (a barred door: down, it shuts the way)
    const px = gx0 + 0.6;
    carve(px - 0.2, gh, -gw, px + 0.2, gh + 0.4 + gh, gw); // its slot, up into the gatehouse
    const bars = { material: 'steel', density: Math.min(1, 0.03 / h), color: [0.15, 0.14, 0.13], door: 'portcullis', doorOpen: !p.portcullisDown, doorBars: true, anchored: true };
    for (let k = Math.ceil(-gw / h); k * h < gw; k++) {
      if (Math.abs(k) % 2 === 1) continue; // (every other voxel column a bar)
      const c = k * h;
      box(px - h * 0.45, h * 0.5, c - h * 0.45, px + h * 0.45, gh, c + h * 0.45, bars);
    }
    for (const y of [h * 0.5, gh * 0.5, gh - h]) box(px - h * 0.45, y, -gw, px + h * 0.45, y + h * 0.95, gw, bars);
    // the gates: oak leaves behind the portcullis (open: folded back; shut: across the passage)
    box(gx1 - 0.9, 0, -gw, gx1 - 0.9 + Math.max(h, 0.2), gh - 0.1, gw, { ...oak, door: 'castle gate', doorOpen: p.gateOpen });
    // ---- the keep: north-east of the courtyard, three storeys
    if (p.keep) {
      const k0 = [W - T - 7.5, -D + T];
      const k1 = [W - T, -D + T + 7.5];
      const Hk = p.keepHeight;
      box(k0[0], base, k0[1], k1[0], Hk, k1[1], stone);
      carve(k0[0] + 1, 0, k0[1] + 1, k1[0] - 1, Hk - 0.8, k1[1] - 1);
      for (const y of [Hk / 3, (2 * Hk) / 3]) box(k0[0] + 1, y - 0.25, k0[1] + 1, k1[0] - 1, y, k1[1] - 1, timber); // timber floors
      carve((k0[0] + k1[0]) / 2 - 0.6, 0, k1[1] - 1.1, (k0[0] + k1[0]) / 2 + 0.6, 2.4, k1[1] + 0.1); // the door, to the courtyard
      box((k0[0] + k1[0]) / 2 - 0.6, 0, k1[1] - 1.0, (k0[0] + k1[0]) / 2 + 0.6, 2.3, k1[1] - 1.0 + Math.max(h, 0.15), { ...oak, door: 'keep door', doorOpen: true });
      // arrow slits on every side, each storey
      for (const y of [Hk / 6 + 0.6, Hk / 2 + 0.6, (5 * Hk) / 6]) {
        const mx = (k0[0] + k1[0]) / 2;
        const mz = (k0[1] + k1[1]) / 2;
        carve(mx - 0.15, y, k0[1] - 0.1, mx + 0.15, y + 1.1, k0[1] + 1.1);
        carve(k0[0] - 0.1, y, mz - 0.15, k0[0] + 1.1, y + 1.1, mz + 0.15);
        carve(k1[0] - 1.1, y, mz - 0.15, k1[0] + 0.1, y + 1.1, mz + 0.15);
      }
      merlons([k0[0], k0[1]], [k1[0], k0[1]], Hk);
      merlons([k0[0], k1[1]], [k1[0], k1[1]], Hk);
      merlons([k0[0], k0[1]], [k0[0], k1[1]], Hk);
      merlons([k1[0], k0[1]], [k1[0], k1[1]], Hk);
    }
    // a gable roof (ridge along x) over x0..x1, its eaves at y0 either side of zc
    const gable = (x0, x1, y0, zc, half, rise, spec) =>
      prims.push({
        shape: 'custom',
        bounds: [[x0, y0, zc - half], [x1, y0 + rise, zc + half]],
        test: (x, y, z) => {
          if (x < x0 || x > x1 || y < y0) return false;
          const hw = half - ((y - y0) * half) / rise;
          const az = Math.abs(z - zc);
          return az <= hw && az >= hw - 0.35;
        },
        ...spec,
      });
    // ---- the great hall: timber walls along the north wall, west of the keep, a shingled roof
    if (p.hall) {
      const x0 = -W + T + 4.2;
      const x1 = W - T - 8.3;
      const z0 = -D + T;
      const z1 = -D + T + 5.5;
      if (x1 - x0 > 3) {
        box(x0, 0, z0, x1, 3.2, z1, timber);
        carve(x0 + 0.25, 0, z0 + 0.1, x1 - 0.25, 3.0, z1 - 0.25);
        carve((x0 + x1) / 2 - 0.8, 0, z1 - 0.4, (x0 + x1) / 2 + 0.8, 2.4, z1 + 0.1); // its door
        for (const wx of [x0 + 1.5, x1 - 1.5]) carve(wx - 0.5, 1.2, z1 - 0.4, wx + 0.5, 2.2, z1 + 0.1);
        gable(x0 - 0.3, x1 + 0.3, 3.2, (z0 + z1) / 2, (z1 - z0) / 2 + 0.4, 2.6, shingle);
        // a long table and benches (they burn)
        box(x0 + 1.2, 0, (z0 + z1) / 2 - 0.4, x1 - 1.2, 0.8, (z0 + z1) / 2 + 0.4, oak);
      }
    }
    // ---- the stables: an open timber shed along the south wall, hay in its stalls
    if (p.stables) {
      const x0 = -W + T + 4.2;
      const x1 = x0 + 9;
      const z1 = D - T;
      const z0 = z1 - 4;
      box(x0, 0, z0, x0 + 0.3, 2.8, z1, timber);
      box(x1 - 0.3, 0, z0, x1, 2.8, z1, timber);
      for (let x = x0 + 3; x < x1 - 1; x += 3) box(x - 0.1, 0, z0 + 1.2, x + 0.1, 1.4, z1, timber); // stall boards
      for (let x = x0; x <= x1 + 0.01; x += 3) box(x - 0.12, 0, z0 - 0.12, x + 0.12, 2.8, z0 + 0.12, timber); // posts at the open front
      // a lean-to roof of shingles, falling from the wall to the front
      prims.push({
        shape: 'custom',
        bounds: [[x0 - 0.3, 2.7, z0 - 0.8], [x1 + 0.3, 4.2, z1]],
        test: (x, y, z) => {
          if (x < x0 - 0.3 || x > x1 + 0.3 || z < z0 - 0.8 || z > z1) return false;
          const yr = 2.8 + ((z - (z0 - 0.8)) / (z1 - z0 + 0.8)) * 1.3;
          return y >= yr - 0.3 && y <= yr;
        },
        ...shingle,
      });
      for (let x = x0 + 1.5; x < x1 - 1; x += 3) box(x - 0.9, 0, z1 - 1.4, x + 0.9, 0.9, z1 - 0.2, { material: 'grass', moisture: 0.08, color: [0.72, 0.64, 0.36], variation: 0.15 });
    }
    // ---- a well in the courtyard
    prims.push({ shape: 'cylinder', a: [-1.5, 0, 1.5], b: [-1.5, 0.9, 1.5], r: 0.9, ...dark });
    prims.push({ shape: 'cylinder', a: [-1.5, -1.5, 1.5], b: [-1.5, 0.9, 1.5], r: 0.55, ...stone, mode: 'carve' });
    prims.push({ shape: 'cylinder', a: [-1.5, -1.5, 1.5], b: [-1.5, -0.4, 1.5], r: 0.55, material: 'water' });
    // torches either side of the gate, outside
    const tz = gw + 0.7;
    for (const s of [-1, 1]) prims.push({ shape: 'capsule', a: [gx0 - 0.1, 2.3, s * tz], b: [gx0 - 0.35, 2.7, s * tz], r: 0.04, material: 'wood' });
    return {
      prims,
      heaters: [-1, 1].map((s) => ({ pos: [gx0 - 0.4, 2.85, s * tz], power: 1500, radius: 0.05, height: 0.35, light: true, label: 'torch' })),
    };
  },
};
