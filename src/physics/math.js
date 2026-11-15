/**
 * Small vector / quaternion / 3×3 matrix helpers on plain arrays (no three.js: the physics core
 * runs headless in Node). Vectors are [x, y, z], quaternions [x, y, z, w], matrices row-major [9].
 * Functions that take an `out` write into it and return it (no allocation in the hot loops).
 */

export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
export const vset = (o, x, y, z) => ((o[0] = x), (o[1] = y), (o[2] = z), o);
export const vcopy = (o, a) => ((o[0] = a[0]), (o[1] = a[1]), (o[2] = a[2]), o);
export const vadd = (o, a, b) => ((o[0] = a[0] + b[0]), (o[1] = a[1] + b[1]), (o[2] = a[2] + b[2]), o);
export const vsub = (o, a, b) => ((o[0] = a[0] - b[0]), (o[1] = a[1] - b[1]), (o[2] = a[2] - b[2]), o);
export const vscale = (o, a, s) => ((o[0] = a[0] * s), (o[1] = a[1] * s), (o[2] = a[2] * s), o);
/** o = a + b·s */
export const vmadd = (o, a, b, s) => ((o[0] = a[0] + b[0] * s), (o[1] = a[1] + b[1] * s), (o[2] = a[2] + b[2] * s), o);
export const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const vlen = (a) => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
export const vlen2 = (a) => a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
export const vdist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export function vcross(o, a, b) {
  const x = a[1] * b[2] - a[2] * b[1];
  const y = a[2] * b[0] - a[0] * b[2];
  const z = a[0] * b[1] - a[1] * b[0];
  o[0] = x;
  o[1] = y;
  o[2] = z;
  return o;
}
export function vnorm(o, a) {
  const l = vlen(a);
  return l > 1e-12 ? vscale(o, a, 1 / l) : vset(o, 0, 0, 0);
}
export const vlerp = (o, a, b, t) => ((o[0] = a[0] + (b[0] - a[0]) * t), (o[1] = a[1] + (b[1] - a[1]) * t), (o[2] = a[2] + (b[2] - a[2]) * t), o);
/** Two unit vectors perpendicular to unit n (and to each other). */
export function perp(n, t1, t2) {
  if (Math.abs(n[0]) > 0.57735) vset(t1, n[1], -n[0], 0);
  else vset(t1, 0, n[2], -n[1]);
  vnorm(t1, t1);
  vcross(t2, n, t1);
  return t1;
}

/* ---------- quaternions [x, y, z, w] ---------- */
export const qident = () => [0, 0, 0, 1];
export function qmul(o, a, b) {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3];
  const bx = b[0], by = b[1], bz = b[2], bw = b[3];
  o[0] = aw * bx + ax * bw + ay * bz - az * by;
  o[1] = aw * by - ax * bz + ay * bw + az * bx;
  o[2] = aw * bz + ax * by - ay * bx + az * bw;
  o[3] = aw * bw - ax * bx - ay * by - az * bz;
  return o;
}
export const qconj = (o, a) => ((o[0] = -a[0]), (o[1] = -a[1]), (o[2] = -a[2]), (o[3] = a[3]), o);
export function qnorm(o, a) {
  const l = Math.hypot(a[0], a[1], a[2], a[3]) || 1;
  o[0] = a[0] / l;
  o[1] = a[1] / l;
  o[2] = a[2] / l;
  o[3] = a[3] / l;
  return o;
}
export function qaxis(o, axis, angle) {
  const s = Math.sin(angle / 2);
  const l = vlen(axis) || 1;
  o[0] = (axis[0] / l) * s;
  o[1] = (axis[1] / l) * s;
  o[2] = (axis[2] / l) * s;
  o[3] = Math.cos(angle / 2);
  return o;
}
/** Rotate v by q. */
export function qrot(o, q, v) {
  const x = v[0], y = v[1], z = v[2];
  const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  o[0] = ix * qw + iw * -qx + iy * -qz - iz * -qy;
  o[1] = iy * qw + iw * -qy + iz * -qx - ix * -qz;
  o[2] = iz * qw + iw * -qz + ix * -qy - iy * -qx;
  return o;
}
/** Rotate v by the inverse of q. */
export function qirot(o, q, v) {
  const c = [-q[0], -q[1], -q[2], q[3]];
  return qrot(o, c, v);
}
/** q advanced by angular velocity w (world) over dt (exact for constant w). */
export function qintegrate(q, w, dt) {
  const wl = vlen(w);
  if (wl * dt < 1e-9) return q;
  const d = qaxis([0, 0, 0, 1], w, wl * dt);
  qmul(q, d, q);
  return qnorm(q, q);
}
export function qslerp(o, a, b, t) {
  let bx = b[0], by = b[1], bz = b[2], bw = b[3];
  let c = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (c < 0) {
    c = -c;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let s0 = 1 - t, s1 = t;
  if (c < 0.9995) {
    const th = Math.acos(c), s = Math.sin(th);
    s0 = Math.sin((1 - t) * th) / s;
    s1 = Math.sin(t * th) / s;
  }
  o[0] = a[0] * s0 + bx * s1;
  o[1] = a[1] * s0 + by * s1;
  o[2] = a[2] * s0 + bz * s1;
  o[3] = a[3] * s0 + bw * s1;
  return qnorm(o, o);
}
/** The shortest rotation taking unit a onto unit b. */
export function qfromTo(o, a, b) {
  const d = vdot(a, b);
  if (d < -0.999999) {
    const t = [0, 0, 0], u = [0, 0, 0];
    perp(a, t, u);
    return qaxis(o, t, Math.PI);
  }
  const c = vcross([0, 0, 0], a, b);
  o[0] = c[0];
  o[1] = c[1];
  o[2] = c[2];
  o[3] = 1 + d;
  return qnorm(o, o);
}
/** Rotation matrix (row-major) of q. */
export function mat3FromQuat(o, q) {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  o[0] = 1 - (yy + zz);
  o[1] = xy - wz;
  o[2] = xz + wy;
  o[3] = xy + wz;
  o[4] = 1 - (xx + zz);
  o[5] = yz - wx;
  o[6] = xz - wy;
  o[7] = yz + wx;
  o[8] = 1 - (xx + yy);
  return o;
}
export function quatFromMat3(o, m) {
  const tr = m[0] + m[4] + m[8];
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    o[3] = 0.25 / s;
    o[0] = (m[7] - m[5]) * s;
    o[1] = (m[2] - m[6]) * s;
    o[2] = (m[3] - m[1]) * s;
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = 2 * Math.sqrt(1 + m[0] - m[4] - m[8]);
    o[3] = (m[7] - m[5]) / s;
    o[0] = 0.25 * s;
    o[1] = (m[1] + m[3]) / s;
    o[2] = (m[2] + m[6]) / s;
  } else if (m[4] > m[8]) {
    const s = 2 * Math.sqrt(1 + m[4] - m[0] - m[8]);
    o[3] = (m[2] - m[6]) / s;
    o[0] = (m[1] + m[3]) / s;
    o[1] = 0.25 * s;
    o[2] = (m[5] + m[7]) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m[8] - m[0] - m[4]);
    o[3] = (m[3] - m[1]) / s;
    o[0] = (m[2] + m[6]) / s;
    o[1] = (m[5] + m[7]) / s;
    o[2] = 0.25 * s;
  }
  return qnorm(o, o);
}
/** Euler angles (YXZ order, as three.js uses for the loose things) of q. */
export function eulerYXZ(q, out = [0, 0, 0]) {
  const m = mat3FromQuat([], q);
  // three.js Euler.setFromRotationMatrix, order 'YXZ' (m11 m12 m13 / m21 m22 m23 / m31 m32 m33)
  const m13 = m[2], m22 = m[4], m23 = m[5], m31 = m[6], m33 = m[8], m21 = m[3];
  out[0] = Math.asin(-Math.max(-1, Math.min(1, m23)));
  if (Math.abs(m23) < 0.9999999) {
    out[1] = Math.atan2(m13, m33);
    out[2] = Math.atan2(m21, m22);
  } else {
    out[1] = Math.atan2(-m31, m[0]);
    out[2] = 0;
  }
  return out;
}
export function quatFromEulerYXZ(e, o = [0, 0, 0, 1]) {
  const qy = qaxis([0, 0, 0, 1], [0, 1, 0], e[1]);
  const qx = qaxis([0, 0, 0, 1], [1, 0, 0], e[0]);
  const qz = qaxis([0, 0, 0, 1], [0, 0, 1], e[2]);
  qmul(o, qy, qx);
  return qmul(o, o, qz);
}

/* ---------- 3×3 matrices (row-major) ---------- */
export const m3ident = () => [1, 0, 0, 0, 1, 0, 0, 0, 1];
export function m3mulv(o, m, v) {
  const x = v[0], y = v[1], z = v[2];
  o[0] = m[0] * x + m[1] * y + m[2] * z;
  o[1] = m[3] * x + m[4] * y + m[5] * z;
  o[2] = m[6] * x + m[7] * y + m[8] * z;
  return o;
}
/** o = mᵀ·v */
export function m3tmulv(o, m, v) {
  const x = v[0], y = v[1], z = v[2];
  o[0] = m[0] * x + m[3] * y + m[6] * z;
  o[1] = m[1] * x + m[4] * y + m[7] * z;
  o[2] = m[2] * x + m[5] * y + m[8] * z;
  return o;
}
export function m3mul(o, a, b) {
  const r = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[3 * i + j] = a[3 * i] * b[j] + a[3 * i + 1] * b[3 + j] + a[3 * i + 2] * b[6 + j];
  for (let k = 0; k < 9; k++) o[k] = r[k];
  return o;
}
export function m3transpose(o, a) {
  const r = [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
  for (let k = 0; k < 9; k++) o[k] = r[k];
  return o;
}
export function m3inverse(o, m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-30) {
    for (let k = 0; k < 9; k++) o[k] = 0;
    return o;
  }
  const s = 1 / det;
  o[0] = A * s;
  o[1] = -(b * i - c * h) * s;
  o[2] = (b * f - c * e) * s;
  o[3] = B * s;
  o[4] = (a * i - c * g) * s;
  o[5] = -(a * f - c * d) * s;
  o[6] = C * s;
  o[7] = -(a * h - b * g) * s;
  o[8] = (a * e - b * d) * s;
  return o;
}
/** R·M·Rᵀ (an inertia tensor turned into another frame). */
export function m3rotate(o, R, M) {
  const t = m3mul([], R, M);
  return m3mul(o, t, m3transpose([], R));
}
export const m3add = (o, a, b) => {
  for (let k = 0; k < 9; k++) o[k] = a[k] + b[k];
  return o;
};
export const m3scale = (o, a, s) => {
  for (let k = 0; k < 9; k++) o[k] = a[k] * s;
  return o;
};
/** Inertia of a point mass m at offset r (parallel axis term): m·(|r|²·I − r·rᵀ). */
export function parallelAxis(r, m) {
  const [x, y, z] = r;
  const r2 = x * x + y * y + z * z;
  return [m * (r2 - x * x), -m * x * y, -m * x * z, -m * x * y, m * (r2 - y * y), -m * y * z, -m * x * z, -m * y * z, m * (r2 - z * z)];
}

/* ---------- a seeded random generator (deterministic runs) ---------- */
export function makeRng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
