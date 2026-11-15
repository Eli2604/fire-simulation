import { campIslandLayout } from './models/campIsland.js';
import { defaultParams } from './models/index.js';
import { hqCorridorPlace } from './models/militaryBase.js';

/**
 * The camp island: a place of the carrier's world (scenarios.js), out on its own south-west of the
 * lake house and south of the ship: a military base. Its west half is a level pad inside a
 * perimeter of concrete blast walls (models/militaryBase.js), entered by the gate on its east side
 * (a guard post: a sentry booth and a barrier arm, two sentries). From the gate the main road runs
 * west to the drone camp (models/droneCamp.js) inside its ring of bastions, a squad
 * (models/campPatrol.js) walking a round about it, in file. North of the road the headquarters:
 * its door (E) leads into its corridor, a place of its own (the old Hallway with sprinklers
 * scene: the gas pipe in the ceiling bursts after 20 s, the glass-bulb sprinklers go off, an
 * extinguisher and a hose reel by the entrance), built the first time you go in. South of the
 * road the barracks, the helipad with a helicopter parked on it (rotor still: fly it, E) and the
 * vehicle park. Outside the north wall the power yard: the solar park (models/solarPark.js) and
 * the wind turbine (models/windTurbine.js) whose cables feed the camp (sim/power.js: no sun and no
 * wind, and its monitors and lights go dark). Across the middle of the island a ridge; behind it,
 * on the east side, the landing ground where you are put down ("Deploy here" in the places list,
 * or ?scenario=campIsland&walk=1): out of their sight. A pier with a boat to the ship on the
 * east shore.
 *
 *   north (-z)        turbine        solar park                      (power yard)
 *               ┌──── blast wall ──────────────────────┐
 *               │  drone camp         headquarters     │
 *   west (-x)   │  (bastions,         [door]           ║ guard post   ridge   landing  pier
 *               │   the round)  ═══ main road ═════════╬═ gate                ground    (east, +x)
 *               │  barracks     helipad    vehicle park│
 *               │  barracks     (heli)                 │
 *               └──────────────────────────────────────┘
 */

const H = 0.5; // m voxels (the island's 0.4 for a bigger place: about as many cells)
// (the island grown for the base: a wider pad in the west, the ridge and the landing moved east;
// the pad reaching ~8 m east of the gate: an apron outside it where a car can turn along the wall)
export const CAMP_ISLAND_TERRAIN = { ...defaultParams('campIsland'), width: 124, depth: 92, padEast: 0.2, ridgeX: 0.26, landingX: 0.66, boatTo: 'deck', boatLabel: 'Boat: to the ship' };
const T = CAMP_ISLAND_TERRAIN;
/** Where the island's centre is in the zone, and the zone in the world. */
export const CAMP_ISLAND_CENTRE = [64, 48];
// (sea level with the others': origin y + voxel + the terrain's sea level = 2.9 m)
export const CAMP_ISLAND_ORIGIN = [-56, 2.9 - H - T.seaLevel, 160];
const [CX, CZ] = CAMP_ISLAND_CENTRE;
const at = (lx, lz) => [CX + lx, CZ + lz];
/** The camp's centre, the solar park, the turbine (zone x, z), and the camp's power panel. */
export const CAMP_AT = at(-32, -7);
export const SOLAR_AT = at(-8, -31);
export const TURBINE_AT = at(-30, -30);
/** The headquarters (its middle; its door on its south side), the helipad, the gate (zone x, z). */
export const HQ_AT = at(-8, -11.5);
export const HELIPAD_AT = at(-18, 13);
export const GATE_AT = at(4, 0);
/** The place inside the headquarters: its corridor with sprinklers (the old hallwaySprinklers scene). */
export const HQ_PLACE = 'headquarters';
/** The top of the camp's pad (its voxels' top, zone frame): the patrol walks on it. */
export const PAD_TOP = (Math.floor((H + T.seaLevel + T.pad) / H - 0.5) + 1) * H;
const PANEL = [CAMP_AT[0] - 1.2, CAMP_AT[1] + 3.4]; // (models/droneCamp.js: its power panel)
// the solar park's container: at the west end of its rows (it faces south: its rows run east–west)
const SOLAR = { rows: 3, columns: 7, tilt: 30, azimuth: 180 };
const SOLAR_BOX = [SOLAR_AT[0] - (SOLAR.columns * 1.08) / 2 - 2.2, SOLAR_AT[1]];
// on the pad: an object's origin on its top (a numeric y: the voxelizer puts it h + y up)
const ON_PAD = PAD_TOP - H;

/** The landing ground behind the ridge: where you are put down (the terrain's walk-in start). */
export function campDeployPoint() {
  // (as models/campIsland.js puts its spawn: the terrain's origin is a voxel up)
  const L = campIslandLayout(T);
  const ground = H + L.height(L.landing.x, L.landing.z);
  return { p: [CX + L.landing.x, ground + 0.05, CZ + L.landing.z], yaw: Math.PI, ground };
}

/** The archipelago's note of the island's terrain (models/archipelago.js: the sea floor round it). */
export const CAMP_ISLAND_SEA = {
  box: [CAMP_ISLAND_ORIGIN[0] + CX - T.width / 2, CAMP_ISLAND_ORIGIN[2] + CZ - T.depth / 2, CAMP_ISLAND_ORIGIN[0] + CX + T.width / 2, CAMP_ISLAND_ORIGIN[2] + CZ + T.depth / 2],
  floor: -1.6,
};

/**
 * The perimeter: blast walls round the pad (x -46..4, z -24..24, its west corners cut), a gap of
 * 7 m in the east wall for the gate. [x0, z0, x1, z1] (island frame) per run.
 */
export const PERIMETER = [
  [-40, -24, 4, -24],
  [-40, 24, 4, 24],
  [-46, -18, -46, 18],
  [-46, -18, -40, -24],
  [-46, 18, -40, 24],
  [4, -24, 4, -3.5],
  [4, 3.5, 4, 24],
];
const wallRun = ([x0, z0, x1, z1]) => {
  const [x, z] = at((x0 + x1) / 2, (z0 + z1) / 2);
  // (a run along its local x: turned so that x goes from its first end to its last; R_y maps x to (cos, -sin))
  const rotation = Math.round(((Math.atan2(-(z1 - z0), x1 - x0) * 180) / Math.PI + 360) % 360);
  return { type: 'blastWall', params: { length: Math.round(Math.hypot(x1 - x0, z1 - z0) * 100) / 100 }, x, z, y: ON_PAD, rotation };
};
const roadAt = (lx, lz, length, width, o = {}) => {
  const [x, z] = at(lx, lz);
  const { rotation = 0, ...params } = o;
  return { type: 'road', params: { length, width, posts: false, ...params }, x, z, y: ON_PAD, rotation };
};
const onPad = (type, params, [x, z], rotation = 0) => ({ type, params, x, z, y: ON_PAD, rotation });

/** The zone (a place of the world). */
export function campIslandZone() {
  return {
    name: 'Military base island: drone camp, headquarters, barracks and helipad',
    label: 'Military base (camp island)',
    origin: CAMP_ISLAND_ORIGIN.slice(),
    world: { size: [128, 30, 96], h: H, ground: 'none' },
    view: { camera: [120, 44, 120], walk: true },
    proxy: { shape: 'hill', color: '#6b7a45', height: 8, fill: 0.9, sea: 2.9 },
    // a fresh breeze off the sea (the turbine near its rating), a fair sky (the panels)
    weather: { windSpeed: 7, windDir: 20, humidity: 0.6, sunshine: 0.85, vary: 'gentle' },
    // the places list offers to put you down here (main.js: behind the ridge, walking)
    deploy: { label: 'Deploy here: the landing ground behind the ridge' },
    objects: [
      { type: 'campIsland', params: { ...T }, x: CX, z: CZ },
      { type: 'droneCamp', params: { gate: 90 }, x: CAMP_AT[0], z: CAMP_AT[1], y: 'auto' },
      { type: 'solarPark', params: { ...SOLAR, cableX: PANEL[0] - SOLAR_BOX[0], cableZ: PANEL[1] - SOLAR_BOX[1] }, x: SOLAR_AT[0], z: SOLAR_AT[1], y: 'auto' },
      { type: 'windTurbine', params: { cableX: PANEL[0] - TURBINE_AT[0], cableZ: PANEL[1] - TURBINE_AT[1] }, x: TURBINE_AT[0], z: TURBINE_AT[1], y: 'auto' },
      // the squad on its round about the camp, outside the bastions
      // (on the pad: not on the command tent's roof, which is what is under the camp's middle)
      { type: 'campPatrol', params: { count: 4, radius: 12.5, corners: 8, unit: 'Kilo' }, x: CAMP_AT[0], z: CAMP_AT[1], y: ON_PAD },
      // ---- the base round it
      // the headquarters north of the road, its door to the south; inside it the corridor (a place)
      { ...onPad('hqBuilding', { width: 14, depth: 8, doorX: -3, doorTo: HQ_PLACE }, HQ_AT), children: [hqCorridorPlace(HQ_PLACE)] },
      // the perimeter, the gate in its east wall (the booth north of the road), two sentries at it
      ...PERIMETER.map(wallRun),
      onPad('guardPost', { roadWidth: 6, side: '-z' }, GATE_AT),
      // (their round beside the road, by the booth, not in it: the cars would stop for them)
      { type: 'campPatrol', params: { count: 2, radius: 1.8, corners: 4, unit: 'Lima' }, x: GATE_AT[0] - 6.5, z: GATE_AT[1] - 5.4, y: ON_PAD },
      // the roads: the main road from the gate to the camp's gate, a path to the HQ's door, one to
      // the helipad, the vehicle park's hardstanding
      roadAt(-8, 0, 28, 6),
      roadAt(-11, -5.25, 4.5, 2, { rotation: 90, centreLine: false }),
      roadAt(-18, 4.75, 3.5, 3, { rotation: 90, centreLine: false }),
      roadAt(-3, 12, 19, 10, { rotation: 90, centreLine: false, color: '#5b5a52' }),
      // the barracks (south-west), the helipad and its helicopter (parked, rotor still: fly it)
      onPad('barracks', { length: 11, width: 6 }, at(-37, 11)),
      onPad('barracks', { length: 11, width: 6 }, at(-35.5, 19.5)),
      onPad('helipad', { size: 13 }, HELIPAD_AT),
      onPad('helicopter', { side: 'enemy', mission: 'land', start: 'ground', autoStart: false, fromX: 0, fromZ: 0, soldiers: 0, callsign: 'Raven' }, HELIPAD_AT),
      // the vehicle park: a jeep and two trucks nose to the road, fuel drums at the back
      { type: 'car', params: { length: 4.4, width: 1.9, height: 1.9, bodyColor: '#4b5320', fuelLiters: 60 }, x: at(-6.5, 0)[0], z: at(0, 14)[1], y: 'auto', rotation: 90 },
      { type: 'car', params: { length: 5.5, width: 2.2, height: 2, bodyColor: '#3f4a2c', fuelLiters: 80, tankMaterial: 'steel' }, x: at(-3, 0)[0], z: at(0, 14.5)[1], y: 'auto', rotation: 90 },
      { type: 'car', params: { length: 5.5, width: 2.2, height: 2, bodyColor: '#3f4a2c', fuelLiters: 80, tankMaterial: 'steel' }, x: at(0.5, 0)[0], z: at(0, 14.5)[1], y: 'auto', rotation: 90 },
      { type: 'scannedProp', params: { asset: 'drum' }, x: at(1.2, 0)[0], z: at(0, 20.3)[1], y: 'auto' },
      { type: 'scannedProp', params: { asset: 'drum' }, x: at(1.9, 0)[0], z: at(0, 20.4)[1], y: 'auto', rotation: 40 },
      // crates of stores behind the headquarters
      { type: 'crate', params: { size: 1.2 }, x: at(-3.5, 0)[0], z: at(0, -19)[1], y: 'auto' },
      { type: 'crate', params: { size: 1.0 }, x: at(-2.1, 0)[0], z: at(0, -19.4)[1], y: 'auto' },
      { type: 'crate', params: { size: 1.1 }, x: at(-3.0, 0)[0], z: at(0, -20.6)[1], y: 'auto' },
      // pines on the ridge's flanks, an oak by the landing, two crates of kit put down with you
      { type: 'tree', params: { species: 'pine', height: 6.5, crownRadius: 1.7, seed: 31 }, x: CX + 12, z: CZ - 8, y: 'auto' },
      { type: 'tree', params: { species: 'pine', height: 7, crownRadius: 1.8, seed: 32 }, x: CX + 20, z: CZ + 9, y: 'auto' },
      { type: 'tree', params: { species: 'pine', height: 5.5, crownRadius: 1.5, seed: 33 }, x: CX + 22, z: CZ - 15, y: 'auto' },
      { type: 'tree', params: { species: 'oak', height: 6, crownRadius: 2.4, seed: 34 }, x: CX + 44, z: CZ + 12, y: 'auto' },
      { type: 'crate', params: { size: 1.1 }, x: CX + 42.5, z: CZ + 4.5, y: 'auto' },
      { type: 'crate', params: { size: 0.9 }, x: CX + 43.8, z: CZ + 5.2, y: 'auto' },
    ],
  };
}
