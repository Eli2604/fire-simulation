import { defaultWeather } from './sim/weather.js';
import { carrierObject } from './models/carrier.js';
import { liftPlaces } from './models/composite.js';
import { campIslandZone, CAMP_ISLAND_SEA, HQ_PLACE } from './campIsland.js';
import { fantasyWorld } from './fantasyWorld.js';
import { smithyScene, SMITHY_DESCRIPTION } from './smithyPlace.js';

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
 *
 * A world of places (places: true): zones side by side by their `origin`, each with a
 * `label`. Zoomed out each place shows as a labelled box (render/places.js), close up its
 * scenery; a click on its box makes it the simulated one, and so does the camera coming close
 * (in Play, not walking or flying) to a neighbour: a place of the same `group` as the one you are
 * in. A place inside or under another (below deck, the catacombs) has no origin but a schematic
 * `box` [x, y, z] (only for the overview). A zone may bring its own timeScale and weather (or
 * share another's: weatherOf), and say where it is (exposure: sim/weather.js).
 */
const w = (o = {}) => ({ ...defaultWeather(), ...o });

/**
 * Old scenario keys that are now a place in a world: ?scenario=laundry opens the carrier's world
 * at the garden by the lake house (its washing line), ?scenario=catacombs the Fantasy world under
 * the church on the dragon island, ?scenario=foggyForest its forest in the fog valley.
 * weather: what the place starts in instead of its own (winterTea: the lake frozen over).
 */
export const SCENARIO_ALIASES = {
  teaGarden: { scenario: 'carrier', zone: 'lake' },
  laundry: { scenario: 'carrier', zone: 'garden' },
  winterTea: { scenario: 'carrier', zone: 'lake', weather: 'LAKESIDE_WINTER' },
  grassFire: { scenario: 'carrier', zone: 'meadow' },
  threeTrees: { scenario: 'carrier', zone: 'trees' },
  // (the dragon island, its catacombs and the forest in fog: places of the Fantasy world, src/fantasyWorld.js)
  catacombs: { scenario: 'fantasy', zone: 'catacombs' },
  foggyForest: { scenario: 'fantasy', zone: 'forest' },
  campIsland: { scenario: 'carrier', zone: 'camp' },
  carHouse: { scenario: 'carrier', zone: 'carHouse' },
  neighbourhood: { scenario: 'carrier', zone: 'dryGarden' },
  // (a house fire in the rain: the lake house in steady rain, light a fire in it; the car fire's
  // fuel tank: the street's car with a steel tank and a blocked vent, both its parameters)
  rainyHouse: { scenario: 'carrier', zone: 'lake', weather: 'LAKESIDE_RAIN' },
  tankRupture: { scenario: 'carrier', zone: 'carHouse' },
  // (the hallway with sprinklers: the corridor inside the headquarters of the military base on the
  // camp island, a place of its own: src/campIsland.js, models/militaryBase.js)
  hallwaySprinklers: { scenario: 'carrier', zone: HQ_PLACE },
  // (the gas cylinders in a bonfire: gas cylinders are objects now, sim/vessels.js; a rack of them
  // in the store room below deck in the carrier, off the main passageway whose gas line bursts and
  // burns; the office hallway's gas pipe burst: that passageway, its sprinklers)
  gasCylinders: { scenario: 'carrier', zone: 'below' },
  hallway: { scenario: 'carrier', zone: 'below' },
};

/** A scenario key (old or new) as { scenario, zone, weather? } (zone: null for the scenario's start). */
export function resolveScenario(key) {
  if (SCENARIO_ALIASES[key]) return { ...SCENARIO_ALIASES[key] };
  return SCENARIOS[key] ? { scenario: key, zone: null } : null;
}

/**
 * The scene a scenario key opens (a copy, to edit): an old key that is now a place of a world
 * opens that world starting in that place (in the weather the old scene had). null: unknown.
 */
export function openScenario(key) {
  const r = resolveScenario(key);
  if (!r) return null;
  const sc = cloneScene(SCENARIOS[r.scenario]);
  if (r.zone && sc.zones?.[r.zone]) {
    sc.startZone = r.zone;
    if (r.weather) {
      const zd = sc.zones[r.zone];
      const src = sc.zones[zd.weatherOf] ?? zd; // (the place whose weather it shares)
      src.weather = { ...(src.weather ?? {}), ...WEATHERS[r.weather] };
    }
  }
  return sc;
}

/** One zone of a zoned scene as a scene of its own (tests, headless runs). */
export function zoneScene(scene, zone) {
  const zd = scene.zones[zone];
  const own = zd.weather ?? scene.zones[zd.weatherOf]?.weather;
  return { name: `${scene.name} – ${zd.name}`, world: zd.world, weather: { ...(scene.weather ?? {}), ...(own ?? {}) }, timeScale: zd.timeScale ?? scene.timeScale, view: zd.view ?? scene.view, indoor: zd.indoor, exposure: zd.exposure, objects: zd.objects };
}

/**
 * Where a place of a world sits in the world frame: its `origin` (it is there: the jet, the
 * boats and the stand-ins go by it), else its `box` (a schematic spot for the overview only:
 * below deck inside the hull, the catacombs under the church). null: nowhere.
 */
export function placeOrigin(zd) {
  return zd?.origin ?? zd?.box ?? null;
}

/**
 * The places of a world (zones with an origin, or a schematic box) as boxes:
 * { name, label, min, max, schematic } in world metres.
 */
export function placeBoxes(scene) {
  if (!scene.zones) return [];
  return Object.entries(scene.zones)
    .filter(([, z]) => placeOrigin(z))
    .map(([name, z]) => {
      const o = placeOrigin(z);
      return { name, label: z.label ?? z.name, min: o.slice(), max: o.map((v, k) => v + z.world.size[k]), schematic: !z.origin };
    });
}

/**
 * Tea by the lake: a small island with a lake in it, a veranda on its shore looking out over
 * the water, a couch under it with a plaid, a side table with a book, a candle and a hot cup of
 * tea. The lake house's own weather: a mild, sunny early-autumn afternoon (the wash on the line
 * in its garden nearly dry, the lake open); LAKESIDE_WINTER its cold snap (the lake frozen over,
 * the tea steaming in the frost: Weather › Presets, or ?scenario=winterTea).
 * (boats: where they go; '' none)
 */
export const LAKESIDE_AUTUMN = { ambient: 19, humidity: 0.45, windSpeed: 2.5, windDir: 20, rain: 0, fog: 0, sunshine: 0.8, season: 'autumn', snowCover: 0, iceCover: 0 };
export const LAKESIDE_WINTER = { ambient: -4, humidity: 0.85, windSpeed: 1.5, windDir: 60, rain: 0.5, fog: 0.05, sunshine: 0.35, season: 'winter', snowCover: 0.12, iceCover: 0.1 };
/** Named weathers an old scenario key can start a place in. */
/** Steady rain at the lake house (the old House fire in the rain): Weather › Presets › Rain. */
export const LAKESIDE_RAIN = { ...LAKESIDE_AUTUMN, ambient: 10, humidity: 0.9, windSpeed: 1, rain: 15, fog: 0, sunshine: 0.2 };
export const WEATHERS = { LAKESIDE_AUTUMN, LAKESIDE_WINTER, LAKESIDE_RAIN };
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

/**
 * The street by the lake house (places of the carrier's world, in the lake house's group):
 *  carHouse   a car parked by a wooden house: an engine fire spreads to the cabin, the tyres and
 *             the fuel tank; the burning car radiates onto the house (sim/farRadiation.js): its
 *             windows crack and fall out, the curtains and the room behind catch, the fascia,
 *             the gutter and the shingles go up (the old Car fire next to a house)
 *  dryGarden  a brick house with a furnished living room, a car in the drive, trees, a conifer
 *             hedge, a woodpile and a fence on a hot dry day; the fire starts on the sofa (the
 *             old Garden on a dry day)
 * Each keeps the old scene's weather and time scale. (Their lawns level with the garden's and
 * the meadow's, a quarter of a metre above the lake.)
 */
function streetPlaces() {
  const water = { color: '#2c5d78' };
  return {
    carHouse: {
      name: 'Street: car fire next to a house',
      label: 'Car fire by a house',
      group: 'lake',
      origin: [284, 2.9, 172],
      world: { size: [14, 8, 11], h: 0.15 },
      view: { camera: [8, 7, 11], around: { y: -0.1, ...water } },
      proxy: { sea: 0, color: '#7a8a5a', height: 3.5, fill: 0.5, cell: 0.2 },
      timeScale: 10,
      weather: w({ windSpeed: 1.5, windDir: 90 }),
      objects: [
        { type: 'house', params: { width: 7, depth: 5, wallMaterial: 'wood', roofMaterial: 'wood shingles' }, x: 7, z: 7.5 },
        { type: 'car', params: { bodyColor: '#a8322f' }, x: 6.5, z: 2.6, ignite: true },
        { type: 'tree', params: { height: 5, crownRadius: 1.5 }, x: 12, z: 3 },
      ],
    },
    dryGarden: {
      name: 'Street: garden on a dry day',
      label: 'Garden on a dry day',
      group: 'lake',
      origin: [272, 2.85, 150],
      world: { size: [22, 9, 18], h: 0.2 },
      view: { camera: [-6, 12, 20], around: { y: -0.05, ...water } },
      proxy: { sea: 0, color: '#8a9a4a', height: 3, fill: 0.6, cell: 0.2 },
      timeScale: 10,
      weather: w({ windSpeed: 2, windDir: 30, humidity: 0.3, ambient: 25 }),
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
        // a conifer hedge along the east side of the garden, dried out in the dry spell
        { type: 'hedge', params: { kind: 'conifer', length: 10, height: 1.8, thickness: 0.8, dryness: 0.6 }, x: 21, z: 9, rotation: 90 },
      ],
    },
  };
}

export const SCENARIOS = {
  // (the old "Metal bars on burners": the bars are now on the test hearth of a smithy)
  // (one definition with the smithy in the Fantasy world's harbour village: src/smithyPlace.js)
  // TODO(smith-voxel): once the rewritten smithy is on main, this becomes an alias to the fantasy
  // world's smithy place (SCENARIO_ALIASES.metalBars → { scenario: 'fantasy', zone: 'smithy' })
  metalBars: {
    name: 'Smithy: forging a blade',
    description: SMITHY_DESCRIPTION,
    ...smithyScene(),
  },
  // (the old Forest fire in fog is the forest in the fog valley of the Fantasy world: ?scenario=foggyForest)
  // the dragon isle in a sea of its own: the dragon island (church, catacombs, volcano,
  // waterfall), the harbour village and its smithy, the castle and the forest in the fog valley
  fantasy: fantasyWorld(),
  carrier: {
    name: 'Carrier, islands and a spaceship',
    description: 'The flight deck of a carrier at sea with a jet fighter: walk up to it and press E to fly it (W/S throttle, mouse to pitch and roll, A/D rudder, Space or click for rockets, E to climb out once stopped on deck). The hatch next to the island (E) leads below deck: corridors, mess, berthing, a store room and a server room behind a locked glass door, where a rack catches fire after 25 s. A ladder at its forward end leads down to the lower decks below the waterline: after 30 s a fuel line bursts against the hull there, the vapour explodes and tears the plating open, and the sea pours in, filling the lower deck from the bottom up (close the watertight doors; under water you breathe from your mask) while the ship settles and lists. Its inert-gas system floods the room when the ceiling gets hot, but only works if the door is shut. Take the boat from the stern to the islet out on the reef (a campfire on dry grass), or fly there. Rockets hit whatever they reach and the jet can be damaged by blasts, flames and scrapes; X ejects. Hold B to boost: climb out of the atmosphere and dock (slowly) at the spaceship in orbit, 2.4 km up. Its hull holds the air: breach it with a grenade or a rocket, or open the outer airlock door, and the ship decompresses. From the islet a boat goes on to the lake house on a small island, on a mild early-autumn afternoon of its own: tea on a veranda by its lake (a cold snap freezes the lake over: Weather › Presets › Cold snap); on the shore beside it its garden, where the wash on the line catches from a spark of the barbecue half a minute in and burns away (15× time), and a meadow of dry grass lit on its upwind edge, the wind driving the fire towards trees and a fence (3× time), and east of it a grass fire running under an oak, a weeping willow and a pine (4× time): the pine goes up in a crown fire, the willow drops burning branches, the limbs of the oak burn where they are. Along the street beyond them a car parked by a wooden house catches fire in its engine bay: as the whole car burns, its heat cracks the windows of the house, the curtains behind them catch, and the fascia, the gutter and the shingles go up (10× time); and in the garden on a dry day next door a fire starts on the sofa of a brick house with a car in the drive, trees, a dried-out conifer hedge, a woodpile and a fence (10× time). South-west of the ship lies the camp island, a military base: inside its blast walls, past the guard post at the gate, a drone camp powered by a solar park and a wind turbine, a squad on its round about it, barracks, a helicopter parked on its helipad (fly it: E), a vehicle park and the headquarters, whose door (E) leads into its office corridor: there the gas pipe in the ceiling bursts after 20 s and the glass-bulb sprinklers go off one by one at 68 °C, cooling the smoke and wetting everything; take the extinguisher or the hose reel off the wall (E) and close the office doors. Deploy on the landing ground behind the ridge, out of sight of the guards. Zoomed out, every place shows as a labelled box (Edit world too): click one to go there. Only the place you are in is simulated; the others are built the first time you get there and frozen while you are away.',
    // a late-summer morning, 09:48 on 28 August at 51.5° N (sim/sky.js): the sun from the south-east,
    // 40° up (the island's old fixed sun, view.sun below: within half a degree)
    weather: w({ ambient: 16, humidity: 0.7, windSpeed: 8, day: 240, time: 9.8 }),
    timeScale: 1,
    startZone: 'deck',
    // a world of places: zoomed out each place is a labelled box (also the ones inside or under
    // another, at their schematic `box`); a click on one goes there. Only places of one `group`
    // (the lake house's) take over as the camera comes close: the others by hatch, boat or jet
    places: true,
    // the island group round the ship (drawn: models/archipelago.js): a large high island, a long
    // one, volcanic cones, islets, a sand cay, a sunken reef ring, each with its fringing reef and
    // lagoon; the simulated islands each on a shelf of its own (the dragon island is in the Fantasy world now)
    archipelago: {
      seed: 7,
      extent: 2600,
      zones: [
        { box: [310.5, -404.5, 319.5, -396.5], floor: -1.6 }, // the islet's
        { box: [241, 151, 261, 168], floor: -1.6 }, // the lake island's
        CAMP_ISLAND_SEA, // the camp island's (src/campIsland.js)
      ],
      // the carrier lies at anchor over a sandy bank, ~12 m down under and round the ship (its
      // keel ~4 m down: the bottom is seen through the clear water beside it)
      banks: [{ box: [-200, -24, 92, 56], floor: -12 }],
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
          // the carrier: one object (models/carrier.js), its jets, deck equipment and the flight
          // overhead objects in it, and its places below deck (below deck, the lower decks under it:
          // zones of this world, models/composite.js)
          carrierObject({ x: 106, z: 26, params: { length: 210, beam: 48, deckHeight: 11, draft: 4, helipads: 3, boatTo: 'islet', boatLabel: 'Boat ladder: to the islet' } }),
        ],
      },
      // below deck and the lower decks are places in the carrier (lifted into zones below:
      // liftPlaces; their schematic boxes where they lie in its hull)
      // a small islet out on the reef: a log-cabin campfire in a stone ring on dry grass
      // (the old Campfire scene), a boat back to the ship and one on to the lake island
      islet: {
        name: 'Islet with a campfire',
        origin: [310, 0.32, -405], // (its voxels are finer than the island's: this puts its sea level with theirs)
        world: { size: [10, 4.5, 9], h: 0.08, ground: 'none' },
        view: { camera: [12, 5, 12], walk: true },
        proxy: { shape: 'hill', color: '#7a8a4a', height: 2, fill: 0.8, sea: 2.9 },
        weather: { humidity: 0.4, windSpeed: 0.5 },
        objects: [
          { type: 'island', params: { width: 9, depth: 8, seaLevel: 2.5, hill: 0.6, plateau: 0.35, plateauEast: 0.7, canal: false, pond: false, pierLength: 3, catacombs: '', boatTo: 'deck', boatLabel: 'Boat: back to the ship', ferryTo: 'lake', ferryLabel: 'Boat: to the lake island', hut: false, seed: 9 }, x: 5, z: 4.5 },
          { type: 'grass', params: { width: 3.6, depth: 3.2, height: 0.16, density: 0.6, moisture: 0.12, clearRadius: 0.8 }, x: 4.6, z: 5.4, y: 'auto' },
          { type: 'woodPile', params: { logs: 8, logLength: 0.8, logRadius: 0.08 }, x: 4.6, z: 5.4, y: 'auto', ignite: true },
        ],
      },
      // the lake house: a small island with a lake in it, tea on a veranda by the water (the old
      // Tea by the lake), and beside it on the shore its garden (washing line and barbecue: the
      // old Laundry on the line) and a meadow (the old Wind-driven grass fire). Places of one
      // group (neighbours: in Play the camera coming close to one makes it the one that runs),
      // in the lake house's own weather: a mild early-autumn afternoon (winter: Weather › Presets › Cold snap)
      lake: {
        name: 'Lake island: tea on the veranda',
        label: 'Lake house: tea on the veranda',
        group: 'lake',
        origin: [240, 1.8, 150], // (its sea level with the others')
        world: { size: [22, 7, 19], h: 0.1, ground: 'none' },
        view: { camera: [2.5, 1.5, -8.5], walk: true },
        proxy: { shape: 'hill', color: '#6f8f4a', height: 1.5, fill: 0.85, sea: 2.9 },
        timeScale: 1,
        weather: LAKESIDE_AUTUMN,
        objects: lakesideObjects({ boatTo: 'deck', boatLabel: 'Boat: to the ship', ferryTo: 'islet', ferryLabel: 'Boat: back to the islet' }),
      },
      // the lawn on the shore east of the lake island, a little above the water (5 cm voxels: the
      // cloth). The wash has hung on the line since lunch; the barbecue is going; half a minute in
      // a spark from it lands at the foot of the sheet and the fire runs along the line
      garden: {
        name: 'Garden: washing line and barbecue',
        label: 'Washing line & barbecue',
        group: 'lake',
        origin: [263, 3.0, 159], // (its lawn a quarter of a metre above the water)
        world: { size: [7, 3, 5], h: 0.05, ground: 'soil' },
        view: { camera: [1.2, 2.4, 6.4], walk: true, around: { y: -0.2, color: '#2c5d78' } }, // (the water round it, at the lake island's sea level)
        proxy: { sea: 0, color: '#5f8f3a', height: 0.1, fill: 1, cell: 0.1 },
        timeScale: 15,
        weatherOf: 'lake', // (the lake house's weather: set it on either)
        objects: [
          // a green, watered lawn (live grass is too wet to carry a fire; it scorches under what falls)
          { type: 'grass', params: { width: 6.8, depth: 4.8, height: 0.05, density: 0.45, moisture: 2.0, clearRadius: 0 }, x: 3.5, z: 2.5 },
          // (nearly dry after a few hours on the line; a spark from the barbecue lands at the foot of the sheet after half a minute)
          { type: 'clothesline', params: { length: 5, height: 1.9, wet: 0.2, sparkAfter: 30 }, x: 3.5, z: 2.6 },
          // the barbecue on the lawn, burning (its sparks)
          { type: 'woodPile', params: { arrangement: 'teepee', logs: 5, logLength: 0.35, logRadius: 0.035, moisture: 0.08, stones: true }, x: 2.0, z: 1.4, ignite: true },
          // a garden bench, a jerrycan by the barbecue (models/scannedProp.js)
          { type: 'scannedProp', params: { asset: 'bench' }, x: 5.5, z: 4.2, rotation: 15 },
          { type: 'scannedProp', params: { asset: 'jerrycan' }, x: 1.1, z: 3.7, rotation: 30 },
        ],
      },
      // the meadow on the shore south of the lake island: dry grass lit on its upwind edge, the wind pushing the flames
      // on towards trees and a fence (the old Wind-driven grass fire, its field and its weather:
      // a hot, dry, windy spell of its own)
      meadow: {
        name: 'Meadow by the lake house: a wind-driven grass fire',
        label: 'Meadow: grass fire',
        group: 'lake',
        origin: [258, 2.85, 170.5], // (south of the lake island, its ground level with the garden's lawn)
        world: { size: [24, 9, 14], h: 0.2 },
        view: { camera: [-10, 9, 16], around: { y: -0.05, color: '#2c5d78' } },
        proxy: { sea: 0, color: '#b8a55a', height: 0.6, fill: 1, cell: 0.2 },
        timeScale: 3,
        weather: { ...LAKESIDE_AUTUMN, ambient: 28, humidity: 0.25, windSpeed: 4, windDir: 0, sunshine: 1 },
        objects: [
          { type: 'grass', params: { width: 23, depth: 13, height: 0.4, density: 0.85, moisture: 0.07 }, x: 12, z: 7 },
          { type: 'grass', params: { width: 2, depth: 2, height: 0.05, density: 1, moisture: 0.07 }, x: 1.5, z: 7, ignite: true },
          { type: 'tree', params: { species: 'pine', height: 6, crownRadius: 1.6, foliageMoisture: 0.8 }, x: 15, z: 5 },
          { type: 'tree', params: { species: 'willow', height: 6, crownRadius: 2.2, seed: 3 }, x: 17, z: 9.5 },
          { type: 'fence', params: { length: 8 }, x: 20, z: 7, rotation: 90 },
        ],
      },
      // the street on the shore east of the lake house: a car parked in a drive burning next to
      // a wooden house (the old Car fire next to a house, ?scenario=carHouse), and a garden on a
      // dry day where the fire starts on the sofa of a brick house (the old Garden on a dry day,
      // ?scenario=neighbourhood). Each keeps its own weather and time scale.
      ...streetPlaces(),
      // east of the meadow, a field of dry grass under an oak, a weeping willow and a pine (the
      // old Oak, willow and pine in a grass fire: its field, its trees, its weather, its 4x time).
      // The grass is lit on its upwind (west) edge; the wind drives the fire under the trees. Each
      // tree is an object of its kind (models/treeObjects.js) and burns as its kind does: the
      // pine's dead lower branches and resinous needles take the fire up into its crown, the
      // willow's charred branches snap and drop burning, the oak's heavy limbs burn where they are
      trees: {
        name: 'Oak, willow and pine in a grass fire',
        label: 'Oak, willow & pine: grass fire',
        group: 'lake',
        origin: [283, 2.85, 185], // (east of the meadow, south of the street's car fire; its ground level with the meadow's)
        world: { size: [22, 11, 12], h: 0.2 },
        view: { camera: [-6, 8, 18], around: { y: -0.05, color: '#2c5d78' } },
        proxy: { sea: 0, color: '#a99a52', height: 0.6, fill: 1, cell: 0.2 },
        timeScale: 4,
        weather: { ...LAKESIDE_AUTUMN, ambient: 30, humidity: 0.25, windSpeed: 3, windDir: 0, sunshine: 1 },
        objects: [
          { type: 'grass', params: { width: 21.5, depth: 11.5, height: 0.4, density: 0.85, moisture: 0.06 }, x: 11, z: 6 },
          { type: 'grass', params: { width: 1.5, depth: 1.5, height: 0.05, density: 1, moisture: 0.06 }, x: 1.2, z: 6, ignite: true },
          { type: 'oakTree', params: { height: 8, crownRadius: 3, seed: 1 }, x: 8, z: 6 },
          { type: 'willowTree', params: { height: 7, crownRadius: 2.6, seed: 2 }, x: 13.5, z: 6 },
          { type: 'pineTree', params: { height: 9, crownRadius: 2.2, seed: 3 }, x: 18.5, z: 6 },
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
      // the camp island: a military base (blast walls, a gate with a guard post, the headquarters with
      // its corridor with sprinklers as a place inside, barracks, a helipad, a vehicle park) round the
      // drone camp, its solar park and wind turbine and a squad on its round; a ridge, and behind it
      // the landing ground where you are put down (src/campIsland.js)
      camp: campIslandZone(),
    },
  },
  squadRange: {
    name: 'Squad on a range: bounding overwatch',
    description: 'A fire team of sculpted, rigged soldiers (a commander, a gunner and two riflemen) advances on a threat across a desert range by bounding overwatch: one team runs or walks with rifles up to cover behind the brick walls and wooden crates while the other covers it, crouched and firing bursts (real rounds: tracers and holes in the walls), then the commander signals and they swap. On first contact, when the threat moves and when a man is down, the radio man of each team calls it in on the radio on his chest and the other team (Bravo, on the left flank) answers. The second rifleman of Bravo is a flame trooper: close to the threat he stands up and fires his flame gun (it sets the crates alight); he cannot fire it crouched. Everyone carries a compact carbine on his back. The drone operator of Alpha stays back: on contact he takes his backpack off, kneels, takes a quadcopter out, sets it down, pulls his goggles on and flies it over the threat. A rifleman throws hand grenades at the threat (the same grenades and blasts as the grenade tool). West of the walls stands a lookout: a concrete deck 3 m up on pillars with a staircase and glass rails; the gunners climb the stairs and take it as overwatch (from up there they see over the walls), and come down by the stairs when the team moves on. Throw your own grenades at them, place walls and crates (Place new object) or move the threat (tool: Squad: set the threat). The rig test page (Soldier rig test) has every animation, the hit areas and the gear on its own.',
    world: { size: [36, 5, 36], h: 0.2, ground: 'quarrySand' },
    weather: w({ ambient: 31, humidity: 0.2, windSpeed: 2 }),
    timeScale: 1,
    view: { camera: [14, 16, 26] },
    objects: [
      ...[['wall', 14.5, 23.5, 0], ['crate', 20.6, 24.2, 0], ['crate', 21.7, 24.2, 0], ['wall', 22.6, 19.5, 90], ['crate', 16.8, 19.6, 0], ['wall', 13, 16.5, 90], ['wall', 16.5, 14.4, 0],
        ['crate', 21.2, 13.8, 0], ['wall', 23.4, 10.6, 0], ['crate', 14.4, 10.2, 0], ['crate', 18.6, 9.4, 0]].map(([type, x, z, rotation]) => ({ type, params: {}, x, z, rotation })),
      // a lookout west of the walls: a deck 3 m up, its stairs coming down towards the teams
      { type: 'deck', params: {}, x: 4.5, z: 18 },
      // parkour: low walls across the way in (a 0.9 m one to vault, a 0.6 m one to step over, a
      // gap between them) and a raised concrete block 1.6 m high between the teams (climbed onto, jumped off)
      { type: 'wall', params: { length: 8, height: 0.9, thickness: 0.3 }, x: 18, z: 26.6 },
      { type: 'wall', params: { length: 4, height: 0.6, thickness: 0.3 }, x: 11, z: 26.6 },
      { type: 'wall', params: { length: 4, height: 1.6, thickness: 1, material: 'concrete' }, x: 11, z: 21.5 },
      { type: 'wall', params: { length: 4, height: 1.6, thickness: 1, material: 'concrete' }, x: 11, z: 22.5 },
      { type: 'squad', params: { unit: 'Alpha', threatX: 0, threatZ: -21, droneOperator: true }, x: 18, z: 29 },
      // a second team on the left flank: the two talk on the radio
      { type: 'squad', params: { unit: 'Bravo', threatX: 12, threatZ: -21, flameTrooper: true }, x: 6, z: 29 },
    ],
  },
  squadClash: {
    name: 'Squad against squad: two blue teams meet a red one',
    description: "Teams of two sides on a long desert range (the squad's Side param: blue fight on your side, red against you and the blue teams). Two blue fire teams, Alpha and Bravo, come down from the north; a red team, Charlie, comes up from the south. They make each other out across the range (sight, the dark, smoke and walls as ever: ai/perception.js), each team going for the nearest enemy it has seen, each man firing at the nearest he sees, with bounding overwatch between the brick walls and crates. Nobody fires at his own side, and the blue teams never at you. The red team is outnumbered two to one: its leader counts every enemy his men have seen (and the blue leaders count the teams beside them as their strength), seeing two to one he breaks contact at once, and once rounds crack past his men (pinned down) or he loses men, he calls the retreat: the word passed round, man by man back to the rally point under covering fire (ai/retreat.js). Walk in (you are blue) and help, or change a team's side in the editor.",
    world: { size: [40, 5, 80], h: 0.2, ground: 'quarrySand' },
    weather: w({ ambient: 27, humidity: 0.25, windSpeed: 1.5 }),
    timeScale: 1,
    view: { camera: [42, 30, 40] },
    objects: [
      ...[['wall', 12, 56, 0], ['wall', 28, 56, 0], ['crate', 20, 52, 0], ['wall', 8, 46, 90], ['wall', 32, 46, 90], ['wall', 20, 42, 0], ['crate', 15, 38, 0], ['crate', 25, 38, 0],
        ['wall', 12, 28, 0], ['wall', 28, 28, 0], ['crate', 20, 24, 0], ['wall', 20, 18, 0]].map(([type, x, z, rotation]) => ({ type, params: {}, x, z, rotation })),
      // blue: yours, from the north (each first towards the middle of the range: in a fight, the nearest enemy)
      { type: 'squad', params: { unit: 'Alpha', side: 'blue', threatX: 6, threatZ: -40 }, x: 13, z: 72 },
      { type: 'squad', params: { unit: 'Bravo', side: 'blue', threatX: -6, threatZ: -40 }, x: 27, z: 72 },
      // red: from the south, one team against two (veterans)
      { type: 'squad', params: { unit: 'Charlie', side: 'red', skill: 'veteran', threatX: 0, threatZ: 40 }, x: 20, z: 6 },
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
};

// the places in objects (below deck in the carrier) as zones of their scenes
for (const sc of Object.values(SCENARIOS)) liftPlaces(sc);

/** A copy of a scene to edit (its places in objects zones again: models/composite.js). */
export function cloneScene(s) {
  return liftPlaces(JSON.parse(JSON.stringify(s)));
}
