/**
 * Contact properties of the voxel materials (sim/materials.js) for the rigid bodies: Coulomb
 * friction μ and restitution e, from the material's mechanics (sim/materials.js mechanics():
 * shape class, hardness, loss factor) with a few measured overrides. A pair combines as
 * μ = √(μa·μb) and e = √(ea·eb) (a steel ball bounces off steel, not off soil).
 *
 *   surfaceOf(m)          m: material id, name, or null → { name, friction, restitution }
 *   combine(sa, sb)       → { friction, restitution }
 */
import { MATERIALS, MAT, mechanics } from '../sim/materials.js';

// representative dry friction against like surfaces (engineering tables), by mechanics shape class
const BY_SHAPE = { shell: 0.45, plate: 0.45, bar: 0.45, block: 0.6, soft: 0.8, granular: 0.75, liquid: 0.05 };
const OVERRIDE = {
  steel: { friction: 0.5 }, deckSteel: { friction: 0.5 }, aluminium: { friction: 0.45 }, copper: { friction: 0.5 }, brass: { friction: 0.4 },
  glass: { friction: 0.4 }, ice: { friction: 0.05, restitution: 0.25 }, rubber: { friction: 1.0, restitution: 0.7 },
  wood: { friction: 0.5 }, oak: { friction: 0.5 }, pine: { friction: 0.5 }, concrete: { friction: 0.7 }, brick: { friction: 0.65 },
  stone: { friction: 0.6 }, soil: { friction: 0.7 }, mud: { friction: 0.35, restitution: 0.02 }, beachSand: { friction: 0.7 },
  quarrySand: { friction: 0.7 }, grass: { friction: 0.55 }, flesh: { friction: 0.8, restitution: 0.08 }, plastic: { friction: 0.35 },
  water: { friction: 0.02, restitution: 0 },
};
const DEFAULT = { name: 'default', friction: 0.55, restitution: 0.25 };
const cache = new Map();

export function surfaceOf(m) {
  if (m === null || m === undefined || m === 0) return DEFAULT;
  if (cache.has(m)) return cache.get(m);
  const name = typeof m === 'number' ? MATERIALS[m]?.name : m;
  if (!name || (MAT[name] === undefined && !OVERRIDE[name])) {
    cache.set(m, DEFAULT);
    return DEFAULT;
  }
  const M = mechanics(name);
  const friction = BY_SHAPE[M.shape] ?? 0.55;
  // a hard, little-damped material gives the energy back (steel ~0.6, wood ~0.3, soil ~0.1)
  const restitution = Math.max(0.02, Math.min(0.8, 0.1 + 0.5 * M.hardness * (1 - Math.min(1, M.eta * 5))));
  const s = { name, friction, restitution, ...OVERRIDE[name] };
  cache.set(m, s);
  return s;
}

export function combine(a, b) {
  return { friction: Math.sqrt(a.friction * b.friction), restitution: Math.sqrt(a.restitution * b.restitution) };
}
