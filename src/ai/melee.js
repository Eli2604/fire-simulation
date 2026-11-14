/**
 * Hand-to-hand: a man without a weapon (or out of ammunition, his knife gone) fights with his
 * fists and feet, boxing style, and throws, judo style. Pure logic (no three.js): the squad AI
 * (ai/soldier.js handFight) and the player's walk (walk/walk.js: G punch, V kick, B throw) use it;
 * the operator rig (operator/rig.js) has a clip for each move, the throws (and the clinch) as
 * pairs: the attacker's clip and the defender's (`<move>_d`), in step, the two facing each other
 * PAIR_D apart (as the casualty drag pairs the rescuer and the man he drags).
 *
 *  - Strikes: jab, cross, hook, uppercut (the hands), front kick, roundhouse kick, low kick (the
 *    feet). Each lands at `hit` s into its clip if the other man is within its reach then (the
 *    distance between the two, m), for its damage (health) and a stun; a hard one can knock him
 *    down. The defender's reaction: hitHead, hitBody, knockDown (and getUp after).
 *  - Throws: a hip throw (o-goshi), a shoulder throw (seoi-nage), a foot sweep (de-ashi-barai):
 *    from close in (a clinch, or a dazed man); he lands on his back `land` m along his own
 *    facing (over the thrower, or back where he stood) and gets up after `stun` s.
 *  - Defence: block (forearms up: a strike does a quarter), slip (the head off the line: a punch
 *    to the head misses). The clinch: both holding, close (a throw comes next).
 *
 * m.knockedUntil: down on his back until then (stepKnocked gets him up); m.meleeAt / m.meleeKind:
 * a move under way, landing then; m.guardUntil / m.guardKind: a block or slip up until then.
 */

export const MELEE = {
  jab: { label: 'Jab', kind: 'strike', limb: 'hand', dur: 0.45, hit: 0.17, reach: [0.5, 1.15], dmg: 5, stun: 0.25, zone: 'head' },
  cross: { label: 'Cross', kind: 'strike', limb: 'hand', dur: 0.55, hit: 0.24, reach: [0.5, 1.1], dmg: 9, stun: 0.45, zone: 'head' },
  hook: { label: 'Hook', kind: 'strike', limb: 'hand', dur: 0.6, hit: 0.3, reach: [0.4, 0.95], dmg: 11, stun: 0.6, zone: 'head', down: 0.1 },
  uppercut: { label: 'Uppercut', kind: 'strike', limb: 'hand', dur: 0.6, hit: 0.3, reach: [0.3, 0.8], dmg: 13, stun: 0.8, zone: 'head', down: 0.25 },
  frontKick: { label: 'Front kick', kind: 'strike', limb: 'foot', dur: 0.75, hit: 0.34, reach: [0.85, 1.5], dmg: 9, stun: 0.6, zone: 'torso', push: 0.5 },
  roundKick: { label: 'Roundhouse kick', kind: 'strike', limb: 'foot', dur: 0.85, hit: 0.42, reach: [0.8, 1.4], dmg: 14, stun: 0.9, zone: 'head', down: 0.35 },
  lowKick: { label: 'Low kick', kind: 'strike', limb: 'foot', dur: 0.65, hit: 0.3, reach: [0.7, 1.25], dmg: 7, stun: 0.4, zone: 'legs' },
  hipThrow: { label: 'Hip throw (o-goshi)', kind: 'throw', dur: 1.5, hit: 0.95, reach: [0.25, 0.9], dmg: 16, stun: 2.6, down: 1, land: 1.45 },
  shoulderThrow: { label: 'Shoulder throw (seoi-nage)', kind: 'throw', dur: 1.6, hit: 1.0, reach: [0.25, 0.9], dmg: 20, stun: 3.0, down: 1, land: 1.55 },
  footSweep: { label: 'Foot sweep (de-ashi-barai)', kind: 'throw', dur: 1.1, hit: 0.5, reach: [0.4, 1.0], dmg: 10, stun: 2.2, down: 1, land: -0.35 },
  clinch: { label: 'Clinch', kind: 'grip', dur: 1.2, hit: 0.45, reach: [0.3, 0.95] },
  block: { label: 'Block', kind: 'defend', dur: 0.6 },
  slip: { label: 'Slip', kind: 'defend', dur: 0.5 },
};
/**
 * Contacts, as plain data for a force-based impact model (sim/impact.js, to come: its act-level
 * impacts): [{ t (s into the clip), part (the body part or thing that hits), material, target
 * ('opponent' or 'ground') }]. The strikes at their hit time; a thrown man's back on the ground in
 * his own clip (the move with _d); the knock-down. (The damage today: meleeDamage, one place to swap.)
 */
export const IMPACTS = {
  jab: [{ t: MELEE.jab.hit, part: 'fistL', material: 'flesh', target: 'opponent' }],
  cross: [{ t: MELEE.cross.hit, part: 'fistR', material: 'flesh', target: 'opponent' }],
  hook: [{ t: MELEE.hook.hit, part: 'fistR', material: 'flesh', target: 'opponent' }],
  uppercut: [{ t: MELEE.uppercut.hit, part: 'fistR', material: 'flesh', target: 'opponent' }],
  frontKick: [{ t: MELEE.frontKick.hit, part: 'footR', material: 'boot', target: 'opponent' }],
  roundKick: [{ t: MELEE.roundKick.hit, part: 'shinR', material: 'boot', target: 'opponent' }],
  lowKick: [{ t: MELEE.lowKick.hit, part: 'shinR', material: 'boot', target: 'opponent' }],
  hipThrow_d: [{ t: 1.2, part: 'back', material: 'flesh', target: 'ground' }],
  shoulderThrow_d: [{ t: 1.27, part: 'back', material: 'flesh', target: 'ground' }],
  footSweep: [{ t: MELEE.footSweep.hit, part: 'footL', material: 'boot', target: 'opponent' }],
  footSweep_d: [{ t: 1.0, part: 'back', material: 'flesh', target: 'ground' }],
  knockDown: [{ t: 0.95, part: 'back', material: 'flesh', target: 'ground' }],
  // gear (operator/rig.js): the dropped weapon, the pack put down
  dropWeapon: [{ t: 0.62, part: 'weapon', material: 'steel', target: 'ground' }],
  dropPack: [{ t: 3.85, part: 'pack', material: 'canvas', target: 'ground' }],
};
for (const [k, v] of Object.entries(IMPACTS)) if (MELEE[k]) MELEE[k].impacts = v;

/** The damage a move does (health), blocked or not: the one place a force-based model replaces. */
export function meleeDamage(kind, o = {}) {
  const M = MELEE[kind];
  if (!M?.dmg) return 0;
  return M.dmg * (o.blocked ? 0.25 : 1) * (o.k ?? 1);
}
/** The defender's side: being hit, knocked down, getting up; the thrown man's clips (`<throw>_d`). */
export const REACT = {
  hitHead: { label: 'Hit (head)', dur: 0.5 },
  hitBody: { label: 'Hit (body)', dur: 0.6 },
  knockDown: { label: 'Knocked down', dur: 1.0, back: 0.55 },
  getUp: { label: 'Get back up', dur: 1.3 },
};
export const THROWS = Object.keys(MELEE).filter((k) => MELEE[k].kind === 'throw');
/** Paired moves (the rig shows the second man): the throws and the clinch. */
export const PAIRED = Object.fromEntries([...THROWS, 'clinch'].map((k) => [k, k + '_d']));
/** The distance between the two men's roots for a paired move (m). */
export const PAIR_D = 0.6;
/** Where an unarmed man fights from (m): out of reach of a kick he closes in to here. */
export const FIGHT_D = 0.9;

/** Is a man d m away within the reach of move kind? */
export function inReach(kind, d) {
  const r = MELEE[kind]?.reach;
  return !!r && d >= r[0] && d <= r[1];
}

const down = (h, now) => (h.knockedUntil ?? -Infinity) > now || h.dead;

/**
 * Which move m makes on foe, d m away, now (o.now; o.rand): a throw when he is close and his
 * man is held (clinched) or dazed, the clinch to get hold of him, else a strike that reaches
 * (kicks further out, hooks and uppercuts close in). null: nothing reaches (close in), or he is down.
 */
export function pickMelee(m, foe, d, o = {}) {
  const now = o.now ?? 0, rand = o.rand ?? Math.random;
  if (down(foe, now)) return null;
  // (poor judgement, o.judgement 0..1: now and then just whatever strike reaches)
  if (o.judgement != null && rand() > o.judgement) {
    const any = Object.keys(MELEE).filter((k) => MELEE[k].kind === 'strike' && inReach(k, d));
    return any.length ? any[Math.floor(rand() * any.length)] : null;
  }
  const dazed = (foe.meleeStunUntil ?? -Infinity) > now;
  const held = foe.clinchedBy === m || m.clinchedBy === foe;
  if (held || dazed) {
    const t = THROWS.filter((k) => inReach(k, d));
    if (t.length && (held || rand() < 0.6)) return t[Math.floor(rand() * t.length)];
  }
  if (!held && inReach('clinch', d) && rand() < 0.25) return 'clinch';
  const strikes = Object.keys(MELEE).filter((k) => MELEE[k].kind === 'strike' && inReach(k, d));
  if (!strikes.length) return null;
  // the jab and the cross most, the rest now and then
  const w = strikes.map((k) => ({ jab: 3, cross: 2.5, lowKick: 1.5 })[k] ?? 1);
  let r = rand() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < strikes.length; i++) if ((r -= w[i]) <= 0) return strikes[i];
  return strikes[strikes.length - 1];
}

/** Start move kind for m now: his clip, and when it lands (m.meleeAt). */
export function startMelee(m, kind, now = 0) {
  const M = MELEE[kind];
  m.anim = kind;
  m.animT = now;
  m.animDur = M.dur;
  m.animUntil = now + M.dur;
  if (M.kind === 'defend') {
    m.guardKind = kind;
    m.guardUntil = now + M.dur;
    m.meleeAt = null;
  } else {
    m.meleeKind = kind;
    m.meleeAt = now + M.hit;
  }
  return m;
}

/**
 * What move kind by att does to def, d m apart, now: { hit, kind, dmg, stun, zone, down, react,
 * land, why }. Out of reach: a miss. A block takes three quarters off a strike; a slip makes a
 * punch to the head miss; a man on the ground is not thrown.
 */
export function resolveMelee(att, def, kind, d, o = {}) {
  const M = MELEE[kind], now = o.now ?? 0, rand = o.rand ?? Math.random;
  const out = { hit: false, kind, dmg: 0, stun: 0, zone: M?.zone ?? 'torso', down: false, react: null, land: 0, why: '' };
  if (!M || M.kind === 'defend') return out;
  if (!inReach(kind, d)) return (out.why = 'out of reach'), out;
  if (down(def, now)) return (out.why = 'he is down'), out;
  const guard = (def.guardUntil ?? -Infinity) > now ? def.guardKind : null;
  if (M.kind === 'grip') {
    out.hit = true;
    out.react = 'clinch_d';
    return out;
  }
  if (M.kind === 'throw') {
    Object.assign(out, { hit: true, dmg: meleeDamage(kind), stun: M.stun, zone: 'torso', down: true, react: kind + '_d', land: M.land });
    return out;
  }
  if (guard === 'slip' && M.limb === 'hand' && M.zone === 'head') return (out.why = 'slipped'), out;
  const k = guard === 'block' ? 0.25 : 1;
  out.hit = true;
  out.dmg = meleeDamage(kind, { blocked: guard === 'block' });
  out.stun = M.stun * k;
  out.blocked = guard === 'block';
  out.down = !out.blocked && (M.down ?? 0) > 0 && rand() < M.down;
  out.react = out.down ? 'knockDown' : M.zone === 'head' ? 'hitHead' : 'hitBody';
  out.push = M.push ?? 0;
  if (out.down) out.stun = Math.max(out.stun, 2);
  return out;
}

/**
 * The result of a move on def (a man of an AI, or a guard): his health, the daze, down on his
 * back for a while (thrown: moved to where he lands, along his facing), his reaction clip.
 * att: the man who did it (his facing for a push). Returns def.
 */
export function applyMelee(def, res, now = 0, att = null) {
  if (!res.hit) return def;
  if (res.dmg) def.health = (def.health ?? 100) - res.dmg;
  if (def.health <= 0) def.dead = true;
  def.meleeStunUntil = Math.max(def.meleeStunUntil ?? 0, now + res.stun);
  def.lastHitT = now;
  if (res.kind === 'clinch' && att) {
    def.clinchedBy = att;
    att.clinchedBy = def;
  } else if (att && (def.clinchedBy === att || att.clinchedBy === def) && res.down) def.clinchedBy = att.clinchedBy = null;
  const R = res.react;
  if (!R) return def;
  const dur = R.endsWith('_d') ? MELEE[R.slice(0, -2)].dur : REACT[R].dur;
  def.anim = R;
  def.animT = now;
  def.animDur = dur;
  def.animUntil = now + dur;
  def.meleeAt = null;
  def.path = null;
  if (res.down) {
    def.knockedUntil = now + Math.max(res.stun, dur + 0.6);
    def.gettingUp = false;
    // where he ends up: thrown over (or swept back) along his own facing; knocked back
    const yaw = def.yaw ?? 0;
    const along = res.land || (R === 'knockDown' ? -REACT.knockDown.back : 0);
    def.landAt = [def.p[0] + Math.sin(yaw) * along, def.p[1], def.p[2] + Math.cos(yaw) * along];
  }
  // a guard (not a squad's man) stops in his tracks too (ai/enemies.js)
  if (!def.squad) def.stunnedUntil = Math.max(def.stunnedUntil ?? 0, now + (res.down ? def.knockedUntil - now : res.stun));
  if (res.push && att) {
    const y = att.yaw ?? 0;
    def.p = [def.p[0] + Math.sin(y) * res.push, def.p[1], def.p[2] + Math.cos(y) * res.push];
  }
  return def;
}

/**
 * A man knocked down: when his clip (the throw, the knock-down) ends he lies where he landed;
 * when his time is up he gets back up (getUp). Returns true while he is down or getting up.
 */
export function stepKnocked(m, now) {
  if (m.knockedUntil == null) return false;
  if (m.dead) return true;
  if (m.landAt && now >= (m.animUntil ?? 0) && !m.gettingUp) {
    m.p = m.landAt;
    m.landAt = null;
    // (the throws and the knock-down end with him on his back, his head where it lands)
    m.anim = 'downed';
    m.animT = now;
    m.animDur = 0;
  }
  if (now < m.knockedUntil) return true;
  if (!m.gettingUp) {
    m.gettingUp = true;
    m.anim = 'getUp';
    m.animT = now;
    m.animDur = REACT.getUp.dur;
    m.animUntil = now + REACT.getUp.dur;
    return true;
  }
  if (now < m.animUntil) return true;
  m.knockedUntil = null;
  m.gettingUp = false;
  return false;
}

/** Should m block or slip what foe is throwing at him (foe.meleeKind landing at foe.meleeAt)? */
export function defendAgainst(m, foe, now, rand = Math.random, skill = 1) {
  if (foe.meleeAt == null || foe.meleeAt - now > 0.25 || (m.guardUntil ?? -Infinity) > now || down(m, now)) return null;
  const M = MELEE[foe.meleeKind];
  if (!M || M.kind !== 'strike') return null;
  if (rand() > 0.35 / skill) return null;
  return M.limb === 'hand' && M.zone === 'head' && rand() < 0.5 ? 'slip' : 'block';
}

/** The player's move for G / V / B at distance d (the n-th: they alternate). */
export function playerMove(what, d, n = 0) {
  if (what === 'kick') return d >= 0.85 ? (n % 2 ? 'roundKick' : 'frontKick') : 'lowKick';
  if (what === 'throw') return d < 0.9 ? (n % 2 ? 'shoulderThrow' : 'hipThrow') : 'footSweep';
  return d < 0.75 ? (n % 3 === 2 ? 'uppercut' : 'hook') : n % 2 ? 'cross' : 'jab';
}
