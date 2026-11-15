import GUI from 'lil-gui';
import { MOUSE, Raycaster, Vector2, Vector3 } from 'three';
import { AGENTS } from './sim/simulation.js';
import { Walkthrough } from './walk/walk.js';
import { defaultStartPower, walkMarker } from './sim/createSimulation.js';
import { toggleDoor, nearestDoor, doorOfVoxel } from './sim/doors.js';
import { View } from './render/view.js';
import { SCENARIOS, cloneScene, resolveScenario, openScenario, placeOrigin, LAKESIDE_WINTER } from './scenarios.js';
import { createSimulation } from './sim/createSimulation.js';
import { MODELS, defaultParams } from './models/index.js';
import { liftPlaces, flattenObjects } from './models/composite.js';
import { defaultWeather, SEASONS, EXPOSURES, VARY, INSIDE_AIR, exposureOf, liveWeather, WeatherDrift, WATER_SETTINGS } from './sim/weather.js';
import { initSnow } from './sim/snow.js';
import { skyFolder } from './skyGui.js';
import { dayOfDate } from './sim/sky.js';
import { PATCH } from './sim/patches.js';
import { lod } from './render/lod.js';
import { describeCloth, clothRows } from './sim/cloth.js';
import { describeThing } from './sim/inspectThings.js';
import { heatmapCss, legendTemps } from './render/colors.js';
import { ProxyRenderer } from './render/proxies.js';
import { PlacesOverlay, placeNear } from './render/places.js';
import { PlaceScenery } from './render/scenery.js';
import { Prebuild } from './sim/prebuild.js';
import { Editor } from './editor/editor.js';
import { FORMATIONS } from './ai/flight.js';
import { playSnatch, playFight, AIR_EVENT_TEXT } from './ai/dragonAir.js';
import { summarizeWorld, menuRelevance } from './ui/menuRelevance.js';

const $ = (id) => document.getElementById(id);
const view = new View($('view'));
view.proxies = new ProxyRenderer(view.scene);
view.places = new PlacesOverlay(view.scene); // a world of places: each a labelled box, zoomed out
view.places.camera = view.camera; // (its names kept apart on the screen)
view.scenery = new PlaceScenery(view.root); // the places you are not in, as they look, with level of detail
const prebuild = new Prebuild(); // their worlds built ahead, in a worker (never simulated)
prebuild.onReady = () => updateProxies(true);

const state = {
  scenario: 'carrier',
  running: true,
  timeScale: 4,
  tool: 'inspect',
  toolRadius: 0.3,
  torchPower: 5000,
  torchSeconds: 30,
  waterLitres: 10,
  grenadeKg: 0.18,
  agent: 'water',
  mode: 'realistic',
  flames: true,
  smoke: true,
  steam: true,
  fireLight: true,
  section: 1,
  smokeDensity: 1,
  surfaces: 'voxels',
  smokeStyle: 'particles',
  volumeSteps: 96,
  markers: true,
  ao: true,
  torchShadows: true,
  detail: !/[?&]patches=0/.test(location.search), // fine detail close up (candles: sim/patches.js)
  voxelScale: 1, // factor on every scene's voxel size
  patchScale: 1, // factor on the fine detail's voxel size
};

let scene = null; // editable scene description
let sim = null;
let weather = defaultWeather(); // the scene's (outdoor) weather settings; a zone may have its own
const drift = new WeatherDrift(7); // the weather changing by itself (when it is set to)
let inspected = -1;
let inspectedCloth = null; // a garment on a washing line clicked: { prop, piece } (sim/cloth.js)
let inspectedThing = null; // more than a voxel clicked (render/pick.js hit.thing: a door, a torch, the turbine, the carrier...): sim/inspectThings.js
let speed = 0;
const tank = { remaining: AGENTS.water.capacity }; // the extinguisher in your hand
let spraying = false;
let lastAim = null;
// a scene split into zones (carrier: flight deck / below deck): only the zone you
// are in is simulated; the others are built when you first go there, then frozen
let zoneSims = {};

/** Make zone `name` the scene's current world/objects/view (what the GUI edits). */
function useZone(name) {
  const zd = scene.zones[name];
  scene.zone = name;
  scene.world = zd.world;
  scene.objects = zd.objects;
  scene.view = zd.view ?? scene.view;
  for (const o of zd.objects) o.params = { ...defaultParams(o.type), ...(o.params ?? {}) };
}

/** The simulation of zone `name` (built the first time it is needed, then kept). */
function zoneSim(name) {
  if (!scene.zones) return sim;
  if (name === scene.zone) return sim;
  const zd = scene.zones[name];
  if (!zd) return null;
  if (!zoneSims[name]) {
    const desc = zoneDesc(name);
    // (the world built ahead for its scenery, if it was: sim/prebuild.js)
    zoneSims[name] = createSimulation(desc, prebuild.take(name, desc));
  }
  return zoneSims[name];
}

/** What zone `name` is built from (createSimulation's scene). */
function zoneDesc(name) {
  const zd = scene.zones[name];
  for (const o of zd.objects) o.params = { ...defaultParams(o.type), ...(o.params ?? {}) };
  return { name: zd.name, world: zd.world, objects: zd.objects, weather: settingsOf(zd), exposure: exposureOf(zd), indoor: zd.indoor, view: zd.view, walkStart: zd.walkStart, within: zd.within };
}

/** Where you are: the current zone, or the scene. */
function placeNow() {
  return scene.zones ? scene.zones[scene.zone] : scene;
}

/**
 * The weather settings of a zone (or of the scene): what Play and Edit world set. Outdoors the
 * scene's, unless the zone has its own (the lake island in winter); indoors, underground, in a
 * sealed cabin the place's own air (sim/weather.js).
 */
function settingsOf(zd) {
  if (!zd || zd === scene) return weather;
  if (!zd.weather && scene.zones?.[zd.weatherOf]) return settingsOf(scene.zones[zd.weatherOf]); // (a place sharing another's: the lake house's garden)
  const exp = exposureOf(zd);
  if (exp === 'outdoor' && !zd.weather) return weather;
  if (!zd.weather || !('vary' in zd.weather)) zd.weather = Object.assign(defaultWeather(), exp === 'outdoor' ? weather : INSIDE_AIR[exp], zd.weather ?? {});
  return zd.weather;
}
const settingsNow = () => settingsOf(scene.zones ? scene.zones[scene.zone] : null);

/** The simulation's weather from the settings of where you are (in place: the sim keeps it). */
function syncWeather(applyView = true) {
  if (!sim) return;
  liveWeather(sim.weather, settingsNow(), exposureOf(placeNow()), drift);
  if (applyView) view.applyWeather(sim.weather);
}

/**
 * Make zone `name` the one that is simulated and shown (the others freeze). keepView: the
 * camera stays where it is in the world (a place of a world the camera has come close to).
 */
function activateZone(name, keepView = false) {
  if (!scene.zones?.[name] || name === scene.zone) return sim;
  const from = scene.zones[scene.zone]?.origin;
  const next = zoneSim(name);
  zoneSims[scene.zone] = sim; // frozen while you are away
  useZone(name);
  const zd = scene.zones[name];
  sim = next;
  syncWeather(false);
  view.dark = !!zd.view?.dark;
  view.space = !!zd.view?.space;
  view.sunDir = zd.view?.sun;
  view.weatherNow = sim.weather; // (the sun where the sky's clock puts it: sim/sky.js)
  view.groundAround = zd.view?.around ?? null;
  view.archSpec = scene.archipelago ?? null;
  view.zoneOrigin = zd.origin ?? null;
  const cam = view.camera.position.clone();
  const target = view.controls.target.clone();
  view.setWorld(sim.world, zd.view?.camera, true, sim.markers);
  if (keepView && from && zd.origin) {
    // the same spot in the world, in the new zone's frame; looking the same way, at the place
    const d = new Vector3(...from.map((v, k) => v - zd.origin[k]));
    view.camera.position.copy(cam.add(d));
    const dir = target.add(d).sub(view.camera.position).normalize();
    const c = new Vector3(...zd.world.size.map((v) => v / 2)).sub(view.camera.position);
    view.controls.target.copy(view.camera.position).addScaledVector(dir, Math.max(1, c.dot(dir)));
    view.controls.update();
  }
  fitPlaces();
  if (zd.timeScale) {
    state.timeScale = zd.timeScale;
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }
  view.markers.visible = state.markers;
  view.applyWeather(sim.weather);
  view.voxels.mode = state.mode;
  $('title').textContent = `${scene.name} – ${zd.name}`;
  updateMenu();
  buildWeatherFolder();
  buildObjectsFolder();
  updateProxies(true);
  return sim;
}

/** Zones in the open (ship decks, islands) are placed in one sea: `origin` [x, y, z]. */
const zonesApi = {
  current: () => (scene.zones ? scene.zone : null),
  origin: (name) => (scene.zones ? scene.zones[name]?.origin ?? null : [0, 0, 0]),
  open: () =>
    scene.zones
      ? Object.entries(scene.zones).filter(([, z]) => z.origin).map(([name, z]) => ({ name, origin: z.origin, size: z.world.size, approach: z.approach ?? 0 }))
      : [{ name: null, origin: [0, 0, 0], size: sim.world.size }],
  built: (name) => !scene.zones || name === scene.zone || !!zoneSims[name],
  sim: (name) => zoneSim(name),
  activate: (name) => activateZone(name),
};

/** Distant stand-ins for the other open-air zones (what you see from the jet). */
let proxyNext = 0;
function updateProxies(now = false) {
  // (about once a second, however slow the frames)
  if (!now && performance.now() < proxyNext) return;
  proxyNext = performance.now() + 1000;
  const here = scene.zones?.[scene.zone]?.origin;
  if (!here) return view.proxies.update([]);
  const list = [];
  for (const [name, z] of Object.entries(scene.zones)) {
    if (!z.origin || name === scene.zone) continue;
    const s = zoneSims[name];
    const offset = z.origin.map((v, k) => v - here[k]);
    // (a place in the open not built yet, big enough on the screen: built ahead, the biggest first)
    const ahead = s ? null : prebuild.world(name);
    if (!s && lod.cam && !z.indoor && exposureOf(z) === 'outdoor') {
      const [sx, sy, sz] = z.world.size;
      const px = lod.size(offset[0] + sx / 2, offset[1] + sy / 2, offset[2] + sz / 2, 0.5 * Math.hypot(sx, sz));
      if (px > 36) prebuild.want(name, zoneDesc(name), px); // (as it comes up to its coarse level: render/scenery.js)
      else prebuild.drop(name);
    }
    list.push({
      name,
      offset,
      world: s?.world ?? ahead ?? undefined,
      sea: (s?.world ?? ahead)?.sea?.level ?? z.proxy?.sea ?? 0,
      hint: z.proxy,
      size: z.world.size,
    });
  }
  view.proxies.update(list);
}

/**
 * A world of places (scene.places): zoomed out each place is a labelled box, close up its
 * scenery (render/places.js); in Play the camera coming close to a place makes it the one that
 * runs. Called every frame.
 */
let nearTimer = 0;
function updatePlaces(dt) {
  // (where you are in the world: the place's origin, or its schematic box: below deck, the catacombs)
  const here = scene.places && placeOrigin(scene.zones?.[scene.zone]);
  const editing = editor.mode === 'edit';
  // walking, sailing or flying in Play the world is its scenery (the stand-ins), no boxes
  if (!here || (walk.active && !editing)) {
    if (view.places.items.size) {
      view.places.update([], [0, 0, 0]);
      for (const name of Object.keys(scene.zones ?? {})) view.proxies.setVisible(name, true);
    }
    return;
  }
  view.places.editing = editing;
  const list = Object.entries(scene.zones)
    .filter(([, z]) => placeOrigin(z))
    .map(([name, z]) => ({ name, label: z.label ?? z.name, offset: placeOrigin(z).map((v, k) => v - here[k]), size: z.world.size, active: name === scene.zone, color: z.proxy?.color, group: z.group, schematic: !z.origin, real: !!view.scenery.items.get(name)?.shows }));
  const cam = view.cameraLocal();
  const far = view.places.update(list, cam);
  for (const [name, f] of far) if (name !== scene.zone) view.proxies.setVisible(name, !f);
  // the camera come close to a neighbour (a place of the same group as the one you are in: the
  // lake house, its garden, its meadow) makes it the one that runs; in Play, not walking or
  // flying (those go by their own boats, hatches, ladders and approaches), never by itself into
  // or out of a ship, an island or orbit
  nearTimer -= dt;
  const group = scene.zones[scene.zone].group;
  if (!group || editor.mode !== 'play' || walk.active || nearTimer > 0) return;
  nearTimer = 0.4;
  const near = placeNear(
    list.filter((q) => q.active || (q.group === group && !q.schematic)).map((q) => ({ name: q.name, active: q.active, min: q.offset, max: q.offset.map((v, k) => v + q.size[k]) })),
    cam,
  );
  if (near) activateZone(near, true);
}

/** Go to a place of the world: it runs, the camera on it (a click on its box or in the outliner). */
function goToPlace(name) {
  if (!scene.zones?.[name]) return;
  editor.select(-1);
  if (name !== scene.zone) activateZone(name);
  const zd = scene.zones[name];
  const [sx, sy, sz] = zd.world.size;
  view.placeCamera(new Vector3(sx / 2, sy * 0.22, sz / 2), zd.view?.camera);
  view.controls.update();
  fitPlaces();
  editor.refresh();
}

/**
 * Put the player down at a place (a zone with `deploy`: the camp island's landing ground behind its
 * ridge): it runs, and you are walking from its walk-in start (its terrain's spawn, src/campIsland.js).
 * The places list ("Deploy here"), the Play panel and ?deploy=<place> do it.
 */
function deploy(name = Object.keys(scene.zones ?? {}).find((k) => scene.zones[k].deploy)) {
  const zd = scene.zones?.[name];
  if (!zd?.deploy) return;
  if (editor.mode !== 'play') editor.setMode('play'); // (walking is Play's)
  editor.select(-1);
  if (walk.active) walk.exit();
  if (name !== scene.zone) activateZone(name);
  startWalk();
  walk.say(zd.deploy.label ?? zd.name, 4);
}

/** The place whose box (or name) is under the pointer, if it is nearer than the scenery there. */
const placeRay = new Raycaster();
function placeAt(e) {
  if (!scene.places) return null;
  const rect = canvas.getBoundingClientRect();
  placeRay.setFromCamera(new Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), view.camera);
  const hit = view.places.pick(placeRay);
  if (!hit) return null;
  const v = view.pick(e.clientX, e.clientY);
  if (v && hit.distance > 0) {
    const p = view.root.localToWorld(new Vector3(...v.point));
    if (p.distanceTo(view.camera.position) < hit.distance) return null;
  }
  return hit.name;
}

/** Room to zoom out over the whole world of places. */
function fitPlaces() {
  if (!scene.places || !scene.zones) return;
  let r = 0;
  const here = placeOrigin(scene.zones[scene.zone]) ?? [0, 0, 0];
  for (const z of Object.values(scene.zones)) {
    const o = placeOrigin(z);
    if (o) for (const c of [0, 1]) r = Math.max(r, Math.hypot(...o.map((v, k) => v + c * z.world.size[k] - here[k])));
  }
  view.controls.maxDistance = Math.max(view.controls.maxDistance, r * 3);
  // (far enough to see them all from there; not more than needed: a far plane kilometres off
  // costs depth precision close by)
  view.farBase = Math.max(view.farBase ?? 0, Math.min(r * 12, r * 3 + r + 500));
  view.camera.far = Math.max(view.camera.far, view.farBase);
  view.camera.updateProjectionMatrix();
}

/** Through a hatch / up a ladder / by boat into another zone. */
function switchZone(pt) {
  if (!scene.zones?.[pt.to]) return;
  const from = scene.zone;
  activateZone(pt.to);
  const back = sim.world.portals.find((q) => q.to === from);
  const sp = back?.arrive ?? sim.spawn ?? { p: back?.p ?? [sim.world.size[0] / 2, 0, sim.world.size[2] / 2], yaw: 0 };
  walk.arrive(sp.p, sp.yaw ?? 0);
  walk.say(scene.zones[pt.to].name, 3);
}

// ---------------------------------------------------------------------------
function load(desc, fresh = true) {
  scene = desc;
  liftPlaces(scene); // (places in objects, below deck in the carrier, as zones: models/composite.js)
  scene.voxelScale = state.voxelScale;
  prebuild.reset();
  if (scene.zones) {
    // a restart rebuilds the zone you are in; the others are built again when you go there
    zoneSims = {};
    useZone(fresh ? scene.startZone ?? Object.keys(scene.zones)[0] : scene.zone);
  }
  const wanted = { ...(scene.weather ?? {}) }; // copy first: on restart this is `weather` itself
  drift.clock = 0; // (the sky's clock from its start again)
  weather = Object.assign(weather, defaultWeather(), wanted);
  scene.weather = weather;
  for (const o of scene.objects) o.params = { ...defaultParams(o.type), ...(o.params ?? {}) };
  sim = createSimulation(scene);
  syncWeather(false);
  if (walk?.active) walk.exit();
  view.dark = !!scene.view?.dark;
  view.space = !!scene.view?.space;
  view.sunDir = scene.view?.sun;
  view.weatherNow = sim.weather; // (the sun where the sky's clock puts it: sim/sky.js)
  view.groundAround = scene.view?.around ?? null;
  view.archSpec = scene.archipelago ?? null;
  view.zoneOrigin = scene.zones?.[scene.zone]?.origin ?? (scene.archipelago ? [0, 0, 0] : null);
  view.setWorld(sim.world, scene.view?.camera, !fresh, sim.markers);
  fitPlaces();
  updateProxies(true);
  view.markers.visible = state.markers;
  view.applyWeather(sim.weather);
  if (fresh) {
    // a new scenario brings its own view settings; a restart after an edit keeps the user's
    state.mode = scene.view?.mode ?? 'realistic';
    const ts = (scene.zones ? scene.zones[scene.zone].timeScale : null) ?? scene.timeScale;
    if (ts) state.timeScale = ts;
    state.toolRadius = Math.max(sim.world.h * 1.5, Math.min(1, Math.hypot(...sim.world.size) * 0.03));
    state.torchPower = Math.round(5000 * Math.min(4, Math.max(0.2, (sim.world.h / 0.05) ** 2)));
  }
  view.voxels.mode = state.mode;
  inspected = -1;
  inspectedCloth = null;
  inspectedThing = null;
  $('inspect').hidden = true;
  $('title').textContent = (scene.name ?? 'Custom scene') + (scene.zones ? ` – ${scene.zones[scene.zone].name}` : '');
  $('desc').textContent = scene.description ?? '';
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  updateMenu();
  buildWeatherFolder();
  buildObjectsFolder();
  updateLegend();
  deployCtl.show(Object.values(scene.zones ?? {}).some((z) => z.deploy));
}

function restart() {
  load(scene, false);
}

let restartTimer = 0;
function scheduleRestart() {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(restart, 350);
}

// ---------------------------------------------------------------------------
// GUI
const gui = new GUI({ title: 'Play' });
const scenarioNames = Object.fromEntries(Object.entries(SCENARIOS).map(([k, v]) => [v.name, k]));
// (the rig and the drone camp are modes of the editor: stages of their own)
const pageMode = (k) => ({ 'rig.html': 'rig', 'camp.html': 'camp' })[SCENARIOS[k]?.page];
gui.add(state, 'scenario', scenarioNames).name('Scenario').onChange((k) => (pageMode(k) ? editor.setMode(pageMode(k)) : editor.open(cloneScene(SCENARIOS[k]), k)));
gui.add({ restart }, 'restart').name('↺ Restart scene');
gui.add({ walkIn: () => startWalk() }, 'walkIn').name('🚒 Walk through as a firefighter');
gui.add({ pick: () => setTool('walkstart') }, 'pick').name('📍 Set the walk-in start (click the scene)');
// (a world with a place to be put down in: the camp island behind its ridge)
const deployCtl = gui.add({ deploy: () => deploy() }, 'deploy').name('🪂 Deploy: the camp island, behind the ridge');

// --- fire starts: shown as markers; the "Set fire start" tool replaces them (Shift+click adds)
const fFire = gui.addFolder('Fire start');
fFire.add(state, 'markers').name('Show markers').onChange((v) => (view.markers.visible = v));
fFire.add({ reset: () => { delete scene.fireStarts; delete scene.noFire; restart(); } }, 'reset').name("↺ Use the scenario's fire start");
fFire.add({ pick: () => setTool('firestart') }, 'pick').name('🔥 Choose where it starts (click the scene)');
fFire.add({ none: () => { scene.noFire = true; delete scene.fireStarts; restart(); setTool('ignite'); } }, 'none').name('No fire at start (light it yourself)');

const fSim = gui.addFolder('Simulation');
fSim.add(state, 'running').name('Running');
fSim.add(state, 'timeScale', 0.1, 200, 0.1).name('Time scale (×)');
fSim.add({ step: () => sim.advance(1, 2000) }, 'step').name('Advance 1 s');
// the dragons' acts in the air (ai/dragonAir.js): a snatch and a throw, a fight between two dragons
const fDragon = gui.addFolder('Dragon').close();
fDragon.add({ snatch: () => walk.say(playSnatch(sim), 3) }, 'snatch').name('🐉 Snatch target (grab, carry, throw)');
fDragon.add({ fight: () => walk.say(playFight(sim), 3) }, 'fight').name('🐉 Dragons fight');

// The weather of where you are (the scene, or the zone you are in): what Edit world sets too. Only
// what applies there: outdoors all of it (and whether it changes by itself), indoors, underground,
// in a sealed cabin only the air.
const fW = gui.addFolder('Weather');
let wc = [];
const wNow = { here: '', now: '' };
let wNowCtl = null;
let skyCtl = null; // the sky's clock (skyGui.js)
const wUpdate = () => wc.forEach((c) => c.updateDisplay());
// weather presets: a gale with driving rain and a high sea, or a calm
const setWeather = (o) => {
  Object.assign(settingsNow(), o);
  syncWeather();
  wUpdate();
};
// the seasons: the weather of a typical day, the leaves and the grass, snow lying in winter
// (below freezing what falls is snow: sim/snow.js)
// (a season is the scene's: it is built again in it, its ground and walls at that day's
// temperature, the snow lying; a warm scene put in frost would steam all over)
function setSeason(s) {
  const p = SEASONS[s];
  if (!p) return;
  Object.assign(settingsNow(), p, { season: s });
  if (!settingsNow().seasonFollowsDate) settingsNow().day = null; // (its typical day: sim/sky.js)
  restart();
  wUpdate();
}
/** Snow lying now (m): a fresh layer over the scene (outdoors), or none. */
function setSnow(v) {
  settingsNow().snowCover = v;
  syncWeather(false);
  const w = sim.world;
  if (v > 0) initSnow(w, v);
  else if (w.snow) {
    w.snow.depth.fill(0);
    w.snow.version++;
  }
  wUpdate();
}
// ice on the ponds and the canal (sim/ice.js): it forms below freezing (slowly, as it does: the
// speed-up to watch it), bears you from ~5 cm (only just: it creaks), 10 cm safely, a dragon 30 cm
/** Ice lying now (m): on all the fresh water open to the sky. */
function setIce(v) {
  settingsNow().iceCover = v;
  syncWeather(false);
  import('./sim/ice.js').then(({ initIce }) => {
    const w = sim.world;
    w.noIce = false;
    if (!w.ice) initIce(w, v);
    else {
      for (let c = 0; c < w.ice.thick.length; c++) if (w.ice.top[c] !== -1) w.ice.thick[c] = v;
      w.ice.version++;
      if (w.snow) w.snow.seenGeom = -1;
    }
  });
  wUpdate();
}
/** What the drifting weather is doing now (a line in the folder). */
function weatherNowText() {
  const W = sim?.weather;
  if (!W) return '';
  return `${W.windSpeed.toFixed(1)} m/s → ${Math.round(W.windDir)}°, ${W.ambient.toFixed(1)} °C${W.rain > 0.05 ? `, rain ${W.rain.toFixed(1)} mm/h` : ''}`;
}

/** The folder for where you are now (a scene loaded, a zone entered). */
function buildWeatherFolder() {
  for (const c of [...fW.controllers]) c.destroy();
  for (const c of [...fW.folders]) c.destroy();
  wc = [];
  wNowCtl = null;
  skyCtl = null;
  const W = settingsNow();
  const exp = exposureOf(placeNow());
  wNow.here = EXPOSURES[exp];
  fW.add(wNow, 'here').name('Here').disable();
  const live = (c) => (wc.push(c), c.onChange(() => syncWeather()));
  if (!menu.has('weather.outdoor')) {
    fW.title(`Weather (none here: ${exp === 'underground' ? 'underground' : exp === 'sealed' ? 'a sealed cabin' : 'indoors'})`);
    live(fW.add(W, 'ambient', -20, 45, 0.5).name('Air temperature (°C)'));
    live(fW.add(W, 'humidity', 0, 1, 0.01).name('Relative humidity'));
    return;
  }
  fW.title('Weather');
  W.vary ??= 'fixed';
  wc.push(
    fW
      .add(W, 'vary', Object.fromEntries(Object.entries(VARY).map(([k, v]) => [v, k])))
      .name('Changes by itself')
      .onChange((v) => {
        syncWeather();
        if (wNowCtl) wNowCtl.show(v !== 'fixed');
      }),
  );
  wNow.now = weatherNowText();
  wNowCtl = fW.add(wNow, 'now').name('Now').disable().show(W.vary !== 'fixed');
  live(fW.add(W, 'ambient', -20, 45, 0.5).name('Air temperature (°C)'));
  live(fW.add(W, 'humidity', 0, 1, 0.01).name('Relative humidity'));
  live(fW.add(W, 'windSpeed', 0, 35, 0.1).name('Wind speed (m/s)'));
  live(fW.add(W, 'windDir', 0, 360, 5).name('Wind towards (°)'));
  live(fW.add(W, 'rain', 0, 50, 0.5).name('Rain / snow (mm/h of water)'));
  live(fW.add(W, 'lightning', 0, 20, 0.5).name('Lightning (strikes a minute)'));
  live(fW.add(W, 'fog', 0, 1, 0.01).name('Fog'));
  live(fW.add(W, 'sunshine', 0, 1, 0.05).name('Sunshine (0 overcast, 1 clear)'));
  wc.push(
    fW.add(W, 'season', ['spring', 'summer', 'autumn', 'winter']).name('Season').onChange(setSeason),
    fW.add(W, 'snowCover', 0, 1.5, 0.05).name('Snow lying (m)').onFinishChange(setSnow),
  );
  // (ice and the water's look only where there is water open to the sky: ui/menuRelevance.js)
  if (menu.has('weather.ice')) {
    wc.push(fW.add(W, 'iceCover', 0, 0.6, 0.01).name('Ice on the water (m)').onFinishChange(setIce));
    live(fW.add(W, 'iceSpeed', 1, 2000, 1).name('Ice forms / melts faster (×)'));
  }
  live(fW.add(W, 'snowSpeed', 1, 600, 1).name('Snow builds / melts faster (×)'));
  // the water: clarity, turbidity, grease, turbulence (render/waterOptics.js)
  if (menu.has('weather.water')) for (const s of WATER_SETTINGS) live(fW.add((W[s.key] ??= defaultWeather()[s.key], W), s.key, s.min, s.max, s.step).name(s.label));
  // the date, the time of day, the sun and the moon; the clock fixed or running (sim/sky.js)
  skyCtl = skyFolder(fW, W, {
    now: () => sim?.weather,
    change: (key) => {
      if (['day', 'year', 'time', 'clock', 'timeSpeed'].includes(key)) drift.clock = 0; // (it runs from the new start)
      syncWeather();
    },
  });
  const fP = fW.addFolder('Presets').close();
  fP.add({ storm: () => setWeather({ windSpeed: 24, rain: 25, humidity: 0.97, fog: 0.15, lightning: 3 }) }, 'storm').name('Storm (gale, rain, high sea, lightning)');
  // lightning: strikes per minute (it hits what stands highest: trees, towers, masts; sets fire, splits, fells)
  if (menu.has('preset.lightning')) fP.add({ bolt: () => import('./sim/lightning.js').then(({ strike }) => strike(sim)) }, 'bolt').name('Lightning strike now');
  fP.add({ rain: () => setWeather({ ambient: 10, rain: 15, humidity: 0.9, windSpeed: 1, fog: 0, sunshine: 0.2 }) }, 'rain').name('Rain (10 °C, steady: soaks what is outside, steam off hot surfaces)');
  fP.add({ calm: () => setWeather({ windSpeed: 1.5, rain: 0, humidity: 0.5, fog: 0 }) }, 'calm').name('Calm');
  fP.add({ snowfall: () => setWeather({ ambient: -4, rain: 4, windSpeed: 5, humidity: 0.92, fog: 0.12, sunshine: 0.2, snowSpeed: 30 }) }, 'snowfall').name('Snowfall (−4 °C, snowing: it builds up 30× faster)');
  fP.add({ dew: () => setWeather({ humidity: 0.99, fog: 0.2, windSpeed: 0.5, rain: 0, sunshine: 0.3 }) }, 'dew').name('Misty morning (dew point: dew, or frost below 0 °C)');
  // the sun on the snow at a few degrees above freezing: it shrinks, the ground under it wet
  fP.add({ thaw: () => setWeather({ ambient: 5, rain: 0, windSpeed: 2, humidity: 0.7, fog: 0, sunshine: 1 }) }, 'thaw').name('Thaw (+5 °C, sunny: the snow melts)');
  if (menu.has('weather.ice')) fP.add({ frost: () => (setWeather({ ambient: -12, rain: 0, windSpeed: 3, humidity: 0.75, fog: 0, sunshine: 0.6 }), setIce(0.15)) }, 'frost').name('Hard frost (−12 °C: 15 cm of ice, it bears you)');
  // a cold snap (the lake house's winter, the old Tea by the lake in winter): the lake frozen over, snow lying
  if (menu.has('preset.coldSnap')) fP.add({ lakeWinter: () => (Object.assign(settingsNow(), LAKESIDE_WINTER), restart(), wUpdate()) }, 'lakeWinter').name('Cold snap (−4 °C, snow lying, the lake frozen over: it bears you)');
  if (menu.has('weather.ice')) fP.add({ freeze: () => (setWeather({ ambient: -15, rain: 0, windSpeed: 4, humidity: 0.7, fog: 0, sunshine: 0.3, iceSpeed: 600 }), setIce(0)) }, 'freeze').name('Watch it freeze (−15 °C, ice forming 600× faster)');
}

const fV = gui.addFolder('View');
fV.add(state, 'mode', { Realistic: 'realistic', 'Thermal camera': 'thermal' })
  .name('Mode')
  .onChange((v) => {
    view.voxels.mode = v;
    updateLegend();
  });
fV.add(state, 'surfaces', { Voxels: 'voxels', Smooth: 'smooth' })
  .name('Surfaces')
  .onChange((v) => (view.surfaceMode = v));
fV.add(state, 'smokeStyle', { 'Particles (fast)': 'particles', 'Volumetric (ray-marched)': 'volumetric' })
  .name('Smoke & flames')
  .onChange((v) => (view.smokeMode = v));
fV.add(state, 'volumeSteps', 16, 256, 8)
  .name('Volume quality (steps)')
  .onChange((v) => (view.volume.steps = v));
fV.add(state, 'flames').name('Flames').onChange((v) => (view.flames.enabled = v));
fV.add(state, 'smoke').name('Smoke').onChange((v) => (view.smoke.enabled = v));
fV.add(state, 'steam').name('Steam').onChange((v) => (view.smoke.showSteam = v));
fV.add(state, 'smokeDensity', 0.1, 3, 0.05).name('Smoke opacity').onChange((v) => (view.smoke.density = v));
fV.add(state, 'fireLight').name('Fire light').onChange((v) => (view.fireLightOn = v));
fV.add(state, 'ao').name('Ambient occlusion').onChange((v) => (view.aoOn = v));
// slow frames (no graphics card) step resolution, ambient occlusion and shadows down
// candles, torches and campfires close up in fine voxels of their own: wax and pitch that
// melt, pool and drip, logs that char and fall in
fV.add(state, 'detail').name('Fine detail close up');
// level of detail (render/lod.js): soldiers, candles and torches, trees, props, flames, the
// close-up patches, all by their size on the screen; over 1 more detail further off, under 1 less
fV.add(lod, 'bias', 0.25, 3, 0.05).name('Detail (LOD bias)');
// voxel sizes, to suit the hardware: the scene's (rebuilt), the fine detail's (patches rebuilt)
const fD = gui.addFolder('Voxel size (performance vs detail)');
fD.add(state, 'voxelScale', { 'Finer (0.75×: ~3× the work)': 0.75, 'As designed (1×)': 1, 'Coarser (1.5×: ~1/5)': 1.5, 'Coarse (2×: ~1/16)': 2 })
  .name('Scene voxels')
  .onChange(() => restart());
fD.add(state, 'patchScale', { 'Finer (0.7×)': 0.7, 'As designed (1×: candles and torches 1 cm, thin candles 5 mm, campfires 4 cm)': 1, 'Coarser (1.5×)': 1.5 })
  .name('Close-up detail voxels')
  .onChange((v) => {
    PATCH.scale = v;
    restart();
  });
fD.add(PATCH, 'maxActive', 0, 16, 1).name('Close-up objects at once');
fD.add(PATCH, 'maxFine', 0, 3, 1).name('Finest candles (half the voxels, within 1.2 m)');
fD.add(PATCH, 'torches').name('Torch heads close up (~3 candles each)');
fD.add(PATCH, 'fires').name('Campfires close up');
fD.close();
fV.add(view, 'adaptive').name('Adaptive quality').onChange((v) => !v && view.setQuality(0));
fV.add(state, 'torchShadows').name('Torch & lamp shadows').onChange((v) => {
  view.torchShadows = v;
  walk.lamp.castShadow = v;
});
fV.add(state, 'section', 0.05, 1, 0.01)
  .name('Section cut (Z)')
  .onChange((v) => {
    view.voxels.cut = v;
    view.voxels.version = -1;
    view.surface.cut = v;
    view.surface.invalidate();
  });

const fT = gui.addFolder('Tools (click the model)');
const TOOLS = { 'Inspect voxel': 'inspect', 'Set fire start (click, Shift = add)': 'firestart', 'Set walk-in start (click)': 'walkstart', 'Ignite (lighter)': 'ignite', 'Fire torch (hold)': 'torch', 'Throw hand grenade': 'grenade', 'Squad: set the threat (click)': 'squadThreat', 'Open / close door': 'door', 'Remove oxygen (inert the room)': 'inert', 'Water bucket': 'water', 'Fire extinguisher (hold)': 'extinguisher' };
// (the tools that need something in the scene: its menu key, ui/menuRelevance.js)
const TOOL_NEEDS = { squadThreat: 'tool.squadThreat', door: 'tool.door' };
const toolCtl = fT.add(state, 'tool', TOOLS)
  .name('Tool')
  .onChange(() => {
    toolChanged();
  });
function toolChanged() {
  {
    updateToolHint();
    // while extinguishing, the left button sprays and the right button rotates the view
    const hold = state.tool === 'extinguisher' || state.tool === 'torch';
    view.controls.mouseButtons.LEFT = hold ? null : MOUSE.ROTATE;
    view.controls.mouseButtons.RIGHT = hold ? MOUSE.ROTATE : MOUSE.PAN;
  }
}
/** Switch tool from a button (opens the tools folder so you see which one is active). */
function setTool(t) {
  state.tool = t;
  toolCtl.updateDisplay();
  fT.open();
  toolChanged();
}
fT.add(state, 'toolRadius', 0.01, 3, 0.01).name('Radius (m)');
fT.add(state, 'torchPower', 100, 50000, 100).name('Torch power (W)');
fT.add(state, 'grenadeKg', 0.05, 2, 0.05).name('Grenade explosive (kg TNT)');
// fire teams (ai/squad.js): their AI on or off, and what it shows
const squadState = { ai: true, paths: true, radio: true };
const fSquad = gui.addFolder('Squads (fire teams)').close();
fSquad.add(squadState, 'ai').name('Squad AI').onChange((v) => { for (const s of sim?.squads ?? []) s.on = v; });
fSquad.add(squadState, 'paths').name('Show routes, trails, tags').onChange((v) => { if (view.enemies.viz) view.enemies.viz.show = v; });
fSquad.add(squadState, 'radio').name('Radio voices').onChange((v) => import('./audio/radio.js').then((r) => r.setRadioSound(v)));
fSquad.add({ rig: () => editor.setMode('rig') }, 'rig').name('🦴 Rig the soldier (animations, gear, hit zones)');
// flights of jets (ai/flight.js): the leader's AI, what they show, and the leader's orders for the flight picked
const flightState = { ai: true, paths: false, radio: true, which: 1, formation: 'fingerFour' };
const fFlight = gui.addFolder('Jet flights (formations)').close();
const flights = () => (sim?.world?.flights ?? []).map((f) => f.ai).filter(Boolean);
const theFlight = () => flights()[Math.min(flights().length, flightState.which) - 1] ?? null;
const flightOrder = (kind, opts) => () => theFlight()?.order(kind, opts);
fFlight.add(flightState, 'ai').name('Leader AI (orders by himself)').onChange((v) => { for (const a of flights()) a.on = v; });
fFlight.add(flightState, 'paths').name('Show paths and target').onChange((v) => (view.flights.showPaths = v));
fFlight.add(flightState, 'radio').name('Radio voices').onChange((v) => (view.flights.radio = v));
fFlight.add(flightState, 'which', 1, 4, 1).name('Flight #');
fFlight.add(flightState, 'formation', Object.fromEntries(Object.entries(FORMATIONS).map(([k, l]) => [l, k]))).name('Formation').onChange((v) => theFlight()?.order('formation', { formation: v }));
for (const [k, label] of [['formUp', 'Form up'], ['flank', 'Split & flank the target'], ['engage', 'Engage the target'], ['break', 'Break (defensive)'], ['rejoin', 'Rejoin'], ['orbit', 'Orbit / hold here'], ['rtb', 'RTB (to the carrier)']])
  fFlight.add({ [k]: flightOrder(k) }, k).name('📻 ' + label);
fFlight.add({ hitLead: () => { const a = theFlight(); if (a) a.hit(a.lead, 'engines', 60); } }, 'hitLead').name('💥 Hit the leader (engine fire)');
fFlight.add({ hitWing: () => { const a = theFlight(); const m = a?.ranked()[1]; if (m) a.hit(m.i, 'wingL', 400); } }, 'hitWing').name('💥 Shoot a wing off his wingman');
fFlight.add({ rig: () => editor.setMode('rig', { kind: 'jetFlight' }) }, 'rig').name('🦴 Rig the jet flight (formations, orders, hit parts)');
fT.add(state, 'waterLitres', 0.1, 200, 0.1).name('Bucket water (litres)');
fT.add(state, 'agent', Object.fromEntries(Object.entries(AGENTS).map(([k, a]) => [a.label, k])))
  .name('Extinguisher')
  .onChange(() => (tank.remaining = AGENTS[state.agent].capacity));
fT.add({ refill: () => (tank.remaining = AGENTS[state.agent].capacity) }, 'refill').name('↻ Refill extinguisher');

/**
 * Only the parts of the menu that apply to where you are (ui/menuRelevance.js): the Dragon folder
 * with dragons, the jet flights with flights, the squads with soldiers or guards, the door and
 * squad tools with doors and squads; the weather folder reads `menu` as it is built. Called when a
 * scene is loaded or restarted (an edit in Edit world restarts it) and when another place runs.
 */
let menu = new Set();
function updateMenu() {
  if (!sim) return;
  menu = menuRelevance(summarizeWorld(sim.world, placeNow()));
  fDragon.show(menu.has('dragon'));
  fFlight.show(menu.has('flights'));
  fSquad.show(menu.has('squads'));
  const tools = Object.fromEntries(Object.entries(TOOLS).filter(([, t]) => !TOOL_NEEDS[t] || menu.has(TOOL_NEEDS[t])));
  toolCtl.options(tools);
  if (!Object.values(tools).includes(state.tool)) {
    state.tool = 'inspect';
    toolCtl.updateDisplay();
    toolChanged();
  }
}

// the scene's objects, the world and its weather are edited in Edit world (editor/editor.js)
const addState = { type: 'tree' };
gui.add({ edit: () => editor.setMode('edit') }, 'edit').name('✎ Edit the world (objects, size, ground)');
function buildObjectsFolder() {
  editor?.refresh();
}

const io = {
  exportJson: () => {
    const blob = new Blob([JSON.stringify({ ...scene, weather }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(scene.name ?? 'scene').replace(/\W+/g, '-').toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
  importJson: () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      try {
        const desc = JSON.parse(await input.files[0].text());
        if (!desc.world || !Array.isArray(desc.objects ?? Object.values(desc.zones ?? {})[0]?.objects)) throw new Error('Not a scene file');
        editor.open(desc);
      } catch (e) {
        alert(`Could not load scene: ${e.message}`);
      }
    };
    input.click();
  },
};
fT.close();

// ---------------------------------------------------------------------------
// HUD
function updateLegend() {
  const lg = $('legend');
  lg.hidden = state.mode !== 'thermal';
  lg.querySelector('.bar').style.background = heatmapCss();
  lg.querySelector('.ticks').innerHTML = legendTemps()
    .map((t) => `<span style="left:${t.pos * 100}%">${t.T}°</span>`)
    .join('');
}

function fmtTime(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
function fmtPower(w) {
  if (w >= 1e6) return `${(w / 1e6).toFixed(2)} MW`;
  if (w >= 1e3) return `${(w / 1e3).toFixed(1)} kW`;
  return `${w.toFixed(0)} W`;
}
function fmtMass(kg) {
  if (kg >= 1) return `${kg.toFixed(2)} kg`;
  return `${(kg * 1000).toFixed(1)} g`;
}

let fps = 60;
let hudTimer = 0;
function updateHud(dt) {
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
  hudTimer -= dt;
  if (hudTimer > 0) return;
  hudTimer = 0.25;
  const s = sim.stats;
  const w = sim.world;
  const rows = [
    ['Time', `${fmtTime(w.time)}  (${speed.toFixed(1)}× real time)`],
    ['Heat release', fmtPower(s.hrr)],
    ['Burning voxels', s.burning],
    ['Max temperature', `${s.maxT.toFixed(0)} °C`],
    ['Smoke in air', fmtMass(s.smoke)],
    ['Steam in air', fmtMass(s.steam)],
    ['Molten / water voxels', s.liquid],
    ...(w.sea ? [['Sea water coming in', s.flooding ? `${((s.flooding * w.h ** 3) / sim.dt).toFixed(2)} m³/s` : 'no']] : []),
    ...vesselRows(w),
    ...(state.tool === 'extinguisher' ? [['Extinguisher', `${AGENTS[state.agent].label}: ${tank.remaining.toFixed(1)} left${spraying ? ' (spraying)' : ''}`]] : []),
    ...eventRows(w),
    ['Voxels', `${w.solidCount.toLocaleString()} @ ${(w.h * 100).toFixed(1)} cm`],
    ['FPS', fps.toFixed(0)],
  ];
  $('stats').innerHTML = rows.map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('');
  if (inspected >= 0 || inspectedCloth || inspectedThing) showInspect();
}

const VESSEL_STATE = { sealed: 'sealed', venting: 'venting', leaking: 'leaking (shell failed)', ruptured: 'BURST', empty: 'empty' };
function vesselRows(w) {
  return w.vessels.map((v) => {
    const label = v.name === 'cylinder' ? 'Gas cylinder' : 'Fuel tank';
    const st = v.venting ? 'relief valve venting' : VESSEL_STATE[v.state] ?? v.state;
    const p = v.state === 'sealed' && v.pressure != null ? ` ${(v.pressure / 1e5).toFixed(1)} bar (holds ${(v.strength / 1e5).toFixed(0)})` : '';
    return [label, st + p];
  });
}
const EVENT_TEXT = { radio: '(radio)', flightRadio: '(radio)', jetCrash: 'crashed and exploded', enemyDown: 'is down', explosion: 'BURST', leak: 'is leaking', split: 'split open, fuel pouring out', pipeBurst: 'BURST – gas jet burning', waterBurst: 'BURST – water pouring out', spall: 'spalled', sprinkler: 'went off', doorOpen: 'opened', doorClose: 'closed', inerted: 'flooded with inert gas', inertSystem: '', rackFire: 'electrical fault – fire', enemyFire: 'set a fire to lure you', glass: 'broke', lightSeen: 'saw a light and comes to look', foundering: 'is going down: the sea is over the deck edge', eruption: 'ERUPTS – lava is coming down', eruptionEnd: 'has calmed down', laze: 'runs into the sea – clouds of steam', shout: 'shouted: they have seen you', roar: 'roars', seized: 'seized you in its jaws', devoured: 'swallowed you', gulp: 'swallowed its prey', dragonSnap: 'snapped its jaws shut', dragonFire: 'set you alight', dragonHit: 'is mortally wounded', dragonDown: 'is down', dragonWingHurt: 'is hit in the wing: it comes down', dragonFalls: 'cannot use its wing: it falls from the sky', dragonCrash: 'crashes to the ground', phoenixCalls: 'calls from its cell', phoenixCry: 'calls', phoenixHurt: 'is hit', phoenixFreed: 'is out of its cell', phoenixWaits: 'waits at a closed door', phoenixBurns: 'bursts into flame', phoenixReborn: 'rises from its ashes', phoenixEscape: 'flies up the stairs', phoenixFree: 'is free: out of the catacombs', keysDropped: 'dropped his keys' };
Object.assign(EVENT_TEXT, AIR_EVENT_TEXT); // (a snatch, a dragon fight)
function eventRows(w) {
  return w.events
    .filter((e) => w.time - e.time < 30)
    .slice(-2)
    .map((e) => ['Event', `${fmtTime(e.time)} ${{ cylinder: 'gas cylinder', fuelTank: 'fuel tank', 'gas pipe': 'gas pipe', grenade: 'grenade', concrete: 'concrete', sprinkler: 'a sprinkler' }[e.name] ?? e.name} ${EVENT_TEXT[e.type] ?? e.type}${e.pressure ? ` at ${(e.pressure / 1e5).toFixed(1)} bar` : ''}`]);
}

function showInspect() {
  const d = inspected >= 0 ? sim.describe(inspected) : null;
  const el = $('inspect');
  // more than a voxel (a door, a torch, the turbine, the ship, the volcano...): the whole of it, then the voxel clicked
  const th = inspectedThing && describeThing(sim, inspectedThing);
  if (th) {
    el.hidden = false;
    el.innerHTML = [`<b>${th.title}</b> <span style="color:var(--muted)">(${th.sub})</span>`, ...th.rows, d ? `<span style="color:var(--muted)">This voxel: ${d.material}, ${d.temperature.toFixed(0)} °C, ${d.state}${d.fuel !== null ? `, fuel ${(d.fuel * 100).toFixed(0)} %` : ''}</span>` : ''].filter(Boolean).join('<br>');
    return;
  }
  // a garment on the line: the whole of it (its voxels summed), then the voxel clicked
  const cloth = inspectedCloth && describeCloth(sim.world, inspectedCloth.prop, inspectedCloth.piece);
  if (cloth) {
    const [head, ...rows] = clothRows(cloth);
    el.hidden = false;
    el.innerHTML = [`<b>${head}</b> <span style="color:var(--muted)">(Washing line)</span>`, ...rows, d ? `<span style="color:var(--muted)">This voxel: ${d.temperature.toFixed(0)} °C, ${d.state}${d.fuel !== null ? `, fuel ${(d.fuel * 100).toFixed(0)} %` : ''}</span>` : ''].filter(Boolean).join('<br>');
    return;
  }
  if (!d) {
    el.innerHTML = '<b>Gone</b> – this voxel burnt away or moved.';
    return;
  }
  const ob = d.owner >= 0 ? flattenObjects(scene.objects)[d.owner]?.node : null; // (objects in objects numbered depth first)
  const o = ob ? MODELS[ob.type]?.label ?? ob.type : 'Ground';
  el.hidden = false;
  el.innerHTML = [
    `<b>${d.material}</b> <span style="color:var(--muted)">(${o})</span>`,
    `Core temperature: ${d.temperature.toFixed(0)} °C`,
    `Surface temperature: ${d.surface.toFixed(0)} °C`,
    `State: ${d.state}`,
    d.fuel !== null ? `Fuel left: ${(d.fuel * 100).toFixed(0)} %` : '',
    `Moisture: ${(d.moisture * 100).toFixed(0)} % of dry mass`,
    d.heatRelease > 0 ? `Heat release: ${fmtPower(d.heatRelease)}` : '',
  ]
    .filter(Boolean)
    .join('<br>');
}

const HINTS = {
  inspect: 'Click a voxel to inspect it',
  ignite: 'Click to set fire to combustible material',
  torch: 'Hold the left mouse button to play a fire torch on a spot (right-drag rotates)',
  firestart: 'Click where the fire should start (Shift+click adds another); the scene restarts',
  walkstart: 'Click where the walk-through should start; you will face the way the camera looks',
  place: 'Click where the new object should go (choose its type under Scene objects › Add object); the scene restarts',
  grenade: 'Click to throw a hand grenade at a spot (it goes off after 2.5 s)',
  squadThreat: 'Click where the threat is: the fire teams report it on the radio and advance on it',
  door: 'Click a door (or next to it) to open or close it',
  inert: 'Click inside a room to flood it with inert gas (removes the oxygen; leaks if the room is open)',
  water: 'Click to throw a bucket of water',
  extinguisher: 'Hold the left mouse button to spray where you point (right-drag rotates the view)',
};
function updateToolHint() {
  $('toolhint').textContent = HINTS[state.tool];
}

// ---------------------------------------------------------------------------
// Pointer tools (a click without dragging, so orbiting still works)
let down = null;
const canvas = $('view');
canvas.addEventListener('pointerdown', (e) => {
  if (walk.active) return; // the walk-through handles its own input
  if (e.button === 0) down = [e.clientX, e.clientY];
  if (e.button === 0 && state.tool === 'extinguisher') {
    spraying = true;
    aim(e);
  }
  if (e.button === 0 && state.tool === 'torch') {
    torching = true;
    aimTorch(e);
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (spraying) aim(e);
  if (torching) aimTorch(e);
});
let torching = false;
let torchPoint = null;
function aimTorch(e) {
  const hit = view.pick(e.clientX, e.clientY);
  if (!hit) return;
  const r = Math.max(sim.world.h, state.toolRadius * 0.5);
  torchPoint = hit.point.map((v, k) => v + hit.normal[k] * r);
  torchPoint[1] += r;
}
const stopSpray = () => {
  spraying = false;
  if (sim) sim.spray = null;
};
canvas.addEventListener('pointerleave', stopSpray);

/** Point the extinguisher: the nozzle stands back from the target, up to the agent's range. */
function aim(e) {
  const hit = view.pick(e.clientX, e.clientY);
  if (hit) lastAim = hit.point;
  if (!lastAim) return;
  const ag = AGENTS[state.agent];
  const cam = view.camera.position;
  const t = lastAim;
  const d = [cam.x - t[0], cam.y - t[1], cam.z - t[2]];
  const len = Math.hypot(...d) || 1;
  const diag = Math.hypot(...sim.world.size);
  const reach = Math.min(ag.range, len * 0.85, diag * 0.45);
  const nozzle = d.map((v, k) => t[k] + (v / len) * reach);
  nozzle[1] = Math.max(sim.world.h * 2, Math.min(nozzle[1], t[1] + reach * 0.6));
  sim.spray = { agent: state.agent, nozzle, target: t, radius: Math.min(ag.radius, diag * 0.06), tank };
}
canvas.addEventListener('pointerup', (e) => {
  if (walk.active) return;
  if (e.button === 0 && torching) {
    torching = false;
    torchPoint = null;
    down = null;
    return;
  }
  if (e.button === 0 && spraying) {
    stopSpray();
    down = null;
    return;
  }
  if (!down || e.button !== 0) return;
  const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]);
  down = null;
  if (moved > 5) return;
  // a place of the world (its box or its name): go there (Edit world: editor.js asks pickPlace)
  if (editor.mode === 'play') {
    const pl = placeAt(e);
    if (pl) return goToPlace(pl);
  }
  const hit = view.pick(e.clientX, e.clientY);
  if (!hit) return;
  // (a thing drawn only, with no voxel: the inspector and the door tool know it; the rest want a voxel)
  if (state.tool === 'inspect' && hit.thing) {
    inspected = hit.voxel;
    inspectedCloth = null;
    inspectedThing = hit.thing;
    showInspect();
    return;
  }
  if (state.tool === 'door' && hit.thing?.kind === 'door') {
    toggleDoor(sim, hit.thing.k);
    return;
  }
  if (hit.voxel < 0) return;
  const w = sim.world;
  const [x, y, z] = w.coords(hit.voxel);
  const c = w.center(x, y, z);
  switch (state.tool) {
    case 'inspect':
      inspected = hit.voxel;
      inspectedCloth = hit.cloth ?? null; // (the wash on a line: its garment, as a whole)
      inspectedThing = null;
      showInspect();
      break;
    case 'ignite':
      sim.ignite(c, state.toolRadius);
      break;
    case 'walkstart': {
      // you face the way the camera looks
      const d = [hit.point[0] - view.camera.position.x, hit.point[2] - view.camera.position.z];
      const start = { p: hit.point.slice(), yaw: Math.atan2(d[1], d[0]) };
      if (scene.zones) scene.zones[scene.zone].walkStart = start;
      else scene.walkStart = start;
      sim.spawn = start;
      sim.markers = [...sim.markers.filter((m) => m.kind !== 'walk'), walkMarker(sim)];
      view.markers.setMarkers(sim.markers, w);
      break;
    }
    case 'place': {
      const o = { type: addState.type, params: defaultParams(addState.type), x: hit.point[0], z: hit.point[2], rotation: 0, ignite: false };
      // on a deck, a roof or a hill: stand on what you clicked
      if (hit.point[1] > w.h * 1.5) o.y = hit.point[1];
      scene.objects.push(o);
      restart();
      setTool('inspect');
      break;
    }
    case 'firestart': {
      const start = { p: c, radius: Math.max(w.h * 2, state.toolRadius), power: defaultStartPower(w) };
      const keep = (scene.fireStarts ?? []).filter((f) => f.power > 0);
      scene.fireStarts = e.shiftKey ? [...keep, start] : [start];
      delete scene.noFire;
      for (const e of flattenObjects(scene.objects)) e.node.ignite = false;
      restart();
      break;
    }
    case 'door': {
      let d = doorOfVoxel(w, hit.voxel);
      if (d < 0) d = nearestDoor(w, hit.point, 1.5);
      if (d >= 0) toggleDoor(sim, d);
      break;
    }
    case 'inert': {
      const p = hit.point.map((v, k) => v + hit.normal[k] * Math.max(0.3, w.h * 2));
      sim.inertRoom(p);
      break;
    }
    case 'squadThreat':
      for (const s of sim.squads ?? []) s.setThreat(hit.point);
      break;
    case 'grenade': {
      // lob it from the camera so that it lands on the clicked spot
      const from = [view.camera.position.x, view.camera.position.y, view.camera.position.z];
      const d = hit.point.map((v, k) => v - from[k]);
      const T = Math.min(1.8, Math.max(0.4, Math.hypot(...d) / 10));
      sim.throwGrenade(from, [d[0] / T, d[1] / T + 0.5 * 9.81 * T, d[2] / T], state.grenadeKg * 4.6e6);
      break;
    }
    case 'water':
      sim.douse(c, state.toolRadius, state.waterLitres);
      break;
  }
});

// ---------------------------------------------------------------------------
let last = performance.now();
let weatherClock = 0;
let skyClock = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (view.paused) {
    // the rig or the camp is shown: the world waits
    requestAnimationFrame(frame);
    return;
  }
  if (walk.active) walk.update(dt);
  view.markers.visible = state.markers && !walk.active; // no labels and patrol outlines in the walk-through
  if (torching && torchPoint) sim.holdTorch(torchPoint, state.torchPower, Math.max(sim.world.h, state.toolRadius * 0.5));
  if (state.running && sim) {
    // the walk-through runs in real time
    const simDt = dt * (walk.active ? 1 : state.timeScale);
    // the weather changing by itself (outdoors, when set to): gusts, the wind veering, showers
    const W = settingsNow();
    const outdoor = exposureOf(placeNow()) === 'outdoor';
    // the sky's clock (sim/sky.js): the sun and the moon move, the light and the sky follow
    if (W.clock === 'running' && outdoor) {
      drift.stepClock(simDt, W);
      syncWeather(false);
      view.applySky(sim.weather);
      skyClock += dt;
      if (skyClock > 0.5) {
        skyClock = 0;
        skyCtl?.update();
      }
    }
    if (W.vary && W.vary !== 'fixed' && outdoor) {
      drift.step(simDt, W.vary);
      syncWeather(false);
      weatherClock += dt;
      if (weatherClock > 1) {
        // (the sky, the fog, the sea and the grass follow once a second)
        weatherClock = 0;
        view.applyWeather(sim.weather);
        wNow.now = weatherNowText();
        wNowCtl?.updateDisplay();
      }
    }
    const done = sim.advance(simDt, 22);
    speed += (done / Math.max(dt, 1e-3) - speed) * 0.1;
    // the candles near the camera in fine detail (sim/patches.js), within a few ms a frame
    if (sim.patches) sim.patches.enabled = state.detail;
    if (sim.patches) sim.patches.reach = lod.bias;
    sim.patches?.update(view.cameraLocal(), 8);
  } else speed *= 0.9;
  if (scene.zones) updateProxies();
  prebuild.pump();
  updatePlaces(dt);
  view.render(dt, sim);
  updateHud(dt);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// The editor: Play / Edit world / Rig (editor/editor.js)
const editor = new Editor({
  view,
  get scene() {
    return scene;
  },
  get sim() {
    return sim;
  },
  weather: () => weather,
  weatherHere: () => settingsNow(), // the settings of where you are (the zone's own, or the scene's)
  place: () => placeNow(),
  load,
  restart,
  state,
  setTool,
  playGui: gui,
  get walk() {
    return walk;
  },
  io,
  activateZone,
  goToPlace,
  deploy,
  pickPlace: (e) => {
    const pl = placeAt(e);
    if (pl) goToPlace(pl);
    return !!pl;
  },
});

// ---------------------------------------------------------------------------
// Firefighter walk-through
const walk = new Walkthrough(view, {
  getSim: () => sim,
  onPortal: (pt) => switchZone(pt),
  zones: zonesApi,
  // a thermal imaging camera sees heat, and sees through smoke
  onThermal: (on) => {
    view.voxels.mode = on ? 'thermal' : state.mode;
    view.smoke.enabled = on ? false : state.smoke;
  },
});
document.getElementById('walkLeave').addEventListener('click', () => walk.exit());
document.getElementById('walkDownLeave').addEventListener('click', () => walk.exit());
document.getElementById('walkRespawn').addEventListener('click', () => {
  walk.respawn();
  walk.resume();
});
function startWalk() {
  inspected = -1;
  inspectedCloth = null;
  inspectedThing = null;
  $('inspect').hidden = true;
  walk.enter();
}

// deep links: ?scenario=catacombs&zone=catacombs&walk=1&at=x,y,z,yaw,pitch opens a scene
// (and a zone of it) straight in the walk-through, standing at a given spot
const qs = new URLSearchParams(location.search);
// ...&voxel=1.5: every scene's voxels 1.5x their size; ...&detailvoxel=0.7: the close-up detail's
if (Number(qs.get('voxel')) > 0) state.voxelScale = Number(qs.get('voxel'));
// ...&lod=2: the level-of-detail bias (render/lod.js; 0.25..3)
if (Number(qs.get('lod')) > 0) lod.bias = Number(qs.get('lod'));
if (Number(qs.get('detailvoxel')) > 0) state.patchScale = PATCH.scale = Number(qs.get('detailvoxel'));
// no graphics card (rendering in software): fewer close-up objects at once
if (view.softwareGpu) PATCH.maxActive = 4;
// (old keys that are now a place of a world: ?scenario=laundry opens the carrier's world at the
// lake house's garden, ?scenario=catacombs under the church, ?scenario=winterTea the lake frozen)
const asked = resolveScenario(qs.get('scenario'));
if (asked && !SCENARIOS[asked.scenario].page) state.scenario = asked.scenario;
{
  const sc = asked?.scenario === state.scenario ? openScenario(qs.get('scenario')) : cloneScene(SCENARIOS[state.scenario]);
  const zone = qs.get('zone');
  if (sc.zones && sc.zones[zone]) sc.startZone = zone;
  // (the weather of the place it starts in: its own, the one it shares, or the scene's)
  const startWeather = (o = {}) => {
    const zd = sc.zones?.[sc.startZone];
    const src = zd?.weather ? zd : sc.zones?.[zd?.weatherOf]?.weather ? sc.zones[zd.weatherOf] : sc;
    return (src.weather = { ...(src.weather ?? {}), ...o });
  };
  // ...&season=winter: a winter's day (snow lying, snow falling)
  if (SEASONS[qs.get('season')]) startWeather({ ...SEASONS[qs.get('season')], season: qs.get('season') });
  // ...&thaw=1: the snow lying, a sunny day above freezing (it melts, the roofs drip)
  if (qs.get('thaw')) startWeather({ ambient: 5, rain: 0, sunshine: 1, humidity: 0.7, fog: 0 });
  // ...&dew=1: a still, misty morning, the air at its dew point (dew on the grass; frost if it is freezing)
  if (qs.get('frost')) startWeather({ ambient: -12, rain: 0, windSpeed: 3, sunshine: 0.6, iceCover: 0.15, season: 'winter', snowCover: 0.05 });
  if (qs.get('freeze')) startWeather({ ambient: -15, rain: 0, windSpeed: 4, sunshine: 0.3, iceCover: 0, iceSpeed: 600, season: 'winter' });
  if (Number.isFinite(Number(qs.get('ice'))) && qs.get('ice')) startWeather({ iceCover: Number(qs.get('ice')), ambient: Math.min(startWeather().ambient ?? 0, -2) });
  if (qs.get('dew')) startWeather({ humidity: 0.99, fog: 0.2, windSpeed: 0.5, rain: 0 });
  // ...&time=21:30&day=172 (or &date=2026-06-21)&clock=running&timeSpeed=60&lat=51.5: the sky's
  // clock (sim/sky.js): the time of day, the date, fixed or running and how fast, the latitude
  {
    const o = {};
    const tm = /^(\d{1,2})(?::(\d{2}))?$/.exec(qs.get('time') ?? '');
    if (tm) o.time = (Number(tm[1]) % 24) + Number(tm[2] ?? 0) / 60;
    const dt = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(qs.get('date') ?? '');
    if (dt) Object.assign(o, { year: Number(dt[1]), day: dayOfDate(Number(dt[1]), Number(dt[2]), Number(dt[3])) });
    if (Number(qs.get('day')) >= 1) o.day = Math.min(366, Math.round(Number(qs.get('day'))));
    if (Number(qs.get('year')) > 0) o.year = Math.round(Number(qs.get('year')));
    if (['fixed', 'running'].includes(qs.get('clock'))) o.clock = qs.get('clock');
    if (Number(qs.get('timeSpeed')) > 0) o.timeSpeed = Number(qs.get('timeSpeed'));
    for (const [k, key] of [['lat', 'latitude'], ['lon', 'longitude'], ['tz', 'utcOffset']]) if (qs.get(k) !== null && Number.isFinite(Number(qs.get(k)))) o[key] = Number(qs.get(k));
    if (Object.keys(o).length) startWeather(o);
  }
  load(sc);
}
// ...&snow=0.4: that much snow lying
if (qs.get('snow') !== null && Number.isFinite(Number(qs.get('snow')))) setSnow(Number(qs.get('snow')));
// ...&storm=1: a gale with rain; ...&wind=12&rain=8: the weather to start with (wind m/s, rain mm/h)
if (qs.get('storm')) Object.assign(settingsNow(), { windSpeed: 24, rain: 25, humidity: 0.97, fog: 0.15, lightning: 3 });
if (qs.get('vary') in VARY) settingsNow().vary = qs.get('vary');
for (const [k, key] of [['wind', 'windSpeed'], ['winddir', 'windDir'], ['rain', 'rain'], ['fog', 'fog'], ['lightning', 'lightning']]) {
  const v = Number(qs.get(k));
  if (qs.get(k) !== null && Number.isFinite(v)) settingsNow()[key] = v;
}
syncWeather();
buildWeatherFolder();
// ...&blast=x,y,z,energy: an explosion there after a second (for testing: energy in J, a grenade ~6e5)
if (qs.get('blast') && !(Number(qs.get('advance')) > 0)) {
  const [bx, by, bz, be] = qs.get('blast').split(',').map(Number);
  if ([bx, by, bz].every(Number.isFinite)) setTimeout(() => import('./sim/explosions.js').then(({ explode }) => explode(sim, [bx, by, bz], Number.isFinite(be) ? be : 6e5)), 1000);
}
// ...&erupt=1: the volcano erupts straight away (without waiting for the dragon to pass)
if (qs.get('erupt')) import('./sim/volcano.js').then(({ erupt }) => sim.world.volcanoes.forEach((v) => erupt(sim, v)));
if (qs.get('shot')) {
  // for screenshots: only the 3D view
  const st = document.createElement('style');
  st.textContent = 'body > *:not(#view):not(#mask) { display: none !important } #mask > *:not(canvas) { display: none !important } .lil-gui { display: none !important }';
  document.head.appendChild(st);
}
// ...&deploy=camp: put down at that place (its deploy point), walking
if (qs.get('deploy') && scene.zones?.[qs.get('deploy')]?.deploy) deploy(qs.get('deploy'));
if (qs.get('walk')) {
  const at = (qs.get('at') ?? '').split(',').map(Number);
  if (at.length >= 3 && at.every(Number.isFinite)) sim.spawn = { p: [at[0], at[1], at[2]], yaw: ((at[3] ?? 0) * Math.PI) / 180 };
  startWalk();
  if (at.length >= 5) walk.pitch = (at[4] * Math.PI) / 180;
  if (qs.get('lamp') === '0') walk.lampOn = false;
  // ...&mask=off (or a step of putting it on: &mask=0.5), &tool=rifle, &aim=1 (up to the eye), &hud=1 (the view
  // as you see it, without the start card: for stills)
  if (qs.get('mask')) {
    const k = qs.get('mask') === 'off' ? 0 : Math.max(0, Math.min(1, Number(qs.get('mask'))));
    walk.maskK = Number.isFinite(k) ? k : 0;
    walk.maskOn = walk.maskK > 0.5;
    walk.sealed = walk.maskK >= 1;
  }
  if (qs.get('tool')) walk.tool = qs.get('tool');
  if (qs.get('aim')) {
    walk.aiming = true;
    walk.aimK = 1;
    walk.gunUp = 1;
  }
  if (qs.get('hud')) {
    walk.el.start.hidden = true;
    const st = document.createElement('style');
    st.textContent = '.lil-gui, #inspect, #toolhint { display: none !important }';
    document.head.appendChild(st);
  }
  if (qs.get('freeze')) state.running = false; // a still: everything where it starts
}
// ...&advance=60: the scene as it is a minute on (the fine detail round the walk-in spot with it)
// ...&strike=x,z: a lightning strike there as the scene starts (sim/lightning.js); &holdbolt=1 keeps its bolt drawn (a still)
if (qs.get('holdbolt')) view.boltHold = true;
if (qs.get('strike')) {
  const [x, z] = qs.get('strike').split(',').map(Number);
  const { strike } = await import('./sim/lightning.js');
  strike(sim, Number.isFinite(x) && Number.isFinite(z) ? [x, z] : null);
}
if (Number(qs.get('advance')) > 0) {
  // (a blast in the link goes off first: the scene is then the aftermath)
  const bl = (qs.get('blast') ?? '').split(',').map(Number);
  if (bl.length >= 3 && bl.slice(0, 3).every(Number.isFinite)) {
    const { explode } = await import('./sim/explosions.js');
    explode(sim, bl.slice(0, 3), Number.isFinite(bl[3]) ? bl[3] : 6e5);
  }
  const sp = sim.spawn.p;
  const eye = [sp[0], (sp[1] ?? 0) + 1.7, sp[2]];
  for (let t = 0; t < Number(qs.get('advance')); t += 0.5) {
    sim.advance(0.5, 1e9);
    sim.patches?.update(eye, 1e9);
  }
}
// F1: show / hide the information pane (the scene, its description and the figures)
window.addEventListener('keydown', (e) => {
  if (e.code !== 'F1') return;
  e.preventDefault();
  document.getElementById('hud').classList.toggle('shown');
});
updateToolHint();
editor.setMode('play');
// ...&mode=edit / rig / camp (and the old pages' scenarios: the rig, the drone camp)
{
  const m = qs.get('mode') ?? pageMode(qs.get('scenario'));
  if (['edit', 'rig', 'camp'].includes(m)) editor.setMode(m);
}
requestAnimationFrame(frame);

// handy for debugging from the console
window.fire = { get sim() { return sim; }, view, state, load, SCENARIOS, editor, walk, places: { update: updatePlaces, go: goToPlace, prebuild } };
