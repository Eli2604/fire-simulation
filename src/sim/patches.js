import { buildScene } from '../models/voxelizer.js';
import { Simulation } from './simulation.js';
import { F_HIDDEN, F_BURNING, F_LIQUID, F_FALLING, O2_AIR } from './world.js';
import { MAT, MATERIALS } from './materials.js';

/**
 * Detail patches: fine voxels where they matter, coarse ones everywhere else.
 *
 * A scene at 0.2 m voxels cannot hold a candle (2–4 cm across), a torch's head (9 cm) or the
 * logs of a campfire as they char and split: there they are drawn, and simulated coarsely
 * (a candle or a torch as its flame only, a small burner; a campfire as a few big voxels).
 * Each carries a description of itself (`heater.detail`); this module gives it a small world
 * of its own at fine voxels, placed where it stands, when the viewer comes close:
 *
 *  - a candle (1 cm; 5 mm for a candelabra's thin ones; half that again for the nearest one
 *    within arm's reach): wick, wax that melts, a pool, drips that run down and set;
 *  - a wall torch (1 cm): its head, rags soaked in pitch, burning as many wicks at once, the
 *    pitch running and dripping;
 *  - a campfire (a few cm, as many as its time budget allows): its logs, kindling and stone
 *    ring, burning, charring and falling in, with flames of its own.
 *
 * What is shared:
 *  - Only the nearest few run, within a few metres of the camera (a campfire, being bigger,
 *    from further); further away nothing of that detail can be seen, and the coarse one
 *    stands in again.
 *  - The coarse world is the patch's surroundings: the temperature, oxygen and draught of
 *    the air round it are its weather and the air coming in at its edges.
 *  - A candle's and a torch's patch gives back what it burns: the coarse flame's heat release
 *    is the patch's own, and it is out when the patch's flame is out (a candle's drawn height
 *    follows what the patch burnt down). A campfire's coarse voxels stay the fire as far as
 *    the scene is concerned (its heat, its smoke, what it sets alight): its patch starts from
 *    them (what has burnt away, what is charred, what burns) and shows it in detail.
 *  - A blast nearby blows candles and torches out (patch or not).
 *  - The patch keeps its own clock, following the coarse one as far as the time budget per
 *    frame allows: at high time scales it falls behind (slow motion) rather than slowing the
 *    scene; a patch that has been asleep picks up where it stopped (it does not age).
 *
 * The voxel sizes are settings (`scale`: the hardware's choice, coarser is faster).
 */
export const PATCH = {
  h: 0.01, // candles (m): 1 cm (8 mm costs twice as much and its flame is less steady)
  hThin: 0.005, // for candles under 1.5 cm radius (a candelabra's)
  hTorch: 0.01, // a torch's head
  hFire: 0.04, // a campfire's (at most: coarser for a big one, see `fireVoxels`)
  fireVoxels: 100e3, // a campfire's patch has no more voxels than this
  near: 3.5, // a patch starts within this distance of the camera (m)
  far: 4.5, // and sleeps beyond this one
  torchNear: 2.5,
  fireNear: 8, // (a campfire: its flames and logs show from further)
  fireFar: 10,
  maxActive: 8,
  scale: 1, // factor on the fine voxel sizes (the hardware's choice: coarser is faster)
  torches: true, // torches and campfires get patches too (candles always)
  fires: true,
  warmup: 12, // s of burning before a lit patch is shown
  match: 10, // s the wick is lit for (a match, 300 W)
  catchup: 20, // s: a patch further behind than this skips ahead
  // nearer still, the nearest candle goes finer again (half the voxel size: a drip is a drip,
  // not a stack of cubes); a switch carries the wax over as it is (its shape resampled)
  fineNear: 1.2,
  fineFar: 1.6,
  maxFine: 1,
  fineScale: 0.5,
  hMin: 0.004, // no finer than this (the cost goes with the 4th power of 1/h)
};

export class DetailPatches {
  constructor(sim) {
    this.sim = sim;
    const make = (ht) => (ht.detail.type === 'torch' ? new TorchPatch(ht, sim) : ht.detail.type === 'campfire' ? new FirePatch(ht, sim) : new CandlePatch(ht, sim));
    this.list = sim.world.heaters.filter((ht) => ht.detail).map(make);
    this.seen = sim.world.events.length;
    this.enabled = true;
  }

  get count() {
    return this.list.length;
  }

  /**
   * Once per frame: wake the patches near the camera (`cam`, world-local coordinates; null:
   * none), put the others to sleep, and advance the awake ones within `budgetMs`.
   */
  update(cam, budgetMs = 6) {
    const w = this.sim.world;
    // blasts: candles and torches near one are blown out
    for (; this.seen < w.events.length; this.seen++) {
      const e = w.events[this.seen];
      if (e.type !== 'explosion') continue;
      const R = Math.max(3, (e.radius ?? 1) * 3);
      for (const p of this.list) if (p.blowsOut && dist(p.ht.pos, e.pos) < R) p.blowOut();
    }
    const want = new Set();
    if (this.enabled && cam) {
      const near = this.list
        .filter((p) => p.wanted())
        .map((p) => ({ p, d: dist(p.ht.pos, cam) }))
        .filter(({ p, d }) => d < (p.awake ? p.far : p.near))
        .sort((a, b) => a.d - b.d)
        .slice(0, PATCH.maxActive);
      for (const { p } of near) want.add(p);
    }
    for (const p of this.list) if (p.awake && !want.has(p)) p.sleep();
    const awake = [...want];
    // the nearest one or two, within arm's reach: finer voxels
    let fine = 0;
    for (const p of awake) {
      if (!p.refines) continue;
      const d = dist(p.ht.pos, cam);
      const can = p.baseH * PATCH.fineScale >= PATCH.hMin - 1e-9;
      const tier = can && fine < PATCH.maxFine && d < (p.tier ? PATCH.fineFar : PATCH.fineNear) ? 1 : 0;
      if (tier) fine++;
      if (tier !== p.tier) p.setTier(tier);
    }
    if (!awake.length) return;
    const t0 = performance.now();
    for (const [k, p] of awake.entries()) {
      if (!p.awake) p.wake();
      // what is left of the budget, shared by the patches still to go
      const left = budgetMs - (performance.now() - t0);
      p.advance(Math.max(0.5, left / (awake.length - k)));
    }
  }

  /** Patches that are drawn in fine detail now. */
  shown() {
    return this.list.filter((p) => p.awake && p.live);
  }
}

/** What all patches share: waking and sleeping, the coarse air as their weather, their clock. */
class Patch {
  constructor(ht, coarse) {
    this.ht = ht;
    this.coarse = coarse;
    this.awake = false;
    this.live = false; // warmed up and shown
    this.sim = null;
    this.offset = 0; // coarse time - fine time
    this.hrr = 0;
    this.tier = 0;
    this.near = PATCH.near;
    this.far = PATCH.far;
    this.draught = { k: 0.25, max: 0.35 }; // share of the coarse air's mean flow felt, and its cap (m/s)
  }

  get type() {
    return this.ht.detail.type;
  }

  /** Worth running now (the settings allow it, there is something to see)? */
  wanted() {
    return true;
  }

  /** Make the patch's world from its scene (`this.scene()`), its ground row hidden (the scene draws it). */
  build(opts = {}) {
    const scene = this.scene();
    const { world } = buildScene(scene);
    if (this.hideGround) {
      for (let z = 0; z < world.nz; z++) for (let x = 0; x < world.nx; x++) if (world.mat[world.idx(x, 0, z)]) world.flags[world.idx(x, 0, z)] |= F_HIDDEN;
      world.geomVersion++;
    }
    const sim = new Simulation(world, { ...scene.weather });
    // a small flame's plume is slow (under 1 m/s): two air cells a step is still well inside
    // what the air step resolves, and halves the cost
    sim.dt = Math.min(0.05, (this.dtCells ?? 2) * world.ah);
    this.sim = sim;
    this.built(opts);
  }

  built() {}

  /**
   * Finer (1) or back to the usual voxels (0). A patch that has run carries over what it has
   * become: the wax where it stands, molten or set, its heat, the burning wick, the air and
   * the flame's plume over it, resampled onto the new voxels (the shape through a smoothed
   * occupancy, so that a drip of 1 cm cubes becomes a rounded one, not 8 cubes each).
   */
  setTier(tier) {
    const h = this.baseH * (tier ? PATCH.fineScale : 1);
    this.tier = tier;
    if (!this.sim) return this.layout(h);
    const old = { sim: this.sim, origin: this.origin, h: this.h };
    this.layout(h);
    this.build({ fresh: true });
    resample(old, this);
    this.sim.world.time = old.sim.world.time;
  }

  wake() {
    if (!this.sim) this.build();
    this.awake = true;
    // a candle lit again in the coarse world while this one is out (or the reverse)
    this.offset = this.coarse.world.time - this.sim.world.time;
  }

  sleep() {
    this.awake = false;
    this.live = false;
    this.ht.patchLive = false;
  }

  /** The coarse air round it (`at`: the point whose air cell it is) is the patch's surroundings. */
  couple(at = [this.ht.pos[0], this.ht.pos[1] + 0.1, this.ht.pos[2]]) {
    const c = this.coarse.world;
    const s = this.sim;
    const a = c.airIdx(clamp(Math.floor(at[0] / c.ah), 0, c.anx - 1), clamp(Math.floor(at[1] / c.ah), 0, c.any - 1), clamp(Math.floor(at[2] / c.ah), 0, c.anz - 1));
    const W = s.weather;
    W.ambient = c.airT[a];
    W.humidity = this.coarse.weather.humidity;
    s.world.o2Out = c.o2[a] ?? O2_AIR;
    // a draught through the room (or the push of a fire's plume) reaches the flame: the coarse
    // air's mean flow round it over a few seconds (a coarse cell's own velocity is mostly the
    // grid's turbulence, a gale at a candle's scale)
    let ux = 0;
    let uz = 0;
    let n = 0;
    const [ax, ay, az] = [a % c.anx, Math.floor(a / c.anx) % c.any, Math.floor(a / (c.anx * c.any))];
    for (let dz = -1; dz <= 1; dz++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const x = ax + dx;
          const y = ay + dy;
          const z = az + dz;
          if (x < 0 || y < 0 || z < 0 || x >= c.anx || y >= c.any || z >= c.anz) continue;
          const b = c.airIdx(x, y, z);
          if (c.occ[b] > 0.5) continue;
          ux += c.vx[b];
          uz += c.vz[b];
          n++;
        }
    const k = 0.05; // ~2 s at 60 updates a second
    this.ux = (this.ux ?? 0) + ((n ? ux / n : 0) - (this.ux ?? 0)) * k;
    this.uz = (this.uz ?? 0) + ((n ? uz / n : 0) - (this.uz ?? 0)) * k;
    W.windSpeed = Math.min(this.draught.max, Math.hypot(this.ux, this.uz) * this.draught.k);
    W.windDir = (Math.atan2(this.uz, this.ux) * 180) / Math.PI;
  }

  /** Run the patch up to the coarse world's time (as far as `ms` of work allows). */
  step(ms) {
    const s = this.sim;
    const ct = this.coarse.world.time;
    if (!this.live && this.warmUntil != null) {
      // lit unseen until it burns steadily
      s.advance(this.warmUntil - s.world.time, ms);
      if (s.world.time >= this.warmUntil - 1e-6) {
        this.live = true;
        this.offset = ct - s.world.time;
      }
      return false;
    }
    let behind = ct - this.offset - s.world.time;
    if (behind > PATCH.catchup) {
      this.offset += behind - PATCH.catchup;
      behind = PATCH.catchup;
    }
    if (behind > 1e-6) s.advance(behind, ms);
    return true;
  }

  /**
   * A candle or a torch: the patch is the flame. What it burns is the coarse flame's heat
   * release; its flame out is the coarse one out.
   */
  advance(ms) {
    this.couple();
    if (!this.step(ms)) return;
    this.hrr += (this.sim.stats.hrr - this.hrr) * 0.2;
    const burning = this.hasFlame();
    this.ht.power = Math.max(0, this.hrr);
    this.ht.on = burning;
    this.ht.patchLive = this.live;
  }

  /** Is anything burning in the patch? Where the flame stands (the top of what burns) goes to `ht.flamePos`. */
  hasFlame() {
    const w = this.sim.world;
    let top = -1;
    for (let k = 0; k < w.solidCount; k++) {
      const i = w.solids[k];
      if (!(w.flags[i] & F_BURNING)) continue;
      const y = Math.floor(i / w.nx) % w.ny;
      if (y > top) {
        top = y;
        const [x, , z] = w.coords(i);
        this.ht.flamePos = [this.origin[0] + (x + 0.5) * w.h, this.origin[1] + (y + 1) * w.h, this.origin[2] + (z + 0.5) * w.h];
      }
    }
    return top >= 0;
  }

  get blowsOut() {
    return true;
  }

  /** A blast blows the flame out (the wick still glows a moment, the wax stays soft). */
  blowOut() {
    this.ht.on = false;
    this.ht.power = 0;
    const s = this.sim;
    if (!s) return;
    const w = s.world;
    w.heaters = w.heaters.filter((h) => !h.temporary);
    for (let k = 0; k < w.solidCount; k++) {
      const i = w.solids[k];
      if (!(w.flags[i] & F_BURNING)) continue;
      w.flags[i] &= ~F_BURNING;
      w.temp[i] = Math.min(w.temp[i], 180);
      w.skin[i] = Math.min(w.skin[i], 180);
    }
    w.fgas.fill(0);
    w.flame.fill(0);
    this.warmUntil = null;
    this.live = true;
  }
}

/** A candle (models/candle.js). */
class CandlePatch extends Patch {
  constructor(ht, coarse) {
    super(ht, coarse);
    const P = ht.detail.params;
    // a thin candle (a candelabra's) in finer voxels: 4 or more across it
    this.thin = P.radius < 0.015;
    this.baseH = (this.thin ? PATCH.hThin : PATCH.h) * PATCH.scale;
    this.refines = true;
    this.hideGround = true;
    this.layout(this.baseH);
  }

  /** The patch's box for a voxel size h. */
  layout(h) {
    const P = this.ht.detail.params;
    const thin = this.thin;
    this.h = h;
    // its box: the candle with its holder, a margin round it, room above for the flame
    const half = (P.holder ? P.radius * 2.2 : P.radius) + (thin ? 0.02 : 0.035);
    this.W = Math.max(0.1, half * 2);
    this.H = h + (P.holder ? h : 0) + P.height + P.wickLength + (thin ? 0.09 : 0.13);
    // the coarse heater sits at the flame's base (`top` above the candle's foot); the patch's
    // ground layer (one voxel, hidden: the altar is drawn) puts its foot one voxel up
    const foot = [this.ht.pos[0], this.ht.pos[1] - this.ht.detail.top, this.ht.pos[2]];
    this.origin = [foot[0] - this.W / 2, foot[1] - h, foot[2] - this.W / 2];
  }

  scene() {
    const P = this.ht.detail.params;
    return {
      world: { size: [this.W, this.H, this.W], h: this.h, ground: 'stone' },
      weather: { ...this.coarse.weather, windSpeed: 0, rain: 0 },
      objects: [{ type: 'candle', params: { ...P }, x: this.W / 2, z: this.W / 2 }],
    };
  }

  built(opts) {
    const P = this.ht.detail.params;
    this.wickTop = [this.W / 2, this.h * (P.holder ? 2 : 1) + P.height + P.wickLength - this.h / 2, this.W / 2];
    if (opts.fresh) return;
    if (this.ht.on) this.light();
    else this.live = true;
  }

  /**
   * Light the wick (as the old Candles scene did: a match held to it for a while). The candle
   * has been burning in the scene already: its top is a pool of molten wax round the wick,
   * the wax under it warm, so that it burns steadily within seconds, not minutes.
   */
  light() {
    const s = this.sim;
    const w = s.world;
    const P = this.ht.detail.params;
    const c = this.W / 2;
    const topY = this.wickTop[1] - P.wickLength;
    for (let k = 0; k < w.solidCount; k++) {
      const i = w.solids[k];
      const m = w.mat[i];
      if (m !== MAT.wax && m !== MAT.beeswax) continue;
      const [x, y, z] = w.center(...w.coords(i));
      const r = Math.hypot(x - c, z - c);
      const d = topY - y; // depth under the top
      if (d > 0.03) continue;
      // the pool: molten over most of the top, a solid rim; warm wax under it
      const T = d < Math.min(0.012, P.radius * 0.6) && r < P.radius * 0.8 ? 66 : 58 - d * 600;
      w.temp[i] = w.skin[i] = Math.max(w.temp[i], T);
    }
    s.ignite(this.wickTop, this.h, [MAT.wick]);
    s.addTorch(this.wickTop, 300, PATCH.match, this.h);
    this.warmUntil = s.world.time + PATCH.warmup;
    this.live = false;
  }

  sleep() {
    super.sleep();
    // the drawn candle takes over: as far burnt down as the patch, burning as it was
    const hgt = this.waxHeight();
    if (hgt != null) this.ht.candle.height = hgt;
    this.ht.power = this.ht.on ? 80 : 0;
  }

  /** Height of the candle left in the patch (its wax still standing over the foot), m. */
  waxHeight() {
    const w = this.sim?.world;
    if (!w) return null;
    const P = this.ht.detail.params;
    const foot = this.h * (P.holder ? 2 : 1);
    const cx = Math.floor(this.W / 2 / w.h);
    let top = -1;
    for (let z = cx - 1; z <= cx + 1; z++)
      for (let x = cx - 1; x <= cx + 1; x++)
        for (let y = w.ny - 1; y > top; y--) {
          const i = w.idx(x, y, z);
          const m = w.mat[i];
          if ((m === MAT.wax || m === MAT.beeswax) && !(w.flags[i] & (F_LIQUID | F_FALLING))) {
            top = y;
            break;
          }
        }
    return top < 0 ? 0.004 : Math.max(0.004, (top + 1) * w.h - foot);
  }
}

/**
 * Which way the wall is from a wall torch (its flame at `p`): the nearest solid within 0.7 m,
 * horizontally, [dx, dz, distance]. The drawn torch (render/torches.js) leans out from it.
 */
export function torchWall(w, p) {
  let best = null;
  let bd = Infinity;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
    for (let d = 0.05; d < 0.7; d += w.h * 0.5) {
      const i = w.voxelAt(p[0] + dx * d, p[1] - 0.3, p[2] + dz * d);
      if (i >= 0 && w.mat[i] && !(w.flags[i] & F_HIDDEN)) {
        if (d < bd) {
          bd = d;
          best = [dx, dz, d];
        }
        break;
      }
    }
  return best ?? [1, 0, 0.3];
}

/**
 * A wall torch's head (models/torch.js): leaning out from the wall as the drawn torch does,
 * its top just under the coarse flame. Its pitch melts and runs, its rag strands burn it.
 */
class TorchPatch extends Patch {
  constructor(ht, coarse) {
    super(ht, coarse);
    this.baseH = PATCH.hTorch * PATCH.scale;
    this.draught = { k: 0.3, max: 0.6 };
    // (a torch's head costs as much as a few candles: only as you pass it)
    this.near = PATCH.torchNear;
    this.far = PATCH.torchNear + 0.7;
    this.layout(this.baseH);
  }

  wanted() {
    return PATCH.torches;
  }

  layout(h) {
    this.h = h;
    const [dx, dz, d] = (this.wall ??= torchWall(this.coarse.world, this.ht.pos));
    // (as render/torches.js draws it: the handle's foot against the wall half a metre down)
    const wallX = -Math.max(0.12, d - 0.02);
    this.tilt = (Math.atan2(-(wallX + 0.03), 0.45) * 180) / Math.PI;
    this.rot = (Math.atan2(dz, -dx) * 180) / Math.PI;
    this.W = 0.3;
    this.top = 0.2; // the head's top above the box's floor
    this.H = this.top + 0.38;
    const T = [this.ht.pos[0], this.ht.pos[1] - 0.05, this.ht.pos[2]];
    this.origin = [T[0] - this.W / 2, T[1] - this.top, T[2] - this.W / 2];
  }

  scene() {
    return {
      world: { size: [this.W, this.H, this.W], h: this.h, ground: 'none' },
      weather: { ...this.coarse.weather, windSpeed: 0, rain: 0 },
      objects: [{ type: 'torch', params: { top: this.top, tilt: this.tilt, handle: 0.08, strands: 0.02 }, x: this.W / 2, z: this.W / 2, rotation: this.rot }],
    };
  }

  built(opts) {
    if (opts.fresh) return;
    if (this.ht.on) this.light();
    else this.live = true;
  }

  /** It has been burning on the wall: its top warm, the rag ends alight (and a match held to them). */
  light() {
    const s = this.sim;
    const w = s.world;
    const T = [this.W / 2, this.top, this.W / 2];
    for (let k = 0; k < w.solidCount; k++) {
      const i = w.solids[k];
      if (w.mat[i] !== MAT.pitch) continue;
      const [x, y, z] = w.center(...w.coords(i));
      const d = Math.hypot(x - T[0], y - T[1], z - T[2]);
      if (d < 0.06) w.temp[i] = w.skin[i] = Math.max(w.temp[i], 80 - d * 300);
    }
    const t = (this.tilt * Math.PI) / 180;
    const r = (this.rot * Math.PI) / 180;
    // the top of the head, a little in along its axis (model +x is (cos r, -sin r) here)
    const p = [T[0] + Math.sin(t) * 0.006 * Math.cos(r), T[1] + Math.cos(t) * 0.006, T[2] - Math.sin(t) * 0.006 * Math.sin(r)];
    s.ignite(p, 0.055, [MAT.wick]);
    s.addTorch(p, 1500, PATCH.match, 0.03);
    this.warmUntil = s.world.time + PATCH.warmup;
    this.live = false;
  }

  sleep() {
    super.sleep();
    this.ht.power = this.ht.on ? 1500 : 0;
  }
}

/**
 * A campfire (models/woodPile.js) in a coarse scene. The coarse voxels stay the fire for the
 * scene (its heat and smoke, what it sets alight); the patch starts from them when it wakes
 * (fine wood where coarse wood still is, charred and burning as that is; gone where it has
 * burnt away) and burns on in detail while you are near: logs that char, split and fall in,
 * embers, its own flames. Its coarse voxels are not drawn while it is shown, nor their flames.
 */
class FirePatch extends Patch {
  constructor(ht, coarse) {
    super(ht, coarse);
    this.near = PATCH.fireNear;
    this.far = PATCH.fireFar;
    this.hideGround = true;
    this.draught = { k: 0.6, max: 4 };
    this.dtCells = 1;
    this.ht.base ??= ht.pos[1]; // (its marker stands on the ground at the pile's middle)
    this.layout();
    this.checked = -Infinity;
    this.burning = false;
  }

  get blowsOut() {
    return false;
  }

  /** Only a fire that burns (an unlit pile of logs is as well drawn coarse). */
  wanted() {
    if (!PATCH.fires) return false;
    const w = this.coarse.world;
    if (w.time - this.checked > 1) {
      this.checked = w.time;
      this.burning = this.coarseVoxels().some((i) => w.flags[i] & F_BURNING);
    }
    return this.burning || this.awake;
  }

  /** The coarse voxels of this pile (its owner's). */
  coarseVoxels() {
    const w = this.coarse.world;
    if (w.listDirty) w.rebuildLists();
    const out = [];
    const own = this.ht.owner;
    for (let k = 0; k < w.solidCount; k++) {
      const i = w.solids[k];
      if (w.owner[i] === own) out.push(i);
    }
    return out;
  }

  layout() {
    const P = this.ht.detail.params;
    const L = P.logLength;
    const r = P.logRadius;
    const ext = (P.stones ? L * 0.75 + 0.17 : L * 0.62 + r) + 0.12;
    this.W = 2 * ext;
    const pile = P.arrangement === 'teepee' ? L * 0.85 + r : P.arrangement === 'stack' ? r * 2 * Math.ceil(Math.sqrt(P.logs * 2)) : r * 1.8 * Math.ceil(P.logs / 2) + r;
    this.H = pile + Math.max(0.8, L * 1.2);
    // fine, but no more voxels than the budget (a big bonfire is coarser than a small campfire)
    const byBudget = Math.cbrt((this.W * this.W * this.H) / PATCH.fireVoxels);
    this.h = Math.max(PATCH.hFire, byBudget) * PATCH.scale;
    this.H += this.h;
    const c = this.ht.pos;
    this.origin = [c[0] - this.W / 2, this.ht.base - this.h, c[2] - this.W / 2];
  }

  scene() {
    const P = this.ht.detail.params;
    const d = this.ht.dir ?? [1, 0, 0];
    return {
      world: { size: [this.W, this.H, this.W], h: this.h, ground: 'soil' },
      weather: { ...this.coarse.weather, rain: 0 },
      objects: [{ type: 'woodPile', params: { ...P }, x: this.W / 2, z: this.W / 2, rotation: (Math.atan2(-d[2], d[0]) * 180) / Math.PI }],
    };
  }

  built() {
    this.seed();
    // its flames take a moment to stand up from the fine embers
    this.warmUntil = this.sim.world.time + 3;
    this.live = false;
  }

  /** Start from the coarse fire as it is now. */
  seed() {
    const B = this.sim.world;
    const A = this.coarse.world;
    const own = this.ht.owner;
    const reach = Math.max(1, Math.round(0.5 * (1 + this.h / A.h)));
    for (let k = 0; k < B.solidCount; k++) {
      const i = B.solids[k];
      const [x, y, z] = B.coords(i);
      if (y === 0) continue;
      const M = MATERIALS[B.mat[i]];
      if (!M.combustible) continue; // the stone ring
      const p = [this.origin[0] + (x + 0.5) * B.h, this.origin[1] + (y + 0.5) * B.h, this.origin[2] + (z + 0.5) * B.h];
      // the nearest coarse voxel of the pile
      const cx = Math.floor(p[0] / A.h);
      const cy = Math.floor(p[1] / A.h);
      const cz = Math.floor(p[2] / A.h);
      let j = -1;
      let bd = Infinity;
      for (let dz = -reach; dz <= reach; dz++)
        for (let dy = -reach; dy <= reach; dy++)
          for (let dx = -reach; dx <= reach; dx++) {
            const X = cx + dx;
            const Y = cy + dy;
            const Z = cz + dz;
            if (X < 0 || Y < 0 || Z < 0 || X >= A.nx || Y >= A.ny || Z >= A.nz) continue;
            const q = A.idx(X, Y, Z);
            if (!A.mat[q] || A.owner[q] !== own) continue;
            const dd = dx * dx + dy * dy + dz * dz;
            if (dd < bd) {
              bd = dd;
              j = q;
            }
          }
      if (j < 0) {
        B.clearVoxel(i); // burnt away
        continue;
      }
      const MA = MATERIALS[A.mat[j]];
      if (MA.name === 'charcoal' || MA.name === 'ash') B.setVoxel(i, A.mat[j]);
      B.temp[i] = A.temp[j];
      B.skin[i] = A.skin[j];
      B.char[i] = A.char[j];
      B.moist[i] = A.moist[j];
      B.fuel[i] = Math.min(B.fuel[i], A.fuel[j]);
      if (A.flags[j] & F_BURNING) B.flags[i] |= F_BURNING;
    }
    B.rebuildLists();
    B.geomVersion++;
  }

  wake() {
    // asleep for a while: the coarse fire has gone on without it; start again from that
    if (this.sim && this.coarse.world.time - (this.sleptAt ?? 0) > 20) this.sim = null;
    super.wake();
  }

  sleep() {
    super.sleep();
    this.sleptAt = this.coarse.world.time;
    this.showCoarse(true);
  }

  /** The coarse pile drawn or not (hidden while the patch is shown). */
  showCoarse(show) {
    const w = this.coarse.world;
    if (show) {
      for (const i of this.hid ?? []) if (w.mat[i]) w.flags[i] &= ~F_HIDDEN;
      this.hid = null;
    } else {
      this.hid = this.coarseVoxels().filter((i) => !(w.flags[i] & F_HIDDEN));
      for (const i of this.hid) w.flags[i] |= F_HIDDEN;
    }
    w.geomVersion++;
  }

  /** The box it covers in the coarse world [x0, y0, z0, x1, y1, z1] (its flames are its own there). */
  box() {
    const o = this.origin;
    return [o[0], o[1], o[2], o[0] + this.W, o[1] + this.H, o[2] + this.W];
  }

  advance(ms) {
    this.couple([this.ht.pos[0], this.ht.base + 0.5, this.ht.pos[2]]);
    const was = this.live;
    this.step(ms);
    if (this.live && !was) this.showCoarse(false);
    else if (this.live && this.coarse.world.time - (this.hidAt ?? 0) > 1) {
      // (a coarse voxel that burnt to charcoal is a new voxel: drawn again unless hidden again)
      this.hidAt = this.coarse.world.time;
      const w = this.coarse.world;
      for (const i of this.coarseVoxels())
        if (!(w.flags[i] & F_HIDDEN)) {
          w.flags[i] |= F_HIDDEN;
          this.hid.push(i);
          w.geomVersion++;
        }
    }
    this.ht.patchLive = this.live;
  }
}

/**
 * Carry a patch's state over onto new voxels (another size): solids by a trilinear
 * occupancy of the old ones (half or more: solid), each new voxel taking the state of the old
 * one that weighs most in it; the air cell by cell (nearest). The new world's own ground row
 * (the altar under it) stays.
 */
function resample(old, p) {
  const A = old.sim.world;
  const B = p.sim.world;
  const ho = old.h;
  // the wick is the new patch's own (a voxel thick, as thin as it can be drawn there): as tall
  // as the old one still stands, burning at its top if that one was
  let wickTop = -Infinity;
  let burning = false;
  for (let k = 0; k < A.solidCount; k++) {
    const j = A.solids[k];
    if (A.mat[j] !== MAT.wick) continue;
    const y = old.origin[1] + (Math.floor(j / A.nx) % A.ny + 1) * ho;
    if (y > wickTop) wickTop = y;
    if (A.flags[j] & F_BURNING) burning = true;
  }
  const solidA = (x, y, z) => {
    if (x < 0 || y < 0 || z < 0 || x >= A.nx || y >= A.ny || z >= A.nz) return 0;
    const j = A.idx(x, y, z);
    return A.mat[j] && !(A.flags[j] & F_FALLING) ? 1 : 0;
  };
  for (let z = 0; z < B.nz; z++)
    for (let y = 1; y < B.ny; y++)
      for (let x = 0; x < B.nx; x++) {
        const i = B.idx(x, y, z);
        if (B.mat[i] === MAT.wick) {
          if (p.origin[1] + (y + 0.5) * p.h > wickTop) B.clearVoxel(i);
          continue;
        }
        // where it is, in the old patch's voxel coordinates (from voxel centres)
        const u = (p.origin[0] + (x + 0.5) * p.h - old.origin[0]) / ho - 0.5;
        const v = (p.origin[1] + (y + 0.5) * p.h - old.origin[1]) / ho - 0.5;
        const t = (p.origin[2] + (z + 0.5) * p.h - old.origin[2]) / ho - 0.5;
        const x0 = Math.floor(u);
        const y0 = Math.floor(v);
        const z0 = Math.floor(t);
        const fx = u - x0;
        const fy = v - y0;
        const fz = t - z0;
        let occ = 0;
        let best = -1;
        let bw = 0;
        for (let c = 0; c < 8; c++) {
          const dx = c & 1;
          const dy = (c >> 1) & 1;
          const dz = c >> 2;
          const wgt = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
          if (!solidA(x0 + dx, y0 + dy, z0 + dz)) continue;
          occ += wgt;
          // (not the old patch's hidden ground: the new one has its own; nor its wick)
          if (y0 + dy === 0 || A.mat[A.idx(x0 + dx, y0 + dy, z0 + dz)] === MAT.wick) continue;
          if (wgt > bw) {
            bw = wgt;
            best = A.idx(x0 + dx, y0 + dy, z0 + dz);
          }
        }
        if (occ < 0.5 || best < 0) {
          if (B.mat[i]) B.clearVoxel(i);
          continue;
        }
        const j = best;
        if (B.mat[i] !== A.mat[j]) B.setVoxel(i, A.mat[j]);
        B.temp[i] = A.temp[j];
        B.skin[i] = A.skin[j];
        B.fuel[i] = A.fuel[j];
        B.moist[i] = A.moist[j];
        B.melt[i] = A.melt[j];
        B.char[i] = A.char[j];
        B.flags[i] = A.flags[j];
        B.owner[i] = A.owner[j];
        for (let c = 0; c < 3; c++) B.tint[i * 3 + c] = A.tint[j * 3 + c];
      }
  B.rebuildLists();
  // its top burning (and as hot as a burning wick is)
  let top = -1;
  for (let k = 0; k < B.solidCount; k++) {
    const i = B.solids[k];
    if (B.mat[i] === MAT.wick && (top < 0 || i > top)) top = i;
  }
  if (burning && top >= 0) {
    B.flags[top] |= F_BURNING;
    B.temp[top] = B.skin[top] = Math.max(B.temp[top], 600);
  }
  B.geomVersion++;
  // the air: its heat, the gas burning in it, its oxygen, how it moves
  const fields = ['airT', 'o2', 'fgas', 'flame', 'vx', 'vy', 'vz', 'smoke', 'steam'];
  const scale = (B.ah / A.ah) ** 3; // amounts (fgas, smoke, steam) per cell go with its volume
  for (let az = 0; az < B.anz; az++)
    for (let ay = 0; ay < B.any; ay++)
      for (let ax = 0; ax < B.anx; ax++) {
        const b = B.airIdx(ax, ay, az);
        const px = p.origin[0] + (ax + 0.5) * B.ah - old.origin[0];
        const py = p.origin[1] + (ay + 0.5) * B.ah - old.origin[1];
        const pz = p.origin[2] + (az + 0.5) * B.ah - old.origin[2];
        const a = A.airIdx(clamp(Math.floor(px / A.ah), 0, A.anx - 1), clamp(Math.floor(py / A.ah), 0, A.any - 1), clamp(Math.floor(pz / A.ah), 0, A.anz - 1));
        for (const f of fields) if (A[f] && B[f]) B[f][b] = f === 'fgas' || f === 'smoke' || f === 'steam' ? A[f][a] * scale : A[f][a];
      }
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
