import * as THREE from 'three';

/**
 * Draws the phoenix (ai/phoenix.js) and the jailer's keys.
 *
 * A bird of fire, shaped like a big bird of prey (about 1.6 m across the wings):
 *  - Every feather is a flame: white-gold at the root, orange along the vane, and
 *    crimson at the tip, where it breaks up into tongues of fire that lick and
 *    flutter (a shader on each feather: the outline, barbs and shaft, and the
 *    flicker run on the GPU). They glow (additive light, no shading).
 *  - The wings are built like a bird's: arm, forearm and hand, each carrying its
 *    feathers (tertials, secondaries, primaries fanned out at the tip, coverts over
 *    them). They beat (the wrist flexes on the upstroke) and fold along the back
 *    when it sits.
 *  - A long train of flame streamers for a tail, a crest of fire on the head, a
 *    golden hooked beak, white-hot eyes. The body is a core of fire with scalloped
 *    feathering, hottest where you look straight at it, red at its rim.
 *  - It sheds flames and sparks (the scene's flame particles) from its wing tips
 *    and tail, more in flight, and lights the passages round it (a flickering
 *    point light that casts shadows: the bars of its cell on the walls).
 *  - Killed: a burst of fire, then a heap of glowing ash; born again from it,
 *    growing out of the flames.
 */

const S = 0.8; // overall size

const NOISE = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
`;

const FEATHER_VERT = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uFlutter;
  varying vec2 vUv;
  varying float vSeed;
  void main() {
    vUv = uv;
    vSeed = aSeed;
    vec3 p = position;
    float u = uv.x;
    // the tip licks and flutters like a flame
    p.y += sin(uTime * 9.0 + aSeed * 6.283 - u * 6.0) * 0.05 * u * u * uFlutter;
    p.x += sin(uTime * 6.3 + aSeed * 4.1 - u * 4.0) * 0.025 * u * u * uFlutter;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const FEATHER_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uHeat;
  varying vec2 vUv;
  varying float vSeed;
  ${NOISE}
  void main() {
    float u = vUv.x;
    float v = vUv.y * 2.0 - 1.0;
    float n = noise(vec2(u * 7.0 - uTime * 3.5, v * 2.5 + vSeed * 13.0));
    float n2 = noise(vec2(u * 15.0 - uTime * 6.0, v * 5.0 - vSeed * 7.0));
    // the outline: a broad vane narrowing to a point, torn into tongues of fire at the tip
    float width = sqrt(max(0.0, 1.0 - u)) * mix(1.0, 0.45 + 0.9 * n, smoothstep(0.35, 1.0, u)) + 0.04;
    float edge = 1.0 - smoothstep(width * 0.65, width, abs(v));
    // barbs slanting to the tip, and the bright shaft
    float barbs = 0.72 + 0.28 * sin(u * 46.0 - abs(v) * 16.0 + vSeed * 9.0);
    float shaft = exp(-abs(v) * 28.0) * (1.0 - u) * 0.9;
    // colour: white-gold at the root, orange, crimson at the tip
    float t = u + 0.22 * (n2 - 0.5);
    vec3 c = mix(vec3(1.0, 0.93, 0.62), vec3(1.0, 0.5, 0.07), smoothstep(0.05, 0.5, t));
    c = mix(c, vec3(0.75, 0.08, 0.02), smoothstep(0.5, 1.0, t));
    c += shaft * vec3(1.0, 0.85, 0.5);
    float a = edge * barbs * (1.0 - smoothstep(0.78, 1.02, u + 0.25 * (n - 0.5)));
    a *= 0.6 + 0.4 * n2;
    gl_FragColor = vec4(c * uHeat * 1.6, a);
  }
`;

const BODY_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vP;
  void main() {
    vP = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const BODY_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uHeat;
  uniform vec3 uCore;
  uniform vec3 uRim;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vP;
  ${NOISE}
  void main() {
    float facing = abs(dot(normalize(vN), normalize(vV)));
    float rim = pow(1.0 - facing, 1.6);
    // rows of small feathers, scalloped, overlapping towards the tail
    float row = fract(vP.z * 26.0 + 0.35 * sin(vP.x * 70.0));
    float scallop = smoothstep(0.0, 0.25, row) * (1.0 - 0.45 * smoothstep(0.6, 1.0, row));
    float n = noise(vP.xz * 40.0 + vec2(0.0, uTime * 5.0)) * 0.6 + noise(vP.xy * 22.0 - vec2(uTime * 2.0, 0.0)) * 0.4;
    vec3 c = mix(uCore, uRim, clamp(rim + 0.35 * (1.0 - scallop) + 0.2 * (n - 0.5), 0.0, 1.0));
    gl_FragColor = vec4(c * uHeat * (0.75 + 0.5 * n), 1.0);
  }
`;

/** A feather lying in its frame's xz plane, root at the origin, pointing along -z. */
function featherGeometry(L, W, seed, segs = 8) {
  const g = new THREE.BufferGeometry();
  const pos = [];
  const uv = [];
  const sd = [];
  const idx = [];
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    for (let j = 0; j <= 2; j++) {
      const v = j / 2;
      pos.push((v - 0.5) * W, 0, -u * L);
      uv.push(u, v);
      sd.push(seed);
    }
  }
  for (let i = 0; i < segs; i++)
    for (let j = 0; j < 2; j++) {
      const a = i * 3 + j;
      idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
    }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(sd, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** A soft round glow (canvas; none without a DOM, as in the tests). */
let glowTex = null;
function glowTexture() {
  if (glowTex !== null) return glowTex;
  if (typeof document === 'undefined' || typeof document.createElement('canvas').getContext !== 'function') return (glowTex = undefined);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,230,170,1)');
  gr.addColorStop(0.25, 'rgba(255,150,40,0.55)');
  gr.addColorStop(0.6, 'rgba(220,60,10,0.15)');
  gr.addColorStop(1, 'rgba(120,20,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

const lerp = (a, b, t) => a + (b - a) * t;

export class PhoenixRenderer {
  constructor(root, flames) {
    this.root = root;
    this.flames = flames;
    this.group = new THREE.Group();
    root.add(this.group);
    this.birds = [];
    this.keyMeshes = [];
    this.uniforms = { uTime: { value: 0 }, uHeat: { value: 1 }, uFlutter: { value: 1 } };
    this.featherMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: FEATHER_VERT,
      fragmentShader: FEATHER_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.bodyMat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.uniforms.uTime, uHeat: this.uniforms.uHeat, uCore: { value: new THREE.Color(2.4, 1.9, 1.0) }, uRim: { value: new THREE.Color(1.5, 0.32, 0.04) } },
      vertexShader: BODY_VERT,
      fragmentShader: BODY_FRAG,
    });
    this.goldMat = new THREE.MeshStandardMaterial({ color: 0xd8a040, emissive: 0xff8a20, emissiveIntensity: 1.2, metalness: 0.6, roughness: 0.35 });
    this.eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.8, 2.2) });
    this.ashMat = new THREE.MeshStandardMaterial({ color: 0x2a2624, roughness: 1, emissive: 0xff4a10, emissiveIntensity: 0.6 });
    this.ironMat = new THREE.MeshStandardMaterial({ color: 0x5a5148, metalness: 0.75, roughness: 0.45 });
    this._v = new THREE.Vector3();
  }

  feather(parent, L, W, at, rotY, rotX = 0) {
    const m = new THREE.Mesh(featherGeometry(L, W, Math.random()), this.featherMat);
    m.position.set(...at);
    m.rotation.set(rotX, rotY, 0, 'YXZ');
    m.renderOrder = 2;
    m.frustumCulled = false; // they flutter out of their bounds
    parent.add(m);
    return m;
  }

  /** One phoenix: body, head, wings, tail, legs, light, the heap of ash. */
  build() {
    const b = { g: new THREE.Group(), wings: [], tips: [] };
    const body = new THREE.Group();
    body.scale.setScalar(S);
    b.g.add(body);
    b.body = body;
    // the body of fire, neck, head, beak, eyes
    const ell = (r, at, mat = this.bodyMat) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), mat);
      m.scale.set(...r);
      m.position.set(...at);
      body.add(m);
      return m;
    };
    ell([0.13, 0.12, 0.25], [0, 0, 0]);
    ell([0.075, 0.095, 0.11], [0, 0.11, 0.2]).rotation.x = -0.6;
    b.head = new THREE.Group();
    b.head.position.set(0, 0.2, 0.29);
    body.add(b.head);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.075, 18, 12), this.bodyMat);
    head.scale.set(1, 0.95, 1.15);
    b.head.add(head);
    // a hooked beak: upper mandible curving down over the lower
    b.beak = new THREE.Group();
    b.beak.position.set(0, -0.005, 0.075);
    b.head.add(b.beak);
    const upper = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.1, 10), this.goldMat);
    upper.rotation.x = Math.PI / 2 + 0.35;
    upper.position.set(0, 0.0, 0.04);
    b.beak.add(upper);
    b.lower = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.07, 8), this.goldMat);
    b.lower.rotation.x = Math.PI / 2 - 0.1;
    b.lower.position.set(0, -0.02, 0.03);
    b.beak.add(b.lower);
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.013, 8, 6), this.eyeMat);
      e.position.set(s * 0.05, 0.02, 0.04);
      b.head.add(e);
    }
    // the crest: flames rising back from the crown
    for (let k = 0; k < 5; k++) this.feather(b.head, 0.2 + 0.06 * (2 - Math.abs(k - 2)), 0.05, [(k - 2) * 0.012, 0.05, -0.01], (k - 2) * 0.16, 0.75 - Math.abs(k - 2) * 0.08);
    // breast and back: short feathers over the body, overlapping to the tail
    for (let k = 0; k < 6; k++) this.feather(body, 0.22, 0.12, [((k % 3) - 1) * 0.07, 0.1 - Math.floor(k / 3) * 0.06, 0.12 - Math.floor(k / 3) * 0.12], ((k % 3) - 1) * 0.3, 0.15);
    // the tail: a long train of flame streamers, and the coverts over its root
    b.tail = new THREE.Group();
    b.tail.position.set(0, 0.0, -0.22);
    body.add(b.tail);
    for (let k = 0; k < 7; k++) {
      const c = k - 3;
      const L = 1.15 - Math.abs(c) * 0.12;
      b.tips.push({ obj: this.tip(this.feather(b.tail, L, 0.12, [c * 0.02, 0, 0], c * 0.12, -0.05), L), tail: true });
    }
    for (let k = 0; k < 4; k++) this.feather(b.tail, 0.36, 0.1, [(k - 1.5) * 0.03, 0.03, 0.04], (k - 1.5) * 0.25, 0.05);
    // the wings (each in a frame mirrored to its side)
    for (const s of [-1, 1]) {
      const root = new THREE.Group();
      root.position.set(s * 0.1, 0.07, 0.06);
      root.scale.x = s;
      body.add(root);
      const arm = new THREE.Group();
      root.add(arm);
      const forearm = new THREE.Group();
      forearm.position.x = 0.17;
      arm.add(forearm);
      const hand = new THREE.Group();
      hand.position.x = 0.19;
      forearm.add(hand);
      const wing = { root, arm, forearm, hand, feathers: [] };
      // folded, each segment's frame turns (arm back, forearm forward, hand back): its
      // feathers turn the other way to lie along the body, pointing to the tail
      const add = (seg, foldYaw, L, W, x, spreadYaw, y = 0, tip = false) => {
        const m = this.feather(seg, L, W, [x, y, 0], spreadYaw);
        wing.feathers.push({ m, spread: spreadYaw, fold: foldYaw });
        if (tip) b.tips.push({ obj: this.tip(m, L) });
      };
      for (let k = 0; k < 4; k++) add(arm, -FOLD.arm, 0.3, 0.1, 0.03 + k * 0.045, -0.02 * k);
      for (let k = 0; k < 6; k++) add(forearm, -(FOLD.arm + FOLD.forearm), 0.4, 0.1, 0.0 + k * 0.035, -0.04 - 0.03 * k);
      for (let k = 0; k < 6; k++) add(hand, -(FOLD.arm + FOLD.forearm + FOLD.hand), 0.42 + 0.02 * k, 0.09, 0.02 + k * 0.016, -0.45 - k * 0.15, 0, k === 5 || k === 3);
      for (let k = 0; k < 5; k++) add(forearm, -(FOLD.arm + FOLD.forearm), 0.17, 0.09, 0.0 + k * 0.045, -0.1, 0.012);
      for (let k = 0; k < 3; k++) add(arm, -FOLD.arm, 0.15, 0.09, 0.03 + k * 0.05, -0.05, 0.012);
      b.wings.push(wing);
    }
    // legs, tucked in flight, gripping the perch when it sits
    b.legs = new THREE.Group();
    body.add(b.legs);
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.26, 6), this.goldMat);
      leg.position.set(s * 0.05, -0.2, 0.02);
      b.legs.add(leg);
      for (const a of [-0.5, 0, 0.5, Math.PI]) {
        const toe = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.07, 5), this.goldMat);
        toe.rotation.set(Math.PI / 2, 0, 0);
        toe.rotation.y = a;
        toe.position.set(s * 0.05 + Math.sin(a) * 0.02, -0.33, 0.02 + Math.cos(a) * 0.02);
        b.legs.add(toe);
      }
    }
    // its own light: a fire you can see by, and its glow
    b.light = new THREE.PointLight(0xff9440, 0, 11, 1.6);
    b.light.castShadow = true;
    b.light.shadow.mapSize.set(512, 512);
    b.light.shadow.camera.near = 0.05;
    b.light.shadow.camera.far = 9;
    b.light.shadow.bias = -0.003;
    b.light.shadow.normalBias = 0.02;
    b.light.shadow.radius = 3;
    this.group.add(b.light);
    const tex = glowTexture();
    if (tex) {
      b.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: new THREE.Color(1.2, 0.9, 0.6) }));
      b.glow.scale.setScalar(2.2);
      b.glow.renderOrder = 1;
      this.group.add(b.glow);
    }
    // the heap of ash it falls to
    b.ash = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), this.ashMat);
    b.ash.scale.y = 0.35;
    b.ash.visible = false;
    this.group.add(b.ash);
    this.group.add(b.g);
    return b;
  }

  /** An empty at the tip of a feather (where flames are shed). */
  tip(m, L) {
    const o = new THREE.Object3D();
    o.position.set(0, 0, -L * 0.85);
    m.add(o);
    return o;
  }

  /** A ring of three old iron keys. */
  keyRing() {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.005, 6, 18), this.ironMat);
    g.add(ring);
    for (let k = 0; k < 3; k++) {
      const key = new THREE.Group();
      key.rotation.z = -0.5 + k * 0.45;
      const bow = new THREE.Mesh(new THREE.TorusGeometry(0.013, 0.004, 5, 12), this.ironMat);
      bow.position.y = -0.045;
      const shank = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.08, 5), this.ironMat);
      shank.position.y = -0.095;
      const bit = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.014, 0.004), this.ironMat);
      bit.position.set(0.009, -0.125, 0);
      key.add(bow, shank, bit);
      g.add(key);
    }
    this.group.add(g);
    return g;
  }

  update(world, time, dt = 1 / 60) {
    const list = world?.phoenixes ?? [];
    this.uniforms.uTime.value = time;
    while (this.birds.length < list.length) this.birds.push(this.build());
    this.birds.forEach((b, k) => {
      const f = list[k];
      const shown = !!f?.pos && f.state !== 'free' && f.pos[1] < (world.size?.[1] ?? 99) + 2;
      b.g.visible = shown && f.state !== 'ashes';
      b.light.visible = shown;
      if (b.glow) b.glow.visible = b.g.visible;
      b.ash.visible = shown && (f.state === 'ashes' || f.state === 'reborn');
      if (!shown) return;
      this.pose(b, f, time, dt);
    });
    this.updateKeys(world, time);
  }

  pose(b, f, time, dt) {
    const g = b.g;
    // in the ashes, then growing out of the flames again
    let grow = 1;
    if (f.state === 'reborn') grow = Math.min(1, 0.15 + (f.t / 2.2) * 0.85);
    g.position.set(f.pos[0], f.pos[1], f.pos[2]);
    g.rotation.set(-f.pitch, f.yaw, -f.bank, 'YXZ');
    g.scale.setScalar(grow);
    const hurt = f.hurtFlash > 0 ? 1 + f.hurtFlash * 4 : 1;
    this.uniforms.uHeat.value = hurt * (f.state === 'reborn' ? 1.6 : 1);
    // the wings: spread and beating, or folded along the back
    const s = f.wing ?? 0;
    const ph = f.flap ?? 0;
    const beat = (f.flapRate ?? 0) > 0 ? 1 : 0;
    const up = Math.sin(ph);
    const flex = Math.max(0, Math.cos(ph)); // the upstroke: the wrist bends, the wing shortens
    for (const w of b.wings) {
      w.arm.rotation.set(0, lerp(FOLD.arm, 0.12 + 0.25 * flex * beat, s), lerp(-0.3, 0.12 + 0.8 * up * beat, s), 'YXZ');
      w.forearm.rotation.set(0, lerp(FOLD.forearm, 0.35 * flex * beat, s), lerp(0, 0.15 * Math.sin(ph - 0.6) * beat, s), 'YXZ');
      w.hand.rotation.set(0, lerp(FOLD.hand, -0.05 + 0.45 * flex * beat, s), lerp(0, 0.3 * Math.sin(ph - 1.0) * beat, s), 'YXZ');
      for (const fe of w.feathers) fe.m.rotation.y = lerp(fe.fold, fe.spread, s);
    }
    // the tail: trailing in flight, hanging down when it sits; the crest and the head
    const sitting = 1 - s;
    b.tail.rotation.set(lerp(0.05 + 0.08 * Math.sin(time * 2), -0.55, sitting), 0.12 * Math.sin(time * 1.3), 0);
    b.legs.visible = sitting > 0.4 || f.state === 'caged';
    b.legs.rotation.x = lerp(1.3, 0, sitting);
    if (f.look) {
      // turn the head to look (it is on a long neck: up to ~70° each way)
      const lx = f.look[0] - f.pos[0];
      const lz = f.look[2] - f.pos[2];
      const rel = Math.atan2(Math.sin(Math.atan2(lx, lz) - f.yaw), Math.cos(Math.atan2(lx, lz) - f.yaw));
      const want = Math.max(-1.2, Math.min(1.2, rel));
      b.head.rotation.y = lerp(b.head.rotation.y, want, Math.min(1, dt * 6));
      const pitch = Math.atan2(f.look[1] - f.pos[1] - 0.2, Math.hypot(lx, lz));
      b.head.rotation.x = lerp(b.head.rotation.x, -Math.max(-0.6, Math.min(0.6, pitch)), Math.min(1, dt * 6));
    } else {
      b.head.rotation.y = lerp(b.head.rotation.y, 0.3 * Math.sin(time * 0.7), Math.min(1, dt * 2));
      b.head.rotation.x = lerp(b.head.rotation.x, 0, Math.min(1, dt * 2));
    }
    b.lower.rotation.x = Math.PI / 2 - 0.1 + ((f.callT ?? 0) > 0 ? 0.5 : 0); // the beak opens to call
    this.uniforms.uFlutter.value = 0.6 + 0.6 * s;
    // its light: flickering, brighter as it flies; low and red from the ash
    const flick = 0.85 + 0.15 * Math.sin(time * 17) * Math.sin(time * 9.3 + 1);
    const L = b.light;
    if (f.state === 'ashes') {
      const burst = Math.max(0, 1 - f.t / 2.5);
      L.position.set(f.ash[0], f.ash[1] + 0.4 + burst, f.ash[2]);
      L.intensity = (1.2 * Math.max(0.2, 1 - f.t / 12) + 25 * burst) * flick;
      L.color.setHex(burst > 0.2 ? 0xffa050 : 0xff5020);
      b.ash.position.set(f.ash[0], f.ash[1], f.ash[2]);
      this.ashMat.emissiveIntensity = 0.4 + 0.6 * Math.abs(Math.sin(time * 2.1)) * Math.max(0.3, 1 - f.t / 12);
      this.shed(f.ash, burst, true);
    } else {
      L.position.set(f.pos[0], f.pos[1] + 0.15, f.pos[2]);
      L.intensity = (4.5 + 2.5 * s) * flick * (f.state === 'reborn' ? 2 : 1) * hurt;
      L.color.setHex(0xff9440);
      if (f.state === 'reborn') {
        b.ash.position.set(f.ash[0], f.ash[1], f.ash[2]);
        this.shed(f.ash, 0.5, true);
      }
      if (b.glow) {
        b.glow.position.set(f.pos[0], f.pos[1] + 0.05, f.pos[2]);
        b.glow.scale.setScalar((1.4 + 1.1 * s) * grow * flick);
      }
      // flames from the tips of the wings and the tail, more in flight
      const rate = (f.state === 'caged' && s < 0.3 ? 14 : 45) * dt;
      for (const t of b.tips) {
        if (Math.random() > rate / b.tips.length * 6) continue;
        t.obj.getWorldPosition(this._v);
        this.root.worldToLocal(this._v);
        const v = f.vel ?? [0, 0, 0];
        if (this.flames) this.flames.spawn(this._v.x, this._v.y, this._v.z, v[0] * 0.3 + (Math.random() - 0.5) * 0.3, 0.5 + Math.random() * 0.5, v[2] * 0.3 + (Math.random() - 0.5) * 0.3, 0.25 + Math.random() * 0.25, 0.09 + Math.random() * 0.08, 0, 0.8);
        if (this.flames && Math.random() < 0.08) this.flames.spawn(this._v.x, this._v.y, this._v.z, (Math.random() - 0.5) * 1.2, 0.8 + Math.random(), (Math.random() - 0.5) * 1.2, 0.8 + Math.random() * 0.8, 0.02, 1, 1);
      }
    }
  }

  /** The burst of fire when it dies, embers on the ash, the flames it is born from. */
  shed(p, amount, ash) {
    if (!this.flames) return;
    const n = Math.round(amount * 14 + (ash ? 0.4 : 0) + Math.random() * 0.6);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.3;
      this.flames.spawn(p[0] + Math.cos(a) * r, p[1] + 0.05 + Math.random() * 0.2, p[2] + Math.sin(a) * r, Math.cos(a) * 0.4, 1.2 + amount * 2.5 * Math.random(), Math.sin(a) * 0.4, 0.4 + amount * 0.6, 0.12 + amount * 0.25, 0, 1);
    }
    if (Math.random() < 0.15) this.flames.spawn(p[0], p[1] + 0.05, p[2], (Math.random() - 0.5) * 0.6, 0.6 + Math.random(), (Math.random() - 0.5) * 0.6, 1.2, 0.02, 1, 1);
  }

  /** The jailer's keys: at his belt while he lives, on the floor where he dropped them. */
  updateKeys(world, time) {
    const spots = [];
    for (const e of world?.enemies ?? []) {
      if (!e.key || e.dead || e.devoured) continue;
      const yaw = e.yaw ?? 0;
      // at the right hip, swinging as he walks
      spots.push({ p: [e.p[0] + Math.cos(yaw) * -0.2 + Math.sin(yaw) * 0.02, e.p[1] + 0.9, e.p[2] - Math.sin(yaw) * -0.2 + Math.cos(yaw) * 0.02], yaw, swing: e.moving ? 0.3 * Math.sin((e.walkPhase ?? 0) * 2) : 0 });
    }
    for (const pk of world?.pickups ?? []) if (pk.type === 'key' && !pk.taken) spots.push({ p: pk.p, yaw: 0.7, floor: true });
    while (this.keyMeshes.length < spots.length) this.keyMeshes.push(this.keyRing());
    this.keyMeshes.forEach((m, k) => {
      const s = spots[k];
      m.visible = !!s;
      if (!s) return;
      m.position.set(s.p[0], s.p[1] + (s.floor ? 0.01 : 0), s.p[2]);
      if (s.floor) m.rotation.set(-Math.PI / 2, 0, s.yaw);
      else m.rotation.set(s.swing, s.yaw + Math.PI / 2, 0, 'YXZ');
    });
    void time;
  }
}

/** The folded wing: arm swept back, forearm forward, hand back (a Z along the flank). */
const FOLD = { arm: 1.25, forearm: -2.45, hand: 2.25 };
