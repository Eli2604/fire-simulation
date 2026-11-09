/**
 * An island in the sea: sandy shores, grassy slopes, two hills (rocky tops),
 * a flat plateau for buildings, a canal winding from the hills to the sea,
 * a pond on the hillside, a wooden pier with a boat (back to the ship) and the
 * stone entrance down to the catacombs at the shore.
 *
 * The terrain is a height field. To keep the simulation small only its top
 * layers are voxels (the hills are hollow inside, nobody digs there).
 * Objects can be put on it with `y: 'auto'` (they land on the surface).
 */
export default {
  label: 'Island (hills, canal, pier, catacomb entrance)',
  params: {
    width: { value: 38, min: 16, max: 80, step: 1, label: 'Size along X (m)' },
    depth: { value: 34, min: 16, max: 80, step: 1, label: 'Size along Z (m)' },
    seaLevel: { value: 2.5, min: 0.5, max: 6, step: 0.1, label: 'Sea level (m)' },
    hill: { value: 6, min: 0, max: 12, step: 0.5, label: 'Main hill height (m)' },
    plateau: { value: 1.2, min: 0.4, max: 3, step: 0.1, label: 'Plateau above the sea (m)' },
    canal: { value: true, label: 'Canal from the hills to the sea' },
    pond: { value: true, label: 'Pond on the hillside' },
    catacombs: { value: 'catacombs', label: 'Zone the catacomb stairs lead to' },
    boatTo: { value: 'deck', label: 'Zone the boat takes you to' },
    seed: { value: 5, min: 1, max: 999, step: 1, label: 'Random seed' },
  },
  build(p, { h, rng }) {
    const W = p.width / 2;
    const D = p.depth / 2;
    const sea = p.seaLevel;
    const top0 = sea + p.plateau;
    // plateau (buildings, campfire) in the south-west, hills in the north-east
    const plat = { x0: -W * 0.75, x1: W * 0.1, z0: -D * 0.05, z1: D * 0.7 };
    const hills = [
      { x: W * 0.45, z: -D * 0.4, r: Math.min(W, D) * 0.32, hgt: p.hill },
      { x: -W * 0.35, z: -D * 0.55, r: Math.min(W, D) * 0.22, hgt: p.hill * 0.55 },
    ];
    // the canal: a winding line from below the main hill down to the east shore
    const canalZ = (x) => -D * 0.05 + Math.sin(x * 0.35) * D * 0.08;
    const canalW = 1.4;
    const pondC = { x: W * 0.15, z: -D * 0.55, r: 2.2 };
    let pondBase = null;
    const height = (x, z, noDip = false) => {
      const r = Math.hypot(x / W, z / D);
      const land = Math.min(1, Math.max(0, (0.95 - r) / 0.25));
      let y = sea - 1.6 + land * (p.plateau + 1.6 + 0.3 * Math.sin(x * 0.4) * Math.cos(z * 0.3));
      for (const hl of hills) y += land * hl.hgt * Math.exp(-((x - hl.x) ** 2 + (z - hl.z) ** 2) / (2 * hl.r * hl.r));
      // the plateau is flat
      const inPlat = x > plat.x0 && x < plat.x1 && z > plat.z0 && z < plat.z1;
      if (inPlat) y = top0;
      else {
        const dx = Math.max(plat.x0 - x, 0, x - plat.x1);
        const dz = Math.max(plat.z0 - z, 0, z - plat.z1);
        const d = Math.hypot(dx, dz);
        if (d < 3 && land > 0.5) y = top0 + (y - top0) * (d / 3);
      }
      if (p.canal && x > -W * 0.2) {
        const d = Math.abs(z - canalZ(x));
        if (d < canalW + 1) y = Math.min(y, d < canalW ? sea - 0.8 : sea - 0.8 + (d - canalW) * (y - sea + 0.8));
      }
      // a dip for the pond
      const dp = Math.hypot(x - pondC.x, z - pondC.z);
      if (p.pond && !noDip && dp < pondC.r + 2.5) {
        // a level terrace on the hillside, with the pond dug into it
        const base = pondBase ?? (pondBase = height(pondC.x, pondC.z, true));
        const t = Math.min(1, Math.max(0, (dp - pondC.r - 0.8) / 1.7));
        y = base + (y - base) * t * t * (3 - 2 * t);
        if (dp < pondC.r) y -= 1.2 * Math.min(1, 2 * (1 - dp / pondC.r));
      }
      return y;
    };
    const prims = [];
    const step = h;
    let pondLevel = -Infinity;
    if (p.pond) {
      // the rim's lowest point is where it would spill: fill a bit below that
      pondLevel = height(pondC.x + pondC.r + 0.4, pondC.z) - h * 0.4; // the terrace, a little below its edge
    }
    for (let x = -W; x < W; x += step)
      for (let z = -D; z < D; z += step) {
        const cx = x + step / 2;
        const cz = z + step / 2;
        const y = Math.max(h, height(cx, cz));
        const n = rng() * 0.08;
        const rock = y > sea + p.plateau + p.hill * 0.55;
        const sand = y < sea + 0.45;
        const color = rock ? [0.5 + n, 0.48 + n, 0.45 + n] : sand ? [0.78 + n, 0.7 + n, 0.5] : [0.32 + n, 0.42 + n, 0.2];
        prims.push({ shape: 'box', min: [x, Math.max(0, y - 2.2 * h), z], max: [x + step, y, z + step], material: rock ? 'stone' : 'soil', anchored: true, color, variation: 0.05 });
        if (p.pond && y < pondLevel && Math.hypot(cx - pondC.x, cz - pondC.z) < pondC.r)
          prims.push({ shape: 'box', min: [x, y, z], max: [x + step, pondLevel, z + step], material: 'water' });
      }
    // the pier and a boat on the west shore
    const px = -W * 0.98;
    const pz = D * 0.35;
    const ph = sea + 0.6;
    prims.push(
      { shape: 'box', min: [px, ph - 0.1, pz - 0.8], max: [px + 6, ph, pz + 0.8], material: 'wood', density: 0.3, color: [0.5, 0.38, 0.24] },
      ...[0, 2, 4].flatMap((k) => [
        { shape: 'cylinder', a: [px + k + 0.3, 0, pz - 0.7], b: [px + k + 0.3, ph, pz - 0.7], r: 0.1, material: 'wood' },
        { shape: 'cylinder', a: [px + k + 0.3, 0, pz + 0.7], b: [px + k + 0.3, ph, pz + 0.7], r: 0.1, material: 'wood' },
      ]),
      // the boat alongside
      { shape: 'ellipsoid', c: [px + 1.5, sea, pz + 2.2], r: [2.4, 0.6, 0.9], material: 'wood', density: 0.15, color: [0.7, 0.2, 0.15] },
      { shape: 'ellipsoid', c: [px + 1.5, sea + 0.15, pz + 2.2], r: [2.2, 0.5, 0.75], mode: 'carve' },
    );
    // the catacomb entrance on the north shore: a stone hut over a stair going down
    const ex = -W * 0.05;
    const ez = D * 0.78;
    const ey = height(ex, ez);
    prims.push(
      { shape: 'box', min: [ex - 1.6, ey - 0.4, ez - 1.6], max: [ex + 1.6, ey + 2.6, ez + 1.6], material: 'stone', anchored: true, color: [0.6, 0.58, 0.52] },
      { shape: 'box', min: [ex - 1.6 + 0.35, ey, ez - 1.6 + 0.35], max: [ex + 1.6 - 0.35, ey + 2.3, ez + 1.6 - 0.35], mode: 'carve' },
      { shape: 'box', min: [ex - 0.6, ey, ez - 1.7], max: [ex + 0.6, ey + 2.0, ez - 1.2], mode: 'carve' },
      { shape: 'box', min: [ex - 0.6, ey - 0.4, ez - 0.6], max: [ex + 0.6, ey + 0.01, ez + 1.0], mode: 'carve' },
      // a torch on each side of the door
      { shape: 'capsule', a: [ex - 0.9, ey + 1.4, ez - 1.75], b: [ex - 0.9, ey + 1.8, ez - 1.95], r: 0.03, material: 'wood' },
      { shape: 'capsule', a: [ex + 0.9, ey + 1.4, ez - 1.75], b: [ex + 0.9, ey + 1.8, ez - 1.95], r: 0.03, material: 'wood' },
    );
    const portals = [];
    if (p.catacombs) portals.push({ p: [ex, ey, ez - 0.3], r: 1.0, to: p.catacombs, label: 'Stairs: down into the catacombs', arrive: { p: [ex, ey, ez - 2.6], yaw: -Math.PI / 2 } });
    if (p.boatTo) portals.push({ p: [px + 1.5, ph, pz], r: 1.6, to: p.boatTo, label: 'Boat: back to the ship', arrive: { p: [px + 4, ph, pz], yaw: 0 } });
    return {
      prims,
      sea: { level: sea, box: [0, 0, 0, 0] },
      heaters: [
        { pos: [ex - 0.9, ey + 1.9, ez - 2.0], power: 1500, radius: 0.05, height: 0.35, light: true, label: 'torch' },
        { pos: [ex + 0.9, ey + 1.9, ez - 2.0], power: 1500, radius: 0.05, height: 0.35, light: true, label: 'torch' },
      ],
      portals,
      spawn: { p: [px + 4, ph, pz], yaw: 0 },
    };
  },
};
