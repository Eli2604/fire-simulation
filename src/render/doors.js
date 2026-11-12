import * as THREE from 'three';
import { MATERIALS } from '../sim/materials.js';
import { F_HIDDEN } from '../sim/world.js';
import { doorGlassBroken } from '../sim/doors.js';

/**
 * Doors drawn as doors. A door is simulated as voxels (they burn, char, break,
 * block the air and the people); those voxels are hidden and this draws the door
 * itself in their place, by what it is made of:
 *
 *  - wood:      a plank door: vertical boards with gaps, wrought-iron straps with
 *               rivet heads, strap hinges, a ring pull and a keyhole plate
 *  - wood with a glass panel: an office door with a lever handle and a vision panel
 *  - steel:     a ship's watertight door: rounded panel, a raised stiffening frame,
 *               dog levers round the edge, hinge knuckles
 *  - aluminium with glass: a framed glass door with a push bar
 *  - bars (`doorBars`): a dungeon gate of wrought-iron bars riveted to flat straps,
 *               with a heavy lock box (you see, and shoot, through it)
 *
 * It swings open on its hinge when the simulation opens it, darkens as its voxels
 * char, loses its glass when that breaks, and gives way to the voxels (what is left
 * of them) once it has burnt or been blown away for the most part.
 */
let woodTex = null;

function woodTexture() {
  if (woodTex !== null) return woodTex;
  if (typeof document === 'undefined' || typeof document.createElement('canvas').getContext !== 'function') return (woodTex = undefined);
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#6b4a2c';
  ctx.fillRect(0, 0, c.width, c.height);
  for (let k = 0; k < 90; k++) {
    ctx.strokeStyle = `rgba(${35 + Math.random() * 35},${20 + Math.random() * 18},8,${0.2 + Math.random() * 0.35})`;
    ctx.lineWidth = 0.6 + Math.random() * 2;
    const x = Math.random() * c.width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    for (let y = 0; y <= c.height; y += 32) ctx.lineTo(x + Math.sin(y * 0.02 + x) * 4, y);
    ctx.stroke();
  }
  for (let k = 0; k < 4; k++) {
    // knots
    const x = Math.random() * c.width;
    const y = Math.random() * c.height;
    const g = ctx.createRadialGradient(x, y, 1, x, y, 9);
    g.addColorStop(0, 'rgba(30,16,6,0.9)');
    g.addColorStop(1, 'rgba(30,16,6,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 10, y - 10, 20, 20);
  }
  woodTex = new THREE.CanvasTexture(c);
  woodTex.colorSpace = THREE.SRGBColorSpace;
  woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping;
  return woodTex;
}

export class DoorRenderer {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.items = [];
    const std = (color, roughness, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
    this.m = {
      iron: std(0x4a4642, 0.5, 0.7),
      steel: std(0x7c8287, 0.5, 0.45),
      steelDark: std(0x4f5459, 0.55, 0.5),
      alu: std(0xb8bcc0, 0.35, 0.8),
      brass: std(0xb08d4a, 0.35, 0.85),
      veneer: std(0x8a6440, 0.6),
      glass: new THREE.MeshStandardMaterial({ color: 0x9fb8c4, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.3 }),
    };
  }

  setWorld(world) {
    this.group.clear();
    this.items = [];
    this.world = world;
    world.doors.forEach((d, k) => {
      const it = this.build(world, d, k);
      if (it) this.items.push(it);
    });
  }

  /** The door's box, the axis it is thin along, what it is made of. */
  measure(w, d) {
    const vox = d.open && d.saved ? d.saved.map((s) => s.i) : d.voxels;
    if (!vox.length) return null;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    const count = {};
    for (const i of vox) {
      const c = w.coords(i);
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], c[a]);
        hi[a] = Math.max(hi[a], c[a]);
      }
      const m = MATERIALS[w.mat[i]]?.name ?? 'wood';
      count[m] = (count[m] ?? 0) + 1;
    }
    const h = w.h;
    const size = [0, 1, 2].map((a) => (hi[a] - lo[a] + 1) * h);
    const thinAxis = size[0] < size[2] ? 0 : 2;
    const main = Object.entries(count).filter(([m]) => m !== 'glass').sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'wood';
    const glass = d.glass.length > 0;
    let glassBox = null;
    if (glass) {
      const gl = [Infinity, Infinity, Infinity];
      const gh = [-Infinity, -Infinity, -Infinity];
      for (const i of d.glass) {
        const c = w.coords(i);
        for (let a = 0; a < 3; a++) {
          gl[a] = Math.min(gl[a], c[a]);
          gh[a] = Math.max(gh[a], c[a]);
        }
      }
      glassBox = { lo: gl.map((v) => v * h), hi: gh.map((v) => (v + 1) * h) };
    }
    return { lo: lo.map((v) => v * h), hi: hi.map((v, a) => (v + 1) * h), size, thinAxis, main, glassBox };
  }

  build(w, d, k) {
    const geo = this.measure(w, d);
    if (!geo) return null;
    const { lo, hi, size, thinAxis, main, glassBox } = geo;
    const wide = thinAxis === 0 ? 2 : 0; // the axis the door is wide along
    const W = size[wide];
    const H = size[1];
    const T = Math.max(0.045, Math.min(0.09, size[thinAxis]));
    // the pivot: at the hinge edge (low end of the wide axis), mid-thickness, on the floor
    const pivot = new THREE.Group();
    const mid = (lo[thinAxis] + hi[thinAxis]) / 2;
    if (wide === 0) pivot.position.set(lo[0], lo[1], mid);
    else pivot.position.set(mid, lo[1], lo[2]);
    pivot.rotation.y = wide === 0 ? 0 : -Math.PI / 2; // local +x along the door's width
    const leaf = new THREE.Group();
    pivot.add(leaf);
    const type = d.bars ? 'bars' : main === 'steel' ? 'steel' : main === 'aluminium' ? 'glass' : glassBox ? 'office' : 'plank';
    const parts = this[type](leaf, W, H, T, glassBox, lo, wide);
    leaf.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.group.add(pivot);
    // hide the voxels it stands for
    for (const i of d.voxels) w.flags[i] |= F_HIDDEN;
    w.geomVersion++;
    return { d, k, pivot, leaf, angle: 0, n0: d.voxels.length, glassMeshes: parts?.glass ?? [], mats: parts?.mats ?? [], gone: false };
  }

  box(parent, mat, w, h, t, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, t), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  /** A dungeon gate: round wrought-iron bars through flat straps, hinges, a lock box. */
  bars(leaf, W, H) {
    const iron = this.m.iron.clone();
    iron.color.setHex(0x3a3633);
    iron.roughness = 0.65;
    const n = Math.max(4, Math.round(W / 0.13));
    const bar = new THREE.CylinderGeometry(0.014, 0.014, H - 0.02, 8);
    for (let k = 0; k < n; k++) {
      const m = new THREE.Mesh(bar, iron);
      m.position.set((W * (k + 0.5)) / n, H / 2, 0);
      leaf.add(m);
      // a spike where the bar comes through the top strap
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.06, 6), iron);
      tip.position.set((W * (k + 0.5)) / n, H - 0.03, 0);
      leaf.add(tip);
    }
    for (const y of [0.08, H * 0.45, H - 0.12]) {
      this.box(leaf, iron, W, 0.05, 0.022, W / 2, y, 0);
      for (let k = 0; k < n; k++) {
        const r = new THREE.Mesh(new THREE.SphereGeometry(0.01, 6, 4), iron);
        r.position.set((W * (k + 0.5)) / n, y, 0.014);
        leaf.add(r);
      }
    }
    // hinge knuckles on the hinge side, the frame stile on both edges
    this.box(leaf, iron, 0.04, H, 0.04, 0.02, H / 2, 0);
    this.box(leaf, iron, 0.04, H, 0.04, W - 0.02, H / 2, 0);
    for (const y of [0.2, H - 0.25]) {
      const knuckle = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.14, 10), iron);
      knuckle.position.set(0, y, 0);
      leaf.add(knuckle);
    }
    // the lock: a box on the strap at hand height, a keyhole, a hasp
    this.box(leaf, iron, 0.14, 0.18, 0.07, W - 0.12, H * 0.45, 0.02);
    this.box(leaf, new THREE.MeshBasicMaterial({ color: 0x050403 }), 0.012, 0.035, 0.005, W - 0.12, H * 0.45 - 0.02, 0.058);
    return { mats: [iron] };
  }

  /** A plank door with iron straps (catacombs, cellars). */
  plank(leaf, W, H, T) {
    const tex = woodTexture();
    const n = Math.max(3, Math.round(W / 0.15));
    const pw = W / n;
    const mats = [];
    for (let k = 0; k < n; k++) {
      const tone = 0.78 + 0.3 * Math.random();
      const mat = new THREE.MeshStandardMaterial({ map: tex ?? null, color: new THREE.Color(0.82 * tone, 0.72 * tone, 0.62 * tone), roughness: 0.85 });
      if (tex) {
        mat.map = tex.clone();
        mat.map.needsUpdate = true;
        mat.map.offset.set(Math.random(), Math.random());
        mat.map.repeat.set(0.4, H / 2);
      }
      mats.push(mat);
      this.box(leaf, mat, pw - 0.008, H - 0.01, T * (0.92 + Math.random() * 0.1), pw * (k + 0.5), H / 2, 0);
    }
    // wrought-iron straps across, with rivets; strap hinges on the hinge side
    for (const y of [0.25, H * 0.5, H - 0.25]) {
      this.box(leaf, this.m.iron, W * 0.96, 0.075, 0.014, W / 2, y, T / 2 + 0.007);
      for (let x = 0.07; x < W - 0.04; x += 0.15) {
        const r = new THREE.Mesh(new THREE.SphereGeometry(0.011, 6, 4), this.m.iron);
        r.position.set(x, y, T / 2 + 0.013);
        leaf.add(r);
      }
      const knuckle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 8), this.m.iron);
      knuckle.position.set(0, y, 0);
      leaf.add(knuckle);
    }
    // ring pull and keyhole plate
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.008, 6, 16), this.m.iron);
    ring.position.set(W - 0.14, H * 0.47, T / 2 + 0.02);
    leaf.add(ring);
    this.box(leaf, this.m.iron, 0.05, 0.1, 0.01, W - 0.14, H * 0.55, T / 2 + 0.006);
    return { mats };
  }

  /** An office door: veneer, frame lines, lever handle, a vision panel. */
  office(leaf, W, H, T, gb, lo, wide) {
    const mat = this.m.veneer.clone();
    const glass = [];
    if (gb) {
      // the panel's place in the door (local x from the hinge side)
      const g0 = gb.lo[wide] - lo[wide];
      const g1 = gb.hi[wide] - lo[wide];
      const y0 = gb.lo[1] - lo[1];
      const y1 = gb.hi[1] - lo[1];
      this.box(leaf, mat, W, y0, T, W / 2, y0 / 2, 0);
      this.box(leaf, mat, W, H - y1, T, W / 2, (y1 + H) / 2, 0);
      this.box(leaf, mat, g0, y1 - y0, T, g0 / 2, (y0 + y1) / 2, 0);
      this.box(leaf, mat, W - g1, y1 - y0, T, (g1 + W) / 2, (y0 + y1) / 2, 0);
      glass.push(this.box(leaf, this.m.glass, g1 - g0, y1 - y0, 0.008, (g0 + g1) / 2, (y0 + y1) / 2, 0));
      // the glazing bead
      for (const [w2, h2, x, y] of [[g1 - g0 + 0.04, 0.02, (g0 + g1) / 2, y0], [g1 - g0 + 0.04, 0.02, (g0 + g1) / 2, y1], [0.02, y1 - y0, g0, (y0 + y1) / 2], [0.02, y1 - y0, g1, (y0 + y1) / 2]])
        this.box(leaf, this.m.steelDark, w2, h2, T + 0.01, x, y, 0);
    } else this.box(leaf, mat, W, H, T, W / 2, H / 2, 0);
    // lever handles both sides, an escutcheon
    for (const s of [-1, 1]) {
      this.box(leaf, this.m.alu, 0.03, 0.14, 0.012, W - 0.09, 1.0, s * (T / 2 + 0.006));
      this.box(leaf, this.m.alu, 0.13, 0.018, 0.018, W - 0.13, 1.03, s * (T / 2 + 0.04));
    }
    return { mats: [mat], glass };
  }

  /** A ship's watertight door. */
  steel(leaf, W, H, T) {
    const mat = this.m.steel.clone();
    this.box(leaf, mat, W, H, T, W / 2, H / 2, 0);
    // a raised stiffening frame and a cross stiffener
    for (const [w2, h2, x, y] of [[W - 0.08, 0.05, W / 2, 0.08], [W - 0.08, 0.05, W / 2, H - 0.08], [0.05, H - 0.16, 0.08, H / 2], [0.05, H - 0.16, W - 0.08, H / 2], [W - 0.16, 0.04, W / 2, H / 2]])
      this.box(leaf, this.m.steelDark, w2, h2, 0.03, x, y, T / 2 + 0.015);
    // dog levers round the edge (closing the door tight on its gasket)
    for (const [x, y, a] of [[W - 0.05, 0.35, 0], [W - 0.05, H / 2, 0], [W - 0.05, H - 0.35, 0], [W / 2, H - 0.05, Math.PI / 2], [W / 2, 0.05, Math.PI / 2], [0.05, H / 2, 0]]) {
      const lever = this.box(leaf, this.m.steelDark, 0.03, 0.16, 0.03, x, y, T / 2 + 0.03);
      lever.rotation.z = a + 0.4;
    }
    for (const y of [0.3, H - 0.3]) {
      const k = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 10), this.m.steelDark);
      k.position.set(0, y, 0);
      leaf.add(k);
    }
    return { mats: [mat] };
  }

  /** A framed glass door. */
  glass(leaf, W, H, T) {
    const f = 0.05;
    const glass = [this.box(leaf, this.m.glass, W - 2 * f, H - 2 * f, 0.01, W / 2, H / 2, 0)];
    for (const [w2, h2, x, y] of [[W, f, W / 2, f / 2], [W, f, W / 2, H - f / 2], [f, H, f / 2, H / 2], [f, H, W - f / 2, H / 2]]) this.box(leaf, this.m.alu, w2, h2, T, x, y, 0);
    for (const s of [-1, 1]) this.box(leaf, this.m.alu, W * 0.7, 0.03, 0.03, W / 2, 1.0, s * (T / 2 + 0.04));
    return { glass };
  }

  update(dt) {
    const w = this.world;
    if (!w) return;
    for (const it of this.items) {
      if (it.gone) continue;
      const d = it.d;
      // swing to open / shut
      const want = d.open ? -1.55 : 0;
      it.angle += (want - it.angle) * Math.min(1, dt * 5);
      it.leaf.rotation.y = it.angle;
      // burnt or blown away for the most part: show what is left of the voxels instead
      if (!d.open) {
        // (a door that was shut again has its voxels back: drawn by this, not as voxels)
        if (d.voxels.some((i) => w.mat[i] && !(w.flags[i] & F_HIDDEN))) {
          for (const i of d.voxels) if (w.mat[i]) w.flags[i] |= F_HIDDEN;
          w.geomVersion++;
        }
        let left = 0;
        let ch = 0;
        for (const i of d.voxels)
          if (w.mat[i] && w.doorTag[i] === it.k + 1) {
            left++;
            ch += w.char[i];
          }
        if (left < it.n0 * 0.75) {
          it.gone = true;
          it.pivot.visible = false;
          for (const i of d.voxels) if (w.mat[i]) w.flags[i] &= ~F_HIDDEN;
          w.geomVersion++;
          continue;
        }
        const dark = 1 - 0.8 * (left ? ch / left : 0);
        for (const m of it.mats) {
          m.userData.base ??= m.color.clone();
          m.color.copy(m.userData.base).multiplyScalar(dark);
        }
        for (const g of it.glassMeshes) g.visible = !doorGlassBroken(w, it.k);
      }
    }
  }
}
