/**
 * Sides: who is whose, for whoever picks targets (the helicopter's door gunners: ai/helicopter.js;
 * the fire teams' hostiles: sim/simulation.js makeSquadAI). Pure logic.
 *
 *  - 'blue'  you (the walk-through's player), a helicopter you fly or a friendly one (models/
 *            helicopter.js side: 'friendly'), and its crew.
 *  - 'red'   the simulation's soldiers (w.enemies) unless they say otherwise (e.side: the squad
 *            model's side param), and the helicopters that bring them.
 *  - 'blue' teams (squad side 'blue') fight on your side: against the red teams, never at you;
 *    'green' is a third side, against both. Teams of different sides fight each other.
 *  - 'beast' a dragon: everybody's enemy.
 *  - 'target' the rig stage's targets: shot at by anyone.
 * Two things are hostile when their sides differ (nobody is hostile to 'neutral').
 */
export const PLAYER_SIDE = 'blue';

/** The side of a soldier, a helicopter, a dragon, a contact ({ side }) or the player ({ isPlayer }). */
export function sideOf(x) {
  if (!x) return 'neutral';
  if (x.side) return x.side;
  if (x.isPlayer || x.kind === 'player') return PLAYER_SIDE;
  if (x.kind === 'dragon' || x.spine) return 'beast';
  return 'red';
}
/** Are a and b (anything sideOf takes, or side names) enemies? */
export function hostile(a, b) {
  const A = typeof a === 'string' ? a : sideOf(a);
  const B = typeof b === 'string' ? b : sideOf(b);
  return A !== B && A !== 'neutral' && B !== 'neutral';
}

/**
 * A fire team's hostiles in a world (ai/squad.js host.hostiles): for the red side, you (when you
 * are about on foot) and the blue soldiers and helicopters; for the blue side, the red ones. Men
 * aboard a helicopter are not counted (the helicopter is: shooting at it finds its parts, and the
 * men in its cabin through it); a wreck is not a threat.
 */
export function squadHostiles(w, side, player = null) {
  const out = [];
  if (player && hostile(side, PLAYER_SIDE)) out.push(player);
  for (const e of w.enemies ?? []) if (!e.dead && e.aboard == null && hostile(side, sideOf(e))) out.push(e);
  for (const s of w.helis ?? []) if (s.ai && !s.ai.crashed && hostile(side, s.ai.side)) out.push(s.ai);
  return out;
}
