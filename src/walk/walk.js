import * as THREE from 'three';
import { defaultSpawn, spawnFloor } from '../sim/createSimulation.js';
import { SoundScape } from '../audio/sound.js';
import { F_FALLING } from '../sim/world.js';
import { MATERIALS } from '../sim/materials.js';
import { toggleDoor, nearestDoor, doorGlassBroken } from '../sim/doors.js';
import { F_BROKEN } from '../sim/world.js';
import { AGENTS } from '../sim/simulation.js';
import { Flight } from './flight.js';
import { pressureAt, suctionAt } from '../sim/vacuum.js';

const EYE_STAND = 1.65;
const EYE_CRAWL = 0.7;
const RADIUS = 0.25;
// SCBA: 6.8 l cylinder at 300 bar ≈ 2040 l of free air
const AIR_LITRES = 2040;

/**
 * First-person walk-through as a firefighter wearing breathing apparatus.
 *
 * Controls: click to start (pointer lock), WASD / arrows to move, mouse to look,
 * Shift to hurry, C to crawl (under the smoke the view and the heat are better),
 * 1/2/3 select the hose (fog nozzle), a fire torch or a hand grenade; the left
 * mouse button uses it (hold for hose/torch, click to throw). T for the thermal
 * imaging camera (sees through smoke), L for the helmet lamp, Esc to leave.
 *
 * The mask view shows the remaining air (consumption depends on effort and
 * heat), the gas temperature at your face, a rough visibility estimate and
 * warnings. Sound: breathing apparatus, fire, gas jet, hose, alarms.
 */
export class Walkthrough {
  constructor(view, hooks) {
    this.view = view;
    this.hooks = hooks; // { getSim, onThermal(bool), sprayAgent }
    this.active = false;
    this.keys = new Set();
    this.yaw = 0;
    this.pitch = 0;
    this.crawl = false;
    this.spraying = false;
    this.thermal = false;
    this.tool = 'hose';
    this.throwRequested = false;
    this.sound = new SoundScape();
    this.el = {
      mask: document.getElementById('mask'),
      start: document.getElementById('walkStart'),
      hud: document.getElementById('maskHud'),
      fog: document.querySelector('#mask .fog'),
      heat: document.querySelector('#mask .heat'),
      tic: document.querySelector('#mask .tic'),
      canvas: document.getElementById('maskCanvas'),
      burn: document.querySelector('#mask .burn'),
      down: document.getElementById('walkDown'),
    };
    this.lamp = new THREE.SpotLight(0xfff1d6, 0, 25, Math.PI / 7, 0.5, 1.2);
    this.lamp.position.set(0.15, 0.1, 0);
    this.lamp.target.position.set(0, 0, -1);
    this.lampOn = true;
    this.tank = { remaining: 1e9 };
    this.bind();
  }

  bind() {
    const canvas = this.view.renderer.domElement;
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      if (this.active && !locked) this.pause();
      if (locked) this.el.start.hidden = true;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.active || document.pointerLockElement !== canvas) return;
      if (this.flight) return this.flight.mouse(e.movementX, e.movementY);
      this.yaw -= e.movementX * 0.0022;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - e.movementY * 0.0022));
    });
    document.addEventListener('mousedown', (e) => {
      if (this.active && document.pointerLockElement === canvas && e.button === 0) {
        if (this.flight) this.flight.fireRequested = true;
        else if (this.tool === 'grenade') this.throwRequested = true;
        else if (this.tool === 'bow') this.draw = 0;
        else this.spraying = true;
      }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.spraying = false;
        if (this.draw !== undefined) this.loose = true;
      }
    });
    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      this.keys.add(e.code);
      if (this.flight) {
        if (e.code === 'KeyE') this.flight.tryExit();
        if (e.code === 'KeyX') this.flight.eject();
        if (e.code === 'Space') this.flight.fireRequested = true;
        return;
      }
      if (e.code === 'KeyC' || e.code === 'ControlLeft') this.toggleCrawl();
      if (e.code === 'KeyT') this.setThermal(!this.thermal);
      if (e.code === 'KeyL') this.lampOn = !this.lampOn;
      if (e.code === 'Digit1') this.tool = 'hose';
      if (e.code === 'Digit2') this.tool = 'torch';
      if (e.code === 'Digit3') this.tool = 'grenade';
      if (e.code === 'Digit4' && this.ext) this.tool = 'ext';
      if (e.code === 'Digit5' && this.reel) this.tool = 'reel';
      if (e.code === 'Digit6') this.tool = 'bow';
      if (e.code === 'KeyE') this.interact();
      if (e.code === 'KeyO') this.inert();
      if (e.code === 'KeyF') this.strike();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    document.getElementById('walkGo').addEventListener('click', () => this.resume());
  }

  /** Enter walk mode at the scenario's spawn point (or the world's edge). */
  enter() {
    const sim = this.hooks.getSim();
    const w = sim.world;
    const sp = sim.spawn ?? defaultSpawn(w);
    this.pos = new THREE.Vector3(sp.p[0], 0, sp.p[2]);
    // on the floor at the start point (not on the roof above it: catacombs, below deck)
    this.pos.y = spawnFloor(w, sp.p);
    // yaw 0 = looking along +x
    this.yaw = -Math.PI / 2 - (sp.yaw ?? 0);
    this.pitch = 0;
    this.crawl = false;
    this.air = AIR_LITRES;
    this.startTime = w.time;
    this.resetBody();
    this.active = true;
    const v = this.view;
    v.controls.enabled = false;
    this.savedFov = v.camera.fov;
    v.camera.fov = 72;
    v.camera.near = 0.05;
    v.camera.updateProjectionMatrix();
    if (!v.camera.parent) v.scene.add(v.camera);
    v.camera.add(this.lamp);
    v.camera.add(this.lamp.target);
    this.el.mask.hidden = false;
    this.el.start.hidden = false;
  }

  /** Where the sea is coming in (for the sound), the missing hull plating closest to you. */
  breachPos(w) {
    if (!w.hull) return null;
    let best = null;
    let bd = Infinity;
    for (let k = 0; k < w.hull.length; k += 3) {
      const i = w.hull[k];
      if (w.mat[i] && w.mat[i] !== MATERIALS.findIndex((m) => m.name === 'water')) continue;
      const c = w.center(...w.coords(i));
      if (c[1] > w.sea.level) continue;
      const d = Math.hypot(c[0] - this.pos.x, c[2] - this.pos.z);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  /** E: open/close the nearest door, or take the nearest extinguisher / hose reel. */
  interact() {
    const sim = this.hooks.getSim();
    const w = sim.world;
    const p = [this.pos.x, this.pos.y + 1.1, this.pos.z];
    // a hatch or ladder to another part of the ship
    const pt = w.portals.find((q) => Math.hypot(q.p[0] - this.pos.x, q.p[2] - this.pos.z) < q.r + 0.8 && Math.abs(q.p[1] - this.pos.y) < 1.5);
    // the docking port: back into the jet docked outside
    if (pt?.to === 'jet') {
      if (!this.orphan?.docked) return this.say('No craft is docked here', 2);
      this.flight = this.orphan;
      this.orphan = null;
      this.spraying = false;
      this.el.mask.hidden = true;
      this.lamp.intensity = 0;
      this.flight.undock();
      return;
    }
    if (pt && this.hooks.onPortal) return this.hooks.onPortal(pt);
    // the jet: climb in
    const veh = w.vehicles.find((q) => Math.hypot(q.seat[0] - this.pos.x, q.seat[2] - this.pos.z) < 4.5 && Math.abs(q.base[1] - this.pos.y) < 2);
    if (veh) return this.board(veh);
    let best = null;
    let bd = 1.7;
    w.pickups.forEach((pk) => {
      if (pk.taken) return;
      const d = Math.hypot(pk.p[0] - p[0], pk.p[1] - p[1], pk.p[2] - p[2]);
      if (d < bd) {
        bd = d;
        best = { pk };
      }
    });
    const dk = nearestDoor(w, p, bd);
    if (dk >= 0) best = { door: dk };
    if (!best) return this.say('Nothing to use here');
    if (best.door !== undefined) {
      const d0 = w.doors[best.door];
      if (d0.locked && !d0.open) {
        if (doorGlassBroken(w, best.door)) {
          // reach through the broken glass and open it from the other side
          this.arm = { mode: 'reach', t: 0, door: best.door };
          return this.say('You reach through the broken glass for the handle…', 2);
        }
        return this.say(d0.glass?.length ? 'Locked. Break the glass (F) and reach through' : 'Locked', 3);
      }
      toggleDoor(sim, best.door);
      const d = w.doors[best.door];
      this.sound.door?.();
      return this.say(`${d.name}: ${d.open ? 'opened' : 'closed'}`, 2);
    }
    const pk = best.pk;
    if (pk.type === 'extinguisher') {
      pk.taken = true;
      for (const i of pk.voxels) if (w.pickupTag[i]) w.clearVoxel(i);
      this.ext = { agent: pk.agent, tank: { remaining: AGENTS[pk.agent].capacity } };
      this.tool = 'ext';
      this.say(`You took the ${AGENTS[pk.agent].label} extinguisher (key 4)`);
    } else if (pk.type === 'hoseReel') {
      pk.taken = true;
      this.reel = { p: pk.p, length: pk.length ?? 30 };
      this.tool = 'reel';
      this.say(`You run out the hose reel (key 5), ${this.reel.length} m of hose`);
    }
  }

  /** Climb into the jet and fly it (see flight.js). */
  board(vehicle) {
    const sim = this.hooks.getSim();
    this.spraying = false;
    this.arm = null;
    this.flight = new Flight(this, sim, vehicle);
    this.el.mask.hidden = true;
    this.lamp.intensity = 0;
    this.say('W/S throttle (full throttle on deck = catapult), mouse pitch/roll, A/D rudder, Space/click rockets, X eject', 6);
  }

  /** Back on your feet after flying: next to the parked jet, or ejected at the spawn point. */
  endFlight(msg, at, zone, orphan = null) {
    this.flight = null;
    // after ejecting, the empty jet may still be flying: it carries on until it comes down
    this.orphan = orphan;
    this.el.mask.hidden = false;
    const v = this.view;
    v.camera.up.set(0, 1, 0);
    // after a crash you are brought back to where the jet came from
    if (zone && this.hooks.zones && this.hooks.zones.current() !== zone) this.hooks.zones.activate(zone);
    const sim = this.hooks.getSim();
    const w = sim.world;
    const p = at ?? sim.spawn?.p ?? [w.size[0] * 0.1, 0, w.size[2] / 2];
    this.pos.set(p[0], this.floorAt(p[0], p[2], Math.min(w.size[1], (p[1] ?? 0) + 3)), p[2]);
    this.pitch = 0;
    if (msg) this.say(msg, 5);
  }

  /** Arrive in another zone (after a hatch / ladder) at p, looking along yaw. */
  arrive(p, yaw = 0) {
    const w = this.hooks.getSim().world;
    this.pos.set(p[0], p[1] == null ? spawnFloor(w, p) : this.floorAt(p[0], p[2], Math.min(w.size[1], p[1] + 1.5)), p[2]);
    this.yaw = -Math.PI / 2 - yaw;
    this.pitch = 0;
    this.near = null;
  }

  /** F: strike what is in front of you (helmet, axe handle): glass breaks, loudly. */
  strike() {
    const sim = this.hooks.getSim();
    const w = sim.world;
    if (this.arm && this.arm.mode === 'reach') return;
    this.arm = { mode: 'swing', t: 0 };
    const v = this.view;
    const rect = v.renderer.domElement.getBoundingClientRect();
    const hit = v.pick(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (!hit || hit.voxel < 0) return;
    const head = v.camera.position;
    if (Math.hypot(hit.point[0] - head.x, hit.point[1] - head.y, hit.point[2] - head.z) > 1.8) return;
    const M = MATERIALS[w.mat[hit.voxel]];
    if (M.shatterTemp !== Infinity) {
      // the pane goes: everything of that glass around the impact
      sim.forSphere(hit.point, 0.45, (i) => {
        if (MATERIALS[w.mat[i]].shatterTemp !== Infinity) w.flags[i] |= 2 | F_BROKEN; // falling
      });
      w.structureDirty = true;
      sim.glassNoise(hit.voxel);
      this.sound.glass?.();
      this.say('The glass shatters', 2);
    } else {
      w.crack[hit.voxel] += 0.15;
      w.noises.push({ p: hit.point, loud: 8, time: w.time, kind: 'strike' });
      this.sound.door?.();
    }
  }

  /** O: flood the room you are in with inert gas. */
  inert() {
    const sim = this.hooks.getSim();
    const r = sim.inertRoom([this.pos.x, this.pos.y + 1, this.pos.z]);
    this.say(r.open ? 'Inert gas released, but this space is open: it leaks away' : 'Room flooded with inert gas: the fire will starve (you are on breathing apparatus)', 5);
  }

  /** A gloved forearm in view (only while it does something). */
  updateArm() {
    if (!this.armMesh) {
      const g = new THREE.Group();
      const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.42), new THREE.MeshStandardMaterial({ color: 0x5a4a22, roughness: 0.9 }));
      sleeve.position.z = -0.21;
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.115, 0.04), new THREE.MeshStandardMaterial({ color: 0xd8d860, emissive: 0x303010 }));
      band.position.z = -0.3;
      const glove = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.13), new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 1 }));
      glove.position.z = -0.48;
      g.add(sleeve, band, glove);
      g.visible = false;
      this.view.camera.add(g);
      this.armMesh = g;
    }
    const a = this.arm;
    const g = this.armMesh;
    g.visible = !!a;
    if (!a) return;
    if (a.mode === 'swing') {
      const k = Math.sin(Math.min(1, a.t / 0.45) * Math.PI);
      g.position.set(0.22 - 0.12 * k, -0.25 + 0.05 * k, -0.15 - 0.35 * k);
      g.rotation.set(0.2 * k, 0.3 - 0.4 * k, 0);
    } else {
      // forward through the hole, a turn of the wrist, back
      const t = a.t;
      const out = t < 0.8 ? t / 0.8 : t < 1.5 ? 1 : Math.max(0, 1 - (t - 1.5) / 0.5);
      g.position.set(0.12, -0.12 + 0.05 * out, -0.15 - 0.7 * out);
      g.rotation.set(0, 0, t > 0.9 && t < 1.4 ? Math.sin((t - 0.9) * 12) * 0.6 : 0);
    }
  }

  resetBody() {
    this.health = 100;
    this.onFire = 0; // seconds of burning gear left
    this.mask = 1; // visor integrity
    this.maskBurst = false;
    this.cracks = [];
    this.hits = new Set();
    this.downed = false;
    this.lastHit = 0;
    this.message = '';
    this.messageUntil = 0;
    if (this.el.down) this.el.down.hidden = true;
  }

  respawn() {
    const sim = this.hooks.getSim();
    const w = sim.world;
    const sp = sim.spawn ?? defaultSpawn(w);
    this.pos.set(sp.p[0], spawnFloor(w, sp.p), sp.p[2]);
    this.yaw = -Math.PI / 2 - (sp.yaw ?? 0);
    this.air = AIR_LITRES;
    this.crawl = false;
    this.resetBody();
  }

  say(text, seconds = 4) {
    const w = this.hooks.getSim().world;
    this.message = text;
    this.messageUntil = w.time + seconds;
  }

  /** A crack in the visor from point (x, y) in 0..1 screen units. */
  addCrack(x, y, size) {
    const lines = [];
    const n = 3 + Math.floor(Math.random() * 4);
    for (let k = 0; k < n; k++) {
      let a = Math.random() * Math.PI * 2;
      let px = x;
      let py = y;
      const pts = [[px, py]];
      const segs = 3 + Math.floor(Math.random() * 5);
      for (let s = 0; s < segs; s++) {
        a += (Math.random() - 0.5) * 0.9;
        const l = size * (0.03 + Math.random() * 0.06);
        px += Math.cos(a) * l;
        py += Math.sin(a) * l;
        pts.push([px, py]);
      }
      lines.push(pts);
    }
    this.cracks.push(...lines);
  }

  damageMask(amount, x = 0.3 + Math.random() * 0.4, y = 0.25 + Math.random() * 0.4) {
    if (this.maskBurst) return;
    const before = this.mask;
    this.mask = Math.max(0, this.mask - amount);
    // a new crack every 15 % of integrity lost
    if (Math.floor(before / 0.15) !== Math.floor(this.mask / 0.15)) {
      this.addCrack(x, y, 1 + (1 - this.mask) * 2);
      this.sound.crack?.();
    }
    if (this.mask <= 0) {
      this.maskBurst = true;
      for (let k = 0; k < 4; k++) this.addCrack(0.5 + (Math.random() - 0.5) * 0.3, 0.45 + (Math.random() - 0.5) * 0.3, 3);
      this.say('MASK FAILURE – smoke is getting in, get out!', 8);
    }
  }

  hurt(amount) {
    if (this.downed) return;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) {
      this.downed = true;
      this.spraying = false;
      if (this.el.down) this.el.down.hidden = false;
      if (document.pointerLockElement) document.exitPointerLock();
    }
  }

  /**
   * What the fire does to you this frame: hot gas and radiant heat through the
   * turnout gear, flames that set the gear alight, things falling on your head,
   * running out of air, breathing smoke through a broken mask.
   */
  body(dt, sim, cam, eye) {
    const w = sim.world;
    const pts = [
      [this.pos.x, this.pos.y + 0.25, this.pos.z],
      [this.pos.x, this.pos.y + eye * 0.6, this.pos.z],
      [cam.position.x, cam.position.y, cam.position.z],
    ];
    let gas = w.ambient;
    let flame = 0;
    let rad = 0;
    let smokeC = 0;
    let wet = false;
    for (const p of pts) {
      const a = sim.airCellAt(...p);
      if (a < 0) continue;
      gas = Math.max(gas, w.airT[a]);
      flame = Math.max(flame, w.flame[a]);
      rad = Math.max(rad, w.radField[a]);
      smokeC = Math.max(smokeC, w.smoke[a] / w.ah ** 3);
      const i = w.voxelAt(p[0], p[1] - w.h, p[2]);
      if (i >= 0 && w.waterIn[i] > 0) wet = true;
    }
    // turnout gear: comfortable to ~100 °C gas and ~5 kW/m², harm grows fast above
    let dmg = Math.max(0, (gas - 110) / 45) + Math.max(0, (rad - 6000) / 2500);
    // flames on you: the gear catches fire
    if (flame > 0.35 && this.onFire <= 0 && Math.random() < dt * 2 * flame) {
      this.onFire = 25;
      this.say('YOUR GEAR IS ON FIRE – crawl (C) to roll it out, or get water on you');
    }
    if (this.onFire > 0) {
      dmg += 6;
      // rolling on the floor smothers it, water puts it out
      this.onFire -= dt * (this.crawl && this.moving ? 6 : 1);
      if (wet || this.selfDouse) this.onFire -= dt * 15;
      if (this.onFire <= 0) {
        this.onFire = 0;
        this.say('Fire on your gear is out');
      }
      // flames around you, visible in the scene too
      for (let k = 0; k < 4; k++) this.view.flames.spawn(this.pos.x + (Math.random() - 0.5) * 0.5, this.pos.y + Math.random() * (eye + 0.2), this.pos.z + (Math.random() - 0.5) * 0.5, 0, 1, 0, 0.3, 0.25, 0, 0.8);
    }
    // the visor: polycarbonate softens and crazes in high heat
    const headA = sim.airCellAt(...pts[2]);
    const headT = headA >= 0 ? w.airT[headA] : w.ambient;
    const visorHeat = Math.max(0, (headT - 170) / 700) + Math.max(0, (rad - 14000) / 90000) + (this.onFire > 0 ? 0.03 : 0);
    if (visorHeat > 0) this.damageMask(visorHeat * dt);
    // falling things: tiles, debris, fragments near your head
    const head = pts[2];
    for (const d of w.debris) {
      if (d.flake) continue;
      const dx = d.p[0] - head[0];
      const dy = d.p[1] - head[1];
      const dz = d.p[2] - head[2];
      if (dx * dx + dy * dy + dz * dz < 0.16 && !this.hits.has(d)) {
        this.hits.add(d);
        const m = MATERIALS[d.mat].density * d.dens * w.h ** 3;
        const v = Math.hypot(...d.v);
        const e = Math.min(1, 0.5 * m * v * v / 60);
        this.hurt(5 + 35 * e);
        this.damageMask(0.1 + 0.6 * e, 0.5 + dx, 0.45 - dy);
        this.say('Hit by flying debris!');
      }
    }
    const above = w.voxelAt(head[0], head[1] + w.h * 0.6, head[2]);
    if (above >= 0 && w.mat[above] && w.flags[above] & F_FALLING && !this.hits.has(above) && w.time - this.lastHit > 1) {
      this.hits.add(above);
      this.lastHit = w.time;
      this.hurt(8);
      this.damageMask(0.15, 0.5, 0.25);
      this.say(`A falling ${MATERIALS[w.mat[above]].label.toLowerCase()} hits your helmet!`);
    }
    // no air, or smoke through a broken mask (CO, irritants)
    if (this.air <= 0) dmg += 8;
    if (this.maskBurst) dmg += Math.min(10, smokeC * 4000);
    if (dmg > 0) this.hurt(dmg * dt);
    // a little recovery in clean, cool air
    else if (this.health < 100 && this.onFire <= 0) this.health = Math.min(100, this.health + dt * 0.5);
    return { gas, rad, flame, smokeC };
  }

  /** Visor overlay: cracks, glare of bright lights, smoke lit up by the helmet lamp. */
  drawVisor(sim, cam, smokeSigma) {
    const c = this.el.canvas;
    if (!c) return;
    const W = (c.width = c.clientWidth);
    const H = (c.height = c.clientHeight);
    const g = c.getContext('2d');
    g.clearRect(0, 0, W, H);
    // the helmet lamp lights up the smoke right in front of you ("white wall")
    if (this.lampOn && smokeSigma > 0.05) {
      const k = Math.min(0.75, 1 - Math.exp(-smokeSigma * 1.5));
      const gr = g.createRadialGradient(W * 0.53, H * 0.45, 0, W * 0.53, H * 0.45, W * 0.6);
      gr.addColorStop(0, `rgba(235,228,210,${k})`);
      gr.addColorStop(1, `rgba(200,195,180,${k * 0.4})`);
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
    }
    // glare from bright sources: the fire, the sun when outside, plus a ghost
    // reflection on the curved visor
    const sources = [];
    const fl = this.view.fireLight;
    if (sim.stats.hrr > 2000) sources.push({ p: fl.position.clone(), i: Math.min(1.2, Math.sqrt(sim.stats.hrr / 1e5)), color: [255, 170, 80] });
    const sunDir = this.view.sun.position.clone().sub(this.view.sun.target.position).normalize();
    const w = sim.world;
    const ci = Math.floor(cam.position.x / w.h) + w.nx * Math.floor(cam.position.z / w.h);
    const outside = cam.position.x < 0 || cam.position.z < 0 || cam.position.x > w.size[0] || cam.position.z > w.size[2] || w.colTop[ci] * w.h < cam.position.y;
    if (outside && this.view.sun.intensity > 0.5) sources.push({ p: cam.position.clone().add(sunDir.multiplyScalar(100)), i: 1, color: [255, 245, 225] });
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    for (const s of sources) {
      const to = s.p.clone().sub(cam.position);
      const dist = to.length();
      const facing = to.normalize().dot(fwd);
      if (facing < 0.2) continue;
      const ndc = s.p.clone().project(cam);
      const x = (ndc.x * 0.5 + 0.5) * W;
      const y = (-ndc.y * 0.5 + 0.5) * H;
      const strength = s.i * Math.min(1, 4 / Math.max(1, dist)) * (facing - 0.2) * Math.exp(-smokeSigma * Math.min(dist, 10) * 0.5);
      if (strength < 0.02) continue;
      const [r, gg, b] = s.color;
      const blob = (bx, by, rad, a) => {
        const gr = g.createRadialGradient(bx, by, 0, bx, by, rad);
        gr.addColorStop(0, `rgba(${r},${gg},${b},${a})`);
        gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
        g.fillStyle = gr;
        g.fillRect(bx - rad, by - rad, rad * 2, rad * 2);
      };
      blob(x, y, W * 0.25 * strength + 30, 0.45 * strength);
      // ghost reflected through the visor centre, and a soft sheen across it
      blob(W - x * 0.9, H - y * 0.9, W * 0.06 + 10, 0.25 * strength);
      g.fillStyle = `rgba(${r},${gg},${b},${0.07 * strength})`;
      g.fillRect(0, 0, W, H);
    }
    // cracks: dark core with a light edge
    for (const pts of this.cracks) {
      for (const [style, width] of [['rgba(255,255,255,0.55)', 2.2], ['rgba(20,20,20,0.75)', 1]]) {
        g.strokeStyle = style;
        g.lineWidth = width;
        g.beginPath();
        pts.forEach(([px, py], k) => (k ? g.lineTo(px * W, py * H) : g.moveTo(px * W, py * H)));
        g.stroke();
      }
    }
    if (this.maskBurst) {
      g.fillStyle = 'rgba(60,60,60,0.25)';
      g.fillRect(0, 0, W, H);
    }
  }

  /** Click on the start card: lock the pointer and start the sound (needs a user gesture). */
  resume() {
    this.view.renderer.domElement.requestPointerLock();
    this.sound.start();
  }

  pause() {
    this.el.start.hidden = false;
    this.spraying = false;
    this.keys.clear();
  }

  exit() {
    if (!this.active) return;
    this.orphan?.dispose();
    this.orphan = null;
    if (this.flight) {
      this.flight.dispose();
      this.flight = null;
      this.view.camera.up.set(0, 1, 0);
    }
    this.active = false;
    const s0 = this.hooks.getSim();
    if (s0?.ai) s0.ai.player = null;
    this.spraying = false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.sound.stop();
    this.setThermal(false);
    const v = this.view;
    v.camera.remove(this.lamp);
    v.camera.remove(this.lamp.target);
    v.camera.fov = this.savedFov ?? 50;
    v.camera.updateProjectionMatrix();
    v.controls.enabled = true;
    this.el.mask.hidden = true;
    this.el.start.hidden = true;
    const sim = this.hooks.getSim();
    if (sim) sim.spray = null;
  }

  toggleCrawl() {
    if (this.crawl && this.blocked(this.pos.x, this.pos.z, this.pos.y, EYE_STAND)) return; // no room to stand
    this.crawl = !this.crawl;
  }

  setThermal(on) {
    this.thermal = on;
    this.hooks.onThermal(on);
    if (this.el.tic) this.el.tic.hidden = !on;
  }

  solidAt(x, y, z) {
    const w = this.hooks.getSim().world;
    const i = w.voxelAt(x, y, z);
    return i >= 0 && w.mat[i] !== 0;
  }

  /** Height of the floor under (x, z), searching down from `from`. */
  floorAt(x, z, from) {
    const w = this.hooks.getSim().world;
    const h = w.h;
    for (let y = from; y > 0; y -= h * 0.5) if (this.solidAt(x, y - h * 0.25, z)) return Math.floor((y - h * 0.25) / h) * h + h;
    return h;
  }

  /** Is a body standing at (x, z) on floor y (eye height `eye`) intersecting anything? */
  blocked(x, z, y, eye) {
    const w = this.hooks.getSim().world;
    if (x < RADIUS || z < RADIUS || x > w.size[0] - RADIUS || z > w.size[2] - RADIUS) return true;
    const top = y + eye + 0.12;
    for (let hy = y + 0.45; hy <= top; hy += w.h * 0.5)
      for (const [dx, dz] of [[0, 0], [RADIUS, 0], [-RADIUS, 0], [0, RADIUS], [0, -RADIUS]]) if (this.solidAt(x + dx, hy, z + dz)) return true;
    return false;
  }

  update(dt) {
    if (!this.active) return;
    const sim = this.hooks.getSim();
    const w = sim.world;
    const v = this.view;
    dt = Math.min(dt, 0.1);
    const locked = document.pointerLockElement === v.renderer.domElement;
    if (this.orphan) {
      this.orphan.update(dt, new Set());
      if (this.orphan.done) this.orphan = null;
    }
    if (this.flight) {
      this.flight.update(dt, locked ? this.keys : new Set());
      if (sim.ai) sim.ai.player = null;
      return;
    }
    // hints when you stand at a hatch or next to the jet
    {
      const pt = w.portals.find((q) => Math.hypot(q.p[0] - this.pos.x, q.p[2] - this.pos.z) < q.r + 0.8 && Math.abs(q.p[1] - this.pos.y) < 1.5);
      const veh = w.vehicles.find((q) => Math.hypot(q.seat[0] - this.pos.x, q.seat[2] - this.pos.z) < 4.5 && Math.abs(q.base[1] - this.pos.y) < 2);
      const near = pt ? `E: ${pt.label}` : veh ? 'E: climb into the jet' : null;
      if (near && near !== this.near) this.say(near, 3);
      this.near = near;
    }

    // --- movement
    const eye = this.crawl ? EYE_CRAWL : EYE_STAND;
    let fx = 0;
    let fz = 0;
    if (locked) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fz += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fz -= 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) fx -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) fx += 1;
    }
    const hurry = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const speed = this.crawl ? 0.5 : hurry ? 2.2 : 1.2;
    const len = Math.hypot(fx, fz);
    let moving = 0;
    if (len > 0) {
      const sy = Math.sin(this.yaw);
      const cy = Math.cos(this.yaw);
      // forward is -z in camera space; yaw rotates about y
      const dx = (-sy * fz + cy * fx) / len;
      const dz = (-cy * fz - sy * fx) / len;
      const step = speed * dt;
      for (const [ax, az] of [[dx * step, 0], [0, dz * step]]) {
        const nx = this.pos.x + ax;
        const nz = this.pos.z + az;
        // allow stepping up small obstacles (fallen tiles, debris)
        const floor = this.floorAt(nx, nz, this.pos.y + 0.45);
        if (floor - this.pos.y > 0.42) continue;
        if (this.blocked(nx, nz, floor, eye)) continue;
        this.pos.x = nx;
        this.pos.z = nz;
      }
      moving = this.crawl ? 0.8 : hurry ? 1 : 0.45;
    }
    this.moving = moving > 0;
    // a hull breach in space: the escaping air drags you towards the hole
    if (w.vacuum && !this.downed) {
      const s = suctionAt(sim, [this.pos.x, this.pos.y + 1, this.pos.z]);
      const pull = 0.12 * dt;
      for (const [ax, az] of [[s[0] * pull, 0], [0, s[2] * pull]]) {
        if (!ax && !az) continue;
        const nx = this.pos.x + Math.max(-0.3, Math.min(0.3, ax));
        const nz = this.pos.z + Math.max(-0.3, Math.min(0.3, az));
        const fl = this.floorAt(nx, nz, this.pos.y + 0.45);
        if (fl - this.pos.y > 0.42 || this.blocked(nx, nz, fl, eye)) continue;
        this.pos.x = nx;
        this.pos.z = nz;
      }
    }
    const floor = this.floorAt(this.pos.x, this.pos.z, this.pos.y + 0.45);
    this.pos.y += (floor - this.pos.y) * Math.min(1, dt * 10); // settle / fall onto the floor
    const bob = moving ? Math.sin(w.time * 9) * 0.02 : 0;
    const cam = v.camera;
    cam.position.set(this.pos.x, this.pos.y + eye + bob, this.pos.z);
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    cam.updateMatrixWorld();
    this.lamp.intensity = this.lampOn ? 40 : 0;

    // --- the arm: swinging a strike, or reaching through broken glass to the handle
    if (this.arm) {
      this.arm.t += dt;
      if (this.arm.mode === 'reach' && this.arm.t > 1.4 && !this.arm.done) {
        this.arm.done = true;
        const d = w.doors[this.arm.door];
        d.locked = false;
        toggleDoor(sim, this.arm.door, true);
        this.sound.door?.();
        this.say(`${d.name}: unlocked from the inside and opened`, 3);
      }
      if (this.arm.t > (this.arm.mode === 'reach' ? 2 : 0.45)) this.arm = null;
    }
    this.updateArm();

    // --- what the fire does to you
    const exposure = this.downed ? null : this.body(dt, sim, cam, eye);
    // no pressure: your breathing apparatus gives you air, but not pressure
    this.cabinP = w.vacuum ? pressureAt(sim, [cam.position.x, cam.position.y, cam.position.z]) : 1;
    if (this.cabinP < 0.35 && !this.downed) {
      this.hurt((0.35 - this.cabinP) * 25 * dt);
      if (!this.vacWarned) this.say('DECOMPRESSION – get behind a closed door!', 4);
      this.vacWarned = true;
    } else if (this.cabinP > 0.8) this.vacWarned = false;

    // --- conditions at the face
    const head = [cam.position.x, cam.position.y, cam.position.z];
    const a = sim.airCellAt(...head);
    const gasT = a >= 0 ? w.airT[a] : w.ambient;
    const rad = a >= 0 ? w.radField[a] : 0;
    const sigma = a >= 0 ? (8700 * w.smoke[a]) / w.ah ** 3 : 0;
    const visibility = sigma > 1e-3 ? Math.min(99, 3 / sigma) : 99;
    const o2pct = a >= 0 ? (w.o2[a] / 0.232) * 20.9 : 20.9;
    const heat = Math.max(0, Math.min(1, (gasT - 50) / 150 + (rad - 2500) / 10000));
    const steam = a >= 0 ? w.steam[a] / w.ah ** 3 : 0;

    // --- breathing air: litres per minute by effort and heat stress
    const lpm = 35 + moving * 45 + heat * 30 + (this.spraying ? 10 : 0) + (this.maskBurst ? 400 : 0); // a broken mask leaks
    this.air = Math.max(0, this.air - (lpm / 60) * dt * (sim.world.time > 0 ? 1 : 0));
    const bar = (this.air / AIR_LITRES) * 300;

    // --- hose: aim at the centre of the view
    const aimFwd = new THREE.Vector3();
    cam.getWorldDirection(aimFwd);
    const aim = () => {
      const rect = v.renderer.domElement.getBoundingClientRect();
      const hit = v.pick(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit ? hit.point : [head[0] + aimFwd.x * 8, head[1] + aimFwd.y * 8, head[2] + aimFwd.z * 8];
    };
    this.selfDouse = this.spraying && locked && this.tool === 'hose' && this.pitch < -1.0;
    if (this.spraying && locked && this.tool === 'hose') {
      const target = aim();
      const nozzle = [head[0] + aimFwd.x * 0.6, head[1] - 0.35 + aimFwd.y * 0.6, head[2] + aimFwd.z * 0.6];
      sim.spray = { agent: 'hose', nozzle, target, radius: 0.8, tank: this.tank };
    } else if (this.spraying && locked && this.tool === 'ext' && this.ext) {
      const target = aim();
      const nozzle = [head[0] + aimFwd.x * 0.5, head[1] - 0.45 + aimFwd.y * 0.5, head[2] + aimFwd.z * 0.5];
      sim.spray = { agent: this.ext.agent, nozzle, target, radius: AGENTS[this.ext.agent].radius, tank: this.ext.tank };
    } else if (this.spraying && locked && this.tool === 'reel' && this.reel) {
      const d = Math.hypot(this.pos.x - this.reel.p[0], this.pos.z - this.reel.p[2]);
      if (d > this.reel.length) {
        sim.spray = null;
        if (w.time > this.messageUntil) this.say('The hose does not reach this far');
      } else {
        const target = aim();
        const nozzle = [head[0] + aimFwd.x * 0.5, head[1] - 0.4 + aimFwd.y * 0.5, head[2] + aimFwd.z * 0.5];
        sim.spray = { agent: 'reel', nozzle, target, radius: AGENTS.reel.radius, tank: { remaining: 1e9 } };
      }
    } else if (sim.spray && ['hose', 'reel'].includes(sim.spray.agent) || (sim.spray && this.ext && sim.spray.tank === this.ext.tank)) sim.spray = null;
    this.torching = false;
    if (this.spraying && locked && this.tool === 'torch') {
      // the torch flame reaches ~1 m: it acts where you point, if that is close enough
      const t = aim();
      const d = Math.hypot(t[0] - head[0], t[1] - head[1], t[2] - head[2]);
      const k = Math.min(1, 1.2 / Math.max(d, 0.01));
      const p = [head[0] + (t[0] - head[0]) * k, head[1] - 0.2 + (t[1] - head[1]) * k, head[2] + (t[2] - head[2]) * k];
      sim.holdTorch(p, 12000, 0.15);
      this.torching = true;
      this.torchPos = p;
    }
    // the bow: the longer you draw (up to 1.2 s), the faster the arrow
    if (this.draw !== undefined) this.draw = Math.min(1.2, this.draw + dt);
    if (this.loose) {
      const k = Math.max(0.25, (this.draw ?? 0) / 1.2);
      const v = 15 + 45 * k;
      const from = [head[0] + aimFwd.x * 0.5, head[1] - 0.05 + aimFwd.y * 0.5, head[2] + aimFwd.z * 0.5];
      sim.shootArrow(from, [aimFwd.x * v, aimFwd.y * v, aimFwd.z * v]);
      this.sound.bow?.();
      this.loose = false;
      this.draw = undefined;
    }
    // where you are, for the enemies (they see your head)
    sim.ai.player = this.downed ? null : { p: [this.pos.x, this.pos.y, this.pos.z], head };
    if (this.throwRequested) {
      this.throwRequested = false;
      const from = [head[0] + aimFwd.x * 0.4, head[1] - 0.1, head[2] + aimFwd.z * 0.4];
      sim.throwGrenade(from, [aimFwd.x * 9, aimFwd.y * 9 + 2.5, aimFwd.z * 9]);
    }

    // --- mask overlay
    if (this.el.fog) this.el.fog.style.opacity = String(Math.min(0.55, steam * 40 + Math.max(0, gasT - 60) / 400));
    if (this.el.heat) this.el.heat.style.opacity = String(heat * (0.6 + 0.4 * Math.sin(w.time * 6)));
    const mins = this.air / Math.max(1, lpm);
    const warn = [];
    if (bar < 55) warn.push('LOW AIR – WITHDRAW');
    if (this.onFire > 0) warn.push('ON FIRE');
    if (this.health < 30) warn.push('HEALTH CRITICAL');
    if (w.vacuum && (this.cabinP ?? 1) < 0.95) warn.push(`CABIN PRESSURE ${Math.round((this.cabinP ?? 1) * 100)} %`);
    if (gasT > 100) warn.push('HIGH HEAT');
    if (visibility < 1.5 && !this.thermal) warn.push('ZERO VISIBILITY – use T (thermal camera) or crawl (C)');
    this.el.hud.innerHTML = `
      <div class="bars"><span>AIR</span><div class="air"><div class="fill" style="width:${(bar / 3).toFixed(0)}%;background:${bar < 55 ? '#ff4a3a' : bar < 120 ? '#ffb13a' : '#5fd86b'}"></div></div>
      <span>HEALTH</span><div class="air"><div class="fill" style="width:${this.health.toFixed(0)}%;background:${this.health < 30 ? '#ff4a3a' : this.health < 60 ? '#ffb13a' : '#5fb8ff'}"></div></div>
      <span>VISOR</span><div class="air"><div class="fill" style="width:${(this.mask * 100).toFixed(0)}%;background:${this.mask < 0.3 ? '#ff4a3a' : '#c8c8c8'}"></div></div></div>
      <div class="row"><span>AIR ${bar.toFixed(0)} bar · ${mins.toFixed(0)} min</span><span>GAS ${gasT.toFixed(0)} °C</span><span>VIS ${visibility >= 99 ? '>99' : visibility.toFixed(1)} m</span><span>${this.crawl ? 'CRAWLING' : 'STANDING'}</span><span>[${{ hose: '1 HOSE', torch: '2 FIRE TORCH', grenade: '3 GRENADE', ext: `4 EXTINGUISHER ${this.ext ? this.ext.tank.remaining.toFixed(1) : ''}`, reel: '5 HOSE REEL', bow: `6 BOW${this.draw !== undefined ? ' – drawing ' + Math.round((this.draw / 1.2) * 100) + '%' : ' (fire arrows)'}` }[this.tool]}]</span><span>O₂ ${o2pct.toFixed(1)} %</span></div>
      ${warn.length ? `<div class="warn">${warn.join(' · ')}</div>` : ''}
      ${w.time < this.messageUntil ? `<div class="msg">${this.message}</div>` : ''}`;
    if (this.el.burn) this.el.burn.style.opacity = this.onFire > 0 ? String(0.55 + 0.25 * Math.sin(w.time * 20)) : '0';
    this.drawVisor(sim, cam, sigma);

    // --- sound
    let jet = null;
    for (const ht of w.heaters) if (ht.jet && ht.on && ht.label !== 'torch' && !(ht.start !== undefined && w.time < ht.start)) jet = { pos: ht.pos, power: ht.power };
    if (this.torching) jet = { pos: this.torchPos, power: 6e4 };
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const fl = v.fireLight;
    this.sound.update({
      listener: { pos: head, forward: [fwd.x, fwd.y, fwd.z], up: [up.x, up.y, up.z] },
      fire: sim.stats.hrr > 0 ? { pos: [fl.position.x, fl.position.y, fl.position.z], hrr: sim.stats.hrr } : null,
      jet,
      spraying: this.spraying && locked,
      effort: moving,
      heat,
      airFraction: this.air / AIR_LITRES,
      events: w.events,
      onFire: this.onFire > 0,
      maskLeak: this.maskBurst,
      enemies: w.enemies,
      sprinkler: nearestSprinkler(w, head),
      inflow: sim.stats.flooding ? { pos: this.breachPos(w), rate: sim.stats.flooding } : null,
    });
  }
}

function nearestSprinkler(w, p) {
  let best = null;
  let bd = Infinity;
  for (const s of w.sprinklers) {
    if (!s.active) continue;
    const d = Math.hypot(s.p[0] - p[0], s.p[1] - p[1], s.p[2] - p[2]);
    if (d < bd) {
      bd = d;
      best = s.p;
    }
  }
  return best;
}
