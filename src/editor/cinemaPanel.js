/**
 * Film cameras and the movie in the editor (models/camera.js, src/cinema/):
 *
 *  - In Edit world every camera is drawn as a camera with its view (the frustum of its lens, the
 *    frame's aspect), its keyframed path and keys; a click on one selects it. Not drawn in Play.
 *  - A selected camera's properties: its lens, focus and exposure, effects and move in folders,
 *    and its keyframes: a timeline to scrub, ◆ Set key here (the editor's view as it is now, and
 *    the lens values), 📷 Camera from view (the camera stands where you look from), 👁 Look
 *    through (its picture, with its effects, at the scrubbed time), ▶ Preview (its move played),
 *    the keys listed (time, easing; a click takes the view there).
 *  - 🎬 Movie (in the mode bar): the shot list of the place you are in (place.movie): which
 *    camera, how long, from when in its move, how it comes in (cut, dissolve, fade); ▶ Play movie
 *    (in Play, the UI hidden, Esc stops), ⏺ Record (to a video file).
 *
 * Camera settings and the movie are changes of the scene (undo, saved with it) that need no
 * rebuild of the world.
 */
import * as THREE from 'three';
import { MODELS } from '../models/index.js';
import { LENSES, FRAMES } from '../cinema/lens.js';
import { EASE_NAMES, setKey, keysDuration, samplePath, sortKeys } from '../cinema/keyframes.js';
import { moveDuration, subjectsOf, pickSubject } from '../cinema/rig.js';
import { TRANSITIONS, defaultMovie, movieDuration, newShot, nextCameraName } from '../cinema/sequence.js';
import { Director, camerasOf, cameraFrame, FX_KEYS } from '../cinema/director.js';
import { toLocal } from '../models/composite.js';

const SEL_COLOR = 0xffa040;
const CAM_COLOR = 0xe8eef8;
const PATH_COLOR = 0x6fd3ff;
const r2 = (v) => +(+v).toFixed(2);
const r3 = (v) => +(+v).toFixed(3);

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
    // the Movie button and panel
    this.btn = el('button', { class: 'movie', title: 'The movie of this place: its shots (cameras, cuts), play it, record it', onclick: () => this.toggleMovie() }, '🎬 Movie');
    ed.bar.append(this.btn);
    this.panel = el('div', { id: 'moviePanel', hidden: true });
    document.body.append(this.panel);
    // redrawn when the world is rebuilt (a restart, another scene)
    setInterval(() => {
      if (this.ed.mode === 'edit' && this.drawnWorld !== C.sim?.world) this.draw();
    }, 500);
  }

  cameras() {
    return camerasOf(this.ed.ctx.scene, this.ed.ctx.sim?.world);
  }
  /** The selected object's camera entry, if it is a camera. */
  selected() {
    const ob = this.ed.node();
    return ob?.type === 'camera' ? this.cameras().find((c) => c.node === ob) ?? null : null;
  }
  movie() {
    const place = this.ed.ctx.place();
    return (place.movie ??= defaultMovie());
  }

  setMode(m) {
    if (m !== 'edit' && this.director.active && this.director.kind !== 'movie') this.director.stop();
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
    this.drawnWorld = this.ed.ctx.sim?.world;
    if (this.ed.mode !== 'edit') return;
    const sel = this.ed.node();
    const subjects = subjectsOf(this.ed.ctx.sim?.world);
    for (const c of this.cameras()) {
      const on = c.node === sel;
      const color = on ? SEL_COLOR : CAM_COLOR;
      const subject = pickSubject(subjects, c.params.subject, c.params.subjectIndex);
      const F = cameraFrame(c, on ? this.t : 0, { subject, canvasAspect: this.view.camera.aspect, motion: false });
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
      const fr = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(segs), new THREE.LineBasicMaterial({ color, transparent: true, opacity: on ? 0.95 : 0.55, depthTest: false }));
      rig.add(fr);
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
        if (path.length >= 2) {
          const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(path), new THREE.LineBasicMaterial({ color: PATH_COLOR, transparent: true, opacity: on ? 0.9 : 0.4, depthTest: false }));
          line.renderOrder = 8;
          g.add(line);
        }
        for (const k of sortKeys(c.keys)) {
          if (!k.pos) continue;
          const d = new THREE.Mesh(new THREE.OctahedronGeometry(on ? 0.14 : 0.09), new THREE.MeshBasicMaterial({ color: PATH_COLOR, depthTest: false, transparent: true }));
          d.position.copy(world(k.pos));
          d.renderOrder = 9;
          g.add(d);
        }
      }
      // where it looks (selected): a thin line to its aim point
      if (on) {
        const aim = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...F.E.pos), new THREE.Vector3(...F.E.target)]), new THREE.LineDashedMaterial({ color, dashSize: 0.3, gapSize: 0.2, transparent: true, opacity: 0.5, depthTest: false }));
        aim.computeLineDistances();
        g.add(aim);
      }
    }
    g.visible = this.ed.mode === 'edit' && !this.director.active;
  }

  /** A click in the view on a camera selects it (true: it was one). */
  click(e) {
    if (this.ed.mode !== 'edit' || !this.pickables.length || !this.group.visible) return false;
    const v = this.view;
    const r = v.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    v.raycaster.setFromCamera(ndc, v.camera);
    const hit = v.raycaster.intersectObjects(this.pickables, false)[0];
    if (!hit) return false;
    const i = this.ed.selectNode(hit.object.userData.camNode);
    this.ed.select(i, true);
    return true;
  }

  /* ---------------- the properties ---------------- */
  /** The camera's parameters in folders, and its keyframes. */
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
        // (the shots of this camera keep it)
        for (const sh of this.movie().shots) if (sh.camera === old) sh.camera = v;
        old = v;
        light();
        ed.refresh();
      });
    const folders = {};
    for (const grp of M.paramGroups) folders[grp] = gui.addFolder(grp);
    folders['Focus & exposure'].close();
    folders.Effects.close();
    const ctl = {};
    for (const [key, spec] of Object.entries(M.params)) {
      if (!spec.group) continue;
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
        if (key === 'move' || key === 'keyEffects') ed.buildProps();
      });
      ctl[key] = c;
    }
    this.keysFolder(gui, ob);
  }

  keysFolder(gui, ob) {
    const ed = this.ed;
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
      el('div', { class: 'add' }, this.lookBtn, this.previewBtn, tb('🎬 + Shot', 'Add a shot of this camera to the movie', () => this.addShot(P.name))),
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
    ed.rebuild();
  }

  viewFromCamera() {
    const c = this.selected();
    if (!c) return;
    if (this.director.active) this.director.stop();
    const v = this.view;
    const subject = pickSubject(subjectsOf(this.ed.ctx.sim?.world), c.params.subject, c.params.subjectIndex);
    const F = cameraFrame(c, this.t, { subject, canvasAspect: v.camera.aspect, motion: false });
    v.camera.position.copy(v.root.localToWorld(new THREE.Vector3(...F.E.pos)));
    v.controls.target.copy(v.root.localToWorld(new THREE.Vector3(...F.E.target)));
    v.controls.update();
  }

  /* ---------------- the movie ---------------- */
  toggleMovie(show = this.panel.hidden) {
    this.panel.hidden = !show;
    this.btn.classList.toggle('on', show);
    if (show) this.renderMovie();
  }

  addShot(name) {
    const cams = this.cameras();
    if (!cams.length) {
      alert('There is no camera here yet: Edit world › + Add › Cinema › Film camera.');
      return;
    }
    const M = this.movie();
    const used = new Set(M.shots.map((s) => s.camera));
    const cam = cams.find((c) => c.name === name) ?? cams.find((c) => !used.has(c.name)) ?? cams[0];
    this.ed.snapshot();
    M.shots.push(newShot(cam.name, moveDuration(cam) || 4));
    this.toggleMovie(true);
  }

  /** Change the movie (undo first), then show it again. */
  changeMovie(fn) {
    this.ed.snapshot();
    fn(this.movie());
    this.renderMovie();
  }

  renderMovie() {
    const p = this.panel;
    if (p.hidden) return;
    const ed = this.ed;
    const M = this.movie();
    const cams = this.cameras();
    const names = cams.map((c) => c.name);
    const place = ed.ctx.place();
    p.replaceChildren(
      el('h3', {}, `🎬 Movie: ${place.label ?? place.name ?? ed.ctx.scene.name ?? 'this place'}`, el('span', { class: 'muted' }, ` · ${M.shots.length} shot${M.shots.length === 1 ? '' : 's'}, ${movieDuration(M).toFixed(1)} s`), el('button', { class: 'x', title: 'Close', onclick: () => this.toggleMovie(false) }, '✕')),
    );
    const table = el('div', { class: 'shots' });
    table.append(el('div', { class: 'shot head' }, el('span', {}, '#'), el('span', {}, 'Camera'), el('span', {}, 'Length (s)'), el('span', {}, 'From (s)'), el('span', {}, 'Comes in'), el('span', {}, 'Over (s)'), el('span', {})));
    M.shots.forEach((sh, i) => {
      const num = (key, step, min) => {
        const inp = el('input', { type: 'number', step, min, value: sh[key] ?? 0 });
        inp.addEventListener('change', () => this.changeMovie(() => (sh[key] = Math.max(min, +inp.value || 0))));
        return inp;
      };
      const camSel = el('select', {}, ...[...new Set([...names, sh.camera])].map((n) => el('option', { value: n, selected: n === sh.camera }, names.includes(n) ? n : `${n} (missing)`)));
      camSel.addEventListener('change', () => this.changeMovie(() => (sh.camera = camSel.value)));
      const tr = el('select', {}, ...TRANSITIONS.map((n) => el('option', { value: n, selected: (sh.transition ?? 'cut') === n }, n)));
      tr.addEventListener('change', () => this.changeMovie(() => (sh.transition = tr.value)));
      const move = (d) => this.changeMovie((m) => {
        const j = i + d;
        if (j < 0 || j >= m.shots.length) return;
        [m.shots[i], m.shots[j]] = [m.shots[j], m.shots[i]];
      });
      table.append(
        el(
          'div',
          { class: 'shot' },
          el('span', { class: 'n' }, String(i + 1)),
          camSel,
          num('dur', 0.1, 0.1),
          num('from', 0.1, 0),
          tr,
          num('tdur', 0.1, 0),
          el(
            'span',
            { class: 'btns' },
            el('button', { title: 'Look through this shot’s camera (Esc: back)', onclick: () => this.lookShot(sh) }, '👁'),
            el('button', { title: 'Earlier', onclick: () => move(-1) }, '↑'),
            el('button', { title: 'Later', onclick: () => move(1) }, '↓'),
            el('button', { class: 'x', title: 'Delete this shot', onclick: () => this.changeMovie((m) => m.shots.splice(i, 1)) }, '✕'),
          ),
        ),
      );
    });
    if (!M.shots.length) table.append(el('p', { class: 'muted' }, cams.length ? 'No shots yet: + Shot adds one (a camera, how long).' : 'No cameras here yet: Edit world › + Add › Cinema › Film camera.'));
    p.append(table);
    const set = (key, label, attrs) => {
      const inp = el('input', { type: 'number', ...attrs, value: M[key] ?? 0 });
      inp.addEventListener('change', () => this.changeMovie(() => (M[key] = Math.max(attrs.min ?? 0, +inp.value || 0))));
      return el('label', {}, label, inp);
    };
    const restart = el('input', { type: 'checkbox', checked: M.restart !== false });
    restart.addEventListener('change', () => this.changeMovie(() => (M.restart = restart.checked)));
    p.append(
      el(
        'div',
        { class: 'opts' },
        set('simSpeed', 'World speed ×', { step: 0.1, min: 0.05 }),
        set('fadeIn', 'Fade in (s)', { step: 0.1, min: 0 }),
        set('fadeOut', 'Fade out (s)', { step: 0.1, min: 0 }),
        el('label', { title: 'The scene from its start when the movie begins (from Edit world it always is)' }, restart, ' From the start'),
      ),
      el(
        'div',
        { class: 'actions' },
        el('button', { onclick: () => this.addShot(this.selected()?.name) }, '+ Shot'),
        el('button', { class: 'play', disabled: !M.shots.length, title: 'Play the movie: the UI hidden, the world running, the cameras cut per the shots (Esc stops)', onclick: () => this.play(false) }, '▶ Play movie'),
        el('button', { class: 'rec', disabled: !M.shots.length, title: 'Play it and record the picture to a video file (WebM), saved when it ends or on Esc', onclick: () => this.play(true) }, '⏺ Record'),
      ),
    );
  }

  lookShot(sh) {
    const c = this.cameras().find((q) => q.name === sh.camera);
    if (!c) return;
    if (this.ed.mode === 'edit') {
      const i = this.ed.selectNode(c.node);
      this.ed.select(i, true);
    }
    this.t = sh.from ?? 0;
    this.director.look(c.name, this.t);
    this.updateButtons();
  }

  play(record) {
    this.panel.hidden = true;
    this.btn.classList.remove('on');
    this.director.playMovie({ record });
  }
}
