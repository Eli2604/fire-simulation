import tree from './tree.js';
import grass from './grass.js';
import car from './car.js';
import house from './house.js';
import candle from './candle.js';
import metalBar from './metalBar.js';
import woodPile from './woodPile.js';
import burner from './burner.js';
import fence from './fence.js';
import gasCylinder from './gasCylinder.js';
import hallway from './hallway.js';
import shipSection from './shipSection.js';
import enemy from './enemy.js';
import catacombs from './catacombs.js';
import { carrierDeck, jet, carrierBelow } from './carrier.js';
import island from './island.js';
import spaceship from './spaceship.js';
import dragon from './dragon.js';
import church from './church.js';
import volcano from './volcano.js';

/**
 * Model registry. Every model is:
 *   {
 *     label,
 *     params: { key: { value, min?, max?, step?, options?, color?, label? } },
 *     build(params, { h, rng }) -> { prims: [...], ignite?: { p, radius, materials }, heaters?: [...] }
 *   }
 * See voxelizer.js for the primitive shapes.
 */
export const MODELS = { tree, grass, car, house, candle, metalBar, woodPile, burner, fence, gasCylinder, hallway, shipSection, enemy, catacombs, carrierDeck, jet, carrierBelow, island, spaceship, dragon, church, volcano };

export function resolveParams(model, given = {}) {
  const out = {};
  for (const [k, spec] of Object.entries(model.params)) out[k] = given[k] ?? spec.value;
  return out;
}

export function defaultParams(type) {
  return resolveParams(MODELS[type], {});
}

export { hexToRgb } from './util.js';
