import { defaultWeather } from './sim/weather.js';

/**
 * The smithy: a smith forging a blade in his workshop, and on the test hearth by its front wall
 * the old Metal bars on burners. One definition for the scene of its own (scenarios.js
 * `metalBars`) and for the smithy in the harbour village of the Fantasy world (src/fantasyWorld.js):
 * its world, its air and its objects (models/smithy.js; the forge, the smith and his shop:
 * sim/smithy.js, render/smithy.js).
 *
 * The workshop stands at (4, 3.2) in its 8 × 7 m world, its front (the doorways) to +z.
 */
export const SMITHY_DESCRIPTION =
  "A smith's workshop. At the charcoal forge the smith works the bellows: more air through the tuyere means more oxygen to the fuel bed, so the charcoal burns faster and the fire climbs from ~900 °C (the chimney's draught alone) to 1200–1400 °C; the smoke and hot gas go up the hood and the chimney. When the blank glows yellow-orange (forging heat) he takes it out with the tongs and hammers it on the anvil (sparks, the ring of the anvil) until it cools to a dull cherry, then back into the fire; shaped, he heats it to cherry red and quenches it in the slack tub: a hiss, steam, the water warms, and the fast cooling turns the steel to hard, brittle martensite. He tempers it over the fire to its temper colour, grinds the edge and puts it in his shop next door (sword, axe, spear, dagger in turn: they pile up on the rack, the pegs and the counter). Walk in and press E at the bellows lever to blow the fire yourself; click the forge or the smith to see the temperatures, the hardness and the shop. On the test hearth by the front wall the old lesson: steel, aluminium and copper bars on burners. Copper conducts heat fastest; aluminium is first to melt; steel takes temper colours (straw, brown, purple, blue, grey) spreading from the burner. Switch the view to thermal to see the temperatures.";

/** Where the workshop's front is in its world (z of its front wall's face) and its doorways (x). */
export const SMITHY_FRONT = { z: 6.0, forgeDoorX: 3.0, shopDoorX: 6.9 };

/** The smithy's scene content (a fresh copy each call): world, exposure, weather, time, view, objects. */
export function smithyScene() {
  return {
    world: { size: [8, 4.6, 7], h: 0.1 },
    exposure: 'indoor', // (a workshop: its open doorway and windows let a little outside air in, no weather)
    weather: { ...defaultWeather(), ambient: 18 },
    timeScale: 3,
    view: { camera: [-1.5, 2.6, 5.2], walk: true },
    objects: [
      { type: 'smithy', params: {}, x: 4, z: 3.2 },
      // the test hearth: bars as thick as a finger on gas burners (thinner than the voxels: models/metalBar.js)
      { type: 'metalBar', params: { material: 'steel', length: 1, thickness: 0.04, elevation: 0.4, burnerPower: 4000, flameRadius: 0.06 }, x: 1.35, z: 4.85 },
      { type: 'metalBar', params: { material: 'aluminium', length: 1, thickness: 0.04, elevation: 0.4, burnerPower: 4000, flameRadius: 0.06 }, x: 1.35, z: 5.15 },
      { type: 'metalBar', params: { material: 'copper', length: 1, thickness: 0.04, elevation: 0.4, burnerPower: 4000, flameRadius: 0.06 }, x: 1.35, z: 5.45 },
    ],
  };
}
