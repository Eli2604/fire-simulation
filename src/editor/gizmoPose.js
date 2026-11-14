/**
 * The editor's gizmo and a scene object record ({ x, z, y, rotation, tiltX?, tiltZ? }), both
 * ways, without three.js (so it can be tested on its own).
 *
 * The gizmo's stand-in sits at the model's origin as models/voxelizer.js places it: (x, h + y, z)
 * for a numeric y (h: the ground layer, one voxel), on whatever is under it for y 'auto', on the
 * ground layer when y is missing. It turns as the voxelizer turns the model: Euler(tiltX,
 * rotation, tiltZ) in the order 'YXZ', in degrees in the record and radians on the gizmo.
 */

const DEG = 180 / Math.PI;

/** Degrees to [0, 360). */
export const norm360 = (d) => ((Math.round(d) % 360) + 360) % 360;
/** Degrees to (-180, 180]. */
export const norm180 = (d) => {
  const n = norm360(d);
  return n > 180 ? n - 360 : n;
};

/**
 * Where the stand-in goes for a record: { x, y, z, rx, ry, rz } (metres; radians).
 * `originY`: the height the voxelizer put the model's origin at (world.origins), if known.
 */
export function recordToPose(o, { h, originY } = {}) {
  const y = typeof o.y === 'number' ? h + o.y : originY ?? h;
  return { x: o.x, y, z: o.z, rx: (o.tiltX ?? 0) / DEG, ry: (o.rotation ?? 0) / DEG, rz: (o.tiltZ ?? 0) / DEG };
}

/**
 * The record fields for where the gizmo left the stand-in.
 *  pose:  { x, y, z, rx, ry, rz } (rx, ry, rz: Euler 'YXZ', radians)
 *  start: the pose when the drag began (a height only changes when the stand-in went up or down:
 *         moving an object that sits on the ground ('auto') sideways keeps it sitting)
 *  size:  the world's size [x, y, z]; h: its voxel size
 * Returns { x, z, y, rotation, tiltX, tiltZ } (y, tiltX, tiltZ: undefined = leave out).
 */
export function poseToRecord(o, pose, { start, size, h }) {
  const r2 = (v) => +v.toFixed(2);
  const out = {
    x: r2(Math.max(0, Math.min(size[0], pose.x))),
    z: r2(Math.max(0, Math.min(size[2], pose.z))),
    y: o.y,
    rotation: norm360(pose.ry * DEG),
  };
  const climbed = !start || Math.abs(pose.y - start.y) > 1e-3;
  // on whole voxels (as x and z are snapped by the voxelizer), so the model keeps its shape
  if (climbed) out.y = +(Math.round(Math.max(0, Math.min(size[1], pose.y - h)) / h) * h).toFixed(3);
  // a tilt only when there is one (an upright object's record stays as it was)
  out.tiltX = norm180(pose.rx * DEG) || undefined;
  out.tiltZ = norm180(pose.rz * DEG) || undefined;
  return out;
}

/** Write fields from poseToRecord onto a record (undefined: the field is removed). */
export function applyRecord(o, fields) {
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) delete o[k];
    else o[k] = v;
  }
  return o;
}
