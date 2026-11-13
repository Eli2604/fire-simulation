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

- **Scenario**: metal bars on burners, a wind-driven grass fire, a car fire
  next to a house, a garden on a dry day, a forest fire in fog, gas cylinders in a bonfire,
  what a car's fuel tank does in a fire, a gas pipe bursting in an office hallway (with or without sprinklers),
  oak, willow and pine in a grass fire, catacombs of
  limestone and stacked bones lit by wall torches (with guards), an aircraft carrier with a flyable jet, a server room below deck,
  its lower decks below the waterline (a fuel line bursts against the hull, the sea pours in, the ship settles and lists),
  in an island group with an island nearby (hills, a canal, a gothic church under construction, a campfire, a house, and the catacombs under it), and a
  spaceship in orbit above them, a house fire in the rain.
- **Simulation**: pause and time scale. The HUD shows the speed actually reached; big
  scenes run slower than real time on slow machines.
- **Weather**: air temperature, humidity, wind speed and direction, rain and fog. All of
  these can be changed while the fire burns.
- **View**: realistic or thermal-camera mode, flames, smoke, steam, fire light, and a
  section cut to look inside objects (for example heat soaking into a wall).
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
  - *Inspect*: material, core and surface temperature, fuel left, moisture, state.
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
mm/h, 0–1), `&storm=1` (a gale with rain), `&erupt=1` (the island volcano erupts straight
away). For example `?scenario=carrier&zone=island&wind=8&erupt=1`.

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
  area width and depth, offset) and shown as red outlines with the markers. After
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

**Decompression** (sim/vacuum.js) replaces flooding: outside the hull there is vacuum, not
water or air. Breach the hull with a grenade or rocket, shoot out a window, or open both
airlock doors, and every space connected to the hole empties:

- How fast depends on the path to the hole and its size: about 1 s right next to a big hole,
  several seconds at the end of the corridor.
- The air streams to the hole, carrying smoke and loose light things with it, and cools as
  it expands.
- The oxygen goes too, so fires die.
- Closed doors hold: a room behind one keeps its pressure.

For you: the suction pulls you towards the hole, and below a third of cabin pressure you get
hurt. Your breathing apparatus gives you air but not pressure, so get behind a closed door.
The HUD shows the cabin pressure, and the sound is a roar of escaping air.

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
in a stone ring on dry grass, its logs charring into embers, then ash.

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

**Laundry on the line** (a scene; models/clothesline.js, render/laundry.js): the wash hangs
in the garden on a warm, breezy afternoon, wet from the machine: a sheet folded over the
line, towels, polyester shirts, jeans, a pillowcase, socks. Cotton holds a lot of water and
dries in the sun and the wind (a dead fuel's moisture, about half an hour; it will not burn
while it is wet); after a quarter of an hour a spark from the barbecue lands at the foot of
the sheet and catches only if it has dried. Then the fire runs along the line; the shirts
shrink, melt and drip before they burn; garments burnt through at the top fall; the lawn
scorches under them. The cloth is drawn as cloth (folds, weave, stripes, seams, pegs),
swaying in the breeze, and tied to its voxels: it chars, glows and burns through to holes.

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

**A cup of tea** (scenario "Tea by the lake in winter", and the lake island in the carrier
scene: a boat from the islet; models/teaCup.js, sim/tea.js, render/tea.js): a porcelain cup on
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
The scene round it: a small island (the island model with its pond made into a lake: `pondX`,
`pondZ`, `pondRadius`, `pondRadiusZ`, `pondDepth`), the lake frozen over (10 cm: it bears
you), a veranda on the shore (models/veranda.js), a couch with a plaid (models/couch.js), a side
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
| Tree | species: **oak** (heavy forking limbs, leaf clusters), **weeping willow** (arching limbs, hanging whips), **pine** (whorls, needle clusters, dead lower branches); height, trunk and crown radius, foliage density, foliage and wood moisture, main branches, seed |
| Grass patch | size, height, density, moisture (dry vs green), rectangle/ellipse, bare circle in the middle |
| Car | length, width, height, paint and seat colour, fuel litres, plastic or steel tank, fire starts in engine or interior |
| House | size, wall height and thickness, walls (brick/wood/concrete), roof (tiles/wood shingles/metal), roof pitch, windows, furnished, door open, chimney |
| Candle | height, radius, paraffin or beeswax, colour, wick length, holder. In a coarse scene (voxels larger than the candle) it is drawn, and burns as a small flame that gives light |
| Underground church (crypt chapel) | nave length and width, passage to the catacombs, rows of benches. A barrel-vaulted nave cut in the limestone, pillars, benches, a dais and an altar under a cross in a round apse, torches |
| Metal bar on burner | steel/aluminium/copper, length, thickness, elevation, burner power and position, supports |
| Wood pile / campfire | log cabin / teepee / stack, number, length and radius of logs, moisture, kindling, stone ring |
| Gas burner | power, flame radius and height, nozzle height |
| Wooden fence | length, height, boards or rails, moisture |
| Gas cylinder (propane) | capacity, fill level, relief valve working/blocked, colour |
| Ship section | length, beam, depth, draft (waterline), corridor width, furnished cabins, sprinklers, fuel line burst delay and power. Two decks, the lower one below the waterline, a long corridor plus cross corridors out to the hull sides, cabins, a stair, cabin and watertight doors |
| Catacombs | passages along x and z (default 4 × 4), spacing, width and height, flat or vaulted ceiling, share of masonry walls, share of ossuary walls, torch spacing, entrance open or closed, seed. Vaulted limestone passages with carved inscriptions, stretches of walls of stacked skulls and long bones (ossuary), domed chambers with bone walls and coffins, burial niches with bones and rags, wooden doors on both sides of each chamber (one locked), burning torches on iron brackets that light the passages |
| Carrier flight deck | length, width, deck height, waterline. Hull at sea, deck markings, the island with a glazed bridge and door, a hatch below deck |
| Jet fighter | paint, fuel (a pressure vessel of jet fuel), rockets. Aluminium airframe, glass canopy, rubber tyres. Flyable |
| Island | size, sea level, main hill height, plateau height, canal, pond, which zones the catacomb stairs and the boat lead to, seed |
| Volcano | base radius, height, crater radius, how close a moving dragon must come to wake it, how long it erupts, lava rate, seed. A basalt cone with a crater, a vent and old lava ridges |
| Spaceship | length, width, hull height, engine-room cable fire delay, windows. Pressure hull with vacuum outside, corridor, bridge, engine room, quarters, mess, cargo bay, lab, airlock and docking port |
| Carrier below deck | length, width, deck height, server rack fire delay, inert-gas system on/off |
| Enemies | number, spread, floor height, patrol (wander / area / guard round), patrol area width, depth and offset, seed |
| Dragon (lair) | length nose to tail, scales (bronze / tarpon / koi), health, resting or flying at the start, route (waypoints with rest / climb / sniff / fly), seed |
| Building hallway | size, walls, paint colour, suspended/plain ceiling, void depth, cable tray, doors, entrance, end window, windows in the outer wall, gas pipe in the ceiling void or along the wall, burst on a timer or only by fire/blast, burst position, delay and power, boxes, notice board, carpet |

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
| Car fire | slow growth over ~10 min, spreads to nearby buildings | ~0.1 → 0.6 MW in 11 min, then the house next to it |
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

### Limitations

This is a real-time, approximate model, not a CFD fire code like FDS. The air flow is not
pressure-projected, so the exchange through a doorway or a broken window is too weak: a room
fire becomes short of oxygen sooner than a real one, and a house fire with the door open
levels off at a few hundred kW where a real one would reach a few MW. Radiation is a blurred field without real shadowing, corrected by a
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

Objects can stand on something with `"y"` (metres above the ground, e.g. the jet on the
flight deck). A scene can be split into **zones** instead of having one `world` and
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
are built.

## Project layout

```
src/sim/        simulation (no dependencies): materials, world grid, solid + air physics, weather
src/models/     parameterised models and the voxeliser
src/render/     three.js rendering: voxels or smooth surfaces, flames/sparks, particle or
                volumetric smoke/steam, rain, extinguisher spray, debris, view
src/ai/         enemies: senses, path finding around fire, luring with fire
src/walk/       first-person walk-through (firefighter), flying the jet
src/audio/      procedural sound
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

The range has a **lookout**: model `deck` (`models/deck.js`), a concrete deck 3 m up on pillars
(width, depth and height are parameters), a straight staircase up one side (a step per voxel
layer, so the 3D paths of `ai/enemies.js` and the walk-through climb it) and glass rails round it,
open at the head of the stairs. It gives the world its lookouts (`world.lookouts`: the deck's
corners and the middles of its open sides, at deck height), and the simulation's squads get them
as `host.lookouts` (only in worlds that have any): before contact a rifleman climbs up to look
round, on contact a gunner takes it as overwatch when it sees the threat, and the climb goes by
the stairs (`host.path3d`, the guards' path finder over floors and stairs).

**Soldier rig test** (`rig.html`): the soldier on a range of its own, with every clip, the hit
areas (shown and adjustable), the gear, an FPS readout and the squad AI on a range you edit.
Its *Dragon* tab shows the simulation's dragon instead (the same AI and renderer, in a small
field of its own with a wall to climb): every act as a button (rest, walk, run, sniff, roar,
breathe fire, bite, rear and stamp, climb, take off, fly, glide, bank, land, hurt, die, shot
down), a speed control, its hit zones shown and adjustable (radius, length, damage; the
simulation uses the same table), and damage on click with an arrow, a bullet or a rocket: the
zone under the cursor flashes and bleeds. `?dragon=1&dact=fly&dzones=1` opens it.
`node scripts/build-rig-artifact.mjs [out.html]` builds it as one self-contained HTML file.

### Squads: senses, the commander's calls, cover

Fire teams also find their enemy themselves: they see hostiles as far as fog, smoke and darkness
allow (thermal goggles see further), hear noises and send two men to investigate (under radio
silence), mark what they see as the threat and follow it, and go back to the last known position
when they lose it. The commander orders thermals, lights on or off (not when that would give them
away), radio silence and backup; cover at the ends of walls and edges of crates is preferred and
the gunner takes higher ground a little behind. On the rig page: the Noise, Hostile and
Investigate tools, Fog, Night and Radio silence.

**Guards are fire teams.** The simulation's guards are the same agents: each guard team gets a
call sign and roles (its leader the commander). While nothing is going on the guard AI keeps
them on their patrol (in file, through doors, on their round); once the team sees you, hears
something or notices a lamp, the squad AI has them, and gives them back afterwards. Heat, fire
and the dragon still make them run, and one may still slip off to light a lure.

### Soldiers: expertise, ammunition, armour, the knife

Each soldier (`ai/soldier.js`) has an **expertise**: recruit, regular, veteran or elite (the
squad model's *Expertise*; mixed: a veteran commander, regulars, a recruit; guards likewise). It
sets how far his rounds scatter (more when moving, wounded in an arm, or far off) and how fast
he reloads and switches weapons. **Ammunition is limited** for everyone: magazines (the gunner a
belt), reloading with the animation; dry, he goes to the compact secondary, then the knife, and
says so on the radio. Your rifle has 30 rounds and 4 spare magazines. **Body armour** (plates,
helmet; the model's *Body armour*) stops most rounds to the torso (a heavy round more often gets
through, a knife never) and the helmet turns some. **Damage depends on the weapon and where it
hits** (`sim/wounds.js` `WEAPONS`): rifle, the gunner's heavier round, the secondary's pistol
calibre, the knife, fragments, arrows; rifle rounds hit the dragon's zones too. **Close
combat**: an enemy within ~2 m and the rifle goes away, the knife comes out (an animation each
way); he closes in and stabs. A man **badly hit** is called in by the nearest of his team
("Medic!"); under **heavy fire from one side** someone throws a grenade that way and shouts it.

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

The rig page's range has a **two-floor structure**: an open ground floor under a deck 3 m up, a
staircase with glass rails (they stop you, not your sight); the tools place noises, hostiles and
investigations up on the deck too, and the squad works its way up the stairs to them.
The deck is a **lookout** (`host.lookouts`): before contact a rifleman climbs it to look round,
and on contact the gunner takes it as his overwatch when it sees the threat (from 3 m up he sees
over the walls); he stays up there while the team is within reach, and comes down by the stairs.

**Hosted pages**: built with `PAGE_URLS` (`scripts/build-rig-artifact.mjs`), each page knows where
the others are hosted and its scene list opens them (`src/pages.js`).

## Drone operations camp

`camp.html` (scenario **Military camp: drone operations desk**): a camp with a swarm of drones
flown by the group logic of the [drones](https://github.com/Eli2604/drones) repo, included as a
git submodule in `vendor/drones` (clone with `git clone --recurse-submodules`, or run
`git submodule update --init`). The operator walks to his desk in the command tent: a monitor per
drone (its camera and status: leader, battery, GNSS, link to the camp) and a tactical map of where
each drone last reported. Jammers (from the drones repo) cut GNSS or the radio link to the camp;
place more with *Place jammer*. `node scripts/build-rig-artifact.mjs out.html camp` builds it as
one file.
