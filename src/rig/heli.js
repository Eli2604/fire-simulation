/**
 * The helicopter on the rig stage (the Object drop-down: Helicopter): the simulation's helicopter
 * (rig/heliStage.js sets up each act, ai/helicopter.js flies it) drawn with render/heliMesh.js
 * (render/helis.js: rotors, doors, door guns, smoke and fire, the blades flying off), its crew the
 * simulation's soldiers (render/enemies.js: seated, at the guns, in the doors, on the cables), the
 * cables (render/ropes.js, ai/rope.js), a landing pad and the targets the guns fire at, and the
 * rounds as tracers. Every act a button; a speed control; the men in the back and the door guns;
 * its hit parts (models/vehicleZones.js VEHICLE_ZONES.helicopter) drawn as boxes that follow it,
 * shown or hidden and adjusted (size, damage), and damage on click: the part under the cursor is hit.
 *
 * Like the phoenix (rig/phoenix.js), it is built the first time it is picked; while it is on the
 * stage the soldiers are hidden and paused.
 */
import * as THREE from 'three';
import { createHeliStage, HELI_ACTS } from './heliStage.js';
import { heliAxes, heliRayHit } from '../ai/helicopter.js';
import { VEHICLE_ZONES, vehicleZones } from '../models/vehicleZones.js';
import { HeliRenderer } from '../render/helis.js';
import { EnemyRenderer } from '../render/enemies.js';
import { RopeRenderer } from '../render/ropes.js';

export class HeliRig {
  constructor({ scene, camera, controls, renderer, toast = () => {}, $ = (id) => document.getElementById(id), qs = new URLSearchParams() }) {
    Object.assign(this, { scene, camera, controls, renderer, toast, $ });
    this.active = false;
    this.speed = 1;
    this.showZones = false;
    this.fire = false;
    this.follow = false;
    this.weapon = 'bullet';
    this.stage = createHeliStage();
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.drawer = new HeliRenderer(this.group);
    this.crew = new EnemyRenderer(this.group, null);
    this.ropes = new RopeRenderer(this.group);
    this.ropes.setWorld(this.stage.world);
    // the pad and the targets
    const pad = new THREE.Mesh(new THREE.RingGeometry(5, 6, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xf2f0e6, side: THREE.DoubleSide }));
    pad.position.y = 0.02;
    this.group.add(pad);
    const H = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 3.2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xf2f0e6 }));
    H.position.y = 0.02;
    this.group.add(H);
    this.targetMeshes = this.stage.targets.map((T) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.8, 10), new THREE.MeshStandardMaterial({ color: 0xc84a3a, roughness: 0.8 }));
      m.position.set(T[0], 0.9, T[2]);
      this.group.add(m);
      return m;
    });
    // tracers
    this.tracerGeo = new THREE.BufferGeometry();
    this.tracerGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(60 * 6), 3));
    this.tracerLines = new THREE.LineSegments(this.tracerGeo, new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.85 }));
    this.tracerLines.frustumCulled = false;
    this.group.add(this.tracerLines);
    this.buildZones();
    this.ui(qs);
    const el = renderer.domElement;
    el.addEventListener('pointerdown', (ev) => (this.down = [ev.clientX, ev.clientY]), true);
    el.addEventListener('pointerup', (ev) => this.active && (ev.stopImmediatePropagation(), this.click(ev)), true);
  }

  /* ---------------- hit parts: a box (or a cylinder) per part, in the helicopter's frame ---------------- */
  buildZones() {
    this.zoneRoot?.parent?.remove(this.zoneRoot);
    this.zoneRoot = new THREE.Group();
    this.zoneRoot.matrixAutoUpdate = false;
    this.group.add(this.zoneRoot);
    this.zoneMeshes = {};
    for (const Z of vehicleZones('helicopter')) {
      const mat = new THREE.MeshBasicMaterial({ color: Z.zone.color, transparent: true, opacity: 0.25, depthWrite: false });
      const wire = new THREE.MeshBasicMaterial({ color: Z.zone.color, wireframe: true, transparent: true, opacity: 0.7 });
      const g = new THREE.Group();
      for (const b of Z.boxes) {
        let geo;
        if (Z.shape === 'cyl') {
          geo = new THREE.CylinderGeometry(1, 1, 2, 24);
          if (Z.axis === 'z') geo.rotateX(Math.PI / 2);
          else if (Z.axis === 'x') geo.rotateZ(Math.PI / 2);
        } else geo = new THREE.BoxGeometry(2, 2, 2);
        const m = new THREE.Mesh(geo, mat);
        m.add(new THREE.Mesh(geo, wire));
        m.position.set(...b.c);
        m.scale.set(...b.h);
        m.renderOrder = 5;
        g.add(m);
      }
      g.visible = false;
      this.zoneRoot.add(g);
      this.zoneMeshes[Z.k] = { g, mat, flash: 0 };
    }
  }
  poseZones(dt) {
    const h = this.stage.h;
    const A = heliAxes(h.yaw, h.pitch, h.roll);
    this.zoneRoot.matrix.makeBasis(new THREE.Vector3(...A.f), new THREE.Vector3(...A.u), new THREE.Vector3(...A.r)).setPosition(...h.p);
    this.zoneRoot.matrixWorldNeedsUpdate = true;
    for (const [k, zm] of Object.entries(this.zoneMeshes)) {
      zm.flash = Math.max(0, zm.flash - dt);
      zm.g.visible = !h.gone.has(k) && (this.showZones || zm.flash > 0);
      const z = VEHICLE_ZONES.helicopter.find((x) => x.k === k);
      zm.mat.color.set(zm.flash > 0 ? '#ff3b2f' : (h.dmg[k] ?? 0) >= 1 ? '#555555' : z.color);
      zm.mat.opacity = 0.25 + 0.5 * Math.min(1, zm.flash / 0.25);
    }
  }

  /* ---------------- on and off ---------------- */
  setActive(v) {
    if (v === this.active) return;
    this.active = v;
    this.group.visible = v;
    const build = this.$('build');
    if (v) {
      this.hidden = new Set();
      this.hideRange();
      this.cam = { p: this.camera.position.clone(), t: this.controls.target.clone(), max: this.controls.maxDistance };
      this.camera.position.set(22, 14, 26);
      this.controls.target.set(0, 6, 0);
      this.controls.maxDistance = 400;
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
  /** Everything of the soldiers' range out of sight (remembered, to show again); the page's ground stays. */
  hideRange() {
    for (const o of this.scene.children) {
      if (o === this.group || o.isLight || isGround(o) || !(o.visible || this.hidden.has(o))) continue;
      o.visible = false;
      this.hidden.add(o);
    }
  }

  update(dt) {
    if (!this.active) return;
    this.hideRange();
    const sdt = Math.min(0.05, dt) * this.speed;
    if (sdt > 0) this.stage.step(sdt);
    const w = this.stage.world;
    const h = this.stage.h;
    if (this.follow) {
      const c = new THREE.Vector3(h.p[0], h.p[1] + 2, h.p[2]);
      const off = this.camera.position.clone().sub(this.controls.target);
      this.controls.target.lerp(c, this.snap ? 1 : Math.min(1, dt * 4));
      this.snap = false;
      this.camera.position.copy(this.controls.target).add(off);
    }
    this.drawer.draw([h], sdt);
    this.crew.update(w, w.time);
    this.ropes.update();
    // the rounds of the last moment
    const pos = this.tracerGeo.attributes.position;
    let n = 0;
    for (const t of w.tracers) {
      if (w.time - t.t > 0.12 || n >= 60) continue;
      pos.setXYZ(n * 2, ...t.a);
      pos.setXYZ(n * 2 + 1, ...t.b);
      n++;
    }
    pos.needsUpdate = true;
    this.tracerGeo.setDrawRange(0, n * 2);
    for (const m of this.targetMeshes) m.visible = ['doorGun', 'troopsFire', 'hover', 'approach'].includes(this.stage.act);
    this.poseZones(dt);
    this.status();
  }
  /** A few steps ahead at once (for screenshots: ?hsteps=n). */
  advance(n, dt = 1 / 30) {
    for (let i = 0; i < n; i++) this.stage.step(dt);
  }

  status() {
    const h = this.stage.h;
    const bar = this.$('hHp');
    if (bar) {
      const v = h.integrity;
      bar.style.width = (v * 100).toFixed(1) + '%';
      bar.style.background = v > 0.6 ? 'var(--ok)' : v > 0.3 ? 'var(--accent)' : 'var(--hurt)';
    }
    if ((this.statusT = (this.statusT ?? 0) + 1) % 6 !== 0) return;
    const s = this.$('hState');
    if (s) s.textContent = h.describe();
    this.$('hActs')?.querySelectorAll('button[data-a]').forEach((b) => b.classList.toggle('on', b.dataset.a === this.stage.act));
    const crew = this.$('hCrew');
    if (crew) crew.textContent = h.crew.map((e) => `${h.seats[e.seat].label.padEnd(22)} ${e.dead ? 'dead' : Math.round(e.health) + ' HP'}${e.aboard ? (e.atDoor ? ' · in the door' : '') : e.rope ? ' · on the rope' : ' · on the ground'}`).join('\n');
    const log = this.$('hLog');
    if (log) log.textContent = this.stage.world.events.filter((e) => ['heliRadio', 'heliFailure', 'heliCrash', 'heliHit', 'heliRope', 'heliExplosion', 'heliTouchdown', 'impact'].includes(e.type)).slice(-7).map((e) => `${e.time.toFixed(1)}s ${e.type === 'heliHit' ? `hit: ${e.label} ${Math.round(e.value * 100)}%` : e.type === 'impact' ? `impact ${(e.force / 1000).toFixed(0)} kN, ${(e.energy / 1000).toFixed(0)} kJ (${e.name})` : e.type === 'heliCrash' ? `crash (${e.severity}, ${e.cause}, ${e.speed.toFixed(1)} m/s)` : e.type === 'heliFailure' ? `failure: ${e.failure} (${e.why})` : e.name}`).join('\n');
  }

  /* ---------------- clicks: the part under the cursor ---------------- */
  click(ev) {
    if (!this.down || Math.hypot(ev.clientX - this.down[0], ev.clientY - this.down[1]) > 6) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const hit = heliRayHit(this.stage.h, ray.ray.origin.toArray(), ray.ray.direction.toArray(), 1000, 0);
    if (!hit) return;
    this.$('hZoneSel').value = hit.k;
    this.zoneUI();
    this.zoneMeshes[hit.k].flash = 0.45;
    if (!this.fire) return this.toast(`${hit.zone.label} · ×${hit.zone.mult.toFixed(1)} · ${hit.zone.effect}`);
    const res = this.stage.hitZone(hit.k, this.weapon);
    if (!res) return;
    this.$('hLastHit').textContent = `Last hit: ${hit.zone.label}: ${Math.round(res.value * 100)}% damaged${res.destroyed ? ' (destroyed: ' + hit.zone.effect + ')' : ''}.`;
    this.toast(`${hit.zone.label} · ${Math.round(res.value * 100)}%`);
  }

  /* ---------------- the panel ---------------- */
  ui(qs) {
    const $ = this.$;
    const box = $('hActs');
    if (!box) return;
    for (const [k, label] of Object.entries(HELI_ACTS)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.dataset.a = k;
      if (/^(crash|fuel)/.test(k)) b.classList.add('warn');
      b.onclick = () => ((this.snap = true), this.stage.play(k));
      box.appendChild(b);
    }
    const tg = (id, fn) => {
      const b = $(id);
      b.onclick = () => {
        const v = b.getAttribute('aria-pressed') !== 'true';
        b.setAttribute('aria-pressed', String(v));
        fn(v);
      };
      return b;
    };
    tg('tgHZones', (v) => (this.showZones = v));
    tg('tgHFire', (v) => (this.fire = v));
    tg('tgHFollow', (v) => ((this.follow = v), (this.snap = true)));
    $('hRepair').onclick = () => this.stage.revive();
    const wSel = $('hWeapon');
    wSel.onchange = (e) => (this.weapon = e.target.value);
    const sp = $('hSpeed');
    sp.oninput = () => {
      this.speed = +sp.value;
      $('hSpeedO').textContent = '×' + this.speed.toFixed(2);
    };
    sp.oninput();
    const sol = $('hSoldiers');
    sol.oninput = () => ($('hSoldiersO').textContent = sol.value);
    sol.onchange = () => this.stage.set({ soldiers: +sol.value });
    sol.value = this.stage.params.soldiers;
    sol.oninput();
    $('hDoorGuns').onchange = (e) => this.stage.set({ doorGuns: e.target.value });
    // the part editor: the same table the simulation's rounds use
    const zSel = $('hZoneSel');
    for (const z of VEHICLE_ZONES.helicopter) zSel.appendChild(Object.assign(document.createElement('option'), { value: z.k, textContent: z.label }));
    const [zS, zM] = ['hzS', 'hzM'].map($);
    this.zoneUI = () => {
      const z = VEHICLE_ZONES.helicopter.find((x) => x.k === zSel.value);
      zS.value = z.size;
      zM.value = z.mult;
      $('hzSo').textContent = '×' + (+z.size).toFixed(2);
      $('hzMo').textContent = '×' + (+z.mult).toFixed(1);
      $('hZoneInfo').textContent = `${z.label}: ${z.hp} HP, ×${z.mult} damage. ${z.effect}.`;
    };
    const apply = () => {
      const z = VEHICLE_ZONES.helicopter.find((x) => x.k === zSel.value);
      z.size = +zS.value;
      z.mult = +zM.value;
      this.zoneUI();
      this.buildZones();
    };
    zSel.onchange = this.zoneUI;
    [zS, zM].forEach((s) => (s.oninput = apply));
    this.zoneUI();
    // ?obj=helicopter opens it (rig/stage.js); &hact=fastRope plays an act; &hzones=1; &hsteps=n runs ahead; &hfollow=1; &hhits=tailRotor,engine
    if (qs.get('obj') === 'helicopter' || qs.get('tab') === 'heli') {
      if (qs.get('hact')) this.stage.play(qs.get('hact'));
      if (qs.get('hzones') === '1') $('tgHZones').click();
      if (qs.get('hfollow') === '1') $('tgHFollow').click();
      if (qs.get('hsteps')) this.advance(+qs.get('hsteps'));
      for (const k of (qs.get('hhits') ?? '').split(',').filter(Boolean)) this.stage.hitZone(k, 'rocket');
    }
  }
}

/** The page's own ground (a 200 m plane): it stays. */
function isGround(o) {
  return o.isMesh && o.geometry?.type === 'PlaneGeometry' && o.geometry.parameters?.width >= 100;
}
