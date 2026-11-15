import { MATERIALS, MAT } from './materials.js';
import { F_ANCHOR, F_BURNING, F_FALLING, F_HIDDEN, F_LIQUID, F_SMOLDER } from './world.js';
import { garmentShape } from '../models/clothesline.js';

/**
 * The wash on a line (models/clothesline.js) as the inspector sees it: garment by garment.
 *
 * Every garment IS voxels: boxes of cotton or polyester one voxel thick, with a density factor
 * (world.dens) of about half a millimetre of cloth per voxel, flagged hidden. The voxels carry
 * the physics (heat, drying, charring, flames, the pegged top row anchored, the rest falling
 * when that burns through); render/laundry.js + render/statue.js draw the cloth over them,
 * folded and swaying in the wind. So the inspector's ray found nothing: it was tested against
 * the drawn voxel instances only, and hidden voxels are not among them – it went through the
 * sheet to the lawn. render/pick.js now also raycasts the drawn cloth (as it is drawn: folds,
 * sway, holes), maps the triangle it hits to its voxel, and that voxel to its garment here.
 *
 * A garment is described as a whole (one voxel of a sheet says little): its material, size,
 * dry mass, water, temperature, char, how much has burnt or fallen off, whether it still hangs
 * from its pegs, its heat release – summed over the voxels it was made of when the scene was
 * built (a voxel index keeps its garment: burnt, it is ash there; fallen, it is gone from it).
 */

const NAMES = { sheet: 'Bedsheet (folded over the line)', towel: 'Towel', shirt: 'Shirt', jeans: 'Jeans', pillow: 'Pillowcase', sock: 'Sock' };

// (per world: the props of a world are its own objects; a new scene has new props)
const CACHE = new WeakMap();

/**
 * The garments of a laundry prop (world.props entry, procedural 'laundry') and their voxels:
 * `own` the prop's cloth voxels as built (StatueDrawing.own; found here when not given).
 * Returns { pieces: [{ g, name, voxels, mass0, pins }], of: Map voxel -> piece index }.
 */
export function clothPieces(world, pr, own = null) {
  const hit = CACHE.get(pr);
  if (hit) return hit;
  const w = world;
  const mats = new Set((pr.materials ?? []).map((n) => MAT[n]));
  if (!own) {
    own = [];
    const R = pr.radius ?? 2.5;
    for (let k = 0; k < w.solidCount; k++) {
      const i = w.solids[k];
      if (!mats.has(w.mat[i]) || !(w.flags[i] & F_HIDDEN)) continue;
      const c = w.center(...w.coords(i));
      if (Math.hypot(c[0] - pr.p[0], c[2] - pr.p[2]) < R) own.push(i);
    }
  }
  const top = pr.line.H - 0.01;
  const pieces = pr.wash.map((g, k) => ({ index: k, g, name: NAMES[g.kind] ?? g.kind, voxels: [], mass0: 0, pins: 0 }));
  const of = new Map();
  const V = w.h ** 3;
  for (const i of own) {
    const [lx, ly] = toLocal(pr, w.center(...w.coords(i)));
    // the nearest garment panel (a sleeve, a leg, the body) of its cloth to the voxel's centre
    // (a shirt's sleeve reaches over the towel next to it: there the voxels are the shirt's)
    let best = -1;
    let bd = Infinity;
    pieces.forEach((pc, k) => {
      if (MAT[pc.g.mat] !== w.mat[i]) return;
      for (const [ax, ay, bx, by] of garmentShape(pc.g)) {
        const dx = Math.max(0, pc.g.x0 + ax - lx, lx - (pc.g.x0 + bx));
        const dy = Math.max(0, top + ay - ly, ly - (top + by));
        const d = dx * dx + dy * dy;
        if (d < bd) {
          bd = d;
          best = k;
        }
      }
    });
    if (best < 0) continue;
    pieces[best].voxels.push(i);
    pieces[best].mass0 += MATERIALS[w.mat[i]].density * w.dens[i] * V;
    if (w.flags[i] & F_ANCHOR) pieces[best].pins++; // (the pegged top row)
    of.set(i, best);
  }
  const out = { pieces, of };
  CACHE.set(pr, out);
  return out;
}

/** A world point in the prop's own frame (the line along x, z across it; turned by its heading about y). */
export function toLocal(pr, p) {
  const dx = p[0] - pr.p[0];
  const dz = p[2] - pr.p[2];
  const a = pr.heading ?? 0;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c * dx - s * dz, p[1] - pr.p[1], s * dx + c * dz];
}

/**
 * The state of garment `k` of a laundry prop, summed over its voxels: what the inspector shows.
 * Temperatures in °C, masses in kg, moisture per dry mass, fractions 0..1, heat release in W.
 */
export function describeCloth(world, pr, k) {
  const w = world;
  const pc = clothPieces(w, pr).pieces[k];
  if (!pc) return null;
  const V = w.h ** 3;
  const matName = pc.g.mat;
  const M = MATERIALS[MAT[matName]];
  let n = 0;
  let ash = 0;
  let dry = 0;
  let water = 0;
  let fuel = 0;
  let tSum = 0;
  let tMax = -Infinity;
  let sMax = -Infinity;
  let char = 0;
  let burning = 0;
  let smoulder = 0;
  let molten = 0;
  let pins = 0;
  let hrr = 0;
  const air = new Set();
  for (const i of pc.voxels) {
    const m = w.mat[i];
    // (the pegged top row: anchored when built; it stays so while it is there)
    if (m === MAT[matName] && w.flags[i] & F_ANCHOR) pins++;
    if (m === MAT.ash) {
      ash++;
      continue;
    }
    if (m !== MAT[matName] || w.flags[i] & F_FALLING) continue;
    n++;
    const f = w.flags[i];
    const mass = M.density * w.dens[i] * V * w.fuel[i];
    dry += mass;
    water += mass * w.moist[i];
    fuel += w.fuel[i];
    tSum += w.temp[i];
    tMax = Math.max(tMax, w.temp[i]);
    sMax = Math.max(sMax, w.skin[i]);
    char += w.char[i];
    if (f & F_BURNING) burning++;
    else if (f & F_SMOLDER) smoulder++;
    if (f & F_LIQUID || w.melt[i] > 0.5) molten++;
    hrr += w.hrr[i];
    air.add(w.airIndexOfVoxel(...w.coords(i)));
  }
  let airT = 0;
  for (const a of air) airT += w.airT[a];
  const N = pc.voxels.length;
  return {
    name: pc.name,
    kind: pc.g.kind,
    index: k,
    material: M.label,
    color: pc.g.color,
    size: [pc.g.w, pc.g.drop],
    voxels: N,
    inPlace: n,
    ashed: ash,
    fallen: N - n - ash,
    voxelSize: w.h,
    mass0: pc.mass0,
    mass: dry,
    moisture: dry > 0 ? water / dry : 0,
    temperature: n ? tSum / n : null,
    maxTemperature: n ? tMax : null,
    surface: n ? sMax : null,
    char: n ? char / n : 0,
    // (what is no longer cloth on the line: burnt (its fuel used, ash) or fallen off)
    burnt: N ? 1 - fuel / N : 0,
    burning,
    smouldering: smoulder,
    molten,
    pinned: pins,
    pins: pc.pins, // (the pegged row's voxels as built; `pinned`: those still there)
    heatRelease: hrr,
    airCells: air.size,
    airTemperature: air.size ? airT / air.size : null,
  };
}

/** describeCloth's state as the inspector's lines (plain text; the first is the heading). */
export function clothRows(d) {
  const g = (kg) => (kg >= 1 ? `${kg.toFixed(2)} kg` : `${(kg * 1000).toFixed(0)} g`);
  const W = (x) => (x >= 1e3 ? `${(x / 1e3).toFixed(1)} kW` : `${x.toFixed(0)} W`);
  const pct = (f) => `${(f * 100).toFixed(0)} %`;
  const state = [];
  if (d.burning) state.push(`burning (${d.burning} voxels alight)`);
  if (d.smouldering) state.push(`smouldering (${d.smouldering})`);
  if (d.molten) state.push(`melting (${d.molten})`);
  if (!d.inPlace) state.push('gone from the line');
  if (!state.length) state.push(d.char > 0.05 ? 'scorched' : 'hanging on the line');
  return [
    `${d.name} – ${d.material}`,
    `Size: ${d.size[0].toFixed(2)} × ${d.size[1].toFixed(2)} m; ${g(d.mass0)} dry`,
    `State: ${state.join(', ')}`,
    d.temperature !== null ? `Temperature: ${d.temperature.toFixed(0)} °C (hottest ${d.maxTemperature.toFixed(0)} °C, surface ${d.surface.toFixed(0)} °C)` : '',
    `Water: ${pct(d.moisture)} of dry mass`,
    `Burnt: ${pct(d.burnt)} (charred ${pct(d.char)}; ${d.ashed} voxels ash, ${d.fallen} fallen off)`,
    `Cloth left: ${g(d.mass)}`,
    `Pegged: ${d.pins ? `${d.pinned} of ${d.pins} top voxels hold` : '–'}`,
    d.heatRelease > 0 ? `Heat release: ${W(d.heatRelease)}` : '',
    `Voxels: ${d.inPlace} of ${d.voxels} (${(d.voxelSize * 100).toFixed(1)} cm, hidden: the cloth is drawn over them)`,
    d.airTemperature !== null ? `Air around it: ${d.airTemperature.toFixed(0)} °C (${d.airCells} air cells)` : '',
  ].filter(Boolean);
}
