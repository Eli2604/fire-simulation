/**
 * The sky's clock: where the sun and the moon stand for a date, a time of day and a place on
 * the Earth (pure: no three.js). The sun and the moon by the Astronomical Almanac's
 * low-precision formulas (the sun to ~0.01°, the moon to ~0.3°; the moon seen from the ground,
 * not the Earth's centre: ~1° lower), the light through the air (Haurwitz's clear-sky
 * irradiance), sunrise, sunset and the twilights.
 *
 * Directions in the scene: +X east, +Z south, +Y up (north is -Z); azimuth from north, clockwise
 * (east 90°, south 180°).
 *
 * The settings (in a scene's or a place's weather, outdoors):
 *   day       day of the year 1..366 (null: the season's typical day, SEASON_DAY)
 *   year      for the moon (its phase) and leap years
 *   time      local clock time in hours (10.5 = 10:30)
 *   latitude  ° north (south negative); longitude ° east; utcOffset the clock's time zone (h)
 *   clock     'fixed' (as planned) | 'running' (advancing with the simulated time × timeSpeed)
 *   timeSpeed × how fast the clock runs against the simulated time (60: a minute a second)
 *   seasonFollowsDate  the season (the leaves, the grass) set by the date
 */

export const SKY_DEFAULTS = {
  day: null,
  year: 2026,
  time: 10,
  latitude: 51.5,
  longitude: 0,
  utcOffset: 0,
  clock: 'fixed',
  timeSpeed: 60,
  seasonFollowsDate: false,
};

/** A typical day of each season (northern hemisphere): mid-April, early July, early October, late January. */
export const SEASON_DAY = { spring: 105, summer: 190, autumn: 275, winter: 20 };

export const CLOCKS = { fixed: 'Fixed (as planned)', running: 'Running (advances with the simulation)' };

const RAD = Math.PI / 180;
const sin = (d) => Math.sin(d * RAD);
const cos = (d) => Math.cos(d * RAD);
const norm360 = (a) => ((a % 360) + 360) % 360;
const num = (v, d) => (Number.isFinite(v) ? v : d);

export const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export const daysIn = (y) => (isLeap(y) ? 366 : 365);

/** The day of the year the settings mean: the one set, else the season's (half a year on in the south). */
export function dayOf(W = {}) {
  if (Number.isFinite(W.day)) return W.day;
  const d = SEASON_DAY[W.season] ?? 172;
  return (W.latitude ?? SKY_DEFAULTS.latitude) < 0 ? ((d + 182 - 1) % 365) + 1 : d;
}

/** The season of a day of the year (meteorological: spring March–May ...; the other way round in the south). */
export function seasonOfDay(day, latitude = SKY_DEFAULTS.latitude) {
  const d = latitude < 0 ? ((day + 182 - 1) % 365) + 1 : day;
  if (d >= 60 && d < 152) return 'spring';
  if (d >= 152 && d < 244) return 'summer';
  if (d >= 244 && d < 335) return 'autumn';
  return 'winter';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Month and day of a day of the year: [month 0..11, day 1..31]. */
export function monthDay(day, year = SKY_DEFAULTS.year) {
  const len = [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let d = Math.max(1, Math.min(daysIn(year), Math.round(day)));
  let m = 0;
  while (d > len[m]) d -= len[m++];
  return [m, d];
}
/** '14 Nov' */
export function dateLabel(day, year) {
  const [m, d] = monthDay(day, year);
  return `${d} ${MONTHS[m]}`;
}
/** The day of the year of a date (month 1..12). */
export function dayOfDate(year, month, date) {
  const len = [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let n = date;
  for (let m = 0; m < month - 1; m++) n += len[m];
  return n;
}
/** 10.5 -> '10:30' */
export function hhmm(h) {
  if (!Number.isFinite(h)) return '--:--';
  let m = Math.round((((h % 24) + 24) % 24) * 60);
  if (m >= 1440) m -= 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Julian date of a moment: the year, the day of the year (1 = 1 January), hours UT. */
export function julian(year, day, ut) {
  // 0h UT on 1 January (Fliegel-Van Flandern, any Gregorian date)
  const a = Math.floor((14 - 1) / 12);
  const y = year + 4800 - a;
  const m = 1 + 12 * a - 3;
  const jdn = 1 + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
  return jdn - 0.5 + (day - 1) + ut / 24;
}

/** The settings, filled in, and the moment (days since J2000.0). */
function moment(W = {}, time = W.time) {
  const lat = num(W.latitude, SKY_DEFAULTS.latitude);
  const lon = num(W.longitude, SKY_DEFAULTS.longitude);
  const tz = num(W.utcOffset, SKY_DEFAULTS.utcOffset);
  const year = num(W.year, SKY_DEFAULTS.year);
  const day = dayOf(W);
  const t = num(time, SKY_DEFAULTS.time);
  return { lat, lon, d: julian(year, day, t - tz) - 2451545.0 };
}

/** Right ascension / declination (°) to elevation / azimuth (°) at a place and moment. */
function horizontal(ra, dec, lat, lon, d) {
  const gmst = 280.46061837 + 360.98564736629 * d;
  const H = norm360(gmst + lon - ra);
  const elevation = Math.asin(sin(lat) * sin(dec) + cos(lat) * cos(dec) * cos(H)) / RAD;
  const azimuth = norm360(Math.atan2(sin(H), cos(H) * sin(lat) - Math.tan(dec * RAD) * cos(lat)) / RAD + 180);
  return { elevation, azimuth };
}

/** The bending of the light near the horizon (°, Sæmundsson): what to add to a true elevation. */
export function refraction(h) {
  if (h < -2) return 0;
  return 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * RAD) / 60;
}

function eclipticToEquatorial(lam, beta, d) {
  const eps = 23.439 - 0.0000004 * d;
  const ra = norm360(Math.atan2(sin(lam) * cos(eps) - Math.tan(beta * RAD) * sin(eps), cos(lam)) / RAD);
  const dec = Math.asin(sin(beta) * cos(eps) + cos(beta) * sin(eps) * sin(lam)) / RAD;
  return { ra, dec };
}

/** The sun's ecliptic longitude (°) d days after J2000. */
function sunLongitude(d) {
  const L = 280.46 + 0.9856474 * d;
  const g = 357.528 + 0.9856003 * d;
  return norm360(L + 1.915 * sin(g) + 0.02 * sin(2 * g));
}

/**
 * Where the sun is: elevation (° above the horizon, with the refraction; `trueElevation`
 * without), azimuth (° from north, clockwise), its declination, and the direction its light
 * comes from in the scene.
 */
export function sunPosition(W = {}, time = W.time) {
  const { lat, lon, d } = moment(W, time);
  const { ra, dec } = eclipticToEquatorial(sunLongitude(d), 0, d);
  const { elevation, azimuth } = horizontal(ra, dec, lat, lon, d);
  const el = elevation + refraction(elevation);
  return { elevation: el, trueElevation: elevation, azimuth, declination: dec, dir: direction(azimuth, el) };
}

/**
 * Where the moon is (seen from the ground: its parallax, ~1°), and how much of it is lit:
 * illumination 0 (new) .. 1 (full), age 0..1 through the month (0 new, 0.5 full), waxing, its
 * phase's name, the direction of its light in the scene.
 */
export function moonPosition(W = {}, time = W.time) {
  const { lat, lon, d } = moment(W, time);
  const T = d / 36525;
  const lam = norm360(
    218.32 + 481267.881 * T + 6.29 * sin(134.9 + 477198.85 * T) - 1.27 * sin(259.2 - 413335.38 * T) + 0.66 * sin(235.7 + 890534.23 * T) + 0.21 * sin(269.9 + 954397.7 * T) - 0.19 * sin(357.5 + 35999.05 * T) - 0.11 * sin(186.6 + 966404.05 * T),
  );
  const beta = 5.13 * sin(93.3 + 483202.03 * T) + 0.28 * sin(228.2 + 960400.87 * T) - 0.28 * sin(318.3 + 6003.18 * T) - 0.17 * sin(217.6 - 407332.2 * T);
  const par = 0.9508 + 0.0518 * cos(134.9 + 477198.85 * T) + 0.0095 * cos(259.2 - 413335.38 * T) + 0.0078 * cos(235.7 + 890534.23 * T) + 0.0028 * cos(269.9 + 954397.7 * T);
  const { ra, dec } = eclipticToEquatorial(lam, beta, d);
  const geo = horizontal(ra, dec, lat, lon, d);
  const trueEl = geo.elevation - par * cos(geo.elevation); // from the ground, not the Earth's centre
  const el = trueEl + refraction(trueEl);
  // the phase: how far from the sun it stands (the elongation)
  const dl = norm360(lam - sunLongitude(d));
  const psi = Math.acos(cos(beta) * cos(dl)) / RAD;
  const illumination = (1 - cos(psi)) / 2;
  const age = dl / 360;
  const names = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  return { elevation: el, trueElevation: trueEl, azimuth: geo.azimuth, illumination, age, waxing: dl < 180, name: names[Math.round(age * 8) % 8], dir: direction(geo.azimuth, el) };
}

/** The scene direction (unit, towards the body) of an azimuth and elevation (°). */
export function direction(azimuth, elevation) {
  const c = cos(elevation);
  return [c * sin(azimuth), sin(elevation), -c * cos(azimuth)];
}
/** Azimuth and elevation (°) of a scene direction. */
export function toAzEl([x, y, z]) {
  const r = Math.hypot(x, y, z) || 1;
  return { azimuth: norm360(Math.atan2(x, -z) / RAD), elevation: Math.asin(y / r) / RAD };
}

/**
 * The times (local clock hours) the sun's centre crosses an elevation going up and coming
 * down that day: null when it does not (above it all day, or below it all day).
 */
function crossings(W, h0) {
  const f = (t) => sunPosition(W, t).trueElevation - h0;
  let up = null;
  let down = null;
  const step = 0.25;
  let a = 0;
  let fa = f(a);
  for (let b = step; b <= 24 + 1e-9; b += step) {
    const fb = f(b);
    if ((fa < 0) !== (fb < 0)) {
      let lo = a;
      let hi = b;
      let flo = fa;
      for (let k = 0; k < 30; k++) {
        const m = (lo + hi) / 2;
        const fm = f(m);
        if ((fm < 0) === (flo < 0)) {
          lo = m;
          flo = fm;
        } else hi = m;
      }
      if (fa < 0) up ??= (lo + hi) / 2;
      else down = (lo + hi) / 2;
    }
    a = b;
    fa = fb;
  }
  return [up, down];
}

/**
 * Sunrise and sunset (the sun's upper edge on the horizon, refraction included: -0.833°),
 * and the civil (-6°), nautical (-12°) and astronomical (-18°) dawns and dusks, in local
 * clock hours (null: it does not happen that day: the midnight sun, the polar night).
 */
export function sunTimes(W = {}) {
  const [sunrise, sunset] = crossings(W, -0.833);
  const [civilDawn, civilDusk] = crossings(W, -6);
  const [nauticalDawn, nauticalDusk] = crossings(W, -12);
  const [astroDawn, astroDusk] = crossings(W, -18);
  return { sunrise, sunset, civilDawn, civilDusk, nauticalDawn, nauticalDusk, astroDawn, astroDusk };
}

/**
 * The sunlight on level ground under a clear sky (W/m², direct and diffuse) with the sun at
 * an elevation (°): Haurwitz's model, 1098·cos z·e^(-0.057/cos z). ~910 W/m² at 62° (a
 * midsummer noon at 51° N), ~620 at the equinox, ~240 midwinter, nothing below the horizon.
 */
export function irradiance(elevation) {
  const c = sin(elevation);
  if (c <= 0.005) return 0;
  return 1098 * c * Math.exp(-0.057 / c);
}

/** What part of the day it is from the sun's elevation (°). */
export function phaseOfDay(el) {
  if (el >= 6) return 'day';
  if (el >= -0.833) return 'golden hour';
  if (el >= -6) return 'civil twilight';
  if (el >= -12) return 'nautical twilight';
  if (el >= -18) return 'astronomical twilight';
  return 'night';
}

/**
 * The moment the clock shows, `elapsed` simulated seconds after the settings' start (when it
 * runs): { day, year, time }. The days and years roll over.
 */
export function clockAt(W = {}, elapsed = 0) {
  let year = num(W.year, SKY_DEFAULTS.year);
  let day = dayOf(W);
  let time = num(W.time, SKY_DEFAULTS.time);
  if (W.clock === 'running' && elapsed > 0) {
    time += (elapsed * Math.max(0, num(W.timeSpeed, SKY_DEFAULTS.timeSpeed))) / 3600;
    const whole = Math.floor(time / 24);
    time -= whole * 24;
    day += whole;
    while (day > daysIn(year)) day -= daysIn(year++);
  }
  return { day, year, time };
}

/**
 * The sun and the moon for the settings: everything the sky, its light and the read-outs need.
 * night 0 (day) .. 1 (the sun 18° under): how dark it is.
 */
export function skyState(W = {}) {
  const sun = sunPosition(W);
  const moon = moonPosition(W);
  const night = Math.max(0, Math.min(1, (0.5 - sun.elevation) / 18.5));
  return { sun, moon, night, phase: phaseOfDay(sun.elevation) };
}

/**
 * The day and time (at a latitude) that put the sun nearest a direction (the scenes' old fixed
 * `view.sun`): searched over the days `days` (default the whole year) and the times of day.
 * Returns { day, time, error (° off) }.
 */
export function clockFor(dir, { latitude = SKY_DEFAULTS.latitude, longitude = 0, utcOffset = 0, year = SKY_DEFAULTS.year, days = null } = {}) {
  const want = toAzEl(dir);
  const w = direction(want.azimuth, want.elevation);
  let best = { day: 172, time: 12, error: 180 };
  const list = days ?? Array.from({ length: 365 }, (_, k) => k + 1);
  const angle = (d) => Math.acos(Math.max(-1, Math.min(1, d[0] * w[0] + d[1] * w[1] + d[2] * w[2]))) / RAD;
  for (const day of list) {
    for (let time = 0; time < 24; time += 0.25) {
      const e = angle(sunPosition({ latitude, longitude, utcOffset, year, day }, time).dir);
      if (e < best.error) best = { day, time, error: e };
    }
  }
  // refine the time to the minute
  for (let time = best.time - 0.25; time <= best.time + 0.25; time += 1 / 60) {
    const e = angle(sunPosition({ latitude, longitude, utcOffset, year, day: best.day }, time).dir);
    if (e < best.error) best = { ...best, time: Math.round(time * 60) / 60, error: e };
  }
  return best;
}
