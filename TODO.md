# To do: open topics

Topics to decide on later. Measured against what AAA game engines offer; strike or move an item
when it is decided or done.

## In progress

- Grid solvers (heat, air, smoke, water) on the GPU with WebGPU compute, CPU path kept as fallback.
- Shared general physics: one rigid-body core for vehicles, debris, props and ragdolls.
- Room acoustics: echo and reverb from the size of a space and what is in it.

## Verification

- Look at the recent features in a real browser: poses, sounds, film cameras, sailing, driving,
  the gate, the smithy. Most are covered by node tests only.
- Automated screenshot comparisons and frame-time budgets per scene.
- A profiler view in the app (time per solver per step).

## Scale and rendering

- Larger worlds streamed in seamlessly (levels of detail, occlusion culling) instead of separate
  places built on arrival.
- Global illumination, better shadows, temporal anti-aliasing, reflections.
- Volumetric smoke, steam and fog instead of particles.
- Authored physically based art (textures, materials) instead of simple shapes.

## Animation

- Motion-captured clips and smooth blending between motions.
- Full-body inverse kinematics: feet on uneven ground, hands on grips, oars, the steering wheel.
- Ragdolls (depends on the shared physics) and facial animation.

## Audio

- Recorded samples next to the synthesised sounds.
- Sound muffled through walls and doors (occlusion), mixing groups, a better 3D positioning model.

## AI and tools

- A general navigation mesh for walkers and vehicles.
- A behaviour-tree editor and a debug view of AI decisions.
- Asset browser, visual scripting, scene version history, full undo.

## Game layer

- Save and load a game in progress.
- Gamepad support.
- Pause, settings and loading menus.
- Multiplayer.
- Localisation and accessibility options.
- The film recorder's download on the shared page (the page needs the downloads capability).

## Platforms

- Mobile tuning; consoles are out of reach for a browser app.

## Physics bugs found along the way

- `sim/water.js` makes up 0.5 kg/m²·s of new water wherever water touches a solid that cannot soak
  it up; it runs off into puddles, and the puddle code stacks water up to 5 cells above the floor,
  even on solids. The smithy clears the run-off round its tub; every other scene still floods slowly.
  Fix: wet only as much as the solid can absorb.
- Steel's heat capacity is a constant 490 J/kg·K; over 760–1050 °C it averages ~620, so hot steel
  cools ~25 % too fast everywhere. Fix: temperature-dependent heat capacity per material.

## Vehicles on the shared physics engine: what is left

- One physics world for all: today each vehicle kind (and each helicopter) has its own, so a car
  never meets a boat, helicopters don't meet each other, and debris hits vehicles' voxels without
  the vehicles feeling it. Vehicles don't feel explosions either.
- Boats and the helicopter are carried by their own models (no HullBuoyancy / RotorForce force
  generators yet); people in a car's way are still handled by the old code (people are not bodies).
- Car–car impacts slightly lopsided (bounce applied in one pass in the solver).
- The carrier hull is not a body; boats against it unchecked. The helicopter's mass ignores fuel burnt.
- Cost: car stepping ~2–3× (alone), ~40 % in a voxel street; helicopter ~4×.

## Known limits of features already built

- Blue and red soldiers look the same; you can shoot blue soldiers.
- The smith follows a fixed routine and cannot be hurt by fire.
- Cars: no gearbox creep at idle; collisions treat the body as a box; hitting the player gives a
  fixed hit; enemies lose sight of you while you drive or row.
- Ruts are flat marks (except in snow) and are not saved with the scene; ice never breaks under a car.
- Boats cannot run up a beach; the wake does not move the water surface.
- Film cameras: one track only; a dissolve needs touching clips; framing ignores roll.
- The gate: sentries walk straight to the barrier; no driver gets out to open an unmanned gate;
  ordinary doors are not managed gates.
