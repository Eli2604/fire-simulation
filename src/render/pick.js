import * as THREE from 'three';
import { clothPieces } from '../sim/cloth.js';

/**
 * What is under the pointer (View.pick: the inspector, the ignite / fire start / place tools,
 * the editor's selection): the voxel there, found through whatever draws it.
 *
 * Most voxels are drawn as themselves (the instanced voxel cubes, or the smooth surface), and
 * those are raycast. But a good deal of what burns is drawn by meshes of its own over hidden
 * voxels (F_HIDDEN, left out of the cubes), and a ray tested against the cubes alone went
 * straight through it to whatever stood behind:
 *  - the wash on the line, the scanned statues, candelabra and props (render/statue.js): their
 *    drawn triangles are raycast as drawn (cloth where the wind has it), each tied to its voxel;
 *  - trees and grass (render/trees.js): a bark segment is the voxels along it, a leaf card or a
 *    tuft of blades the voxel it stands in;
 *  - the church's timber, boards, pews and stained glass (render/church.js), wall torches and
 *    candles (render/torches.js), doors (render/doors.js), the volcano's cone
 *    (render/volcano.js), the camp's wind turbine, solar park and camp (render/campPower.js):
 *    the click is mapped to the hidden voxel there (render/pickThings.js) and names the thing
 *    it is part of;
 *  - what is drawn only or simulated apart (a turbine's rotor, an open door, the carrier's hull
 *    that floats by sim/buoyancy.js): a hit with no voxel (-1) but a `thing`, which the
 *    inspector describes from its own state (sim/inspectThings.js). Such a hit has to be a
 *    centimetre nearer than a voxel to win over it (a mesh drawn flush with voxels lets them be).
 * The nearest of them all wins. A hit on the laundry also names its garment (sim/cloth.js),
 * which the inspector describes as a whole.
 *
 * `raycaster`: set from the camera; `root`: the scene's root (the sim's frame); `drawings`:
 * anything with pick(ray, root) -> { distance, point, normal (world), voxel, thing? } | null;
 * returns { voxel (-1: a thing only), point (sim frame), normal, distance, cloth?: { prop, piece },
 * thing? } or null.
 */
export function pickScene(raycaster, { world, root, voxels, surface = null, drawings = [], trees = null }) {
  const ray = raycaster.ray;
  let best = null;
  const key = (h) => h.distance + (h.voxel >= 0 ? 0 : 0.01);
  const take = (h) => {
    if (h && (h.voxel >= 0 || h.thing) && (!best || key(h) < key(best))) best = h;
  };
  // the voxels drawn as themselves
  if (surface) {
    const h = surface.pick(raycaster);
    if (h) take({ ...h, distance: ray.origin.distanceTo(new THREE.Vector3(...h.point)) });
  } else if (voxels?.mesh) {
    const hit = raycaster.intersectObject(voxels.mesh, false)[0];
    if (hit) {
      const p = root.worldToLocal(hit.point.clone());
      take({ voxel: voxels.voxelOfInstance(hit.instanceId), point: [p.x, p.y, p.z], normal: hit.face ? [hit.face.normal.x, hit.face.normal.y, hit.face.normal.z] : [0, 1, 0], distance: hit.distance });
    }
  }
  // objects drawn over their hidden voxels (laundry, scans, the church, torches, doors...), or by themselves
  for (const d of drawings) {
    if (typeof d?.pick !== 'function') continue;
    const h = d.pick(ray, root);
    if (!h) continue;
    const p = root.worldToLocal(h.point.clone());
    const n = h.normal.clone().transformDirection(new THREE.Matrix4().copy(root.matrixWorld).invert());
    const out = { voxel: h.voxel ?? -1, point: [p.x, p.y, p.z], normal: [n.x, n.y, n.z], distance: h.distance };
    if (h.thing) out.thing = h.thing;
    if (d.pr?.procedural === 'laundry' && world) {
      const piece = clothPieces(world, d.pr, d.own).of.get(h.voxel);
      if (piece !== undefined) out.cloth = { prop: d.pr, piece };
    }
    take(out);
  }
  // trees and grass: bark segments, leaf cards, tufts of blades
  for (const it of trees?.items ?? []) {
    const parts = [
      [it.segMesh, (k) => it.segVox?.[k]?.find((i) => world?.mat[i]) ?? -1],
      [it.leafMesh, (k) => it.leaves?.[Math.floor(k / (it.cards || 1))] ?? -1],
    ];
    for (const [mesh, voxelOf] of parts) {
      if (!mesh || !shown(mesh)) continue;
      for (const hit of raycaster.intersectObject(mesh, false)) {
        const v = voxelOf(hit.instanceId);
        if (v < 0 || (world && !world.mat[v])) continue; // (burnt away: drawn no more)
        const p = root.worldToLocal(hit.point.clone());
        take({ voxel: v, point: [p.x, p.y, p.z], normal: hit.face ? [hit.face.normal.x, hit.face.normal.y, hit.face.normal.z] : [0, 1, 0], distance: hit.distance });
        break;
      }
    }
  }
  return best;
}

/** Drawn: it and every parent visible. */
function shown(o) {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
}
