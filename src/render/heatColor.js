import { MATERIALS } from '../sim/materials.js';
import { TMAX_STEP } from '../sim/world.js';

/**
 * How heat colours a solid, beyond the incandescence of render/colors.js blackbody():
 *
 *  - a lasting tint from the hottest the surface has been (world.tmax): the temper colours of
 *    steel (straw ~220 °C, bronze ~250, purple ~280, blue ~300, grey ~330, then the black scale
 *    of sim oxidation), the tarnish and interference colours of copper and brass, the dull
 *    matte grey of heated aluminium, wood, paper and cloth browning before they char, and
 *    sandstone / limestone reddening (their iron oxides). It stays after the part cools.
 *  - how strongly the surface glows: emission is blackbody(T) × emissivity. Bright metal
 *    glows far less than oxidised steel or stone at the same temperature (polished aluminium
 *    hardly at all before it melts at 660 °C); an oxide layer (sim char on metals) raises it.
 *
 * Per-material tables are flat arrays indexed by material id, and each tint ramp is baked into
 * a lookup table indexed by world.tmax (a byte, TMAX_STEP °C a step), so the per-voxel cost in
 * shadeVoxel is a couple of reads.
 */

export const HT_NONE = 0;
export const HT_STEEL = 1;
export const HT_COPPER = 2;
export const HT_BRASS = 3;
export const HT_ALUMINIUM = 4;
export const HT_SCORCH = 5;
export const HT_REDDEN = 6;

// [°C, r, g, b, strength]: target colour (sRGB-ish 0..1, like world.tint) and how far the base
// colour moves towards it
const RAMPS = {
  [HT_STEEL]: [
    [190, 0.86, 0.8, 0.6, 0],
    [205, 0.88, 0.8, 0.56, 0.35], // pale straw
    [220, 0.86, 0.7, 0.4, 0.6], // straw
    [240, 0.8, 0.55, 0.26, 0.72], // dark straw / gold
    [255, 0.62, 0.36, 0.2, 0.78], // bronze / brown
    [270, 0.5, 0.26, 0.38, 0.78], // brown-purple
    [285, 0.4, 0.22, 0.56, 0.8], // purple
    [300, 0.2, 0.26, 0.66, 0.8], // dark blue
    [315, 0.34, 0.5, 0.74, 0.72], // pale blue
    [335, 0.48, 0.54, 0.6, 0.62], // grey-blue
    [380, 0.4, 0.41, 0.43, 0.6], // grey (then the black scale: sim oxidation, char)
  ],
  [HT_COPPER]: [
    [120, 0.78, 0.45, 0.25, 0],
    [160, 0.72, 0.4, 0.2, 0.35], // darker, duller orange (tarnish)
    [190, 0.62, 0.28, 0.18, 0.6], // red-brown
    [215, 0.56, 0.24, 0.36, 0.62], // rose / purple
    [235, 0.34, 0.3, 0.58, 0.62], // blue-violet
    [255, 0.36, 0.5, 0.48, 0.58], // teal-green sheen
    [285, 0.44, 0.24, 0.17, 0.7], // cuprous oxide, red-brown
    [360, 0.24, 0.14, 0.11, 0.78], // dark brown (then black cupric oxide: char)
  ],
  [HT_BRASS]: [
    [150, 0.75, 0.6, 0.3, 0],
    [200, 0.7, 0.5, 0.24, 0.35],
    [250, 0.6, 0.36, 0.24, 0.5],
    [300, 0.48, 0.34, 0.36, 0.5],
    [360, 0.38, 0.3, 0.24, 0.6],
  ],
  [HT_ALUMINIUM]: [
    [200, 0.78, 0.79, 0.82, 0],
    [400, 0.7, 0.7, 0.7, 0.3], // matte, slightly greyer
    [600, 0.72, 0.71, 0.69, 0.42],
  ],
  [HT_SCORCH]: [
    [110, 0.78, 0.66, 0.46, 0],
    [150, 0.78, 0.64, 0.42, 0.2], // yellowing
    [190, 0.55, 0.38, 0.22, 0.5], // tan
    [230, 0.36, 0.23, 0.13, 0.75], // brown
    [280, 0.2, 0.13, 0.08, 0.85], // dark brown (charring takes over: sim char)
  ],
  [HT_REDDEN]: [
    [220, 0.72, 0.52, 0.44, 0],
    [300, 0.72, 0.5, 0.42, 0.22], // pinkish
    [450, 0.7, 0.42, 0.33, 0.38], // red-brown (iron oxides)
    [700, 0.68, 0.4, 0.32, 0.42],
  ],
};

const STEP = TMAX_STEP; // °C per LUT entry: one per value of world.tmax
const NLUT = 256;
/** kind -> Float32Array(NLUT * 4) of r, g, b, strength */
const LUT = [];
/** kind -> world.tmax value (TMAX_STEP °C) at or below which there is no tint */
export const TINT_FROM = new Uint16Array(8).fill(65535);
for (const [k, stops] of Object.entries(RAMPS)) {
  const t = new Float32Array(NLUT * 4);
  for (let e = 0; e < NLUT; e++) {
    const T = e * STEP;
    let s = 1;
    while (s < stops.length - 1 && stops[s][0] < T) s++;
    const a = stops[s - 1];
    const b = stops[s];
    const u = Math.max(0, Math.min(1, (T - a[0]) / (b[0] - a[0])));
    for (let c = 0; c < 4; c++) t[e * 4 + c] = a[c + 1] + (b[c + 1] - a[c + 1]) * u;
  }
  LUT[k] = t;
  TINT_FROM[k] = Math.floor(stops[0][0] / STEP);
}

/**
 * Write the lasting heat tint (r, g, b, strength) of a surface of kind `kind` whose world.tmax
 * is `q` (it has been at q × TMAX_STEP °C).
 */
export function heatTint(kind, q, out) {
  const t = LUT[kind];
  const e = (q < 0 ? 0 : q > 255 ? 255 : q | 0) * 4;
  out[0] = t[e];
  out[1] = t[e + 1];
  out[2] = t[e + 2];
  out[3] = t[e + 3];
  return out;
}

const STEELS = new Set(['steel', 'steelProfile', 'deckSteel']);
const STONES = new Set(['sandstone', 'stone', 'ashlar', 'bedrock', 'hillRock']);
/** material id -> tint kind */
export const HEAT_KIND = Uint8Array.from(MATERIALS, (m) => {
  if (STEELS.has(m.name)) return HT_STEEL;
  if (m.name === 'copper') return HT_COPPER;
  if (m.name === 'brass') return HT_BRASS;
  if (m.name === 'aluminium') return HT_ALUMINIUM;
  if (STONES.has(m.name)) return HT_REDDEN;
  // wood, paper, cloth, foam, plastics brown before they char (not liquid fuels, wax, pitch, embers)
  if (m.combustible && m.meltingPoint >= 150 && m.name !== 'charcoal') return HT_SCORCH;
  return HT_NONE;
});

// visible emissivity of bright metal (the sim's emissivity is a mean over its life), and of a
// fully oxidised surface (metals: sim char is their oxide layer)
const BARE_EPS = { steel: 0.6, steelProfile: 0.6, copper: 0.15, brass: 0.1, aluminium: 0.1 };
const OXIDE_EPS = { steel: 0.9, steelProfile: 0.9, deckSteel: 0.9, copper: 0.8, brass: 0.6, aluminium: 0.25 };
const bareEps = (m) => BARE_EPS[m.name] ?? m.emissivity;
/** material id -> glow scale of the bare surface (emissivity relative to a 0.9 grey body) */
export const GLOW_EPS = Float32Array.from(MATERIALS, (m) => Math.min(1.1, bareEps(m) / 0.9));
/** material id -> extra glow scale per unit of oxidation (char) */
export const GLOW_OX = Float32Array.from(MATERIALS, (m) => (OXIDE_EPS[m.name] !== undefined ? Math.max(0, OXIDE_EPS[m.name] - bareEps(m)) / 0.9 : 0));
