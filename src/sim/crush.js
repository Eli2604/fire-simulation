import { MATERIALS } from './materials.js';
import { F_ANCHOR, F_FALLING } from './world.js';
import { launchVoxel } from './vessels.js';

// (the ground itself does not give: a foot comes down on it, it does not stamp a hole in the island)
const GROUND = new Set(['soil', 'quarrySand', 'grass', 'beachSand', 'sand', 'gravel', 'hillRock', 'bedrock', 'basalt']);

/**
 * A great weight coming down on what is built (a dragon stamping on a roof, slamming into a
 * wall): what is within `r` of p cracks, more the nearer and the harder (`force`, ~1 for a
 * dragon's foot). Glass breaks at once; tiles, boards and thin stuff go sooner than stone.
 * What is cracked through breaks off and is knocked away from `from` (it falls: what it held
 * up loses its support and comes down too, the next support check). Returns how many broke.
 */
export function crush(sim, p, r, force, from) {
  const w = sim.world;
  let broke = 0;
  sim.forSphere(p, r, (i) => {
    const m = w.mat[i];
    if (!m) return;
    const M = MATERIALS[m];
    // (steel plate, a deck, a hull does not give under a foot: it dents, nothing breaks off)
    if (M.fluidity >= 0.95 || GROUND.has(M.name) || M.density > 5000) return;
    const [x, y, z] = w.coords(i);
    if (y <= 1) return;
    const c = w.center(x, y, z);
    const d = Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]);
    if (d > r) return;
    if (M.shatterTemp !== Infinity) {
      w.flags[i] |= F_FALLING;
      broke++;
      return;
    }
    // how much it takes: heavy, dense stuff (stone, brick) more; tiles, boards, plaster less
    const toughness = Math.max(0.35, Math.min(2.2, (M.density * w.dens[i]) / 1100));
    w.crack[i] += (force * 1.4 * (1 - d / r)) / toughness;
    if (w.crack[i] < 1) return;
    w.flags[i] &= ~F_ANCHOR;
    const v = [c[0] - from[0], 0, c[2] - from[2]];
    const l = Math.hypot(v[0], v[2]) || 1;
    const s = 1 + 2.5 * sim.rand();
    launchVoxel(w, i, [(v[0] / l) * s, -1 - sim.rand() * 2, (v[2] / l) * s]);
    broke++;
  });
  if (broke) {
    w.structureDirty = true;
    w.listDirty = true;
    w.geomVersion++;
  }
  return broke;
}
