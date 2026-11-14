/**
 * The camp island: a height field like the other islands (models/island.js: sandy shores, grassy
 * slopes on soil, a rocky top), laid out for a camp. In the west a level pad for the camp (its
 * solar park and wind turbine beside it); across the middle a ridge running north–south, high
 * enough that nobody at the camp sees over it; in the east, behind the ridge, a grassy landing
 * ground (where you are put down: the walk-in start, `spawn`) and a pier with a boat.
 *
 * Its frame: x east, z south, the origin at the centre of the island. `campIslandLayout(p)`
 * gives the same height function and the places on it (the pad, the ridge, the landing) for
 * the scene and the tests.
 */
export function campIslandLayout(p) {
  const W = p.width / 2;
  const D = p.depth / 2;
  const sea = p.seaLevel;
  const top = sea + p.pad; // the camp's pad
  const ridge = { x: W * p.ridgeX, sx: p.ridgeWidth, sz: D * 0.55, hgt: p.ridge };
  const landing = { x: W * p.landingX, z: D * 0.05 };
  // the pad: the west of the island, inside r < 0.84 of its outline
  const radius = (x, z) => Math.hypot(x / W, z / D);
  const inPad = (x, z) => x < W * p.padEast && radius(x, z) < 0.84;
  const height = (x, z) => {
    const r = radius(x, z);
    const land = Math.min(1, Math.max(0, (0.97 - r) / 0.2));
    // rolling ground a little over the sea, the ridge across the middle (a long low saddle at
    // its ends: it reaches round the north and the south of the landing)
    let y = sea - 1.6 + land * (p.ground + 1.6 + 0.25 * Math.sin(x * 0.37) * Math.cos(z * 0.29));
    const along = Math.exp(-(z * z) / (2 * ridge.sz * ridge.sz));
    y += land * ridge.hgt * Math.exp(-((x - ridge.x) ** 2) / (2 * ridge.sx * ridge.sx)) * (0.25 + 0.75 * along);
    // a rocky knoll on the ridge's crest
    y += land * ridge.hgt * 0.25 * Math.exp(-((x - ridge.x) ** 2 + (z + D * 0.12) ** 2) / (2 * 3.5 * 3.5));
    // the pad is level; it eases into the ground round it over 4 m
    if (land > 0.3) {
      if (inPad(x, z)) y = top;
      else {
        const dx = Math.max(0, x - W * p.padEast);
        const dr = Math.max(0, radius(x, z) - 0.84) * Math.min(W, D);
        const d = Math.max(dx, dr);
        if (d < 4) y = top + (y - top) * (d / 4) * (d / 4) * (3 - 2 * (d / 4));
      }
    }
    return y;
  };
  return { W, D, sea, top, ridge, landing, height, inPad, radius };
}

export default {
  label: 'Camp island (camp pad, ridge, landing ground, pier)',
  params: {
    width: { value: 92, min: 40, max: 120, step: 1, label: 'Size along X (m)' },
    depth: { value: 72, min: 30, max: 120, step: 1, label: 'Size along Z (m)' },
    seaLevel: { value: 2.5, min: 0.5, max: 6, step: 0.1, label: 'Sea level (m)' },
    ground: { value: 1.0, min: 0.3, max: 3, step: 0.1, label: 'Ground above the sea (m)' },
    pad: { value: 1.4, min: 0.4, max: 4, step: 0.1, label: 'Camp pad above the sea (m)' },
    padEast: { value: -0.1, min: -0.6, max: 0.2, step: 0.02, label: 'Camp pad reaches east to (share of half width)' },
    ridge: { value: 11, min: 3, max: 20, step: 0.5, label: 'Ridge height (m)' },
    ridgeX: { value: 0.16, min: -0.3, max: 0.5, step: 0.02, label: 'Ridge at X (share of half width)' },
    ridgeWidth: { value: 5, min: 2, max: 12, step: 0.5, label: 'Ridge width (m, its slopes)' },
    landingX: { value: 0.58, min: 0.3, max: 0.8, step: 0.02, label: 'Landing ground at X (share of half width)' },
    pierLength: { value: 7, min: 3, max: 12, step: 0.5, label: 'Pier length (m)' },
    boatTo: { value: 'island', label: 'Zone the boat takes you to' },
    boatLabel: { value: 'Boat: to the island', label: 'What the boat is (its hint)' },
    seed: { value: 21, min: 1, max: 999, step: 1, label: 'Random seed' },
  },
  build(p, { h, rng }) {
    const L = campIslandLayout(p);
    const { W, D, sea, height } = L;
    const prims = [];
    const step = h;
    const rockAt = sea + p.ground + p.ridge * 0.62;
    for (let x = -W; x < W; x += step)
      for (let z = -D; z < D; z += step) {
        const cx = x + step / 2;
        const cz = z + step / 2;
        const y = Math.max(h, height(cx, cz));
        const n = rng() * 0.08;
        const rock = y > rockAt;
        const sand = y < sea + 0.45;
        const pad = L.inPad(cx, cz) && Math.abs(y - L.top) < 0.01;
        // the pad: trodden, gravelled soil; the slopes grass on soil; the shore sand; the crest rock
        const color = rock ? [0.38 + n, 0.36 + n, 0.32 + n] : sand ? [0.78 + n, 0.7 + n, 0.5] : pad ? [0.47 + n, 0.42 + n, 0.33 + n] : [0.33 + n, 0.43 + n, 0.21];
        const sward = !rock && !sand && !pad;
        const nb = Math.min(height(cx - step, cz), height(cx + step, cz), height(cx, cz - step), height(cx, cz + step));
        const bottom = Math.max(0, Math.min(y - Math.max(2.2 * h, 0.6), nb - h));
        prims.push({ shape: 'box', min: [x, bottom, z], max: [x + step, sward ? y - h : y, z + step], material: rock ? 'hillRock' : sand ? 'beachSand' : pad ? 'quarrySand' : 'soil', anchored: true, color: sward ? [0.3, 0.24, 0.16] : color, variation: 0.05 });
        if (sward) prims.push({ shape: 'box', min: [x, y - h, z], max: [x + step, y, z + step], material: 'grass', moisture: 0.25, color, variation: 0.04, anchored: true });
      }
    // the pier on the east shore, below the landing ground, a boat alongside
    const pz = D * 0.3;
    const px1 = W - 0.5; // its end, out over the water
    const px0 = px1 - p.pierLength;
    const ph = sea + 0.6;
    prims.push(
      { shape: 'box', min: [px0, ph - 0.1, pz - 0.8], max: [px1, ph, pz + 0.8], material: 'wood', density: 0.3, color: [0.5, 0.38, 0.24] },
      ...Array.from({ length: Math.ceil(p.pierLength / 2) }, (_, k) => px0 + 0.5 + k * 2).map((x) => [
        { shape: 'cylinder', a: [x, 0, pz - 0.7], b: [x, ph, pz - 0.7], r: 0.1, material: 'wood' },
        { shape: 'cylinder', a: [x, 0, pz + 0.7], b: [x, ph, pz + 0.7], r: 0.1, material: 'wood' },
      ]).flat(),
      { shape: 'ellipsoid', c: [px1 - 1.8, sea, pz + 2.2], r: [2.4, 0.6, 0.9], material: 'wood', density: 0.15, color: [0.32, 0.36, 0.26] },
      { shape: 'ellipsoid', c: [px1 - 1.8, sea + 0.15, pz + 2.2], r: [2.2, 0.5, 0.75], mode: 'carve' },
    );
    const portals = [];
    if (p.boatTo) portals.push({ p: [px1 - 1.8, ph, pz], r: 1.6, to: p.boatTo, label: p.boatLabel, arrive: { p: [px0 + 1, ph, pz], yaw: Math.PI } });
    // where you are put down: the landing ground behind the ridge, facing it (west)
    const lx = L.landing.x;
    const lz = L.landing.z;
    return {
      prims,
      sea: { level: sea, box: [0, 0, 0, 0] },
      portals,
      spawn: { p: [lx, height(lx, lz) + 0.05, lz], yaw: Math.PI },
    };
  },
};
