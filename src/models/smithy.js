/**
 * A smith's workshop, compact: built for fine voxels (~4 cm), so that the sword he forges is a
 * body of voxels several voxels long and wide while the whole room stays quick to simulate. One
 * stone room, 2.9 × 2.6 m:
 *
 *  - the forge in the back corner: a brick hearth with a long fire pot full of forge charcoal
 *    (real burning voxels: materials.js forgeCoal), a notch in its rim where the blade lies in the
 *    fire, a brick hood over it and a chimney up through the roof (the smoke and the hot gas go
 *    up the flue in the air model); the bellows beside it on their stand (drawn: render/
 *    smithy.js) blowing through the tuyere into the bed (sim/smithy.js puts that air into the
 *    air model); a bin of charcoal;
 *  - the anvil (steel voxels) on its oak stump; the slack tub along the back wall: a wooden
 *    trough of real water voxels to quench in; a grindstone by the front wall;
 *  - the shop corner by the east wall: a rack where the finished weapons stand (a new sword
 *    cools there as voxels, then joins the display: drawn), by the open doorway.
 *
 * The blade he works is made of steel voxels at its start (sim/smithy.js): a moving body that
 * goes where his tongs take it (fire, anvil, trough, grindstone, rack) with all its heat.
 *
 * Frame: origin at the middle of the floor, the front (the doorway) at +z. Boxes are given on the
 * voxel cell grid (`B`); points (`at`) are the middles of cells on that grid.
 */
export default {
  label: "Smith's workshop (forge, anvil, slack tub, rack)",
  params: {
    coal: { value: 1, min: 0, max: 1, step: 0.05, label: 'Fire pot filled with charcoal (share)' },
    fireTemp: { value: 900, min: 20, max: 1100, step: 10, label: 'Charcoal glowing at the start (°C)' },
    smith: { value: true, label: 'The smith at work' },
    weapons: { value: 3, min: 0, max: 7, step: 1, label: 'Finished weapons on the rack at the start' },
  },
  build(p, { h }) {
    const s = h / 2; // (local voxel centres sit on multiples of h in x and z: shift the cell grid by half a voxel)
    const m = h * 0.1;
    const P = (x, y, z) => [x - s, y, z - s];
    const prims = [];
    const B = (x0, y0, z0, x1, y1, z1, material, o = {}) =>
      prims.push({ shape: 'box', min: [x0 - s + m, y0 + m, z0 - s + m], max: [x1 - s - m, y1 - m, z1 - s - m], material, ...o });
    const carve = (x0, y0, z0, x1, y1, z1) => B(x0, y0, z0, x1, y1, z1, 'stone', { mode: 'carve' });
    const stone = { color: [0.55, 0.52, 0.48], variation: 0.18, anchored: true };
    const brick = { color: [0.55, 0.28, 0.2], variation: 0.12, anchored: true };
    const oak = { color: [0.42, 0.3, 0.18], variation: 0.1, anchored: true };
    const pine = { color: [0.6, 0.45, 0.28], variation: 0.12, anchored: true };

    // ---- the building: outer x ±1.44, z ±1.32; walls 0.12 m; ceiling at 2.24, the chimney to 2.56
    const X0 = -1.44, X1 = 1.44, Z0 = -1.32, Z1 = 1.32, WT = 0.12, HT = 2.24, TOP = 2.56;
    B(X0, 0, Z0, X1, HT, Z0 + WT, 'stone', stone); // back
    B(X0, 0, Z1 - WT, X1, HT, Z1, 'stone', stone); // front
    B(X0, 0, Z0, X0 + WT, HT, Z1, 'stone', stone); // west
    B(X1 - WT, 0, Z0, X1, HT, Z1, 'stone', stone); // east
    B(X0, HT, Z0, X1, HT + 0.08, Z1, 'wood', pine); // the ceiling: planks
    for (const bz of [-0.6, 0.4]) B(X0 + WT, HT - 0.12, bz, X1 - WT, HT, bz + 0.12, 'oak', oak); // its beams
    // openings: the wide doorway at the front, a window in the west wall
    carve(-0.2, 0, Z1 - WT, 0.52, 2.0, Z1);
    B(-0.28, 2.0, Z1 - WT, 0.6, 2.12, Z1, 'oak', oak); // its lintel
    carve(X0, 1.0, 0.2, X0 + WT, 1.6, 0.68);

    // ---- the forge: brick hearth, a long fire pot, the notch the blade lies in, hood, chimney
    B(-1.32, 0, -1.2, -0.28, 0.72, -0.64, 'brick', brick);
    carve(-1.2, 0.52, -1.04, -0.52, 0.72, -0.8); // the fire pot
    carve(-0.52, 0.64, -0.96, -0.28, 0.72, -0.88); // the notch in its rim (the blade's tang end)
    // the charcoal: a bed three voxels deep, a voxel more along both sides of the blade's groove
    // and a layer banked over it (the blade lies in a tunnel in the glowing bed, as a smith buries
    // the work in the fire)
    const coalTop = 0.52 + Math.round((0.12 * p.coal) / h) * h;
    const coal = { color: [0.08, 0.075, 0.07], variation: 0.25, temp: p.fireTemp, anchored: true };
    if (p.coal > 0) {
      B(-1.2, 0.52, -1.04, -0.52, coalTop, -0.8, 'forgeCoal', coal);
      if (p.coal >= 1) {
        B(-1.2, 0.64, -1.04, -0.52, 0.68, -0.96, 'forgeCoal', coal);
        B(-1.2, 0.64, -0.88, -0.52, 0.68, -0.8, 'forgeCoal', coal);
        B(-1.2, 0.68, -1.04, -0.52, 0.72, -0.8, 'forgeCoal', coal);
      }
    }
    // the hood: an open-bottomed brick box over the hearth, closing in to the flue
    B(-1.32, 1.36, -1.2, -0.28, 1.84, -0.6, 'brick', brick);
    carve(-1.24, 1.36, -1.2, -0.36, 1.76, -0.68);
    // the chimney: a brick stack from the hood up through the ceiling, open at the top
    B(-1.0, 1.76, -1.2, -0.6, TOP, -0.84, 'brick', brick);
    carve(-0.92, 1.72, -1.2, -0.68, TOP, -0.92); // its flue

    // the bellows' stand (the bellows, lever and tuyere are drawn: render/smithy.js)
    B(-1.32, 0, -0.56, -1.0, 0.36, -0.2, 'oak', oak);
    // charcoal bin (wood, charcoal heaped in it)
    B(-1.32, 0, 0.72, -0.96, 0.44, 1.2, 'wood', pine);
    carve(-1.28, 0.04, 0.76, -1.0, 0.44, 1.16);
    B(-1.28, 0.04, 0.76, -1.0, 0.36, 1.16, 'charcoal', { color: [0.08, 0.08, 0.09] });
    // the anvil on its oak stump (waist, then the face)
    prims.push({ shape: 'cylinder', a: P(-0.14, 0, 0.3), b: P(-0.14, 0.48, 0.3), r: 0.14, material: 'oak', ...oak });
    B(-0.28, 0.48, 0.24, 0.0, 0.56, 0.36, 'steel', { color: [0.2, 0.2, 0.22], anchored: true });
    B(-0.36, 0.56, 0.2, 0.08, 0.72, 0.4, 'steel', { color: [0.22, 0.22, 0.24], anchored: true });
    // the slack tub: a wooden trough of water along the back wall
    B(0.0, 0, -1.2, 1.12, 0.48, -0.8, 'wood', { ...oak, color: [0.36, 0.25, 0.15] });
    carve(0.04, 0.04, -1.16, 1.08, 0.48, -0.84);
    B(0.04, 0.04, -1.16, 1.08, 0.4, -0.84, 'water');
    // the grindstone: a sandstone wheel between two posts, by the front wall
    B(0.68, 0, 0.88, 0.72, 0.6, 1.12, 'wood', pine);
    B(1.04, 0, 0.88, 1.08, 0.6, 1.12, 'wood', pine);
    prims.push({ shape: 'cylinder', a: P(0.76, 0.6, 1.0), b: P(1.0, 0.6, 1.0), r: 0.2, material: 'sandstone', color: [0.7, 0.62, 0.48], anchored: true });

    // ---- the shop corner: the rack along the east wall (two rails)
    B(1.24, 0.48, -0.68, 1.32, 0.56, 0.76, 'oak', oak);
    B(1.24, 1.4, -0.68, 1.32, 1.48, 0.76, 'oak', oak);

    // ---- what the smith does (sim/smithy.js): stations and the blade's poses in this frame
    const at = (x, y, z) => P(x, y, z);
    const rackSlots = [];
    for (let k = 0; k < 7; k++) rackSlots.push({ p: at(1.22, 0.56, -0.58 + k * 0.18), mount: 'rack' });
    // a pose of the blade: the middle of its tang-end voxel and the way its point goes (its flat
    // side up unless `up` is given; it widens towards (point × up))
    const pose = (x, y, z, dir, up = [0, 1, 0]) => ({ p: at(x, y, z), dir, up });
    const smithy = {
      coal: p.coal,
      fireTemp: p.fireTemp,
      smith: p.smith,
      weapons: p.weapons,
      fire: at(-0.86, 0.66, -0.92), // the middle of the fire
      // the fire pot (its charcoal: what the smith tops up) and the blade's groove in it
      // (the tuyere comes up into the bed under the blade's outer half: the heart of the fire)
      // (boxes of cells by their first and last cells' middles)
      pot: { min: at(-1.18, 0.54, -1.02), max: at(-0.54, 0.7, -0.82), groove: { min: at(-1.18, 0.66, -0.94), max: at(-0.3, 0.66, -0.9) }, tuyere: at(-1.0, 0.52, -0.92), heart: 0.2 },
      stations: {
        forge: { p: at(-0.48, 0, -0.32), face: at(-0.86, 0, -0.92) },
        bellows: { p: at(-1.16, 0, 0.16), face: at(-1.16, 0, -0.4), lever: at(-1.16, 1.1, -0.1) },
        coal: { p: at(-0.8, 0, 0.94), face: at(-1.24, 0, 0.94) },
        anvil: { p: at(-0.1, 0, 0.82), face: at(-0.1, 0, 0.3), top: at(-0.14, 0.74, 0.3) },
        trough: { p: at(0.66, 0, -0.42), face: at(0.66, 0, -1.0), water: at(0.56, 0.4, -1.0) },
        grinder: { p: at(0.88, 0, 0.5), face: at(0.88, 0, 1.0), wheel: at(0.88, 0.8, 1.0) },
        rack: { p: at(0.8, 0, 0.4), face: at(1.3, 0, 0.4) },
      },
      // where the blade lies (sim/smithy.js bladePose)
      poses: {
        fire: pose(-0.38, 0.66, -0.9, [-1, 0, 0]), // in the groove, its point at the far end of the pot
        temper: pose(-0.38, 0.86, -0.9, [-1, 0, 0]), // over the fire, in the hot gas
        anvil: pose(0.14, 0.74, 0.3, [-1, 0, 0]), // flat on the anvil's face
        water: pose(1.02, 0.3, -0.98, [-1, 0, 0]), // under the water of the slack tub
        grind: pose(1.2, 0.86, 1.0, [-1, 0, 0]), // on the wheel
        rack: pose(1.18, 0.6, 0.66, [0, 1, 0], [-1, 0, 0]), // upright at the end of the rack, point up, cooling
        stock: pose(0.14, 0.74, 0.3, [-1, 0, 0]), // a new blank: on the anvil
      },
      bellowsBox: { p: at(-1.16, 0.36, -0.38) },
      trough: { min: at(0.06, 0.06, -1.14), max: at(1.06, 0.38, -0.86) },
      rackSlots,
    };
    return {
      prims,
      smithies: [smithy],
      spawn: { p: at(0.16, 0, 1.0), yaw: Math.PI },
    };
  },
};
