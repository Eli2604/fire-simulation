/**
 * A flight of jets (models/jetFlight.js): two to eight fighters flying together, the leader
 * giving the orders on the radio, as a fire team's commander does (ai/squad.js).
 *
 *  - Formation: every member holds a slot relative to the leader (FORMATIONS: echelon left or
 *    right, vic, line abreast, finger-four, trail). The slots turn with the leader's heading; a
 *    member steers for its slot with the leader's velocity plus a correction towards it, limited
 *    like an aircraft: bank angle and roll rate (so its turn rate), climb angle, acceleration and a
 *    speed band. Members too close push apart (separation).
 *  - Elements: with four or more the flight works as pairs (leader and wingman): element one is
 *    ranks 0-1, element two ranks 2-3, … With two jets each is an element of its own.
 *  - Orders (order(kind, opts)), each called by the leader on the radio and answered in turn:
 *      formUp     form up on the leader (in the current formation)
 *      formation  change formation ({ formation })
 *      flank      the elements split to bracket the target from left and right, run in from both
 *                 sides (rockets), come off it, and the flight rejoins
 *      engage     the whole flight runs in on the target in formation, rockets, then rejoins
 *      break      defensive: everyone breaks hard away (left, right, up, down) and scatters, then
 *                 rejoins on the leader
 *      rejoin     back into formation on the leader
 *      orbit      hold: orbit a point ({ p }, default: here)
 *      rtb        return to base (home: the carrier) and hold overhead
 *  - Leader loss: when the leader goes down the next one alive takes the lead and says so.
 *  - With `on` (AI on) the leader runs a little programme by itself while holding: a formation
 *    change, a flank attack, another formation, an attack in formation, a break, RTB, …
 *  - Threats and evasion: what comes at a jet (a missile tracking it: launchMissile; a rocket, a
 *    gun, a dragon: warn() or o.threats()) is seen (senseThreats), a wingman calls the break
 *    ("Two, break right! Missile, 4 o'clock!"), and the jet flies a defensive manoeuvre (EVADES):
 *    a hard break turn into the threat, a barrel roll, jinking, a split-S or a dive, beaming it
 *    (turning it onto the beam), dispensing flares (this.flares: they fall away burning, trailing
 *    smoke; a missile tracking it may take one salvo instead: FLARE_DECOY, drawn from the flight's
 *    own seeded numbers). Manoeuvring lowers the chance of being hit (hitChance: the player's
 *    rockets, the missiles that still reach it). Then it rejoins.
 *  - Deterministic: no Math.random; the seed only varies the break directions and the programme.
 *
 * Frame: heading h, forward (cos h, 0, -sin h) (render/jetMesh.js: nose +x, rotation.y = h);
 * right (sin h, 0, cos h). Bank > 0: right wing down, a right turn (h decreasing). Pure: no three.js.
 *
 *   const ai = new FlightAI({ p: [0, 0, 0], count: 4, formation: 'fingerFour', speed: 80, altitude: 150,
 *     target: [800, 0, 0], home: [0, 0, 0], radio: (m, text, kind) => …, impact: (p, m) => … });
 *   ai.step(dt); ai.members → [{ p, h, gamma, bank, v, alive, … }]; ai.order('flank');
 */

import { JetDamage, jetImpact } from '../sim/jetDamage.js';
import { ejectionEnvelope, Chute, chuteInput } from '../sim/ejection.js';
import { deriveWeather } from '../sim/weather.js';

const G = 9.81;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hyp = (x, z) => Math.hypot(x, z);
const fwdOf = (h) => [Math.cos(h), 0, -Math.sin(h)];
const rightOf = (h) => [Math.sin(h), 0, Math.cos(h)];
const headingOf = (x, z) => Math.atan2(-z, x);
const NUM = ['Lead', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'];

/** A small seeded generator (mulberry32). */
function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const FORMATIONS = {
  echelonLeft: 'Echelon left',
  echelonRight: 'Echelon right',
  vic: 'Vic (V)',
  lineAbreast: 'Line abreast',
  fingerFour: 'Finger-four',
  trail: 'Trail',
};
export const FORMATION_KEYS = Object.keys(FORMATIONS);

/**
 * The defensive manoeuvres: how long they last (s) and what they leave of the chance of being hit
 * (a rocket or a gun at a jet flying straight: 1).
 */
export const EVADES = {
  breakTurn: { label: 'Break turn', dur: 4.5, hit: 0.45 },
  barrelRoll: { label: 'Barrel roll', dur: 4.8, hit: 0.3 },
  jink: { label: 'Jinking', dur: 3.5, hit: 0.5 },
  splitS: { label: 'Split-S', dur: 7, hit: 0.4 },
  dive: { label: 'Dive', dur: 5, hit: 0.5 },
  beam: { label: 'Beaming', dur: 5.5, hit: 0.6 },
};
/** A tracking missile's chance of taking one salvo of flares instead of the jet. */
export const FLARE_DECOY = 0.65;
const FLARES = 30; // per jet
const MISSILE = { speed: 300, turn: 22 * 9.81, life: 12, fuze: 14 };

export const FLIGHT_ORDERS = {
  formUp: 'Form up',
  formation: 'Change formation',
  flank: 'Split and flank',
  engage: 'Engage target',
  break: 'Break (defensive)',
  rejoin: 'Rejoin',
  orbit: 'Orbit / hold here',
  rtb: 'RTB (return to the carrier)',
};

/**
 * The slot of rank r (0: the leader) in a formation, `s` metres apart:
 * [ahead, up, right] in the leader's frame.
 */
export function slotOffset(formation, r, s) {
  if (r <= 0) return [0, 0, 0];
  const k = Math.ceil(r / 2);
  const side = r % 2 ? -1 : 1; // odd ranks left, even ranks right
  switch (formation) {
    case 'echelonLeft':
      return [-0.8 * r * s, 0, -r * s];
    case 'echelonRight':
      return [-0.8 * r * s, 0, r * s];
    case 'vic':
      return [-0.8 * k * s, 0, side * k * s];
    case 'lineAbreast':
      return [0, 0, side * k * s];
    case 'trail':
      return [-1.5 * r * s, -0.08 * r * s, 0];
    case 'fingerFour':
    default: {
      // lead, his wingman back left; the element lead back right, his wingman further out
      const F = [[0, 0, 0], [-0.8, 0, -1], [-0.8, 0, 1], [-1.6, 0, 2]];
      const q = F[r % 4];
      const back = Math.floor(r / 4) * 3; // a second four behind the first
      return [(q[0] - back) * s, 0, q[2] * s];
    }
  }
}

/** The elements (lists of ranks) of a flight of n: pairs, or two singles with two jets. */
export function elementsOf(n) {
  if (n <= 1) return [[0]];
  if (n === 2) return [[0], [1]];
  const out = [];
  for (let r = 0; r < n; r += 2) out.push(r + 1 < n ? [r, r + 1] : [r]);
  return out;
}

/** Where a slot offset puts a member, round a leader at p with heading h. */
export function slotPoint(p, h, off) {
  const f = fwdOf(h);
  const r = rightOf(h);
  return [p[0] + f[0] * off[0] + r[0] * off[2], p[1] + off[1], p[2] + f[2] * off[0] + r[2] * off[2]];
}

/** Compass bearing (0 = -z, 90 = +x) from a to b, in degrees. */
function bearing(a, b) {
  return Math.round(((Math.atan2(b[0] - a[0], -(b[2] - a[2])) * 180) / Math.PI + 360) % 360);
}

export class FlightAI {
  /**
   * @param {object} o  p (the flight's reference point: orbit centre, its y the ground), count,
   *   formation, spacing, altitude, speed (cruise, m/s), leader (index), rockets (per jet),
   *   callsign, orbitRadius, target, home, seed, auto (AI on), bankMax (rad), holdTime (s),
   *   floor(x, z) (ground or sea height), radio(member, text, kind), impact(p, member), fire(member, from, vel)
   */
  constructor(o = {}) {
    this.o = o;
    this.callsign = o.callsign ?? 'Viper';
    this.formation = FORMATIONS[o.formation] ? o.formation : 'fingerFour';
    this.spacing = o.spacing ?? 30;
    this.cruise = o.speed ?? 80;
    this.bankMax = o.bankMax ?? 1.2;
    /** Turn radius at cruise and full bank: the flight's length scale. */
    this.R = this.cruise ** 2 / (G * Math.tan(this.bankMax));
    const p = o.p ?? [0, 0, 0];
    this.ground = p[1];
    this.alt = p[1] + (o.altitude ?? 150);
    this.hold = { c: [p[0], p[2]], r: o.orbitRadius ?? 2.5 * this.R };
    this.home = o.home ? o.home.slice() : [p[0], p[1], p[2]];
    this.target = o.target ? o.target.slice() : null;
    this.rand = rng(o.seed ?? 1);
    this.on = o.auto ?? true;
    this.holdTime = o.holdTime ?? 25;
    this.time = 0;
    this.mode = 'orbit';
    this.modeT = 0;
    this.joinedT = 0;
    this.radioQueue = [];
    this.log = []; // the radio lines: { t, who, text, kind }
    this.rockets = []; // in the air: { p, v, t, by }
    this.splashes = []; // where they came down: { p, t }
    this.pilots = []; // the ones who ejected: { m, chute, state, t, home }
    this.script = 0;
    this.flares = []; // burning in the air: { id, p, v, t, by, trail }
    this.missiles = []; // tracking missiles: { id, p, v, t, target: { m } | { flare } }
    this.pending = []; // threats warned of since the last step (warn)
    this.erand = rng(((o.seed ?? 1) * 7919 + 13) >>> 0); // (the evasion's own numbers: the rest flies as before)
    this.formCycle = FORMATION_KEYS.indexOf(this.formation);
    const n = clamp(Math.round(o.count ?? 4), 1, 8);
    this.lead = clamp(Math.round(o.leader ?? 0), 0, n - 1);
    this.members = Array.from({ length: n }, (_, i) => ({
      i,
      call: `${this.callsign} ${i + 1}`,
      p: [0, 0, 0],
      h: 0,
      gamma: 0,
      bank: 0,
      v: this.cruise,
      alive: true,
      gone: false,
      hp: 1,
      rockets: o.rockets ?? 4,
      dmg: new JetDamage(), // its hit parts, fires, and what happens when it is critical (sim/jetDamage.js)
      throttle: 0.5,
      flares: o.flares ?? FLARES,
      evade: null, // a defensive manoeuvre under way: { kind, t, dur, side, ... }
    }));
    this.place();
  }

  /* ---------------- who is who ---------------- */
  get leader() {
    return this.members[this.lead];
  }
  /** The members alive, the leader first, then by number. */
  ranked() {
    const n = this.members.length;
    const out = [];
    for (let k = 0; k < n; k++) {
      const m = this.members[(this.lead + k) % n];
      if (m.alive) out.push(m);
    }
    // (by number after the leader, not wrapping round from him)
    const L = out.shift();
    out.sort((a, b) => a.i - b.i);
    return L ? [L, ...out] : out;
  }
  rankOf(m) {
    return this.ranked().indexOf(m);
  }
  /** "Viper 2" as the radio says it ("Lead" for the leader). */
  name(m) {
    return m === this.leader ? `${this.callsign} lead` : m.call;
  }

  /** Everyone in formation on the orbit, at cruise (the start; also after a reset). */
  place() {
    const L = this.leader;
    const [cx, cz] = this.hold.c;
    L.p = [cx + this.hold.r, this.alt, cz];
    // a left-hand orbit: the centre on the left, so heading is the tangent turning left
    L.h = headingOf(cx - L.p[0], cz - L.p[2]) - Math.PI / 2;
    this.ranked().forEach((m, r) => {
      if (r === 0) return;
      m.p = slotPoint(L.p, L.h, slotOffset(this.formation, r, this.spacing));
      m.h = L.h;
    });
    for (const m of this.members) Object.assign(m, { gamma: 0, bank: 0, v: this.cruise });
  }

  /** Spread out round the leader (to show them forming up): deterministic. */
  scatter() {
    const L = this.leader;
    const r0 = this.rand;
    this.ranked().forEach((m, r) => {
      if (r === 0) return;
      const a = r * 2.1 + r0() * 0.5;
      const d = this.spacing * (3 + 2 * r0());
      m.p = [L.p[0] + Math.cos(a) * d, L.p[1] + (r0() - 0.5) * this.spacing, L.p[2] + Math.sin(a) * d];
      m.h = L.h + (r0() - 0.5) * 1.2;
    });
  }

  /* ---------------- the radio ---------------- */
  say(m, text, kind = 'order', delay = 0) {
    this.radioQueue.push({ at: this.time + delay, m, text, kind });
  }
  /** The leader's call, then each member answers in turn ("Two", "Three", …). */
  call(text, kind = 'order', reply = 'copy') {
    const L = this.leader;
    this.say(L, text, kind);
    this.ranked().forEach((m, r) => r && this.say(m, `${NUM[m.i] ?? m.call}${reply ? ', ' + reply : ''}`, 'reply', 1.4 + 0.8 * (r - 1)));
  }
  flushRadio() {
    this.radioQueue.sort((a, b) => a.at - b.at);
    while (this.radioQueue.length && this.radioQueue[0].at <= this.time) {
      const q = this.radioQueue.shift();
      if (!q.m.alive && q.kind !== 'mayday' && q.kind !== 'pilot') continue;
      const line = { t: this.time, who: q.m.call, text: q.text, kind: q.kind };
      this.log.push(line);
      if (this.log.length > 40) this.log.shift();
      this.o.radio?.(q.m, q.text, q.kind);
    }
  }

  /* ---------------- orders ---------------- */
  /** The leader gives an order; false if it cannot be carried out (no target, too few). */
  order(kind, opts = {}) {
    const C = this.callsign;
    const L = this.leader;
    if (!L || !L.alive) return false;
    const n = this.ranked().length;
    const T = opts.target ?? this.target;
    switch (kind) {
      case 'formUp':
        this.call(`${C}, form up on me, ${FORMATIONS[this.formation].toLowerCase()}`);
        this.setMode('join');
        return true;
      case 'formation': {
        const f = opts.formation ?? FORMATION_KEYS[(FORMATION_KEYS.indexOf(this.formation) + 1) % FORMATION_KEYS.length];
        if (!FORMATIONS[f]) return false;
        this.formation = f;
        this.call(`${C}, go ${FORMATIONS[f].toLowerCase()}`);
        this.setMode('join');
        return true;
      }
      case 'flank': {
        if (!T || n < 2) return false;
        this.startFlank(T);
        const els = this.elements;
        const names = els.map((e) => (e.ids[0] === L ? 'Lead' : NUM[e.ids[0].i]));
        this.call(`${C}, split, ${names[0]} left, ${names[1]} right, bracket the target, bearing ${bearing(L.p, T)}`, 'order', 'split');
        return true;
      }
      case 'engage':
        if (!T) return false;
        this.attack = { T: T.slice(), fired: false };
        this.call(`${C}, engage, target bearing ${bearing(L.p, T)}, rockets, follow me in`, 'order', 'engaging');
        this.setMode('engage');
        return true;
      case 'break':
        this.startBreak();
        this.call(`${C}, break, break! Scatter!`, 'urgent', 'breaking');
        return true;
      case 'rejoin':
        this.call(`${C}, rejoin on me`);
        this.setMode('join');
        return true;
      case 'orbit': {
        const r = this.hold.r;
        const rt = rightOf(L.h);
        // the centre to the left of the leader: he is already on the circle
        const c = opts.p ? [opts.p[0], opts.p[2]] : [L.p[0] - rt[0] * r, L.p[2] - rt[2] * r];
        this.hold = { c, r };
        this.call(`${C}, hold here, left-hand orbit, ${Math.round(this.alt - this.ground)} metres`);
        this.setMode('join');
        return true;
      }
      case 'rtb':
        this.call(`${C}, RTB, mother bearing ${bearing(L.p, this.home)}`, 'order', 'RTB');
        this.setMode('rtb');
        return true;
    }
    return false;
  }

  setMode(m) {
    this.mode = m;
    this.modeT = 0;
    this.joinedT = 0;
  }

  startFlank(T) {
    const L = this.leader;
    const ranks = this.ranked();
    const u0 = [T[0] - L.p[0], T[2] - L.p[2]];
    const d = hyp(...u0) || 1;
    const u = [u0[0] / d, u0[1] / d];
    const nrm = [-u[1], u[0]]; // right of the run-in line
    const W = 3 * this.R;
    const D = 2.5 * this.R;
    this.elements = elementsOf(ranks.length).map((rs, k) => {
      const side = k % 2 ? 1 : -1;
      const w = W * (1 + Math.floor(k / 2) * 0.6);
      return { ids: rs.map((r) => ranks[r]), side, pt: [T[0] - u[0] * D + side * nrm[0] * w, T[2] - u[1] * D + side * nrm[1] * w], phase: 'out', t: 0, fired: false };
    });
    this.attack = { T: T.slice() };
    this.setMode('flank');
  }

  startBreak() {
    this.ranked().forEach((m, r) => {
      const side = r % 2 ? 1 : -1;
      m.breakH = m.h + side * ((100 + 40 * this.rand()) * Math.PI) / 180;
      m.breakClimb = Math.floor(r / 2) % 2 ? -0.15 : 0.3;
    });
    this.setMode('break');
  }

  /**
   * Member i is hit on part k (sim/jetDamage.js: cockpit, fuel, engines, tail, wingL, wingR) for
   * `amount` base damage (rocket 350). It calls it, the others warn him, and the leader (if it is
   * not him going down) breaks the flight; at critical damage it goes down.
   */
  hit(i, k = 'fuel', amount = 350) {
    const m = this.members[i];
    if (!m || !m.alive) return null;
    const first = m.dmg.state === 'ok';
    const r = m.dmg.hit(k, amount);
    if (!r) return null;
    if (first || r.fire) {
      const other = this.ranked().find((o) => o !== m);
      const who = m === this.leader ? 'Lead' : NUM[m.i];
      this.say(m, `${NUM[m.i]}, I'm hit${r.fire ? ", I am burning" : ""}!`, 'mayday');
      if (other) this.say(other, `${who}'s hit${r.fire ? ", you're on fire" : ''}!`, 'urgent', 0.8);
    }
    if (m.dmg.falling) this.down(m);
    else if (first && this.mode !== 'break' && this.leader !== m) this.order('break');
    else if (first && this.mode !== 'break' && this.leader === m && this.ranked().length > 1) this.order('break');
    m.hp = m.dmg.integrity;
    return r;
  }
  /** Out of control: it falls; the pilot ejects. */
  down(m) {
    if (!m.alive) return;
    if (!m.dmg.falling) {
      m.dmg.state = 'falling';
      m.dmg.cause ??= 'airframe';
    }
    m.alive = false;
    m.hp = 0;
    const other = this.ranked().find((o) => o !== m);
    const who = m === this.leader ? 'Lead' : NUM[m.i];
    // out if he can: height for the seat, the cockpit whole (sim/ejection.js); otherwise he rides it in
    const env = ejectionEnvelope({ height: m.p[1] - this.floor(m.p[0], m.p[2]), sink: -this.vel(m)[1], pitch: m.gamma, roll: m.bank, cockpit: m.dmg.dmg.cockpit ?? 0 });
    if (env.ok) {
      this.eject(m);
      this.say(m, `${m.call}, going down, ejecting!`, 'mayday');
      if (other) this.say(other, `${who} is out, I see a good chute`, 'urgent', 2.2);
    } else {
      m.noEject = env.reason;
      this.say(m, `${m.call}, going down!`, 'mayday');
      if (other) this.say(other, `${who} is going down, no chute!`, 'urgent', 1.6);
    }
  }

  /** The seat fires: the canopy goes, the pilot is out along the jet's "up", then under his parachute. */
  eject(m) {
    if (m.pilot) return;
    const v = this.vel(m);
    // the jet's up: tilted by its bank (and its pitch)
    const rt = rightOf(m.h);
    const f = fwdOf(m.h);
    const up = [-Math.sin(m.bank) * rt[0] - Math.sin(m.gamma) * f[0], Math.cos(m.bank) * Math.cos(m.gamma), -Math.sin(m.bank) * rt[2] - Math.sin(m.gamma) * f[2]];
    m.canopyOff = this.time;
    m.pilot = { m: m.i, call: m.call, chute: new Chute({ p: [m.p[0] + f[0] * 3, m.p[1] + 1.2, m.p[2] + f[2] * 3], v, heading: m.h, up }), state: 'chute', t: 0, wreck: null };
    this.pilots.push(m.pilot);
  }

  /** The pilots under their canopies, then on the ground (evading) or in the water (waiting for pick-up). */
  stepPilots(dt) {
    const wind = this.o.wind?.() ?? [0, 0];
    const ground = this.o.ground ?? ((x, z) => ({ y: this.floor(x, z), water: this.o.water ? !!this.o.water(x, z) : true }));
    for (const P of this.pilots) {
      P.t += dt;
      const c = P.chute;
      if (P.state === 'chute') {
        const h = c.p[1] - ground(c.p[0], c.p[2]).y;
        const ev = c.step(dt, chuteInput(c, h, null, wind), wind, ground);
        const M = this.members[P.m];
        if (ev.includes('splashdown')) {
          P.state = 'afloat';
          this.say(M, `${P.call}, in the water, life vest up, waiting for pick-up`, 'pilot', 2);
        } else if (ev.includes('land')) {
          P.state = 'evade';
          P.t = 0;
          this.say(M, `${P.call}, on the ground, evading`, 'pilot', 1);
          this.o.pilotLanded?.(P);
        }
      } else if (P.state === 'evade') {
        // away from where his jet came down, then down in cover
        const w = P.wreck ?? this.members[P.m].p;
        const d = [c.p[0] - w[0], c.p[2] - w[2]];
        const l = Math.hypot(...d) || 1;
        if (P.t < 20) {
          c.p[0] += (d[0] / l) * 1.4 * dt;
          c.p[2] += (d[1] / l) * 1.4 * dt;
          c.p[1] = ground(c.p[0], c.p[2]).y;
          c.heading = Math.atan2(-d[1], d[0]);
        } else P.state = 'hide';
      }
    }
  }

  /** What a pilot's figure does (render/pilotFigure.js poses). */
  pilotPose(P) {
    if (P.state === 'evade') return P.chute.phase === 'plf' ? 'plf' : 'walk';
    if (P.state === 'hide') return 'crouch';
    return P.chute.pose();
  }

  /* ---------------- flying ---------------- */
  /** Fly member m towards the velocity dv (m/s, world) within its limits (or its defensive manoeuvre). */
  steer(m, dv, dt, vmax = 1.4) {
    if (m.evade) return this.evadeStep(m, dt);
    const hor = hyp(dv[0], dv[2]);
    const want = hor > 1e-3 ? headingOf(dv[0], dv[2]) : m.h;
    const e = wrap(want - m.h);
    const v = Math.max(1, m.v);
    const rMax = (G * Math.tan(this.bankMax)) / v;
    // (how fast the wanted heading turns, smoothed: flown ahead, so a steady turn has no lag)
    const ff = m.want != null ? wrap(want - m.want) / dt : 0;
    m.want = want;
    m.ff = (m.ff ?? 0) + (clamp(ff, -rMax, rMax) - (m.ff ?? 0)) * Math.min(1, dt * 3);
    const rate = clamp(m.ff + e * 1.4, -rMax, rMax);
    const bankWant = -Math.atan((rate * v) / G);
    const roll = 2.2 * dt;
    m.bank += clamp(bankWant - m.bank, -roll, roll);
    m.h = wrap(m.h - (G * Math.tan(m.bank) * dt) / v);
    const gWant = clamp(Math.atan2(dv[1], Math.max(hor, 1)), -0.45, 0.45);
    m.gamma += clamp(gWant - m.gamma, -0.6 * dt, 0.6 * dt);
    const sWant = clamp(Math.hypot(hor, dv[1]), 0.6 * this.cruise, vmax * this.cruise);
    const acc = 0.16 * this.cruise * dt;
    m.throttle = clamp(0.5 + (sWant - m.v) / (0.3 * this.cruise), 0, 1);
    m.v += clamp(sWant - m.v, -acc, acc);
    this.move(m, dt);
  }
  move(m, dt) {
    const c = Math.cos(m.gamma);
    m.p[0] += Math.cos(m.h) * c * m.v * dt;
    m.p[1] += Math.sin(m.gamma) * m.v * dt;
    m.p[2] += -Math.sin(m.h) * c * m.v * dt;
  }
  vel(m) {
    const c = Math.cos(m.gamma);
    return [Math.cos(m.h) * c * m.v, Math.sin(m.gamma) * m.v, -Math.sin(m.h) * c * m.v];
  }
  /** Towards point q at speed k·cruise (climbing or descending to its height). */
  to(m, q, k = 1) {
    const d = [q[0] - m.p[0], q[1] - m.p[1], q[2] - m.p[2]];
    const l = hyp(d[0], d[2]) || 1;
    const s = k * this.cruise;
    return [(d[0] / l) * s, clamp(d[1] * 0.4, -0.4 * s, 0.4 * s), (d[2] / l) * s];
  }
  /** Round the hold point, left-hand, at speed k·cruise. */
  orbitV(m, k = 1, hold = this.hold) {
    const rx = m.p[0] - hold.c[0];
    const rz = m.p[2] - hold.c[1];
    const d = hyp(rx, rz) || 1;
    const out = [rx / d, rz / d];
    // left-hand: the tangent with the centre on the left (left of heading h is -right)
    const t = [out[1], -out[0]];
    const s = k * this.cruise;
    const corr = clamp((hold.r - d) * 0.6, -s, s);
    return [t[0] * s + out[0] * corr, clamp((this.alt - m.p[1]) * 0.3, -0.3 * s, 0.3 * s), t[1] * s + out[1] * corr];
  }
  /** Hold the slot `off` on leader L. */
  slotV(m, L, off, k = 0.35) {
    const S = slotPoint(L.p, L.h, off);
    const V = this.vel(L);
    // the slot turns with the leader: on the outside of his turn it goes faster
    const w = (-G * Math.tan(L.bank)) / Math.max(1, L.v);
    const f = fwdOf(L.h);
    const rt = rightOf(L.h);
    V[0] += w * (-rt[0] * off[0] + f[0] * off[2]);
    V[2] += w * (-rt[2] * off[0] + f[2] * off[2]);
    const e = [S[0] - m.p[0], S[1] - m.p[1], S[2] - m.p[2]];
    const el = Math.hypot(...e);
    const lim = 0.45 * this.cruise;
    const c = el * k > lim ? lim / (el * k) : 1;
    return [V[0] + e[0] * k * c, V[1] + e[1] * k * c, V[2] + e[2] * k * c];
  }
  /** Push apart from anyone too close. */
  separate(m, dv, alive) {
    const min = Math.max(8, 0.5 * this.spacing);
    for (const o of alive) {
      if (o === m) continue;
      const d = [m.p[0] - o.p[0], m.p[1] - o.p[1], m.p[2] - o.p[2]];
      const l = Math.hypot(...d);
      if (l < min && l > 1e-6) for (let k = 0; k < 3; k++) dv[k] += (d[k] / l) * (min - l) * 1.5;
    }
    return dv;
  }

  fire(m, T) {
    if (m.rockets <= 0) return;
    const n = Math.min(2, m.rockets);
    m.rockets -= n;
    for (let k = 0; k < n; k++) {
      const f = fwdOf(m.h);
      const rt = rightOf(m.h);
      const side = k % 2 ? 1 : -1;
      const from = [m.p[0] + f[0] * 4 + rt[0] * side * 2.5, m.p[1] - 0.5, m.p[2] + f[2] * 4 + rt[2] * side * 2.5];
      const d = [T[0] - from[0], T[1] - from[1], T[2] - from[2]];
      const l = Math.hypot(...d) || 1;
      const s = m.v + 220;
      const v = d.map((x) => (x / l) * s);
      // (aimed high for the drop over the flight time)
      v[1] += (G * l) / s / 2;
      this.rockets.push({ p: from, v, t: 0, by: m.i });
      this.o.fire?.(m, from, v);
    }
  }

  floor(x, z) {
    return this.o.floor?.(x, z) ?? this.ground;
  }

  step(dt) {
    if (dt <= 0) return;
    this.time += dt;
    this.modeT += dt;
    // damage: fires grow; critical, a jet goes down
    for (const m of this.members) if (m.alive && m.dmg.state !== 'ok' && m.dmg.step(dt).includes('critical')) this.down(m);
    // the leader down: the next one alive takes the lead
    if (!this.leader.alive) {
      const n = this.members.length;
      let k = 1;
      while (k < n && !this.members[(this.lead + k) % n].alive) k++;
      if (k < n) {
        const old = this.leader;
        this.lead = (this.lead + k) % n;
        const L = this.leader;
        this.say(L, `${this.callsign}, ${old.call} is down, ${L.call} has the lead, rejoin on me`, 'order', 1.0);
        this.ranked().forEach((m, r) => r && this.say(m, `${NUM[m.i]}, copy, on you`, 'reply', 2.6 + 0.8 * (r - 1)));
        this.setMode('join');
      } else this.mode = 'lost';
    }
    const alive = this.ranked();
    const L = alive[0];
    // the ones going down: out of control as their damage says (rolling, spinning, tumbling)
    for (const m of this.members) {
      if (m.alive || m.gone) continue;
      m.dmg.step(dt);
      const c = m.dmg.control();
      m.bank += c.roll * dt;
      m.gamma = clamp(m.gamma + c.pitch * dt, -1.35, 0.6);
      m.h = wrap(m.h + c.yaw * dt);
      m.v = clamp(m.v + (G * -Math.sin(m.gamma) * 0.6 - 0.02 * m.v * (1 - c.thrust)) * dt, 0.4 * this.cruise, 2 * this.cruise);
      this.move(m, dt);
      if (m.p[1] <= this.floor(m.p[0], m.p[2])) {
        m.gone = true;
        const water = this.o.water ? !!this.o.water(m.p[0], m.p[2]) : true;
        const info = m.dmg.impact(water);
        this.splashes.push({ id: (this.splashN = (this.splashN ?? 0) + 1), p: m.p.slice(), t: this.time, big: true, water });
        if (m.pilot) m.pilot.wreck = m.p.slice();
        this.o.crash?.(m, m.p.slice(), info);
      }
    }
    if (L) this.senseThreats(alive);
    if (L) this.fly(L, alive, dt);
    this.stepRockets(dt);
    this.stepMissiles(dt);
    this.stepFlares(dt);
    this.stepPilots(dt);
    this.flushRadio();
    if (this.splashes.length && this.time - this.splashes[0].t > 6) this.splashes.shift();
  }

  fly(L, alive, dt) {
    const T = this.attack?.T ?? this.target;
    const mode = this.mode;
    if (mode === 'flank') return this.flyFlank(alive, dt);
    // the leader
    let dvL;
    if (mode === 'engage') {
      const A = [T[0], this.ground + Math.max(0.5 * (this.alt - this.ground), 4 * this.spacing), T[2]];
      dvL = this.to(L, A, 1.1);
      const dh = hyp(T[0] - L.p[0], T[2] - L.p[2]);
      const ahead = (T[0] - L.p[0]) * Math.cos(L.h) - (T[2] - L.p[2]) * Math.sin(L.h);
      if (!this.attack.fired && dh < 6 * this.R && ahead > 0.92 * dh) {
        this.attack.fired = true;
        alive.forEach((m, r) => this.radioQueue.push({ at: this.time + 0.35 * r, m, text: r ? `${NUM[m.i]}, rifle` : `${this.callsign} lead, rifle`, kind: 'fire', fire: true }));
        alive.forEach((m) => this.fire(m, T));
      }
      if (this.attack.fired && (dh < 1.2 * this.R || ahead < 0)) {
        this.call(`${this.callsign}, off target, rejoin, back to the hold`);
        this.attack = null;
        this.setMode('join');
      }
    } else if (mode === 'break') {
      dvL = this.breakV(L);
    } else if (mode === 'rtb') {
      const H = [this.home[0], this.alt, this.home[2]];
      dvL = this.to(L, H, 1.1);
      if (hyp(H[0] - L.p[0], H[2] - L.p[2]) < 1.5 * this.R) {
        this.hold = { c: [this.home[0], this.home[2]], r: this.hold.r };
        this.say(L, `${this.callsign}, overhead mother, holding`, 'order');
        this.setMode('orbit');
      }
    } else {
      dvL = this.orbitV(L, mode === 'join' ? 0.85 : 1);
    }
    this.steer(L, this.separate(L, dvL, alive), dt);
    // the others: their slots (or their break)
    let worst = 0;
    alive.forEach((m, r) => {
      if (r === 0) return;
      const off = slotOffset(this.formation, r, this.spacing);
      let dv;
      if (mode === 'break') dv = this.breakV(m);
      else {
        dv = this.slotV(m, L, off);
        const S = slotPoint(L.p, L.h, off);
        worst = Math.max(worst, Math.hypot(S[0] - m.p[0], S[1] - m.p[1], S[2] - m.p[2]));
      }
      this.steer(m, this.separate(m, dv, alive), dt, mode === 'join' ? 1.45 : 1.3);
    });
    if (mode === 'break' && this.modeT > 7) {
      this.call(`${this.callsign}, knock it off, rejoin on me`);
      this.setMode('join');
    }
    if (mode === 'join') {
      this.joinedT = worst < Math.max(10, 0.4 * this.spacing) ? this.joinedT + dt : 0;
      if (this.joinedT > 1.5) {
        this.say(L, `${this.callsign}, joined, ${FORMATIONS[this.formation].toLowerCase()}`, 'order');
        this.setMode('orbit');
      }
    }
    if (mode === 'orbit' && this.on && this.modeT > this.holdTime) this.programme();
  }

  breakV(m) {
    const s = 1.3 * this.cruise;
    const minAlt = this.ground + Math.max(40, 3 * this.spacing);
    const climb = m.p[1] < minAlt ? 0.3 : m.breakClimb ?? 0;
    const h = m.breakH ?? m.h;
    return [Math.cos(h) * s, climb * s, -Math.sin(h) * s];
  }

  flyFlank(alive, dt) {
    const T = this.attack.T;
    const A = [T[0], this.ground + Math.max(0.5 * (this.alt - this.ground), 4 * this.spacing), T[2]];
    let done = 0;
    for (const el of this.elements) {
      const ids = el.ids.filter((m) => m.alive);
      if (!ids.length) {
        done++;
        continue;
      }
      const E = ids[0];
      el.t += dt;
      let dv;
      if (el.phase === 'out') {
        dv = this.to(E, [el.pt[0], this.alt, el.pt[1]], 1.15);
        if (hyp(el.pt[0] - E.p[0], el.pt[1] - E.p[2]) < 1.2 * this.R || el.t > 40 + (12 * this.R) / this.cruise) {
          el.phase = 'ready';
          this.say(E, `${E === this.leader ? this.callsign + ' lead' : NUM[E.i]}, in position, ${el.side < 0 ? 'left' : 'right'}`, 'reply');
        }
      } else if (el.phase === 'ready') {
        // hold at the bracket point until every element is there: then in from both sides at once
        dv = this.orbitV(E, 0.9, { c: el.pt, r: this.R * 1.1 });
        if (this.elements.every((x) => x.phase !== 'out' || !x.ids.some((m) => m.alive)) || el.t > 60 + (12 * this.R) / this.cruise) {
          for (const x of this.elements) if (x.phase === 'ready') x.phase = 'in';
          this.say(this.leader, `${this.callsign}, in, in, now! Cleared hot`, 'order');
        }
      } else if (el.phase === 'in') {
        dv = this.to(E, A, 1.15);
        const dh = hyp(T[0] - E.p[0], T[2] - E.p[2]);
        const ahead = (T[0] - E.p[0]) * Math.cos(E.h) - (T[2] - E.p[2]) * Math.sin(E.h);
        if (!el.fired && dh < 6 * this.R && ahead > 0.92 * dh) {
          el.fired = true;
          for (const m of ids) this.fire(m, T);
          this.say(E, `${NUM[E.i]}, rifle`, 'fire');
        }
        if (el.fired && (dh < 1.2 * this.R || ahead < 0)) {
          el.phase = 'off';
          el.t = 0;
          this.say(E, `${NUM[E.i]}, off target`, 'reply');
        }
      } else {
        // off the target: pull away on your own side, then back up to the hold height
        const f = fwdOf(E.h);
        const rt = rightOf(E.h);
        dv = [(f[0] + el.side * rt[0] * 0.6) * this.cruise, (this.alt - E.p[1]) * 0.3, (f[2] + el.side * rt[2] * 0.6) * this.cruise];
        if (el.t > 5) done++;
      }
      this.steer(E, this.separate(E, dv, alive), dt, 1.3);
      // the wingman on his element lead, on the outside
      ids.slice(1).forEach((m, k) => {
        const off = [-0.8 * (k + 1) * this.spacing, 0, el.side * (k + 1) * this.spacing];
        this.steer(m, this.separate(m, this.slotV(m, E, off), alive), dt, 1.4);
      });
    }
    if (done >= this.elements.length || this.modeT > 90 + (20 * this.R) / this.cruise) {
      this.elements = null;
      this.attack = null;
      this.call(`${this.callsign}, good hits, rejoin on me`);
      this.setMode('join');
    }
  }

  stepRockets(dt) {
    const T = this.attack?.T ?? this.target;
    for (let k = this.rockets.length - 1; k >= 0; k--) {
      const r = this.rockets[k];
      r.t += dt;
      r.v[1] -= G * dt;
      for (let j = 0; j < 3; j++) r.p[j] += r.v[j] * dt;
      const near = T && Math.hypot(r.p[0] - T[0], r.p[1] - T[1], r.p[2] - T[2]) < 6;
      if (r.p[1] <= this.floor(r.p[0], r.p[2]) || near || r.t > 15) {
        this.rockets.splice(k, 1);
        if (r.t <= 15) {
          this.splashes.push({ id: (this.splashN = (this.splashN ?? 0) + 1), p: r.p.slice(), t: this.time });
          this.o.impact?.(r.p, this.members[r.by]);
        }
      }
    }
  }

  /* ---------------- threats and evasion ---------------- */
  /**
   * Something coming at the flight: { kind: 'rocket' | 'missile' | 'gun' | 'dragon', p, v } (world
   * frame, m and m/s). Seen in the next step: whoever it threatens evades.
   */
  warn(t) {
    this.pending.push(t);
  }
  /** A missile that tracks member i, fired from `from` (the rig's act, a SAM, ...). */
  launchMissile(from, i, { speed = MISSILE.speed, fuze = MISSILE.fuze } = {}) {
    const m = this.members[i];
    if (!m) return null;
    const d = [m.p[0] - from[0], m.p[1] - from[1], m.p[2] - from[2]];
    const l = Math.hypot(...d) || 1;
    const M = { id: (this.mslN = (this.mslN ?? 0) + 1), p: from.slice(), v: d.map((x) => (x / l) * speed), t: 0, target: { m: i }, speed, fuze };
    this.missiles.push(M);
    return M;
  }
  /**
   * The chance that a shot of `kind` ('rocket' | 'missile' | 'gun') at member i hits it now: 1 for a
   * jet flying straight, less while it manoeuvres (EVADES[kind].hit, eased in over the first half
   * second), a little less again for a gun.
   */
  hitChance(i, kind = 'rocket') {
    const m = this.members[i];
    if (!m?.alive) return 0;
    const E = m.evade;
    if (!E) return 1;
    const k = Math.min(1, E.t / 0.5);
    const h = EVADES[E.kind].hit;
    return (1 - (1 - h) * k) * (kind === 'gun' ? 0.8 : 1);
  }
  /** Does this shot hit (the flight's seeded numbers)? */
  rollHit(i, kind = 'rocket') {
    return this.erand() < this.hitChance(i, kind);
  }

  /**
   * Who is threatened by what (the warnings, the missiles in the air, o.threats()): each threatened
   * jet not already evading starts a manoeuvre, and a wingman calls it.
   */
  senseThreats(alive) {
    const list = [...this.pending, ...(this.o.threats?.() ?? [])];
    this.pending.length = 0;
    for (const M of this.missiles) if (M.target.m != null) list.push({ kind: 'missile', p: M.p, v: M.v, target: M.target.m });
    for (const t of list) {
      const at = t.target != null ? this.members[t.target] : this.threatened(t, alive);
      if (!at || !at.alive || at.evade) continue;
      // a missile is seen ~5 s out; a rocket or a gun when it is close; a dragon within a few spacings
      const d = Math.hypot(at.p[0] - t.p[0], at.p[1] - t.p[1], at.p[2] - t.p[2]);
      const vv = t.v ? Math.hypot(...t.v) : 0;
      const tgo = vv > 1 ? d / vv : Infinity;
      if (t.kind === 'missile' && tgo > 5) continue;
      if ((t.kind === 'rocket' || t.kind === 'gun') && tgo > 3) continue;
      if (t.kind === 'dragon') {
        // a dragon: close, and coming at it (not one flying off)
        const mv = this.vel(at), v = t.v ?? [0, 0, 0];
        const closing = ((at.p[0] - t.p[0]) * (v[0] - mv[0]) + (at.p[1] - t.p[1]) * (v[1] - mv[1]) + (at.p[2] - t.p[2]) * (v[2] - mv[2])) / (d || 1);
        if (d > 6 * this.spacing || closing < 3) continue;
      }
      this.startEvade(at, t, tgo);
    }
  }
  /** The member a threat t will pass closest to (within 60 m in the next 4 s; a dragon: nearest), or null. */
  threatened(t, alive) {
    let best = null;
    let bd = t.kind === 'dragon' ? 6 * this.spacing : 60;
    for (const m of alive) {
      const v = t.v ?? [0, 0, 0];
      const mv = this.vel(m);
      const r = [m.p[0] - t.p[0], m.p[1] - t.p[1], m.p[2] - t.p[2]];
      const rv = [mv[0] - v[0], mv[1] - v[1], mv[2] - v[2]];
      const vv = rv[0] ** 2 + rv[1] ** 2 + rv[2] ** 2;
      const tc = t.kind === 'dragon' ? 0 : vv > 1e-6 ? clamp(-(r[0] * rv[0] + r[1] * rv[1] + r[2] * rv[2]) / vv, 0, 4) : 0;
      const miss = Math.hypot(r[0] + rv[0] * tc, r[1] + rv[1] * tc, r[2] + rv[2] * tc);
      if (miss < bd) {
        bd = miss;
        best = m;
      }
    }
    return best;
  }
  /** Which manoeuvre against threat t (tgo: s until it gets there). */
  pickEvade(m, t, tgo) {
    const agl = m.p[1] - this.floor(m.p[0], m.p[2]);
    const R = this.cruise ** 2 / (7 * G);
    if (t.kind === 'missile') return tgo > 3.5 ? 'beam' : 'barrelRoll';
    if (t.kind === 'gun') return 'jink';
    if (t.kind === 'dragon') return agl > 2.4 * R + 40 ? 'splitS' : agl > 70 ? 'dive' : 'breakTurn';
    return tgo > 1.2 ? 'breakTurn' : 'barrelRoll';
  }
  /** Start a defensive manoeuvre against t: the call, the side, flares against a missile or a rocket. */
  startEvade(m, t, tgo = 3, kind = null) {
    kind ??= this.pickEvade(m, t, tgo);
    // the threat's bearing: which side, and the clock
    const r = [t.p[0] - m.p[0], t.p[2] - m.p[2]];
    const f = fwdOf(m.h), rt = rightOf(m.h);
    const ahead = r[0] * f[0] + r[1] * f[2], right = r[0] * rt[0] + r[1] * rt[2];
    const side = right >= 0 ? 1 : -1; // (into it: towards the side it comes from)
    let clock = Math.round(((Math.atan2(right, ahead) * 6) / Math.PI + 12) % 12);
    if (clock === 0) clock = 12;
    const want = Math.atan2(-r[1], r[0]); // heading into the threat
    m.evade = { kind, t: 0, dur: EVADES[kind].dur, side, h0: m.h, want, beam: wrap(want + (side * Math.PI) / 2), bank0: m.bank, phase: 0, threat: t.kind, flareT: 0 };
    const flares = t.kind === 'missile' || t.kind === 'rocket';
    if (flares) m.evade.flaresLeft = t.kind === 'missile' ? 4 : 2;
    // the call: a wingman (his element mate first) calls it; he answers
    const al = this.ranked();
    const rk = this.rankOf(m);
    const mate = al.find((o) => o !== m && Math.floor(this.rankOf(o) / 2) === Math.floor(rk / 2)) ?? al.find((o) => o !== m);
    const who = m === this.leader ? 'Lead' : NUM[m.i];
    const what = { missile: 'Missile', rocket: 'Rocket', gun: 'Guns', dragon: 'Dragon' }[t.kind] ?? 'Threat';
    const dir = side > 0 ? 'right' : 'left';
    if (mate) this.say(mate, who + ', break ' + dir + '! ' + what + ', ' + clock + " o'clock!", 'urgent');
    this.say(m, NUM[m.i] + ', ' + (kind === 'barrelRoll' || kind === 'jink' ? 'defending' : 'breaking ' + dir) + (flares ? ', flares' : ''), 'urgent', mate ? 0.9 : 0);
    m.evadeCount = (m.evadeCount ?? 0) + 1;
    m.lastEvade = kind;
    return m.evade;
  }
  /** One step of member m's manoeuvre (its own flying: bank, heading, pitch, speed); at its end, it rejoins. */
  evadeStep(m, dt) {
    const E = m.evade;
    E.t += dt;
    const v = Math.max(40, m.v);
    const q = (7 * G) / v; // pulling 7 g
    const floor = this.floor(m.p[0], m.p[2]);
    const low = m.p[1] - floor < 45;
    const bankTo = (b, rate = 4) => (m.bank += clamp(b - m.bank, -rate * dt, rate * dt));
    const turnBy = (bank) => (m.h = wrap(m.h - Math.sign(Math.tan(bank)) * Math.min(Math.abs(G * Math.tan(bank)) / v, q) * dt));
    const pitchTo = (g, rate = 0.8) => (m.gamma += clamp(g - m.gamma, -rate * dt, rate * dt));
    m.throttle = 1;
    m.v += clamp(1.15 * this.cruise - m.v, -0.2 * this.cruise * dt, 0.25 * this.cruise * dt);
    switch (E.kind) {
      case 'breakTurn': {
        // hard over (~80 degrees of bank) towards the threat, 7 g, until the nose is on it
        const e = wrap(E.want - m.h);
        bankTo(Math.abs(e) > 0.15 ? -Math.sign(e) * 1.42 : 0);
        turnBy(m.bank);
        pitchTo(low ? 0.25 : 0.04);
        if (Math.abs(e) < 0.12 && E.t > 1.5) E.t = Math.max(E.t, E.dur - 0.6);
        break;
      }
      case 'barrelRoll': {
        // round the line of flight, a full roll every 2.4 s, the nose describing a circle (a corkscrew)
        const ph = ((2 * Math.PI) / 2.4) * E.t;
        m.bank = E.bank0 + E.side * ph;
        m.h = wrap(E.h0 - E.side * 0.16 * Math.sin(ph));
        m.gamma = (low ? 0.15 : 0) + 0.13 * (1 - Math.cos(ph)) - 0.06;
        break;
      }
      case 'jink': {
        // hard left, hard right, every 0.7 s, never steady
        const s = Math.floor(E.t / 0.7) % 2 ? -E.side : E.side;
        bankTo(s * 1.3, 6);
        turnBy(m.bank);
        pitchTo(low ? 0.2 : 0.08 * Math.sin(E.t * 4.5), 1.5);
        break;
      }
      case 'splitS': {
        // roll inverted, pull through the bottom of a half loop, out the other way, lower
        if (E.phase === 0) {
          bankTo(E.side * Math.PI, 3.5);
          pitchTo(0, 1);
          if (Math.abs(m.bank - E.side * Math.PI) < 0.05) E.phase = 1;
        } else if (E.phase === 1) {
          m.gamma -= q * dt;
          if (m.gamma <= -Math.PI / 2) {
            // straight down: the same attitude written as heading turned round, wings level again
            m.gamma = -Math.PI / 2 + 1e-3;
            m.h = wrap(m.h + Math.PI);
            m.bank -= E.side * Math.PI;
            E.phase = 2;
          }
        } else {
          m.gamma = Math.min(0, m.gamma + q * dt);
          bankTo(0);
          if (m.gamma >= 0) E.t = Math.max(E.t, E.dur - 0.3);
        }
        break;
      }
      case 'dive': {
        // over and down, steep, then pull out well above the ground
        bankTo(E.side * 0.7);
        turnBy(m.bank);
        if (E.phase === 0) {
          pitchTo(-0.6, 0.9);
          if (m.p[1] - floor < 70 || E.t > E.dur * 0.6) E.phase = 1;
        } else pitchTo(0.15, 1.2);
        break;
      }
      case 'beam': {
        // turn to put the threat on the beam (90 degrees off the nose), and down a little
        const e = wrap(E.beam - m.h);
        bankTo(clamp(-e * 2, -1.35, 1.35));
        turnBy(m.bank);
        pitchTo(low ? 0.2 : -0.1);
        break;
      }
    }
    // flares: a salvo every 0.45 s while the manoeuvre calls for them and it has them
    if (E.flaresLeft > 0 && (E.flareT -= dt) <= 0 && m.flares > 0) {
      E.flareT = 0.45;
      E.flaresLeft--;
      this.dispense(m);
    }
    this.move(m, dt);
    // never into the ground
    if (m.p[1] < floor + 15) {
      m.p[1] = floor + 15;
      m.gamma = Math.max(m.gamma, 0.2);
    }
    if (E.t >= E.dur) {
      m.evade = null;
      m.bank = wrap(m.bank);
      m.gamma = clamp(m.gamma, -0.45, 0.45);
      m.want = null;
      m.ff = 0;
      const who = m === this.leader ? this.callsign + ' lead' : NUM[m.i];
      this.say(m, who + (m === this.leader ? ', clear, back on course' : ', clear, rejoining'), 'reply');
      if (m !== this.leader && this.mode === 'orbit') this.setMode('join');
    }
  }
  /** A salvo of flares from member m: two, out behind it and down, burning for ~4 s. */
  dispense(m) {
    const v = this.vel(m);
    const f = fwdOf(m.h), rt = rightOf(m.h);
    const ids = [];
    for (const s of [-1, 1]) {
      if (m.flares <= 0) break;
      m.flares--;
      const id = (this.flareN = (this.flareN ?? 0) + 1);
      const p = [m.p[0] - f[0] * 6 + rt[0] * s * 1.2, m.p[1] - 1.5, m.p[2] - f[2] * 6 + rt[2] * s * 1.2];
      this.flares.push({ id, p, v: [v[0] * 0.55 + rt[0] * s * 18, v[1] * 0.55 - 12, v[2] * 0.55 + rt[2] * s * 18], t: 0, by: m.i, trail: [p.slice()] });
      ids.push(id);
    }
    // a missile on this jet may take them (one chance per salvo, the flight's own numbers)
    for (const M of this.missiles)
      if (M.target.m === m.i && ids.length && Math.hypot(M.p[0] - m.p[0], M.p[1] - m.p[1], M.p[2] - m.p[2]) < 2500 && this.erand() < FLARE_DECOY) {
        M.target = { flare: ids[0] };
        M.decoyedBy = m.i;
        this.say(m, NUM[m.i] + ", missile's on the flares", 'reply', 1.2);
      }
  }
  stepFlares(dt) {
    for (let k = this.flares.length - 1; k >= 0; k--) {
      const F = this.flares[k];
      F.t += dt;
      for (let j = 0; j < 3; j++) F.v[j] *= Math.exp(-0.9 * dt);
      F.v[1] -= G * dt;
      for (let j = 0; j < 3; j++) F.p[j] += F.v[j] * dt;
      F.tt = (F.tt ?? 0) + dt;
      if (F.tt > 0.06) {
        F.tt = 0;
        F.trail.push(F.p.slice());
        if (F.trail.length > 40) F.trail.shift();
      }
      if (F.t > 4.5 || F.p[1] < this.floor(F.p[0], F.p[2])) this.flares.splice(k, 1);
    }
  }
  /** The missiles: towards their target (a jet, or the flare they took), a proximity fuze. */
  stepMissiles(dt) {
    for (let k = this.missiles.length - 1; k >= 0; k--) {
      const M = this.missiles[k];
      M.t += dt;
      const T = M.target.m != null ? this.members[M.target.m] : null;
      const F = M.target.flare != null ? this.flares.find((x) => x.id === M.target.flare) : null;
      const tp = T?.alive ? T.p : F ? F.p : null;
      const tv = T?.alive ? this.vel(T) : F ? F.v : [0, 0, 0];
      if (tp) {
        // lead pursuit: towards where it will be, turning at most MISSILE.turn
        const d = [tp[0] - M.p[0], tp[1] - M.p[1], tp[2] - M.p[2]];
        const tgo = Math.hypot(...d) / M.speed;
        const aim = [d[0] + tv[0] * tgo, d[1] + tv[1] * tgo, d[2] + tv[2] * tgo];
        const al = Math.hypot(...aim) || 1;
        const dv = aim.map((x, j) => (x / al) * M.speed - M.v[j]);
        const dl = Math.hypot(...dv);
        const lim = MISSILE.turn * dt;
        const s = dl > lim ? lim / dl : 1;
        for (let j = 0; j < 3; j++) M.v[j] += dv[j] * s;
        const vl = Math.hypot(...M.v) || 1;
        for (let j = 0; j < 3; j++) M.v[j] *= M.speed / vl;
      }
      const prev = M.p.slice();
      for (let j = 0; j < 3; j++) M.p[j] += M.v[j] * dt;
      M.trail ??= [];
      M.tt = (M.tt ?? 0) + dt;
      if (M.tt > 0.05) {
        M.tt = 0;
        M.trail.push(M.p.slice());
        if (M.trail.length > 60) M.trail.shift();
      }
      let gone = M.t > MISSILE.life || M.p[1] < this.floor(M.p[0], M.p[2]);
      if (tp && !gone) {
        // the closest approach on this step within the fuze: it goes off
        const a = [prev[0] - tp[0], prev[1] - tp[1], prev[2] - tp[2]];
        const ab = [M.p[0] - prev[0], M.p[1] - prev[1], M.p[2] - prev[2]];
        const s = clamp(-(a[0] * ab[0] + a[1] * ab[1] + a[2] * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1), 0, 1);
        const miss = Math.hypot(a[0] + ab[0] * s, a[1] + ab[1] * s, a[2] + ab[2] * s);
        if (miss < M.fuze) {
          gone = true;
          this.splashes.push({ id: (this.splashN = (this.splashN ?? 0) + 1), p: M.p.slice(), t: this.time, air: true });
          if (T?.alive) {
            // a jet manoeuvring hard may still slip it (the fuze goes off too far out)
            if (this.rollHit(T.i, 'missile')) {
              M.hit = true;
              this.hit(T.i, ['engines', 'wingL', 'wingR', 'tail', 'fuel'][Math.floor(this.erand() * 5)], 350);
            } else {
              M.slipped = true;
              this.say(T, NUM[T.i] + ', it missed me', 'reply', 0.5);
            }
          }
        }
      }
      if (gone) {
        M.done = true;
        this.missiles.splice(k, 1);
      }
    }
  }

  /** The leader's own programme while holding (AI on). */
  programme() {
    const n = this.ranked().length;
    const seq = ['formation', 'flank', 'formation', 'engage', 'break', 'formation', 'rtb'];
    for (let tries = 0; tries < seq.length; tries++) {
      const k = seq[this.script % seq.length];
      this.script++;
      if (k === 'formation') {
        this.formCycle = (this.formCycle + 1) % FORMATION_KEYS.length;
        if (this.order('formation', { formation: FORMATION_KEYS[this.formCycle] })) return;
      } else if (k === 'flank' && n < 2) continue;
      else if (k === 'rtb' && hyp(this.home[0] - this.hold.c[0], this.home[2] - this.hold.c[1]) < 1) continue;
      else if (this.order(k)) return;
    }
    this.modeT = 0;
  }

  /** The members' positions etc. (for tests and saving). */
  snapshot() {
    return {
      lead: this.lead,
      mode: this.mode,
      formation: this.formation,
      members: this.members.map((m) => ({ p: m.p.map((x) => +x.toFixed(6)), h: +m.h.toFixed(6), v: +m.v.toFixed(6), alive: m.alive, rockets: m.rockets })),
    };
  }
}

/**
 * The flights of a simulated world (world.flights, from models/jetFlight.js): their AIs, made
 * the first time, stepped with the simulation. Their rockets that come down inside the world
 * become the simulation's own (they explode there); out at sea they splash.
 */
export function stepWorldFlights(sim, dt) {
  const w = sim.world;
  for (const f of w.flights) {
    if (!f.ai) {
      const seaY = w.sea ? w.sea.level : 0;
      f.ai = new FlightAI({
        ...f,
        floor: () => seaY,
        wind: () => {
          const D = deriveWeather(sim.weather);
          return [D.windX ?? 0, D.windZ ?? 0];
        },
        radio: (m, text, kind) => w.events.push({ type: 'flightRadio', pos: m.p.slice(), time: w.time, name: `${m.call}: ${text}`, kind }),
        // a dragon in the air coming at them: they evade it (senseThreats)
        threats: () => (w.dragons ?? []).filter((d) => d.health > 0 && d.mode === 'air' && d.chest).map((d) => ({ kind: 'dragon', p: d.chest, v: [Math.sin(d.yaw) * d.speed, d.vy ?? 0, Math.cos(d.yaw) * d.speed] })),
        // the simulation's own sea (or ground) where it comes down: the blast, the crater, the fire
        water: (x, z) => !(x > 0 && z > 0 && x < w.size[0] && z < w.size[2]) || !!w.sea,
        crash: (m, p, info) => {
          if (p[0] > 0 && p[2] > 0 && p[0] < w.size[0] && p[2] < w.size[2]) jetImpact(sim, p, { ...info, name: m.call });
          else w.events.push({ type: 'jetCrash', pos: p, time: w.time, name: m.call, far: true });
        },
        impact: (p) => {
          if (p[0] > 0 && p[2] > 0 && p[0] < w.size[0] && p[2] < w.size[2] && p[1] < w.size[1]) sim.fireRocket?.([p[0], p[1] + 2, p[2]], [0, -40, 0]);
        },
      });
    }
    f.ai.step(dt);
  }
}
