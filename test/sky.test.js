import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sunPosition, moonPosition, sunTimes, irradiance, clockAt, clockFor, dayOfDate, dayOf, seasonOfDay, dateLabel, hhmm, direction, toAzEl, SEASON_DAY } from '../src/sim/sky.js';
import { defaultWeather, deriveWeather, liveWeather, WeatherDrift, diurnal } from '../src/sim/weather.js';

const RAD = Math.PI / 180;
const LONDON = { latitude: 51.5074, longitude: -0.1278, utcOffset: 0, year: 2024 };
const at = (place, y, m, d, time) => ({ ...place, year: y, day: dayOfDate(y, m, d), time });

/**
 * An independent reference: NOAA's solar calculator (Meeus: the sun's apparent longitude, the
 * obliquity, the equation of time; ~0.01°), true elevation. Its own Julian date (Date.UTC).
 */
function noaa({ latitude, longitude, utcOffset, year, day, time }) {
  const jd = (Date.UTC(year, 0, day) + (time - utcOffset) * 3600e3) / 86400e3 + 2440587.5;
  const T = (jd - 2451545) / 36525;
  const d2r = (x) => x * RAD;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(d2r(M)) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(d2r(2 * M)) * (0.019993 - 0.000101 * T) + Math.sin(d2r(3 * M)) * 0.000289;
  const om = 125.04 - 1934.136 * T;
  const app = L0 + C - 0.00569 - 0.00478 * Math.sin(d2r(om));
  const eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(d2r(om));
  const dec = Math.asin(Math.sin(d2r(eps)) * Math.sin(d2r(app)));
  const y = Math.tan(d2r(eps / 2)) ** 2;
  const eot = (4 / RAD) * (y * Math.sin(2 * d2r(L0)) - 2 * e * Math.sin(d2r(M)) + 4 * e * y * Math.sin(d2r(M)) * Math.cos(2 * d2r(L0)) - 0.5 * y * y * Math.sin(4 * d2r(L0)) - 1.25 * e * e * Math.sin(2 * d2r(M)));
  return finish(latitude, dec, time * 60 + eot + 4 * longitude - 60 * utcOffset);
}
function finish(latitude, dec, tst) {
  const ha = (tst / 4 - 180) * RAD;
  const lat = latitude * RAD;
  const cz = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha);
  const el = 90 - Math.acos(cz) / RAD;
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat)) / RAD + 180;
  return { elevation: el, azimuth: ((az % 360) + 360) % 360, declination: dec / RAD };
}

test('the sun stands where the reference puts it (within 0.5°)', () => {
  const places = [LONDON, { latitude: 40.7, longitude: -74, utcOffset: -5 }, { latitude: -33.9, longitude: 151.2, utcOffset: 10 }, { latitude: 64.1, longitude: -21.9, utcOffset: 0 }];
  for (const p of places)
    for (const [m, d] of [[1, 15], [3, 20], [6, 21], [9, 23], [11, 14]])
      for (const time of [6, 9, 12, 15, 18]) {
        const W = at(p, 2024, m, d, time);
        const s = sunPosition(W);
        const r = noaa(W);
        if (r.elevation < -5) continue;
        assert.ok(Math.abs(s.trueElevation - r.elevation) < 0.5, `elevation ${s.trueElevation.toFixed(2)} vs ${r.elevation.toFixed(2)} at ${p.latitude}° ${m}/${d} ${time}h`);
        if (r.elevation < 85) assert.ok(Math.abs(((s.azimuth - r.azimuth + 540) % 360) - 180) < 0.5, `azimuth ${s.azimuth.toFixed(2)} vs ${r.azimuth.toFixed(2)}`);
      }
  // the solstice at noon in London: 90 - 51.5 + 23.44 ≈ 61.9°, due south
  const noon = sunPosition(at(LONDON, 2024, 6, 21, 13.03 - 1)); // (12:02 GMT: the sun due south)
  assert.ok(Math.abs(noon.trueElevation - 61.93) < 0.3, `${noon.trueElevation}`);
  assert.ok(Math.abs(noon.azimuth - 180) < 1.5, `${noon.azimuth}`);
  // the equinox: the declination ~0
  assert.ok(Math.abs(sunPosition(at(LONDON, 2024, 3, 20, 3.1)).declination) < 0.05);
});

test('sunrise and sunset in London (within 3 minutes of the almanac)', () => {
  const near = (h, hh, mm) => Math.abs(h - (hh + mm / 60)) < 3 / 60;
  const jun = sunTimes(at(LONDON, 2024, 6, 21));
  assert.ok(near(jun.sunrise, 3, 43), hhmm(jun.sunrise)); // 04:43 BST
  assert.ok(near(jun.sunset, 20, 21), hhmm(jun.sunset)); // 21:21 BST
  const dec = sunTimes(at(LONDON, 2024, 12, 21));
  assert.ok(near(dec.sunrise, 8, 4), hhmm(dec.sunrise));
  assert.ok(near(dec.sunset, 15, 53), hhmm(dec.sunset));
  assert.ok(jun.civilDawn < jun.sunrise && jun.civilDusk > jun.sunset);
  // midsummer in London: it never gets astronomically dark
  assert.equal(jun.astroDawn, null);
  // the midnight sun at 78° N, the polar night in December
  assert.equal(sunTimes({ ...at(LONDON, 2024, 6, 21), latitude: 78 }).sunrise, null);
  assert.ok(sunPosition({ ...at(LONDON, 2024, 6, 21, 0), latitude: 78 }).elevation > 0);
  assert.ok(sunPosition({ ...at(LONDON, 2024, 12, 21, 12), latitude: 78 }).elevation < 0);
});

test('the moon: full and new on the dates they were; it covers the sun in an eclipse', () => {
  const ph = (y, m, d, h) => moonPosition({ year: y, day: dayOfDate(y, m, d), time: h, utcOffset: 0 });
  for (const [y, m, d, h] of [[2024, 1, 25, 17.9], [2024, 2, 24, 12.5], [2025, 1, 13, 22.45]]) {
    const p = ph(y, m, d, h);
    assert.ok(p.illumination > 0.98, `full ${y}-${m}-${d}: ${p.illumination}`);
    assert.equal(p.name, 'Full moon');
  }
  for (const [y, m, d, h] of [[2024, 1, 11, 11.95], [2025, 1, 29, 12.6]]) {
    const p = ph(y, m, d, h);
    assert.ok(p.illumination < 0.02, `new ${y}-${m}-${d}: ${p.illumination}`);
  }
  // a first quarter (2024-01-18 03:53 UT): half lit, waxing
  const q = ph(2024, 1, 18, 3.9);
  assert.ok(Math.abs(q.illumination - 0.5) < 0.05 && q.waxing, `${q.illumination}`);
  // the total eclipse of 8 April 2024 over Dallas (18:42 UT): the moon within a degree of the sun
  const D = { latitude: 32.78, longitude: -96.8, utcOffset: 0, year: 2024, day: dayOfDate(2024, 4, 8), time: 18.7 };
  const s = sunPosition(D).dir;
  const mo = moonPosition(D).dir;
  const sep = Math.acos(s[0] * mo[0] + s[1] * mo[1] + s[2] * mo[2]) / RAD;
  assert.ok(sep < 1, `${sep.toFixed(2)}° apart`);
});

test('the sunlight on the ground: none at night, more the higher the sun', () => {
  assert.equal(irradiance(-5), 0);
  assert.equal(irradiance(0), 0);
  let prev = 0;
  for (let e = 2; e <= 90; e += 4) {
    const I = irradiance(e);
    assert.ok(I > prev);
    prev = I;
  }
  // a midsummer noon at 51° N (~62°) ≈ 850-950, the equinox (~38.5°) ≈ 600-650, midwinter (~15°) ≈ 200-260
  assert.ok(irradiance(62) > 850 && irradiance(62) < 950);
  assert.ok(irradiance(38.5) > 580 && irradiance(38.5) < 660);
  assert.ok(irradiance(15) > 180 && irradiance(15) < 270);
  // the simulation's sun follows the clock: noon strong, dawn weak, night none
  const W = { ...defaultWeather(), season: 'summer', sky: true };
  const solar = (time) => deriveWeather({ ...W, time }).solar;
  assert.ok(solar(13) > 800);
  assert.ok(solar(5.5) < 250);
  assert.equal(solar(1), 0);
  // a night under a clear sky: the air at the ground nearer its dew point
  assert.ok(deriveWeather({ ...W, time: 1 }).rh > deriveWeather({ ...W, time: 13 }).rh);
});

test('the clock runs with the simulated time × its speed, over midnight into the next day', () => {
  const W = { ...defaultWeather(), day: 365, year: 2025, time: 23, clock: 'running', timeSpeed: 60 };
  assert.deepEqual(clockAt({ ...W, clock: 'fixed' }, 3600), { day: 365, year: 2025, time: 23 });
  const c = clockAt(W, 90); // 90 s × 60 = 1.5 h
  assert.equal(c.year, 2026);
  assert.equal(c.day, 1);
  assert.ok(Math.abs(c.time - 0.5) < 1e-9);
  // through the weather: the drift's clock, the sim's weather of the moment
  const d = new WeatherDrift(1);
  for (let k = 0; k < 60; k++) d.stepClock(1, W);
  const now = liveWeather({}, W, 'outdoor', d);
  assert.ok(Math.abs(now.time - 0) < 1e-9 && now.day === 1, `${now.day} ${now.time}`);
  // the afternoon warmer than before dawn (a diurnal cycle when it runs), as set at its start
  const start = { ...defaultWeather(), ambient: 10, time: 6, clock: 'running', timeSpeed: 3600 };
  const d2 = new WeatherDrift(1);
  assert.equal(liveWeather({}, start, 'outdoor', d2).ambient, 10);
  for (let k = 0; k < 9; k++) d2.stepClock(1, start);
  const pm = liveWeather({}, start, 'outdoor', d2);
  assert.ok(Math.abs(pm.time - 15) < 1e-9 && pm.ambient > 14, `${pm.ambient} at ${pm.time}`);
  assert.ok(diurnal(15) > diurnal(5));
  // indoors: no sky, no clock
  assert.equal(liveWeather({}, start, 'indoor', d2).sky, false);
});

test('dates, seasons, directions; the scenes\' old sun directions to a clock', () => {
  assert.equal(dateLabel(dayOfDate(2026, 11, 14), 2026), '14 Nov');
  assert.equal(dayOfDate(2024, 3, 1), 61);
  assert.equal(seasonOfDay(200, 51), 'summer');
  assert.equal(seasonOfDay(200, -33), 'winter');
  assert.equal(dayOf({ season: 'winter' }), SEASON_DAY.winter);
  assert.equal(hhmm(9.5), '09:30');
  const d = direction(135, 40);
  const back = toAzEl(d);
  assert.ok(Math.abs(back.azimuth - 135) < 1e-9 && Math.abs(back.elevation - 40) < 1e-9);
  assert.ok(d[0] > 0 && d[2] > 0, 'south-east is +X, +Z');
  // the carrier island's late-morning sun from the south-east
  const c = clockFor([0.544, 0.64, 0.544], { days: [230, 240, 250] });
  assert.ok(c.error < 1 && c.time > 9 && c.time < 11, JSON.stringify(c));
});

test('the simulation exposes the sun of its clock (sim.sky.sunDir: what solar panels follow)', async () => {
  const { createSimulation } = await import('../src/sim/createSimulation.js');
  const sim = createSimulation({ world: { size: [2, 1, 2], h: 0.1, ground: 'soil' }, weather: { day: 172, time: 12 }, objects: [], noFire: true });
  const d = sim.sky.sunDir;
  assert.ok(Math.abs(Math.hypot(...d) - 1) < 1e-9 && d[1] > 0.8 && d[2] > 0, 'high, from the south (+Z) at noon in June');
  sim.weather.time = 23;
  assert.ok(sim.sky.sunDir[1] < 0 && sim.sky.night > 0.5);
});
