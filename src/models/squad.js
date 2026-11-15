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
 *
 * Settings (the editor shows them in folders, `group`):
 *  - Team: the number of soldiers (2..12) and their roles (ai/loadout.js ROLES: leader, rifleman,
 *    gunner, marksman, grenadier, medic, radio operator, drone operator, flame trooper, engineer,
 *    rope man; a default composition for each size, defaultComposition), any of them changed per
 *    man in the Men list (p.men[i].role). The AI's slots follow from the roles (codesFor: the
 *    leader CMD, gunners MG, the drone operator UAV, the rest riflemen split over fire teams A and B).
 *  - Experience and temper: the team's level (and per man), rank (display), fitness, morale,
 *    discipline, aggression (ai/experience.js).
 *  - Weapons per role, and team kit (armour, night vision, packs, rope coils); each man's loadout
 *    (ai/loadout.js KIT_FIELDS) can be changed in the Men list (p.men[i].kit). His load sets his
 *    pace, stamina, climbing, landings (the editor shows the weight and the speeds).
 */
import { PATROL_PARAMS, drawnPatrol } from '../ai/patrol.js';
import { ROLES, ROLE_KEYS, PRIMARY, ARMOUR, PACK, defaultComposition, codesFor, fullKit, kitMass, mobility, loadSummary } from '../ai/loadout.js';
import { LEVELS, RANKS, defaultRank } from '../ai/experience.js';

const G = { team: 'Team', exp: 'Experience & temper', wpn: 'Weapons per role', kit: 'Team kit', fire: 'Fire', senses: 'Senses & lights', strat: 'Strategy on contact', threat: 'Threat & place' };
/** Per-role weapon params: wpn_<role>, 'role' (the role's own: ai/loadout.js ROLES) or a primary. */
const WPN = Object.fromEntries(ROLE_KEYS.filter((r) => r !== 'flame').map((r) => [`wpn_${r}`, { value: 'role', options: ['role', ...Object.keys(PRIMARY).filter((k) => k !== 'flamer')], label: `${ROLES[r].label}: primary (role: ${PRIMARY[fullKit(r).primary].label})`, group: G.wpn }]));

export default {
  label: 'Squad (fire team)',
  params: {
    threatX: { value: 0, min: -60, max: 60, step: 0.5, label: 'Threat offset X (m)', group: G.threat },
    threatZ: { value: -20, min: -60, max: 60, step: 0.5, label: 'Threat offset Z (m)', group: G.threat },
    unit: { value: 'Alpha', options: ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'], label: 'Team call sign (each team its own: two teams with one call sign are one team)', group: G.team },
    // whose side they are on (ai/sides.js): blue fight with you, red against you; teams of other sides fight each other
    side: { value: 'red', options: ['red', 'blue', 'green'], label: 'Side (red: the enemy, they fight you and blue teams; blue: on your side, they fight red teams; green: a third side, against both)', group: G.team },
    // how many, and who (ai/loadout.js: the default composition for the size; each man's role in the Men list)
    size: { value: 4, min: 2, max: 12, step: 1, label: 'Number of soldiers (2..12; the roles: the default composition for the size, each changed in the Men list)', group: G.team },
    flameTrooper: { value: false, label: 'Rifleman two carries a flame gun', group: G.team },
    // the riflemen's primary (ai/weapons.js: each its grips, carry, aim, and what it allows: no roll with the flame gun...)
    riflemen: { value: 'rifle', options: ['rifle', 'shotgun', 'pistol', 'mixed', 'unarmed'], label: 'Riflemen carry (mixed: rifleman one a shotgun, the commander a pistol; unarmed: hand-to-hand)', group: G.wpn },
    droneOperator: { value: false, label: 'A drone operator (deploys a drone from his backpack; one more man)', group: G.team },
    level: { value: 0, min: 0, max: 20, step: 0.1, label: 'Floor height (m)', group: G.threat },
    skill: { value: 'mixed', options: ['mixed', ...LEVELS], label: 'Experience: aim, recoil control, reaction, threat identification, reload / switch / pick-up speed, nerve under fire, use of cover, the leader\'s choices, hand-to-hand (mixed: a veteran commander, regulars, a recruit; each man can be changed in the Men list)', group: G.exp },
    fitness: { value: 0.5, min: 0, max: 1, step: 0.05, label: 'Fitness (0.5 a regular soldier: how well they carry their load: pace, stamina, climbing)', group: G.exp },
    morale: { value: 0.5, min: 0, max: 1, step: 0.05, label: 'Morale (how far outmatched before they give ground or pull out)', group: G.exp },
    discipline: { value: 0.5, min: 0, max: 1, step: 0.05, label: 'Discipline (steadiness under fire: how readily they flinch into a roll, hold their fire)', group: G.exp },
    aggression: { value: 0.5, min: 0, max: 1, step: 0.05, label: 'Aggression (the leader: attack and flank, or hold and defend)', group: G.exp },
    armour: { value: true, label: 'Body armour (plates) and helmets', group: G.kit },
    armourLevel: { value: 'plates', options: Object.keys(ARMOUR).filter((k) => k !== 'none'), label: 'Armour when worn (soft: a vest against pistol rounds and fragments; plates; heavy: side plates, shoulders)', group: G.kit },
    nvg: { value: 'leader', options: ['leader', 'all', 'none'], label: 'Night vision (the leader, everyone, no one)', group: G.kit },
    packs: { value: 'role', options: ['role', ...Object.keys(PACK)], label: 'Backpacks (role: an assault pack, the radio operator and the rope man a rucksack)', group: G.kit },
    // their weapons' recoil (ai/recoil.js: physical from the cartridge and the weapon, times this) and fire mode
    recoil: { value: 1, min: 0, max: 3, step: 0.05, label: 'Weapon recoil (× the physical)', group: G.fire },
    fireMode: { value: 'weapon', options: ['weapon', 'single', 'burst', 'auto'], label: 'Fire mode (weapon: each its own; the MG on auto)', group: G.fire },
    // senses (ai/perception.js), scaled by the experience
    sightRange: { value: 400, min: 10, max: 1000, step: 5, label: 'Sight: how far they pick up an enemy in clear sight, daylight (m)', group: G.senses },
    fov: { value: 360, min: 60, max: 360, step: 5, label: 'Field of view (degrees; 360: all round, the team watching its sectors)', group: G.senses },
    hearing: { value: 1, min: 0, max: 3, step: 0.05, label: 'Hearing (× how far a sound carries)', group: G.senses },
    // lights (ai/flashlight.js): on the weapon, or a hand torch from the belt with a hand free
    weaponLight: { value: 'standard', options: ['standard', 'all', 'none'], label: 'Weapon lights (standard: rifle, carbine, shotgun; all: the pistol and MG too)', group: G.senses },
    flashlight: { value: true, label: 'A hand torch on the belt (used with the knife, a pistol or bare hands)', group: G.senses },
    force: { value: 1, min: 0, max: 5, step: 0.05, label: 'Force × (their blows, landings: sim/impact.js)', group: G.fire },
    // the retreat (ai/retreat.js, ai/retreatRadio.js): no button, the squad decides; this forces it or rules it out
    strategy: { value: 'auto', options: ['auto', 'retreat', 'no retreat'], label: 'Strategy on contact (auto: the squad decides by itself: the commander down, heavy casualties, outgunned, flanked, pinned down, low on ammunition; signals it, calls it in to friendly teams; retreat: forced, back at once; no retreat: never)', group: G.strat },
    rallyX: { value: 0, min: -60, max: 60, step: 0.5, label: "Rally point offset X (m; 0, 0: where they started if that is behind them, else back out of the enemy's sight)", group: G.strat },
    rallyZ: { value: 0, min: -60, max: 60, step: 0.5, label: 'Rally point offset Z (m)', group: G.strat },
    casualties: { value: 'auto', options: ['auto', 'carry', 'leave'], label: "A man down in a retreat (auto: by experience, the enemy's distance, his wounds, the men left; carry: fireman's carry; leave: he stays and covers them)", group: G.strat },
    tripwire: { value: true, label: 'The last man back through a door strings a tripwire with a charge across it', group: G.strat },
    // ropes (ai/ropeTeam.js): coils carried, one a man (the riflemen first, then the commander, the gunner, the drone operator)
    ropes: { value: 2, min: 0, max: 12, step: 1, label: 'Rope coils carried (one a man: the riflemen first; a rope man always has one); a man with one can lower a rope down a drop too deep to jump', group: G.kit },
    teamRope: { value: true, label: 'Team rope-down: on a roof or a cliff with the objective below, the leader can take them all down together (ropes side by side, a flashbang first)', group: G.kit },
    ...WPN,
    // each man: { role?, skill?, rank?, fitness?, kit?: { ...ai/loadout.js KIT_FIELDS } } (editor/squadPanel.js); unset: the team's
    men: { value: [], list: true, label: 'Men (per soldier: role, experience, rank, loadout)' },
    ...PATROL_PARAMS,
  },
  build(p) {
    const area = drawnPatrol(p);
    return {
      prims: [],
      enemies: squadMen(p).map((m) => ({
        p: [m.x, p.level ?? 0, m.z],
        squad: m.code,
        unit: p.unit,
        side: p.side ?? 'red',
        loadout: m.loadout,
        squadRole: m.role,
        rank: m.rank,
        kit: m.kit,
        fitness: m.fitness,
        morale: p.morale ?? 0.5,
        discipline: m.discipline,
        aggression: p.aggression ?? 0.5,
        threat: area ? undefined : [p.threatX ?? 0, p.level ?? 0, p.threatZ ?? -20],
        ...(area ? { area, routeStart: -1, guard: true } : {}),
        skill: m.skill,
        armour: m.kit.armour !== 'none',
        recoil: p.recoil ?? 1,
        fireMode: p.fireMode && p.fireMode !== 'weapon' ? p.fireMode : undefined,
        sightRange: p.sightRange !== 400 && p.sightRange != null ? p.sightRange : undefined, fov: p.fov ?? 360, hearing: p.hearing ?? 1, weaponLight: p.weaponLight === 'all' ? true : p.weaponLight === 'none' ? false : undefined, flashlight: p.flashlight !== false,
        forceScale: p.force ?? 1,
        ropes: m.kit.rope ? 1 : 0,
        teamRope: p.teamRope !== false ? undefined : false,
        retreat: {
          order: p.strategy === 'retreat',
          auto: p.strategy !== 'no retreat',
          rally: p.rallyX || p.rallyZ ? [p.rallyX, p.level ?? 0, p.rallyZ] : null,
          casualties: p.casualties ?? 'auto',
          tripwire: p.tripwire !== false,
        },
      })),
    };
  },
};

/** Where the k-th man starts: two columns, the first five where the fire team always stood. */
function startAt(k, n, drone) {
  if (drone) return [0, Math.ceil(n / 2) * 1.6];
  const row = Math.floor(k / 2), side = k % 2 ? 1 : -1;
  return [side * (1 + 0.4 * (row % 2)), row * 1.6 + (k % 2) * 0.2];
}

/**
 * The team as the params make it: for each man { role, code (the AI's slot), skill, rank, fitness,
 * discipline, kit (complete), loadout (the rig's and the AI's primary name), x, z, mass (kg),
 * summary (weight and speeds) }. The editor's Men list and the rig's Loadout panel show these.
 */
export function squadMen(p = {}) {
  const n = Math.max(2, Math.min(12, Math.round(p.size ?? 4)));
  const per = Array.isArray(p.men) ? p.men : [];
  const roles = defaultComposition(n).slice(0, n);
  // the old switches: rifleman two a flame trooper (or the last rifleman in a smaller team)
  if (p.flameTrooper) {
    const k = roles.length > 3 && roles[3] === 'rifleman' ? 3 : roles.lastIndexOf('rifleman');
    if (k >= 0) roles[k] = 'flame';
  }
  for (let i = 0; i < n; i++) if (per[i]?.role && ROLES[per[i].role]) roles[i] = per[i].role;
  if (p.droneOperator && !roles.includes('drone')) roles.push('drone');
  if (per[roles.length - 1]?.role && ROLES[per[roles.length - 1].role] && roles.length > n) roles[roles.length - 1] = per[roles.length - 1].role;
  const codes = codesFor(roles);
  // who carries a rope coil: rope men always; then `ropes` more, the riflemen first, then the commander, the gunner, the drone operator
  const RANK_ORDER = ['R1', 'R2', 'CMD', 'MG', 'UAV'];
  const order = roles.map((_, i) => i).filter((i) => roles[i] !== 'rope').sort((a, b) => RANK_ORDER.indexOf(codes[a]) - RANK_ORDER.indexOf(codes[b]) || a - b);
  const coil = new Set(order.slice(0, Math.max(0, p.ropes ?? 2)));
  let firstRifleman = true;
  return roles.map((role, i) => {
    const code = codes[i];
    const own = per[i] ?? {};
    // the team's level ('mixed': a veteran leader, a recruit as rifleman two, the rest regulars)
    const skill = own.skill && LEVELS.includes(own.skill) ? own.skill : p.skill && p.skill !== 'mixed' ? p.skill : role === 'leader' && code === 'CMD' ? 'veteran' : i === 3 && code === 'R2' && (role === 'rifleman' || role === 'flame') ? 'recruit' : 'regular';
    // the kit: the role's, the team's settings, the role's weapon, then this man's own fields
    const over = {};
    const w = p[`wpn_${role}`];
    if (w && w !== 'role' && PRIMARY[w]) over.primary = w;
    if (role === 'rifleman' || (role === 'leader' && p.riflemen === 'mixed')) {
      const opt = p.riflemen;
      if (opt === 'shotgun' || opt === 'pistol') over.primary = role === 'leader' ? undefined : opt;
      else if (opt === 'unarmed') over.primary = role === 'leader' ? undefined : 'none';
      else if (opt === 'mixed') {
        if (role === 'leader') over.primary = 'pistol';
        else if (firstRifleman) over.primary = 'shotgun';
      }
      if (role === 'rifleman') firstRifleman = false;
    }
    if (p.armour === false) Object.assign(over, { armour: 'none', helmet: false });
    else if (p.armourLevel && ARMOUR[p.armourLevel]) over.armour = p.armourLevel;
    if (p.nvg === 'all') over.nvg = true;
    else if (p.nvg === 'none') over.nvg = false;
    if (p.packs && p.packs !== 'role' && PACK[p.packs] && role !== 'flame') over.pack = p.packs;
    over.rope = role === 'rope' || coil.has(i);
    const kit = fullKit(role, { ...over, ...(own.kit ?? {}) });
    const fitness = Number.isFinite(own.fitness) ? own.fitness : p.fitness ?? 0.5;
    const [x, z] = startAt(i, n, i >= n && role === 'drone');
    const W = kitMass(kit);
    return {
      role, code, skill, kit, fitness,
      discipline: Number.isFinite(own.discipline) ? own.discipline : p.discipline ?? 0.5,
      rank: own.rank && RANKS.includes(own.rank) ? own.rank : defaultRank(skill, role),
      loadout: PRIMARY[kit.primary].loadout,
      x, z,
      mass: W.total,
      mob: mobility(W.total, { fitness }),
      summary: loadSummary(kit, fitness),
    };
  });
}
