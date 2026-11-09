import * as THREE from 'three';
import { explode } from '../sim/explosions.js';
import { placeObject } from '../models/voxelizer.js';

const G = 9.81;
const V_LIFT = 45; // m/s: full lift (take-off speed)
const THRUST = 22; // m/s² at full throttle
const DRAG = 0.0015; // per metre: top speed √(THRUST/DRAG) ≈ 120 m/s
const CATAPULT = 40; // m/s² extra on the deck at full throttle (steam catapult)

/**
 * Flying the jet. While you sit in it, its voxels are taken out of the world
 * and a mesh flies instead; when it stops on the deck and you climb out (E),
 * the jet is voxelised again where it stands (and can burn, explode, …).
 *
 * Arcade flight model: thrust and drag along the nose, lift ∝ speed², so the
 * aircraft sinks when slow; banking turns it. W/S throttle (S also brakes on
 * the deck), mouse pitch and roll, A/D rudder, Space or left click fires a
 * rocket from under the wings (sim.fireRocket), E climbs out once stopped.
 * Hitting the sea, a ship or anything solid too hard is a crash: the fuel
 * goes up in an explosion and fireball (inside the simulated zone) and you
 * eject.
 */
export class Flight {
  constructor(walk, sim, vehicle) {
    this.walk = walk;
    this.view = walk.view;
    this.sim = sim;
    this.vehicle = vehicle;
    const w = sim.world;
    this.pos = new THREE.Vector3(...vehicle.base);
    this.heading = vehicle.heading ?? 0;
    this.pitch = 0;
    this.roll = 0;
    this.speed = 0;
    this.vy = 0;
    this.throttle = 0;
    this.pitchIn = 0;
    this.rollIn = 0;
    this.rockets = vehicle.rockets ?? 0;
    this.cool = 0;
    this.onGround = true;
    this.fireRequested = false;
    this.mesh = this.buildMesh(vehicle.color ?? '#7a8590');
    this.view.scene.add(this.mesh);
    this.camPos = this.pos.clone().add(new THREE.Vector3(-16 * Math.cos(this.heading), 6, 16 * Math.sin(this.heading)));
    this.hud = document.createElement('div');
    this.hud.className = 'flightHud';
    Object.assign(this.hud.style, {
      position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)', padding: '8px 14px',
      font: '13px/1.4 ui-monospace, monospace', color: '#b8ffb0', background: 'rgba(0,20,0,0.55)', border: '1px solid #3a6',
      borderRadius: '6px', pointerEvents: 'none', zIndex: 30, whiteSpace: 'pre',
    });
    document.body.appendChild(this.hud);
    this.engine = this.startEngine();
    // take the parked jet's voxels out of the world
    for (let i = 0; i < w.N; i++) if (w.mat[i] && w.owner[i] === vehicle.owner) w.clearVoxel(i);
    for (const v of w.vessels) if (v.owner === vehicle.owner && v.state === 'sealed') v.state = 'empty';
    w.vehicles.splice(w.vehicles.indexOf(vehicle), 1);
  }

  buildMesh(color) {
    const g = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), metalness: 0.5, roughness: 0.45 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.6, roughness: 0.5 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x223344, metalness: 0.9, roughness: 0.1, transparent: true, opacity: 0.8 });
    const add = (geo, mat, x, y, z, rz = 0, ry = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(0, ry, rz);
      m.castShadow = true;
      g.add(m);
      return m;
    };
    add(new THREE.CylinderGeometry(0.75, 0.6, 11, 16), paint, -0.5, 1.6, 0, Math.PI / 2); // fuselage along x
    add(new THREE.ConeGeometry(0.6, 2.4, 16), paint, 6.2, 1.6, 0, -Math.PI / 2); // nose
    add(new THREE.SphereGeometry(0.5, 16, 10).scale(2.8, 0.9, 1), glass, 3, 2.3, 0);
    add(new THREE.BoxGeometry(3.5, 0.15, 10), paint, -0.75, 1.48, 0);
    add(new THREE.BoxGeometry(1.5, 0.1, 4.4), paint, -5.75, 1.55, 0);
    add(new THREE.BoxGeometry(1.7, 2.6, 0.12), paint, -5.65, 2.9, 0);
    add(new THREE.CylinderGeometry(0.5, 0.45, 1.2, 14), dark, -6.6, 1.6, 0, Math.PI / 2);
    this.flame = add(new THREE.ConeGeometry(0.42, 2.5, 12), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.7, depthWrite: false }), -8.4, 1.6, 0, Math.PI / 2);
    this.gear = new THREE.Group();
    for (const [x, z] of [[3.5, 0], [-1.5, -1.4], [-1.5, 1.4]]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.2, 12).rotateX(Math.PI / 2), dark);
      wheel.position.set(x, 0.33, z);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 0.1), dark);
      leg.position.set(x, 0.85, z);
      this.gear.add(wheel, leg);
    }
    g.add(this.gear);
    this.racks = [];
    for (let k = 0; k < this.rockets; k++) {
      const side = k % 2 ? 1 : -1;
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2, 8).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd8d8d0 }));
      r.position.set(-0.5, 1.2, side * (1.8 + Math.floor(k / 2) * 0.7));
      g.add(r);
      this.racks.push(r);
    }
    return g;
  }

  startEngine() {
    const s = this.walk.sound;
    if (!s?.ctx || !s.running) return null;
    const ctx = s.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 600;
    const g = ctx.createGain();
    g.gain.value = 0;
    o.connect(f);
    o2.connect(f);
    f.connect(g).connect(s.master);
    o.start();
    o2.start();
    return { o, o2, f, g };
  }

  mouse(dx, dy) {
    this.pitchIn = Math.max(-1, Math.min(1, this.pitchIn - dy * 0.004));
    this.rollIn = Math.max(-1, Math.min(1, this.rollIn + dx * 0.004));
  }

  /** Axes of the aircraft (nose = +x, up = +y, right = +z in its own frame). */
  axes() {
    const e = new THREE.Euler(this.roll, this.heading, this.pitch, 'YZX');
    const q = new THREE.Quaternion().setFromEuler(e);
    return {
      q,
      f: new THREE.Vector3(1, 0, 0).applyQuaternion(q),
      u: new THREE.Vector3(0, 1, 0).applyQuaternion(q),
      r: new THREE.Vector3(0, 0, 1).applyQuaternion(q),
    };
  }

  inWorld(p, margin = 0) {
    const s = this.sim.world.size;
    return p.x > margin && p.z > margin && p.x < s[0] - margin && p.z < s[2] - margin && p.y < s[1] - margin;
  }

  solid(p) {
    const w = this.sim.world;
    if (!this.inWorld(p)) return false;
    const i = w.voxelAt(p.x, p.y, p.z);
    return i >= 0 && w.mat[i] !== 0;
  }

  /** Height of the deck (or the sea) under p. */
  groundAt(p) {
    const w = this.sim.world;
    const sea = w.sea ? w.sea.level : w.h;
    if (!this.inWorld(p, 0.5)) return { y: sea, sea: !!w.sea };
    for (let y = Math.min(p.y + 0.5, w.size[1] - 0.01); y > 0; y -= w.h * 0.5) {
      const i = w.voxelAt(p.x, y, p.z);
      if (i >= 0 && w.mat[i]) {
        const top = (Math.floor(y / w.h) + 1) * w.h;
        return top > sea ? { y: top, sea: false } : { y: sea, sea: !!w.sea };
      }
    }
    return { y: sea, sea: !!w.sea };
  }

  update(dt, keys) {
    if (this.done) return;
    const w = this.sim.world;
    // controls
    if (keys.has('KeyW') || keys.has('ArrowUp')) this.throttle = Math.min(1, this.throttle + dt * 0.6);
    if (keys.has('KeyS') || keys.has('ArrowDown')) this.throttle = Math.max(0, this.throttle - dt * 0.8);
    const yawIn = (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0);
    const auth = Math.min(1, this.speed / 35);
    this.pitchIn *= Math.exp(-2.5 * dt);
    this.rollIn *= Math.exp(-2.5 * dt);
    if (this.onGround) {
      this.heading += yawIn * 0.6 * dt * Math.min(1, this.speed / 5 + 0.2);
      this.roll = 0;
      if (this.speed > V_LIFT * 0.85) this.pitch = Math.max(0, Math.min(0.3, this.pitch + this.pitchIn * 1.2 * dt));
      else this.pitch = Math.max(0, this.pitch - dt);
      if (keys.has('KeyS') || keys.has('ArrowDown')) this.speed = Math.max(0, this.speed - 18 * dt); // brakes / arrestor wire
    } else {
      this.roll += this.rollIn * 2.6 * auth * dt;
      if (Math.abs(this.rollIn) < 0.05) this.roll *= Math.exp(-0.4 * dt);
      this.roll = Math.atan2(Math.sin(this.roll), Math.cos(this.roll));
      this.pitch = Math.max(-1.3, Math.min(1.3, this.pitch + this.pitchIn * 1.4 * auth * dt * Math.cos(this.roll)));
      this.heading += (yawIn * 0.35 * auth - Math.sin(this.roll) * 0.9 * auth) * dt;
    }
    const { q, f, u, r } = this.axes();
    // thrust, drag, gravity along the path
    const onDeck = this.onGround && !this.groundAt(this.pos).sea;
    let acc = this.throttle * THRUST - DRAG * this.speed * this.speed - G * f.y;
    if (onDeck && this.throttle > 0.9) acc += CATAPULT;
    if (this.onGround) acc -= 0.4; // rolling resistance
    this.speed = Math.max(0, this.speed + acc * dt);
    // lift (∝ speed²) against gravity; the aircraft sinks when slow
    const lift = G * Math.min(1.4, (this.speed / V_LIFT) ** 2) * Math.max(0, u.y);
    this.vy += (lift - G) * dt;
    this.vy *= Math.exp(-1.2 * dt);
    const prevY = this.pos.y;
    this.pos.addScaledVector(f, this.speed * dt);
    this.pos.y += this.vy * dt;
    // touching the deck / the sea
    const ground = this.groundAt(this.pos);
    if (this.pos.y <= ground.y) {
      const sink = (prevY - this.pos.y) / Math.max(dt, 1e-3) + Math.max(0, -this.vy);
      if (ground.sea) return this.crash('You ditched in the sea');
      if (!this.onGround && (sink > 7 || Math.abs(this.roll) > 0.5 || this.pitch < -0.2)) return this.crash('Hard landing: the jet broke up on the deck');
      this.pos.y = ground.y;
      this.vy = Math.max(0, this.vy);
      if (!this.onGround) this.walk.say('Touchdown – S to brake, E to climb out when stopped', 3);
      this.onGround = true;
    } else if (this.pos.y > ground.y + 0.3) this.onGround = false;
    // flying into something solid (the island, another ship's hull…)
    for (const pt of [f.clone().multiplyScalar(7), r.clone().multiplyScalar(4.8), r.clone().multiplyScalar(-4.8), f.clone().multiplyScalar(-6).addScaledVector(u, 2.6)]) {
      const p = this.pos.clone().add(pt).addScaledVector(u, 1.6);
      if (this.speed > 4 && this.solid(p)) return this.crash('You flew into the structure');
    }
    // rockets
    this.cool -= dt;
    if (this.fireRequested) {
      this.fireRequested = false;
      if (this.rockets > 0 && this.cool <= 0) {
        this.cool = 0.35;
        const k = this.vehicle.rockets - this.rockets;
        const side = k % 2 ? 1 : -1;
        const from = this.pos.clone().addScaledVector(u, 1.1).addScaledVector(f, 2.5).addScaledVector(r, side * (1.8 + Math.floor(k / 2) * 0.7));
        const v = f.clone().multiplyScalar(this.speed + 70);
        this.sim.fireRocket([from.x, from.y, from.z], [v.x, v.y, v.z], 2e6);
        this.rockets--;
        if (this.racks[k]) this.racks[k].visible = false;
        if (this.walk.sound.running) this.walk.sound.burst(this.walk.sound.ctx.currentTime, 0.4, 'lowpass', 900, 0.7, 0.6);
      } else if (this.rockets <= 0) this.walk.say('No rockets left', 1.5);
    }
    // mesh, camera, engine
    this.mesh.position.copy(this.pos);
    this.mesh.quaternion.copy(q);
    this.gear.visible = this.onGround || this.pos.y - ground.y < 12;
    this.flame.visible = this.throttle > 0.05;
    this.flame.scale.set(1, 0.4 + this.throttle * (0.8 + Math.random() * 0.3), 1);
    const back = new THREE.Vector3(-Math.cos(this.heading), 0, Math.sin(this.heading));
    const want = this.pos.clone().addScaledVector(back, 18).add(new THREE.Vector3(0, 5.5, 0)).addScaledVector(u, 1);
    this.camPos.lerp(want, Math.min(1, dt * 4));
    const cam = this.view.camera;
    cam.position.copy(this.camPos);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.pos.clone().addScaledVector(f, 12).add(new THREE.Vector3(0, 2, 0)));
    cam.updateMatrixWorld();
    if (this.engine) {
      const t = this.walk.sound.ctx.currentTime;
      this.engine.o.frequency.setTargetAtTime(45 + this.throttle * 70 + this.speed * 0.3, t, 0.1);
      this.engine.o2.frequency.setTargetAtTime(90 + this.throttle * 160, t, 0.1);
      this.engine.f.frequency.setTargetAtTime(400 + this.throttle * 1800, t, 0.1);
      this.engine.g.gain.setTargetAtTime(0.04 + this.throttle * 0.22, t, 0.1);
    }
    const alt = this.pos.y - (w.sea?.level ?? 0);
    const deg = (a) => Math.round((a * 180) / Math.PI);
    this.hud.textContent =
      `JET  throttle ${Math.round(this.throttle * 100)}%   speed ${Math.round(this.speed * 3.6)} km/h   alt ${Math.round(alt)} m   vs ${this.vy.toFixed(1)} m/s\n` +
      `pitch ${deg(this.pitch)}°  bank ${deg(this.roll)}°  heading ${(360 + deg(-this.heading)) % 360}°   rockets ${this.rockets}` +
      (this.onGround ? (this.speed < 1 ? '   [E] climb out' : this.speed < V_LIFT * 0.85 ? '   full throttle: catapult' : '   pull up (mouse)') : '') +
      (!this.onGround && this.speed < V_LIFT * 0.7 ? '   ⚠ STALL' : '');
  }

  /** Climb out (E): only stopped on the deck, where the jet is voxelised again. */
  tryExit() {
    if (!this.onGround || this.speed > 1) return this.walk.say('Stop on the deck first (S to brake)', 2);
    const w = this.sim.world;
    if (!this.inWorld(this.pos, 6) || this.groundAt(this.pos).sea) return this.walk.say('Not on the deck', 2);
    const obj = this.vehicle.obj;
    const placed = {
      ...obj,
      params: { ...obj.params, rockets: this.rockets },
      x: this.pos.x,
      z: this.pos.z,
      y: this.pos.y - w.h,
      rotation: (this.heading * 180) / Math.PI,
    };
    placeObject(w, placed, this.vehicle.owner);
    const side = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading)).multiplyScalar(-6);
    this.end(null, [this.pos.x + side.x, this.pos.y, this.pos.z + side.z]);
  }

  crash(msg) {
    const w = this.sim.world;
    const p = [this.pos.x, Math.max(this.pos.y + 1, (w.sea?.level ?? 0) + 0.5), this.pos.z];
    if (this.inWorld(this.pos, 0.5)) {
      explode(this.sim, p, 2e7, { name: 'jet crash' });
      this.sim.ignite(p, 2.5);
      this.sim.addTorch(p, 4e5, 15, 1.5); // the fuel fireball
    }
    for (let k = 0; k < 120; k++)
      this.view.flames.spawn(p[0] + (Math.random() - 0.5) * 6, p[1] + Math.random() * 4, p[2] + (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4, 4 + Math.random() * 4, (Math.random() - 0.5) * 4, 1.2, 1.5, 0, 1);
    const snd = this.walk.sound;
    if (snd.running) {
      snd.thump(snd.ctx.currentTime, 1);
      snd.burst(snd.ctx.currentTime, 1.5, 'lowpass', 300, 0.7, 1);
    }
    this.end(`${msg}. You ejected.`, null);
  }

  end(msg, at) {
    this.dispose();
    this.walk.endFlight(msg, at);
  }

  /** Remove the mesh, HUD and engine sound. */
  dispose() {
    if (this.done && !this.mesh.parent) return;
    this.done = true;
    this.view.scene.remove(this.mesh);
    this.hud.remove();
    if (this.engine) {
      const t = this.walk.sound.ctx.currentTime;
      this.engine.g.gain.setTargetAtTime(0, t, 0.2);
      this.engine.o.stop(t + 1);
      this.engine.o2.stop(t + 1);
    }
  }
}
