/**
 * The director: puts the view's camera where a world camera (models/camera.js) is, with its lens
 * and its look (render/cinePost.js), following and looking at what it is set to (cinema/aim.js),
 * and plays a sequence of a place's movie (its timeline of clips: cinema/timeline.js) in Play —
 * the UI hidden, the simulation running, the cameras cut and dissolved per the clips (at movie
 * or simulation time), Esc stops it; optionally recorded to a video file (MediaRecorder).
 *
 * Four ways to be active:
 *   look      Edit world: through one camera at a time in its move (the panel's scrub)
 *   preview   Edit world: one camera's move played (the world stands still)
 *   sequence  Edit world: a sequence at the timeline's playhead, or played from it (world still)
 *   movie     a sequence, in Play
 * The view calls update(dt) before it draws and afterRender() after (render/view.js); when not
 * active neither does anything.
 */
import * as THREE from 'three';
import { flattenObjects } from '../models/composite.js';
import { MODELS } from '../models/index.js';
import { lensOf, lensView, SENSORS, FRAMES, cocScalePx } from './lens.js';
import { exposureGain, whiteBalanceGains, gradeUniforms, motionBlurHistory, shake } from './look.js';
import { evalCamera, basePose, subjectsOf, smoothTowards, moveDuration } from './rig.js';
import { resolveTargets, objectTargets, framingOf, frameTarget } from './aim.js';
import { migrateMovie, sequenceOf, clipAt, sequenceDuration, clockToMovie } from './timeline.js';
import { CinePost } from '../render/cinePost.js';

/** The effect values a key can carry (models/camera.js keyEffects). */
export const FX_KEYS = ['exposure', 'whiteBalance', 'tint', 'gradeAmount', 'grain', 'vignette', 'chromatic', 'distortion', 'bloom', 'streaks', 'shake'];

const DEG = Math.PI / 180;

/** A camera's parameters with every default. */
export function cameraParams(node) {
  const out = {};
  for (const [k, s] of Object.entries(MODELS.camera.params)) out[k] = node.params?.[k] ?? s.value;
  return out;
}

/** The cameras of a scene's current world: [{ node, index, name, params, keys, base }]. */
export function camerasOf(scene, world) {
  const out = [];
  if (!scene) return out;
  const flat = flattenObjects(scene.objects ?? []);
  flat.forEach((e, i) => {
    if (e.node.type !== 'camera') return;
    // (a camera of the scene itself: as it is now, so turning it needs no new world; in another
    // object: where the world put it)
    const own = e.parent < 0 && typeof e.node.y === 'number';
    const rec = own ? e.node : world?.objectTree?.[i]?.rec ?? e.node;
    const originY = own ? (world?.h ?? 0) + e.node.y : world?.origins?.[i]?.[1] ?? (world?.h ?? 0) + (typeof rec.y === 'number' ? rec.y : 1.6);
    const params = cameraParams(e.node);
    const n = e.node;
    // its path: its own, or another camera's (pathFrom: that camera's name; several share one)
    const from = n.pathFrom ? flat.find((q) => q.node.type === 'camera' && q.node !== n && (q.node.params?.name ?? MODELS.camera.params.name.value) === n.pathFrom)?.node : null;
    const path = from?.path ?? n.path ?? null;
    out.push({ node: n, index: i, name: params.name, params, keys: n.keys ?? [], base: basePose(rec, originY), follow: n.follow ?? '', lookAt: n.lookAt ?? '', lookOffset: n.lookOffset ?? null, aimPoint: n.aimPoint ?? null, aimDist: n.aimDist ?? 10, path, pathNode: from ?? n });
  });
  return out;
}

/**
 * What cameras can follow and look at in a scene's world: its moving things (rig.js subjectsOf)
 * and its named objects (aim.js objectTargets).
 */
export function targetsOf(scene, world) {
  const out = subjectsOf(world);
  if (scene) out.push(...objectTargets(flattenObjects(scene.objects ?? []), world?.origins, (world?.objectTree ?? []).map((e) => e?.rec)));
  return out;
}

/**
 * Everything the camera gives at time t: its pose (world-local), its lens on the canvas and the
 * look's settings for render/cinePost.js. subject: from the world (rig.js subjectsOf); dt: the
 * frame time (motion blur); widthPx: the drawing buffer's width.
 */
export function cameraFrame(cam, t, { subject = null, look = null, carrier = null, canvasAspect = 16 / 9, widthPx = 1920, dt = 1 / 60, clock = 0, motion = true } = {}) {
  const P = cam.params;
  const E = evalCamera(cam, t, subject, { look, carrier });
  const fx = (k) => E.fx?.[k] ?? P[k];
  const L = lensOf(P.lens);
  const squeeze = L.squeeze ?? 1;
  const frame = P.letterbox === 'lens' ? (L.letterbox ? FRAMES[L.letterbox] : 0) : FRAMES[P.letterbox] ?? 0;
  const sensor = SENSORS[P.sensor] ?? SENSORS['Super 35'];
  const lv = lensView({ focal: E.focal, sensor, squeeze, frame, canvasAspect, fisheye: L.kind === 'fisheye' });
  // framing (cinema/aim.js): what it looks at kept at a third of the frame, not in the middle
  const [fx0, fy0] = framingOf(P);
  if (E.lookPoint && (fx0 || fy0)) E.target = frameTarget(E.pos, E.lookPoint, fx0, fy0, lv.hFov, lv.frameAspect);
  const G = gradeUniforms(P.grade, fx('gradeAmount'));
  const frameW = widthPx * (1 - 2 * lv.bars.x);
  const cocScale = P.dof ? cocScalePx({ focal: E.focal, fstop: E.fstop, focus: E.focus, sensorWidth: sensor.w, widthPx: frameW, squeeze }) : 0;
  const maxCoc = Math.min(28 * (widthPx / 1920) + 4, cocScale * 1.5);
  const settings = {
    dof: P.dof ? { focus: E.focus, cocScale, maxCoc, oval: L.kind === 'anamorphic' ? 0.6 : 1 } : null,
    bloom: fx('bloom'),
    motion: motion ? motionBlurHistory(P.shutter, P.fps, dt) : 0,
    time: clock,
    final: {
      gainExp: exposureGain({ exposure: fx('exposure') + G.exposure, auto: P.autoExposure, iso: P.iso, fstop: E.fstop, shutter: P.shutter, fps: P.fps }),
      wb: whiteBalanceGains(fx('whiteBalance'), fx('tint')),
      lift: G.lift,
      gamma: G.gamma,
      gain: G.gain,
      sat: G.sat,
      contrast: G.contrast,
      mono: G.mono,
      bleach: G.bleach,
      nightVision: G.nightVision,
      grain: fx('grain') + G.nightVision * 0.25,
      vignette: fx('vignette'),
      chromatic: fx('chromatic'),
      distortion: (L.distortion ?? 0) + fx('distortion'),
      streaks: fx('streaks') + (L.kind === 'anamorphic' ? 0.35 : 0),
      bars: [lv.bars.x, lv.bars.y],
      frameAspect: lv.frameAspect,
    },
  };
  return { E, lv, settings, thermal: G.thermal, shake: fx('shake') };
}

export class Director {
  constructor(ctx) {
    this.ctx = ctx;
    this.view = ctx.view;
    this.view.cinema = this;
    this.active = false;
    this.kind = null;
    this.t = 0;
    this.clock = 0;
    this.hideList = () => [];
    this._v = new THREE.Vector3();
    this._w = new THREE.Vector3();
    this.bar = document.createElement('div');
    this.bar.id = 'cineBar';
    this.bar.hidden = true;
    document.body.append(this.bar);
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.active) return;
        // (in a movie no other key does anything: the mode keys, the tools)
        if (e.code !== 'Escape') {
          if (this.kind === 'movie' && !/^F\d/.test(e.code)) e.stopImmediatePropagation();
          return;
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        this.stop();
      },
      true,
    );
  }

  get post() {
    return (this._post ??= new CinePost(this.view.renderer));
  }

  cameras() {
    return camerasOf(this.ctx.scene, this.ctx.sim?.world);
  }
  cameraNamed(name) {
    const all = this.cameras();
    return all.find((c) => c.name === name) ?? null;
  }

  /** Begin being the view's camera (keeps what the view had, to give it back). */
  begin(kind, name) {
    const v = this.view;
    if (!this.active) {
      this.saved = { pos: v.camera.position.clone(), quat: v.camera.quaternion.clone(), up: v.camera.up.clone(), fov: v.camera.fov, controls: v.controls.enabled, hidden: new Map() };
    }
    this.active = true;
    this.kind = kind;
    this.name = name;
    this.smoothPos = this.smoothLook = null;
    this.shotIndex = -1;
    this.started = performance.now();
    v.controls.enabled = false;
    this.post.cut();
  }

  /** Look through a camera (by name) at time t of its move. */
  look(name, t = 0) {
    this.begin('look', name);
    this.t = t;
  }
  setTime(t) {
    this.t = t;
  }
  /** Play a camera's move (from t), round and round. */
  preview(name, t = 0) {
    this.begin('preview', name);
    this.t = t;
  }
  /**
   * Edit world: a sequence of the movie (cinema/timeline.js) at movie time t, through the camera
   * on then (the timeline's playhead); play: run it from there (the world stands still), round
   * and round.
   */
  lookSequence(seq, t = 0, play = false) {
    if (!(this.active && this.kind === 'sequence')) this.begin('sequence');
    this.seq = seq;
    this.t = t;
    this.playing = play;
  }

  /**
   * Play a sequence of the movie of where you are (by name or number; none: the one set to play;
   * an old shot list is played as its timeline); record: to a video file too.
   */
  async playMovie({ record = false, sequence = undefined } = {}) {
    const C = this.ctx;
    const movie = migrateMovie(C.place()?.movie);
    const seq = sequenceOf(movie, sequence);
    if (!seq?.clips?.length) {
      alert('The movie has no clips yet: put cameras on the timeline in the 🎬 Movie panel.');
      return;
    }
    if (this.active) this.stop();
    if (C.walk?.active) C.walk.exit();
    this.prevMode = C.editor.mode;
    if (C.editor.mode !== 'play') await C.editor.setMode('play'); // (from Edit world: the scene from its start)
    else if (seq.restart !== false) C.restart();
    C.state.running = true;
    this.prevTimeScale = C.state.timeScale;
    C.state.timeScale = seq.simSpeed ?? 1;
    this.seq = seq;
    this.simT0 = null;
    this.begin('movie');
    this.t = 0;
    document.body.classList.add('cinema');
    if (record) this.startRecording();
    this.say(`🎬 ${C.scene.name ?? 'Movie'} · ${seq.name} · ${Math.round(sequenceDuration(seq))} s · Esc stops`);
  }

  say(text, keep = false) {
    this.bar.textContent = text;
    this.bar.hidden = false;
    this.bar.classList.toggle('keep', keep);
    clearTimeout(this.barTimer);
    if (!keep) this.barTimer = setTimeout(() => (this.bar.hidden = true), 3000);
  }

  stop() {
    if (!this.active) return;
    const C = this.ctx, v = this.view;
    const kind = this.kind;
    this.active = false;
    this.kind = null;
    this.bar.hidden = true;
    const s = this.saved;
    if (s) {
      v.camera.position.copy(s.pos);
      v.camera.quaternion.copy(s.quat);
      v.camera.up.copy(s.up);
      v.camera.fov = s.fov;
      v.camera.updateProjectionMatrix();
      v.controls.enabled = s.controls;
      for (const [o, vis] of s.hidden) o.visible = vis;
    }
    this.saved = null;
    this.restoreThermal();
    if (kind === 'movie') {
      document.body.classList.remove('cinema');
      C.state.timeScale = this.prevTimeScale ?? C.state.timeScale;
      this.stopRecording();
      if (this.prevMode === 'edit') C.editor.setMode('edit');
    }
    this.onStop?.(kind);
  }

  /* ---------------- recording ---------------- */
  startRecording() {
    const canvas = this.view.renderer.domElement;
    if (!canvas.captureStream || typeof MediaRecorder === 'undefined') {
      alert('This browser cannot record the canvas (no MediaRecorder): the movie plays without recording.');
      return;
    }
    const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported?.(t));
    const stream = canvas.captureStream(30);
    const rec = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 16e6 } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => e.data?.size && chunks.push(e.data);
    const name = (this.ctx.scene?.name ?? 'movie').replace(/[^\w\- ]+/g, '').trim() || 'movie';
    rec.onstop = () => {
      const type = rec.mimeType || 'video/webm';
      const blob = new Blob(chunks, { type });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${name}.${type.includes('mp4') ? 'mp4' : 'webm'}`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 20000);
    };
    rec.start(500);
    this.recorder = rec;
  }
  stopRecording() {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.recorder = null;
  }

  /* ---------------- each frame ---------------- */
  /** Before the view draws: which camera, at what time; the view's camera put there. */
  update(dt) {
    if (!this.active) return;
    this.clock += dt;
    // the editor's handles, the labels, the places' boxes: not in the picture
    for (const o of this.hideList()) {
      if (!o) continue;
      if (!this.saved.hidden.has(o)) this.saved.hidden.set(o, o.visible);
      o.visible = false;
    }
    let cam = null, t = this.t, blend = { dissolve: 0, black: 0 };
    if (this.kind === 'movie' || this.kind === 'sequence') {
      const seq = this.seq;
      if (this.kind === 'movie') {
        // the sequence's clock: the movie's own seconds, or the simulation's (as far as it got)
        const wt = this.ctx.sim?.world?.time;
        if (seq.clock === 'sim' && Number.isFinite(wt)) {
          if (this.simT0 == null || wt < this.simT0) this.simT0 = wt;
          this.t = clockToMovie(seq, wt - this.simT0);
        } else this.t += dt;
      } else if (this.playing) {
        this.t += dt;
        if (this.t > sequenceDuration(seq) + 0.5) this.t = 0;
        this.onSeqTime?.(this.t);
      }
      const s = clipAt(seq, this.t);
      if (s.done && this.kind === 'movie') {
        // (stopped after this frame, not while the view draws: going back to Edit rebuilds the world)
        if (!this.ending) this.ending = setTimeout(() => ((this.ending = null), this.stop()), 0);
        this.frameSettings = { black: 1 };
        return;
      }
      if (s.index !== this.shotIndex) {
        if (s.index > 0 && s.clip.transition === 'dissolve' && s.dissolve > 0) this.post.freeze();
        this.shotIndex = s.index;
        this.smoothPos = this.smoothLook = null;
        this.post.cut();
      }
      if (this.recorder) this.bar.textContent = `● REC  ${s.index + 1}/${seq.clips.length} ${s.clip?.camera ?? '—'} · ${this.t.toFixed(1)} s · Esc stops`;
      if (this.recorder) (this.bar.hidden = false), this.bar.classList.add('keep');
      if (!s.clip) {
        // (a gap between clips, before the first, after the last: black)
        this.frameSettings = { black: 1 };
        return;
      }
      cam = this.cameraNamed(s.clip.camera);
      t = s.local;
      blend = s;
    } else {
      cam = this.cameraNamed(this.name);
      if (this.kind === 'preview') {
        this.t += dt;
        const d = cam ? moveDuration(cam) || 8 : 8;
        if (this.t > d + 0.5) {
          this.t = 0;
          this.smoothPos = this.smoothLook = null;
          this.post.cut();
        }
        t = this.t;
        this.onTime?.(this.t);
      }
    }
    this.frameSettings = null;
    if (!cam) {
      // (a clip of a camera that is not here: black)
      this.frameSettings = { black: 1 };
      return;
    }
    this.apply(cam, t, dt, blend);
  }

  apply(cam, t, dt, blend) {
    const v = this.view;
    const P = cam.params;
    // what it follows and what it looks at (cinema/aim.js), the look eased in (its smoothing)
    const R = resolveTargets(cam, targetsOf(this.ctx.scene, this.ctx.sim?.world));
    let look = R.look;
    if (look && P.look === 'subject') look = this.smoothLook = smoothTowards(this.smoothLook, look, dt, P.lookLag);
    const size = v.renderer.getDrawingBufferSize(this._size ?? (this._size = new THREE.Vector2()));
    const F = cameraFrame(cam, t, { subject: R.follow, look, carrier: R.carrier, canvasAspect: v.camera.aspect, widthPx: size.x, dt, clock: this.clock, motion: this.kind !== 'look' });
    let pos = F.E.pos;
    let target = F.E.target;
    if (F.E.smooth) {
      pos = this.smoothPos = smoothTowards(this.smoothPos, pos, dt, P.lag);
      // (framed from where it is, not where it is going)
      const [fx, fy] = framingOf(P);
      if (F.E.lookPoint) target = fx || fy ? frameTarget(pos, F.E.lookPoint, fx, fy, F.lv.hFov, F.lv.frameAspect) : F.E.lookPoint;
    }
    const sh = shake(this.clock, F.shake, 1, cam.index);
    const c3 = v.camera;
    const wp = v.root.localToWorld(this._v.set(pos[0] + sh.pos[0], pos[1] + sh.pos[1], pos[2] + sh.pos[2]));
    const wt = v.root.localToWorld(this._w.set(...target));
    c3.position.copy(wp);
    c3.up.set(0, 1, 0);
    c3.lookAt(wt);
    c3.rotateY(sh.yaw);
    c3.rotateX(sh.pitch);
    c3.rotateZ(-F.E.roll * DEG + sh.roll);
    if (Math.abs(c3.fov - F.lv.fov) > 1e-4) {
      c3.fov = F.lv.fov;
      c3.updateProjectionMatrix();
    }
    c3.updateMatrixWorld();
    // the thermal grade: the voxels coloured by their heat, as Play's thermal camera (no smoke)
    if (F.thermal) this.setThermal();
    else this.restoreThermal();
    this.frameSettings = { ...F.settings, dissolve: blend.dissolve ?? 0, black: blend.black ?? 0 };
    this.lastFrame = F;
  }

  setThermal() {
    const v = this.view;
    if (this.thermalSaved) return;
    this.thermalSaved = { mode: v.voxels.mode, smoke: v.smoke.enabled };
    v.voxels.mode = 'thermal';
    v.smoke.enabled = false;
  }
  restoreThermal() {
    const s = this.thermalSaved;
    if (!s) return;
    this.view.voxels.mode = s.mode;
    this.view.smoke.enabled = s.smoke;
    this.thermalSaved = null;
  }

  /** After the view drew the frame: the camera's look over it. */
  afterRender() {
    if (!this.active || !this.frameSettings) return;
    const s = this.frameSettings;
    if (s.black === 1 && !s.final) {
      const r = this.view.renderer;
      const old = r.getClearColor(new THREE.Color());
      const alpha = r.getClearAlpha();
      r.setRenderTarget(null);
      r.setClearColor(0x000000, 1);
      r.clear();
      r.setClearColor(old, alpha);
      return;
    }
    this.post.render(this.view.scene, this.view.camera, s);
  }
}
