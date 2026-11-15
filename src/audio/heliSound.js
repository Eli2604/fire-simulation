/**
 * The helicopter's sound from its physical state (no Web Audio here: pure numbers, tested in
 * Node; audio/heliVoices.js synthesises them). Every helicopter (ai/helicopter.js), flown by its
 * own pilot or by you, is heard the same way:
 *
 *  - main rotor: its speed (h.omega, of flight rpm: the spin-up on the ground, the run-down after
 *    landing, the autorotation's ~92 %, nothing once the blades are gone) gives the rpm and the
 *    blade passage frequency (rpm / 60 × blades: ~17 Hz on a 4-blade 258 rpm rotor), the thud.
 *    Its loudness from the thrust (the load: what holds it up, more in a bank, a pull, a climb)
 *    and the tip speed (rotational noise ∝ thrust² × tip Mach^n).
 *  - blade slap (impulsive noise): the blades hitting the tip vortices of the blade before
 *    (blade-vortex interaction: a descent into its own wake at approach speeds, the vortex ring
 *    at a slow steep descent), a high load (a tight turn, a hard pull) and, fast, the advancing
 *    tip nearing the speed of sound (high-speed impulsive noise).
 *  - a rotor hit (h.vibration): an out-of-balance beat once a revolution.
 *  - tail rotor: its own speed (HELI.tailRev, ~5.6 × the main rotor's: a buzz near 80 Hz), louder
 *    with what it has to hold against (the torque: the engine's power, the pedals); none once
 *    it is shot away.
 *  - turbine: the gas generator's whine (its spool speed from the power asked of it), the exhaust;
 *    rough with a damaged engine; gone with a dead one (heliVoices lets it spool down).
 *  - to the listener: inverse-square spreading and the air's absorption of the highs (audio/
 *    physics.js propagate), and the Doppler shift from the two velocities along the line between.
 *  - crashes: heliCrashSound (the airframe on the ground, the blades striking it at their passage
 *    rate), heliHitSound (a round through the aluminium skin).
 */
import { C_AIR, RHO_AIR, dbOf, gainOf, propagate } from './physics.js';
import { HELI, heliAxes } from '../ai/helicopter.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const bump = (x, mid, w) => Math.exp(-(((x - mid) / w) ** 2));
const G = 9.81;
/** Tail rotor blades (a UH-60's: 4). */
export const TAIL_BLADES = 4;
/** Induced velocity at the hover (m/s): √(W / 2ρA), the downwash the vortex ring forms round. */
export const V_INDUCED = Math.sqrt((HELI.mass * G) / (2 * RHO_AIR * Math.PI * HELI.rotorR ** 2));
/** The main rotor's tip speed at flight rpm (m/s). */
export const TIP_SPEED = 2 * Math.PI * HELI.rotorRev * HELI.rotorR;

/**
 * The rotor's thrust as a fraction of the weight (the load factor): what the pilot's collective
 * asks (yours: h.controls.collective, as stepPlayer flies it; his own: what holds the height at
 * this bank and pitch, more to climb), the autorotation's, nothing without blades; on the
 * ground, flat pitch.
 */
export function heliLoad(h) {
  const omega = clamp(h.omega ?? 0, 0, 1.2);
  if ((h.blades ?? HELI.blades) === 0 || omega < 0.05 || h.crashed) return 0;
  if (h.landed && !(h.player && (h.controls?.collective ?? 0) > 0.15)) return 0.12 * omega * omega;
  const A = heliAxes(h.yaw ?? 0, h.pitch ?? 0, h.roll ?? 0);
  const level = 1 / Math.max(0.5, A.u[1]); // the disc tilted: more thrust for the same lift
  const vy = h.v?.[1] ?? 0;
  let load;
  if (h.failure === 'main') load = 0;
  else if (h.failure === 'engine') load = 0.78 + (h.player ? 0.6 * Math.max(0, h.controls?.collective ?? 0) : vy > -4 ? 0.5 : 0); // (the flare)
  else if (h.failure === 'tail' && !h.player) load = HELI.tailLift;
  else if (h.player && h.controls) load = (1 + HELI.collective * clamp(h.controls.collective ?? 0, -1, 1)) * level;
  else load = level + 0.25 * clamp(vy / HELI.climb, -1, 1);
  return clamp(load * Math.min(1, omega * omega), 0, HELI.thrustMax * 1.2);
}

/**
 * Blade slap 0..1 and what makes it: { slap, bvi (descent into its own wake), vrs (vortex ring),
 * hsi (advancing tip Mach), pull (load over 1 g: turns, pull-ups), mach }.
 */
export function bladeSlap(h, load = heliLoad(h)) {
  const omega = clamp(h.omega ?? 0, 0, 1.2);
  if ((h.blades ?? HELI.blades) === 0 || omega < 0.5 || h.crashed) return { slap: 0, bvi: 0, vrs: 0, hsi: 0, pull: 0, mach: 0 };
  const v = h.v ?? [0, 0, 0];
  const vh = Math.hypot(v[0], v[2]);
  const sink = Math.max(0, -v[1]);
  // blade-vortex interaction: descending at a few m/s at approach speeds the disc meets its own tip vortices
  const bvi = bump(sink, 3.5, 2.2) * bump(vh, 20, 11) * clamp(sink / 1.2, 0, 1);
  // vortex ring: slow, sinking at about half the induced velocity: the wake recirculates through the disc
  const vrs = bump(sink, 0.55 * V_INDUCED, 0.3 * V_INDUCED) * clamp(1 - vh / 14, 0, 1);
  // high-speed impulsive noise: the advancing tip near Mach 0.9
  const mach = (TIP_SPEED * omega + vh) / C_AIR;
  const hsi = clamp((mach - 0.8) / 0.12, 0, 1);
  // more thrust than the weight: a tight turn, a hard pull, a heavy climb; the tip vortices are stronger
  const pull = clamp((load - 1.05) * 2.2, 0, 1);
  const parts = [bvi, 0.85 * vrs, hsi, pull];
  const top = Math.max(...parts);
  const slap = clamp(top + 0.3 * (parts.reduce((a, x) => a + x, 0) - top), 0, 1) * clamp((omega - 0.5) / 0.35, 0, 1);
  return { slap, bvi, vrs, hsi, pull, mach };
}

/**
 * The Doppler factor for a source moving at vs and a listener at vl (m/s), u the unit vector from
 * the source to the listener: f' = f (c − vl·u) / (c − vs·u).
 */
export function doppler(vs, vl, u, c = C_AIR) {
  const s = (vs?.[0] ?? 0) * u[0] + (vs?.[1] ?? 0) * u[1] + (vs?.[2] ?? 0) * u[2];
  const l = (vl?.[0] ?? 0) * u[0] + (vl?.[1] ?? 0) * u[1] + (vl?.[2] ?? 0) * u[2];
  return clamp((c - l) / Math.max(c * 0.2, c - s), 0.5, 2);
}

/**
 * Helicopter h heard by a listener { pos, vel } (vel m/s: for the Doppler; pos missing: heard
 * at 10 m, no shift). Frequencies in Hz (Doppler-shifted, except the *0 ones), gains 0..~1.5 at
 * the source (before `level`, the propagation's), level and cutoff from audio/physics.js propagate.
 */
export function heliSoundParams(h, listener = {}) {
  const omega = clamp(h.omega ?? 0, 0, 1.2);
  const blades = h.blades ?? HELI.blades;
  const revHz = omega * HELI.rotorRev;
  const rpm = revHz * 60;
  const bpf0 = revHz * blades;
  const tailOn = !h.gone?.has?.('tailRotor') && !h.gone?.has?.('tailBoom');
  const tailRevHz = tailOn ? omega * HELI.tailRev : 0;
  const tailBpf0 = tailRevHz * TAIL_BLADES;
  const load = heliLoad(h);
  const S = bladeSlap(h, load);
  // main rotor: rotational (loading) noise ∝ T² × tip Mach⁵ (Gutin), in dB re 1 pW (~128 dB at the hover)
  const rotorOn = blades > 0 && omega > 0.02;
  const thrust = Math.max(0.12, load);
  const rotorDb = rotorOn ? 128 + 20 * Math.log10(thrust) + 50 * Math.log10(Math.max(0.03, omega)) : 0;
  const rotorGain = rotorOn ? gainOf(rotorDb, 125, 1.6) : 0;
  const slapGain = rotorOn ? 1.3 * S.slap * Math.min(1, rotorGain + 0.2) : 0;
  // the engines: on while it is meant to run (spinning up, flying, idling on the ground), not when
  // shut down, failed or wrecked; the power from the rotor's thrust at its speed (P ∝ T^1.5 / Ω roughly: here T·Ω)
  const dmgE = clamp(h.dmg?.engine ?? 0, 0, 1);
  const engineOn = !h.crashed && h.failure !== 'engine' && dmgE < 1 && (h.omegaWant ?? 1) > 0 && h.mode !== 'parked';
  const power = engineOn ? clamp(0.12 + 0.88 * load * Math.max(omega, 0.3) * (h.blades === 0 ? 0.2 : 1), 0, 1.4) * (1 - 0.4 * dmgE) : 0;
  const n1 = engineOn ? clamp(0.6 + 0.3 * power, 0, 1.05) : 0; // the gas generator's speed (idle ~60 %)
  const turbineHz0 = 800 + 4000 * n1; // the compressor's whine (blade passage of its first stage, scaled into hearing)
  const turbineGain = engineOn ? 0.1 + 0.25 * Math.min(1, power) : 0;
  const grit = engineOn ? clamp(Math.max(dmgE, h.smoke ?? 0), 0, 1) : 0;
  const exhaustGain = engineOn ? 0.12 + 0.3 * Math.min(1, power) : 0;
  // tail rotor: it holds the torque (the engine's power) and turns it (the pedals, the yaw rate)
  const yawK = Math.min(1, Math.abs(h.controls?.pedal ?? 0) + Math.abs(h.yawRate ?? 0) / HELI.pedalRate);
  const tailGain = tailOn && omega > 0.02 ? omega * omega * (0.18 + 0.25 * Math.min(1, power) + 0.2 * yawK) : 0;
  const imbalance = rotorOn ? clamp(h.vibration ?? 0, 0, 1) * Math.min(1, omega) : 0;
  // to the listener: from the rotor head
  const src = [h.p[0], h.p[1] + 3, h.p[2]];
  const lp = listener.pos;
  const dv = lp ? [lp[0] - src[0], lp[1] - src[1], lp[2] - src[2]] : [10, 0, 0];
  const dist = Math.hypot(dv[0], dv[1], dv[2]);
  const u = dist > 1e-6 ? dv.map((x) => x / dist) : [1, 0, 0];
  const dop = lp ? doppler(h.v, listener.vel, u) : 1;
  const pr = propagate(dist, { ref: 8, occluded: !!listener.occluded, underwater: !!listener.underwater });
  const loudest = Math.max(rotorGain + slapGain, turbineGain + exhaustGain, tailGain);
  return {
    omega, rpm, revHz: revHz * dop, blades, bpf: bpf0 * dop, bpf0,
    load, slap: S.slap, why: S, mach: S.mach,
    rotorDb, rotorGain, slapGain, slapFreq: (450 + 1500 * S.slap + 600 * S.hsi) * dop,
    // the thud's brightness: more harmonics of the blade passage with more load and slap
    thumpCutoff: Math.max(60, bpf0 * (4 + 3 * thrust + 14 * S.slap)) * dop,
    tailOn, tailRevHz, tailBpf: tailBpf0 * dop, tailBpf0, tailGain,
    engineOn, power, n1, turbineHz: turbineHz0 * dop, turbineHz0, turbineGain, exhaustGain, grit,
    imbalance,
    dist, doppler: dop, level: pr.gain, cutoff: pr.cutoff, delay: pr.delay,
    heard: loudest * pr.gain,
  };
}

/**
 * A helicopter coming down onto the ground (a heliCrash event: severity, energy J, the rotor's
 * omega and blades then): the boom of the airframe (dB from the energy), how long the metal
 * grinds, and the blades striking the ground one after another at their passage rate until
 * they shatter (about a turn and a half).
 */
export function heliCrashSound({ severity = 'crash', energy = 2e5, omega = 1, blades = HELI.blades } = {}) {
  const db = dbOf(0.01 * Math.max(1, energy));
  const sev = severity === 'destroyed' ? 1 : severity === 'crash' ? 0.65 : 0.3;
  const revHz = Math.max(0, omega) * HELI.rotorRev;
  const strikes = blades > 0 && omega > 0.3 && severity !== 'hard' ? Math.round(blades * 1.5) : 0;
  return {
    db,
    gain: gainOf(db, 150, 2.4),
    boom: clamp(90 - 40 * sev, 30, 120),
    grind: 0.6 + 2.4 * sev,
    strikes,
    interval: strikes ? 1 / (revHz * blades) : 0,
  };
}

/** A round through the airframe's skin (heliHit: the part, the weapon's damage): a sharp tick of aluminium, a bang for a rocket. */
export function heliHitSound({ damage = 25, part = 'cabin' } = {}) {
  const E = Math.max(1, damage) * 60; // J delivered (a rifle round ~1.5 kJ)
  const glass = part === 'cockpit';
  return { energy: E, materials: ['steel', glass ? 'glass' : 'aluminium'], mass: damage > 100 ? 10 : 0.01, speed: damage > 100 ? 200 : 800, size: part === 'rotor' || part === 'tailRotor' ? 0.6 : 1.5, sizeA: 0.02, radius: 0.004 };
}
