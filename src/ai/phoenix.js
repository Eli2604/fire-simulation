import { MATERIALS } from '../sim/materials.js';

/**
 * A phoenix: a bird of fire, locked in a dungeon cell in the catacombs
 * (models/catacombs.js), behind an iron-barred gate that takes the jailer's key.
 * You have to get it out.
 *
 *  - Caged: it sits on its stone perch, turns its head after you, now and then
 *    spreads its wings in the cell and calls. The first time it sees you close by
 *    it calls to you.
 *  - Freed (the gate open, or blown out): it flies after you through the
 *    passages, low under the ceiling, keeping a couple of metres behind. Its route
 *    is the guards' path finding (ai/enemies.js), at flight height. It cannot open
 *    doors: at a closed one it waits and calls until you open it. Without you (in
 *    another zone, or down) it settles on the floor and waits.
 *  - Out: at the foot of the entrance stairs it takes off up them and out of the
 *    catacombs into the open sky. Then it is free.
 *  - The guards see it by its own light: a bird of fire in a dark passage. They
 *    shout and shoot at it (when they do not see you). Bullets and blasts hurt it;
 *    fire does not (it is fire).
 *  - Killed, it bursts into flame (a real flame in the simulation, which lights
 *    what is close by) and falls to a heap of glowing ash. From the ash it is born
 *    again, after a few seconds, and goes on.
 *  - The jailer (a guard with `key`) drops his keys when he dies; the walk-through
 *    picks them up (E) and opens the gate with them.
 *
 * State lives in `world.phoenixes` (plain data, frozen with its zone); this moves it
 * and sets what the renderer draws: `f.pos` (the body), `f.yaw`, `f.pitch`,
 * `f.bank`, `f.wing` (0 folded .. 1 spread), `f.flap` (wingbeat phase), `f.look`.
 */
const FLY_HEIGHT = 1.45; // body above the floor in flight
const PERCH_HEIGHT = 0.32; // body above what it stands on
const SPEED = 3.4; // m/s, faster than you hurry (2.2)
const KEEP = 2.0; // how far behind you it stays
const ASH_TIME = 9; // seconds as ash before it is born again
const REBIRTH_TIME = 2.2; // seconds the rebirth takes
const MAX_HEALTH = 100;

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const approach = (v, target, rate, dt) => v + (target - v) * Math.min(1, rate * dt);

export function initPhoenix(f, w) {
  if (f.init) return;
  f.init = true;
  f.state = 'caged';
  f.health = MAX_HEALTH;
  f.pos = f.p.slice();
  f.perch = f.p.slice();
  f.vel = [0, 0, 0];
  f.yaw ??= 0;
  f.yaw0 = f.yaw; // facing the gate
  f.pitch = 0;
  f.bank = 0;
  f.wing = 0;
  f.flap = 0;
  f.flapRate = 0;
  f.look = null;
  f.t = 0;
  f.stretchT = 4 + Math.random() * 4;
  f.calledAt = -1e9;
  f.hurtFlash = 0;
  f.route = null;
  f.repath = 0;
  f.leg = 0;
  f.gateIndex = w.doors.findIndex((d) => d.name === f.gate && (f.owner === undefined || d.owner === f.owner));
}

export class PhoenixAI {
  constructor(sim) {
    this.sim = sim;
    for (const f of sim.world.phoenixes ?? []) initPhoenix(f, sim.world);
  }

  get world() {
    return this.sim.world;
  }

  /** Is the gate of f's cell open (or broken: most of its bars gone)? */
  gateOpen(f) {
    const w = this.world;
    const d = w.doors[f.gateIndex];
    if (!d) return true;
    if (d.open) return true;
    let left = 0;
    for (const i of d.voxels) if (w.mat[i] && w.doorTag[i] === f.gateIndex + 1) left++;
    return left < d.voxels.length * 0.5;
  }

  /** A solid voxel at p that the bird cannot pass (walls, closed doors; not smoke, not grass). */
  solidAt(p) {
    const w = this.world;
    const i = w.voxelAt(p[0], p[1], p[2]);
    if (i < 0 || !w.mat[i]) return false;
    return MATERIALS[w.mat[i]].fluidity < 0.95;
  }

  /** The floor under p (searching down from p), or null. */
  floorAt(p) {
    return this.sim.ai.floorAt(p[0], p[2], p[1]);
  }

  /** The free phoenix a guard with his eyes at `head` can see, as a target to shoot at (or null). */
  seenBy(head) {
    for (const f of this.world.phoenixes ?? []) {
      if (!['follow', 'wait', 'escape'].includes(f.state) || f.health <= 0) continue;
      if (dist(head, f.pos) > 22) continue;
      if (!this.sim.ai.sees(head, f.pos)) continue;
      // the shooter aims at p + 1.2 m (a person's chest): put that on the bird's body
      return { p: [f.pos[0], f.pos[1] - 1.2, f.pos[2]], head: f.pos.slice(), moving: true, phoenix: f };
    }
    return null;
  }

  /** A bullet at p: is it in a phoenix's body? */
  at(p) {
    for (const f of this.world.phoenixes ?? []) {
      if (f.health <= 0 || !['caged', 'follow', 'wait', 'escape'].includes(f.state)) continue;
      if (dist(p, f.pos) < 0.28 || dist(p, [f.pos[0] + Math.sin(f.yaw) * 0.3, f.pos[1] + 0.12, f.pos[2] + Math.cos(f.yaw) * 0.3]) < 0.12) return f;
    }
    return null;
  }

  blast(center, radius) {
    for (const f of this.world.phoenixes ?? []) {
      const d = dist(center, f.pos);
      if (d < radius * 1.5) this.wound(f, 140 * (1 - d / (radius * 1.5)));
    }
  }

  wound(f, amount) {
    if (f.health <= 0 || !['caged', 'follow', 'wait', 'escape'].includes(f.state)) return;
    const w = this.world;
    f.health -= amount;
    f.hurtFlash = 0.35;
    if (f.health > 0) {
      if (w.time - f.calledAt > 1.5) this.call(f, 'phoenixHurt');
      return;
    }
    // it bursts into flame and falls to ash: a real flame, which lights what is close by
    f.health = 0;
    f.before = f.state === 'caged' ? 'caged' : 'follow';
    f.state = 'ashes';
    f.t = 0;
    const g = this.floorAt([f.pos[0], f.pos[1] + 0.1, f.pos[2]]) ?? f.pos[1] - PERCH_HEIGHT;
    f.ash = [f.pos[0], g, f.pos[2]];
    f.burst = f.pos.slice();
    this.sim.addTorch([f.pos[0], f.pos[1], f.pos[2]], 80000, 2.5, 0.35);
    this.sim.ignite(f.pos, 0.6);
    w.events.push({ type: 'phoenixBurns', pos: f.pos.slice(), time: w.time, name: 'the phoenix' });
    w.noises.push({ p: f.pos.slice(), loud: 18, time: w.time, kind: 'phoenix' });
  }

  call(f, type = 'phoenixCry') {
    const w = this.world;
    f.calledAt = w.time;
    f.callT = 0.8; // beak open
    w.events.push({ type, pos: f.pos.slice(), time: w.time, name: 'the phoenix' });
  }

  step(dt) {
    const w = this.world;
    for (const f of w.phoenixes) {
      initPhoenix(f, w);
      f.t += dt;
      f.hurtFlash = Math.max(0, f.hurtFlash - dt);
      f.callT = Math.max(0, (f.callT ?? 0) - dt);
      // the jailer's keys: dropped where he falls
      if (f.state !== 'free') this.dropKeys(w);
      if (f.state === 'caged') this.caged(f, w, dt);
      else if (f.state === 'follow' || f.state === 'wait') this.follow(f, w, dt);
      else if (f.state === 'escape') this.escape(f, w, dt);
      else if (f.state === 'ashes') this.ashes(f, w, dt);
      else if (f.state === 'reborn') this.reborn(f, w, dt);
      f.flap += dt * f.flapRate * Math.PI * 2;
    }
  }

  dropKeys(w) {
    for (const e of w.enemies) {
      if (!e.key || !e.dead || e.keyDropped) continue;
      e.keyDropped = true;
      const yaw = e.yaw ?? 0;
      const p = [e.p[0] + Math.cos(yaw) * 0.35, e.p[1] + 0.03, e.p[2] - Math.sin(yaw) * 0.35];
      w.pickups.push({ type: 'key', key: e.key, label: "the jailer's keys", p, voxels: [], taken: false, owner: -1 });
      w.events.push({ type: 'keysDropped', pos: p.slice(), time: w.time, name: 'the jailer' });
    }
  }

  // ---------------------------------------------------------------------------

  caged(f, w, dt) {
    const pl = this.sim.ai.player;
    f.pos = [f.perch[0], f.perch[1] + Math.max(0, Math.sin(f.flap * 0.5)) * 0.04 * f.wing, f.perch[2]];
    // watch you when you are close; call the first time it sees you, and now and then
    let sees = false;
    if (pl && dist(pl.head, f.pos) < 9 && this.sim.ai.sees(pl.head, f.pos)) {
      sees = true;
      f.look = pl.head.slice();
      if (!f.metPlayer) {
        f.metPlayer = true;
        this.call(f, 'phoenixCalls');
      } else if (w.time - f.calledAt > 14) this.call(f);
    } else f.look = null;
    // turn on the perch: to you, or back to the gate
    const want = f.look ? Math.atan2(f.look[0] - f.pos[0], f.look[2] - f.pos[2]) : f.yaw0;
    f.yaw += wrap(want - f.yaw) * Math.min(1, dt * 2.5);
    f.pitch = approach(f.pitch, 0, 3, dt);
    f.bank = approach(f.bank, 0, 3, dt);
    // now and then it spreads its wings (they brush the walls of the cell) and beats them
    f.stretchT -= dt;
    if (f.stretchT < 0) {
      f.stretching = 1.6 + Math.random();
      f.stretchT = (sees ? 4 : 7) + Math.random() * 6;
    }
    if (f.stretching > 0) f.stretching -= dt;
    const stretch = f.stretching > 0;
    f.wing = approach(f.wing, stretch ? 0.9 : 0, 4, dt);
    f.flapRate = stretch ? 2.4 : 0;
    if (this.gateOpen(f)) {
      f.state = 'follow';
      f.route = null;
      f.repath = 0;
      w.events.push({ type: 'phoenixFreed', pos: f.pos.slice(), time: w.time, name: 'the phoenix' });
      this.call(f, 'phoenixCry');
    }
  }

  /**
   * A route to `to`: round closed doors if there is a way (it cannot open them),
   * else through them (and it will wait there for you to open one).
   */
  route(from, to) {
    const ai = this.sim.ai;
    const open = ai.findPath(from, to, 1800); // closed doors count as walls here
    const end = open?.[open.length - 1];
    if (end && Math.hypot(end[0] - to[0], end[2] - to[2]) < 1.0) return open;
    return ai.path(from, to, 1800) ?? open;
  }

  /** Follow the player through the passages, a couple of metres behind. */
  follow(f, w, dt) {
    const pl = this.sim.ai.player;
    // at the foot of the stairs: out it goes
    if (dist2(f.pos, f.exit) < 2.5 || (pl && dist2(pl.p, f.exit) < 2.0 && dist2(f.pos, pl.p) < 5)) {
      f.state = 'escape';
      f.leg = 0;
      f.t = 0;
      w.events.push({ type: 'phoenixEscape', pos: f.pos.slice(), time: w.time, name: 'the phoenix' });
      this.call(f);
      return;
    }
    const floor = this.floorAt([f.pos[0], f.pos[1] + 0.2, f.pos[2]]) ?? 0;
    if (!pl) {
      // nobody to follow: settle on the floor and wait
      this.flyTo(f, w, dt, [f.pos[0], floor + PERCH_HEIGHT, f.pos[2]], 1.2, true);
      return;
    }
    const d = dist2(f.pos, pl.p);
    f.look = pl.head.slice();
    f.repath -= dt;
    if (d > KEEP + 0.6 && (f.repath <= 0 || !f.route?.length)) {
      f.repath = 0.6;
      f.route = this.route([f.pos[0], floor, f.pos[2]], pl.p);
      if (f.route) f.route.shift(); // where it is now
    }
    let goal = null;
    if (d > KEEP && f.route?.length) {
      while (f.route.length > 1 && dist2(f.route[0], f.pos) < 0.45) f.route.shift();
      const r = f.route[0];
      goal = [r[0], r[1] + FLY_HEIGHT, r[2]];
    } else if (d < 1.0) {
      // too close: give you room
      const a = Math.atan2(f.pos[0] - pl.p[0], f.pos[2] - pl.p[2]);
      goal = [pl.p[0] + Math.sin(a) * 1.3, floor + FLY_HEIGHT, pl.p[2] + Math.cos(a) * 1.3];
    } else goal = [f.pos[0], floor + FLY_HEIGHT, f.pos[2]]; // hold here, hovering
    // a closed door in the way: it cannot open doors; it waits there and calls
    const ahead = [goal[0] - f.pos[0], 0, goal[2] - f.pos[2]];
    const al = Math.hypot(ahead[0], ahead[2]);
    let door = -1;
    if (al > 0.05)
      for (const s of [0.25, 0.5]) {
        const q = [f.pos[0] + (ahead[0] / al) * s, f.pos[1], f.pos[2] + (ahead[2] / al) * s];
        const i = w.voxelAt(q[0], q[1], q[2]);
        if (i >= 0 && w.mat[i] && w.doorTag[i]) door = w.doorTag[i] - 1;
      }
    if (door >= 0) {
      goal = [f.pos[0], floor + FLY_HEIGHT, f.pos[2]];
      if (f.state !== 'wait') {
        f.state = 'wait';
        w.events.push({ type: 'phoenixWaits', pos: f.pos.slice(), time: w.time, name: 'the phoenix', door: w.doors[door].name });
      }
      if (w.time - f.calledAt > 6) this.call(f);
    } else if (f.state === 'wait') f.state = 'follow';
    this.flyTo(f, w, dt, goal, SPEED * (d > 8 ? 1.2 : 1));
  }

  /** Up the stairs and out into the sky. */
  escape(f, w, dt) {
    const fl = f.flight;
    const goal = fl[Math.min(f.leg, fl.length - 1)];
    this.flyTo(f, w, dt, goal, 4.2);
    if (dist(f.pos, goal) < 0.6 && f.leg < fl.length - 1) f.leg++;
    // (out of the top; or, with the entrance shut, through the hut above, out of sight)
    if (f.pos[1] > w.size[1] + 1.5 || (f.leg === fl.length - 1 && dist(f.pos, goal) < 0.8) || f.t > 12) {
      f.state = 'free';
      w.events.push({ type: 'phoenixFree', pos: f.pos.slice(), time: w.time, name: 'the phoenix' });
    }
  }

  ashes(f, w, dt) {
    f.vel = [0, 0, 0];
    f.wing = 0;
    f.flapRate = 0;
    if (f.t > ASH_TIME) {
      f.state = 'reborn';
      f.t = 0;
      f.pos = [f.ash[0], f.ash[1] + PERCH_HEIGHT, f.ash[2]];
      this.sim.addTorch([f.ash[0], f.ash[1] + 0.3, f.ash[2]], 40000, REBIRTH_TIME, 0.3);
      w.events.push({ type: 'phoenixReborn', pos: f.pos.slice(), time: w.time, name: 'the phoenix' });
    }
  }

  reborn(f, w, dt) {
    // it rises from the ash, wings opening, beating
    f.wing = approach(f.wing, 1, 2, dt);
    f.flapRate = 3;
    f.pos[1] = approach(f.pos[1], f.ash[1] + (f.before === 'caged' ? PERCH_HEIGHT + 0.25 : FLY_HEIGHT), 1.5, dt);
    if (f.t > REBIRTH_TIME) {
      f.health = MAX_HEALTH;
      f.t = 0;
      if (f.before === 'caged' && !this.gateOpen(f)) {
        f.state = 'caged';
      } else {
        f.state = 'follow';
        f.route = null;
        f.repath = 0;
      }
      this.call(f);
    }
  }

  /** Fly towards goal (accelerating, banking into turns), wings beating; or land when `land`. */
  flyTo(f, w, dt, goal, speed, land = false) {
    const dx = goal[0] - f.pos[0];
    const dy = goal[1] - f.pos[1];
    const dz = goal[2] - f.pos[2];
    const d = Math.hypot(dx, dy, dz);
    const want = d > 0.02 ? [(dx / d) * Math.min(speed, d * 2.2), (dy / d) * Math.min(speed, d * 2.2), (dz / d) * Math.min(speed, d * 2.2)] : [0, 0, 0];
    const acc = 7;
    for (let c = 0; c < 3; c++) {
      const dv = want[c] - f.vel[c];
      f.vel[c] += Math.sign(dv) * Math.min(Math.abs(dv), acc * dt);
    }
    // keep clear of the ceiling and the floor
    const next = [f.pos[0] + f.vel[0] * dt, f.pos[1] + f.vel[1] * dt, f.pos[2] + f.vel[2] * dt];
    if (this.solidAt([next[0], next[1] + 0.35, next[2]])) {
      next[1] = f.pos[1] - 0.5 * dt;
      f.vel[1] = Math.min(0, f.vel[1]);
    }
    if (this.solidAt([next[0], next[1] - 0.15, next[2]]) && !land) {
      next[1] = f.pos[1] + 0.5 * dt;
      f.vel[1] = Math.max(0, f.vel[1]);
    }
    f.pos = next;
    const hs = Math.hypot(f.vel[0], f.vel[2]);
    const oldYaw = f.yaw;
    const face = hs > 0.4 ? Math.atan2(f.vel[0], f.vel[2]) : f.look ? Math.atan2(f.look[0] - f.pos[0], f.look[2] - f.pos[2]) : f.yaw;
    f.yaw += wrap(face - f.yaw) * Math.min(1, dt * 4);
    const yawRate = wrap(f.yaw - oldYaw) / Math.max(dt, 1e-3);
    f.bank = approach(f.bank, Math.max(-0.7, Math.min(0.7, Math.atan((hs * yawRate) / 9.81))), 4, dt);
    f.pitch = approach(f.pitch, Math.max(-0.5, Math.min(0.6, Math.atan2(f.vel[1], Math.max(0.5, hs)) * 0.8 - hs * 0.03)), 4, dt);
    // the wings: spread and beating in flight (faster hovering and climbing, slower
    // cruising); folded on the floor. In a narrow place they do not open quite as wide.
    const landed = land && d < 0.08;
    const right = [Math.cos(f.yaw), 0, -Math.sin(f.yaw)];
    const narrow = this.solidAt([f.pos[0] + right[0] * 0.75, f.pos[1], f.pos[2] + right[2] * 0.75]) || this.solidAt([f.pos[0] - right[0] * 0.75, f.pos[1], f.pos[2] - right[2] * 0.75]);
    f.wing = approach(f.wing, landed ? 0 : narrow ? 0.72 : 1, 4, dt);
    f.flapRate = landed ? 0 : hs < 1 ? 3.6 : f.vel[1] > 0.5 ? 3.4 : 2.6;
  }
}
