import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { loadOperatorAssets, OperatorFigure, PhysicsWorld, MOVING, ONCE } from '../operator/rig.js';
import { SquadViz } from '../operator/squadviz.js';
import { radioSay, shoutSay, flashBang } from '../audio/radio.js';
import { driveFromAI } from '../operator/drive.js';

/**
 * The guards: soldiers in armour, with human proportions (1.8 m), built from
 * shaped parts on a small skeleton (hips, torso, head, arms and legs with elbows
 * and knees) so they walk, run, aim and burn.
 *
 *  - Body: a lathed torso (broad chest, narrow waist), tapered limbs with rounded
 *    joints, gloves and boots with a proper profile; olive fatigues.
 *  - Armour: a plate carrier with curved front and back plates, side panels,
 *    shoulder straps and pouches; layered shoulder plates, elbow and knee pads,
 *    shin guards, a belt with holster and pouches; a small power pack.
 *  - Helmet: a shell over the head with a brow, ear guards and a dark glass visor
 *    over the face; a thin light strip under the visor and a status light show
 *    what they are up to: cyan on patrol, amber when they come to look, red once
 *    they have seen you; dark when they are down.
 *  - A bullpup rifle (a proper outline: stock, grip, magazine, optic, barrel),
 *    held at low ready, raised to look; a torch when they set a lure fire.
 */
const C = {
  fatigue: 0x4b5240, // olive
  fatigueDark: 0x353a2e,
  plate: 0x55595c, // painted grey armour
  plateDark: 0x34373a,
  webbing: 0x3d4232,
  rubber: 0x1c1d1e,
  metal: 0x808589,
  gun: 0x222427,
};

function rbox(w, h, d, r = 0.02) {
  return new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2.2, h / 2.2, d / 2.2));
}

/** A tapered limb segment along -y, length len, radius r0 at the top and r1 at the bottom. */
function segment(r0, r1, len) {
  const g = new THREE.CylinderGeometry(r1, r0, len, 14, 1, false);
  g.translate(0, -len / 2, 0);
  return g;
}

/** A curved armour plate: part of a cylinder shell, thickness t, around +z. */
function curvedPlate(r, h, arc, t = 0.012) {
  const pts = [];
  const n = 12;
  for (let k = 0; k <= n; k++) {
    const a = -arc / 2 + (arc * k) / n;
    pts.push(new THREE.Vector2(Math.sin(a) * (r + t), Math.cos(a) * (r + t)));
  }
  for (let k = n; k >= 0; k--) {
    const a = -arc / 2 + (arc * k) / n;
    pts.push(new THREE.Vector2(Math.sin(a) * r, Math.cos(a) * r));
  }
  const shape = new THREE.Shape(pts);
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 4 });
  g.rotateX(Math.PI / 2); // the arc's front (shape +y) to +z; the extrusion runs downwards
  g.translate(0, h / 2, 0);
  return g;
}

/** The torso: a lathe from the waist to the shoulders, flattened front to back. */
function torsoGeometry() {
  const prof = [
    [0.0, 0.0],
    [0.135, 0.0],
    [0.14, 0.06],
    [0.15, 0.16],
    [0.175, 0.28],
    [0.19, 0.36],
    [0.185, 0.42],
    [0.15, 0.47],
    [0.07, 0.5],
    [0.0, 0.5],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(prof, 24);
  g.scale(1, 1, 0.66);
  return g;
}

/** A boot from its side profile, extruded to its width. */
function bootGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-0.055, 0.0);
  s.lineTo(0.17, 0.0);
  s.quadraticCurveTo(0.2, 0.0, 0.2, 0.035);
  s.quadraticCurveTo(0.19, 0.075, 0.1, 0.085);
  s.lineTo(0.05, 0.14);
  s.lineTo(0.05, 0.2);
  s.lineTo(-0.05, 0.2);
  s.lineTo(-0.06, 0.06);
  s.lineTo(-0.055, 0.0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 3, curveSegments: 6 });
  g.translate(0, 0, -0.05);
  g.rotateY(-Math.PI / 2); // toes towards +z
  return g;
}

/** The rifle from its side outline (x along the barrel → +z after rotation). */
function rifleBodyGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-0.3, 0.02); // butt
  s.lineTo(-0.3, -0.1);
  s.lineTo(-0.2, -0.09);
  s.lineTo(-0.05, -0.04);
  s.lineTo(0.02, -0.04); // grip in front of the magazine
  s.lineTo(0.05, -0.13);
  s.lineTo(0.09, -0.13);
  s.lineTo(0.08, -0.04);
  s.lineTo(0.3, -0.035); // handguard
  s.lineTo(0.3, 0.035);
  s.lineTo(-0.2, 0.04);
  s.lineTo(-0.3, 0.02);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.055, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2 });
  g.translate(0, 0, -0.0275);
  g.rotateY(-Math.PI / 2);
  return g;
}

export class EnemyRenderer {
  constructor(scene, flames) {
    this.scene = scene;
    this.flames = flames;
    this.figures = [];
    const std = (color, roughness, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
    this.mats = {
      fatigue: std(C.fatigue, 0.92),
      fatigueDark: std(C.fatigueDark, 0.92),
      plate: std(C.plate, 0.55, 0.25),
      plateDark: std(C.plateDark, 0.55, 0.3),
      webbing: std(C.webbing, 0.95),
      rubber: std(C.rubber, 0.8),
      metal: std(C.metal, 0.35, 0.85),
      gun: std(C.gun, 0.45, 0.6),
      glass: new THREE.MeshStandardMaterial({ color: 0x0b1014, roughness: 0.08, metalness: 0.9 }),
      torch: std(0x5a3a20, 0.9),
    };
    this.geo = {
      torso: torsoGeometry(),
      boot: bootGeometry(),
      rifle: rifleBodyGeometry(),
    };
  }

  mesh(geo, mat, parent, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  /** A leg: thigh, knee, shin, boot. */
  leg(parent, x) {
    const M = this.mats;
    const upper = new THREE.Group();
    upper.position.set(x, 0, 0);
    parent.add(upper);
    this.mesh(new THREE.SphereGeometry(0.085, 14, 10), M.fatigue, upper); // hip
    this.mesh(segment(0.085, 0.06, 0.44), M.fatigue, upper);
    // thigh armour on the front, a pocket on the side
    const tp = this.mesh(curvedPlate(0.085, 0.2, 1.6, 0.01), M.plate, upper, 0, -0.18, 0);
    tp.scale.set(1, 1, 1);
    this.mesh(rbox(0.035, 0.12, 0.09, 0.015), M.fatigueDark, upper, x > 0 ? 0.085 : -0.085, -0.22, 0);
    const lower = new THREE.Group();
    lower.position.set(0, -0.44, 0);
    upper.add(lower);
    this.mesh(new THREE.SphereGeometry(0.06, 12, 10), M.fatigue, lower);
    this.mesh(segment(0.058, 0.042, 0.4), M.fatigue, lower);
    // knee pad and shin guard
    const kp = this.mesh(new THREE.SphereGeometry(0.06, 12, 8, -Math.PI / 2, Math.PI, 0, Math.PI), M.plateDark, lower, 0, -0.01, 0.022);
    kp.scale.set(1.05, 1.2, 0.8);
    this.mesh(curvedPlate(0.05, 0.22, 1.7, 0.009), M.plate, lower, 0, -0.2, 0);
    // boot
    const foot = new THREE.Group();
    foot.position.set(0, -0.4, 0);
    lower.add(foot);
    this.mesh(this.geo.boot, M.rubber, foot, 0, -0.07, -0.02);
    return { upper, lower, foot };
  }

  /** An arm: shoulder plates, upper arm, elbow pad, forearm, glove. */
  arm(parent, x) {
    const M = this.mats;
    const s = Math.sign(x);
    const upper = new THREE.Group();
    upper.position.set(x, 0, 0);
    parent.add(upper);
    this.mesh(new THREE.SphereGeometry(0.06, 12, 10), M.fatigue, upper);
    this.mesh(segment(0.055, 0.044, 0.3), M.fatigue, upper);
    // layered shoulder plates
    for (let k = 0; k < 2; k++) {
      const pl = this.mesh(curvedPlate(0.058 + k * 0.004, 0.055, 2.2, 0.007), M.plate, upper, 0, -0.01 - k * 0.045, 0);
      pl.rotation.y = s * Math.PI / 2;
    }
    const lower = new THREE.Group();
    lower.position.set(0, -0.3, 0);
    upper.add(lower);
    this.mesh(new THREE.SphereGeometry(0.045, 12, 8), M.fatigue, lower);
    const ep = this.mesh(new THREE.SphereGeometry(0.045, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.plateDark, lower, 0, 0, -0.018);
    ep.rotation.x = -Math.PI / 2;
    this.mesh(segment(0.043, 0.033, 0.26), M.fatigue, lower);
    this.mesh(curvedPlate(0.042, 0.12, 2.0, 0.008), M.plateDark, lower, 0, -0.15, 0).rotation.y = Math.PI; // bracer on the outside
    // glove: palm and curled fingers
    const hand = new THREE.Group();
    hand.position.set(0, -0.27, 0);
    lower.add(hand);
    this.mesh(rbox(0.07, 0.085, 0.035, 0.012), M.rubber, hand, 0, -0.045, 0);
    this.mesh(rbox(0.07, 0.04, 0.05, 0.015), M.rubber, hand, 0, -0.095, 0.01);
    this.mesh(rbox(0.022, 0.05, 0.022, 0.009), M.rubber, hand, -s * 0.04, -0.05, 0.02); // thumb
    return { upper, lower, hand };
  }

  figure() {
    const M = this.mats;
    const g = new THREE.Group();
    // own lights: their colour shows the guard's state
    const glow = new THREE.MeshStandardMaterial({ color: 0x061014, emissive: 0x30d8ff, emissiveIntensity: 2.5, roughness: 0.3 });
    // --- hips
    const hips = new THREE.Group();
    hips.position.y = 0.93;
    g.add(hips);
    const pelvis = this.mesh(new THREE.SphereGeometry(0.15, 18, 12), M.fatigue, hips, 0, 0.03, 0);
    pelvis.scale.set(1.05, 0.62, 0.72);
    // belt with buckle, holster, pouches
    this.mesh(new THREE.TorusGeometry(0.15, 0.022, 6, 24), M.webbing, hips, 0, 0.09, 0).scale.set(1.0, 0.7, 1);
    hips.children[hips.children.length - 1].rotation.x = Math.PI / 2;
    this.mesh(rbox(0.06, 0.04, 0.02, 0.006), M.metal, hips, 0, 0.09, 0.115);
    for (const sx of [-0.1, 0.1]) this.mesh(rbox(0.06, 0.08, 0.05, 0.012), M.fatigueDark, hips, sx, 0.05, 0.09);
    this.mesh(rbox(0.045, 0.16, 0.08, 0.015), M.webbing, hips, 0.16, -0.02, 0); // holster
    // --- torso
    const torso = new THREE.Group();
    torso.position.y = 0.1;
    hips.add(torso);
    this.mesh(this.geo.torso, M.fatigue, torso);
    // plate carrier: front and back plates, side panels, shoulder straps
    const front = this.mesh(curvedPlate(0.13, 0.3, 1.9, 0.016), M.plate, torso, 0, 0.3, 0);
    front.scale.set(1.25, 1, 1);
    const back = this.mesh(curvedPlate(0.13, 0.31, 1.9, 0.016), M.plate, torso, 0, 0.3, 0);
    back.scale.set(1.25, 1, 1);
    back.rotation.y = Math.PI;
    for (const sx of [-1, 1]) {
      const side = this.mesh(curvedPlate(0.135, 0.17, 0.9, 0.01), M.plateDark, torso, 0, 0.22, 0);
      side.rotation.y = (sx * Math.PI) / 2;
      side.scale.set(0.75, 1, 1.2);
      this.mesh(rbox(0.06, 0.03, 0.26, 0.01), M.webbing, torso, sx * 0.1, 0.455, 0); // strap over the shoulder
    }
    // pouches on the front: magazines, a radio with an antenna
    // webbing strips across the front plate, and pouches on them
    for (let k = 0; k < 3; k++) this.mesh(rbox(0.26, 0.018, 0.01, 0.004), M.webbing, torso, 0, 0.36 - k * 0.05, 0.158);
    for (let k = 0; k < 3; k++) this.mesh(rbox(0.065, 0.1, 0.045, 0.012), M.webbing, torso, -0.08 + k * 0.08, 0.2, 0.175);
    this.mesh(rbox(0.05, 0.06, 0.03, 0.01), M.fatigueDark, torso, 0.07, 0.36, 0.172); // admin pouch
    this.mesh(rbox(0.06, 0.1, 0.05, 0.012), M.fatigueDark, torso, -0.2, 0.26, 0.04);
    this.mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.22, 5), M.rubber, torso, -0.2, 0.42, 0.04);
    this.mesh(rbox(0.035, 0.012, 0.006, 0.003), glow, torso, 0.07, 0.38, 0.165); // status light
    // power pack on the back
    this.mesh(rbox(0.22, 0.24, 0.08, 0.025), M.plateDark, torso, 0, 0.3, -0.17);
    this.mesh(rbox(0.012, 0.18, 0.012, 0.004), glow, torso, 0.08, 0.3, -0.212);
    this.mesh(new THREE.TorusGeometry(0.06, 0.008, 6, 12, Math.PI), M.rubber, torso, -0.06, 0.43, -0.14).rotation.y = Math.PI / 2; // cable
    // --- head and helmet
    const head = new THREE.Group();
    head.position.y = 0.5;
    torso.add(head);
    this.mesh(segment(0.05, 0.055, 0.09), M.fatigueDark, head, 0, 0.08, 0); // neck
    this.mesh(new THREE.TorusGeometry(0.075, 0.025, 8, 20), M.plateDark, head, 0, 0.0, 0).rotation.x = Math.PI / 2; // collar
    const skull = this.mesh(new THREE.SphereGeometry(0.105, 18, 14), M.fatigueDark, head, 0, 0.14, 0.005); // balaclava
    skull.scale.set(0.9, 1.05, 1);
    const shell = this.mesh(new THREE.SphereGeometry(0.128, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), M.plate, head, 0, 0.15, -0.01);
    shell.scale.set(1.0, 1.0, 1.08);
    this.mesh(new THREE.TorusGeometry(0.124, 0.008, 6, 28, Math.PI * 1.25), M.plateDark, head, 0, 0.16, -0.01).rotation.set(Math.PI / 2, 0, Math.PI * 0.62); // rim
    for (const sx of [-1, 1]) {
      const ear = this.mesh(rbox(0.03, 0.08, 0.09, 0.012), M.plateDark, head, sx * 0.118, 0.12, 0); // ear guards
      ear.rotation.z = sx * 0.08;
    }
    // the visor: dark glass over the face, a light strip under it
    const visor = this.mesh(new THREE.SphereGeometry(0.112, 22, 10, -Math.PI * 0.38, Math.PI * 0.76, Math.PI * 0.4, Math.PI * 0.25), M.glass, head, 0, 0.14, 0.012);
    visor.scale.set(1, 1, 1.12);
    const strip = this.mesh(new THREE.TorusGeometry(0.108, 0.003, 4, 24, Math.PI * 0.62), glow, head, 0, 0.105, 0.012);
    strip.rotation.set(Math.PI / 2, 0, Math.PI * 0.19 + Math.PI * 0.0);
    strip.rotation.z = -Math.PI * 0.81;
    this.mesh(rbox(0.08, 0.05, 0.05, 0.015), M.rubber, head, 0, 0.065, 0.085); // breathing filter
    this.mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.03, 12), M.metal, head, 0, 0.06, 0.115).rotation.x = Math.PI / 2;
    this.mesh(rbox(0.03, 0.03, 0.05, 0.008), M.rubber, head, 0.1, 0.22, 0.04); // helmet lamp mount
    // --- legs and arms
    const legL = this.leg(hips, -0.095);
    const legR = this.leg(hips, 0.095);
    const shoulders = new THREE.Group();
    shoulders.position.y = 0.42;
    torso.add(shoulders);
    const armL = this.arm(shoulders, -0.215);
    const armR = this.arm(shoulders, 0.215);
    // --- rifle (on the torso, so it follows the body; the arms are posed to it)
    const rifle = new THREE.Group();
    rifle.position.set(0.05, 0.27, 0.22);
    torso.add(rifle);
    this.mesh(this.geo.rifle, M.gun, rifle);
    this.mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.2, 10), M.metal, rifle, 0, 0.0, 0.4).rotation.x = Math.PI / 2; // barrel
    this.mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.05, 10), M.gun, rifle, 0, 0, 0.5).rotation.x = Math.PI / 2; // muzzle brake
    this.mesh(rbox(0.035, 0.12, 0.05, 0.01), M.gun, rifle, 0, -0.1, -0.12).rotation.x = 0.2; // magazine (behind the grip)
    this.mesh(rbox(0.04, 0.045, 0.11, 0.012), M.plateDark, rifle, 0, 0.07, 0.05); // optic
    this.mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.004, 10), glow, rifle, 0, 0.075, 0.106).rotation.x = Math.PI / 2;
    this.mesh(rbox(0.016, 0.01, 0.4, 0.003), M.metal, rifle, 0, 0.045, 0.08); // rail
    const flash = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd080, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    flash.rotation.x = Math.PI / 2;
    flash.position.set(0, 0, 0.64);
    flash.visible = false;
    rifle.add(flash);
    // --- torch (for setting lure fires), in the left hand
    const torch = this.mesh(new THREE.CylinderGeometry(0.02, 0.028, 0.42, 8), M.torch, armL.hand, 0, -0.08, 0.12);
    torch.rotation.x = 1.2;
    torch.visible = false;
    this.scene.add(g);
    return { g, hips, torso, head, legL, legR, armL, armR, rifle, torch, glow, visorMat: glow, state: '', flash, stains: 0 };
  }

  /** A blood stain soaking into the clothes at a wound (on the part that was hit). */
  stain(f, zone) {
    this.stainMat ??= new THREE.MeshStandardMaterial({ color: 0x3a0505, roughness: 0.55 });
    const part = { head: f.head, torso: f.torso, armL: f.armL.upper, armR: f.armR.upper, legL: f.legL.upper, legR: f.legR.upper }[zone] ?? f.torso;
    const at = { head: [0, 0.12, 0.1], torso: [0, 0.18 + Math.random() * 0.2, 0.16], armL: [0, -0.15, 0.05], armR: [0, -0.15, 0.05], legL: [0, -0.2, 0.07], legR: [0, -0.2, 0.07] }[zone] ?? [0, 0.2, 0.16];
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.05 + Math.random() * 0.03, 10, 6), this.stainMat);
    m.scale.set(1, 1.3, 0.35);
    m.position.set(at[0] + (Math.random() - 0.5) * 0.06, at[1], at[2]);
    part.add(m);
  }

  /** Lights: cyan on patrol, amber investigating, red when they have seen you, off when down. */
  setMood(f, e) {
    const mood = e.dead ? 'dead' : e.state === 'investigate' ? 'look' : e.alerted || ['lure', 'retreat'].includes(e.state) ? 'alert' : 'calm';
    if (mood === f.state) return;
    f.state = mood;
    const c = { calm: 0x30d8ff, look: 0xffb020, alert: 0xff2a1a, dead: 0x000000 }[mood];
    f.glow.emissive.setHex(c);
    f.glow.emissiveIntensity = mood === 'dead' ? 0 : 2.5;
  }

  /**
   * In the browser everyone is drawn as the sculpted operator (operator/rig.js) once it is built
   * (a few seconds, in workers); until then, and in Node, as the guards above.
   */
  useOperator(world) {
    if (this.op) return true;
    if (!this.opLoading && (world?.enemies?.length ?? 0) > 0 && typeof window !== 'undefined' && typeof Worker !== 'undefined') {
      this.opLoading = true;
      loadOperatorAssets({ lod: 'game' }).then((a) => (this.op = a), () => {});
    }
    return false;
  }

  updateOperators(world, time) {
    const list = world.enemies;
    const dt = this.lastTime == null ? 0 : Math.min(0.1, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    for (const f of this.figures) f.g.visible = false;
    if (this.opWorld !== world) {
      // a new scene: new figures and physics
      for (const f of this.ops ?? []) f.dispose();
      this.ops = [];
      this.opWorld = world;
      this.seenEvents = world.events.length;
      this.physics = new PhysicsWorld({
        ground: () => -100,
        solid: (x, y, z) => {
          const i = world.voxelAt(x, y, z);
          return i >= 0 && world.mat[i] > 0;
        },
      });
      this.viz ??= new SquadViz(this.scene);
    }
    while (this.ops.length < list.length) {
      const f = new OperatorFigure(this.op, { zones: false, loadout: list[this.ops.length]?.loadout });
      f.autoFlash = false;
      this.scene.add(f.group);
      this.ops.push(f);
    }
    list.forEach((e, k) => this.driveOperator(this.ops[k], e, world, time, dt, k));
    this.physics.step(dt);
    // the squads: routes, trails, tags, signals, threats; radio traffic
    const threats = [...new Set(list.filter((e) => e.squad && e.aimAt).map((e) => e.aimAt))];
    this.viz.update(list, threats, time);
    for (; this.seenEvents < world.events.length; this.seenEvents++) {
      const ev = world.events[this.seenEvents];
      if (ev.type === 'radio') radioSay(ev.name, { reply: ev.kind === 'reply' });
      else if (ev.type === 'shout' && ev.name !== 'enemy') shoutSay(ev.name);
      else if (ev.type === 'flashbang') {
        // the flash: a blinding light for an instant, then the bang
        this.flashLight ??= this.scene.add(new THREE.PointLight(0xfff8ee, 0, 30, 1.5)).children.at(-1);
        this.flashLight.position.set(ev.pos[0], ev.pos[1] + 0.3, ev.pos[2]);
        this.flashUntil = time + 0.18;
        flashBang();
      }
    }
    if (this.flashLight) this.flashLight.intensity = time < (this.flashUntil ?? 0) ? 4000 : 0;
  }

  driveOperator(f, e, world, time, dt, k) {
    const g = f.group;
    g.visible = !e.devoured;
    if (e.devoured) return;
    g.position.set(e.p[0], e.p[1], e.p[2]);
    g.rotation.set(0, e.yaw ?? 0, 0);
    if ((e.stains?.length ?? 0) > (f.stainsSeen ?? 0)) {
      f.stainsSeen = e.stains.length;
      f.hitFlash();
    }
    // a hand that cannot hold the rifle drops it
    if (e.canFire === false && f.armed && !e.dead) f.detach('rifle', this.physics, this.scene);
    if ((e.flashUntil ?? -1) > (world.time ?? 0)) f.muzzle(0.05);
    // how fast they really go (for the step rate)
    const sp = f.prev ? Math.hypot(e.p[0] - f.prev[0], e.p[2] - f.prev[2]) / Math.max(dt, 1e-3) : 0;
    f.prev = e.p.slice();
    f.speed = (f.speed ?? 0) * 0.8 + sp * 0.2;
    let name;
    const sq = e.squad && !e.guardCtl; // the squad AI animates it (a guard on patrol: the guard AI)
    if (e.held) {
      // seized by the dragon: held crosswise in its jaws, flailing
      g.rotation.set(-(e.heldPitch ?? 0), (e.heldYaw ?? 0) + Math.PI / 2, Math.PI / 2, 'YXZ');
      g.position.set(e.p[0], e.p[1], e.p[2]).add(new THREE.Vector3(0, -0.95, 0).applyEuler(g.rotation));
      name = 'swim';
    } else if (e.dead) name = 'die';
    else if (sq) name = e.anim ?? 'crouchAim';
    else if (e.crawling) name = 'crawl';
    else if (e.state === 'lure') name = 'crouch';
    else if (e.aiming) name = (e.flashUntil ?? -1) > (world.time ?? 0) - 0.4 ? 'shoot' : 'aim';
    else if (e.moving) name = e.state === 'flee' || e.state === 'retreat' || e.urgent ? 'run' : e.state === 'investigate' ? 'aimWalk' : 'walk';
    else name = e.state === 'investigate' ? 'aim' : 'idle';
    if (sq && !e.held) {
      // the squad AI's member: clip, weapon switches, reload speed, armour (operator/drive.js)
      driveFromAI(f, e, (f.aiState ??= {}));
    } else if (ONCE[f.shown] && f.shown !== 'die' && f.current?.isRunning() && !(sq && ONCE[name] && e.animT !== f.animT) && !e.dead) {
      // let a draw, a throw or a radio call finish
    } else if (sq && ONCE[name] && e.animT !== f.animT) {
      f.animT = e.animT;
      if (name === 'deployDrone') f.deployDrone();
      else f.play(name, { restart: true, fade: 0.15 });
    } else if (!ONCE[name] || f.shown !== name) f.play(name);
    if (MOVING[f.state] && !sq) {
      const moving = sq ? e.moving : sp > 0.05 || e.moving;
      f.setSpeed(moving ? Math.max(0.5, Math.min(1.8, (sq ? e.speed : f.speed) / MOVING[f.state])) : 0.001);
    }
    if (!sq) f.setAim(null);
    f.setGear({ thermal: !!e.thermal, light: !!e.light });
    if (e.aimAt) f.droneTarget = new THREE.Vector3(e.aimAt[0], e.aimAt[1], e.aimAt[2]);
    f.droneGoal = e.droneGoal ? new THREE.Vector3(e.droneGoal[0], e.droneGoal[1], e.droneGoal[2]) : null;
    f.update(dt);
    if (e.state === 'lure' && !e.dead && this.flames) {
      const p = new THREE.Vector3();
      f.bones.handL.getWorldPosition(p);
      this.flames.spawn(p.x, p.y + 0.15, p.z, 0, 0.8, 0, 0.25, 0.12, 0, 0.8);
    }
    if (e.onFire > 0 && this.flames)
      for (let k2 = 0; k2 < 4; k2++) this.flames.spawn(e.p[0] + (Math.random() - 0.5) * 0.5, e.p[1] + Math.random() * 1.7, e.p[2] + (Math.random() - 0.5) * 0.5, 0, 1, 0, 0.3, 0.25, 0, 0.8);
  }

  update(world, time) {
    const list = world?.enemies ?? [];
    if (world && this.useOperator(world)) return this.updateOperators(world, time);
    while (this.figures.length < list.length) this.figures.push(this.figure());
    this.figures.forEach((f, k) => {
      const e = list[k];
      f.g.visible = !!e;
      if (!e) return;
      this.setMood(f, e);
      while (f.stains < (e.stains?.length ?? 0)) this.stain(f, e.stains[f.stains++].zone);
      f.flash.visible = (e.flashUntil ?? -1) > (world.time ?? 0);
      f.g.position.set(e.p[0], e.p[1], e.p[2]);
      f.g.rotation.set(0, e.yaw ?? 0, 0);
      // seized by the dragon: held crosswise in its jaws, limbs flailing; gone once swallowed
      if (e.devoured) {
        f.g.visible = false;
        return;
      }
      if (e.held) {
        f.g.rotation.set(-(e.heldPitch ?? 0), (e.heldYaw ?? 0) + Math.PI / 2, Math.PI / 2, 'YXZ');
        f.g.position.set(e.p[0], e.p[1], e.p[2]).add(new THREE.Vector3(0, -0.95, 0).applyEuler(f.g.rotation));
        const fl = Math.sin(time * 9 + k);
        f.legL.upper.rotation.set(0.6 * fl, 0, 0.2);
        f.legR.upper.rotation.set(-0.6 * fl, 0, -0.2);
        f.armL.upper.rotation.set(-1.8 + 0.7 * fl, 0, 0.5);
        f.armR.upper.rotation.set(-1.6 - 0.7 * fl, 0, -0.5);
        return;
      }
      if (e.dead) {
        f.g.rotation.set(-Math.PI / 2, e.yaw ?? 0, 0, 'YXZ');
        f.g.position.y = e.p[1] + 0.16;
        f.legL.upper.rotation.set(0.1, 0, 0.1);
        f.legR.upper.rotation.set(0.1, 0, -0.15);
        f.armL.upper.rotation.set(-0.3, 0, 0.6);
        f.armR.upper.rotation.set(-0.2, 0, -0.5);
        return;
      }
      const run = e.state === 'flee' || e.state === 'retreat' || (e.state === 'investigate' && e.urgent);
      const ph = e.walkPhase ?? 0;
      const amp = e.moving ? (run ? 0.75 : 0.45) : 0;
      // legs: swing at the hip, the knee bends as the foot comes through, the foot stays level
      const W = e.wounds ?? {};
      for (const [leg, o, hurt] of [[f.legL, 0, W.legL], [f.legR, Math.PI, W.legR]]) {
        const sw = Math.sin(ph + o);
        const hip = -sw * amp * (hurt ? 0.35 : 1); // a wounded leg is dragged
        if (e.crawling) {
          leg.upper.rotation.set(-0.2, 0, 0);
          leg.lower.rotation.set(0.3 + Math.max(0, sw) * 0.6, 0, 0);
          leg.foot.rotation.set(0, 0, 0);
          continue;
        }
        const knee = Math.max(0, Math.cos(ph + o)) * amp * 1.4 + (e.moving ? 0.08 : 0.03);
        leg.upper.rotation.set(hip, 0, 0);
        leg.lower.rotation.set(knee, 0, 0);
        leg.foot.rotation.set(-(hip + knee) * 0.6, 0, 0);
      }
      f.hips.position.y = 0.93 - (e.moving ? Math.abs(Math.sin(ph)) * 0.025 + (run ? 0.03 : 0) : 0);
      f.torso.rotation.set(run ? 0.2 : 0.03, Math.sin(ph) * amp * 0.12, 0);
      // arms to the rifle: low ready walking, raised to the shoulder when looking
      const look = e.state === 'investigate' || e.aiming;
      const lure = e.state === 'lure';
      if (e.crawling) {
        // both legs hit: dragging themselves along the floor
        f.g.rotation.set(-1.35, e.yaw ?? 0, 0, 'YXZ');
        f.g.position.y = e.p[1] + 0.22;
      }
      f.rifle.rotation.set(look ? -0.02 : 0.5, look ? 0 : -0.3, look ? 0 : 0.15);
      f.rifle.position.set(0.05, look ? 0.33 : 0.24, look ? 0.24 : 0.2);
      f.armR.upper.rotation.set(look ? -0.9 : -0.35, 0, -0.18);
      f.armR.lower.rotation.set(look ? -1.0 : -1.25, 0, 0);
      if (lure) {
        f.armL.upper.rotation.set(-2.2, 0, 0.2);
        f.armL.lower.rotation.set(-0.3, 0, 0);
      } else {
        f.armL.upper.rotation.set(look ? -1.25 : -0.7, 0, 0.42);
        f.armL.lower.rotation.set(look ? -0.75 : -1.1, 0, 0);
      }
      // an arm that is hit hangs; the rifle points at the floor
      for (const [arm, hurt] of [[f.armL, W.armL], [f.armR, W.armR]]) {
        if (!hurt) continue;
        arm.upper.rotation.set(0.05, 0, arm === f.armL ? 0.12 : -0.12);
        arm.lower.rotation.set(-0.15, 0, 0);
      }
      if (e.canFire === false) f.rifle.rotation.set(1.25, -0.2, 0.2);
      f.head.rotation.set(look ? 0.05 : 0.08, look ? Math.sin(time * 1.3 + k) * 0.5 : 0, 0);
      f.torch.visible = lure;
      if (lure && this.flames) {
        const p = new THREE.Vector3();
        f.torch.getWorldPosition(p);
        this.flames.spawn(p.x, p.y + 0.15, p.z, 0, 0.8, 0, 0.25, 0.12, 0, 0.8);
      }
      if (e.onFire > 0 && this.flames)
        for (let k2 = 0; k2 < 4; k2++) this.flames.spawn(e.p[0] + (Math.random() - 0.5) * 0.5, e.p[1] + Math.random() * 1.7, e.p[2] + (Math.random() - 0.5) * 0.5, 0, 1, 0, 0.3, 0.25, 0, 0.8);
    });
  }
}
