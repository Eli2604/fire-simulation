import * as THREE from 'three';

/**
 * Falling rain streaks; count follows the rain intensity, drift follows the wind.
 * A drop ends at the first thing in its column (a roof, a tree crown, the ground):
 * it does not rain inside a house.
 */
export class RainRenderer {
  constructor(scene, max = 6000) {
    this.max = max;
    this.pos = new Float32Array(max * 6);
    this.seed = new Float32Array(max * 3);
    const geo = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.attr);
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xaab4c4, transparent: true, opacity: 0.45 }));
    this.lines.frustumCulled = false;
    scene.add(this.lines);
    for (let k = 0; k < max; k++) {
      this.seed[k * 3] = Math.random();
      this.seed[k * 3 + 1] = Math.random();
      this.seed[k * 3 + 2] = Math.random();
    }
    this.t = 0;
  }

  update(dt, world, weather) {
    const n = Math.min(this.max, Math.round((weather.rain / 30) * this.max));
    this.lines.visible = n > 0;
    if (!n || !world) return;
    this.t += dt;
    const [sx, sy, sz] = world.size;
    const H = sy * 1.2;
    const speed = 7;
    const rad = (weather.windDir * Math.PI) / 180;
    const wx = Math.cos(rad) * weather.windSpeed;
    const wz = Math.sin(rad) * weather.windSpeed;
    const len = Math.min(0.5, sy * 0.04);
    const { nx, nz, h, colTop } = world;
    for (let k = 0; k < n; k++) {
      const s0 = this.seed[k * 3];
      const s1 = this.seed[k * 3 + 1];
      const s2 = this.seed[k * 3 + 2];
      const fall = ((this.t * speed) / H + s2) % 1;
      const y = H * (1 - fall);
      const drift = (H - y) / speed;
      const x = (((s0 * sx + wx * drift) % sx) + sx) % sx;
      const z = (((s1 * sz + wz * drift) % sz) + sz) % sz;
      const o = k * 6;
      // under a roof: this drop has already landed on it
      const cx = Math.min(nx - 1, Math.floor(x / h));
      const cz = Math.min(nz - 1, Math.floor(z / h));
      const top = colTop ? (colTop[cx + nx * cz] + 1) * h : 0;
      if (y < top) {
        this.pos[o] = this.pos[o + 3] = x;
        this.pos[o + 1] = this.pos[o + 4] = -1000;
        this.pos[o + 2] = this.pos[o + 5] = z;
        continue;
      }
      this.pos[o] = x;
      this.pos[o + 1] = y;
      this.pos[o + 2] = z;
      this.pos[o + 3] = x - (wx / speed) * len;
      this.pos[o + 4] = y + len;
      this.pos[o + 5] = z - (wz / speed) * len;
    }
    this.lines.geometry.setDrawRange(0, n * 2);
    this.attr.needsUpdate = true;
  }
}
