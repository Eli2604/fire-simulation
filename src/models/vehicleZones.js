/**
 * The hit parts of the vehicles (car, jet, boat): where a hit lands on each and what it does there.
 * The rig's Car / Jet / Boat objects (rig/vehicles.js) show and edit these tables; the simulation
 * does not use them yet (a car burns from its voxels, the jet's flight model in walk/flight.js keeps
 * its own five parts: `sim` names the one each zone stands for), so they are here for it to take up.
 *
 * Frame of each vehicle (as its model / mesh): front towards +x, left -z, up +y; the car and jet
 * stand on y = 0, the boat floats with its waterline at y = 0. Every zone is one or more boxes
 * ({ c: centre, h: half extents }, in metres for the vehicle's default size, VEHICLE_DIMS); a
 * `shape: 'cyl'` zone is a cylinder along its `axis` inside each box (tyres, engines). Editable
 * like the soldier's ZONES: `size` scales the cross-section, `len` the long axis, `mult` the damage.
 *
 *   const Z = vehicleZones('car');                // resolved boxes (a scaled car: pass its dims)
 *   zoneAt('car', [1.4, 0.6, 0])?.k               // 'engine'
 *   rayZone('jet', from, dir)                     // { k, zone, t, p } of the first part hit, or null
 *   hitPart(dmg, 'boat', 'hull', 120)             // the hull 60% gone: { k, amount, value, destroyed }
 */

/** Length (x), height (y) and width (z) of each vehicle as the tables are drawn for. */
export const VEHICLE_DIMS = {
  car: [4.2, 1.45, 1.8], // models/car.js defaults
  jet: [17.4, 4.5, 11.2], // render/jetMesh.js
  boat: [4.8, 1.4, 1.84], // rig/vehicleMeshes.js (the size of the island's boat)
};

/**
 * Per vehicle, its parts. Order matters: a point inside two zones belongs to the first
 * (the fuel tank before the cabin it sits under). `hp`: how much it takes to destroy the part
 * (bullet 25, rocket 350 before `mult`); `effect`: what the part does when it goes.
 */
export const VEHICLE_ZONES = {
  car: [
    { k: 'fuel', label: 'Fuel tank', boxes: [{ c: [-0.96, 0.48, 0], h: [0.3, 0.2, 0.52] }], mult: 2, hp: 60, color: '#ff7a1a', effect: 'leaks, then catches fire', sim: 'fuelTank' },
    { k: 'engine', label: 'Engine', boxes: [{ c: [1.47, 0.58, 0], h: [0.6, 0.3, 0.62] }], mult: 1.5, hp: 120, color: '#ffcc33', effect: 'stalls, smokes; destroyed it burns', sim: 'engine' },
    { k: 'tyres', label: 'Tyres', shape: 'cyl', axis: 'z', boxes: [-1, 1].flatMap((s) => [1.344, -1.344].map((x) => ({ c: [x, 0.33, s * 0.79], h: [0.33, 0.33, 0.11] }))), mult: 0.6, hp: 30, color: '#5ad1ff', effect: 'goes flat: the car sags on that corner' },
    { k: 'cabin', label: 'Cabin (occupants)', boxes: [{ c: [-0.21, 0.97, 0], h: [1.05, 0.48, 0.84] }], mult: 1, hp: 100, color: '#8fe36a', effect: 'glass shatters, the occupants are hit' },
  ],
  jet: [
    { k: 'cockpit', label: 'Cockpit (pilot)', boxes: [{ c: [3.6, 2.2, 0], h: [1.25, 0.45, 0.55] }], mult: 3, hp: 40, color: '#8fe36a', effect: 'canopy shattered, the pilot is hit' },
    { k: 'fuel', label: 'Fuel tanks', boxes: [{ c: [0.6, 1.75, 0], h: [1.0, 0.3, 0.5] }, { c: [-2.0, 1.7, 0], h: [1.2, 0.28, 0.5] }], mult: 2, hp: 80, color: '#ff7a1a', effect: 'leaks: runs dry, then burns', sim: 'fuel' },
    { k: 'engines', label: 'Engines', shape: 'cyl', axis: 'x', boxes: [-1, 1].map((s) => ({ c: [-4.3, 1.42, s * 0.95], h: [2.7, 0.45, 0.45] })), mult: 1.5, hp: 120, color: '#ffcc33', effect: 'less thrust, smoke, then an engine fire', sim: 'engine' },
    { k: 'tail', label: 'Tail (fins, tailplanes)', boxes: [{ c: [-5.6, 3.1, 0], h: [1.15, 1.4, 1.25] }, ...[-1, 1].map((s) => ({ c: [-6.3, 1.53, s * 2.6], h: [0.9, 0.12, 1.1] }))], mult: 1, hp: 120, color: '#c58cff', effect: 'sluggish, wobbly; destroyed it is shot away', sim: 'tail' },
    { k: 'wingL', label: 'Left wing (wing tank)', boxes: [{ c: [-2.3, 1.58, -3.55], h: [1.9, 0.14, 2.05] }], mult: 1, hp: 150, color: '#5ad1ff', effect: 'less lift, it rolls; destroyed it is torn off', sim: 'wingL' },
    { k: 'wingR', label: 'Right wing (wing tank)', boxes: [{ c: [-2.3, 1.58, 3.55], h: [1.9, 0.14, 2.05] }], mult: 1, hp: 150, color: '#5ad1ff', effect: 'less lift, it rolls; destroyed it is torn off', sim: 'wingR' },
  ],
  boat: [
    { k: 'fuel', label: 'Fuel tank', boxes: [{ c: [-1.75, 0.2, 0.5], h: [0.25, 0.15, 0.2] }], mult: 2, hp: 40, color: '#ff7a1a', effect: 'leaks, then catches fire' },
    { k: 'engine', label: 'Engine (outboard)', boxes: [{ c: [-2.6, 0.35, 0], h: [0.25, 0.55, 0.2] }], mult: 1.5, hp: 60, color: '#ffcc33', effect: 'stops, smokes; destroyed it burns' },
    { k: 'cabin', label: 'Cabin (crew)', boxes: [{ c: [0.45, 0.95, 0], h: [0.7, 0.42, 0.66] }], mult: 1, hp: 80, color: '#8fe36a', effect: 'windows shatter, the crew is hit' },
    { k: 'hull', label: 'Hull', boxes: [{ c: [0, 0.05, 0], h: [2.45, 0.5, 0.92] }], mult: 1, hp: 200, color: '#5ad1ff', effect: 'holed: it settles lower; destroyed it sinks' },
  ],
};
for (const zs of Object.values(VEHICLE_ZONES)) for (const z of zs) {
    z.size ??= 1;
    z.len ??= 1;
  }

/** The weapons a hit part can be struck with, and their base damage. */
export const VEHICLE_WEAPONS = { bullet: 25, shell: 120, rocket: 350 };

const LONG = (h) => (h[0] >= h[1] && h[0] >= h[2] ? 0 : h[1] >= h[2] ? 1 : 2);

/**
 * The zones of a vehicle as boxes in its frame, with their `size` / `len` applied, scaled to
 * `dims` ([length, height, width]; default: the size the table is drawn for).
 * @returns {{ k: string, zone: object, shape: string, axis?: string, boxes: { c: number[], h: number[] }[] }[]}
 */
export function vehicleZones(kind, dims = VEHICLE_DIMS[kind]) {
  const base = VEHICLE_DIMS[kind];
  const zs = VEHICLE_ZONES[kind];
  if (!zs) return [];
  const s = [0, 1, 2].map((i) => (dims?.[i] ?? base[i]) / base[i]);
  return zs.map((z) => {
    const boxes = z.boxes.map((b) => {
      const l = z.shape === 'cyl' ? 'xyz'.indexOf(z.axis) : LONG(b.h);
      return { c: b.c.map((v, i) => v * s[i]), h: b.h.map((v, i) => v * s[i] * (i === l ? z.len : z.size)) };
    });
    return { k: z.k, zone: z, shape: z.shape ?? 'box', axis: z.axis, boxes };
  });
}

/** Is p (vehicle frame) inside box b of a zone of this shape? */
function inside(p, b, shape, axis) {
  const d = [0, 1, 2].map((i) => (p[i] - b.c[i]) / b.h[i]);
  if (d.some((v) => Math.abs(v) > 1)) return false;
  if (shape !== 'cyl') return true;
  const a = 'xyz'.indexOf(axis);
  const [u, v] = [0, 1, 2].filter((i) => i !== a);
  return d[u] * d[u] + d[v] * d[v] <= 1;
}

/** The part at point p (vehicle frame), or null. */
export function zoneAt(kind, p, dims) {
  for (const Z of vehicleZones(kind, dims)) if (Z.boxes.some((b) => inside(p, b, Z.shape, Z.axis))) return { k: Z.k, zone: Z.zone };
  return null;
}

/**
 * The first part a ray hits (vehicle frame): { k, zone, t, p } or null. A cylinder is tested as
 * its box, then the point is checked inside it (a ray past the round edge goes on to the next).
 */
export function rayZone(kind, from, dir, maxT = 1000, dims) {
  let best = null;
  for (const Z of vehicleZones(kind, dims))
    for (const b of Z.boxes) {
      let t0 = 0;
      let t1 = maxT;
      for (let i = 0; i < 3 && t0 <= t1; i++) {
        const lo = b.c[i] - b.h[i];
        const hi = b.c[i] + b.h[i];
        if (Math.abs(dir[i]) < 1e-12) {
          if (from[i] < lo || from[i] > hi) t0 = Infinity;
          continue;
        }
        let a = (lo - from[i]) / dir[i];
        let c = (hi - from[i]) / dir[i];
        if (a > c) [a, c] = [c, a];
        t0 = Math.max(t0, a);
        t1 = Math.min(t1, c);
      }
      if (t0 > t1 || (best && t0 >= best.t)) continue;
      // a cylinder: march through the box to the first point inside the round
      let t = t0;
      if (Z.shape === 'cyl') {
        const n = 24;
        t = null;
        for (let j = 0; j <= n; j++) {
          const tt = t0 + ((t1 - t0) * j) / n;
          if (inside(from.map((v, i) => v + dir[i] * tt), { c: b.c, h: b.h.map((v) => v * 1.0001) }, 'cyl', Z.axis)) {
            t = tt;
            break;
          }
        }
        if (t == null) continue;
      }
      if (!best || t < best.t) best = { k: Z.k, zone: Z.zone, t, p: from.map((v, i) => v + dir[i] * t) };
    }
  return best;
}

/**
 * A hit of `amount` (base damage) on part k: dmg[k] (0 whole … 1 destroyed) goes up by
 * amount × mult / hp. Returns what happened.
 */
export function hitPart(dmg, kind, k, amount) {
  const zone = VEHICLE_ZONES[kind]?.find((z) => z.k === k);
  if (!zone) return null;
  const before = dmg[k] ?? 0;
  const value = Math.min(1, before + (amount * zone.mult) / zone.hp);
  dmg[k] = value;
  return { k, zone, amount: amount * zone.mult, value, destroyed: before < 1 && value >= 1 };
}

/** How whole the vehicle is (1 … 0): its parts' damage weighted by their hit points. */
export function integrity(dmg, kind) {
  const zs = VEHICLE_ZONES[kind] ?? [];
  const all = zs.reduce((a, z) => a + z.hp, 0);
  return all ? 1 - zs.reduce((a, z) => a + z.hp * (dmg[z.k] ?? 0), 0) / all : 1;
}
