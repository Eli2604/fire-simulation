import * as THREE from 'three';
import { lod, updateEvery } from './lod.js';
import { raycastDrawn, nearestVoxel, toSim } from './pickThings.js';

/**
 * The camp island's objects as they are drawn (props of models/windTurbine.js, solarPark.js and
 * droneCamp.js; their state from sim/power.js on the world): the turbine's tower, nacelle and
 * rotor, turning with the wind and yawing into it; the solar park's panels on their frames (one
 * instanced mesh: a panel blown away is gone from it); the camp's monitors, map, floodlights,
 * drones on their pads, radio mast and jammers, lit while the camp has power and dark when it
 * has none. The cables from the turbine and the park run along the ground to the camp.
 *
 * Level of detail (render/lod.js, by the size on the screen; render/props.js hides the whole of it
 * when it is under a pixel and drops its shadow when small): level 0 everything; level 1 no
 * frames, cables, antennas or drones, the rotor turned every other frame; level 2 the big shapes
 * only (tower, rotor, panels, monitors' glow), updated every fourth frame.
 */

const TURBINE_LOD = [70, 14];
const PARK_LOD = [80, 16];
const CAMP_LOD = [90, 18];

const std = (color, roughness = 0.6, metalness = 0.2, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });

function mesh(geo, mat, parent, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/** A thin cylinder from a to b. */
function strut(parent, a, b, r, mat, seg = 6) {
  const A = new THREE.Vector3(...a);
  const d = new THREE.Vector3(...b).sub(A);
  const m = mesh(new THREE.CylinderGeometry(r, r, d.length(), seg), mat, parent);
  m.position.copy(A).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

/** A cable on the ground along a path (points in the prop's frame), on little sleepers. */
function cable(parent, pts, mat) {
  const g = new THREE.Group();
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k];
    const b = pts[k + 1];
    strut(g, [a[0], 0.06, a[2]], [b[0], 0.06, b[2]], 0.03, mat, 5);
  }
  parent.add(g);
  return g;
}

/** The generator (sim/power.js) of a prop: the same object (owner) and kind. */
function generatorOf(world, pr, kind) {
  return (world?.generators ?? []).find((g) => g.owner === pr.owner && g.kind === kind) ?? null;
}

class Drawing {
  constructor(pr, world, levels) {
    this.pr = pr;
    this.world = world;
    this.group = new THREE.Group();
    this.levels = levels;
    this.state = {};
    this.level = 0;
    this.frame = 0;
    this.detail = []; // hidden from level 1
    this.fine = []; // hidden from level 2
  }
  /** Its level by its size on the screen (its middle `c` and radius `r`, in its own frame). */
  pickLevel(c, r) {
    const p = this.pr.p;
    const lv = lod.level(this.state, p[0] + c[0], p[1] + c[1], p[2] + c[2], r, this.levels);
    if (lv !== this.level) {
      this.level = lv;
      for (const o of this.detail) o.visible = lv < 1;
      for (const o of this.fine) o.visible = lv < 2;
    }
    this.frame++;
    return this.frame % updateEvery(lv, [1, 2, 4, 8]) === 0;
  }
  /**
   * A click on it (render/pick.js): the hidden voxel under the mesh there if there is one (the
   * turbine's tower and nacelle, the park's container), else none (the rotor, the panels, the
   * camp's screens are drawn only); and what it is (sim/inspectThings.js describes it from
   * sim/power.js): { distance, point, normal, voxel, thing } or null.
   */
  pick(ray, root) {
    this.group.updateMatrixWorld(true);
    const h = raycastDrawn(ray, this.group);
    if (!h) return null;
    const w = this.world;
    const voxel = nearestVoxel(w, toSim(root, h.point), Math.max(0.15, (w?.h ?? 0.1) * 1.5));
    const kind = { windTurbine: 'wind', solarPark: 'solar' }[this.pr.type];
    const thing = kind ? { kind: 'generator', gen: kind, owner: this.pr.owner } : { kind: 'grid', grid: this.pr.grid ?? 'camp' };
    return { ...h, voxel, thing };
  }
}

/** The wind turbine: tower, nacelle (yawing), hub and three blades (turning). */
export class TurbineDrawing extends Drawing {
  constructor(pr, world) {
    super(pr, world, TURBINE_LOD);
    const H = pr.hub;
    const R = pr.R;
    const white = std(0xe9ebea, 0.45, 0.1);
    const grey = std(0x8d9296, 0.5, 0.4);
    // the tower: a tapering tube
    const tower = mesh(new THREE.CylinderGeometry(pr.r1 ?? 0.45, pr.r0 ?? 0.75, H - 0.25, 20), white, this.group, 0, 0.25 + (H - 0.25) / 2, 0);
    void tower;
    const door = mesh(new THREE.BoxGeometry(0.06, 1.9, 0.7), grey, this.group, (pr.r0 ?? 0.75) - 0.02, 1.25, 0);
    this.detail.push(door);
    // the nacelle on its yaw bearing (its rotor towards +x in its own frame)
    this.nacelle = new THREE.Group();
    this.nacelle.position.y = H;
    this.group.add(this.nacelle);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.75, 2.3, 4, 12), white);
    body.rotation.z = Math.PI / 2;
    body.position.set(0.1, -0.35, 0);
    this.nacelle.add(body);
    const vane = mesh(new THREE.BoxGeometry(0.5, 0.35, 0.04), grey, this.nacelle, -1.2, 0.55, 0); // the anemometer and vane on top
    this.detail.push(vane);
    // the rotor: a spinner and three blades, turning about x
    this.rotor = new THREE.Group();
    this.rotor.position.set(1.85, -0.35, 0);
    this.nacelle.add(this.rotor);
    const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.0, 16), white);
    spinner.rotation.z = -Math.PI / 2;
    spinner.position.x = 0.35;
    this.rotor.add(spinner);
    // a blade: tapered (root chord ~0.12 R, tip ~0.03 R), a little twisted, along +y
    const bg = new THREE.BoxGeometry(0.12, R, 1, 1, 6, 1);
    bg.translate(0, R / 2 + 0.3, 0);
    const pos = bg.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const t = Math.min(1, Math.max(0, (y - 0.3) / R));
      const chord = R * (0.12 - 0.09 * t);
      const tw = (1 - t) * 0.35; // twist (rad), more at the root
      const z = pos.getZ(i) * chord;
      const x = pos.getX(i);
      pos.setX(i, x * Math.cos(tw) - z * Math.sin(tw));
      pos.setZ(i, x * Math.sin(tw) + z * Math.cos(tw));
    }
    bg.computeVertexNormals();
    for (let k = 0; k < 3; k++) {
      const b = new THREE.Mesh(bg, white);
      b.rotation.x = (k * 2 * Math.PI) / 3;
      this.rotor.add(b);
    }
    // the blades' tips red (aviation marking)
    // (the cable to the camp, along the ground)
    if (pr.cable) this.detail.push(cable(this.group, pr.cable, std(0x1b1b1b, 0.8, 0)));
    this.update(0);
  }

  update(dt) {
    const g = generatorOf(this.world, this.pr, 'wind');
    const H = this.pr.hub;
    const go = this.pickLevel([0, H * 0.6, 0], Math.max(this.pr.R, H * 0.6));
    if (!g) return;
    // the rotor turns at the simulation's speed (smoothly, frame by frame; on the frames it is
    // updated at its level of detail, by all the time since)
    this.acc = (this.acc ?? 0) + dt;
    if (!go) return;
    this.angle = ((this.angle ?? g.angle ?? 0) + (g.omega ?? 0) * this.acc) % (Math.PI * 2);
    this.acc = 0;
    this.rotor.rotation.x = -this.angle;
    // the yaw: g.yaw the way it faces in the world (an x-z angle); the prop is turned by its heading
    if (g.yaw != null) this.nacelle.rotation.y = -g.yaw - (this.pr.heading ?? 0);
  }
}

/** A solar park: the panels (instanced), their frames, the cable to the camp. */
export class ParkDrawing extends Drawing {
  constructor(pr, world) {
    super(pr, world, PARK_LOD);
    const n = pr.panels.length;
    const cells = std(0x1d2c4c, 0.22, 0.35);
    if (typeof document !== 'undefined' && document.createElement('canvas').getContext) {
      // the cells: 6 × 10 dark-blue squares with silver lines between
      const c = document.createElement('canvas');
      c.width = 96;
      c.height = 160;
      const x = c.getContext('2d');
      if (x) {
        x.fillStyle = '#c8ccd2';
        x.fillRect(0, 0, 96, 160);
        for (let i = 0; i < 6; i++)
          for (let j = 0; j < 10; j++) {
            x.fillStyle = (i + j) % 2 ? '#1a2848' : '#1c2b4e';
            x.fillRect(i * 16 + 1, j * 16 + 1, 14, 14);
          }
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        cells.map = t;
        cells.color.set(0xffffff);
      }
    }
    const frameMat = std(0xb9bfc4, 0.4, 0.8);
    const geo = new THREE.BoxGeometry(pr.PW, 0.04, pr.PL);
    this.panels = new THREE.InstancedMesh(geo, cells, n);
    this.frames = new THREE.InstancedMesh(new THREE.BoxGeometry(pr.PW + 0.04, 0.03, pr.PL + 0.04), frameMat, n);
    const psi = Math.atan2(pr.f[0], pr.f[2]);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pr.tilt, psi, 0, 'YXZ'));
    // (the panels' middles in the model's frame, as the prop's group is: models/solarPark.js)
    this.mats = pr.panels.map((c) => new THREE.Matrix4().compose(new THREE.Vector3(...c), q, new THREE.Vector3(1, 1, 1)));
    this.mats.forEach((mm, k) => {
      this.panels.setMatrixAt(k, mm);
      const f = mm.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.03, 0));
      this.frames.setMatrixAt(k, f);
    });
    this.group.add(this.panels, this.frames);
    // the frames: a rail under the top and the bottom of each row, posts (as the voxels: models/solarPark.js)
    const steel = std(0x8e9397, 0.5, 0.7);
    const rails = new THREE.Group();
    const width = pr.columns * (pr.PW + 0.03);
    const run = pr.PL * Math.cos(pr.tilt);
    const rise = pr.PL * Math.sin(pr.tilt);
    const at = (u, v, y) => [pr.a[0] * u + pr.f[0] * v, y, pr.a[2] * u + pr.f[2] * v];
    for (let r = 0; r < pr.rows; r++) {
      const v0 = (r - (pr.rows - 1) / 2) * pr.rowSpacing;
      strut(rails, at(-width / 2, v0 + run / 2 - 0.1, pr.low), at(width / 2, v0 + run / 2 - 0.1, pr.low), 0.035, steel);
      strut(rails, at(-width / 2, v0 - run / 2 + 0.1, pr.low + rise - 0.06), at(width / 2, v0 - run / 2 + 0.1, pr.low + rise - 0.06), 0.035, steel);
      const posts = Math.max(2, Math.ceil(width / 2.2) + 1);
      for (let k = 0; k < posts; k++) {
        const u = -width / 2 + (width * k) / (posts - 1);
        strut(rails, at(u, v0 + run / 2 - 0.1, 0), at(u, v0 + run / 2 - 0.1, pr.low), 0.045, steel);
        strut(rails, at(u, v0 - run / 2 + 0.1, 0), at(u, v0 - run / 2 + 0.1, pr.low + rise - 0.06), 0.045, steel);
      }
    }
    this.group.add(rails);
    this.detail.push(rails);
    // the inverter's status light on the container, the cable to the camp
    const c = pr.container;
    this.led = mesh(new THREE.SphereGeometry(0.06, 8, 6), std(0x30ff60, 0.4, 0, { emissive: 0x30ff60, emissiveIntensity: 1.5 }), this.group, c[0], 2.2, c[2] + (pr.containerExt?.[1] ?? 1.5) + 0.02);
    this.detail.push(this.led);
    if (pr.cable) this.detail.push(cable(this.group, pr.cable, std(0x1b1b1b, 0.8, 0)));
    this.update(0);
  }

  update() {
    const g = generatorOf(this.world, this.pr, 'solar');
    if (!this.pickLevel([0, 1, 0], Math.hypot(this.pr.columns * 1.1, this.pr.rows * this.pr.rowSpacing) / 2 + 1)) return;
    if (!g) return;
    // panels gone (sim/power.js counts them: their voxels): not drawn
    const dead = g.dead;
    if (dead && dead !== this.dead) {
      this.dead = dead;
      const zero = new THREE.Matrix4().makeScale(0, 0, 0);
      dead.forEach((d, k) => {
        this.panels.setMatrixAt(k, d ? zero : this.mats[k]);
        this.frames.setMatrixAt(k, d ? zero : this.mats[k].clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.03, 0)));
      });
      this.panels.instanceMatrix.needsUpdate = true;
      this.frames.instanceMatrix.needsUpdate = true;
    }
    const on = g.state === 'producing';
    this.led.material.emissive.set(g.state === 'broken' ? 0xff3020 : on ? 0x30ff60 : 0xffa020);
    this.led.material.color.copy(this.led.material.emissive);
  }
}

/** A drone feed on a monitor: a little scene of the ground from above with a HUD (or nothing). */
function feedTexture(k) {
  if (typeof document === 'undefined' || !document.createElement('canvas').getContext) return null;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 80;
  const x = c.getContext('2d');
  if (!x) return null;
  const g = x.createLinearGradient(0, 0, 0, 80);
  g.addColorStop(0, ['#6f8a5a', '#7a8466', '#5f7a52', '#80845e'][k % 4]);
  g.addColorStop(1, '#3d4a35');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 80);
  // fields and a track, seen from above
  x.strokeStyle = 'rgba(210,200,160,.7)';
  x.lineWidth = 3;
  x.beginPath();
  x.moveTo(0, 20 + k * 9);
  x.bezierCurveTo(40, 60 - k * 5, 80, 10 + k * 7, 128, 50);
  x.stroke();
  x.strokeStyle = '#38ff7a';
  x.lineWidth = 1;
  x.strokeRect(54, 30, 20, 20);
  x.fillStyle = '#38ff7a';
  x.font = 'bold 10px monospace';
  x.fillText(`D${k + 1}  ALT ${80 + k * 15}m`, 4, 10);
  x.fillText(`BAT ${92 - k * 7}%  GNSS`, 4, 76);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The camp: monitors and map on the desk, floodlights, drones on their pads, the mast, the jammers. */
export class CampDrawing extends Drawing {
  constructor(pr, world) {
    super(pr, world, CAMP_LOD);
    const dark = std(0x26292c, 0.6, 0.5);
    const metal = std(0x5a5f63, 0.5, 0.7);
    // the monitors on the desk, facing east (+x) to the operator's chair
    const [dx, , dz] = pr.desk;
    this.screens = [];
    const per = 3;
    for (let k = 0; k < pr.monitors; k++) {
      const col = k % per;
      const row = Math.floor(k / per);
      const z = dz + (col - (per - 1) / 2) * 0.62;
      const y = 1.02 + row * 0.38;
      mesh(new THREE.BoxGeometry(0.04, 0.36, 0.6), dark, this.group, dx - 0.12, y, z);
      const mat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.3, metalness: 0, emissive: 0xffffff, emissiveMap: feedTexture(k), emissiveIntensity: 1 });
      if (!mat.emissiveMap) mat.emissive.set(0x3a6a4a);
      const s = mesh(new THREE.PlaneGeometry(0.56, 0.32), mat, this.group, dx - 0.095, y, z);
      s.rotation.y = Math.PI / 2;
      this.screens.push(s);
      if (row === 0) this.fine.push(mesh(new THREE.BoxGeometry(0.05, 0.25, 0.05), metal, this.group, dx - 0.12, 0.9, z));
    }
    // the chair
    const chair = new THREE.Group();
    chair.position.set(dx + 0.75, 0, dz);
    mesh(new THREE.BoxGeometry(0.46, 0.06, 0.48), dark, chair, 0, 0.46, 0);
    mesh(new THREE.BoxGeometry(0.05, 0.5, 0.46), dark, chair, 0.23, 0.73, 0);
    mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.44, 6), metal, chair, 0, 0.22, 0);
    this.group.add(chair);
    this.detail.push(chair);
    // the tactical map on a stand beside the desk
    const map = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.4, emissive: 0x2c5a6a, emissiveIntensity: 1 });
    mesh(new THREE.BoxGeometry(0.05, 1.0, 1.0), dark, this.group, dx + 0.2, 1.45, dz + 1.75);
    const ms = mesh(new THREE.PlaneGeometry(0.94, 0.94), map, this.group, dx + 0.23, 1.45, dz + 1.75);
    ms.rotation.y = Math.PI / 2;
    this.screens.push(ms);
    this.detail.push(strut(this.group, [dx + 0.2, 0, dz + 1.75], [dx + 0.2, 0.95, dz + 1.75], 0.04, metal));
    // floodlights: a head on each pole, a light of its own (the first two)
    this.lamps = [];
    this.lights = [];
    const lampOn = std(0xfff4d8, 0.3, 0, { emissive: 0xfff1d0, emissiveIntensity: 2 });
    pr.lamps.forEach((q, k) => {
      const pole = strut(this.group, [q[0], 0, q[2]], [q[0], q[1], q[2]], 0.07, metal);
      void pole;
      const head = mesh(new THREE.BoxGeometry(0.45, 0.22, 0.3), lampOn.clone(), this.group, q[0], q[1] + 0.1, q[2]);
      head.rotation.z = 0.35 * Math.sign(-q[0] || 1);
      this.lamps.push(head);
      if (k < 2) {
        const l = new THREE.PointLight(0xfff0d0, 0, 22, 1.4);
        l.position.set(q[0], q[1] - 0.3, q[2]);
        this.group.add(l);
        this.lights.push(l);
      }
    });
    // the drones on their pads (quadcopters: a body, four arms, four rotors, a status light)
    this.leds = [];
    const body = std(0x3b3f3a, 0.55, 0.3);
    const prop = new THREE.MeshStandardMaterial({ color: 0x111111, transparent: true, opacity: 0.55, roughness: 0.5 });
    pr.pads.slice(0, pr.drones).forEach(([x, y, z], k) => {
      const d = new THREE.Group();
      d.position.set(x, y + 0.12, z);
      d.rotation.y = k * 0.7;
      mesh(new THREE.BoxGeometry(0.34, 0.1, 0.22), body, d, 0, 0.06, 0);
      for (const [ax, az] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        strut(d, [0, 0.07, 0], [ax * 0.28, 0.07, az * 0.28], 0.015, body, 4);
        const r = mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.01, 12), prop, d, ax * 0.28, 0.1, az * 0.28);
        void r;
      }
      for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.02, 0.06, 0.3), body, d, s * 0.12, -0.02, 0); // skids
      const led = mesh(new THREE.SphereGeometry(0.02, 6, 4), std(0x30ff60, 0.4, 0, { emissive: 0x30ff60, emissiveIntensity: 2 }), d, 0.18, 0.08, 0);
      this.leds.push(led);
      this.group.add(d);
      this.detail.push(d);
    });
    // the radio mast: a lattice to 9 m, whips, a red light at the top
    const mast = new THREE.Group();
    mast.position.set(pr.mast[0], 0.5, pr.mast[2]);
    const mh = 8.5;
    for (let k = 0; k < 6; k++) {
      const y0 = (mh * k) / 6, y1 = (mh * (k + 1)) / 6;
      const a = 0.32 - 0.18 * (k / 6), b = 0.32 - 0.18 * ((k + 1) / 6);
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        strut(mast, [sx * a, y0, sz * a], [sx * b, y1, sz * b], 0.025, metal, 4);
        if (sx > 0) strut(mast, [sx * a, y0, sz * a], [-sx * b, y1, sz * b], 0.015, metal, 4);
      }
    }
    for (const s of [-1, 1]) strut(mast, [0, mh, s * 0.3], [0, mh + 1.6, s * 0.3], 0.012, dark, 4);
    this.beacon = mesh(new THREE.SphereGeometry(0.08, 8, 6), std(0xff2020, 0.4, 0, { emissive: 0xff2020, emissiveIntensity: 2 }), mast, 0, mh + 0.1, 0);
    this.group.add(mast);
    this.fine.push(mast);
    // the jammers: a case with an array of whip antennas, a light (cyan GNSS, violet radio link)
    this.jamLeds = [];
    for (const j of pr.jammers) {
      const g = new THREE.Group();
      g.position.set(j.p[0], 0.55, j.p[2]);
      for (let k = 0; k < 4; k++) strut(g, [-0.24 + k * 0.16, 0, 0], [-0.24 + k * 0.16, 1.1 + (k % 2) * 0.3, 0], 0.01, dark, 4);
      const c = j.kind === 'gnss' ? 0x32d6ff : 0xb36bff;
      this.jamLeds.push(mesh(new THREE.SphereGeometry(0.035, 6, 4), std(c, 0.4, 0, { emissive: c, emissiveIntensity: 2 }), g, 0.3, 0.02, 0.26));
      this.group.add(g);
      this.detail.push(g);
    }
    this.update(0);
  }

  update(dt) {
    this.t = (this.t ?? 0) + dt;
    const go = this.pickLevel([0, 1.5, 0], (this.pr.ring ?? 9) + 1);
    if (!go && this.ops !== undefined) return;
    const grid = this.world?.power?.[this.pr.grid];
    // (no grid worked out yet: as it starts, everything on)
    const ops = grid ? grid.ops : true;
    const lit = grid ? grid.lights && grid.night : false;
    const night = grid?.night ?? false;
    if (ops !== this.ops) {
      this.ops = ops;
      for (const s of this.screens) s.material.emissiveIntensity = ops ? 1 : 0;
      for (const l of [...this.leds, ...this.jamLeds]) l.material.emissiveIntensity = ops ? 2 : 0;
      this.beacon.material.emissiveIntensity = ops ? 2 : 0;
    }
    if (lit !== this.lit || night !== this.night) {
      this.lit = lit;
      this.night = night;
      for (const h of this.lamps) h.material.emissiveIntensity = lit ? 3 : 0;
      for (const l of this.lights) l.intensity = lit ? 40 : 0;
    }
    // the beacon blinks while it has power
    if (ops) this.beacon.material.emissiveIntensity = Math.sin(this.t * 3) > 0 ? 2.5 : 0.2;
  }
}

/** The drawing of a prop of these types (render/props.js), or null. */
export function campPowerDrawing(pr, world) {
  switch (pr.type) {
    case 'windTurbine':
      return new TurbineDrawing(pr, world);
    case 'solarPark':
      return new ParkDrawing(pr, world);
    case 'droneCamp':
      return new CampDrawing(pr, world);
    default:
      return null;
  }
}
