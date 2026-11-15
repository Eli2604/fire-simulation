/**
 * An AI at the wheel of a car (sim/cars.js, sim/carPhysics.js): driveTo(car, target, { speed })
 * and the world steps it there (stepCars → stepDriver each frame, while a man sits in its drive
 * seat). Pure logic, no three.js.
 *
 *  - The way: a route over a grid of the ground (navGrid: 1 m cells, or 2 voxels on a fine grid):
 *    each cell's height (the lowest surface with a car's headroom over it), whether it can be
 *    driven (not water, nothing standing in it: a wall, a tree, a building; not a step of more than
 *    ~0.6 m to its neighbour), and whether it is road (concrete, stone: the military base's roads,
 *    the street). A* over it (8 neighbours), off-road costing 2.2 × a road's and close to what
 *    stands in the way more: so it keeps to the roads where there are any, takes the shortest way
 *    where there are none, and keeps clear of walls. The route is straightened where a straight
 *    line stays on the same kind of ground. No world (a test's open range): straight there.
 *  - Steering: pure pursuit: the point a look-ahead (4 m + 0.45 s × speed) along the route, the
 *    wheel turned for the arc through it (δ = atan(2·L·sin α / d)).
 *  - Speed: its cruise (o.speed), less in a bend (the lateral acceleration it takes: ≤ 3.5 m/s²),
 *    braking to stop at the end (≤ 3 m/s²), and for what is ahead (another car, a man, a wall:
 *    probed along its way; stopped for it 3 m short); a man or a car just off its line: it steers
 *    round it.
 *  - Stuck (it does not move for 2 s with its foot down): it backs up 2 s, wheel the other way,
 *    and plans again. At the end (within o.radius, 3 m) it stops: drive.done.
 *  - Gates (sim/gates.js: the military base's barrier): passable-with-request on the map (a
 *    closed one costs GATE_COST a cell more). A route through a closed gate: it slows and stops
 *    short of the arm (its bumper GATE_STOP m off), radios the base ("Base, Kilo, at the gate,
 *    request gate open, over": its squad's call sign, o.callsign, else the car's: "Jeep 1"),
 *    waits for the arm to go up and drives through; past it: "Base, Kilo, through, close the
 *    gate". Refused or no answer (GATE_WAIT s): in an emergency (o.urgent: a retreat under fire)
 *    it rams the arm; else it plans round the gate (not through it) and takes that way if there
 *    is one; none: it waits by it and calls again. Every step in drive.log ('gate:request',
 *    'gate:wait', 'gate:through', 'gate:denied', 'gate:reroute', 'gate:ram', …) and o.log.
 */
import { carRot, pedals, setMode } from '../sim/carPhysics.js';
import { MATERIALS } from '../sim/materials.js';
import { initGates, gatePassable, gateSide, requestGate, gateThrough, smashGate, callsignOf, gateRadio } from '../sim/gates.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Drive car to target ([x, y, z]); o: { speed (m/s), radius, callsign (on the radio at a gate),
 * urgent (an emergency: a gate refused is rammed), log (s) => … (its gate steps, as they happen) }.
 * Returns the drive (car.drive).
 */
export function driveTo(car, target, o = {}) {
  car.drive = { target: target.slice(), speed: o.speed ?? car.cruise ?? 10, radius: o.radius ?? 3, path: null, i: 0, stuckT: 0, backT: 0, done: false, plans: 0, log: [], callsign: o.callsign ?? null, urgent: !!o.urgent, onLog: o.log ?? null, avoid: new Set() };
  return car.drive;
}
export function stopDriving(car) {
  if (car.drive) car.drive.done = true;
  car.input = { throttle: 0, brake: 1, steer: 0, handbrake: true };
}

/* ------------------------------------------------------------------ the map */

const CLEAR = 1.9; // m of headroom a car needs over a surface
const NAV_MAX = 300 * 300;

/**
 * The ground as a car sees it (built once per world, kept in w._carNav): cells of `cs` m with
 * their height, drivable or not, road or not, the distance (cells) to the nearest undrivable, and
 * the gates (sim/gates.js: G.gate, its index + 1): a gate's arm is not counted as in the way (its
 * cells are passable-with-request: what they cost depends on the gate's state when the route is
 * planned, cellCost). Where the ground changes (a gate rammed, w.navDirty boxes) it is built
 * again there only (refreshNav).
 */
export function navGrid(w) {
  if (w._carNav !== undefined) {
    if (w._carNav && w.navDirty?.length) {
      for (const b of w.navDirty) refreshNav(w, b);
      w.navDirty = [];
    }
    return w._carNav;
  }
  if (!w?.mat) return (w._carNav = null);
  const h = w.h;
  const cs = Math.max(1, 2 * h);
  const nx = Math.floor(w.size[0] / cs), nz = Math.floor(w.size[2] / cs);
  if (nx * nz > NAV_MAX) return (w._carNav = null);
  const N = nx * nz;
  const G = { cs, nx, nz, h, height: new Float32Array(N), ok: new Uint8Array(N), road: new Uint8Array(N), dist: new Uint8Array(N), gate: new Uint8Array(N) };
  gateTags(w, G);
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) navCell(w, G, i, k);
  navDist(G, 0, 0, nx - 1, nz - 1);
  w.navDirty = [];
  return (w._carNav = G);
}

/** The gates' doors (tags) and the cells their arms are over. */
function gateTags(w, G) {
  const gates = initGates(w);
  G.gateDoor = new Map(); // door tag → gate index
  gates.forEach((g, k) => {
    if (g.door >= 0) G.gateDoor.set(g.door + 1, k);
    const B = g.box;
    for (let x = B.min[0]; x < B.max[0] + 1e-6; x += G.cs / 2)
      for (let z = B.min[2]; z < B.max[2] + 1e-6; z += G.cs / 2) {
        const c = cellOf(G, Math.min(x, B.max[0] - 1e-3), Math.min(z, B.max[2] - 1e-3));
        if (c >= 0) G.gate[c] = k + 1;
      }
  });
}

/** One cell of the map from the voxels under it. */
function navCell(w, G, i, k) {
  const h = w.h, cs = G.cs;
  const per = Math.max(1, Math.round(cs / h));
  const own = w.carOwners ?? new Set();
  const mats = w.mat;
  const gd = G.gateDoor;
  const need = Math.ceil(CLEAR / h);
  // a column's surface: the lowest top of something with CLEAR m of air (or soft stuff, or a
  // gate's arm) over it
  const surf = (cx, cz) => {
    let top = -1, run = 0, under = 0;
    for (let y = 0; y < w.ny; y++) {
      const i = cx + w.nx * (y + w.ny * cz);
      const m = mats[i];
      const empty = !m || own.has(w.owner[i]) || VEG[m] || (gd.size && w.doorTag?.[i] && gd.has(w.doorTag[i]));
      if (empty) {
        if (top >= 0) {
          run++;
          if (run >= need) return { y: (top + 1) * h, m: under };
        }
      } else {
        top = y;
        under = m;
        run = 0;
      }
    }
    return top >= 0 ? { y: (top + 1) * h, m: under } : null;
  };
  const c = i + G.nx * k;
  let lo = Infinity, hi = -Infinity, wet = false, roads = 0, n = 0;
  const ys = [];
  for (let a = 0; a < per; a++)
    for (let b = 0; b < per; b++) {
      const cx = Math.floor((i * cs) / h) + a, cz = Math.floor((k * cs) / h) + b;
      if (cx >= w.nx || cz >= w.nz) continue;
      const s = surf(cx, cz);
      n++;
      if (!s) {
        wet = true;
        continue;
      }
      if (WATER[s.m]) wet = true;
      if (ROADM[s.m]) roads++;
      ys.push(s.y);
      lo = Math.min(lo, s.y);
      hi = Math.max(hi, s.y);
    }
  ys.sort((p, q) => p - q);
  G.height[c] = ys.length ? ys[ys.length >> 1] : 0;
  G.ok[c] = !wet && ys.length && hi - lo <= Math.max(0.6, 1.05 * h) ? 1 : 0;
  G.road[c] = roads * 2 > n ? 1 : 0;
}

/** The distance (cells, 8-neighbour) to the nearest undrivable cell, over the cells i0..i1, k0..k1. */
function navDist(G, i0, k0, i1, k1) {
  const { nx } = G;
  const dist = G.dist;
  const q = [];
  for (let k = k0; k <= k1; k++)
    for (let i = i0; i <= i1; i++) {
      const c = i + nx * k;
      // (the edge of a patch: what it is now, as seed from outside)
      const edge = i === i0 || k === k0 || i === i1 || k === k1;
      if (!G.ok[c]) {
        dist[c] = 0;
        q.push(c);
      } else if (edge && (i0 > 0 || k0 > 0 || i1 < nx - 1 || k1 < G.nz - 1)) q.push(c);
      else dist[c] = 255;
    }
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi], i = c % nx, k = (c - i) / nx;
    for (let dk = -1; dk <= 1; dk++)
      for (let di = -1; di <= 1; di++) {
        const a = i + di, b = k + dk;
        if (a < i0 || b < k0 || a > i1 || b > k1) continue;
        const e = a + nx * b;
        if (dist[e] > dist[c] + 1) {
          dist[e] = dist[c] + 1;
          q.push(e);
        }
      }
  }
}

/** The map built again over a box ([x0, z0, x1, z1], world m) where the ground has changed. */
export function refreshNav(w, box) {
  const G = w._carNav;
  if (!G) return;
  const i0 = Math.max(0, Math.floor(box[0] / G.cs)), k0 = Math.max(0, Math.floor(box[1] / G.cs));
  const i1 = Math.min(G.nx - 1, Math.floor(box[2] / G.cs)), k1 = Math.min(G.nz - 1, Math.floor(box[3] / G.cs));
  for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) navCell(w, G, i, k);
  // the distances: over the box and a margin (they reach a few cells), seeded from the margin's edge
  const M = 6;
  navDist(G, Math.max(0, i0 - M), Math.max(0, k0 - M), Math.min(G.nx - 1, i1 + M), Math.min(G.nz - 1, k1 + M));
  G.version = (G.version ?? 0) + 1;
}

const byName = (names) => Uint8Array.from(MATERIALS, (m) => (names.includes(m.name) ? 1 : 0));
const VEG = byName(['grass', 'leaves', 'needles', 'twigs', 'snow']);
const WATER = byName(['water']);
const ROADM = byName(['concrete', 'stone', 'ashlar', 'brick', 'tiles', 'basalt']);

const cellOf = (G, x, z) => {
  const i = Math.floor(x / G.cs), k = Math.floor(z / G.cs);
  return i < 0 || k < 0 || i >= G.nx || k >= G.nz ? -1 : i + G.nx * k;
};
const centre = (G, c) => {
  const i = c % G.nx;
  return [(i + 0.5) * G.cs, G.height[c], ((c - i) / G.nx + 0.5) * G.cs];
};

/** A closed gate's cells cost this much more (it takes a call and a wait: passable-with-request). */
export const GATE_COST = 30;

/** Cost of entering cell c (Infinity: not for a car); ends.gateCost: a gate's cells' extra (or Infinity: avoided). */
function cellCost(G, c, ends) {
  const gx = G.gate?.[c] && ends.gateCost ? ends.gateCost(G.gate[c] - 1) : 0;
  if (gx === Infinity) return Infinity;
  if (ends.has(c)) return (G.road[c] ? 1 : 2.2) + gx;
  if (!G.ok[c]) return Infinity;
  const d = G.dist[c] * G.cs;
  if (d < 1.6) return Infinity; // (no room for its width)
  return (G.road[c] ? 1 : 2.2) + (d < 2.6 ? 2 : d < 3.6 ? 0.6 : 0) + gx;
}

/**
 * A* from a to b (world points) over G: the cells' centres, or null. o: { gates (the world's,
 * sim/gates.js: a closed one costs GATE_COST a cell more, an open one nothing), avoid (a Set of
 * gate indices not to go through: refused, unanswered) }.
 */
export function planPath(G, a, b, o = {}) {
  const s = cellOf(G, a[0], a[2]), t = cellOf(G, b[0], b[2]);
  if (s < 0 || t < 0) return null;
  const N = G.nx * G.nz;
  const g = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const heap = [];
  const push = (c, f) => {
    heap.push([f, c]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  const ends = new Set();
  const gates = o.gates ?? [];
  ends.gateCost = (k) => (o.avoid?.has(k) ? Infinity : gates[k] && gatePassable(gates[k]) ? 0 : GATE_COST);
  // (the start and the end: a few cells round them are let through, a car may stand by a wall)
  for (const e of [s, t]) {
    const i0 = e % G.nx, k0 = (e - i0) / G.nx;
    for (let dk = -2; dk <= 2; dk++) for (let di = -2; di <= 2; di++) {
      const i = i0 + di, k = k0 + dk;
      if (i >= 0 && k >= 0 && i < G.nx && k < G.nz && G.ok[i + G.nx * k]) ends.add(i + G.nx * k);
    }
    ends.add(e);
  }
  const ti = t % G.nx, tk = (t - ti) / G.nx;
  const hEst = (c) => {
    const i = c % G.nx, k = (c - i) / G.nx;
    return Math.hypot(i - ti, k - tk) * G.cs;
  };
  g[s] = 0;
  push(s, hEst(s));
  const step = Math.max(0.6, 1.05 * G.h);
  while (heap.length) {
    const [, c] = pop();
    if (closed[c]) continue;
    closed[c] = 1;
    if (c === t) break;
    const i = c % G.nx, k = (c - i) / G.nx;
    for (let dk = -1; dk <= 1; dk++)
      for (let di = -1; di <= 1; di++) {
        if (!di && !dk) continue;
        const a = i + di, b = k + dk;
        if (a < 0 || b < 0 || a >= G.nx || b >= G.nz) continue;
        const e = a + G.nx * b;
        if (closed[e]) continue;
        if (Math.abs(G.height[e] - G.height[c]) > step * (di && dk ? 1.4 : 1)) continue;
        // (diagonally: not through the corner of something)
        if (di && dk && (cellCost(G, i + di + G.nx * k, ends) === Infinity || cellCost(G, i + G.nx * (k + dk), ends) === Infinity)) continue;
        const cc = cellCost(G, e, ends);
        if (cc === Infinity) continue;
        const ng = g[c] + cc * G.cs * (di && dk ? Math.SQRT2 : 1);
        if (ng < g[e]) {
          g[e] = ng;
          from[e] = c;
          push(e, ng + hEst(e));
        }
      }
  }
  // (it cannot get there: as near as it can)
  let end = t;
  if (!closed[t]) {
    let bd = Infinity;
    for (let c = 0; c < N; c++)
      if (closed[c] && hEst(c) < bd) {
        bd = hEst(c);
        end = c;
      }
    if (end === s || bd === Infinity) return null;
  }
  const cells = [];
  for (let c = end; c >= 0; c = from[c]) cells.push(c);
  cells.reverse();
  return straighten(G, cells, ends).map((c) => centre(G, c));
}

/** Leave out the cells a straight line can skip (on ground of the same kind: road stays road). */
function straighten(G, cells, ends) {
  if (cells.length < 3) return cells;
  const out = [cells[0]];
  let i = 0;
  while (i < cells.length - 1) {
    let j = cells.length - 1;
    for (; j > i + 1; j--) if (lineOk(G, cells[i], cells[j], ends)) break;
    out.push(cells[j]);
    i = j;
  }
  return out;
}
function lineOk(G, a, b, ends) {
  const ai = a % G.nx, ak = (a - ai) / G.nx, bi = b % G.nx, bk = (b - bi) / G.nx;
  const n = Math.ceil(Math.max(Math.abs(bi - ai), Math.abs(bk - ak)) * 2);
  const rd = G.road[a] && G.road[b];
  for (let s = 1; s < n; s++) {
    const i = Math.round(ai + ((bi - ai) * s) / n), k = Math.round(ak + ((bk - ak) * s) / n);
    const c = i + G.nx * k;
    const cc = cellCost(G, c, ends);
    if (cc === Infinity || cc > (rd ? 1 : 2.2) + 0.01) return false;
    if (rd && !G.road[c]) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ at the wheel */

/** What is ahead of the car along its way within `range` m: the distance to it, and how far off its line (+ right). */
function ahead(car, ctx, range, skip = null) {
  let best = null;
  const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
  const S = car.spec;
  const look = (p, r, what) => {
    const dx = p[0] - car.x, dz = p[2] - car.z;
    const lx = dx * cy - dz * sy, lz = dx * sy + dz * cy;
    if (lx < S.L / 2 - 0.5 || lx > range + S.L / 2) return;
    if (Math.abs(lz) > S.W / 2 + r + 0.6) return;
    const d = lx - S.L / 2 - r;
    if (!best || d < best.d) best = { d, off: lz, what };
  };
  for (const o of ctx.cars ?? ctx.world?.cars ?? []) if (o !== car) look([o.x, o.y, o.z], Math.max(o.spec.W, o.spec.L) / 2, 'car');
  for (const e of ctx.people?.() ?? []) if (!e.dead && e.aboard !== car.id && !car.seats.some((s) => s.who === e)) look(e.p, 0.4, 'man');
  // walls: the voxels a little over its bumper, along its heading
  const w = ctx.world;
  if (w?.mat && ctx.hardIn) {
    const R = carRot(car.yaw);
    for (let d = 0.5; d < range; d += Math.max(0.5, w.h)) {
      let hit = false;
      for (const z of [-S.W / 2 + 0.2, 0, S.W / 2 - 0.2]) {
        const lx = S.L / 2 + d;
        const x = car.x + R[0] * lx + R[2] * z, zz = car.z + R[6] * lx + R[8] * z;
        if (skip?.(x, zz)) continue; // (a gate's arm: the gate's business, gateStep)
        if (ctx.hardIn(w, x, zz, car.y + Math.max(0.5, w.h * 1.1), car.y + S.H * 0.8)) {
          hit = true;
          break;
        }
      }
      if (hit) {
        if (!best || d < best.d) best = { d, off: 0, what: 'wall' };
        break;
      }
    }
  }
  return best;
}

/** One frame at the wheel: car.input from the route, what is ahead, being stuck. */
export function stepDriver(car, dt, ctx = {}) {
  const D = car.drive;
  if (!D || D.done) return;
  const S = car.spec;
  const p = [car.x, car.y, car.z];
  const toEnd = Math.hypot(D.target[0] - p[0], D.target[2] - p[2]);
  if (toEnd < D.radius) {
    D.done = true;
    D.log.push('arrived');
    car.input = { throttle: 0, brake: 1, steer: 0, handbrake: Math.abs(car.u) < 0.5 };
    setMode(car, Math.abs(car.u) < 0.5 ? 'P' : car.mode);
    return;
  }
  if (!D.path) {
    const G = ctx.world ? navGrid(ctx.world) : null;
    const gates = G ? initGates(ctx.world) : [];
    D.path = (G && planPath(G, p, D.target, { gates, avoid: D.avoid })) || [D.target.slice()];
    D.plans++;
    D.i = 0;
    D.log.push(`plan:${D.path.length}`);
    if (G) D.onRoad = D.path.map((q) => G.road[cellOf(G, q[0], q[2])] === 1);
    D.gates = G ? gatesOnPath(G, gates, p, D.path) : [];
    D.gi = 0;
    D.nearGate = false;
  }
  // backing out of where it is stuck
  if (D.backT > 0) {
    D.backT -= dt;
    const pd = pedals(car, 0, 0.6);
    car.input = { ...pd, steer: D.backSteer, handbrake: false };
    if (D.backT <= 0) {
      D.path = null;
      setMode(car, 'D');
    }
    return;
  }
  // the point to aim at: a look-ahead along the route
  const speed = Math.abs(car.u);
  // (closer by a gate: a gateway is no place to cut the corner)
  const Ld = D.nearGate ? 3 : 4 + 0.45 * speed;
  while (D.i < D.path.length - 1 && Math.hypot(D.path[D.i][0] - p[0], D.path[D.i][2] - p[2]) < Ld) D.i++;
  let aim = D.path[D.i];
  if (D.i > 0 && D.i < D.path.length) {
    // (on the segment into it, Ld from the car where it can be)
    const a = D.path[D.i - 1], b = D.path[D.i];
    const t = segPoint(a, b, p, Ld);
    if (t) aim = t;
  }
  const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
  const dx = aim[0] - p[0], dz = aim[2] - p[2];
  const lx = dx * cy - dz * sy, lz = dx * sy + dz * cy;
  const alpha = Math.atan2(-lz, lx); // (+ left)
  const ld = Math.max(1, Math.hypot(lx, lz));
  const wb = S.a + S.b;
  let delta = Math.atan2(2 * wb * Math.sin(alpha), ld);
  if (lx < 0) delta = Math.sign(alpha || 1) * S.maxSteer;
  // a gate on the way: stop short of it, call, wait, through (gateStep)
  const gs = gateStep(car, D, ctx, dt);
  // what is ahead: slow, stop, steer round
  const ob = ahead(car, ctx, 8 + speed * 1.2, gs?.skip);
  let vObs = Infinity;
  // (a wall it has stood in front of for a while: back off, plan again; three times: it gives up)
  if (ob?.what === 'wall' && ob.d < 3.2 && speed < 0.3) D.wallT = (D.wallT ?? 0) + dt;
  else D.wallT = 0;
  if (D.wallT > 2.5) {
    D.wallT = 0;
    D.walls = (D.walls ?? 0) + 1;
    D.log.push('blocked');
    if (D.walls >= 3) {
      D.done = true;
      D.failed = true;
      car.input = { throttle: 0, brake: 1, steer: 0, handbrake: true };
      return;
    }
    D.backT = 2;
    // backing off: lock to the side that swings the nose towards where it is going (in reverse the
    // steering turns it the other way), the other side on the next try: no coin toss
    D.backSteer = -Math.sign(alpha || 1) * (D.walls % 2 ? 1 : -1);
    return;
  }
  if (ob) {
    vObs = Math.sqrt(2 * 4 * Math.max(0, ob.d - 2.5));
    // (a car or a man a little off its line: round him, on the side away from him)
    if (ob.what !== 'wall' && Math.abs(ob.off) > 0.3 && ob.d < 12) delta += Math.sign(ob.off) * 0.25 * (1 - ob.d / 12);
  }
  const steer = clamp(delta / S.maxSteer, -1, 1);
  // the speed it wants: its cruise, the bend, the end, what is ahead
  const kappa = Math.abs(Math.tan(clamp(delta, -S.maxSteer, S.maxSteer))) / wb;
  const vBend = Math.sqrt(3.5 / Math.max(kappa, 1e-3));
  const vEnd = Math.sqrt(2 * 3 * Math.max(0, toEnd - D.radius * 0.5));
  const vWant = Math.min(D.speed, vBend, vEnd + 0.8, vObs, gs?.vCap ?? Infinity, cornerSpeed(D, p, -car.yaw));
  const e = vWant - car.u;
  let thr = clamp(0.15 + e * 0.35, 0, 1), brk = clamp(-e * 0.5, 0, 1);
  if (vWant < 0.2 && car.u < 0.3) {
    thr = 0;
    brk = 1;
  }
  if (car.mode !== 'D') setMode(car, 'D');
  car.input = { throttle: thr, brake: brk, steer, handbrake: false };
  D.seen = { ahead: ob, want: vWant };
  // stuck: the foot down, not going
  if (thr > 0.3 && speed < 0.3 && car.running) D.stuckT += dt;
  else D.stuckT = Math.max(0, D.stuckT - dt);
  if (D.stuckT > 2) {
    D.stuckT = 0;
    D.backT = 2;
    D.backSteer = -steer || 1;
    D.log.push('stuck');
  }
}

/* ------------------------------------------------------------------ gates on the way */

export const GATE_STOP = 3.5; // m: its bumper this far short of a closed arm
export const GATE_WAIT = 6; // s refused (or unanswered) before it does something about it
const GATE_RECALL = 20; // s: waiting at a gate it cannot go round, it calls again
const GATE_OPEN_WAIT = 30; // s granted and still not up: as good as no answer

/** The gates a route goes through, in order: [{ g, k, from (the side it comes from: -1 / +1) }]. */
function gatesOnPath(G, gates, p, path) {
  const out = [];
  if (!G.gate || !gates.length) return out;
  const pts = [p, ...path];
  for (let j = 1; j < pts.length; j++) {
    const a = pts[j - 1], b = pts[j];
    const L = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const n = Math.max(1, Math.ceil(L / (G.cs / 2)));
    for (let s = 0; s <= n; s++) {
      const c = cellOf(G, a[0] + ((b[0] - a[0]) * s) / n, a[2] + ((b[2] - a[2]) * s) / n);
      const k = c >= 0 ? G.gate[c] - 1 : -1;
      if (k < 0 || out.some((x) => x.k === k)) continue;
      const g = gates[k];
      // (the side it comes from: against the way the route crosses it, not where the car is: it
      // may be half through it when it plans again)
      const along = (b[0] - a[0]) * g.n[0] + (b[2] - a[2]) * g.n[2];
      out.push({ g, k, from: Math.abs(along) > 1e-6 ? -Math.sign(along) : Math.sign(gateSide(g, p)) || -1, req: null, waitT: 0, refusedT: 0, said: new Set() });
    }
  }
  return out;
}

const inBox = (B, x, z, m) => x > B.min[0] - m && x < B.max[0] + m && z > B.min[2] - m && z < B.max[2] + m;

/**
 * The gate next on its way (see the top): { vCap (the speed it may make for it), skip (its arm is
 * not a wall to back off from) }, or null (none near).
 */
function gateStep(car, D, ctx, dt) {
  const X = D.gates?.[D.gi];
  const w = ctx.world;
  if (!X || !w) return null;
  const g = X.g, S = car.spec;
  const dlog = (s) => {
    D.log.push(s);
    D.onLog?.(s);
  };
  const once = (s) => {
    if (X.said.has(s)) return;
    X.said.add(s);
    dlog(s);
  };
  const drv = car.seats?.find((q) => q.drive)?.who;
  const cs = D.callsign ?? drv?.unit ?? callsignOf(car);
  const before = gateSide(g, [car.x, 0, car.z]) * X.from;
  D.nearGate = Math.abs(before) < S.L / 2 + 6;
  // through it: "through, close the gate" (if it was raised for it)
  if (before < -(S.L / 2 + 1)) {
    if (X.req && X.req.answer === 'granted') gateThrough(w, g, car, { callsign: cs, log: dlog });
    else once('gate:passed');
    D.gi++;
    D.nearGate = false;
    return null;
  }
  if (before > 45) return null;
  const skip = (x, z) => inBox(g.box, x, z, 0.8);
  if (X.ram) {
    // (flat out at it; the arm snaps as the bumper meets it)
    if (g.state !== 'broken' && before < S.L / 2 + 1.0) {
      smashGate(w, g, car);
      once('gate:rammed');
    }
    return { skip, vCap: Infinity };
  }
  if (gatePassable(g)) {
    if (X.req) once('gate:open');
    // (through a gate at a walking pace or so)
    return { skip, vCap: before < 14 ? 5 : Infinity };
  }
  // closed (or swinging): stop short of it
  const stopAt = S.L / 2 + GATE_STOP;
  const vCap = Math.sqrt(2 * 2.5 * Math.max(0, before - stopAt));
  if (!X.req && before < stopAt + 16) {
    X.req = requestGate(w, g, { car, callsign: cs, log: (s) => D.log.push(s), urgent: D.urgent });
    once('gate:request');
  }
  if (before < stopAt + 1.5 && Math.abs(car.u) < 0.5) {
    X.waitT += dt;
    once('gate:wait');
  }
  const R = X.req;
  if (!R) return { skip, vCap };
  let refused = R.answer === 'denied' || R.answer === 'none';
  if (R.answer === 'granted') {
    once('gate:granted');
    if (X.waitT > GATE_OPEN_WAIT) refused = true;
  }
  if (!refused) return { skip, vCap };
  once(R.answer === 'denied' ? 'gate:denied' : 'gate:no-answer');
  X.refusedT += dt;
  if (X.refusedT < GATE_WAIT) return { skip, vCap };
  if (D.urgent) {
    // an emergency: through it
    X.ram = true;
    once('gate:ram');
    gateRadio(w, g, `${g.callsign}, ${cs}, we are coming through, ramming the gate!`, 'call', [car.x, car.y + 1.5, car.z]);
    return { skip, vCap: Infinity };
  }
  if (!X.triedRound) {
    // another way, not through this gate
    X.triedRound = true;
    const G = navGrid(w);
    const avoid = new Set([...D.avoid, X.k]);
    const alt = G && planPath(G, [car.x, car.y, car.z], D.target, { gates: initGates(w), avoid });
    const end = alt?.at(-1);
    if (end && Math.hypot(end[0] - D.target[0], end[2] - D.target[2]) < D.radius + 2 * G.cs) {
      D.avoid = avoid;
      D.path = null; // (planned again next frame, round it)
      dlog('gate:reroute');
      gateRadio(w, g, `${g.callsign}, ${cs}, roger, taking another way.`, 'call', [car.x, car.y + 1.5, car.z]);
      return { skip, vCap: 0 };
    }
    dlog('gate:no-other-way');
    X.recallT = GATE_RECALL;
  }
  // nothing for it but to wait there, and call again now and then
  X.recallT -= dt;
  if (X.recallT <= 0) {
    X.recallT = GATE_RECALL;
    X.refusedT = 0;
    X.waitT = 0;
    X.said.delete('gate:denied');
    X.said.delete('gate:no-answer');
    X.said.delete('gate:granted');
    X.req = requestGate(w, g, { car, callsign: cs, log: (s) => D.log.push(s), urgent: D.urgent });
    dlog('gate:request:again');
  }
  return { skip, vCap };
}

/**
 * The speed for the corners of the route ahead (within 15 m): a sharp one (a right angle out of a
 * gateway) taken at a walking pace, braking for it in time (≤ 2.5 m/s²).
 */
function cornerSpeed(D, p, heading) {
  if (!D.path) return 0; // (planned again: a moment's stop)
  let v = Infinity;
  const hx = Math.cos(heading), hz = Math.sin(heading);
  for (let j = Math.max(0, D.i - 3); j < D.path.length - 1; j++) {
    const q = D.path[j];
    const dq = Math.hypot(q[0] - p[0], q[2] - p[2]);
    if ((q[0] - p[0]) * hx + (q[2] - p[2]) * hz < -0.5) continue; // (behind it)
    if (dq > 15) break;
    // (the turn from where it heads now to the leg after the corner: two half-turns are one turn)
    const b = D.path[j + 1];
    const h2 = Math.atan2(b[2] - q[2], b[0] - q[0]);
    const th = Math.abs(Math.atan2(Math.sin(h2 - heading), Math.cos(h2 - heading)));
    if (th < 0.35) continue;
    const vc = Math.max(2.2, 9 * (1 - th / Math.PI) ** 2);
    v = Math.min(v, Math.sqrt(vc * vc + 2 * 2.5 * Math.max(0, dq - 2)));
  }
  return v;
}

/** The point on segment a→b at distance L from p (the farther one), or null. */
function segPoint(a, b, p, L) {
  const dx = b[0] - a[0], dz = b[2] - a[2];
  const fx = a[0] - p[0], fz = a[2] - p[2];
  const A = dx * dx + dz * dz;
  if (A < 1e-9) return null;
  const B = 2 * (fx * dx + fz * dz), C = fx * fx + fz * fz - L * L;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const t = (-B + Math.sqrt(disc)) / (2 * A);
  if (t < 0 || t > 1) return null;
  return [a[0] + t * dx, a[1] + t * (b[1] - a[1]), a[2] + t * dz];
}
