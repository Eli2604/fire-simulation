/**
 * The editor: one page for the whole project, over the one world (the voxel simulation).
 *
 *   Play        the simulation runs: the tools, the walk-in, the squads, fire (src/main.js).
 *   Edit world  the simulation stops at its start; the scene's objects in a list (the outliner),
 *               picked in the view or the list, moved and turned with a gizmo, their parameters
 *               on the right, new ones from a palette, removed, duplicated; undo / redo; the
 *               world's size, voxels, ground and weather. Every change rebuilds the scene.
 *   Rig         the characters: the soldier (clips, loadouts, gear, hit zones) and the dragon
 *               (acts, wing damage, hit zones) on a stage of their own (rig/stage.js). Their hit
 *               zone tables are the ones the world's hit tests use: edits apply when you play.
 *
 * Scenes: the built-in scenarios, scenes saved in this browser (localStorage), a new empty one,
 * JSON import / export. The drone camp, a world of another scale (a swarm over kilometres of
 * hills), opens as a stage of its own (camp/stage.js).
 *
 * main.js gives the context (ctx): the view, the scene and the simulation, load / restart, the
 * Play GUI, and the walk-through.
 */
import * as THREE from 'three';
import GUI from 'lil-gui';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { MODELS, defaultParams } from '../models/index.js';
import { MATERIAL_NAMES } from '../sim/materials.js';
import { SCENARIOS, cloneScene } from '../scenarios.js';

const STORE = 'fireEditor.scenes';
/** Objects that are characters (no voxels of their own): rigged figures, shown in the rig. */
const CHARACTERS = { squad: 'soldier', enemy: 'soldier', dragon: 'dragon' };
/** The palette, by kind (a model not named here goes under Other). */
const GROUPS = [
  ['Cover & buildings', ['wall', 'crate', 'deck', 'fence', 'house', 'hallway', 'veranda', 'church', 'shipSection']],
  ['Characters', ['squad', 'enemy', 'dragon']],
  ['Fire & fuel', ['woodPile', 'candle', 'candelabra', 'torch', 'burner', 'metalBar', 'gasCylinder']],
  ['Furniture & props', ['couch', 'sideTable', 'teaCup', 'clothesline', 'statue', 'scannedProp', 'car']],
  ['Nature', ['tree', 'grass', 'volcano']],
  ['Places', ['island', 'catacombs', 'cryptChapel', 'carrierDeck', 'carrierBelow', 'jet', 'spaceship']],
];

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
const store = {
  all() {
    try {
      return JSON.parse(localStorage.getItem(STORE) ?? '{}') ?? {};
    } catch {
      return {};
    }
  },
  put(name, desc) {
    try {
      const a = store.all();
      a[name] = desc;
      localStorage.setItem(STORE, JSON.stringify(a));
      return true;
    } catch {
      return false;
    }
  },
  drop(name) {
    try {
      const a = store.all();
      delete a[name];
      localStorage.setItem(STORE, JSON.stringify(a));
    } catch {
      /* nothing kept */
    }
  },
};
/** A scene as it is saved: its description without what the simulation added. */
function sceneJson(scene, weather) {
  const s = JSON.parse(JSON.stringify({ ...scene, weather }));
  delete s.voxelScale;
  return s;
}

export class Editor {
  constructor(ctx) {
    this.ctx = ctx;
    this.mode = 'play';
    this.sel = -1;
    this.undo = [];
    this.redo = [];
    this.stages = {};
    this.buildUi();
    // the gizmo: moves (on the ground plane, and up) and turns (about the vertical) a stand-in
    // for the selected object; the scene is rebuilt when you let go
    const v = ctx.view;
    this.pivot = new THREE.Object3D();
    v.root.add(this.pivot);
    this.gizmo = new TransformControls(v.camera, v.renderer.domElement);
    this.gizmo.setSize(0.9);
    this.gizmo.attach(this.pivot);
    this.gizmoHelper = this.gizmo.getHelper();
    v.scene.add(this.gizmoHelper);
    this.gizmo.enabled = false;
    this.gizmoHelper.visible = false;
    this.gizmo.addEventListener('dragging-changed', (e) => {
      v.controls.enabled = !e.value;
      this.dragging = e.value;
      if (!e.value) this.applyGizmo();
    });
    this.box = new THREE.Box3Helper(new THREE.Box3(), 0xffb347);
    this.box.visible = false;
    v.root.add(this.box);
    // picking in the view (a click without a drag, so orbiting still works)
    const cv = v.renderer.domElement;
    cv.addEventListener('pointerdown', (e) => {
      if (this.mode === 'edit' && e.button === 0) this.down = [e.clientX, e.clientY];
    });
    cv.addEventListener('pointerup', (e) => {
      if (this.mode !== 'edit' || e.button !== 0 || !this.down || this.dragging) return;
      const moved = Math.hypot(e.clientX - this.down[0], e.clientY - this.down[1]);
      this.down = null;
      if (moved > 5 || this.gizmo.dragging || this.gizmo.axis) return;
      this.clickView(e);
    });
    window.addEventListener('keydown', (e) => this.key(e));
  }

  /* ---------------- UI ---------------- */
  buildUi() {
    const bar = (this.bar = el('div', { id: 'modebar' }));
    const btn = (m, label, title) => el('button', { 'data-mode': m, title, onclick: () => this.setMode(m) }, label);
    this.sceneBtn = el('button', { class: 'scene', title: 'Open a scene, save this one, start a new one', onclick: () => this.toggleMenu() }, 'Scene ▾');
    bar.append(
      el('span', { class: 'brand' }, 'World editor'),
      el('div', { class: 'modes' }, btn('play', '▶ Play', 'Run the world: tools, walk-in, squads, fire (P)'), btn('edit', '✎ Edit world', 'Place, move, turn and set up objects (E)'), btn('rig', '🦴 Rig', 'The characters: soldier and dragon, their animations and hit zones (R)')),
      this.sceneBtn,
    );
    this.menu = el('div', { id: 'sceneMenu', hidden: true });
    document.body.append(bar, this.menu);
    // edit mode: the outliner on the left, the properties on the right
    this.outliner = el('div', { id: 'outliner', hidden: true });
    this.props = el('div', { id: 'props', hidden: true });
    this.palette = el('div', { id: 'palette', hidden: true });
    this.stageRoot = el('div', { id: 'stageRoot', hidden: true });
    document.body.append(this.outliner, this.props, this.palette, this.stageRoot);
    this.hint = el('div', { id: 'editHint', hidden: true });
    document.body.append(this.hint);
  }

  setHint(t) {
    this.hint.textContent = t ?? '';
    this.hint.hidden = !t || this.mode !== 'edit';
  }

  /** Switch mode: 'play', 'edit', 'rig' (or 'camp': the drone camp's stage). */
  async setMode(m, what) {
    const C = this.ctx;
    if (m === this.mode && m !== 'rig') return;
    const prev = this.mode;
    if (prev === 'rig' || prev === 'camp') this.stages[prev]?.hide();
    this.mode = m;
    this.bar.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    document.body.dataset.mode = m;
    const editing = m === 'edit';
    this.outliner.hidden = this.props.hidden = !editing;
    this.palette.hidden = true;
    this.gizmo.enabled = editing && this.sel >= 0;
    this.gizmoHelper.visible = this.gizmo.enabled;
    this.box.visible = editing && this.sel >= 0;
    C.playGui.domElement.style.display = m === 'play' ? '' : 'none';
    if (editing) {
      if (C.walk.active) C.walk.exit();
      C.setTool('inspect');
      // the scene as it starts: what you edit
      if (prev === 'play') C.restart();
      C.state.running = false;
      this.refresh();
      this.setHint('Click an object to select it · drag the arrows to move, the ring to turn · Del removes · Ctrl+D duplicates · Ctrl+Z undo');
    } else this.setHint(null);
    if (m === 'play') {
      C.state.running = true;
      if (prev === 'edit') C.restart();
    }
    C.view.paused = m === 'rig' || m === 'camp';
    this.stageRoot.hidden = !(m === 'rig' || m === 'camp');
    if (m === 'rig' || m === 'camp') {
      this.stageRoot.querySelectorAll(':scope > div').forEach((d) => (d.hidden = d.dataset.stage !== m));
      const st = await this.stage(m);
      if (this.mode !== m) return;
      st.show();
      if (m === 'rig') st.select?.(what ?? this.rigTarget() ?? { kind: 'soldier' });
    }
    const u = new URL(location.href);
    if (m === 'play') u.searchParams.delete('mode');
    else u.searchParams.set('mode', m);
    try {
      history.replaceState(null, '', u);
    } catch {
      /* (a page in a sandbox may not) */
    }
  }

  /** The rig or camp stage, built the first time it is needed. */
  async stage(m) {
    if (this.stages[m]) return this.stages[m];
    const box = el('div', { 'data-stage': m, class: 'stage' });
    this.stageRoot.append(box);
    box.append(el('div', { class: 'loading' }, m === 'rig' ? 'Loading the rig…' : 'Loading the camp…'));
    const back = () => this.setMode(this.lastWorldMode ?? 'play');
    const params = new URLSearchParams(location.search);
    const st =
      m === 'rig'
        ? (await import('../rig/stage.js')).mountRig(box, { onExit: back, params })
        : (await import('../camp/stage.js')).mountCamp(box, { onExit: back, params });
    this.stages[m] = await st;
    box.querySelector(':scope > .loading')?.remove();
    return this.stages[m];
  }

  /** What the rig should show: the character selected in the world, if one is. */
  rigTarget() {
    const o = this.ctx.scene.objects[this.sel];
    if (!o || !CHARACTERS[o.type]) return null;
    if (CHARACTERS[o.type] === 'dragon') return { kind: 'dragon' };
    return { kind: 'soldier', loadout: o.params?.flameTrooper ? 'torch' : 'rifle' };
  }

  toggleMenu(show = this.menu.hidden) {
    this.menu.hidden = !show;
    if (!show) return;
    const C = this.ctx;
    const m = this.menu;
    m.replaceChildren();
    const item = (label, fn, cls) => el('button', { class: cls, onclick: () => (this.toggleMenu(false), fn()) }, label);
    m.append(el('h4', {}, 'This scene'));
    m.append(
      item('Save in this browser…', () => this.save()),
      item('Export JSON', () => C.io.exportJson()),
      item('Import JSON…', () => C.io.importJson()),
      item('New empty scene', () => this.newScene()),
    );
    const mine = store.all();
    if (Object.keys(mine).length) {
      m.append(el('h4', {}, 'Saved in this browser'));
      for (const name of Object.keys(mine).sort())
        m.append(
          el(
            'div',
            { class: 'row' },
            item(name, () => this.open(cloneScene(mine[name]))),
            el('button', { class: 'x', title: 'Delete', onclick: (e) => (e.stopPropagation(), confirm(`Delete "${name}"?`) && (store.drop(name), this.toggleMenu(true))) }, '✕'),
          ),
        );
    }
    m.append(el('h4', {}, 'Scenarios'));
    for (const [k, s] of Object.entries(SCENARIOS)) {
      if (s.page === 'rig.html') continue; // the rig is a mode
      m.append(item(s.name, () => (s.page === 'camp.html' ? (this.lastWorldMode = this.worldMode(), this.setMode('camp')) : this.open(cloneScene(SCENARIOS[k]), k)), C.state.scenario === k ? 'on' : ''));
    }
  }

  worldMode() {
    return this.mode === 'edit' ? 'edit' : 'play';
  }

  open(desc, key) {
    const C = this.ctx;
    if (this.mode === 'rig' || this.mode === 'camp') this.setMode(this.lastWorldMode ?? 'play');
    if (key) C.state.scenario = key;
    this.select(-1);
    this.undo.length = this.redo.length = 0;
    C.load(desc);
    if (this.mode === 'edit') C.state.running = false;
    this.refresh();
  }

  newScene() {
    this.open({
      name: 'New scene',
      description: 'An empty piece of ground: add objects from Edit world › + Add.',
      world: { size: [30, 6, 30], h: 0.2, ground: 'soil' },
      timeScale: 1,
      view: { camera: [12, 14, 22] },
      objects: [],
    });
    this.setMode('edit');
  }

  save() {
    const C = this.ctx;
    const name = prompt('Save this scene in this browser as:', C.scene.name ?? 'My scene');
    if (!name) return;
    const desc = sceneJson(C.scene, C.weather());
    desc.name = name;
    C.scene.name = name;
    if (!store.put(name, desc)) alert('This browser would not keep it (storage off or full): use Export JSON.');
  }

  /* ---------------- the outliner and the properties ---------------- */
  refresh() {
    if (this.mode !== 'edit') return;
    const C = this.ctx, S = C.scene;
    if (this.sel >= S.objects.length) this.sel = -1;
    const o = this.outliner;
    o.replaceChildren();
    o.append(el('h3', {}, S.name ?? 'Scene'));
    if (S.zones) {
      const sel = el('select', { title: 'The part of the scene you edit (go there)' });
      for (const [k, z] of Object.entries(S.zones)) sel.append(el('option', { value: k, selected: k === S.zone }, z.name));
      sel.onchange = () => {
        this.select(-1);
        C.activateZone(sel.value);
        this.refresh();
      };
      o.append(sel);
    }
    const list = el('div', { class: 'list' });
    S.objects.forEach((ob, i) => {
      const M = MODELS[ob.type];
      const tag = CHARACTERS[ob.type] ? (ob.type === 'squad' ? ob.params?.unit ?? 'team' : CHARACTERS[ob.type]) : '';
      list.append(el('button', { class: i === this.sel ? 'on' : '', onclick: () => this.select(i, true) }, el('span', { class: 'n' }, String(i + 1)), M?.label?.replace(/ \(.*\)$/, '') ?? ob.type, tag ? el('span', { class: 'tag' }, tag) : null));
    });
    if (!S.objects.length) list.append(el('p', { class: 'muted' }, 'No objects yet.'));
    o.append(list);
    o.append(
      el(
        'div',
        { class: 'tools' },
        el('button', { class: 'add', onclick: () => this.showPalette() }, '+ Add'),
        el('button', { disabled: this.sel < 0, onclick: () => this.duplicate() }, 'Duplicate'),
        el('button', { disabled: this.sel < 0, onclick: () => this.remove() }, 'Delete'),
      ),
      el('div', { class: 'tools' }, el('button', { disabled: !this.undo.length, onclick: () => this.doUndo() }, '↶ Undo'), el('button', { disabled: !this.redo.length, onclick: () => this.doRedo() }, '↷ Redo')),
    );
    if (this.sel >= 0) {
      const gm = (m, label, key) => el('button', { class: (this.gizmoMode ?? 'translate') === m ? 'on' : '', title: `${label} (${key})`, onclick: () => ((this.gizmoMode = m), this.placeGizmo(), this.refresh()) }, label);
      o.append(el('div', { class: 'tools gm' }, gm('translate', '✥ Move', 'W'), gm('rotate', '⟳ Turn', 'T')));
    }
    this.buildProps();
  }

  buildProps() {
    const C = this.ctx, S = C.scene;
    this.propsGui?.destroy();
    this.props.replaceChildren();
    const gui = (this.propsGui = new GUI({ container: this.props, title: 'Properties', width: 300 }));
    // the scene before any change made here: what undo goes back to
    this.pending = JSON.stringify(sceneJson(S, C.weather()));
    const ob = S.objects[this.sel];
    const change = () => this.commit();
    if (!ob) {
      // nothing selected: the world itself
      const ws = S.world;
      gui.title('World');
      gui.add(S, 'name').name('Name').onFinishChange(() => this.refresh());
      gui.add(ws.size, '0', 2, 120, 0.1).name('Size X (m)').onFinishChange(change);
      gui.add(ws.size, '1', 1, 40, 0.1).name('Height (m)').onFinishChange(change);
      gui.add(ws.size, '2', 2, 120, 0.1).name('Size Z (m)').onFinishChange(change);
      gui.add(ws, 'h', 0.004, 0.5, 0.001).name('Voxel size (m)').onFinishChange(change);
      if (!ws.ground) ws.ground = 'soil';
      gui.add(ws, 'ground', MATERIAL_NAMES).name('Ground').onFinishChange(change);
      const W = C.weather();
      const fw = gui.addFolder('Weather').close();
      fw.add(W, 'ambient', -20, 45, 0.5).name('Air (°C)').onFinishChange(change);
      fw.add(W, 'windSpeed', 0, 35, 0.1).name('Wind (m/s)').onFinishChange(change);
      fw.add(W, 'windDir', 0, 360, 5).name('Wind towards (°)').onFinishChange(change);
      fw.add(W, 'rain', 0, 50, 0.5).name('Rain (mm/h)').onFinishChange(change);
      fw.add(W, 'fog', 0, 1, 0.01).name('Fog').onFinishChange(change);
      fw.add(W, 'season', ['spring', 'summer', 'autumn', 'winter']).name('Season').onFinishChange(change);
      gui.add({ fire: () => (S.noFire = !S.noFire, change()) }, 'fire').name(S.noFire ? 'Fire at start: none (click: the scenario’s)' : 'Fire at start: the scenario’s (click: none)');
      return;
    }
    const M = MODELS[ob.type];
    gui.title(`${this.sel + 1}. ${M?.label ?? ob.type}`);
    const ws = S.world;
    gui.add(ob, 'x', 0, ws.size[0], 0.01).name('X (m)').onFinishChange(change);
    gui.add(ob, 'z', 0, ws.size[2], 0.01).name('Z (m)').onFinishChange(change);
    if (typeof ob.y !== 'string') {
      ob.y ??= 0;
      gui.add(ob, 'y', 0, ws.size[1], 0.01).name('Height (m)').onFinishChange(change);
    }
    ob.rotation ??= 0;
    gui.add(ob, 'rotation', 0, 360, 1).name('Turn (°)').onFinishChange(change);
    ob.ignite ??= false;
    if (!CHARACTERS[ob.type]) gui.add(ob, 'ignite').name('Burning at start').onFinishChange(change);
    const fp = gui.addFolder('Parameters');
    for (const [key, spec] of Object.entries(M?.params ?? {})) {
      ob.params[key] ??= spec.value;
      let c;
      if (spec.options) c = fp.add(ob.params, key, spec.options);
      else if (spec.color) c = fp.addColor(ob.params, key);
      else if (typeof spec.value === 'boolean') c = fp.add(ob.params, key);
      else if (typeof spec.value === 'string') c = fp.add(ob.params, key);
      else c = fp.add(ob.params, key, spec.min, spec.max, spec.step);
      c.name(spec.label ?? key).onFinishChange(change);
    }
    if (CHARACTERS[ob.type]) gui.add({ rig: () => this.setMode('rig', this.rigTarget()) }, 'rig').name(CHARACTERS[ob.type] === 'dragon' ? '🦴 Rig the dragon (acts, wings, hit zones)' : '🦴 Rig the soldier (animations, gear, hit zones)');
  }

  showPalette() {
    const p = this.palette;
    p.hidden = !p.hidden;
    if (p.hidden) return;
    p.replaceChildren(el('h3', {}, 'Add an object', el('button', { class: 'x', onclick: () => (p.hidden = true) }, '✕')));
    const seen = new Set();
    const add = (title, keys) => {
      const g = el('div', { class: 'grp' });
      for (const k of keys) {
        if (!MODELS[k] || seen.has(k)) continue;
        seen.add(k);
        g.append(el('button', { title: MODELS[k].label, onclick: () => this.startPlacing(k) }, MODELS[k].label.replace(/ \(.*\)$/, '')));
      }
      if (g.children.length) p.append(el('h4', {}, title), g);
    };
    for (const [t, ks] of GROUPS) add(t, ks);
    add('Other', Object.keys(MODELS));
  }

  startPlacing(type) {
    this.palette.hidden = true;
    this.placing = type;
    this.setHint(`Click where the ${MODELS[type].label.replace(/ \(.*\)$/, '').toLowerCase()} should go (Esc: cancel)`);
    this.ctx.view.renderer.domElement.style.cursor = 'crosshair';
  }

  /* ---------------- selection and the gizmo ---------------- */
  clickView(e) {
    const C = this.ctx;
    const hit = C.view.pick(e.clientX, e.clientY);
    if (this.placing) {
      if (!hit) return;
      const type = this.placing;
      this.placing = null;
      C.view.renderer.domElement.style.cursor = '';
      const o = { type, params: defaultParams(type), x: +hit.point[0].toFixed(2), z: +hit.point[2].toFixed(2), rotation: 0, ignite: false };
      // on a deck, a roof or a hill: stand on what you clicked
      if (hit.point[1] > C.sim.world.h * 1.5) o.y = +hit.point[1].toFixed(2);
      this.snapshot();
      C.scene.objects.push(o);
      this.sel = C.scene.objects.length - 1;
      this.rebuild();
      this.setHint('Placed. Drag the arrows to move it, the ring to turn it.');
      return;
    }
    if (!hit) return this.select(-1);
    const w = C.sim.world;
    let k = hit.voxel >= 0 ? w.owner[hit.voxel] : -1;
    // characters have no voxels: the nearest one to the spot clicked, within a metre and a half
    if (k < 0 || !C.scene.objects[k]) {
      let best = 1.5;
      C.scene.objects.forEach((o, i) => {
        if (!CHARACTERS[o.type]) return;
        const d = Math.hypot(o.x - hit.point[0], o.z - hit.point[2]);
        if (d < best) (best = d), (k = i);
      });
    }
    this.select(C.scene.objects[k] ? k : -1, true);
  }

  select(i, fromUser = false) {
    this.sel = i;
    const on = this.mode === 'edit' && i >= 0;
    this.gizmo.enabled = on;
    this.gizmoHelper.visible = on;
    this.box.visible = on;
    if (on) this.placeGizmo();
    if (fromUser || this.mode === 'edit') this.refresh();
  }

  /** The stand-in at the selected object, and the box round its voxels. */
  placeGizmo() {
    const C = this.ctx, o = C.scene.objects[this.sel];
    if (!o) return;
    const w = C.sim.world;
    // its voxels' extent
    const b = this.box.box.makeEmpty();
    const own = w.owner, N = own.length;
    let n = 0;
    for (let i = 0; i < N; i++)
      if (own[i] === this.sel && w.mat[i] !== 0) {
        const [x, y, z] = w.coords(i);
        const c = w.center(x, y, z);
        b.expandByPoint(new THREE.Vector3(c[0], c[1], c[2]));
        n++;
      }
    if (!n) b.setFromCenterAndSize(new THREE.Vector3(o.x, (typeof o.y === 'number' ? o.y : 0) + 0.9, o.z), new THREE.Vector3(1.2, 1.8, 1.2));
    else b.expandByScalar(w.h / 2);
    const y = typeof o.y === 'number' ? o.y : n ? b.min.y : 0;
    this.pivot.position.set(o.x, y, o.z);
    this.pivot.rotation.set(0, ((o.rotation ?? 0) * Math.PI) / 180, 0); // (as the voxelizer turns it)
    this.pivot.updateMatrixWorld();
    this.gizmo.setMode(this.gizmoMode ?? 'translate');
    this.gizmo.showY = this.gizmo.mode === 'translate' && typeof o.y !== 'string';
    this.gizmo.showX = this.gizmo.mode === 'translate';
    this.gizmo.showZ = this.gizmo.mode === 'translate';
    if (this.gizmo.mode === 'rotate') this.gizmo.showY = true;
  }

  applyGizmo() {
    const C = this.ctx, o = C.scene.objects[this.sel];
    if (!o) return;
    const p = this.pivot.position;
    const was = [o.x, o.y, o.z, o.rotation];
    const w = C.scene.world.size;
    o.x = +Math.max(0, Math.min(w[0], p.x)).toFixed(2);
    o.z = +Math.max(0, Math.min(w[2], p.z)).toFixed(2);
    if (typeof o.y !== 'string' && (typeof o.y === 'number' || p.y > 0.05)) o.y = +Math.max(0, p.y).toFixed(2);
    // turned (degrees, about the vertical, as models/voxelizer.js turns it)
    const e = new THREE.Euler().setFromQuaternion(this.pivot.quaternion, 'YXZ');
    o.rotation = Math.round(((((e.y * 180) / Math.PI) % 360) + 360) % 360);
    if (was[0] === o.x && was[1] === o.y && was[2] === o.z && was[3] === o.rotation) return;
    const keep = { ...o };
    Object.assign(o, { x: was[0], y: was[1], z: was[2], rotation: was[3] });
    this.snapshot();
    Object.assign(o, keep);
    if (o.y === undefined) delete o.y;
    this.rebuild();
  }

  /* ---------------- changes ---------------- */
  /** A change made in the properties (already written): keep the state before for undo, rebuild. */
  commit() {
    if (this.pending) {
      this.undo.push(this.pending);
      this.redo.length = 0;
    }
    this.pending = null;
    this.rebuild();
  }
  /** The scene as it is now, for undo (before a change). */
  snapshot() {
    const C = this.ctx;
    this.undo.push(JSON.stringify(sceneJson(C.scene, C.weather())));
    if (this.undo.length > 60) this.undo.shift();
    this.redo.length = 0;
  }
  restore(json) {
    const C = this.ctx;
    const d = JSON.parse(json);
    if (C.scene.zones) d.zone = C.scene.zone;
    C.load(d, false);
    C.state.running = this.mode === 'play';
    this.select(Math.min(this.sel, C.scene.objects.length - 1));
  }
  doUndo() {
    const C = this.ctx;
    if (!this.undo.length) return;
    this.redo.push(JSON.stringify(sceneJson(C.scene, C.weather())));
    this.restore(this.undo.pop());
  }
  doRedo() {
    const C = this.ctx;
    if (!this.redo.length) return;
    this.undo.push(JSON.stringify(sceneJson(C.scene, C.weather())));
    this.restore(this.redo.pop());
  }
  rebuild() {
    const C = this.ctx;
    C.restart();
    C.state.running = this.mode === 'play';
    this.select(this.sel);
  }
  duplicate() {
    const C = this.ctx, o = C.scene.objects[this.sel];
    if (!o) return;
    this.snapshot();
    const c = JSON.parse(JSON.stringify(o));
    c.x = +Math.min(C.scene.world.size[0], c.x + 1).toFixed(2);
    c.z = +Math.min(C.scene.world.size[2], c.z + 1).toFixed(2);
    C.scene.objects.push(c);
    this.sel = C.scene.objects.length - 1;
    this.rebuild();
  }
  remove() {
    const C = this.ctx;
    if (!C.scene.objects[this.sel]) return;
    this.snapshot();
    C.scene.objects.splice(this.sel, 1);
    this.sel = -1;
    this.rebuild();
  }

  key(e) {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    const C = this.ctx;
    if (C.walk.active) return;
    // modes: P play, E edit, R rig (not while typing; not in the rig's own stage keys)
    if (!e.ctrlKey && !e.metaKey && !e.altKey && this.mode !== 'rig' && this.mode !== 'camp') {
      if (e.code === 'KeyP' && this.mode !== 'play') return this.setMode('play');
      if (e.code === 'KeyE' && this.mode !== 'edit') return this.setMode('edit');
      if (e.code === 'KeyR' && this.mode === 'edit') return this.setMode('rig', this.rigTarget());
    }
    if (this.mode !== 'edit') return;
    if (e.code === 'Escape') {
      if (this.placing) {
        this.placing = null;
        C.view.renderer.domElement.style.cursor = '';
        this.setHint(null);
      } else this.select(-1);
    } else if (e.code === 'Delete' || e.code === 'Backspace') {
      if (this.sel >= 0) (e.preventDefault(), this.remove());
    } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyD') {
      e.preventDefault();
      this.duplicate();
    } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
      e.preventDefault();
      e.shiftKey ? this.doRedo() : this.doUndo();
    } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
      e.preventDefault();
      this.doRedo();
    } else if (e.code === 'KeyW' || e.code === 'KeyG') {
      this.gizmoMode = 'translate';
      this.placeGizmo();
      this.refresh();
    } else if (e.code === 'KeyT') {
      this.gizmoMode = 'rotate';
      this.placeGizmo();
      this.refresh();
    }
  }
}
