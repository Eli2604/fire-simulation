/**
 * Furnished rooms: the contents of a living room and a bedroom as primitives, laid out in a
 * room's floor box. The house (models/house.js) furnishes its rooms with them, and the living
 * room set is an object of its own (models/livingRoom.js) to put in any building.
 *
 * room: { x0, x1, z0, z1, f } the inside of the walls (x0 < x1, z0 < z1) and the floor top f.
 * The sofa stands against the back wall (z0) at the x0 end, the bookshelf at the x1 wall.
 * Returns { prims, ignite } (ignite: on the sofa's seat, where a dropped cigarette or a
 * candle starts it).
 */
export function livingRoomPrims(room, { h, sofa = [0.3, 0.42, 0.55], carpet = [0.55, 0.2, 0.2], bed = true, books = true } = {}) {
  const t = h;
  const thin = (m) => Math.min(1, Math.max(0.004, m / h));
  const { x0, x1, z0, z1, f } = room;
  const ix = (x1 - x0) / 2;
  const iz = (z1 - z0) / 2;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const prims = [];
  // carpet
  prims.push({ shape: 'box', min: [cx - ix * 0.6, f, cz - iz * 0.6], max: [cx + ix * 0.4, f + t * 0.5, cz + iz * 0.5], material: 'fabric', color: carpet, density: thin(0.01) });
  // sofa against the back wall
  const sx0 = x0 + 0.2;
  const sz0 = z0 + 0.05;
  const up = { material: 'foam', color: sofa };
  prims.push(
    { shape: 'box', min: [sx0, f, sz0], max: [sx0 + 2.0, f + 0.45 - t * 1.01, sz0 + 0.9], ...up },
    { shape: 'box', min: [sx0, f, sz0], max: [sx0 + 2.0, f + 0.9 - t * 1.01, sz0 + 0.25], ...up },
    { shape: 'box', min: [sx0, f, sz0], max: [sx0 + 0.2, f + 0.65 - t * 1.01, sz0 + 0.9], ...up },
    { shape: 'box', min: [sx0 + 1.8, f, sz0], max: [sx0 + 2.0, f + 0.65 - t * 1.01, sz0 + 0.9], ...up },
  );
  const ignite = { p: [sx0 + 1.0, f + 0.5 - t * 1.01, sz0 + 0.5], radius: 0.35, materials: ['foam', 'fabric'], power: 8000 };
  // coffee table
  const tx = sx0 + 1.0;
  const tz = sz0 + 1.6;
  const top = f + 0.4 - t * 1.01;
  prims.push({ shape: 'box', min: [tx - 0.5, top, tz - 0.3], max: [tx + 0.5, top + 0.05, tz + 0.3], material: 'wood' });
  for (const sx of [-0.45, 0.45]) for (const sz of [-0.25, 0.25]) prims.push({ shape: 'box', min: [tx + sx - 0.02, f, tz + sz - 0.02], max: [tx + sx + 0.02, top, tz + sz + 0.02], material: 'wood' });
  // bookshelf with paper (books) on the x1 wall
  if (books) {
    const bx = x1 - 0.35;
    prims.push(
      { shape: 'box', min: [bx, f, cz - iz * 0.3], max: [x1, f + 1.9 - t * 1.01, cz + iz * 0.3], material: 'wood', density: 0.15 },
      { shape: 'box', min: [bx - 0.01, f + 0.3 - t * 1.01, cz - iz * 0.3 + 0.05], max: [x1 - 0.05, f + 1.8 - t * 1.01, cz + iz * 0.3 - 0.05], material: 'paper', color: [0.7, 0.55, 0.4], variation: 0.3 },
    );
  }
  // bed with a mattress in the far corner (a one-room house: its bed is in the living room)
  if (bed) prims.push(...bedPrims(x1, z0, f, t));
  return { prims, ignite };
}

/** A bed (wooden frame, foam mattress) in the corner at (x1, z0) of a floor at f. */
export function bedPrims(x1, z0, f, t) {
  const y = (v) => f + v - t * 1.01;
  return [
    { shape: 'box', min: [x1 - 2.1, f, z0 + 0.05], max: [x1 - 0.5, y(0.3), z0 + 1.5], material: 'wood', density: 0.2 },
    { shape: 'box', min: [x1 - 2.05, y(0.3), z0 + 0.1], max: [x1 - 0.55, y(0.55), z0 + 1.45], material: 'foam', color: [0.9, 0.9, 0.88] },
  ];
}

/** A bedroom: a bed, a wardrobe (wood, clothes in it), a rug. */
export function bedroomPrims(room, { h }) {
  const t = h;
  const thin = (m) => Math.min(1, Math.max(0.004, m / h));
  const { x0, x1, z0, z1, f } = room;
  const cz = (z0 + z1) / 2;
  const prims = [
    ...bedPrims(x1, z0, f, t),
    { shape: 'box', min: [x1 - 2.2, f, z0 + 1.5], max: [x1 - 0.6, f + t * 0.5, z0 + 2.4], material: 'fabric', color: [0.4, 0.45, 0.6], density: thin(0.01) },
    // wardrobe against the x0 wall, clothes inside
    { shape: 'box', min: [x0, f, cz - 0.6], max: [x0 + 0.6, f + 2.0 - t * 1.01, cz + 0.6], material: 'wood', density: 0.15, color: [0.5, 0.36, 0.24] },
    { shape: 'box', min: [x0 + 0.05, f + 0.8, cz - 0.5], max: [x0 + 0.5, f + 1.8 - t * 1.01, cz + 0.5], material: 'fabric', color: [0.5, 0.4, 0.45], variation: 0.3, density: 0.4 },
  ];
  return { prims };
}
