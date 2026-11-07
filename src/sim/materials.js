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
  oxidizeTemp: Infinity,
  wicks: null,
  wickRate: 0,
  burnTime: 0, // s: fine fuels burn out in a fixed residence time (resolution independent)
  maxBurnTemp: 950,
  charColor: [0.06, 0.05, 0.045],
  liquidColor: null,
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
    burnRate: 0.04, selfHeating: 0.25, residue: 0.05, smokeYield: 0.012, smokeColor: [0.68, 0.66, 0.6],
    smolderColor: [0.9, 0.9, 0.86], moisture: 0.1, maxMoisture: 2.0, deadFuel: true, timeLag: 900,
    extinctionMoisture: 0.35, charColor: [0.1, 0.09, 0.07],
  },
  steel: {
    label: 'Steel', color: [0.52, 0.53, 0.55], density: 7850, specificHeat: 490, conductivity: 45,
    emissivity: 0.75, meltingPoint: 1450, latentHeat: 270e3, fluidity: 0.5, oxidizeTemp: 350,
    charColor: [0.17, 0.12, 0.1], liquidColor: [0.95, 0.6, 0.2],
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
    emissivity: 0.9, meltingPoint: 800, latentHeat: 0, fluidity: 0.15, shatterTemp: 230,
    liquidColor: [0.95, 0.75, 0.4],
  },
  ceramic: {
    label: 'Ceramic', color: [0.88, 0.86, 0.82], density: 2300, specificHeat: 850, conductivity: 1.2,
    meltingPoint: 1600, latentHeat: 400e3,
  },
  brick: {
    label: 'Brick', color: [0.62, 0.27, 0.2], density: 1900, specificHeat: 840, conductivity: 0.7,
    meltingPoint: 1600, latentHeat: 400e3, maxMoisture: 0.08, oxidizeTemp: 500,
    charColor: [0.15, 0.12, 0.11],
  },
  concrete: {
    label: 'Concrete', color: [0.66, 0.66, 0.64], density: 2300, specificHeat: 880, conductivity: 1.4,
    meltingPoint: 1500, latentHeat: 400e3, moisture: 0.03, maxMoisture: 0.08, oxidizeTemp: 500,
    charColor: [0.2, 0.19, 0.18],
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
    wicks: ['wax', 'beeswax'], wickRate: 1.7e-6, extinctionMoisture: 0.3, maxBurnTemp: 1000, // wickRate: kg/s of wax drawn by a lit wick (~70 W)
  },
  gasoline: {
    label: 'Gasoline', color: [0.85, 0.75, 0.35], density: 740, specificHeat: 2200, conductivity: 0.13,
    combustible: true, ignitionTemp: 250, pyrolysisTemp: 100, heatOfCombustion: 44e6, burnRate: 0.055,
    selfHeating: 0.25, residue: 0, smokeYield: 0.06, smokeColor: [0.06, 0.06, 0.06],
    meltingPoint: -60, latentHeat: 0, fluidity: 0.95,
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
