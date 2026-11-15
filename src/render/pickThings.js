import * as THREE from 'three';
import { F_HIDDEN } from '../sim/world.js';

/**
 * Picking what is drawn by meshes of its own (render/pick.js asks each drawing's `pick(ray)`):
 * the church's timber and glass, wall torches, doors, the volcano's cone, the camp's wind
 * turbine and solar park, the carrier's hull. Some of it stands over hidden voxels (the click
 * is mapped back to the voxel nearest the hit), some is drawn only or simulated apart (a
 * turbine's rotor, an open door, the hull that floats by sim/buoyancy.js): those hits carry a
 * `thing` that the inspector describes from its own simulated state (sim/inspectThings.js).
 *
 * Plain three.js maths, no WebGL: the tests raycast these as the app does.
 */

const _rc = new THREE.Raycaster();

/** Drawn: it and every parent visible. */
export function shown(o) {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/**
 * The nearest hit of a world-space THREE.Ray on the meshes under `obj` that are drawn (sprites,
 * light patches and shafts – `userData.noShadow` / `noPick` – left out): { distance, point,
 * normal (world, towards the ray), object } or null.
 */
export function raycastDrawn(ray, obj, { skip = null } = {}) {
  if (!obj || !shown(obj)) return null;
  _rc.ray.copy(ray);
  _rc.near = 0;
  _rc.far = Infinity;
  let best = null;
  obj.traverseVisible((m) => {
    if (!m.isMesh || m.isSprite || m.userData.noShadow || m.userData.noPick || (skip && skip(m))) return;
    // (a mesh's own raycast: instanced meshes too)
    const hits = [];
    m.raycast(_rc, hits);
    for (const h of hits) {
      if (best && h.distance >= best.distance) continue;
      const n = h.face ? h.face.normal.clone().transformDirection(m.matrixWorld) : ray.direction.clone().negate();
      if (n.dot(ray.direction) > 0) n.negate();
      best = { distance: h.distance, point: h.point.clone(), normal: n, object: m };
    }
  });
  return best;
}

/**
 * The voxel nearest a point (the sim frame, m) within `r` m that `ok(i)` accepts (default: any
 * that is there and hidden – drawn by a mesh, as what was clicked is), or -1.
 */
export function nearestVoxel(world, p, r, ok = null) {
  if (!world) return -1;
  const h = world.h;
  const accept = ok ?? ((i) => world.mat[i] && world.flags[i] & F_HIDDEN);
  const lo = p.map((v) => Math.floor((v - r) / h));
  const hi = p.map((v) => Math.floor((v + r) / h));
  let best = -1;
  let bd = r * r;
  for (let z = lo[2]; z <= hi[2]; z++)
    for (let y = lo[1]; y <= hi[1]; y++)
      for (let x = lo[0]; x <= hi[0]; x++) {
        if (!world.inBounds(x, y, z)) continue;
        const i = world.idx(x, y, z);
        if (!accept(i)) continue;
        const dx = (x + 0.5) * h - p[0];
        const dy = (y + 0.5) * h - p[1];
        const dz = (z + 0.5) * h - p[2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d <= bd) {
          bd = d;
          best = i;
        }
      }
  return best;
}

/** The voxel of a list nearest a point (the sim frame), of those still there (`ok`), or -1. */
export function nearestOf(world, list, p, ok = (i) => world.mat[i]) {
  let best = -1;
  let bd = Infinity;
  for (const i of list ?? []) {
    if (!ok(i)) continue;
    const [x, y, z] = world.center(...world.coords(i));
    const d = (x - p[0]) ** 2 + (y - p[1]) ** 2 + (z - p[2]) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** A world point into the sim frame (the parent the drawings hang from, `frame`: an Object3D or null). */
export function toSim(frame, p) {
  const q = p.clone();
  if (frame) frame.worldToLocal(q);
  return [q.x, q.y, q.z];
}

/**
 * A hit for render/pick.js on an object drawn under `frame` (the sim's root, as pick.js hands it
 * to a drawing's pick(ray, root)): the voxel there
 * (`voxelOf(simPoint)`, -1 for none) and what it is (`thing`).
 */
export function pickObject(ray, obj, frame, voxelOf, thing) {
  const h = raycastDrawn(ray, obj);
  if (!h) return null;
  const p = toSim(frame, h.point);
  const voxel = voxelOf ? voxelOf(p, h) : -1;
  return { ...h, voxel, thing: typeof thing === 'function' ? thing(h, voxel) : thing };
}
