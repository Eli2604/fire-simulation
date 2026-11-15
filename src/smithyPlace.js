import { defaultWeather } from './sim/weather.js';

/**
 * The smithy: a smith forging a sword (all of it voxels: sim/smithy.js). Its one definition, for
 * the smithy in the harbour village of the Fantasy world (src/fantasyWorld.js; the old key `metalBars`
 * opens it) and for the smithy in the harbour village of the Fantasy world (src/fantasyWorld.js):
 * its world, its air and its objects (models/smithy.js; the forge, the smith and his shop:
 * sim/smithy.js, render/smithy.js).
 *
 * The workshop (one room at 4 cm voxels: forge, anvil, slack tub, grindstone, the rack of its shop
 * corner) fills its 2.96 × 2.72 m world, its front (the doorway) to +z.
 */
export const SMITHY_DESCRIPTION =
  "A compact smith's workshop at fine voxels (4 cm): one room with the forge, the anvil, the slack tub, a grindstone and the rack of his shop corner by the door,, where the smith forges a sword and all of it is the voxel physics. The forge's fire pot is full of real charcoal voxels burning in the room's air; the bellows blow through the tuyere into the bed through the air model (fresh oxygen and the jet's speed), so the charcoal burns faster and hotter, from ~1000 °C on the chimney's draught alone to 1300–1400 °C; the smoke and hot gas go up the hood and the chimney, and the charcoal burns away (he tops it up from the bin). The sword is a body of steel voxels (a tang and a 72 cm blade, two voxels wide at its base, thinner and narrower towards the point) that goes wherever his tongs take it, carrying its heat: in the fire the heat runs along it by conduction and the thin point glows first; on the anvil it loses heat into the anvil's steel (and rings or thuds under the hammer by how hot it is); quenched in the slack tub it gives its heat to the water voxels around it: the water at the steel boils, steam comes off the surface into the air, the water warms, and each voxel's fast cooling (its own 800→500 °C time) turns its steel to hard martensite. He tempers it over the fire to its temper colour, grinds it and stands it on the rack to cool; cold, it joins the weapons on display. Walk in and press E at the bellows lever to blow the fire yourself; click the forge or the smith to see the temperatures of the fire, the blade (point and base), the water and the hardness. Switch the view to thermal to see the heat.";

/** Where the workshop's front is in its world (z of its front wall's face) and its doorways (x). */
export const SMITHY_FRONT = { z: 2.68, forgeDoorX: 1.6 };

/** The smithy's scene content (a fresh copy each call): world, exposure, weather, time, view, objects. */
export function smithyScene() {
  return {
    world: { size: [2.96, 2.56, 2.72], h: 0.04, maxDt: 0.16 }, // (steps of 0.16 s: the air's backtrace ~4 cells at 1 m/s)
    exposure: 'indoor', // (a workshop: its open doorway and window let a little outside air in, no weather)
    weather: { ...defaultWeather(), ambient: 18 },
    timeScale: 3,
    view: { camera: [2.2, 1.6, 2.45], walk: true },
    objects: [{ type: 'smithy', params: {}, x: 1.48, z: 1.36 }],
  };
}
