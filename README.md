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

## The editor: Play, Edit world, Rig

One page (`index.html`, `src/editor/editor.js`) over one world, the voxel simulation. The bar
at the top switches between:

- **▶ Play** (P): the world runs, with everything under *Using it* below: the tools, the
  walk-through, squads, fire, the weather.
- **✎ Edit world** (E): the world stops at its start. On the left the scene's objects (and its
  zones, in a scene of several); click one there or in the view to select it, drag the arrows to
  move it (up too, onto a deck or a roof), the ring to turn it (W / T switch, or the buttons),
  its parameters on the right; **+ Add** opens a palette of every model (walls, crates, the deck
  with its stairs, houses, characters, fuel, furniture, nature, whole places), then a click puts
  it there. Del removes, Ctrl+D duplicates, Ctrl+Z / Ctrl+Y undo and redo. With nothing selected
  the right shows the world: name, size, voxel size, ground, weather, the fire at start. Every
  change rebuilds the scene (the voxels are made from the description).
  **Terrain** (*+ Add › Nature › Terrain*): the ground of the world shaped by areas (see
  *Terrain* below). It is laid over the whole world, first in the scene, and what stood on the
  world's ground now sits on it (y *auto*). Selected, its properties list its **areas** in their
  stack order (later ones lie over earlier ones): click one to edit it (the gizmo jumps to it),
  ↑ / ↓ move it in the stack, ⧉ duplicates, ✕ deletes; *+ Hill*, *+ Pit / lake*, *+ Plateau*,
  *+ Patch* (a surface only) and *+ Polygon* add one where the view looks. In the view every
  area's outline is drawn over the ground (the picked one orange); a click on the terrain picks
  the topmost area there. With an area picked, the gizmo's arrows move it over the terrain (the
  up arrow raises or lowers its height), the green ring (T) turns it; Del deletes the area, Ctrl+D
  duplicates it, Esc lets go of it (the terrain stays selected; Esc again: nothing). Its fields:
  name, on / off, shape (rectangle, ellipse, polygon: its corners as `x z; x z; …` metres in its
  own frame), where, size, turn, height (+ raises, − digs), raise / dig or level (flatten at the
  height), edge slope width and profile (smooth, linear, dome; 0: a cliff), roughness, surface,
  and per surface its grass moisture and tall grass, its water / lava level, its snow depth.
  **Patrols** (`editor/patrolPanel.js`, `ai/patrol.js`): with a squad, an enemy group or a soldier
  squad on patrol selected, its properties have a **Patrol** folder and the view shows its drawn
  **path** (a blue line over the ground through its waypoints, the first white, an arrow on each
  leg the way they walk it, both ways for *back and forth*, the leg back to the start dashed for a
  *loop*, a ring where they stop) and **area** (a yellow outline, a box on each corner).
  *✎ Draw path*: each click on the ground adds a waypoint at the end; a click on a leg puts one in
  there. *✎ Draw area*: each click adds a corner (into the nearest edge); *▭ Rect* / *◯ Circle* make
  a 16 × 16 m or 8 m round area round the squad. Drag a handle to move the point; click it to pick
  it: Del deletes it, Esc lets go of it, Enter or Esc ends drawing. A picked waypoint's options:
  pause there (s), look round while waiting, stance (stand / crouch), the pace of the leg to it
  (walk, patrol: weapon at the ready, run). *Clear path* / *Clear area*, *⇄ Reverse*; the order
  (*loop*, *back and forth*, *one way*: they stay at the end), the area's *random* spots or
  *sweep* (rows across it) and the **leash** (m) are in the Parameters. Path and area are text
  params in the object's frame (`patrolPath` "x,z 4s look crouch run; …", `patrolArea` "x,z; …"),
  so they move and turn with it, can be typed too, and are saved, undone and redone with the
  scene. A drawn path takes the place of the model's own patrol (the enemy rectangle, the camp
  patrol's circle); a squad with one patrols it in file as guards of its own team until contact
  (its threat offset unused), then fights as a fire team. On the leash: a man further than the
  leash outside the area (or the path, with no area) breaks off and runs back in, and they do
  not go after a threat that far out. **◇ Patrols** in the mode bar shows every squad's path and
  area (Edit: all of the scene's, dim; Play: a debug overlay of the guards' patrols as the
  world has them).
- **🦴 Rig** (R from a selected character or vehicle): a stage of its own (`rig/stage.js`) with an
  **Object** drop-down: the *soldier* (every clip, loadouts, weapons, gear, hit zones), a *squad*
  (the fire team of `models/squad.js` in formation, playing clips together; pick a member, add a
  flame trooper or a drone operator), the *dragon* (acts, wings, hit zones), the *phoenix* (acts,
  flame wings, hit zones, rebirth), a *car* (idle, drive,
  steer, doors open, burning), a *jet* (idle, taxi, gear up / down, flaps, afterburner, banking)
  a *boat* (idle bob, cruise, turn, rough sea) and a *row boat* (moored, row, four aboard,
  rough sea, holed: it floats by Archimedes, `sim/buoyancy.js`, see *Floating: Archimedes* below). The soldier's, dragon's and phoenix's zone tables are the
  ones the world's hit tests use, so what you adjust there applies when you play. The vehicles'
  hit parts (car: engine, fuel tank, tyres, cabin; jet: cockpit, fuel tanks, engines, tail, wings;
  boat: hull, engine, fuel tank, cabin; row boat: oars, rowers, hull, a hole in it letting the water in) are `models/vehicleZones.js`, shown, resized and hit on
  click in the rig; the simulation does not use that table yet. A squad, an enemy, the dragon, a
  car or the jet selected in Edit world opens with *Rig the …*; the catacombs (with their phoenix)
  with *Rig the phoenix*.

**Scene ▾**: save the scene in this browser, open what you saved, export / import JSON, a new
empty scene, and every scenario. The drone camp is a world of another scale (a swarm over
kilometres of hills, `camp/stage.js`): it opens as a stage of its own, with a way back. The
old pages `rig.html` and `camp.html` only send you on to the editor (`?mode=rig`,
`?mode=camp`; `?mode=edit` opens Edit world). `node scripts/build-rig-artifact.mjs out.html`
builds the whole editor as one file.

### Film cameras and the in-game movie

**Edit world › + Add › Cinema › Film camera** puts a camera in the world (`models/camera.js`): an
object like the others (saved with the scene, in a place / zone, moved and turned with the gizmo:
turn = pan, *Tilt X* = tilt down, *Tilt Z* = roll), drawn in Edit world as a camera with the
frustum of its lens, its keyframed path and the focus plane, never in Play or in the movie.
Its properties, in folders:

- **Lens**: presets 14 / 24 / 35 / 50 / 85 / 135 / 200 mm, fisheye 8 mm (a wide view bent back by
  strong barrel distortion), anamorphic 35 / 50 mm (2× squeeze: twice the width of view, oval
  bokeh, blue horizontal streaks, a 2.39:1 frame) or any focal length on a sensor (Super 35, full
  frame, APS-C, Super 16, Micro 4/3, large format, IMAX, 2/3"); the field of view is worked out
  from them (`cinema/lens.js`); the frame (letterbox 1.33 … 2.76, or the lens's own).
- **Focus & exposure**: depth of field from the aperture (f-stop), focal length and focus
  distance by the thin lens (manual, on its aim point, or on the subject: a focus pull follows
  it); shutter angle and frame rate (motion blur: 180° at 24 fps is 1/48 s); ISO and exposure
  compensation (auto exposure, or the ISO / aperture / shutter triangle by hand); white balance
  (K) and tint.
- **Effects**: colour grade (neutral, warm, cool, teal & orange, bleach bypass, black & white,
  vintage film, day for night, night vision, thermal — the voxels by their heat, as Play's
  thermal camera), film grain, vignette, chromatic aberration, lens distortion, bloom / glare,
  anamorphic streaks, handheld shake (the dutch angle is under Aim).
- **Aim** (`cinema/aim.js`): where it points and what it looks at. **Pan** (0: along +z, 90: +x)
  and **Tilt** (up +) are fields that turn it live (the frustum with them), and the selected
  camera has an **aim handle** in the view, a yellow ball where it looks: drag it onto a wall, a
  roof, a tree (or into the air) and the camera turns to it. **Looks at**: its own direction
  (pan / tilt), its aim point (the ball, anywhere), what it follows, or any target in the list —
  the place's characters and vehicles by name (*Dragon (koi)*, *Helicopter 1*, *Jeep 1*, *Alpha
  squad – man 3 (rifleman)*, *Boat 1*…) and the objects you aimed at before (*House 1*,
  *Crate 2*). **🎯 Aim at…** then a click in the view picks it: the character or vehicle nearest
  where you clicked, else the object you clicked (named then, the exact spot of it kept, turning
  with it), else that spot of the ground. **Framing** keeps what it looks at on a third of the
  frame (left / right / upper / lower thirds, or custom) instead of the middle, drawn as the
  thirds in its frustum; **Look smoothing** eases the aim after a fast subject; **Roll** (dutch
  angle). **⤓ Keep this direction** turns where it looks now into its own pan / tilt.
- **Move** (`cinema/rig.js`): static; keyframes; a dolly (forward / back), a truck (sideways), a
  crane (up, still looking at what it looked at); an orbit round the point it looks at or what
  it follows; follow (behind) or track (alongside) with a lag. **Follows** picks what its
  position goes with, from the same list or **🎯 Pick…** and a click in the view (an object:
  orbit it); its offset (distance back, height, sideways) and lag. What it follows and what it
  looks at are separate: stand still and look at the helicopter; follow the jeep and look at the
  dragon; orbit the church and look at a soldier. In Edit world a green line links a camera to
  what it follows, a dashed yellow one to what it looks at. (Old cameras keep their *subject by
  kind* and *which one*.)
- **Path** (Move: *path*, `cinema/path.js`): the camera travels a path drawn in the world. **✎ Draw
  path** (in Move), then each click in the view adds a point (over what you click, *new points* m
  up; in the air at the last point's height); drag a point (blue ball) to move it at its height,
  its white cone to raise or lower it; Del deletes the picked one; the points are also listed
  with x, height, z to type. The curve is a centripetal Catmull-Rom spline through the points
  (no loops where they bunch up), open or a **closed loop**, measured by arc length so a speed in
  m/s moves evenly along it however the points are spaced — or **timed per point** (a time at
  each point, the others from the speed, an easing to the next). At its end it stops, goes round
  again or goes back and forth (ping-pong). It looks along the path (its tangent, or *look ahead*
  m further on) unless its Aim looks at something (a path past the church, looking at the
  dragon); *banking* rolls it into the curves as a plane turning at that speed would. A camera
  can travel **another camera's path** (*Path: Cam A's*), spaced out on it by *start this far
  along* (m) or *start later* (s); a path can be **on** a moving thing (a ship, a helicopter, a
  car): its points are in that thing's frame and it moves and turns with it. In Edit world the
  path is drawn in blue, the camera where it is at the scrubbed time or the movie's playhead.
- **Keyframes**: scrub the timeline, frame the view, **◆ Set key here** (the view's position and
  aim, relative to the camera object, so moving it moves the whole path, and the focal length,
  focus, aperture and roll; with *Keys record the effects too* also the grain, bloom, exposure,
  white balance…). Each key has its easing to the next (linear, ease in / out / in-out, smooth,
  hold); positions follow a Catmull-Rom spline (or straight lines). **📷 Camera from view**,
  **⇢ View from camera**, **👁 Look through** (its picture with all its effects at the scrubbed
  time; Esc: back), **▶ Preview** (its move played).

**🎬 Movie** (the mode bar): the timeline of the place you are in (saved with it as `movie`,
`cinema/timeline.js`). A place has **sequences** (named; ＋ new, ⧉ duplicate, ✎ rename, 🗑
delete; the one marked *plays* is what ▶ Play movie and Play use), each a track of camera
**clips** under a time ruler (seconds of the movie, and below them, in green, of the simulation
when it runs at another speed):

- drag a **camera** (the chips above the track) onto it to put a clip there, as long as the
  camera's move (or 4 s), double click a chip to put it at the playhead;
- drag a **clip** to move it, its **edges** to trim it (trimming its start keeps its picture
  where it was: it starts later in the camera's move); clips never lie on each other — a clip
  dropped or moved onto another goes into the nearest gap it fits. Everything **snaps** to the
  other clips' edges, the playhead and a grid that follows the zoom (Shift: no snapping);
- the cut is at the clip's start; a gap between clips is black. A clip's **badge** is how it
  comes in: a cut, a dissolve (from the clip right before it) or a fade through black (also out
  of and into a gap); the yellow bar under it is how long that takes;
- the **playhead** (click or drag the ruler, or type its time in movie or simulation seconds)
  shows which camera is on and how far into its move; that camera is drawn at that moment in
  Edit world, **👁 Look** looks through it (scrubbing follows), **▶ Preview** plays the sequence
  from there with the cuts and dissolves (the world stands still), **✂** cuts the clip there in
  two;
- **☰ List**: every clip with its exact times to type — its camera, start (s of movie, or s of
  simulation), length, from when in its camera's move, its transition and how long.

Per sequence: the world's speed while it plays, **cuts on** movie time or simulation time (the
clips cut when the simulation reaches their time, however fast it runs, for a cut that must land
on an event of the simulation), fades in and out, from the scene's start. **▶ Play movie**
switches to Play, hides the UI, runs the simulation and cuts between the cameras (Esc stops and
goes back); **⏺ Record** does the same and saves the picture as a video (WebM, MediaRecorder on
the canvas, 30 fps, no sound) when it ends or on Esc. A movie saved as a shot list (the first
version) opens as a sequence *Main* with its shots one after the other.

The picture's effects are post-processing (`render/cinePost.js`, three.js `EffectComposer`): the
frame as the view drew it (any path: plain, ambient occlusion, volumetric smoke, the flames
over it) through a depth-of-field gather blur (a depth pre-pass of the scene), `UnrealBloomPass`,
a motion blur that mixes in the frames before by the shutter angle, and a final shader for
exposure, white balance, grade, streaks, distortion, aberration, vignette, grain and the bars.
None of it runs unless a camera is looked through or a movie plays. The sums (field of view,
circle of confusion, exposure, white balance, grades, motion blur weight, easing, keyframes,
moves, paths, aiming and framing, the timeline) are pure modules in `src/cinema/` (`test/cinema.test.js`,
`test/cinemaAim.test.js`, `test/cinemaPath.test.js`, `test/cinemaTimeline.test.js`).

Limits: a dissolve fades from a still of the last picture (not two cameras rendered at once);
motion blur is an accumulation over frames (a smear behind what moves, not per-object vectors);
the fisheye is a wide perspective view bent round (up to 150°), not a true 180° fisheye; flames,
sparks and spray take the depth of field of what is behind them; a movie uses the cameras of the
place you are in; one track (no picture-in-picture, no clips on top of each other); framing on the
thirds leaves out the roll (a dutch angle moves the subject a little off its third); the aim
handle of a keyframed or following camera is its look target (its own keys aim it otherwise); a
camera in another object turns in the world when you let go of its handle (the world rebuilt); a
path attached to a moving thing follows its position and heading (not its pitch or roll), and
its points are edited where that thing stands in Edit world.

## Using it

- **Scenario**: a smithy (a smith forging blades at a charcoal forge he blows up with the bellows – E at the lever to work it yourself –, quenching them in the slack tub and putting them in his shop; steel, aluminium and copper test bars on burners by the wall; `?scenario=metalBars`), gas cylinders in a bonfire,
  what a car's fuel tank does in a fire, a gas pipe bursting in an office corridor with sprinklers (the headquarters of the military base),
  the **Fantasy world** (`?scenario=fantasy`, src/fantasyWorld.js, models/fantasyIsland.js): the dragon isle in a sea of its
  own, one land of several places: the dragon island (hills, a canal, a pond, a gothic church under construction, a campfire,
  a house, the volcano, the waterfall with its walkway, river and mill, the dragons) with the catacombs of limestone and
  stacked bones under the church (torches, guards), the harbour village where you arrive (its landing stage, a boat
  round the coast) with the smithy off its square, a castle on a hill (models/castle.js: curtain walls, towers, a
  gatehouse with a portcullis and gates, the keep, a timber hall and stables) and below it the forest fire in fog in the
  valley between the castle hill and the ridge on the south coast; roads join them (signposts: E), the ground between
  the places drawn from the same height function as their voxels;
  an aircraft carrier with a flyable jet, a server room below deck and a gas line bursting in its main passageway (sprinklers; a rack of gas cylinders in the store room off it),
  its lower decks below the waterline (a fuel line bursts against the hull, the sea pours in, the ship settles and lists),
  in an island group (an islet with a campfire, the military base on the camp island), and a
  spaceship in orbit above them, and the lake house (tea on the veranda by its lake, its garden
  with the washing line and the barbecue, a meadow with a wind-driven grass fire, and beside it
  oak, willow and pine in a grass fire) and the street
  beside it (a car fire next to a house, a garden on a dry day), all places of
  the carrier's world, and a house fire in the rain.
  (Old links to scenes that are now places of a world, `?scenario=laundry`, `teaGarden`,
  `winterTea` (the lake frozen), `grassFire`, `threeTrees`, `carHouse` and `neighbourhood` (the carrier's), `catacombs`
  and `foggyForest` (the Fantasy world's), open it at the place.)
- **Simulation**: pause and time scale. The HUD shows the speed actually reached; big
  scenes run slower than real time on slow machines.
- **Weather**: air temperature, humidity, wind speed and direction, rain and fog. All of
  these can be changed while the fire burns.
- **View**: realistic or thermal-camera mode, flames, smoke, steam, fire light, and a
  section cut to look inside objects (for example heat soaking into a wall).
  - *Heat colours* (realistic view, `src/render/heatColor.js`): every solid is coloured by its
    own temperature. Above about 500 °C it glows (dull red, cherry, orange, yellow, white), as
    strongly as its emissivity: bright aluminium and copper glow far less than oxidised steel or
    stone at the same temperature, and an oxide layer makes a metal glow more. The hottest a
    surface has been leaves a lasting tint: steel takes its temper colours (straw ~220 °C,
    bronze ~250, purple ~280, blue ~300, grey ~330, then black scale), copper tarnishes through
    rose, violet and blue to dark oxide, aluminium goes matte, wood, paper and cloth brown before
    they char, sandstone and limestone redden. The glow goes when it cools; the tint stays (it
    moves, falls and lands with the voxel). On the metal bars the colours spread out from the
    burner as the heat is conducted along them, and the steel glows over the flame.
  - *Surfaces*: **voxels** (exactly what is simulated) or **smooth**, a surface-nets mesh of
    the voxel field, rebuilt chunk by chunk as things burn, melt and collapse.
  - *Relief*: some surfaces are more than a colour per voxel.
    - **Bedrock** (the rough quarried rock of the catacomb ceilings and bare walls: strata,
      cracks, pick marks, soot) and the **quarry floor** (pale sand and gravel) are drawn the
      same way.
    - **Limestone** (render/patterns.js) is drawn as dressed blocks with mortar joints, chipped
      arrises and carved inscriptions, from a colour map and a height map painted on a canvas
      and mapped in world space over the whole wall. The height has real depth in the shader:
      parallax occlusion mapping marches the view ray into the stone (joints and letters sit
      in it and shift with the angle), and normals from the height field let the torches,
      the lamp and the fire light the relief correctly.
    - **Ossuary walls** (render/ossuary.js) are built of bones, as real geometry, laid out as
      in the catacombs of Paris: a facade of long bones stacked end-on, so tightly that only
      their ends show (ball heads, double knuckles, broken shafts, knobbly ends; every size,
      each a little in or out and tilted, brown with age), crossed by bands of skulls and
      crowned with a row of skulls along the top, many turned to show the back of the cranium;
      round pillars of bones ("tonneaux") laid the same way; crosses and hearts of skulls set into the bone face; engraved
      stone tablets in the wall (ossuary origins, Latin verses), some on white-washed
      pedestals; loose bones heaped on top. Lit
      and shadowed like any object. Each bone sits on the voxel face it belongs to: blast the
      wall and they go with it, char it and they blacken. Up close the bone surface has pores,
      pits and stains (procedural bump and colour in the shader). They are drawn in 4 m chunks,
      only near you and in view. The black guide line runs along the ceiling.
    - **Wall torches** are objects (an iron bracket, a wooden handle, a pitch-soaked head and
      a flickering flame) over the hidden voxels that simulate them.
    - The surface colour still darkens with soot and charring, gets wet and glows with heat.
    - **Doors** (render/doors.js) are drawn as doors over their simulated voxels, by what they
      are made of: plank doors with wrought-iron straps, rivets, strap hinges and a ring pull;
      office doors with a vision panel and lever handles; a ship's watertight steel doors with
      a stiffening frame and dog levers; framed glass doors. They swing open on their hinges,
      darken as they char, lose their glass when it breaks, and give way to the voxels once
      mostly burnt or blown away.
    - **The jet** (render/jetMesh.js) is a twin-engine fighter in the manner of the MiG-29/35
      "Fulcrum": pointed nose with a darker radome, bubble canopy, flat centre body between
      widely spaced nacelles, wedge intakes under the wing-root extensions, swept wings,
      all-moving tailplanes, twin fins on the nacelles, two nozzles, rockets on pylons. Parked
      on deck it is drawn over its (hidden) voxels; flying, it is the same model.
    - **The carrier deck** has a non-skid deck with tyre marks, painted lines, two catapult
      tracks, arresting wires, safety nets along the edges and its hull number; the island
      stands to starboard as on a Nimitz-class carrier, stepped, with the bridge, the flight
      control tier, a lattice mast and turning radars (drawn-only "props", render/props.js).
    - **The gothic church** on the island (models/church.js, render/church.js) is still being
      built. Finished: the nave (three rib-vaulted bays), the north transept arm and the
      polygonal apse, in dressed ashlar (the limestone blocks without inscriptions) under a
      slate roof, with buttresses and pinnacles, a carved west portal, pews, an altar and an
      inlaid marble rosette in the crossing ("LVX IN TENEBRIS LVCET..."). Its windows have bar
      tracery (two lancets and a quatrefoil, single lancets, a rose of twelve petals) and
      stained glass painted on a canvas: blue grounds, ruby medallions, borders, leading, iron
      saddle bars. From inside the glass glows, from outside it is dark and glossy. The glass
      casts the sun's shadow, so the sun only comes in coloured: every light of a window
      facing the sun is projected along the sunlight onto the floor and the walls behind
      (clipped to the room, the openings left out), with faint shafts of light in the air. The
      island's sun (`view.sun` of a scene or zone) is set so that the light through the south
      windows falls on the rosette. Still under construction: the tower and the south arm.
      Their masonry stops at stepped, ragged tops and their inner structure is complete and in
      view: the tower's timber frame, floors, bell and spire skeleton (with the topping-out
      fir), the south arm's roof trusses, iron tie rods and straps, the wooden centering for
      its vault ribs, and the iron armatures of windows still waiting for their glass. Pole
      scaffolding with putlogs, plank decks on every other lift and ladders stands round both,
      and a treadwheel crane lifts a block to the top of the tower. The south arm is boarded
      off from the crossing. Timber, boards, glass, pews and the altar are hidden voxels: a part
      chars with them and disappears once most of them have burnt, shattered or been blown
      away (burnt timber leaves its remains as voxels; broken glass lets the plain sun in).
  - *Ambient occlusion* (GTAO, View folder): crevices, corners and the gaps between bones get
    less light. *Torch & lamp shadows*: the two nearest wall torches and the helmet lamp cast
    shadows (underground only the objects, not the voxel walls, go into their shadow maps).
  - *Smoke & flames*: **particles** (fast) or **volumetric**: ray-marched in a shader through
    3D textures of the air grid, with absorption, self-shadowing, fire-lit smoke and
    emissive flames, clipped by the scene depth. *Volume quality* sets the number of
    ray-march steps.
- **Fire start**: every fire start (and a pending gas-pipe burst) is shown with a marker.
  *Choose where it starts* switches to the *Set fire start* tool: click the spot (Shift+click
  adds more) and the scene restarts with the fire there. You can return to the scenario's own
  start, or start without any fire (the tool then switches to the lighter, so you can set it
  alight yourself whenever you like).
- **Walk-in start**: a green marker with an arrow shows where *Walk through as a firefighter*
  puts you and which way you face. *Set the walk-in start* moves it: click a spot, and you
  will face the way the camera looks.
- **Tools** (click on a model; dragging still orbits the camera):
  - *Inspect*: material, core and surface temperature, fuel left, moisture, state (also of
    what is drawn over hidden voxels: scans, trees, grass; a garment on a washing line as a
    whole – see *Laundry on the line*).
  - *Set fire start* / *Set walk-in start* / *Place new object*: see above and below.
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
  can be changed. To add one, choose its type under *Add object*, press *Add: click the scene
  to place it* and click where it should go (on the ground, a deck or a roof). Edits restart
  the simulation. Scenes can be exported and imported as JSON.

**Deep links** open a scene directly: `?scenario=catacombs` (a key of src/scenarios.js),
`&zone=…` (a zone of it), `&walk=1` (in the walk-through), `&at=x,y,z,yaw,pitch` (standing
there, degrees), `&lamp=0` (helmet lamp off), `&freeze=1` (paused), `&shot=1` (only the 3D
view, for screenshots), `&wind=12&winddir=90&rain=8&fog=0.3` (the weather: m/s, degrees,
mm/h, 0–1), `&storm=1` (a gale with rain), `&time=21:30&day=240` (or `&date=2026-08-28`),
`&clock=running&timeSpeed=60`, `&lat=51.5` (the sky's clock), `&erupt=1` (the island volcano erupts straight
away). For example `?scenario=fantasy&zone=island&wind=8&erupt=1`.

**F1** shows or hides the information pane (the scene, its description and the figures); it
is hidden at the start. In a scene of several zones (the carrier), *Scene objects › Zone*
takes you to any of them and lists its objects.

## Firefighter walk-through

Press **Walk through as a firefighter** (made for the hallway scenario, but it works in any
scene). You walk in first person wearing breathing apparatus:

- **Interacting:** **E** opens or closes the nearest door, or picks up the wall extinguisher
  (slot 4) or the hose reel (slot 5, which only reaches as far as its 30 m hose). It also
  climbs through a hatch or ladder into another part of a ship, or into the jet. **O**
  floods the room you are in with inert gas. **F** strikes what is in front of you, which
  breaks glass loudly. At a locked door with a glass panel, break the glass and press E:
  your arm reaches through and opens the door from the other side.
- **Controls:** WASD to move, the mouse to look, Shift to hurry, and **C to crawl**. Below
  the smoke layer you can see further and it is cooler.
- **Handheld tools:** 1 / 2 / 3 select the hose (fog nozzle), the fire torch or a hand
  grenade, and the left mouse button uses them. **6 is a bow with fire arrows**: hold the
  button to draw (a longer draw shoots faster) and release to shoot. An arrow sticks in what
  it hits and sets it alight (it burns about 25 s), goes through windows and breaks them,
  and wounds enemies. **7 (or Q, to swap to it and back) is a rifle**: it fires while you hold
  the button, 30 rounds to a magazine, and R reloads. Hold the **right mouse button** to bring it
  up to your eye: you look along its reflex sight (a red dot), the view zooms in a little, the
  mouse turns you more slowly, shots go where the dot is, and you walk more slowly.
- **M takes the mask off or puts it back on.** Either takes about a second: your hand goes up to
  it, the straps, the face piece over your head and the demand valve sound as it comes off or
  clicks back in. With the mask off you breathe the air round you, not the cylinder. Smoke,
  hot gas (above about 60 °C it burns the airway), too little oxygen and radiant heat on your
  face all hurt you. Smoke makes your eyes sting and water (the view blurs) and you cough.
  Under water you hold your breath for about half a minute. The display in the visor goes
  with the mask: you see only your health and what you hold. Put back on, the mask mists up
  for a moment.
- **T** toggles the thermal imaging camera, which sees through smoke. **L** toggles the
  helmet lamp.
- **Water:** you wade through water (it holds you back), swim with your head out where it is
  deep and there is air above it, and walk the bottom in full gear where the space is flooded
  to the ceiling. Under water the mask is your only air (you use more of it); without air or
  with a broken mask you drown. The sea pouring in through a hole pushes you away from it.
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
  stress, breaking glass, the bow, enemies' footsteps and shouts, and the jet engine. A blast
  (a grenade, a rocket) has a sharp crack, the bang, a deep boom and a rumble with echoes, then
  the debris coming down. It arrives as late as sound takes to travel and is duller from far
  off. Close by it deafens you for a moment and your ears ring.

### Enemies

Some scenes (the catacombs, below deck on the carrier, the island, the spaceship) have guards
in them: soldiers with human proportions (render/enemies.js) in olive fatigues and grey armour:
a plate carrier with webbing and pouches, shoulder plates, elbow and knee pads, shin guards,
gloves and boots; a helmet with ear guards, a dark glass visor and a breathing filter; a power
pack and a bullpup rifle. They walk and run with knees and elbows, carry the
rifle at low ready and raise it when they investigate, hold up a torch to set a lure fire,
burn, and fall. A light strip under the visor shows what they are up to: cyan on patrol, amber when they come to
look, red once they have seen you. The guards of one post go as a team, as soldiers do: one
leads, the others follow in file on the way he went, about 3.5 m apart (not bunched, where one
burst or one grenade would get them all). When the leader goes to look at something, the others
hold back at that distance and cover him; when he turns back the way they came, the file turns
round and the last man takes the point. No two bodies stand in one place: they step round each
other and you. They:

- **patrol**: around where they start, at random spots inside a **patrol area**, or along a
  **guard round** (the corners of the area, in turn). Areas are set per enemy group (Patrol,
  area width and depth, offset) and shown as red outlines with the markers, or drawn in the
  editor (a path of waypoints with stops and paces, an area of any shape, a leash: *Patrols*
  in the editor section; `ai/patrol.js`). After
  investigating or luring they go back to their area.
- **hear noises**: breaking glass, doors, explosions, arrows hitting, rockets.
  They go to look where a noise came from. Loud noises carry further. An explosion brings
  them running, and they search round the place for a while before going back.
- **see you** unless smoke or walls are in the way. They shout, keep their distance, and
  try to **lure you** by lighting something nearby (rags, coffins, boxes) with a torch, out
  of your reach, and then pull back.
- **notice your light**: underground, a spot lit up by your helmet lamp that they can see,
  and that no torch explains, makes them come and look (switch the lamp off with L; the
  thermal camera still works).
- **use doors**: their routes go through any door they can open (not locked ones). They push
  a closed door open when they reach it, and most of them close it behind them once they are
  through (not when someone is in the doorway).
- **avoid fire**: their path finding (A* on a 0.4 m grid) treats hot gas, flames and thick
  smoke as costly. They flee from heat, and catch fire and burn like you do.
- are hurt by arrows, rockets, blasts, heat and **falling debris**. A branch or ceiling
  part hits with its real mass and speed (½·m·v²), so a burnt-off oak limb is dangerous.
  The same applies to you.

### The dragon (island)

A dragon lives on the island (models/dragon.js for its lair and route, ai/dragon.js for how it
moves and hunts, render/dragon.js for how it looks). It is about 9 m from nose to tail, with a
13 m wingspan, and is built from real animals:

- **Skin like a fish.** Overlapping cycloid scales cover it, each free edge facing the tail,
  with growth rings and a lip where the scale lifts over the next row (painted and bump
  mapped). It is countershaded like a tarpon or a carp: a dark back, metallic flanks and a pale
  belly, with a lateral line. A wet clearcoat and thin-film iridescence make the scales shine
  the way real ones do. A fin of bony rays runs along its back, its tail ends in a fin above
  and below, and gill covers sit behind its jaws. The *Scales* option picks bronze, tarpon or
  koi colours.
- **Teeth after the great white shark.** They are flat, serrated triangular blades, broad in
  the upper jaw and narrower and more pointed in the lower. They stand in two rows: the
  working row upright and the replacement row folded back behind it.
- **The head** is that of a big monitor lizard: slit-pupilled eyes under bony brows, swept-back
  horns, and a forked tongue that flicks out to taste the air. Before it breathes fire its
  throat glows through the scales.
- **It crawls like a lizard.** Its legs sprawl out to the sides, and the diagonal pairs (left
  front with right hind) step together. Its trunk swings side to side in a standing wave and
  a travelling wave runs down its tail. It lies down to rest, chin and belly on the ground.
  It runs at up to 5.5 m/s, faster than you. It swims across the canal, and it climbs walls
  and roofs, belly to the wall, its body draping over the edge behind it.
- **It flies like a bird.** Its wings are built like a bird's, with an arm, a forearm and a
  hand. Long bony fin rays stand in for the flight feathers, and the outer ones part at the
  tips like an eagle's primaries. On the ground the wings fold in a Z against its flanks. To
  take off it crouches and leaps. It flaps to climb and glides to come down, and banks into
  its turns (tan bank = v·ω/g). On the upstroke the wrist flexes and the wing shortens. It
  flares with deep wingbeats to land. It cannot hover, so from the air it attacks in passes.
- **Fire.** A gland in its throat feeds a jet of burning liquid (with a wind-up: the throat
  glows and the jaws open). In the simulation this is a real directional jet flame of about
  3.5 MW. It burns oxygen, heats the air, radiates, stops at the first solid it meets and sets
  that alight, and the splashed fuel burns on there. Whoever is in it catches fire, you
  included. The gland empties after a few bursts and slowly refills.
- **It devours.** It lunges and the jaws snap shut. The prey, a guard or you, is held crosswise
  in its jaws and then swallowed. In the walk-through you see out past its teeth until it
  swallows. Afterwards it is sated for a minute and goes back to its round.
- **Senses.** It sees far further than a guard, but walls, smoke and foliage block its view.
  Sight is traced voxel by voxel, so even a single course of roof tiles met at a slant blocks
  it. Inside a building it sees you only through a way in for the eye: an open door, a hole,
  an unfinished wall, a window still without glass, or a glazed window from within about 20 m
  (the stained glass is coloured and the inside is dim). Guards trace their sight the same way.
- **It breaks in.** If it saw you and you hide in a building, it does not give up: for about
  45 s it stays and breaks the place open. It breathes fire on the walls, the door and the
  roof, and what burns catches. It also climbs onto the building, rears up and comes down
  with its whole weight. Tiles, boards and glass go first, brick and stone crack and give
  after a few stamps, and what breaks falls in, possibly onto you. When the roof over you is
  gone you are in the open, and it comes for you. Steel decks and hulls do not give. Landing
  on a roof hits it hard too: its weight on all four feet breaks boards and tiles and cracks
  stone, more the faster it comes in, so a roof it keeps landing on gives way.
  Resting, it only notices what comes close. Blasts wake it, and it remembers who hurt it.
- **Its feet are heard.** Every time a diagonal pair of feet comes down there is a thud, heavier
  when it runs and heaviest when it lands on all four. The guards hear it too, and its
  wingbeats, its roar and its swallowing are heard as well. Guards run from it.
- **Wounds.** Fire does not hurt it. Fire arrows do, and so do rockets and blasts. Where a hit
  lands decides what it does: hit zones (head, neck, chest, belly, tail, each wing, each leg)
  follow its pose as tapered capsules, each with a damage multiplier (the head ×2.5, the wings
  ×0.3) and a bleeding rate. A wound bleeds as a soldier's does: its health drains (it heals
  only once the bleeding has stopped), blood drips from the wound (a trail of drops on the
  ground under where it crawls or flies), sprays onto what is behind the hit, and stains its
  scales. Badly hurt, it flies back to its lair to rest and heal. Killed, it falls out of
  the sky and lies on its side.
- **Its wings** tear: each counts the full damage of what hits it (WING in ai/dragon.js: three
  arrows or four bullets make a wing badly hurt, twice that makes it useless; a rocket or a
  close blast at once). A badly hurt wing beats weakly and hangs half folded: in the air the
  dragon comes down at once, as steeply as it can, on open ground ahead (anywhere, if there
  is none), and it cannot take off until the wing mends (lying still, a few minutes). A
  useless wing does not beat at all: it falls, the good wing flailing, spinning towards the
  bad one, and crashes (the faster it comes down the more it hurts; it breaks what it lands
  on). The rig page's Dragon tab has both as acts (*Wing hit: lands*, *Wing shot: falls*).

**Its route** is set on the dragon object (*Route*) as waypoints in the zone's metres:
`"x,z action; x,z action; …"`. The actions are:

- `rest`: lie down for a while.
- `climb`: crawl up and over whatever is there (walls, a roof, a steep hilltop). It goes round
  trees.
- `sniff`: stop and taste the air. At a stairway it looks in.
- `fly`: fly there and land.

Without one of these it crawls. Where there is no way on foot, it flies. On the island the
default round is:

`18,12 rest; 30,12.5 climb; 14.2,24.6 climb; 23,29 sniff; 18,12 fly rest`

1. It rests on the terrace on the hillside.
2. It crawls up to the hilltop.
3. It swims the canal to the church, climbs its east wall, crawls over the roof to the crossing
   and climbs down the far side.
4. At the stairs down to the catacombs it stops and looks in.
5. It flies back to the hill and lies down again.

Seeing prey, a noise or a wound interrupts the round, and afterwards it goes on. With an
empty route it rests in its lair, now and then flies round the island, lands somewhere to
crawl about, and goes home.

### The phoenix (catacombs)

At the far end of the catacombs a short gallery ends in a dungeon cell behind a locked gate
of iron bars, and in it, on a stone perch, sits a phoenix: a bird of fire about 1.6 m across
the wings (models/catacombs.js `phoenix` for the cell, ai/phoenix.js for what it does,
render/phoenix.js for how it looks). Get it out:

- **The key.** One guard on the round past the cell, the jailer, carries the key ring at his
  belt (Enemies › `key`). Kill him and he drops it; take it with **E**, then **E** at the gate.
  A blast that breaks the bars also opens it.
- **Caged**, it watches you, calls to you the first time it sees you and now and then spreads
  its wings in the cell. Its light throws the shadows of the bars down the gallery.
- **Freed**, it flies after you through the passages, a couple of metres behind, low under
  the ceiling (the guards' path finding, at flight height). It goes round shut doors where
  there is a way, and otherwise waits at one and calls until you open it: it cannot open
  doors itself.
- **The guards** see it by its own light, shout and shoot at it when they do not see you.
  Bullets and blasts hurt it. Fire does not, since it is made of fire.
- **Killed**, it bursts into flame (a real flame in the simulation, which can light what is
  close by) and falls to a heap of glowing ash. About 11 s later it is born again from the
  ash and goes on.
- **Out:** lead it to the foot of the entrance stairs and it flies up them and out of the
  catacombs, free.

Every feather is a flame: white-gold at the root, orange along the vane, crimson at the tip,
where it breaks up into flickering tongues of fire (a shader). The wings are built like a
bird of prey's (arm, forearm, hand; they beat with the wrist flexing on the upstroke and
fold along the back when it sits). It has a train of flame streamers for a tail, a crest of
fire, a golden hooked beak and white-hot eyes, and it sheds flames and sparks as it flies.
Its cry is a raptor's scream, made live like the other sounds.

**Its hit zones** (`ai/phoenix.js` `PHOENIX_ZONES`): body, head (×1.5), the wings (×0.6, only
when spread) and the tail (×0.4), capsules that follow its pose; a guard's round does 22 times
the zone's multiplier.

**On the rig** (Object › *Phoenix*, `rig/phoenix.js` and `rig/phoenixStage.js`): the same AI
and renderer on a stone perch in a field of its own, at dusk so its light shows. Its acts as
buttons: perch (it watches you, the camera), spread wings, call, take off, fly, hover, glide
(wings spread and still), bank, dive (a stoop with the wings half folded, its fire flaring as it
pulls out), flame burst, land on the perch, settle on the ground, burst into flame (dies, lies in
its ash and is born again) and rise from the ashes; a speed control; wing span, flames, size and
flight speed; its hit zones shown and adjusted (radius, damage), and damage on click.
`?mode=rig&phoenix=1&pact=dive&pzones=1` opens it (also `&pspan= &pheat= &psize= &pfly=
&phits=head &psteps=n &pfollow=1 &pdark=0`).

### The helicopter: crew, door guns, fast-rope, and how it comes down

Model `helicopter` (editor group *Vehicles*; `models/helicopter.js`, flown by `ai/helicopter.js`,
drawn by `render/heliMesh.js` / `render/helis.js`) is a Black Hawk-sized utility helicopter: main
rotor, tail rotor on the right of the fin, a cabin open inside with sliding doors each side, skids,
engines on the roof, a fuel tank under the floor, cockpit glass. The object is its landing zone; it
comes from an offset (in the air, or on the ground with the rotor still: it spins up first) and flies
its **mission**: *insert* (approach and flare to a hover over the zone, cables out of both doors, the
troops fast-rope down, cut, climb away and circle), *land* (touch down, the troops jump out, off
again), *overwatch* (circle the zone, doors open, guns), *hover*. Parameters: soldiers in the back
(0–8), door guns (both / left / right / none), **side** (*enemy*: red, it brings their soldiers;
*friendly*: blue, yours), altitude, cruise speed, hover height, rope length, orbit radius, call sign,
paint.

- **Flight**: a pilot model, not blade aerodynamics: the velocity he wants (to a point, slowing to
  stop at it; round a circle; up or down) within the accelerations a helicopter has (less with a hurt
  engine); the attitude follows (nose down to speed up, nose up in the flare, banked in turns). The
  rotor spins up in 9 s before it can lift and runs down after landing; the doors slide.
- **Crew**: pilot (right seat), co-pilot, then the men in the back: one door gunner per gun, then
  troops on the benches. They are the simulation's soldiers (`world.enemies`, drawn by
  `render/enemies.js`: seated, at the gun, crouched in the door, on the rope) held in their seats
  (`guardCtl`, `aboard`), posed in the helicopter's frame: each man (and his weapon) tilts with its
  pitch and roll (`e.frame`, `e.seatYaw`), and his eye (`e.eye`) and his gun's muzzle are where they
  really are when he looks and shoots.
- **Who they shoot at**: an *identified threat*, not just you. The crew look out of the doors (the men
  in the back) and through the glass (the pilots) and notice what they see as the soldiers do
  (`ai/perception.js perceive`: distance, light, smoke, a moment to notice, sooner where rounds came
  from or where a friendly squad has its threat); what one man identifies the whole crew knows
  (`h.known`). The contacts are you on foot, the soldiers, the dragons and the other helicopters, each on
  a **side** (`ai/sides.js`: you and friendly helicopters *blue*, the simulation's soldiers *red* unless
  they say otherwise, a dragon everybody's enemy). Of the hostile ones identified and in sight out of
  his door the gunner picks the most dangerous (`threatScore`: shooting at them ×4, a dragon or a
  helicopter over a man, nearer and more exposed first); a friendly in the line of fire holds it; an
  unidentified or friendly contact is never fired at. With a door open the **gunner** fires the pintle
  machine gun (bursts, spread by the helicopter's speed and vibration) and the **troop by the door**
  (on one knee in it, weapon ready, covering below and outward; during a fast-rope he is the next man
  down, waiting his turn there) his own weapon, both through `sim/wounds.js shoot`: real rounds that wound a soldier, strike a dragon,
  hit another helicopter's parts, or you. Fire teams of the two sides see each other as hostiles too
  (`squadHostiles`), so troops roped down from a friendly helicopter fight the red ones, not you.
- **Fast-rope**: the cables are `world.ropes` entries (`{ kind: 'fastrope', top, bottom, owner,
  attached }`): the helicopter writes `bottom` once and moves `top` with the door every step; each
  trooper is handed to `ai/rope.js startRope` (retried each step: one man every 3.2 m), off the rope
  his squad (`ai/squad.js`) has him again.
- **Hit parts** (`models/vehicleZones.js VEHICLE_ZONES.helicopter`): cockpit (a pilot is hit; both
  down: nobody flies it), mast, engines, fuel tank, tail rotor, tail boom, main rotor blades (a round
  through the spinning disc meets a blade 30 % of the time), cabin (the men in the back are hit),
  skids. Bullets (`shoot`), arrows and rockets (`sim.hitEnemy`) and blasts (`explode`) find them.
- **Coming down** depends on what went: *tail rotor / boom*: no yaw control, the fuselage spins round
  the mast faster and faster while it sinks at ~5–6 m/s, a spinning hard landing the crew survive;
  a boom shot through breaks off at its root and falls as one piece (boom, fin and tail rotor, tumbling,
  lying where it lands, hurting whoever it lands on), the nose dropping without its weight aft;
  *main rotor / mast*: no lift, it drops and tumbles, the blades fly off (and hurt whoever they land
  on); *engine*: autorotation, a ~9 m/s glide with forward speed and a flare to a hard landing; *fuel
  tank*: it burns, the pilot puts it down at once (too long in the air: it blows up). Every touchdown
  and crash goes through `sim/impact.js` (force, shockwave, sound); a crash hurts the men by how hard
  it was, a torn or burning tank lights the fire simulation (`sim.ignite`, a torch) and may explode;
  the survivors climb out and fight on.
- **Rig** (*Helicopter* in the Object drop-down, `rig/heli.js`, `rig/heliStage.js`): parked, start-up,
  hover, transit, approach & flare, land, doors, fast-rope, door gunners fire, troops fire from the
  doors, and the four ways of being shot down; soldiers and door guns, the hit parts shown and resized,
  damage on click (bullet, shell, rocket), the crew's state and the radio. The stage's targets are
  identified like anyone else and the rounds hit them (100 HP each: lit up when hit, knocked over when
  down). `?mode=rig&obj=helicopter
  &hact=fastRope&hzones=1&hsteps=n&hfollow=1&hhits=tailRotor`.

### Flying the helicopter

Walk up to a helicopter that is on the ground (parked, landed, or started on the ground) and press
**E** by its cockpit (`walk/heliFlight.js`): you take the pilot's seat. An enemy crew climb out and
fight; a friendly pilot moves to the back, a friendly crew stay at the guns and on the benches. The
rotor runs up first (9 s) before it will lift. **W/S** collective (let go: it holds its height),
**mouse** (or the **arrow keys**) cyclic: nose down to fly forward, bank to turn (mouse up: nose up, as
in the jet; the stick centres itself), **A/D** pedals (at speed a bank turns you too). **G** at a steady
hover low enough for the ropes: the troops in the back fast-rope down, the ropes are cut when all are
down (G again with nobody on them: cut now). **E** climbs out once it is on the ground and still. The
crew in the back fight from the open doors on their own (identified threats, above). The hit parts and
the ways of coming down are the same as for its own pilot: a tail rotor shot away spins you round the
mast (the pedals do nothing; more collective, faster), a dead engine autorotates (the collective can
only spend the rotor's spin: save it for the flare), no rotor drops you, a burning tank gives you 14 s
to put it down; rounds through your side of the cockpit hit you. A crash puts you out of the wreck,
hurt by how hard it was. Chase camera; the instruments show the collective, rotor speed, height,
speed, attitude, troops, contacts and damage.

### Driving a car

Every `car` object (the street's cars, the military base's jeep and trucks) can be driven. Walk up
to a front door and press **E** (`walk/carDrive.js`): you take the driver's seat and turn the key.
**W/S** on / brake (an automatic: S held at a standstill puts it in reverse, then S drives and W
brakes), **A/D** steer, **Space** the handbrake, **H** the horn, **R** the engine off / on, the
**mouse** looks round it, **E** gets you out once it is slow. Chase camera; the HUD shows the speed,
the gear, the revs and the fuel.

- **Dynamics** (`sim/carPhysics.js`, pure): an engine torque curve (petrol for a car, a diesel for
  the jeep and trucks) with an idle governor, a rev limiter, engine braking and stalling; an
  automatic gearbox (a slipping clutch from rest, shifts that come later the harder you press);
  the driven rear wheels' spin integrated against the tyre's force (slip ratio: wheelspin, locked
  wheels), lateral tyre forces from the slip angles (a bicycle model: understeer at speed), all in
  the friction circle of the surface's grip; brakes (front-biased, they lock and skid), rolling
  resistance, air drag, the load moved on and off the axles, the slope. A hatchback does 0-100 km/h
  in ~10 s and ~190 km/h. Fuel is burnt from its power (~250 g/kWh) and idle flow.
- **In the world** (`sim/cars.js`): the ground under each wheel is the top of the voxels there
  (steps of a coarse grid smoothed into ramps), the grip from its material; its body stops on
  solid voxels above its ground clearance (an impact: damage, sim/impact.js crushes what it hits
  and makes the sound); cars push each other (momentum along the normal); a man in the way is
  knocked down at speed, stopped for when it is slow. Its **voxels move with it**
  (`sim/carBody.js`): taken out of the grid and put back at its pose with all their state, so a
  burning car keeps burning as it drives (and its fuel tank stays a sealed vessel). The engine dies
  when its bay has burnt or the car is wrecked; the fuel left is what the tank's petrol voxels hold.
  On the move its voxels are hidden and `render/cars.js` draws it with its wheels turning and
  steering and its body on its springs.
- **AI drivers** (`ai/carDriver.js`): `driveTo(car, target, { speed })` plans a route over the
  ground (A* on 1 m cells: roads cost less, walls, trees and water are out, steps of more than
  ~0.6 m too), follows it by pure pursuit, slows for bends, stops for what is ahead and steers
  round cars and men just off its line, backs out when stuck. A squad falling back to a car, or
  mounting up to back up a team that called, is driven by the man at its wheel
  (`ai/vehicles.js` car adapter: seats with their weight).
- **Sound** (`audio/carSound.js`, `audio/carVoices.js`): the engine at its firing frequency (rpm /
  60 × cylinders / 2), louder and brighter under load, the intake, a diesel's rattle, the starter,
  the gear shifts; the tyres' roll and squeal from their slip, scrub off the road; the wind; the
  brakes; the horn; crashes; for every car, with distance and the Doppler shift.

### Flying the jet (carrier scenario)

Walk up to any of the jets on the flight deck and press **E** (the two on the bow catapults
face down the deck, clear of the deck park). W/S sets the throttle (on the deck,
full throttle fires the catapult), the mouse pitches and rolls, A/D works the rudder, and
**Space or a click fires a rocket** from under the wings. A rocket's motor burns for 3 s,
then it flies on ballistically. It explodes in whatever it hits: the island's hills, the house,
the trees, the ship. That zone is built first if you have not been there yet. The explosion
throws debris, breaks windows and starts fires. A rocket that hits the sea just splashes.

Lift grows with the square of the speed, so the jet sinks when slow. Banking turns it.

**Damage** changes how it flies. The HUD lists each part:

| Part | What damage does |
|---|---|
| Wings | Less lift and more drag. The jet rolls towards the damaged wing, and a wing that is torn off sends it into a spin. |
| Engine | Less thrust and smoke. Past 60 % the engine catches fire, and the fire keeps eating into the engine, the tail and the fuel tank. |
| Tail | Sluggish controls and a pitch wobble. |
| Fuel tank | It leaks, and when it is dry the engine stops. A burning, holed tank can explode. |

Damage comes from blasts (your own rockets fired too close, a bursting tank), from flying
through flames, hot gas or smoke, from scraping a wing tip or the tail on something, and
from heavy landings. Hitting something nose first, flying into the sea or landing far too
hard is a crash. A jet shot to pieces (both wings gone, or almost everything wrecked) breaks up
in the air. Either way the fuel explodes (at least as hard as a rocket, more with a full tank)
where it comes down, and starts fires there. As it goes, the seat fires on its own: you come
down under the parachute (below), steering it as if you had pulled the handle yourself. Only
in space, with no air for a parachute, are you brought back to the ship.

**X ejects.** The rocket seat throws you clear, and it also works on the deck. The parachute
opens after 1.2 s and you come down at about 5 m/s, drifting with the wind. W/S makes the
canopy faster or slower, and A/D or the mouse turns it. Land on the deck or on the island and
you walk on from there; land in the sea and the ship's boat picks you up. Hitting the ground
before the canopy opens hurts. The empty jet flies on: its nose drops and it rolls off, until
it comes down and explodes.

To land, stop on the deck or on flat ground (S brakes) and press **E**. The jet becomes
voxels again where it stands, with its damage, fuel and remaining rockets kept. It can burn
and explode like everything else.

### Into space (carrier scenario)

**Hold B for the booster**: a rocket that gives far more thrust than the engine and burns 25
litres of fuel a second. The air thins with height (on a 350 m scale, squeezed to fit the
game), and lift, drag and the control surfaces fade with it; thrusters take over the
steering. Gravity fades too, and is gone above about 2.2 km. The sky goes black and the stars
come out. Above about 1.5 km you are in **space**:

- Flight is Newtonian: thrust pushes along the nose, and momentum is kept, so turning the
  nose does not turn your path.
- S at zero throttle fires the braking thrusters.

The **spaceship** orbits 2.4 km up. It is built when you come within 60 m.

- **Docking:** fly slowly (under 4 m/s) up to its docking port and the jet locks on. You go
  aboard through the airlock.
- **Undocking:** the docking port inside the airlock (E) puts you back in the jet.
- **Impacts:** bump into the hull slowly and you bounce off; ram it fast and you crash and
  explode against it.
- **Going home:** fly back down. Coming in too fast through thin air heats the airframe
  (re-entry damage and flames).
- **No ejecting up there:** there is no air for a parachute.

Inside the spaceship you walk and fight as anywhere else: the grenade, the bow and the
extinguishers all work. Its main corridor runs from the bridge, which has big windows, to
the engine room, which has machinery, cable trays and a propellant tank. Along it are the
crew quarters, the mess, the cargo bay, a lab and the airlock. Guards walk the corridor,
and a cable fire starts in the engine room after 40 s.

**Decompression** (sim/vacuum.js) is flooding the other way round (sim/breach.js): on a ship
holed below the waterline the sea is the higher pressure and comes in; in space the cabin
air is, and goes out. Breach the hull with a grenade or rocket, shoot out a window, or open
both airlock doors, and every space connected to the hole empties:

- Each compartment (the air cells joined through open faces; closed doors and bulkheads
  part them) has one pressure. Through the hole the air leaves as a choked jet,
  ṁ = Cd·A·p·√(γ/RT)·(2/(γ+1))^((γ+1)/(2(γ−1))) (the pressure ratio to vacuum is always
  under the critical 0.528), so it empties as exp(−t/τ), τ = V / (Cd·A·0.685·√(RT)): a
  1 m² hole empties 100 m³ in about a second, a fist-sized one takes minutes.
- The air converges on the hole: the flow potential of a compartment expanding uniformly
  (∇²φ = −1/τ, φ = 0 outside the hole) is solved, so the air is slow in the far corners,
  faster where the way narrows (a doorway) and fastest in the hole (the jet, up to the speed
  of sound). It carries the smoke out, and drags what is loose with it: ½·ρ·Cd·A·|u−v|·(u−v)
  against the thing's weight and its friction on the floor. Crates, a gas cylinder, debris,
  bodies and soldiers (who hold on harder) slide and tumble to the hole, go through it and
  drift on in space (no air, no gravity out there). Something bigger than the hole is
  pressed into it and plugs it: the leak almost stops until the pressure behind it (p·A,
  tonnes) crushes it through. What is strapped down or bolted stays.
- The oxygen goes too, so fires die. The gas cools as it expands (T ∝ p^((γ−1)/γ)) and
  its vapour condenses: a fog flash in the compartment, a white plume out of the hole.
- Interior doors close themselves once their compartment loses pressure (unless something
  is in the doorway; *Doors close themselves* in the spaceship's parameters). A closed door
  holds the difference: you cannot open it against it (18 t on a door); its equalising valve
  lets the air through first (subsonic or choked by the pressure ratio) and it opens once
  the two sides are level, the air shared out by volume. A door burnt or blown half away
  bursts when the difference is more than it can take.

The sea's breach works the same way round: the jet of sea water coming in through the hole
(√(2 g Δh)) shoves loose things away from it, deeper into the ship, the flood floats what
floats, and soldiers in its way are knocked over.

For you: the suction pulls you towards the hole, and below a third of cabin pressure you get
hurt. Your breathing apparatus gives you air but not pressure, so get behind a closed door.
The HUD shows the cabin pressure, and the sound is a roar of escaping air, doors slamming.

### A world of places: boxes from afar, the scenery close up

The **carrier's world** (`carrier`, `places: true`) is a world of places, each a zone of its
own voxel size laid out by its `origin`, with a `label`. The lake house and its neighbours
(the old Garden by the tea house, Laundry on the line, Tea by the lake and Wind-driven grass
fire scenes):

| Place | Origin | Size | Voxels | Time |
|---|---|---|---|---|
| Lake house: tea on the veranda (the lake island) | 240, 1.8, 150 | 22 × 19 × 7 m | 10 cm | 1× |
| Washing line & barbecue (the lawn east of the island, across ~1 m of water) | 263, 3, 159 | 7 × 5 × 3 m | 5 cm | 15× |
| Meadow: grass fire (on the shore south of the lake island) | 258, 2.85, 170.5 | 24 × 14 × 9 m | 20 cm | 3× |
| Car fire by a house (the street, east of the meadow; the old Car fire next to a house) | 284, 2.9, 172 | 14 × 11 × 8 m | 15 cm | 10× |
| Garden on a dry day (the street, east of the garden; the old scene of that name) | 272, 2.85, 150 | 22 × 18 × 9 m | 20 cm | 10× |
| Oak, willow & pine: grass fire (east of the meadow; the old Oak, willow and pine in a grass fire) | 283, 2.85, 185 | 22 × 12 × 11 m | 20 cm | 4× |

The lake house and its garden share one weather (the garden's `weatherOf: 'lake'`): a mild
early-autumn afternoon (19 °C, 45 % humidity, 2.5 m/s, the lake open), so the wash can dry and
catch and the tea still steams; Weather › Presets › Cold snap (or `?scenario=winterTea`) freezes
the lake over. The meadow keeps the old grass fire's hot, dry, windy spell (28 °C, 25 %, 4 m/s).
The two street places keep their old scenes' weather too: the car fire 15 °C with 1.5 m/s of
wind blowing from the car onto the house, the dry garden 25 °C, 30 % humidity, 2 m/s; both are
neighbours of the lake house (group `lake`).
East of the meadow, the field of the oak, the willow and the pine keeps its old scene's weather (30 °C,
25 %, 3 m/s towards +x, lit on its west edge): the pine goes up in a crown fire, the willow drops
burning branches, the oak's limbs burn where they are (each tree an object of its kind, below).
Places inside or under another have no `origin` (the jet, the boats and the stand-ins do not go
by them) but a schematic `box` for the overview: below deck and the lower decks in the hull, the
catacombs under the church. Zoomed out, each place is
drawn as a box at its true location and size with its name over it (render/places.js); close
up, its scenery: the place you are in as its voxels, the other as its stand-in (its last state,
render/proxies.js). Click a box or its name and it becomes the place that runs, built the first
time; the others wait where they were. In Play (not walking or flying) bringing the camera close
to a neighbour (a place of the same `group` as the one you are in: the lake house, its garden,
its meadow) does the same; the ship, the islands and orbit are left to their hatches, boats and
the jet. Walking or flying, the world is its scenery (no boxes). A zone's `timeScale` applies
while you are there. Edit world lists the places at the top of the outliner (where each is:
outdoors, indoors, underground or sealed; its size; its voxels; a click goes there) and shows
their outlines and names all the time. Any zoned scene with `places: true` works this way.

### Zones: big scenes without simulating everything at once

The carrier scenario is split into five **zones**:

| Zone | Voxel size | Size | Cost per step |
|---|---|---|---|
| Flight deck (210 × 48 m, 16 jets) | 0.5 m | ~115k solids | ~55 ms |
| Below deck: corridors, mess, berthing, store room, server room | 0.2 m | ~70k solids | ~25 ms |
| The island | 0.4 m | ~20k solids | ~20 ms |
| The catacombs under the island | 0.2 m | ~56k solids | ~40 ms |
| The spaceship in orbit | 0.2 m | ~52k solids | ~35 ms |

Only the zone you are in is built and simulated. Each of the others is built the first time
you go there and is frozen while you are away. Fire, smoke and damage are kept when you come
back. You move between zones with **E**:

- the hatch next to the carrier's island leads below deck, and the ladder leads back up;
- the boat ladder at the stern takes you to the island's pier, and the boat there takes you back;
- the stone hut at the island's north shore has stairs down into the catacombs;
- the spaceship is reached only by flying (and docking).

The flight deck and the island lie in one sea, each at its own `origin`. Flying, you see the
zone under the jet in full, and the others as simple stand-ins: columns of the voxels' top
colours, or a placeholder hill for a zone not built yet. When you cross into the island's
area it becomes the zone that is simulated.

The **island** is a height field: sandy shores, grassy slopes, two hills with rocky tops, a
canal from the hills to the sea, and a pond on a terrace on the hillside. A plateau holds a
house and a campfire with dry grass around it. Only the top layers of the terrain are
voxels, which keeps it cheap. Objects can be put on any surface with `"y": "auto"`.

The **catacombs** belong to the island: the stairs down are in the north arm of the church
(the crypt), and they are built only when you first go down (the Catacombs scenario is the
same place, for going there directly). Off their east passage lies an **underground
church** (models/cryptChapel.js): benches, an altar under a cross, and on it the candles,
burning (in this scene they are drawn, each a small flame that lights the vault), with tall
candles on stands either side. The ship's **lower decks**, below the waterline, are the
carrier's too: a ladder down from the corridor below deck. The **campfire** burns on an islet
out on the reef (a second boat at the island's pier): a log-cabin fire lit from the kindling
in a stone ring on dry grass, its logs charring into embers, then ash. The **boats** at the
piers (the red one back, the blue one on: islet, island, lake island) are rowing boats
(`models/rowBoat.js`) afloat on the sea: walk up to one and press E (Shift+E: row it yourself).

**Scanned objects that burn and break** (models/statue.js, models/candelabra.js,
render/statue.js): photo-scanned models (CC0, Poly Haven) are simulated as voxels of their
material filling their shape, hidden, and the scan is drawn over them with every triangle
tied to its nearest voxel. A part blown off leaves the object and flies, tumbles and lies
as that piece of it (not a block); the rest stands or falls; it blackens with soot and
glows where it is hot, and molten (brass) it is gone. In the underground church: a gothic
statue (sandstone: a grenade within a metre wrecks it, at 1.5 m it chips) and brass
candelabra on the altar (each candlestick a column of brass voxels holding its weight in
metal; their candles burn with flames of ours, which go out when their part is gone).
The skulls in the ossuary walls are a real skull model (CC0, Khronos glTF samples),
reduced to 3,000 triangles (render/models/skull.bin).

**Ready-made assets are not kept in the repository**: the photo textures and the scanned
models are loaded from Poly Haven (and the Khronos samples) when a scene needs them
(render/assets.js); only what is made from them is kept (the reduced skull, a statue's
solid shape as voxel cells, models/data/). Without a connection the scenes still work,
with plain surfaces and the objects shown as their voxels.

**Laundry on the line** (the *Washing line & barbecue* place of the tea house garden;
models/clothesline.js, render/laundry.js): the wash hangs on the lawn across the water from the
tea house's island on a mild, sunny autumn afternoon (19 °C, 45 % humidity, a light breeze),
nearly dry after a few hours: a sheet folded over
the line, towels, polyester shirts, jeans, a pillowcase, socks. Cotton holds a lot of water and
dries in the sun and the wind (a dead fuel's moisture, about half an hour from the machine; it
will not burn while it is wet: the model's Water setting); half a minute in a spark from the
barbecue lands at the foot of the sheet and catches once it is dry enough (sparks keep
landing for 20 s; it catches ~30 s in, and nine tenths of the wash are gone ~95 s in, at the
place's 15× time). Then the fire runs along the line; the shirts
shrink, melt and drip before they burn; garments burnt through at the top fall; the lawn
scorches under them. The cloth is drawn as cloth (folds, weave, stripes, seams, pegs),
swaying in the breeze, and tied to its voxels: it chars, glows and burns through to holes.

*What the cloth is, and what Inspect shows of it* (sim/cloth.js, render/pick.js): every
garment is real voxels – boxes of cotton or polyester one voxel thick whose density factor
makes them half a millimetre of cloth (thicker for towels and jeans), the pegged top row
anchored, all of them *hidden*. They carry the physics (water, heat, char, flames, falling
when the top burns through); the drawn cloth is only their picture, folded and swaying up
to ~0.2 m out of their plane at the hem. A click used to be tested against the voxel cubes
alone, and hidden voxels are not among them: the ray went through the sheet to the lawn, and
the inspector showed the grass, or nothing. Now the pick (the same one for every tool and the
editor) also raycasts the drawn cloth as it is drawn – sway, folds and holes – maps the
triangle hit to its voxel and that voxel to its garment. Inspect then shows the garment as a
whole (one voxel of a sheet says little): which garment and its cloth, its size and dry
mass, its water, mean / hottest / surface temperature, how much has burnt (charred, ash,
fallen off), the cloth left, whether it still hangs from its pegs, its heat release, its
voxels and the air cells round it, and the clicked voxel's own state. The same pick finds
the other things drawn over hidden voxels by a mesh of their own: the scanned statues,
candelabra and props, and trees (bark, leaves) and grass blades.

**More ready-made objects** (models/scannedProp.js: any CC0 Poly Haven model over voxels of
its material, holding its real weight): in the underground church a brass vase on the
altar and a tall gothic chair in the apse; in the garden a painted bench and a jerrycan;
on the flight deck two oil drums. They burn, char, melt and are thrown about with their
voxels, like the statue. (Poly Haven has no people: the guards are still our own figures.)

**Adaptive quality** (View: on by default): when frames are slow (rendering without a
graphics card, in software) the view steps its resolution, ambient occlusion and shadows
down, and back up when there is time to spare; a software renderer is recognised at the
start and begins a step down. The scanned skulls in the ossuary are used up to ~7 m, the
light procedural ones beyond.

**Fine detail close up** (sim/patches.js, render/patches.js; View: "Fine detail close up"):
a scene at 20 cm voxels cannot hold a candle, a torch's head or the logs of a campfire as they
char. There they are drawn and simulated coarsely; each also carries a description of
itself, and when you come close it gets a small world of its own at fine voxels:

- a candle (within ~3.5 m): 1 cm voxels (5 mm for a candelabra's thin candles), the old
  Candles scene's physics: the wick draws molten wax, the pool forms, wax runs down the side
  and sets. The nearest one within 1.2 m goes finer again (5 mm), its wax and flame carried
  over (resampled), so a drip is a drip and not a stack of cubes;
- a wall torch (within 2.5 m): its head at 1 cm, rags soaked in pitch burning as many wicks
  at once (models/torch.js), the pitch running and dripping; ~1–2 kW, as the coarse torch;
- a campfire that burns (within ~8 m): its logs, kindling and stone ring at a few cm
  (coarser for a big bonfire: at most 100k voxels), started from the coarse fire as it is
  (what has burnt away, what is charred, what burns) and burning on in detail, with flames
  of its own; the coarse pile and its flames are not drawn meanwhile.

Each is drawn as the smooth surface of its own voxels (surface nets, rounded). The coarse air
round it is its surroundings (temperature, oxygen, a draught). A candle's and a torch's patch
gives back what it burns (the coarse flame's heat release, its flame drawn where the patch
burns, as big); a campfire's coarse voxels stay the fire for the scene (its heat, its smoke).
The nearest few run (8; 4 without a graphics card), within a time budget per frame; further
away the coarse one stands in again. A blast nearby blows candles and torches out. The
candelabra's own scanned candles are cut out of the scan and ours stand in its cups.

Costs, per simulated second: a 1 cm candle ~30 ms, a 5 mm one ~65–270 ms, a torch's head
~170 ms, the islet's campfire ~190 ms. The dragon's fire breath has no patch: a jet 10 m long
that moves with the head would need a fine grid along all of it (far more than the scene
itself); what it sets alight burns in the scene's voxels.

**Voxel size** (folder "Voxel size (performance vs detail)", or `&voxel=1.5`, `&detailvoxel=0.7`
in the link): a factor on every scene's (and zone's) own voxel size, one on the close-up
detail's, how many close-up objects run at once, how many candles go finest, and torches and
campfires close up on or off. Coarser is faster (1.5×: about a fifth of the work), finer is
more detailed (half the size: ~16× the work: 8× the voxels, twice the steps).

**The time of day and the date** (Weather › Sky: date, time of day, sun and moon; the same in
Edit world; `&time=hh:mm&day=N&clock=running&timeSpeed=60&lat=…`; sim/sky.js, render/sky.js):
outdoors the sun and the moon stand where they would for the date, the time and the place on
the Earth (latitude, longitude, time zone; by default 51.5° N on Greenwich time): the sun by
the Astronomical Almanac's formulas (its elevation within ~0.1° of NOAA's, sunrise and sunset
within a minute or two), the moon to a degree or so with its phase (from where the two stand).
The sunlight and its shadows come from the sun (golden low down, orange at the horizon), by
night from the moon (as bright as its phase); the sky goes from day blue through the golden
hour, the sunset's red round the sun, the civil and nautical twilight to a dark blue night
with stars and the moon's disc lit on the sun's side. The sky's light and the eye's adaptation
dim the night but never so far that you cannot see; fires, torches and candles stand out.
The fog, the sea's and the ponds' mirror and the glitter on the water follow (the moon's at
night). The sun on the ground follows its height (Haurwitz's clear-sky curve through the
clouds): it melts the snow and the ice; by night a clear sky cools them (frost) and the air
at the ground is nearer its dew point (dew; dead fuels take up a little water). The clock is
fixed (planned) or running from its start (× a time speed: 60 is a minute a second, with the
simulation's own time speed on top); running, the air is warmer in the afternoon and cooler
before dawn. With "Season follows the date" the leaves and the grass follow the date. Without
a date set a scene stands on its season's typical day; the carrier's world on 28 August at
09:48 (its old south-eastern late-morning sun). Indoors and underground nothing changes (their
own light), though the church's stained glass takes the sun's direction when the place is built.

**Seasons and snow** (Weather: "Season", "Snow lying (m)", "Sunshine", "Snowfall", "Thaw";
`&season=winter`, `&snow=0.4`, `&thaw=1`; sim/snow.js, render/snow.js): spring, summer, autumn
and winter each start from a typical day (temperature, humidity, sunshine; the leaves turn
rust and gold in autumn, oaks keep brown leaves through the winter, the grass goes to straw);
a season rebuilds the scene at that day's temperature. Below freezing the precipitation is
snow (sleet to +3 °C). Snow lies as a height field (cells of at most 0.2 m) on whatever is
open to the sky: the ground, the roofs of the church and the house, decks, ledges (under a
tree less of it). It builds up as it falls (10 mm of water is ~10 cm of fresh snow), settles
over days, and melts when the heat it gets outweighs what it loses: the sun (fresh snow sends
~85% of it back, old and trodden snow less; the season's sun, through the clouds), the air
over it (above freezing; below, it cools it), a fire's hot gas and radiation (a burner or a
torch near it straight onto the snow), a hot surface under it; it loses heat to a clear sky.
334 kJ/kg, taken from the air. Its melt water soaks what lies under it (fuel under snow does
not catch); off a roof's edge it drips: drops fall from the eaves onto the ground below, which
gets the water. Feet press it down: a person (~13 kPa) packs fresh snow to ~400 kg/m³, a
trail of footprints, lower and greyer; a dragon a broad groove; a blast clears it. Deep fresh
snow slows you down in the walk-through. The other islands of the group turn white with it.
Steam is drawn only where the air cannot hold it (over its saturation): a fire's or a hose's
steam, not the little the sea gives off over a whole scene.

**Ice on the water** (Weather: "Ice on the water (m)", "Ice forms / melts faster (×)", "Hard
frost", "Watch it freeze"; `&frost=1`, `&freeze=1`, `&ice=0.08`; sim/ice.js, render/ice.js): below
freezing the ponds, the canal and the sheltered sea (inlets and a belt along the shore, not the
open sea, whose swell breaks it up; salt water freezes at −1.8 °C) freeze over. Open water loses
heat to the cold air (more in a wind) and to a clear sky, and a skin forms, first along the
banks; it then thickens from below as the heat gets out through it: at −10 °C a couple of
millimetres the first hour, ~4-5 cm in a day (Lebedev: ~1.3·FDD^0.58 cm), as fast as real ice,
so there is a speed-up to watch it happen. It melts from the top in a thaw, in the sun (bare
ice keeps about half of it) and in a fire's heat, and from below where the water under it is
warmer (lava running into the canal). A first skin is clear and dark, thicker ice greys and
whitens, with cracks and bubbles in it; snow lies on it once it is ~3 cm thick; under it the
sea is still (no waves). It bears a load by Gold's rule (P = A·h², A ≈ 4 kg/cm²): ~5 cm bears a
firefighter in full gear only just (it creaks and cracks under you, and gives sooner when you
walk than when you stand), 10 cm is safe, thinner breaks at once and you are in ice-cold water
(it hurts; swim to the edge and haul yourself out onto it). The guards walk over it where it
bears them well (~8 cm); a dragon needs ~30 cm, on thinner ice it breaks through. A grenade
blasts a hole in it. Open water skins over again in the cold.

**A cup of tea** (the *Tea on the veranda* place of the tea house garden, on a mild autumn day,
and the lake island in the carrier scene, in a frost: a boat from the islet; models/teaCup.js, sim/tea.js, render/tea.js): a porcelain cup on
its saucer, far smaller than the voxels, so it is drawn and its heat is kept on its own: the tea
and the cup as one lump (~1.3 kJ/K for 250 ml). It loses heat by convection from its side and
its open top (natural, or forced by the wind, whichever is more), by radiation, and by
evaporation, which is most of it while it is hot (by the heat/mass-transfer analogy from the
convection, driven by the vapour density at the surface over that in the air). 250 ml at 85 °C
in a room is ~60 °C after a quarter of an hour, and a few grams have gone into the air; in a
frost with a breeze it cools faster, holds at 0 °C while it freezes (334 kJ/kg) and then the
ice cools on. Its steam is that vapour condensing as it mixes into the colder air over the
cup (the same mixing line as a breath): a thin mist in a warm room once it has cooled a
little, thick wisps in a frost. As it cools it gives off less and the steam thins out; close by, a small label
shows how hot it is (it cools ~3 K a minute at first in the frost: speed up time to see it go). The heat it gives off warms the air; a fire nearby warms it.
Where the table under it burns away it falls (and breaks if it falls far); a blast breaks it.
The place round it: a small island (the island model with its pond made into a lake: `pondX`,
`pondZ`, `pondRadius`, `pondRadiusZ`, `pondDepth`), the lake open (in the carrier's cold
snap frozen over, 10 cm: it bears you), a veranda on the shore (models/veranda.js), a couch with a plaid (models/couch.js), a side
table with a book and a candle (models/sideTable.js); in the carrier scene it has a cold snap
of its own (the zone's weather).

**Trees and grass in the wind; detail by distance** (render/trees.js): the trees sway with
the wind (more towards the top, in its gusts), their branches swing, more towards their
tips, and the leaves flutter; the grass bends. Close up every leaf card and twig is drawn;
further off the crown is thinned evenly to fewer, bigger cards, the thin twigs are left out
and the leaves cast no shadows; the grass thins out to fewer, wider tufts and is gone past
~70 m (the turf shows). Their simulation is the scene's voxels (a crown is ~100 m³: finer
voxels for a tree close up would cost far more than a candle's patch).

**Trees and blasts** (sim/explosions.js, sim/trees.js): a blast shreds a tree's leaves and
blows them off (further out than it throws anything), snaps its branches (the thicker, the
nearer: right at it the wood is thrown, further off a branch breaks and drops), and splinters
its trunk close to it. The trunk's damage adds up blast after blast: a grenade at the bark
gouges it, a second one (or a rocket) cuts it through, and when half of its cross-section is
gone the rest snaps. A tree cut through comes down as one: it swings over about the cut, away
from the blast, slowly at first and faster, and lies along the ground (on top of what is
there), the stump left standing; its voxels lie where it came down (it burns there).

**Lightning** (sim/lightning.js; Weather: "Lightning (strikes a minute)", the Storm preset
sets 3, "Lightning strike now"; `&strike=x,z` in the link): in a thunderstorm a strike goes to
what stands highest round where it comes down (a tree, the church's tower and roof, a mast).
Where it hits the current heats what it passes in an instant: the wood under it for a few
metres is scorched and split along its length, a burst of steam at the top blows off leaves,
bark and loose parts (a roof's tiles crack), and what can burn there catches (a struck tree
burns, the grass round it catches). A tree is split by a strike and now and then breaks and
comes down (more likely struck a second time). Drawn as a jagged, forking channel that flickers
two or three times in a quarter of a second, the sky lighting up with it; thunder (the crack,
then the rumble). Not under cover: indoors, underground, in space.

**Lava in water** (sim/volcano.js): lava that runs into the sea is quenched (it sets in
seconds, the sea boils off it). Lava that runs into the canal or the pond boils them where
it touches: ~1 MW/m² of contact (three times that while it is molten and shatters), the
water heats to boiling and goes up as steam, a voxel of it boiled dry is gone, and the lava
sets with a dark crust against it. (A pond's bed holds its water: it seeps into the soil only
as far as the soil is not wet through.)

**Breath, dew and frost** (render/breath.js, render/trees.js; Weather: "Misty morning",
`&dew=1`): in cold air the guards' breath and your own show (what you breathe out is warm and
saturated: mixed into cold air it condenses, more the colder and damper; every few seconds,
faster when running). When the air is at its dew point the grass and the leaves of the trees
bead with dew (wet, glossy, the drops glinting); below freezing they are white with hoar frost. Dead fuels take up water
towards what the damp air holds (they are harder to light).

**Light close up**: candles standing together (an altar's, a candelabra's) are one soft light
over them, each about a twentieth of a torch's (their heat release); the helmet lamp dims with
how near what it falls on is (the eye adapts): a white altar cloth a metre off is no longer
burnt white.

**Blasts and the ground**: a blast at the ground digs a crater in loose ground (soil,
sand, grass, gravel), ~0.8 m · (TNT kg)^(1/3) across (0.4 m for a grenade), throwing the
earth up and out into a rim; the island's ground is at least 0.6 m deep, so it is never
holed through. Thin built-in sheet (floorboards, boards, hull plating) is torn out further
from a blast than solid construction; steel deck plate takes a rocket. The flash of a
blast lasts 0.8 s on the clock and, indoors, lights the place up without washing it out.
`&blast=x,y,z,energy` sets one off (for testing; a grenade is ~6e5 J).

A **waterfall** (models/islandFall.js, sim/river.js, render/waterworks.js) is on the other side
of the island from the volcano, in the west: a stream on a rocky height pours over a 4.4 m cliff
into a plunge pool. The sheet of water leaves the brink at the speed of critical flow there
(depth ≈ 0.715·(q²/g)^⅓) and falls free in a parabola, white with air lower down, with spray and
mist rising off its foot (it keeps the rocks and the ledge wet). Behind it a **walkway** is cut into
the cliff: from the level rock beside the pool you step up onto a ledge in an alcove under the brink
and walk behind the falling water (it passes ~0.8 m in front of you at head height) and out the
other side. From the pool a **river** runs down through the land to the sea, in level reaches held
by sills of rock it pours over (small cascades), and out over the beach into the sea. Its water is
voxels (it soaks, boils off, freezes); the source gives a steady 1 m³/s, and through every
cross-section of the river v = Q / A (A the open water there, less any ice): slow in the deep
pool, faster in the narrow race at the mill. What floats (a crate, a swimmer) is carried down to
the sea. A dam (anything solid filling a section) stops the river below it; frozen to the bottom
it is shut too; dried out (lava, a crater in the bank) the source fills it again. Running water
freezes more slowly than still water.

A **water mill** (models/mill.js) stands on the river: a rubble-stone mill house with a timbered
gable, millstones, a hopper and sacks inside, and an undershot water wheel on its river side, its
outer bearing on a race wall that narrows the river at the wheel. The wheel turns with the water:
the drag of the current on its immersed paddles, ½ρ·Cd·A·(v−u)|v−u| (u its rim speed), against
the friction of its gearing and grinding stones, with the inertia of the wheel and the runner
stone: it spins up over seconds, runs a little slower than the water (~4 rpm), and runs down and
stops when the river is dammed or dry, the ice grips it, or it is out of the water. The mill is an
object of its own: put it on any river bank, or in a whirlpool's current.

A **volcano** (models/volcano.js, sim/volcano.js) stands on the island's main hill. It sleeps
until a dragon moves within 6 m of its crater; then it erupts: a blast in the crater (heard
far off), lava welling up in the vent at 1.5 m³/s (molten basalt at 1200 °C, which fills the
crater, runs over the rim and down the flanks as a liquid, sets grass, trees and houses alight
and sets into dark rock as it cools), glowing lava bombs thrown out of the crater, and a hot
ash column over it. After three minutes it calms down.

Its voxels are hidden and the cone is drawn as a mountain over them (render/volcano.js):
dark basalt with rough clinker on the old flows, grey ash streaks, red-brown oxidised scoria
and sulphur crusts round the crater, scrub on the lower flanks; while it erupts the crater
and the vent glow. Fresh lava open to the air crusts over: dark rock glowing dull red, with
bright cracks that shift as the flow moves under it. Lava that reaches the sea is quenched:
it sets within seconds and the sea boils off it in clouds of steam.

The **sea** (render/ocean.js) is a sum of Gerstner waves travelling with the wind: the
wind speed sets their height (a fully developed sea, significant wave height ≈ 0.025·U²,
capped at 2.2 m) and length (longer waves run faster, ω = √(g·k)); a low swell remains
in a calm, and whitecaps break on the steepest crests above ~6 m/s. Rain roughens it with
rings. Its colour comes from the depth down to the real bottom under it (the voxels, kept
up to date): clear turquoise over sand where it is shallow (you see the bottom), dark blue
where it is deep, grey-green under a grey sky; the sky is mirrored in it by the Fresnel law.
On the shore the waves shoal (lower and steeper) and break in lines of surf, with foam along
the waterline; against a hull they are damped in its lee and slap against it in foam.

**Storms** (Weather › Storm, or `&storm=1`): a gale (the wind goes up to 35 m/s) with
driving rain under a low dark sky and lightning flashing over the sea. The sea builds with
the wind: above ~10 m/s the waves keep growing (up to 4.5 m here) and lengthen, whitecaps
break on most crests and the wind tears the foam off them into streaks (spindrift). The same
wind drives any fire, and bends the grass flat.

**The island group** (models/archipelago.js, render/archipelago.js): the ship and the island
lie in a group of islands, drawn round whichever zone you are in: a large high island, a
long one, volcanic cones, islets, a sand cay and a sunken reef ring, each with its fringing
reef and lagoon, on a deep ocean floor with ridges and troughs. The sea floor runs on from
the island's own voxels (a shelf sloping away from it), and the sea takes its depth from it:
light and clear over the reefs and lagoons, deep blue beyond, surf on the other shores.

**Photographed surfaces**: grass, beach sand, the hilltops' rock, basalt and burnt ground are
photographs (CC0 scans from [Poly Haven](https://polyhaven.com): `aerial_grass_rock`,
`coast_sand_01`, `aerial_rocks_02` and `burned_ground_01` by Rob Tuytel, `dark_rock` by
Amal Kumar; src/render/photo/), colour and normal map, laid on all three axes in world
space over the voxels' own colours (so charring, wetting and glow still show), and on the
volcano and the other islands. **Grass** is real blades, a tuft on every grass voxel, bending
in the wind (its strength and direction, gusts running across). A lighter sets it alight.

**Swimming**: the open sea is water to the walk-through too. In deep water you float with
your head out, riding the waves; hold C / Ctrl to dive and Space to come up; under water
you swim where you look (W and the mouse) and breathe from your mask.

The **carrier**: its flight deck is simulated over 210 × 48 m (a ship of ~250 m drawn round
it, render/hull.js: a flared hull narrowing to a raked stem under a broad bow, red
antifouling and a black boot-top, the angled landing deck overhanging to port, deck-edge
elevators, sponsons with catwalks and nets, the hull number). On deck: a deck park of 16
jets (two on the bow catapults, two on the waist catapults, rows along both sides of the bow
with their tails over the deck edge, and the "corral" aft of the island), the angled landing
deck's lines and its red-and-white foul line, four arresting wires, three numbered
helicopter spots aft to starboard, and the island (bridge, flight control, mast, radars).
Every jet is voxels (airframe, fuel tank, rockets): a fire or a blast on deck can spread
from one to the next.

The **server room** has a raised floor full of cables, rows of racks, a suspended ceiling,
and a locked glass door. A rack catches fire after 25 s (an electrical fault). Heat
detectors under the ceiling (the hottest gas within 3 m counts) release the **inert-gas system** at 57 °C. This floods the
room down to ~3 % oxygen and puts the fire out, but only if the door is shut. With the door
open (or the glass broken) the gas escapes and the fire keeps burning.

## Models and their parameters

| Model | Parameters |
|---|---|
| Tree | kind (any of the kinds below; older scenes' `deciduous` / `conifer` are oak / pine); height, trunk and crown radius, foliage density, foliage and wood moisture, main branches, seed |
| Oak, Weeping willow, Pine, Birch, Maple, Plane tree, Lombardy poplar, Spruce, Fir, Apple, Palm (`oakTree`, `willowTree`, ...: the palette's *Trees*) | each kind of tree as an object of its own, with its kind's defaults: height, crown and trunk radius, foliage density and moisture, wood moisture, main branches, dead lower branches (age), seed. A kind (models/treeKinds.js) is a parameter set for the procedural generator (models/tree.js): a leader to the top with whorled or spiralled laterals (excurrent: conifers, birch, poplar) or a bole breaking up into limbs (decurrent: maple, plane, apple), branches per order, branching and divergence (phyllotaxis) angle, length and radius ratios, gravitropism (up or drooping), the crown's shape, leaves or needles, the wood. Oak (heavy forking limbs, leaf clusters), weeping willow (arching limbs, hanging whips) and pine (whorls, needle clusters, dead lower branches) keep their own forms; a palm has a leaning stem, arching fronds and a skirt of dead ones. The branch structure comes from the seed. Kinds share the tree woods by how they burn: oak (dense, limbs burn in place: oak, maple, plane, apple), willow (soft, burnt branches snap and fall: willow, birch, poplar), pine (resinous, needles carry a crown fire: pine, spruce, fir). `oakTree` with its defaults is exactly `tree` with `species: 'oak'` and the same parameters (and so on) |
| Grass patch | size, height, density, moisture (dry vs green), rectangle/ellipse, bare circle in the middle |
| Car | length, width, height, paint and seat colour, fuel litres, plastic or steel tank, tank vent working or blocked, fire starts in engine or interior. Steel body, glass, foam seats, plastic dashboard and engine parts, rubber tyres, the fuel tank a pressure vessel of petrol |
| House | size, storeys (1–3, wooden floors with a stairwell), storey height and wall thickness, walls (brick/wood/concrete), roof (tiles/wood shingles/metal), roof pitch, fascia and soffits (wood/uPVC/open), gutter (uPVC/metal/none), windows per side, window width, window frames (wood/uPVC/aluminium), furnished (living room downstairs, bedrooms upstairs), curtains, front door open, back door, chimney |
| Hedge | kind (conifer: thuja or leylandii, privet, beech, dead), length, height, thickness, drought, seed. Living stems inside a clipped skin of foliage; a dried-out conifer hedge burns like a torch |
| Living room furniture | room width and depth, sofa and carpet colour, bookshelf, bed. A foam sofa, a coffee table, a bookshelf full of books and a carpet, without walls: the house's living room, to put anywhere. Lit, the sofa burns |
| Candle | height, radius, paraffin or beeswax, colour, wick length, holder. In a coarse scene (voxels larger than the candle) it is drawn, and burns as a small flame that gives light |
| Underground church (crypt chapel) | nave length and width, passage to the catacombs, rows of benches. A barrel-vaulted nave cut in the limestone, pillars, benches, a dais and an altar under a cross in a round apse, torches |
| Metal bar on burner | steel/aluminium/copper, length, thickness, elevation, burner power, position and flame radius, supports |
| Wood pile / campfire | log cabin / teepee / stack, number, length and radius of logs, moisture, kindling, stone ring |
| Gas burner | power, flame radius and height, nozzle height |
| Wooden fence | length, height, boards or rails, moisture |
| Gas cylinder (LPG) | gas (propane, butane), size (kg when full), fill level, cylinder valve closed / open with the gas burning at it, relief valve working/blocked, colour |
| Ship section | length, beam, depth, draft (waterline), corridor width, furnished cabins, sprinklers, fuel line burst delay and power, loose stores. Two decks, the lower one below the waterline, a long corridor plus cross corridors out to the hull sides, cabins, a stair, cabin and watertight doors |
| Catacombs | passages along x and z (default 4 × 4), spacing, width and height, flat or vaulted ceiling, share of masonry walls, share of ossuary walls, torch spacing, entrance open or closed, seed. Vaulted limestone passages with carved inscriptions, stretches of walls of stacked skulls and long bones (ossuary), domed chambers with bone walls and coffins, burial niches with bones and rags, wooden doors on both sides of each chamber (one locked), burning torches on iron brackets that light the passages |
| Aircraft carrier | an object of objects: the flight deck's params, and in it its 16 jets, the flight of four overhead, a tow tractor, gas bottles and drums, and the places *Below deck* (with *Lower decks* in it). See *Objects of objects* below |
| Carrier flight deck | length, width, deck height, waterline, where the hatch leads (`hatchTo`). Hull at sea, deck markings, the island with a glazed bridge and door, a hatch below deck |
| Group | nothing of its own: the objects in it, moved and turned as one |
| Place | a room of its own (a zone) inside an object or a world: its world (size, voxels), view and objects |
| Jet fighter | paint, fuel (a pressure vessel of jet fuel), rockets. Aluminium airframe, glass canopy, rubber tyres. Flyable |
| Island | size, sea level, main hill height, plateau height, canal, pond, which zones the catacomb stairs and the boat lead to, waterfall (where, which way its river runs, height, width, river width, flow), seed. Its boats at the pier are rowing boats (below) |
| Rowing boat | length, beam, depth, hull of wood planks / aluminium / GRP, hull, inside and stripe colours, thwarts, oars, people aboard (80 kg each on the thwarts), load on the floorboards, buoyancy tanks, the water (auto: the sea, or fresh on a pond), the place it takes you to and where you step ashore coming back, moored (and its line's length; off: it drifts), its kind (rowing boat, outboard dinghy, sailing dinghy, canoe: also the models *Motor boat*, *Sailing dinghy*, *Canoe*), the transom's width, the motor and its power, the sail's area. Floats by Archimedes (`sim/buoyancy.js`): put its origin at the water's level; its hidden voxels burn as their material does, and are drawn afloat in their pose (`render/floats.js`) |
| Water mill | house size, wall height, wheel radius, width, paddles and their depth, axle height, race wall, millstones grinding (a load) |
| Volcano | base radius, height, crater radius, how close a moving dragon must come to wake it, how long it erupts, lava rate, seed. A basalt cone with a crater, a vent and old lava ridges |
| Terrain | width, depth, base ground thickness, base surface, grass moisture, tall grass, water / lava level and snow depth (for a base of those), border slope, ground under the surface (the rest hollow), seed, and its **areas** (see *Terrain* below) |
| Spaceship | length, width, hull height, engine-room cable fire delay, windows, doors that close themselves on a pressure drop, loose cargo. Pressure hull with vacuum outside, corridor, bridge, engine room, quarters, mess, cargo bay, lab, airlock and docking port |
| Carrier below deck | length, width, deck height, server rack fire delay, inert-gas system on/off |
| Helicopter | side (enemy / friendly), mission (insert / land / overwatch / hover), soldiers in the back, door guns, start in the air or on the ground, where it comes from, altitude, cruise speed, fast-rope hover height, rope length, orbit radius, call sign, paint. Flies there with its crew (`ai/helicopter.js`) |
| Rope / zipline | kind (fast rope from a steel gantry, zipline cable between a tall and a short pole, rappel anchor at a roof edge), height, rope length, zipline span and drop, whether it builds what holds it (gantry, poles, a rappel tower). Gives the world a rope (`world.ropes`) that soldiers and the player go down or along (`ai/rope.js`) |
| Enemies | number, spread, floor height, patrol (wander / area / guard round), patrol area width, depth and offset, seed; a drawn patrol path and area (order, sweep, leash: see *Patrols* in the editor) |
| Dragon (lair) | length nose to tail, scales (bronze / tarpon / koi), health, resting or flying at the start, route (waypoints with rest / climb / sniff / fly), seed |
| Building hallway | size, walls, paint colour, suspended/plain ceiling, void depth, cable tray, doors, entrance, end window, windows in the outer wall, gas pipe in the ceiling void or along the wall, burst on a timer or only by fire/blast, burst position, delay and power, boxes, notice board, carpet |
| Camp island | size, sea level, ground and pad heights, how far east the pad reaches, ridge height, place and width, where the landing ground is, pier length, the zone the boat goes to, seed. A height field like the island: the level camp pad in the west, the ridge across the middle, the landing ground (its walk-in start) and a pier with a boat in the east |
| Drone camp | bastion ring radius, which way the gate faces, drones on launch pads, monitors on the desk, jammers, operations and floodlight loads (kW), the grid it runs on, tent canvas moisture. HESCO bastions, the command tent with the operations desk (a monitor per drone, the tactical map), crew tents, launch pads with quadcopters, a radio mast, jammers, floodlights, the power panel |
| Solar panel park | rows, panels in a row, tilt, facing (compass), row spacing, panel peak power, battery (kWh) and its charge at the start, the grid it feeds, where its cable runs. Panels on steel frames, an inverter/battery container |
| Wind turbine (windmill) | hub height, rotor radius, rated power, cut-in, rated and cut-out wind, restart speed after a cut-out, yaw rate, the grid it feeds, where its cable runs. Tower, nacelle, three blades turning with the weather's wind |
| Soldier squad on patrol | soldiers, the round's radius and corners, clockwise, call sign, expertise, body armour, ground height, recoil; a drawn patrol path (in place of the round) and area |

Models are made of simple shapes (box, cylinder, capsule, sphere, ellipsoid, cone, gable
roof) in their own frame. These are voxelised at any position, rotation and resolution.
Each shape has a material, optional fill probability (foliage, grass), moisture, colour
and an **effective density**. The density lets a 15 cm voxel stand for a 1.5 mm car
panel, a 6 mm glass pane or a 24 mm roof tile with the right mass, heat capacity and
fuel, so results do not depend on the voxel size.

### Terrain

`terrain` (`models/terrain.js`, edited with `editor/terrainPanel.js`) is the ground of a place:
a bed of ground `base` metres thick over the world's ground layer, of one surface, and on it a
list of **areas** in `params.areas`, saved with the scene like any parameter:

```jsonc
{ "type": "terrain", "x": 15, "z": 15, "params": { "width": 30, "depth": 30, "base": 1, "surface": "grass",
  "areas": [
    { "name": "Hill", "shape": "ellipse", "x": -6, "z": -5, "width": 12, "depth": 9, "rotation": 0,
      "height": 3, "mode": "add", "slope": 4.5, "profile": "smooth", "noise": 0.3, "surface": "grass" },
    { "name": "Pond", "shape": "ellipse", "x": 6, "z": 5, "width": 7.5, "depth": 5.5,
      "height": -1.2, "slope": 2, "surface": "water", "level": -0.2 },
    { "name": "Lava field", "shape": "polygon", "x": 0, "z": 8, "points": [[-3, -2], [3, -2], [0, 3]],
      "height": -0.6, "slope": 0.5, "surface": "lava", "level": -0.2 }
  ] } }
```

- **Footprint**: `rectangle` (width × depth), `ellipse` (across x and z), `polygon` (`points`,
  [x, z] in metres in the area's frame); `x`, `z` in the terrain's frame (from its centre),
  `rotation` in degrees.
- **Height**: `height` metres; `mode` `add` raises a hill or a plateau (+) or digs a pit or a lake
  bed (−) on the ground as the areas before left it, `level` flattens the ground at `height` above
  the base (a terrace, a pad). The flanks lie inside the footprint: `slope` metres wide (0: a
  cliff), `profile` smooth, linear or dome; `noise` metres of roughness. A pit goes down to the
  world's ground layer at most.
- **Surface**: `grass` (a turf of grass on soil; `moisture` dry < 0.15 kg/kg, green > 0.6; `tall`
  metres of tall grass over it: real grass fuel, a fire runs over it, and its blades are drawn),
  `soil`, `mud`, `sand`, `gravel`, `rock`, `volcanic` (basalt), `ash` (volcanic ash and cinders on
  basalt), `snow` (`snow` metres of the snow field, `sim/snow.js`, on frozen soil: it lies,
  settles, is trodden and melts like snow that fell), `water` (a mud bed filled with water to
  `level` metres above the base: a lake, a pond), `lava` (a basalt bed filled to its level with
  molten basalt at 1180 °C: it glows, flows, sets what it touches alight and crusts over as it
  cools), or `keep` (only the height changes).
- **Stacking**: areas apply in their order; heights add up (or level what is there), the last
  surface covering a spot wins. `enabled: false` leaves one out.

It is a height field voxelised as columns (the voxelizer's `columns` shape): under the hills only
a shell of ground (`shell` metres; the rest hollow, as the island's), down at least to the
lowest neighbour's top so no gap shows at a step. Objects on it stand on its surface with y
*auto*. Burning at start lights its grass nearest its centre. Two ground materials came with it:
**mud** (wet soil: heavy, ~2.2 kJ/(kg·K), it holds water) and **tephra** (volcanic ash and
cinders: porous basalt, ~1.1 t/m³, insulating, it melts as basalt does).

### Objects of objects

Any object can hold objects (`models/composite.js`): its `children`, each placed in its frame
(x, z and a numeric y in metres from the parent's origin; its turn and tilts on top of the
parent's), so they move and turn with it, and each stays an object of its own: its own params,
voxels, animations (the jets fly, the rig opens them), selectable and editable. They are numbered
depth first (a parent, then what is in it): the voxels' owner, `world.origins` and
`world.objectTree` (each one's record in the world and its pose).

A child of type `place` is a place: a world of its own (its `world`, `view`, `indoor`…) with its
own `objects`, which may hold places again. `liftPlaces` (run on every scenario, on
`cloneScene` and when a scene loads) makes each place a zone of the scene: `scene.zones[key]`
is the place object itself (editing the zone edits the object), with its schematic `box` where
it lies in the world and `within`: the place it is in (a portal `to: '..'` leads there). A
scene of one world with a place put in it becomes a world of places (its world the zone
`main`).

The **aircraft carrier** (`carrier`, `models/carrier.js`) is one: the hull and flight deck, and
in it the 16 jets, the flight of four, a tow tractor, gas bottles and drums, and **Below deck**
(a place: corridors, server room, guards) with the **Lower decks** in it (a place again). The
carrier scenario is built from it (the deck zone holds one object; below deck and the lower
decks are its places). Put it into any world from *+ Add › Places › Aircraft carrier*: it comes
with all of it, its places named apart from any already there (`below2`, … and its hatch and
ladders pointing at them).

In **Edit world** the outliner shows the objects as a tree (what is in an object under it,
indented; a place in it as ⌂, a click goes there). The gizmo moves and turns the selected object
with all that is in it; a child picked in the view or the list is moved on its own, in its
parent's frame (its X, Z and height in the properties are in that frame). *⇥ Into the one
above* puts the selected object into the object above it in the list, *⇤ Out* takes it out
(both keep it where it is in the world); in *+ Add*, *Put it inside …* places the new object
into the selected one; Duplicate and Delete take what is in an object along. A *Group* (nothing
of its own) moves things as one; a *Place* adds a room of its own to an object or a world.

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
   convection, plus wind, plus flame contact at about 1100 °C (a gas burner's premixed flame,
   as under the metal bars, at about 1500 °C). Radiation goes both ways:
   hot surfaces emit εσ(T⁴−T∞⁴), and flames and embers feed a blurred, inverse-square
   calibrated radiation field. Absorption can never exceed emission, and irradiance is
   capped at flame black-body level. The blurred field reaches about a metre; further out
   (`src/sim/farRadiation.js`) a big fire's radiant power is gathered into ~1 m blocks and
   every surface that can see a block takes P cosθ / (4π d²) from it: the line to it is
   marched through the air grid (walls and unbroken window panes shade it) and only faces
   turned towards the fire take it in. This is how a burning car sets the house next to it
   alight: its windows crack and fall out, the curtains behind them catch, the fascia, gutter,
   wooden frames and doors char and burn; and it warms and dries a tree a few metres off.
2. **Two-node voxels.** Bulk materials have a few-millimetre **skin** that exchanges heat
   with the gas and radiation, coupled to the **core** that conducts to neighbours. Both
   are solved together implicitly, which is unconditionally stable. This is what makes
   thick logs and walls ignite at their surface in tens of seconds, as real ones do,
   instead of having to heat a whole 5–15 cm voxel. Fine fuels (grass, leaves, needles,
   kindling) are single node.
3. **Moisture.** Water must boil off (latent heat) before a surface passes 100 °C; only the
   skin's water has to go before it can ignite. Dead fuels exchange moisture with the
   air humidity, and rain wets the topmost surfaces. A roof, a car body or any solid surface
   sheds the rain; foliage, grass and loose fuel let part of it through. So it does not rain
   inside a house. Evaporated water becomes **steam**.
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
   settles like sand. Glass cracks from thermal shock (from about 150 °C at its surface), and a
   pane in a hot layer (above about 280 °C) falls out as a whole, venting the room. A wick draws molten
   wax and burns it like a candle.
6. **Air.** Velocity comes from buoyancy (√(gΔT/T)-like), wind with a height profile,
   plume entrainment and some turbulence. Solids block the flow and ceilings trap hot gas.
   Temperature, smoke (mass plus colour), steam and burning gas are advected
   semi-Lagrangian and mixed. Heat exchange with the solids is implicit.
   - The wind blows in the open. Under a roof only a little of it gets through, and in a
     closed room none; indoors the air moves with the fire, and with what comes in through
     doors and windows.
   - A flame draws its oxygen from all the air cells around it, not from one, and the
     flames and hot gas stir fresh air in about a hundred times faster than still air mixes.
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
   - The liquid cools the wall it wets: the heat the flames put into the lower shell goes
     straight into the liquid. The wall above the liquid has only vapour behind it, gets
     red hot and loses its strength.
   - A working relief valve vents burning vapour as a jet flame; boiling cools the liquid.
   - Gas (LPG) cylinders are simulated as the real cylinder, whatever the voxel size (an 11 kg
     cylinder is one voxel on the flight deck, a few voxels of liquid at 8 cm): its mass, volume,
     radius, height and wall thickness. The heat the flames put into its shell voxels is the flux
     on the wall (where it has no voxels of its own, the air and flames round it); the wetted wall
     passes it to the boiling liquid, the dry wall above the liquid heats up. Propane: ≈ 8 bar at
     20 °C, 17 at 50, 26 at 70; the liquid swells as it warms (an 80 % fill is liquid-full near
     65 °C). The relief valve pops at 17.5 bar and reseats at 90 % of it; its vapour burns as a jet
     flame (≈ 0.12·Q^0.4 m long), the level falls as it vents, drying out more wall. It bursts
     when the pressure exceeds what the hot wall still holds (the BLEVE of a cylinder engulfed in
     flames, a minute or two even with a working valve) or once a blocked cylinder is full of
     liquid (hydraulic); at the edge of a fire a working valve jet-fires for minutes. The burst:
     a fireball of the flashing liquid and its spray, a blast (energy from the expanding vapour,
     overpressure by Hopkinson scaling), fragments, the top rocketing off. A hole in the shell
     makes a burning jet until it is empty. Click a cylinder (Inspect) for its pressure, liquid and
     wall temperatures, fill, relief valve, jet flame, and why it did or did not burst. There are
     racks of them below deck in the carrier (in the store room off the passageway whose gas line
     bursts) and at the military base (by the fuel drums, at the barracks' kitchen end).
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
    - At sea, any missing hull plating below the waterline lets the sea in: Cd·A·√(2 g Δh)
      (Torricelli), Δh being the height of the sea above the water already inside. The water
      goes where the sea pushes it, into the lowest free space connected to the hole (through
      open doors, not closed ones), so a compartment fills from the bottom up, quickly at
      first and slower as the levels meet, up to the waterline. A sealed space floods only
      until its trapped air is squeezed to the sea pressure (Boyle). This holds for every ship
      at sea: the ship section, and the carrier's deck below the flight deck, which lies under
      the waterline. On the ship section the fuel line bursts against the hull as a vapour
      explosion that tears the plating open.
    - **Water pipes** (the hallway's copper pipe, the ships' sea-water mains) burst in a
      blast or when the fire heats a joint. They pour water out (4 to 20 l/s) that runs down,
      wets what is under it and collects on the floor.
15. **Structure.** A flood fill from the ground finds parts that are no longer supported
   (a burnt-through trunk, a roof whose beams are gone), and they fall.

Calibration targets used during development (`npm run headless`):

| Case | Target | Simulated |
|---|---|---|
| Candle flame | ~60–100 W | ~25 W while the wax is solid, ~70–100 W with a melt pool |
| Campfire, 8 logs | 20–60 kW, logs catch from kindling in a few minutes | ~15–60 kW |
| Grass fire, 2 m/s wind | ~0.1–0.3 m/s spread | ~0.08 m/s from a point ignition, accelerating |
| Car fire | engine fire into the cabin in 3–10 min, 2–4 MW at its height, spreads to nearby buildings | ~0.2 MW in the engine bay, in the cabin after ~4 min, 2 MW at 6 min (a fuel-tank pool fire briefly more); the wooden house 2 m off catches ~7.5 min in (gutter, fascia, wall, shingles) at 10–25 kW/m² on its wall |
| Metal bars | copper spreads heat furthest, steel keeps a steep gradient | yes |
| Campfire in 50 mm/h rain | dies down, core keeps glowing | −55 % in 4 min, still dropping |
| 11 kg propane cylinder in a fire | relief valve opens around 17.5 bar; blocked valve: overfill and burst within minutes | vents at 17.5 bar after ~1.5 min; bursts at ~90 bar after ~2 min |
| Car fuel tank in a car fire | thin tank fails and leaks; explosions are very rare | splits, pool fire to ~10 MW |

### Performance: only what is doing something is computed

Big scenes are split twice over:

- **Zones** (the carrier scenario): only the zone you are in is built and simulated; the
  others are built the first time you go there and frozen while you are away, and drawn as
  simple stand-ins from a distance.
- **Sleeping blocks** (sim/activity.js): inside a zone the world is cut into blocks of 2 air
  cells (0.8 m at 0.2 m voxels). A block is awake when anything in it is off rest: gas or
  solids off the air temperature, smoke, steam, burning gas, flames, thermal radiation
  arriving, oxygen that is not fresh air, something burning, smouldering, molten, falling,
  wet or foamed, a heater, debris or a projectile. Awake blocks wake their neighbours (further
  downwind in strong wind), so fire, heat and smoke spread into sleeping parts the normal
  way. Only awake blocks go through the solid passes and the air model; every 50th step runs
  fully awake. Rain, an extinguisher in use, sprinklers or a decompression keep everything
  awake.
- **Soldiers far off are coarser** (OperatorFigure.setDetail): a soldier is ~570k triangles
  sculpted; beyond 6 m from the camera it swaps to the 'low' sculpt (its shadow too),
  ~54k, sculpted in under a second after the first. The rig page's shadow map is 2048².
- **The heat at 20 Hz** (Simulation.step): the heat, the air, fire and smoke and the weather
  step at most 20 times a second; at 60 frames a second they take every third frame (with
  the time since they last stepped), while the soldiers, projectiles, debris and water move
  every frame. Thermal radiation is blurred only round what radiates, and the air's view of
  the solids (open faces, occupancy) is updated at most 5 times a second while debris keeps
  landing. A grenade in the squad range: the simulation's share of a frame went from 15-25 ms
  to about 4-5 ms while the crates it set alight burn.

| Scene, quiet | All awake | With sleeping blocks |
|---|---|---|
| Hallway (before the pipe bursts) | 239 ms | 59 ms |
| Carrier below deck | 108 ms | 43 ms |
| The island (campfire, wind) | 116 ms | 46 ms |
| Catacombs (18 burning torches) | 222 ms | 120 ms |

(ms per 0.2 s step on the test machine.) Drawing: the voxel renderer draws only exposed
voxel faces; ossuary bones are drawn only in the chunks near you. The resolution is the same
everywhere in a zone: a coarser grid far from you is not done.

### Impacts: force, damage, shockwaves

`sim/impact.js` is one model for every collision: a kick, a punch, a judo throw, a soldier
landing from a drop or a roll, a body falling, the dragon coming down from the sky or stamping, a
loose drum it threw hitting the ground, a jet crashing, a car door slamming, a fragment hitting a
wall. From the masses (reduced mass μ), the closing speed v and the two materials it works out
the impulse J = μ(1+e)v (e, the restitution, from the materials' hardness and damping), the
energy ½μv², the contact time (Hertz contact of the two materials: tens of µs steel on steel,
~0.1 s flesh on soil; a roll spreads a landing over ~0.35 s) and the mean force F = J / t. What it
does follows from those: blunt trauma to a person (logarithmic in the energy taken, more to the
head, less through armour and in a long contact; a landing on your feet is harmless up to
~6.5 m/s), a stagger or a knock-down by the change of speed it gives him (0.6 / 1.5 m/s), loose
objects knocked flying, voxels crushed (`sim/crush.js`) and, from ~4 kJ on, a **shockwave**
through the ground of radius 0.25·E^⅓ m (a dragon landing ~10 m, a jet crash ~60 m): a ring of
dust and clods kicked up (drawn by `render/debris.js`), people near it staggered (close in,
knocked down), loose things jumping (`render/loose.js`), the camera shaking with the distance
(`shakeAt`). Every impact is an event (`{ type: 'impact', force, impulse, energy, materials,
db, ... }`) and, when big, a `shockwave`.

    impact(simOrWorld, { pos, normal, mass, velocity, massB, materials: ['flesh', 'soil'], scale, contactTime, source, target, zone, kind, effects })
    computeImpact(o)                                   // the physics only (the rig's readout)

**Force ×**: every impact's closing speed is multiplied by its act's and its object's Force ×
(so the impulse and force ×, the energy ײ). Each act with a contact declares it in
`rig/objects.js` `ACT_IMPACTS` (`{ t, part, material, target, v }`: when as a fraction of the
act, which body part, what it hits); the Rig stage measures the part's speed off the animation,
takes its share of the body's mass (`PART_MASS`: a fist ~5 %, a foot ~12 %, a landing body all of
it) and shows a **force indicator**: the force in N on a bar, the impulse, energy, contact time,
damage, knock-down, shockwave radius and the dB, an arrow at the contact and a ring for the
shockwave, the Force × of the act and of the object as sliders, and (Sound on) the sound. The
dragon's come from the simulation's own code (`ai/dragon.js impactOf`: landing, stamp, crash,
falling dead), the jet's crash when it reaches the ground, a car door when it slams. In the
world editor the dragon, the squad and the enemies have a *Force ×* parameter. Wired in the
world: the dragon's landings, stamps and crashes, the jet crash (`sim/jetDamage.js`), parkour
drops, vaults and rolls (`ai/squad.js`, `ai/enemies.js`, your own in the walk-through), a man
falling dead, debris hitting people (`ai/enemies.js`) and walls (`sim/vessels.js`), and
whatever the dragon throws (`ai/dragonAir.js`).

### Sound from physics

The sounds are synthesised, not recorded, and take their parameters from the state of their
source (`audio/physics.js`, used by `audio/sound.js`):

- **Struck solids** (modal synthesis): each body rings at modes set by its material's stiffness
  and density (c = √(E/ρ)) and its size and shape (flexural f ∝ c·t/L², solid f = c/2L: bigger
  is lower, stiffer is higher), each decaying with the material's loss factor (τ = 1/(π f η):
  steel clangs for seconds, wood knocks, flesh only thuds). The contact time decides how high
  they are excited (hard on hard: bright). The level is 10·log10 of the radiated energy (a share
  of the impact's, by material). Glass and ice shatter into ringing shards, water splashes with
  bubbles at their Minnaert frequency (3.3 kHz at 1 mm), a very big impact adds a ground boom.
  Mechanical and acoustic properties per material: `sim/materials.js mechanics()` (also flesh,
  scales, feathers, a ceramic plate, kevlar, ice).
- **Fire**, per burning region of the simulation (`sim/fireAudio.js`, gathered in the solid pass
  only while the sound runs): the roar is turbulent combustion noise (~2·10⁻⁶ of the heat
  release, louder in wind), its spectrum peaking at ~160/√D Hz (a bigger fire rumbles lower),
  puffing at 1.5/√D Hz; the crackle is a pulse train per material whose rate comes from its
  moisture (steam pockets bursting: most at ~20 %, less when soaked), resin (pine pops more than
  oak) and grain (grass crackles fast and small, logs seldom and loud); paper flutters, books
  smoulder quietly, plastics and fuels whoosh; water on hot surfaces hisses by the steam made;
  metals tick as they heat and cool (thermal expansion); a region flaring up all at once whoomps.
- **Flows**: the jet engine from its thrust (exhaust velocity, Lighthill's V⁸, Strouhal 0.2, the
  turbine whine from the spool speed), a breach in the hull from the pressure across it, a gas
  leak from its mass flow, wind (Aeolian tones), rain (drop rate, bubbles), the dragon's and the
  phoenix's wings from their area and beat, gunshots from the cartridge's energy, explosions
  from theirs.
- **Propagation**: inverse-square, the air absorbing the highs with distance, the speed of sound
  (a far crash comes late and dull), muffled through walls (line of sight) and under water.
- **CPU**: at most 28 one-shots at a time (a quiet one is dropped for a louder), three fire voices
  (the loudest regions, the rest merged), less detail with distance.

### Floating: Archimedes (boats, the carrier)

`sim/buoyancy.js` floats a rigid hull. The hull is a shape (keel line, sheer line, the
half-breadth at every height of every station: a box, a rowing boat with a transom and a fine
stem, a big ship), sampled once into ~1500 cells (the carrier ~11 000), each holding the volume
of the envelope there and how much of it is the open inside of the boat. The planking's volume
comes out at its surface × thickness × density (× a factor for frames, thwarts, gunwale): a
4.3 m clinker boat of larch weighs ~125 kg, an aluminium one ~95 kg, GRP ~135 kg.

Each step, in its pose on the water as it is there (still, or the waves of the weather: the
same spectrum `render/ocean.js` draws, `waveSpectrum`; in the app the very waves drawn):

- **buoyancy** ρ_w·g·V_submerged, each cell's share where the cell is (their sum acts at the
  centre of buoyancy); ρ_w 1025 kg/m³ on the sea, 1000 on a pond or a lake;
- **weight** m·g of the hull, the load and the people at the centre of mass, and of the water
  aboard where it lies (it runs to the low side);
- heave, roll and pitch as a rigid body with the water's **added mass** (heave ≈ ½·ρ·π/8·B²·L)
  and **damping** (making waves: ζ 0.25 heave, 0.08 roll, 0.3 pitch; quadratic drag), the wind
  heeling it (½·ρ_a·C_d·A·U²).

So the **draft** emerges where buoyancy carries the weight: an empty wooden rowing boat sits
~8 cm deep, ~12 cm with one aboard, ~15 cm with two, ~19 cm with four (2.5 % deeper in fresh
water). Pushed down it bobs back (heave period ~1.2 s) and settles. Heeled, the centre of
buoyancy moves to the low side, outside G while the metacentre is above it (GM = KB + BM − KG,
BM = I_waterplane/V): GM ~0.4 m, it rights itself in a few rolls. Water comes in through
**holes** below the waterline (Torricelli, Q = 0.62·A·√(2gΔh)) and **over the gunwale**
where it dips under (a weir, 1.77·d^1.5 per metre): it settles, the freeboard shrinks, the
inflow grows. Overloaded (2.5 t in a 4.3 m boat) it swamps and sinks; holed, an aluminium boat
goes down while a wooden one fills to the outside level and floats waterlogged on its planking,
as does an aluminium one with buoyancy tanks. In the world the boats' planking is voxels
(hidden, drawn by `render/floats.js` in their pose): where fire or a blast takes it away below
the waterline, that is a hole.

**Drifting and rowing** (`sim/boats.js`). A boat also surges, sways and yaws: the water drags
it towards the current where it is (a river's, a whirlpool's, `w.sea.current`, and the wind's
surface drift, ~3 % of the wind on the sea) with surge resistance ½·ρ·0.012·S·u² on its wetted
surface and side-on drag ½·ρ·1.0·L·T·u², its added mass, and the wind on its topsides. Moored
(params *moored*, *mooring*: a painter from its stem to a ring ahead of it) it swings on its
line; cast off it drifts, is kept off the shore, and finds the water's level and the bottom as
it goes. Walk up to one and press E (Shift+E for a boat with a destination): you sit at the
oars. W/S pull and back water, A/D turn (one oar pulls, the other backs), C casts off or makes
fast, E steps ashore. Each stroke (2 s, drive 42 %) pushes it at the rowlocks with up to 160 N an
oar: ~1.4 m/s. AI soldiers take seats with `boardSeat` / `leaveSeat`, and the one on the rowing
thwart rows it with `row` or `rowToward` (or `f.row.goal`); see the top of `sim/boats.js`.
A rifle round through its planking (the ray against the hull's shape in its pose) or a blast's
fragments hole it: below the waterline they let water in by Torricelli and it settles, swamps
and, with people aboard, sinks; above it they do nothing until it settles that deep.

**Its voxels go with it** (`sim/movingBody.js`, a generic moving voxel body; `stampFloat` in
`sim/buoyancy.js`). The hull, thwarts, floorboards and oars are kept in the boat's own frame
with their material state (temperature, fuel, char, moisture, burning, colour) and stamped into
the grid at its pose whenever it has moved half a voxel (at most ten times a second): the state
is read back from the grid, the old cells emptied, the voxels placed again (a voxel with no
room, rotated onto a neighbour, is held off the grid until the next pose). So a boat set alight
at its berth and rowed away keeps burning where it is, one adrift catches from a fire where it
drifts, and it burns down to its waterline (what is under the water is kept wet through); its
burnt planking lets the water in and leaves less shell to float on. A pond's water is pushed out
of its hull and closes in where it was. Limitations: the hot gas and flames over it stay where
they were as it moves (the fire makes new ones where it is); each restamp makes the world
rebuild its list of solids.

**The people aboard** (`sim/boatCrew.js`, drawn by `render/boatCrew.js` and, for the squads'
men, `render/enemies.js`) sit in their seats (their feet on the floorboards, tilted with the
boat) and do their seat's work, in step with the boat: the rower pulls (`boatRow`, its phase the
oars' stroke: catch, drive, recovery), paddlers paddle on their sides, the helmsman's hand
follows the tiller or the outboard's handle, a sailing crew hike out over the windward side (and
their weight really goes out: `hikeCrew` moves their loads, so the centre of mass, and that is
what rights it), passengers sit, aim and fire over the side. The model's *people aboard* are
drawn as boatmen; you are drawn whenever the camera is not at your eyes (V in the boat: from
outside).

**Kinds of boat.** The same hull and physics, driven differently (`sim/boats.js`, the model's
*kind*): the **outboard dinghy**'s motor spins up against its propeller's torque (rpm from the
throttle, idle ~950 rpm; thrust 130 N a kW × n² × (1 − v / pitch speed) × immersion: ~4 m/s with
7.5 kW), races to its limiter when the prop leaves the water on a wave, cavitates shallow, stalls
when swamped (R pulls the cord; W/S throttle, A/D tiller). The **sailing dinghy**'s una rig
(7 m²) is driven by the apparent wind (the true wind less its own velocity): the boom sheeted
out to at most the sheet's angle, lift ⊥ the flow by the angle of attack (stall ~17°) and drag
along it, a centreboard's lift against the leeway, a rudder that steers only with way on. So
the points of sail emerge: nothing in the ~49° no-go zone, a beam reach fastest; it heels with
the side force × the height of the sail's centre of effort against its buoyancy's righting
moment and the crew hiking out; the boom slams across in a gybe (W/S sheet, Q trim, A/D tiller;
the AI beats upwind, tacking). The **canoe** is paddled, a stroke on the side that turns it.
Drawn: the sail cambered as it fills and flogging as it luffs, the boom swinging, the outboard
turning with the tiller, tilted up when off, its wash; the paddle; the oars.

**Boat sounds** (`audio/boatSound.js`, pure; `audio/boatVoices.js`, Web Audio): every boat heard
from its physics, with distance and Doppler: the outboard's note at its firing frequency
(rpm / 60 × cylinders / 2 for a four-stroke) and loudness from the power it gives, brighter
under load and out of the water, its cavitation hiss, the cord and a stall's sputter; the hull's
hiss with the speed through the water, the prop's wash, the bow slapping down on a wave (from
the bow's closing speed on the surface), water sloshing aboard, grinding aground, the mooring
line creaking under tension; each oar or paddle stroke's catch (the rowlock's knock, the plunge)
and release (splash, creak, drips); the sail flogging when it luffs, rushing when it draws, the
shrouds' Aeolian hum (0.2·U / d), the boom in a gybe; rounds through the hull.

The squads (`ai/vehicles.js`) board these boats by their own seats (their weight aboard), and
the man in the drive seat rows, motors or sails them where they go (`f.row.goal`).

The **aircraft carrier** floats by the same law (`carrierBody`): a Nimitz hull, 317 m on the
waterline and 40.8 m wide there, 100 000 t with its centre of mass 15 m over the keel, floats
~10.3 m deep with GM ~1.7 m, rolling (period ~20 s) and pitching only a fraction of a degree
in a fresh breeze. Water flooding a compartment below deck is added at its place: it settles
(~0.1 m per 1000 t), lists and trims. The flight deck and the decks below are built in the
ship's frame, and walking, the jets landing, the hatches and every voxel depend on them: so the
ship stays still there and the **sea moves instead** (`sim/water.js stepBuoyancy`): the sea
level against the hull rises by how much deeper the hull floats than at rest, and its surface
tilts by the heel and trim (the ocean, the flooding through the holes and the HUD go by it).
The hull drawn round the deck (`render/hull.js`) keeps its draft line; the sea comes up it.

### Limitations

This is a real-time, approximate model, not a CFD fire code like FDS. The air flow is not
pressure-projected, so the exchange through a doorway or a broken window is too weak: a room
fire becomes short of oxygen sooner than a real one, and a house fire with the door open
levels off at a few hundred kW where a real one would reach a few MW. Radiation close in is a blurred field without real shadowing, corrected by a
view factor; further out it comes from a few point sources, shaded along one line each. A voxel stands for its material, so geometry finer than the voxel size is
represented through effective density and surface factors. Results are qualitatively
right and of the right order of magnitude, but should not be used for engineering.

## Rigid-body physics (src/physics)

One shared rigid-body engine for everything that tumbles, rolls, swings or drives, colliding with
the voxel world and with each other. Plain ES modules, no three.js (it runs in the tests as it
runs in the browser), deterministic (no `Math.random`: `world.rng` is seeded).

```js
import { PhysicsWorld, Box, Sphere, Capsule, ConvexHull, Compound, VoxelSet, VoxelGridCollider,
         HingeJoint, BallJoint, FixedJoint, DistanceJoint, SliderJoint, buoyancy } from './physics/index.js';

const world = new PhysicsWorld({ collider: VoxelGridCollider.fromWorld(sim.world) }); // fixedDt 1/60, substeps 2
const crate = world.createBody({ shape: new Box(0.3, 0.3, 0.3), position: [5, 2, 5], material: 'oak', density: 600 });
world.addJoint(new HingeJoint(null, door, hingePoint, [0, 1, 0], { lower: 0, upper: 1.6 }));
world.addForceGenerator(buoyancy({ level: (x, z, y) => 1.2 }));       // water at 1.2 m
world.onImpact((e) => sound(e.materials, e.speed, e.energy, e.point)); // { a, b, point, normal, impulse, speed, energy, materials, cell }
world.step(dt);                                   // as many fixed steps as dt holds
const { position, quaternion } = crate.interpolated(world.alpha);    // drawn between the last two steps
world.raycast(from, dir, 50); world.sphereCast(from, dir, 0.2, 50); world.overlapSphere(c, r);
world.explosion(center, { energy: 2e5, radius: 4 });
```

**Bodies** (`body.js`): dynamic, static or kinematic (`setKinematicTarget`); the pose is the centre
of mass position + a quaternion; mass and the full inertia tensor from the shape and a density
(or a mass the tensor is scaled to; a voxel set from its voxels' own masses); linear / angular
damping, gravity scale, collision filter `{ group, mask }`, `material` (a voxel material: friction
and restitution come from it), rolling resistance; `applyForce / applyImpulse / applyTorque`,
`velocityAt`, `toWorld / toLocal`, `setPose`, `interpolated(alpha)`.

**Shapes** (`shapes.js`): `Sphere`, `Box`, `Capsule` (any segment), `ConvexHull` (from points,
coplanar faces merged), `cylinderHull` (drums, barrels), `Compound` (child shapes with poses),
`VoxelSet` (a chunk of voxels: mass from every voxel, collision from its surface voxels and outer
corners). `shape.samples()` gives volume points for buoyancy.

**Collision**: sweep and prune over x (`world.js`), then `collide.js`: analytic sphere / capsule
pairs, closest-feature sphere and capsule against polyhedra, separating axes with face clipping
for polyhedron pairs (up to 4 points per normal patch), compounds child by child. Against the
world (`voxelCollider.js`): spheres against each solid cell near them with the normal components
that point into a solid neighbour dropped (a flat voxel floor has no seams to catch on),
polyhedra / voxel sets by their corners in solid cells (out through the cell's nearest open face)
and the grid's exposed corners inside them; speculative contacts within a margin that grows with
the speed; a heightfield `ground(x, z)` can stand in. Liquid voxels are not solid.

**Solver**: sequential impulses with warm starting (contacts matched to the last substep's by
position), Coulomb friction on two tangents (μ = √(μa·μb) from `physics/materials.js`, which
derives friction and restitution from the voxel materials' mechanics in `sim/materials.js`: shape
class, hardness, loss factor; measured values for ice, rubber, steel, soil...), rolling resistance
and spin friction, Baumgarte position correction above a slop, then a relax pass without it (no
bounce from pushing apart) and restitution e = √(ea·eb) for contacts closing faster than 0.5 m/s.
**Joints** (`joints.js`): ball (optional swing cone and twist limits, joint friction), hinge (angle
limits, motor, friction), fixed, distance (rod) / rope (max only), slider (limits, motor); all
breakable (`breakImpulse`). **CCD**: a body moving more than half its inner radius in a substep is
swept as its inner sphere against the grid and the other bodies and stopped at the first touch (a
fragment at 400 m/s does not pass through a one-voxel wall). **Sleeping**: islands (contacts and
joints); an island whose bodies have all been slow for 0.5 s sleeps; a moving body touching it, a
joint or an impulse wakes it.

**Budgets**: in the tests 200 scattered bodies settle and sleep at a few ms per fixed step while
awake (about 7 ms mean on a busy laptop) and well under a millisecond asleep; a dense pile is one
island and sleeps only when all of it is still. `PhysicsWorld.stats` has bodies, awake, sleeping,
islands, contacts, pairs and ms per step. In the simulation (below) the chunks are capped
(`maxBodies` 120, `maxVoxels` 1500 per chunk).

### In the voxel simulation (physics/simPhysics.js)

`enableRigidBodies(sim)` (or a scene with `rigidBodies: true`; the app turns it on for every scene
through `SIM_OPTIONS.rigidBodies` in `sim/createSimulation.js`, `?rigid=0` turns it off; the tests
and headless runs keep the old behaviour unless they ask) gives the simulation `sim.rigid`:

- **Debris chunks**: what the structure pass finds detached (`checkSupport` → `F_FALLING`) is
  grouped into face-connected pieces; a piece of 3..1500 voxels (not glass) becomes one `VoxelSet`
  body. Its voxels leave the grid with all their state (`sim/movingBody.js` `makeMovingBody`:
  temperature, char, burning, colour...), it tumbles, bounces, hits (impact events and sounds) and
  comes to rest; asleep it is stamped back where it lies (`restamp`), whole, still charred or
  burning, and the structure check takes it from there. In flight `world.rigidChunks` lists them
  and `render/debris.js` draws their voxels at the body's interpolated pose. Single voxels, glass
  and anything over the budget fall the old way.
- **Floating debris**: a buoyancy force generator on the world's water level (water voxels,
  `world.sea.level`): a wooden chunk in a pond floats; afloat it stays a (sleeping) body.
- **Loose things** (`world.loose`: drums, gas cylinders, crates, the training dummy): knocked by
  an impact or a blast (`sim/impact.js`, `sim/explosions.js`) they become bodies of their shape
  (box, 14-sided drum, capsule) that tumble and land; `o.p` / `o.rot` follow the body
  (`render/loose.js` draws them as before). A dragon picking one up takes it off the physics.
- **Fragments**: `sim.rigid.launchFragment({ p, v, size, material })`: a small hull body with
  continuous collision (gas-cylinder shrapnel can be handed over here).
- **Explosions**: `explode()` pushes every body in range (`physics.explosion`, with the v0 law it
  throws voxels by).
- **Impacts**: each one over 15 J becomes a `world.events` `{ type: 'impact', kind: 'rigid',
  materials, energy, speed, mass, pos }` for the sound (audio/sound.js) and a noise the guards
  hear; `sim.rigid.onImpact(fn)` has the raw events (for the material-impact synthesis).

### Ragdolls (physics/ragdoll.js, operator/ragdoll.js)

`createRagdoll(world, spec, { pose, velocity })`: capsules on the bones of a rig, ball joints with
swing cones and twist limits (spine, neck, shoulders, hips) and hinges with angle limits (elbows,
knees), built in the rest pose (so the limits are the body's, whatever pose he is in) and then
moved to the pose he is in when he goes limp. `soldierRagdollSpec(rest)` maps the operator rig
(`operator/rig.js` BONES): pelvis, torso, head, upper and fore arms, thighs and shins, 80 kg.
`FigureRagdoll` (operator/ragdoll.js) hands an `OperatorFigure`'s skeleton over to it, blending
from the animation to the ragdoll in 0.3 s; the bones without a part (chest, head, hands, feet)
go limp to their rest pose. `render/enemies.js` does this for every soldier who dies (guards and
squads; not while held by the dragon, on a rope or aboard a helicopter); the ragdolls live in a
render-side world on the voxel grid (`RAGDOLLS.on`). The dragon has no spec yet (rig/dragon.js
would map the same way: neck and tail chains of ball joints, the wings as hinges).

### Vehicle adapters (physics/vehicles.js)

Each vehicle becomes one chassis body plus a force generator, so it meets debris, crates,
ragdolls and the voxel world through ordinary contacts:

- `RaycastVehicle(world, chassis, { wheels })`: per wheel a ray down the chassis from its mount;
  a spring–damper strut; tyre grip in the ground plane (lateral slip curve, drive, brake, rolling
  resistance) inside the friction circle μN; the forces at the contact (and back on a body it
  stands on). `controls = { throttle, brake, steer }`. Tested: it settles on its springs, drives,
  steers and brakes.
- `RotorForce(body, { hub, axis, maxThrust })`: collective thrust along the cyclic-tilted rotor
  axis at the hub, rotor reaction and tail-rotor yaw torque; `hoverCollective()`.
- `HullBuoyancy(body, { cells, level })`: buoyancy from a hull's own displacement cells.

Migration (after the car-power and vehicle-body work has landed; not in this pass): cars
(`sim/carPhysics.js`) keep their drivetrain, EV and steering models and hand the tyre forces to a
`RaycastVehicle`-style adapter (its tyre model replaced by carPhysics' and `sim/groundContact.js`'s
grip, sinkage and rolling resistance per wheel), the chassis a box / hull body whose pose drives
`movingBody.restamp` as now; boats (`sim/buoyancy.js`) give their displacement cells to
`HullBuoyancy` and keep water aboard, waves and added mass as one more force generator; the
helicopter (`ai/helicopter.js`) maps its thrust and torques onto `RotorForce` and keeps its AI and
damage model. Each switch per vehicle, behind a flag, with the existing tests as the reference.

**Limitations**: contacts are matched by position (no persistent features); polyhedron–world
contacts sample corners (an edge crossing a voxel edge is caught a substep late);
capsule–polyhedron uses a line search (fine for these shapes, not exact); restamping snaps a
turned chunk to the grid (a voxel with no free cell is lost, counted in `sim.rigid.stats.lost`);
a chunk's fire and the air round it pause while it flies; chunk impacts do not yet crack what
they hit; ragdolls are drawn only (the sim's casualty stays where he fell); the existing vehicles
are not on the core yet.

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

Objects can stand on something with `"y"` (metres above the ground, e.g. the jet on the
flight deck), and hold objects of their own (`"children"`, in their frame; a child
`{ "type": "place", "key", "name", "world", "view", "objects", "x", "y", "z" }` is a place of its
own: *Objects of objects*). A scene can be split into **zones** instead of having one `world` and
`objects`:

```jsonc
{
  "name": "Carrier", "weather": { … }, "startZone": "deck",
  "zones": {
    "deck":  { "name": "Flight deck", "world": { … }, "view": { … }, "objects": [ … ] },
    "below": { "name": "Below deck",  "world": { … }, "view": { … }, "objects": [ … ] }
  }
}
```

Models connect zones with `portals` (`{ p, r, to: "below", label, arrive? }`). Pressing E
there switches to that zone, and you arrive at the portal there that leads back (its
`arrive` point). Zones in the open sea have an `origin` [x, y, z], so the jet and its
rockets can travel between them, and a `proxy` hint for how they look from afar before they
are built (`cell`: the stand-in's column size). With `"places": true` the zones are places of
one world: each with a `label` (its box's name in the overview) and optionally its own
`timeScale`; the camera coming close to one makes it the simulated one.

## Project layout

```
src/sim/        simulation (no dependencies): materials, world grid, solid + air physics, weather
src/physics/    rigid bodies (no three.js): shapes, contacts, solver, joints, CCD, sleeping, ragdolls, vehicle adapters
src/models/     parameterised models and the voxeliser
src/render/     three.js rendering: voxels or smooth surfaces, flames/sparks, particle or
                volumetric smoke/steam, rain, extinguisher spray, debris, view
src/ai/         enemies: senses, path finding around fire, luring with fire
src/walk/       first-person walk-through (firefighter), flying the jet
src/audio/      procedural sound, synthesised from physics (physics.js: modes, flows, propagation)
src/editor/     the editor: Play / Edit world / Rig, outliner, gizmo, palette, scene library, terrain areas
src/rig/        the character stage (stage.js: soldiers and the dragon; the editor's Rig mode)
src/camp/       the drone operations camp stage (stage.js; opened from the editor)
src/cinema/     film cameras and the movie: lenses, depth of field, the look, keyframes, moves,
                shot list (pure), and the director that plays it (render/cinePost.js: effects)
src/main.js     app, controls panel, HUD, tools, zones
src/scenarios.js  built-in scenes
scripts/        headless runner, profiler and tracing helpers
test/           node:test suites
```

## Soldiers: the operator rig and fire teams

Every enemy is drawn as a sculpted, rigged soldier (`src/operator/`), built once in the browser
(in workers, a few seconds) and shared by all of them; until it is ready (and in Node) the old
guard figures stand in.

- **Sculpt** (`operator/sculpt.js`): a signed-distance-field sculpt (body, multicam, plate
  carrier, backpack, high-cut helmet, beard and hair, gloves, a carbine), turned into meshes by
  surface nets with baked ambient occlusion. Each separable object is its own closed mesh.
- **Surface** (`operator/shader.js`): one physically based material, coloured per pixel by
  material id: multicam ripstop with seams and dust, MOLLE, shemagh weave, suede, skin, worn metal.
- **Rig** (`operator/rig.js`): 21 bones; the hands hold the rifle by inverse kinematics, so they
  can let go and come back. 24 clips: idle, walk, run (arm swing), crouch, aim, shoot, crouch
  aim/fire, aim-walk, prone aim/fire, reload (magazine out, a new one from the back pouch),
  throw a grenade, radio, draw the secondary, flame gun, jump, crawl, swim, three hand signals,
  hit, die, pick up a rifle; each with an unarmed version.
- **Objects**: the person, the rifle (with its magazine), the helmet and the backpack are
  separate; any can drop off as a rigid body. Everyone carries a compact carbine on his back
  and draws it when the rifle is gone. A flame trooper carries a flame gun (fires standing only).
- **Hit zones**: cylinders on the bones with a damage multiplier each.

**Fire teams** (`ai/squad.js`, model `squad`): a commander, a gunner and two riflemen advance on
a threat by bounding overwatch, from cover to cover (walls and crates: models `wall`, `crate`),
covering each other with real rounds, throwing grenades, crawling and firing prone when both legs
are hit. Teams talk on the radio (spoken, `audio/radio.js`): contact, the threat moving, a man
down; the first team leads and sends the others to a flank, tells them to hold off or continue,
and calls a pursuit when the threat moves away. Scenario **Squad on a range**; the tool *Squad:
set the threat* moves the threat.

**Sides**: each team has a *Side* param (`ai/sides.js`): *red* (the default) fight you and the blue
teams, *blue* are on your side and fight the red ones (never you: their rounds pass you by, and on a
drawn patrol their guards do not take you for an enemy), *green* is a third side against both.
Teams of different sides fight each other: each sees the other's men as it sees you
(`ai/perception.js`: distance, light, smoke, walls, a moment to notice), the nearest one made out is
its threat and each man fires at the nearest he sees; rounds of another side crack past them
(`m.shotAt`: pinned down), knives and fists land on them too. The leader counts **every hostile he
knows of**: the ones his men see, saw in the last 30 s (`sq.known`, `knownHostiles()`) or that a
friendly team within 60 m sees; and the men standing in the friendly teams fighting beside him (within
40 m) count for his strength, so it is the team that is outnumbered that falls back
(`ai/strategy.js assess`: `a.enemies`, `a.friends`); a team that knows it is outnumbered two to one
weighs it at once, even far off (it breaks contact; pinned down or losing men, it retreats). Each team needs a call sign of its own (two
teams with one call sign are one team). Scenario **Squad against squad**: two blue teams meet a red
one on a long range; outnumbered, the red team retreats.

The range has a **lookout**: model `deck` (`models/deck.js`), a concrete deck 3 m up on pillars
(width, depth and height are parameters), a straight staircase up one side (a step per voxel
layer, so the 3D paths of `ai/enemies.js` and the walk-through climb it) and glass rails round it,
open at the head of the stairs. It gives the world its lookouts (`world.lookouts`: the deck's
corners and the middles of its open sides, at deck height), and the simulation's squads get them
as `host.lookouts` (only in worlds that have any): before contact a rifleman climbs up to look
round, on contact a gunner takes it as overwatch when it sees the threat, and the climb goes by
the stairs (`host.path3d`, the guards' path finder over floors and stairs).


**Character rig** (`src/rig/stage.js`, the editor's *Rig* mode; `rig.html` mounts it on a page of
its own): the soldiers on an empty field, with every clip, the loadouts (rifle, shotgun, pistol, machine gun, flame gun), the
weapon in hand, armour, reload speed and look, the hit areas (shown, resized, damage multipliers:
`operator/rig.js` `ZONES` itself, so edits apply in the world too), damage on click, the gear
(dropped or knocked off as rigid bodies, re-equipped), grenades and flash-bangs, and an FPS
readout. The range it used to have (walls, crates, the deck, squads and their AI, hostiles,
noises, fog and night) is gone: squads are tried out in the voxel world now. The editor mounts it
with `mountRig(el, { onExit })` → `{ show, hide, select, dispose }`; `select({ kind: 'soldier',
loadout: 'torch' })` or `select({ kind: 'dragon' })` picks what it shows; its markup and CSS stay
inside `el` (class `rigst`, elements by `data-id`). URL options: `?anim=`, `?zones=1`, `?t=`,
`?tab=anim|hit|gear|dragon`, `?cam=`, `?nopanel=1` and the dragon's below.
Its *Dragon* tab shows the simulation's dragon instead (the same AI and renderer, in a small
field of its own with a wall to climb): every act as a button (rest, walk, run, sniff, roar,
breathe fire, bite, rear and stamp, climb, take off, fly, glide, bank, land, hurt, die, shot
down), a speed control, its hit zones shown and adjustable (radius, length, damage; the
simulation uses the same table), and damage on click with an arrow, a bullet or a rocket: the
zone under the cursor flashes and bleeds (`ai/dragon.js` `DRAGON_ZONES` itself).
`?dragon=1&dact=fly&dzones=1` (or `?tab=dragon`) opens it.
`node scripts/build-rig-artifact.mjs [out.html]` builds `rig.html` as one self-contained HTML file.

### Squads: senses, the commander's calls, cover

Fire teams also find their enemy themselves: they see hostiles as far as fog, smoke and darkness
allow (thermal goggles see further), hear noises and send two men to investigate (under radio
silence), mark what they see as the threat and follow it, and go back to the last known position
when they lose it. The commander orders thermals, lights on or off (not when that would give them
away), radio silence and backup; cover at the ends of walls and edges of crates is preferred and
the gunner takes higher ground a little behind.

**Guards are fire teams.** The simulation's guards are the same agents: each guard team gets a
call sign and roles (its leader the commander). While nothing is going on the guard AI keeps
them on their patrol (in file, through doors, on their round); once the team sees you, hears
something or notices a lamp, the squad AI has them, and gives them back afterwards. Heat, fire
and the dragon still make them run, and one may still slip off to light a lure.

### Senses: sight and hearing for every agent; peeking; flashlights

**Perception** (`ai/perception.js`) is one set of rules for everyone who senses: the squads and the
guards (`ai/squad.js`, `ai/enemies.js`), the dragons (`ai/dragon.js`), the phoenix (`ai/phoenix.js`),
a jet's pilot (a profile, `SENSES.pilot`).
- **Parameters per agent**: `sightRange` (m, in clear daylight), `fov` (degrees; 360: all round,
  a team watching its sectors), `hearing` (× how far a sound carries), `nightSight`; the defaults
  per kind keep what each did before (the squads as far as the weather lets them, up to 400 m; a
  guard alone 22 m; the dragon 45 m, 13 m dozing; the phoenix 9 m). The models' params (squad,
  enemies, dragon: *Sight*, *Field of view*, *Hearing*) and the rig's Gear tab (*Senses*) set them;
  **experience** scales them (`SKILL_SENSES`: an elite man sees further and notices sooner).
- **Sight**: from his eye (standing, crouched, prone, peeking: `eyeOf`), in his field of view
  (slower at its edge), through the voxels (walls and roofs block it; glass and foliage dim it;
  smoke builds up and blocks it). **Noticing builds up** (`perceive`): close and plain a fraction
  of a second; far, in the dark, through smoke, half behind cover, still, camouflaged: seconds or
  never. Seen a moment ago, or where the threat is known to be: at once.
- **Light**: the world's light level if it has one (a time of day: `world.lightAt(p)`,
  `world.light.level`, `world.lightLevel`, `world.ambient`, `world.sun.light`), else its `dark`
  flag. Darkness shortens sight (by `nightSight`); a beam (a flashlight) lights what it falls on, so
  the man with the light sees there; and **a light carried on gives its carrier away** from far off
  (further for whoever looks into it).
- **Hearing**: sounds are events `{ pos, loudness_dB, kind, source }` (`emitSound(world, ...)`, for
  the impact and sound modules too) in `world.noises`. A sound carries to the threshold of hearing,
  spreading and absorbed on the way (`rangeFromDb`: a rifle shot ~3 km, a walk on stone ~20 m);
  each wall between takes 12 dB off (a low wall it goes over does not); a keen ear hears further.
  Where it came from is uncertain (the further, the less sure): that is where they go to look, if it
  is near enough to bother (`investigate`: soldiers 250 m, guards 120 m). Gunshots (per weapon),
  grenades and explosions, flash-bangs, rockets, the bow, and your footsteps (by pace and ground:
  running on stone is loud, a crawl on grass hardly) are sounds; older noises with a range in metres
  are the same thing (`dbFromRange`).

**Peeking** (`ai/peek.js`; the rig's *Peek* group): **over a low wall** (`peekWall`: from the crouch
he rises just enough for his eyes to clear the top, looks left and right, drops back), **round a
corner** (`leanLeft` / `leanRight`: the weight onto that leg, the spine rolled over it, the head
level; a right-handed shooter leans out right more naturally, further to the left; with a pistol
one-handed, the other hand on the wall) and **slicing the pie** (`sliceLeft` / `sliceRight`). A squad
man in cover who has lost sight of the enemy (seen before, gone a few seconds) peeks to find him:
over the wall in front of him, round its edge, or slicing where there is room. The more experienced,
the shorter (`PEEK_T`: 2.6 s a recruit, 1.1 s elite) and the less predictable (another place or side,
irregular waits). His eye is where the peek puts it, so the peek finds what is there, and **his
head shows** while it lasts (others see it: `headOf`). In the walk-through: **Z / X** held lean you
out left / right (as far as there is room), and low behind a low wall **Z and X together** raise you
just enough to look over it.

**Flashlights** (`ai/flashlight.js`): a **weapon light** is an attachment (the rifle, carbine and
shotgun have one by default; the models' *Weapon lights*: standard, all, none; per weapon
`m.weaponLight`), shining along the muzzle where he aims. Without one, the **hand torch** from the
pouch on the left of his belt (the models' *A hand torch on the belt*), **only with a hand free**:
the knife, the pistol (held one-handed; the torch under the wrist, the **Harries** hold, or out to
the side and high, the **FBI** hold) or bare hands. With a two-handed weapon and no light on it he
cannot, unless he switches weapons. Drawn and put back by hand (`drawTorch` / `stowTorch`); the
left arm holds it by its own inverse kinematics over whatever clip plays, pointing it where he looks.
The team switches lights on in the dark once in contact (not while stealthy, on patrol), and the men
searching (a last known position, a blast, clearing a building) use theirs. The lights themselves
are a small pool (`render/flashlights.js`: three spot lights, given each frame to the biggest on the
screen, `render/lod.js`'s budget `flashlight`); every light has its lens's glow and a faint beam in
the air. In the walk-through **N** is your flashlight: the rifle's light, or with a hand free (bare
hands, the fire torch, a grenade) the torch from your belt; not with two hands on the hose, the bow
or the extinguisher. Your light (and the helmet lamp, L) shows you to the guards in the dark.

### Soldiers: expertise, ammunition, armour, the knife

Each soldier (`ai/soldier.js`) has an **expertise**: recruit, regular, veteran or elite (the
squad model's *Expertise*; mixed: a veteran commander, regulars, a recruit; guards likewise). It
sets how far his rounds scatter (more when moving, wounded in an arm, or far off) and how fast
he reloads and switches weapons. **Ammunition is limited** for everyone: magazines (the gunner a
belt), reloading with the animation; dry, he goes to the compact secondary, then the knife, and
says so on the radio. Your rifle has 30 rounds and 4 spare magazines. **Body armour** (plates,
helmet; the model's *Body armour*) stops most rounds to the torso (a heavy round more often gets
through, a knife never) and the helmet turns some. **Damage depends on the weapon and where it
hits** (`sim/wounds.js` `WEAPONS`): rifle, the gunner's heavier round, buckshot, a pistol, the secondary's pistol
calibre, the knife, fragments, arrows; rifle rounds hit the dragon's zones too. **Close
combat**: an enemy within ~2 m and the rifle goes away, the knife comes out (an animation each
way); he closes in and stabs. A man **badly hit** is called in by the nearest of his team
("Medic!"); under **heavy fire from one side** someone throws a grenade that way and shouts it.

### Weapons: how each is held, and what it lets a man do

The weapon in a man's hands changes his animations and his moves (`ai/weapons.js` `HANDLING`, one
profile per weapon; `operator/rig.js` `WEAPON_STYLE` holds them on the figure). Primaries: the
**rifle**, a **pump shotgun** (12 gauge, 7 shells), a **pistol** (9 mm), the gunner's **machine
gun** and the **flame gun** (its tanks on his back); the carbine is everyone's secondary.

| Weapon | Grip | Carry / aim | Not with it (what he does instead) |
|---|---|---|---|
| Rifle, carbine | pistol grip; foregrip (the carbine: magazine well) | low ready / at the shoulder, bladed | everything allowed |
| Pump shotgun | grip; the left hand on the pump, worked back and forward after every round | muzzle lower / shoulder, weight forward | everything allowed (sprint ×0.97) |
| Pistol | one hand on the move; aimed, the left cupping the right | compressed ready at the chest / arms out, square to the target | everything allowed |
| Machine gun | left hand over the top of the handguard | hip carry / shoulder, leaning in | no roll (a dive flat into cover, or a crouched side step), no speed vault (side vault ×1.25), no jump climb, mantle ×1.3, no landing roll, no slide; crawl ×0.7, sprint ×0.85 |
| Flame gun | trigger grip and the wand's grip | hip carry / from the hip, the nozzle raised | no roll or dive (a crouched side step), no crawling or going prone, no climbing or mantling, side or step-over vaults ×1.4 only, drops up to 1.6 m, no slide; sprint ×0.72 |

- **Clips per weapon**, baked once each and shared (as the firing clips are per recoil): every
  armed clip held that weapon's way (grip offsets along the weapon, carry, aim, stance), its
  own reload (the shotgun's shells one at a time from the belt, the pistol's magazine), and
  the firing clips from its recoil (`ai/recoil.js`: the shotgun's heavy single kick, then the
  pump stroke; the pistol's muzzle rise). The figure swaps them as the weapon in his hands
  changes (drawing the carbine, back to the primary); the shotgun's pump slides with the hand.
- **The AI respects them**: `ai/evade.js` picks a crouched **side step** (`sidestepLeft` /
  `sidestepRight`) or a **dive into cover** where the weapon rules a roll out; `ai/parkour.js`
  `ability()` leaves out the moves it rules out (the route planner goes round), slows the rest;
  the squad's pace follows it (`gaitK`). Guards and the dragon's victims too.
- **The player**: the rifle and the hand-held fire torch have profiles of their own (the fire
  torch: no roll or dive while lit, a side step instead; slower climbs).
- **Models**: the squad's *Riflemen carry* (rifle, shotgun, pistol, mixed) and the guards'
  *Weapon* (rifle, shotgun, pistol, mixed).
- **Rig**: the Gear tab's *Primary* select shows each weapon's poses (Animate tab), lists its
  grip, carry, aim and what it rules out, and greys out the acts it does not allow.

### Hand-to-hand: boxing and judo

A man with no weapon (loadout *unarmed*: the squad's *Riflemen carry*, the guards' *Weapon*; or
out of ammunition with the knife gone) fights with his fists, feet and throws (`ai/melee.js`). Unarmed is the most
agile profile (`ai/weapons.js` `unarmed`: every move allowed, a little quicker). From a **boxing
guard** (left fist forward, the right by the chin, light on his feet) he closes in and picks by
the distance and his man's state: **jab, cross, hook, uppercut**, a **front kick, roundhouse kick,
low kick** further out, the **clinch** close in, and from the clinch (or with his man dazed) a
**hip throw** (o-goshi), **shoulder throw** (seoi-nage) or **foot sweep** (de-ashi-barai). Each
move lands at its time if the other man is still within its reach (out of it: a miss) for its
damage and a daze; a **block** takes three quarters off, a **slip** makes a punch to the head miss.
Hard blows can **knock him down**; a thrown man lands on his back over the thrower (the throws and
the clinch are paired clips, the thrower's and the thrown man's, in step), lies there, and
**gets back up**. In the walk-through: **G** punch, **V** kick, **B** throw the man in front of
you. The rig's Animate tab has a *Hand-to-hand* group: each strike against a sparring partner
who takes it, the throws and the clinch with the partner in the other half of the pair.

### Gear: carrying, switching, dropping, picking up; experience

- **Where each weapon rides** (`ai/weapons.js` `HANDLING[k].slot`): the rifle, shotgun and machine gun
  slung across the back, the carbine across the back on the other diagonal, the pistol in a holster
  on the right hip, the knife in its sheath on the right thigh, the flame gun's wand clipped at the
  right side (its tanks on his back). **Switching** puts the one in his hands away to its place (the
  right hand's own path: over the shoulder, down to the hip) and draws the next from its place;
  `carried(m)` lists what a man has (his primary, the carbine, the knife, bare hands), and the rig's
  Gear tab shows them as buttons; the AI picks among them by the situation (dry: the carbine; close
  in: the knife; no knife: the fists). In the walk-through, 8 is bare hands.
- **Drop weapon** (`OperatorFigure.dropWeapon`): whatever is in his hands (rifle, shotgun, pistol,
  machine gun, carbine, knife, the flame gun's wand) falls as a rigid body; he is bare-handed after
  (fists up). On death the same.
- **Pack off** (`dropPack`): the chest and waist buckles, the right shoulder strap, then the left,
  the pack swung round to the front and lowered to the ground in front of him; a flame trooper's
  tanks (and the wand) come off with it, and with them what the tanks ruled out.
- **Pick up** (`pickUp`): he goes to what he dropped, bends down and takes it (both hands for a long
  gun or the pack, one for a pistol, the knife, the helmet), or takes it up in a forward roll over it
  (`rollPickup`). The AI's disarmed men already go and pick their rifle up.
- **Experience** (`ai/soldier.js` `SKILL`, `SKILL_INFO`): recruit, regular, veteran, elite, per man
  and per squad / guard group (the models' *Experience*; the rig's Gear tab per soldier): aim
  (scatter), recoil control (`ai/recoil.js`), reaction (and blocking a blow), reload, switch, drop
  and pick-up speed, nerve under fire (how readily he flinches into a roll), hand-to-hand (how hard
  and how well he picks his move).
- **Contacts for the impact model**: `ai/melee.js` `IMPACTS` declares, as plain data, when and with
  what each strike, throw landing, knock-down, dropped weapon and lowered pack touches what
  (`{ t, part, material, target }`); `meleeDamage` is the one place the damage is computed.

### Team tactics: formations, files, splitting, rooms, floors

`ai/tactics.js` measures the ground on the squad's grid (how wide it is, the rooms, junctions).
- **Formations** (the commander decides each change and signals it by hand): far from the
  threat in the open the team moves as one: two side by side, three in a wedge, four in a
  diamond (a square at a halt), more in a wedge; each man watches his sector (front, flanks,
  rear). Near the threat, or under fire, he signals bounding overwatch.
- **Narrow places**: they line up in file (also while bounding: each waits for the man ahead).
- **A T in a corridor**: the commander may split the team; the gunner becomes acting commander
  of the other half and takes the other branch; they join up at the objective (or on contact).
- **Into a room** they have not cleared: they stack up beside the door, one throws a
  **flashbang** in (it stuns whoever sees it and whites out your view), and they go in right
  after the bang.
- **Buildings**: to reach something on another floor they work their way up (or down) by the
  stairs, clearing each floor room by room ("Clear!", "floor 1 clear").
- **Stairs and hills**: going up or down stairs (or a steep climb) they use the stairs clips (knees
  high, leaning in; knees bent, eyes on the steps); down a steep hill outdoors they slide, seated,
  feet first. The guards too.

A **lookout** (`host.lookouts`: a raised place, such as a deck): before contact a rifleman climbs
it to look round, and on contact the gunner takes it as his overwatch when it sees the threat; he
stays up there while the team is within reach, and comes down by the stairs.

### Ropes and cables: rappelling, fast-roping, the zipline

`ai/rope.js` (pure logic) takes a man down a rope or along a cable; while he is on it (`m.rope =
{ rope, s, phase, ... }`) it moves and poses him, and his squad AI (`host.ownMove`) and the guard
AI leave him alone. A rope is a plain object in `world.ropes`: `{ id, kind: 'fastrope' | 'zipline'
| 'rappel', top: [x, y, z], bottom: [x, y, z], owner?, attached? }`; its `top` may move every step
(a hovering helicopter writes it) and whoever is on it goes with it (an `attached` fast rope hangs
straight down from its top). `startRope(sim, m, rope)` puts a man on one (false if he cannot:
dead, both arms hit, or the rope taken too close to its top), `stepRopes(sim, dt)` moves everyone
on ropes (the simulation's step, after the squads).
- **Rappel**: at the edge he clips in and turns his back to the drop, sits back into the rope over
  the edge (`rappelStart`), bounds down the wall, feet on it, leaning back, the brake hand letting
  rope run in each swing out (`rappel`, at most 1.7 m a bound, the depth split into equal bounds:
  about 1 m/s, never over 3), stands up on the ground and unclips (`rappelEnd`), and the rifle
  comes back round off his back. A squad man whose way leads over a drop too deep to jump (a roof
  edge) goes down a rope there, or one lowered by a man who carries one (the rope drill below;
  the rope stays for the next man); the player with **Space** at such an edge rigs his own
  (`rappelFrom`).
- **Fast rope** (a helicopter's, or model `rope`'s gantry): he swings onto the rope, both hands on
  it and the rope clamped between his boots (`fastRope`), slides down braking with hands and feet
  (towards 4.5 m/s, slower with a heavy load, braking to land at 1.6 m/s), lands in a crouch and
  runs 3 m clear, each man a different way. Men on one rope keep 3.2 m apart, and nobody comes
  down onto a man who has not cleared the bottom.
- **Zipline** ("vaulting along a cable"): from the high end he hangs from a pulley on the cable
  (`zipline`) and runs down it with the slope (g sin θ less the pulley's friction and the air's
  drag; a gloved hand keeps him under 9 m/s), brakes in to the low end, lets go and drops to the
  ground. Too flat (or rising): hand over hand (`zipHand`).
- **Hit on the rope** (a wound: `sim/wounds.js`; a round the plate stops only rocks him): his
  hands open and he falls (`ropeFall`), landing through `sim/impact.js`; a rappeller keeps the guide
  hand on the rope and slides down it out of control. The weapon is slung all the way (its carry
  slot, `ai/weapons.js` `HANDLING`).
- **Placed ropes**: model `rope` (editor group *Cover & buildings*): a fast rope from a gantry, a
  zipline between a tall and a short pole (height, span, drop), or a rappel anchor at a roof edge
  (with or without a rappel tower of its own); the voxelizer puts its rope in `world.ropes`.
  `render/ropes.js` draws every rope and cable (and the pulleys); the figure draws the rope
  through his hands while rappelling or fast-roping (`operator/rig.js` `updateRope`).
- **Player**: Space at the top of a rope (a fast rope, a rappel anchor, a zipline's high end
  overhead) or at a drop too deep to jump: down it as the soldiers go (a stand-in rider in
  `world.ropeRiders`); hit on the rope, you fall.

#### The rope drill: overwatch on a descent, ropes as gear, the team rope-down

`ai/ropeTeam.js` (pure logic, stepped by each squad AI after its senses) is what the rest of a fire
team does round the man on the rope. A man it has (`m.ropeTask`: `watch`, `wait`, `rig`, `stack`,
`hold`) is not the squad AI's to move (`host.ownMove`); the squad gets him back when the drill ends.
- **Overwatch** (any descent: a helicopter's fast ropes, a gantry, a rappel off a roof): the first
  man down goes ~4.5 m off the rope's foot (5 m under a helicopter), drops to one knee facing out
  (`kneelAim`: his sector away from the rope), weapon up, scanning; a hostile the team has
  identified (`ai/perception.js` through the squad's senses) in his line of sight he fires on in
  bursts (`kneelShoot`), covering the man on the rope. Each man down after him joins and the
  sectors are split again (off a wall: an arc of ±72° away from it; in the open: the full circle);
  the men waiting their turn at the top kneel back from the edge, one behind the other, facing out
  over the drop and covering the ground below, and go as soon as the rope takes them (a
  helicopter's troops by its doors crouch in them, covering, as before). All down: the perimeter holds 2 s, then each man
  is on his way again.
- **Rope as gear**: a man carries rope coils (`m.ropes`; the squad model's **Rope coils carried**,
  one a man, the riflemen first; default 2). At a drop too deep to jump (`host.rappel` →
  `lowerRope`) he uses a rope already there (queueing for it), or with a coil kneels at the edge and
  ties it off round something solid (a parapet, a post; else round the edge itself: `anchorRope`),
  stands and throws it down (`throwRope`; "Rope!"), and goes down it; without one he calls the
  nearest man who has one ("rope up here") and waits while he lowers it. Nobody in the team has a
  rope: not that way (`'cannot'`: the squad drops it and looks for another). `host.autoRig`: men
  with no coils listed rig as many as they need (the old behaviour).
- **Team rope-down**: up on a roof or a cliff with the objective (their goal, the threat, what they
  investigate) more than 2.2 m below and an edge towards it within 22 m, with two or more ropes in
  the team, the leader takes them down together (the squad model's **Team rope-down**). He signals
  it ("rope up, on my mark": a hand signal, and on the radio unless they keep radio silence); each
  man with a rope goes to his own spot along the edge, 1.7 m apart, anchors and drops his rope and
  kneels there ready (a man without one waits behind the nearest rope). Set, one throws a flashbang
  down onto the landing area (the room-breach flashbang: whoever is below with it in view is
  blinded and deafened for a few seconds); on the bang ("Go, go, go!") they all go over at once, a
  quick assault rappel (`rappelQuick`: a short sit-back, 3.2 m bounds, ~2.8 m/s), land, take
  kneeling cover round the foot of the ropes, and the squad carries on from down there (the grid
  rebuilt on the new level; they do not rope down from that level again).

### The retreat: peeling back, the wounded, a wire on the door

`ai/retreat.js` is one of the leader's strategies (`ai/strategy.js`: suppress and flank,
envelop, bound, defend, withdraw, **retreat**). There is no button for it: the squad decides,
signals and reports by itself (`ai/retreatRadio.js`); once begun it is seen through.
- **Deciding**: the leader weighs, in order, and logs the first reason that holds with its facts
  (`sq.retreatWhy`, `sq.retreatLog`: `retreat:decide:<why> · <men standing, enemy strength,
  under fire, ammunition>`): *ordered*; *the commander is down*; *heavy casualties* (men down and
  an enemy as strong as the men standing); *outgunned* (enemy strength, a man 1, a vehicle 4, a
  helicopter 6, the dragon 8, twice theirs with heavy weapons among them, or three times theirs);
  *flanked* (enemies seen well off the line to the threat); *pinned down* (two or more men hit or
  with rounds cracking past, `m.shotAt`); *low on ammunition*. Plain numbers, two to one, still
  mean the older team-by-team withdraw.
- **The word in the squad**: the leader shouts "Fall back! Fall back to the rally point!" and
  gives the hand signal (clip *signalFallBack*: arm up, circling, swept to the rear; repeated while
  anyone lacks the word). A man **hears** the shout if it carries over the din (~40 dB quiet, ~65
  dB in the fight: some 10 m) less the walls between (`perception.js wallLoss`); he **sees** the
  signal when he looks over (every second or two) and has the leader in sight, within what the
  weather and the dark allow; otherwise the next man who has it **relays** it ("Rifleman two, fall
  back, pass it on!", or the signal), a second or so later. Under radio silence there is no shout,
  only signals. A man who has nothing but sees his mates pull back follows; one alone goes after a
  while. Each man **acknowledges** ("Falling back!", or a thumbs-up under silence) after his
  reaction time, and **no man peels back before he has the word**
  (`sq.strategy.word.men`: how, from whom, when, acknowledged).
- **Calling it in**: once the squad has it, the radio man calls all friendly stations (the retreat
  breaks radio silence): position (grid), why, the enemy's strength and kind and where, the rally
  point. Only teams on the same side hear it (`host.side`, else the men's `m.side`, else all one
  side; the lead's orders, reports and backup calls also go to friendly teams only). Each answers in
  turn and acts: a team **within 50 m** moves up to an overwatch beside them, towards the threat,
  and puts suppressive fire on it (`sq.supporting`); one **in contact beside them, facing the same
  way**, its flank open now, falls back too ("our flank is exposed"); one **already falling back**
  says so; one **further off** acknowledges, holds and notes the rally point. Voices go out as
  radio events (`audio/radio.js` speaks them), the lines over the men's heads (`m.signal`).
- **Rally point**: a param, else where they started (if that is behind them), else ~20 m back
  out of the enemy's sight; each man has a slot there.
- **Peeling back** (bounding overwatch backwards): one man at a time, the one nearest the enemy
  first, goes to the next cover behind the rearmost man ("Moving!" / "Covering!" / "Set!"), the
  others firing at what they see; a short bound he backs off with his weapon up (clip
  *aimWalkBack*), a long one he turns and runs. A man moves only while another covers.
- **A man down**: carried or left behind, by the param or (auto) by the best carrier's
  experience, how close the enemy is, whether he can still fight, how badly hurt he is and how
  many are left. **Carried**: the carrier runs to him, slings his weapon, takes his pack off (the
  staged pack drop), lifts him into a fireman's carry (*liftCasualty* / *lifted*), walks him back
  slowly, unable to shoot (*fireCarry* / *carried*), puts him down at the rally point
  (*putDownCasualty* / *setDown*) and takes his weapon up again. **Left behind**: he stays where
  he lies and, if he still can, gives covering fire, prone, his aim the worse for his wounds,
  for as long as he has rounds.
- **The tripwire**: the last man back through a doorway (a gap in a wall on his way, room on
  both sides) stops, kneels and strings a wire across it at ankle height with a charge on the
  jamb (*setTripwire*), then moves on. An enemy whose feet cross it sets it off: the blast
  (`sim/explosions.js`), its shockwave (`sim/impact.js`), fragments into you. The squad's own men
  step over it. It is drawn (the charge, the wire) until it goes off.

Squad model params: *Strategy on contact* (auto: the squad decides; retreat: forced, back at once;
no retreat: never),
*Rally point offset X/Z*, *A man down in a retreat* (auto, carry, leave), *tripwire*. In code:
`host.retreat = { order, auto, rally, casualties, tripwire, wires, dropPack }`, or
`orderRetreat(sq, rally, why)` at any time; `host.din(p)` (dB) for the noise a shout must carry over. The rig's *Casualty* acts show the carry (both men) and
the wire.

**Hosted**: `scripts/build-rig-artifact.mjs` builds the editor as one file (the rig and the camp
inside it), to host anywhere.

## Drone operations camp

A stage of the editor (`src/camp/stage.js`: `mountCamp(el, { onExit })` → `{ show, hide, dispose }`,
markup and CSS inside `el`, class `campst`); `camp.html` (scenario **Military camp: drone
operations desk**) mounts it on its own. A camp with a swarm of drones
flown by the group logic of the [drones](https://github.com/Eli2604/drones) repo, included as a
git submodule in `vendor/drones` (clone with `git clone --recurse-submodules`, or run
`git submodule update --init`). The operator walks to his desk in the command tent: a monitor per
drone (its camera and status: leader, battery, GNSS, link to the camp) and a tactical map of where
each drone last reported. Jammers (from the drones repo) cut GNSS or the radio link to the camp;
place more with *Place jammer*. `node scripts/build-rig-artifact.mjs out.html camp` builds it as
one file.

### The camp island (in the carrier's world)

Another island of the carrier's world (the place **Camp island: drone camp**, `src/campIsland.js`;
`?scenario=campIsland`), out on its own south-west of the lake house: a drone camp
(models/droneCamp.js: the camp page's tents, operations desk, launch pads with drones, radio mast
and jammers, as objects of the voxel world) inside a ring of bastions on a level pad in the west,
powered by a **solar park** (models/solarPark.js) and a **wind turbine** (models/windTurbine.js)
beside it, their cables laid on the ground to the camp's power panel. Across the middle of the
island runs a **ridge** (11 m), and behind it, in the east, a grassy **landing ground** with a pier
(a boat to the island).

- **Power** (sim/power.js, every heat step): the turbine takes the weather's wind at its hub (the
  wind at 2 m by the 1/7 power law), turns into it at 6°/s, idles below cut-in (3 m/s), makes
  ½ρAv³·Cp up to its rating (30 kW at 11 m/s), and above cut-out (25 m/s: a storm) is feathered
  and braked to a stop, starting again only below 20 m/s; its rotor spins up and down with
  inertia at a tip-speed ratio of ~6.5. The panels take the weather's sunlight (the season's sun
  through clouds, rain and fog) by how high the sun stands and the angle it meets them at
  (beam and sky light), less 0.4 %/K for hot cells and the inverter's 4 %. The sun's direction
  comes from a time-of-day sky if the simulation has one (`sim.sky.sunDir`, `world.sunDir`,
  `weather.sunDir` or an hour `weather.timeOfDay`), else a midday sun of the season from a
  little east of south. A small battery (1 kWh) in the park's container evens it out. Short of
  power the floodlights (on at night) go out first, then the operations: the monitors, the map,
  the drones' and jammers' lights go dark. A panel blown away or burnt gives nothing (and is
  not drawn); the turbine's nacelle or the park's inverter gone, nothing at all.
- **The patrol** (models/campPatrol.js): a squad of four soldiers (call sign Kilo: a commander,
  a gunner, two riflemen, in armour) walks a round of eight corners about the camp, outside the
  bastions, in file (ai/enemies.js), and is a fire team the moment it sees or hears you
  (ai/squad.js: cover, bounding overwatch, radio, parkour only once alerted). Soldiers, not
  guards: they do not light fires to lure you.
- **Deploy**: Play › *Deploy: the camp island, behind the ridge*, the *🪂 Deploy here* entry
  under the place in Edit world's places list, or `?deploy=camp` (or `?scenario=campIsland&walk=1`)
  puts you down walking on the landing ground, the island's walk-in start, out of sight of the
  camp and its patrol (the ridge is between: test/campIsland.test.js traces every line of sight).
  Like every place it is also a box in the overview (click it), and the jet can fly there.
- **Level of detail** (render/campPower.js): the rotor, the panels (one instanced mesh) and the
  camp's screens and lights by their size on the screen; frames, cables, drones and antennas go
  first; the soldiers are the characters' own (render/enemies.js).
