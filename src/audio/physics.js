/**
 * The physics behind the sounds (no Web Audio here: pure numbers, tested in Node). Every sound
 * the SoundScape (audio/sound.js) makes takes its parameters from these, fed with the physical
 * state of its source, instead of hand-set constants:
 *
 *  - struck solids, modal synthesis: modes(material, size, shape) → the ringing partials of a
 *    struck body: frequencies from the material's stiffness and density (c = √(E/ρ)) and the
 *    body's size and shape (flexural f ∝ c·t/L², longitudinal f = c/2L), each decaying with the
 *    material's loss factor (τ = 1/(π f η)). contact() is Hertz contact between the two bodies:
 *    the contact time (hard on hard: tens of µs, a bright click; flesh on soil: tens of ms, a
 *    thud) sets how high the modes are excited. impactSound() puts them together for an impact
 *    of a given energy (sim/impact.js): the level (dB = 10·log10 of the radiated energy), the
 *    partials, the contact noise, bubbles for a splash, shards for glass, a ground boom for a
 *    very big one (a dragon landing, a jet crash).
 *  - flows: filtered turbulence noise. fireRoar() (combustion noise: its power ∝ the heat
 *    release, its spectrum lower the bigger the flame, puffing at 1.5/√D Hz), jetEngine() and
 *    decompression() (Lighthill's V⁸ law), windNoise() (Aeolian tones, Strouhal 0.2),
 *    wingBeat(), steamHiss().
 *  - bubbles: minnaert() (a bubble of radius r rings at 3.28/r Hz in water): splashes, rain on
 *    water, a waterfall.
 *  - pulse trains: crackle() (the pops of a burning fuel: steam and pyrolysis gas bursting out
 *    of it; how often from its moisture, resin and grain size), metalTick() (thermal expansion).
 *  - propagation: propagate() (inverse-square spreading, air absorption of the highs, the speed
 *    of sound delay, muffling through walls and under water).
 *  - CPU: aggregate() merges distant sources into few voices; lodFor() by distance.
 *
 * Levels are sound energy / power levels in dB re 1 pW (1e-12 W or J); gainOf() maps them to
 * a Web Audio gain (a compressed curve: +40 dB is ×10 in amplitude, so a dragon landing is
 * louder than a punch without the punch vanishing).
 */
import { mechanics } from '../sim/materials.js';

export const C_AIR = 343; // m/s
export const C_WATER = 1480;
export const RHO_AIR = 1.2;
export const P_ATM = 101325;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mat = (m) => (m && typeof m === 'object' ? m : mechanics(m ?? 'soil'));

/** dB re 1 pW (or pJ) of an acoustic power (W) or energy (J). */
export const dbOf = (w) => 10 * Math.log10(Math.max(w, 1e-12) / 1e-12);
/** The Web Audio gain for a level (dB): 0 dB at `ref`, ×10 every 40 dB, at most `max`. */
export const gainOf = (db, ref = 125, max = 3) => clamp(10 ** ((db - ref) / 40), 0, max);

/* ---------------- struck solids: modal synthesis ---------------- */

/** Mode frequency ratios of each shape class (free-free bar; plate; shell: a drum, a bell; block; ...). */
export const MODE_RATIOS = {
  bar: [1, 2.756, 5.404, 8.933],
  plate: [1, 1.59, 2.14, 2.65, 3.16],
  shell: [1, 1.51, 2.0, 2.47, 3.01, 3.98],
  block: [1, 1.73, 2.0, 2.45],
  soft: [1, 1.62],
  granular: [1, 1.9],
  liquid: [1],
};
/** Thickness (or radius of gyration) as a fraction of the size, per shape: thin things ring low. */
const THICK = { bar: 0.08, plate: 0.03, shell: 0.012 };
const FLEX = { bar: 1.028, plate: 0.9, shell: 1.2 };

/** The speed of sound in a material (m/s): √(E/ρ). */
export const soundSpeed = (m) => {
  const M = mat(m);
  return Math.sqrt(M.E / M.density);
};

/**
 * The ringing modes of a body of material `m`, size L (m), shape (default: the material's own):
 * { f: Hz[], tau: s[], amp: [] }. Flexural shapes (bar, plate, shell): f₁ = k·c·t/L² with t the
 * thickness (a fraction of L); solid ones (block, soft, granular): f₁ = c/2L. Higher modes at the
 * shape's ratios, each ringing τ = 1/(π f η), weaker the higher.
 */
export function modes(m, size = 0.5, shape) {
  const M = mat(m);
  const sh = shape ?? M.shape;
  const L = Math.max(0.005, size);
  const c = soundSpeed(M);
  let f1;
  if (sh === 'liquid') f1 = minnaert(clamp(0.004 * Math.sqrt(L / 0.3), 0.0008, 0.02));
  else if (FLEX[sh]) f1 = (FLEX[sh] * c * THICK[sh] * L) / (L * L);
  else f1 = c / (2 * L);
  const R = MODE_RATIOS[sh] ?? MODE_RATIOS.block;
  const f = [], tau = [], amp = [];
  R.forEach((r, n) => {
    const fn = f1 * r;
    if (fn > 18000) return;
    f.push(fn);
    tau.push(clamp(1 / (Math.PI * Math.max(fn, 1) * M.eta), 0.003, 8));
    amp.push(1 / Math.sqrt(n + 1));
  });
  return { f, tau, amp, f1, shape: sh };
}

/**
 * Hertz contact between bodies of materials a and b: the effective mass (kg), the closing speed
 * (m/s) and the radius of the contact (m). Returns { tc (s), cutoff (Hz, ~1/tc: how bright),
 * e (coefficient of restitution), Estar (Pa) }.
 */
export function contact(a, b, { mass = 1, speed = 1, radius = 0.05 } = {}) {
  const A = mat(a), B = mat(b);
  const Estar = 1 / ((1 - A.nu ** 2) / A.E + (1 - B.nu ** 2) / B.E);
  const v = Math.max(0.01, speed);
  const tc = clamp(2.87 * ((mass * mass) / (Math.max(0.002, radius) * Estar * Estar * v)) ** 0.2, 4e-5, 0.4);
  const e = clamp(0.1 + 0.8 * Math.sqrt(A.hardness * B.hardness) * (1 - (A.eta + B.eta) / 2), 0.02, 0.95);
  return { tc, cutoff: clamp(1 / tc, 25, 16000), e, Estar };
}

/** A mode at f excited by a half-sine contact of duration tc: how strongly (1 below ~1/2tc, falling above). */
const excite = (f, tc) => 1 / (1 + (2 * f * tc) ** 2);

/**
 * The sound of an impact (sim/impact.js computes the physics). o: { materials: [striker, struck],
 * energy (J), mass (kg, effective), speed (m/s), radius (contact, m), size (the struck body, m),
 * sizeA (the striker, m), footprint (m: what moves the ground, for the boom) }. Returns
 * { db, gain, contact, partials: [{ f, tau, amp }], noise: { amp, cutoff, dur }, bubbles, shards,
 * boom, dur }.
 */
export function impactSound(o) {
  const [a, b] = o.materials ?? ['flesh', 'soil'];
  const A = mat(a), B = mat(b);
  const E = Math.max(1e-6, o.energy ?? 0.5 * (o.mass ?? 1) * (o.speed ?? 1) ** 2);
  const rad = (A.radiation + B.radiation) / 2;
  const db = dbOf(E * rad);
  const gain = gainOf(db);
  const ct = contact(A, B, { mass: o.mass ?? 1, speed: o.speed ?? 1, radius: o.radius ?? 0.05 });
  const partials = [];
  const add = (M, size, w) => {
    const md = modes(M, size);
    if (md.shape === 'liquid' || md.shape === 'granular') return;
    md.f.forEach((f, i) => {
      const amp = w * md.amp[i] * excite(f, ct.tc);
      if (amp > 0.01) partials.push({ f, tau: md.tau[i], amp });
    });
  };
  add(B, o.size ?? 0.5, 1);
  add(A, o.sizeA ?? 0.2, 0.6);
  partials.sort((x, y) => y.amp - x.amp);
  partials.length = Math.min(partials.length, 8);
  // the contact itself: a noise burst as long as the contact, as bright as it is short; soft and
  // loose things (flesh, soil, sand) are mostly this, a thud with a hiss of grains
  const dull = A.shape === 'soft' || B.shape === 'soft' || B.shape === 'granular' || B.shape === 'liquid';
  const noise = { amp: dull ? 1 : 0.35, cutoff: ct.cutoff * (B.shape === 'granular' ? 3 : 1.5), dur: clamp(ct.tc * 4 + (B.shape === 'granular' ? 0.12 : 0.02), 0.01, 0.6) };
  // a splash: bubbles (Minnaert), more and bigger with the energy
  let bubbles = null;
  if (A.shape === 'liquid' || B.shape === 'liquid') {
    const n = Math.round(clamp(3 * Math.log10(1 + E), 1, 30));
    const r = clamp(0.0015 * (1 + Math.log10(1 + E) * 0.5), 0.001, 0.02);
    bubbles = { n, r, f: minnaert(r), spread: clamp(0.05 + Math.log10(1 + E) * 0.15, 0.05, 1.5) };
  }
  // glass, ceramic, ice: hit hard enough it shatters: shards, each a small high ringing piece
  let shards = null;
  const brittle = B.brittle ? B : A.brittle ? A : null;
  if (brittle && E > 4 + brittle.strength / 2e7) {
    const n = Math.round(clamp(2 * Math.log2(1 + E / 4), 2, 24));
    shards = { n, f: modes(brittle, 0.04).f1, tau: modes(brittle, 0.04).tau[0], spread: clamp(0.15 + Math.log10(1 + E) * 0.12, 0.15, 1.2) };
  }
  // the ground boom of a very big impact: the ground under it moving as one, ~ c/(2·footprint)
  let boom = null;
  if (E > 1e4) {
    const G = B.shape === 'granular' || B.shape === 'block' ? B : mechanics('soil');
    const fp = o.footprint ?? Math.max(0.5, Math.cbrt(E / 2e4));
    boom = { f: clamp(soundSpeed(G) / (2 * fp), 16, 80), amp: clamp(Math.log10(E / 1e4) * 0.6 + 0.3, 0.3, 2.5), dur: clamp(0.4 + Math.log10(E / 1e4) * 0.5, 0.4, 3) };
  }
  const ring = partials.length ? Math.max(...partials.map((p) => p.tau)) : 0;
  return { db, gain, contact: ct, partials, noise, bubbles, shards, boom, dur: Math.min(8, Math.max(noise.dur, ring * 3, boom?.dur ?? 0)) };
}

/** The resonance of a gas bubble of radius r (m) in water (Minnaert): ≈ 3.28 / r Hz. */
export function minnaert(r, P = P_ATM, rho = 1000, gamma = 1.4) {
  return Math.sqrt((3 * gamma * P) / rho) / (2 * Math.PI * Math.max(1e-5, r));
}

/* ---------------- flows: turbulence noise ---------------- */

/** Heskestad's mean flame height (m) for a fire of Q W and diameter D m. */
export const flameHeight = (Q, D) => Math.max(0, 0.235 * Math.max(0, Q / 1000) ** 0.4 - 1.02 * D);
/** The diameter (m) of a fire of Q W at a typical ~400 kW/m² over its burning area. */
export const fireDiameter = (Q) => Math.max(0.03, Math.sqrt((4 * Math.max(0, Q)) / (Math.PI * 4e5)));

/**
 * The roar of a fire: { db (sound power), gain, peak (Hz), cutoff (Hz), flicker (Hz), height (m) }.
 * Turbulent combustion noise radiates a small fixed fraction of the heat release (thermoacoustic
 * efficiency ~2e-6), more in wind (more turbulence). Its spectrum peaks lower the bigger the
 * flame (~160/√D Hz: a big fire rumbles, a small one hisses), and the flame puffs at 1.5/√D Hz.
 */
export function fireRoar({ hrr = 0, diameter, wind = 0 } = {}) {
  const D = diameter ?? fireDiameter(hrr);
  const P = 2e-6 * Math.max(0, hrr) * (1 + 0.12 * Math.max(0, wind));
  const db = dbOf(P);
  const peak = clamp((160 / Math.sqrt(Math.max(0.03, D))) * (1 + 0.04 * Math.max(0, wind)), 35, 1400);
  return { db, gain: hrr > 0 ? gainOf(db, 122, 2) : 0, peak, cutoff: clamp(peak * 4, 150, 6000), flicker: clamp(1.5 / Math.sqrt(Math.max(0.03, D)), 0.3, 9), height: flameHeight(hrr, D), power: P };
}

/**
 * The pops of burning fuel: steam and pyrolysis gas bursting out of it. o: { material, moisture
 * (kg/kg), count (burning pieces / voxels), temp }. Returns { rate (pops/s), amp (each, 0..1),
 * band (Hz), kind ('crackle' | 'hiss' | 'flutter' | 'smoulder' | 'whoosh'), hiss (0..1) }.
 * The rate rises with the moisture (more steam pockets bursting) up to ~20 %, then falls (too wet:
 * it steams and smoulders); resin pops (pine > oak); fine fuel (grass, needles) crackles fast and
 * small, logs seldom and loud.
 */
export function crackle({ material = 'wood', moisture = 0.1, count = 1, temp = 600 } = {}) {
  const M = mat(material);
  const ms = 0.2;
  const g = (moisture / ms) * Math.exp(1 - moisture / ms);
  const grain = Math.max(0.0008, M.grain);
  const kind = M.burnSound;
  const per = (kind === 'smoulder' ? 0.2 : kind === 'whoosh' ? 0.1 : 1) * M.pop * (0.25 + g) * Math.sqrt(0.004 / grain) * 1.2;
  const hot = clamp((temp - 250) / 400, 0.2, 1.2);
  const rate = clamp(per * Math.sqrt(Math.max(0, count)) * 6 * hot, 0, 400);
  return {
    rate,
    amp: clamp(0.25 * Math.sqrt(grain / 0.01) * (0.5 + M.pop), 0.03, 1),
    band: clamp(2200 * Math.sqrt(0.05 / grain), 900, 9000),
    kind,
    hiss: kind === 'hiss' || kind === 'whoosh' ? clamp(0.2 + 0.1 * Math.log10(1 + count), 0.2, 0.8) : 0,
  };
}

/** Water flashing to steam on a hot surface (kg/s): the hiss. { db, gain, band }. */
export function steamHiss(rate) {
  // the steam jets out of the boundary layer at ~20-40 m/s; ~1e-4 of its kinetic power is heard
  const P = 1e-4 * 0.5 * Math.max(0, rate) * 30 ** 2;
  const db = dbOf(P);
  return { db, gain: rate > 0 ? gainOf(db, 100, 1.5) : 0, band: clamp(3500 + 400 * Math.log10(1 + rate * 100), 3000, 7000) };
}

/** Metal heating or cooling at dTdt K/s (count voxels / pieces): ticks and pings from thermal strain. */
export function metalTick({ material = 'steel', dTdt = 0, count = 1, size = 0.3 } = {}) {
  const M = mat(material);
  const strainRate = M.alpha * Math.abs(dTdt);
  const md = modes(M, size);
  return { rate: clamp((strainRate / 2e-6) * Math.sqrt(Math.max(0, count)), 0, 25), f: md.f.slice(0, 3), tau: md.tau.slice(0, 3) };
}

/** Lighthill: the acoustic power (W) of a jet of velocity V (m/s), diameter D (m), density rho. */
export const lighthill = (V, D, rho = RHO_AIR) => 3e-5 * rho * V ** 8 * D * D / C_AIR ** 5;

/**
 * A jet engine from its thrust (N): the exhaust velocity from T = ρ A V² (a hot jet, lighter
 * with the afterburner), its noise by Lighthill (V⁸), peaking at Strouhal 0.2 V/D; the turbine
 * whine from the spool speed (∝ √thrust). { db, gain, V, peak, cutoff, whine }.
 */
export function jetEngine({ thrust = 0, afterburner = false, nozzle = 0.8, maxThrust = 80e3 } = {}) {
  const A = Math.PI * (nozzle / 2) ** 2;
  const rho = afterburner ? 0.3 : 0.6;
  const V = Math.sqrt(Math.max(0, thrust) / (rho * A));
  const P = lighthill(V, nozzle, rho);
  const db = dbOf(P);
  const spool = Math.sqrt(clamp(thrust / maxThrust, 0, 1.6));
  return { db, gain: thrust > 0 ? gainOf(db, 150, 1.2) : 0, V, peak: clamp((0.2 * V) / nozzle, 20, 2000), cutoff: clamp((1.2 * V) / nozzle, 200, 9000), whine: 180 + 1600 * spool };
}

/** A gas or air jet out of a hole (dP Pa across it, hole area m²): the hiss / whistle. */
export function decompression({ dP = P_ATM, area = 0.01 } = {}) {
  const V = Math.min(C_AIR, Math.sqrt((2 * Math.max(0, dP)) / RHO_AIR));
  const d = Math.sqrt(Math.max(1e-6, area));
  const db = dbOf(lighthill(V, d));
  return { db, gain: gainOf(db, 120, 1.6), V, whistle: clamp((0.2 * V) / d, 200, 9000), cutoff: clamp((2 * V) / d, 400, 12000) };
}

/** Wind at speed v (m/s): the rush (dipole noise ∝ v⁶) and the Aeolian tone of twigs, wires (0.2 v/d). */
export function windNoise(v, d = 0.01) {
  const s = Math.max(0, v);
  const db = 60 * Math.log10(Math.max(0.1, s)) + 40;
  return { db, gain: s > 0.3 ? gainOf(db, 125, 0.8) : 0, tone: clamp((0.2 * s) / d, 60, 4000), cutoff: clamp(150 + 60 * s, 150, 2500) };
}

/** A beat of a wing (area m², span m, flap Hz, stroke amplitude rad): the whoosh. */
export function wingBeat({ area = 40, span = 15, flapHz = 1, amplitude = 1 } = {}) {
  const v = 2 * amplitude * flapHz * span * 0.5; // the mean speed of the wing (half span out)
  const P = 1e-5 * 0.5 * RHO_AIR * area * v ** 3;
  const db = dbOf(P);
  return { db, gain: gainOf(db, 112, 1.4), v, peak: clamp((0.2 * v) / 0.01, 80, 1500), dur: clamp(0.5 / Math.max(0.2, flapHz), 0.12, 0.9) };
}

/** Rain at mm/h: drops a second per m² and the bubble each makes (~1 mm: Minnaert). */
export function rainSound(rate, onWater = false) {
  const r = Math.max(0, rate);
  const drops = r * 30; // per m² per s (~2 mm drops)
  const db = dbOf(1e-7 * drops * 10);
  return { db, gain: r > 0 ? gainOf(db, 95, 0.8) : 0, drops, bubble: minnaert(onWater ? 0.0012 : 0.003), cutoff: onWater ? 9000 : 5000 };
}

/** A gunshot from the cartridge's muzzle energy (J): the blast (~1 % heard), the supersonic crack. */
export function gunshot({ energy = 1700, velocity = 900 } = {}) {
  const db = dbOf(0.01 * energy);
  return { db, gain: gainOf(db, 120, 2), crack: velocity > C_AIR, cutoff: clamp(1200 + energy, 1500, 6000), boom: clamp(120 - energy / 100, 50, 120) };
}

/** An explosion of E J: its level and how low it is (a bigger charge, a longer pulse, a lower boom). */
export function explosion(E) {
  const db = dbOf(0.01 * Math.max(0, E));
  return { db, gain: gainOf(db, 140, 2.4), peak: clamp(60 * (1e6 / Math.max(1, E)) ** (1 / 3), 12, 200), dur: clamp(0.8 + Math.cbrt(E / 1e6), 0.8, 6) };
}

/* ---------------- propagation ---------------- */

/** Air absorption (dB/m) at f Hz (≈ ISO 9613-1, 20 °C, 50 % humidity). */
export const airAbsorption = (f) => 1e-6 * f + 2.2e-9 * f * f;

/**
 * From a source to the listener at distance d (m): { gain (amplitude: inverse-square intensity,
 * 1 at `ref`), delay (s: the speed of sound), cutoff (Hz: above it the air has taken more than
 * 3 dB), lossDb }. o: { occluded (a wall between: −15 dB, only the lows get through), underwater
 * (the listener under water and the source in the air: −20 dB, muffled), bothUnderwater }.
 */
export function propagate(d, o = {}) {
  const ref = o.ref ?? 1;
  const r = Math.max(ref, d);
  let gain = ref / r;
  const a = 2.2e-9, b = 1e-6, c = 3 / r;
  let cutoff = clamp((-b + Math.sqrt(b * b + 4 * a * c)) / (2 * a), 200, 20000);
  let delay = r / C_AIR;
  if (o.occluded) {
    gain *= 0.18;
    cutoff = Math.min(cutoff, 350);
  }
  if (o.bothUnderwater) {
    delay = r / C_WATER;
    cutoff = Math.min(cutoff, 4000);
  } else if (o.underwater) {
    gain *= 0.1;
    cutoff = Math.min(cutoff, 450);
  }
  return { gain, delay, cutoff, lossDb: -20 * Math.log10(Math.max(1e-9, gain)) };
}

/** Level of detail by distance: 'near' (everything), 'mid' (no small pops), 'far' (rumble only), 'off'. */
export function lodFor(d, loud = 1) {
  const k = Math.sqrt(Math.max(0.01, loud));
  return d < 15 * k ? 'near' : d < 60 * k ? 'mid' : d < 300 * k ? 'far' : 'off';
}

/**
 * Merge sources ({ pos, power, ...}) into at most `max` voices for the listener at `lp`: the loudest
 * (power / d²) stay their own, the rest become one voice at their power-weighted middle with their
 * summed power (and `members`). Keeps CPU bounded with any number of fires.
 */
export function aggregate(sources, lp, max = 3) {
  const s = sources
    .map((x) => ({ ...x, heard: x.power / Math.max(1, (x.pos[0] - lp[0]) ** 2 + (x.pos[1] - lp[1]) ** 2 + (x.pos[2] - lp[2]) ** 2) }))
    .sort((a, b) => b.heard - a.heard);
  if (s.length <= max) return s.map((x) => ({ ...x, members: 1 }));
  const keep = s.slice(0, max - 1).map((x) => ({ ...x, members: 1 }));
  const rest = s.slice(max - 1);
  const P = rest.reduce((a, x) => a + x.power, 0) || 1e-9;
  const pos = [0, 1, 2].map((c) => rest.reduce((a, x) => a + x.pos[c] * x.power, 0) / P);
  const merged = { ...rest[0], pos, power: P, members: rest.length, heard: rest.reduce((a, x) => a + x.heard, 0) };
  for (const k of ['hrr', 'count', 'steam', 'ticks']) if (rest[0][k] !== undefined) merged[k] = rest.reduce((a, x) => a + (x[k] ?? 0), 0);
  return [...keep, merged];
}
