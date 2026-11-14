import { snowShare } from './snow.js';

/**
 * Weather settings. These feed the simulation every step, so they can be
 * changed live.
 */
export function defaultWeather() {
  return {
    ambient: 15, // °C air temperature
    humidity: 0.5, // relative humidity 0..1
    windSpeed: 0, // m/s at 2 m height
    windDir: 0, // degrees, direction the wind blows TOWARDS (0 = +X, 90 = +Z)
    rain: 0, // mm/h of precipitation (water): rain, or snow when the air is at freezing
    fog: 0, // 0..1
    sunshine: 1, // 0 overcast .. 1 a clear sky (the sun on the ground: it melts snow, dries things)
    lightning: 0, // strikes per minute somewhere in the scene (a thunderstorm: sim/lightning.js)
    season: 'summer', // spring | summer | autumn | winter: the leaves, the grass, the light
    snowCover: 0, // m of snow lying when the scene starts
    iceCover: 0, // m of ice on the fresh water when the scene starts (sim/ice.js)
    iceSpeed: 1, // × how fast ice forms and melts (1: as it does; more to watch it happen)
    snowSpeed: 1, // × how fast snow builds up and melts (1: as it does; more to watch it happen)
    vary: 'fixed', // fixed | gentle | changeable: how it changes by itself (WeatherDrift)
    // the water (sea, lakes, ponds: render/waterOptics.js)
    waterClarity: 0.9, // 0..1 how clear it is in itself (the sea: ~35 m visibility at 0.9)
    turbidity: 0, // 0..1 silt and plankton: you see less far down, brown-green
    grease: 0, // 0..1 a film of oil: calmer, glassy patches with a rainbow sheen, less foam
    waterTurbulence: 0, // 0..1 choppy, more foam and whitecaps, sediment stirred up near the shore
  };
}

/** The water's settings, as both weather panels (Play, Edit world) offer them (outdoors). */
export const WATER_SETTINGS = [
  { key: 'waterClarity', min: 0, max: 1, step: 0.01, label: 'Water clarity' },
  { key: 'turbidity', min: 0, max: 1, step: 0.01, label: 'Water turbidity (silt, plankton)' },
  { key: 'grease', min: 0, max: 1, step: 0.01, label: 'Grease / oil film on the water' },
  { key: 'waterTurbulence', min: 0, max: 1, step: 0.01, label: 'Water turbulence (chop, foam)' },
];

/**
 * The seasons: a typical day of each in a temperate climate (the weather settings they
 * start from; the user can change any of them after).
 */
export const SEASONS = {
  spring: { iceCover: 0, ambient: 12, humidity: 0.65, rain: 0, snowCover: 0, sunshine: 0.8 },
  summer: { iceCover: 0, ambient: 24, humidity: 0.45, rain: 0, snowCover: 0, sunshine: 1 },
  autumn: { iceCover: 0, ambient: 9, humidity: 0.8, rain: 0, snowCover: 0, sunshine: 0.5 },
  winter: { ambient: -3, humidity: 0.85, rain: 1.5, snowCover: 0.2, sunshine: 0.4, iceCover: 0.04 }, // light snow falling on 20 cm lying; thin ice on the water
};

/**
 * The midday sun on level ground under a clear sky (W/m²) in each season (a temperate
 * latitude: high and strong in summer, low and weak in winter).
 */
export const SUN_PEAK = { spring: 650, summer: 850, autumn: 450, winter: 280 };

/** Values derived from the raw settings, recomputed every step. */
export function deriveWeather(w) {
  // below freezing the precipitation is snow (sleet just above)
  const snow = snowShare(w.ambient);
  const rainFrac = Math.min(1, (w.rain * (1 - snow)) / 30);
  // Rain and fog push humidity up.
  const rh = Math.min(1, Math.max(w.humidity, w.fog * 0.98, w.rain > 0 ? 0.8 + 0.15 * Math.min(1, w.rain / 30) : 0));
  const rad = (w.windDir * Math.PI) / 180;
  return {
    rh,
    rainFrac,
    rainRate: (w.rain * (1 - snow)) / 3600, // kg/(m²·s)
    snowRate: (w.rain * snow) / 3600, // kg/(m²·s) of water falling as snow
    // sunlight on open ground (W/m²): the season's sun through the clouds (what is falling,
    // the fog, the sunshine setting)
    solar: (SUN_PEAK[w.season] ?? 650) * Math.max(0, Math.min(1, w.sunshine ?? 1)) * Math.max(0.1, 1 - Math.min(1, w.rain / 4) * 0.85) * (1 - 0.8 * (w.fog ?? 0)),
    windX: Math.cos(rad) * w.windSpeed,
    windZ: Math.sin(rad) * w.windSpeed,
    // Equilibrium moisture content of dead fuels (simplified EMC curve).
    emc: 0.03 + 0.22 * rh * rh + 0.25 * rainFrac,
  };
}

/**
 * Where a scene (or a zone of one) is: outdoors it has the weather; indoors, underground and in a
 * sealed cabin it has none (no wind, rain, fog, lightning, sun, snow or ice), only its own air.
 */
export const EXPOSURES = {
  outdoor: 'Outdoors (the weather)',
  indoor: 'Indoors (sheltered)',
  underground: 'Underground',
  sealed: 'Sealed cabin (its own air)',
};
/** The air of a place without weather, unless the scene says otherwise. */
export const INSIDE_AIR = {
  indoor: { ambient: 19, humidity: 0.45 },
  underground: { ambient: 12, humidity: 0.85 },
  sealed: { ambient: 21, humidity: 0.35 },
};
const NO_WEATHER = { windSpeed: 0, rain: 0, fog: 0, lightning: 0, sunshine: 0, snowCover: 0, iceCover: 0 };

/** How outdoor weather changes over time on its own. */
export const VARY = {
  fixed: 'Fixed (as set)',
  gentle: 'Drifts (gusts, the wind veering, a degree or so)',
  changeable: 'Changeable (strong gusts, showers, the wind turning)',
};

/** The settings that mean something there: all of them outdoors, else only the air. */
export function applicable(exposure = 'outdoor') {
  return exposure === 'outdoor' ? null : ['ambient', 'humidity'];
}

/** Where a scene or zone is: its exposure, else what its flags say (indoor, a dark crypt, space). */
export function exposureOf(place) {
  if (!place) return 'outdoor';
  if (EXPOSURES[place.exposure]) return place.exposure;
  if (place.indoor) return 'indoor';
  if (place.view?.space) return 'sealed';
  if (place.view?.dark) return 'underground';
  return 'outdoor';
}

/**
 * The weather as it changes by itself around what is set: gusts (seconds), the wind veering and
 * the air warming or cooling (minutes), and when changeable passing showers. Seeded: the same
 * scene changes the same way. step(dt) in simulated seconds; apply(base, out) writes the
 * weather of the moment into out.
 */
export class WeatherDrift {
  constructor(seed = 1) {
    this.s = seed >>> 0 || 1;
    this.gust = 0; // ~N(0,1), a few seconds
    this.veer = 0; // ~N(0,1), minutes
    this.temp = 0; // ~N(0,1), ten minutes
    this.shower = 0; // s left of the shower passing over (changeable)
    this.showerRain = 0; // its mm/h
    this.t = 0;
  }

  rand() {
    // mulberry32
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  gauss() {
    return Math.sqrt(-2 * Math.log(1 - this.rand())) * Math.cos(2 * Math.PI * this.rand());
  }

  /** An Ornstein-Uhlenbeck step: mean 0, variance 1, time scale tau (s). */
  ou(x, dt, tau) {
    const a = Math.exp(-dt / tau);
    return x * a + Math.sqrt(1 - a * a) * this.gauss();
  }

  step(dt, mode) {
    if (!(dt > 0) || mode === 'fixed' || !mode) return;
    // (big steps in pieces: a gust lasts seconds)
    for (let left = Math.min(dt, 600); left > 0; left -= 2) {
      const h = Math.min(2, left);
      this.t += h;
      this.gust = this.ou(this.gust, h, 6);
      this.veer = this.ou(this.veer, h, 150);
      this.temp = this.ou(this.temp, h, 900);
      if (mode === 'changeable') {
        if (this.shower > 0) this.shower -= h;
        // a shower about every 6 minutes, 1-4 minutes long
        else if (this.rand() < h / 360) {
          this.shower = 60 + 180 * this.rand();
          this.showerRain = 2 + 12 * this.rand() ** 2;
        }
      }
    }
  }

  /** The weather of the moment: base (what is set) with the drift on it, into out. */
  apply(base, out, mode) {
    Object.assign(out, base);
    if (mode !== 'gentle' && mode !== 'changeable') return out;
    const big = mode === 'changeable';
    // gusts: the wind's strength by ±25 % (±45 %), never below calm
    const g = Math.max(-2, Math.min(2, this.gust));
    out.windSpeed = Math.max(0, base.windSpeed * (1 + (big ? 0.35 : 0.2) * g));
    out.windDir = (((base.windDir + (big ? 35 : 12) * this.veer) % 360) + 360) % 360;
    out.ambient = base.ambient + (big ? 2.5 : 0.8) * this.temp;
    if (big && this.shower > 0) {
      out.rain = base.rain + this.showerRain;
      out.humidity = Math.max(base.humidity, 0.9);
      out.sunshine = Math.min(base.sunshine ?? 1, 0.25);
      out.windSpeed *= 1.15; // the squall ahead of it
    }
    return out;
  }
}

/**
 * The weather the simulation gets: outdoors what is set (drifting, if it does), elsewhere only
 * the place's own air (no wind, rain, sun...). Writes into out and returns it.
 */
export function liveWeather(out, settings, exposure = 'outdoor', drift = null) {
  if (exposure !== 'outdoor') return Object.assign(out, settings, NO_WEATHER, { vary: 'fixed' });
  if (drift) return drift.apply(settings, out, settings.vary);
  return Object.assign(out, settings);
}
