import * as THREE from 'three';
import { lod } from './lod.js';
import { VoxelRenderer, shadeVoxel } from './voxels.js';
import { PropsRenderer } from './props.js';
import { TreeRenderer } from './trees.js';
import { VehicleRenderer } from './vehicles.js';
import { VolcanoRenderer } from './volcano.js';
import { WaterworksRenderer } from './waterworks.js';
import { TorchRenderer } from './torches.js';
import { DoorRenderer } from './doors.js';
import { F_HIDDEN } from '../sim/world.js';

/**
 * The places of a world you are not in, drawn as they are (the island seen from the flight deck:
 * its church, trees, house, volcano), with level of detail (render/lod.js) by their size on the
 * screen. Each from its frozen world (visited and left, or built ahead: sim/prebuild.js): drawn,
 * never simulated, its colours as they were when it froze.
 *
 *  - level 2 (small on the screen): the stand-in columns (render/proxies.js), or its placeholder
 *    before its world is built;
 *  - level 1: its surface as coarse voxels (several merged into one, ~0.5–0.8 m, coloured as the
 *    top voxel in each), and its objects: props (the church, the hull, statues), trees, parked
 *    jets, volcanoes, each with its own level of detail as when you are there;
 *  - level 0 (large on the screen: close by): its voxels in full (the voxel renderer, shaded
 *    once), its torches and candles and doors too. At most `lod.budgets.place` places at once
 *    (one: a full voxel world is tens of MB on the GPU); the others stay at level 1.
 *
 * None of it casts shadows (the sun's shadow map is fitted to the place you are in).
 *
 * The boundaries have hysteresis (lod.js), and what is built for a level is kept a while after
 * leaving it (no rebuilding on a camera going back and forth). Building is spread over frames
 * (a few ms each), the coarse surface in slices; until it is ready the level below is shown.
 */
export const PLACE_LOD = [
  [460, 340], // full detail above ~400 px (radius of the place on the screen), back below ~340
  [44, 32], // coarse voxels and objects above ~38 px
];
lod.budgets.place ??= 1;

const KEEP_OBJECTS = 8; // s an unused level's meshes are kept (then freed)
const KEEP_FULL = 4;

export class PlaceScenery {
  constructor(parent) {
    this.group = new THREE.Group();
    parent.add(this.group);
    this.items = new Map(); // place name -> item
    this.jobs = []; // generators, run a few ms a frame
    this.sliceMs = 4;
    this.enabled = true;
    this.coarseMat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
    this.box = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5);
    this.time = 0;
    this.stats = { places: 0, levels: [0, 0, 0], coarse: 0, full: 0, jobs: 0 };
  }

  /**
   * Once a frame, after lod.begin: the places (the stand-ins' list, render/proxies.js: each
   * `it.zone` = { name, offset, world, size, sea }) and the view (its sun, season, voxel mode).
   */
  update(proxies, view, dt) {
    this.time += dt;
    const seen = new Set();
    const st = this.stats;
    st.levels.fill(0);
    st.coarse = st.full = 0;
    if (this.enabled)
      for (const [name, p] of proxies.items) {
        const z = p.zone;
        if (!z?.world) continue;
        seen.add(name);
        let it = this.items.get(name);
        if (it && it.world !== z.world) {
          this.drop(it);
          it = null;
        }
        if (!it) {
          it = { name, world: z.world, group: new THREE.Group(), state: {}, sea: z.sea ?? 0, coarse: null, objects: null, full: null, used: { objects: 0, full: 0 } };
          this.group.add(it.group);
          this.items.set(name, it);
        }
        it.group.position.set(...z.offset);
        // (drawn as it looks at any distance its level allows: far off the places overlay
        // outlines it instead of filling its box, render/places.js; only its stand-in gives way)
        this.place(it, z, view, dt);
        proxies.setCovered(name, it.shows);
      }
    for (const [name, it] of this.items)
      if (!seen.has(name)) {
        this.drop(it);
        this.items.delete(name);
      }
    this.runJobs();
    st.places = this.items.size;
    st.jobs = this.jobs.length;
  }

  place(it, z, view, dt) {
    const [sx, sy, sz] = z.world.size;
    const o = z.offset;
    // its size on the screen: half its diagonal (a flat island: mostly its footprint)
    const r = 0.5 * Math.hypot(sx, sz, sy * 0.5);
    const lv = lod.level(it.state, o[0] + sx / 2, o[1] + sy * 0.3, o[2] + sz / 2, r, PLACE_LOD, 'place');
    it.level = lv;
    this.stats.levels[lv]++;
    const t = this.time;
    if (lv <= 1) it.used.objects = t;
    if (lv === 0) it.used.full = t;
    // what each level needs, built in the background (level 1's coarse surface and objects
    // first: they are what is seen on the way in)
    if (lv <= 1 && !it.coarse) this.startCoarse(it);
    if (lv <= 1 && !it.objects) this.startObjects(it, view);
    if (lv === 0 && !it.full && it.objects?.ready) this.startFull(it, view);
    // freed a while after they are no longer needed
    if (it.full && t - it.used.full > KEEP_FULL) this.dropFull(it);
    if (it.objects && t - it.used.objects > KEEP_OBJECTS) this.dropObjects(it);
    // what is drawn: the finest that is ready (else the stand-in, render/proxies.js)
    const full = lv === 0 && it.full?.ready;
    const coarse = lv <= 1 && !full && it.coarse?.ready;
    const objects = lv <= 1 && it.objects?.ready && (full || coarse);
    if (it.coarse?.mesh) it.coarse.mesh.visible = !!coarse;
    if (it.full) it.full.group.visible = !!full;
    if (it.objects) it.objects.group.visible = !!objects;
    it.shows = !!(full || coarse);
    it.group.visible = it.shows;
    if (full) this.stats.full++;
    if (coarse) this.stats.coarse++;
    if (!it.shows) return;
    // their own levels of detail, with the camera in the place's own coordinates
    this.local(o, () => {
      if (objects) {
        const ob = it.objects;
        const cam = lod.cam;
        ob.props.update(dt);
        const season = view.season ?? 'summer';
        const snow = view.snowCover ?? 0;
        if (ob.trees.season.name !== season || ob.trees.season.snow !== snow) ob.trees.setSeason(season, snow);
        ob.trees.update(view.time ?? t, cam);
        // (the grass only in full: thousands of tufts, ~2 M triangles on the island, that are a
        // green blur at the coarse level, which its voxels' colour already gives)
        for (const g of ob.trees.items) if (g.grass) for (const m of g.meshes) m.visible = !!full;
        ob.vehicles.update(t);
        ob.volcanoes.update(t);
        ob.waterworks.update(dt, t); // (the fall, the river and the wheels go on: as they were when it froze)
        // (no shadows from a place you are not in: the sun's shadow map is fitted to where you are,
        // and drawing the church into it again doubles its cost; now and then: the jets come later)
        if ((ob.unshadowed = (ob.unshadowed ?? 0) - 1) < 0) {
          ob.unshadowed = 120;
          ob.group.traverse((m) => {
            if (!m.isMesh) return;
            m.castShadow = false;
            if (m.userData.lodShadow !== undefined) m.userData.lodShadow = false; // (props.js: what its level of detail restores)
          });
        }
      }
      if (full) {
        const f = it.full;
        // (frozen: shaded once, and again only if something changed it: a rocket from the jet)
        if (f.voxels.version !== it.world.geomVersion || f.voxels.mode !== view.voxels.mode) {
          f.voxels.mode = view.voxels.mode;
          f.voxels.update(t);
          finishStatic(f.voxels.mesh);
        }
        f.torches.update(t);
        f.doors.update(dt);
      }
    });
  }

  /** Run fn with the level-of-detail camera in a place's own coordinates (its origin at `o`). */
  local(o, fn) {
    const cam = lod.cam;
    const inView = lod.inView;
    if (cam) lod.cam = [cam[0] - o[0], cam[1] - o[1], cam[2] - o[2]];
    if (inView) lod.inView = (x, y, z, r) => inView(x + o[0], y + o[1], z + o[2], r);
    try {
      fn();
    } finally {
      lod.cam = cam;
      lod.inView = inView;
    }
  }

  startCoarse(it) {
    it.coarse = { ready: false, mesh: null };
    const c = it.coarse;
    this.jobs.push(coarseSurface(it.world, it.sea, this.box, this.coarseMat, (mesh) => {
      if (it.coarse !== c) return mesh.dispose();
      c.mesh = mesh;
      c.ready = true;
      it.group.add(mesh);
    }, () => it.coarse === c));
  }

  startObjects(it, view) {
    const ob = { ready: false, group: new THREE.Group() };
    it.objects = ob;
    it.group.add(ob.group);
    const w = it.world;
    const alive = () => it.objects === ob;
    this.jobs.push(
      (function* () {
        // (TreeRenderer.setWorld bumps the world's geometry version: that is ours, not a change)
        const v = w.geomVersion;
        ob.props = new PropsRenderer(ob.group);
        ob.props.sunLight = null; // (stained glass: lit as by a steady sun, not the active place's light)
        ob.props.sunDir = new THREE.Vector3(...(w.sunDir ?? view.sunDir ?? [0.6, 1.2, 0.4])).normalize();
        ob.props.setWorld(w);
        yield;
        if (!alive()) return;
        ob.trees = new TreeRenderer(ob.group);
        ob.trees.setWorld(w);
        w.geomVersion = v;
        yield;
        if (!alive()) return;
        ob.vehicles = new VehicleRenderer(ob.group);
        ob.vehicles.setWorld(w);
        ob.volcanoes = new VolcanoRenderer(ob.group);
        ob.volcanoes.setWorld(w);
        ob.waterworks = new WaterworksRenderer(ob.group, { live: false });
        ob.waterworks.setWorld(w);
        ob.ready = true;
      })(),
    );
  }

  startFull(it, view) {
    const f = { ready: false, group: new THREE.Group() };
    it.full = f;
    it.group.add(f.group);
    const w = it.world;
    const alive = () => it.full === f;
    this.jobs.push(
      (function* () {
        f.voxels = new VoxelRenderer(f.group);
        f.voxels.mode = view.voxels.mode;
        f.voxels.setWorld(w);
        f.voxels.update(0);
        finishStatic(f.voxels.mesh);
        yield;
        if (!alive()) return;
        f.torches = new TorchRenderer(f.group);
        f.torches.setWorld(w);
        f.doors = new DoorRenderer(f.group);
        f.doors.setWorld(w);
        f.ready = true;
      })(),
    );
  }

  /** The background jobs, a few ms a frame (at least one step, so each moves on). */
  runJobs() {
    const t0 = performance.now();
    while (this.jobs.length && performance.now() - t0 < this.sliceMs) {
      const j = this.jobs[0];
      if (j.next().done) this.jobs.shift();
    }
  }

  dropFull(it) {
    if (!it.full) return;
    it.group.remove(it.full.group);
    it.full.voxels?.mesh?.geometry.dispose();
    it.full.voxels?.material.dispose();
    disposeTree(it.full.group);
    it.full = null;
  }

  dropObjects(it) {
    if (!it.objects) return;
    it.group.remove(it.objects.group);
    disposeTree(it.objects.group);
    it.objects = null;
  }

  drop(it) {
    this.dropFull(it);
    this.dropObjects(it);
    it.coarse?.mesh?.dispose(); // (its box and material are shared)
    it.coarse = null;
    this.group.remove(it.group);
  }

  /** Forget everything (a new scene). */
  clear() {
    for (const it of this.items.values()) this.drop(it);
    this.items.clear();
    this.jobs.length = 0;
  }
}

/** A voxel mesh that no longer changes: no shadow of its own (far off), culled by its bounds. */
function finishStatic(mesh) {
  if (!mesh) return;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  mesh.frustumCulled = true;
}

function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.isInstancedMesh) o.dispose();
    o.geometry?.dispose();
    for (const m of [].concat(o.material ?? [])) {
      m.map?.dispose();
      m.dispose();
    }
  });
}

/**
 * The coarse surface of a world (a generator: one slice a step): cells of k³ voxels (~0.5–0.8 m),
 * solid if any voxel in them is (as drawn: not the hidden ones, which are meshes), drawn where
 * one of their sides is open, coloured as the topmost voxel in them; none wholly under the sea.
 */
export function* coarseSurface(w, sea, box, mat, done, alive = () => true) {
  const { nx, ny, nz, h, mat: M, flags } = w;
  const k = Math.max(2, Math.round(0.5 / h));
  const cx = Math.ceil(nx / k);
  const cy = Math.ceil(ny / k);
  const cz = Math.ceil(nz / k);
  const rep = new Int32Array(cx * cy * cz).fill(-1); // the cell's topmost voxel
  if (w.listDirty) w.rebuildLists();
  const solids = w.solids;
  const n = w.solidCount;
  const STEP = 120000;
  for (let s = 0; s < n; s += STEP) {
    const e = Math.min(n, s + STEP);
    for (let q = s; q < e; q++) {
      const i = solids[q];
      if (!M[i] || flags[i] & F_HIDDEN) continue;
      const x = i % nx;
      const r = (i - x) / nx;
      const y = r % ny;
      const z = (r - y) / ny;
      const c = ((x / k) | 0) + cx * (((y / k) | 0) + cy * ((z / k) | 0));
      const p = rep[c];
      if (p < 0 || y > ((p / nx) | 0) % ny) rep[c] = i;
    }
    yield;
    if (!alive()) return;
  }
  const cells = [];
  const cxy = cx * cy;
  const minTop = (sea ?? 0) - 0.6; // (wholly under the sea: not seen)
  for (let z = 0; z < cz; z++) {
    for (let y = 0; y < cy; y++)
      for (let x = 0; x < cx; x++) {
        const c = x + cx * (y + cy * z);
        if (rep[c] < 0) continue;
        if ((y + 1) * k * h < minTop) continue;
        const open =
          x === 0 || x === cx - 1 || z === 0 || z === cz - 1 || y === cy - 1 ||
          rep[c - 1] < 0 || rep[c + 1] < 0 || rep[c + cx] < 0 || (y > 0 && rep[c - cx] < 0) || rep[c - cxy] < 0 || rep[c + cxy] < 0;
        if (open) cells.push(c);
      }
    if (z % 16 === 15) {
      yield;
      if (!alive()) return;
    }
  }
  const mesh = new THREE.InstancedMesh(box, mat, Math.max(1, cells.length));
  const m = new THREE.Matrix4();
  const col = new Float32Array(Math.max(1, cells.length) * 3);
  const glow = new Float32Array(col.length);
  const s = k * h;
  cells.forEach((c, j) => {
    const x = c % cx;
    const r = (c - x) / cx;
    const y = r % cy;
    const z = (r - y) / cy;
    m.makeScale(Math.min(s, w.size[0] - x * s), Math.min(s, w.size[1] - y * s), Math.min(s, w.size[2] - z * s));
    m.setPosition(x * s, y * s, z * s);
    mesh.setMatrixAt(j, m);
    shadeVoxel(w, rep[c], 0, 'realistic', col, glow, j * 3);
  });
  mesh.instanceColor = new THREE.InstancedBufferAttribute(col, 3);
  mesh.count = cells.length;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  mesh.userData.cell = s;
  done(mesh);
}
