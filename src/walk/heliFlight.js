import * as THREE from 'three';
import { heliToWorld, HELI } from '../ai/helicopter.js';

/**
 * Flying a helicopter (ai/helicopter.js, one of the simulation's w.helis) yourself. Walk up to one
 * on the ground and press E by its cockpit (walk.js interact): you take the pilot's seat
 * (Helicopter.board: an enemy crew get out and fight, a friendly pilot moves to the back, a
 * friendly crew stay at the guns). The simulation keeps stepping it (sim/simulation.js → HeliAI):
 * this only puts your hands on the controls (h.controls), follows it with the camera and shows
 * the instruments; its hit parts, failures and crashes are the same as for its own pilot.
 *
 * Controls (as the jet's, walk/flight.js, where they mean the same thing):
 *   W / S        collective up / down (let go: it holds its height)
 *   A / D        pedals: the nose left / right (at speed a bank turns you too)
 *   mouse        cyclic: forward and back tilt the nose (mouse up: nose up, as in the jet),
 *                left and right bank; the stick centres itself when you let go
 *   arrow keys   the cyclic from the keyboard (↑ nose down: forward)
 *   G            at a steady hover low enough: the troops in the back fast-rope down (again: cut the ropes)
 *   E            climb out, once it is on the ground and still
 * The crew in the back fight from the open doors on their own (what they identify: ai/helicopter.js).
 */
const clamp = (v, a = -1, b = 1) => (v < a ? a : v > b ? b : v);

export class HeliFlight {
  constructor(walk, sim, spec) {
    this.walk = walk;
    this.view = walk.view;
    this.sim = sim;
    this.spec = spec;
    this.h = spec.ai;
    this.h.board();
    this.cyc = [0, 0]; // the mouse's cyclic: [nose up, bank right]
    this.collective = 0;
    this.crashT = 0;
    this.camPos = null;
    this.hud = document.createElement('div');
    this.hud.className = 'flightHud';
    Object.assign(this.hud.style, {
      position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)', padding: '8px 14px',
      font: '13px/1.4 ui-monospace, monospace', color: '#b8ffb0', background: 'rgba(0,20,0,0.55)', border: '1px solid #3a6',
      borderRadius: '6px', pointerEvents: 'none', zIndex: 30, whiteSpace: 'pre',
    });
    document.body.appendChild(this.hud);
  }

  mouse(dx, dy) {
    this.cyc[0] = clamp(this.cyc[0] - dy * 0.004);
    this.cyc[1] = clamp(this.cyc[1] + dx * 0.004);
  }

  /** The controls from the keys and the mouse (pure: the tests drive the helicopter the same way). */
  static controlsFrom(keys, cyc, collective, dt) {
    const k = (c) => (keys.has(c) ? 1 : 0);
    const col = collective + ((k('KeyW') - k('KeyS')) - collective) * Math.min(1, dt * 4);
    return {
      collective: col,
      pitch: clamp(-cyc[0] + k('ArrowUp') - k('ArrowDown')),
      roll: clamp(cyc[1] + k('ArrowRight') - k('ArrowLeft')),
      pedal: k('KeyA') - k('KeyD'),
    };
  }

  update(dt, keys) {
    if (this.done) return;
    const h = this.h;
    // the stick centres itself (the jet's mouse does the same)
    this.cyc[0] *= Math.exp(-2.5 * dt);
    this.cyc[1] *= Math.exp(-2.5 * dt);
    const c = HeliFlight.controlsFrom(keys, this.cyc, this.collective, dt);
    this.collective = c.collective;
    if (h.player) h.controls = c;
    // the space bar and F do nothing here (no rockets, no flares): forget them
    this.fireRequested = this.flaresRequested = false;
    if (h.crashed) {
      this.crashT += dt;
      if (this.crashT > 2.5) return this.endCrash();
    }
    this.draw(dt);
  }

  /** The chase camera behind it (level: it does not roll with it) and the instruments. */
  draw(dt) {
    const h = this.h;
    const f0 = new THREE.Vector3(Math.sin(h.yaw), 0, Math.cos(h.yaw));
    const p = new THREE.Vector3(...h.p).add(new THREE.Vector3(0, 2, 0));
    const want = p.clone().addScaledVector(f0, -17).add(new THREE.Vector3(0, 5, 0));
    if (!this.camPos) this.camPos = want.clone();
    this.camPos.lerp(want, Math.min(1, dt * 3));
    const cam = this.view.camera;
    cam.position.copy(this.camPos);
    cam.up.set(0, 1, 0);
    cam.lookAt(p.clone().addScaledVector(f0, 10));
    cam.updateMatrixWorld();
    const alt = h.p[1] - h.ground(h.p[0], h.p[2]);
    const sp = Math.hypot(h.v[0], h.v[2]);
    const deg = (a) => Math.round((a * 180) / Math.PI);
    const warn = [];
    if (h.failure === 'tail') warn.push('⚠ TAIL ROTOR GONE: lower the collective, land');
    if (h.failure === 'engine') warn.push('⚠ ENGINE OUT: autorotate, pull the collective just before the ground');
    if (h.failure === 'main') warn.push('⚠ NO ROTOR');
    if (h.fire > 0 && !h.crashed) warn.push(`🔥 FIRE: land now (${Math.max(0, HELI.burn - h.burnT).toFixed(0)} s)`);
    else if (h.leak > 0.05) warn.push('⚠ FUEL LEAK');
    if (h.smoke > 0.3) warn.push('⚠ ENGINE DAMAGED');
    if (h.omega < 0.9 && !h.crashed) warn.push(`rotor spinning up ${Math.round(h.omega * 100)}%`);
    const troops = h.aboard().filter((e) => !e.dead && h.seats[e.seat].role === 'troop').length;
    const known = [...h.known.values()].filter((k) => k.c && (k.c.side !== h.side)).length;
    const parts = Object.entries(h.dmg).filter(([, v]) => v > 0.05).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(', ') || 'none';
    this.hud.textContent =
      `HELI  collective ${Math.round(this.collective * 100)}%   rotor ${Math.round(h.omega * 100)}%   alt ${alt.toFixed(0)} m   speed ${Math.round(sp * 3.6)} km/h   vs ${h.v[1].toFixed(1)} m/s\n` +
      `pitch ${deg(h.pitch)}°  bank ${deg(h.roll)}°  heading ${(360 + deg(h.yaw)) % 360}°   troops ${troops}   contacts ${known}\n` +
      `damage: ${parts}` +
      (h.crashed ? '' : h.landed ? (sp < 0.5 ? '   [E] climb out   W: lift' : '') : troops ? '   [G] fast-rope' : '') +
      (h.ropes.some((r) => r.attached) ? '   ropes out ([G] cut)' : '') +
      (warn.length ? `\n${warn.join('   ')}` : '');
  }

  /** G: the troops down the ropes at the hover (or the ropes cut). */
  ropes() {
    const why = this.h.playerRopes();
    this.walk.say(why ? `No ropes: ${why}` : this.h.ropeOrder ? 'Ropes out: hold the hover, the troops go down' : 'Ropes cut', 3);
  }

  /** X: no ejection seat in a helicopter. */
  eject() {
    this.walk.say('No ejection seat in a helicopter: put it down (E to climb out once on the ground)', 3);
  }

  /** E: out, if it is on the ground and still (or a wreck). */
  tryExit() {
    const h = this.h;
    if (!h.crashed && (!h.landed || Math.hypot(h.v[0], h.v[2]) > 0.5)) return this.walk.say('Land first (S to lower the collective)', 2);
    h.unboard();
    this.end(null, heliToWorld(h, [2.9, 0, 2.8]));
  }

  /** It came down hard with you in it: out of the wreck, hurt by how hard (sim's playerHits). */
  endCrash() {
    const h = this.h;
    const w = this.sim.world;
    const sev = h.severity;
    const hits = sev === 'destroyed' ? ['torso', 'torso', 'head', 'legs'] : sev === 'crash' ? ['torso', 'legs'] : ['legs'];
    if (sev !== 'hard' || h.failure) for (const zone of hits) w.playerHits?.push({ zone, time: w.time, from: h.p.slice(), weapon: 'fall' });
    const msg = sev === 'hard' ? 'A hard landing: you climb out of it' : sev === 'crash' ? 'You crashed: you crawl out of the wreck, hurt' : 'The helicopter was destroyed: you are thrown clear, badly hurt';
    h.unboard();
    this.end(msg, heliToWorld(h, [2.9, 0, 3.5]));
  }

  end(msg, at) {
    this.dispose();
    this.walk.endFlight(msg, [at[0], at[1], at[2]]);
  }

  /** The instruments gone; the controls let go (its own pilot, if any, takes it in the air). */
  dispose() {
    if (this.done) return;
    this.done = true;
    this.hud.remove();
    if (this.h.player) this.h.unboard();
  }
}
