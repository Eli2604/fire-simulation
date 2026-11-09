import { O2_AIR, F_FALLING, F_ANCHOR } from './world.js';
import { updateRegions } from './oxygen.js';

/**
 * Decompression (worlds in space: `world.vacuum`).
 *
 * Outside the hull there is no air. Each air cell carries a pressure
 * `press` (1 = cabin pressure). Spaces sealed off from the outside keep theirs.
 * Once the hull is breached (a grenade, a rocket, a fire that burns through),
 * every space connected to the outside through open faces empties:
 *
 *  - the time to empty grows with the path length to the hole (distance through
 *    open faces, a BFS from the domain boundary) and shrinks with the size of
 *    the hole (√ of the missing hull plating): ~1 s next to a big hole, several
 *    seconds at the end of a corridor;
 *  - the air streams towards the hole (a suction velocity added to the air
 *    model's flow, ∝ the pressure left), carrying the smoke out;
 *  - oxygen goes with it (the fire goes out), and the gas cools as it expands;
 *  - loose things near the hole are pulled out (falling debris gets the flow's speed);
 *  - closing a door seals the rest: its space keeps the pressure it still has.
 *
 * The walk-through pulls you towards the hole too, and hurts you when the
 * pressure is gone (your breathing apparatus gives you air, not pressure).
 */
export function initVacuum(w) {
  updateRegions(w, true);
  w.press = new Float32Array(w.NA);
  for (let a = 0; a < w.NA; a++) {
    const k = w.region[a];
    const sealed = k >= 0 && !w.regionOpen[k];
    w.press[a] = sealed ? 1 : 0;
    if (!sealed) {
      w.o2[a] = 0;
      w.smoke[a] = w.smokeR[a] = w.smokeG[a] = w.smokeB[a] = w.steam[a] = 0;
    }
  }
  w.suck = new Float32Array(w.NA * 3);
  w.vacHash = -1;
  w.breach = 0;
  w.decompressing = false;
}

/** Distance (in cells, through open faces) from the outside of the domain to every air cell. */
function distanceField(w) {
  const { anx, any, anz, passX, passY, passZ, occ } = w;
  const sxy = anx * any;
  const dist = (w.vacDist ??= new Float32Array(w.NA));
  dist.fill(Infinity);
  const q = new Int32Array(w.NA);
  let qh = 0;
  let qt = 0;
  for (let az = 0; az < anz; az++)
    for (let ay = 0; ay < any; ay++)
      for (let ax = 0; ax < anx; ax++) {
        if (ax && az && ay && ax < anx - 1 && az < anz - 1 && ay < any - 1) continue;
        const a = ax + anx * (ay + any * az);
        if (occ[a] > 0.95) continue;
        dist[a] = 0;
        q[qt++] = a;
      }
  while (qh < qt) {
    const a = q[qh++];
    const ax = a % anx;
    const ay = ((a - ax) / anx) % any;
    const az = (a - ax - ay * anx) / sxy;
    const d = dist[a] + 1;
    const go = (b, p) => {
      if (p > 0.25 && dist[b] > d && occ[b] <= 0.95) {
        dist[b] = d;
        q[qt++] = b;
      }
    };
    if (ax + 1 < anx) go(a + 1, passX[a]);
    if (ax > 0) go(a - 1, passX[a - 1]);
    if (ay + 1 < any) go(a + anx, passY[a]);
    if (ay > 0) go(a - anx, passY[a - anx]);
    if (az + 1 < anz) go(a + sxy, passZ[a]);
    if (az > 0) go(a - sxy, passZ[a - sxy]);
  }
  return dist;
}

export function stepVacuum(sim, dt) {
  const w = sim.world;
  if (!w.vacuum) return;
  if (!w.press) initVacuum(w);
  if (w.vacHash !== w.regionHash) {
    w.vacHash = w.regionHash;
    distanceField(w);
    // the hole: hull plating that is gone
    let missing = 0;
    for (const i of w.hull ?? []) if (!w.mat[i]) missing++;
    w.breach = missing;
  }
  const { anx, any, anz, passX, passY, passZ, press, o2, airT, smoke, smokeR, smokeG, smokeB, steam, fgas, suck } = w;
  const dist = w.vacDist;
  const sxy = anx * any;
  const holeK = 4 / Math.sqrt(Math.max(1, w.breach));
  suck.fill(0);
  let leaking = 0;
  let lost = 0;
  for (let a = 0; a < w.NA; a++) {
    const P = press[a];
    const d = dist[a];
    if (P <= 0.001) {
      // vacuum holds nothing (and keeps tiny leftovers from turning into slow denormal floats)
      o2[a] = 0;
      smoke[a] = smokeR[a] = smokeG[a] = smokeB[a] = steam[a] = fgas[a] = 0;
      continue;
    }
    if (d === Infinity) continue;
    if (d === 0) {
      press[a] = 0;
      continue;
    }
    leaking++;
    // empties in ~τ seconds: close to a big hole fast, deep inside slowly
    const tau = (0.4 + 0.07 * d) * holeK;
    const Pn = P * Math.exp(-dt / tau);
    const ratio = Pn / P;
    press[a] = Pn;
    lost += P - Pn;
    o2[a] = Math.min(o2[a] * ratio, O2_AIR * Pn);
    smoke[a] *= ratio;
    smokeR[a] *= ratio;
    smokeG[a] *= ratio;
    smokeB[a] *= ratio;
    steam[a] *= ratio;
    fgas[a] *= ratio;
    airT[a] += (-50 - airT[a]) * (1 - ratio) * 0.5; // expansion cools the gas
    // stream towards the neighbour closer to the hole
    const ax = a % anx;
    const ay = ((a - ax) / anx) % any;
    const az = (a - ax - ay * anx) / sxy;
    let best = d;
    let dir = -1;
    const cand = [
      [ax + 1 < anx, a + 1, passX[a], 0, 1],
      [ax > 0, a - 1, ax > 0 ? passX[a - 1] : 0, 0, -1],
      [ay + 1 < any, a + anx, passY[a], 1, 1],
      [ay > 0, a - anx, ay > 0 ? passY[a - anx] : 0, 1, -1],
      [az + 1 < anz, a + sxy, passZ[a], 2, 1],
      [az > 0, a - sxy, az > 0 ? passZ[a - sxy] : 0, 2, -1],
    ];
    for (let c = 0; c < 6; c++) {
      const [ok, b, p] = cand[c];
      if (ok && p > 0.25 && dist[b] < best) {
        best = dist[b];
        dir = c;
      }
    }
    if (dir >= 0) {
      const speed = Math.min(2.5 * w.ah / dt, 60 * Pn + 2);
      suck[a * 3 + cand[dir][3]] = cand[dir][4] * speed;
    }
  }
  if (leaking && !w.decompressing) {
    w.decompressing = true;
    const p = [w.size[0] / 2, w.size[1] / 2, w.size[2] / 2];
    w.events.push({ type: 'decompression', pos: p, time: w.time, name: 'hull breach' });
    w.noises.push({ p, loud: 120, time: w.time, kind: 'explosion' });
  }
  if (!leaking) w.decompressing = false;
  w.vacLoss = lost;
  // loose things near the hole are pulled out with the flow
  for (const d of w.debris) {
    const a = sim.airCellAt(...d.p);
    if (a < 0 || press[a] < 0.05) continue;
    for (let c = 0; c < 3; c++) d.v[c] += suck[a * 3 + c] * 0.6 * dt * 4;
  }
  // light loose parts (paper, fabric, tiles) right at the breach tear loose
  if (leaking && w.breach > 0 && sim.rand() < dt * 2) {
    for (let k = 0; k < w.solidCount; k += 7) {
      const i = w.solids[k];
      if (w.flags[i] & (F_FALLING | F_ANCHOR)) continue;
      const c = w.center(...w.coords(i));
      const a = sim.airCellAt(...c);
      if (a < 0 || press[a] < 0.3 || dist[a] > 3) continue;
      if (w.dens[i] < 0.5) {
        w.flags[i] |= F_FALLING;
        w.structureDirty = true;
      }
    }
  }
}

/** Pressure (0..1) at a point; 1 where the world has air. */
export function pressureAt(sim, p) {
  const w = sim.world;
  if (!w.vacuum) return 1;
  if (!w.press) initVacuum(w);
  const a = sim.airCellAt(...p);
  return a < 0 ? 0 : w.press[a];
}

/** Flow velocity of the escaping air at a point ([0,0,0] when nothing leaks). */
export function suctionAt(sim, p) {
  const w = sim.world;
  if (!w.suck) return [0, 0, 0];
  const a = sim.airCellAt(...p);
  return a < 0 ? [0, 0, 0] : [w.suck[a * 3], w.suck[a * 3 + 1], w.suck[a * 3 + 2]];
}
