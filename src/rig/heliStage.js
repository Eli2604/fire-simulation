/**
 * The helicopter on the rig stage (no drawing here: see rig/heli.js). One helicopter
 * (ai/helicopter.js: the simulation's own pilot AI, crew, guns, hit parts and failures) over a flat
 * field with a landing pad at the middle (y = 0), and a few targets on the ground for the guns.
 * Each act sets it up and lets the AI fly it: parked, start-up (the rotor spinning up, take-off),
 * hover, transit (forward flight round the field), approach and flare to a hover, landing (the
 * troops jump out), the doors, the fast-rope (the troops down two cables: ai/rope.js), the door
 * gunners firing at the targets, the troops firing their own weapons out of the doors, and the ways
 * of coming down (the tail rotor, the main rotor, the engine shot away; the fuel tank alight).
 * The rounds are only drawn (tracers); the men are hurt only by the helicopter's own hits and crashes.
 *
 *   const st = createHeliStage();
 *   st.play('fastRope');            // any of HELI_ACTS
 *   st.step(dt);                    // every frame (the helicopter, the men on the ropes)
 *   st.hitZone('tailRotor', 'rocket');
 *   st.set({ soldiers: 4, doorGuns: 'left' });   // then the act again
 */
import { Helicopter } from '../ai/helicopter.js';
import { stepRopes } from '../ai/rope.js';
import { VEHICLE_WEAPONS } from '../models/vehicleZones.js';

/** What the helicopter does, as buttons. */
export const HELI_ACTS = {
  parked: 'Parked (rotor still)',
  startUp: 'Start-up & take-off',
  hover: 'Hover',
  transit: 'Transit (forward flight)',
  approach: 'Approach & flare',
  land: 'Land (troops out)',
  doors: 'Doors open / shut',
  fastRope: 'Fast-rope (troops down cables)',
  doorGun: 'Door gunners fire',
  troopsFire: 'Troops fire from the doors',
  crashTail: 'Hit: tail rotor (spins down)',
  crashMain: 'Hit: main rotor (falls)',
  crashEngine: 'Hit: engine (autorotation)',
  fuelFire: 'Hit: fuel tank (fire)',
};
/** The acts the targets are up for. */
const GUN_ACTS = new Set(['doorGun', 'troopsFire', 'hover', 'approach']);
/** The targets on the ground (the guns' and the troops'). */
export const STAGE_TARGETS = [[34, 0.9, 30], [-30, 0.9, 34], [28, 0.9, -32], [-36, 0.9, -26], [6, 0.9, 42], [4, 0.9, -44]];
/** Crash acts: which part, when (s into the act), with what. */
const CRASH = { crashTail: ['tailRotor', 2], crashMain: ['rotor', 2.5], crashEngine: ['engine', 2.5], fuelFire: ['fuel', 2.5] };

export function createHeliStage() {
  const world = { time: 0, events: [], noises: [], enemies: [], ropes: [], tracers: [], voxelAt: () => -1, mat: [] };
  // what ai/rope.js asks of a simulation: its world, and what is solid (the field: below y = 0)
  const sim = { world, solid: (x, y) => y < 0, rand: Math.random };
  const st = {
    world,
    sim,
    act: 'hover',
    t: 0,
    params: { soldiers: 6, doorGuns: 'both' },
    targets: STAGE_TARGETS,
    h: null,
    lastHit: null,
  };
  const host = {
    sim,
    world,
    ground: () => 0,
    addCrew: (e) => world.enemies.push(e),
    targets: () => (GUN_ACTS.has(st.act) ? st.targets : []),
    // a round: drawn as a tracer to where it meets the ground (or 200 m out)
    fire: (e, from, dir) => {
      const t = dir[1] < -1e-3 ? Math.min(200, -from[1] / dir[1]) : 200;
      world.tracers.push({ a: from.slice(), b: from.map((v, i) => v + dir[i] * t), t: world.time });
      if (world.tracers.length > 60) world.tracers.shift();
      return null;
    },
    radio: (h, text) => world.events.push({ type: 'heliRadio', pos: h.p.slice(), time: world.time, name: `${h.call}: ${text}` }),
  };

  /** The helicopter for an act. */
  function setup(act) {
    const base = { lz: [0, 0, 0], soldiers: st.params.soldiers, doorGuns: st.params.doorGuns, callsign: 'Hawk', seed: 3 };
    const east = { yaw: Math.PI / 2, startSpeed: 30 };
    const C = {
      parked: { p: [0, 0, 0], airborne: false, autoStart: false, mission: 'land' },
      startUp: { p: [0, 0, 0], airborne: false, mission: 'hover', altitude: 20 },
      hover: { p: [0, 0, 0], startAlt: 12, startSpeed: 0, mission: 'hover' },
      doors: { p: [0, 0, 0], startAlt: 12, startSpeed: 0, mission: 'hover' },
      troopsFire: { p: [0, 0, 0], startAlt: 12, startSpeed: 0, mission: 'hover', doorGuns: 'none' },
      transit: { p: [0, 0, -120], ...east, mission: 'overwatch', orbitRadius: 120, altitude: 30 },
      approach: { p: [-220, 0, 0], ...east, mission: 'hover', altitude: 30 },
      land: { p: [-220, 0, 0], ...east, mission: 'land', altitude: 30 },
      fastRope: { p: [-170, 0, 0], ...east, mission: 'insert', altitude: 25 },
      doorGun: { p: [0, 0, -45], ...east, mission: 'overwatch', orbitRadius: 45, altitude: 22, startAlt: 18 },
      crashTail: { p: [0, 0, 0], startAlt: 40, startSpeed: 0, mission: 'hover', hoverAlt: 40, ropeLength: 50 },
      crashMain: { p: [0, 0, -100], ...east, mission: 'overwatch', orbitRadius: 100, altitude: 50 },
      crashEngine: { p: [0, 0, -100], ...east, mission: 'overwatch', orbitRadius: 100, altitude: 50 },
      fuelFire: { p: [0, 0, -100], ...east, mission: 'overwatch', orbitRadius: 100, altitude: 40 },
    }[act];
    return new Helicopter({ ...base, ...C }, host);
  }

  st.play = (act) => {
    if (!HELI_ACTS[act]) return false;
    st.act = act;
    st.t = 0;
    st.lastHit = null;
    st.hitDone = false;
    world.enemies.length = 0;
    world.ropes.length = 0;
    world.tracers.length = 0;
    world.events.length = 0;
    st.h = setup(act);
    if (act === 'transit') st.h.doorsHold = { L: 0, R: 0 };
    return true;
  };
  st.set = (p) => {
    Object.assign(st.params, p);
    st.play(st.act);
  };
  st.step = (dt) => {
    if (!st.h || dt <= 0) return;
    world.time += dt;
    st.t += dt;
    if (st.act === 'doors') st.h.doorsHold = Math.floor(st.t / 4) % 2 ? { L: 0, R: 0 } : { L: 1, R: 1 };
    const c = CRASH[st.act];
    if (c && st.t >= c[1] && !st.hitDone) {
      st.hitDone = true;
      st.h.hit(c[0], VEHICLE_WEAPONS.rocket * 2);
    }
    st.h.step(dt);
    stepRopes(sim, dt);
  };
  /** A hit on part k (VEHICLE_ZONES.helicopter) by a weapon (VEHICLE_WEAPONS: bullet, shell, rocket). */
  st.hitZone = (k, weapon = 'bullet') => {
    const r = st.h?.hit(k, VEHICLE_WEAPONS[weapon] ?? VEHICLE_WEAPONS.bullet, null, null, weapon);
    st.lastHit = r && { k, weapon, ...r };
    return r;
  };
  st.revive = () => st.play(st.act);
  st.play('hover');
  return st;
}
