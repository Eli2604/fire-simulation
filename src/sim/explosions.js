import { MATERIALS } from './materials.js';
import { F_FALLING, F_ANCHOR } from './world.js';
import { launchVoxel } from './vessels.js';

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
  const glassR2 = (3 * blastR) ** 2;
  const victims = [];
  for (let k = 0; k < w.solidCount; k++) {
    const i = w.solids[k];
    if (!w.mat[i]) continue;
    const [x, y, z] = w.coords(i);
    if (y === 0) continue;
    const p = w.center(x, y, z);
    const d2 = (p[0] - center[0]) ** 2 + (p[1] - center[1]) ** 2 + (p[2] - center[2]) ** 2;
    const M = MATERIALS[w.mat[i]];
    if (M.shatterTemp !== Infinity && d2 < glassR2) w.flags[i] |= F_FALLING;
    if (d2 > r2) continue;
    const d = Math.sqrt(d2);
    if (d < blastR * 0.4) {
      w.skin[i] = Math.max(w.skin[i], 400 + 500 * (1 - d / (blastR * 0.4)));
      w.char[i] = Math.max(w.char[i], 0.5);
    }
    if (w.flags[i] & F_ANCHOR && d > blastR * 0.25) continue;
    const m = M.density * w.dens[i] * V;
    const speed = v0 * (1 - d / blastR) ** 2 * Math.min(1, Math.sqrt(2 / Math.max(m, 1e-3)));
    if (speed > 3) victims.push([i, p, speed]);
  }
  // gas pipes caught in the blast burst (before their voxels are thrown away)
  for (const gp of w.gasPipes) burstPipeNear(sim, gp, center, blastR);
  for (const [i, p, speed] of victims) {
    let dx = p[0] - center[0];
    let dy = p[1] - center[1] + 0.1;
    let dz = p[2] - center[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    dx = dx / l + (sim.rand() - 0.5) * 0.3;
    dy = dy / l + 0.2 + (sim.rand() - 0.5) * 0.3;
    dz = dz / l + (sim.rand() - 0.5) * 0.3;
    const l2 = Math.hypot(dx, dy, dz);
    launchVoxel(w, i, [(dx / l2) * speed, (dy / l2) * speed, (dz / l2) * speed]);
  }
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
  w.events.push({ type: 'explosion', pos: center, time: w.time, energy: E, radius: blastR, name: opts.name ?? 'grenade' });
  w.noises.push({ p: center.slice(), loud: 80, time: w.time, kind: 'explosion' });
  sim.ai?.blast(center, blastR);
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
