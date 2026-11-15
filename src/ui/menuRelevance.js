/**
 * Which parts of the Play menu (src/main.js) apply to where you are: the Dragon folder only with
 * dragons, the jet flights only with flights of jets, the squads only with soldiers or guards, the
 * full weather only outdoors (indoors, underground, in a sealed cabin only the air), the ice and
 * the water's look only where there is water that can freeze, the lake's cold snap only by fresh
 * water, the door tool only with doors. Re-evaluated whenever the scene or the place changes.
 *
 * summarizeWorld(world, place) reads a built world into a small summary; menuRelevance(summary)
 * turns that into the set of visible menu keys (pure: tested in test/menuRelevance.test.js).
 */
import { IceField } from '../sim/ice.js';
import { exposureOf } from '../sim/weather.js';

const SEA = -2; // (sim/ice.js: a column of open sea)

/**
 * What the menu needs to know of a built world (`place`: the zone or scene it was built from,
 * for its exposure).
 */
export function summarizeWorld(world, place = null) {
  const exposure = exposureOf(place ?? (world?.indoor ? { indoor: true } : null));
  let water = false;
  let freshWater = false;
  // water open to the sky (what freezes: sim/ice.js), not in the dark, in vacuum or indoors
  if (world && exposure === 'outdoor' && !world.dark && !world.vacuum && !world.indoor && world.colTop) {
    let top = world.ice?.top;
    if (!top) {
      try {
        top = new IceField(world).top;
      } catch {
        top = null;
      }
    }
    if (top)
      for (let c = 0; c < top.length; c++) {
        if (top[c] >= 0) {
          freshWater = water = true;
          break;
        }
        if (top[c] === SEA) water = true;
      }
  }
  return {
    exposure,
    dragons: world?.dragons?.length ?? 0,
    flights: world?.flights?.length ?? 0,
    enemies: world?.enemies?.length ?? 0,
    doors: world?.doors?.length ?? 0,
    water,
    freshWater,
  };
}

/** Every key menuRelevance can return (the parts of the menu it decides on). */
export const MENU_KEYS = [
  'dragon', // the Dragon folder (snatch, fight)
  'flights', // Jet flights (formations)
  'squads', // Squads (fire teams)
  'weather.outdoor', // the full weather (wind, rain, sky, seasons, snow, presets); else only the air
  'weather.water', // the water's look (clarity, turbidity, grease, turbulence)
  'weather.ice', // ice on the water: its thickness, how fast it forms, Hard frost, Watch it freeze
  'preset.coldSnap', // Cold snap: the lake frozen over (fresh water)
  'preset.lightning', // a lightning strike now (outdoors)
  'tool.door', // Open / close door
  'tool.squadThreat', // Squad: set the threat
];

/** The menu keys that apply to a world (its summary: summarizeWorld). */
export function menuRelevance(s) {
  const on = new Set();
  const outdoor = (s.exposure ?? 'outdoor') === 'outdoor';
  if (s.dragons > 0) on.add('dragon');
  if (s.flights > 0) on.add('flights');
  if (s.enemies > 0) on.add('squads').add('tool.squadThreat');
  if (s.doors > 0) on.add('tool.door');
  if (outdoor) {
    on.add('weather.outdoor').add('preset.lightning');
    if (s.water) on.add('weather.water').add('weather.ice');
    if (s.freshWater) on.add('preset.coldSnap');
  }
  return on;
}
