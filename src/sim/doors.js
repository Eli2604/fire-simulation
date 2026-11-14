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

export function toggleDoor(sim, k, open, opts = {}) {
  const w = sim.world;
  const d = w.doors[k];
  if (!d) return false;
  const want = open ?? !d.open;
  if (want === d.open) return false;
  // a pressure door with more pressure on one side than the other (a compartment in space
  // vented, sim/vacuum.js): the difference holds it shut (101 kPa on a door: 18 t). Its
  // equalising valve opens instead; the door opens once the two sides are level
  if (want && d.autoSeal && !opts.force && doorDeltaP(w, d) > 0.15) {
    if (!d.equalize) w.events.push({ type: 'doorHeld', pos: d.center, time: w.time, name: d.name });
    d.equalize = true;
    return false;
  }
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
  w.noises.push({ p: d.center.slice(), loud: 12, time: w.time, kind: 'door' });
  return true;
}

/** Has the glass panel of a door been broken (a hole to reach through)? */
export function doorGlassBroken(w, k) {
  const d = w.doors[k];
  if (!d || !d.glass?.length || d.open) return false;
  return d.glass.some((i) => w.doorTag[i] !== k + 1 || w.mat[i] === 0);
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

/**
 * The air cells on either side of a door (its thin axis is its normal), found once: [a, b]
 * (-1 where there is none).
 */
export function doorSides(w, d) {
  if (d.sides) return d.sides;
  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  for (const i of d.voxels) {
    const c = w.coords(i);
    lo = lo.map((v, k) => Math.min(v, c[k]));
    hi = hi.map((v, k) => Math.max(v, c[k]));
  }
  const axis = hi[0] - lo[0] <= hi[2] - lo[2] ? 0 : 2;
  const side = (s) => {
    for (let r = 0.5; r <= 1.3; r += 0.2) {
      const p = d.center.slice();
      p[axis] += s * r;
      const ax = Math.floor(p[0] / w.ah);
      const ay = Math.floor(p[1] / w.ah);
      const az = Math.floor(p[2] / w.ah);
      if (ax < 0 || ay < 0 || az < 0 || ax >= w.anx || ay >= w.any || az >= w.anz) return -1;
      const a = w.airIdx(ax, ay, az);
      if (w.occ[a] < 0.6) return a;
    }
    return -1;
  };
  d.sides = [side(-1), side(1)];
  return d.sides;
}

/** The pressure difference across a door (0..1 of cabin pressure; 0 where the world has no pressure field). */
export function doorDeltaP(w, d) {
  if (!w.press) return 0;
  const [a, b] = doorSides(w, d);
  if (a < 0 && b < 0) return 0;
  return Math.abs((a >= 0 ? w.press[a] : 0) - (b >= 0 ? w.press[b] : 0));
}
