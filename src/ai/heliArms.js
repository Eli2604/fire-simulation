/**
 * A helicopter's armament (ai/helicopter.js: o.armament), beside its door guns: a chin turret gun
 * (a 30 mm or 20 mm cannon firing HE rounds, or a 12.7 mm machine gun), unguided 70 mm rocket pods
 * on stub wings, guided missiles on rails (an anti-tank missile against vehicles and boats; a heat
 * seeking air-to-air missile against helicopters, after its seeker has locked on), and flares to
 * decoy a heat seeker. What they fire flies as real projectiles (sim/ordnance.js): a cannon round
 * with its time of flight, drag and drop; a rocket with its motor burning a second, then coasting;
 * a missile steered by proportional navigation.
 *
 *   ARMAMENTS                the presets (o.armament: 'gunship' | 'attack' | 'escort' | 'none', or
 *                            an object of the same fields): { gun, gunAmmo, rockets, atgm, aam, flares }
 *   ROUNDS, ROCKETS, MISSILES, FLARE   the numbers of each (rate, muzzle velocity, drag, damage, warhead)
 *   initArms(h, o)           h.arms from o.armament (null: unarmed)
 *   aimSolution(from, vp, spec, T, Tv)  the direction to fire to hit T (moving at Tv) from a
 *                            platform moving at vp: lead and drop from the time of flight → { dir, tof, at }
 *   turretBears(h, dir)      can the chin turret point that way (azimuth ±110°, −60° … +15°)?
 *   fireGun(h, dir), fireRockets(h, n, dir?), fireMissile(h, kind, target), dropFlares(h, n)
 *   missileWarning(h)        missiles in the air tracking it (not decoyed): its warning receiver
 *   stepArms(h, dt)          cool-downs, the seeker's lock, and the player's triggers (h.armsInput:
 *                            { gun: held, rockets: once, missile: once, flares: once }); the AI's
 *                            fire is ai/heliCombat.js
 *   armsCtx(h)               the battle context it fires into (sim/ordnance.js battleCtx)
 */
import { launch, battleCtx } from '../sim/ordnance.js';
import { heliToWorld, heliToLocal, heliAxes } from './helicopter.js';
import { hostile } from './sides.js';
import { vehicleKind, vehiclePose } from './vehicleSides.js';

const G = 9.81;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Gun rounds: muzzle velocity (m/s), drag (1/s), damage (VEHICLE_WEAPONS: bullet 25, shell 120), HE charge (J) and its fragments' reach (m), a boat's hole (m²), rounds a second. */
export const ROUNDS = {
  m230: { label: '30 mm cannon (HEDP)', v0: 805, drag: 0.22, amount: 120, he: 1.5e5, heR: 1.8, fragAmount: 30, hole: 4e-3, weapon: 'cannon', rate: 10, range: 1700, life: 6, spread: 0.006 },
  m197: { label: '20 mm cannon (HE)', v0: 1030, drag: 0.3, amount: 95, he: 6e4, heR: 1.5, fragAmount: 35, hole: 2.5e-3, weapon: 'cannon', rate: 12, range: 1500, life: 5, spread: 0.005 },
  hmg: { label: '12.7 mm machine gun', v0: 890, drag: 0.18, amount: 40, hole: 1.2e-3, weapon: 'heavy', rate: 9, range: 1400, life: 4.5, spread: 0.004 },
  mg: { label: '7.62 mm machine gun', v0: 850, drag: 0.3, amount: 31, hole: 6e-4, weapon: 'mg', rate: 12, range: 900, life: 3.5, spread: 0.005 },
};
/** Unguided rockets (a 70 mm Hydra-like with a 4 kg HE warhead): launched at v0, the motor's thrust for `burn` s (~740 m/s at burn-out). */
export const ROCKETS = {
  hydra: { label: '70 mm rocket', v0: 45, accel: 640, burn: 1.05, drag: 0.03, amount: 350, he: 2.5e6, spread: 0.009, range: 4000, minRange: 300, life: 14 },
};
/**
 * Missiles: an anti-tank missile (laser / radar guided: flares do nothing to it) for vehicles and
 * boats, a heat seeker for helicopters (its seeker's field of view `fov`, the time it takes to
 * lock `lock` s, the chance a flare in its view pulls it off `decoy`).
 */
export const MISSILES = {
  atgm: { label: 'anti-tank missile', ir: false, v0: 35, accel: 230, burn: 2.6, drag: 0.07, turnG: 14, nav: 3.5, amount: 900, he: 3e6, fuse: 2.2, lock: 1.2, cone: 0.5, range: 5000, minRange: 400, life: 24, vsAir: false },
  aam: { label: 'air-to-air missile (heat seeker)', ir: true, v0: 40, accel: 420, burn: 1.8, drag: 0.12, turnG: 24, nav: 4, amount: 350, he: 6e5, fuse: 4, lock: 1.6, cone: 0.35, fov: 0.35, decoy: 0.25, range: 4500, minRange: 150, life: 12, vsAir: true },
};
/** A flare: burns `burn` s (hotter than the engines' exhaust: a heat seeker's best look). */
export const FLARE = { burn: 4.5, strength: 1 };

/** The armament presets. */
export const ARMAMENTS = {
  none: null,
  // a gunship: the chin cannon and two big rocket pods
  gunship: { gun: 'm230', gunAmmo: 1200, rockets: 38, atgm: 0, aam: 0, flares: 60 },
  // an attack helicopter: cannon, a pod, anti-tank missiles and two heat seekers for helicopters
  attack: { gun: 'm230', gunAmmo: 1200, rockets: 19, atgm: 8, aam: 2, flares: 60 },
  // an armed utility helicopter on escort: a 20 mm, small pods, two heat seekers
  escort: { gun: 'm197', gunAmmo: 750, rockets: 14, atgm: 0, aam: 2, flares: 30 },
};
/** What the armament weighs (kg): the gun and its rounds, a rocket, a missile (ai/helicopter.js heliMass). */
export function armsMass(a) {
  if (!a) return 0;
  return (a.gun ? 120 + (a.gunAmmo ?? 0) * 0.35 : 0) + (a.rockets ?? 0) * 11 + (a.rockets ? 40 : 0) + (a.atgm ?? 0) * 48 + (a.aam ?? 0) * 15 + (a.flares ?? 0) * 0.4 + (a.rockets || a.atgm || a.aam ? 90 : 0);
}

/** Where the weapons are on it (its frame: front +x, up +y, right +z). */
export const MOUNT = {
  gun: [3.95, 0.3, 0],
  pod: (s) => [0.7, 1.15, s * 1.95],
  rail: (s) => [0.7, 1.0, s * 2.45],
  flare: (s) => [-2.6, 1.0, s * 0.85],
};

/** h.arms from o.armament (a preset name or an object), or null. */
export function initArms(h, o = {}) {
  const a0 = typeof o.armament === 'string' ? ARMAMENTS[o.armament] : o.armament;
  if (!a0) return null;
  const a = { ...a0 };
  for (const k of ['gunAmmo', 'rockets', 'atgm', 'aam', 'flares']) if (o[k] != null) a[k] = o[k];
  return {
    preset: typeof o.armament === 'string' ? o.armament : 'custom',
    spec: a,
    gun: a.gun ? { type: a.gun, spec: ROUNDS[a.gun], ammo: a.gunAmmo ?? 500, cd: 0, burst: 0, dir: null, flash: -1, n: 0 } : null,
    rockets: a.rockets ?? 0,
    rocketCd: 0,
    pod: 1,
    atgm: a.atgm ?? 0,
    aam: a.aam ?? 0,
    missileCd: 0,
    rail: 1,
    lock: null, // { key, t, kind }
    flares: a.flares ?? 0,
    flareCd: 0,
    fired: { gun: 0, rockets: 0, atgm: 0, aam: 0, flares: 0 },
    sensor: o.sensorRange ?? 3000, // m: the pilots' sight (a stabilised sight / FLIR) for vehicles and helicopters
  };
}

/** The battle context it fires into: its host's (ai/helicopter.js HeliAI), else its own on its world. */
export function armsCtx(h) {
  if (h.host.battle) return h.host.battle;
  return (h._battle ??= battleCtx(h.world, h.host.sim?.ai ? h.host.sim : null, { ground: (x, z) => h.ground(x, z), sees: h.host.sees ? (a, b) => h.host.sees(a, b) : null, rand: () => h.rand() }));
}

/** Rounds left for each weapon, and whether it has anything left to fight with. */
export function hasOffence(h) {
  const A = h.arms;
  if (!A) return false;
  return (A.gun?.ammo ?? 0) > 0 || A.rockets > 0 || A.atgm > 0 || A.aam > 0;
}

/* ------------------------------------------------------------------ aiming */

/**
 * Time of flight to s metres for a projectile (a round: v0 with drag; a rocket: its motor, then
 * drag), and its mean speed. Numeric for a rocket (cheap: a few dozen steps).
 */
export function flightTime(spec, s, vp = 0) {
  if (spec.accel) {
    let v = spec.v0 + vp, x = 0, t = 0;
    const dt = 0.05;
    while (x < s && t < 20) {
      if (t < (spec.burn ?? 1)) v += spec.accel * dt;
      v *= Math.exp(-(spec.drag ?? 0.03) * dt);
      x += v * dt;
      t += dt;
    }
    return t - (x - s) / Math.max(1, v);
  }
  const k = spec.drag ?? 0.2;
  const v0 = spec.v0 + vp;
  const q = (k * s) / v0;
  return q >= 0.98 ? 20 : -Math.log(1 - q) / k;
}

/**
 * The way to fire to hit T (moving at Tv) from `from` on a platform moving at vp: lead the target
 * by the time of flight, raise the aim by the drop over it (with the drag's a little more). → { dir, tof, at }.
 */
export function aimSolution(from, vp, spec, T, Tv = [0, 0, 0]) {
  let at = T.slice();
  let tof = 0;
  // the lead: where it will be after the time of flight (the round carries the platform's own velocity)
  for (let i = 0; i < 3; i++) {
    const r = sub(at, from);
    tof = flightTime(spec, len(r), dot(vp, norm(r)));
    at = [T[0] + (Tv[0] - vp[0]) * tof, T[1] + (Tv[1] - vp[1]) * tof, T[2] + (Tv[2] - vp[2]) * tof];
  }
  // the drop (and the drift of the platform's velocity): fly it, and move the aim by the miss
  let aim = [at[0], at[1] + 0.5 * G * tof * tof, at[2]];
  for (let i = 0; i < 3; i++) {
    const q = flyOut(from, norm(sub(aim, from)), vp, spec, at);
    if (!q) break;
    tof = q.t;
    aim = [aim[0] + (at[0] - q.p[0]), aim[1] + (at[1] - q.p[1]), aim[2] + (at[2] - q.p[2])];
  }
  return { dir: norm(sub(aim, from)), tof, at };
}

/** A projectile fired along dir (with the platform's vp) flown out to as far as `at` (horizontally): where it is then, and when. */
export function flyOut(from, dir, vp, spec, at) {
  const hd = norm([at[0] - from[0], 0, at[2] - from[2]]);
  const D = Math.hypot(at[0] - from[0], at[2] - from[2]);
  let p = from.slice();
  const v = dir.map((x, i) => x * spec.v0 + vp[i]);
  const dt = D > 600 ? 0.03 : 0.015;
  const k = Math.exp(-(spec.drag ?? 0.2) * dt);
  for (let t = 0; t < 20; t += dt) {
    if (spec.accel && t < (spec.burn ?? 1)) {
      const n = norm(v);
      for (let i = 0; i < 3; i++) v[i] += n[i] * spec.accel * dt;
    }
    v[1] -= G * dt;
    for (let i = 0; i < 3; i++) v[i] *= k;
    const np = [p[0] + v[0] * dt, p[1] + v[1] * dt, p[2] + v[2] * dt];
    const s0 = (p[0] - from[0]) * hd[0] + (p[2] - from[2]) * hd[2];
    const s1 = (np[0] - from[0]) * hd[0] + (np[2] - from[2]) * hd[2];
    if (s1 >= D) {
      const f = (D - s0) / (s1 - s0 || 1);
      return { p: [p[0] + (np[0] - p[0]) * f, p[1] + (np[1] - p[1]) * f, p[2] + (np[2] - p[2]) * f], t: t + dt * f };
    }
    if (s1 <= s0 && t > 1) return null;
    p = np;
  }
  return null;
}

/** Can the chin turret point along world dir? (azimuth ±110° of the nose, elevation −60° … +15°) */
export function turretBears(h, dir, A = heliAxes(h.yaw, h.pitch, h.roll)) {
  const l = heliToLocal(h, dir, true, A);
  const az = Math.atan2(l[2], l[0]);
  const el = Math.asin(clamp(l[1], -1, 1));
  return Math.abs(az) < 1.92 && el > -1.05 && el < 0.26;
}
/** Can the rocket pods (fixed forward, elevating −15° … +4° on their pylons) fire along dir; how far off (rad)? */
export function podsOff(h, dir, A = heliAxes(h.yaw, h.pitch, h.roll)) {
  const l = heliToLocal(h, dir, true, A);
  const az = Math.atan2(l[2], l[0]);
  const el = Math.asin(clamp(l[1], -1, 1));
  return Math.max(Math.abs(az), el > 0.07 ? el - 0.07 : el < -0.26 ? -0.26 - el : 0);
}

/** Its target as a missile tracks it: a point (live), its velocity. */
export function trackOf(c) {
  const ref = c?.ref ?? c;
  if (ref?.axes && ref.toWorld) return { ref, get p() { return ref.toWorld([0, 1.4, 0]); }, vel: () => ref.v, heat: !ref.crashed };
  if (vehicleKind(ref)) return { ref, get p() { return vehiclePose(ref)?.at ?? [0, -100, 0]; }, vel: () => vehiclePose(ref)?.vel ?? [0, 0, 0] };
  if (ref?.p) return { ref, get p() { return [ref.p[0], ref.p[1] + 1, ref.p[2]]; }, vel: () => [0, 0, 0] };
  const p = (c?.at ?? c?.p ?? [0, 0, 0]).slice();
  return { ref: null, p, vel: () => [0, 0, 0] };
}

/** Where a contact is now and how it moves: { p, v }. */
export function contactState(c) {
  const ref = c.ref;
  if (ref?.axes && ref.toWorld) return { p: ref.toWorld([0, 1.4, 0]), v: ref.v.slice() };
  if (vehicleKind(ref)) {
    const P = vehiclePose(ref);
    return { p: P.at, v: P.vel, look: P.look };
  }
  const p = c.at ?? c.p;
  return { p: p.slice(), v: c.v ?? [0, 0, 0] };
}

/* ------------------------------------------------------------------ firing */

/** One round from the chin gun along dir (its dispersion, the helicopter's own velocity on it). Did it fire? */
export function fireGun(h, dir, spreadK = 1) {
  const A = h.arms;
  const g = A?.gun;
  if (!g || g.ammo <= 0 || g.cd > 0 || h.crashed) return false;
  const S = g.spec;
  g.cd += 1 / S.rate;
  g.ammo--;
  g.n++;
  A.fired.gun++;
  const from = heliToWorld(h, MOUNT.gun);
  const sp = (S.spread ?? 0.006) * spreadK * (1 + h.vibration + Math.hypot(h.yawRate ?? 0, h.pitchRate ?? 0) * 0.5);
  const d = norm([dir[0] + (h.rand() - 0.5) * 2 * sp, dir[1] + (h.rand() - 0.5) * 2 * sp, dir[2] + (h.rand() - 0.5) * 2 * sp]);
  g.dir = heliToLocal(h, d, true);
  g.flash = h.time;
  launch(armsCtx(h), { type: 'round', spec: S, p: from, v: d.map((x, i) => x * S.v0 + h.v[i]), owner: h, shooter: h, side: h.side, tracer: g.n % 3 === 0 });
  return true;
}

/** n rockets (a ripple: one now, the rest by stepArms 0.12 s apart) from the pods along the nose (or dir, within the pylons' travel). */
export function fireRockets(h, n = 2, dir = null) {
  const A = h.arms;
  if (!A || A.rockets <= 0 || h.crashed) return 0;
  A.ripple = { left: Math.min(n, A.rockets), dir: dir ? dir.slice() : null, t: 0 };
  stepRipple(h, 0);
  return Math.min(n, A.rockets + 1);
}
function stepRipple(h, dt) {
  const A = h.arms;
  const R = A.ripple;
  if (!R) return;
  R.t -= dt;
  while (R.left > 0 && R.t <= 0 && A.rockets > 0) {
    const S = ROCKETS.hydra;
    const Ax = h.axes;
    let d = Ax.f.slice();
    if (R.dir && podsOff(h, R.dir, Ax) < 0.05) d = R.dir;
    const sp = S.spread * (1 + h.vibration);
    d = norm([d[0] + (h.rand() - 0.5) * 2 * sp, d[1] + (h.rand() - 0.5) * 2 * sp, d[2] + (h.rand() - 0.5) * 2 * sp]);
    A.pod = -A.pod;
    const from = heliToWorld(h, MOUNT.pod(A.pod), Ax);
    launch(armsCtx(h), { type: 'rocket', spec: S, p: from, v: d.map((x, i) => x * S.v0 + h.v[i]), owner: h, shooter: h, side: h.side });
    A.rockets--;
    A.fired.rockets++;
    R.left--;
    R.t += 0.12;
    h.event('heliRocket', { left: A.rockets });
  }
  if (R.left <= 0 || A.rockets <= 0) A.ripple = null;
}

/** A missile (kind 'atgm' | 'aam') at contact c, off its rail. */
export function fireMissile(h, kind, c) {
  const A = h.arms;
  if (!A || (A[kind] ?? 0) <= 0 || A.missileCd > 0 || h.crashed) return null;
  const S = MISSILES[kind];
  A[kind]--;
  A.fired[kind]++;
  A.missileCd = 1.5;
  A.rail = -A.rail;
  const Ax = h.axes;
  const from = heliToWorld(h, MOUNT.rail(A.rail), Ax);
  const d = norm([Ax.f[0], Ax.f[1] + 0.03, Ax.f[2]]);
  const m = launch(armsCtx(h), { type: 'missile', spec: S, p: from, v: d.map((x, i) => x * S.v0 + h.v[i]), owner: h, shooter: h, side: h.side, track: trackOf(c), target: c.ref ?? c, kind });
  h.event('heliMissile', { kind, at: c.kind ?? null });
  return m;
}

/** n flares (pairs, left and right) from the dispensers aft, thrown out and down. */
export function dropFlares(h, n = 2) {
  const A = h.arms;
  if (!A || A.flares <= 0 || A.flareCd > 0 || h.crashed) return 0;
  const Ax = h.axes;
  let k = 0;
  for (let i = 0; i < n && A.flares > 0; i++) {
    const s = i % 2 ? 1 : -1;
    const from = heliToWorld(h, MOUNT.flare(s), Ax);
    const out = [Ax.r[0] * s * 18 - Ax.u[0] * 6 - Ax.f[0] * 4, Ax.r[1] * s * 18 - Ax.u[1] * 6 - 4, Ax.r[2] * s * 18 - Ax.u[2] * 6 - Ax.f[2] * 4];
    launch(armsCtx(h), { type: 'flare', spec: FLARE, p: from, v: out.map((x, j) => x + h.v[j] * 0.6), owner: h, side: h.side });
    A.flares--;
    A.fired.flares++;
    k++;
  }
  A.flareCd = 0.45;
  if (k) h.event('heliFlares', { left: A.flares });
  return k;
}

/** The missiles in the air tracking h (not pulled off by a flare): its missile warning. */
export function missileWarning(h) {
  const w = h.world;
  return (w.ordnance ?? []).filter((g) => g.type === 'missile' && !g.done && g.track?.ref === h && !g.track.flare);
}

/* ------------------------------------------------------------------ each step */

/**
 * Cool-downs, the rocket ripple, the seeker's lock on h.arms.lockOn (the contact a missile is to
 * go to: the nose kept on it for MISSILES[kind].lock s), and, flown by you, your triggers.
 */
export function stepArms(h, dt) {
  const A = h.arms;
  if (!A) return;
  if (A.gun) A.gun.cd = Math.max(-dt, A.gun.cd - dt); // (a long step: the rounds of it, not a stored-up burst)
  A.missileCd = Math.max(0, A.missileCd - dt);
  A.flareCd = Math.max(0, A.flareCd - dt);
  stepRipple(h, dt);
  if (h.crashed) return;
  stepLock(h, dt);
  if (h.player) stepPlayerArms(h, dt);
}

/** The lock: the contact h.arms.lockOn ({ c, kind }) within the seeker's cone of the nose and in sight. */
function stepLock(h, dt) {
  const A = h.arms;
  const want = A.lockOn;
  if (!want?.c) {
    A.lock = null;
    return;
  }
  const S = MISSILES[want.kind];
  const st = contactState(want.c);
  const r = sub(st.p, h.toWorld([1, 1, 0]));
  const d = len(r);
  const off = Math.acos(clamp(dot(norm(r), h.axes.f), -1, 1));
  const key = want.c.key ?? want.c.ref;
  const sees = !h.host.sees || h.host.sees(h.toWorld([3.5, 1.2, 0]), st.look ?? st.p);
  if (off < S.cone && d < S.range && d > S.minRange * 0.5 && sees) {
    if (A.lock?.key !== key || A.lock.kind !== want.kind) A.lock = { key, c: want.c, kind: want.kind, t: 0 };
    A.lock.t += dt;
    A.lock.locked = A.lock.t >= S.lock;
  } else if (A.lock) {
    A.lock.t = Math.max(0, A.lock.t - dt * 2);
    A.lock.locked = false;
  }
}

/**
 * Flown by you (h.armsInput from walk/heliFlight.js): the gun held (Space): the turret onto the
 * hostile the crew have identified nearest the nose (within 25°), else along the nose, at its range;
 * rockets (a click): a pair along the nose; a missile (T): at the contact nearest the nose once
 * locked (a heat seeker at a helicopter, the anti-tank missile at a vehicle); flares (F).
 */
function stepPlayerArms(h, dt) {
  const A = h.arms;
  const I = (h.armsInput ??= {});
  const near = nearestToNose(h, 0.45);
  A.cue = near;
  // the missile for it, locking while the nose is on it
  if (near) {
    const kind = near.kind === 'heli' ? (A.aam > 0 ? 'aam' : null) : near.kind === 'car' || near.kind === 'boat' ? (A.atgm > 0 ? 'atgm' : null) : null;
    A.lockOn = kind ? { c: near, kind } : null;
  } else A.lockOn = null;
  if (I.gun && A.gun) {
    let dir = h.axes.f;
    if (near) {
      const st = contactState(near);
      dir = aimSolution(heliToWorld(h, MOUNT.gun), h.v, A.gun.spec, st.p, st.v).dir;
      if (!turretBears(h, dir)) dir = h.axes.f;
    } else {
      // (boresighted at 600 m: a little up for the drop)
      const f = h.axes.f;
      dir = norm([f[0], f[1] + 0.5 * G * (600 / A.gun.spec.v0) ** 2 / 600 - 0.02, f[2]]);
    }
    fireGun(h, dir, 1);
  }
  if (I.rockets) {
    I.rockets = false;
    if (A.rockets > 0) fireRockets(h, 2);
  }
  if (I.missile) {
    I.missile = false;
    if (A.lock?.locked) fireMissile(h, A.lock.kind, A.lock.c);
  }
  if (I.flares) {
    I.flares = false;
    dropFlares(h, 2);
  }
}

/** The identified hostile nearest the nose (within `cone` rad), or null. */
export function nearestToNose(h, cone = 0.45) {
  let best = null, bo = cone;
  const f = h.axes.f;
  for (const kn of h.known.values()) {
    const c = kn.c;
    if (!hostile(h.side, c.side) || c.ref?.crashed || c.ref?.dead) continue;
    const st = contactState(c);
    const r = sub(st.p, h.p);
    const off = Math.acos(clamp(dot(norm(r), f), -1, 1));
    if (off < bo) {
      bo = off;
      best = c;
    }
  }
  return best;
}
