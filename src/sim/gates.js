import { toggleDoor } from './doors.js';
import { sideOf, hostile, PLAYER_SIDE } from '../ai/sides.js';

/**
 * Gates that are run: a barrier across a road (models/militaryBase.js guardPost: its door 'gate
 * barrier', its booth, its sentries) that a driver radios the base to have raised. Pure logic, no
 * three.js (render/gates.js draws the arm as it swings).
 *
 *   initGates(w)            w.gates (the models' `gates`) made ready: their door, the arm's box,
 *                           the road's way through (g.n: +x of the model, out of the base), who
 *                           mans it (g.unit: its sentries' team), its side (theirs), the base's
 *                           call sign; the cars parked inside near it are the base's (c.side)
 *   stepGates(sim, dt)      each frame (sim/simulation.js motionStep, before the cars): the arm
 *                           swings (opening / closing over GATE_SWING s), the requests answered,
 *                           a sentry walks to the control and works it, it closes once clear
 *   requestGate(w, g, o)    a driver calls the base: o { car, callsign, side, player, who, log }
 *                           → the request ({ answer: null | 'granted' | 'denied' | 'none' })
 *   gateThrough(w, g, car)  "through, close the gate": it closes once nothing is under it
 *   operateGate(w, g, open) raised / lowered by hand (E at it, the door tool)
 *   smashGate(w, g, car)    rammed: the arm snapped off (broken: open for good)
 *   gateNear(w, p, r), gatePassable(g), gateSide(g, p)
 *
 * The states: 'closed' (its voxels in the road: a car stops against them, a man cannot pass),
 * 'opening' and 'closing' (the arm swinging, out of the grid: drawn by render/gates.js), 'open',
 * 'broken' (rammed or blown away: open for good). The arm is in the grid only while closed.
 *
 * A request (the radio, as ai/retreatRadio.js calls between teams: w.events 'radio', spoken and
 * listed): "Base, Kilo, at the gate, request gate open, over." After a moment the base answers:
 *   - friendly, the gate not in lockdown: "Kilo, Base, roger, opening the gate." The nearest fit
 *     sentry walks to the control and raises it (no sentry: the base raises it remotely if it
 *     can); up: "Kilo, Base, gate is open, come through."
 *   - hostile (another side: an AI's driver's side, a car not the base's or one they are fighting
 *     with you in): "Unidentified vehicle at the gate, Base: negative, stop your vehicle." and the
 *     base's teams are put on to it (sq.setThreat): the sentries react.
 *   - lockdown: "negative, the gate stays closed".
 *   - no one to answer (no sentry fit, no remote): no answer at all (the request's answer 'none'
 *     after NO_ANSWER s).
 * Through: "Base, Kilo, through, close the gate." "Kilo, Base, roger, closing." It closes once no
 * car and no man is under the arm (a car the base waved through, you included, is seen through
 * and closed behind without a call). Every step is in g.log ('gate:request:Kilo', 'gate:granted',
 * 'gate:sentry:CMD:to-control', 'gate:opening', 'gate:open', 'gate:through:Kilo', 'gate:closing',
 * 'gate:closed', 'gate:denied', 'gate:hostile', 'gate:no-answer', 'gate:broken', …).
 */

export const GATE_SWING = 2.5; // s the arm takes up or down
const REPLY_T = 1.6; // s before the base answers
export const NO_ANSWER_T = 8; // s: no answer by then, there is none
const SENTRY_SPEED = 1.7; // m/s: a sentry going to the control (he hurries)
const SENTRY_R = 60; // m: a sentry further than this is not at the gate
const HOME_R = 40; // m: a car parked inside, this near: the base's
const AUTO_CLOSE_T = 45; // s: open with no one going through: it is closed again

const d2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const fit = (m) => m && !m.dead && !m.down && !(m.health != null && m.health <= 0) && m.aboard == null;

/** The world's gates made ready (once; new ones as they come). */
export function initGates(w) {
  const gs = w.gates ?? [];
  for (let k = 0; k < gs.length; k++) {
    const g = gs[k];
    if (g.ready) continue;
    g.ready = true;
    g.index = k;
    g.id ??= `gate-${g.owner ?? k}`;
    g.door = (w.doors ?? []).findIndex((d) => d.name === g.name && (g.owner == null || d.owner === g.owner));
    const d = w.doors?.[g.door];
    // the arm's box (world), from its voxels
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const i of d?.voxels ?? []) {
      const c = w.coords(i);
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], c[a] * w.h);
        hi[a] = Math.max(hi[a], (c[a] + 1) * w.h);
      }
    }
    if (!Number.isFinite(lo[0])) {
      const r = g.half ?? 3;
      lo.splice(0, 3, g.p[0] - r, g.p[1] - 0.2, g.p[2] - r);
      hi.splice(0, 3, g.p[0] + r, g.p[1] + 0.2, g.p[2] + r);
    }
    g.box = { min: lo, max: hi };
    g.center = d?.center?.slice() ?? g.p.slice();
    const n = g.dir ?? [1, 0, 0];
    const l = Math.hypot(n[0], n[2]) || 1;
    g.n = [n[0] / l, 0, n[2] / l];
    g.state = d?.open ? 'open' : 'closed';
    g.t = d?.open ? 1 : 0;
    g.voxels0 = d ? d.voxels.length : 0;
    g.log = [];
    g.queue = [];
    g.callsign ??= 'Base';
    g.side ??= sideOfUnit(w, g.unit) ?? 'red';
    g.openT = 0;
    // the cars parked inside, near it: the base's
    for (const c of w.cars ?? []) homeCar(g, c);
  }
  return gs;
}

function homeCar(g, c) {
  if (c.side || c.homeGate) return;
  if (d2([c.x, 0, c.z], g.center) < HOME_R && gateSide(g, [c.x, 0, c.z]) < 0) {
    c.side = g.side;
    c.homeGate = g.id;
  }
}

function sideOfUnit(w, unit) {
  if (!unit) return null;
  const e = (w.enemies ?? []).find((m) => m.unit === unit);
  return e ? sideOf(e) : null;
}

/** Which side of the gate p is on: < 0 inside (the booth's side, -n), > 0 outside; the distance from its line (m). */
export const gateSide = (g, p) => (p[0] - g.center[0]) * g.n[0] + (p[2] - g.center[2]) * g.n[2];
/** Can a car go through it now? */
export const gatePassable = (g) => g.state === 'open' || g.state === 'broken';

/** The gate within r of p (its middle), or null. */
export function gateNear(w, p, r = 30) {
  let best = null, bd = r;
  for (const g of initGates(w)) {
    const d = d2(g.center, p);
    if (d < bd) {
      bd = d;
      best = g;
    }
  }
  return best;
}

/** Its sentries: the men of its team (g.unit). */
export const sentriesOf = (w, g) => (g.unit ? (w.enemies ?? []).filter((m) => m.unit === g.unit) : []);
/** Someone there to work it: a fit sentry near it, or the base's remote. */
export function manned(w, g) {
  return sentriesOf(w, g).some((m) => fit(m) && d2(m.p, g.center) < SENTRY_R);
}

function note(w, g, s, o) {
  g.log.push(s);
  (w.gateLog ??= []).push(`${g.id}:${s}`);
  o?.log?.(s);
}
/** On the radio (w.events: spoken by render/enemies.js, listed by main.js): who's call, or the base's reply. */
export function gateRadio(w, g, text, kind, at) {
  w.events?.push({ type: 'radio', pos: (at ?? g.center).slice(), time: w.time ?? 0, name: text, kind, gate: g.id });
}

/** A driver calls the base to have the gate raised (see the top). o: { car, callsign, side, player, who, log, urgent }. */
export function requestGate(w, g, o = {}) {
  initGates(w);
  const car = o.car ?? null;
  const cs = o.callsign ?? callsignOf(car);
  // (already asked by this car and not yet answered or let through: the same request)
  const same = g.queue.find((r) => r.car === car && !r.done);
  if (same && (same.answer === null || same.answer === 'granted')) return same;
  const r = { car, callsign: cs, side: o.side ?? sideOfCar(w, g, car), player: !!o.player, who: o.who ?? null, log: o.log, t: 0, answer: null, done: false, from: car ? gateSide(g, [car.x, 0, car.z]) : -1 };
  g.queue.push(r);
  note(w, g, `gate:request:${cs}`, r);
  gateRadio(w, g, `${g.callsign}, ${cs}, at the gate, request gate open, over.`, 'call', car ? [car.x, car.y + 1.5, car.z] : null);
  return r;
}

/** A car's call sign: its own (c.callsign), else its kind and number ("Jeep 1"). */
export function callsignOf(car) {
  if (!car) return 'Unknown';
  if (car.callsign) return car.callsign;
  const n = String(car.id ?? '').match(/\d+/)?.[0];
  const kind = (car.label ?? 'vehicle').replace(/^./, (s) => s.toUpperCase());
  return n ? `${kind} ${n}` : kind;
}

/** The side a car shows the gate: its driver's (an AI's), the base's car (you in it), else unknown. */
function sideOfCar(w, g, car) {
  if (!car) return 'unknown';
  const drv = car.seats?.find((s) => s.drive)?.who;
  if (drv && !drv.player && !car.player) return drv.side ?? (drv.unit || drv.squad ? sideOf(drv) : car.side ?? 'unknown');
  // you: a car of theirs passes, unless they are fighting there (a team of theirs with its threat by you)
  if (car.side && car.side === g.side) {
    const fighting = (w.gateHost?.squads ?? []).some((sq) => sq.host?.side === g.side && sq.threat && d2(sq.threat, [car.x, 0, car.z]) < 25);
    if (!fighting && !(g.hostileCars ?? []).includes(car.id)) return g.side;
  }
  return car.side && car.side !== g.side ? car.side : car.player ? PLAYER_SIDE : 'unknown';
}

/** "Through, close the gate": it closes once clear. */
export function gateThrough(w, g, car, o = {}) {
  const r = g.queue.find((q) => q.car === car && !q.done);
  const cs = o.callsign ?? r?.callsign ?? callsignOf(car);
  if (r) r.done = true;
  note(w, g, `gate:through:${cs}`, o.log ? o : r);
  if (!o.silent) gateRadio(w, g, `${g.callsign}, ${cs}, through, close the gate, over.`, 'call', car ? [car.x, car.y + 1.5, car.z] : null);
  if (g.state !== 'broken') {
    g.replies = (g.replies ?? []).concat({ t: REPLY_T * 0.6, text: `${cs}, ${g.callsign}, roger, closing the gate.` });
    g.closeWhenClear = true;
  }
}

/** Raised or lowered by hand (E at it, the door tool): no radio. */
export function operateGate(w, g, open, by = 'hand') {
  initGates(w);
  if (g.state === 'broken') return false;
  const want = open ?? !(g.state === 'open' || g.state === 'opening');
  if (want) startOpening(w, g, by);
  else {
    g.closeWhenClear = true;
    g.forceClose = true;
  }
  return true;
}

/** Rammed: the arm snaps off, the gate is open for good. */
export function smashGate(w, g, car = null) {
  if (g.state === 'broken') return;
  const d = w.doors?.[g.door];
  if (d && !d.open) {
    for (const i of d.voxels) if (w.doorTag[i] === g.door + 1 && w.mat[i]) w.clearVoxel(i);
    d.open = true;
    d.saved = null;
  }
  breakGate(w, g, car ? `rammed by ${callsignOf(car)}` : 'smashed');
  if (car) {
    car.damage = Math.min(1, (car.damage ?? 0) + 0.04);
    (car.sfx ??= []).push({ kind: 'crash', v: Math.abs(car.u ?? 4), p: g.center.slice(), material: 'aluminium' });
  }
  w.noises?.push({ p: g.center.slice(), loud: 30, time: w.time ?? 0, kind: 'impact' });
}

function breakGate(w, g, why) {
  g.state = 'broken';
  g.t = 1;
  g.closeWhenClear = false;
  note(w, g, `gate:broken:${why}`);
  w.events?.push({ type: 'gateBroken', pos: g.center.slice(), time: w.time ?? 0, name: `${g.name} (${why})` });
  // the ground there as a car sees it again (ai/carDriver.js navGrid: what fell is in the way)
  w.navDirty = (w.navDirty ?? []).concat([[g.box.min[0] - 2, g.box.min[2] - 2, g.box.max[0] + 2, g.box.max[2] + 2]]);
}

function startOpening(w, g, by) {
  if (g.state === 'open' || g.state === 'opening' || g.state === 'broken') return;
  // out of the grid as it starts to swing up (render/gates.js draws it)
  if (g.door >= 0 && !w.doors[g.door].open) toggleDoor({ world: w }, g.door, true);
  g.state = 'opening';
  g.closeWhenClear = false;
  g.forceClose = false;
  g.openT = 0;
  note(w, g, `gate:opening:${by}`);
}

/** Anything under the arm (a car's box near it, a man in its span)? */
function underArm(w, g, people) {
  const B = g.box;
  const m = 0.6;
  for (const c of w.cars ?? []) {
    const r = Math.hypot(c.spec.L, c.spec.W) / 2;
    if (c.x + r > B.min[0] - m && c.x - r < B.max[0] + m && c.z + r > B.min[2] - m && c.z - r < B.max[2] + m) {
      // (its box against the arm's line: within its half-length of the line, within the span)
      const s = Math.abs(gateSide(g, [c.x, 0, c.z]));
      if (s < c.spec.L / 2 + 0.8) return true;
    }
  }
  for (const e of people) {
    if (!e?.p || e.dead) continue;
    if (e.p[0] > B.min[0] - 0.4 && e.p[0] < B.max[0] + 0.4 && e.p[2] > B.min[2] - 0.4 && e.p[2] < B.max[2] + 0.4) return true;
  }
  return false;
}

/** The base's teams (the gate's side) put on to a hostile car: they react. */
function alarm(w, g, car) {
  const p = car ? [car.x, car.y, car.z] : g.center.slice();
  let n = 0;
  for (const sq of w.gateHost?.squads ?? []) {
    if ((sq.host?.side ?? 'red') !== g.side) continue;
    sq.setThreat?.(p.slice());
    n++;
  }
  for (const m of sentriesOf(w, g)) if (fit(m)) {
    m.alert = true;
    m.aimAt = p.slice();
  }
  w.events?.push({ type: 'shout', pos: g.center.slice(), time: w.time ?? 0, name: `${g.unit ?? 'sentry'}: hostile vehicle at the gate!` });
  note(w, g, `gate:hostile:${n}`);
}

/** Each frame: the arm, the requests, the sentry at the control, closing once clear. */
export function stepGates(sim, dt) {
  const w = sim.world ?? sim;
  if (!w.gates?.length) return;
  w.gateHost = sim.world ? sim : w.gateHost;
  initGates(w);
  for (const c of w.cars ?? []) for (const g of w.gates) homeCar(g, c);
  const people = () => {
    const out = (w.enemies ?? []).filter((e) => !e.dead && e.aboard == null);
    const pl = sim.ai?.player;
    if (pl?.p) out.push(pl);
    return out;
  };
  for (const g of w.gates) stepGate(w, g, dt, people);
}

function stepGate(w, g, dt, people) {
  const d = w.doors?.[g.door];
  // opened or shut by other means (E at it before it was run, the door tool): taken as it is
  if (d && g.state === 'closed' && d.open) {
    g.state = 'open';
    g.t = 1;
    g.openT = 0;
    note(w, g, 'gate:open:door');
  } else if (d && g.state === 'open' && !d.open) {
    g.state = 'closed';
    g.t = 0;
    note(w, g, 'gate:closed:door');
  }
  // blown or burnt away while down: broken
  if (d && g.state === 'closed' && g.voxels0) {
    let alive = 0;
    for (const i of d.voxels) if (w.doorTag[i] === g.door + 1 && w.mat[i]) alive++;
    if (alive < 0.45 * g.voxels0) breakGate(w, g, 'destroyed');
  }
  // the arm swinging
  if (g.state === 'opening') {
    g.t = Math.min(1, g.t + dt / GATE_SWING);
    if (g.t >= 1) {
      g.state = 'open';
      note(w, g, 'gate:open');
      for (const r of g.queue) if (r.answer === 'granted' && !r.done && !r.toldOpen) {
        r.toldOpen = true;
        gateRadio(w, g, `${r.callsign}, ${g.callsign}, gate is open, come through.`, 'reply');
      }
    }
  } else if (g.state === 'closing') {
    if (underArm(w, g, people())) {
      // something came under it: back up (as a real one's sensor loop does)
      g.state = 'opening';
      note(w, g, 'gate:reopen:obstructed');
    } else {
      g.t = Math.max(0, g.t - dt / GATE_SWING);
      if (g.t <= 0) {
        if (g.door >= 0 && w.doors[g.door].open) toggleDoor({ world: w }, g.door, false);
        g.state = 'closed';
        note(w, g, 'gate:closed');
        releaseSentry(w, g);
      }
    }
  } else if (g.state === 'open') {
    g.openT += dt;
    const waiting = g.queue.some((r) => r.answer === 'granted' && !r.done);
    if ((g.closeWhenClear && (g.forceClose || !waiting)) || (!waiting && g.openT > AUTO_CLOSE_T)) {
      if (!underArm(w, g, people())) {
        g.state = 'closing';
        g.closeWhenClear = false;
        g.forceClose = false;
        note(w, g, 'gate:closing');
      }
    }
  }
  // replies due
  if (g.replies?.length) {
    for (const q of g.replies) q.t -= dt;
    for (const q of g.replies.filter((x) => x.t <= 0)) gateRadio(w, g, q.text, 'reply');
    g.replies = g.replies.filter((x) => x.t > 0);
  }
  // the requests
  for (const r of g.queue) {
    if (r.done) continue;
    r.t += dt;
    if (r.answer === null && !r.silent && r.t >= REPLY_T) answer(w, g, r);
    else if (r.answer === null && r.silent && r.t >= NO_ANSWER_T) {
      r.answer = 'none';
      note(w, g, `gate:no-answer:${r.callsign}`, r);
    }
    // a car waved through (you, an AI who did not say): seen through, closed behind it
    if (r.answer === 'granted' && r.car && gatePassable(g)) {
      const s = gateSide(g, [r.car.x, 0, r.car.z]);
      if (Math.sign(s) !== Math.sign(r.from || -1) && Math.abs(s) > r.car.spec.L / 2 + 2.5) {
        if (r.player) gateThrough(w, g, r.car, { callsign: r.callsign, silent: true });
        else if (Math.abs(s) > r.car.spec.L / 2 + 12) gateThrough(w, g, r.car, { callsign: r.callsign, silent: true });
      }
    }
  }
  // (a refusal or silence is over after a while; a car let through that never came: forgotten)
  for (const r of g.queue) if ((r.answer && r.answer !== 'granted' && r.t > 30) || (r.answer === 'granted' && r.t > 150)) r.done = true;
  g.queue = g.queue.filter((r) => !r.done);
  stepSentry(w, g, dt);
}

function answer(w, g, r) {
  if (g.state === 'broken') {
    r.answer = 'granted';
    note(w, g, `gate:granted:${r.callsign}:broken`, r);
    gateRadio(w, g, `${r.callsign}, ${g.callsign}, the barrier is down, come through.`, 'reply');
    return;
  }
  const remote = !!g.remote && !g.remoteDead;
  const there = manned(w, g);
  if (!there && !remote) {
    // no one to answer: silence
    if (!r.silent) {
      r.silent = true;
      note(w, g, `gate:unmanned:${r.callsign}`, r);
    }
    return;
  }
  if (hostile(g.side, r.side) || r.side === 'unknown') {
    r.answer = 'denied';
    r.hostile = true;
    (g.hostileCars ??= []).push(r.car?.id);
    note(w, g, `gate:denied:${r.callsign}:hostile`, r);
    gateRadio(w, g, `Unidentified vehicle at the gate, ${g.callsign}: negative, stop your vehicle and step out.`, 'reply');
    alarm(w, g, r.car);
    return;
  }
  if (g.lockdown) {
    r.answer = 'denied';
    note(w, g, `gate:denied:${r.callsign}:lockdown`, r);
    gateRadio(w, g, `${r.callsign}, ${g.callsign}, negative, the base is in lockdown, the gate stays closed.`, 'reply');
    return;
  }
  r.answer = 'granted';
  note(w, g, `gate:granted:${r.callsign}`, r);
  if (gatePassable(g)) {
    r.toldOpen = true;
    gateRadio(w, g, `${r.callsign}, ${g.callsign}, gate is open, come through.`, 'reply');
    return;
  }
  if (g.state === 'opening') {
    gateRadio(w, g, `${r.callsign}, ${g.callsign}, roger, gate is going up.`, 'reply');
    return;
  }
  gateRadio(w, g, `${r.callsign}, ${g.callsign}, roger, opening the gate.`, 'reply');
  sendSentry(w, g, remote);
}

/** The nearest fit sentry walks to the control to raise it; none: the base raises it remotely. */
function sendSentry(w, g, remote) {
  if (g.sentry && fit(g.sentry)) return;
  const at = g.control ?? g.center;
  const men = sentriesOf(w, g).filter((m) => fit(m) && d2(m.p, g.center) < SENTRY_R && !m.vehTask && !m.ropeTask);
  men.sort((a, b) => d2(a.p, at) - d2(b.p, at));
  const m = men[0];
  if (m) {
    g.sentry = m;
    m.gateTask = { gate: g.id, to: at.slice(), phase: 'go' };
    m.path = null;
    note(w, g, `gate:sentry:${m.squad ?? m.role ?? 'sentry'}:to-control`);
    return;
  }
  if (remote) {
    g.remoteT = 1.5;
    note(w, g, 'gate:remote');
  }
}

function stepSentry(w, g, dt) {
  if (g.remoteT != null) {
    g.remoteT -= dt;
    if (g.remoteT <= 0) {
      g.remoteT = null;
      startOpening(w, g, 'remote');
    }
  }
  const m = g.sentry;
  if (!m) return;
  const T = m.gateTask;
  if (!fit(m) || !T) {
    // down on the way: another, or the base remotely
    if (m.gateTask) m.gateTask = null;
    g.sentry = null;
    note(w, g, 'gate:sentry:lost');
    if (g.state === 'closed' && g.queue.some((r) => r.answer === 'granted' && !r.done)) sendSentry(w, g, !!g.remote);
    return;
  }
  if (T.phase === 'go') {
    const dx = T.to[0] - m.p[0], dz = T.to[2] - m.p[2];
    const L = Math.hypot(dx, dz);
    if (L < 0.35) {
      T.phase = 'work';
      T.t = 0;
      m.moving = false;
      m.speed = 0;
      m.anim = 'idle';
      note(w, g, `gate:sentry:${m.squad ?? 'sentry'}:at-control`);
    } else {
      const s = Math.min(L, SENTRY_SPEED * dt);
      m.p = [m.p[0] + (dx / L) * s, m.p[1], m.p[2] + (dz / L) * s];
      m.yaw = Math.atan2(dx, dz);
      m.moving = true;
      m.speed = SENTRY_SPEED;
      m.anim = 'walk';
    }
  } else if (T.phase === 'work') {
    T.t += dt;
    // (the face to the barrier, a hand on the lever)
    m.yaw = Math.atan2(g.center[0] - m.p[0], g.center[2] - m.p[2]);
    if (T.t > 0.8 && g.state === 'closed') startOpening(w, g, `sentry:${m.squad ?? 'sentry'}`);
  }
}

function releaseSentry(w, g) {
  const m = g.sentry;
  if (!m) return;
  if (m.gateTask) m.gateTask = null;
  m.moving = false;
  g.sentry = null;
  note(w, g, 'gate:sentry:back');
}
