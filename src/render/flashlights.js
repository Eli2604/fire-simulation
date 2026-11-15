import * as THREE from 'three';
import { lod } from './lod.js';

/**
 * The lights of flashlights (ai/flashlight.js): weapon lights and hand torches. A spot light each
 * would be far too many (every light in the scene is in every lit material's shader), so there is
 * a small pool: a fixed number of SpotLights (made once, so the shaders never recompile), given
 * each frame to the sources that matter most: the biggest on the screen (render/lod.js: their
 * size there, a budget of `flashlight`), the nearest first. The rest show only what each figure
 * draws itself: the lens's glow and the faint beam in the air.
 *
 *   pool.update([{ pos, dir, kind, key }])   (world space: THREE.Vector3 or [x, y, z])
 */
export const FLASHLIGHT = { pool: 3, intensity: 9, range: 32, angle: 0.34, penumbra: 0.55, decay: 1.6, shadows: 1 };
const LEVELS = [16, 5]; // px (radius 1.5 m): a spot light above 16, the glow and beam only below

export class FlashlightPool {
  constructor(scene, n = FLASHLIGHT.pool) {
    this.scene = scene;
    this.lights = [];
    lod.budgets.flashlight ??= n;
    for (let i = 0; i < n; i++) {
      const l = new THREE.SpotLight('#fff3dc', 0, FLASHLIGHT.range, FLASHLIGHT.angle, FLASHLIGHT.penumbra, FLASHLIGHT.decay);
      l.castShadow = i < FLASHLIGHT.shadows;
      if (l.castShadow) {
        l.shadow.mapSize.set(512, 512);
        l.shadow.camera.near = 0.1;
        l.shadow.camera.far = FLASHLIGHT.range;
        l.shadow.bias = -0.0015;
      }
      scene.add(l, l.target);
      this.lights.push(l);
    }
    this.states = new Map();
    this.used = 0;
  }
  /** Give the pool's lights to the sources that matter most this frame. */
  update(sources) {
    const V = (v) => (Array.isArray(v) ? new THREE.Vector3(v[0], v[1], v[2]) : v);
    const ranked = [];
    for (const s of sources) {
      if (!s) continue;
      const pos = V(s.pos), dir = V(s.dir);
      const st = this.states.get(s.key ?? s) ?? {};
      if (s.key != null) this.states.set(s.key, st);
      // (where the beam falls counts too: a light shone at the camera from far off still lights its ground)
      const lv = lod.level(st, pos.x + dir.x * 4, pos.y + dir.y * 4, pos.z + dir.z * 4, 1.5, LEVELS, 'flashlight');
      if (lv === 0) ranked.push({ pos, dir, size: st.size ?? 0 });
    }
    ranked.sort((a, b) => b.size - a.size);
    this.used = Math.min(ranked.length, this.lights.length);
    this.lights.forEach((l, i) => {
      const r = ranked[i];
      // (unused: dark, but still there: a light added or removed would recompile every shader)
      if (!r) {
        l.intensity = 0;
        return;
      }
      l.intensity = FLASHLIGHT.intensity;
      l.position.copy(r.pos);
      l.target.position.copy(r.pos).addScaledVector(r.dir, 5);
      l.target.updateMatrixWorld();
    });
    if (this.states.size > 200) this.states.clear();
  }
  dispose() {
    for (const l of this.lights) {
      this.scene.remove(l, l.target);
      l.dispose?.();
    }
    this.lights.length = 0;
  }
}
