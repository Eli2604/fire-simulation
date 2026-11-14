/**
 * The phoenix on the rig stage (the Object drop-down: Phoenix): the simulation's phoenix
 * (rig/phoenixStage.js moves it with ai/phoenix.js) drawn by its own renderer (render/phoenix.js),
 * its fire by the flame particles (render/flames.js), on its stone perch in a field of its own.
 * Every act it has as a button, a speed control, its tunables (wing span, flames, size, flight
 * speed), its hit zones (ai/phoenix.js PHOENIX_ZONES) drawn as capsules that follow the pose, shown
 * or hidden and adjusted (radius, damage), and damage on click: the zone under the cursor is hit
 * (it flashes); killed, it bursts into flame, lies in its ash and is born again from it.
 *
 * Like the dragon (rig/dragon.js), while it is on the stage the soldiers are hidden and paused, and
 * it is built the first time it is picked. Dusk (on by default) dims the page's sun so its own light
 * shows, as in the catacombs.
 */
import * as THREE from 'three';
import { createPhoenixStage, PHOENIX_ACTS, PHOENIX_PARAMS, PHOENIX_WEAPONS } from './phoenixStage.js';
import { PHOENIX, PHOENIX_ZONES, phoenixZones, phoenixRayHit } from '../ai/phoenix.js';
import { PhoenixRenderer } from '../render/phoenix.js';
import { FlameRenderer } from '../render/flames.js';

const PARAM_UI = { span: 'pSpan', heat: 'pHeat', size: 'pSize', speed: 'pFly' };

export class PhoenixRig {
  constructor({ scene, camera, controls, renderer, toast = () => {}, $ = (id) => document.getElementById(id), qs = new URLSearchParams() }) {
    Object.assign(this, { scene, camera, controls, renderer, toast, $ });
    this.active = false;
    this.speed = 1;
    this.showZones = false;
    this.fire = false;
    this.dusk = qs.get('pdark') !== '0';
    this.weapon = 'bullet';
    this.stage = createPhoenixStage();
    const w = this.stage.world;
    // the simulation's field on the page: its middle at the origin, its ground (one voxel) at y = 0
    this.group = new THREE.Group();
    this.group.position.set(-this.stage.center[0], -w.h, -this.stage.center[2]);
    this.group.visible = false;
    scene.add(this.group);
    this.flames = new FlameRenderer(this.group, 3000);
    this.flames.setWorld(w);
    this.drawer = new PhoenixRenderer(this.group, this.flames);
    // its perch: a block of dark stone
    const b = this.stage.block;
    if (Number.isFinite(b[0])) {
      const perch = new THREE.Mesh(new THREE.BoxGeometry(b[3] - b[0], b[4] - b[1], b[5] - b[2]), new THREE.MeshStandardMaterial({ color: '#6f6a62', roughness: 0.95 }));
      perch.position.set((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
      perch.castShadow = perch.receiveShadow = true;
      this.group.add(perch);
    }
    this.buildZones();
    this.ui(qs);
    const el = renderer.domElement;
    el.addEventListener('pointerdown', (ev) => (this.down = [ev.clientX, ev.clientY]), true);
    el.addEventListener('pointerup', (ev) => this.active && (ev.stopImmediatePropagation(), this.click(ev)), true);
  }

  /* ---------------- hit zones: a capsule per zone (two balls and a tube), posed every frame ---------------- */
  buildZones() {
    this.zoneMeshes = {};
    const ball = new THREE.SphereGeometry(1, 16, 10);
    const tube = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true);
    for (const [k, z] of Object.entries(PHOENIX_ZONES)) {
      const mat = new THREE.MeshBasicMaterial({ color: z.color, transparent: true, opacity: 0.25, depthWrite: false });
      const wire = new THREE.MeshBasicMaterial({ color: z.color, wireframe: true, transparent: true, opacity: 0.7 });
      const g = new THREE.Group();
      const parts = [ball, ball, tube].map((geo) => {
        const m = new THREE.Mesh(geo, mat);
        m.add(new THREE.Mesh(geo, wire));
        m.renderOrder = 5;
        g.add(m);
        return m;
      });
      g.visible = false;
      this.group.add(g);
      this.zoneMeshes[k] = { g, parts, mat, flash: 0 };
    }
  }

  poseZones(dt) {
    const zones = phoenixZones(this.stage.bird);
    const A = new THREE.Vector3();
    const B = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (const [k, zm] of Object.entries(this.zoneMeshes)) {
      zm.flash = Math.max(0, zm.flash - dt);
      const Z = zones.find((z) => z.k === k);
      zm.g.visible = !!Z && (this.showZones || zm.flash > 0);
      if (!zm.g.visible) continue;
      zm.mat.opacity = 0.25 + 0.5 * Math.min(1, zm.flash / 0.25);
      zm.mat.color.set(zm.flash > 0 ? '#ff3b2f' : Z.z.color);
      A.set(...Z.a);
      B.set(...Z.b);
      const [a, b, t] = zm.parts;
      a.position.copy(A);
      b.position.copy(B);
      a.scale.setScalar(Z.r);
      b.scale.setScalar(Z.r);
      const L = A.distanceTo(B);
      t.visible = L > 1e-4;
      t.position.copy(A).add(B).multiplyScalar(0.5);
      t.scale.set(Z.r, Math.max(L, 1e-4), Z.r);
      if (L > 1e-4) t.quaternion.setFromUnitVectors(up, B.sub(A).normalize());
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
      this.cam = { p: this.camera.position.clone(), t: this.controls.target.clone() };
      this.camera.position.set(4.6, 2.7, 5.6);
      this.controls.target.set(0, 1.7, 0);
      if (build) build.style.visibility = 'hidden';
      this.setDusk(this.dusk);
    } else {
      this.hidden?.forEach((o) => (o.visible = true));
      this.hidden = null;
      this.setDusk(false, true);
      if (this.cam) {
        this.camera.position.copy(this.cam.p);
        this.controls.target.copy(this.cam.t);
      }
      if (build) build.style.visibility = '';
    }
  }

  /** Dusk: the page's own lights dimmed and its sky darkened (put back as they were when off). */
  setDusk(on, leaving = false) {
    if (!leaving) this.dusk = on;
    if (on && !this.lit) {
      this.lit = { lights: [], bg: this.scene.background };
      this.scene.traverse((o) => {
        if (!o.isLight || this.isMine(o)) return;
        this.lit.lights.push([o, o.intensity]);
        o.intensity *= 0.1;
      });
      this.scene.background = new THREE.Color('#0b0c12');
    } else if (!on && this.lit) {
      for (const [o, i] of this.lit.lights) o.intensity = i;
      this.scene.background = this.lit.bg;
      this.lit = null;
    }
  }

  isMine(o) {
    for (let p = o; p; p = p.parent) if (p === this.group) return true;
    return false;
  }

  /** Everything of the soldiers' range out of sight (remembered, to show again). */
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
    // you (the camera) in the stage's world: it watches you from its perch
    this.stage.viewer = this.camera.position.clone().sub(this.group.position).toArray();
    const sdt = Math.min(0.05, dt) * this.speed;
    if (sdt > 0) this.stage.step(sdt);
    const w = this.stage.world;
    const f = this.stage.bird;
    if (this.follow && f.pos) {
      const c = new THREE.Vector3(...f.pos).add(this.group.position);
      const off = this.camera.position.clone().sub(this.controls.target);
      this.controls.target.lerp(c, this.snap ? 1 : Math.min(1, dt * 4));
      this.snap = false;
      this.camera.position.copy(this.controls.target).add(off);
    }
    this.drawer.update(w, w.time, sdt);
    this.flames.update(sdt, this.renderer.domElement.height / (2 * Math.tan((this.camera.fov * Math.PI) / 360)));
    this.poseZones(dt);
    this.status();
  }

  /** A few steps ahead at once (for screenshots: ?psteps=n). */
  advance(n, dt = 1 / 30) {
    for (let i = 0; i < n; i++) this.stage.step(dt);
  }

  status() {
    const f = this.stage.bird;
    const hp = Math.max(0, f.health / PHOENIX.MAX_HEALTH);
    const bar = this.$('pHp');
    if (bar) {
      bar.style.width = (hp * 100).toFixed(1) + '%';
      bar.style.background = hp > 0.5 ? 'var(--ok)' : hp > 0.25 ? 'var(--accent)' : 'var(--hurt)';
    }
    const s = this.$('pState');
    if (s && (this.statusT = (this.statusT ?? 0) + 1) % 6 === 0) {
      const what = f.state === 'ashes' ? `ashes (born again in ${Math.max(0, PHOENIX.ASH_TIME - f.t).toFixed(0)} s)` : f.state === 'reborn' ? 'rising from the ashes' : PHOENIX_ACTS[this.stage.act] + (this.stage.phase ? ` · ${this.stage.phase}` : '');
      s.textContent = `${what} · ${Math.ceil(f.health)} HP`;
      this.$('pAnims').querySelectorAll('button[data-a]').forEach((b) => b.classList.toggle('on', b.dataset.a === this.stage.act));
    }
  }

  /* ---------------- clicks: the zone under the cursor ---------------- */
  click(ev) {
    if (!this.down || Math.hypot(ev.clientX - this.down[0], ev.clientY - this.down[1]) > 6) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const from = ray.ray.origin.clone().sub(this.group.position).toArray();
    const hit = phoenixRayHit(this.stage.bird, from, ray.ray.direction.toArray());
    if (!hit) return;
    this.$('pZoneSel').value = hit.k;
    this.zoneUI();
    this.zoneMeshes[hit.k].flash = 0.45;
    if (!this.fire) return this.toast(`${hit.zone.label} · ×${hit.zone.mult.toFixed(1)} damage`);
    const dmg = this.stage.hitZone(hit.k, this.weapon);
    this.$('pLastHit').textContent = `Last hit: ${hit.zone.label} ×${hit.zone.mult.toFixed(1)} = ${Math.round(dmg)} damage (${this.weapon}).`;
    this.toast(`${hit.zone.label} · ${Math.round(dmg)} dmg`);
  }

  /* ---------------- the panel ---------------- */
  ui(qs) {
    const $ = this.$;
    const box = $('pAnims');
    if (!box) return;
    for (const [k, label] of Object.entries(PHOENIX_ACTS)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.dataset.a = k;
      if (k === 'die') b.classList.add('warn');
      b.onclick = () => this.stage.play(k);
      box.appendChild(b);
    }
    const hurt = document.createElement('button');
    hurt.type = 'button';
    hurt.textContent = 'Hit';
    hurt.className = 'warn';
    // a round in the body: it flashes white-hot and cries out
    hurt.onclick = () => {
      if (this.stage.hitZone('body', 'bullet')) this.zoneMeshes.body.flash = 0.45;
    };
    box.appendChild(hurt);
    const tg = (id, fn) => {
      const b = $(id);
      b.onclick = () => {
        const v = b.getAttribute('aria-pressed') !== 'true';
        b.setAttribute('aria-pressed', String(v));
        fn(v);
      };
      return b;
    };
    tg('tgPZones', (v) => (this.showZones = v));
    tg('tgPFire', (v) => (this.fire = v));
    tg('tgPFollow', (v) => ((this.follow = v), (this.snap = true)));
    tg('tgPDark', (v) => (this.active ? this.setDusk(v) : (this.dusk = v))).setAttribute('aria-pressed', String(this.dusk));
    $('pRevive').onclick = () => this.stage.revive();
    const wSel = $('pWeapon');
    const W_LABEL = { bullet: 'Bullet', arrow: 'Arrow', blast: 'Blast' };
    for (const [k, dmg] of Object.entries(PHOENIX_WEAPONS)) wSel.appendChild(Object.assign(document.createElement('option'), { value: k, textContent: `${W_LABEL[k] ?? k} (${dmg})` }));
    wSel.value = this.weapon;
    wSel.onchange = (e) => (this.weapon = e.target.value);
    const sp = $('pSpeed');
    sp.oninput = () => {
      this.speed = +sp.value;
      $('pSpeedO').textContent = '×' + this.speed.toFixed(2);
    };
    sp.oninput();
    // its tunables
    for (const [k, id] of Object.entries(PARAM_UI)) {
      const s = $(id);
      const P = PHOENIX_PARAMS[k];
      Object.assign(s, { min: P.min, max: P.max, step: k === 'speed' ? 0.1 : 0.05 });
      s.value = this.stage.params[k];
      s.oninput = () => {
        this.stage.set({ [k]: +s.value });
        $(id + 'O').textContent = k === 'speed' ? this.stage.params[k].toFixed(1) : '×' + this.stage.params[k].toFixed(2);
      };
      s.oninput();
    }
    // the zone editor: the same table the simulation's bullets use
    const zSel = $('pZoneSel');
    for (const [k, z] of Object.entries(PHOENIX_ZONES)) zSel.appendChild(Object.assign(document.createElement('option'), { value: k, textContent: z.label }));
    const [zR, zM] = ['pzR', 'pzM'].map($);
    this.zoneUI = () => {
      const z = PHOENIX_ZONES[zSel.value];
      zR.value = z.r;
      zM.value = z.mult;
      $('pzRo').textContent = (+z.r).toFixed(2) + ' m';
      $('pzMo').textContent = '×' + (+z.mult).toFixed(1);
    };
    const apply = () => {
      const z = PHOENIX_ZONES[zSel.value];
      z.r = +zR.value;
      z.mult = +zM.value;
      this.zoneUI();
    };
    zSel.onchange = this.zoneUI;
    [zR, zM].forEach((s) => (s.oninput = apply));
    this.zoneUI();
    // ?phoenix=1 (or ?tab=phoenix) opens it (rig/stage.js); &pact=dive plays an act; &pzones=1 shows the zones;
    // &pspan= &pheat= &psize= &pfly= its tunables; &phits=head,body hits; &psteps=n runs ahead; &pfollow=1; &pdark=0 daylight
    if (qs.get('phoenix') || qs.get('tab') === 'phoenix') {
      for (const [k, id] of Object.entries(PARAM_UI)) {
        const v = qs.get({ span: 'pspan', heat: 'pheat', size: 'psize', speed: 'pfly' }[k]);
        if (v != null) {
          $(id).value = v;
          $(id).oninput();
        }
      }
      if (qs.get('pact')) this.stage.play(qs.get('pact'));
      if (qs.get('pzones') === '1') $('tgPZones').click();
      if (qs.get('pfollow') === '1') $('tgPFollow').click();
      if (qs.get('pspeed')) {
        sp.value = qs.get('pspeed');
        sp.oninput();
      }
      if (qs.get('psteps')) this.advance(+qs.get('psteps'));
      for (const k of (qs.get('phits') ?? '').split(',').filter((k) => PHOENIX_ZONES[k])) this.stage.hitZone(k, 'bullet');
    }
  }
}

/** The page's own ground (a 200 m plane): it stays. */
function isGround(o) {
  return o.isMesh && o.geometry?.type === 'PlaneGeometry' && o.geometry.parameters?.width >= 100;
}
