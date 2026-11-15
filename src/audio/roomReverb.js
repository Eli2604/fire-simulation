/**
 * The room's reverb and echoes in Web Audio, from the acoustic probe of the voxel world around
 * the listener (audio/acoustics.js: the pure part, tested in node).
 *
 *   everything (the master bus) ──► send (mono) ──► convolver A ─► gain A ─┐
 *   one-shots by distance (place) ──┘          ├─► convolver B ─► gain B ─┼─► wet ──► output
 *                                              └─► delay ► low-pass ► gain ► pan (per echo) ┘
 *
 * The impulse response is made procedurally (impulseResponse: band-filtered noise decaying at the
 * space's RT60 per band, the early reflections as taps panned to where their walls are), spread
 * over a few frames, and crossfaded A↔B when the space changes (deck → corridor, the church, the
 * catacombs). Large distant reflectors in the open (a cliff, a ship's hull, a big wall) each get
 * a delay line: a discrete echo at 2d/c. Sounds behind walls: occlusion() (mass law, diffraction).
 *
 * Only built with a live AudioContext (never in node); settings: enabled, amount, occlusion.
 */
import { AcousticProbe, spaceParams, impulseResponseSteps, occlusion, sendLevel, describeSpace } from './acoustics.js';

const ECHOES = 3;
const FADE = 0.6; // s, IR crossfade

export class RoomAcoustics {
  /** ctx: the AudioContext; out: where the wet signal goes. */
  constructor(ctx, out, settings = {}) {
    this.ctx = ctx;
    this.settings = { enabled: true, amount: 1, occlusion: true, ...settings };
    this.input = ctx.createGain();
    this.input.channelCount = 1;
    this.input.channelCountMode = 'explicit';
    this.input.channelInterpretation = 'speakers';
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;
    this.wet.connect(out);
    this.conv = [0, 1].map(() => {
      const c = ctx.createConvolver();
      c.normalize = false;
      const g = ctx.createGain();
      g.gain.value = 0;
      this.input.connect(c);
      c.connect(g).connect(this.wet);
      return { c, g };
    });
    this.active = -1;
    this.echoes = [];
    for (let k = 0; k < ECHOES; k++) {
      const delay = ctx.createDelay(1.5);
      delay.delayTime.value = 0.1;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 6000;
      lp.Q.value = 0.5;
      const g = ctx.createGain();
      g.gain.value = 0;
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      this.input.connect(delay);
      delay.connect(lp).connect(g);
      if (pan) g.connect(pan).connect(this.wet);
      else g.connect(this.wet);
      this.echoes.push({ delay, lp, g, pan, cur: null });
    }
    this.probe = new AcousticProbe({ perFrame: 8 });
    this.params = null;
    this.irParams = null;
    this.irRight = null;
    this.gen = null;
    this.lastSwap = -10;
    this.world = null;
    this.right = [1, 0, 0];
    this.seed = 1;
  }

  /** Change the settings ({ enabled, amount, occlusion }). */
  set(s) {
    Object.assign(this.settings, s);
  }

  /** Per frame: probe a little more, build the next IR a step further, steer the echoes. */
  update(world, listener, underwater = false) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const on = this.settings.enabled && !!world?.mat && !underwater && !world.vacuum;
    this.wet.gain.setTargetAtTime(on ? Math.max(0, this.settings.amount) : 0, t, 0.15);
    if (world !== this.world) {
      this.world = world;
      this.probe.reset();
    }
    if (!on || !listener?.pos) return;
    const f = listener.forward ?? [0, 0, -1], u = listener.up ?? [0, 1, 0];
    const r = [f[1] * u[2] - f[2] * u[1], f[2] * u[0] - f[0] * u[2], f[0] * u[1] - f[1] * u[0]];
    const rl = Math.hypot(r[0], r[1], r[2]) || 1;
    this.right = [r[0] / rl, r[1] / rl, r[2] / rl];
    const sum = this.probe.step(world, listener.pos);
    if (sum) {
      this.params = spaceParams(sum);
      this.steerEchoes(t);
    }
    for (const e of this.echoes) if (e.pan && e.cur) e.pan.pan.setTargetAtTime(this.panOf(e.cur.dir), t, 0.1);
    // the impulse response: a step of the one being made, or start one when the space changed
    if (this.gen) {
      const s = this.gen.next();
      if (s.done) {
        this.gen = null;
        this.swap(s.value);
      }
    } else if (this.params && t - this.lastSwap > FADE + 0.2 && this.changed()) {
      this.irParams = this.params;
      this.irRight = this.right.slice();
      const P = this.params;
      const early = P.early.map((e) => ({ delay: e.delay, gain: e.gain, pan: this.panOf(e.dir) * 0.8 }));
      this.gen = impulseResponseSteps({ rt60: P.rt60, predelay: P.predelay, early, diffusion: P.diffusion, wet: P.wet, maxLength: 5 }, ctx.sampleRate, this.seed++);
    }
  }

  panOf(dir) {
    const R = this.right;
    return Math.max(-1, Math.min(1, dir[0] * R[0] + dir[1] * R[1] + dir[2] * R[2]));
  }

  /** Has the space (or the way the listener faces, for the early reflections' pans) changed enough? */
  changed() {
    const A = this.irParams, B = this.params;
    if (!A) return true;
    const rel = (a, b) => Math.abs(a - b) / Math.max(0.05, Math.abs(a), Math.abs(b));
    if (rel(A.rtMid, B.rtMid) > 0.15 || rel(A.rt60[0], B.rt60[0]) > 0.2 || rel(A.rt60[3], B.rt60[3]) > 0.25) return true;
    if (Math.abs(Math.sqrt(A.wet) - Math.sqrt(B.wet)) > 0.12) return true;
    if (Math.abs(A.predelay - B.predelay) > 0.008) return true;
    const turn = this.irRight[0] * this.right[0] + this.irRight[1] * this.right[1] + this.irRight[2] * this.right[2];
    return turn < 0.8 && B.early.length > 0 && B.wet > 0.05;
  }

  /** Load the new IR into the idle convolver and crossfade to it. */
  swap(ir) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const buf = ctx.createBuffer(2, ir.length, ir.sampleRate);
    if (buf.copyToChannel) {
      buf.copyToChannel(ir.left, 0);
      buf.copyToChannel(ir.right, 1);
    } else {
      buf.getChannelData(0).set(ir.left);
      buf.getChannelData(1).set(ir.right);
    }
    const next = this.active === 0 ? 1 : 0;
    const A = this.conv[next];
    A.c.buffer = buf;
    A.g.gain.cancelScheduledValues(t);
    A.g.gain.setValueAtTime(A.g.gain.value, t);
    A.g.gain.linearRampToValueAtTime(1, t + FADE);
    if (this.active >= 0) {
      const B = this.conv[this.active].g.gain;
      B.cancelScheduledValues(t);
      B.setValueAtTime(B.value, t);
      B.linearRampToValueAtTime(0, t + FADE);
    }
    this.active = next;
    this.lastSwap = t;
  }

  /** One delay line per strong distant reflector (the echoes); a jump fades out, moves, fades in. */
  steerEchoes(t) {
    const list = this.params?.echoes ?? [];
    for (let k = 0; k < this.echoes.length; k++) {
      const E = this.echoes[k];
      const e = list[k];
      if (!e) {
        E.g.gain.setTargetAtTime(0, t, 0.1);
        E.cur = null;
        continue;
      }
      if (!E.cur || Math.abs(E.cur.delay - e.delay) > 0.03) {
        E.g.gain.setTargetAtTime(0, t, 0.03);
        E.delay.delayTime.setValueAtTime(e.delay, t + 0.15);
        E.g.gain.setTargetAtTime(e.gain, t + 0.16, 0.1);
      } else {
        // a small change: glide (moving relative to the wall: its own Doppler)
        E.delay.delayTime.setTargetAtTime(e.delay, t, 0.2);
        E.g.gain.setTargetAtTime(e.gain, t, 0.2);
      }
      E.lp.frequency.setTargetAtTime(e.cutoff, t, 0.2);
      E.cur = e;
    }
  }

  /**
   * For a one-shot at p heard at lp (d m): how much a wall between takes ({ gain, cutoff }), or
   * null when not measured (occlusion off, no world).
   */
  occlusion(lp, p, d) {
    if (!this.settings.occlusion || !this.world?.mat || !lp || !p || d < 1 || d > 150) return null;
    return occlusion(this.world, lp, p);
  }

  /** Send a positioned one-shot (`node`) to the reverb, more the further away it is (d m). */
  send(node, d) {
    if (!this.settings.enabled || !this.params) return;
    const extra = sendLevel(d) - 1; // (the master bus already sends it once)
    if (extra <= 0.05) return;
    const g = this.ctx.createGain();
    g.gain.value = extra;
    node.connect(g).connect(this.input);
  }

  /** A line on the measured space (the Sound menu). */
  info() {
    if (!this.settings.enabled) return 'reverb off';
    return describeSpace(this.params);
  }
}
