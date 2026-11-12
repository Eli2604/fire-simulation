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
    // footsteps of enemies nearby
    for (const en of state.enemies ?? []) {
      if (en.dead || !en.moving) continue;
      const d = Math.hypot(en.p[0] - pos[0], en.p[2] - pos[2]);
      if (d > 15) continue;
      en.stepT = (en.stepT ?? 0) - 1 / 60;
      if (en.stepT <= 0) {
        en.stepT = en.state === 'flee' || en.state === 'retreat' ? 0.3 : 0.5;
        this.burst(t, 0.05, 'lowpass', 700, 0.8, 0.5 / Math.max(1, d / 2));
      }
    }
    // the dragon: its feet coming down (heavier the faster it goes, all four when it lands) and its wingbeats
    for (const d of state.dragons ?? []) {
      for (const f of d.footfalls ?? []) {
        if (f.t <= (d.heardStep ?? -1)) continue;
        d.heardStep = f.t;
        this.stomp(f.p, Math.min(1.6, 0.35 + 0.5 * (f.weight ?? 1)));
      }
      if ((d.beats ?? 0) > (d.heardBeat ?? 0)) {
        d.heardBeat = d.beats;
        this.whoosh(d.chest ?? d.p, Math.min(1.2, 0.4 + 0.5 * (d.flapAmp ?? 1)));
      }
    }
    // the phoenix: soft wingbeats, and the hiss of the fire it is made of when close
    for (const f of state.phoenixes ?? []) {
      if (!f.pos || f.state === 'free' || f.state === 'ashes') continue;
      const beats = Math.floor((f.flap ?? 0) / (Math.PI * 2));
      if (beats > (f.heardBeat ?? 0)) {
        f.heardBeat = beats;
        if (f.wing > 0.3) this.whoosh(f.pos, 0.22 * f.wing);
      }
    }
    // breathing
    if (t >= this.nextBreath - 0.05) {
      const effort = Math.min(1, state.effort + state.heat * 0.5 + (state.airFraction < 0.15 ? 0.3 : 0));
      const rate = 13 + effort * 15;
      if (state.maskOff) this.breatheFree(Math.max(t, this.nextBreath), rate, effort);
      else this.breathe(Math.max(t, this.nextBreath), rate, effort);
      this.nextBreath = Math.max(t, this.nextBreath) + 60 / rate;
    }
    // low air warning whistle (real sets whistle at ~55 bar of 300)
    const low = state.airFraction < 55 / 300 && !state.maskOff;
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
      if (e.type === 'explosion' && e.name === 'lightning') {
        // (its sound is the thunder: below)
      } else if (e.type === 'lightning') {
        // thunder: the crack of the strike, then the rumble rolling on for seconds; it comes as
        // far behind the flash as sound takes to get here (~3 s a kilometre), duller and longer
        // from further (the air takes the high notes)
        const lp = state.listener?.pos;
        const d = lp ? Math.hypot(e.pos[0] - lp[0], e.pos[1] - lp[1], e.pos[2] - lp[2]) : 0;
        const td = t + d / 343;
        const far = Math.min(1, d / 1500);
        const g = Math.max(0.35, 1 - far * 0.6);
        if (far < 0.3) this.burst(td, 0.18, 'highpass', 1800, 0.7, 1.1 * (1 - far * 3));
        this.thump(td + 0.05, 1.2 * g);
        this.burst(td + 0.2, 4.5 + 3 * far, 'lowpass', 110 - 50 * far, 0.7, 1.5 * g);
      } else if (e.type === 'explosion') {
        this.blast(e, state.listener?.pos);
      } else if (e.type === 'pipeBurst' || e.type === 'waterBurst') {
        this.burst(t, 0.4, 'bandpass', 900, 0.8, 0.8);
      } else if (e.type === 'decompression') {
        // the roar of air rushing out, then (in the vacuum) silence
        this.burst(this.ctx.currentTime, 3, 'lowpass', 500, 0.5, 1.2);
        this.burst(this.ctx.currentTime, 1.5, 'bandpass', 2500, 0.7, 0.5);
      } else if (e.type === 'roar') {
        this.roar(e.pos);
      } else if (e.type === 'gulp' || e.type === 'dragonSnap') {
        this.stomp(e.pos, 0.5);
        this.burst(t, 0.12, 'bandpass', 900, 1.5, 0.5);
      } else if (e.type === 'dragonStamp') {
        // its weight coming down on a roof: the thud, and what breaks under it
        this.stomp(e.pos, 2.2);
        if (e.broke) {
          const out = this.at(e.pos, 6);
          this.noiseTo(out, t, 0.9, 'lowpass', 900, 0.7, Math.min(1.4, 0.5 + e.broke * 0.05));
          for (let n = 0; n < Math.min(14, e.broke); n++) this.noiseTo(out, t + 0.05 + Math.random() * 0.9, 0.05, 'bandpass', 1200 + Math.random() * 3000, 3, 0.3);
        }
      } else if (e.type === 'dragonDown') {
        this.stomp(e.pos, 2);
        this.burst(t, 1.2, 'lowpass', 250, 0.7, 1.0);
      } else if (['phoenixCry', 'phoenixCalls', 'phoenixFreed', 'phoenixReborn', 'phoenixEscape', 'phoenixFree', 'phoenixHurt'].includes(e.type)) {
        this.cry(e.pos, e.type === 'phoenixHurt' ? 0.7 : 1);
      } else if (e.type === 'phoenixBurns') {
        // a rush of flame, and its cry going up in it
        const out = this.at(e.pos, 4);
        this.noiseTo(out, t, 2.2, 'lowpass', 900, 0.7, 0.8);
        this.noiseTo(out, t + 0.1, 1.4, 'bandpass', 2400, 0.8, 0.25);
        this.cry(e.pos, 1.2);
      } else if (e.type === 'shout' || e.type === 'lightSeen') {
        this.shout(e.pos); // "who's there?"
      } else if (e.type === 'glass') {
        this.glass(e.pos);
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

  /** The bow string releasing. */
  bow() {
    if (!this.running) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.16);
    this.burst(t, 0.3, 'bandpass', 1500, 1, 0.2);
  }

  /** A panner at p (in the listener's space), for the dragon's sounds. */
  at(p, ref = 3) {
    const pan = this.ctx.createPanner();
    pan.panningModel = 'HRTF';
    pan.distanceModel = 'inverse';
    pan.refDistance = ref;
    if (pan.positionX && p) {
      pan.positionX.value = p[0];
      pan.positionY.value = p[1];
      pan.positionZ.value = p[2];
    }
    pan.connect(this.master);
    return pan;
  }

  /** A shaped noise burst into `out`. */
  noiseTo(out, t, dur, type, freq, Q, level) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.6 + Math.random() * 0.3;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = Q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + Math.min(0.04, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  /** A dragon's foot coming down: a deep thud through the ground, and the crunch of what is under it. */
  stomp(p, level = 1) {
    if (!this.running) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = this.at(p, 4);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(58, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9 * level, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.4);
    this.noiseTo(out, t, 0.18, 'lowpass', 380, 0.8, 0.45 * level);
    this.noiseTo(out, t + 0.01, 0.08, 'bandpass', 2200, 1.2, 0.08 * level); // claws on stone, gravel
  }

  /** A downstroke of the wings: a deep whoosh of air. */
  whoosh(p, level = 1) {
    if (!this.running) return;
    const t = this.ctx.currentTime;
    const out = this.at(p, 6);
    this.noiseTo(out, t, 0.55, 'lowpass', 260, 0.6, 0.7 * level);
    this.noiseTo(out, t + 0.05, 0.35, 'bandpass', 700, 0.8, 0.15 * level);
  }

  /**
   * The phoenix's cry: the clear, ringing scream of a big raptor (an eagle's
   * "kee-ee-arr"): two falling, slightly rough notes with a quick vibrato.
   */
  cry(p, level = 1) {
    if (!this.running) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const out = this.at(p, 4);
    for (const [dt, dur, f0, f1, lvl] of [[0, 0.32, 2300, 1900, 0.5], [0.36, 0.7, 2100, 1300, 0.42]]) {
      const t = t0 + dt;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(lvl * level, t + 0.03);
      env.gain.setValueAtTime(lvl * level * 0.8, t + dur * 0.6);
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const vib = ctx.createOscillator();
      vib.frequency.value = 28;
      const vg = ctx.createGain();
      vg.gain.value = 60;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2400;
      bp.Q.value = 1.4;
      for (const [mul, type, g0] of [[1, 'sawtooth', 0.35], [1.5, 'sine', 0.25], [0.5, 'triangle', 0.3]]) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(f0 * mul, t);
        o.frequency.exponentialRampToValueAtTime(f1 * mul, t + dur);
        vib.connect(vg).connect(o.frequency);
        const g = ctx.createGain();
        g.gain.value = g0;
        o.connect(g).connect(bp);
        o.start(t);
        o.stop(t + dur + 0.02);
      }
      bp.connect(env).connect(out);
      vib.start(t);
      vib.stop(t + dur + 0.02);
    }
  }

  /** The dragon's roar: a growl from deep in the chest rising to a rasping bellow. */
  roar(p) {
    if (!this.running) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = this.at(p, 8);
    const dur = 2.2;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.9, t + 0.35);
    env.gain.setValueAtTime(0.9, t + 1.3);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    // a rough throat: the voice tremor modulates the level
    const trem = ctx.createOscillator();
    trem.frequency.value = 23;
    const tg = ctx.createGain();
    tg.gain.value = 0.35;
    trem.connect(tg).connect(env.gain);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.linearRampToValueAtTime(1400, t + 0.8);
    lp.frequency.linearRampToValueAtTime(600, t + dur);
    lp.Q.value = 3;
    for (const [f0, f1, type, lvl] of [[48, 74, 'sawtooth', 0.5], [97, 140, 'sawtooth', 0.3], [36, 52, 'square', 0.25]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.linearRampToValueAtTime(f1, t + 0.9);
      o.frequency.linearRampToValueAtTime(f0 * 0.85, t + dur);
      const g = ctx.createGain();
      g.gain.value = lvl;
      o.connect(g).connect(lp);
      o.start(t);
      o.stop(t + dur);
    }
    trem.start(t);
    trem.stop(t + dur);
    lp.connect(env).connect(out);
    this.noiseTo(out, t + 0.1, dur - 0.2, 'bandpass', 900, 0.9, 0.35); // the breath in it
  }

  /** A short voiced shout ("hey!") from p. */
  shout(p) {
    if (!this.running) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const pan = ctx.createPanner();
    pan.panningModel = 'HRTF';
    pan.distanceModel = 'inverse';
    pan.refDistance = 2;
    if (pan.positionX) {
      pan.positionX.value = p[0];
      pan.positionY.value = p[1];
      pan.positionZ.value = p[2];
    }
    pan.connect(this.master);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(220, t);
    o.frequency.linearRampToValueAtTime(300, t + 0.12);
    o.frequency.linearRampToValueAtTime(180, t + 0.35);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900;
    f.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
    o.connect(f).connect(g).connect(pan);
    o.start(t);
    o.stop(t + 0.4);
  }

  /** Breaking glass: a sharp crash and tinkling shards. */
  glass(pos) {
    if (!this.running) return;
    const t = this.ctx.currentTime;
    this.burst(t, 0.15, 'highpass', 3000, 0.7, 1.0);
    for (let k = 0; k < 10; k++) this.burst(t + 0.05 + Math.random() * 0.6, 0.03, 'bandpass', 4000 + Math.random() * 5000, 6, 0.25 + Math.random() * 0.3);
    void pos;
  }

  /** The visor cracking. */
  crack() {
    if (!this.running) return;
    const t = this.ctx.currentTime;
    this.burst(t, 0.12, 'highpass', 2500, 0.7, 0.9);
    this.burst(t + 0.03, 0.25, 'bandpass', 5500, 3, 0.4);
  }

  /**
   * An explosion (a grenade, a rocket, a tank bursting): the sharp crack of the shock, the
   * bang, a deep boom you feel more than hear, the rumble rolling off and its echoes, and
   * what it threw coming down. It comes as late as sound takes to get here and duller from
   * far off (the air takes the high notes). Close by it is deafening: your ears ring and
   * the rest goes quiet for a moment. Through a limiter, so it can be loud without clipping.
   */
  blast(e, lp) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    if (!this.boomBus) {
      const c = ctx.createDynamicsCompressor();
      c.threshold.value = -8;
      c.knee.value = 4;
      c.ratio.value = 10;
      c.attack.value = 0.002;
      c.release.value = 0.3;
      c.connect(this.master);
      this.boomBus = c;
    }
    const d = lp ? Math.max(1, Math.hypot(e.pos[0] - lp[0], e.pos[1] - lp[1], e.pos[2] - lp[2])) : 10;
    const size = Math.max(0.4, Math.min(3, Math.cbrt((e.energy ?? 8e5) / 8e5)));
    const k = Math.min(2.2, size * (1.6 / (1 + d / 18)));
    const far = Math.min(1, d / 400);
    const t0 = t + d / 343;
    const pan = ctx.createPanner();
    pan.panningModel = 'HRTF';
    pan.distanceModel = 'linear';
    pan.maxDistance = 1e5;
    pan.rolloffFactor = 0; // (the level is set here: k)
    if (pan.positionX) {
      pan.positionX.value = e.pos[0];
      pan.positionY.value = e.pos[1];
      pan.positionZ.value = e.pos[2];
    }
    pan.connect(this.boomBus);
    // the crack of the shock front (gone at a distance)
    if (far < 0.5) {
      this.noiseTo(pan, t0, 0.09, 'highpass', 1400, 0.7, 2.2 * k * (1 - far * 2));
      this.noiseTo(pan, t0 + 0.005, 0.45, 'bandpass', 1600 - 900 * far, 0.6, 1.6 * k);
    }
    // the body of the bang, and the boom under it
    this.noiseTo(pan, t0, 1.2 + 0.8 * size, 'lowpass', 900 - 600 * far, 0.7, 1.8 * k);
    for (const [f0, f1, lvl, dur] of [[62, 26, 2.4, 0.9], [110, 45, 1.2, 0.5]]) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(f0 * (1.1 - 0.2 * Math.min(1, size)), t0);
      o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.001, lvl * k), t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * (1 + size * 0.5));
      o.connect(g).connect(pan);
      o.start(t0);
      o.stop(t0 + dur * (1 + size * 0.5) + 0.05);
    }
    // the rumble rolling off, and its echoes off walls and hills
    this.noiseTo(pan, t0 + 0.15, 2.5 + 2 * far + size, 'lowpass', 220 - 100 * far, 0.7, 1.0 * k);
    for (let n = 0; n < 3; n++) this.noiseTo(pan, t0 + 0.25 + n * 0.32 + Math.random() * 0.15, 0.5, 'bandpass', 500 - 80 * n, 0.8, 0.45 * k * 0.6 ** n);
    // what it threw coming down: grit, stones, splinters
    if (d < 60)
      for (let n = 0; n < 16; n++) this.noiseTo(pan, t0 + 0.35 + Math.random() * 1.6, 0.03 + Math.random() * 0.05, 'bandpass', 1500 + Math.random() * 4500, 3, (0.15 + Math.random() * 0.35) * k);
    // close: deafened for a moment, a ringing in the ears
    if (d < 12) {
      const deaf = Math.min(1, (12 - d) / 9) * Math.min(1, size);
      const m = this.master.gain;
      m.cancelScheduledValues(t0 + 0.05);
      m.setValueAtTime(m.value, t0 + 0.05);
      m.linearRampToValueAtTime(0.8 * (1 - 0.7 * deaf), t0 + 0.35);
      m.linearRampToValueAtTime(0.8, t0 + 0.35 + 3 * deaf);
      const o = ctx.createOscillator();
      o.frequency.value = 3600 + Math.random() * 900;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0 + 0.1);
      g.gain.exponentialRampToValueAtTime(0.06 * deaf, t0 + 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3 + 4 * deaf);
      o.connect(g).connect(ctx.destination);
      o.start(t0 + 0.1);
      o.stop(t0 + 0.4 + 4 * deaf);
    }
  }

  /** Breathing without the mask: your own breath, no regulator (quieter, softer). */
  breatheFree(t, rate, effort) {
    const cycle = 60 / rate;
    this.burst(t, cycle * 0.35, 'bandpass', 900 + effort * 400, 0.5, 0.04 + effort * 0.08);
    this.burst(t + cycle * 0.45, cycle * 0.4, 'lowpass', 600, 0.5, 0.05 + effort * 0.09);
  }

  /**
   * The mask coming off or going on: the head harness straps (a rubbery slither), the seal of
   * the face piece against your face, the demand valve: off, the air stops with a last hiss;
   * on, a click as it connects and a breath of air as it kicks in.
   */
  maskSwap(on) {
    if (!this.running) return;
    const t = this.ctx.currentTime;
    // straps
    this.burst(t, 0.35, 'bandpass', 2400, 2.5, 0.18);
    this.burst(t + 0.18, 0.3, 'bandpass', 3100, 2.5, 0.14);
    if (on) {
      this.thump(t + 0.5, 0.25); // the face piece onto your face
      this.burst(t + 0.55, 0.06, 'highpass', 3000, 0.7, 0.4); // the valve clicks in
      this.burst(t + 0.62, 0.7, 'bandpass', 1900, 0.9, 0.35); // the first rush of air
    } else {
      this.burst(t + 0.05, 0.05, 'highpass', 3000, 0.7, 0.35); // the valve off
      this.burst(t + 0.08, 0.9, 'bandpass', 1700, 0.9, 0.3); // the air in it hissing out
      this.burst(t + 0.4, 0.15, 'lowpass', 700, 0.8, 0.2); // the seal letting go
    }
    this.nextBreath = t + 1.1;
  }

  /** A cough (smoke without the mask). */
  cough() {
    if (!this.running) return;
    const t = this.ctx.currentTime;
    const n = 1 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      const t0 = t + k * (0.28 + Math.random() * 0.1);
      this.burst(t0, 0.2, 'bandpass', 420 + Math.random() * 120, 1.2, 0.55);
      this.burst(t0 + 0.01, 0.12, 'bandpass', 1300, 1.5, 0.2);
      this.thump(t0, 0.2);
    }
  }

  /** Raising the rifle to the eye, or bringing it down. */
  aim(up) {
    if (!this.running) return;
    const t = this.ctx.currentTime;
    this.burst(t, 0.12, 'bandpass', up ? 1300 : 1000, 2, 0.12);
    this.burst(t + 0.05, 0.04, 'highpass', 2600, 0.7, 0.1);
  }

  /** A rifle shot: the crack and the report off the walls. */
  shot() {
    if (!this.running) return;
    const t = this.ctx.currentTime;
    this.burst(t, 0.05, 'highpass', 2500, 0.7, 1.1);
    this.burst(t, 0.14, 'bandpass', 1500, 1.0, 1.0);
    this.thump(t, 0.5);
    this.burst(t + 0.06, 0.5, 'lowpass', 600, 0.7, 0.3);
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
