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
 *    ground a little behind the team (he sees further) and calls out good cover from there.
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
 * For the renderer each member gets: anim (clip name), aimAt, path / pathI, cover, trail,
 * signal { text, until }, moving, speed.
 */
const SPEED = { walk: 1.35, run: 3.4, aimWalk: 1.0, crawl: 0.35 };
const SCOUT_R = [10, 16];
const ONCE_T = { deployDrone: 7.0, signalMove: 1.6, signalHalt: 1.6, throwGrenade: 1.6, pickup: 1.3, radio: 2.4 };
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
    const peers = (this.host.peers?.() ?? []).filter((p) => p !== this && p.alive());
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
    const peers = this.host.peers?.() ?? [];
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
    const peers = (this.host.peers?.() ?? []).filter((p) => p !== this && p.alive());
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
      if (away && this.isLead) {
        const U = this.unit;
        this.say(this.radioMan(), `${U}, threat is moving away, ${this.bearing()}, going into pursuit, all teams follow`, 'order');
        this.startPursuit();
        (this.host.peers?.() ?? []).filter((x) => x !== this && x.alive()).forEach((x, i) =>
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
    const peers = (this.host.peers?.() ?? []).filter((p) => p !== this && p.alive());
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
    if (m.squad !== 'UAV' && (!this.busy(m) || m.anim === 'crouchAim')) this.setAnim(m, 'radio');
    m.signal = { text: text.toUpperCase(), until: this.time + 3 };
    this.host.radio?.(m, text, kind);
    this.status = 'Radio: ' + text;
  }

  /** Forget the current bound (after the range changed). */
  replan() {
    for (const m of this.members()) {
      if (m.path && !m.goingFor) {
        m.path = null;
        m.arrived = true;
      }
      m.coverCell = -1;
    }
    this.assigned = false;
    if (this.phase === 'hold') this.phase = 'bound';
    this.navAge = Infinity;
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
        outer: for (const [ox, oz] of [[0, 0], [0.18, 0], [-0.18, 0], [0, 0.18], [0, -0.18]])
          for (const hy of [0.5, 1.0, 1.45])
            if (this.host.solid(x + ox, y + hy, z + oz)) {
              raw[k] = 1;
              break outer;
            }
      }
    // keep a body's width off walls
    const bl = new Uint8Array(nx * nz);
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        if (raw[j * nx + i]) {
          bl[j * nx + i] = 1;
          continue;
        }
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const a = i + di, b = j + dj;
          if (a >= 0 && b >= 0 && a < nx && b < nz && raw[b * nx + a]) bl[j * nx + i] = 2;
        }
      }
    this.blocked = bl.map((v) => (v ? 1 : 0));
    this.solidCell = raw;
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
  }

  computeCovers() {
    this.covers = [];
    const { nx, nz } = this;
    // higher ground (for the gunner): free cells clearly above the lowest ground
    let lo = Infinity;
    for (let k = 0; k < nx * nz; k++) if (!this.blocked[k]) lo = Math.min(lo, this.fy[k]);
    this.high = [];
    for (let k = 0; k < nx * nz; k++) if (!this.blocked[k] && this.fy[k] > lo + 0.6 && k % 2 === 0) this.high.push({ k, p: this.cellPos(k), q: 0, high: this.fy[k] - lo });
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
  nearestFree(x, z) {
    const k = this.cellOf(x, z);
    if (k >= 0 && !this.blocked[k]) return k;
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

  /** A* from p0 to p1: world points, hugging walls. */
  route(p0, p1) {
    const { nx, nz } = this;
    const s = this.nearestFree(p0[0], p0[2]), g = this.nearestFree(p1[0], p1[2]);
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
          if (this.blocked[kk] || closed[kk]) continue;
          if (di && dj && (this.blocked[j * nx + a] || this.blocked[b * nx + i])) continue;
          const c = G[k] + (di && dj ? 1.414 : 1) * this.cost[kk];
          if (c < G[kk]) {
            G[kk] = c;
            from[kk] = k;
            push(kk, c + H(kk));
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
    // drop the points in the middle of straight runs
    const pts = [];
    let pd = null;
    for (let i = 0; i < cells.length; i++) {
      const p = this.cellPos(cells[i]);
      if (i > 0 && i < cells.length - 1) {
        const n = this.cellPos(cells[i + 1]);
        const d = [Math.sign(n[0] - p[0]), Math.sign(n[2] - p[2])];
        if (pd && d[0] === pd[0] && d[1] === pd[1]) {
          pts[pts.length - 1] = p;
          continue;
        }
        pd = d;
      }
      pts.push(p);
    }
    return pts;
  }

  /* ---------- per member ---------- */
  setAnim(m, a) {
    if (m.anim === a) return;
    m.anim = a;
    m.animT = this.time;
    if (ONCE_T[a]) m.animUntil = this.time + ONCE_T[a];
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
    if (!m.path || this.busy(m)) return;
    const mode = m.crawling ? 'crawl' : m.moveMode;
    const tgt = m.path[m.pathI];
    const dx = tgt[0] - m.p[0], dz = tgt[2] - m.p[2], dist = Math.hypot(dx, dz);
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
    const sp = SPEED[mode] * (m.speedFactor ?? 1) * Math.max(0, Math.cos(dy)) ** 2;
    const nx = m.p[0] + Math.sin(m.yaw) * sp * dt, nz = m.p[2] + Math.cos(m.yaw) * sp * dt;
    const fy = this.host.floor(nx, nz);
    m.p = [nx, fy ?? m.p[1], nz];
    m.moving = sp > 0.05;
    m.speed = sp;
    this.setAnim(m, mode);
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
  assignBound() {
    const al = this.members().filter((m) => !m.dead);
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
      if (u.squad === 'MG' && this.high?.length) {
        // higher ground a little behind the team, within reach
        const cy = centroid(al)[1];
        let hb = null, hs = -1e9;
        for (const c of this.high) {
          if (taken.has(c.k)) continue;
          const tr = dist2(c.p, u.p), dc = dist2(c.p, T);
          if (tr > 14 || dc < dist2(oc, T) - 3) continue;
          const sc = 3 * (c.p[1] - cy) - Math.abs(tr - 6) * 0.2 - Math.max(0, dist2(oc, T) - dc) * 0.5;
          if (sc > hs) (hs = sc), (hb = c);
        }
        if (hb && hs > 0) {
          taken.add(hb.k);
          u.coverCell = hb.k;
          u.cover = hb.p.slice();
          u.highGround = true;
          this.follow(u, this.route(u.p, hb.p), 'run', (m) => {
            m.arrived = true;
            m.fireT = 0.6;
            this.say(m, `${this.unit}, gunner, on high ground, I have eyes on the area and your backs`, 'intel');
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
      const path = this.route(u.p, dest);
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

  /** How far the team can see (m), with the gear they have on. */
  sight() {
    const v = this.host.visibility?.() ?? 60;
    return this.gear.thermal ? Math.max(v * 2.5, 45) : this.host.dark?.() && !this.gear.light ? Math.min(v, 14) : v;
  }
  /** Is the enemy (or might it be) close and unaware of us? Then stay dark and quiet. */
  stealthy() {
    return !this.contacted || this.time - this.lastSeen > 12;
  }
  /** Send two men to look at p (a noise, a last known position, the operator's order). */
  investigate(p, why = 'location') {
    const al = this.members().filter((m) => !m.dead && m.squad !== 'UAV');
    const men = al.filter((m) => m.squad === 'R1' || m.squad === 'R2');
    const pick = (men.length ? men : al.filter((m) => m.squad !== 'CMD')).slice(0, 2);
    if (!pick.length) return;
    if (!this.blocked || this.navAge === Infinity) {
      this.rebuildNav();
      this.navAge = 0;
    }
    this.inv = { p: p.slice(), why, men: pick, t: this.time, look: 0 };
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
      const to = [p[0] + (i ? 1.2 : -1.2), p[1], p[2]];
      m.coverCell = -1;
      m.cover = to;
      this.follow(m, this.route(m.p, to), 'aimWalk', (q) => (q.arrived = true));
      m.aimAt = p;
    });
  }
  /** Sightings, noises, losing contact; the commander's calls on gear, silence and backup. */
  senses(dt) {
    const H = this.host;
    const al = this.members().filter((m) => !m.dead);
    if (!al.length) return;
    // sightings
    const range = this.sight();
    let seen = null, nSeen = 0;
    for (const h of H.hostiles?.() ?? []) {
      if (h.dead) continue;
      const spot = al.find((m) => dist2(m.p, h.p) < range && (H.lineOfSight?.(m.p, h.p) ?? true));
      if (!spot) continue;
      nSeen++;
      h.marked = true;
      if (!seen || dist2(spot.p, h.p) < dist2(spot.p, seen.p)) seen = h;
    }
    if (seen) {
      this.lastSeen = this.time;
      if (this.inv) this.endInvestigation(false);
      if (!this.threat || dist2(this.threat, seen.p) > 1.5) {
        if (!this.threat) {
          this.threat = seen.p.slice();
          this.contacted = false; // reported below as a contact
          this.navAge = Infinity;
          this.silentUntil = 0;
        } else this.setThreat(seen.p.slice());
      }
    } else if (this.threat && this.lastSeen > -Infinity && this.time - this.lastSeen > 25 && !this.inv && (H.hostiles?.() ?? []).length) {
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
      if (n.squad === this.unit) continue;
      const c = centroid(al);
      if (dist2(c, n.p) > n.loud) continue;
      if (this.threat) continue; // busy with the threat they have
      if (!this.inv) this.investigate(n.p, 'noise');
    }
    // the investigators: look round where they got to; nothing there, come back
    if (this.inv) {
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
      if (calls.length && cmd) {
        if (this.time < this.silentUntil) this.setAnim(cmd, 'signalDown');
        else this.say(cmd, `${this.unit}, ${calls.join(', ')}`, 'order');
      }
    }
    // backup: two men down, or more of them than of us standing
    const down = this.members().filter((m) => m.dead).length;
    if (!this.backupCalled && (down >= 2 || nSeen >= 3 || nSeen > al.length)) {
      const peers = (H.peers?.() ?? []).filter((p) => p !== this && p.alive());
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
      if (nothing && back) this.follow(m, this.route(m.p, [back[0] + (Math.random() - 0.5) * 3, back[1], back[2] + (Math.random() - 0.5) * 3]), 'aimWalk', (q) => (q.arrived = true));
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
    // no threat yet: listen, look, send men to investigate; hold where they are
    if (this.on) this.senses(dt);
    if (!this.threat) {
      for (const m of ms) {
        if (m.dead) continue;
        m.squadInit ??= (m.arrived = true, m.grenades = 2, m.coverCell = -1, m.trail = [], true);
        this.move(m, dt);
        if (!m.path && !this.busy(m) && !this.inv?.men.includes(m)) {
          if (this.inv) this.face(m, this.inv.p, dt);
          this.setAnim(m, m.squad === 'UAV' ? 'crouch' : 'crouchAim');
        }
        const last = m.trail[m.trail.length - 1];
        if (!last || Math.hypot(last[0] - m.p[0], last[1] - m.p[2]) > 0.25) m.trail.push([m.p[0], m.p[2]]);
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
        m.anim = 'die';
        m.path = null;
        m.moving = false;
        continue;
      }
      m.squadInit ??= (m.yaw = Math.atan2(this.threat[0] - m.p[0], this.threat[2] - m.p[2]), m.arrived = true, m.grenades = 2, m.coverCell = -1, m.trail = [], true);
      this.move(m, dt);
      // the trail behind them
      const last = m.trail[m.trail.length - 1];
      if (!last || Math.hypot(last[0] - m.p[0], last[1] - m.p[2]) > 0.25) {
        m.trail.push([m.p[0], m.p[2]]);
        if (m.trail.length > 160) m.trail.shift();
      }
    }
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
    if (this.contacted && this.isLead && this.orderT <= 0) {
      this.orderT = 3;
      this.command();
    }
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
          this.follow(m, this.route(m.p, to), 'run', (q2) => (q2.arrived = true));
        });
    }
    const T = this.threat;
    const cmd = al.find((m) => m.squad === 'CMD') ?? al[0];
    for (const m of al) {
      // a grenade leaving the hand
      if (m.throwAt != null && this.time >= m.throwAt) {
        m.throwAt = null;
        const c = Math.cos(m.yaw), s = Math.sin(m.yaw);
        const from = [m.p[0] + -0.12 * c + 0.5 * s, m.p[1] + 1.62, m.p[2] + 0.12 * s + 0.5 * c];
        const d = dist2(from, T), Tf = Math.max(0.9, Math.min(1.6, d / 12));
        this.host.grenade?.(m, from, [(T[0] - from[0]) / Tf, (T[1] - from[1] + 4.905 * Tf * Tf) / Tf, (T[2] - from[2]) / Tf]);
      }
      if (m.droneAt != null && this.time >= m.droneAt) {
        m.droneAt = null;
        this.host.droneLaunch?.(m, T);
        this.say(m, `${this.unit}, drone is up, eyes on the threat`, 'drone');
      }
      if (this.busy(m)) {
        if (m.anim === 'throwGrenade') this.face(m, T, dt, 4);
        continue;
      }
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
          this.follow(m, this.route(m.p, [r[0] - (d[0] / l) * 0.45, r[1], r[2] - (d[1] / l) * 0.45]), 'run', (q) => {
            this.face(q, r, 1, 10);
            this.setAnim(q, 'pickup');
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
      const covering = teamOf(m) !== this.moving || this.phase === 'hold';
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
      if (m.anim === SHOOT) {
        m.shotT = (m.shotT ?? 0) - dt;
        if (m.shotT <= 0 && m.rounds > 0) {
          m.rounds--;
          m.shotT = 0.12;
          this.host.fire?.(m, [T[0] + (Math.random() - 0.5) * 2, T[1] + 0.4 + Math.random() * 1.2, T[2] + (Math.random() - 0.5) * 2]);
        }
        if (m.fireT <= 0) {
          this.setAnim(m, AIM);
          m.fireT = m.squad === 'MG' ? 1.4 + Math.random() : 3 + Math.random() * 2.5;
        }
      } else {
        if (m.anim !== AIM) this.setAnim(m, AIM);
        if (m.fireT <= 0) {
          if (covering) {
            this.setAnim(m, SHOOT);
            m.fireT = m.squad === 'MG' ? 1.3 : 0.7;
            m.rounds = m.squad === 'MG' ? 9 : 3;
            m.shotT = 0;
          } else m.fireT = 0.5;
        }
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
    } else if (this.phase === 'bound') {
      if (!this.assigned) this.assignBound();
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
function centroid(list) {
  const c = [0, 0, 0];
  for (const m of list) for (let k = 0; k < 3; k++) c[k] += m.p[k] / list.length;
  return c;
}
