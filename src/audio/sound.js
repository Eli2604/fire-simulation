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
 *
 * Physically driven (audio/physics.js): the parameters come from the state of the source.
 *  - fire: per burning region of the simulation (sim/fireAudio.js: state.fireSources), the roar
 *    from its heat release and flame size (bigger: louder and lower), puffing at 1.5/√D Hz, swelling
 *    with the wind; the crackle per material from its moisture, resin and grain; the hiss of water
 *    flashing to steam; metal ticking as it heats and cools; a whoomp when a region flares up.
 *    Distant regions are merged into few voices (aggregate), with less detail the further (lodFor).
 *  - impacts (sim/impact.js events): modal synthesis of the two bodies (strike()), loud by the
 *    energy, bright by the contact time, ringing by the materials; bubbles for a splash, shards
 *    for glass, a ground boom for a big one.
 *  - wind, rain, explosions, gunshots (cartridge energy), wings (area, beat), decompression (the
 *    pressure across the breach), the gas jet (its mass flow).
 *  - propagation for every positioned sound: inverse-square, air absorption of the highs, the
 *    speed-of-sound delay, muffled through walls (state.lineOfSight) and under water.
 *  - helicopters (audio/heliSound.js, audio/heliVoices.js: state.helis): the main rotor's thud at
 *    its blade passage frequency, the blade slap, the tail rotor, the turbine, from each one's
 *    rotor speed, load, descent and damage, with the Doppler shift; its hits, blades flying off, crash.
 *  - boats (audio/boatSound.js, audio/boatVoices.js: state.boats): the outboard at its firing
 *    frequency, cavitating, racing; the hull's hiss, the bow slapping onto the waves, the oars'
 *    and paddles' catches and splashes, the mooring line creaking, water sloshing aboard, the sail
 *    flogging and the rigging humming, rounds through the hull; with the Doppler shift.
 *  - cars (audio/carSound.js, audio/carVoices.js: state.cars): the engine at its firing frequency
 *    from its revs and cylinders, its load, the gear shifts, the exhaust and intake, the starter;
 *    the tyres rolling and squealing with their slip, the wind, the brakes, the horn, crashes;
 *    with the Doppler shift.
 *  - a smithy (audio/smithSound.js: hammer impacts, state.smithies): the hammer's blows by modal
 *    synthesis of the anvil, the blade at its temperature (hot steel thuds, cold rings) and the
 *    hammer, from the blow's force and the Hertz contact; scale spattering; the quench's sizzle
 *    from the steam the water voxels give off; the bellows' whoosh from the air through the tuyere.
 *  - CPU: a voice budget (MAX_VOICES one-shots at a time; quieter ones are dropped).
 */
import { HeliVoices } from './heliVoices.js';
import { BoatVoices } from './boatVoices.js';
import { CarVoices } from './carVoices.js';
import { hammerBlow, quenchSizzle, bellowsWhoosh } from './smithSound.js';
import { heliCrashSound, heliHitSound } from './heliSound.js';
import { impactSound, propagate, fireRoar, crackle, steamHiss, metalTick, aggregate, lodFor, windNoise, rainSound, wingBeat, gunshot, decompression, gainOf, dbOf, P_ATM } from './physics.js';

const MAX_VOICES = 28;
const FIRE_VOICES = 3;

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
    // under water everything comes through muffled (the master's low-pass)
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.master.connect(this.muffle).connect(ctx.destination);
    // loud one-shots (impacts, booms) through a limiter
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -10;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 8;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.25;
    this.limiter.connect(this.master);
    this.voiceEnds = [];
    // 2 s of white noise shared by all noise voices
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // continuous voices
    // the fire: a few roar voices (the loudest regions, the rest merged), each turbulence noise
    // through a low-pass at its cutoff and a peak at its spectrum's peak, its level puffing at the
    // flame's flicker frequency (an LFO on a gain)
    this.fireVoices = [];
    for (let k = 0; k < FIRE_VOICES; k++) {
      const v = this.loop([{ type: 'lowpass', frequency: 600, Q: 0.6 }, { type: 'peaking', frequency: 200, Q: 0.8, gain: 9 }], true);
      v.lp = v.filters[0];
      v.pk = v.filters[1];
      v.panner.rolloffFactor = 0; // (the level is set here: propagate())
      v.panner.distanceModel = 'linear';
      v.puff = ctx.createGain();
      v.puff.gain.value = 1;
      v.gain.disconnect();
      v.gain.connect(v.puff).connect(v.panner);
      v.lfo = ctx.createOscillator();
      v.lfo.frequency.value = 2;
      v.lfoDepth = ctx.createGain();
      v.lfoDepth.gain.value = 0;
      v.lfo.connect(v.lfoDepth).connect(v.puff.gain);
      v.lfo.start();
      v.hiss = this.loop([{ type: 'bandpass', frequency: 4000, Q: 0.8 }], false, v.panner); // steam, fine fuel
      v.hissF = v.hiss.filters[0];
      v.popAcc = 0;
      v.tickAcc = 0;
      this.fireVoices.push(v);
    }
    this.fire = this.fireVoices[0];
    this.wind = this.loop([{ type: 'lowpass', frequency: 400, Q: 0.5 }, { type: 'bandpass', frequency: 300, Q: 6 }], false);
    this.windTone = this.wind.filters[1];
    this.rainV = this.loop([{ type: 'highpass', frequency: 1200, Q: 0.5 }, { type: 'peaking', frequency: 3000, Q: 1, gain: 6 }], false);
    this.jet =this.loop([{ type: 'highpass', frequency: 2200, Q: 0.7 }, { type: 'peaking', frequency: 6000, Q: 1, gain: 8 }], true);
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
    this.heliVoices = new HeliVoices(this);
    this.boatVoices = new BoatVoices(this);
    this.carVoices = new CarVoices(this);
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    this.heliVoices = null;
    this.boatVoices = null;
    this.carVoices = null;
    this.smithVoices = null;
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
    const made = [];
    for (const f of filters) {
      const b = ctx.createBiquadFilter();
      b.type = f.type;
      b.frequency.value = f.frequency;
      b.Q.value = f.Q ?? 1;
      if (f.gain !== undefined) b.gain.value = f.gain;
      node.connect(b);
      node = b;
      made.push(b);
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
    return { src, gain, panner, filters: made };
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

    const dtF = Math.min(0.1, Math.max(0, t - (this.lastT ?? t)));
    this.lastT = t;
    this.state = state;
    this.muffle.frequency.setTargetAtTime(state.underwater ? 450 : 20000, t, 0.1);
    // the fire: roar, crackle, hiss, ticks, per region (physics: audio/physics.js)
    this.updateFire(state, t, dtF, setPos);
    // wind and rain (the weather's own numbers)
    const wn = windNoise(state.wind?.speed ?? 0);
    this.wind.gain.gain.setTargetAtTime(state.indoors ? wn.gain * 0.15 : wn.gain, t, 0.5);
    this.wind.filters[0].frequency.setTargetAtTime(state.indoors ? Math.min(250, wn.cutoff) : wn.cutoff, t, 0.5);
    this.windTone.frequency.setTargetAtTime(wn.tone * (0.9 + 0.2 * Math.sin(t * 0.7)), t, 0.3);
    const rn = rainSound(state.rain ?? 0, !!state.onWater);
    this.rainV.gain.gain.setTargetAtTime(state.indoors ? rn.gain * 0.25 : rn.gain, t, 0.5);
    this.rainV.filters[1].frequency.setTargetAtTime(rn.bubble, t, 0.5);
    // gas jet hiss: the gas leaving the burst pipe (its mass flow from the power: ~46 MJ/kg), sonic
    const j = state.jet;
    if (j) setPos(this.jet.panner, j.pos);
    const jd = j ? decompression({ dP: 3e5, area: j.power / 46e6 / (1.8 * 343) }) : null;
    this.jet.gain.gain.setTargetAtTime(jd ? Math.min(1, jd.gain) * 0.7 : 0, t, 0.2);
    if (jd) this.jet.filters[1].frequency.setTargetAtTime(Math.min(9000, jd.whistle), t, 0.2);
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
        this.stomp(f.p, f.weight ?? 1, f.material);
      }
      if ((d.beats ?? 0) > (d.heardBeat ?? 0)) {
        d.heardBeat = d.beats;
        const k = d.k ?? 1;
        this.whoosh(d.chest ?? d.p, wingBeat({ area: 40 * k * k, span: 15 * k, flapHz: 1.2 / Math.sqrt(k), amplitude: 0.6 + 0.5 * (d.flapAmp ?? 1) }));
      }
    }
    // the phoenix: soft wingbeats, and the hiss of the fire it is made of when close
    for (const f of state.phoenixes ?? []) {
      if (!f.pos || f.state === 'free' || f.state === 'ashes') continue;
      const beats = Math.floor((f.flap ?? 0) / (Math.PI * 2));
      if (beats > (f.heardBeat ?? 0)) {
        f.heardBeat = beats;
        if (f.wing > 0.3) this.whoosh(f.pos, wingBeat({ area: 1.2 * f.wing, span: 2.4, flapHz: 2.5, amplitude: 1 }));
      }
    }
    // the helicopters (each one's rotor, tail rotor and turbine from its state: audio/heliSound.js)
    if (state.helis) this.updateHelis(state.helis);
    // the boats (motor, hull, oars, sail, from each one's state: audio/boatSound.js)
    if (state.boats) this.updateBoats(state.boats);
    // the cars (engine, tyres, wind, horn from each one's state: audio/carSound.js)
    if (state.cars) this.updateCars(state.cars);
    // the smithies: the quench's sizzle and the bellows' whoosh from their physics (audio/smithSound.js)
    if (state.smithies?.length) this.updateSmithies(state.smithies, t, setPos);
    // breathing (not at the controls of a helicopter: no breathing set on)
    if (state.flying) this.nextBreath = t + 1;
    else if (t >= this.nextBreath - 0.05) {
      const effort = Math.min(1, state.effort + state.heat * 0.5 + (state.airFraction < 0.15 ? 0.3 : 0));
      const rate = 13 + effort * 15;
      if (state.maskOff) this.breatheFree(Math.max(t, this.nextBreath), rate, effort);
      else this.breathe(Math.max(t, this.nextBreath), rate, effort);
      this.nextBreath = Math.max(t, this.nextBreath) + 60 / rate;
    }
    // low air warning whistle (real sets whistle at ~55 bar of 300)
    const low = state.airFraction < 55 / 300 && !state.maskOff && !state.flying;
    this.whistleGain.gain.setTargetAtTime(low ? 0.06 * (0.6 + 0.4 * Math.sin(t * 18)) : 0, t, 0.02);
    // heartbeat under heat stress
    if (state.heat > 0.3 && !state.flying && t >= this.nextBeat) {
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
        // the roar of air rushing out (Lighthill, from the pressure across the breach and its
        // size), a whistle at the edge tone, then (in the vacuum) silence
        const dc = decompression({ dP: e.dP ?? P_ATM, area: e.area ?? 0.05 });
        this.burst(this.ctx.currentTime, 3, 'lowpass', Math.min(900, dc.cutoff / 6), 0.5, 1.2 * dc.gain);
        this.burst(this.ctx.currentTime, 1.5, 'bandpass', dc.whistle, 4, 0.5 * dc.gain);
      } else if (e.type === 'doorClose' && e.slam) {
        // a pressure door slamming shut on its own
        this.thump(t, 1.0);
        this.burst(t, 0.3, 'lowpass', 300, 0.7, 0.8);
      } else if (e.type === 'plugged' || e.type === 'doorHeld') {
        // something stuck in the hole (the whistle of the air past it); a door's valve hissing
        this.thump(t, e.type === 'plugged' ? 0.8 : 0.2);
        this.burst(t, e.type === 'plugged' ? 2 : 3, 'bandpass', 3200, 6, 0.25);
      } else if (e.type === 'blownOut') {
        this.thump(t, 0.9);
      } else if (e.type === 'impact') {
        // sim/impact.js (and fragments landing: sim/vessels.js): the two bodies, struck
        if (!e.silent) this.impact(e);
      } else if (e.type === 'treeFall') {
        this.impact({ pos: e.pos, materials: ['oak', 'soil'], energy: 4e4, mass: 800, speed: 10, size: 6, radius: 0.4, delay: 2.2 });
      } else if (e.type === 'flashover' || e.type === 'vaporIgnition') {
        this.whoomp(e.pos, e.energy ?? 5e5);
      } else if (e.type === 'roar') {
        this.roar(e.pos);
      } else if (e.type === 'gulp' || e.type === 'dragonSnap') {
        // the jaws snapping shut: teeth on teeth (bone, a ~0.1 m tooth row)
        this.impact({ pos: e.pos, materials: ['bone', 'bone'], energy: 300, mass: 40, speed: 4, size: 0.3, sizeA: 0.3, radius: 0.02 });
      } else if (e.type === 'iceBreak') {
        this.iceBreak(false, e.pos);
      } else if (e.type === 'dragonStamp') {
        // its weight coming down on a roof: the thud (an impact event: sim/impact.js), what breaks under it
        if (e.broke) {
          const out = this.at(e.pos, 6);
          this.noiseTo(out, t, 0.9, 'lowpass', 900, 0.7, Math.min(1.4, 0.5 + e.broke * 0.05));
          for (let n = 0; n < Math.min(14, e.broke); n++) this.noiseTo(out, t + 0.05 + Math.random() * 0.9, 0.05, 'bandpass', 1200 + Math.random() * 3000, 3, 0.3);
        }
      } else if (e.type === 'dragonDown' || e.type === 'dragonCrash') {
        // (the thud and the boom are its impact event: sim/impact.js, from its mass and speed)
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
        // a pane breaking (heat, a blow): glass struck past its strength: shards
        this.impact({ pos: e.pos, materials: ['glass', 'glass'], energy: 40, mass: 2, speed: 6, size: 0.8, sizeA: 0.05, radius: 0.01 });
      } else if (e.type === 'heliHit' || e.type === 'heliShed' || e.type === 'heliCrash') {
        this.heliEvent(e);
      } else if (e.type === 'spall') {
        this.burst(t, 0.06, 'bandpass', 2500, 1.5, 0.4);
      } else if (e.type === 'quench') {
        // hot steel into the slack tub (sim/smithy.js): the first sharp hiss as it goes in (the
        // seething after it is the smithy's sizzle voice: updateSmithies, from the steam the
        // water voxels give off)
        const pl = this.place(e.pos, 0.9, 1.5);
        if (pl) this.noiseTo(pl.out, pl.t0, 1.2, 'highpass', 3500, 0.7, 0.7 * pl.gain);
      } else if (e.type === 'bellows') {
        // a stroke of the forge's bellows: the leather and the valve flap (the air's whoosh is
        // the smithy's bellows voice: updateSmithies, from the air through the tuyere)
        const pl = this.place(e.pos, 0.3, 0.3);
        if (pl) this.noiseTo(pl.out, pl.t0, 0.12, 'bandpass', 700, 1.5, 0.5 * pl.gain);
      } else if (e.type === 'grind') {
        // steel on the turning grindstone
        const pl = this.place(e.pos, 0.35, 0.5);
        if (pl) this.noiseTo(pl.out, pl.t0, 0.4, 'bandpass', 4200, 2, 0.5 * pl.gain);
      }
    }
  }

  /**
   * The helicopters heard from where the listener is (state.listener, or `listener` { pos, vel? }):
   * audio/heliVoices.js. The listener's velocity (the Doppler) from how it moved since the last call.
   */
  updateHelis(helis, listener = null) {
    if (!this.running) return;
    const t = this.ctx.currentTime;
    const pos = listener?.pos ?? this.state?.listener?.pos;
    let vel = listener?.vel;
    if (pos && !vel) {
      const dt = t - (this.lastLT ?? t);
      if (this.lastLP && dt > 1e-3 && dt < 0.5) {
        const raw = [0, 1, 2].map((i) => (pos[i] - this.lastLP[i]) / dt);
        const k = Math.min(1, dt * 6); // (smoothed: a camera's jitter is not a speed)
        this.lVel = (this.lVel ?? raw).map((v, i) => v + (raw[i] - v) * k);
      }
      if (dt > 1e-3 || !this.lastLP) {
        this.lastLP = pos.slice();
        this.lastLT = t;
      }
      vel = this.lVel ?? [0, 0, 0];
    }
    this.heliVoices?.update(helis, { pos, vel, underwater: !!this.state?.underwater });
  }

  /** The boats heard from where the listener is (its velocity: as updateHelis found it). */
  updateBoats(boats, listener = null) {
    if (!this.running) return;
    const pos = listener?.pos ?? this.state?.listener?.pos;
    this.boatVoices?.update(boats, { pos, vel: listener?.vel ?? this.lVel ?? [0, 0, 0], underwater: !!this.state?.underwater });
  }

  /** The cars heard from where the listener is (its velocity: as updateHelis found it). */
  /**
   * The smithies heard (sim/smithy.js): positional loops for each, the quench's sizzle (the steam
   * the trough's water voxels give off now: its hiss, the crackle of nucleate boiling) and the
   * bellows' whoosh (the air through the tuyere: its jet noise).
   */
  updateSmithies(list, t, setPos) {
    this.smithVoices ??= [];
    list.forEach((S, k) => {
      if (!S?.ready) return;
      let v = this.smithVoices[k];
      if (!v) {
        v = this.smithVoices[k] = {
          sizzle: this.loop([{ type: 'bandpass', frequency: 4000, Q: 0.7 }], true),
          crackle: this.loop([{ type: 'bandpass', frequency: 1800, Q: 1.5 }], true),
          bellows: this.loop([{ type: 'lowpass', frequency: 400, Q: 0.6 }, { type: 'peaking', frequency: 120, Q: 1, gain: 8 }], true),
        };
      }
      const w = S.stations?.trough?.water;
      if (w) {
        setPos(v.sizzle.panner, w);
        setPos(v.crackle.panner, w);
      }
      const q = quenchSizzle(S.water?.steamRate ?? 0, S.blade?.place === 'water' ? S.blade.Tpeak ?? S.blade.T : 20);
      v.sizzle.gain.gain.setTargetAtTime(Math.min(1.2, q.gain), t, 0.08);
      v.sizzle.filters[0].frequency.setTargetAtTime(q.band, t, 0.2);
      v.crackle.gain.gain.setTargetAtTime(Math.min(0.8, q.gain * q.crackle * (0.6 + 0.4 * Math.random())), t, 0.03);
      if (S.bellowsBox) setPos(v.bellows.panner, S.bellowsBox);
      const b = bellowsWhoosh(S.forge?.air ?? 0);
      v.bellows.gain.gain.setTargetAtTime(Math.min(1, b.gain), t, 0.12);
      v.bellows.filters[0].frequency.setTargetAtTime(b.cutoff, t, 0.2);
      v.bellows.filters[1].frequency.setTargetAtTime(b.peak, t, 0.2);
    });
  }

  updateCars(cars, listener = null) {
    if (!this.running) return;
    const pos = listener?.pos ?? this.state?.listener?.pos;
    this.carVoices?.update(cars, { pos, vel: listener?.vel ?? this.lVel ?? [0, 0, 0], underwater: !!this.state?.underwater });
  }

  /** A helicopter's event (ai/helicopter.js): a round through its skin, its blades flying off, its crash. */
  heliEvent(e) {
    if (!this.running) return;
    if (e.type === 'heliHit') {
      this.impact({ pos: e.at ?? e.pos, ...heliHitSound({ damage: e.damage, part: e.zone }) });
    } else if (e.type === 'heliShed') {
      // a blade (or the tail rotor) torn off at speed: the crack, the debris whirring away
      const pl = this.place(e.pos, 1.4, 1.5, { ref: 6 });
      if (!pl) return;
      this.noiseTo(pl.out, pl.t0, 0.25, 'bandpass', 1800, 0.8, 1.2 * pl.gain);
      this.noiseTo(pl.out, pl.t0 + 0.05, 1.3, 'bandpass', 700, 3, 0.5 * pl.gain);
    } else if (e.type === 'heliCrash') {
      // (the blow itself is sim/impact.js's event): the metal grinding, the blades striking the ground
      const C = heliCrashSound({ severity: e.severity, energy: e.energy, omega: e.omega, blades: e.blades });
      const pl = this.place(e.pos, C.gain, C.grind + 0.5, { ref: 6 });
      if (!pl) return;
      this.noiseTo(pl.out, pl.t0, C.grind, 'bandpass', 900, 0.7, 0.6 * pl.gain);
      this.noiseTo(pl.out, pl.t0, C.grind * 0.6, 'lowpass', C.boom * 3, 0.7, 0.8 * pl.gain);
      for (let i = 0; i < C.strikes; i++) this.noiseTo(pl.out, pl.t0 + 0.05 + i * C.interval, 0.09, 'bandpass', 1400 + 300 * Math.random(), 1.2, Math.max(0.1, 0.9 - i * 0.08) * pl.gain);
    }
  }

  /** Heli events from a world's list of its own (the rig stage, which has no update(state)). */
  heliEvents(events) {
    if (!this.running || !events) return;
    if (events !== this.heliEvList || events.length < (this.heliEvSeen ?? 0)) {
      if (events !== this.heliEvList) this.heliEvSeen = events.length;
      else this.heliEvSeen = 0;
      this.heliEvList = events;
    }
    for (; this.heliEvSeen < events.length; this.heliEvSeen++) {
      const e = events[this.heliEvSeen];
      if (e.type === 'heliHit' || e.type === 'heliShed' || e.type === 'heliCrash') this.heliEvent(e);
      else if (e.type === 'impact' && /helicopter|touchdown/.test(e.name ?? '')) this.impact(e);
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

  /**
   * A dragon's foot coming down (footfall weight ~0.5-2 × k²): a foot of ~a quarter of its mass
   * meeting the ground at ~1-2 m/s, as an impact of scales on what is there (soil by default).
   */
  stomp(p, weight = 1, material = 'soil') {
    if (!this.running) return;
    const w = Math.max(0.1, weight);
    const mass = 750 * Math.max(1, w / 2) ** 1.5;
    const speed = 0.8 + 0.7 * Math.min(2, w);
    this.impact({ pos: p, materials: ['scales', material], energy: 0.5 * mass * speed * speed, mass, speed, radius: 0.35, size: 2, sizeA: 0.8 });
  }

  /** A downstroke of the wings: a whoosh of air (audio/physics.js wingBeat: its level, pitch, length; or a level 0..1). */
  whoosh(p, wb = 1) {
    if (!this.running) return;
    const W = typeof wb === 'number' ? { gain: wb, peak: 260, dur: 0.55 } : wb;
    const pl = this.place(p, W.gain, W.dur + 0.1);
    if (!pl) return;
    this.noiseTo(pl.out, pl.t0, W.dur, 'lowpass', W.peak, 0.6, 0.8 * pl.gain);
    this.noiseTo(pl.out, pl.t0 + 0.05, W.dur * 0.65, 'bandpass', W.peak * 2.6, 0.8, 0.18 * pl.gain);
  }

  /**
   * Where a one-shot sound at p goes: a panner (direction only) behind a low-pass and a gain set
   * by propagate() (inverse square, air absorption, the speed of sound, a wall between: state.
   * lineOfSight, under water: state.underwater), into the limiter. Returns { out, t0, gain,
   * dist } or null when it is not worth a voice (too quiet, or the budget is full of louder ones).
   */
  place(p, level = 1, dur = 1, o = {}) {
    if (!this.running) return null;
    const ctx = this.ctx;
    const st = this.state ?? {};
    const lp = st.listener?.pos;
    const d = lp && p ? Math.hypot(p[0] - lp[0], p[1] - lp[1], p[2] - lp[2]) : 3;
    const occluded = !!(lp && p && st.lineOfSight && d > 2 && d < 120 && !st.lineOfSight(lp, p));
    const pr = propagate(d, { ref: o.ref ?? 3, occluded, underwater: !!st.underwater && !o.underwater, bothUnderwater: !!st.underwater && !!o.underwater });
    const gain = level * pr.gain;
    if (gain < 0.004 || !this.budget(gain, dur + pr.delay)) return null;
    const pan = ctx.createPanner();
    pan.panningModel = d < 40 ? 'HRTF' : 'equalpower';
    pan.distanceModel = 'linear';
    pan.rolloffFactor = 0;
    if (pan.positionX && p) {
      pan.positionX.value = p[0];
      pan.positionY.value = p[1];
      pan.positionZ.value = p[2];
    }
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = pr.cutoff;
    lpf.Q.value = 0.5;
    pan.connect(lpf).connect(this.limiter);
    return { out: pan, t0: ctx.currentTime + (o.noDelay ? 0 : pr.delay), gain, dist: d, cutoff: pr.cutoff };
  }

  /** The voice budget: at most MAX_VOICES one-shots at a time; a quiet one is dropped when it is full. */
  budget(gain, dur) {
    const now = this.ctx.currentTime;
    this.voiceEnds = this.voiceEnds.filter((v) => v.end > now);
    if (this.voiceEnds.length >= MAX_VOICES) {
      let q = 0;
      for (let i = 1; i < this.voiceEnds.length; i++) if (this.voiceEnds[i].gain < this.voiceEnds[q].gain) q = i;
      if (this.voiceEnds[q].gain >= gain) return false;
      this.voiceEnds.splice(q, 1);
    }
    this.voiceEnds.push({ end: now + Math.min(dur, 8), gain });
    return true;
  }

  /**
   * An impact (a sim/impact.js event, or the same fields): { pos, materials: [striker, struck],
   * energy (J), mass, speed, radius, size, sizeA, footprint, delay }: synthesised from the physics
   * (audio/physics.js impactSound): modes of both bodies, the contact noise, bubbles, shards, boom.
   */
  impact(e) {
    if (!this.running) return;
    // a smith's hammer (sim/smithy.js): the anvil, the blade at its temperature, the hammer's head
    // (audio/smithSound.js), and the scale spattering off hot steel
    if (e.kind === 'hammer') {
      const S = hammerBlow({ mass: e.mass, speed: e.speed, bare: e.bare, bladeT: e.bladeT ?? e.temps?.[1], anvilT: e.bare ? e.temps?.[1] : undefined, blade: e.blade, radius: e.radius });
      this.strike(S, e.pos, e.delay ?? 0);
      if (S.scale) {
        const pl = this.place(e.pos, S.gain * S.scale.amp, S.scale.spread + 0.05);
        if (pl) for (let n = 0; n < S.scale.n; n++) this.noiseTo(pl.out, pl.t0 + Math.random() * S.scale.spread, 0.012, 'bandpass', S.scale.band * (0.7 + Math.random() * 0.6), 3, 0.6 * pl.gain);
      }
      return S;
    }
    const S = impactSound({ materials: e.materials, energy: (e.dissipated ?? e.energy ?? 1) + 0.1 * (e.energy ?? 0), mass: e.mass, speed: e.speed, radius: e.radius, size: e.size, sizeA: e.sizeA, footprint: e.footprint, temps: e.temps });
    this.strike(S, e.pos, e.delay ?? 0, e.underwater);
    return S;
  }

  /** Modal synthesis of an impactSound() result at p. */
  strike(S, p, delay = 0, underwater = false) {
    const ctx = this.ctx;
    // (a big one is heard from further: its reference distance grows with it)
    const pl = this.place(p, S.gain, S.dur, { ref: S.boom ? 6 : 2, underwater });
    if (!pl) return;
    const t0 = pl.t0 + delay;
    const out = pl.out;
    const G = pl.gain;
    const far = lodFor(pl.dist, S.gain);
    // the ringing modes: decaying sines
    if (far !== 'far' && far !== 'off')
      for (const m of S.partials.slice(0, far === 'mid' ? 3 : 8)) {
        if (m.f > pl.cutoff * 1.5) continue;
        const o = ctx.createOscillator();
        o.frequency.value = m.f * (0.995 + Math.random() * 0.01);
        const g = ctx.createGain();
        const dur = Math.min(6, m.tau * 5);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.5 * G * m.amp), t0 + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g).connect(out);
        o.start(t0);
        o.stop(t0 + dur + 0.05);
      }
    // the contact: a burst as long and as bright as the contact
    this.noiseTo(out, t0, S.noise.dur, 'lowpass', Math.min(S.noise.cutoff, pl.cutoff), 0.7, Math.max(0.001, G * S.noise.amp));
    // a splash: bubbles ringing at their Minnaert frequency, rising as they reach the surface
    if (S.bubbles && far !== 'off')
      for (let n = 0; n < Math.min(far === 'near' ? S.bubbles.n : 4, 20); n++) {
        const tb = t0 + Math.random() * S.bubbles.spread;
        const f = S.bubbles.f * (0.6 + Math.random() * 0.9);
        const o = ctx.createOscillator();
        o.frequency.setValueAtTime(f, tb);
        o.frequency.exponentialRampToValueAtTime(f * 1.6, tb + 0.06);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, tb);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.25 * G), tb + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0001, tb + 0.07);
        o.connect(g).connect(out);
        o.start(tb);
        o.stop(tb + 0.08);
      }
    // glass: the shards, each a small high ringing piece landing
    if (S.shards && far !== 'far' && far !== 'off') {
      this.noiseTo(out, t0, 0.12, 'highpass', 3000, 0.7, G);
      for (let n = 0; n < S.shards.n; n++) {
        const ts = t0 + 0.03 + Math.random() * S.shards.spread;
        const o = ctx.createOscillator();
        o.frequency.value = Math.min(16000, S.shards.f * (0.4 + Math.random() * 1.2));
        const g = ctx.createGain();
        const dur = Math.min(0.4, S.shards.tau * 3);
        g.gain.setValueAtTime(0.0001, ts);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, (0.08 + Math.random() * 0.12) * G), ts + 0.001);
        g.gain.exponentialRampToValueAtTime(0.0001, ts + dur);
        o.connect(g).connect(out);
        o.start(ts);
        o.stop(ts + dur + 0.02);
      }
    }
    // the ground boom of a very big one: felt more than heard
    if (S.boom) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(S.boom.f * 1.4, t0);
      o.frequency.exponentialRampToValueAtTime(Math.max(12, S.boom.f * 0.6), t0 + S.boom.dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.9 * G * S.boom.amp), t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + S.boom.dur);
      o.connect(g).connect(out);
      o.start(t0);
      o.stop(t0 + S.boom.dur + 0.05);
      this.noiseTo(out, t0 + 0.05, S.boom.dur * 1.5, 'lowpass', S.boom.f * 4, 0.7, 0.6 * G * S.boom.amp);
    }
  }

  /** Fuel vapour or hot smoke igniting all at once: a deep whoomp of the gas expanding. */
  whoomp(p, energy = 5e5) {
    const g = gainOf(dbOf(1e-5 * energy), 112, 2);
    const pl = this.place(p, g, 1.5);
    if (!pl) return;
    const f = Math.max(25, 90 * (1e6 / Math.max(1e4, energy)) ** (1 / 3));
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(f * 0.6, pl.t0);
    o.frequency.exponentialRampToValueAtTime(f * 1.3, pl.t0 + 0.25);
    o.frequency.exponentialRampToValueAtTime(f * 0.5, pl.t0 + 1.2);
    const gg = this.ctx.createGain();
    gg.gain.setValueAtTime(0.0001, pl.t0);
    gg.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.8 * pl.gain), pl.t0 + 0.12);
    gg.gain.exponentialRampToValueAtTime(0.0001, pl.t0 + 1.3);
    o.connect(gg).connect(pl.out);
    o.start(pl.t0);
    o.stop(pl.t0 + 1.4);
    this.noiseTo(pl.out, pl.t0, 1.4, 'lowpass', f * 8, 0.6, 0.9 * pl.gain);
  }

  /**
   * The fire, per frame: state.fireSources (sim/fireAudio.js regions) or the one state.fire
   * ({ pos, hrr }); merged into FIRE_VOICES voices by how loud they are here.
   */
  updateFire(state, t, dt, setPos) {
    const lp = state.listener.pos;
    let src = state.fireSources;
    if (!src?.length) src = state.fire && state.fire.hrr > 0 ? [{ pos: state.fire.pos, hrr: state.fire.hrr, count: Math.max(1, state.fire.hrr / 2e4), mats: [{ name: state.fire.material ?? 'wood', count: Math.max(1, state.fire.hrr / 2e4), moisture: 0.12, temp: 700 }], steam: state.fire.steam ?? 0, metal: null, power: fireRoar({ hrr: state.fire.hrr }).power }] : [];
    // a region flaring up between two looks (fuel vapour, hot smoke igniting): the whoomp
    if (state.fireSources && this.fireSeen !== state.fireVersion) {
      const before = this.fireHrr ?? new Map();
      const now = new Map();
      for (const s of src) {
        const key = s.pos.map((v) => Math.round(v / 3)).join(',');
        now.set(key, s.hrr);
        const was = before.get(key) ?? 0;
        if (this.fireSeen !== undefined && s.hrr > 2e5 && s.hrr > 4 * was + 1.5e5) this.whoomp(s.pos, (s.hrr - was) * 0.5);
      }
      this.fireHrr = now;
      this.fireSeen = state.fireVersion;
    }
    const voices = aggregate(src.filter((s) => s.power > 0 || s.steam > 0), lp, FIRE_VOICES);
    const wind = state.wind?.speed ?? 0;
    for (let k = 0; k < FIRE_VOICES; k++) {
      const v = this.fireVoices[k];
      const s = voices[k];
      if (!s) {
        v.gain.gain.setTargetAtTime(0, t, 0.4);
        v.hiss.gain.gain.setTargetAtTime(0, t, 0.3);
        v.lfoDepth.gain.setTargetAtTime(0, t, 0.3);
        continue;
      }
      setPos(v.panner, s.pos);
      const d = Math.hypot(s.pos[0] - lp[0], s.pos[1] - lp[1], s.pos[2] - lp[2]);
      // (whether a wall is between: looked up now and then, not every frame)
      if (state.lineOfSight && (!v.losT || t - v.losT > 0.5)) {
        v.losT = t;
        v.occluded = d > 2 && d < 120 && !state.lineOfSight(lp, s.pos);
      }
      const R = fireRoar({ hrr: s.hrr, diameter: s.diameter, wind });
      const pr = propagate(d, { ref: Math.max(1.5, s.diameter ?? 1), occluded: v.occluded, underwater: state.underwater });
      const lod = lodFor(d, R.gain);
      v.gain.gain.setTargetAtTime(R.gain * pr.gain * 0.9, t, 0.3);
      v.lp.frequency.setTargetAtTime(Math.min(R.cutoff, pr.cutoff), t, 0.3);
      v.pk.frequency.setTargetAtTime(R.peak, t, 0.3);
      v.lfo.frequency.setTargetAtTime(R.flicker * (0.9 + 0.2 * Math.random()), t, 0.5);
      v.lfoDepth.gain.setTargetAtTime(lod === 'off' ? 0 : 0.3, t, 0.5);
      // the crackle: each material its own pulse train
      let hiss = 0;
      let band = 4000;
      if (lod === 'near' || lod === 'mid')
        for (const m of (s.mats ?? []).slice(0, 3)) {
          const C = crackle({ material: m.name, moisture: m.moisture, count: m.count, temp: m.temp });
          hiss = Math.max(hiss, C.hiss);
          v.popAcc += Math.min(lod === 'mid' ? 15 : 60, C.rate) * dt * (0.4 + Math.random() * 1.2);
          while (v.popAcc >= 1) {
            v.popAcc -= 1;
            const at = t + Math.random() * Math.max(dt, 0.016);
            const amp = C.amp * (0.3 + Math.random() * 0.9) * pr.gain * Math.min(1.5, 0.4 + R.gain);
            if (amp < 0.004) continue;
            if (C.kind === 'flutter') this.burst(at, 0.06, 'bandpass', 600 + Math.random() * 600, 0.8, amp * 0.6, v.panner);
            else this.burst(at, 0.004 + Math.random() * 0.02 * Math.sqrt(C.amp), 'bandpass', Math.min(pr.cutoff, C.band * (0.6 + Math.random() * 0.8)), 2, amp, v.panner);
          }
          band = C.band;
        }
      // water on hot surfaces: the steam's hiss; fine fuel's own hiss
      const H = steamHiss(s.steam ?? 0);
      v.hiss.gain.gain.setTargetAtTime((H.gain + hiss * R.gain * 0.5) * pr.gain, t, 0.15);
      v.hissF.frequency.setTargetAtTime(Math.min(pr.cutoff, H.gain > hiss * R.gain ? H.band : band), t, 0.2);
      // metal heating or cooling: ticks and pings at its modes
      if (s.metal && lod === 'near') {
        const T = metalTick({ material: s.metal.material, dTdt: s.metal.dTdt, count: s.metal.count });
        v.tickAcc += T.rate * dt * (0.5 + Math.random());
        while (v.tickAcc >= 1 && T.f.length) {
          v.tickAcc -= 1;
          const at = t + Math.random() * Math.max(dt, 0.016);
          const f = T.f[Math.floor(Math.random() * T.f.length)] * (2 + Math.random() * 4);
          const o = this.ctx.createOscillator();
          o.frequency.value = Math.min(12000, f);
          const g = this.ctx.createGain();
          const dur = Math.min(0.6, T.tau[0]);
          g.gain.setValueAtTime(0.0001, at);
          g.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.05 * pr.gain), at + 0.001);
          g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
          o.connect(g).connect(v.panner);
          o.start(at);
          o.stop(at + dur + 0.02);
        }
      }
    }
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
    // (through walls, under water: muffled; the air takes the highs: propagate())
    const st = this.state ?? {};
    const pr = propagate(d, { occluded: !!(lp && st.lineOfSight && d < 120 && !st.lineOfSight(lp, e.pos)), underwater: !!st.underwater });
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
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = pr.cutoff;
    pan.connect(lpf);
    const att = ctx.createGain();
    att.gain.value = pr.lossDb > 0 ? Math.min(1, pr.gain * d) : 1; // (only the wall / water loss: k has the distance)
    lpf.connect(att).connect(this.boomBus);
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

  /** Ice giving way: a sharp crack running off, the sheet breaking up, the splash. */
  iceBreak(underYou = false, pos = null) {
    if (!this.running) return;
    if (underYou && this.iceBrokeAt && this.ctx.currentTime - this.iceBrokeAt < 0.5) return;
    this.iceBrokeAt = this.ctx.currentTime;
    const t = this.ctx.currentTime;
    const out = pos ? this.at(pos, 5) : this.master;
    this.noiseTo(out, t, 0.08, 'highpass', 3000, 0.7, 0.9);
    for (let n = 0; n < 6; n++) this.noiseTo(out, t + 0.03 + n * 0.04 + Math.random() * 0.03, 0.05, 'bandpass', 2500 + Math.random() * 3000, 4, 0.4);
    this.noiseTo(out, t + 0.15, 0.7, 'lowpass', 700, 0.7, 0.8); // the splash
  }

  /** Ice creaking and cracking under a weight: a twang that runs off through the sheet. */
  iceCreak() {
    if (!this.running) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(1800 + Math.random() * 1200, t);
    o.frequency.exponentialRampToValueAtTime(200 + Math.random() * 200, t + 0.35);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.45);
    this.burst(t, 0.04, 'highpass', 3500, 0.7, 0.25);
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

  /**
   * A shot: the muzzle blast from the cartridge's energy (J: 5.56 mm ~1700, 7.62 ~3500, pistol
   * ~500), the supersonic crack when the round is faster than sound, the report off the walls.
   */
  shot(energy = 1700, velocity = 900) {
    if (!this.running) return;
    const t = this.ctx.currentTime;
    const G = gunshot({ energy, velocity });
    const k = G.gain / 1.6;
    if (G.crack) this.burst(t, 0.05, 'highpass', 2500, 0.7, 1.1 * k);
    this.burst(t, 0.14, 'bandpass', G.cutoff / 2, 1.0, 1.0 * k);
    this.thump(t, 0.5 * k);
    this.burst(t + 0.06, 0.5, 'lowpass', 600, 0.7, 0.3 * k);
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
