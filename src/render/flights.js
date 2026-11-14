import * as THREE from 'three';
import { buildJetMesh } from './jetMesh.js';
import { radioSay } from '../audio/radio.js';
import { PilotFigure } from './pilotFigure.js';

/**
 * The flights of jets (ai/flight.js, world.flights): each member drawn with the jet's own mesh
 * (render/jetMesh.js), banking and climbing as it flies; afterburner flames by its throttle; its
 * rockets; smoke and fire trailing from the parts that are hit and burning (sim/jetDamage.js),
 * the fall, the fireball and splash where it comes down. Optionally (showPaths) each one's trail
 * and the target, and the leader's radio calls spoken (radio).
 */
const PUFF_TEX = (() => {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();

/** A pool of soft sprites: fire, smoke, spray. */
export class Puffs {
  constructor(parent, n = 400) {
    this.group = new THREE.Group();
    parent.add(this.group);
    this.list = Array.from({ length: n }, () => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: PUFF_TEX, transparent: true, depthWrite: false }));
      s.visible = false;
      s.userData = { v: new THREE.Vector3() };
      this.group.add(s);
      return s;
    });
    this.next = 0;
  }
  /** kind: 'fire' | 'smoke' | 'spray'; size in metres. */
  emit(p, kind, size = 2, v = null, life = null) {
    const s = this.list[this.next];
    this.next = (this.next + 1) % this.list.length;
    s.position.copy(p);
    s.userData.v.copy(v ?? new THREE.Vector3(0, kind === 'fire' ? 3 : 1.5, 0));
    Object.assign(s.userData, { t: 0, life: life ?? (kind === 'fire' ? 0.8 : kind === 'spray' ? 1.6 : 4), kind, size });
    s.material.color.set(kind === 'fire' ? '#ffa040' : kind === 'spray' ? '#f4f8fb' : '#4d4945');
    s.material.blending = kind === 'fire' ? THREE.AdditiveBlending : THREE.NormalBlending;
    s.visible = true;
  }
  update(dt) {
    for (const s of this.list) {
      if (!s.visible) continue;
      const u = s.userData;
      u.t += dt;
      if (u.t >= u.life) {
        s.visible = false;
        continue;
      }
      const k = u.t / u.life;
      s.position.addScaledVector(u.v, dt);
      u.v.multiplyScalar(Math.exp(-1.5 * dt));
      s.scale.setScalar(u.size * (u.kind === 'fire' ? 1 - k * 0.5 : 0.6 + k * 2.4));
      s.material.opacity = u.kind === 'fire' ? 0.95 * (1 - k) : 0.6 * (1 - k);
    }
  }
  clear() {
    for (const s of this.list) s.visible = false;
  }
}

export class FlightRenderer {
  constructor(scene) {
    this.scene = scene;
    this.items = new Map(); // flight record → { jets, trails, rockets }
    this.showPaths = false;
    this.radio = true;
    this.fx = new Puffs(scene);
    this.rocketGeo = new THREE.CylinderGeometry(0.12, 0.12, 2.2, 6).rotateZ(Math.PI / 2);
    this.rocketMat = new THREE.MeshBasicMaterial({ color: 0xf2efe6 });
    this.seen = 0;
    this._v = new THREE.Vector3();
  }

  setWorld(world) {
    for (const it of this.items.values()) this.drop(it);
    this.items.clear();
    this.world = world;
    this.seen = world?.events?.length ?? 0;
    this.fx.clear();
  }

  drop(it) {
    for (const j of it.jets) this.scene.remove(j.group);
    for (const t of it.trails) this.scene.remove(t.line);
    for (const f of it.pilots.values()) this.scene.remove(f.group);
    for (const r of it.rockets) this.scene.remove(r);
    if (it.target) this.scene.remove(it.target);
  }

  build(f) {
    const ai = f.ai;
    const jets = ai.members.map(() => {
      const j = buildJetMesh(f.color ?? '#6f7b86', Math.min(8, ai.o.rockets ?? 4));
      j.gear.visible = false;
      j.group.rotation.order = 'YZX';
      // the pilot in his seat, seen through the canopy
      j.pilot = new PilotFigure();
      j.pilot.group.scale.setScalar(0.85);
      j.pilot.group.position.set(3.15, 1.62, 0);
      j.pilot.update(1);
      j.group.add(j.pilot.group);
      this.scene.add(j.group);
      return j;
    });
    const trails = ai.members.map(() => {
      const n = 120;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
      geo.setDrawRange(0, 0);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x9fe0ff, transparent: true, opacity: 0.55 }));
      line.frustumCulled = false;
      this.scene.add(line);
      return { line, n, pts: [], t: 0 };
    });
    const target = new THREE.Mesh(new THREE.RingGeometry(18, 24, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff5040, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
    this.scene.add(target);
    return { jets, trails, rockets: [], target, splashes: 0, pilots: new Map() };
  }

  update(time, dt) {
    const w = this.world;
    if (!w?.flights?.length) return;
    dt = Math.min(dt ?? 0.016, 0.05);
    for (const f of w.flights) {
      const ai = f.ai;
      if (!ai) continue;
      let it = this.items.get(f);
      if (!it) this.items.set(f, (it = this.build(f)));
      ai.members.forEach((m, i) => this.drawJet(it.jets[i], m, it.trails[i], dt));
      // rockets in the air
      while (it.rockets.length < ai.rockets.length) {
        const r = new THREE.Mesh(this.rocketGeo, this.rocketMat);
        this.scene.add(r);
        it.rockets.push(r);
      }
      it.rockets.forEach((r, k) => {
        const q = ai.rockets[k];
        r.visible = !!q;
        if (!q) return;
        r.position.set(...q.p);
        r.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), this._v.set(...q.v).normalize());
        if (Math.random() < dt * 30) this.fx.emit(r.position.clone(), 'smoke', 1.2, null, 1.5);
      });
      // where they came down: a splash (or a fireball for a jet)
      for (const s of ai.splashes) {
        if (s.id <= it.splashes) continue;
        it.splashes = s.id;
        const p = new THREE.Vector3(...s.p);
        const n = s.big ? 40 : 14;
        for (let k = 0; k < n; k++) {
          const v = new THREE.Vector3((Math.random() - 0.5) * 14, 6 + Math.random() * 16, (Math.random() - 0.5) * 14);
          this.fx.emit(p, s.water === false ? 'smoke' : 'spray', s.big ? 6 : 3, v, 2);
          if (s.big) this.fx.emit(p, 'fire', 7, v.clone().multiplyScalar(0.6), 1.2);
        }
      }
      // the ones who ejected: the seat, the man, the canopy filling, steering, landing
      for (const P of ai.pilots) {
        let fig = it.pilots.get(P);
        if (!fig) {
          fig = new PilotFigure();
          fig.group.rotation.order = 'YXZ';
          this.scene.add(fig.group);
          it.pilots.set(P, fig);
        }
        const c = P.chute;
        fig.group.position.set(c.p[0], c.p[1] + (P.state === 'chute' && c.phase !== 'plf' ? 0 : 0.1), c.p[2]);
        fig.group.rotation.y = c.heading;
        fig.seat.visible = c.phase === 'seat';
        fig.setInflate(c.open ? c.inflate : 0);
        fig.setPose(ai.pilotPose(P));
        fig.update(dt);
        if (c.phase === 'seat') this.fx.emit(fig.group.position.clone().add(new THREE.Vector3(0, -0.4, 0)), 'fire', 1.2, new THREE.Vector3(0, -8, 0), 0.4);
      }
      it.target.visible = this.showPaths && !!(ai.attack?.T ?? ai.target);
      const T = ai.attack?.T ?? ai.target;
      if (T) it.target.position.set(T[0], T[1] + 0.5, T[2]);
      for (const t of it.trails) t.line.visible = this.showPaths;
    }
    this.fx.update(dt);
    // the radio: spoken (the event list shows the lines)
    for (; this.seen < w.events.length; this.seen++) {
      const ev = w.events[this.seen];
      // (spoken: the calls; the read-backs and 'rifle' calls only show in the event list)
      if (ev.type === 'flightRadio' && this.radio && ev.kind !== 'reply' && ev.kind !== 'fire') radioSay(ev.name.replace(/^[^:]*: /, ''));
    }
  }

  drawJet(j, m, trail, dt) {
    const g = j.group;
    g.visible = !m.gone;
    if (m.gone) return;
    g.position.set(m.p[0], m.p[1] - 1.6, m.p[2]);
    g.rotation.set(m.bank, m.h, m.gamma);
    const fl = m.alive ? 0.25 + 0.75 * (m.throttle ?? 0.5) : 0;
    j.flame.visible = fl > 0.1;
    j.flame.scale.set(0.6 + fl * 0.5, 0.3 + fl * 1.4, 0.6 + fl * 0.5);
    // rockets fired come off the rails
    j.racks.forEach((r, k) => (r.visible = k < m.rockets));
    // the canopy jettisoned and the seat gone once he is out
    j.canopy.visible = !m.pilot && (m.dmg?.dmg.cockpit ?? 0) < 1;
    j.pilot.group.visible = !m.pilot;
    // damage: darker parts, a lost wing or tail gone, fire and smoke from the hit parts
    const d = m.dmg?.dmg ?? {};
    const part = { wingL: [j.parts.wingL], wingR: [j.parts.wingR], tail: [j.parts.tail, j.parts.fin], engines: [j.parts.engine], cockpit: [j.canopy] };
    for (const [k, meshes] of Object.entries(part))
      for (const mesh of meshes) {
        if (k === 'cockpit') continue;
        mesh.visible = k === 'engines' || (d[k] ?? 0) < 1;
        mesh.material.userData.base ??= mesh.material.color.clone();
        mesh.material.color.copy(mesh.material.userData.base).multiplyScalar(1 - 0.6 * (d[k] ?? 0));
      }
    for (const e of m.dmg?.emitters() ?? []) {
      const p = g.localToWorld(this._v.set(e.p[0], e.p[1], e.p[2]).clone());
      if (e.fire > 0 && Math.random() < dt * 50 * e.fire) this.fx.emit(p, 'fire', 2.5 + 3 * e.fire, null, 0.7);
      if (Math.random() < dt * 25 * e.smoke) this.fx.emit(p, 'smoke', 3 + 3 * e.smoke, null, 5);
    }
    // the trail
    trail.t += dt;
    if (trail.t > 0.25) {
      trail.t = 0;
      trail.pts.push(m.p[0], m.p[1], m.p[2]);
      if (trail.pts.length > trail.n * 3) trail.pts.splice(0, 3);
      const a = trail.line.geometry.attributes.position;
      a.array.set(trail.pts);
      a.needsUpdate = true;
      trail.line.geometry.setDrawRange(0, trail.pts.length / 3);
    }
  }
}
