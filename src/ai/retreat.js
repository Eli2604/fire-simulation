/**
 * The retreat: a squad strategy (ai/strategy.js, on top of ai/squad.js) for getting out of a fight
 * it cannot win, man by man, under its own covering fire. Pure logic, no three.js.
 *
 *  - When: ordered (the squad model's strategy param 'retreat', host.retreat.order, or
 *    orderRetreat(sq) at any time), or chosen by the leader (retreatWanted, unless auto is off:
 *    ai/retreatRadio.js retreatCase weighs it and logs why): the commander down, heavy casualties,
 *    outgunned (vehicles, a helicopter, the dragon count for several men), flanked, pinned down,
 *    low on ammunition. Plain numbers, two to one: the older 'withdraw' (team by team) still
 *    breaks contact. There is no button for it: the squad decides by itself.
 *  - The word (ai/retreatRadio.js): the leader shouts it and gives the hand signal; men who hear
 *    or see it, or get it passed on by the next man, acknowledge; no man peels back before he has
 *    it. Then the radio man calls it in to the other friendly teams, who cover them or adjust.
 *  - Where to: the rally point. A param (host.retreat.rally / the model's rally offset from where
 *    they started), else the squad's deploy point (sq.home) if that lies behind them, else a
 *    point ~20 m back from the threat, out of its sight if there is one. Each man has his slot
 *    there (a line across the way the threat lies, 1.3 m apart).
 *  - Or a vehicle (ai/squadVehicle.js; ai/vehicles.js wraps helicopters, boats, cars): one near
 *    them, standing still, with a seat for every man going (the wounded too) and not out towards the
 *    threat (param vehicle: false rules it out). Then the rally point is the vehicle and each slot a
 *    guard post round it; once all are back they board it one by one (the wounded lifted in first,
 *    the rest guarding, the first in firing from where the seats allow) and it takes them off.
 *  - (a) Peeling back by bounding overwatch: one man at a time leaves his cover (the one nearest
 *    the enemy first) for the next cover behind the rearmost man (ai/squad.js covers: free cells
 *    by something solid between them and the threat), or his slot at the rally point when that is
 *    within a bound. The others stay put and fire at the enemies they see (ai/perception.js, the
 *    squad's sq.seen; else the threat): the squad's own covering fire (ai/squad.js, bursts with
 *    hardly a pause: the base of fire's rate). He shouts "Moving!", a coverer "Covering!"; set in
 *    his new cover, "Set!", and the next goes. A man moves only while another covers; the last
 *    man alone goes when there is no one left to wait for. A short bound he backs off with his
 *    weapon up ('aimWalkBack', facing the threat); a long one he backs off a step, turns, runs
 *    ('run'), and turns to face it again for the last metres.
 *  - (b) A man down (ai/casualty.js puts him down; the rescue it would mount is the retreat's
 *    business now): the leader decides (decideCasualty) by the params (host.retreat.casualties:
 *    'carry' | 'leave' | 'auto') and, for 'auto', by the best carrier's experience, how close
 *    the enemy is to him, whether he can still fight, how badly he is hurt, and how many are left:
 *      carry  the carrier runs to him, puts his weapon away (slung: m.slung, the figure's put-away
 *             on its carry slot, operator/drive.js), drops his pack (the staged pack-off clip,
 *             host.dropPack), lifts him into a fireman's carry across his shoulders ('liftCasualty'
 *             / 'lifted') and walks him back to the rally point at a slow walk, unable to shoot
 *             ('fireCarry' / 'carried': the casualty's root rides on the carrier's, turned across
 *             him), while the others peel back round him; there he puts him down
 *             ('putDownCasualty' / 'setDown') and takes his weapon up again.
 *      leave  he stays where he lies. If he can still fight (a weapon, rounds, not dying) he gives
 *             covering fire for as long as he can: prone, bursts at what he sees, his aim the worse
 *             for his wounds (WOUND_SCATTER), reloading slowly, until he is out of rounds or dead.
 *  - (c) The tripwire: the last man back through a doorway (doorwaysOn: a gap in a wall on his
 *    way, narrow, with room on both sides; the world's doors, host.doorways, when the host has
 *    them) stops just past it, slings his weapon, kneels and strings a wire across it at ankle
 *    height with a charge fixed to the frame ('setTripwire': the charge out of the pouch and onto
 *    the jamb, the wire across, tied off), takes his weapon up and moves on. Once he is clear it is
 *    armed (sq.traps, host.trap(trap) to draw it): a hostile (host.hostiles()) whose feet cross the
 *    wire sets it off: host.explode(charge, WIRE_E, { name: 'tripwire', trap, who }) (in the
 *    simulation: sim/explosions.js explode, sim/impact.js shockwave, fragments into you). The
 *    squad's own men step over it.
 *
 * State: sq.strategy.rt { rally, slots, mover, setT, jobs (carries), wires }, each man's m.rt
 * { role: cover | move | rally | carry | carried | left | wire, ... }; actors (moving, carrying,
 * carried, left behind, wiring) have m.rescueRole 'retreat' so the squad's own per-man step leaves
 * them to this; the coverers have none and fight as the squad does.
 */
import { roundsLeft, aimPoint, spend, weaponKind, skillOf, canShoot, TIMES } from './soldier.js';
import { exposedTo, srand } from './strategy.js';
import { retreatCase, startWord, stepWord, hasWord } from './retreatRadio.js';
import { vehicleForRetreat, guardSlots, startBoarding, goingMen, vnote } from './squadVehicle.js';

/** Durations of the retreat's clips (operator/rig.js RETREAT_CLIPS bakes them at these). */
export const RT_T = { lift: 2.6, putDown: 2.2, wire: 5.2, stow: 0.8, pack: 4.2, signal: 2.0 };
/** Ground speeds (m/s): backing off aiming, running, the fireman's carry. */
export const RT_SPEED = { back: 1.0, run: 3.4, carry: 0.85 };
const LEG_MAX = 11, LEG_MIN = 3; // m: a bound
const SET_T = 0.7; // s: set in cover, then the next man goes
const RALLY_R = 1.6; // m: at his slot
export const WIRE_E = 1.0e6; // J: the charge on the wire (~0.2 kg of explosive)
export const WIRE_H = 0.15; // m: the wire above the floor
const WOUND_SCATTER = 0.05; // m of scatter a metre of range, at the worst, a wounded man's aim
export const RETREAT_DEFAULTS = { order: false, auto: true, rally: null, casualties: 'auto', tripwire: true, wires: 1, dropPack: true, vehicle: 'auto' };
const SKILL_CARRY = { recruit: -0.35, regular: 0, veteran: 0.3, elite: 0.45 };
const NAME = { CMD: 'the commander', MG: 'the gunner', R1: 'rifleman one', R2: 'rifleman two', UAV: 'the drone operator' };
const d2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const cen = (l) => l.reduce((c, m) => [c[0] + m.p[0] / l.length, c[1] + m.p[1] / l.length, c[2] + m.p[2] / l.length], [0, 0, 0]);

/** The retreat's params: defaults, the squad model's (on its men: m.retreat), the host's, an order given since. */
export function retreatOpts(sq) {
  const m0 = sq.members().find((m) => m.retreat) ?? {};
  return { ...RETREAT_DEFAULTS, ...(m0.retreat ?? {}), ...(sq.host.retreat ?? {}), ...(sq.retreatOrder ?? {}) };
}

/** Order the squad back (to rally, or the rally point it would pick; why: what is said): looked at again at once. */
export function orderRetreat(sq, rally = null, why = null) {
  sq.retreatOrder = { order: true, ...(rally ? { rally } : {}), ...(why ? { why } : {}) };
  if (sq.strategy) sq.strategy.dirty = true;
  sq.stratT = 0;
}

/** Can a man down still fight: a weapon in his hands, rounds, not dying, an arm to hold it. */
export function canStillFight(m) {
  if (m.dead || m.unarmed || m.canFire === false || ['knife', 'fists', 'torch'].includes(m.weapon)) return false;
  if ((m.health ?? 100) < 12 || (m.wounds?.armL && m.wounds?.armR)) return false;
  return roundsLeft(m) > 0;
}

/**
 * Should the leader pull them out (ai/strategy.js choose)? { why } or null. The case for it (every
 * reason that holds, the facts) is kept on sq.retreatWhy (ai/retreatRadio.js retreatCase).
 */
export function retreatWanted(sq, a) {
  const r = retreatCase(sq, a, retreatOpts(sq));
  sq.retreatWhy = r;
  return r ? { why: r.why } : null;
}

/* ------------------------------------------------------------------ the ground */

/** Where the rally point is (see the top). */
export function rallyPoint(sq, T) {
  const o = retreatOpts(sq);
  const al = sq.members().filter((m) => !m.dead);
  const c = cen(al.length ? al : sq.members());
  const snap = (p) => {
    const k = sq.nearestFree?.(p[0], p[2]);
    return k >= 0 ? sq.cellPos(k) : p.slice();
  };
  if (o.rally) return snap(o.rally);
  if (sq.home && d2(sq.home, T) > d2(c, T) + 4) return snap(sq.home);
  const dx = c[0] - T[0], dz = c[2] - T[2], l = Math.hypot(dx, dz) || 1;
  const [bx0, bz0, bx1, bz1] = sq.host.bounds ?? [-1e9, -1e9, 1e9, 1e9];
  const cl = (v, a, b) => Math.max(a + 1, Math.min(b - 1, v));
  let R = null;
  for (const back of [20, 15, 26, 11])
    for (const sw of [0, 4, -4, 8, -8]) {
      const q = snap([cl(c[0] + (dx / l) * back + (-dz / l) * sw, bx0, bx1), c[1], cl(c[2] + (dz / l) * back + (dx / l) * sw, bz0, bz1)]);
      R ??= q;
      if (!exposedTo(sq, T, q)) return q;
    }
  return R ?? c;
}

/** Each man's slot at the rally point R: a line across the way to the threat, 1.3 m apart. */
function slotsAt(sq, R, T, men) {
  const dx = R[0] - T[0], dz = R[2] - T[2], l = Math.hypot(dx, dz) || 1;
  const px = -dz / l, pz = dx / l;
  const slots = new Map();
  men.forEach((m, i) => {
    const o = (i - (men.length - 1) / 2) * 1.3;
    const k = sq.nearestFree?.(R[0] + px * o, R[2] + pz * o);
    slots.set(m, k >= 0 ? sq.cellPos(k) : [R[0] + px * o, R[1], R[2] + pz * o]);
  });
  return slots;
}

/**
 * The doorways on a way (from, then pts): where it goes through a gap in a wall, narrow (0.5..1.7
 * m between the jambs, across the way) with room on both sides of it (wider by a metre 1.3 m
 * before and after). { c: the middle, u: the way through (unit, along the way), n: across it,
 * w: its width }. With host.doorways (the world's doors), only gaps within 1.2 m of one.
 */
export function doorwaysOn(sq, from, pts) {
  const out = [];
  if (!sq.solidCell) return out;
  const cs = sq.cs;
  const solidAt = (x, z) => {
    const k = sq.cellOf(x, z);
    return k < 0 || !!sq.solidCell[k];
  };
  const reach = (p, n, max = 3) => {
    let s = 0;
    while (s < max && !solidAt(p[0] + n[0] * (s + cs * 0.5), p[2] + n[1] * (s + cs * 0.5))) s += cs * 0.5;
    return s;
  };
  const doors = sq.host.doorways?.() ?? null;
  let prev = from;
  for (const q of pts) {
    const L = d2(prev, q);
    if (L > 1e-3) {
      const dir = [(q[0] - prev[0]) / L, (q[2] - prev[2]) / L];
      for (let s = 0; s <= L; s += cs * 0.5) {
        const p = [prev[0] + dir[0] * s, q[1], prev[2] + dir[1] * s];
        if (out.some((g) => d2(g.c, p) < 1.6)) continue;
        // across the gap: the narrowest of across the way and the two grid axes (a way through a
        // door at a slant measures it wider than it is)
        let n = null, a = 0, b = 0, w = Infinity;
        for (const nn of [[-dir[1], dir[0]], [1, 0], [0, 1]]) {
          const aa = reach(p, [-nn[0], -nn[1]]), bb = reach(p, nn);
          if (aa + bb < w) (w = aa + bb), (a = aa), (b = bb), (n = nn);
        }
        if (w < 0.5 || w > 1.7) continue;
        // the way through it: square to the gap, the way he goes
        const sg = n[1] * dir[0] - n[0] * dir[1] >= 0 ? 1 : -1;
        const u = [n[1] * sg, -n[0] * sg];
        const wide = (k) => {
          const r = [p[0] + u[0] * k, p[1], p[2] + u[1] * k];
          return reach(r, [-n[0], -n[1]]) + reach(r, n) > w + 1;
        };
        if (!wide(1.3) || !wide(-1.3)) continue;
        const c = [p[0] + (n[0] * (b - a)) / 2, p[1], p[2] + (n[1] * (b - a)) / 2];
        if (doors && !doors.some((dp) => d2(dp.p ?? dp, c) < 1.2)) continue;
        out.push({ c, u, n, w });
      }
    }
    prev = q;
  }
  return out;
}

/* ------------------------------------------------------------------ deciding about a man down */

/**
 * Carry him or leave him (see the top): { how: 'carry' | 'leave', carrier, why }. fit: the men
 * standing. Deterministic (no dice): the same men in the same place, the same call.
 */
export function decideCasualty(sq, cas, fit, a = {}) {
  const o = retreatOpts(sq);
  const T = sq.threat;
  if (cas.dead) return { how: 'leave', why: 'dead' };
  // the carrier: the nearest, not the gunner if anyone else can (his gun covers best)
  const by = fit.filter((m) => m !== cas && m.squad !== 'UAV').sort((x, y) => d2(x.p, cas.p) - d2(y.p, cas.p));
  const carrier = by.find((m) => m.squad !== 'MG') ?? by[0];
  // (one to carry, one to cover: two men standing at least)
  if (by.length < 2) return { how: 'leave', why: 'no one to spare' };
  if (o.casualties === 'carry') return { how: 'carry', carrier, why: 'ordered' };
  if (o.casualties === 'leave') return { how: 'leave', why: 'ordered' };
  const fight = canStillFight(cas);
  const seen = sq.seen?.length ? sq.seen : T ? [{ p: T }] : [];
  const dE = seen.length ? Math.min(...seen.map((h) => d2(h.p, cas.p))) : 99;
  let s = 0.6 + (SKILL_CARRY[carrier.skill] ?? 0);
  s += dE < 8 ? -0.6 : dE < 14 ? -0.25 : 0; // the enemy right on him: no getting him out
  s += fight ? -0.35 : 0.35; // he can still hold them off; or he is helpless
  if ((cas.health ?? 100) < 12) s -= 0.4; // dying: little to gain either way
  if (by.length >= 3) s += 0.25; // men enough to cover a slow carry
  if ((a.enemies ?? seen.length) > by.length + 1) s -= 0.3;
  const why = s > 0.5 ? (fight ? 'we can get him out' : 'he cannot fight, we take him') : dE < 8 ? 'the enemy is on him' : fight ? 'he can cover us' : 'no way to get him out';
  return { how: s > 0.5 ? 'carry' : 'leave', carrier: s > 0.5 ? carrier : null, why, score: s };
}

/* ------------------------------------------------------------------ start */

/** The retreat put in hand (ai/strategy.js apply): the rally point, the slots, everyone covering. */
export function startRetreat(sq, P) {
  const T = sq.threat;
  // a rescue under way (ai/casualty.js) is the retreat's now
  if (sq.rescue) {
    for (const m of [sq.rescue.rescuer, sq.rescue.coverer]) if (m) Object.assign(m, { rescueRole: null, coverFire: false, path: null, arrived: true });
    if (!sq.rescue.cas.dead) sq.rescue.cas.rescueRole = 'casualty';
    sq.rescue = null;
  }
  sq.retreating = true;
  sq.phase = 'strategy';
  sq.moving = null;
  const men = sq.members().filter((m) => !m.dead && m.squad !== 'UAV');
  // a vehicle near them with seats for all (ai/squadVehicle.js): the rally point is beside it, each
  // man's slot his guard post round it; there they board it and it takes them off
  const VR = vehicleForRetreat(sq, goingMen(sq), T, retreatOpts(sq));
  const R = VR ? VR.V.p().slice() : rallyPoint(sq, T);
  P.rally = R;
  P.rt = { rally: R, slots: VR ? guardSlots(sq, VR.V, T, men) : slotsAt(sq, R, T, men), mover: null, setT: sq.time + 1.2, jobs: [], wires: 0, t0: sq.time, vehicle: VR?.V ?? null };
  // the word: the leader shouts it and signals it, his men pick it up (ai/retreatRadio.js)
  startWord(sq, P);
  if (VR) {
    const lead = sq.radioMan();
    if (lead && sq.time >= sq.silentUntil) sq.host.shout?.(lead, `To the ${VR.V.kind}! Fall back to the ${VR.V.kind}!`);
  }
  for (const m of men) {
    m.planRoute = null;
    m.path = null;
    m.group = null;
    if (m.down) continue; // (decided in the step)
    m.rt = { role: 'cover' };
    if (m.rescueRole !== 'casualty') m.rescueRole = null;
  }
  // the drone operator: back to the rally point first, his drone over them
  for (const u of sq.members().filter((m) => m.squad === 'UAV' && !m.dead)) sq.follow(u, sq.route(u.p, R, u, { avoid: T }), 'run', (q) => (q.arrived = true));
}

/* ------------------------------------------------------------------ the step */

/** Walk m along m.rt.way at sp (facing face if given, else the way he goes). True when there. */
function walkOn(sq, m, dt, sp, face) {
  const W = m.rt.way;
  while (W && m.rt.wi < W.length && d2(W[m.rt.wi], m.p) < 0.15) m.rt.wi++;
  if (!W || m.rt.wi >= W.length) {
    m.moving = false;
    m.speed = 0;
    return true;
  }
  const q = W[m.rt.wi];
  const dx = q[0] - m.p[0], dz = q[2] - m.p[2], l = Math.hypot(dx, dz);
  const s = Math.min(l, sp * dt);
  const x = m.p[0] + (dx / l) * s, z = m.p[2] + (dz / l) * s;
  m.p = [x, sq.host.floor(x, z, m) ?? m.p[1], z];
  m.moving = s > 1e-4;
  m.speed = sp;
  m.rt.done = (m.rt.done ?? 0) + s;
  if (face) sq.face(m, face, dt, 6);
  else sq.face(m, [m.p[0] + dx, m.p[1], m.p[2] + dz], dt, 8);
  return false;
}
const wayLen = (from, pts) => pts.reduce((s, p, i) => s + d2(p, i ? pts[i - 1] : from), 0);
function goTo(sq, m, to, role = 'move') {
  const pts = sq.route(m.p, to, m, { avoid: sq.threat, links: false });
  m.rt = { ...m.rt, role, to: to.slice(), way: pts, wi: 0, L: wayLen(m.p, pts), done: 0, gaps: doorwaysOn(sq, m.p, pts) };
  m.planRoute = [m.p.slice(), ...pts];
  m.rescueRole = 'retreat';
}
/** Covering: in cover or at the rally point, his weapon up (the squad's own step fires it). */
const covers = (m) => !m.dead && !m.down && (m.rt?.role === 'cover' || m.rt?.role === 'rally') && m.canFire !== false && !m.unarmed && !m.slung;

/** The next cover back for m (see the top): { p, rally }. */
function nextCover(sq, P, m, al) {
  const R = P.rt, slot = R.slots.get(m) ?? R.rally, T = sq.threat;
  const dSlot = d2(m.p, slot);
  if (dSlot <= LEG_MAX) return { p: slot, rally: true };
  const others = al.filter((o) => o !== m && !o.down && o.rt && o.rt.role !== 'left');
  const rear = others.length ? Math.min(...others.map((o) => d2(o.p, R.rally))) : Infinity;
  const dm = d2(m.p, R.rally);
  const want = Math.min(dm - LEG_MIN, rear - 1);
  const taken = (p) => others.some((o) => d2(o.p, p) < 1.3 || (o.rt?.to && d2(o.rt.to, p) < 1.3));
  let best = null, bs = -Infinity;
  for (const c of sq.covers ?? []) {
    const dc = d2(c.p, m.p), dr = d2(c.p, R.rally);
    if (dc < LEG_MIN || dc > LEG_MAX || dr > want || Math.abs(c.p[1] - m.p[1]) > 0.6 || taken(c.p)) continue;
    const s = 2 * c.q - (exposedTo(sq, T, c.p) ? 3 : 0) - 0.15 * dr - 0.05 * dc;
    if (s > bs) (bs = s), (best = c);
  }
  if (best) return { p: best.p.slice() };
  // no cover that way: as far as a bound takes him on the way to his slot
  const pts = sq.route(m.p, slot, m, { avoid: T, links: false });
  let left = Math.min(LEG_MAX * 0.75, Math.max(LEG_MIN, dm - want)), prev = m.p;
  for (const q of pts) {
    const l = d2(prev, q);
    if (l >= left) {
      const p = [prev[0] + ((q[0] - prev[0]) * left) / l, q[1], prev[2] + ((q[2] - prev[2]) * left) / l];
      const k = sq.nearestFree(p[0], p[2]);
      return { p: k >= 0 ? sq.cellPos(k) : p };
    }
    left -= l;
    prev = q;
  }
  return { p: slot, rally: true };
}

/** Each step of the retreat (ai/strategy.js stepStrategy). True while under way. */
export function stepRetreat(sq, dt) {
  const P = sq.strategy, R = P.rt, T = sq.threat;
  const ms = sq.members().filter((m) => m.squad !== 'UAV');
  const al = ms.filter((m) => !m.dead);
  const o = retreatOpts(sq);
  // the word going round (no man moves before he has it), then the call to the other teams
  stepWord(sq, P, dt);
  // at the vehicle: boarding it, then off in it (ai/squadVehicle.js, stepped by ai/squad.js)
  if (P.phase === 'board') {
    if (sq.board) return true;
    P.phase = 'done';
    sq.phase = 'hold';
    sq.retreating = false;
    const B = sq.lastBoard;
    const lead = sq.radioMan() ?? al[0];
    const hurt = al.filter((m) => m.down && m.rt?.role !== 'left').length;
    if (B?.phase === 'done' && lead) sq.say(lead, `${sq.unit}, clear of the contact by ${B.kind}, ${al.filter((m) => !m.down).length} fit${hurt ? `, ${hurt} wounded with us` : ''}`, 'order');
    return false;
  }
  // men lost on the way: the man moving, a carrier, the man carried
  for (const J of R.jobs.slice()) if (J.carrier.dead || J.carrier.down || J.cas.dead) dropJob(sq, R, J);
  if (R.mover && (R.mover.dead || R.mover.down)) R.mover = null;
  // (a man going down on the way, in cover or at the rally point: to be decided about)
  for (const m of al) if (m.down && !['carried', 'left', 'safe'].includes(m.rt?.role)) m.rt = null;
  // men down: carry or leave (the leader's call)
  const fit = al.filter((m) => !m.down && m.rt && m.rt.role !== 'carried' && m.rt.role !== 'left');
  const told = fit.filter((m) => hasWord(sq, m)); // (the men who have the word)
  // (the word still going round: the leader decides about them once his men have it)
  const asking = told.length < fit.length && sq.time - R.t0 < 6;
  for (const cas of asking ? [] : al.filter((m) => m.down && !m.rt?.role)) {
    const busy = new Set(R.jobs.map((J) => J.carrier));
    const D = decideCasualty(sq, cas, told.filter((m) => !busy.has(m) && m !== R.mover && m.rt?.role !== 'wire'), P.a);
    const lead = sq.radioMan();
    sq.log?.push(`retreat:${D.how}`);
    if (D.how === 'carry') {
      const c = D.carrier;
      if (R.mover === c) R.mover = null;
      R.jobs.push({ cas, carrier: c, phase: 'go', t: 0 });
      cas.rt = { role: 'carried' };
      cas.rescueRole = 'retreat';
      goTo(sq, c, cas.p, 'carry');
      sq.say(c, `${sq.unit}, ${NAME[c.squad] ?? 'rifleman'}, I've got ${NAME[cas.squad] ?? 'him'}, I'm carrying him, cover me!`, 'casualty');
    } else {
      cas.rt = { role: 'left', fight: canStillFight(cas), fireT: 1 };
      cas.rescueRole = 'retreat';
      if (cas.rt.fight) sq.say(cas, `${sq.unit}, ${NAME[cas.squad] ?? 'rifleman'}, leave me, go, I'll cover you!`, 'casualty');
      else if (lead) sq.say(lead, `${sq.unit}, ${NAME[cas.squad] ?? 'he'} is down, ${D.why}, we have to leave him`, 'order');
    }
  }
  // the men carried, and their carriers
  for (const J of R.jobs.slice()) stepCarry(sq, R, J, dt, o);
  // the men left behind: covering fire as long as they can
  for (const m of al) if (m.rt?.role === 'left') stepLeft(sq, m, dt);
  // the man setting a wire, the man moving
  const M = R.mover;
  if (M?.rt.role === 'wire') stepWire(sq, R, M, dt);
  else if (M) stepMover(sq, P, M, dt, al, o);
  // the next to go: set a moment, someone covering, the man furthest forward
  if (!R.mover && sq.time >= R.setT) {
    const peel = told.filter((m) => m.rt.role === 'cover' && !R.jobs.some((J) => J.carrier === m));
    if (peel.length) {
      const m = peel.reduce((x, y) => (d2(y.p, R.rally) > d2(x.p, R.rally) ? y : x));
      const cov = al.filter((x) => x !== m && covers(x));
      const leftFiring = al.some((x) => x.rt?.role === 'left' && x.rt.fight);
      // (no one to cover him: he waits for a carrier to be back and covering; alone, he goes)
      if (cov.length || (!R.jobs.length && (leftFiring || peel.length === 1))) {
        const C = nextCover(sq, P, m, al);
        goTo(sq, m, C.p);
        m.rt.rally = !!C.rally;
        R.mover = m;
        m.signal = { text: 'MOVING!', until: sq.time + 1.5 };
        sq.host.shout?.(m, 'Moving!');
        if (cov[0]) {
          cov[0].signal = { text: 'COVERING!', until: sq.time + 1.5 };
          sq.host.shout?.(cov[0], 'Covering!');
        }
      }
    }
  }
  // all back: at the rally point, the carried with them
  const back = fit.every((m) => m.rt.role === 'rally') && !R.jobs.length && !R.mover;
  if (back && P.phase !== 'done' && R.vehicle) {
    const V = R.vehicle;
    const B = V.usable() && V.stationary() ? startBoarding(sq, V, { men: goingMen(sq), lead: sq.radioMan(), face: T, slots: R.slots, why: 'retreat' }) : null;
    if (B) {
      P.phase = 'board';
      return true;
    }
    vnote(sq, 'retreat:vehicle:lost');
  }
  if (back && P.phase !== 'done') {
    P.phase = 'done';
    sq.phase = 'hold';
    sq.retreating = false;
    const left = al.filter((m) => m.rt?.role === 'left');
    sq.say(sq.radioMan() ?? al[0], `${sq.unit}, at the rally point, contact broken${left.length ? `, ${left.length} left behind` : ''}`, 'order');
  }
  return P.phase !== 'done';
}

/** The man on his bound: backing off aiming, or running; a doorway behind the last man gets a wire. */
function stepMover(sq, P, m, dt, al, o) {
  const R = P.rt, T = sq.threat;
  const rest = m.rt.L - (m.rt.done ?? 0);
  // a short bound backing off, weapon up; a long one a step back, turn and run, turn again near the end
  const back = m.rt.L <= 5 || (m.rt.done ?? 0) < 1.2 || rest < 1.5;
  const there = walkOn(sq, m, dt, back ? RT_SPEED.back : RT_SPEED.run, back ? T : null);
  sq.setAnim(m, back ? 'aimWalkBack' : 'run');
  // through a doorway, the last of them: the wire across it
  for (const g of m.rt.gaps ?? []) {
    if (g.passed) continue;
    const side = (p) => (p[0] - g.c[0]) * g.u[0] + (p[2] - g.c[2]) * g.u[1];
    if (side(m.p) < 0.65) continue;
    g.passed = true;
    const others = al.filter((x) => x !== m && x.rt?.role !== 'left' && !x.dead);
    const last = others.every((x) => side(x.p) > 0.3);
    if (last && o.tripwire && R.wires < o.wires && (m.wires ?? 1) > 0) return startWire(sq, R, m, g);
  }
  if (!there) return;
  m.moving = false;
  m.rt = { role: m.rt.rally ? 'rally' : 'cover' };
  m.rescueRole = null;
  m.cover = m.p.slice();
  m.coverCell = -1;
  m.arrived = true;
  m.planRoute = null;
  sq.setAnim(m, 'crouchAim');
  m.signal = { text: 'SET!', until: sq.time + 1.2 };
  sq.host.shout?.(m, 'Set!');
  R.mover = null;
  R.setT = sq.time + SET_T;
}

/* ------------------------------------------------------------------ the carry */

function stepCarry(sq, R, J, dt, o) {
  const { cas, carrier: c } = J;
  const K = skillOf(c);
  J.t += dt;
  // the casualty rides on the carrier's root, turned across his shoulders
  const ride = () => {
    cas.p = c.p.slice();
    cas.yaw = (c.yaw ?? 0) + Math.PI / 2;
    cas.moving = c.moving;
    cas.speed = c.speed;
  };
  switch (J.phase) {
    case 'go':
      if (walkOn(sq, c, dt, RT_SPEED.run, null) || J.t > 25) {
        c.moving = false;
        J.phase = 'stow';
        J.t = 0;
        c.slung = true; // (his weapon on its carry slot: both hands free)
        c.canFire = false;
        c.yaw = Math.atan2(cas.p[0] - c.p[0], cas.p[2] - c.p[2]);
        sq.setAnim(c, 'holsterRifle', RT_T.stow * K.reload);
      } else sq.setAnim(c, 'run');
      break;
    case 'stow':
      if (J.t >= RT_T.stow * K.reload) {
        J.t = 0;
        J.phase = 'pack';
        // his gear off: the pack down in front of him (operator/rig.js dropPack), once
        if (o.dropPack && !c.packOff) {
          c.packOff = true;
          sq.setAnim(c, 'dropPack', RT_T.pack);
          sq.host.dropPack?.(c);
        }
      }
      break;
    case 'pack':
      if (!sq.busy(c)) {
        // astride him, then up onto the shoulders
        J.phase = 'lift';
        J.t = 0;
        c.p = [cas.p[0], cas.p[1], cas.p[2]];
        ride();
        sq.setAnim(c, 'liftCasualty', RT_T.lift);
        sq.setAnim(cas, 'lifted', RT_T.lift);
      }
      break;
    case 'lift':
      ride();
      if (J.t >= RT_T.lift) {
        J.phase = 'carry';
        J.t = 0;
        goTo(sq, c, R.slots.get(c) ?? R.rally, 'carry');
        sq.say(c, `${sq.unit}, got him, moving back`, 'casualty');
      }
      break;
    case 'carry': {
      const there = walkOn(sq, c, dt, RT_SPEED.carry, null);
      sq.setAnim(c, 'fireCarry');
      ride();
      sq.setAnim(cas, 'carried');
      if (there) {
        J.phase = 'down';
        J.t = 0;
        c.moving = cas.moving = false;
        sq.setAnim(c, 'putDownCasualty', RT_T.putDown);
        sq.setAnim(cas, 'setDown', RT_T.putDown);
      }
      break;
    }
    case 'down':
      ride();
      cas.moving = false;
      if (J.t >= RT_T.putDown) {
        J.phase = 'draw';
        J.t = 0;
        // he lies at the carrier's feet, across in front of him
        cas.rt = { role: 'safe' };
        cas.safe = true;
        cas.rescueRole = 'casualty';
        sq.setAnim(cas, 'woundedDown');
        c.slung = false;
        sq.setAnim(c, 'drawRifle', TIMES.toRifle * K.reload);
        sq.say(c, `${sq.unit}, ${NAME[cas.squad] ?? 'he'} is back at the rally point`, 'casualty');
      }
      break;
    case 'draw':
      if (J.t >= TIMES.toRifle * K.reload) {
        delete c.canFire;
        c.rt = { role: 'rally' };
        c.rescueRole = null;
        c.planRoute = null;
        c.arrived = true;
        R.jobs.splice(R.jobs.indexOf(J), 1);
      }
      break;
  }
}
/** A carry gone wrong (the carrier hit, or the man he carries dead): he is put down where they are. */
function dropJob(sq, R, J) {
  const { cas, carrier: c } = J;
  R.jobs.splice(R.jobs.indexOf(J), 1);
  if (!cas.dead) {
    cas.rt = null; // (decided again)
    cas.rescueRole = 'casualty';
    cas.moving = false;
    sq.setAnim(cas, 'woundedDown');
  }
  if (!c.dead && !c.down) {
    c.slung = false;
    delete c.canFire;
    c.rt = { role: 'cover' };
    c.rescueRole = null;
    sq.setAnim(c, 'drawRifle', TIMES.toRifle * skillOf(c).reload);
  } else c.slung = false;
}

/* ------------------------------------------------------------------ left behind */

function stepLeft(sq, m, dt) {
  const L = m.rt;
  m.moving = false;
  if (!L.fight || !canStillFight(m)) {
    if (L.fight && !m.dead) {
      L.fight = false;
      sq.say(m, `${sq.unit}, ${NAME[m.squad] ?? 'rifleman'}, I'm out, I'm out`, 'casualty');
    }
    sq.setAnim(m, 'woundedDown');
    return;
  }
  // at what he sees (the nearest), else the threat
  const seen = sq.seen ?? [];
  const at = seen.length ? seen.reduce((a, h) => (d2(h.p, m.p) < d2(a.p, m.p) ? h : a)).p : sq.threat;
  sq.face(m, at, dt, 3);
  m.aimAt = at;
  // a magazine out: a slow reload, lying there
  if (m.reloadUntil) {
    if (sq.time < m.reloadUntil) return;
    m.reloadUntil = 0;
    m.mag = 30;
  }
  if (!canShoot(m)) {
    if ((m.mags ?? 0) > 0) {
      m.mags--;
      const dur = TIMES.reload * 1.8 * skillOf(m).reload;
      m.reloadUntil = sq.time + dur;
      sq.setAnim(m, 'reload', dur);
    }
    return;
  }
  L.fireT -= dt;
  if (L.fireT > 0) {
    if (!sq.busy(m)) sq.setAnim(m, L.burst ? 'proneShoot' : 'proneAim');
    return;
  }
  if (!L.burst) {
    // a burst: three rounds a fifth of a second apart; then a pause, longer the worse he is
    L.burst = 3;
    sq.setAnim(m, 'proneShoot');
  }
  L.burst--;
  L.fireT = L.burst > 0 ? 0.2 : 1.2 + srand(sq) * 1.2 + (100 - (m.health ?? 100)) / 60;
  spend(m);
  // his aim: the worse for his wounds
  const rand = () => srand(sq);
  const p = aimPoint(m, at, rand);
  const k = WOUND_SCATTER * Math.min(1, (100 - (m.health ?? 100)) / 80) * d2(m.p, at);
  p[0] += (rand() - 0.5) * 2 * k;
  p[1] += (rand() - 0.5) * k;
  p[2] += (rand() - 0.5) * 2 * k;
  sq.host.fire?.(m, p, weaponKind(m));
  L.shots = (L.shots ?? 0) + 1;
  if (!L.burst) sq.setAnim(m, 'proneAim');
}

/* ------------------------------------------------------------------ the tripwire */

function startWire(sq, R, m, g) {
  R.wires++;
  m.wires = (m.wires ?? 1) - 1;
  const y = (sq.host.floor(g.c[0], g.c[2], m) ?? g.c[1]) + WIRE_H;
  const h = g.w / 2 - 0.03;
  const a = [g.c[0] - g.n[0] * h, y, g.c[2] - g.n[1] * h], b = [g.c[0] + g.n[0] * h, y, g.c[2] + g.n[1] * h];
  // the charge on the jamb, a hand's width on this side of the wire
  const charge = [a[0] + g.u[0] * 0.12 + g.n[0] * 0.04, y + 0.1, a[2] + g.u[1] * 0.12 + g.n[1] * 0.04];
  const trap = { kind: 'tripwire', a, b, charge, y: y - WIRE_H, c: g.c.slice(), u: g.u.slice(), unit: sq.unit, setBy: m, stage: 'set', armed: false, fired: false, t: sq.time };
  sq.traps = (sq.traps ?? []).concat(trap);
  // kneeling just this side of it, facing back through it
  const K = skillOf(m);
  m.rt.wire = { trap, t: 0, dur: RT_T.wire * K.reload, stow: RT_T.stow * K.reload, draw: TIMES.toRifle * K.reload, resume: m.rt.to };
  m.rt.role = 'wire';
  m.moving = false;
  m.p = [g.c[0] + g.u[0] * 0.65, m.p[1], g.c[2] + g.u[1] * 0.65];
  m.yaw = Math.atan2(-g.u[0], -g.u[1]);
  m.slung = true;
  m.canFire = false;
  sq.setAnim(m, 'holsterRifle', m.rt.wire.stow);
  sq.say(m, `${sq.unit}, ${NAME[m.squad] ?? 'rifleman'}, last man through, wiring the door, cover me`, 'order');
  sq.log?.push('retreat:wire');
}
function stepWire(sq, R, m, dt) {
  const W = m.rt.wire, tr = W.trap;
  W.t += dt;
  m.moving = false;
  const t = W.t - W.stow;
  if (t < 0) return;
  if (t < W.dur) {
    if (m.anim !== 'setTripwire') sq.setAnim(m, 'setTripwire', W.dur);
    // the charge on the jamb a third of the way in; the wire across, tied off, near the end
    if (t > W.dur * 0.3 && tr.stage === 'set') {
      tr.stage = 'charge';
      sq.host.trap?.(tr);
    }
    if (t > W.dur * 0.85 && tr.stage === 'charge') tr.stage = 'wire';
    return;
  }
  if (m.slung) {
    m.slung = false;
    tr.stage = 'wire';
    sq.setAnim(m, 'drawRifle', W.draw);
    return;
  }
  if (t < W.dur + W.draw) return;
  // on to where he was going
  delete m.canFire;
  const to = W.resume;
  m.rt = { role: 'move' };
  goTo(sq, m, to);
  m.rt.rally = to && d2(to, R.slots.get(m) ?? R.rally) < 0.5;
  m.rt.gaps = m.rt.gaps.filter((g) => d2(g.c, tr.c) > 1.6);
  sq.say(m, `${sq.unit}, wire is in, moving`, 'order');
}

/**
 * The squad's wires each step (ai/squad.js, whatever the strategy): armed once the man who set it
 * is clear; a hostile's feet across it set it off. Not the squad's own men.
 */
export function stepTraps(sq) {
  for (const tr of sq.traps ?? []) {
    if (tr.fired) continue;
    if (tr.stage === 'wire' && !tr.armed) {
      const s = tr.setBy;
      const side = (p) => (p[0] - tr.c[0]) * tr.u[0] + (p[2] - tr.c[2]) * tr.u[1];
      if (s.dead || Math.abs(side(s.p)) > 1.0) tr.armed = true;
    }
    if (!tr.armed) {
      tr.prev = null;
      continue;
    }
    tr.prev ??= new Map();
    for (const h of sq.host.hostiles?.() ?? []) {
      if (h.dead || !h.p) continue;
      const was = tr.prev.get(h);
      tr.prev.set(h, h.p.slice());
      if (Math.abs((h.p[1] ?? 0) - tr.y) > 0.6) continue;
      const hit = (was && crosses(was, h.p, tr.a, tr.b)) || segDist(h.p, tr.a, tr.b) < 0.1;
      if (!hit) continue;
      tr.fired = true;
      tr.firedBy = h;
      tr.firedT = sq.time;
      if (sq.host.explode) sq.host.explode(tr.charge.slice(), WIRE_E, { name: 'tripwire', trap: tr, who: h });
      else sq.host.grenade?.(tr.setBy, tr.charge.slice(), [0, 0, 0]);
      const lead = sq.radioMan();
      if (lead) sq.say(lead, `${sq.unit}, the wire at the door just went off`, 'intel');
      break;
    }
  }
}
/** Does the step a→b cross the wire p→q (on the ground plan)? */
function crosses(a, b, p, q) {
  const o = (x, y, z) => Math.sign((y[0] - x[0]) * (z[2] - x[2]) - (y[2] - x[2]) * (z[0] - x[0]));
  return o(a, b, p) !== o(a, b, q) && o(p, q, a) !== o(p, q, b);
}
function segDist(p, a, b) {
  const ax = b[0] - a[0], az = b[2] - a[2];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ax + (p[2] - a[2]) * az) / (ax * ax + az * az || 1)));
  return Math.hypot(p[0] - a[0] - ax * t, p[2] - a[2] - az * t);
}
