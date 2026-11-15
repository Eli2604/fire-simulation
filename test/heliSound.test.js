import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heliSoundParams, heliLoad, bladeSlap, doppler, heliCrashSound, heliHitSound, V_INDUCED, TIP_SPEED } from '../src/audio/heliSound.js';
import { Helicopter, HELI } from '../src/ai/helicopter.js';
import { SoundScape } from '../src/audio/sound.js';
import { C_AIR } from '../src/audio/physics.js';

/** A helicopter in a bare world (ground at 0). */
function heli(o = {}) {
  const world = { time: 0, events: [], noises: [], enemies: [], ropes: [] };
  const h = new Helicopter({ p: [0, 0, 0], lz: [0, 0, 0], seed: 3, ...o }, { world, sim: { world }, addCrew: (e) => world.enemies.push(e) });
  const run = (s, dt = 0.05) => {
    for (let t = 0; t < s; t += dt) {
      world.time += dt;
      h.step(dt);
    }
  };
  return { h, world, run };
}
/** The same helicopter in another state (a plain copy of what heliSoundParams reads). */
const like = (h, o) => Object.assign(Object.create(Object.getPrototypeOf(h)), h, o);
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const L = { pos: [30, 3, 0], vel: [0, 0, 0] };

test('main rotor: rpm from its speed, blade passage frequency = rpm / 60 × blades', () => {
  const { h } = heli({ mission: 'hover', altitude: 20 });
  const P = heliSoundParams(h, L);
  assert.ok(near(P.rpm, HELI.rotorRev * 60, 1e-9), `${P.rpm} rpm`);
  assert.ok(near(P.bpf0, (P.rpm / 60) * HELI.blades, 1e-9), `${P.bpf0.toFixed(2)} Hz`);
  assert.ok(near(P.bpf0, 17.2, 0.05), 'a 4-blade rotor at 258 rpm thuds at ~17 Hz');
  // the autorotation's rotor speed: lower
  assert.ok(heliSoundParams(like(h, { omega: 0.92, failure: 'engine' }), L).bpf0 < P.bpf0);
  // the blades gone: no rotor sound at all
  const noBlades = heliSoundParams(like(h, { blades: 0 }), L);
  assert.equal(noBlades.rotorGain, 0);
  assert.equal(noBlades.slap, 0);
});

test('spin-up on the ground: the blade passage frequency and the rotor level rise with the rotor; the turbine runs first', () => {
  const { h, run } = heli({ airborne: false, mission: 'land' });
  const bpf = [], gain = [];
  for (let i = 0; i < 6; i++) {
    run(1.2);
    const P = heliSoundParams(h, L);
    bpf.push(P.bpf0);
    gain.push(P.rotorGain);
    assert.ok(P.engineOn && P.turbineGain > 0, 'the engines are running as it spins up');
  }
  assert.ok(bpf.every((x, i) => i === 0 || x > bpf[i - 1]), `bpf ${bpf.map((x) => x.toFixed(1))}`);
  assert.ok(gain.every((x, i) => i === 0 || x >= gain[i - 1]), `level ${gain.map((x) => x.toFixed(2))}`);
  // parked and still: silence
  const { h: parked } = heli({ airborne: false, autoStart: false });
  const Q = heliSoundParams(parked, L);
  assert.equal(Q.rotorGain + Q.tailGain + Q.turbineGain, 0);
});

test('tail rotor: its own, higher frequency; gone when the tail rotor is shot off', () => {
  const { h } = heli({ mission: 'hover' });
  const P = heliSoundParams(h, L);
  assert.ok(near(P.tailBpf0, HELI.tailRev * 4, 1e-9) && P.tailBpf0 > 4 * P.bpf0, `${P.tailBpf0.toFixed(1)} Hz vs ${P.bpf0.toFixed(1)} Hz`);
  assert.ok(P.tailGain > 0);
  h.hit('tailRotor', 400);
  assert.ok(h.gone.has('tailRotor'));
  const Q = heliSoundParams(h, L);
  assert.equal(Q.tailGain, 0);
  assert.equal(Q.tailBpf0, 0);
  assert.ok(Q.rotorGain > 0, 'the main rotor still turning');
});

test('blade slap grows with the collective (load), a tight turn, and a descent into its own wake', () => {
  const { h } = heli({ mission: 'hover' });
  h.board();
  const at = (o) => heliSoundParams(like(h, { v: [0, 0, 20], ...o }), L);
  const col = [-0.5, 0, 0.5, 1].map((c) => at({ controls: { collective: c, pitch: 0, roll: 0, pedal: 0 } }));
  assert.ok(col.every((P, i) => i === 0 || P.load > col[i - 1].load), 'more collective, more thrust');
  assert.ok(col[3].slap > col[1].slap + 0.3, `full collective slaps (${col[1].slap.toFixed(2)} → ${col[3].slap.toFixed(2)})`);
  // the AI's own pilot: a steep bank (a tight turn) loads the disc
  const { h: ai } = heli({ mission: 'hover' });
  const level = heliSoundParams(like(ai, { v: [0, 0, 25], roll: 0 }), L);
  const turn = heliSoundParams(like(ai, { v: [0, 0, 25], roll: 0.9 }), L);
  assert.ok(turn.load > 1.4 * level.load && turn.slap > level.slap + 0.3, `turn: load ${level.load.toFixed(2)} → ${turn.load.toFixed(2)}, slap ${level.slap.toFixed(2)} → ${turn.slap.toFixed(2)}`);
  // the approach: sinking ~3.5 m/s at ~20 m/s into its own tip vortices (BVI) vs level at the same speed
  const bvi = bladeSlap(like(ai, { v: [0, -3.5, 20] }));
  assert.ok(bvi.bvi > 0.8 && bvi.slap > level.slap + 0.5, `BVI ${bvi.bvi.toFixed(2)}`);
  // the vortex ring: slow and sinking at ~half the induced velocity
  const vrs = bladeSlap(like(ai, { v: [0, -0.55 * V_INDUCED, 2] }));
  assert.ok(vrs.vrs > 0.8, `vortex ring ${vrs.vrs.toFixed(2)} (vi ${V_INDUCED.toFixed(1)} m/s)`);
  // fast: the advancing tip's Mach number
  assert.ok(near(TIP_SPEED, 216, 1));
  assert.ok(bladeSlap(like(ai, { v: [0, 0, 80] })).hsi > bladeSlap(like(ai, { v: [0, 0, 30] })).hsi);
  // the slap is a crack: brighter, louder with it
  assert.ok(turn.slapGain > level.slapGain && turn.thumpCutoff > level.thumpCutoff);
});

test('turbine: power from the load; a dead engine is silent (the rotor still turning in autorotation)', () => {
  const { h } = heli({ mission: 'hover' });
  h.board();
  const lo = heliSoundParams(like(h, { controls: { collective: -1 } }), L);
  const hi = heliSoundParams(like(h, { controls: { collective: 1 } }), L);
  assert.ok(hi.power > lo.power && hi.turbineHz0 > lo.turbineHz0 && hi.turbineGain > lo.turbineGain);
  const { h: e } = heli({ mission: 'hover' });
  e.hit('engine', 1000);
  assert.equal(e.failure, 'engine');
  const P = heliSoundParams(e, L);
  assert.equal(P.engineOn, false);
  assert.equal(P.turbineGain, 0);
  assert.ok(P.rotorGain > 0, 'the rotor windmilling');
  // damaged but running: rough (grit)
  const { h: d } = heli({ mission: 'hover' });
  d.hit('engine', 40);
  assert.ok(heliSoundParams(d, L).grit > 0);
  // a rotor hit: the 1/rev beat
  const { h: r } = heli({ mission: 'hover' });
  r.hit('rotor', 300);
  assert.ok(heliSoundParams(r, L).imbalance > 0);
});

test('to the listener: quieter and duller with distance; the Doppler shift from the two velocities', () => {
  const { h } = heli({ mission: 'hover' });
  const at = (d) => heliSoundParams(like(h, { v: [0, 0, 0] }), { pos: [h.p[0] + d, h.p[1] + 3, h.p[2]], vel: [0, 0, 0] });
  const ds = [5, 20, 100, 500, 2000].map(at);
  assert.ok(ds.every((P, i) => i === 0 || (P.level < ds[i - 1].level && P.cutoff <= ds[i - 1].cutoff)));
  assert.ok(near(ds[2].level / ds[3].level, 5, 0.01), 'inverse square: ×5 the distance, a fifth of the amplitude');
  // the Doppler factor: f (c − vl·u) / (c − vs·u), u from the source to you
  assert.ok(near(doppler([40, 0, 0], [0, 0, 0], [1, 0, 0]), C_AIR / (C_AIR - 40), 1e-9));
  const v = 45;
  const towards = heliSoundParams(like(h, { v: [v, 0, 0] }), { pos: [h.p[0] + 200, h.p[1] + 3, h.p[2]], vel: [0, 0, 0] });
  const away = heliSoundParams(like(h, { v: [-v, 0, 0] }), { pos: [h.p[0] + 200, h.p[1] + 3, h.p[2]], vel: [0, 0, 0] });
  const across = heliSoundParams(like(h, { v: [0, 0, v] }), { pos: [h.p[0] + 200, h.p[1] + 3, h.p[2]], vel: [0, 0, 0] });
  assert.ok(towards.doppler > 1.1 && away.doppler < 0.9 && near(across.doppler, 1, 1e-9), `${towards.doppler.toFixed(3)} / ${away.doppler.toFixed(3)} / ${across.doppler}`);
  assert.ok(near(towards.bpf, towards.bpf0 * towards.doppler, 1e-9) && near(towards.tailBpf, towards.tailBpf0 * towards.doppler, 1e-9));
  // you moving with it: no shift
  const together = heliSoundParams(like(h, { v: [v, 0, 0] }), { pos: [h.p[0] + 20, h.p[1] + 3, h.p[2]], vel: [v, 0, 0] });
  assert.ok(near(together.doppler, 1, 1e-9));
});

test('crash and hit sounds: louder for a harder crash; the blades strike the ground at their passage rate', () => {
  const hard = heliCrashSound({ severity: 'hard', energy: 5e4 });
  const bad = heliCrashSound({ severity: 'destroyed', energy: 2e6, omega: 1, blades: 4 });
  assert.ok(bad.gain > hard.gain && bad.grind > hard.grind && bad.boom < hard.boom);
  assert.equal(hard.strikes, 0, 'a hard landing on the skids: the blades clear the ground');
  assert.ok(bad.strikes >= 4 && near(bad.interval, 1 / (HELI.rotorRev * 4), 1e-9));
  assert.equal(heliCrashSound({ severity: 'crash', omega: 0.1 }).strikes, 0, 'the rotor already stopped');
  assert.equal(heliHitSound({ part: 'cockpit' }).materials[1], 'glass');
  assert.ok(heliHitSound({ damage: 350 }).energy > heliHitSound({ damage: 25 }).energy);
  // a real crash carries the rotor's state for its sound
  const { h, world, run } = heli({ mission: 'hover', altitude: 30 });
  h.hit('rotor', 2000);
  run(15);
  const ev = world.events.find((e) => e.type === 'heliCrash');
  assert.ok(ev && 'omega' in ev && 'blades' in ev);
  assert.ok(world.events.some((e) => e.type === 'heliHit' && Array.isArray(e.at)), 'a hit says where');
});

test('no AudioContext in Node: the SoundScape takes helicopters without one (a no-op until started)', () => {
  const s = new SoundScape();
  const { h } = heli({ mission: 'hover' });
  assert.doesNotThrow(() => s.updateHelis([h], { pos: [0, 0, 0] }));
  assert.doesNotThrow(() => s.heliEvent({ type: 'heliCrash', pos: [0, 0, 0] }));
  assert.doesNotThrow(() => s.heliEvents([{ type: 'heliHit', pos: [0, 0, 0] }]));
  assert.doesNotThrow(() => s.update({ listener: { pos: [0, 0, 0] }, helis: [h] }));
  assert.equal(heliLoad(like(h, { crashed: true })), 0);
});

/** A stand-in for Web Audio (as test/soundphysics.test.js): each param remembers the last value it was sent to. */
function fakeAudio() {
  const param = (v = 0) => ({ value: v, last: v, setValueAtTime(x) { this.last = x; }, setTargetAtTime(x) { this.last = x; }, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} });
  let made = 0;
  const node = () => {
    made++;
    return {
      connect: (n) => n, disconnect() {}, start() {}, stop() { this.stopped = true; }, setPeriodicWave(w) { this.wave = w; },
      gain: param(1), frequency: param(440), Q: param(1), playbackRate: param(1), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(),
      positionX: param(), positionY: param(), positionZ: param(),
      set buffer(b) {}, loop: false, loopStart: 0,
      getChannelData: () => new Float32Array(8),
    };
  };
  class Ctx {
    constructor() {
      this.currentTime = 0;
      this.sampleRate = 4;
      this.destination = node();
      this.listener = { positionX: param(), positionY: param(), positionZ: param(), forwardX: param(), forwardY: param(), forwardZ: param(), upX: param(), upY: param(), upZ: param() };
    }
    createGain() { return node(); }
    createBiquadFilter() { return node(); }
    createOscillator() { return node(); }
    createBufferSource() { return node(); }
    createPanner() { return node(); }
    createDynamicsCompressor() { return node(); }
    createBuffer() { return node(); }
    createPeriodicWave(re, im) { return { re, im }; }
    close() {}
  }
  return { Ctx, made: () => made };
}

test('the voices (a stand-in for Web Audio): the rotor\'s pulse train at the Doppler-shifted blade passage, the tail rotor silent once gone, at most 3 voices', () => {
  const A = fakeAudio();
  globalThis.window = { AudioContext: A.Ctx };
  try {
    const s = new SoundScape();
    s.start();
    const { h } = heli({ mission: 'hover' });
    const listener = { pos: [h.p[0] + 50, h.p[1] + 3, h.p[2]], vel: [0, 0, 0] };
    s.updateHelis([h], listener);
    const V = s.heliVoices.voices.get(h);
    assert.ok(V, 'a voice for it');
    const P = heliSoundParams(h, listener);
    assert.ok(near(V.pulse.frequency.last, P.bpf, 1e-9), `pulse ${V.pulse.frequency.last.toFixed(2)} Hz`);
    assert.ok(V.pulse.wave, 'a pulse wave');
    assert.ok(V.tailG.gain.last > 0);
    h.hit('tailRotor', 400);
    s.updateHelis([h], listener);
    assert.equal(V.tailG.gain.last, 0, 'no tail rotor, no buzz');
    // its own events: a hit, the blades off, the crash
    s.state = { listener: { pos: listener.pos } };
    assert.doesNotThrow(() => s.heliEvents([]));
    const ev = [{ type: 'heliHit', pos: h.p, at: h.p, damage: 25, zone: 'cockpit' }, { type: 'heliShed', pos: h.p }, { type: 'heliCrash', pos: h.p, severity: 'crash', energy: 3e5, omega: 1, blades: 4 }];
    const before = A.made();
    for (const e of ev) s.heliEvent(e);
    assert.ok(A.made() > before + 5, 'they made sounds');
    // five helicopters: the three loudest heard
    const many = [0, 1, 2, 3, 4].map((i) => heli({ mission: 'hover', p: [i * 300, 0, 0], lz: [i * 300, 0, 0] }).h);
    s.updateHelis(many, { pos: [0, 0, 0], vel: [0, 0, 0] });
    assert.ok(s.heliVoices.voices.size <= 4 && many.slice(0, 3).every((x) => s.heliVoices.voices.has(x)) && !s.heliVoices.voices.has(many[4]));
    s.heliVoices.clear();
    s.stop();
  } finally {
    delete globalThis.window;
  }
});
