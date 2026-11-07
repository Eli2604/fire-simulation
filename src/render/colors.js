/**
 * Colour helpers. All functions write into `out` (array-like, 3 floats) to
 * avoid allocations in per-voxel loops.
 */

// Incandescence ramp (°C -> linear RGB emission). Starts at the Draper point.
const BB = [
  [480, 0, 0, 0],
  [550, 0.25, 0.01, 0],
  [700, 0.9, 0.08, 0.0],
  [850, 1.6, 0.35, 0.03],
  [1000, 2.4, 0.9, 0.2],
  [1200, 3.2, 1.9, 0.8],
  [1500, 4.0, 3.2, 2.2],
  [2000, 5.0, 4.6, 4.0],
];

export function blackbody(T, out) {
  if (T <= BB[0][0]) {
    out[0] = out[1] = out[2] = 0;
    return out;
  }
  for (let k = 1; k < BB.length; k++) {
    if (T <= BB[k][0] || k === BB.length - 1) {
      const a = BB[k - 1];
      const b = BB[k];
      const t = Math.min(1, (T - a[0]) / (b[0] - a[0]));
      out[0] = a[1] + (b[1] - a[1]) * t;
      out[1] = a[2] + (b[2] - a[2]) * t;
      out[2] = a[3] + (b[3] - a[3]) * t;
      return out;
    }
  }
  return out;
}

// Thermal camera palette ("iron"-like, readable): blue -> purple -> red -> orange -> yellow -> white
const HM = [
  [0, 0.02, 0.02, 0.25],
  [0.12, 0.1, 0.1, 0.7],
  [0.3, 0.55, 0.05, 0.6],
  [0.5, 0.9, 0.15, 0.15],
  [0.7, 1.0, 0.55, 0.0],
  [0.87, 1.0, 0.92, 0.25],
  [1, 1.0, 1.0, 1.0],
];

export const THERMAL_MIN = 0;
export const THERMAL_MAX = 1200;

/** Map a temperature to the thermal palette (non-linear so low temperatures stay readable). */
export function heatmap(T, out) {
  let u = (T - THERMAL_MIN) / (THERMAL_MAX - THERMAL_MIN);
  u = u <= 0 ? 0 : u >= 1 ? 1 : Math.pow(u, 0.55);
  for (let k = 1; k < HM.length; k++) {
    if (u <= HM[k][0]) {
      const a = HM[k - 1];
      const b = HM[k];
      const t = (u - a[0]) / (b[0] - a[0]);
      out[0] = a[1] + (b[1] - a[1]) * t;
      out[1] = a[2] + (b[2] - a[2]) * t;
      out[2] = a[3] + (b[3] - a[3]) * t;
      return out;
    }
  }
  out[0] = out[1] = out[2] = 1;
  return out;
}

/** CSS gradient matching the heatmap, for the legend. */
export function heatmapCss() {
  const stops = [];
  const c = [0, 0, 0];
  for (let k = 0; k <= 10; k++) {
    const u = k / 10;
    const T = THERMAL_MIN + Math.pow(u, 1 / 0.55) * (THERMAL_MAX - THERMAL_MIN);
    heatmap(T, c);
    stops.push(`rgb(${(c[0] * 255) | 0},${(c[1] * 255) | 0},${(c[2] * 255) | 0}) ${u * 100}%`);
  }
  return `linear-gradient(to right, ${stops.join(',')})`;
}

export function legendTemps() {
  return [0, 50, 150, 300, 600, 1200].map((T) => ({
    T,
    pos: Math.pow((T - THERMAL_MIN) / (THERMAL_MAX - THERMAL_MIN), 0.55),
  }));
}
