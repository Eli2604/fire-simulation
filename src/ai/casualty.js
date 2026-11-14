/**
 * A man down, and getting him out (on top of ai/squad.js). Pure logic, no three.js.
 *
 *  - Down: a man badly hit (ai/soldier.js badlyHit: weak, or bleeding hard) goes down where he is,
 *    on his back, a hand pressed on the wound (m.down; clip 'woundedDown'); whoever sees it shouts
 *    "Man down!" (ai/soldier.js casualties calls him in on the radio).
 *  - The rescue: the leader (or the nearest buddy) decides on it when it is feasible: the fire not
 *    too heavy (no more than one of them hit in the last seconds, not more enemies seen than they
 *    have men standing), a safe spot near him (out of the enemy's sight: ai/strategy.js exposedTo),
 *    a man to fetch him and one to cover. Not feasible: they wait (a smoke grenade if the host has
 *    one: host.smoke), and look again every couple of seconds.
 *  - On the radio, in order: the rescuer "I'll get him, cover me!", the coverer "Covering!", the
 *    leader "Copy, get him out"; the rescuer "Got him!" when he has him, "He's safe" behind cover,
 *    and "back in the fight" after the first aid.
 *  - The coverer goes where he can see the enemy (if he cannot from where he is) and keeps up a
 *    stream of fire ('coverFire'). The rescuer runs to him (low, by the covered way, the parkour
 *    links too), takes him by the collar and drags him backwards to the safe spot at a slow walk
 *    ('dragCasualty'; the casualty's body follows his hands: 'dragged', DRAG_OFF ahead of him),
 *    then kneels by him for the first aid ('firstAid': a tourniquet: the bleeding all but stops).
 *
 * State: sq.rescue { cas, rescuer, coverer, phase: call → go → drag → aid → done, safe, t }, the
 * men's m.down, m.rescueRole ('rescuer' | 'coverer' | 'casualty'), m.safe.
 */
import { badlyHit } from './soldier.js';
import { exposedTo } from './strategy.js';

/** How far the dragged man's root is ahead of the rescuer's (operator/rig.js DRAG_OFF). */
export const DRAG_OFF = 1.05;
const DRAG_SPEED = 0.8;
const AID_TIME = 4.5;
const NAME = { CMD: 'the commander', MG: 'the gunner', R1: 'rifleman one', R2: 'rifleman two', UAV: 'the drone operator' };
const d2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

/** A place near p the enemy at T cannot see, within r m (the nearest to p, a little nearer the team). */
export function safeSpot(sq, T, p, toward, r = 12) {
  if (!sq.walk) return null;
  let best = null, bs = Infinity;
  const cs = sq.cs;
  for (let dz = -r; dz <= r; dz += cs)
    for (let dx = -r; dx <= r; dx += cs) {
      const x = p[0] + dx, z = p[2] + dz, dd = Math.hypot(dx, dz);
      if (dd > r || dd < 1) continue;
      const k = sq.cellOf(x, z);
      if (k < 0 || !sq.walk[k] || Math.abs(sq.fy[k] - p[1]) > 0.6) continue;
      const q = sq.cellPos(k);
      // (a step or two off the wall: room for two men)
      if (sq.dObs && sq.dObs[k] < 1) continue;
      const sc = dd + 0.3 * (toward ? d2(q, toward) : 0) - (d2(q, T) > d2(p, T) ? 1.5 : 0);
      if (sc >= bs) continue;
      if (exposedTo(sq, T, q)) continue;
      bs = sc;
      best = q;
    }
  return best;
}
/** A place near m from which he sees the enemy at T (to cover from), or where he is if he already does. */
export function coverSpot(sq, T, m, r = 9) {
  const sees = (q) => sq.host.lineOfSight?.(q, T) ?? true;
  if (sees(m.p)) return m.p.slice();
  let best = null, bs = Infinity;
  for (let dz = -r; dz <= r; dz += sq.cs)
    for (let dx = -r; dx <= r; dx += sq.cs) {
      const dd = Math.hypot(dx, dz);
      if (dd > r) continue;
      const k = sq.cellOf(m.p[0] + dx, m.p[2] + dz);
      if (k < 0 || !sq.walk?.[k]) continue;
      const q = sq.cellPos(k);
      // (by something solid if he can: dObs small; he is not to stand in the open)
      const sc = dd + (sq.dObs?.[k] > 3 ? 3 : 0);
      if (sc >= bs || !sees(q)) continue;
      bs = sc;
      best = q;
    }
  return best;
}

/** Is a rescue feasible now? { ok, why, safe, rescuer, coverer }. */
export function feasible(sq, cas, al) {
  const T = sq.threat;
  const now = sq.host.now?.() ?? sq.time;
  const fit = al.filter((m) => m !== cas && !m.down && !badlyHit(m) && !m.crawling && m.squad !== 'UAV' && !m.rescueRole);
  const hits = al.filter((m) => m.lastHitT != null && now - m.lastHitT < 4 && m !== cas).length;
  const enemies = sq.seen?.length ?? 0;
  if (fit.length < 2) return { ok: false, why: 'no one to spare' };
  if (hits >= 2 || enemies > fit.length) return { ok: false, why: 'too much fire' };
  const c = fit.reduce((a, m) => [a[0] + m.p[0] / fit.length, a[1], a[2] + m.p[2] / fit.length], [0, cas.p[1], 0]);
  const safe = T ? safeSpot(sq, T, cas.p, c) : cas.p.slice();
  if (!safe) return { ok: false, why: 'no cover near him' };
  // the rescuer: the nearest (not the gunner if anyone else can); the coverer: the gunner, else the nearest other
  const byDist = fit.slice().sort((a, b) => d2(a.p, cas.p) - d2(b.p, cas.p));
  const rescuer = byDist.find((m) => m.squad !== 'MG') ?? byDist[0];
  const coverer = fit.find((m) => m.squad === 'MG' && m !== rescuer) ?? byDist.find((m) => m !== rescuer);
  return { ok: true, safe, rescuer, coverer };
}

/** Each step (ai/squad.js, in contact): men going down, the rescue under way. */
export function stepCasualties(sq, al, dt) {
  const T = sq.threat;
  // men going down
  for (const m of al) {
    if (m.down || m.dead || !badlyHit(m) || m.held) continue;
    m.down = true;
    m.downT = sq.time;
    m.path = null;
    m.trav = null;
    m.moving = false;
    m.rescueRole = 'casualty';
    sq.setAnim(m, 'woundedDown');
    const near = al.find((o) => o !== m && !o.down && d2(o.p, m.p) < 20);
    if (near) {
      near.signal = { text: 'MAN DOWN!', until: sq.time + 2 };
      sq.host.shout?.(near, 'Man down!');
    }
    if (sq.strategy) sq.strategy.dirty = true;
  }
  for (const m of al) if (m.down && (m.rescueRole === 'casualty' || m.safe) && sq.rescue?.cas !== m) sq.setAnim(m, 'woundedDown');
  let R = sq.rescue;
  if (R && (R.cas.dead || R.rescuer.dead || R.rescuer.down)) {
    // gone wrong: the rescuer is hit too, or too late
    end(sq, R, false);
    R = null;
  }
  if (!R) {
    const cas = al.find((m) => m.down && !m.safe && !m.dead);
    if (!cas || !T) return;
    sq.rescueT = (sq.rescueT ?? 0) - dt;
    if (sq.rescueT > 0) return;
    sq.rescueT = 2;
    const f = feasible(sq, cas, al);
    if (!f.ok) {
      if (sq.rescueWhy !== f.why) {
        sq.rescueWhy = f.why;
        const lead = sq.radioMan();
        if (lead && f.why === 'too much fire') {
          sq.say(lead, `${sq.unit}, ${NAME[cas.squad] ?? 'he'} is down, too much fire to get to him, hold, keep their heads down`, 'order');
          if (sq.host.smoke) {
            sq.host.smoke(lead, cas.p);
            sq.say(lead, `${sq.unit}, smoke out`, 'order');
          }
        }
      }
      sq.rescueDeferred = (sq.rescueDeferred ?? 0) + 1;
      return;
    }
    sq.rescueWhy = null;
    R = sq.rescue = { cas, rescuer: f.rescuer, coverer: f.coverer, safe: f.safe, phase: 'call', t: 0 };
    for (const [m, role] of [[R.rescuer, 'rescuer'], [R.coverer, 'coverer']]) {
      m.rescueRole = role;
      m.path = null;
      m.group = null;
    }
    sq.say(R.rescuer, `${sq.unit}, ${NAME[R.rescuer.squad]}, I'll get ${NAME[cas.squad] ?? 'him'}, cover me!`, 'casualty');
    sq.log?.push('rescue:call');
  }
  R.t += dt;
  const { cas, rescuer: r, coverer: c } = R;
  // the coverer: where he sees them, firing
  if (c && !c.dead && !c.down) {
    if (!R.coverSet) {
      R.coverSet = true;
      const q = coverSpot(sq, T, c);
      if (q && d2(q, c.p) > 0.4) {
        c.cover = q;
        sq.follow(c, sq.route(c.p, q, c), 'run', (m) => (m.arrived = true));
      }
    }
    if (!c.path) {
      sq.face(c, T, dt, 6);
      c.coverFire = true;
      if (!sq.busy(c)) sq.setAnim(c, c.crawling ? 'proneShoot' : 'coverFire');
      c.shotT = (c.shotT ?? 0) - dt;
      if (c.shotT <= 0) {
        c.shotT = 0.18;
        sq.host.fire?.(c, [T[0], (T[1] ?? 0) + 1, T[2]], 'rifle');
      }
    }
  }
  switch (R.phase) {
    case 'call':
      if (R.t > 1.6 && !R.covering && c) {
        R.covering = true;
        sq.say(c, `${sq.unit}, ${NAME[c.squad]}, covering!`, 'casualty');
      }
      if (R.t > 3.2) {
        const lead = sq.radioMan();
        if (lead && lead !== r && lead !== c) sq.say(lead, `${sq.unit}, copy, get him out`, 'order');
        R.phase = 'go';
        R.t = 0;
        // to him: low and fast, by the covered way
        const to = cas.p.slice();
        sq.follow(r, sq.route(r.p, to, r, { avoid: T, links: true }), 'run', (m) => (m.arrived = true));
        r.planRoute = [r.p.slice(), ...(r.path ?? [])];
      }
      break;
    case 'go':
      if ((!r.path && d2(r.p, cas.p) < 1.8) || R.t > 30) {
        R.phase = 'drag';
        R.t = 0;
        // the way back to the safe spot, from where he lies
        const pts = sq.route(cas.p, R.safe, cas, { avoid: T, links: false });
        R.way = [cas.p.slice(), ...pts];
        R.wi = 1;
        r.path = null;
        r.planRoute = R.way.slice();
        // at his head, facing him
        const h = Math.atan2(R.way[1][0] - R.way[0][0], R.way[1][2] - R.way[0][2]); // the way to go
        r.yaw = h + Math.PI;
        r.p = [cas.p[0] + Math.sin(h) * DRAG_OFF, cas.p[1], cas.p[2] + Math.cos(h) * DRAG_OFF];
        cas.yaw = r.yaw;
        r.anim = 'dragCasualty';
        cas.anim = 'dragged';
        sq.say(r, `${sq.unit}, got him!`, 'casualty');
      }
      break;
    case 'drag': {
      // backwards along the way, he follows in the rescuer's hands
      const q = R.way[Math.min(R.wi, R.way.length - 1)];
      // (the rescuer walks the way the casualty's root has to go, ahead of it by DRAG_OFF)
      const head = [q[0], q[1], q[2]];
      const dx = head[0] - cas.p[0], dz = head[2] - cas.p[2], l = Math.hypot(dx, dz);
      if (l < 0.25) {
        R.wi++;
        if (R.wi >= R.way.length) {
          R.phase = 'aid';
          R.t = 0;
          r.moving = false;
          cas.moving = false;
          cas.safe = true;
          sq.setAnim(cas, 'woundedDown');
          sq.say(r, `${sq.unit}, he's safe, behind cover`, 'casualty');
          // kneel at his side for the first aid
          const side = [Math.cos(cas.yaw ?? 0), -Math.sin(cas.yaw ?? 0)];
          r.p = [cas.p[0] + side[0] * 0.7, r.p[1], cas.p[2] + side[1] * 0.7];
          r.yaw = Math.atan2(cas.p[0] - r.p[0], cas.p[2] - r.p[2]);
          sq.setAnim(r, 'firstAid', AID_TIME);
        }
        break;
      }
      const s = Math.min(l, DRAG_SPEED * dt);
      const ux = dx / l, uz = dz / l;
      cas.p = [cas.p[0] + ux * s, sq.host.floor(cas.p[0] + ux * s, cas.p[2] + uz * s, cas) ?? cas.p[1], cas.p[2] + uz * s];
      // the rescuer ahead of him on the way, facing him (walking backwards), his hands on the collar
      r.yaw = Math.atan2(-ux, -uz);
      cas.yaw = r.yaw;
      r.p = [cas.p[0] + ux * DRAG_OFF, cas.p[1], cas.p[2] + uz * DRAG_OFF];
      r.moving = cas.moving = true;
      r.speed = DRAG_SPEED;
      r.anim = 'dragCasualty';
      cas.anim = 'dragged';
      break;
    }
    case 'aid':
      cas.bleed = Math.min(cas.bleed ?? 0, 0.3); // (the tourniquet)
      if (R.t > AID_TIME) {
        cas.treated = true;
        sq.say(r, `${sq.unit}, ${NAME[r.squad]}, he's patched up, back in the fight`, 'casualty');
        end(sq, R, true);
      }
      break;
  }
}

/** The rescue over (done, or gone wrong): everyone back to the fight. */
function end(sq, R, done) {
  R.phase = done ? 'done' : 'failed';
  sq.rescues = (sq.rescues ?? []).concat(R);
  for (const m of [R.rescuer, R.coverer]) {
    if (!m) continue;
    m.rescueRole = null;
    m.coverFire = false;
    m.planRoute = null;
    m.arrived = true;
    m.path = null;
  }
  if (!done && !R.cas.dead) R.cas.rescueRole = 'casualty';
  sq.rescue = null;
  sq.assigned = false;
}
