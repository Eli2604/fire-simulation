import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modes, contact, impactSound, fireRoar, crackle, propagate, minnaert, steamHiss, metalTick, aggregate, jetEngine, windNoise, gunshot, lodFor } from '../src/audio/physics.js';
import { computeImpact } from '../src/sim/impact.js';
import { FireAudio } from '../src/sim/fireAudio.js';
import { SoundScape } from '../src/audio/sound.js';
import { MAT } from '../src/sim/materials.js';
import { createSimulation } from '../src/sim/createSimulation.js';

const inc = (xs) => xs.every((x, i) => i === 0 || x > xs[i - 1]);

test('impact loudness rises with the force and depends on the materials', () => {
  const db = (v, mats = ['steel', 'steel']) => computeImpact({ mass: 5, velocity: v, materials: mats }).sound.db;
  const vs = [0.5, 1, 2, 4, 8, 16];
  assert.ok(inc(vs.map((v) => db(v))), 'monotonic in the force');
  assert.ok(inc(vs.map((v) => computeImpact({ mass: 5, velocity: v, materials: ['steel', 'steel'] }).sound.gain).slice(0, 4)));
  // dB ~ 10·log10(energy): ×4 the energy (×2 the speed) is +6 dB
  assert.ok(Math.abs(db(4) - db(2) - 10 * Math.log10(4)) < 0.6, `${(db(4) - db(2)).toFixed(2)} dB`);
  assert.notEqual(db(4, ['steel', 'steel']).toFixed(1), db(4, ['flesh', 'soil']).toFixed(1), 'another material pair, another level');
  assert.ok(db(4, ['steel', 'steel']) > db(4, ['flesh', 'soil']), 'steel radiates more of it than flesh on soil');
});

test('steel on steel is brighter and rings longer than flesh on soil', () => {
  const a = impactSound({ materials: ['steel', 'steel'], energy: 50, mass: 1, speed: 5, size: 0.6 });
  const b = impactSound({ materials: ['flesh', 'soil'], energy: 50, mass: 1, speed: 5, size: 0.6 });
  assert.ok(a.contact.cutoff > 20 * b.contact.cutoff, `contact: ${a.contact.cutoff.toFixed(0)} Hz vs ${b.contact.cutoff.toFixed(0)} Hz`);
  assert.ok(a.noise.cutoff > b.noise.cutoff);
  const ring = (s) => Math.max(0, ...s.partials.map((p) => p.tau));
  assert.ok(ring(a) > 1 && ring(b) < 0.05, `rings ${ring(a).toFixed(2)} s vs ${ring(b).toFixed(3)} s`);
  const centroid = (s) => s.partials.reduce((x, p) => x + p.f * p.amp, 0) / Math.max(1e-9, s.partials.reduce((x, p) => x + p.amp, 0));
  assert.ok(!b.partials.length || centroid(a) > centroid(b));
  // wood knocks (shorter than steel), glass shatters, water splashes, a big one booms
  const wd = impactSound({ materials: ['wood', 'wood'], energy: 50, mass: 1, speed: 5, size: 0.6 });
  assert.ok(ring(wd) < ring(a));
  assert.ok(impactSound({ materials: ['steel', 'glass'], energy: 60, mass: 1, speed: 8 }).shards);
  assert.ok(impactSound({ materials: ['flesh', 'water'], energy: 500, mass: 80, speed: 4 }).bubbles);
  assert.ok(impactSound({ materials: ['scales', 'soil'], energy: 6e4, mass: 3000, speed: 6 }).boom);
  assert.equal(impactSound({ materials: ['flesh', 'flesh'], energy: 100, mass: 4, speed: 7 }).boom, null);
});

test('modal frequencies fall with size and rise with stiffness', () => {
  assert.ok(inc([2, 1, 0.5, 0.25].map((L) => modes('steel', L).f1)), 'smaller: higher');
  for (const shape of ['bar', 'plate', 'shell', 'block']) assert.ok(modes('steel', 0.3, shape).f1 > modes('steel', 0.6, shape).f1, shape);
  // stiffer at the same density: higher (soil < wood < stone < steel per √(E/ρ))
  const stiff = (E) => modes({ ...{ E, nu: 0.3, eta: 0.01, density: 2000, shape: 'plate' } }, 0.5).f1;
  assert.ok(inc([1e8, 1e9, 1e10, 1e11].map(stiff)));
  assert.ok(modes('steel', 0.5, 'plate').f1 > modes('wood', 0.5, 'plate').f1);
  // damping: a mode rings τ = 1/(π f η)
  const m = modes('steel', 0.5);
  assert.ok(Math.abs(m.tau[0] - 1 / (Math.PI * m.f[0] * 0.0006)) < 1e-6 || m.tau[0] === 8);
  // Hertz: harder pair, shorter contact
  assert.ok(contact('steel', 'steel').tc < contact('wood', 'wood').tc && contact('wood', 'wood').tc < contact('flesh', 'soil').tc);
  // bubbles (Minnaert): 3.3 kHz at 1 mm
  assert.ok(Math.abs(minnaert(0.001) - 3280) < 60);
});

test('fire: the roar is louder with the heat release and lower with the flame size', () => {
  const Q = [1e3, 1e4, 1e5, 1e6, 1e7];
  assert.ok(inc(Q.map((q) => fireRoar({ hrr: q }).db)), 'level monotonic in the heat release');
  assert.ok(inc(Q.map((q) => -fireRoar({ hrr: q }).peak)), 'bigger fire: lower rumble');
  assert.ok(inc(Q.map((q) => -fireRoar({ hrr: q }).flicker)), 'bigger fire: slower puffing (1.5/√D)');
  assert.ok(fireRoar({ hrr: 1e5, wind: 10 }).db > fireRoar({ hrr: 1e5 }).db, 'wind fans it');
  assert.equal(fireRoar({ hrr: 0 }).gain, 0);
});

test('fire: crackle rises with the fuel moisture up to a point; pine pops more than oak; grass hisses fast', () => {
  const r = (m, material = 'pine') => crackle({ material, moisture: m, count: 40 }).rate;
  assert.ok(inc([0.02, 0.06, 0.12, 0.18].map((m) => r(m))), 'rising with the moisture');
  assert.ok(r(0.6) < r(0.2) && r(1.0) < r(0.6), 'then falling: too wet, it steams and smoulders');
  assert.ok(r(0.12, 'pine') > 2 * r(0.12, 'oak'), 'resin: pine pops more than oak');
  const g = crackle({ material: 'grass', moisture: 0.08, count: 40 });
  const log = crackle({ material: 'oak', moisture: 0.08, count: 40 });
  assert.ok(g.band > log.band && g.amp < log.amp && g.hiss > 0, 'fine fuel: higher, smaller pops and a hiss');
  assert.ok(crackle({ material: 'books', moisture: 0.05, count: 40 }).rate < r(0.05), 'books smoulder quietly');
  assert.ok(crackle({ material: 'pine', moisture: 0.12, count: 400 }).rate > r(0.12), 'more burning, more pops');
  // the steam's hiss and the metal's ticking follow their causes
  assert.ok(inc([0.001, 0.01, 0.1].map((x) => steamHiss(x).db)));
  assert.ok(metalTick({ material: 'aluminium', dTdt: 1 }).rate > metalTick({ material: 'steel', dTdt: 1 }).rate, 'aluminium expands more');
  assert.ok(metalTick({ material: 'steel', dTdt: 2 }).rate > metalTick({ material: 'steel', dTdt: 0.5 }).rate);
});

test('propagation: quieter and duller with distance, late, muffled through walls and water', () => {
  const d = [1, 5, 20, 100, 500, 2000];
  assert.ok(inc(d.map((x) => -propagate(x).gain)), 'inverse square');
  assert.ok(inc(d.slice(1).map((x) => -propagate(x).cutoff)), 'the air takes the highs');
  assert.ok(Math.abs(propagate(343).delay - 1) < 1e-9, 'the speed of sound');
  assert.ok(Math.abs(propagate(20).gain / propagate(40).gain - 2) < 1e-9, '6 dB per doubling');
  assert.ok(propagate(10, { occluded: true }).gain < propagate(10).gain && propagate(10, { occluded: true }).cutoff <= 350);
  assert.ok(propagate(10, { underwater: true }).cutoff <= 450);
  assert.ok(lodFor(5) === 'near' && lodFor(100) === 'far' && lodFor(5000) === 'off');
  // many fires: at most a few voices, the loudest their own, the rest merged (power kept)
  const src = Array.from({ length: 12 }, (_, i) => ({ pos: [i * 10, 0, 0], power: 1 + i, hrr: 1e5 }));
  const v = aggregate(src, [0, 0, 0], 3);
  assert.equal(v.length, 3);
  assert.ok(Math.abs(v.reduce((a, x) => a + x.power, 0) - src.reduce((a, x) => a + x.power, 0)) < 1e-9);
  assert.equal(v.reduce((a, x) => a + x.members, 0), 12);
  // sources: louder jet with more thrust (V⁸), wind with speed, a bigger cartridge
  assert.ok(inc([1e4, 3e4, 6e4, 1e5].map((T) => jetEngine({ thrust: T }).db)));
  assert.ok(inc([1, 5, 10, 20].map((s) => windNoise(s).db)));
  assert.ok(gunshot({ energy: 3500 }).db > gunshot({ energy: 500 }).db);
});

test('the simulation hands the sound its burning regions (sim/fireAudio.js), only when asked', () => {
  const sim = createSimulation({
    world: { size: [4, 2, 4], h: 0.1, ground: 'soil' },
    objects: [{ type: 'woodPile', params: {}, x: 2, z: 2 }],
  });
  sim.ignite([2, 0.3, 2], 0.6);
  for (let i = 0; i < 20; i++) sim.step(0.05);
  assert.equal(sim.fireAudio, undefined, '(off by default: costs nothing)');
  sim.fireAudio = new FireAudio({ every: 0.2 });
  for (let i = 0; i < 60; i++) sim.step(0.05);
  const s = sim.fireAudio.sources;
  assert.ok(sim.stats.hrr > 0, 'burning');
  {
    assert.ok(s.length > 0, 'regions');
    const tot = s.reduce((a, x) => a + x.hrr, 0);
    assert.ok(tot > 0 && s.every((x) => x.pos.every(Number.isFinite) && x.mats.length >= 0));
    assert.ok(s.some((x) => x.mats.length && x.mats[0].name), 'with what burns there');
  }
  void MAT;
});

/** A minimal Web Audio stand-in: every node connects, every param schedules. */
function fakeAudio() {
  const param = (v = 0) => ({ value: v, setValueAtTime() {}, setTargetAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} });
  let made = 0;
  const node = () => {
    made++;
    return {
      connect: (n) => n,
      disconnect() {},
      start() {},
      stop() {},
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
    close() {}
  }
  return { Ctx, made: () => made };
}

test('the SoundScape plays it all from the physics (with a stand-in for Web Audio), within its voice budget', () => {
  const A = fakeAudio();
  globalThis.window = { AudioContext: A.Ctx };
  try {
    const s = new SoundScape();
    s.start();
    const ev = [];
    for (let i = 0; i < 60; i++) ev.push({ type: 'impact', pos: [i * 0.1, 0, 0], energy: 50 + i * 10, materials: ['steel', 'steel'], mass: 2, speed: 5 });
    ev.push({ type: 'impact', pos: [5, 0, 5], energy: 6e4, materials: ['scales', 'soil'], mass: 3000, speed: 6, footprint: 2 });
    ev.push({ type: 'impact', pos: [1, 0, 0], energy: 300, materials: ['flesh', 'water'], mass: 80, speed: 3 });
    ev.push({ type: 'glass', pos: [2, 1, 0] }, { type: 'explosion', pos: [20, 0, 0], energy: 8e5 }, { type: 'decompression', pos: [0, 0, 0] }, { type: 'treeFall', pos: [3, 0, 3] });
    const state = (t) => ({
      listener: { pos: [0, 1.6, 0], forward: [0, 0, -1], up: [0, 1, 0] }, effort: 0, heat: 0, airFraction: 1, events: ev, wind: { speed: 8 }, rain: 4,
      fireSources: [{ pos: [3, 0, 0], hrr: 3e5, count: 60, diameter: 1, mats: [{ name: 'pine', count: 60, moisture: 0.15, temp: 700 }], steam: 0.02, metal: { material: 'steel', dTdt: 8, count: 10 }, power: 1 },
        ...Array.from({ length: 8 }, (_, i) => ({ pos: [40 + i * 5, 0, 0], hrr: 5e4, count: 10, diameter: 0.5, mats: [{ name: 'grass', count: 10, moisture: 0.05, temp: 600 }], steam: 0, metal: null, power: 0.1 }))],
      fireVersion: t,
      lineOfSight: () => true,
    });
    for (let t = 0; t < 5; t++) {
      s.ctx.currentTime = t * 0.05;
      s.update(state(t));
    }
    assert.ok(s.voiceEnds.length <= 28, `voice budget (${s.voiceEnds.length})`);
    assert.ok(A.made() > 100, 'it made sounds');
    s.shot(3500);
    s.stomp([1, 0, 1], 2);
    s.whoosh([0, 3, 0], { gain: 0.5, peak: 200, dur: 0.4 });
    s.stop();
  } finally {
    delete globalThis.window;
  }
});
