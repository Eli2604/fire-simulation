import { defaultWeather } from './sim/weather.js';

/**
 * Scene description format (also used for JSON import/export):
 * {
 *   name, description,
 *   world:   { size: [x, y, z] metres, h: voxel size m, ground: material },
 *   weather: { ambient, humidity, windSpeed, windDir, rain, fog },
 *   timeScale, view: { mode, camera: [x,y,z] offset from centre },
 *   objects: [{ type, params, x, z, y?, rotation, ignite }]
 * }
 *
 * A scene can instead be split into zones (a ship's flight deck and the decks
 * below): { zones: { name: { name, world, view, objects } }, startZone }. Only
 * the zone you are in is built and simulated; the others are built the first
 * time you go there (a hatch or ladder, E) and are frozen while you are away.
 */
const w = (o = {}) => ({ ...defaultWeather(), ...o });

/**
 * The catacombs: one list for the Catacombs scenario (direct, for testing) and for the
 * carrier's catacombs zone under the church on the island (loaded only when you go down).
 * exitTo: the zone their entrance stairs lead up to.
 */
function catacombObjects(exitTo = '') {
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

/**
 * Tea by the lake in winter: a small island with a frozen lake in it, a veranda on its shore
 * looking out over the ice, a couch under it with a plaid, a side table with a book, a candle
 * and a hot cup of tea, steaming in the frost. One list for its own scenario and for the lake
 * island in the carrier's island group (boats: where they go; '' none).
 */
export const LAKESIDE_WINTER = { ambient: -4, humidity: 0.85, windSpeed: 1.5, windDir: 60, rain: 0.5, fog: 0.05, sunshine: 0.35, season: 'winter', snowCover: 0.12, iceCover: 0.1 };
function lakesideObjects({ boatTo = '', boatLabel = 'Boat', ferryTo = '', ferryLabel = 'Boat' } = {}) {
  return [
    { type: 'island', params: { width: 20, depth: 17, seaLevel: 1.0, hill: 1.2, plateau: 0.9, plateauEast: 0.7, canal: false, pond: true, pondX: 0.05, pondZ: -0.3, pondRadius: 4.2, pondRadiusZ: 2.4, pondDepth: 0.8, pierLength: 4, catacombs: '', hut: false, boatTo, boatLabel, ferryTo, ferryLabel, seed: 21 }, x: 11, z: 9.5 },
    // the veranda on the south shore, open to the lake
    { type: 'veranda', params: { width: 3.6, depth: 2.6 }, x: 12, z: 12.2, y: 1.9 },
    { type: 'couch', params: {}, x: 11.8, z: 12.85, y: 2.1 },
    { type: 'sideTable', params: {}, x: 13.25, z: 12.75, y: 2.1 },
    // on the table: the tea, just poured, and a candle
    { type: 'teaCup', params: { temp: 88 }, x: 13.35, z: 12.62, y: 2.7 },
    { type: 'candle', params: { height: 0.09, radius: 0.03 }, x: 13.3, z: 12.92, y: 2.7, ignite: true },
    // firewood stacked against the veranda, pines and a bare oak round the lake
    { type: 'woodPile', params: { arrangement: 'stack', logs: 10, logLength: 0.9, logRadius: 0.08, stones: false, kindling: false }, x: 9.6, z: 13.1, y: 'auto' },
    { type: 'tree', params: { species: 'pine', height: 4.6, crownRadius: 1.4, seed: 4 }, x: 5.2, z: 8.2, y: 'auto' },
    { type: 'tree', params: { species: 'pine', height: 4.2, crownRadius: 1.2, seed: 8 }, x: 17.6, z: 6.6, y: 'auto' },
    { type: 'tree', params: { species: 'pine', height: 3.8, crownRadius: 1.1, seed: 9 }, x: 16.4, z: 13.8, y: 'auto' },
    { type: 'tree', params: { species: 'oak', height: 4, crownRadius: 1.9, seed: 6 }, x: 6.4, z: 13, y: 'auto' },
  ];
}

export const SCENARIOS = {
  winterTea: {
    name: 'Tea by the lake in winter',
    description: 'A frosty afternoon on a little island with a lake in it: the lake is frozen over (10 cm: it bears you), snow lies and a little more is falling. On a veranda on the shore, out of the snow, a couch with a plaid over its arm, and next to it a side table with a book, a candle and a cup of tea, just poured at 88 °C. It steams in the cold air (the vapour off the hot tea condenses as it mixes with it), cools (most of its heat goes in evaporation while it is hot: ~2–3 K a minute at first), and left out long enough in the frost it freezes over. Walk out onto the ice, or set the couch alight. The same island is in the carrier scene (a boat from the islet).',
    world: { size: [22, 7, 19], h: 0.1, ground: 'none' },
    weather: w(LAKESIDE_WINTER),
    timeScale: 1,
    view: { camera: [2.5, 1.5, -8.5] },
    objects: lakesideObjects(),
  },

  laundry: {
    name: 'Laundry on the line',
    description: 'A warm, breezy afternoon: the wash hangs on the line in the garden, wet from the machine (a sheet folded over the line, towels, polyester shirts, jeans, a pillowcase, socks). It dries in the sun and the wind (cotton holds a lot of water; it will not burn while it is wet). The barbecue on the lawn is going. After a quarter of an hour a spark from it lands at the foot of the sheet: if the sheet has dried by then it catches, and the fire runs along the line; the shirts shrink, melt and drip before they burn, garments burnt through at the top fall.',
    world: { size: [7, 3, 5], h: 0.05, ground: 'soil' },
    weather: w({ ambient: 27, humidity: 0.35, windSpeed: 3, windDir: 20 }),
    timeScale: 15,
    view: { camera: [1.2, 2.4, 6.4] },
    objects: [
      // a green, watered lawn (live grass is too wet to carry a fire; it scorches under what falls)
      { type: 'grass', params: { width: 6.8, depth: 4.8, height: 0.05, density: 0.45, moisture: 2.0, clearRadius: 0 }, x: 3.5, z: 2.5 },
      // (a spark from the barbecue lands at the foot of the sheet after 15 minutes, simulated time)
      { type: 'clothesline', params: { length: 5, height: 1.9, wet: 0.8, sparkAfter: 900 }, x: 3.5, z: 2.6 },
      // the barbecue on the lawn, burning (its sparks)
      { type: 'woodPile', params: { arrangement: 'teepee', logs: 5, logLength: 0.35, logRadius: 0.035, moisture: 0.08, stones: true }, x: 2.0, z: 1.4, ignite: true },
      // a garden bench, a jerrycan by the barbecue (models/scannedProp.js)
      { type: 'scannedProp', params: { asset: 'bench' }, x: 5.5, z: 4.2, rotation: 15 },
      { type: 'scannedProp', params: { asset: 'jerrycan' }, x: 1.1, z: 3.7, rotation: 30 },
    ],
  },
  metalBars: {
    name: 'Metal bars on burners',
    description: 'Steel, aluminium and copper bars heated at one end. Copper conducts heat fastest; aluminium is first to melt.',
    world: { size: [1.4, 0.6, 0.7], h: 0.02 },
    weather: w({ ambient: 20 }),
    timeScale: 20,
    view: { mode: 'thermal', camera: [0.2, 0.8, 1.1] },
    objects: [
      { type: 'metalBar', params: { material: 'steel', thickness: 0.03, burnerPower: 6000 }, x: 0.7, z: 0.15 },
      { type: 'metalBar', params: { material: 'aluminium', thickness: 0.03, burnerPower: 6000 }, x: 0.7, z: 0.35 },
      { type: 'metalBar', params: { material: 'copper', thickness: 0.03, burnerPower: 6000 }, x: 0.7, z: 0.55 },
    ],
  },
  grassFire: {
    name: 'Wind-driven grass fire',
    description: 'Dry grass lit on the upwind edge. Wind pushes the flames forward towards trees and a fence.',
    world: { size: [24, 9, 14], h: 0.2 },
    weather: w({ windSpeed: 4, windDir: 0, humidity: 0.25, ambient: 28 }),
    timeScale: 3,
    view: { camera: [-10, 9, 16] },
    objects: [
      { type: 'grass', params: { width: 23, depth: 13, height: 0.4, density: 0.85, moisture: 0.07 }, x: 12, z: 7 },
      { type: 'grass', params: { width: 2, depth: 2, height: 0.05, density: 1, moisture: 0.07 }, x: 1.5, z: 7, ignite: true },
      { type: 'tree', params: { species: 'pine', height: 6, crownRadius: 1.6, foliageMoisture: 0.8 }, x: 15, z: 5 },
      { type: 'tree', params: { species: 'willow', height: 6, crownRadius: 2.2, seed: 3 }, x: 17, z: 9.5 },
      { type: 'fence', params: { length: 8 }, x: 20, z: 7, rotation: 90 },
    ],
  },
  threeTrees: {
    name: 'Oak, willow and pine in a grass fire',
    description: "A grass fire runs under an oak, a weeping willow and a pine. The pine's dead lower branches and resinous needles carry the fire into a crown fire; the willow's charred branches snap and drop burning; the oak's heavy limbs mostly burn where they are.",
    world: { size: [22, 11, 12], h: 0.2 },
    weather: w({ windSpeed: 3, windDir: 0, humidity: 0.25, ambient: 30 }),
    timeScale: 4,
    view: { camera: [-6, 8, 18] },
    objects: [
      { type: 'grass', params: { width: 21.5, depth: 11.5, height: 0.4, density: 0.85, moisture: 0.06 }, x: 11, z: 6 },
      { type: 'grass', params: { width: 1.5, depth: 1.5, height: 0.05, density: 1, moisture: 0.06 }, x: 1.2, z: 6, ignite: true },
      { type: 'tree', params: { species: 'oak', height: 8, crownRadius: 3 }, x: 8, z: 6 },
      { type: 'tree', params: { species: 'willow', height: 7, crownRadius: 2.6, seed: 2 }, x: 13.5, z: 6 },
      { type: 'tree', params: { species: 'pine', height: 9, crownRadius: 2.2, seed: 3 }, x: 18.5, z: 6 },
    ],
  },
  carHouse: {
    name: 'Car fire next to a house',
    description: 'An engine fire spreads to the cabin, the tyres and the fuel tank, then radiates onto the wooden house next to it.',
    world: { size: [14, 8, 11], h: 0.15 },
    weather: w({ windSpeed: 1.5, windDir: 90 }),
    timeScale: 10,
    view: { camera: [8, 7, 11] },
    objects: [
      { type: 'house', params: { width: 7, depth: 5, wallMaterial: 'wood', roofMaterial: 'wood shingles' }, x: 7, z: 7.5 },
      { type: 'car', params: { bodyColor: '#a8322f' }, x: 6.5, z: 2.6, ignite: true },
      { type: 'tree', params: { height: 5, crownRadius: 1.5 }, x: 12, z: 3 },
    ],
  },
  neighbourhood: {
    name: 'Garden on a dry day',
    description: 'A brick house with a furnished living room, a car, trees, a hedge of grass, a woodpile and a fence. The fire starts on the sofa.',
    world: { size: [22, 9, 18], h: 0.2 },
    weather: w({ windSpeed: 2, windDir: 30, humidity: 0.3, ambient: 25 }),
    timeScale: 10,
    view: { camera: [-6, 12, 20] },
    objects: [
      { type: 'grass', params: { width: 21, depth: 17, height: 0.2, density: 0.7, moisture: 0.12 }, x: 11, z: 9 },
      { type: 'house', params: { width: 8, depth: 6, windowsPerSide: 3 }, x: 9, z: 8, ignite: true },
      { type: 'car', params: { bodyColor: '#e0e0e0' }, x: 9, z: 2.3, rotation: 0 },
      { type: 'woodPile', params: { arrangement: 'stack', logs: 15, logLength: 1.2, logRadius: 0.1, stones: false, kindling: false }, x: 15, z: 11.5, rotation: 90 },
      { type: 'tree', params: { species: 'oak', height: 7, crownRadius: 2.4 }, x: 17, z: 5 },
      { type: 'tree', params: { species: 'willow', height: 6, crownRadius: 2.2, seed: 4 }, x: 3.5, z: 4.5 },
      { type: 'tree', params: { species: 'pine', height: 7, crownRadius: 1.4 }, x: 3, z: 14 },
      { type: 'tree', params: { species: 'pine', height: 5, crownRadius: 1.2, seed: 5 }, x: 18.5, z: 14 },
      { type: 'fence', params: { length: 14 }, x: 11, z: 16.5 },
    ],
  },
  foggyForest: {
    name: 'Forest fire in fog',
    description: 'A small conifer stand burning in fog: the temperature inversion caps the plume so smoke spreads sideways, and steam lingers.',
    world: { size: [16, 10, 12], h: 0.2 },
    weather: w({ fog: 0.8, humidity: 0.9, ambient: 8, windSpeed: 0.5 }),
    timeScale: 6,
    view: { camera: [-4, 9, 14] },
    objects: [
      { type: 'grass', params: { width: 15, depth: 11, height: 0.2, density: 0.5, moisture: 0.2 }, x: 8, z: 6 },
      ...[
        [3, 3], [6, 4.5], [9, 3.2], [12, 4], [4.5, 7.5], [8, 8], [11.5, 8.5], [13.5, 6.5],
      ].map(([x, z], k) => ({ type: 'tree', params: { species: 'pine', height: 5 + (k % 3), crownRadius: 1.2, foliageMoisture: 0.7, seed: k + 1 }, x, z })),
      { type: 'woodPile', params: { arrangement: 'teepee', logs: 6, logLength: 1, logRadius: 0.07, stones: false }, x: 5, z: 6, ignite: true },
    ],
  },
  gasCylinders: {
    name: 'Gas cylinders in a bonfire',
    description: 'Two 11 kg propane cylinders in a burning pile of pallets. The one with a working relief valve vents a roaring jet flame; the one with a blocked valve overfills as the liquid expands and bursts (BLEVE): fireball and fragments.',
    world: { size: [8, 6, 8], h: 0.08 },
    weather: w({ windSpeed: 1, humidity: 0.4 }),
    timeScale: 8,
    view: { camera: [1.5, 3.2, 8.5] },
    objects: [
      { type: 'grass', params: { width: 7.8, depth: 7.8, height: 0.1, density: 0.6, moisture: 0.2, clearRadius: 1.6 }, x: 4, z: 4 },
      { type: 'woodPile', params: { arrangement: 'stack', logs: 14, logLength: 1.4, logRadius: 0.07, moisture: 0.1, stones: false }, x: 4, z: 4, ignite: true },
      { type: 'burner', params: { power: 150000, flameRadius: 0.7, flameHeight: 1.6, nozzleHeight: 0.04 }, x: 4, z: 4 },
      { type: 'gasCylinder', params: { reliefValve: 'working' }, x: 3.4, z: 4.6 },
      { type: 'gasCylinder', params: { reliefValve: 'blocked', color: '#3b6fb0' }, x: 4.6, z: 3.5 },
      { type: 'fence', params: { length: 6 }, x: 4, z: 7.2 },
    ],
  },
  tankRupture: {
    name: 'Car fire: what the fuel tank does',
    description: 'A car with a steel fuel tank and a blocked vent burns from the interior. The thin tank wall heats up far faster than the petrol, so it softens and splits before much pressure can build: the fuel pours out into a pool fire. Real car tanks almost never explode; for a real explosion see the gas cylinders.',
    world: { size: [12, 7, 10], h: 0.12 },
    weather: w({ windSpeed: 1 }),
    timeScale: 10,
    view: { camera: [2, 5, 11] },
    objects: [
      { type: 'car', params: { bodyColor: '#d9d9d9', tankMaterial: 'steel', tankVent: 'blocked', fuelLiters: 50, igniteAt: 'interior' }, x: 6, z: 5, ignite: true },
      { type: 'fence', params: { length: 8 }, x: 6, z: 8.5 },
      { type: 'tree', params: { height: 4.5, crownRadius: 1.4 }, x: 10, z: 2.5 },
    ],
  },
  hallway: {
    name: 'Hallway: gas pipe burst',
    description: 'An office corridor with a suspended ceiling. After 20 s the gas pipe hidden in the ceiling void bursts and ignites. Smoke leaks through the tiles and fills the corridor from the top down; tiles drop, the grid sags, paint blisters and peels. Try the firefighter walk-through.',
    world: { size: [17, 4.2, 7.6], h: 0.1 },
    weather: w({ ambient: 18, humidity: 0.5 }),
    timeScale: 1,
    view: { camera: [1.2, 3.8, -1.5], walk: true },
    objects: [{ type: 'hallway', params: {}, x: 9.5, z: 2 }],
  },
  hallwaySprinklers: {
    name: 'Hallway with sprinklers',
    description: 'The same office corridor and gas pipe burst, now with sprinklers. Each glass bulb heats with the gas around it and bursts at 68 °C; the heads spray, cool the smoke, wet everything and the water collects on the floor. Pick up the wall extinguisher or the hose reel (E) and close office doors to keep the fire out.',
    world: { size: [17, 4.2, 7.6], h: 0.1 },
    weather: w({ ambient: 18, humidity: 0.5 }),
    timeScale: 1,
    view: { camera: [1.2, 3.8, -1.5], walk: true },
    objects: [{ type: 'hallway', params: { sprinklers: true }, x: 9.5, z: 2 }],
  },
  catacombs: {
    name: 'Catacombs',
    description: 'Vaulted limestone passages with carved inscriptions and walls of stacked skulls and bones, lit by torches on the walls; burial niches, and chambers with coffins behind wooden doors. Guards make their rounds, opening and closing the doors. People hide down here: they hear breaking glass and doors, avoid fire, and set old cloth and coffins alight to lure you in. Bring the bow (6) and fire arrows.',
    world: { size: [36, 4.2, 34], h: 0.2, ground: 'quarrySand' },
    weather: w({ ambient: 12, humidity: 0.8 }),
    timeScale: 1,
    view: { dark: true, camera: [12, 16, -5] },
    objects: catacombObjects(),
  },
  carrier: {
    name: 'Carrier, island, catacombs and a spaceship',
    description: 'The flight deck of a carrier at sea with a jet fighter: walk up to it and press E to fly it (W/S throttle, mouse to pitch and roll, A/D rudder, Space or click for rockets, E to climb out once stopped on deck). The hatch next to the island (E) leads below deck: corridors, mess, berthing, a store room and a server room behind a locked glass door, where a rack catches fire after 25 s. A ladder at its forward end leads down to the lower decks below the waterline: after 30 s a fuel line bursts against the hull there, the vapour explodes and tears the plating open, and the sea pours in, filling the lower deck from the bottom up (close the watertight doors; under water you breathe from your mask) while the ship settles and lists. Its inert-gas system floods the room when the ceiling gets hot, but only works if the door is shut. Not far off lies an island with hills, a canal and a pond, a gothic church being built on a plateau (its tower and south arm still in scaffolding, the sun falling through the stained glass), a campfire and a house, and at the shore the stairs down into the catacombs; take the boat from the stern, or fly there. A dragon lives on the island: it rests on the hillside, crawls up the hill, climbs over the church roof and sniffs at the catacomb stairs, then flies back. It hunts what it sees, guards and you: it breathes fire and devours its prey. Fire does not hurt it; arrows and rockets do. Rockets hit whatever they reach and the jet can be damaged by blasts, flames and scrapes; X ejects. Hold B to boost: climb out of the atmosphere and dock (slowly) at the spaceship in orbit, 2.4 km up. Its hull holds the air: breach it with a grenade or a rocket, or open the outer airlock door, and the ship decompresses. From the islet a boat goes on to a small island in a cold snap of its own: a frozen lake, and a cup of tea steaming on a veranda by it. Only the place you are in is simulated; the others are built the first time you get there and frozen while you are away.',
    weather: w({ ambient: 16, humidity: 0.7, windSpeed: 8 }),
    timeScale: 1,
    startZone: 'deck',
    // the island group round the ship and the island (drawn: models/archipelago.js): a large
    // high island, a long one, volcanic cones, islets, a sand cay, a sunken reef ring, each
    // with its fringing reef and lagoon; the simulated island on a shelf of its own
    archipelago: {
      seed: 7,
      extent: 2600,
      zones: [
        { box: [107, -28, 171, 30], floor: -1.7 }, // the island's voxel terrain (its zone is 2 m larger all round)
        { box: [310.5, -404.5, 319.5, -396.5], floor: -1.6 }, // the islet's
        { box: [241, 151, 261, 168], floor: -1.6 }, // the lake island's
      ],
      islands: [
        { c: [950, -700], rx: 600, rz: 330, rot: 0.35, peak: 140, reef: 1.35 },
        { c: [-700, -1000], rx: 700, rz: 170, rot: -0.45, peak: 80, reef: 1.5 },
        { c: [560, 420], rx: 110, peak: 30, reef: 1.8 },
        { c: [-320, 440], rx: 70, peak: 20, reef: 2.0 },
        { c: [820, 250], rx: 160, peak: 75, reef: 1.45, cone: true },
        { c: [1450, 120], rx: 90, rz: 60, rot: 0.8, peak: 25, reef: 1.9 },
        { c: [-1100, 150], rx: 130, peak: 45, reef: 1.6 },
        { c: [-220, -320], rx: 80, peak: -1.2, reef: 1.5 },
        { c: [1250, 900], rx: 200, rz: 140, rot: -0.3, peak: 60, reef: 1.5 },
        { c: [-450, 1200], rx: 150, peak: 35, reef: 1.7 },
      ],
    },
    zones: {
      // the flight deck of a carrier: 210 × 48 m simulated (the ship drawn round it is ~250 m),
      // its deck park: two jets on the bow catapults, two on the waist catapults, rows parked
      // along the bow and aft of the island, helicopter spots aft to starboard. (Its sea level
      // is 4.5 m above its keel: the zone sits 1.6 m lower to put it with the islands'.)
      deck: {
        name: 'Flight deck',
        origin: [-160, -1.6, -10],
        world: { size: [212, 25, 52], h: 0.5, ground: 'none' },
        view: { camera: [-40, 45, 85], walk: true },
        proxy: { shape: 'carrier', length: 210, beam: 48, deck: 11, draft: 4, at: [106, 0, 26], color: '#6d7175', height: 8, fill: 0.9, sea: 4 },
        objects: [
          { type: 'carrierDeck', params: { length: 210, beam: 48, deckHeight: 11, draft: 4, helipads: 3, boatTo: 'island' }, x: 106, z: 26 },
          // on the catapults: two at the bow, two in the waist (each one's run clear of the parked
          // ones' wings; their tails overhang the deck edge, as they do on a carrier)
          ...[[145, 20], [145, 30], [85, 10.4], [85, 21.2]].map(([x, z], k) => ({ type: 'jet', params: { color: k % 2 ? '#7a8590' : '#6f7b86' }, x, z, y: 11, rotation: 0 })),
          // parked along the bow, both sides, tails to the deck edge
          ...[150, 161, 172, 183].map((x) => ({ type: 'jet', params: { rockets: 4 }, x, z: 42.5, y: 11, rotation: 90 })),
          ...[160, 171, 182, 193].map((x) => ({ type: 'jet', params: { rockets: 4 }, x, z: 7.4, y: 11, rotation: -90 })),
          // and aft of the island (the "corral")
          ...[62, 73, 84, 95].map((x) => ({ type: 'jet', params: { rockets: 0, fuelLiters: 800 }, x, z: 42.5, y: 11, rotation: 90 })),
          // a tow tractor, oxygen and propane bottles by the island
          { type: 'car', params: { length: 2.8, width: 1.6, height: 1.1, bodyColor: '#d8b21c', fuelLiters: 30, tankMaterial: 'steel' }, x: 104.5, z: 39.5, y: 'auto', rotation: 90 },
          { type: 'gasCylinder', params: { capacity: 40, fill: 0.9, color: '#2f6b3a' }, x: 107.6, z: 48.2, y: 'auto' },
          { type: 'gasCylinder', params: { capacity: 11, fill: 0.8 }, x: 108.3, z: 48.3, y: 'auto' },
          // two oil drums by the island (models/scannedProp.js)
          { type: 'scannedProp', params: { asset: 'drum' }, x: 109.4, z: 48.1, y: 'auto' },
          { type: 'scannedProp', params: { asset: 'drum' }, x: 110.1, z: 48.2, y: 'auto', rotation: 40 },
        ],
      },
      below: {
        name: 'Below deck',
        indoor: true,
        world: { size: [32, 3.6, 17], h: 0.2, ground: 'none' },
        view: { camera: [16, 14, -8], walk: true },
        objects: [
          { type: 'carrierBelow', params: { downTo: 'lower' }, x: 16, z: 8.5 },
          { type: 'enemy', params: { count: 2, spread: 1, level: 0.2, patrol: 'route', patrolWidth: 18, patrolDepth: 1, patrolOffsetX: -4 }, x: 24, z: 8.5 },
          { type: 'enemy', params: { count: 2, spread: 1.5, level: 0.2, seed: 2 }, x: 8, z: 4.5 },
        ],
      },
      // the lower decks, below the waterline: corridors, cabins, watertight doors; the fuel line
      // bursts against the hull after 30 s, holes it, and the sea pours in (the ship settles and lists)
      lower: {
        name: 'Lower decks (below the waterline)',
        indoor: true,
        world: { size: [18, 7.2, 9.2], h: 0.2, ground: 'none' },
        view: { camera: [-3, 10, 14], walk: true },
        objects: [{ type: 'shipSection', params: { upTo: 'below' }, x: 9, z: 4.5 }],
      },
      // a small islet out on the reef: a log-cabin campfire in a stone ring on dry grass
      // (the old Campfire scene), a boat back to the island
      islet: {
        name: 'Islet with a campfire',
        origin: [310, 0.32, -405], // (its voxels are finer than the island's: this puts its sea level with theirs)
        world: { size: [10, 4.5, 9], h: 0.08, ground: 'none' },
        view: { camera: [12, 5, 12], walk: true },
        proxy: { shape: 'hill', color: '#7a8a4a', height: 2, fill: 0.8, sea: 2.9 },
        weather: { humidity: 0.4, windSpeed: 0.5 },
        objects: [
          { type: 'island', params: { width: 9, depth: 8, seaLevel: 2.5, hill: 0.6, plateau: 0.35, plateauEast: 0.7, canal: false, pond: false, pierLength: 3, catacombs: '', boatTo: 'island', boatLabel: 'Boat: back to the island', ferryTo: 'lake', ferryLabel: 'Boat: to the lake island', hut: false, seed: 9 }, x: 5, z: 4.5 },
          { type: 'grass', params: { width: 3.6, depth: 3.2, height: 0.16, density: 0.6, moisture: 0.12, clearRadius: 0.8 }, x: 4.6, z: 5.4, y: 'auto' },
          { type: 'woodPile', params: { logs: 8, logLength: 0.8, logRadius: 0.08 }, x: 4.6, z: 5.4, y: 'auto', ignite: true },
        ],
      },
      // a small island with a frozen lake in it, in a cold snap of its own: tea on a veranda by
      // the ice (the Tea by the lake scenario)
      lake: {
        name: 'Lake island (winter)',
        origin: [240, 1.8, 150], // (its sea level with the others')
        world: { size: [22, 7, 19], h: 0.1, ground: 'none' },
        view: { camera: [2.5, 1.5, -8.5], walk: true },
        proxy: { shape: 'hill', color: '#dfe4e8', height: 1.5, fill: 0.85, sea: 2.9 },
        weather: LAKESIDE_WINTER,
        objects: lakesideObjects({ boatTo: 'island', boatLabel: 'Boat: to the island', ferryTo: 'islet', ferryLabel: 'Boat: back to the islet' }),
      },
      island: {
        name: 'Island',
        origin: [105, 0, -30],
        world: { size: [68, 22, 62], h: 0.4, ground: 'none' },
        // a late-morning sun from the south-east: through the south windows of the nave its light falls on the rosette in the crossing
        view: { camera: [71.4, 30, 78.6], walk: true, sun: [0.544, 0.64, 0.544] },
        proxy: { shape: 'hill', color: '#5f7a3a', height: 7, fill: 0.95, sea: 2.9 },
        objects: [
          { type: 'island', params: { width: 64, depth: 58, seaLevel: 2.5, plateauEast: 0.6, pierLength: 9, catacombs: '', boatTo: 'deck', ferryTo: 'islet', hut: false }, x: 34, z: 31 },
          // a gothic church being built on the plateau: tower and south arm still in scaffolding
          { type: 'church', params: { crypt: 'catacombs' }, x: 24.1, z: 42.2, y: 'auto' },
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
          { type: 'tree', params: { species: 'pine', height: 7.5, crownRadius: 1.9, seed: 12 }, x: 16, z: 22, y: 'auto' },
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
          { type: 'dragon', params: { route: '30.6,20.8 rest; 51,21.6 climb; 24.1,42.2 climb; 24.2,33.4 sniff; 30.6,20.8 fly rest' }, x: 30.6, z: 20.8, rotation: 90 },
        ],
      },
      spaceship: {
        name: 'Spaceship in orbit',
        origin: [60, 2400, 40],
        approach: 60, // shown (and dockable) from 60 m out
        world: { size: [34, 7, 13], h: 0.2, ground: 'none' },
        weather: { ambient: 20, humidity: 0.3, windSpeed: 0, rain: 0, fog: 0 },
        view: { space: true, walk: true, camera: [-12, 10, 22] },
        proxy: { color: '#c8ccd2', height: 4.4, fill: 0.9, sea: 0.6 },
        objects: [
          { type: 'spaceship', params: {}, x: 17.5, z: 6.5 },
          { type: 'enemy', params: { count: 2, spread: 1, level: 0.9, patrol: 'route', patrolWidth: 18, patrolDepth: 1 }, x: 17.5, z: 6.5 },
        ],
      },
      catacombs: {
        name: 'Catacombs under the church',
        world: { size: [36, 4.2, 34], h: 0.2, ground: 'quarrySand' },
        view: { dark: true, camera: [12, 16, -5], walk: true },
        // the whole Catacombs scenario (the same objects), its stairs up into the church
        objects: catacombObjects('island'),
      },
    },
  },
  squadRange: {
    name: 'Squad on a range: bounding overwatch',
    description: 'A fire team of sculpted, rigged soldiers (a commander, a gunner and two riflemen) advances on a threat across a desert range by bounding overwatch: one team runs or walks with rifles up to cover behind the brick walls and wooden crates while the other covers it, crouched and firing bursts (real rounds: tracers and holes in the walls), then the commander signals and they swap. On first contact, when the threat moves and when a man is down, the radio man of each team calls it in on the radio on his chest and the other team (Bravo, on the left flank) answers. The second rifleman of Bravo is a flame trooper: close to the threat he stands up and fires his flame gun (it sets the crates alight); he cannot fire it crouched. Everyone carries a compact carbine on his back. The drone operator of Alpha stays back: on contact he takes his backpack off, kneels, takes a quadcopter out, sets it down, pulls his goggles on and flies it over the threat. A rifleman throws hand grenades at the threat (the same grenades and blasts as the grenade tool). Throw your own grenades at them, place walls and crates (Place new object) or move the threat (tool: Squad: set the threat). The rig test page (Soldier rig test) has every animation, the hit areas and the gear on its own.',
    world: { size: [36, 5, 36], h: 0.2, ground: 'quarrySand' },
    weather: w({ ambient: 31, humidity: 0.2, windSpeed: 2 }),
    timeScale: 1,
    view: { camera: [14, 16, 26] },
    objects: [
      ...[['wall', 14.5, 23.5, 0], ['crate', 20.6, 24.2, 0], ['crate', 21.7, 24.2, 0], ['wall', 22.6, 19.5, 90], ['crate', 16.8, 19.6, 0], ['wall', 13, 16.5, 90], ['wall', 16.5, 14.4, 0],
        ['crate', 21.2, 13.8, 0], ['wall', 23.4, 10.6, 0], ['crate', 14.4, 10.2, 0], ['crate', 18.6, 9.4, 0]].map(([type, x, z, rotation]) => ({ type, params: {}, x, z, rotation })),
      { type: 'squad', params: { unit: 'Alpha', threatX: 0, threatZ: -21, droneOperator: true }, x: 18, z: 29 },
      // a second team on the left flank: the two talk on the radio
      { type: 'squad', params: { unit: 'Bravo', threatX: 12, threatZ: -21, flameTrooper: true }, x: 6, z: 29 },
    ],
  },
  droneCamp: {
    name: 'Military camp: drone operations desk',
    description: 'A camp with a swarm of drones flown by the group logic of the drones repo (vendor/drones); a drone operator walks to his desk with a monitor per drone and a tactical map; jammers cut the link to the camp or GNSS.',
    page: 'camp.html',
  },
  rigTest: {
    name: 'Soldier rig test (animations, hit areas, gear)',
    description: 'The sculpted operator on its own page: every animation, the hit areas, the detachable gear, and the squad AI on a range you edit.',
    page: 'rig.html',
  },
  rainyHouse: {
    name: 'House fire in the rain',
    description: 'A furnished house fire in steady rain. Rain cannot reach the fire inside, which still breaks through the roof, but the soaked grass and the tree do not catch, and rain on hot surfaces makes steam.',
    world: { size: [14, 8, 12], h: 0.15 },
    weather: w({ rain: 15, humidity: 0.9, windSpeed: 1, ambient: 10 }),
    timeScale: 10,
    view: { camera: [-2, 8, 14] },
    objects: [
      { type: 'grass', params: { width: 13, depth: 11, height: 0.15, density: 0.7, moisture: 0.6 }, x: 7, z: 6 },
      { type: 'house', params: { width: 7, depth: 5, roofMaterial: 'wood shingles', doorOpen: true }, x: 7, z: 6, ignite: true },
      { type: 'tree', params: { height: 5, crownRadius: 1.6 }, x: 12, z: 2.5 },
    ],
  },
};

export function cloneScene(s) {
  return JSON.parse(JSON.stringify(s));
}
