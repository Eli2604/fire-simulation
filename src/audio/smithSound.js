/**
 * A smithy's sounds from its physics (no Web Audio here: pure numbers, tested in Node; audio/
 * sound.js plays them: strike() for the blows, two loops for the quench and the bellows). The
 * smithy (sim/smithy.js) reports the state they come from:
 *
 *  - a hammer blow (an 'impact' event of kind 'hammer'): the hammer's mass and its head's speed at
 *    contact give the energy (½mv²) and, with the two steels' stiffness, the Hertz contact (its
 *    time sets how bright the blow is: audio/physics.js contact). Then modal synthesis of what
 *    rings: the anvil (a block of steel ~0.45 m long: its modes ~1 kHz and up, ringing for
 *    seconds, the classic anvil ring; a hot work piece lying on its face damps it), the blade
 *    (a thin bar: its flexural modes from its length and thickness, f ∝ c·t/L²) and the hammer's
 *    head. The blade's steel is at the temperature its voxels have: hot steel is softer (lower E:
 *    lower modes), far more damped (it thuds instead of ringing) and yields under the blow (a
 *    longer, plastic contact: a duller spectrum, and most of the blow goes into shaping it, not
 *    into sound: quieter). As it cools it rings brighter. Scale (the oxide skin) flakes off a blade
 *    over ~750 °C and spatters: a fast patter of tiny clicks, more the hotter it is.
 *  - a tap on the bare anvil (the smith keeps his rhythm, the hammer bounces on the face): the
 *    anvil's ring undamped, the hammer's head.
 *  - the quench: steam leaving the water at the rate the voxels boil it off (kg/s): the hiss
 *    (physics.js steamHiss) and the crackle of collapsing vapour bubbles while the steel is in
 *    nucleate boiling.
 *  - the bellows: the air through the tuyere (kg/s): a jet through the tuyere's ~3 cm throat, its noise ∝
 *    the jet's kinetic power, its spectrum peaking at a Strouhal frequency ~0.5·v/D (a whoosh).
 */
import { mechanics } from '../sim/materials.js';
import { atTemperature, contact, modes, dbOf, gainOf, steamHiss, RHO_AIR } from './physics.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const excite = (f, tc) => 1 / (1 + (2 * f * tc) ** 2);

/** The anvil and the hammer of a village smithy. */
export const ANVIL = { size: 0.45, mass: 60 };
export const HAMMER = { mass: 1.4, head: 0.1 };

/**
 * A blow of the hammer. o: { mass (kg), speed (m/s at contact), bare (on the anvil's face, no
 * work piece), bladeT (°C), anvilT, hammerT, blade: { length, thickness (m) }, anvil: { size } }.
 * → { db, gain, contact, partials, noise, scale, dur, anvilTau, bladeF1, energy } (the shape
 * audio/sound.js strike() plays).
 */
export function hammerBlow(o = {}) {
  const m = o.mass ?? HAMMER.mass;
  const v = o.speed ?? 7;
  const E = 0.5 * m * v * v;
  const steel = mechanics('steel');
  const hammer = atTemperature(steel, o.hammerT ?? 20);
  const anvil = atTemperature(steel, o.anvilT ?? 20);
  const bare = !!o.bare;
  const work = bare ? anvil : atTemperature(steel, o.bladeT ?? 20);
  // the contact: the hammer's face on the work piece (or the bare anvil); a flat-ish face ~1-1.5 cm
  const ct = contact(hammer, work, { mass: m, speed: v, radius: o.radius ?? 0.015 });
  // what of the blow is heard: the struck steel's radiation share, less what goes into shaping it
  const plastic = 0.15 + 0.85 * (work.hardness / steel.hardness) ** 2;
  const rad = steel.radiation * plastic;
  const db = dbOf(E * rad);
  const gain = gainOf(db);
  const partials = [];
  const add = (md, w) =>
    md.f.forEach((f, i) => {
      const amp = w * md.amp[i] * excite(f, ct.tc);
      if (amp > 0.01) partials.push({ f, tau: md.tau[i], amp });
    });
  // the anvil: a work piece on its face (hot, soft, pressed down by the blow) damps its ring
  const A = o.anvil ?? ANVIL;
  const anvilModes = modes(anvil, A.size, 'bar', 0.15,bare ? 0 : 0.004 + 0.01 * clamp(((o.bladeT ?? 20) - 400) / 700, 0, 1));
  add(anvilModes, bare ? 1 : 0.55);
  // the blade: a thin bar, its flexural modes
  let bladeF1 = 0;
  if (!bare) {
    const bl = o.blade ?? { length: 0.84, thickness: 0.005 };
    const md = modes(work, bl.length, 'bar', bl.thickness / bl.length);
    bladeF1 = md.f1;
    add(md, 1);
  }
  // the hammer's head: a short block
  add(modes(hammer, HAMMER.head, 'block'), 0.3);
  partials.sort((x, y) => y.amp - x.amp);
  partials.length = Math.min(partials.length, 8);
  // the contact noise: as long and as bright as the contact
  const noise = { amp: bare ? 0.3 : 0.35, cutoff: clamp(ct.cutoff * 1.5, 80, 16000), dur: clamp(ct.tc * 4 + 0.015, 0.01, 0.3) };
  // scale spattering off a hot blade
  const hot = bare ? 0 : clamp(((o.bladeT ?? 20) - 750) / 400, 0, 1);
  const scale = hot > 0 ? { n: Math.round(3 + 14 * hot), band: 3500 + 2500 * hot, spread: 0.08 + 0.2 * hot, amp: 0.15 + 0.2 * hot } : null;
  const ring = partials.length ? Math.max(...partials.map((p) => p.tau)) : 0;
  return { db, gain, contact: ct, partials, noise, scale, bubbles: null, shards: null, boom: null, dur: Math.min(8, Math.max(noise.dur, ring * 3)), anvilTau: anvilModes.tau[0], bladeF1, energy: E };
}

/** The spectral centre of a blow (Hz): its partials and contact noise weighted by amplitude. */
export function brightness(S) {
  let s = 0, w = 0;
  for (const p of S.partials) {
    s += p.f * p.amp;
    w += p.amp;
  }
  s += S.noise.cutoff * S.noise.amp;
  w += S.noise.amp;
  return w > 0 ? s / w : 0;
}

/**
 * The quench heard: steam leaving the water at `rate` kg/s off steel at T °C. → { gain, band,
 * crackle (0..1: collapsing vapour bubbles, nucleate boiling), rate }.
 */
export function quenchSizzle(rate = 0, T = 20) {
  const h = steamHiss(rate);
  const nucleate = T > 100 && T < 500 ? 1 : T >= 500 ? 0.35 : 0;
  return { gain: h.gain, band: h.band, crackle: rate > 0 ? clamp(nucleate * (0.3 + 0.2 * Math.log10(1 + rate * 1e4)), 0, 1) : 0, rate };
}

/**
* The bellows blowing `air` kg/s through the tuyere's throat of diameter D (m). → { gain, peak (Hz),
 * cutoff, v }. The jet's noise power ~1e-4 of its kinetic power (low speed: a whoosh), its broad
 * peak at a Strouhal number of ~0.5 (0.5·v/D).
 */
export function bellowsWhoosh(air = 0, D = 0.03) {
  const A = (Math.PI * D * D) / 4;
  const v = Math.max(0, air) / (RHO_AIR * A);
  const P = 1e-4 * 0.5 * Math.max(0, air) * v * v;
  const db = dbOf(P);
  return { gain: air > 0 ? gainOf(db, 98, 1.2) : 0, peak: clamp((0.5 * v) / D, 30, 1500), cutoff: clamp(250 + 60 * v, 250, 3000), v };
}
