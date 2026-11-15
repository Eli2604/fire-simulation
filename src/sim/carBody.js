import { F_BURNING, F_SMOLDER } from './world.js';
import { carRot } from './carPhysics.js';
import { makeMovingBody, restamp, syncBody, bodyLeft as left, releaseBody as release } from './movingBody.js';

/**
 * A car's voxels as a body of its own that moves with it (sim/cars.js): a moving body
 * (sim/movingBody.js, the same as a boat's), its voxels taken by their owner as the car stands,
 * carrying everything a voxel is (its material, temperature, fuel left, moisture, char, burning,
 * its vessel tag: the fuel tank and its petrol, its colour). So a burning car keeps burning as it
 * drives, its fire and smoke going with it, what has burnt away stays gone, a panel burnt loose
 * falls off it, its tank stays sealed as it turns, the air in its cabin goes with it.
 *
 *   const B = captureBody(world, owner, origin, yaw, { region });   // its voxels as built (by owner)
 *   stampBody(world, B, { x, y, z, yaw, pitch, roll }, { hidden, vel }); // read back, out of the old cells, into the new
 *   releaseBody(world, B);                                           // left where it is (as plain voxels)
 *
 * In the grid its voxels are anchored (F_ANCHOR: held by the car, not by what is under it: the
 * moving body finds its loose parts itself) and, on the move, hidden (F_HIDDEN: render/cars.js
 * draws the car).
 */

/** A car's pose { x, y, z, yaw, pitch, roll } as a moving body's { p, R }. */
export const bodyPose = (q) => ({ p: [q.x, q.y, q.z], R: carRot(q.yaw, q.pitch ?? 0, q.roll ?? 0) });

/**
 * Take the voxels of `owner` as a body (origin: the model's origin in the world, yaw: its
 * heading). Options: region(l, k, B) → a label for a voxel at local l ('engine', ...): its parts.
 */
export function captureBody(w, owner, origin, yaw, o = {}) {
  if (w.listDirty) w.rebuildLists();
  const cells = [];
  for (let k = 0; k < w.solidCount; k++) {
    const i = w.solids[k];
    if (w.owner[i] === owner) cells.push(i);
  }
  const B = makeMovingBody(w, cells, null, { pose: { p: origin.slice(), R: carRot(yaw, 0, 0) }, owner, anchor: true, seal: (k, i) => w.vesselTag[i] > 0 });
  B.region = null;
  if (o.region) {
    B.region = new Array(B.n);
    for (let k = 0; k < B.n; k++) B.region[k] = o.region([B.local[3 * k], B.local[3 * k + 1], B.local[3 * k + 2]], k, B);
  }
  B.carPose = { x: origin[0], y: origin[1], z: origin[2], yaw, pitch: 0, roll: 0 };
  return B;
}

/** Read the body's voxels back from the grid (their state now); the ones gone from it are gone. */
export const gatherBody = syncBody;

/**
 * Put the body in the grid at pose { x, y, z, yaw, pitch, roll } (its voxels read back first).
 * o.hidden: drawn by its mesh (render/cars.js), not as voxels; o.vel: { v, w } its velocity and
 * spin (what falls off flies with it); o.air: its cabin's air goes with it. → the restamp's counts
 * ({ cells, blocked, gone, detached, ... }).
 */
export function stampBody(w, B, pose, o = {}) {
  const r = restamp(w, B, bodyPose(pose), { hidden: !!o.hidden, vel: o.vel, air: o.air });
  B.carPose = { x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw, pitch: pose.pitch ?? 0, roll: pose.roll ?? 0 };
  B.hidden = !!o.hidden;
  return { cells: r.placed, ...r };
}

/** Its voxels left where they are, as plain voxels. */
export const releaseBody = release;

/** How much of it is left (0..1: voxels still there of those it was built of). */
export const bodyLeft = left;

/** Its voxels of a region (B.region labels): { n, alive, char (mean), hot (share over T °C), burning }. */
export function regionState(B, label, T = 350) {
  let n = 0, alive = 0, ch = 0, hot = 0, burning = 0;
  const S = B.s;
  for (let k = 0; k < B.n; k++) {
    if (B.region?.[k] !== label) continue;
    n++;
    if (!S.mat[k]) continue;
    alive++;
    ch += S.char[k];
    if (S.temp[k] > T) hot++;
    if (S.flags[k] & (F_BURNING | F_SMOLDER)) burning++;
  }
  return { n, alive, char: alive ? ch / alive : 1, hot: alive ? hot / alive : 0, burning };
}

/** Is any of it burning (flaming)? */
export function bodyBurning(B) {
  for (let k = 0; k < B.n; k++) if (B.s.mat[k] && B.s.flags[k] & F_BURNING) return true;
  return false;
}
