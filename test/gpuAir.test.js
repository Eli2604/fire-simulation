// The air model's GPU backend (sim/gpu/*, sim/solverBackend.js) against the CPU solver
// (sim/air.js), which stays the reference:
//  - each WGSL kernel's JS emulation, on the GPU's buffer layout, against the CPU step
//    (velocities, advected fields, mixing + heat exchange + flames, the radiation blur), in a
//    burning hallway and in a randomised grid that takes every branch (sleeping cells, ceilings,
//    closed faces, a vacuum's suction, rain, fog, open boundaries)
//  - the whole host side (upload of what changed, dispatch order, readback, merge with the CPU's
//    edits meanwhile) through an emulated device; a full simulation on it
//  - the layout round-trips; backend selection and fallback
//  - with a WebGPU implementation in node (the `webgpu` package, or WEBGPU_MODULE=<its folder>)
//    the real WGSL on the real GPU against the CPU; skipped without one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, isAbsolute } from 'node:path';
import { createSimulation } from '../src/sim/createSimulation.js';
import { World } from '../src/sim/world.js';
import { stepAir, blurRadiation, radiationGain, windShelter } from '../src/sim/air.js';
import { conserveO2 } from '../src/sim/oxygen.js';
import { deriveWeather } from '../src/sim/weather.js';
import { FIELD_NAMES, F, N_ADVECTED, airStepParams, packParams, unpackParams, packWorld, unpackWorld, mirrorPlan, tableOffsets, PARAM_BYTES, PARAM_U32, PARAM_F32 } from '../src/sim/gpu/airLayout.js';
import { emuVelocity, emuAdvect, emuMixHeat, emuRadiationPass } from '../src/sim/gpu/airEmulation.js';
import { RAD_PASSES, AIR_WGSL, dispatchSize, WORKGROUP } from '../src/sim/gpu/airKernels.js';
import { GpuAirSolver } from '../src/sim/gpu/gpuAir.js';
import { createEmulatedGpuContext } from '../src/sim/gpu/emulatedDevice.js';
import { createGpuContext, initGpu } from '../src/sim/gpu/gpuContext.js';
import { AirSolver, chooseAirBackend, MAX_GPU_WAIT } from '../src/sim/solverBackend.js';

const ADV_TMP = ['tmpA', 'tmpB', 'tmpC', 'tmpD', 'tmpE', 'tmpF', 'tmpG', 'tmpH', 'tmpI']; // air.js oT..oO
const AIR = [...FIELD_NAMES, ...ADV_TMP, 'radField', 'airG', 'airGT', 'airQ', 'flameAcc', 'radSrc', 'shelter'];
const snap = (w, names = AIR) => Object.fromEntries(names.filter((k) => w[k]).map((k) => [k, w[k].slice()]));
const restore = (w, s) => Object.entries(s).forEach(([k, v]) => w[k].set(v));

/**
 * Worst mismatch of two arrays: |a - b| <= atol + rtol * max(|a|, |b|) everywhere, atol growing
 * with the field's largest value (srel): interpolating between a large and a tiny neighbour,
 * rounding in the weights shows up as an absolute error of the large one's size.
 */
function close(name, got, want, { rtol = 2e-5, atol = 1e-6, srel = 1e-6 } = {}) {
  assert.equal(got.length, want.length, `${name}: length`);
  let big = 0;
  for (let i = 0; i < want.length; i++) if (Math.abs(want[i]) > big) big = Math.abs(want[i]);
  atol += srel * big;
  let worst = 0;
  let at = -1;
  for (let i = 0; i < want.length; i++) {
    const e = Math.abs(got[i] - want[i]) / (atol + rtol * Math.max(Math.abs(got[i]), Math.abs(want[i])));
    if (!(e <= worst)) {
      worst = e;
      at = i;
    }
  }
  assert.ok(worst <= 1, `${name}: cell ${at} ${got[at]} vs CPU ${want[at]} (${worst.toFixed(1)}x the tolerance)`);
}
// per field: the absolute scale below which differences do not matter
const ATOL = { airT: 1e-3, smoke: 1e-12, smokeR: 1e-12, smokeG: 1e-12, smokeB: 1e-12, steam: 1e-12, fgas: 1e-3, supp: 1e-9, o2: 1e-7, flame: 1e-6, vx: 1e-6, vy: 1e-6, vz: 1e-6, radField: 1e-3 };

/** A hallway with a fire going: sources from the solids (what the solid passes put into the air). */
let hallwayCase = null;
function burningHallway() {
  // (built once; every caller starts from the same air state)
  if (hallwayCase) {
    restore(hallwayCase.w, hallwayCase.state);
    return hallwayCase;
  }
  const sim = createSimulation({
    world: { size: [8, 3.6, 4], h: 0.1 },
    weather: { ambient: 18 },
    objects: [{ type: 'hallway', params: { length: 6 }, x: 4.5, z: 2 }],
    fireStarts: [{ p: [4, 0.3, 2], radius: 0.4, power: 30000 }],
  });
  while (sim.world.time < 8) sim.step(0.1);
  const w = sim.world;
  const D = deriveWeather(sim.weather);
  sim.applyHeaters(0.1);
  sim.solidPassA(0.1, D);
  sim.solidPassB(0.1, D);
  windShelter(w);
  hallwayCase = { sim, w, W: sim.weather, D, dt: 0.1, state: snap(w) };
  return hallwayCase;
}

/** A small grid with random state and geometry: every branch of the kernels. */
function randomGrid({ vacuum = false, asleep = true, rain = 0, fog = 0 } = {}) {
  const w = new World({ size: [3.2, 2.4, 2.8], h: 0.1, ambient: 12 });
  let seed = 7;
  const r = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const NA = w.NA;
  for (let a = 0; a < NA; a++) {
    const hot = r() < 0.2;
    w.airT[a] = hot ? 12 + r() * 900 : 12 + (r() - 0.5) * 4;
    w.smoke[a] = r() < 0.5 ? r() * 1e-4 : r() < 0.5 ? 1e-13 : 0;
    w.smokeR[a] = w.smoke[a] * r();
    w.smokeG[a] = w.smoke[a] * r();
    w.smokeB[a] = w.smoke[a] * r();
    w.steam[a] = r() < 0.3 ? r() * 1e-3 : 0;
    w.fgas[a] = r() < 0.2 ? r() * 500 : 0;
    w.supp[a] = r() < 0.1 ? r() * 0.5 : 0;
    w.o2[a] = 0.15 + r() * 0.08;
    w.flame[a] = r() < 0.2 ? r() : 0;
    w.occ[a] = r() < 0.2 ? r() : 0;
    w.passX[a] = r() < 0.15 ? r() * 0.6 : 1;
    w.passY[a] = r() < 0.2 ? r() * 0.6 : 1;
    w.passZ[a] = r() < 0.15 ? r() * 0.6 : 1;
    w.capped[a] = r() < 0.3 ? 1 : 0;
    w.airG[a] = r() < 0.1 ? r() * 5 : 0;
    w.airGT[a] = w.airG[a] * (12 + r() * 600);
    w.airQ[a] = r() < 0.05 ? r() * 2000 : 0;
    w.flameAcc[a] = r() < 0.05 ? r() * 5000 : 0;
    w.radSrc[a] = r() < 0.02 ? r() * 3000 : 0;
  }
  if (asleep) {
    w.airAwake = new Uint8Array(NA);
    for (let a = 0; a < NA; a++) w.airAwake[a] = r() < 0.7 ? 1 : 0;
  }
  if (vacuum) {
    w.vacuum = true;
    w.suck = new Float32Array(NA * 3);
    for (let i = 0; i < NA * 3; i++) w.suck[i] = r() < 0.1 ? (r() - 0.5) * 4 : 0;
  }
  w.time = 3.7;
  windShelter(w);
  const W = { ambient: 12, fog };
  const D = { windX: 3.1, windZ: -1.7, rainFrac: rain, rh: 0.6 };
  return { sim: { stats: {}, radGain: radiationGain(w) }, w, W, D, dt: 0.12 };
}

/** The CPU step's results: velocities, the advected copies, the fields, the radiation. */
function cpuStep({ sim, w, W, D, dt }) {
  const before = snap(w);
  stepAir(w, W, D, dt, sim);
  const out = snap(w, [...FIELD_NAMES, ...ADV_TMP]);
  blurRadiation(w, radiationGain(w));
  out.radField = w.radField.slice();
  restore(w, before);
  return out;
}

function checkKernels(c) {
  const { w, W, D, dt } = c;
  const cpu = cpuStep(c);
  const b = packWorld(w);
  const P = unpackParams(packParams(airStepParams(w, W, D, dt, b.tables))); // (as the GPU sees them: f32)
  const NA = w.NA;
  const field = (k) => b.fields.subarray(k * NA, (k + 1) * NA);
  emuVelocity(P, b);
  for (const k of ['vx', 'vy', 'vz']) close(`velocity ${k}`, field(F[k.toUpperCase()]), cpu[k], { atol: ATOL[k] });
  emuAdvect(P, b);
  for (let k = 0; k < N_ADVECTED; k++) close(`advect ${FIELD_NAMES[k]}`, b.tmp.subarray(k * NA, (k + 1) * NA), cpu[ADV_TMP[k]], { atol: ATOL[FIELD_NAMES[k]] });
  emuMixHeat(P, b);
  for (const pass of RAD_PASSES) emuRadiationPass(P, b, pass);
  const before = snap(w);
  unpackWorld(w, b);
  conserveO2(w); // (after the step, on the CPU as in stepAir)
  for (const k of [...FIELD_NAMES, 'radField']) close(`mixHeat/radiation ${k}`, w[k], cpu[k], { atol: ATOL[k] });
  restore(w, before);
  return cpu;
}

test('layout: buffers, uniforms and tables round-trip', () => {
  const { w, W, D, dt } = randomGrid({ vacuum: true });
  const b = packWorld(w);
  const s = snap(w);
  for (const k of FIELD_NAMES) w[k].fill(-1);
  w.radField.fill(-1);
  unpackWorld(w, b);
  for (const k of [...FIELD_NAMES]) assert.deepEqual(w[k], s[k], k);
  // every mirrored array where the plan says, no overlaps
  const seen = { fields: [], geom: [], src: [], rad: [] };
  for (const m of mirrorPlan(w)) {
    const a = m.get(w);
    if (a) for (let i = 0; i < m.len; i += 97) assert.equal(b[m.buf][m.offset + i], Math.fround(a[i]), `${m.name}[${i}]`);
    for (const [o, l] of seen[m.buf]) assert.ok(m.offset >= o + l || m.offset + m.len <= o, `${m.name} overlaps`);
    seen[m.buf].push([m.offset, m.len]);
  }
  const P = airStepParams(w, W, D, dt, b.tables);
  const buf = packParams(P);
  assert.equal(buf.byteLength, PARAM_BYTES);
  assert.equal(PARAM_BYTES % 16, 0);
  const back = unpackParams(buf);
  for (const k of PARAM_U32) assert.equal(back[k], P[k] ?? 0, k);
  for (const k of PARAM_F32) assert.equal(back[k], Math.fround(P[k] ?? 0), k);
  // the WGSL struct has the same members in the same order
  const struct = AIR_WGSL.match(/struct Params \{([^}]*)\}/)[1].match(/\w+: (u32|f32)/g).map((s) => s.split(': ')[1]);
  assert.deepEqual(struct, [...PARAM_U32.map(() => 'u32'), ...PARAM_F32.map(() => 'f32')]);
  assert.equal(tableOffsets(w.anx, w.any, w.anz).length, b.tables.length);
  const [x, y] = dispatchSize(5e6);
  assert.ok(x <= 65535 && x * y * WORKGROUP >= 5e6);
});

test('kernels (JS emulation, GPU layout) match the CPU air step: a burning hallway', () => {
  const c = burningHallway();
  const cpu = checkKernels(c);
  // (something to compare: a fire, hot gas, smoke, radiation)
  assert.ok(Math.max(...cpu.flame) > 0.2 && Math.max(...cpu.airT) > 200, 'a fire');
  assert.ok(cpu.smoke.some((v) => v > 0) && cpu.radField.some((v) => v > 100), 'smoke and radiation');
  assert.ok(c.w.capped.some((v) => v) && c.w.passY.some((v) => v < 0.5), 'a ceiling');
});

test('kernels match the CPU: random state, sleeping cells, closed faces, rain', () => {
  checkKernels(randomGrid({ rain: 0.4 }));
});

test('kernels match the CPU: a vacuum (suction, no oxygen from outside), fog, all awake', () => {
  checkKernels(randomGrid({ vacuum: true, asleep: false, fog: 0.8 }));
});

test('kernels match the CPU: no wind, and outside oxygen of a detail patch', () => {
  const c = randomGrid();
  c.D.windX = c.D.windZ = 0;
  c.w.o2Out = 0.2;
  checkKernels(c);
});

/** The GPU solver's step on a device, then the World's arrays against the CPU's. */
async function solverMatchesCpu(ctx, c, tol = {}) {
  const { sim, w, W, D, dt } = c;
  const cpu = cpuStep(c);
  const g = new GpuAirSolver(ctx);
  assert.equal(g.unsupported(w), null);
  g.step(w, W, D, dt, sim);
  assert.ok(g.busy);
  await g.flush();
  assert.equal(g.failed, null, g.failed);
  for (const k of [...FIELD_NAMES, 'radField']) close(`solver ${k}`, w[k], cpu[k], { atol: ATOL[k], ...tol });
  g.release();
  return g;
}

test('the GPU solver on an emulated device: upload, dispatches, readback', async () => {
  const ctx = createEmulatedGpuContext();
  const g = await solverMatchesCpu(ctx, burningHallway());
  const order = ctx.device.dispatches.map((d) => d.entryPoint);
  assert.deepEqual(order, ['velocity', 'advect', 'mixHeat', ...RAD_PASSES.map(() => 'radiation')]);
  assert.deepEqual(ctx.device.dispatches.slice(3).map((d) => d.pass), RAD_PASSES.map((p) => ({ axis: p.axis, from: p.from, to: p.to, mode: p.mode })));
  assert.ok(g.stats.uploadKB > 0);
});

test('the GPU solver uploads only what changed, and keeps what the CPU did meanwhile', async () => {
  const ctx = createEmulatedGpuContext();
  const c = burningHallway();
  const { sim, w, W, D, dt } = c;
  const g = new GpuAirSolver(ctx);
  g.step(w, W, D, dt, sim);
  const first = g.stats.uploadKB;
  await g.flush();
  // nothing changed on the CPU: next step sends (almost) nothing besides params
  for (const k of ['airG', 'airGT', 'airQ', 'flameAcc', 'radSrc']) w[k].fill(0);
  g.step(w, W, D, dt, sim);
  await g.flush();
  g.step(w, W, D, dt, sim);
  await g.flush();
  assert.ok(g.stats.uploadKB < first / 20, `second upload ${g.stats.uploadKB} KB vs first ${first} KB`);
  // a cell edited while a step is in flight: its change lands on top of the GPU's result
  const reference = new GpuAirSolver(createEmulatedGpuContext());
  const before = snap(w);
  g.step(w, W, D, dt, sim);
  const cell = Math.floor(w.NA / 2);
  w.smoke[cell] += 1e-3;
  w.airT[cell] += 50;
  await g.flush();
  const edited = { smoke: w.smoke[cell], airT: w.airT[cell] };
  restore(w, before);
  reference.step(w, W, D, dt, sim);
  await reference.flush();
  assert.ok(Math.abs(edited.smoke - (w.smoke[cell] + 1e-3)) < 1e-6, 'smoke added meanwhile kept');
  assert.ok(Math.abs(edited.airT - (w.airT[cell] + 50)) < 1e-3, 'heat added meanwhile kept');
});

test('a whole simulation with the air on the (emulated) GPU follows the CPU one', async () => {
  const make = () =>
    createSimulation({
      world: { size: [8, 3.6, 4], h: 0.1 },
      weather: { ambient: 18 },
      objects: [{ type: 'hallway', params: { length: 6 }, x: 4.5, z: 2 }],
      fireStarts: [{ p: [4, 0.3, 2], radius: 0.4, power: 30000 }],
    });
  const cpu = make();
  const gpu = make();
  gpu.airSolver.configure('auto', createEmulatedGpuContext());
  while (cpu.world.time < 12) cpu.step(0.1);
  while (gpu.world.time < 12) {
    gpu.step(0.1);
    await gpu.airSolver.flush(); // (a frame: the readback comes back)
  }
  assert.equal(gpu.airSolver.active, 'gpu');
  assert.equal(gpu.airSolver.cpuSteps, 0);
  assert.ok(gpu.airSolver.gpuSteps > 50);
  const maxT = (s) => Math.max(...s.world.airT);
  // the coupling is one air step late on the GPU path (what moves sees the air before its step):
  // the same fire, not the same numbers
  assert.ok(maxT(gpu) > 200 && maxT(cpu) > 200, `hot gas: GPU ${maxT(gpu)}, CPU ${maxT(cpu)}`);
  assert.ok(gpu.stats.burning > 0 && cpu.stats.burning > 0);
  assert.ok(Math.abs(Math.log(gpu.stats.smoke / cpu.stats.smoke)) < 0.7, `smoke ${gpu.stats.smoke} vs ${cpu.stats.smoke}`);
});

test('backend selection and fallback', () => {
  const w = randomGrid().w;
  const ready = createEmulatedGpuContext();
  assert.equal(chooseAirBackend('cpu', ready, w).backend, 'cpu');
  assert.equal(chooseAirBackend('auto', null, w).backend, 'cpu');
  assert.equal(chooseAirBackend('auto', ready, w).backend, 'gpu');
  assert.equal(chooseAirBackend('gpu', ready, w).backend, 'gpu');
  assert.equal(chooseAirBackend('auto', { status: 'pending' }, w).reason, 'waiting for the GPU');
  assert.match(chooseAirBackend('gpu', { status: 'unavailable', reason: 'no WebGPU here' }, w).reason, /no WebGPU/);
  assert.match(chooseAirBackend('auto', { status: 'lost', reason: 'GPU device lost' }, w).reason, /lost/);
  const g = new GpuAirSolver(ready);
  assert.equal(chooseAirBackend('auto', ready, w, g).backend, 'gpu');
  w.stirrers = [{ kind: 'hose' }];
  assert.match(chooseAirBackend('auto', ready, w, g).reason, /wind hoses/);
  w.stirrers = [{ kind: 'vortex' }];
  assert.equal(chooseAirBackend('auto', ready, w, g).backend, 'gpu');
  g.failed = 'boom';
  assert.match(chooseAirBackend('auto', ready, w, g).reason, /GPU failed: boom/);
  ready.device.limits.maxStorageBufferBindingSize = 1000;
  assert.match(new GpuAirSolver(ready).unsupported(w), /too large/);
});

test('no WebGPU: the context says so, the solver stays on the CPU with the same results', async () => {
  const ctx = createGpuContext();
  await initGpu(ctx, undefined);
  assert.equal(ctx.status, 'unavailable');
  const noAdapter = createGpuContext();
  await initGpu(noAdapter, { requestAdapter: async () => null });
  assert.equal(noAdapter.status, 'unavailable');
  const c = randomGrid();
  const cpu = cpuStep(c);
  const s = new AirSolver().configure('auto', ctx);
  s.step(c.w, c.W, c.D, c.dt, c.sim);
  assert.equal(s.active, 'cpu');
  assert.match(s.label, /CPU \(no WebGPU/);
  for (const k of FIELD_NAMES) assert.deepEqual(c.w[k], cpu[k], k); // bit for bit: the CPU path is unchanged
});

test('a failing or lost GPU falls back to the CPU; a late GPU step makes the thermal step wait, then the CPU take over', async () => {
  const c = randomGrid();
  const ctx = createEmulatedGpuContext();
  const s = new AirSolver().configure('gpu', ctx);
  s.step(c.w, c.W, c.D, c.dt, c.sim);
  assert.equal(s.active, 'gpu');
  assert.ok(s.busy && s.wait(0.05) && !s.wait(MAX_GPU_WAIT));
  // the CPU takes over a step while the GPU's is out: the GPU's result is dropped
  s.step(c.w, c.W, c.D, c.dt, c.sim);
  assert.equal(s.active, 'cpu');
  assert.equal(s.forced, 1);
  const after = snap(c.w, FIELD_NAMES);
  await s.flush();
  for (const k of FIELD_NAMES) assert.deepEqual(c.w[k], after[k], `${k}: the late GPU result is not merged`);
  // and next time everything goes up again
  assert.ok(s.gpu.mirrors.every((e) => !e.valid));
  // a GPU step that throws: CPU from then on
  s.gpu.step = () => {
    throw new Error('device hung');
  };
  s.step(c.w, c.W, c.D, c.dt, c.sim);
  assert.equal(s.active, 'cpu');
  assert.match(s.label, /GPU failed: device hung/);
  // device lost
  const s2 = new AirSolver().configure('auto', createEmulatedGpuContext());
  s2.step(c.w, c.W, c.D, c.dt, c.sim);
  await s2.flush();
  s2.ctx.status = 'lost';
  s2.ctx.reason = 'GPU device lost: reset';
  s2.step(c.w, c.W, c.D, c.dt, c.sim);
  assert.equal(s2.active, 'cpu');
  assert.match(s2.label, /lost/);
});

test('Simulation.step waits for the GPU (advance stops for the frame), at most MAX_GPU_WAIT', () => {
  const sim = createSimulation({ world: { size: [2, 1.4, 2], h: 0.05 }, weather: { ambient: 15 }, objects: [], noFire: true });
  assert.ok(sim.dt < MAX_GPU_WAIT);
  let busy = true;
  let ran = 0;
  sim.airSolver = { wait: (t) => busy && t < MAX_GPU_WAIT, step: () => ran++ };
  const t0 = sim.world.time;
  const done = sim.advance(1, 1e9);
  assert.ok(done < 0.2 && sim.world.time > t0, `advanced ${done} s then waited`);
  assert.equal(ran, 0);
  let waited = 0;
  while (ran === 0 && waited < 1) {
    sim.step(0.05);
    waited += 0.05;
  }
  assert.equal(ran, 1, 'past the wait the step goes ahead');
  assert.ok(waited <= MAX_GPU_WAIT + 1e-9, `went ahead after ${waited} s more`);
  busy = false;
  sim.step(0.05);
  assert.equal(ran, 2);
});

// --- the real WGSL on a real GPU, when node has WebGPU (npm i --no-save webgpu, or WEBGPU_MODULE)
async function nodeGpu() {
  const spec = process.env.WEBGPU_MODULE;
  try {
    const m = await import(spec ? pathToFileURL(join(isAbsolute(spec) ? spec : join(process.cwd(), spec), 'index.js')).href : 'webgpu');
    Object.assign(globalThis, m.globals);
    const ctx = createGpuContext();
    await initGpu(ctx, m.create([]));
    return ctx.status === 'ready' ? ctx : null;
  } catch {
    return null;
  }
}
const real = await nodeGpu();

test('real GPU: the WGSL kernels match the CPU air step', { skip: !real && 'no WebGPU in node (npm i --no-save webgpu)' }, async () => {
  // f32 throughout on the GPU (exp, sqrt, the divisions): looser than the emulation
  await solverMatchesCpu(real, burningHallway(), { rtol: 2e-4, srel: 1e-5 });
  await solverMatchesCpu(real, randomGrid({ rain: 0.4 }), { rtol: 2e-4, srel: 1e-5 });
  await solverMatchesCpu(real, randomGrid({ vacuum: true, asleep: false, fog: 0.8 }), { rtol: 2e-4, srel: 1e-5 });
});

test('real GPU: a whole simulation runs with the air on the GPU', { skip: !real && 'no WebGPU in node' }, async () => {
  const sim = createSimulation({
    world: { size: [8, 3.6, 4], h: 0.1 },
    weather: { ambient: 18 },
    objects: [{ type: 'hallway', params: { length: 6 }, x: 4.5, z: 2 }],
    fireStarts: [{ p: [4, 0.3, 2], radius: 0.4, power: 30000 }],
  });
  sim.airSolver.configure('gpu', real);
  while (sim.world.time < 10) {
    sim.step(0.1);
    await sim.airSolver.flush();
  }
  assert.equal(sim.airSolver.active, 'gpu', sim.airSolver.label);
  assert.equal(sim.airSolver.cpuSteps, 0);
  assert.ok(Math.max(...sim.world.airT) > 200 && sim.stats.burning > 0);
});

test.after(() => real?.device?.destroy?.());
