import * as THREE from 'three';
import { buildCarrierHull } from './hull.js';
import { buildCryptVault } from './cryptVault.js';
import { ChurchDrawing } from './church.js';

/**
 * Detail that is drawn but not simulated (`props` of a model): the mast, radars
 * and antennas on a carrier's island, catapult tracks and arresting wires on its
 * deck, the safety nets along the deck edge, painted numbers. They follow the
 * model's position and heading; radars turn.
 */
function canvasText(text, w, h, color = '#e8e8e0') {
  if (typeof document === 'undefined' || typeof document.createElement('canvas').getContext !== 'function') return null;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = Math.round((512 * h) / w);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = color;
  ctx.font = `bold ${Math.round(c.height * 0.9)}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, c.width / 2, c.height * 0.53);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class PropsRenderer {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.spin = [];
    const std = (color, roughness = 0.6, metalness = 0.3) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
    this.m = {
      grey: std(0x7d8186),
      dark: std(0x2a2c2e, 0.7, 0.4),
      metal: std(0x9a9ea2, 0.4, 0.8),
      black: std(0x121212, 0.9, 0.1),
      white: std(0xdedede, 0.6, 0.1),
      net: new THREE.MeshStandardMaterial({ color: 0x3c3f42, roughness: 0.9, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    };
  }

  setWorld(world) {
    this.group.clear();
    this.spin = [];
    this.drawings = []; // props with a life of their own (the church: glass, timber that burns)
    this.world = world;
    for (const pr of world.props ?? []) {
      const o = this.build(pr);
      if (!o) continue;
      o.position.set(pr.p[0], pr.p[1], pr.p[2]);
      o.rotation.y = pr.heading ?? 0;
      o.traverse((c) => {
        if (c.isMesh) {
          // (light patches and shafts neither cast nor take shadows)
          c.castShadow = !c.userData.noShadow;
          c.receiveShadow = !c.userData.noShadow;
        }
      });
      this.group.add(o);
    }
  }

  mesh(geo, mat, parent, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  /** A lattice of struts between corner points (a mast). */
  lattice(parent, h, w0, w1, levels) {
    const M = this.m;
    for (let k = 0; k < levels; k++) {
      const y0 = (h * k) / levels;
      const y1 = (h * (k + 1)) / levels;
      const a = w0 + ((w1 - w0) * k) / levels;
      const b = w0 + ((w1 - w0) * (k + 1)) / levels;
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const p0 = new THREE.Vector3(sx * a, y0, sz * a);
        const p1 = new THREE.Vector3(sx * b, y1, sz * b);
        this.strut(parent, p0, p1, 0.035, M.grey);
        // cross braces
        const q1 = new THREE.Vector3(-sx * b, y1, sz * b);
        if (sx > 0) this.strut(parent, p0, q1, 0.02, M.grey);
      }
    }
  }

  strut(parent, a, b, r, mat) {
    const d = b.clone().sub(a);
    const m = this.mesh(new THREE.CylinderGeometry(r, r, d.length(), 6), mat, parent);
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    return m;
  }

  build(pr) {
    const M = this.m;
    const g = new THREE.Group();
    switch (pr.type) {
      case 'mast': {
        // a tapering lattice mast with yardarms, lights and whip antennas
        const h = pr.h ?? 8;
        this.lattice(g, h, 0.55, 0.18, 6);
        for (const [y, w] of [[h * 0.55, 2.4], [h * 0.85, 1.6]]) {
          const yard = this.mesh(new THREE.BoxGeometry(0.08, 0.08, w), M.grey, g, 0, y, 0);
          void yard;
          for (const s of [-1, 1]) this.mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.4, 4), M.black, g, 0, y + 0.7, (s * w) / 2);
        }
        this.mesh(new THREE.CylinderGeometry(0.02, 0.03, 2.5, 6), M.black, g, 0, h + 1.25, 0); // top antenna
        this.mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff2020, emissiveIntensity: 1.5 }), g, 0, h + 2.55, 0);
        return g;
      }
      case 'radarArray': {
        // a rotating flat array antenna on a pedestal
        const spin = new THREE.Group();
        g.add(spin);
        this.mesh(new THREE.CylinderGeometry(0.18, 0.25, 0.5, 10), M.dark, g, 0, 0.25, 0);
        const w = pr.w ?? 4;
        const h = pr.h ?? 1.6;
        const face = this.mesh(new THREE.BoxGeometry(0.12, h, w), M.grey, spin, 0.25, 0.5 + h / 2, 0);
        face.rotation.z = 0.12;
        for (let k = 0; k < 8; k++) this.mesh(new THREE.BoxGeometry(0.04, h * 0.92, 0.03), M.dark, spin, 0.32, 0.5 + h / 2, -w / 2 + ((k + 0.5) * w) / 8);
        this.spin.push({ o: spin, rate: pr.rate ?? 1.2 });
        return g;
      }
      case 'radarDish': {
        // a big open-mesh parabolic dish (air search)
        const spin = new THREE.Group();
        g.add(spin);
        this.mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.6, 10), M.dark, g, 0, 0.3, 0);
        const r = pr.r ?? 2.5;
        const dish = this.mesh(new THREE.SphereGeometry(r, 18, 8, -0.75, 1.5, Math.PI / 2 - 0.35, 0.7), M.net, spin, -r * 0.85, 0.9, 0);
        dish.rotation.y = Math.PI / 2;
        const frame = this.mesh(new THREE.TorusGeometry(r * 0.72, 0.03, 4, 24, Math.PI * 0.6), M.grey, spin, 0.15, 0.9, 0);
        frame.rotation.set(0, Math.PI / 2, Math.PI * 0.2);
        this.strut(spin, new THREE.Vector3(0, 0.6, 0), new THREE.Vector3(0.9, 0.9, 0), 0.04, M.grey); // feed arm
        this.spin.push({ o: spin, rate: pr.rate ?? -0.8 });
        return g;
      }
      case 'whip':
        this.mesh(new THREE.CylinderGeometry(0.012, 0.025, pr.h ?? 4, 5), M.black, g, 0, (pr.h ?? 4) / 2, 0);
        return g;
      case 'catapult': {
        // a catapult track along x: the slot, and the shuttle at its start
        const len = pr.len ?? 30;
        this.mesh(new THREE.BoxGeometry(len, 0.02, 0.3), M.dark, g, len / 2, 0.012, 0);
        this.mesh(new THREE.BoxGeometry(len, 0.024, 0.06), M.black, g, len / 2, 0.014, 0);
        this.mesh(new THREE.BoxGeometry(0.6, 0.18, 0.2), M.metal, g, 0.3, 0.09, 0); // shuttle
        return g;
      }
      case 'wires': {
        // arresting wires across the landing area, each on two low supports
        const n = pr.n ?? 4;
        const w = pr.w ?? 16;
        for (let k = 0; k < n; k++) {
          const x = k * (pr.step ?? 12);
          const wire = this.mesh(new THREE.CylinderGeometry(0.018, 0.018, w, 6), M.metal, g, x, 0.11, 0);
          wire.rotation.x = Math.PI / 2;
          for (const s of [-1, 1]) this.mesh(new THREE.BoxGeometry(0.35, 0.14, 0.2), M.dark, g, x, 0.07, (s * w) / 2);
        }
        return g;
      }
      case 'net': {
        // a safety net along the deck edge (x), sloping outwards and down
        const len = pr.len ?? 30;
        const net = this.mesh(new THREE.PlaneGeometry(len, 1.4, 1, 1), M.net, g, len / 2, -0.25, 0.65);
        net.rotation.x = -Math.PI / 2 + 0.35;
        for (let x = 0; x <= len; x += 2) this.strut(g, new THREE.Vector3(x, -0.05, 0), new THREE.Vector3(x, -0.5, 1.3), 0.03, M.grey);
        this.strut(g, new THREE.Vector3(0, -0.5, 1.3), new THREE.Vector3(len, -0.5, 1.3), 0.025, M.grey);
        return g;
      }
      case 'number': {
        // a painted number on the deck
        const t = canvasText(pr.text ?? '68', pr.w ?? 6, pr.h ?? 4);
        if (!t) return null;
        const m = this.mesh(new THREE.PlaneGeometry(pr.w ?? 6, pr.h ?? 4), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }), g, 0, 0.02, 0);
        m.rotation.x = -Math.PI / 2;
        m.rotation.z = pr.turn ?? 0;
        return g;
      }
      case 'cryptVault':
        // the smooth vault of the underground church (render/cryptVault.js)
        return buildCryptVault(pr);
      case 'carrierHull':
        // the whole ship around the simulated slice of its deck (render/hull.js)
        return buildCarrierHull(pr);
      case 'church': {
        // the gothic church: everything that is more than its voxels (render/church.js)
        const d = new ChurchDrawing(pr.spec, this.world, pr, this.sunDir, this.sunLight);
        this.drawings.push(d);
        return d.group;
      }
      default:
        return null;
    }
  }

  update(dt) {
    for (const s of this.spin) s.o.rotation.y += s.rate * dt;
    for (const d of this.drawings ?? []) d.update(dt);
  }
}
