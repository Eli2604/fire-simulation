/**
 * An armed helicopter's pilot in a fight (ai/helicopter.js mission 'hunt'; its weapons
 * ai/heliArms.js). It patrols round its zone (h.lz, h.orbitR), and goes for what its crew have
 * identified (h.known: helicopters, cars and boats with hostile men in them or marked hostile,
 * soldiers, you) within its reach (h.engageR), the most dangerous first (one shooting at it, a
 * helicopter, a vehicle with a mounted gun). Which weapon and how (the profile):
 *
 *   'dogfight'    a helicopter: a turning fight; it keeps its height over the other (energy), cuts
 *                 inside its turn to get behind it, the chin gun (turreted: it need not point its
 *                 nose exactly) with lead at its range, a heat seeker once locked (the nose on it).
 *   'standoff'    a vehicle or a boat with anti-tank missiles (or the gun, from further out than
 *                 their guns reach): it holds off at a standoff range, low behind what is between
 *                 (terrain masking: down to a few metres over the ground), pops up until it sees the
 *                 target, locks and fires, and drops back down.
 *   'rocketDive'  rockets: from height and range a shallow dive at it, the nose on it, a ripple at
 *                 the rockets' range, then a break away and back round (extend).
 *   'gunRun'      the gun only: in at speed, bursts from its range, break off short of it, extend.
 *
 * Defending itself: a missile tracking it (heliArms missileWarning): flares (a heat seeker's, in
 * pairs every half second while it comes), a hard break across its path and down; rounds cracking
 * past and hits: jinking (its way offset side to side) and, out of a dogfight, a break-off. Out of
 * everything to fight with, or badly hurt (its integrity, a fire, a leak, an engine smoking): it
 * radios it and goes home (h.home: a 'land' mission there).
 *
 *   stepCombat(h, dt)       each step while its mission is 'hunt' (flies it: h.fly)
 *   pickCombatTarget(h)     the contact it goes for, or null
 *   profileFor(h, c)        how it attacks c
 *   stepDefence(h, dt)      flares against what is coming (any armed helicopter, any mission, also yours)
 */
import { HELI } from './helicopter.js';
import { hostile } from './sides.js';
import { MISSILES, ROCKETS, aimSolution, turretBears, podsOff, fireGun, fireRockets, fireMissile, dropFlares, missileWarning, contactState, hasOffence, MOUNT } from './heliArms.js';
import { heliToWorld } from './helicopter.js';
import { vehicleKind } from './vehicleSides.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const hyp = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The numbers of its tactics. */
export const COMBAT = {
  engageR: 2600, // m: what it goes for
  dogfightGunR: 1000, // m: the gun against a helicopter
  gunR: 1300, // m: the gun against the ground
  breakR: 320, // m: a gun or rocket run breaks off this short of its target
  extendR: 900, // m: and runs out this far before it comes round again
  standoff: { atgm: 2400, gun: 1100, rockets: 1300, vsMounted: 1550 },
  maskAgl: 6, // m over the ground, masked
  popAgl: 22, // m: up to here at least to fire
  burst: 8, // rounds a burst
  burstPause: 0.6, // s
  hurt: 0.5, // integrity under which it goes home
};

const W_KIND = { heli: 3, car: 1.6, boat: 1.4, player: 1.3, soldier: 0.7, dragon: 2, target: 0.5 };
const mounted = (c) => !!(c.ref?.gun || c.ref?.mountedGun || c.ref?.params?.mountedGun && c.ref.params.mountedGun !== 'none');

/** The identified hostile it goes for (or keeps on): { c, score } or null. */
export function pickCombatTarget(h) {
  let best = null, bs = 0;
  const cur = h.combat?.target;
  for (const kn of h.known.values()) {
    const c = kn.c;
    if (!hostile(h.side, c.side) || c.ref?.crashed || (c.ref?.failure && c.ref.mode === 'falling') || c.ref?.dead || c.ref?.wrecked || c.ref?.body?.sunk || c.ref?.armsWreck) continue;
    const st = contactState(c);
    const d = hyp(st.p, h.p);
    if (d > (h.engageR ?? COMBAT.engageR)) continue;
    // (only what it has something for)
    if (!profileFor(h, c)) continue;
    const sc = (W_KIND[c.kind] ?? 1) * (h.attacking(c) ? 3 : 1) * (mounted(c) ? 1.6 : 1) * ((cur?.key ?? cur?.ref) === (c.key ?? c.ref) ? 1.5 : 1) / (1 + d / 900);
    if (sc > bs) {
      bs = sc;
      best = c;
    }
  }
  return best;
}

/** How it goes for contact c with what it has left: a profile and its weapon, or null. */
export function profileFor(h, c) {
  const A = h.arms;
  if (!A) return null;
  const gun = (A.gun?.ammo ?? 0) > 0;
  if (c.kind === 'heli') {
    if (A.aam > 0 || gun) return { kind: 'dogfight', weapon: A.aam > 0 ? 'aam' : 'gun' };
    return null;
  }
  const vehicle = c.kind === 'car' || c.kind === 'boat';
  if (vehicle && A.atgm > 0) return { kind: 'standoff', weapon: 'atgm' };
  if (A.rockets > 0 && (vehicle || c.kind === 'soldier' || c.kind === 'player')) return { kind: 'rocketDive', weapon: 'rockets' };
  if (gun) return { kind: h.attackStyle === 'gunRun' ? 'gunRun' : 'standoff', weapon: 'gun' };
  return null;
}

/** Hurt enough to go home (or on fire, leaking, its engine smoking hard). */
function badlyHurt(h) {
  return h.integrity < COMBAT.hurt || h.fire > 0 || h.leak > 0.35 || h.smoke > 0.7 || (h.dmg.tailRotor ?? 0) > 0.6 || (h.dmg.rotor ?? 0) > 0.7;
}

/** Home: a 'land' mission to h.home (the troops, if any, stay aboard). */
export function returnToBase(h, why) {
  const C = h.combat;
  C.phase = 'rtb';
  C.target = null;
  C.why = why;
  h.arms.lockOn = null;
  h.radio(why === 'winchester' ? 'winchester, returning to base' : 'taking damage, breaking off, returning to base');
  h.event('heliRTB', { why });
  h.lz = h.home.slice();
  h.mission = 'land';
  h.next = null;
  h.setMode('transit');
}

/**
 * Each step on a 'hunt' (ai/helicopter.js stepMission, its modes 'transit' to the zone, then
 * 'hunt'): defend, pick, attack, fire.
 */
export function stepCombat(h, dt) {
  const C = (h.combat ??= { phase: 'patrol', t: 0, jink: 1, jinkT: 0, burst: 0, burstT: 0, mask: 0 });
  C.t += dt;
  h.doorsWant = { L: 0, R: 0 };
  const lzY = h.lzY();
  const gy = h.ground(h.p[0], h.p[2]);
  // out of it all, or too badly hurt: home
  if (!hasOffence(h)) return returnToBase(h, 'winchester');
  if (badlyHurt(h)) return returnToBase(h, 'damage');
  // under fire: jink (its way offset to and fro); a missile coming: break and flares (stepDefence)
  const now = h.world.time ?? h.time;
  const shotAt = h.attacks.filter((a) => now - a.t < 2).length;
  const warn = missileWarning(h);
  C.jinkT -= dt;
  if (C.jinkT <= 0) {
    C.jink = -C.jink;
    C.jinkT = 1 + h.rand() * 1.2;
  }
  if (warn.length) {
    const m = warn.reduce((a, b) => (len(sub(a.p, h.p)) < len(sub(b.p, h.p)) ? a : b));
    // across its path (the side it is already going), and down towards the ground
    const r = norm([h.p[0] - m.p[0], 0, h.p[2] - m.p[2]]);
    const s = Math.sign(r[0] * h.v[2] - r[2] * h.v[0]) || 1;
    const across = [-r[2] * s, 0, r[0] * s];
    C.phase = C.phase === 'evade' ? 'evade' : 'evade';
    C.evadeT = 2.5;
    return h.fly(dt, { to: [h.p[0] + across[0] * 400 + r[0] * 150, 0, h.p[2] + across[2] * 400 + r[2] * 150], speed: h.cruise, y: gy + 12, sink: 9 });
  }
  if (C.phase === 'evade') {
    C.evadeT -= dt;
    if (C.evadeT > 0) {
      const v = norm([h.v[0], 0, h.v[2]]);
      return h.fly(dt, { to: [h.p[0] + v[0] * 300 + -v[2] * 120 * C.jink, 0, h.p[2] + v[2] * 300 + v[0] * 120 * C.jink], speed: h.cruise, y: gy + 15 });
    }
    C.phase = C.target ? 'attack' : 'patrol';
  }
  // the target
  const T = pickCombatTarget(h);
  if ((T?.key ?? T?.ref) !== (C.target?.key ?? C.target?.ref)) {
    C.target = T;
    C.profile = T ? profileFor(h, T) : null;
    C.sub = null;
    C.subT = 0;
    if (T) {
      h.event('heliEngage', { what: T.kind, profile: C.profile?.kind });
      if (C.phase !== 'extend') C.phase = 'attack';
    } else C.phase = 'patrol';
  } else if (T) C.profile = profileFor(h, T) ?? C.profile;
  if (!T) {
    h.arms.lockOn = null;
    // the patrol: round the zone
    return h.fly(dt, { orbit: { c: h.lz, R: h.orbitR }, speed: Math.min(h.cruise, 32, Math.sqrt(HELI.accel * 0.8 * h.orbitR)), y: lzY + h.altitude });
  }
  const st = contactState(T);
  const d = hyp(st.p, h.p);
  C.dist = d;
  // (shot at, out of a dogfight: break off and come round again)
  if (shotAt >= 3 && C.profile?.kind !== 'dogfight' && C.phase === 'attack' && (C.sub !== 'fire' || C.profile?.kind !== 'standoff') && h.rand() < dt * 1.5) startExtend(h, st.p, 'shot at');
  if (C.phase === 'extend') return stepExtend(h, dt, st, d, gy);
  switch (C.profile?.kind) {
    case 'dogfight':
      return dogfight(h, dt, T, st, d, gy);
    case 'standoff':
      return standoff(h, dt, T, st, d, gy);
    case 'rocketDive':
      return rocketDive(h, dt, T, st, d, gy);
    default:
      return gunRun(h, dt, T, st, d, gy);
  }
}

/** Away from p to COMBAT.extendR, climbing, then round again. */
function startExtend(h, p, why) {
  const C = h.combat;
  const away = norm([h.p[0] - p[0], 0, h.p[2] - p[2]]);
  // (off to one side of straight away: a break turn)
  const s = h.rand() < 0.5 ? -1 : 1;
  const dir = norm([away[0] + -away[2] * 0.6 * s, 0, away[2] + away[0] * 0.6 * s]);
  C.phase = 'extend';
  C.extendTo = [p[0] + dir[0] * COMBAT.extendR, 0, p[2] + dir[2] * COMBAT.extendR];
  C.extendT = 0;
  C.why = why;
  h.arms.lockOn = null;
  h.event('heliBreak', { why });
}
function stepExtend(h, dt, st, d, gy) {
  const C = h.combat;
  C.extendT += dt;
  const e = C.extendTo;
  h.fly(dt, { to: [e[0] + (e[0] - h.p[0]) * 0.5, 0, e[2] + (e[2] - h.p[2]) * 0.5], speed: h.cruise, y: Math.max(gy + 30, st.p[1] + 40) });
  if (hyp(h.p, e) < 120 || C.extendT > 25 || d > COMBAT.extendR * 1.3) {
    C.phase = 'attack';
    C.sub = null;
  }
}

/** Bursts from the chin gun at contact T while it bears, in range (and nothing friendly near the line). */
function gunAt(h, dt, T, st, range) {
  const A = h.arms;
  const g = A.gun;
  const C = h.combat;
  if (!g || g.ammo <= 0) return false;
  const from = heliToWorld(h, MOUNT.gun);
  const r = len(sub(st.p, from));
  if (r > range || r < 30) return false;
  const sol = aimSolution(from, h.v, g.spec, st.p, st.v);
  if (!turretBears(h, sol.dir)) return false;
  if (h.host.sees && !h.host.sees(from, st.look ?? st.p)) return false;
  if (h.friendlyInLine(from, st.p, h.contactsNow ?? [])) return false;
  g.dirWant = sol.dir;
  C.burstT -= dt;
  if (C.burstT > 0) return false;
  // aimed fire: the pilot's skill in it (a recruit's spread twice a veteran's)
  const sk = { recruit: 2, regular: 1.4, veteran: 1, elite: 0.8 }[h.pilotSkill ?? 'veteran'] ?? 1;
  let fired = false;
  while (g.cd <= 0 && g.ammo > 0) {
    if (!fireGun(h, sol.dir, sk)) break;
    fired = true;
    C.burst++;
    if (C.burst >= COMBAT.burst) {
      C.burst = 0;
      C.burstT = COMBAT.burstPause * (0.7 + h.rand() * 0.6);
      break;
    }
  }
  return fired;
}

/** A missile at T once the seeker has it (the nose on it for its lock time). */
function missileAt(h, kind, T, d) {
  const A = h.arms;
  const S = MISSILES[kind];
  if ((A[kind] ?? 0) <= 0 || d > S.range || d < S.minRange) {
    if (A.lockOn?.kind === kind) A.lockOn = null;
    return false;
  }
  A.lockOn = { c: T, kind };
  // (one at a time: the last one still flying at it, wait)
  const flying = (h.world.ordnance ?? []).some((g) => g.type === 'missile' && g.owner === h && !g.done && g.target === (T.ref ?? T) && !g.track?.flare);
  if (A.lock?.locked && A.missileCd <= 0 && !flying) return !!fireMissile(h, kind, T);
  return false;
}

/** Against a helicopter: behind it and above, the gun from its range, a heat seeker when locked. */
function dogfight(h, dt, T, st, d, gy) {
  const tv = [st.v[0], 0, st.v[2]];
  const ts = len(tv);
  const f = ts > 4 ? norm(tv) : norm([h.p[0] - st.p[0], 0, h.p[2] - st.p[2]]).map((x) => -x);
  // a point behind it (closer in as it gets near: inside its turn), led by where it is going
  const back = clamp(d * 0.35, 80, 220);
  const lead = clamp(d / 60, 0.5, 4);
  const goal = [st.p[0] + st.v[0] * lead - f[0] * back, 0, st.p[2] + st.v[2] * lead - f[2] * back];
  const far = d > 900;
  const y = Math.max(gy + 25, st.p[1] + (far ? 40 : 15));
  // the nose on it when close (the gun and the seeker), else along its way to the goal
  const bearing = Math.atan2(st.p[0] - h.p[0], st.p[2] - h.p[2]);
  const face = d < 1100 ? bearing : undefined;
  const C = h.combat;
  const jink = h.attacks.length && (h.world.time ?? h.time) - h.attacks[h.attacks.length - 1].t < 2 ? C.jink * 35 : 0;
  // (on through the goal: it should not stop there)
  const ahead = norm([goal[0] - h.p[0], 0, goal[2] - h.p[2]]);
  h.fly(dt, { to: [goal[0] + ahead[0] * 200 - ahead[2] * jink, 0, goal[2] + ahead[2] * 200 + ahead[0] * jink], speed: far ? h.cruise : clamp(ts + 8, 18, h.cruise), y, face });
  if (h.arms.aam > 0) missileAt(h, 'aam', T, d);
  gunAt(h, dt, T, st, COMBAT.dogfightGunR);
}

/**
 * From a standoff range, masked low behind what is between, up to fire (the ATGM: locked and
 * launched; the gun: bursts; rockets: a ripple), back down.
 */
function standoff(h, dt, T, st, d, gy) {
  const C = h.combat;
  const w = C.profile.weapon;
  // (beyond the reach of a gun mounted on it)
  const R = w === 'gun' && mounted(T) ? COMBAT.standoff.vsMounted : COMBAT.standoff[w] ?? 1100;
  // where it holds: on its side of the target, at R
  const away = norm([h.p[0] - st.p[0], 0, h.p[2] - st.p[2]]);
  const hold = [st.p[0] + away[0] * R, 0, st.p[2] + away[2] * R];
  const bearing = Math.atan2(st.p[0] - h.p[0], st.p[2] - h.p[2]);
  const groundAt = h.ground(hold[0], hold[2]);
  C.sub ??= 'move';
  C.subT += dt;
  if (C.sub === 'move') {
    const dd = hyp(h.p, hold);
    h.fly(dt, { to: hold, speed: h.cruise, y: Math.max(groundAt, gy) + (dd > 500 ? 30 : COMBAT.maskAgl + 4), face: dd < 400 ? bearing : undefined });
    if (dd < 150) {
      C.sub = 'mask';
      C.subT = 0;
    }
    if (d < R * 0.45) startExtend(h, st.p, 'too close');
    return;
  }
  if (C.sub === 'mask') {
    // down low, still, facing it: a few seconds (it comes up somewhere a little different)
    h.fly(dt, { to: hold, speed: 6, y: gy + COMBAT.maskAgl, face: bearing });
    if (C.subT > 2 + h.rand() * 0.5) {
      C.sub = 'popup';
      C.subT = 0;
    }
    return;
  }
  if (C.sub === 'popup') {
    const sees = !h.host.sees || h.host.sees(h.toWorld([3.5, 1.2, 0]), st.look ?? st.p);
    h.fly(dt, { to: hold, speed: 4, y: gy + (sees ? Math.max(COMBAT.popAgl, h.p[1] - gy) : h.p[1] - gy + 10), face: bearing });
    if ((sees && h.p[1] - gy >= COMBAT.popAgl - 2) || C.subT > 12) {
      C.sub = 'fire';
      C.subT = 0;
      C.shots = 0;
    }
    return;
  }
  // fire: hover, the nose on it
  h.fly(dt, { to: hold, speed: 3, y: h.p[1], face: bearing });
  let done = false;
  if (w === 'atgm') {
    if (missileAt(h, 'atgm', T, d)) done = true;
  } else if (w === 'rockets') {
    if (h.arms.rockets > 0 && podsOff(h, aimSolution(heliToWorld(h, MOUNT.pod(1)), h.v, ROCKETS.hydra, st.p, st.v).dir) < 0.03 && !h.arms.ripple) {
      fireRockets(h, 4, aimSolution(heliToWorld(h, MOUNT.pod(1)), h.v, ROCKETS.hydra, st.p, st.v).dir);
      done = true;
    }
  } else if (gunAt(h, dt, T, st, COMBAT.gunR + 400)) C.shots = (C.shots ?? 0) + 1;
  // up long enough (or it fired): down again
  if (done || C.subT > (w === 'gun' ? 4 : 7)) {
    C.sub = 'mask';
    C.subT = 0;
  }
}

/** A shallow dive at it from height and range, the nose on it, a ripple at the rockets' range; break, extend. */
function rocketDive(h, dt, T, st, d, gy) {
  const C = h.combat;
  const bearing = Math.atan2(st.p[0] - h.p[0], st.p[2] - h.p[2]);
  const toT = norm([st.p[0] - h.p[0], 0, st.p[2] - h.p[2]]);
  if (d < COMBAT.breakR + 150) return startExtend(h, st.p, 'rocket run done');
  // the height: up for the run-in, then down the slope to it (~6°)
  const y = d > 1700 ? Math.max(gy + 40, st.p[1] + 120) : Math.max(gy + 18, st.p[1] + d * 0.1);
  h.fly(dt, { to: [st.p[0] + toT[0] * 200, 0, st.p[2] + toT[2] * 200], speed: d > 1500 ? h.cruise : h.cruise * 0.8, y, sink: 8, face: d < 2000 ? bearing : undefined });
  if (d < 1500 && d > ROCKETS.hydra.minRange + 200 && h.arms.rockets > 0 && !h.arms.ripple && (C.salvoT = (C.salvoT ?? 0) - dt) <= 0) {
    const sol = aimSolution(heliToWorld(h, MOUNT.pod(1)), h.v, ROCKETS.hydra, st.p, st.v);
    if (podsOff(h, sol.dir) < 0.03) {
      fireRockets(h, 4, sol.dir);
      C.salvoT = 2.5;
    }
  }
  gunAt(h, dt, T, st, COMBAT.gunR);
}

/** In at speed with the gun, bursts from its range, break short of it. */
function gunRun(h, dt, T, st, d, gy) {
  const bearing = Math.atan2(st.p[0] - h.p[0], st.p[2] - h.p[2]);
  const toT = norm([st.p[0] - h.p[0], 0, st.p[2] - h.p[2]]);
  if (d < COMBAT.breakR) return startExtend(h, st.p, 'gun run done');
  const y = d > 1500 ? Math.max(gy + 35, st.p[1] + 80) : Math.max(gy + 15, st.p[1] + d * 0.07);
  h.fly(dt, { to: [st.p[0] + toT[0] * 300, 0, st.p[2] + toT[2] * 300], speed: h.cruise * 0.85, y, sink: 7, face: d < 1600 ? bearing : undefined });
  gunAt(h, dt, T, st, COMBAT.gunR);
}

/**
 * Its defence on any mission (also yours: the warning on the HUD, the flares are your F): a heat
 * seeker coming at it: flares, a pair every half second while it comes (its own pilot); and the
 * gun at what threatens it from within the turret's reach (an armed helicopter on another mission).
 */
export function stepDefence(h, dt) {
  const A = h.arms;
  if (!A || h.crashed) return;
  const warn = missileWarning(h);
  A.warning = warn.length ? warn.map((g) => ({ kind: g.kind, d: len(sub(g.p, h.p)) })) : null;
  if (h.player) return;
  // (a program: two pairs at once, then a pair every 1.2 s while it comes)
  if (warn.some((g) => g.spec?.ir && len(sub(g.p, h.p)) < 3000)) {
    if ((A.flareProg = (A.flareProg ?? 0) - dt) <= 0) {
      const first = !A.warnedT || (h.world.time ?? h.time) - A.warnedT > 3;
      dropFlares(h, first ? 4 : 2);
      A.flareProg = 1.2;
    }
    A.warnedT = h.world.time ?? h.time;
  }
  if (h.mission === 'hunt' || !A.gun || A.gun.ammo <= 0) return;
  // (on another mission: the gun at whatever hostile it has identified that is shooting at it, in reach)
  for (const kn of h.known.values()) {
    const c = kn.c;
    if (!hostile(h.side, c.side) || !h.attacking(c)) continue;
    h.combat ??= { phase: 'patrol', t: 0, jink: 1, jinkT: 0, burst: 0, burstT: 0 };
    const st = contactState(c);
    if (gunAt(h, dt, c, st, COMBAT.gunR)) break;
  }
}

export { vehicleKind };
