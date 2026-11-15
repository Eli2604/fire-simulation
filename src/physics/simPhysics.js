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
 *    collision (gas-cylinder shrapnel: sim/vessels.js hands a burst vessel's shell pieces here,
 *    curved plates of its steel with their mass, temperature and, for the valve end, the thrust
 *    of the liquid flashing out of it). A fragment's hit does what the old flying voxels did and
 *    more (fragmentHit): glass breaks, brittle material cracks, a thin wall (a board, a sheet, a
 *    door) is holed when the hit carries more than its perforation energy, and a hot piece sets
 *    alight what it hits or comes to rest on; it cools as it flies and lies. world.rigidFragments
 *    lists them for drawing (render/debris.js).
 *  - fire in flight: a chunk's burning voxels keep burning while it flies (physics/chunkFire.js):
 *    fuel used, heat, flames and smoke put into the air cells along its path; it lands burning.
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
import { mat3FromQuat, eulerYXZ, quatFromEulerYXZ, vlen, m3mulv } from './math.js';
import { makeMovingBody, restamp } from '../sim/movingBody.js';
import { MATERIALS, MAT, mechanics } from '../sim/materials.js';
import { launchVoxel } from '../sim/vessels.js';
import { stepChunkFire, chunkIsHot, chunkTopology } from './chunkFire.js';
import { dragAir } from '../sim/bodyAir.js';

const F_LIQUID = 1, F_FALLING = 2, F_ANCHOR = 4, F_HIDDEN = 64;
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
    w.rigidFragments = this.fragments;
    w.rigid = this; // (sim/impact.js knocks loose things through it)
    this.physics.onImpact((e) => this.impactEvent(e));
    this.stats = { chunks: 0, stamped: 0, lost: 0, fragments: 0, holes: 0, ignitions: 0, flightHeat: 0, flightFuel: 0 };
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
    // (every copy it has in the grid cleared, and none counted: a voxel with no copies is held
    // off the grid, not gone, by sim/movingBody.js syncBody)
    for (let j = 0; j < B.nCells; j++) w.clearVoxel(B.cellList[j]);
    B.nCells = 0;
    B.copies.fill(0);
    B.at.fill(-1);
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
    const chunk = { B, body, age: 0, h, n: B.n, path: [] };
    chunk.hot = chunkIsHot(chunk);
    if (chunk.hot) chunkTopology(chunk);
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

  /**
   * A small fast fragment (shrapnel) as a hull body with continuous collision. → body
   *   p, v            where (the hull's frame) and how fast
   *   size, points    a random lump of about size m, or the hull's own points (a shell plate)
   *   quaternion, av  its orientation and spin (default: a random tumble)
   *   mass            kg (default from the material's density and the hull's volume)
   *   temp            °C: hot it glows (render/debris.js), cools, and sets alight what it touches
   *   area            m² of its surface (cooling; default from the hull)
   *   thrust          { force (N), time (s), axis (body frame) }: a rocket (the valve end of a
   *                   burst cylinder with the liquid flashing out of its open end)
   *   life            s it is kept (lying still it costs nothing: asleep)
   */
  launchFragment({ p, v, size = 0.06, material = 'steel', mass = null, life = 30, points = null, quaternion = null, av = null, temp = null, area = null, thrust = null, name = null }) {
    const r = this.physics.rng;
    let pts = points;
    if (!pts) {
      pts = [];
      for (let k = 0; k < 8; k++) pts.push([(r() - 0.5) * size * 2, (r() - 0.5) * size * 0.8, (r() - 0.5) * size * 1.5]);
      pts.push([size, 0, 0], [-size, 0, 0], [0, size * 0.4, 0], [0, -size * 0.4, 0], [0, 0, size * 0.75], [0, 0, -size * 0.75]);
    }
    const shape = new ConvexHull(pts);
    const M = MATERIALS[MAT[material]] ?? { density: 7800, specificHeat: 490 };
    const b = this.physics.createBody({
      shape, position: p, velocity: v, quaternion: quaternion ?? [0, 0, 0, 1],
      angularVelocity: av ?? [(r() - 0.5) * 30, (r() - 0.5) * 30, (r() - 0.5) * 30], material, ...(mass ? { mass } : { density: M.density }), ccd: true,
      linearDamping: 0.01, angularDamping: 0.05,
    });
    // its size across (the perforation energy), its surface (cooling)
    let ext = 0;
    for (const q of pts) ext = Math.max(ext, Math.hypot(q[0], q[1], q[2]));
    const f = {
      body: b, age: 0, life, material, mass: b.mass, size: ext, temp: temp ?? this.w.ambient ?? 15, cp: M.specificHeat ?? 490,
      area: area ?? 4 * Math.PI * Math.cbrt((3 * Math.max(1e-9, b.volume)) / (4 * Math.PI)) ** 2,
      hits: 0, name, restT: 0, thrust: thrust ? { ...thrust, left: thrust.time } : null,
    };
    b.userData = { fragment: f };
    // air drag, ½ρ·Cd·A·v² with the tumbling piece's mean projected area (a quarter of its
    // surface, for a convex body): a steel dish of a cylinder's end falls at ~25 m/s
    const kd = 0.5 * 1.2 * 1.1 * (f.area / 4);
    b.forceGenerators.push((body) => {
      const v = body.vel;
      const s = Math.hypot(v[0], v[1], v[2]);
      if (s > 1) body.applyForce([-kd * s * v[0], -kd * s * v[1], -kd * s * v[2]]);
    });
    if (f.thrust) {
      const axis = f.thrust.axis ?? [0, 1, 0];
      b.forceGenerators.push((body, dt) => {
        const T = f.thrust;
        if (T.left <= 0) return;
        T.left -= dt;
        const d = m3mulv([0, 0, 0], body.R, axis);
        body.applyForce([d[0] * T.force, d[1] * T.force, d[2] * T.force]);
      });
    }
    this.fragments.push(f);
    this.stats.fragments++;
    return b;
  }

  /**
   * A fragment hits the voxel world (cell) or a body: what its kinetic energy does there (as the
   * flying voxels of sim/vessels.js did, and the perforation of thin walls); a hot one lights it.
   */
  fragmentHit(f, e) {
    const w = this.w, sim = this.sim;
    f.hits++;
    const E = 0.5 * f.mass * e.speed * e.speed; // (what it brings in along the normal)
    f.maxHitE = Math.max(f.maxHitE ?? 0, E);
    const c = e.cell ?? -1;
    if (c < 0 || c >= w.N || !w.mat[c]) return;
    const T = MATERIALS[w.mat[c]];
    const anchored = w.flags[c] & F_ANCHOR;
    if (!anchored && T.shatterTemp !== Infinity && E > 5) {
      w.flags[c] |= F_FALLING;
      sim.glassNoise?.(c);
      w.structureDirty = true;
    } else if (!anchored && (T.brittle || T.wetFail !== Infinity) && E > 20) {
      w.crack[c] += E / 400;
      if (w.crack[c] >= 1) w.flags[c] |= F_FALLING;
      w.structureDirty = true;
    } else if (!(T.fluidity >= 0.95) && Math.floor(c / w.nx) % w.ny > 0) {
      // a thin wall (bolted down or not) is plugged out if the hit carries its perforation
      // energy, ≈ π·a·t²·σ/2 for a piece of size a through a plate of thickness t and strength σ:
      // a few hundred J for a thin sheet or board, tens of kJ for a 10 cm plank (not holed)
      const t = w.h * Math.min(1, w.dens[c]);
      const Eperf = 0.5 * Math.PI * Math.max(0.01, f.size) * t * t * mechanics(w.mat[c]).strength;
      if (E > Eperf) {
        const keep = Math.sqrt(1 - Eperf / E);
        // the plug goes on with it, and the piece goes on through (the contact bounced it back)
        // (a contact normal points out of the wall, at the body)
        const n = e.normal ?? [0, 1, 0];
        const b = f.body;
        const vn = b.vel[0] * n[0] + b.vel[1] * n[1] + b.vel[2] * n[2];
        const s = e.speed * keep;
        for (let a = 0; a < 3; a++) b.vel[a] += -vn * n[a] - n[a] * s;
        // the hole: the cells of that wall within the piece's size of the hit
        const vp = [-n[0] * s * 0.6, -n[1] * s * 0.6, -n[2] * s * 0.6];
        const [cx, cy, cz] = w.coords(c);
        const m0 = w.mat[c], d0 = w.dens[c];
        // (on the grid: a gap the piece fits through, its size and a cell round it)
        const rr = Math.ceil((f.size + w.h) / w.h);
        const p0 = e.point;
        for (let dz = -rr; dz <= rr; dz++)
          for (let dy = -rr; dy <= rr; dy++)
            for (let dx = -rr; dx <= rr; dx++) {
              const x = cx + dx, y = cy + dy, z = cz + dz;
              if (x < 0 || y < 1 || z < 0 || x >= w.nx || y >= w.ny || z >= w.nz) continue;
              const j = w.idx(x, y, z);
              if (j !== c && (w.mat[j] !== m0 || w.dens[j] > d0 + 1e-6)) continue;
              const q = w.center(x, y, z);
              if (j !== c && Math.hypot(q[0] - p0[0], q[1] - p0[1], q[2] - p0[2]) > f.size + w.h) continue;
              launchVoxel(w, j, vp.slice());
            }
        w.structureDirty = true;
        w.listDirty = true;
        this.stats.holes++;
        f.holed = (f.holed ?? 0) + 1;
      }
    }
    // hot, it sets alight what it hits
    if (T.combustible && f.temp >= T.ignitionTemp) {
      sim.ignite?.(e.point, w.h * 0.8);
      this.stats.ignitions++;
    }
  }

  /** A fragment cooling (convection and radiation), and lying hot on something that burns. */
  coolFragment(f, dt) {
    const w = this.w;
    const Ta = w.ambient ?? 15;
    if (f.temp <= Ta + 1) return;
    const b = f.body;
    const sp = Math.hypot(b.vel[0], b.vel[1], b.vel[2]);
    const hc = 10 + 6 * Math.sqrt(sp);
    const T = f.temp;
    const q = (hc * (T - Ta) + 0.7 * 5.67e-8 * ((T + 273) ** 4 - (Ta + 273) ** 4)) * f.area;
    f.temp = Math.max(Ta, T - (q * dt) / Math.max(1e-6, f.mass * f.cp));
    // at rest on something: it lights what it lies on
    if (b.sleeping || sp < 0.3) {
      f.restT += dt;
      if (f.restT > 0.25) {
        f.restT = 0;
        const i = w.voxelAt(b.pos[0], b.pos[1] - Math.max(w.h * 0.5, f.size * 0.5), b.pos[2]);
        if (i >= 0 && w.mat[i]) {
          const M = MATERIALS[w.mat[i]];
          if (M.combustible && f.temp >= M.ignitionTemp) {
            this.sim.ignite?.([b.pos[0], b.pos[1] - f.size * 0.5, b.pos[2]], w.h * 0.8);
            this.stats.ignitions++;
          }
        }
      }
    }
  }

  /* ---------- the step ---------- */
  step(dt) {
    const w = this.w;
    // (and whatever else is in its world: a dragon gone limp, physics/dragonRagdoll.js)
    if (!this.chunks.length && !this.loose.size && !this.fragments.length && !this.physics.bodies.length) {
      return;
    }
    this.physics.step(dt);
    // fire on the chunks in flight (physics/chunkFire.js): it burns on where the body is
    for (const c of this.chunks) {
      if (!c.hot) continue;
      const r = stepChunkFire(this.sim, c, dt);
      // the air round it dragged along (sim/bodyAir.js, as a moving car does): its flames and
      // smoke trail behind it rather than standing where they were put
      if (r.burning) dragAir(w, c.B, { p: c.body.shapePos(), R: c.body.R }, c.body.vel, c.body.angVel);
      this.stats.flightHeat += r.q * dt;
      this.stats.flightFuel += r.fuelUsed;
      c.burning = r.burning;
      c.heat = (c.heat ?? 0) + r.q * dt;
      if (!r.burning && (c.coolT = (c.coolT ?? 0) + dt) > 2) {
        c.coolT = 0;
        c.hot = chunkIsHot(c);
      }
    }
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
    // (in place: world.rigidFragments is this list)
    let n = 0;
    for (const f of this.fragments) {
      f.age += dt;
      const q = f.body.pos;
      const inScene = q[1] > -2 && q[0] > -30 && q[2] > -30 && q[0] < w.size[0] + 30 && q[2] < w.size[2] + 30;
      if (f.age < f.life && inScene) {
        this.coolFragment(f, dt);
        this.fragments[n++] = f;
      } else this.physics.removeBody(f.body);
    }
    this.fragments.length = n;
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
    const fr = e.b?.userData?.fragment ?? e.a?.userData?.fragment;
    if (fr) this.fragmentHit(fr, e);
  }
}

function dominant(mats, n) {
  const c = new Map();
  for (let k = 0; k < n; k++) c.set(mats[k], (c.get(mats[k]) ?? 0) + 1);
  let best = 0, bm = 0;
  for (const [m, k] of c) if (k > best) (best = k), (bm = m);
  return bm;
}
