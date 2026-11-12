import { MATERIALS } from './materials.js';
import { explode } from './explosions.js';
import { fellTree } from './trees.js';

/**
 * Lightning in a thunderstorm (the weather's `lightning`: strikes per minute somewhere in
 * the scene; the Storm preset sets it). A strike goes to what stands highest round where it
 * comes down (a tree, the church tower, a mast, a roof ridge): of the columns within ~15 m
 * the highest is hit.
 *
 * Where it hits: the current heats what it passes through in an instant. The water in wood
 * boils to steam and bursts it: bark is blown off, the trunk splits along its length (its
 * cracking adds up: a second strike can bring a tree down); a blast of steam and air at the
 * top throws off leaves and loose parts; what can burn there catches. A roof or a tower's
 * stone cracks and pieces fly. Under cover (indoors, in the catacombs, in space) nothing.
 */
export const LIGHTNING = {
  energy: 2e5, // J of the blast at the strike (the steam burst; the bolt itself is ~1 GJ, almost all of it in the air)
  path: 4, // m: how far down from where it struck the current scorches and splits wood
  reach: 15, // m round where it comes down: the highest thing there is hit
};

export function stepLightning(sim, dt) {
  const w = sim.world;
  const rate = sim.weather.lightning ?? 0;
  if (rate <= 0 || w.dark || w.vacuum || w.indoor) return;
  if (sim.rand() > (rate / 60) * dt) return;
  strike(sim);
}

/** A strike now: at `at` ([x, z]) or somewhere in the scene. Returns where it hit. */
export function strike(sim, at) {
  const w = sim.world;
  const { nx, nz, h, colTop } = w;
  if (!colTop) return null;
  const cx = at ? at[0] : sim.rand() * w.size[0];
  const cz = at ? at[1] : sim.rand() * w.size[2];
  // the highest thing round there
  let best = -1;
  let bestY = -1;
  for (let k = 0; k < 60; k++) {
    const r = Math.sqrt(sim.rand()) * (at ? 2 : LIGHTNING.reach);
    const a = sim.rand() * Math.PI * 2;
    const x = Math.floor((cx + Math.cos(a) * r) / h);
    const z = Math.floor((cz + Math.sin(a) * r) / h);
    if (x < 0 || z < 0 || x >= nx || z >= nz) continue;
    const c = x + nx * z;
    if (colTop[c] > bestY) {
      bestY = colTop[c];
      best = c;
    }
  }
  if (best < 0 || bestY < 0) return null;
  const x = best % nx;
  const z = Math.floor(best / nx);
  const top = w.idx(x, bestY, z);
  const p = [(x + 0.5) * h, (bestY + 1) * h, (z + 0.5) * h];
  // down the path of the current: the wood (and what burns) under it scorched and split
  for (let y = bestY; y >= 0 && (bestY - y) * h < LIGHTNING.path; y--) {
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const X = x + dx;
      const Z = z + dz;
      if (X < 0 || Z < 0 || X >= nx || Z >= nz) continue;
      const i = w.idx(X, y, Z);
      const m = w.mat[i];
      if (!m) continue;
      const M = MATERIALS[m];
      if (M.combustible) {
        w.skin[i] = Math.max(w.skin[i], 700);
        w.char[i] = Math.max(w.char[i], 0.6);
        w.crack[i] += dx || dz ? 0.3 : 0.55; // the trunk splits along the path
      } else if (M.brittle) w.crack[i] += 0.4;
    }
  }
  const hitOwner = w.owner[top];
  const hit = MATERIALS[w.mat[top]]?.name ?? '';
  // the burst at the top: leaves and loose parts off, the bark blown, what burns catches
  explode(sim, p, LIGHTNING.energy, { flash: false, name: 'lightning' });
  // a tree struck is split down its trunk; now and then (or struck before) it breaks and comes down
  const tree = (w.trees ?? []).find((t) => t.owner === hitOwner && !t.fall);
  if (tree) {
    tree.struck = (tree.struck ?? 0) + 1;
    if (sim.rand() < (tree.struck > 1 ? 0.6 : 0.25)) {
      const base = Math.min(...tree.segs.map((s) => Math.min(s.a[1], s.b[1])));
      const a = sim.rand() * Math.PI * 2;
      fellTree(sim, tree, Math.floor((base + 1 + sim.rand()) / h), [p[0] + Math.cos(a), p[1], p[2] + Math.sin(a)]);
    }
  }
  sim.ignite(p, Math.max(0.5, 1.5 * h));
  w.events.push({ type: 'lightning', pos: p, time: w.time, name: 'lightning', hit });
  return p;
}
