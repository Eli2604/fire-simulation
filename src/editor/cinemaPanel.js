/**
 * Film cameras and the movie in the editor (models/camera.js, src/cinema/):
 *
 *  - In Edit world every camera is drawn as a camera with its view (the frustum of its lens, the
 *    frame's aspect), its keyframed path and keys; a click on one selects it. Not drawn in Play.
 *    What it follows is linked to it by a green line, what it looks at by a dashed yellow one.
 *    The selected camera has an aim handle (a ball where it looks): drag it onto anything in the
 *    view and the camera turns to it (its pan / tilt, or its aim point), the frustum with it.
 *  - A selected camera's properties: Aim (pan, tilt, roll; what it looks at: its own direction,
 *    its aim point, a subject or object from the list or 🎯 Aim at… and a click on it in the
 *    view; framing on the thirds; look smoothing), Move (what its position follows, from the
 *    list or 🎯 Pick… in the view; the offset, the lag; its path: ✎ Draw path, clicks add
 *    points, the blue balls dragged along their level, the white cones up and down, Del deletes
 *    the picked one; shared with another camera, attached to a moving thing), its lens, focus
 *    and exposure, effects,
 *    and its keyframes: a timeline to scrub, ◆ Set key here, 📷 Camera from view, 👁 Look
 *    through, ▶ Preview.
 *  - 🎬 Movie (in the mode bar): the timeline of the place you are in (place.movie,
 *    cinema/timeline.js): sequences with names, each a track of camera clips on a time ruler
 *    (seconds of movie, and of simulation when it runs at another speed). Drag a camera onto the
 *    track, drag a clip to move it, its edges to trim it (snapping to the other clips, the
 *    playhead and the grid; Shift: no snapping), click its badge for its transition; the
 *    playhead scrubs (👁: through the camera on then, at that moment of its move; ▶ Preview:
 *    played, the world still); ☰ List: every clip with its exact times to type. ▶ Play movie,
 *    ⏺ Record (in Play, the UI hidden, Esc stops).
 *
 * Camera settings and the movie are changes of the scene (undo, saved with it) that need no
 * rebuild of the world.
 */
import * as THREE from 'three';
import { MODELS } from '../models/index.js';
import { LENSES } from '../cinema/lens.js';
import { EASE_NAMES, setKey, keysDuration, samplePath, sortKeys } from '../cinema/keyframes.js';
import { moveDuration, subjectsOf } from '../cinema/rig.js';
import { nextCameraName } from '../cinema/sequence.js';
import { aimAt, resolveTargets, targetPoint, offsetFrom, pickTarget, objectName, objectTargets, findTarget } from '../cinema/aim.js';
import { TRANSITIONS, CLOCKS, migrateMovie, addClip, moveClip, trimClip, splitClip, setClipStart, setClipDur, clipAt, sequenceDuration, toSim, fromSim, addSequence, renameSequence, removeSequence, renameCamera, clipEnd } from '../cinema/timeline.js';
import { Director, camerasOf, cameraFrame, targetsOf, FX_KEYS } from '../cinema/director.js';
import { controlPoints, carry, uncarry, pathPolyline, measured, pathDuration } from '../cinema/path.js';
import { toLocal, flattenObjects } from '../models/composite.js';

const SEL_COLOR = 0xffa040;
const CAM_COLOR = 0xe8eef8;
const ON_COLOR = 0x7fd0ff; // the camera on at the movie's playhead
const PATH_COLOR = 0x6fd3ff;
const FOLLOW_COLOR = 0x7dff9a;
const LOOK_COLOR = 0xffd166;
const r2 = (v) => +(+v).toFixed(2);
const r3 = (v) => +(+v).toFixed(3);
const TR_ICON = { cut: '|', dissolve: '⋈', fade: '◐' };

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

export class CinemaEditing {
  constructor(ed) {
    this.ed = ed;
    const C = ed.ctx;
    this.view = C.view;
    this.t = 0; // the scrubbed time of the selected camera's move
    this.playhead = 0; // the movie timeline's playhead (s of movie time)
    this.zoom = 40; // px a second on the timeline
    this.snap = true;
    this.listView = false;
    this.seqIndex = null; // the sequence shown (null: the one that plays)
    this.picking = null; // 'look' | 'follow': the next click in the view picks it
    this.pathTool = false; // drawing the selected camera's path: clicks add points
    this.pathPick = null; // its picked point
    this.pathHeight = 2; // new path points: this high over what is clicked (m)
    this.group = new THREE.Group();
    this.group.visible = false;
    this.view.root.add(this.group);
    this.pickables = [];
    this.director = new Director({
      view: C.view,
      get scene() {
        return C.scene;
      },
      get sim() {
        return C.sim;
      },
      place: () => C.place(),
      restart: () => C.restart(),
      state: C.state,
      editor: ed,
      get walk() {
        return C.walk;
      },
    });
    const v = this.view;
    this.director.hideList = () => [ed.gizmoHelper, ed.box, ed.terrain?.group, ed.patrol?.group, this.group, v.places?.group, v.markers?.group];
    this.director.onStop = () => {
      this.updateButtons();
      this.draw();
    };
    this.director.onTime = (t) => this.showTime(t);
    this.director.onSeqTime = (t) => this.showPlayhead(t, false);
    // the Movie button and panel
    this.btn = el('button', { class: 'movie', title: 'The movie of this place: its timeline of camera clips, play it, record it', onclick: () => this.toggleMovie() }, '🎬 Movie');
    ed.bar.append(this.btn);
    this.panel = el('div', { id: 'moviePanel', hidden: true });
    document.body.append(this.panel);
    // the aim handle: dragged before the view's orbit and the gizmo get the pointer
    v.renderer.domElement.addEventListener('pointerdown', (e) => this.handleDown(e), true);
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.code === 'Escape' && this.picking) {
          e.stopImmediatePropagation();
          this.stopPicking();
        } else if ((e.code === 'Escape' || e.code === 'Enter') && this.pathTool) {
          e.stopImmediatePropagation();
          this.setPathTool(false);
        } else if ((e.code === 'Delete' || e.code === 'Backspace') && this.pathPick != null && this.ed.mode === 'edit' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName ?? '') && this.selected()?.params.move === 'path') {
          e.stopImmediatePropagation();
          e.preventDefault();
          this.removePathPoint();
        }
      },
      true,
    );
    // redrawn when the world is rebuilt (a restart, another scene)
    setInterval(() => {
      if (this.ed.mode === 'edit' && this.drawnWorld !== C.sim?.world) this.draw();
    }, 500);
  }

  cameras() {
    return camerasOf(this.ed.ctx.scene, this.ed.ctx.sim?.world);
  }
  /** What cameras can follow and look at here: the subjects of the world and its named objects. */
  targets() {
    return targetsOf(this.ed.ctx.scene, this.ed.ctx.sim?.world);
  }
  /** The selected object's camera entry, if it is a camera. */
  selected() {
    const ob = this.ed.node();
    return ob?.type === 'camera' ? this.cameras().find((c) => c.node === ob) ?? null : null;
  }
  /** The place's movie, as a timeline (an old shot list migrated). */
  movie() {
    const place = this.ed.ctx.place();
    if (!place.movie || !Array.isArray(place.movie.sequences)) place.movie = migrateMovie(place.movie);
    return place.movie;
  }
  /** The sequence shown in the panel. */
  seq() {
    const M = this.movie();
    if (this.seqIndex == null || this.seqIndex >= M.sequences.length) this.seqIndex = Math.min(M.active ?? 0, M.sequences.length - 1);
    return M.sequences[this.seqIndex];
  }

  setMode(m) {
    if (m !== 'edit' && this.director.active && this.director.kind !== 'movie') this.director.stop();
    if (m !== 'edit') this.stopPicking();
    this.group.visible = m === 'edit';
    if (m === 'rig' || m === 'camp') this.panel.hidden = true;
    this.btn.hidden = m === 'rig' || m === 'camp';
    this.btn.classList.toggle('on', !this.panel.hidden);
    if (!this.panel.hidden) this.renderMovie();
    this.draw();
  }

  /** Cameras with the same name (a duplicate, a new one) get names of their own. */
  ensureNames() {
    const seen = new Set();
    for (const c of this.cameras()) {
      const n = c.node.params?.name;
      if (!n || seen.has(n)) {
        c.node.params ??= {};
        c.node.params.name = nextCameraName([...seen, ...this.cameras().map((q) => q.node.params?.name)]);
      }
      seen.add(c.node.params.name);
    }
    // (a duplicate of an object aimed at: not the same target, the copy unnamed)
    const refs = new Set();
    for (const e of flattenObjects(this.ed.ctx.scene?.objects ?? [])) {
      if (!e.node.ref) continue;
      if (refs.has(e.node.ref)) delete e.node.ref;
      else refs.add(e.node.ref);
    }
  }

  /* ---------------- drawn in the view ---------------- */
  draw() {
    const g = this.group;
    for (const o of g.children.slice()) {
      g.remove(o);
      o.traverse((q) => {
        q.geometry?.dispose();
        q.material?.dispose();
      });
    }
    this.pickables = [];
    this.handle = null;
    this.drawnWorld = this.ed.ctx.sim?.world;
    if (this.ed.mode !== 'edit') return;
    const sel = this.ed.node();
    const T = this.targets();
    const line = (pts, color, opacity, dashed = false) => {
      const geo = new THREE.BufferGeometry().setFromPoints(pts.map((p) => (p.isVector3 ? p : new THREE.Vector3(...p))));
      const mat = dashed ? new THREE.LineDashedMaterial({ color, dashSize: 0.3, gapSize: 0.2, transparent: true, opacity, depthTest: false }) : new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false });
      const l = new THREE.Line(geo, mat);
      if (dashed) l.computeLineDistances();
      l.renderOrder = 8;
      g.add(l);
      return l;
    };
    const marker = (p, color, size) => {
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(size), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthTest: false, wireframe: true }));
      m.position.set(...p);
      m.renderOrder = 9;
      g.add(m);
    };
    const onAir = this.onAir; // (the camera on at the timeline's playhead, and when in its move)
    for (const c of this.cameras()) {
      const on = c.node === sel;
      const live = !on && onAir?.name === c.name;
      const color = on ? SEL_COLOR : live ? ON_COLOR : CAM_COLOR;
      const R = resolveTargets(c, T);
      const F = cameraFrame(c, on ? this.t : live ? onAir.local : 0, { subject: R.follow, look: R.look, carrier: R.carrier, canvasAspect: this.view.camera.aspect, motion: false });
      const rig = new THREE.Group();
      rig.position.set(...F.E.pos);
      rig.lookAt(new THREE.Vector3(...F.E.target));
      rig.rotateZ(-F.E.roll * (Math.PI / 180));
      const m = (geo, opts = {}) => new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false, ...opts }));
      const body = m(new THREE.BoxGeometry(0.22, 0.28, 0.42));
      body.position.z = -0.12;
      const lens = m(new THREE.CylinderGeometry(0.07, 0.09, 0.16, 12));
      lens.rotation.x = Math.PI / 2;
      lens.position.z = 0.15;
      // the film magazine (two reels): it reads as a film camera from any side
      const reel = (z) => {
        const r = m(new THREE.CylinderGeometry(0.11, 0.11, 0.05, 16));
        r.rotation.z = Math.PI / 2;
        r.position.set(0, 0.23, z);
        return r;
      };
      rig.add(body, lens, reel(-0.02), reel(-0.24));
      for (const p of [body, lens]) {
        p.userData.camNode = c.node;
        this.pickables.push(p);
      }
      // the frustum of its lens (2 m deep), an arrow on its top edge for up
      const L = 2;
      const tx = Math.tan((F.lv.hFov * Math.PI) / 360) * L;
      const ty = tx / F.lv.frameAspect;
      const P = [
        [0, 0, 0],
        [tx, ty, L],
        [-tx, ty, L],
        [-tx, -ty, L],
        [tx, -ty, L],
      ].map((q) => new THREE.Vector3(...q));
      const segs = [0, 1, 0, 2, 0, 3, 0, 4, 1, 2, 2, 3, 3, 4, 4, 1].map((i) => P[i]);
      segs.push(new THREE.Vector3(tx * 0.4, ty * 1.05, L), new THREE.Vector3(0, ty * 1.4, L), new THREE.Vector3(0, ty * 1.4, L), new THREE.Vector3(-tx * 0.4, ty * 1.05, L));
      const fr = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(segs), new THREE.LineBasicMaterial({ color, transparent: true, opacity: on || live ? 0.95 : 0.55, depthTest: false }));
      rig.add(fr);
      // the thirds (selected, framed off the middle): where what it looks at sits
      if (on && c.params.framing && c.params.framing !== 'centre') {
        const th = [];
        for (const k of [-1 / 3, 1 / 3]) th.push(new THREE.Vector3(tx * k, ty, L), new THREE.Vector3(tx * k, -ty, L), new THREE.Vector3(tx, ty * k, L), new THREE.Vector3(-tx, ty * k, L));
        rig.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(th), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.3, depthTest: false })));
      }
      // the focus plane (selected, depth of field on): a faint frame at the focus distance
      if (on && c.params.dof && F.E.focus < 60) {
        const d = F.E.focus;
        const fx = (tx / L) * d, fy = (ty / L) * d;
        const q = [new THREE.Vector3(fx, fy, d), new THREE.Vector3(-fx, fy, d), new THREE.Vector3(-fx, -fy, d), new THREE.Vector3(fx, -fy, d)];
        rig.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(q), new THREE.LineBasicMaterial({ color: 0x7dff9a, transparent: true, opacity: 0.35, depthTest: false })));
      }
      rig.traverse((o) => (o.renderOrder = 9));
      g.add(rig);
      // its keyframed path and keys (relative to where it stands)
      if (c.params.move === 'keys' && c.keys.length) {
        const o = c.base.origin;
        const world = (p) => new THREE.Vector3(o[0] + p[0], o[1] + p[1], o[2] + p[2]);
        const path = samplePath(c.keys, { spline: c.params.path !== 'linear' }).map(world);
        if (path.length >= 2) line(path, PATH_COLOR, on ? 0.9 : 0.4);
        for (const k of sortKeys(c.keys)) {
          if (!k.pos) continue;
          const d = new THREE.Mesh(new THREE.OctahedronGeometry(on ? 0.14 : 0.09), new THREE.MeshBasicMaterial({ color: PATH_COLOR, depthTest: false, transparent: true }));
          d.position.copy(world(k.pos));
          d.renderOrder = 9;
          g.add(d);
        }
      }
      // the links: what its position follows (green), what it looks at (dashed yellow)
      const followMoves = ['follow', 'track', 'orbit'].includes(c.params.move);
      if (R.follow && followMoves) {
        const fp = targetPoint(R.follow);
        line([F.E.pos, fp], FOLLOW_COLOR, on ? 0.9 : 0.45);
        marker(fp, FOLLOW_COLOR, on ? 0.35 : 0.22);
      }
      if (F.E.lookPoint) {
        line([F.E.pos, F.E.lookPoint], LOOK_COLOR, on ? 0.9 : 0.4, true);
        if (R.lookTarget && R.lookTarget !== R.follow) marker(F.E.lookPoint, LOOK_COLOR, on ? 0.3 : 0.2);
      } else if (on) line([F.E.pos, F.E.target], color, 0.5, true);
      // the aim handle (selected): its aim point, or the point along its own aim
      if (on) {
        const hp = this.handlePoint(c, F, R);
        if (hp) {
          const ball = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12), new THREE.MeshBasicMaterial({ color: LOOK_COLOR, transparent: true, opacity: 0.95, depthTest: false }));
          ball.position.set(...hp);
          ball.renderOrder = 10;
          // (easier to grab than it looks)
          const grab = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, depthTest: false }));
          ball.add(grab);
          g.add(ball);
          this.handle = { mesh: ball, grab, cam: c, point: hp };
        }
      }
    }
    // the cameras' paths (move: path): each path once, the selected camera's with its handles
    this.pathHandles = [];
    const drawnPaths = new Set();
    for (const c of this.cameras()) {
      if (c.params.move !== 'path' || !c.path?.points?.length || drawnPaths.has(c.path)) continue;
      drawnPaths.add(c.path);
      const on = c.node === sel || c.pathNode === sel;
      const carrier = c.path.on ? findTarget(T, c.path.on) : null;
      const poly = pathPolyline(c.path, carrier);
      if (poly.length >= 2) line(poly, PATH_COLOR, on ? 0.95 : 0.45);
      if (!on) continue;
      // its points (drag: along the level they are at), a height cone over each (drag: up and down)
      controlPoints(c.path).forEach((q, i) => {
        const p = carry(carrier, q);
        const pick = this.pathPick === i;
        const ball = new THREE.Mesh(new THREE.SphereGeometry(pick ? 0.22 : 0.16, 12, 8), new THREE.MeshBasicMaterial({ color: pick ? SEL_COLOR : PATH_COLOR, transparent: true, depthTest: false }));
        ball.position.set(...p);
        ball.renderOrder = 10;
        const up = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthTest: false }));
        up.position.set(p[0], p[1] + 0.8, p[2]);
        up.renderOrder = 10;
        g.add(ball, up);
        line([[p[0], p[1] + 0.8, p[2]], p, [p[0], this.ed.ctx.sim?.world?.h ?? 0, p[2]]], 0xffffff, 0.3, true);
        this.pathHandles.push({ kind: 'point', i, mesh: ball, cam: c, carrier, p }, { kind: 'height', i, mesh: up, cam: c, carrier, p });
      });
    }
    g.visible = this.ed.mode === 'edit' && !this.director.active;
  }

  /** Where the selected camera's aim handle is (null: none, e.g. its aim is keyed). */
  handlePoint(c, F, R) {
    const P = c.params;
    if (P.look === 'point' || P.look === 'subject') return R.look ?? F.E.lookPoint ?? null;
    if (P.move === 'keys' || P.move === 'orbit' || P.move === 'follow' || P.move === 'track') return null;
    // its own aim: from where it stands, as far as its handle was put
    const o = c.base.origin;
    const d = c.aimDist > 0.5 ? c.aimDist : 10;
    const ca = Math.cos(c.base.pitch);
    return [o[0] + ca * Math.sin(c.base.yaw) * d, o[1] - Math.sin(c.base.pitch) * d, o[2] + ca * Math.cos(c.base.yaw) * d];
  }

  /** The ray under the pointer, in the world (the root's frame): { origin, dir }. */
  rayAt(e) {
    const v = this.view;
    const r = v.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    v.raycaster.setFromCamera(ndc, v.camera);
    const o = v.root.worldToLocal(v.raycaster.ray.origin.clone());
    const d = v.root.worldToLocal(v.raycaster.ray.origin.clone().add(v.raycaster.ray.direction)).sub(o).normalize();
    return { origin: [o.x, o.y, o.z], dir: [d.x, d.y, d.z] };
  }

  /** A click in the view: a target picked (Aim at… / Follow…), or a camera selected (true: taken). */
  click(e) {
    if (this.ed.mode !== 'edit') return false;
    if (this.picking) return this.pickAt(e), true;
    if (this.pathTool && this.selected()) return this.addPathPoint(e), true;
    if (!this.pickables.length || !this.group.visible) return false;
    const v = this.view;
    this.rayAt(e);
    const hit = v.raycaster.intersectObjects(this.pickables, false)[0];
    if (!hit) return false;
    const i = this.ed.selectNode(hit.object.userData.camNode);
    this.ed.select(i, true);
    return true;
  }

  /* ---------------- the camera's path: drawn and edited in the view ---------------- */
  /** The path the selected camera travels and the node that keeps it (its own, or the camera it shares one with). */
  pathOf(c = this.selected()) {
    if (!c) return null;
    const node = c.pathNode ?? c.node;
    node.path ??= { points: [], closed: false };
    return { node, path: node.path, carrier: node.path.on ? findTarget(this.targets(), node.path.on) : null };
  }
  setPathTool(on = !this.pathTool) {
    this.pathTool = on;
    this.ed.setHint(on ? 'Drawing the camera path: click to add a point (over what you click, at the height set; in the air: at the last point’s height) · drag a point to move it, its white cone to raise or lower it · Del deletes the picked point · Enter / Esc: done' : null);
    for (const b of document.querySelectorAll('#props .cinemaPath [data-tool]')) b.classList.toggle('on', on);
  }
  /** A click while drawing: a point at the end of the path. */
  addPathPoint(e) {
    const c = this.selected();
    const W = this.pathOf(c);
    if (!W) return;
    const pts = W.path.points;
    const lq = pts.length ? pts[pts.length - 1] : null;
    const last = lq ? carry(W.carrier, lq.p ?? lq) : null;
    const hit = this.view.pick(e.clientX, e.clientY);
    let p = hit ? [hit.point[0], hit.point[1] + this.pathHeight, hit.point[2]] : null;
    if (!p) {
      const { origin, dir } = this.rayAt(e);
      const y = last ? last[1] : c.base.origin[1];
      if (Math.abs(dir[1]) < 1e-6) return;
      const k = (y - origin[1]) / dir[1];
      if (k <= 0) return;
      p = origin.map((o, i) => o + dir[i] * k);
    }
    pts.push({ p: uncarry(W.carrier, p).map(r2) });
    c.node.params.move = 'path';
    this.pathPick = pts.length - 1;
    this.ed.commitLight();
    this.ed.buildProps();
    this.draw();
  }
  /** A press on a path handle: drag it (a point along its level, a cone up and down); true: taken. */
  pathDown(e) {
    if (!this.pathHandles?.length) return false;
    this.rayAt(e);
    const hit = this.view.raycaster.intersectObjects(this.pathHandles.map((h) => h.mesh), false)[0];
    const h = hit && this.pathHandles.find((q) => q.mesh === hit.object);
    if (!h) return false;
    e.stopImmediatePropagation();
    e.preventDefault();
    const v = this.view;
    const W = this.pathOf(h.cam);
    if (Array.isArray(W.path.points[h.i])) W.path.points[h.i] = { p: W.path.points[h.i] };
    const pt = W.path.points[h.i];
    const was = v.controls.enabled;
    v.controls.enabled = false;
    this.pathPick = h.i;
    let moved = false;
    const move = (ev) => {
      const { origin, dir } = this.rayAt(ev);
      const p = h.p;
      let q;
      if (h.kind === 'point') {
        // along the level it is at
        if (Math.abs(dir[1]) < 1e-6) return;
        const k = (p[1] - origin[1]) / dir[1];
        if (k <= 0) return;
        q = [origin[0] + dir[0] * k, p[1], origin[2] + dir[2] * k];
      } else {
        // up and down: on the upright plane through it facing the view
        const n = [dir[0], 0, dir[2]];
        const den = n[0] * dir[0] + n[2] * dir[2];
        if (Math.abs(den) < 1e-6) return;
        const k = (n[0] * (p[0] - origin[0]) + n[2] * (p[2] - origin[2])) / den;
        if (k <= 0) return;
        q = [p[0], origin[1] + dir[1] * k - 0.8, p[2]];
      }
      moved = true;
      pt.p = uncarry(W.carrier, q).map(r2);
      this.draw();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      v.controls.enabled = was;
      if (moved) this.ed.commitLight();
      this.ed.buildProps();
      this.draw();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    this.draw();
    return true;
  }
  /** Change the selected camera's path (undo kept), then the properties and the drawing. */
  changePath(fn) {
    const W = this.pathOf();
    if (!W) return;
    W.path.points = W.path.points.map((q) => (Array.isArray(q) ? { p: q } : q));
    fn(W.path, W);
    this.ed.commitLight();
    this.ed.buildProps();
    this.draw();
  }
  removePathPoint() {
    const i = this.pathPick;
    if (i == null) return;
    this.pathPick = null;
    this.changePath((P) => P.points.splice(i, 1));
  }

  /** Move: the path (when its move is path): draw it, its points, closed, attached, shared. */
  pathControls(f, ob) {
    const P = ob.params;
    if (P.move !== 'path') return;
    const c = this.selected();
    const W = this.pathOf(c);
    if (!W) return;
    const others = this.cameras().filter((q) => q.node !== ob).map((q) => q.name);
    const shared = el('select', { title: 'Travel another camera’s path (several cameras, one path: spaced out by “start this far along” or “start later”)' }, el('option', { value: '', selected: !ob.pathFrom }, 'Its own'), ...others.map((n) => el('option', { value: n, selected: n === ob.pathFrom }, `${n}’s`)));
    shared.addEventListener('change', () => {
      if (shared.value) ob.pathFrom = shared.value;
      else delete ob.pathFrom;
      this.ed.commitLight();
      this.ed.buildProps();
      this.draw();
    });
    const T = this.targets();
    const on = el('select', { title: 'Attached to a moving thing (a ship, a helicopter…): the path moves and turns with it' }, el('option', { value: '', selected: !W.path.on }, 'The world (fixed)'), ...this.targetOptions(W.path.on ?? ''));
    on.addEventListener('change', () =>
      this.changePath((path) => {
        // the points stay where they are in the world, now in its frame
        const from = path.on ? findTarget(T, path.on) : null;
        const to = on.value ? findTarget(T, on.value) : null;
        path.points = path.points.map((q) => ({ ...q, p: uncarry(to, carry(from, q.p)).map(r2) }));
        if (on.value) path.on = on.value;
        else delete path.on;
      }),
    );
    const closed = el('input', { type: 'checkbox', checked: !!W.path.closed });
    closed.addEventListener('change', () => this.changePath((path) => (path.closed = closed.checked)));
    const hgt = el('input', { type: 'number', step: 0.5, value: this.pathHeight, title: 'New points: this high over what you click (m)', style: 'width:44px' });
    hgt.addEventListener('change', () => (this.pathHeight = +hgt.value || 0));
    const list = el('div', { class: 'list' });
    const perPoint = P.pathTiming === 'per point';
    W.path.points.forEach((q, i) => {
      const p = q.p ?? q;
      const num = (val, step, fn, title, w = 44) => {
        const inp = el('input', { type: 'number', step, value: val ?? '', title, style: `width:${w}px` });
        inp.addEventListener('change', () => this.changePath((path) => fn(path.points[i], inp.value === '' ? undefined : +inp.value)));
        return inp;
      };
      const setP = (k) => (pt, v) => (pt.p[k] = v ?? 0);
      const ease = el('select', { title: 'Easing to the next point (per point timing)' }, ...EASE_NAMES.map((n) => el('option', { value: n, selected: (q.ease ?? 'linear') === n }, n)));
      ease.addEventListener('change', () => this.changePath((path) => (path.points[i].ease = ease.value)));
      list.append(
        el(
          'div',
          { class: `row${this.pathPick === i ? ' on' : ''}` },
          el('button', { class: 'name', title: 'Pick it (Del deletes it)', onclick: () => ((this.pathPick = i), this.draw(), this.ed.buildProps()) }, el('span', { class: 'n' }, String(i + 1))),
          num(p[0], 0.1, setP(0), 'x (m)'),
          num(p[1], 0.1, setP(1), 'height y (m)'),
          num(p[2], 0.1, setP(2), 'z (m)'),
          perPoint ? num(q.t, 0.1, (pt, v) => (v === undefined ? delete pt.t : (pt.t = Math.max(0, v))), 'When the camera is here (s; empty: from the speed)', 40) : null,
          perPoint ? ease : null,
          el('button', { class: 'x', title: 'Delete this point', onclick: () => ((this.pathPick = i), this.removePathPoint()) }, '✕'),
        ),
      );
    });
    if (!W.path.points.length) list.append(el('p', { class: 'muted' }, '✎ Draw path, then click in the view: each click a point.'));
    const len = measured(W.path).length;
    f.$children.append(
      el(
        'div',
        { class: 'terrainAreas cinemaAim cinemaPath cinemaKeys' },
        el('label', { class: 'row' }, el('span', {}, 'Path'), shared),
        el('label', { class: 'row' }, el('span', {}, 'On'), on),
        el('div', { class: 'add' }, el('button', { 'data-tool': 'path', class: this.pathTool ? 'on' : '', onclick: () => this.setPathTool() }, '✎ Draw path'), el('label', {}, closed, ' Closed loop'), el('label', { class: 'muted' }, 'new points ', hgt, ' m up')),
        el('p', { class: 'muted' }, `${W.path.points.length} points · ${len.toFixed(1)} m · ${c ? `${pathDuration(W.path, c.params).toFixed(1)} s a run` : ''}${ob.pathFrom ? ` · ${ob.pathFrom}’s path (edits change it for both)` : ''}`),
        list,
      ),
    );
  }

  /* ---------------- the aim handle ---------------- */
  handleDown(e) {
    if (e.button !== 0 || this.ed.mode !== 'edit' || !this.group.visible || this.picking || this.director.active) return;
    if (this.pathDown(e)) return;
    if (!this.handle) return;
    this.rayAt(e);
    const hit = this.view.raycaster.intersectObjects([this.handle.mesh, this.handle.grab], false)[0];
    if (!hit) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    const v = this.view;
    this.drag = { cam: this.handle.cam, plane: this.handle.point.slice(), controls: v.controls.enabled };
    v.controls.enabled = false;
    const move = (ev) => this.dragAim(ev);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      v.controls.enabled = this.drag.controls;
      this.endAim();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /** The point under the pointer: on what the view shows there, else on a plane through the handle facing the view. */
  pointUnder(e, through) {
    const v = this.view;
    const hit = v.pick(e.clientX, e.clientY);
    if (hit) return hit.point.slice();
    const { origin, dir } = this.rayAt(e);
    const cam = v.root.worldToLocal(v.camera.getWorldDirection(new THREE.Vector3()).add(v.camera.position)).sub(v.root.worldToLocal(v.camera.position.clone()));
    const n = [cam.x, cam.y, cam.z];
    const den = n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2];
    if (Math.abs(den) < 1e-6) return null;
    const k = (n[0] * (through[0] - origin[0]) + n[1] * (through[1] - origin[1]) + n[2] * (through[2] - origin[2])) / den;
    if (k <= 0) return null;
    return origin.map((o, i) => o + dir[i] * k);
  }

  dragAim(e) {
    const D = this.drag;
    if (!D) return;
    const p = this.pointUnder(e, D.plane);
    if (!p) return;
    this.aimCameraAt(D.cam, p, D);
  }

  /** Turn a camera to a point: its pan / tilt (its own aim), else its aim point. */
  aimCameraAt(c, p, D = {}) {
    const n = c.node;
    n.params ??= {};
    if ((n.params.look ?? 'forward') === 'forward') {
      const a = aimAt(c.base.origin, p);
      n.aimDist = r2(Math.max(1, a.dist));
      if (this.ed.entries().find((e) => e.node === n)?.parent >= 0) D.world = { rotation: a.rotation, tiltX: a.tiltX };
      else this.setPose(n, a.rotation, a.tiltX);
    } else {
      // (dragged off what it looked at: it looks at the point)
      n.params.look = 'point';
      n.aimPoint = p.map(r3);
    }
    this.draw();
    this.syncAimCtl?.();
  }

  /** A camera's pan and tilt set (a camera of the scene itself: the world's record too, no rebuild). */
  setPose(n, rotation, tiltX) {
    n.rotation = r2(((rotation % 360) + 360) % 360) % 360;
    if (tiltX) n.tiltX = r2(tiltX);
    else delete n.tiltX;
    const i = this.ed.entries().findIndex((e) => e.node === n);
    const rec = this.ed.ctx.sim?.world?.objectTree?.[i]?.rec;
    if (rec && rec !== n) {
      rec.rotation = n.rotation;
      rec.tiltX = n.tiltX;
    }
  }

  endAim() {
    const D = this.drag;
    this.drag = null;
    if (!D) return;
    const ed = this.ed;
    if (D.world) {
      // a camera in another object: its turn in its parent's frame, the world rebuilt
      const i = ed.entries().findIndex((e) => e.node === D.cam.node);
      const e = ed.entries()[i];
      const w = ed.ctx.sim.world;
      const rec = w.objectTree?.[i]?.rec ?? e.node;
      const l = toLocal(ed.parentPose(e), { x: rec.x, z: rec.z, oy: w.origins?.[i]?.[1] ?? 0, rotation: D.world.rotation, tiltX: D.world.tiltX, tiltZ: rec.tiltZ });
      Object.assign(e.node, { rotation: l.rotation, tiltX: l.tiltX });
      if (!e.node.tiltX) delete e.node.tiltX;
      ed.commit();
      return;
    }
    ed.commitLight();
    if (ed.node() === D.cam.node) ed.placeGizmo();
  }

  /* ---------------- Aim at… / Follow…: a click in the view ---------------- */
  startPicking(what) {
    this.picking = what;
    this.view.renderer.domElement.style.cursor = 'crosshair';
    this.ed.setHint(what === 'look' ? 'Click what the camera should look at: a character, a vehicle, an object, a spot (Esc: cancel)' : 'Click what the camera should follow: a character, a vehicle (or an object to orbit) (Esc: cancel)');
    this.updatePickButtons();
  }
  stopPicking() {
    if (!this.picking) return;
    this.picking = null;
    this.view.renderer.domElement.style.cursor = '';
    this.ed.setHint(null);
    this.updatePickButtons();
  }
  updatePickButtons() {
    for (const b of document.querySelectorAll('#props .cinemaAim [data-pick]')) b.classList.toggle('on', b.dataset.pick === this.picking);
  }

  /** An object of the scene as a target: named (once), its target. */
  nameObject(i) {
    const ed = this.ed;
    const entries = ed.entries();
    const e = entries[i];
    if (!e) return null;
    if (!e.node.ref) {
      const names = flattenObjects(ed.ctx.scene.objects ?? []).map((q) => q.node.ref).filter(Boolean);
      e.node.ref = objectName(MODELS[e.node.type]?.label ?? e.node.type, names);
    }
    const w = ed.ctx.sim?.world;
    return objectTargets(entries, w?.origins, (w?.objectTree ?? []).map((q) => q?.rec)).find((t) => t.index === i) ?? null;
  }

  pickAt(e) {
    const c = this.selected();
    const what = this.picking;
    this.stopPicking();
    if (!c) return;
    const ed = this.ed;
    const v = this.view;
    const w = ed.ctx.sim?.world;
    const hit = v.pick(e.clientX, e.clientY);
    let owner = hit && hit.voxel >= 0 ? w.owner[hit.voxel] : -1;
    const entries = ed.entries();
    // (the ground, a terrain, the camera itself: a spot, not an object)
    if (owner >= 0 && (!entries[owner] || entries[owner].node.type === 'terrain' || entries[owner].node === c.node)) owner = -1;
    const r = pickTarget(this.rayAt(e), hit ? { point: hit.point, owner } : null, subjectsOf(w));
    if (!r) return;
    const n = c.node;
    const P = n.params;
    let say;
    if (what === 'look') {
      if (r.subject) {
        n.lookAt = r.subject.id;
        delete n.lookOffset;
        P.look = 'subject';
        say = `Looks at ${r.subject.label}`;
      } else if (r.owner >= 0) {
        const T = this.nameObject(r.owner);
        n.lookAt = T.id;
        n.lookOffset = offsetFrom(T, r.point);
        P.look = 'subject';
        say = `Looks at ${T.label}`;
      } else {
        P.look = 'point';
        n.aimPoint = r.point.map(r3);
        say = 'Looks at that spot (drag the yellow ball to move it)';
      }
    } else {
      let T = r.subject;
      if (!T && r.owner >= 0) T = this.nameObject(r.owner);
      if (!T) {
        ed.setHint('Nothing to follow there: click a character, a vehicle or an object.');
        return;
      }
      n.follow = T.id;
      if (!['follow', 'track', 'orbit'].includes(P.move)) P.move = T.kind === 'object' ? 'orbit' : 'follow';
      say = `Follows ${T.label} (${P.move})`;
    }
    ed.commitLight();
    ed.buildProps();
    this.draw();
    ed.setHint(say);
  }

  /* ---------------- the properties ---------------- */
  /** The camera's parameters in folders (Aim, Move, Lens, Focus & exposure, Effects), and its keyframes. */
  folder(gui, ob) {
    const ed = this.ed;
    const M = MODELS.camera;
    ob.params ??= {};
    for (const [k, s] of Object.entries(M.params)) ob.params[k] ??= s.value;
    ob.keys ??= [];
    const light = () => ed.commitLight();
    let old = ob.params.name;
    gui
      .add(ob.params, 'name')
      .name(M.params.name.label)
      .onFinishChange((v) => {
        // (the clips of this camera keep it)
        renameCamera(this.movie(), old, v);
        old = v;
        light();
        ed.refresh();
        if (!this.panel.hidden) this.renderMovie();
      });
    const folders = {};
    for (const grp of M.paramGroups) folders[grp] = gui.addFolder(grp);
    folders['Focus & exposure'].close();
    folders.Effects.close();
    folders.Lens.close();
    this.aimControls(folders.Aim, ob);
    this.followControls(folders.Move, ob);
    this.pathControls(folders.Move, ob);
    const ctl = {};
    for (const [key, spec] of Object.entries(M.params)) {
      if (!spec.group || key === 'look') continue; // (what it looks at: the list above)
      const f = folders[spec.group];
      let c;
      if (spec.options) c = f.add(ob.params, key, spec.options);
      else if (typeof spec.value === 'boolean') c = f.add(ob.params, key);
      else c = f.add(ob.params, key, spec.min, spec.max, spec.step);
      c.name(spec.label ?? key).onFinishChange(() => {
        // a lens preset sets the focal length (and its own distortion, frame, bokeh)
        if (key === 'lens') {
          const L = LENSES[ob.params.lens];
          if (L?.focal) ob.params.focal = L.focal;
          ctl.focal?.updateDisplay();
        }
        light();
        if (key === 'move' || key === 'keyEffects' || key === 'framing') ed.buildProps();
      });
      if (['roll', 'frameX', 'frameY', 'side', 'radius', 'height'].includes(key)) c.onChange(() => this.draw());
      if ((key === 'frameX' || key === 'frameY') && ob.params.framing !== 'custom') c.hide();
      ctl[key] = c;
    }
    this.keysFolder(gui, ob);
  }

  /** The target list: the subjects of the world and the named objects, as <option>s (and one not here). */
  targetOptions(current) {
    const T = this.targets();
    const subj = T.filter((t) => t.kind !== 'object');
    const objs = T.filter((t) => t.kind === 'object');
    const out = [];
    if (subj.length) out.push(el('optgroup', { label: 'Characters and vehicles' }, ...subj.map((s) => el('option', { value: s.id, selected: s.id === current }, s.label))));
    if (objs.length) out.push(el('optgroup', { label: 'Objects' }, ...objs.map((s) => el('option', { value: s.id, selected: s.id === current }, s.label))));
    if (current && !T.some((t) => t.id === current)) out.push(el('option', { value: current, selected: true }, `${current.replace(/^obj:/, '')} (not here)`));
    return out;
  }

  /** Aim: pan, tilt (live), what it looks at (the list, 🎯 Aim at…). */
  aimControls(f, ob) {
    const ed = this.ed;
    const child = () => (ed.cur()?.parent ?? -1) >= 0;
    const proxy = {
      get pan() {
        return ob.rotation ?? 0;
      },
      set pan(v) {
        ob.rotation = v;
      },
      get tilt() {
        return -(ob.tiltX ?? 0);
      },
      set tilt(v) {
        ob.tiltX = -v;
      },
    };
    const live = () => {
      if (!child()) this.setPose(ob, ob.rotation ?? 0, ob.tiltX ?? 0);
      this.draw();
    };
    const done = () => (child() ? ed.commit() : (ed.commitLight(), ed.placeGizmo()));
    const pan = f.add(proxy, 'pan', 0, 360, 0.5).name(child() ? 'Pan (° in its parent)' : 'Pan (°; 0: +z, 90: +x)').onChange(live).onFinishChange(done);
    const tilt = f.add(proxy, 'tilt', -90, 90, 0.5).name('Tilt (° up +)').onChange(live).onFinishChange(done);
    this.syncAimCtl = () => {
      pan.updateDisplay();
      tilt.updateDisplay();
    };
    const P = ob.params;
    const value = P.look === 'point' ? 'point' : P.look === 'subject' ? ob.lookAt || 'follow' : 'forward';
    const sel = el(
      'select',
      { title: 'What it looks at' },
      el('option', { value: 'forward', selected: value === 'forward' }, 'Its own direction (pan / tilt)'),
      el('option', { value: 'point', selected: value === 'point' }, 'Its aim point (the yellow ball)'),
      el('option', { value: 'follow', selected: value === 'follow' }, 'What it follows'),
      ...this.targetOptions(value === 'forward' || value === 'point' || value === 'follow' ? '' : value),
    );
    sel.addEventListener('change', () => {
      const v = sel.value;
      const c = this.selected();
      if (v === 'forward') P.look = 'forward';
      else if (v === 'point') {
        P.look = 'point';
        // (where it looks now)
        if (c) {
          const R = resolveTargets(c, this.targets());
          ob.aimPoint = cameraFrame(c, this.t, { subject: R.follow, look: R.look, carrier: R.carrier }).E.target.map(r3);
        }
      } else if (v === 'follow') {
        P.look = 'subject';
        delete ob.lookAt;
        delete ob.lookOffset;
      } else {
        P.look = 'subject';
        ob.lookAt = v;
        delete ob.lookOffset;
      }
      ed.commitLight();
      ed.buildProps();
    });
    const box = el(
      'div',
      { class: 'terrainAreas cinemaAim' },
      el('label', { class: 'row' }, el('span', {}, 'Looks at'), sel),
      el(
        'div',
        { class: 'add' },
        el('button', { 'data-pick': 'look', title: 'Then click in the view what it should look at: a character, a vehicle, an object (that spot of it), the ground', onclick: () => (this.picking === 'look' ? this.stopPicking() : this.startPicking('look')) }, '🎯 Aim at…'),
        el('button', { title: 'Its pan and tilt from where it looks now (its aim point or target), then its own direction', onclick: () => this.bakeAim() }, '⤓ Keep this direction'),
      ),
      el('p', { class: 'muted' }, 'Drag the yellow ball in the view to aim it; the frustum follows.'),
    );
    f.$children.append(box);
  }

  /** Its own pan / tilt set to where it looks now; then it looks along them. */
  bakeAim() {
    const c = this.selected();
    if (!c) return;
    const R = resolveTargets(c, this.targets());
    const F = cameraFrame(c, this.t, { subject: R.follow, look: R.look, carrier: R.carrier });
    const n = c.node;
    n.params.look = 'forward';
    this.aimCameraAt(c, F.E.target, (this.drag = { cam: c }));
    this.endAim();
    this.ed.buildProps();
  }

  /** Move: what its position follows (the list, 🎯 Pick…). */
  followControls(f, ob) {
    const ed = this.ed;
    const P = ob.params;
    const cur = ob.follow || '';
    const sel = el('select', { title: 'What its position follows (follow, track, orbit)' }, el('option', { value: '', selected: !cur }, P.subject && P.subject !== 'none' ? `By kind: ${P.subject} ${P.subjectIndex ?? 1}` : 'Nothing'), ...this.targetOptions(cur));
    sel.addEventListener('change', () => {
      if (sel.value) {
        ob.follow = sel.value;
        if (!['follow', 'track', 'orbit'].includes(P.move)) P.move = sel.value.startsWith('obj:') ? 'orbit' : 'follow';
      } else delete ob.follow;
      ed.commitLight();
      ed.buildProps();
    });
    f.$children.append(
      el(
        'div',
        { class: 'terrainAreas cinemaAim' },
        el('label', { class: 'row' }, el('span', {}, 'Follows'), sel),
        el('div', { class: 'add' }, el('button', { 'data-pick': 'follow', title: 'Then click in the view what its position should follow: a character, a vehicle (an object: orbit it)', onclick: () => (this.picking === 'follow' ? this.stopPicking() : this.startPicking('follow')) }, '🎯 Pick…')),
        el('p', { class: 'muted' }, 'Follow: behind it (distance, height, sideways); track: beside it; orbit: round it. What it looks at is set under Aim (e.g. stand still and look at the helicopter, or follow the car and look at the dragon).'),
      ),
    );
  }

  keysFolder(gui, ob) {
    const f = gui.addFolder(`Keyframes (${ob.keys.length})`);
    const box = el('div', { class: 'terrainAreas cinemaKeys' });
    const P = ob.params;
    const cam = this.selected();
    const span = Math.max(10, keysDuration(ob.keys) + 2, cam ? moveDuration(cam) : 0);
    this.t = Math.min(this.t, span);
    const tb = (label, title, fn, cls) => el('button', { title, class: cls ?? '', onclick: fn }, label);
    // the timeline: a scrub bar with the keys on it
    const range = el('input', { type: 'range', min: 0, max: span, step: 0.05, value: this.t, class: 'scrub' });
    range.addEventListener('input', () => this.scrub(+range.value));
    const marks = el('div', { class: 'marks' });
    for (const k of sortKeys(ob.keys)) marks.append(el('span', { class: 'mark', style: `left:${(k.t / span) * 100}%`, title: `${k.t} s` }));
    this.timeLabel = el('span', { class: 'time' }, `${this.t.toFixed(2)} s`);
    this.range = range;
    box.append(el('div', { class: 'timeline' }, el('div', { class: 'track' }, marks, range), this.timeLabel));
    this.lookBtn = tb('👁 Look through', 'See through this camera at the scrubbed time, with its lens and effects (Esc: back)', () => this.toggleLook());
    this.previewBtn = tb('▶ Preview', 'Play its move (the world stands still; Esc: stop)', () => this.togglePreview());
    box.append(
      el(
        'div',
        { class: 'add' },
        tb('◆ Set key here', 'A key at the scrubbed time: the view as it is now (where you look from and at) and the lens values (focal length, focus, aperture, roll)', () => this.setKeyHere()),
        tb('📷 Camera from view', 'Put the camera where the view is, looking where it looks', () => this.cameraFromView()),
        tb('⇢ View from camera', 'Put the editor’s view where the camera is at the scrubbed time', () => this.viewFromCamera()),
      ),
      el('div', { class: 'add' }, this.lookBtn, this.previewBtn, tb('🎬 + Clip', 'Put this camera on the movie’s timeline, after the last clip', () => this.addShot(P.name))),
    );
    const list = el('div', { class: 'list' });
    sortKeys(ob.keys).forEach((k, i) => {
      const tIn = el('input', { type: 'number', step: 0.1, min: 0, value: k.t, title: 'Time (s)' });
      tIn.addEventListener('change', () => this.editKey(k, (q) => (q.t = Math.max(0, r2(+tIn.value || 0)))));
      const ease = el('select', { title: 'Easing to the next key' }, ...EASE_NAMES.map((n) => el('option', { value: n, selected: (k.ease ?? 'easeInOut') === n }, n)));
      ease.addEventListener('change', () => this.editKey(k, (q) => (q.ease = ease.value)));
      list.append(
        el(
          'div',
          { class: `row${Math.abs(k.t - this.t) < 0.03 ? ' on' : ''}` },
          el('button', { class: 'name', title: 'Go to this key (the scrub and the view)', onclick: () => (this.scrub(k.t), this.viewFromCamera()) }, el('span', { class: 'n' }, String(i + 1)), `${k.focal ?? P.focal} mm`, k.fx ? el('span', { class: 'tag' }, 'fx') : null),
          tIn,
          ease,
          el('button', { class: 'x', title: 'Delete this key', onclick: () => this.editKeys((K) => K.filter((q) => q !== k)) }, '✕'),
        ),
      );
    });
    if (!ob.keys.length) list.append(el('p', { class: 'muted' }, P.move === 'keys' ? 'No keys yet: frame the view, scrub to a time, ◆ Set key here.' : `Move: ${P.move}. Keys make it a keyframed move.`));
    box.append(list);
    f.$children.append(box);
    this.updateButtons();
  }

  showTime(t) {
    if (this.range) this.range.value = t;
    if (this.timeLabel) this.timeLabel.textContent = `${t.toFixed(2)} s`;
  }
  scrub(t) {
    this.t = t;
    this.showTime(t);
    if (this.director.active && this.director.kind === 'look') this.director.setTime(t);
    this.draw();
  }
  updateButtons() {
    const d = this.director;
    if (this.lookBtn) this.lookBtn.classList.toggle('on', d.active && d.kind === 'look');
    if (this.previewBtn) {
      this.previewBtn.classList.toggle('on', d.active && d.kind === 'preview');
      this.previewBtn.textContent = d.active && d.kind === 'preview' ? '■ Stop' : '▶ Preview';
    }
    const seqOn = d.active && d.kind === 'sequence';
    if (this.seqLookBtn) this.seqLookBtn.classList.toggle('on', seqOn && !d.playing);
    if (this.seqPlayBtn) {
      this.seqPlayBtn.classList.toggle('on', seqOn && d.playing);
      this.seqPlayBtn.textContent = seqOn && d.playing ? '■ Stop' : '▶ Preview';
    }
  }
  toggleLook() {
    const c = this.selected();
    if (!c) return;
    if (this.director.active && this.director.kind === 'look') this.director.stop();
    else this.director.look(c.name, this.t);
    this.updateButtons();
    this.draw();
  }
  togglePreview() {
    const c = this.selected();
    if (!c) return;
    if (this.director.active && this.director.kind === 'preview') this.director.stop();
    else this.director.preview(c.name, 0);
    this.updateButtons();
    this.draw();
  }

  /** Edit the selected camera's keys (undo first; no rebuild). */
  editKeys(fn) {
    const ob = this.ed.node();
    if (!ob) return;
    this.ed.snapshot();
    ob.keys = sortKeys(fn(ob.keys ?? []));
    this.ed.buildProps();
    this.draw();
  }
  editKey(k, fn) {
    this.editKeys((K) => K.map((q) => (q === k ? (fn(q), q) : q)));
  }

  /** The view's camera and what it looks at, in the world (the root's frame). */
  viewPose() {
    const v = this.view;
    if (this.director.active) this.director.stop();
    const p = v.root.worldToLocal(v.camera.position.clone());
    const t = v.root.worldToLocal(v.controls.target.clone());
    return { p: [p.x, p.y, p.z], t: [t.x, t.y, t.z] };
  }

  setKeyHere() {
    const c = this.selected();
    if (!c) return;
    const ob = c.node;
    const { p, t } = this.viewPose();
    const o = c.base.origin;
    const P = c.params;
    const key = { t: r2(this.t), pos: p.map((v, i) => r3(v - o[i])), target: t.map((v, i) => r3(v - o[i])), focal: P.focal, focus: P.focus, fstop: P.fstop, roll: P.roll, ease: 'easeInOut' };
    if (P.keyEffects) key.fx = Object.fromEntries(FX_KEYS.map((k) => [k, P[k]]));
    this.ed.snapshot();
    ob.keys = setKey(ob.keys, key);
    ob.params.move = 'keys';
    // the next key a little later
    this.t = r2(this.t + 2);
    this.ed.buildProps();
    this.draw();
  }

  cameraFromView() {
    const ed = this.ed, C = ed.ctx;
    const e = ed.cur();
    const ob = e?.node;
    if (ob?.type !== 'camera') return;
    const { p, t } = this.viewPose();
    const d = [t[0] - p[0], t[1] - p[1], t[2] - p[2]];
    const L = Math.hypot(...d) || 1;
    const h = C.sim.world.h;
    let fields = { x: r2(p[0]), z: r2(p[2]), y: r2(p[1] - h), rotation: Math.round(((Math.atan2(d[0], d[2]) * 180) / Math.PI + 360) % 360), tiltX: Math.round((Math.asin(-d[1] / L) * 180) / Math.PI) };
    const pp = ed.parentPose(e);
    if (pp) {
      const l = toLocal(pp, { x: fields.x, z: fields.z, oy: p[1], rotation: fields.rotation, tiltX: fields.tiltX, tiltZ: ob.tiltZ });
      fields = { x: l.x, z: l.z, y: l.y, rotation: l.rotation, tiltX: l.tiltX };
    }
    ed.snapshot();
    Object.assign(ob, fields);
    if (!ob.tiltX) delete ob.tiltX;
    ob.aimDist = r2(Math.max(1, L));
    ed.rebuild();
  }

  viewFromCamera() {
    const c = this.selected();
    if (!c) return;
    if (this.director.active) this.director.stop();
    const v = this.view;
    const R = resolveTargets(c, this.targets());
    const F = cameraFrame(c, this.t, { subject: R.follow, look: R.look, carrier: R.carrier, canvasAspect: v.camera.aspect, motion: false });
    v.camera.position.copy(v.root.localToWorld(new THREE.Vector3(...F.E.pos)));
    v.controls.target.copy(v.root.localToWorld(new THREE.Vector3(...F.E.target)));
    v.controls.update();
  }

  /* ---------------- the movie: its timeline ---------------- */
  toggleMovie(show = this.panel.hidden) {
    this.panel.hidden = !show;
    this.btn.classList.toggle('on', show);
    if (show) this.renderMovie();
    else {
      this.onAir = null;
      if (this.director.active && this.director.kind === 'sequence') this.director.stop();
      this.draw();
    }
  }

  /** A clip of a camera after the last clip of the sequence shown. */
  addShot(name) {
    const cams = this.cameras();
    if (!cams.length) {
      alert('There is no camera here yet: Edit world › + Add › Cinema › Film camera.');
      return;
    }
    const S = this.seq();
    const used = new Set(S.clips.map((s) => s.camera));
    const cam = cams.find((c) => c.name === name) ?? cams.find((c) => !used.has(c.name)) ?? cams[0];
    this.ed.snapshot();
    this.selClip = addClip(S, cam.name, sequenceDuration(S), moveDuration(cam) || 4, { snap: false });
    this.toggleMovie(true);
  }

  /** Change the movie (undo first), then show it again. */
  changeMovie(fn) {
    this.ed.snapshot();
    fn(this.movie(), this.seq());
    this.renderMovie();
  }

  /** A time on the track from a pointer's x (s). */
  timeAtX(clientX) {
    const r = this.lane.getBoundingClientRect();
    return Math.max(0, (clientX - r.left) / this.zoom);
  }
  grid() {
    return this.zoom >= 80 ? 0.1 : this.zoom >= 25 ? 0.5 : 1;
  }
  snapOpts(e) {
    return { snap: this.snap && !e?.shiftKey, threshold: 8 / this.zoom, grid: this.grid(), playhead: this.playhead };
  }

  renderMovie() {
    const p = this.panel;
    if (p.hidden) return;
    const ed = this.ed;
    const M = this.movie();
    const S = this.seq();
    if (this.selClip && !S.clips.includes(this.selClip)) this.selClip = null;
    const cams = this.cameras();
    const names = cams.map((c) => c.name);
    const place = ed.ctx.place();
    const dur = sequenceDuration(S);
    // the header: the sequences
    const seqSel = el('select', { title: 'The sequence shown (each place can have several)' }, ...M.sequences.map((s, i) => el('option', { value: i, selected: s === S }, `${s.name}${i === (M.active ?? 0) ? ' ★' : ''}`)));
    seqSel.addEventListener('change', () => {
      this.seqIndex = +seqSel.value;
      this.selClip = null;
      this.renderMovie();
    });
    const hb = (label, title, fn) => el('button', { title, onclick: fn }, label);
    p.replaceChildren(
      el(
        'h3',
        {},
        `🎬 ${place.label ?? place.name ?? ed.ctx.scene.name ?? 'Movie'}`,
        seqSel,
        hb('✎', 'Rename this sequence', () => {
          const n = prompt('Name of this sequence:', S.name);
          if (n != null) this.changeMovie((m) => renameSequence(m, this.seqIndex, n));
        }),
        hb('＋', 'A new, empty sequence', () => this.changeMovie((m) => (this.seqIndex = addSequence(m, 'Sequence')))),
        hb('⧉', 'Duplicate this sequence', () => this.changeMovie((m, s) => (this.seqIndex = addSequence(m, s.name, s)))),
        hb('🗑', 'Delete this sequence', () => confirm(`Delete the sequence “${S.name}”?`) && this.changeMovie((m) => (removeSequence(m, this.seqIndex), (this.seqIndex = m.active)))),
        el('label', { class: 'muted', title: 'The sequence ▶ Play movie plays (also from Play)' }, el('input', { type: 'radio', checked: (M.active ?? 0) === this.seqIndex, onchange: () => this.changeMovie((m) => (m.active = this.seqIndex)) }), ' plays'),
        el('span', { class: 'muted' }, ` · ${S.clips.length} clip${S.clips.length === 1 ? '' : 's'}, ${dur.toFixed(1)} s`),
        el('button', { class: 'x', title: 'Close', onclick: () => this.toggleMovie(false) }, '✕'),
      ),
    );
    // the cameras: drag one onto the track (double click: at the playhead)
    const chips = el('div', { class: 'chips' }, el('span', { class: 'muted' }, 'Cameras:'));
    for (const c of cams) {
      const chip = el('span', { class: 'chip', draggable: 'true', title: `Drag onto the timeline (double click: at the playhead). Its move: ${c.params.move}${moveDuration(c) ? `, ${moveDuration(c).toFixed(1)} s` : ''}` }, c.name);
      chip.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/x-camera', c.name);
        e.dataTransfer.setData('text/plain', c.name);
        e.dataTransfer.effectAllowed = 'copy';
      });
      chip.addEventListener('dblclick', () => this.dropCamera(c.name, this.playhead, null));
      chips.append(chip);
    }
    if (!cams.length) chips.append(el('span', { class: 'muted' }, ' none here yet: Edit world › + Add › Cinema › Film camera.'));
    const zoom = el('input', { type: 'range', min: 8, max: 160, step: 1, value: this.zoom, title: 'Zoom (px a second)' });
    zoom.addEventListener('input', () => {
      this.zoom = +zoom.value;
      this.renderTrack();
    });
    const snap = el('input', { type: 'checkbox', checked: this.snap });
    snap.addEventListener('change', () => (this.snap = snap.checked));
    const list = el('button', { class: this.listView ? 'on' : '', title: 'Every clip with its exact times' }, '☰ List');
    list.addEventListener('click', () => ((this.listView = !this.listView), this.renderMovie()));
    p.append(el('div', { class: 'toolbar' }, chips, el('label', { class: 'muted' }, '🔍', zoom), el('label', { class: 'muted', title: 'Snap to clip edges, the playhead and the grid (Shift while dragging: no snapping)' }, snap, ' Snap'), list));
    // the timeline
    this.tl = el('div', { class: 'tl' });
    p.append(this.tl);
    this.renderTrack();
    // the playhead: its time, the camera on, preview
    this.phMovie = el('input', { type: 'number', step: 0.05, min: 0, title: 'Playhead (s of movie)' });
    this.phMovie.addEventListener('change', () => this.setPlayhead(Math.max(0, +this.phMovie.value || 0)));
    this.phSim = el('input', { type: 'number', step: 0.05, min: 0, title: 'Playhead (s of simulation)' });
    this.phSim.addEventListener('change', () => this.setPlayhead(fromSim(S, Math.max(0, +this.phSim.value || 0))));
    this.phInfo = el('span', { class: 'muted' });
    this.seqLookBtn = el('button', { title: 'See through the camera on at the playhead, at that moment of its move (scrub: it follows; Esc: back)', onclick: () => this.toggleSeqLook() }, '👁 Look');
    this.seqPlayBtn = el('button', { title: 'Play the sequence from the playhead, cutting between the cameras (the world stands still; Esc: stop)', onclick: () => this.toggleSeqPlay() }, '▶ Preview');
    p.append(
      el(
        'div',
        { class: 'phrow' },
        el('label', {}, '⏱ ', this.phMovie, ' s'),
        el('label', { class: 'muted' }, 'sim ', this.phSim, ' s'),
        hb('⏮', 'To the start', () => this.setPlayhead(0)),
        this.seqLookBtn,
        this.seqPlayBtn,
        hb('✂', 'Cut the clip at the playhead in two', () => {
          const c = S.clips.find((q) => q.start < this.playhead && clipEnd(q) > this.playhead);
          if (c) this.changeMovie((m, s) => (this.selClip = splitClip(s, c, this.playhead) ?? c));
        }),
        this.phInfo,
      ),
    );
    // the selected clip, or every clip (the list)
    const rows = this.listView ? S.clips : this.selClip ? [this.selClip] : [];
    const table = el('div', { class: 'shots' });
    if (rows.length) table.append(el('div', { class: 'shot head' }, el('span', {}, '#'), el('span', {}, 'Camera'), el('span', {}, 'Start (s)'), el('span', {}, 'Start (sim s)'), el('span', {}, 'Length (s)'), el('span', {}, 'From (s)'), el('span', {}, 'Comes in'), el('span', {}, 'Over (s)'), el('span', {})));
    for (const c of rows) {
      const i = S.clips.indexOf(c);
      const num = (val, step, fn, title) => {
        const inp = el('input', { type: 'number', step, min: 0, value: r3(val), title });
        inp.addEventListener('change', () => this.changeMovie((m, s) => fn(s, Math.max(0, +inp.value || 0))));
        return inp;
      };
      const camSel = el('select', {}, ...[...new Set([...names, c.camera])].map((n) => el('option', { value: n, selected: n === c.camera }, names.includes(n) ? n : `${n} (missing)`)));
      camSel.addEventListener('change', () => this.changeMovie(() => (c.camera = camSel.value)));
      const tr = el('select', {}, ...TRANSITIONS.map((n) => el('option', { value: n, selected: (c.transition ?? 'cut') === n }, n)));
      tr.addEventListener('change', () => this.changeMovie(() => (c.transition = tr.value)));
      table.append(
        el(
          'div',
          { class: `shot${c === this.selClip ? ' on' : ''}` },
          el('button', { class: 'n', title: 'Select it, the playhead to its start', onclick: () => ((this.selClip = c), this.setPlayhead(c.start), this.renderMovie()) }, String(i + 1)),
          camSel,
          num(c.start, 0.1, (s, v) => setClipStart(s, c, v), 'When it comes in (s of movie)'),
          num(toSim(S, c.start), 0.1, (s, v) => setClipStart(s, c, fromSim(s, v)), 'When it comes in (s of simulation)'),
          num(c.dur, 0.1, (s, v) => setClipDur(s, c, v), 'How long (s of movie)'),
          num(c.from ?? 0, 0.1, (s, v) => (c.from = v), 'From when in the camera’s own move (s)'),
          tr,
          num(c.tdur ?? 0.6, 0.1, (s, v) => (c.tdur = v), 'How long its transition takes (s)'),
          el(
            'span',
            { class: 'btns' },
            el('button', { title: 'Look through it at its start (Esc: back)', onclick: () => (this.setPlayhead(c.start + 1e-3), this.seqLook(true)) }, '👁'),
            el('button', { class: 'x', title: 'Delete this clip', onclick: () => this.changeMovie((m, s) => s.clips.splice(s.clips.indexOf(c), 1)) }, '✕'),
          ),
        ),
      );
    }
    if (!S.clips.length) table.append(el('p', { class: 'muted' }, cams.length ? 'No clips yet: drag a camera onto the timeline (or 🎬 + Clip in a camera’s keyframes).' : 'No cameras here yet: Edit world › + Add › Cinema › Film camera.'));
    else if (!rows.length) table.append(el('p', { class: 'muted' }, 'Click a clip for its exact times (☰ List: all of them). Drag it to move it, its edges to trim it; its badge: cut, dissolve, fade.'));
    p.append(table);
    const set = (key, label, attrs) => {
      const inp = el('input', { type: 'number', ...attrs, value: S[key] ?? 0 });
      inp.addEventListener('change', () => this.changeMovie((m, s) => (s[key] = Math.max(attrs.min ?? 0, +inp.value || 0))));
      return el('label', {}, label, inp);
    };
    const restart = el('input', { type: 'checkbox', checked: S.restart !== false });
    restart.addEventListener('change', () => this.changeMovie((m, s) => (s.restart = restart.checked)));
    const clock = el('select', { title: 'What the clips’ times count: seconds of the movie as it plays, or of the simulation (cuts at the simulation’s time, however fast it runs)' }, ...CLOCKS.map((n) => el('option', { value: n, selected: (S.clock ?? 'movie') === n }, n === 'sim' ? 'simulation time' : 'movie time')));
    clock.addEventListener('change', () => this.changeMovie((m, s) => (s.clock = clock.value)));
    p.append(
      el(
        'div',
        { class: 'opts' },
        set('simSpeed', 'World speed ×', { step: 0.1, min: 0.05 }),
        el('label', {}, 'Cuts on ', clock),
        set('fadeIn', 'Fade in (s)', { step: 0.1, min: 0 }),
        set('fadeOut', 'Fade out (s)', { step: 0.1, min: 0 }),
        el('label', { title: 'The scene from its start when the movie begins (from Edit world it always is)' }, restart, ' From the start'),
      ),
      el(
        'div',
        { class: 'actions' },
        el('button', { onclick: () => this.addShot(this.selected()?.name) }, '+ Clip'),
        el('button', { class: 'play', disabled: !S.clips.length, title: 'Play this sequence: in Play, the UI hidden, the world running, the cameras cut per the clips (Esc stops)', onclick: () => this.play(false) }, '▶ Play movie'),
        el('button', { class: 'rec', disabled: !S.clips.length, title: 'Play it and record the picture to a video file (WebM), saved when it ends or on Esc', onclick: () => this.play(true) }, '⏺ Record'),
      ),
    );
    this.showPlayhead(this.playhead, false);
    this.updateButtons();
  }

  /** The ruler, the clips and the playhead (redrawn while dragging, the rest of the panel kept). */
  renderTrack() {
    const tl = this.tl;
    if (!tl) return;
    const S = this.seq();
    const pps = this.zoom;
    const scroll = tl.scrollLeft;
    const dur = sequenceDuration(S);
    const span = Math.max(dur + 10, this.playhead + 5, (tl.clientWidth || 900) / pps);
    const W = span * pps;
    const ruler = el('div', { class: 'ruler', style: `width:${W}px` });
    const showSim = (S.simSpeed ?? 1) !== 1 || S.clock === 'sim';
    // ticks: every second (labels as far apart as fit), the simulation's seconds below
    const every = pps >= 40 ? 1 : pps >= 15 ? 5 : 10;
    for (let s = 0; s <= span; s += pps >= 80 ? 0.5 : 1) {
      const major = Math.abs(s / every - Math.round(s / every)) < 1e-9;
      ruler.append(el('span', { class: `tick${major ? ' major' : ''}`, style: `left:${s * pps}px` }, major ? `${s}s` : ''));
    }
    if (showSim) {
      const sp = S.simSpeed ?? 1;
      const se = every * Math.max(1, Math.round(sp));
      for (let q = 0; fromSim(S, q) <= span; q += se) ruler.append(el('span', { class: 'tick sim', style: `left:${fromSim(S, q) * pps}px` }, `${q}`));
    }
    const lane = (this.lane = el('div', { class: 'lane', style: `width:${W}px` }));
    S.clips.forEach((c, i) => {
      const missing = !this.cameras().some((q) => q.name === c.camera);
      const prev = S.clips[i - 1];
      const joined = prev && Math.abs(clipEnd(prev) - c.start) < 0.01;
      const badge = el('span', { class: 'tr', title: `Comes in: ${c.transition ?? 'cut'}${c.transition && c.transition !== 'cut' ? ` over ${c.tdur ?? 0.6} s` : ''}${c.transition === 'dissolve' && !joined ? ' (a dissolve needs a clip right before it: from black, it is a cut)' : ''} — click: cut, dissolve, fade` }, TR_ICON[c.transition ?? 'cut']);
      const div = el(
        'div',
        { class: `clip${c === this.selClip ? ' on' : ''}${missing ? ' missing' : ''}`, style: `left:${c.start * pps}px;width:${Math.max(4, c.dur * pps)}px`, title: `${c.camera}: ${c.start.toFixed(2)}–${clipEnd(c).toFixed(2)} s${c.from ? `, from ${c.from} s into its move` : ''}` },
        el('span', { class: 'h l' }),
        badge,
        el('span', { class: 'name' }, c.camera, missing ? ' (missing)' : ''),
        el('span', { class: 'h r' }),
      );
      if (c.transition && c.transition !== 'cut' && c.tdur > 0) div.append(el('span', { class: 'tw', style: `width:${Math.min(c.dur, c.tdur ?? 0.6) * pps}px` }));
      div.addEventListener('pointerdown', (e) => this.clipDown(e, c));
      badge.addEventListener('pointerdown', (e) => e.stopPropagation());
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        this.changeMovie(() => (c.transition = TRANSITIONS[(TRANSITIONS.indexOf(c.transition ?? 'cut') + 1) % TRANSITIONS.length]));
      });
      lane.append(div);
    });
    // a camera dropped on the track
    lane.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    lane.addEventListener('drop', (e) => {
      e.preventDefault();
      const name = e.dataTransfer.getData('text/x-camera') || e.dataTransfer.getData('text/plain');
      if (name) this.dropCamera(name, this.timeAtX(e.clientX), e);
    });
    lane.addEventListener('pointerdown', (e) => {
      if (e.target === lane) {
        this.selClip = null;
        this.scrubFrom(e);
      }
    });
    ruler.addEventListener('pointerdown', (e) => this.scrubFrom(e));
    this.phLine = el('div', { class: 'playhead' });
    const inner = el('div', { class: 'inner', style: `width:${W}px` }, ruler, lane, this.phLine);
    tl.replaceChildren(inner);
    tl.scrollLeft = scroll;
    this.showPlayhead(this.playhead, false);
  }

  /** A camera put on the track at t (snapped, into the nearest gap): as long as its move (or 4 s). */
  dropCamera(name, t, e) {
    const cam = this.cameras().find((c) => c.name === name);
    if (!cam) return;
    this.changeMovie((m, s) => (this.selClip = addClip(s, name, t, moveDuration(cam) || 4, this.snapOpts(e))));
  }

  /** A clip dragged: moved (its body) or trimmed (its edges). */
  clipDown(e, c) {
    if (e.button !== 0) return;
    e.preventDefault();
    const edge = e.target.classList.contains('l') ? 'start' : e.target.classList.contains('r') ? 'end' : null;
    const S = this.seq();
    const x0 = e.clientX, start0 = c.start;
    let changed = false;
    if (this.selClip !== c) {
      this.selClip = c;
      this.renderTrack();
    }
    const move = (ev) => {
      if (!changed && Math.abs(ev.clientX - x0) < 3) return;
      if (!changed) this.ed.snapshot();
      changed = true;
      if (edge) trimClip(S, c, edge, this.timeAtX(ev.clientX), this.snapOpts(ev));
      else moveClip(S, c, start0 + (ev.clientX - x0) / this.zoom, this.snapOpts(ev));
      this.renderTrack();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!changed) this.setPlayhead(this.timeAtX(e.clientX));
      this.renderMovie();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /** The playhead dragged along the ruler (or the empty track). */
  scrubFrom(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    this.setPlayhead(this.timeAtX(e.clientX));
    const move = (ev) => this.setPlayhead(this.timeAtX(ev.clientX));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.renderMovie();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /** The playhead set: shown, the camera on then drawn at that moment, looked through if 👁 is on. */
  setPlayhead(t) {
    this.playhead = Math.max(0, t);
    const d = this.director;
    if (d.active && d.kind === 'sequence') d.lookSequence(this.seq(), this.playhead, d.playing);
    this.showPlayhead(this.playhead, true);
  }
  showPlayhead(t, redraw = true) {
    this.playhead = t;
    const S = this.seq();
    if (this.phLine) this.phLine.style.left = `${t * this.zoom}px`;
    if (this.phMovie && document.activeElement !== this.phMovie) this.phMovie.value = r2(t);
    if (this.phSim && document.activeElement !== this.phSim) this.phSim.value = r2(toSim(S, t));
    const s = clipAt(S, t);
    if (this.phInfo) this.phInfo.textContent = s.clip ? ` ${s.clip.camera} · ${s.local.toFixed(2)} s into its move${s.dissolve > 0 ? ' · dissolving' : ''}${s.black > 0 ? ` · ${Math.round(s.black * 100)} % black` : ''}` : s.done ? ' after the end (black)' : ' between clips (black)';
    const air = s.clip ? { name: s.clip.camera, local: s.local } : null;
    if (redraw || this.onAir?.name !== air?.name || Math.abs((this.onAir?.local ?? 0) - (air?.local ?? 0)) > 0.02) {
      this.onAir = air;
      if (!this.director.active) this.draw();
    }
  }

  toggleSeqLook() {
    const d = this.director;
    if (d.active && d.kind === 'sequence' && !d.playing) d.stop();
    else this.seqLook(false);
    this.updateButtons();
  }
  seqLook(play) {
    this.director.lookSequence(this.seq(), this.playhead, play);
    this.updateButtons();
    this.draw();
  }
  toggleSeqPlay() {
    const d = this.director;
    if (d.active && d.kind === 'sequence' && d.playing) d.stop();
    else this.seqLook(true);
    this.updateButtons();
  }

  play(record) {
    this.panel.hidden = true;
    this.btn.classList.remove('on');
    this.onAir = null;
    this.director.playMovie({ record, sequence: this.seqIndex ?? undefined });
  }
}
