/**
 * A fire team advancing on a threat by bounding overwatch.
 *
 * Roles (member.squad): CMD the commander, MG the gunner, R1 and R2 riflemen. Team A is CMD
 * with R1, team B is MG with R2. One team moves to cover nearer the threat while the other
 * covers it from where it is (crouched, aiming, firing bursts, the MG most); when the movers
 * are set the commander signals and the teams swap. Near the threat the commander signals
 * halt and everyone holds security.
 *
 *  - Cover: free spots right beside something solid (a wall, a crate) that lies between the
 *    spot and the threat. Each bound picks cover that gains ground, is not too far to run
 *    and stays within reach of the covering team (the squad keeps together).
 *  - Routes: A* on a grid; cells next to walls are cheaper, so routes hug the walls. Movers
 *    walk with the rifle up, turned towards the threat (the renderer twists the upper body);
 *    long legs they run.
 *  - Grenades: a covering rifleman throws one at the threat when it is in range.
 *  - A soldier who lost his rifle (unarmed) runs to it, picks it up and carries on.
 *  - Both legs hit: they crawl, and fire lying down.
 *  - Parkour (ai/parkour.js): the grid knows where a low wall can be vaulted, a ledge climbed
 *    (jump climb, or a mantle from a standstill) and a drop jumped down (with a roll when it is
 *    deep): links between cells that cost what the move takes. So routes go straight over low
 *    walls instead of round them, the gunner climbs onto higher ground, and a man running to low
 *    cover slides in behind it. Moving, a man who meets such an obstacle does the move: m.trav
 *    carries him along the move's root path while the clip of the same name plays. Wounded men
 *    do not climb (and vault slowly), a heavy load limits how high; they go round instead.
 *  - A flame trooper (member.loadout 'torch') stands up and fires the flame gun when the
 *    threat is within its reach (host.flame), and only covers otherwise.
 *  - Radio: on first contact, when the threat moves and when a man is down, the radio man
 *    (the commander, or whoever is left) keys the radio on his chest and reports; every
 *    other team that still has someone standing answers in turn. No team left: no response.
 *    Several squads (member.unit) each have their own SquadAI; peers() gives the others.
 *  - Drone: a drone operator (role UAV) stays back from the bounds; on contact he takes the
 *    drone out of his backpack and launches it (host.droneLaunch), radios that it is up, and
 *    stays at the controls.
 *    While it is up he keeps the team informed: a report every so often (where the threat is,
 *    whether it moved, where the other teams are). When the team has reached the threat and
 *    held it a while with no one hit and nothing moving (the area is safe), the commander
 *    orders him to scout: he flies the drone on an expanding square round the area (m.droneGoal,
 *    two rings of eight points), reporting each sector clear. If the threat moves or a man goes
 *    down, the commander calls the drone back over the threat.
 *  - Senses: they see hostiles (host.hostiles) within what the visibility allows and in line of
 *    sight (host.lineOfSight); a sighting is the threat, marked on the hostile, and followed as
 *    he moves. Noises (host.noises: { p, loud m, time }) within earshot make the commander send
 *    two men to investigate (or investigate(p) on order); losing sight of the enemy for long,
 *    they investigate the last known position.
 *  - The commander's calls: radio silence for a while (calls wait; hand signals instead) when
 *    they move unseen; thermal goggles on when the visibility is poor (fog, smoke, dark,
 *    host.visibility / host.dark); lights on in the dark unless that would give them away;
 *    backup from the other teams when two men are down or the enemy outnumbers them.
 *  - Positions: cover at a corner (covered on two sides) is better; the gunner prefers higher
 *    ground a little behind the team (he sees further) and calls out good cover from there; a
 *    lookout up a staircase (host.lookouts) beats a mound. Routes between levels take the stairs.
 *  - Orders: the first squad leads. On contact its commander sends every other team to a flank
 *    of the threat ("Bravo, take the west flank"); a team that gets well ahead of the lead is
 *    told to hold off until the lead catches up, then to continue; when the threat moves away
 *    he calls pursuit and all teams run after it, bounding again once they are close. Each
 *    order is answered on the radio and then carried out.
 *
 * Pure logic, no three.js: it runs in the simulation (one member per enemy with .squad) and
 * in the rig page. The host gives:
 *   members()          the people (objects with p, yaw, squad, dead, ...; written here)
 *   solid(x, y, z)     is there something solid
 *   floor(x, z)        the ground height there (or null)
 *   bounds             [x0, z0, x1, z1] where they may go
 *   fire(m, target)    one round from m at target (optional)
 *   grenade(m, from, vel)  a grenade thrown (optional)
 *   rifleAt(m)         where m's dropped rifle lies, if he can pick it up (optional)
 *   pickup(m)          m picks it up (optional)
 *   flame(m, target)   a flame trooper's burst of flame at target (optional)
 *   radio(m, text, kind)  m speaks on the radio (kind: contact, threat, manDown, reply, none)
 *   unit, peers()      this squad's name and the other squads' AIs (optional)
 *   side               the side it fights on (optional; else its men's m.side, else all one side):
 *                      a retreat is called in only to the teams on its side (ai/retreatRadio.js)
 *   din(p)             the noise level there (dB) a shout has to carry over (optional)
 *   ownMove(m)         true while m is not this AI's to move: a guard on his patrol, or
 *                      running from fire (optional; ai/enemies.js)
 *   hostiles(), lineOfSight(a, b), visibility(), dark(), noises()  what they can sense
 *   path3d(a, b)       a way between levels (by the stairs), [points], last = b (optional)
 *   lookouts()         raised places with a view (a deck, a roof): [[x, y, z], ...] (optional).
 *                      Before contact one rifleman climbs to the best of them and watches from
 *                      there; on contact the gunner takes one that sees the threat as his
 *                      overwatch, while the team stays within reach of it
 * For the renderer each member gets: anim (clip name), aimAt, path / pathI, cover, track (where he went, [x, z]),
 * signal { text, until }, moving, speed.
 */
import { analyse, openGround, moveGroup, endGroup, stepGroups, clearTo, stepClearing, joinUp, doorOnPath, startBreach, breachStep } from './tactics.js';
import { probe, moveFor, ability, geoFor, durFor, rootAt, rootEnd, costOf, surface, clear, MOVES as PK_MOVES, STEP, DROP_MIN } from './parkour.js';
import { pickRoll, startRoll, stepRoll, worthRolling } from './evade.js';
import { kit, manage, aimPoint, canShoot, spend, weaponKind, casualties, heavyFire, ARMS, TIMES, recoilOf, skillOf } from './soldier.js';
import { stepClimb } from './recoil.js';
import { gaitK } from './weapons.js';
import { stepKnocked } from './melee.js';
import { stepStrategy, rethink, exposedTo } from './strategy.js';
import { stepCasualties } from './casualty.js';
import { stepTraps } from './retreat.js';
import { friendliesOf, sideOf } from './retreatRadio.js';
import { perceive, senses as senseProfile, hears, eyeOf, headOf, lightAt, BEAM } from './perception.js';
import { stepLight } from './flashlight.js';
import { peekOptions, choosePeek, startPeek, peeking } from './peek.js';

const SPEED = { walk: 1.35, run: 3.4, aimWalk: 1.0, crawl: 0.35 };
const SCOUT_R = [10, 16];
// a plain step between grid cells: up a stair, down a steep slope; more is a parkour move
const PLAIN_UP = 0.6, PLAIN_DOWN = 0.8;
const FIT = ability({});
const ONCE_T = { deployDrone: 7.0, signalMove: 1.6, signalHalt: 1.6, signalDown: 1.6, signalFallBack: 2.0, throwGrenade: 1.6, throwFlash: TIMES.flash, pickup: 1.3, radio: 2.4, reload: TIMES.reload, stab: TIMES.stab, drawKnife: TIMES.toKnife, drawRifle: TIMES.toRifle, sheathKnife: TIMES.toRifle, drawSecondary: TIMES.toSecondary };
const BEARING = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const NAME = { UAV: 'the drone operator', CMD: 'the commander', MG: 'the gunner', R1: 'rifleman one', R2: 'rifleman two' };
export const teamOf = (m) => (m.squad === 'UAV' ? 'U' : m.squad === 'CMD' || m.squad === 'R1' ? 'A' : 'B');

export class SquadAI {
  constructor(host) {
    this.host = host;
    this.threat = host.threat ? host.threat.slice() : null;
    this.on = true;
    this.phase = 'bound';
    this.moving = 'A';
    this.assigned = false;
    this.t = 0;
    this.time = 0;
    this.navAge = Infinity;
    this.cs = 0.4;
    this.grenadeCd = 8;
    this.status = '';
    this.unit = host.unit ?? 'Alpha';
    this.radioQueue = [];
    this.contacted = false;
    this.goal = null; // where this team is sent (a flank); null: straight at the threat
    this.lastDown = -Infinity;
    this.silentUntil = 0;
    this.deferred = [];
    this.heardT = 0;
    this.lastSeen = -Infinity;
    this.inv = null; // investigating: { p, why, men, t }
    this.condT = 0;
    this.gear = { thermal: false, light: false };
    this.backupCalled = false;
    this.threatT = 0; // when the threat last moved
    this.holdT = 0; // how long they have held at the threat
    this.holdOff = false;
    this.pursuit = false;
    this.orderT = 0;
  }
  /** The drone operator, his drone in the air. */
  uav() {
    return this.members().find((m) => m.squad === 'UAV' && !m.dead && m.deployed && m.droneAt == null);
  }
  /** Back over the threat (the commander's call). */
  recallDrone(why) {
    const u = this.uav();
    if (!u || !u.scouting) return;
    u.scouting = false;
    u.droneGoal = null;
    const cmd = this.radioMan();
    if (cmd) this.say(cmd, `Drone, ${this.unit}, ${why}, back on the threat`, 'order');
    this.radioQueue.push({ at: this.time + 2.6, uav: true, text: `${this.unit}, drone, copy, back on the threat`, kind: 'reply' });
  }
  /** What the drone sees, for the team. */
  intel(u) {
    const T = this.threat;
    const moved = this.lastIntel && Math.hypot(T[0] - this.lastIntel[0], T[2] - this.lastIntel[2]) > 1;
    const dir = (a, b) => BEARING[((Math.round(Math.atan2(b[0] - a[0], -(b[2] - a[2])) / (Math.PI / 4)) % 8) + 8) % 8];
    let text = `${this.unit}, drone, eyes on the threat, ${this.bearing()}, ${moved ? 'it has moved ' + dir(this.lastIntel, T) : 'no movement'}`;
    const peers = friendliesOf(this);
    for (const p of peers) {
      const c = centroid(p.members().filter((m) => !m.dead));
      text += `, ${p.unit} is ${Math.round(dist2(c, T))} metres ${dir(T, c)} of it`;
    }
    this.lastIntel = T.slice();
    this.say(u, text, 'intel');
    const cmd = this.radioMan();
    if (cmd) this.radioQueue.push({ at: this.time + 3.5, text: `Drone, ${this.unit}, copy`, kind: 'reply' });
  }
  /** The drone on its search: the next point of the expanding square, a report for the last. */
  scoutStep(u) {
    const c = this.threat;
    const i = u.scoutI++;
    if (i >= SCOUT_R.length * 8) {
      u.scouting = false;
      u.droneGoal = null;
      this.say(u, `${this.unit}, drone, search complete, area clear, back on the threat`, 'intel');
      return;
    }
    const r = SCOUT_R[Math.floor(i / 8)], a = ((i % 8) * Math.PI) / 4;
    u.droneGoal = [c[0] + Math.sin(a) * r, c[1], c[2] - Math.cos(a) * r];
    if (i > 0) {
      const pr = SCOUT_R[Math.floor((i - 1) / 8)], pa = (((i - 1) % 8) * Math.PI) / 4;
      this.say(u, `${this.unit}, drone, sector ${BEARING[(i - 1) % 8]}, ${pr} metres, clear`, 'intel');
      void pa;
    }
  }
  /** The leading squad gives the orders. */
  get isLead() {
    // (the first of its own side: an enemy team on the net gives it no orders)
    const peers = (this.host.peers?.() ?? []).filter((p) => sideOf(p) === sideOf(this));
    return !peers.length || peers.find((p) => p.alive()) === this;
  }
  /** An order from the lead, carried out once acknowledged. */
  applyOrder(o) {
    if (o.kind === 'flank') this.goal = o.to;
    else if (o.kind === 'hold') this.holdOff = true;
    else if (o.kind === 'continue') this.holdOff = false;
    else if (o.kind === 'pursue') this.startPursuit();
    this.assigned = false;
    if (this.phase === 'hold' && o.kind !== 'hold') this.phase = 'bound';
  }
  startPursuit() {
    this.pursuit = true;
    this.holdOff = false;
    this.goal = null;
    for (const m of this.members()) if (!m.goingFor) {
      m.path = null;
      m.arrived = true;
    }
  }
  /** Lead: tell a team something; it answers, then does it. */
  order(peer, i, kind, text, ack, extra = {}) {
    const at = this.time + 0.4 + i * 3.2;
    this.radioQueue.push({ at, text, kind: 'order', self: false });
    peer.radioQueue.push({ at: peer.time + (at - this.time) + 2.6, text: ack, kind: 'reply', order: { kind, ...extra } });
  }
  /** The lead's view of the battle: flanks, hold off, continue. */
  command() {
    const peers = friendliesOf(this);
    const T = this.threat, me = centroid(this.members().filter((m) => !m.dead));
    const dMe = dist2(me, T);
    peers.forEach((p, i) => {
      const pc = centroid(p.members().filter((m) => !m.dead)), dP = dist2(pc, T);
      if (!p.flanked) {
        // the flank on the team's own side of the line from the lead to the threat
        p.flanked = true;
        const ax = T[0] - me[0], az = T[2] - me[2], l = Math.hypot(ax, az) || 1;
        const side = Math.sign((pc[0] - me[0]) * -az / l + (pc[2] - me[2]) * ax / l) || (i % 2 ? 1 : -1);
        const to = [T[0] - (ax / l) * 6 + (-az / l) * side * 7, T[1], T[2] - (az / l) * 6 + (ax / l) * side * 7];
        const word = BEARING[((Math.round(Math.atan2(to[0] - T[0], -(to[2] - T[2])) / (Math.PI / 4)) % 8) + 8) % 8];
        this.order(p, i, 'flank', `${p.unit}, ${this.unit}, take the ${word} flank, move up on the ${word} side`, `${p.unit}, copy, moving ${word}`, { to });
      } else if (!p.holdOff && dP < dMe - 7) {
        this.order(p, i, 'hold', `${p.unit}, ${this.unit}, hold off, wait for us to come up`, `${p.unit}, copy, holding`);
        p.holdOff = 'asked';
      } else if (p.holdOff === true && dP > dMe - 3) {
        this.order(p, i, 'continue', `${p.unit}, ${this.unit}, we are up, continue`, `${p.unit}, copy, continuing`);
        p.holdOff = 'asked-continue';
      }
    });
  }

  members() {
    return this.host.members().filter((m) => m.squad && (m.unit ?? 'Alpha') === this.unit);
  }
  alive() {
    return this.members().some((m) => !m.dead);
  }

  setThreat(p) {
    const moved = !this.threat || Math.hypot(p[0] - this.threat[0], p[2] - this.threat[2]) > 1;
    if (moved) {
      this.threatT = this.time;
      this.recallDrone('the threat has moved');
    }
    const al = this.members().filter((m) => !m.dead);
    const away = this.threat && al.length && dist2(centroid(al), p) > dist2(centroid(al), this.threat) + 4;
    this.threat = [p[0], p[1] ?? 0, p[2]];
    this.navAge = Infinity;
    this.replan();
    if (moved && this.contacted) {
      if (away && this.isLead && !this.retreating) {
        const U = this.unit;
        this.say(this.radioMan(), `${U}, threat is moving away, ${this.bearing()}, going into pursuit, all teams follow`, 'order');
        this.startPursuit();
        friendliesOf(this).forEach((x, i) =>
          x.radioQueue.push({ at: x.time + 2.8 + i * 2.6, text: `${x.unit}, copy, in pursuit`, kind: 'reply', order: { kind: 'pursue' } }));
      } else if (!away) this.report('threat');
    }
  }

  /* ---------- radio ---------- */
  /** Radio silence over: what had to wait is said now. */
  flushRadio() {
    if (this.time < this.silentUntil || !this.deferred.length) return;
    const d = this.deferred;
    this.deferred = [];
    for (const r of d) if (!r.m.dead) this.say(r.m, r.text, r.kind);
  }
  /** Radio silence for s seconds (the commander's call). */
  radioSilence(s) {
    const cmd = this.radioMan();
    if (cmd) this.say(cmd, `${this.unit}, radio silence ${Math.round(s)} seconds`, 'order');
    this.silentUntil = this.time + s;
  }
  radioMan() {
    const al = this.members().filter((m) => !m.dead && m.squad !== 'UAV');
    return al.find((m) => m.squad === 'CMD') ?? al[0];
  }
  /** Where the threat is from the squad, in words. */
  bearing() {
    const al = this.members().filter((m) => !m.dead);
    const c = centroid(al.length ? al : this.members());
    const dx = this.threat[0] - c[0], dz = this.threat[2] - c[2];
    const a = Math.atan2(dx, -dz); // north is -z
    return Math.round(Math.hypot(dx, dz)) + ' metres ' + BEARING[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
  }
  /** Key the radio and report; the other teams answer in turn. */
  report(kind, who) {
    const m = this.radioMan();
    if (!m) return;
    const U = this.unit;
    const text = {
      contact: U + ', contact, ' + this.bearing() + ', moving to engage',
      threat: U + ', threat has moved, now ' + this.bearing(),
      manDown: U + ', man down, ' + (who ?? 'one of ours') + ' is down, continuing',
    }[kind];
    this.say(m, text, kind);
    const peers = friendliesOf(this);
    if (!peers.length) this.radioQueue.push({ at: this.time + 3.2, self: true, text: U + ', no response', kind: 'none' });
    peers.forEach((p, i) => p.radioQueue.push({ at: p.time + 2.8 + i * 2.6, text: p.unit + ', copy ' + U + ', ' + (kind === 'manDown' ? 'understood, out' : 'we have it, out'), kind: 'reply' }));
  }
  say(m, text, kind) {
    if (this.time < this.silentUntil && kind !== 'manDown' && kind !== 'none') {
      this.deferred.push({ m, text, kind });
      if (m.squad === 'CMD' && !this.busy(m)) this.setAnim(m, 'signalMove');
      return;
    }
    // (the drone operator talks through his headset: his hands stay on the controller)
    // (a man down, dragging one or covering: no hand free for the radio, he speaks into the mic)
    if (m.squad !== 'UAV' && !m.down && !m.rescueRole && (!this.busy(m) || m.anim === 'crouchAim')) this.setAnim(m, 'radio');
    m.signal = { text: text.toUpperCase(), until: this.time + 3 };
    this.host.radio?.(m, text, kind);
    this.status = 'Radio: ' + text;
  }

  /** Forget the current bound (after the range changed). */
  replan() {
    for (const m of this.members()) {
      // (a strategy's moves, a rescue: theirs to redo, ai/strategy.js rethink, ai/casualty.js)
      if (m.path && !m.goingFor && this.phase !== 'strategy' && !m.rescueRole) {
        m.path = null;
        m.arrived = true;
      }
      m.coverCell = -1;
    }
    this.assigned = false;
    if (this.phase === 'hold' && !this.strategy) this.phase = 'bound';
    this.navAge = Infinity;
    rethink(this); // (the leader's strategy: looked at again, ai/strategy.js)
  }

  /* ---------- the grid ---------- */
  rebuildNav() {
    const [x0, z0, x1, z1] = this.host.bounds;
    const cs = this.cs;
    const nx = Math.max(2, Math.floor((x1 - x0) / cs)), nz = Math.max(2, Math.floor((z1 - z0) / cs));
    this.nx = nx;
    this.nz = nz;
    this.x0 = x0;
    this.z0 = z0;
    const raw = new Uint8Array(nx * nz);
    this.fy = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const x = x0 + (i + 0.5) * cs, z = z0 + (j + 0.5) * cs;
        const y = this.host.floor(x, z);
        const k = j * nx + i;
        if (y == null) {
          raw[k] = 1;
          continue;
        }
        this.fy[k] = y;
        outer: for (const [ox, oz] of [[0, 0], [0.13, 0], [-0.13, 0], [0, 0.13], [0, -0.13]])
          for (const hy of [0.5, 1.0, 1.45])
            if (this.host.solid(x + ox, y + hy, z + oz)) {
              raw[k] = 1;
              break outer;
            }
      }
    // keep a body's width off walls, where there is room for it (a corridor or a door narrower
    // than ~1.6 m they go through the middle of)
    const run = (i, j, di, dj) => {
      let n = 1;
      for (const s of [1, -1])
        for (let a = i + di * s, b = j + dj * s; a >= 0 && b >= 0 && a < nx && b < nz && !raw[b * nx + a]; a += di * s, b += dj * s) n++;
      return n;
    };
    const bl = new Uint8Array(nx * nz);
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        if (raw[j * nx + i]) {
          bl[j * nx + i] = 1;
          continue;
        }
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const a = i + di, b = j + dj;
          if (a >= 0 && b >= 0 && a < nx && b < nz && raw[b * nx + a] && run(i, j, Math.abs(di), Math.abs(dj)) >= 4) bl[j * nx + i] = 2;
        }
      }
    this.blocked = bl.map((v) => (v ? 1 : 0));
    this.solidCell = raw;
    this.buildParkour();
    // distance to the nearest wall, and the cost: cheaper alongside walls
    const d = (this.dObs = new Float32Array(nx * nz).fill(1e9));
    const q = [];
    for (let k = 0; k < nx * nz; k++)
      if (this.blocked[k]) {
        d[k] = 0;
        q.push(k);
      }
    for (let h = 0; h < q.length; h++) {
      const k = q[h], i = k % nx, j = (k / nx) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
        const kk = b * nx + a;
        if (d[kk] > d[k] + 1) {
          d[kk] = d[k] + 1;
          q.push(kk);
        }
      }
    }
    this.cost = new Float32Array(nx * nz);
    for (let k = 0; k < nx * nz; k++) this.cost[k] = d[k] <= 3 ? 1 : 1.7;
    this.computeCovers();
    analyse(this); // widths, doorways (ai/tactics.js)
  }

  /**
   * Parkour on the grid (ai/parkour.js): cells on top of something he can get onto (a low wall, a
   * crate, a platform within a jump climb of the ground round it, with room to stand) become
   * places to be (this.walk, at the height of the top), and from each cell where the ground ahead
   * is not a plain step a probe finds the move there: this.links (cell -> [{ to, geo, kind0 }]).
   */
  buildParkour() {
    const { nx, nz } = this;
    const H = this.host, raw = this.solidCell;
    const solid = (x, y, z) => H.solid(x, y, z);
    this.walk = new Uint8Array(nx * nz);
    this.raised = new Uint8Array(nx * nz);
    for (let k = 0; k < nx * nz; k++) this.walk[k] = this.blocked[k] ? 0 : 1;
    this.links = new Map();
    if (!H.solid) return;
    for (let k = 0; k < nx * nz; k++) {
      if (!raw[k]) continue;
      const i = k % nx, j = (k / nx) | 0;
      // the ground round it
      let g = Infinity;
      for (let dj = -2; dj <= 2; dj++)
        for (let di = -2; di <= 2; di++) {
          const a = i + di, b = j + dj;
          if (a >= 0 && b >= 0 && a < nx && b < nz && !raw[b * nx + a]) g = Math.min(g, this.fy[b * nx + a]);
        }
      if (g === Infinity) continue;
      const [x, , z] = this.cellPos(k);
      const top = surface(solid, x, z, this.fy[k], 2.6);
      if (!(top > g + STEP) || top - g > 2.35 || !clear(solid, x, z, top, 0.1, 1.75) || !this.standsOn(x, z, top)) continue;
      this.raised[k] = 1;
      this.walk[k] = 1;
      this.fy[k] = top;
    }
    // further in on a broad top (a platform): on from its edges at about the same height
    const q = [];
    for (let k = 0; k < nx * nz; k++) if (this.raised[k]) q.push(k);
    for (let h = 0; h < q.length; h++) {
      const k = q[h], i = k % nx, j = (k / nx) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj, kk = b * nx + a;
        if (a < 0 || b < 0 || a >= nx || b >= nz || !raw[kk] || this.raised[kk]) continue;
        const [x, , z] = this.cellPos(kk);
        const top = surface(solid, x, z, this.fy[k] - 0.3, 0.6);
        if (Math.abs(top - this.fy[k]) > 0.3 || !clear(solid, x, z, top, 0.1, 1.75) || !this.standsOn(x, z, top)) continue;
        this.raised[kk] = 1;
        this.walk[kk] = 1;
        this.fy[kk] = top;
        q.push(kk);
      }
    }
    for (let k = 0; k < nx * nz; k++) {
      if (!this.walk[k]) continue;
      const i = k % nx, j = (k / nx) | 0;
      const p = this.cellPos(k);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
        const kk = b * nx + a, dh = this.fy[kk] - this.fy[k];
        if (this.walk[kk] && dh <= PLAIN_UP && dh >= -PLAIN_DOWN) continue;
        const geo = probe(solid, p, [di, dj], { range: 1.3 });
        if (!geo || geo.type === 'wall') continue;
        const kind0 = moveFor(geo, FIT, 'run');
        if (!kind0) continue;
        const [f, up] = rootEnd(kind0, geoFor(kind0, geo));
        if (!this.standsOn(p[0] + di * f, p[2] + dj * f, p[1] + up)) continue;
        const E = [p[0] + di * f, p[1] + up, p[2] + dj * f];
        const ke = this.cellOf(E[0], E[2]);
        if (ke < 0 || ke === k || !this.walk[ke] || Math.abs(this.fy[ke] - E[1]) > 0.35) continue;
        if (!this.links.has(k)) this.links.set(k, []);
        this.links.get(k).push({ to: ke, geo, kind0 });
      }
    }
  }
  /** Does the host's own floor put a man standing at height y at (x, z) there (a top he can be on)? */
  standsOn(x, z, y) {
    const fy = this.host.floor(x, z, { p: [x, y, z] });
    return fy != null && Math.abs(fy - y) < 0.3;
  }
  /** A cell with the ground round it at about its height (a platform's top, not a wall's). */
  flatTop(k) {
    const { nx, nz } = this, i = k % nx, j = (k / nx) | 0;
    // (on top of something: room round him, not the top of a wall or a crate)
    const r = this.raised?.[k] ? 2 : 1;
    for (const [di, dj] of [[r, 0], [-r, 0], [0, r], [0, -r], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= nz) return false;
      const kk = b * nx + a;
      if (!this.walk[kk] || Math.abs(this.fy[kk] - this.fy[k]) > 0.3) return false;
    }
    return true;
  }

  computeCovers() {
    this.covers = [];
    const { nx, nz } = this;
    // higher ground (for the gunner): free cells clearly above the lowest ground
    let lo = Infinity;
    for (let k = 0; k < nx * nz; k++) if (!this.blocked[k]) lo = Math.min(lo, this.fy[k]);
    this.high = [];
    for (let k = 0; k < nx * nz; k++) if (this.walk[k] && this.fy[k] > lo + 0.6 && k % 2 === 0 && this.flatTop(k)) this.high.push({ k, p: this.cellPos(k), q: 0, high: this.fy[k] - lo });
    if (!this.threat) return;
    for (let j = 2; j < nz - 2; j++)
      for (let i = 2; i < nx - 2; i++) {
        const k = j * nx + i;
        if (this.blocked[k] || this.dObs[k] > 2) continue;
        let vx = 0, vz = 0, ns = 0;
        for (let dj = -3; dj <= 3; dj++)
          for (let di = -3; di <= 3; di++) if (this.solidCell[(j + dj) * nx + (i + di)] ?? 0) {
            vx += di;
            vz += dj;
            ns++;
          }
        const l = Math.hypot(vx, vz);
        if (l < 1e-3) continue;
        const p = this.cellPos(k);
        const tx = this.threat[0] - p[0], tz = this.threat[2] - p[2], tl = Math.hypot(tx, tz) || 1;
        const qd = (vx / l) * (tx / tl) + (vz / l) * (tz / tl);
        // a corner: the end of a wall or the edge of a crate (only a short stretch of it next to
        // him): covered towards the threat, and he can look round it
        const corner = ns <= 7;
        if (qd > 0.55) this.covers.push({ k, p, q: qd + (corner ? 0.7 : 0), corner });
      }
  }

  cellOf(x, z) {
    const i = Math.floor((x - this.x0) / this.cs), j = Math.floor((z - this.z0) / this.cs);
    return i < 0 || j < 0 || i >= this.nx || j >= this.nz ? -1 : j * this.nx + i;
  }
  cellPos(k) {
    const x = this.x0 + ((k % this.nx) + 0.5) * this.cs, z = this.z0 + (((k / this.nx) | 0) + 0.5) * this.cs;
    return [x, this.fy[k], z];
  }
  nearestFree(x, z, y) {
    const k = this.cellOf(x, z);
    if (k >= 0 && !this.blocked[k]) return k;
    // up on something (a platform, a crate) he got onto: that cell
    if (k >= 0 && y != null && this.walk?.[k] && Math.abs(this.fy[k] - y) < 0.5) return k;
    const i0 = Math.floor((x - this.x0) / this.cs), j0 = Math.floor((z - this.z0) / this.cs);
    for (let r = 1; r < 15; r++)
      for (let dj = -r; dj <= r; dj++)
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const a = i0 + di, b = j0 + dj;
          if (a < 0 || b < 0 || a >= this.nx || b >= this.nz) continue;
          if (!this.blocked[b * this.nx + a]) return b * this.nx + a;
        }
    return -1;
  }

  /**
   * A* from p0 to p1: world points, hugging walls; over, up and down obstacles where m (if given:
   * his wounds and load, ai/parkour.js ability) can do the move. The parkour links only in action
   * (alert(): a threat, something to look into, a building to clear): on a routine move (no threat,
   * a lookout, a patrol) they walk round obstacles; opts.links overrides.
   */
  route(p0, p1, m, { links: useLinks = this.alert(), avoid = null } = {}) {
    if (!this.blocked) this.rebuildNav(); // (before any contact it may not be built yet)
    // to another level (the deck, down from it): the grid is one level, so by the stairs (hosts
    // with lookouts; elsewhere ai/tactics.js clearTo takes the team between floors)
    const y0 = p0[1] ?? 0, y1 = p1[1] ?? 0;
    if (this.host.lookouts && this.host.path3d && Math.abs(y1 - y0) > 1.5) {
      const via = this.host.path3d(p0, p1);
      // a full 3D path from where he stands (the simulation's guard paths over floors and stairs,
      // a point every 0.4 m, round walls and rails): only its turns (he follows the floor between
      // them), ending on p1 when it got there (else as near as it got)
      if (via?.length > 1 && dist2(via[0], p0) < 0.3 && Math.abs((via[0][1] ?? y0) - y0) < 0.3) {
        const c = corners(via), e = c[c.length - 1];
        if (dist2(e, p1) < 1.2 && Math.abs((e[1] ?? y1) - y1) < 0.6) c[c.length - 1] = p1.slice();
        return c;
      }
      // a way by the stairs (foot ... head, then p1): to its start (or from its end) on the grid
      if (via?.length > 1) return y1 > y0 ? [...this.route(p0, via[0], m), ...via.slice(1)] : [...via.slice(0, -1), ...this.route(via[via.length - 2], p1, m)];
    }
    const { nx, nz } = this;
    const s = this.nearestFree(p0[0], p0[2], p0[1]), g = this.nearestFree(p1[0], p1[2], p1[1]);
    const ab = ability(m), links = useLinks ? this.links : null, via = new Map();
    if (s < 0 || g < 0) return [p1.slice()];
    const G = new Float32Array(nx * nz).fill(1e9), from = new Int32Array(nx * nz).fill(-1), closed = new Uint8Array(nx * nz);
    const gi = g % nx, gj = (g / nx) | 0;
    const H = (k) => {
      const dx = Math.abs((k % nx) - gi), dz = Math.abs(((k / nx) | 0) - gj);
      return dx + dz + (1.414 - 2) * Math.min(dx, dz);
    };
    const heap = [];
    const push = (k, f) => {
      heap.push([f, k]);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    G[s] = 0;
    push(s, H(s));
    while (heap.length) {
      const [, k] = pop();
      if (closed[k]) continue;
      closed[k] = 1;
      if (k === g) break;
      const i = k % nx, j = (k / nx) | 0;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const a = i + di, b = j + dj;
          if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
          const kk = b * nx + a;
          if (!this.walk[kk] || closed[kk]) continue;
          if (di && dj && (!this.walk[j * nx + a] || !this.walk[b * nx + i])) continue;
          // a plain step: no more than a stair up (a steep slope down); higher needs a move
          const dh = this.fy[kk] - this.fy[k];
          if (dh > PLAIN_UP || dh < -PLAIN_DOWN) continue;
          // (opts.avoid: an enemy at that point; the cells it sees cost more: a covered way)
          const c = G[k] + (di && dj ? 1.414 : 1) * this.cost[kk] + (avoid && exposedTo(this, avoid, this.cellPos(kk)) ? 4 : 0);
          if (c < G[kk]) {
            G[kk] = c;
            from[kk] = k;
            via.delete(kk);
            push(kk, c + H(kk));
          }
        }
      // parkour: over a wall, up onto a ledge, down off one (what he can do)
      for (const L of links?.get(k) ?? []) {
        if (closed[L.to]) continue;
        const kind = moveFor(L.geo, ab, 'run');
        if (!kind) continue;
        const c = G[k] + costOf(kind, geoFor(kind, L.geo), ab) / this.cs;
        if (c < G[L.to]) {
          G[L.to] = c;
          from[L.to] = k;
          via.set(L.to, L);
          push(L.to, c + H(L.to));
        }
      }
    }
    if (from[g] < 0 && g !== s) return [p1.slice()];
    const cells = [];
    for (let k = g; k >= 0; k = from[k]) {
      cells.push(k);
      if (k === s) break;
    }
    cells.reverse();
    // drop the points in the middle of straight runs (not where a move starts or ends: he lines
    // up on it from its start, straight at where it lands)
    const pts = [];
    let pd = null, lastFixed = false;
    for (let i = 0; i < cells.length; i++) {
      const p = this.cellPos(cells[i]);
      const fixed = via.has(cells[i]) || (i + 1 < cells.length && via.has(cells[i + 1]));
      if (via.has(cells[i])) p.move = via.get(cells[i]).kind0;
      if (i > 0 && i < cells.length - 1 && !fixed) {
        const n = this.cellPos(cells[i + 1]);
        const d = [Math.sign(n[0] - p[0]), Math.sign(n[2] - p[2])];
        if (pd && !lastFixed && d[0] === pd[0] && d[1] === pd[1]) {
          pts[pts.length - 1] = p;
          continue;
        }
        pd = d;
      } else pd = null;
      pts.push(p);
      lastFixed = fixed;
    }
    return pts;
  }

  /** In action: a threat, something to look into, a building being cleared, a breach (not routine). */
  alert() {
    return !!(this.threat || this.inv || this.clearing || this.breach);
  }

  /* ---------- per member ---------- */
  setAnim(m, a, dur) {
    if (m.trav && a !== m.trav.kind) return; // over a wall, up a ledge: that first
    if (m.anim === a && !dur) return;
    m.anim = a;
    m.animT = this.time;
    m.animDur = dur ?? ONCE_T[a];
    if (ONCE_T[a] || dur) m.animUntil = this.time + (dur ?? ONCE_T[a]);
  }
  /** A grenade or flashbang leaving the hand (thrown at m.throwTarget, or the threat). */
  release(m, T) {
    if (m.throwAt == null || this.time < m.throwAt) return;
    m.throwAt = null;
    const c = Math.cos(m.yaw), s = Math.sin(m.yaw);
    const from = [m.p[0] + -0.12 * c + 0.5 * s, m.p[1] + 1.62, m.p[2] + 0.12 * s + 0.5 * c];
    const G = m.throwTarget ?? T ?? m.p;
    m.throwTarget = null;
    const d = dist2(from, G), Tf = Math.max(0.9, Math.min(1.6, d / 12));
    const vel = [(G[0] - from[0]) / Tf, (G[1] - from[1] + 4.905 * Tf * Tf) / Tf, (G[2] - from[2]) / Tf];
    if (m.throwKind === 'flash') this.host.flashbang?.(m, from, vel);
    else this.host.grenade?.(m, from, vel);
    m.throwKind = null;
  }
  /** What the radio calls him ("rifleman two"). */
  name(m) {
    return NAME[m.squad] ?? 'rifleman';
  }
  busy(m) {
    return m.animUntil > this.time;
  }
  follow(m, pts, mode, then) {
    while (pts.length > 1 && Math.hypot(pts[0][0] - m.p[0], pts[0][2] - m.p[2]) < 0.5) pts.shift();
    m.path = pts;
    m.pathI = 0;
    m.moveMode = mode;
    m.then = then;
    m.arrived = false;
  }
  move(m, dt) {
    m.moving = false;
    m.speed = 0;
    if (m.trav?.ext) return; // (a roll the dragon's snatch carries him through: ai/dragonAir.js)
    if (m.trav) return this.traverse(m, dt);
    if (!m.path || this.busy(m)) return;
    const mode = m.crawling ? 'crawl' : m.moveMode;
    const tgt = m.path[m.pathI];
    const dx = tgt[0] - m.p[0], dz = tgt[2] - m.p[2], dist = Math.hypot(dx, dz);
    // narrow (a corridor, a gap): one behind the other; wait while a man is right ahead
    m.inFile = false;
    if (!m.group && this.width && dist > 0.05) {
      const k = this.cellOf(m.p[0], m.p[2]);
      if (k >= 0 && this.width[k] < 1.6) {
        m.inFile = true;
        const ux = dx / dist, uz = dz / dist;
        const ahead = this.members().find((o) => o !== m && !o.dead && Math.hypot(o.p[0] - m.p[0], o.p[2] - m.p[2]) < 1.7 && ((o.p[0] - m.p[0]) * ux + (o.p[2] - m.p[2]) * uz) > 0.4 && (o.moving || o.path));
        if (ahead && (m.fileWait = (m.fileWait ?? 0) + dt) < 3) {
          this.setAnim(m, 'aim');
          return;
        }
      }
    }
    m.fileWait = 0;
    // a doorway into a room ahead: the team stacks up, a flashbang goes in first (ai/tactics.js)
    if (!m.group && !this.breach && this.threat) {
      const D = doorOnPath(this, m);
      if (D) {
        const al = this.members().filter((o) => !o.dead && o.squad !== 'UAV' && !o.group && !this.host.ownMove?.(o));
        const end = m.path[m.path.length - 1];
        startBreach(this, { men: al, anchor: m.p.slice(), goal: end, leader: al.find((o) => o.squad === 'CMD') ?? m }, D.room, D.p);
      }
    }
    if (this.breach?.men.includes(m) && !m.group && !(this.breach.g?.route) && !m.stackAt) return;
    if (dist < (m.pathI === m.path.length - 1 ? 0.22 : 0.45)) {
      m.pathI++;
      if (m.pathI >= m.path.length) {
        m.path = null;
        const then = m.then;
        m.then = null;
        then?.(m);
      }
      return;
    }
    let dy = Math.atan2(dx, dz) - (m.yaw ?? 0);
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    m.yaw = (m.yaw ?? 0) + Math.max(-6 * dt, Math.min(6 * dt, dy));
    // (the weapon he carries sets his pace too, ai/weapons.js: a machine gun or the flame gun's tanks slow his run)
    let sp = SPEED[mode] * (m.speedFactor ?? 1) * gaitK(m, mode) * Math.max(0, Math.cos(dy)) ** 2;
    // a wall, a ledge or a drop ahead: over it, up it, down it (or, if he cannot, stop); only in
    // action (a threat, something to look into): on a routine move they walk round, as on patrol
    const alert = this.alert();
    if (mode !== 'crawl' && sp > 0.05 && Math.abs(dy) < 0.5 && alert) {
      const pk = this.parkourAhead(m, mode, dist);
      if (pk === 'go') return;
      // up to where the move starts, not past it (it starts there next step)
      if (pk?.near != null) sp = Math.min(sp, Math.max(0.02, pk.near) / Math.max(dt, 1e-3));
      if (pk === 'cannot') {
        m.path = null;
        m.then = null;
        m.arrived = true;
        m.cannotT = this.time;
        return;
      }
      if (!pk && this.slideIn(m, mode, dist, dy)) return;
    }
    // the ground ahead: stairs (or a steep climb) up or down; down a steep hill outdoors he slides
    let anim = mode;
    if (mode !== 'crawl' && sp > 0.05) {
      const ax = m.p[0] + Math.sin(m.yaw) * 0.5, az = m.p[2] + Math.cos(m.yaw) * 0.5;
      const ay = this.host.floor(ax, az, m);
      const slope = ay != null ? (ay - m.p[1]) / 0.5 : 0;
      m.slope = m.slope == null ? slope : m.slope + (slope - m.slope) * Math.min(1, dt * 6);
      if (m.slope < -0.75 && !(this.host.indoors?.(m.p) ?? false)) {
        anim = 'slide';
        sp = Math.max(sp, 2.6);
      } else if (m.slope > 0.3) {
        anim = 'stairsUp';
        sp *= 0.7;
      } else if (m.slope < -0.3) {
        anim = 'stairsDown';
        sp *= 0.8;
      }
    }
    const nx = m.p[0] + Math.sin(m.yaw) * sp * dt, nz = m.p[2] + Math.cos(m.yaw) * sp * dt;
    const fy = this.host.floor(nx, nz, m);
    // off an edge he did not line up for (turning at it): jump down properly, or not at all
    if (fy != null && m.p[1] - fy > DROP_MIN && mode !== 'crawl' && this.host.solid) {
      const dir = [Math.sin(m.yaw), Math.cos(m.yaw)];
      const geo = probe((x, y, z) => this.host.solid(x, y, z), m.p, dir, { range: sp * dt + 0.3 });
      if (!alert) return; // (on a routine move: no jumping down, he keeps to the plain way)
      const kind = geo?.type === 'down' ? moveFor(geo, ability(m), mode) : null;
      if (kind) return this.startMove(m, kind, geo, dir);
      if (geo?.type === 'down' && geo.room && geo.h > ability(m).drop) return; // too deep for him: he stays up here
    }
    // (on a routine move nothing higher than a stair is stepped onto: that would be a climb)
    if (!alert && fy != null && fy - m.p[1] > PLAIN_UP) return;
    m.p = [nx, fy ?? m.p[1], nz];
    m.moving = sp > 0.05;
    m.speed = sp;
    this.setAnim(m, anim);
  }
  /**
   * What is ahead as he goes (along his heading, towards a target dist m off): 'go' (a move has
   * started), 'cannot' (an obstacle he cannot get over: wounded at a ledge), { near } (one to do
   * once he has gone `near` m more, to its start), or null (nothing: walk on).
   */
  parkourAhead(m, mode, dist) {
    const H = this.host;
    if (!H.solid) return null;
    const dir = [Math.sin(m.yaw), Math.cos(m.yaw)];
    const geo = probe((x, y, z) => H.solid(x, y, z), m.p, dir, { range: Math.min(1.4, dist + 0.6) });
    if (!geo || geo.type === 'wall') return null;
    // where he is going lies on it or beyond it (not a spot in front of it)
    if (dist < geo.face + 0.05) return null;
    if (geo.type === 'up' && !geo.thin) {
      const k0 = moveFor(geo, FIT, mode);
      const e = k0 && rootEnd(k0, geoFor(k0, geo));
      if (!e || !this.standsOn(m.p[0] + dir[0] * e[0], m.p[2] + dir[1] * e[0], m.p[1] + e[1])) return null;
    }
    // a drop too deep for anyone to jump (a roof's edge, a wall): down a rope rigged there (ai/rope.js, the host's)
    if (geo.type === 'down' && !moveFor(geo, FIT, mode) && this.host.rappel) {
      if (geo.face > 0.45) return { near: geo.face - 0.35 };
      if (this.host.rappel(m, dir, geo)) return 'go';
    }
    const kind = moveFor(geo, ability(m), mode);
    if (!kind) return moveFor(geo, FIT, mode) ? 'cannot' : null;
    const pre = PK_MOVES[kind].geo.pre;
    if (geo.face > pre + 0.06) return { near: geo.face - pre };
    this.startMove(m, kind, geo, dir);
    return 'go';
  }
  /**
   * Threatened (host.dangers(m): a grenade by him, a rocket coming, rounds cracking past, a dragon
   * diving on him or its fire): a combat roll out of it (ai/evade.js), if he can and it is worth it.
   */
  dodge(m) {
    // (nor one the retreat moves: carrying a man, stringing a wire, ai/retreat.js)
    if (m.dead || m.down || m.rescueRole === 'rescuer' || m.rescueRole === 'retreat' || m.trav || !this.host.dangers) return false;
    const H = this.host;
    const rand = H.rand ?? Math.random;
    for (const t of H.dangers(m)) {
      if (!worthRolling(m, t, rand, this.time)) continue;
      const pick = pickRoll(m, t, { solid: H.solid, floor: H.floor });
      if (!pick) continue;
      if (m.throwAt != null || m.switching) continue; // (the grenade leaving his hand, a weapon half drawn)
      startRoll(m, pick, this.time, { why: t.kind });
      if (t.kind === 'grenade') m.signal = { text: 'GRENADE!', until: this.time + 2 };
      return true;
    }
    return false;
  }
  /** Start a parkour move (ai/parkour.js) along dir: m.trav, his clip. */
  startMove(m, kind, geo, dir) {
    const g = geoFor(kind, geo), dur = durFor(kind, ability(m));
    m.trav = { kind, t: 0, dur, geo: g, from: m.p.slice(), dir: dir.slice(), yaw: Math.atan2(dir[0], dir[1]) };
    m.yaw = m.trav.yaw;
    m.anim = kind;
    m.animT = this.time;
    m.animDur = dur;
    m.animUntil = this.time + dur;
    m.moving = true;
  }
  /** On the move: carried along its root path; at its end, back on the floor and on along his path. */
  traverse(m, dt) {
    const T = m.trav;
    if (m.dead) {
      m.trav = null;
      return;
    }
    if (T.roll) {
      // a combat roll (ai/evade.js): along its path on the floor; then down in a crouch (or flat), aiming
      if (!stepRoll(m, dt, (x, z, who) => this.host.floor(x, z, who))) return;
      // (the body meeting the ground through the roll: sim/impact.js, the host's)
      if (!m.dead) this.host.landing?.(m, { speed: T.kind === 'diveProne' ? 3.2 : 2.4, roll: true, name: 'a roll' });
      if (T.kind === 'diveProne') this.setAnim(m, 'proneAim', 1.6);
      else this.setAnim(m, 'crouchAim', 0.5);
      return;
    }
    T.t += dt;
    const u = Math.min(1, T.t / T.dur);
    const [f, up] = rootAt(T.kind, u, T.geo);
    const px = m.p[0], pz = m.p[2];
    m.p = [T.from[0] + T.dir[0] * f, T.from[1] + up, T.from[2] + T.dir[1] * f];
    m.yaw = T.yaw;
    m.moving = true;
    m.speed = Math.hypot(m.p[0] - px, m.p[2] - pz) / Math.max(dt, 1e-3);
    if (u < 1) return;
    m.trav = null;
    m.animUntil = 0;
    const fy = this.host.floor(m.p[0], m.p[2], m);
    if (fy != null) m.p[1] = fy;
    // a drop (or a vault down the far side): he lands from its height (a roll spreads it: sim/impact.js)
    const fall = T.kind.startsWith('drop') ? T.geo?.h ?? 1 : Math.max(0, T.geo?.drop ?? 0) + (T.kind.startsWith('vault') ? 0.5 : 0);
    if (fall > 0.3) this.host.landing?.(m, { height: fall, roll: T.kind === 'dropRoll', name: T.kind });
    if (!m.path) return;
    // past the points the move took him over (its start, the top of the wall)
    while (m.pathI < m.path.length) {
      const q = m.path[m.pathI], d = Math.hypot(q[0] - m.p[0], q[2] - m.p[2]);
      const ahead = (q[0] - m.p[0]) * T.dir[0] + (q[2] - m.p[2]) * T.dir[1];
      if (d < 0.5 || (ahead < -0.05 && d < 2.5)) m.pathI++;
      else break;
    }
    if (m.pathI >= m.path.length) {
      m.path = null;
      const then = m.then;
      m.then = null;
      then?.(m);
    }
  }
  /**
   * Running the last stretch to cover that is low (he would kneel behind it), under fire, on
   * clear flat ground: a baseball slide in behind it.
   */
  slideIn(m, mode, dist, dy) {
    if (mode !== 'run' || !this.contacted || m.coverCell == null || m.coverCell < 0 || m.pathI !== m.path.length - 1) return false;
    if (dist < 1.9 || dist > 3.0 || Math.abs(dy) > 0.25 || m.slidT === m.coverCell || ability(m).wounded || ability(m).no?.slideCover) return false;
    const H = this.host, c = m.path[m.path.length - 1], T = this.threat;
    if (!H.solid || !T) return false;
    const tx = T[0] - c[0], tz = T[2] - c[2], tl = Math.hypot(tx, tz) || 1;
    let low = false;
    for (const r of [0.4, 0.6, 0.8]) {
      const x = c[0] + (tx / tl) * r, z = c[2] + (tz / tl) * r;
      if (H.solid(x, c[1] + 0.6, z)) {
        low = !H.solid(x, c[1] + 1.35, z);
        break;
      }
    }
    if (!low) return false;
    const dir = [Math.sin(m.yaw), Math.cos(m.yaw)];
    if (probe((x, y, z) => H.solid(x, y, z), m.p, dir, { range: dist })) return false;
    m.slidT = m.coverCell;
    this.startMove(m, 'slideCover', { d: dist }, dir);
    return true;
  }
  face(m, p, dt, rate = 2.4) {
    let dy = Math.atan2(p[0] - m.p[0], p[2] - m.p[2]) - (m.yaw ?? 0);
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    m.yaw = (m.yaw ?? 0) + Math.max(-rate * dt, Math.min(rate * dt, dy));
  }
  armed(m) {
    return !m.unarmed && m.canFire !== false;
  }

  /** Each bound: send the moving team to cover nearer the threat. */
  /**
   * The host's lookouts (raised places reached by stairs), as cover candidates for the gunner:
   * the ones that see T (from the eye up there). k < 0: not a grid cell.
   */
  lookoutsFor(T) {
    const L = this.host.lookouts?.() ?? [];
    return L.filter((p) => !T || (this.host.lineOfSight?.(p, T) ?? true)).map((p, i) => ({ k: -1 - i, p: p.slice(), q: 1 }));
  }
  /**
   * Before contact: one rifleman (R1, else R2) climbs to the lookout that sees the most of the
   * ground round the team and watches from up there (he sees over the walls).
   */
  postLookout() {
    if (this.lookoutPosted || this.inv) return;
    const L = this.host.lookouts?.() ?? [];
    const al = this.members().filter((m) => !m.dead);
    if (!L.length || !al.length) return (this.lookoutPosted = true);
    const m = al.find((x) => x.squad === 'R1' && !this.busy(x) && !x.group) ?? al.find((x) => x.squad === 'R2' && !this.busy(x) && !x.group);
    if (!m) return;
    const c = centroid(al), [x0, z0, x1, z1] = this.host.bounds;
    // how much he sees from there: a ring of points out over the ground
    const view = (p) => {
      let n = 0;
      for (let a = 0; a < 16; a++)
        for (const r of [6, 11, 16]) {
          const q = [p[0] + Math.cos((a * Math.PI) / 8) * r, 0, p[2] + Math.sin((a * Math.PI) / 8) * r];
          if (q[0] < x0 || q[0] > x1 || q[2] < z0 || q[2] > z1) continue;
          if (this.host.lineOfSight?.(p, q) ?? true) n++;
        }
      return n;
    };
    let best = null, bs = -Infinity;
    for (const p of L) {
      const d = dist2(p, c);
      if (d > 25) continue;
      const sc = view(p) - d * 0.3;
      if (sc > bs) (bs = sc), (best = p);
    }
    this.lookoutPosted = true;
    if (!best) return;
    m.lookout = true;
    m.cover = best.slice();
    this.say(m, `${this.unit}, ${NAME[m.squad]}, going up top for a look`, 'none');
    this.follow(m, this.route(m.p, best, m), 'run', (q) => {
      q.arrived = true;
      this.say(q, `${this.unit}, ${NAME[q.squad]}, up top, watching the area`, 'intel');
    });
  }

  assignBound() {
    const al = this.members().filter((m) => !m.dead && !m.down && !m.rescueRole);
    const movers = al.filter((m) => teamOf(m) === this.moving && !m.goingFor), over = al.filter((m) => teamOf(m) !== this.moving);
    this.assigned = true;
    this.t = 0;
    if (!movers.length) {
      this.moving = this.moving === 'A' ? 'B' : 'A';
      this.assigned = false;
      return;
    }
    const oc = centroid(over.length ? over : al), T = this.goal ?? this.threat;
    const taken = new Set(al.filter((m) => !movers.includes(m) && m.coverCell >= 0).map((m) => m.coverCell));
    const others = this.host.members().filter((o) => o.squad && (o.unit ?? 'Alpha') !== this.unit && !o.dead && o.cover).map((o) => o.cover);
    // the gunner on higher ground sees further: cover he can see is easier to judge
    const mg = al.find((m) => m.squad === 'MG' && !movers.includes(m));
    const mgHigh = mg && this.high?.length && mg.p[1] > Math.min(...al.map((m) => m.p[1])) + 0.5;
    for (const u of movers) {
      const du = dist2(u.p, T);
      // up on a lookout that sees the threat, the team within reach: he stays there, watching
      if (u.lookout && u.p[1] > 1.5 && (this.host.lineOfSight?.(u.p, T) ?? true) && dist2(u.p, oc) < 24) {
        u.arrived = true;
        continue;
      }
      const looks = u.squad === 'MG' ? this.lookoutsFor(T) : [];
      if (u.squad === 'MG' && (this.high?.length || looks.length)) {
        // higher ground a little behind the team, within reach: a lookout up the stairs (one
        // that sees the threat) or a rise in the ground
        const cy = Math.min(...al.map((m) => m.p[1]));
        let hb = null, hs = -1e9;
        for (const c of [...(this.high ?? []), ...looks]) {
          if (c.k >= 0 && taken.has(c.k)) continue;
          const tr = dist2(c.p, u.p), dc = dist2(c.p, T);
          if (tr > (c.k < 0 ? 22 : 14) || dc < dist2(oc, T) - 3) continue;
          const sc = 3 * (c.p[1] - cy) - Math.abs(tr - 6) * (c.k < 0 ? 0.05 : 0.2) - Math.max(0, dist2(oc, T) - dc) * 0.5 - (c.k < 0 && dist2(oc, c.p) > 24 ? 50 : 0);
          if (sc > hs) (hs = sc), (hb = c);
        }
        if (hb && hs > 0) {
          if (hb.k >= 0) taken.add(hb.k);
          u.coverCell = hb.k >= 0 ? hb.k : -1;
          u.cover = hb.p.slice();
          u.highGround = true;
          u.lookout = hb.k < 0;
          this.follow(u, this.route(u.p, hb.p, u), 'run', (m) => {
            m.arrived = true;
            m.fireT = 0.6;
            this.say(m, m.lookout ? `${this.unit}, gunner, up top, I have eyes on the whole area and your backs` : `${this.unit}, gunner, on high ground, I have eyes on the area and your backs`, 'intel');
          });
          continue;
        }
      }
      let best = null, bs = -1e9;
      for (const c of this.covers) {
        if (taken.has(c.k)) continue;
        const dc = dist2(c.p, T), prog = du - dc;
        if (prog < 1.5 || dc < 3) continue;
        const travel = dist2(c.p, u.p);
        if (travel > 9.5 || dist2(c.p, oc) > 11) continue;
        if ([...taken].some((k) => dist2(this.cellPos(k), c.p) < 1.3) || others.some((o) => dist2(o, c.p) < 1.3)) continue;
        const sc = prog - Math.abs(travel - 5) * 0.35 + c.q * 1.5 - (u.squad === 'MG' ? prog * 0.3 : 0) + (mgHigh && dist2(c.p, mg.p) < 16 ? 0.4 : 0);
        if (sc > bs) {
          bs = sc;
          best = c;
        }
      }
      u.lookout = false;
      u.highGround = false;
      let dest;
      if (best) {
        taken.add(best.k);
        u.coverCell = best.k;
        dest = best.p;
      } else {
        u.coverCell = -1;
        const d = [T[0] - u.p[0], T[2] - u.p[2]], l = Math.hypot(...d);
        if (l < 4) {
          u.arrived = true;
          continue;
        }
        const k = this.nearestFree(u.p[0] + (d[0] / l) * 3.5, u.p[2] + (d[1] / l) * 3.5);
        dest = k >= 0 ? this.cellPos(k) : u.p.slice();
      }
      const path = this.route(u.p, dest, u);
      let L = 0, pr = u.p;
      for (const p of path) {
        L += dist2(p, pr);
        pr = p;
      }
      u.cover = [dest[0], dest[1], dest[2]];
      this.follow(u, path, L > 7 ? 'run' : 'aimWalk', (m) => {
        m.arrived = true;
        m.fireT = 0.6 + Math.random();
      });
    }
  }

  /**
   * A peek (ai/peek.js): in cover, the enemy out of sight a while (seen before, lost since), behind
   * a low wall (over it) or at the edge of a wall (round it, or slicing the pie): up or out for a
   * moment, his eye where the peek puts it (ai/perception.js), so the senses find the enemy again
   * if he is there, and he shows his head while it lasts. The experienced: shorter, irregular.
   */
  tryPeek(m, T) {
    if (!this.host.solid || !T || m.crawling || m.loadout === 'torch' || !m.arrived || m.squad === 'UAV') return false;
    if (!(this.lastSeen > -Infinity) || this.time - this.lastSeen < 2.5) return false;
    if (this.time < (m.peekNext ?? 0)) return false;
    const opts = peekOptions((x, y, z) => !!this.host.solid(x, y, z), m.p, T);
    const c = choosePeek(m, opts);
    if (!c) {
      m.peekNext = this.time + 1.5; // (looked for a place to peek from: none; again in a while)
      return false;
    }
    startPeek(m, c, this.time);
    this.setAnim(m, c.clip, c.dur);
    return true;
  }
  /** How far the team can see (m), with the gear they have on. */
  sight() {
    const v = this.host.visibility?.() ?? 60;
    return this.gear.thermal ? Math.max(v * 2.5, 45) : this.host.dark?.() && !this.gear.light ? Math.min(v, 14) : v;
  }
  /** Is the enemy (or might it be) close and unaware of us? Then stay dark and quiet. */
  stealthy() {
    return !this.contacted || this.time - this.lastSeen > 12;
  }
  /**
   * Send two men to look at p (a noise, a last known position, the operator's order). A blast
   * (urgent) brings the whole team running, and they search round the place for a while.
   */
  investigate(p, why = 'location', { urgent = false } = {}) {
    const al = this.members().filter((m) => !m.dead && m.squad !== 'UAV');
    // on another floor of a building: the whole team, clearing floor by floor (ai/tactics.js)
    const c0 = al.length ? centroid(al) : null;
    if (c0 && Math.abs((p[1] ?? c0[1]) - c0[1]) > 2 && this.host.path3d && !this.clearing && (this.host.indoors?.(p) ?? true)) {
      if (!this.blocked || this.navAge === Infinity) {
        this.rebuildNav();
        this.navAge = 0;
      }
      this.inv = { p: p.slice(), why, men: al, t: this.time, look: 0, clearing: true };
      if (clearTo(this, p, why, () => this.endInvestigation(true))) return;
      this.inv = null;
    }
    const men = al.filter((m) => m.squad === 'R1' || m.squad === 'R2');
    let pick = urgent ? al : (men.length ? men : al.filter((m) => m.squad !== 'CMD')).slice(0, 2);
    if (!pick.length) pick = al.slice(0, 1); // alone: he goes himself
    if (this.inv) for (const m of this.inv.men) if (!pick.includes(m)) m.path = null;
    if (!pick.length) return;
    if (!this.blocked || this.navAge === Infinity) {
      this.rebuildNav();
      this.navAge = 0;
    }
    this.inv = { p: p.slice(), why, men: pick, t: this.time, look: 0, urgent, searchUntil: urgent ? this.time + 20 : 0 };
    const cmd = this.radioMan();
    const who = pick.map((m) => NAME[m.squad]).join(' and ');
    const c = centroid(al);
    const dx = p[0] - c[0], dz = p[2] - c[2];
    const where = Math.round(Math.hypot(dx, dz)) + ' metres ' + BEARING[((Math.round(Math.atan2(dx, -dz) / (Math.PI / 4)) % 8) + 8) % 8];
    if (cmd) {
      if (this.stealthy() && this.time >= this.silentUntil) {
        this.say(cmd, `${this.unit}, ${why} ${where}, ${who} investigate, radio silence thirty seconds`, 'order');
        this.silentUntil = this.time + 30;
      } else if (this.time < this.silentUntil) this.setAnim(cmd, 'signalMove');
      else this.say(cmd, `${this.unit}, ${why} ${where}, ${who} investigate`, 'order');
    }
    pick.forEach((m, i) => {
      const a = (i / pick.length) * Math.PI * 2;
      const to = urgent ? [p[0] + Math.cos(a) * 2, p[1], p[2] + Math.sin(a) * 2] : [p[0] + (i ? 1.2 : -1.2), p[1], p[2]];
      m.coverCell = -1;
      m.cover = to;
      this.follow(m, this.route(m.p, to, m), urgent ? 'run' : 'aimWalk', (q) => (q.arrived = true));
      m.aimAt = p;
    });
  }
  /** Sightings, noises, losing contact; the commander's calls on gear, silence and backup. */
  senses(dt) {
    const H = this.host;
    const al = this.members().filter((m) => !m.dead);
    if (!al.length) return;
    // sightings (ai/perception.js): each man from his eye (crouched, standing, peeking), as far as
    // the weather and the dark let him (lights: his own beam on it, or the enemy's light on), his
    // field of view, noticing it over a moment (sooner close and plain)
    const range = this.sight();
    const now = this.time;
    const dark = !!H.dark?.();
    for (const m of al) if (m.peek) peeking(m, now);
    let seen = null, nSeen = 0;
    this.seen = [];
    for (const h of H.hostiles?.() ?? []) {
      if (h.dead) continue;
      let spot = null;
      for (const m of al) {
        const eye = eyeOf(m, now), at = headOf(h, now);
        let R = range;
        if (dark && !this.gear.thermal) {
          if (h.lightOn) R = Math.max(R, h.beam && lightAt([{ ...h.beam, range: BEAM.into, cone: (h.beam.cone ?? BEAM.cone) * 1.6 }], eye) > 0 ? BEAM.into : BEAM.glow);
          if (m.lightOn && m.beam && lightAt([m.beam], at) > 0) R = Math.max(R, m.beam.range ?? BEAM.range);
        }
        const los = H.sightLine ? (a, b) => H.sightLine(a, b) : () => H.lineOfSight?.(m.p, h.p) ?? true;
        const r = perceive(m, h, dt, { now, range: R, los, light: 1, eye, at, expect: this.threat, prof: senseProfile(m, 'soldier') });
        if (r.seen && (!spot || r.d < spot.d)) spot = { m, d: r.d };
      }
      if (!spot) continue;
      spot = spot.m;
      nSeen++;
      this.seen.push(h);
      h.marked = true;
      if (!seen || dist2(spot.p, h.p) < dist2(spot.p, seen.p)) seen = h;
    }
    if (seen) {
      this.lastSeen = this.time;
      if (this.inv) this.endInvestigation(false);
      if (this.clearing) {
        for (const g of [...(this.groups ?? [])]) endGroup(this, g);
        this.clearing = null;
      }
      if (this.split) joinUp(this); // contact: one team again
      if (!this.threat || dist2(this.threat, seen.p) > 1.5) {
        if (!this.threat) {
          this.threat = seen.p.slice();
          this.contacted = false; // reported below as a contact
          this.navAge = Infinity;
          this.silentUntil = 0;
        } else this.setThreat(seen.p.slice());
      }
    } else if (this.threat && this.lastSeen > -Infinity && this.time - this.lastSeen > 25 && !this.inv) {
      const last = this.threat;
      const cmd = this.radioMan();
      if (cmd) this.say(cmd, `${this.unit}, lost contact, checking the last known position`, 'order');
      this.threat = null;
      this.lastSeen = -Infinity;
      this.investigate(last, 'last known position');
    }
    // noises within earshot (gunfire carries far, a dropped crate not)
    for (const n of H.noises?.() ?? []) {
      if (n.time <= this.heardT) continue;
      this.heardT = Math.max(this.heardT, n.time);
      if (n.squad === this.unit || (n.source && n.source.unit === this.unit)) continue;
      // heard (ai/perception.js): as far as it carries to the commander's ears, less through walls;
      // where it came from only roughly; too far off to go and look: they note it and stay
      const c = centroid(al);
      const ear = this.radioMan() ?? al[0];
      const prof = senseProfile(ear, 'soldier');
      const heard = hears(ear, n, { at: [c[0], n.p[1], c[2]], prof, solid: H.hearWalls === false ? null : H.solid });
      if (!heard) continue;
      if (this.threat) continue; // busy with the threat they have
      if (heard.d > prof.investigate) continue;
      if (n.kind === 'explosion' && !this.inv?.urgent) this.investigate(heard.p, 'explosion', { urgent: true });
      else if (!this.inv) this.investigate(heard.p, 'noise');
    }
    // the investigators: look round where they got to; nothing there, come back
    if (this.inv?.urgent && this.time < this.inv.searchUntil) {
      // searching round the place of the blast: each man on to another spot near it
      const I = this.inv;
      for (const m of I.men) {
        if (m.dead || m.path || this.busy(m) || H.ownMove?.(m)) continue;
        const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 3.5;
        const to = [I.p[0] + Math.cos(a) * r, I.p[1], I.p[2] + Math.sin(a) * r];
        m.cover = to;
        this.follow(m, this.route(m.p, to, m), 'aimWalk', (q) => (q.arrived = true));
      }
    } else if (this.inv?.clearing) {
      // clearing a building: tactics.js moves them (stepClearing)
    } else if (this.inv) {
      const I = this.inv;
      if (I.men.every((m) => m.dead || m.arrived)) {
        I.look += dt;
        for (const m of I.men) if (!m.dead) this.setAnim(m, 'aim');
        if (I.look > 4) this.endInvestigation(true);
      } else if (this.time - I.t > 40) this.endInvestigation(true);
    }
    // gear: thermals in poor visibility, lights in the dark unless that gives them away
    this.condT -= dt;
    if (this.condT <= 0) {
      this.condT = 6;
      const v = H.visibility?.() ?? 60;
      const cmd = this.radioMan();
      const wantT = v < 40, wantL = !!H.dark?.() && !this.stealthy() && !wantT;
      const calls = [];
      if (wantT !== this.gear.thermal) calls.push(wantT ? 'switch to thermals' : 'thermals off');
      if (wantL !== this.gear.light) calls.push(wantL ? 'lights on' : this.stealthy() ? 'lights off, do not give away our position' : 'lights off');
      this.gear = { thermal: wantT, light: wantL };
      for (const m of this.members()) {
        m.thermal = wantT && m.squad !== 'UAV';
        m.light = wantL;
      }
      this.searchLights = !!H.dark?.() && !wantT;
      if (calls.length && cmd) {
        if (this.time < this.silentUntil) this.setAnim(cmd, 'signalDown');
        else this.say(cmd, `${this.unit}, ${calls.join(', ')}`, 'order');
      }
    }
    // each man's light (ai/flashlight.js): the weapon's, or the hand torch from his belt if he has a
    // hand free; on when the team has lights on, and for the men searching in the dark (a last
    // known position, a blast) though the team keeps dark; the torch drawn and put away by hand
    const searching = this.inv && (this.inv.urgent || this.inv.why === 'last known position' || this.inv.clearing);
    for (const m of al) {
      if (m.squad === 'UAV') continue;
      const want = !!m.light || (this.searchLights && !!searching && this.inv.men.includes(m));
      const act = stepLight(m, want, dt, 1 / Math.max(0.5, skillOf(m).reload));
      if (act && !this.busy(m) && !m.path && !m.trav) this.setAnim(m, act, 0.7);
    }
    // backup: two men down, or more of them than of us standing
    const down = this.members().filter((m) => m.dead).length;
    if (!this.backupCalled && (down >= 2 || nSeen >= 3 || nSeen > al.length)) {
      const peers = friendliesOf(this);
      const cmd = this.radioMan();
      if (cmd) {
        this.backupCalled = true;
        const c = centroid(al);
        this.silentUntil = 0;
        this.say(cmd, `${this.unit}, requesting backup, ${down} down, ${nSeen} hostiles`, 'order');
        if (!peers.length) this.radioQueue.push({ at: this.time + 3.2, self: true, text: `${this.unit}, no response`, kind: 'none' });
        peers.forEach((p, i) => p.radioQueue.push({ at: p.time + 2.8 + i * 2.6, text: `${p.unit}, copy ${this.unit}, on our way`, kind: 'reply', order: { kind: 'flank', to: c } }));
      }
    }
  }
  endInvestigation(nothing) {
    const I = this.inv;
    this.inv = null;
    if (!I) return;
    const cmd = this.radioMan();
    const back = centroid(this.members().filter((m) => !m.dead && !I.men.includes(m)));
    for (const m of I.men) {
      if (m.dead) continue;
      m.cover = null;
      if (nothing && back) this.follow(m, this.route(m.p, [back[0] + (Math.random() - 0.5) * 3, back[1], back[2] + (Math.random() - 0.5) * 3], m), 'aimWalk', (q) => (q.arrived = true));
    }
    if (nothing && cmd) {
      const who = I.men.find((m) => !m.dead) ?? cmd;
      // (held back while radio silence lasts)
      this.say(who, `${this.unit}, nothing found at the ${I.why}, coming back`, 'intel');
    }
  }

  step(dt) {
    this.time += dt;
    const ms = this.members();
    if (!ms.length) return;
    // where they started (a rally point to fall back on, ai/retreat.js); their wires at the doors
    this.home ??= centroid(ms);
    stepTraps(this);
    // no threat yet: listen, look, send men to investigate; hold where they are
    if (this.on) this.senses(dt);
    stepGroups(this, dt);
    stepClearing(this);
    if (this.breach && !this.breach.g?.route) breachStep(this, this.breach.g, dt);
    if (!this.threat) {
      if (this.on && this.time > 1.5) this.postLookout();
      for (const m of ms) {
        if (m.dead || this.host.ownMove?.(m)) continue;
        m.squadInit ??= (m.arrived = true, m.grenades = 2, m.coverCell = -1, m.track = [], true);
        kit(m);
        this.release(m, null);
        if (!this.busy(m)) manage(this, m, dt, this.host.hostiles?.() ?? []);
        this.dodge(m);
        this.move(m, dt);
        if (!m.path && !this.busy(m) && !this.inv?.men.includes(m) && !m.group) {
          if (this.inv) this.face(m, this.inv.p, dt);
          this.setAnim(m, m.squad === 'UAV' ? 'crouch' : 'crouchAim');
        }
        const last = m.track[m.track.length - 1];
        if (!last || Math.hypot(last[0] - m.p[0], last[1] - m.p[2]) > 0.25) m.track.push([m.p[0], m.p[2]]);
      }
      // (a friendly team's retreat called in: answered and acted on with no contact of their own,
      // ai/retreatRadio.js)
      for (const r of this.radioQueue.filter((q) => q.fn && this.time >= q.at)) {
        this.radioQueue.splice(this.radioQueue.indexOf(r), 1);
        const m = this.radioMan(), t = m ? r.fn(this, m, r) : null;
        if (typeof t === 'string') this.say(m, t, r.kind);
      }
      this.flushRadio();
      return;
    }
    this.navAge += dt;
    if (this.navAge > 8) {
      this.rebuildNav();
      this.navAge = 0;
    }
    const al = ms.filter((m) => !m.dead);
    for (const m of ms) {
      m.aimAt = this.threat;
      if (m.dead) {
        if (m.trav) {
          m.trav = null;
          const fy = this.host.floor(m.p[0], m.p[2], m);
          if (fy != null) m.p[1] = fy;
        }
        m.anim = 'die';
        m.path = null;
        m.moving = false;
        continue;
      }
      if (this.host.ownMove?.(m)) continue;
      m.squadInit ??= (m.yaw = Math.atan2(this.threat[0] - m.p[0], this.threat[2] - m.p[2]), m.arrived = true, m.grenades = 2, m.coverCell = -1, m.track = [], true);
      m.track ??= [];
      kit(m);
      this.dodge(m);
      this.move(m, dt);
      // the trail behind them
      const last = m.track[m.track.length - 1];
      if (!last || Math.hypot(last[0] - m.p[0], last[1] - m.p[2]) > 0.25) {
        m.track.push([m.p[0], m.p[2]]);
        if (m.track.length > 160) m.track.shift();
      }
    }
    casualties(this, al);
    // a man down: go and get him, one covering (ai/casualty.js)
    if (this.on) stepCasualties(this, al, dt);
    for (const m of ms)
      if (m.dead && !m.reportedDown) {
        m.reportedDown = true;
        if (this.contacted && al.length) this.report('manDown', NAME[m.squad]);
        this.lastDown = this.time;
        this.recallDrone('man down');
      }
    this.flushRadio();
    for (let i = this.radioQueue.length - 1; i >= 0; i--) {
      const r = this.radioQueue[i];
      if (this.time < r.at) continue;
      this.radioQueue.splice(i, 1);
      const m = r.uav ? this.uav() : this.radioMan();
      if (!m) continue;
      // (a call worked out when it is made: ai/retreatRadio.js; null: nothing to say)
      if (r.fn) {
        const t = r.fn(this, m, r);
        if (t === null) continue;
        if (typeof t === 'string') r.text = t;
      }
      if (r.scout) {
        m.scouting = true;
        m.scoutI = 0;
        m.scoutT = 0;
      }
      if (r.self) {
        m.signal = { text: r.text.toUpperCase(), until: this.time + 2 };
        this.host.radio?.(m, r.text, r.kind);
      } else this.say(m, r.text, r.kind);
      if (r.order) {
        if (r.order.kind === 'hold') this.holdOff = 'asked';
        this.applyOrder(r.order);
      }
    }
    if (!this.on || !al.length) return;
    if (!this.contacted && this.time > 0.6) {
      this.contacted = true;
      this.report('contact');
    }
    this.t += dt;
    this.grenadeCd -= dt;
    this.orderT -= dt;
    if (this.contacted && this.isLead && !this.retreating && this.orderT <= 0) {
      this.orderT = 3;
      this.command();
    }
    // the leader's fighting strategy (ai/strategy.js): flank, envelop, bound, defend or withdraw
    if (this.on && this.useStrategy !== false && !this.goal) stepStrategy(this, dt);
    if (this.pursuit) {
      // run after it, spread out; close enough: bound again
      const c = centroid(al);
      if (dist2(c, this.threat) < 9) {
        this.pursuit = false;
        this.assigned = false;
        this.phase = 'bound';
      } else
        al.forEach((m, i) => {
          if (m.path || this.busy(m) || m.dead) return;
          const a = (i / al.length) * Math.PI * 2;
          const to = [this.threat[0] + Math.cos(a) * 7, this.threat[1], this.threat[2] + Math.sin(a) * 7];
          this.follow(m, this.route(m.p, to, m), 'run', (q2) => (q2.arrived = true));
        });
    }
    const T = this.threat;
    const cmd = al.find((m) => m.squad === 'CMD') ?? al[0];
    for (const m of al) {
      if (this.host.ownMove?.(m)) continue;
      // down wounded, or in a rescue (fetching him, covering): ai/casualty.js has him (falling
      // back, moving, carrying, wiring a door: ai/retreat.js, rescueRole 'retreat')
      if (m.down || m.rescueRole) continue;
      // thrown or knocked down hand-to-hand (ai/melee.js): on his back, then up again
      if (stepKnocked(m, this.time)) {
        m.path = null;
        continue;
      }
      // blinded and deafened by a flashbang: he can do nothing for a few seconds
      if (m.stunnedUntil && m.stunnedUntil > (this.host.now?.() ?? this.time)) {
        m.path = null;
        this.setAnim(m, 'crouch');
        continue;
      }
      this.release(m, T);
      if (m.droneAt != null && this.time >= m.droneAt) {
        m.droneAt = null;
        this.host.droneLaunch?.(m, T);
        this.say(m, `${this.unit}, drone is up, eyes on the threat`, 'drone');
      }
      if (this.busy(m)) {
        if (m.anim === 'throwGrenade') this.face(m, T, dt, 4);
        continue;
      }
      if (m.group) continue;
      if (m.squad === 'UAV') {
        // the drone operator: deploy once in contact, then fly it from where he kneels
        if (!m.deployed && this.contacted && !m.path) {
          m.deployed = true;
          this.face(m, T, 1, 10);
          this.setAnim(m, 'deployDrone');
          m.droneAt = this.time + 6.0;
        } else if (m.deployed && m.droneAt == null) {
          this.setAnim(m, m.scouting ? 'droneScout' : 'droneControl');
          if (m.scouting) {
            m.scoutT = (m.scoutT ?? 0) - dt;
            if (m.scoutT <= 0) {
              m.scoutT = 5;
              this.scoutStep(m);
            }
          } else {
            m.intelT = (m.intelT ?? 6) - dt;
            if (m.intelT <= 0) {
              m.intelT = 14;
              this.intel(m);
            }
          }
        } else if (!m.deployed) this.setAnim(m, 'crouchAim');
        continue;
      }
      // his weapon: reloading, switching, out of ammo, the knife in close combat
      if (!m.goingFor && manage(this, m, dt, this.host.hostiles?.() ?? [])) continue;
      if (m.anim === 'pickup' && m.goingFor) {
        this.host.pickup?.(m);
        m.goingFor = null;
        m.unarmed = false;
      }
      // no rifle: go and get it
      if (m.unarmed && !m.goingFor && !m.path) {
        const r = this.host.rifleAt?.(m);
        if (r) {
          m.goingFor = r;
          const d = [r[0] - m.p[0], r[2] - m.p[2]], l = Math.hypot(...d) || 1;
          this.follow(m, this.route(m.p, [r[0] - (d[0] / l) * 0.45, r[1], r[2] - (d[1] / l) * 0.45], m), 'run', (q) => {
            this.face(q, r, 1, 10);
            this.setAnim(q, 'pickup', 1.3 * skillOf(q).reload); // (an old hand is quicker about it)
          });
        }
      }
      if (m.path) continue;
      // covering: crouched, facing the threat, bursts
      this.face(m, T, dt);
      if (!this.armed(m)) {
        this.setAnim(m, m.crawling ? 'proneAim' : 'crouch');
        continue;
      }
      // lost sight of the enemy, in cover behind a low wall or at a corner: a peek to find him again
      if (this.tryPeek(m, T)) continue;
      const covering = teamOf(m) !== this.moving || this.phase === 'hold' || this.phase === 'strategy';
      // the flame trooper: up on his feet and flame when it is close enough; otherwise he covers
      if (m.loadout === 'torch') {
        const near = dist2(m.p, T) < 9 && !m.crawling;
        if (near && covering) {
          this.setAnim(m, 'flame');
          m.flameT = (m.flameT ?? 0) - dt;
          if (m.flameT <= 0) {
            m.flameT = 0.15;
            this.host.flame?.(m, T);
          }
        } else this.setAnim(m, m.crawling ? 'proneAim' : 'crouchAim');
        continue;
      }
      const lie = m.crawling;
      const AIM = lie ? 'proneAim' : 'crouchAim', SHOOT = lie ? 'proneShoot' : 'crouchShoot';
      m.fireT = (m.fireT ?? 1) - dt;
      // his weapon's recoil (ai/recoil.js): the fire mode's rounds at its rate, the climb between them
      const R = recoilOf(m);
      stepClimb(m, R, dt, false, skillOf(m).control);
      if (m.anim === SHOOT) {
        m.shotT = (m.shotT ?? 0) - dt;
        if (m.shotT <= 0 && m.rounds > 0 && canShoot(m)) {
          m.rounds--;
          m.shotT = R.gap;
          spend(m);
          const aim = this.seen?.length ? this.seen.reduce((a, h) => (dist2(h.p, m.p) < dist2(a.p, m.p) ? h : a)).p : T;
          this.host.fire?.(m, aimPoint(m, aim), weaponKind(m));
          stepClimb(m, R, 0, true);
        }
        if (m.fireT <= 0) {
          this.setAnim(m, AIM);
          // the base of fire suppressing (ai/strategy.js): hardly a pause between bursts
          // (and a team covering a friendly team's retreat: ai/retreatRadio.js)
          const suppress = (this.phase === 'strategy' && ['suppressFlank', 'withdraw', 'retreat'].includes(this.strategy?.kind) && teamOf(m) !== this.moving) || this.time < (this.supporting?.until ?? 0);
          m.fireT = suppress ? 0.5 + Math.random() * 0.5 : m.squad === 'MG' ? 1.4 + Math.random() : 3 + Math.random() * 2.5;
        }
      } else {
        if (m.anim !== AIM) this.setAnim(m, AIM);
        if (m.fireT <= 0) {
          if (covering) {
            this.setAnim(m, SHOOT);
            m.fireT = m.squad === 'MG' ? 1.3 : 0.7;
            m.rounds = R.rounds;
            m.shotT = 0;
          } else m.fireT = 0.5;
        }
      }
      // under heavy fire from one side: a grenade that way (not too close to his own men), shouted
      const heavy = !lie && m.squad !== 'MG' && m.grenades > 0 && this.time >= (this.heavyCd ?? 0) ? heavyFire(this, al, this.seen ?? []) : null;
      if (heavy && dist2(m.p, heavy) > 7 && dist2(m.p, heavy) < 26 && !this.host.members().some((o) => o.squad && !o.dead && dist2(o.p, heavy) < 7.5)) {
        m.grenades--;
        this.heavyCd = this.time + 9;
        this.grenadeCd = Math.max(this.grenadeCd, 6);
        this.face(m, heavy, 1, 10);
        this.setAnim(m, 'throwGrenade');
        m.throwAt = this.time + 1.0;
        m.throwTarget = heavy;
        m.signal = { text: 'FRAG OUT!', until: this.time + 1.8 };
        this.host.shout?.(m, 'Frag out!');
        continue;
      }
      // a covering rifleman throws a grenade when the threat is in range
      const d = dist2(m.p, T);
      const friendsNear = this.host.members().some((o) => o.squad && !o.dead && dist2(o.p, T) < 7.5);
      if (covering && !lie && m.squad !== 'MG' && m.grenades > 0 && this.grenadeCd <= 0 && d > 8 && d < 24 && this.phase === 'bound' && !friendsNear) {
        m.grenades--;
        this.grenadeCd = 14 + Math.random() * 8;
        this.setAnim(m, 'throwGrenade');
        m.throwAt = this.time + 1.0;
        m.signal = { text: 'FRAG OUT', until: this.time + 1.8 };
        this.host.shout?.(m, 'Frag out!');
      }
    }
    // held at the threat a while, no one hit, nothing moving: the area is safe, send the drone scouting
    this.holdT = this.phase === 'hold' ? this.holdT + dt : 0;
    const u = this.uav();
    if (u && !u.scouting && !u.scoutOrdered && this.holdT > 6 && this.time - this.lastDown > 20 && this.time - this.threatT > 20) {
      u.scoutOrdered = true;
      this.say(cmd, `Drone, ${this.unit}, area is clear, go scouting`, 'order');
      this.radioQueue.push({ at: this.time + 2.6, uav: true, scout: true, text: `${this.unit}, drone, copy, scouting`, kind: 'reply' });
    }
    if (u && !u.scouting && u.scoutOrdered && this.phase !== 'hold') u.scoutOrdered = false;
    if (this.pursuit || this.holdOff === true || this.holdOff === 'asked-continue') {
      // in pursuit, or told to hold off: no bounds
    } else if (this.phase === 'strategy') {
      // the leader's strategy has them (ai/strategy.js: a flank, an envelopment, a withdrawal, a defence)
    } else if (this.phase === 'formation') {
      this.formT = (this.formT ?? 0) - dt;
      if (this.formT <= 0) {
        this.formT = 1;
        const G = this.goal ?? T, c = centroid(al);
        const hit = al.some((m) => m.lastHitT != null && (this.host.now?.() ?? 0) - m.lastHitT < 4);
        if (dist2(c, G) < 22 || hit || (this.seen ?? []).some((h) => dist2(h.p, c) < 18) || !this.groups?.length) {
          for (const g of [...(this.groups ?? [])]) endGroup(this, g);
          this.phase = 'bound';
          this.assigned = false;
          this.t = 0;
          if (cmd) {
            this.setAnim(cmd, 'signalMove');
            cmd.signal = { text: 'BOUNDING OVERWATCH', until: this.time + 2 };
          }
          this.status = 'Close to the threat (or under fire): the commander signals bounding overwatch.';
        }
      }
    } else if (this.phase === 'bound') {
      if (!this.assigned) {
        const G = this.goal ?? T, c = centroid(al);
        const hit = al.some((m) => m.lastHitT != null && (this.host.now?.() ?? 0) - m.lastHitT < 4);
        if (this.navAge !== Infinity && this.width && dist2(c, G) > 28 && openGround(this, c) && !hit && al.length > 1) {
          // far off and in the open: move as one, in formation, to ~22 m from it
          const l = dist2(c, G), to = [G[0] + ((c[0] - G[0]) / l) * 21, G[1], G[2] + ((c[2] - G[2]) / l) * 21];
          this.phase = 'formation';
          this.formT = 2;
          moveGroup(this, al.filter((m) => m.squad !== 'UAV' || !m.deployed), to);
          this.status = 'Far off in the open: the team moves as one, in formation, each man watching his sector.';
          return;
        }
        this.assignBound();
      }
      const movers = al.filter((m) => teamOf(m) === this.moving);
      if (movers.every((m) => m.arrived && !m.path) || this.t > 18) {
        const G = this.goal ?? T;
      if (al.every((m) => dist2(m.p, G) < 6.5) || al.some((m) => dist2(m.p, G) < 4.2)) {
          this.phase = 'hold';
          this.setAnim(cmd, 'signalHalt');
          cmd.signal = { text: 'HOLD · SET SECURITY', until: this.time + 2 };
          this.status = 'At the threat: the commander signals halt and everyone holds security.';
        } else {
          const next = this.moving === 'A' ? 'B' : 'A';
          this.phase = 'signal';
          this.t = 0;
          this.setAnim(cmd, 'signalMove');
          cmd.signal = { text: `TEAM ${next} · MOVE UP`, until: this.time + 2 };
          this.status = `Team ${this.moving} is set and covering; the commander signals team ${next} to bound.`;
        }
      }
    } else if (this.phase === 'signal' && this.t > 1.7) {
      this.moving = this.moving === 'A' ? 'B' : 'A';
      this.phase = 'bound';
      this.assigned = false;
    }
  }
}

function dist2(a, b) {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}
/** A path without the points in a straight line (on the ground plan) between its turns. */
function corners(pts) {
  if (pts.length < 3) return pts.slice();
  const out = [pts[0]];
  const dir = (a, b) => {
    const l = dist2(a, b) || 1;
    return [(b[0] - a[0]) / l, (b[2] - a[2]) / l];
  };
  for (let i = 1; i < pts.length - 1; i++) {
    const u = dir(out[out.length - 1], pts[i]), v = dir(pts[i], pts[i + 1]);
    if (u[0] * v[0] + u[1] * v[1] < 0.999) out.push(pts[i]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
function centroid(list) {
  const c = [0, 0, 0];
  for (const m of list) for (let k = 0; k < 3; k++) c[k] += m.p[k] / list.length;
  return c;
}
