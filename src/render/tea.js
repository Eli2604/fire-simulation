import * as THREE from 'three';
import { VERT, FRAG, mistOnMixing } from './breath.js';
import { TEA } from '../sim/tea.js';

/**
 * Cups of tea (sim/tea.js): the porcelain cup on its saucer, the tea in it (lower as it
 * evaporates, a skin of ice on it when it freezes), and its steam: the vapour that leaves
 * the hot surface, saturated, condenses as it mixes into the colder air over it (as a
 * breath does, render/breath.js) — a thin mist indoors, thick wisps in a frost. It rises in
 * the warm plume over the cup, curls, drifts with the wind and evaporates again.
 */
export class TeaRenderer {
  constructor(scene, max = 900) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.items = [];
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.ph = new Float32Array(max);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.n = 0;
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    geo.setAttribute('aAlpha', this.alphaAttr);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 800 }, uColor: { value: new THREE.Color(0.93, 0.94, 0.96) } },
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
    this.light = 1;
  }

  setWorld(world) {
    this.world = world;
    this.group.clear();
    this.items = [];
    this.n = 0;
    this.alpha.fill(0);
    (world.cups ?? []).forEach((c, k) => this.items.push(this.build(c, k)));
  }

  build(c, k) {
    const { r, H } = TEA;
    const g = new THREE.Group();
    const porcelain = new THREE.MeshStandardMaterial({ color: new THREE.Color(c.color ?? '#f1ece2'), roughness: 0.25, metalness: 0.02 });
    // the cup: a lathe, its wall 4 mm thick, its foot a little narrower
    const o = r + 0.004;
    const prof = [
      [0, 0.004], [o * 0.72, 0.004], [o * 0.74, 0], [o * 0.82, 0.002], [o * 0.9, 0.012], [o * 0.97, H * 0.45], [o, H], [r, H], [r * 0.96, H * 0.45], [r * 0.85, 0.012], [0, 0.01],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const cup = new THREE.Mesh(new THREE.LatheGeometry(prof, 28), porcelain);
    cup.position.y = 0.01;
    // the handle
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.019, 0.0045, 6, 14, Math.PI * 1.2), porcelain);
    handle.position.set(o + 0.006, 0.01 + H * 0.55, 0);
    handle.rotation.z = -Math.PI * 0.6;
    // the saucer
    const sprof = [[0, 0], [0.05, 0], [0.068, 0.006], [0.076, 0.012], [0.074, 0.013], [0.064, 0.008], [0.048, 0.004], [0, 0.004]].map(([x, y]) => new THREE.Vector2(x, y));
    const saucer = new THREE.Mesh(new THREE.LatheGeometry(sprof, 32), porcelain);
    // the tea's surface
    const teaMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(c.tea ?? '#7a3d12'), roughness: 0.05, metalness: 0.1 });
    const surf = new THREE.Mesh(new THREE.CircleGeometry(r * 0.97, 24).rotateX(-Math.PI / 2), teaMat);
    g.add(cup, handle, saucer, surf);
    g.rotation.y = 0.7 + k * 2.1; // (the handle, each one its own way)
    for (const m of [cup, handle, saucer]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    this.group.add(g);
    return { c, g, surf, teaMat, tea: new THREE.Color(c.tea ?? '#7a3d12'), m0: Math.max(1e-6, c.m + (c.ice ?? 0)), next: 0 };
  }

  /** `air(p)`: the air there { T, RH, wind } or null; `scale`: the point size scale. */
  update(dt, scale, air, light = 1) {
    this.material.uniforms.uScale.value = scale;
    this.light = light;
    const { r, H } = TEA;
    const iceCol = new THREE.Color(0.86, 0.88, 0.9);
    for (const it of this.items) {
      const c = it.c;
      it.g.visible = !c.broken;
      if (c.broken) continue;
      it.g.position.set(c.p[0], c.p[1], c.p[2]);
      // the tea's level: full to ~1.5 cm under the rim; lower as it evaporates (ice is a little higher)
      const fill = (c.m + (c.ice ?? 0) * 1.09) / it.m0;
      const level = 0.02 + (H - 0.035) * Math.min(1, fill);
      it.surf.position.y = level;
      it.surf.visible = fill > 0.02;
      const iced = (c.ice ?? 0) / Math.max(1e-6, c.m + (c.ice ?? 0));
      it.teaMat.color.copy(it.tea).lerp(iceCol, Math.min(1, iced * 1.4) * 0.55);
      it.teaMat.roughness = 0.05 + 0.5 * iced;
      // its steam
      if (!(c.vapour > 0) || !air) continue;
      const top = [c.p[0], c.p[1] + level + 0.01, c.p[2]];
      const A = air([top[0], top[1] + 0.05, top[2]]);
      if (!A) continue;
      const v = mistOnMixing(A.T, A.RH, c.T);
      if (v < 0.01) continue;
      // wisps a second: as much as it gives off (~1e-5 kg/s hot) — and as much as condenses
      it.next -= dt * Math.min(60, c.vapour * 2.2e6) * Math.min(1, 0.3 + v);
      while (it.next < 0 && this.n < this.max) {
        it.next += 1;
        this.spawn(top, r, v, A, c.T);
      }
      if (it.next < 0) it.next = 0;
    }
    // rise, curl, drift, grow, fade
    let j = 0;
    for (let i = 0; i < this.n; i++) {
      const age = (this.age[i] += dt);
      if (age >= this.life[i]) continue;
      const damp = Math.exp(-dt * 0.8);
      const sw = 0.05 * Math.sin(age * 5 + this.ph[i]);
      this.vel[i * 3] = this.vel[i * 3] * damp + sw * dt * 6;
      this.vel[i * 3 + 2] = this.vel[i * 3 + 2] * damp + 0.05 * Math.cos(age * 4.3 + this.ph[i] * 1.7) * dt * 6;
      this.vel[i * 3 + 1] *= Math.exp(-dt * 0.4);
      for (let k = 0; k < 3; k++) this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt;
      const t = age / this.life[i];
      this.size[i] = this.s0[i] * (1 + 4 * t);
      this.alpha[i] = t <= 0 ? 0 : this.a0[i] * Math.min(1, t * 6) * (1 - t) ** 1.6 * this.light;
      if (j !== i) this.copy(i, j);
      j++;
    }
    for (let i = j; i < this.n; i++) this.alpha[i] = 0;
    this.n = j;
    this.posAttr.needsUpdate = this.sizeAttr.needsUpdate = this.alphaAttr.needsUpdate = true;
    this.points.geometry.setDrawRange(0, Math.max(1, this.n));
  }

  spawn(top, r, v, A, T) {
    const i = this.n++;
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * r * 0.8;
    this.pos[i * 3] = top[0] + Math.cos(a) * d;
    this.pos[i * 3 + 1] = top[1];
    this.pos[i * 3 + 2] = top[2] + Math.sin(a) * d;
    // the warm plume over the cup: faster the hotter it is than the air
    const up = 0.06 + 0.0025 * Math.max(0, T - A.T) * (0.7 + Math.random() * 0.6);
    const wind = A.wind ?? [0, 0, 0];
    this.vel[i * 3] = wind[0] * 0.5 + (Math.random() - 0.5) * 0.03;
    this.vel[i * 3 + 1] = up + (wind[1] ?? 0) * 0.5;
    this.vel[i * 3 + 2] = wind[2] * 0.5 + (Math.random() - 0.5) * 0.03;
    this.age[i] = 0;
    this.life[i] = (0.7 + 2.0 * v) * (0.7 + Math.random() * 0.6);
    this.s0[i] = 0.02 + Math.random() * 0.015;
    this.a0[i] = 0.1 + 0.35 * v;
    this.ph[i] = Math.random() * 10;
    this.alpha[i] = 0;
  }

  copy(i, j) {
    for (let k = 0; k < 3; k++) {
      this.pos[j * 3 + k] = this.pos[i * 3 + k];
      this.vel[j * 3 + k] = this.vel[i * 3 + k];
    }
    this.age[j] = this.age[i];
    this.life[j] = this.life[i];
    this.s0[j] = this.s0[i];
    this.a0[j] = this.a0[i];
    this.ph[j] = this.ph[i];
    this.size[j] = this.size[i];
    this.alpha[j] = this.alpha[i];
  }
}
