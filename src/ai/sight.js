/**
 * Walking a line of sight voxel by voxel (Amanatides & Woo): every voxel the segment from a to
 * b passes through, in order, with the length of the segment in it. Sampling the line at
 * steps instead misses a thin wall or roof met at a slant (a single course of tiles, the
 * corner of two stones): a dragon on the hill saw in through the church roof that way.
 *
 * `visit(i, len, t)` gets the voxel index (or -1 outside the world), the length of the line
 * in it and how far along it is (0..1); return true to stop. Returns whether it was stopped.
 * The voxels holding a and b themselves are skipped (the eye and what it looks at).
 */
export function traceVoxels(w, a, b, visit) {
  const h = w.h;
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const L = Math.hypot(d[0], d[1], d[2]);
  if (L < 1e-6) return false;
  const cell = [Math.floor(a[0] / h), Math.floor(a[1] / h), Math.floor(a[2] / h)];
  const end = [Math.floor(b[0] / h), Math.floor(b[1] / h), Math.floor(b[2] / h)];
  const step = [0, 0, 0];
  const tMax = [Infinity, Infinity, Infinity];
  const tDelta = [Infinity, Infinity, Infinity];
  for (let k = 0; k < 3; k++) {
    if (d[k] > 0) {
      step[k] = 1;
      tMax[k] = ((cell[k] + 1) * h - a[k]) / d[k];
      tDelta[k] = h / d[k];
    } else if (d[k] < 0) {
      step[k] = -1;
      tMax[k] = (cell[k] * h - a[k]) / d[k];
      tDelta[k] = -h / d[k];
    }
  }
  let t = 0;
  const { nx, ny, nz } = w;
  for (let guard = 0; guard < 100000; guard++) {
    // into the next voxel along the axis whose boundary comes first
    const k = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : tMax[1] < tMax[2] ? 1 : 2;
    const t1 = Math.min(1, tMax[k]);
    if (t1 >= 1) return false;
    cell[k] += step[k];
    tMax[k] += tDelta[k];
    t = t1;
    if (cell[0] === end[0] && cell[1] === end[1] && cell[2] === end[2]) return false;
    const next = Math.min(1, tMax[0], tMax[1], tMax[2]);
    const [x, y, z] = cell;
    const i = x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz ? -1 : x + nx * (y + ny * z);
    if (visit(i, (next - t) * L, t)) return true;
  }
  return false;
}
