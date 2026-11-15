import { toWorld } from './buoyancy.js';
import { OARS, underPower } from './boats.js';

/**
 * The people in a boat (sim/boats.js), seated and posed: where each one's figure goes, which way
 * he faces, and what he is doing there, by his seat's role and what the boat is doing. Pure logic
 * (no three.js): the squad AI's men are put in their seats with it every step (placeCrew, from
 * sim/buoyancy.js stepFloats and ai/vehicles.js), and render/boatCrew.js draws the others with it
 * (you, when the camera is not at your eyes; the boat's `crew` param, ballast until now, as boatmen).
 *
 *   role       clip (operator/rig.js)    phase (0..1: the clip's time, set by the boat, not a clock)
 *   rower      boatRow                   the port oar's stroke (catch, drive 42 %, recovery; backing
 *                                        water: the stroke the other way round), in step with the oars
 *   helm       boatHelm                  his hand on the tiller / the outboard's handle: 0.5 amidships,
 *                                        → 0 / 1 over to his right / left (the tiller over with the helm)
 *   paddler    boatPaddle                the paddle's stroke: 0..0.5 on his left, 0.5..1 on his right
 *                                        (the bow paddler on the other side to the stern paddler's)
 *   crew       boatHike                  0.5 sitting up; → 0 / 1 hiked out over his right / left side
 *   passenger  boatSit / sitAim / sitShoot  sitting; up with his weapon at a threat; firing over the side
 *   floor      woundedDown (a man down) / boatSit
 *   anyone not at work (the oars shipped, nobody steering): boatSit; a man down: woundedDown.
 *
 * Seats (models/rowBoat.js seatsOf, the hull frame): the seat's top at (x, y, z); his feet (the
 * figure's origin) SIT_DROP under it, on the floorboards; the rower faces aft, the others forward.
 * A sailing crew's weight goes out over the windward side as they hike (sim/boats.js hikeCrew: the
 * loads move, so does the boat's centre of mass, and with it the heel): his figure goes with it.
 *
 *   seatPose(f, k)          → { role, anim, phase, seatYaw (in the boat: 0 to the bow, π aft), at
 *                             (hull frame: his feet), p (world: his feet), yaw (a figure's: three.js
 *                             yaw, looking along +z at 0), frame { f, u, r } (the boat's axes) }
 *   boatmen(f)              the `crew` param's people (loads without a who): [{ at (hull frame, his
 *                           seat's top), role }]
 *   crewOf(f)               everyone to draw: [{ who (null: a boatman), seat (index or -1), ...seatPose }]
 *   placeCrew(f)            the people in its seats (not you: walk/boatRow.js sits you) put there:
 *                           who.p, yaw, seatYaw, frame, anim, animPhase, boatSeated
 */

/** A seated figure's origin (his feet, on the floorboards) under the seat's top (m). */
export const SIT_DROP = 0.24;
const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);

/** The boat's axes in the world (its x: forward, y: up, z: starboard). */
export function boatFrame(f) {
  const R = f.body.pose?.R;
  if (!R) {
    const a = f.body.yaw ?? f.yaw ?? 0;
    return { f: [Math.cos(a), 0, -Math.sin(a)], u: [0, 1, 0], r: [Math.sin(a), 0, Math.cos(a)] };
  }
  return { f: [R[0], R[3], R[6]], u: [R[1], R[4], R[7]], r: [R[2], R[5], R[8]] };
}

/** An oar's stroke as the forward stroke's phase (backing water: the stroke the other way round). */
function strokePhase(ph, dir, D) {
  if (dir >= 0) return ph;
  return ph < D ? D + (ph / D) * (1 - D) : ((ph - D) / (1 - D)) * D;
}

/** What the man in seat s (hull frame) is doing: { anim, phase, seatYaw }. */
function work(f, s, who, k) {
  const R = f.row;
  const down = who && !who.dead && who.down;
  if (down) return { anim: 'woundedDown', phase: null, seatYaw: 0 };
  const role = s.role;
  const sail = f.kind === 'sail';
  if (role === 'rower' || ((role === 'helm' || s.drive) && R?.oars?.some((o) => o.out) && !underPower(f) && !sail)) {
    const o = R?.oars?.[0];
    const rowing = !!o && R.oars.some((q) => q.out) && (o.dir !== 0 || o.phase > 0);
    return rowing ? { anim: 'boatRow', phase: strokePhase(o.phase, o.dir, OARS.drive), seatYaw: Math.PI } : { anim: 'boatSit', phase: null, seatYaw: Math.PI };
  }
  if (role === 'paddler') {
    const P = R?.paddle;
    const stern = k === f.seats.findIndex((q) => q.role === 'paddler');
    if (!P || (P.dir === 0 && P.phase === 0)) return { anim: 'boatSit', phase: null, seatYaw: 0 };
    // (his left: the boat's port side, he facing forward; the bow paddler on the other side)
    const side = stern ? P.side : -P.side;
    return { anim: 'boatPaddle', phase: (side < 0 ? 0 : 0.5) + 0.5 * clamp(strokePhase(P.phase, P.dir, 0.5), 0, 0.999), seatYaw: 0 };
  }
  if (role === 'helm') {
    // the end of the tiller across him (his left +): an outboard's handle swings to port with the
    // tiller to starboard; a rudder's tiller the other way
    let x = 0;
    if (f.motor && !sail) x = 0.5 * Math.sin(0.6 * (f.motor.steer ?? 0));
    else if (sail || f.motor) x = -0.8 * Math.sin(0.5 * (R?.turn ?? 0));
    else return { anim: 'boatSit', phase: null, seatYaw: 0 };
    return { anim: 'boatHelm', phase: clamp(0.5 + x / 0.8, 0, 1), seatYaw: 0 };
  }
  if (role === 'crew' && sail) {
    const H = f.sailState?.hikeSide ?? 0;
    const h = f.sailState?.hike ?? 0;
    // (out over the port side: his left)
    return { anim: 'boatHike', phase: clamp(0.5 - 0.5 * h * H, 0, 1), seatYaw: 0 };
  }
  if (role === 'floor') return { anim: 'boatSit', phase: null, seatYaw: 0 };
  // a passenger: up with his weapon at a threat, firing over the side
  if (who?.vehFiring) return { anim: 'sitShoot', phase: null, seatYaw: 0 };
  if (who?.aimAt || who?.aiming) return { anim: 'sitAim', phase: null, seatYaw: 0 };
  return { anim: 'boatSit', phase: null, seatYaw: 0 };
}

/** Where his weight is now (a hiking crew out over the side): the seat's top, hull frame. */
function seatTop(f, s, who) {
  const L = who ? f.body.loads.find((q) => q.who === who) : null;
  // (the load is at the seat's top + 0.22: his centre of mass)
  return L ? [L.p[0], s.y, L.p[2]] : [s.x, s.y, s.z];
}

/** The pose of the one in seat k (or a seat-like { x, y, z, role }). See the top. */
export function seatPose(f, k, who = f.seats?.[k]?.who ?? null) {
  const s = typeof k === 'number' ? f.seats[k] : k;
  const b = f.body;
  const w = work(f, s, who, typeof k === 'number' ? k : -1);
  const top = seatTop(f, s, who);
  const hull = b.hull;
  // his feet on the floorboards (no lower than the keel's inside under him)
  const floor = hull.keel(top[0]) + 0.06;
  const at = [top[0], Math.max(floor, top[1] - SIT_DROP), top[2]];
  if (w.anim === 'woundedDown') at[1] = Math.max(floor, top[1] - 0.25);
  const p = toWorld(b, at);
  const yaw = (b.yaw ?? 0) + w.seatYaw + Math.PI / 2;
  return { role: s.role, anim: w.anim, phase: w.phase, seatYaw: w.seatYaw, at, p, yaw, frame: boatFrame(f), top };
}

/** The boat's `crew` param's people: its loads that are people nobody is (see the top). */
export function boatmen(f) {
  const out = [];
  for (const L of f.body?.loads ?? []) {
    if (L.label !== 'person' || L.who) continue;
    const floor = L.p[1] < 0.32;
    // (the seat's top under his centre of mass; on the floor, he sits on the floorboards)
    out.push({ at: [L.p[0], L.p[1] - (floor ? 0.08 : 0.22), L.p[2]], role: floor ? 'floor' : 'passenger', load: L });
  }
  return out;
}

/** Everyone in it to draw: those in its seats and its boatmen (one in a seat a man has taken is not there twice). */
export function crewOf(f) {
  if (!f.body || !f.seats) return [];
  const out = [];
  f.seats.forEach((s, k) => {
    if (s.who && !s.who.dead) out.push({ who: s.who, seat: k, ...seatPose(f, k) });
  });
  for (const m of boatmen(f)) {
    if (out.some((o) => Math.hypot(o.top[0] - m.at[0], o.top[2] - m.at[2]) < 0.3)) continue;
    const pose = seatPose(f, { x: m.at[0], y: m.at[1], z: m.at[2], role: m.role }, null);
    out.push({ who: null, seat: -1, ...pose });
  }
  return out;
}

/** The men in its seats (not you) where they sit, posed for what they do (see the top). */
export function placeCrew(f) {
  if (!f.body || !f.seats) return;
  f.seats.forEach((s, k) => {
    const m = s.who;
    if (!m || m.player) return;
    const P = seatPose(f, k, m);
    m.p = P.p;
    m.seatYaw = P.seatYaw;
    m.frame = P.frame;
    m.boatSeated = true;
    m.moving = false;
    m.speed = 0;
    // (aiming over the side the AI turns him to his target: e.aimYawWorld)
    m.yaw = P.yaw;
    if (m.dead) return;
    m.anim = P.anim;
    m.animPhase = P.phase;
  });
}

export const BOAT_CLIPS = ['boatRow', 'boatPaddle', 'boatHelm', 'boatHike', 'boatSit', 'sitAim', 'sitShoot'];
export { TAU };
