/**
 * The dragon tab of the rig test page: the simulation's dragon (rig/dragonStage.js moves it with
 * ai/dragon.js) drawn by its own renderer (render/dragon.js), its fire by the flame particles
 * (render/flames.js) and its blood by render/blood.js, on the page's ground. Every act it has as a
 * button, a speed control, its hit zones (ai/dragon.js DRAGON_ZONES) drawn as tapered capsules
 * that follow the pose, shown or hidden and adjusted (radius, length, damage), and damage on
 * click: the zone under the cursor is hit (it flashes), bleeds, drips and stains.
 *
 * While the tab is open the soldiers' range is hidden and paused (main.js skips its tick).
 */
import * as THREE from 'three';
import { createDragonStage, DRAGON_ACTS } from './dragonStage.js';
import { DRAGON_ZONES, dragonZones, dragonRayHit } from '../ai/dragon.js';
import { DragonRenderer } from '../render/dragon.js';
import { FlameRenderer } from '../render/flames.js';
import { BloodRenderer } from '../render/blood.js';

const RS = 12; // sides of a zone tube
const MAXP = 48; // points of a zone (with its end caps)
const CAP = 3; // rings in each end cap

export class DragonRig {
  constructor({ scene, camera, controls, renderer, toast = () => {}, $ = (id) => document.getElementById(id), qs = new URLSearchParams() }) {
    Object.assign(this, { scene, camera, controls, renderer, toast, $ });
    this.active = false;
    this.speed = 1;
    this.showZones = false;
    this.fire = false;
    this.weapon = 'arrow';
    this.stage = createDragonStage();
    const w = this.stage.world;
    // the simulation's world on the page: its middle at the origin, its ground (one voxel) at y = 0
    this.group = new THREE.Group();
    this.group.position.set(-this.stage.center[0], -w.h, -this.stage.center[2]);
    this.group.visible = false;
    scene.add(this.group);
    this.flames = new FlameRenderer(this.group, 6000);
    this.flames.setWorld(w);
    this.drawer = new DragonRenderer(this.group, this.flames);
    this.blood = new BloodRenderer(this.group);
    this.blood.setWorld(w);
    // the wall it climbs (concrete blocks)
    const b = this.stage.wall;
    if (Number.isFinite(b[0])) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(b[3] - b[0], b[4] - b[1], b[5] - b[2]), new THREE.MeshStandardMaterial({ color: '#a9a69e', roughness: 0.92 }));
      wall.position.set((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
      wall.castShadow = wall.receiveShadow = true;
      this.group.add(wall);
    }
    this.buildZones();
    this.ui(qs);
    // clicks on the dragon (before the soldiers' handler, which they never reach while the tab is open)
    const el = renderer.domElement;
    el.addEventListener('pointerdown', (ev) => (this.down = [ev.clientX, ev.clientY]), true);
    el.addEventListener('pointerup', (ev) => this.active && (ev.stopImmediatePropagation(), this.click(ev)), true);
  }

  /* ---------------- hit zones: a tube per zone, rebuilt from the pose every frame ---------------- */
  buildZones() {
    this.zoneMeshes = {};
    const idx = [];
    for (let m = 0; m < MAXP - 1; m++)
      for (let j = 0; j < RS; j++) {
        const a = m * (RS + 1) + j;
        const c = a + RS + 1;
        idx.push(a, c, a + 1, c, c + 1, a + 1);
      }
    for (const [k, z] of Object.entries(DRAGON_ZONES)) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXP * (RS + 1) * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setIndex(idx);
      const fill = new THREE.MeshBasicMaterial({ color: z.color, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(g, fill);
      mesh.renderOrder = 5;
      mesh.frustumCulled = false;
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array((MAXP * RS * 2 + 4 * MAXP * 2) * 3), 3).setUsage(THREE.DynamicDrawUsage));
      const wire = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: z.color, transparent: true, opacity: 0.9 }));
      wire.renderOrder = 6;
      wire.frustumCulled = false;
      this.group.add(mesh, wire);
      this.zoneMeshes[k] = { mesh, wire, flash: 0 };
    }
  }

  /** The rings of a zone tube: along its points, with a half-sphere cap at each end. */
  rings(Z) {
    const P = Z.pts;
    const n = P.length;
    const out = [];
    const frame = (i) => {
      const a = P[Math.max(0, i - 1)].p;
      const b = P[Math.min(n - 1, i + 1)].p;
      const T = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
      const U = new THREE.Vector3(...P[i].up);
      U.addScaledVector(T, -U.dot(T));
      if (U.lengthSq() < 1e-6) {
        U.set(Math.abs(T.y) < 0.9 ? 0 : 1, Math.abs(T.y) < 0.9 ? 1 : 0, 0);
        U.addScaledVector(T, -U.dot(T));
      }
      U.normalize();
      return { T, U, S: new THREE.Vector3().crossVectors(U, T) };
    };
    const f0 = frame(0);
    const f1 = frame(n - 1);
    for (let c = CAP; c >= 1; c--) {
      const ph = (c / (CAP + 1)) * Math.PI * 0.5;
      out.push({ p: new THREE.Vector3(...P[0].p).addScaledVector(f0.T, -P[0].r * Math.sin(ph)), r: P[0].r * Math.cos(ph), ...f0 });
    }
    for (let i = 0; i < n && out.length < MAXP - CAP; i++) out.push({ p: new THREE.Vector3(...P[i].p), r: P[i].r, ...frame(i) });
    for (let c = 1; c <= CAP; c++) {
      const ph = (c / (CAP + 1)) * Math.PI * 0.5;
      out.push({ p: new THREE.Vector3(...P[n - 1].p).addScaledVector(f1.T, P[n - 1].r * Math.sin(ph)), r: P[n - 1].r * Math.cos(ph), ...f1 });
    }
    return out;
  }

  poseZones(dt) {
    const d = this.stage.dragon;
    const zones = d.spine ? dragonZones(d, this.stage.world) : [];
    for (const [k, zm] of Object.entries(this.zoneMeshes)) {
      zm.flash = Math.max(0, zm.flash - dt);
      const Z = zones.find((z) => z.k === k);
      const on = !!Z && (this.showZones || zm.flash > 0);
      zm.mesh.visible = zm.wire.visible = on;
      if (!on) continue;
      zm.mesh.material.opacity = 0.2 + 0.5 * Math.min(1, zm.flash / 0.25);
      zm.mesh.material.color.set(zm.flash > 0 ? '#ff3b2f' : Z.z.color);
      const R = this.rings(Z);
      const pos = zm.mesh.geometry.attributes.position.array;
      const lp = zm.wire.geometry.attributes.position.array;
      let l = 0;
      const put = (v) => {
        lp[l++] = v.x;
        lp[l++] = v.y;
        lp[l++] = v.z;
      };
      const v = new THREE.Vector3();
      const ringPt = (rg, j) => v.copy(rg.p).addScaledVector(rg.U, Math.cos((j / RS) * Math.PI * 2) * rg.r).addScaledVector(rg.S, Math.sin((j / RS) * Math.PI * 2) * rg.r);
      R.forEach((rg, m) => {
        for (let j = 0; j <= RS; j++) ringPt(rg, j).toArray(pos, (m * (RS + 1) + j) * 3);
        // the wire: a ring at each end and every few points, four lines along
        if (m === CAP || m === R.length - 1 - CAP || (m > CAP && m < R.length - CAP && (m - CAP) % 4 === 0))
          for (let j = 0; j < RS; j++) {
            put(ringPt(rg, j));
            put(ringPt(rg, j + 1));
          }
        if (m > 0) for (let j = 0; j < RS; j += RS / 4) {
          put(ringPt(R[m - 1], j));
          put(ringPt(rg, j));
        }
      });
      zm.mesh.geometry.setDrawRange(0, (R.length - 1) * RS * 6);
      zm.mesh.geometry.attributes.position.needsUpdate = true;
      zm.wire.geometry.setDrawRange(0, l / 3);
      zm.wire.geometry.attributes.position.needsUpdate = true;
    }
  }

  /* ---------------- the tab: on and off ---------------- */
  setActive(v) {
    if (v === this.active) return;
    this.active = v;
    this.group.visible = v;
    const build = this.$('build');
    if (v) {
      // the soldiers' range out of the way (and paused: main.js skips its tick)
      this.hidden = new Set();
      this.hideRange();
      this.cam = { p: this.camera.position.clone(), t: this.controls.target.clone() };
      this.camera.position.set(11, 6.5, 13);
      this.controls.target.set(0, 1.4, 0);
      if (build) build.style.visibility = 'hidden';
    } else {
      this.hidden?.forEach((o) => (o.visible = true));
      this.hidden = null;
      if (this.cam) {
        this.camera.position.copy(this.cam.p);
        this.controls.target.copy(this.cam.t);
      }
      if (build) build.style.visibility = '';
    }
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
    this.hideRange(); // (the page re-shows its selection ring every frame; soldiers may have come in since)
    const sdt = Math.min(0.05, dt) * this.speed;
    if (sdt > 0) this.stage.step(sdt);
    const w = this.stage.world;
    const d = this.stage.dragon;
    if (this.follow && d.chest) {
      // the camera keeps its offset to the dragon's chest (as it flies off, the view goes with it)
      const c = new THREE.Vector3(d.chest[0], d.chest[1], d.chest[2]).add(this.group.position);
      const off = this.camera.position.clone().sub(this.controls.target);
      this.controls.target.lerp(c, this.snap ? 1 : Math.min(1, dt * 4));
      this.snap = false;
      this.camera.position.copy(this.controls.target).add(off);
    }
    this.drawer.update(w, w.time, sdt);
    this.flames.update(sdt, this.renderer.domElement.height / (2 * Math.tan((this.camera.fov * Math.PI) / 360)));
    this.blood.update(w.time);
    this.poseZones(dt);
    this.status();
  }

  /** A few steps ahead at once (for screenshots: ?dsteps=n). */
  advance(n, dt = 1 / 30) {
    for (let i = 0; i < n; i++) this.stage.step(dt);
  }

  status() {
    const d = this.stage.dragon;
    const hp = Math.max(0, d.health / d.maxHealth);
    const bar = this.$('dHp');
    if (bar) {
      bar.style.width = (hp * 100).toFixed(1) + '%';
      bar.style.background = hp > 0.5 ? 'var(--ok)' : hp > 0.25 ? 'var(--accent)' : 'var(--hurt)';
    }
    const s = this.$('dState');
    if (s && (this.statusT = (this.statusT ?? 0) + 1) % 6 === 0) {
      const what = d.health <= 0 ? (d.mode === 'falling' ? 'falling' : 'dead') : DRAGON_ACTS[this.stage.act];
      s.textContent = `${what} · ${Math.ceil(d.health)} HP${d.bleed > 0.05 ? ` · bleeding ${d.bleed.toFixed(1)}/s` : ''}`;
      document.querySelectorAll('#dAnims button').forEach((b) => b.classList.toggle('on', b.dataset.a === this.stage.act && d.health > 0));
    }
  }

  /* ---------------- clicks: the zone under the cursor ---------------- */
  click(ev) {
    if (!this.down || Math.hypot(ev.clientX - this.down[0], ev.clientY - this.down[1]) > 6) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const from = ray.ray.origin.clone().sub(this.group.position).toArray();
    const dir = ray.ray.direction.toArray();
    const d = this.stage.dragon;
    const hit = d.health > 0 ? dragonRayHit(d, from, dir, 200, this.stage.world) : null;
    if (!hit) return;
    this.$('dZoneSel').value = hit.k;
    this.zoneUI();
    this.zoneMeshes[hit.k].flash = 0.45;
    if (!this.fire) return this.toast(`${hit.zone.label} · ×${hit.zone.mult.toFixed(1)} damage · bleeds ${hit.zone.bleed}/s`);
    const dmg = this.stage.hitZone(hit.k, this.weapon, hit, dir);
    this.$('dLastHit').textContent = `Last hit: ${hit.zone.label} ×${hit.zone.mult.toFixed(1)} = ${Math.round(dmg)} damage (${this.weapon}), bleeding +${hit.zone.bleed}/s.`;
    this.toast(`${hit.zone.label} · ${Math.round(dmg)} dmg`);
  }

  /* ---------------- the panel ---------------- */
  ui(qs) {
    const $ = this.$;
    const box = $('dAnims');
    if (!box) return;
    for (const [k, label] of Object.entries(DRAGON_ACTS)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.dataset.a = k;
      if (k === 'die' || k === 'fall') b.classList.add('warn');
      b.onclick = () => this.stage.play(k);
      box.appendChild(b);
    }
    const hurt = document.createElement('button');
    hurt.type = 'button';
    hurt.textContent = 'Hurt';
    hurt.className = 'warn';
    // a hit somewhere on the body (an arrow): it flinches, roars and bleeds
    hurt.onclick = () => {
      const d = this.stage.dragon;
      if (d.health <= 0) return;
      const k = ['chest', 'belly', 'neck', 'tail', 'foreL', 'hindR'][Math.floor(Math.random() * 6)];
      this.stage.hitZone(k, 'arrow');
      this.zoneMeshes[k].flash = 0.45;
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
    tg('tgDZones', (v) => (this.showZones = v));
    tg('tgDFire', (v) => (this.fire = v));
    tg('tgDFollow', (v) => ((this.follow = v), (this.snap = true)));
    $('dRevive').onclick = () => this.stage.revive();
    $('dClean').onclick = () => this.stage.clean();
    $('dWeapon').onchange = (e) => (this.weapon = e.target.value);
    const sp = $('dSpeed');
    sp.oninput = () => {
      this.speed = +sp.value;
      $('dSpeedO').textContent = '×' + this.speed.toFixed(2);
    };
    sp.oninput();
    // the zone editor: the same table the simulation's hit tests use
    const zSel = $('dZoneSel');
    for (const [k, z] of Object.entries(DRAGON_ZONES)) {
      const o = document.createElement('option');
      o.value = k;
      o.textContent = z.label;
      zSel.appendChild(o);
    }
    const [zR, zL, zM] = ['dzR', 'dzL', 'dzM'].map($);
    this.zoneUI = () => {
      const z = DRAGON_ZONES[zSel.value];
      zR.value = z.r;
      zL.value = z.len;
      zM.value = z.mult;
      $('dzRo').textContent = '×' + (+z.r).toFixed(2);
      $('dzLo').textContent = '×' + (+z.len).toFixed(2);
      $('dzMo').textContent = '×' + (+z.mult).toFixed(1);
    };
    const apply = () => {
      const z = DRAGON_ZONES[zSel.value];
      z.r = +zR.value;
      z.len = +zL.value;
      z.mult = +zM.value;
      this.zoneUI();
    };
    zSel.onchange = this.zoneUI;
    [zR, zL, zM].forEach((s) => (s.oninput = apply));
    this.zoneUI();
    // the tab opens and closes the dragon's stage
    document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => this.setActive(b.dataset.tab === 'dragon')));
    // ?dragon=1 opens it; &dact=fly plays an act; &dzones=1 shows the zones; &dhits=neck,head wounds; &dsteps=n runs ahead
    if (qs.get('dragon')) {
      document.querySelector('.tabs button[data-tab="dragon"]')?.click();
      if (qs.get('dact')) this.stage.play(qs.get('dact'));
      if (qs.get('dzones') === '1') $('tgDZones').click();
      if (qs.get('dfollow') === '1') $('tgDFollow').click();
      if (qs.get('dspeed')) {
        sp.value = qs.get('dspeed');
        sp.oninput();
      }
      if (qs.get('dsteps')) this.advance(+qs.get('dsteps') - 30);
      for (const k of (qs.get('dhits') ?? '').split(',').filter((k) => DRAGON_ZONES[k])) this.stage.hitZone(k, 'arrow');
      if (qs.get('dsteps')) this.advance(30);
    }
  }
}

/** The page's own ground (a 200 m plane): it stays. */
function isGround(o) {
  return o.isMesh && o.geometry?.type === 'PlaneGeometry' && o.geometry.parameters?.width >= 100;
}
