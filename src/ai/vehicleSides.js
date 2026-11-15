/**
 * Whose a car or a boat is (ai/sides.js for men and helicopters). Pure logic, no three.js.
 *
 *   vehicleOccupants(v)   the people in a car's seats (sim/cars.js c.seats[].who) or a boat's
 *                         (sim/boats.js f.seats[].who): soldiers, you ({ player: true })
 *   vehicleSide(v)        its side: a side set on it (the car's or the boat's `side` param: 'blue',
 *                         'red', 'green', 'neutral'; 'friendly' / 'enemy' as the helicopter's), else
 *                         the side of the men in it (the driver's first, else most of them), else
 *                         null: an empty vehicle nobody marked is no one's, and is not a target
 *   vehicleContacts(w)    the manned or marked cars and boats of a world as contacts for whoever
 *                         picks targets (ai/helicopter.js worldContacts): { key, ref, kind: 'car' |
 *                         'boat', side, p, at, speed, size, v }
 *   vehicleKind(v)        'car' | 'boat' | null
 */
import { sideOf, PLAYER_SIDE } from './sides.js';

const MARK = { friendly: 'blue', enemy: 'red' };

export function vehicleKind(v) {
  if (!v) return null;
  if (v.isCar || v.kind === 'car') return 'car';
  if (v.body?.hull || v.spec?.hull) return 'boat';
  return null;
}

export function vehicleOccupants(v) {
  return (v?.seats ?? []).map((s) => s.who).filter(Boolean);
}

/** The side of a man in a vehicle (you: { player: true } as the walk-through puts you in a seat). */
export const occupantSide = (m) => (m.player || m.isPlayer ? PLAYER_SIDE : sideOf(m));

export function vehicleSide(v) {
  if (!v) return null;
  const set = v.side ?? v.params?.side;
  if (set && set !== 'auto') return MARK[set] ?? set;
  const seats = v.seats ?? [];
  const alive = (m) => m && !m.dead;
  const drv = seats.find((s) => (s.drive || s.role === 'driver' || s.role === 'rower' || s.role === 'helm') && alive(s.who))?.who;
  if (drv) return occupantSide(drv);
  const men = vehicleOccupants(v).filter(alive);
  if (!men.length) return null;
  const n = new Map();
  for (const m of men) n.set(occupantSide(m), (n.get(occupantSide(m)) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** Where a car or a boat is: its middle, a point to aim at, its velocity. */
export function vehiclePose(v) {
  if (vehicleKind(v) === 'car') {
    const S = v.spec;
    // (look: a point on its roof (over its gun), to see it by: its middle is inside its own voxels)
    return { p: [v.x, v.y, v.z], at: [v.x, v.y + S.H * 0.55, v.z], look: [v.x, v.y + S.H + (v.params?.mountedGun && v.params.mountedGun !== 'none' ? 0.8 : 0.15), v.z], vel: [v.vx ?? 0, v.vy ?? 0, v.vz ?? 0], size: Math.max(S.L, S.H * 2) };
  }
  const b = v.body;
  if (!b) return null;
  const y = b.Y ?? 0;
  return { p: [b.X, y, b.Z], at: [b.X, y + 0.2, b.Z], look: [b.X, y + (b.hull?.D ?? 0.6) + 0.3, b.Z], vel: [b.vx ?? 0, b.vy ?? 0, b.vz ?? 0], size: b.hull?.L ?? 4 };
}

/** Out of the fight: a car burnt out or wrecked, a boat sunk. */
export function vehicleDead(v) {
  if (vehicleKind(v) === 'car') return !!(v.wrecked || v.armsWreck);
  return !!v.body?.sunk;
}

export function vehicleContacts(w) {
  const out = [];
  for (const v of [...(w.cars ?? []), ...(w.floats ?? [])]) {
    const kind = vehicleKind(v);
    if (!kind) continue;
    const side = vehicleSide(v);
    if (!side || vehicleDead(v)) continue;
    const P = vehiclePose(v);
    if (!P) continue;
    out.push({ key: v, ref: v, kind, side, p: P.p, at: P.look, aim: P.at, v: P.vel, speed: Math.hypot(P.vel[0], P.vel[2]), size: P.size, exposure: 1 });
  }
  return out;
}
