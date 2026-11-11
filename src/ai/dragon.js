import { MATERIALS } from '../sim/materials.js';

/**
 * A dragon: a big predator on the island, built on real animals.
 *
 *  - Body plan (9 m nose to tail at the default size, everything scales with its
 *    length): a long neck, a heavy trunk on four sprawling legs, a long tail, and
 *    a pair of wings on the shoulders.
 *  - On the ground it moves like a monitor lizard: legs out to the sides, the
 *    diagonal pairs stepping together, the trunk bending side to side in a
 *    standing wave (the shoulders and hips swing the other way to lengthen the
 *    stride), a travelling wave down the tail. It lies down to rest, belly and
 *    chin on the ground, and flicks its forked tongue.
 *  - In the air it flies like a big bird of prey: it needs a run-up and a leap,
 *    flaps to climb, glides to come down, banks into its turns (tan bank = v·ω/g),
 *    and flares with deep wingbeats to land. It cannot hover: it attacks in
 *    strafing passes, or lands near its prey.
 *  - The body follows the chest's own path (follow-the-leader): the trunk and
 *    tail trail behind it through every turn, climb and roll, and settle onto
 *    the ground (tail last) when it lands. The neck and head are steered on their
 *    own (looking, aiming the fire, lunging).
 *  - Fire: a gland in the throat (fuel 0..1, refilling slowly) feeds a jet of
 *    burning liquid. In the simulation it is a real jet flame (a directional
 *    heater): it burns oxygen, heats the air, radiates, and sets alight what it
 *    reaches; it stops at the first solid in its way, and lights it.
 *  - It devours: a lunge, the jaws snap shut, the prey (a guard, or you) is held
 *    in the jaws, chewed and swallowed. Afterwards it is sated for a while.
 *  - It sees (line of sight, blocked by walls and thick smoke, far further than a
 *    guard), hears noises (a blast brings it), and remembers who hurt it.
 *  - Fire does not hurt it. Arrows (more in the head), rockets and blasts do.
 *    Badly hurt it flies back to its lair to rest; killed, it falls.
 *
 *  - Its round: a route of waypoints (`route`: "x,z action; x,z action; ..." in
 *    the zone's metres). Actions: `rest` (lie down a while), `climb` (crawl up and
 *    over whatever is there: walls, a roof, a steep hilltop, the way a lizard runs
 *    up a wall), `sniff` (stop, look and taste the air with the tongue), `fly` (fly
 *    there and land). Hunting, a noise or a wound interrupt it; then it goes on.
 *  - Every time its feet land it is heard: `d.footfalls` for the sound, a noise
 *    for the guards.
 *
 * State lives in `world.dragons` (plain data, frozen with its zone); this AI
 * moves it and works out its pose (`d.spine`, `d.head`, `d.mouth`), which the
 * renderer draws and the hit tests use.
 */
const G = 9.81;
const WALK_THROUGH = new Set(['grass', 'leaves', 'needles', 'twigs', 'ash']);
const SEE_THROUGH = new Set(['grass', 'leaves', 'needles', 'twigs', 'glass']);
const TREE = new Set(['oak', 'willow', 'pine', 'bark', 'deadWood', 'twigs', 'leaves', 'needles']); // it goes round trees, it does not climb them

/** Body plan in metres at 9 m nose to tail. */
export const PLAN = {
  head: 1.25,
  neck: 1.6,
  trunk: 2.6, // shoulders to hips
  tail: 3.6,
  clear: 0.95, // chest above the ground, standing
  ds: 0.2, // spacing of the spine points
  span: 13, // wingspan
};

// half width, half height of the body along the spine (m at 9 m; s from the back of the head)
const KNOTS = [
  [0, 0.26, 0.3],
  [0.8, 0.24, 0.28],
  [1.6, 0.5, 0.55],
  [2.2, 0.68, 0.66],
  [3.0, 0.74, 0.65],
  [3.8, 0.62, 0.55],
  [4.4, 0.48, 0.45],
  [5.2, 0.34, 0.34],
  [6.4, 0.17, 0.18],
  [7.4, 0.06, 0.08],
  [7.8, 0.02, 0.03],
];

/** [half width, half height] of the body at arc length s (m, 9 m dragon) from the back of the head. */
export function bodyRadius(s) {
  if (s <= 0) return [KNOTS[0][1], KNOTS[0][2]];
  for (let k = 1; k < KNOTS.length; k++) {
    if (s <= KNOTS[k][0]) {
      const a = KNOTS[k - 1];
      const b = KNOTS[k];
      let t = (s - a[0]) / (b[0] - a[0]);
      t = t * t * (3 - 2 * t);
      return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    }
  }
  const e = KNOTS[KNOTS.length - 1];
  return [e[1], e[2]];
}

/**
 * The ground under (x, z), searching down from height `from`: { y, water }.
 * Grass, leaves and twigs are walked through; water (and the sea round the
 * island) lies on top of the ground, `water` deep.
 */
export function groundAt(w, x, z, from = w.size[1]) {
  const h = w.h;
  const ix = Math.floor(x / h);
  const iz = Math.floor(z / h);
  const s = w.sea;
  const sea = s && !(x > s.box[0] && x < s.box[2] && z > s.box[1] && z < s.box[3]) ? s.level : -Infinity;
  if (ix < 0 || iz < 0 || ix >= w.nx || iz >= w.nz) return { y: sea > 0 ? sea - 3 : 0, water: sea > 0 ? 3 : 0 };
  let top = null;
  for (let y = Math.min(w.ny - 1, Math.floor(from / h)); y >= 0; y--) {
    const m = w.mat[w.idx(ix, y, iz)];
    if (!m) continue;
    const M = MATERIALS[m];
    if (M.fluidity >= 0.95) {
      top ??= (y + 1) * h;
      continue;
    }
    if (WALK_THROUGH.has(M.name)) continue;
    const g = (y + 1) * h;
    return { y: g, water: Math.max((top ?? g) - g, sea - g, 0) };
  }
  return { y: 0, water: Math.max(0, sea) };
}

/** The ground height under (x, z), bilinear between the voxel columns (no 0.4 m steps under a sliding tail). */
export function smoothGround(w, x, z, from) {
  const h = w.h;
  const fx = x / h - 0.5;
  const fz = z / h - 0.5;
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const tx = fx - x0;
  const tz = fz - z0;
  const g = (i, j) => groundAt(w, (x0 + i + 0.5) * h, (z0 + j + 0.5) * h, from).y;
  return (g(0, 0) * (1 - tx) + g(1, 0) * tx) * (1 - tz) + (g(0, 1) * (1 - tx) + g(1, 1) * tx) * tz;
}

/** "18,12 rest; 30,13 climb; ..." → [{ p: [x, 0, z], acts: Set }]. Bad entries are skipped. */
export function parseRoute(text) {
  if (!text || typeof text !== 'string') return null;
  const out = [];
  for (const part of text.split(';')) {
    const m = part.trim().match(/^(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*(.*)$/);
    if (!m) continue;
    const x = Number(m[1]);
    const z = Number(m[2]);
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    out.push({ p: [x, 0, z], acts: new Set(m[3].toLowerCase().split(/[\s,]+/).filter(Boolean)) });
  }
  return out.length ? out : null;
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a) => {
  const l = len3(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const approach = (v, target, rate, dt) => v + (target - v) * Math.min(1, rate * dt);

/** Fill in a dragon's state (from the scene object: p, yaw, length, health, startState) and pose it. */
export function initDragon(d, w) {
  if (d.spine) return d;
  const k = (d.length ?? 9) / 9;
  const yaw = d.yaw ?? 0;
  const g = groundAt(w, d.p[0], d.p[2]).y;
  Object.assign(d, {
    k,
    length: 9 * k,
    maxHealth: d.health ?? 600,
    health: d.health ?? 600,
    mode: 'ground',
    state: 'rest',
    p: [d.p[0], g + PLAN.clear * k * 0.5, d.p[2]],
    yaw,
    speed: 0,
    vy: 0,
    pitch: 0,
    bank: 0,
    crouch: 1,
    groundF: 1,
    fold: 1,
    flapPhase: 0,
    flapAmp: 0,
    beats: 0,
    gait: 0,
    undulate: 0,
    steps: 0,
    jaw: 0,
    glow: 0,
    tongue: 0,
    blink: 0,
    fuel: 1,
    breathT: 0,
    windT: 0,
    breathCool: 0,
    biteT: 0,
    biteCool: 0,
    lunge: 0,
    sated: 0,
    anger: 0,
    alert: 0,
    timer: 12 + Math.random() * 15,
    senseT: 0,
    blocked: 0,
    look: null,
    neckOff: null,
    headDir: [Math.sin(yaw), -0.25, Math.cos(yaw)],
    target: null,
    holding: null,
    hurtFlash: 0,
    cling: 0,
    footfalls: [],
  });
  d.lair = d.p.slice();
  d.lairYaw = yaw;
  d.routePts = parseRoute(d.route);
  d.leg = 0;
  // a straight trail behind the chest
  d.trail = [];
  const n = Math.ceil(((PLAN.trunk + PLAN.tail) * k) / (0.1 * k)) + 4;
  for (let i = 0; i <= n; i++) {
    const x = d.p[0] - Math.sin(yaw) * i * 0.1 * k;
    const z = d.p[2] - Math.cos(yaw) * i * 0.1 * k;
    d.trail.push([x, d.p[1], z, 0, 0]);
  }
  if (d.startState === 'fly') {
    d.mode = 'air';
    d.state = 'roam';
    d.p[1] = g + 12;
    d.trail.forEach((t) => (t[1] = d.p[1]));
    d.speed = 10;
    d.fold = 0;
    d.crouch = 0;
    d.groundF = 0;
    d.flapAmp = 1;
    d.roam = { phase: 'fly', until: 25 };
  }
  pose(d, w, 0);
  return d;
}

/** Points every `ds` m along the trail (from the chest backwards), with their roll; extrapolated past its end. */
function resample(trail, ds, length) {
  const out = [[trail[0][0], trail[0][1], trail[0][2], trail[0][3], trail[0][4] ?? 0]];
  let need = ds;
  let acc = 0;
  for (let i = 1; i < trail.length && out.length * ds <= length + 1e-6; i++) {
    const a = trail[i - 1];
    const b = trail[i];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    while (L > 0 && acc + L >= need && out.length * ds <= length + 1e-6) {
      const t = (need - acc) / L;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t, Math.max(a[4] ?? 0, b[4] ?? 0)]);
      need += ds;
    }
    acc += L;
  }
  // past the end: straight on
  while ((out.length - 1) * ds < length - 1e-6) {
    const a = out[out.length - 1];
    const b = out[Math.max(0, out.length - 2)];
    const dir = out.length > 1 ? norm(sub(a, b)) : [0, 0, -1];
    out.push([a[0] + dir[0] * ds, a[1] + dir[1] * ds, a[2] + dir[2] * ds, a[3], a[4]]);
  }
  return out;
}

/** How high the body is carried at distance s behind the shoulders (m), standing (crouch 0) or lying (1). */
function clearance(s, k, crouch) {
  const T = PLAN.trunk;
  const sn = s / k;
  const [, ry] = bodyRadius(PLAN.neck + sn);
  let stand;
  if (sn <= T) stand = PLAN.clear * (1 - 0.12 * (sn / T));
  else {
    const u = Math.min(1, (sn - T) / (PLAN.tail * 0.5));
    const sm = u * u * (3 - 2 * u);
    stand = PLAN.clear * 0.88 * (1 - sm) + ry * sm;
  }
  const lie = ry * 0.92;
  return (stand + (lie - stand) * crouch) * k;
}

/**
 * Work out the pose from the state: the spine (head base → tail tip), the head
 * and the mouth. Also used by the renderer between steps and by the hit tests.
 */
export function pose(d, w, dt) {
  const k = d.k;
  const ds = PLAN.ds * k;
  const body = resample(d.trail, ds, (PLAN.trunk + PLAN.tail) * k);
  const T = PLAN.trunk * k;
  const up = [0, 1, 0];
  // lizard undulation (on the ground) or a balancing sway of the tail (in the air)
  const ph = d.gait * Math.PI * 2;
  for (let i = 0; i < body.length; i++) {
    const s = i * ds;
    const a = body[Math.max(0, i - 1)];
    const b = body[Math.min(body.length - 1, i + 1)];
    const t = norm([a[0] - b[0], 0, a[2] - b[2]]);
    const side = [t[2], 0, -t[0]];
    let lat;
    if (s <= T) lat = 0.16 * Math.sin(ph) * Math.cos((Math.PI * s) / T);
    else {
      const u = (s - T) / (PLAN.tail * k);
      lat = -0.16 * Math.sin(ph) * (1 - u) + 0.35 * u * Math.sin(ph - Math.PI * 1.6 * u);
    }
    lat *= d.undulate * k;
    if (d.mode === 'air' && s > T) {
      const u = (s - T) / (PLAN.tail * k);
      lat += 0.3 * k * u * u * Math.sin((d.time ?? 0) * 1.3) * (1 - d.groundF);
    }
    body[i][0] += side[0] * lat;
    body[i][2] += side[2] * lat;
    // on the ground: carried at the legs' height, the tail lying on the ground
    // (not where it clings to a wall: there it is where it climbed)
    const gf = d.groundF * (1 - (body[i][4] ?? 0));
    if (gf > 0) {
      const gy = smoothGround(w, body[i][0], body[i][2], body[i][1] + 1.2 * k) + clearance(s, k, d.crouch);
      body[i][1] += (gy - body[i][1]) * gf;
    }
  }
  const C = body[0];
  const F = norm(sub(body[0], body[2]));
  const Fh = norm([F[0], 0, F[2]]);
  const neck = PLAN.neck * k;
  // --- the neck: where the head base wants to be, relative to the chest
  let want;
  const look = d.look;
  let lookYaw = 0;
  if (look) {
    lookYaw = clamp(wrap(Math.atan2(look[0] - C[0], look[2] - C[2]) - Math.atan2(Fh[0], Fh[2])), -1.1, 1.1);
  } else if (d.idleLook) lookYaw = d.idleLook;
  const yawDir = (a) => {
    const y0 = Math.atan2(Fh[0], Fh[2]) + a;
    return [Math.sin(y0), 0, Math.cos(y0)];
  };
  if (d.mode === 'air' || d.mode === 'falling') {
    const dir = norm([F[0] + yawDir(lookYaw * 0.4)[0] * 0.3, F[1] - 0.08, F[2] + yawDir(lookYaw * 0.4)[2] * 0.3]);
    want = dir.map((v) => v * neck * 0.95);
  } else if (d.lunge > 0 && look) {
    const dir = norm(sub(look, C));
    want = dir.map((v) => v * neck);
  } else if (d.holding) {
    // head up, swallowing
    const dir = norm([Fh[0] * 0.6, 0.8, Fh[2] * 0.6]);
    want = dir.map((v) => v * neck * 0.95);
  } else if (d.cling && Math.abs(F[1]) > 0.5) {
    // on a wall: the head leads, up or down it
    want = norm([F[0] + Fh[0] * 0.3, F[1], F[2] + Fh[2] * 0.3]).map((v) => v * neck * 0.9);
  } else {
    const hd = yawDir(lookYaw * 0.6);
    let rise = 0.35 * k;
    if (look) rise = clamp((look[1] - C[1]) * 0.4, -0.5 * k, 0.9 * k);
    if (d.windT > 0 || d.breathT > 0) rise = Math.max(rise, 0.25 * k);
    const stand = [hd[0] * neck * 0.85, rise, hd[2] * neck * 0.85];
    // lying: the chin on the ground in front
    const fx = C[0] + hd[0] * neck * 0.9;
    const fz = C[2] + hd[2] * neck * 0.9;
    const chin = smoothGround(w, fx, fz, C[1] + 1.5 * k) + 0.3 * k - C[1];
    const lie = [hd[0] * neck * 0.9, chin, hd[2] * neck * 0.9];
    want = stand.map((v, c) => v + (lie[c] - v) * d.crouch * (1 - d.alert));
  }
  if (!d.neckOff || dt === 0) d.neckOff = want.slice();
  else for (let c = 0; c < 3; c++) d.neckOff[c] = approach(d.neckOff[c], want[c], d.lunge > 0 ? 14 : 5, dt);
  // keep the neck its length
  const nl = len3(d.neckOff);
  if (nl > neck) d.neckOff = d.neckOff.map((v) => (v * neck) / nl);
  if (nl < neck * 0.55) d.neckOff = d.neckOff.map((v) => (v * neck * 0.55) / Math.max(nl, 1e-3));
  const H = [C[0] + d.neckOff[0], C[1] + d.neckOff[1], C[2] + d.neckOff[2]];
  // --- the head: towards what it looks at (within what a neck can turn)
  const neckDir = norm(d.neckOff);
  let hdWant = look ? norm(sub(look, H)) : d.holding ? norm([Fh[0], 0.35, Fh[2]]) : d.mode === 'air' || (d.cling && Math.abs(F[1]) > 0.5) ? norm([F[0], F[1] - 0.15, F[2]]) : norm([neckDir[0], -0.3 - 0.4 * d.crouch * (1 - d.alert), neckDir[2]]);
  const cosA = hdWant[0] * neckDir[0] + hdWant[1] * neckDir[1] + hdWant[2] * neckDir[2];
  if (cosA < Math.cos(1.0)) {
    // too far round: as far as it goes
    const perp = norm(sub(hdWant, neckDir.map((v) => v * cosA)));
    hdWant = norm(neckDir.map((v, c) => v * Math.cos(1.0) + perp[c] * Math.sin(1.0)));
  }
  if (dt === 0) d.headDir = hdWant;
  else d.headDir = norm(d.headDir.map((v, c) => approach(v, hdWant[c], 7, dt)));
  // the neck curve (cubic Bezier, head base → chest)
  const nn = Math.max(4, Math.round(PLAN.neck / PLAN.ds));
  const P1 = H.map((v, c) => v - d.headDir[c] * neck * 0.3);
  const P2 = C.map((v, c) => v + F[c] * neck * 0.35);
  const spine = [];
  const rolls = [];
  for (let i = 0; i < nn; i++) {
    const t = i / nn;
    const u = 1 - t;
    spine.push([0, 1, 2].map((c) => u * u * u * H[c] + 3 * u * u * t * P1[c] + 3 * u * t * t * P2[c] + t * t * t * C[c]));
    rolls.push(body[0][3] * (0.4 + 0.6 * t));
  }
  for (const b of body) {
    spine.push([b[0], b[1], b[2]]);
    rolls.push(b[3]);
  }
  d.spine = spine;
  d.rolls = rolls;
  d.iShoulder = nn;
  d.iHip = nn + Math.round(PLAN.trunk / PLAN.ds);
  d.chest = C;
  d.forward = F;
  // the head's own frame and the mouth
  const hdir = d.headDir;
  let hup = norm(sub(up, hdir.map((v) => v * hdir[1])));
  if (!Number.isFinite(hup[0])) hup = [0, 0, 1];
  d.head = { p: H, dir: hdir, up: hup };
  const L = PLAN.head * k;
  d.mouth = [0, 1, 2].map((c) => H[c] + hdir[c] * L * 0.9 - hup[c] * 0.12 * k);
  d.eye = [0, 1, 2].map((c) => H[c] + hdir[c] * L * 0.35 + hup[c] * 0.18 * k);
  void cross;
}

export class DragonAI {
  constructor(sim) {
    this.sim = sim;
    this.heardUpTo = 0;
    const prev = sim.hitEnemy;
    sim.hitEnemy = (p, type, g) => this.hit(p, type, g) || (prev ? prev(p, type, g) : false);
    for (const d of sim.world.dragons ?? []) initDragon(d, sim.world);
  }

  get world() {
    return this.sim.world;
  }

  /** A living dragon close enough to frighten someone at p: its chest, or null. */
  threat(p, range = 16) {
    for (const d of this.world.dragons ?? []) {
      if (d.health <= 0 || !d.chest) continue;
      const dh = Math.hypot(d.chest[0] - p[0], d.chest[2] - p[2]);
      if (dh < range && Math.abs(d.chest[1] - p[1]) < 14) return d.chest;
    }
    return null;
  }

  solidAt(p, seeThrough = false) {
    const w = this.world;
    const i = w.voxelAt(p[0], p[1], p[2]);
    if (i < 0 || !w.mat[i]) return false;
    const M = MATERIALS[w.mat[i]];
    if (M.fluidity >= 0.95) return false;
    return !(seeThrough ? SEE_THROUGH : WALK_THROUGH).has(M.name);
  }

  /** Line of sight from a to b: blocked by solids, foliage (a little) and thick smoke. */
  sees(a, b, range = 45) {
    const w = this.world;
    const d = dist(a, b);
    if (d > range) return false;
    const n = Math.ceil(d / (w.h * 0.6));
    let tau = 0;
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      if (this.solidAt(p, true)) return false;
      const i = w.voxelAt(p[0], p[1], p[2]);
      if (i >= 0 && w.mat[i] && MATERIALS[w.mat[i]].name !== 'glass' && MATERIALS[w.mat[i]].fluidity < 0.95) tau += 0.35; // foliage
      const c = this.sim.airCellAt(...p);
      if (c >= 0) tau += ((8700 * w.smoke[c]) / w.ah ** 3) * (d / n);
      if (tau > 2.5) return false;
    }
    return true;
  }

  /** Is there a roof (anything solid) above someone standing at p? */
  sheltered(p) {
    for (let y = p[1] + 2.0; y < p[1] + 9; y += this.world.h) if (this.solidAt([p[0], y, p[2]], true)) return true;
    return false;
  }

  /** Where the ray from p along dir first meets a solid (foliage and grass count: the fire lands on them). */
  ray(p, dir, range) {
    const w = this.world;
    const step = w.h * 0.5;
    for (let s = 0.2; s < range; s += step) {
      const q = [p[0] + dir[0] * s, p[1] + dir[1] * s, p[2] + dir[2] * s];
      const i = w.voxelAt(q[0], q[1], q[2]);
      if (i >= 0 && w.mat[i] && MATERIALS[w.mat[i]].fluidity < 0.95) return { s, p: q };
      if (q[1] < 0) return { s, p: q };
    }
    return { s: range, p: null };
  }

  step(dt) {
    const w = this.world;
    const noises = w.noises.filter((e) => e.time >= this.heardUpTo);
    this.heardUpTo = w.time;
    if (w.noises.length > 300) w.noises.splice(0, w.noises.length - 150); // its footfalls add up
    for (const d of w.dragons) {
      initDragon(d, w);
      d.time = (d.time ?? 0) + dt;
      this.stepOne(d, w, dt, noises);
    }
  }

  stepOne(d, w, dt, noises) {
    const k = d.k;
    d.hurtFlash = Math.max(0, d.hurtFlash - dt);
    if (d.health <= 0) {
      this.dead(d, w, dt);
      pose(d, w, dt);
      return;
    }
    d.fuel = Math.min(1, d.fuel + dt * 0.045);
    d.breathCool -= dt;
    d.biteCool -= dt;
    d.sated = Math.max(0, d.sated - dt);
    d.anger = Math.max(0, d.anger - dt);
    d.timer -= dt;
    d.blink = Math.max(0, d.blink - dt);
    if (Math.random() < dt * 0.25) d.blink = 0.18;
    d.alert = d.state === 'rest' && !d.target ? Math.max(0, (d.alert ?? 0) - dt * 0.3) : 1;
    // resting heals
    if (d.state === 'rest' && d.mode === 'ground') d.health = Math.min(d.maxHealth, d.health + dt * 3);

    // --- senses (a few times a second)
    d.senseT -= dt;
    if (d.senseT <= 0) {
      d.senseT = 0.3;
      this.sense(d, w);
    }
    for (const n of noises) {
      if (n.kind === 'dragon') continue;
      const dd = dist(n.p, d.chest);
      if (dd > n.loud * 1.6 + 8) continue;
      // the same place again (an eruption rumbling on): it is already on its way, or has had a look
      if (d.investigate && dist(n.p, d.investigate) < 10) continue;
      if (d.lastLook && dist(n.p, d.lastLook) < 10 && (d.time ?? 0) - d.lastLookT < 60) continue;
      if (d.state === 'rest' || (d.state === 'roam' && n.kind === 'explosion')) {
        d.investigate = n.p.slice();
        d.lastLook = n.p.slice();
        d.lastLookT = d.time ?? 0;
        if (d.state === 'rest') this.roar(d, w);
        d.state = 'roam';
        d.roam = { phase: d.mode === 'air' ? 'fly' : 'takeoff', until: 20 };
      }
    }

    // --- behaviour
    if (d.health < d.maxHealth * 0.25 && d.state !== 'devour') d.state = 'flee';
    else if (d.state === 'flee' && d.health > d.maxHealth * 0.6) d.state = 'rest';
    const T = d.target;
    if (T && d.state !== 'devour' && d.state !== 'flee' && (d.sated <= 0 || d.anger > 0)) d.state = 'hunt';
    if (d.state === 'hunt' && (!T || (d.sated > 0 && d.anger <= 0))) {
      d.state = 'roam';
      d.roam = { phase: d.mode === 'air' ? 'home' : 'walk', until: 10 };
      d.target = null;
    }
    d.look = null;
    if (d.breathT > 0 || d.windT > 0) d.look = d.aim ?? null;

    switch (d.state) {
      case 'rest':
        this.rest(d, w, dt);
        break;
      case 'roam':
        this.roaming(d, w, dt);
        break;
      case 'hunt':
        this.hunt(d, w, dt);
        break;
      case 'devour':
        this.devour(d, w, dt);
        break;
      case 'flee':
        this.goHome(d, w, dt, true);
        break;
      case 'route':
        this.followRoute(d, w, dt);
        break;
    }
    this.breath(d, w, dt);
    this.animate(d, dt);
    this.updateTrail(d);
    pose(d, w, dt);
    void k;
  }

  /** Who is there to eat, and can it see them? */
  sense(d, w) {
    const pl = this.sim.ai?.player;
    const eye = d.eye ?? d.chest;
    let best = null;
    let bs = Infinity;
    const consider = (kind, ref, p, head) => {
      const dd = dist(eye, head);
      // dozing in its lair it only notices what comes close
      if (dd > (d.state === 'rest' && !(d.anger > 0) ? 13 : 45)) return;
      const seen = this.sees(eye, head);
      const old = d.target && d.target.ref === ref;
      if (!seen && !old) return;
      const score = dd * (kind === 'player' ? 0.8 : 1) * (seen ? 1 : 2.5) * (old ? 0.7 : 1);
      if (score < bs) {
        bs = score;
        best = { kind, ref, p: p.slice(), head: head.slice(), seen, lastSeen: seen ? w.time : d.target?.lastSeen ?? w.time };
      }
    };
    if (pl && !w.playerHeld) consider('player', 'player', pl.p, pl.head);
    for (const e of w.enemies) if (!e.dead && !e.held) consider('enemy', e, e.p, [e.p[0], e.p[1] + 1.6, e.p[2]]);
    // a hungry dragon goes for anyone it sees; a sated one only for whoever hurt it
    if (best && d.sated > 0 && !(d.anger > 0 && best.kind === 'player')) best = null;
    if (best) {
      if (!d.target) this.roar(d, w);
      d.target = best;
    } else if (d.target) {
      // lost sight: go on to where they were for a while
      if (w.time - d.target.lastSeen > 12) d.target = null;
      else d.target.seen = false;
    }
  }

  roar(d, w) {
    if (w.time - (d.lastRoar ?? -99) < 6) return;
    d.lastRoar = w.time;
    d.roarT = 1.6;
    const pos = d.mouth ?? d.chest;
    w.events.push({ type: 'roar', pos: pos.slice(), time: w.time, name: 'the dragon' });
    w.noises.push({ p: pos.slice(), loud: 60, time: w.time, kind: 'dragon' });
  }

  // ---------------------------------------------------------------------------
  // behaviours

  rest(d, w, dt) {
    if (d.mode === 'air') return this.goHome(d, w, dt, false);
    d.speed = approach(d.speed, 0, 4, dt);
    this.groundMove(d, w, dt, null, 0);
    if (Math.random() < dt * 0.15) d.idleLook = (Math.random() - 0.5) * 1.6;
    if (Math.random() < dt * 0.2) d.tongueT = 0.6;
    // after a while it goes out: on along its route, or a flight round the island
    if (d.timer <= 0 && d.routePts) {
      d.state = 'route';
      d.leg++;
      d.legFly = false;
    } else if (d.timer <= 0 && d.sated <= 0) {
      d.state = 'roam';
      d.roam = { phase: 'takeoff', until: 25 + Math.random() * 15 };
    }
  }

  /** Out and about: a flight round the island, a landing, a crawl about, and home to rest. */
  roaming(d, w, dt) {
    const r = (d.roam ??= { phase: d.mode === 'air' ? 'fly' : 'walk', until: 20 });
    r.until -= dt;
    const c = [w.size[0] / 2, 0, w.size[2] / 2];
    switch (r.phase) {
      case 'takeoff':
        if (d.mode === 'air') r.phase = 'fly';
        else this.takeoff(d, w, dt);
        break;
      case 'fly': {
        if (d.mode === 'ground') {
          r.phase = 'takeoff';
          break;
        }
        // round the island, or round the place of a noise
        const ctr = d.investigate ?? c;
        r.ang = (r.ang ?? Math.atan2(d.p[2] - ctr[2], d.p[0] - ctr[0])) + dt * 0.55;
        const R = d.investigate ? 9 : Math.min(w.size[0], w.size[2]) * 0.36;
        const goal = [ctr[0] + Math.cos(r.ang) * R, 0, ctr[2] + Math.sin(r.ang) * R];
        const alt = groundAt(w, goal[0], goal[2]).y + (d.investigate ? 9 : 12);
        this.airMove(d, w, dt, goal, alt, 11);
        if (r.until <= 0) {
          d.investigate = null;
          // land somewhere open, crawl about, then go home
          const spot = this.landingSpot(d, w, [c[0] + (Math.random() - 0.5) * w.size[0] * 0.5, 0, c[2] + (Math.random() - 0.5) * w.size[2] * 0.5], 10);
          if (spot) {
            r.phase = 'land';
            r.spot = spot;
            r.until = 30;
          } else {
            r.phase = 'home';
          }
        }
        break;
      }
      case 'land':
        if (this.land(d, w, dt, r.spot)) {
          r.phase = 'walk';
          r.until = 12 + Math.random() * 10;
        }
        if (r.until <= 0) r.phase = 'home';
        break;
      case 'walk': {
        if (d.mode === 'air') {
          r.phase = 'home';
          break;
        }
        if (!r.goal || dist(r.goal, d.p) < 1.2 * d.k || d.blocked > 2) {
          const a = Math.random() * Math.PI * 2;
          r.goal = [d.p[0] + Math.cos(a) * 6 * d.k, d.p[1], d.p[2] + Math.sin(a) * 6 * d.k];
          d.blocked = 0;
        }
        this.groundMove(d, w, dt, r.goal, 1.6 * Math.sqrt(d.k));
        if (Math.random() < dt * 0.6) d.tongueT = 0.6;
        if (r.until <= 0) r.phase = 'home';
        break;
      }
      case 'home':
        if (d.routePts) {
          // back to its round
          d.state = 'route';
          d.roam = null;
          d.investigate = null;
          d.legFly = d.mode === 'air';
          break;
        }
        if (this.goHome(d, w, dt, false)) {
          d.state = 'rest';
          d.timer = 30 + Math.random() * 25;
          d.roam = null;
        }
        break;
    }
  }

  /**
   * Its round: on to the next waypoint (crawling; climbing where the leg is a climb;
   * flying where it says fly, or where there is no way on foot), then what the
   * waypoint says: lie down, sniff, or straight on.
   */
  followRoute(d, w, dt) {
    const R = d.routePts;
    const k = d.k;
    const n = R.length;
    const wp = R[((d.leg % n) + n) % n];
    const prev = R[(((d.leg - 1) % n) + n) % n];
    const dh = Math.hypot(wp.p[0] - d.p[0], wp.p[2] - d.p[2]);
    const next = () => {
      d.leg++;
      d.legFly = false;
      d.legT = 0;
      d.blocked = 0;
    };
    d.legT = (d.legT ?? 0) + dt;
    // arrived: do what the waypoint says
    if (d.sniffT > 0) {
      d.sniffT -= dt;
      this.groundMove(d, w, dt, null, 0);
      // at a stairway (the catacombs): it looks in; otherwise at the ground ahead
      const portal = w.portals.find((q) => Math.hypot(q.p[0] - d.p[0], q.p[2] - d.p[2]) < 9 * k);
      const ahead = portal ? portal.p : [wp.p[0] + Math.sin(d.yaw) * 2 * k, 0, wp.p[2] + Math.cos(d.yaw) * 2 * k];
      d.look = [ahead[0], groundAt(w, ahead[0], ahead[2], d.p[1] + 1).y + 0.6 * k, ahead[2]];
      if (Math.random() < dt * 2.5) d.tongueT = 0.6;
      if (d.sniffT <= 0) next();
      return;
    }
    const flyLeg = d.legFly || wp.acts.has('fly');
    if (flyLeg && dh > 6 * k && d.mode === 'ground') {
      d.legFly = true;
      this.takeoff(d, w, dt);
      return;
    }
    if (d.mode === 'air') {
      d.legSpot ??= this.landingSpot(d, w, wp.p, 3 * k) ?? [wp.p[0], groundAt(w, wp.p[0], wp.p[2]).y, wp.p[2]];
      if (this.land(d, w, dt, d.legSpot)) d.legSpot = null;
      return;
    }
    d.legSpot = null;
    if (dh > 1.3 * k) {
      const climb = wp.acts.has('climb') || prev.acts.has('climb');
      this.groundMove(d, w, dt, wp.p, (climb && d.cling > 0 ? 1.4 : 2.0) * Math.sqrt(k), { climb, swim: true });
      if (Math.random() < dt * 0.3) d.tongueT = 0.6;
      // no way on foot (or far too long about it): fly
      if (d.blocked > 3 || d.legT > 90) {
        d.legFly = true;
        d.blocked = 0;
      }
      return;
    }
    // there
    if (wp.acts.has('rest')) {
      d.state = 'rest';
      d.timer = 25 + Math.random() * 20;
      if (d.leg % n === 0) d.lair = d.p.slice();
      return;
    }
    if (wp.acts.has('sniff')) {
      d.sniffT = 5;
      return;
    }
    next();
  }

  /** Back to the lair (flying if it is far), to lie down there. Returns true once there. */
  goHome(d, w, dt, fleeing) {
    const L = d.lair;
    const dh = Math.hypot(L[0] - d.p[0], L[2] - d.p[2]);
    if (d.mode === 'ground') {
      if (dh > 10 * d.k) return this.takeoff(d, w, dt), false;
      if (dh > 0.8 * d.k) {
        this.groundMove(d, w, dt, L, (fleeing ? 3 : 1.8) * Math.sqrt(d.k));
        if (d.blocked > 2) this.takeoff(d, w, dt);
        return false;
      }
      this.groundMove(d, w, dt, null, 0);
      if (fleeing) d.state = 'rest';
      return true;
    }
    this.land(d, w, dt, L);
    return false;
  }

  hunt(d, w, dt) {
    const T = d.target;
    // a guard keeps moving: follow where they are now
    if (T.kind === 'enemy') {
      T.p = T.ref.p.slice();
      T.head = [T.p[0], T.p[1] + 1.6, T.p[2]];
      if (T.ref.dead) {
        d.target = null;
        return;
      }
    } else if (T.seen && this.sim.ai?.player) {
      T.p = this.sim.ai.player.p.slice();
      T.head = this.sim.ai.player.head.slice();
    }
    const k = d.k;
    const center = [T.p[0], T.p[1] + 0.9, T.p[2]];
    const dm = dist(d.mouth, center);
    const dh = Math.hypot(T.p[0] - d.p[0], T.p[2] - d.p[2]);
    const roof = this.sheltered(T.p);
    d.look = T.seen ? center : null;
    if (d.breathT > 0 || d.windT > 0) {
      d.aim = center;
      d.look = center;
    }
    if (d.mode === 'air') {
      const h = (d.hunt ??= { passes: 0, phase: 'in' });
      // after a pass or two, land near them (unless they are under a roof)
      if (!roof && (h.passes >= 2 || d.fuel < 0.3)) {
        h.spot ??= this.landingSpot(d, w, [T.p[0] - Math.sin(d.yaw) * 6 * k, 0, T.p[2] - Math.cos(d.yaw) * 6 * k], 6);
        if (h.spot && this.land(d, w, dt, h.spot)) d.hunt = null;
        if (!h.spot) h.passes = 0;
        return;
      }
      if (h.phase === 'in') {
        this.airMove(d, w, dt, T.p, T.p[1] + 6 * k, 11);
        const ahead = d.headDir[0] * (center[0] - d.mouth[0]) + d.headDir[1] * (center[1] - d.mouth[1]) + d.headDir[2] * (center[2] - d.mouth[2]);
        if (dm < 16 * k && ahead > dm * 0.75 && d.fuel > 0.25 && d.breathT <= 0 && d.windT <= 0 && d.breathCool <= 0 && T.seen) this.startBreath(d, center, 0.3);
        if (dh < 3 * k || (ahead < 0 && dm < 12)) {
          h.phase = 'out';
          h.out = [d.p[0] + Math.sin(d.yaw) * 18, 0, d.p[2] + Math.cos(d.yaw) * 18];
        }
      } else {
        this.airMove(d, w, dt, h.out, T.p[1] + 10 * k, 12);
        if (Math.hypot(h.out[0] - d.p[0], h.out[2] - d.p[2]) < 6) {
          h.passes++;
          h.phase = 'in';
        }
      }
      return;
    }
    d.hunt = null;
    const reach = !roof && Math.abs(T.p[1] - (d.p[1] - clearance(0, k, 0))) < 2.5 * k;
    if (d.biteT > 0) {
      this.groundMove(d, w, dt, null, 0);
      return this.bite(d, w, dt, T, center);
    }
    if (d.breathT > 0 || d.windT > 0) {
      // standing its ground while it burns, turning towards them
      this.groundMove(d, w, dt, null, 0);
      return;
    }
    if (reach && dm < 2.0 * k && d.biteCool <= 0) {
      d.biteT = 0.5;
      d.lunge = 1;
      return;
    }
    if (T.seen && dm < 10 * k && dm > 3.2 * k && d.fuel > 0.4 && d.breathCool <= 0) {
      this.startBreath(d, center, 0.6);
      return;
    }
    if (!reach && T.seen && dm < 11 * k && d.fuel > 0.3 && d.breathCool <= 0) {
      // under a roof: burn them out
      this.startBreath(d, center, 0.6);
      return;
    }
    const stop = reach ? 0 : 6 * k;
    this.groundMove(d, w, dt, dh > stop ? T.p : null, (dm > 2.4 * k ? 5.5 : 2.5) * Math.sqrt(k));
    if (d.blocked > 2.5) {
      // no way round on foot: from the air
      d.blocked = 0;
      d.takeoffT = 0;
      d.roam = null;
      this.takeoff(d, w, dt);
      d.forceTakeoff = true;
    }
    if (d.forceTakeoff) this.takeoff(d, w, dt);
  }

  /** The lunge and snap of the jaws. */
  bite(d, w, dt, T, center) {
    const k = d.k;
    const before = d.biteT;
    d.biteT -= dt;
    d.look = center;
    d.lunge = 1;
    if (before > 0.2 && d.biteT <= 0.2) {
      // the jaws snap shut
      if (dist(d.mouth, center) < 1.7 * k) this.grab(d, w, T);
      else {
        d.biteCool = 1.2;
        w.events.push({ type: 'dragonSnap', pos: d.mouth.slice(), time: w.time, name: 'the dragon' });
      }
    }
    if (d.biteT <= 0) {
      d.lunge = 0;
      d.biteT = 0;
    }
  }

  grab(d, w, T) {
    d.state = 'devour';
    d.devourT = 0;
    d.lunge = 0;
    d.biteT = 0;
    d.breathT = 0;
    d.windT = 0;
    d.target = null;
    d.holding = T;
    if (T.kind === 'enemy') {
      const e = T.ref;
      e.held = true;
      e.dead = true;
      e.onFire = 0;
      e.health = 0;
      w.events.push({ type: 'enemyDown', pos: e.p.slice(), time: w.time, name: 'a guard seized by the dragon' });
    } else {
      w.events.push({ type: 'seized', pos: d.mouth.slice(), time: w.time, name: 'the dragon' });
    }
    this.holdPrey(d, w);
  }

  /** Keep the prey in the jaws. */
  holdPrey(d, w) {
    const T = d.holding;
    if (!T) return;
    const { p: H, dir, up } = d.head;
    const L = PLAN.head * d.k;
    if (T.kind === 'enemy') {
      const e = T.ref;
      e.p = d.mouth.map((v, c) => v - dir[c] * 0.15 * d.k);
      e.heldYaw = Math.atan2(dir[0], dir[2]);
      e.heldPitch = Math.asin(clamp(dir[1], -1, 1));
    } else {
      w.playerHeld = {
        eye: [0, 1, 2].map((c) => H[c] + dir[c] * L * 0.3 - up[c] * 0.02 * d.k),
        dir: dir.slice(),
        up: up.slice(),
        jaw: d.jaw,
        t: d.devourT,
      };
    }
  }

  devour(d, w, dt) {
    d.devourT += dt;
    d.speed = approach(d.speed, 0, 5, dt);
    if (d.mode === 'ground') this.groundMove(d, w, dt, null, 0);
    else this.airMove(d, w, dt, d.lair, d.lair[1] + 8, 9);
    const T = d.holding;
    if (T && d.devourT >= 2.8) {
      // swallowed
      if (T.kind === 'enemy') {
        T.ref.held = false;
        T.ref.devoured = true;
      } else {
        w.playerHeld = null;
        w.events.push({ type: 'devoured', pos: d.mouth.slice(), time: w.time, name: 'the dragon' });
      }
      w.events.push({ type: 'gulp', pos: d.mouth.slice(), time: w.time, name: 'the dragon' });
      d.holding = null;
      d.health = Math.min(d.maxHealth, d.health + 120);
    }
    if (d.holding) this.holdPrey(d, w);
    if (d.devourT >= 4.2) {
      d.sated = 60;
      d.anger = 0;
      d.state = 'roam';
      d.roam = { phase: 'home', until: 30 };
    }
  }

  dead(d, w, dt) {
    d.breathT = 0;
    d.windT = 0;
    d.look = null;
    d.lunge = 0;
    d.flapAmp = approach(d.flapAmp, 0, 2, dt);
    d.undulate = 0;
    if (d.mode === 'air' || d.mode === 'falling') {
      d.mode = 'falling';
      d.vy -= G * dt;
      d.p[0] += Math.sin(d.yaw) * d.speed * dt;
      d.p[2] += Math.cos(d.yaw) * d.speed * dt;
      d.p[1] += d.vy * dt;
      d.speed *= 1 - 0.3 * dt;
      d.bank = approach(d.bank, 1.2, 1, dt);
      d.fold = approach(d.fold, 0.4, 1, dt);
      const g = groundAt(w, d.p[0], d.p[2], d.p[1] + 1).y;
      if (d.p[1] <= g + 0.6 * d.k) {
        d.mode = 'dead';
        d.p[1] = g + 0.6 * d.k;
        w.events.push({ type: 'dragonDown', pos: d.p.slice(), time: w.time, name: 'the dragon' });
        w.noises.push({ p: d.p.slice(), loud: 40, time: w.time, kind: 'dragon' });
        this.sim.ai?.blast?.(d.p, 2.5 * d.k); // whoever it lands on
      }
      this.updateTrail(d);
      return;
    }
    if (d.mode !== 'dead') {
      d.mode = 'dead';
      w.events.push({ type: 'dragonDown', pos: d.p.slice(), time: w.time, name: 'the dragon' });
    }
    d.speed = 0;
    d.groundF = approach(d.groundF, 1, 2, dt);
    d.crouch = approach(d.crouch, 1, 2, dt);
    d.bank = approach(d.bank, 1.25, 1.5, dt);
    d.fold = approach(d.fold, 0.35, 1, dt);
    d.jaw = approach(d.jaw, 0.35, 2, dt);
    d.glow = approach(d.glow, 0, 2, dt);
    for (const t of d.trail) t[3] = approach(t[3], 1.25, 1.5, dt);
  }

  // ---------------------------------------------------------------------------
  // fire

  /** Wind up (the throat glows, the jaws open), then a jet of fire for a few seconds. */
  startBreath(d, aim, wind) {
    d.windT = wind;
    d.aim = aim.slice();
    d.look = aim.slice();
    if (Math.random() < 0.5) this.roar(d, this.world);
  }

  breath(d, w, dt) {
    if (d.windT > 0) {
      d.windT -= dt;
      if (d.windT <= 0) d.breathT = 2.0 + Math.random() * 0.8;
      return;
    }
    if (d.breathT <= 0) return;
    d.breathT -= dt;
    d.fuel -= dt * 0.17;
    if (d.fuel <= 0) {
      d.fuel = 0;
      d.breathT = 0;
    }
    if (d.breathT <= 0) {
      d.breathCool = 4 + Math.random() * 3;
      return;
    }
    const k = d.k;
    const dir = d.headDir;
    const from = d.mouth;
    const range = 10 * Math.sqrt(k);
    const hit = this.ray(from, dir, range);
    const L = Math.max(0.8, hit.s);
    // the jet in the simulation: burning liquid, a directional flame
    if (!d.jet || !w.heaters.includes(d.jet)) {
      d.jet = { pos: from.slice(), dir: dir.slice(), power: 3.5e6 * k * k, radius: 0.35 * k, height: L, on: true, temporary: true, jet: true, label: 'dragon fire', smokeYield: 0.003 };
      w.heaters.push(d.jet);
    }
    const j = d.jet;
    j.pos = from.slice();
    j.dir = dir.slice();
    j.height = L;
    j.until = w.time + 0.25;
    d.jetLen = L;
    // where it lands, it sets things alight (it is a sticky, burning liquid)
    d.igniteT = (d.igniteT ?? 0) - dt;
    if (hit.p && d.igniteT <= 0) {
      d.igniteT = 0.25;
      this.sim.ignite(hit.p, 0.6 * k);
      this.sim.addTorch(hit.p, 30000 * k, 6, 0.3 * k); // the liquid burns on where it splashed
    }
    // whoever is in the jet
    const inJet = (p) => {
      const v = sub(p, from);
      const t = clamp(v[0] * dir[0] + v[1] * dir[1] + v[2] * dir[2], 0, L);
      const q = [from[0] + dir[0] * t, from[1] + dir[1] * t, from[2] + dir[2] * t];
      return dist(p, q) < 0.45 + 0.12 * t;
    };
    for (const e of w.enemies) {
      if (e.dead) continue;
      if (inJet([e.p[0], e.p[1] + 0.9, e.p[2]]) || inJet([e.p[0], e.p[1] + 1.5, e.p[2]])) {
        e.onFire = 12;
        this.sim.ai?.damage?.(e, 40 * dt);
        e.state = 'flee';
      }
    }
    const pl = this.sim.ai?.player;
    if (pl && (inJet([pl.p[0], pl.p[1] + 0.9, pl.p[2]]) || inJet(pl.head))) {
      if (w.time - (d.lastBurn ?? -9) > 0.3) {
        d.lastBurn = w.time;
        w.events.push({ type: 'dragonFire', pos: pl.head.slice(), time: w.time, name: 'the dragon' });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // getting about

  /** Is it clear to walk on along `yaw` (no wall, no deep water, inside the world)? */
  groundFree(d, w, yaw, opts = {}) {
    const k = d.k;
    const cur = d.p[1] - clearance(0, k, d.crouch);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const m = 2.5 * k;
    for (const [a, sd] of [[1.0, 0], [2.0, 0], [1.2, 0.6], [1.2, -0.6]]) {
      const x = d.p[0] + fx * a * k + fz * sd * k;
      const z = d.p[2] + fz * a * k - fx * sd * k;
      if (x < m || z < m || x > w.size[0] - m || z > w.size[2] - m) return false;
      const g = groundAt(w, x, z, cur + 1.3 * k);
      if (g.water > (opts.swim ? 2.4 : 0.8) * k) return false; // it swims a canal, not the sea
      if (g.y - cur > 0.7 * k && (!opts.climb || this.isTree(w, x, z, cur))) return false; // a wall (unless it climbs it)
    }
    return true;
  }

  /** Is the obstacle at (x, z), at body height above `floor`, a tree? */
  isTree(w, x, z, floor) {
    for (let y = floor + 0.3; y < floor + 2; y += w.h) {
      const i = w.voxelAt(x, y, z);
      if (i >= 0 && w.mat[i] && TREE.has(MATERIALS[w.mat[i]].name)) return true;
    }
    return false;
  }

  /**
   * Walk (crawl, run) towards goal at up to `speed` m/s; goal null = stand.
   * opts.climb: walls are no obstacle, it climbs them (and down the other side) like
   * a lizard; opts.swim: it swims across water a little deeper than it is tall.
   */
  groundMove(d, w, dt, goal, speed, opts = {}) {
    const k = d.k;
    d.mode = 'ground';
    let want = d.yaw;
    if (goal) {
      const dx = goal[0] - d.p[0];
      const dz = goal[2] - d.p[2];
      if (Math.hypot(dx, dz) < 0.5 * k) speed = 0;
      else want = Math.atan2(dx, dz);
    } else speed = 0;
    if (speed > 0) {
      if (!this.groundFree(d, w, want, opts)) {
        let found = false;
        for (const off of [0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.7, -1.7, 2.3, -2.3, Math.PI]) {
          if (this.groundFree(d, w, want + off, opts)) {
            want += off;
            found = true;
            break;
          }
        }
        if (!found) {
          speed = 0;
          d.blocked += dt;
        }
      } else d.blocked = Math.max(0, d.blocked - dt);
    }
    const err = wrap(want - d.yaw);
    if (speed > 0) {
      d.yaw += clamp(err * 2.2, -1.5, 1.5) * dt;
      if (Math.abs(err) > 1.0) speed = Math.min(speed, 1.0 * k); // turning on the spot: slowly
    }
    d.speed += clamp(speed - d.speed, -6 * dt, 3.5 * dt);
    if (d.speed < 0.01) d.speed = 0;
    // crouching to rest, standing up to go
    const lie = d.state === 'rest' && d.speed < 0.05 && !(d.windT > 0 || d.breathT > 0);
    d.crouch = approach(d.crouch, lie ? 1 : d.takeoffT > 0 ? 0.35 : 0, lie ? 0.6 : 3, dt);
    d.fold = approach(d.fold, 1, 1.5, dt);
    d.groundF = approach(d.groundF, 1, 2.5, dt);
    d.bank = approach(d.bank, 0, 3, dt);
    d.pitch = approach(d.pitch, 0, 3, dt);
    d.flapAmp = approach(d.flapAmp, 0, 2, dt);
    d.vy = 0;
    const s = d.speed * dt;
    const fx = Math.sin(d.yaw);
    const fz = Math.cos(d.yaw);
    const cur = d.p[1] - clearance(0, k, d.crouch);
    let moved = s;
    let climbed = false;
    // a wall right in front (where its chest meets it): climb it, or stop
    const wallAhead = s > 0 && groundAt(w, d.p[0] + fx * 0.8 * k, d.p[2] + fz * 0.8 * k, cur + 1.3 * k).y - cur > 0.7 * k;
    const nx = d.p[0] + fx * s;
    const nz = d.p[2] + fz * s;
    const g = smoothGround(w, nx, nz, cur + 1.3 * k);
    if (s > 0 && opts.climb && (wallAhead || g - cur > 0.75 * k) && !this.isTree(w, d.p[0] + fx * 0.8 * k, d.p[2] + fz * 0.8 * k, cur)) {
      // up the wall, belly to it
      d.p[1] += s;
      climbed = true;
    } else if (s > 0 && g - cur > 0.75 * k) {
      d.speed = 0;
      d.blocked += dt;
      moved = 0;
    } else {
      d.p[0] = nx;
      d.p[2] = nz;
    }
    const gy = smoothGround(w, d.p[0], d.p[2], d.p[1] + 1.3 * k - clearance(0, k, d.crouch)) + clearance(0, k, d.crouch);
    // cresting the top of a wall: the ground just ahead is up here with it
    const cresting = opts.climb && !climbed && d.p[1] - gy > 1.0 * k && groundAt(w, d.p[0] + fx * 0.8 * k, d.p[2] + fz * 0.8 * k, cur + 1.3 * k).y > cur - 0.7 * k;
    if (cresting) {
      d.p[0] = nx;
      d.p[2] = nz;
    } else if (!climbed) {
      if (d.p[1] - gy > 1.0 * k) {
        // over an edge: down the wall head first, holding on
        const down = Math.min(d.p[1] - gy, Math.max(1.4 * k, d.speed) * dt);
        d.p[1] -= down;
        moved += down;
        if (opts.climb) {
          // it does not walk on into thin air while it climbs down
          d.p[0] -= fx * s;
          d.p[2] -= fz * s;
        }
      } else d.p[1] = approach(d.p[1], gy, 8, dt);
    }
    // clinging to a wall (the chest well above what is under it)
    d.cling = d.p[1] - gy > 0.6 * k ? 1 : 0;
    // the gait: a stride of ~1.4 body-plan metres walking, longer running
    const stride = (1.3 + 0.12 * d.speed) * k;
    const before = Math.floor(d.gait * 2);
    d.gait += moved / stride;
    if (Math.floor(d.gait * 2) !== before) this.footfall(d, w);
    d.undulate = approach(d.undulate, d.cling ? 0.3 : Math.min(1, d.speed / (2.5 * k)), 3, dt);
  }

  /**
   * A diagonal pair of feet comes down (front on one side, hind on the other): a
   * thud for the sound (d.footfalls) and a noise the guards hear.
   */
  footfall(d, w, heavy = 0) {
    const k = d.k;
    d.steps++;
    if (!d.spine) return;
    const pair = Math.floor(d.gait * 2) & 1;
    const F = d.forward ?? [Math.sin(d.yaw), 0, Math.cos(d.yaw)];
    const side = norm([F[2], 0, -F[0]]);
    const feet = heavy ? [[d.iShoulder, 1], [d.iShoulder, -1], [d.iHip, 1], [d.iHip, -1]] : [[d.iShoulder, pair ? 1 : -1], [d.iHip, pair ? -1 : 1]];
    for (const [i, sd] of feet) {
      const P = d.spine[i];
      const [rx] = bodyRadius(i * PLAN.ds);
      const x = P[0] + side[0] * sd * (rx + 0.5) * k;
      const z = P[2] + side[2] * sd * (rx + 0.5) * k;
      const y = d.cling ? P[1] : groundAt(w, x, z, P[1] + 0.5 * k).y;
      d.footfalls.push({ p: [x, y, z], t: w.time, weight: (heavy ? 2 : 0.5 + 0.5 * Math.min(1, d.speed / (4 * k))) * k * k });
    }
    if (d.footfalls.length > 12) d.footfalls.splice(0, d.footfalls.length - 12);
    w.noises.push({ p: d.chest.slice(), loud: (heavy ? 30 : 10 + 4 * d.speed) * k, time: w.time, kind: 'dragon' });
  }

  /** Into the air: a crouch, a leap and hard wingbeats. */
  takeoff(d, w, dt) {
    if (d.mode === 'air') {
      d.forceTakeoff = false;
      return true;
    }
    d.takeoffT = (d.takeoffT ?? 0) + dt;
    d.speed = approach(d.speed, 2.5 * d.k, 3, dt);
    d.fold = approach(d.fold, 0, 4, dt);
    d.flapAmp = approach(d.flapAmp, 0.6, 3, dt);
    this.groundMove(d, w, dt, [d.p[0] + Math.sin(d.yaw) * 5, 0, d.p[2] + Math.cos(d.yaw) * 5], 2.5 * d.k);
    d.fold = approach(d.fold, 0, 4, dt);
    if (d.takeoffT > 0.6) {
      d.mode = 'air';
      d.takeoffT = 0;
      d.vy = 5.5;
      d.speed = Math.max(d.speed, 5);
      d.flapAmp = 1.3;
      d.forceTakeoff = false;
      w.noises.push({ p: d.p.slice(), loud: 25, time: w.time, kind: 'dragon' });
      return true;
    }
    return false;
  }

  /** Fly towards goal (x, z) at altitude alt and about `speed` m/s, banking into turns. */
  airMove(d, w, dt, goal, alt, speed, minClear = 2.2) {
    const k = d.k;
    d.mode = 'air';
    const dx = goal[0] - d.p[0];
    const dz = goal[2] - d.p[2];
    const want = Math.atan2(dx, dz);
    const err = wrap(want - d.yaw);
    // slow (flaring to land) it can turn tightly, beating its wings
    const maxTurn = d.speed < 5 ? 2.2 : 1.0;
    const turn = clamp(err * 1.4, -maxTurn, maxTurn);
    d.yaw += turn * dt;
    d.bank = approach(d.bank, clamp(Math.atan((d.speed * turn) / G), -0.75, 0.75), 3, dt);
    // never too low over the ground ahead
    const fx = d.p[0] + Math.sin(d.yaw) * d.speed * 1.5;
    const fz = d.p[2] + Math.cos(d.yaw) * d.speed * 1.5;
    const floor = Math.max(groundAt(w, d.p[0], d.p[2]).y, groundAt(w, fx, fz).y, w.sea?.level ?? 0);
    alt = Math.max(alt, floor + minClear * k);
    const vyWant = clamp((alt - d.p[1]) * 0.9, -7, 3.5);
    d.vy += clamp(vyWant - d.vy, -8 * dt, 6 * dt);
    // diving gains speed, climbing costs it
    d.speed += clamp(speed - d.speed - 0.25 * d.vy, -4 * dt, 3 * dt);
    d.speed = clamp(d.speed, 2, 18);
    d.p[0] += Math.sin(d.yaw) * d.speed * dt;
    d.p[2] += Math.cos(d.yaw) * d.speed * dt;
    d.p[1] += d.vy * dt;
    d.pitch = approach(d.pitch, Math.atan2(d.vy, d.speed) + (d.flare ?? 0) * 0.45, 4, dt);
    // flap to climb or keep the speed up; glide down
    const flap = vyWant > -0.8 || d.speed < speed - 1 || (d.flare ?? 0) > 0.3;
    d.flapAmp = approach(d.flapAmp, flap ? (vyWant > 2 || (d.flare ?? 0) > 0.3 ? 1.25 : 1) : 0.05, 2.5, dt);
    d.fold = approach(d.fold, 0, 3, dt);
    d.crouch = approach(d.crouch, 0, 3, dt);
    d.groundF = approach(d.groundF, 0, 1.5, dt);
    d.undulate = approach(d.undulate, 0, 2, dt);
  }

  /** Come down at `spot` (a flare and deep wingbeats at the end). Returns true once down. */
  land(d, w, dt, spot) {
    const k = d.k;
    if (d.mode === 'ground') return true;
    const dh = Math.hypot(spot[0] - d.p[0], spot[2] - d.p[2]);
    const g = groundAt(w, spot[0], spot[2]).y;
    const here = groundAt(w, d.p[0], d.p[2], d.p[1] + 1).y;
    d.flare = approach(d.flare ?? 0, dh < 7 * k ? 1 : 0, 3, dt);
    const alt = g + PLAN.clear * k + Math.max(0, dh - 1.5 * k) * 0.35;
    this.airMove(d, w, dt, spot, alt, clamp(dh * 0.45, 3, 11), dh < 6 * k ? 0.7 : 2.2);
    if (dh < 2.4 * k && d.p[1] - here < PLAN.clear * k + 1.0 * k) {
      d.mode = 'ground';
      d.speed = Math.min(d.speed, 1.5);
      d.vy = 0;
      d.flare = 0;
      d.cling = 0;
      this.footfall(d, w, 1); // all four feet at once, hard
      w.noises.push({ p: d.p.slice(), loud: 20, time: w.time, kind: 'dragon' });
      return true;
    }
    return false;
  }

  /** An open, level, dry place to land near `near` (within r). */
  landingSpot(d, w, near, r) {
    const k = d.k;
    let best = null;
    let bs = Infinity;
    for (let n = 0; n < 40; n++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.random() * r;
      const x = near[0] + Math.cos(a) * rr;
      const z = near[2] + Math.sin(a) * rr;
      const m = 3 * k;
      if (x < m || z < m || x > w.size[0] - m || z > w.size[2] - m) continue;
      const g = groundAt(w, x, z);
      if (g.water > 0.2) continue;
      let ok = true;
      for (const [ox, oz] of [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5], [3, 0], [-3, 0], [0, 3], [0, -3]]) {
        const q = groundAt(w, x + ox * k, z + oz * k);
        if (Math.abs(q.y - g.y) > 0.6 * k || q.water > 0.3) ok = false;
      }
      if (!ok || this.sheltered([x, g.y, z])) continue;
      const s = rr;
      if (s < bs) {
        bs = s;
        best = [x, g.y, z];
      }
    }
    return best;
  }

  /** Wings, jaws, throat, tongue between steps. */
  animate(d, dt) {
    const freq = 1.2 / Math.sqrt(d.k);
    if (d.flapAmp > 0.1 || d.mode === 'air') {
      const before = Math.floor(d.flapPhase);
      d.flapPhase += dt * freq * (0.8 + 0.4 * Math.min(1, d.flapAmp));
      if (Math.floor(d.flapPhase) !== before && d.flapAmp > 0.3) d.beats++;
    }
    let jaw = 0.04;
    if (d.windT > 0) jaw = 0.45;
    if (d.breathT > 0) jaw = 0.8;
    if (d.roarT > 0) {
      d.roarT -= dt;
      jaw = Math.max(jaw, 0.95 * Math.min(1, d.roarT * 2));
    }
    if (d.biteT > 0) jaw = d.biteT > 0.2 ? 1 : 0;
    if (d.holding) jaw = 0.22 + 0.2 * Math.abs(Math.sin(d.devourT * 6));
    if (d.state === 'devour' && !d.holding) jaw = 0;
    d.jaw = approach(d.jaw, jaw, d.biteT > 0 ? 30 : 8, dt);
    d.glow = approach(d.glow, d.breathT > 0 ? 1 : d.windT > 0 ? 0.7 : 0, 6, dt);
    d.tongueT = Math.max(0, (d.tongueT ?? 0) - dt);
    d.tongue = d.tongueT > 0 && d.jaw < 0.3 ? Math.sin((1 - d.tongueT / 0.6) * Math.PI) : 0;
  }

  /** The chest leaves a trail that the trunk and tail follow. */
  updateTrail(d) {
    const t = d.trail;
    const k = d.k;
    t[0] = [d.p[0], d.p[1], d.p[2], d.bank, d.mode === 'ground' ? d.cling : 0];
    // a new trail point once it has moved on (standing up or lying down in place is no move)
    const dh = Math.hypot(t[0][0] - t[1][0], t[0][2] - t[1][2]);
    const dv = Math.abs(t[0][1] - t[1][1]);
    if (dh > 0.1 * k || ((d.mode !== 'ground' || d.cling) && Math.hypot(dh, dv) > 0.1 * k)) t.splice(1, 0, t[0].slice());
    // drop what is no longer needed
    const need = (PLAN.trunk + PLAN.tail) * k + 1;
    let acc = 0;
    for (let i = 1; i < t.length; i++) {
      acc += Math.hypot(t[i][0] - t[i - 1][0], t[i][1] - t[i - 1][1], t[i][2] - t[i - 1][2]);
      if (acc > need && i < t.length - 1) {
        t.length = i + 1;
        break;
      }
    }
    // the roll of the body follows the bank, back along it
    for (let i = 1; i < t.length; i++) t[i][3] += (t[i - 1][3] - t[i][3]) * 0.05;
  }

  // ---------------------------------------------------------------------------
  // wounds

  /** A projectile at p: did it hit a dragon? */
  hit(p, type) {
    for (const d of this.world.dragons ?? []) {
      if (!d.spine || d.health <= 0) continue;
      const k = d.k;
      let part = null;
      const hp = d.head.p;
      const hc = [0, 1, 2].map((c) => hp[c] + d.head.dir[c] * PLAN.head * k * 0.45);
      if (dist(p, hc) < 0.55 * k) part = 'head';
      else
        for (let i = 0; i < d.spine.length; i++) {
          const [rx, ry] = bodyRadius(i * PLAN.ds);
          if (dist(p, d.spine[i]) < Math.max(rx, ry) * k + 0.1) {
            part = 'body';
            break;
          }
        }
      if (!part) continue;
      const dmg = (type === 'arrow' ? 30 : type === 'rocket' ? 350 : 60) * (part === 'head' ? 2 : 1);
      this.wound(d, dmg);
      return true;
    }
    return false;
  }

  /** A blast hurts a dragon in range. */
  blast(center, radius) {
    for (const d of this.world.dragons ?? []) {
      if (!d.chest || d.health <= 0) continue;
      const dd = dist(center, d.chest);
      if (dd < radius * 1.8) this.wound(d, 320 * (1 - dd / (radius * 1.8)));
    }
  }

  wound(d, amount) {
    const w = this.world;
    d.health -= amount;
    d.hurtFlash = 0.3;
    d.anger = 30;
    d.sated = 0;
    // it knows who did it
    const pl = this.sim.ai?.player;
    if (pl && d.health > 0) d.target = { kind: 'player', ref: 'player', p: pl.p.slice(), head: pl.head.slice(), seen: true, lastSeen: w.time };
    if (d.health <= 0) {
      d.health = 0;
      w.events.push({ type: 'dragonHit', pos: d.chest.slice(), time: w.time, name: 'the dragon' });
    } else this.roar(d, w);
  }
}
