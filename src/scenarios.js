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

export const SCENARIOS = {
  campfire: {
    name: 'Campfire',
    description: 'A log-cabin campfire lit from the kindling, inside a stone ring on a patch of dry grass. Logs char into glowing embers, then ash.',
    world: { size: [4, 2.2, 4], h: 0.05 },
    weather: w({ humidity: 0.4, windSpeed: 0.5 }),
    timeScale: 4,
    view: { camera: [2.6, 1.9, 2.6] },
    objects: [
      { type: 'grass', params: { width: 3.8, depth: 3.8, height: 0.1, density: 0.6, moisture: 0.12, clearRadius: 0.75 }, x: 2, z: 2 },
      { type: 'woodPile', params: { logs: 8, logLength: 0.6, logRadius: 0.05 }, x: 2, z: 2, ignite: true },
    ],
  },
  candle: {
    name: 'Candles',
    description: 'A paraffin and a beeswax candle. The wick draws molten wax up, the pool grows, wax drips and re-solidifies.',
    world: { size: [0.36, 0.28, 0.24], h: 0.008 },
    weather: w({ ambient: 20, humidity: 0.4 }),
    timeScale: 20,
    view: { camera: [0.18, 0.16, 0.3] },
    objects: [
      { type: 'candle', params: { height: 0.12, radius: 0.022 }, x: 0.11, z: 0.12, ignite: true },
      { type: 'candle', params: { height: 0.09, radius: 0.028, wax: 'beeswax', color: '#e0b04a' }, x: 0.25, z: 0.12, ignite: true },
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
  ship: {
    name: 'Ship: fire below the waterline',
    description: 'A ship section afloat. A fuel line in the lower-deck corridor (below the waterline) bursts after 30 s. Close the watertight and cabin doors to starve the fire of oxygen, or throw a grenade at the hull side in a cross corridor: the sea pours in and floods the corridors.',
    world: { size: [18, 7.2, 9.2], h: 0.2, ground: 'none' },
    weather: w({ ambient: 14, humidity: 0.75, windSpeed: 4 }),
    timeScale: 1,
    view: { camera: [-3, 10, 14] },
    objects: [{ type: 'shipSection', params: {}, x: 9, z: 4.5 }],
  },
  catacombs: {
    name: 'Catacombs',
    description: 'Vaulted limestone passages lit by torches on the walls, burial niches and chambers with coffins. People hide down here: they hear breaking glass and doors, avoid fire, and set old cloth and coffins alight to lure you in. Bring the bow (6) and fire arrows.',
    world: { size: [19, 4.2, 25], h: 0.2, ground: 'stone' },
    weather: w({ ambient: 12, humidity: 0.8 }),
    timeScale: 1,
    view: { dark: true, camera: [9.5, 14, -4] },
    objects: [
      { type: 'catacombs', params: {}, x: 9.5, z: 14.5 },
      { type: 'enemy', params: { count: 2, spread: 1.5 }, x: 9.5, z: 14.5 },
      { type: 'enemy', params: { count: 2, spread: 1.5, seed: 2 }, x: 14.5, z: 19.5 },
    ],
  },
  carrier: {
    name: 'Aircraft carrier: jet and server room',
    description: 'The flight deck of a carrier at sea with a jet fighter: walk up to it and press E to fly it (W/S throttle, mouse to pitch and roll, A/D rudder, Space or click for rockets, E to climb out once stopped on deck). The hatch next to the island (E) leads below deck: corridors, mess, berthing, a store room and a server room behind a locked glass door, where a rack catches fire after 25 s. Its inert-gas system floods the room when the ceiling gets hot, but only works if the door is shut. Only the deck you are on is simulated.',
    weather: w({ ambient: 16, humidity: 0.7, windSpeed: 8 }),
    timeScale: 1,
    startZone: 'deck',
    zones: {
      deck: {
        name: 'Flight deck',
        world: { size: [44, 19, 21], h: 0.4, ground: 'none' },
        view: { camera: [-14, 20, 30], walk: true },
        objects: [
          { type: 'carrierDeck', params: { length: 40, beam: 18, deckHeight: 7 }, x: 22, z: 10.5 },
          { type: 'jet', params: {}, x: 13, z: 13.5, y: 7, rotation: 0 },
        ],
      },
      below: {
        name: 'Below deck',
        world: { size: [32, 3.6, 17], h: 0.2 },
        view: { camera: [16, 14, -8], walk: true },
        objects: [
          { type: 'carrierBelow', params: {}, x: 16, z: 8.5 },
          { type: 'enemy', params: { count: 2, spread: 1, level: 0.2 }, x: 24, z: 8.5 },
          { type: 'enemy', params: { count: 2, spread: 1.5, level: 0.2, seed: 2 }, x: 8, z: 4.5 },
        ],
      },
    },
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
      { type: 'house', params: { width: 7, depth: 5, roofMaterial: 'wood shingles' }, x: 7, z: 6, ignite: true },
      { type: 'tree', params: { height: 5, crownRadius: 1.6 }, x: 12, z: 2.5 },
    ],
  },
};

export function cloneScene(s) {
  return JSON.parse(JSON.stringify(s));
}
