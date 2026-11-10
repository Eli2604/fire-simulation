import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/**
 * The guards: armoured sci-fi soldiers, built from procedural parts on a small
 * skeleton (hips, torso, head, two arms and two legs with elbows and knees), so
 * they walk, run, aim and burn instead of sliding about as boxes.
 *
 *  - A domed helmet with a wrap-around visor that glows (cyan on patrol, amber
 *    when they look into something, red once they have seen you), ear pods, an
 *    antenna and a rebreather under the chin.
 *  - Layered plates: chest, collar, abdomen segments, shoulder pauldrons, a power
 *    pack on the back with a glowing cell, thigh and knee plates, shin greaves,
 *    segmented boots, gauntlets; a dark undersuit between them.
 *  - A bullpup rifle with sight, magazine and emitter, held at low ready while
 *    walking, raised while investigating; a burning torch held up when they set a
 *    lure fire.
 *  - They burn when on fire, and lie on their back when they are down.
 */
const ARMOR = 0x3c4436;
const ARMOR_DARK = 0x262b24;
const SUIT = 0x131518;
const METAL = 0x5a5f66;

function rbox(w, h, d, r = 0.02) {
  return new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.2, h / 2.2, d / 2.2));
}

export class EnemyRenderer {
  constructor(scene, flames) {
    this.scene = scene;
    this.flames = flames;
    this.figures = [];
    this.mats = {
      armor: new THREE.MeshStandardMaterial({ color: ARMOR, roughness: 0.45, metalness: 0.55 }),
      armorDark: new THREE.MeshStandardMaterial({ color: ARMOR_DARK, roughness: 0.5, metalness: 0.5 }),
      suit: new THREE.MeshStandardMaterial({ color: SUIT, roughness: 0.92, metalness: 0 }),
      metal: new THREE.MeshStandardMaterial({ color: METAL, roughness: 0.35, metalness: 0.9 }),
      gun: new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.4, metalness: 0.7 }),
      torch: new THREE.MeshStandardMaterial({ color: 0x5a3a20, roughness: 0.9 }),
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

  /** An arm or a leg: upper part and lower part, with a joint between (the lower part swings at it). */
  limb(parent, x, y, len1, len2, r, armored) {
    const M = this.mats;
    const upper = new THREE.Group();
    upper.position.set(x, y, 0);
    parent.add(upper);
    this.mesh(new THREE.CapsuleGeometry(r, len1 - 2 * r, 4, 10), M.suit, upper, 0, -len1 / 2, 0);
    const lower = new THREE.Group();
    lower.position.set(0, -len1, 0);
    upper.add(lower);
    this.mesh(new THREE.CapsuleGeometry(r * 0.88, len2 - 2 * r, 4, 10), M.suit, lower, 0, -len2 / 2, 0);
    this.mesh(new THREE.SphereGeometry(r * 1.1, 10, 8), M.metal, lower, 0, 0, 0); // the joint
    if (armored === 'leg') {
      this.mesh(rbox(r * 2.3, len1 * 0.6, r * 1.6, 0.03), M.armor, upper, 0, -len1 * 0.45, r * 0.55); // thigh plate
      const knee = this.mesh(rbox(r * 1.9, r * 1.7, r * 1.0, 0.025), M.armorDark, lower, 0, -0.01, r * 0.95);
      knee.rotation.x = -0.15;
      this.mesh(rbox(r * 2.1, len2 * 0.62, r * 1.3, 0.03), M.armor, lower, 0, -len2 * 0.45, r * 0.6); // greave
      // the boot: sole, toe cap, heel
      const boot = new THREE.Group();
      boot.position.set(0, -len2, 0);
      lower.add(boot);
      this.mesh(rbox(r * 2.4, 0.09, r * 4.2, 0.025), M.armorDark, boot, 0, -0.03, r * 0.9);
      this.mesh(rbox(r * 2.2, 0.05, r * 1.6, 0.02), M.metal, boot, 0, 0.03, r * 2.0);
      this.mesh(rbox(r * 2.5, 0.025, r * 4.4, 0.01), M.gun, boot, 0, -0.08, r * 0.9);
    } else {
      // pauldron over the shoulder, a bracer on the forearm, an armoured glove
      const pd = this.mesh(new THREE.SphereGeometry(r * 2.1, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), M.armor, upper, 0, 0.03, 0);
      pd.scale.set(1.05, 0.8, 1.1);
      this.mesh(rbox(r * 2.3, r * 0.5, r * 2.5, 0.01), M.armorDark, upper, 0, -0.04, 0);
      this.mesh(rbox(r * 2.0, len2 * 0.55, r * 2.0, 0.025), M.armor, lower, 0, -len2 * 0.45, 0);
      this.mesh(rbox(r * 1.8, r * 2.0, r * 1.6, 0.02), M.armorDark, lower, 0, -len2 - r * 0.6, 0);
    }
    return { upper, lower };
  }

  figure() {
    const M = this.mats;
    const g = new THREE.Group();
    // own glowing materials (their colour shows the guard's state)
    const glow = new THREE.MeshStandardMaterial({ color: 0x0a1a20, emissive: 0x30d8ff, emissiveIntensity: 2.2, roughness: 0.15, metalness: 0.2 });
    const visorMat = new THREE.MeshStandardMaterial({ color: 0x061015, emissive: 0x30d8ff, emissiveIntensity: 1.6, roughness: 0.05, metalness: 0.6 });
    // --- hips
    const hips = new THREE.Group();
    hips.position.y = 0.96;
    g.add(hips);
    this.mesh(rbox(0.34, 0.14, 0.22, 0.04), M.armorDark, hips, 0, 0.02, 0);
    this.mesh(rbox(0.36, 0.05, 0.24, 0.015), M.metal, hips, 0, 0.1, 0); // belt
    for (const s of [-1, 1]) this.mesh(rbox(0.08, 0.07, 0.06, 0.015), M.armor, hips, s * 0.12, 0.1, 0.13); // pouches
    // --- torso
    const torso = new THREE.Group();
    torso.position.y = 0.12;
    hips.add(torso);
    this.mesh(rbox(0.36, 0.42, 0.22, 0.05), M.suit, torso, 0, 0.24, 0);
    const chest = this.mesh(rbox(0.42, 0.26, 0.27, 0.06), M.armor, torso, 0, 0.34, 0.015);
    chest.scale.z = 1.05;
    this.mesh(rbox(0.3, 0.12, 0.06, 0.02), M.armorDark, torso, 0, 0.31, 0.15); // chest ridge
    this.mesh(rbox(0.12, 0.025, 0.01, 0.005), glow, torso, -0.08, 0.38, 0.165); // status light
    for (let k = 0; k < 3; k++) this.mesh(rbox(0.3 - k * 0.02, 0.05, 0.22, 0.02), M.armorDark, torso, 0, 0.17 - k * 0.055, 0.02); // abdomen segments
    this.mesh(new THREE.TorusGeometry(0.1, 0.035, 8, 16), M.armorDark, torso, 0, 0.5, 0).rotation.x = Math.PI / 2; // collar
    // power pack on the back with its cell
    this.mesh(rbox(0.32, 0.36, 0.13, 0.04), M.armorDark, torso, 0, 0.3, -0.17);
    this.mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.26, 12), glow, torso, 0.09, 0.3, -0.24);
    this.mesh(rbox(0.06, 0.3, 0.05, 0.01), M.metal, torso, -0.08, 0.3, -0.24);
    // --- head
    const head = new THREE.Group();
    head.position.y = 0.6;
    torso.add(head);
    this.mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.08, 10), M.suit, head, 0, -0.04, 0); // neck
    const helm = this.mesh(new THREE.SphereGeometry(0.135, 20, 16), M.armor, head, 0, 0.1, -0.005);
    helm.scale.set(0.95, 1.0, 1.08);
    this.mesh(rbox(0.25, 0.04, 0.2, 0.015), M.armorDark, head, 0, 0.165, 0.04); // brow ridge
    const visor = this.mesh(new THREE.SphereGeometry(0.128, 20, 10, -Math.PI * 0.42, Math.PI * 0.84, Math.PI * 0.38, Math.PI * 0.22), visorMat, head, 0, 0.1, 0.012);
    visor.scale.set(0.98, 1.0, 1.12);
    for (const s of [-1, 1]) {
      this.mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.035, 12), M.armorDark, head, s * 0.13, 0.08, 0).rotation.z = Math.PI / 2; // ear pods
      this.mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 8), glow, head, s * 0.15, 0.08, 0).rotation.z = Math.PI / 2;
    }
    this.mesh(rbox(0.11, 0.06, 0.08, 0.02), M.armorDark, head, 0, -0.01, 0.1); // rebreather
    for (const s of [-1, 1]) this.mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.04, 10), M.metal, head, s * 0.05, -0.02, 0.13).rotation.x = Math.PI / 2;
    this.mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.16, 5), M.metal, head, -0.1, 0.25, -0.05); // antenna
    // --- legs (hip joints)
    const legL = this.limb(hips, -0.1, -0.02, 0.44, 0.44, 0.065, 'leg');
    const legR = this.limb(hips, 0.1, -0.02, 0.44, 0.44, 0.065, 'leg');
    // --- arms (shoulder joints)
    const armL = this.limb(torso, -0.25, 0.44, 0.3, 0.28, 0.05, 'arm');
    const armR = this.limb(torso, 0.25, 0.44, 0.3, 0.28, 0.05, 'arm');
    // --- rifle (on the torso, so it follows the body; the arms are posed to it)
    const rifle = new THREE.Group();
    rifle.position.set(0.06, 0.3, 0.24);
    torso.add(rifle);
    this.mesh(rbox(0.06, 0.09, 0.5, 0.012), M.gun, rifle, 0, 0, 0.05); // receiver
    this.mesh(rbox(0.05, 0.12, 0.13, 0.01), M.gun, rifle, 0, -0.02, -0.25); // stock
    this.mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.22, 10), M.metal, rifle, 0, 0.005, 0.41).rotation.x = Math.PI / 2; // barrel
    this.mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 12), M.armorDark, rifle, 0, 0.005, 0.32).rotation.x = Math.PI / 2; // shroud
    this.mesh(rbox(0.04, 0.12, 0.06, 0.01), M.armorDark, rifle, 0, -0.1, -0.07); // magazine
    this.mesh(rbox(0.035, 0.04, 0.12, 0.01), M.armorDark, rifle, 0, 0.07, 0.05); // sight
    this.mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.004, 10), glow, rifle, 0, 0.07, 0.112).rotation.x = Math.PI / 2;
    this.mesh(rbox(0.015, 0.015, 0.2, 0.004), glow, rifle, 0.032, 0, 0.12); // emitter strip
    // --- torch (for setting lure fires), in the left hand
    const torch = this.mesh(new THREE.CylinderGeometry(0.02, 0.028, 0.42, 8), M.torch, armL.lower, 0, -0.33, 0.1);
    torch.rotation.x = 1.2;
    torch.visible = false;
    this.scene.add(g);
    return { g, hips, torso, head, legL, legR, armL, armR, rifle, torch, glow, visorMat, state: '' };
  }

  /** Visor and lights: cyan on patrol, amber investigating, red when they have seen you, off when down. */
  setMood(f, e) {
    const mood = e.dead ? 'dead' : e.state === 'investigate' ? 'look' : e.alerted || ['lure', 'retreat'].includes(e.state) ? 'alert' : 'calm';
    if (mood === f.state) return;
    f.state = mood;
    const c = { calm: 0x30d8ff, look: 0xffb020, alert: 0xff2a1a, dead: 0x000000 }[mood];
    f.glow.emissive.setHex(c);
    f.visorMat.emissive.setHex(c);
    f.glow.emissiveIntensity = mood === 'dead' ? 0 : 2.2;
    f.visorMat.emissiveIntensity = mood === 'dead' ? 0 : 1.6;
  }

  update(world, time) {
    const list = world?.enemies ?? [];
    while (this.figures.length < list.length) this.figures.push(this.figure());
    this.figures.forEach((f, k) => {
      const e = list[k];
      f.g.visible = !!e;
      if (!e) return;
      this.setMood(f, e);
      f.g.position.set(e.p[0], e.p[1], e.p[2]);
      f.g.rotation.set(0, e.yaw ?? 0, 0);
      if (e.dead) {
        // on their back
        f.g.rotation.set(-Math.PI / 2, e.yaw ?? 0, 0, 'YXZ');
        f.g.position.y = e.p[1] + 0.2;
        f.legL.upper.rotation.set(0.1, 0, 0.1);
        f.legR.upper.rotation.set(0.1, 0, -0.15);
        f.armL.upper.rotation.set(-0.3, 0, 0.6);
        f.armR.upper.rotation.set(-0.2, 0, -0.5);
        return;
      }
      const run = e.state === 'flee' || e.state === 'retreat' || (e.state === 'investigate' && e.urgent);
      const ph = e.walkPhase ?? 0;
      const amp = e.moving ? (run ? 0.8 : 0.5) : 0;
      const s = Math.sin(ph);
      // legs: swing at the hip, the knee bends as the foot comes forward
      for (const [leg, o] of [[f.legL, 0], [f.legR, Math.PI]]) {
        const sw = Math.sin(ph + o);
        leg.upper.rotation.set(-sw * amp, 0, 0);
        leg.lower.rotation.set(Math.max(0, Math.cos(ph + o)) * amp * 1.3 + (e.moving ? 0.1 : 0.02), 0, 0);
      }
      // body: bob and a lean into the run
      f.hips.position.y = 0.96 - (e.moving ? Math.abs(s) * 0.03 + (run ? 0.03 : 0) : 0);
      f.torso.rotation.set(run ? 0.22 : 0.04, Math.sin(ph) * amp * 0.15, 0);
      // arms and rifle: low ready walking, raised looking, on the back... the torch when luring
      const look = e.state === 'investigate';
      const lure = e.state === 'lure';
      f.rifle.rotation.set(look ? -0.05 : 0.55, look ? 0 : -0.25, 0);
      f.rifle.position.set(0.06, look ? 0.36 : 0.27, look ? 0.26 : 0.22);
      f.armR.upper.rotation.set(look ? -1.1 : -0.55, 0, -0.15);
      f.armR.lower.rotation.set(look ? -0.6 : -1.0, 0, 0);
      if (lure) {
        f.armL.upper.rotation.set(-2.2, 0, 0.2); // torch held up
        f.armL.lower.rotation.set(-0.3, 0, 0);
      } else {
        f.armL.upper.rotation.set(look ? -1.35 : -0.85, 0, 0.45);
        f.armL.lower.rotation.set(look ? -0.55 : -0.9, 0, 0);
      }
      f.head.rotation.set(0, look ? Math.sin(time * 1.3 + k) * 0.5 : 0, 0); // scanning
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
