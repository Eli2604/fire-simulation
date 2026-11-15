import * as THREE from 'three';

/**
 * The overview of a world of places (scenarios.js: a scene with `places`, its zones side by
 * side by `origin`): zoomed out, each place is a box at its true location and size with its
 * name over it (`label`); close up, its scenery (the place you are in: its voxels; the others:
 * their stand-ins, render/proxies.js). Edit world shows the boxes all the time. A click on a
 * box or a name (pick) says which place to go to. A place inside or under another (below deck,
 * the catacombs: `schematic`, at a spot of its own for the overview) is outlined in blue.
 */

/** From how far off (m) a place of this size [x, y, z] is shown as its box. */
export function farDistance(size) {
  return Math.max(15, 2 * Math.hypot(...size));
}

/** Distance (m) from point p to the box [min, max] (0 inside). */
export function boxDistance(p, min, max) {
  let d2 = 0;
  for (let k = 0; k < 3; k++) {
    const d = Math.max(min[k] - p[k], 0, p[k] - max[k]);
    d2 += d * d;
  }
  return Math.sqrt(d2);
}

/**
 * The place the camera has come close to (null: none closer than the one you are in).
 * places: [{ name, min, max, active }] in the same frame as cam. A place is close when the
 * camera is within half its own size of its box (4 m at least) (or inside it); the one you are in
 * keeps the camera unless the other is clearly nearer.
 */
export function placeNear(places, cam) {
  const here = places.find((q) => q.active);
  const dHere = here ? boxDistance(cam, here.min, here.max) : Infinity;
  let best = null;
  let bestD = Infinity;
  for (const q of places) {
    if (q.active) continue;
    const d = boxDistance(cam, q.min, q.max);
    const size = q.max.map((v, k) => v - q.min[k]);
    const near = Math.max(4, Math.hypot(size[0], size[2]) / 2);
    if (d < near && d + 2 < dHere && d < bestD) {
      best = q.name;
      bestD = d;
    }
  }
  return best;
}

function labelTexture(text) {
  if (typeof document === 'undefined') return null; // (headless: no canvas)
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  const font = 'bold 44px system-ui, -apple-system, Segoe UI, sans-serif';
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 48;
  cv.width = w;
  cv.height = 76;
  ctx.font = font;
  ctx.fillStyle = 'rgba(20, 24, 28, 0.72)';
  const r = 18;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(0, 0, w, 76, r);
  else ctx.rect(0, 0, w, 76);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 24, 40);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, aspect: w / 76 };
}

export class PlacesOverlay {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.renderOrder = 10;
    scene.add(this.group);
    this.items = new Map(); // name -> { root, fill, edges, label, key }
    this.unit = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5);
    this.edgeGeo = new THREE.EdgesGeometry(this.unit);
    this.editing = false;
    this.labelSize = 0.045; // the name's height, a share of the view's height
  }

  /**
   * places: [{ name, label, offset: [x, y, z] in the view's frame, size, active, color, schematic, real }]
   * (real: its own scenery is drawn there, render/scenery.js: outlined, not filled);
   * cam: the camera's position in that frame. Returns name -> true for the places far enough
   * off to be drawn as their box (their stand-ins hidden).
   */
  update(places, cam) {
    const far = new Map();
    const keep = new Set();
    for (const q of places) {
      keep.add(q.name);
      const it = this.item(q);
      it.root.position.set(...q.offset);
      it.fill.scale.set(...q.size);
      it.edges.scale.set(...q.size);
      const min = q.offset;
      const max = q.offset.map((v, k) => v + q.size[k]);
      // (the place you are in shows its outline and name sooner: what is where, zooming out)
      const isFar = boxDistance(cam, min, max) > (q.active ? Math.max(15, Math.hypot(...q.size)) : farDistance(q.size));
      far.set(q.name, isFar);
      // (a place drawn as it looks far off, render/scenery.js: its outline and name, not the box)
      it.fill.visible = isFar && !q.active && !q.real;
      it.edges.visible = isFar || this.editing;
      it.edges.material.color.set(q.active ? 0xffc64d : q.schematic ? 0x8cc8ff : 0xffffff);
      it.edges.material.opacity = q.active ? 1 : 0.85;
      if (it.label) {
        it.label.visible = isFar || this.editing;
        it.label.position.set(q.size[0] / 2, q.size[1] + 0.5, q.size[2] / 2);
        it.label.center.y = 0;
      }
      it.active = q.active;
      it.min = min;
      it.max = max;
    }
    for (const [name, it] of this.items)
      if (!keep.has(name)) {
        this.drop(it);
        this.items.delete(name);
      }
    if (this.camera) this.declutter(this.camera);
    return far;
  }

  /** Names that would cover each other on the screen: the further ones lifted above the nearer. */
  declutter(camera) {
    const p11 = camera.projectionMatrix.elements[5];
    const p00 = camera.projectionMatrix.elements[0];
    const v = new THREE.Vector3();
    const shown = [];
    for (const it of this.items.values()) {
      if (!it.label?.visible) continue;
      it.root.updateMatrixWorld(true);
      v.setFromMatrixPosition(it.label.matrixWorld).project(camera);
      if (v.z > 1) continue;
      shown.push({ it, x: v.x, y: v.y, w: it.label.scale.x * p00, h: it.label.scale.y * p11, d: camera.position.distanceTo(it.label.getWorldPosition(new THREE.Vector3())) });
    }
    shown.sort((a, b) => a.d - b.d);
    const placed = [];
    for (const q of shown) {
      let lift = 0;
      for (let tries = 0; tries < 6; tries++) {
        const y0 = q.y + lift * q.h * 1.15;
        const hit = placed.some((r) => Math.abs(r.x - q.x) < (r.w + q.w) / 2 && y0 < r.y + r.h && r.y < y0 + q.h);
        if (!hit) break;
        lift++;
      }
      q.it.label.center.y = -lift * 1.15;
      placed.push({ x: q.x, y: q.y + lift * q.h * 1.15, w: q.w, h: q.h });
    }
  }

  item(q) {
    const key = `${q.label}|${q.color ?? ''}`;
    let it = this.items.get(q.name);
    if (it && it.key === key) return it;
    if (it) this.drop(it);
    const root = new THREE.Group();
    const fill = new THREE.Mesh(this.unit, new THREE.MeshBasicMaterial({ color: new THREE.Color(q.color ?? '#8fa6b8'), transparent: true, opacity: 0.38, depthWrite: false, fog: false }));
    const edges = new THREE.LineSegments(this.edgeGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, depthTest: false, fog: false }));
    fill.renderOrder = 15; // (after the sea)
    edges.renderOrder = 20;
    fill.userData.place = edges.userData.place = q.name;
    root.add(fill, edges);
    let label = null;
    const lt = labelTexture(q.label);
    if (lt) {
      label = new THREE.Sprite(new THREE.SpriteMaterial({ map: lt.tex, depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false, fog: false }));
      label.center.set(0.5, 0);
      label.scale.set(this.labelSize * lt.aspect, this.labelSize, 1);
      label.renderOrder = 30;
      label.userData.place = q.name;
      root.add(label);
    }
    this.group.add(root);
    it = { root, fill, edges, label, key, active: false };
    this.items.set(q.name, it);
    return it;
  }

  drop(it) {
    this.group.remove(it.root);
    it.fill.material.dispose();
    it.edges.material.dispose();
    if (it.label) {
      it.label.material.map.dispose();
      it.label.material.dispose();
    }
  }

  clear() {
    for (const it of this.items.values()) this.drop(it);
    this.items.clear();
  }

  /**
   * The place a ray hits (its name over the box first, then its box), other than the one you
   * are in; with its distance along the ray. null: none.
   */
  pick(raycaster) {
    this.group.updateMatrixWorld(true);
    const labels = [];
    const boxes = [];
    for (const it of this.items.values()) {
      if (it.active) continue;
      if (it.label?.visible) labels.push(it.label);
      boxes.push(it.fill); // (close up too: a click on its stand-in goes there)
    }
    const hl = raycaster.intersectObjects(labels, false);
    if (hl.length) return { name: hl[0].object.userData.place, distance: 0 };
    const hb = raycaster.intersectObjects(boxes, false);
    if (!hb.length) return null;
    // (a place inside another's box, below deck in the hull: the inner one where the ray meets both)
    const box = (h) => this.items.get(h.object.userData.place);
    const inside = (a, b) => a.min.every((v, k) => v >= b.min[k] - 1e-6 && a.max[k] <= b.max[k] + 1e-6);
    let best = hb[0];
    for (const h of hb) if (h !== best && inside(box(h), box(best))) best = h;
    return { name: best.object.userData.place, distance: best.distance };
  }
}
