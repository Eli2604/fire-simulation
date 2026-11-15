import { MATERIALS, MAT } from './materials.js';
import { carSpec, makeCar, subStep, carRot, carToWorld, setMode, startEngine, stopEngine, sfx, massOf, hasEnergy, wheelPhase, CAR_SUBSTEP } from './carPhysics.js';
import { FRESH, crushCells } from './batteries.js';
import { captureBody, stampBody, bodyLeft, regionState, bodyBurning } from './carBody.js';
import { impact } from './impact.js';
import { F_LIQUID } from './world.js';
import { stepDriver } from '../ai/carDriver.js';

/**
 * Cars in the world: every object of type 'car' (models/car.js: the street's cars, the military
 * base's jeep and trucks) is a vehicle you can drive (walk/carDrive.js), an AI can drive
 * (ai/carDriver.js driveTo; a squad's: ai/vehicles.js) and that burns as it goes.
 *
 *   initCars(world)        world.cars: one per car object (its voxels' owner, where it was built)
 *   stepCars(sim, dt)      each frame (sim/simulation.js motionStep): the drivers, the dynamics
 *                          (sim/carPhysics.js) on the ground of the voxels, what they hit, the
 *                          engine's and the tank's state from the voxels, the voxels moved
 *   carNear(w, p)          the car whose driver's door is within reach of p
 *   boardCar(c, m, i), leaveCar(c, m), driverOf(c)   seats (their weight in the car)
 *   carUsable(c)           fit to drive: not wrecked, not burning, the engine whole, fuel in it
 *
 * The voxels: a car stays the voxels it was built of until it first moves (or someone gets in);
 * then they become its body (sim/carBody.js) and are put back into the grid wherever it goes, so
 * its fire, its heat and what has burnt away go with it. On the move its voxels are hidden and
 * render/cars.js draws it (wheels turning and steering, the body on its springs); at rest they
 * are drawn as they are.
 *
 * What it drives on: the height under each wheel is the top of the voxels there (scanned down from
 * a kerb's height over the car: a wall is not climbed; where the grid is coarse (h > 0.2 m), the
 * steps of the voxel slopes are smoothed into ramps), the grip from the surface's material (MU).
 * What it hits: solid voxels in the way of its body above its ground clearance (stopped, an
 * impact: sim/impact.js crushes what it hits and makes the sound, the car takes damage), the other
 * cars (boxes: momentum along the normal), people (knocked down and hurt at speed: impact;
 * slowly: it stops for them). The engine dies when its bay has burnt (its voxels gone, charred or
 * hot) or the car is wrecked; the fuel left is what its tank's petrol voxels still hold.
 *
 * An EV's or a hybrid's battery pack (sim/batteries.js): its cells are its 'battery' region; the
 * charge it has is no more than its cells not yet gone (thermal runaway); an EV whose pack has
 * mostly gone is dead. A crash crushes the cells near where it hits (crushCells: hard enough,
 * they short and go into runaway).
 *
 * The people in it (placeAboard): the driver at the wheel (the clip 'carDrive', its phase the
 * steering wheel's angle: operator/rig.js carClipPose), the others seated ('carSit').
 */

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
/** Grip (μ) of a surface's material. */
export const MU = { concrete: 1, stone: 0.95, ashlar: 0.95, basalt: 0.9, bedrock: 0.85, brick: 0.85, tiles: 0.7, steel: 0.6, aluminium: 0.6, wood: 0.7, soil: 0.68, grass: 0.55, mud: 0.35, tephra: 0.6, ash: 0.5, sandstone: 0.85, ice: 0.1, water: 0.3 };
/** Hard surfaces that count as road (ai/carDriver.js prefers them). */
export const ROAD = new Set(['concrete', 'stone', 'ashlar', 'brick', 'tiles', 'basalt']);
/** What a car drives through (a body does not stop on it; the wheels do not stand on tree crowns). */
const SOFT = new Set(['grass', 'leaves', 'needles', 'twigs', 'water', 'snow']);
const NOT_GROUND = new Set(['leaves', 'needles', 'twigs', 'water']);
const isName = (set) => Uint8Array.from(MATERIALS, (m) => (set.has(m.name) ? 1 : 0));
const SOFT_M = isName(SOFT);
const NOT_GROUND_M = isName(NOT_GROUND);
const ROAD_M = isName(ROAD);
const MU_M = Float32Array.from(MATERIALS, (m) => MU[m.name] ?? 0.8);

/* ------------------------------------------------------------------ the cars */

/** A car's seats (its own frame): the driver front left, a passenger, two in the back. */
export function carSeats(S) {
  const cx1 = 0.2 * S.L, cx0 = -0.3 * S.L, z = Math.max(0.3, S.W * 0.24);
  return [
    { role: 'driver', label: 'Driver', at: [cx1 - 0.75, 0.55, -z], drive: true, who: null },
    { role: 'passenger', label: 'Front passenger', at: [cx1 - 0.75, 0.55, z], drive: false, who: null },
    { role: 'passenger', label: 'Rear left', at: [cx0 + 0.45, 0.55, -z], drive: false, who: null },
    { role: 'passenger', label: 'Rear right', at: [cx0 + 0.45, 0.55, z], drive: false, who: null },
  ];
}

/** A car of the world (or of a test: no world): its dynamics, seats, the voxels it is made of (owner). */
export function newCar(params = {}, { x = 0, y = 0, z = 0, yaw = 0, owner = -1, id } = {}) {
  const spec = carSpec(params);
  const c = makeCar(spec, { x, y, z, yaw });
  return Object.assign(c, {
    isCar: true, kind: 'car', type: 'car', id: id ?? `car-${owner}`, owner, params: { ...params },
    label: spec.heavy ? (spec.L >= 5 ? 'truck' : 'jeep') : 'car',
    seats: carSeats(spec), body: null, drive: null, player: false, burning: false, wrecked: false,
    cruise: spec.heavy ? 11 : 13,
  });
}

/** world.cars from its car objects (once). */
export function initCars(w) {
  if (w.cars) return w.cars;
  w.cars = [];
  (w.objectTree ?? []).forEach((e, k) => {
    if (e?.rec?.type !== 'car') return;
    const o = w.origins?.[k] ?? [e.rec.x ?? 0, w.h, e.rec.z ?? 0];
    w.cars.push(newCar(e.rec.params ?? {}, { x: o[0], y: o[1], z: o[2], yaw: ((e.rec.rotation ?? 0) * Math.PI) / 180, owner: k }));
  });
  w.carOwners = new Set(w.cars.map((c) => c.owner));
  for (const c of w.cars) c.world = w;
  return w.cars;
}

/** Its voxels become its body (the first time it moves or someone gets in). */
export function ensureBody(w, c) {
  if (c.body || !w || c.owner < 0 || !w.mat) return c.body;
  const S = c.spec, h = w.h;
  c.body = captureBody(w, c.owner, [c.x, c.y, c.z], c.yaw, {
    region: (l, k, B) => (B.state.vesselTag[k] < 0 ? 'fuel' : B.state.mat[k] === MAT.liion ? 'battery' : l[0] > 0.2 * S.L + h * 0.5 && l[1] < 0.95 && Math.abs(l[2]) < S.W / 2 - h * 0.6 ? 'engine' : 'body'),
  });
  c.body.pose = { x: c.x, y: c.y, z: c.z, yaw: c.yaw, pitch: 0, roll: 0 };
  c.fuel0 = regionState(c.body, 'fuel').n;
  checkState(w, c);
  return c.body;
}

/** The engine's, the tank's and the body's state from its voxels. */
export function checkState(w, c) {
  const B = c.body;
  if (!B) return;
  const eng = regionState(B, 'engine', 450);
  const left = bodyLeft(B);
  c.burning = bodyBurning(B);
  c.engineState = eng;
  c.wrecked = c.damage >= 1 || left < 0.55;
  const burnt = eng.n > 0 && (eng.alive < 0.5 * eng.n || eng.char > 0.55 || eng.hot > 0.5);
  if ((burnt || c.wrecked) && !c.dead) {
    c.dead = true;
    stopEngine(c, c.wrecked ? 'wrecked' : 'the engine has burnt');
    c.why = c.wrecked ? 'wrecked' : 'the engine has burnt';
  }
  if (c.fuel0) {
    const tank = regionState(B, 'fuel');
    c.fuel = Math.min(c.fuel, c.spec.tank * (tank.alive / c.fuel0));
  }
  // the pack: its charge no more than its cells still fresh (not gone in runaway, not lost)
  if (c.spec.battery) {
    let n = 0, fresh = 0;
    for (let k = 0; k < B.n; k++) {
      if (B.region?.[k] !== 'battery') continue;
      n++;
      if (B.alive[k] && B.state.fuel[k] >= FRESH) fresh++;
    }
    if (n) {
      c.packLeft = fresh / n;
      c.soc = Math.min(c.soc, c.packLeft);
      if (c.spec.powertrain === 'electric' && c.packLeft < 0.5 && !c.dead) {
        c.dead = true;
        stopEngine(c, 'the battery has burnt');
        c.why = 'the battery has burnt';
      }
    }
  }
}

export const carUsable = (c) => !c.dead && !c.wrecked && c.damage < 1 && !c.burning && hasEnergy(c) && (c.spec.battery || c.fuel > 0.05);
export const driverOf = (c) => c.seats.find((s) => s.drive)?.who ?? null;

/** Into seat i (or the first free one; the drive seat first for i = 'drive'): the seat index, or -1. */
export function boardCar(c, m, i = null) {
  if (c.seats.some((s) => s.who === m)) return c.seats.findIndex((s) => s.who === m);
  const k = i === 'drive' ? c.seats.findIndex((s) => s.drive && !s.who) : i ?? c.seats.findIndex((s) => !s.who);
  if (k < 0 || !c.seats[k] || c.seats[k].who) return -1;
  c.seats[k].who = m;
  c.load += m.mass ?? 85;
  if (c.world) ensureBody(c.world, c);
  return k;
}
export function leaveCar(c, m) {
  const s = c.seats.find((q) => q.who === m);
  if (!s) return;
  s.who = null;
  c.load = Math.max(0, c.load - (m.mass ?? 85));
  if (m.anim === 'carDrive' || m.anim === 'carSit') m.animPhase = null; // (his clip no longer held at the wheel's angle)
}

/** The car whose driver's door is within r of p (and at its height): or null. */
export function carNear(w, p, r = 2.2) {
  let best = null, bd = r;
  for (const c of w.cars ?? initCars(w)) {
    const d0 = carToWorld(c, [c.seats[0].at[0], 0, -(c.spec.W / 2 + 0.5)]);
    const d1 = carToWorld(c, [c.seats[0].at[0], 0, c.spec.W / 2 + 0.5]);
    for (const d of [d0, d1]) {
      const dd = Math.hypot(d[0] - p[0], d[2] - p[2]);
      if (dd < bd && Math.abs(c.y - p[1]) < 2.2) {
        bd = dd;
        best = c;
      }
    }
  }
  return best;
}

/* ------------------------------------------------------------------ the ground and what is in the way */

/** Is voxel i in the way of a car's body (not one of the cars, not grass or water)? */
function hard(w, i) {
  const m = w.mat[i];
  if (!m || SOFT_M[m]) return false;
  return !w.carOwners?.has(w.owner[i]);
}

/** The ground's top at (x, z) at or below yFrom (scanned down ≤ 8 m): { y, mu, road, material } or null. */
export function voxelGround(w, x, z, yFrom) {
  const h = w.h;
  const cx = Math.floor(x / h), cz = Math.floor(z / h);
  if (cx < 0 || cz < 0 || cx >= w.nx || cz >= w.nz) return null;
  let y = Math.min(w.ny - 1, Math.floor(yFrom / h));
  const yEnd = Math.max(0, Math.floor((yFrom - 8) / h));
  const own = w.carOwners;
  for (; y >= yEnd; y--) {
    const i = cx + w.nx * (y + w.ny * cz);
    const m = w.mat[i];
    if (!m || NOT_GROUND_M[m] || (own && own.has(w.owner[i]))) continue;
    return { y: (y + 1) * h, mu: MU_M[m], road: !!ROAD_M[m], material: MATERIALS[m].name };
  }
  return null;
}

/** The ground smoothed where the grid is coarse: the voxel steps of a slope as a ramp. */
export function smoothGround(w, x, z, yFrom) {
  const g0 = voxelGround(w, x, z, yFrom);
  const h = w.h;
  if (!g0 || h <= 0.2) return g0;
  const fx = x / h - 0.5, fz = z / h - 0.5;
  const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
  const q = [];
  for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const g = voxelGround(w, (ix + a + 0.5) * h, (iz + b + 0.5) * h, yFrom);
    if (!g || Math.abs(g.y - g0.y) > h * 1.05) return g0;
    q.push(g.y);
  }
  const y = (q[0] * (1 - tx) + q[1] * tx) * (1 - tz) + (q[2] * (1 - tx) + q[3] * tx) * tz;
  return { ...g0, y };
}

/** Anything hard in the column at (x, z) between ya and yb (or outside the world)? Its material, or null. */
export function hardIn(w, x, z, ya, yb) {
  const h = w.h;
  const cx = Math.floor(x / h), cz = Math.floor(z / h);
  if (cx < 0 || cz < 0 || cx >= w.nx || cz >= w.nz) return 'edge';
  const y0 = Math.max(0, Math.floor(ya / h)), y1 = Math.min(w.ny - 1, Math.floor(yb / h));
  for (let y = y0; y <= y1; y++) {
    const i = cx + w.nx * (y + w.ny * cz);
    if (w.mat[i] && hard(w, i)) return MATERIALS[w.mat[i]].name;
  }
  return null;
}

/** Points round the body's outline (its own frame) with their outward normals. */
function outline(c, step) {
  if (c._outline?.step === step) return c._outline.pts;
  const S = c.spec, hl = S.L / 2 - 0.02, hw = S.W / 2 - 0.02;
  const pts = [];
  const nL = Math.max(2, Math.ceil((2 * hl) / step)), nW = Math.max(2, Math.ceil((2 * hw) / step));
  for (let k = 0; k <= nW; k++) {
    const z = -hw + (2 * hw * k) / nW;
    pts.push({ l: [hl, z], n: [1, 0] }, { l: [-hl, z], n: [-1, 0] });
  }
  for (let k = 1; k < nL; k++) {
    const x = -hl + (2 * hl * k) / nL;
    pts.push({ l: [x, -hw], n: [0, -1] }, { l: [x, hw], n: [0, 1] });
  }
  c._outline = { step, pts };
  return pts;
}

/* ------------------------------------------------------------------ the environment a car is stepped in */

/**
 * What a car drives in: the ground and the collisions (sim/carPhysics.js env). ctx: { world, sim,
 * cars, people() } (no world: flat ground at y = 0, open everywhere: a test's range).
 */
export function carEnv(c, ctx) {
  const w = ctx.world;
  const env = (c._env ??= {});
  env.h = w?.h ?? 0;
  env.ground = w?.mat ? (x, z, y) => smoothGround(w, x, z, y) : (x, z) => ctx.ground?.(x, z) ?? { y: 0, mu: ctx.mu ?? 1, road: true };
  env.collide = (car, prev, dt) => collideWorld(car, prev, dt, ctx);
  return env;
}

/** The body against the voxels: stopped where its leading side meets something hard. */
function collideWorld(c, prev, dt, ctx) {
  const w = ctx.world;
  if (!w?.mat) return;
  const S = c.spec, h = w.h;
  const speed = Math.hypot(c.vx, c.vz);
  if (speed < 0.02 && Math.abs(c.wz) < 0.02) return;
  const R = carRot(c.yaw, 0, 0);
  const clear = Math.max(S.maxStep, h * 1.05) + 0.03;
  const top = c.y + S.H * 0.92;
  const tp = Math.tan(c.pitchG), tr = Math.tan(c.rollG);
  let nx = 0, nz = 0, px = 0, pz = 0, py = 0, hits = 0, vnMax = 0, what = null;
  for (const s of outline(c, clamp(h, 0.2, 0.5))) {
    const ox = R[0] * s.l[0] + R[2] * s.l[1], oz = R[6] * s.l[0] + R[8] * s.l[1];
    const wnx = R[0] * s.n[0] + R[2] * s.n[1], wnz = R[6] * s.n[0] + R[8] * s.n[1];
    // the point's velocity: v + ω × r (ω about +y)
    const vpx = c.vx + c.wz * oz, vpz = c.vz - c.wz * ox;
    const vn = vpx * wnx + vpz * wnz;
    if (vn <= 0.01) continue;
    const gy = c.y + s.l[0] * tp - s.l[1] * tr;
    const m = hardIn(w, c.x + ox, c.z + oz, gy + clear, Math.max(gy + clear, top));
    if (!m) continue;
    hits++;
    nx += wnx;
    nz += wnz;
    px += c.x + ox;
    pz += c.z + oz;
    py += gy + clear + 0.2;
    if (vn > vnMax) {
      vnMax = vn;
      what = m;
    }
  }
  if (!hits) return;
  const nl = Math.hypot(nx, nz) || 1;
  nx /= nl;
  nz /= nl;
  // back to where it was; the closing part of its velocity taken out (a little bounce)
  c.x = prev.x;
  c.z = prev.z;
  c.yaw = prev.yaw;
  const vn = c.vx * nx + c.vz * nz;
  if (vn > 0) {
    c.vx -= 1.15 * vn * nx;
    c.vz -= 1.15 * vn * nz;
  }
  c.wz *= 0.4;
  const p = [px / hits, py / hits, pz / hits];
  hitSomething(c, ctx, p, vnMax, [nx, 0, nz], what === 'edge' ? 'concrete' : what);
}

/** It hit something at p, closing at v along n: damage, the impact (what it breaks, the sound). */
function hitSomething(c, ctx, p, v, n, material) {
  if (v < 2 || c.t - (c._hitT ?? -9) < 0.35) return;
  c._hitT = c.t;
  const m = massOf(c);
  c.damage = Math.min(1, c.damage + (v / 26) ** 2);
  sfx(c, 'crash', { v, p, material });
  if (c.spec.battery && ctx.world?.mat) crushCells(ctx.world, p, 0.6 + v * 0.05, clamp((v - 8) / 12, 0, 1.2));
  if (ctx.sim) impact(ctx.sim, { pos: p, mass: m, velocity: n.map((x) => x * v), materials: ['steel', material ?? 'concrete'], kind: 'vehicle', name: c.label, radius: 0.4, size: 1.5, from: [c.x, c.y + 1, c.z] });
  if (c.damage >= 1 && !c.dead) {
    c.dead = true;
    c.wrecked = true;
    c.why = 'wrecked';
  }
}

/** Two cars' boxes (2D): the normal (a → b) and depth they overlap by, or null. */
function overlap(a, b) {
  const box = (c) => {
    const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
    return { p: [c.x, c.z], ax: [[cy, -sy], [sy, cy]], e: [c.spec.L / 2, c.spec.W / 2] };
  };
  const A = box(a), B = box(b);
  const d = [B.p[0] - A.p[0], B.p[1] - A.p[1]];
  if (Math.hypot(d[0], d[1]) > (Math.hypot(...A.e) + Math.hypot(...B.e))) return null;
  let best = null;
  for (const ax of [...A.ax, ...B.ax]) {
    const r = (X) => X.e[0] * Math.abs(X.ax[0][0] * ax[0] + X.ax[0][1] * ax[1]) + X.e[1] * Math.abs(X.ax[1][0] * ax[0] + X.ax[1][1] * ax[1]);
    const dist = d[0] * ax[0] + d[1] * ax[1];
    const pen = r(A) + r(B) - Math.abs(dist);
    if (pen <= 0) return null;
    if (!best || pen < best.pen) best = { pen, n: dist < 0 ? [-ax[0], -ax[1]] : [ax[0], ax[1]] };
  }
  return best;
}

/** Cars against each other: pushed apart, momentum exchanged along the normal (e = 0.2). */
function collideCars(cars, ctx) {
  for (let i = 0; i < cars.length; i++)
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j];
      if (Math.hypot(a.vx, a.vz) + Math.hypot(b.vx, b.vz) < 0.01) continue;
      const o = overlap(a, b);
      if (!o) continue;
      const ma = massOf(a), mb = massOf(b);
      const [nx, nz] = o.n;
      const ka = mb / (ma + mb), kb = ma / (ma + mb);
      a.x -= nx * o.pen * ka;
      a.z -= nz * o.pen * ka;
      b.x += nx * o.pen * kb;
      b.z += nz * o.pen * kb;
      const vn = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
      if (vn >= 0) continue;
      const J = (-(1 + 0.2) * vn) / (1 / ma + 1 / mb);
      a.vx -= (J / ma) * nx;
      a.vz -= (J / ma) * nz;
      b.vx += (J / mb) * nx;
      b.vz += (J / mb) * nz;
      a.wz *= 0.6;
      b.wz *= 0.6;
      const p = [(a.x + b.x) / 2, Math.max(a.y, b.y) + 0.7, (a.z + b.z) / 2];
      for (const c of [a, b]) {
        if (-vn < 2 || c.t - (c._hitT ?? -9) < 0.35) continue;
        c._hitT = c.t;
        c.damage = Math.min(1, c.damage + (-vn / 30) ** 2);
        sfx(c, 'crash', { v: -vn, p, material: 'steel' });
        if (c.spec.battery && ctx.world?.mat) crushCells(ctx.world, p, 0.6 - vn * 0.05, clamp((-vn - 8) / 12, 0, 1.2));
      }
      if (-vn >= 2 && ctx.sim) impact(ctx.sim, { pos: p, mass: (ma * mb) / (ma + mb), velocity: [-vn * nx, 0, -vn * nz], materials: ['steel', 'steel'], kind: 'vehicle', name: 'cars', radius: 0.4, size: 1.5, effects: { crush: false } });
    }
}

/** People in its way: hurt and knocked aside at speed (an impact), stopped for when it is slow. */
function collidePeople(c, ctx) {
  const people = ctx.people?.() ?? [];
  if (!people.length) return;
  const S = c.spec, cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
  for (const e of people) {
    if (!e?.p || e.dead || e.aboard === c.id || c.seats.some((s) => s.who === e)) continue;
    const dx = e.p[0] - c.x, dz = e.p[2] - c.z;
    const lx = dx * cy - dz * sy, lz = dx * sy + dz * cy;
    if (Math.abs(lx) > S.L / 2 + 0.35 || Math.abs(lz) > S.W / 2 + 0.35 || Math.abs(e.p[1] - c.y) > S.H + 0.5) continue;
    // the car's speed at him, towards him
    const vpx = c.vx + c.wz * dz, vpz = c.vz - c.wz * dx;
    const outLocal = Math.abs(lx) / (S.L / 2) > Math.abs(lz) / (S.W / 2) ? [Math.sign(lx), 0] : [0, Math.sign(lz) || 1];
    const nx = outLocal[0] * cy + outLocal[1] * sy, nz = -outLocal[0] * sy + outLocal[1] * cy;
    const vn = vpx * nx + vpz * nz;
    if (vn <= 0.05) continue;
    const seen = (c._hitPeople ??= new Map());
    if (vn > 2 && c.t - (seen.get(e) ?? -9) > 1) {
      seen.set(e, c.t);
      if (e.player) ctx.world?.playerHits?.push({ zone: vn > 6 ? 'torso' : 'legs', weapon: 'vehicle' });
      else if (ctx.sim) impact(ctx.sim, { target: e, mass: massOf(c), velocity: [vpx, 0, vpz], materials: ['steel', 'flesh'], kind: 'vehicle', name: c.label, zone: 'legs', radius: 0.25, effects: { crush: false } });
      sfx(c, 'thud', { v: vn, p: e.p.slice() });
      // he goes off its side; the car gives up his share of its momentum
      if (!e.player) {
        const side = Math.sign(lz) || 1;
        e.p = [c.x + (lx * cy + side * (S.W / 2 + 0.5) * sy), e.p[1], c.z + (-lx * sy + side * (S.W / 2 + 0.5) * cy)];
      }
      const k = massOf(c) / (massOf(c) + 85);
      c.vx *= k;
      c.vz *= k;
    } else if (vn <= 2) {
      // slow: it stops against him
      c.vx -= vn * nx;
      c.vz -= vn * nz;
    }
  }
}

/* ------------------------------------------------------------------ stepping */

/** Who is at the wheel and what they do: you (c.player: walk/carDrive.js sets c.input), an AI (c.drive), no one (parked). */
function controls(c, dt, ctx) {
  const d = driverOf(c);
  if (c.player) return;
  if (d && !d.dead && c.drive && !c.drive.done) {
    if (!c.running && c.crank <= 0 && carUsable(c)) startEngine(c);
    stepDriver(c, dt, ctx);
    return;
  }
  // no one driving: in park, the brake on (the engine left running if it was, unless no one is in it)
  setMode(c, 'P');
  c.input = { throttle: 0, brake: 1, steer: 0, handbrake: true };
  if (!d && c.running && !c.keepRunning) stopEngine(c, 'off');
}

/** Step a list of cars by dt in ctx ({ world?, sim?, people?() }: sim/cars.js stepCars; a test). */
export function stepCarList(cars, dt, ctx = {}) {
  const w = ctx.world;
  const active = [];
  for (const c of cars) {
    controls(c, dt, ctx);
    const inp = c.input ?? {};
    const moving = Math.hypot(c.vx, c.vz) > 0.01 || Math.abs(c.wz) > 0.01 || c.vy !== 0 || c.air;
    if (!(moving || c.running || c.crank > 0 || (inp.throttle ?? 0) > 0)) continue;
    if (w?.mat) ensureBody(w, c);
    active.push(c);
  }
  if (!active.length) return;
  const n = Math.max(1, Math.ceil(dt / CAR_SUBSTEP - 1e-6)), ds = dt / n;
  for (const c of active) carEnv(c, ctx);
  for (let s = 0; s < n; s++) {
    for (const c of active) subStep(c, ds, c._env);
    if (cars.length > 1) collideCars(cars, ctx);
  }
  for (const c of active) {
    collidePeople(c, ctx);
    placeAboard(c);
    if (!w?.mat || !c.body) continue;
    c.checkT = (c.checkT ?? 0) - dt;
    if (c.checkT <= 0) {
      c.checkT = 0.5;
      checkState(w, c);
    }
    restamp(w, c);
  }
}

/** Its voxels put where it is now, when it has moved far enough to land in other cells. */
function restamp(w, c) {
  const B = c.body, P = B.pose, S = c.spec;
  const moving = Math.hypot(c.vx, c.vz) > 0.25 || Math.abs(c.wz) > 0.05;
  if (moving) c.lastMoveT = c.t;
  const hide = c.t - (c.lastMoveT ?? -9) < 1.2;
  const d = Math.abs(c.x - P.x) + Math.abs(c.y - P.y) + Math.abs(c.z - P.z) + angle(c.yaw - P.yaw) * S.L * 0.5 + Math.abs(c.pitch - P.pitch) * S.L * 0.5 + Math.abs(c.roll - P.roll) * S.W * 0.5;
  if (d < w.h * 0.4 && hide === !!B.hidden) return;
  const r = stampBody(w, B, { x: c.x, y: c.y, z: c.z, yaw: c.yaw, pitch: c.pitch, roll: c.roll }, { hidden: hide });
  c.stampBlocked = r.blocked;
  syncVessels(w, c);
}

/**
 * Its fuel tank (sim/vessels.js) after the voxels moved: the tank counts its shell's cells to see
 * a hole, and moved (turned) they are more or fewer than it was built with. So its count is
 * taken again each time; a shell voxel really gone (burnt or blown through) is a hole: it leaks.
 */
function syncVessels(w, c) {
  const B = c.body;
  for (const v of w.vessels ?? []) {
    if (v.owner !== c.owner || v.state === 'leaking' || v.state === 'ruptured' || v.state === 'empty') continue;
    const tag = w.vessels.indexOf(v) + 1;
    let alive = 0, cells = 0;
    for (let k = 0; k < B.n; k++) if (B.state.vesselTag[k] === tag && B.alive[k]) alive++;
    for (let j = 0; j < B.nCells; j++) if (B.state.vesselTag[B.cellK[j]] === tag) cells++;
    v.carShell ??= alive;
    if (alive < v.carShell) {
      // a hole: the contents run out (as sim/vessels.js has a tank leak)
      v.state = 'leaking';
      v.pressure = 0;
      for (let j = 0; j < B.nCells; j++) {
        const i = B.cells[j];
        if (w.vesselTag[i] === -tag) {
          w.vesselTag[i] = 0;
          w.flags[i] |= F_LIQUID;
          w.melt[i] = 1;
        }
      }
      w.events?.push({ type: 'leak', pos: [c.x, c.y + 0.4, c.z], time: w.time, name: v.name });
      continue;
    }
    v.carShell = alive;
    v.shellCount0 = cells;
  }
}
const angle = (a) => Math.abs(((a + Math.PI) % TAU + TAU) % TAU - Math.PI);

/** A seat's figure root (his feet: the seat's top less SEAT_DROP) in the car's frame. */
export const SEAT_DROP = 0.45;
/**
 * The men in its seats put there (not you: walk/carDrive.js puts you): the driver's hands on the
 * steering wheel at its angle (the clip 'carDrive' held at wheelPhase), the others seated ('carSit').
 */
export function placeAboard(c) {
  for (const s of c.seats) {
    const m = s.who;
    if (!m || m.player) continue;
    m.p = carToWorld(c, [s.at[0], s.at[1] - SEAT_DROP, s.at[2]]);
    m.yaw = c.yaw + Math.PI / 2;
    m.moving = false;
    m.speed = 0;
    if (!m.dead && !m.vehFiring) {
      m.anim = m.down ? 'woundedDown' : s.drive ? 'carDrive' : 'carSit';
      m.animPhase = m.anim === 'carDrive' ? wheelPhase(c.wheelAngle ?? 0) : null;
    }
  }
}

/** The world's cars, each frame (sim/simulation.js). */
export function stepCars(sim, dt) {
  const w = sim.world;
  if (!w.cars) {
    if (!(w.objectTree ?? []).some((e) => e?.rec?.type === 'car')) return;
    initCars(w);
  }
  if (!w.cars.length) return;
  for (const c of w.cars) c.world = w;
  const ctx = (w._carCtx ??= {
    world: w, sim, hardIn,
    people: () => {
      const out = w.enemies.filter((e) => !e.dead && !e.aboard);
      if (sim.ai?.player?.p) out.push({ ...sim.ai.player, player: true });
      return out;
    },
  });
  ctx.sim = sim;
  stepCarList(w.cars, dt, ctx);
}
