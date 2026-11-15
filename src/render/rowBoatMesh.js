import * as THREE from 'three';
import { rowBoatHull } from '../sim/buoyancy.js';
import { thwartsOf } from '../models/rowBoat.js';

/**
 * A rowing boat drawn (models/rowBoat.js; render/floats.js puts it in its pose on the water, the
 * rig's Row boat shows it): its hull is the very shape it floats by (sim/buoyancy.js
 * rowBoatHull: keel, sheer, half-breadths), planked outside in the hull colour and inside in the
 * inside colour, a stripe along the sheer, the transom, a rubbing strake, floorboards, the
 * thwarts, rowlocks and a pair of oars laid along the thwarts.
 * Frame: the hull's (origin on the keel amidships, bow to +x, port −z, up +y).
 *   const m = buildRowBoatMesh(params)   // { group, hullMats: [...], dispose }
 */
export function buildRowBoatMesh(params = {}) {
  const p = { length: 4.3, beam: 1.45, depth: 0.62, thwarts: 3, oars: true, hullColor: '#b3332a', insideColor: '#c9b48a', stripeColor: '#efe9da', material: 'wood', ...params };
  const hull = rowBoatHull(p);
  const group = new THREE.Group();
  const metal = p.material === 'aluminium';
  const grp = p.material === 'grp';
  const outside = new THREE.MeshStandardMaterial({ color: p.hullColor, roughness: metal ? 0.35 : grp ? 0.3 : 0.6, metalness: metal ? 0.6 : 0, side: THREE.FrontSide });
  const inside = new THREE.MeshStandardMaterial({ color: p.insideColor, roughness: 0.8, metalness: metal ? 0.5 : 0, side: THREE.BackSide });
  const stripe = new THREE.MeshStandardMaterial({ color: p.stripeColor, roughness: 0.55, side: THREE.DoubleSide });
  const wood = new THREE.MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.85 });
  const oarWood = new THREE.MeshStandardMaterial({ color: 0xc7a874, roughness: 0.7 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.5, metalness: 0.7 });
  const shadow = (m) => ((m.castShadow = true), (m.receiveShadow = true), m);

  // the shell: stations bow to stern, each section from the port sheer down to the keel and up to
  // the starboard sheer (its points from the same half-breadths it floats by)
  const shellGeo = (y0, y1, out = 0, ns = 36, nm = 10) => {
    const pos = [];
    const idx = [];
    const cols = 2 * nm + 1;
    for (let i = 0; i <= ns; i++) {
      const x = hull.x0 + ((hull.x1 - hull.x0) * i) / ns;
      const k = hull.keel(x), s = hull.sheer(x);
      const a = y0 === null ? k : Math.max(k, s + y0), b = y1 === null ? s : s + y1;
      for (let j = 0; j < cols; j++) {
        const side = j < nm ? -1 : 1;
        const f = Math.abs(j - nm) / nm; // 0 at the keel, 1 at the sheer
        const y = a + (b - a) * f;
        const z = side * (hull.half(x, Math.min(s - 1e-5, Math.max(k + 1e-5, y))) + out);
        pos.push(x, y, i === ns ? z * 0.02 : z); // (the stem closes)
      }
    }
    for (let i = 0; i < ns; i++)
      for (let j = 0; j < cols - 1; j++) {
        const q = i * cols + j;
        idx.push(q, q + cols, q + 1, q + 1, q + cols, q + cols + 1);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  const shell = shellGeo(null, null);
  group.add(shadow(new THREE.Mesh(shell, outside)), new THREE.Mesh(shell, inside));
  // the stripe along the sheer, the rubbing strake on top of the planking
  group.add(new THREE.Mesh(shellGeo(-0.09, 0, 0.004, 36, 1), stripe));
  const strake = shadow(new THREE.Mesh(shellGeo(-0.025, 0.012, 0.016, 36, 1), wood));
  group.add(strake);
  // the transom: the stern section, a flat board
  {
    const x = hull.x0 + 1e-4;
    const k = hull.keel(x), s = hull.sheer(x);
    const pts = [];
    const n = 10;
    for (let j = 0; j <= n; j++) {
      const y = k + ((s - k) * j) / n;
      pts.push(new THREE.Vector2(hull.half(x, Math.min(s - 1e-5, y)), y));
    }
    for (let j = n; j >= 0; j--) pts.push(new THREE.Vector2(-pts[j].x, pts[j].y));
    const g = new THREE.ShapeGeometry(new THREE.Shape(pts)).rotateY(Math.PI / 2).translate(x, 0, 0);
    const t = shadow(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: p.hullColor, roughness: 0.6, side: THREE.DoubleSide })));
    group.add(t);
  }
  // the floorboards
  const fy = hull.keel(0) + 0.07;
  const fw = 2 * hull.half(0, fy + 0.03) * 0.92;
  const floor = shadow(new THREE.Mesh(new THREE.BoxGeometry(p.length * 0.6, 0.02, Math.max(0.1, fw)), wood));
  floor.position.set(-0.03 * p.length, fy, 0);
  group.add(floor);
  // the thwarts, the rowlocks by the middle one
  const th = thwartsOf(p, hull);
  for (const t of th) {
    const m = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.026, Math.max(0.1, 2 * t.half - 0.02)), wood));
    m.position.set(t.x, t.y - 0.013, 0);
    group.add(m);
  }
  const mid = th.length ? th.reduce((a, b) => (Math.abs(b.x) < Math.abs(a.x) ? b : a)) : null;
  if (mid)
    for (const sd of [-1, 1]) {
      const x = mid.x + 0.32;
      const s = hull.sheer(x);
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 5, 10, Math.PI), iron);
      r.position.set(x, s + 0.01, sd * hull.half(x, s - 0.01));
      r.rotation.y = Math.PI / 2;
      group.add(r);
    }
  // the oars, laid along the thwarts (blades forward)
  const oars = [];
  if (p.oars && th.length) {
    const oy = Math.max(...th.map((t) => t.y)) + 0.03;
    for (const sd of [-1, 1]) {
      const z = sd * Math.min(0.32, p.beam * 0.22);
      const o = new THREE.Group();
      const shaft = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, p.length * 0.51, 8).rotateZ(Math.PI / 2), oarWood));
      shaft.position.x = -0.015 * p.length;
      const blade = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.012, 0.14), oarWood));
      blade.position.x = p.length * 0.24 + 0.27;
      o.add(shaft, blade);
      o.position.set(0, oy, z);
      group.add(o);
      oars.push(o);
    }
  }
  // the oars out, being pulled (sim/boats.js f.row.oars): each pivots at its rowlock, its loom
  // inboard to the rower's hands, its blade out over the water; swept fore and aft (yaw about the
  // rowlock), the blade dipped in for the drive and lifted for the recovery
  const sweeps = [];
  if (p.oars && mid) {
    const x = mid.x + 0.32;
    const s = hull.sheer(x);
    for (const sd of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, s + 0.03, sd * hull.half(x, s - 0.01));
      const arm = new THREE.Group(); // (dips: about the boat's x axis)
      const inb = 0.78, outb = 1.55;
      const shaft = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, inb + outb, 8).rotateX(Math.PI / 2), oarWood));
      shaft.position.z = sd * (outb - inb) / 2;
      const blade = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.012, 0.5), oarWood));
      blade.rotation.z = Math.PI / 2; // (squared: the blade upright in the water)
      blade.position.z = sd * (outb - 0.2);
      arm.add(shaft, blade);
      pivot.add(arm);
      pivot.visible = false;
      group.add(pivot);
      sweeps.push({ pivot, arm, sd });
    }
  }
  /** The oars from the rowing state (null: shipped, laid along the thwarts). */
  const setOars = (row) => {
    const out = !!row && row.oars?.some((o) => o.out);
    for (const o of oars) o.visible = !out;
    for (const [k, s] of sweeps.entries()) {
      s.pivot.visible = out;
      if (!out) continue;
      const o = row.oars[k];
      // sweep: + the blade towards the bow; dip: the blade down into the water (the loom up)
      s.pivot.rotation.y = s.sd * o.sweep;
      s.arm.rotation.x = s.sd * (o.dip > 0 ? 0.28 : -0.08) * (o.dip > 0 ? o.dip : 1);
    }
  };
  const hullMats = [outside, inside, stripe];
  for (const m of [outside, inside, stripe, wood, oarWood]) m.userData.base = m.color.clone();
  return {
    group,
    hull,
    oars,
    setOars,
    hullMats,
    woodMats: [wood, oarWood],
    dims: [p.length, hull.D, p.beam],
    dispose: () =>
      group.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry.dispose();
        o.material.dispose?.();
      }),
  };
}
