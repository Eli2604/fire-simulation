import GUI from 'lil-gui';
import { MOUSE } from 'three';
import { AGENTS } from './sim/simulation.js';
import { Walkthrough } from './walk/walk.js';
import { defaultStartPower, walkMarker } from './sim/createSimulation.js';
import { toggleDoor, nearestDoor, doorOfVoxel } from './sim/doors.js';
import { View } from './render/view.js';
import { SCENARIOS, cloneScene } from './scenarios.js';
import { createSimulation } from './sim/createSimulation.js';
import { MODELS, defaultParams } from './models/index.js';
import { MATERIAL_NAMES } from './sim/materials.js';
import { defaultWeather, SEASONS } from './sim/weather.js';
import { initSnow } from './sim/snow.js';
import { PATCH } from './sim/patches.js';
import { heatmapCss, legendTemps } from './render/colors.js';
import { ProxyRenderer } from './render/proxies.js';

const $ = (id) => document.getElementById(id);
const view = new View($('view'));
view.proxies = new ProxyRenderer(view.scene);

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
let weather = defaultWeather();
let inspected = -1;
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
    for (const o of zd.objects) o.params = { ...defaultParams(o.type), ...(o.params ?? {}) };
    zoneSims[name] = createSimulation({ name: zd.name, world: zd.world, objects: zd.objects, weather: zoneWeather(zd), walkStart: zd.walkStart });
  }
  return zoneSims[name];
}

/** A zone's own weather (space has none), or the scene's. */
function zoneWeather(zd) {
  return zd?.weather ? { ...weather, ...zd.weather } : weather;
}

/** Make zone `name` the one that is simulated and shown (the others freeze). */
function activateZone(name) {
  if (!scene.zones?.[name] || name === scene.zone) return sim;
  const next = zoneSim(name);
  zoneSims[scene.zone] = sim; // frozen while you are away
  useZone(name);
  const zd = scene.zones[name];
  sim = next;
  sim.weather = zoneWeather(zd);
  view.dark = !!zd.view?.dark;
  view.space = !!zd.view?.space;
  view.sunDir = zd.view?.sun;
  view.archSpec = scene.archipelago ?? null;
  view.zoneOrigin = zd.origin ?? null;
  view.setWorld(sim.world, zd.view?.camera, true, sim.markers);
  view.markers.visible = state.markers;
  view.applyWeather(sim.weather);
  view.voxels.mode = state.mode;
  $('title').textContent = `${scene.name} – ${zd.name}`;
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
let proxyTimer = 0;
function updateProxies(now = false) {
  proxyTimer -= 1;
  if (!now && proxyTimer > 0) return;
  proxyTimer = 60;
  const here = scene.zones?.[scene.zone]?.origin;
  if (!here) return view.proxies.update([]);
  const list = [];
  for (const [name, z] of Object.entries(scene.zones)) {
    if (!z.origin || name === scene.zone) continue;
    const s = zoneSims[name];
    list.push({
      name,
      offset: z.origin.map((v, k) => v - here[k]),
      world: s?.world,
      sea: s?.world.sea?.level ?? z.proxy?.sea ?? 0,
      hint: z.proxy,
      size: z.world.size,
    });
  }
  view.proxies.update(list);
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
  scene.voxelScale = state.voxelScale;
  if (scene.zones) {
    // a restart rebuilds the zone you are in; the others are built again when you go there
    zoneSims = {};
    useZone(fresh ? scene.startZone ?? Object.keys(scene.zones)[0] : scene.zone);
  }
  const wanted = { ...(scene.weather ?? {}) }; // copy first: on restart this is `weather` itself
  weather = Object.assign(weather, defaultWeather(), wanted);
  scene.weather = weather;
  for (const o of scene.objects) o.params = { ...defaultParams(o.type), ...(o.params ?? {}) };
  sim = createSimulation(scene);
  sim.weather = scene.zones ? zoneWeather(scene.zones[scene.zone]) : weather;
  if (walk?.active) walk.exit();
  view.dark = !!scene.view?.dark;
  view.space = !!scene.view?.space;
  view.sunDir = scene.view?.sun;
  view.archSpec = scene.archipelago ?? null;
  view.zoneOrigin = scene.zones?.[scene.zone]?.origin ?? (scene.archipelago ? [0, 0, 0] : null);
  view.setWorld(sim.world, scene.view?.camera, !fresh, sim.markers);
  updateProxies(true);
  view.markers.visible = state.markers;
  view.applyWeather(weather);
  if (fresh) {
    // a new scenario brings its own view settings; a restart after an edit keeps the user's
    state.mode = scene.view?.mode ?? 'realistic';
    if (scene.timeScale) state.timeScale = scene.timeScale;
    state.toolRadius = Math.max(sim.world.h * 1.5, Math.min(1, Math.hypot(...sim.world.size) * 0.03));
    state.torchPower = Math.round(5000 * Math.min(4, Math.max(0.2, (sim.world.h / 0.05) ** 2)));
  }
  view.voxels.mode = state.mode;
  inspected = -1;
  $('inspect').hidden = true;
  $('title').textContent = (scene.name ?? 'Custom scene') + (scene.zones ? ` – ${scene.zones[scene.zone].name}` : '');
  $('desc').textContent = scene.description ?? '';
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  buildObjectsFolder();
  updateLegend();
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
const gui = new GUI({ title: 'Fire simulation' });
const scenarioNames = Object.fromEntries(Object.entries(SCENARIOS).map(([k, v]) => [v.name, k]));
gui.add(state, 'scenario', scenarioNames).name('Scenario').onChange((k) => (SCENARIOS[k].page ? (location.href = SCENARIOS[k].page) : load(cloneScene(SCENARIOS[k]))));
gui.add({ restart }, 'restart').name('↺ Restart scene');
gui.add({ walkIn: () => startWalk() }, 'walkIn').name('🚒 Walk through as a firefighter');
gui.add({ pick: () => setTool('walkstart') }, 'pick').name('📍 Set the walk-in start (click the scene)');

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

const fW = gui.addFolder('Weather');
const wc = [
  fW.add(weather, 'ambient', -20, 45, 0.5).name('Air temperature (°C)'),
  fW.add(weather, 'humidity', 0, 1, 0.01).name('Relative humidity'),
  fW.add(weather, 'windSpeed', 0, 35, 0.1).name('Wind speed (m/s)'),
  fW.add(weather, 'windDir', 0, 360, 5).name('Wind towards (°)'),
  fW.add(weather, 'rain', 0, 50, 0.5).name('Rain / snow (mm/h of water)'),
  fW.add(weather, 'lightning', 0, 20, 0.5).name('Lightning (strikes a minute)'),
  fW.add(weather, 'fog', 0, 1, 0.01).name('Fog'),
];
wc.forEach((c) => c.onChange(() => view.applyWeather(weather)));
// weather presets: a gale with driving rain and a high sea, or a calm
const setWeather = (o) => {
  Object.assign(weather, o);
  if (sim.weather !== weather) Object.assign(sim.weather, o);
  wc.forEach((c) => c.updateDisplay());
  view.applyWeather(weather);
};
fW.add({ storm: () => setWeather({ windSpeed: 24, rain: 25, humidity: 0.97, fog: 0.15, lightning: 3 }) }, 'storm').name('Storm (gale, rain, high sea, lightning)');
// lightning: strikes per minute (it hits what stands highest: trees, towers, masts; sets fire, splits, fells)
fW.add({ bolt: () => import('./sim/lightning.js').then(({ strike }) => strike(sim)) }, 'bolt').name('Lightning strike now');
fW.add({ calm: () => setWeather({ windSpeed: 1.5, rain: 0, humidity: 0.5, fog: 0 }) }, 'calm').name('Calm');
// the seasons: the weather of a typical day, the leaves and the grass, snow lying in winter
// (below freezing what falls is snow: sim/snow.js)
// (a season is the scene's: it is built again in it, its ground and walls at that day's
// temperature, the snow lying; a warm scene put in frost would steam all over)
function setSeason(s) {
  const p = SEASONS[s];
  if (!p) return;
  Object.assign(weather, p, { season: s });
  restart();
  wc.forEach((c) => c.updateDisplay());
}
/** Snow lying now (m): a fresh layer over the scene (outdoors), or none. */
function setSnow(v) {
  weather.snowCover = v;
  if (sim.weather !== weather) sim.weather.snowCover = v;
  const w = sim.world;
  if (v > 0) initSnow(w, v);
  else if (w.snow) {
    w.snow.depth.fill(0);
    w.snow.version++;
  }
  wc.forEach((c) => c.updateDisplay());
}
wc.push(
  fW.add(weather, 'season', ['spring', 'summer', 'autumn', 'winter']).name('Season').onChange(setSeason),
  fW.add(weather, 'snowCover', 0, 1.5, 0.05).name('Snow lying (m)').onFinishChange(setSnow),
  fW.add(weather, 'sunshine', 0, 1, 0.05).name('Sunshine (0 overcast, 1 clear)').onChange(() => view.applyWeather?.(weather)),
);
fW.add({ snowfall: () => setWeather({ ambient: -4, rain: 4, windSpeed: 5, humidity: 0.92, fog: 0.12, sunshine: 0.2 }) }, 'snowfall').name('Snowfall (−4 °C, snowing: it builds up)');
// the sun on the snow at a few degrees above freezing: it shrinks, the ground under it wet
fW.add({ dew: () => setWeather({ humidity: 0.99, fog: 0.2, windSpeed: 0.5, rain: 0, sunshine: 0.3 }) }, 'dew').name('Misty morning (dew point: dew, or frost below 0 °C)');
fW.add({ thaw: () => setWeather({ ambient: 5, rain: 0, windSpeed: 2, humidity: 0.7, fog: 0, sunshine: 1 }) }, 'thaw').name('Thaw (+5 °C, sunny: the snow melts)');
// ice on the ponds and the canal (sim/ice.js): it forms below freezing (slowly, as it does: the
// speed-up to watch it), bears you from ~5 cm (only just: it creaks), 10 cm safely, a dragon 30 cm
/** Ice lying now (m): on all the fresh water open to the sky. */
function setIce(v) {
  weather.iceCover = v;
  if (sim.weather !== weather) sim.weather.iceCover = v;
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
  wc.forEach((c) => c.updateDisplay());
}
wc.push(
  fW.add(weather, 'iceCover', 0, 0.6, 0.01).name('Ice on the water (m)').onFinishChange(setIce),
  fW.add(weather, 'iceSpeed', 1, 2000, 1).name('Ice forms / melts faster (×)').onChange(() => (sim.weather.iceSpeed = weather.iceSpeed)),
);
fW.add({ frost: () => (setWeather({ ambient: -12, rain: 0, windSpeed: 3, humidity: 0.75, fog: 0, sunshine: 0.6 }), setIce(0.15)) }, 'frost').name('Hard frost (−12 °C: 15 cm of ice, it bears you)');
fW.add({ freeze: () => (setWeather({ ambient: -15, rain: 0, windSpeed: 4, humidity: 0.7, fog: 0, sunshine: 0.3, iceSpeed: 600 }), setIce(0)) }, 'freeze').name('Watch it freeze (−15 °C, ice forming 600× faster)');

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
const toolCtl = fT.add(state, 'tool', { 'Inspect voxel': 'inspect', 'Set fire start (click, Shift = add)': 'firestart', 'Set walk-in start (click)': 'walkstart', 'Place new object (click)': 'place', 'Ignite (lighter)': 'ignite', 'Fire torch (hold)': 'torch', 'Throw hand grenade': 'grenade', 'Squad: set the threat (click)': 'squadThreat', 'Open / close door': 'door', 'Remove oxygen (inert the room)': 'inert', 'Water bucket': 'water', 'Fire extinguisher (hold)': 'extinguisher' })
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
fSquad.add({ rig: () => (location.href = 'rig.html') }, 'rig').name('Open the soldier rig test page');
fT.add(state, 'waterLitres', 0.1, 200, 0.1).name('Bucket water (litres)');
fT.add(state, 'agent', Object.fromEntries(Object.entries(AGENTS).map(([k, a]) => [a.label, k])))
  .name('Extinguisher')
  .onChange(() => (tank.remaining = AGENTS[state.agent].capacity));
fT.add({ refill: () => (tank.remaining = AGENTS[state.agent].capacity) }, 'refill').name('↻ Refill extinguisher');

const fS = gui.addFolder('Scene objects');
let fObjects = null;
const addState = { type: 'tree' };
const modelNames = Object.fromEntries(Object.entries(MODELS).map(([k, m]) => [m.label, k]));

function buildObjectsFolder() {
  if (fObjects) fObjects.destroy();
  fObjects = fS.addFolder('Objects');
  const ws = scene.world;
  // a scene of several zones (the carrier: flight deck, below deck, the island, the catacombs,
  // the spaceship): pick one to go there and see (and edit) its objects
  if (scene.zones) {
    const zs = { zone: scene.zone };
    const names = Object.fromEntries(Object.entries(scene.zones).map(([k, z]) => [`${z.name} (${z.objects.length} objects)`, k]));
    fObjects
      .add(zs, 'zone', names)
      .name('Zone (go there)')
      .onChange((name) =>
        setTimeout(() => {
          if (walk?.active) walk.exit();
          activateZone(name);
        }, 0),
      );
  }
  const fWorld = fObjects.addFolder('World').close();
  fWorld.add(ws.size, '0', 0.2, 120, 0.1).name('Size X (m)').onFinishChange(scheduleRestart);
  fWorld.add(ws.size, '1', 0.2, 40, 0.1).name('Size Y (m)').onFinishChange(scheduleRestart);
  fWorld.add(ws.size, '2', 0.2, 120, 0.1).name('Size Z (m)').onFinishChange(scheduleRestart);
  fWorld.add(ws, 'h', 0.004, 0.5, 0.001).name('Voxel size (m)').onFinishChange(scheduleRestart);
  if (!ws.ground) ws.ground = 'soil';
  fWorld.add(ws, 'ground', MATERIAL_NAMES).name('Ground material').onFinishChange(scheduleRestart);
  const est = { voxels: '' };
  const updEst = () => {
    const n = (ws.size[0] / ws.h) * (ws.size[1] / ws.h) * (ws.size[2] / ws.h);
    est.voxels = `${(n / 1e6).toFixed(2)} M grid cells`;
  };
  updEst();
  fWorld.add(est, 'voxels').name('Grid').disable();

  scene.objects.forEach((o, idx) => {
    const M = MODELS[o.type];
    const f = fObjects.addFolder(`${idx + 1}. ${M.label}`).close();
    f.add(o, 'x', 0, ws.size[0], 0.01).name('Position X (m)').onFinishChange(scheduleRestart);
    f.add(o, 'z', 0, ws.size[2], 0.01).name('Position Z (m)').onFinishChange(scheduleRestart);
    if (o.rotation === undefined) o.rotation = 0;
    f.add(o, 'rotation', 0, 360, 5).name('Rotation (°)').onFinishChange(scheduleRestart);
    if (o.ignite === undefined) o.ignite = false;
    f.add(o, 'ignite').name('Burning at start').onFinishChange(scheduleRestart);
    for (const [key, spec] of Object.entries(M.params)) {
      let c;
      if (spec.options) c = f.add(o.params, key, spec.options);
      else if (spec.color) c = f.addColor(o.params, key);
      else if (typeof spec.value === 'boolean') c = f.add(o.params, key);
      else c = f.add(o.params, key, spec.min, spec.max, spec.step);
      c.name(spec.label ?? key).onFinishChange(scheduleRestart);
    }
    f.add({ remove: () => { scene.objects.splice(idx, 1); restart(); } }, 'remove').name('✕ Remove');
  });
  const fAdd = fObjects.addFolder('Add object');
  fAdd.add(addState, 'type', modelNames).name('Type');
  fAdd.add({ add: () => setTool('place') }, 'add').name('+ Add: click the scene to place it');
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
        if (!desc.world || !Array.isArray(desc.objects)) throw new Error('Not a scene file');
        load(desc);
      } catch (e) {
        alert(`Could not load scene: ${e.message}`);
      }
    };
    input.click();
  },
};
fS.add(io, 'exportJson').name('⭳ Export scene (JSON)');
fS.add(io, 'importJson').name('⭱ Import scene (JSON)');
fS.close();
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
  if (inspected >= 0) showInspect();
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
const EVENT_TEXT = { radio: '(radio)', enemyDown: 'is down', explosion: 'BURST', leak: 'is leaking', split: 'split open, fuel pouring out', pipeBurst: 'BURST – gas jet burning', waterBurst: 'BURST – water pouring out', spall: 'spalled', sprinkler: 'went off', doorOpen: 'opened', doorClose: 'closed', inerted: 'flooded with inert gas', inertSystem: '', rackFire: 'electrical fault – fire', enemyFire: 'set a fire to lure you', glass: 'broke', lightSeen: 'saw a light and comes to look', foundering: 'is going down: the sea is over the deck edge', eruption: 'ERUPTS – lava is coming down', eruptionEnd: 'has calmed down', laze: 'runs into the sea – clouds of steam', shout: 'shouted: they have seen you', roar: 'roars', seized: 'seized you in its jaws', devoured: 'swallowed you', gulp: 'swallowed its prey', dragonSnap: 'snapped its jaws shut', dragonFire: 'set you alight', dragonHit: 'is mortally wounded', dragonDown: 'is down', phoenixCalls: 'calls from its cell', phoenixCry: 'calls', phoenixHurt: 'is hit', phoenixFreed: 'is out of its cell', phoenixWaits: 'waits at a closed door', phoenixBurns: 'bursts into flame', phoenixReborn: 'rises from its ashes', phoenixEscape: 'flies up the stairs', phoenixFree: 'is free: out of the catacombs', keysDropped: 'dropped his keys' };
function eventRows(w) {
  return w.events
    .filter((e) => w.time - e.time < 30)
    .slice(-2)
    .map((e) => ['Event', `${fmtTime(e.time)} ${{ cylinder: 'gas cylinder', fuelTank: 'fuel tank', 'gas pipe': 'gas pipe', grenade: 'grenade', concrete: 'concrete', sprinkler: 'a sprinkler' }[e.name] ?? e.name} ${EVENT_TEXT[e.type] ?? e.type}${e.pressure ? ` at ${(e.pressure / 1e5).toFixed(1)} bar` : ''}`]);
}

function showInspect() {
  const d = sim.describe(inspected);
  const el = $('inspect');
  if (!d) {
    el.innerHTML = '<b>Gone</b> – this voxel burnt away or moved.';
    return;
  }
  const o = d.owner >= 0 && scene.objects[d.owner] ? MODELS[scene.objects[d.owner].type].label : 'Ground';
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
  const hit = view.pick(e.clientX, e.clientY);
  if (!hit || hit.voxel < 0) return;
  const w = sim.world;
  const [x, y, z] = w.coords(hit.voxel);
  const c = w.center(x, y, z);
  switch (state.tool) {
    case 'inspect':
      inspected = hit.voxel;
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
      for (const o of scene.objects) o.ignite = false;
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
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (walk.active) walk.update(dt);
  view.markers.visible = state.markers && !walk.active; // no labels and patrol outlines in the walk-through
  if (torching && torchPoint) sim.holdTorch(torchPoint, state.torchPower, Math.max(sim.world.h, state.toolRadius * 0.5));
  if (state.running && sim) {
    // the walk-through runs in real time
    const done = sim.advance(dt * (walk.active ? 1 : state.timeScale), 22);
    speed += (done / Math.max(dt, 1e-3) - speed) * 0.1;
    // the candles near the camera in fine detail (sim/patches.js), within a few ms a frame
    if (sim.patches) sim.patches.enabled = state.detail;
    sim.patches?.update(view.cameraLocal(), 8);
  } else speed *= 0.9;
  if (scene.zones) updateProxies();
  view.render(dt, sim);
  updateHud(dt);
  requestAnimationFrame(frame);
}

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
  $('inspect').hidden = true;
  walk.enter();
}

// deep links: ?scenario=catacombs&zone=catacombs&walk=1&at=x,y,z,yaw,pitch opens a scene
// (and a zone of it) straight in the walk-through, standing at a given spot
const qs = new URLSearchParams(location.search);
// ...&voxel=1.5: every scene's voxels 1.5x their size; ...&detailvoxel=0.7: the close-up detail's
if (Number(qs.get('voxel')) > 0) state.voxelScale = Number(qs.get('voxel'));
if (Number(qs.get('detailvoxel')) > 0) state.patchScale = PATCH.scale = Number(qs.get('detailvoxel'));
// no graphics card (rendering in software): fewer close-up objects at once
if (view.softwareGpu) PATCH.maxActive = 4;
if (SCENARIOS[qs.get('scenario')]?.page) location.replace(SCENARIOS[qs.get('scenario')].page);
else if (SCENARIOS[qs.get('scenario')]) state.scenario = qs.get('scenario');
{
  const sc = cloneScene(SCENARIOS[state.scenario]);
  if (sc.zones && sc.zones[qs.get('zone')]) sc.startZone = qs.get('zone');
  // ...&season=winter: a winter's day (snow lying, snow falling)
  if (SEASONS[qs.get('season')]) sc.weather = { ...(sc.weather ?? {}), ...SEASONS[qs.get('season')], season: qs.get('season') };
  // ...&thaw=1: the snow lying, a sunny day above freezing (it melts, the roofs drip)
  if (qs.get('thaw')) sc.weather = { ...(sc.weather ?? {}), ambient: 5, rain: 0, sunshine: 1, humidity: 0.7, fog: 0 };
  // ...&dew=1: a still, misty morning, the air at its dew point (dew on the grass; frost if it is freezing)
  if (qs.get('frost')) sc.weather = { ...(sc.weather ?? {}), ambient: -12, rain: 0, windSpeed: 3, sunshine: 0.6, iceCover: 0.15, season: 'winter', snowCover: 0.05 };
  if (qs.get('freeze')) sc.weather = { ...(sc.weather ?? {}), ambient: -15, rain: 0, windSpeed: 4, sunshine: 0.3, iceCover: 0, iceSpeed: 600, season: 'winter' };
  if (Number.isFinite(Number(qs.get('ice'))) && qs.get('ice')) sc.weather = { ...(sc.weather ?? {}), iceCover: Number(qs.get('ice')), ambient: Math.min(sc.weather?.ambient ?? 0, -2) };
  if (qs.get('dew')) sc.weather = { ...(sc.weather ?? {}), humidity: 0.99, fog: 0.2, windSpeed: 0.5, rain: 0 };
  load(sc);
}
// ...&snow=0.4: that much snow lying
if (qs.get('snow') !== null && Number.isFinite(Number(qs.get('snow')))) setSnow(Number(qs.get('snow')));
// ...&storm=1: a gale with rain; ...&wind=12&rain=8: the weather to start with (wind m/s, rain mm/h)
if (qs.get('storm')) for (const [k, v] of Object.entries({ windSpeed: 24, rain: 25, humidity: 0.97, fog: 0.15, lightning: 3 })) weather[k] = sim.weather[k] = v;
for (const [k, key] of [['wind', 'windSpeed'], ['winddir', 'windDir'], ['rain', 'rain'], ['fog', 'fog'], ['lightning', 'lightning']]) {
  const v = Number(qs.get(k));
  if (qs.get(k) !== null && Number.isFinite(v)) weather[key] = sim.weather[key] = v;
}
view.applyWeather(weather);
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
requestAnimationFrame(frame);

// handy for debugging from the console
window.fire = { get sim() { return sim; }, view, state, load, SCENARIOS };
