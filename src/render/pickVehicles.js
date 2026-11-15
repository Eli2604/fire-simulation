import * as THREE from 'three';
import { raycastDrawn, toSim } from './pickThings.js';
import { boatVoxelAt, carVoxelAt, personAt } from '../sim/inspectVehicles.js';

/** See-through (a car's windows): clicked through, to who sits behind them. */
const glass = (m) => !!m.material?.transparent && (m.material.opacity ?? 1) < 0.7;

/**
 * Picking the boats and cars (render/pick.js asks `pick(ray, root)` of each drawing): what draws
 * them is a mesh of its own over their voxels (a moving body, sim/movingBody.js: hidden, or
 * snapped from cell to cell behind the smooth mesh), so a click on the mesh is mapped to the body's
 * voxel there (sim/inspectVehicles.js: the hit into the body's frame at its pose now, the nearest
 * of its voxels still there) and names the boat or the car; the people seated in them (drawn by
 * render/boatCrew.js, render/cars.js, render/enemies.js) are boxes round their seats.
 *
 *   const P = vehiclePicker({ floats, cars })   // render/floats.js FloatRenderer, render/cars.js CarRenderer
 *   P.pick(ray, root) → { distance, point, normal, voxel, thing } | null
 *       thing: { kind: 'boat', index, k } (its hull, oars, sail, mast, outboard)
 *              { kind: 'car', index, k } (its mesh on the move, the wheels, the steering wheel)
 *              { kind: 'person', vehicle, index, seat, crew }
 */
export function vehiclePicker({ floats = null, cars = null } = {}) {
  return {
    floats,
    cars,
    pick(ray, root) {
      const w = floats?.world ?? cars?.world;
      if (!w) return null;
      let best = null;
      const take = (h) => {
        if (h && (!best || h.distance < best.distance)) best = h;
      };
      // the boats: the hull, its oars, the rig, the outboard (the mesh's group, as drawn)
      for (const it of floats?.items ?? []) {
        if (it.gone) continue; // (burnt down: what is left of it shows as voxels)
        const h = raycastDrawn(ray, it.m.group);
        if (!h) continue;
        const index = w.floats?.indexOf(it.f) ?? -1;
        if (index < 0) continue;
        const v = boatVoxelAt(w, it.f, toSim(root, h.point));
        take({ ...h, voxel: v?.cell ?? -1, thing: { kind: 'boat', index, k: v?.k ?? -1, cell: v?.cell ?? -1 } });
      }
      // the cars: their mesh on the move, every car's steering wheel
      const carHit = (c, obj) => {
        const h = raycastDrawn(ray, obj, { skip: glass });
        if (!h) return;
        const index = w.cars?.indexOf(c) ?? -1;
        if (index < 0) return;
        const v = carVoxelAt(w, c, toSim(root, h.point));
        take({ ...h, voxel: v?.cell ?? -1, thing: { kind: 'car', index, k: v?.k ?? -1, cell: v?.cell ?? -1 } });
      };
      for (const [c, m] of cars?.items ?? []) carHit(c, m.group);
      for (const [c, sw] of cars?.wheels ?? []) carHit(c, sw.root);
      // the people in them: a box round each seat (in the sim frame, then back to the world)
      const inv = root ? new THREE.Matrix4().copy(root.matrixWorld).invert() : null;
      const o = ray.origin.clone();
      const d = ray.direction.clone();
      if (inv) {
        o.applyMatrix4(inv);
        d.transformDirection(inv);
      }
      const p = personAt(w, [o.x, o.y, o.z], [d.x, d.y, d.z]);
      if (p) {
        const pw = new THREE.Vector3(...p.point);
        if (root) pw.applyMatrix4(root.matrixWorld);
        // (in front of the hull or the car's body he wins; seen through its windows too: glass is not picked)
        const dist = ray.origin.distanceTo(pw);
        if (!best || dist < best.distance + 0.05) best = { distance: dist, point: pw, normal: d.clone().negate(), voxel: -1, thing: p.thing };
      }
      return best;
    },
  };
}
