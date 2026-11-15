import { O2_AIR } from './world.js';

/**
 * A moving body (sim/movingBody.js: a car, a boat) and the air (sim/air.js).
 *
 * The air model has no momentum of its own: each step its velocity is made anew from buoyancy,
 * the wind and the turbulence (stepAir 1.), and a solid only blocks it. A body that moves through
 * it does two things to it:
 *
 *   carryAir  the air inside its envelope (a car's cabin and engine bay, a boat's hull) goes with
 *             it: when it has moved half an air cell or more (restamp opts.air), each air cell
 *             inside its envelope at the new pose takes the air (temperature, smoke and its
 *             colour, steam, burning gas, powder, oxygen) of the cell that was at that place in
 *             the body at the old pose; the cells it left take fresh air from outside. So the
 *             smoke in a car's cabin, the hot gas over a fire in a boat's bottom, stay with it.
 *   dragAir   the air round it is dragged along (a boundary velocity): the cells in a layer round
 *             its outside move with its surface (its velocity there, spin included), less so
 *             further out, and its wake behind it follows it, fading over a few body lengths
 *             (a car's wake moves at about half its speed a length behind it). What a burning
 *             body sheds into that air (flames, smoke, hot gas) is carried along close to it and
 *             left behind further out: its plume leans back and trails behind it.
 *
 * dragAir writes w.dragV / w.dragW (a velocity and a weight per air cell, the strongest of the
 * bodies' that touch it); stepAir (sim/air.js applyDrag) relaxes the air's velocity towards it by
 * that weight at its next step, and clears it.
 */

const _l = [0, 0, 0];

function toLocal(pose, x, y, z, out = _l) {
  const R = pose.R, p = pose.p;
  const dx = x - p[0], dy = y - p[1], dz = z - p[2];
  out[0] = R[0] * dx + R[3] * dy + R[6] * dz;
  out[1] = R[1] * dx + R[4] * dy + R[7] * dz;
  out[2] = R[2] * dx + R[5] * dy + R[8] * dz;
  return out;
}

/** The air cells whose centres lie inside its box (local, with margin) at a pose: [ax0, ax1, ay0, ay1, az0, az1]. */
function airBox(w, pose, lo, hi, m) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  const R = pose.R, p = pose.p;
  for (let c = 0; c < 8; c++) {
    const l = [c & 1 ? hi[0] + m[0] : lo[0] - m[0], c & 2 ? hi[1] + m[1] : lo[1] - m[1], c & 4 ? hi[2] + m[2] : lo[2] - m[2]];
    for (let a = 0; a < 3; a++) {
      const v = p[a] + R[3 * a] * l[0] + R[3 * a + 1] * l[1] + R[3 * a + 2] * l[2];
      if (v < mn[a]) mn[a] = v;
      if (v > mx[a]) mx[a] = v;
    }
  }
  const ah = w.ah;
  return [
    Math.max(0, Math.floor(mn[0] / ah)), Math.min(w.anx - 1, Math.floor(mx[0] / ah)),
    Math.max(0, Math.floor(mn[1] / ah)), Math.min(w.any - 1, Math.floor(mx[1] / ah)),
    Math.max(0, Math.floor(mn[2] / ah)), Math.min(w.anz - 1, Math.floor(mx[2] / ah)),
  ];
}

const AIR_FIELDS = ['airT', 'smoke', 'smokeR', 'smokeG', 'smokeB', 'steam', 'fgas', 'supp', 'o2'];

/**
 * The air inside its envelope from pose `from` to pose `to` (see the top). air.inside(x, y, z):
 * a body-frame point inside it (default: inside its box less a voxel all round). → cells moved.
 */
export function carryAir(w, B, from, to, air = {}) {
  const [lo, hi] = B.box;
  const h = w.h, ah = w.ah;
  const inside = air.inside ?? ((x, y, z) => x > lo[0] + h && x < hi[0] - h && y > lo[1] + h && y < hi[1] - h && z > lo[2] + h && z < hi[2] - h);
  const { anx, any } = w;
  const sxy = anx * any;
  const cellAt = (pose, l) => {
    const R = pose.R, p = pose.p;
    const x = Math.floor((p[0] + R[0] * l[0] + R[1] * l[1] + R[2] * l[2]) / ah);
    const y = Math.floor((p[1] + R[3] * l[0] + R[4] * l[1] + R[5] * l[2]) / ah);
    const z = Math.floor((p[2] + R[6] * l[0] + R[7] * l[1] + R[8] * l[2]) / ah);
    return x < 0 || y < 0 || z < 0 || x >= anx || y >= any || z >= w.anz ? -1 : x + anx * y + sxy * z;
  };
  // its envelope's cells at the old pose (what leaves them) and at the new (where it goes)
  const old = new Set();
  const m0 = [0, 0, 0];
  let b = airBox(w, from, lo, hi, m0);
  for (let az = b[4]; az <= b[5]; az++)
    for (let ay = b[2]; ay <= b[3]; ay++)
      for (let ax = b[0]; ax <= b[1]; ax++) {
        const l = toLocal(from, (ax + 0.5) * ah, (ay + 0.5) * ah, (az + 0.5) * ah);
        if (inside(l[0], l[1], l[2])) old.add(ax + anx * ay + sxy * az);
      }
  const pairs = [];
  b = airBox(w, to, lo, hi, m0);
  for (let az = b[4]; az <= b[5]; az++)
    for (let ay = b[2]; ay <= b[3]; ay++)
      for (let ax = b[0]; ax <= b[1]; ax++) {
        const l = toLocal(to, (ax + 0.5) * ah, (ay + 0.5) * ah, (az + 0.5) * ah);
        if (!inside(l[0], l[1], l[2])) continue;
        const src = cellAt(from, l);
        if (src < 0) continue;
        pairs.push(ax + anx * ay + sxy * az, src);
      }
  if (!pairs.length) return 0;
  // read all first (they overlap), then write
  const np = pairs.length / 2;
  const F = AIR_FIELDS.map((f) => w[f]);
  const buf = new Float32Array(np * F.length);
  for (let q = 0; q < np; q++) {
    const s = pairs[2 * q + 1];
    for (let f = 0; f < F.length; f++) buf[q * F.length + f] = F[f][s];
  }
  const now = new Set();
  for (let q = 0; q < np; q++) {
    const d = pairs[2 * q];
    now.add(d);
    for (let f = 0; f < F.length; f++) F[f][d] = buf[q * F.length + f];
  }
  // what it left: fresh air comes in behind it
  const T0 = w.ambient, O2 = w.vacuum ? 0 : w.o2Out ?? O2_AIR;
  for (const a of old) {
    if (now.has(a)) continue;
    w.airT[a] = T0;
    w.smoke[a] = w.smokeR[a] = w.smokeG[a] = w.smokeB[a] = 0;
    w.steam[a] = w.fgas[a] = w.supp[a] = 0;
    w.o2[a] = O2;
  }
  return np;
}

/**
 * Drag the air round it along (see the top): its pose, its velocity v [3] and spin om [3] (rad/s,
 * about its origin, world axes). Cells inside its box are left alone (their air goes with it:
 * carryAir). opts: { layer: m (its boundary layer, default 0.35), wake: s (how long its wake
 * lasts, default 1.2 s) }.
 */
export function dragAir(w, B, pose, v, om = [0, 0, 0], opts = {}) {
  const speed = Math.hypot(v[0], v[1], v[2]);
  const spin = Math.hypot(om[0], om[1], om[2]);
  const [lo, hi] = B.box;
  const size = Math.max(hi[0] - lo[0], hi[2] - lo[2], 0.5);
  if (speed + spin * size * 0.5 < 0.2) return 0;
  const ah = w.ah;
  const layer = opts.layer ?? 0.35;
  const lw = Math.min(4 * size, Math.max(size, speed * (opts.wake ?? 1.2)));
  // its velocity in its own frame (the direction its wake trails)
  const R = pose.R;
  const vl = [R[0] * v[0] + R[3] * v[1] + R[6] * v[2], R[1] * v[0] + R[4] * v[1] + R[7] * v[2], R[2] * v[0] + R[5] * v[1] + R[8] * v[2]];
  const sp = Math.hypot(vl[0], vl[1], vl[2]) || 1;
  const dir = [vl[0] / sp, vl[1] / sp, vl[2] / sp];
  // the box round it: its boundary layer all round, its wake behind it
  const m = [layer * 2 + ah, layer * 2 + ah, layer * 2 + ah];
  for (let a = 0; a < 3; a++) m[a] += Math.abs(dir[a]) * lw;
  const b = airBox(w, pose, lo, hi, m);
  const { anx, any } = w;
  const sxy = anx * any;
  const dragV = (w.dragV ??= new Float32Array(w.NA * 3));
  const dragW = (w.dragW ??= new Float32Array(w.NA));
  const list = (w.dragList ??= []);
  const p = pose.p;
  let n = 0;
  for (let az = b[4]; az <= b[5]; az++)
    for (let ay = b[2]; ay <= b[3]; ay++)
      for (let ax = b[0]; ax <= b[1]; ax++) {
        const cx = (ax + 0.5) * ah, cy = (ay + 0.5) * ah, cz = (az + 0.5) * ah;
        const l = toLocal(pose, cx, cy, cz);
        // how far outside its box (0: inside)
        const ox = l[0] < lo[0] ? lo[0] - l[0] : l[0] > hi[0] ? l[0] - hi[0] : 0;
        const oy = l[1] < lo[1] ? lo[1] - l[1] : l[1] > hi[1] ? l[1] - hi[1] : 0;
        const oz = l[2] < lo[2] ? lo[2] - l[2] : l[2] > hi[2] ? l[2] - hi[2] : 0;
        const d = Math.hypot(ox, oy, oz);
        if (d === 0) continue;
        // its boundary layer: moving with its surface
        let wt = 0.8 * Math.exp(-d / layer);
        let k = 1; // share of its speed there
        // its wake: behind it, across its cross-section, fading behind it
        const along = (l[0] - (dir[0] > 0 ? lo[0] : hi[0])) * dir[0] + (l[1] - (dir[1] > 0 ? lo[1] : hi[1])) * dir[1] + (l[2] - (dir[2] > 0 ? lo[2] : hi[2])) * dir[2];
        if (along < 0) {
          const s = -along;
          // across: the distance from its box sideways to the direction of travel
          const q = Math.hypot(ox * (1 - Math.abs(dir[0])), oy * (1 - Math.abs(dir[1])), oz * (1 - Math.abs(dir[2])));
          const ww = 0.6 * Math.exp(-s / lw) * Math.exp(-q / (layer * 1.5));
          if (ww > wt) {
            wt = ww;
            k = 0.5 + 0.5 * Math.exp(-s / (0.5 * size));
          }
        }
        if (wt < 0.03) continue;
        const a = ax + anx * ay + sxy * az;
        if (wt <= dragW[a]) continue;
        if (dragW[a] === 0) list.push(a);
        dragW[a] = wt;
        // its velocity at that point (its spin too)
        const rx = cx - p[0], ry = cy - p[1], rz = cz - p[2];
        dragV[3 * a] = k * (v[0] + om[1] * rz - om[2] * ry);
        dragV[3 * a + 1] = k * (v[1] + om[2] * rx - om[0] * rz);
        dragV[3 * a + 2] = k * (v[2] + om[0] * ry - om[1] * rx);
        n++;
      }
  return n;
}

/** The bodies' drag on the air's velocity (sim/air.js, after it is made each step), then cleared. */
export function applyDrag(w) {
  const list = w.dragList;
  if (!list?.length) return;
  const { vx, vy, vz, dragV, dragW, occ } = w;
  for (const a of list) {
    const wt = Math.min(0.9, dragW[a]) * (1 - occ[a]);
    vx[a] += (dragV[3 * a] - vx[a]) * wt;
    vy[a] += (dragV[3 * a + 1] - vy[a]) * wt;
    vz[a] += (dragV[3 * a + 2] - vz[a]) * wt;
    dragW[a] = 0;
  }
  list.length = 0;
}
