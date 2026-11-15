/**
 * Drawing patrols (ai/patrol.js) in Edit world: with a squad, a guard post (enemy) or a soldier
 * squad on patrol (campPatrol) selected, its patrol path and patrol area are drawn on the ground
 * in the view and edited there, as the terrain's areas are (editor/terrainPanel.js):
 *
 *  - the path: a line over the ground through its waypoints (numbered handles), an arrow on each
 *    leg the way they walk it (both ways: back and forth; the leg back to the start dashed: a
 *    loop), a ring round a waypoint where they stop;
 *  - the area: its outline, a handle on each corner.
 *  - ✎ Draw path / ✎ Draw area (in the properties' Patrol folder): each click on the ground adds a
 *    waypoint at the end of the path (an area: a corner into its nearest edge); a click on a leg
 *    or an edge puts a point in there. Enter or Esc ends drawing.
 *  - A handle: click it to pick it (its options in the properties: pause, look round, stance,
 *    pace of the leg to it), drag it to move it; Del deletes the picked point; Esc lets go of it.
 *  - ▭ Rect / ◯ Circle: a rectangular or round area (a polygon of 16 corners) round the squad.
 *  - ◇ Patrols (in the mode bar): every squad's path and area in the view, in Edit (from the
 *    scene) and in Play (a debug overlay, from the guards' patrols in the world as they are).
 *
 * The path and the area are the object's params (text, its own frame: they move and turn with it),
 * so every change is a change of the scene: undo, redo, saved with it, and it is rebuilt.
 */
import * as THREE from 'three';
import { parsePath, formatPath, formatPoly, insertPoint, deletePoint, movePoint, insertIndex, nearestSegment, rectPoly, circlePoly, PACES } from '../ai/patrol.js';
import { terrainFrame } from './terrainPanel.js';

/** The models that patrol (and so have a drawn path and area). */
export const PATROL_TYPES = { squad: 1, enemy: 1, campPatrol: 1 };
const PATH_COLOR = 0x4fc3ff;
const AREA_COLOR = 0xffd54a;
const PICK_COLOR = 0xff8a3d;
const SHOW_KEY = 'fireEditor.showPatrols';
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

/**
 * A patrol drawn into a group (world points): path [[x, y, z]…] with its order and stops, area
 * [[x, y, z]…]; pick { kind, i } lights a handle; handles false: lines only (all squads').
 */
export function drawPatrol(group, { path = [], order = 'loop', stops = [], area = [], pick = null, handles = true, dim = false }) {
  const op = dim ? 0.45 : 1;
  const line = (pts, color, loop = false, dashed = false) => {
    const g = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(...p)));
    const m = dashed ? new THREE.LineDashedMaterial({ color, dashSize: 0.5, gapSize: 0.35, depthTest: false, transparent: true, opacity: op }) : new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: op });
    const o = loop ? new THREE.LineLoop(g, m) : new THREE.Line(g, m);
    if (dashed) o.computeLineDistances();
    o.renderOrder = 7;
    group.add(o);
  };
  const mesh = (geo, color, p, o = 1) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: op * o }));
    m.position.set(...p);
    m.renderOrder = 8;
    group.add(m);
    return m;
  };
  const arrow = (a, b, color) => {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const L = d.length();
    if (L < 0.5) return;
    const m = mesh(new THREE.ConeGeometry(0.22, 0.6, 10), color, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  };
  if (area.length) {
    if (area.length >= 2) line(area, AREA_COLOR, area.length >= 3);
    if (handles) area.forEach((p, i) => mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), pick?.kind === 'area' && pick.i === i ? PICK_COLOR : AREA_COLOR, p));
  }
  if (path.length) {
    if (path.length >= 2) line(path, PATH_COLOR);
    // the leg back to the start: dashed (a loop)
    if (order === 'loop' && path.length >= 3) line([path[path.length - 1], path[0]], PATH_COLOR, false, true);
    for (let i = 0; i + 1 < path.length; i++) {
      arrow(path[i], path[i + 1], PATH_COLOR);
      if (order === 'pingpong') arrow(path[i + 1], path[i], 0x2a8fd0);
    }
    if (order === 'loop' && path.length >= 3) arrow(path[path.length - 1], path[0], PATH_COLOR);
    path.forEach((p, i) => {
      const on = pick?.kind === 'path' && pick.i === i;
      if (handles || i === 0) mesh(new THREE.SphereGeometry(i === 0 ? 0.32 : 0.26, 14, 10), on ? PICK_COLOR : i === 0 ? 0xffffff : PATH_COLOR, p);
      // a stop: a ring round it (orange: crouched)
      if (stops[i]?.pause > 0) {
        const ring = mesh(new THREE.RingGeometry(0.5, 0.62, 24), stops[i].stance === 'crouch' ? PICK_COLOR : 0xffffff, p, 0.8);
        ring.rotation.x = -Math.PI / 2;
        ring.material.side = THREE.DoubleSide;
      }
    });
  }
}

export class PatrolEditing {
  constructor(ed) {
    this.ed = ed;
    this.tool = null; // 'path' | 'area': clicks on the ground add points
    this.pick = null; // the picked point: { kind: 'path' | 'area', i }
    this.handles = []; // [{ kind, i, p: world }] of the selected object
    try {
      this.showAll = localStorage.getItem(SHOW_KEY) === '1';
    } catch {
      this.showAll = false;
    }
    const v = ed.ctx.view;
    this.group = new THREE.Group();
    v.root.add(this.group);
    // the toggle: every squad's patrol in the view (Edit), a debug overlay (Play)
    this.btn = el('button', { class: 'patrols', title: "Show every squad's patrol path and area in the view (Edit; in Play: a debug overlay)", onclick: () => this.toggleAll() }, '◇ Patrols');
    ed.bar.append(this.btn);
    this.btn.classList.toggle('on', this.showAll);
    // handles: a press on one picks it and drags it (not the orbit, not the gizmo, not a pick)
    const cv = v.renderer.domElement;
    window.addEventListener('pointerdown', (e) => this.down(e), true);
    window.addEventListener('pointermove', (e) => this.drag?.move(e), true);
    window.addEventListener('pointerup', (e) => this.drag?.up(e), true);
    this.cv = cv;
    // redrawn when the world is rebuilt behind the editor's back (a restart, a scene, Play)
    setInterval(() => {
      const m = this.ed.mode;
      if ((m === 'edit' || (m === 'play' && this.showAll)) && this.drawnWorld !== this.ed.ctx.sim?.world) this.draw();
    }, 500);
  }

  /* ---------------- the selected object ---------------- */
  /** The selected object if it patrols: its node, its frame in the world, its path and area. */
  target() {
    const ed = this.ed;
    const ob = ed.node();
    return ob && PATROL_TYPES[ob.type] ? this.of(ob, ed.sel) : null;
  }
  of(ob, k) {
    const w = this.ed.ctx.sim.world;
    const origin = w.origins?.[k];
    if (!origin) return null;
    ob.params ??= {};
    const frame = terrainFrame(w.objectTree?.[k]?.rec ?? ob, origin);
    // (an area being drawn keeps its first corners: one with fewer than 3 is not yet one for the AI)
    return { ob, frame, W: parsePath(ob.params.patrolPath), A: parsePath(ob.params.patrolArea).map((w) => w.p) };
  }
  /** A point of the object's frame on the ground of the world (over what is there). */
  ground(T, x, z) {
    const w = this.ed.ctx.sim.world;
    const p = T.frame.toWorld(x, T.ob.params.level ?? 0, z);
    const h = w.h;
    const cx = Math.floor(p[0] / h);
    const cz = Math.floor(p[2] / h);
    const top = cx >= 0 && cz >= 0 && cx < w.nx && cz < w.nz ? w.colTop?.[cx + w.nx * cz] : undefined;
    return [p[0], top != null && top >= 0 ? (top + 1) * h + 0.08 : p[1] + 0.08, p[2]];
  }
  orderOf = (ob) => ({ loop: 'loop', 'back and forth': 'pingpong', 'one way': 'once' })[ob.params.patrolOrder ?? 'loop'] ?? 'loop';

  /** The selection goes to object i (from prev): drawing and the picked point stay with their object. */
  selectObject(i, prev) {
    if (i !== prev) {
      this.tool = null;
      this.pick = null;
    }
  }
  setMode() {
    if (this.ed.mode !== 'edit') this.tool = null;
    this.draw();
  }
  toggleAll() {
    this.showAll = !this.showAll;
    this.btn.classList.toggle('on', this.showAll);
    try {
      localStorage.setItem(SHOW_KEY, this.showAll ? '1' : '0');
    } catch {
      /* (no storage: for this page only) */
    }
    this.draw();
  }

  /* ---------------- the view ---------------- */
  draw() {
    for (const c of this.group.children) {
      c.geometry.dispose();
      c.material.dispose();
    }
    this.group.clear();
    this.handles = [];
    const ed = this.ed;
    const w = ed.ctx.sim?.world;
    this.drawnWorld = w;
    if (!w) return;
    if (ed.mode === 'play') {
      // a debug overlay: the guards' patrols as the world has them (world points, turned and moved)
      if (!this.showAll) return;
      const seen = new Set();
      for (const e of w.enemies ?? []) {
        const a = e.area;
        if (!a || seen.has(a)) continue;
        seen.add(a);
        const up = (c) => [c[0], c[1] + 0.12, c[2]];
        if (a.mode === 'route') drawPatrol(this.group, { path: a.corners.map(up), order: a.order ?? 'loop', stops: a.stops ?? [], area: (a.zone ?? []).map(up), handles: false });
        else drawPatrol(this.group, { area: a.corners.map(up), handles: false });
      }
      return;
    }
    if (ed.mode !== 'edit') return;
    // every squad's (dim), then the selected one's with its handles
    if (this.showAll)
      ed.entries().forEach(({ node }, k) => {
        if (!PATROL_TYPES[node.type] || k === ed.sel) return;
        const T = this.of(node, k);
        if (T) drawPatrol(this.group, { path: T.W.map((q) => this.ground(T, ...q.p)), order: this.orderOf(node), stops: T.W, area: T.A.map((q) => this.ground(T, ...q)), handles: false, dim: true });
      });
    const T = this.target();
    if (!T) return;
    const path = T.W.map((q) => this.ground(T, ...q.p));
    const area = T.A.map((q) => this.ground(T, ...q));
    drawPatrol(this.group, { path, order: this.orderOf(T.ob), stops: T.W, area, pick: this.pick });
    this.handles = [...path.map((p, i) => ({ kind: 'path', i, p })), ...area.map((p, i) => ({ kind: 'area', i, p }))];
  }

  /** A world point on the screen (client pixels). */
  screen(p) {
    const v = this.ed.ctx.view;
    const q = v.root.localToWorld(new THREE.Vector3(...p)).project(v.camera);
    const r = this.cv.getBoundingClientRect();
    return [r.left + ((q.x + 1) / 2) * r.width, r.top + ((1 - q.y) / 2) * r.height, q.z];
  }
  /** The handle under the pointer (within 12 px), or null. */
  handleAt(e) {
    let best = null;
    let bd = 12;
    for (const h of this.handles) {
      const [sx, sy, sz] = this.screen(h.p);
      if (sz > 1) continue;
      const d = Math.hypot(sx - e.clientX, sy - e.clientY);
      if (d < bd) (bd = d), (best = h);
    }
    return best;
  }
  /** The ground under the pointer in the object's frame ([x, z]), or null (a plane at y when nothing is hit). */
  groundAt(T, e, y = null) {
    const v = this.ed.ctx.view;
    const hit = v.pick(e.clientX, e.clientY);
    let p = hit?.point;
    if (!p && y != null) {
      const r = this.cv.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), v.camera);
      const o = v.root.worldToLocal(ray.ray.origin.clone());
      const d = v.root.worldToLocal(ray.ray.origin.clone().add(ray.ray.direction)).sub(o);
      if (Math.abs(d.y) > 1e-6) {
        const t = (y - o.y) / d.y;
        if (t > 0) p = [o.x + d.x * t, y, o.z + d.z * t];
      }
    }
    if (!p) return null;
    const [x, , z] = T.frame.toLocal(...p);
    return [r2(x), r2(z)];
  }

  /** A press in the view: on a handle, pick it and drag it. */
  down(e) {
    if (this.ed.mode !== 'edit' || e.button !== 0 || e.target !== this.cv) return;
    const h = this.handles.length ? this.handleAt(e) : null;
    if (!h) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    const T = this.target();
    if (!T) return;
    const changed = !this.pick || this.pick.kind !== h.kind || this.pick.i !== h.i;
    this.pick = { kind: h.kind, i: h.i };
    let moved = false;
    this.drag = {
      move: (ev) => {
        if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return;
        const q = this.groundAt(T, ev, h.p[1]);
        if (!q) return;
        if (!moved) this.ed.snapshot(); // (undo: the scene before the drag)
        moved = true;
        this.write(T, h.kind, (P) => movePoint(P, h.i, ...q));
        this.draw();
      },
      up: () => {
        this.drag = null;
        if (moved) this.ed.rebuild();
        else if (changed) this.ed.select(this.ed.sel); // (its options in the properties)
        else this.draw();
      },
    };
    this.draw();
  }

  /** The editor's click in the view (not a drag): while drawing, a point there (true: taken). */
  click(e) {
    if (!this.tool || this.ed.mode !== 'edit') return false;
    const T = this.target();
    if (!T) return (this.tool = null), false;
    const q = this.groundAt(T, e);
    if (!q) return true;
    const kind = this.tool;
    const P = kind === 'path' ? T.W.map((w) => w.p) : T.A;
    // on a leg or an edge (within ~10 px on the screen, or 0.8 m): in there; else at the end (an area: its nearest edge)
    let i = insertIndex(P, q[0], q[1], kind === 'area', 0.8);
    const s = P.length >= 2 ? nearestSegment(P, q[0], q[1], kind === 'area' || (kind === 'path' && this.orderOf(T.ob) === 'loop' && P.length >= 3)) : null;
    if (s) {
      const a = this.screen(this.ground(T, ...P[s.i]));
      const b = this.screen(this.ground(T, ...P[(s.i + 1) % P.length]));
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((e.clientX - a[0]) * dx + (e.clientY - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      if (Math.hypot(a[0] + dx * t - e.clientX, a[1] + dy * t - e.clientY) < 10 && t > 0.05 && t < 0.95) i = s.i + 1;
    }
    // (a point on the loop's closing leg: at the end)
    if (kind === 'path' && i > P.length) i = P.length;
    this.ed.snapshot();
    this.write(T, kind, (L) => insertPoint(L, i, kind === 'path' ? { p: q } : q));
    this.pick = { kind, i };
    this.ed.rebuild();
    return true;
  }

  /** Write the path (waypoints) or the area (corners) back to the params through fn(list). */
  write(T, kind, fn) {
    const p = T.ob.params;
    if (kind === 'path') {
      T.W = fn(T.W);
      p.patrolPath = formatPath(T.W);
    } else {
      T.A = fn(T.A);
      p.patrolArea = formatPoly(T.A);
    }
  }
  /** A change (undo keeps the scene before it), then rebuilt. */
  change(fn) {
    const T = this.target();
    if (!T) return;
    this.ed.snapshot();
    fn(T);
    this.ed.rebuild();
  }
  removePick() {
    const k = this.pick;
    if (!k) return;
    this.pick = null;
    this.change((T) => this.write(T, k.kind, (P) => deletePoint(P, k.i)));
  }

  /* ---------------- keys ---------------- */
  /** Esc, Enter, Del on the drawing and the picked point (true: done here). */
  key(e) {
    if (!this.target() || (!this.tool && !this.pick)) return false;
    if (e.code === 'Escape' || e.code === 'Enter') {
      if (this.tool) this.setTool(null);
      else (this.pick = null), this.ed.select(this.ed.sel);
    } else if ((e.code === 'Delete' || e.code === 'Backspace') && this.pick) (e.preventDefault(), this.removePick());
    else return false;
    return true;
  }
  setTool(t) {
    this.tool = this.tool === t ? null : t;
    this.ed.setHint(this.tool === 'path' ? 'Drawing the patrol path: click the ground to add a waypoint · click a leg to put one in · drag a point to move it · Del deletes the picked one · Enter / Esc: done' : this.tool === 'area' ? 'Drawing the patrol area: click the ground to add a corner (into the nearest edge) · drag a corner to move it · Del deletes the picked one · Enter / Esc: done' : null);
    this.ed.select(this.ed.sel);
  }

  /* ---------------- the properties ---------------- */
  /** The Patrol folder (gui: the object's lil-gui, change: its commit). */
  folder(gui, ob) {
    if (!PATROL_TYPES[ob.type]) return;
    const T = this.target();
    if (!T) return;
    const f = gui.addFolder(`Patrol: path (${T.W.length} points), area (${T.A.length >= 3 ? `${T.A.length} corners` : 'none'})`);
    const box = el('div', { class: 'terrainAreas patrolPanel' });
    const tb = (label, title, on, fn) => el('button', { title, class: on ? 'on' : '', onclick: fn }, label);
    box.append(
      el(
        'div',
        { class: 'add' },
        tb(this.tool === 'path' ? '✓ Drawing path' : '✎ Draw path', 'Click the ground in the view to add waypoints (Enter / Esc: done)', this.tool === 'path', () => this.setTool('path')),
        tb(this.tool === 'area' ? '✓ Drawing area' : '✎ Draw area', 'Click the ground in the view to add corners of the area (Enter / Esc: done)', this.tool === 'area', () => this.setTool('area')),
        tb('▭ Rect', 'A rectangular area (16 × 16 m) round the squad', false, () => this.preset('rect')),
        tb('◯ Circle', 'A round area (8 m radius) round the squad', false, () => this.preset('circle')),
      ),
    );
    const list = el('div', { class: 'list' });
    const row = (kind, i, label, tags) =>
      el(
        'div',
        { class: `row${this.pick?.kind === kind && this.pick.i === i ? ' on' : ''}` },
        el('button', { class: 'name', title: 'Click: pick it (its options below); drag its handle in the view to move it', onclick: () => ((this.pick = this.pick?.kind === kind && this.pick.i === i ? null : { kind, i }), this.ed.select(this.ed.sel)) }, el('span', { class: 'n' }, String(i + 1)), label, ...tags.map((t) => el('span', { class: 'tag' }, t))),
        el('button', { class: 'x', title: 'Delete this point', onclick: () => ((this.pick = { kind, i }), this.removePick()) }, '✕'),
      );
    if (T.W.length) list.append(el('p', { class: 'muted' }, 'Path'));
    T.W.forEach((w, i) => list.append(row('path', i, `${w.p[0]}, ${w.p[1]}`, [w.pause > 0 ? `${w.pause}s` : null, w.look ? 'look' : null, w.stance === 'crouch' ? 'crouch' : null, w.speed && w.speed !== 'walk' ? w.speed : null].filter(Boolean))));
    if (T.A.length) list.append(el('p', { class: 'muted' }, `Area${T.A.length < 3 ? ' (3 corners at least)' : ''}`));
    T.A.forEach((q, i) => list.append(row('area', i, `${q[0]}, ${q[1]}`, [])));
    if (!T.W.length && !T.A.length) list.append(el('p', { class: 'muted' }, 'Nothing drawn: their own patrol. Draw a path or an area:'));
    box.append(list);
    box.append(
      el(
        'div',
        { class: 'add' },
        T.W.length ? tb('Clear path', 'Delete the whole path', false, () => this.change((T2) => this.write(T2, 'path', () => []))) : null,
        T.A.length ? tb('Clear area', 'Delete the whole area', false, () => this.change((T2) => this.write(T2, 'area', () => []))) : null,
        T.W.length >= 2 ? tb('⇄ Reverse', 'Walk the path the other way', false, () => this.change((T2) => this.write(T2, 'path', (P) => P.slice().reverse()))) : null,
      ),
    );
    f.$children.append(box);
    // the picked waypoint's options (what the guard AI does there: ai/patrol.js)
    const w = this.pick?.kind === 'path' ? T.W[this.pick.i] : null;
    if (!w) return;
    const fw = gui.addFolder(`Waypoint ${this.pick.i + 1}`);
    const opt = { pause: w.pause ?? 0, look: !!w.look, stance: w.stance ?? 'stand', speed: w.speed ?? 'walk' };
    const set = () =>
      this.change((T2) =>
        this.write(T2, 'path', (P) => P.map((q, k) => (k === this.pick.i ? { p: q.p, pause: opt.pause, look: opt.look, stance: opt.stance, speed: opt.speed } : q))),
      );
    fw.add(opt, 'pause', 0, 120, 0.5).name('Pause here (s)').onFinishChange(set);
    fw.add(opt, 'look').name('Look round while waiting').onFinishChange(set);
    fw.add(opt, 'stance', ['stand', 'crouch']).name('Stance while waiting').onFinishChange(set);
    fw.add(opt, 'speed', PACES).name('Pace of the leg to it (walk; patrol: at the ready; run)').onFinishChange(set);
  }
  preset(kind) {
    this.change((T) => {
      // round the squad (its origin), or where the view looks if that is near
      const tg = this.ed.ctx.view.controls?.target;
      let [x, , z] = tg ? T.frame.toLocal(tg.x, tg.y, tg.z) : [0, 0, 0];
      if (Math.hypot(x, z) > 40) x = z = 0;
      this.write(T, 'area', () => (kind === 'rect' ? rectPoly(x, z, 16, 16) : circlePoly(x, z, 8)));
      this.pick = null;
    });
  }
}
