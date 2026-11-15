/**
 * The squad leader's fighting strategy on contact (on top of ai/squad.js, which moves, covers and
 * fires). Pure logic, no three.js.
 *
 *  - assess(sq): what the leader weighs: the enemies he knows of (how many: every hostile his men
 *    see or saw lately and the near friendly teams see, ai/squad.js knownHostiles; where), his own
 *    strength (men standing, the wounded, the ammunition left) and the friendly teams' with him
 *    (a.friends: their men standing, near and in the same fight), the fire coming in, and the ground: for each flank
 *    of the threat a covered route there (ai/squad.js route with the parkour links, steering clear of
 *    the cells the enemy sees: exposedTo) and how much of it the enemy can see.
 *  - choose(a): one of
 *      suppressFlank  one fire team fixes the enemy with suppressive fire (base of fire), the other
 *                     goes round by a covered route to the enemy's side, then assaults
 *      envelop        a weak enemy, men enough: both teams go round, one each side, then close in
 *      bound          bounding overwatch straight at it (no covered way round)
 *      defend         too weak to attack (men down, wounded to look after): hold in cover and fire
 *      withdraw       outmatched (or out of ammunition): break contact, one team covering the
 *                     other back to a rally point away from the threat
 *      retreat        ordered, or the leader's own call (the commander down, heavy casualties,
 *                     outgunned, flanked, pinned down, low on ammunition: ai/retreatRadio.js): the
 *                     word passed round, then man by man back to a rally point under covering
 *                     fire, the wounded carried or left to cover them, a wire on the last door
 *                     they pass (ai/retreat.js); called in to the friendly teams
 *  - It is called on the radio ("Alpha, team B base of fire, team A flank left with me"), the planned
 *    route is kept on the men for the paths view (m.planRoute), and it is looked at again every few
 *    seconds: a flank route that turns out exposed (the flankers being hit, the enemy moved to see
 *    it) is given up for another strategy; outmatched at any time, they withdraw.
 *  - Deterministic for a seed: the choices between equals come from the squad's own numbers
 *    (host.seed, else the call sign).
 */
import { badlyHit, roundsLeft, ARMS } from './soldier.js';
import { retreatWanted, startRetreat, stepRetreat } from './retreat.js';
import { friendliesOf } from './retreatRadio.js';
import { experienceOf, aggressionOf, moraleK } from './experience.js';

export const STRATEGIES = {
  suppressFlank: 'Suppress and flank',
  envelop: 'Envelopment (both flanks)',
  bound: 'Bounding assault (frontal)',
  defend: 'Hold and defend',
  withdraw: 'Break contact (withdraw)',
  retreat: 'Retreat (peel back, covering fire)',
};
const SIDE = { 1: 'left', [-1]: 'right' };
const d2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const cen = (l) => l.reduce((c, m) => [c[0] + m.p[0] / l.length, c[1] + m.p[1] / l.length, c[2] + m.p[2] / l.length], [0, 0, 0]);
const team = (m) => (m.squad === 'CMD' || m.squad === 'R1' ? 'A' : m.squad === 'UAV' ? 'U' : 'B');

/** The squad's own seeded numbers (mulberry32 on host.seed or the call sign). */
export function srand(sq) {
  if (!sq.sRng) {
    let a = (sq.host.seed ?? [...String(sq.unit)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)) >>> 0 || 1;
    sq.sRng = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  return sq.sRng();
}

/** Can the enemy at T see (and so shoot) the place p? (host.lineOfSight; memoised per cell for T) */
export function exposedTo(sq, T, p) {
  const H = sq.host;
  if (!H.lineOfSight) return false;
  const key = `${Math.round(T[0] * 2)},${Math.round(T[2] * 2)}`;
  if (sq.expoKey !== key) {
    sq.expoKey = key;
    sq.expo = new Map();
  }
  const k = sq.cellOf ? sq.cellOf(p[0], p[2]) : -1;
  if (k >= 0 && sq.expo.has(k)) return sq.expo.get(k);
  const v = !!H.lineOfSight(T, p);
  if (k >= 0) sq.expo.set(k, v);
  return v;
}
/** The share (0..1) of a route the enemy at T sees, sampled every metre. */
export function exposure(sq, T, from, pts) {
  let n = 0, seen = 0, prev = from;
  for (const q of pts) {
    const L = d2(prev, q);
    for (let s = 0.5; s <= L; s += 1) {
      const p = [prev[0] + ((q[0] - prev[0]) * s) / L, q[1], prev[2] + ((q[2] - prev[2]) * s) / L];
      // (the last stretch, at the flank: it sees the enemy, so the enemy it; that is the point of it)
      if (d2(p, T) < 7) continue;
      n++;
      if (exposedTo(sq, T, p)) seen++;
    }
    prev = q;
  }
  return n ? seen / n : 0;
}

/** Where the flank on `side` (1 left, -1 right, seen from the squad) is: beside the threat, a little forward of it. */
export function flankPoint(sq, T, from, side, off = 8) {
  const ax = T[0] - from[0], az = T[2] - from[2], l = Math.hypot(ax, az) || 1;
  const ux = ax / l, uz = az / l;
  // left of the way to it (facing it): (uz, -ux)·… the side's own sign
  const lx = uz * side, lz = -ux * side;
  const p = [T[0] + lx * off - ux * 2, T[1], T[2] + lz * off - uz * 2];
  const k = sq.nearestFree?.(p[0], p[2]);
  return k >= 0 ? sq.cellPos(k) : p;
}

/** The men standing in the friendly teams near (FRIENDS_R m) and in the fight (a threat of their own). */
const FRIENDS_R = 40;
function friendsWith(sq, al) {
  if (!al.length) return 0;
  const c = cen(al);
  let n = 0;
  for (const f of friendliesOf(sq)) {
    if (!f.threat) continue;
    const fm = f.members().filter((m) => !m.dead && m.squad !== 'UAV');
    if (fm.length && d2(cen(fm), c) < FRIENDS_R) n += fm.filter((m) => !badlyHit(m) && !m.crawling && !m.down).length;
  }
  return n;
}

/** What the leader weighs (see the top). */
export function assess(sq) {
  const T = sq.threat;
  const al = sq.members().filter((m) => !m.dead && m.squad !== 'UAV');
  const fit = al.filter((m) => !badlyHit(m) && !m.crawling && !m.down);
  // (every hostile they know of: seen now, seen lately, seen by the friendly teams near them)
  const known = sq.knownHostiles?.() ?? sq.seen ?? [];
  const enemies = Math.max(known.length, sq.seen?.length ?? 0, T ? 1 : 0);
  const full = al.reduce((a, m) => a + ARMS[m.primary ?? 'rifle'].size * (ARMS[m.primary ?? 'rifle'].mags + 1), 0) || 1;
  const ammo = al.reduce((a, m) => a + roundsLeft(m), 0) / full;
  const now = sq.host.now?.() ?? sq.time;
  const hits = al.filter((m) => m.lastHitT != null && now - m.lastHitT < 6).length;
  const down = sq.members().filter((m) => m.dead || m.down || badlyHit(m)).length;
  // (fixed: they have it in sight and are engaging it; a reported point no one sees is not to be flanked)
  const a = { T, men: al.length, fit: fit.length, enemies, friends: friendsWith(sq, al), ammo, hits, down, fixed: (sq.seen?.length ?? 0) > 0, flanks: {} };
  if (!T || !al.length || !sq.route) return a;
  const c = cen(al);
  const A = al.filter((m) => team(m) === 'A' && !badlyHit(m));
  const from = A.length ? cen(A) : c;
  for (const side of [1, -1]) {
    const to = flankPoint(sq, T, c, side);
    const pts = sq.route(from, to, A[0], { avoid: T, links: true });
    const L = pts.reduce((s, p, i) => s + d2(p, i ? pts[i - 1] : from), 0);
    const ok = pts.length && d2(pts[pts.length - 1], to) < 1.5 && L < 60 && d2(to, T) > 4;
    a.flanks[side] = { to, pts, L, expo: ok ? exposure(sq, T, from, pts) : 1, ok };
  }
  return a;
}

/** The strategy for what the leader sees: { kind, side?, why }. */
export function choose(sq, a, not = null) {
  const can = (k) => k !== not;
  // the leader's experience and the team's temper (ai/experience.js; a regular, 0.5 and 0.5: as it always was):
  // morale, how far outmatched before they give ground; aggression, attack or hold; experience, how
  // exposed a way round he will still take (a recruit sees fewer, an old hand more)
  const lead = sq.members().find((m) => m.squad === 'CMD' && !m.dead) ?? sq.members().find((m) => !m.dead);
  const mk = moraleK(lead), agg = aggressionOf(lead), coverK = experienceOf(lead).cover;
  // ordered back, or too hurt to hold (ai/retreat.js)
  // (the friendly teams fighting beside them count for their strength: two teams against one, it is not the two that fall back)
  const r = can('retreat') ? retreatWanted(sq, a.friends ? { ...a, fit: a.fit + a.friends } : a) : null;
  if (r) return { kind: 'retreat', why: r.why };
  // (a man on his own fights where he is: a team down to one man standing breaks contact)
  const outmatched = a.enemies >= 2 * mk * Math.max(1, a.fit + (a.friends ?? 0)) || (a.fit <= 1 && a.men > 1) || a.ammo < 0.15;
  if (outmatched && can('withdraw')) return { kind: 'withdraw', why: a.ammo < 0.15 ? 'low on ammunition' : 'outnumbered' };
  if ((a.fit < 3 || a.down >= 2) && a.enemies >= a.fit - 1 && !(agg > 0.75 && a.fit >= 2) && can('defend')) return { kind: 'defend', why: 'men down' };
  if (agg < 0.25 && a.enemies >= a.fit && can('defend')) return { kind: 'defend', why: 'a cautious leader, as many against them' };
  const good = a.fixed === false ? [] : [1, -1].filter((s) => a.flanks[s]?.ok && a.flanks[s].expo < coverK);
  // between two equally good flanks: the less exposed, ties by the squad's own numbers
  good.sort((x, y) => a.flanks[x].expo - a.flanks[y].expo || a.flanks[x].L - a.flanks[y].L);
  if (good.length === 2 && Math.abs(a.flanks[1].expo - a.flanks[-1].expo) < 0.05 && Math.abs(a.flanks[1].L - a.flanks[-1].L) < 3 && srand(sq) < 0.5) good.reverse();
  if (a.enemies <= 1 && a.fit >= 4 && good.length === 2 && can('envelop')) return { kind: 'envelop', why: 'a weak enemy, both flanks covered' };
  if (good.length && a.fit >= 3 && can('suppressFlank')) return { kind: 'suppressFlank', side: good[0], why: 'a covered way round' };
  if (can('bound')) return { kind: 'bound', why: 'no covered way round' };
  return { kind: 'defend', why: 'nothing better' };
}

const CALL = {
  suppressFlank: (U, s) => `${U}, team B base of fire, suppress; team A, flank ${SIDE[s.side]} with me, move`,
  envelop: (U) => `${U}, envelop, team A left, team B right, move`,
  bound: (U) => `${U}, bounding overwatch, team A move`,
  defend: (U) => `${U}, hold here, take cover and defend`,
  withdraw: (U, s) => `${U}, break contact, ${s.why}, fall back, team B cover`,
  retreat: (U, s) => `${U}, ${s.why === 'ordered' ? 'we are pulling out' : s.why}, retreat, peel back to the rally point, covering fire`,
};

/** Put strategy s in hand: the call, the routes, the teams' parts. */
export function apply(sq, s, a, quiet = false) {
  const T = sq.threat;
  const al = sq.members().filter((m) => !m.dead && m.squad !== 'UAV');
  const cmd = sq.radioMan();
  const prev = sq.strategy;
  sq.strategy = { ...s, t: sq.time, phase: 'move', a };
  sq.strategies = (sq.strategies ?? []).concat(s.kind);
  for (const m of al) m.planRoute = null;
  if (cmd && !quiet) sq.say(cmd, (prev ? `${sq.unit}, change of plan: ` : '') + CALL[s.kind](sq.unit, s), 'order');
  sq.status = `Strategy: ${STRATEGIES[s.kind]} (${s.why}).`;
  if (s.kind === 'bound') {
    if (sq.phase === 'strategy') sq.phase = 'bound';
    sq.assigned = false;
    return;
  }
  sq.phase = 'strategy';
  sq.retreating = false;
  if (s.kind === 'retreat') return startRetreat(sq, sq.strategy);
  const go = (men, to, mode, then) =>
    men.forEach((m, i) => {
      if (m.goingFor || badlyHit(m) || m.crawling || m.down || m.rescueRole) return;
      const q = [to[0] + (i - (men.length - 1) / 2) * 1.3, to[1], to[2] + ((i % 2) - 0.5) * 1.1];
      const pts = sq.route(m.p, q, m, { avoid: T, links: true });
      m.planRoute = [m.p.slice(), ...pts];
      m.coverCell = -1;
      m.cover = q;
      sq.follow(m, pts, mode, then);
    });
  const A = al.filter((m) => team(m) === 'A'), B = al.filter((m) => team(m) === 'B');
  if (s.kind === 'suppressFlank') {
    sq.moving = 'A';
    for (const m of B) m.path = null; // (the base of fire stays put, and fires)
    go(A, a.flanks[s.side].to, 'run', (m) => (m.arrived = true));
  } else if (s.kind === 'envelop') {
    sq.moving = 'AB';
    go(A, a.flanks[1].to, 'run', (m) => (m.arrived = true));
    go(B, a.flanks[-1].to, 'run', (m) => (m.arrived = true));
  } else if (s.kind === 'defend') {
    sq.moving = null;
    for (const m of al) {
      // the nearest cover (out of its sight) within a few metres, else where he is, down low
      let best = null, bd = 7;
      for (const c of sq.covers ?? []) {
        const d = d2(c.p, m.p);
        if (d < bd && !exposedTo(sq, T, c.p)) (bd = d), (best = c);
      }
      if (best && !badlyHit(m)) {
        m.coverCell = best.k;
        m.cover = best.p.slice();
        sq.follow(m, sq.route(m.p, best.p, m), 'run', (q) => (q.arrived = true));
      }
    }
  } else if (s.kind === 'withdraw') {
    // a rally point back the way they came, out of its sight if there is one
    const c = cen(al), dx = c[0] - T[0], dz = c[2] - T[2], l = Math.hypot(dx, dz) || 1;
    let R = null;
    for (const back of [22, 16, 28, 12]) {
      for (const sw of [0, 4, -4, 8, -8]) {
        const [bx0, bz0, bx1, bz1] = sq.host.bounds ?? [-1e9, -1e9, 1e9, 1e9];
        const cl = (v, a, b) => Math.max(a + 1, Math.min(b - 1, v));
        const p = [cl(c[0] + (dx / l) * back + (-dz / l) * sw, bx0, bx1), c[1], cl(c[2] + (dz / l) * back + (dx / l) * sw, bz0, bz1)];
        const k = sq.nearestFree?.(p[0], p[2]);
        const q = k >= 0 ? sq.cellPos(k) : p;
        if (!R) R = q;
        if (!exposedTo(sq, T, q)) {
          R = q;
          break;
        }
      }
      if (R && !exposedTo(sq, T, R)) break;
    }
    sq.strategy.rally = R;
    sq.moving = 'A';
    for (const m of B) m.path = null;
    go(A, R, 'run', (m) => (m.arrived = true));
  }
}

/**
 * Each step after contact: decide (once in contact), carry the strategy through its phases, look
 * at it again every few seconds. Returns true while the strategy has the squad (no bounds).
 */
export function stepStrategy(sq, dt) {
  if (!sq.threat || !sq.contacted || sq.pursuit || sq.breach || sq.clearing) return false;
  const T = sq.threat;
  const al = sq.members().filter((m) => !m.dead && m.squad !== 'UAV');
  // (one man on his own: no teams to give parts to, he fights where he is)
  if (al.length < 2) return false;
  // (far off, or moving up in formation: not yet engaged; a team sent round a flank by the lead
  // squad follows that order instead: ai/squad.js command, sq.goal) — unless they already know they
  // are outnumbered two to one (the friendly teams with them counted): the leader weighs it now
  const outnumbered = () => (sq.knownHostiles?.().length ?? 0) >= 2 * Math.max(1, al.length + friendsWith(sq, al));
  if (!sq.strategy && (sq.phase === 'formation' || d2(cen(al), T) > 32) && !outnumbered()) return false;
  sq.stratT = (sq.stratT ?? 0) - dt;
  const S = sq.strategy;
  if (!S) {
    sq.stratT = 4;
    const a = assess(sq);
    apply(sq, choose(sq, a), a);
    return sq.phase === 'strategy';
  }
  // (a retreat once begun is seen through: ai/retreat.js has it)
  if (S.kind === 'retreat') S.dirty = false;
  if (S.dirty && sq.stratT <= 0) {
    // the threat moved: the same plan if it still fits (new routes to the new flank), else another
    S.dirty = false;
    sq.stratT = 4;
    const a = assess(sq);
    const s = choose(sq, a);
    if (s.kind !== S.kind || S.phase === 'move') apply(sq, s, a, s.kind === S.kind && s.side === S.side);
    return sq.phase === 'strategy';
  }
  const A = al.filter((m) => team(m) === 'A'), B = al.filter((m) => team(m) === 'B');
  const now = sq.host.now?.() ?? sq.time;
  // look at it again: outmatched now, or a flank going wrong (the flankers hit, their way seen)
  if (sq.stratT <= 0 && S.kind !== 'retreat') {
    sq.stratT = 4;
    const a = assess(sq);
    const want = choose(sq, a);
    const flankers = S.kind === 'envelop' ? al : A;
    const hitMoving = S.phase === 'move' && flankers.some((m) => m.path && m.lastHitT != null && now - m.lastHitT < 4);
    const seenWay = S.phase === 'move' && (S.kind === 'suppressFlank' || S.kind === 'envelop') && flankers.some((m) => m.path && exposure(sq, T, m.p, m.path.slice(m.pathI ?? 0)) > 0.6);
    if ((want.kind === 'withdraw' || want.kind === 'retreat') && S.kind !== want.kind) apply(sq, want, a);
    else if (hitMoving || seenWay) {
      const alt = choose(sq, a, S.kind);
      sq.say(sq.radioMan() ?? al[0], `${sq.unit}, the flank is exposed, pulling back`, 'order');
      apply(sq, alt, a);
    } else if (want.kind !== S.kind && sq.time - S.t > 12 && S.phase === 'move' && S.kind !== 'withdraw') apply(sq, want, a);
  }
  const P = sq.strategy;
  if (P.kind === 'bound') return false;
  if (P.kind === 'suppressFlank' || P.kind === 'envelop') {
    const movers = P.kind === 'envelop' ? al : A;
    if (P.phase === 'move' && (movers.every((m) => m.arrived && !m.path) || sq.time - P.t > 50)) {
      // in position: the assault (the base of fire shifts its fire, the flankers go in)
      P.phase = 'assault';
      P.at = sq.time;
      const who = movers.find((m) => m.squad === 'CMD') ?? movers[0];
      sq.say(who, P.kind === 'envelop' ? `${sq.unit}, both teams in position, assault, assault` : `${sq.unit}, team A in position, assaulting, base of fire shift fire`, 'order');
      for (const m of movers) {
        m.planRoute = null;
        const to = [T[0] + (m.p[0] - T[0]) * 0.25, T[1], T[2] + (m.p[2] - T[2]) * 0.25];
        sq.follow(m, sq.route(m.p, to, m, { links: true }), 'run', (q) => (q.arrived = true));
      }
    } else if (P.phase === 'assault' && (al.some((m) => d2(m.p, T) < 4.5) || sq.time - P.at > 25)) {
      P.phase = 'done';
      sq.phase = 'hold';
      sq.say(sq.radioMan() ?? al[0], `${sq.unit}, objective taken, consolidate`, 'order');
    }
    return P.phase !== 'done';
  }
  if (P.kind === 'retreat') return stepRetreat(sq, dt);
  if (P.kind === 'withdraw') {
    if (P.phase === 'move' && A.every((m) => m.arrived && !m.path)) {
      // team A is back and covering: team B goes
      P.phase = 'second';
      sq.moving = 'B';
      sq.say(B[0] ?? al[0], `${sq.unit}, team B moving back`, 'order');
      B.forEach((m, i) => {
        if (badlyHit(m)) return;
        const q = [P.rally[0] + i * 1.3, P.rally[1], P.rally[2] - 1.2];
        const pts = sq.route(m.p, q, m, { avoid: T, links: true });
        m.planRoute = [m.p.slice(), ...pts];
        sq.follow(m, pts, 'run', (q2) => (q2.arrived = true));
      });
    } else if (P.phase === 'second' && B.every((m) => (m.arrived && !m.path) || badlyHit(m))) {
      P.phase = 'done';
      sq.phase = 'hold';
      sq.say(sq.radioMan() ?? al[0], `${sq.unit}, contact broken, at the rally point`, 'order');
    }
    return P.phase !== 'done';
  }
  // defend: hold in cover and fire
  return true;
}

/** The threat moved (or the plan has to be made again): looked at again at once. */
export function rethink(sq) {
  if (sq.strategy) sq.strategy.dirty = true;
}
