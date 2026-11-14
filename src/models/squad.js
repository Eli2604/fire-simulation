/**
 * A fire team (ai/squad.js): a commander, a gunner and two riflemen in formation, who advance on
 * the threat by bounding overwatch, from cover to cover. The threat is a point (offset from the
 * squad's position); set it in the scene or with the "Squad: set the threat" tool.
 * Drawn as the sculpted operator (operator/rig.js).
 */
/** A member's primary from the Riflemen option (undefined: a rifle; the gunner keeps his MG). */
function loadoutOf(opt, squad) {
  if (squad === 'MG' || squad === 'UAV' || !opt || opt === 'rifle') return undefined;
  if (opt === 'mixed') return { R1: 'shotgun', CMD: 'pistol' }[squad];
  return squad === 'CMD' ? undefined : opt;
}
export default {
  label: 'Squad (fire team)',
  params: {
    threatX: { value: 0, min: -60, max: 60, step: 0.5, label: 'Threat offset X (m)' },
    threatZ: { value: -20, min: -60, max: 60, step: 0.5, label: 'Threat offset Z (m)' },
    unit: { value: 'Alpha', options: ['Alpha', 'Bravo', 'Charlie'], label: 'Team call sign' },
    flameTrooper: { value: false, label: 'Rifleman two carries a flame gun' },
    // the riflemen's primary (ai/weapons.js: each its grips, carry, aim, and what it allows: no roll with the flame gun...)
    riflemen: { value: 'rifle', options: ['rifle', 'shotgun', 'pistol', 'mixed'], label: 'Riflemen carry (mixed: rifleman one a shotgun, the commander a pistol)' },
    droneOperator: { value: false, label: 'A drone operator (deploys a drone from his backpack)' },
    level: { value: 0, min: 0, max: 20, step: 0.1, label: 'Floor height (m)' },
    skill: { value: 'mixed', options: ['mixed', 'recruit', 'regular', 'veteran', 'elite'], label: 'Expertise (mixed: a veteran commander, regulars, a recruit)' },
    armour: { value: true, label: 'Body armour (plates) and helmets' },
    // their weapons' recoil (ai/recoil.js: physical from the cartridge and the weapon, times this) and fire mode
    recoil: { value: 1, min: 0, max: 3, step: 0.05, label: 'Weapon recoil (× the physical)' },
    fireMode: { value: 'weapon', options: ['weapon', 'single', 'burst', 'auto'], label: 'Fire mode (weapon: each its own; the MG on auto)' },
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
        loadout: p.flameTrooper && squad === 'R2' ? 'torch' : loadoutOf(p.riflemen, squad),
        threat: [p.threatX, p.level, p.threatZ],
        skill: p.skill !== 'mixed' ? p.skill : { CMD: 'veteran', MG: 'regular', R1: 'regular', R2: 'recruit', UAV: 'regular' }[squad],
        armour: p.armour !== false,
        recoil: p.recoil ?? 1,
        fireMode: p.fireMode && p.fireMode !== 'weapon' ? p.fireMode : undefined,
      })),
    };
  },
};
