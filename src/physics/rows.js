/**
 * One scalar velocity constraint between two bodies (a "row"): Ċ = J·v with
 * J = [linA, angA, linB, angB], solved by sequential impulses. bias is the velocity the row drives
 * Ċ towards with position correction on (Baumgarte), biasRelax the one without (the relax pass);
 * the accumulated impulse λ is clamped to [lo, hi].
 */
import { m3mulv } from './math.js';

export class Row {
  constructor() {
    this.a = null;
    this.b = null;
    this.linA = [0, 0, 0];
    this.angA = [0, 0, 0];
    this.linB = [0, 0, 0];
    this.angB = [0, 0, 0];
    this.iA = [0, 0, 0]; // invI_A·angA
    this.iB = [0, 0, 0];
    this.m = 0;
    this.bias = 0;
    this.biasRelax = 0;
    this.lo = -Infinity;
    this.hi = Infinity;
    this.lambda = 0;
  }
  /** Set the Jacobian; computes the effective mass. */
  set(a, b, linA, angA, linB, angB) {
    this.a = a;
    this.b = b;
    for (let k = 0; k < 3; k++) {
      this.linA[k] = linA ? linA[k] : 0;
      this.angA[k] = angA ? angA[k] : 0;
      this.linB[k] = linB ? linB[k] : 0;
      this.angB[k] = angB ? angB[k] : 0;
    }
    let k = 0;
    if (a && a.im) {
      m3mulv(this.iA, a.iIw, this.angA);
      k += a.im * dot(this.linA, this.linA) + dot(this.angA, this.iA);
    } else this.iA[0] = this.iA[1] = this.iA[2] = 0;
    if (b && b.im) {
      m3mulv(this.iB, b.iIw, this.angB);
      k += b.im * dot(this.linB, this.linB) + dot(this.angB, this.iB);
    } else this.iB[0] = this.iB[1] = this.iB[2] = 0;
    this.m = k > 1e-12 ? 1 / k : 0;
    return this;
  }
  cdot() {
    let v = 0;
    const a = this.a, b = this.b;
    if (a) v += dot(this.linA, a.vel) + dot(this.angA, a.angVel);
    if (b) v += dot(this.linB, b.vel) + dot(this.angB, b.angVel);
    return v;
  }
  apply(d) {
    const a = this.a, b = this.b;
    if (a && a.im) {
      const s = a.im * d;
      a.vel[0] += this.linA[0] * s;
      a.vel[1] += this.linA[1] * s;
      a.vel[2] += this.linA[2] * s;
      a.angVel[0] += this.iA[0] * d;
      a.angVel[1] += this.iA[1] * d;
      a.angVel[2] += this.iA[2] * d;
    }
    if (b && b.im) {
      const s = b.im * d;
      b.vel[0] += this.linB[0] * s;
      b.vel[1] += this.linB[1] * s;
      b.vel[2] += this.linB[2] * s;
      b.angVel[0] += this.iB[0] * d;
      b.angVel[1] += this.iB[1] * d;
      b.angVel[2] += this.iB[2] * d;
    }
  }
  solve(relax) {
    if (!this.m) return;
    const target = relax ? this.biasRelax : this.bias;
    let d = -this.m * (this.cdot() - target);
    const old = this.lambda;
    let nl = old + d;
    if (nl < this.lo) nl = this.lo;
    else if (nl > this.hi) nl = this.hi;
    this.lambda = nl;
    d = nl - old;
    if (d) this.apply(d);
  }
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
