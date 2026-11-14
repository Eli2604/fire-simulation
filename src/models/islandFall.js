/**
 * The waterfall of an island (models/island.js, `waterfall: true`): a stream on a rocky
 * height (a mesa raised behind a cliff) runs to the brink and falls over the cliff into a
 * plunge pool; behind the falling water a walkway is cut into the cliff (an alcove you walk
 * through, the curtain of water in front of you); from the pool a river runs down through the
 * land to the sea.
 *
 * The water is voxels (it soaks, boils off, freezes, a dam stops it) held in level reaches,
 * each a voxel lower than the one above, with a sill of rock between them (the river steps
 * down over them: drawn as small cascades, render/waterworks.js). How fast it flows is the
 * simulation's (sim/river.js): the discharge over the fall, Q, through each cross-section of
 * the river: v = Q / A.
 *
 * Everything here is in the island's own frame (metres, y up from its base). `ground(x, z)`
 * is the island's terrain without the fall. Returns the terrain as the fall shapes it
 * (`shape`), the water per column (`water`), whether a column is bare rock (`rock`), extra
 * primitives (the rock round the walkway, the alcove cut into the cliff) and the river (its
 * stations from the stream on the height to the sea, for the simulation and for drawing).
 */
export function islandFall(p, { h, sea, W, D, ground }) {
  const th = (p.fallHeading * Math.PI) / 180;
  const u = [Math.cos(th), Math.sin(th)]; // downstream, away from the cliff
  const v = [-u[1], u[0]]; // across
  const L = [p.fallX * W, p.fallZ * D]; // the brink
  const at = (a, b) => [L[0] + u[0] * a + v[0] * b, L[1] + u[1] * a + v[1] * b];
  const frame = (x, z) => {
    const dx = x - L[0];
    const dz = z - L[1];
    return [dx * u[0] + dz * u[1], dx * v[0] + dz * v[1]];
  };
  const up = (y) => Math.ceil(y / h - 1e-6) * h;
  const dn = (y) => Math.floor(y / h + 1e-6) * h;
  const fw = p.fallWidth;
  const rw = p.riverWidth;
  const g = 9.81;
  // the brink: critical flow over a free overfall (the depth at the brink ~0.715 of the
  // critical depth (q²/g)^⅓): how fast the water leaves the edge, so where it lands
  const q = Math.max(p.flow, 0.05) / fw;
  const yc = Math.cbrt((q * q) / g);
  const vb = q / (0.715 * yc);
  // the water's levels: the lowest reach just above the sea (its voxels must stay above it:
  // water below the sea level rejoins the sea, sim/water.js), the pool sunk into the land
  // round it, the brink the fall's height above the pool
  const Llow = up(sea + h + 0.01);
  const pc0 = at(2.5, 0);
  const poolL = Math.max(Llow, dn(ground(pc0[0], pc0[1]) - 0.8));
  const T = up(poolL + p.fallHeight);
  const drop = T - poolL;
  const aLand = vb * Math.sqrt((2 * drop) / g);
  const pc = Math.max(2.0, aLand + 0.4); // the pool's middle (and its radius) along the flow
  const ra = pc;
  const rb = fw / 2 + 0.8;
  // the walkway behind the fall: a ledge two voxels above the pool, an alcove 1.4 m into
  // the cliff with head room (2.2 m), a slab of rock over it under the stream
  const ledgeY = poolL + 2 * h;
  const ceilY = ledgeY + up(2.2);
  const alc = up(1.4);
  const walk = ceilY <= T - 2 * h; // (a fall too low for a walkway behind it)
  const halfAlc = fw / 2 + 1.4;
  const aUp = 5; // the stream on the height, before the brink
  const bw = fw / 2 + 3.5; // the cliff's half width before the height slopes away
  const bottomL = up(sea + 0.01); // (no water voxel below this)
  const poolBed = (e) => Math.max(bottomL - h, dn(poolL - 0.6 - 1.0 * Math.sqrt(Math.max(0, 1 - e * e))));

  // the stations along the water, every 0.25 m: the stream, the brink, the pool, the river
  const ds = 0.25;
  const st = [];
  const push = (xz, t, s, kind, level, bed, half) => st.push({ x: xz[0], z: xz[1], tx: t[0], tz: t[1], s, kind, level, bed, half });
  for (let a = -aUp; a < -h - 1e-6; a += ds) push(at(a, 0), u, a, 'stream', T, T - h, fw / 2);
  push(at(-h / 2, 0), u, -h / 2, 'fall', T, T, fw / 2);
  for (let a = ds; a < 2 * pc; a += ds) {
    const e = Math.abs(a - pc) / ra;
    push(at(a, 0), u, a, 'pool', poolL, poolBed(e), Math.max(0.4, rb * Math.sqrt(Math.max(0, 1 - e * e))));
  }
  // the river: from the pool's outlet down to the sea, winding a little
  const path = [];
  {
    let [x, z] = at(2 * pc, 0);
    let beyond = 0;
    for (let k = 0; k < 600; k++) {
      const s = k * ds;
      const hd = th + 0.35 * Math.sin((2 * Math.PI * s) / 14) * Math.min(1, s / 3);
      const t = [Math.cos(hd), Math.sin(hd)];
      path.push({ x, z, t, s });
      if (ground(x, z) < sea - 0.5 && ++beyond > 12) break;
      x += t[0] * ds;
      z += t[1] * ds;
    }
  }
  // where the land is lower than the lowest reach: the mouth (a last sill, then the sea)
  let mi = path.findIndex((q) => ground(q.x, q.z) < Llow);
  if (mi < 0) mi = path.length - 1;
  const Lr = Math.max(ds, mi * ds);
  const n = Math.round((poolL - Llow) / h); // reaches below the pool
  const sill = 1.5 * h; // (wide enough that no reach's water touches the next one's)
  const reach = Lr / Math.max(1, n);
  for (const q of path) {
    const s = q.s;
    const S = 2 * pc + s;
    if (s >= Lr) {
      if (s < Lr + sill) push([q.x, q.z], q.t, S, 'sill', Llow, Llow, rw / 2);
      else push([q.x, q.z], q.t, S, 'sea', sea, Math.min(ground(q.x, q.z), sea - 0.6), rw / 2);
      continue;
    }
    const k = n > 0 ? Math.min(n, Math.floor(s / reach) + 1) : 0;
    const level = poolL - k * h;
    if (n > 0 && s - (k - 1) * reach < sill) push([q.x, q.z], q.t, S, 'sill', level + h, level + h, rw / 2);
    else push([q.x, q.z], q.t, S, 'water', level, Math.max(bottomL, level - 2 * h), rw / 2); // (its voxels stay above the sea)
  }

  // bounds of what the fall changes, for a quick test
  const xs = st.map((q) => q.x);
  const zs = st.map((q) => q.z);
  const box = [Math.min(...xs) - 12, Math.min(...zs) - 12, Math.max(...xs) + 12, Math.max(...zs) + 12];
  const river = st.filter((q) => (q.kind === 'water' || q.kind === 'sill' || q.kind === 'sea'));
  /** The nearest river station to (x, z) and how far across from its line. */
  const nearest = (x, z) => {
    let best = null;
    let bd = Infinity;
    for (const q of river) {
      const d2 = (x - q.x) ** 2 + (z - q.z) ** 2;
      if (d2 < bd) {
        bd = d2;
        best = q;
      }
    }
    if (!best) return null;
    const dx = x - best.x;
    const dz = z - best.z;
    return { q: best, d: Math.abs(-dx * best.tz + dz * best.tx), along: dx * best.tx + dz * best.tz };
  };
  const inBox = (x, z) => x > box[0] && x < box[2] && z > box[1] && z < box[3];

  /** The terrain at (x, z) as the fall shapes it (y: the island's own there). */
  const shape = (x, z, y) => {
    if (!inBox(x, z)) return y;
    const [a, b] = frame(x, z);
    const ab = Math.abs(b);
    if (a <= 0) {
      // the height behind the cliff, sloping away to the sides and behind
      const yM = T + h - Math.max(0, ab - bw) * 0.6 - Math.max(0, -a - (aUp + 1.5)) * 0.5;
      if (yM > y) y = yM;
      // the stream in its bed, the brink (a sill of rock the water pours over)
      if (a > -aUp - 0.3 && ab < fw / 2) y = a > -h ? T : T - h;
      return y;
    }
    // in front of the cliff: a valley round the pool and along the river, cut into the land
    const e = Math.hypot((a - pc) / ra, b / rb);
    if (e < 1) return poolBed(e);
    let cut = poolL + h + Math.max(0, (e - 1) * Math.min(ra, rb)) * 0.7;
    const nr = nearest(x, z);
    let levee = -Infinity;
    if (nr) {
      const { q, d } = nr;
      if (q.kind === 'sea') {
        if (d < q.half && Math.abs(nr.along) < 1) return Math.min(y, q.bed);
        cut = Math.min(cut, sea + 0.3 + Math.max(0, d - q.half) * 0.7);
      } else {
        if (d < q.half && Math.abs(nr.along) < 1) return q.bed;
        cut = Math.min(cut, q.level + h + Math.max(0, d - q.half) * 0.7);
        if (d < q.half + 2 * h) levee = q.level + h; // (banks that hold it where the land is low)
      }
    }
    y = Math.max(Math.min(y, cut), levee);
    // beside the pool, at the foot of the cliff: a level walk to the ledge behind the fall
    if (walk && a < 1.4 && ab > fw / 2 + 0.6) {
      const out = ab - (fw / 2 + 3.0);
      y = out <= 0 ? ledgeY : Math.min(y, ledgeY + out * 0.6);
      if (out <= 0 && y < ledgeY) y = ledgeY;
    }
    return y;
  };

  /** The water in the column at (x, z): [bed, surface], or null. */
  const water = (x, z) => {
    if (!inBox(x, z)) return null;
    const [a, b] = frame(x, z);
    const ab = Math.abs(b);
    if (a <= 0) return a > -aUp - 0.3 && a <= -h && ab < fw / 2 ? [T - h, T] : null;
    const e = Math.hypot((a - pc) / ra, b / rb);
    if (e < 1) return [poolBed(e), poolL];
    const nr = nearest(x, z);
    if (nr && nr.q.kind === 'water' && nr.d < nr.q.half && Math.abs(nr.along) < 1) return [nr.q.bed, nr.q.level];
    return null;
  };

  /** Is the column at (x, z) bare rock (the cliff, the brink, the sills, the pool's floor)? */
  const rock = (x, z) => {
    if (!inBox(x, z)) return false;
    const [a, b] = frame(x, z);
    const ab = Math.abs(b);
    if (a <= 0) return ab < bw + 1 && a > -aUp - 1;
    if (Math.hypot((a - pc) / ra, b / rb) < 1.15) return true;
    if (walk && a < 1.4 && ab < fw / 2 + 3.2) return true;
    const nr = nearest(x, z);
    return !!nr && nr.q.kind === 'sill' && nr.d < nr.q.half + h;
  };

  // the walkway: solid rock round it (the height is hollow inside, like the hills), then the
  // alcove cut into the cliff under the brink
  const quad = (a0, a1, b0, b1) => [at(a0, b0), at(a1, b0), at(a1, b1), at(a0, b1)];
  const prims = [];
  if (walk) {
    prims.push({ shape: 'prism', poly: quad(-alc - 1.2, 0, -halfAlc - 1.2, halfAlc + 1.2), y0: poolL - 2, y1: T - h, mode: 'fill', material: 'hillRock', anchored: true, color: [0.4, 0.38, 0.35], variation: 0.08 });
    prims.push({ shape: 'prism', poly: quad(-alc, 0.3, -halfAlc, halfAlc), y0: ledgeY, y1: ceilY, mode: 'carve' });
  }
  const P = (q) => [q.x, q.level, q.z];
  const xyz = (a, b, y) => {
    const [x, z] = at(a, b);
    return [x, y, z];
  };
  return {
    shape,
    water,
    rock,
    prims,
    river: {
      label: 'River',
      flow: p.flow,
      width: rw,
      stations: st.map((q) => ({ p: P(q), t: [q.tx, 0, q.tz], kind: q.kind, bed: q.bed, half: q.half })),
      fall: {
        lip: xyz(0, 0, T),
        dir: [u[0], 0, u[1]],
        across: [v[0], 0, v[1]],
        width: fw,
        drop,
        pool: xyz(pc, 0, poolL),
        poolR: [ra, rb],
        ledge: walk ? { y: ledgeY, ceil: ceilY, depth: alc, half: halfAlc, mid: xyz(-alc / 2, 0, ledgeY) } : null,
      },
    },
    // something afloat in the pool, for the river to carry down to the sea
    loose: [
      { kind: 'crate', p: xyz(pc + 0.6, 0.5, 0), r: 0.25, half: 0.22, mass: 6, onWater: true },
      { kind: 'crate', p: xyz(2 * pc + 2, 0.2, 0), r: 0.22, half: 0.2, mass: 5, onWater: true },
    ],
    levels: { pool: poolL, top: T, low: Llow, ledge: ledgeY },
  };
}
