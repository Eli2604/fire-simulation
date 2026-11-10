import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * A twin-engine air-superiority fighter in the manner of the MiG-29/35 "Fulcrum"
 * family (built from its well-known layout, not from any model file): a long
 * pointed nose with a darker radome and a pitot probe, a bubble canopy, a flat
 * "pancake" centre body between two widely spaced engine nacelles, wedge
 * intakes under large wing-root extensions (LERX), swept trapezoidal wings,
 * all-moving tailplanes, twin vertical fins standing on the nacelles, two
 * nozzles, a tricycle undercarriage and rockets on pylons under the wings.
 *
 * Frame: nose towards +x, wings along ±z, up +y, wheels on y = 0. The named
 * parts (wings, tail, fins, engine) are single meshes with their own material,
 * so the flight model can darken damaged parts and drop lost ones.
 */

/** A body lofted through elliptical sections [x, half-width, half-height, centre-y]. */
function loft(sections, radial = 20) {
  const pos = [];
  const idx = [];
  sections.forEach(([x, w, hh, yc]) => {
    for (let k = 0; k < radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      // a slightly squarish ellipse (superellipse) like a real fuselage
      const c = Math.cos(a);
      const s = Math.sin(a);
      const e = 0.8;
      pos.push(x, yc + Math.sign(s) * Math.abs(s) ** e * hh, Math.sign(c) * Math.abs(c) ** e * w);
    }
  });
  for (let i = 0; i + 1 < sections.length; i++)
    for (let k = 0; k < radial; k++) {
      const a = i * radial + k;
      const b = i * radial + ((k + 1) % radial);
      const c = a + radial;
      const d = b + radial;
      idx.push(a, c, b, b, c, d);
    }
  // close the ends
  const n0 = pos.length / 3;
  pos.push(sections[0][0], sections[0][3], 0);
  const last = sections[sections.length - 1];
  pos.push(last[0], last[3], 0);
  for (let k = 0; k < radial; k++) {
    idx.push(n0, k, (k + 1) % radial);
    const base = (sections.length - 1) * radial;
    idx.push(n0 + 1, base + ((k + 1) % radial), base + k);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A flat lifting surface from its planform [x, z] points, `t` thick, at height y. */
function planform(points, t, y) {
  const s = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, z)));
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: true, bevelThickness: t * 0.4, bevelSize: Math.min(0.06, t * 0.6), bevelSegments: 2 });
  g.rotateX(Math.PI / 2); // shape z → world z, extrusion downwards
  g.translate(0, y + t / 2, 0);
  return g;
}

/** A fin from its side outline [x, y] points, `t` thick, at z, leaning outwards by `cant`. */
function fin(points, t, z, cant) {
  const s = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: true, bevelThickness: t * 0.3, bevelSize: Math.min(0.05, t * 0.5), bevelSegments: 2 });
  g.translate(0, -points[0][1], -t / 2);
  g.rotateX(cant);
  g.translate(0, points[0][1], z);
  return g;
}

function merge(list) {
  return mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => {
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    return g;
  }));
}

export function buildJetMesh(color = '#7a8590', rockets = 8) {
  const g = new THREE.Group();
  const base = new THREE.Color(color);
  // matt grey paint (a painted airframe reflects little), lighter underneath, a darker radome
  const paint = () => new THREE.MeshStandardMaterial({ color: base.clone(), metalness: 0.08, roughness: 0.62 });
  const under = new THREE.MeshStandardMaterial({ color: base.clone().lerp(new THREE.Color(0xd5dade), 0.45), metalness: 0.06, roughness: 0.6 });
  const radome = new THREE.MeshStandardMaterial({ color: base.clone().multiplyScalar(0.6), metalness: 0.05, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2c2e, metalness: 0.7, roughness: 0.45 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x8a8d90, metalness: 0.9, roughness: 0.35 });
  const black = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.9 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1b2a33, metalness: 0.9, roughness: 0.06, transparent: true, opacity: 0.78 });
  const add = (geo, mat, parent = g) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const Y = 1.65; // fuselage centre line above the ground
  // --- fuselage: nose, cockpit hump, spine, flat centre body, tail boom
  const body = loft([
    [7.9, 0.02, 0.02, Y + 0.02],
    [7.4, 0.17, 0.18, Y + 0.02],
    [6.6, 0.33, 0.35, Y + 0.03],
    [5.6, 0.46, 0.48, Y + 0.05],
    [4.5, 0.56, 0.6, Y + 0.1],
    [3.4, 0.62, 0.72, Y + 0.15],
    [2.2, 0.72, 0.68, Y + 0.12],
    [1.0, 1.05, 0.52, Y + 0.02],
    [-0.5, 1.3, 0.42, Y - 0.04],
    [-2.5, 1.38, 0.4, Y - 0.05],
    [-4.5, 1.2, 0.36, Y - 0.05],
    [-6.0, 0.7, 0.3, Y - 0.02],
    [-6.6, 0.32, 0.22, Y],
  ]);
  add(body, paint());
  const nose = loft([
    [8.6, 0.0, 0.0, Y + 0.02],
    [8.2, 0.07, 0.07, Y + 0.02],
    [7.4, 0.18, 0.19, Y + 0.02],
    [7.38, 0.18, 0.19, Y + 0.02],
  ], 16);
  add(nose, radome);
  const pitot = add(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6), metal);
  pitot.rotation.z = Math.PI / 2;
  pitot.position.set(8.8, Y + 0.02, 0);
  // --- canopy: a bubble with a frame, the cockpit sill
  const canopy = add(new THREE.SphereGeometry(0.5, 20, 12).scale(2.2, 0.75, 0.95), glass);
  canopy.position.set(3.6, Y + 0.68, 0);
  const frame = add(new THREE.TorusGeometry(0.47, 0.025, 6, 24, Math.PI), dark);
  frame.rotation.set(0, Math.PI / 2, 0);
  frame.position.set(3.2, Y + 0.62, 0);
  // --- engine nacelles under the centre body, intakes under the wing-root extensions
  const nacelles = [];
  for (const s of [-1, 1]) {
    nacelles.push(
      loft([
        [1.6, 0.36, 0.32, Y - 0.38],
        [0.6, 0.46, 0.4, Y - 0.32],
        [-2.0, 0.5, 0.44, Y - 0.25],
        [-5.0, 0.48, 0.44, Y - 0.15],
        [-6.9, 0.42, 0.42, Y - 0.1],
      ]).translate(0, 0, s * 0.95),
    );
  }
  const engine = add(merge(nacelles), under);
  // intakes: a dark mouth with a splitter plate
  for (const s of [-1, 1]) {
    const mouth = add(new THREE.BoxGeometry(0.05, 0.62, 0.7), black);
    mouth.position.set(1.62, Y - 0.38, s * 0.95);
    const lip = add(new THREE.BoxGeometry(0.9, 0.04, 0.75), under);
    lip.position.set(1.3, Y - 0.06, s * 0.95);
  }
  // nozzles: dark metal with petals, and the afterburner glow inside
  for (const s of [-1, 1]) {
    const nz = add(new THREE.CylinderGeometry(0.36, 0.42, 0.75, 16, 1, true), dark);
    nz.rotation.z = Math.PI / 2;
    nz.position.set(-7.25, Y - 0.1, s * 0.95);
    const inner = add(new THREE.CircleGeometry(0.33, 16), new THREE.MeshStandardMaterial({ color: 0x1a0d06, emissive: 0x3a1004, roughness: 0.9 }));
    inner.rotation.y = -Math.PI / 2;
    inner.position.set(-7.0, Y - 0.1, s * 0.95);
  }
  // --- wing-root extensions (LERX) and the wings
  const lerx = (s) => planform([[4.4, s * 0.58], [1.2, s * 1.45], [-0.2, s * 1.5], [-0.2, s * 0.9], [2.5, s * 0.75]], 0.06, Y - 0.02);
  add(merge([lerx(-1), lerx(1)]), paint());
  const wing = (s) => planform([[-0.1, s * 1.45], [-3.2, s * 5.6], [-4.15, s * 5.6], [-3.9, s * 1.45]], 0.13, Y - 0.08);
  const wingL = add(wing(-1), paint());
  const wingR = add(wing(1), paint());
  // --- tailplanes and twin fins
  const stab = (s) => planform([[-5.2, s * 1.5], [-6.6, s * 3.7], [-7.25, s * 3.7], [-7.05, s * 1.5]], 0.08, Y - 0.12);
  const tail = add(merge([stab(-1), stab(1)]), paint());
  const finShape = [[-3.9, Y + 0.25], [-6.1, Y + 2.8], [-6.75, Y + 2.8], [-6.85, Y + 0.25]];
  const fins = add(merge([fin(finShape, 0.09, -1.05, -0.12), fin(finShape, 0.09, 1.05, 0.12)]), paint());
  // --- undercarriage
  const gear = new THREE.Group();
  g.add(gear);
  const wheel = (x, z, r, w) => {
    const t = add(new THREE.CylinderGeometry(r, r, w, 16).rotateX(Math.PI / 2), black, gear);
    t.position.set(x, r, z);
    const hub = add(new THREE.CylinderGeometry(r * 0.45, r * 0.45, w + 0.02, 10).rotateX(Math.PI / 2), metal, gear);
    hub.position.set(x, r, z);
  };
  const strut = (x, z, top, r) => {
    const l = add(new THREE.CylinderGeometry(0.05, 0.06, top - r, 8), metal, gear);
    l.position.set(x, r + (top - r) / 2, z);
  };
  wheel(5.0, -0.12, 0.26, 0.16);
  wheel(5.0, 0.12, 0.26, 0.16);
  strut(5.0, 0, Y - 0.35, 0.26);
  for (const s of [-1, 1]) {
    wheel(-1.6, s * 1.5, 0.38, 0.24);
    strut(-1.6, s * 1.42, Y - 0.6, 0.38);
    const door = add(new THREE.BoxGeometry(1.0, 0.5, 0.02), under, gear);
    door.position.set(-1.6, Y - 0.95, s * 1.75);
  }
  // --- rockets on pylons under the wings
  const racks = [];
  for (let k = 0; k < rockets; k++) {
    const side = k % 2 ? 1 : -1;
    const z = side * (2.3 + Math.floor(k / 2) * 0.75);
    const r = new THREE.Group();
    add(new THREE.CylinderGeometry(0.085, 0.085, 2.0, 10).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd8d8d0, roughness: 0.5 }), r);
    const tip = add(new THREE.ConeGeometry(0.085, 0.3, 10).rotateZ(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x9a9a92 }), r);
    tip.position.x = 1.15;
    const pylon = add(new THREE.BoxGeometry(0.9, 0.18, 0.04), under, r);
    pylon.position.set(0, 0.13, 0);
    r.position.set(-1.7 - Math.abs(z) * 0.18, Y - 0.35, z);
    g.add(r);
    racks.push(r);
  }
  // --- the engines' flames (scaled by the flight model: y = length)
  const flame = new THREE.Group();
  flame.position.set(-7.6, Y - 0.1, 0);
  flame.rotation.z = -Math.PI / 2; // local -y points backwards
  const fm = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.7, depthWrite: false });
  for (const s of [-1, 1]) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.34, 2.5, 12), fm);
    c.position.set(0, -1.25, s * 0.95);
    c.rotation.z = Math.PI;
    flame.add(c);
  }
  g.add(flame);
  return { group: g, parts: { wingL, wingR, tail, fin: fins, engine }, canopy, flame, gear, racks };
}
