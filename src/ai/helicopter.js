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
 *    them; `aboard`: the helicopter's id). Each man is posed in the helicopter's frame (e.frame: its
 *    axes; e.seatYaw: his heading in it; e.eye: his eye in the world), so he tilts with its pitch
 *    and roll, and what he sees and shoots from is where his eye and his gun really are.
 *  - Who they shoot at (stepSenses, pickTarget): the crew watch out of the doors (the men in the
 *    back) and through the glass (the pilots) and identify what they see as the soldiers do
 *    (ai/perception.js perceive: distance, the light, smoke, a moment to notice, sooner where they
 *    are being shot from or where a friendly squad reported its threat); what one man identifies
 *    the whole crew knows (`known`, as a squad shares its sightings). The contacts are the host's
 *    (contacts(): you, the soldiers, the dragons, the other helicopters), each on a side
 *    (ai/sides.js): only a hostile one that has been identified and is in sight out of his door
 *    is fired at, the most dangerous first (shooting at them, near, exposed: threatScore); a
 *    friendly in the line of fire holds it. With a door open the gunner fires the door gun and
 *    the troop nearest the door his own weapon out of it (sim/wounds.js shoot: real rounds that
 *    wound a soldier, strike a dragon, hit another helicopter's parts). A trooper on a cable is
 *    the rope module's (below); down, he is his squad's again (ai/squad.js).
 *  - You can fly it (board / unboard; `controls`: collective, cyclic pitch and roll, pedals; mode
 *    'player': stepPlayer). The same hit parts and failures apply: a tail rotor shot away spins
 *    you round the mast (the pedals do nothing; less collective, less torque), a dead engine
 *    autorotates (the collective only spends the rotor's spin: a flare), no rotor drops you. The
 *    crew in the back still fight from the doors, and fast-rope down on your order (playerRopes).
 *  - Hit parts: models/vehicleZones.js VEHICLE_ZONES.helicopter (the rig's table, editable there).
 *    A bullet (sim/wounds.js shoot), an arrow or rocket (sim.hitEnemy) or a blast (explode) at a
 *    part damages it (hitPart): the cockpit hits a pilot, the cabin the men in the back, the fuel
 *    tank leaks and then burns, the engine smokes and then quits, the tail rotor or its boom goes:
 *    no yaw control, the mast or the blades go: no lift. A round into the cockpit (or on through
 *    the cabin) goes on along its line to the men in the seats (heliOccupantHit: head, torso,
 *    legs; the armoured seat stops it from behind and below): its pilot and co-pilot, or you when
 *    you fly it (host.playerHit: walk.js takes it at once, at the controls).
 *  - How it comes down depends on what went (`failure`):
 *      'tail'    no tail rotor: the main rotor's torque spins the fuselage round the mast (faster and
 *                faster, HELI.tailSpin), the pilot lowers the collective (a steep but survivable
 *                descent) and rolls off the throttle near the ground: a spinning hard landing.
 *      'main'    the mast or the blades gone: no lift at all, it drops like a stone (only the air's
 *                drag), tumbling; the blades fly off (debris that can hit people).
 *      'engine'  autorotation: the descent keeps the rotor turning, it glides down at ~9 m/s with
 *                some forward speed and flares just above the ground: a hard landing.
 *      'pilot'   both pilots down: nobody flies it, it drifts and rolls and goes in.
 *    The tail boom shot through breaks off at its root: the boom, the fin and the tail rotor fall
 *    away as one piece (a debris entry 'tailBoom' with its own attitude, tumbling down and lying
 *    where it lands), and without its weight aft the nose drops.
 *    A burning fuel tank: the pilot puts it down at once; in the air too long, it blows up (then
 *    'main'). Every touchdown and crash goes through sim/impact.js (force, shockwave, sound); a
 *    crash hurts the crew by how hard it was, the fuel can catch (sim.ignite and a torch: the fire
 *    simulation burns there), the survivors climb out and fight on the ground.
 *
 * On the rigid-body core (the default; this.physics = 'legacy' for the above alone) its airframe is
 * a body (physics/heliCore.js) carried where this model flies it; what it flies into stops it (into
 * something above the ground: its crash), and once crashed it is a free body that lands on its skids
 * or rolls over; the wreck lies where it comes to rest.
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
 *   heliOccupantHit(h, from, dir)    // a round on into the cockpit: the man in a seat (you flying it,
 *                                    // its pilot, co-pilot) and where, or the seat's armour, or null
 *   heliSeats(n, doorGuns)           // the seats: pilot, co-pilot, door gunners, troops
 *   h.board(); h.controls = { collective, pitch, roll, pedal };  h.unboard();   // you fly it
 *   h.playerRopes()                  // (flown by you) cables out at the hover, the troops down; again: cut
 *   new HeliAI(sim)                  // the simulation's helicopters (w.helis): steps, bullets, blasts
 */
import { VEHICLE_ZONES, VEHICLE_WEAPONS, vehicleZones, rayZone, hitPart, integrity } from '../models/vehicleZones.js';
import { impact, groundMaterial } from '../sim/impact.js';
import { shoot, wound } from '../sim/wounds.js';
import { explode } from '../sim/explosions.js';
import { emitSound, perceive, senses } from './perception.js';
import { startRope } from './rope.js';
import { sideOf, hostile } from './sides.js';
import { isCore } from '../physics/vehicleCore.js';
import { heliStep } from '../physics/heliCore.js';
import { initArms, stepArms, armsMass } from './heliArms.js';
import { stepCombat, stepDefence } from './heliCombat.js';
import { vehicleContacts } from './vehicleSides.js';
import { stepBattle } from './battle.js';
import { battleCtx, gridSight } from '../sim/ordnance.js';

const G = 9.81;
/**
 * What it weighs (kg): HELI.mass is a UH-60-sized machine fuelled, six men in the back, two door
 * guns and the standard armour; less fuel (1360 kg full), fewer men (110 kg each with kit), guns
 * (45 kg each with ammunition), armour (none -150, armoured +450) change it.
 */
export function heliMass(o = {}) {
  const guns = { both: 2, left: 1, right: 1, none: 0 }[o.doorGuns ?? 'both'] ?? 2;
  return HELI_MASS + ((o.fuel ?? 1) - 1) * 1360 + ((o.soldiers ?? 6) - 6) * 110 + (guns - 2) * 45 + ({ none: -150, standard: 0, armoured: 450 }[o.armour ?? 'standard'] ?? 0) + armsMass(o.armsSpec);
}
const HELI_MASS = 7000;
/** The helicopter's numbers (a UH-60-sized machine). */
export const HELI = {
  mass: HELI_MASS, // kg, loaded (heliMass: with what it carries)
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
  senseEvery: 0.2, // s between the crew's looks round (ai/perception.js perceive, the time between made up)
  forgetAfter: 20, // s unseen: an identified contact is no longer known
  // flown by you (stepPlayer)
  collective: 0.4, // of g more (or less) lift at the collective's ends (0: holds its height, level or tilted)
  thrustMax: 1.5, // of g at full power
  tiltMax: 0.42, // rad the cyclic tilts the disc (nose down / up, banked)
  dragH: 0.0011, // quadratic drag across (s²/m²: ~63 m/s at full forward cyclic)
  dragV: 0.5, // per s: the disc's damping of a climb or a sink
  pedalRate: 0.95, // rad/s at full pedal
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
/** Where the tail boom breaks off (its root, behind the cabin), in the helicopter's frame; how far aft its far end (the fin) reaches. */
export const BOOM_ROOT = [-3.0, 2.05, 0];
export const BOOM_LENGTH = 6.6;

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

/**
 * A man in a cockpit seat as a target, in the helicopter's frame, from his seat's place `at` (his
 * feet on the floor): his legs (forward, on the pedals), torso, head, and the seat's armour (an
 * armoured bucket seat: the back plate and the pan under him stop a rifle round from behind or below).
 */
export function seatBoxes(at) {
  const [x, y, z] = at;
  return [
    { zone: 'head', c: [x - 0.12, y + 1.12, z], h: [0.12, 0.13, 0.11] },
    { zone: 'torso', c: [x - 0.15, y + 0.72, z], h: [0.16, 0.27, 0.22] },
    { zone: 'legs', c: [x + 0.3, y + 0.35, z], h: [0.32, 0.18, 0.2] },
    { zone: 'seat', c: [x - 0.36, y + 0.75, z], h: [0.04, 0.42, 0.27] },
    { zone: 'seat', c: [x - 0.1, y + 0.33, z], h: [0.3, 0.04, 0.27] },
  ];
}

/** Who sits in the cockpit (pilot's seat: you when you fly it; the co-pilot's): [{ who: crew man | 'player', seat, boxes }]. */
export function cockpitOccupants(h) {
  const out = [];
  PILOTS.forEach((s, i) => {
    let who = null;
    if (i === 0 && h.player) who = 'player';
    else who = (h.crew ?? []).find((e) => e.role === s.role && e.aboard === h.id && !e.dead && !e.relieved && !e.atDoor) ?? null;
    if (who) out.push({ who, seat: s, boxes: seatBoxes(s.at) });
  });
  return out;
}

/** Ray (local from, unit dir) against an axis-aligned box: the entry distance, or null. */
function rayBox(o, d, b, max) {
  let t0 = 0, t1 = max;
  for (let i = 0; i < 3; i++) {
    const lo = b.c[i] - b.h[i], hi = b.c[i] + b.h[i];
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo || o[i] > hi) return null;
      continue;
    }
    let a = (lo - o[i]) / d[i], c = (hi - o[i]) / d[i];
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, c);
    if (t0 > t1) return null;
  }
  return t0;
}

/**
 * A round along a ray (world from, dir, up to max m) into the cockpit: the man in a seat it meets
 * first and where ({ who: crew man | 'player', zone: 'head' | 'torso' | 'legs', t, p }), or the
 * seat's armour that stops it ({ who, zone: 'seat', stopped: true, ... }), or null: through the
 * glass past them. The same for the helicopter's own pilot and for you at its controls.
 */
export function heliOccupantHit(h, from, dir, max = 6) {
  const D = norm(dir);
  const A = heliAxes(h.yaw, h.pitch, h.roll);
  const lf = heliToLocal(h, from, false, A);
  const ld = heliToLocal(h, D, true, A);
  let best = null;
  for (const o of cockpitOccupants(h)) {
    for (const b of o.boxes) {
      const t = rayBox(lf, ld, b, max);
      if (t != null && (!best || t < best.t)) best = { who: o.who, zone: b.zone, t };
    }
  }
  if (!best) return null;
  best.p = [from[0] + D[0] * best.t, from[1] + D[1] * best.t, from[2] + D[2] * best.t];
  if (best.zone === 'seat') best.stopped = true;
  return best;
}


let NEXT = 0;

/**
 * One helicopter. `o`: { p (where it starts: on the ground, or the point under it in the air),
 * yaw, lz (the landing zone), exit?, mission, airborne, altitude, cruise, hoverAlt, ropeLength,
 * orbitRadius, soldiers, doorGuns, callsign, seed, autoStart }. `host` connects it to a world:
 *   ground(x, z) → y             what is under it (default 0)
 *   world                        { time, events, noises, enemies, ropes } (the rope list, the crew)
 *   sim                          the Simulation (sim/impact.js, wounds, fire), if there is one
 *   contacts() → [{ key, ref, kind, side, p, at, speed?, size?, exposure? }]
 *                                what there is to see (you, soldiers, dragons, helicopters, targets):
 *                                key a stable identity (the object itself), at the point to aim at
 *   targets() → [[x,y,z], ...]   (older hosts) points to fire at: contacts on the 'target' side
 *   sees(a, b) → bool            a line of sight (default: yes)
 *   reports() → [[x,y,z], ...]   where friendly squads have their threat (they look there first)
 *   playerHit(zone, weapon, p)   (flown by you) a round through the cockpit into you
 *   fire(e, from, dir, weapon)   one round (default: sim/wounds.js shoot on host.sim)
 *   hurt(e, amount), wound(e, zone, weapon, p, dir), ignite(p, r), torch(p, W, s, r), explode(p, E)
 *   radio(h, text)
 */
export class Helicopter {
  constructor(o = {}, host = {}) {
    this.host = host;
    this.id = o.id ?? `heli${++NEXT}`;
    this.call = o.callsign ?? 'Hawk';
    this.color = o.color; // (its paint: render/helis.js)
    this.rand = rng(o.seed ?? 7);
    // whose it is (ai/sides.js): 'red' brings the simulation's soldiers, 'blue' (friendly) is yours
    this.side = o.side === 'friendly' ? 'blue' : o.side === 'enemy' ? 'red' : o.side ?? 'red';
    this.player = false; // you have the controls (board)
    this.controls = null;
    this.known = new Map(); // what the crew have identified: key → { c (the contact), firstT, seenT, by }
    this.attacks = []; // rounds at it or past its men: { from, who, t }
    this.mission = o.mission ?? 'insert';
    this.cruise = o.cruise ?? HELI.cruise;
    // experience of the pilot and of the men in the back (ai/experience.js)
    this.pilotSkill = o.pilotSkill;
    this.troopSkill = o.troopSkill;
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
    // the fuel load (the editor's, 0..1 of full) and what it all weighs: lighter climbs and turns quicker (heliMass)
    this.fuel = Math.max(0.05, Math.min(1, o.fuel ?? 1));
    // its armament beside the door guns (ai/heliArms.js: a chin gun, rocket pods, missiles, flares)
    this.arms = initArms(this, o);
    this.engageR = o.engageR;
    this.attackStyle = o.attackStyle; // ('gunRun': in with the gun; else from a standoff: ai/heliCombat.js)
    this.mass = heliMass({ ...o, fuel: this.fuel, armsSpec: this.arms?.spec });
    this.perf = Math.max(0.55, Math.min(1.3, (HELI.mass / this.mass) ** 0.8));
    this.smoke = 0; // engine smoke (0..1)
    this.vibration = 0;
    this.glass = false; // the cockpit glass shattered
    this.skidsBent = false;
    this.mode = this.airborne ? 'transit' : o.autoStart === false ? 'parked' : 'spinUp';
    // where it goes home to (ai/heliCombat.js: out of ammunition, badly hurt)
    this.home = (o.home ?? [this.p[0], this.ground(this.p[0], this.p[2]), this.p[2]]).slice();
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
      skill: seat.role === 'pilot' ? this.pilotSkill ?? 'veteran' : air ? 'regular' : this.troopSkill ?? 'regular', armour: true, helmet: true,
      guardCtl: true, // neither the guard AI nor the squad AI moves him while he is aboard (ai/squad.js ownMove)
      heliCrew: this.id, aboard: this.id, seat: i, role: seat.role, anim: seat.anim, name: `${this.call} ${seat.label.toLowerCase()}`,
      side: this.side,
    };
  }
  aboard() {
    return this.crew.filter((e) => e.aboard === this.id);
  }
  /** The men at the controls (not a pilot you relieved: he sits in the back while you fly). */
  pilots() {
    return this.crew.filter((e) => (e.role === 'pilot' || e.role === 'copilot') && e.aboard === this.id && !e.dead && !e.relieved);
  }
  /** Where a man aboard is in the helicopter's frame: his seat, the door, or (a relieved pilot) the back of the cabin. */
  placeOf(e) {
    const s = this.seats[e.seat];
    if (e.relieved) return { at: [-1.35, F, 0], face: 0, anim: 'deskSit' };
    return { at: e.atDoor ? DOOR.shooter(s.side) : s.at, face: s.face, anim: s.anim };
  }
  /**
   * Each man aboard in his place (the gunner at his gun, the door shooter in the door), facing his
   * way, all in the helicopter's frame: his feet, his eye (e.eye) and his heading (e.seatYaw, in
   * its frame; e.frame its axes for render/enemies.js) tilt and turn with it.
   */
  placeCrew() {
    const A = this.axes;
    const w = this.world;
    for (const e of this.crew) {
      if (e.aboard !== this.id) continue;
      const s = this.seats[e.seat];
      const pl = this.placeOf(e);
      e.p = heliToWorld(this, pl.at, A);
      e.home = e.p.slice();
      // his heading in the helicopter's frame (0 forward, +π/2 left): his seat's, or onto what he aims at
      const aim = e.aiming && !e.dead && e.aimLocal ? e.aimLocal : null;
      e.seatYaw = aim ? Math.atan2(-aim[2], aim[0]) : pl.face;
      e.yaw = e.aiming && !e.dead && e.aimYawWorld != null ? e.aimYawWorld : this.yaw + e.seatYaw;
      e.frame = { f: A.f, u: A.u, r: A.r };
      e.moving = false;
      if (e.dead) e.anim = 'die';
      else if (e.relieved) e.anim = pl.anim;
      else if (s.role === 'gunner') e.anim = (this.guns[sideName(s.side)].flash ?? -1) > this.time - 0.15 ? 'shoot' : 'aim';
      // in the door: on one knee, weapon ready (operator/rig.js kneelAim / kneelShoot; render/enemies.js
      // falls back to the crouched clips on a figure without them)
      else if (e.atDoor) e.anim = (e.flashUntil ?? -1) > (w.time ?? 0) - 0.3 ? 'kneelShoot' : 'kneelAim';
      else e.anim = pl.anim;
      // his eye: seated, standing at the gun, crouched in the door (ai/perception.js EYE), up the helicopter's own axis
      const eyeH = e.dead ? 0.4 : e.anim === 'aim' || e.anim === 'shoot' ? 1.55 : e.anim === 'deskSit' ? 1.05 : 1.0;
      e.eye = heliToWorld(this, [pl.at[0], pl.at[1] + eyeH, pl.at[2]], A);
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
    const big = amount >= VEHICLE_WEAPONS.shell;
    const q = p ?? this.toWorld(zone.boxes[0].c);
    const ev = this.event('heliHit', { zone: k, label: zone.label, damage: r.amount, value: r.value, destroyed: r.destroyed, at: q.slice(), weapon });
    // a round (not a blast) into the cockpit or the cabin, its way known: on along its line, the
    // man in a seat it meets (you, flying it; its pilot, co-pilot), or the seat's armour, or past
    // them (heliOccupantHit). Without a direction (a part hit as such): the old odds below.
    if ((k === 'cockpit' || k === 'cabin') && p && dir && !big) {
      if (k === 'cockpit' && (r.value > 0.25 || this.rand() < 0.3)) this.glass = true;
      const D = norm(dir);
      const o = heliOccupantHit(this, [p[0] - D[0] * 0.6, p[1] - D[1] * 0.6, p[2] - D[2] * 0.6], D, 6.6);
      if (o) {
        ev.occupant = o.who === 'player' ? 'player' : o.who.name;
        ev.occupantZone = o.zone;
        if (o.stopped) return r; // (the seat's armour)
        if (o.who === 'player') this.host.playerHit?.(o.zone, weapon, o.p);
        else this.hurtMan(o.who, o.zone, weapon, o.p, dir);
        return r;
      }
      if (k === 'cockpit') return r; // through the glass, past them
      // (the cabin: on to the men in the back, below)
    }
    if (k === 'cockpit') {
      if (r.value > 0.25 || big) this.glass = true;
      // the man on the side it came in on (the pilot sits right)
      const l = heliToLocal(this, q);
      // flown by you: you are in the right seat
      if (this.player && l[2] >= 0) {
        if (big || this.rand() < 0.6) this.host.playerHit?.(big ? 'torso' : this.rand() < 0.3 ? 'head' : 'torso', weapon, q);
        return r;
      }
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
        // the boom shot through: it breaks off with the fin and the tail rotor (one piece falling)
        if (k === 'tailBoom') this.gone.add('tailBoom');
        this.shed(k === 'tailBoom' ? 'tailBoom' : 'tailRotor');
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
    // flown by you: you are the pilot (no 'pilot' failure); a tail or an engine gone, you fly on
    // with it (stepPlayer: the spin, the autorotation); no rotor, nothing to fly with
    if (this.player && kind !== 'main') {
      if (kind === 'pilot') return;
      this.failure = kind;
      this.failT = 0;
      this.event('heliFailure', { failure: kind, why });
      return;
    }
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
    // (flown by you: putting it down is yours to do, before the tank goes: HELI.burn)
    if (!this.failure && !this.landed && !this.crashed && !this.player) {
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
    } else if (what === 'tailBoom') {
      // the boom breaks at its root (BOOM_ROOT): the piece keeps the helicopter's frame there (its
      // own yaw, pitch, roll: render/heliMesh.js buildTailMesh draws it aft of that point) and its
      // motion, and tumbles: the heavy far end (the fin, the tail rotor's gearbox) drops first
      const c = this.toWorld(BOOM_ROOT);
      const tip = [this.v[0] - A.f[0] * 2 + A.r[0] * this.yawRate * 3, this.v[1] + 1, this.v[2] - A.f[2] * 2 + A.r[2] * this.yawRate * 3];
      this.debris.push({ kind: 'tailBoom', p: c, v: tip, yaw: this.yaw, pitch: this.pitch, roll: this.roll, w: [this.yawRate * 0.6 + (this.rand() - 0.5) * 0.8, 0.9 + this.rand() * 0.8, (this.rand() - 0.5) * 1.6], tailAngle: this.tailAngle, a: 0, spin: 0, rest: false, t: 0 });
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
    // (on the rigid-body core its airframe is a body carried where this flies it, free once it has
    // crashed: physics/heliCore.js; unless this.physics = 'legacy')
    if (isCore(this, 'heli')) heliStep(this, dt, () => this.stepMotion(dt));
    else this.stepMotion(dt);
    this.stepRotor(dt);
    this.stepDoors(dt);
    this.stepCables(dt);
    this.placeCrew();
    this.stepSenses(dt);
    this.stepGuns(dt);
    if (this.arms) {
      stepArms(this, dt);
      stepDefence(this, dt);
    }
    this.stepDebris(dt);
    this.stepDeployed();
    // its noise: the rotor's thud carries far (the guards' side does not care: ai/perception.js 'enemy')
    if (this.omega > 0.3 && (this.noiseT = (this.noiseT ?? 0) - dt) <= 0) {
      this.noiseT = 1.5;
      emitSound(this.world, { pos: this.toWorld([0, 3, 0]), loudness_dB: 125 * this.omega, kind: 'enemy' });
    }
  }

  /** How it moves: flown (the mission, you, a failure's descent), on the ground, or a wreck. */
  stepMotion(dt) {
    if (!this.crashed) {
      if (!this.failure && !this.player && this.pilots().length === 0 && !this.landed) this.fail('pilot', 'both pilots are down');
      if (this.failure && this.mode === 'falling') this.stepFailure(dt);
      else this.stepMission(dt);
      this.stepGround(dt);
    } else this.stepWreck(dt);
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
      case 'player':
        return this.stepPlayer(dt);
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
      case 'hunt':
        // (ai/heliCombat.js: patrol, find, attack, evade; home when it has nothing left)
        if (this.arms) return stepCombat(this, dt);
        this.setMode('orbit');
        return;
      case 'transit': {
        if (this.mission === 'hunt') {
          if (d < this.orbitR * 2 || (this.arms && this.known.size && [...this.known.values()].some((k) => hostile(this.side, k.c.side)))) this.setMode('hunt');
        } else if (this.mission === 'overwatch') {
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

  /* ---------------- flown by you ---------------- */
  /**
   * You take the controls (walk/heliFlight.js: E at the cockpit door, landed). It is yours now
   * (side 'blue'): men of another side aboard get out and fight (their squads have them); a
   * friendly pilot hands over and sits in the back; the rest of a friendly crew stay at the guns
   * and on the benches. The engines run up if they were still (HELI.spinUp before it lifts).
   */
  board() {
    if (this.crashed) return false;
    this.player = true;
    this.side = 'blue';
    for (const e of this.aboard()) {
      if (e.dead) continue;
      if (hostile(sideOf(e), this.side)) this.dismount(e);
      else if (e.role === 'pilot') e.relieved = true;
    }
    this.controls = { collective: 0, pitch: 0, roll: 0, pedal: 0 };
    this.ropeOrder = false;
    this.omegaWant = 1;
    this.setMode('player');
    this.event('heliBoard');
    return true;
  }
  /**
   * You let go of the controls: on the ground (climbing out) it shuts down; in the air (the
   * walk-through closed) its own pilot, if it has one, takes it and holds a hover where it is.
   */
  unboard() {
    if (!this.player) return;
    this.player = false;
    this.controls = null;
    this.ropeOrder = false;
    for (const e of this.crew) e.relieved = false;
    this.event('heliUnboard');
    if (this.crashed || this.mode === 'falling') return;
    if (this.landed) {
      this.omegaWant = 0;
      this.setMode('shutdown');
    } else {
      const gy = this.ground(this.p[0], this.p[2]);
      this.lz = [this.p[0], gy, this.p[2]];
      this.mission = 'hover';
      this.hoverAlt = clamp(this.p[1] - gy, 4, this.ropeLength - 1);
      this.setMode('hover');
      // (a tail or an engine already gone: the pilot's way down)
      if (this.failure) {
        this.mode = 'falling';
        this.t = 0;
      }
    }
  }
  /**
   * G (flown by you): at a steady hover low enough for the cables, the troops fast-rope down
   * (stepFastRope: the doors open, cables out, one man after another on each, cut when all are
   * down); again while the cables are out: cut them now. A word on why not, else null.
   */
  playerRopes() {
    if (!this.player) return 'not flying';
    if (this.ropes.some((r) => r.attached)) {
      if (this.crew.some((e) => e.rope && !e.dead && this.ropes.includes(e.rope.rope))) return 'men on the ropes';
      this.cutRopes();
      this.ropeOrder = false;
      this.ropesCut = true;
      return null;
    }
    const troops = this.aboard().filter((e) => this.seats[e.seat].role === 'troop' && !e.dead);
    if (!troops.length) return 'no troops aboard';
    if (this.landed) return 'on the ground';
    const alt = this.p[1] - this.ground(this.p[0], this.p[2]);
    if (alt > this.ropeLength - 1) return `too high for the ${this.ropeLength} m ropes`;
    if (Math.hypot(this.v[0], this.v[2]) > 2.5) return 'too fast: hover';
    this.ropeOrder = true;
    this.ropesCut = false;
    this.downT = 0;
    this.ropeT = {};
    this.radio('ropes, ropes, ropes');
    return null;
  }
  /**
   * Your flying (mode 'player'): controls { collective -1..1 (0 holds the height), pitch -1..1
   * (+: the cyclic forward, nose down), roll -1..1 (+: right), pedal -1..1 (+: the nose left) }.
   * The cyclic tilts the disc (a stability system levels it when let go); the lift is along the
   * disc's axis, so a tilt accelerates you that way; at speed a bank turns you (and the fin keeps
   * the nose into the wind). What is shot away still counts: no tail rotor, no pedals and the
   * torque spins you (more collective, faster); no engine, the collective can only spend the
   * rotor's spin (autorotation, then a flare); a hurt engine, less power.
   */
  stepPlayer(dt) {
    const c = this.controls ?? { collective: 0, pitch: 0, roll: 0, pedal: 0 };
    const col = clamp(c.collective ?? 0, -1, 1);
    const engineOut = this.failure === 'engine';
    const tailOut = this.failure === 'tail';
    // the doors: open for the ropes, or for the men in the back to fight from at a fighting speed
    const sides = this.seats.filter((s) => (s.role === 'troop' || s.role === 'gunner') && this.aboard().some((e) => !e.dead && this.seats[e.seat] === s)).map((s) => s.side);
    const sp = Math.hypot(this.v[0], this.v[2]);
    if (this.ropeOrder) this.doorsWant = { L: 1, R: 1 };
    else if (!this.landed && sp < 30 && sides.length) this.doorsWant = { L: sides.includes(-1) ? 1 : 0, R: sides.includes(1) ? 1 : 0 };
    else this.doorsWant = { L: 0, R: 0 };
    this.omegaWant = 1;
    const P = engineOut ? 0 : this.omega < 0.9 ? 0 : 1 - 0.5 * (this.dmg.engine ?? 0);
    if (this.landed) {
      // on the skids: the rotor up to speed and the collective raised, it lifts
      this.hold(dt);
      if (col > 0.15 && P > 0 && !tailOut) {
        this.landed = false;
        this.v[1] = 0.6;
        this.p[1] += 0.02;
      }
      return;
    }
    // the attitude: where the cyclic holds the disc (nose down to go forward)
    const T = HELI.tiltMax;
    const wob = this.dmg.tailRotor > 0.4 ? 0.04 * Math.sin(this.time * 2.3) * this.dmg.tailRotor : 0;
    const pitchT = -clamp(c.pitch ?? 0, -1, 1) * T;
    const rollT = clamp(c.roll ?? 0, -1, 1) * T * 1.2 + wob + (this.vibration > 0.5 ? 0.02 * Math.sin(this.time * 31) * this.vibration : 0);
    this.pitch += (pitchT - this.pitch) * Math.min(1, dt * 2.5);
    this.roll += (rollT - this.roll) * Math.min(1, dt * 2.5);
    // the heading: the pedals; at speed the bank turns it (a coordinated turn) and the fin weathervanes
    if (tailOut) {
      // the main rotor's torque, unopposed: the more collective, the faster it spins (nose right)
      const torque = HELI.tailSpin * (0.55 + 0.45 * (col + 1) / 2) * (engineOut ? 0.3 : 1);
      this.yawRate = Math.max(-HELI.tailSpinMax * (0.6 + 0.4 * (col + 1) / 2), this.yawRate - torque * dt);
    } else {
      const turn = sp > 8 ? (G * Math.tan(this.roll)) / sp * Math.min(1, (sp - 8) / 10) : 0;
      const want = clamp(c.pedal ?? 0, -1, 1) * HELI.pedalRate - turn * 0.9;
      this.yawRate += (want - this.yawRate) * Math.min(1, dt * 3);
    }
    this.yaw = wrap(this.yaw + this.yawRate * dt);
    // the lift along the disc's axis: enough to hold the height at the collective's middle
    // (whatever the tilt), more or less towards its ends, no more than the power gives
    const A = this.axes;
    let lift;
    if (engineOut) {
      // autorotation: the air up through the disc gives ~0.78 g (a steady sink near HELI.autoSink);
      // the collective pulled spends the rotor's spin for more, once (the flare)
      this.rotorStore = this.rotorStore ?? 1;
      const pull = Math.max(0, col) * Math.min(1, this.rotorStore * 3);
      this.rotorStore = Math.max(0, this.rotorStore - pull * dt * 0.45);
      lift = G * (0.78 + 0.6 * pull);
    } else {
      const want = (G * (1 + HELI.collective * col)) / Math.max(0.6, A.u[1]);
      lift = Math.min(want, G * HELI.thrustMax * P);
    }
    if (tailOut) lift *= 0.92; // (fighting the spin)
    if (this.blades === 0 || this.omega < 0.3) lift = 0;
    const vh = sp;
    const a = [
      A.u[0] * lift - HELI.dragH * vh * this.v[0] - 0.04 * this.v[0],
      // (the collective let go to its middle: the height hold takes out what climb or sink is left)
      A.u[1] * lift - G - (HELI.dragV + (engineOut ? 0 : 1.2 * (1 - Math.abs(col)))) * this.v[1],
      A.u[2] * lift - HELI.dragH * vh * this.v[2] - 0.04 * this.v[2],
    ];
    for (let i = 0; i < 3; i++) {
      this.v[i] += a[i] * dt;
      this.p[i] += this.v[i] * dt;
    }
    if (this.ropeOrder) this.stepFastRope(dt);
  }

  /**
   * The pilot flies: g { to?: [x,_,z] (a point), orbit?: { c, R }, speed (m/s), y (the height he
   * wants), sink? (m/s, the most down), plan?: slowing to stop at `to` (the approach) }. The
   * velocity he wants, the acceleration he can have (less with a hurt engine), and the attitude
   * that goes with it.
   */
  fly(dt, g) {
    // (× its performance at its weight: fuel, men, guns, armour, heliMass)
    const P = (this.omega < 0.9 ? 0 : 1 - 0.5 * (this.dmg.engine ?? 0)) * (this.perf ?? 1);
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
      // (the boom gone: its weight aft gone with it, the nose drops)
      this.pitch += ((this.gone.has('tailBoom') ? -0.22 : 0) + 0.06 * Math.sin(this.time * 2.1) - this.pitch) * Math.min(1, dt * 2);
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
    if (this.player) return; // (yours: it sits there, rotor turning, until you lift or climb out)
    this.setMode(this.mission === 'land' && this.aboard().some((e) => this.seats[e.seat].role === 'troop') ? 'landed' : 'shutdown');
  }

  /** It hits the ground: how hard decides what is left of it, of the men in it, and whether it burns. */
  crash() {
    // (what it hit with: a core airframe goes on from there as a free body, physics/heliCore.js)
    this.crashV = this.v.slice();
    this.crashRates = [this.pitchRate ?? 0, this.rollRate ?? 0, this.yawRate ?? 0];
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
    this.event('heliCrash', { severity: sev, cause: this.failure ?? (this.fire > 0 ? 'fire' : 'hard landing'), speed: vy, energy: r.energy, omega: this.omega, blades: this.blades });
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
    // (a core airframe lies where its body came to rest: its skids, its side; physics/heliCore.js)
    if (!this.core?.free) {
      this.v = [0, 0, 0];
      this.p[1] = this.ground(this.p[0], this.p[2]);
      this.roll += ((this.rollTo ?? 0) - this.roll) * Math.min(1, dt * 3);
      this.pitch += ((this.pitchTo ?? 0) - this.pitch) * Math.min(1, dt * 3);
    }
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
        // (flown by you: that was your order done; where to now is yours too)
        if (this.player) {
          this.ropeOrder = false;
          return;
        }
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
    e.frame = null; // (upright on the cable again)
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
    e.frame = null;
    e.relieved = false;
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
  /**
   * What there is to see round it: the host's contacts (contacts(): you, the soldiers, dragons,
   * helicopters), or an older host's targets() as contacts on the 'target' side. Not itself, nor
   * its own men aboard.
   */
  contacts() {
    if (this.host.contacts) return this.host.contacts().filter((c) => c.ref !== this && !(c.ref?.aboard === this.id));
    return (this.host.targets?.() ?? []).map((T, i) => ({ key: `target${i}`, ref: T, kind: 'target', side: 'target', p: T, at: T, size: 1 }));
  }
  /** Rounds at it (sim/wounds.js shoot through HeliAI.shot), or cracking past its men: who fired and from where. */
  underFire(from, who = null) {
    const now = this.world.time ?? this.time;
    this.attacks.push({ from: from.slice(), who, t: now });
    if (this.attacks.length > 12) this.attacks.shift();
  }
  /** Is contact c shooting at it (a round from within 3 m of it, or by it, in the last 10 s)? */
  attacking(c) {
    const now = this.world.time ?? this.time;
    return this.attacks.some((a) => now - a.t < 10 && ((a.who && a.who === c.ref) || len(sub(a.from, c.at ?? c.p)) < 3));
  }
  /**
   * Can a man on `side` (-1 left door, +1 right, 0 the cockpit) look along the local direction l
   * (a unit vector in the helicopter's frame)? Out of his door (open; or the door's window, a
   * shorter look), or forward and down through the pilots' glass; not through the fuselage.
   */
  viewOut(side, l) {
    if (!side) return this.arms ? (l[0] > -0.55 && l[1] < 0.8 ? 1 : 0) : l[0] > -0.15 && l[1] < 0.55 ? 1 : 0;
    if (l[2] * side < 0.3 || l[1] > 0.5 || l[0] > 0.85 || l[0] < -0.75) return 0;
    return this.doorOpen(side) ? 1 : 0.4;
  }
  /**
   * The crew look round (every HELI.senseEvery s): each live man aboard, from his eye, at each
   * hostile contact he can see out of his door or the glass (ai/perception.js perceive: his
   * senses, its distance, the light, smoke, the moment it takes, sooner where rounds came from or
   * where a friendly squad reported its threat). What one identifies the crew knows (`known`);
   * what nobody has seen for HELI.forgetAfter s is forgotten. Rounds cracking past the men aboard
   * count as being shot at from there.
   */
  stepSenses(dt) {
    this.senseT = (this.senseT ?? 0) + dt;
    if (this.senseT < HELI.senseEvery || this.crashed) return;
    const sdt = this.senseT;
    this.senseT = 0;
    const w = this.world;
    const now = w.time ?? this.time;
    const men = this.aboard().filter((e) => !e.dead);
    for (const e of men)
      if (e.shotAt && e.shotAt.time > (e.shotSeen ?? -Infinity) && now - e.shotAt.time < 1) {
        e.shotSeen = e.shotAt.time;
        this.underFire(e.shotAt.from, null);
      }
    const cs = this.contacts();
    this.contactsNow = cs;
    const A = this.axes;
    const expects = [...this.attacks.filter((a) => now - a.t < 10).map((a) => a.from), ...(this.host.reports?.(this.side) ?? [])];
    for (const c of cs) {
      if (!hostile(this.side, c.side)) continue;
      const at = c.at ?? c.p;
      const expect = expects.find((q) => len(sub(q, at)) < 6) ?? null;
      for (const e of men) {
        const s = this.seats[e.seat];
        const eye = e.eye ?? e.p;
        const d = sub(at, eye);
        const L = len(d) || 1;
        const side = s.role === 'pilot' || s.role === 'copilot' ? (e.relieved ? null : 0) : s.side;
        if (side == null) continue;
        const view = this.viewOut(side, heliToLocal(this, d.map((x) => x / L), true, A));
        if (!view) continue;
        let prof = senses(e, 'soldier');
        // (an armed helicopter's pilots: its sight, for what is big enough to pick out far off)
        if (side === 0 && this.arms && (c.kind === 'heli' || c.kind === 'car' || c.kind === 'boat')) prof = { ...prof, sightRange: this.arms.sensor };
        const r = perceive(e, { ...c, key: c.key ?? c.ref, head: at }, sdt, {
          now, eye, at, prof, range: prof.sightRange * view, expect,
          los: this.host.sees ? (a, b) => this.host.sees(a, b) : null, world: this.host.sim?.world ?? null,
        });
        if (!r.seen) continue;
        const k = c.key ?? c.ref;
        const kn = this.known.get(k);
        if (!kn) {
          this.known.set(k, { c, firstT: now, seenT: now, by: e });
          this.event('heliContact', { what: c.kind, by: e.name, at: at.slice() });
        } else {
          kn.c = c;
          kn.seenT = now;
        }
        break; // (one man has it: the crew know)
      }
    }
    for (const [k, kn] of this.known) {
      const dead = kn.c.ref?.dead || (kn.c.ref?.health != null && kn.c.ref.health <= 0) || kn.c.ref?.crashed || kn.c.ref?.armsWreck || kn.c.ref?.body?.sunk;
      if (dead || now - kn.seenT > HELI.forgetAfter || !cs.some((c) => (c.key ?? c.ref) === k)) this.known.delete(k);
    }
  }
  /** Has the crew identified this contact (or its object)? */
  knows(ref) {
    for (const [k, kn] of this.known) if (k === ref || kn.c.ref === ref) return true;
    return false;
  }
  /**
   * How dangerous an identified contact is to them (the higher, the sooner fired at): one shooting
   * at them most, then a dragon or a helicopter over a man; nearer and more exposed (standing, not
   * crouched or prone) more; the one already on the gun a little more (no flicking between two).
   */
  threatScore(c, d, current = false) {
    const W = { dragon: 2.5, heli: 2, car: 1.4, boat: 1.3, player: 1.2, soldier: 1, target: 1 };
    const exp = c.exposure ?? 1;
    return (W[c.kind] ?? 1) * (this.attacking(c) ? 4 : 1) * (0.4 + 0.6 * exp) * (current ? 1.3 : 1) / (1 + d / 60);
  }
  /**
   * What a man at `from` on side s fires at: of what the crew have identified, a hostile he can
   * see out of his door within range, in his line of sight and with no friendly in the line of
   * fire, the most dangerous (threatScore). The contact, or null.
   */
  pickTarget(from, s, range, current = null) {
    const A = this.axes;
    const cs = this.contactsNow ?? this.contacts();
    let best = null, bs = 0;
    for (const kn of this.known.values()) {
      const c = cs.find((x) => (x.key ?? x.ref) === (kn.c.key ?? kn.c.ref)) ?? kn.c;
      if (!hostile(this.side, c.side)) continue;
      const T = c.at ?? c.p;
      const d = sub(T, from);
      const L = len(d);
      if (L > range || L < 2) continue;
      if (this.viewOut(s, heliToLocal(this, d.map((x) => x / L), true, A)) < 1) continue; // out of his (open) door, not through the fuselage
      if (this.host.sees && !this.host.sees(from, T)) continue;
      if (this.friendlyInLine(from, T, cs)) continue;
      const sc = this.threatScore(c, L, current && (current.key ?? current.ref) === (c.key ?? c.ref));
      if (sc > bs) {
        bs = sc;
        best = c;
      }
    }
    return best;
  }
  /** A friendly (or a man of no side) within 1.5 m of the line from `from` to T, short of it: hold fire. */
  friendlyInLine(from, T, cs) {
    const d = sub(T, from);
    const L = len(d) || 1;
    const u = d.map((x) => x / L);
    for (const c of cs) {
      if (hostile(this.side, c.side)) continue;
      const q = sub(c.at ?? c.p, from);
      const t = dot(q, u);
      if (t < 1 || t > L - 0.5) continue;
      if (len(sub(q, u.map((x) => x * t))) < 1.5) return true;
    }
    return false;
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
        // the first man on the bench on this side, when the door is open: kneeling in it, weapon
        // ready, covering below and outward; with a cable out on his side he is the next man down,
        // waiting his turn there (and firing at what the crew have identified until then)
        const first = this.aboard().find((o) => !o.dead && this.seats[o.seat].role === 'troop' && this.seats[o.seat].side === side);
        e.atDoor = open && first === e && this.mode !== 'landed';
        if (!e.atDoor) continue;
      } else if (!open) continue;
      const gunner = s.role === 'gunner';
      const from = gunner ? heliToWorld(this, DOOR.gun(side), A) : heliToWorld(this, [DOOR.shooter(side)[0], F + 1.1, side * 1.05], A);
      const G2 = gunner ? this.guns[sideName(side)] : (e.gun ??= { cd: 0, burst: 0, flash: -1 });
      const C = this.pickTarget(from, side, gunner ? HELI.gunRange : HELI.gunRange * 0.6, G2.target);
      G2.target = C;
      G2.cd -= dt;
      if (!C) {
        G2.burst = 0;
        e.aiming = false;
        e.target = null;
        continue;
      }
      const T = C.at ?? C.p;
      e.aiming = true;
      e.target = C.ref;
      const d = norm(sub(T, from));
      // the gun (and the man behind it) turned onto it
      const l = heliToLocal(this, d, true, A);
      e.aimLocal = l; // his heading in the helicopter's frame (placeCrew)
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
      (this.lastShots ??= []).push({ from, dir, weapon, who: e.role, at: C.ref, kind: C.kind, hit: hit ?? null });
      if (this.lastShots.length > 20) this.lastShots.shift();
    }
  }

  /* ---------------- what flies off ---------------- */
  stepDebris(dt) {
    for (const b of this.debris) {
      if (b.rest) continue;
      if (b.kind === 'tailBoom') {
        this.stepBoom(b, dt);
        continue;
      }
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

  /**
   * The tail boom broken off: a piece in its own frame (yaw, pitch, roll; its root at b.p, the fin
   * BOOM_LENGTH m aft along its -x), falling with the air's drag and tumbling (b.w: yaw, pitch and
   * roll rates); its tail rotor runs down. When either end reaches the ground it comes down there:
   * the impact (sim/impact.js), whoever is under it hurt, and it lies flat where it fell.
   */
  stepBoom(b, dt) {
    b.t += dt;
    const s = len(b.v);
    b.v[1] -= G * dt;
    for (let i = 0; i < 3; i++) {
      b.v[i] -= HELI.dragK * 2 * s * b.v[i] * dt;
      b.p[i] += b.v[i] * dt;
    }
    b.yaw = wrap(b.yaw + b.w[0] * dt);
    b.pitch += b.w[1] * dt;
    b.roll += b.w[2] * dt;
    b.tailAngle = (b.tailAngle ?? 0) + Math.max(0, 1 - b.t / 4) * HELI.tailRev * 2 * Math.PI * dt;
    const A = heliAxes(b.yaw, b.pitch, b.roll);
    const end = [0, 1, 2].map((i) => b.p[i] - A.f[i] * BOOM_LENGTH + A.u[i] * 0.9);
    const gy0 = this.ground(b.p[0], b.p[2]), gy1 = this.ground(end[0], end[2]);
    if (b.p[1] > gy0 + 0.3 && end[1] > gy1 + 0.3) return;
    b.rest = true;
    const vs = len(b.v);
    impact(this.host.sim ?? this.world, { pos: (b.p[1] - gy0 < end[1] - gy1 ? b.p : end).slice(), normal: [0, 1, 0], mass: 180, velocity: b.v.slice(), materials: ['aluminium', groundMaterial(this.host.sim?.world ?? this.world, b.p)], radius: 0.3, size: 6, kind: 'crash', name: 'the tail boom', effects: { damage: false, crush: false } });
    // whoever it comes down on (anywhere along it)
    for (const e of this.world.enemies ?? []) {
      if (e.dead || e.aboard != null || vs < 5) continue;
      const q = sub(e.p, b.p), ax = [-A.f[0], 0, -A.f[2]];
      const al = Math.hypot(ax[0], ax[2]) || 1;
      const t = clamp((q[0] * ax[0] + q[2] * ax[2]) / al, 0, BOOM_LENGTH * al);
      if (Math.hypot(q[0] - (ax[0] / al) * t, q[2] - (ax[2] / al) * t) < 1.3) this.hurt(e, 110);
    }
    // it lies on the ground, flat, on its side or upright as it fell
    b.pitch = 0;
    b.roll = Math.abs(wrap(b.roll)) > 0.8 ? Math.sign(wrap(b.roll)) * Math.PI / 2 : 0;
    b.p[1] = (gy0 + gy1) / 2 + 0.3; // (the boom's axis: its radius over the ground)
    b.v = [0, 0, 0];
    b.w = [0, 0, 0];
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
      // the battle it fires into (sim/ordnance.js: its chin gun's rounds, rockets, missiles, flares)
      battle: this.battle(),
      ground: (x, z) => groundY(w, x, z),
      addCrew: (e) => w.enemies.push(e),
      // what there is to see (each on its side: ai/sides.js): you on foot, the soldiers (not the men
      // aboard a helicopter: the helicopter is the contact), the dragons, the helicopters
      contacts: () => worldContacts(sim),
      // (clipped to the voxels: beyond the place's grid nothing is in the way)
      sees: (a, b) => gridSight(sim, a, b),
      // where the fire teams of its side have their threat (ai/squad.js: radioed, they look there)
      reports: (side) => (sim.squads ?? []).filter((sq) => sq.threat && w.enemies.some((m) => m.squad && !m.dead && m.aboard == null && (m.unit ?? 'Alpha') === sq.unit && sideOf(m) === side)).map((sq) => sq.threat),
      // real rounds (sim/wounds.js shoot): a soldier wounded, a dragon struck, another helicopter's
      // part, you; not through the men aboard a helicopter (its cabin zone takes those)
      fire: (e, from, dir, weapon) => {
        const pl = sim.ai?.player && !sim.ai.player.dead ? sim.ai.player : null;
        const hit = shoot(sim, from, dir, { shooter: e, player: pl, range: HELI.gunRange + 20, weapon, ignore: (o) => o.aboard != null || o.heliCrew === e.heliCrew });
        if (hit?.player) w.playerHits?.push({ zone: hit.zone, time: w.time, from, weapon });
        return hit;
      },
      // flown by you: a round through your side of the cockpit
      playerHit: (zone, weapon, p) => w.playerHits?.push({ zone, time: w.time, from: p, weapon: weapon === 'bullet' ? 'rifle' : weapon }),
      hurt: (e, amount) => sim.ai?.damage(e, amount),
      wound: (e, zone, kind, p, dir) => wound(sim, e, zone, kind, p, dir),
      ignite: (p, r) => sim.ignite?.(p, r),
      torch: (p, W, s, r) => sim.addTorch?.(p, W, s, r),
      explode: (p, E) => explode(sim, p, E, { name: 'helicopter' }),
      radio: (h, text) => w.events.push({ type: 'radio', pos: h.p.slice(), time: w.time, name: `${h.call}: ${text}`, kind: 'call' }),
    };
  }
  /** The battle's context on this simulation (sim/ordnance.js battleCtx). */
  battle() {
    const sim = this.sim;
    return (this._battle ??= battleCtx(sim.world, sim, { ground: (x, z) => groundY(sim.world, x, z), sees: (a, b) => gridSight(sim, a, b) }));
  }
  step(dt) {
    const w = this.world;
    for (const s of w.helis ?? []) {
      // (one that comes later: not there until then, models/helicopter.js startAfter)
      if (!s.ai && (s.startAfter ?? 0) > (w.time ?? 0)) continue;
      s.ai ??= new Helicopter(s, this.host());
      s.ai.step(dt);
    }
    // the guns on the cars and boats, the ordnance in the air, burning cars (ai/battle.js)
    if (this._battle && this._battle.world !== w) this._battle = null;
    stepBattle(this.battle(), dt);
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
    best.heli.underFire(from, shooter); // (its crew know where that came from: ai/helicopter.js stepSenses)
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

/**
 * What there is for a helicopter's crew to see in a simulation (host.contacts): each a contact
 * { key (its identity: the object), ref (the object), kind, side (ai/sides.js), p, at (where to
 * aim: a man's chest, the dragon's, a helicopter's cabin), speed, size, exposure (a man crouched
 * or lying shows less of himself) }. You on foot (sim.ai.player: flying, your helicopter is the
 * contact), the soldiers not aboard a helicopter, the live dragons, the helicopters not wrecked.
 */
export function worldContacts(sim) {
  const w = sim.world;
  const out = [];
  const pl = sim.ai?.player;
  if (pl && !pl.dead && pl.p) {
    const low = pl.crouch ? 0.5 : 1.2;
    out.push({ key: 'player', ref: pl, kind: 'player', side: 'blue', p: pl.p, at: [pl.p[0], pl.p[1] + low, pl.p[2]], speed: pl.moving ? 1.5 : 0, exposure: pl.crouch ? 0.45 : 1, lightOn: pl.lightOn, beam: pl.beam });
  }
  for (const e of w.enemies ?? []) {
    if (e.dead || e.aboard != null || e.inCar || e.devoured || e.held || !e.p) continue; // (in a car: the car is the contact)
    const a = e.anim ?? '';
    const prone = e.crawling || /prone|crawl|wounded|peekOver/.test(a);
    const low = !prone && /crouch|peekWall|kneel/i.test(a);
    const h = prone ? 0.3 : low ? 0.85 : 1.25;
    out.push({ key: e, ref: e, kind: 'soldier', side: sideOf(e), p: e.p, at: [e.p[0], e.p[1] + h, e.p[2]], speed: e.moving ? e.speed ?? 1.3 : 0, exposure: prone ? 0.4 : low ? 0.7 : 1, lightOn: e.lightOn, beam: e.beam,
      // (under water: seen from above only within the water's visibility and his depth; a scuba set's bubbles give him away: ai/perception.js, ai/dive.js)
      submerged: e.submerged, waterVis: e.waterVis, bubbles: e.bubbles });
  }
  for (const d of w.dragons ?? []) {
    if (!(d.health > 0) || !d.chest) continue;
    out.push({ key: d, ref: d, kind: 'dragon', side: d.side ?? 'beast', p: d.chest, at: d.chest.slice(), speed: d.speed ?? 0, size: 4 * (d.k ?? 1) });
  }
  for (const s of w.helis ?? []) {
    const h = s.ai;
    if (!h || h.crashed) continue;
    out.push({ key: h, ref: h, kind: 'heli', side: h.side, p: h.p, at: h.toWorld([0, 1.4, 0]), speed: len(h.v), size: 5 });
  }
  // the cars and boats with men of a side in them, or marked (ai/vehicleSides.js; an empty one is no one's)
  out.push(...vehicleContacts(w));
  return out;
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
