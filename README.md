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
  next to a house, a garden on a dry day, a forest fire in fog, gas cylinders in a bonfire,
  what a car's fuel tank does in a fire, a gas pipe bursting in an office hallway (with or without sprinklers),
  oak, willow and pine in a grass fire, a fire below the waterline of a ship, a house fire in the
  rain.
- **Simulation**: pause and time scale. The HUD shows the speed actually reached; big
  scenes run slower than real time on slow machines.
- **Weather**: air temperature, humidity, wind speed and direction, rain and fog. All of
  these can be changed while the fire burns.
- **View**: realistic or thermal-camera mode, flames, smoke, steam, fire light, and a
  section cut to look inside objects (for example heat soaking into a wall).
  - *Surfaces*: **voxels** (exactly what is simulated) or **smooth**, a surface-nets mesh of
    the voxel field, rebuilt chunk by chunk as things burn, melt and collapse.
  - *Smoke & flames*: **particles** (fast) or **volumetric**: ray-marched in a shader through
    3D textures of the air grid, with absorption, self-shadowing, fire-lit smoke and
    emissive flames, clipped by the scene depth. *Volume quality* sets the number of
    ray-march steps.
- **Fire start**: every fire start (and a pending gas-pipe burst) is shown with a marker. The
  *Set fire start* tool picks your own (Shift+click adds more). You can return to the
  scenario's own start, or start without any fire and light it yourself.
- **Tools** (click on a model; dragging still orbits the camera):
  - *Inspect*: material, core and surface temperature, fuel left, moisture, state.
  - *Ignite*: a lighter.
  - *Fire torch*: hold the left mouse button to play a flame on a spot.
  - *Hand grenade*: lobbed to the clicked spot, goes off after 2.5 s. The blast throws light
    parts as debris, breaks windows, bursts gas pipes in range and its flash ignites what is
    close.
  - *Open / close door*: doors can be opened and closed.
  - *Remove oxygen*: floods the enclosed space you click with inert gas. If the space is open
    to the outside, the gas leaks away.
  - *Water bucket*: cools, wets and puts out the fire, making steam.
  - *Fire extinguisher*: hold the left mouse button to spray where you point; right-drag
    rotates the view meanwhile. Choose water, AFFF foam, CO2 or dry powder (ABC). Each has
    a realistic capacity, discharge rate and reach, and a refill button.
- **Scene objects**: every object's parameters, position, rotation and "burning at start"
  can be edited, objects can be added and removed, and the world size and voxel size
  can be changed. Edits restart the simulation. Scenes can be exported and imported as JSON.

## Firefighter walk-through

Press **Walk through as a firefighter** (made for the hallway scenario, but it works in any
scene). You walk in first person wearing breathing apparatus:

- **Interacting:** **E** opens or closes the nearest door, or picks up the wall extinguisher
  (slot 4) or the hose reel (slot 5, which only reaches as far as its 30 m hose). **O**
  floods the room you are in with inert gas.
- **Controls:** WASD to move, the mouse to look, Shift to hurry, and **C to crawl**. Below
  the smoke layer you can see further and it is cooler.
- **Handheld tools:** 1 / 2 / 3 select the hose (fog nozzle), the fire torch or a hand
  grenade, and the left mouse button uses them.
- **T** toggles the thermal imaging camera, which sees through smoke. **L** toggles the
  helmet lamp.
- **Health:** hot gas and radiant heat get through the turnout gear, flames can set your gear
  alight (crawl to roll it out, or get water on yourself), falling and flying debris hurt,
  and running out of air or breathing smoke through a broken mask is deadly. At zero health
  you collapse and can try again.
- **The visor:** cracks from heat and from things falling on you, and can fail completely, so
  that air leaks and smoke gets in. Bright light (the fire, the sun) gives glare and a ghost
  reflection, and the helmet lamp lights up thick smoke in front of you.
- **Mask display:** your remaining air (consumption depends on effort and heat), the gas
  temperature at your face, a visibility estimate, and warnings. The visor fogs up in
  steam and its edges glow red when it gets too hot.
- **Sound:** generated live, with no audio files: the breathing apparatus (demand-valve
  click, inhale, exhale; faster when you work hard or get hot), positional fire roar and
  crackle, the hiss of a gas jet, the hose, the low-air whistle, a heartbeat under heat
  stress, and blasts.

## Models and their parameters

| Model | Parameters |
|---|---|
| Tree | species: **oak** (heavy forking limbs, leaf clusters), **weeping willow** (arching limbs, hanging whips), **pine** (whorls, needle clusters, dead lower branches); height, trunk and crown radius, foliage density, foliage and wood moisture, main branches, seed |
| Grass patch | size, height, density, moisture (dry vs green), rectangle/ellipse, bare circle in the middle |
| Car | length, width, height, paint and seat colour, fuel litres, plastic or steel tank, fire starts in engine or interior |
| House | size, wall height and thickness, walls (brick/wood/concrete), roof (tiles/wood shingles/metal), roof pitch, windows, furnished, door open, chimney |
| Candle | height, radius, paraffin or beeswax, colour, wick length, holder |
| Metal bar on burner | steel/aluminium/copper, length, thickness, elevation, burner power and position, supports |
| Wood pile / campfire | log cabin / teepee / stack, number, length and radius of logs, moisture, kindling, stone ring |
| Gas burner | power, flame radius and height, nozzle height |
| Wooden fence | length, height, boards or rails, moisture |
| Gas cylinder (propane) | capacity, fill level, relief valve working/blocked, colour |
| Ship section | length, beam, depth, draft (waterline), corridor width, furnished cabins, sprinklers, fuel line burst delay and power. Two decks, the lower one below the waterline, a long corridor plus cross corridors out to the hull sides, cabins, a stair, cabin and watertight doors |
| Building hallway | size, walls, paint colour, suspended/plain ceiling, void depth, cable tray, doors, entrance, end window, gas pipe in the ceiling void or along the wall, burst on a timer or only by fire/blast, burst position, delay and power, boxes, notice board, carpet |

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
8. **Suppression.** Rain falls down every column. Each surface intercepts part of it and
   porous fuels let some through, and drops falling through hot gas evaporate, cooling the
   plume and damping the flames. Water on a surface first boils off (cooling, steam), then
   soaks in. Burning slows in proportion to how close the water supply is to the
   **critical application rate** of about 4 g/m²·s, above which flaming is quenched.
   The extinguisher agents act through different mechanisms:
   - *Water* cools, wets and quenches.
   - *Foam* is mostly water but also forms a blanket that smothers the surface and shields
     it from heat; the blanket slowly breaks down, faster when hot.
   - *CO2* displaces oxygen in the gas: about 35 % by volume stops flaming.
   - *Dry powder* interrupts the flame chemistry: very effective per kg, and it leaves a
     thin coating.

   CO2 and powder are carried by the air flow, so wind blows them away.
9. **Pressure vessels** (`src/sim/vessels.js`): fuel tanks and gas cylinders.
   - The vapour pressure follows the liquid temperature (Clausius–Clapeyron), plus the
     heated gas in the ullage.
   - Expanding liquid can fill the vessel completely (hydraulic overfill), after which the
     pressure rises by about 5 bar per K.
   - The shell weakens with temperature: steel loses most of its strength between 300 and
     700 °C, plastics soften towards their melting point.
   - A working relief valve vents burning vapour as a jet flame; boiling cools the liquid.
   - A shell that melts or burns through, or fails below 1.5 bar, splits and leaks into a
     pool fire. This is what car fuel tanks do.
   - Above that pressure the vessel **bursts**: a blast throws the shell and light nearby
     parts as tumbling, burning debris that lands and keeps burning, windows break, and the
     flashing liquid becomes a fireball sized by the standard correlations (D ≈ 5.8 m^⅓,
     t ≈ 0.45 m^⅓).
10. **Building materials breaking down.**
    - Thin steel profiles buckle at about 550 °C, mineral-fibre ceiling tiles drop when
      their binder burns out (about 400 °C), and calcined plasterboard crumbles at about
      650 °C.
    - Ceiling tiles are separate panels: each rests on the grid, not on its neighbours,
      so single tiles drop and whole sections fall when hangers fail.
    - Paint discolours, blisters (and smokes), then peels off in flakes.
    - Damp concrete spalls when heated quickly.
    - Gas pipe joints give way when heated, and pipes burst in a blast, each time
      releasing a burning gas jet.
11. **Branches breaking.** Each tree species has its own wood. Charred willow branches snap
    early and drop, burning; pine branches break later; oak limbs mostly burn in place.
    Everything beyond a break falls with it.
12. **Smoke filling enclosed spaces.** Walls and slabs one voxel thick block the air grid
    exactly at the faces they close, so smoke stays inside buildings. Under a ceiling, hot
    gas spreads sideways as a ceiling jet. The layer deepens as the fire keeps adding gas,
    and gas only rises if it is hotter than the gas above it.
13. **Oxygen.** The air carries an oxygen fraction. Burning consumes about 1 kg of oxygen per
    13.1 MJ released (Thornton's rule), and flames weaken as oxygen falls, dying out below about
    15 % by volume, while embers can still smoulder. Air cells are grouped into connected spaces
    through their open faces. A closed space keeps an exact oxygen budget, so a fire in a sealed
    room starves; opening a door or breaking a window feeds it again. CO2 works by displacing
    the oxygen, and *Remove oxygen* floods a room with inert gas.
14. **Water.**
    - Water that surfaces cannot absorb runs off into shallow puddles. These spread over flat
      floors, soak what stands in them and turn into water voxels once deep enough. Water
      voxels flow, fill low spaces, soak what they touch and boil off as steam.
    - Sprinkler bulbs heat with the gas around them (RTI about 50 (m·s)^½) and burst at
      68 °C. Each head then sprays about 60 l/min.
    - Cold water on hot brittle walls cracks them (thermal shock), and soaked plasterboard
      and ceiling tiles go soft and fall.
    - At sea, any missing hull plating below the waterline lets the sea in at
      √(2 g depth) (Torricelli). The sea pressure keeps water from running back out, so the
      ship floods towards the waterline.
15. **Structure.** A flood fill from the ground finds parts that are no longer supported
   (a burnt-through trunk, a roof whose beams are gone), and they fall.

Calibration targets used during development (`npm run headless`):

| Case | Target | Simulated |
|---|---|---|
| Candle flame | ~60–100 W | ~25 W while the wax is solid, ~70–100 W with a melt pool |
| Campfire, 8 logs | 20–60 kW, logs catch from kindling in a few minutes | ~15–60 kW |
| Grass fire, 2 m/s wind | ~0.1–0.3 m/s spread | ~0.08 m/s from a point ignition, accelerating |
| Car fire | slow growth over ~10 min, spreads to nearby buildings | ~0.1 → 0.6 MW in 11 min, then the house next to it |
| Metal bars | copper spreads heat furthest, steel keeps a steep gradient | yes |
| Campfire in 50 mm/h rain | dies down, core keeps glowing | −55 % in 4 min, still dropping |
| 11 kg propane cylinder in a fire | relief valve opens around 17.5 bar; blocked valve: overfill and burst | vents at 17.5 bar after ~13 min; bursts at ~99 bar after ~17 min |
| Car fuel tank in a car fire | thin tank fails and leaks; explosions are very rare | splits, pool fire to ~10 MW |

### Limitations

This is a real-time, approximate model, not a CFD fire code like FDS. The air flow is not
pressure-projected. Radiation is a blurred field without real shadowing, corrected by a
view factor. A voxel stands for its material, so geometry finer than the voxel size is
represented through effective density and surface factors. Results are qualitatively
right and of the right order of magnitude, but should not be used for engineering.

## Why voxels?

The voxels are the *simulation*, not just the look. Heat has to flow *through* material
(into a log, along a bar, through a wall), objects have to change shape as they burn,
melt and collapse, and neighbouring objects have to exchange heat. That needs a
volumetric state: temperature, fuel, moisture and melt state everywhere inside every object.
A mesh with a fire shader only paints flames and char on a fixed surface and cannot do any
of that. The way games and VFX tools do it (Houdini Pyro, EmberGen) is the same: simulate
on grids, then render the result.

Rendering is a separate choice, and both options are available in **View**. The *smooth*
surface mode extracts a mesh from the voxel field (surface nets) and colours it from the
voxel state, so char, wetness, foam, incandescence and the thermal view carry over.
*Volumetric* smoke ray-marches the simulated smoke, steam, flame and hot-gas fields in a
fragment shader. A shader can render any volume, but it needs those fields to march
through; the simulation provides them, for every scenario. A possible next step is moving
the simulation itself to the GPU (WebGPU compute) for larger scenes.

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
src/render/     three.js rendering: voxels or smooth surfaces, flames/sparks, particle or
                volumetric smoke/steam, rain, extinguisher spray, debris, view
src/main.js     app, controls panel, HUD, tools
src/scenarios.js  built-in scenes
scripts/        headless runner, profiler and tracing helpers
test/           node:test suites
```
