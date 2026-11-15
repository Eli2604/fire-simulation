/**
 * A smith's workshop: a stone building with a timber ceiling, in two rooms.
 *
 *  - The forge room (−x): a brick hearth against the back wall with a charcoal fire in its fire
 *    pot, a brick hood over it and a chimney up through the roof (the smoke and the hot gas go up
 *    the flue); a great bellows beside it on a rocker lever, its nozzle (the tuyere) into the
 *    bottom of the fire; the anvil on its oak stump; the slack tub (a trough of water to quench
 *    in); a grindstone; a bin of charcoal. A wide open doorway at the front and a window let
 *    some outside air in.
 *  - The shop (+x), through a doorway in the partition: a counter, a rack of finished weapons
 *    on the back wall and pegs on the end wall, the shop door (open) and a window at the front.
 *
 * The fire, the smith and the blade he works are not voxels: the forge's fuel bed, the blade
 * (far thinner than the voxels) and the trough's heat are kept on their own (sim/smithy.js),
 * drawn by render/smithy.js. The forge's heat goes into the air as a heater whose power the
 * fire sets; the quench warms the trough's water voxels.
 *
 * Frame: origin at the middle of the floor, the front (doors) at +z. Boxes are given on the
 * voxel cell grid (`B`): the walls come out exactly their thickness in voxels.
 */
export default {
  label: "Smith's workshop (forge, anvil, shop)",
  params: {
    coal: { value: 8, min: 0, max: 30, step: 0.5, label: 'Charcoal in the forge (kg)' },
    fireTemp: { value: 900, min: 20, max: 1400, step: 10, label: 'Fuel bed at the start (°C)' },
    smith: { value: true, label: 'The smith at work' },
    // the smith himself (sim/smithy.js): how briskly he works, how much steel a blow moves
    smithPace: { value: 1, min: 0.5, max: 2, step: 0.05, label: 'Work pace (× his timings and hammer rhythm)', group: 'The smith' },
    smithSkill: { value: 0.5, min: 0, max: 1, step: 0.05, label: 'Skill (how much a blow shapes the blade: fewer heats, 0.5 a journeyman)', group: 'The smith' },
    shopDoorOpen: { value: true, label: 'Shop door open' },
    weapons: { value: 3, min: 0, max: 14, step: 1, label: 'Finished weapons in the shop at the start' },
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
    const oak = { color: [0.42, 0.3, 0.18], variation: 0.1 };
    const pine = { color: [0.6, 0.45, 0.28], variation: 0.12 };

    // ---- the building: outer x ±3.7, z ±2.8; walls 0.2 m; ceiling at 3.0
    const X0 = -3.7, X1 = 3.7, Z0 = -2.8, Z1 = 2.8, WT = 0.2, HT = 3.0;
    B(X0, 0, Z0, X1, HT, Z0 + WT, 'stone', stone); // back
    B(X0, 0, Z1 - WT, X1, HT, Z1, 'stone', stone); // front
    B(X0, 0, Z0, X0 + WT, HT, Z1, 'stone', stone); // west
    B(X1 - WT, 0, Z0, X1, HT, Z1, 'stone', stone); // east
    B(0.9, 0, Z0, 1.1, HT, Z1, 'stone', stone); // partition between the forge and the shop
    // the ceiling: planks on oak beams
    B(X0, HT, Z0, X1, HT + 0.2, Z1, 'wood', { ...pine, anchored: true });
    for (const bz of [-1.6, -0.2, 1.2]) B(X0 + WT, HT - 0.2, bz, X1 - WT, HT, bz + 0.2, 'oak', oak);
    // openings: the forge room's wide doorway, the shop door, windows, the partition doorway
    carve(-1.6, 0, Z1 - WT, -0.4, 2.2, Z1);
    B(-1.7, 2.2, Z1 - WT, -0.3, 2.4, Z1, 'oak', oak); // its lintel
    carve(2.5, 0, Z1 - WT, 3.3, 2.1, Z1);
    B(2.4, 2.1, Z1 - WT, 3.4, 2.3, Z1, 'oak', oak);
    // (the shop door: a wooden door in its opening, open by default)
    B(2.5, 0, Z1 - WT, 3.3, 2.1, Z1 - WT + 0.1, 'wood', { color: [0.45, 0.27, 0.15], door: 'shop door', doorOpen: p.shopDoorOpen });
    carve(1.4, 0.9, Z1 - WT, 2.2, 1.7, Z1); // shop window (shutters open)
    carve(X0, 1.1, 0.4, X0 + WT, 1.8, 1.2); // forge room window, west wall
    carve(0.9, 0, -1.6, 1.1, 2.1, -0.7); // partition doorway, behind the counter

    // ---- the forge: brick hearth, fire pot, hood, chimney
    B(-3.0, 0, -2.6, -1.8, 0.8, -1.7, 'brick', brick);
    carve(-2.6, 0.6, -2.4, -2.2, 0.8, -2.0); // the fire pot (the fuel bed sits in it)
    // the hood: an open-bottomed brick box over the hearth, closing in to the flue
    B(-3.0, 1.5, -2.6, -1.8, 2.2, -1.6, 'brick', brick);
    carve(-2.9, 1.5, -2.6, -1.9, 2.1, -1.7);
    // the chimney: a brick stack from the hood up through the roof
    B(-2.7, 2.1, -2.6, -2.1, 4.3, -2.0, 'brick', brick);
    carve(-2.6, 2.0, -2.5, -2.2, 4.3, -2.1); // its flue (0.4 m square, open at the top)

    // the bellows' stand (the bellows, lever and tuyere are drawn: render/smithy.js)
    B(-3.5, 0, -2.5, -3.1, 0.5, -1.8, 'oak', oak);
    // charcoal bin (wood, charcoal heaped in it)
    B(-3.5, 0, -0.7, -3.0, 0.5, 0.0, 'wood', pine);
    carve(-3.4, 0.1, -0.6, -3.1, 0.5, -0.1);
    B(-3.4, 0.1, -0.6, -3.1, 0.4, -0.1, 'charcoal', { color: [0.08, 0.08, 0.09] });
    // the anvil on its oak stump (waist, then the face)
    // (a step behind the smith at the forge: he turns round from the fire to it)
    prims.push({ shape: 'cylinder', a: P(-2.1, 0, -0.35), b: P(-2.1, 0.5, -0.35), r: 0.2, material: 'oak', ...oak });
    B(-2.3, 0.5, -0.5, -1.9, 0.6, -0.2, 'steel', { color: [0.2, 0.2, 0.22] });
    B(-2.5, 0.6, -0.5, -1.7, 0.8, -0.2, 'steel', { color: [0.22, 0.22, 0.24] });
    // the slack tub: a wooden trough of water by the back wall
    B(-1.4, 0, -2.6, -0.6, 0.6, -2.0, 'wood', { ...oak, color: [0.36, 0.25, 0.15] });
    carve(-1.3, 0.1, -2.5, -0.7, 0.6, -2.1);
    B(-1.3, 0.1, -2.5, -0.7, 0.5, -2.1, 'water');
    // the grindstone: a sandstone wheel on a wooden frame
    B(-0.1, 0, -2.4, 0.0, 0.7, -1.8, 'wood', pine);
    B(0.4, 0, -2.4, 0.5, 0.7, -1.8, 'wood', pine);
    prims.push({ shape: 'cylinder', a: P(0.15, 0.75, -2.1), b: P(0.3, 0.75, -2.1), r: 0.3, material: 'sandstone', color: [0.7, 0.62, 0.48] });
    // a work bench along the back of the forge room (tools, bar stock)
    B(-0.5, 0, -2.6, 0.8, 0.85, -2.5, 'wood', pine);

    // ---- the shop: counter, the rack on the back wall, pegs on the end wall
    B(1.4, 0, -0.6, 3.2, 1.0, -0.2, 'wood', { color: [0.5, 0.33, 0.2], variation: 0.08 });
    B(1.3, 0.5, -2.6, 3.4, 0.6, -2.5, 'oak', oak); // rack: lower rail
    B(1.3, 1.6, -2.6, 3.4, 1.7, -2.5, 'oak', oak); // upper rail
    B(3.4, 1.0, -2.3, 3.5, 1.1, -0.8, 'oak', oak); // pegs board on the end wall

    // ---- what is simulated apart (sim/smithy.js): stations in this frame
    const at = (x, y, z) => P(x, y, z);
    const rackSlots = [];
    for (let k = 0; k < 8; k++) rackSlots.push({ p: at(1.55 + k * 0.25, 0.62, -2.4), mount: 'rack' });
    for (let k = 0; k < 3; k++) rackSlots.push({ p: at(3.38, 1.2 + k * 0.3, -1.55), mount: 'wall' });
    for (let k = 0; k < 3; k++) rackSlots.push({ p: at(1.8 + k * 0.5, 1.02, -0.4), mount: 'counter' });
    const smithy = {
      coal: p.coal,
      fireTemp: p.fireTemp,
      smith: p.smith,
      pace: p.smithPace ?? 1,
      skill: p.smithSkill ?? 0.5,
      weapons: p.weapons,
      fire: at(-2.4, 0.72, -2.2), // the top of the fuel bed
      stations: {
        forge: { p: at(-2.4, 0, -1.25), face: at(-2.4, 0, -2.2) },
        bellows: { p: at(-3.2, 0, -1.2), face: at(-3.2, 0, -2.2), lever: at(-3.25, 1.25, -1.5) },
        coal: { p: at(-2.7, 0, -0.35), face: at(-3.25, 0, -0.35) },
        anvil: { p: at(-2.1, 0, -0.95), face: at(-2.1, 0, -0.35), top: at(-2.1, 0.8, -0.35) },
        trough: { p: at(-1.0, 0, -1.55), face: at(-1.0, 0, -2.3), water: at(-1.0, 0.45, -2.3) },
        grinder: { p: at(0.22, 0, -1.45), face: at(0.22, 0, -2.1), wheel: at(0.22, 0.75, -2.1) },
        door: { p: at(1.0, 0, -1.15) },
        rack: { p: at(2.4, 0, -1.6), face: at(2.4, 0, -2.5) },
      },
      // the way between the rooms (the partition doorway)
      waypoints: { workshop: at(0.3, 0, -1.15), shop: at(1.6, 0, -1.15) },
      bellowsBox: { p: at(-3.3, 0.5, -2.15) },
      trough: { min: P(-1.3, 0.1, -2.5), max: P(-0.7, 0.5, -2.1) },
      rackSlots,
    };
    return {
      prims,
      // the forge fire: its power is set by the fuel bed (sim/smithy.js), from what the bellows give it
      heaters: [{ pos: at(-2.4, 0.72, -2.2), power: 0, radius: 0.18, height: 0.45, flameTemp: 1100, forge: true, label: 'forge fire', smokeYield: 0.002 }],
      smithies: [smithy],
      spawn: { p: at(-1.0, 0, 3.4), yaw: -Math.PI / 2 },
    };
  },
};
