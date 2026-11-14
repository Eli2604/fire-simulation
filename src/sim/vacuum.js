import { O2_AIR, F_FALLING, F_ANCHOR } from './world.js';
import { MATERIALS } from './materials.js';
import { updateRegions } from './oxygen.js';
import { toggleDoor, doorSides, doorDeltaP } from './doors.js';
import { launchVoxel } from './vessels.js';

/**
 * Decompression (worlds in space: `world.vacuum`): the hull breach of a pressure hull, the
 * mirror image of a ship's hull breached below the waterline (sim/water.js, sim/breach.js).
 * There the sea is the higher pressure and comes in; here the cabin air is, and goes out.
 *
 *  - Inside the hull (`w.inside`: what the outside cannot reach while the hull is whole) the
 *    air cells are grouped into compartments: connected through open faces, separated by
 *    closed doors and bulkheads. Each compartment has one pressure `P` (1 = cabin pressure,
 *    101.3 kPa): a pressure wave crosses a room in milliseconds. When a door opens between two
 *    compartments they mix: the pressure becomes their volume-weighted mean (mass conserved).
 *  - A hole is where a compartment's air meets the outside (hull plating gone, a window shot
 *    out, the outer airlock door open). Through it the air leaves as a choked jet (isentropic
 *    nozzle flow, the outside being vacuum: the pressure ratio is always under the critical
 *    0.528): ṁ = Cd·A·p·√(γ/RT)·(2/(γ+1))^((γ+1)/(2(γ−1))). The pressure falls as
 *    exp(−t/τ), τ = V / (Cd·A·0.685·√(RT)): a 1 m² hole empties 100 m³ in ~1 s, a 0.1 m² one
 *    in ~8 s. Anything stuck in the hole (sim/breach.js) takes its area away while it holds.
 *  - The air's velocity converges on the hole: every cell's air, and all the air that comes
 *    through it from farther away, goes on towards the hole (by the shortest path through
 *    open faces), so the volume flow through a cell is (the volume upstream of it) / τ and
 *    its speed that over the face it passes: slow in the far corners, fast in a doorway on
 *    the way, fastest in the hole (the jet, Q/A, up to the speed of sound). That field
 *    (`w.blow`, m/s) drags loose things, debris, bodies out (sim/breach.js), and a capped
 *    copy (`w.suck`) carries the smoke out in the air model.
 *  - Oxygen goes with the air (a fire goes out), the gas cools as it expands
 *    (T ∝ p^((γ−1)/γ)), the vapour in it condenses: a fog flash in the compartment, a white
 *    plume out of the hole.
 *  - Doors between compartments: interior doors close themselves (`autoSeal`) once their
 *    compartment loses pressure (unless something is in the doorway); a closed door holds
 *    the pressure difference: it cannot be opened against it by hand, its equalising valve
 *    lets the air through first (subsonic or choked orifice flow, by the pressure ratio),
 *    and the door opens once the two sides are level. A door weakened (burnt, blown partly
 *    away) bursts when the difference is more than it can take.
 *
 * The walk-through pulls you towards the hole too, and hurts you when the pressure is gone
 * (your breathing apparatus gives you air, not pressure).
 */
const P0 = 101325;
const RGAS = 287;
const GAMMA = 1.4;
const CD = 0.62; // a sharp-edged hole
const CRIT = (2 / (GAMMA + 1)) ** (GAMMA / (GAMMA - 1)); // 0.528
const VALVE = 0.1; // a door's equalising valve (m²)

/**
 * Mass flow (kg/s) through an orifice of area A (m²) from pUp to pDown (Pa), gas at T (K):
 * subsonic by the pressure ratio, choked below the critical ratio.
 */
export function orificeMassFlow(pUp, pDown, A, T) {
  if (!(pUp > pDown) || A <= 0) return 0;
  const r = Math.max(pDown / pUp, CRIT);
  return CD * A * pUp * Math.sqrt(((2 * GAMMA) / ((GAMMA - 1) * RGAS * T)) * (r ** (2 / GAMMA) - r ** ((GAMMA + 1) / GAMMA)));
}

export function initVacuum(w) {
  updateRegions(w, true);
  const { anx, any, anz, passX, passY, passZ, occ, NA } = w;
  const sxy = anx * any;
  // inside the hull: what the outside cannot reach through open faces (the hull whole)
  const reach = new Uint8Array(NA);
  const q = new Int32Array(NA);
  let qh = 0;
  let qt = 0;
  for (let az = 0; az < anz; az++)
    for (let ay = 0; ay < any; ay++)
      for (let ax = 0; ax < anx; ax++) {
        if (ax && az && ay && ax < anx - 1 && az < anz - 1 && ay < any - 1) continue;
        const a = ax + anx * (ay + any * az);
        if (occ[a] > 0.95) continue;
        reach[a] = 1;
        q[qt++] = a;
      }
  while (qh < qt) {
    const a = q[qh++];
    const ax = a % anx;
    const ay = ((a - ax) / anx) % any;
    const az = (a - ax - ay * anx) / sxy;
    const go = (b, p) => {
      if (p > 0.25 && !reach[b] && occ[b] <= 0.95) {
        reach[b] = 1;
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
  w.inside = new Uint8Array(NA);
  w.press = new Float32Array(NA);
  w.pressLive = new Uint8Array(NA); // cells whose pressure is real air (not a door just opened)
  for (let a = 0; a < NA; a++) {
    w.inside[a] = reach[a] ? 0 : 1;
    const air = !reach[a] && occ[a] <= 0.95;
    w.press[a] = air ? 1 : 0;
    w.pressLive[a] = air ? 1 : 0;
    if (reach[a]) {
      w.o2[a] = 0;
      w.smoke[a] = w.smokeR[a] = w.smokeG[a] = w.smokeB[a] = w.steam[a] = 0;
    }
  }
  w.suck = new Float32Array(NA * 3);
  w.blow = new Float32Array(NA * 3);
  w.comp = new Int32Array(NA).fill(-1);
  w.vacDist = new Float32Array(NA).fill(Infinity);
  w.flowDir = new Float32Array(NA * 3);
  w.comps = [];
  w.holes = [];
  w.vacHash = -1;
  w.breach = 0;
  w.decompressing = false;
  // the doors inside the hull close themselves on a pressure drop; the hull's own (the outer
  // airlock door) do not
  w.doors.forEach((d) => {
    const s = doorSides(w, d);
    d.autoSeal = s[0] >= 0 && s[1] >= 0 && !!w.inside[s[0]] && !!w.inside[s[1]];
    d.metal = d.voxels.length > 0 && /steel|alumin|iron/i.test(MATERIALS[w.mat[d.voxels[0]]]?.name ?? '');
  });
}

/** Is p inside the pressure hull (what was sealed off from space while the hull was whole)? */
export function inHull(w, p) {
  if (!w.inside) return true;
  const ax = Math.floor(p[0] / w.ah);
  const ay = Math.floor(p[1] / w.ah);
  const az = Math.floor(p[2] / w.ah);
  if (ax < 0 || ay < 0 || az < 0 || ax >= w.anx || ay >= w.any || az >= w.anz) return false;
  return !!w.inside[w.airIdx(ax, ay, az)];
}

/** Compartments, their holes, and the flow paths to the holes (when walls, doors or windows changed). */
function rebuild(w) {
  const { anx, any, anz, passX, passY, passZ, occ, inside, NA, ah } = w;
  const sxy = anx * any;
  const comp = w.comp.fill(-1);
  const q = (w._vacQ ??= new Int32Array(NA));
  const comps = [];
  const air = (a) => occ[a] <= 0.95;
  const nbrs = (a, f) => {
    const ax = a % anx;
    const ay = ((a - ax) / anx) % any;
    const az = (a - ax - ay * anx) / sxy;
    // f(b, pass, axis, sign); b = -1: the edge of the domain (outside)
    f(ax + 1 < anx ? a + 1 : -1, ax + 1 < anx ? passX[a] : 1, 0, 1);
    f(ax > 0 ? a - 1 : -1, ax > 0 ? passX[a - 1] : 1, 0, -1);
    f(ay + 1 < any ? a + anx : -1, ay + 1 < any ? passY[a] : 1, 1, 1);
    f(ay > 0 ? a - anx : -1, ay > 0 ? passY[a - anx] : 1, 1, -1);
    f(az + 1 < anz ? a + sxy : -1, az + 1 < anz ? passZ[a] : 1, 2, 1);
    f(az > 0 ? a - sxy : -1, az > 0 ? passZ[a - sxy] : 1, 2, -1);
  };
  const center = (a) => {
    const ax = a % anx;
    const ay = ((a - ax) / anx) % any;
    const az = (a - ax - ay * anx) / sxy;
    return [(ax + 0.5) * ah, (ay + 0.5) * ah, (az + 0.5) * ah];
  };
  for (let s = 0; s < NA; s++) {
    if (comp[s] >= 0 || !inside[s] || !air(s)) continue;
    const k = comps.length;
    const C = { cells: [], V: 0, holeFaces: [], P: 1, T: 293, breached: false, A: 0, rate: 0, uHole: 0 };
    comps.push(C);
    let qh = 0;
    let qt = 0;
    q[qt++] = s;
    comp[s] = k;
    while (qh < qt) {
      const a = q[qh++];
      C.cells.push(a);
      C.V += ah ** 3 * Math.max(0.1, 1 - occ[a]);
      nbrs(a, (b, p, axis, sign) => {
        if (p <= 0.25) return;
        if (b < 0 || (!inside[b] && air(b))) C.holeFaces.push({ a, b, area: p * ah * ah, axis, sign });
        else if (inside[b] && air(b) && comp[b] < 0) {
          comp[b] = k;
          q[qt++] = b;
        }
      });
    }
  }
  // the holes: the hole faces in clusters (cells next to each other)
  const holes = [];
  const dist = w.vacDist.fill(Infinity);
  const dir = w.flowDir.fill(0);
  comps.forEach((C, k) => {
    C.breached = C.holeFaces.length > 0;
    if (!C.breached) return;
    const byCell = new Map();
    for (const f of C.holeFaces) {
      if (!byCell.has(f.a)) byCell.set(f.a, []);
      byCell.get(f.a).push(f);
    }
    const done = new Set();
    for (const a0 of byCell.keys()) {
      if (done.has(a0)) continue;
      const H = { id: holes.length, comp: k, area: 0, c: [0, 0, 0], n: [0, 0, 0], cells: [], outs: [], plugArea: 0 };
      const stack = [a0];
      done.add(a0);
      while (stack.length) {
        const a = stack.pop();
        H.cells.push(a);
        const ca = center(a);
        for (const f of byCell.get(a)) {
          const fc = ca.slice();
          fc[f.axis] += (f.sign * ah) / 2;
          for (let c = 0; c < 3; c++) H.c[c] += fc[c] * f.area;
          H.n[f.axis] += f.sign * f.area;
          H.area += f.area;
          if (f.b >= 0) H.outs.push(f.b);
        }
        // neighbouring hole cells (26-neighbourhood) are the same hole
        const ax = a % anx;
        const ay = ((a - ax) / anx) % any;
        const az = (a - ax - ay * anx) / sxy;
        for (let dz = -1; dz <= 1; dz++)
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const x = ax + dx;
              const y = ay + dy;
              const z = az + dz;
              if (x < 0 || y < 0 || z < 0 || x >= anx || y >= any || z >= anz) continue;
              const b = x + anx * (y + any * z);
              if (byCell.has(b) && !done.has(b)) {
                done.add(b);
                stack.push(b);
              }
            }
      }
      for (let c = 0; c < 3; c++) H.c[c] /= H.area;
      const nl = Math.hypot(...H.n) || 1;
      H.n = H.n.map((v) => v / nl);
      holes.push(H);
    }
    // distance (through open faces) from the holes, and the fronts of equal distance
    let qh = 0;
    let qt = 0;
    for (const a of byCell.keys()) {
      dist[a] = 0;
      q[qt++] = a;
    }
    while (qh < qt) {
      const a = q[qh++];
      const d = dist[a] + 1;
      nbrs(a, (b, p) => {
        if (b >= 0 && p > 0.25 && comp[b] === k && dist[b] > d) {
          dist[b] = d;
          q[qt++] = b;
        }
      });
    }
    // the air's way out: the air of every cell expands at the rate 1/τ and flows off towards
    // the hole. With φ the flow potential (u = −∇φ · 1/τ), ∇²φ = −1 in the compartment, φ = 0
    // outside the hole, no flow through walls: solved by over-relaxation, from the 1-D estimate
    // along the path (the volume beyond each front over the front's area) or from the last
    // solution. Where the way narrows (a doorway, the hole) all of it has to pass: there it is
    // fastest; in the far corners it hardly moves.
    let pmax = 0;
    for (const a of C.cells) if (w.press[a] > pmax) pmax = w.press[a];
    if (pmax < 0.002) return; // (nothing left to flow)
    let dmax = 0;
    for (const a of C.cells) if (dist[a] < Infinity) dmax = Math.max(dmax, dist[a]);
    const front = new Float64Array(dmax + 2);
    const vol = new Float64Array(dmax + 2);
    for (const a of C.cells) {
      front[dist[a]] += ah * ah;
      vol[dist[a]] += ah ** 3 * Math.max(0.1, 1 - occ[a]);
    }
    for (let d = dmax - 1; d >= 0; d--) vol[d] += vol[d + 1];
    const seed = new Float64Array(dmax + 2);
    seed[0] = (0.5 * ah * vol[0]) / front[0];
    for (let d = 1; d <= dmax; d++) seed[d] = seed[d - 1] + (ah * vol[d]) / front[d];
    const n = C.cells.length;
    const local = (w._vacLocal ??= new Int32Array(NA));
    C.cells.forEach((a, j) => (local[a] = j));
    const nb = new Int32Array(n * 6).fill(-2); // -2: wall, -1: the outside (φ = 0)
    const np = new Float32Array(n * 6);
    const src = new Float64Array(n);
    const phi = new Float64Array(n);
    const prev = (w.vacPhi ??= new Float32Array(NA));
    let warm = 0;
    C.cells.forEach((a, j) => {
      src[j] = ah * ah * Math.max(0.1, 1 - occ[a]);
      if (prev[a] > 0) warm++;
      phi[j] = prev[a] > 0 ? prev[a] : seed[dist[a]];
      let s = 0;
      nbrs(a, (b, p) => {
        if (p > 0.25) {
          if (b < 0 || (!inside[b] && air(b))) nb[j * 6 + s] = -1;
          else if (comp[b] === k) nb[j * 6 + s] = local[b];
          np[j * 6 + s] = p;
        }
        s++;
      });
    });
    C.solver = { n, nb, np, src, phi };
    // (from the last solution a few sweeps do; from the estimate, more: and it goes on being
    // refined every step while the air flows, stepVacuum)
    solveFlow(w, C, warm > n * 0.8 ? 20 : 60);
  });
  w.comps = comps;
  w.holes = holes;
}

/**
 * Sweeps of over-relaxation of the flow potential of a compartment (C.solver), then the
 * velocity per unit of 1/τ in each of its cells: the mean over its faces on each axis.
 */
function solveFlow(w, C, sweeps) {
  const S = C.solver;
  if (!S) return;
  const { n, nb, np, src, phi } = S;
  for (let it = 0; it < sweeps; it++) {
    let worst = 0;
    for (let j = 0; j < n; j++) {
      let sp = 0;
      let s = src[j];
      const o = j * 6;
      for (let f = 0; f < 6; f++) {
        const b = nb[o + f];
        if (b === -2) continue;
        const p = np[o + f];
        sp += p;
        if (b >= 0) s += p * phi[b];
      }
      if (sp <= 0) continue;
      const dv = s / sp - phi[j];
      phi[j] += 1.85 * dv;
      const r = dv < 0 ? -dv / (phi[j] + 1e-9) : dv / (phi[j] + 1e-9);
      if (r > worst) worst = r;
    }
    if (worst < 1e-5) break;
  }
  const dir = w.flowDir;
  const prev = w.vacPhi;
  const ah = w.ah;
  for (let j = 0; j < n; j++) {
    const a = C.cells[j];
    prev[a] = phi[j];
    for (let ax = 0; ax < 3; ax++) {
      // (faces in the order of nbrs: +x, −x, +y, −y, +z, −z)
      const bp = nb[j * 6 + ax * 2];
      const bm = nb[j * 6 + ax * 2 + 1];
      let u = 0;
      if (bp !== -2) u += (phi[j] - (bp >= 0 ? phi[bp] : 0)) / ah;
      if (bm !== -2) u -= (phi[j] - (bm >= 0 ? phi[bm] : 0)) / ah;
      dir[a * 3 + ax] = u / 2;
    }
  }
}

/** The compartment's pressure (the mean over its cells that held air already) and temperature (K). */
function measure(w, C) {
  let s = 0;
  let n = 0;
  let T = 0;
  for (const a of C.cells) {
    if (!w.pressLive[a]) continue;
    s += w.press[a];
    T += w.airT[a];
    n++;
  }
  C.P = n ? s / n : 0;
  C.T = (n ? T / n : 20) + 273.15;
}

export function stepVacuum(sim, dt) {
  const w = sim.world;
  if (!w.vacuum) return;
  if (!w.press) initVacuum(w);
  if (!(dt > 0)) return;
  if (w.vacHash !== w.regionHash) {
    w.vacHash = w.regionHash;
    const before = w.holes;
    rebuild(w);
    // the hole: hull plating that is gone
    let missing = 0;
    for (const i of w.hull ?? []) if (!w.mat[i]) missing++;
    w.breach = missing;
    // what is stuck in a hole stays stuck in it (the same hole, numbered anew); a hole that has
    // gone lets it go (sim/breach.js)
    for (const o of [...(w.loose ?? []), ...(w.enemies ?? [])]) {
      if (o.plug == null) continue;
      const old = before?.[o.plug];
      const H = old && w.holes.find((x) => Math.hypot(x.c[0] - old.c[0], x.c[1] - old.c[1], x.c[2] - old.c[2]) < 0.6);
      o.plug = H ? H.id : null;
      if (!H) o.swept = true;
    }
  }
  const { NA, press, o2, airT, smoke, smokeR, smokeG, smokeB, steam, fgas, suck, blow, ah } = w;
  const comps = w.comps;
  for (const C of comps) measure(w, C);
  // the flow paths go on being refined while the air flows
  for (const C of comps) if (C.breached && C.solver && C.P > 0.002) solveFlow(w, C, 4);
  // the air leaving through the holes (what is stuck in them takes its area away)
  let leaking = 0;
  let lost = 0;
  for (const C of comps) C.A = 0;
  for (const H of w.holes) comps[H.comp].A += Math.max(0, H.area - H.plugArea);
  for (const C of comps) {
    C.P1 = C.Pm = C.P;
    C.rate = 0;
    C.uHole = 0;
    if (!C.breached || C.P <= 0) continue;
    const m = (C.P * P0 * C.V) / (RGAS * C.T);
    const mdot = orificeMassFlow(C.P * P0, 0, C.A, C.T);
    C.rate = mdot / m; // 1/τ
    C.P1 = C.P * Math.exp(-dt * C.rate);
    if (C.P1 < 0.002) C.P1 = 0;
    // (its mean over the step: what the things in the flow feel, sim/breach.js)
    C.Pm = C.rate * dt > 1e-6 ? (C.P * (1 - Math.exp(-dt * C.rate))) / (dt * C.rate) : C.P1;
    // the jet in the hole: the volume flow through what is left of it
    C.uHole = C.A > 0 ? Math.min(330, (mdot / ((C.P * P0) / (RGAS * C.T))) / C.A) : 0;
    lost += (C.P - C.P1) * C.V;
    if (C.P > 0.01) leaking++;
  }
  // the doors' equalising valves: the air through a closed door from the higher side
  for (const d of w.doors) {
    if (!d.equalize || d.open) continue;
    const [sa, sb] = doorSides(w, d);
    const A = comps[w.comp[sa]];
    const B = comps[w.comp[sb]];
    if (!A || !B || A === B) {
      d.equalize = false;
      continue;
    }
    const [hi, lo] = A.P1 >= B.P1 ? [A, B] : [B, A];
    hi.Pm = hi.P1;
    lo.Pm = lo.P1;
    if (hi.P1 - lo.P1 < 0.05) {
      d.equalize = false;
      toggleDoor(sim, w.doors.indexOf(d), true, { force: true });
      continue;
    }
    const T = (hi.T + lo.T) / 2;
    const dm = Math.min(orificeMassFlow(hi.P1 * P0, lo.P1 * P0, VALVE, T) * dt, ((hi.P1 - lo.P1) * P0 * hi.V * lo.V) / (RGAS * T * (hi.V + lo.V)));
    hi.P1 -= (dm * RGAS * T) / (P0 * hi.V);
    lo.P1 += (dm * RGAS * T) / (P0 * lo.V);
  }
  // write the compartments back into the cells
  blow.fill(0);
  suck.fill(0);
  const cap = (2.5 * ah) / dt; // (what the air model can carry in a step)
  const fogMass = 0.005 * ah ** 3; // the water vapour of a cell of cabin air (kg)
  for (let a = 0; a < NA; a++) {
    const k = w.comp[a];
    if (k < 0) {
      w.pressLive[a] = 0;
      press[a] = 0;
      if (!w.inside[a]) {
        // space: nothing stays (the plume out of a hole thins out fast)
        o2[a] = 0;
        fgas[a] = 0;
        if (smoke[a] > 1e-9 || steam[a] > 1e-9) {
          const f = Math.exp(-dt / 0.4);
          smoke[a] *= f;
          smokeR[a] *= f;
          smokeG[a] *= f;
          smokeB[a] *= f;
          steam[a] *= f;
        } else smoke[a] = smokeR[a] = smokeG[a] = smokeB[a] = steam[a] = 0;
      }
      continue;
    }
    const C = comps[k];
    w.pressLive[a] = 1;
    press[a] = C.P1;
    if (C.P1 <= 0.001) {
      // vacuum holds nothing (and keeps tiny leftovers from turning into slow denormal floats)
      o2[a] = 0;
      smoke[a] = smokeR[a] = smokeG[a] = smokeB[a] = steam[a] = fgas[a] = 0;
      continue;
    }
    if (C.P1 === C.P) continue;
    const ratio = C.P > 0 ? C.P1 / C.P : 1;
    if (ratio < 1) {
      o2[a] = Math.min(o2[a] * ratio, O2_AIR * C.P1);
      smoke[a] *= ratio;
      smokeR[a] *= ratio;
      smokeG[a] *= ratio;
      smokeB[a] *= ratio;
      steam[a] *= ratio;
      fgas[a] *= ratio;
      // the gas cools as it expands (adiabatic), the vapour in it condenses: a fog
      const TK = Math.max(200, (airT[a] + 273.15) * ratio ** ((GAMMA - 1) / GAMMA));
      airT[a] = TK - 273.15;
      if (airT[a] < 3 && C.rate > 0.05) steam[a] = Math.max(steam[a], fogMass * C.P1);
    } else {
      // (air let in through a valve: it warms as it is compressed)
      o2[a] = Math.min(O2_AIR * C.P1, o2[a] + O2_AIR * (C.P1 - C.P));
      airT[a] = (airT[a] + 273.15) * ratio ** ((GAMMA - 1) / GAMMA) - 273.15;
    }
    // the flow towards the holes
    if (C.rate > 0 && w.vacDist[a] < Infinity) {
      const fx = w.flowDir[a * 3];
      const fy = w.flowDir[a * 3 + 1];
      const fz = w.flowDir[a * 3 + 2];
      const m = Math.hypot(fx, fy, fz);
      if (m > 0) {
        // (no faster than the jet in the hole itself)
        const u = Math.min(C.uHole, m * C.rate);
        const uc = Math.min(u, cap, 60 * C.P1 + 2);
        blow[a * 3] = (fx / m) * u;
        blow[a * 3 + 1] = (fy / m) * u;
        blow[a * 3 + 2] = (fz / m) * u;
        suck[a * 3] = (fx / m) * uc;
        suck[a * 3 + 1] = (fy / m) * uc;
        suck[a * 3 + 2] = (fz / m) * uc;
      }
    }
  }
  // the plume out of each hole: the air streaming out, a white cloud of condensed vapour
  for (const H of w.holes) {
    const C = comps[H.comp];
    if (!(C.rate > 0) || C.P1 <= 0.001) continue;
    const u = C.uHole * 0.5;
    const uc = Math.min(u, cap);
    for (const b of H.outs) {
      for (let c = 0; c < 3; c++) {
        blow[b * 3 + c] = H.n[c] * u;
        suck[b * 3 + c] = H.n[c] * uc;
      }
      steam[b] = Math.max(steam[b], fogMass * Math.min(1, C.P1 * 2));
    }
  }
  if (leaking && !w.decompressing) {
    w.decompressing = true;
    const H = w.holes.find((x) => comps[x.comp].P > 0.01);
    const p = H ? H.c.slice() : [w.size[0] / 2, w.size[1] / 2, w.size[2] / 2];
    w.events.push({ type: 'decompression', pos: p, time: w.time, name: 'hull breach' });
    w.noises.push({ p, loud: 120, time: w.time, kind: 'explosion' });
  }
  if (!leaking) w.decompressing = false;
  w.vacLoss = lost;
  stepPressureDoors(sim, dt);
  // light loose parts (paper, fabric, tiles) right at the breach tear loose
  if (leaking && w.breach > 0 && sim.rand() < dt * 2) {
    for (let k = 0; k < w.solidCount; k += 7) {
      const i = w.solids[k];
      if (w.flags[i] & (F_FALLING | F_ANCHOR)) continue;
      const c = w.center(...w.coords(i));
      const a = sim.airCellAt(...c);
      if (a < 0 || press[a] < 0.3 || w.vacDist[a] > 3) continue;
      if (w.dens[i] < 0.5) {
        w.flags[i] |= F_FALLING;
        w.structureDirty = true;
      }
    }
  }
}

/** Is anything (a loose object, a soldier, you) standing in this doorway? */
function doorwayBlocked(sim, d) {
  const w = sim.world;
  const near = (p, up = 0) => Math.hypot(p[0] - d.center[0], p[2] - d.center[2]) < 0.6 && p[1] + up > d.center[1] - 1.3 && p[1] < d.center[1] + 1.2;
  for (const o of w.loose ?? []) if (!o.gone && !o.drift && near(o.p)) return true;
  for (const e of w.enemies ?? []) if (!e.devoured && !e.drift && near(e.p, 1)) return true;
  const pl = sim.ai?.player;
  return !!(pl?.p && near(pl.p, 1));
}

/**
 * The doors and the pressure: an interior door whose compartment is losing its air closes
 * itself (the doorway clear); a closed door weakened by fire or a blast bursts when the
 * difference across it is more than it can take (its plating towards the low side).
 */
function stepPressureDoors(sim, dt) {
  const w = sim.world;
  const comps = w.comps;
  w.doors.forEach((d, k) => {
    if (d.blown) return;
    const [sa, sb] = doorSides(w, d);
    if (d.open) {
      if (!d.autoSeal || w.autoSeal === false) return;
      const C = comps[w.comp[sa]] ?? comps[w.comp[sb]];
      if (C?.breached && C.P1 > 0.02 && C.rate > 0) {
        d.sealT = (d.sealT ?? 0) + dt;
        if (d.sealT > 0.7 && !doorwayBlocked(sim, d)) {
          toggleDoor(sim, k, false);
          const e = w.events[w.events.length - 1];
          if (e?.type === 'doorClose') e.slam = true;
          w.noises.push({ p: d.center.slice(), loud: 60, time: w.time, kind: 'door' });
          d.sealT = 0;
        }
      } else d.sealT = 0;
      return;
    }
    const dp = doorDeltaP(w, d);
    if (dp < 0.05) return;
    // what is left of it (burnt, blown partly away): its strength goes with the square
    let left = 0;
    for (const i of d.voxels) if (w.mat[i] && w.doorTag[i] === k + 1) left++;
    const f = d.voxels.length ? left / d.voxels.length : 0;
    const rating = (d.metal ? 2.0 : 0.4) * f * f; // (a metal door holds 2 bar; a wooden or glass one far less)
    if (dp <= rating) return;
    const hiSide = w.press[sa] >= w.press[sb] ? sa : sb;
    const loSide = hiSide === sa ? sb : sa;
    const ph = centerOf(w, hiSide);
    const pl = centerOf(w, loSide);
    const n = pl.map((v, c) => v - ph[c]);
    const nl = Math.hypot(...n) || 1;
    const sp = 10 + 25 * dp;
    for (const i of d.voxels)
      if (w.mat[i] && w.doorTag[i] === k + 1) launchVoxel(w, i, n.map((v) => (v / nl) * sp * (0.7 + 0.6 * sim.rand())));
    d.blown = true;
    d.open = true;
    d.saved = [];
    w.events.push({ type: 'explosion', pos: d.center.slice(), time: w.time, name: `${d.name} (blown out by the pressure)` });
    w.noises.push({ p: d.center.slice(), loud: 90, time: w.time, kind: 'explosion' });
  });
}

function centerOf(w, a) {
  const ax = a % w.anx;
  const ay = ((a - ax) / w.anx) % w.any;
  const az = (a - ax - ay * w.anx) / (w.anx * w.any);
  return [(ax + 0.5) * w.ah, (ay + 0.5) * w.ah, (az + 0.5) * w.ah];
}

/** Pressure (0..1) at a point; 1 where the world has air. */
export function pressureAt(sim, p) {
  const w = sim.world;
  if (!w.vacuum) return 1;
  if (!w.press) initVacuum(w);
  const a = sim.airCellAt(...p);
  return a < 0 ? 0 : w.press[a];
}

/** Flow velocity of the escaping air at a point, as the air model carries it ([0,0,0] when nothing leaks). */
export function suctionAt(sim, p) {
  const w = sim.world;
  if (!w.suck) return [0, 0, 0];
  const a = sim.airCellAt(...p);
  return a < 0 ? [0, 0, 0] : [w.suck[a * 3], w.suck[a * 3 + 1], w.suck[a * 3 + 2]];
}
