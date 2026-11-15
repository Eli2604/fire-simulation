/**
 * Vehicles for squads: one adapter over whatever can carry men (a helicopter, a rowing boat, a car,
 * anything with seats), so the squad AI (ai/squadVehicle.js: falling back to a vehicle, mounting up
 * to go to a team that called for help) asks every one of them the same questions. Pure logic, no
 * three.js.
 *
 *   findVehicles(sq)        the vehicles round a squad: the host's (host.vehicles(): raw objects or
 *                           adapters), else its world's (host.world or host.ropeSim.world: w.helis
 *                           (their .ai), w.floats (rowing boats), w.cars (sim/cars.js: driven for
 *                           real), w.vehicles of type 'car')
 *   vehicleOf(x)            the adapter for x (made once, kept): V
 *
 *   V.kind                  'helicopter' | 'boat' | 'car' | 'vehicle'
 *   V.p(), V.yaw()          where it is, its heading
 *   V.seats                 [{ i, role, label, at (its own frame), side (-1 left, 1 right, 0), drive,
 *                           shoot (a man there can fire out: a door gun, the door, an open boat),
 *                           crewed (the vehicle's own crew sits there: not for the squad) }]
 *   V.occupant(i), V.free() who sits there; the seats a squad man may take
 *   V.board(m, i), V.leave(m), V.holds(m)
 *   V.driver(), V.needsDriver()  who drives (its own pilot; else a man in its drive seat)
 *   V.usable(), V.stationary()   fit to go (not crashed, sunk or burning; a pilot); sitting still
 *   V.entry(i)              where a man gets in to seat i (beside it, on the ground)
 *   V.go(to), V.step(dt), V.arrived(), V.moving()   off it goes: its own pilot flies a helicopter
 *                           (a 'land' mission to `to`: it spins up, flies, lands); a car of the
 *                           world (sim/cars.js) is driven by the man at its wheel (ai/carDriver.js:
 *                           on the roads, round what is in the way, its dynamics sim/carPhysics.js);
 *                           a plain boat is rowed and a plain car driven here (kinematic: turn,
 *                           then on at its speed), unless the object has its own (rowTo / driveTo /
 *                           goTo) which is used instead
 *   V.place()               the men aboard put in their seats (a helicopter does that itself)
 *
 * Frames: a helicopter its own (ai/helicopter.js heliToWorld: x forward, z right). Everything else
 * the three.js way, as the boats (sim/buoyancy.js rot): x forward, rotated by yaw about y, so
 * forward is (cos yaw, -sin yaw) and the right side (sin yaw, cos yaw).
 *
 * A boat afloat in the world (w.floats: sim/boats.js, any kind: rowing boat, motor boat, sailing
 * dinghy, canoe) is its own: its seats (boardSeat / leaveSeat: their weight aboard), the man in
 * its drive seat (the rower, the helmsman, the stern paddler) takes it there by f.row.goal (rowed,
 * motored, sailed: tacking upwind), afloat by Archimedes as the world steps it (or the test).
 *
 * A boat whose model brings its own seats API (seats [{ at, role|drive, shoot }], board(m, i),
 * leave(m), rowTo(p)) plugs straight in: those are used rather than the thwarts worked out here.
 */
import { heliToWorld } from './helicopter.js';
import { framePose, toWorld as hullToWorld } from '../sim/buoyancy.js';
import { initBoat, boardSeat, leaveSeat, rower } from '../sim/boats.js';
import { placeCrew } from '../sim/boatCrew.js';
import { boardCar, leaveCar, carUsable, placeAboard } from '../sim/cars.js';
import { carToWorld, startEngine } from '../sim/carPhysics.js';
import { driveTo } from './carDriver.js';

const d2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const ADAPTER = new WeakMap();
/** Speeds (m/s) a vehicle is moved at here: rowed, driven. */
export const VEH_SPEED = { boat: 1.6, car: 9, vehicle: 4 };
const TURN = { boat: 0.5, car: 0.9, vehicle: 0.8 }; // rad/s

/** What kind of thing x is. */
export function kindOfVehicle(x) {
  if (!x) return null;
  if (x.kind && ['helicopter', 'boat', 'car', 'vehicle'].includes(x.kind) && x.isVehicleAdapter) return x.kind;
  if (x.crew && x.seats && typeof x.dismount === 'function') return 'helicopter';
  const k = String(x.vehicleKind ?? x.kind ?? x.type ?? x.model ?? '').toLowerCase();
  if (/heli/.test(k)) return 'helicopter';
  if (/boat|float|canoe|raft/.test(k) || x.spec?.hull) return 'boat';
  if (/car|truck|jeep|van/.test(k)) return 'car';
  return Array.isArray(x.seats) ? 'vehicle' : null;
}

/** The adapter for x (null if it is nothing that carries men). */
export function vehicleOf(x) {
  if (!x) return null;
  if (x.isVehicleAdapter) return x;
  if (ADAPTER.has(x)) return ADAPTER.get(x);
  const kind = kindOfVehicle(x);
  if (!kind) return null;
  const V = kind === 'helicopter' ? heliAdapter(x) : kind === 'car' && x.isCar ? carAdapter(x) : kind === 'boat' && x.spec?.hull && Array.isArray(x.seats) && typeof x.seats[0]?.x === 'number' ? floatAdapter(x) : plainAdapter(x, kind);
  ADAPTER.set(x, V);
  return V;
}

/** The vehicles a squad could use (see the top). */
export function findVehicles(sq) {
  const H = sq.host;
  const raw = H.vehicles?.() ?? worldVehicles(H.world ?? H.ropeSim?.world);
  return raw.map(vehicleOf).filter(Boolean);
}
/** A world's vehicles: its helicopters, its boats, its cars. */
export function worldVehicles(w) {
  if (!w) return [];
  return [...(w.helis ?? []).map((h) => h.ai ?? h), ...(w.floats ?? []), ...(w.cars ?? []), ...(w.vehicles ?? []).filter((v) => /car|truck|jeep/.test(String(v.type ?? v.kind ?? '')))];
}

/* ------------------------------------------------------------------ the helicopter */

function heliAdapter(h) {
  const seats = h.seats.map((s, i) => ({
    i, role: s.role, label: s.label, at: s.at, side: s.side ?? (s.role === 'pilot' ? 1 : s.role === 'copilot' ? -1 : 0),
    drive: s.role === 'pilot', crewed: s.role === 'pilot' || s.role === 'copilot',
    // the door gun; the front man on the bench by the open door fires his weapon out of it
    shoot: s.role === 'gunner' || (s.role === 'troop' && (s.row ?? 0) === 0),
  }));
  const V = {
    isVehicleAdapter: true, kind: 'helicopter', ref: h, id: h.id, seats, radius: 5, halfW: 1.5,
    speed: h.cruise,
    // (in the world its own crew's eyes and guns fire out of the doors at what they identify)
    selfArmed: !!h.host?.contacts,
    p: () => h.p,
    yaw: () => h.yaw,
    toWorld: (l) => heliToWorld(h, l),
    occupant: (i) => h.crew.find((e) => e.aboard === h.id && e.seat === i) ?? null,
    holds: (m) => m.aboard === h.id,
    usable: () => !h.crashed && !h.failure && !h.player && h.pilots().length > 0 && h.fire <= 0,
    stationary: () => h.landed && (h.mode === 'parked' || h.mode === 'shutdown'),
    driver: () => h.pilots()[0] ?? null,
    needsDriver: () => false,
    board(m, i) {
      if (!h.crew.includes(m)) h.crew.push(m);
      Object.assign(m, { aboard: h.id, seat: i, guardCtl: true, atDoor: false, aiming: false, path: null, moving: false });
      h.doorsWant = { L: 1, R: 1 };
      h.placeCrew();
      return true;
    },
    leave(m) {
      if (m.aboard === h.id) h.dismount(m);
      // (ai/helicopter.js release: the squad has him again)
      m.guardCtl = false;
      m.squadInit = undefined;
    },
    go(to) {
      h.lz = to.slice();
      h.mission = 'land';
      h.next = null;
      h.exit = [to[0] + (to[0] - h.p[0]) * 0.3, 0, to[2] + (to[2] - h.p[2]) * 0.3];
      h.doorsWant = { L: 0, R: 0 };
      h.setMode('spinUp');
      V.dest = to.slice();
      V.started = true;
    },
    step() {}, // (stepped by the world: HeliAI; a test steps it itself)
    moving: () => !!V.started && !V.arrived(),
    arrived: () => !!V.started && h.landed && (h.mode === 'landed' || h.mode === 'shutdown') && d2(h.p, V.dest) < 15,
    place: () => h.placeCrew(),
  };
  V.free = () => freeSeats(V);
  V.entry = (i) => entryOf(V, i);
  return V;
}

/* ------------------------------------------------------------------ boats, cars, anything with seats */

/** A rowing boat's seats: the rower amidships (he cannot shoot), two to every other thwart (they can: it is open). */
function boatSeats(x) {
  const P = x.params ?? {};
  const L = P.length ?? x.spec?.hull?.length ?? 4.3, B = P.beam ?? x.spec?.hull?.beam ?? 1.45;
  const n = Math.max(1, P.thwarts ?? 3);
  const xs = [];
  for (let k = 0; k < n; k++) xs.push(n === 1 ? 0 : -0.3 * L + (0.52 * L * k) / (n - 1));
  const mid = Math.floor((n - 1) / 2);
  const seats = [{ role: 'rower', label: 'Rower', at: [xs[mid], 0.1, 0], side: 0, drive: true, shoot: false }];
  xs.forEach((tx, k) => {
    if (k === mid && n > 1) return;
    for (const s of [-1, 1]) seats.push({ role: 'passenger', label: `Thwart ${k + 1} ${s < 0 ? 'port' : 'starboard'}`, at: [tx, 0.1, s * B * 0.25], side: s, drive: false, shoot: true });
  });
  // (a man on the floorboards in the stern sheets, when there is room: the wounded)
  seats.push({ role: 'floor', label: 'Stern sheets', at: [-0.4 * L, -0.15, 0], side: 0, drive: false, shoot: false });
  return seats;
}
/** The seats a man of the squad takes in a boat of sim/boats.js, as the adapter has them. */
const FLOAT_LABEL = { rower: 'Rower', helm: 'Helm', paddler: 'Paddler', crew: 'Crew', floor: 'Stern sheets' };

/** A boat of the world (sim/boats.js): its own seats, its own way of going (see the top). */
function floatAdapter(x) {
  const ready = () => {
    if (x.body && !x.row) initBoat(x);
    return !!x.body;
  };
  const drives = (s) => !!(s.drive || s.role === 'rower');
  const seats = x.seats.map((s, i) => ({
    i, role: s.role, label: s.role === 'passenger' ? `Thwart ${i} ${s.z < 0 ? 'port' : 'starboard'}` : FLOAT_LABEL[s.role] ?? `Seat ${i + 1}`,
    at: [s.x, s.y, s.z], side: Math.sign(s.z), drive: drives(s),
    // (an open boat: the passengers fire over the side; not whoever rows, steers, paddles or trims)
    shoot: s.role === 'passenger', crewed: false,
  }));
  const plainYaw = () => x.body?.yaw ?? x.yaw ?? 0;
  const V = {
    isVehicleAdapter: true, kind: 'boat', ref: x, id: x.id ?? x.label ?? 'boat', seats, radius: 2.8, halfW: (x.params?.beam ?? 1.45) / 2,
    speed: x.motor ? 4 : x.sail ? 2 : 1.4,
    p: () => x.body?.pose?.p ?? x.at ?? [0, 0, 0],
    yaw: plainYaw,
    toWorld(l) {
      if (x.body) return hullToWorld(x.body, l);
      const p = V.p(), a = plainYaw(), c = Math.cos(a), s = Math.sin(a);
      return [p[0] + l[0] * c + l[2] * s, p[1] + l[1], p[2] - l[0] * s + l[2] * c];
    },
    occupant: (i) => x.seats[i]?.who ?? null,
    holds: (m) => x.seats.some((s) => s.who === m),
    usable: () => !!x.body && !x.body.sunk && !x.body.swamped && !x.destroyed,
    stationary: () => !x.row?.goal && Math.hypot(x.body?.vx ?? 0, x.body?.vz ?? 0) < 0.5,
    driver: () => (x.row ? rower(x) : x.seats.find(drives)?.who ?? null),
    needsDriver: () => true,
    board(m, i) {
      if (!ready()) return false;
      const k = boardSeat(x, m, i);
      if (k < 0) return false;
      Object.assign(m, { aboard: V.id, seat: k, path: null, moving: false });
      V.place();
      return true;
    },
    leave(m) {
      if (x.row) leaveSeat(x, m);
      // out on the side of his seat (ashore, or into the water)
      const s = seats[m.seat] ?? seats[0];
      if (s) {
        const q = V.toWorld([s.at[0], 0, (s.side || 1) * (V.halfW + 0.9)]);
        m.p = [q[0], m.p[1], q[2]];
      }
      m.aboard = null;
      m.seat = null;
      m.frame = null;
      m.boatSeated = false;
      m.animPhase = null;
      m.squadInit = undefined;
    },
    go(to) {
      V.dest = to.slice();
      V.started = true;
      if (ready()) x.row.goal = { p: [to[0], to[2]], radius: 3 };
    },
    // (the boat itself is stepped by the world: sim/buoyancy.js stepFloats; its helmsman takes it to f.row.goal)
    step() {
      if (!V.dest) return;
      if (x.row && !x.row.goal) V.dest = null;
      V.place();
    },
    moving: () => !!V.dest,
    arrived: () => !!V.started && !V.dest,
    place() {
      if (!x.body) return;
      // (in his seat, his feet on the floorboards, posed for what he does there: rowing in step with
      // the oars, the tiller, hiking out, sitting, aiming or firing over the side: sim/boatCrew.js)
      if (!x.row) initBoat(x);
      placeCrew(x);
    },
  };
  V.free = () => freeSeats(V);
  V.entry = (i) => entryOf(V, i);
  return V;
}

/**
 * A car of the world (sim/cars.js: driven by the dynamics of sim/carPhysics.js): its own seats
 * (their weight in it), the man in its drive seat takes it there by ai/carDriver.js driveTo (on
 * the roads where there are any), the world steps it (sim/cars.js stepCars; a test steps it
 * itself: stepCarList). Closed: no one fires out of it.
 */
function carAdapter(c) {
  const seats = c.seats.map((s, i) => ({ i, role: s.role, label: s.label, at: s.at.slice(), side: Math.sign(s.at[2]) || 1, drive: !!s.drive, shoot: false, crewed: false }));
  const V = {
    isVehicleAdapter: true, kind: 'car', ref: c, id: c.id, seats, radius: Math.max(2.6, c.spec.L / 2 + 0.6), halfW: c.spec.W / 2,
    speed: c.cruise ?? VEH_SPEED.car,
    p: () => [c.x, c.y, c.z],
    yaw: () => c.yaw,
    toWorld: (l) => carToWorld(c, l),
    occupant: (i) => c.seats[i]?.who ?? null,
    holds: (m) => c.seats.some((s) => s.who === m),
    usable: () => carUsable(c) && !c.player,
    stationary: () => Math.hypot(c.vx, c.vz) < 0.5 && !(c.drive && !c.drive.done),
    driver: () => c.seats.find((s) => s.drive)?.who ?? null,
    needsDriver: () => true,
    board(m, i) {
      if (boardCar(c, m, i) < 0) return false;
      Object.assign(m, { aboard: V.id, seat: i, path: null, moving: false });
      V.place();
      return true;
    },
    leave(m) {
      leaveCar(c, m);
      // out of his door, on the ground beside it
      const s = seats[m.seat] ?? seats[0];
      if (s) {
        const q = V.toWorld([s.at[0], 0, s.side * (V.halfW + 0.9)]);
        m.p = [q[0], c.y, q[2]];
      }
      m.aboard = null;
      m.seat = null;
      m.frame = null;
      m.squadInit = undefined;
    },
    go(to) {
      V.dest = to.slice();
      V.started = true;
      startEngine(c);
      driveTo(c, to, { speed: V.speed, radius: 4 });
    },
    // (the car itself is stepped by the world: sim/cars.js; its driver takes it to c.drive.target)
    step() {
      if (!V.dest) return;
      if (!c.drive || (c.drive.done && Math.hypot(c.vx, c.vz) < 0.4)) V.dest = null;
      V.place();
    },
    moving: () => !!V.dest,
    arrived: () => !!V.started && !V.dest,
    place: () => placeAboard(c),
  };
  V.free = () => freeSeats(V);
  V.entry = (i) => entryOf(V, i);
  return V;
}

/** A car's seats: the driver front left, a passenger beside him, two in the back. Closed: no one shoots. */
function carSeats() {
  return [
    { role: 'driver', label: 'Driver', at: [0.2, 0.45, -0.4], side: -1, drive: true, shoot: false },
    { role: 'passenger', label: 'Front passenger', at: [0.2, 0.45, 0.4], side: 1, drive: false, shoot: false },
    { role: 'passenger', label: 'Rear left', at: [-0.75, 0.45, -0.4], side: -1, drive: false, shoot: false },
    { role: 'passenger', label: 'Rear right', at: [-0.75, 0.45, 0.4], side: 1, drive: false, shoot: false },
  ];
}

function plainAdapter(x, kind) {
  const own = Array.isArray(x.seats) && x.seats.length;
  const raw = own ? x.seats : kind === 'boat' ? boatSeats(x) : kind === 'car' ? carSeats(x) : [];
  const seats = raw.map((s, i) => ({
    i, role: s.role ?? (s.drive ? 'driver' : 'passenger'), label: s.label ?? `Seat ${i + 1}`, at: (s.at ?? s.p ?? [0, 0, 0]).slice(),
    side: s.side ?? Math.sign((s.at ?? s.p ?? [0, 0, 0])[2]), drive: !!(s.drive ?? /driver|rower|pilot|helm/.test(s.role ?? '')),
    shoot: s.shoot ?? (kind === 'boat' && !/rower|driver|floor/.test(s.role ?? '')), crewed: !!s.crewed,
  }));
  const occ = new Map(); // seat → man
  const body = () => x.body;
  const pose = () => (body()?.pose ? body().pose : null);
  const V = {
    isVehicleAdapter: true, kind, ref: x, id: x.id ?? x.label ?? kind, seats,
    radius: kind === 'car' ? 3 : kind === 'boat' ? 2.8 : 3, halfW: kind === 'car' ? 0.95 : kind === 'boat' ? 0.8 : 1,
    speed: x.speed ?? VEH_SPEED[kind] ?? 4,
    p: () => pose()?.p ?? x.p ?? x.base ?? x.at ?? [0, 0, 0],
    yaw: () => body()?.yaw ?? x.yaw ?? x.heading ?? 0,
    toWorld(l) {
      const p = V.p(), a = V.yaw(), c = Math.cos(a), s = Math.sin(a);
      return [p[0] + l[0] * c + l[2] * s, p[1] + l[1], p[2] - l[0] * s + l[2] * c];
    },
    occupant: (i) => (own && x.occupant ? x.occupant(i) : occ.get(i)) ?? null,
    holds: (m) => [...occ.values()].includes(m) || (own && typeof x.holds === 'function' && !!x.holds(m)),
    usable: () => !x.destroyed && !x.burning && !body()?.sunk && !body()?.swamped && (kind !== 'car' || (x.fuel ?? 1) > 0),
    stationary: () => !V.dest && !x.moving && Math.hypot(...(body()?.V ?? x.v ?? [0, 0, 0])) < 0.5,
    driver: () => (x.driver ?? null) || V.occupant(seats.findIndex((s) => s.drive)),
    needsDriver: () => !x.driver && seats.some((s) => s.drive),
    board(m, i) {
      if (own && typeof x.board === 'function' && x.board(m, i) === false) return false;
      occ.set(i, m);
      Object.assign(m, { aboard: V.id, seat: i, path: null, moving: false });
      V.place();
      return true;
    },
    leave(m) {
      if (own && typeof x.leave === 'function') x.leave(m);
      for (const [i, o] of occ) if (o === m) occ.delete(i);
      // out on the side of his seat, on the ground
      const s = seats[m.seat] ?? seats[0];
      if (s) {
        const q = V.toWorld([s.at[0], 0, (s.side || 1) * (V.halfW + 0.9)]);
        m.p = [q[0], m.p[1], q[2]];
      }
      m.aboard = null;
      m.seat = null;
      m.frame = null;
      m.squadInit = undefined;
    },
    go(to) {
      V.dest = to.slice();
      V.started = true;
      V.v = 0;
      const fn = x.rowTo ?? x.driveTo ?? x.goTo;
      V.native = typeof fn === 'function' ? (fn.call(x, to), true) : false;
    },
    step(dt) {
      if (!V.dest) return;
      if (V.native) {
        if (d2(V.p(), V.dest) < 3) V.dest = null;
        return V.place();
      }
      const p = V.p(), dx = V.dest[0] - p[0], dz = V.dest[2] - p[2], L = Math.hypot(dx, dz);
      if (L < 2.5) {
        V.dest = null;
        V.v = 0;
        x.moving = false;
        return V.place();
      }
      // turn onto it, then on at its speed (slower in a turn; easing off at the end)
      const want = Math.atan2(-dz, dx);
      let a = V.yaw(), e = ((want - a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
      const tr = (TURN[kind] ?? 0.8) * dt;
      a += Math.max(-tr, Math.min(tr, e));
      const vmax = V.speed * Math.max(0.15, Math.cos(Math.min(Math.abs(e), Math.PI / 2))) * Math.min(1, L / 6 + 0.2);
      V.v = Math.min(vmax, (V.v ?? 0) + V.speed * 0.6 * dt);
      const sx = Math.cos(a) * V.v * dt, sz = -Math.sin(a) * V.v * dt;
      const b = body();
      if (b) {
        b.X += sx;
        b.Z += sz;
        b.yaw = a;
        b.pose = framePose(b);
        if (x.at) x.at = [x.at[0] + sx, x.at[1], x.at[2] + sz];
      } else {
        const q = x.p ?? x.base ?? x.at;
        q[0] += sx;
        q[2] += sz;
        if ('heading' in x && !('yaw' in x)) x.heading = a;
        else x.yaw = a;
      }
      x.moving = true;
      V.place();
    },
    moving: () => !!V.dest,
    arrived: () => !!V.started && !V.dest,
    place() {
      const a = V.yaw();
      for (const [i, m] of occ) {
        const s = seats[i];
        m.p = V.toWorld(s.at);
        // (a man's yaw: his front (sin yaw, cos yaw)) forward, or out over his side when he can shoot
        m.yaw = s.shoot && s.side ? (s.side > 0 ? a : a + Math.PI) : a + Math.PI / 2;
        m.moving = false;
        m.speed = 0;
        if (!m.dead && !m.vehFiring) m.anim = m.down ? 'woundedDown' : s.shoot ? 'kneelAim' : 'deskSit';
      }
    },
  };
  V.free = () => freeSeats(V);
  V.entry = (i) => entryOf(V, i);
  return V;
}

/* ------------------------------------------------------------------ shared */

/** The seats a squad man may take: not the vehicle's own crew's, no one in them. */
export function freeSeats(V) {
  return V.seats.filter((s) => !s.crewed && !V.occupant(s.i));
}
/** Where a man gets in to seat i: beside it, a step off its side (the door, the gunwale). */
function entryOf(V, i) {
  const s = V.seats[i];
  const side = s.side || 1;
  return V.toWorld([s.at[0], 0, side * (V.halfW + 0.8)]).map((v, k) => (k === 1 ? V.p()[1] : v));
}
/**
 * Seats for men in order (casualties first; then the able men): a wounded man to a seat where he
 * need not do anything (no driving, no shooting if it can be helped); the first able men to the
 * seats they can fire from (to cover the rest as they get in), a driver to the drive seat if the
 * vehicle needs one, then the rest. Map man → seat index, or null if they will not all fit.
 */
export function assignSeats(V, men, isCas = (m) => !!m.down) {
  const free = freeSeats(V);
  if (free.length < men.length) return null;
  const left = new Set(free);
  const take = (pred) => {
    const s = [...left].find(pred);
    if (s) left.delete(s);
    return s ?? null;
  };
  const out = new Map();
  const cas = men.filter(isCas), able = men.filter((m) => !isCas(m));
  // a driver among the able men, if one is needed (the man who boards before the last)
  const drive = V.needsDriver() ? free.find((s) => s.drive) : null;
  if (V.needsDriver() && (!drive || !able.length)) return null;
  if (drive) left.delete(drive);
  for (const m of cas) out.set(m, (take((s) => !s.shoot) ?? take(() => true)).i);
  const driverMan = drive ? able[Math.max(0, able.length - 2)] : null;
  for (const m of able) {
    if (m === driverMan) {
      out.set(m, drive.i);
      continue;
    }
    out.set(m, (take((s) => s.shoot) ?? take(() => true)).i);
  }
  return out;
}
