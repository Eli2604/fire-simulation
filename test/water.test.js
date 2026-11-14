import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waterOptics, waterColour, effectiveTurbidity, transmit, waterSettings } from '../src/render/waterOptics.js';
import { vortexCurrent, funnelDepth, hoseWind, jetWind, swirlSpeed, hoseCentre, stepStirrers, airStirAt } from '../src/sim/stirrers.js';
import { createSimulation } from '../src/sim/createSimulation.js';
import { defaultWeather, WATER_SETTINGS } from '../src/sim/weather.js';
import { MODELS } from '../src/models/index.js';

test('water absorbs red first: the deeper, the bluer-green', () => {
  const O = waterOptics({ clarity: 0.9 });
  assert.ok(O.absorb[0] > O.absorb[1] && O.absorb[1] > O.absorb[2]);
  const t1 = transmit(1, O.absorb);
  const t10 = transmit(10, O.absorb);
  for (let c = 0; c < 3; c++) assert.ok(t10[c] < t1[c]);
  assert.ok(t10[0] < 0.05 && t10[2] > 0.7, 'red gone at 10 m, blue mostly there');
  // sand under 1.5 m: turquoise (green over red, a fair blue); deep water: dark blue
  const sand = [0.62, 0.55, 0.4];
  const sh = waterColour(1.5, sand, {});
  assert.ok(sh[1] > sh[0] * 1.6 && sh[2] > sh[0], `shallows turquoise ${sh}`);
  const dp = waterColour(200, sand, {});
  assert.ok(dp[2] > dp[1] && dp[1] > dp[0] && dp[2] < 0.3, `deep blue ${dp}`);
  // a dark floor (rock, weed) shows darker in the shallows
  const rock = waterColour(1.5, [0.12, 0.12, 0.1], {});
  assert.ok(rock[1] < sh[1] * 0.5);
});

test('turbidity lowers the visibility and turns the water brown-green; turbulence stirs it up near the shore', () => {
  const clear = waterOptics({ clarity: 0.9, turbidity: 0 });
  assert.ok(clear.visibility > 28 && clear.visibility < 45, `clear sea ~35 m: ${clear.visibility}`);
  const murky = waterOptics({ clarity: 0.9, turbidity: 0.5 });
  assert.ok(murky.visibility < 4, `${murky.visibility}`);
  assert.ok(waterOptics({ turbidity: 1 }).visibility < murky.visibility);
  // brown-green: more red and green against the blue than clear water's deep blue
  assert.ok(murky.deep[0] / murky.deep[2] > (3 * clear.deep[0]) / clear.deep[2]);
  assert.ok(murky.deep[1] >= murky.deep[2] * 0.9);
  // a muddy floor hides at a metre or two
  const sand = [0.62, 0.55, 0.4];
  const m = waterColour(3, sand, { turbidity: 0.6 });
  const c = waterColour(3, sand, { turbidity: 0 });
  assert.ok(Math.abs(m[0] - murky.deep[0]) < Math.abs(c[0] - clear.deep[0]) + 0.2);
  // turbulence: more turbidity, most in the shallows
  assert.equal(effectiveTurbidity(0.1, 0, 1), 0.1);
  assert.ok(effectiveTurbidity(0.1, 1, 0.5) > effectiveTurbidity(0.1, 1, 20));
  assert.ok(effectiveTurbidity(0.1, 1, 20) > 0.1);
  // grease takes a little light
  assert.ok(waterOptics({ grease: 1 }).visibility < clear.visibility);
});

test('both weather panels offer the water settings, with defaults', () => {
  const d = defaultWeather();
  for (const s of WATER_SETTINGS) assert.equal(typeof d[s.key], 'number', s.key);
  assert.deepEqual(waterSettings(d), { clarity: 0.9, turbidity: 0, grease: 0, turbulence: 0 });
});

test('a whirlpool goes round and in, and dies away with the distance', () => {
  const s = { kind: 'vortex', p: [0, 0, 0], radius: 6, strength: 3, depth: 1.5, dir: 1, inflow: 0.3 };
  const at = (r) => vortexCurrent(s, r, 0);
  const [vx, vz] = at(2);
  assert.ok(vx < 0, 'drawn in');
  assert.ok(vz < 0 && Math.abs(vz) > Math.abs(vx), 'mostly round, anticlockwise from above');
  const speed = (r) => Math.hypot(...at(r));
  assert.ok(speed(3) > speed(8) && speed(8) > speed(11));
  assert.equal(speed(13), 0);
  // the other way round
  assert.ok(vortexCurrent({ ...s, dir: -1 }, 2, 0)[1] > 0);
  // the funnel: deepest in the middle, flat at its rim
  assert.ok(Math.abs(funnelDepth(s, 0) - 1.5) < 1e-9);
  assert.ok(funnelDepth(s, 1) > funnelDepth(s, 3));
  assert.equal(funnelDepth(s, 6), 0);
  // Lamb-Oseen: the peak at the core's edge
  assert.ok(Math.abs(swirlSpeed(1, 1, 5) - 5) < 0.01);
  assert.ok(swirlSpeed(0.5, 1, 5) < 5 && swirlSpeed(2, 1, 5) < 5);
});

test('a wind hose turns, rises in its core and draws air in along the ground; a jet blows along its cone', () => {
  const s = { kind: 'hose', p: [0, 0, 0], radius: 2, height: 20, spin: 20, updraft: 8, dir: 1 };
  const v = hoseWind(s, s.p, [2, 1, 0], [0, 0, 0]);
  assert.ok(v[2] < -10, 'round');
  assert.ok(v[0] < 0, 'in along the ground');
  const core = hoseWind(s, s.p, [0.2, 8, 0], [0, 0, 0]);
  assert.ok(core[1] > 6, 'updraft in the core');
  assert.ok(hoseWind(s, s.p, [6, 8, 0], [0, 0, 0])[1] < 0.1, 'none outside');
  const far = hoseWind(s, s.p, [9, 8, 0], [0, 0, 0]);
  assert.ok(Math.hypot(...far) < Math.hypot(...hoseWind(s, s.p, [3, 8, 0], [0, 0, 0])));
  // it travels, turning back at the edges, the same for the same time
  const h = { ...s, p0: [10, 0, 10], travel: 2, heading: 0, radius: 2 };
  assert.deepEqual(hoseCentre(h, 3, [40, 20, 40]), [16, 0, 10]);
  assert.ok(hoseCentre(h, 30, [40, 20, 40])[0] < 40);
  // a jet: along its axis, slower and wider further out, nothing behind it
  const j = { kind: 'jet', p: [0, 1, 0], dir: [1, 0, 0], speed: 12, nozzle: 0.4, spread: 10, range: 12 };
  const a = jetWind(j, [1, 1, 0], [0, 0, 0]);
  const b = jetWind(j, [6, 1, 0], [0, 0, 0]);
  assert.ok(a[0] > b[0] && b[0] > 0);
  assert.equal(jetWind(j, [-3, 1, 0], [0, 0, 0])[0], 0);
  assert.ok(jetWind(j, [6, 1, 0.8], [0, 0, 0])[0] > 0, 'spread');
});

const MEADOW = { world: { size: [16, 12, 16], h: 0.25 }, weather: { ...defaultWeather(), windSpeed: 0 }, noFire: true };

test('a wind hose in the air model: smoke goes round and up with it', () => {
  const run = (hose) => {
    const sim = createSimulation({ ...MEADOW, objects: hose ? [{ type: 'windHose', params: { radius: 1.5, height: 10, spin: 12, updraft: 5, travel: 0 }, x: 8, z: 8 }] : [] });
    sim.noSleep = true;
    const w = sim.world;
    // a puff of smoke beside it, near the ground
    const a = sim.airCellAt(10, 1, 8);
    w.smoke[a] = 1;
    for (let k = 0; k < 4; k++) sim.step(0.05);
    // where it went: its centre of mass
    let m = 0, cx = 0, cy = 0, cz = 0;
    for (let az = 0; az < w.anz; az++)
      for (let ay = 0; ay < w.any; ay++)
        for (let ax = 0; ax < w.anx; ax++) {
          const s = w.smoke[ax + w.anx * (ay + w.any * az)];
          m += s;
          cx += s * (ax + 0.5) * w.ah;
          cy += s * (ay + 0.5) * w.ah;
          cz += s * (az + 0.5) * w.ah;
        }
    return [cx / m, cy / m, cz / m];
  };
  const still = run(false);
  const hose = run(true);
  assert.ok(hose[1] > still[1] + 0.05, `up: ${hose[1]} vs ${still[1]}`);
  // round (anticlockwise from above: from +x it goes to -z) and in
  assert.ok(hose[2] < still[2] - 0.3, `round: ${hose[2]} vs ${still[2]}`);
});

test('things are carried: floating crates round a whirlpool, a light crate up a wind hose, the same each run', () => {
  const sea = (n) => {
    const sim = createSimulation({ ...MEADOW, objects: [{ type: 'waterVortex', params: { radius: 5, strength: 3, flotsam: 4 }, x: 8, z: 8 }] });
    const w = sim.world;
    w.sea = { level: 2, box: [0, 0, 0, 0] };
    for (const o of w.loose) o.p[1] = 2 + o.half * 0.3;
    const r0 = w.loose.map((o) => Math.hypot(o.p[0] - 8, o.p[2] - 8));
    const a0 = w.loose.map((o) => Math.atan2(o.p[2] - 8, o.p[0] - 8));
    for (let k = 0; k < n; k++) {
      stepStirrers(sim, 0.1);
      w.time += 0.1;
    }
    return { w, r0, a0 };
  };
  const { w, r0, a0 } = sea(60);
  assert.equal(w.loose.length, 4);
  w.loose.forEach((o, k) => {
    const r = Math.hypot(o.p[0] - 8, o.p[2] - 8);
    assert.ok(r < r0[k] - 0.2, `drawn in ${r} < ${r0[k]}`);
    const da = Math.atan2(o.p[2] - 8, o.p[0] - 8) - a0[k];
    assert.ok(Math.abs(Math.sin(da)) > 0.05 || Math.cos(da) < 0.9, 'carried round');
    assert.ok(o.p[1] < 2 + o.half * 0.3 + 1e-9, 'down into the funnel');
  });
  assert.deepEqual(sea(60).w.loose.map((o) => o.p), w.loose.map((o) => o.p), 'deterministic');

  const sim = createSimulation({ ...MEADOW, objects: [{ type: 'windHose', params: { radius: 1.5, height: 12, spin: 25, updraft: 14, travel: 0, debris: 3 }, x: 8, z: 8 }] });
  const W = sim.world;
  assert.equal(W.loose.length, 3);
  let top = 0;
  const start = W.loose.map((o) => o.p.slice());
  for (let k = 0; k < 40; k++) {
    stepStirrers(sim, 0.05);
    W.time += 0.05;
    for (const o of W.loose) top = Math.max(top, o.p[1]);
  }
  assert.ok(top > 0.65, `lifted: ${top}`);
  assert.ok(W.loose.some((o, k) => Math.hypot(o.p[0] - start[k][0], o.p[2] - start[k][2]) > 1), 'whirled away');
  assert.ok(Math.hypot(...airStirAt(W, [9.5, 1, 8])) > 5);
});

test('the water vortex, wind hose and wind jet are objects you can place', () => {
  for (const k of ['waterVortex', 'windHose', 'windJet']) {
    assert.ok(MODELS[k]?.label, k);
    const sim = createSimulation({ ...MEADOW, objects: [{ type: k, params: {}, x: 8, z: 8 }] });
    assert.equal(sim.world.stirrers.length, 1, k);
    sim.step(0.1);
  }
});
