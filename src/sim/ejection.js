/**
 * Ejection and the parachute, for any jet's pilot (the player: walk/flight.js; a flight's pilots:
 * ai/flight.js; the rig: rig/vehicles.js, rig/pilot.js). Pure: plain arrays, no three.js, no
 * Math.random.
 *
 *   ejectionEnvelope({ height, sink, pitch, roll, cockpit })  // { ok, reason, need }
 *     Possible only with time for it: the seat needs height in proportion to the sink rate and
 *     more when the jet is inverted or diving steeply (it fires the pilot towards the ground); a
 *     destroyed cockpit (the pilot hit) cannot eject. A zero-zero seat: level on the ground is fine.
 *
 *   const c = new Chute({ p, v, heading, up });  // fired from the cockpit, `up`: the seat's way out
 *   c.step(dt, { left, right, flare }, wind, ground)  // events: 'separate', 'open', 'land' | 'plf' | 'splashdown'
 *   c.phase   'seat' (rocket) → 'free' (man-seat separation) → 'deploy' (inflating) → 'open'
 *             → 'plf' (parachute landing fall: a roll) → 'landed' | 'afloat' (in the water, the life vest)
 *   c.pose()  what the figure does: seated, eject, tumble, hang, steerLeft, steerRight, flare, plf, stand, float
 *
 * Under the canopy: ~5 m/s down, ~4 m/s forward where it points, plus the wind; a toggle pulled
 * turns it (0.9 rad/s); both pulled (flare) slows the sink and the forward speed for a few seconds,
 * which is what you do just before touching down.
 */

export const SEAT = { burn: 0.25, accel: 110, separate: 0.7, deployAt: 1.2, inflate: 1.4 };
export const CANOPY = { sink: 5, forward: 4, turn: 0.9, flareSink: 1.6, flareForward: 1.5, flareTime: 3 };
const G = 9.81;

/** Can the pilot get out (and under a canopy) from here? */
export function ejectionEnvelope({ height = 0, sink = 0, pitch = 0, roll = 0, cockpit = 0 } = {}) {
  if (cockpit >= 1) return { ok: false, reason: 'the cockpit is destroyed: the pilot is hit', need: Infinity };
  const inverted = Math.cos(roll) * Math.cos(pitch) < 0;
  // the seat fires along the jet's "up": inverted it fires downwards, so it needs much more height
  const need = 2 + Math.max(0, sink) * 1.6 + (pitch < -0.6 ? 25 * (-pitch - 0.6) : 0) + (inverted ? 60 : Math.abs(Math.sin(roll)) * 20);
  if (height < need) return { ok: false, reason: `too low (${Math.round(height)} m, needs ${Math.round(need)} m)`, need };
  return { ok: true, reason: 'clear', need };
}

export class Chute {
  constructor({ p, v = [0, 0, 0], heading = 0, up = [0, 1, 0] }) {
    this.p = p.slice();
    this.v = v.slice();
    this.up = up.slice();
    this.heading = heading;
    this.phase = 'seat';
    this.t = 0;
    this.inflate = 0;
    this.flareT = 0;
    this.turn = 0;
    this.sinkAtTouch = 0;
    this.events = [];
  }

  get open() {
    return this.phase === 'deploy' || this.phase === 'open';
  }
  get down() {
    return this.phase === 'plf' || this.phase === 'landed' || this.phase === 'afloat';
  }

  /**
   * @param input { left, right, flare } (booleans)
   * @param wind [wx, wz] m/s
   * @param ground (x, z) → { y, water } under the pilot
   */
  step(dt, input = {}, wind = [0, 0], ground = () => ({ y: 0, water: false })) {
    const ev = [];
    this.t += dt;
    const g = ground(this.p[0], this.p[2]);
    if (this.phase === 'plf') {
      if (this.t - this.landT > 1.2) {
        this.phase = 'landed';
        ev.push('land');
      }
      return ev;
    }
    if (this.phase === 'landed' || this.phase === 'afloat') {
      // afloat: drifting a little with the wind
      if (this.phase === 'afloat') {
        this.p[0] += wind[0] * 0.05 * dt;
        this.p[2] += wind[1] * 0.05 * dt;
      }
      return ev;
    }
    if (this.phase === 'seat') {
      // the rocket: out along the seat's way out
      const a = this.t < SEAT.burn ? SEAT.accel : 0;
      for (let k = 0; k < 3; k++) this.v[k] += this.up[k] * a * dt;
      this.v[1] -= G * dt;
      if (this.t > SEAT.separate) {
        this.phase = 'free';
        ev.push('separate');
      }
    } else if (this.phase === 'free') {
      this.v[1] -= G * dt;
      // air drag slows the man falling away from the seat
      const s = Math.hypot(...this.v);
      const k = Math.min(0.5, 0.004 * s) * dt * 10;
      for (let i = 0; i < 3; i++) this.v[i] *= 1 - k;
      if (this.t > SEAT.deployAt) {
        this.phase = 'deploy';
        this.deployT = this.t;
        ev.push('open');
      }
    } else {
      if (this.phase === 'deploy') {
        this.inflate = Math.min(1, (this.t - this.deployT) / SEAT.inflate);
        if (this.inflate >= 1) this.phase = 'open';
      }
      // steering: one toggle turns; both (a flare) slows it all down for a few seconds
      const flaring = input.flare || (input.left && input.right);
      this.flareT = flaring ? this.flareT + dt : 0;
      const flare = flaring && this.flareT < CANOPY.flareTime ? 1 : 0;
      this.turn = flare ? 0 : (input.left ? 1 : 0) - (input.right ? 1 : 0);
      this.heading += this.turn * CANOPY.turn * this.inflate * dt;
      const fwd = flare ? CANOPY.flareForward : CANOPY.forward;
      const sink = flare ? CANOPY.flareSink : CANOPY.sink;
      const tx = Math.cos(this.heading) * fwd + wind[0] * 0.8;
      const tz = -Math.sin(this.heading) * fwd + wind[1] * 0.8;
      const k = Math.min(1, (dt / 1.5) * Math.max(0.2, this.inflate));
      this.v[0] += (tx - this.v[0]) * k;
      this.v[2] += (tz - this.v[2]) * k;
      // the canopy takes hold as it fills (a jolt), then a steady sink
      this.v[1] += (-sink - this.v[1]) * Math.min(1, (dt / 0.7) * Math.max(0.15, this.inflate));
    }
    for (let k = 0; k < 3; k++) this.p[k] += this.v[k] * dt;
    if (this.p[1] <= g.y) {
      this.p[1] = g.y;
      this.sinkAtTouch = -this.v[1];
      this.v = [0, 0, 0];
      this.landT = this.t;
      if (g.water) {
        this.phase = 'afloat';
        ev.push('splashdown');
      } else if (this.sinkAtTouch > 2.5) {
        this.phase = 'plf';
        ev.push('plf');
      } else {
        this.phase = 'landed';
        ev.push('land');
      }
    }
    this.events.push(...ev);
    return ev;
  }

  /** What the pilot's figure does now. */
  pose() {
    switch (this.phase) {
      case 'seat':
        return 'eject';
      case 'free':
        return 'tumble';
      case 'deploy':
        return 'hang';
      case 'plf':
        return 'plf';
      case 'landed':
        return 'stand';
      case 'afloat':
        return 'float';
    }
    if (this.flareT > 0 && this.flareT < CANOPY.flareTime) return 'flare';
    return this.turn > 0 ? 'steerLeft' : this.turn < 0 ? 'steerRight' : 'hang';
  }
}

/**
 * An AI pilot's hands on the toggles: towards `goal` ([x, z], or none: into the wind), and a
 * flare a few metres above the ground.
 */
export function chuteInput(c, height, goal = null, wind = [0, 0]) {
  if (!c.open) return {};
  if (height < 6) return { flare: true };
  let want;
  if (goal) want = Math.atan2(-(goal[1] - c.p[2]), goal[0] - c.p[0]);
  else if (Math.hypot(...wind) > 0.5) want = Math.atan2(wind[1], -wind[0]); // facing into the wind
  else return {};
  const e = Math.atan2(Math.sin(want - c.heading), Math.cos(want - c.heading));
  return { left: e > 0.15, right: e < -0.15 };
}
