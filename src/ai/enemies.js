import { traceVoxels } from './sight.js';
import { MATERIALS } from '../sim/materials.js';
import { toggleDoor } from '../sim/doors.js';
import { hitZone, wound, shoot } from '../sim/wounds.js';

/**
 * Enemies: people in the building who do not want to be found.
 *
 *  - They walk on the voxel world (paths over the floors and stairs, step-up
 *    and drop limits), and their paths avoid hot and burning places: a cell's
 *    cost rises with the gas temperature and flames.
 *  - They see the player when there is a line of sight that is not blocked by
 *    walls or thick smoke, and hear noises (breaking glass, blasts, impacts,
 *    doors, the bow) within a range that depends on how loud they are.
 *  - Patrol → investigate noises → when they spot the player they use the
 *    room: they pick something flammable (paper, fabric, upholstery, wood,
 *    cables...) in a place that will draw the player in, light it, shout and
 *    pull back to hide. They flee from heat and smoke.
 *  - Heat, flames (they catch fire), arrows, blasts and falling debris hurt them.
 *  - Light: in the dark, a spot lit up by your lamp that they can see (and that no
 *    torch explains) makes them come and look; so does seeing the beam itself.
 *  - Doors: their paths go through doors they can open (not locked ones). They
 *    open a closed door when they reach it and mostly close it behind them.
 *  - A phoenix out of its cell (ai/phoenix.js): they see it by its own light, shout,
 *    and shoot at it when they do not see you.
 */
const EYE = 1.6;
const R = 0.25;
const SPEED = 1.3;
const RUN = 2.6;
const FUELS = new Set(['paper', 'fabric', 'foam', 'wood', 'cable', 'grass', 'leaves', 'twigs', 'deadWood', 'plastic', 'shingles']);

export class EnemyAI {
  constructor(sim) {
    this.sim = sim;
    this.player = null; // set each frame by the walk-through: { p: [x,y,z] feet, head }
    this.heardUpTo = 0;
    sim.hitEnemy = (p, type) => this.hit(p, type);
  }

  get world() {
    return this.sim.world;
  }

  solidAt(x, y, z) {
    const w = this.world;
    const i = w.voxelAt(x, y, z);
    if (i < 0 || w.mat[i] === 0 || MATERIALS[w.mat[i]].fluidity >= 0.95) return false;
    // planning a route: a door that can be opened is no wall
    if (this.passDoors && w.doorTag[i] && !w.doors[w.doorTag[i] - 1].locked) return false;
    return true;
  }

  floorAt(x, z, from) {
    const h = this.world.h;
    for (let y = from; y > from - 3; y -= h * 0.5) if (this.solidAt(x, y - h * 0.25, z)) return Math.floor((y - h * 0.25) / h) * h + h;
    return null;
  }

  blocked(x, z, y) {
    const w = this.world;
    if (x < R || z < R || x > w.size[0] - R || z > w.size[2] - R) return true;
    for (let hy = y + 0.45; hy <= y + EYE + 0.15; hy += w.h)
      for (const [dx, dz] of [[0, 0], [R, 0], [-R, 0], [0, R], [0, -R]]) if (this.solidAt(x + dx, hy, z + dz)) return true;
    return false;
  }

  /** How unpleasant is it to stand here (heat, flames, smoke)? 0 = fine. */
  hazard(x, y, z) {
    const w = this.world;
    const a = this.sim.airCellAt(x, y + 1.2, z);
    if (a < 0) return 0;
    return Math.max(0, (w.airT[a] - 45) / 25) + w.flame[a] * 25 + Math.min(3, (w.smoke[a] / w.ah ** 3) * 2000);
  }

  /** A* over a 0.4 m grid on the floors, avoiding hazards. Returns a list of points or null. */
  path(from, to, maxNodes = 2500) {
    this.passDoors = true;
    try {
      return this.findPath(from, to, maxNodes);
    } finally {
      this.passDoors = false;
    }
  }

  findPath(from, to, maxNodes) {
    const step = 0.4;
    const key = (x, z, y) => `${Math.round(x / step)},${Math.round(z / step)},${Math.round(y / 0.5)}`;
    const start = { x: from[0], y: from[1], z: from[2], g: 0, f: 0, prev: null };
    const goal = to;
    const open = [start];
    const seen = new Map([[key(start.x, start.z, start.y), start]]);
    let best = start;
    let n = 0;
    while (open.length && n++ < maxNodes) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (open[k].f < open[bi].f) bi = k;
      const cur = open.splice(bi, 1)[0];
      const dg = Math.hypot(cur.x - goal[0], cur.z - goal[2], (cur.y - goal[1]) * 2);
      if (dg < Math.hypot(best.x - goal[0], best.z - goal[2], (best.y - goal[1]) * 2)) best = cur;
      if (dg < 0.6) {
        best = cur;
        break;
      }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const x = cur.x + dx * step;
        const z = cur.z + dz * step;
        const y = this.floorAt(x, z, cur.y + 0.5);
        if (y === null || y - cur.y > 0.45 || cur.y - y > 1.2) continue;
        if (this.blocked(x, z, y)) continue;
        const k = key(x, z, y);
        const g = cur.g + step * Math.hypot(dx, dz) * (1 + this.hazard(x, y, z));
        const old = seen.get(k);
        if (old && old.g <= g) continue;
        const node = { x, y, z, g, f: g + Math.hypot(x - goal[0], z - goal[2], (y - goal[1]) * 2), prev: cur };
        seen.set(k, node);
        open.push(node);
      }
    }
    if (best === start) return null;
    const pts = [];
    for (let c = best; c; c = c.prev) pts.push([c.x, c.y, c.z]);
    return pts.reverse();
  }

  /** Line of sight from a to b, voxel by voxel (ai/sight.js): blocked by solids and thick smoke. */
  sees(a, b) {
    const w = this.world;
    const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (d > 22) return false;
    let tau = 0;
    return !traceVoxels(w, a, b, (i, len, t) => {
      if (i < 0) return false;
      const m = w.mat[i];
      if (m && MATERIALS[m].fluidity < 0.95 && !(this.passDoors && w.doorTag[i] && !w.doors[w.doorTag[i] - 1].locked)) return true;
      const c = this.sim.airCellAt(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
      if (c >= 0) tau += ((8700 * w.smoke[c]) / w.ah ** 3) * len;
      return tau > 2.5;
    });
  }

  step(dt) {
    const w = this.world;
    const pl = this.player;
    // new noises since last time
    const noises = w.noises.filter((e) => e.time >= this.heardUpTo);
    this.heardUpTo = w.time;
    if (w.noises.length > 200) w.noises.splice(0, w.noises.length - 100);
    for (const e of w.enemies) {
      if (e.dead || e.squad) continue; // a fire team has its own AI (ai/squad.js)
      e.timer = (e.timer ?? 0) - dt;
      e.lureCooldown = (e.lureCooldown ?? 10 + Math.random() * 10) - dt;
      e.repath = (e.repath ?? 0) - dt;
      const head = [e.p[0], e.p[1] + EYE, e.p[2]];
      // --- hurt by heat and flames, catch fire
      const a = this.sim.airCellAt(e.p[0], e.p[1] + 1, e.p[2]);
      if (a >= 0) {
        const T = w.airT[a];
        if (T > 60) this.damage(e, ((T - 60) / 12) * dt);
        if (w.flame[a] > 0.3 && !e.onFire && Math.random() < dt * 2) e.onFire = 12;
      }
      if (e.onFire > 0) {
        e.onFire -= dt;
        this.damage(e, 8 * dt);
        e.state = 'flee';
      }
      if (e.dead) continue;
      // --- senses
      const seesPlayer = pl && this.sees(head, pl.head);
      if (seesPlayer) {
        e.lastSeen = pl.p.slice();
        if (!e.alerted) {
          e.alerted = true;
          w.events.push({ type: 'shout', pos: head, time: w.time, name: 'enemy' });
        }
      }
      // a lit spot in the dark where nothing should be lit: someone is there with a lamp
      const L = this.lamp;
      if (L && w.dark && w.time - L.time < 0.6 && !seesPlayer && !['lure', 'retreat', 'flee'].includes(e.state) && !((e.lightCooldown ?? 0) > w.time)) {
        if (this.suspiciousLight(e, head, L)) {
          e.lightCooldown = w.time + 8;
          if (e.state !== 'investigate') w.events.push({ type: 'lightSeen', pos: head, time: w.time, name: 'enemy' });
          e.state = 'investigate';
          e.goal = L.spot.slice();
          e.goal[1] = e.p[1];
          e.repath = 0;
        }
      }
      for (const n of noises) {
        const d = Math.hypot(n.p[0] - e.p[0], n.p[1] - e.p[1], n.p[2] - e.p[2]);
        if (d < n.loud && !['lure', 'retreat', 'flee'].includes(e.state) && n.kind !== 'enemy' && n.kind !== 'dragon') {
          e.state = 'investigate';
          e.goal = n.p.slice();
          e.repath = 0;
          // an explosion: they run there, and search the place for a while
          if (n.kind === 'explosion') {
            e.urgent = true;
            e.searchAt = n.p.slice();
            e.searchUntil = w.time + 20;
          }
        }
      }
      // --- danger first: get out of heat and smoke
      const hz = this.hazard(...e.p);
      let dragon = null;
      if (hz > 1) {
        e.state = 'flee';
        if (e.repath <= 0) {
          e.goal = this.coolerSpot(e.p);
          e.repath = 1.5;
          e.route = e.goal ? this.path(e.p, e.goal, 1200) : null;
        }
      } else if ((dragon = this.sim.dragonAI?.threat(e.p))) {
        // a dragon close by: run (away from it, into cover if there is some)
        if (e.state !== 'flee' || e.repath <= 0) {
          if (e.state !== 'flee') w.events.push({ type: 'shout', pos: head, time: w.time, name: 'enemy' });
          e.state = 'flee';
          e.goal = this.awayFrom(e.p, dragon, 10);
          e.repath = 1.5;
          e.route = this.path(e.p, e.goal, 1200);
        }
      } else if (e.state === 'flee' && !(e.onFire > 0)) e.state = 'patrol';
      // --- decide
      if (e.state !== 'flee') {
        if (seesPlayer && e.lureCooldown <= 0 && e.state !== 'lure' && e.state !== 'retreat') {
          const fuel = this.lureSpot(e, pl);
          if (fuel) {
            e.state = 'lure';
            e.fuel = fuel;
            e.goal = fuel.stand;
            e.repath = 0;
          }
        }
        if (seesPlayer && e.state === 'patrol') {
          // keep away from the player
          const d = Math.hypot(pl.p[0] - e.p[0], pl.p[2] - e.p[2]);
          if (d < 8) {
            e.state = 'retreat';
            e.goal = this.awayFrom(e.p, pl.p, 10);
            e.repath = 0;
          }
        }
        if (e.state === 'patrol' && (!e.goal || e.timer <= 0)) {
          e.goal = this.patrolGoal(e);
          e.timer = 6 + Math.random() * 6;
          e.repath = 0;
        }
        if (e.repath <= 0 && e.goal) {
          e.route = this.path(e.p, e.goal);
          e.repath = e.state === 'lure' ? 2 : 3;
        }
      }
      // --- arrived?
      const atGoal = e.goal && Math.hypot(e.goal[0] - e.p[0], e.goal[2] - e.p[2]) < 0.7;
      if (atGoal) {
        if (e.state === 'lure' && e.fuel) {
          // light it, shout to draw the player in, then pull back
          this.sim.ignite(e.fuel.p, 0.35);
          this.sim.addTorch(e.fuel.p, 4000, 12, 0.15);
          w.events.push({ type: 'enemyFire', pos: e.fuel.p, time: w.time, name: 'enemy' });
          w.noises.push({ p: e.fuel.p.slice(), loud: 25, time: w.time, kind: 'enemy' });
          e.lureCooldown = 40 + Math.random() * 20;
          e.state = 'retreat';
          e.goal = this.awayFrom(e.p, e.fuel.p, 10, pl?.p);
          e.fuel = null;
          e.repath = 0;
        } else if (e.state === 'investigate' && e.urgent && w.time < e.searchUntil) {
          // searching round the place of the blast
          const s = e.searchAt;
          const a = Math.random() * Math.PI * 2;
          const rr = 1 + Math.random() * 3.5;
          e.goal = [s[0] + Math.cos(a) * rr, e.p[1], s[2] + Math.sin(a) * rr];
          e.repath = 0;
        } else if (e.state === 'investigate' || e.state === 'retreat') {
          // back to the patrol area after a short look around
          e.state = 'patrol';
          e.urgent = false;
          e.timer = 3 + Math.random() * 3;
        } else if (e.state === 'patrol' && e.area?.mode === 'route') {
          // a guard round: straight on to the next corner
          e.goal = this.patrolGoal(e);
          e.timer = 30;
          e.repath = 0;
        }
      }
      // --- they fire back while they see you (or the escaped phoenix); otherwise walk along the route (limping if a leg is hit)
      const bird = !seesPlayer && e.state !== 'flee' ? this.sim.phoenixAI?.seenBy(head) : null;
      if (bird && !e.sawBird) w.events.push({ type: 'shout', pos: head, time: w.time, name: 'enemy' });
      e.sawBird = !!bird;
      e.aiming = (seesPlayer && this.fireAt(e, pl, dt)) || (!!bird && this.fireAt(e, bird, dt));
      if (!e.aiming) this.move(e, dt, (e.state === 'flee' || e.state === 'retreat' || (e.state === 'investigate' && e.urgent) ? RUN : SPEED) * (e.speedFactor ?? 1));
      this.closeBehind(e);
    }
  }

  move(e, dt, speed) {
    const route = e.route;
    e.moving = false;
    if (!route || !route.length) return;
    let target = route[0];
    while (route.length > 1 && Math.hypot(target[0] - e.p[0], target[2] - e.p[2]) < 0.25) {
      route.shift();
      target = route[0];
    }
    const dx = target[0] - e.p[0];
    const dz = target[2] - e.p[2];
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    const s = Math.min(d, speed * dt);
    const nx = e.p[0] + (dx / d) * s;
    const nz = e.p[2] + (dz / d) * s;
    const fy = this.floorAt(nx, nz, e.p[1] + 0.5);
    if (fy === null || fy - e.p[1] > 0.45 || this.blocked(nx, nz, fy)) {
      // a closed door in the way: open it (unless it is locked)
      const k = this.doorAhead(e, nx, nz, dx / d, dz / d);
      if (k >= 0) {
        this.useDoor(k, true);
        e.openedDoor = k;
        e.doorWait = 0.4; // the time it takes to push it open
        return;
      }
      e.repath = 0; // something changed (a door closed, debris): plan again
      return;
    }
    if (e.doorWait > 0) {
      e.doorWait -= dt;
      return;
    }
    e.p = [nx, e.p[1] + (fy - e.p[1]) * Math.min(1, dt * 10), nz];
    e.yaw = Math.atan2(dx, dz);
    e.moving = true;
    e.walkPhase = (e.walkPhase ?? 0) + s * 4;
  }

  /** Can e see the spot the lamp lights up, and is it a place that should be dark? */
  suspiciousLight(e, head, L) {
    const w = this.world;
    const s = L.spot;
    const d = Math.hypot(s[0] - head[0], s[1] - head[1], s[2] - head[2]);
    if (d > 18) return false;
    // torches light their surroundings anyway
    for (const ht of w.heaters) if (ht.light && ht.on && Math.hypot(ht.pos[0] - s[0], ht.pos[1] - s[1], ht.pos[2] - s[2]) < 2.5) return false;
    // the spot is on the player (lighting your own feet does not count as a strange light)
    const pl = this.player;
    if (pl && Math.hypot(pl.p[0] - s[0], pl.p[2] - s[2]) < 0.8) return false;
    // they look at it (a little in front of the surface, towards them)
    const k = 0.2 / Math.max(0.2, d);
    const p = [s[0] + (head[0] - s[0]) * k, s[1] + (head[1] - s[1]) * k, s[2] + (head[2] - s[2]) * k];
    return this.sees(head, p);
  }

  /** A closed, unlocked door right in front of e (moving along dx, dz), or -1. */
  doorAhead(e, nx, nz, dx, dz) {
    const w = this.world;
    for (let ahead = 0; ahead <= 0.6; ahead += w.h)
      for (const hy of [0.8, 1.3])
        for (const side of [0, R, -R]) {
          const i = w.voxelAt(nx + dx * ahead - dz * side, e.p[1] + hy, nz + dz * ahead + dx * side);
          if (i < 0 || !w.mat[i] || !w.doorTag[i]) continue;
          const k = w.doorTag[i] - 1;
          const door = w.doors[k];
          if (!door.open && !door.locked) return k;
        }
    return -1;
  }

  /** Close the door e came through once e is clear of it (most of them do; nobody else in the doorway). */
  closeBehind(e) {
    const k = e.openedDoor;
    if (k === undefined || k < 0) return;
    const d = this.world.doors[k];
    if (!d.open) {
      e.openedDoor = -1;
      return;
    }
    const clear = (p) => Math.hypot(p[0] - d.center[0], p[2] - d.center[2]) > 1.3;
    if (!clear(e.p)) return;
    e.openedDoor = -1;
    if (Math.random() > 0.8) return; // left open
    if (this.world.enemies.some((o) => !o.dead && !clear(o.p))) return;
    if (this.player && !clear(this.player.p)) return;
    this.useDoor(k, false);
  }

  /** Open / close a door. Its sound is theirs: the others do not come to look. */
  useDoor(k, open) {
    const w = this.world;
    if (!toggleDoor(this.sim, k, open)) return;
    const n = w.noises[w.noises.length - 1];
    if (n?.kind === 'door') n.kind = 'enemy';
  }

  /** Next place to walk to on patrol: around home, a random spot in the area, or the next corner of the round. */
  patrolGoal(e) {
    const a = e.area;
    if (!a) return [e.home[0] + (Math.random() - 0.5) * 12, e.home[1], e.home[2] + (Math.random() - 0.5) * 12];
    const c = a.corners;
    if (a.mode === 'route') {
      e.leg = ((e.leg ?? 0) + 1) % c.length;
      return c[e.leg].slice();
    }
    // a random point in the (possibly rotated) rectangle
    const u = Math.random();
    const v = Math.random();
    return [0, 1, 2].map((k) => c[0][k] + (c[1][k] - c[0][k]) * u + (c[3][k] - c[0][k]) * v);
  }

  /** Is p inside the enemy's patrol area (or near home)? */
  inArea(e, p) {
    const a = e.area;
    if (!a) return Math.hypot(p[0] - e.home[0], p[2] - e.home[2]) < 8;
    const [c0, c1, , c3] = a.corners;
    const ux = c1[0] - c0[0];
    const uz = c1[2] - c0[2];
    const vx = c3[0] - c0[0];
    const vz = c3[2] - c0[2];
    const dx = p[0] - c0[0];
    const dz = p[2] - c0[2];
    const s = (dx * ux + dz * uz) / (ux * ux + uz * uz || 1);
    const t = (dx * vx + dz * vz) / (vx * vx + vz * vz || 1);
    return s >= -0.05 && s <= 1.05 && t >= -0.05 && t <= 1.05;
  }

  /** Something flammable, reachable, that will draw the player in (not on top of them). */
  lureSpot(e, pl) {
    const w = this.world;
    let best = null;
    let bs = Infinity;
    const h = w.h;
    for (let k = 0; k < w.solidCount; k += 3) {
      const i = w.solids[k];
      const M = MATERIALS[w.mat[i]];
      if (!FUELS.has(M.name) || w.expo[i] === 0 || w.flags[i] & 8) continue;
      const c = w.center(...w.coords(i));
      const de = Math.hypot(c[0] - e.p[0], c[2] - e.p[2]);
      if (de > 12 || Math.abs(c[1] - e.p[1]) > 2.5) continue;
      const dp = Math.hypot(c[0] - pl.p[0], c[2] - pl.p[2]);
      if (dp < 3) continue;
      const score = de + 0.7 * Math.abs(dp - 7);
      if (score < bs) {
        bs = score;
        best = c;
      }
    }
    if (!best) return null;
    // a place to stand next to it
    for (const [dx, dz] of [[0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6], [0.5, 0.5], [-0.5, -0.5]]) {
      const x = best[0] + dx;
      const z = best[2] + dz;
      const y = this.floorAt(x, z, best[1] + 1);
      if (y !== null && !this.blocked(x, z, y)) return { p: best, stand: [x, y, z] };
    }
    void h;
    return null;
  }

  awayFrom(p, from, dist, also) {
    let best = null;
    let bs = -Infinity;
    for (let k = 0; k < 16; k++) {
      const ang = (k / 16) * Math.PI * 2;
      const x = p[0] + Math.cos(ang) * dist;
      const z = p[2] + Math.sin(ang) * dist;
      const y = this.floorAt(x, z, p[1] + 1);
      if (y === null || this.blocked(x, z, y)) continue;
      const s = Math.hypot(x - from[0], z - from[2]) + (also ? 0.5 * Math.hypot(x - also[0], z - also[2]) : 0) - this.hazard(x, y, z) * 5;
      if (s > bs) {
        bs = s;
        best = [x, y, z];
      }
    }
    return best ?? p;
  }

  coolerSpot(p) {
    let best = null;
    let bh = this.hazard(...p);
    for (let r = 1.5; r <= 9; r += 2.5)
      for (let k = 0; k < 12; k++) {
        const ang = (k / 12) * Math.PI * 2;
        const x = p[0] + Math.cos(ang) * r;
        const z = p[2] + Math.sin(ang) * r;
        const y = this.floorAt(x, z, p[1] + 1);
        if (y === null || this.blocked(x, z, y)) continue;
        const hz = this.hazard(x, y, z);
        if (hz < bh) {
          bh = hz;
          best = [x, y, z];
        }
      }
    return best;
  }

  damage(e, amount) {
    if (e.dead) return;
    e.health -= amount;
    if (e.health <= 0) {
      e.dead = true;
      e.health = 0;
      this.world.events.push({ type: 'enemyDown', pos: e.p.slice(), time: this.world.time, name: 'enemy' });
    }
  }

  /** A projectile at p: did it hit someone? */
  hit(p, type, g) {
    for (const e of this.world.enemies) {
      if (e.dead) continue;
      if (Math.abs(p[0] - e.p[0]) > 0.45 || Math.abs(p[2] - e.p[2]) > 0.45) continue;
      if (type === 'arrow') {
        // where it lands decides what it does (head, torso, an arm, a leg)
        const zone = hitZone(e, p);
        if (!zone) continue;
        wound(this.sim, e, zone, 'arrow', p, g?.v ?? [0, 0, 1]);
        if (zone === 'torso' || zone === 'head') e.onFire = 10; // the burning rag
        e.state = 'flee';
        return true;
      }
      if (Math.hypot(p[0] - e.p[0], p[2] - e.p[2]) < 0.35 && p[1] > e.p[1] && p[1] < e.p[1] + 1.85) {
        this.damage(e, 200);
        e.state = 'flee';
        return true;
      }
    }
    return false;
  }

  /**
   * Firing at the player (or another target: { p, head, moving }): short bursts while they can see it and still have the use
   * of their arms; less accurate further away, when they are wounded, or running.
   * Returns true while aiming (they stand still to shoot).
   */
  fireAt(e, pl, dt) {
    const w = this.world;
    if (e.canFire === false || e.dead || ['lure', 'flee'].includes(e.state)) return false;
    const d = Math.hypot(pl.head[0] - e.p[0], pl.head[2] - e.p[2]);
    if (d > 28) return false;
    e.yaw = Math.atan2(pl.p[0] - e.p[0], pl.p[2] - e.p[2]);
    e.fireCd = (e.fireCd ?? 0.6 + Math.random()) - dt;
    if (e.fireCd > 0) return true;
    e.burst = (e.burst ?? 3) - 1;
    e.fireCd = e.burst > 0 ? 0.12 : 1.4 + Math.random() * 1.6;
    if (e.burst <= 0) e.burst = 3;
    const muzzle = [e.p[0] + Math.sin(e.yaw) * 0.5, e.p[1] + 1.45, e.p[2] + Math.cos(e.yaw) * 0.5];
    const target = [pl.p[0], pl.p[1] + 1.2, pl.p[2]];
    const spread = 0.025 + d * 0.003 + (e.bleed ? 0.04 : 0) + (pl.moving ? 0.03 : 0);
    const dir = [0, 1, 2].map((k) => target[k] - muzzle[k] + (Math.random() - 0.5) * 2 * spread * d);
    e.flashUntil = w.time + 0.06;
    const hit = shoot(this.sim, muzzle, dir, { shooter: e, player: this.player });
    if (hit?.player) w.playerHits.push({ zone: hit.zone, time: w.time, from: muzzle });
    return true;
  }

  /** A blast: hurts everyone in range. */
  blast(center, radius) {
    for (const e of this.world.enemies) {
      const d = Math.hypot(center[0] - e.p[0], center[1] - (e.p[1] + 1), center[2] - e.p[2]);
      if (d < radius * 1.5) this.damage(e, 160 * (1 - d / (radius * 1.5)));
    }
  }

  /** Falling / flying debris near someone. */
  debrisHits() {
    const w = this.world;
    for (const e of w.enemies) {
      if (e.dead) continue;
      for (const d of w.debris) {
        if (d.flake || d.hitEnemy) continue;
        const v = Math.hypot(...d.v);
        if (v < 3) continue;
        if (Math.hypot(d.p[0] - e.p[0], d.p[2] - e.p[2]) < 0.35 && d.p[1] > e.p[1] && d.p[1] < e.p[1] + 1.8) {
          const m = MATERIALS[d.mat].density * d.dens * w.h ** 3;
          this.damage(e, Math.min(100, (0.5 * m * v * v) / 8));
          d.hitEnemy = true;
        }
      }
    }
  }
}
