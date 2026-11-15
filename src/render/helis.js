import * as THREE from 'three';
import { buildHeliMesh, poseHeli, buildBladeMesh, buildTailMesh, poseTail } from './heliMesh.js';
import { Puffs } from './flights.js';

/**
 * The simulation's helicopters (ai/helicopter.js, world.helis): each drawn with render/heliMesh.js
 * (rotors turning, doors sliding, the door guns aimed and flashing); the blades and the tail rotor
 * that fly off; smoke from a hit engine, fuel leaking, flames from a burning tank and the wreck's
 * smoke. The men in it are w.enemies (render/enemies.js), the cables w.ropes (render/ropes.js),
 * the rounds the guns fire the world's tracers; explosions and fires are the simulation's own.
 * Also used by the rig stage (rig/heli.js) on its own helicopter.
 */
export class HeliRenderer {
  constructor(scene) {
    this.scene = scene;
    this.items = new Map();
    this.fx = new Puffs(scene, 600);
    this._p = new THREE.Vector3();
  }
  setWorld(world) {
    for (const it of this.items.values()) this.drop(it);
    this.items.clear();
    this.world = world;
  }
  drop(it) {
    this.scene.remove(it.mesh.group);
    it.mesh.dispose();
    for (const b of it.debris) {
      this.scene.remove(b);
      b.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
    }
  }
  update(time, dt) {
    const list = (this.world?.helis ?? []).map((s) => s.ai ?? s).filter((h) => h?.p && h.axes);
    this.draw(list, dt);
  }
  /**
   * What the battle has in the air (sim/ordnance.js world.ordnance): a rocket's or a missile's
   * motor and its smoke trail, a burning flare on its trail; where rounds and warheads hit: a flash
   * and smoke, a splash on the water. (Cannon rounds are the world's tracers.)
   */
  drawOrdnance(dt) {
    const w = this.world;
    if (!w) return;
    const P = (p) => this._p.set(p[0], p[1], p[2]).clone();
    const rate = (r) => Math.random() < r * dt;
    for (const g of w.ordnance ?? []) {
      if (g.type === 'rocket' || g.type === 'missile') {
        const burning = g.t < (g.spec?.burn ?? 1);
        if (burning) this.fx.emit(P(g.p), 'fire', 0.7, null, 0.12);
        if (rate(burning ? 40 : 8)) this.fx.emit(P(g.p), 'smoke', burning ? 1.2 : 0.8, null, 2.5);
      } else if (g.type === 'flare') {
        this.fx.emit(P(g.p), 'fire', 1.1, null, 0.2);
        if (rate(20)) this.fx.emit(P(g.p), 'smoke', 0.9, null, 3);
      }
    }
    const now = w.time ?? 0;
    for (const q of w.ordnanceHits ?? []) {
      if (q.drawn) continue;
      q.drawn = true;
      if (now - q.t > 1) continue;
      if (q.kind === 'water') {
        for (let i = 0; i < (q.he ? 6 : 2); i++) this.fx.emit(P(q.p), 'spray', q.type === 'round' ? 0.6 : 2, new THREE.Vector3((Math.random() - 0.5) * 2, 5 + Math.random() * 4, (Math.random() - 0.5) * 2), 0.8);
        continue;
      }
      if (q.he) {
        this.fx.emit(P(q.p), 'fire', q.type === 'round' ? 1.2 : 3, null, 0.25);
        this.fx.emit(P(q.p), 'smoke', q.type === 'round' ? 1.5 : 4, new THREE.Vector3(0, 1.5, 0), 3);
      } else if (rate(30)) this.fx.emit(P(q.p), 'smoke', 0.5, null, 1);
    }
  }
  /** Draw these helicopters (Helicopter objects). */
  draw(list, dt = 0.016) {
    dt = Math.min(dt ?? 0.016, 0.05);
    const seen = new Set();
    for (const h of list) {
      seen.add(h);
      let it = this.items.get(h);
      if (!it) {
        const mesh = buildHeliMesh({ color: h.color ?? '#4a5240', arms: h.arms?.spec ?? null });
        this.scene.add(mesh.group);
        it = { mesh, debris: [] };
        this.items.set(h, it);
      }
      poseHeli(it.mesh, h);
      // what flew off
      while (it.debris.length < h.debris.length) {
        // (the tail boom broken off: the boom, the fin and the tail rotor as one piece)
        const kind = h.debris[it.debris.length].kind;
        const b = kind === 'tailBoom' ? buildTailMesh(h.color ?? '#4a5240') : buildBladeMesh(kind);
        this.scene.add(b);
        it.debris.push(b);
      }
      h.debris.forEach((d, k) => {
        const b = it.debris[k];
        if (d.kind === 'tailBoom') return poseTail(b, d);
        b.position.set(...d.p);
        b.rotation.set(d.kind === 'blade' ? 0.3 * Math.sin(d.a) : d.a, d.a, 0);
      });
      // smoke and fire from it
      const at = (l) => this._p.set(...h.toWorld(l)).clone();
      const rate = (r) => Math.random() < r * dt;
      if (h.smoke > 0.25 && rate(12 * h.smoke)) this.fx.emit(at([-1.8, 2.8, 0]), 'smoke', 1.5 + 2 * h.smoke, new THREE.Vector3(-h.v[0] * 0.3, 1.5, -h.v[2] * 0.3), 3);
      if (h.leak > 0.2 && !h.fire && rate(6)) this.fx.emit(at([-1.1, 0.3, 0]), 'spray', 0.6, new THREE.Vector3(0, -3, 0), 1);
      if (h.fire > 0) {
        if (rate(30)) this.fx.emit(at([-1.1 + (Math.random() - 0.5) * 2, 0.8, (Math.random() - 0.5) * 1.6]), 'fire', 2.2, new THREE.Vector3(-h.v[0] * 0.5, 3, -h.v[2] * 0.5), 0.8);
        if (rate(10)) this.fx.emit(at([-1.1, 2.5, 0]), 'smoke', 4, new THREE.Vector3(-h.v[0] * 0.3, 2.5, -h.v[2] * 0.3), 5);
      } else if (h.crashed && rate(4)) this.fx.emit(at([0, 1.5, 0]), 'smoke', 3, null, 5);
    }
    this.drawOrdnance(dt);
    for (const [h, it] of this.items)
      if (!seen.has(h)) {
        this.drop(it);
        this.items.delete(h);
      }
    this.fx.update(dt);
  }
}
