/**
 * Squads and vehicles (on top of ai/vehicles.js, the adapter over helicopters, boats and cars):
 * how a squad gets into one and goes. Pure logic, no three.js.
 *
 *  - Falling back to a vehicle (ai/retreat.js asks vehicleForRetreat when the retreat starts): a
 *    vehicle near them (VEH_R), usable (not crashed, sunk or burning; a helicopter with a pilot),
 *    standing still, with a seat for every man going (the wounded too: the men left behind are not
 *    going), and not out towards the threat. Then the rally point is beside it, on its far side from
 *    the threat, and each man's slot there is his guard post round it (guardSlots: a half ring on the
 *    threat's side, facing out). They peel back to it as to any rally point (bounding, covering
 *    fire, the wounded carried). Each candidate turned down is logged with why
 *    ('retreat:vehicle:skip:<kind>:<why>'), the choice too ('retreat:vehicle:<kind>').
 *  - Mounting up for a team that called for help (ai/retreatRadio.js reactToCall, and the plain
 *    'requesting backup' call, ai/squad.js): a team not in a fight of its own, too far to walk up
 *    and cover them (more than MOUNT_MIN), with a stationary vehicle within MOUNT_R of it with seats
 *    for all: "mounting up, coming to you" (mountForBackup), and the vehicle takes it to the team.
 *  - Boarding (startBoarding / stepBoarding: sq.board), the same both ways:
 *      signal   the leader (the signaller) shouts "Mount up! Into the <kind>!" (not under radio
 *               silence) and gives the hand signal (MOUNT UP); each man acknowledges ("Mounting!",
 *               or a thumbs-up under silence) a moment after
 *      gather   each man to his guard post round it (facing out: the threat, or the way the team
 *               that called is), the signaller to the door
 *      board    one at a time, in order: the wounded first (a man lifts him, carries him to the door
 *               and puts him in, then goes back to his post), then the able men, the furthest from
 *               the threat first; each goes to the door, climbs in ("In!") and takes his seat
 *               (assignSeats: the first in where they can fire from, a driver if it needs one).
 *               Those not yet aboard stay at their posts, facing out, the squad firing as ever;
 *               those aboard where the seat allows (a door gun, the door, an open boat) fire at
 *               what the squad sees, so the last men get in under cover from inside
 *      last     the signaller last ("Last man in!"), when he is the one; else the nearest the threat
 *      depart   the driver (its own pilot; else the man at the wheel or the oars) takes it off:
 *               out of it, away from the threat (a retreat), or to the team that called (backup)
 *      arrive   there they get out (a helicopter lands and its troops jump out); a backup team
 *               moves up to cover the team that called
 *    Logged: 'vehicle:signal:<kind>', 'vehicle:ack:<role>', 'vehicle:gather', 'vehicle:board:<role>:<seat>',
 *    'vehicle:cover:<role>', 'vehicle:last:<role>', 'vehicle:depart:<kind>', 'vehicle:arrive:<kind>'.
 *
 * Each man the boarding has (walking to his post or the door, climbing in, aboard) has m.vehTask
 * (ai/squad.js: not the squad's to move, as ownMove) and m.inVehicle (the adapter) once aboard.
 */
import { findVehicles, assignSeats, freeSeats } from './vehicles.js';
import { srand } from './strategy.js';
import { aimPoint, spend, weaponKind, canShoot } from './soldier.js';

export const VEH_R = 60; // m: a vehicle this near the squad can be fallen back to
export const MOUNT_R = 45; // m: a vehicle this near a team can take it to a team that called
export const MOUNT_MIN = 40; // m: a team nearer than this to the caller walks
const CLIMB_T = 1.1; // s: climbing in
const LIFT_T = 2.0; // s: lifting a wounded man
const SPEED = { walk: 1.6, run: 3.2, carry: 0.85 };
const AWAY = { helicopter: 160, boat: 60, car: 120, vehicle: 60 }; // m it takes them off, out of a fight
const WORD = { helicopter: 'helicopter', boat: 'boat', car: 'car', vehicle: 'vehicle' };
const d2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const cen = (l) => l.reduce((c, m) => [c[0] + m.p[0] / l.length, c[1] + m.p[1] / l.length, c[2] + m.p[2] / l.length], [0, 0, 0]);

/** Write it down: sq.retreatLog (as ai/retreatRadio.js note), sq.vehicleLog, and the host's sq.log. */
export function vnote(sq, s) {
  (sq.vehicleLog ??= []).push(s);
  (sq.retreatLog ??= []).push(s);
  sq.log?.push(s);
}

/** The men a vehicle has to take: everyone alive but the men left behind. */
export const goingMen = (sq) => sq.members().filter((m) => !m.dead && m.rt?.role !== 'left');

/* ------------------------------------------------------------------ choosing one */

/**
 * A vehicle the retreat can fall back to (see the top): { V, why } or null. o: the retreat's
 * params (o.vehicle false: never); men: who goes; T: the threat.
 */
export function vehicleForRetreat(sq, men, T, o = {}) {
  if (o.vehicle === false) return null;
  const c = cen(men.length ? men : sq.members());
  let best = null, bd = Infinity;
  for (const V of findVehicles(sq)) {
    const p = V.p(), d = d2(p, c), k = V.kind;
    const skip = (why) => vnote(sq, `retreat:vehicle:skip:${k}:${why}`);
    if (d > (o.vehicleRange ?? VEH_R)) continue; // (too far to be thought of)
    if (!V.usable()) skip('not usable');
    else if (!V.stationary()) skip('moving');
    else if (freeSeats(V).length < men.length) skip(`${freeSeats(V).length} seats for ${men.length}`);
    else if (!assignSeats(V, men)) skip('no driver');
    else if (T && d2(p, T) < d2(c, T) - 4) skip('towards the threat');
    else if (d < bd) (bd = d), (best = V);
  }
  if (!best) return null;
  const why = `${freeSeats(best).length} seats, ${Math.round(bd)} m`;
  vnote(sq, `retreat:vehicle:${best.kind}:${why}`);
  return { V: best, why };
}

/**
 * The posts round a vehicle (map man → [x, y, z]): a half ring on the side facing F (the threat),
 * a couple of metres off it, each man facing out; the signaller (lead) at the door of his seat.
 */
export function guardSlots(sq, V, F, men, lead = null, seats = null) {
  const P = V.p();
  const ax = F ? F[0] - P[0] : 1, az = F ? F[2] - P[2] : 0, l = Math.hypot(ax, az) || 1;
  const a0 = Math.atan2(az / l, ax / l);
  const R = V.radius + 1.6;
  const ring = men.filter((m) => m !== lead);
  const out = new Map();
  const snap = (p) => {
    try {
      if (!sq.blocked) sq.rebuildNav?.(); // (before any contact the grid may not be built yet)
      const k = sq.nearestFree?.(p[0], p[2]);
      return k >= 0 ? sq.cellPos(k) : p;
    } catch {
      return p;
    }
  };
  ring.forEach((m, i) => {
    const a = a0 + (ring.length > 1 ? (i / (ring.length - 1) - 0.5) * 2.4 : 0); // ±69° round the threat's side
    out.set(m, snap([P[0] + Math.cos(a) * R, m.p[1], P[2] + Math.sin(a) * R]));
  });
  if (lead) out.set(lead, snap(seats?.has(lead) ? V.entry(seats.get(lead)) : [P[0] - (ax / l) * R, lead.p[1], P[2] - (az / l) * R]));
  return out;
}

/** The point a vehicle takes them to out of a fight: straight away from the threat. */
export function awayPoint(V, T, o = {}) {
  if (o.vehicleTo) return o.vehicleTo.slice();
  const P = V.p();
  const ax = P[0] - (T?.[0] ?? P[0] - 1), az = P[2] - (T?.[2] ?? P[2]), l = Math.hypot(ax, az) || 1;
  const D = AWAY[V.kind] ?? 60;
  return [P[0] + (ax / l) * D, P[1], P[2] + (az / l) * D];
}

/* ------------------------------------------------------------------ boarding */

/**
 * Board V (see the top). o: { men, lead (the signaller), leadLast, face (what the guards face),
 * dest (where it goes), why ('retreat' | 'backup'), call (the team that called), onArrive }.
 * The order: the wounded first, then the able men furthest from what they face first; the
 * signaller last if leadLast. Returns sq.board, or null if they do not fit.
 */
export function startBoarding(sq, V, o) {
  const men = o.men.filter((m) => !m.dead);
  const F = o.face ?? null;
  const lead = o.lead && men.includes(o.lead) ? o.lead : null;
  const cas = men.filter((m) => m.down);
  const able = men.filter((m) => !m.down && !(o.leadLast && m === lead)).sort((a, b) => (F ? d2(b.p, F) - d2(a.p, F) : 0));
  const order = [...cas, ...able, ...(o.leadLast && lead ? [lead] : [])];
  const seats = assignSeats(V, order);
  if (!seats) return null;
  const B = {
    V, kind: V.kind, why: o.why ?? 'retreat', order, seats, lead, leadLast: !!o.leadLast, face: F, dest: o.dest ?? null,
    call: o.call ?? null, onArrive: o.onArrive ?? null, phase: 'signal', i: 0, cur: null, t0: sq.time, t: 0, acks: new Map(),
    slots: o.slots ?? guardSlots(sq, V, F, order.filter((m) => !m.down), lead, seats), seq: [],
  };
  sq.board = B;
  for (const m of order) m.vehBoard = B;
  return B;
}

/** Walk m along m.vehTask.way at sp; true when there. */
function walk(sq, m, dt, sp, face = null) {
  const J = m.vehTask;
  while (J.way && J.wi < J.way.length && d2(J.way[J.wi], m.p) < 0.2) J.wi++;
  if (!J.way || J.wi >= J.way.length) {
    m.moving = false;
    m.speed = 0;
    return true;
  }
  const q = J.way[J.wi];
  const dx = q[0] - m.p[0], dz = q[2] - m.p[2], l = Math.hypot(dx, dz);
  const s = Math.min(l, sp * dt);
  const x = m.p[0] + (dx / l) * s, z = m.p[2] + (dz / l) * s;
  m.p = [x, sq.host.floor?.(x, z, m) ?? m.p[1], z];
  m.moving = true;
  m.speed = sp;
  sq.face(m, face ?? [m.p[0] + dx, m.p[1], m.p[2] + dz], dt, 8);
  return false;
}
function sendTo(sq, m, to, kind, extra = {}) {
  let way;
  try {
    way = sq.route(m.p, to, m, { avoid: sq.threat, links: false });
  } catch {
    way = null;
  }
  if (!way?.length || d2(way[way.length - 1], to) > 1.5) way = [...(way ?? []), to.slice()];
  m.vehTask = { kind, to: to.slice(), way, wi: 0, t: 0, ...extra };
  m.path = null;
  m.planRoute = [m.p.slice(), ...way];
  m.rescueRole = 'vehicle';
}
/** He is the squad's again (at his post: it fights him as any man in cover). */
function release(sq, m, at = null) {
  m.vehTask = null;
  m.rescueRole = m.down ? 'casualty' : null;
  m.moving = false;
  m.path = null;
  m.planRoute = null;
  m.arrived = true;
  if (at) {
    m.cover = m.p.slice();
    m.coverCell = -1;
  }
  if (sq.board?.face && !m.down) sq.face(m, sq.board.face, 1, 10);
}
function shout(sq, m, text, sig) {
  if (sq.time >= sq.silentUntil) sq.host.shout?.(m, text);
  m.signal = { text: sig ?? text.toUpperCase(), until: sq.time + 1.5 };
}
/** Into his seat. */
function seat(sq, B, m) {
  const i = B.seats.get(m);
  B.V.board(m, i);
  m.vehTask = { kind: 'aboard' };
  m.inVehicle = B.V;
  m.rescueRole = 'vehicle';
  m.planRoute = null;
  const s = B.V.seats[i];
  B.seq.push(m);
  vnote(sq, `vehicle:board:${m.squad}:${s.label}`);
  if (!m.down) shout(sq, m, 'In!', 'IN!');
}

/** Each step of the boarding and the drive (ai/squad.js step, through stepVehicles). */
export function stepBoarding(sq, dt) {
  const B = sq.board;
  if (!B) return null;
  const V = B.V;
  B.t += dt;
  const men = B.order.filter((m) => !m.dead);
  const lead = B.lead && !B.lead.dead ? B.lead : null;
  // the vehicle gone (crashed, sunk, burning) before it left: everyone out, on foot again
  if (!V.usable() && B.phase !== 'move') return abort(sq, B, 'the vehicle is lost');
  // those aboard where they can shoot: at what the squad sees (unless its own crew does that)
  coverFromInside(sq, B, dt);
  switch (B.phase) {
    case 'signal': {
      if (!B.signalled) {
        B.signalled = true;
        const who = lead ?? men.find((m) => !m.down);
        if (who) {
          if (!who.down) sq.setAnim(who, 'signalMove', 1.6);
          shout(sq, who, `Mount up! Into the ${WORD[V.kind]}!${men.some((m) => m.down) ? ' Wounded first!' : ''}`, `MOUNT UP · ${WORD[V.kind].toUpperCase()}`);
        }
        vnote(sq, `vehicle:signal:${V.kind}`);
        for (const m of men) if (m !== who && !m.down) B.acks.set(m, sq.time + 0.4 + srand(sq) * 0.6);
      }
      for (const [m, at] of B.acks) {
        if (at == null || sq.time < at) continue;
        B.acks.set(m, null);
        if (sq.time < sq.silentUntil) m.signal = { text: 'ACK · THUMBS UP', until: sq.time + 1.2 };
        else shout(sq, m, 'Mounting!', 'MOUNTING!');
        vnote(sq, `vehicle:ack:${m.squad}`);
      }
      if ([...B.acks.values()].every((v) => v == null) && B.t > 1.2) {
        B.phase = 'gather';
        B.t = 0;
        vnote(sq, 'vehicle:gather');
      }
      return B.phase;
    }
    case 'gather': {
      let all = true;
      for (const m of men) {
        if (m.down) continue;
        const to = B.slots.get(m);
        if (!to || d2(m.p, to) < 0.8) {
          if (m.vehTask?.kind === 'gather') release(sq, m, to);
          continue;
        }
        all = false;
        if (m.vehTask?.kind !== 'gather') sendTo(sq, m, to, 'gather');
        if (walk(sq, m, dt, sq.threat ? SPEED.walk : SPEED.run)) release(sq, m, to);
        else sq.setAnim(m, 'run');
      }
      if (all || B.t > 40) {
        B.phase = 'board';
        B.t = 0;
      }
      return B.phase;
    }
    case 'board':
    case 'last': {
      // men walking back to their posts (a helper who put a wounded man in)
      for (const m of men) if (m.vehTask?.kind === 'post' && !B.cur?.men?.includes(m)) {
        if (walk(sq, m, dt, SPEED.run)) release(sq, m, m.vehTask.to);
        else sq.setAnim(m, 'run');
      }
      if (!B.cur) {
        while (B.i < B.order.length && (B.order[B.i].dead || B.order[B.i].inVehicle === V)) B.i++;
        if (B.i >= B.order.length) {
          B.phase = 'depart';
          B.t = 0;
          return B.phase;
        }
        const m = B.order[B.i];
        const out = men.filter((x) => x.inVehicle !== V);
        if (out.length === 1 && B.phase !== 'last') {
          B.phase = 'last';
          vnote(sq, `vehicle:last:${m.squad}`);
          shout(sq, m, B.leadLast && m === lead ? 'Last man in!' : 'Last man!', 'LAST MAN');
        }
        if (m.down) {
          // a wounded man: the nearest able man outside (not the signaller, if anyone else can) lifts him in
          const by = men.filter((x) => !x.down && x.inVehicle !== V).sort((a, b) => d2(a.p, m.p) - d2(b.p, m.p));
          const h = by.find((x) => x !== lead) ?? by[0];
          if (!h) {
            B.i++; // (no one to lift him: he cannot go)
            return B.phase;
          }
          B.cur = { cas: m, helper: h, phase: 'fetch', t: 0, men: [h, m] };
          sendTo(sq, h, m.p, 'fetch');
          m.vehTask = { kind: 'carried' };
          m.rescueRole = 'vehicle';
          sq.say?.(h, `${sq.unit}, I've got him, putting him in`, 'casualty');
        } else {
          B.cur = { man: m, phase: 'go', t: 0, men: [m] };
          sendTo(sq, m, V.entry(B.seats.get(m)), 'board');
        }
      }
      stepJob(sq, B, dt);
      return B.phase;
    }
    case 'depart': {
      const who = lead && lead.inVehicle === V ? lead : men.find((m) => m.inVehicle === V);
      const dest = B.dest ?? awayPoint(V, sq.threat ?? B.face, sq.host.retreat ?? {});
      B.dest = dest;
      V.go(dest);
      const drv = V.driver();
      vnote(sq, `vehicle:depart:${V.kind}${drv ? `:${drv.heliCrew ? drv.role : drv.squad ?? drv.role ?? 'driver'}` : ''}`);
      if (who) sq.say(who, B.why === 'backup' ? `${sq.unit}, mounted up, moving to ${B.call?.unit ?? 'you'}` : `${sq.unit}, all aboard, moving out`, 'order');
      B.phase = 'move';
      B.t = 0;
      return B.phase;
    }
    case 'move': {
      V.step(dt);
      if (V.arrived() || B.t > 240) arrive(sq, B);
      return B.phase;
    }
  }
  return B.phase;
}

/** The boarder's or the lifter's job. */
function stepJob(sq, B, dt) {
  const J = B.cur, V = B.V;
  J.t += dt;
  if (J.man) {
    const m = J.man;
    if (m.dead || m.down) {
      // (hit on his way in: he is a wounded man now, lifted in in his turn)
      if (m.down && !m.dead) {
        m.vehTask = null;
        m.rescueRole = 'casualty';
        B.order.splice(B.i + 1, 0, m);
      }
      B.i++;
      B.cur = null;
      return;
    }
    if (J.phase === 'go') {
      if (walk(sq, m, dt, SPEED.run) || J.t > 30) {
        J.phase = 'in';
        J.t = 0;
        sq.face(m, V.p(), 1, 10);
        sq.setAnim(m, 'crouch', CLIMB_T);
      } else sq.setAnim(m, 'run');
    } else if (J.t >= CLIMB_T) {
      seat(sq, B, m);
      B.i++;
      B.cur = null;
    }
    return;
  }
  // a wounded man lifted in
  const { cas, helper: h } = J;
  if (h.dead || h.down || cas.dead) {
    if (!h.dead && !h.down) release(sq, h);
    cas.vehTask = null;
    cas.rescueRole = 'casualty';
    B.cur = null;
    if (cas.dead) B.i++;
    return;
  }
  const ride = () => {
    cas.p = h.p.slice();
    cas.yaw = (h.yaw ?? 0) + Math.PI / 2;
  };
  switch (J.phase) {
    case 'fetch':
      if (walk(sq, h, dt, SPEED.run) || J.t > 25) {
        J.phase = 'lift';
        J.t = 0;
        h.p = cas.p.slice();
        sq.setAnim(h, 'liftCasualty', LIFT_T);
        sq.setAnim(cas, 'lifted', LIFT_T);
      } else sq.setAnim(h, 'run');
      break;
    case 'lift':
      ride();
      if (J.t >= LIFT_T) {
        J.phase = 'carry';
        J.t = 0;
        sendTo(sq, h, V.entry(B.seats.get(cas)), 'carry');
      }
      break;
    case 'carry':
      ride();
      sq.setAnim(cas, 'carried');
      if (walk(sq, h, dt, SPEED.carry) || J.t > 60) {
        J.phase = 'in';
        J.t = 0;
        sq.setAnim(h, 'putDownCasualty', CLIMB_T * 1.5);
      } else sq.setAnim(h, 'fireCarry');
      break;
    case 'in':
      ride();
      if (J.t >= CLIMB_T * 1.5) {
        seat(sq, B, cas);
        vnote(sq, `vehicle:wounded:${cas.squad}`);
        // back to his post
        const to = B.slots.get(h) ?? h.p;
        sendTo(sq, h, to, 'post');
        B.i++;
        B.cur = null;
      }
      break;
  }
}

/** Those aboard in seats they can shoot from fire at what the squad sees (or the threat). */
function coverFromInside(sq, B, dt) {
  const V = B.V;
  const T = sq.threat;
  if (!T || V.selfArmed) return;
  const seen = (sq.seen ?? []).filter((h) => !h.dead);
  for (const m of B.order) {
    if (m.dead || m.down || m.inVehicle !== V || !V.seats[m.seat]?.shoot || m.canFire === false) continue;
    if (!m.coverNoted) {
      m.coverNoted = true;
      vnote(sq, `vehicle:cover:${m.squad}`);
      m.signal = { text: 'COVERING!', until: sq.time + 1.2 };
    }
    m.vfT = (m.vfT ?? 0.3 + srand(sq) * 0.5) - dt;
    m.vehFiring = m.vfT > -0.5 && (m.vburst ?? 0) > 0;
    if (m.vfT > 0) continue;
    if (!canShoot(m)) {
      if ((m.mags ?? 0) > 0) {
        m.mags--;
        m.mag = 30;
        m.vfT = 2.5;
      } else m.vfT = 99;
      continue;
    }
    m.vburst = m.vburst || 3;
    m.vburst--;
    m.vfT = m.vburst > 0 ? 0.15 : 0.9 + srand(sq) * 0.8;
    const at = seen.length ? seen.reduce((a, h) => (d2(h.p, m.p) < d2(a.p, m.p) ? h : a)).p : T;
    spend(m);
    m.anim = V.kind === 'boat' ? 'sitShoot' : 'kneelShoot'; // (an open boat: over the side from his thwart)
    sq.host.fire?.(m, aimPoint(m, at, () => srand(sq)), weaponKind(m));
    B.shots = (B.shots ?? 0) + 1;
  }
}

/** There: everyone out; a backup team goes to work. */
function arrive(sq, B) {
  const V = B.V;
  for (const m of B.order) {
    if (m.inVehicle === V || V.holds(m)) V.leave(m);
    clear(m);
    if (!m.down) m.arrived = true;
  }
  vnote(sq, `vehicle:arrive:${V.kind}`);
  B.phase = 'done';
  sq.lastBoard = B;
  sq.board = null;
  B.onArrive?.(sq, B);
}
function clear(m) {
  m.vehTask = null;
  m.inVehicle = null;
  m.vehBoard = null;
  m.vehFiring = false;
  m.rescueRole = m.down && !m.dead ? 'casualty' : null;
  m.path = null;
  m.planRoute = null;
}
/** It cannot be done: out, and on foot. */
function abort(sq, B, why) {
  for (const m of B.order) {
    if (m.inVehicle === B.V || B.V.holds(m)) B.V.leave(m);
    clear(m);
  }
  vnote(sq, `vehicle:abort:${why}`);
  B.phase = 'aborted';
  sq.lastBoard = B;
  sq.board = null;
  return B.phase;
}

/** Each squad step (ai/squad.js): the boarding, the drive, the men aboard kept in their seats. */
export function stepVehicles(sq, dt) {
  if (sq.board) stepBoarding(sq, dt);
}

/* ------------------------------------------------------------------ backup */

/**
 * A team that heard a call for help (call: { unit, p (where they are), T (their threat) }) and has
 * a stationary vehicle near it mounts up and goes (see the top). Returns its reply, or null when
 * it does not (fighting, near enough to walk, no vehicle that takes them all).
 */
export function mountForBackup(p, call) {
  if (p.board || p.retreating || (p.threat && p.contacted)) return null;
  const men = p.members().filter((m) => !m.dead && !m.down && m.squad !== 'UAV');
  if (men.length < 2) return null;
  const c = cen(men);
  if (d2(c, call.p) < MOUNT_MIN) return null;
  let best = null, bd = Infinity;
  for (const V of findVehicles(p)) {
    const d = d2(V.p(), c);
    if (d > MOUNT_R || !V.usable() || !V.stationary() || !assignSeats(V, men)) continue;
    if (d < bd) (bd = d), (best = V);
  }
  if (!best) return null;
  const T = call.T ?? call.p;
  // put down behind them: on their side away from their threat
  const ax = call.p[0] - T[0], az = call.p[2] - T[2], l = Math.hypot(ax, az) || 1;
  const off = best.kind === 'helicopter' ? 30 : 12;
  const dest = [call.p[0] + (ax / l) * off, call.p[1], call.p[2] + (az / l) * off];
  const lead = p.radioMan();
  const B = startBoarding(p, best, {
    men, lead, leadLast: true, face: T, dest, why: 'backup', call,
    onArrive: (q) => {
      // on the ground: up to them, to cover them
      if (!q.threat) {
        q.threat = T.slice();
        q.navAge = Infinity;
      }
      q.applyOrder?.({ kind: 'flank', to: call.p.slice() });
      q.supporting = { unit: call.unit, T: T.slice(), to: call.p.slice(), until: q.time + 60 };
      const r = q.radioMan();
      if (r) q.say(r, `${q.unit}, on the ground, moving up to ${call.unit}`, 'order');
    },
  });
  if (!B) return null;
  vnote(p, `vehicle:backup:${call.unit}:${best.kind}`);
  return `${p.unit}, copy ${call.unit}, mounting up in the ${WORD[best.kind]}, coming to you, out`;
}
