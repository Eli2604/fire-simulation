import GUI from 'lil-gui';
import { View } from './render/view.js';
import { SCENARIOS, cloneScene } from './scenarios.js';
import { createSimulation } from './sim/createSimulation.js';
import { MODELS, defaultParams } from './models/index.js';
import { MATERIAL_NAMES } from './sim/materials.js';
import { defaultWeather } from './sim/weather.js';
import { heatmapCss, legendTemps } from './render/colors.js';

const $ = (id) => document.getElementById(id);
const view = new View($('view'));

const state = {
  scenario: 'campfire',
  running: true,
  timeScale: 4,
  tool: 'inspect',
  toolRadius: 0.3,
  torchPower: 5000,
  torchSeconds: 30,
  waterLitres: 10,
  mode: 'realistic',
  flames: true,
  smoke: true,
  steam: true,
  fireLight: true,
  section: 1,
  smokeDensity: 1,
};

let scene = null; // editable scene description
let sim = null;
let weather = defaultWeather();
let inspected = -1;
let speed = 0;

// ---------------------------------------------------------------------------
function load(desc, fresh = true) {
  scene = desc;
  const wanted = { ...(scene.weather ?? {}) }; // copy first: on restart this is `weather` itself
  weather = Object.assign(weather, defaultWeather(), wanted);
  scene.weather = weather;
  for (const o of scene.objects) o.params = { ...defaultParams(o.type), ...(o.params ?? {}) };
  sim = createSimulation(scene);
  sim.weather = weather;
  view.setWorld(sim.world, scene.view?.camera, !fresh);
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
  $('title').textContent = scene.name ?? 'Custom scene';
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
gui.add(state, 'scenario', scenarioNames).name('Scenario').onChange((k) => load(cloneScene(SCENARIOS[k])));
gui.add({ restart }, 'restart').name('↺ Restart scene');

const fSim = gui.addFolder('Simulation');
fSim.add(state, 'running').name('Running');
fSim.add(state, 'timeScale', 0.1, 200, 0.1).name('Time scale (×)');
fSim.add({ step: () => sim.advance(1, 2000) }, 'step').name('Advance 1 s');

const fW = gui.addFolder('Weather');
const wc = [
  fW.add(weather, 'ambient', -20, 45, 0.5).name('Air temperature (°C)'),
  fW.add(weather, 'humidity', 0, 1, 0.01).name('Relative humidity'),
  fW.add(weather, 'windSpeed', 0, 15, 0.1).name('Wind speed (m/s)'),
  fW.add(weather, 'windDir', 0, 360, 5).name('Wind towards (°)'),
  fW.add(weather, 'rain', 0, 50, 0.5).name('Rain (mm/h)'),
  fW.add(weather, 'fog', 0, 1, 0.01).name('Fog'),
];
wc.forEach((c) => c.onChange(() => view.applyWeather(weather)));

const fV = gui.addFolder('View');
fV.add(state, 'mode', { Realistic: 'realistic', 'Thermal camera': 'thermal' })
  .name('Mode')
  .onChange((v) => {
    view.voxels.mode = v;
    updateLegend();
  });
fV.add(state, 'flames').name('Flames').onChange((v) => (view.flames.enabled = v));
fV.add(state, 'smoke').name('Smoke').onChange((v) => (view.smoke.enabled = v));
fV.add(state, 'steam').name('Steam').onChange((v) => (view.smoke.showSteam = v));
fV.add(state, 'smokeDensity', 0.1, 3, 0.05).name('Smoke opacity').onChange((v) => (view.smoke.density = v));
fV.add(state, 'fireLight').name('Fire light').onChange((v) => (view.fireLightOn = v));
fV.add(state, 'section', 0.05, 1, 0.01)
  .name('Section cut (Z)')
  .onChange((v) => {
    view.voxels.cut = v;
    view.voxels.version = -1;
  });

const fT = gui.addFolder('Tools (click the model)');
fT.add(state, 'tool', { 'Inspect voxel': 'inspect', 'Ignite (lighter)': 'ignite', 'Blow torch': 'torch', 'Water bucket': 'water' })
  .name('Tool')
  .onChange(updateToolHint);
fT.add(state, 'toolRadius', 0.01, 3, 0.01).name('Radius (m)');
fT.add(state, 'torchPower', 100, 50000, 100).name('Torch power (W)');
fT.add(state, 'torchSeconds', 1, 300, 1).name('Torch duration (s)');
fT.add(state, 'waterLitres', 0.1, 200, 0.1).name('Water (litres)');

const fS = gui.addFolder('Scene objects');
let fObjects = null;
const addState = { type: 'tree' };
const modelNames = Object.fromEntries(Object.entries(MODELS).map(([k, m]) => [m.label, k]));

function buildObjectsFolder() {
  if (fObjects) fObjects.destroy();
  fObjects = fS.addFolder('Objects');
  const ws = scene.world;
  const fWorld = fObjects.addFolder('World').close();
  fWorld.add(ws.size, '0', 0.2, 60, 0.1).name('Size X (m)').onFinishChange(scheduleRestart);
  fWorld.add(ws.size, '1', 0.2, 30, 0.1).name('Size Y (m)').onFinishChange(scheduleRestart);
  fWorld.add(ws.size, '2', 0.2, 60, 0.1).name('Size Z (m)').onFinishChange(scheduleRestart);
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
  fAdd.add({
    add: () => {
      const [sx, , sz] = scene.world.size;
      scene.objects.push({ type: addState.type, params: defaultParams(addState.type), x: sx / 2, z: sz / 2, rotation: 0, ignite: false });
      restart();
    },
  }, 'add').name('+ Add at centre');
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
    ['Molten voxels', s.liquid],
    ['Voxels', `${w.solidCount.toLocaleString()} @ ${(w.h * 100).toFixed(1)} cm`],
    ['FPS', fps.toFixed(0)],
  ];
  $('stats').innerHTML = rows.map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('');
  if (inspected >= 0) showInspect();
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
  torch: 'Click to aim a blow torch at a spot',
  water: 'Click to throw a bucket of water',
};
function updateToolHint() {
  $('toolhint').textContent = HINTS[state.tool];
}

// ---------------------------------------------------------------------------
// Pointer tools (a click without dragging, so orbiting still works)
let down = null;
const canvas = $('view');
canvas.addEventListener('pointerdown', (e) => {
  if (e.button === 0) down = [e.clientX, e.clientY];
});
canvas.addEventListener('pointerup', (e) => {
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
    case 'torch': {
      const r = Math.max(w.h, state.toolRadius * 0.5);
      const p = hit.point.map((v, k) => v + hit.normal[k] * r);
      sim.addTorch([p[0], p[1] + r, p[2]], state.torchPower, state.torchSeconds, r);
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
  if (state.running && sim) {
    const done = sim.advance(dt * state.timeScale, 22);
    speed += (done / Math.max(dt, 1e-3) - speed) * 0.1;
  } else speed *= 0.9;
  view.render(dt, sim.stats, weather);
  updateHud(dt);
  requestAnimationFrame(frame);
}

load(cloneScene(SCENARIOS[state.scenario]));
updateToolHint();
requestAnimationFrame(frame);

// handy for debugging from the console
window.fire = { get sim() { return sim; }, view, state, load, SCENARIOS };
