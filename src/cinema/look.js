/**
 * How a world camera's picture looks (models/camera.js), without three.js: exposure from ISO,
 * aperture and shutter; the white balance; colour grades; motion blur from the shutter angle;
 * handheld shake. The shaders (render/cinePost.js) do the same sums per pixel.
 */

/* ---------------- exposure ---------------- */

/** The exposure time (s) of a shutter angle (degrees) at a frame rate: 180° at 24 fps is 1/48 s. */
export function shutterTime(angle, fps = 24) {
  return Math.max(0, angle) / 360 / Math.max(1, fps);
}

/**
 * The picture's brightness relative to the reference (ISO 800, f/2.8, 180° at 24 fps): twice the
 * ISO or the exposure time, or one stop wider, is twice as bright.
 */
export function relativeExposure({ iso = 800, fstop = 2.8, shutter = 180, fps = 24 }) {
  const t = shutterTime(shutter, fps);
  return (iso / 800) * (t / (1 / 48)) * (2.8 / fstop) ** 2;
}

/**
 * The gain on the picture: the compensation (EV, stops) and, with the exposure set by hand, the
 * ISO / aperture / shutter triangle (auto: the camera keeps the picture as bright whatever they are).
 */
export function exposureGain({ exposure = 0, auto = true, iso, fstop, shutter, fps }) {
  const g = 2 ** exposure;
  return auto ? g : g * relativeExposure({ iso, fstop, shutter, fps });
}

/* ---------------- white balance ---------------- */

/** The colour of a black body at a temperature (K), as RGB 0..1 (Tanner Helland's fit). */
export function kelvinToRgb(K) {
  const t = Math.max(1000, Math.min(40000, K)) / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * (t - 60) ** -0.1332047592;
    g = 288.1221695283 * (t - 60) ** -0.0755148492;
    b = 255;
  }
  const c = (v) => Math.max(0, Math.min(255, v)) / 255;
  return [c(r), c(g), c(b)];
}

/**
 * The gains (r, g, b) of a white balance set at K kelvin with a tint (green − / magenta +), in a
 * world lit at about 6500 K: set lower than the light (3200 K tungsten in daylight) the picture
 * goes blue, set higher it goes warm. Normalised to keep the brightness (Rec. 709 luma).
 */
export function whiteBalanceGains(K = 6500, tint = 0) {
  const ref = kelvinToRgb(6500);
  const c = kelvinToRgb(K);
  const g = [ref[0] / Math.max(0.05, c[0]), ref[1] / Math.max(0.05, c[1]), ref[2] / Math.max(0.05, c[2])];
  g[1] *= 1 - 0.25 * tint;
  const y = 0.2126 * g[0] + 0.7152 * g[1] + 0.0722 * g[2];
  return g.map((v) => v / y);
}

/* ---------------- colour grades ---------------- */

/**
 * Grades (looks): lift / gamma / gain per channel (shadows, mid-tones, highlights), saturation,
 * contrast, and special looks: mono (black and white), bleach (the silver kept: bleach bypass,
 * low saturation and hard contrast), nightVision (green phosphor, amplified), thermal (the voxels
 * coloured by their heat, as Play's thermal camera: render/voxels.js; smoke not seen).
 */
export const GRADES = {
  Neutral: {},
  Warm: { gain: [1.08, 1.0, 0.86], lift: [0.02, 0.005, -0.01], sat: 1.05 },
  Cool: { gain: [0.9, 0.98, 1.1], lift: [-0.01, 0, 0.02], sat: 0.95 },
  'Teal & orange': { lift: [-0.02, 0.01, 0.04], gain: [1.1, 1.0, 0.9], sat: 1.15, contrast: 1.1 },
  'Bleach bypass': { bleach: 0.8, sat: 0.45, contrast: 1.35 },
  'Black & white': { mono: 1, contrast: 1.2 },
  'Vintage film': { lift: [0.06, 0.04, 0.02], gain: [1.02, 0.97, 0.85], sat: 0.75, contrast: 0.9 },
  'Day for night': { gain: [0.45, 0.6, 0.95], gamma: [1.25, 1.2, 1.0], sat: 0.55, exposure: -1.2 },
  'Night vision': { nightVision: 1, exposure: 1.5 },
  Thermal: { thermal: 1, contrast: 1.1 },
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** A grade with every field there (the shader's uniforms), mixed with neutral by amount (0..1). */
export function gradeUniforms(name, amount = 1) {
  const G = GRADES[name] ?? GRADES.Neutral;
  const a = Math.max(0, Math.min(1, amount));
  const mix3 = (v, d) => (v ?? [d, d, d]).map((x) => d + (x - d) * a);
  const mix = (v, d) => d + ((v ?? d) - d) * a;
  return {
    lift: mix3(G.lift, 0),
    gamma: mix3(G.gamma, 1),
    gain: mix3(G.gain, 1),
    sat: mix(G.sat, 1),
    contrast: mix(G.contrast, 1),
    mono: mix(G.mono, 0),
    bleach: mix(G.bleach, 0),
    nightVision: mix(G.nightVision, 0),
    exposure: mix(G.exposure, 0),
    thermal: !!G.thermal,
  };
}

/** A colour (0..1, display values) through a grade (gradeUniforms): what the shader does. */
export function applyGrade(c, U) {
  let x = c.map((v, i) => clamp01(Math.pow(clamp01(v * U.gain[i] + U.lift[i] * (1 - v)), 1 / U.gamma[i])));
  const y = luma(x);
  x = x.map((v) => y + (v - y) * U.sat);
  x = x.map((v) => (v - 0.5) * U.contrast + 0.5);
  if (U.bleach > 0) {
    // the silver left in: the picture laid over its own black-and-white, overlay blend
    const yy = luma(x);
    const ov = x.map((v) => (yy < 0.5 ? 2 * v * yy : 1 - 2 * (1 - v) * (1 - yy)));
    x = x.map((v, i) => v + (ov[i] - v) * U.bleach);
  }
  if (U.mono > 0) {
    const yy = luma(x);
    x = x.map((v) => v + (yy - v) * U.mono);
  }
  if (U.nightVision > 0) {
    const yy = Math.min(1, luma(x) * 1.6);
    const nv = [0.15 * yy, yy, 0.25 * yy];
    x = x.map((v, i) => v + (nv[i] - v) * U.nightVision);
  }
  return x.map(clamp01);
}

/* ---------------- motion blur ---------------- */

/**
 * Motion blur from the shutter: each frame mixed with what came before (an exponential average
 * whose mean age is half the exposure time, as a box over the shutter's open time has). Returns
 * the weight of the history (0: none, a 0° shutter or a still frame).
 *   history = (T/2) / (dt + T/2), T = shutter angle / 360 / fps
 */
export function motionBlurHistory(shutter, fps, dt) {
  const T = shutterTime(shutter, fps);
  if (T <= 0 || !(dt > 0)) return 0;
  return Math.min(0.9, T / 2 / (dt + T / 2));
}

/* ---------------- handheld shake ---------------- */

/**
 * A handheld camera's wobble at time t (s): small turns (yaw, pitch, roll, radians) and a drift
 * (m), from sums of sines at frequencies that never line up (smooth, never repeating soon).
 * amount 0..1 (1: a nervous operator running), freq: how quick (1 normal).
 */
export function shake(t, amount = 0, freq = 1, seed = 0) {
  if (!amount) return { yaw: 0, pitch: 0, roll: 0, pos: [0, 0, 0] };
  const s = seed * 1.618;
  const n = (a, b, c) => (Math.sin(t * freq * a + s * 3.1 + c) * 0.55 + Math.sin(t * freq * b + s * 5.3 + c * 2) * 0.3 + Math.sin(t * freq * (a + b) * 1.7 + c * 3) * 0.15);
  const k = amount;
  return {
    yaw: n(1.13, 2.71, 0.3) * 0.012 * k,
    pitch: n(1.37, 3.19, 1.7) * 0.01 * k,
    roll: n(0.71, 1.93, 2.9) * 0.008 * k,
    pos: [n(0.9, 2.3, 4.1) * 0.02 * k, n(1.9, 4.7, 5.3) * 0.015 * k, n(0.8, 2.1, 6.7) * 0.02 * k],
  };
}
