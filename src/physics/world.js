/**
 * PhysicsWorld: rigid bodies, contacts, joints, stepped at a fixed rate.
 *
 * Each fixed step (fixedDt, default 1/60 s) runs `substeps` substeps of:
 *   1. forces      gravity, the force generators (buoyancy, rotors, suspension...), damping
 *   2. broadphase  sweep and prune over x of every body's box (fattened by how far it may move)
 *   3. narrowphase body–body contacts (collide.js) and body–voxel-world contacts
 *                  (voxelCollider.js), at most 4 per normal patch; matched to last substep's
 *                  contacts (warm starting); a moving body touching a sleeping one wakes it
 *   4. solve       sequential impulses: joints and contacts (normal with Baumgarte position
 *                  correction above a slop, Coulomb friction pyramid on two tangents with
 *                  μ = √(μa·μb) from the materials) for `iterations`
 *   5. integrate   positions and orientations from the solved velocities
 *   6. relax       `relaxIterations` more without the position correction (it does not turn into
 *                  bounce), then restitution e = √(ea·eb) for contacts that closed faster than
 *                  0.5 m/s
 *   7. CCD         a fast body (moving more than half its inner radius in a substep) is swept as
 *                  its inner sphere from where it was to where it is, against the grid and the
 *                  other bodies, and stopped at the first touch (a fragment cannot tunnel)
 *   8. events      an impact (a contact that closed faster than minImpactSpeed) is reported to
 *                  onImpact listeners: { a, b, point, normal, impulse, speed, energy, materials, cell }
 * then sleeping: bodies linked by contacts and joints form islands; an island whose bodies have
 * all been slow for sleep.time seconds sleeps (no integration, no contact search among
 * sleepers); a touch from a moving body, an impulse or a joint to an awake body wakes it.
 *
 * step(dt) runs as many fixed steps as dt holds (at most maxSteps); alpha is how far between the
 * last two fixed steps the remainder is, for drawing (body.interpolated(alpha)). Same bodies, same
 * order, same steps: the same result (no Math.random; world.rng is seeded).
 */
import { Body } from './body.js';
import { collide } from './collide.js';
import { collideWorld, rayGrid, sphereHitsGrid } from './voxelCollider.js';
import { Row } from './rows.js';
import { reduce4 } from './collide.js';
import { surfaceOf, combine } from './materials.js';
import { Sphere } from './shapes.js';
import { vlen, vlen2, vdot, vsub, vcross, vscale, perp, qintegrate, m3mulv, makeRng, qmul, qconj } from './math.js';
import { raycastShape } from './queries.js';
import { MATERIALS } from '../sim/materials.js';

const T = () => [0, 0, 0];

export class PhysicsWorld {
  constructor(o = {}) {
    this.gravity = (o.gravity ?? [0, -9.81, 0]).slice();
    this.fixedDt = o.fixedDt ?? 1 / 60;
    this.substeps = o.substeps ?? 2;
    this.iterations = o.iterations ?? 8;
    this.relaxIterations = o.relaxIterations ?? 2;
    this.maxSteps = o.maxSteps ?? 6;
    this.collider = o.collider ?? null;
    this.beta = o.beta ?? 0.2;
    this.slop = o.slop ?? 0.004;
    this.maxBias = o.maxBias ?? 3; // m/s: the fastest position correction pushes
    this.restitutionThreshold = o.restitutionThreshold ?? 0.5;
    this.minImpactSpeed = o.minImpactSpeed ?? 0.6;
    this.sleep = { linear: 0.06, angular: 0.12, time: 0.5, ...(o.sleep ?? {}) };
    this.maxBodies = o.maxBodies ?? 1000;
    this.rng = makeRng(o.seed ?? 1);
    this.bodies = [];
    this.joints = [];
    this.forceGenerators = [];
    this.impactListeners = [];
    this.manifolds = new Map();
    this.sap = [];
    this.acc = 0;
    this.alpha = 1;
    this.time = 0;
    this.stepCount = 0;
    this.impacts = []; // this step's impacts (also sent to onImpact listeners)
    this.stats = { bodies: 0, awake: 0, contacts: 0, pairs: 0, islands: 0, sleeping: 0, ms: 0 };
  }

  /* ---------- bodies, joints, forces ---------- */
  createBody(opts) {
    return this.addBody(new Body(opts));
  }
  addBody(b) {
    b.world = this;
    this.bodies.push(b);
    this.sap.push(b);
    this.updateAabb(b, 0);
    return b;
  }
  removeBody(b) {
    const i = this.bodies.indexOf(b);
    if (i < 0) return;
    this.bodies.splice(i, 1);
    this.sap.splice(this.sap.indexOf(b), 1);
    for (const [k, m] of this.manifolds) if (m.a === b || m.b === b) this.manifolds.delete(k);
    this.joints = this.joints.filter((j) => j.a !== b && j.b !== b);
    b.world = null;
  }
  addJoint(j) {
    this.joints.push(j);
    j.a?.wake();
    j.b?.wake();
    return j;
  }
  removeJoint(j) {
    const i = this.joints.indexOf(j);
    if (i >= 0) this.joints.splice(i, 1);
    j.a?.wake();
    j.b?.wake();
  }
  /** A force on every awake dynamic body each substep: fn(body, dt, world) (applyForce on it). */
  addForceGenerator(fn) {
    this.forceGenerators.push(fn);
    return () => {
      const i = this.forceGenerators.indexOf(fn);
      if (i >= 0) this.forceGenerators.splice(i, 1);
    };
  }
  /** Impacts: fn({ a, b, point, normal, impulse, speed, energy, materials, cell }). → unsubscribe */
  onImpact(fn) {
    this.impactListeners.push(fn);
    return () => {
      const i = this.impactListeners.indexOf(fn);
      if (i >= 0) this.impactListeners.splice(i, 1);
    };
  }
  wakeBody(b) {
    const g = b.sleepGroup ?? [b];
    for (const x of g) {
      x.sleeping = false;
      x.sleepTime = 0;
      x.sleepGroup = null;
    }
  }

  /* ---------- stepping ---------- */
  /** Advance by dt (s): fixed steps; → how many ran. */
  step(dt) {
    this.acc += Math.max(0, dt);
    let n = 0;
    while (this.acc >= this.fixedDt - 1e-12 && n < this.maxSteps) {
      this.stepFixed();
      this.acc -= this.fixedDt;
      n++;
    }
    if (n === this.maxSteps && this.acc > this.fixedDt) this.acc = 0; // (too far behind: drop the rest)
    this.alpha = Math.max(0, Math.min(1, this.acc / this.fixedDt));
    return n;
  }

  stepFixed() {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.impacts = [];
    for (const b of this.bodies) {
      b.prevPos[0] = b.pos[0];
      b.prevPos[1] = b.pos[1];
      b.prevPos[2] = b.pos[2];
      b.prevQuat[0] = b.quat[0];
      b.prevQuat[1] = b.quat[1];
      b.prevQuat[2] = b.quat[2];
      b.prevQuat[3] = b.quat[3];
    }
    const h = this.fixedDt / this.substeps;
    for (let s = 0; s < this.substeps; s++) this.substep(h, s === 0);
    for (const b of this.bodies) {
      b.force[0] = b.force[1] = b.force[2] = 0;
      b.torque[0] = b.torque[1] = b.torque[2] = 0;
      b.kTarget = null;
    }
    this.updateSleep();
    this.time += this.fixedDt;
    this.stepCount++;
    for (const ev of this.impacts) for (const fn of this.impactListeners) fn(ev);
    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.stats.ms = t1 - t0;
  }

  substep(h, first) {
    const g = this.gravity;
    // 1. forces
    for (const b of this.bodies) {
      b.im = b.type === 'dynamic' && !b.sleeping ? b.invMass : 0;
      b.iIw = b.invIworld;
      if (b.type === 'kinematic' && b.kTarget && first) {
        const kt = b.kTarget;
        const c = m3mulv(T(), b.R, b.com);
        for (let a = 0; a < 3; a++) b.vel[a] = (kt.position[a] + c[a] - b.pos[a]) / kt.dt;
        // (the turn to the target orientation as an angular velocity)
        const d = qmul([0, 0, 0, 1], kt.quaternion, qconj([0, 0, 0, 1], b.quat));
        const sgn = d[3] < 0 ? -1 : 1;
        for (let a = 0; a < 3; a++) b.angVel[a] = (2 * sgn * d[a]) / kt.dt;
      }
      if (!b.im) continue;
      // forces applied from outside hold for the whole fixed step; the generators' are new each substep
      if (first) {
        b.uF = b.force.slice();
        b.uT = b.torque.slice();
      } else {
        for (let a = 0; a < 3; a++) {
          b.force[a] = b.uF ? b.uF[a] : 0;
          b.torque[a] = b.uT ? b.uT[a] : 0;
        }
      }
      for (const fg of this.forceGenerators) fg(b, h, this);
      for (const fg of b.forceGenerators) fg(b, h, this);
    }
    for (const b of this.bodies) {
      if (!b.im) continue;
      const gs = b.gravityScale;
      for (let a = 0; a < 3; a++) b.vel[a] += h * (g[a] * gs + b.force[a] * b.invMass);
      const dw = m3mulv(T(), b.invIworld, b.torque);
      for (let a = 0; a < 3; a++) b.angVel[a] += h * dw[a];
      const ld = 1 / (1 + h * b.linearDamping), ad = 1 / (1 + h * b.angularDamping);
      for (let a = 0; a < 3; a++) {
        b.vel[a] *= ld;
        b.angVel[a] *= ad;
      }
      // (a safety cap: nothing in the scene is faster)
      const v2 = vlen2(b.vel), w2 = vlen2(b.angVel);
      if (v2 > 250 * 250) vscale(b.vel, b.vel, 250 / Math.sqrt(v2));
      if (w2 > 120 * 120) vscale(b.angVel, b.angVel, 120 / Math.sqrt(w2));
    }
    // 2–3. contacts
    const contacts = this.findContacts(h);
    // 4. prepare, warm start, solve
    // (a joint from a moving body to a sleeping one wakes it)
    for (const j of this.joints) {
      if (!j.enabled || j.broken || !j.a || !j.b) continue;
      if (j.a.sleeping && j.b.im && j.b.sleepTime === 0) (this.wakeBody(j.a), (j.a.im = j.a.invMass));
      if (j.b.sleeping && j.a.im && j.a.sleepTime === 0) (this.wakeBody(j.b), (j.b.im = j.b.invMass));
    }
    const joints = this.joints.filter((j) => j.enabled && !j.broken && ((j.a && j.a.im) || (j.b && j.b.im)));
    for (const j of joints) j.prepare(h, this.beta, this.maxBias);
    for (const m of contacts) this.prepareManifold(m, h);
    for (const j of joints) for (const r of j.active) if (r.lambda) r.apply(r.lambda);
    for (const m of contacts) for (const c of m.points) this.warm(m, c);
    for (let it = 0; it < this.iterations; it++) {
      for (const j of joints) for (const r of j.active) r.solve(false);
      for (const m of contacts) this.solveManifold(m, false);
    }
    // 5. integrate positions
    for (const b of this.bodies) {
      if (b.type === 'static' || (b.type === 'dynamic' && b.sleeping)) continue;
      b.ccdFrom = b.ccdFrom ?? [0, 0, 0];
      b.ccdFrom[0] = b.pos[0];
      b.ccdFrom[1] = b.pos[1];
      b.ccdFrom[2] = b.pos[2];
      for (let a = 0; a < 3; a++) b.pos[a] += h * b.vel[a];
      qintegrate(b.quat, b.angVel, h);
      b.updateDerived();
    }
    // 6. relax, restitution
    for (let it = 0; it < this.relaxIterations; it++) {
      for (const j of joints) for (const r of j.active) r.solve(true);
      for (const m of contacts) this.solveManifold(m, true);
    }
    for (const m of contacts) this.restitute(m);
    for (const j of joints) j.checkBreak();
    // 7. continuous collision
    for (const b of this.bodies) if (b.im) this.ccd(b, h);
    // 8. impact events (the impulses this substep)
    for (const m of contacts) this.report(m);
    this.stats.contacts = contacts.reduce((s, m) => s + m.points.length, 0);
  }

  updateAabb(b, h) {
    b.shape.aabb(b.shapePos(), b.R, b.aabb);
    const m = 0.01 + (b.type === 'static' ? 0 : vlen(b.vel) * h * 2);
    for (let a = 0; a < 3; a++) {
      b.aabb[a] -= m;
      b.aabb[a + 3] += m;
    }
    b.margin = Math.min(0.5, 0.008 + vlen(b.vel) * h * 1.5);
  }

  /** Broadphase (sweep and prune over x) and narrowphase → manifolds touched this substep. */
  findContacts(h) {
    const sap = this.sap;
    for (const b of sap) if (b.type !== 'static' || !b.aabbDone) (this.updateAabb(b, h), (b.aabbDone = true));
    // insertion sort by min x (nearly sorted from the last step), ties by id: deterministic
    for (let i = 1; i < sap.length; i++) {
      const x = sap[i];
      let j = i - 1;
      while (j >= 0 && (sap[j].aabb[0] > x.aabb[0] || (sap[j].aabb[0] === x.aabb[0] && sap[j].id > x.id))) {
        sap[j + 1] = sap[j];
        j--;
      }
      sap[j + 1] = x;
    }
    const out = [];
    const step = this.stepCount * 64 + (this.subIndex = ((this.subIndex ?? 0) + 1) % 64);
    let pairs = 0;
    for (let i = 0; i < sap.length; i++) {
      const A = sap[i];
      const aMoving = A.im > 0 || A.type === 'kinematic';
      for (let j = i + 1; j < sap.length; j++) {
        const B = sap[j];
        if (B.aabb[0] > A.aabb[3]) break;
        if (!(aMoving || B.im > 0 || B.type === 'kinematic')) continue;
        if (!(A.im > 0 || B.im > 0)) continue; // (two kinematic / static / sleeping: nothing to solve)
        if (A.aabb[1] > B.aabb[4] || B.aabb[1] > A.aabb[4] || A.aabb[2] > B.aabb[5] || B.aabb[2] > A.aabb[5]) continue;
        if (!(A.filter.group & B.filter.mask) || !(B.filter.group & A.filter.mask)) continue;
        if (this.jointed(A, B)) continue;
        pairs++;
        const [a, b] = A.id < B.id ? [A, B] : [B, A];
        const m = this.collidePair(a, b, step);
        if (m) out.push(m);
      }
    }
    if (this.collider)
      for (const b of this.bodies) {
        if (!b.im || !b.collideWorld) continue;
        const m = this.collideWithWorld(b, step);
        if (m) out.push(m);
      }
    // drop manifolds not touched this substep
    for (const [k, m] of this.manifolds) if (m.step !== step) this.manifolds.delete(k);
    this.stats.pairs = pairs;
    return out;
  }

  jointed(A, B) {
    for (const j of this.joints) if (!j.collideConnected && ((j.a === A && j.b === B) || (j.a === B && j.b === A))) return true;
    return false;
  }

  collidePair(a, b, step) {
    const raw = [];
    const margin = Math.max(a.margin ?? 0.01, b.margin ?? 0.01);
    collide(a.shape, a.shapePos(), a.R, b.shape, b.shapePos(), b.R, margin, (n, p, depth, sa, sb) => raw.push({ n: n.slice(), p: p.slice(), depth, sa, sb }));
    const key = a.id * 2097152 + b.id;
    return this.toManifold(key, a, b, raw, step);
  }

  collideWithWorld(b, step) {
    const raw = [];
    collideWorld(this.collider, b.shape, b.shapePos(), b.R, b.margin ?? 0.01, (n, p, depth, sb, cell, mat) => raw.push({ n: n.slice(), p: p.slice(), depth, sa: -1, sb, cell, mat }));
    if (!raw.length) {
      this.manifolds.delete(-b.id);
      return null;
    }
    return this.toManifold(-b.id, null, b, raw, step);
  }

  /** Raw contact points → a manifold (≤ 4 per normal patch), matched to the last one of the pair. */
  toManifold(key, a, b, raw, step) {
    if (!raw.length) {
      this.manifolds.delete(key);
      return null;
    }
    // patches by normal; each reduced to 4 points
    const patches = [];
    for (const c of raw) {
      let P = patches.find((q) => vdot(q.n, c.n) > 0.95);
      if (!P) patches.push((P = { n: c.n, pts: [] }));
      // (the same point twice: a sphere on two floor voxels, a corner found from both sides)
      const dup = P.pts.find((q) => Math.abs(q.p[0] - c.p[0]) + Math.abs(q.p[1] - c.p[1]) + Math.abs(q.p[2] - c.p[2]) < 1e-4);
      if (dup) {
        if (c.depth > dup.depth) dup.depth = c.depth;
        continue;
      }
      P.pts.push(c);
    }
    const pts = [];
    for (const P of patches) for (const c of reduce4(P.pts)) pts.push(c);
    const old = this.manifolds.get(key);
    // a sleeping body touched by one that moves wakes (with its island)
    if (a && b) {
      if (a.sleeping && b.im && b.sleepTime === 0) this.wakeBody(a);
      if (b.sleeping && a.im && a.sleepTime === 0) this.wakeBody(b);
      a.im = a.type === 'dynamic' && !a.sleeping ? a.invMass : 0;
      b.im = b.type === 'dynamic' && !b.sleeping ? b.invMass : 0;
    }
    const m = old ?? { key, a, b, points: [], isNew: true, lastEvent: -Infinity };
    m.isNew = !old;
    m.step = step;
    const sa = a ? surfaceOf(a.material) : null;
    const tol = 0.02;
    const next = [];
    for (const c of pts) {
      const lb = b.toLocal(c.p);
      let match = null;
      if (old)
        for (const o of old.points)
          if (!o.taken && Math.abs(o.lb[0] - lb[0]) + Math.abs(o.lb[1] - lb[1]) + Math.abs(o.lb[2] - lb[2]) < tol && vdot(o.n, c.n) > 0.9) {
            match = o;
            break;
          }
      if (match) match.taken = true;
      const surfA = a ? (a.voxelMaterial && c.sa >= 0 ? surfaceOf(a.voxelMaterial[c.sa]) : { friction: a.friction, restitution: a.restitution, name: sa.name }) : surfaceOf(c.mat);
      const surfB = b.voxelMaterial && c.sb >= 0 ? surfaceOf(b.voxelMaterial[c.sb]) : { friction: b.friction, restitution: b.restitution, name: surfaceOf(b.material).name };
      const mix = combine(surfA, surfB);
      next.push({
        n: c.n, p: c.p, depth: c.depth, lb, sa: c.sa, sb: c.sb, cell: c.cell ?? -1, mat: c.mat ?? 0,
        friction: mix.friction, restitution: mix.restitution,
        matA: a ? (a.voxelMaterial && c.sa >= 0 ? a.voxelMaterial[c.sa] : a.material) : c.mat, matB: b.voxelMaterial && c.sb >= 0 ? b.voxelMaterial[c.sb] : b.material,
        warmN: match ? match.lambdaN : 0, warmT: match ? match.fT : null, lambdaN: 0, fT: [0, 0, 0],
        rN: match ? match.rN : new Row(), rT1: match ? match.rT1 : new Row(), rT2: match ? match.rT2 : new Row(),
        t1: null, t2: null, vn0: 0, taken: false,
      });
    }
    m.points = next;
    if (!m.roll) m.roll = [new Row(), new Row(), new Row()];
    this.manifolds.set(key, m);
    return m;
  }

  prepareManifold(m, h) {
    const { a, b } = m;
    for (const c of m.points) {
      const rA = a ? vsub(T(), c.p, a.pos) : null, rB = vsub(T(), c.p, b.pos);
      const n = c.n;
      const t1 = T(), t2 = T();
      perp(n, t1, t2);
      c.t1 = t1;
      c.t2 = t2;
      const J = (e) => [vscale(T(), e, -1), rA ? vscale(T(), vcross(T(), rA, e), -1) : null, e, vcross(T(), rB, e)];
      c.rN.set(a, b, ...J(n));
      c.rT1.set(a, b, ...J(t1));
      c.rT2.set(a, b, ...J(t2));
      c.rN.lo = 0;
      c.rN.hi = Infinity;
      const d = c.depth;
      c.rN.bias = d > this.slop ? Math.min(this.maxBias, (this.beta * (d - this.slop)) / h) : d < 0 ? d / h : 0;
      c.rN.biasRelax = d < 0 ? d / h : 0;
      c.rT1.bias = c.rT1.biasRelax = c.rT2.bias = c.rT2.biasRelax = 0;
      c.vn0 = c.rN.cdot();
      c.rN.lambda = 0;
      c.rT1.lambda = 0;
      c.rT2.lambda = 0;
    }
    // rolling resistance and spin friction: angular rows bounded by the normal load (a ball, a log,
    // a barrel come to rest instead of rolling for ever)
    const c0 = m.points[0];
    const rr = Math.max(a ? a.rollingResistance : 0, b.rollingResistance);
    m.rollOn = !!c0 && rr > 0;
    if (m.rollOn) {
      m.rollR = rr * Math.max(a ? a.shape.innerRadius ?? 0.1 : 0, b.shape.innerRadius ?? 0.1, 0.02);
      const axes = [c0.n, c0.t1, c0.t2];
      for (let k = 0; k < 3; k++) {
        const r = m.roll[k].set(a, b, null, vscale(T(), axes[k], -1), null, axes[k]);
        r.bias = r.biasRelax = 0;
        r.lambda = 0;
      }
    }
  }

  warm(m, c) {
    if (c.warmN > 0) {
      c.rN.lambda = c.warmN;
      c.rN.apply(c.warmN);
    }
    if (c.warmT) {
      const l1 = vdot(c.warmT, c.t1), l2 = vdot(c.warmT, c.t2);
      c.rT1.lambda = l1;
      c.rT2.lambda = l2;
      if (l1) c.rT1.apply(l1);
      if (l2) c.rT2.apply(l2);
    }
  }

  solveManifold(m, relax) {
    for (const c of m.points) {
      // friction first (bounded by the normal impulse of the last iteration), then the normal
      const lim = c.friction * c.rN.lambda;
      c.rT1.lo = c.rT2.lo = -lim;
      c.rT1.hi = c.rT2.hi = lim;
      c.rT1.solve(relax);
      c.rT2.solve(relax);
      c.rN.solve(relax);
    }
    if (m.rollOn) {
      let L = 0;
      for (const c of m.points) L += c.rN.lambda;
      const lim = L * m.rollR;
      for (const r of m.roll) {
        r.lo = -lim;
        r.hi = lim;
        r.solve(relax);
      }
    }
  }

  restitute(m) {
    for (const c of m.points) {
      if (c.vn0 > -this.restitutionThreshold || c.rN.lambda <= 0 || c.restitution <= 0) continue;
      const r = c.rN;
      const vn = r.cdot();
      let d = -r.m * (vn + c.restitution * c.vn0);
      const nl = Math.max(0, r.lambda + d);
      d = nl - r.lambda;
      r.lambda = nl;
      if (d) r.apply(d);
    }
    for (const c of m.points) {
      c.lambdaN = c.rN.lambda;
      c.fT = [c.t1[0] * c.rT1.lambda + c.t2[0] * c.rT2.lambda, c.t1[1] * c.rT1.lambda + c.t2[1] * c.rT2.lambda, c.t1[2] * c.rT1.lambda + c.t2[2] * c.rT2.lambda];
    }
  }

  /** An impact: the pair closed faster than minImpactSpeed (once per pair until it parts or 0.1 s). */
  report(m) {
    let speed = 0, J = 0;
    const p = [0, 0, 0];
    let best = null;
    for (const c of m.points) {
      speed = Math.max(speed, -c.vn0);
      J += c.rN.lambda;
      p[0] += c.p[0] * c.rN.lambda;
      p[1] += c.p[1] * c.rN.lambda;
      p[2] += c.p[2] * c.rN.lambda;
      if (!best || c.rN.lambda > best.rN.lambda) best = c;
    }
    if (speed < this.minImpactSpeed || J <= 0 || !best) return;
    if (this.time - m.lastEvent < 0.1 && !m.isNew) return;
    m.lastEvent = this.time;
    vscale(p, p, 1 / J);
    const { a, b } = m;
    const ma = a && a.invMass ? a.mass : Infinity, mb = b.invMass ? b.mass : Infinity;
    const mu = ma === Infinity ? mb : mb === Infinity ? ma : (ma * mb) / (ma + mb);
    const name = (x) => (x === null || x === undefined ? 'unknown' : typeof x === 'number' ? MATERIALS[x]?.name ?? 'unknown' : x);
    this.impacts.push({
      a, b, point: p, normal: best.n.slice(), impulse: J, speed,
      energy: 0.5 * (mu === Infinity ? 0 : mu) * speed * speed,
      materials: [name(best.matA), name(best.matB)], cell: best.cell, time: this.time,
    });
  }

  /* ---------- continuous collision ---------- */
  ccd(b, h) {
    if (b.ccd === false || !b.ccdFrom) return;
    const r = Math.max(0.005, (b.shape.innerRadius ?? 0.05) * 0.9);
    const d = vsub(T(), b.pos, b.ccdFrom);
    const L = vlen(d);
    if (b.ccd === 'auto' && L < r * 0.5) return;
    if (L < 1e-9) return;
    const dir = vscale(T(), d, 1 / L);
    const hit = this.sphereCast(b.ccdFrom, dir, r, L, { ignore: b, ccd: true });
    if (!hit) return;
    // stop at the first touch (a little back from it); the next substep's contacts take it from there
    const back = Math.max(0, hit.t - 0.002);
    for (let a = 0; a < 3; a++) b.pos[a] = b.ccdFrom[a] + dir[a] * back;
    b.ccdHits = (b.ccdHits ?? 0) + 1;
  }

  /* ---------- sleeping ---------- */
  updateSleep() {
    const S = this.sleep;
    const awake = this.bodies.filter((b) => b.type === 'dynamic' && !b.sleeping);
    for (const b of awake) {
      if (b.canSleep && vlen2(b.vel) < S.linear * S.linear && vlen2(b.angVel) < S.angular * S.angular) b.sleepTime += this.fixedDt;
      else b.sleepTime = 0;
    }
    // islands: union–find over contacts and joints between awake dynamic bodies
    const parent = new Map();
    const find = (x) => {
      while (parent.get(x) !== x) {
        parent.set(x, parent.get(parent.get(x)));
        x = parent.get(x);
      }
      return x;
    };
    const unite = (x, y) => {
      const a = find(x), b = find(y);
      if (a !== b) a.id < b.id ? parent.set(b, a) : parent.set(a, b);
    };
    for (const b of awake) parent.set(b, b);
    const dyn = (x) => x && parent.has(x);
    for (const m of this.manifolds.values()) if (m.points.length && dyn(m.a) && dyn(m.b)) unite(m.a, m.b);
    for (const j of this.joints) if (!j.broken && dyn(j.a) && dyn(j.b)) unite(j.a, j.b);
    const islands = new Map();
    for (const b of awake) {
      const r = find(b);
      if (!islands.has(r)) islands.set(r, []);
      islands.get(r).push(b);
    }
    let sleeping = 0;
    for (const isl of islands.values()) {
      if (!isl.every((b) => b.canSleep && b.sleepTime >= S.time)) continue;
      // (an island holding on to an awake body that is not dynamic, a kinematic one, stays awake)
      for (const b of isl) {
        b.sleeping = true;
        b.vel[0] = b.vel[1] = b.vel[2] = 0;
        b.angVel[0] = b.angVel[1] = b.angVel[2] = 0;
        b.sleepGroup = isl;
        b.prevPos = b.pos.slice();
        b.prevQuat = b.quat.slice();
      }
    }
    for (const b of this.bodies) if (b.sleeping) sleeping++;
    this.stats.bodies = this.bodies.length;
    this.stats.islands = islands.size;
    this.stats.sleeping = sleeping;
    this.stats.awake = this.bodies.filter((b) => b.type === 'dynamic' && !b.sleeping).length;
  }

  /* ---------- queries ---------- */
  /**
   * The first thing a ray hits: → { body (null: the voxel world), t, point, normal, material } or null.
   * opts: { ignore: body | (body) → bool, bodies = true, world = true, mask }
   */
  raycast(from, dir, maxDist = 1000, opts = {}) {
    return this.sphereCast(from, dir, 0, maxDist, opts);
  }

  /** A sphere of radius r swept along a ray: the first touch (t: how far its centre got). */
  sphereCast(from, dir, r, maxDist = 1000, opts = {}) {
    const l = vlen(dir);
    const d = vscale(T(), dir, 1 / (l || 1));
    let best = null;
    if (opts.world !== false && this.collider) {
      let hit = null;
      if (r <= 0) hit = rayGrid(this.collider, from, d, maxDist);
      else {
        // march at a fraction of the radius (and of a voxel), then refine by bisection
        const stepL = Math.max(1e-3, Math.min(r, this.collider.h) * 0.5);
        let t0 = 0;
        if (sphereHitsGrid(this.collider, from, r)) hit = { t: 0 };
        for (let t = stepL; !hit && t0 < maxDist; t += stepL) {
          const tt = Math.min(t, maxDist);
          if (sphereHitsGrid(this.collider, [from[0] + d[0] * tt, from[1] + d[1] * tt, from[2] + d[2] * tt], r)) {
            let lo = t0, hi = tt;
            for (let k = 0; k < 10; k++) {
              const mid = (lo + hi) / 2;
              if (sphereHitsGrid(this.collider, [from[0] + d[0] * mid, from[1] + d[1] * mid, from[2] + d[2] * mid], r)) hi = mid;
              else lo = mid;
            }
            hit = { t: lo };
            break;
          }
          t0 = tt;
          if (tt >= maxDist) break;
        }
        if (hit) {
          const c = [from[0] + d[0] * hit.t, from[1] + d[1] * hit.t, from[2] + d[2] * hit.t];
          const g = rayGrid(this.collider, c, d, r * 2 + this.collider.h);
          hit = { t: hit.t, point: g ? g.point : c, normal: g ? g.normal : vscale(T(), d, -1), cell: g?.cell ?? -1, material: g?.material ?? 0 };
        }
      }
      if (hit && hit.t <= maxDist) best = { body: null, ...hit };
    }
    if (opts.bodies !== false) {
      const ign = opts.ignore;
      const end = [from[0] + d[0] * (best ? best.t : maxDist), from[1] + d[1] * (best ? best.t : maxDist), from[2] + d[2] * (best ? best.t : maxDist)];
      const lo = [Math.min(from[0], end[0]) - r, Math.min(from[1], end[1]) - r, Math.min(from[2], end[2]) - r];
      const hi = [Math.max(from[0], end[0]) + r, Math.max(from[1], end[1]) + r, Math.max(from[2], end[2]) + r];
      for (const b of this.bodies) {
        if (b === ign || (typeof ign === 'function' && ign(b))) continue;
        if (opts.mask !== undefined && !(b.filter.group & opts.mask)) continue;
        if (opts.ccd && ign && (!(b.filter.group & ign.filter.mask) || !(ign.filter.group & b.filter.mask) || this.jointed(b, ign))) continue;
        const bb = b.aabb;
        if (bb[0] > hi[0] || bb[3] < lo[0] || bb[1] > hi[1] || bb[4] < lo[1] || bb[2] > hi[2] || bb[5] < lo[2]) continue;
        const hit = raycastShape(b.shape, b.shapePos(), b.R, from, d, best ? best.t : maxDist, r);
        if (hit && (!best || hit.t < best.t)) best = { body: b, t: hit.t, point: hit.point, normal: hit.normal, material: b.material, cell: -1 };
      }
    }
    return best;
  }

  /** Bodies whose shapes come within r of point c. */
  overlapSphere(c, r) {
    const probe = new Sphere(r);
    const out = [];
    const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    for (const b of this.bodies) {
      const bb = b.aabb;
      if (bb[0] > c[0] + r || bb[3] < c[0] - r || bb[1] > c[1] + r || bb[4] < c[1] - r || bb[2] > c[2] + r || bb[5] < c[2] - r) continue;
      let hit = false;
      collide(probe, c, I, b.shape, b.shapePos(), b.R, 0, (n, p, depth) => {
        if (depth >= 0) hit = true;
      });
      if (hit) out.push(b);
    }
    return out;
  }

  /**
   * A blast at `center`: every dynamic body within `radius` gets an impulse away from it at its
   * point nearest the blast (so it spins too), falling off as (1 − d/R)². Either { impulse }
   * (N·s at the centre, for a 1 kg reference), or { energy } (J: as sim/explosions.js throws
   * voxels, v0 = min(80, 8 + √(E/2000)) m/s, heavy things less: × min(1, √(2/m))).
   */
  explosion(center, { energy = 0, impulse = 0, radius = 3 } = {}) {
    const v0 = energy ? Math.min(80, 8 + Math.sqrt(energy / 2000)) : impulse;
    const hit = [];
    for (const b of this.bodies) {
      if (b.type !== 'dynamic') continue;
      const d = vsub(T(), b.pos, center);
      const dist = vlen(d);
      if (dist > radius) continue;
      const k = (1 - dist / radius) ** 2;
      const dv = energy ? v0 * k * Math.min(1, Math.sqrt(2 / b.mass)) : (impulse * k) / b.mass;
      const n = dist > 1e-6 ? vscale(T(), d, 1 / dist) : [0, 1, 0];
      // where on it the blast pushes: its point towards the blast
      const toward = Math.min(dist, (b.shape.innerRadius ?? 0.1) * 0.8);
      const at = [b.pos[0] - n[0] * toward + (this.rng() - 0.5) * toward, b.pos[1] - n[1] * toward, b.pos[2] - n[2] * toward + (this.rng() - 0.5) * toward];
      b.applyImpulse(vscale(T(), n, dv * b.mass), at);
      hit.push(b);
    }
    return hit;
  }
}
