/**
 * The carrier's hull as a body (the whole ship round the simulated slice of its deck: models/
 * carrier.js's 'carrierHull' prop, drawn by render/hull.js from the same lines, models/
 * carrierLines.js): a static compound of convex sections along its length, from the bottom to just
 * under the deck (the deck itself is voxels where it is simulated), in the shared physics world
 * (physics/vehicleCore.js), meeting the boats, the helicopters and debris (GROUP.SHIP): a boat run
 * into its side or its transom stops against it, a helicopter flown into it crashes.
 *
 *   shipShape(pr)        the compound in the ship's frame (x to the bow, y up, z to starboard)
 *   shipBody(PW, pr)     its body in PW (made once per prop: pr.p, pr.heading)
 *   shipsOf(w, PW)       the sim World's carrier hulls (world.props) in PW
 */
import { ConvexHull, Compound } from './shapes.js';
import { Body } from './body.js';
import { vehicleFilter } from './vehicleCore.js';
import { carrierLines } from '../models/carrierLines.js';

/** Its hull as convex sections (each the hull of two stations' outlines). */
export function shipShape(pr, sections = 14) {
  const L = carrierLines(pr);
  const ys = (x) => {
    const yb = L.yBot(x);
    return [yb, yb + (pr.draft - yb) * 0.5, pr.draft, (pr.draft + L.yTop) / 2, L.yTop];
  };
  const children = [];
  const x0 = L.xStern, x1 = L.xBow;
  for (let k = 0; k < sections; k++) {
    const xa = x0 + ((x1 - x0) * k) / sections, xb = x0 + ((x1 - x0) * (k + 1)) / sections;
    const pts = [];
    for (const x of [xa, xb])
      for (const y of ys(x)) {
        const w = L.half(Math.min(x, x1 - 0.02), y);
        if (w > 0.05) pts.push([x, y, w], [x, y, -w]);
      }
    if (pts.length < 8) continue;
    // (the stem's last section can come out flat: left out)
    try {
      children.push({ shape: new ConvexHull(pts), pos: [0, 0, 0] });
    } catch {
      continue;
    }
  }
  return new Compound(children);
}

/** The carrier hull's body in PW (made once for the prop). */
export function shipBody(PW, pr) {
  const M = (PW._ships ??= new Map());
  let B = M.get(pr);
  if (B) return B;
  const h = pr.heading ?? 0;
  B = new Body({ type: 'static', shape: shipShape(pr), position: (pr.p ?? [0, 0, 0]).slice(), quaternion: [0, Math.sin(h / 2), 0, Math.cos(h / 2)], material: 'steel' });
  B.buoyant = false;
  B.restitution = 0.1;
  B.userData = { ship: pr };
  vehicleFilter(B, 'ship');
  PW.addBody(B);
  M.set(pr, B);
  return B;
}

/** The carrier hulls of a sim World (its 'carrierHull' props) in PW. */
export function shipsOf(w, PW) {
  for (const pr of w.props ?? []) if (pr.type === 'carrierHull') shipBody(PW, pr);
}
