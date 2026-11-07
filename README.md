# Fire simulation

A browser-based, physically inspired fire simulation on parameterisable 3D models.
Objects are built from voxels of real materials. Heat conducts through them, they
dry, melt, pyrolyse, ignite, burn, char and collapse. Flames, hot gas and radiation
spread the fire to neighbouring objects. Smoke and steam depend on the material,
on how hot it is compared with its surroundings, and on the weather (wind, rain,
fog, humidity).

Built with [three.js](https://threejs.org) and [lil-gui](https://lil-gui.georgealways.com). The simulation core
(`src/sim`) has no dependencies and also runs headless in Node.

## Quick start

```bash
npm install
npm run dev        # open the printed URL
npm run build      # static build in dist/ (relative paths, works on GitHub Pages)
npm test           # physics + scene tests (node:test)
npm run headless -- campfire 600   # run a scenario without rendering, print what happens
```

## Using it

- **Scenario**: campfire, candles, metal bars on burners, a wind-driven grass fire, a car fire
  next to a house, a garden on a dry day, a forest fire in fog, a house fire in the rain.
- **Simulation**: pause and time scale. The HUD shows the speed actually reached; big
  scenes run slower than real time on slow machines.
- **Weather**: air temperature, humidity, wind speed and direction, rain and fog. All of
  these can be changed while the fire burns.
- **View**: realistic or thermal-camera mode, flames, smoke, steam, fire light, and a
  section cut to look inside objects (for example heat soaking into a wall).
- **Tools** (click on a model; dragging still orbits the camera):
  - *Inspect*: material, core and surface temperature, fuel left, moisture, state.
  - *Ignite*: a lighter.
  - *Blow torch*: a burner held on a spot for a set time and power.
  - *Water bucket*: cools, wets and puts out the fire, making steam.
- **Scene objects**: every object's parameters, position, rotation and "burning at start"
  can be edited, objects can be added and removed, and the world size and voxel size
  can be changed. Edits restart the simulation. Scenes can be exported and imported as JSON.

## Models and their parameters

| Model | Parameters |
|---|---|
| Tree | species (deciduous / conifer), height, trunk radius, crown radius, foliage density, foliage and wood moisture, branches, seed |
| Grass patch | size, height, density, moisture (dry vs green), rectangle/ellipse, bare circle in the middle |
| Car | length, width, height, paint and seat colour, fuel litres, plastic or steel tank, fire starts in engine or interior |
| House | size, wall height and thickness, walls (brick/wood/concrete), roof (tiles/wood shingles/metal), roof pitch, windows, furnished, door open, chimney |
| Candle | height, radius, paraffin or beeswax, colour, wick length, holder |
| Metal bar on burner | steel/aluminium/copper, length, thickness, elevation, burner power and position, supports |
| Wood pile / campfire | log cabin / teepee / stack, number, length and radius of logs, moisture, kindling, stone ring |
| Gas burner | power, flame radius and height, nozzle height |
| Wooden fence | length, height, boards or rails, moisture |

Models are made of simple shapes (box, cylinder, capsule, sphere, ellipsoid, cone, gable
roof) in their own frame. These are voxelised at any position, rotation and resolution.
Each shape has a material, optional fill probability (foliage, grass), moisture, colour
and an **effective density**. The density lets a 15 cm voxel stand for a 1.5 mm car
panel, a 6 mm glass pane or a 24 mm roof tile with the right mass, heat capacity and
fuel, so results do not depend on the voxel size.

### Adding a model

Create `src/models/myModel.js` and register it in `src/models/index.js`:

```js
export default {
  label: 'Bench',
  params: { length: { value: 1.6, min: 0.5, max: 4, step: 0.1, label: 'Length (m)' } },
  build(p, { h, rng }) {
    return {
      prims: [{ shape: 'box', min: [-p.length / 2, 0.4, -0.2], max: [p.length / 2, 0.45, 0.2], material: 'wood' }],
      ignite: { p: [0, 0.45, 0], radius: 0.2, power: 3000 }, // optional
      heaters: [], // optional: burners { pos, power, radius, height }
    };
  },
};
```

Materials live in `src/sim/materials.js`, with all properties documented at the top of
that file.

## How the physics works

The world is a regular voxel grid (`World`, `src/sim/world.js`). A coarser air grid with
2×2×2 voxels per cell sits on top of it. Each step (`Simulation.step`, `src/sim/simulation.js`):

1. **Heat transfer in solids.** Conduction between touching voxels uses the harmonic mean
   conductivity. Exposed faces exchange heat with the gas in front of them: natural
   convection, plus wind, plus flame contact at about 1100 °C. Radiation goes both ways:
   hot surfaces emit εσ(T⁴−T∞⁴), and flames and embers feed a blurred, inverse-square
   calibrated radiation field. Absorption can never exceed emission, and irradiance is
   capped at flame black-body level.
2. **Two-node voxels.** Bulk materials have a few-millimetre **skin** that exchanges heat
   with the gas and radiation, coupled to the **core** that conducts to neighbours. Both
   are solved together implicitly, which is unconditionally stable. This is what makes
   thick logs and walls ignite at their surface in tens of seconds, as real ones do,
   instead of having to heat a whole 5–15 cm voxel. Fine fuels (grass, leaves, needles,
   kindling) are single node.
3. **Moisture.** Water must boil off (latent heat) before a surface passes 100 °C; only the
   skin's water has to go before it can ignite. Dead fuels exchange moisture with the
   air humidity, and rain wets the topmost surfaces. Evaporated water becomes **steam**.
4. **Melting and solidifying** with latent heat (wax, plastics, aluminium, glass, steel).
   Molten voxels flow down and spread, convect heat, and solidify again (wax drips).
   Thermoplastics melt at the surface first, then pyrolyse and burn.
5. **Combustion.** Ignition happens when the surface reaches the piloted ignition
   temperature with oxygen (an exposed face) and is dry enough. Burning releases the heat
   of combustion:
   - part keeps the surface hot,
   - about 30% is radiated,
   - the rest heats the gas, and the burning gas is carried by the flow as **flames**.

   Bulk fuels burn per exposed area (kg/m²·s); fine fuels burn out in a residence time.
   Before ignition, hot material **smoulders** and gives off light-coloured smoke. Wood
   chars into glowing **charcoal embers** that burn slowly and leave **ash**, which
   settles like sand. Glass breaks from thermal shock, venting rooms. A wick draws molten
   wax and burns it like a candle.
6. **Air.** Velocity comes from buoyancy (√(gΔT/T)-like), wind with a height profile,
   plume entrainment and some turbulence. Solids block the flow and ceilings trap hot gas.
   Temperature, smoke (mass plus colour), steam and burning gas are advected
   semi-Lagrangian and mixed. Heat exchange with the solids is implicit.
7. **Fumes and weather.**
   - Smoke yield and colour depend on the material: rubber and plastics make black soot,
     grass and leaves make light grey smoke.
   - Fumes rise with the gas temperature relative to the ambient air.
   - Rain washes smoke out and cools; fog creates an inversion that caps the plume so
     smoke spreads sideways.
   - Steam is only visible where the vapour has cooled and condensed, and lingers longer
     in humid air and fog.
   - Smoke opacity follows Beer–Lambert with soot's mass extinction coefficient.
8. **Structure.** A flood fill from the ground finds parts that are no longer supported
   (a burnt-through trunk, a roof whose beams are gone), and they fall.

Calibration targets used during development (`npm run headless`):

| Case | Target | Simulated |
|---|---|---|
| Candle flame | ~60–100 W | ~25 W while the wax is solid, ~70–100 W with a melt pool |
| Campfire, 8 logs | 20–60 kW, logs catch from kindling in a few minutes | ~15–60 kW |
| Grass fire, 2 m/s wind | ~0.1–0.3 m/s spread | ~0.08 m/s from a point ignition, accelerating |
| Car fire | slow growth over ~10 min, spreads to nearby buildings | ~0.1 → 0.6 MW in 11 min, then the house next to it |
| Metal bars | copper spreads heat furthest, steel keeps a steep gradient | yes |

### Limitations

This is a real-time, approximate model, not a CFD fire code like FDS. The air flow is not
pressure-projected. Radiation is a blurred field without real shadowing, corrected by a
view factor. A voxel stands for its material, so geometry finer than the voxel size is
represented through effective density and surface factors. Results are qualitatively
right and of the right order of magnitude, but should not be used for engineering.

## Scene file format

```jsonc
{
  "name": "My scene",
  "world": { "size": [12, 8, 10], "h": 0.15, "ground": "soil" },  // metres; h = voxel size
  "weather": { "ambient": 20, "humidity": 0.4, "windSpeed": 2, "windDir": 0, "rain": 0, "fog": 0 },
  "timeScale": 5,
  "view": { "mode": "realistic", "camera": [6, 6, 14] },
  "objects": [
    { "type": "house", "params": { "wallMaterial": "wood" }, "x": 6, "z": 6, "rotation": 0, "ignite": true }
  ]
}
```

## Project layout

```
src/sim/        simulation (no dependencies): materials, world grid, solid + air physics, weather
src/models/     parameterised models and the voxeliser
src/render/     three.js rendering: voxels, flames/sparks, smoke/steam, rain, view
src/main.js     app, controls panel, HUD, tools
src/scenarios.js  built-in scenes
scripts/        headless runner, profiler and tracing helpers
test/           node:test suites
```
