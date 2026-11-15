/**
 * The cars heard (Web Audio; the parameters: audio/carSound.js carSoundParams / carSfxSound, from
 * each car's physical state). A voice per car, at most MAX_CAR_VOICES (the loudest at the
 * listener; the rest fade out), each:
 *
 *   engine: a pulse train at the firing frequency through a low-pass (opening with the load), the
 *           crank's order under it (the exhaust's rumble, a sine), the intake's hiss (band-passed
 *           noise), a diesel's rattle, the starter's whine while it cranks
 *   tyres:  their roll (band-passed noise at the speed's pitch), the squeal (a sine with a little
 *           wobble, and a narrow band of noise), the scrub off the road
 *   wind:   low-passed noise rising with the speed;  brakes: a thin squeal;  horn: two tones
 *   to you: a panner for the direction (its level set here), the air's low-pass, the distance's
 *           gain; every frequency times the Doppler factor, the noises' playback rate too.
 * One-shots (c.sfx: shifts, the key, stalls, crashes, a man struck, a landing) through the
 * SoundScape's place() / noiseTo().
 *
 * Needs a running SoundScape (audio/sound.js: its context, its noise buffer, its master).
 */
import { carSoundParams, carSfxSound } from './carSound.js';

export const MAX_CAR_VOICES = 4;

export class CarVoices {
  constructor(scape) {
    this.s = scape;
    this.voices = new Map(); // car → voice
    this.seen = new WeakMap(); // car → the last c.sfx event heard
    this.pulse = null;
  }

  pulseWave() {
    if (this.pulse) return this.pulse;
    const N = 32;
    const re = new Float32Array(N + 1);
    const im = new Float32Array(N + 1);
    for (let n = 1; n <= N; n++) re[n] = Math.exp(-n / 8) * (n % 2 ? 1 : 0.7); // (a firing: a sharp pulse, odd orders a little stronger)
    this.pulse = this.s.ctx.createPeriodicWave(re, im);
    return this.pulse;
  }

  make() {
    const ctx = this.s.ctx;
    const gain = (v = 0) => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };
    const noise = (filters) => {
      const src = ctx.createBufferSource();
      src.buffer = this.s.noise;
      src.loop = true;
      src.loopStart = Math.random();
      let node = src;
      const fs = filters.map(([type, f, Q]) => {
        const b = ctx.createBiquadFilter();
        b.type = type;
        b.frequency.value = f;
        b.Q.value = Q;
        node.connect(b);
        node = b;
        return b;
      });
      src.start();
      return { src, out: node, f: fs };
    };
    const osc = (type, f) => {
      const o = ctx.createOscillator();
      if (type === 'pulse') o.setPeriodicWave(this.pulseWave());
      else o.type = type;
      o.frequency.value = f;
      o.start();
      return o;
    };
    const V = {};
    V.pan = ctx.createPanner();
    V.pan.panningModel = 'HRTF';
    V.pan.distanceModel = 'linear';
    V.pan.rolloffFactor = 0;
    V.air = ctx.createBiquadFilter();
    V.air.type = 'lowpass';
    V.air.frequency.value = 12000;
    V.level = gain(0);
    V.mix = gain(1);
    V.mix.connect(V.level).connect(V.air).connect(V.pan).connect(this.s.master);
    // the engine
    V.fire = osc('pulse', 27);
    V.fireLp = ctx.createBiquadFilter();
    V.fireLp.type = 'lowpass';
    V.fireLp.frequency.value = 400;
    V.fireLp.Q.value = 1.4;
    V.engineG = gain(0);
    V.fire.connect(V.fireLp).connect(V.engineG).connect(V.mix);
    V.crank = osc('sine', 13);
    V.rumbleG = gain(0);
    V.crank.connect(V.rumbleG).connect(V.mix);
    V.intake = noise([['bandpass', 1800, 0.8]]);
    V.intakeG = gain(0);
    V.intake.out.connect(V.intakeG).connect(V.mix);
    V.rattle = noise([['bandpass', 2600, 6]]);
    V.rattleAM = gain(0.5);
    V.rattleDepth = gain(0.5);
    V.fire.connect(V.rattleDepth).connect(V.rattleAM.gain);
    V.rattleG = gain(0);
    V.rattle.out.connect(V.rattleAM).connect(V.rattleG).connect(V.mix);
    V.starter = osc('sawtooth', 150);
    V.starterLp = ctx.createBiquadFilter();
    V.starterLp.type = 'bandpass';
    V.starterLp.frequency.value = 900;
    V.starterG = gain(0);
    V.starter.connect(V.starterLp).connect(V.starterG).connect(V.mix);
    // the tyres
    V.roll = noise([['bandpass', 800, 0.6]]);
    V.rollG = gain(0);
    V.roll.out.connect(V.rollG).connect(V.mix);
    V.squeal = osc('sine', 1100);
    V.wob = osc('sine', 7);
    V.wobDepth = gain(25);
    V.wob.connect(V.wobDepth).connect(V.squeal.frequency);
    V.squealN = noise([['bandpass', 1100, 14]]);
    V.squealG = gain(0);
    V.squeal.connect(V.squealG);
    V.squealN.out.connect(V.squealG);
    V.squealG.connect(V.mix);
    V.scrub = noise([['lowpass', 900, 0.6]]);
    V.scrubG = gain(0);
    V.scrub.out.connect(V.scrubG).connect(V.mix);
    // the wind, the brakes, the horn
    V.wind = noise([['bandpass', 500, 0.5]]);
    V.windG = gain(0);
    V.wind.out.connect(V.windG).connect(V.mix);
    V.brake = osc('sine', 2900);
    V.brakeG = gain(0);
    V.brake.connect(V.brakeG).connect(V.mix);
    V.hornA = osc('square', 420);
    V.hornB = osc('square', 500);
    V.hornLp = ctx.createBiquadFilter();
    V.hornLp.type = 'lowpass';
    V.hornLp.frequency.value = 2400;
    V.hornG = gain(0);
    V.hornA.connect(V.hornLp);
    V.hornB.connect(V.hornLp);
    V.hornLp.connect(V.hornG).connect(V.mix);
    V.oscs = [V.fire, V.crank, V.starter, V.squeal, V.wob, V.brake, V.hornA, V.hornB];
    V.noises = [V.intake, V.rattle, V.roll, V.squealN, V.scrub, V.wind];
    return V;
  }

  /** Every car (sim/cars.js world.cars) heard by listener { pos, vel, occluded?, underwater? }; their one-shots played. */
  update(cars, listener) {
    const s = this.s;
    if (!s.running) return;
    const t = s.ctx.currentTime;
    const all = (cars ?? []).filter((c) => c?.spec && (c.running || c.crank > 0 || Math.hypot(c.vx, c.vz) > 0.2 || c.horn || c.sfx?.length)).map((c) => ({ c, P: carSoundParams(c, listener) }));
    all.sort((a, b) => b.P.heard - a.P.heard);
    const keep = new Set(all.slice(0, MAX_CAR_VOICES).filter((x) => x.P.heard > 1e-4).map((x) => x.c));
    for (const [c, V] of this.voices) {
      if (keep.has(c)) continue;
      V.level.gain.setTargetAtTime(0, t, 0.3);
      V.fadeT ??= t;
      if (t - V.fadeT > 2) this.drop(c);
    }
    for (const { c, P } of all) {
      if (keep.has(c)) {
        let V = this.voices.get(c);
        if (!V) this.voices.set(c, (V = this.make()));
        V.fadeT = null;
        this.set(V, P, t);
      }
      this.oneShots(c, P);
    }
  }

  set(V, P, t) {
    const at = (param, v, tau = 0.06) => param.setTargetAtTime(Number.isFinite(v) ? v : 0, t, tau);
    const p = P.src;
    if (V.pan.positionX) {
      at(V.pan.positionX, p[0], 0.05);
      at(V.pan.positionY, p[1], 0.05);
      at(V.pan.positionZ, p[2], 0.05);
    } else V.pan.setPosition(p[0], p[1], p[2]);
    at(V.level.gain, Math.min(2, P.level) * 0.6, 0.1);
    at(V.air.frequency, P.cutoff, 0.2);
    const E = P.engine;
    at(V.fire.frequency, Math.max(2, E.fire), 0.03);
    at(V.fireLp.frequency, Math.min(9000, E.cutoff), 0.06);
    at(V.engineG.gain, E.gain * 0.6, E.on ? 0.05 : 0.35);
    at(V.crank.frequency, Math.max(2, E.crank), 0.03);
    at(V.rumbleG.gain, E.rumble * 0.5, 0.08);
    at(V.intakeG.gain, E.intake * 0.25);
    at(V.rattleG.gain, E.rattle * 0.4);
    at(V.rattleDepth.gain, 0.5);
    at(V.starter.frequency, E.starterHz, 0.05);
    at(V.starterG.gain, E.starter * 0.25, 0.03);
    at(V.rollG.gain, P.roll * 0.45);
    at(V.roll.f[0].frequency, P.rollHz);
    at(V.squeal.frequency, P.squealHz, 0.05);
    at(V.squealN.f[0].frequency, P.squealHz, 0.05);
    at(V.squealG.gain, P.squeal * 0.18, 0.04);
    at(V.scrubG.gain, P.scrub * 0.4);
    at(V.windG.gain, P.wind * 0.4);
    at(V.wind.f[0].frequency, P.windHz);
    at(V.brake.frequency, P.brakeHz);
    at(V.brakeG.gain, P.brake * 0.08);
    at(V.hornA.frequency, P.hornHz[0], 0.02);
    at(V.hornB.frequency, P.hornHz[1], 0.02);
    at(V.hornG.gain, P.horn * 0.12, 0.02);
    for (const n of V.noises) at(n.src.playbackRate, P.doppler, 0.1);
  }

  /** Its new c.sfx events (since last heard), each played where it happened. */
  oneShots(c, P) {
    const q = c.sfx;
    if (!q?.length) return;
    const last = this.seen.get(c) ?? q[q.length - 1].n - 1; // (a car heard first: only from now on)
    this.seen.set(c, q[q.length - 1].n);
    if (P.dist > 250) return;
    for (const e of q) {
      if (e.n <= last) continue;
      const S = carSfxSound(e);
      if (!S) continue;
      const pos = e.p ?? P.src;
      const dur = Math.max(...S.layers.map((l) => l.delay + l.dur));
      const pl = this.s.place(pos, S.gain, dur, { ref: 3 });
      if (!pl) continue;
      for (const l of S.layers) this.s.noiseTo(pl.out, pl.t0 + l.delay, l.dur, l.type, l.freq * P.doppler, l.Q, (l.gain / Math.max(1e-3, S.gain)) * pl.gain);
    }
  }

  drop(c) {
    const V = this.voices.get(c);
    if (!V) return;
    this.voices.delete(c);
    const t = this.s.ctx.currentTime;
    for (const o of V.oscs) o.stop(t + 0.1);
    for (const n of V.noises) n.src.stop(t + 0.1);
    setTimeout(() => V.pan.disconnect(), 300);
  }

  clear() {
    for (const c of [...this.voices.keys()]) this.drop(c);
  }
}
