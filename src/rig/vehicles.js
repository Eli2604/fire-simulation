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
import { VEHICLE_ACTS } from './objects.js';
import { VEHICLE_ZONES, VEHICLE_WEAPONS, vehicleZones, rayZone, hitPart, integrity } from '../models/vehicleZones.js';
import { buildCarMesh, buildJet, buildBoatMesh, Sea, disposeTree } from './vehicleMeshes.js';

const NAMES = { car: 'Car', jet: 'Jet', boat: 'Boat' };
const CAMS = { car: [[6.4, 3.0, 8.2], [0, 0.7, 0]], jet: [[19, 8.5, 24], [-1.5, 1.8, 1.5]], boat: [[7.5, 3.6, 9.5], [0, 0.4, 0]] };
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
      this.paramsKey = key;
      this.v = kind === 'car' ? buildCarMesh(params ?? {}) : kind === 'jet' ? buildJet(params ?? {}) : buildBoatMesh(params ?? {});
      this.v.group.rotation.order = 'YZX';
      this.holder.add(this.v.group);
      if (kind === 'boat') {
        this.sea = new Sea();
        this.holder.add(this.sea.mesh);
      }
      this.reset();
      this.buildZones();
      this.panel();
    }
    this.setActive(true);
    const [p, t] = CAMS[kind];
    this.camera.position.set(...p);
    this.controls.target.set(...t);
  }

  /** The current vehicle gone (geometry, materials, its sea, its fire). */
  free() {
    if (!this.v) return;
    this.v.group.parent?.remove(this.v.group);
    this.v.dispose();
    for (const z of this.zones ?? []) disposeTree(z.group);
    this.zones = [];
    if (this.sea) {
      this.holder.remove(this.sea.mesh);
      this.sea.dispose();
      this.sea = null;
    }
    this.fx.clear();
    this.v = null;
    this.kind = null;
  }

  /** Whole again, at rest in the middle. */
  reset() {
    this.dmg = {};
    this.flat = [0, 0, 0, 0];
    this.char = 0;
    this.sunk = 0;
    this.act = 'idle';
    this.t = 0;
    this.s = { a: 0, x: 0, z: 0, yaw: Math.PI * 0.12, y: 0, roll: 0, pitch: 0, steer: 0, speed: 0, gear: 1, flaps: 0, burner: 0, doors: 0 };
    this.v?.group.traverse((o) => o.isMesh && (o.visible = true));
    if (this.v) this.effects(0);
    this.fx.clear();
    this.lastHit = null;
  }

  play(name) {
    if (!VEHICLE_ACTS[this.kind]?.[name]) return this;
    this.act = name;
    this.t = 0;
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
      this.controls.maxDistance = 120;
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
    if (this.kind === 'car') this.car(sdt);
    else if (this.kind === 'jet') this.jet(sdt);
    else this.boat(sdt);
    this.effects(sdt);
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
    const air = act === 'gearUp' || act === 'bank';
    const engineOut = (this.dmg.engines ?? 0) >= 1;
    // up off the ground (on a stand, as on a test rig) before the gear comes up; gear down before it settles
    const alt = act === 'bank' ? 12 : act === 'gearUp' ? 3.5 : 0;
    if (air || s.gear > 0.97) s.y = approach(s.y, alt, act === 'bank' ? 0.8 : 1.6, dt);
    s.gear = approach(s.gear, air && s.y > 2.5 ? 0 : !air ? 1 : s.gear, 1.4, dt);
    s.flaps = approach(s.flaps, act === 'flaps' ? 0.35 * (1 - Math.cos(this.t * 1.1)) : 0, 4, dt);
    s.burner = approach(s.burner, engineOut ? 0 : act === 'afterburner' ? 1 : act === 'bank' ? 0.55 : act === 'taxi' ? 0.15 : 0.05, 3, dt);
    const taxi = act === 'taxi' && !engineOut;
    s.speed = approach(s.speed, taxi ? 5 : act === 'bank' ? 26 : 0, act === 'bank' ? 0.6 : 1.2, dt);
    let roll = 0;
    if (s.speed > 0.05) {
      const R = act === 'bank' ? 30 : 16;
      this.circle(R, s.speed, dt);
      roll = act === 'bank' ? Math.min(1.05, Math.atan((s.speed * s.speed) / (R * 9.81))) : 0;
    }
    // a wing gone: it rolls towards it
    roll += 0.5 * ((this.dmg.wingR ?? 0) - (this.dmg.wingL ?? 0)) * (s.y > 1 ? 1 : 0);
    s.roll = approach(s.roll, roll, 1.5, dt);
    v.group.position.set(s.x, s.y, s.z);
    v.group.rotation.set(s.roll, s.yaw, act === 'bank' ? 0.04 : 0);
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
    const v = this.v;
    const d = this.dmg;
    const k = this.kind;
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
          m.visible = z === 'engines' || (d[z] ?? 0) < 1; // (a wing, the tail, the canopy: gone)
          m.material.userData.base ??= m.material.color.clone();
          m.material.color.copy(m.material.userData.base).multiplyScalar(1 - 0.6 * (d[z] ?? 0));
        }
      v.flaps[0].visible = (d.wingL ?? 0) < 1;
      v.flaps[1].visible = (d.wingR ?? 0) < 1;
      if ((d.engines ?? 0) > 0.4) for (const z of [-0.95, 0.95]) smokes.push([L(-7.4, 1.6, z), 1.4]);
      if ((d.engines ?? 0) >= 1) for (const z of [-0.95, 0.95]) fires.push([L(-6.2, 1.8, z), 1.2]);
      if ((d.fuel ?? 0) >= 1) fires.push([L(-1, 2.0, 0), 1.6]);
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
    for (const z of this.zones ?? []) {
      z.group.parent?.remove(z.group);
      disposeTree(z.group);
    }
    const old = new Map((this.zones ?? []).map((z) => [z.k, z.flash]));
    this.zones = vehicleZones(this.kind, this.v.dims).map((Z) => {
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
    this.v.group.updateMatrixWorld();
    const inv = this.v.group.matrixWorld.clone().invert();
    const from = ray.ray.origin.clone().applyMatrix4(inv).toArray();
    const dir = ray.ray.direction.clone().transformDirection(inv).toArray();
    const hit = rayZone(this.kind, from, dir, 500, this.v.dims);
    if (!hit) return;
    this.$('vZoneSel').value = hit.k;
    this.zoneUI();
    this.flash(hit.k);
    if (!this.fire) return this.toast(`${hit.zone.label} · ×${hit.zone.mult.toFixed(1)} damage · ${hit.zone.effect}`);
    this.hit(hit.k, VEHICLE_WEAPONS[this.weapon], hit.p);
  }

  flash(k) {
    const z = this.zones.find((q) => q.k === k);
    if (z) z.flash = 0.45;
  }

  /** A hit of `amount` on part k (at p, vehicle frame: which tyre). */
  hit(k, amount, p = null) {
    const r = hitPart(this.dmg, this.kind, k, amount);
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
    this.lastHit = `Last hit: ${r.zone.label} ×${r.zone.mult.toFixed(1)} = ${Math.round(r.amount)} damage (${this.weapon}), now ${Math.round(this.dmg[k] * 100)}%${what}.`;
    this.toast(`${r.zone.label} · ${Math.round(r.amount)} dmg${r.destroyed ? ' · destroyed' : ''}`);
    this.status(true);
    return r;
  }

  status(parts = false) {
    if (!this.v) return;
    const $ = this.$;
    const hp = integrity(this.dmg, this.kind);
    const bar = $('vHp');
    if (bar) {
      bar.style.width = (hp * 100).toFixed(1) + '%';
      bar.style.background = hp > 0.5 ? 'var(--ok)' : hp > 0.25 ? 'var(--accent)' : 'var(--hurt)';
    }
    const st = $('vState');
    const extra = this.kind === 'boat' && this.sunk > 0 ? ' · sinking' : this.kind === 'car' && this.char > 0.05 ? ' · on fire' : '';
    if (st) st.textContent = `${VEHICLE_ACTS[this.kind][this.act]} · ${Math.round(hp * 100)}%${extra}`;
    $('vActs')?.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.a === this.act));
    if (parts || this.partsDirty !== false) {
      this.partsDirty = false;
      const pre = $('vParts');
      if (pre) pre.textContent = VEHICLE_ZONES[this.kind].map((z) => `${z.label.padEnd(24)} ${String(Math.round((this.dmg[z.k] ?? 0) * 100)).padStart(3)}%`).join('\n');
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
    const cur = () => VEHICLE_ZONES[this.kind]?.find((z) => z.k === zSel.value);
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
      if (k === 'burning') b.classList.add('warn');
      b.onclick = () => this.play(k);
      box.appendChild(b);
    }
    const zSel = $('vZoneSel');
    zSel.replaceChildren();
    for (const z of VEHICLE_ZONES[this.kind]) {
      const o = document.createElement('option');
      o.value = z.k;
      o.textContent = z.label;
      zSel.appendChild(o);
    }
    this.zoneUI();
    this.status(true);
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
