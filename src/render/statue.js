import * as THREE from 'three';
import { MAT } from '../sim/materials.js';
import { F_FALLING, F_LIQUID, F_HIDDEN } from '../sim/world.js';
import { loadPolyHavenModel } from './assets.js';
import { buildLaundry } from './laundry.js';

// objects built here rather than loaded (the wash on a line)
const PROCEDURAL = { laundry: buildLaundry };

/**
 * A scanned object (a stone statue, brass candelabra: models/statue.js, candelabra.js)
 * drawn over its voxels, and damaged with them. It is simulated as hidden voxels of its
 * material (heat, soot, cracks, spalling, melting, blasts); this draws the scan (loaded
 * from Poly Haven) where they are, every triangle tied to its nearest voxel:
 *
 *  - a voxel blown off or falling: its part of the object leaves the mesh and goes with the
 *    fragment, tumbling through the air and lying where it lands (as that piece of the
 *    object, not a block); the rest stands, or falls with it;
 *  - soot: it blackens where it has been hot (the voxel's char), the pieces too;
 *  - heat: it glows dull red, then orange; molten (brass) it is gone from the object;
 *  - flames standing on it (candles on a candelabrum) go out when their part is gone.
 *
 * The state of its voxels goes to the shader as a small texture (one texel a voxel).
 * Without the scan (no connection) the voxels are shown as they are.
 */
export class StatueDrawing {
  constructor(pr, world, group) {
    this.world = world;
    this.group = group;
    this.pr = pr;
    this.ready = false;
    this.t = 0;
    this.matIds = new Set((pr.materials ?? [pr.material ?? 'sandstone']).map((n) => MAT[n]));
    // its voxels, as they are now (before anything can happen to them): the scan is tied to these
    this.own = [];
    const R = pr.radius ?? 2.5;
    for (let k = 0; k < world.solidCount; k++) {
      const i = world.solids[k];
      if (!this.matIds.has(world.mat[i]) || !(world.flags[i] & F_HIDDEN)) continue;
      const c = world.center(...world.coords(i));
      if (Math.hypot(c[0] - pr.p[0], c[2] - pr.p[2]) >= R) continue;
      // (and within its height, when it says: not the deck under an oil drum)
      if (pr.height && (c[1] < pr.p[1] - world.h || c[1] > pr.p[1] + pr.height + world.h)) continue;
      this.own.push(i);
    }
    // the flames standing on it (they go out with their part)
    this.flames = pr.tag ? world.heaters.filter((h) => h.tag === pr.tag) : [];
    if (typeof document === 'undefined') return;
    if (pr.procedural) {
      // (once its group is in the scene: right after this returns)
      Promise.resolve().then(() => this.build(PROCEDURAL[pr.procedural](pr)));
      return;
    }
    loadPolyHavenModel(pr.polyhaven)
      .then((scene) => this.build(scene))
      .catch((e) => {
        // no scan: show the voxels themselves
        console.warn('scan', pr.polyhaven, e);
        for (const i of this.own) world.flags[i] &= ~F_HIDDEN;
      });
  }

  build(scene) {
    const w = this.world;
    const pr = this.pr;
    const o = scene.clone(true);
    o.scale.setScalar(pr.scale ?? 1);
    this.group.add(o);
    this.group.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.group.parent.matrixWorld).invert();
    const meshes = [];
    o.traverse((c) => c.isMesh && !c.userData.unbound && meshes.push(c));
    // the centres of its voxels: every triangle goes with the nearest
    const C = this.own.map((i) => w.center(...w.coords(i)));
    const nearest = (p) => {
      let best = -1;
      let bd = Infinity;
      for (let k = 0; k < C.length; k++) {
        const d = (C[k][0] - p.x) ** 2 + (C[k][1] - p.y) ** 2 + (C[k][2] - p.z) ** 2;
        if (d < bd) {
          bd = d;
          best = k;
        }
      }
      return best;
    };
    this.uniforms = { uState: { value: null }, uSlots: { value: 1 }, uRows: { value: 1 }, uTime: { value: 0 }, uLineY: { value: pr.line?.H ?? 0 } };
    this.src = [];
    this.pieces = new Map(); // slot -> the mesh of its piece, once it has broken off
    const v = new THREE.Vector3();
    for (const m of meshes) {
      if (pr.hideFlames && /flame/i.test(m.material?.name ?? '')) {
        m.visible = false; // (our own flames burn there)
        continue;
      }
      // its own candles cut out, where ours stand instead (`pr.cut`: candles of their own, sim/patches.js)
      if (pr.cut && /_candles$/i.test(m.material?.name ?? '')) {
        m.visible = false;
        continue;
      }
      let geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      if (pr.cut) geo = cutCylinders(geo, new THREE.Matrix4().copy(o.matrixWorld).invert().multiply(m.matrixWorld), pr.cut);
      const pos = geo.getAttribute('position');
      const slot = new Float32Array(pos.count);
      const M = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
      const wp = new Float32Array(pos.count * 3);
      for (let k = 0; k < pos.count; k++) {
        v.fromBufferAttribute(pos, k).applyMatrix4(M);
        wp[k * 3] = v.x;
        wp[k * 3 + 1] = v.y;
        wp[k * 3 + 2] = v.z;
      }
      for (let k = 0; k < pos.count; k += 3) {
        v.set((wp[k * 3] + wp[k * 3 + 3] + wp[k * 3 + 6]) / 3, (wp[k * 3 + 1] + wp[k * 3 + 4] + wp[k * 3 + 7]) / 3, (wp[k * 3 + 2] + wp[k * 3 + 5] + wp[k * 3 + 8]) / 3);
        slot[k] = slot[k + 1] = slot[k + 2] = nearest(v);
      }
      geo.setAttribute('aSlot', new THREE.BufferAttribute(slot, 1));
      m.geometry = geo;
      this.src.push({ wp, slot, uv: geo.getAttribute('uv'), base: m.material });
      m.material = this.patched(m.material, true);
      m.castShadow = false; // (its shadow would not lose the parts that are gone)
      m.receiveShadow = true;
    }
    this.slots = this.own;
    // (in rows of 1024: some graphics cards take no textures wider than 4096)
    const n = Math.max(1, this.slots.length);
    const W = Math.min(n, 1024);
    const H = Math.ceil(n / W);
    this.data = new Float32Array(W * H * 4);
    this.tex = new THREE.DataTexture(this.data, W, H, THREE.RGBAFormat, THREE.FloatType);
    this.uniforms.uState.value = this.tex;
    this.uniforms.uSlots.value = W;
    this.uniforms.uRows.value = H;
    // which part each flame stands on
    for (const f of this.flames) f.statueSlot = nearest(new THREE.Vector3(...f.pos));
    this.ready = true;
    this.refresh();
  }

  /**
   * The scan's material with the damage on it: the whole object (its parts' state from the
   * texture) or one broken-off piece (its own soot and glow, uniform uPiece).
   */
  patched(base, whole) {
    const mat = base.clone();
    const U = whole ? this.uniforms : { uPiece: { value: new THREE.Vector2(0, 0) } };
    mat.userData.U = U;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace(
          '#include <common>',
          whole ? '#include <common>\nattribute float aSlot;\nuniform sampler2D uState;\nuniform float uSlots;\nuniform float uRows;\nuniform float uTime;\nuniform float uLineY;\nvarying vec4 vState;' : '#include <common>\nuniform vec2 uPiece;\nvarying vec4 vState;',
        )
        .replace(
          '#include <begin_vertex>',
          whole
            ? `#include <begin_vertex>
vState = texture2D(uState, vec2((mod(aSlot, uSlots) + 0.5) / uSlots, (floor(aSlot / uSlots) + 0.5) / uRows));
${this.pr.sway ? '// hanging cloth sways in the breeze, more lower down\nfloat hang = clamp(uLineY - transformed.y, 0.0, 1.5);\ntransformed.z += hang * hang * (0.06 * sin(uTime * 1.6 + transformed.x * 1.3) + 0.025 * sin(uTime * 4.1 + transformed.x * 5.0));' : ''}
// its voxel gone (blown off, fallen, molten): this part is not drawn here
if (vState.r < 0.5) transformed = vec3(0.0);`
            : '#include <begin_vertex>\nvState = vec4(1.0, uPiece.x, uPiece.y, 0.0);',
        );
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec4 vState;')
        .replace('#include <color_fragment>', '#include <color_fragment>\n// soot where it has been hot\ndiffuseColor.rgb *= 1.0 - 0.88 * vState.g;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n// glowing hot: dull red to orange\ntotalEmissiveRadiance += vec3(1.0, 0.33, 0.08) * vState.b * vState.b * 2.5;');
    };
    mat.customProgramCacheKey = () => (whole ? `scan-whole-v4${this.pr.sway ? '-sway' : ''}` : 'scan-piece-v2');
    return mat;
  }

  /** Is voxel i (of this object) in place: its material, not falling, not molten, not a piece lying there? */
  inPlace(i) {
    const w = this.world;
    return this.matIds.has(w.mat[i]) && !(w.flags[i] & (F_FALLING | F_LIQUID)) && !w.pieceOf?.has(i);
  }

  /** The piece of the object that was voxel slot k: its triangles, round that voxel's centre. */
  piece(k) {
    if (this.pieces.has(k)) return this.pieces.get(k);
    const w = this.world;
    const c = w.center(...w.coords(this.slots[k]));
    const g = new THREE.Group();
    for (const s of this.src) {
      const P = [];
      const U = [];
      for (let v = 0; v < s.slot.length; v += 3) {
        if (s.slot[v] !== k) continue;
        for (let j = 0; j < 3; j++) {
          P.push(s.wp[(v + j) * 3] - c[0], s.wp[(v + j) * 3 + 1] - c[1], s.wp[(v + j) * 3 + 2] - c[2]);
          if (s.uv) U.push(s.uv.getX(v + j), s.uv.getY(v + j));
        }
      }
      if (!P.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      if (U.length) geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, this.patched(s.base, false));
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    g.visible = false;
    this.group.parent.add(g);
    this.pieces.set(k, g);
    return g;
  }

  /** Every piece that has broken off, where its fragment is: flying (tumbling) or lying. */
  placePieces() {
    const w = this.world;
    const flying = new Map();
    for (const d of w.debris) if (d.meshPiece) flying.set(d.origin, d);
    const lying = new Map();
    if (w.pieceOf) for (const [j, i] of w.pieceOf) if (this.matIds.has(w.mat[j])) lying.set(i, j);
    this.slots.forEach((i, k) => {
      if (this.inPlace(i)) {
        if (this.pieces.has(k)) this.pieces.get(k).visible = false;
        return;
      }
      const d = flying.get(i);
      const j = lying.get(i);
      if (!d && j === undefined) {
        if (this.pieces.has(k)) this.pieces.get(k).visible = false;
        return;
      }
      const g = this.piece(k);
      g.visible = true;
      const r = ((i * 2654435761) % 1000) / 1000;
      // its own soot and glow: from the fragment, or the voxel it lies as
      const ch = d ? d.char : w.char[j];
      const T = d ? Math.max(d.temp, d.skin) : Math.max(w.temp[j], w.skin[j]);
      for (const m of g.children) m.material.userData.U.uPiece.value.set(ch, Math.min(1, Math.max(0, (T - 480) / 700)));
      if (d) {
        g.position.set(d.p[0], d.p[1], d.p[2]);
        g.rotation.set(d.age * (5 + 4 * r) + r * 6, d.age * (3 + 3 * r), d.age * 2 * r);
      } else {
        // lying where it landed, on one of its sides
        const c = w.center(...w.coords(j));
        g.position.set(c[0], c[1] - w.h * 0.25, c[2]);
        g.rotation.set(Math.round(r * 3) * (Math.PI / 2) + 0.3 * (r - 0.5), r * 6.28, 0.3 * (r - 0.5));
      }
    });
  }

  refresh() {
    const w = this.world;
    const D = this.data;
    this.slots.forEach((i, k) => {
      const there = this.inPlace(i);
      D[k * 4] = there ? 1 : 0;
      D[k * 4 + 1] = there ? w.char[i] : 0;
      const T = Math.max(w.temp[i], w.skin[i]);
      D[k * 4 + 2] = there ? Math.min(1, Math.max(0, (T - 480) / 700)) : 0;
    });
    this.tex.needsUpdate = true;
    // a flame whose part is gone goes out (a candelabrum blown over, melted)
    for (const f of this.flames) if (f.on !== false && f.statueSlot >= 0 && !this.inPlace(this.slots[f.statueSlot])) f.on = false;
  }

  update(dt) {
    if (!this.ready) return;
    this.uniforms.uTime.value += dt;
    this.placePieces();
    this.t += dt;
    if (this.t < 0.25) return;
    this.t = 0;
    this.refresh();
  }
}

/**
 * The triangles of a scan inside any of the upright cylinders `cuts` ([x, z, y0, y1, r] in
 * the scan's own frame; M: the mesh's vertices to that frame) left out: a scanned candelabra's
 * candles, where candles of our own stand in its cups.
 */
function cutCylinders(geo, M, cuts) {
  const pos = geo.getAttribute('position');
  const v = new THREE.Vector3();
  const keep = [];
  for (let t = 0; t < pos.count; t += 3) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let e = 0; e < 3; e++) {
      v.fromBufferAttribute(pos, t + e).applyMatrix4(M);
      cx += v.x / 3;
      cy += v.y / 3;
      cz += v.z / 3;
    }
    const inside = cuts.some(([x, z, y0, y1, r]) => cy > y0 && cy < y1 && (cx - x) ** 2 + (cz - z) ** 2 < r * r);
    if (!inside) keep.push(t);
  }
  if (keep.length * 3 === pos.count) return geo;
  const out = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(geo.attributes)) {
    const n = a.itemSize;
    const arr = new a.array.constructor(keep.length * 3 * n);
    keep.forEach((t, k) => {
      for (let j = 0; j < 3 * n; j++) arr[k * 3 * n + j] = a.array[t * n + j];
    });
    out.setAttribute(name, new THREE.BufferAttribute(arr, n, a.normalized));
  }
  return out;
}
