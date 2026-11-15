/**
 * The terrain editor (models/terrain.js) in Edit world: with a terrain selected, its areas in the
 * properties (a list: pick one, move it up or down the stack, duplicate, delete; + Hill, + Pit /
 * lake, + Plateau, + Patch, + Polygon add one where the view looks), the picked area's fields
 * (shape, where, size, turn, height, slope, surface…), and in the view every area's outline
 * draped over the ground (the picked one lit) with the gizmo on the picked area: its arrows move
 * it over the terrain (up and down: its height), its green ring turns it. A click on the terrain
 * picks the topmost area there; Esc lets go of the area (the terrain stays selected); Del deletes
 * the area, Ctrl+D duplicates it.
 *
 * Every change is a change of the scene (undo, redo, saved with it), and rebuilds it.
 */
import * as THREE from 'three';
import { AREA_PARAMS, SURFACES, DEFAULT_AREAS, newArea, resolveArea, areaPolygon, areaInside, fromArea, terrainAt } from '../models/terrain.js';
import { MODELS, resolveParams } from '../models/index.js';
import { rotationMatrix } from '../models/composite.js';
import { norm360 } from './gizmoPose.js';

const DEG = 180 / Math.PI;
const r2 = (v) => +(+v).toFixed(2);

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
};

/** New areas from the panel's buttons (centred where the view looks). */
const PRESETS = {
  Hill: { name: 'Hill', shape: 'ellipse', width: 8, depth: 8, height: 2.5, slope: 3.5, noise: 0.2, surface: 'grass' },
  'Pit / lake': { name: 'Lake', shape: 'ellipse', width: 7, depth: 5, height: -1.5, slope: 2, surface: 'water', level: -0.2 },
  Plateau: { name: 'Plateau', shape: 'rectangle', width: 8, depth: 6, height: 1.5, mode: 'level', slope: 1.5, surface: 'rock' },
  Patch: { name: 'Patch', shape: 'ellipse', width: 5, depth: 4, height: 0, slope: 0, surface: 'sand' },
  Polygon: { name: 'Polygon', shape: 'polygon', width: 6, depth: 6, height: 1, slope: 1.5, surface: 'volcanic', points: [[-3, -2], [2.5, -3], [3.5, 1.5], [0, 3.2], [-3.2, 1.2]] },
};

/** A polygon's corners as text ("x z; x z; …") and back. */
export const pointsToText = (P) => P.map(([x, z]) => `${r2(x)} ${r2(z)}`).join('; ');
export function textToPoints(t) {
  const P = String(t)
    .split(/[;\n]/)
    .map((s) => s.trim().split(/[\s,]+/).map(Number))
    .filter((q) => q.length >= 2 && q.every(Number.isFinite))
    .map(([x, z]) => [x, z]);
  return P.length >= 3 ? P : null;
}

/** An area's outline in the terrain's frame: points about every half metre. */
export function areaOutline(a0) {
  const a = resolveArea(a0);
  let P;
  if (a.shape === 'ellipse') {
    const n = Math.max(24, Math.min(160, Math.round((Math.PI * (a.width + a.depth)) / 2 / 0.5)));
    P = Array.from({ length: n }, (_, k) => [(Math.cos((k / n) * 2 * Math.PI) * a.width) / 2, (Math.sin((k / n) * 2 * Math.PI) * a.depth) / 2]);
  } else {
    const C = a.shape === 'polygon' ? areaPolygon(a) : [[-a.width / 2, -a.depth / 2], [a.width / 2, -a.depth / 2], [a.width / 2, a.depth / 2], [-a.width / 2, a.depth / 2]];
    P = [];
    C.forEach((p, k) => {
      const q = C[(k + 1) % C.length];
      const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 0.5));
      for (let s = 0; s < n; s++) P.push([p[0] + ((q[0] - p[0]) * s) / n, p[1] + ((q[1] - p[1]) * s) / n]);
    });
  }
  return P.map(([x, z]) => fromArea(a, x, z));
}

/**
 * The terrain's frame in the world: where the voxelizer put its origin (world.origins) and its
 * turn (its record in the world, world.objectTree). toWorld / toLocal: points between the two.
 */
export function terrainFrame(rec, origin) {
  const R = rotationMatrix(rec.rotation, rec.tiltX, rec.tiltZ);
  const [ox, oy, oz] = origin;
  return {
    R,
    rotation: rec.rotation ?? 0,
    toWorld: (x, y, z) => [ox + R[0] * x + R[1] * y + R[2] * z, oy + R[3] * x + R[4] * y + R[5] * z, oz + R[6] * x + R[7] * y + R[8] * z],
    toLocal: (x, y, z) => {
      const dx = x - ox, dy = y - oy, dz = z - oz;
      return [R[0] * dx + R[3] * dy + R[6] * dz, R[1] * dx + R[4] * dy + R[7] * dz, R[2] * dx + R[5] * dy + R[8] * dz];
    },
  };
}

/**
 * Where the gizmo goes for an area: on the ground at its centre (as the terrain is now: its
 * height field at voxel size h; without h, at its height over the base ground); its turn.
 */
export function areaGizmoPose(frame, params, a0, h) {
  const a = resolveArea(a0);
  const y = h ? terrainAt(resolveParams(MODELS.terrain, params), h, a.x, a.z).y : (params.base ?? 1) + a.height;
  const [x, wy, z] = frame.toWorld(a.x, y, a.z);
  return { x, y: wy, z, ry: (frame.rotation + a.rotation) / DEG };
}

/**
 * The area's fields for where the gizmo left it (start: the pose the drag began at): moved over
 * the terrain, turned; up or down: its height by as much.
 */
export function areaFromGizmo(frame, params, a0, pose, start) {
  const a = resolveArea(a0);
  const [lx, , lz] = frame.toLocal(pose.x, pose.y, pose.z);
  const out = { x: r2(lx), z: r2(lz), rotation: norm360(pose.ry * DEG - frame.rotation) };
  out.height = start && Math.abs(pose.y - start.y) > 1e-3 ? r2(a.height + pose.y - start.y) : a.height;
  return out;
}

/** The topmost area (the last in the stack) at a point of the terrain's frame, or -1. */
export function areaAt(areas, x, z) {
  for (let k = (areas?.length ?? 0) - 1; k >= 0; k--) if (areas[k] && areas[k].enabled !== false && areaInside(resolveArea(areas[k]), x, z) > 0) return k;
  return -1;
}

export class TerrainEditing {
  constructor(ed) {
    this.ed = ed;
    this.area = -1; // the picked area of the selected terrain
    this.group = new THREE.Group();
    this.group.renderOrder = 5;
    ed.ctx.view.root.add(this.group);
  }

  /** The selected object, if it is a terrain (its node, its frame in the world) or null. */
  terrain() {
    const ed = this.ed;
    const ob = ed.node();
    if (!ob || ob.type !== 'terrain') return null;
    const w = ed.ctx.sim.world;
    const rec = w.objectTree?.[ed.sel]?.rec ?? ob;
    const origin = w.origins?.[ed.sel];
    if (!origin) return null;
    ob.params ??= {};
    return { ob, frame: terrainFrame(rec, origin), areas: this.areas(ob) };
  }
  /** Its areas, its own (a terrain still on the defaults gets a copy to edit). */
  areas(ob) {
    if (!Array.isArray(ob.params.areas)) {
      // (on the model's defaults: resolveParams hands those out; never edit them)
      ob.params.areas = JSON.parse(JSON.stringify(DEFAULT_AREAS));
    }
    return ob.params.areas;
  }

  /** The selection goes to object i (from prev): no area picked on another object; a click's pick. */
  selectObject(i, prev) {
    if (this.pending?.k === i) this.area = this.pending.area;
    else if (i !== prev) this.area = -1;
    this.pending = null;
  }

  /* ---------------- the view: outlines, the gizmo on an area ---------------- */
  /** The outlines of the selected terrain's areas (none when no terrain is selected). */
  drawOutlines() {
    for (const c of this.group.children) {
      c.geometry.dispose();
      c.material.dispose();
    }
    this.group.clear();
    const T = this.ed.mode === 'edit' ? this.terrain() : null;
    if (!T) return;
    const w = this.ed.ctx.sim.world;
    const h = w.h;
    T.areas.forEach((a, k) => {
      if (!a) return;
      const pts = areaOutline(a).map(([x, z]) => {
        const p = T.frame.toWorld(x, 0, z);
        // draped over what is there (the top of its voxel column), a little above it
        const cx = Math.floor(p[0] / h);
        const cz = Math.floor(p[2] / h);
        const top = cx >= 0 && cz >= 0 && cx < w.nx && cz < w.nz ? w.colTop[cx + w.nx * cz] : -1;
        return new THREE.Vector3(p[0], (top + 1) * h + 0.06, p[2]);
      });
      const on = k === this.area;
      const mat = new THREE.LineBasicMaterial({ color: on ? 0xffb347 : a.enabled === false ? 0x777777 : 0xffffff, transparent: true, opacity: on ? 1 : 0.55, depthTest: false });
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), mat);
      line.renderOrder = on ? 6 : 5;
      this.group.add(line);
    });
  }

  /** The gizmo on the picked area (true), or not this (false: the object's own). */
  placeGizmo() {
    this.drawOutlines();
    const T = this.terrain();
    const a = T && T.areas[this.area];
    if (!a) return false;
    const ed = this.ed;
    const pose = areaGizmoPose(T.frame, T.ob.params, a, ed.ctx.sim.world.h);
    ed.pivot.position.set(pose.x, pose.y, pose.z);
    ed.pivot.rotation.set(0, pose.ry, 0, 'YXZ');
    ed.pivot.updateMatrixWorld();
    ed.box.visible = false;
    ed.gizmo.setMode(ed.gizmoMode ?? 'translate');
    ed.gizmo.setSpace(ed.gizmo.mode === 'rotate' ? 'local' : 'world');
    // (an area turns about the vertical only)
    const rot = ed.gizmo.mode === 'rotate';
    ed.gizmo.showX = ed.gizmo.showZ = !rot;
    ed.gizmo.showY = true;
    return true;
  }

  /** The gizmo let go over the picked area: its new place, turn and height (true: handled). */
  applyGizmo(pose, start) {
    const T = this.terrain();
    const a = T && T.areas[this.area];
    if (!a) return false;
    const f = areaFromGizmo(T.frame, T.ob.params, a, pose, start);
    if (Object.entries(f).every(([k, v]) => resolveArea(a)[k] === v)) return true;
    this.ed.snapshot();
    Object.assign(a, f);
    this.ed.rebuild();
    return true;
  }

  /** A click in the view hit the terrain (object k) at a point: pick the topmost area there. */
  pickAt(k, point) {
    const ed = this.ed;
    const w = ed.ctx.sim.world;
    const ob = ed.entries()[k]?.node;
    const origin = w.origins?.[k];
    if (!ob || !origin) return;
    const [x, , z] = terrainFrame(w.objectTree?.[k]?.rec ?? ob, origin).toLocal(...point);
    // (taken by selectObject as the selection goes to it)
    this.pending = { k, area: areaAt(ob.params?.areas ?? DEFAULT_AREAS, x, z) };
  }

  /* ---------------- keys ---------------- */
  /** Esc, Del, Ctrl+D on the picked area (true: done here). */
  key(e) {
    if (this.area < 0 || !this.terrain()) return false;
    if (e.code === 'Escape') this.pick(-1);
    else if (e.code === 'Delete' || e.code === 'Backspace') (e.preventDefault(), this.remove(this.area));
    else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD') (e.preventDefault(), this.duplicate(this.area));
    else return false;
    return true;
  }

  /* ---------------- changes ---------------- */
  pick(k) {
    this.area = k;
    this.ed.select(this.ed.sel);
  }
  /** A change to the areas: undo keeps the scene before it, then the scene is rebuilt. */
  change(fn) {
    const T = this.terrain();
    if (!T) return;
    this.ed.snapshot();
    fn(T.areas, T);
    this.ed.rebuild();
  }
  add(preset) {
    this.change((areas, T) => {
      // where the view looks (the orbit's centre), on the terrain
      const tg = this.ed.ctx.view.controls?.target;
      let [x, , z] = tg ? T.frame.toLocal(tg.x, tg.y, tg.z) : [0, 0, 0];
      const p = T.ob.params;
      const W = (p.width ?? 30) / 2, D = (p.depth ?? 30) / 2;
      if (!(Math.abs(x) < W && Math.abs(z) < D)) x = z = 0;
      const a = newArea({ ...JSON.parse(JSON.stringify(PRESETS[preset])), x: r2(x), z: r2(z) });
      a.name = `${a.name} ${areas.length + 1}`;
      areas.push(a);
      this.area = areas.length - 1;
    });
  }
  remove(k) {
    this.change((areas) => {
      areas.splice(k, 1);
      this.area = -1;
    });
  }
  duplicate(k) {
    this.change((areas) => {
      const c = JSON.parse(JSON.stringify(areas[k]));
      c.x = r2((c.x ?? 0) + 1);
      c.z = r2((c.z ?? 0) + 1);
      c.name = `${c.name ?? 'Area'} copy`;
      areas.splice(k + 1, 0, c);
      this.area = k + 1;
    });
  }
  /** Up (−1) or down (+1) the stack: later areas lie over earlier ones. */
  move(k, by) {
    const j = k + by;
    this.change((areas) => {
      if (j < 0 || j >= areas.length) return;
      [areas[k], areas[j]] = [areas[j], areas[k]];
      this.area = j;
    });
  }

  /* ---------------- the properties ---------------- */
  /** The terrain's areas in its properties (gui: the object's lil-gui, change: its commit). */
  folder(gui, ob, change) {
    const T = this.terrain();
    if (!T) return;
    const areas = T.areas;
    const fa = gui.addFolder(`Areas (${areas.length}): later ones lie over earlier ones`);
    const box = el('div', { class: 'terrainAreas' });
    const list = el('div', { class: 'list' });
    areas.forEach((a0, k) => {
      const a = resolveArea(a0);
      const hgt = a.height ? `${a.height > 0 ? '+' : ''}${r2(a.height)} m` : '';
      list.append(
        el(
          'div',
          { class: `row${k === this.area ? ' on' : ''}${a.enabled ? '' : ' off'}` },
          el('button', { class: 'name', title: `${a.name}: ${a.shape}, ${SURFACES[a.surface]?.label ?? 'height only'}${hgt ? `, ${hgt}` : ''}. Click: edit it, the gizmo on it`, onclick: () => this.pick(k === this.area ? -1 : k) }, el('span', { class: 'n' }, String(k + 1)), a.name, el('span', { class: 'tag' }, a.surface), hgt ? el('span', { class: 'tag' }, hgt) : null),
          el('button', { title: 'Earlier: under the ones after it', disabled: k === 0, onclick: () => this.move(k, -1) }, '↑'),
          el('button', { title: 'Later: over the ones before it', disabled: k === areas.length - 1, onclick: () => this.move(k, 1) }, '↓'),
          el('button', { title: 'Duplicate', onclick: () => this.duplicate(k) }, '⧉'),
          el('button', { class: 'x', title: 'Delete this area', onclick: () => this.remove(k) }, '✕'),
        ),
      );
    });
    if (!areas.length) list.append(el('p', { class: 'muted' }, 'No areas: the ground is flat. Add one:'));
    box.append(list, el('div', { class: 'add' }, ...Object.keys(PRESETS).map((n) => el('button', { title: `A new ${n.toLowerCase()} where the view looks`, onclick: () => this.add(n) }, `+ ${n}`))));
    fa.$children.append(box);
    const a = areas[this.area];
    if (!a) return;
    const fe = gui.addFolder(`Area ${this.area + 1}: ${a.name ?? 'Area'}`);
    const r = resolveArea(a);
    const S = SURFACES[r.surface];
    const p = ob.params;
    // a field of the area (missing: its default; moisture and tall grass: the terrain's)
    const field = (k) => ({
      get v() {
        return a[k] ?? (k === 'moisture' || k === 'tall' ? p[k] ?? 0 : AREA_PARAMS[k].value);
      },
      set v(x) {
        a[k] = x;
      },
    });
    const add = (k) => {
      const spec = AREA_PARAMS[k];
      const f = field(k);
      let c;
      if (spec.options) c = fe.add(f, 'v', spec.options);
      else if (typeof spec.value === 'boolean') c = fe.add(f, 'v');
      else if (typeof spec.value === 'string') c = fe.add(f, 'v');
      else c = fe.add(f, 'v', spec.min, spec.max, spec.step);
      c.name(spec.label).onFinishChange(change);
    };
    ['name', 'enabled', 'shape', 'x', 'z'].forEach(add);
    if (r.shape === 'polygon') {
      // the corners as text: "x z; x z; …" (metres, in the area's own frame)
      const pts = {
        get v() {
          return pointsToText(areaPolygon(r));
        },
        set v(t) {
          const P = textToPoints(t);
          if (P) a.points = P;
        },
      };
      fe.add(pts, 'v').name('Corners (x z; x z; … m)').onFinishChange(change);
    } else ['width', 'depth'].forEach(add);
    ['rotation', 'height', 'mode', 'slope', 'profile', 'noise', 'surface'].forEach(add);
    if (S?.grass) ['moisture', 'tall'].forEach(add);
    if (S?.fluid) add('level');
    if (S?.snow) add('snow');
  }
}
