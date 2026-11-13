/**
 * The rig's vehicles as meshes with moving parts. The car is drawn from its simulation model
 * (models/car.js: the same boxes and wheels its voxels are made of), the jet is render/jetMesh.js
 * (the one that flies) with flaps added, the boat is the island's rowing-boat size with a small
 * cabin and an outboard (the island's boats are only voxels). Frame: front +x, left -z, up +y.
 * Each returns { group, ..., dispose() } (dispose frees its geometries and materials).
 */
import * as THREE from 'three';
import car from '../models/car.js';
import { buildJetMesh } from '../render/jetMesh.js';

/** Frees every geometry and material under `o`. */
export function disposeTree(o) {
  const mats = new Set();
  o.traverse((m) => {
    m.geometry?.dispose();
    for (const x of [m.material].flat()) if (x) mats.add(x);
  });
  for (const m of mats) {
    m.map?.dispose();
    m.dispose();
  }
}

const shadow = (m) => ((m.castShadow = m.receiveShadow = true), m);
const rgb = (c) => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);

/* ---------------------------------------------------------------- the car */
export function buildCarMesh(params = {}) {
  const p = Object.fromEntries(Object.entries(car.params).map(([k, s]) => [k, params[k] ?? s.value]));
  const { prims } = car.build(p, { h: 0.05 });
  const L = p.length;
  const W = p.width;
  const group = new THREE.Group();
  const body = new THREE.Group(); // (sways on its springs; the wheels stay)
  group.add(body);
  const paint = new THREE.MeshStandardMaterial({ color: p.bodyColor, metalness: 0.4, roughness: 0.38 });
  const mats = {
    glass: new THREE.MeshStandardMaterial({ color: 0x223038, metalness: 0.6, roughness: 0.05, transparent: true, opacity: 0.45, depthWrite: false }),
    foam: new THREE.MeshStandardMaterial({ color: p.upholstery, roughness: 0.9 }),
    plastic: new THREE.MeshStandardMaterial({ color: 0x1d1e20, roughness: 0.7 }),
    aluminium: new THREE.MeshStandardMaterial({ color: 0x9a9da0, metalness: 0.8, roughness: 0.35 }),
    fabric: new THREE.MeshStandardMaterial({ color: 0x333438, roughness: 1 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x111112, roughness: 0.95 }),
  };
  const boxes = [];
  const wheels = new Map();
  for (const q of prims) {
    if (q.mode === 'carve' || q.vesselRole === 'contents') continue;
    if (q.shape === 'cylinder') {
      // a tyre and its rim: one wheel per corner
      const key = `${q.a[0]},${Math.sign(q.b[2])}`;
      if (!wheels.has(key)) wheels.set(key, { x: q.a[0], s: Math.sign(q.b[2]), z: (q.a[2] + q.b[2]) / 2, w: Math.abs(q.b[2] - q.a[2]), r: q.r, rim: null });
      if (q.material === 'aluminium') wheels.get(key).rim = q.r;
      else wheels.get(key).r = q.r;
      continue;
    }
    if (q.shape !== 'box') continue;
    // a box inside one already drawn: the same stuff is that box (a lid, the firewall); other stuff sits just proud of it
    const outer = boxes.find((b) => [0, 1, 2].every((i) => q.min[i] >= b.min[i] - 1e-6 && q.max[i] <= b.max[i] + 1e-6));
    if (outer && outer.material === q.material && !q.vessel) continue;
    const e = outer ? 0.003 : 0;
    const size = [0, 1, 2].map((i) => q.max[i] - q.min[i] + 2 * e);
    const m = q.material === 'steel' ? (q.color ? paint : mats.aluminium) : q.material === 'plastic' && q.color ? new THREE.MeshStandardMaterial({ color: rgb(q.color), roughness: 0.7 }) : mats[q.material] ?? mats.plastic;
    const mesh = shadow(new THREE.Mesh(new THREE.BoxGeometry(...size), m));
    mesh.position.set((q.min[0] + q.max[0]) / 2, (q.min[1] + q.max[1]) / 2, (q.min[2] + q.max[2]) / 2);
    if (m === mats.glass) mesh.castShadow = false;
    body.add(mesh);
    boxes.push({ ...q, mesh });
  }
  const glass = boxes.filter((b) => b.material === 'glass').map((b) => b.mesh);
  // lights, the grille, the doors (their own meshes: they open)
  const belt = 0.95;
  const floor = 0.28;
  const cx1 = L * 0.2;
  const lamp = (x, z, c, em) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.3), new THREE.MeshStandardMaterial({ color: c, emissive: em, emissiveIntensity: 0.6 }));
    m.position.set(x, 0.76, z);
    body.add(m);
  };
  for (const s of [-1, 1]) {
    lamp(L / 2 + 0.01, s * (W / 2 - 0.28), 0xfff4d8, 0x665c40);
    lamp(-L / 2 - 0.01, s * (W / 2 - 0.25), 0xb3221a, 0x400806);
  }
  const grille = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.26, W - 0.9), mats.plastic);
  grille.position.set(L / 2 + 0.01, 0.68, 0);
  body.add(grille);
  const doorMat = paint.clone();
  doorMat.color.multiplyScalar(0.94);
  const doors = [-1, 1].map((s) => {
    const pivot = new THREE.Group();
    pivot.position.set(cx1 - 0.03, 0, s * (W / 2 + 0.025));
    const panel = shadow(new THREE.Mesh(new THREE.BoxGeometry(1.0, belt - floor - 0.06, 0.04), doorMat));
    panel.position.set(-0.5, (belt + floor) / 2, 0);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.03), mats.aluminium);
    handle.position.set(-0.85, belt - 0.12, s * 0.03);
    pivot.add(panel, handle);
    pivot.userData.side = s;
    body.add(pivot);
    return pivot;
  });
  // the wheels: a spin group in a steer group
  const wheelList = [];
  for (const wl of wheels.values()) {
    const steer = new THREE.Group();
    steer.position.set(wl.x, wl.r, wl.z);
    const spin = new THREE.Group();
    const tyre = shadow(new THREE.Mesh(new THREE.CylinderGeometry(wl.r, wl.r, wl.w, 24).rotateX(Math.PI / 2), mats.rubber));
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(wl.rim ?? wl.r * 0.6, wl.rim ?? wl.r * 0.6, wl.w + 0.02, 10).rotateX(Math.PI / 2), mats.aluminium);
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(wl.r * 1.1, 0.06, wl.w + 0.03), mats.plastic);
    spin.add(tyre, rim, spoke);
    steer.add(spin);
    group.add(steer);
    wheelList.push({ steer, spin, front: wl.x > 0, side: wl.s, r: wl.r, x: wl.x });
  }
  return { group, body, paint, doors, wheels: wheelList, glass, dims: [L, p.height, W], params: p, dispose: () => disposeTree(group) };
}

/* ---------------------------------------------------------------- the jet */
export function buildJet(params = {}) {
  const j = buildJetMesh(params.color ?? '#7a8590', params.rockets ?? 4);
  // flaps on the inner trailing edge of each wing, hinged at their front edge
  const flaps = [];
  for (const [s, wing] of [[-1, j.parts.wingL], [1, j.parts.wingR]]) {
    wing.geometry.computeBoundingBox();
    const bb = wing.geometry.boundingBox;
    const hinge = new THREE.Group();
    hinge.position.set(-3.45, (bb.min.y + bb.max.y) / 2, s * 2.75);
    const flap = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.62, bb.max.y - bb.min.y + 0.015, 2.3), wing.material));
    flap.position.x = -0.31;
    hinge.add(flap);
    j.group.add(hinge);
    flaps.push(hinge);
  }
  // the afterburner's light
  const glow = new THREE.PointLight(0xff9a40, 0, 14, 2);
  glow.position.set(-8.2, 1.55, 0);
  j.group.add(glow);
  return { ...j, flaps, glow, dims: [17.4, 4.5, 11.2], dispose: () => disposeTree(j.group) };
}

/* ---------------------------------------------------------------- the boat */
/** An open hull: sections [x, half-beam, depth below the gunwale], bottom half-rings joined. */
function hullGeometry(sections, gun, n = 14) {
  const pos = [];
  const idx = [];
  for (const [x, w, d] of sections)
    for (let k = 0; k <= n; k++) {
      const a = Math.PI * (k / n); // 0: starboard gunwale … π: port gunwale
      const c = Math.cos(a);
      const s = Math.sin(a);
      pos.push(x, gun - Math.abs(s) ** 0.55 * d, Math.sign(c) * Math.abs(c) ** 0.8 * w);
    }
  for (let i = 0; i + 1 < sections.length; i++)
    for (let k = 0; k < n; k++) {
      const a = i * (n + 1) + k;
      const b = a + n + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  // the transom (stern): a fan from its middle
  const c0 = pos.length / 3;
  pos.push(sections[0][0], gun - sections[0][2] * 0.5, 0);
  for (let k = 0; k < n; k++) idx.push(c0, k + 1, k);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function buildBoatMesh(params = {}) {
  const group = new THREE.Group(); // (heave, pitch and roll on the waves)
  const gun = 0.55;
  const sections = [[-2.4, 0.84, 0.85], [-1.6, 0.92, 0.97], [-0.4, 0.92, 1.0], [0.8, 0.85, 0.95], [1.6, 0.62, 0.82], [2.1, 0.34, 0.66], [2.42, 0.03, 0.42]];
  const hullMat = new THREE.MeshStandardMaterial({ color: params.color ?? '#b3332a', roughness: 0.55, side: THREE.DoubleSide });
  const hull = shadow(new THREE.Mesh(hullGeometry(sections, gun), hullMat));
  group.add(hull);
  const wood = new THREE.MeshStandardMaterial({ color: 0x9a7a52, roughness: 0.85 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe9e6dc, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1f2124, roughness: 0.6, metalness: 0.3 });
  // the boot-top stripe and the rubbing strake along the gunwale
  const strake = new THREE.Mesh(hullGeometry(sections.map(([x, w]) => [x, w + 0.025, 0.06]), gun + 0.02, 14), white);
  group.add(strake);
  // the floor boards inside, the foredeck
  const floor = shadow(new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.04, 1.3), wood));
  floor.position.set(-0.3, -0.05, 0);
  group.add(floor);
  const fd = new THREE.Shape([new THREE.Vector2(1.3, -0.82), new THREE.Vector2(2.1, -0.34), new THREE.Vector2(2.42, 0), new THREE.Vector2(2.1, 0.34), new THREE.Vector2(1.3, 0.82)]);
  const deck = shadow(new THREE.Mesh(new THREE.ExtrudeGeometry(fd, { depth: 0.04, bevelEnabled: false }).rotateX(Math.PI / 2).translate(0, gun + 0.02, 0), white));
  group.add(deck);
  // the cabin (wheelhouse): walls, a roof, windows all round
  const cabin = new THREE.Group();
  cabin.position.set(0.45, gun, 0);
  const walls = shadow(new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.42, 1.25), white));
  walls.position.y = 0.21 - 0.15;
  const roof = shadow(new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.06, 1.35), white));
  roof.position.y = 0.82;
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.36, 1.19), new THREE.MeshStandardMaterial({ color: 0x1b2a33, metalness: 0.6, roughness: 0.05, transparent: true, opacity: 0.55 }));
  glass.position.y = 0.6;
  const posts = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.05), white);
    m.position.set(sx * 0.62, 0.6, sz * 0.6);
    return m;
  }));
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.015, 6, 16), dark);
  wheel.position.set(-0.7, 0.5, 0);
  wheel.rotation.y = Math.PI / 2;
  cabin.add(walls, roof, glass, ...posts, wheel);
  group.add(cabin);
  // benches, the fuel tank, the outboard on the transom (it swings to steer)
  const bench = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 1.6), wood));
  bench.position.set(-1.3, 0.3, 0);
  group.add(bench);
  const tank = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.28, 0.36), new THREE.MeshStandardMaterial({ color: 0xc23a22, roughness: 0.5 })));
  tank.position.set(-1.75, 0.2, 0.5);
  group.add(tank);
  const motor = new THREE.Group();
  motor.position.set(-2.45, gun, 0);
  const cowl = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.42, 0.32), dark));
  cowl.position.set(-0.15, 0.2, 0);
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.85, 0.08), dark);
  leg.position.set(-0.18, -0.4, 0);
  const prop = new THREE.Group();
  prop.position.set(-0.24, -0.75, 0);
  for (let k = 0; k < 3; k++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.2, 0.06), dark);
    blade.position.y = 0.09;
    const b = new THREE.Group();
    b.rotation.x = (k * Math.PI * 2) / 3;
    b.add(blade);
    prop.add(b);
  }
  motor.add(cowl, leg, prop);
  group.add(motor);
  return { group, hull, hullMat, cabin, glass, motor, prop, dims: [4.8, 1.4, 1.84], dispose: () => disposeTree(group) };
}

/* ---------------------------------------------------------------- the sea (for the boat) */
/** A patch of sea, its waves moved on the CPU (heights also asked for by the boat: heightAt). */
export class Sea {
  constructor(size = 90, seg = 72) {
    this.geo = new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2);
    this.mat = new THREE.MeshStandardMaterial({ color: 0x1f5a7a, roughness: 0.18, metalness: 0.15, transparent: true, opacity: 0.92 });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.receiveShadow = true;
    this.base = this.geo.attributes.position.array.slice();
    this.amp = 0.08;
    this.t = 0;
  }
  /** The height of the sea at (x, z) (world metres). */
  heightAt(x, z, t = this.t) {
    const A = this.amp;
    return A * (0.55 * Math.sin(x * 0.42 + t * 1.3) + 0.3 * Math.sin(z * 0.61 - t * 1.7 + x * 0.2) + 0.15 * Math.sin((x + z) * 1.3 + t * 2.6));
  }
  update(dt, amp) {
    this.t += dt;
    this.amp += (amp - this.amp) * Math.min(1, dt * 0.8);
    const a = this.geo.attributes.position.array;
    const b = this.base;
    for (let i = 0; i < a.length; i += 3) a[i + 1] = this.heightAt(b[i], b[i + 2]);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}
