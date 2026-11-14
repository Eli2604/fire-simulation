import * as THREE from 'three';
import { lod } from './lod.js';
import { WATER_UNIFORMS } from './waterSurface.js';

/**
 * Running water and what it drives, drawn (sim/river.js; models/islandFall.js, models/mill.js):
 *
 *  - the waterfall: a sheet of water leaving the brink at the speed of the flow there and
 *    falling free (a parabola: x = v·t, y = ½·g·t²), its streaks rushing down, whiter (aerated)
 *    as it falls; its thickness and how much of it there is follow the discharge Q, it thins to
 *    nothing when the stream above is dammed, and stands still, icy, when it is frozen;
 *  - spray and mist rising off its foot (particles: a few hundred close by, fewer further off,
 *    none far away), and a ring of foam on the pool where it lands;
 *  - the river: streaks and flecks of foam on its surface carried downstream at the water's
 *    speed at each station (the simulation's v = Q / A, so fast in a narrow race, slow in the
 *    pool), white water where it pours over each sill and down into the sea; still when it stops;
 *  - water wheels, turning at the simulation's speed (its own angle; off the place you are in,
 *    with the speed it had), with a splash where the paddles meet the water.
 *
 * Level of detail (render/lod.js) by their size on the screen: close by everything, the spray
 * thick; further off thin spray and a simpler wheel; far off the sheet alone, not animated.
 */
export const FALL_LOD = [
  [90, 70],
  [14, 10],
];
export const WHEEL_LOD = [
  [60, 45],
  [8, 6],
];
const G = 9.81;

const NOISE = /* glsl */ `
float wwHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wwNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(wwHash(i), wwHash(i + vec2(1, 0)), u.x), mix(wwHash(i + vec2(0, 1)), wwHash(i + vec2(1, 1)), u.x), u.y);
}
float wwFbm(vec2 p) { return 0.55 * wwNoise(p) + 0.3 * wwNoise(p * 2.1 + 3.7) + 0.15 * wwNoise(p * 4.3 + 1.3); }
`;

/** The brink's speed (m/s) for a discharge Q over a width b: critical flow over a free overfall. */
export function brinkSpeed(Q, b) {
  const q = Math.max(Q, 0.02) / b;
  const yc = Math.cbrt((q * q) / G);
  return { v: q / (0.715 * yc), depth: 0.715 * yc };
}

export class WaterworksRenderer {
  /** live: the place being simulated (wheels at the simulation's angle), else a frozen one. */
  constructor(parent, { live = true } = {}) {
    this.group = new THREE.Group();
    parent.add(this.group);
    this.live = live;
    this.items = [];
    this.wheels = [];
    this.time = 0;
    this.uniforms = { uTime: { value: 0 }, uSun: WATER_UNIFORMS.uWSun, uSunCol: WATER_UNIFORMS.uWSunCol, ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) };
    this.sheetMat = this.waterMaterial('sheet');
    this.ribbonMat = this.waterMaterial('ribbon');
    this.sprayMat = sprayMaterial(this.uniforms);
    const std = (color, roughness = 0.85) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
    this.wood = std(0x5e4129);
    this.wetWood = std(0x3f2b1b, 0.55);
    this.iron = new THREE.MeshStandardMaterial({ color: 0x2c2b2a, roughness: 0.6, metalness: 0.6 });
  }

  setWorld(world) {
    this.clear();
    this.world = world;
    for (const r of world.rivers ?? []) this.items.push(this.buildRiver(world, r));
    for (const m of world.mills ?? []) this.wheels.push(this.buildWheel(m));
  }

  clear() {
    for (const it of this.items) {
      for (const o of [it.sheet, it.ribbon, it.spray?.points]) {
        if (!o) continue;
        this.group.remove(o);
        o.geometry.dispose();
      }
    }
    for (const wh of this.wheels) {
      this.group.remove(wh.root);
      wh.root.traverse((o) => o.geometry?.dispose());
      if (wh.spray) {
        this.group.remove(wh.spray.points);
        wh.spray.points.geometry.dispose();
      }
    }
    this.items = [];
    this.wheels = [];
  }

  /** The water's shader: streaks moving with the flow (two phases blended: no stretching). */
  waterMaterial(kind) {
    const sheet = kind === 'sheet';
    return new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
      vertexShader: /* glsl */ `
        attribute vec4 aFlow; // along (m), across (m), speed (m/s), foam 0..1
        attribute float aIce;
        varying vec4 vFlow;
        varying float vIce;
        #include <fog_pars_vertex>
        void main() {
          vFlow = aFlow;
          vIce = aIce;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uSun;
        uniform vec3 uSunCol;
        varying vec4 vFlow;
        varying float vIce;
        #include <fog_pars_fragment>
        ${NOISE}
        float streaks(vec2 c) { return wwFbm(vec2(c.x * ${sheet ? '0.9' : '1.1'}, c.y * ${sheet ? '7.0' : '3.2'})); }
        void main() {
          float T = 1.6;
          float t = uTime * (1.0 - vIce);
          float p0 = fract(t / T), p1 = fract(t / T + 0.5);
          float w0 = 1.0 - abs(1.0 - 2.0 * p0);
          float sp = vFlow.z;
          float n0 = streaks(vec2(vFlow.x - sp * p0 * T, vFlow.y));
          float n1 = streaks(vec2(vFlow.x - sp * p1 * T + 3.1, vFlow.y + 1.7));
          float n = mix(n1, n0, w0);
          float foam = vFlow.w;
          vec3 white = vec3(0.92, 0.95, 0.97);
          vec3 blue = vec3(0.55, 0.7, 0.78);
          ${
            sheet
              ? `// the falling sheet: glassy at the brink, white and torn further down
          float a = mix(0.55, 0.92, foam) * (0.75 + 0.45 * n);
          vec3 c = mix(blue, white, clamp(foam * 0.8 + n * 0.5 - 0.1, 0.0, 1.0));`
              : `// the river: flecks and lines of foam on clear water, white over the sills
          float lines = smoothstep(0.58, 0.82, n);
          float a = clamp(0.06 + lines * (0.25 + 0.35 * min(sp, 1.5)) + foam * (0.35 + 0.55 * n), 0.0, 0.92);
          vec3 c = mix(blue, white, clamp(0.4 + lines + foam, 0.0, 1.0));`
          }
          // frozen: ice, still, bluish white
          c = mix(c, vec3(0.8, 0.88, 0.95), vIce * 0.7);
          a = mix(a, ${sheet ? '0.85' : '0.0'}, vIce * 0.8);
          float light = 0.28 + 0.72 * clamp(uSun, 0.0, 1.2);
          gl_FragColor = vec4(c * light * mix(vec3(1.0), uSunCol, 0.35), a);
          #include <fog_fragment>
        }`,
    });
  }

  buildRiver(w, r) {
    const it = { r, state: {}, fallState: {}, key: '', sheet: null, ribbon: null, spray: null };
    // the bounds of the river, for its level of detail
    const ps = r.stations.map((s) => s.p);
    const lo = [0, 1, 2].map((k) => Math.min(...ps.map((p) => p[k])));
    const hi = [0, 1, 2].map((k) => Math.max(...ps.map((p) => p[k])));
    it.c = lo.map((v, k) => (v + hi[k]) / 2);
    it.rad = 0.5 * Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
    // the river's surface
    const st = r.stations.filter((s) => s.kind !== 'fall');
    const idx = r.stations.map((s, k) => k).filter((k) => r.stations[k].kind !== 'fall');
    const n = st.length;
    const pos = new Float32Array(n * 2 * 3);
    const flow = new Float32Array(n * 2 * 4);
    const ice = new Float32Array(n * 2);
    const tri = [];
    let along = 0;
    // foam: below each sill and the fall's foot, fading downstream
    let foam = 0;
    const fl = r.fall;
    for (let j = 0; j < n; j++) {
      const s = st[j];
      const prev = st[j - 1];
      if (prev) along += Math.hypot(s.p[0] - prev.p[0], s.p[2] - prev.p[2]);
      const ax = -s.t[2];
      const az = s.t[0];
      const half = s.kind === 'sea' ? s.half * 1.4 : s.half + 0.05;
      // over a sill: the water just over its top; into the sea: at the sea
      const y = s.kind === 'sill' ? s.p[1] + 0.06 : s.kind === 'sea' ? (w.sea?.level ?? s.p[1]) + 0.03 : s.p[1] + 0.012;
      if (s.kind === 'sill' || (prev && prev.kind === 'sill')) foam = 1;
      else if (s.kind === 'pool' && fl) {
        const d = Math.hypot(s.p[0] - fl.pool[0], s.p[2] - fl.pool[2]);
        foam = Math.max(foam * 0.9, d < fl.poolR[0] * 0.8 ? 0.9 : 0);
      } else foam *= 0.86;
      for (const side of [-1, 1]) {
        const v = j * 2 + (side > 0 ? 1 : 0);
        pos[v * 3] = s.p[0] + ax * half * side;
        pos[v * 3 + 1] = y;
        pos[v * 3 + 2] = s.p[2] + az * half * side;
        flow[v * 4] = along;
        flow[v * 4 + 1] = half * side;
        flow[v * 4 + 3] = Math.min(1, foam + (s.kind === 'sea' ? 0.3 : 0));
      }
      if (j > 0) tri.push((j - 1) * 2, j * 2, (j - 1) * 2 + 1, (j - 1) * 2 + 1, j * 2, j * 2 + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aFlow', new THREE.BufferAttribute(flow, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aIce', new THREE.BufferAttribute(ice, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(tri);
    g.computeBoundingSphere();
    it.ribbon = new THREE.Mesh(g, this.ribbonMat);
    it.ribbon.renderOrder = 2;
    it.ribbonIdx = idx;
    this.group.add(it.ribbon);
    if (fl) {
      it.sheet = new THREE.Mesh(new THREE.BufferGeometry(), this.sheetMat);
      it.sheet.renderOrder = 3;
      it.sheet.frustumCulled = false;
      this.group.add(it.sheet);
      it.spray = makeSpray(420, this.sprayMat);
      this.group.add(it.spray.points);
    }
    return it;
  }

  /** The falling sheet for a discharge Q (rebuilt when it changes noticeably). */
  sheetGeometry(it, Q, frozen) {
    const F = it.r.fall;
    const g = it.sheet.geometry;
    const { v: vb, depth } = brinkSpeed(Math.max(Q, 0.05), F.width);
    const tLand = Math.sqrt((2 * F.drop) / G);
    const nb = 9;
    const nt = 22;
    const pos = [];
    const flow = [];
    const ice = [];
    const idx = [];
    // the brink: the water over the lip (from a little upstream), then falling free
    const rows = [];
    rows.push({ a: -0.45, y: depth, t: -1 });
    rows.push({ a: -0.1, y: depth * 0.85, t: -1 });
    for (let k = 0; k <= nt; k++) {
      const t = (k / nt) * tLand;
      rows.push({ a: vb * t, y: depth * 0.6 - 0.5 * G * t * t, t: t / tLand });
    }
    let along = 0;
    rows.forEach((row, j) => {
      if (j > 0) along += Math.hypot(row.a - rows[j - 1].a, row.y - rows[j - 1].y);
      const spread = 1 + 0.12 * Math.max(0, row.t); // (it spreads a little as it falls)
      const sp = row.t < 0 ? vb : Math.hypot(vb, G * row.t * tLand);
      for (let i = 0; i <= nb; i++) {
        const b = ((i / nb) - 0.5) * F.width * spread;
        // (the edges fall a little behind: a sheet torn at its sides)
        const lag = (Math.abs(i / nb - 0.5) * 2) ** 3 * 0.15 * Math.max(0, row.t);
        pos.push(F.lip[0] + F.dir[0] * (row.a - lag) + F.across[0] * b, F.lip[1] + row.y, F.lip[2] + F.dir[2] * (row.a - lag) + F.across[2] * b);
        flow.push(along, b, frozen ? 0 : sp, Math.min(1, Math.max(0, row.t) * 1.2 + (i === 0 || i === nb ? 0.4 : 0)));
        ice.push(frozen ? 1 : 0);
      }
    });
    for (let j = 1; j < rows.length; j++)
      for (let i = 0; i < nb; i++) {
        const a = (j - 1) * (nb + 1) + i;
        const b = j * (nb + 1) + i;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 4));
    g.setAttribute('aIce', new THREE.Float32BufferAttribute(ice, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    it.landing = [F.lip[0] + F.dir[0] * vb * tLand, F.lip[1] + depth * 0.6 - F.drop, F.lip[2] + F.dir[2] * vb * tLand];
    it.vb = vb;
  }

  buildWheel(m) {
    const root = new THREE.Group();
    const spin = new THREE.Group();
    root.add(spin);
    const R = m.radius;
    const W = m.width;
    const n = m.paddles ?? 12;
    const pd = m.paddle ?? 0.35;
    const full = new THREE.Group();
    const simple = new THREE.Group();
    spin.add(full, simple);
    const add = (grp, geo, mat, x = 0, y = 0, z = 0, rz = 0) => {
      const o = new THREE.Mesh(geo, mat);
      o.position.set(x, y, z);
      o.rotation.z = rz;
      o.castShadow = o.receiveShadow = true;
      grp.add(o);
      return o;
    };
    // two rims with iron bands, spokes on each side, the hub, the paddles across between the rims
    for (const z of [-W / 2, W / 2]) {
      add(full, new THREE.TorusGeometry(R - pd * 0.5, 0.06, 6, 40), this.wood, 0, 0, z);
      add(full, new THREE.TorusGeometry(R - pd, 0.035, 5, 40), this.iron, 0, 0, z);
      for (let k = 0; k < 8; k++) add(full, new THREE.BoxGeometry(0.08, R - pd * 0.5, 0.07), this.wood, ((Math.cos((k / 8) * Math.PI * 2) * (R - pd * 0.5)) / 2), ((Math.sin((k / 8) * Math.PI * 2) * (R - pd * 0.5)) / 2), z, (k / 8) * Math.PI * 2 - Math.PI / 2);
      add(simple, new THREE.TorusGeometry(R - pd * 0.5, 0.07, 4, 16), this.wood, 0, 0, z);
    }
    add(full, new THREE.CylinderGeometry(0.2, 0.2, W + 0.1, 12), this.wood, 0, 0, 0, 0).rotation.set(Math.PI / 2, 0, 0);
    const paddle = new THREE.BoxGeometry(pd, 0.04, W);
    const paddleS = new THREE.BoxGeometry(pd, 0.05, W);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const r = R - pd / 2;
      add(full, paddle, this.wetWood, Math.cos(a) * r, Math.sin(a) * r, 0, a);
      add(simple, paddleS, this.wetWood, Math.cos(a) * r, Math.sin(a) * r, 0, a);
    }
    // the axle (it does not turn with... it does: on the wheel)
    add(full, new THREE.CylinderGeometry(0.1, 0.1, W + 0.9, 8), this.iron, 0, 0, 0).rotation.set(Math.PI / 2, 0, 0);
    // oriented: local z along the axle
    root.position.set(...m.p);
    root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...m.axis).normalize());
    this.group.add(root);
    const spray = makeSpray(90, this.sprayMat);
    this.group.add(spray.points);
    return { m, root, spin, full, simple, state: {}, angle: m.angle ?? 0, spray };
  }

  /** Once a frame: dt (s), time (s: the water's clock). */
  update(dt, time) {
    if (!this.world) return;
    this.time = time;
    this.uniforms.uTime.value = time;
    this.sprayMat.uniforms.uScale.value = lod.proj * (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    for (const it of this.items) this.updateRiver(it, dt);
    for (const wh of this.wheels) this.updateWheel(wh, dt);
  }

  updateRiver(it, dt) {
    const r = it.r;
    const w = this.world;
    const F = r.fall;
    const lv = lod.level(it.state, it.c[0], it.c[1], it.c[2], it.rad, FALL_LOD);
    it.level = lv;
    const ice = w.ice;
    // the river's speed and ice into its surface (not far off: it stands still there)
    if (lv <= 1 || !it.primed) {
      it.primed = true;
      const g = it.ribbon.geometry;
      const fa = g.attributes.aFlow;
      const ia = g.attributes.aIce;
      let changed = false;
      it.ribbonIdx.forEach((k, j) => {
        const s = r.stations[k];
        const v = r.v ? r.v[k] : s.kind === 'sea' ? 0.2 : 0.4;
        let frozen = 0;
        if (ice && s.kind !== 'sea' && s.kind !== 'sill') {
          const c = Math.floor(s.p[0] / w.h) + w.nx * Math.floor(s.p[2] / w.h);
          if (c >= 0 && c < ice.thick.length && ice.top[c] !== -1) frozen = Math.min(1, ice.thick[c] / 0.01);
        }
        for (const v2 of [j * 2, j * 2 + 1]) {
          if (Math.abs(fa.array[v2 * 4 + 2] - v) > 0.01 || ia.array[v2] !== frozen) changed = true;
          fa.array[v2 * 4 + 2] = v;
          ia.array[v2] = frozen;
        }
      });
      if (changed) {
        fa.needsUpdate = true;
        ia.needsUpdate = true;
      }
    }
    it.ribbon.visible = lv <= 1;
    if (!F) return;
    // the sheet: as much water as comes over the brink; frozen with the stream above it
    const Q = r.v ? r.fallQ ?? 0 : r.flow;
    let frozen = false;
    if (ice) {
      const c = Math.floor(F.lip[0] / w.h - F.dir[0] * 2) + w.nx * Math.floor(F.lip[2] / w.h - F.dir[2] * 2);
      frozen = c >= 0 && c < ice.thick.length && ice.top[c] !== -1 && ice.thick[c] > 0.05;
    }
    const key = `${Math.round(Math.log(Math.max(Q, 0.01)) * 8)}|${frozen}`;
    if (key !== it.key) {
      it.key = key;
      this.sheetGeometry(it, Q, frozen);
    }
    it.sheet.visible = Q > 0.005 || frozen;
    // spray: only close enough to see it, as much as the fall makes
    const N = lv === 0 ? it.spray.n : lv === 1 ? Math.round(it.spray.n * 0.3) : 0;
    const rate = frozen ? 0 : Math.min(1, Q / 0.6) * N * 0.9; // particles a second (each lives ~1-2 s)
    stepSpray(it.spray, dt, N, rate, () => {
      const b = (Math.random() - 0.5) * F.width * 1.1;
      const p = [it.landing[0] + F.across[0] * b + (Math.random() - 0.5) * 0.4, it.landing[1] + 0.05, it.landing[2] + F.across[2] * b + (Math.random() - 0.5) * 0.4];
      const up = 1.2 + Math.random() * 2.2;
      const out = (Math.random() - 0.3) * 1.6;
      const side = (Math.random() - 0.5) * 1.2;
      return { p, v: [F.dir[0] * out + F.across[0] * side, up, F.dir[2] * out + F.across[2] * side], life: 1.0 + Math.random() * 1.6, size: 0.25 + Math.random() * 0.35 };
    });
  }

  updateWheel(wh, dt) {
    const m = wh.m;
    const R = m.radius;
    const lv = lod.level(wh.state, m.p[0], m.p[1], m.p[2], R * 1.5, WHEEL_LOD);
    wh.root.visible = lv <= 1 && !m.broken;
    wh.full.visible = lv === 0;
    wh.simple.visible = lv === 1;
    // the simulation's angle where it is simulated; else turning at the speed it had
    wh.angle = this.live ? m.angle : wh.angle + (m.omega ?? 0) * dt;
    wh.spin.rotation.z = wh.angle;
    // a splash where the paddles come up out of the water, downstream of the bottom
    const turning = Math.abs(m.omega ?? 0) * R;
    const N = lv === 0 && !m.broken ? wh.spray.n : 0;
    const rate = (m.immersion ?? 0) > 0.02 ? Math.min(1, turning / 1.2) * N * 0.8 : 0;
    const t = [m.axis[2], 0, -m.axis[0]];
    const sgn = Math.sign(m.omega ?? 0) || 1;
    const surf = m.p[1] - R + (m.immersion ?? 0);
    stepSpray(wh.spray, dt, N, rate, () => {
      const zz = (Math.random() - 0.5) * m.width;
      const along = sgn * (0.35 + Math.random() * 0.4) * R;
      const p = [m.p[0] + t[0] * along + m.axis[0] * zz, surf + 0.02, m.p[2] + t[2] * along + m.axis[2] * zz];
      return { p, v: [t[0] * sgn * turning * 0.5, 0.6 + Math.random() * 1.0 * Math.min(1, turning), t[2] * sgn * turning * 0.5], life: 0.4 + Math.random() * 0.5, size: 0.12 + Math.random() * 0.12 };
    });
  }
}

/** Spray and mist: points with a soft round sprite, fading as they age. */
function sprayMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uScale: { value: 400 } },
    transparent: true,
    depthWrite: false,
    fog: true,
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      attribute float aSize;
      uniform float uScale;
      varying float vAlpha;
      #include <fog_pars_vertex>
      void main() {
        vAlpha = aAlpha;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = clamp(aSize * uScale / max(0.1, -mvPosition.z), 1.0, 128.0);
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uSun;
      uniform vec3 uSunCol;
      varying float vAlpha;
      #include <fog_pars_fragment>
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = pow(max(0.0, 1.0 - r), 1.6) * vAlpha;
        if (a < 0.01) discard;
        float light = 0.3 + 0.7 * clamp(uSun, 0.0, 1.2);
        gl_FragColor = vec4(vec3(0.93, 0.95, 0.97) * light * mix(vec3(1.0), uSunCol, 0.3), a);
        #include <fog_fragment>
      }`,
  });
}

function makeSpray(n, mat) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
  g.setDrawRange(0, 0);
  const points = new THREE.Points(g, mat);
  points.frustumCulled = false;
  points.renderOrder = 4;
  return { n, points, parts: [], acc: 0 };
}

/** Age the spray's particles (drag, a little lift for the fine mist), emit new ones at `rate`/s. */
function stepSpray(s, dt, max, rate, emit) {
  dt = Math.min(dt, 0.1);
  s.acc += rate * dt;
  while (s.acc >= 1 && s.parts.length < max) {
    s.acc -= 1;
    s.parts.push({ ...emit(), age: 0 });
  }
  if (s.parts.length >= max) s.acc = 0;
  const g = s.points.geometry;
  const P = g.attributes.position.array;
  const A = g.attributes.aAlpha.array;
  const S = g.attributes.aSize.array;
  let k = 0;
  for (const q of s.parts) {
    q.age += dt;
    if (q.age >= q.life || k >= max) continue;
    // drops fall, the fine mist is held up by the air and drifts
    const drag = Math.exp(-dt * 1.8);
    q.v[0] *= drag;
    q.v[2] *= drag;
    q.v[1] = q.v[1] * drag - 9.81 * 0.35 * dt;
    for (let c = 0; c < 3; c++) q.p[c] += q.v[c] * dt;
    const f = q.age / q.life;
    P[k * 3] = q.p[0];
    P[k * 3 + 1] = q.p[1];
    P[k * 3 + 2] = q.p[2];
    A[k] = 0.5 * (1 - f) * Math.min(1, q.age * 8);
    S[k] = q.size * (1 + 2.5 * f);
    s.parts[k++] = q;
  }
  s.parts.length = k;
  g.setDrawRange(0, k);
  g.attributes.position.needsUpdate = true;
  g.attributes.aAlpha.needsUpdate = true;
  g.attributes.aSize.needsUpdate = true;
}
