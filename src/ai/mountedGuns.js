/**
 * Machine guns mounted on cars and boats (the car's or the boat's `mountedGun` param: 'mg' a
 * 7.62 mm, 'hmg' a 12.7 mm, on a pintle on the roof of a jeep or a truck, in the bow of a boat),
 * fired by the man in the gunner's seat (a car's rear right seat, or c.gunSeat; a boat's
 * passenger nearest the bow) when the vehicle has a side (ai/vehicleSides.js): at hostile
 * helicopters first (one shooting at them before anything), then hostile cars and boats, that he
 * has made out (a moment, longer the further: sooner what is shooting at them) and can see.
 * Bursts with the lead and the drop worked out (ai/heliArms.js aimSolution), real rounds
 * (sim/ordnance.js: a helicopter's parts, a car's, a boat's planking).
 *
 *   mountOf(v)                 { type, spec } or null
 *   gunPos(v)                  where its muzzle is (world)
 *   gunnerOf(v)                who mans it (alive, not down), or null
 *   stepMountedGuns(ctx, dt)   each step (ai/battle.js stepBattle)
 */
import { ROUNDS, aimSolution, contactState } from './heliArms.js';
import { hostile } from './sides.js';
import { vehicleKind, vehicleSide, vehiclePose, vehicleDead, vehicleContacts } from './vehicleSides.js';
import { launch } from '../sim/ordnance.js';
import { carToWorld } from '../sim/carPhysics.js';
import { toWorld as hullToWorld } from '../sim/buoyancy.js';
import { seatWorld } from '../sim/boats.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** The mounted guns: their rounds (ROUNDS), bursts, ammunition. */
export const MOUNTS = {
  mg: { round: 'mg', burst: 10, pause: 0.8, ammo: 800, range: 900, label: '7.62 mm on a pintle' },
  hmg: { round: 'hmg', burst: 7, pause: 0.9, ammo: 400, range: 1500, label: '12.7 mm on a pintle' },
};

export function mountOf(v) {
  const t = v?.mountedGun ?? v?.params?.mountedGun;
  if (!t || t === 'none' || !MOUNTS[t]) return null;
  return { type: t, spec: MOUNTS[t], round: ROUNDS[MOUNTS[t].round] };
}

/** Its muzzle (world): over a car's roof, aft of its middle; in a boat's bow. */
export function gunPos(v) {
  if (vehicleKind(v) === 'car') return carToWorld(v, [-0.2 * v.spec.L, v.spec.H + 0.35, 0]);
  const b = v.body;
  const x = b.hull.x1 - 0.7;
  return hullToWorld(b, [x, b.hull.sheer(x) + 0.45, 0]);
}

/** Who mans it: a car's gunner's seat (c.gunSeat, else its last), a boat's passenger nearest the bow. */
export function gunnerOf(v) {
  const able = (m) => m && !m.dead && !m.down && !m.player;
  if (vehicleKind(v) === 'car') {
    const s = v.seats[v.gunSeat ?? v.seats.length - 1];
    if (able(s?.who)) return s.who;
    // (anyone but the driver moves up to it)
    return v.seats.find((q) => !q.drive && able(q.who))?.who ?? null;
  }
  const seats = (v.seats ?? []).map((s, k) => ({ s, k })).filter(({ s }) => able(s.who) && !(s.drive || s.role === 'rower' || s.role === 'helm' || s.role === 'paddler'));
  if (!seats.length) return null;
  seats.sort((a, b) => b.s.x - a.s.x);
  return seats[0].s.who;
}

/** What a gun on side `side` at `from` could fire at: hostile helicopters (not wrecked) and vehicles. */
function targetsFor(ctx, v, side) {
  const w = ctx.world;
  const out = [];
  for (const s of w.helis ?? []) {
    const h = s.ai ?? s;
    if (!h?.toWorld || h.crashed || !hostile(side, h.side)) continue;
    out.push({ key: h, ref: h, kind: 'heli', side: h.side, p: h.p, at: h.toWorld([0, 1.4, 0]) });
  }
  for (const c of vehicleContacts(w)) if (c.ref !== v && hostile(side, c.side)) out.push(c);
  return out;
}

/** Each step: every manned gun of a side looks, picks, fires. */
export function stepMountedGuns(ctx, dt) {
  const w = ctx.world;
  const now = w.time ?? 0;
  for (const v of [...(w.cars ?? []), ...(w.floats ?? [])]) {
    const M = mountOf(v);
    if (!M) continue;
    const G = (v.gun ??= { type: M.type, ammo: M.spec.ammo, cd: 0, burst: 0, pauseT: 0, seen: new Map(), target: null, flash: -1, dir: null, n: 0 });
    G.cd -= dt;
    G.pauseT -= dt;
    const man = gunnerOf(v);
    if (G.man && G.man !== man) G.man.vehFiring = false;
    G.man = man;
    if (!man || vehicleDead(v) || G.ammo <= 0) {
      G.target = null;
      continue;
    }
    const side = vehicleSide(v);
    if (!side) continue;
    const from = gunPos(v);
    const P = vehiclePose(v);
    // what he makes out (a moment, longer the further; at once what is shooting at them)
    let best = null, bs = 0;
    for (const c of targetsFor(ctx, v, side)) {
      const st = contactState(c);
      const d = len(sub(st.p, from));
      if (d > M.spec.range) continue;
      const sees = !ctx.sees || ctx.sees(from, st.p);
      const k = c.key ?? c.ref;
      const shooting = (v.hitBy && (v.hitBy === c.ref)) && now - (v.lastHitT ?? -99) < 10;
      let a = G.seen.get(k) ?? 0;
      a = sees ? Math.min(1.5, a + (shooting ? 5 : 1.6 / (1 + d / 400)) * dt) : Math.max(0, a - dt * 0.3);
      G.seen.set(k, a);
      if (a < 1 || !sees) continue;
      const sc = (c.kind === 'heli' ? 3 : 1) * (shooting ? 3 : 1) * (G.target?.ref === c.ref ? 1.4 : 1) / (1 + d / 500);
      if (sc > bs) {
        bs = sc;
        best = c;
      }
    }
    G.target = best;
    if (!best) {
      man.vehFiring = false;
      continue;
    }
    const st = contactState(best);
    const sol = aimSolution(from, P.vel, M.round, st.p, st.v);
    G.dir = sol.dir;
    man.vehFiring = true;
    man.anim = G.flash > now - 0.15 ? 'sitShoot' : 'sitAim';
    man.yaw = Math.atan2(sol.dir[0], sol.dir[2]);
    if (G.pauseT > 0) continue;
    while (G.cd <= 0 && G.ammo > 0) {
      G.cd += 1 / M.round.rate;
      G.ammo--;
      G.n++;
      // the gunner's spread (a bouncing car, a boat on the waves: more)
      const moving = Math.hypot(P.vel[0], P.vel[2]);
      const sp = (M.round.spread ?? 0.005) * (2.4 + moving * 0.1) * (man.skill === 'veteran' || man.skill === 'elite' ? 0.8 : man.skill === 'recruit' ? 1.6 : 1);
      const d = norm([sol.dir[0] + (ctx.rand() - 0.5) * 2 * sp, sol.dir[1] + (ctx.rand() - 0.5) * 2 * sp, sol.dir[2] + (ctx.rand() - 0.5) * 2 * sp]);
      launch(ctx, { type: 'round', spec: M.round, p: from, v: d.map((x, i) => x * M.round.v0 + P.vel[i]), owner: v, shooter: v, side, tracer: G.n % 3 === 0 });
      G.flash = now;
      G.burst++;
      if (G.burst >= M.spec.burst) {
        G.burst = 0;
        G.pauseT = M.spec.pause * (0.7 + ctx.rand() * 0.6);
        G.cd = Math.max(G.cd, 0);
        break;
      }
    }
    if (G.cd < -0.2) G.cd = -0.2;
    (w.events ??= []);
    if (G.n % 40 === 1) w.events.push({ type: 'mountedGunFire', pos: from, time: now, name: v.label ?? 'vehicle', at: best.kind });
  }
}

export { seatWorld };
