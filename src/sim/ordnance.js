/**
 * Ordnance: what a helicopter's guns, rocket pods and missiles (ai/heliArms.js) and the machine
 * guns mounted on cars and boats (ai/mountedGuns.js) fire, flown as real projectiles (not
 * hitscan): each step it moves (gravity, drag, a rocket's motor, a missile's guidance), and the
 * segment it moved along is tested against what it can meet first: a helicopter's parts
 * (ai/helicopter.js heliRayHit), a car's (models/vehicleZones.js VEHICLE_ZONES.car, in its pose),
 * a boat's hull, a man, you, the voxels, the ground or the sea. What it does there:
 *
 *  - a ball round (7.62 mm, 12.7 mm): the part's damage (VEHICLE_WEAPONS), a hole in a boat's
 *    planking (sim/boats.js boatShot), a wound (sim/wounds.js), a hole in a wall;
 *  - a cannon round (20 / 30 mm HEDP): the same, harder (it goes through a car's skin into its
 *    engine, tank, battery and crew), then its small charge: fragments round it (fragBlast);
 *  - a rocket (70 mm HE) or a missile: its hit, then a blast (sim/explosions.js explode where the
 *    voxels are, else the same effects without voxels: battleBlast) that damages helicopters,
 *    cars, boats and men round it.
 *
 * Cars (carHit): their parts take damage. The fuel tank leaks and catches (sim.ignite there: the
 * voxel fire burns it), and a burning car's tank bursts a while later (a blast); the engine stops
 * and dies; the tyres go flat; the cabin's men are hit; an EV's or a hybrid's pack under the floor
 * is holed (sim/batteries.js crushCells: thermal runaway; without voxels: c.packHit, a battery
 * fire). Boats (boatHit): holes (below the waterline it fills: sim/buoyancy.js), the outboard shot
 * dead, the men on the thwarts hit, a motor boat's tank alight.
 *
 *   battleCtx(world, sim?, o?)   the context all of this runs in: { world, sim, ground(x, z),
 *                                sees(a, b), rand(), player() }
 *   launch(ctx, o)               a projectile into world.ordnance (ai/heliArms.js ROUNDS / ROCKETS / MISSILES)
 *   stepOrdnance(ctx, dt)        fly them, hit things
 *   carHit(ctx, c, k, amount, p, dir, o), carBlast(ctx, p, R, amount), boatHit(ctx, f, p, dir, o)
 *   battleBlast(ctx, p, E, o)    a warhead's blast (explode where the voxels are)
 *   stepVehicleFires(ctx, dt)    burning cars: the men get out, the tank bursts
 */
import { VEHICLE_ZONES, VEHICLE_WEAPONS, vehicleZones, rayZone, hitPart, integrity } from '../models/vehicleZones.js';
import { carRot, carToWorld, stopEngine } from './carPhysics.js';
import { leaveCar } from './cars.js';
import { crushCells } from './batteries.js';
import { boatShot, holeBoat, boatBlast, toLocal as boatLocal, stopMotor, seatWorld } from './boats.js';
import { toWorld as hullToWorld } from './buoyancy.js';
import { raySolid, bulletHole, wound } from './wounds.js';
import { explode } from './explosions.js';
import { blastVehicles } from '../physics/vehicleCore.js';
import { heliRayHit, heliToWorld } from '../ai/helicopter.js';
import { vehicleKind } from '../ai/vehicleSides.js';

const G = 9.81;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const along = (p, d, t) => [p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t];

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** The ground (or the sea) under (x, z) in a voxel world: as ai/helicopter.js groundY. */
export function worldGround(w, x, z) {
  const sea = w.sea ? w.sea.level : 0;
  if (!w.colTop) return sea;
  const ix = Math.floor(x / w.h), iz = Math.floor(z / w.h);
  if (ix < 0 || iz < 0 || ix >= w.nx || iz >= w.nz) return sea;
  const top = w.colTop[ix + w.nx * iz];
  return Math.max(sea, top >= 0 ? (top + 1) * w.h : 0);
}

/** The context the battle runs in (a simulation's world, or a bare one in a test). */
export function battleCtx(w, sim = null, o = {}) {
  return {
    world: w,
    sim,
    ground: o.ground ?? ((x, z) => worldGround(w, x, z)),
    sees: o.sees ?? (sim?.ai?.sightLine ? (a, b) => gridSight(sim, a, b) : null),
    rand: o.rand ?? (sim?.rand ? () => sim.rand() : rng(o.seed ?? 1234567)),
    player: o.player ?? (() => (sim?.ai?.player && !sim.ai.player.dead ? sim.ai.player : null)),
    seaLevel: () => (w.sea ? w.sea.level : 0),
  };
}

const helisOf = (w) => (w.helis ?? []).map((s) => s.ai ?? (s.axes ? s : null)).filter(Boolean);

/* ------------------------------------------------------------------ launching */

let NEXT = 0;
/**
 * A projectile into world.ordnance: o { type: 'round' | 'rocket' | 'missile' | 'flare', spec (its
 * numbers: v0, drag, amount, he, heR, hole, weapon, burn, accel, ...), p, v, owner (the
 * helicopter or vehicle it came from: not hit by it), shooter (the man), side, target (a missile's),
 * guidance }.
 */
export function launch(ctx, o) {
  const w = ctx.world;
  const g = { id: ++NEXT, t: 0, ...o, p: o.p.slice(), v: o.v.slice(), from: o.p.slice() };
  (w.ordnance ??= []).push(g);
  return g;
}

/* ------------------------------------------------------------------ flying */

export function stepOrdnance(ctx, dt) {
  const w = ctx.world;
  const list = w.ordnance;
  if (!list?.length) return;
  const keep = [];
  for (const g of list) {
    if (g.done) continue;
    g.t += dt;
    const S = g.spec ?? {};
    if (g.type === 'flare') {
      // a flare: falls slowly under its little chute of drag, burns out
      g.v[1] -= G * dt;
      for (let i = 0; i < 3; i++) g.v[i] *= Math.exp(-1.6 * dt);
      for (let i = 0; i < 3; i++) g.p[i] += g.v[i] * dt;
      if (g.t < (S.burn ?? 4.5)) keep.push(g);
      continue;
    }
    const prev = g.p.slice();
    if (g.type === 'missile') steerMissile(ctx, g, dt);
    else {
      // the motor (a rocket): along its way
      if (g.type === 'rocket' && g.t < (S.burn ?? 1)) {
        const d = norm(g.v);
        for (let i = 0; i < 3; i++) g.v[i] += d[i] * (S.accel ?? 600) * dt;
      }
      g.v[1] -= G * dt;
      const k = Math.exp(-(S.drag ?? 0.2) * dt);
      for (let i = 0; i < 3; i++) g.v[i] *= k;
    }
    for (let i = 0; i < 3; i++) g.p[i] += g.v[i] * dt;
    const seg = sub(g.p, prev);
    const L = len(seg);
    if (L < 1e-6) {
      keep.push(g);
      continue;
    }
    const d = seg.map((x) => x / L);
    // a missile's proximity fuse: its target (or the flare it went for) within reach of this step's path
    let hit = null;
    if (g.type === 'missile' && g.track) {
      const q = g.track.p ?? g.track;
      const tq = clamp(dot(sub(q, prev), d), 0, L);
      if (len(sub(q, along(prev, d, tq))) < (S.fuse ?? 3)) {
        if (g.track.flare) {
          // it went for the flare: it bursts there, harmlessly far from what it was fired at
          g.done = true;
          w.events?.push({ type: 'missileDecoyed', pos: q.slice(), time: w.time ?? 0, name: S.label ?? 'missile' });
          battleBlast(ctx, along(prev, d, tq), (S.he ?? 5e5) * 0.5, { name: 'missile', owner: g.owner });
          continue;
        }
        const ref = g.track.ref;
        hit = { t: tq, p: along(prev, d, tq), prox: true, ref };
      }
    }
    hit = firstHit(ctx, prev, d, L, g) ?? (hit ? { kind: 'prox', ...hit } : null);
    if (g.type === 'round' && g.tracer) {
      const tr = (w.tracers ??= []);
      tr.push({ a: prev, b: hit ? hit.p : g.p.slice(), t: w.time ?? 0, heavy: true });
      if (tr.length > 60) tr.shift();
    }
    if (hit) {
      g.done = true;
      g.hitAt = hit.p;
      effect(ctx, g, hit, d);
      continue;
    }
    const life = S.life ?? (g.type === 'round' ? 4 : g.type === 'rocket' ? 12 : 16);
    if (g.t > life || g.p[1] < -5) {
      // (a cannon round's self-destruct, a missile out of energy)
      if (S.he && g.type !== 'round') battleBlast(ctx, g.p, S.he * 0.6, { name: g.type, owner: g.owner });
      continue;
    }
    keep.push(g);
  }
  w.ordnance = keep;
}

/**
 * A missile's guidance: proportional navigation on what it tracks (a heat seeker can be pulled
 * off by a flare: ai/heliArms.js seekerLook), its motor while it burns, then gliding; the turn
 * it can pull limited (S.turnG).
 */
function steerMissile(ctx, g, dt) {
  const S = g.spec;
  if (S.ir) seekerLook(ctx, g);
  const sp = len(g.v);
  const d = norm(g.v);
  let a = [0, -G, 0];
  if (g.t < (S.burn ?? 2)) a = a.map((x, i) => x + d[i] * (S.accel ?? 250));
  a = a.map((x, i) => x - (S.drag ?? 0.1) * g.v[i]);
  const T = g.track ? (g.track.p ?? g.track) : null;
  if (T && g.t > (S.armT ?? 0.25)) {
    const tv = g.track.vel ? g.track.vel() : [0, 0, 0];
    const r = sub(T, g.p);
    const R = len(r) || 1;
    const vr = sub(tv, g.v);
    // the line of sight's turn rate: Ω = r × vr / R²; a = N · Vc · Ω × los
    const Om = [(r[1] * vr[2] - r[2] * vr[1]) / (R * R), (r[2] * vr[0] - r[0] * vr[2]) / (R * R), (r[0] * vr[1] - r[1] * vr[0]) / (R * R)];
    const los = r.map((x) => x / R);
    const Vc = Math.max(50, -dot(vr, los));
    const N = S.nav ?? 4;
    let ac = [N * Vc * (Om[1] * los[2] - Om[2] * los[1]), N * Vc * (Om[2] * los[0] - Om[0] * los[2]), N * Vc * (Om[0] * los[1] - Om[1] * los[0])];
    // and against gravity (it holds its line)
    ac[1] += G;
    // a pursuit term early (the launch's off-boresight) so it turns onto the target
    const off = sub(los, d);
    ac = ac.map((x, i) => x + off[i] * sp * 2);
    const am = len(ac);
    const lim = (S.turnG ?? 20) * G;
    if (am > lim) ac = ac.map((x) => (x * lim) / am);
    a = a.map((x, i) => x + ac[i]);
  }
  for (let i = 0; i < 3; i++) g.v[i] += a[i] * dt;
}

/**
 * A heat seeker's look ahead (each step): every flare burning in its field of view not yet looked
 * at may pull it off (S.decoy, more for a flare near the target; less for each flare it has already
 * seen through: S.reject); once pulled off it follows that flare.
 */
export function seekerLook(ctx, g) {
  const S = g.spec;
  if (g.track?.flare) return;
  const w = ctx.world;
  const d = norm(g.v);
  const tgt = g.track?.p ?? null;
  for (const f of w.ordnance ?? []) {
    if (f.type !== 'flare' || f.done || f.t > (f.spec?.burn ?? 4.5) * 0.85) continue;
    (g.looked ??= new Set());
    if (g.looked.has(f.id)) continue;
    const r = sub(f.p, g.p);
    const R = len(r) || 1;
    if (dot(r, d) / R < Math.cos(S.fov ?? 0.35)) continue;
    g.looked.add(f.id);
    // (near the target the seeker is fooled more: the flare in the same part of its view)
    const near = tgt ? clamp(1 - len(sub(f.p, tgt)) / 60, 0, 1) : 0.5;
    // (and each flare it has already rejected teaches it: its counter-countermeasures)
    const p = (S.decoy ?? 0.4) * (0.6 + 0.6 * near) * (f.spec?.strength ?? 1) * (S.reject ?? 0.6) ** (g.looked.size - 1);
    if (ctx.rand() < p) {
      g.track = { flare: f, p: f.p, vel: () => f.v };
      w.events?.push({ type: 'seekerDecoyed', pos: g.p.slice(), time: w.time ?? 0, name: S.label ?? 'missile' });
      return;
    }
  }
}

/* ------------------------------------------------------------------ what it meets */

/**
 * The first thing on the segment from `from` along unit d (L m): { kind: 'heli' | 'car' | 'boat' |
 * 'man' | 'player' | 'wall' | 'ground' | 'water', t, p, ... } or null.
 */
export function firstHit(ctx, from, d, L, g = {}) {
  const w = ctx.world;
  let best = null;
  const take = (h) => {
    if (h && h.t >= 0 && h.t <= (best ? best.t : L)) best = h;
  };
  for (const h of helisOf(w)) {
    if (h === g.owner || (h.crashed && g.type === 'round' && !g.spec?.he)) continue;
    // (a rotor's disc: a blade only now and then)
    const r = heliRayHit(h, from, d, best ? best.t : L, ctx.rand());
    if (r) take({ kind: 'heli', heli: h, k: r.k, t: r.t, p: r.p });
  }
  for (const c of w.cars ?? []) {
    if (c === g.owner) continue;
    const r = carRayHit(c, from, d, best ? best.t : L);
    if (r) take({ kind: 'car', car: c, k: r.k, t: r.t, p: r.p, local: r.local });
  }
  for (const f of w.floats ?? []) {
    if (f === g.owner || !f.body || !f.row || f.body.sunk) continue;
    const r = boatRayHit(f, from, d, best ? best.t : L);
    if (r) take({ kind: 'boat', boat: f, t: r.t, p: r.p });
  }
  for (const e of w.enemies ?? []) {
    // (a man well under water: the round stops in the water first, the 'water' hit below; ai/dive.js)
    if (e.dead || e.aboard != null || e.inVehicle || e.inCar || e.boat || e === g.shooter || !e.p || e.submerged > 0.9) continue;
    const r = manHit(e.p, from, d, best ? best.t : L);
    if (r) take({ kind: 'man', man: e, ...r });
  }
  const pl = ctx.player?.();
  if (pl?.p && g.owner?.player !== true) {
    const r = manHit(pl.p, from, d, best ? best.t : L);
    if (r) take({ kind: 'player', ...r });
  }
  // the voxels (where it is in the grid): a wall, a parked car's skin (the car's part wins, just behind it)
  if (ctx.sim && w.mat && w.size) {
    const c = clipToBox(from, d, best ? best.t + 1 : L, w.size);
    if (c) {
      const q = along(from, d, c[0] + 1e-3);
      const r = raySolid(w, q, d, c[1] - c[0] - 2e-3);
      if (r && (!best || r.t + c[0] < best.t - 0.8)) best = { kind: 'wall', t: r.t + c[0], p: r.p, wall: r };
    }
  }
  // the ground (its columns' tops, the sea), sampled along it
  const T = best ? best.t : L;
  const n = Math.max(1, Math.ceil(T / 2));
  for (let i = 1; i <= n; i++) {
    const t = (T * i) / n;
    const q = along(from, d, t);
    const gy = ctx.ground(q[0], q[2]);
    if (q[1] <= gy) {
      // (back to where it crossed)
      const t0 = (T * (i - 1)) / n;
      const q0 = along(from, d, t0);
      const g0 = q0[1] - ctx.ground(q0[0], q0[2]);
      const g1 = q[1] - gy;
      const tt = t0 + (t - t0) * clamp(g0 / Math.max(1e-6, g0 - g1), 0, 1);
      const pp = along(from, d, tt);
      const water = w.sea || !w.colTop ? Math.abs(gy - ctx.seaLevel()) < 0.02 : false;
      best = { kind: water ? 'water' : 'ground', t: tt, p: pp };
      break;
    }
  }
  return best;
}

/**
 * A line of sight from a to b in a simulation (its voxels: walls, smoke), clipped to the voxel
 * grid first: out over the sea, beyond the place's voxels, nothing is in the way.
 */
export function gridSight(sim, a, b) {
  const w = sim.world;
  if (!sim.ai?.sightLine || !w.size) return true;
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const L = Math.hypot(d[0], d[1], d[2]);
  if (L < 1e-6) return true;
  const u = d.map((x) => x / L);
  const c = clipToBox(a, u, L, [w.size[0] - 1e-3, w.size[1] - 1e-3, w.size[2] - 1e-3]);
  if (!c || c[1] - c[0] < 1e-3) return true;
  return sim.ai.sightLine(along(a, u, c[0]), along(a, u, c[1]));
}

/** The segment's part inside the box [0, size] (t from, t to) or null. */
function clipToBox(o, d, L, size) {
  let t0 = 0, t1 = L;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < 0 || o[i] > size[i]) return null;
      continue;
    }
    let a = (0 - o[i]) / d[i], b = (size[i] - o[i]) / d[i];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return [t0, t1];
}

/** A man standing at p (his feet): the ray's nearest pass within ~0.4 m of his body. */
function manHit(p, from, d, L) {
  const c = [p[0], p[1] + 0.9, p[2]];
  const t = dot(sub(c, from), d);
  if (t < 0 || t > L) return null;
  const q = along(from, d, t);
  if (Math.hypot(q[0] - p[0], q[2] - p[2]) > 0.38 || q[1] < p[1] || q[1] > p[1] + 1.85) return null;
  const y = q[1] - p[1];
  return { t, p: q, zone: y > 1.5 ? 'head' : y > 0.85 ? 'torso' : 'legs' };
}

/** A car's frame: a world point (or direction) in it. */
export function carToLocal(c, q, dirOnly = false) {
  const R = carRot(c.yaw, c.pitch ?? 0, c.roll ?? 0);
  const d = dirOnly ? q : [q[0] - c.x, q[1] - c.y, q[2] - c.z];
  return [R[0] * d[0] + R[3] * d[1] + R[6] * d[2], R[1] * d[0] + R[4] * d[1] + R[7] * d[2], R[2] * d[0] + R[5] * d[1] + R[8] * d[2]];
}
const carDims = (c) => [c.spec.L, c.spec.H, c.spec.W];

/** The part of car c a ray meets first: { k, t, p, local } or null. */
export function carRayHit(c, from, d, max) {
  const S = c.spec;
  const mid = [c.x, c.y + S.H / 2, c.z];
  const s0 = dot(sub(mid, from), d);
  const R = Math.hypot(S.L, S.W, S.H) / 2 + 0.3;
  if (s0 < -R || s0 > max + R || len(sub(sub(mid, from), d.map((x) => x * s0))) > R) return null;
  const lf = carToLocal(c, from);
  const ld = carToLocal(c, d, true);
  const r = rayZone('car', lf, ld, max, carDims(c));
  if (!r) return null;
  return { k: r.k, t: r.t, p: carToWorld(c, r.p), local: r.p };
}

/** Where a ray first gets into a boat (its planking, or over its gunwale into it): { t, p } or null. */
export function boatRayHit(f, from, d, max) {
  const b = f.body;
  const hull = b.hull;
  const c = hullToWorld(b, [0, hull.D / 2, 0]);
  const rad = Math.hypot(hull.L / 2, hull.D, hull.B / 2);
  const oc = sub(c, from);
  const tc = dot(oc, d);
  if (dot(oc, oc) - tc * tc > rad * rad) return null;
  const t0 = Math.max(0, tc - rad), t1 = Math.min(max, tc + rad);
  for (let t = t0; t <= t1; t += 0.04) {
    const q = boatLocal(b, along(from, d, t));
    if (q[0] <= hull.x0 || q[0] >= hull.x1 || q[1] > hull.sheer(q[0]) + 0.05) continue;
    if (Math.abs(q[2]) < hull.half(q[0], q[1])) return { t, p: along(from, d, t) };
  }
  return null;
}

/* ------------------------------------------------------------------ what it does */

function effect(ctx, g, hit, d) {
  const S = g.spec ?? {};
  const w = ctx.world;
  const p = hit.p;
  const amount = S.amount ?? VEHICLE_WEAPONS.bullet;
  const big = g.type !== 'round';
  w.ordnanceHits ??= [];
  w.ordnanceHits.push({ p: p.slice(), kind: hit.kind, type: g.type, he: !!S.he, t: w.time ?? 0 });
  if (w.ordnanceHits.length > 40) w.ordnanceHits.shift();
  const by = g.owner;
  if (hit.kind === 'heli') {
    hit.heli.underFire?.(g.from, g.shooter ?? by ?? null);
    // (a round: its weight; a rocket's or a missile's warhead: 'rocket', the cockpit through)
    hit.heli.hit(hit.k, amount, p, d, big ? 'rocket' : S.he || amount >= VEHICLE_WEAPONS.shell ? 'shell' : 'bullet');
  } else if (hit.kind === 'car') {
    carHit(ctx, hit.car, hit.k, amount, p, d, { he: !!S.he, big, ap: S.ap, weapon: S.weapon ?? 'heavy', by });
  } else if (hit.kind === 'boat') {
    boatHit(ctx, hit.boat, p, d, { he: !!S.he, big, hole: S.hole, weapon: S.weapon ?? 'heavy', by, amount });
  } else if (hit.kind === 'man') {
    hurtMan(ctx, hit.man, hit.zone, S.he ? 'fragment' : 'mg', p, d, amount >= VEHICLE_WEAPONS.shell ? 120 : amount > 40 ? 40 : 0);
  } else if (hit.kind === 'player') {
    (w.playerHits ??= []).push({ zone: hit.zone, time: w.time ?? 0, from: g.from.slice(), weapon: S.he ? 'fragment' : 'rifle' });
  } else if (hit.kind === 'wall' && ctx.sim) {
    bulletHole(ctx.sim, hit.wall);
  } else if (hit.kind === 'water') {
    w.events?.push({ type: 'splash', pos: p.slice(), time: w.time ?? 0, name: S.label ?? g.type, size: big ? 2 : S.he ? 0.8 : 0.3 });
  } else if (hit.kind === 'prox' && hit.ref) {
    // (a missile bursting beside its target: the blast does it)
  }
  if (big) battleBlast(ctx, p, S.he ?? 1.5e6, { name: g.type === 'missile' ? 'missile' : 'rocket', owner: by, exclude: hit.kind === 'heli' ? null : null });
  else if (S.he) fragBlast(ctx, p, S.heR ?? 1.5, S.fragAmount ?? 45, { skip: hit, owner: by });
}

/** A man hit by it (sim/wounds.js wound in a simulation, else his health), with `extra` on top. */
export function hurtMan(ctx, e, zone, kind, p, d, extra = 0) {
  if (!e || e.dead) return;
  const w = ctx.world;
  if (ctx.sim?.ai) {
    wound(ctx.sim, e, zone === 'legs' ? 'legL' : zone ?? 'torso', kind, p ?? e.p, d ?? [0, -1, 0]);
    if (extra) ctx.sim.ai.damage(e, extra);
    return;
  }
  e.health = (e.health ?? 100) - ((zone === 'head' ? 150 : 50) + extra);
  e.lastHitT = w.time ?? 0;
  if (e.health <= 0) {
    e.health = 0;
    e.dead = true;
    w.events?.push({ type: 'enemyDown', pos: (e.p ?? p).slice(), time: w.time ?? 0, name: e.name ?? 'enemy' });
  }
}
function hurtOccupant(ctx, m, zone, kind, p, d, extra) {
  if (!m || m.dead) return;
  if (m.player) (ctx.world.playerHits ??= []).push({ zone: zone === 'legs' ? 'legs' : zone, time: ctx.world.time ?? 0, from: p.slice(), weapon: kind === 'fragment' ? 'fragment' : 'rifle' });
  else hurtMan(ctx, m, zone, kind, p, d, extra);
}

/* ------------------------------------------------------------------ cars */

/**
 * Car c's part k hit by `amount` (VEHICLE_WEAPONS scale) at p along dir. o: { he (a charge with
 * it), big (a rocket's, a missile's), ap, by }. Its parts' damage in c.zdmg; what each does:
 * see the top. Returns the part's state (hitPart) or null.
 */
export function carHit(ctx, c, k, amount, p, dir = null, o = {}) {
  const w = ctx.world;
  c.zdmg ??= {};
  const r = hitPart(c.zdmg, 'car', k, amount);
  if (!r) return null;
  const l = carToLocal(c, p);
  w.events?.push({ type: 'carHit', pos: p.slice(), time: w.time ?? 0, name: c.label ?? 'car', zone: k, value: r.value, destroyed: r.destroyed });
  c.hitBy = o.by ?? c.hitBy;
  c.lastHitT = w.time ?? 0;
  const heavy = o.he || o.big || amount >= VEHICLE_WEAPONS.shell;
  const S = c.spec;
  // an EV's or a hybrid's pack: in the floor, under the cabin
  if (S.battery && l[1] < 0.55 * (S.H / 1.45) && Math.abs(l[0]) < S.L * 0.33) packHit(ctx, c, p, heavy ? 0.9 : 0.35 * (amount / VEHICLE_WEAPONS.bullet));
  if (k === 'fuel') {
    c.leak = Math.max(c.leak ?? 0, r.value);
    if (r.destroyed || (heavy && r.value > 0.4) || ctx.rand() < r.value * 0.25) carIgnite(ctx, c, p, heavy && r.value >= 1 ? 'burst' : 'fire');
  } else if (k === 'engine') {
    c.smoke = Math.max(c.smoke ?? 0, r.value);
    if (r.value > 0.6 && c.running) stopEngine(c, 'the engine is shot through');
    if (r.destroyed) {
      killCar(c, 'the engine is shot through');
      if (heavy || ctx.rand() < 0.4) carIgnite(ctx, c, p, 'fire');
    }
  } else if (k === 'tyres') {
    if (r.value > 0.5) c.flats = (c.flats ?? 0) + 1;
  } else if (k === 'cabin') {
    // the men in it: the one nearest where it came through (a blast: them all)
    const men = c.seats.filter((s) => s.who && !s.who.dead);
    men.sort((a, b) => len(sub(a.at, l)) - len(sub(b.at, l)));
    for (const s of heavy ? men : men.slice(0, 1)) if (heavy || ctx.rand() < 0.75) hurtOccupant(ctx, s.who, heavy ? 'torso' : ctx.rand() < 0.25 ? 'head' : 'torso', heavy ? 'fragment' : 'mg', p, dir, heavy ? 90 : amount > 40 ? 30 : 0);
  }
  if (integrity(c.zdmg, 'car') < 0.3 || (c.zdmg.engine >= 1 && c.zdmg.fuel >= 1)) {
    killCar(c, 'shot to pieces');
    c.wrecked = true;
    c.armsWreck = true;
  }
  return r;
}
function killCar(c, why) {
  if (c.running || c.crank > 0) stopEngine(c, why);
  if (!c.dead) {
    c.dead = true;
    c.why = why;
  }
}
/** Its pack holed: in a simulation the cells there short (sim/batteries.js); without voxels, a battery fire. */
function packHit(ctx, c, p, sev) {
  const w = ctx.world;
  c.packHit = (c.packHit ?? 0) + sev;
  if (w.mat && w.crack) crushCells(w, p, 0.7, clamp(sev, 0, 1.2));
  if (c.packHit >= 0.8 && !c.runaway) {
    c.runaway = true;
    w.events?.push({ type: 'batteryRunaway', pos: p.slice(), time: w.time ?? 0, name: c.label ?? 'car' });
    carIgnite(ctx, c, p, 'battery');
  }
}

/** Its fuel (or its pack) alight: the voxels there in a simulation, its own fire (stepVehicleFires) with or without. */
export function carIgnite(ctx, c, p, how = 'fire') {
  const w = ctx.world;
  const tank = carToWorld(c, [-0.23 * c.spec.L, 0.45, 0]);
  if (!c.armsFire) {
    c.armsFire = { t: 0, how, burstAt: how === 'burst' ? 0.2 : how === 'battery' ? Infinity : 6 + ctx.rand() * 8 };
    c.burning = true;
    w.events?.push({ type: 'carFire', pos: (p ?? tank).slice(), time: w.time ?? 0, name: c.label ?? 'car', how });
    if (ctx.sim?.ignite && w.mat) {
      ctx.sim.ignite(p ?? tank, 0.8);
      ctx.sim.ignite(tank, 0.7);
    }
  } else if (how === 'burst') c.armsFire.burstAt = Math.min(c.armsFire.burstAt, c.armsFire.t + 0.2);
  killCar(c, how === 'battery' ? 'the battery is burning' : 'on fire');
}

/** A blast's (or fragments') share on the cars round p (R m): their parts by how near. */
export function carBlast(ctx, p, R, amount = VEHICLE_WEAPONS.rocket, o = {}) {
  for (const c of ctx.world.cars ?? []) {
    if (c === o.skip) continue;
    if (Math.hypot(c.x - p[0], c.z - p[2]) > R * 2 + c.spec.L) continue;
    const l = carToLocal(c, p);
    for (const Z of vehicleZones('car', carDims(c))) {
      const dist = Math.min(...Z.boxes.map((b) => Math.max(0, len(sub(b.c, l)) - Math.min(...b.h))));
      if (dist > R) continue;
      carHit(ctx, c, Z.k, amount * (1 - dist / R) * (Z.k === 'tyres' ? 0.5 : 1), carToWorld(c, Z.boxes[0].c), norm(sub(carToWorld(c, Z.boxes[0].c), p)), { he: true, big: amount >= VEHICLE_WEAPONS.rocket * 0.5, by: o.owner });
    }
    // pushed by it: a car on the shared physics gets its push from the blast itself (blastVehicles,
    // at the point of its box nearest the blast: it can roll it); a car off it, a nudge on its velocity
    if (amount >= VEHICLE_WEAPONS.rocket * 0.5 && !c.core?.body) {
      const dx = c.x - p[0], dz = c.z - p[2], dl = Math.hypot(dx, dz) || 1;
      const k = clamp(1 - dl / (R * 1.5), 0, 1) * 2.5;
      c.vx = (c.vx ?? 0) + (dx / dl) * k;
      c.vz = (c.vz ?? 0) + (dz / dl) * k;
    }
  }
}

/** Burning cars (each step): the men get out (or burn), the fuel goes, the tank bursts. */
export function stepVehicleFires(ctx, dt) {
  const w = ctx.world;
  for (const c of w.cars ?? []) {
    const F = c.armsFire;
    if (!F) continue;
    F.t += dt;
    c.burning = true;
    c.fuel = Math.max(0, (c.fuel ?? 0) - 0.4 * dt);
    // the men in it get out (the able ones), on its side
    for (const s of c.seats) {
      const m = s.who;
      if (!m || m.player) continue;
      if (m.dead) continue;
      if (F.t > 0.8 + (s.at[0] < 0 ? 0.6 : 0)) {
        leaveCar(c, m);
        const side = Math.sign(s.at[2]) || 1;
        const q = carToWorld(c, [s.at[0], 0, side * (c.spec.W / 2 + 1.2)]);
        m.p = [q[0], ctx.ground(q[0], q[2]), q[2]];
        m.inVehicle = null;
        m.inCar = null;
        m.guardCtl = false; // (out: on his feet, the AI's again)
        m.vehFiring = false;
        m.anim = null;
        w.events?.push({ type: 'bailOut', pos: m.p.slice(), time: w.time ?? 0, name: m.name ?? 'man' });
      } else if (ctx.rand() < dt * 0.5) hurtOccupant(ctx, m, 'torso', 'fragment', [c.x, c.y + 1, c.z], [0, 1, 0], 10);
    }
    if (F.t >= F.burstAt && !F.burst) {
      F.burst = true;
      c.wrecked = true;
      c.armsWreck = true;
      const tank = carToWorld(c, [-0.23 * c.spec.L, 0.45, 0]);
      const litres = Math.max(5, c.fuel ?? 20);
      w.events?.push({ type: 'tankBurst', pos: tank, time: w.time ?? 0, name: c.label ?? 'car' });
      battleBlast(ctx, tank, 4e5 + litres * 2e4, { name: 'fuel tank', owner: c, skipCar: c, fire: true });
    }
    if (ctx.sim?.addTorch && w.mat && (F.torchT = (F.torchT ?? 0) - dt) <= 0) {
      F.torchT = 2;
      const q = carToWorld(c, [0, c.spec.H * 0.6, 0]);
      if (F.t < 90) ctx.sim.addTorch(q, F.how === 'battery' ? 3e5 : 2.5e5, 2.2, 1);
    }
  }
}

/* ------------------------------------------------------------------ boats */

/**
 * A round (or a warhead) into boat f at p along dir: holes in and out (sim/boats.js boatShot; a
 * cannon round's bigger: o.hole m²), the outboard shot dead, the men on the thwarts hit, a motor
 * boat's tank alight.
 */
export function boatHit(ctx, f, p, dir, o = {}) {
  const w = ctx.world;
  const b = f.body;
  const from = along(p, dir, -0.6);
  boatShot(ctx.sim ?? { world: w }, from, dir, 6, o.weapon === 'mg' ? 'mg' : 'heavy');
  if (o.hole) holeBoat(f, p, o.hole);
  const l = boatLocal(b, p);
  const hull = b.hull;
  f.zdmg ??= {};
  f.hitBy = o.by ?? f.hitBy;
  w.events?.push({ type: 'boatHit', pos: p.slice(), time: w.time ?? 0, name: f.label ?? 'boat' });
  // the outboard on the transom
  if (f.motor && l[0] < hull.x0 + 0.7) {
    f.zdmg.engine = Math.min(1, (f.zdmg.engine ?? 0) + (o.amount ?? 50) / 60);
    if (f.zdmg.engine >= 1 && !f.motor.dead) {
      f.motor.dead = true;
      stopMotor(f);
      f.motor.why = 'shot';
      w.events?.push({ type: 'boatEngineDead', pos: p.slice(), time: w.time ?? 0, name: f.label ?? 'boat' });
      if ((o.he || o.big) && ctx.sim?.ignite && w.mat) ctx.sim.ignite(p, 0.5);
    }
  }
  // the men aboard: the one nearest its way (a warhead's: everyone near)
  const men = (f.seats ?? []).map((s, k) => ({ s, k })).filter((x) => x.s.who && !x.s.who.dead);
  for (const { s, k } of men) {
    const q = seatWorld(f, k).p;
    const c = [q[0], q[1] + 0.5, q[2]];
    const t = dot(sub(c, from), dir);
    const miss = len(sub(c, along(from, dir, t)));
    if (o.big ? len(sub(c, p)) < 4 : miss < 0.45) hurtOccupant(ctx, s.who, o.big ? 'torso' : miss < 0.2 ? 'head' : 'torso', o.he ? 'fragment' : 'mg', c, dir, o.big ? 100 : (o.amount ?? 50) > 40 ? 30 : 0);
  }
}

/* ------------------------------------------------------------------ blasts */

/** A small charge (a cannon round's): fragments round p (R m): helicopter parts, cars, boats, men. */
export function fragBlast(ctx, p, R, amount, o = {}) {
  const w = ctx.world;
  for (const h of helisOf(w)) {
    if (len(sub(h.p, p)) > R + 12) continue;
    for (const Z of vehicleZones('helicopter')) {
      if (h.gone.has(Z.k) || (o.skip?.heli === h && o.skip.k === Z.k)) continue;
      const dist = Math.min(...Z.boxes.map((b) => len(sub(heliToWorld(h, b.c), p)) - Math.min(...b.h)));
      if (dist > R) continue;
      h.hit(Z.k, amount * clamp(1 - Math.max(0, dist) / R, 0, 1) * (Z.k === 'rotor' ? 0.5 : 1), p, null, 'bullet');
    }
  }
  carBlast(ctx, p, R, amount, { skip: o.skip?.car, owner: o.owner });
  if (w.floats?.length) boatBlast(ctx.sim ?? { world: w }, p, R);
  for (const e of w.enemies ?? []) {
    if (e.dead || e.aboard != null || !e.p || e.submerged > 0.9) continue; // (fragments stop in the water)
    const dd = len(sub([e.p[0], e.p[1] + 1, e.p[2]], p));
    if (dd < R && e !== o.skip?.man && ctx.rand() < 1 - dd / R) hurtMan(ctx, e, 'torso', 'fragment', p, norm(sub(e.p, p)), 0);
  }
  const pl = ctx.player?.();
  if (pl?.p && len(sub([pl.p[0], pl.p[1] + 1, pl.p[2]], p)) < R) (w.playerHits ??= []).push({ zone: 'torso', time: w.time ?? 0, from: p.slice(), weapon: 'fragment' });
  if (ctx.sim && w.mat && w.size && p[0] >= 0 && p[2] >= 0 && p[1] >= 0 && p[0] < w.size[0] && p[2] < w.size[2] && p[1] < w.size[1]) {
    const i = w.voxelAt(...p);
    if (i >= 0 && w.mat[i] && ctx.rand() < 0.15) ctx.sim.ignite?.(p, w.h);
  }
}

/**
 * A warhead's blast at p (energy E, J): where the voxels are, sim/explosions.js explode (it
 * reaches men, helicopters, boats, the voxels); elsewhere (out over the sea, a test) the same
 * without voxels. The cars round it either way (carBlast). o: { name, owner, skipCar }.
 */
export function battleBlast(ctx, p, E, o = {}) {
  const w = ctx.world;
  const R = Math.max(1.5, 0.4 * Math.cbrt(E / 1000));
  const inGrid = w.size && p[0] > -R && p[2] > -R && p[1] > -R && p[0] < w.size[0] + R && p[2] < w.size[2] + R && p[1] < w.size[1] + R;
  if (ctx.sim && w.mat && inGrid) explode(ctx.sim, p, E, { name: o.name ?? 'rocket' });
  else {
    w.events?.push({ type: 'explosion', pos: p.slice(), time: w.time ?? 0, energy: E, radius: R, name: o.name ?? 'rocket' });
    blastVehicles(w, p, E, R * 1.5); // (the bodies of the cars, boats and helicopters round it: physics/vehicleCore.js; in the grid explode() does it)
    for (const h of helisOf(w)) {
      if (len(sub(h.p, p)) > R * 2 + 12) continue;
      for (const Z of vehicleZones('helicopter')) {
        if (h.gone.has(Z.k)) continue;
        const dist = Math.min(...Z.boxes.map((b) => len(sub(heliToWorld(h, b.c), p)) - Math.min(...b.h)));
        if (dist > R * 2) continue;
        h.hit(Z.k, VEHICLE_WEAPONS.rocket * clamp(1 - Math.max(0, dist) / (R * 2), 0, 1) * (Z.k === 'rotor' ? 0.6 : 1), p, null, 'rocket');
      }
    }
    if (w.floats?.length) boatBlast(ctx.sim ?? { world: w }, p, R * 1.5);
    for (const e of w.enemies ?? []) {
      if (e.dead || e.aboard != null || !e.p) continue;
      const dd = len(sub([e.p[0], e.p[1] + 1, e.p[2]], p));
      // (under water the fragments stop; only the shock of a warhead close by reaches him)
      if (e.submerged > 0.9 && dd > R * 0.5) continue;
      if (dd < R * 1.5) hurtMan(ctx, e, 'torso', 'fragment', p, norm(sub(e.p, p)), 120 * (1 - dd / (R * 1.5)));
    }
    const pl = ctx.player?.();
    if (pl?.p && len(sub(pl.p, p)) < R * 1.5) (w.playerHits ??= []).push({ zone: 'torso', time: w.time ?? 0, from: p.slice(), weapon: 'fragment' });
  }
  // the boats' men in it (explode's boat blast holes the hulls; the men on the thwarts are hit here)
  for (const f of w.floats ?? []) {
    if (!f.body || f.body.sunk) continue;
    if (Math.hypot(f.body.X - p[0], f.body.Z - p[2]) > R * 1.5 + 3) continue;
    for (const [k, s] of (f.seats ?? []).entries()) {
      if (!s.who || s.who.dead) continue;
      const q = seatWorld(f, k).p;
      const dd = len(sub(q, p));
      if (dd < R * 1.5) hurtOccupant(ctx, s.who, 'torso', 'fragment', p, norm(sub(q, p)), 110 * (1 - dd / (R * 1.5)));
    }
    if (f.motor && !f.motor.dead && Math.hypot(f.body.X - p[0], f.body.Z - p[2]) < R) {
      f.motor.dead = true;
      stopMotor(f);
      f.motor.why = 'blast';
    }
  }
  carBlast(ctx, p, R * 1.2, VEHICLE_WEAPONS.rocket, { skip: o.skipCar, owner: o.owner });
}

export { VEHICLE_ZONES };
