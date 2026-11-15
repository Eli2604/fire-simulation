/**
 * The air model on the GPU (WebGPU compute): sim/air.js stepAir + blurRadiation as the kernels
 * of sim/gpu/airKernels.js, on GPU-resident buffers (sim/gpu/airLayout.js).
 *
 * The rest of the simulation (the solids, combustion, water, the AI, the renderer) stays on the
 * CPU and keeps reading and writing the World's air arrays. The two copies are kept in step:
 *
 *  - before a step, only what the CPU changed since the GPU last saw it goes up: each mirrored
 *    array is compared, in blocks, with a shadow of the GPU's copy, and the blocks that differ
 *    are written (the sources the solids put into the air, the cells the heaters, the water,
 *    combustion touched; the geometry when walls change). The velocities are never uploaded
 *    (the step recomputes them from scratch).
 *  - after the step, the fields the CPU logic reads (gas temperature, smoke, steam, burning
 *    gas, powder, oxygen, flames, velocities, radiation) come back asynchronously (mapAsync).
 *    Changes the CPU made while the step was in flight (a projectile's smoke, a burst of steam)
 *    are added on top of the GPU's result, not lost.
 *  - while a step is in flight the next thermal step waits (Simulation.step: the CPU-side
 *    world sees the air one step late, at most ~0.2 s), so the CPU and GPU never both own it.
 *
 * Then, as after the CPU step: the closed rooms' oxygen inventory (sim/oxygen.js conserveO2)
 * and the smoke / steam totals.
 */

import { AIR_WGSL, RAD_PASSES, dispatchSize, WORKGROUP } from './airKernels.js';
import { N_FIELDS, N_ADVECTED, GEOM_LEN, N_SRC, N_RAD, F, PARAM_BYTES, tableOffsets, airStepParams, packParams, mirrorPlan } from './airLayout.js';
import { windShelter } from '../air.js';
import { conserveO2 } from '../oxygen.js';

const BLOCK = 4096; // cells compared / uploaded together (a multiple of 8)

/**
 * Views to compare an array with its shadow 8 bytes at a time (2 floats, 8 flags per compare:
 * the scan over every mirrored array each step is most of the host-side cost). Bit patterns are
 * compared as doubles: a NaN pattern counts as changed (uploaded again: harmless).
 */
function compareViews(e, a, shadow) {
  const per = 8 / a.BYTES_PER_ELEMENT;
  const n64 = Math.floor(a.length / per);
  e.per = per;
  e.n64 = n64;
  e.wa = a.byteOffset % 8 === 0 ? new Float64Array(a.buffer, a.byteOffset, n64) : null;
  e.ws = new Float64Array(shadow.buffer, 0, n64);
  // (element-wise, for the tail and unaligned arrays: the bits of floats, the flags as they are)
  e.cmpA = a instanceof Float32Array ? new Uint32Array(a.buffer, a.byteOffset, a.length) : a;
  e.cmpB = a instanceof Float32Array ? new Uint32Array(shadow.buffer) : shadow;
}

/** Elements b0..b1 (b0 a multiple of 8) the same as in the shadow. */
function same(e, b0, b1) {
  let i = b0;
  if (e.wa) {
    const A = e.wa;
    const S = e.ws;
    const h1 = Math.min(e.n64, Math.floor(b1 / e.per));
    for (let h = b0 / e.per; h < h1; h++) if (A[h] !== S[h]) return false;
    i = h1 * e.per;
  }
  const A = e.cmpA;
  const S = e.cmpB;
  for (; i < b1; i++) if (A[i] !== S[i]) return false;
  return true;
}
// (the WebGPU constants: the browser's, or their values from the spec where there are none)
const U = () => globalThis.GPUBufferUsage ?? { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128 };
const COMPUTE = () => globalThis.GPUShaderStage?.COMPUTE ?? 4;
const MAP_READ = () => globalThis.GPUMapMode?.READ ?? 1;

/** Bytes of GPU memory the air grid of NA cells takes (the buffers below). */
export function gpuAirBytes(NA) {
  return 4 * NA * (N_FIELDS + N_ADVECTED + (GEOM_LEN(1)) + N_SRC + N_RAD + N_FIELDS + 1);
}

export class GpuAirSolver {
  /** ctx: a ready context (sim/gpu/gpuContext.js). */
  constructor(ctx) {
    this.ctx = ctx;
    this.device = ctx.device;
    this.NA = 0;
    this.pending = null; // the readback in flight
    this.discard = false; // the CPU stepped the air meanwhile: drop what comes back
    this.failed = null; // reason the GPU path gave up
    this.steps = 0;
    this.velocityEvery = 1; // read the velocities back every n-th step (they only feed convection and drift)
    this.stats = { uploadMs: 0, uploadKB: 0, mergeMs: 0, roundTripMs: 0 };
    this.mirrors = null;
  }

  get busy() {
    return !!this.pending;
  }

  /** Why this World can not run on the GPU (null: it can). */
  unsupported(w) {
    if (w.stirrers?.some((s) => s.kind !== 'vortex')) return 'wind hoses / jets in the air (CPU only)';
    const lim = this.device.limits;
    const big = 4 * w.NA * Math.max(N_FIELDS, GEOM_LEN(1));
    if (big > lim.maxStorageBufferBindingSize || big > lim.maxBufferSize) return `air grid too large for this GPU (${(big / 2 ** 20).toFixed(0)} MB buffer)`;
    return null;
  }

  /** The buffers, pipelines and bind groups for a grid of w.NA cells. */
  alloc(w) {
    this.release();
    const d = this.device;
    const NA = w.NA;
    const u = U();
    const buf = (size, usage, label) => d.createBuffer({ size: Math.max(16, size), usage, label });
    const st = u.STORAGE | u.COPY_DST;
    this.buffers = {
      params: buf(PARAM_BYTES, u.UNIFORM | u.COPY_DST, 'air params'),
      fields: buf(4 * N_FIELDS * NA, st | u.COPY_SRC, 'air fields'),
      tmp: buf(4 * N_ADVECTED * NA, u.STORAGE, 'air tmp'),
      geom: buf(4 * GEOM_LEN(NA), st, 'air geom'),
      src: buf(4 * N_SRC * NA, st, 'air sources'),
      rad: buf(4 * N_RAD * NA, u.STORAGE | u.COPY_SRC, 'radiation'),
      tables: buf(4 * tableOffsets(w.anx, w.any, w.anz).length, st, 'air tables'),
      blur: buf(256 * RAD_PASSES.length, u.UNIFORM | u.COPY_DST, 'blur passes'),
      readback: buf(4 * (N_FIELDS + 1) * NA, u.MAP_READ | u.COPY_DST, 'air readback'),
    };
    const B = this.buffers;
    const blurData = new Uint32Array(64 * RAD_PASSES.length);
    RAD_PASSES.forEach((p, i) => blurData.set([p.axis, p.from, p.to, p.mode], i * 64));
    d.queue.writeBuffer(B.blur, 0, blurData);
    const C = COMPUTE();
    const entry = (binding, type) => ({ binding, visibility: C, buffer: { type } });
    const bgl0 = d.createBindGroupLayout({
      entries: [entry(0, 'uniform'), entry(1, 'storage'), entry(2, 'storage'), entry(3, 'read-only-storage'), entry(4, 'read-only-storage'), entry(5, 'storage'), entry(6, 'read-only-storage')],
    });
    const bgl1 = d.createBindGroupLayout({ entries: [entry(0, 'uniform')] });
    const layout = d.createPipelineLayout({ bindGroupLayouts: [bgl0, bgl1] });
    const module = d.createShaderModule({ code: AIR_WGSL, label: 'air kernels' });
    const pipe = (entryPoint) => d.createComputePipeline({ layout, compute: { module, entryPoint }, label: entryPoint });
    this.pipelines = { velocity: pipe('velocity'), advect: pipe('advect'), mixHeat: pipe('mixHeat'), radiation: pipe('radiation') };
    const order = ['params', 'fields', 'tmp', 'geom', 'src', 'rad', 'tables'];
    this.group0 = d.createBindGroup({ layout: bgl0, entries: order.map((k, i) => ({ binding: i, resource: { buffer: B[k] } })) });
    this.blurGroups = RAD_PASSES.map((_, i) => d.createBindGroup({ layout: bgl1, entries: [{ binding: 0, resource: { buffer: B.blur, offset: i * 256, size: 16 } }] }));
    this.NA = NA;
    this.world = w;
    this.tablesCpu = new Float32Array(tableOffsets(w.anx, w.any, w.anz).length);
    this.paramBuf = new ArrayBuffer(PARAM_BYTES);
    this.mirrors = mirrorPlan(w).map((m) => ({ m, src: null, shadow: null, cmpA: null, cmpB: null, f32: null, valid: false, wasNull: true }));
    this.dispatch = dispatchSize(NA);
  }

  /** Upload what changed: returns bytes written. */
  upload(w) {
    const q = this.device.queue;
    let bytes = 0;
    for (const e of this.mirrors) {
      const { m } = e;
      if (!m.up) continue;
      const gpuBuf = this.buffers[m.buf];
      const a = m.get(w);
      if (!a) {
        // (no such array now: zeros on the GPU, as the buffers start)
        if (!e.wasNull) {
          q.writeBuffer(gpuBuf, 4 * m.offset, new Float32Array(m.len));
          bytes += 4 * m.len;
        }
        e.wasNull = true;
        e.valid = false;
        e.src = null;
        continue;
      }
      e.wasNull = false;
      if (e.src !== a || a.length !== m.len) {
        // a new array (or the first step): all of it, and a shadow to compare with from now on
        e.src = a;
        e.shadow = new a.constructor(m.len);
        compareViews(e, a, e.shadow);
        e.f32 = a instanceof Float32Array ? null : new Float32Array(m.len);
        e.valid = false;
      }
      if (!e.valid) {
        bytes += this.write(e, gpuBuf, 0, m.len);
        e.valid = true;
        continue;
      }
      let run = -1;
      for (let b0 = 0; b0 < m.len; b0 += BLOCK) {
        const b1 = Math.min(m.len, b0 + BLOCK);
        if (!same(e, b0, b1)) {
          if (run < 0) run = b0;
        } else if (run >= 0) {
          bytes += this.write(e, gpuBuf, run, b0);
          run = -1;
        }
      }
      if (run >= 0) bytes += this.write(e, gpuBuf, run, m.len);
    }
    return bytes;
  }

  write(e, gpuBuf, i0, i1) {
    const { m, src, shadow } = e;
    const n = i1 - i0;
    shadow.set(src.subarray(i0, i1), i0);
    let data = src;
    if (e.f32) {
      for (let i = i0; i < i1; i++) e.f32[i] = src[i];
      data = e.f32;
    }
    this.device.queue.writeBuffer(gpuBuf, 4 * (m.offset + i0), data, i0, n);
    return 4 * n;
  }

  /**
   * One air step (dt s) on the GPU. Returns at once; the results land in the World's arrays
   * when the readback completes (this.pending resolves).
   */
  step(w, W, D, dt, sim) {
    if (this.pending) throw new Error('GPU air step while one is in flight');
    const d = this.device;
    const check = !this.checked;
    if (check) {
      // (the first step: shader compilation, pipelines, buffers; errors make it fall back)
      d.pushErrorScope('out-of-memory');
      d.pushErrorScope('validation');
    }
    if (this.NA !== w.NA || this.world !== w) this.alloc(w);
    const t0 = performance.now();
    windShelter(w); // (cached; recomputed when walls, doors, windows change)
    const P = airStepParams(w, W, D, dt, this.tablesCpu);
    const q = d.queue;
    q.writeBuffer(this.buffers.params, 0, packParams(P, this.paramBuf));
    q.writeBuffer(this.buffers.tables, 0, this.tablesCpu);
    const bytes = this.upload(w);
    const t1 = performance.now();
    const enc = d.createCommandEncoder({ label: 'air step' });
    const pass = enc.beginComputePass({ label: 'air' });
    pass.setBindGroup(0, this.group0);
    pass.setBindGroup(1, this.blurGroups[0]);
    const [gx, gy] = this.dispatch;
    for (const k of ['velocity', 'advect', 'mixHeat']) {
      pass.setPipeline(this.pipelines[k]);
      pass.dispatchWorkgroups(gx, gy);
    }
    pass.setPipeline(this.pipelines.radiation);
    for (let i = 0; i < RAD_PASSES.length; i++) {
      pass.setBindGroup(1, this.blurGroups[i]);
      pass.dispatchWorkgroups(gx, gy);
    }
    pass.end();
    const NA = this.NA;
    const vel = this.steps % this.velocityEvery === 0;
    const nf = vel ? N_FIELDS : F.VX; // (the velocities last in FIELDS)
    const RB = this.buffers.readback;
    enc.copyBufferToBuffer(this.buffers.fields, 0, RB, 0, 4 * nf * NA);
    enc.copyBufferToBuffer(this.buffers.rad, 0, RB, 4 * N_FIELDS * NA, 4 * NA);
    q.submit([enc.finish()]);
    let scope = null;
    if (check) {
      this.checked = true;
      const v = d.popErrorScope();
      const o = d.popErrorScope();
      scope = Promise.all([v, o]).then(([a, b]) => a ?? b);
    }
    this.steps++;
    this.discard = false;
    this.sim = sim;
    this.stats.uploadMs = t1 - t0;
    this.stats.uploadKB = bytes / 1024;
    const sent = performance.now();
    this.pending = Promise.all([RB.mapAsync(MAP_READ()), scope])
      .then(([, err]) => {
        if (err) throw new Error(`WGSL validation: ${err.message}`);
        if (this.discard || this.world !== w) {
          // the CPU stepped the air while this was in flight: its result stands; send all again
          for (const e of this.mirrors) e.valid = false;
        } else {
          const m0 = performance.now();
          this.merge(w, new Float32Array(RB.getMappedRange()), vel);
          this.after(w, sim);
          this.stats.mergeMs = performance.now() - m0;
        }
        RB.unmap();
        this.stats.roundTripMs = performance.now() - sent;
      })
      .catch((e) => {
        this.failed = e?.message ?? String(e);
        try {
          RB.unmap();
        } catch {
          /* (lost) */
        }
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  /** The step's results into the World's arrays (adding what the CPU did to them meanwhile). */
  merge(w, data, vel) {
    const NA = this.NA;
    for (const e of this.mirrors) {
      const { m } = e;
      if (!m.down) continue;
      if (!vel && m.offset >= F.VX * NA && m.buf === 'fields') continue;
      const cpu = m.get(w);
      const off = m.buf === 'rad' ? N_FIELDS * NA : m.offset;
      const g = data.subarray(off, off + m.len);
      if (!m.up || !e.valid || e.src !== cpu) {
        cpu.set(g);
        continue;
      }
      const S = e.shadow;
      for (let b0 = 0; b0 < m.len; b0 += BLOCK) {
        const b1 = Math.min(m.len, b0 + BLOCK);
        if (same(e, b0, b1)) cpu.set(g.subarray(b0, b1), b0);
        else for (let j = b0; j < b1; j++) cpu[j] = g[j] + (cpu[j] - S[j]); // edited meanwhile: on top
        S.set(g.subarray(b0, b1), b0);
      }
    }
  }

  /** What follows the air step on the CPU: closed rooms' oxygen, the totals. */
  after(w, sim) {
    conserveO2(w);
    w.radFieldZero = false;
    let smoke = 0;
    let steam = 0;
    const { smoke: s, steam: st, NA } = w;
    for (let a = 0; a < NA; a++) {
      smoke += s[a];
      steam += st[a];
    }
    if (sim) {
      sim.stats.smoke = smoke;
      sim.stats.steam = steam;
    }
  }

  /** The CPU is stepping the air while a GPU step is in flight: drop the GPU's result. */
  abandon() {
    if (this.pending) this.discard = true;
  }

  /** Resolves when no step is in flight. */
  flush() {
    return this.pending ?? Promise.resolve();
  }

  /** Free the GPU memory (a zone frozen, the scene gone); alloc() again on the next step. */
  release() {
    const bufs = this.buffers;
    const free = () => bufs && Object.values(bufs).forEach((b) => b.destroy?.());
    // (a step in flight: its readback buffer is still mapped; free once it is done)
    if (this.pending) this.pending.then(free);
    else free();
    this.buffers = null;
    this.NA = 0;
    this.world = null;
  }
}

export { WORKGROUP };
