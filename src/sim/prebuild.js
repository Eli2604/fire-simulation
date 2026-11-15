import { World } from './world.js';
import { buildWorld } from './createSimulation.js';

/**
 * Places of a world built ahead, in the background: the scenery of a place you have not been to
 * yet (the island seen from the flight deck) is drawn from its real world (render/scenery.js),
 * not a placeholder. Built as createSimulation builds it (createSimulation.js: buildWorld), in a
 * worker (sim/prebuild.worker.js) so the page never waits for it, one at a time, the biggest on
 * the screen first; never simulated. Going there later takes the same world (`take`): entering
 * is quicker too, and what you saw is what you find.
 *
 * A world is its simulation's arrays (the island ~170 MB, the lake house's ~340 MB): at most
 * `maxBytes` are kept built ahead; the one not asked for the longest goes first (asked for: big
 * enough on the screen, main.js: updateProxies). Places too small on the screen for more than
 * their stand-in are not built at all.
 *
 * Without workers (tests, a page that cannot start one) it builds on the main thread, one place
 * per idle moment.
 */
export class Prebuild {
  constructor({ makeWorker = defaultWorker, delay = 1.5 } = {}) {
    this.makeWorker = makeWorker;
    this.delay = delay; // s after a (re)load before the first build: the first interaction comes first
    this.gen = 0;
    this.built = new Map(); // name -> { sig, built: { world, ignitions, spawn } }
    this.wanted = new Map(); // name -> { desc, sig, priority }
    this.busy = null; // { name, sig, gen }
    this.since = now();
    this.worker = undefined; // (made on first use; null: none to be had)
    this.onReady = null; // (name) => …: a place's world has arrived
    this.stats = { builds: 0, ms: 0, last: null, bytes: 0, evicted: 0 };
    this.maxBytes = 600e6;
    this.keep = 20; // s a built world asked for is safe from eviction
  }

  /** A new scene, or a restart: forget what was built (a build under way is dropped when it comes). */
  reset() {
    this.gen++;
    this.built.clear();
    this.wanted.clear();
    this.busy = null;
    this.since = now();
  }

  /** The world built for place `name` (not yet taken), or null. */
  world(name) {
    return this.built.get(name)?.built.world ?? null;
  }

  has(name) {
    return this.built.has(name) || this.busy?.name === name;
  }

  /** Bytes of the worlds kept built ahead. */
  bytes() {
    let b = 0;
    for (const e of this.built.values()) b += e.bytes;
    return b;
  }

  /**
   * Make room for `need` more bytes: the worlds not asked for the longest go first (none asked
   * for in the last `keep` s). Whether there is room now.
   */
  makeRoom(need) {
    const t = now();
    const old = [...this.built].filter(([, e]) => t - e.seen > this.keep).sort((a, b) => a[1].seen - b[1].seen);
    while (this.bytes() + need > this.maxBytes && old.length) {
      this.built.delete(old.shift()[0]);
      this.stats.evicted++;
    }
    this.stats.bytes = this.bytes();
    return this.bytes() + need <= this.maxBytes;
  }

  /**
   * Ask for place `name` to be built from `desc` (what createSimulation is given for it), the
   * biggest `priority` (its size on the screen) first. Asking again updates the priority.
   */
  want(name, desc, priority = 0) {
    const b = this.built.get(name);
    if (b) b.seen = now(); // (still wanted: kept)
    if (this.has(name)) return;
    const sig = signature(desc);
    this.wanted.set(name, { desc, sig, priority });
    this.pump();
  }

  /** Not wanted any more (gone from the view before its turn). */
  drop(name) {
    this.wanted.delete(name);
  }

  /**
   * The built world of place `name` if it was built from the same description (it becomes the
   * zone's own: createSimulation(desc, taken)), else null.
   */
  take(name, desc) {
    const b = this.built.get(name);
    this.wanted.delete(name);
    if (!b) return null;
    this.built.delete(name);
    return b.sig === signature(desc) ? b.built : null;
  }

  /** Start the next build, if none is under way and the page has had its moment. */
  pump() {
    if (this.busy || !this.wanted.size || now() - this.since < this.delay) return;
    let best = null;
    for (const [name, q] of this.wanted) if (!best || q.priority > best[1].priority) best = [name, q];
    const [name, q] = best;
    // (room for it: about as big as its grid: ~120 bytes a voxel)
    const [sx, sy, sz] = q.desc.world?.size ?? [0, 0, 0];
    const h = q.desc.world?.h ?? 1;
    if (!this.makeRoom(120 * (sx / h) * (sy / h) * (sz / h))) return;
    this.wanted.delete(name);
    const job = { name, sig: q.sig, gen: this.gen, t0: now() };
    this.busy = job;
    if (this.worker === undefined) {
      try {
        this.worker = this.makeWorker?.() ?? null;
      } catch {
        this.worker = null;
      }
      if (this.worker) {
        this.worker.onmessage = (e) => this.arrived(e.data);
        // (a worker that cannot load: build here instead)
        this.worker.onerror = (e) => {
          e.preventDefault?.();
          this.worker = null;
          const b = this.busy;
          this.busy = null;
          if (b) this.wanted.set(b.name, { desc: b.desc, sig: b.sig, priority: 0 });
          this.pump();
        };
      }
    }
    job.desc = q.desc;
    if (this.worker) {
      job.id = (this.nextId = (this.nextId ?? 0) + 1);
      try {
        this.worker.postMessage({ id: job.id, desc: q.desc });
        return;
      } catch {
        // (a description that cannot be sent: build here)
      }
    }
    idle(() => {
      if (this.busy !== job) return;
      try {
        this.done(job, buildWorld(q.desc));
      } catch (err) {
        console.warn('prebuild', name, err);
        this.busy = null;
      }
    });
  }

  arrived(msg) {
    const job = this.busy;
    if (!job || msg.id !== job.id) return; // (one from before a reset)
    if (msg.error) {
      console.warn('prebuild', job.name, msg.error);
      this.busy = null;
      return this.pump();
    }
    this.done(job, unpackBuilt(msg));
  }

  done(job, built) {
    this.busy = null;
    if (job.gen === this.gen) {
      let bytes = 0;
      const bufs = new Set();
      for (const v of Object.values(built.world)) if (ArrayBuffer.isView(v) && !bufs.has(v.buffer)) bufs.add(v.buffer) && (bytes += v.buffer.byteLength);
      this.built.set(job.name, { sig: job.sig, built, bytes, seen: now() });
      this.stats.bytes = this.bytes();
      this.stats.builds++;
      this.stats.last = { name: job.name, ms: Math.round(now() - job.t0) };
      this.stats.ms += now() - job.t0;
      this.onReady?.(job.name);
    }
    this.pump();
  }
}

/** A built world as a message: its typed arrays transferred, the rest copied. */
export function packBuilt({ world, ignitions, spawn }) {
  const transfer = new Set();
  for (const v of Object.values(world)) if (ArrayBuffer.isView(v) && v.buffer.byteLength) transfer.add(v.buffer);
  return { msg: { world, ignitions, spawn }, transfer: [...transfer] };
}

/** A built world back from a message: a World again. */
export function unpackBuilt(msg) {
  Object.setPrototypeOf(msg.world, World.prototype);
  return { world: msg.world, ignitions: msg.ignitions, spawn: msg.spawn };
}

/**
 * What a build depends on: the description, of its weather only the air temperature it starts
 * at (models/voxelizer.js), to the degree (the weather drifting meanwhile does not undo it).
 */
function signature(desc) {
  try {
    return JSON.stringify({ ...desc, weather: Math.round(desc.weather?.ambient ?? 15) });
  } catch {
    return String(Math.random());
  }
}

function defaultWorker() {
  if (typeof Worker === 'undefined') return null;
  return new Worker(new URL('./prebuild.worker.js', import.meta.url), { type: 'module' });
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
const idle = (fn) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 0));
