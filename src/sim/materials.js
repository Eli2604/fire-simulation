/**
 * Material database.
 *
 * All values are SI unless noted (temperatures in °C). Values are representative
 * engineering numbers, not exact for any one product; they are meant to give the
 * simulation the right *relative* behaviour (wood vs. steel vs. grass ...).
 *
 *  density          kg/m³ (bulk density of the voxel: a grass voxel is mostly air)
 *  specificHeat     J/(kg·K)
 *  conductivity     W/(m·K)
 *  emissivity       0..1
 *  surfaceFactor    exposed area multiplier for heat exchange (thin blades, needles,
 *                   leaves have far more surface than a cube face suggests)
 *  combustible      burns when hot enough and exposed to air
 *  ignitionTemp     °C, piloted ignition temperature
 *  pyrolysisTemp    °C, starts to smoke / smoulder (before ignition)
 *  heatOfCombustion J/kg
 *  burnRate         kg/(m²·s) per exposed face at full burning
 *  selfHeating      fraction of released heat fed back into the burning voxel
 *  residue          mass fraction left after burning
 *  residueMaterial  material the voxel turns into after burning (default 'ash')
 *  extinctionMoisture kg water / kg dry above which the material will not burn
 *  smokeYield       kg smoke per kg fuel burned
 *  smokeColor       rgb 0..1 of the smoke particulate
 *  meltingPoint     °C (Infinity = does not melt)
 *  latentHeat       J/kg heat of fusion
 *  fluidity         0..1 how readily the liquid flows (1 = water-like)
 *  granular         falls/piles like sand instead of being structural (ash)
 *  moisture         default moisture content kg water / kg dry material
 *  maxMoisture      how much water the material can hold (rain, hoses)
 *  deadFuel         moisture equilibrates with air humidity (cut grass, firewood)
 *  timeLag          s, time constant for that moisture equilibration
 *  shatterTemp      °C, glass breaks when this hot (thermal shock)
 *  oxidizeTemp      °C, metals/paint darken above this temperature
 *  wicks            name of the material a wick draws as fuel (candle)
 */

const DEFAULTS = {
  color: [1, 0, 1],
  density: 1000,
  specificHeat: 1000,
  conductivity: 1,
  emissivity: 0.9,
  surfaceFactor: 1,
  combustible: false,
  ignitionTemp: Infinity,
  pyrolysisTemp: Infinity,
  heatOfCombustion: 0,
  burnRate: 0,
  selfHeating: 0.3,
  residue: 0,
  residueMaterial: 'ash',
  extinctionMoisture: 0.35,
  smokeYield: 0,
  smokeColor: [0.3, 0.3, 0.3],
  smolderColor: [0.82, 0.82, 0.8],
  meltingPoint: Infinity,
  latentHeat: 0,
  fluidity: 0,
  granular: false,
  moisture: 0,
  maxMoisture: 0.001,
  deadFuel: false,
  timeLag: 3600,
  shatterTemp: Infinity,
  failTemp: Infinity, // °C: loses its strength / binder and breaks away (fire resistance breakdown)
  spalling: false, // damp concrete: surface pieces burst off when heated quickly
  brittle: false, // cracks from thermal shock when cold water hits it hot
  charFail: Infinity, // 0..1: charred this far the part breaks off (burning branches dropping)
  wetFail: Infinity, // kg/kg: soaked this much it goes soft and falls (plasterboard, ceiling tiles)
  oxidizeTemp: Infinity,
  wicks: null,
  wickRate: 0,
  burnTime: 0, // s: fine fuels burn out in a fixed residence time (resolution independent)
  maxBurnTemp: 950,
  charColor: [0.06, 0.05, 0.045],
  liquidColor: null,
  pattern: null, // texture drawn on the voxels ('limestone', 'ossuary', ...; see render/patterns.js)
  photo: null, // a photographed texture drawn on the voxels ('grass', 'sand', ...; render/patterns.js PHOTOS)
  vapor: null, // liquid fuels: { refP Pa at refT °C, B (K, Clausius–Clapeyron), Tb boiling °C, Lv J/kg, beta thermal expansion 1/K }
};

const DEFS = {
  soil: {
    label: 'Soil', color: [0.36, 0.29, 0.2], density: 1500, specificHeat: 1000, conductivity: 0.8,
    moisture: 0.15, maxMoisture: 0.35, oxidizeTemp: 300,
  },
  wood: {
    label: 'Wood (pine)', color: [0.55, 0.38, 0.22], density: 500, specificHeat: 1700, conductivity: 0.12,
    combustible: true, ignitionTemp: 300, pyrolysisTemp: 220, heatOfCombustion: 17e6, burnRate: 0.003,
    selfHeating: 0.32, residue: 0.22, residueMaterial: 'charcoal', smokeYield: 0.015,
    smokeColor: [0.36, 0.34, 0.32], moisture: 0.12, maxMoisture: 0.8, deadFuel: true, timeLag: 36000,
    extinctionMoisture: 0.4,
  },
  bark: {
    label: 'Living wood', color: [0.33, 0.24, 0.16], density: 600, specificHeat: 1800, conductivity: 0.15,
    combustible: true, ignitionTemp: 320, pyrolysisTemp: 230, heatOfCombustion: 17e6, burnRate: 0.003,
    selfHeating: 0.3, residue: 0.22, residueMaterial: 'charcoal', smokeYield: 0.02,
    smokeColor: [0.4, 0.38, 0.36], moisture: 0.5, maxMoisture: 1.0, extinctionMoisture: 0.9,
  },
  oak: {
    // dense hardwood: branches mostly burn in place
    label: 'Oak wood (living)', color: [0.36, 0.27, 0.19], density: 750, specificHeat: 1800, conductivity: 0.17,
    combustible: true, ignitionTemp: 330, pyrolysisTemp: 240, heatOfCombustion: 18e6, burnRate: 0.003,
    selfHeating: 0.3, residue: 0.22, residueMaterial: 'charcoal', smokeYield: 0.015, smokeColor: [0.38, 0.36, 0.34],
    moisture: 0.45, maxMoisture: 1.0, extinctionMoisture: 0.9, charFail: 0.92,
  },
  willow: {
    // soft, brittle wood: charred branches snap and drop
    label: 'Willow wood (living)', color: [0.42, 0.36, 0.26], density: 420, specificHeat: 1800, conductivity: 0.12,
    combustible: true, ignitionTemp: 300, pyrolysisTemp: 220, heatOfCombustion: 17e6, burnRate: 0.004,
    selfHeating: 0.3, residue: 0.2, residueMaterial: 'charcoal', smokeYield: 0.018, smokeColor: [0.42, 0.4, 0.37],
    moisture: 0.6, maxMoisture: 1.2, extinctionMoisture: 1.0, charFail: 0.45,
  },
  pine: {
    // resinous softwood: burns hot and sooty
    label: 'Pine wood (living)', color: [0.4, 0.28, 0.18], density: 520, specificHeat: 1700, conductivity: 0.13,
    combustible: true, ignitionTemp: 290, pyrolysisTemp: 210, heatOfCombustion: 20e6, burnRate: 0.004,
    selfHeating: 0.32, residue: 0.2, residueMaterial: 'charcoal', smokeYield: 0.03, smokeColor: [0.22, 0.21, 0.2],
    moisture: 0.45, maxMoisture: 1.0, extinctionMoisture: 0.9, charFail: 0.7,
  },
  deadWood: {
    // dead, dry branches (the self-pruned lower whorls of a pine): catch easily and drop
    label: 'Dead branches', color: [0.5, 0.42, 0.32], density: 380, specificHeat: 1600, conductivity: 0.1,
    combustible: true, ignitionTemp: 270, pyrolysisTemp: 200, heatOfCombustion: 18e6, burnRate: 0.006,
    selfHeating: 0.3, residue: 0.15, smokeYield: 0.015, smokeColor: [0.4, 0.38, 0.35],
    moisture: 0.1, maxMoisture: 0.8, deadFuel: true, timeLag: 3600, charFail: 0.35,
  },
  twigs: {
    label: 'Kindling', color: [0.62, 0.48, 0.3], density: 25, burnTime: 60, specificHeat: 1600, conductivity: 0.06,
    surfaceFactor: 5, combustible: true, ignitionTemp: 260, pyrolysisTemp: 200, heatOfCombustion: 17e6,
    burnRate: 0.03, selfHeating: 0.3, residue: 0.05, smokeYield: 0.012, smokeColor: [0.45, 0.43, 0.4],
    moisture: 0.06, maxMoisture: 1.0, deadFuel: true, timeLag: 1800,
  },
  leaves: {
    label: 'Leaves', color: [0.24, 0.45, 0.16], density: 3, burnTime: 15, specificHeat: 1800, conductivity: 0.05,
    surfaceFactor: 7, combustible: true, ignitionTemp: 260, pyrolysisTemp: 200, heatOfCombustion: 18e6,
    burnRate: 0.03, selfHeating: 0.25, residue: 0.04, smokeYield: 0.025, smokeColor: [0.6, 0.6, 0.57],
    smolderColor: [0.9, 0.9, 0.88], moisture: 1.0, maxMoisture: 2.5, extinctionMoisture: 1.6,
    charColor: [0.12, 0.1, 0.06],
  },
  needles: {
    label: 'Pine needles', color: [0.13, 0.32, 0.14], density: 4, burnTime: 12, specificHeat: 1800, conductivity: 0.05,
    surfaceFactor: 9, combustible: true, ignitionTemp: 240, pyrolysisTemp: 190, heatOfCombustion: 20.5e6,
    burnRate: 0.04, selfHeating: 0.25, residue: 0.03, smokeYield: 0.03, smokeColor: [0.45, 0.44, 0.42],
    moisture: 0.9, maxMoisture: 2.5, extinctionMoisture: 1.5, charColor: [0.1, 0.08, 0.05],
  },
  grass: {
    label: 'Grass', color: [0.42, 0.55, 0.2], density: 4, burnTime: 10, specificHeat: 1800, conductivity: 0.04,
    surfaceFactor: 9, combustible: true, ignitionTemp: 250, pyrolysisTemp: 190, heatOfCombustion: 17e6,
    burnRate: 0.04, selfHeating: 0.25, residue: 0.05, smokeYield: 0.012, smokeColor: [0.68, 0.66, 0.6], photo: 'grass',
    smolderColor: [0.9, 0.9, 0.86], moisture: 0.1, maxMoisture: 2.0, deadFuel: true, timeLag: 900,
    extinctionMoisture: 0.35, charColor: [0.1, 0.09, 0.07],
  },
  steel: {
    label: 'Steel', color: [0.52, 0.53, 0.55], density: 7850, specificHeat: 490, conductivity: 45,
    emissivity: 0.75, meltingPoint: 1450, latentHeat: 270e3, fluidity: 0.5, oxidizeTemp: 350,
    charColor: [0.17, 0.12, 0.1], liquidColor: [0.95, 0.6, 0.2],
  },
  basalt: {
    // volcanic rock; molten above ~1100 °C it is lava: it flows (thickly), glows,
    // sets what it touches alight, and sets again into dark rock as it cools
    label: 'Basalt / lava', color: [0.17, 0.16, 0.15], density: 2900, specificHeat: 840, conductivity: 1.7,
    emissivity: 0.95, meltingPoint: 1100, latentHeat: 400e3, fluidity: 0.35, brittle: true,
    charColor: [0.14, 0.13, 0.12], liquidColor: [0.95, 0.42, 0.08], crust: true, photo: 'basalt',
  },
  aluminium: {
    label: 'Aluminium', color: [0.78, 0.79, 0.82], density: 2700, specificHeat: 900, conductivity: 205,
    emissivity: 0.25, meltingPoint: 660, latentHeat: 397e3, fluidity: 0.8, oxidizeTemp: 450,
    charColor: [0.5, 0.5, 0.52], liquidColor: [0.85, 0.85, 0.88],
  },
  copper: {
    label: 'Copper', color: [0.78, 0.45, 0.25], density: 8960, specificHeat: 385, conductivity: 400,
    emissivity: 0.6, meltingPoint: 1085, latentHeat: 205e3, fluidity: 0.8, oxidizeTemp: 250,
    charColor: [0.2, 0.1, 0.07],
  },
  glass: {
    label: 'Glass', color: [0.62, 0.78, 0.85], density: 2500, specificHeat: 840, conductivity: 1.0,
    emissivity: 0.9, meltingPoint: 800, latentHeat: 0, fluidity: 0.15, shatterTemp: 150, // surface temperature that stands for the ~70-100 K hot-centre / cool-edge difference that cracks a pane
    liquidColor: [0.95, 0.75, 0.4],
  },
  ceramic: {
    label: 'Ceramic', color: [0.88, 0.86, 0.82], density: 2300, specificHeat: 850, conductivity: 1.2,
    meltingPoint: 1600, latentHeat: 400e3,
  },
  brick: {
    label: 'Brick', color: [0.62, 0.27, 0.2], density: 1900, specificHeat: 840, conductivity: 0.7, brittle: true,
    meltingPoint: 1600, latentHeat: 400e3, maxMoisture: 0.08, oxidizeTemp: 500,
    charColor: [0.15, 0.12, 0.11],
  },
  concrete: {
    label: 'Concrete', color: [0.66, 0.66, 0.64], density: 2300, specificHeat: 880, conductivity: 1.4, spalling: true, brittle: true,
    meltingPoint: 1500, latentHeat: 400e3, moisture: 0.03, maxMoisture: 0.08, oxidizeTemp: 500,
    charColor: [0.2, 0.19, 0.18],
  },
  plaster: {
    // gypsum board: ~20 % chemically bound water that boils off at 100–150 °C (its fire protection)
    label: 'Plasterboard', color: [0.9, 0.89, 0.86], density: 700, specificHeat: 1000, conductivity: 0.25,
    moisture: 0.2, maxMoisture: 0.25, meltingPoint: 1200, latentHeat: 300e3, oxidizeTemp: 400,
    charColor: [0.55, 0.5, 0.45], failTemp: 650, // calcined gypsum crumbles and falls off
    brittle: true, wetFail: 0.45, maxMoisture: 0.6,
  },
  ceilingTile: {
    // mineral-fibre suspended-ceiling tile: the organic binder breaks down and the tile sags and drops
    label: 'Ceiling tile', color: [0.93, 0.93, 0.9], density: 280, specificHeat: 800, conductivity: 0.06,
    moisture: 0.02, maxMoisture: 0.6, failTemp: 400, oxidizeTemp: 250, charColor: [0.45, 0.42, 0.38],
    brittle: true, wetFail: 0.35, // a soaked tile is heavy and soft: it sags and drops
  },
  steelProfile: {
    label: 'Light steel profile', color: [0.75, 0.76, 0.78], density: 7850, specificHeat: 490, conductivity: 45,
    emissivity: 0.6, meltingPoint: 1450, latentHeat: 270e3, oxidizeTemp: 350, failTemp: 550, // thin members buckle
    charColor: [0.2, 0.15, 0.12],
  },
  cable: {
    // PVC insulated cables: very smoky, dripping, black soot
    label: 'PVC cables', color: [0.15, 0.15, 0.17], density: 1400, specificHeat: 1500, conductivity: 0.2,
    combustible: true, ignitionTemp: 330, pyrolysisTemp: 220, heatOfCombustion: 18e6, burnRate: 0.012,
    residue: 0.3, smokeYield: 0.12, smokeColor: [0.05, 0.05, 0.05], smolderColor: [0.55, 0.55, 0.5],
    meltingPoint: 180, latentHeat: 80e3, fluidity: 0.2, liquidColor: [0.12, 0.12, 0.13],
  },
  stone: {
    // limestone (catacombs): dense, brittle, calcines only at very high temperature
    label: 'Limestone', color: [0.62, 0.58, 0.5], density: 2300, specificHeat: 900, conductivity: 1.3,
    brittle: true, maxMoisture: 0.06, moisture: 0.03, oxidizeTemp: 600, charColor: [0.2, 0.18, 0.16],
    pattern: 'limestone', // drawn as dressed blocks with carved inscriptions
  },
  deckSteel: {
    // a carrier's flight deck: steel plate under a non-skid coating
    // (it behaves as steel; only the look differs)
    label: 'Flight deck (non-skid steel)', color: [0.36, 0.37, 0.38], density: 7850, specificHeat: 490, conductivity: 45,
    emissivity: 0.9, meltingPoint: 1450, latentHeat: 270e3, fluidity: 0.5, oxidizeTemp: 350,
    charColor: [0.17, 0.12, 0.1], liquidColor: [0.95, 0.6, 0.2],
    pattern: 'deck',
  },
  bedrock: {
    // the limestone the quarries were cut into: natural rock faces and ceilings
    label: 'Limestone bedrock', color: [0.5, 0.48, 0.43], density: 2300, specificHeat: 900, conductivity: 1.3,
    brittle: true, maxMoisture: 0.06, moisture: 0.04, oxidizeTemp: 600, charColor: [0.2, 0.18, 0.16],
    pattern: 'rock',
  },
  quarrySand: {
    // the trodden sandy floor of the quarries
    label: 'Quarry floor (sand and gravel)', color: [0.7, 0.65, 0.55], density: 1700, specificHeat: 830, conductivity: 0.6,
    maxMoisture: 0.15, moisture: 0.05, charColor: [0.25, 0.23, 0.2],
    pattern: 'gravel',
  },
  ossuary: {
    // an ossuary wall: skulls and long bones stacked in rows, set in lime mortar. The voxels
    // are the dark mass behind; the bones are drawn as geometry on it (render/ossuary.js)
    label: 'Ossuary wall (bones)', color: [0.09, 0.07, 0.05], density: 1500, specificHeat: 1150, conductivity: 0.6,
    brittle: true, maxMoisture: 0.08, moisture: 0.04, oxidizeTemp: 350, charColor: [0.08, 0.06, 0.05],
    bones: true,
  },
  bone: {
    label: 'Bone', color: [0.86, 0.82, 0.72], density: 1300, specificHeat: 1300, conductivity: 0.4,
    oxidizeTemp: 300, charColor: [0.25, 0.22, 0.2],
  },
  tiles: {
    label: 'Roof tiles', color: [0.55, 0.22, 0.16], density: 1900, specificHeat: 800, conductivity: 0.8,
    meltingPoint: 1500, latentHeat: 400e3, maxMoisture: 0.05, oxidizeTemp: 500,
    charColor: [0.15, 0.1, 0.09],
  },
  shingles: {
    label: 'Wood shingles', color: [0.45, 0.33, 0.24], density: 450, specificHeat: 1700, conductivity: 0.12,
    surfaceFactor: 1.5, combustible: true, ignitionTemp: 290, pyrolysisTemp: 210, heatOfCombustion: 17e6,
    burnRate: 0.004, residue: 0.2, residueMaterial: 'charcoal', smokeYield: 0.015,
    smokeColor: [0.36, 0.34, 0.32], moisture: 0.1, maxMoisture: 0.8, deadFuel: true, timeLag: 7200,
  },
  rubber: {
    label: 'Rubber', color: [0.09, 0.09, 0.1], density: 1150, specificHeat: 1900, conductivity: 0.15,
    combustible: true, ignitionTemp: 350, pyrolysisTemp: 250, heatOfCombustion: 32e6, burnRate: 0.012,
    selfHeating: 0.35, residue: 0.15, smokeYield: 0.12, smokeColor: [0.05, 0.05, 0.05],
    smolderColor: [0.35, 0.35, 0.35], charColor: [0.04, 0.04, 0.04],
  },
  plastic: {
    label: 'Plastic', color: [0.2, 0.2, 0.22], density: 1000, specificHeat: 1900, conductivity: 0.2,
    combustible: true, ignitionTemp: 350, pyrolysisTemp: 230, heatOfCombustion: 30e6, burnRate: 0.018,
    selfHeating: 0.35, residue: 0.03, smokeYield: 0.09, smokeColor: [0.07, 0.07, 0.075],
    smolderColor: [0.4, 0.4, 0.4], meltingPoint: 165, latentHeat: 100e3, fluidity: 0.25,
    liquidColor: [0.15, 0.15, 0.16],
  },
  foam: {
    label: 'Upholstery', color: [0.35, 0.36, 0.45], density: 60, specificHeat: 1400, conductivity: 0.04,
    surfaceFactor: 2, combustible: true, ignitionTemp: 300, pyrolysisTemp: 200, heatOfCombustion: 26e6,
    burnRate: 0.035, selfHeating: 0.3, residue: 0.05, smokeYield: 0.1, smokeColor: [0.09, 0.09, 0.09],
    maxMoisture: 1.0,
  },
  fabric: {
    label: 'Fabric', color: [0.6, 0.25, 0.25], density: 120, specificHeat: 1300, conductivity: 0.05,
    surfaceFactor: 3, combustible: true, ignitionTemp: 280, pyrolysisTemp: 200, heatOfCombustion: 17e6,
    burnRate: 0.03, selfHeating: 0.3, residue: 0.05, smokeYield: 0.03, smokeColor: [0.3, 0.3, 0.3],
    moisture: 0.05, maxMoisture: 1.5, deadFuel: true, timeLag: 3600,
  },
  paper: {
    label: 'Paper / cardboard', color: [0.86, 0.82, 0.7], density: 150, specificHeat: 1300, conductivity: 0.05,
    surfaceFactor: 4, combustible: true, ignitionTemp: 230, pyrolysisTemp: 180, heatOfCombustion: 16e6,
    burnRate: 0.035, selfHeating: 0.25, residue: 0.06, smokeYield: 0.01, smokeColor: [0.6, 0.6, 0.6],
    moisture: 0.06, maxMoisture: 1.5, deadFuel: true, timeLag: 1800,
  },
  // crumpled and torn-out pages: kindling (mostly air; each sheet catches at once and is gone in
  // half a minute, like twigs)
  pages: {
    label: 'Crumpled pages (kindling)', color: [0.88, 0.85, 0.76], density: 30, burnTime: 30, specificHeat: 1300, conductivity: 0.05,
    surfaceFactor: 6, combustible: true, ignitionTemp: 230, pyrolysisTemp: 180, heatOfCombustion: 16e6,
    burnRate: 0.04, selfHeating: 0.3, residue: 0.05, smokeYield: 0.01, smokeColor: [0.62, 0.62, 0.6],
    moisture: 0.06, maxMoisture: 1.5, deadFuel: true, timeLag: 1200,
  },
  // books: paper bound tight (a closed book is nearly solid: it chars a page at a time, slowly,
  // like a log; its edges and loose pages catch first). Card or cloth covers burn with it.
  books: {
    label: 'Books (bound paper)', color: [0.55, 0.28, 0.2], density: 750, specificHeat: 1300, conductivity: 0.08,
    combustible: true, ignitionTemp: 260, pyrolysisTemp: 190, heatOfCombustion: 16e6, burnRate: 0.004,
    selfHeating: 0.3, residue: 0.12, residueMaterial: 'ash', smokeYield: 0.02, smokeColor: [0.55, 0.55, 0.55],
    moisture: 0.07, maxMoisture: 1.2, deadFuel: true, timeLag: 30000, extinctionMoisture: 0.45,
  },
  wax: {
    label: 'Paraffin wax', color: [0.95, 0.93, 0.86], density: 900, specificHeat: 2500, conductivity: 0.25,
    combustible: true, ignitionTemp: 250, pyrolysisTemp: 220, heatOfCombustion: 42e6, burnRate: 0.015,
    selfHeating: 0.3, residue: 0, smokeYield: 0.02, smokeColor: [0.1, 0.1, 0.1],
    meltingPoint: 60, latentHeat: 200e3, fluidity: 0.5, liquidColor: [0.98, 0.92, 0.75],
  },
  beeswax: {
    label: 'Beeswax', color: [0.9, 0.72, 0.3], density: 960, specificHeat: 2400, conductivity: 0.25,
    combustible: true, ignitionTemp: 255, pyrolysisTemp: 225, heatOfCombustion: 40e6, burnRate: 0.014,
    selfHeating: 0.3, residue: 0, smokeYield: 0.008, smokeColor: [0.2, 0.2, 0.2],
    meltingPoint: 63, latentHeat: 180e3, fluidity: 0.4, liquidColor: [0.98, 0.82, 0.4],
  },
  wick: {
    label: 'Cotton wick', color: [0.95, 0.95, 0.92], density: 300, specificHeat: 1300, conductivity: 0.06,
    combustible: true, ignitionTemp: 255, pyrolysisTemp: 200, heatOfCombustion: 16e6, burnRate: 0.003,
    selfHeating: 0.35, residue: 0.1, smokeYield: 0.01, smokeColor: [0.15, 0.15, 0.15],
    wicks: ['wax', 'beeswax', 'pitch'], wickRate: 1.7e-6, extinctionMoisture: 0.3, maxBurnTemp: 1000, // wickRate: kg/s of wax drawn by a lit wick (~70 W)
  },
  gasoline: {
    label: 'Gasoline', color: [0.85, 0.75, 0.35], density: 740, specificHeat: 2200, conductivity: 0.13,
    // ignitionTemp is a pilot proxy: its vapour (flash point -43 °C) catches as soon as a flame reaches it
    combustible: true, ignitionTemp: 80, pyrolysisTemp: 60, heatOfCombustion: 44e6, burnRate: 0.055,
    selfHeating: 0.25, residue: 0, smokeYield: 0.06, smokeColor: [0.06, 0.06, 0.06],
    meltingPoint: -60, latentHeat: 0, fluidity: 0.95,
    vapor: { refP: 60e3, refT: 38, B: 3600, Tb: 70, Lv: 350e3, beta: 0.00095 },
  },
  propane: {
    label: 'Propane (LPG)', color: [0.82, 0.86, 0.9], density: 500, specificHeat: 2500, conductivity: 0.1,
    combustible: true, ignitionTemp: 80, pyrolysisTemp: 60, heatOfCombustion: 46e6, burnRate: 0.08,
    selfHeating: 0.2, residue: 0, smokeYield: 0.002, smokeColor: [0.3, 0.3, 0.3],
    meltingPoint: -188, latentHeat: 0, fluidity: 1,
    // vapour pressure: Clausius–Clapeyron through 8.4 bar at 20 °C with B = Lv·M/R ≈ 2265 K
    // (≈ 8 bar at 20 °C, 17 at 50, 26 at 70, 34 at 85: within a few % of the tables up to the
    // critical point, 96.7 °C). The liquid swells as it warms (507 kg/m³ at 15 °C, 449 at 50,
    // 405 at 70): ρ(T) = ρ15·exp(-(a·ΔT + b·ΔT²)), ΔT from 15 °C (sim/vessels.js liquidDensity)
    vapor: { refP: 8.4e5, refT: 20, B: 2265, Tb: -42, Lv: 428e3, beta: 0.0031, expansion: { a: 0.00234, b: 3.2e-5 }, critical: 96.7 },
  },
  water: {
    // liquid water (puddles, flooding sea water): flows, soaks, boils off
    label: 'Water', color: [0.16, 0.3, 0.42], density: 1000, specificHeat: 4186, conductivity: 0.6,
    meltingPoint: 0, latentHeat: 334e3, fluidity: 1, liquidColor: [0.16, 0.3, 0.42], maxMoisture: 0, emissivity: 0.95,
  },
  charcoal: {
    label: 'Charcoal / embers', color: [0.09, 0.08, 0.07], density: 180, specificHeat: 1000, conductivity: 0.1,
    combustible: true, ignitionTemp: 380, pyrolysisTemp: Infinity, heatOfCombustion: 30e6, burnRate: 0.0025,
    selfHeating: 0.6, residue: 0.1, residueMaterial: 'ash', smokeYield: 0.001, smokeColor: [0.5, 0.5, 0.5],
    maxMoisture: 1.0, extinctionMoisture: 0.3, charColor: [0.09, 0.08, 0.07], maxBurnTemp: 1100,
  },
  ash: {
    label: 'Ash', color: [0.55, 0.54, 0.52], density: 150, specificHeat: 1000, conductivity: 0.08,
    granular: true, fluidity: 0.1, maxMoisture: 1.0, charColor: [0.55, 0.54, 0.52],
  },
  ashlar: {
    // dressed limestone in a built wall (a church): behaves as limestone, laid in courses, no inscriptions
    label: 'Dressed limestone (ashlar)', color: [0.7, 0.66, 0.57], density: 2300, specificHeat: 900, conductivity: 1.3,
    brittle: true, maxMoisture: 0.06, moisture: 0.03, oxidizeTemp: 600, charColor: [0.2, 0.18, 0.16],
    pattern: 'ashlar',
  },
  beachSand: {
    // the sand of a beach (the island's shores)
    label: 'Beach sand', color: [0.78, 0.7, 0.5], density: 1600, specificHeat: 830, conductivity: 0.3,
    maxMoisture: 0.25, moisture: 0.08, charColor: [0.3, 0.27, 0.22],
    photo: 'sand',
  },
  hillRock: {
    // weathered bedrock where it comes to the surface (the island's hilltops)
    label: 'Rock (weathered)', color: [0.36, 0.34, 0.31], density: 2500, specificHeat: 850, conductivity: 2,
    brittle: true, maxMoisture: 0.04, moisture: 0.02, oxidizeTemp: 700, charColor: [0.2, 0.19, 0.18],
    photo: 'rocks',
  },
  cotton: {
    // cotton cloth (laundry): drying in the sun and the wind it takes up to burn; light, it burns
    // fast once it is dry, and falls apart in glowing shreds
    label: 'Cotton (laundry)', color: [0.92, 0.92, 0.9], density: 1500, specificHeat: 1300, conductivity: 0.06,
    surfaceFactor: 7, burnTime: 15, combustible: true, ignitionTemp: 255, pyrolysisTemp: 210, heatOfCombustion: 16.5e6,
    burnRate: 0.06, selfHeating: 0.3, residue: 0.03, smokeYield: 0.02, smokeColor: [0.35, 0.35, 0.33],
    moisture: 0.05, maxMoisture: 2.0, deadFuel: true, dries: true, timeLag: 450, extinctionMoisture: 0.3, charColor: [0.08, 0.07, 0.06], // (thin cloth in the sun and wind: dry in half an hour)
  },
  polyester: {
    // a synthetic shirt: it shrinks and melts (drips) before it burns, with sooty black smoke
    label: 'Polyester', color: [0.3, 0.45, 0.7], density: 1380, specificHeat: 1200, conductivity: 0.1,
    meltingPoint: 255, latentHeat: 60e3, fluidity: 0.5, liquidColor: [0.15, 0.13, 0.12],
    surfaceFactor: 4, burnTime: 30, combustible: true, ignitionTemp: 430, pyrolysisTemp: 350, heatOfCombustion: 24e6,
    burnRate: 0.04, selfHeating: 0.2, residue: 0.02, smokeYield: 0.08, smokeColor: [0.08, 0.08, 0.08],
    moisture: 0.01, maxMoisture: 0.2, deadFuel: true, dries: true, timeLag: 300, charColor: [0.06, 0.05, 0.05],
  },
  brass: {
    // cast brass (candlesticks): melts at ~930 °C, tarnishes dark when hot
    label: 'Brass', color: [0.75, 0.6, 0.3], density: 8500, specificHeat: 380, conductivity: 110, emissivity: 0.1,
    meltingPoint: 930, latentHeat: 170e3, fluidity: 0.8, oxidizeTemp: 300, charColor: [0.25, 0.2, 0.12],
    liquidColor: [0.95, 0.62, 0.3],
  },
  sandstone: {
    // carved sandstone (a statue): brittle, spalls in a fierce fire (flakes fly off), sooted black
    label: 'Sandstone (carved)', color: [0.62, 0.58, 0.5], density: 2200, specificHeat: 880, conductivity: 1.5,
    brittle: true, spalling: true, fragile: true, maxMoisture: 0.08, moisture: 0.03, oxidizeTemp: 150, charColor: [0.1, 0.09, 0.085], // (soot from the smoke blackens it well below that heat; this stands in for it)
  },
  pitch: {
    // pine pitch with tallow (a torch's head: rags soaked in it): softens and runs when hot,
    // the rags draw it up and burn it as a wick does (a smoky, sooty flame)
    label: 'Pitch (torch)', color: [0.13, 0.08, 0.04], density: 1050, specificHeat: 2000, conductivity: 0.17,
    combustible: true, ignitionTemp: 240, pyrolysisTemp: 210, heatOfCombustion: 36e6, burnRate: 0.015,
    selfHeating: 0.3, residue: 0.02, smokeYield: 0.05, smokeColor: [0.08, 0.07, 0.06],
    meltingPoint: 70, latentHeat: 150e3, fluidity: 0.3, liquidColor: [0.2, 0.12, 0.05],
  },
  // (the ground a terrain lays down, models/terrain.js, besides soil, sand, gravel, rock and basalt)
  mud: {
    // soil soaked to a paste (a lake bed, a bog): heavy and slow to heat (the water in it: ~2.2
    // kJ/(kg·K) with half its dry weight of water), it conducts like wet soil; nothing in it burns,
    // and a fire over it has to boil its water off before the ground under it gets hot
    label: 'Mud (wet soil)', color: [0.27, 0.21, 0.14], density: 1750, specificHeat: 2200, conductivity: 1.4,
    moisture: 0.5, maxMoisture: 0.9, oxidizeTemp: 300, charColor: [0.16, 0.13, 0.1],
  },
  tephra: {
    // volcanic ash and cinders (scoria, lapilli): basalt foamed by its gases as it was thrown out,
    // lying loose on a volcano's flanks. Porous (a bulk density of ~1.1 t/m³, half of it air), so
    // it insulates (~0.25 W/(m·K)) where solid basalt conducts; it melts as basalt does, into lava
    label: 'Volcanic ash and cinders (tephra)', color: [0.23, 0.21, 0.2], density: 1100, specificHeat: 840, conductivity: 0.25,
    emissivity: 0.95, meltingPoint: 1120, latentHeat: 400e3, fluidity: 0.3, maxMoisture: 0.3, moisture: 0.02,
    charColor: [0.16, 0.15, 0.14], liquidColor: [0.95, 0.42, 0.08], crust: true, photo: 'ash',
  },
  butane: {
    // liquefied butane (camping and patio-heater cylinders): ~2.1 bar abs at 20 °C (B = Lv·M/R ≈
    // 2690 K: ~5 bar at 50 °C, ~10 at 80), boils at -0.5 °C; it swells less as it warms than propane
    label: 'Butane (LPG)', color: [0.84, 0.86, 0.88], density: 580, specificHeat: 2400, conductivity: 0.1,
    combustible: true, ignitionTemp: 80, pyrolysisTemp: 60, heatOfCombustion: 45.7e6, burnRate: 0.08,
    selfHeating: 0.2, residue: 0, smokeYield: 0.002, smokeColor: [0.3, 0.3, 0.3],
    meltingPoint: -138, latentHeat: 0, fluidity: 1,
    vapor: { refP: 2.1e5, refT: 20, B: 2690, Tb: -0.5, Lv: 385e3, beta: 0.002, expansion: { a: 0.0019, b: 1.2e-5 }, critical: 152 },
  },
};

/** id -> material definition. id 0 is air/empty. */
export const MATERIALS = [{ name: 'air', label: 'Air', ...DEFAULTS, color: [0, 0, 0] }];
/** name -> id */
export const MAT = { air: 0 };

for (const [name, props] of Object.entries(DEFS)) {
  const def = { name, ...DEFAULTS, ...props };
  MAT[name] = MATERIALS.length;
  MATERIALS.push(def);
}

// Resolve name references to ids.
for (const m of MATERIALS) {
  m.residueId = m.residue > 0 ? (MAT[m.residueMaterial] ?? MAT.ash) : 0;
  m.wickIds = m.wicks ? m.wicks.map((n) => MAT[n]) : null;
}

/** Flat lookup tables for the hot loops. */
const n = MATERIALS.length;
const t = (f) => Float32Array.from(MATERIALS, f);
export const TBL = {
  rho: t((m) => m.density),
  c: t((m) => m.specificHeat),
  k: t((m) => m.conductivity),
  eps: t((m) => m.emissivity),
  sf: t((m) => m.surfaceFactor),
  combustible: Uint8Array.from(MATERIALS, (m) => (m.combustible ? 1 : 0)),
  count: n,
};

export function materialId(name) {
  const id = MAT[name];
  if (id === undefined) throw new Error(`Unknown material '${name}'`);
  return id;
}

export const MATERIAL_NAMES = Object.keys(DEFS);

/* ---------- mechanics and acoustics (impacts: sim/impact.js; physical sound: audio/physics.js) ---------- */
/**
 * How a material takes a blow and how it sounds, by name: the voxel materials above and what is
 * not a voxel (flesh, scales, feathers, a ceramic plate, ice). Representative values:
 *
 *  E          Young's modulus, Pa (stiffness). With the density, the speed of sound in it, c = √(E/ρ),
 *             which sets its ringing frequencies (audio/physics.js modes()).
 *  nu         Poisson's ratio (Hertz contact)
 *  eta        loss factor (internal damping): a mode at f rings for τ = 1/(π f η) s. Steel clangs
 *             (η ~ 5e-4), wood knocks (~1e-2), stone cracks (~1e-2 but stiff), flesh thuds (~0.5).
 *  hardness   0..1 surface hardness (how sharp the contact is; restitution)
 *  strength   Pa, what breaks it (crushing / fracture strength)
 *  radiation  fraction of the impact energy that leaves as sound (acoustic efficiency)
 *  shape      default shape class of a struck body: 'shell' (a drum, a car body: thin, rings),
 *             'plate', 'bar', 'block', 'soft' (flesh: no ring, a thud), 'liquid' (a splash:
 *             bubbles), 'granular' (soil, sand: a dull thump, a hiss of grains)
 *  brittle    breaks into pieces when hit hard (glass shatters, ceramic, ice)
 *  alpha      linear thermal expansion 1/K (metals tick as they heat and cool)
 *  pop        crackle when burning: resin pockets and trapped moisture bursting (pine > oak)
 *  grain      m, typical piece of fuel (fine grass crackles fast and small, logs pop seldom and loud)
 *  burnSound  'crackle' | 'hiss' (fine dry fuel, fabric) | 'flutter' (paper) | 'smoulder' (books,
 *             charcoal) | 'whoosh' (plastics, liquid fuels: vapour burning)
 */
const MECH_DEFAULTS = { E: 1e9, nu: 0.3, eta: 0.05, hardness: 0.5, strength: 10e6, radiation: 0.004, shape: 'block', brittle: false, alpha: 10e-6, pop: 0.1, grain: 0.05, burnSound: 'crackle' };
const METAL = { nu: 0.3, eta: 0.0006, hardness: 0.95, strength: 250e6, radiation: 0.02, shape: 'shell', pop: 0 };
const STONE = { nu: 0.25, eta: 0.012, hardness: 0.85, strength: 60e6, radiation: 0.008, shape: 'block', pop: 0 };
const GROUND = { nu: 0.35, eta: 0.35, hardness: 0.2, strength: 0.2e6, radiation: 0.003, shape: 'granular', pop: 0 };
const WOOD = { nu: 0.35, eta: 0.012, hardness: 0.45, strength: 40e6, radiation: 0.01, shape: 'plate', alpha: 4e-6, burnSound: 'crackle' };
const FINE = { nu: 0.35, eta: 0.3, hardness: 0.1, strength: 1e6, radiation: 0.002, shape: 'soft', burnSound: 'hiss' };
const SOFT = { nu: 0.45, eta: 0.4, hardness: 0.1, strength: 2e6, radiation: 0.002, shape: 'soft' };
const MECH = {
  steel: { ...METAL, E: 200e9, alpha: 12e-6 },
  deckSteel: { ...METAL, E: 200e9, alpha: 12e-6, shape: 'plate' },
  steelProfile: { ...METAL, E: 200e9, alpha: 12e-6, shape: 'bar' },
  cable: { ...METAL, E: 120e9, eta: 0.01, hardness: 0.6, shape: 'bar', alpha: 17e-6 },
  aluminium: { ...METAL, E: 70e9, eta: 0.0008, alpha: 23e-6 },
  copper: { ...METAL, E: 120e9, eta: 0.002, alpha: 17e-6 },
  brass: { ...METAL, E: 100e9, eta: 0.001, alpha: 19e-6 },
  glass: { E: 70e9, nu: 0.22, eta: 0.002, hardness: 0.9, strength: 50e6, radiation: 0.02, shape: 'plate', brittle: true, alpha: 9e-6, pop: 0 },
  ceramic: { E: 200e9, nu: 0.22, eta: 0.003, hardness: 0.95, strength: 300e6, radiation: 0.015, shape: 'shell', brittle: true, alpha: 7e-6, pop: 0 },
  tiles: { E: 50e9, nu: 0.22, eta: 0.006, hardness: 0.85, strength: 40e6, radiation: 0.012, shape: 'plate', brittle: true, alpha: 6e-6, pop: 0 },
  stone: { ...STONE, E: 50e9 },
  basalt: { ...STONE, E: 70e9 },
  bedrock: { ...STONE, E: 60e9 },
  hillRock: { ...STONE, E: 50e9 },
  ashlar: { ...STONE, E: 40e9 },
  sandstone: { ...STONE, E: 15e9, eta: 0.02, strength: 40e6 },
  brick: { ...STONE, E: 15e9, eta: 0.02, strength: 20e6 },
  concrete: { ...STONE, E: 30e9, eta: 0.02, strength: 30e6 },
  plaster: { E: 5e9, nu: 0.3, eta: 0.03, hardness: 0.4, strength: 4e6, radiation: 0.006, shape: 'plate', brittle: true, pop: 0.05 },
  ceilingTile: { E: 0.5e9, nu: 0.3, eta: 0.1, hardness: 0.2, strength: 1e6, radiation: 0.004, shape: 'plate', brittle: true, pop: 0.05 },
  shingles: { E: 1e9, nu: 0.3, eta: 0.05, hardness: 0.4, strength: 5e6, radiation: 0.006, shape: 'plate', pop: 0.3, burnSound: 'crackle' },
  soil: { ...GROUND, E: 50e6 },
  quarrySand: { ...GROUND, E: 80e6, eta: 0.4 },
  beachSand: { ...GROUND, E: 80e6, eta: 0.4 },
  mud: { ...GROUND, E: 5e6, eta: 0.6, hardness: 0.08 },
  tephra: { ...GROUND, E: 30e6, eta: 0.4, hardness: 0.3 },
  ash: { ...GROUND, E: 5e6, eta: 0.5, burnSound: 'smoulder' },
  grass: { ...GROUND, E: 10e6, eta: 0.45, pop: 0.35, grain: 0.004, burnSound: 'hiss' },
  wood: { ...WOOD, E: 10e9, pop: 0.6, grain: 0.08 },
  pine: { ...WOOD, E: 9e9, pop: 1.0, grain: 0.1 },
  oak: { ...WOOD, E: 12e9, eta: 0.008, pop: 0.3, grain: 0.12 },
  willow: { ...WOOD, E: 7e9, eta: 0.015, pop: 0.5, grain: 0.06 },
  bark: { ...WOOD, E: 8e9, eta: 0.02, pop: 0.5, grain: 0.05 },
  deadWood: { ...WOOD, E: 8e9, eta: 0.02, pop: 0.55, grain: 0.06 },
  twigs: { ...WOOD, E: 8e9, eta: 0.03, pop: 0.7, grain: 0.01 },
  charcoal: { E: 2e9, nu: 0.3, eta: 0.05, hardness: 0.3, strength: 3e6, radiation: 0.008, shape: 'block', brittle: true, pop: 0.15, grain: 0.03, burnSound: 'smoulder' },
  leaves: { ...FINE, E: 0.5e9, pop: 0.25, grain: 0.003 },
  needles: { ...FINE, E: 1e9, pop: 0.8, grain: 0.002, burnSound: 'crackle' },
  paper: { ...FINE, E: 3e9, eta: 0.1, pop: 0.05, grain: 0.001, burnSound: 'flutter', shape: 'plate' },
  pages: { ...FINE, E: 3e9, eta: 0.15, pop: 0.05, grain: 0.001, burnSound: 'flutter' },
  books: { ...FINE, E: 2e9, eta: 0.2, hardness: 0.3, pop: 0.03, grain: 0.05, burnSound: 'smoulder', shape: 'block' },
  fabric: { ...SOFT, E: 5e6, pop: 0.05, grain: 0.001, burnSound: 'hiss' },
  cotton: { ...SOFT, E: 5e6, pop: 0.05, grain: 0.001, burnSound: 'hiss' },
  polyester: { ...SOFT, E: 5e6, pop: 0.02, grain: 0.001, burnSound: 'whoosh' },
  foam: { ...SOFT, E: 1e6, eta: 0.6, pop: 0.02, burnSound: 'whoosh' },
  rubber: { ...SOFT, E: 10e6, eta: 0.3, hardness: 0.2, pop: 0.05, burnSound: 'whoosh' },
  plastic: { E: 2e9, nu: 0.38, eta: 0.04, hardness: 0.5, strength: 40e6, radiation: 0.008, shape: 'shell', alpha: 80e-6, pop: 0.05, burnSound: 'whoosh' },
  wax: { ...SOFT, E: 0.2e9, eta: 0.1, pop: 0.02, burnSound: 'hiss' },
  beeswax: { ...SOFT, E: 0.2e9, eta: 0.1, pop: 0.02, burnSound: 'hiss' },
  wick: { ...SOFT, E: 5e6, pop: 0.02, burnSound: 'hiss' },
  pitch: { ...SOFT, E: 0.1e9, eta: 0.3, pop: 0.6, burnSound: 'crackle' },
  gasoline: { E: 1.3e9, nu: 0.5, eta: 1, hardness: 0.02, strength: 0, radiation: 0.003, shape: 'liquid', pop: 0, burnSound: 'whoosh' },
  propane: { E: 1e9, nu: 0.5, eta: 1, hardness: 0.02, strength: 0, radiation: 0.003, shape: 'liquid', pop: 0, burnSound: 'whoosh' },
  butane: { E: 1e9, nu: 0.5, eta: 1, hardness: 0.02, strength: 0, radiation: 0.003, shape: 'liquid', pop: 0, burnSound: 'whoosh' },
  water: { E: 2.2e9, nu: 0.5, eta: 1, hardness: 0.03, strength: 0, radiation: 0.004, shape: 'liquid', pop: 0 },
  bone: { E: 15e9, nu: 0.3, eta: 0.03, hardness: 0.7, strength: 150e6, radiation: 0.008, shape: 'bar', brittle: true, pop: 0.1 },
  ossuary: { E: 15e9, nu: 0.3, eta: 0.03, hardness: 0.7, strength: 100e6, radiation: 0.008, shape: 'block', brittle: true, pop: 0.1 },
  // (not voxels: people and creatures, their armour; ice: sim/ice.js)
  flesh: { E: 0.5e6, nu: 0.45, eta: 0.5, hardness: 0.08, strength: 1e6, radiation: 0.002, shape: 'soft', density: 1060 },
  scales: { E: 2e9, nu: 0.35, eta: 0.08, hardness: 0.6, strength: 30e6, radiation: 0.005, shape: 'plate', density: 1300 },
  feathers: { E: 0.3e9, nu: 0.4, eta: 0.6, hardness: 0.05, strength: 2e6, radiation: 0.001, shape: 'soft', density: 150 },
  plate: { E: 300e9, nu: 0.22, eta: 0.004, hardness: 0.95, strength: 400e6, radiation: 0.012, shape: 'plate', density: 3800 }, // a ceramic body-armour plate
  kevlar: { E: 70e9, nu: 0.35, eta: 0.08, hardness: 0.3, strength: 3e9, radiation: 0.003, shape: 'soft', density: 1440 },
  ice: { E: 9e9, nu: 0.33, eta: 0.005, hardness: 0.7, strength: 5e6, radiation: 0.012, shape: 'plate', brittle: true, density: 917, alpha: 50e-6 },
};

/** The mechanical / acoustic properties of a material (by name or voxel id), density included. */
export function mechanics(m) {
  const name = typeof m === 'number' ? MATERIALS[m]?.name : m;
  const def = name && MAT[name] !== undefined ? MATERIALS[MAT[name]] : null;
  const own = MECH[name] ?? (def?.fluidity >= 0.95 ? MECH.water : def?.granular ? MECH.soil : def?.combustible ? MECH.wood : {});
  return { name: name ?? 'unknown', ...MECH_DEFAULTS, density: def?.density ?? 1000, ...own };
}
/** The names with mechanical properties (voxel materials and the others: flesh, scales, ...). */
export const MECHANICS_NAMES = [...new Set([...Object.keys(DEFS), ...Object.keys(MECH)])];
