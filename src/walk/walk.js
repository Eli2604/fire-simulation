import * as THREE from 'three';
import { SoundScape } from '../audio/sound.js';

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
      this.yaw -= e.movementX * 0.0022;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - e.movementY * 0.0022));
    });
    document.addEventListener('mousedown', (e) => {
      if (this.active && document.pointerLockElement === canvas && e.button === 0) {
        if (this.tool === 'grenade') this.throwRequested = true;
        else this.spraying = true;
      }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.spraying = false;
    });
    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      this.keys.add(e.code);
      if (e.code === 'KeyC' || e.code === 'ControlLeft') this.toggleCrawl();
      if (e.code === 'KeyT') this.setThermal(!this.thermal);
      if (e.code === 'KeyL') this.lampOn = !this.lampOn;
      if (e.code === 'Digit1') this.tool = 'hose';
      if (e.code === 'Digit2') this.tool = 'torch';
      if (e.code === 'Digit3') this.tool = 'grenade';
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    document.getElementById('walkGo').addEventListener('click', () => this.resume());
  }

  /** Enter walk mode at the scenario's spawn point (or the world's edge). */
  enter() {
    const sim = this.hooks.getSim();
    const w = sim.world;
    const sp = sim.spawn ?? { p: [w.size[0] * 0.1, 0, w.size[2] / 2], yaw: 0 };
    this.pos = new THREE.Vector3(sp.p[0], 0, sp.p[2]);
    this.pos.y = this.floorAt(this.pos.x, this.pos.z, w.size[1]) ;
    // yaw 0 = looking along +x
    this.yaw = -Math.PI / 2 - (sp.yaw ?? 0);
    this.pitch = 0;
    this.crawl = false;
    this.air = AIR_LITRES;
    this.startTime = w.time;
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
    this.active = false;
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
    const floor = this.floorAt(this.pos.x, this.pos.z, this.pos.y + 0.45);
    this.pos.y += (floor - this.pos.y) * Math.min(1, dt * 10); // settle / fall onto the floor
    const bob = moving ? Math.sin(w.time * 9) * 0.02 : 0;
    const cam = v.camera;
    cam.position.set(this.pos.x, this.pos.y + eye + bob, this.pos.z);
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    cam.updateMatrixWorld();
    this.lamp.intensity = this.lampOn ? 40 : 0;

    // --- conditions at the face
    const head = [cam.position.x, cam.position.y, cam.position.z];
    const a = sim.airCellAt(...head);
    const gasT = a >= 0 ? w.airT[a] : w.ambient;
    const rad = a >= 0 ? w.radField[a] : 0;
    const sigma = a >= 0 ? (8700 * w.smoke[a]) / w.ah ** 3 : 0;
    const visibility = sigma > 1e-3 ? Math.min(99, 3 / sigma) : 99;
    const heat = Math.max(0, Math.min(1, (gasT - 50) / 150 + (rad - 2500) / 10000));
    const steam = a >= 0 ? w.steam[a] / w.ah ** 3 : 0;

    // --- breathing air: litres per minute by effort and heat stress
    const lpm = 35 + moving * 45 + heat * 30 + (this.spraying ? 10 : 0);
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
    if (this.spraying && locked && this.tool === 'hose') {
      const target = aim();
      const nozzle = [head[0] + aimFwd.x * 0.6, head[1] - 0.35 + aimFwd.y * 0.6, head[2] + aimFwd.z * 0.6];
      sim.spray = { agent: 'hose', nozzle, target, radius: 0.8, tank: this.tank };
    } else if (sim.spray?.agent === 'hose') sim.spray = null;
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
    if (gasT > 100) warn.push('HIGH HEAT');
    if (visibility < 1.5 && !this.thermal) warn.push('ZERO VISIBILITY – use T (thermal camera) or crawl (C)');
    this.el.hud.innerHTML = `
      <div class="air"><div class="fill" style="width:${(bar / 3).toFixed(0)}%;background:${bar < 55 ? '#ff4a3a' : bar < 120 ? '#ffb13a' : '#5fd86b'}"></div></div>
      <div class="row"><span>AIR ${bar.toFixed(0)} bar · ${mins.toFixed(0)} min</span><span>GAS ${gasT.toFixed(0)} °C</span><span>VIS ${visibility >= 99 ? '>99' : visibility.toFixed(1)} m</span><span>${this.crawl ? 'CRAWLING' : 'STANDING'}</span><span>[${{ hose: '1 HOSE', torch: '2 FIRE TORCH', grenade: '3 GRENADE' }[this.tool]}]</span></div>
      ${warn.length ? `<div class="warn">${warn.join(' · ')}</div>` : ''}`;

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
    });
  }
}
