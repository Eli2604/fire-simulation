/**
 * Procedural soundscape for the firefighter walk-through (Web Audio, no
 * sample files). Everything is synthesised from filtered noise and simple
 * oscillators:
 *  - breathing apparatus: demand-valve click + inhale hiss, exhale puff;
 *    breathing rate follows exertion and heat stress
 *  - fire: low roar plus random crackles, positioned at the fire
 *  - gas jet: high hiss at a burst pipe
 *  - hose / extinguisher spray
 *  - low-air warning whistle, heartbeat under heat stress, explosion booms
 */
export class SoundScape {
  constructor() {
    this.ctx = null;
    this.running = false;
  }

  start() {
    if (this.running) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.running = true;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(ctx.destination);
    // 2 s of white noise shared by all noise voices
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // continuous voices
    this.fire = this.loop([{ type: 'lowpass', frequency: 380, Q: 0.6 }], true);
    this.fireHigh = this.loop([{ type: 'bandpass', frequency: 1200, Q: 0.7 }], true, this.fire.panner);
    this.jet = this.loop([{ type: 'highpass', frequency: 2200, Q: 0.7 }, { type: 'peaking', frequency: 6000, Q: 1, gain: 8 }], true);
    this.hose = this.loop([{ type: 'bandpass', frequency: 2800, Q: 0.5 }], false);
    this.leak = this.loop([{ type: 'highpass', frequency: 4000, Q: 0.7 }], false); // broken mask hissing
    this.burning = this.loop([{ type: 'bandpass', frequency: 600, Q: 0.5 }], false); // your gear on fire
    this.sprinkler = this.loop([{ type: 'bandpass', frequency: 4500, Q: 0.4 }], true);
    this.rush = this.loop([{ type: 'lowpass', frequency: 500, Q: 0.5 }, { type: 'peaking', frequency: 150, Q: 1, gain: 10 }], true);
    this.whistle = ctx.createOscillator();
    this.whistle.frequency.value = 3150;
    this.whistleGain = ctx.createGain();
    this.whistleGain.gain.value = 0;
    this.whistle.connect(this.whistleGain).connect(this.master);
    this.whistle.start();

    this.nextBreath = ctx.currentTime + 0.5;
    this.nextCrackle = ctx.currentTime;
    this.nextBeat = ctx.currentTime;
    this.seenEvents = 0;
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    this.ctx.close();
    this.ctx = null;
  }

  /** A looping noise voice through filters, optionally positioned in 3D. */
  loop(filters, positional, sharedPanner) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.loopStart = Math.random();
    let node = src;
    for (const f of filters) {
      const b = ctx.createBiquadFilter();
      b.type = f.type;
      b.frequency.value = f.frequency;
      b.Q.value = f.Q ?? 1;
      if (f.gain !== undefined) b.gain.value = f.gain;
      node.connect(b);
      node = b;
    }
    const gain = ctx.createGain();
    gain.gain.value = 0;
    node.connect(gain);
    let panner = sharedPanner ?? null;
    if (positional && !panner) {
      panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 1.5;
      panner.rolloffFactor = 1.2;
      panner.connect(this.master);
    }
    gain.connect(panner ?? this.master);
    src.start();
    return { src, gain, panner };
  }

  /** One-shot filtered noise burst. */
  burst(t, dur, filter, freq, q, level, panner) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const b = ctx.createBiquadFilter();
    b.type = filter;
    b.frequency.value = freq;
    b.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(b).connect(g).connect(panner ?? this.master);
    src.start(t, Math.random() * 1.5, dur + 0.05);
    return g;
  }

  breathe(t, rate, effort) {
    const ctx = this.ctx;
    const cycle = 60 / rate;
    const inhale = cycle * 0.4;
    const exhale = cycle * 0.45;
    // demand valve opening click
    this.burst(t, 0.03, 'highpass', 3500, 0.7, 0.25);
    // inhale: hiss through the regulator
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1700 + effort * 600;
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    const lvl = 0.22 + effort * 0.18;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(lvl, t + inhale * 0.25);
    g.gain.setValueAtTime(lvl, t + inhale * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + inhale);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random(), inhale + 0.1);
    // exhale: puff through the exhalation valve, a little flutter
    const t2 = t + inhale + cycle * 0.05;
    const src2 = ctx.createBufferSource();
    src2.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'bandpass';
    lp.frequency.value = 700;
    lp.Q.value = 0.6;
    const g2 = ctx.createGain();
    const l2 = 0.16 + effort * 0.14;
    g2.gain.setValueAtTime(0.0001, t2);
    g2.gain.exponentialRampToValueAtTime(l2, t2 + exhale * 0.15);
    for (let k = 1; k < 6; k++) g2.gain.setValueAtTime(l2 * (k % 2 ? 0.7 : 1), t2 + exhale * (0.15 + k * 0.1));
    g2.gain.exponentialRampToValueAtTime(0.0001, t2 + exhale);
    src2.connect(lp).connect(g2).connect(this.master);
    src2.start(t2, Math.random(), exhale + 0.1);
  }

  /**
   * Per frame. state: { listener: {pos, forward, up}, fire: {pos, hrr, dist},
   * jet: {pos, power} | null, spraying, effort 0..1, heat 0..1, airFraction 0..1, events, world }
   */
  update(state) {
    if (!this.running) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const L = ctx.listener;
    const { pos, forward, up } = state.listener;
    if (L.positionX) {
      L.positionX.setTargetAtTime(pos[0], t, 0.05);
      L.positionY.setTargetAtTime(pos[1], t, 0.05);
      L.positionZ.setTargetAtTime(pos[2], t, 0.05);
      L.forwardX.setTargetAtTime(forward[0], t, 0.05);
      L.forwardY.setTargetAtTime(forward[1], t, 0.05);
      L.forwardZ.setTargetAtTime(forward[2], t, 0.05);
      L.upX.setTargetAtTime(up[0], t, 0.05);
      L.upY.setTargetAtTime(up[1], t, 0.05);
      L.upZ.setTargetAtTime(up[2], t, 0.05);
    } else {
      L.setPosition(...pos);
      L.setOrientation(...forward, ...up);
    }
    const setPos = (p, v) => {
      if (p.positionX) {
        p.positionX.setTargetAtTime(v[0], t, 0.1);
        p.positionY.setTargetAtTime(v[1], t, 0.1);
        p.positionZ.setTargetAtTime(v[2], t, 0.1);
      } else p.setPosition(...v);
    };

    // fire roar and crackle, louder with the heat release
    const f = state.fire;
    const loud = f ? Math.min(1.2, Math.sqrt(f.hrr / 2e5)) : 0;
    if (f) setPos(this.fire.panner, f.pos);
    this.fire.gain.gain.setTargetAtTime(loud * 0.9, t, 0.3);
    this.fireHigh.gain.gain.setTargetAtTime(loud * 0.25, t, 0.3);
    if (f && loud > 0.02 && t >= this.nextCrackle) {
      this.burst(t, 0.01 + Math.random() * 0.04, 'bandpass', 1500 + Math.random() * 4000, 2, 0.15 + Math.random() * 0.5 * loud, this.fire.panner);
      this.nextCrackle = t + (0.02 + Math.random() * 0.25) / Math.max(0.1, loud);
    }
    // gas jet hiss
    const j = state.jet;
    if (j) setPos(this.jet.panner, j.pos);
    this.jet.gain.gain.setTargetAtTime(j ? Math.min(1, Math.sqrt(j.power / 1.5e5)) * 0.7 : 0, t, 0.2);
    // hose / extinguisher
    this.hose.gain.gain.setTargetAtTime(state.spraying ? 0.35 : 0, t, 0.08);
    this.leak.gain.gain.setTargetAtTime(state.maskLeak ? 0.25 : 0, t, 0.1);
    this.burning.gain.gain.setTargetAtTime(state.onFire ? 0.5 : 0, t, 0.1);
    if (state.sprinkler) setPos(this.sprinkler.panner, state.sprinkler);
    this.sprinkler.gain.gain.setTargetAtTime(state.sprinkler ? 0.4 : 0, t, 0.2);
    if (state.inflow?.pos) setPos(this.rush.panner, state.inflow.pos);
    this.rush.gain.gain.setTargetAtTime(state.inflow?.pos ? Math.min(1.2, 0.3 + state.inflow.rate / 20) : 0, t, 0.3);
    if (state.onFire && Math.random() < 0.3) this.burst(t, 0.02, 'bandpass', 2000 + Math.random() * 3000, 2, 0.4);
    // breathing
    if (t >= this.nextBreath - 0.05) {
      const effort = Math.min(1, state.effort + state.heat * 0.5 + (state.airFraction < 0.15 ? 0.3 : 0));
      const rate = 13 + effort * 15;
      this.breathe(Math.max(t, this.nextBreath), rate, effort);
      this.nextBreath = Math.max(t, this.nextBreath) + 60 / rate;
    }
    // low air warning whistle (real sets whistle at ~55 bar of 300)
    const low = state.airFraction < 55 / 300;
    this.whistleGain.gain.setTargetAtTime(low ? 0.06 * (0.6 + 0.4 * Math.sin(t * 18)) : 0, t, 0.02);
    // heartbeat under heat stress
    if (state.heat > 0.3 && t >= this.nextBeat) {
      const bpm = 90 + state.heat * 70;
      this.thump(t, 0.5 * state.heat);
      this.thump(t + 0.22, 0.35 * state.heat);
      this.nextBeat = t + 60 / bpm;
    }
    // explosions / pipe burst
    const ev = state.events ?? [];
    for (; this.seenEvents < ev.length; this.seenEvents++) {
      const e = ev[this.seenEvents];
      if (e.type === 'explosion') {
        this.burst(t, 1.8, 'lowpass', 300, 0.7, 1.2);
        this.thump(t, 1);
      } else if (e.type === 'pipeBurst') {
        this.burst(t, 0.4, 'bandpass', 900, 0.8, 0.8);
      } else if (e.type === 'spall') {
        this.burst(t, 0.06, 'bandpass', 2500, 1.5, 0.4);
      }
    }
  }

  /** A door swinging open / shut. */
  door() {
    if (!this.running) return;
    const t = this.ctx.currentTime;
    this.burst(t, 0.25, 'lowpass', 400, 0.7, 0.5);
    this.thump(t + 0.05, 0.4);
  }

  /** The visor cracking. */
  crack() {
    if (!this.running) return;
    const t = this.ctx.currentTime;
    this.burst(t, 0.12, 'highpass', 2500, 0.7, 0.9);
    this.burst(t + 0.03, 0.25, 'bandpass', 5500, 3, 0.4);
  }

  thump(t, level) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, level), t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.25);
  }
}
