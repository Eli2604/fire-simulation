import { campIslandLayout } from './models/campIsland.js';
import { defaultParams } from './models/index.js';

/**
 * The camp island: a place of the carrier's world (scenarios.js), out on its own south-west of the
 * lake house and south of the ship. On its west side a drone camp (models/droneCamp.js) inside a
 * ring of bastions, powered by a solar park (models/solarPark.js) and a wind turbine
 * (models/windTurbine.js) beside it (sim/power.js: no sun and no wind, and its monitors and lights
 * go dark); a soldier squad (models/campPatrol.js) walks a round about the camp, in file. Across
 * the middle a ridge; behind it, on the east side, the landing ground where you are put down
 * ("Deploy here" in the places list, or ?scenario=campIsland&walk=1): out of their sight. A pier
 * with a boat to the island on the east shore.
 */

const H = 0.5; // m voxels (the island's 0.4 for a bigger place: about as many cells)
export const CAMP_ISLAND_TERRAIN = { ...defaultParams('campIsland') };
const T = CAMP_ISLAND_TERRAIN;
/** Where the island's centre is in the zone, and the zone in the world. */
export const CAMP_ISLAND_CENTRE = [48, 38];
// (sea level with the others': origin y + voxel + the terrain's sea level = 2.9 m)
export const CAMP_ISLAND_ORIGIN = [-40, 2.9 - H - T.seaLevel, 170];
const [CX, CZ] = CAMP_ISLAND_CENTRE;
const at = (lx, lz) => [CX + lx, CZ + lz];
/** The camp's centre, the solar park, the turbine (zone x, z), and the camp's power panel. */
export const CAMP_AT = at(-22, 2);
export const SOLAR_AT = at(-14, -21);
export const TURBINE_AT = at(-31, -14);
/** The top of the camp's pad (its voxels' top, zone frame): the patrol walks on it. */
export const PAD_TOP = (Math.floor((H + T.seaLevel + T.pad) / H - 0.5) + 1) * H;
const PANEL = [CAMP_AT[0] - 1.2, CAMP_AT[1] + 3.4]; // (models/droneCamp.js: its power panel)
// the solar park's container: at the west end of its rows (it faces south: its rows run east–west)
const SOLAR = { rows: 3, columns: 7, tilt: 30, azimuth: 180 };
const SOLAR_BOX = [SOLAR_AT[0] - (SOLAR.columns * 1.08) / 2 - 2.2, SOLAR_AT[1]];

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

/** The zone (a place of the world). */
export function campIslandZone() {
  return {
    name: 'Camp island: drone camp, solar park and wind turbine',
    label: 'Camp island: drone camp',
    origin: CAMP_ISLAND_ORIGIN.slice(),
    world: { size: [96, 28, 76], h: H, ground: 'none' },
    view: { camera: [96, 34, 98], walk: true },
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
      { type: 'campPatrol', params: { count: 4, radius: 12.5, corners: 8, unit: 'Kilo' }, x: CAMP_AT[0], z: CAMP_AT[1], y: PAD_TOP - H },
      // pines on the ridge's flanks, a willow by the landing, two crates of kit put down with you
      { type: 'tree', params: { species: 'pine', height: 6.5, crownRadius: 1.7, seed: 31 }, x: CX + 3, z: CZ - 8, y: 'auto' },
      { type: 'tree', params: { species: 'pine', height: 7, crownRadius: 1.8, seed: 32 }, x: CX + 11, z: CZ + 9, y: 'auto' },
      { type: 'tree', params: { species: 'pine', height: 5.5, crownRadius: 1.5, seed: 33 }, x: CX + 13, z: CZ - 15, y: 'auto' },
      { type: 'tree', params: { species: 'oak', height: 6, crownRadius: 2.4, seed: 34 }, x: CX + 30, z: CZ + 12, y: 'auto' },
      { type: 'crate', params: { size: 1.1 }, x: CX + 28.5, z: CZ + 4.5, y: 'auto' },
      { type: 'crate', params: { size: 0.9 }, x: CX + 29.8, z: CZ + 5.2, y: 'auto' },
    ],
  };
}
