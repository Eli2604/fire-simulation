/**
 * A fire team (ai/squad.js): a commander, a gunner and two riflemen in formation, who advance on
 * the threat by bounding overwatch, from cover to cover. The threat is a point (offset from the
 * squad's position); set it in the scene or with the "Squad: set the threat" tool.
 * Drawn as the sculpted operator (operator/rig.js).
 * With a patrol drawn for them (in the editor's view, ai/patrol.js: a path, an area) they patrol
 * that instead, in file, as guards of their own team, until contact (then the squad AI as ever,
 * on the leash); the threat offset is then not used.
 * Side (ai/sides.js): red teams fight you and the blue ones; blue teams are yours and fight the
 * red ones (and green, a third side, fights both). The threat offset is only where they go first:
 * in a fight they go for the nearest hostile they have made out (ai/squad.js senses).
 */
import { PATROL_PARAMS, drawnPatrol } from '../ai/patrol.js';
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
    unit: { value: 'Alpha', options: ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'], label: 'Team call sign (each team its own: two teams with one call sign are one team)' },
    // whose side they are on (ai/sides.js): blue fight with you, red against you; teams of other sides fight each other
    side: { value: 'red', options: ['red', 'blue', 'green'], label: 'Side (red: the enemy, they fight you and blue teams; blue: on your side, they fight red teams; green: a third side, against both)' },
    flameTrooper: { value: false, label: 'Rifleman two carries a flame gun' },
    // the riflemen's primary (ai/weapons.js: each its grips, carry, aim, and what it allows: no roll with the flame gun...)
    riflemen: { value: 'rifle', options: ['rifle', 'shotgun', 'pistol', 'mixed', 'unarmed'], label: 'Riflemen carry (mixed: rifleman one a shotgun, the commander a pistol; unarmed: hand-to-hand)' },
    droneOperator: { value: false, label: 'A drone operator (deploys a drone from his backpack)' },
    level: { value: 0, min: 0, max: 20, step: 0.1, label: 'Floor height (m)' },
    skill: { value: 'mixed', options: ['mixed', 'recruit', 'regular', 'veteran', 'elite'], label: 'Experience: aim, recoil control, reaction, reload / switch / pick-up speed, nerve under fire, hand-to-hand (mixed: a veteran commander, regulars, a recruit)' },
    armour: { value: true, label: 'Body armour (plates) and helmets' },
    // their weapons' recoil (ai/recoil.js: physical from the cartridge and the weapon, times this) and fire mode
    recoil: { value: 1, min: 0, max: 3, step: 0.05, label: 'Weapon recoil (× the physical)' },
    fireMode: { value: 'weapon', options: ['weapon', 'single', 'burst', 'auto'], label: 'Fire mode (weapon: each its own; the MG on auto)' },
    // senses (ai/perception.js), scaled by the experience
    sightRange: { value: 400, min: 10, max: 1000, step: 5, label: 'Sight: how far they pick up an enemy in clear sight, daylight (m)' },
    fov: { value: 360, min: 60, max: 360, step: 5, label: 'Field of view (degrees; 360: all round, the team watching its sectors)' },
    hearing: { value: 1, min: 0, max: 3, step: 0.05, label: 'Hearing (× how far a sound carries)' },
    // lights (ai/flashlight.js): on the weapon, or a hand torch from the belt with a hand free
    weaponLight: { value: 'standard', options: ['standard', 'all', 'none'], label: 'Weapon lights (standard: rifle, carbine, shotgun; all: the pistol and MG too)' },
    flashlight: { value: true, label: 'A hand torch on the belt (used with the knife, a pistol or bare hands)' },
    force: { value: 1, min: 0, max: 5, step: 0.05, label: 'Force × (their blows, landings: sim/impact.js)' },
    // the retreat (ai/retreat.js, ai/retreatRadio.js): no button, the squad decides; this forces it or rules it out
    strategy: { value: 'auto', options: ['auto', 'retreat', 'no retreat'], label: 'Strategy on contact (auto: the squad decides by itself: the commander down, heavy casualties, outgunned, flanked, pinned down, low on ammunition; signals it, calls it in to friendly teams; retreat: forced, back at once; no retreat: never)' },
    rallyX: { value: 0, min: -60, max: 60, step: 0.5, label: "Rally point offset X (m; 0, 0: where they started if that is behind them, else back out of the enemy's sight)" },
    rallyZ: { value: 0, min: -60, max: 60, step: 0.5, label: 'Rally point offset Z (m)' },
    casualties: { value: 'auto', options: ['auto', 'carry', 'leave'], label: "A man down in a retreat (auto: by experience, the enemy's distance, his wounds, the men left; carry: fireman's carry; leave: he stays and covers them)" },
    tripwire: { value: true, label: 'The last man back through a door strings a tripwire with a charge across it' },
    // ropes (ai/ropeTeam.js): coils carried, one a man (rifleman one, rifleman two, the commander, the gunner, the drone operator)
    ropes: { value: 2, min: 0, max: 5, step: 1, label: 'Rope coils carried (one a man: the riflemen first); a man with one can lower a rope down a drop too deep to jump' },
    teamRope: { value: true, label: 'Team rope-down: on a roof or a cliff with the objective below, the leader can take them all down together (ropes side by side, a flashbang first)' },
    ...PATROL_PARAMS,
  },
  build(p) {
    const roles = [['CMD', -1, 0], ['MG', 1, 0.2], ['R1', -1.4, 1.6], ['R2', 1.4, 1.8]];
    if (p.droneOperator) roles.push(['UAV', 0, 3.2]);
    // who carries a rope coil: the riflemen first, then the commander, the gunner, the drone operator
    const ROPE_ORDER = ['R1', 'R2', 'CMD', 'MG', 'UAV'];
    const area = drawnPatrol(p);
    return {
      prims: [],
      enemies: roles.map(([squad, x, z]) => ({
        p: [x, p.level, z],
        squad,
        unit: p.unit,
        side: p.side ?? 'red',
        loadout: p.flameTrooper && squad === 'R2' ? 'torch' : loadoutOf(p.riflemen, squad),
        threat: area ? undefined : [p.threatX, p.level, p.threatZ],
        ...(area ? { area, routeStart: -1, guard: true } : {}),
        skill: p.skill !== 'mixed' ? p.skill : { CMD: 'veteran', MG: 'regular', R1: 'regular', R2: 'recruit', UAV: 'regular' }[squad],
        armour: p.armour !== false,
        recoil: p.recoil ?? 1,
        fireMode: p.fireMode && p.fireMode !== 'weapon' ? p.fireMode : undefined,
        sightRange: p.sightRange !== 400 ? p.sightRange : undefined, fov: p.fov, hearing: p.hearing, weaponLight: p.weaponLight === 'all' ? true : p.weaponLight === 'none' ? false : undefined, flashlight: p.flashlight !== false,
        forceScale: p.force ?? 1,
        ropes: ROPE_ORDER.indexOf(squad) < (p.ropes ?? 2) ? 1 : 0,
        teamRope: p.teamRope !== false ? undefined : false,
        retreat: {
          order: p.strategy === 'retreat',
          auto: p.strategy !== 'no retreat',
          rally: p.rallyX || p.rallyZ ? [p.rallyX, p.level, p.rallyZ] : null,
          casualties: p.casualties ?? 'auto',
          tripwire: p.tripwire !== false,
        },
      })),
    };
  },
};
