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
    rain: 0, // mm/h
    fog: 0, // 0..1
  };
}

/** Values derived from the raw settings, recomputed every step. */
export function deriveWeather(w) {
  const rainFrac = Math.min(1, w.rain / 30);
  // Rain and fog push humidity up.
  const rh = Math.min(1, Math.max(w.humidity, w.fog * 0.98, w.rain > 0 ? 0.8 + 0.15 * rainFrac : 0));
  const rad = (w.windDir * Math.PI) / 180;
  return {
    rh,
    rainFrac,
    rainRate: w.rain / 3600, // kg/(m²·s)
    windX: Math.cos(rad) * w.windSpeed,
    windZ: Math.sin(rad) * w.windSpeed,
    // Equilibrium moisture content of dead fuels (simplified EMC curve).
    emc: 0.03 + 0.22 * rh * rh + 0.25 * rainFrac,
  };
}
