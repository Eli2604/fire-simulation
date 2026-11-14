/**
 * Things that stir the water and the air (world.stirrers, placed as objects: models/waterVortex.js,
 * models/windHose.js, models/windJet.js):
 *
 *  - a whirlpool (kind 'vortex'): a current going round (a Lamb-Oseen vortex: solid-body rotation
 *    in its core, falling off as 1/r outside it) and in towards the middle, with a funnel dipping
 *    into the surface. It carries round and draws in what floats: loose things, a swimmer.
 *  - a wind hose / tornado (kind 'hose'): the same rotation in the air, with an updraft in its core
 *    and inflow along the ground, travelling over the scene. It goes into the air model
 *    (sim/air.js stirAir): smoke, flames and hot gas follow it (a fire whirl over a fire), and it
 *    lifts and whirls light loose things and debris.
 *  - a wind jet (kind 'jet', a fan or a blower): a cone of moving air from a nozzle, spreading and
 *    slowing as it goes.
 *
 * All of it is a function of the world's time and the stirrers' settings: deterministic.
 */
import { MAT } from './materials.js';

const TAU = Math.PI * 2;
const LO = 1.256; // Lamb-Oseen: the peak of (1 - e^(-a x²)) / x is at x = 1 for this a
const PEAK = 1 / 0.7153; // ... and its value there

/** Speed going round (m/s) at r from the axis of a vortex with core radius rc and peak speed U (at rc). */
export function swirlSpeed(r, rc, U) {
  if (r <= 1e-6 || rc <= 0) return 0;
  const x = r / rc;
  return U * PEAK * ((1 - Math.exp(-LO * x * x)) / x);
}

/** How far out (m) a stirrer acts at all. */
export function reachOf(s) {
  if (s.kind === 'vortex') return s.radius * 2;
  if (s.kind === 'hose') return s.radius * 6;
  if (s.kind === 'jet') return s.range;
  return 0;
}

const tri = (x, lo, hi) => {
  // a triangle wave: x bounced back and forth between lo and hi
  const L = hi - lo;
  if (L <= 0) return (lo + hi) / 2;
  const m = (((x - lo) % (2 * L)) + 2 * L) % (2 * L);
  return lo + (m < L ? m : 2 * L - m);
};

/** Where a wind hose is at time t (it travels, turning back at the edges of the scene). */
export function hoseCentre(s, t, size) {
  if (!(s.travel > 0)) return s.p0;
  const a = ((s.heading ?? 0) * Math.PI) / 180;
  const m = Math.min(s.radius * 1.5, size[0] / 4, size[2] / 4);
  return [tri(s.p0[0] + Math.cos(a) * s.travel * t, m, size[0] - m), s.p0[1], tri(s.p0[2] + Math.sin(a) * s.travel * t, m, size[2] - m)];
}

/**
 * The surface current of a whirlpool at (x, z): [vx, vz] (m/s), going round (dir: +1
 * anticlockwise seen from above, -1 clockwise) and in, gone beyond twice its radius.
 */
export function vortexCurrent(s, x, z, out = [0, 0]) {
  const dx = x - s.p[0];
  const dz = z - s.p[2];
  const r = Math.hypot(dx, dz);
  const R = s.radius;
  out[0] = out[1] = 0;
  if (r >= 2 * R || r < 1e-6) return out;
  const rc = R * 0.35;
  const fade = r < R ? 1 : 1 - smooth((r - R) / R);
  const vt = swirlSpeed(r, rc, s.strength) * fade;
  const vr = -(s.inflow ?? 0.3) * vt; // drawn in
  const ux = dx / r;
  const uz = dz / r;
  // (+1: anticlockwise seen from above, y up: x → -z)
  const d = s.dir ?? 1;
  out[0] = ux * vr + uz * vt * d;
  out[1] = uz * vr - ux * vt * d;
  return out;
}

/** How far the water's surface dips into the funnel at r from the middle (m, ≥ 0). */
export function funnelDepth(s, r) {
  const R = s.radius;
  if (r >= R) return 0;
  const rc = R * 0.25;
  const x = r / rc;
  return (s.depth / (1 + x * x)) * (1 - smooth((r - 0.55 * R) / (0.45 * R)));
}

const smooth = (t) => {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
};

/**
 * The air's velocity from a wind hose at p: [vx, vy, vz] added into out. Rotation round its
 * axis, inflow near the ground, an updraft in its core up to its height (spreading out above).
 */
export function hoseWind(s, c, p, out) {
  const dx = p[0] - c[0];
  const dz = p[2] - c[2];
  const r = Math.hypot(dx, dz);
  const rc = s.radius;
  if (r > rc * 6) return out;
  const y = p[1] - c[1];
  const H = s.height;
  if (y < -0.5 || y > H * 1.6) return out;
  // above its top the funnel spreads and the wind dies away
  const top = y <= H ? 1 : Math.exp(-(y - H) / (0.25 * H));
  // the funnel is narrow at the ground, wider aloft
  const rcy = rc * (0.7 + 0.6 * Math.min(1, Math.max(0, y / H)));
  const vt = swirlSpeed(r, rcy, s.spin) * top * (1 - smooth((r - 4 * rc) / (2 * rc)));
  const low = Math.max(0, 1 - y / (0.25 * H)); // the inflow layer along the ground
  const vr = -vt * (0.15 + 0.45 * low) + (y > H ? vt * 0.3 : 0);
  SPIN.vt = 0;
  if (r > 1e-6) {
    const ux = dx / r;
    const uz = dz / r;
    const d = s.dir ?? 1;
    SPIN.vt = vt * d;
    SPIN.r = r;
    out[0] += ux * vr + uz * vt * d;
    out[2] += uz * vr - ux * vt * d;
  }
  // the updraft: strongest in the core, a little near the ground already
  out[1] += s.updraft * Math.exp(-((r / rcy) ** 2)) * top * Math.min(1, 0.35 + y / (0.15 * H));
  return out;
}

// (the last hoseWind's speed going round, signed, and its radius: for stirAir's departure points)
const SPIN = { vt: 0, r: 0 };

/** The air's velocity from a wind jet (a fan, a blower) at p, added into out. */
export function jetWind(s, p, out) {
  const rx = p[0] - s.p[0];
  const ry = p[1] - s.p[1];
  const rz = p[2] - s.p[2];
  const d = s.dir;
  const x = rx * d[0] + ry * d[1] + rz * d[2];
  if (x < -s.nozzle || x > s.range) return out;
  const px = rx - d[0] * x;
  const py = ry - d[1] * x;
  const pz = rz - d[2] * x;
  const rho = Math.hypot(px, py, pz);
  const w = s.nozzle + Math.max(0, x) * Math.tan((s.spread * Math.PI) / 180);
  if (rho > w * 2.5) return out;
  // its momentum spread over a widening cone: slower further out (∝ 1/width)
  const u = s.speed * (s.nozzle / w) * Math.exp(-((rho / w) ** 2)) * (1 - smooth((x - 0.75 * s.range) / (0.25 * s.range)));
  out[0] += d[0] * u;
  out[1] += d[1] * u;
  out[2] += d[2] * u;
  return out;
}

/** The air's velocity from all the wind hoses and jets at p (m/s), into out. */
export function airStirAt(w, p, out = [0, 0, 0]) {
  out[0] = out[1] = out[2] = 0;
  for (const s of w.stirrers ?? []) {
    if (s.kind === 'hose') hoseWind(s, s.p, p, out);
    else if (s.kind === 'jet') jetWind(s, p, out);
  }
  return out;
}

/** The surface current of all whirlpools at (x, z): [vx, vz]. */
export function waterStirAt(w, x, z, out = [0, 0]) {
  out[0] = out[1] = 0;
  const t = [0, 0];
  for (const s of w.stirrers ?? []) {
    if (s.kind !== 'vortex') continue;
    vortexCurrent(s, x, z, t);
    out[0] += t[0];
    out[1] += t[1];
  }
  return out;
}

/** The height of the water's surface at (x, z): the top of a column of water there, or the sea (null: none). */
export function waterSurfaceAt(w, x, z) {
  const cx = Math.floor(x / w.h);
  const cz = Math.floor(z / w.h);
  if (cx >= 0 && cz >= 0 && cx < w.nx && cz < w.nz && w.colTop) {
    const y = w.colTop[cx + w.nx * cz];
    if (y >= 0 && w.mat[w.idx(cx, y, cz)] === MAT.water) return (y + 1) * w.h;
  }
  return w.sea && !w.vacuum ? w.sea.level : null;
}

/**
 * Add the wind hoses' and jets' air into the air grid's velocities (sim/air.js, after its own
 * wind and buoyancy): only over the open part of each cell.
 */
export function stirAir(w, dt = 0) {
  const list = w.stirrers;
  if (!list?.length) return;
  const { anx, any, anz, ah, vx, vy, vz, occ } = w;
  // where the air goes round a hose, the air model's departure points follow the circle (a
  // straight line back from a cell would cut the corner, and the smoke would drift out of it)
  if (!w.stirM || w.stirM.length !== w.NA) {
    w.stirM = new Uint8Array(w.NA);
    w.stirD = new Float32Array(w.NA * 3);
    w.stirList = [];
  }
  const M = w.stirM;
  const SD = w.stirD;
  for (const a of w.stirList) M[a] = 0;
  w.stirList.length = 0;
  const p = [0, 0, 0];
  const v = [0, 0, 0];
  const awake = w.airAwake;
  for (const s of list) {
    if (s.kind === 'vortex') continue;
    const c = s.p;
    const R = reachOf(s);
    const yTop = s.kind === 'hose' ? c[1] + s.height * 1.6 : c[1] + R;
    const yBot = s.kind === 'hose' ? 0 : c[1] - R;
    const x0 = Math.max(0, Math.floor((c[0] - R) / ah));
    const x1 = Math.min(anx - 1, Math.ceil((c[0] + R) / ah));
    const y0 = Math.max(0, Math.floor(yBot / ah));
    const y1 = Math.min(any - 1, Math.ceil(yTop / ah));
    const z0 = Math.max(0, Math.floor((c[2] - R) / ah));
    const z1 = Math.min(anz - 1, Math.ceil((c[2] + R) / ah));
    for (let az = z0; az <= z1; az++)
      for (let ay = y0; ay <= y1; ay++)
        for (let ax = x0; ax <= x1; ax++) {
          const a = ax + anx * (ay + any * az);
          const open = 1 - occ[a];
          if (open <= 0.05) continue;
          p[0] = (ax + 0.5) * ah;
          p[1] = (ay + 0.5) * ah;
          p[2] = (az + 0.5) * ah;
          v[0] = v[1] = v[2] = 0;
          SPIN.vt = 0;
          if (s.kind === 'hose') hoseWind(s, c, p, v);
          else jetWind(s, p, v);
          if (v[0] === 0 && v[1] === 0 && v[2] === 0) continue;
          if (awake) awake[a] = 1;
          vx[a] += v[0] * open;
          vy[a] += (ay === 0 && v[1] < 0 ? 0 : v[1]) * open;
          vz[a] += v[2] * open;
          if (dt > 0 && SPIN.vt !== 0 && !M[a]) {
            // the part going round: rotated back along the circle; the rest: straight back
            const vt = SPIN.vt * open;
            const r = SPIN.r;
            const dx = p[0] - c[0];
            const dz = p[2] - c[2];
            const tx = (dz / r) * vt;
            const tz = (-dx / r) * vt;
            const ph = (vt * dt) / r;
            const co = Math.cos(ph);
            const si = Math.sin(ph);
            SD[a * 3] = dx - (dx * co - dz * si) + (vx[a] - tx) * dt;
            SD[a * 3 + 1] = vy[a] * dt;
            SD[a * 3 + 2] = dz - (dx * si + dz * co) + (vz[a] - tz) * dt;
            M[a] = 1;
            w.stirList.push(a);
          }
        }
  }
}

const TUMBLE = 0.4; // lift of a tumbling thing, against its drag
const MU = 0.5; // its friction on the ground

/** Is this loose thing light and buoyant enough to float? (a gas cylinder sinks) */
const floats = (o) => o.kind !== 'cylinder' && !o.burst;

/**
 * One step of what the stirrers do to things: the hoses travel; loose things in a hose's wind
 * are lifted and whirled (by the drag of the air on them, against their weight), loose things
 * floating in a whirlpool are carried round and drawn in, down into its funnel.
 */
export function stepStirrers(sim, dt) {
  const w = sim.world;
  const list = w.stirrers;
  if (!list?.length || !(dt > 0)) return;
  for (const s of list) if (s.kind === 'hose') s.p = hoseCentre(s, w.time, w.size);
  const u = [0, 0, 0];
  const cur = [0, 0];
  for (const o of w.loose ?? []) {
    if (o.held || o.gone || (o.flying && !o.whirled)) continue;
    // the air: drag ½ρ·Cd·A·|u-v|·(u-v) against its weight
    airStirAt(w, o.p, u);
    const ground = groundUnder(w, o);
    const water = waterSurfaceAt(w, o.p[0], o.p[2]);
    const afloat = water != null && floats(o) && water > ground && o.p[1] - o.half <= water + 0.05 && !o.whirled;
    const A = Math.PI * o.r * Math.max(o.r, o.half) * 1.2;
    const m = o.mass ?? 50;
    const k = (0.5 * 1.2 * 1.0 * A) / m;
    const rel = [u[0] - o.v[0], u[1] - o.v[1], u[2] - o.v[2]];
    const sp = Math.hypot(...rel);
    // (lifted by the updraft, and by the lift of a thing tumbling in a fast wind)
    const lift = k * sp * rel[1] + TUMBLE * k * (u[0] * u[0] + u[2] * u[2]);
    const airborne = o.whirled || (Math.hypot(u[0], u[1], u[2]) > 1 && lift > 9.81 * 0.9);
    if (airborne) {
      o.whirled = true;
      o.flying = true;
      const n = Math.max(1, Math.ceil(dt / 0.02));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        airStirAt(w, o.p, u);
        const rx = u[0] - o.v[0];
        const ry = u[1] - o.v[1];
        const rz = u[2] - o.v[2];
        const q = Math.hypot(rx, ry, rz);
        o.v[0] += k * q * rx * h;
        o.v[1] += (k * q * ry + TUMBLE * k * (u[0] * u[0] + u[2] * u[2]) - 9.81) * h;
        o.v[2] += k * q * rz * h;
        for (let c = 0; c < 3; c++) o.p[c] += o.v[c] * h;
        o.rot[0] += o.v[2] * h * 0.8;
        o.rot[1] += 2.5 * h;
        o.rot[2] -= o.v[0] * h * 0.8;
      }
      // out of the scene: gone; back on the ground (or the water): it lands
      if (o.p[0] < 0 || o.p[2] < 0 || o.p[0] > w.size[0] || o.p[2] > w.size[2]) o.gone = true;
      const g = Math.max(groundUnder(w, o), water != null && floats(o) ? water : -Infinity);
      if (o.p[1] - o.half <= g && o.v[1] <= 0) {
        o.p[1] = g + o.half;
        o.v[0] = o.v[1] = o.v[2] = 0;
        // (still in a strong wind: up it goes again next step)
        o.whirled = false;
        o.flying = false;
      }
      continue;
    }
    if (!afloat && o.p[1] - o.half <= ground + 0.05) {
      // on the ground: pushed along (round and in) when the wind's drag beats its friction
      const fx = k * sp * rel[0];
      const fz = k * sp * rel[2];
      const f = Math.hypot(fx, fz);
      const vh = Math.hypot(o.v[0], o.v[2]);
      if (f > MU * 9.81 || vh > 0.05) {
        const ux = vh > 0.05 ? o.v[0] / vh : fx / (f || 1);
        const uz = vh > 0.05 ? o.v[2] / vh : fz / (f || 1);
        o.v[0] += (fx - MU * 9.81 * ux) * dt;
        o.v[2] += (fz - MU * 9.81 * uz) * dt;
        // (friction stops it, it does not push it back)
        if (o.v[0] * ux + o.v[2] * uz < 0 && f <= MU * 9.81) o.v[0] = o.v[2] = 0;
        o.p[0] += o.v[0] * dt;
        o.p[2] += o.v[2] * dt;
        o.p[1] = groundUnder(w, { ...o, p: [o.p[0], o.p[1] + 0.3, o.p[2]] }) + o.half;
        o.rot[1] += vh * dt;
      }
      continue;
    }
    if (afloat) {
      waterStirAt(w, o.p[0], o.p[2], cur);
      if (cur[0] === 0 && cur[1] === 0) continue;
      // (it moves with the water: a floating thing has little inertia against the current)
      o.p[0] += cur[0] * dt;
      o.p[2] += cur[1] * dt;
      o.rot[1] += (Math.hypot(cur[0], cur[1]) / Math.max(0.3, o.r * 3)) * dt;
      let dip = 0;
      for (const s of list) if (s.kind === 'vortex') dip += funnelDepth(s, Math.hypot(o.p[0] - s.p[0], o.p[2] - s.p[2]));
      // floating: half in the water, down in the funnel
      o.p[1] = water - dip + o.half * 0.3;
      o.v[0] = cur[0];
      o.v[2] = cur[1];
    }
  }
}

/** The ground (or the top of whatever is solid) under a loose thing. */
function groundUnder(w, o) {
  const cx = Math.floor(o.p[0] / w.h);
  const cz = Math.floor(o.p[2] / w.h);
  if (cx < 0 || cz < 0 || cx >= w.nx || cz >= w.nz) return -Infinity;
  const yTop = Math.min(w.ny - 1, Math.floor(o.p[1] / w.h));
  for (let y = yTop; y >= 0; y--) {
    const m = w.mat[w.idx(cx, y, cz)];
    if (m && m !== MAT.water) return (y + 1) * w.h;
  }
  return 0;
}

/** For drawing the funnel of a whirlpool: its spiral arms' phase at time t (radians). */
export function vortexPhase(s, t) {
  return (s.dir ?? 1) * (s.strength / Math.max(0.5, s.radius * 0.35)) * t * 0.5;
}

export { TAU };

/**
 * Where something carried by the air for `age` s from (x, z) at height y has been swirled to by
 * the wind hoses (for drawing rain and snow: they are not simulated one by one). Into out [x, z].
 */
export function swirlPoint(w, x, y, z, age, out = [0, 0]) {
  out[0] = x;
  out[1] = z;
  for (const s of w.stirrers ?? []) {
    if (s.kind !== 'hose') continue;
    const dx = out[0] - s.p[0];
    const dz = out[1] - s.p[2];
    const r = Math.hypot(dx, dz);
    if (r > s.radius * 6 || r < 1e-3 || y > s.p[1] + s.height * 1.6) continue;
    const t = Math.min(age, 3);
    const a = ((s.dir ?? 1) * swirlSpeed(r, s.radius, s.spin) * t) / r;
    const k = Math.max(0.35, 1 - (0.25 * swirlSpeed(r, s.radius, s.spin) * t) / Math.max(r, s.radius) / 4);
    const c = Math.cos(a);
    const sn = Math.sin(a);
    // (anticlockwise from above: x → -z)
    out[0] = s.p[0] + (dx * c + dz * sn) * k;
    out[1] = s.p[2] + (-dx * sn + dz * c) * k;
  }
  return out;
}
