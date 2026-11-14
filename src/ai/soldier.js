/**
 * One soldier's fighting: how good he is, what he carries, and what he does with it.
 * Pure logic (no three.js), used by the squad AI (ai/squad.js) for every member.
 *
 *  - Expertise (m.skill): recruit, regular, veteran, elite. It sets how far his rounds
 *    scatter (worse when he is moving, wounded in an arm, or the target is far) and how
 *    fast he reloads and switches weapons.
 *  - Ammunition is limited, for everyone (the player too, walk/walk.js): rounds in the
 *    magazine and spare magazines (the gunner a belt). Empty: he reloads (the animation,
 *    faster for a veteran); no magazines left: he switches to the compact secondary; that
 *    empty too: the knife. "Last magazine" and "out of ammo" go on the radio.
 *  - Body armour (m.armour, plates; m.helmet): see sim/wounds.js armourStops().
 *  - The knife: an enemy within reach (close combat), he puts the rifle away and draws the
 *    knife (an animation each way), closes in and stabs; it lands at STAB_HIT into the
 *    clip. When the enemy is no longer close he puts the knife away and takes the rifle.
 *  - Casualties: a man badly hit (weak, or bleeding hard) is called in by the nearest man
 *    of his team ("Rifleman two is hit bad, need a medic"), or by himself if he is alone.
 *  - Under heavy fire from one side (several enemies close together over there, or men
 *    being hit), someone throws a grenade that way and shouts it ("Frag out!").
 */
import { recoilSpec } from './recoil.js';
import { FIGHT_D, pickMelee, startMelee, resolveMelee, applyMelee, defendAgainst } from './melee.js';

/** Expertise: scatter (x a regular's), reload and weapon-switch time (x), reaction (x). */
// (control: how long he takes to bring the muzzle back down after a round, x a regular's: ai/recoil.js)
// (nerve: how readily he flinches into a roll under fire, x a regular's; melee: his hand-to-hand
// (damage x, ai/melee.js); judgement: how well he picks his move in a fight, 0..1)
export const SKILL = {
  recruit: { aim: 1.8, reload: 1.35, react: 1.5, control: 1.4, nerve: 1.5, melee: 0.75, judgement: 0.55 },
  regular: { aim: 1.0, reload: 1.0, react: 1.0, control: 1.0, nerve: 1.0, melee: 1.0, judgement: 0.75 },
  veteran: { aim: 0.7, reload: 0.82, react: 0.8, control: 0.85, nerve: 0.75, melee: 1.15, judgement: 0.9 },
  elite: { aim: 0.5, reload: 0.7, react: 0.65, control: 0.7, nerve: 0.55, melee: 1.3, judgement: 1.0 },
};
/** What the experience level does (the editor's and the rig's tooltip). */
export const SKILL_INFO = 'Experience (recruit, regular, veteran, elite) sets: how far his rounds scatter (aim), how fast he pulls the muzzle back down after a round (recoil control, ai/recoil.js), how quickly he reacts (and blocks or slips a blow), how fast he reloads, switches weapons and picks things up, how readily he flinches into a roll under fire (nerve), and how hard and how well he fights hand-to-hand.';
export const SKILLS = Object.keys(SKILL);

/** What each carries: magazine size and spare magazines; the weapon's name in sim/wounds.js WEAPONS. */
export const ARMS = {
  rifle: { size: 30, mags: 5, kind: 'rifle', burst: 3 },
  mg: { size: 100, mags: 2, kind: 'mg', burst: 9 }, // the gunner's belt
  secondary: { size: 20, mags: 2, kind: 'carbine', burst: 2 },
  // a pump shotgun: 7 shells in the tube, loaded one at a time (reload: x the magazine change)
  shotgun: { size: 7, mags: 4, kind: 'shotgun', burst: 1, reload: 1.4 },
  pistol: { size: 15, mags: 3, kind: 'pistol', burst: 1, reload: 0.65 },
};

// Base times (s) of the animations (operator/rig.js), scaled by the expertise
// (operator/rig.js: RELOAD_TIME, SWITCH_TIME, STAB_HIT, THROW_FLASH_RELEASE)
export const TIMES = { reload: 2.8, toKnife: 1.6, toRifle: 1.8, toSecondary: 2.0, stab: 0.7, stabHit: 0.36, flash: 1.6, flashRelease: 1.0 };
export const KNIFE_REACH = 1.6; // m: he stabs from here
const CLOSE = 2.0; // m: an enemy this close (in arm's reach and a step): the knife
const CLEAR = 4.5; // m: no one this close any more: back to the rifle

/** Kit a member out once: expertise, weapon, ammunition, armour. */
export function kit(m) {
  if (m.kitted) return;
  m.kitted = true;
  m.skill = SKILL[m.skill] ? m.skill : 'regular';
  // (unarmed: no weapon at all, he fights hand-to-hand: ai/melee.js)
  m.weapon = m.loadout === 'torch' ? 'torch' : m.loadout === 'unarmed' ? 'fists' : 'rifle';
  // his primary: the gunner's MG, else what his loadout says (a shotgun, a pistol), else a rifle
  m.primary = m.squad === 'MG' ? 'mg' : m.loadout === 'shotgun' || m.loadout === 'pistol' ? m.loadout : 'rifle';
  const A = ARMS[m.primary];
  m.mag ??= A.size;
  m.mags ??= A.mags;
  m.secMag ??= ARMS.secondary.size;
  m.secMags ??= ARMS.secondary.mags;
  m.armour ??= false;
  m.helmet ??= !!m.armour; // the helmet comes with the armour kit
  if (m.loadout === 'unarmed') m.mag = m.mags = m.secMag = m.secMags = 0;
}

export const skillOf = (m) => SKILL[m.skill] ?? SKILL.regular;

/**
 * The recoil of the weapon in his hands (ai/recoil.js): its kind (rifle, the gunner's MG, the
 * carbine), m.recoil (the override factor, 1 = physical), m.fireMode (single, burst, auto).
 */
export function recoilOf(m) {
  const wk = weaponKind(m);
  const kind = ['mg', 'carbine', 'shotgun', 'pistol'].includes(wk) ? wk : 'rifle';
  const key = `${kind}|${m.recoil ?? 1}|${m.fireMode ?? ''}`;
  if (m.recoilSpec?.key !== key) m.recoilSpec = { ...recoilSpec(kind, { recoil: m.recoil, mode: m.fireMode }), key };
  return m.recoilSpec;
}

/** Total rounds he has left (magazine + spares, primary and secondary). */
export function roundsLeft(m) {
  const A = ARMS[m.primary ?? 'rifle'];
  return (m.mag ?? 0) + (m.mags ?? 0) * A.size + (m.secMag ?? 0) + (m.secMags ?? 0) * ARMS.secondary.size;
}

/**
 * Where a round from m at target T goes: scattered by expertise, range, his moving, an arm
 * wound and the weapon (the secondary is less accurate at range).
 */
export function aimPoint(m, T, rand = Math.random) {
  const d = Math.hypot(T[0] - m.p[0], T[2] - m.p[2]);
  let s = 0.012 * skillOf(m).aim * d; // ~0.12 m at 10 m for a regular
  if (m.moving) s *= 1.8;
  if (m.wounds?.armL || m.wounds?.armR) s *= 2;
  if (m.weapon === 'secondary') s *= 1 + d / 25;
  if (m.squad === 'MG') s *= 1.3; // bursts from the bipod: a cone, not a point
  // buckshot: a pattern that opens ~2.5 cm a metre (where its centre goes); a pistol at range
  const wk = weaponKind(m);
  if (wk === 'shotgun') s = Math.max(s, 0.025 * d) + 0.01 * d;
  else if (wk === 'pistol') s *= 1 + d / 20;
  // the muzzle still climbing from the rounds before (ai/recoil.js: a burst, a long string): wider, and high
  const c = m.climb ?? 0;
  s += 0.6 * c * d;
  const g = () => (rand() + rand() + rand() - 1.5) * 1.15; // ~gaussian
  return [T[0] + g() * s, T[1] + 0.9 + g() * s * 0.8 + 0.5 * c * d, T[2] + g() * s];
}

/** The weapon in his hands and its magazine. */
function current(m) {
  if (m.weapon === 'secondary') return { A: ARMS.secondary, mag: 'secMag', mags: 'secMags' };
  return { A: ARMS[m.primary ?? 'rifle'], mag: 'mag', mags: 'mags' };
}

/** Can he fire a round now? (a round in the magazine, the gun in his hands) */
export function canShoot(m) {
  if (m.weapon === 'knife' || m.weapon === 'torch' || m.weapon === 'fists' || m.switching) return false;
  return m[current(m).mag] > 0;
}

/** A round fired: one less in the magazine. Empty: reload / switch (handled by manage()). */
export function spend(m) {
  const c = current(m);
  m[c.mag] = Math.max(0, m[c.mag] - 1);
}

/** The weapon kind for sim/wounds.js. */
export const weaponKind = (m) => (m.weapon === 'secondary' ? 'carbine' : m.weapon === 'knife' ? 'knife' : m.weapon === 'fists' ? 'fist' : ARMS[m.primary ?? 'rifle'].kind);

/**
 * Each step for each member (not busy with another one-shot animation): reloading, running
 * dry, switching, the knife. sq is the SquadAI (setAnim, say, time, host). Returns true while
 * this took his hands (the caller then does not shoot or move him).
 */
export function manage(sq, m, dt, enemies) {
  const t = sq.time;
  const K = skillOf(m);
  // a switch or a reload under way
  if (m.switching) {
    if (t < m.switching.until) return true;
    m.weapon = m.switching.to;
    m.switching = null;
  }
  if (m.reloadUntil) {
    if (t < m.reloadUntil) return true;
    const c = current(m);
    m[c.mag] = c.A.size;
    m.reloadUntil = 0;
  }
  if (m.weapon === 'torch') return false;
  // close combat: the nearest enemy within reach
  let near = null, nd = Infinity;
  for (const h of enemies) {
    if (h.dead) continue;
    const d = Math.hypot(h.p[0] - m.p[0], h.p[2] - m.p[2]);
    if (Math.abs((h.p[1] ?? 0) - m.p[1]) < 1.5 && d < nd) (nd = d), (near = h);
  }
  // no weapon (unarmed, or dry with the knife gone): fists, feet and throws (ai/melee.js)
  if (m.weapon !== 'fists' && m.noKnife && m.dry && near && nd < CLEAR) m.weapon = 'fists';
  if (m.weapon === 'fists') return near && nd < HAND_RANGE ? handFight(sq, m, near, nd, dt) : false;
  if (near && nd < CLOSE && m.weapon !== 'knife' && !m.crawling && !(m.wounds?.armR)) {
    switchTo(sq, m, 'knife');
    return true;
  }
  if (m.weapon === 'knife') {
    if (near && nd < CLEAR) {
      m.knifeTarget = near;
      return knifeFight(sq, m, near, nd, dt);
    }
    m.knifeTarget = null;
    const back = m.mag > 0 || m.mags > 0 ? 'rifle' : m.secMag > 0 || m.secMags > 0 ? 'secondary' : null;
    if (back) {
      switchTo(sq, m, back);
      return true;
    }
    return false;
  }
  // magazine empty: reload, or the secondary, or the knife
  const c = current(m);
  if (m[c.mag] <= 0) {
    if (m[c.mags] > 0) {
      m[c.mags]--;
      const dur = TIMES.reload * K.reload * (c.A === ARMS.mg ? 1.6 : c.A.reload ?? 1);
      m.reloadUntil = t + dur;
      sq.setAnim(m, 'reload', dur);
      m.signal = { text: 'RELOADING', until: t + Math.min(2, dur) };
      if (m[c.mags] === 0 && m.weapon !== 'secondary') sq.say(m, `${sq.unit}, ${sq.name(m)}, last magazine`, 'intel');
      return true;
    }
    if (m.weapon !== 'secondary' && (m.secMag > 0 || m.secMags > 0)) {
      switchTo(sq, m, 'secondary');
      sq.say(m, `${sq.unit}, ${sq.name(m)}, out of rifle ammo, on my secondary`, 'intel');
      return true;
    }
    if (!m.dry) {
      m.dry = true;
      sq.say(m, `${sq.unit}, ${sq.name(m)}, out of ammo`, 'intel');
    }
  }
  return false;
}

/** Put the weapon in his hands away and take another (animations from operator/rig.js). */
export function switchTo(sq, m, to) {
  if (m.weapon === to || m.switching) return;
  const K = skillOf(m);
  const dur = (to === 'knife' ? TIMES.toKnife : to === 'secondary' ? TIMES.toSecondary : TIMES.toRifle) * K.reload;
  m.switching = { to, from: m.weapon, until: sq.time + dur };
  m.reloadUntil = 0;
  sq.setAnim(m, to === 'knife' ? 'drawKnife' : to === 'secondary' ? 'drawSecondary' : m.weapon === 'knife' ? 'sheathKnife' : 'drawRifle', dur);
}

/** An unarmed man takes on an enemy within this (m). */
export const HAND_RANGE = 9;
/**
 * Hand-to-hand (ai/melee.js): close in to fighting distance, then strikes, the clinch and throws
 * picked by the distance and the state of his man; a move lands at its time if he is still in
 * reach (host.melee(m, h, result), else applied to h itself); he blocks or slips what comes his way.
 */
function handFight(sq, m, h, d, dt) {
  const t = sq.time;
  sq.face(m, h.p, dt, 8);
  if (m.meleeAt != null) {
    if (t >= m.meleeAt) {
      const kind = m.meleeKind;
      m.meleeAt = null;
      const dd = Math.hypot(h.p[0] - m.p[0], h.p[2] - m.p[2]);
      const res = resolveMelee(m, h, kind, dd, { now: t });
      res.dmg *= skillOf(m).melee; // (an old hand hits harder)
      m.lastMelee = res;
      if (res.hit) {
        if (sq.host.melee) sq.host.melee(m, h, res);
        else applyMelee(h, res, t, m);
      }
    }
    return true;
  }
  if (sq.busy(m)) return true;
  // what is coming his way: a block or a slip
  const def = defendAgainst(m, h, t, Math.random, skillOf(m).react);
  if (def) {
    startMelee(m, def, t);
    return true;
  }
  if (d > 1.45) {
    // close in to fighting distance, fast
    const ux = (h.p[0] - m.p[0]) / d, uz = (h.p[2] - m.p[2]) / d;
    m.path = [[h.p[0] - ux * FIGHT_D, m.p[1], h.p[2] - uz * FIGHT_D]];
    m.pathI = 0;
    m.moveMode = 'run';
    m.then = null;
    m.clinchedBy = null;
    return false; // the squad's move() takes him there
  }
  m.path = null;
  m.meleeCd = (m.meleeCd ?? 0) - dt;
  if (m.meleeCd <= 0) {
    // (judgement: a poorer fighter now and then throws whatever reaches, not the right move)
    const k = pickMelee(m, h, d, { now: t, judgement: skillOf(m).judgement });
    if (k) {
      startMelee(m, k, t);
      m.meleeCd = 0.2 * skillOf(m).react;
      return true;
    }
  }
  if (!sq.busy(m)) sq.setAnim(m, 'guard');
  return true;
}

/** With the knife: close in, stab when in reach. */
function knifeFight(sq, m, h, d, dt) {
  const t = sq.time;
  sq.face(m, h.p, dt, 8);
  if (m.stabAt != null) {
    if (t >= m.stabAt) {
      m.stabAt = null;
      // the blade lands if he is still in reach (the enemy may have stepped back)
      const dd = Math.hypot(h.p[0] - m.p[0], h.p[2] - m.p[2]);
      if (dd < KNIFE_REACH + 0.4) sq.host.stab?.(m, h);
    }
    return true;
  }
  if (d > KNIFE_REACH) {
    // close in: straight at him, fast
    m.path = [[h.p[0], m.p[1], h.p[2]]];
    m.pathI = 0;
    m.moveMode = 'run';
    m.then = null;
    return false; // the squad's move() takes him there
  }
  m.path = null;
  m.stabCd = (m.stabCd ?? 0) - dt;
  if (m.stabCd <= 0) {
    const K = skillOf(m);
    m.stabCd = (TIMES.stab + 0.35) * K.react;
    sq.setAnim(m, 'stab', TIMES.stab);
    m.stabAt = t + TIMES.stabHit;
  } else if (!sq.busy(m)) sq.setAnim(m, 'knifeReady');
  return true;
}

/** Badly hit: weak, or bleeding hard. */
export const badlyHit = (m) => !m.dead && ((m.health ?? 100) < 45 || (m.bleed ?? 0) > 2.5);

/** A man badly hit is called in by the nearest of his team (once). */
export function casualties(sq, al) {
  for (const m of al) {
    if (m.casualtyCalled || !badlyHit(m)) continue;
    m.casualtyCalled = true;
    let by = null, bd = 14;
    for (const o of al) {
      if (o === m || o.dead) continue;
      const d = Math.hypot(o.p[0] - m.p[0], o.p[2] - m.p[2]);
      if (d < bd) (bd = d), (by = o);
    }
    const who = sq.name(m);
    if (by) {
      by.signal = { text: 'MEDIC!', until: sq.time + 2 };
      sq.host.shout?.(by, `Medic! ${who} is hit!`);
      sq.say(by, `${sq.unit}, ${who} is hit bad, ${m.bleed > 2.5 ? 'bleeding heavily' : 'he is down'}, need a medic`, 'casualty');
    } else sq.say(m, `${sq.unit}, ${who}, I am hit bad, need a medic`, 'casualty');
    sq.lastCasualty = sq.time;
  }
}

/**
 * Heavy fire from one side: enemies close together over there (seen), or two of the team
 * hit within a few seconds. Returns the point to throw at, or null.
 */
export function heavyFire(sq, al, seen) {
  // a cluster of at least two seen enemies within 6 m of each other
  let best = null, bn = 1;
  for (const h of seen) {
    const n = seen.filter((o) => Math.hypot(o.p[0] - h.p[0], o.p[2] - h.p[2]) < 6).length;
    if (n > bn) (bn = n), (best = h);
  }
  if (best) {
    const c = seen.filter((o) => Math.hypot(o.p[0] - best.p[0], o.p[2] - best.p[2]) < 6);
    return c.reduce((a, o) => [a[0] + o.p[0] / c.length, a[1] + o.p[1] / c.length, a[2] + o.p[2] / c.length], [0, 0, 0]);
  }
  const hit = al.filter((m) => m.lastHitT != null && sq.host.now?.() - m.lastHitT < 5).length;
  return hit >= 2 && sq.threat ? sq.threat.slice() : null;
}
