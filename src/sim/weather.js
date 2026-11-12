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
  };
}

/**
 * The seasons: a typical day of each in a temperate climate (the weather settings they
 * start from; the user can change any of them after).
 */
export const SEASONS = {
  spring: { ambient: 12, humidity: 0.65, rain: 0, snowCover: 0, sunshine: 0.8 },
  summer: { ambient: 24, humidity: 0.45, rain: 0, snowCover: 0, sunshine: 1 },
  autumn: { ambient: 9, humidity: 0.8, rain: 0, snowCover: 0, sunshine: 0.5 },
  winter: { ambient: -3, humidity: 0.85, rain: 1.5, snowCover: 0.2, sunshine: 0.4 }, // light snow falling on 20 cm lying
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
