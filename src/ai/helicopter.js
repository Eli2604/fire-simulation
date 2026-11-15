/**
 * The helicopter: a medium utility helicopter (a Black Hawk's size and weight) with a pilot, a
 * co-pilot and up to eight soldiers in the back, flown by its own pilot AI along a mission (fly in,
 * hover over the landing zone and put the troops down on cables, or land and let them out, then
 * climb away and circle the place with the door guns), its hit parts and what each does when it
 * goes, and how it comes down. No three.js here (render/heliMesh.js draws it, render/helis.js puts
 * the simulation's in the scene, rig/heli.js shows it on the rig stage): the tests use it as it is.
 *
 *  - Flight. A pilot model rather than blade aerodynamics: the pilot wants a velocity (to a point,
 *    round a circle, up or down to a height) and gets there with the accelerations a helicopter has
 *    (HELI.accel across, HELI.vAccel up and down, less with a damaged engine). The attitude follows
 *    from it as on a real one: the disc tilts where it accelerates (nose down to speed up, nose up to
 *    slow down: the flare; banked in a turn). The rotor spins up on the ground before it can lift
 *    (HELI.spinUp) and runs down after it lands; the side doors slide open and shut.
 *  - Missions (`mission`): 'insert' (fly in, hover HELI.hoverAlt over the landing zone, the troops
 *    slide down two cables, cut them, climb away and circle), 'land' (land, the troops jump out,
 *    take off and circle), 'overwatch' (circle the place with the doors open: the guns), 'hover'.
 *  - Crew (heliSeats): pilot (right seat), co-pilot (left), then the men in the back: the first one
 *    or two man the door guns (a pintle machine gun in each door: `doorGuns`), the rest are troops
 *    on the benches. They are the simulation's own soldiers (w.enemies: the squad AI's men, drawn by
 *    render/enemies.js), held in their seats (`guardCtl`: neither the guard nor the squad AI moves
 *    them; `aboard`: the helicopter's id). With a door open the gunner fires at what he sees on his
 *    side, and the troop nearest each door fires his own weapon out of it (sim/wounds.js shoot:
 *    the same rounds, tracers and reports). A trooper on a cable is the rope module's (below);
 *    down, he is his squad's again (ai/squad.js).
 *  - Hit parts: models/vehicleZones.js VEHICLE_ZONES.helicopter (the rig's table, editable there).
 *    A bullet (sim/wounds.js shoot), an arrow or rocket (sim.hitEnemy) or a blast (explode) at a
 *    part damages it (hitPart): the cockpit hits a pilot, the cabin the men in the back, the fuel
 *    tank leaks and then burns, the engine smokes and then quits, the tail rotor or its boom goes:
 *    no yaw control, the mast or the blades go: no lift.
 *  - How it comes down depends on what went (`failure`):
 *      'tail'    no tail rotor: the main rotor's torque spins the fuselage round the mast (faster and
 *                faster, HELI.tailSpin), the pilot lowers the collective (a steep but survivable
 *                descent) and rolls off the throttle near the ground: a spinning hard landing.
 *      'main'    the mast or the blades gone: no lift at all, it drops like a stone (only the air's
 *                drag), tumbling; the blades fly off (debris that can hit people).
 *      'engine'  autorotation: the descent keeps the rotor turning, it glides down at ~9 m/s with
 *                some forward speed and flares just above the ground: a hard landing.
 *      'pilot'   both pilots down: nobody flies it, it drifts and rolls and goes in.
 *    A burning fuel tank: the pilot puts it down at once; in the air too long, it blows up (then
 *    'main'). Every touchdown and crash goes through sim/impact.js (force, shockwave, sound); a
 *    crash hurts the crew by how hard it was, the fuel can catch (sim.ignite and a torch: the fire
 *    simulation burns there), the survivors climb out and fight on the ground.
 *
 * The cables (ai/rope.js does the men on them): each is a plain object in w.ropes,
 *   { id, kind: 'fastrope', top: [x,y,z], bottom: [x,y,z], owner, attached: true }
 * The helicopter writes bottom once, when it throws the cable out (to the ground, or its length),
 * and moves top with its door every step (an attached fast rope hangs straight down from its top
 * at the length it had when first seen). A trooper goes with startRope(sim, soldier, rope): false
 * while the man before him is still within 3.2 m of the top, so the next one is tried every step;
 * its mount phase takes him from his place in the cabin onto the cable. sim/simulation.js steps
 * the men on it (stepRopes); off it (soldier.rope null again), his squad has him.
 *
 * API
 *   const h = new Helicopter({ p, yaw, lz, mission, soldiers, doorGuns, ... }, host);
 *   h.step(dt);                      // fly, fight, fall (host: ground, targets, fire, world, ...)
 *   h.hit('tailRotor', 400);         // damage a part (VEHICLE_WEAPONS: bullet 25, rocket 350)
 *   heliHitZone(h, p)                // the part at world point p: { k, zone, local } or null
 *   heliRayHit(h, from, dir, max)    // the part a ray meets first: { k, zone, t, p } or null
 *   heliSeats(n, doorGuns)           // the seats: pilot, co-pilot, door gunners, troops
 *   new HeliAI(sim)                  // the simulation's helicopters (w.helis): steps, bullets, blasts
 */
import { VEHICLE_ZONES, VEHICLE_WEAPONS, vehicleZones, rayZone, hitPart, integrity } from '../models/vehicleZones.js';
import { impact, groundMaterial } from '../sim/impact.js';
import { shoot, wound } from '../sim/wounds.js';
import { explode } from '../sim/explosions.js';
import { emitSound } from './perception.js';
import { startRope } from './rope.js';

const G = 9.81;
/** The helicopter's numbers (a UH-60-sized machine). */
export const HELI = {
  mass: 7000, // kg, loaded
  rotorR: 8, // main rotor radius (m)
  rotorRev: 4.3, // main rotor rev/s at 100 % (258 rpm)
  tailRev: 19.8, // tail rotor rev/s
  blades: 4,
  cruise: 45, // m/s (~90 kt)
  climb: 7, // m/s up
  sink: 5, // m/s down (normal)
  accel: 3.5, // m/s² across
  vAccel: 3, // m/s² up / down
  decel: 2.2, // m/s² the approach plans with (the flare)
  yawRate: 0.6, // rad/s the pilot turns it at
  spinUp: 9, // s from still to flight rpm
  floor: 0.75, // the cabin floor above the skids (m)
  hoverAlt: 12, // over the landing zone for a fast-rope (m)
  ropeLength: 20, // m
  ropeGap: 1.4, // s between two men on one rope
  bladeChance: 0.3, // a round through the spinning main rotor's disc that meets a blade
  tailBladeChance: 0.5,
  doorRate: 0.7, // door travel per second (0 shut … 1 open)
  // failures
  tailSpin: 1.4, // rad/s² the fuselage spins up at with no tail rotor
  tailSpinMax: 4.2, // rad/s (two-thirds of a turn a second)
  tailLift: 0.78, // of g: the collective lowered (less torque)
  autoSink: 9, // m/s down in autorotation
  glide: 26, // m/s forward in autorotation
  flareAlt: 12, // m: the autorotation's flare starts here
  dragK: G / 45 ** 2, // quadratic drag of the falling airframe (terminal ~45 m/s)
  burn: 14, // s from a burning fuel tank to the explosion (if still in the air)
  // touchdown speeds (m/s, down): a landing below `safe`, a hard landing below `hard`, a crash below `fatal`
  safe: 3.5,
  hard: 8.5,
  fatal: 16,
  // the guns
  gunRange: 160,
  gunRate: 10, // rounds/s (a 7.62 mm pintle gun)
  gunBurst: 12,
  rifleRate: 3,
  rifleBurst: 3,
};

/** Where the men are, in the helicopter's frame (front +x, right +z, skids at y = 0). face: yaw offset (0 forward, +π/2 left, -π/2 right). */
const F = HELI.floor;
const PILOTS = [
  { role: 'pilot', at: [2.9, F, 0.5], face: 0, anim: 'deskSit', label: 'Pilot' },
  { role: 'copilot', at: [2.9, F, -0.5], face: 0, anim: 'deskSit', label: 'Co-pilot' },
];
/** side: -1 left (−z), +1 right (+z). */
const sideName = (s) => (s < 0 ? 'L' : 'R');
const SIDES = { both: [-1, 1], left: [-1], right: [1], none: [] };
/** The door gun's mount and the gunner's place, per side; the door opening (x from..to); the cable's anchor above the door. */
export const DOOR = {
  gun: (s) => [1.55, 1.55, s * 1.12],
  gunner: (s) => [1.25, F, s * 0.62],
  shooter: (s) => [0.35, F, s * 0.82],
  anchor: (s) => [0.6, 2.3, s * 1.32],
  opening: [-0.1, 1.85],
};

/**
 * The seats for `n` men in the back (0..8): pilot, co-pilot, then a door gunner per gun side
 * (`doorGuns`: 'both' | 'left' | 'right' | 'none', from the men in the back), then the troops
 * on the benches (two rows facing out, the front pair by the doors).
 */
export function heliSeats(n = 6, doorGuns = 'both') {
  n = Math.max(0, Math.min(8, n | 0));
  const seats = PILOTS.map((s) => ({ ...s, at: s.at.slice() }));
  const guns = (SIDES[doorGuns] ?? SIDES.both).slice(0, n);
  for (const s of guns) seats.push({ role: 'gunner', side: s, at: DOOR.gunner(s), face: s < 0 ? Math.PI / 2 : -Math.PI / 2, anim: 'aim', label: `Door gunner (${s < 0 ? 'left' : 'right'})` });
  for (let i = 0; i < n - guns.length; i++) {
    const s = i % 2 ? 1 : -1;
    const row = i >> 1;
    seats.push({ role: 'troop', side: s, row, at: [0.35 - row * 0.72, F, s * 0.55], face: s < 0 ? Math.PI / 2 : -Math.PI / 2, anim: 'deskSit', label: `Trooper ${i + 1}` });
  }
  return seats;
}

const TROOP_ROLES = ['CMD', 'MG', 'R1', 'R2', 'R1', 'R2', 'R1', 'R2'];
const AIR_ROLES = { pilot: 'CMD', copilot: 'R1', gunner: ['MG', 'R2'] };

/* ---------------- small vector helpers ---------------- */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/**
 * The helicopter's axes in the world: f (forward, its +x), u (up, +y), r (right, +z), from its
 * yaw (the soldiers' convention: forward is (sin yaw, 0, cos yaw)), pitch (nose up +) and roll
 * (right side down +). render/heliMesh.js sets its matrix from the same three (makeBasis).
 */
export function heliAxes(yaw, pitch = 0, roll = 0) {
  const sy = Math.sin(yaw), cy = Math.cos(yaw);
  const f0 = [sy, 0, cy], r0 = [-cy, 0, sy];
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const f = [f0[0] * cp, sp, f0[2] * cp];
  const u1 = [-f0[0] * sp, cp, -f0[2] * sp];
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const r = [r0[0] * cr - u1[0] * sr, -u1[1] * sr, r0[2] * cr - u1[2] * sr];
  const u = [u1[0] * cr + r0[0] * sr, u1[1] * cr, u1[2] * cr + r0[2] * sr];
  return { f, u, r };
}
/** A point of the helicopter's frame in the world. */
export function heliToWorld(h, l, A = heliAxes(h.yaw, h.pitch, h.roll)) {
  return [0, 1, 2].map((i) => h.p[i] + A.f[i] * l[0] + A.u[i] * l[1] + A.r[i] * l[2]);
}
/** A world point (or with dirOnly a direction) in the helicopter's frame. */
export function heliToLocal(h, q, dirOnly = false, A = heliAxes(h.yaw, h.pitch, h.roll)) {
  const d = dirOnly ? q : sub(q, h.p);
  return [dot(d, A.f), dot(d, A.u), dot(d, A.r)];
}

/** The part of helicopter h at world point p: { k, zone, local } or null (a part shot away is not there). */
export function heliHitZone(h, p) {
  if (len(sub(p, h.p)) > 13) return null;
  const l = heliToLocal(h, p);
  for (const Z of vehicleZones('helicopter')) {
    if (h.gone?.has(Z.k)) continue;
    if (Z.boxes.some((b) => insideBox(l, b, Z.shape, Z.axis))) return { k: Z.k, zone: Z.zone, local: l };
  }
  return null;
}
function insideBox(p, b, shape, axis) {
  const d = [0, 1, 2].map((i) => (p[i] - b.c[i]) / b.h[i]);
  if (d.some((v) => Math.abs(v) > 1)) return false;
  if (shape !== 'cyl') return true;
  const a = 'xyz'.indexOf(axis);
  const [u, v] = [0, 1, 2].filter((i) => i !== a);
  return d[u] * d[u] + d[v] * d[v] <= 1;
}

/**
 * The part a ray (world from, dir) meets first on helicopter h, up to max m: { k, zone, t, p } or
 * null. Through a spinning rotor's disc a round meets a blade only now and then (`chance`, a
 * 0..1 draw; default h's own): else it goes on to what is behind it.
 */
export function heliRayHit(h, from, dir, max = 1000, chance = null) {
  const D = norm(dir);
  // only near it: within its reach of the mast
  const c = sub(h.p, from);
  const s0 = dot(c, D);
  if (s0 < -12 || len(sub(c, D.map((x) => x * s0))) > 12) return null;
  const A = heliAxes(h.yaw, h.pitch, h.roll);
  const lf = heliToLocal(h, from, false, A);
  const ld = heliToLocal(h, D, true, A);
  const skip = new Set(h.gone ?? []);
  for (let k = 0; k < 4; k++) {
    const hit = rayZone('helicopter', lf, ld, max, undefined, skip);
    if (!hit) return null;
    const spin = hit.k === 'rotor' ? h.omega > 0.3 && HELI.bladeChance : hit.k === 'tailRotor' ? h.omega > 0.3 && HELI.tailBladeChance : false;
    if (spin && (chance ?? h.rand()) > spin) {
      skip.add(hit.k);
      continue;
    }
    return { k: hit.k, zone: hit.zone, t: hit.t, p: heliToWorld(h, hit.p, A) };
  }
  return null;
}


let NEXT = 0;

/**
 * One helicopter. `o`: { p (where it starts: on the ground, or the point under it in the air),
 * yaw, lz (the landing zone), exit?, mission, airborne, altitude, cruise, hoverAlt, ropeLength,
 * orbitRadius, soldiers, doorGuns, callsign, seed, autoStart }. `host` connects it to a world:
 *   ground(x, z) → y             what is under it (default 0)
 *   world                        { time, events, noises, enemies, ropes } (the rope list, the crew)
 *   sim                          the Simulation (sim/impact.js, wounds, fire), if there is one
 *   targets() → [[x,y,z], ...]   what the guns are after
 *   sees(a, b) → bool            a line of sight (default: yes)
 *   fire(e, from, dir, weapon)   one round (default: sim/wounds.js shoot on host.sim)
 *   hurt(e, amount), wound(e, zone, weapon, p, dir), ignite(p, r), torch(p, W, s, r), explode(p, E)
 *   radio(h, text)
 */
export class Helicopter {
  constructor(o = {}, host = {}) {
    this.host = host;
    this.id = o.id ?? `heli${++NEXT}`;
    this.call = o.callsign ?? 'Hawk';
    this.rand = rng(o.seed ?? 7);
    this.mission = o.mission ?? 'insert';
    this.cruise = o.cruise ?? HELI.cruise;
    this.altitude = o.altitude ?? 40;
    this.hoverAlt = Math.min(o.hoverAlt ?? HELI.hoverAlt, (o.ropeLength ?? HELI.ropeLength) - 1);
    this.ropeLength = o.ropeLength ?? HELI.ropeLength;
    this.orbitR = o.orbitRadius ?? 70;
    this.lz = (o.lz ?? o.p ?? [0, 0, 0]).slice();
    this.p = (o.p ?? [0, 0, 0]).slice();
    this.yaw = o.yaw ?? 0;
    this.airborne = o.airborne !== false;
    if (this.airborne) this.p[1] = this.ground(this.p[0], this.p[2]) + (o.startAlt ?? this.altitude);
    else this.p[1] = this.ground(this.p[0], this.p[2]);
    this.exit = (o.exit ?? [this.lz[0] + (this.lz[0] - this.p[0]) * 0.5 + 1, 0, this.lz[2] + (this.lz[2] - this.p[2]) * 0.5]).slice();
    this.v = [0, 0, 0];
    if (this.airborne) {
      // (no faster than it can stop at the zone from where it starts)
      const sp = o.startSpeed ?? Math.min(this.cruise * 0.8, Math.sqrt(2 * HELI.decel * Math.hypot(this.lz[0] - this.p[0], this.lz[2] - this.p[2])));
      this.v = [Math.sin(this.yaw) * sp, 0, Math.cos(this.yaw) * sp];
    }
    this.yawRate = 0;
    this.pitch = 0;
    this.roll = 0;
    this.pitchRate = 0;
    this.rollRate = 0;
    this.omega = this.airborne ? 1 : 0; // rotor speed, of flight rpm
    this.rotorAngle = 0;
    this.tailAngle = 0;
    this.blades = HELI.blades;
    this.doors = { L: 0, R: 0 };
    this.doorsWant = { L: 0, R: 0 };
    this.dmg = {}; // part → 0 whole … 1 destroyed (models/vehicleZones.js hitPart)
    this.gone = new Set(); // parts shot away (the tail rotor, the blades): no longer there to hit
    this.failure = null;
    this.failT = 0;
    this.fire = 0; // the fuel burning (0..1)
    this.burnT = 0;
    this.leak = 0;
    this.fuel = 1;
    this.smoke = 0; // engine smoke (0..1)
    this.vibration = 0;
    this.glass = false; // the cockpit glass shattered
    this.skidsBent = false;
    this.mode = this.airborne ? 'transit' : o.autoStart === false ? 'parked' : 'spinUp';
    this.t = 0; // in this mode
    this.time = 0;
    this.landed = !this.airborne;
    this.crashed = false;
    this.severity = null;
    this.ropes = [];
    this.debris = []; // blades and the tail rotor flying off: { p, v, spin, a, kind, rest }
    this.shots = 0;
    this.guns = { L: { yaw: 0, pitch: 0, flash: -1, ammo: 1500, cd: 0, burst: 0 }, R: { yaw: 0, pitch: 0, flash: -1, ammo: 1500, cd: 0, burst: 0 } };
    this.log = [];
    this.seats = heliSeats(o.soldiers ?? 6, o.doorGuns ?? 'both');
    this.crew = this.seats.map((s, i) => this.makeCrew(s, i));
    for (const e of this.crew) host.addCrew?.(e);
    this.placeCrew();
  }

  /* ---------------- the world, through the host ---------------- */
  get world() {
    return (this.host.world ??= { time: 0, events: [], noises: [], enemies: [], ropes: [] });
  }
  ground(x, z) {
    return this.host.ground?.(x, z) ?? 0;
  }
  event(type, extra = {}) {
    const w = this.world;
    const ev = { type, pos: this.p.slice(), time: w.time ?? this.time, name: this.call, heli: this.id, ...extra };
    w.events?.push(ev);
    this.log.push(ev);
    if (this.log.length > 60) this.log.shift();
    return ev;
  }
  radio(text) {
    if (this.host.radio) this.host.radio(this, text);
    else this.event('radio', { name: `${this.call}: ${text}`, kind: 'call' });
  }
  get axes() {
    return heliAxes(this.yaw, this.pitch, this.roll);
  }
  toWorld(l) {
    return heliToWorld(this, l);
  }

  /* ---------------- the crew ---------------- */
  makeCrew(seat, i) {
    const air = seat.role !== 'troop';
    const troopI = this.seats.slice(0, i).filter((s) => s.role === 'troop').length;
    const gunI = this.seats.slice(0, i).filter((s) => s.role === 'gunner').length;
    const squad = air ? (seat.role === 'gunner' ? AIR_ROLES.gunner[gunI] ?? 'R2' : AIR_ROLES[seat.role]) : TROOP_ROLES[troopI] ?? 'R1';
    return {
      p: [0, 0, 0], home: [0, 0, 0], health: 100, state: 'patrol', yaw: 0,
      squad, unit: air ? `${this.call} crew` : this.call, loadout: !air && squad === 'MG' ? 'mg' : 'rifle',
      skill: seat.role === 'pilot' ? 'veteran' : 'regular', armour: true, helmet: true,
      guardCtl: true, // neither the guard AI nor the squad AI moves him while he is aboard (ai/squad.js ownMove)
      heliCrew: this.id, aboard: this.id, seat: i, role: seat.role, anim: seat.anim, name: `${this.call} ${seat.label.toLowerCase()}`,
    };
  }
  aboard() {
    return this.crew.filter((e) => e.aboard === this.id);
  }
  pilots() {
    return this.crew.filter((e) => (e.role === 'pilot' || e.role === 'copilot') && e.aboard === this.id && !e.dead);
  }
  /** Each man aboard in his place (the gunner at his gun, the door shooter in the door), facing his way. */
  placeCrew() {
    const A = this.axes;
    const w = this.world;
    for (const e of this.crew) {
      if (e.aboard !== this.id) continue;
      const s = this.seats[e.seat];
      const at = e.atDoor ? DOOR.shooter(s.side) : s.at;
      e.p = heliToWorld(this, at, A);
      e.home = e.p.slice();
      e.yaw = e.aiming && !e.dead && e.aimYawWorld != null ? e.aimYawWorld : this.yaw + s.face;
      e.moving = false;
      if (e.dead) e.anim = 'die';
      else if (s.role === 'gunner') e.anim = (this.guns[sideName(s.side)].flash ?? -1) > this.time - 0.15 ? 'shoot' : 'aim';
      else if (e.atDoor) e.anim = (e.flashUntil ?? -1) > (w.time ?? 0) - 0.3 ? 'crouchShoot' : 'crouchAim';
      else e.anim = s.anim;
    }
  }

  /* ---------------- damage ---------------- */
  /**
   * A hit of `amount` (VEHICLE_WEAPONS: bullet 25, rocket 350) on part k (at world point p,
   * travelling along dir, by `weapon`): the part's damage, and what it does.
   */
  hit(k, amount, p = null, dir = null, weapon = 'bullet') {
    if (this.gone.has(k)) return null;
    const r = hitPart(this.dmg, 'helicopter', k, amount);
    if (!r) return null;
    const zone = VEHICLE_ZONES.helicopter.find((z) => z.k === k);
    this.event('heliHit', { zone: k, label: zone.label, damage: r.amount, value: r.value, destroyed: r.destroyed });
    const big = amount >= VEHICLE_WEAPONS.shell;
    const q = p ?? this.toWorld(zone.boxes[0].c);
    if (k === 'cockpit') {
      if (r.value > 0.25 || big) this.glass = true;
      // the man on the side it came in on (the pilot sits right)
      const l = heliToLocal(this, q);
      const ps = this.pilots();
      const who = ps.find((e) => (e.role === 'pilot') === l[2] >= 0) ?? ps[0];
      if (who && (big || this.rand() < 0.6)) this.hurtMan(who, big ? 'torso' : this.rand() < 0.3 ? 'head' : 'torso', weapon, q, dir, big ? 120 : 0);
    } else if (k === 'cabin') {
      // the man nearest where it came through (or, a rocket, everyone near)
      const l = heliToLocal(this, q);
      const men = this.aboard().filter((e) => !e.dead && this.seats[e.seat].role !== 'pilot' && this.seats[e.seat].role !== 'copilot');
      men.sort((a, b) => len(sub(this.seats[a.seat].at, l)) - len(sub(this.seats[b.seat].at, l)));
      for (const e of big ? men.slice(0, 3) : men.slice(0, 1)) if (big || this.rand() < 0.7) this.hurtMan(e, 'torso', weapon, q, dir, big ? 90 : 0);
    } else if (k === 'fuel') {
      this.leak = Math.max(this.leak, r.value);
      if (r.destroyed || (big && r.value > 0.5)) this.ignite();
    } else if (k === 'engine') {
      this.smoke = Math.max(this.smoke, r.value);
      if (r.destroyed) this.fail('engine', 'the engines quit');
    } else if (k === 'tailRotor' || k === 'tailBoom') {
      if (r.destroyed) {
        this.gone.add('tailRotor');
        if (k === 'tailBoom') this.gone.add('tailBoom');
        this.shed('tailRotor');
        this.fail('tail', k === 'tailBoom' ? 'the tail boom is shot through' : 'the tail rotor is gone');
      }
    } else if (k === 'rotor' || k === 'mast') {
      this.vibration = Math.max(this.vibration, r.value);
      if (r.destroyed) {
        this.gone.add('rotor');
        this.shed('blades');
        this.fail('main', k === 'mast' ? 'the mast is hit, the rotor comes apart' : 'the blades are shot off');
      }
    } else if (k === 'skids') {
      if (r.value > 0.5) this.skidsBent = true;
    }
    return r;
  }
  /** A man aboard is hit (sim/wounds.js wound, through the host), or takes `extra` damage outright. */
  hurtMan(e, zone, weapon, p, dir, extra = 0) {
    if (e.dead) return;
    const kind = weapon === 'rocket' || weapon === 'shell' ? 'fragment' : weapon === 'bullet' ? 'rifle' : weapon;
    if (this.host.wound) this.host.wound(e, zone, kind, p ?? e.p, dir ?? [0, -1, 0]);
    else this.hurt(e, zone === 'head' ? 160 : 55);
    if (extra) this.hurt(e, extra);
  }
  hurt(e, amount) {
    if (e.dead || amount <= 0) return;
    if (this.host.hurt) return this.host.hurt(e, amount);
    e.health -= amount;
    if (e.health <= 0) {
      e.health = 0;
      e.dead = true;
      this.world.events?.push({ type: 'enemyDown', pos: e.p.slice(), time: this.world.time ?? 0, name: 'enemy' });
    }
  }
  /** What goes wrong. The worst one stays: no lift, then no tail rotor, then no engine, then no pilot. */
  fail(kind, why = '') {
    const RANK = { main: 4, tail: 3, engine: 2, pilot: 1 };
    if (this.crashed || (this.failure && RANK[this.failure] >= RANK[kind])) return;
    if (this.landed && kind !== 'main') {
      // on the ground: it stays there (the rotor runs down)
      this.failure = kind;
      this.mode = 'shutdown';
      return;
    }
    this.failure = kind;
    this.failT = 0;
    this.mode = 'falling';
    this.t = 0;
    this.event('heliFailure', { failure: kind, why });
    const MAYDAY = { tail: 'lost tail rotor, spinning', main: 'rotor gone, going in', engine: 'engine failure, autorotating', pilot: '' };
    if (kind !== 'pilot' && this.pilots().length) this.radio(`mayday, mayday, ${MAYDAY[kind]}`);
  }
  /** The fuel tank alight: the pilot puts it down at once (if he has a rotor to do it with). */
  ignite() {
    if (this.fire > 0) return;
    this.fire = 1;
    this.burnT = 0;
    this.event('heliFire');
    if (!this.failure && !this.landed && !this.crashed) {
      this.mode = 'emergency';
      this.t = 0;
      if (this.pilots().length) this.radio('fire, fire, putting her down');
    }
  }
  /** Rotor blades (or the tail rotor) flying off. */
  shed(what) {
    const A = this.axes;
    if (what === 'blades') {
      const n = this.blades;
      this.blades = 0;
      for (let i = 0; i < n; i++) {
        const a = this.rotorAngle + (i * 2 * Math.PI) / n;
        const out = [Math.cos(a) * A.f[0] + Math.sin(a) * A.r[0], 0, Math.cos(a) * A.f[2] + Math.sin(a) * A.r[2]];
        const tip = HELI.rotorR * HELI.rotorRev * 2 * Math.PI * 0.5 * this.omega; // flung at the speed of its middle
        const c = this.toWorld([0, 3.6, 0]);
        this.debris.push({ kind: 'blade', p: [c[0] + out[0] * 3, c[1], c[2] + out[2] * 3], v: [this.v[0] + out[0] * tip * 0.3 + out[2] * tip * 0.2, this.v[1] + 4 + this.rand() * 6, this.v[2] + out[2] * tip * 0.3 - out[0] * tip * 0.2], a: a, spin: 8 + this.rand() * 8, rest: false, t: 0 });
      }
    } else {
      const c = this.toWorld([-9.3, 3, 0.35]);
      this.debris.push({ kind: 'tailRotor', p: c, v: [this.v[0] + A.r[0] * 6, this.v[1] + 3, this.v[2] + A.r[2] * 6], a: 0, spin: 20, rest: false, t: 0 });
    }
    this.event('heliShed', { what });
  }

  /* ---------------- each step ---------------- */
  step(dt) {
    if (dt <= 0) return;
    this.time += dt;
    this.t += dt;
    this.stepFire(dt);
    if (!this.crashed) {
      if (!this.failure && this.pilots().length === 0 && !this.landed) this.fail('pilot', 'both pilots are down');
      if (this.failure && this.mode === 'falling') this.stepFailure(dt);
      else this.stepMission(dt);
      this.stepGround(dt);
    } else this.stepWreck(dt);
    this.stepRotor(dt);
    this.stepDoors(dt);
    this.stepCables(dt);
    this.placeCrew();
    this.stepGuns(dt);
    this.stepDebris(dt);
    this.stepDeployed();
    // its noise: the rotor's thud carries far (the guards' side does not care: ai/perception.js 'enemy')
    if (this.omega > 0.3 && (this.noiseT = (this.noiseT ?? 0) - dt) <= 0) {
      this.noiseT = 1.5;
      emitSound(this.world, { pos: this.toWorld([0, 3, 0]), loudness_dB: 125 * this.omega, kind: 'enemy' });
    }
  }

  stepFire(dt) {
    if (this.leak > 0) this.fuel = Math.max(0, this.fuel - this.leak * 0.004 * dt);
    if (this.fire <= 0) return;
    this.burnT += dt;
    this.fuel = Math.max(0, this.fuel - 0.01 * dt);
    // too long in the air with the tank alight: it blows up
    if (!this.crashed && !this.landed && this.burnT > HELI.burn) {
      const c = this.toWorld([-1.1, 0.8, 0]);
      this.event('heliExplosion', { pos: c });
      this.host.explode?.(c, 2.5e6);
      for (const e of this.aboard()) this.hurt(e, 60 + this.rand() * 80);
      this.dmg.fuel = 1;
      this.gone.add('rotor');
      this.shed('blades');
      this.failure = null; // (the worst there is)
      this.fail('main', 'the fuel blew up');
    }
  }

  /* ---------------- the pilot: missions ---------------- */
  /** The landing zone's height, and a safe height over where it is now. */
  lzY() {
    return this.ground(this.lz[0], this.lz[2]);
  }
  /** The height it hovers at over the zone (the cables reach the ground from there). */
  hoverY() {
    return this.lzY() + this.hoverAlt;
  }
  setMode(m) {
    if (this.mode !== m) {
      this.mode = m;
      this.t = 0;
      this.event('heliMode', { mode: m });
    }
  }
  stepMission(dt) {
    const lzY = this.lzY();
    const cruiseY = Math.max(lzY + this.altitude, this.ground(this.p[0], this.p[2]) + 15);
    const d = Math.hypot(this.lz[0] - this.p[0], this.lz[2] - this.p[2]);
    const sides = this.seats.filter((s) => s.role === 'troop' || s.role === 'gunner').map((s) => s.side);
    const shut = () => (this.doorsWant = { L: 0, R: 0 });
    const open = (both = true) => (this.doorsWant = both ? { L: 1, R: 1 } : { L: sides.includes(-1) ? 1 : 0, R: sides.includes(1) ? 1 : 0 });
    switch (this.mode) {
      case 'parked':
      case 'shutdown':
        this.omegaWant = 0;
        return this.hold(dt);
      case 'spinUp':
        this.omegaWant = 1;
        shut();
        if (this.omega > 0.97) this.setMode('takeoff');
        return this.hold(dt);
      case 'takeoff': {
        const gy = this.ground(this.p[0], this.p[2]);
        this.fly(dt, { y: gy + (this.t < 3 ? 4 : this.altitude), speed: this.t < 3 ? 0 : this.cruise * 0.6, to: this.t < 3 ? null : this.next ?? this.lz });
        if (this.p[1] - gy > 12) this.setMode(this.next ? 'depart' : 'transit');
        return;
      }
      case 'transit': {
        if (this.mission === 'overwatch') {
          if (d < this.orbitR * 1.5) this.setMode('orbit');
        } else if (d < Math.max(120, this.cruise ** 2 / (2 * HELI.decel) + 30)) this.setMode('approach');
        return this.fly(dt, { to: this.lz, speed: this.cruise, y: cruiseY });
      }
      case 'approach':
      case 'flare': {
        // slowing to stop over the zone (the flare: nose up), down to the hover height
        const land = this.mission === 'land';
        const hoverY = land ? lzY + 4 : this.hoverY();
        const y = d > 60 ? Math.max(hoverY, Math.min(cruiseY, hoverY + d * 0.25)) : hoverY;
        this.fly(dt, { to: this.lz, speed: this.cruise, y, plan: true });
        if (this.mode === 'approach' && d < 70) this.setMode('flare');
        const sp = Math.hypot(this.v[0], this.v[2]);
        if (d < 2.5 && sp < 1.5 && Math.abs(this.p[1] - hoverY) < 1.5) this.setMode(land ? 'land' : 'hover');
        return;
      }
      case 'hover': {
        open(this.mission !== 'hover');
        this.fly(dt, { to: this.lz, speed: 4, y: this.hoverY() });
        if (this.mission === 'insert') this.stepFastRope(dt);
        return;
      }
      case 'land': {
        const gy = this.ground(this.p[0], this.p[2]);
        // the last few metres slowly
        this.fly(dt, { to: this.lz, speed: 2, y: gy - 1, sink: clamp((this.p[1] - gy) * 0.5, 0.6, 3) });
        return;
      }
      case 'landed': {
        open(false);
        this.omegaWant = 1;
        this.hold(dt);
        // the troops jump out and spread round it; then off again
        const troops = this.aboard().filter((e) => this.seats[e.seat].role === 'troop' && !e.dead);
        if (troops.length && this.t > 1.5 && this.doors.L + this.doors.R > 0.9 && (this.dismountT = (this.dismountT ?? 0) - dt) <= 0) {
          this.dismountT = 0.6;
          this.dismount(troops[0]);
        }
        if (!troops.length && this.t > 4) {
          shut();
          this.next = this.exit;
          this.setMode('takeoff');
        }
        return;
      }
      case 'depart': {
        open(false);
        const de = Math.hypot(this.exit[0] - this.p[0], this.exit[2] - this.p[2]);
        this.fly(dt, { to: this.exit, speed: this.cruise * 0.8, y: cruiseY });
        if (de < 40) this.setMode('orbit');
        return;
      }
      case 'orbit': {
        open(false);
        // as fast as the turn allows (v² / R within what it can pull)
        this.fly(dt, { orbit: { c: this.lz, R: this.orbitR }, speed: Math.min(this.cruise, 25, Math.sqrt(HELI.accel * 0.8 * this.orbitR)), y: lzY + Math.max(25, this.altitude * 0.7) });
        return;
      }
      case 'emergency': {
        // down at once where it is: steep, slowing to a stop
        const gy = this.ground(this.p[0], this.p[2]);
        const sp = Math.hypot(this.v[0], this.v[2]);
        const ahead = [this.p[0] + this.v[0] * 3, 0, this.p[2] + this.v[2] * 3];
        this.fly(dt, { to: sp > 2 ? ahead : null, speed: 0, y: gy - 2, sink: this.p[1] - gy > 6 ? 10 : 2.5 });
        return;
      }
    }
  }
  /** Sitting (or kept where it is). */
  hold(dt) {
    this.v = [0, 0, 0];
    this.yawRate = 0;
    this.pitch += (0 - this.pitch) * Math.min(1, dt * 3);
    this.roll += ((this.skidsBent ? 0.08 : 0) - this.roll) * Math.min(1, dt * 3);
  }

  /**
   * The pilot flies: g { to?: [x,_,z] (a point), orbit?: { c, R }, speed (m/s), y (the height he
   * wants), sink? (m/s, the most down), plan?: slowing to stop at `to` (the approach) }. The
   * velocity he wants, the acceleration he can have (less with a hurt engine), and the attitude
   * that goes with it.
   */
  fly(dt, g) {
    const P = this.omega < 0.9 ? 0 : 1 - 0.5 * (this.dmg.engine ?? 0);
    let vd = [0, 0];
    if (g.orbit) {
      const c = g.orbit.c;
      const rx = this.p[0] - c[0], rz = this.p[2] - c[2];
      const r = Math.hypot(rx, rz) || 1;
      // round it with the zone on the left (the left door looking at it), held at R
      const t = [rz / r, -rx / r];
      const k = clamp((g.orbit.R - r) * 0.08, -0.6, 0.6);
      vd = [(t[0] + (rx / r) * k) * g.speed, (t[1] + (rz / r) * k) * g.speed];
    } else if (g.to) {
      const dx = g.to[0] - this.p[0], dz = g.to[2] - this.p[2];
      const d = Math.hypot(dx, dz);
      const sp = Math.min(g.speed, Math.sqrt(2 * HELI.decel * Math.max(0, d - 0.3)), d * 0.9);
      if (d > 1e-3) vd = [(dx / d) * sp, (dz / d) * sp];
    }
    const vyD = clamp((g.y - this.p[1]) * 0.6, -(g.sink ?? HELI.sink), HELI.climb * P);
    // the accelerations he can have
    let ax = (vd[0] - this.v[0]) * 1.2, az = (vd[1] - this.v[2]) * 1.2;
    const ah = Math.hypot(ax, az);
    const amax = HELI.accel * Math.max(0.2, P);
    if (ah > amax) {
      ax *= amax / ah;
      az *= amax / ah;
    }
    const ay = clamp((vyD - this.v[1]) * 1.5, -HELI.vAccel, HELI.vAccel * P);
    this.v[0] += ax * dt;
    this.v[1] += ay * dt;
    this.v[2] += az * dt;
    for (let i = 0; i < 3; i++) this.p[i] += this.v[i] * dt;
    // the attitude: the disc tilts the way it accelerates (and forward in cruise)
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const aF = ax * sy + az * cy, aR = -ax * cy + az * sy;
    const vF = this.v[0] * sy + this.v[2] * cy;
    const pitchT = clamp(-aF / G - 0.12 * clamp(vF / this.cruise, -1, 1.2), -0.4, 0.4);
    const rollT = clamp(aR / G, -0.55, 0.55) + (this.vibration > 0.5 ? 0.02 * Math.sin(this.time * 31) * this.vibration : 0);
    this.pitch += (pitchT - this.pitch) * Math.min(1, dt * 2.5);
    this.roll += (rollT - this.roll) * Math.min(1, dt * 2.5);
    // the heading: along the way it goes when going somewhere, else as it is (the hover: the zone ahead)
    const sp = Math.hypot(this.v[0], this.v[2]);
    const want = g.face ?? (sp > 6 ? Math.atan2(this.v[0], this.v[2]) : this.yaw);
    const wob = this.dmg.tailRotor > 0.4 ? 0.25 * Math.sin(this.time * 2.3) * this.dmg.tailRotor : 0;
    this.yawRate = clamp(wrap(want - this.yaw) * 1.2, -HELI.yawRate, HELI.yawRate) + wob;
    this.yaw = wrap(this.yaw + this.yawRate * dt);
  }

  /* ---------------- coming down: the failures ---------------- */
  stepFailure(dt) {
    this.failT += dt;
    const gy = this.ground(this.p[0], this.p[2]);
    const alt = this.p[1] - gy;
    const v = this.v;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let a = [0, -G, 0];
    if (this.failure === 'main') {
      // no lift: falling, only the air's drag; tumbling
      const s = len(v);
      a = [-HELI.dragK * s * v[0], -G - HELI.dragK * s * v[1], -HELI.dragK * s * v[2]];
      this.pitchRate += ((this.rand() - 0.5) * 3 + 0.6) * dt;
      this.rollRate += ((this.rand() - 0.5) * 3 + 0.9) * dt;
      this.yawRate += (this.rand() - 0.5) * 2 * dt;
      this.pitch += this.pitchRate * dt;
      this.roll += this.rollRate * dt;
      this.yaw = wrap(this.yaw + this.yawRate * dt);
    } else if (this.failure === 'tail') {
      // the main rotor's torque turns the fuselage the other way (nose right): faster and faster;
      // the collective down (less torque, less lift): a steep descent the disc's drag still slows;
      // near the ground the pilot rolls off the throttle and the spin slows
      const throttleOff = alt < 15;
      if (!throttleOff) this.yawRate = Math.max(-HELI.tailSpinMax, this.yawRate - HELI.tailSpin * dt);
      else this.yawRate *= 1 - Math.min(1, 0.35 * dt);
      const lift = (throttleOff ? 0.7 : HELI.tailLift) * G;
      a = [-0.15 * v[0], -G + lift - 0.45 * v[1], -0.15 * v[2]];
      this.yaw = wrap(this.yaw + this.yawRate * dt);
      this.pitch += (0.06 * Math.sin(this.time * 2.1) - this.pitch) * Math.min(1, dt * 2);
      this.roll += (0.12 * Math.sin(this.time * 3.3) + 0.04 * this.yawRate - this.roll) * Math.min(1, dt * 2);
    } else if (this.failure === 'engine') {
      // autorotation: the air coming up through the disc keeps it turning; down at ~9 m/s,
      // gliding forward; the flare over the last metres trades the forward speed and the
      // rotor's spin for a slower touchdown
      const flare = alt < HELI.flareAlt;
      const sink = flare ? 2.6 : HELI.autoSink;
      const fwd = flare ? 4 : HELI.glide;
      const vF = v[0] * sy + v[2] * cy;
      a = [(sy * fwd - v[0]) * 0.5, (-sink - v[1]) * (flare ? 2.2 : 1.2), (cy * fwd - v[2]) * 0.5];
      this.pitch += ((flare ? 0.3 : -0.05 * clamp(vF / HELI.glide, 0, 1)) - this.pitch) * Math.min(1, dt * 2);
      this.roll += (0 - this.roll) * Math.min(1, dt * 2);
      this.yawRate *= 0.9;
    } else {
      // nobody flying it: it drifts on, sinks, rolls over slowly
      a = [-0.05 * v[0], -G + 0.9 * G - 0.25 * v[1], -0.05 * v[2]];
      this.rollRate += 0.08 * dt;
      this.roll += this.rollRate * dt;
      this.pitch += (-0.15 - this.pitch) * Math.min(1, dt * 0.5);
      this.yawRate += (this.rand() - 0.5) * 0.3 * dt;
      this.yaw = wrap(this.yaw + this.yawRate * dt);
    }
    for (let i = 0; i < 3; i++) {
      v[i] += a[i] * dt;
      this.p[i] += v[i] * dt;
    }
  }

  /* ---------------- the ground: touchdown or crash ---------------- */
  stepGround(dt) {
    const gy = this.ground(this.p[0], this.p[2]);
    if (this.p[1] > gy + 1e-3 || (this.v[1] > 0 && !this.crashed)) {
      if (this.landed && this.mode !== 'parked' && this.mode !== 'shutdown' && this.mode !== 'landed') this.landed = false;
      return;
    }
    this.p[1] = gy;
    if (this.landed) {
      this.v = [0, 0, 0];
      return;
    }
    const vy = Math.max(0, -this.v[1]);
    const vh = Math.hypot(this.v[0], this.v[2]);
    const tilt = Math.abs(this.pitch) + Math.abs(this.roll);
    if (this.failure || this.fire > 0 || vy > HELI.safe || vh > 6 || tilt > 0.6) return this.crash();
    // a touchdown on the skids
    this.landed = true;
    impact(this.host.sim ?? this.world, { pos: this.p.slice(), normal: [0, 1, 0], mass: HELI.mass, velocity: [this.v[0], -Math.max(0.3, vy), this.v[2]], materials: ['steel', groundMaterial(this.host.sim?.world ?? this.world, this.p)], radius: 0.3, size: 3, kind: 'landing', name: `${this.call} (touchdown)`, effects: { damage: false, crush: false, shockwave: false } });
    this.v = [0, 0, 0];
    this.yawRate = 0;
    this.event('heliTouchdown', { speed: vy });
    this.setMode(this.mission === 'land' && this.aboard().some((e) => this.seats[e.seat].role === 'troop') ? 'landed' : 'shutdown');
  }

  /** It hits the ground: how hard decides what is left of it, of the men in it, and whether it burns. */
  crash() {
    const vy = Math.max(0, -this.v[1]);
    const speed = len(this.v);
    const sev = vy < HELI.hard && speed < 14 ? 'hard' : vy < HELI.fatal && speed < 25 ? 'crash' : 'destroyed';
    const w = this.host.sim?.world ?? this.world;
    const r = impact(this.host.sim ?? this.world, { pos: this.p.slice(), normal: [0, 1, 0], mass: HELI.mass, velocity: this.v.slice(), materials: ['aluminium', groundMaterial(w, this.p)], radius: 1.5, size: 6, sizeA: 10, footprint: 4, kind: 'crash', name: `${this.call} (helicopter crash)`, effects: { damage: false, crush: sev !== 'hard' } });
    this.crashed = true;
    this.landed = true;
    this.severity = sev;
    this.impactSpeed = vy;
    this.crashEnergy = r.energy;
    this.setMode('wreck');
    this.event('heliCrash', { severity: sev, cause: this.failure ?? (this.fire > 0 ? 'fire' : 'hard landing'), speed: vy, energy: r.energy });
    // the men in it: by how hard (the seats take some of a hard landing; a spin flings them about)
    const base = sev === 'hard' ? 6 + vy * 3 : sev === 'crash' ? 25 + vy * 5 : 260;
    for (const e of this.aboard()) this.hurt(e, base * (0.7 + 0.6 * this.rand()) + (this.failure === 'tail' ? 8 : 0));
    // it rolls over: a spin or a bent skid on a hard landing, any real crash; the blades strike the ground
    const spin = Math.abs(this.yawRate) > 2;
    if (sev !== 'hard' || spin || this.skidsBent) {
      this.rollTo = (this.rand() < 0.5 ? -1 : 1) * (sev === 'destroyed' ? 1.5 : 1.3);
      if (this.blades && this.omega > 0.3) {
        this.gone.add('rotor');
        this.shed('blades');
      }
    } else this.rollTo = this.roll * 0.3;
    this.pitchTo = sev === 'hard' ? 0 : clamp(this.pitch, -0.4, 0.4);
    // the fuel: burning already, or torn open by a real crash
    const burns = this.fuel > 0.05 && (this.fire > 0 || sev === 'destroyed' || (sev === 'crash' && this.rand() < 0.6));
    if (burns) {
      this.fire = 1;
      const q = this.toWorld([-1.1, 0.6, 0]);
      this.host.ignite?.(q, 3);
      this.host.torch?.([q[0], q[1] + 1.2, q[2]], 3.5e5 * this.fuel, 60, 2);
      // destroyed: the tank goes up at once; else the fire gets to it a while later (time to get out)
      if (sev === 'destroyed') this.host.explode?.(q, 4e6);
      else if (this.fuel > 0.4) this.blowAt = this.time + 8;
      this.event('heliWreckFire');
    }
    this.v = [0, 0, 0];
    this.yawRate = 0;
    this.omegaWant = 0;
  }
  stepWreck(dt) {
    this.v = [0, 0, 0];
    this.p[1] = this.ground(this.p[0], this.p[2]);
    this.roll += ((this.rollTo ?? 0) - this.roll) * Math.min(1, dt * 3);
    this.pitch += ((this.pitchTo ?? 0) - this.pitch) * Math.min(1, dt * 3);
    this.doorsWant = { L: 0, R: 0 };
    if (this.blowAt != null && this.time >= this.blowAt) {
      this.blowAt = null;
      const q = this.toWorld([-1.1, 0.6, 0]);
      this.event('heliExplosion', { pos: q });
      this.host.explode?.(q, 1.5e6);
      for (const e of this.aboard()) this.hurt(e, 150);
    }
    // the ones still alive climb out and fight on the ground
    if (this.t > 2.5) for (const e of this.aboard()) if (!e.dead) this.dismount(e, true);
  }

  /* ---------------- rotor, doors ---------------- */
  stepRotor(dt) {
    let want = this.omegaWant ?? 1;
    if (this.failure === 'main' || this.blades === 0) want = 0;
    else if (this.failure === 'engine' && !this.crashed) want = this.landed ? 0 : 0.92; // the air turns it
    else if (this.crashed) want = 0;
    if (!this.landed && !this.crashed && this.failure !== 'main') want = Math.max(want, 0.9);
    const rate = want > this.omega ? 1 / HELI.spinUp : this.blades === 0 ? 0.8 : 0.12;
    this.omega += clamp(want - this.omega, -rate * dt, rate * dt);
    this.rotorAngle = (this.rotorAngle + this.omega * HELI.rotorRev * 2 * Math.PI * dt) % (2 * Math.PI);
    if (!this.gone.has('tailRotor')) this.tailAngle = (this.tailAngle + this.omega * HELI.tailRev * 2 * Math.PI * dt) % (2 * Math.PI);
  }
  stepDoors(dt) {
    // (doorsHold: someone else says, the rig stage's Doors button)
    const want = this.doorsHold ?? this.doorsWant;
    for (const s of ['L', 'R']) this.doors[s] += clamp(want[s] - this.doors[s], -HELI.doorRate * dt, HELI.doorRate * dt);
  }
  doorOpen(side) {
    return this.doors[sideName(side)] > 0.85;
  }

  /* ---------------- the cables ---------------- */
  /** Cables out of the doors (each a w.ropes entry: the rope contract above). */
  deployRopes() {
    const w = this.world;
    w.ropes ??= [];
    const sides = [...new Set(this.seats.filter((s) => s.role === 'troop').map((s) => s.side))];
    for (const s of sides) {
      if (this.ropes.some((r) => r.side === s && r.attached)) continue;
      const top = this.toWorld(DOOR.anchor(s));
      const rope = { id: `${this.id}-rope-${sideName(s)}`, kind: 'fastrope', top, bottom: [top[0], Math.max(this.ground(top[0], top[2]), top[1] - this.ropeLength), top[2]], owner: this.id, attached: true, side: s, length: this.ropeLength };
      w.ropes.push(rope);
      this.ropes.push(rope);
    }
    this.event('heliRopes', { n: sides.length });
  }
  /** Cut loose: they fall, lie a while, and are gone from w.ropes. */
  cutRopes() {
    for (const r of this.ropes) if (r.attached) {
      r.attached = false;
      r.cutAt = this.time;
    }
    this.event('heliRopesCut');
  }
  stepCables(dt) {
    const w = this.world;
    for (const r of this.ropes) {
      if (r.attached) {
        // only its top: it hangs from there (ai/rope.js ropeEnds)
        const q = this.toWorld(DOOR.anchor(r.side));
        for (let i = 0; i < 3; i++) r.top[i] = q[i];
      } else if (!this.crew.some((e) => e.rope?.rope === r)) {
        // falling, then lying there (nobody on it any more)
        const gy = this.ground(r.top[0], r.top[2]);
        r.vy = (r.vy ?? 0) - G * dt;
        r.top[1] = Math.max(gy + 0.05, r.top[1] + r.vy * dt);
        r.bottom[1] = Math.max(gy, Math.min(r.bottom[1], r.top[1] - 0.05));
        if (this.time - r.cutAt > 12) r.done = true;
      }
    }
    if (this.ropes.some((r) => r.done)) {
      for (const r of this.ropes.filter((x) => x.done)) w.ropes?.splice(w.ropes.indexOf(r), 1);
      this.ropes = this.ropes.filter((r) => !r.done);
    }
  }
  /** The hover over the zone: doors open, cables out, the troops down one after another on each; then cut and away. */
  stepFastRope(dt) {
    const steady = Math.hypot(this.v[0], this.v[2]) < 1.5 && Math.abs(this.v[1]) < 1;
    const sides = [...new Set(this.seats.filter((s) => s.role === 'troop').map((s) => s.side))];
    if (this.t < 1 || !sides.every((s) => this.doorOpen(s))) return;
    if (!this.ropes.some((r) => r.attached) && !this.ropesCut) {
      if (steady) this.deployRopes();
      return;
    }
    const troops = this.aboard().filter((e) => this.seats[e.seat].role === 'troop' && !e.dead);
    this.ropeT ??= {};
    for (const r of this.ropes) {
      if (!r.attached) continue;
      const next = troops.find((e) => this.seats[e.seat].side === r.side);
      if (!next || !steady) continue;
      // a moment for the cable to settle; then each man as soon as ai/rope.js takes him
      this.ropeT[r.side] = (this.ropeT[r.side] ?? 0.8) - dt;
      if (this.ropeT[r.side] > 0) continue;
      this.toRope(next, r);
    }
    const onRopes = this.crew.some((e) => e.rope && !e.dead);
    if (!troops.length && !onRopes && !this.ropesCut) {
      this.downT = (this.downT ?? 0) + dt;
      if (this.downT > 1.5) {
        this.cutRopes();
        this.ropesCut = true;
        this.radio('troops away, cutting ropes');
        this.next = this.exit;
        this.setMode('depart');
      }
    }
  }
  /** A trooper goes out of the door onto the cable (the rope seam: startRope). */
  toRope(e, rope) {
    // from his place by the door (ai/rope.js mounts him from there onto the cable)
    e.atDoor = false;
    e.p = this.toWorld(DOOR.shooter(this.seats[e.seat].side));
    if (!startRope(this.host.sim ?? { world: this.world }, e, rope)) return false;
    e.aboard = null;
    e.heliDeploy = true;
    this.event('heliRope', { who: e.name });
    return true;
  }
  /** Out of the helicopter on the ground (landed, or out of the wreck): beside his door, his squad's again. */
  dismount(e, wreck = false) {
    const s = this.seats[e.seat];
    const side = s.side ?? (s.role === 'pilot' ? 1 : -1);
    const q = this.toWorld([s.at[0] - (this.seats.indexOf(s) % 3) * 0.6, 0, side * (2.4 + this.rand() * 1.5)]);
    e.aboard = null;
    e.atDoor = false;
    e.p = [q[0], this.ground(q[0], q[2]), q[2]];
    e.home = e.p.slice();
    e.yaw = this.yaw + (side < 0 ? Math.PI / 2 : -Math.PI / 2);
    this.release(e);
    this.event('heliDismount', { who: e.name, wreck });
  }
  /** His squad has him again (ai/squad.js: no longer ownMove). */
  release(e) {
    e.guardCtl = false;
    e.heliDeploy = false;
    e.anim = null;
    e.aiming = false;
    e.squadInit = undefined;
  }
  /** The men who went down a cable: once off it (the rope module let go of him), his squad has him. */
  stepDeployed() {
    for (const e of this.crew) if (e.heliDeploy && !e.rope && e.aboard == null) this.release(e);
  }

  /* ---------------- the guns: the door gunners, and the troops by the doors ---------------- */
  /** What a man at `from` on side s can see out of his door within range: the nearest such target, or null. */
  pickTarget(from, s, range) {
    const ts = this.host.targets?.() ?? [];
    const A = this.axes;
    let best = null, bd = Infinity;
    for (const T of ts) {
      const d = sub(T, from);
      const L = len(d);
      if (L > range || L < 2) continue;
      const l = heliToLocal(this, d.map((x) => x / L), true, A);
      if (l[2] * s < 0.3 || l[1] > 0.5 || l[0] > 0.85 || l[0] < -0.75) continue; // out of his door, not through the fuselage
      if (this.host.sees && !this.host.sees(from, T)) continue;
      if (L < bd) {
        bd = L;
        best = T;
      }
    }
    return best;
  }
  stepGuns(dt) {
    if (this.crashed) return;
    const w = this.world;
    const A = this.axes;
    const sp = len(this.v);
    for (const e of this.crew) {
      if (e.aboard !== this.id) continue;
      const s = this.seats[e.seat];
      if (e.dead || e.canFire === false || (s.role !== 'gunner' && s.role !== 'troop')) {
        e.atDoor = false;
        continue;
      }
      const side = s.side;
      const open = this.doorOpen(side);
      if (s.role === 'troop') {
        // the first man on the bench on this side, when the door is open and no cable is out on it
        const first = this.aboard().find((o) => !o.dead && this.seats[o.seat].role === 'troop' && this.seats[o.seat].side === side);
        const roping = this.ropes.some((r) => r.attached && r.side === side);
        e.atDoor = open && first === e && !roping && this.mode !== 'landed';
        if (!e.atDoor) continue;
      } else if (!open) continue;
      const gunner = s.role === 'gunner';
      const from = gunner ? heliToWorld(this, DOOR.gun(side), A) : heliToWorld(this, [DOOR.shooter(side)[0], F + 1.1, side * 1.05], A);
      const T = this.pickTarget(from, side, gunner ? HELI.gunRange : HELI.gunRange * 0.6);
      const G2 = gunner ? this.guns[sideName(side)] : (e.gun ??= { cd: 0, burst: 0, flash: -1 });
      G2.cd -= dt;
      if (!T) {
        G2.burst = 0;
        e.aiming = false;
        continue;
      }
      e.aiming = true;
      const d = norm(sub(T, from));
      // the gun (and the man behind it) turned onto it
      const l = heliToLocal(this, d, true, A);
      e.aimYawWorld = Math.atan2(d[0], d[2]); // he turns to it (placeCrew)
      if (gunner) G2.dir = l; // the gun's barrel, in the helicopter's frame (render/heliMesh.js)
      if (G2.cd > 0) continue;
      const weapon = gunner ? 'mg' : e.loadout === 'mg' ? 'mg' : 'rifle';
      const rate = gunner || weapon === 'mg' ? HELI.gunRate : HELI.rifleRate;
      const burst = gunner || weapon === 'mg' ? HELI.gunBurst : HELI.rifleBurst;
      G2.cd = 1 / rate;
      G2.burst++;
      if (G2.burst >= burst) {
        G2.burst = 0;
        G2.cd = gunner ? 0.8 : 0.9;
      }
      if (gunner && G2.ammo-- <= 0) continue;
      // a moving, vibrating platform: the rounds spread
      const spread = (gunner ? 0.012 : 0.02) * (1 + sp / 30 + this.vibration);
      const j = [(this.rand() - 0.5) * 2 * spread, (this.rand() - 0.5) * 2 * spread, (this.rand() - 0.5) * 2 * spread];
      const dir = norm([d[0] + j[0], d[1] + j[1], d[2] + j[2]]);
      G2.flash = this.time;
      e.flashUntil = (w.time ?? this.time) + 0.06;
      this.shots++;
      const hit = this.host.fire ? this.host.fire(e, from, dir, weapon) : null;
      (this.lastShots ??= []).push({ from, dir, weapon, who: e.role, hit: hit ?? null });
      if (this.lastShots.length > 20) this.lastShots.shift();
    }
  }

  /* ---------------- what flies off ---------------- */
  stepDebris(dt) {
    for (const b of this.debris) {
      if (b.rest) continue;
      b.t += dt;
      b.v[1] -= G * dt;
      for (let i = 0; i < 3; i++) b.p[i] += b.v[i] * dt;
      b.a += b.spin * dt;
      const gy = this.ground(b.p[0], b.p[2]);
      if (b.p[1] <= gy + 0.1) {
        b.p[1] = gy + 0.1;
        b.rest = true;
        const vs = len(b.v);
        impact(this.host.sim ?? this.world, { pos: b.p.slice(), normal: [0, 1, 0], mass: b.kind === 'blade' ? 110 : 40, velocity: b.v.slice(), materials: ['aluminium', groundMaterial(this.host.sim?.world ?? this.world, b.p)], radius: 0.2, size: 4, kind: 'crash', name: b.kind === 'blade' ? 'a rotor blade' : 'the tail rotor', effects: { damage: false, crush: false } });
        // whoever it comes down on
        for (const e of this.world.enemies ?? []) if (!e.dead && e.aboard == null && Math.hypot(e.p[0] - b.p[0], e.p[2] - b.p[2]) < 1.2 && vs > 5) this.hurt(e, 90);
        b.v = [0, 0, 0];
      }
    }
  }

  /** How whole it is (0..1: models/vehicleZones.js integrity), and a few words on its state. */
  get integrity() {
    return integrity(this.dmg, 'helicopter');
  }
  describe() {
    const st = this.crashed ? `wreck (${this.severity})` : this.failure ? `going down: ${this.failure}` : this.mode;
    const alt = this.p[1] - this.ground(this.p[0], this.p[2]);
    return `${st} · ${alt.toFixed(0)} m · ${Math.hypot(this.v[0], this.v[2]).toFixed(0)} m/s · rotor ${Math.round(this.omega * 100)}%${this.fire > 0 ? ' · ON FIRE' : ''}`;
  }
}

/* =============================================================================================
 * The simulation's helicopters (w.helis, models/helicopter.js): each spec gets its Helicopter
 * (spec.ai) on the first step, with a host on this simulation: the ground is the voxels' tops
 * (or the sea), the crew are w.enemies, the guns shoot real rounds (sim/wounds.js) at you, a crash
 * goes through sim/impact.js and the fire simulation. Bullets (sim/wounds.js shoot → shot), arrows
 * and rockets (sim.hitEnemy → hit) and blasts (sim/explosions.js → blast) find its parts.
 * ============================================================================================= */
export class HeliAI {
  constructor(sim) {
    this.sim = sim;
    const prev = sim.hitEnemy;
    sim.hitEnemy = (p, type, g) => this.hit(p, type, g) || (prev ? prev(p, type, g) : false);
  }
  get world() {
    return this.sim.world;
  }
  /** The helicopters (their Helicopter objects). */
  list() {
    return (this.world.helis ?? []).map((s) => s.ai).filter(Boolean);
  }
  host() {
    const sim = this.sim;
    const w = sim.world;
    return {
      sim,
      world: w,
      ground: (x, z) => groundY(w, x, z),
      addCrew: (e) => w.enemies.push(e),
      // you (the walk-through's player), if you are about
      targets: () => {
        const pl = sim.ai?.player;
        return pl && !pl.dead && pl.p ? [[pl.p[0], pl.p[1] + 1.2, pl.p[2]]] : [];
      },
      sees: (a, b) => (sim.ai?.sightLine ? sim.ai.sightLine(a, b) : true),
      fire: (e, from, dir, weapon) => {
        const pl = sim.ai?.player && !sim.ai.player.dead ? sim.ai.player : null;
        const hit = shoot(sim, from, dir, { shooter: e, player: pl, range: HELI.gunRange + 20, weapon, ignore: (o) => o.aboard != null || o.heliCrew === e.heliCrew });
        if (hit?.player) w.playerHits?.push({ zone: hit.zone, time: w.time, from, weapon });
        return hit;
      },
      hurt: (e, amount) => sim.ai?.damage(e, amount),
      wound: (e, zone, kind, p, dir) => wound(sim, e, zone, kind, p, dir),
      ignite: (p, r) => sim.ignite?.(p, r),
      torch: (p, W, s, r) => sim.addTorch?.(p, W, s, r),
      explode: (p, E) => explode(sim, p, E, { name: 'helicopter' }),
      radio: (h, text) => w.events.push({ type: 'radio', pos: h.p.slice(), time: w.time, name: `${h.call}: ${text}`, kind: 'call' }),
    };
  }
  step(dt) {
    const w = this.world;
    for (const s of w.helis ?? []) {
      s.ai ??= new Helicopter(s, this.host());
      s.ai.step(dt);
    }
    // (the men on the cables: sim/simulation.js steps ai/rope.js after the squads)
  }
  /** A projectile at p (an arrow, a rocket: sim.hitEnemy): the part it is in. */
  hit(p, type, g) {
    for (const h of this.list()) {
      if (h.crashed && type !== 'rocket') continue;
      const hz = heliHitZone(h, p);
      if (!hz) continue;
      if ((hz.k === 'rotor' && h.omega > 0.3 && h.rand() > HELI.bladeChance) || (g?.passed?.includes(h) ?? false)) {
        if (g) (g.passed ??= []).push(h);
        continue;
      }
      const v = g?.v ? (Array.isArray(g.v) ? g.v : [g.v.x, g.v.y, g.v.z]) : null;
      h.hit(hz.k, type === 'rocket' ? VEHICLE_WEAPONS.rocket : type === 'arrow' ? 12 : VEHICLE_WEAPONS.bullet, p, v, type === 'rocket' ? 'rocket' : 'bullet');
      if (type === 'rocket') this.blastOne(h, p, 4);
      return true;
    }
    return false;
  }
  /**
   * A hitscan round (sim/wounds.js shoot) from `from` along dir up to max m: the helicopter part
   * it meets first, damaged. The shooter's own helicopter is not in his way. { heli, k, p, s } or null.
   */
  shot(from, dir, max = 80, weapon = 'rifle', shooter = null) {
    let best = null;
    for (const h of this.list()) {
      if (shooter?.aboard === h.id) continue;
      const r = heliRayHit(h, from, dir, max);
      if (r && (!best || r.t < best.t)) best = { ...r, heli: h };
    }
    if (!best) return null;
    const amount = VEHICLE_WEAPONS.bullet * (weapon === 'mg' ? 1.25 : weapon === 'pistol' || weapon === 'carbine' ? 0.7 : 1);
    best.heli.hit(best.k, amount, best.p, dir, weapon);
    return { heli: best.heli, k: best.k, zone: best.zone, p: best.p, s: best.t };
  }
  /** A blast at `center` (radius R, sim/explosions.js): every part near it takes its share. */
  blast(center, R) {
    for (const h of this.list()) this.blastOne(h, center, R);
  }
  blastOne(h, center, R) {
    if (len(sub(h.p, center)) > R * 2 + 12) return;
    for (const Z of vehicleZones('helicopter')) {
      if (h.gone.has(Z.k)) continue;
      const d = Math.min(...Z.boxes.map((b) => len(sub(heliToWorld(h, b.c), center)) - Math.min(...b.h)));
      if (d > R * 2) continue;
      h.hit(Z.k, VEHICLE_WEAPONS.rocket * clamp(1 - Math.max(0, d) / (R * 2), 0, 1) * (Z.k === 'rotor' ? 0.6 : 1), center, null, 'rocket');
    }
  }
}

/** What is under (x, z) in a voxel world: the top of its column (or the sea, or 0 off the world). */
export function groundY(w, x, z) {
  const sea = w.sea ? w.sea.level : 0;
  if (!w.colTop) return sea;
  const ix = Math.floor(x / w.h), iz = Math.floor(z / w.h);
  if (ix < 0 || iz < 0 || ix >= w.nx || iz >= w.nz) return sea;
  const top = w.colTop[ix + w.nx * iz];
  return Math.max(sea, top >= 0 ? (top + 1) * w.h : 0);
}

/** The simulation's step for its helicopters (sim/simulation.js). */
export function stepWorldHelis(sim, dt) {
  sim.heliAI ??= new HeliAI(sim);
  sim.heliAI.step(dt);
}
