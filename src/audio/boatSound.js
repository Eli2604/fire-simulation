/**
 * A boat's sound from its physical state (no Web Audio here: pure numbers, tested in Node;
 * audio/boatVoices.js synthesises them). Every boat afloat (sim/boats.js: rowing boats, outboard
 * dinghies, sailing dinghies, canoes), yours or anyone's, is heard the same way:
 *
 *  - the outboard (f.motor): its firing frequency from its speed, rpm / 60 × cylinders / 2 for a
 *    four-stroke (× cylinders for a two-stroke): ~16 Hz at a twin's 950 rpm idle, ~90 Hz flat out;
 *    its level from the power it gives (throttle × speed × the prop's load: dB re 1 pW, ~100 at
 *    idle, ~118 flat out for 7.5 kW), brighter with load; the gears' whine; cavitation (a hiss of
 *    collapsing bubbles, M.cav), racing when the prop leaves the water (to the limiter, its note
 *    hard and bright); the cord's rasp and the first firings when it is started, a sputter when
 *    it stalls (f.sfx 'start' / 'stall').
 *  - the water: the bow wave and the wake hiss with the speed through the water (their power
 *    ∝ v³: the gain ∝ v^1.5, brighter faster); the prop's wash with its thrust; the bow slapping
 *    down onto a wave (f.sfx 'slap': its closing speed v, the energy ½·m·v² of the bow's share of
 *    the boat); water aboard sloshing as it rolls and pitches; grinding on the bottom.
 *  - oars and paddles: each blade's catch (a plunge, the rowlock's knock) and release (a splash,
 *    drips, the rowlock's creak), harder the harder the stroke (f.sfx 'catch' / 'release': k).
 *  - the mooring line creaking under its tension; a round through the planking (f.sfx 'hit').
 *  - the sail (f.sailState): luffing it flogs (a flutter at ~1 + 0.6·U Hz, loud with the apparent
 *    wind U²), drawing it rushes; the shrouds' Aeolian hum at f = 0.2·U / d (d = 4 mm: Strouhal);
 *    the boom slamming across in a gybe (f.sfx 'gybe').
 *  - to the listener: inverse-square spreading and the air's absorption of the highs (audio/
 *    physics.js propagate), the Doppler shift from the two velocities along the line between.
 */
import { C_AIR, dbOf, gainOf, propagate } from './physics.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** The Doppler factor for a source moving at vs, a listener at vl, u the unit vector from source to listener. */
export function boatDoppler(vs, vl, u, c = C_AIR) {
  const s = (vs?.[0] ?? 0) * u[0] + (vs?.[1] ?? 0) * u[1] + (vs?.[2] ?? 0) * u[2];
  const l = (vl?.[0] ?? 0) * u[0] + (vl?.[1] ?? 0) * u[1] + (vl?.[2] ?? 0) * u[2];
  return clamp((c - l) / Math.max(c * 0.2, c - s), 0.5, 2);
}

/** The outboard's firing frequency (Hz): rpm / 60 × cylinders / 2 (four-stroke) or × cylinders (two-stroke). */
export function firingHz(rpm, cyl = 2, strokes = 4) {
  return (rpm / 60) * (strokes === 2 ? cyl : cyl / 2);
}

/** The outboard heard (its parameters at the source): see the top. */
export function motorSound(M) {
  if (!M) return null;
  const cranking = M.cranking > 0;
  const on = M.running || cranking;
  const rpm = M.rpm ?? 0;
  const fire = firingHz(rpm, M.cyl, M.strokes);
  const thr = Math.abs(M.throttle ?? 0);
  // the power it gives: idle a few %, flat out in the water all of it
  const pw = on ? clamp((0.07 + thr) * (M.n ?? 0) * (0.35 + 0.65 * (M.load ?? 0)) + (M.racing ? 0.4 : 0), 0.02, 1.3) : 0;
  const db = on ? 117 + 10 * Math.log10(pw) + 10 * Math.log10((M.power ?? 7.5) / 7.5) : 0;
  const gain = on ? gainOf(db, 112, 1.6) * (cranking && !M.running ? 0.5 : 1) : 0;
  // its exhaust leaves through the prop hub: deep, the water muffles it; out of the water, open and harsh
  const open = 1 - clamp(M.imm ?? 1, 0, 1);
  const cutoff = on ? 250 + 2400 * (M.n ?? 0) * (0.45 + 0.55 * (M.load ?? 0)) * (1 + 1.2 * open) : 200;
  return {
    on, cranking, running: !!M.running, rpm, fire, db, gain, cutoff,
    // the gears (a 13-tooth pinion), the cavitation's hiss, racing
    whineHz: (rpm / 60) * 13, whine: on ? 0.06 * (M.n ?? 0) * (0.3 + (M.load ?? 0)) : 0,
    cav: on ? clamp(M.cav ?? 0, 0, 1) * (0.25 + 0.75 * (M.n ?? 0)) : 0,
    racing: !!M.racing,
  };
}

/** The sail heard: { flap, flapHz, rush, humHz, hum } (see the top). */
export function sailSound(S, d = 0.004) {
  if (!S) return null;
  const U = S.U ?? 0;
  const flog = clamp((S.luff ?? 0) * (U / 6) ** 2, 0, 1.3);
  return {
    U,
    flap: flog,
    flapHz: 1 + 0.6 * U,
    rush: clamp((S.fill ?? 0) * (U / 9) ** 2, 0, 0.7),
    humHz: (0.2 * U) / d,
    hum: U > 4 ? clamp((U - 4) / 12, 0, 0.35) : 0,
  };
}

/**
 * Boat f (sim/boats.js) heard by a listener { pos, vel, occluded, underwater } (no pos: heard at
 * 10 m, no shift). Frequencies Doppler-shifted (the *0 ones not), gains at the source (~0..1.5),
 * level and cutoff from audio/physics.js propagate; heard: the loudest part at the listener.
 */
export function boatSoundParams(f, listener = {}) {
  const b = f.body;
  const A = f.acoustic ?? {};
  const kind = f.kind ?? 'row';
  const v = Math.abs(A.through ?? 0);
  const motor = motorSound(f.motor);
  const sail = sailSound(f.sailState);
  // the water along the hull: its power ∝ v³
  const hiss = clamp((v / 4) ** 1.5 * 0.9, 0, 1.2);
  const hissHz0 = 900 + 500 * v;
  const wash = f.motor ? clamp(Math.abs(f.motor.thrust ?? 0) / (130 * (f.motor.power ?? 7.5)), 0, 1) * 0.6 * clamp(f.motor.imm ?? 1, 0, 1) : 0;
  const motion = Math.abs(b.wr ?? 0) + Math.abs(b.wp ?? 0) + Math.abs(b.vy ?? 0);
  const slosh = clamp((b.water ?? 0) * 4, 0, 1) * clamp(motion * 2, 0, 1);
  const tension = f.mooring?.tension ?? 0;
  const creak = clamp(tension / 600, 0, 1);
  const scrape = clamp((A.ground ?? 0) / 0.8, 0, 1);
  // to the listener: from amidships, a little over the water
  const src = b.pose ? [b.pose.p[0], b.pose.p[1] + 0.4, b.pose.p[2]] : [b.X, b.Y, b.Z];
  const lp = listener.pos;
  const dv = lp ? [lp[0] - src[0], lp[1] - src[1], lp[2] - src[2]] : [10, 0, 0];
  const dist = Math.hypot(dv[0], dv[1], dv[2]);
  const u = dist > 1e-6 ? dv.map((x) => x / dist) : [1, 0, 0];
  const dop = lp ? boatDoppler([b.vx ?? 0, b.vy ?? 0, b.vz ?? 0], listener.vel, u) : 1;
  const pr = propagate(dist, { ref: 3, occluded: !!listener.occluded, underwater: !!listener.underwater });
  const loudest = Math.max(motor?.gain ?? 0, hiss, wash, slosh, creak, scrape, sail ? Math.max(sail.flap, sail.rush, sail.hum) : 0);
  return {
    kind, speed: v, src,
    motor: motor && { ...motor, fire0: motor.fire, fire: motor.fire * dop, whineHz: motor.whineHz * dop },
    hiss, hissHz: hissHz0 * dop, hissHz0, wash,
    slosh, creak, creakHz: (480 + 0.25 * Math.min(tension, 2000)) * dop, scrape,
    sail: sail && { ...sail, humHz0: sail.humHz, humHz: sail.humHz * dop, flapHz: sail.flapHz },
    dist, doppler: dop, level: pr.gain, cutoff: pr.cutoff, delay: pr.delay,
    heard: loudest * pr.gain,
  };
}

/**
 * A one-shot of a boat's (an f.sfx event: see sim/boats.js) as layers of shaped noise
 * [{ delay, dur, type, freq, Q, gain }] (gains at 3 m), or an impact (sim/impact.js fields) for
 * a round through the hull. m: the boat's mass (kg).
 */
export function boatSfxSound(e, m = 200) {
  const L = [];
  const n = (delay, dur, type, freq, Q, gain) => L.push({ delay, dur, type, freq, Q, gain });
  switch (e.kind) {
    case 'slap': {
      // the bow coming down on the water: its share of the boat, at the closing speed
      const v = Math.max(0, e.v ?? 0);
      const E = 0.5 * (0.25 * m) * v * v;
      const g = gainOf(dbOf(E * 0.02), 115, 1.8);
      n(0, 0.1 + 0.05 * v, 'lowpass', 160 + 70 * v, 0.8, g);
      n(0.02, 0.25 + 0.1 * v, 'bandpass', 1800 + 400 * v, 0.6, 0.5 * g);
      return { kind: 'slap', energy: E, gain: g, layers: L };
    }
    case 'catch': {
      const k = clamp(e.v ?? 0.5, 0.1, 1);
      n(0, 0.06, 'bandpass', 420, 4, 0.18 * k); // (the rowlock's knock)
      n(0.01, 0.18, 'bandpass', 900, 0.9, 0.35 * k); // (the plunge)
      return { kind: 'catch', gain: 0.35 * k, layers: L };
    }
    case 'release': {
      const k = clamp(e.v ?? 0.5, 0.1, 1);
      n(0, 0.22, 'highpass', 1800, 0.7, 0.25 * k); // (the splash off the blade)
      n(0.05, 0.12, 'bandpass', 680, 11, 0.12 * k); // (the rowlock's creak)
      for (let i = 0; i < 3; i++) n(0.25 + 0.17 * i, 0.04, 'bandpass', 2600 + 500 * i, 6, 0.06 * k); // (drips)
      return { kind: 'release', gain: 0.25 * k, layers: L };
    }
    case 'gybe': {
      const U = Math.max(0, e.v ?? 4);
      const g = clamp(0.3 + U / 10, 0.3, 1.4);
      n(0, 0.08, 'bandpass', 320, 1.5, g); // (the boom and the sheet snatching up)
      n(0.02, 0.35, 'lowpass', 600, 0.7, 0.5 * g); // (the sail filling with a crack)
      return { kind: 'gybe', gain: g, layers: L };
    }
    case 'start': {
      // the cord pulled (its rasp, ~0.4 s), the first firings
      for (let i = 0; i < 3; i++) n(i * 0.13, 0.1, 'bandpass', 1100 + 150 * i, 1.2, 0.25);
      n(0.45, 0.4, 'lowpass', 220, 0.8, 0.4);
      return { kind: 'start', gain: 0.4, layers: L };
    }
    case 'stall': {
      // a sputter: a few last firings, further apart, weaker
      for (let i = 0; i < 5; i++) n(0.07 * i * (1 + i * 0.3), 0.05, 'lowpass', 300, 0.8, 0.4 * (1 - i / 6));
      return { kind: 'stall', gain: 0.4, layers: L };
    }
    case 'hit':
      // a round through the planking: the impact (audio/sound.js impact), wood or metal
      return { kind: 'hit', impact: { energy: 1500, materials: ['steel', e.material === 'aluminium' ? 'aluminium' : 'wood'], mass: 0.01, speed: 800, size: 1.5, sizeA: 0.02, radius: 0.004 } };
  }
  return null;
}
