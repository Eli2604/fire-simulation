import { defaultWeather } from './sim/weather.js';
import { CORE, CORE_ISLAND, SEA_Y, VILLAGE, SMITHY, FOREST, CASTLE, CASTLE_HILL } from './models/fantasyIsland.js';
import { smithyScene } from './smithyPlace.js';

/**
 * The Fantasy world (scenarios.js `fantasy`): the dragon isle in a sea of its own, a world of
 * places (models/fantasyIsland.js: one land, its height function shared by the places' voxels
 * and the drawn ground round them).
 *
 *   ┌─ x → (east)                                       north coast hills
 *   │  ┌──────────────┐
 *   z  │ island:      │   basin                        ┌──────────┐
 *   ↓  │ waterfall,   │                                │  castle  │ (on its hill)
 *      │ church,      │  ┌smithy┐                      └──────────┘
 *      │ volcano      │  └──────┘                        ┌────────┐
 *      └──────────────┘ ┌────────────┐  ── road ──       │ forest │ (in the valley)
 *       (catacombs     │  village    │                   └────────┘
 *        under the     │ (harbour)   │               the ridge along the south coast
 *        church)       └────────────┘
 *
 * Arrive at the harbour village's landing stage; signposts at the roads' ends take you along
 * them (E), the boats round the coast to the old island's pier and back.
 */
const w = (o = {}) => ({ ...defaultWeather(), ...o });
/** The village, the smithy, the castle and the forest: neighbours (the camera close to one makes it the one that runs). */
export const ISLE_GROUP = 'isle';
const local = (P, x, z) => [x - P.origin[0], z - P.origin[2]];
/** The ground of a place: its window of the land (models/fantasyIsland.js fantasyLand). */
const landOf = (P, params = {}) => ({
  type: 'fantasyLand',
  params: { wx: P.origin[0] + P.h / 2, wy: P.origin[1] + P.h, wz: P.origin[2] + P.h / 2, width: P.size[0], depth: P.size[2], ...params },
  x: P.h / 2,
  z: P.h / 2,
});
const sign = (P, [x, z], to, label, [ax, az] = [1.5, 0], yaw = 0) => {
  const [lx, lz] = local(P, x, z);
  return { type: 'signpost', params: { to, label, arriveX: ax, arriveZ: az, arriveYaw: yaw }, x: lx, z: lz, y: 'auto' };
};
const at = (P, x, z, o) => {
  const [lx, lz] = local(P, x, z);
  return { ...o, x: lx, z: lz, y: o.y ?? 'auto' };
};

/** The old Forest fire in fog: its fog, its stand of conifers, the fire lit in its woodpile (its frame: 16 × 12 m). */
export const FOGGY_FOREST_WEATHER = { fog: 0.8, humidity: 0.9, ambient: 8, windSpeed: 0.5 };
export function foggyForestObjects() {
  return [
    { type: 'grass', params: { width: 15, depth: 11, height: 0.2, density: 0.5, moisture: 0.2 }, x: 8, z: 6 },
    ...[
      [3, 3], [6, 4.5], [9, 3.2], [12, 4], [4.5, 7.5], [8, 8], [11.5, 8.5], [13.5, 6.5],
    ].map(([x, z], k) => ({ type: 'tree', params: { species: 'pine', height: 5 + (k % 3), crownRadius: 1.2, foliageMoisture: 0.7, seed: k + 1 }, x, z })),
    { type: 'woodPile', params: { arrangement: 'teepee', logs: 6, logLength: 1, logRadius: 0.07, stones: false }, x: 5, z: 6, ignite: true },
  ];
}

/** The catacombs under the church (the old Catacombs scene). exitTo: the place their stairs lead up to. */
export function catacombObjects(exitTo = '') {
  return [
    { type: 'catacombs', params: { exitTo }, x: 12, z: 17 },
    // guards on their rounds through the passages, the chambers and their doors
    { type: 'enemy', params: { count: 2, spread: 0.5, patrol: 'route', patrolWidth: 10, patrolDepth: 10 }, x: 7, z: 12 },
    // (its first guard is the jailer: he carries the key of the dungeon cell)
    { type: 'enemy', params: { count: 2, spread: 0.5, seed: 2, patrol: 'route', patrolWidth: 10, patrolDepth: 10, key: true }, x: 17, z: 22 },
    { type: 'enemy', params: { count: 1, spread: 0.3, seed: 5, patrol: 'area', patrolWidth: 14, patrolDepth: 14 }, x: 12, z: 17 },
    // an underground church off the east passage: benches, an altar under a cross, and on it the
    // candles (a paraffin and a beeswax one, as in the old Candles scene, and two more), tall
    // candles on stands either side
    { type: 'cryptChapel', params: {}, x: 30, z: 17 },
    // a scanned stone statue by the wall in front of the dais, facing the aisle: it scorches,
    // cracks and breaks (models/statue.js)
    { type: 'statue', params: { shape: 'gothic', scale: 0.85 }, x: 27.4, z: 21.1, rotation: 90 },
    // brass candelabra at the back of the altar, their candles burning (models/candelabra.js)
    { type: 'candelabra', params: { scale: 0.8 }, x: 30, z: 23.2, y: 1.4, rotation: 180 },
    // a brass vase on the altar, the celebrant's gothic chair in the apse (models/scannedProp.js)
    { type: 'scannedProp', params: { asset: 'vase', scale: 0.8 }, x: 30.8, z: 23.0, y: 1.4 },
    { type: 'scannedProp', params: { asset: 'throne', scale: 0.85 }, x: 28.6, z: 24.4, y: 0, rotation: 150 },
    { type: 'candle', params: { height: 0.12, radius: 0.022 }, x: 29.35, z: 23.0, y: 1.4, ignite: true },
    { type: 'candle', params: { height: 0.09, radius: 0.028, wax: 'beeswax', color: '#e0b04a' }, x: 29.75, z: 23.1, y: 1.4, ignite: true },
    { type: 'candle', params: { height: 0.2, radius: 0.025, wax: 'beeswax', color: '#e8c060' }, x: 30.25, z: 23.1, y: 1.4, ignite: true },
    { type: 'candle', params: { height: 0.15, radius: 0.022 }, x: 30.65, z: 23.0, y: 1.4, ignite: true },
    { type: 'candle', params: { height: 0.4, radius: 0.04, holder: false }, x: 28.3, z: 22.8, y: 1.0, ignite: true },
    { type: 'candle', params: { height: 0.4, radius: 0.04, holder: false }, x: 31.7, z: 22.8, y: 1.0, ignite: true },
  ];
}

/** The church on the old island (zone frame: its crypt is the catacombs). */
export const CHURCH_AT = [24.1, 42.2];

/** The old dragon island: its zone (dragons, church, volcano, waterfall, mill, the house and its guards). */
function islandPlace() {
  return {
    name: 'Dragon island: church, volcano and waterfall',
    label: 'Dragon island: church, volcano & waterfall',
    origin: CORE.origin.slice(),
    world: { size: CORE.size.slice(), h: CORE.h, ground: 'none' },
    // a morning sun from the south-east: through the south windows of the nave its light falls on the rosette in the crossing
    // (the sky's clock of the world's weather puts it there; view.sun is it without one)
    view: { camera: [71.4, 30, 78.6], walk: true, sun: [0.544, 0.64, 0.544] },
    proxy: { shape: 'hill', color: '#5f7a3a', height: 7, fill: 0.95, sea: 2.9 },
    objects: [
      // (on the far side from the volcano, in the west: a waterfall off a rocky height with a walkway behind it, a river from its pool to the sea;
      // in the east its ground runs on into the rest of the isle: models/fantasyIsland.js)
      { type: 'island', params: { ...CORE_ISLAND }, x: CORE.centre[0], z: CORE.centre[1] },
      // a water mill on the river, its wheel turned by the water running down from the fall to the sea
      { type: 'mill', params: { axleHeight: 0.4 }, x: 15.34, z: 26.94, y: 4.0, rotation: -167.3 },
      // a gothic church being built on the plateau: tower and south arm still in scaffolding
      { type: 'church', params: { crypt: 'catacombs' }, x: CHURCH_AT[0], z: CHURCH_AT[1], y: 'auto' },
      { type: 'house', params: { width: 5, depth: 4 }, x: 49.3, z: 47, y: 'auto' },
      { type: 'grass', params: { width: 3.4, depth: 3, height: 0.3, density: 0.8, moisture: 0.1, clearRadius: 0.9 }, x: 52, z: 38.1, y: 'auto' },
      { type: 'woodPile', params: { arrangement: 'teepee', logs: 6, logLength: 1.8, logRadius: 0.12, moisture: 0.1, stones: false }, x: 52, z: 38.1, y: 'auto', ignite: true },
      { type: 'tree', params: { species: 'oak', height: 6, crownRadius: 2.4 }, x: 40, z: 14, y: 'auto' },
      // a volcano on the main hill: asleep until the dragon crawls over it
      { type: 'volcano', params: { radius: 4.5, height: 5.5 }, x: 48.5, z: 19.4, y: 'auto' },
      { type: 'tree', params: { species: 'pine', height: 6.5, crownRadius: 1.8, seed: 3 }, x: 56.1, z: 14, y: 'auto' },
      { type: 'tree', params: { species: 'willow', height: 5, crownRadius: 2, seed: 2 }, x: 40.8, z: 27.6, y: 'auto' },
      { type: 'tree', params: { species: 'pine', height: 5, crownRadius: 1.5, seed: 7 }, x: 23, z: 14.9, y: 'auto' },
      { type: 'tree', params: { species: 'oak', height: 7, crownRadius: 2.8, seed: 11 }, x: 58, z: 41, y: 'auto' },
      { type: 'tree', params: { species: 'pine', height: 7.5, crownRadius: 1.9, seed: 12 }, x: 15, z: 20.4, y: 'auto' }, // (on the river's north bank)
      { type: 'tree', params: { species: 'pine', height: 6, crownRadius: 1.6, seed: 13 }, x: 29, z: 9.5, y: 'auto' },
      { type: 'tree', params: { species: 'willow', height: 5.5, crownRadius: 2.2, seed: 14 }, x: 42.5, z: 56, y: 'auto' },
      { type: 'tree', params: { species: 'oak', height: 5.5, crownRadius: 2.2, seed: 15 }, x: 8.5, z: 31, y: 'auto' },
      // round the house: a car (fuel in its tank), a propane bottle at the wall, a garden fence, a log stack
      { type: 'car', params: { bodyColor: '#7a2b25' }, x: 43.6, z: 44.5, y: 'auto', rotation: 90 },
      { type: 'gasCylinder', params: { capacity: 11, fill: 0.7 }, x: 52.6, z: 46.2, y: 'auto' },
      { type: 'fence', params: { length: 8, style: 'rails' }, x: 49.3, z: 42.4, y: 'auto' },
      { type: 'woodPile', params: { arrangement: 'stack', logs: 12, logLength: 1.2, logRadius: 0.1, stones: false, kindling: false }, x: 46, z: 50.2, y: 'auto' },
      { type: 'enemy', params: { count: 2, spread: 1, patrol: 'area', patrolWidth: 12, patrolDepth: 12 }, x: 46.8, z: 42, y: 'auto' },
      // a dragon: it rests on the terrace on the hillside, crawls up to the hilltop, over to the
      // church and up its walls, over the roof, down to its north arm where it smells the catacombs under it, and flies back
      { type: 'dragon', params: { route: '30.6,20.8 rest; 51,21.6 climb; 24.1,42.2 climb; 24.2,33.4 sniff; 30.6,20.8 fly rest' }, x: 30.6, z: 20.8, rotation: 0 }, // (lying north-south: east-west its tail lay in the waterfall's stream and hung over the lip)
      // a second, younger dragon (koi scales) in the west: now and then it flies out and picks a fight with the first, in the air over the island (ai/dragonAir.js)
      { type: 'dragon', params: { length: 8, colours: 'koi', route: '12,44 rest; 34,32 fly fight; 12,44 fly rest', seed: 2 }, x: 12, z: 44, rotation: 30 },
      // the road east out of it, to the harbour village (models/fantasyIsland.js ROADS)
      sign(CORE, [66.5, 55.2], 'village', 'Road: east to the harbour village', [-1.8, 0], 180),
    ],
  };
}

/** The harbour village on the south coast: where you arrive (its landing stage), the square, the roads out. */
function villagePlace() {
  const P = VILLAGE;
  const house = (x, z, params, rotation = 0) => at(P, x, z, { type: 'house', params, rotation });
  return {
    name: 'Harbour village',
    label: 'Harbour village (landing stage)',
    group: ISLE_GROUP,
    origin: P.origin.slice(),
    world: { size: P.size.slice(), h: P.h, ground: 'none' },
    view: { camera: [16, 12, 40], walk: true },
    proxy: { color: '#7d8a55', height: 4, fill: 0.7, sea: SEA_Y - P.origin[1] },
    objects: [
      landOf(P),
      // the landing stage out into the bay, a boat round the coast to the dragon island's pier
      { type: 'landingStage', params: { length: 9, sea: SEA_Y - P.origin[1] - P.h, boatTo: 'island', boatLabel: 'Boat: round the coast to the dragon island' }, x: local(P, 86, 0)[0], z: local(P, 0, 66)[1], y: 0 },
      // houses round the square, either side of the road
      house(75, 51.5, { width: 5, depth: 4, wallMaterial: 'wood', roofMaterial: 'wood shingles' }),
      house(91, 51, { width: 6, depth: 5 }),
      house(77, 62.5, { width: 5, depth: 4, wallMaterial: 'wood', roofMaterial: 'wood shingles' }, 90),
      house(93, 64, { width: 5.5, depth: 4.5, roofMaterial: 'wood shingles' }),
      // firewood, a hay pile, barrels at the landing, trees on the square
      at(P, 85, 52, { type: 'woodPile', params: { arrangement: 'stack', logs: 12, logLength: 1.2, logRadius: 0.1, stones: false, kindling: false }, rotation: 90 }),
      at(P, 97, 51, { type: 'grass', params: { width: 2.2, depth: 1.6, height: 0.9, density: 0.9, moisture: 0.1, clearRadius: 0 } }),
      at(P, 84.6, 65.2, { type: 'scannedProp', params: { asset: 'drum' } }),
      at(P, 85.3, 65.6, { type: 'scannedProp', params: { asset: 'drum' }, rotation: 40 }),
      at(P, 72.5, 64, { type: 'tree', params: { species: 'oak', height: 6.5, crownRadius: 2.6, seed: 21 } }),
      at(P, 99, 54, { type: 'tree', params: { species: 'willow', height: 5.5, crownRadius: 2.2, seed: 22 } }),
      // the roads out: west to the dragon island, north to the smithy, east up to the castle and along the valley to the forest
      sign(P, [71.2, 56.4], 'island', 'Road: west to the dragon island (church, volcano)', [1.6, 0]),
      sign(P, [80.6, 49.2], 'smithy', 'Smithy: go in', [0, 1.6]),
      sign(P, [99.5, 57.2], 'castle', 'Road: up to the castle', [-1.6, 0], 180),
      sign(P, [99.5, 62.5], 'forest', 'Path: along the valley to the forest', [-1.6, 0], 180),
    ],
  };
}

/** The smithy off the village square (the smithy scene: src/smithyPlace.js). */
function smithyPlace() {
  const P = SMITHY;
  const sc = smithyScene();
  return {
    name: 'Smithy: forging a blade',
    label: 'Smithy',
    group: ISLE_GROUP,
    origin: P.origin.slice(),
    world: { ...sc.world }, // (its own ground layer, as the scene's: the square's level ground)
    exposure: sc.exposure,
    weather: sc.weather,
    timeScale: sc.timeScale,
    view: { ...sc.view },
    proxy: { color: '#8a7d6a', height: 3.4, fill: 0.9, sea: 0 },
    objects: [
      // the square round it (level: nothing over its ground layer) and the sea's level, for the ground drawn round it
      landOf(P, { grass: false }),
      ...sc.objects,
      // out of the front, west of the forge's doorway: back to the square
      { type: 'signpost', params: { to: 'village', label: 'Out to the village square', arriveX: 1.6, arriveZ: 0, arriveYaw: 0 }, x: 0.5, z: 6.5 },
    ],
  };
}

/** The forest in the valley between the castle hill and the ridge on the south coast (the old Forest fire in fog). */
function forestPlace() {
  const P = FOREST;
  return {
    name: 'Forest fire in fog',
    label: 'Forest in the fog valley',
    group: ISLE_GROUP,
    origin: P.origin.slice(),
    world: { size: P.size.slice(), h: P.h }, // (its ground layer the valley's level floor, as the old scene's)
    // (the fog lies in the valley: its own weather, the inversion caps the plume)
    weather: { ...FOGGY_FOREST_WEATHER },
    timeScale: 6,
    view: { camera: [-4, 9, 14] },
    proxy: { color: '#3f5a32', height: 6, fill: 0.6, sea: 0 },
    objects: [
      // the valley floor (level: nothing over its ground layer) and the sea's level, for the ground drawn round it
      landOf(P, { grass: false }),
      ...foggyForestObjects(),
      sign(P, [121, 66.6], 'village', 'Path: back along the valley to the village', [1.6, 0]),
      sign(P, [130.6, 60.8], 'castle', 'Path: up to the castle', [0, 1.6]),
    ],
  };
}

/** The castle on its hill (models/castle.js), its garrison, the roads down. */
function castlePlace() {
  const P = CASTLE;
  return {
    name: 'Castle on the hill',
    label: 'Castle',
    group: ISLE_GROUP,
    origin: P.origin.slice(),
    world: { size: P.size.slice(), h: P.h, ground: 'none' },
    view: { camera: [-14, 22, 40], walk: true },
    proxy: { color: '#8c8a80', height: 16, fill: 0.6, sea: SEA_Y - P.origin[1] },
    objects: [
      landOf(P),
      at(P, CASTLE_HILL.c[0], CASTLE_HILL.c[1], { type: 'castle', params: { width: 22, depth: 18, keepHeight: 11 } }),
      // the garrison: two on their round in the courtyard, one at the gate
      at(P, CASTLE_HILL.c[0] - 1, CASTLE_HILL.c[1] - 1, { type: 'enemy', params: { count: 2, spread: 1, seed: 7, patrol: 'area', patrolWidth: 8, patrolDepth: 6 } }),
      at(P, CASTLE_HILL.c[0] - 14.5, CASTLE_HILL.c[1] + 3.2, { type: 'enemy', params: { count: 1, spread: 0.3, seed: 8 } }),
      sign(P, [114.6, 41.2], 'village', 'Road: down to the village', [1.6, 0]),
      sign(P, [134, 52.4], 'forest', 'Path: down into the valley (the forest)', [0, -1.6], 90),
    ],
  };
}

/** The catacombs under the church (schematic box: under the church on the dragon island). */
function catacombsPlace() {
  return {
    name: 'Catacombs under the church',
    exposure: 'underground',
    box: [CORE.origin[0] + CHURCH_AT[0] - 18, -4.5, CORE.origin[2] + CHURCH_AT[1] - 17], // (for the overview: under the church)
    world: { size: [36, 4.2, 34], h: 0.2, ground: 'quarrySand' },
    weather: { ambient: 12, humidity: 0.8 },
    timeScale: 1,
    view: { dark: true, camera: [12, 16, -5], walk: true },
    objects: catacombObjects('island'),
  };
}

export const FANTASY_DESCRIPTION =
  "A world of its own: the dragon isle in an open sea, on a bright late-summer morning. You come ashore at the landing stage of the harbour village on its south coast. West along the road lies the old dragon island: hills, a pond, a gothic church being built on a plateau (its tower and south arm in scaffolding, the sun falling through the stained glass) with the catacombs under it (guards, a dungeon cell, an underground chapel), a house with a campfire, a volcano on the main hill and on the far side a waterfall off a rocky height (a walkway behind the falling water, a river to the sea, a water mill on it). A dragon lives there: it rests on the hillside, crawls up the hill (over the volcano: it wakes and erupts), climbs over the church roof and sniffs at the crypt, then flies back; a younger koi-scaled dragon now and then flies out to fight it. They hunt what they see, guards and you: fire breath, and they devour their prey. Off the village square the smithy, where the smith forges a blade (bellows, anvil, quench; the old metal bars on burners on its test hearth). East a road climbs to the castle on its hill: curtain walls, corner towers, a gatehouse with a portcullis and oak gates (E), battlements, the keep, a timber great hall and stables with hay, its garrison. Below the castle, in the valley between its hill and the ridge along the south coast, a stand of conifers burns in the fog that pools there: the inversion caps the plume and the smoke spreads sideways (6× time). Signposts at the ends of the roads take you along them (E), a boat round the coast between the village and the dragon island's pier. Zoomed out every place shows as a labelled box: click one to go there; the village, the smithy, the castle and the forest take over as the camera comes close.";

/** The Fantasy world scene. */
export function fantasyWorld() {
  return {
    name: 'Fantasy world',
    description: FANTASY_DESCRIPTION,
    // a bright late-summer morning, 10:00 on 2 September at 51.5° N (sim/sky.js): the sun from the
    // south-east (through the church's south windows), a moderate breeze off the sea
    weather: w({ ambient: 17, humidity: 0.65, windSpeed: 6, day: 245, time: 10 }),
    timeScale: 1,
    startZone: 'village',
    places: true,
    // the sea round the isle (drawn: models/archipelago.js): the isle's own ground (lands), a few
    // far islands on the horizon, the shelf round the old island's voxels
    archipelago: {
      seed: 13,
      extent: 2600,
      lands: ['dragonIsle'],
      zones: [{ box: [CORE.origin[0], CORE.origin[2], CORE.origin[0] + CORE.size[0], CORE.origin[2] + CORE.size[2]], floor: -1.7 }],
      islands: [
        { c: [-700, -500], rx: 260, rz: 140, rot: 0.4, peak: 90, reef: 1.4 },
        { c: [900, 700], rx: 180, peak: 60, reef: 1.5, cone: true },
        { c: [-400, 900], rx: 90, peak: 25, reef: 1.8 },
        { c: [1300, -400], rx: 220, rz: 120, rot: -0.3, peak: 70, reef: 1.5 },
      ],
    },
    zones: {
      village: villagePlace(),
      smithy: smithyPlace(),
      island: islandPlace(),
      catacombs: catacombsPlace(),
      castle: castlePlace(),
      forest: forestPlace(),
    },
  };
}
