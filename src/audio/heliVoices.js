/**
 * The helicopters heard (Web Audio; the parameters: audio/heliSound.js heliSoundParams, from each
 * one's physical state). A voice per helicopter, at most MAX_HELI_VOICES (the loudest at the
 * listener; the rest fade out), each:
 *
 *   rotor:   a pulse train at the blade passage frequency (a periodic wave of narrow pulses) through
 *            a low-pass (more harmonics with more load and slap): the thud; turbulence noise
 *            amplitude-modulated by the same pulses (the swish of each blade going by)
 *   slap:    band-passed noise gated hard by the pulses (the crack of each blade meeting a vortex)
 *   tail:    a sawtooth at the tail rotor's blade passage (its buzz) and its swish
 *   turbine: the whine (two sines at the compressor's frequency and an inharmonic partial), the
 *            exhaust's rush; noise grit for a damaged engine. Its gain and pitch follow with the
 *            spool's lag (~1.5 s): a dead engine winds down rather than stopping.
 *   imbalance: a sine at the rotor's rev rate on the voice's gain (a blade hit: the 1/rev beat)
 *   to you: a panner for the direction (its level is set here), the air's low-pass, the
 *            distance's gain; every frequency times the Doppler factor, the noise's playback rate too.
 *
 * Needs a running SoundScape (audio/sound.js: its context, its noise buffer, its master).
 */
import { heliSoundParams } from './heliSound.js';

export const MAX_HELI_VOICES = 3;

export class HeliVoices {
  constructor(scape) {
    this.s = scape;
    this.voices = new Map(); // helicopter → voice
    this.pulse = null;
  }

  /** A periodic wave of narrow pulses (an impulse train, its harmonics tapered): the rotor's thud. */
  pulseWave() {
    if (this.pulse) return this.pulse;
    const N = 32;
    const re = new Float32Array(N + 1);
    const im = new Float32Array(N + 1);
    for (let n = 1; n <= N; n++) re[n] = Math.exp(-n / 10); // (a pulse ~1/6 of the period wide)
    this.pulse = this.s.ctx.createPeriodicWave(re, im);
    return this.pulse;
  }

  make() {
    const ctx = this.s.ctx;
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
    const gain = (v = 0) => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };
    const osc = (type, f) => {
      const o = ctx.createOscillator();
      if (type === 'pulse') o.setPeriodicWave(this.pulseWave());
      else o.type = type;
      o.frequency.value = f;
      o.start();
      return o;
    };
    const V = { gainNow: 0 };
    // to the listener: panner (direction only) → air low-pass → distance gain → master
    V.pan = ctx.createPanner();
    V.pan.panningModel = 'HRTF';
    V.pan.distanceModel = 'linear';
    V.pan.rolloffFactor = 0;
    V.air = ctx.createBiquadFilter();
    V.air.type = 'lowpass';
    V.air.frequency.value = 12000;
    V.air.Q.value = 0.5;
    V.level = gain(0);
    V.mix = gain(1);
    V.mix.connect(V.level).connect(V.air).connect(V.pan).connect(this.s.master);
    // the rotor's pulse train (also the modulator of the swish and the slap)
    V.pulse = osc('pulse', 17);
    V.thumpLp = ctx.createBiquadFilter();
    V.thumpLp.type = 'lowpass';
    V.thumpLp.frequency.value = 120;
    V.thumpLp.Q.value = 0.7;
    V.rotorG = gain(0);
    V.pulse.connect(V.thumpLp).connect(V.rotorG).connect(V.mix);
    // the swish: turbulence through the blades, swelling with each passage
    V.swish = noise([['bandpass', 300, 0.6]]);
    V.swishAM = gain(0.5);
    V.swishDepth = gain(0.45);
    V.pulse.connect(V.swishDepth).connect(V.swishAM.gain);
    V.swishG = gain(0);
    V.swish.out.connect(V.swishAM).connect(V.swishG).connect(V.mix);
    // the slap: the crack at each blade passage
    V.slap = noise([['bandpass', 900, 1.1]]);
    V.slapAM = gain(0.05);
    V.slapDepth = gain(1);
    V.pulse.connect(V.slapDepth).connect(V.slapAM.gain);
    V.slapG = gain(0);
    V.slap.out.connect(V.slapAM).connect(V.slapG).connect(V.mix);
    // the tail rotor's buzz
    V.tail = osc('sawtooth', 80);
    V.tailLp = ctx.createBiquadFilter();
    V.tailLp.type = 'lowpass';
    V.tailLp.frequency.value = 500;
    V.tailG = gain(0);
    V.tail.connect(V.tailLp).connect(V.tailG).connect(V.mix);
    // the turbine: the whine, an inharmonic partial, the exhaust, the grit
    V.whine = osc('sine', 4000);
    V.whine2 = osc('sine', 4000 * 1.47);
    V.whineG = gain(0);
    V.whine2G = gain(0);
    V.whine.connect(V.whineG).connect(V.mix);
    V.whine2.connect(V.whine2G).connect(V.mix);
    V.exhaust = noise([['lowpass', 700, 0.5], ['peaking', 220, 1, 6]]);
    V.exhaustG = gain(0);
    V.exhaust.out.connect(V.exhaustG).connect(V.mix);
    V.grit = noise([['bandpass', 2500, 2]]);
    V.gritG = gain(0);
    V.grit.out.connect(V.gritG).connect(V.mix);
    // the out-of-balance beat once a revolution
    V.imb = osc('sine', 4.3);
    V.imbDepth = gain(0);
    V.imb.connect(V.imbDepth).connect(V.mix.gain);
    V.oscs = [V.pulse, V.tail, V.whine, V.whine2, V.imb];
    V.noises = [V.swish, V.slap, V.exhaust, V.grit];
    return V;
  }

  /** Every helicopter in `helis` (ai/helicopter.js Helicopter objects) heard by listener { pos, vel, occluded?, underwater? }. */
  update(helis, listener) {
    const s = this.s;
    if (!s.running) return;
    const t = s.ctx.currentTime;
    const all = (helis ?? []).filter((h) => h?.p).map((h) => ({ h, P: heliSoundParams(h, listener) }));
    all.sort((a, b) => b.P.heard - a.P.heard);
    const keep = new Set(all.slice(0, MAX_HELI_VOICES).filter((x) => x.P.heard > 1e-4).map((x) => x.h));
    // fade out the ones no longer heard (and drop them once quiet)
    for (const [h, V] of this.voices) {
      if (keep.has(h)) continue;
      V.level.gain.setTargetAtTime(0, t, 0.3);
      V.fadeT ??= t;
      if (t - V.fadeT > 2) this.drop(h);
    }
    for (const { h, P } of all) {
      if (!keep.has(h)) continue;
      let V = this.voices.get(h);
      if (!V) this.voices.set(h, (V = this.make()));
      V.fadeT = null;
      this.set(V, P, h, t);
    }
  }

  set(V, P, h, t) {
    const k = 0.08;
    const at = (param, v, tau = k) => param.setTargetAtTime(Number.isFinite(v) ? v : 0, t, tau);
    if (V.pan.positionX) {
      at(V.pan.positionX, h.p[0], 0.05);
      at(V.pan.positionY, h.p[1] + 3, 0.05);
      at(V.pan.positionZ, h.p[2], 0.05);
    } else V.pan.setPosition(h.p[0], h.p[1] + 3, h.p[2]);
    at(V.level.gain, Math.min(2, P.level) * 0.5, 0.1);
    at(V.air.frequency, P.cutoff, 0.2);
    // the rotor
    at(V.pulse.frequency, Math.max(0.5, P.bpf));
    at(V.thumpLp.frequency, Math.min(8000, P.thumpCutoff));
    at(V.rotorG.gain, P.rotorGain * 0.9);
    at(V.swishG.gain, P.rotorGain * 0.35);
    at(V.slapG.gain, P.slapGain);
    at(V.slap.f[0].frequency, P.slapFreq);
    at(V.imbDepth.gain, P.imbalance * 0.45);
    at(V.imb.frequency, Math.max(0.2, P.revHz));
    // the tail rotor
    at(V.tail.frequency, Math.max(1, P.tailBpf));
    at(V.tailLp.frequency, Math.max(150, P.tailBpf * 6));
    at(V.tailG.gain, P.tailGain * 0.5);
    // the turbine: with the spool's lag
    const spool = 1.5;
    const whineHz = P.engineOn ? P.turbineHz : 250 * P.doppler; // (off: it winds down)
    at(V.whine.frequency, whineHz, spool);
    at(V.whine2.frequency, whineHz * 1.47, spool);
    at(V.whineG.gain, P.turbineGain * 0.12, P.engineOn ? 0.6 : spool);
    at(V.whine2G.gain, P.turbineGain * 0.04, P.engineOn ? 0.6 : spool);
    at(V.exhaustG.gain, P.exhaustGain * 0.6, P.engineOn ? 0.6 : spool);
    at(V.gritG.gain, P.grit * P.exhaustGain * 0.5, 0.3);
    // the noise sped up and down with the Doppler shift
    for (const n of V.noises) at(n.src.playbackRate, P.doppler, 0.1);
  }

  drop(h) {
    const V = this.voices.get(h);
    if (!V) return;
    this.voices.delete(h);
    const t = this.s.ctx.currentTime;
    for (const o of V.oscs) o.stop(t + 0.1);
    for (const n of V.noises) n.src.stop(t + 0.1);
    setTimeout(() => V.pan.disconnect(), 300);
  }

  /** Everything silent and released (the SoundScape stopping or the scene changing). */
  clear() {
    for (const h of [...this.voices.keys()]) this.drop(h);
  }
}
