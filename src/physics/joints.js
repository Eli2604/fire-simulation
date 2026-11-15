/**
 * Joints between two bodies (or a body and the world: b = null holds it to a fixed point).
 * Anchors are given in world coordinates at creation and kept in each body's frame.
 *
 *   BallJoint(a, b, anchor, { cone, twist, axis, friction })
 *       a shared point; optional swing cone (half angle, rad) about `axis` (world, at creation)
 *       and twist limit ±twist about it (a shoulder, a hip, a neck); friction: a torque (N·m)
 *       that resists turning (limp, not frictionless)
 *   HingeJoint(a, b, anchor, axis, { lower, upper, motorSpeed, maxMotorTorque, friction })
 *       turns about one axis only; angle limits relative to the pose at creation (an elbow, a
 *       knee, a door, a wheel with a motor)
 *   FixedJoint(a, b, anchor)        glued (breakable with breakImpulse)
 *   DistanceJoint(a, b, anchorA, anchorB, { min, max })   a rod (min = max) or a rope (max only)
 *   SliderJoint(a, b, anchor, axis, { lower, upper, motorSpeed, maxMotorForce })  a piston
 *
 * Every joint: collideConnected (false: the two bodies do not collide), breakImpulse (N·s in one
 * step: it breaks, joint.broken = true), enabled.
 */
import { Row } from './rows.js';
import { vsub, vcross, vdot, vnorm, vscale, vlen, m3mulv, perp, qmul, qconj, qrot, qfromTo } from './math.js';

const T = () => [0, 0, 0];

class Joint {
  constructor(a, b, opts = {}) {
    this.a = a;
    this.b = b;
    this.collideConnected = opts.collideConnected ?? false;
    this.breakImpulse = opts.breakImpulse ?? Infinity;
    this.broken = false;
    this.enabled = true;
    this.rows = [];
    this.active = [];
    this.userData = opts.userData ?? null;
  }
  /** World anchor ↔ body-frame anchor (a missing body: the world, the point itself). */
  local(body, p) {
    return body ? body.toLocal(p) : p.slice();
  }
  world(body, l) {
    return body ? body.toWorld(l) : l.slice();
  }
  r(body, l) {
    return body ? m3mulv(T(), body.R, l) : [0, 0, 0];
  }
  dir(body, l) {
    return body ? m3mulv(T(), body.R, l) : l.slice();
  }
  row(k) {
    while (this.rows.length <= k) this.rows.push(new Row());
    return this.rows[k];
  }
  /** Equality row (C → 0). */
  eq(row, C, h, beta, maxBias) {
    row.lo = -Infinity;
    row.hi = Infinity;
    row.bias = Math.max(-maxBias, Math.min(maxBias, (-beta * C) / h));
    row.biasRelax = 0;
    this.active.push(row);
  }
  /** Inequality row (C ≥ 0); inactive (λ reset) while far from the limit. */
  ge(row, C, h, beta, maxBias) {
    row.lo = 0;
    row.hi = Infinity;
    if (C > 0) {
      row.bias = row.biasRelax = -C / h;
    } else {
      row.bias = Math.min(maxBias, (-beta * C) / h);
      row.biasRelax = 0;
    }
    this.active.push(row);
  }
  /** Point-to-point rows: rows k..k+2. */
  ballRows(k, h, beta, maxBias) {
    const pA = this.world(this.a, this.la), pB = this.world(this.b, this.lb);
    const rA = this.r(this.a, this.la), rB = this.r(this.b, this.lb);
    const d = vsub(T(), pB, pA);
    for (let ax = 0; ax < 3; ax++) {
      const e = [0, 0, 0];
      e[ax] = 1;
      const row = this.row(k + ax).set(this.a, this.b, vscale(T(), e, -1), vscale(T(), vcross(T(), rA, e), -1), e, vcross(T(), rB, e));
      this.eq(row, d[ax], h, beta, maxBias);
    }
  }
  /** Angular friction rows (target: no relative turning; at most `friction` N·m). */
  frictionRows(k, h, axes) {
    for (let i = 0; i < axes.length; i++) {
      const e = axes[i];
      const row = this.row(k + i).set(this.a, this.b, null, vscale(T(), e, -1), null, e);
      row.bias = row.biasRelax = 0;
      row.lo = -this.friction * h;
      row.hi = this.friction * h;
      this.active.push(row);
    }
  }
  /** The relative orientation now against the one at creation, as a small rotation vector (world). */
  angError() {
    const qa = this.a ? this.a.quat : [0, 0, 0, 1], qb = this.b ? this.b.quat : [0, 0, 0, 1];
    // qB = exp(θ)·qA·q0  →  exp(θ) = qB·(qA·q0)⁻¹
    const t = qmul([0, 0, 0, 1], qa, this.q0);
    const e = qmul([0, 0, 0, 1], qb, qconj([0, 0, 0, 1], t));
    const s = e[3] < 0 ? -2 : 2;
    return [e[0] * s, e[1] * s, e[2] * s];
  }
  initQ0() {
    const qa = this.a ? this.a.quat : [0, 0, 0, 1], qb = this.b ? this.b.quat : [0, 0, 0, 1];
    this.q0 = qmul([0, 0, 0, 1], qconj([0, 0, 0, 1], qa), qb);
  }
  /** Rows that keep the relative orientation (k..k+2). */
  fixedAngleRows(k, h, beta, maxBias) {
    const th = this.angError();
    for (let ax = 0; ax < 3; ax++) {
      const e = [0, 0, 0];
      e[ax] = 1;
      const row = this.row(k + ax).set(this.a, this.b, null, vscale(T(), e, -1), null, e);
      this.eq(row, th[ax], h, beta, maxBias);
    }
  }
  /** Whether it broke this step (the impulse it took). */
  checkBreak() {
    if (this.breakImpulse === Infinity) return false;
    let s = 0;
    for (const r of this.active) s += r.lambda * r.lambda;
    if (Math.sqrt(s) > this.breakImpulse) this.broken = true;
    return this.broken;
  }
}

export class BallJoint extends Joint {
  constructor(a, b, anchor, opts = {}) {
    super(a, b, opts);
    this.type = 'ball';
    this.la = this.local(a, anchor);
    this.lb = this.local(b, anchor);
    this.cone = opts.cone ?? null;
    this.twist = opts.twist ?? null;
    this.friction = opts.friction ?? 0;
    if (this.cone !== null || this.twist !== null) {
      const axis = vnorm(T(), opts.axis ?? [0, 1, 0]);
      this.ta = a ? a.toLocalDir(axis) : axis;
      this.tb = b ? b.toLocalDir(axis) : axis;
      const r1 = T(), r2 = T();
      perp(axis, r1, r2);
      this.ra = a ? a.toLocalDir(r1) : r1;
      this.rb = b ? b.toLocalDir(r1) : r1;
    }
  }
  prepare(h, beta, maxBias) {
    this.active.length = 0;
    this.ballRows(0, h, beta, maxBias);
    let k = 3;
    if (this.cone !== null || this.twist !== null) {
      const tA = this.dir(this.a, this.ta), tB = this.dir(this.b, this.tb);
      if (this.cone !== null) {
        const c = Math.max(-1, Math.min(1, vdot(tA, tB)));
        const phi = Math.acos(c);
        const ax = vcross(T(), tA, tB);
        const l = vlen(ax);
        if (phi > this.cone - 0.15 && l > 1e-6) {
          vscale(ax, ax, 1 / l);
          // C = cone − φ ≥ 0; φ grows turning B about ax
          const row = this.row(k).set(this.a, this.b, null, ax, null, vscale(T(), ax, -1));
          this.ge(row, this.cone - phi, h, beta, maxBias);
        } else this.row(k).lambda = 0;
        k++;
      }
      if (this.twist !== null) {
        const th = twistAngle(tA, tB, this.dir(this.a, this.ra), this.dir(this.b, this.rb));
        const ax = vnorm(T(), [tA[0] + tB[0], tA[1] + tB[1], tA[2] + tB[2]]);
        const neg = vscale(T(), ax, -1);
        if (th < -this.twist + 0.1) {
          const row = this.row(k).set(this.a, this.b, null, neg, null, ax);
          this.ge(row, th + this.twist, h, beta, maxBias);
        } else this.row(k).lambda = 0;
        if (th > this.twist - 0.1) {
          const row = this.row(k + 1).set(this.a, this.b, null, ax, null, neg);
          this.ge(row, this.twist - th, h, beta, maxBias);
        } else this.row(k + 1).lambda = 0;
        k += 2;
      }
    }
    if (this.friction > 0) this.frictionRows(k, h, [[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
  }
}

/** Twist of B against A about the (swung) axis: B's reference swung back onto A's axis, measured against A's. */
export function twistAngle(tA, tB, rA, rB) {
  const q = qfromTo([0, 0, 0, 1], tB, tA);
  const r = qrot(T(), q, rB);
  return Math.atan2(vdot(vcross(T(), rA, r), tA), vdot(rA, r));
}

export class HingeJoint extends Joint {
  constructor(a, b, anchor, axis, opts = {}) {
    super(a, b, opts);
    this.type = 'hinge';
    this.la = this.local(a, anchor);
    this.lb = this.local(b, anchor);
    const ax = vnorm(T(), axis);
    this.axA = a ? a.toLocalDir(ax) : ax;
    this.axB = b ? b.toLocalDir(ax) : ax;
    const r1 = T(), r2 = T();
    perp(ax, r1, r2);
    this.refA = a ? a.toLocalDir(r1) : r1;
    this.refB = b ? b.toLocalDir(r1) : r1;
    this.lower = opts.lower ?? null;
    this.upper = opts.upper ?? null;
    this.motorSpeed = opts.motorSpeed ?? 0;
    this.maxMotorTorque = opts.maxMotorTorque ?? 0;
    this.friction = opts.friction ?? 0;
  }
  /** The angle (rad) of B about the axis against the pose at creation. */
  angle() {
    const aA = this.dir(this.a, this.axA);
    const rA = this.dir(this.a, this.refA), rB = this.dir(this.b, this.refB);
    const p = vsub(T(), rB, vscale(T(), aA, vdot(rB, aA)));
    return Math.atan2(vdot(vcross(T(), rA, p), aA), vdot(rA, p));
  }
  prepare(h, beta, maxBias) {
    this.active.length = 0;
    this.ballRows(0, h, beta, maxBias);
    const aA = this.dir(this.a, this.axA), aB = this.dir(this.b, this.axB);
    const p = T(), q = T();
    perp(aA, p, q);
    const err = vcross(T(), aA, aB);
    let k = 3;
    for (const e of [p, q]) {
      const row = this.row(k++).set(this.a, this.b, null, vscale(T(), e, -1), null, e);
      this.eq(row, vdot(err, e), h, beta, maxBias);
    }
    const th = this.angle();
    this.theta = th;
    const neg = vscale(T(), aA, -1);
    if (this.lower !== null && th < this.lower + 0.1) this.ge(this.row(k).set(this.a, this.b, null, neg, null, aA), th - this.lower, h, beta, maxBias);
    else this.row(k).lambda = 0;
    k++;
    if (this.upper !== null && th > this.upper - 0.1) this.ge(this.row(k).set(this.a, this.b, null, aA, null, neg), this.upper - th, h, beta, maxBias);
    else this.row(k).lambda = 0;
    k++;
    const motor = this.maxMotorTorque > 0, fr = this.friction > 0;
    if (motor || fr) {
      const row = this.row(k).set(this.a, this.b, null, neg, null, aA);
      row.bias = row.biasRelax = motor ? this.motorSpeed : 0;
      const lim = (motor ? this.maxMotorTorque : this.friction) * h;
      row.lo = -lim;
      row.hi = lim;
      this.active.push(row);
    }
  }
}

export class FixedJoint extends Joint {
  constructor(a, b, anchor, opts = {}) {
    super(a, b, opts);
    this.type = 'fixed';
    this.la = this.local(a, anchor);
    this.lb = this.local(b, anchor);
    this.initQ0();
  }
  prepare(h, beta, maxBias) {
    this.active.length = 0;
    this.ballRows(0, h, beta, maxBias);
    this.fixedAngleRows(3, h, beta, maxBias);
  }
}

export class DistanceJoint extends Joint {
  constructor(a, b, anchorA, anchorB, opts = {}) {
    super(a, b, { collideConnected: true, ...opts });
    this.type = 'distance';
    this.la = this.local(a, anchorA);
    this.lb = this.local(b, anchorB);
    const L = vlen(vsub(T(), anchorB, anchorA));
    this.min = opts.min ?? (opts.rope ? 0 : L);
    this.max = opts.max ?? L;
  }
  get length() {
    return vlen(vsub(T(), this.world(this.b, this.lb), this.world(this.a, this.la)));
  }
  prepare(h, beta, maxBias) {
    this.active.length = 0;
    const pA = this.world(this.a, this.la), pB = this.world(this.b, this.lb);
    const rA = this.r(this.a, this.la), rB = this.r(this.b, this.lb);
    const d = vsub(T(), pB, pA);
    const L = vlen(d);
    const n = L > 1e-9 ? vscale(T(), d, 1 / L) : [0, 1, 0];
    const J = (s) => [vscale(T(), n, -s), vscale(T(), vcross(T(), rA, n), -s), vscale(T(), n, s), vscale(T(), vcross(T(), rB, n), s)];
    if (this.min === this.max) {
      const [la, aa, lb, ab] = J(1);
      this.eq(this.row(0).set(this.a, this.b, la, aa, lb, ab), L - this.max, h, beta, maxBias);
      return;
    }
    // a rope: taut only (C = max − L ≥ 0), and a strut when it has a minimum
    if (this.max - L < 0.1 * this.max + 0.05) {
      const [la, aa, lb, ab] = J(-1);
      this.ge(this.row(0).set(this.a, this.b, la, aa, lb, ab), this.max - L, h, beta, maxBias);
    } else this.row(0).lambda = 0;
    if (this.min > 0 && L - this.min < 0.1 * this.min + 0.05) {
      const [la, aa, lb, ab] = J(1);
      this.ge(this.row(1).set(this.a, this.b, la, aa, lb, ab), L - this.min, h, beta, maxBias);
    } else this.row(1).lambda = 0;
  }
}

export class SliderJoint extends Joint {
  constructor(a, b, anchor, axis, opts = {}) {
    super(a, b, opts);
    this.type = 'slider';
    this.la = this.local(a, anchor);
    this.lb = this.local(b, anchor);
    const ax = vnorm(T(), axis);
    this.axA = a ? a.toLocalDir(ax) : ax;
    this.lower = opts.lower ?? null;
    this.upper = opts.upper ?? null;
    this.motorSpeed = opts.motorSpeed ?? 0;
    this.maxMotorForce = opts.maxMotorForce ?? 0;
    this.initQ0();
  }
  /** How far B has slid along the axis from where it started. */
  position() {
    const aw = this.dir(this.a, this.axA);
    return vdot(vsub(T(), this.world(this.b, this.lb), this.world(this.a, this.la)), aw);
  }
  prepare(h, beta, maxBias) {
    this.active.length = 0;
    const aw = this.dir(this.a, this.axA);
    const pA = this.world(this.a, this.la), pB = this.world(this.b, this.lb);
    const rB = this.r(this.b, this.lb);
    // (the arm on A reaches to B's anchor: the line turns with A)
    const rA = this.a ? vsub(T(), pB, this.a.pos) : [0, 0, 0];
    const d = vsub(T(), pB, pA);
    const p = T(), q = T();
    perp(aw, p, q);
    const J = (e, s) => [vscale(T(), e, -s), vscale(T(), vcross(T(), rA, e), -s), vscale(T(), e, s), vscale(T(), vcross(T(), rB, e), s)];
    let k = 0;
    for (const e of [p, q]) {
      const [la, aa, lb, ab] = J(e, 1);
      this.eq(this.row(k++).set(this.a, this.b, la, aa, lb, ab), vdot(d, e), h, beta, maxBias);
    }
    this.fixedAngleRows(k, h, beta, maxBias);
    k += 3;
    const s = vdot(d, aw);
    this.pos = s;
    if (this.lower !== null && s < this.lower + 0.05) {
      const [la, aa, lb, ab] = J(aw, 1);
      this.ge(this.row(k).set(this.a, this.b, la, aa, lb, ab), s - this.lower, h, beta, maxBias);
    } else this.row(k).lambda = 0;
    k++;
    if (this.upper !== null && s > this.upper - 0.05) {
      const [la, aa, lb, ab] = J(aw, -1);
      this.ge(this.row(k).set(this.a, this.b, la, aa, lb, ab), this.upper - s, h, beta, maxBias);
    } else this.row(k).lambda = 0;
    k++;
    if (this.maxMotorForce > 0) {
      const [la, aa, lb, ab] = J(aw, 1);
      const row = this.row(k).set(this.a, this.b, la, aa, lb, ab);
      row.bias = row.biasRelax = this.motorSpeed;
      row.lo = -this.maxMotorForce * h;
      row.hi = this.maxMotorForce * h;
      this.active.push(row);
    }
  }
}
