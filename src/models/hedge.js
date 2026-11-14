/**
 * A garden hedge: a row of clipped shrubs, a dense skin of foliage over a tangle of twigs and
 * stems. Kinds burn very differently: a conifer hedge (thuja, leylandii; resinous scale
 * leaves) dries out in a dry spell and goes up like a torch, carrying a fire along a garden
 * to the house it stands against; privet and beech (broad leaves, full of water when alive)
 * scorch and brown long before they burn; a dead, dried-out hedge burns like brushwood.
 * It runs along x.
 */
const KINDS = {
  conifer: { leaves: 'needles', color: [0.16, 0.33, 0.15], moisture: 0.9 },
  privet: { leaves: 'leaves', color: [0.22, 0.4, 0.14], moisture: 1.4 },
  beech: { leaves: 'leaves', color: [0.3, 0.42, 0.16], moisture: 1.2 },
  dead: { leaves: 'leaves', color: [0.52, 0.4, 0.22], moisture: 0.12 },
};

export default {
  label: 'Hedge',
  params: {
    kind: { value: 'conifer', options: Object.keys(KINDS), label: 'Kind' },
    length: { value: 6, min: 0.5, max: 30, step: 0.1, label: 'Length (m)' },
    height: { value: 1.6, min: 0.4, max: 4, step: 0.05, label: 'Height (m)' },
    thickness: { value: 0.8, min: 0.3, max: 2, step: 0.05, label: 'Thickness (m)' },
    dryness: { value: 0, min: 0, max: 1, step: 0.05, label: 'Drought (0 watered, 1 parched)' },
    seed: { value: 1, min: 1, max: 999, step: 1, label: 'Random seed' },
  },
  build(p) {
    const K = KINDS[p.kind] ?? KINDS.conifer;
    const dead = p.kind === 'dead';
    // a dry spell takes the water out of the foliage (down to a third of it)
    const moisture = K.moisture * (1 - 0.65 * p.dryness);
    const L = p.length / 2;
    const T = p.thickness / 2;
    const H = p.height;
    const prims = [
      // the stems and the twigs inside: a loose woody core (living wood, thin: its cross-section
      // as density; a dead hedge's is dry brushwood)
      { shape: 'box', min: [-L + 0.05, 0, -T * 0.6], max: [L - 0.05, H * 0.92, T * 0.6], material: dead ? 'twigs' : 'bark', density: dead ? 1 : 0.03, mode: 'fill', fill: 0.35, moisture: dead ? undefined : Math.max(0.4, moisture * 0.5), color: [0.42, 0.32, 0.2], seed: p.seed },
      // the clipped outer skin of foliage, rounded on top
      { shape: 'box', min: [-L, 0.15, -T], max: [L, Math.max(0.3, H - T), T], material: K.leaves, mode: 'fill', fill: 0.85, moisture, color: K.color, variation: 0.15, seed: p.seed + 1 },
      { shape: 'capsule', a: [-L + T * 0.5, Math.max(T, H - T), 0], b: [L - T * 0.5, Math.max(T, H - T), 0], r: T, material: K.leaves, mode: 'fill', fill: 0.85, moisture, color: K.color, variation: 0.15, seed: p.seed + 2 },
    ];
    return { prims, ignite: { p: [-L + 0.2, 0.3, 0], radius: 0.3, power: 4000 } };
  },
};
