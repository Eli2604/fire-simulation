import * as THREE from 'three';
import { snowShare } from '../sim/snow.js';

/**
 * Falling rain streaks; count follows the rain intensity, drift follows the wind.
 * A drop ends at the first thing in its column (a roof, a tree crown, the ground):
 * it does not rain inside a house. Below freezing it snows: flakes drifting down slowly
 * (~1 m/s), fluttering, carried far by the wind (sleet: some of each).
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
    // snowflakes: soft white points
    this.fpos = new Float32Array(max * 3);
    const fg = new THREE.BufferGeometry();
    this.fattr = new THREE.BufferAttribute(this.fpos, 3).setUsage(THREE.DynamicDrawUsage);
    fg.setAttribute('position', this.fattr);
    this.flakes = new THREE.Points(fg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.035, transparent: true, opacity: 0.85, depthWrite: false }));
    this.flakes.frustumCulled = false;
    this.flakes.visible = false;
    scene.add(this.flakes);
    for (let k = 0; k < max; k++) {
      this.seed[k * 3] = Math.random();
      this.seed[k * 3 + 1] = Math.random();
      this.seed[k * 3 + 2] = Math.random();
    }
    this.t = 0;
    // melt water dripping off the eaves (sim/snow.js: S.drips): short falling streaks
    this.dmax = 1500;
    this.dpos = new Float32Array(this.dmax * 6);
    this.dstate = []; // { x, y, z, vy, to }
    const dg = new THREE.BufferGeometry();
    this.dattr = new THREE.BufferAttribute(this.dpos, 3).setUsage(THREE.DynamicDrawUsage);
    dg.setAttribute('position', this.dattr);
    this.dripLines = new THREE.LineSegments(dg, new THREE.LineBasicMaterial({ color: 0xc8d6e6, transparent: true, opacity: 0.7 }));
    this.dripLines.frustumCulled = false;
    scene.add(this.dripLines);
    this.dripAcc = new Map();
  }

  /**
   * Drops falling off the eaves where the snow on a roof melts: as many as the water running
   * off (a drop ~50 mg), from the roof's edge to the ground (or the snow) under it.
   */
  updateDrips(dt, world) {
    const S = world?.snow;
    const list = this.dstate;
    if (S?.drips?.length) {
      // (no more than ~1500 drops in the air: the eaves share them)
      const per = Math.max(1, S.drips.length / 300);
      for (const d of S.drips) {
        const key = d.x * 1e4 + d.z;
        let a = (this.dripAcc.get(key) ?? Math.random()) + (Math.min(12, d.rate / 5e-5) * dt) / per;
        while (a >= 1 && list.length < this.dmax) {
          a -= 1;
          list.push({ x: d.x + (Math.random() - 0.5) * 0.15, y: d.y - 0.02, z: d.z + (Math.random() - 0.5) * 0.15, vy: 0, to: d.to });
        }
        this.dripAcc.set(key, a % 1);
      }
    }
    let n = 0;
    for (let k = 0; k < list.length; k++) {
      const p = list[k];
      p.vy -= 9.81 * dt;
      p.y += p.vy * dt;
      if (p.y <= p.to) continue;
      list[n++] = p;
    }
    list.length = n;
    const P = this.dpos;
    for (let k = 0; k < this.dmax; k++) {
      const o = k * 6;
      if (k >= n) {
        P[o + 1] = P[o + 4] = -1000;
        continue;
      }
      const p = list[k];
      const len = Math.min(0.25, 0.02 - p.vy * 0.025); // a streak as long as it is fast
      P[o] = P[o + 3] = p.x;
      P[o + 2] = P[o + 5] = p.z;
      P[o + 1] = p.y;
      P[o + 4] = p.y + len;
    }
    this.dattr.needsUpdate = true;
    this.dripLines.visible = n > 0;
  }

  update(dt, world, weather) {
    const snow = snowShare(weather.ambient);
    // (snow: as many flakes as drops for the same water, they are bigger and slower)
    const all = Math.min(this.max, Math.round((weather.rain / 30) * this.max * (1 + 3 * snow)));
    const nf = Math.round(all * snow);
    const n = all - nf;
    this.lines.visible = n > 0;
    this.flakes.visible = nf > 0;
    if (!world) return;
    this.t += dt;
    this.updateDrips(dt, world);
    if (nf > 0) this.updateFlakes(nf, world, weather);
    if (!n) return;
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

  updateFlakes(n, world, weather) {
    const [sx, sy, sz] = world.size;
    const H = sy * 1.2;
    const speed = 1.0;
    const rad = (weather.windDir * Math.PI) / 180;
    const wx = Math.cos(rad) * weather.windSpeed;
    const wz = Math.sin(rad) * weather.windSpeed;
    const { nx, nz, h, colTop } = world;
    const S = world.snow;
    for (let k = 0; k < n; k++) {
      // (the last flakes of the pool, so that sleet's drops and flakes are different ones)
      const q = this.max - 1 - k;
      const s0 = this.seed[q * 3];
      const s1 = this.seed[q * 3 + 1];
      const s2 = this.seed[q * 3 + 2];
      const fall = ((this.t * speed * (0.8 + 0.4 * s2)) / H + s2) % 1;
      const y = H * (1 - fall);
      const drift = (H - y) / speed;
      const flutter = 0.25 * Math.sin(this.t * (1.3 + s0) + s1 * 40);
      const x = (((s0 * sx + wx * drift + flutter) % sx) + sx) % sx;
      const z = (((s1 * sz + wz * drift + flutter * 0.7) % sz) + sz) % sz;
      const cx = Math.min(nx - 1, Math.floor(x / h));
      const cz = Math.min(nz - 1, Math.floor(z / h));
      let top = colTop ? (colTop[cx + nx * cz] + 1) * h : 0;
      const st = S?.surfaceAt(x, z);
      if (st != null) top = Math.max(top, st);
      const o = q * 3;
      this.fpos[o] = x;
      this.fpos[o + 1] = y < top ? -1000 : y;
      this.fpos[o + 2] = z;
    }
    this.flakes.geometry.setDrawRange(this.max - n, n);
    this.fattr.needsUpdate = true;
  }
}
