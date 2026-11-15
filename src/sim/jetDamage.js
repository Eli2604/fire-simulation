/**
 * What happens to a jet that is hit, for any jet (the one you fly: walk/flight.js; a flight's
 * members: ai/flight.js; the rig's: rig/vehicles.js), on the jet's hit parts
 * (models/vehicleZones.js VEHICLE_ZONES.jet: cockpit, fuel tanks, engines, tail, left and right wing).
 *
 *   hit → the part is damaged and may catch fire (fuel and engines readily; a wing's tank when
 *   badly hit) → a fire grows and eats into its part (and from the fuel into the engines) →
 *   critical (a part destroyed: engines, fuel tanks, a wing torn off, the tail shot away, the pilot
 *   hit; or the whole airframe too far gone) → out of control: it falls, rolling, spinning or
 *   tumbling by what was lost, trailing fire and smoke → impact (ground, deck, water) → it explodes:
 *   jetImpact() puts the blast in the simulation (sim/explosions.js: debris, a crater in loose
 *   ground), sets what is there alight and leaves the fuel burning; on water a short burning slick.
 *
 *   const d = new JetDamage();
 *   d.hit('engines', 350);  // { k, value, destroyed, fire }
 *   d.step(dt);             // the fires grow; returns events: 'fire', 'critical'
 *   d.state                 // 'ok' | 'damaged' | 'burning' | 'falling' | 'crashed'
 *   d.control()             // how it flies out of control: { roll, pitch, yaw } rad/s, thrust 0-1
 *   d.emitters()            // burning / smoking spots, jet frame: [{ k, p, fire, smoke }]
 *   d.impact(water)         // 'crashed': { energy, fuel, water }
 *
 * Deterministic and pure (no three.js, no Math.random).
 */
import { VEHICLE_ZONES, hitPart, integrity, vehicleZones } from '../models/vehicleZones.js';
import { explode } from './explosions.js';
import { impact, groundMaterial } from './impact.js';

export const JET_PARTS = VEHICLE_ZONES.jet.map((z) => z.k);
/** The flight model's parts (walk/flight.js PARTS) for each hit part. */
export const SIM_PART = Object.fromEntries(VEHICLE_ZONES.jet.map((z) => [z.k, z.sim ?? z.k]));
/** And back. */
export const HIT_PART = Object.fromEntries(Object.entries(SIM_PART).map(([k, s]) => [s, k]));

/** How readily each part catches fire (the damage at which it does). */
const IGNITE = { fuel: 0.3, engines: 0.45, wingL: 0.6, wingR: 0.6, tail: 2, cockpit: 2 };
/** How fast a fire eats into its part (per second at full fire). */
const BURN = { fuel: 0.05, engines: 0.06, wingL: 0.04, wingR: 0.04, tail: 0.03, cockpit: 0.03 };
const CENTRES = Object.fromEntries(vehicleZones('jet').map((Z) => [Z.k, Z.boxes.reduce((a, b) => a.map((v, i) => v + b.c[i] / Z.boxes.length), [0, 0, 0])]));

export class JetDamage {
  constructor() {
    this.dmg = {};
    this.fire = {};
    this.state = 'ok';
    this.t = 0;
    this.cause = null;
  }

  get burning() {
    return Object.values(this.fire).some((f) => f > 0);
  }
  get integrity() {
    return integrity(this.dmg, 'jet');
  }
  get falling() {
    return this.state === 'falling';
  }

  /** A hit of `amount` base damage (bullet 25, shell 120, rocket 350) on part k. */
  hit(k, amount) {
    if (this.state === 'crashed') return null;
    const r = hitPart(this.dmg, 'jet', k, amount);
    if (!r) return null;
    let fire = false;
    if (r.value >= IGNITE[k] && !(this.fire[k] > 0)) {
      this.fire[k] = 0.3;
      fire = true;
    }
    this.update();
    return { ...r, fire };
  }

  /**
   * A blast at `p` (jet frame) of radius R: every part near it is hit, the nearest hardest.
   * @returns the parts hit
   */
  blast(p, R, amount = 350) {
    const out = [];
    for (const [k, c] of Object.entries(CENTRES)) {
      const d = Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
      const a = amount * Math.max(0, 1 - d / (2.2 * R));
      if (a > 1) out.push(this.hit(k, a));
    }
    return out.filter(Boolean);
  }

  /** The part nearest to point p (jet frame). */
  static nearest(p) {
    let best = 'fuel';
    let bd = Infinity;
    for (const [k, c] of Object.entries(CENTRES)) {
      const d = Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
      if (d < bd) [best, bd] = [k, d];
    }
    return best;
  }

  /** Critical: what made it so, or null. */
  critical() {
    const d = this.dmg;
    for (const k of ['wingL', 'wingR', 'tail', 'engines', 'fuel', 'cockpit']) if ((d[k] ?? 0) >= 1) return k;
    return this.integrity < 0.3 ? 'airframe' : null;
  }

  update() {
    const events = [];
    if (this.state === 'crashed' || this.state === 'falling') return events;
    const c = this.critical();
    if (c) {
      this.state = 'falling';
      this.cause = c;
      events.push('critical');
    } else this.state = this.burning ? 'burning' : Object.values(this.dmg).some((v) => v > 0) ? 'damaged' : 'ok';
    return events;
  }

  /** The fires grow and eat into their parts; the fuel's fire spreads to the engines. */
  step(dt) {
    this.t += dt;
    const ev = [];
    if (this.state === 'crashed') return ev;
    for (const k of Object.keys(this.fire)) {
      if (!(this.fire[k] > 0)) continue;
      this.fire[k] = Math.min(1, this.fire[k] + 0.25 * dt);
      hitPart(this.dmg, 'jet', k, (BURN[k] * this.fire[k] * dt * VEHICLE_ZONES.jet.find((z) => z.k === k).hp) / VEHICLE_ZONES.jet.find((z) => z.k === k).mult);
    }
    if ((this.fire.fuel ?? 0) > 0.6 && !(this.fire.engines > 0)) {
      this.fire.engines = 0.2;
      ev.push('fire');
    }
    return ev.concat(this.update());
  }

  /** Out of control: how it rolls, pitches and yaws (rad/s), and what thrust is left (0-1). */
  control() {
    const d = this.dmg;
    if (this.state !== 'falling') return { roll: 0, pitch: 0, yaw: 0, thrust: 1 - (d.engines ?? 0) * 0.7 };
    switch (this.cause) {
      case 'wingL':
      case 'wingR':
        // a wing gone: it rolls towards it, a flat spin down
        return { roll: this.cause === 'wingL' ? -3.2 : 3.2, pitch: -0.5, yaw: this.cause === 'wingL' ? 0.9 : -0.9, thrust: 0.3 };
      case 'tail':
        // no tail: it tumbles nose over tail
        return { roll: 0.6, pitch: -1.8, yaw: 0.2, thrust: 0.3 };
      default:
        // the engines, the fuel, the pilot: it noses down in a burning, rolling dive
        return { roll: 1.2, pitch: -0.35, yaw: 0.15, thrust: 0 };
    }
  }

  /** Where it burns and smokes (jet frame), for the renderers. */
  emitters() {
    const out = [];
    for (const k of JET_PARTS) {
      const f = this.fire[k] ?? 0;
      const d = this.dmg[k] ?? 0;
      if (f > 0 || d > 0.25) out.push({ k, p: CENTRES[k], fire: f, smoke: Math.min(1, d + f) });
    }
    return out;
  }

  /** It hit the ground (or the sea): what explodes. */
  impact(water = false) {
    this.state = 'crashed';
    const fuel = Math.max(0, 1 - (this.dmg.fuel ?? 0) * 0.5);
    return { energy: 3e6 + fuel * 1.2e7, fuel, water };
  }
}

/**
 * A jet coming down at `p` (the simulation's coordinates): the blast (debris, a crater where the
 * ground is loose, windows), what is there set alight and the fuel left burning; on water a
 * burning slick for a few seconds. `opts`: { energy, fuel (0-1), water, name, explodeFn }.
 * @returns what it did: { blast, fire, slick }
 */
export function jetImpact(sim, p, opts = {}) {
  const E = opts.energy ?? 1.5e7;
  const fuel = opts.fuel ?? 1;
  const boom = opts.explodeFn ?? explode;
  const w = sim.world;
  w?.events?.push({ type: 'jetCrash', pos: p.slice(), time: w.time, name: opts.name ?? 'A jet' });
  // the wreck itself hitting (sim/impact.js): ~10 t at its speed (default 50 m/s, 30° down): the
  // ground shakes, people near it are knocked over, the boom; the blast below does the harm
  if (w) {
    const sp = opts.speed ?? 50;
    impact(sim, { pos: p.slice(), normal: [0, 1, 0], mass: opts.mass ?? 1e4, velocity: [sp * 0.87, -sp * 0.5, 0], materials: ['aluminium', opts.water ? 'water' : groundMaterial(w, p)], radius: 1.5, size: 8, sizeA: 12, footprint: 6, kind: 'crash', name: opts.name ?? 'A jet', effects: { damage: false, crush: false } });
  }
  if (opts.water) {
    // the fuel burns on the water briefly, then the wreck sinks
    boom(sim, [p[0], p[1] + 0.5, p[2]], E * 0.3, { name: 'jet crash' });
    if (fuel > 0.05) sim.addTorch?.([p[0], p[1] + 1, p[2]], 2.5e5 * fuel, 10, 3);
    return { blast: true, fire: false, slick: fuel > 0.05 };
  }
  boom(sim, p, E, { name: 'jet crash' });
  let fire = false;
  if (fuel > 0.05) {
    sim.ignite?.(p, 3);
    // the fuel fireball, and what stays burning in the wreck
    sim.addTorch?.([p[0], p[1] + 1.5, p[2]], 6e5 * fuel, 6, 3);
    sim.addTorch?.([p[0], p[1] + 0.6, p[2]], 1.5e5 * fuel, 45, 1.5);
    fire = true;
  }
  return { blast: true, fire, slick: false };
}
