/**
 * Footsteps and the rattle of a soldier's kit, as sounds (pure numbers, no Web Audio: tested in
 * Node; audio/sound.js SoundScape.footstep plays them). One footfall: the heel strike (a thud
 * filtered by what the ground is: a dull low one on soil and grass, a sharp click on concrete,
 * stone or a deck, a hollow knock on wood, a ring on metal), the ground's own noise after it (a
 * crunch on gravel and snow, a swish through grass and leaves, a splash wading), and the kit (a
 * few short metallic clicks: buckles, magazines, the sling swivel; more and louder the heavier
 * the load and the faster the pace). The loudness comes from ai/perception.js stepNoise (the same
 * numbers the AI hears by): dB at 1 m of the step and of the rattle.
 */

/** Per kind of ground: the heel strike (filter, centre Hz, Q, s) and its after-noise (or none). */
export const GROUND = {
  soil: { thud: ['lowpass', 380, 0.9, 0.09], after: null },
  grass: { thud: ['lowpass', 320, 0.8, 0.08], after: ['highpass', 3200, 0.6, 0.16] },
  leaves: { thud: ['lowpass', 340, 0.8, 0.08], after: ['bandpass', 4200, 0.7, 0.2] },
  gravel: { thud: ['lowpass', 520, 0.8, 0.07], after: ['bandpass', 2600, 0.9, 0.18] },
  snow: { thud: ['lowpass', 260, 0.8, 0.1], after: ['bandpass', 1500, 1.1, 0.22] },
  sand: { thud: ['lowpass', 300, 0.7, 0.1], after: ['highpass', 2400, 0.5, 0.14] },
  hard: { thud: ['bandpass', 1400, 1.6, 0.05], after: null },
  wood: { thud: ['bandpass', 520, 2.2, 0.08], after: null },
  metal: { thud: ['bandpass', 2300, 4.5, 0.12], after: null },
  water: { thud: ['lowpass', 600, 0.7, 0.08], after: ['bandpass', 1100, 0.8, 0.3] },
};
/** The ground kind for a material name (sim/materials.js names, groundMaterial, 'water' wading). */
export function groundKind(surface = 'soil') {
  const s = String(surface);
  if (/water|wade|puddle/i.test(s)) return 'water';
  if (/snow|ice/i.test(s)) return 'snow';
  if (/gravel|rubble|ash/i.test(s)) return 'gravel';
  if (/leaves|twigs|deadWood/i.test(s)) return 'leaves';
  if (/grass|turf|moss|hedge/i.test(s)) return 'grass';
  if (/sand/i.test(s)) return 'sand';
  if (/steel|metal|iron|copper|alumin|tin/i.test(s)) return 'metal';
  if (/wood|plank|deck|board|parquet/i.test(s)) return 'wood';
  if (/stone|concrete|brick|tile|marble|asphalt|rock|glass|granite/i.test(s)) return 'hard';
  return 'soil';
}
/** dB at 1 m to a gain (0 dB → 0, 60 dB → ~0.5): a compressed curve, as audio/physics.js gainOf. */
const gainOfDb = (db) => (db > 0 ? Math.min(1, 0.5 * 10 ** ((db - 60) / 40)) : 0);
/**
 * The layers of one footfall: [{ filter, freq, q, dur, level, delay }], the thud, the ground's
 * after-noise and the kit's clicks. o: surface, pace, step (dB), rattle (dB).
 */
export function footstepVoice({ surface = 'soil', pace = 'walk', step = 45, rattle = 0 } = {}) {
  const G = GROUND[groundKind(surface)];
  const hard = pace === 'run' || pace === 'sprint' ? 1.25 : pace === 'crawl' ? 0.5 : pace === 'sneak' ? 0.7 : 1;
  const L = gainOfDb(step);
  const out = [];
  const [f, hz, q, dur] = G.thud;
  out.push({ filter: f, freq: hz * (0.9 + 0.2 * hard), q, dur, level: L, delay: 0 });
  if (G.after) {
    const [af, ahz, aq, adur] = G.after;
    out.push({ filter: af, freq: ahz, q: aq, dur: adur * (pace === 'crawl' ? 1.6 : 1), level: L * 0.45, delay: 0.015 });
  }
  // the kit: a click or a few (the heavier and the faster, the more), metallic, bright, short
  if (rattle > 0) {
    const R = gainOfDb(rattle);
    const n = Math.max(1, Math.min(5, Math.round((rattle - 35) / 7)));
    for (let i = 0; i < n; i++) out.push({ filter: 'bandpass', freq: 3200 + 1800 * ((i * 0.618) % 1), q: 6, dur: 0.025, level: R * (1 - i * 0.12), delay: 0.03 + i * 0.045 });
  }
  return out;
}
