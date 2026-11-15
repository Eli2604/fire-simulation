/**
 * A car's sound from its physical state (no Web Audio here: pure numbers, tested in Node;
 * audio/carVoices.js synthesises them). Every car of the world (sim/cars.js: yours, an AI's, one
 * just idling) is heard the same way:
 *
 *  - the engine: its firing frequency from its speed and cylinders, rpm / 60 × cylinders / 2 (a
 *    four-stroke fires each cylinder every other turn: a four at 800 rpm idle ~27 Hz, at 6000
 *    ~200 Hz); the crank's own order (rpm / 60) under it, the exhaust's rumble; its level from the
 *    power it gives (throttle and revs: the load), brighter (the exhaust's low-pass opens) with
 *    load; the intake's hiss with the throttle; a diesel rattles (a narrow band of noise at its
 *    firing rate's harmonics). Gear shifts are heard in the revs (they fall on an upshift, flare
 *    on a downshift) and a clunk (c.sfx 'shift'); the starter's whine (c.crank), the stall.
 *  - the tyres: rolling, a broadband roar ∝ v^1.6 (louder and coarser off the road: gravel and
 *    soil crunch), their squeal from the slip (c.skid: on a hard surface a tone ~0.9-1.4 kHz
 *    rising with the slip; on soil a scrub of noise); a brake's squeal at walking pace. Wheels
 *    spinning in mud, sand, snow (c.ground.spin: sim/groundContact.js) churn: the scrub, louder
 *    with the spin (spin: its share, 0..1), over the engine racing.
 *  - the wind over the body ∝ v^2.5, its hiss rising with the speed.
 *  - the horn (c.horn): two tones a third apart (~420 / 500 Hz, a car's twin horn).
 *  - crashes: sim/impact.js's events (the two bodies struck: audio/sound.js impact); this adds the
 *    body's crunch and the glass (c.sfx 'crash'), a man struck ('thud'), a landing ('land').
 *  - to the listener: inverse-square spreading and the air's absorption (audio/physics.js
 *    propagate), the Doppler shift from the two velocities along the line between them.
 */
import { C_AIR, gainOf, propagate } from './physics.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** The Doppler factor for a source moving at vs, a listener at vl, u the unit vector from source to listener. */
export function carDoppler(vs, vl, u, c = C_AIR) {
  const s = (vs?.[0] ?? 0) * u[0] + (vs?.[1] ?? 0) * u[1] + (vs?.[2] ?? 0) * u[2];
  const l = (vl?.[0] ?? 0) * u[0] + (vl?.[1] ?? 0) * u[1] + (vl?.[2] ?? 0) * u[2];
  return clamp((c - l) / Math.max(c * 0.2, c - s), 0.5, 2);
}

/** Firing frequency (Hz) of a four-stroke (or two-stroke) of `cyl` cylinders at rpm. */
export const firingHz = (rpm, cyl = 4, strokes = 4) => (rpm / 60) * (strokes === 2 ? cyl : cyl / 2);

/** The engine heard at the source (see the top): { on, rpm, fire, crank, gain, cutoff, rumble, intake, rattle, starter }. */
export function engineSound(c) {
  const E = c.spec.engine;
  const cranking = (c.crank ?? 0) > 0;
  const on = !!c.running || cranking;
  const rpm = c.rpm ?? 0;
  const n = clamp(rpm / E.redline, 0, 1.15);
  const load = clamp(c.loadK ?? 0, 0, 1);
  const thr = clamp(c.thr ?? c.input?.throttle ?? 0, 0, 1);
  // its power out as a share of the most it has (the level follows it, a floor for the idle)
  const pw = c.running ? clamp(0.05 + n * (0.25 + 0.75 * load), 0.04, 1.2) : cranking ? 0.03 : 0;
  const size = (E.tmax * E.redline) / (212 * 6400); // (a bigger engine: louder)
  const db = on ? 112 + 10 * Math.log10(pw) + 10 * Math.log10(Math.max(0.2, size)) : 0;
  const gain = on ? gainOf(db, 108, 1.6) : 0;
  return {
    on, running: !!c.running, rpm, load, thr,
    fire: firingHz(rpm, E.cyl, E.strokes),
    crank: rpm / 60,
    gain,
    cutoff: on ? 220 + 2600 * n * (0.35 + 0.65 * load) : 200,
    rumble: on ? gain * (0.35 + 0.4 * load) : 0,
    intake: c.running ? clamp(thr * n * 0.5, 0, 0.6) : 0,
    rattle: c.running && E.kind === 'diesel' ? clamp(0.12 + 0.25 * load, 0, 0.4) * gain : 0,
    starter: cranking ? 0.35 : 0,
    starterHz: 140 + 40 * Math.sin(c.t * 9),
  };
}

/**
 * Car c (sim/cars.js) heard by a listener { pos, vel, occluded?, underwater? } (no pos: heard at
 * 10 m, no shift). Frequencies Doppler-shifted (the *0 ones not), gains at the source (~0..1.5),
 * level and cutoff from audio/physics.js propagate; heard: the loudest part at the listener.
 */
export function carSoundParams(c, listener = {}) {
  const v = Math.hypot(c.vx ?? 0, c.vz ?? 0);
  const engine = engineSound(c);
  const gi = c.groundInfo ?? { road: true };
  const rough = gi.road ? 1 : 1.35;
  const onGround = !c.air;
  const roll = onGround ? clamp((v / 25) ** 1.6 * 0.8 * rough, 0, 1.3) : 0;
  const rollHz0 = (gi.road ? 650 : 420) + 22 * v;
  const skid = clamp(c.skid ?? 0, 0, 1.5);
  const squeal = gi.road && onGround ? clamp(skid * 0.9, 0, 1.2) : 0;
  const squealHz0 = 950 + 380 * clamp(skid, 0, 1) + 4 * v;
  // wheelspin in soft stuff (sim/groundContact.js c.ground.spin, m/s of slip): it churns
  const spin = onGround && !gi.road ? clamp((c.ground?.spin ?? 0) / 8, 0, 1) : 0;
  const scrub = onGround ? clamp(Math.max(skid * (gi.road ? 0.25 : 0.9), spin * 0.85), 0, 1) : 0;
  const wind = clamp((v / 38) ** 2.5, 0, 1);
  const windHz0 = 300 + 18 * v;
  const brake = c.brakeOn > 0.3 && v > 0.3 && v < 4 ? clamp(c.brakeOn * (1 - v / 4), 0, 1) * 0.25 : 0;
  const horn = c.horn ? 1 : 0;
  // from the middle of the car, a little up
  const src = [c.x, (c.y ?? 0) + 0.6, c.z];
  const lp = listener.pos;
  const dv = lp ? [lp[0] - src[0], lp[1] - src[1], lp[2] - src[2]] : [10, 0, 0];
  const dist = Math.hypot(dv[0], dv[1], dv[2]);
  const u = dist > 1e-6 ? dv.map((x) => x / dist) : [1, 0, 0];
  const dop = lp ? carDoppler([c.vx ?? 0, c.vy ?? 0, c.vz ?? 0], listener.vel, u) : 1;
  const pr = propagate(dist, { ref: 3, occluded: !!listener.occluded, underwater: !!listener.underwater });
  const loudest = Math.max(engine.gain, roll, squeal, scrub, wind, brake, horn * 1.2, engine.starter);
  return {
    speed: v, src, label: c.label,
    engine: { ...engine, fire0: engine.fire, fire: engine.fire * dop, crank0: engine.crank, crank: engine.crank * dop, starterHz: engine.starterHz * dop },
    roll, rollHz: rollHz0 * dop, rollHz0, rough,
    squeal, squealHz: squealHz0 * dop, squealHz0, scrub, spin,
    wind, windHz: windHz0 * dop,
    brake, brakeHz: 2900 * dop,
    horn, hornHz: [420 * dop, 500 * dop],
    dist, doppler: dop, level: pr.gain, cutoff: pr.cutoff, delay: pr.delay,
    heard: loudest * pr.gain,
  };
}

/**
 * A one-shot of a car's (a c.sfx event: sim/carPhysics.js, sim/cars.js) as layers of shaped noise
 * [{ delay, dur, type, freq, Q, gain }] (gains at 3 m). The blows themselves are sim/impact.js's
 * events (heard by audio/sound.js): this is what the car adds to them.
 */
export function carSfxSound(e) {
  const L = [];
  const n = (delay, dur, type, freq, Q, gain) => L.push({ delay, dur, type, freq, Q, gain });
  switch (e.kind) {
    case 'shift': {
      // the box: a clunk, softer going up
      const g = e.up ? 0.12 : 0.18;
      n(0, 0.05, 'bandpass', 380, 3, g);
      n(0.01, 0.08, 'lowpass', 160, 0.8, g * 0.8);
      return { kind: 'shift', gain: g, layers: L };
    }
    case 'start': {
      // the key: the solenoid's click, then the starter (its whine is the voice's)
      n(0, 0.03, 'bandpass', 2200, 4, 0.2);
      return { kind: 'start', gain: 0.2, layers: L };
    }
    case 'crankFail': {
      for (let i = 0; i < 3; i++) n(i * 0.18, 0.03, 'bandpass', 2000, 5, 0.18);
      return { kind: 'crankFail', gain: 0.18, layers: L };
    }
    case 'stall': {
      for (let i = 0; i < 4; i++) n(0.06 * i * (1 + 0.4 * i), 0.06, 'lowpass', 220, 0.8, 0.35 * (1 - i / 5));
      return { kind: 'stall', gain: 0.35, layers: L };
    }
    case 'crash': {
      const v = Math.max(0, e.v ?? 5);
      const g = clamp(0.25 + v / 12, 0.25, 1.6);
      n(0, 0.25 + v * 0.02, 'bandpass', 1300, 0.7, 0.8 * g); // (sheet metal crumpling)
      n(0.03, 0.4, 'lowpass', 300, 0.7, 0.6 * g); // (the body's thump)
      if (v > 6) for (let i = 0; i < 5; i++) n(0.05 + i * 0.05, 0.12, 'highpass', 4500 + 700 * i, 0.9, 0.25 * g); // (glass)
      return { kind: 'crash', gain: g, layers: L };
    }
    case 'thud': {
      const v = Math.max(0, e.v ?? 3);
      const g = clamp(0.3 + v / 15, 0.3, 1.2);
      n(0, 0.12, 'lowpass', 180, 0.8, g);
      return { kind: 'thud', gain: g, layers: L };
    }
    case 'land': {
      const v = Math.max(0, e.v ?? 3);
      const g = clamp(0.2 + v / 10, 0.2, 1.4);
      n(0, 0.18, 'lowpass', 140, 0.8, g); // (the springs bottoming)
      n(0.01, 0.1, 'bandpass', 900, 1.2, 0.4 * g); // (the body's rattle)
      return { kind: 'land', gain: g, layers: L };
    }
  }
  return null;
}
