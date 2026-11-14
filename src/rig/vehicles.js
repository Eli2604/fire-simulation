/**
 * The rig's vehicles: the car, the jet and the boat (rig/vehicleMeshes.js draws them), what each
 * does (rig/objects.js VEHICLE_ACTS: the car drives round, steers, opens its doors and burns; the
 * jet taxis, raises and lowers its gear, works its flaps, lights its afterburners and banks round
 * the field; the boat bobs, cruises, turns and rides a rough sea) and its hit parts
 * (models/vehicleZones.js VEHICLE_ZONES: shown, resized, damage multipliers, damage on click).
 * A destroyed part does what it would: a fire in the engine bay, a flat tyre, a wing torn off, the
 * boat settling and sinking.
 *
 * Only one vehicle is built at a time: switching kind frees the last one's geometry and materials.
 * While one is shown the soldiers are hidden and paused (rig/stage.js skips their tick).
 */
import * as THREE from 'three';
import { VEHICLE_ACTS, VEHICLE_GROUPS } from './objects.js';
import { JetDamage } from '../sim/jetDamage.js';
import { FlightAI, FORMATIONS } from '../ai/flight.js';
import { Chute, chuteInput, ejectionEnvelope } from '../sim/ejection.js';
import { PilotFigure } from '../render/pilotFigure.js';
import { FlareFx } from '../render/flares.js';
import { VEHICLE_ZONES, VEHICLE_WEAPONS, vehicleZones, rayZone, hitPart, integrity } from '../models/vehicleZones.js';
import { buildCarMesh, buildJet, buildBoatMesh, Sea, disposeTree } from './vehicleMeshes.js';

const NAMES = { car: 'Car', jet: 'Jet', boat: 'Boat', jetFlight: 'Jet flight', pilot: 'Pilot' };
const CAMS = { car: [[6.4, 3.0, 8.2], [0, 0.7, 0]], jet: [[19, 8.5, 24], [-1.5, 1.8, 1.5]], boat: [[7.5, 3.6, 9.5], [0, 0.4, 0]], jetFlight: [[80, 50, 110], [0, 24, 0]], pilot: [[7, 3.5, 9], [0, 1.6, 0]] };
/** The rig's flight: slow and tight enough to stay over the field. */
const RIG_FLIGHT = { altitude: 28, speed: 30, orbitRadius: 75, target: [150, 0, -40], holdTime: 12 };
const approach = (v, target, rate, dt) => v + (target - v) * Math.min(1, rate * dt);
/** Where a circle of radius R round the middle puts you at angle a, and which way you face (+x forward). */
const onCircle = (R, a) => ({ x: R * Math.cos(a), z: R * Math.sin(a), yaw: Math.atan2(-Math.cos(a), -Math.sin(a)) });

/** A pool of soft sprites: fire and smoke rising from points on the vehicle. */
class Puffs {
  constructor(parent, n = 90) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    this.tex = new THREE.CanvasTexture(c);
    this.group = new THREE.Group();
    parent.add(this.group);
    this.list = Array.from({ length: n }, () => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false }));
      s.visible = false;
      s.userData = { life: 0, v: new THREE.Vector3() };
      this.group.add(s);
      return s;
    });
    this.next = 0;
  }
  emit(p, fire, size = 1) {
    const s = this.list[this.next];
    this.next = (this.next + 1) % this.list.length;
    s.position.copy(p).add(new THREE.Vector3((Math.random() - 0.5) * 0.3 * size, 0, (Math.random() - 0.5) * 0.3 * size));
    s.userData.v.set((Math.random() - 0.5) * 0.4, fire ? 1.6 + Math.random() : 0.9 + Math.random() * 0.5, (Math.random() - 0.5) * 0.4);
    Object.assign(s.userData, { life: fire ? 0.7 : 3.2, t: 0, fire, size });
    s.material.color.set(fire ? '#ffa040' : '#5d5852');
    s.material.blending = fire ? THREE.AdditiveBlending : THREE.NormalBlending;
    s.visible = true;
  }
  update(dt) {
    for (const s of this.list) {
      const u = s.userData;
      if (!s.visible) continue;
      u.t += dt;
      if (u.t >= u.life) {
        s.visible = false;
        continue;
      }
      const k = u.t / u.life;
      s.position.addScaledVector(u.v, dt);
      s.scale.setScalar(u.size * (u.fire ? 0.7 * (1 - k * 0.6) : 0.5 + k * 2.2));
      s.material.opacity = u.fire ? 0.9 * (1 - k) : 0.55 * (1 - k);
    }
  }
  clear() {
    for (const s of this.list) s.visible = false;
  }
  dispose() {
    disposeTree(this.group);
    this.tex.dispose();
    this.group.parent?.remove(this.group);
  }
}

export class VehicleRig {
  constructor({ scene, camera, controls, renderer, toast = () => {}, $ = (id) => document.getElementById(id), qs = new URLSearchParams() }) {
    Object.assign(this, { scene, camera, controls, renderer, toast, $, qs });
    this.active = false;
    this.kind = null;
    this.v = null;
    this.speed = 1;
    this.showZones = false;
    this.fire = false;
    this.weapon = 'bullet';
    this.holder = new THREE.Group();
    this.holder.visible = false;
    scene.add(this.holder);
    this.fx = new Puffs(this.holder);
    this.ui();
    const el = renderer.domElement;
    el.addEventListener('pointerdown', (ev) => (this.down = [ev.clientX, ev.clientY]), true);
    el.addEventListener('pointerup', (ev) => this.active && (ev.stopImmediatePropagation(), this.click(ev)), true);
  }

  /* ---------------- which vehicle (null: none) ---------------- */
  setKind(kind, params = null) {
    if (!kind) return this.setActive(false);
    const key = JSON.stringify(params ?? {});
    if (kind !== this.kind || (params && key !== this.paramsKey)) {
      this.free();
      this.kind = kind;
      /** The kind of hit parts (a flight's members: jets). */
      this.zk = VEHICLE_GROUPS[kind] ?? kind;
      this.paramsKey = key;
      this.params = params ?? {};
      if (VEHICLE_GROUPS[kind]) this.buildFlight();
      else {
        this.v = kind === 'car' ? buildCarMesh(params ?? {}) : kind === 'jet' ? buildJet(params ?? {}) : kind === 'pilot' ? buildPilotStage() : buildBoatMesh(params ?? {});
        this.v.group.rotation.order = 'YZX';
        this.holder.add(this.v.group);
        if (kind === 'jet') seatPilot(this.v);
        this.jets = null;
      }
      if (kind === 'boat') {
        this.sea = new Sea();
        this.holder.add(this.sea.mesh);
      }
      this.reset();
      this.buildZones();
      this.panel();
    }
    this.setActive(true);
    this.controls.maxDistance = this.jets ? 600 : 120;
    const [p, t] = CAMS[kind];
    this.camera.position.set(...p);
    this.controls.target.set(...t);
  }

  /** The current vehicle gone (geometry, materials, its sea, its fire). */
  free() {
    if (!this.v) return;
    for (const j of this.jets ?? [{ v: this.v }]) {
      j.v.group.parent?.remove(j.v.group);
      j.v.dispose();
    }
    this.jets = null;
    this.ai = null;
    this.clearCrash();
    this.clearEjected();
    for (const z of this.zones ?? []) disposeTree(z.group);
    this.zones = [];
    if (this.sea) {
      this.holder.remove(this.sea.mesh);
      this.sea.dispose();
      this.sea = null;
    }
    this.fx.clear();
    this.flareFx?.dispose();
    this.flareFx = null;
    this.rigFlares = [];
    this.v = null;
    this.kind = null;
  }

  /** Whole again, at rest in the middle. */
  reset() {
    if (this.jets) return this.resetFlight();
    this.jd = this.zk === 'jet' ? new JetDamage() : null;
    this.clearEjected();
    if (this.v?.pilot) {
      this.v.pilot.group.visible = true;
      this.v.canopy.visible = true;
    }
    this.dmg = this.jd ? this.jd.dmg : {};
    this.clearCrash();
    if (this.v) this.v.group.scale.set(1, 1, 1);
    this.v?.group.traverse((o) => o.isMesh && o.material.userData?.base && o.material.color.copy(o.material.userData.base));
    this.flat = [0, 0, 0, 0];
    this.char = 0;
    this.sunk = 0;
    this.act = this.kind === 'pilot' ? 'seated' : 'idle';
    this.t = 0;
    this.s = { a: 0, x: 0, z: 0, yaw: Math.PI * 0.12, y: 0, roll: 0, pitch: 0, steer: 0, speed: 0, gear: 1, flaps: 0, burner: 0, doors: 0 };
    this.v?.group.traverse((o) => o.isMesh && (o.visible = true));
    if (this.v) this.effects(0);
    this.fx.clear();
    this.lastHit = null;
  }

  play(name) {
    if (!VEHICLE_ACTS[this.kind]?.[name]) return this;
    if (this.jets) {
      this.order(name);
      return this;
    }
    // the damage acts start from a whole jet
    if (this.kind === 'jet' && ['hit', 'burning', 'critical', 'crash'].includes(name) && this.jd?.state !== 'ok') this.reset();
    this.act = name;
    this.t = 0;
    this.s.hitDone = false;
    return this;
  }

  setActive(v) {
    if (v === this.active) return;
    this.active = v;
    this.holder.visible = v;
    const build = this.$('build');
    if (v) {
      this.hidden = new Set();
      this.hideRange();
      this.cam = { p: this.camera.position.clone(), t: this.controls.target.clone(), max: this.controls.maxDistance };
      this.controls.maxDistance = this.jets ? 600 : 120;
      if (build) build.style.visibility = 'hidden';
    } else {
      this.hidden?.forEach((o) => (o.visible = true));
      this.hidden = null;
      if (this.cam) {
        this.camera.position.copy(this.cam.p);
        this.controls.target.copy(this.cam.t);
        this.controls.maxDistance = this.cam.max;
      }
      if (build) build.style.visibility = '';
    }
  }

  /** Everything else on the stage out of sight (the ground too, under the boat's sea). */
  hideRange() {
    for (const o of this.scene.children) {
      if (o === this.holder || o.isLight || (isGround(o) && this.kind !== 'boat') || !(o.visible || this.hidden.has(o))) continue;
      o.visible = false;
      this.hidden.add(o);
    }
  }

  /* ---------------- every frame ---------------- */
  update(dt) {
    if (!this.active || !this.v) return;
    this.hideRange();
    const sdt = Math.min(0.05, dt) * this.speed;
    this.t += sdt;
    this.s.a ??= 0;
    if (this.jets) this.flight(sdt);
    else if (this.kind === 'pilot') this.pilotAct(sdt);
    else if (this.kind === 'car') this.car(sdt);
    else if (this.kind === 'jet') this.jet(sdt);
    else this.boat(sdt);
    if (this.jets) this.jets.forEach((j) => this.withJet(j, () => this.effects(sdt)));
    else this.effects(sdt);
    this.stepCrash(sdt);
    // the damage and eject acts move far: the camera follows the jet (or the man under his canopy)
    if (this.kind === 'jet' && ['eject', 'hit', 'burning', 'critical', 'crash'].includes(this.act)) {
      const e = this.ejected?.[0];
      const p = e && this.act === 'eject' ? new THREE.Vector3(...e.c.p) : this.v.group.position.clone();
      this.controls.target.lerp(p.add(new THREE.Vector3(0, 1.5, 0)), Math.min(1, dt * 2));
    }
    if (!this.jets) this.stepEjected(sdt);
    this.fx.update(sdt);
    for (const z of this.zones) {
      z.flash = Math.max(0, z.flash - dt);
      z.group.visible = this.showZones || z.flash > 0;
      if (z.group.visible) z.fill.color.set(z.flash > 0 ? '#ff3b2f' : z.zone.color);
      z.fill.opacity = 0.18 + 0.5 * Math.min(1, z.flash / 0.25);
    }
    if ((this.statusT = (this.statusT ?? 0) + dt) > 0.2) {
      this.statusT = 0;
      this.status();
    }
  }

  /** Round the middle at `v` m/s on radius R (the angle kept in s.a). */
  circle(R, v, dt) {
    const s = this.s;
    s.a += (v / R) * dt;
    const c = onCircle(R, s.a);
    // (into the circle smoothly from where it stands)
    const k = Math.min(1, dt * 1.5);
    s.x += (c.x - s.x) * k;
    s.z += (c.z - s.z) * k;
    let dy = c.yaw - s.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    s.yaw += dy * k;
  }

  car(dt) {
    const s = this.s;
    const v = this.v;
    const dead = (this.dmg.engine ?? 0) >= 1 || (this.dmg.fuel ?? 0) >= 1;
    const drive = this.act === 'drive' && !dead;
    s.speed = approach(s.speed, drive ? 5 : 0, 1.5, dt);
    const R = 7;
    let steer = 0;
    if (s.speed > 0.05) {
      this.circle(R, s.speed, dt);
      steer = -Math.atan((v.wheels[0] ? Math.abs(v.wheels[0].x) * 2 : 2.7) / R);
    }
    if (this.act === 'steer') steer = 0.55 * Math.sin(this.t * 1.3);
    s.steer = approach(s.steer, steer, 6, dt);
    s.doors = approach(s.doors, this.act === 'doors' ? 1 : 0, 2.2, dt);
    // the body: the idling engine's shake, leaning out of the turn, sagging on flat tyres
    const shake = dead ? 0 : (this.act === 'idle' || this.act === 'steer' || this.act === 'doors' ? 0.0025 : 0.0012) * Math.sin(this.t * 70);
    // (flat front tyres: nose down; flat right ones: the right side down; in the turn it leans out, to the left)
    let front = 0;
    let side = 0;
    v.wheels.forEach((w, i) => {
      front += (this.flat[i] * (w.front ? 1 : -1)) / 2;
      side += (this.flat[i] * w.side) / 2;
    });
    v.body.position.y = shake - 0.06 * Math.max(...this.flat);
    v.body.rotation.set(0.06 * side - ((s.speed * s.speed) / R) * 0.012, 0, -0.05 * front);
    for (const w of v.wheels) {
      if (w.front) w.steer.rotation.y = s.steer;
      w.spin.rotation.z -= (s.speed / w.r) * dt;
    }
    v.doors.forEach((d) => (d.rotation.y = d.userData.side * s.doors * 1.15));
    v.group.position.set(s.x, 0, s.z);
    v.group.rotation.set(0, s.yaw, 0);
  }

  jet(dt) {
    const s = this.s;
    const v = this.v;
    const act = this.act;
    const jd = this.jd;
    // the damage chain (sim/jetDamage.js): hit → burning → critical → it falls → it crashes
    // eject: the canopy goes, the seat fires, the pilot comes down under his canopy; the jet flies on, nose down, and crashes
    if (act === 'eject' && !s.hitDone && this.t > 2.5 && s.y > 8) {
      s.hitDone = true;
      this.ejectFrom(v, [Math.cos(s.yaw) * s.speed, 0, -Math.sin(s.yaw) * s.speed], s.yaw);
      jd.state = 'falling';
      jd.cause = 'pilot ejected';
    }
    if (['hit', 'burning', 'critical', 'crash'].includes(act) && !s.hitDone && this.t > (act === 'crash' ? 0.6 : 1.5)) {
      s.hitDone = true;
      if (act === 'hit') this.hit(this.$('vZoneSel')?.value || 'engines', VEHICLE_WEAPONS.shell);
      if (act === 'burning') this.hit('engines', 60);
      if (act === 'critical') this.hit('wingL', VEHICLE_WEAPONS.rocket * 2);
      if (act === 'crash') this.hit('fuel', VEHICLE_WEAPONS.rocket);
    }
    jd?.step(dt);
    // critical: the pilot ejects when he can (height for the seat, the cockpit whole)
    if (jd?.state === 'falling' && v.pilot?.group.visible && act !== 'crash') {
      const env = ejectionEnvelope({ height: s.y, sink: -(s.vy ?? 0), pitch: s.pitch ?? 0, roll: s.roll, cockpit: this.dmg.cockpit ?? 0 });
      if (env.ok) this.ejectFrom(v, [Math.cos(s.yaw) * s.speed, s.vy ?? 0, -Math.sin(s.yaw) * s.speed], s.yaw);
    }
    if (jd?.state === 'falling' || jd?.state === 'crashed') return this.fall(dt);
    const evade = act === 'evadeBreak' || act === 'evadeRoll';
    const air = evade || act === 'gearUp' || act === 'bank' || act === 'eject' || act === 'hit' || act === 'burning' || act === 'critical' || act === 'crash';
    const engineOut = (this.dmg.engines ?? 0) >= 1;
    // up off the ground (on a stand, as on a test rig) before the gear comes up; gear down before it settles
    const alt = act === 'critical' || act === 'eject' ? 30 : act === 'crash' ? 22 : act === 'gearUp' ? 3.5 : air ? 12 : 0;
    if (air || s.gear > 0.97) s.y = approach(s.y, alt, act === 'bank' ? 0.8 : 1.6, dt);
    s.gear = approach(s.gear, air && s.y > 2.5 ? 0 : !air ? 1 : s.gear, 1.4, dt);
    s.flaps = approach(s.flaps, act === 'flaps' ? 0.35 * (1 - Math.cos(this.t * 1.1)) : 0, 4, dt);
    const flying = air && act !== 'gearUp';
    s.burner = approach(s.burner, engineOut ? 0 : act === 'afterburner' ? 1 : flying ? 0.55 : act === 'taxi' ? 0.15 : 0.05, 3, dt);
    const taxi = act === 'taxi' && !engineOut;
    s.speed = approach(s.speed, taxi ? 5 : flying ? 26 : 0, flying ? 0.6 : 1.2, dt);
    let roll = 0;
    if (s.speed > 0.05) {
      // (a break turn: tight, at a steep bank)
      const R = act === 'evadeBreak' ? 13 : flying ? 30 : 16;
      this.circle(R, s.speed, dt);
      roll = flying ? Math.min(act === 'evadeBreak' ? 1.4 : 1.05, Math.atan((s.speed * s.speed) / (R * 9.81))) : 0;
    }
    // a wing gone: it rolls towards it
    roll += 0.5 * ((this.dmg.wingR ?? 0) - (this.dmg.wingL ?? 0)) * (s.y > 1 ? 1 : 0);
    if (act === 'evadeRoll' && s.y > 6) {
      // a barrel roll round its line of flight, over and over (a full roll every 2.4 s)
      s.roll += ((2 * Math.PI) / 2.4) * dt;
      s.rolled = true;
    } else {
      if (s.rolled) s.roll = Math.atan2(Math.sin(s.roll), Math.cos(s.roll));
      s.rolled = false;
      s.roll = approach(s.roll, roll, act === 'evadeBreak' ? 3 : 1.5, dt);
    }
    v.group.position.set(s.x, s.y, s.z);
    // (the evade acts: the aircraft's own order, heading then pitch then roll)
    v.group.rotation.order = evade ? 'YZX' : 'XYZ';
    v.group.rotation.set(s.roll, s.yaw, flying ? 0.04 : 0);
    if (evade) this.jetFlares(dt, s);
    else if (this.rigFlares?.length) this.jetFlares(dt, s, false);
    // the gear folds up into the belly
    v.gear.scale.y = Math.max(0.02, s.gear);
    v.gear.position.y = (1 - s.gear) * 1.1;
    v.gear.visible = s.gear > 0.03;
    v.flaps.forEach((f) => (f.rotation.z = s.flaps));
    const fl = s.burner;
    v.flame.visible = fl > 0.08;
    v.flame.scale.set(0.6 + fl * 0.5, 0.3 + fl * (1.3 + 0.12 * Math.sin(this.t * 40)), 0.6 + fl * 0.5);
    v.flame.children.forEach((c) => c.material.color.setHSL(0.07 - fl * 0.02, 1, 0.55 + fl * 0.1));
    v.glow.intensity = fl > 0.5 ? (fl - 0.5) * 80 * (0.9 + 0.1 * Math.random()) : 0;
  }

  /** The single jet's flares in the evade acts: a salvo every 0.45 s, four, then a pause; falling away burning. */
  jetFlares(dt, s, drop = true) {
    this.rigFlares ??= [];
    this.flareFx ??= new FlareFx(this.holder);
    s.flareT = (s.flareT ?? 0) - dt;
    if (drop && s.flareT <= 0 && s.y > 6) {
      s.salvo = ((s.salvo ?? 0) + 1) % 6;
      s.flareT = s.salvo < 4 ? 0.45 : 1.2;
      if (s.salvo < 4) {
        const f = [Math.cos(s.yaw), 0, -Math.sin(s.yaw)], rt = [Math.sin(s.yaw), 0, Math.cos(s.yaw)];
        for (const k of [-1, 1]) {
          const p = [s.x - f[0] * 5.5 + rt[0] * k, s.y + 0.6, s.z - f[2] * 5.5 + rt[2] * k];
          this.rigFlares.push({ id: (this.flareN = (this.flareN ?? 0) + 1), p, v: [f[0] * 10 + rt[0] * k * 9, -5, f[2] * 10 + rt[2] * k * 9], t: 0, trail: [p.slice()] });
        }
      }
    }
    for (let i = this.rigFlares.length - 1; i >= 0; i--) {
      const F = this.rigFlares[i];
      F.t += dt;
      for (let j = 0; j < 3; j++) F.v[j] *= Math.exp(-0.9 * dt);
      F.v[1] -= 9.81 * dt;
      for (let j = 0; j < 3; j++) F.p[j] += F.v[j] * dt;
      if ((F.tt = (F.tt ?? 0) + dt) > 0.05) {
        F.tt = 0;
        F.trail.push(F.p.slice());
        if (F.trail.length > 40) F.trail.shift();
      }
      if (F.t > 4.5 || F.p[1] < 0.2) this.rigFlares.splice(i, 1);
    }
    this.flareFx.update(this.rigFlares, [], this.t);
  }

  boat(dt) {
    const s = this.s;
    const v = this.v;
    const act = this.act;
    const engineOut = (this.dmg.engine ?? 0) >= 1 || this.sunk > 0.6;
    const amp = act === 'rough' ? 0.75 : 0.14;
    this.sea.update(dt, amp);
    const go = (act === 'cruise' || act === 'turn' || act === 'rough') && !engineOut;
    s.speed = approach(s.speed, go ? (act === 'turn' ? 3.5 : act === 'rough' ? 3 : 5.5) : 0, 0.7, dt);
    const R = act === 'turn' ? 5 : 12;
    if (s.speed > 0.05) this.circle(R, s.speed, dt);
    s.steer = approach(s.steer, go ? (act === 'turn' ? 0.45 : 0.15) : 0, 2, dt);
    // afloat: heave, pitch and roll from the sea under bow, stern and both sides
    const c = Math.cos(s.yaw);
    const sn = Math.sin(s.yaw);
    const at = (lx, lz) => this.sea.heightAt(s.x + lx * c + lz * sn, s.z - lx * sn + lz * c);
    const bow = at(2, 0);
    const stern = at(-2, 0);
    const port = at(0, -0.9);
    const stbd = at(0, 0.9);
    // holed: it settles lower and lists; destroyed, it goes down
    const hole = this.dmg.hull ?? 0;
    if (hole >= 1) this.sunk = Math.min(1, this.sunk + dt * 0.08);
    const draft = 0.3 * hole + 2.6 * this.sunk;
    const trim = s.speed > 2 ? 0.06 * Math.min(1, s.speed / 5) : 0;
    s.y = approach(s.y, (bow + stern + port + stbd) / 4 - draft, 4, dt);
    s.pitch = approach(s.pitch, Math.atan2(bow - stern, 4) + trim - 0.35 * this.sunk, 4, dt);
    s.roll = approach(s.roll, Math.atan2(port - stbd, 1.8) + (act === 'turn' ? 0.12 : 0) * Math.min(1, s.speed / 3) + 0.1 * hole, 4, dt);
    v.group.position.set(s.x, s.y, s.z);
    v.group.rotation.set(s.roll, s.yaw, s.pitch);
    v.motor.rotation.y = -s.steer;
    v.prop.rotation.x += (engineOut ? 0 : 6 + s.speed * 8) * dt;
  }

  /* ---------------- what the damage does (and the burning car) ---------------- */
  effects(dt) {
    if (this.kind === 'pilot') return;
    const v = this.v;
    const d = this.dmg;
    const k = this.zk; // (a flight's members: jets)
    const fires = [];
    const smokes = [];
    const L = (x, y, z) => v.group.localToWorld(new THREE.Vector3(x, y, z));
    if (k === 'car') {
      const burning = this.act === 'burning' || (d.engine ?? 0) >= 1 || (d.fuel ?? 0) >= 1;
      this.char = burning ? Math.min(0.85, this.char + dt * 0.03) : this.char;
      v.paint.color.set(v.params.bodyColor).multiplyScalar(1 - this.char);
      if (burning) fires.push([L(1.4, 1.0, 0), 1.2]);
      if ((d.fuel ?? 0) >= 1) fires.push([L(-0.9, 0.7, 0), 1.6]);
      if (burning && this.char > 0.25) fires.push([L(-0.2, 1.3, 0), 1]);
      if ((d.engine ?? 0) > 0.4 || burning) smokes.push([L(1.4, 1.1, 0), 1.2]);
      v.glass.forEach((g) => (g.visible = (d.cabin ?? 0) < 1));
      v.wheels.forEach((w, i) => (w.steer.position.y = w.r - 0.12 * this.flat[i]));
    } else if (k === 'jet') {
      const part = { wingL: [v.parts.wingL], wingR: [v.parts.wingR], tail: [v.parts.tail, v.parts.fin], engines: [v.parts.engine], cockpit: [v.canopy] };
      for (const [z, meshes] of Object.entries(part))
        for (const m of meshes) {
          m.visible = (z === 'engines' || (d[z] ?? 0) < 1) && !(z === 'cockpit' && v.pilot && !v.pilot.group.visible); // (a wing, the tail, the canopy: gone; the canopy jettisoned)
          m.material.userData.base ??= m.material.color.clone();
          m.material.color.copy(m.material.userData.base).multiplyScalar((1 - 0.6 * (d[z] ?? 0)) * (this.jd?.state === 'crashed' ? 0.25 : 1));
        }
      v.flaps[0].visible = (d.wingL ?? 0) < 1;
      v.flaps[1].visible = (d.wingR ?? 0) < 1;
      if ((d.engines ?? 0) > 0.4) for (const z of [-0.95, 0.95]) smokes.push([L(-7.4, 1.6, z), 1.4]);
      if ((d.engines ?? 0) >= 1) for (const z of [-0.95, 0.95]) fires.push([L(-6.2, 1.8, z), 1.2]);
      if ((d.fuel ?? 0) >= 1) fires.push([L(-1, 2.0, 0), 1.6]);
      // the parts on fire (sim/jetDamage.js): flames from there, smoke trailing
      for (const e of this.jd?.emitters() ?? []) {
        if (e.fire > 0) fires.push([L(...e.p), 1 + e.fire * 1.5]);
        smokes.push([L(...e.p), 1 + e.smoke]);
      }
    } else {
      if ((d.engine ?? 0) > 0.4) smokes.push([L(-2.6, 1.1, 0), 0.9]);
      if ((d.engine ?? 0) >= 1) fires.push([L(-2.6, 0.9, 0), 0.9]);
      if ((d.fuel ?? 0) >= 1) fires.push([L(-1.75, 0.5, 0.5), 1.2]);
      v.glass.visible = (d.cabin ?? 0) < 1;
    }
    if (this.kind === 'boat' && this.sunk > 0.5) fires.length = 0; // (under water)
    for (const [p, size] of fires) if (Math.random() < dt * 40) this.fx.emit(p, true, size);
    for (const [p, size] of smokes) if (Math.random() < dt * 10) this.fx.emit(p, false, size);
  }

  /* ---------------- hit parts: boxes (and cylinders) on the vehicle ---------------- */
  buildZones() {
    if (!this.inJet)
      for (const z of this.zones ?? []) {
        z.group.parent?.remove(z.group);
        disposeTree(z.group);
      }
    if (this.jets && !this.inJet) {
      // a flight: each jet its own hit parts
      const all = [];
      this.jets.forEach((j, i) =>
        this.withJet(j, () => {
          this.zones = [];
          this.inJet = true;
          this.buildZones();
          this.inJet = false;
          for (const z of this.zones) all.push(Object.assign(z, { jet: i }));
        }),
      );
      this.zones = all;
      return;
    }
    const old = this.inJet ? new Map() : new Map((this.zones ?? []).map((z) => [z.k, z.flash]));
    this.zones = (this.zk === 'pilot' ? [] : vehicleZones(this.zk, this.v.dims)).map((Z) => {
      const group = new THREE.Group();
      // (seen through the body: the engine, the tanks are inside it)
      const fill = new THREE.MeshBasicMaterial({ color: Z.zone.color, transparent: true, opacity: 0.18, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
      const line = new THREE.LineBasicMaterial({ color: Z.zone.color, transparent: true, opacity: 0.9, depthTest: false });
      for (const b of Z.boxes) {
        let geo;
        if (Z.shape === 'cyl') {
          geo = new THREE.CylinderGeometry(1, 1, 2, 20);
          if (Z.axis === 'x') geo.rotateZ(Math.PI / 2);
          if (Z.axis === 'z') geo.rotateX(Math.PI / 2);
        } else geo = new THREE.BoxGeometry(2, 2, 2);
        geo.scale(b.h[0], b.h[1], b.h[2]);
        geo.translate(...b.c);
        const m = new THREE.Mesh(geo, fill);
        m.renderOrder = 10;
        const w = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), line);
        w.renderOrder = 11;
        group.add(m, w);
      }
      group.visible = false;
      this.v.group.add(group);
      return { k: Z.k, zone: Z.zone, group, fill, flash: old.get(Z.k) ?? 0 };
    });
  }

  click(ev) {
    if (!this.v || !this.down || Math.hypot(ev.clientX - this.down[0], ev.clientY - this.down[1]) > 6) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), this.camera);
    // (a flight: the nearest jet the ray meets)
    let hit = null;
    for (const [i, j] of (this.jets ?? [{ v: this.v }]).entries()) {
      j.v.group.updateMatrixWorld();
      const inv = j.v.group.matrixWorld.clone().invert();
      const from = ray.ray.origin.clone().applyMatrix4(inv).toArray();
      const dir = ray.ray.direction.clone().transformDirection(inv).toArray();
      const h = rayZone(this.zk, from, dir, 800, j.v.dims);
      if (h && (!hit || h.t < hit.t)) hit = { ...h, jet: i };
    }
    if (!hit) return;
    if (this.jets) this.pick(hit.jet);
    this.$('vZoneSel').value = hit.k;
    this.zoneUI();
    this.flash(hit.k);
    if (!this.fire) return this.toast(`${hit.zone.label} · ×${hit.zone.mult.toFixed(1)} damage · ${hit.zone.effect}`);
    this.hit(hit.k, VEHICLE_WEAPONS[this.weapon], hit.p);
  }

  flash(k) {
    const z = this.zones.find((q) => q.k === k && (q.jet == null || q.jet === this.sel));
    if (z) z.flash = 0.45;
  }

  /** A hit of `amount` on part k (at p, vehicle frame: which tyre). */
  hit(k, amount, p = null) {
    // a jet: its damage chain (fire, critical, the fall); in a flight the AI hears of it (radio, break, the lead)
    const r = this.jets ? this.ai.hit(this.sel, k, amount) : this.jd ? this.jd.hit(k, amount) : hitPart(this.dmg, this.zk, k, amount);
    if (!r) return null;
    if (this.kind === 'car' && k === 'tyres') {
      // the tyre nearest the hit (or one at random) goes down; the part shows the worst of them
      const ws = this.v.wheels;
      const i = p ? ws.reduce((b, w, j) => (Math.hypot(w.x - p[0], w.side * 0.8 - p[2]) < Math.hypot(ws[b].x - p[0], ws[b].side * 0.8 - p[2]) ? j : b), 0) : Math.floor(Math.random() * ws.length);
      this.flat[i] = Math.min(1, this.flat[i] + r.amount / r.zone.hp);
      this.dmg.tyres = Math.max(...this.flat);
    }
    this.flash(k);
    const what = r.destroyed ? ` – destroyed: ${r.zone.effect}` : '';
    const fire = r.fire ? ' – it catches fire' : '';
    const down = this.jd?.state === 'falling' ? ` – critical (${this.jd.cause}): out of control, it falls` : '';
    this.lastHit = `Last hit${this.jets ? ` on ${this.ai.members[this.sel].call}` : ''}: ${r.zone.label} ×${r.zone.mult.toFixed(1)} = ${Math.round(r.amount)} damage (${this.weapon}), now ${Math.round(this.dmg[k] * 100)}%${what}${fire}${down}.`;
    this.toast(`${r.zone.label} · ${Math.round(r.amount)} dmg${r.destroyed ? ' · destroyed' : ''}`);
    this.status(true);
    return r;
  }

  status(parts = false) {
    if (!this.v) return;
    const $ = this.$;
    const hp = this.zk === 'pilot' ? 1 : integrity(this.dmg, this.zk);
    const bar = $('vHp');
    if (bar) {
      bar.style.width = (hp * 100).toFixed(1) + '%';
      bar.style.background = hp > 0.5 ? 'var(--ok)' : hp > 0.25 ? 'var(--accent)' : 'var(--hurt)';
    }
    const st = $('vState');
    const jstate = this.jd && !['ok', 'damaged'].includes(this.jd.state) ? ` · ${this.jd.state}` : '';
    const extra = (this.kind === 'boat' && this.sunk > 0 ? ' · sinking' : this.kind === 'car' && this.char > 0.05 ? ' · on fire' : '') + jstate + (this.ai ? ` · ${this.ai.mode} · lead ${this.ai.leader.call}` : '');
    if (st) st.textContent = `${VEHICLE_ACTS[this.kind][this.act]} · ${Math.round(hp * 100)}%${extra}`;
    $('vActs')?.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.a === this.act));
    if (parts || this.partsDirty !== false) {
      this.partsDirty = false;
      const pre = $('vParts');
      if (pre) pre.textContent = (this.ai ? `${this.ai.members[this.sel].call}${this.sel === this.ai.lead ? ' (lead)' : ''}\n` : '') + (VEHICLE_ZONES[this.zk] ?? []).map((z) => `${z.label.padEnd(24)} ${String(Math.round((this.dmg[z.k] ?? 0) * 100)).padStart(3)}%`).join('\n');
      const lh = $('vLastHit');
      if (lh) lh.textContent = this.lastHit ?? 'Click a part to see it; with Damage on click, to hit it there. A destroyed part does what it would (a fire, a flat tyre, a wing gone, the boat sinking).';
    }
  }

  /* ---------------- the panel (rig/stage.js has its HTML) ---------------- */
  ui() {
    const $ = this.$;
    const tg = (id, fn) => {
      const b = $(id);
      if (!b) return;
      b.onclick = () => {
        const v = b.getAttribute('aria-pressed') !== 'true';
        b.setAttribute('aria-pressed', String(v));
        fn(v);
      };
    };
    tg('tgVZones', (v) => (this.showZones = v));
    tg('tgVFire', (v) => (this.fire = v));
    if (!$('vRepair')) return;
    $('vRepair').onclick = () => {
      const act = this.act;
      this.reset();
      this.play(act);
      this.status(true);
    };
    $('vWeapon').onchange = (e) => (this.weapon = e.target.value);
    const sp = $('vSpeed');
    sp.oninput = () => {
      this.speed = +sp.value;
      $('vSpeedO').textContent = '×' + this.speed.toFixed(2);
    };
    sp.oninput();
    const zSel = $('vZoneSel');
    const [zS, zL, zM] = ['vzS', 'vzL', 'vzM'].map($);
    const cur = () => VEHICLE_ZONES[this.zk]?.find((z) => z.k === zSel.value);
    this.zoneUI = () => {
      const z = cur();
      if (!z) return;
      zS.value = z.size;
      zL.value = z.len;
      zM.value = z.mult;
      $('vzSo').textContent = '×' + (+z.size).toFixed(2);
      $('vzLo').textContent = '×' + (+z.len).toFixed(2);
      $('vzMo').textContent = '×' + (+z.mult).toFixed(1);
      $('vZoneInfo').textContent = `${z.hp} HP · ${z.effect}`;
    };
    const apply = () => {
      const z = cur();
      if (!z) return;
      z.size = +zS.value;
      z.len = +zL.value;
      z.mult = +zM.value;
      this.zoneUI();
      this.buildZones();
      this.flash(z.k);
    };
    zSel.onchange = () => (this.zoneUI(), this.flash(zSel.value));
    [zS, zL, zM].forEach((s) => (s.oninput = apply));
  }

  /** The panel for the vehicle just built: its acts, its parts. */
  panel() {
    const $ = this.$;
    const name = $('vName');
    if (name) name.textContent = NAMES[this.kind];
    const box = $('vActs');
    if (!box) return;
    box.replaceChildren();
    for (const [k, label] of Object.entries(VEHICLE_ACTS[this.kind])) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.dataset.a = k;
      if (['burning', 'critical', 'crash', 'hitLead', 'break'].includes(k)) b.classList.add('warn');
      b.onclick = () => this.play(k);
      box.appendChild(b);
    }
    const zSel = $('vZoneSel');
    zSel.replaceChildren();
    for (const z of VEHICLE_ZONES[this.zk] ?? []) {
      const o = document.createElement('option');
      o.value = z.k;
      o.textContent = z.label;
      zSel.appendChild(o);
    }
    this.zoneUI();
    this.flightPanel();
    this.status(true);
  }

  /* ---------------- falling and crashing (a jet: sim/jetDamage.js) ---------------- */
  /** Out of control: it rolls, spins or tumbles as its damage says, and falls until it hits the ground. */
  fall(dt) {
    const s = this.s;
    const v = this.v;
    const jd = this.jd;
    v.flame.visible = false;
    v.glow.intensity = 0;
    if (jd.state === 'crashed') return;
    const c = jd.control();
    s.vy = (s.vy ?? 0) - 9.81 * 0.7 * dt;
    s.speed = Math.max(10, s.speed * Math.exp(-0.15 * dt));
    s.x += Math.cos(s.yaw) * s.speed * dt;
    s.z -= Math.sin(s.yaw) * s.speed * dt;
    s.y += s.vy * dt;
    s.roll += c.roll * dt;
    s.pitch = Math.max(-1.3, (s.pitch ?? 0) + c.pitch * dt);
    s.yaw += c.yaw * dt;
    s.gear = 0;
    v.gear.visible = false;
    v.group.position.set(s.x, s.y, s.z);
    v.group.rotation.set(s.roll, s.yaw, s.pitch);
    if (s.y <= 0.3) {
      jd.impact(false);
      this.crashAt(v);
      this.toast('Impact: the jet explodes');
      this.status(true);
    }
  }

  /** The explosion where jet v hit the ground: a fireball, debris, a crater, the wreck burning on. */
  crashAt(v) {
    const p = v.group.position.clone();
    p.y = 0;
    const group = new THREE.Group();
    group.position.copy(p);
    this.holder.add(group);
    // the crater: a dark scorched hole with a rim of thrown-up earth
    const crater = new THREE.Mesh(new THREE.CircleGeometry(5.5, 32).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1d1a16, roughness: 1 }));
    crater.position.y = 0.03;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(5.6, 0.45, 8, 32).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5b4a36, roughness: 1 }));
    rim.scale.y = 0.5;
    group.add(crater, rim);
    // pieces of the airframe flying off
    const debris = [];
    const mat = new THREE.MeshStandardMaterial({ color: 0x2c2d2e, roughness: 0.8, metalness: 0.4 });
    for (let k = 0; k < 16; k++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.3 + Math.random() * 1.2, 0.08 + Math.random() * 0.2, 0.3 + Math.random() * 0.8), mat);
      m.position.set(0, 1, 0);
      group.add(m);
      const a = Math.random() * Math.PI * 2;
      const sp = 6 + Math.random() * 14;
      debris.push({ m, v: new THREE.Vector3(Math.cos(a) * sp, 8 + Math.random() * 14, Math.sin(a) * sp), w: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8) });
    }
    const light = new THREE.PointLight(0xffa050, 400, 60, 1.6);
    light.position.y = 3;
    group.add(light);
    // the fireball
    for (let k = 0; k < 70; k++) {
      const q = p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 3, (Math.random() - 0.5) * 6));
      this.fx.emit(q, k % 3 !== 0, 3 + Math.random() * 3);
    }
    // the wreck: flattened, charred, lying in the crater; its fuel goes on burning
    v.group.position.set(p.x, 0.2, p.z);
    v.group.rotation.set(0.22, v.group.rotation.y, -0.08);
    v.group.scale.set(1, 0.55, 1);
    v.flame.visible = false;
    v.group.traverse((o) => {
      if (!o.isMesh || !o.material.color) return;
      o.material.userData.base ??= o.material.color.clone();
      o.material.color.copy(o.material.userData.base).multiplyScalar(0.18);
    });
    this.crashes ??= [];
    this.crashes.push({ group, debris, light, t: 0 });
  }

  stepCrash(dt) {
    for (const c of this.crashes ?? []) {
      c.t += dt;
      c.light.intensity = 400 * Math.exp(-c.t * 2) + 30 * (0.8 + 0.2 * Math.sin(c.t * 23));
      for (const d of c.debris) {
        if (d.m.position.y <= 0.05 && d.v.y <= 0) continue;
        d.v.y -= 9.81 * dt;
        d.m.position.addScaledVector(d.v, dt);
        d.m.rotation.x += d.w.x * dt;
        d.m.rotation.y += d.w.y * dt;
        if (d.m.position.y < 0.05) {
          d.m.position.y = 0.05;
          d.v.set(0, 0, 0);
        }
      }
      // the fire in the wreck and round the crater
      if (Math.random() < dt * 20) this.fx.emit(c.group.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 5, 0.5, (Math.random() - 0.5) * 5)), true, 1.6);
      if (Math.random() < dt * 8) this.fx.emit(c.group.position.clone().add(new THREE.Vector3(0, 2, 0)), false, 2.4);
    }
  }

  clearCrash() {
    for (const c of this.crashes ?? []) {
      c.group.parent?.remove(c.group);
      disposeTree(c.group);
    }
    this.crashes = [];
  }

  /* ---------------- the pilot: seat, ejection, parachute (sim/ejection.js) ---------------- */
  /** Out of jet v: the canopy jettisoned, the seat fired along the jet's up, the man under his canopy. */
  ejectFrom(v, vel, heading) {
    if (!v.pilot?.group.visible) return;
    v.pilot.group.visible = false;
    v.canopy.visible = false;
    v.group.updateMatrixWorld();
    const p = v.pilot.group.getWorldPosition(new THREE.Vector3());
    const up = new THREE.Vector3(0, 1, 0).transformDirection(v.group.matrixWorld);
    const fig = new PilotFigure();
    fig.group.rotation.order = 'YXZ';
    this.holder.add(fig.group);
    this.ejected ??= [];
    this.ejected.push({ c: new Chute({ p: p.toArray(), v: vel, heading, up: up.toArray() }), fig });
    this.toast('Eject: canopy off, the seat fires');
  }

  stepEjected(dt) {
    for (const e of this.ejected ?? []) {
      const c = e.c;
      const ground = () => ({ y: 0, water: !!e.water });
      c.step(dt, e.input ?? chuteInput(c, c.p[1]), [0, 0], ground);
      const f = e.fig;
      f.group.position.set(...c.p);
      f.group.rotation.y = c.heading;
      f.seat.visible = c.phase === 'seat';
      f.setInflate(c.open ? c.inflate : 0);
      f.setPose(c.pose());
      f.update(dt);
      if (c.phase === 'seat') this.fx.emit(f.group.position.clone().add(new THREE.Vector3(0, -0.5, 0)), true, 0.8);
    }
  }

  clearEjected() {
    this.clearFlightPilots();
    for (const e of this.ejected ?? []) {
      e.fig.group.parent?.remove(e.fig.group);
      disposeTree(e.fig.group);
    }
    this.ejected = [];
  }

  clearFlightPilots() {
    for (const f of this.flightPilots?.values() ?? []) {
      f.group.parent?.remove(f.group);
      disposeTree(f.group);
    }
    this.flightPilots = new Map();
  }

  /** The Pilot object's acts: one man, his seat, his parachute. */
  pilotAct(dt) {
    const act = this.act;
    const fig = this.v.fig;
    this.v.water.visible = act === 'splashdown';
    if (act === 'seated' || act === 'idle') {
      if (this.ejected?.length) this.clearEjected();
      fig.group.visible = true;
      fig.setPose('seated');
      fig.update(dt);
      return;
    }
    fig.group.visible = false;
    // (re)start: from the seat, or under an open canopy up high (steering), or low (the landings)
    const start = () => {
      this.clearEjected();
      const f2 = new PilotFigure();
      f2.group.rotation.order = 'YXZ';
      this.holder.add(f2.group);
      const seat = act === 'eject';
      const c = new Chute({ p: [0, seat ? 1.0 : act === 'plf' || act === 'splashdown' ? 7 : 16, 0], v: [0, seat ? 0 : -5, 0], heading: 0.4 });
      if (!seat) Object.assign(c, { phase: 'open', inflate: 1 });
      const e = { c, fig: f2, act, water: act === 'splashdown', input: seat ? undefined : { left: act === 'steerLeft', right: act === 'steerRight', flare: act === 'flare' } };
      this.ejected = [e];
      this.t = 0;
      return e;
    };
    let e = this.ejected?.[0];
    if (!e || e.act !== act) e = start();
    const c = e.c;
    // the steering and the flare go round again from up high; the landings again after a pause
    if (act === 'flare' && c.flareT > 2.5) c.flareT = 0;
    if (['steerLeft', 'steerRight', 'flare'].includes(act) && c.p[1] < 6) e = start();
    else if (c.down && this.t > (act === 'eject' ? 40 : 6)) e = start();
    // the camera keeps him in view
    const p = new THREE.Vector3(...e.c.p);
    this.controls.target.lerp(p.add(new THREE.Vector3(0, 1.2, 0)), Math.min(1, dt * 3));
  }

  /* ---------------- a flight of jets (ai/flight.js) ---------------- */
  buildFlight() {
    const p = this.params ?? {};
    this.flightOpts ??= { count: p.count ?? 4, formation: p.formation ?? 'fingerFour', spacing: Math.min(30, p.spacing ?? 16), auto: false };
    this.jets = Array.from({ length: this.flightOpts.count }, () => {
      const v = buildJet({ color: p.color ?? '#6f7b86', rockets: Math.min(8, p.rockets ?? 4) });
      v.group.rotation.order = 'YZX';
      seatPilot(v);
      v.gear.visible = false;
      this.holder.add(v.group);
      return { v };
    });
    this.v = this.jets[0].v;
    this.resetFlight();
  }

  resetFlight() {
    const p = this.params ?? {};
    const o = this.flightOpts;
    this.clearCrash();
    this.clearEjected();
    this.radio = [];
    this.ai = new FlightAI({
      ...RIG_FLIGHT,
      p: [0, 0, 0],
      count: o.count,
      formation: o.formation,
      spacing: o.spacing,
      rockets: Math.min(8, p.rockets ?? 4),
      callsign: p.callsign ?? 'Viper',
      auto: o.auto,
      floor: () => 0,
      water: () => false,
      radio: (m, text) => this.radioLine(m, text),
      crash: (m) => this.crashAt(this.jets[m.i].v),
    });
    this.jets.forEach((j, i) => {
      j.jd = this.ai.members[i].dmg;
      j.dmg = j.jd.dmg;
      j.v.group.visible = true;
      j.v.group.scale.set(1, 1, 1);
      j.v.group.traverse((m) => m.isMesh && (m.visible = true));
      j.v.gear.visible = false;
      j.v.pilot.group.visible = true;
    });
    this.act = 'orbit';
    this.t = 0;
    this.s = { a: 0, x: 0, z: 0, yaw: 0, y: 0, roll: 0, pitch: 0, steer: 0, speed: 0, gear: 0, flaps: 0, burner: 0, doors: 0 };
    this.fx.clear();
    this.lastHit = null;
    this.pick(this.ai.lead);
  }

  /** Run fn with jet j as "the vehicle" (its mesh, its damage). */
  withJet(j, fn) {
    const keep = [this.v, this.jd, this.dmg];
    this.v = j.v;
    this.jd = j.jd;
    this.dmg = j.dmg ?? {};
    try {
      fn();
    } finally {
      [this.v, this.jd, this.dmg] = keep;
    }
  }

  /** The jet worked on (hit parts, damage on click). */
  pick(i) {
    if (!this.jets?.[i]) return;
    this.sel = i;
    const j = this.jets[i];
    this.v = j.v;
    this.jd = j.jd;
    this.dmg = j.dmg ?? {};
    const sel = this.$('vMember');
    if (sel) sel.value = String(i);
    this.partsDirty = true;
  }

  /** The flight's acts: the leader's orders, a formation, a hit on the lead. */
  order(name) {
    const ai = this.ai;
    this.act = name;
    this.t = 0;
    if (FORMATIONS[name]) {
      this.flightOpts.formation = name;
      ai.order('formation', { formation: name });
    } else if (name === 'formUp') {
      ai.scatter();
      ai.order('formUp');
    } else if (name === 'hitLead') {
      // an engine fire: it burns, goes critical and falls; the next one takes the lead
      this.pick(ai.lead);
      this.hit('engines', 60);
    } else if (name === 'evadeBreak' || name === 'evadeRoll') this.evadeAct(name);
    else ai.order(name);
    this.status(true);
  }

  /**
   * The evade acts (ai/flight.js): on the selected jet (or the lead), a rocket coming in from its
   * right (it breaks hard into it, flares out), or a missile from behind (a barrel roll with flares:
   * the missile may take the flares). Again every few seconds after it is over.
   */
  evadeAct(name) {
    const ai = this.ai;
    const i = ai.members[this.sel]?.alive ? this.sel : ai.lead;
    const m = ai.members[i];
    if (!m?.alive) return;
    const f = [Math.cos(m.h), 0, -Math.sin(m.h)], rt = [Math.sin(m.h), 0, Math.cos(m.h)];
    if (name === 'evadeBreak') {
      const p = [m.p[0] + rt[0] * 160, m.p[1] - 10, m.p[2] + rt[2] * 160];
      ai.startEvade(m, { kind: 'rocket', p, v: rt.map((x) => -x * 120) }, 2, 'breakTurn');
    } else {
      const from = [m.p[0] - f[0] * 220, m.p[1] - 15, m.p[2] - f[2] * 220];
      ai.launchMissile(from, i, { speed: 80, fuze: 5 });
      ai.startEvade(m, { kind: 'missile', p: from }, 2.5, 'barrelRoll');
    }
    this.evadeT = 0;
  }

  flight(dt) {
    this.ai.step(dt);
    // the evade acts: flares and missiles drawn; once it is over, again
    this.flareFx ??= new FlareFx(this.holder);
    this.flareFx.update(this.ai.flares, this.ai.missiles, this.t);
    if (this.act === 'evadeBreak' || this.act === 'evadeRoll') {
      const busy = this.ai.members.some((m) => m.evade) || this.ai.missiles.length;
      this.evadeT = busy ? 0 : (this.evadeT ?? 0) + dt;
      if (this.evadeT > 3) this.evadeAct(this.act);
    }
    // the ones who got out: seat, canopy, steering, landing
    this.flightPilots ??= new Map();
    for (const P of this.ai.pilots) {
      let fig = this.flightPilots.get(P);
      if (!fig) {
        fig = new PilotFigure();
        fig.group.rotation.order = 'YXZ';
        this.holder.add(fig.group);
        this.flightPilots.set(P, fig);
      }
      const c = P.chute;
      fig.group.position.set(...c.p);
      fig.group.rotation.y = c.heading;
      fig.seat.visible = c.phase === 'seat';
      fig.setInflate(c.open ? c.inflate : 0);
      fig.setPose(this.ai.pilotPose(P));
      fig.update(dt);
    }
    this.ai.members.forEach((m, i) => {
      const v = this.jets[i].v;
      if (m.gone) return;
      v.group.position.set(m.p[0], m.p[1] - 1.6, m.p[2]);
      v.group.rotation.set(m.bank, m.h, m.gamma);
      const fl = m.alive ? 0.25 + 0.6 * (m.throttle ?? 0.5) : 0;
      v.flame.visible = fl > 0.1;
      v.flame.scale.set(0.6 + fl * 0.5, 0.3 + fl * (1.3 + 0.12 * Math.sin(this.t * 40 + i)), 0.6 + fl * 0.5);
      v.glow.intensity = 0;
      v.racks.forEach((r, k) => (r.visible = k < m.rockets));
      v.pilot.group.visible = !m.pilot;
      v.canopy.visible = !m.pilot && (m.dmg.dmg.cockpit ?? 0) < 1;
    });
  }

  radioLine(m, text) {
    this.radio.push(`${m.call}: ${text}`);
    if (this.radio.length > 7) this.radio.shift();
    const pre = this.$('vRadio');
    if (pre) pre.textContent = this.radio.join('\n');
  }

  /** Rebuilt with the settings changed (count, spacing). */
  rebuildFlight() {
    const { kind, params } = this;
    this.free();
    Object.assign(this, { kind, params, zk: VEHICLE_GROUPS[kind] });
    this.buildFlight();
    this.buildZones();
    this.panel();
  }

  /** The flight's own settings in the panel (hidden for a single vehicle). */
  flightPanel() {
    const $ = this.$;
    const box = $('vFlight');
    if (!box) return;
    box.hidden = !this.jets;
    if (!this.jets) return;
    const o = this.flightOpts;
    const mem = $('vMember');
    mem.replaceChildren(...this.ai.members.map((m, i) => Object.assign(document.createElement('option'), { value: String(i), textContent: m.call + (i === this.ai.lead ? ' (lead)' : '') })));
    mem.value = String(this.sel);
    mem.onchange = () => (this.pick(+mem.value), this.status(true));
    for (const [id, key] of [['vCount', 'count'], ['vSpacing', 'spacing']]) {
      const el = $(id);
      el.value = o[key];
      $(id + 'O').textContent = String(o[key]);
      el.onchange = () => {
        o[key] = +el.value;
        this.rebuildFlight();
      };
      el.oninput = () => ($(id + 'O').textContent = el.value);
    }
    const auto = $('tgVAuto');
    auto.setAttribute('aria-pressed', String(!!o.auto));
    auto.onclick = () => {
      o.auto = !o.auto;
      this.ai.on = o.auto;
      auto.setAttribute('aria-pressed', String(o.auto));
    };
    $('vRadio').textContent = this.radio.join('\n');
  }


  dispose() {
    this.free();
    this.fx.dispose();
    this.scene.remove(this.holder);
  }
}

/** The page's own ground (a 200 m plane). */
function isGround(o) {
  return o.isMesh && o.geometry?.type === 'PlaneGeometry' && o.geometry.parameters?.width >= 100;
}

/** A pilot in jet v's cockpit, seen through the canopy (render/pilotFigure.js). */
function seatPilot(v) {
  const f = new PilotFigure();
  f.group.scale.setScalar(0.85);
  f.group.position.set(3.15, 1.62, 0);
  f.update(1);
  v.group.add(f.group);
  v.pilot = f;
}

/** The Pilot object's stage: the man in his seat, and a patch of sea for the splashdown. */
function buildPilotStage() {
  const group = new THREE.Group();
  const fig = new PilotFigure();
  fig.group.position.y = 1.0;
  fig.update(1);
  group.add(fig.group);
  const water = new THREE.Mesh(new THREE.CircleGeometry(30, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1d5470, roughness: 0.3, metalness: 0.1, transparent: true, opacity: 0.85 }));
  water.position.y = 0.02;
  water.visible = false;
  group.add(water);
  return { group, fig, water, dims: [1, 2, 1], dispose: () => disposeTree(group) };
}
