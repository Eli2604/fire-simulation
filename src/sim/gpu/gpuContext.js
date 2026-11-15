/**
 * Getting a WebGPU device (feature detection): navigator.gpu, an adapter, a device with the
 * large storage buffers the air grid needs. Once per page (sharedGpu), or one per caller
 * (createGpuContext: the tests, with the `webgpu` package's GPU in node).
 *
 * A context: { status: 'idle' | 'pending' | 'ready' | 'unavailable' | 'lost', device, info,
 * label, reason, promise }. Device loss sets status 'lost' (the solvers then fall back to the
 * CPU: sim/solverBackend.js).
 */

export function createGpuContext() {
  return { status: 'idle', device: null, info: null, label: '', reason: '', promise: null };
}

/** Ask for a device (once): resolves to the context, ready or with the reason it is not. */
export function initGpu(ctx, gpu = globalThis.navigator?.gpu) {
  if (ctx.promise) return ctx.promise;
  if (!gpu) {
    ctx.status = 'unavailable';
    ctx.reason = 'no WebGPU here (navigator.gpu missing)';
    return (ctx.promise = Promise.resolve(ctx));
  }
  ctx.status = 'pending';
  ctx.promise = (async () => {
    try {
      const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) {
        ctx.status = 'unavailable';
        ctx.reason = 'WebGPU without a GPU adapter';
        return ctx;
      }
      // the air grid of a big scene in one storage buffer: ask for as much as the adapter has
      const requiredLimits = {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
      };
      const device = await adapter.requestDevice({ requiredLimits });
      const info = adapter.info ?? {};
      ctx.device = device;
      ctx.info = info;
      ctx.label = [info.vendor, info.architecture || info.device, info.description].filter(Boolean).join(' ').trim() || 'GPU';
      ctx.status = 'ready';
      device.lost?.then((l) => {
        if (ctx.device !== device) return;
        ctx.status = 'lost';
        ctx.reason = `GPU device lost${l?.message ? ': ' + l.message : ''}`;
        ctx.device = null;
      });
    } catch (e) {
      ctx.status = 'unavailable';
      ctx.reason = `WebGPU failed: ${e?.message ?? e}`;
    }
    return ctx;
  })();
  return ctx.promise;
}

let shared = null;
/** The page's GPU context (created on first use; initGpu(sharedGpu()) asks for the device). */
export function sharedGpu() {
  return (shared ??= createGpuContext());
}
