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
    droneOperator: { value: false, label: 'A drone operator (deploys a drone from his backpack)' },
    level: { value: 0, min: 0, max: 20, step: 0.1, label: 'Floor height (m)' },
    skill: { value: 'mixed', options: ['mixed', 'recruit', 'regular', 'veteran', 'elite'], label: 'Expertise (mixed: a veteran commander, regulars, a recruit)' },
    armour: { value: true, label: 'Body armour (plates) and helmets' },
  },
  build(p) {
    const roles = [['CMD', -1, 0], ['MG', 1, 0.2], ['R1', -1.4, 1.6], ['R2', 1.4, 1.8]];
    if (p.droneOperator) roles.push(['UAV', 0, 3.2]);
    return {
      prims: [],
      enemies: roles.map(([squad, x, z]) => ({
        p: [x, p.level, z],
        squad,
        unit: p.unit,
        loadout: p.flameTrooper && squad === 'R2' ? 'torch' : undefined,
        threat: [p.threatX, p.level, p.threatZ],
        skill: p.skill !== 'mixed' ? p.skill : { CMD: 'veteran', MG: 'regular', R1: 'regular', R2: 'recruit', UAV: 'regular' }[squad],
        armour: p.armour !== false,
      })),
    };
  },
};
