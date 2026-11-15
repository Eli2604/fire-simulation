/**
 * The boats heard (Web Audio; the parameters: audio/boatSound.js boatSoundParams / boatSfxSound,
 * from each boat's physical state). A voice per boat, at most MAX_BOAT_VOICES (the loudest at the
 * listener; the rest fade out), each:
 *
 *   motor:  a pulse train at the firing frequency through a low-pass (brighter with load and out
 *           of the water), the gears' whine (a sine), the cavitation's hiss (band-passed noise)
 *   water:  the hull's hiss (band-passed noise at its speed's pitch), the prop's wash (low noise),
 *           water aboard sloshing (low noise, swaying at ~1 Hz), grinding on the bottom
 *   line:   the mooring line's creak (a narrow band of noise at its tension's pitch)
 *   sail:   flogging (noise gated by a square wave at the flutter rate), the rush of a full sail,
 *           the shrouds' hum (a sine at the Aeolian tone)
 *   to you: a panner for the direction (its level set here), the air's low-pass, the distance's
 *           gain; every frequency times the Doppler factor, the noise's playback rate too.
 * One-shots (f.sfx: slaps, oar catches and releases, gybes, the cord, a stall, rounds through the
 * hull) go through the SoundScape's place() / noiseTo() / impact().
 *
 * Needs a running SoundScape (audio/sound.js: its context, its noise buffer, its master).
 */
import { boatSoundParams, boatSfxSound } from './boatSound.js';

export const MAX_BOAT_VOICES = 3;

export class BoatVoices {
  constructor(scape) {
    this.s = scape;
    this.voices = new Map(); // boat → voice
    this.seen = new WeakMap(); // boat → the last f.sfx event heard
    this.pulse = null;
  }

  pulseWave() {
    if (this.pulse) return this.pulse;
    const N = 24;
    const re = new Float32Array(N + 1);
    const im = new Float32Array(N + 1);
    for (let n = 1; n <= N; n++) re[n] = Math.exp(-n / 6); // (a firing: a blunt pulse)
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
      const fs = filters.map(([type, f, Q, g]) => {
        const b = ctx.createBiquadFilter();
        b.type = type;
        b.frequency.value = f;
        b.Q.value = Q;
        if (g !== undefined) b.gain.value = g;
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
    // the motor
    V.fire = osc('pulse', 16);
    V.fireLp = ctx.createBiquadFilter();
    V.fireLp.type = 'lowpass';
    V.fireLp.frequency.value = 400;
    V.fireLp.Q.value = 1.2;
    V.motorG = gain(0);
    V.fire.connect(V.fireLp).connect(V.motorG).connect(V.mix);
    V.whine = osc('sine', 1000);
    V.whineG = gain(0);
    V.whine.connect(V.whineG).connect(V.mix);
    V.cav = noise([['bandpass', 3500, 0.9]]);
    V.cavG = gain(0);
    V.cav.out.connect(V.cavG).connect(V.mix);
    // the water
    V.hiss = noise([['bandpass', 1500, 0.7]]);
    V.hissG = gain(0);
    V.hiss.out.connect(V.hissG).connect(V.mix);
    V.wash = noise([['lowpass', 700, 0.6]]);
    V.washG = gain(0);
    V.wash.out.connect(V.washG).connect(V.mix);
    V.slosh = noise([['lowpass', 380, 0.8], ['peaking', 180, 1, 6]]);
    V.sloshAM = gain(0.5);
    V.sway = osc('sine', 0.9);
    V.swayDepth = gain(0.45);
    V.sway.connect(V.swayDepth).connect(V.sloshAM.gain);
    V.sloshG = gain(0);
    V.slosh.out.connect(V.sloshAM).connect(V.sloshG).connect(V.mix);
    V.scrape = noise([['bandpass', 1100, 0.6]]);
    V.scrapeG = gain(0);
    V.scrape.out.connect(V.scrapeG).connect(V.mix);
    // the line
    V.creak = noise([['bandpass', 520, 9]]);
    V.creakG = gain(0);
    V.creak.out.connect(V.creakG).connect(V.mix);
    // the sail
    V.flap = noise([['lowpass', 1400, 0.6]]);
    V.flapAM = gain(0.1);
    V.flog = osc('square', 3);
    V.flogDepth = gain(0.5);
    V.flog.connect(V.flogDepth).connect(V.flapAM.gain);
    V.flapG = gain(0);
    V.flap.out.connect(V.flapAM).connect(V.flapG).connect(V.mix);
    V.rush = noise([['lowpass', 450, 0.5]]);
    V.rushG = gain(0);
    V.rush.out.connect(V.rushG).connect(V.mix);
    V.hum = osc('sine', 300);
    V.humG = gain(0);
    V.hum.connect(V.humG).connect(V.mix);
    V.oscs = [V.fire, V.whine, V.sway, V.flog, V.hum];
    V.noises = [V.cav, V.hiss, V.wash, V.slosh, V.scrape, V.creak, V.flap, V.rush];
    return V;
  }

  /** Every boat (sim/boats.js floats) heard by listener { pos, vel, occluded?, underwater? }; their one-shots played. */
  update(boats, listener) {
    const s = this.s;
    if (!s.running) return;
    const t = s.ctx.currentTime;
    const all = (boats ?? []).filter((f) => f?.body?.pose).map((f) => ({ f, P: boatSoundParams(f, listener) }));
    all.sort((a, b) => b.P.heard - a.P.heard);
    const keep = new Set(all.slice(0, MAX_BOAT_VOICES).filter((x) => x.P.heard > 1e-4).map((x) => x.f));
    for (const [f, V] of this.voices) {
      if (keep.has(f)) continue;
      V.level.gain.setTargetAtTime(0, t, 0.3);
      V.fadeT ??= t;
      if (t - V.fadeT > 2) this.drop(f);
    }
    for (const { f, P } of all) {
      if (keep.has(f)) {
        let V = this.voices.get(f);
        if (!V) this.voices.set(f, (V = this.make()));
        V.fadeT = null;
        this.set(V, P, t);
      }
      this.oneShots(f, P);
    }
  }

  set(V, P, t) {
    const at = (param, v, tau = 0.08) => param.setTargetAtTime(Number.isFinite(v) ? v : 0, t, tau);
    const p = P.src;
    if (V.pan.positionX) {
      at(V.pan.positionX, p[0], 0.05);
      at(V.pan.positionY, p[1], 0.05);
      at(V.pan.positionZ, p[2], 0.05);
    } else V.pan.setPosition(p[0], p[1], p[2]);
    at(V.level.gain, Math.min(2, P.level) * 0.6, 0.1);
    at(V.air.frequency, P.cutoff, 0.2);
    const M = P.motor;
    at(V.fire.frequency, Math.max(2, M?.fire ?? 2), 0.06);
    at(V.fireLp.frequency, Math.min(9000, M?.cutoff ?? 200), 0.1);
    at(V.motorG.gain, (M?.gain ?? 0) * 0.7, M?.on ? 0.08 : 0.4);
    at(V.whine.frequency, Math.max(20, M?.whineHz ?? 20));
    at(V.whineG.gain, M?.whine ?? 0);
    at(V.cavG.gain, (M?.cav ?? 0) * 0.4 + (M?.racing ? 0.15 : 0));
    at(V.hissG.gain, P.hiss * 0.5);
    at(V.hiss.f[0].frequency, P.hissHz);
    at(V.washG.gain, P.wash * 0.6);
    at(V.sloshG.gain, P.slosh * 0.5);
    at(V.scrapeG.gain, P.scrape * 0.6);
    at(V.creakG.gain, P.creak * 0.25);
    at(V.creak.f[0].frequency, P.creakHz);
    const S = P.sail;
    at(V.flapG.gain, (S?.flap ?? 0) * 0.5);
    at(V.flog.frequency, Math.max(0.5, S?.flapHz ?? 1));
    at(V.rushG.gain, (S?.rush ?? 0) * 0.5);
    at(V.hum.frequency, Math.min(4000, Math.max(30, S?.humHz ?? 300)));
    at(V.humG.gain, (S?.hum ?? 0) * 0.08);
    for (const n of V.noises) at(n.src.playbackRate, P.doppler, 0.1);
  }

  /** Its new f.sfx events (since last heard), each played where it happened. */
  oneShots(f, P) {
    const q = f.sfx;
    if (!q?.length) return;
    const last = this.seen.get(f) ?? q[q.length - 1].n - 1; // (a boat heard first: only from now on)
    this.seen.set(f, q[q.length - 1].n);
    if (P.dist > 250) return;
    for (const e of q) {
      if (e.n <= last) continue;
      const S = boatSfxSound({ ...e, material: f.body?.material }, f.body?.M);
      if (!S) continue;
      const pos = e.p ?? P.src;
      if (S.impact) {
        this.s.impact({ pos, ...S.impact });
        continue;
      }
      const dur = Math.max(...S.layers.map((l) => l.delay + l.dur));
      const pl = this.s.place(pos, S.gain, dur, { ref: 3 });
      if (!pl) continue;
      for (const l of S.layers) this.s.noiseTo(pl.out, pl.t0 + l.delay, l.dur, l.type, l.freq * P.doppler, l.Q, (l.gain / Math.max(1e-3, S.gain)) * pl.gain);
    }
  }

  drop(f) {
    const V = this.voices.get(f);
    if (!V) return;
    this.voices.delete(f);
    const t = this.s.ctx.currentTime;
    for (const o of V.oscs) o.stop(t + 0.1);
    for (const n of V.noises) n.src.stop(t + 0.1);
    setTimeout(() => V.pan.disconnect(), 300);
  }

  clear() {
    for (const f of [...this.voices.keys()]) this.drop(f);
  }
}
