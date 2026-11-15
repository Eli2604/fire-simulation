/**
 * Solver backends for the grid solvers: where the air model (sim/air.js stepAir + the
 * radiation blur) runs.
 *
 *   CPU: the reference, sim/air.js as it is (headless runs, the tests, browsers without WebGPU).
 *   GPU: WebGPU compute (sim/gpu/gpuAir.js), the same math in WGSL, data resident on the GPU.
 *
 * Every Simulation has an AirSolver; it is on the CPU unless the app opts it in
 * (sim.airSolver.configure('auto' | 'gpu', ctx)): main.js does for the scene being played, from
 * the Simulation menu's setting. Per step it picks the backend (chooseAirBackend): the GPU when
 * asked for and ready and the world has nothing the GPU kernels do not model, else the CPU.
 * Device loss or a failed GPU step falls back to the CPU for good (the reason is shown).
 */

import { stepAir, blurRadiation } from './air.js';
import { GpuAirSolver } from './gpu/gpuAir.js';

export const AIR_BACKEND_MODES = { 'Auto (GPU when available)': 'auto', 'CPU': 'cpu', 'GPU (WebGPU)': 'gpu' };

/** A thermal step may wait this long (s of simulated time) for the GPU's previous step to come back. */
export const MAX_GPU_WAIT = 0.2;

/**
 * Which backend runs: { backend: 'cpu' | 'gpu', reason } for a mode ('auto' | 'cpu' | 'gpu'),
 * a GPU context (sim/gpu/gpuContext.js, or null), the World, and the GPU solver so far (its
 * failure, its view of the World).
 */
export function chooseAirBackend(mode, ctx, w, gpu = null) {
  if (mode !== 'auto' && mode !== 'gpu') return { backend: 'cpu', reason: 'CPU selected' };
  if (!ctx) return { backend: 'cpu', reason: 'no WebGPU' };
  if (ctx.status === 'pending' || ctx.status === 'idle') return { backend: 'cpu', reason: 'waiting for the GPU' };
  if (ctx.status !== 'ready') return { backend: 'cpu', reason: ctx.reason || 'no WebGPU' };
  if (gpu?.failed) return { backend: 'cpu', reason: `GPU failed: ${gpu.failed}` };
  const why = gpu?.unsupported(w);
  if (why) return { backend: 'cpu', reason: why };
  return { backend: 'gpu', reason: '' };
}

export class AirSolver {
  constructor() {
    this.mode = 'cpu';
    this.ctx = null;
    this.gpu = null;
    this.active = 'cpu'; // what ran the last step
    this.reason = 'CPU selected';
    this.cpuSteps = 0;
    this.gpuSteps = 0;
    this.forced = 0; // steps the CPU took over because the GPU's did not come back in time
  }

  /** mode: 'auto' | 'cpu' | 'gpu'; ctx: the GPU context (sim/gpu/gpuContext.js). */
  configure(mode, ctx = this.ctx) {
    this.mode = mode;
    this.ctx = ctx;
    return this;
  }

  /** A step is in flight on the GPU. */
  get busy() {
    return !!this.gpu?.busy;
  }

  /**
   * Should a thermal step that is due wait (the GPU's last step not back yet, `waited` s of
   * simulated time so far)? Past MAX_GPU_WAIT it goes ahead on the CPU (Simulation.step).
   */
  wait(waited) {
    return this.busy && waited < MAX_GPU_WAIT;
  }

  step(w, W, D, dt, sim) {
    if (this.mode !== 'cpu' && this.ctx?.status === 'ready' && !this.gpu) this.gpu = new GpuAirSolver(this.ctx);
    if (this.gpu && this.ctx?.status !== 'ready' && !this.gpu.failed) this.gpu.failed = this.ctx?.reason || 'GPU lost';
    const pick = chooseAirBackend(this.mode, this.ctx, w, this.gpu);
    this.reason = pick.reason;
    if (pick.backend === 'gpu' && !this.gpu.busy) {
      try {
        this.gpu.step(w, W, D, dt, sim);
        this.active = 'gpu';
        this.gpuSteps++;
        return;
      } catch (e) {
        this.gpu.failed = e?.message ?? String(e);
        this.reason = `GPU failed: ${this.gpu.failed}`;
      }
    }
    if (this.gpu?.busy) {
      // (the GPU's step did not come back in time: the CPU's stands, the GPU's is dropped)
      this.gpu.abandon();
      this.forced++;
    }
    stepAir(w, W, D, dt, sim);
    blurRadiation(w, sim.radGain);
    this.active = 'cpu';
    this.cpuSteps++;
  }

  /** Resolves when nothing is in flight (tests, headless GPU runs). */
  flush() {
    return this.gpu?.flush() ?? Promise.resolve();
  }

  /** What runs the air, for the menu / HUD: e.g. 'GPU (intel gen-12lp)' or 'CPU (no WebGPU)'. */
  get label() {
    if (this.active === 'gpu') return `GPU (${this.ctx?.label || 'WebGPU'})`;
    return this.reason && this.reason !== 'CPU selected' ? `CPU (${this.reason})` : 'CPU';
  }

  /** Free GPU memory (a frozen zone, a scene replaced). */
  release() {
    this.gpu?.release();
  }
}
