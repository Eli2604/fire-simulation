import { MATERIALS, MAT } from './materials.js';

// loose ground a blast digs a crater in (soil, sand, grass, gravel; weathered rock only cracks)
const GROUND = new Set(['soil', 'quarrySand', 'grass', 'beachSand', 'sand', 'gravel', 'hillRock'].map((n) => MAT[n]).filter(Boolean));
// a tree's wood and its foliage (models/tree.js)
const TREE_WOOD = new Set(['oak', 'pine', 'willow', 'bark', 'deadWood'].map((n) => MAT[n]).filter(Boolean));
const FOLIAGE = new Set(['leaves', 'needles', 'twigs'].map((n) => MAT[n]).filter(Boolean));
import { raySolid, bulletHole } from './wounds.js';
import { F_FALLING, F_ANCHOR } from './world.js';
import { launchVoxel } from './vessels.js';
import { fellTree } from './trees.js';

/**
 * Explosions (hand grenades) and gas pipes.
 *
 * Blast at `center` with energy E (J): light parts nearby fly as debris,
 * windows break, gas pipes in range burst, and the hot detonation products
 * scorch and ignite what is close (incendiary flash + short fireball).
 */
export function explode(sim, center, E, opts = {}) {
  const w = sim.world;
  const h = w.h;
  const V = h ** 3;
  const blastR = Math.max(3 * h, 0.4 * Math.cbrt(E / 1000));
  const v0 = Math.min(80, 8 + Math.sqrt(E / 2000));
  const r2 = blastR * blastR;
  // the crater a blast at the ground digs: ~0.8 m · (TNT kg)^(1/3) (0.4 m for a grenade)
  const craterR = 0.8 * Math.cbrt(E / 4.6e6);
  const glassR2 = (3 * blastR) ** 2;
  const victims = [];
  // trees: the foliage is shredded and blown off further out than anything is thrown; a branch
  // snaps where the blast meets it, the thicker the nearer (what is beyond the break falls); the
  // trunk splinters close to it (a grenade gouges it, a rocket or a second grenade fells it)
  const trees = new Map((w.trees ?? []).map((t) => [t.owner, t]));
  const leafR = blastR * 1.6;
  const severR = 0.12 * Math.cbrt(E / 1000); // ~0.8 m for a grenade
  const trunkHit = new Map(); // tree owner -> voxel rows of its trunk the blast reached
  const snapR = Math.min(0.2, 0.15 * Math.cbrt(E / 3e5)); // the thickest branch it snaps, right at it (m of radius)
  for (let k = 0; k < w.solidCount; k++) {
    const i = w.solids[k];
    if (!w.mat[i]) continue;
    const [x, y, z] = w.coords(i);
    if (y === 0) continue;
    const p = w.center(x, y, z);
    const d2 = (p[0] - center[0]) ** 2 + (p[1] - center[1]) ** 2 + (p[2] - center[2]) ** 2;
    const M = MATERIALS[w.mat[i]];
    // the crater: the ground round the blast is thrown up and out (it lands as a rim round the hole)
    if (GROUND.has(w.mat[i])) {
      const rc = M.name === 'hillRock' ? craterR * 0.5 : craterR;
      // (never the last layer: the ground is only a shell of voxels, there must be no hole through it)
      const below = y > 1 ? w.mat[w.idx(x, y - 1, z)] : 0;
      if (d2 < rc * rc && below) victims.push([i, p, 3.5 + 4 * (1 - Math.sqrt(d2) / rc), true]);
      // (the ground is dug only as a crater, however light its voxels are)
      if (d2 < rc * rc * 4 && !(M.shatterTemp !== Infinity)) w.char[i] = Math.max(w.char[i], 0.4 * (1 - Math.sqrt(d2) / (2 * rc))); // scorched round it
      continue;
    }
    if (trees.size && (FOLIAGE.has(w.mat[i]) || TREE_WOOD.has(w.mat[i])) && trees.has(w.owner[i])) {
      const d = Math.sqrt(d2);
      if (FOLIAGE.has(w.mat[i])) {
        if (d > leafR) continue;
        // shredded: most of it gone as bits, some blown off whole
        if (sim.rand() < Math.min(1, 1.3 * (1 - d / leafR))) {
          // (blown off whole only where a voxel is leaf-sized: at 0.4 m it would fly as a green block)
          if (h <= 0.15 && sim.rand() < 0.25) victims.push([i, p, 4 + 10 * (1 - d / leafR)]);
          else w.clearVoxel(i);
        }
        continue;
      }
      if (d < blastR) {
        // how thick the tree is here (its nearest branch's radius)
        let r = Infinity;
        let bd = Infinity;
        for (const s of trees.get(w.owner[i]).segs) {
          const q = segDist(p, s.a, s.b);
          if (q < bd) {
            bd = q;
            r = s.r;
          }
        }
        const k = 1 - d / blastR;
        // a branch thin enough snaps (thrown out where it broke)
        if (r < snapR * k ** 1.5) {
          // right at it the wood is thrown; further off the branch breaks there and drops
          // (what is beyond the break falls with it: the support check)
          if (k > 0.6) victims.push([i, p, 3 + 6 * k, false, true]);
          else {
            w.flags[i] = (w.flags[i] | F_FALLING) & ~64;
            w.structureDirty = true;
          }
          continue;
        }
        // the trunk near it splinters: the damage adds up blast after blast (its crack), a
        // grenade gouges it, a second one beside it (or a rocket) cuts it through and it falls
        if (d < severR) {
          if (!trunkHit.has(w.owner[i])) trunkHit.set(w.owner[i], new Set());
          trunkHit.get(w.owner[i]).add(Math.floor(i / w.nx) % w.ny);
          w.crack[i] += 1.6 * (1 - d / severR);
          if (w.crack[i] >= 1) {
            victims.push([i, p, 2 + 5 * k, false, true]);
            continue;
          }
        }
      }
      if (d < blastR * 0.4 && M.combustible) w.char[i] = Math.max(w.char[i], 0.5);
      continue;
    }
    if (M.shatterTemp !== Infinity && d2 < glassR2) w.flags[i] |= F_FALLING;
    if (d2 > r2) continue;
    const d = Math.sqrt(d2);
    if (d < blastR * 0.4) {
      // the fireball scorches what it touches; it heats only what can burn (thin, light
      // stuff): stone and metal do not take that heat in a flash, and would glow for minutes
      if (M.combustible) w.skin[i] = Math.max(w.skin[i], 400 + 500 * (1 - d / (blastR * 0.4)));
      w.char[i] = Math.max(w.char[i], 0.5);
    }
    // (thin built-in sheets: deck and hull plating, floorboards, boards: blown out further off)
    if (w.flags[i] & F_ANCHOR && d > blastR * (w.dens[i] < 0.15 ? 0.4 : 0.25)) continue;
    const m = M.density * w.dens[i] * V;
    let speed = v0 * (1 - d / blastR) ** 2 * Math.min(1, Math.sqrt(2 / Math.max(m, 1e-3)));
    // carved stone (a statue): close to a blast it does not have to be thrown whole to break,
    // the shock shatters it: pieces break off and fly (not too fast: they are heavy)
    if (M.fragile && d < blastR * 0.32) speed = Math.max(speed, 3.5 + 4 * (1 - d / (blastR * 0.32)));
    // steel plate is tough: a grenade dents a deck, it takes a rocket to hole it (thin hull plating
    // is light enough to be torn out anyway)
    if (speed > (M.name === 'steel' || M.name === 'deckSteel' ? 8 : 3)) victims.push([i, p, speed]);
  }
  // a trunk with half or more of its cross-section broken somewhere cannot hold the tree: what
  // is left of it there snaps too (at coarse voxels a trunk is a voxel or two across)
  const severed = new Map(); // tree owner -> the lowest row its trunk was cut through at
  if (trunkHit.size) {
    const broken = new Set(victims.map((v) => v[0]));
    for (const [own, rows] of trunkHit) {
      const t = trees.get(own);
      for (const y of rows) {
        const yc = (y + 0.5) * h;
        const s = t.segs.find((q) => q.trunk && Math.min(q.a[1], q.b[1]) <= yc + h && Math.max(q.a[1], q.b[1]) >= yc - h) ?? t.segs[0];
        const f = Math.max(0, Math.min(1, (yc - s.a[1]) / (s.b[1] - s.a[1] || 1)));
        const ax = s.a[0] + (s.b[0] - s.a[0]) * f;
        const az = s.a[2] + (s.b[2] - s.a[2]) * f;
        const R = s.r + 0.75 * h;
        const layer = [];
        for (let z = Math.floor((az - R) / h); z <= Math.floor((az + R) / h); z++)
          for (let x = Math.floor((ax - R) / h); x <= Math.floor((ax + R) / h); x++) {
            if (x < 0 || z < 0 || x >= w.nx || z >= w.nz) continue;
            const i = w.idx(x, y, z);
            if (!w.mat[i] || w.owner[i] !== own || !TREE_WOOD.has(w.mat[i])) continue;
            if (Math.hypot((x + 0.5) * h - ax, (z + 0.5) * h - az) > R) continue;
            layer.push(i);
          }
        const nb = layer.filter((i) => broken.has(i)).length;
        if (layer.length && nb >= 0.5 * layer.length) {
          severed.set(own, Math.min(severed.get(own) ?? Infinity, y));
          for (const i of layer)
            if (!broken.has(i)) {
              broken.add(i);
              victims.push([i, w.center(...w.coords(i)), 1.5, false, true]);
            }
        }
      }
    }
  }
  // gas pipes caught in the blast burst (before their voxels are thrown away)
  for (const gp of w.gasPipes) burstPipeNear(sim, gp, center, blastR);
  for (const [i, p, speed, ejecta, splinter] of victims) {
    // wood splintered off a tree: at coarse voxels it shatters (a 0.4 m block of oak flying
    // off whole would be no splinter); fine ones fly as the splinters they are
    if (splinter && h > 0.15) {
      w.clearVoxel(i);
      continue;
    }
    let dx = p[0] - center[0];
    // (crater ejecta fly up and out, whatever side of the blast they were on)
    let dy = ejecta ? Math.hypot(dx, p[2] - center[2]) * 0.9 + 0.25 : p[1] - center[1] + 0.1;
    let dz = p[2] - center[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    dx = dx / l + (sim.rand() - 0.5) * 0.3;
    dy = dy / l + 0.2 + (sim.rand() - 0.5) * 0.3;
    dz = dz / l + (sim.rand() - 0.5) * 0.3;
    const l2 = Math.hypot(dx, dy, dz);
    launchVoxel(w, i, [(dx / l2) * speed, (dy / l2) * speed, (dz / l2) * speed]);
  }
  // a tree cut through comes down as one, away from the blast (sim/trees.js)
  for (const [own, row] of severed) fellTree(sim, trees.get(own), row, center);
  if (opts.flash !== false) {
    sim.ignite(center, blastR * 0.35);
    w.heaters.push({
      pos: [center[0], Math.max(h, center[1] - blastR * 0.15), center[2]],
      power: E * 2,
      radius: blastR * 0.3,
      height: blastR * 0.5,
      on: true,
      until: w.time + 0.5,
      temporary: true,
      fireball: true,
    });
  }
  w.structureDirty = true;
  w.listDirty = true;
  w.events.push({ type: 'explosion', pos: center, time: w.time, energy: E, radius: blastR, name: opts.name ?? 'grenade', flash: opts.flash !== false });
  w.noises.push({ p: center.slice(), loud: 80, time: w.time, kind: 'explosion' });
  sim.ai?.blast(center, blastR);
  sim.dragonAI?.blast(center, blastR);
  sim.phoenixAI?.blast(center, blastR);
}

/** Distance from p to the segment a–b. */
function segDist(p, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1)));
  return Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t, p[2] - a[2] - ab[2] * t);
}

/** Burst a gas pipe at its voxel closest to `p`, if within `range`. */
export function burstPipeNear(sim, gp, p, range) {
  const w = sim.world;
  if ((gp.bursts ?? 0) >= 3) return false;
  let best = -1;
  let bd = range * range;
  for (const i of gp.voxels) {
    if (!w.mat[i]) continue;
    const c = w.center(...w.coords(i));
    const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  if (best < 0) return false;
  burstPipeAt(sim, gp, best);
  return true;
}

export function burstPipeAt(sim, gp, i) {
  const w = sim.world;
  const c = w.center(...w.coords(i));
  if (gp.water) {
    // a water pipe: it gushes, and the water runs down and collects on the floor
    if (w.leaks.some((l) => l.gp === gp && Math.hypot(l.p[0] - c[0], l.p[1] - c[1], l.p[2] - c[2]) < 1)) return;
    gp.bursts = (gp.bursts ?? 0) + 1;
    w.leaks.push({ p: c, rate: gp.rate, acc: 0, gp });
    w.events.push({ type: 'waterBurst', pos: c, time: w.time, name: gp.label });
    return;
  }
  // not twice at (nearly) the same spot
  for (const ht of w.heaters) if (ht.gasPipe === gp && Math.hypot(ht.pos[0] - c[0], ht.pos[1] - c[1], ht.pos[2] - c[2]) < 1) return;
  gp.bursts = (gp.bursts ?? 0) + 1;
  w.heaters.push({ pos: c, dir: gp.dir, power: gp.power, radius: gp.dir ? 0.2 : 0.3, height: gp.jetHeight ?? 1, on: true, label: 'gas pipe', jet: true, smokeYield: 0.004, gasPipe: gp });
  w.events.push({ type: 'pipeBurst', pos: c, time: w.time, name: 'gas pipe' });
}

/** Gas pipe joints fail when the fire heats them (soldered / compression fittings give way). */
export function stepGasPipes(sim) {
  const w = sim.world;
  for (const gp of w.gasPipes) {
    if ((gp.bursts ?? 0) >= 3) continue;
    for (const i of gp.voxels) {
      if (w.mat[i] && Math.max(w.temp[i], w.skin[i]) > (gp.failTemp ?? 450) && sim.rand() < 0.15) {
        burstPipeAt(sim, gp, i);
        break;
      }
    }
  }
}

/**
 * Projectiles:
 *  grenade  thrown; comes to rest where it hits, explodes when the fuse runs out
 *  arrow    a fire arrow: burns in flight, sticks where it hits and sets it alight,
 *           wounds and ignites an enemy it hits; burns out after ~25 s
 *  rocket   thrust for a few seconds, explodes on impact (outside the simulated
 *           area it is only drawn)
 */
export function stepProjectiles(sim, dt) {
  const w = sim.world;
  if (!w.projectiles.length) return;
  const h = w.h;
  const keep = [];
  const inside = (p) => p[0] >= 0 && p[2] >= 0 && p[1] >= 0 && p[0] < w.size[0] && p[2] < w.size[2] && p[1] < w.size[1];
  for (const g of w.projectiles) {
    const type = g.type ?? 'grenade';
    g.age = (g.age ?? 0) + dt;
    if (g.fuse !== undefined) g.fuse -= dt;
    let hit = false;
    if (!g.resting) {
      const steps = Math.min(60, Math.max(1, Math.ceil((Math.hypot(...g.v) * dt) / (0.5 * h))));
      for (let s = 0; s < steps; s++) {
        const sdt = dt / steps;
        if (type === 'rocket' && g.age < (g.burn ?? 3)) {
          const sp = Math.hypot(...g.v) || 1;
          for (let c = 0; c < 3; c++) g.v[c] += (g.v[c] / sp) * 60 * sdt; // motor
        }
        g.v[1] -= 9.81 * sdt;
        if (type === 'arrow') for (let c = 0; c < 3; c++) g.v[c] *= 1 - 0.02 * sdt;
        const prev = g.p.slice();
        for (let c = 0; c < 3; c++) g.p[c] += g.v[c] * sdt;
        // enemies in the way
        if (type !== 'grenade' && sim.hitEnemy && sim.hitEnemy(g.p, type, g)) {
          hit = true;
          g.gone = type === 'arrow';
          break;
        }
        if (!inside(g.p)) {
          if (type !== 'rocket' || g.age > 12 || g.p[1] < 0) g.gone = true;
          continue;
        }
        const i = w.voxelAt(...g.p);
        if (g.p[1] < h * (w.sea ? 0 : 1) || (i >= 0 && w.mat[i])) {
          if (type === 'arrow' && i >= 0 && w.mat[i] && MATERIALS[w.mat[i]].shatterTemp !== Infinity) {
            // an arrow goes through glass and breaks it
            w.flags[i] |= F_FALLING;
            w.structureDirty = true;
            sim.glassNoise?.(i);
            continue;
          }
          g.hitPos = g.p.slice();
          if (type === 'arrow') {
            const hh = raySolid(w, prev, g.v, Math.hypot(...g.v) * sdt + h);
            if (hh) bulletHole(sim, hh, 'arrow');
          }
          g.p = prev;
          g.dir = g.v.slice();
          g.v = [0, 0, 0];
          g.resting = true;
          hit = true;
          break;
        }
      }
    }
    if (g.gone) continue;
    if (type === 'grenade') {
      if (g.fuse <= 0) explode(sim, g.p, g.energy, { name: 'grenade' });
      else keep.push(g);
      continue;
    }
    if (type === 'rocket') {
      if (inside(g.p)) {
        const a = sim.airCellAt(...g.p);
        if (a >= 0 && g.age < (g.burn ?? 3)) w.flameAcc[a] += 40000; // exhaust flame
      }
      if (hit) explode(sim, g.hitPos ?? g.p, g.energy ?? 1.5e6, { name: 'rocket' });
      else if (g.age < 14) keep.push(g);
      continue;
    }
    // arrow
    if (hit && !g.lit && g.hitPos) {
      g.lit = true;
      sim.ignite(g.hitPos, h * 0.9);
      w.noises.push({ p: g.hitPos.slice(), loud: 6, time: w.time, kind: 'arrow' });
    }
    g.burnLeft = (g.burnLeft ?? 25) - dt;
    if (g.burnLeft > 0) {
      // the burning rag on the arrow head
      const a = inside(g.p) ? sim.airCellAt(...g.p) : -1;
      if (a >= 0) {
        w.flameAcc[a] += 1500;
        w.airQ[a] += 600;
        sim.consumeO2(a, 1500, dt);
      }
      keep.push(g);
    } else if (g.resting) keep.push(Object.assign(g, { burnLeft: 0, spent: true, ttl: (g.ttl ?? 60) - dt })) ;
  }
  w.projectiles = keep.filter((g) => !g.spent || g.ttl > 0);
}
