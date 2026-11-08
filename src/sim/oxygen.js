import { O2_AIR } from './world.js';

/**
 * Oxygen bookkeeping per enclosed space.
 *
 * The oxygen field itself is transported like smoke (smooth, but not exactly
 * mass conserving). For fires in closed rooms what matters is the room's
 * oxygen budget, so the air cells are grouped into connected spaces through
 * their open faces. A space with no opening to the outside keeps an exact
 * inventory: fires, inerting and CO2 debit it, and after each step the local
 * field in that space is rescaled to match it. Open spaces exchange with the
 * fresh air outside as before. Spaces are recomputed when walls, doors or
 * windows change (the open fractions of the faces).
 */
export function cellAirMass(w, a) {
  return 1.2 * w.ah ** 3 * Math.max(0.1, 1 - w.occ[a]);
}

function passHash(w) {
  let h = 2166136261;
  const { passX, passY, passZ } = w;
  for (let a = 0; a < w.NA; a++) {
    const v = (passX[a] > 0.25 ? 1 : 0) | (passY[a] > 0.25 ? 2 : 0) | (passZ[a] > 0.25 ? 4 : 0);
    h = Math.imul(h ^ v, 16777619);
  }
  return h >>> 0;
}

/** Label connected air spaces; closed ones get an oxygen inventory. */
export function updateRegions(w, force = false) {
  const hsh = passHash(w);
  if (!force && w.regionHash === hsh) return;
  w.regionHash = hsh;
  const { anx, any, anz, passX, passY, passZ, occ } = w;
  const sxy = anx * any;
  const NA = w.NA;
  const region = (w.region ??= new Int32Array(NA));
  region.fill(-1);
  const open = [];
  const mass = [];
  const queue = new Int32Array(NA);
  let r = 0;
  for (let s = 0; s < NA; s++) {
    if (region[s] >= 0 || occ[s] > 0.95) continue;
    let qh = 0;
    let qt = 0;
    queue[qt++] = s;
    region[s] = r;
    let isOpen = false;
    while (qh < qt) {
      const a = queue[qh++];
      const ax = a % anx;
      const ay = ((a - ax) / anx) % any;
      const az = (a - ax - ay * anx) / sxy;
      if (ax === 0 || az === 0 || ax === anx - 1 || az === anz - 1 || ay === any - 1) isOpen = true;
      const go = (b, p) => {
        if (p > 0.25 && region[b] < 0 && occ[b] <= 0.95) {
          region[b] = r;
          queue[qt++] = b;
        }
      };
      if (ax + 1 < anx) go(a + 1, passX[a]);
      if (ax > 0) go(a - 1, passX[a - 1]);
      if (ay + 1 < any) go(a + anx, passY[a]);
      if (ay > 0) go(a - anx, passY[a - anx]);
      if (az + 1 < anz) go(a + sxy, passZ[a]);
      if (az > 0) go(a - sxy, passZ[a - sxy]);
    }
    open.push(isOpen);
    mass.push(0);
    r++;
  }
  // inventories of the closed spaces from the current field
  for (let a = 0; a < NA; a++) {
    const k = region[a];
    if (k >= 0 && !open[k]) mass[k] += w.o2[a] * cellAirMass(w, a);
  }
  w.regionOpen = open;
  w.regionO2 = mass;
}

/** Take m kg of oxygen out of cell a (and out of its closed space's inventory). */
export function takeO2(w, a, m) {
  const cm = cellAirMass(w, a);
  const o = w.o2[a] - m / cm;
  const took = (w.o2[a] - (o > 0 ? o : 0)) * cm;
  w.o2[a] = o > 0 ? o : 0;
  const k = w.region?.[a] ?? -1;
  if (k >= 0 && !w.regionOpen[k]) w.regionO2[k] = Math.max(0, w.regionO2[k] - took);
}

/** After transport: make every closed space hold exactly its inventory. */
export function conserveO2(w) {
  if (!w.region) return;
  const n = w.regionOpen.length;
  const sum = (w._regionSum ??= new Float64Array(0)).length >= n ? w._regionSum.fill(0) : (w._regionSum = new Float64Array(n * 2));
  const { region, o2 } = w;
  for (let a = 0; a < w.NA; a++) {
    const k = region[a];
    if (k >= 0 && !w.regionOpen[k]) sum[k] += o2[a] * cellAirMass(w, a);
  }
  for (let a = 0; a < w.NA; a++) {
    const k = region[a];
    if (k < 0 || w.regionOpen[k] || sum[k] <= 0) continue;
    const v = o2[a] * (w.regionO2[k] / sum[k]);
    o2[a] = v > O2_AIR ? O2_AIR : v;
  }
}

/** Re-read the inventories of the closed spaces from the field (after inerting). */
export function resyncO2(w) {
  if (!w.region) return;
  w.regionO2.fill(0);
  for (let a = 0; a < w.NA; a++) {
    const k = w.region[a];
    if (k >= 0 && !w.regionOpen[k]) w.regionO2[k] += w.o2[a] * cellAirMass(w, a);
  }
}
