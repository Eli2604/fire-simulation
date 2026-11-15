/**
 * Experience: one table for everything a man's experience level does (recruit, regular,
 * veteran, elite), and the ranks shown for him. Pure data and small helpers, no imports, so the
 * modules that read it (ai/soldier.js SKILL, ai/perception.js SKILL_SENSES, ai/peek.js PEEK_T,
 * ai/retreat.js carrying a casualty, ai/strategy.js the leader's choices) all take their numbers
 * from here instead of keeping tables of their own.
 *
 * Per level (factors are × a regular's; lower is better for times and scatter):
 *   aim        scatter of his rounds
 *   reload     reload, weapon switch and pick-up time
 *   react      reaction time (a blow, a target appearing)
 *   control    how long he takes to bring the muzzle back down after a round (ai/recoil.js)
 *   nerve      how readily he flinches into a roll under fire (suppression)
 *   melee      hand-to-hand damage; judgement: how well he picks his move (0..1)
 *   sight, hearing, notice   the senses (ai/perception.js): range ×, range ×, time to make out a threat ×
 *   peek       exposure and rhythm of his peeks round cover (ai/peek.js)
 *   carry      readiness to carry a casualty out under fire (ai/retreat.js, added to a score)
 *   cover      how far a flank route may be exposed before he will not take it (ai/strategy.js, as a leader)
 *   suppress   how long incoming fire keeps him down (×)
 *
 * Per man on top of the level (models/squad.js per-man list, the editor): discipline (0..1, 0.5 a
 * regular's) steadies his nerve under fire; morale (0..1) and aggression (0..1) of the team
 * weigh the leader's choices (ai/strategy.js); fitness (ai/loadout.js) how his load tells.
 */
export const EXPERIENCE = {
  recruit: {
    aim: 1.8, reload: 1.35, react: 1.5, control: 1.4, nerve: 1.5, melee: 0.75, judgement: 0.55,
    sight: 0.85, hearing: 0.9, notice: 1.5,
    peek: { dur: 2.6, wait: [3.0, 0.4], vary: 0.2 },
    carry: -0.35, cover: 0.3, suppress: 1.4,
  },
  regular: {
    aim: 1.0, reload: 1.0, react: 1.0, control: 1.0, nerve: 1.0, melee: 1.0, judgement: 0.75,
    sight: 1, hearing: 1, notice: 1,
    peek: { dur: 2.0, wait: [2.6, 1.5], vary: 0.5 },
    carry: 0, cover: 0.4, suppress: 1,
  },
  veteran: {
    aim: 0.7, reload: 0.82, react: 0.8, control: 0.85, nerve: 0.75, melee: 1.15, judgement: 0.9,
    sight: 1.1, hearing: 1.05, notice: 0.8,
    peek: { dur: 1.5, wait: [2.0, 3.0], vary: 0.8 },
    carry: 0.3, cover: 0.4, suppress: 0.75,
  },
  elite: {
    aim: 0.5, reload: 0.7, react: 0.65, control: 0.7, nerve: 0.55, melee: 1.3, judgement: 1.0,
    sight: 1.2, hearing: 1.1, notice: 0.65,
    peek: { dur: 1.1, wait: [1.6, 4.0], vary: 1.0 },
    carry: 0.45, cover: 0.5, suppress: 0.55,
  },
};
export const LEVELS = Object.keys(EXPERIENCE);
export const LEVEL_LABELS = { recruit: 'Recruit', regular: 'Regular', veteran: 'Veteran', elite: 'Elite' };

/** Military ranks (for display: the editor, the rig, the squad's tags), lowest first. */
export const RANKS = ['Private', 'Private First Class', 'Specialist', 'Corporal', 'Sergeant', 'Staff Sergeant', 'Sergeant First Class', 'Second Lieutenant', 'First Lieutenant', 'Captain'];
export const RANK_ABBR = { Private: 'PVT', 'Private First Class': 'PFC', Specialist: 'SPC', Corporal: 'CPL', Sergeant: 'SGT', 'Staff Sergeant': 'SSG', 'Sergeant First Class': 'SFC', 'Second Lieutenant': '2LT', 'First Lieutenant': '1LT', Captain: 'CPT' };

/** The rank a man of this level and role would usually hold (a leader one or two above). */
export function defaultRank(level = 'regular', role = 'rifleman') {
  const base = { recruit: 0, regular: 2, veteran: 3, elite: 4 }[level] ?? 2;
  const lead = role === 'leader' ? 2 : role === 'gunner' || role === 'marksman' || role === 'medic' ? 1 : 0;
  return RANKS[Math.min(RANKS.length - 1, base + lead)];
}

/** His level's table (a regular's when unknown). */
export const experienceOf = (m) => EXPERIENCE[m?.skill] ?? EXPERIENCE.regular;

/** 0..1 setting on a man (discipline, morale, aggression, fitness...), defaulting to 0.5. */
const unit = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5);

/** His nerve under fire (× a regular's): the level's, steadied by discipline (0.5: as the level says). */
export const nerveOf = (m) => experienceOf(m).nerve * (1.5 - unit(m?.discipline));

/** The team's morale and aggression factor (0.5 → 1): how far outmatched before they give ground. */
export const moraleK = (m) => 0.5 + unit(m?.morale);
export const aggressionOf = (m) => unit(m?.aggression);

/** A short readout of what the level does (the editor's and the rig's). */
export function describeLevel(level) {
  const E = EXPERIENCE[level] ?? EXPERIENCE.regular;
  const pct = (v) => `${v < 1 ? '' : '+'}${Math.round((v - 1) * 100)}%`;
  return `scatter ${pct(E.aim)}, reaction ${pct(E.react)}, spots threats ${pct(E.notice)} time, reload ${pct(E.reload)}, suppression ${pct(E.suppress)}`;
}
