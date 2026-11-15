import * as THREE from 'three';
import { F_HIDDEN } from '../sim/world.js';
import { buildRowBoatMesh } from './rowBoatMesh.js';
import { toWorld } from '../sim/buoyancy.js';
import { bodyStats, clearFlag } from '../sim/movingBody.js';
import { BoatCrewRenderer } from './boatCrew.js';

const LINE_N = 12;

/**
 * What floats (world.floats: rowing boats, models/rowBoat.js), drawn in its pose on the water:
 * where sim/buoyancy.js has it (heave, roll, pitch: Archimedes on the waves), or, in a place
 * not simulated yet, as it was built (at rest at its draft). Its voxels are hidden: they heat,
 * char and burn as its wood (or aluminium, GRP) does, and the hull blackens with them; when most
 * of its planking has gone (burnt, blown away), what is left of it shows as voxels.
 */
export class FloatRenderer {
  constructor(parent, opts = {}) {
    this.group = new THREE.Group();
    parent.add(this.group);
    this.items = [];
    this.check = 0;
    // the people aboard (render/boatCrew.js): you seen from outside, the boatmen; the squad's men are render/enemies.js's
    this.crew = new BoatCrewRenderer(this.group, { assets: opts.assets ?? null });
  }

  setWorld(world) {
    this.clear();
    this.world = world;
    for (const f of world.floats ?? []) {
      const m = buildRowBoatMesh(f.params ?? {});
      m.group.rotation.order = 'YXZ'; // (R = Ry(yaw) · Rx(roll) · Rz(pitch): sim/buoyancy.js rot)
      this.group.add(m.group);
      // its painter, when it is moored (sim/boats.js f.mooring): from its stem to the ring ashore
      const line = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3 * LINE_N), 3)), new THREE.LineBasicMaterial({ color: 0xd8cfb4 }));
      line.frustumCulled = false;
      line.visible = false;
      this.group.add(line);
      this.items.push({ f, m, line, char: 0, gone: false });
      this.place(this.items[this.items.length - 1]);
    }
  }

  clear() {
    this.crew?.clear();
    for (const it of this.items) {
      this.group.remove(it.m.group);
      if (it.line) {
        this.group.remove(it.line);
        it.line.geometry.dispose();
        it.line.material.dispose();
      }
      it.m.dispose();
    }
    this.items = [];
  }

  /** In its pose: the hull's frame (keel amidships) where the simulation has it, or as built. */
  place(it) {
    const { f, m } = it;
    const pose = f.body?.pose;
    if (pose) {
      m.group.position.set(pose.p[0], pose.p[1], pose.p[2]);
      m.group.rotation.set(pose.roll, pose.yaw, pose.pitch);
      m.setOars?.(f.row ?? null);
      m.setRig?.(f, it.dt ?? 0); // (the sail, the outboard, the paddle: render/rowBoatMesh.js)
      this.placeLine(it);
    } else {
      const k = f.spec?.keelY ?? 0;
      m.group.position.set(f.at[0], f.at[1] + k, f.at[2]);
      m.group.rotation.set(0, f.yaw ?? 0, 0);
    }
  }

  /** The mooring line: a sagging curve from its stem to where it is made fast (taut: straight). */
  placeLine(it) {
    const { f, line } = it;
    const mo = f.mooring;
    if (!line || !mo || !f.body) {
      if (line) line.visible = false;
      return;
    }
    const a = toWorld(f.body, mo.at);
    const b = mo.anchor;
    const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const sag = Math.sqrt(Math.max(0, mo.length * mo.length - d * d)) * 0.5;
    const pos = line.geometry.attributes.position;
    for (let k = 0; k < LINE_N; k++) {
      const t = k / (LINE_N - 1);
      pos.setXYZ(k, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t);
    }
    pos.needsUpdate = true;
    line.visible = true;
  }

  update(dt, camera = null) {
    for (const it of this.items) {
      it.dt = dt;
      if (!it.gone) this.place(it);
    }
    this.crew.update(this.world, this.items.filter((it) => !it.gone && !it.f.body?.sunk).map((it) => it.f), dt, camera);
    this.check -= dt;
    if (this.check > 0 || !this.world) return;
    this.check = 0.5;
    const w = this.world;
    for (const it of this.items) {
      const f = it.f;
      // (its voxels go with it, wherever it is: sim/movingBody.js, f.mb; its planking tagged 1)
      if (it.gone || !f.mb) continue;
      const st = bodyStats(w, f.mb, 1);
      // gone (burnt, shattered): what is left of it shows as voxels (and they go on moving with it)
      if (st.n && st.left < st.n * 0.35) {
        it.gone = true;
        it.m.group.visible = false;
        this.crew?.drop(f);
        clearFlag(w, f.mb, F_HIDDEN);
        continue;
      }
      // charring: the paint and the wood blacken as its voxels char
      const c = st.char;
      if (Math.abs(c - it.char) > 0.03) {
        it.char = c;
        for (const mt of [...it.m.hullMats, ...it.m.woodMats]) mt.color.copy(mt.userData.base).multiplyScalar(1 - 0.85 * c);
      }
    }
  }
}
