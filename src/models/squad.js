/**
 * A fire team (ai/squad.js): a commander, a gunner and two riflemen in formation, who advance on
 * the threat by bounding overwatch, from cover to cover. The threat is a point (offset from the
 * squad's position); set it in the scene or with the "Squad: set the threat" tool.
 * Drawn as the sculpted operator (operator/rig.js).
 */
export default {
  label: 'Squad (fire team)',
  params: {
    threatX: { value: 0, min: -60, max: 60, step: 0.5, label: 'Threat offset X (m)' },
    threatZ: { value: -20, min: -60, max: 60, step: 0.5, label: 'Threat offset Z (m)' },
    unit: { value: 'Alpha', options: ['Alpha', 'Bravo', 'Charlie'], label: 'Team call sign' },
    flameTrooper: { value: false, label: 'Rifleman two carries a flame gun' },
    level: { value: 0, min: 0, max: 20, step: 0.1, label: 'Floor height (m)' },
  },
  build(p) {
    const roles = [['CMD', -1, 0], ['MG', 1, 0.2], ['R1', -1.4, 1.6], ['R2', 1.4, 1.8]];
    return {
      prims: [],
      enemies: roles.map(([squad, x, z]) => ({ p: [x, p.level, z], squad, unit: p.unit, loadout: p.flameTrooper && squad === 'R2' ? 'torch' : undefined, threat: [p.threatX, p.level, p.threatZ] })),
    };
  },
};
