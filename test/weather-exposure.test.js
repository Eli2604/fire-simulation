import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultWeather, exposureOf, liveWeather, WeatherDrift } from '../src/sim/weather.js';
import { SCENARIOS } from '../src/scenarios.js';

test('places get the exposure their flags say', () => {
  assert.equal(exposureOf(SCENARIOS.hallway), 'indoor');
  assert.equal(exposureOf(SCENARIOS.carrier.zones.catacombs), 'underground');
  assert.equal(exposureOf(SCENARIOS.carrier.zones.spaceship), 'sealed');
  assert.equal(exposureOf(SCENARIOS.carrier.zones.below), 'indoor');
  assert.equal(exposureOf(SCENARIOS.carrier.zones.deck), 'outdoor');
  assert.equal(exposureOf({ exposure: 'underground' }), 'underground');
});

test('no weather where there is none: only the air', () => {
  const set = { ...defaultWeather(), ambient: 12, humidity: 0.85, windSpeed: 9, rain: 20, lightning: 3, fog: 0.5, snowCover: 0.3 };
  const w = liveWeather({}, set, 'underground');
  assert.equal(w.ambient, 12);
  assert.equal(w.humidity, 0.85);
  for (const k of ['windSpeed', 'rain', 'lightning', 'fog', 'snowCover', 'sunshine']) assert.equal(w[k], 0, k);
  // outdoors as set
  assert.equal(liveWeather({}, set, 'outdoor').windSpeed, 9);
});

test('the weather drifts around what is set, the same way for the same seed', () => {
  const base = { ...defaultWeather(), windSpeed: 8, windDir: 90, ambient: 15, vary: 'changeable' };
  const run = () => {
    const d = new WeatherDrift(3);
    const seen = { wind: [], dir: [], rain: 0 };
    for (let t = 0; t < 3600; t += 1) {
      d.step(1, base.vary);
      const w = d.apply(base, {}, base.vary);
      seen.wind.push(w.windSpeed);
      seen.dir.push(w.windDir);
      if (w.rain > 0) seen.rain++;
      assert.ok(w.windSpeed >= 0);
    }
    return seen;
  };
  const a = run();
  assert.deepEqual(a, run());
  const mean = a.wind.reduce((s, v) => s + v, 0) / a.wind.length;
  assert.ok(mean > 6 && mean < 11, `mean wind ${mean}`);
  assert.ok(Math.max(...a.wind) - Math.min(...a.wind) > 4, 'gusts');
  assert.ok(a.rain > 0, 'a shower in an hour of changeable weather');
  // fixed: exactly as set
  const d = new WeatherDrift(3);
  d.step(100, 'fixed');
  assert.equal(d.apply(base, {}, 'fixed').windSpeed, 8);
});
