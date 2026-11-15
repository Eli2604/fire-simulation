/**
 * A soldier's loadout: what he carries, what it weighs, and what the weight does to him.
 * Pure logic (no three.js): the squad and guard AIs (ai/soldier.js kit → applyKit), the models
 * (models/squad.js per-man list, models/enemy.js, models/campPatrol.js), the editor's readout and
 * the rig stage's Loadout panel all use it; the rig draws what it says (operator/rig.js setLoadout).
 *
 * A kit is a plain object (KIT_FIELDS; anything left out: the role's default, else a rifleman's):
 *   primary   rifle | carbine | mg | shotgun | marksman | pistol | flamer | none
 *   mags      spare magazines for it (the gunner: 100-round belts; the shotgun: 7-shell reloads)
 *   sidearm   carbine (the compact 9 mm across the back) | pistol (a holster) | none; sideMags
 *   frag, smoke, flash   hand grenades of each kind
 *   pack      none | assault (a day pack) | rucksack (a full ruck)
 *   armour    none | soft (a vest: pistol rounds, fragments) | plates (front and back) | heavy
 *             (plates, side plates, shoulder and groin protection)
 *   helmet, nvg (night vision on the helmet), knife, torch (the hand torch), rope (a rope coil),
 *   drone (the drone kit in the pack), breach (breaching kit: charges, a halligan)   booleans
 *   radio     none | handheld | manpack;  medkit  none | ifak | bag (the medic's bag)
 *   water     litres
 * Masses are realistic (kg, loaded: a magazine with its rounds, a canteen full).
 *
 * The total (with the uniform and boots) sets, through mobility(): walk / run / sprint speed and
 * acceleration (falling off past ~10 % of his body mass: Knapik's loaded-march data, roughly),
 * stamina drain and recovery, how high he can climb and vault, rope work, swimming (a heavy load
 * sinks him), how hard a fall lands (fallK) and the rattle he makes moving (noiseDb). Fitness
 * (0..1, 0.5 a regular soldier's) carries a load better. Armour reduces what a hit does, per hit
 * area (armourPen, armourDamageK: sim/wounds.js).
 */
import { HANDLING } from './weapons.js';

export const BODY_KG = 80; // the man himself
export const UNIFORM_KG = 4; // uniform, boots, belt

/** Primary weapons: label, kg (empty, with its optic), the magazine (rounds, kg loaded), default spares, the AI's names. */
export const PRIMARY = {
  rifle: { label: 'Rifle (5.56 mm)', kg: HANDLING.rifle.mass, mag: { rounds: 30, kg: 0.49 }, mags: 5, arms: 'rifle', loadout: undefined, rig: 'rifle' },
  carbine: { label: 'Carbine (5.56 mm, short)', kg: 3.0, mag: { rounds: 30, kg: 0.49 }, mags: 5, arms: 'carbine', loadout: 'carbine', rig: 'rifle' },
  mg: { label: 'Machine gun (7.62 mm)', kg: HANDLING.mg.mass, mag: { rounds: 100, kg: 3.1 }, mags: 2, arms: 'mg', loadout: 'mg', rig: 'mg' },
  shotgun: { label: 'Pump shotgun (12 gauge)', kg: HANDLING.shotgun.mass, mag: { rounds: 7, kg: 0.33 }, mags: 4, arms: 'shotgun', loadout: 'shotgun', rig: 'shotgun' },
  marksman: { label: 'Marksman rifle (7.62 mm, scoped)', kg: 4.9, mag: { rounds: 20, kg: 0.72 }, mags: 5, arms: 'marksman', loadout: 'marksman', rig: 'rifle' },
  pistol: { label: 'Pistol (9 mm) only', kg: HANDLING.pistol.mass, mag: { rounds: 15, kg: 0.28 }, mags: 3, arms: 'pistol', loadout: 'pistol', rig: 'pistol' },
  flamer: { label: 'Flame gun (tanks on the back, filled)', kg: HANDLING.torch.mass, mag: null, mags: 0, arms: null, loadout: 'torch', rig: 'torch' },
  none: { label: 'None (hand-to-hand)', kg: 0, mag: null, mags: 0, arms: null, loadout: 'unarmed', rig: 'unarmed' },
};
export const SIDEARM = {
  carbine: { label: 'Compact carbine (9 mm, across the back)', kg: 2.2, mag: { rounds: 20, kg: 0.3 }, mags: 2, arms: 'secondary' },
  pistol: { label: 'Pistol (9 mm, holster)', kg: 0.9, mag: { rounds: 15, kg: 0.28 }, mags: 2, arms: 'pistol' },
  none: { label: 'None', kg: 0, mag: null, mags: 0, arms: null },
};
export const GRENADE_KG = { frag: 0.4, smoke: 0.5, flash: 0.45 };
export const PACK = { none: { label: 'None', kg: 0 }, assault: { label: 'Assault pack (day pack)', kg: 4 }, rucksack: { label: 'Rucksack (full ruck)', kg: 18 } };
/**
 * Armour: kg, and per hit area the chance a round of each kind still gets through (pen: × the
 * weapon's own plate penetration, sim/wounds.js WEAPONS; or a fixed chance) and what one that does
 * still does (dmg ×). 'plates' is the plate carrier the squad has always worn (the weapon's pen as is).
 */
export const ARMOUR = {
  none: { label: 'None', kg: 0, zones: {} },
  soft: {
    label: 'Soft vest (IIIA: pistol rounds, fragments)', kg: 3,
    zones: { torso: { pen: { rifle: 0.95, mg: 1, marksman: 1, carbine: 0.15, pistol: 0.1, shotgun: 0.12, fragment: 0.25, knife: 0.6, arrow: 0.3 }, dmg: 0.85 } },
  },
  plates: { label: 'Plate carrier (front and back plates)', kg: 9, zones: { torso: { penK: 1, dmg: 1 } } },
  heavy: {
    label: 'Heavy armour (plates, side plates, shoulders, groin)', kg: 13.5,
    zones: { torso: { penK: 0.5, dmg: 0.8 }, armL: { pen: { rifle: 0.9, mg: 1, marksman: 1, carbine: 0.3, pistol: 0.2, shotgun: 0.25, fragment: 0.3, knife: 0.7, arrow: 0.4 }, dmg: 0.85 }, armR: { pen: { rifle: 0.9, mg: 1, marksman: 1, carbine: 0.3, pistol: 0.2, shotgun: 0.25, fragment: 0.3, knife: 0.7, arrow: 0.4 }, dmg: 0.85 } },
  },
};
export const RADIO = { none: { label: 'None', kg: 0 }, handheld: { label: 'Handheld (on the chest)', kg: 0.5 }, manpack: { label: 'Manpack (long-range, whip antenna)', kg: 4.5 } };
export const MEDKIT = { none: { label: 'None', kg: 0 }, ifak: { label: 'IFAK (his own first aid kit)', kg: 0.5 }, bag: { label: "Medic's bag", kg: 7 } };
/** The flat items (on or off). */
export const FLAT = {
  helmet: { label: 'Helmet', kg: 1.5 },
  nvg: { label: 'Night vision (on the helmet)', kg: 0.7 },
  knife: { label: 'Knife', kg: 0.3 },
  torch: { label: 'Hand torch', kg: 0.2 },
  rope: { label: 'Rope coil (30 m, harness)', kg: 3.5 },
  drone: { label: 'Drone kit (in the pack)', kg: 4 },
  breach: { label: 'Breaching kit (charges, halligan)', kg: 7 },
};
export const WATER_KG = 1.05; // a litre with its bottle

/** The fields of a kit with their options (the editor and the rig build their fields from this). */
export const KIT_FIELDS = {
  primary: { options: Object.keys(PRIMARY), label: 'Primary weapon' },
  mags: { min: 0, max: 12, step: 1, label: 'Spare magazines (belts, shell reloads)' },
  sidearm: { options: Object.keys(SIDEARM), label: 'Sidearm' },
  sideMags: { min: 0, max: 6, step: 1, label: 'Sidearm magazines' },
  frag: { min: 0, max: 8, step: 1, label: 'Frag grenades' },
  smoke: { min: 0, max: 4, step: 1, label: 'Smoke grenades' },
  flash: { min: 0, max: 4, step: 1, label: 'Flash-bangs' },
  pack: { options: Object.keys(PACK), label: 'Backpack' },
  armour: { options: Object.keys(ARMOUR), label: 'Armour' },
  helmet: { bool: true, label: 'Helmet' },
  nvg: { bool: true, label: 'Night vision' },
  radio: { options: Object.keys(RADIO), label: 'Radio' },
  rope: { bool: true, label: 'Rope coil' },
  medkit: { options: Object.keys(MEDKIT), label: 'Medical' },
  drone: { bool: true, label: 'Drone kit' },
  breach: { bool: true, label: 'Breaching kit' },
  knife: { bool: true, label: 'Knife' },
  torch: { bool: true, label: 'Hand torch' },
  water: { min: 0, max: 4, step: 0.5, label: 'Water (litres)' },
};

/** A rifleman's kit: the reference load (mobility() 1.0 on the AI's speeds). */
export const BASE_KIT = Object.freeze({
  primary: 'rifle', mags: 5, sidearm: 'carbine', sideMags: 2, frag: 2, smoke: 1, flash: 2, pack: 'assault', armour: 'plates', helmet: true, nvg: false,
  radio: 'handheld', rope: false, medkit: 'ifak', drone: false, breach: false, knife: true, torch: true, water: 1,
});

/**
 * Squad roles: label, the AI's slot code (ai/squad.js m.squad: CMD the leader, MG the gunner, UAV
 * the drone operator; the others riflemen of fire team A or B, R1 / R2, balanced) and what the
 * role carries over a rifleman's kit.
 */
export const ROLES = {
  leader: { label: 'Team leader', code: 'CMD', kit: { nvg: true } },
  rifleman: { label: 'Rifleman', kit: {} },
  gunner: { label: 'Gunner (MG)', code: 'MG', kit: { primary: 'mg', mags: 2, frag: 1, flash: 1 } },
  marksman: { label: 'Marksman', kit: { primary: 'marksman', mags: 5, flash: 1 } },
  grenadier: { label: 'Grenadier', kit: { frag: 6, smoke: 2 } },
  medic: { label: 'Medic', kit: { primary: 'carbine', medkit: 'bag', smoke: 3, frag: 1 } },
  radio: { label: 'Radio operator', kit: { radio: 'manpack', pack: 'rucksack' } },
  drone: { label: 'Drone operator', code: 'UAV', kit: { drone: true } },
  flame: { label: 'Flame trooper', kit: { primary: 'flamer', mags: 0, pack: 'none', frag: 0, flash: 1 } },
  engineer: { label: 'Engineer / breacher', kit: { primary: 'shotgun', mags: 4, breach: true, flash: 3 } },
  rope: { label: 'Rope man', kit: { rope: true, pack: 'rucksack' } },
};
export const ROLE_KEYS = Object.keys(ROLES);

/** Default compositions by team size (the first four as the fire team always was). */
const GROW = ['leader', 'gunner', 'rifleman', 'rifleman', 'medic', 'marksman', 'grenadier', 'radio', 'gunner', 'engineer', 'rifleman', 'rifleman'];
export function defaultComposition(n = 4) {
  const k = Math.max(1, Math.min(12, Math.round(n)));
  if (k === 2) return ['leader', 'rifleman'];
  if (k === 3) return ['leader', 'gunner', 'rifleman'];
  return GROW.slice(0, k);
}

/**
 * The AI's slot codes for a list of roles: the first leader CMD, gunners MG, drone operators UAV;
 * everyone else a rifleman of fire team A (R1, with the leader) or B (R2, with the gunner), whichever
 * is smaller (A first), so any number of men splits into two fire teams.
 */
export function codesFor(roles) {
  let a = 0, b = 0, lead = false;
  for (const r of roles) {
    if (r === 'leader' && !lead) a++;
    else if (r === 'gunner') b++;
  }
  return roles.map((r) => {
    if (r === 'leader' && !lead) return (lead = true), 'CMD';
    if (r === 'gunner') return 'MG';
    if (r === 'drone') return 'UAV';
    if (a <= b) return a++, 'R1';
    return b++, 'R2';
  });
}

/** The role a man has when none was given: from his slot code and loadout. */
export function roleOf(m = {}) {
  if (m.squadRole && ROLES[m.squadRole]) return m.squadRole;
  if (m.loadout === 'torch') return 'flame';
  return { CMD: 'leader', MG: 'gunner', UAV: 'drone' }[m.squad] ?? 'rifleman';
}

/** A complete kit: the role's default over a rifleman's, then the given fields. */
export function fullKit(role = 'rifleman', over = {}) {
  const k = { ...BASE_KIT, ...(ROLES[role]?.kit ?? {}) };
  for (const [key, v] of Object.entries(over ?? {})) if (v !== undefined && key in KIT_FIELDS) k[key] = v;
  if (!PRIMARY[k.primary]) k.primary = 'rifle';
  // (the flame gun's tanks are on his back: no pack with them)
  if (k.primary === 'flamer' && k.pack !== 'none' && !over?.pack) k.pack = 'none';
  return k;
}

/**
 * The kit a man in the world has: m.kit (his own fields) over his role's default, the older
 * fields (m.loadout, m.squad, m.armour, m.helmet, m.ropes) filling in what it does not say.
 */
export function kitOf(m = {}) {
  const role = roleOf(m);
  const over = { ...(m.kit ?? {}) };
  if (over.primary === undefined) {
    const lo = m.loadout;
    if (lo === 'torch') over.primary = 'flamer';
    else if (lo === 'unarmed') over.primary = 'none';
    else if (lo && PRIMARY[lo]) over.primary = lo;
    else if (m.squad === 'MG') over.primary = 'mg';
  }
  if (over.armour === undefined && m.armour !== undefined) over.armour = m.armour ? (typeof m.armour === 'string' && ARMOUR[m.armour] ? m.armour : 'plates') : 'none';
  if (over.helmet === undefined && m.helmet !== undefined) over.helmet = !!m.helmet;
  else if (over.helmet === undefined && m.armour !== undefined) over.helmet = !!m.armour;
  if (over.rope === undefined && Number.isFinite(m.ropes)) over.rope = m.ropes > 0;
  return fullKit(role, over);
}

/** What a kit weighs: { total (kg, with the uniform), carry (without the primary and the uniform), items: [[label, kg]] }. */
export function kitMass(kit) {
  const k = fullKit(undefined, kit);
  const items = [];
  const add = (label, kg) => kg > 0 && items.push([label, +kg.toFixed(2)]);
  const P = PRIMARY[k.primary];
  add(P.label, P.kg);
  if (P.mag) add(`${k.mags} spare ${k.primary === 'mg' ? 'belts' : k.primary === 'shotgun' ? 'shell reloads' : 'magazines'} + the one in it`, (k.mags + 1) * P.mag.kg);
  const S = SIDEARM[k.sidearm] ?? SIDEARM.none;
  add(S.label, S.kg);
  if (S.mag) add(`${k.sideMags} sidearm magazines + the one in it`, (k.sideMags + 1) * S.mag.kg);
  for (const g of ['frag', 'smoke', 'flash']) add(`${k[g]} × ${g === 'flash' ? 'flash-bang' : g} grenade`, (k[g] ?? 0) * GRENADE_KG[g]);
  add(PACK[k.pack]?.label ?? '', PACK[k.pack]?.kg ?? 0);
  add(ARMOUR[k.armour]?.label ?? '', ARMOUR[k.armour]?.kg ?? 0);
  add(RADIO[k.radio]?.label ?? '', RADIO[k.radio]?.kg ?? 0);
  add(MEDKIT[k.medkit]?.label ?? '', MEDKIT[k.medkit]?.kg ?? 0);
  for (const f of Object.keys(FLAT)) if (k[f]) add(FLAT[f].label, FLAT[f].kg);
  add(`${k.water} l water`, (k.water ?? 0) * WATER_KG);
  add('Uniform, boots, belt', UNIFORM_KG);
  const total = items.reduce((s, [, kg]) => s + kg, 0);
  return { total: +total.toFixed(2), carry: +(total - P.kg - UNIFORM_KG).toFixed(2), items };
}

export const REF_TOTAL = kitMass(BASE_KIT).total;

/** Fitness (0..1, 0.5 a regular soldier) as a factor on what he carries well. */
const fitK = (fitness) => 0.75 + 0.5 * (Number.isFinite(fitness) ? Math.max(0, Math.min(1, fitness)) : 0.5);

/**
 * What a total load (kg, all of it) does to a man: speeds (m/s), acceleration (m/s²), stamina
 * (drain a second at a run, recovery a second at rest: of a full 1), how high he climbs (a jump
 * climb, m) and vaults, rope work, swimming, landings (fallK: × a rifleman's), the rattle he makes
 * moving (noiseDb, added to his footsteps).
 */
export function mobility(total, { body = BODY_KG, fitness = 0.5 } = {}) {
  const F = fitK(fitness);
  const f = total / (body * F); // the load as a fraction of what he can carry well
  const x = Math.max(0, f - 0.1) ** 1.3;
  return {
    load: +total.toFixed(1),
    fraction: +(total / body).toFixed(3),
    walk: 1.5 / (1 + 0.45 * x),
    run: 3.9 / (1 + 1.5 * x),
    sprint: 6.2 / (1 + 2.4 * x),
    accel: 3.6 / (1 + 2.2 * x),
    staminaDrain: ((1 + 3.5 * f) / 150) / F,
    staminaRecover: (F / 40) / (1 + f),
    climb: Math.max(0, Math.min(2.3, 2.3 - 2.6 * Math.max(0, f - 0.32))),
    vault: Math.max(0.5, Math.min(1.25, 1.25 - 1.2 * Math.max(0, f - 0.4))),
    ropeDown: total < 70,
    ropeClimb: total < 28 * F,
    swim: total <= 12 * F ? 'swims' : total <= 25 * F ? 'struggles' : 'sinks',
    fallK: (body + total) / (body + REF_TOTAL),
    noiseDb: 10 * Math.log10(1 + total / 10),
  };
}

const REF = mobility(REF_TOTAL);
export const PACE_MAX = 1.12;

/**
 * The AI's pace factors for a man (× the squad AI's speeds, which are a rifleman's): his load
 * without the primary (its own pace is in ai/weapons.js gaitK), as if he carried a rifle.
 */
export function paceOf(total, primaryKg, fitness) {
  const M = mobility(total - primaryKg + PRIMARY.rifle.kg, { fitness });
  // (a light man is quicker, but the team's drills are paced for the fighting load: at most PACE_MAX)
  return { walk: Math.min(PACE_MAX, M.walk / REF.walk), run: Math.min(PACE_MAX, M.run / REF.run) };
}

/**
 * Kit a man out: m.kit made complete, and from it what the AI reads: m.carry (kg, ai/parkour.js
 * and ai/rope.js), m.loadKg, m.mob (mobility), m.paceK, m.fallK (landings, sim/impact.js),
 * m.armourLevel, m.helmet, m.flashbangs, m.ropes (a coil), m.swim. Fields set before are kept.
 */
export function applyKit(m) {
  // (a kit given by the scene changes his pace, landings and carry; without one he keeps the
  // AI's old defaults for those: a rifleman's pace, ai/parkour.js's carry by role)
  const given = m.kit != null;
  const K = kitOf(m);
  m.kit = K;
  m.kitGiven = given;
  m.squadRole = roleOf(m); // (not m.role: a helicopter's crew have theirs, ai/helicopter.js)
  const W = kitMass(K);
  const mob = mobility(W.total, { fitness: m.fitness });
  m.loadKg = W.total;
  m.mob = mob;
  if (given) {
    m.carry ??= W.carry;
    m.paceK = paceOf(W.total, PRIMARY[K.primary].kg, m.fitness);
    m.fallK = mob.fallK;
  }
  m.swim = mob.swim;
  m.armourLevel = K.armour;
  m.armour = K.armour !== 'none';
  m.helmet = !!K.helmet;
  if (given) {
    m.flashbangs ??= K.flash;
    m.smokes ??= K.smoke;
    if (K.rope) m.ropes ??= 1;
  }
  if (K.primary === 'none') m.noKnife ??= !K.knife;
  return m;
}

/** Stamina, each step: drained at a run (m.mob), back while walking (half) or still. Returns the run speed factor (tired: slower). */
export function stepStamina(m, dt, mode) {
  const mob = m.mob ?? REF;
  const s = m.stamina ?? 1;
  m.stamina = mode === 'run' ? Math.max(0, s - mob.staminaDrain * dt) : Math.min(1, s + mob.staminaRecover * dt * (mode === 'walk' || mode === 'aimWalk' ? 0.5 : 1));
  return tiredK(m.stamina);
}
/** The run pace at this stamina (1 above 30 %, down to 0.6 spent). */
export const tiredK = (s) => (s >= 0.3 ? 1 : 0.6 + (0.4 * Math.max(0, s)) / 0.3);

/** The chance a round of `kind` gets through his armour in this zone (null: not covered there). wpen: the weapon's own plate pen. */
export function armourPen(level, zone, kind, wpen) {
  const Z = ARMOUR[level]?.zones?.[zone];
  if (!Z) return null;
  if (Z.pen) return Z.pen[kind === 'bullet' ? 'rifle' : kind] ?? 1;
  return Math.min(1, wpen * (Z.penK ?? 1));
}
/** What a hit that got through still does there (× the damage). */
export const armourDamageK = (level, zone) => ARMOUR[level]?.zones?.[zone]?.dmg ?? 1;

/** A one-line readout: the weight and what it does (the editor's, the rig's). */
export function loadSummary(kit, fitness) {
  const W = kitMass(kit);
  const M = mobility(W.total, { fitness });
  return `${W.total.toFixed(1)} kg (${Math.round(M.fraction * 100)}% of his body) · walk ${M.walk.toFixed(2)} · run ${M.run.toFixed(2)} · sprint ${M.sprint.toFixed(2)} m/s · stamina ${Math.round(1 / M.staminaDrain)} s at a run · climbs ${M.climb.toFixed(1)} m · ${M.swim}`;
}
