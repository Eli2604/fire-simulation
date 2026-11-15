import * as THREE from 'three';
import { buildHeliMesh, poseHeli, buildBladeMesh } from './heliMesh.js';
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
    this.fx = new Puffs(scene, 300);
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
      b.geometry.dispose();
      b.material.dispose();
    }
  }
  update(time, dt) {
    const list = (this.world?.helis ?? []).map((s) => s.ai ?? s).filter((h) => h?.p && h.axes);
    this.draw(list, dt);
  }
  /** Draw these helicopters (Helicopter objects). */
  draw(list, dt = 0.016) {
    dt = Math.min(dt ?? 0.016, 0.05);
    const seen = new Set();
    for (const h of list) {
      seen.add(h);
      let it = this.items.get(h);
      if (!it) {
        const mesh = buildHeliMesh({ color: h.color ?? '#4a5240' });
        this.scene.add(mesh.group);
        it = { mesh, debris: [] };
        this.items.set(h, it);
      }
      poseHeli(it.mesh, h);
      // what flew off
      while (it.debris.length < h.debris.length) {
        const b = buildBladeMesh(h.debris[it.debris.length].kind);
        this.scene.add(b);
        it.debris.push(b);
      }
      h.debris.forEach((d, k) => {
        const b = it.debris[k];
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
    for (const [h, it] of this.items)
      if (!seen.has(h)) {
        this.drop(it);
        this.items.delete(h);
      }
    this.fx.update(dt);
  }
}
