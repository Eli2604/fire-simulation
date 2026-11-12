import * as THREE from 'three';
import { SurfaceRenderer } from './surface.js';
import { FlameRenderer } from './flames.js';

/**
 * Draws the detail patches that are awake (sim/patches.js), each in a group placed where the
 * patch sits in the scene, as the smooth surface of its own fine voxels (surface nets,
 * rounded off). It is rebuilt as the voxels change: a candle's wax melts down, pools round the
 * wick, runs down the side and sets there as the simulation has it; a torch's pitch runs and
 * drips; a campfire's logs char, split and fall in. (A fixed scanned mesh tied to the voxels,
 * as the statue is, can lose pieces but not change its shape: no drips.)
 *
 * Flames: a candle's and a torch's stay the drawn ones (render/torches.js: a teardrop and its
 * glow), moved to where the patch burns and sized by its heat release (particle flames tuned
 * for 5-20 cm cells would be a cloud of sparks a hand's width over a 4 cm flame). A campfire's
 * are its patch's own particles, from its fine flame field; the scene's coarse flames there
 * are not drawn while it is shown (`coarseSkip`).
 */
const LOOK = {
  // wax is smooth and a little glossy; it lets the flame's light through: it glows a little, warm
  candle: { roughness: 0.45, emissive: 0xffb060, glow: 0.09, chunk: 64, smooth: 3 },
  // pitch: dark, tarry, a dull red where it is hot
  torch: { roughness: 0.8, emissive: 0x9a2a05, glow: 0.04, chunk: 64, smooth: 2 },
  // charred logs, embers (the surface's own colours and glow)
  campfire: { roughness: 0.9, emissive: 0x000000, glow: 0, chunk: 32, smooth: 1 },
};

export class PatchRenderer {
  constructor(root) {
    this.root = root;
    this.items = new Map(); // patch -> { group, surface, world, flames? }
    this.coarseSkip = []; // boxes the scene's own flames are not drawn in
  }

  /** A new scene / zone: drop everything. */
  clear() {
    for (const it of this.items.values()) this.drop(it);
    this.items.clear();
  }

  drop(it) {
    for (const ch of it.surface.chunks ?? []) it.surface.disposeChunk(ch);
    if (it.flames) {
      it.group.remove(it.flames.points);
      it.flames.points.geometry.dispose();
    }
    this.root.remove(it.group);
  }

  update(time, patches, mode, dt = 1 / 60, uScale = 800) {
    const shown = new Set(patches ? patches.shown() : []);
    for (const [p, it] of this.items) it.group.visible = shown.has(p);
    this.coarseSkip = [];
    for (const p of shown) {
      let it = this.items.get(p);
      // gone finer (or back), or started again: a new world of voxels, a new surface for it
      if (it && it.world !== p.sim.world) {
        this.drop(it);
        this.items.delete(p);
        it = null;
      }
      if (!it) {
        const look = LOOK[p.type] ?? LOOK.candle;
        const group = new THREE.Group();
        group.position.set(...p.origin);
        this.root.add(group);
        // (a small patch is a single chunk, so that the smoothing has no seams)
        const surface = new SurfaceRenderer(group, { chunk: look.chunk, smooth: look.smooth });
        surface.material.roughness = look.roughness;
        surface.material.emissive.set(look.emissive);
        surface.material.emissiveIntensity = look.glow;
        surface.showGround = false; // the altar, the ground under it, is the scene's
        surface.setWorld(p.sim.world);
        surface.setVisible(true);
        it = { group, surface, world: p.sim.world };
        if (p.type === 'campfire') {
          it.flames = new FlameRenderer(group, 6000);
          it.flames.setWorld(p.sim.world);
        }
        this.items.set(p, it);
      }
      it.surface.mode = mode;
      it.surface.update(time);
      // a candle's or a torch's own light sits just over it: its shadow maps would only streak it
      if (p.type !== 'campfire') for (const m of it.surface.group.children) m.castShadow = false;
      if (it.flames) {
        it.flames.update(dt, uScale);
        this.coarseSkip.push(p.box());
      }
    }
  }
}
