/**
 * Where enemies start (they are characters, not voxels) and the area they patrol:
 *  wander   stroll around their starting point (12 m)
 *  area     random spots inside a rectangle (patrol width x depth, offset from
 *           the group's position)
 *  route    walk the rectangle's corners in turn, like a guard round
 * After investigating a noise or luring you, they go back to their area.
 * A path or an area drawn in the editor's view (ai/patrol.js) takes the place of all three.
 * key: the first of the group is the jailer and carries the key to the dungeon cell
 * (models/catacombs.js); killed, he drops it.
 */
import { PATROL_PARAMS, drawnPatrol } from '../ai/patrol.js';

/** The k-th guard's weapon (undefined: a rifle). */
const weaponOf = (w, k) => (w === 'mixed' ? [undefined, 'shotgun', 'pistol'][k % 3] : w && w !== 'rifle' ? w : undefined);
export default {
  label: 'Enemies',
  params: {
    count: { value: 3, min: 1, max: 12, step: 1, label: 'Number' },
    spread: { value: 4, min: 0.5, max: 20, step: 0.5, label: 'Spread (m)' },
    level: { value: 0, min: 0, max: 20, step: 0.1, label: 'Floor height (m)' },
    patrol: { value: 'wander', options: ['wander', 'area', 'route'], label: 'Patrol' },
    patrolWidth: { value: 8, min: 1, max: 60, step: 0.5, label: 'Patrol area along X (m)' },
    patrolDepth: { value: 8, min: 1, max: 60, step: 0.5, label: 'Patrol area along Z (m)' },
    patrolOffsetX: { value: 0, min: -30, max: 30, step: 0.5, label: 'Patrol area offset X (m)' },
    patrolOffsetZ: { value: 0, min: -30, max: 30, step: 0.5, label: 'Patrol area offset Z (m)' },
    key: { value: false, label: 'The first carries the key to the dungeon cell (jailer)' },
    seed: { value: 1, min: 1, max: 999, step: 1, label: 'Random seed' },
    recoil: { value: 1, min: 0, max: 3, step: 0.05, label: 'Weapon recoil (× the physical)' },
    fireMode: { value: 'weapon', options: ['weapon', 'single', 'burst', 'auto'], label: 'Fire mode' },
    // what they carry (ai/weapons.js: grips, carry, aim, and what each allows); mixed: every third a shotgun, the next a pistol
    // experience (ai/soldier.js SKILL): aim, recoil control, reaction, reload / switch speed, nerve, hand-to-hand
    skill: { value: 'mixed', options: ['mixed', 'recruit', 'regular', 'veteran', 'elite'], label: 'Experience: aim, recoil control, reaction, reload / switch / pick-up speed, nerve under fire, hand-to-hand (mixed: the leader a veteran, regulars, a recruit)' },
    weapon: { value: 'rifle', options: ['rifle', 'shotgun', 'pistol', 'mixed', 'unarmed'], label: 'Weapon (unarmed: they fight hand-to-hand)' },
    // senses (ai/perception.js), scaled by the experience
    sightRange: { value: 22, min: 5, max: 1000, step: 5, label: 'Sight: how far they pick you up in clear sight, daylight (m)' },
    fov: { value: 360, min: 60, max: 360, step: 5, label: 'Field of view (degrees; 360: all round, the team watching its sectors)' },
    hearing: { value: 1, min: 0, max: 3, step: 0.05, label: 'Hearing (× how far a sound carries)' },
    // lights (ai/flashlight.js): on the weapon, or a hand torch from the belt with a hand free
    weaponLight: { value: 'standard', options: ['standard', 'all', 'none'], label: 'Weapon lights (standard: rifle, carbine, shotgun; all: the pistol and MG too)' },
    flashlight: { value: true, label: 'A hand torch on the belt (used with the knife, a pistol or bare hands)' },
    force: { value: 1, min: 0, max: 5, step: 0.05, label: 'Force × (their blows, landings: sim/impact.js)' },
    ...PATROL_PARAMS,
  },
  build(p, { rng }) {
    const enemies = [];
    const hw = p.patrolWidth / 2;
    const hd = p.patrolDepth / 2;
    const ox = p.patrolOffsetX;
    const oz = p.patrolOffsetZ;
    const drawn = drawnPatrol(p);
    const area = drawn ?? (p.patrol === 'wander' ? null : { mode: p.patrol, corners: [[ox - hw, p.level, oz - hd], [ox + hw, p.level, oz - hd], [ox + hw, p.level, oz + hd], [ox - hw, p.level, oz + hd]] });
    for (let k = 0; k < p.count; k++) {
      const a = rng() * Math.PI * 2;
      const r = rng() * p.spread;
      enemies.push({ p: [Math.cos(a) * r, p.level, Math.sin(a) * r], area, routeStart: drawn ? -1 : k, key: p.key && k === 0 ? 'dungeon' : undefined, recoil: p.recoil ?? 1, fireMode: p.fireMode && p.fireMode !== 'weapon' ? p.fireMode : undefined, loadout: weaponOf(p.weapon, k), skill: p.skill && p.skill !== 'mixed' ? p.skill : undefined, sightRange: p.sightRange !== 22 ? p.sightRange : undefined, fov: p.fov, hearing: p.hearing, weaponLight: p.weaponLight === 'all' ? true : p.weaponLight === 'none' ? false : undefined, flashlight: p.flashlight !== false, forceScale: p.force ?? 1 });
    }
    return { prims: [], enemies };
  },
};
