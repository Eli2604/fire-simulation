/**
 * Lenses and sensors for the world's cameras (models/camera.js), without three.js (tested on its
 * own: test/cinema.test.js).
 *
 *  - The field of view from a focal length on a sensor (its gate width), an anamorphic lens's
 *    squeeze widening it; fitted to the frame (the letterbox's aspect) inside the canvas: what
 *    the three.js camera's vertical fov must be, and where the bars go.
 *  - Depth of field by the thin lens: the circle of confusion of a point at a distance with the
 *    lens focused at another, in pixels of the picture; the hyperfocal distance, the near and far
 *    limits of what is sharp.
 *  - Lens distortion (barrel, a fisheye's strong one) as the picture is resampled.
 */

const DEG = 180 / Math.PI;

/** Sensor (film gate) sizes, width × height in mm. */
export const SENSORS = {
  'Super 35': { w: 24.89, h: 18.66 },
  'Full frame': { w: 36, h: 24 },
  'APS-C': { w: 23.6, h: 15.6 },
  'Super 16': { w: 12.52, h: 7.41 },
  'Micro 4/3': { w: 17.3, h: 13 },
  'Large format 65': { w: 54.12, h: 25.58 },
  'IMAX 70 mm': { w: 70.41, h: 52.63 },
  '2/3" broadcast': { w: 9.59, h: 5.39 },
};

/**
 * Lens presets: focal length (mm), the kind (spherical; fisheye: a very wide view bent round;
 * anamorphic: squeezed 2× sideways, oval bokeh, horizontal streaks, a 2.39:1 frame), and the
 * distortion and frame they bring with them.
 */
export const LENSES = {
  '14 mm ultra-wide': { focal: 14, kind: 'spherical', distortion: 0.04 },
  '24 mm wide': { focal: 24, kind: 'spherical', distortion: 0.02 },
  '35 mm': { focal: 35, kind: 'spherical', distortion: 0 },
  '50 mm normal': { focal: 50, kind: 'spherical', distortion: 0 },
  '85 mm portrait': { focal: 85, kind: 'spherical', distortion: 0 },
  '135 mm tele': { focal: 135, kind: 'spherical', distortion: 0 },
  '200 mm tele': { focal: 200, kind: 'spherical', distortion: 0 },
  'Fisheye 8 mm': { focal: 8, kind: 'fisheye', distortion: 0.45 },
  'Anamorphic 50 mm (2×, 2.39:1)': { focal: 50, kind: 'anamorphic', squeeze: 2, distortion: 0.03, letterbox: '2.39:1' },
  'Anamorphic 35 mm (2×, 2.39:1)': { focal: 35, kind: 'anamorphic', squeeze: 2, distortion: 0.05, letterbox: '2.39:1' },
  Custom: { focal: null, kind: 'spherical', distortion: null },
};

/** Frame aspects (the letterbox): none fills the canvas. */
export const FRAMES = { none: 0, '1.33:1': 4 / 3, '1.78:1 (16:9)': 16 / 9, '1.85:1': 1.85, '2.00:1': 2, '2.39:1': 2.39, '2.76:1': 2.76 };

/** The lens preset a name stands for (Custom, or unknown names: spherical). */
export function lensOf(name) {
  return LENSES[name] ?? LENSES.Custom;
}

/** Horizontal angle of view (degrees) of a focal length (mm) on a sensor width (mm), times an anamorphic squeeze. */
export function horizontalFov(focal, sensorWidth, squeeze = 1) {
  return 2 * Math.atan((sensorWidth * squeeze) / (2 * Math.max(0.1, focal))) * DEG;
}

/** The focal length (mm) that gives a horizontal angle of view (degrees) on a sensor width. */
export function focalForFov(hFovDeg, sensorWidth, squeeze = 1) {
  return (sensorWidth * squeeze) / (2 * Math.tan(hFovDeg / DEG / 2));
}

/** The vertical angle (degrees) for a horizontal one at an aspect (width / height). */
export function verticalFromHorizontal(hFovDeg, aspect) {
  return 2 * Math.atan(Math.tan(hFovDeg / DEG / 2) / aspect) * DEG;
}

/**
 * The three.js camera for a lens: its vertical fov over the whole canvas, the frame inside it
 * (its aspect) and the bars round it.
 *  { focal (mm), sensor (SENSORS name or { w, h }), squeeze (1; 2 anamorphic), frame (aspect, 0:
 *    the canvas's), canvasAspect, fisheye (true: the view stretched wider still, for the
 *    distortion to bend back) }
 * Returns { fov (vertical, degrees, for the canvas), hFov (of the frame), frameAspect,
 *  bars: { x, y } (each bar's share of the canvas width / height) }.
 */
export function lensView({ focal = 50, sensor = 'Super 35', squeeze = 1, frame = 0, canvasAspect = 16 / 9, fisheye = false } = {}) {
  const S = typeof sensor === 'string' ? SENSORS[sensor] ?? SENSORS['Super 35'] : sensor;
  let hFov = horizontalFov(focal, S.w, squeeze);
  // (a perspective camera cannot see half round: the fisheye's distortion bends a wide view further)
  hFov = Math.min(fisheye ? 150 : 170, hFov);
  const frameAspect = frame > 0 ? frame : canvasAspect;
  const bars = { x: 0, y: 0 };
  let fov;
  if (frameAspect >= canvasAspect) {
    // bars top and bottom: the frame is as wide as the canvas
    bars.y = (1 - canvasAspect / frameAspect) / 2;
    fov = verticalFromHorizontal(hFov, canvasAspect);
  } else {
    // bars at the sides: the frame is as high as the canvas
    bars.x = (1 - frameAspect / canvasAspect) / 2;
    fov = verticalFromHorizontal(hFov, frameAspect);
  }
  return { fov: Math.min(175, fov), hFov, frameAspect, bars };
}

/* ---------------- depth of field (thin lens) ---------------- */

/** The circle of confusion a sensor's picture can take for sharp (mm): its diagonal / 1500. */
export function acceptableCoc(sensor = 'Super 35') {
  const S = typeof sensor === 'string' ? SENSORS[sensor] ?? SENSORS['Super 35'] : sensor;
  return Math.hypot(S.w, S.h) / 1500;
}

/**
 * The circle of confusion (mm on the sensor) of a point at distance d (m) with a lens of focal f
 * (mm) at f-number N focused at s (m): c = f² |d − s| / (N d (s − f)).
 */
export function cocMm(d, { focal, fstop, focus }) {
  const f = focal / 1000; // m
  const s = Math.max(focus, f * 1.01);
  const dd = Math.max(1e-3, d);
  return ((f * f * Math.abs(dd - s)) / (fstop * dd * (s - f))) * 1000;
}

/**
 * The scale of the depth of field for the shader: the blur (pixels across the picture width) is
 * scale · |d − s| / d. widthPx: the picture's width in pixels; sensor width in mm.
 */
export function cocScalePx({ focal, fstop, focus, sensorWidth, widthPx, squeeze = 1 }) {
  const f = focal / 1000;
  const s = Math.max(focus, f * 1.01);
  const cMax = ((f * f) / (fstop * (s - f))) * 1000; // mm at |d − s| / d = 1
  return (cMax / (sensorWidth * squeeze)) * widthPx;
}

/** The blur in pixels of a point at d (m): the same as the shader works it out. */
export function cocPx(d, o) {
  const s = Math.max(o.focus, o.focal / 1000 * 1.01);
  return cocScalePx(o) * (Math.abs(d - s) / Math.max(1e-3, d));
}

/** The hyperfocal distance (m): focused there, everything from half of it to infinity is sharp. */
export function hyperfocal({ focal, fstop, coc }) {
  const f = focal / 1000;
  return (f * f) / (fstop * (coc / 1000)) + f;
}

/** The near and far limits (m) of what is sharp; far is Infinity at or past the hyperfocal distance. */
export function dofLimits({ focal, fstop, focus, coc }) {
  const H = hyperfocal({ focal, fstop, coc });
  const f = focal / 1000;
  const s = focus;
  const near = (s * (H - f)) / (H + s - 2 * f);
  const far = s >= H ? Infinity : (s * (H - f)) / (H - s);
  return { near, far, hyperfocal: H };
}

/* ---------------- distortion ---------------- */

/**
 * Lens distortion as the picture is resampled: a point at radius r from the centre (in the
 * picture's half-diagonal units: the corner is 1) takes its colour from radius r (1 + k r²) /
 * (1 + k): k > 0 barrel (the middle swells, straight lines bow out: wide lenses, the fisheye),
 * k < 0 pincushion. The corners stay the corners.
 */
export function distortRadius(r, k) {
  return (r * (1 + k * r * r)) / (1 + k);
}
