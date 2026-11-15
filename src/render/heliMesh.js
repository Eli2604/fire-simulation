/**
 * The helicopter drawn (ai/helicopter.js flies it): a Black Hawk-like utility helicopter with its
 * moving parts. A cabin open inside (floor, benches, the door openings: the men are seen in it), the
 * cockpit with its glass (cracked white once shot), the engines on the roof with their exhausts,
 * the mast and a four-blade main rotor, the tail boom and fin, a four-blade tail rotor on the right
 * of the fin, skids on struts, a sliding door each side and a pintle machine gun in each door.
 *
 * Frame: front +x, up +y, right +z, skids on y = 0 (the same as models/vehicleZones.js
 * VEHICLE_ZONES.helicopter); poseHeli sets the group's matrix from the helicopter's axes (heliAxes:
 * makeBasis), so the zones, the seats and the mesh agree.
 *
 *   const m = buildHeliMesh({ color });
 *   scene.add(m.group);
 *   poseHeli(m, heli);   // every frame: where, attitude, rotors, doors, guns, what is shot away
 *   m.dispose();
 */
import * as THREE from 'three';
import { heliAxes, DOOR, HELI, BOOM_ROOT } from '../ai/helicopter.js';

const shadow = (m) => ((m.castShadow = m.receiveShadow = true), m);

/**
 * The tail: the boom from x0 aft (tapering), the fin, the stabiliser and the tail rotor (on the
 * right of the fin, turning about z), into `parent`, everything shifted by -off (the detached
 * piece has its origin at the break, BOOM_ROOT). Returns { tailRotor }.
 */
function tailParts(parent, mats, x0, off = [0, 0, 0]) {
  const at = (x, y, z) => [x - off[0], y - off[1], z - off[2]];
  const mesh = (geo, mat, p) => {
    const m = shadow(new THREE.Mesh(geo, mat));
    m.position.set(...p);
    parent.add(m);
    return m;
  };
  // the boom: 0.48 m round at the cabin (x -1.9), 0.24 m at the fin (x -9.3)
  const x1 = -9.3;
  const rAt = (x) => 0.48 + ((x + 1.9) / (x1 + 1.9)) * (0.24 - 0.48);
  const boom = mesh(new THREE.CylinderGeometry(rAt(x1), rAt(x0), x0 - x1, 14), mats.paint, at((x0 + x1) / 2, 2.05, 0));
  boom.rotation.z = Math.PI / 2; // (the narrow end aft: rotation.z +π/2 puts the cylinder's top at -x)
  const fin = mesh(new THREE.BoxGeometry(1.1, 1.9, 0.14), mats.paint, at(-9.1, 2.95, 0));
  fin.rotation.z = 0.25;
  mesh(new THREE.BoxGeometry(0.9, 0.06, 2.9), mats.paint, at(-8.6, 1.95, 0));
  const tailRotor = new THREE.Group();
  tailRotor.position.set(...at(-9.3, 3.0, 0.38));
  parent.add(tailRotor);
  const hub = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.18, 10), mats.metal));
  hub.rotation.x = Math.PI / 2;
  tailRotor.add(hub);
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.55, 0.03), mats.blade);
    b.position.set(0, 0.8, 0.05);
    const piv = new THREE.Group();
    piv.rotation.z = (i * Math.PI) / 2;
    piv.add(b);
    tailRotor.add(piv);
  }
  return { tailRotor };
}

/**
 * The tail boom broken off (ai/helicopter.js shed('tailBoom')): the boom aft of BOOM_ROOT, the fin,
 * the stabiliser and the tail rotor, as one group whose origin is the break. Posed by poseTail from
 * its debris entry ({ p, yaw, pitch, roll, tailAngle }: the helicopter's frame, at the break).
 */
export function buildTailMesh(color = '#4a5240') {
  const mats = {
    paint: new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.2 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x7c8186, roughness: 0.4, metalness: 0.8 }),
    blade: new THREE.MeshStandardMaterial({ color: 0x1b1d1f, roughness: 0.6, metalness: 0.3 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.8, metalness: 0.3 }),
  };
  const g = new THREE.Group();
  g.matrixAutoUpdate = false;
  const { tailRotor } = tailParts(g, mats, BOOM_ROOT[0], BOOM_ROOT);
  const torn = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.85, 0.85), mats.dark); // the torn end
  g.add(torn);
  g.userData.tailRotor = tailRotor;
  return g;
}
/** The detached tail where its debris entry says. */
export function poseTail(g, d) {
  const A = heliAxes(d.yaw, d.pitch, d.roll);
  g.matrix.makeBasis(_f.set(...A.f), _u.set(...A.u), _r.set(...A.r)).setPosition(d.p[0], d.p[1], d.p[2]);
  g.matrixWorldNeedsUpdate = true;
  if (g.userData.tailRotor) g.userData.tailRotor.rotation.z = d.tailAngle ?? 0;
}

export function buildHeliMesh({ color = '#4a5240' } = {}) {
  const group = new THREE.Group();
  group.matrixAutoUpdate = false;
  const body = new THREE.Group();
  group.add(body);
  const mats = {
    paint: new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.2 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.8, metalness: 0.3 }),
    inside: new THREE.MeshStandardMaterial({ color: 0x3b3f38, roughness: 0.95 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x7c8186, roughness: 0.4, metalness: 0.8 }),
    blade: new THREE.MeshStandardMaterial({ color: 0x1b1d1f, roughness: 0.6, metalness: 0.3 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x1d3040, roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.5, depthWrite: false }),
    seat: new THREE.MeshStandardMaterial({ color: 0x55524a, roughness: 0.9 }),
    exhaust: new THREE.MeshStandardMaterial({ color: 0x2a2522, roughness: 0.6, metalness: 0.5 }),
    flash: new THREE.MeshBasicMaterial({ color: 0xffd080, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
    disc: new THREE.MeshBasicMaterial({ color: 0x202224, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide }),
  };
  const box = (sx, sy, sz, x, y, z, mat = mats.paint, parent = body) => {
    const m = shadow(new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat));
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const cyl = (r0, r1, h, x, y, z, axis = 'y', mat = mats.paint, parent = body, seg = 14) => {
    const m = shadow(new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), mat));
    m.position.set(x, y, z);
    if (axis === 'x') m.rotation.z = Math.PI / 2;
    else if (axis === 'z') m.rotation.x = Math.PI / 2;
    parent.add(m);
    return m;
  };

  // --- the cabin, open inside: floor, roof, front and back walls, the sides round the door openings
  const [d0, d1] = DOOR.opening; // the door opening along x
  const F = HELI.floor;
  box(4.2, 0.3, 2.3, 0, F - 0.15, 0, mats.dark); // floor and belly
  box(4.2, 0.12, 2.3, 0, 2.38, 0); // roof
  box(0.1, 1.6, 2.3, -2.1, 1.55, 0); // back wall
  box(4.0, 0.06, 2.1, 0, F + 0.03, 0, mats.inside); // the deck
  for (const s of [-1, 1]) {
    const z = s * 1.12;
    box(d0 + 2.1, 1.6, 0.06, (d0 - 2.1) / 2, 1.55, z); // behind the door
    box(2.1 - d1, 1.6, 0.06, (d1 + 2.1) / 2, 1.55, z); // ahead of it
    box(d1 - d0, 0.18, 0.06, (d0 + d1) / 2, 2.29, z); // over it
    // the benches inside, along the back wall and the sides (ai/helicopter.js heliSeats)
    box(2.0, 0.08, 0.45, -0.75, F + 0.42, s * 0.55, mats.seat);
  }
  box(0.4, 0.8, 2.0, -1.85, F + 0.4, 0, mats.seat); // the rear bench's back
  // --- the cockpit: its lower half, the nose, the glass over it
  box(2.0, 0.85, 2.1, 3.05, 0.95, 0);
  const nose = shadow(new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), mats.paint));
  nose.scale.set(0.9, 0.6, 1.0);
  nose.position.set(4.0, 1.05, 0);
  body.add(nose);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.85, 2.08), mats.glass);
  glass.position.set(3.0, 1.8, 0);
  body.add(glass);
  box(0.1, 0.85, 2.1, 2.1, 1.8, 0, mats.dark); // the bulkhead behind the seats (with a gap over: the pilots are seen from the back)
  for (const s of [-1, 1]) box(0.6, 0.12, 0.55, 2.95, F + 0.38, s * 0.5, mats.seat); // the pilots' seats
  box(0.5, 0.3, 1.6, 3.6, 1.25, 0, mats.dark); // the instrument panel
  // --- engines on the roof, exhausts, the mast
  box(2.8, 0.5, 1.5, -0.5, 2.65, 0);
  for (const s of [-1, 1]) cyl(0.2, 0.22, 0.5, -1.85, 2.75, s * 0.62, 'x', mats.exhaust);
  cyl(0.17, 0.2, 0.75, 0, 3.15, 0, 'y', mats.metal);
  // --- tail boom, fin, stabiliser, the tail rotor (tailParts); and the stub left at the boom's
  // root when it is shot through (the rest falls away: buildTailMesh, render/helis.js)
  const tail = new THREE.Group();
  body.add(tail);
  const { tailRotor } = tailParts(tail, mats, -1.9);
  const stub = cyl(0.42, 0.48, -1.9 - BOOM_ROOT[0] + 0.1, (BOOM_ROOT[0] - 1.9) / 2, BOOM_ROOT[1], 0, 'x', mats.paint);
  stub.visible = false;
  const ragged = box(0.12, 0.9, 0.9, BOOM_ROOT[0], BOOM_ROOT[1], 0, mats.dark); // the torn end
  ragged.visible = false;
  // --- the main rotor: hub, four blades (and a faint disc when it turns fast)
  const rotor = new THREE.Group();
  rotor.position.set(0, 3.62, 0);
  body.add(rotor);
  cyl(0.45, 0.45, 0.22, 0, 0, 0, 'y', mats.metal, rotor);
  const blades = [];
  for (let i = 0; i < HELI.blades; i++) {
    const piv = new THREE.Group();
    piv.rotation.y = (i * 2 * Math.PI) / HELI.blades;
    const b = shadow(new THREE.Mesh(new THREE.BoxGeometry(HELI.rotorR - 0.4, 0.06, 0.53), mats.blade));
    b.position.set(0.4 + (HELI.rotorR - 0.4) / 2, 0, 0);
    piv.add(b);
    rotor.add(piv);
    blades.push(piv);
  }
  const disc = new THREE.Mesh(new THREE.CircleGeometry(HELI.rotorR, 48).rotateX(-Math.PI / 2), mats.disc);
  rotor.add(disc);
  // --- skids on struts
  for (const s of [-1, 1]) {
    cyl(0.06, 0.06, 4.4, 0.3, 0.07, s * 1.25, 'x', mats.metal);
    for (const x of [-1.0, 1.6]) {
      const st = cyl(0.05, 0.05, 0.62, x, 0.36, s * 1.12, 'y', mats.metal);
      st.rotation.x = -s * 0.42;
    }
  }
  // --- the sliding doors (slide aft on rails outside the fuselage) and the door guns
  const doors = {};
  const guns = {};
  for (const s of [-1, 1]) {
    const k = s < 0 ? 'L' : 'R';
    const d = box(d1 - d0, 1.42, 0.05, (d0 + d1) / 2, 1.48, s * 1.17);
    d.userData.x0 = d.position.x;
    doors[k] = d;
    const window = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 0.06), mats.glass);
    window.position.set(0.2, 0.3, 0);
    d.add(window);
    // the pintle gun: its post on the door frame, the gun on a swivel pointing out (+z of the gun group)
    const at = DOOR.gun(s);
    cyl(0.04, 0.04, 0.6, at[0], at[1] - 0.35, at[2] - s * 0.05, 'y', mats.metal);
    const g = new THREE.Group();
    g.position.set(...at);
    body.add(g);
    const recv = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.6), mats.dark);
    recv.position.set(0, 0, 0.1);
    g.add(recv);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.65, 8), mats.dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, 0.7);
    g.add(barrel);
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.2), mats.metal);
    belt.position.set(-0.14, -0.05, 0);
    g.add(belt);
    const flash = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.4, 8, 1, true), mats.flash);
    flash.rotation.x = Math.PI / 2;
    flash.position.set(0, 0.02, 1.2);
    flash.visible = false;
    g.add(flash);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -0.15, s).normalize());
    guns[k] = { g, flash, side: s };
  }
  const m = { group, body, rotor, blades, disc, tail, tailRotor, stub, ragged, doors, guns, glass, mats };
  m.dispose = () => {
    const ms = new Set();
    group.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) ms.add(o.material);
    });
    for (const x of ms) x.dispose();
  };
  return m;
}

const _z = new THREE.Vector3(0, 0, 1);
const _d = new THREE.Vector3();
const _f = new THREE.Vector3();
const _u = new THREE.Vector3();
const _r = new THREE.Vector3();

/** The mesh as helicopter h is now: placed and tilted, rotors turned, doors slid, guns aimed, flashes, what is gone. */
export function poseHeli(m, h, time = h.time) {
  const A = heliAxes(h.yaw, h.pitch, h.roll);
  m.group.matrix.makeBasis(_f.set(...A.f), _u.set(...A.u), _r.set(...A.r)).setPosition(h.p[0], h.p[1], h.p[2]);
  m.group.matrixWorldNeedsUpdate = true;
  // the main rotor: counter-clockwise seen from above; its blades gone, nothing turning
  m.rotor.rotation.y = h.rotorAngle;
  for (const b of m.blades) b.visible = h.blades > 0;
  // the blades flap and droop a little with the rotor slowing (still: they sag)
  for (const b of m.blades) b.rotation.z = -0.04 * (1 - h.omega);
  m.disc.visible = h.blades > 0 && h.omega > 0.5;
  m.disc.material.opacity = 0.14 * h.omega;
  m.tailRotor.rotation.z = h.tailAngle;
  m.tailRotor.visible = !h.gone?.has('tailRotor');
  // the boom shot through: gone from here (it falls on its own: a debris entry, buildTailMesh), a torn stub left
  const boomGone = !!h.gone?.has('tailBoom');
  m.tail.visible = !boomGone;
  m.stub.visible = m.ragged.visible = boomGone;
  for (const [k, d] of Object.entries(m.doors)) d.position.x = d.userData.x0 - (h.doors[k] ?? 0) * 1.75;
  for (const [k, G] of Object.entries(m.guns)) {
    const g = h.guns?.[k];
    if (g?.dir) G.g.quaternion.setFromUnitVectors(_z, _d.set(...g.dir).normalize());
    G.flash.visible = !!g && time - (g.flash ?? -1) < 0.05;
    if (G.flash.visible) G.flash.rotation.z = Math.random() * 6;
  }
  // the glass: cracked white once shot through
  m.mats.glass.color.set(h.glass ? 0xb8c4cc : 0x1d3040);
  m.mats.glass.opacity = h.glass ? 0.7 : 0.5;
  // a burnt-out wreck goes dark
  if (h.crashed && h.fire > 0) m.mats.paint.color.lerp(new THREE.Color(0x1c1b19), 0.01);
}

/** A rotor blade (or the tail rotor) flying off: { mesh } posed from a debris entry. */
export function buildBladeMesh(kind = 'blade') {
  const mat = new THREE.MeshStandardMaterial({ color: 0x1b1d1f, roughness: 0.6, metalness: 0.3 });
  const geo = kind === 'blade' ? new THREE.BoxGeometry(HELI.rotorR - 0.4, 0.06, 0.53) : new THREE.CylinderGeometry(0.8, 0.8, 0.1, 8);
  const mesh = shadow(new THREE.Mesh(geo, mat));
  return mesh;
}
