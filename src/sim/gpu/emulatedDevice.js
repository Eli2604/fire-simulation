/**
 * A stand-in for a WebGPU device that runs the air kernels' JS emulation (sim/gpu/airEmulation.js)
 * where the GPU would run the WGSL: buffers are ArrayBuffers, a dispatch calls the emulated
 * kernel named by the pipeline's entry point on the views its bind groups give, readbacks map at
 * once (on the next microtask).
 *
 * Only what sim/gpu/gpuAir.js uses. With it the whole host side of the GPU path (buffer sizes
 * and offsets, the upload of what changed, the order of the dispatches, the blur passes'
 * uniforms, the readback and the merge with the CPU's edits) runs in node, in the tests and
 * headless (createEmulatedGpuContext), against the CPU solver.
 */

import { unpackParams, PARAM_BYTES } from './airLayout.js';
import { emuVelocity, emuAdvect, emuMixHeat, emuRadiationPass } from './airEmulation.js';
import { WORKGROUP } from './airKernels.js';

const KERNELS = {
  velocity: (P, b) => emuVelocity(P, b),
  advect: (P, b) => emuAdvect(P, b),
  mixHeat: (P, b) => emuMixHeat(P, b),
  radiation: (P, b, pass) => emuRadiationPass(P, b, pass),
};
const GROUP0 = ['params', 'fields', 'tmp', 'geom', 'src', 'rad', 'tables'];

class EmuBuffer {
  constructor({ size, usage, label }) {
    this.size = size;
    this.usage = usage;
    this.label = label;
    this.data = new ArrayBuffer(size);
    this.destroyed = false;
    this.mapped = false;
  }
  mapAsync() {
    if (this.destroyed) return Promise.reject(new Error('buffer destroyed'));
    return Promise.resolve().then(() => {
      this.mapped = true;
    });
  }
  getMappedRange() {
    if (!this.mapped) throw new Error('not mapped');
    return this.data;
  }
  unmap() {
    this.mapped = false;
  }
  destroy() {
    this.destroyed = true;
  }
}

export class EmulatedDevice {
  constructor() {
    this.limits = { maxStorageBufferBindingSize: 2 ** 31 - 4, maxBufferSize: 2 ** 31 - 4 };
    this.dispatches = []; // { entryPoint, x, y } of the last submit (tests)
    this.lost = new Promise(() => {});
    const dev = this;
    this.queue = {
      writeBuffer(buf, offset, data, dataOffset = 0, size) {
        const view = ArrayBuffer.isView(data) ? data : new Uint8Array(data);
        const el = view.BYTES_PER_ELEMENT ?? 1;
        const n = size ?? view.length - dataOffset;
        const bytes = new Uint8Array(view.buffer, view.byteOffset + dataOffset * el, n * el);
        if (offset + bytes.length > buf.size) throw new Error(`writeBuffer past the end of ${buf.label}`);
        new Uint8Array(buf.data, offset, bytes.length).set(bytes);
      },
      submit(cmds) {
        dev.dispatches = [];
        for (const ops of cmds) for (const op of ops) dev.run(op);
      },
    };
  }
  createBuffer(desc) {
    return new EmuBuffer(desc);
  }
  createBindGroupLayout(d) {
    return d;
  }
  createPipelineLayout(d) {
    return d;
  }
  createShaderModule(d) {
    return d;
  }
  createComputePipeline(d) {
    if (!KERNELS[d.compute.entryPoint]) throw new Error(`no kernel ${d.compute.entryPoint}`);
    return { entryPoint: d.compute.entryPoint };
  }
  createBindGroup(d) {
    return d;
  }
  pushErrorScope() {}
  popErrorScope() {
    return Promise.resolve(null);
  }
  createCommandEncoder() {
    const ops = [];
    return {
      beginComputePass() {
        const groups = [];
        let pipeline = null;
        return {
          setPipeline: (p) => (pipeline = p),
          setBindGroup: (i, g) => (groups[i] = g),
          dispatchWorkgroups: (x, y = 1) => ops.push({ kind: 'dispatch', pipeline, groups: groups.slice(), x, y }),
          end() {},
        };
      },
      copyBufferToBuffer: (src, so, dst, d0, size) => ops.push({ kind: 'copy', src, so, dst, d0, size }),
      finish: () => ops,
    };
  }

  run(op) {
    if (op.kind === 'copy') {
      new Uint8Array(op.dst.data, op.d0, op.size).set(new Uint8Array(op.src.data, op.so, op.size));
      return;
    }
    const views = {};
    for (const e of op.groups[0].entries) {
      const { buffer, offset = 0, size } = e.resource;
      views[GROUP0[e.binding]] = { buffer, offset, size: size ?? buffer.size - offset };
    }
    const P = unpackParams(views.params.buffer.data.slice(views.params.offset, views.params.offset + PARAM_BYTES));
    if (op.x * op.y * WORKGROUP < P.na) throw new Error(`dispatch ${op.x}x${op.y} does not cover ${P.na} cells`);
    const f32 = (k) => new Float32Array(views[k].buffer.data, views[k].offset, views[k].size / 4);
    const b = { fields: f32('fields'), tmp: f32('tmp'), geom: f32('geom'), src: f32('src'), rad: f32('rad'), tables: f32('tables') };
    let pass = null;
    if (op.groups[1]) {
      const r = op.groups[1].entries[0].resource;
      const u = new Uint32Array(r.buffer.data, r.offset ?? 0, 4);
      pass = { axis: u[0], from: u[1], to: u[2], mode: u[3] };
    }
    const ep = op.pipeline.entryPoint;
    this.dispatches.push({ entryPoint: ep, x: op.x, y: op.y, pass });
    KERNELS[ep](P, b, pass);
  }
}

/** A ready GPU context (sim/gpu/gpuContext.js) whose device is the emulation. */
export function createEmulatedGpuContext() {
  return { status: 'ready', device: new EmulatedDevice(), info: { vendor: 'emulated' }, label: 'JS emulation', reason: '', promise: null };
}
