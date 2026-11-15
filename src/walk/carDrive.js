import * as THREE from 'three';
import { carNear, boardCar, leaveCar, driverOf } from '../sim/cars.js';
import { pedals, startEngine, stopEngine, carToWorld } from '../sim/carPhysics.js';
import { gateNear, gatePassable, requestGate, callsignOf } from '../sim/gates.js';

/**
 * Driving a car yourself (one of the world's cars: sim/cars.js; the dynamics: sim/carPhysics.js).
 * Walk up to one and press E by a front door: you take the driver's seat (someone else at the
 * wheel: not this one) and turn the key. The simulation keeps stepping the car (sim/simulation.js
 * → stepCars): this only puts your hands and feet on its controls (c.input), follows it with the
 * camera and shows the instruments.
 *
 * Controls (an automatic)
 *   W / S        on / brake; held S at a standstill: into reverse (then S is on and W brakes)
 *   A / D        steer left / right (the wheel comes back when you let go)
 *   Space        the handbrake (the rear wheels lock: it slides)
 *   H            the horn;   R  the engine off / on (it cranks: a burnt engine or an empty tank won't start)
 *   G            at a closed gate (sim/gates.js: the military base's barrier): radio the base to
 *                raise it (the horn at it does too); the base answers (the radio, its words on
 *                the screen), a sentry raises it, it comes down behind you. A car not theirs (or
 *                them fighting you there): refused, and the sentries come for you
 *   mouse        look round it (the camera comes back behind it)
 *   E            get out (once it is slow); you are put down by the driver's door
 * You hear it (and every other car) from its engine, tyres and wind: audio/carSound.js. Rounds
 * hit you in it as on foot. An EV shows its charge and range (the motor's rpm, regenerating when
 * you brake or lift off); a hybrid its charge and whether its engine is running (EV / series /
 * parallel). The steering wheel in the cab turns with A / D (the steering ratio: sim/carPhysics.js)
 * and you are drawn at it, your hands on its rim (render/cars.js).
 */
const clamp = (v, a = -1, b = 1) => (v < a ? a : v > b ? b : v);

export class CarDrive {
  constructor(walk, sim, c) {
    this.walk = walk;
    this.view = walk.view;
    this.sim = sim;
    this.c = c;
    this.me = { player: true, name: 'you', mass: 85 };
    this.seat = driverOf(c) ? -1 : boardCar(c, this.me, 'drive');
    this.steer = 0;
    this.look = [0, 0];
    this.camPos = null;
    this.seenEvents = sim.world.events?.length ?? 0;
    if (this.seat < 0) return;
    c.player = true;
    c.drive = null;
    if (!c.running) startEngine(c);
    this.hud = document.createElement('div');
    this.hud.className = 'flightHud';
    Object.assign(this.hud.style, {
      position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)', padding: '8px 14px',
      font: '13px/1.4 ui-monospace, monospace', color: '#ffe9c8', background: 'rgba(28,14,0,0.55)', border: '1px solid #a76',
      borderRadius: '6px', pointerEvents: 'none', zIndex: 30, whiteSpace: 'pre',
    });
    document.body.appendChild(this.hud);
  }

  /** The car whose door you are by (sim/cars.js carNear), or null. */
  static near(w, p) {
    return carNear(w, p);
  }

  mouse(dx, dy) {
    this.look[0] = clamp(this.look[0] - dx * 0.004, -Math.PI, Math.PI);
    this.look[1] = clamp(this.look[1] - dy * 0.003, -0.5, 0.9);
    this.lookT = 0;
  }

  /** The controls from the keys (pure: the tests drive the car the same way): ahead, back 0..1, steer (+ left), handbrake, horn. */
  static controlsFrom(keys) {
    const k = (c) => (keys.has(c) ? 1 : 0);
    return {
      ahead: Math.max(k('KeyW'), k('ArrowUp')),
      back: Math.max(k('KeyS'), k('ArrowDown')),
      steer: Math.max(k('KeyA'), k('ArrowLeft')) - Math.max(k('KeyD'), k('ArrowRight')),
      handbrake: !!k('Space'),
      horn: !!k('KeyH'),
    };
  }

  /** R: the engine off, or turn the key. */
  engine() {
    const c = this.c;
    if (c.running) {
      stopEngine(c, 'off');
      return this.walk.say(c.spec.single ? 'Power off' : 'Engine off', 1.5);
    }
    if (!startEngine(c)) this.walk.say(c.dead ? `It will not start: ${c.why ?? 'the engine is wrecked'}` : c.spec.single ? 'Starting up' : 'It is turning over', 2);
  }

  update(dt, keys) {
    if (this.done) return;
    const c = this.c;
    const o = CarDrive.controlsFrom(keys);
    // (the wheel turns as fast as hands turn it, and comes back by itself)
    this.steer += clamp(o.steer - this.steer, -dt * 3, dt * 3);
    c.input = { ...pedals(c, o.ahead, o.back), steer: this.steer, handbrake: o.handbrake };
    // the horn at a closed gate: as good as a call (G)
    if (o.horn && !this.hornWas) {
      const g = gateNear(this.sim.world, [c.x, c.y, c.z], 18);
      if (g && !gatePassable(g)) this.radioGate();
    }
    this.hornWas = o.horn;
    c.horn = o.horn;
    this.radioLines();
    this.fireRequested = this.flaresRequested = false;
    this.lookT = (this.lookT ?? 0) + dt;
    if (this.lookT > 1.5) {
      this.look[0] *= Math.exp(-2 * dt);
      this.look[1] *= Math.exp(-2 * dt);
    }
    if (c.burning && !this.warned) {
      this.warned = true;
      this.walk.say('🔥 The car is on fire – get out (E)', 4);
    }
    this.draw(dt);
  }

  /** The chase camera behind it (it does not roll with it) and the instruments. */
  draw(dt) {
    const c = this.c, S = c.spec;
    const a = c.yaw + this.look[0];
    const back = new THREE.Vector3(-Math.cos(a), 0, Math.sin(a));
    const target = new THREE.Vector3(c.x, c.y + S.H * 0.8, c.z);
    const d = S.L * 1.4 + 2.5 + Math.min(4, Math.abs(c.u) * 0.08);
    const want = target.clone().addScaledVector(back, d * Math.cos(this.look[1])).add(new THREE.Vector3(0, 1.4 + d * Math.sin(this.look[1] + 0.12), 0));
    if (!this.camPos) this.camPos = want.clone();
    this.camPos.lerp(want, Math.min(1, dt * 6));
    // (not under the ground)
    const gy = this.walk.floorAt?.(this.camPos.x, this.camPos.z, this.camPos.y + 1) ?? -Infinity;
    if (Number.isFinite(gy) && this.camPos.y < gy + 0.5) this.camPos.y = gy + 0.5;
    const cam = this.view.camera;
    cam.position.copy(this.camPos);
    cam.up.set(0, 1, 0);
    cam.lookAt(target.clone().add(new THREE.Vector3(Math.cos(c.yaw), 0, -Math.sin(c.yaw)).multiplyScalar(2)));
    cam.updateMatrixWorld();
    const kmh = Math.round(Math.abs(c.u) * 3.6);
    const ev = S.powertrain === 'electric', hyb = S.powertrain === 'hybrid';
    const gear = c.mode === 'D' ? `D${c.gear > 0 && !S.single ? c.gear : ''}` : c.mode;
    const E = S.engine;
    const top = ev ? S.motor.rpmMax : E.redline;
    const bar = '█'.repeat(Math.round((10 * Math.min(c.rpm, top)) / top)).padEnd(10, '·');
    const warn = [];
    if (c.burning) warn.push('🔥 ON FIRE');
    if (c.dead) warn.push(`⚠ ${ev ? 'DRIVE' : 'ENGINE'} DEAD (${c.why ?? 'wrecked'})`);
    else if (!c.running && c.crank <= 0) warn.push(ev && c.soc <= 0.01 ? '⚠ BATTERY FLAT' : !ev && !hyb && (c.why === 'out of fuel' || c.fuel <= 0.05) ? '⚠ NO FUEL' : `${ev || hyb ? 'off' : 'engine off'}${c.why && c.why !== 'off' ? ` (${c.why})` : ''}: R to start`);
    if (c.crank > 0) warn.push(S.single ? 'starting…' : 'cranking…');
    if (c.damage > 0.05) warn.push(`damage ${Math.round(c.damage * 100)}%`);
    if (c.skid > 0.4) warn.push('SKIDDING');
    if ((c.regenF ?? 0) > 50 && c.running) warn.push('regen');
    const drive = { fwd: 'FWD', rwd: 'RWD', awd: '4×4', '4x4': '4×4 LOCK' }[S.drive.kind];
    const energy = ev
      ? `charge ${Math.round(c.soc * 100)}%  range ${Math.round(c.range)} km`
      : hyb
      ? `charge ${Math.round(c.soc * 100)}%  fuel ${c.fuel.toFixed(1)} l  engine ${c.ice.on ? c.ice.mode : 'off'}`
      : `fuel ${c.fuel.toFixed(1)} l`;
    this.hud.textContent =
      `${c.label.toUpperCase()} ${drive}  ${String(kmh).padStart(3)} km/h   ${gear.padEnd(3)}  ${String(Math.round(c.rpm)).padStart(5)} rpm ${bar}   ${energy}\n` +
      `W/S on / brake (S at rest: reverse)  A/D steer  Space handbrake  H horn  R ${S.single ? 'power' : 'engine'}  E get out` +
      (this.gateHint() ? `
${this.gateHint()}` : '') +
      (warn.length ? `\n${warn.join('   ')}` : '');
  }

  /** G: radio the base to raise the gate you are at (sim/gates.js requestGate). */
  radioGate() {
    const w = this.sim.world, c = this.c;
    const g = gateNear(w, [c.x, c.y, c.z], 30);
    if (!g) return this.walk.say('No gate near enough to call', 2);
    if (g.state === 'broken') return this.walk.say(`${g.name}: smashed – drive on through`, 2);
    if (gatePassable(g)) return this.walk.say(`${g.name}: open – drive on through`, 2);
    this.gateReq = requestGate(w, g, { car: c, player: true, callsign: callsignOf(c) });
  }

  /** What the gates say on the radio (sim/gates.js), on the screen as you hear it. */
  radioLines() {
    const ev = this.sim.world.events ?? [];
    for (; this.seenEvents < ev.length; this.seenEvents++) {
      const e = ev[this.seenEvents];
      if (e.type === 'radio' && e.gate && Math.hypot(e.pos[0] - this.c.x, e.pos[2] - this.c.z) < 80) this.walk.say(`📻 ${e.name}`, 4);
    }
  }

  /** X: no ejection seat. */
  eject() {
    this.walk.say('E to get out', 2);
  }

  /** The gate you are at, in a word (the instruments' line). */
  gateHint() {
    const c = this.c;
    const g = gateNear(this.sim.world, [c.x, c.y, c.z], 30);
    if (!g) return '';
    if (g.state === 'closed') return this.gateReq && !this.gateReq.done && this.gateReq.answer !== 'denied' ? `${g.name}: waiting for ${g.callsign}` : `${g.name} closed: G (or the horn) to radio ${g.callsign}`;
    return `${g.name}: ${g.state}`;
  }

  /** E: out by the driver's door (or the other, if that side is blocked), once it is slow. */
  tryExit(force = false) {
    const c = this.c;
    if (!force && Math.abs(c.u) > 2.5) return this.walk.say('Slow down first', 1.5);
    const sx = c.seats[this.seat]?.at[0] ?? 0;
    const sides = [-1, 1].map((s) => carToWorld(c, [sx, 0.2, s * (c.spec.W / 2 + 0.7)]));
    const free = sides.find((p) => !this.walk.blocked?.(p[0], p[2], c.y, 1.6)) ?? sides[0];
    this.end(force && Math.abs(c.u) > 2.5 ? 'You throw yourself out' : null, [free[0], c.y, free[2]]);
  }

  end(msg, at) {
    this.dispose();
    this.walk.endFlight(msg, [at[0], at[1], at[2]]);
  }

  dispose() {
    if (this.done) return;
    this.done = true;
    this.hud?.remove();
    const c = this.c;
    if (this.seat >= 0) {
      leaveCar(c, this.me);
      c.player = false;
      c.horn = false;
      c.input = { throttle: 0, brake: 1, steer: 0, handbrake: true };
    }
  }
}
