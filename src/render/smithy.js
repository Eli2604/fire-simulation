import * as THREE from 'three';
import { blackbody } from './colors.js';
import { heatTint, HT_STEEL } from './heatColor.js';
import { TMAX_STEP } from '../sim/world.js';
import { raycastDrawn } from './pickThings.js';

/**
 * The smith's workshop (sim/smithy.js): what is not voxels.
 *  - the smith: a burly figure in a leather apron, posed by what he is doing (walking, at the
 *    bellows lever, hammering with the tongs in his other hand, quenching, grinding);
 *  - the blade he works: its shape by its kind, black with scale while he forges it, bright
 *    after the grindstone with its temper colour; it glows by its temperature (dull red at
 *    600 °C, cherry, orange, yellow at forging heat);
 *  - the glowing fuel bed in the fire pot (its colour from the bed's temperature, brighter on
 *    the bellows) and the forge's light on the room;
 *  - the great bellows beside the hearth (its top board rising and falling with each stroke)
 *    on its rocker lever, and its nozzle into the fire;
 *  - the finished weapons in the shop: on the rack, the pegs and the counter;
 *  - sparks: scale flying off hot steel under the hammer, a stream off the grindstone (as the
 *    fire's sparks, render/flames.js).
 * Clicking any of it inspects the smithy (sim/inspectThings.js 'smithy').
 */

const STEEL = new THREE.Color(0.62, 0.64, 0.68);
const SCALE = new THREE.Color(0.17, 0.16, 0.16);
const _c = [0, 0, 0];
const _t = [0, 0, 0, 0];
const _v = new THREE.Vector3();

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** A blade's shape (along +z from the tang, flat in x-z... lying on its side: thin in y). */
function weaponGeometry(kind) {
  const g = new THREE.Group();
  const parts = [];
  if (kind === 'sword') {
    parts.push([0.045, 0.006, 0.72, 0, 0, 0.42], [0.016, 0.01, 0.06, 0, 0, 0.03]);
  } else if (kind === 'axe') {
    parts.push([0.05, 0.03, 0.09, 0, 0, 0.05], [0.12, 0.012, 0.12, 0.07, 0, 0.12]);
  } else if (kind === 'spear') {
    parts.push([0.04, 0.008, 0.22, 0, 0, 0.17], [0.022, 0.022, 0.08, 0, 0, 0.03]);
  } else {
    parts.push([0.035, 0.006, 0.26, 0, 0, 0.17], [0.014, 0.01, 0.05, 0, 0, 0.02]);
  }
  return { g, parts };
}

/** A finished weapon to show: the blade with its fittings (grip, haft). */
function finishedWeapon(kind, steelMat, woodMat, leatherMat, brassMat) {
  const g = new THREE.Group();
  if (kind === 'sword') {
    g.add(box(0.045, 0.006, 0.72, steelMat, 0, 0, 0.44));
    g.add(box(0.16, 0.02, 0.025, brassMat, 0, 0, 0.07)); // the cross guard
    g.add(box(0.03, 0.03, 0.15, leatherMat, 0, 0, -0.02)); // the grip
    g.add(box(0.045, 0.045, 0.04, brassMat, 0, 0, -0.11)); // the pommel
  } else if (kind === 'axe') {
    g.add(box(0.035, 0.035, 0.75, woodMat, 0, 0, 0.3)); // the haft
    g.add(box(0.06, 0.04, 0.09, steelMat, 0, 0, 0.62));
    g.add(box(0.16, 0.012, 0.13, steelMat, 0.09, 0, 0.62));
  } else if (kind === 'spear') {
    g.add(box(0.03, 0.03, 1.5, woodMat, 0, 0, 0.65));
    g.add(box(0.045, 0.008, 0.22, steelMat, 0, 0, 1.5));
    g.add(box(0.024, 0.024, 0.08, steelMat, 0, 0, 1.38));
  } else {
    g.add(box(0.035, 0.006, 0.26, steelMat, 0, 0, 0.18));
    g.add(box(0.09, 0.016, 0.02, brassMat, 0, 0, 0.04));
    g.add(box(0.026, 0.026, 0.1, leatherMat, 0, 0, -0.02));
  }
  return g;
}

/** Arm: a shoulder joint with the upper arm, an elbow joint with the forearm and the hand. */
function arm(mat, skin, x) {
  const sh = new THREE.Group();
  sh.position.set(x, 1.42, 0);
  sh.add(box(0.11, 0.3, 0.11, mat, 0, -0.15, 0));
  const el = new THREE.Group();
  el.position.set(0, -0.3, 0);
  sh.add(el);
  el.add(box(0.1, 0.27, 0.1, skin, 0, -0.135, 0)); // bare forearm (sleeves rolled up)
  const hand = new THREE.Group();
  hand.position.set(0, -0.29, 0);
  el.add(hand);
  hand.add(box(0.08, 0.08, 0.08, skin));
  return { sh, el, hand };
}

export class SmithyRenderer {
  constructor(scene, flames = null) {
    this.scene = scene;
    this.flames = flames;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.items = [];
    this.seen = 0;
    this.mats = {
      shirt: new THREE.MeshStandardMaterial({ color: 0x6b5a45, roughness: 0.9 }),
      trousers: new THREE.MeshStandardMaterial({ color: 0x3b352e, roughness: 0.9 }),
      apron: new THREE.MeshStandardMaterial({ color: 0x5a3a1e, roughness: 0.75 }),
      skin: new THREE.MeshStandardMaterial({ color: 0xc89070, roughness: 0.7 }),
      hair: new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.9 }),
      boots: new THREE.MeshStandardMaterial({ color: 0x241a12, roughness: 0.8 }),
      iron: new THREE.MeshStandardMaterial({ color: 0x2a2a2c, metalness: 0.6, roughness: 0.5 }),
      wood: new THREE.MeshStandardMaterial({ color: 0x7a5530, roughness: 0.8 }),
      leather: new THREE.MeshStandardMaterial({ color: 0x4a2c18, roughness: 0.7 }),
      bright: new THREE.MeshStandardMaterial({ color: 0xc7ccd4, metalness: 0.9, roughness: 0.22 }),
      brass: new THREE.MeshStandardMaterial({ color: 0xb08a3a, metalness: 0.8, roughness: 0.35 }),
    };
  }

  setWorld(world) {
    this.world = world;
    for (const it of this.items) {
      this.group.remove(it.g);
      it.light?.dispose?.();
    }
    this.items = [];
    this.seen = world.events?.length ?? 0;
    (world.smithies ?? []).forEach((S, k) => this.items.push(this.build(S, k)));
  }

  build(S, index) {
    const M = this.mats;
    const g = new THREE.Group();
    this.group.add(g);
    const thing = { kind: 'smithy', index };
    const it = { S, g, thing, shopSig: '' };
    const heading = S.heading ?? 0;

    // ---- the fuel bed: lumps of charcoal glowing by the bed's temperature
    const bedMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 1, emissive: 0x000000 });
    const bed = new THREE.Group();
    bed.position.set(...S.fire);
    bed.rotation.y = heading;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 22; k++) {
      const s = 0.04 + rnd() * 0.04;
      const lump = box(s, s * 0.8, s, bedMat, (rnd() - 0.5) * 0.32, -0.06 + rnd() * 0.06, (rnd() - 0.5) * 0.32);
      lump.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      lump.castShadow = false;
      bed.add(lump);
    }
    g.add(bed);
    it.bedMat = bedMat;
    it.light = new THREE.PointLight(0xff8a3a, 0, 7, 1.6);
    it.light.position.set(S.fire[0], S.fire[1] + 0.35, S.fire[2]);
    g.add(it.light);

    // ---- the bellows: two boards with leather between, a nozzle into the fire, a rocker lever
    const bel = new THREE.Group();
    bel.position.set(...S.bellowsBox);
    bel.rotation.y = heading;
    const base = box(0.38, 0.04, 0.7, M.wood, 0, 0.02, 0);
    const top = new THREE.Group();
    top.position.set(0, 0.04, 0.35); // hinged at its back end... (the nozzle end)
    top.add(box(0.38, 0.04, 0.7, M.wood, 0, 0, -0.35));
    const leather = box(0.36, 1, 0.66, M.leather, 0, 0.04, 0);
    leather.scale.y = 0.15;
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.6, 8), M.iron);
    nozzle.rotation.z = Math.PI / 2;
    nozzle.position.set(0.45, 0.06, 0);
    bel.add(base, top, leather, nozzle);
    // the lever: a pole from the top board up to where the smith (or you) works it
    const lever = new THREE.Group();
    lever.position.set(0.0, 0.7, -0.1);
    lever.add(box(0.05, 0.05, 0.9, M.wood, 0, 0, 0.45));
    bel.add(lever);
    const post = box(0.06, 0.7, 0.06, M.wood, 0, 0.35, -0.1);
    bel.add(post);
    g.add(bel);
    it.bellows = { top, leather, lever };

    // ---- the smith
    if (S.smith) {
      const f = new THREE.Group();
      const legL = new THREE.Group();
      const legR = new THREE.Group();
      for (const [leg, x] of [[legL, -0.1], [legR, 0.1]]) {
        leg.position.set(x, 0.9, 0);
        leg.add(box(0.14, 0.8, 0.15, M.trousers, 0, -0.42, 0));
        leg.add(box(0.15, 0.1, 0.26, M.boots, 0, -0.85, 0.04));
        f.add(leg);
      }
      const torso = new THREE.Group();
      f.add(torso);
      torso.add(box(0.44, 0.58, 0.26, M.shirt, 0, 1.17, 0));
      torso.add(box(0.42, 0.85, 0.03, M.apron, 0, 0.92, 0.145)); // the leather apron
      torso.add(box(0.12, 0.08, 0.12, M.skin, 0, 1.5, 0)); // neck
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 10), M.skin);
      head.position.set(0, 1.62, 0);
      torso.add(head);
      torso.add(box(0.16, 0.12, 0.06, M.hair, 0, 1.53, 0.08)); // the beard
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), M.leather);
      cap.position.set(0, 1.64, 0);
      torso.add(cap);
      const armL = arm(M.shirt, M.skin, -0.28);
      const armR = arm(M.shirt, M.skin, 0.28);
      torso.add(armL.sh, armR.sh);
      // the tongs in the left hand (pointing forward), the hammer in the right
      const tongs = new THREE.Group();
      tongs.add(box(0.025, 0.025, 0.55, M.iron, 0, 0, 0.27));
      tongs.rotation.x = Math.PI / 2;
      armL.hand.add(tongs);
      const tip = new THREE.Group();
      tip.position.set(0, 0, 0.56);
      tongs.add(tip);
      const hammer = new THREE.Group();
      hammer.add(box(0.03, 0.03, 0.38, M.wood, 0, 0, 0.12));
      hammer.add(box(0.06, 0.06, 0.14, M.iron, 0, 0, 0.3));
      hammer.children[1].rotation.x = Math.PI / 2;
      hammer.rotation.x = Math.PI / 2;
      armR.hand.add(hammer);
      f.traverse((o) => (o.userData.thing = thing));
      g.add(f);
      it.fig = { f, legL, legR, torso, armL, armR, tongs, tip, hammer };
    }

    // ---- the blade he works
    const bladeMat = new THREE.MeshStandardMaterial({ color: SCALE.clone(), metalness: 0.6, roughness: 0.55, emissive: 0x000000 });
    it.bladeMat = bladeMat;
    it.blades = {};
    it.blade = null;
    // ---- the shop's weapons
    it.shop = new THREE.Group();
    g.add(it.shop);
    g.traverse((o) => (o.userData.thing ??= thing));
    return it;
  }

  bladeMesh(it, kind) {
    if (!it.blades[kind]) {
      const grp = new THREE.Group();
      for (const [w, h, d, x, y, z] of weaponGeometry(kind).parts) grp.add(box(w, h, d, it.bladeMat, x, y, z));
      grp.traverse((o) => (o.userData.thing = it.thing));
      it.blades[kind] = grp;
    }
    return it.blades[kind];
  }

  /** Rebuild the shop's display when what is in it changed. */
  updateShop(it) {
    const S = it.S;
    const sig = S.weapons.map((w) => `${w.kind}${w.slot}`).join(',');
    if (sig === it.shopSig) return;
    it.shopSig = sig;
    it.shop.clear();
    const M = this.mats;
    const heading = S.heading ?? 0;
    for (const wpn of S.weapons) {
      const slot = S.slots[wpn.slot];
      if (!slot) continue;
      // its temper colour on the bright steel
      heatTint(HT_STEEL, (wpn.temper ?? 280) / TMAX_STEP, _t);
      const mat = M.bright.clone();
      mat.color.lerp(new THREE.Color(_t[0], _t[1], _t[2]), Math.min(0.5, _t[3] * 0.5));
      const g = finishedWeapon(wpn.kind, mat, M.wood, M.leather, M.brass);
      g.position.set(...slot.p);
      if (slot.mount === 'rack') {
        // upright in the rack, points up, against the back wall
        g.rotation.set(-Math.PI / 2, heading, 0, 'YXZ');
        g.rotation.y = heading;
        g.position.y += wpn.kind === 'spear' ? 0.05 : 0.1;
      } else if (slot.mount === 'wall') {
        // on pegs, lying along the wall
        g.rotation.set(0, heading, 0);
        g.position.z -= 0.35;
      } else {
        // lying on the counter
        g.rotation.set(0, heading + Math.PI / 2, 0);
        g.position.x -= 0.2;
      }
      g.traverse((o) => (o.userData.thing = it.thing));
      it.shop.add(g);
    }
  }

  /** Pose the smith for what he is doing. */
  pose(it, time) {
    const F = it.fig;
    const sm = it.S.smith;
    if (!F || !sm) return;
    F.f.position.set(sm.p[0], sm.p[1], sm.p[2]);
    F.f.rotation.y = sm.yaw;
    const ph = sm.phase ?? 0;
    const frac = ph - Math.floor(ph);
    let legSwing = 0;
    let shL = -0.15, elL = -0.25, shR = -0.15, elR = -0.25, lean = 0;
    F.tongs.visible = true;
    F.hammer.visible = false;
    switch (sm.pose) {
      case 'walk':
        legSwing = Math.sin(ph * Math.PI * 2) * 0.45;
        shL = -0.5;
        elL = -0.4;
        shR = -legSwing * 0.6;
        break;
      case 'pump': {
        // both hands on the lever, pulling it down and letting it up
        const s = Math.sin(frac * Math.PI * 2);
        shL = shR = -2.0 + 0.35 * s;
        elL = elR = -0.3 - 0.2 * s;
        lean = 0.1 + 0.08 * s;
        F.tongs.visible = false;
        break;
      }
      case 'hammer': {
        F.hammer.visible = true;
        shL = -1.0;
        elL = -0.45;
        lean = 0.2;
        // the blow lands at each whole phase: up slowly, down fast
        const up = frac < 0.75 ? frac / 0.75 : 1 - (frac - 0.75) / 0.25;
        shR = -0.9 - 1.9 * up;
        elR = -0.6 - 0.6 * up;
        break;
      }
      case 'quench':
        shL = -0.75;
        elL = -0.2;
        lean = 0.25;
        break;
      case 'grind':
        shL = -1.1;
        elL = -0.55;
        shR = -1.0;
        elR = -0.6;
        lean = 0.2;
        break;
      case 'tongs':
        shL = -1.0;
        elL = -0.4;
        lean = 0.1;
        break;
    }
    F.legL.rotation.x = legSwing;
    F.legR.rotation.x = -legSwing;
    F.armL.sh.rotation.x = shL;
    F.armL.el.rotation.x = elL;
    F.armR.sh.rotation.x = shR;
    F.armR.el.rotation.x = elR;
    F.torso.rotation.x = lean;
    // (the tongs point forward from the hand whatever the arm does: level with the floor)
    F.tongs.rotation.x = -(shL + elL + lean);
    F.hammer.rotation.x = Math.PI / 2 - 0.3;
  }

  /** The blade where it is (in the tongs, in the fire, on the anvil, in the water...), its colour from its heat. */
  placeBlade(it) {
    const S = it.S;
    const b = S.blade;
    if (!b) {
      if (it.blade) it.blade.parent?.remove(it.blade);
      it.blade = null;
      return;
    }
    const mesh = this.bladeMesh(it, b.kind);
    if (it.blade !== mesh) {
      it.blade?.parent?.remove(it.blade);
      it.blade = mesh;
    }
    const st = S.stations;
    const heading = S.heading ?? 0;
    const fig = it.fig;
    const inHand = fig && (b.place === 'tongs' || b.place === 'water' || b.place === 'temper' || b.place === 'grind' || b.place === 'stock');
    if (inHand && b.place === 'tongs') {
      if (mesh.parent !== fig.tip) fig.tip.add(mesh);
      mesh.position.set(0, 0, 0);
      mesh.rotation.set(0, 0, 0);
    } else {
      if (mesh.parent !== it.g) it.g.add(mesh);
      mesh.rotation.set(0, heading, 0);
      if (b.place === 'fire') {
        mesh.position.set(S.fire[0], S.fire[1] - 0.02, S.fire[2]);
        mesh.rotation.y = heading + Math.PI; // its tang out towards the smith
        mesh.position.z += Math.cos(heading) * 0.35;
        mesh.position.x += Math.sin(heading) * 0.35;
      } else if (b.place === 'anvil') {
        mesh.position.set(st.anvil.top[0] - Math.cos(heading) * 0.25, st.anvil.top[1] + 0.01, st.anvil.top[2]);
        mesh.rotation.y = heading + Math.PI / 2;
      } else if (b.place === 'water') {
        mesh.position.set(st.trough.water[0], st.trough.water[1] - 0.12, st.trough.water[2]);
        mesh.rotation.set(-1.2, heading + Math.PI, 0, 'YXZ');
      } else if (b.place === 'temper') {
        mesh.position.set(S.fire[0], S.fire[1] + 0.12, S.fire[2] + Math.cos(heading) * 0.3);
        mesh.rotation.y = heading + Math.PI;
      } else if (b.place === 'grind') {
        const wh = st.grinder.wheel;
        mesh.position.set(wh[0], wh[1] + 0.05, wh[2] + Math.cos(heading) * 0.32);
        mesh.rotation.set(0.25, heading + Math.PI / 2, 0, 'YXZ');
      } else {
        mesh.position.set(st.forge.p[0], 1, st.forge.p[2]);
      }
    }
    // colour: scale while forged, bright (with its temper colour) after the grindstone; the glow by its heat
    const mat = it.bladeMat;
    if (b.quenched && (b.place === 'grind' || S.smith?.state === 'shelve' || (b.place === 'tongs' && S.smith?.dest === 'rack'))) {
      heatTint(HT_STEEL, b.temperMax / TMAX_STEP, _t);
      mat.color.copy(STEEL).lerp(new THREE.Color(_t[0], _t[1], _t[2]), Math.min(0.6, _t[3] * 0.6));
      mat.metalness = 0.9;
      mat.roughness = 0.25;
    } else if (b.quenched) {
      // the scale cracked off in the quench, a grey surface; its temper colour shows as he tempers it
      heatTint(HT_STEEL, Math.max(b.temperMax, b.T) / TMAX_STEP, _t);
      mat.color.setRGB(0.4, 0.4, 0.42).lerp(new THREE.Color(_t[0], _t[1], _t[2]), Math.min(0.6, _t[3] * 0.6));
      mat.metalness = 0.7;
      mat.roughness = 0.4;
    } else {
      mat.color.copy(SCALE);
      mat.metalness = 0.5;
      mat.roughness = 0.6;
    }
    blackbody(b.T, _c);
    mat.emissive.setRGB(_c[0], _c[1], _c[2]);
    mat.emissiveIntensity = 0.9;
  }

  update(dt, time) {
    const w = this.world;
    if (!w || !this.items.length) return;
    for (const it of this.items) {
      const S = it.S;
      // the fire: the bed's glow and its light, flickering
      const T = S.forge.T;
      blackbody(T, _c);
      const flick = 0.85 + 0.15 * Math.sin(time * 13.1 + Math.sin(time * 7.3) * 2);
      it.bedMat.emissive.setRGB(_c[0] * 0.6 * flick, _c[1] * 0.6 * flick, _c[2] * 0.6 * flick);
      it.light.intensity = Math.min(6, Math.max(0, (T - 500) / 160)) * flick;
      // the bellows: the top board rises as it fills and falls on the stroke
      const sm = S.smith;
      const pumping = (sm && sm.pose === 'pump') || w.time - (S.playerPump ?? -99) < 3;
      const ph = sm && sm.pose === 'pump' ? sm.phase : w.time / 1.1;
      const open = pumping ? 0.5 + 0.5 * Math.cos((ph - Math.floor(ph)) * Math.PI * 2) : 0.6;
      it.bellows.top.rotation.x = 0.12 + 0.18 * open;
      it.bellows.leather.scale.y = 0.08 + 0.2 * open;
      it.bellows.leather.position.y = 0.04 + 0.1 * open;
      it.bellows.lever.rotation.x = -0.35 + 0.4 * open;
      this.pose(it, time);
      this.placeBlade(it);
      this.updateShop(it);
    }
    this.sparks();
  }

  /** Sparks: scale off the hot steel under the hammer, a stream off the grindstone. */
  sparks() {
    const w = this.world;
    const ev = w.events;
    if (this.seen > ev.length) this.seen = 0;
    const F = this.flames;
    for (; this.seen < ev.length; this.seen++) {
      const e = ev[this.seen];
      if (!F || (e.type !== 'anvilBlow' && e.type !== 'grind')) continue;
      const n = e.type === 'grind' ? 10 : e.T > 700 ? Math.round(6 + (e.T - 700) / 25) : 0;
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2;
        const sp = e.type === 'grind' ? 2 + Math.random() * 3 : 1.5 + Math.random() * 3;
        const up = e.type === 'grind' ? -0.5 + Math.random() : 0.5 + Math.random() * 1.5;
        F.spawn(e.pos[0], e.pos[1] + 0.02, e.pos[2], Math.cos(a) * sp, up, Math.sin(a) * sp, 0.3 + Math.random() * 0.5, 0.012, 1, 1);
      }
    }
  }

  /** A click on the smith, the blade, the bellows, the fire or the weapons: the smithy. */
  pick(ray) {
    let best = null;
    for (const it of this.items) {
      const h = raycastDrawn(ray, it.g);
      if (h && (!best || h.distance < best.distance)) best = { ...h, voxel: -1, thing: it.thing };
    }
    return best;
  }
}
