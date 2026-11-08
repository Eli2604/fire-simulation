/**
 * Doors that can be opened and closed.
 *
 * A door is a set of voxels registered by its model (`door: 'name'` on a
 * primitive). Opening it takes those voxels out of the grid (keeping their
 * full state: a hot, charred or partly burnt door stays that way); closing
 * it puts them back into any cell that is still free. While a door is open,
 * air, smoke, oxygen and people pass; when it is closed they do not.
 */
const FIELDS = ['mat', 'temp', 'skin', 'fuel', 'moist', 'melt', 'char', 'flags', 'dens', 'owner', 'paint', 'coat', 'crack'];

export function toggleDoor(sim, k, open) {
  const w = sim.world;
  const d = w.doors[k];
  if (!d) return false;
  const want = open ?? !d.open;
  if (want === d.open) return false;
  if (want) {
    d.saved = [];
    for (const i of d.voxels) {
      if (w.doorTag[i] !== k + 1 || !w.mat[i]) continue; // burnt away or moved
      const st = { i, tint: [w.tint[i * 3], w.tint[i * 3 + 1], w.tint[i * 3 + 2]] };
      for (const f of FIELDS) st[f] = w[f][i];
      d.saved.push(st);
      w.clearVoxel(i);
    }
  } else {
    for (const st of d.saved ?? []) {
      const i = st.i;
      if (w.mat[i]) continue; // something is in the way (debris, a person's hose...)
      w.setVoxel(i, st.mat, { temp: st.temp, owner: st.owner, density: st.dens });
      for (const f of FIELDS) w[f][i] = st[f];
      w.tint[i * 3] = st.tint[0];
      w.tint[i * 3 + 1] = st.tint[1];
      w.tint[i * 3 + 2] = st.tint[2];
      w.doorTag[i] = k + 1;
    }
    d.saved = null;
  }
  d.open = want;
  w.events.push({ type: want ? 'doorOpen' : 'doorClose', pos: d.center, time: w.time, name: d.name });
  return true;
}

/** Door whose centre is closest to p within maxDist (m), or -1. */
export function nearestDoor(w, p, maxDist = 1.5) {
  let best = -1;
  let bd = maxDist;
  w.doors.forEach((d, k) => {
    const dd = Math.hypot(d.center[0] - p[0], d.center[1] - p[1], d.center[2] - p[2]);
    if (dd < bd) {
      bd = dd;
      best = k;
    }
  });
  return best;
}

/** The door a voxel belongs to, or -1. */
export function doorOfVoxel(w, i) {
  if (i >= 0 && w.doorTag[i]) return w.doorTag[i] - 1;
  return -1;
}
