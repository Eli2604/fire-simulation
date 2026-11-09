import * as THREE from 'three';
import { explode } from '../sim/explosions.js';
import { placeObject } from '../models/voxelizer.js';
import { MAT } from '../sim/materials.js';

const G = 9.81;
const V_LIFT = 45; // m/s: full lift (take-off speed)
const THRUST = 22; // m/s² at full throttle
const DRAG = 0.0015; // per metre: top speed √(THRUST/DRAG) ≈ 120 m/s
const CATAPULT = 40; // m/s² extra on the deck at full throttle (steam catapult)
const ROCKET_E = 2e6; // J

/** Where the parts are in the aircraft's own frame (nose +x, up +y, right +z). */
const PARTS = {
  wingL: [-0.8, 1.5, -3.2],
  wingR: [-0.8, 1.5, 3.2],
  engine: [-6.2, 1.6, 0],
  tail: [-5.7, 3.0, 0],
  fuel: [-1, 1.6, 0],
};
const PART_NAMES = { wingL: 'left wing', wingR: 'right wing', engine: 'engine', tail: 'tail', fuel: 'fuel tank' };

/**
 * Flying the jet. While you sit in it, its voxels are taken out of the world
 * and a mesh flies instead; when it stops on a deck or flat ground and you
 * climb out (E), the jet is voxelised again where it stands.
 *
 * The jet flies in one sea shared by every open-air zone (the carrier's flight
 * deck, the island…), each placed at its `origin`. The zone under the jet is
 * the one simulated and shown (built the first time you get there); the
 * others are drawn as simple stand-ins.
 *
 * Arcade flight model: thrust and drag along the nose, lift ∝ speed² (so the
 * jet sinks when slow), banking turns it. Damage changes how it flies:
 *  wings    less lift and more drag; a damaged wing drops (roll), a lost wing is a spin
 *  engine   less thrust, smoke, then fire that eats into the rest
 *  tail     sluggish, wobbly pitch and rudder
 *  fuel     a leak: the tank runs dry, then the engine stops
 * Damage comes from blasts (your own rockets too close, burst tanks), flying
 * through flames and hot gas, scraping a wing on something, hard landings.
 *
 * Rockets are flown here too, in the shared sea: they hit terrain, buildings,
 * ships in whatever zone they reach (building it if needed) and explode there
 * (sim/explosions.js: debris, broken glass, fire), or splash into the sea.
 */
export class Flight {
  constructor(walk, sim, vehicle) {
    this.walk = walk;
    this.view = walk.view;
    this.zones = walk.hooks.zones;
    this.vehicle = vehicle;
    this.home = this.zones?.current() ?? null;
    this.zone = this.home;
    this.sim = sim;
    this.origin = this.originOf(this.zone);
    const w = sim.world;
    this.seaLevel = (w.sea ? w.sea.level : w.h) + this.origin[1];
    this.pos = new THREE.Vector3(...vehicle.base).add(new THREE.Vector3(...this.origin));
    this.heading = vehicle.heading ?? 0;
    this.pitch = 0;
    this.roll = 0;
    this.speed = 0;
    this.vy = 0;
    this.throttle = 0;
    this.pitchIn = 0;
    this.rollIn = 0;
    this.rockets = vehicle.rockets ?? 0;
    this.flying = []; // rockets in the air
    this.cool = 0;
    this.onGround = true;
    this.fireRequested = false;
    const saved = vehicle.obj?.damage ?? {};
    this.dmg = { wingL: 0, wingR: 0, engine: 0, tail: 0, fuel: 0, ...saved };
    this.fuelLeft = vehicle.obj?.params?.fuelLiters ?? 2000;
    this.burning = 0;
    this.mesh = this.buildMesh(vehicle.color ?? '#7a8590');
    this.view.scene.add(this.mesh);
    this.trail = this.buildTrail();
    this.view.scene.add(this.trail.points);
    this.camPos = this.local(this.pos).add(new THREE.Vector3(-16 * Math.cos(this.heading), 6, 16 * Math.sin(this.heading)));
    this.hud = document.createElement('div');
    this.hud.className = 'flightHud';
    Object.assign(this.hud.style, {
      position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)', padding: '8px 14px',
      font: '13px/1.4 ui-monospace, monospace', color: '#b8ffb0', background: 'rgba(0,20,0,0.55)', border: '1px solid #3a6',
      borderRadius: '6px', pointerEvents: 'none', zIndex: 30, whiteSpace: 'pre',
    });
    document.body.appendChild(this.hud);
    this.engine = this.startEngine();
    this.seenEvents = w.events.length;
    // take the parked jet's voxels out of the world
    for (let i = 0; i < w.N; i++) if (w.mat[i] && w.owner[i] === vehicle.owner) w.clearVoxel(i);
    for (const v of w.vessels) if (v.owner === vehicle.owner && v.state === 'sealed') v.state = 'empty';
    w.vehicles.splice(w.vehicles.indexOf(vehicle), 1);
  }

  // ------------------------------------------------------------------ zones
  originOf(name) {
    return (this.zones ? this.zones.origin(name) : null) ?? [0, 0, 0];
  }

  /** Global → coordinates of the zone being shown. */
  local(p) {
    return new THREE.Vector3(p.x - this.origin[0], p.y - this.origin[1], p.z - this.origin[2]);
  }

  /** The open-air zone containing global point p: { name, sim, local } (built only if asked). */
  zoneAt(p, build = false) {
    const list = this.zones ? this.zones.open() : [{ name: null, origin: [0, 0, 0], size: this.sim.world.size }];
    for (const z of list) {
      const l = [p.x - z.origin[0], p.y - z.origin[1], p.z - z.origin[2]];
      if (l[0] < 0 || l[2] < 0 || l[0] >= z.size[0] || l[2] >= z.size[2] || l[1] >= z.size[1] + 2) continue;
      if (!this.zones) return { name: null, sim: this.sim, local: l };
      if (!build && !this.zones.built(z.name)) return { name: z.name, sim: null, local: l };
      return { name: z.name, sim: this.zones.sim(z.name), local: l };
    }
    return null;
  }

  /** Show / simulate the zone the jet is over. */
  followZone() {
    if (!this.zones) return;
    const z = this.zoneAt(this.pos);
    if (!z || z.name === this.zone) return;
    // only once well inside (no flicker on the boundary)
    const size = this.zones.open().find((q) => q.name === z.name).size;
    if (Math.min(z.local[0], z.local[2], size[0] - z.local[0], size[2] - z.local[2]) < 1.5) return;
    this.sim = this.zones.activate(z.name);
    this.zone = z.name;
    this.origin = this.originOf(z.name);
    this.seenEvents = this.sim.world.events.length;
    this.camPos = this.local(this.pos).add(new THREE.Vector3(-16 * Math.cos(this.heading), 6, 16 * Math.sin(this.heading)));
    this.walk.say(`Over: ${z.name}`, 2);
  }

  solid(p) {
    const z = this.zoneAt(p);
    if (!z?.sim) return false;
    const w = z.sim.world;
    const i = w.voxelAt(...z.local);
    return i >= 0 && w.mat[i] !== 0 && w.mat[i] !== MAT.water;
  }

  /** Height of the deck / ground (or the sea) under global p. */
  groundAt(p) {
    const z = this.zoneAt(p);
    if (!z?.sim) return { y: this.seaLevel, sea: true };
    const w = z.sim.world;
    const [lx, ly, lz] = z.local;
    if (lx < 0.5 || lz < 0.5 || lx > w.size[0] - 0.5 || lz > w.size[2] - 0.5) return { y: this.seaLevel, sea: true };
    for (let y = Math.min(ly + 0.5, w.size[1] - 0.01); y > 0; y -= w.h * 0.5) {
      const i = w.voxelAt(lx, y, lz);
      if (i >= 0 && w.mat[i]) {
        if (w.mat[i] === MAT.water) break;
        const top = (Math.floor(y / w.h) + 1) * w.h + (p.y - ly);
        return top > this.seaLevel ? { y: top, sea: false, zone: z } : { y: this.seaLevel, sea: true };
      }
    }
    return { y: this.seaLevel, sea: true };
  }

  // ------------------------------------------------------------------ visuals
  buildMesh(color) {
    const g = new THREE.Group();
    const paint = () => new THREE.MeshStandardMaterial({ color: new THREE.Color(color), metalness: 0.5, roughness: 0.45 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.6, roughness: 0.5 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x223344, metalness: 0.9, roughness: 0.1, transparent: true, opacity: 0.8 });
    const add = (geo, mat, x, y, z, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(0, 0, rz);
      m.castShadow = true;
      g.add(m);
      return m;
    };
    this.parts = {};
    add(new THREE.CylinderGeometry(0.75, 0.6, 11, 16), paint(), -0.5, 1.6, 0, Math.PI / 2);
    add(new THREE.ConeGeometry(0.6, 2.4, 16), paint(), 6.2, 1.6, 0, -Math.PI / 2);
    add(new THREE.SphereGeometry(0.5, 16, 10).scale(2.8, 0.9, 1), glass, 3, 2.3, 0);
    this.parts.wingL = add(new THREE.BoxGeometry(3.5, 0.15, 4.4), paint(), -0.75, 1.48, -2.9);
    this.parts.wingR = add(new THREE.BoxGeometry(3.5, 0.15, 4.4), paint(), -0.75, 1.48, 2.9);
    this.parts.tail = add(new THREE.BoxGeometry(1.5, 0.1, 4.4), paint(), -5.75, 1.55, 0);
    this.parts.fin = add(new THREE.BoxGeometry(1.7, 2.6, 0.12), paint(), -5.65, 2.9, 0);
    this.parts.engine = add(new THREE.CylinderGeometry(0.5, 0.45, 1.2, 14), dark.clone(), -6.6, 1.6, 0, Math.PI / 2);
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
    for (let k = 0; k < (this.vehicle.rockets ?? 0); k++) {
      const side = k % 2 ? 1 : -1;
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2, 8).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd8d8d0 }));
      r.position.set(-0.5, 1.2, side * (1.8 + Math.floor(k / 2) * 0.7));
      g.add(r);
      this.racks.push(r);
    }
    this.rocketGeo = new THREE.CylinderGeometry(0.09, 0.09, 1.8, 8).rotateZ(Math.PI / 2);
    this.rocketMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d0, emissive: 0x331100 });
    return g;
  }

  /** Smoke trail from a damaged / burning jet and from rockets (grey points in the shared sea). */
  buildTrail() {
    const n = 500;
    const pos = new Float32Array(n * 3).fill(-1e5);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const points = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x3a3a3a, size: 2.2, transparent: true, opacity: 0.5, depthWrite: false }));
    points.frustumCulled = false;
    return { points, n, k: 0, global: Array.from({ length: n }, () => null) };
  }

  puff(p, spread = 0.5) {
    const t = this.trail;
    t.global[t.k] = { x: p.x + (Math.random() - 0.5) * spread, y: p.y + (Math.random() - 0.5) * spread, z: p.z + (Math.random() - 0.5) * spread, age: 0 };
    t.k = (t.k + 1) % t.n;
  }

  drawTrail(dt) {
    const t = this.trail;
    const a = t.points.geometry.attributes.position;
    for (let k = 0; k < t.n; k++) {
      const q = t.global[k];
      if (!q) continue;
      q.age += dt;
      q.y += dt * 1.5;
      if (q.age > 6) {
        t.global[k] = null;
        a.setXYZ(k, -1e5, -1e5, -1e5);
        continue;
      }
      a.setXYZ(k, q.x - this.origin[0], q.y - this.origin[1], q.z - this.origin[2]);
    }
    a.needsUpdate = true;
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
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.roll, this.heading, this.pitch, 'YZX'));
    return {
      q,
      f: new THREE.Vector3(1, 0, 0).applyQuaternion(q),
      u: new THREE.Vector3(0, 1, 0).applyQuaternion(q),
      r: new THREE.Vector3(0, 0, 1).applyQuaternion(q),
    };
  }

  /** Global position of a point given in the aircraft frame. */
  at(q, v) {
    return new THREE.Vector3(...v).applyQuaternion(q).add(this.pos);
  }

  // ------------------------------------------------------------------ damage
  /** A blast of radius R at global point c: parts close to it are damaged. */
  blastDamage(c, R, q) {
    let any = 0;
    for (const [k, v] of Object.entries(PARTS)) {
      const d = this.at(q, v).distanceTo(c);
      const hit = Math.max(0, 1 - d / (2.2 * R)) * 1.3;
      if (hit > 0.01) {
        this.hurt(k, hit);
        any = Math.max(any, hit);
      }
    }
    if (any > 0.05) this.walk.say(`Hit by the blast! ${this.damageText()}`, 3);
  }

  hurt(part, amount) {
    const before = this.dmg[part];
    this.dmg[part] = Math.min(1, before + amount);
    if (before < 1 && this.dmg[part] >= 1) this.walk.say(part.startsWith('wing') ? `The ${PART_NAMES[part]} is torn off!` : `The ${PART_NAMES[part]} is destroyed!`, 3);
    if (part === 'engine' && this.dmg.engine > 0.6 && !this.burning) {
      this.burning = 1;
      this.walk.say('ENGINE FIRE', 3);
    }
  }

  damageText() {
    const parts = Object.entries(this.dmg).filter(([, v]) => v > 0.02);
    if (!parts.length) return 'none';
    return parts.map(([k, v]) => `${PART_NAMES[k]} ${Math.round(v * 100)}%`).join(', ');
  }

  // ------------------------------------------------------------------ update
  update(dt, keys) {
    if (this.done) return;
    this.followZone();
    const D = this.dmg;
    // controls
    if (keys.has('KeyW') || keys.has('ArrowUp')) this.throttle = Math.min(1, this.throttle + dt * 0.6);
    if (keys.has('KeyS') || keys.has('ArrowDown')) this.throttle = Math.max(0, this.throttle - dt * 0.8);
    const yawIn = (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0);
    // a damaged tail makes the controls sluggish and the jet wobble
    const ctl = 1 - 0.7 * D.tail;
    const auth = Math.min(1, this.speed / 35) * ctl;
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
      // a damaged wing gives less lift: the jet rolls towards it (a lost wing: a spin)
      const asym = D.wingR - D.wingL;
      this.roll += asym * (0.9 + 2.5 * Math.max(D.wingL, D.wingR) ** 4) * Math.min(1, this.speed / 30) * dt;
      if (Math.abs(this.rollIn) < 0.05 && Math.abs(asym) < 0.05) this.roll *= Math.exp(-0.4 * dt);
      this.roll = Math.atan2(Math.sin(this.roll), Math.cos(this.roll));
      const wobble = D.tail > 0.2 ? Math.sin(performance.now() / 180) * D.tail * 0.4 : 0;
      this.pitch = Math.max(-1.3, Math.min(1.3, this.pitch + (this.pitchIn * 1.4 * auth * Math.cos(this.roll) + wobble) * dt));
      this.heading += (yawIn * 0.35 * auth - Math.sin(this.roll) * 0.9 * Math.min(1, this.speed / 35)) * dt;
    }
    const { q, f, u } = this.axes();
    // fuel: burnt by the engine, and lost through a holed tank
    this.fuelLeft = Math.max(0, this.fuelLeft - (0.3 + 1.7 * this.throttle) * dt - D.fuel * 15 * dt);
    const thrust = this.fuelLeft > 0 ? (1 - D.engine) * THRUST : 0;
    // thrust, drag, gravity along the path
    const onDeck = this.onGround && !this.groundAt(this.pos).sea;
    let acc = this.throttle * thrust - DRAG * (1 + 0.5 * (D.wingL + D.wingR)) * this.speed * this.speed - G * f.y;
    if (onDeck && this.throttle > 0.9 && thrust > 0) acc += CATAPULT;
    if (this.onGround) acc -= 0.4; // rolling resistance
    this.speed = Math.max(0, this.speed + acc * dt);
    // lift (∝ speed²) against gravity, less with damaged wings; the jet sinks when slow
    const liftK = 1 - 0.45 * (D.wingL + D.wingR);
    const lift = G * liftK * Math.min(1.4, (this.speed / V_LIFT) ** 2) * Math.max(0, u.y);
    this.vy += (lift - G) * dt;
    this.vy *= Math.exp(-1.2 * dt);
    const prevY = this.pos.y;
    this.pos.addScaledVector(f, this.speed * dt);
    this.pos.y += this.vy * dt;
    // touching the deck / the ground / the sea
    const ground = this.groundAt(this.pos);
    if (this.pos.y <= ground.y) {
      const sink = (prevY - this.pos.y) / Math.max(dt, 1e-3) + Math.max(0, -this.vy);
      if (ground.sea) return this.crash('You ditched in the sea');
      if (!this.onGround && (sink > 7 || Math.abs(this.roll) > 0.5 || this.pitch < -0.2 || Math.max(D.wingL, D.wingR) >= 1)) return this.crash('Hard landing: the jet broke up');
      if (!this.onGround && sink > 4) {
        for (const k of ['wingL', 'wingR', 'tail']) this.hurt(k, (sink - 4) * 0.08);
        this.walk.say('Heavy landing – damaged', 2);
      }
      this.pos.y = ground.y;
      this.vy = Math.max(0, this.vy);
      if (!this.onGround) this.walk.say('Touchdown – S to brake, E to climb out when stopped', 3);
      this.onGround = true;
    } else if (this.pos.y > ground.y + 0.3) this.onGround = false;
    // flying into something: the nose is a crash, a wing tip or the tail scrapes and is damaged
    if (this.speed > 4) {
      if (this.solid(this.at(q, [7, 1.6, 0]))) return this.crash('You flew into it');
      for (const [k, v] of [['wingL', [-0.8, 1.5, -4.9]], ['wingR', [-0.8, 1.5, 4.9]], ['tail', [-6, 4.1, 0]]]) {
        if (this.dmg[k] < 1 && this.solid(this.at(q, v))) {
          this.hurt(k, 0.2 + this.speed / 150);
          this.speed *= 0.85;
          this.walk.say(`Scraped the ${PART_NAMES[k]}!`, 2);
        }
      }
    }
    // what the shown zone does to the jet: hot gas and flames, blasts
    this.environment(dt, q);
    // a fire on board eats into everything
    if (this.burning) {
      this.hurt('engine', dt * 0.03);
      this.hurt('fuel', dt * 0.02);
      this.hurt('tail', dt * 0.01);
      if (this.dmg.fuel > 0.8 && this.fuelLeft > 50 && Math.random() < dt * 0.15) return this.crash('The fuel tank exploded');
    }
    // rockets
    this.cool -= dt;
    if (this.fireRequested) {
      this.fireRequested = false;
      if (this.rockets > 0 && this.cool <= 0) {
        this.cool = 0.35;
        const k = (this.vehicle.rockets ?? 0) - this.rockets;
        const side = k % 2 ? 1 : -1;
        const from = this.at(q, [2.5, 1.1, side * (1.8 + Math.floor(k / 2) * 0.7)]);
        const mesh = new THREE.Mesh(this.rocketGeo, this.rocketMat);
        this.view.scene.add(mesh);
        this.flying.push({ p: from, v: f.clone().multiplyScalar(this.speed + 70), age: 0, mesh });
        this.rockets--;
        if (this.racks[k]) this.racks[k].visible = false;
        if (this.walk.sound.running) this.walk.sound.burst(this.walk.sound.ctx.currentTime, 0.4, 'lowpass', 900, 0.7, 0.6);
      } else if (this.rockets <= 0) this.walk.say('No rockets left', 1.5);
    }
    this.stepRockets(dt, q);
    this.draw(dt, q, f, u, ground);
  }

  /** Hot gas, flames and explosions in the zone being shown. */
  environment(dt, q) {
    const sim = this.sim;
    const w = sim.world;
    const lp = this.local(this.pos);
    const a = sim.airCellAt(lp.x, lp.y + 1.6, lp.z);
    if (a >= 0) {
      const T = w.airT[a];
      if (T > 150) this.hurt('engine', ((T - 150) / 1500) * dt); // the engine swallows hot gas
      if (w.flame[a] > 0.3) for (const k of Object.keys(PARTS)) this.hurt(k, 0.04 * dt);
      if (w.smoke[a] / w.ah ** 3 > 0.002) this.hurt('engine', 0.01 * dt);
    }
    for (; this.seenEvents < w.events.length; this.seenEvents++) {
      const e = w.events[this.seenEvents];
      if (e.type !== 'explosion' || !e.pos) continue;
      const c = new THREE.Vector3(e.pos[0] + this.origin[0], e.pos[1] + this.origin[1], e.pos[2] + this.origin[2]);
      if (c.distanceTo(this.pos) < 3 * (e.radius ?? 5) + 8) this.blastDamage(c, e.radius ?? 5, q);
    }
  }

  /** Rockets in the shared sea: motor for 3 s, then ballistic; they explode in whatever zone they hit. */
  stepRockets(dt, q) {
    const keep = [];
    for (const g of this.flying) {
      g.age += dt;
      const steps = Math.min(60, Math.max(1, Math.ceil((g.v.length() * dt) / 0.3)));
      const sdt = dt / steps;
      let done = false;
      for (let s = 0; s < steps && !done; s++) {
        if (g.age < 3) g.v.addScaledVector(g.v.clone().normalize(), 60 * sdt);
        g.v.y -= G * sdt;
        g.p.addScaledVector(g.v, sdt);
        const z = this.zoneAt(g.p, true);
        if (z?.sim) {
          const w = z.sim.world;
          const i = w.voxelAt(...z.local);
          const enemy = z.sim.hitEnemy?.(z.local, 'rocket', g);
          if (enemy || (i >= 0 && w.mat[i] && w.mat[i] !== MAT.water)) {
            explode(z.sim, z.local, ROCKET_E, { name: 'rocket' });
            // a blast in a zone not shown does not come through environment(): damage the jet here
            if (z.name !== this.zone) this.blastDamage(g.p, 0.4 * Math.cbrt(ROCKET_E / 1000), q);
            done = true;
            break;
          }
        }
        if (g.p.y < this.seaLevel) {
          const l = this.local(g.p);
          for (let k = 0; k < 30; k++)
            this.view.flames.spawn(l.x + (Math.random() - 0.5) * 2, this.seaLevel - this.origin[1] + Math.random(), l.z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3, 3 + Math.random() * 5, (Math.random() - 0.5) * 3, 0.5, 0.6, 0, 0.3);
          done = true;
        }
      }
      if (done || g.age > 14) {
        this.view.scene.remove(g.mesh);
        continue;
      }
      const l = this.local(g.p);
      g.mesh.position.copy(l);
      g.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), g.v.clone().normalize());
      if (g.age < 3) {
        const back = g.v.clone().normalize().multiplyScalar(-1.1);
        this.view.flames.spawn(l.x + back.x, l.y + back.y, l.z + back.z, back.x * 4, back.y * 4, back.z * 4, 0.25, 0.25, 0, 1);
        this.puff(g.p.clone().add(back), 0.2);
      }
      keep.push(g);
    }
    this.flying = keep;
  }

  draw(dt, q, f, u, ground) {
    const D = this.dmg;
    const lp = this.local(this.pos);
    this.mesh.position.copy(lp);
    this.mesh.quaternion.copy(q);
    this.gear.visible = this.onGround || this.pos.y - ground.y < 12;
    this.flame.visible = this.throttle > 0.05 && this.fuelLeft > 0 && D.engine < 1;
    this.flame.scale.set(1, (0.4 + this.throttle * (0.8 + Math.random() * 0.3)) * (1 - D.engine * 0.7), 1);
    // damaged parts darken, lost wings are gone
    for (const k of ['wingL', 'wingR', 'tail', 'engine']) {
      const m = this.parts[k];
      m.visible = D[k] < 1 || k === 'engine';
      if (!m.userData.base) m.userData.base = m.material.color.clone();
      m.material.color.copy(m.userData.base).multiplyScalar(1 - 0.75 * D[k]);
      m.material.roughness = 0.45 + D[k] * 0.5;
    }
    this.parts.fin.visible = D.tail < 1;
    // smoke from damage, flames from a fire on board
    for (const [k, v] of Object.entries(PARTS)) if (D[k] > 0.25 && Math.random() < dt * 30 * D[k]) this.puff(this.at(q, v), 0.6);
    if (this.burning || D.fuel > 0.3) {
      const l = this.local(this.at(q, this.burning ? PARTS.engine : PARTS.fuel));
      for (let k = 0; k < 3; k++) this.view.flames.spawn(l.x + (Math.random() - 0.5) * 0.8, l.y + (Math.random() - 0.5) * 0.5, l.z + (Math.random() - 0.5) * 0.8, -f.x * 3, 1 - f.y * 3, -f.z * 3, 0.5, 0.4, 0, 1);
    }
    this.drawTrail(dt);
    // chase camera
    const back = new THREE.Vector3(-Math.cos(this.heading), 0, Math.sin(this.heading));
    const want = lp.clone().addScaledVector(back, 18).add(new THREE.Vector3(0, 5.5, 0)).addScaledVector(u, 1);
    this.camPos.lerp(want, Math.min(1, dt * 4));
    const cam = this.view.camera;
    cam.position.copy(this.camPos);
    cam.up.set(0, 1, 0);
    cam.lookAt(lp.clone().addScaledVector(f, 12).add(new THREE.Vector3(0, 2, 0)));
    cam.updateMatrixWorld();
    if (this.engine) {
      const t = this.walk.sound.ctx.currentTime;
      const run = this.fuelLeft > 0 ? 1 - D.engine * 0.6 : 0;
      this.engine.o.frequency.setTargetAtTime((45 + this.throttle * 70 + this.speed * 0.3) * (1 - D.engine * 0.3), t, 0.1);
      this.engine.o2.frequency.setTargetAtTime(90 + this.throttle * 160 + (D.engine > 0.3 ? Math.random() * 60 * D.engine : 0), t, 0.05);
      this.engine.f.frequency.setTargetAtTime(400 + this.throttle * 1800, t, 0.1);
      this.engine.g.gain.setTargetAtTime((0.04 + this.throttle * 0.22) * run, t, 0.1);
    }
    const alt = this.pos.y - this.seaLevel;
    const deg = (a) => Math.round((a * 180) / Math.PI);
    const warn = [];
    if (!this.onGround && this.speed < V_LIFT * 0.7) warn.push('⚠ STALL');
    if (this.burning) warn.push('🔥 ENGINE FIRE');
    if (D.fuel > 0.05 && this.fuelLeft > 0) warn.push('⚠ FUEL LEAK');
    if (this.fuelLeft <= 0) warn.push('⚠ NO FUEL');
    if (Math.max(D.wingL, D.wingR) >= 1) warn.push('⚠ WING LOST');
    this.hud.textContent =
      `JET  throttle ${Math.round(this.throttle * 100)}%   speed ${Math.round(this.speed * 3.6)} km/h   alt ${Math.round(alt)} m   vs ${this.vy.toFixed(1)} m/s\n` +
      `pitch ${deg(this.pitch)}°  bank ${deg(this.roll)}°  heading ${(360 + deg(-this.heading)) % 360}°   rockets ${this.rockets}   fuel ${Math.round(this.fuelLeft)} l\n` +
      `damage: ${this.damageText()}` +
      (this.onGround ? (this.speed < 1 ? '   [E] climb out' : this.speed < V_LIFT * 0.85 ? '   full throttle: catapult' : '   pull up (mouse)') : '') +
      (warn.length ? `\n${warn.join('   ')}` : '');
  }

  /** Climb out (E): only stopped on a deck or flat ground, where the jet is voxelised again. */
  tryExit() {
    if (!this.onGround || this.speed > 1) return this.walk.say('Stop first (S to brake)', 2);
    const g = this.groundAt(this.pos);
    if (g.sea || !g.zone?.sim) return this.walk.say('Not on solid ground', 2);
    if (g.zone.name !== this.zone) return this.walk.say('Roll a bit further in', 2);
    const w = g.zone.sim.world;
    const l = g.zone.local;
    if (l[0] < 6 || l[2] < 6 || l[0] > w.size[0] - 6 || l[2] > w.size[2] - 6) return this.walk.say('Too close to the edge', 2);
    const obj = this.vehicle.obj;
    const placed = {
      ...obj,
      params: { ...obj.params, rockets: this.rockets, fuelLiters: Math.round(this.fuelLeft) },
      damage: { ...this.dmg },
      x: l[0],
      z: l[2],
      y: g.y - this.origin[1] - w.h,
      rotation: (this.heading * 180) / Math.PI,
    };
    placeObject(w, placed, g.zone.name === this.home ? this.vehicle.owner : 900);
    const side = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading)).multiplyScalar(-6);
    const lp = this.local(this.pos);
    this.end(null, [lp.x + side.x, lp.y, lp.z + side.z], null);
  }

  crash(msg) {
    const p = this.pos.clone();
    p.y = Math.max(p.y + 1, this.seaLevel + 0.5);
    const z = this.zoneAt(p, true);
    const E = 3e6 + Math.min(1, this.fuelLeft / 2000) * 1.7e7;
    if (z?.sim) {
      explode(z.sim, z.local, E, { name: 'jet crash' });
      if (this.fuelLeft > 50) {
        z.sim.ignite(z.local, 2.5);
        z.sim.addTorch(z.local, 4e5, 15, 1.5); // the fuel fireball
      }
    }
    const l = this.local(p);
    for (let k = 0; k < 120; k++)
      this.view.flames.spawn(l.x + (Math.random() - 0.5) * 6, l.y + Math.random() * 4, l.z + (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4, 4 + Math.random() * 4, (Math.random() - 0.5) * 4, 1.2, 1.5, 0, 1);
    const snd = this.walk.sound;
    if (snd.running) {
      snd.thump(snd.ctx.currentTime, 1);
      snd.burst(snd.ctx.currentTime, 1.5, 'lowpass', 300, 0.7, 1);
    }
    // you eject, are picked up and brought back to the ship
    this.end(`${msg}. You ejected and were brought back to the ship.`, null, this.home);
  }

  end(msg, at, zone) {
    this.dispose();
    this.walk.endFlight(msg, at, zone);
  }

  /** Remove the meshes, HUD and engine sound. */
  dispose() {
    if (this.done && !this.mesh.parent) return;
    this.done = true;
    this.view.scene.remove(this.mesh);
    this.view.scene.remove(this.trail.points);
    for (const g of this.flying) this.view.scene.remove(g.mesh);
    this.flying = [];
    this.hud.remove();
    if (this.engine) {
      const t = this.walk.sound.ctx.currentTime;
      this.engine.g.gain.setTargetAtTime(0, t, 0.2);
      this.engine.o.stop(t + 1);
      this.engine.o2.stop(t + 1);
    }
  }
}
