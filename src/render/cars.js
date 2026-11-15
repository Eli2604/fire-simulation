import * as THREE from 'three';
import { buildCarMesh } from '../rig/vehicleMeshes.js';
import { bodyLeft } from '../sim/carBody.js';
import { SEAT_DROP } from '../sim/cars.js';
import { wheelPhase } from '../sim/carPhysics.js';
import { loadOperatorAssets, OperatorFigure, CAR_WHEEL } from '../operator/rig.js';

/**
 * The cars of the world (sim/cars.js world.cars) drawn while they move: a car's voxels are hidden
 * on the move (they snap from cell to cell; they still heat, burn and char where they are) and
 * this draws it in its pose (rig/vehicleMeshes.js buildCarMesh: the same boxes and wheels its
 * voxels are made of), smoothly: the body on its springs (pitching under the brakes, rolling in a
 * turn), the wheels turning (each axle's own spin: wheelspin, locked wheels) and steering. It
 * darkens with its voxels' char. At rest its voxels are drawn again and the mesh goes. Its lamps
 * light up while it runs.
 *
 * In every car (moving or not) its steering wheel, turned by the car's (c.wheelAngle: the road
 * wheels' angle × the steering ratio, sim/carPhysics.js), and the people in it nobody else draws
 * (you, whose camera is behind the car; anyone seated by other code): the operator figure
 * (operator/rig.js) in his seat, the driver's hands on the rim where it has turned (the clip
 * 'carDrive' held at wheelPhase), the others seated ('carSit'). The world's soldiers in a car are
 * render/enemies.js's (posed the same way: sim/cars.js placeAboard).
 *
 *   const R = new CarRenderer(parent, { assets })   // assets: operator/rig.js's (else loaded in the browser)
 *   R.setWorld(world); R.update(dt, camera)
 *   R.items (car → mesh), R.wheels (car → steering wheel), R.figures (key → { fig, c, who })
 */
const _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YZX'), _Y = new THREE.Vector3(0, 1, 0);
/** A seat's place for the figure's eyes (his feet + this): not drawn when the camera is there. */
const EYE = 1.15;

/** The steering wheel (rim, hub, three spokes) on its column's axis: { group (in the car's frame), spin (turns it) }. */
export function buildSteeringWheel() {
  const group = new THREE.Group();
  const spin = new THREE.Group();
  group.add(spin);
  const mat = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.6 });
  const r = CAR_WHEEL.r;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.016, 8, 28), mat);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 12).rotateX(Math.PI / 2), mat);
  spin.add(rim, hub);
  // spokes at 3, 9 and 6 o'clock (x' to his right, y' up the rim)
  for (const a of [0, Math.PI, -Math.PI / 2]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(r, 0.025, 0.012), mat);
    s.position.set((Math.cos(a) * r) / 2, (Math.sin(a) * r) / 2, 0);
    s.rotation.z = a;
    spin.add(s);
  }
  // the column, down into the dashboard
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.3, 8).rotateX(Math.PI / 2), mat);
  col.position.z = -0.17;
  group.add(col);
  return { group, spin, dispose: () => group.traverse((o) => o.geometry?.dispose()) };
}

/** The steering wheel's centre in the car's frame and its basis (x' his right, y' up its rim, z' up the column to him), for a driver's seat. */
export function steeringWheelFrame(seat) {
  const t = CAR_WHEEL.tilt;
  const [fx, fy, fz] = CAR_WHEEL.c; // (figure space: +x his left, +z ahead)
  const root = [seat.at[0], seat.at[1] - SEAT_DROP, seat.at[2]];
  return {
    c: [root[0] + fz, root[1] + fy, root[2] - fx],
    x: [0, 0, 1],
    y: [Math.sin(t), Math.cos(t), 0],
    z: [-Math.cos(t), Math.sin(t), 0],
  };
}

export class CarRenderer {
  constructor(parent, { assets = null } = {}) {
    this.group = new THREE.Group();
    parent.add(this.group);
    this.items = new Map(); // car → mesh
    this.wheels = new Map(); // car → steering wheel
    this.figures = new Map(); // key → { fig, c, who }
    this.A = assets;
    this.ids = new WeakMap();
    this.nid = 0;
  }

  setWorld(world) {
    this.clear();
    this.world = world;
  }

  clear() {
    for (const m of this.items.values()) {
      this.group.remove(m.group);
      m.dispose();
    }
    this.items.clear();
    for (const s of this.wheels.values()) {
      this.group.remove(s.root);
      s.dispose();
    }
    this.wheels.clear();
    for (const it of this.figures.values()) {
      this.group.remove(it.fig.group);
      it.fig.dispose?.();
    }
    this.figures.clear();
  }

  /** The operator's assets: given, or loaded once in the browser (null until then: nobody drawn). */
  assets() {
    if (this.A) return this.A;
    if (!this.loading && typeof window !== 'undefined' && typeof Worker !== 'undefined') {
      this.loading = true;
      loadOperatorAssets({ lod: 'game' }).then((a) => (this.A = a), () => {});
    }
    return null;
  }

  update(dt = 0, camera = null) {
    const w = this.world;
    const live = new Set();
    for (const c of w?.cars ?? []) {
      if (!c.body?.hidden) continue;
      live.add(c);
      let m = this.items.get(c);
      if (!m) {
        m = buildCarMesh(c.params ?? {});
        m.group.rotation.order = 'YZX'; // (R = Ry(yaw) · Rz(pitch) · Rx(roll): sim/carPhysics.js carRot)
        m.body.rotation.order = 'ZXY';
        this.group.add(m.group);
        this.items.set(c, m);
        m.tick = -1;
      }
      m.group.position.set(c.x, c.y, c.z);
      // the ground's slope on the whole; the springs on the body
      m.group.rotation.set(c.rollG ?? 0, c.yaw, c.pitchG ?? 0);
      m.body.rotation.set(c.rollS ?? 0, 0, c.pitchS ?? 0);
      for (const wl of m.wheels) {
        wl.steer.rotation.y = wl.front ? c.steer : 0;
        wl.spin.rotation.z = -(wl.front ? c.spinF : c.spinR);
      }
      // its char (every half second)
      const k = Math.floor((c.t ?? 0) * 2);
      if (k !== m.tick) {
        m.tick = k;
        const B = c.body;
        let ch = 0, n = 0;
        for (let i = 0; i < B.n; i += 3)
          if (B.alive[i]) {
            ch += B.state.char[i];
            n++;
          }
        const dark = 1 - 0.85 * (n ? ch / n : 0);
        m.group.visible = bodyLeft(B) > 0.35;
        m.group.traverse((o) => {
          if (!o.isMesh || !o.material?.color) return;
          o.material.userData.base ??= o.material.color.clone();
          o.material.color.copy(o.material.userData.base).multiplyScalar(dark);
          if (o.material.emissive && o.material.userData.em === undefined) o.material.userData.em = o.material.emissiveIntensity;
          if (o.material.userData.em !== undefined) o.material.emissiveIntensity = c.running ? 1.6 : o.material.userData.em * 0.3;
        });
      }
    }
    for (const [c, m] of this.items)
      if (!live.has(c)) {
        this.group.remove(m.group);
        m.dispose();
        this.items.delete(c);
      }
    this.cabs(dt, camera);
  }

  /** Each car's steering wheel and the people in it this draws. */
  cabs(dt, camera) {
    const w = this.world;
    const enemies = new Set(w?.enemies ?? []);
    const cars = new Set();
    const want = [];
    for (const c of w?.cars ?? []) {
      if (c.body && bodyLeft(c.body) < 0.35) continue;
      cars.add(c);
      let sw = this.wheels.get(c);
      if (!sw) {
        // on its column in the car's frame (in front of the driver's seat), the car's pose over it
        const F = steeringWheelFrame(c.seats.find((s) => s.drive) ?? c.seats[0]);
        sw = buildSteeringWheel();
        const col = new THREE.Group();
        col.position.set(...F.c);
        col.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...F.x), new THREE.Vector3(...F.y), new THREE.Vector3(...F.z)));
        col.add(sw.group);
        sw.root = new THREE.Group();
        sw.root.rotation.order = 'YZX';
        sw.root.add(col);
        sw.frame = F;
        this.group.add(sw.root);
        this.wheels.set(c, sw);
      }
      sw.root.position.set(c.x, c.y, c.z);
      sw.root.rotation.set(c.roll ?? 0, c.yaw, c.pitch ?? 0);
      // (+ left: anticlockwise as the driver sees it, about the column towards him)
      sw.spin.rotation.z = c.wheelAngle ?? 0;
      c.seats.forEach((s, i) => {
        const m = s.who;
        if (!m || enemies.has(m) || m.dead) return;
        if (m.player && camera) {
          // you: not when the camera is at your eyes
          const e = this.seatRoot(c, s, EYE);
          const cp = camera.getWorldPosition ? camera.getWorldPosition(new THREE.Vector3()) : camera.position;
          if (Math.hypot(cp.x - e[0], cp.y - e[1], cp.z - e[2]) < 0.6) return;
        }
        want.push([c, s, m, this.keyOf(m, c, i)]);
      });
    }
    for (const [c, sw] of this.wheels)
      if (!cars.has(c)) {
        this.group.remove(sw.root);
        sw.dispose();
        this.wheels.delete(c);
      }
    const A = want.length ? this.assets() : this.A;
    for (const it of this.figures.values()) it.seen = false;
    if (A)
      for (const [c, s, m, key] of want) {
        let it = this.figures.get(key);
        if (!it) {
          const fig = new OperatorFigure(A, { zones: false, loadout: m.player ? 'rifle' : m.loadout ?? 'unarmed' });
          fig.autoFlash = false;
          this.group.add(fig.group);
          it = { fig, c, who: m, key };
          this.figures.set(key, it);
        }
        it.seen = true;
        it.c = c;
        this.pose(it.fig, c, s, dt);
      }
    for (const [key, it] of this.figures)
      if (!it.seen) {
        this.group.remove(it.fig.group);
        it.fig.dispose?.();
        this.figures.delete(key);
      }
  }

  keyOf(m, c, i) {
    if (!this.ids.has(m)) this.ids.set(m, ++this.nid);
    return `m${this.ids.get(m)}`;
  }

  /** A seat's figure root (his feet) in the world, up `up` m. */
  seatRoot(c, s, up = 0) {
    const l = [s.at[0], s.at[1] - SEAT_DROP + up, s.at[2]];
    const v = new THREE.Vector3(...l).applyEuler(_e.set(c.roll ?? 0, c.yaw, c.pitch ?? 0, 'YZX'));
    return [c.x + v.x, c.y + v.y, c.z + v.z];
  }

  /** The figure in his seat, turned with the car (his +z its +x), the driver's clip at the wheel's angle. */
  pose(fig, c, s, dt) {
    const g = fig.group;
    g.position.set(...this.seatRoot(c, s));
    g.quaternion.setFromEuler(_e.set(c.roll ?? 0, c.yaw, c.pitch ?? 0, 'YZX')).multiply(_q.setFromAxisAngle(_Y, Math.PI / 2));
    const anim = s.who?.down ? 'woundedDown' : s.drive ? 'carDrive' : 'carSit';
    if (fig.shown !== anim) fig.play(anim, { fade: 0.3 });
    fig.setPhase(anim === 'carDrive' ? wheelPhase(c.wheelAngle ?? 0) : null);
    fig.update(dt);
  }
}
