/**
 * The rigid-body world in the voxel simulation (sim/simulation.js): enableRigidBodies(sim) gives
 * the simulation a PhysicsWorld (sim.rigid.physics) colliding with its voxel grid, and through it
 *
 *  - debris chunks: what the structure pass finds detached (F_FALLING, sim/simulation.js
 *    checkSupport) and is a face-connected piece of minVoxels..maxVoxels voxels becomes one rigid
 *    body (a VoxelSet: each voxel's mass from its material) instead of falling cell by cell. Its
 *    voxels leave the grid with all their state (sim/movingBody.js makeMovingBody: temperature,
 *    char, burning, colour...), it tumbles, collides, bounces and comes to rest, and when it
 *    sleeps it is stamped back into the grid where it lies (movingBody.js restamp), whole, still
 *    hot or burning. Single voxels, glass and anything over the budget keep the old way (flying
 *    fragments / sliding cells). world.rigidChunks lists the chunks in flight (render/debris.js
 *    draws their voxels at the body's pose).
 *  - knockChunk(cells, v, w): any set of voxels knocked loose as one body (a crate, a barrel built
 *    of voxels, a statue's head).
 *  - loose objects (world.loose: drums, gas cylinders, crates, the training dummy): knockLoose(o,
 *    v) makes one a rigid body of its shape that tumbles and lands; its p / rot follow the body.
 *    sim/impact.js sends them this way when the world has rigid bodies.
 *  - fragments: launchFragment({ p, v, size, material }) a small hull body with continuous
 *    collision (gas-cylinder shrapnel, sim/vessels.js can hand its fragments here).
 *  - explosions: explosion(center, E, R) pushes every body in range (sim/explosions.js calls it).
 *  - buoyancy: debris over water floats (forces.buoyancy with the world's water level); a chunk
 *    afloat is not stamped back (it would only fall again) but stays a sleeping body.
 *  - impacts: world.events gets { type: 'impact', kind: 'rigid', materials, energy, speed, mass,
 *    pos } for the sound (audio/sound.js), and sim.rigid.onImpact(fn) has the raw events.
 *
 * Budgets: maxBodies chunks at once (beyond it the old falling voxels), chunks of at most
 * maxVoxels; a chunk that does not settle in maxAge seconds is stamped where it is.
 */
import { PhysicsWorld } from './world.js';
import { VoxelSet, Box, Capsule, cylinderHull, ConvexHull } from './shapes.js';
import { VoxelGridCollider } from './voxelCollider.js';
import { buoyancy, waterLevelOfWorld } from './forces.js';
import { mat3FromQuat, eulerYXZ, quatFromEulerYXZ, vlen } from './math.js';
import { makeMovingBody, restamp } from '../sim/movingBody.js';
import { MATERIALS, MAT } from '../sim/materials.js';

const F_LIQUID = 1, F_FALLING = 2, F_HIDDEN = 64;
const DEBRIS_GROUP = 1 << 1;

export const RIGID_DEFAULTS = { minVoxels: 3, maxVoxels: 1500, maxBodies: 120, maxAge: 25, substeps: 2 };

/** The shapes of the loose things (ai/dragonAir.js addLoose: r, half). */
export function looseShape(o) {
  const r = o.r ?? 0.3, hh = o.half ?? 0.3;
  if (o.kind === 'crate') return new Box(r, hh, r);
  if (o.kind === 'drum') return cylinderHull(r, hh, 14);
  if (o.kind === 'cylinder') return Capsule.y(r, Math.max(0.01, hh - r));
  return Capsule.y(Math.min(r, 0.25), Math.max(0.05, hh - 0.25));
}
const LOOSE_MAT = { crate: 'wood', drum: 'steel', cylinder: 'steel', dummy: 'fabric' };

export function enableRigidBodies(sim, opts = {}) {
  if (sim.rigid) return sim.rigid;
  sim.rigid = new SimPhysics(sim, { ...RIGID_DEFAULTS, ...opts });
  return sim.rigid;
}

export class SimPhysics {
  constructor(sim, o) {
    this.sim = sim;
    this.o = o;
    const w = (this.w = sim.world);
    this.physics = new PhysicsWorld({ collider: VoxelGridCollider.fromWorld(w), substeps: o.substeps, seed: o.seed ?? 7, maxSteps: 12 });
    this.level = waterLevelOfWorld(w);
    this.physics.addForceGenerator(buoyancy({ level: this.level, density: 1000, drag: 3 }));
    this.chunks = [];
    this.loose = new Map(); // loose object → body
    this.fragments = [];
    w.rigidChunks = this.chunks;
    w.rigid = this; // (sim/impact.js knocks loose things through it)
    this.physics.onImpact((e) => this.impactEvent(e));
    this.stats = { chunks: 0, stamped: 0, lost: 0 };
  }

  onImpact(fn) {
    return this.physics.onImpact(fn);
  }

  /* ---------- debris chunks ---------- */
  /**
   * The detached voxels (indices, F_FALLING) the structure pass is about to drop: face-connected
   * pieces in the size range become rigid chunks; → the voxels left for the old way.
   */
  capture(loose) {
    const w = this.w, o = this.o;
    if (!loose.length) return loose;
    const set = new Set(loose);
    const seen = new Set();
    const rest = [];
    const { nx, ny } = w;
    const nxy = nx * ny;
    for (const i of loose) {
      if (seen.has(i)) continue;
      // the piece: face neighbours that are loose too (and of the same panel group)
      const comp = [i];
      seen.add(i);
      for (let k = 0; k < comp.length; k++) {
        const c = comp[k];
        const x = c % nx, y = Math.floor(c / nx) % ny;
        for (const [d, ok] of [[1, x + 1 < nx], [-1, x > 0], [nx, y + 1 < ny], [-nx, y > 0], [nxy, true], [-nxy, true]]) {
          const j = c + d;
          if (!ok || seen.has(j) || !set.has(j) || w.group[j] !== w.group[c]) continue;
          seen.add(j);
          comp.push(j);
        }
      }
      const glass = comp.some((c) => MATERIALS[w.mat[c]].shatterTemp !== Infinity);
      if (glass || comp.length < o.minVoxels || comp.length > o.maxVoxels || this.chunks.length >= o.maxBodies) {
        for (const c of comp) rest.push(c);
        continue;
      }
      const rnd = this.physics.rng;
      this.knockChunk(comp, [(rnd() - 0.5) * 0.2, 0, (rnd() - 0.5) * 0.2], [(rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.3]);
    }
    return rest;
  }

  /** Voxels (world indices) knocked loose as one rigid body with velocity v and spin av. → the chunk */
  knockChunk(cells, v = [0, 0, 0], av = [0, 0, 0]) {
    const w = this.w, h = w.h;
    cells = cells.filter((i) => w.mat[i]);
    if (!cells.length) return null;
    const centres = cells.map((i) => w.center(...w.coords(i)));
    const masses = cells.map((i) => Math.max(1e-4, MATERIALS[w.mat[i]].density * w.dens[i] * h ** 3));
    let M = 0;
    const com = [0, 0, 0];
    centres.forEach((c, k) => {
      M += masses[k];
      for (let a = 0; a < 3; a++) com[a] += c[a] * masses[k];
    });
    for (let a = 0; a < 3; a++) com[a] /= M;
    // (no longer falling cell by cell: it falls as a body; nor hidden: drawn as voxels)
    for (const i of cells) w.flags[i] &= ~(F_FALLING | F_HIDDEN);
    const local = centres.map((c) => [c[0] - com[0], c[1] - com[1], c[2] - com[2]]);
    const pos = new Map(cells.map((i, k) => [i, local[k]]));
    const B = makeMovingBody(w, cells, (i) => pos.get(i), { pose: { p: com, R: [1, 0, 0, 0, 1, 0, 0, 0, 1] } });
    // off the grid while it flies (its state held in B: restamp puts it back)
    for (let k = 0; k < B.n; k++) {
      const c = B.at[k];
      if (c >= 0) w.clearVoxel(c);
      B.at[k] = -1;
    }
    B.cells.clear();
    w.pieceOf && cells.forEach((i) => w.pieceOf.delete(i));
    const shape = new VoxelSet(h, local, masses);
    const body = this.physics.createBody({
      shape, position: [0, 0, 0], velocity: v, angularVelocity: av, material: dominant(B.s.mat, B.n),
      group: DEBRIS_GROUP, linearDamping: 0.05, angularDamping: 0.15,
    });
    // (the shape frame is the chunk's own: its centre of mass is (almost) its origin)
    body.setPose(com, [0, 0, 0, 1]);
    body.vel = v.slice();
    body.angVel = av.slice();
    body.voxelMaterial = Array.from(B.s.mat);
    const chunk = { B, body, age: 0, h, n: B.n };
    body.userData = { chunk };
    this.chunks.push(chunk);
    this.stats.chunks++;
    w.listDirty = true;
    w.structureDirty = true;
    return chunk;
  }

  /** A chunk at rest: its voxels back into the grid where it lies. */
  stamp(chunk) {
    const w = this.w;
    const b = chunk.body;
    const ip = b.interpolated(1);
    const R = mat3FromQuat([], ip.quaternion);
    const pose = { p: ip.position, R };
    const res = restamp(w, chunk.B, pose, { displace: (m) => MATERIALS[m]?.fluidity >= 0.95 || m === MAT.water });
    this.stats.stamped += res.placed;
    this.stats.lost += res.off;
    // the structure check decides what holds it up now (the ground, a floor) or not (it falls again)
    w.structureDirty = true;
    w.listDirty = true;
    this.removeChunk(chunk);
    return res;
  }

  removeChunk(chunk) {
    this.physics.removeBody(chunk.body);
    const i = this.chunks.indexOf(chunk);
    if (i >= 0) this.chunks.splice(i, 1);
  }

  /* ---------- loose objects, fragments ---------- */
  /** A loose thing (world.loose) knocked flying with velocity v as a rigid body. */
  knockLoose(o, v = [0, 0, 0], av = null) {
    let b = this.loose.get(o);
    if (!b) {
      const shape = looseShape(o);
      const q = quatFromEulerYXZ(o.rot ?? [0, 0, 0]);
      b = this.physics.createBody({ shape, position: o.p, quaternion: q, mass: o.mass ?? 50, material: LOOSE_MAT[o.kind] ?? 'wood', angularDamping: 0.2, userData: { loose: o } });
      // (the shape frame is its middle, where o.p is)
      this.loose.set(o, b);
      o.rigid = true;
    }
    for (let a = 0; a < 3; a++) b.vel[a] += v[a];
    if (av) for (let a = 0; a < 3; a++) b.angVel[a] += av[a];
    else {
      const r = this.physics.rng;
      b.angVel[0] += v[2] * 0.8 + (r() - 0.5);
      b.angVel[2] += -v[0] * 0.8 + (r() - 0.5);
    }
    b.wake();
    o.flying = true;
    return b;
  }

  /** A small fast fragment (shrapnel) as a hull body with continuous collision. → body */
  launchFragment({ p, v, size = 0.06, material = 'steel', mass = null, life = 30 }) {
    const r = this.physics.rng;
    const pts = [];
    for (let k = 0; k < 8; k++) pts.push([(r() - 0.5) * size * 2, (r() - 0.5) * size * 0.8, (r() - 0.5) * size * 1.5]);
    pts.push([size, 0, 0], [-size, 0, 0], [0, size * 0.4, 0], [0, -size * 0.4, 0], [0, 0, size * 0.75], [0, 0, -size * 0.75]);
    const shape = new ConvexHull(pts);
    const M = MATERIALS[MAT[material]] ?? { density: 7800 };
    const b = this.physics.createBody({ shape, position: p, velocity: v, angularVelocity: [(r() - 0.5) * 30, (r() - 0.5) * 30, (r() - 0.5) * 30], material, ...(mass ? { mass } : { density: M.density }), ccd: true });
    this.fragments.push({ body: b, age: 0, life });
    return b;
  }

  /* ---------- the step ---------- */
  step(dt) {
    const w = this.w;
    if (!this.chunks.length && !this.loose.size && !this.fragments.length) {
      return;
    }
    this.physics.step(dt);
    // chunks at rest go back into the grid; the ones lost below the world (or sunk at sea) go
    for (const c of [...this.chunks]) {
      c.age += dt;
      const b = c.body;
      if (b.pos[1] < -2 || b.pos[0] < -5 || b.pos[2] < -5 || b.pos[0] > w.size[0] + 5 || b.pos[2] > w.size[2] + 5) {
        this.stats.lost += c.n;
        this.removeChunk(c);
        continue;
      }
      const afloat = (b.submerged ?? 0) > 0;
      if (w.sea && b.sleeping && b.pos[1] < w.sea.level - w.h) {
        this.removeChunk(c); // (sunk into deep water)
        continue;
      }
      if ((b.sleeping && !afloat) || (c.age > this.o.maxAge && vlen(b.vel) < 0.5 && !afloat)) this.stamp(c);
    }
    // loose things follow their bodies; at rest they are left as they lie (still bodies, asleep)
    for (const [o, b] of this.loose) {
      if (o.held || o.gone) {
        this.physics.removeBody(b);
        this.loose.delete(o);
        o.rigid = false;
        continue;
      }
      const ip = b.interpolated(1);
      o.p = ip.position;
      o.rot = eulerYXZ(ip.quaternion);
      o.v = b.vel.slice();
      if (b.sleeping) o.flying = false;
    }
    this.fragments = this.fragments.filter((f) => {
      f.age += dt;
      if (f.age < f.life && f.body.pos[1] > -2) return true;
      this.physics.removeBody(f.body);
      return false;
    });
  }

  /** A blast: every body in range pushed (and woken). */
  explosion(center, E, radius) {
    const hit = this.physics.explosion(center, { energy: E, radius });
    // loose things in range that are not bodies yet become ones
    for (const o of this.w.loose ?? []) {
      if (o.held || o.gone || this.loose.has(o)) continue;
      const d = Math.hypot(o.p[0] - center[0], o.p[1] - center[1], o.p[2] - center[2]);
      if (d > radius) continue;
      const v0 = Math.min(80, 8 + Math.sqrt(E / 2000)) * (1 - d / radius) ** 2 * Math.min(1, Math.sqrt(2 / (o.mass ?? 50)));
      const n = d > 1e-6 ? [(o.p[0] - center[0]) / d, (o.p[1] - center[1]) / d + 0.4, (o.p[2] - center[2]) / d] : [0, 1, 0];
      if (v0 > 0.5) this.knockLoose(o, n.map((c) => c * v0));
    }
    return hit;
  }

  impactEvent(e) {
    const w = this.w;
    if (e.energy < 15) return;
    const mass = Math.min(e.a?.mass ?? Infinity, e.b?.mass ?? Infinity);
    const size = Math.cbrt((e.b?.volume ?? w.h ** 3) || w.h ** 3);
    w.events.push({ type: 'impact', kind: 'rigid', pos: e.point.slice(), time: w.time, energy: e.energy, name: e.materials[1], materials: [e.materials[1], e.materials[0]], mass, speed: e.speed, size: 1, sizeA: size, radius: size * 0.3, impulse: e.impulse });
    if (e.energy > 50) w.noises.push({ p: e.point.slice(), loud: Math.min(40, 5 + Math.sqrt(e.energy) * 0.5), time: w.time, kind: 'impact' });
  }
}

function dominant(mats, n) {
  const c = new Map();
  for (let k = 0; k < n; k++) c.set(mats[k], (c.get(mats[k]) ?? 0) + 1);
  let best = 0, bm = 0;
  for (const [m, k] of c) if (k > best) (best = k), (bm = m);
  return bm;
}
