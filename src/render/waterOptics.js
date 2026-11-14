/**
 * The optics of natural water, shared by the sea (render/ocean.js), the sea floor under it
 * (render/archipelago.js, the voxels), inland water (render/waterSurface.js) and the vortex.
 *
 * Light going into water is absorbed per colour, red first (pure water takes ~35 % of the red
 * out of every metre, a few % of the green, ~1 % of the blue): the deeper, the bluer-green, the
 * light that reaches the floor and comes back up (twice the depth) more so. Particles scatter
 * it back up (the colour of deep water: what is scattered over what is absorbed) and make the
 * water hazy. Silt and plankton (turbidity) absorb the blue most (brown-green) and scatter a
 * lot: you see less far down. Turbulence stirs sediment up near the shore and at the surface.
 * A film of oil (grease) takes a little light too.
 *
 * The same formulas run on the CPU (inland water's colour per column, the tests) and in the
 * shaders (WATER_GLSL, built from the same constants).
 */

// absorption (1/m) of pure water, of fine particles in less clear water, and of silt/plankton
export const PURE = [0.35, 0.03, 0.012];
export const PART = [0.08, 0.06, 0.06];
export const SILT = [0.3, 0.45, 0.8];
const SCAT0 = 0.004; // scattering (1/m) of clear water
const SCAT_PART = 0.05;
const SCAT_SILT = 1.0;
const GREASE_ABS = 0.06;
const SECCHI = 1.7; // visibility depth ≈ 1.7 / attenuation

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** The water's settings (weather), with their defaults. */
export function waterSettings(w = {}) {
  return {
    clarity: clamp01(w.waterClarity ?? 0.9),
    turbidity: clamp01(w.turbidity ?? 0),
    grease: clamp01(w.grease ?? 0),
    turbulence: clamp01(w.waterTurbulence ?? 0),
  };
}

/**
 * Turbidity where the water is `depth` m deep: what is in it, plus what turbulence stirs up:
 * some everywhere at the surface, much more in the shallows (the sediment off the floor).
 */
export function effectiveTurbidity(turbidity, turbulence, depth = Infinity) {
  const shore = Number.isFinite(depth) ? Math.exp(-Math.max(0, depth) / 3) : 0;
  return clamp01(turbidity + turbulence * (0.15 + 0.6 * shore));
}

/**
 * Absorption (per colour), scattering and attenuation (1/m), the visibility depth (m) and the
 * colour of deep water (what scatters back up out of it, linear RGB) for water of this clarity,
 * turbidity and grease.
 */
export function waterOptics({ clarity = 0.9, turbidity = 0, grease = 0 } = {}) {
  const q = 1 - clamp01(clarity);
  const t = clamp01(turbidity);
  const absorb = PURE.map((p, c) => p + q * PART[c] + t * SILT[c] + grease * GREASE_ABS);
  const scatter = SCAT0 + SCAT_PART * q + SCAT_SILT * t;
  const atten = absorb.map((a) => a + scatter);
  const visibility = Math.min(60, SECCHI / atten[1]);
  return { absorb, scatter, atten, visibility, deep: deepColour(absorb, scatter, t) };
}

/** The colour of infinitely deep water: back-scattered over absorbed light, a little blue sky in it. */
export function deepColour(absorb, scatter, t = 0) {
  // (water molecules scatter the blue a little more; silt is brownish)
  const mol = [0.0006, 0.0012, 0.0026];
  const silt = [1, 0.92, 0.68];
  return absorb.map((a, c) => {
    const b = scatter + mol[c];
    return 0.42 * (b / (a + b)) * (1 + (silt[c] - 1) * t);
  });
}

/** The share of each colour of light left after `path` m through the water. */
export function transmit(path, absorb) {
  return absorb.map((a) => Math.exp(-a * Math.max(0, path)));
}

/**
 * What you see looking down into water `depth` m deep over a floor of colour `floor` (linear
 * RGB): the floor's colour that comes back up (down and up again: twice the depth, red going
 * first), and the light scattered back by the water itself in front of it.
 */
export function waterColour(depth, floor, opts = {}) {
  const t = effectiveTurbidity(opts.turbidity ?? 0, opts.turbulence ?? 0, depth);
  const O = waterOptics({ ...opts, turbidity: t });
  const d = Math.max(0, depth);
  return floor.map((f, c) => {
    const T = Math.exp(-2 * O.atten[c] * d);
    const Ta = Math.exp(-2 * O.absorb[c] * d);
    // scattered light: hides the floor (T), but the part scattered forward still lights it (Ta)
    return f * (0.6 * T + 0.4 * Ta * Math.exp(-O.scatter * d)) + O.deep[c] * (1 - T);
  });
}

const v3 = (a) => `vec3(${a.map((x) => x.toFixed(5)).join(', ')})`;

/**
 * GLSL: the same optics. Needs the uniforms of render/waterSurface.js (WATER_UNIFORMS).
 *  wTurbidAt(depth) the effective turbidity there; wAbsorb(t), wScatter(t), wDeep(t), wVis(t);
 *  wSeen(floor, depth, t) the floor as seen from above through `depth` m of water;
 *  wCaustic(xz, t) the dancing light on a shallow floor; wSlick(xz) where the grease lies;
 *  wSheen(N, V, xz) its rainbow; wGlint(N, V, xz) the sun's glitter on the waves.
 */
export const WATER_GLSL = /* glsl */ `
uniform vec3 uWSunDir;
uniform vec3 uWSunCol;
uniform float uWSun, uWTime, uWClarity, uWTurbid, uWGrease, uWTurb;
float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1, 0)), u.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), u.x), u.y);
}
float wTurbidAt(float depth) {
  return clamp(uWTurbid + uWTurb * (0.15 + 0.6 * exp(-max(depth, 0.0) / 3.0)), 0.0, 1.0);
}
vec3 wAbsorb(float t) {
  return ${v3(PURE)} + (1.0 - uWClarity) * ${v3(PART)} + t * ${v3(SILT)} + uWGrease * ${GREASE_ABS.toFixed(3)};
}
float wScatter(float t) { return ${SCAT0.toFixed(4)} + ${SCAT_PART.toFixed(3)} * (1.0 - uWClarity) + ${SCAT_SILT.toFixed(3)} * t; }
vec3 wDeep(float t) {
  vec3 a = wAbsorb(t);
  vec3 b = vec3(wScatter(t)) + vec3(0.0006, 0.0012, 0.0026);
  return 0.42 * (b / (a + b)) * mix(vec3(1.0), vec3(1.0, 0.92, 0.68), t);
}
float wVis(float t) { return min(60.0, ${SECCHI.toFixed(2)} / (wAbsorb(t).g + wScatter(t))); }
// (k: the light's path down to the floor and back up to the eye, in depths: 2 looking straight
// down with the sun overhead, longer for a low sun or a slanting view)
vec3 wSeenK(vec3 floorCol, float depth, float t, float k) {
  vec3 a = wAbsorb(t);
  float s = wScatter(t);
  float d = max(depth, 0.0);
  vec3 T = exp(-k * (a + s) * d);
  vec3 Ta = exp(-k * a * d);
  return floorCol * (0.6 * T + 0.4 * Ta * exp(-0.5 * k * s * d)) + wDeep(t) * (1.0 - T);
}
vec3 wSeen(vec3 floorCol, float depth, float t) { return wSeenK(floorCol, depth, t, 2.0); }
// the path factor k for a view along V (from the surface to the eye) with the sun where it is
float wPath(vec3 V) { return 1.0 / max(0.35, normalize(uWSunDir).y) + 1.0 / max(0.3, abs(V.y)); }
// caustics: the waves focus the sunlight into a moving net of bright lines on a shallow floor
float wCaustic(vec2 xz, float t) {
  vec2 p = xz * 1.4;
  vec2 i = p;
  float c = 1.0;
  for (int n = 0; n < 3; n++) {
    float tt = t * 0.55 * (1.0 - 3.5 / float(n + 1));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / 0.006), p.y / (cos(i.y + tt) / 0.006)));
  }
  c /= 3.0;
  c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 1.0);
}
// a film of oil: in patches, drifting slowly (0..1)
float wSlick(vec2 xz) {
  if (uWGrease <= 0.0) return 0.0;
  float n = wNoise(xz * 0.06 + uWTime * 0.01) * 0.65 + wNoise(xz * 0.21 - uWTime * 0.02) * 0.35;
  return smoothstep(1.0 - uWGrease * 1.1, 1.05 - uWGrease * 0.85, n) * uWGrease;
}
// thin-film interference: the colours of oil on water, changing with the film's thickness and the angle
vec3 wSheen(vec3 N, vec3 V, vec2 xz, float slick) {
  // (the film thins and thickens over metres: broad bands of colour, shifting with the angle)
  float th = wNoise(xz * 0.18 + uWTime * 0.02) * 1.4 + wNoise(xz * 0.5 - uWTime * 0.01) * 0.4 + abs(normalize(V).y) * 0.5;
  vec3 rainbow = 0.5 + 0.5 * cos(6.2832 * (th + vec3(0.0, 0.33, 0.67)));
  return (rainbow - 0.35) * slick * (0.12 + 0.3 * pow(1.0 - abs(dot(N, V)), 2.0));
}
// the sun mirrored in the waves: a narrow core and a broad glitter path, sparkling
vec3 wGlint(vec3 N, vec3 V, vec2 xz, float slick) {
  if (uWSun <= 0.0) return vec3(0.0);
  vec3 R = reflect(-V, N);
  float s = max(dot(R, normalize(uWSunDir)), 0.0);
  float spark = smoothstep(0.55, 0.95, wNoise(xz * 9.0 + vec2(uWTime * 2.3, -uWTime * 1.7)) * 0.6 + wNoise(xz * 23.0 - uWTime * 3.1) * 0.4);
  float core = pow(s, mix(900.0, 2400.0, slick)) * 14.0;
  float path = pow(s, 70.0) * (0.25 + 5.0 * spark) * (1.0 - 0.8 * slick);
  return uWSunCol * uWSun * (core + path);
}
`;
