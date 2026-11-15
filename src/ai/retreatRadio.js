/**
 * The retreat's word: why the leader pulls his squad out, how the word goes round his men, and how
 * his radio man calls it in to the other friendly teams (on top of ai/retreat.js). Pure logic, no
 * three.js. There is no button for it: the squad decides, signals and reports by itself; the
 * squad model's 'Strategy on contact' (auto / retreat / no retreat) only forces it or rules it out.
 *
 *  - Deciding (retreatCase): the leader weighs, in this order, and takes the first that holds:
 *      ordered             the model's param, host.retreat.order, orderRetreat(sq) (or a friendly
 *                          team's flank gone: why it says)
 *      the commander is down  the commander dead, down or badly hit, the enemy as strong as the
 *                          men left (less one) and two at least: the next man takes over and gets out
 *      heavy casualties    men lost (dead, down, badly hit) and an enemy as strong as the men
 *                          standing, or half the squad lost with the enemy still there
 *      outgunned           the enemy's strength (strengthOf: a man 1, a vehicle 4, a helicopter 6,
 *                          the dragon 8) twice theirs with armour, a helicopter or the dragon
 *                          among them, or three times theirs whatever it is
 *      flanked             enemies seen well off the line to the threat (more than 100° from it,
 *                          or spread over more than 120° round them), two or more of them
 *      pinned down         two or more of them hit or with rounds cracking past them (m.shotAt) in
 *                          the last seconds, by an enemy as strong as they are
 *      low on ammunition   less than an eighth of the squad's rounds left, the enemy still there
 *    Plain numbers, two to one, still mean the older team-by-team 'withdraw' (ai/strategy.js).
 *    Each case keeps its facts (sq.retreatWhy { why, reasons, facts, text }) and is logged
 *    (sq.retreatLog, and sq.log if the host keeps one: 'retreat:decide:<why>').
 *  - The word in the squad (startWord / stepWord): no man peels back before he has it.
 *      heard      the leader shouts "Fall back! Fall back to the rally point!": a shout (85 dB at
 *                 a metre) heard where it is still above the din (quiet ~40 dB; in the fight,
 *                 the rifles going, ~65 dB: some 10 m), less each wall between (perception.js
 *                 wallLoss). Under radio silence he does not shout.
 *      seen       the leader's hand signal ('signalFallBack': arm up, circling, then a sweep to
 *                 the rear; repeated while anyone lacks the word): a man looking over now and
 *                 then (every second or two, seeded) who sees him (host.lineOfSight, within what
 *                 the weather and the dark allow) picks it up.
 *      relayed    a man with the word passes it on to the next man who has not got it (a shout
 *                 "Fall back, pass it on!", or the signal under silence), a second or so after
 *                 he got it himself.
 *      saw them go  a man who still has nothing but sees his mates pulling back follows them;
 *                 alone, out of sight and earshot of everyone, he goes on his own after a while.
 *    Each man acknowledges ("Falling back!", or a thumbs-up under silence) a moment after he gets
 *    it (his reaction time). The state: sq.strategy.word { mode, lead, men: Map(m → { how, from,
 *    t, ack }) }.
 *  - Calling it in (callItIn): once the squad has the word the radio man keys the radio (the
 *    retreat breaks radio silence) and calls all friendly stations: where they are, why, the
 *    enemy's strength and what it is, where it is, the rally point. Friendly: the other teams
 *    (host.peers) on the same side (sideOf: host.side, else the men's m.side, else all one side);
 *    an enemy team on the net hears nothing. Each friendly team answers in turn and acts on it
 *    (reactToCall):
 *      near (within SUPPORT_R of them), fit: moves up to an overwatch point on its side of the
 *                 retreating team, towards the threat, and puts suppressive fire on it while the
 *                 others get back (sq.supporting: the base of fire's rate, ai/squad.js)
 *      not in a fight, too far to walk up, a stationary vehicle by it with seats for all
 *                 (ai/squadVehicle.js mountForBackup): mounts up (the signaller calls it, the men
 *                 get in one by one, he last) and the vehicle takes it to them
 *      further, but in contact beside them (within FLANK_R, its front the same way as theirs):
 *                 its flank is open now, it falls back too (its own retreat, 'our flank is exposed')
 *      already falling back: says so
 *      else       acknowledges and holds, the rally point noted (sq.friendRally)
 *    Their calls are kept (sq.retreatCalls) and logged ('retreat:call:<unit>:<reaction>').
 */
import { badlyHit } from './soldier.js';
import { srand } from './strategy.js';
import { LOUDNESS, wallLoss } from './perception.js';
import { mountForBackup } from './squadVehicle.js';
import { experienceOf, moraleK } from './experience.js';

/** How much each kind of hostile counts for, against one man. */
export const STRENGTH = { man: 1, vehicle: 4, tank: 5, helicopter: 6, jet: 6, dragon: 8 };
const HEAVY = new Set(['vehicle', 'tank', 'helicopter', 'jet', 'dragon']);
const DIN = { quiet: 40, fight: 65 }; // dB: the din a shout must carry over
const SHOUT_DB = LOUDNESS.shout; // dB at a metre
export const SUPPORT_R = 50; // m: a team this near moves up to cover the retreat
const FLANK_R = 90; // m: a team this near the threat, as forward as the rally point: its flank is open
const ALONE_T = 14; // s: nothing heard or seen this long, mates gone: he goes on his own
const NAME = { CMD: 'commander', MG: 'gunner', R1: 'rifleman one', R2: 'rifleman two', UAV: 'drone' };
const BEARING = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const d2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const cen = (l) => l.reduce((c, m) => [c[0] + m.p[0] / l.length, c[1] + m.p[1] / l.length, c[2] + m.p[2] / l.length], [0, 0, 0]);
const dirWord = (from, to) => BEARING[((Math.round(Math.atan2(to[0] - from[0], -(to[2] - from[2])) / (Math.PI / 4)) % 8) + 8) % 8];

/** Write it down: sq.retreatLog always, the host's sq.log if it keeps one. */
export function note(sq, s) {
  (sq.retreatLog ??= []).push(s);
  sq.log?.push(s);
}

/* ------------------------------------------------------------------ deciding */

/** What a hostile is (a man, a vehicle, a helicopter, the dragon) by what it says of itself. */
export function kindOf(h) {
  const k = String(h.kind ?? h.type ?? (h.rotor || h.heli ? 'helicopter' : h.wings || h.dragon ? 'dragon' : h.vehicle ? 'vehicle' : 'man')).toLowerCase();
  if (/heli|gunship|chopper/.test(k)) return 'helicopter';
  if (/dragon/.test(k)) return 'dragon';
  if (/tank/.test(k)) return 'tank';
  if (/jet|plane/.test(k)) return 'jet';
  if (/vehicle|apc|truck|car|ifv/.test(k)) return 'vehicle';
  return 'man';
}
/** What one hostile counts for (its own h.strength if it says). */
export const strengthOf = (h) => h.strength ?? STRENGTH[kindOf(h)] ?? 1;

/** The enemy as the squad sees it: { n, strength, heavy, kinds: { kind: n } }. */
export function enemyStrength(sq) {
  const seen = (sq.seen ?? []).filter((h) => !h.dead);
  const kinds = {};
  for (const h of seen) kinds[kindOf(h)] = (kinds[kindOf(h)] ?? 0) + 1;
  const strength = seen.reduce((s, h) => s + strengthOf(h), 0) || (sq.threat ? 1 : 0);
  return { n: seen.length || (sq.threat ? 1 : 0), strength, heavy: seen.some((h) => HEAVY.has(kindOf(h))), kinds };
}
/** The enemy in words: "4 men and a helicopter". */
export function enemyWords(E) {
  const one = { man: 'man', vehicle: 'vehicle', tank: 'tank', helicopter: 'helicopter', jet: 'jet', dragon: 'dragon' };
  const parts = Object.entries(E.kinds).map(([k, n]) => (n === 1 ? (k === 'man' ? 'one man' : `a ${one[k]}`) : `${n} ${k === 'man' ? 'men' : one[k] + 's'}`));
  if (!parts.length) return E.n ? `${E.n} hostile${E.n > 1 ? 's' : ''}` : 'unknown strength';
  return parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts.at(-1) : parts[0];
}

/**
 * Should the squad get out, and why (see the top)? { why, reasons, facts, text } or null.
 * o: the retreat's params (ai/retreat.js retreatOpts); a: the leader's assessment (ai/strategy.js assess).
 */
export function retreatCase(sq, a, o) {
  if (o.order) return { why: o.why ?? 'ordered', reasons: [o.why ?? 'ordered'], facts: {}, text: o.why ?? 'ordered' };
  if (!o.auto || !a.T) return null;
  const ms = sq.members().filter((m) => m.squad !== 'UAV');
  const al = ms.filter((m) => !m.dead);
  const fit = a.fit ?? al.filter((m) => !m.down && !badlyHit(m)).length;
  const E = enemyStrength(sq);
  const S = Math.max(E.strength, a.enemies ?? 0);
  const now = sq.host.now?.() ?? sq.time;
  const lost = ms.filter((m) => m.dead || m.down || badlyHit(m)).length;
  const wounded = al.filter((m) => m.down || badlyHit(m)).length;
  // (rounds past him keep a man down longer the greener he is: ai/experience.js suppress)
  const cracked = al.filter((m) => (m.lastHitT != null && now - m.lastHitT < 6) || (m.shotAt && now - m.shotAt.time < 3 * experienceOf(m).suppress)).length;
  // (the team's morale: how far outgunned before they pull out; 0.5 → as it always was)
  const cmd = ms.find((m) => m.squad === 'CMD');
  const mk = moraleK(cmd ?? al[0]);
  const cmdLost = !!cmd && (cmd.dead || cmd.down || badlyHit(cmd));
  // flanked: enemies well off the line to the threat, or spread right round them
  const c = cen(al.length ? al : ms);
  const ang = (p) => Math.atan2(p[0] - c[0], p[2] - c[2]);
  const off = (x, y) => Math.abs(((x - y + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
  const seen = (sq.seen ?? []).filter((h) => !h.dead);
  const aT = ang(a.T);
  let spread = 0, wide = 0;
  for (const h of seen) {
    wide = Math.max(wide, off(ang(h.p), aT));
    for (const g of seen) spread = Math.max(spread, off(ang(h.p), ang(g.p)));
  }
  const flanked = seen.length >= 2 && (wide > (100 * Math.PI) / 180 || spread > (120 * Math.PI) / 180);
  const facts = { fit, men: al.length, lost, wounded, strength: S, enemies: E.n, heavy: E.heavy, kinds: E.kinds, hits: cracked, ammo: a.ammo ?? 1, cmdLost, flanked };
  const reasons = [];
  if (cmdLost && S >= Math.max(2, fit - 1)) reasons.push('the commander is down');
  if (wounded >= 1 && S >= 2 && S >= fit) reasons.push('heavy casualties');
  if ((E.heavy && S >= 2 * mk * Math.max(1, fit)) || S >= 3 * mk * Math.max(1, fit)) reasons.push('outgunned');
  if (flanked && S >= 2 && S + 1 >= fit) reasons.push('flanked');
  if (cracked >= 2 && S >= 2 && S >= fit) reasons.push('pinned down');
  if ((a.ammo ?? 1) < 0.12 && S >= 1) reasons.push('low on ammunition');
  if (!reasons.length) return null;
  const text = `${reasons.join(', ')} (${fit} of ${ms.length} standing, enemy ${enemyWords(E)}, strength ${S}${cracked ? `, ${cracked} under fire` : ''}, ${Math.round((a.ammo ?? 1) * 100)}% ammunition)`;
  return { why: reasons[0], reasons, facts, text };
}

/* ------------------------------------------------------------------ sides */

/** The side a team fights on: host.side, its men's m.side, else every team on one side. */
export const sideOf = (sq) => sq.host.side ?? sq.members().find((m) => m.side)?.side ?? 'friendly';
/** The other friendly teams still in it. */
export const friendliesOf = (sq) => (sq.host.peers?.() ?? []).filter((p) => p !== sq && p.alive?.() && sideOf(p) === sideOf(sq));

/* ------------------------------------------------------------------ the word in the squad */

/** Has he the word to fall back (the gate on peeling back: ai/retreat.js)? */
export const hasWord = (sq, m) => !sq.strategy?.word || m.squad === 'UAV' || !!sq.strategy.word.men.get(m)?.how;

/** The din a shout has to carry over: the host's (host.din(p), dB), else the fight's. */
function din(sq, p) {
  const D = sq.host.din?.(p);
  if (Number.isFinite(D)) return D;
  const now = sq.host.now?.() ?? sq.time;
  const fight = (sq.seen?.length ?? 0) > 0 || sq.members().some((m) => (m.lastHitT != null && now - m.lastHitT < 5) || (m.shotAt && now - m.shotAt.time < 3));
  return fight ? DIN.fight : DIN.quiet;
}
/** Does b hear a shout from a? (over the din, less the walls between) */
export function shoutHeard(sq, a, b) {
  const d = Math.max(1, Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]));
  const loss = sq.host.solid ? wallLoss([a.p[0], a.p[1] + 1.5, a.p[2]], [b.p[0], b.p[1] + 1.5, b.p[2]], sq.host.solid) : 0;
  return SHOUT_DB - 20 * Math.log10(d) - loss > din(sq, b.p);
}
/** Can b see a's hand (in sight, within what the weather and the dark allow)? */
export function signalSeen(sq, a, b) {
  const H = sq.host;
  let R = Math.min(45, H.visibility?.() ?? 60);
  if (H.dark?.() && !sq.gear?.thermal) R = 6;
  if (d2(a.p, b.p) > R) return false;
  return H.lineOfSight ? !!H.lineOfSight(a.p, b.p) : true;
}

const SIGNAL_T = 2.0, SIGNAL_EVERY = 4;
/** The leader's hand signal to fall back (and anyone relaying it under silence). */
function handSignal(sq, m, text = 'FALL BACK · RALLY') {
  if (!m.down && !m.dead && !m.rescueRole) sq.setAnim(m, 'signalFallBack', SIGNAL_T);
  m.signal = { text, until: sq.time + SIGNAL_T };
}

/**
 * The word put about (ai/retreat.js startRetreat): the leader shouts it, or signals it, or both;
 * the call to the other teams is queued for when the squad has it.
 */
export function startWord(sq, P) {
  const lead = sq.radioMan();
  const silent = sq.time < sq.silentUntil;
  const W = { mode: silent ? 'silent' : 'voice', lead, t0: sq.time, men: new Map(), signalT: sq.time, signals: 1, called: false };
  P.word = W;
  const men = sq.members().filter((m) => !m.dead && m.squad !== 'UAV');
  for (const m of men) {
    const g = { how: null, from: null, t: null, ack: null, glance: 0.3 + srand(sq) * 1.3, react: 0.3 + srand(sq) * 0.5 };
    // (a man down is the leader's to decide about: he does not move by himself)
    if (m === lead || m.down) Object.assign(g, { how: m === lead ? 'lead' : 'down', t: sq.time, ack: sq.time });
    W.men.set(m, g);
  }
  if (!lead) return;
  const D = sq.retreatWhy;
  note(sq, `retreat:decide:${P.why}${D?.text && D.text !== P.why ? ` · ${D.text}` : ''}`);
  sq.status = `Retreat: ${D?.text ?? P.why}`;
  // the leader: a shout (not under silence), and the hand signal (always: the din, or silence)
  if (!silent) {
    sq.host.shout?.(lead, 'Fall back! Fall back to the rally point!');
    for (const m of men) if (m !== lead && !W.men.get(m).how && shoutHeard(sq, lead, m)) pend(sq, W, m, 'heard', lead, W.men.get(m).react);
  }
  handSignal(sq, lead);
  note(sq, `retreat:signal:${silent ? 'hand (radio silence)' : 'voice and hand'}`);
}

/** He will have it after his reaction time. */
function pend(sq, W, m, how, from, delay) {
  const g = W.men.get(m);
  if (!g || g.how || g.pend) return;
  g.pend = { how, from, at: sq.time + delay };
}

/** Each step of the retreat (before the peeling): the word goes round, the call goes out. */
export function stepWord(sq, P, dt) {
  const W = P.word;
  if (!W) return;
  const men = [...W.men.keys()].filter((m) => !m.dead);
  const lead = W.lead && !W.lead.dead ? W.lead : sq.radioMan();
  // the word arriving, and the acknowledgement a moment after
  for (const m of men) {
    const g = W.men.get(m);
    if (g.pend && sq.time >= g.pend.at) {
      Object.assign(g, { how: g.pend.how, from: g.pend.from, t: sq.time, relayAt: sq.time + 0.6 + srand(sq) * 0.9 });
      g.pend = null;
      note(sq, `retreat:word:${m.squad}:${g.how}${g.from ? `:${g.from.squad}` : ''}`);
    }
    if (g.how && g.ack == null && sq.time >= g.t + 0.25) {
      g.ack = sq.time;
      if (W.mode === 'silent' || m.down) {
        m.signal = { text: 'ACK · THUMBS UP', until: sq.time + 1.5 };
        if (!m.down && !sq.busy(m)) sq.setAnim(m, 'signalHalt', 1.0);
      } else {
        m.signal = { text: 'FALLING BACK!', until: sq.time + 1.5 };
        sq.host.shout?.(m, 'Falling back!');
      }
      note(sq, `retreat:ack:${m.squad}`);
    }
  }
  const lacking = men.filter((m) => !W.men.get(m).how && !W.men.get(m).pend && !m.down);
  // the leader signals again while anyone lacks it
  if (lacking.length && lead && sq.time - W.signalT >= SIGNAL_EVERY && W.signals < 5) {
    W.signalT = sq.time;
    W.signals++;
    handSignal(sq, lead);
  }
  const signalling = (s) => s && (s.signal?.until ?? 0) > sq.time && /FALL BACK/.test(s.signal.text);
  for (const m of lacking) {
    const g = W.men.get(m);
    // a look over at the leader (and the others) now and then
    g.glance -= dt;
    const look = g.glance <= 0;
    if (look) g.glance = 0.8 + srand(sq) * 1.2;
    if (look && signalling(lead) && signalSeen(sq, lead, m)) {
      pend(sq, W, m, 'seen', lead, 0.3);
      continue;
    }
    // the next man passes it on: a shout, or the signal (under silence; or seen)
    const by = men
      .filter((r) => r !== m && !r.down && W.men.get(r).how && W.men.get(r).how !== 'down' && sq.time >= (W.men.get(r).relayAt ?? Infinity))
      .sort((x, y) => d2(x.p, m.p) - d2(y.p, m.p))
      .find((r) => (W.mode !== 'silent' && shoutHeard(sq, r, m)) || (look && signalSeen(sq, r, m)));
    if (by) {
      if (W.mode !== 'silent' && shoutHeard(sq, by, m)) sq.host.shout?.(by, `${NAME[m.squad] ?? 'You'}, fall back, pass it on!`);
      else handSignal(sq, by, 'FALL BACK · PASS IT ON');
      pend(sq, W, m, 'relayed', by, g.react + 0.3);
      continue;
    }
    // nothing heard, nothing seen: his mates pulling back (in sight) tell him; alone, he goes
    if (look && men.some((r) => r !== m && r.rt?.role === 'move' && r.moving && signalSeen(sq, r, m))) pend(sq, W, m, 'saw them go', null, g.react);
    else if (sq.time - W.t0 > ALONE_T) pend(sq, W, m, 'alone', null, g.react);
  }
  // the squad has it (or has had time to): the radio man calls it in
  if (!W.called && (men.every((m) => W.men.get(m).how) || sq.time - W.t0 > 6)) {
    W.called = true;
    callItIn(sq, P);
  }
}

/* ------------------------------------------------------------------ the other teams */

/** The radio man calls it in to all friendly stations (see the top). */
export function callItIn(sq, P) {
  const U = sq.unit;
  const al = sq.members().filter((m) => !m.dead);
  if (!al.length) return;
  const c = cen(al), T = sq.threat ?? P.rt?.rally ?? c, R = P.rt?.rally ?? c;
  const E = enemyStrength(sq);
  const call = { from: sq, unit: U, side: sideOf(sq), p: c, T: T.slice(), rally: R.slice(), why: P.why, enemy: E, t: sq.time };
  sq.retreatCall = call;
  const text = `All stations, ${U}, falling back, ${P.why}. Position grid ${Math.round(c[0])} ${Math.round(c[2])}. Enemy ${enemyWords(E)}, ${Math.round(d2(c, T))} metres ${dirWord(c, T)} of us. Rally point ${Math.round(d2(c, R))} metres ${dirWord(c, R)}, over`;
  const friends = friendliesOf(sq);
  sq.radioQueue.push({
    at: sq.time + 0.2,
    text,
    kind: 'retreat',
    fn: (s) => {
      s.silentUntil = 0; // (a retreat in contact breaks radio silence)
      note(s, `retreat:radio:${friends.length} friendly`);
      if (!friends.length) s.radioQueue.push({ at: s.time + 3.2, self: true, text: `${U}, no response`, kind: 'none' });
      friends.forEach((p, i) =>
        p.radioQueue.push({ at: p.time + 2.8 + i * 2.6, text: '', kind: 'reply', fn: (q) => reactToCall(q, call) }));
    },
  });
}

/** Two teams side by side facing the same way (their fronts within 60°): the one covers the other's flank. */
function sameFront(T1, p1, T2, p2) {
  const a = [T1[0] - p1[0], T1[2] - p1[2]], b = [T2[0] - p2[0], T2[2] - p2[2]];
  const la = Math.hypot(...a) || 1, lb = Math.hypot(...b) || 1;
  return (a[0] * b[0] + a[1] * b[1]) / (la * lb) > Math.cos(Math.PI / 3);
}

/** A friendly team hears the call: answers, and acts on it (see the top). Returns its reply. */
export function reactToCall(p, call) {
  const al = p.members().filter((m) => !m.dead);
  if (!al.length) return null;
  const U = call.unit, me = p.unit;
  const fit = al.filter((m) => m.squad !== 'UAV' && !m.down && !badlyHit(m));
  const pc = cen(al);
  const d = d2(pc, call.p);
  const engaged = !!p.threat && p.contacted;
  let react, text;
  if (p.retreating || p.strategy?.kind === 'retreat' || p.strategy?.kind === 'withdraw') {
    react = 'also';
    text = `${me}, copy ${U}, we are falling back too, out`;
  } else if ((text = mountForBackup(p, call))) {
    // a stationary vehicle by them, too far to walk up: they mount up and come (ai/squadVehicle.js)
    react = 'mount';
  } else if (d <= SUPPORT_R && fit.length >= 2) {
    // overwatch: on our side of them, level with them, a little towards the threat
    const ax = call.T[0] - call.p[0], az = call.T[2] - call.p[2], l = Math.hypot(ax, az) || 1;
    const ux = ax / l, uz = az / l;
    const side = Math.sign((pc[0] - call.p[0]) * -uz + (pc[2] - call.p[2]) * ux) || 1;
    let to = [call.p[0] - uz * side * 9 + ux * 2, pc[1], call.p[2] + ux * side * 9 + uz * 2];
    if (!p.threat) {
      p.threat = call.T.slice();
      p.navAge = Infinity;
    }
    try {
      if (p.navAge === Infinity) {
        p.rebuildNav();
        p.navAge = 0;
      }
      const k = p.nearestFree?.(to[0], to[2]);
      if (k >= 0) to = p.cellPos(k);
    } catch {
      // (no grid there: the point as it is)
    }
    p.applyOrder({ kind: 'flank', to });
    p.supporting = { unit: U, T: call.T.slice(), to, until: p.time + 60 };
    react = 'support';
    text = `${me}, copy ${U}, moving to support, overwatch from your ${side > 0 ? 'left' : 'right'}, we will put fire on them, out`;
  } else if (engaged && d <= FLANK_R && sameFront(p.threat, pc, call.T, call.p)) {
    // (a flank it was sent to, a pursuit: given up, the leader's strategy has them again)
    Object.assign(p, { goal: null, pursuit: false, holdOff: false });
    p.retreatOrder = { order: true, why: 'our flank is exposed' };
    if (p.strategy) p.strategy.dirty = true;
    p.stratT = 0;
    react = 'fall back';
    text = `${me}, copy ${U}, our flank is open, we are falling back as well, out`;
  } else {
    p.friendRally = call.rally.slice();
    react = 'hold';
    text = `${me}, copy ${U}, holding our position, noted your rally point, out`;
  }
  (p.retreatCalls ??= []).push({ from: U, react, t: p.time, call });
  note(p, `retreat:call:${U}:${react}`);
  return text;
}
