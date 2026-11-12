/**
 * A tree felled (its trunk cut through by a blast): everything of it above the cut swings
 * over as one, about the cut, away from the blast, and lies along the ground (a voxel that
 * comes down where the ground or something else is lies on top of it). The voxels go there at
 * once (they settle from there); the drawn tree (render/trees.js) topples over a couple of
 * seconds, as a falling tree does, to where they are. `t.fall` tells it how:
 * { pivot, axis, angle, t0, cutY, map: old voxel index -> new }.
 */
const FIELDS = ['mat', 'temp', 'skin', 'wetSkin', 'dens', 'skinMelt', 'coat', 'vesselTag', 'group', 'paint', 'crack', 'pickupTag', 'doorTag', 'fuel', 'moist', 'melt', 'char', 'flags', 'hrr', 'owner'];

export function fellTree(sim, t, cutRow, from) {
  const w = sim.world;
  if (t.fall) return false;
  const { h, nx, ny, nz } = w;
  // the trunk's axis at the cut
  const yc = (cutRow + 0.5) * h;
  const s = t.segs.find((q) => q.trunk && Math.min(q.a[1], q.b[1]) <= yc + h && Math.max(q.a[1], q.b[1]) >= yc - h) ?? t.segs[0];
  const f = Math.max(0, Math.min(1, (yc - s.a[1]) / (s.b[1] - s.a[1] || 1)));
  const pivot = [s.a[0] + (s.b[0] - s.a[0]) * f, (cutRow + 1) * h, s.a[2] + (s.b[2] - s.a[2]) * f];
  // it falls away from the blast
  let dx = pivot[0] - from[0];
  let dz = pivot[2] - from[2];
  const l = Math.hypot(dx, dz);
  if (l < 1e-3) {
    const a = sim.rand() * Math.PI * 2;
    dx = Math.cos(a);
    dz = Math.sin(a);
  } else {
    dx /= l;
    dz /= l;
  }
  // a rotation by `angle` about the horizontal axis across the fall (up turns towards dir)
  const axis = [dz, 0, -dx];
  let angle = Math.PI / 2 - 0.08;
  const rotBy = (p, ang) => {
    const v = [p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]];
    const c = Math.cos(ang);
    const sn = Math.sin(ang);
    const [kx, ky, kz] = axis;
    const dot = kx * v[0] + ky * v[1] + kz * v[2];
    const cr = [ky * v[2] - kz * v[1], kz * v[0] - kx * v[2], kx * v[1] - ky * v[0]];
    return [0, 1, 2].map((i) => pivot[i] + v[i] * c + cr[i] * sn + [kx, ky, kz][i] * dot * (1 - c));
  };
  const rot = (p) => rotBy(p, angle);
  // what of it is above the cut
  if (w.listDirty) w.rebuildLists();
  const src = [];
  for (let k = 0; k < w.solidCount; k++) {
    const i = w.solids[k];
    if (w.owner[i] !== t.owner) continue;
    if (Math.floor(i / nx) % ny <= cutRow) continue;
    src.push(i);
  }
  if (!src.length) return false;
  // how far over it goes: until its wood would go into the ground (or a wall): there it rests
  const own = t.owner;
  const solidAt = (q) => {
    const j = w.voxelAt(q[0], q[1], q[2]);
    return j >= 0 && w.mat[j] && w.owner[j] !== own;
  };
  // (the trunk decides it: limbs and branches under it break on the ground, or it rests on them)
  const wood = [];
  for (const sg of t.segs) {
    if (!sg.trunk) continue;
    const L = Math.hypot(sg.b[0] - sg.a[0], sg.b[1] - sg.a[1], sg.b[2] - sg.a[2]);
    for (let u = 0; u <= 1; u += Math.min(1, 0.3 / (L || 1))) {
      const q = [sg.a[0] + (sg.b[0] - sg.a[0]) * u, sg.a[1] + (sg.b[1] - sg.a[1]) * u, sg.a[2] + (sg.b[2] - sg.a[2]) * u];
      if (q[1] > pivot[1] + h) wood.push(q);
    }
  }
  for (let a = 0.15; a <= Math.PI / 2 - 0.08 + 1e-9; a += 0.05) {
    if (wood.some((p) => solidAt(rotBy(p, a)))) {
      angle = Math.max(0.15, a - 0.05);
      break;
    }
  }
  // take them up (their state), then lay them down where they come to
  const buf = src.map((i) => {
    const o = { i, tint: [w.tint[i * 3], w.tint[i * 3 + 1], w.tint[i * 3 + 2]] };
    for (const f of FIELDS) o[f] = w[f][i];
    return o;
  });
  for (const i of src) w.clearVoxel(i);
  const map = new Map();
  // (nearest the cut first: the trunk lies down before the crown comes onto it)
  buf.sort((a, b) => dist2(w.center(...w.coords(a.i)), pivot) - dist2(w.center(...w.coords(b.i)), pivot));
  for (const o of buf) {
    const q = rot(w.center(...w.coords(o.i)));
    let x = Math.floor(q[0] / h);
    let y = Math.max(0, Math.floor(q[1] / h));
    let z = Math.floor(q[2] / h);
    if (x < 0 || z < 0 || x >= nx || z >= nz || y >= ny) continue;
    // where the ground (or more of the tree) is, it lies on top
    let j = w.idx(x, y, z);
    let up = 0;
    while (w.mat[j] && up < Math.ceil(3 / h) && y + 1 < ny) {
      y++;
      up++;
      j = w.idx(x, y, z);
    }
    if (w.mat[j]) continue;
    for (const f of FIELDS) w[f][j] = o[f];
    // it lies where it came down (held there: the drawn tree follows its voxels by index)
    w.flags[j] = (w.flags[j] | 4) & ~2; // (F_ANCHOR, not F_FALLING)
    w.tint[j * 3] = o.tint[0];
    w.tint[j * 3 + 1] = o.tint[1];
    w.tint[j * 3 + 2] = o.tint[2];
    map.set(o.i, j);
  }
  w.listDirty = true;
  w.structureDirty = true;
  w.geomVersion++;
  t.fall = { pivot, axis, angle, t0: w.time, cutY: pivot[1], map };
  w.events.push({ type: 'treeFall', pos: pivot.slice(), time: w.time, name: 'a tree' });
  w.noises?.push({ p: pivot.slice(), loud: 50, time: w.time, kind: 'crash' });
  return true;
}

const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
