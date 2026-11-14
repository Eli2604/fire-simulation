/**
 * Weapon handling: what the weapon in a man's hands does to the way he holds himself and moves.
 * Pure logic (no three.js), shared by the squad and guard AIs (ai/squad.js, ai/enemies.js through
 * ai/evade.js and ai/parkour.js), the player's walk (walk/walk.js) and the operator rig
 * (operator/rig.js bakes a set of clips for each weapon from these profiles; the rig stage's Gear
 * tab shows them and greys out what a weapon does not allow).
 *
 * Each profile (HANDLING[kind]) says:
 *  - grip: where the hands go on it (the rig's grip offsets: operator/rig.js WEAPON_STYLE).
 *    The rifle and the machine gun: the right hand on the pistol grip, the left on the foregrip
 *    (the gunner's further back, over the top of the handguard, for the weight); the carbine:
 *    the left hand on the magazine well; the pump shotgun: the left hand on the pump (worked back
 *    and forward after every round); the flame gun: the rear hand on the trigger grip, the front
 *    hand on the wand's grip, the tanks on his back; the pistol: one hand moving, both hands
 *    (the left cupping the right) aimed.
 *  - carry / aim: how he carries it (low ready, compressed ready for the pistol, hip carry for
 *    the heavy ones) and how he aims it (at the shoulder; the pistol out at arm's length, square
 *    to the target; the flame gun from the hip).
 *  - mass (kg in his hands; the flame gun's tanks on his back counted) and what it allows:
 *    moves[act] is true (as without it), false (not with this weapon: the AI and the player do
 *    something else, the rig greys the act out), or a number (allowed, that many times slower;
 *    for 'sprint', 'walk' and 'crawl' the pace: a factor on the speed). 'drop' is the deepest
 *    drop (m) he jumps down with it.
 *
 * Acts: the rolls (rollLeft, rollRight, rollForward, diveProne: ai/evade.js), the crouched side
 * step that stands in for a roll (sidestepLeft, sidestepRight), crawl and prone, the parkour
 * moves (vaultSpeed, vaultSide, vaultStep, climbJump, mantle, dropDown, dropRoll, slideCover:
 * ai/parkour.js), sprint (the run).
 */

/** The groups the per-act rules fall back on: an act not named itself takes its group's rule. */
const GROUP = {
  rollLeft: 'roll', rollRight: 'roll', rollForward: 'roll',
  vaultSpeed: 'vault', vaultSide: 'vault', vaultStep: 'vault',
  proneAim: 'prone', proneShoot: 'prone', peekOver: 'prone', peekOverAim: 'prone',
  run: 'sprint',
};

export const HANDLING = {
  rifle: {
    label: 'Rifle (5.56 mm)', gun: 'rifle', mass: 3.4, hands: 2,
    grip: 'Right hand on the pistol grip, left on the foregrip under the handguard',
    carry: 'low ready', aim: 'shoulder, bladed', fire: 'single, burst, auto',
    moves: {},
  },
  carbine: {
    label: 'Carbine (9 mm, the secondary)', gun: 'carbine', mass: 2.7, hands: 2,
    grip: 'Right hand on the pistol grip, left on the magazine well',
    carry: 'low ready, compact', aim: 'shoulder, bladed', fire: 'single, burst, auto',
    moves: {},
  },
  shotgun: {
    label: 'Pump shotgun (12 gauge)', gun: 'shotgun', mass: 3.6, hands: 2,
    grip: 'Right hand on the grip, left on the pump (worked back and forward after every round)',
    carry: 'low ready, muzzle down', aim: 'shoulder, weight forward', fire: 'single, pump between rounds',
    moves: { sprint: 0.97 },
  },
  pistol: {
    label: 'Pistol (9 mm)', gun: 'pistol', mass: 0.9, hands: 1,
    grip: 'One hand moving; aimed, both (the left cupping the right on the grip)',
    carry: 'compressed ready (close to the chest, muzzle down)', aim: 'arms out, square to the target (isosceles)', fire: 'single',
    moves: { sprint: 1.04 },
  },
  mg: {
    label: 'Machine gun (7.62 mm, the gunner)', gun: 'mg', mass: 11, hands: 2,
    grip: 'Right hand on the pistol grip, left over the top of the handguard (the weight)',
    carry: 'hip carry, muzzle low', aim: 'shoulder, leaning in', fire: 'burst, auto',
    // too heavy to roll with: he dives flat into cover instead; vaults slowly (side vault), no
    // jump climb, no landing roll, no slide
    moves: { roll: false, diveProne: true, crawl: 0.7, vaultSpeed: false, vault: 1.25, climbJump: false, mantle: 1.3, dropRoll: false, drop: 2.0, slideCover: false, sprint: 0.85 },
  },
  torch: {
    label: 'Flame gun (tanks on the back)', gun: 'torch', mass: 30, hands: 2,
    grip: 'Rear hand on the trigger grip, front hand on the wand\'s grip; the hose to the tanks on his back',
    carry: 'hip carry, wand low', aim: 'from the hip', fire: 'a stream, standing only',
    // 30 kg of tanks on his back: no rolling over them, no diving or crawling flat on them (a
    // crouched side step instead), only the slow vaults over low walls, no climbing up, short drops
    moves: { roll: false, diveProne: false, crawl: false, prone: false, vaultSpeed: false, vault: 1.4, climbJump: false, mantle: false, dropRoll: false, drop: 1.6, slideCover: false, sprint: 0.72, walk: 0.92 },
  },
  // the player's fire torch: a hand-held burner, one hand; lit, it is not rolled over or dived on
  handTorch: {
    label: 'Fire torch (hand-held)', gun: null, mass: 1.5, hands: 1,
    grip: 'In the right hand, out in front', carry: 'held out', aim: 'held out', fire: 'a flame ~1 m',
    moves: { roll: false, diveProne: false, climbJump: 1.15, mantle: 1.1 },
  },
  knife: { label: 'Knife', gun: null, mass: 0.3, hands: 1, grip: 'Right hand, blade forward', carry: 'low at the side', aim: 'fighting stance', fire: 'stab', moves: { sprint: 1.03 } },
  none: { label: 'Empty-handed', gun: null, mass: 0, hands: 0, grip: 'Hands free', carry: '', aim: '', fire: '', moves: { sprint: 1.03 } },
};
export const WEAPON_KINDS = Object.keys(HANDLING);
/** The weapons a soldier can carry as his primary (the rig stage's select; the models' options). */
export const PRIMARIES = ['rifle', 'shotgun', 'pistol', 'mg', 'torch'];

const prof = (kind) => HANDLING[kind] ?? HANDLING.rifle;
const rule = (kind, act) => {
  const mv = prof(kind).moves;
  if (act in mv) return mv[act];
  const g = GROUP[act];
  return g && g in mv ? mv[g] : true;
};

/**
 * The handling kind of the weapon in a man's hands: m.handling (set by whoever knows better, e.g.
 * the player's tool), else from m.weapon ('torch', 'secondary', 'knife', 'none'; 'rifle' or
 * 'primary': his primary, m.primary: 'rifle', 'mg', 'shotgun', 'pistol'), m.loadout, m.squad.
 */
export function handKind(m = {}) {
  if (m.handling && HANDLING[m.handling]) return m.handling;
  if (m.weapon === 'torch' || m.loadout === 'torch') return 'torch';
  if (m.weapon === 'secondary') return 'carbine';
  if (m.weapon === 'knife') return 'knife';
  if (m.weapon === 'none') return 'none';
  if (m.primary && HANDLING[m.primary]) return m.primary;
  if (m.loadout && HANDLING[m.loadout]) return m.loadout;
  return m.squad === 'MG' ? 'mg' : 'rifle';
}
const kindOf = (k) => (typeof k === 'string' ? k : handKind(k));

/** May he do act with this weapon (a kind, or a man)? */
export const allows = (k, act) => rule(kindOf(k), act) !== false;
/** How much longer the act takes with it (1: as without it); for sprint / walk / crawl: the pace (a factor on speed). */
export function paceOf(k, act) {
  const r = rule(kindOf(k), act);
  return typeof r === 'number' ? r : 1;
}
/** The deepest drop (m) he jumps down with it. */
export const dropMax = (k) => {
  const r = prof(kindOf(k)).moves.drop;
  return typeof r === 'number' ? r : Infinity;
};
/**
 * Speed factor for a gait ('run', 'walk', 'aimWalk', 'crawl') with this weapon. Crawling where
 * the weapon does not allow it (a man down with both legs hit has no choice): half the pace.
 */
export function gaitK(k, mode) {
  const kind = kindOf(k);
  if (mode === 'run') return paceOf(kind, 'sprint');
  if (mode === 'crawl') return allows(kind, 'crawl') ? paceOf(kind, 'crawl') : 0.5;
  if (mode === 'walk' || mode === 'aimWalk') return paceOf(kind, 'walk');
  return 1;
}

/** What stands in for an evade move the weapon does not allow. */
const EVADE_FALLBACK = {
  rollLeft: ['sidestepLeft'],
  rollRight: ['sidestepRight'],
  rollForward: ['diveProne'],
  diveProne: [],
  sidestepLeft: [],
  sidestepRight: [],
};
/**
 * The evade move he does with this weapon for the one wanted (ai/evade.js): the move itself if
 * allowed, else what stands in for it (a roll sideways: a crouched side step; a forward roll: a
 * dive into cover, if that is allowed), or null (nothing that way).
 */
export function evadeKind(k, want) {
  const kind = kindOf(k);
  if (allows(kind, want)) return want;
  for (const alt of EVADE_FALLBACK[want] ?? []) if (allows(kind, alt)) return alt;
  return null;
}

/** Why not (for a message): '' when it is allowed. */
export function whyNot(k, act) {
  const kind = kindOf(k);
  if (allows(kind, act)) return '';
  const what = { torch: 'the flame gun\'s tanks on the back', mg: 'the machine gun\'s weight', handTorch: 'a lit torch in hand' }[kind] ?? prof(kind).label.toLowerCase();
  return `Not with ${what}`;
}

/**
 * Every act's rule for a weapon, for display: { act: true | false | factor }.
 * acts: the names to report (default: the rolls, side steps, crawl, prone, parkour, sprint).
 */
export const ACTS = ['rollLeft', 'rollRight', 'rollForward', 'diveProne', 'sidestepLeft', 'sidestepRight', 'crawl', 'proneAim', 'vaultSpeed', 'vaultSide', 'vaultStep', 'climbJump', 'mantle', 'dropDown', 'dropRoll', 'slideCover', 'run'];
export function moveTable(k, acts = ACTS) {
  const kind = kindOf(k);
  return Object.fromEntries(acts.map((a) => [a, allows(kind, a) ? (a === 'run' || a === 'crawl' ? gaitK(kind, a) : paceOf(kind, a)) : false]));
}
