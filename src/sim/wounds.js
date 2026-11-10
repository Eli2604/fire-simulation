import { MATERIALS } from './materials.js';
import { F_FALLING } from './world.js';

/**
 * Wounds, blood and bullets.
 *
 *  - Where a shot or an arrow lands on someone decides what it does: the head is
 *    usually fatal; the torso bleeds hard; an arm (the hands that hold the rifle)
 *    stops them firing; a leg makes them limp, both legs and they can only crawl.
 *  - A wound bleeds: health drains at a rate set by the wound, slowing as the
 *    bleeding clots. Blood drips from the wound (a trail where they go), sprays
 *    onto the wall or floor behind a hit, and soaks into their clothes there.
 *  - Bullets and arrows that hit a wall leave a hole (a decal); glass breaks.
 *
 * Blood on surfaces and bullet holes are decals (world.decals); falling drops are
 * world.drops, stepped here; the renderer draws both (render/blood.js).
 */
const ZONES = {
  // damage per hit (bullet / arrow), bleeding (health per second), what it does
  head: { bullet: 160, arrow: 120, bleed: 4 },
  torso: { bullet: 55, arrow: 45, bleed: 2.2 },
  armL: { bullet: 28, arrow: 22, bleed: 0.9 },
  armR: { bullet: 28, arrow: 22, bleed: 0.9 },
  legL: { bullet: 32, arrow: 26, bleed: 1.1 },
  legR: { bullet: 32, arrow: 26, bleed: 1.1 },
};

/** Which part of a standing person at e (facing e.yaw) a point p is in, or null if it misses. */
export function hitZone(e, p) {
  const dy = p[1] - e.p[1];
  if (dy < 0 || dy > 1.85) return null;
  const dx = p[0] - e.p[0];
  const dz = p[2] - e.p[2];
  const yaw = e.yaw ?? 0;
  // across the body (right is positive) and along the facing direction
  const side = dx * Math.cos(yaw) - dz * Math.sin(yaw);
  const depth = dx * Math.sin(yaw) + dz * Math.cos(yaw);
  if (e.dead || e.crawling) {
    // lying / crawling: a low target
    if (dy > 0.6 || Math.hypot(dx, dz) > 0.9) return null;
    return 'torso';
  }
  if (Math.abs(depth) > 0.2) return null;
  if (dy > 1.5) return Math.abs(side) < 0.13 ? 'head' : null;
  if (dy > 0.95) {
    if (Math.abs(side) < 0.2) return 'torso';
    if (Math.abs(side) < 0.32) return side > 0 ? 'armR' : 'armL';
    return null;
  }
  if (Math.abs(side) > 0.2) return null;
  return side > 0 ? 'legR' : 'legL';
}

/** Someone is hit in `zone` by a `kind` ('bullet' | 'arrow') coming along dir. */
export function wound(sim, e, zone, kind, p, dir) {
  const w = sim.world;
  const Z = ZONES[zone];
  e.wounds ??= {};
  e.wounds[zone] = (e.wounds[zone] ?? 0) + 1;
  e.bleed = (e.bleed ?? 0) + Z.bleed;
  e.stains ??= [];
  e.stains.push({ zone, at: [p[0] - e.p[0], p[1] - e.p[1], p[2] - e.p[2]], t: w.time });
  if (zone === 'armL' || zone === 'armR') e.canFire = false; // a hand that cannot hold the rifle
  const legs = (e.wounds.legL ?? 0) + (e.wounds.legR ?? 0);
  e.speedFactor = legs >= 2 || (e.wounds.legL && e.wounds.legR) ? 0.18 : legs ? 0.45 : 1;
  e.crawling = !!(e.wounds.legL && e.wounds.legR);
  sim.ai?.damage(e, Z[kind] ?? 40);
  // the spray behind the wound, onto whatever is there
  splatter(sim, p, dir, zone === 'head' ? 2.2 : zone === 'torso' ? 1.6 : 1);
  w.events.push({ type: 'enemyHit', pos: p.slice(), time: w.time, name: zone });
  return Z;
}

/** Blood thrown from p along dir: onto the first surfaces it meets, and drops falling to the floor. */
export function splatter(sim, p, dir, amount = 1) {
  const w = sim.world;
  const l = Math.hypot(...dir) || 1;
  const d = dir.map((v) => v / l);
  for (let k = 0; k < Math.round(6 * amount); k++) {
    // a cone of droplets behind the wound
    const s = [d[0] + (sim.rand() - 0.5) * 0.7, d[1] + (sim.rand() - 0.5) * 0.7 - 0.1, d[2] + (sim.rand() - 0.5) * 0.7];
    const hit = raySolid(w, p, s, 1.8);
    if (hit) addDecal(w, hit.p, hit.n, (0.04 + sim.rand() * 0.1) * Math.sqrt(amount), 'blood');
  }
  for (let k = 0; k < Math.round(5 * amount); k++)
    w.drops.push({ p: p.slice(), v: [d[0] * 2 + (sim.rand() - 0.5), d[1] * 2 + sim.rand(), d[2] * 2 + (sim.rand() - 0.5)], life: 3 });
}

/** A mark on a surface: blood, or a bullet / arrow hole. */
export function addDecal(w, p, n, r, kind) {
  w.decals.push({ p: p.slice(), n: n.slice(), r, kind, t: w.time, seed: Math.random() });
  if (w.decals.length > 900) w.decals.splice(0, w.decals.length - 900);
  w.decalVersion = (w.decalVersion ?? 0) + 1;
}

/** The first solid along a ray (≤ max m): the point on its surface and the face normal. */
export function raySolid(w, from, dir, max) {
  const l = Math.hypot(...dir) || 1;
  const d = dir.map((v) => v / l);
  const step = w.h * 0.35;
  let prev = from.slice();
  for (let t = step; t < max; t += step) {
    const p = [from[0] + d[0] * t, from[1] + d[1] * t, from[2] + d[2] * t];
    if (p[0] < 0 || p[1] < 0 || p[2] < 0 || p[0] >= w.size[0] || p[1] >= w.size[1] || p[2] >= w.size[2]) return null;
    const i = w.voxelAt(...p);
    if (i >= 0 && w.mat[i] && !(MATERIALS[w.mat[i]].fluidity >= 0.95)) {
      // which face was crossed: the axis on which the voxel changed
      const a = w.coords(i);
      const b = [Math.floor(prev[0] / w.h), Math.floor(prev[1] / w.h), Math.floor(prev[2] / w.h)];
      const n = [0, 0, 0];
      let ax = 0;
      for (let k = 0; k < 3; k++) if (a[k] !== b[k]) ax = k;
      n[ax] = Math.sign(b[ax] - a[ax]) || -Math.sign(d[ax]) || 1;
      // the surface point: on that face
      const q = prev.slice();
      q[ax] = (a[ax] + (n[ax] > 0 ? 1 : 0)) * w.h + n[ax] * 0.004;
      return { p: q, n, i, t };
    }
    prev = p;
  }
  return null;
}

/**
 * A shot (hitscan, a rifle bullet) from `from` along `dir`: hits the first person
 * (by hit zone) or wall in its way. `shooter` is not hit. Returns what it hit.
 */
export function shoot(sim, from, dir, { shooter = null, player = null, range = 80 } = {}) {
  const w = sim.world;
  const l = Math.hypot(...dir) || 1;
  const d = dir.map((v) => v / l);
  const wall = raySolid(w, from, d, range);
  const maxT = wall ? wall.t : range;
  // people along the ray before the wall
  let best = null;
  for (let t = 0.2; t < maxT; t += 0.05) {
    const p = [from[0] + d[0] * t, from[1] + d[1] * t, from[2] + d[2] * t];
    for (const e of w.enemies) {
      if (e === shooter || e.dead) continue;
      if (Math.abs(p[0] - e.p[0]) > 0.4 || Math.abs(p[2] - e.p[2]) > 0.4) continue;
      const z = hitZone(e, p);
      if (z) {
        best = { enemy: e, zone: z, p };
        break;
      }
    }
    if (best) break;
    if (player) {
      const dx = p[0] - player.p[0];
      const dz = p[2] - player.p[2];
      const dy = p[1] - player.p[1];
      if (dx * dx + dz * dz < 0.07 && dy > 0 && dy < 1.8) {
        best = { player: true, zone: dy > 1.5 ? 'head' : dy > 0.95 ? 'torso' : 'legs', p };
        break;
      }
    }
  }
  w.noises.push({ p: from.slice(), loud: 70, time: w.time, kind: shooter ? 'enemy' : 'gunshot' });
  w.tracers.push({ a: from.slice(), b: best ? best.p : wall ? wall.p : [from[0] + d[0] * range, from[1] + d[1] * range, from[2] + d[2] * range], t: w.time });
  if (w.tracers.length > 40) w.tracers.shift();
  if (best?.enemy) {
    wound(sim, best.enemy, best.zone, 'bullet', best.p, d);
    return best;
  }
  if (best?.player) return best;
  if (wall) {
    bulletHole(sim, wall);
    return { wall };
  }
  return null;
}

/** A bullet (or an arrow) in a wall: a hole, chips of a brittle wall, glass breaks. */
export function bulletHole(sim, hit, kind = 'hole') {
  const w = sim.world;
  const M = MATERIALS[w.mat[hit.i]];
  if (M.shatterTemp !== Infinity) {
    w.flags[hit.i] |= F_FALLING; // glass: the pane breaks
    w.structureDirty = true;
    sim.glassNoise?.(hit.i);
    return;
  }
  addDecal(w, hit.p, hit.n, kind === 'arrow' ? 0.02 : 0.013, kind);
  if (M.brittle && sim.rand() < 0.5) addDecal(w, hit.p, hit.n, 0.035, 'chip'); // spalled around the hole
}

/** Every step: wounds bleed (health drains, drops fall), drops land as stains. */
export function stepWounds(sim, dt) {
  const w = sim.world;
  for (const e of w.enemies) {
    if (!e.bleed || e.bleed <= 0.01) continue;
    if (!e.dead) sim.ai?.damage(e, e.bleed * dt);
    // a wound clots slowly; a dead body stops bleeding soon
    e.bleed *= Math.exp(-dt / (e.dead ? 8 : 60));
    if (sim.rand() < dt * Math.min(6, e.bleed * 1.5)) {
      const s = e.stains?.[e.stains.length - 1];
      const from = s ? [e.p[0] + s.at[0], e.p[1] + s.at[1], e.p[2] + s.at[2]] : [e.p[0], e.p[1] + 1, e.p[2]];
      w.drops.push({ p: from, v: [(sim.rand() - 0.5) * 0.3, 0, (sim.rand() - 0.5) * 0.3], life: 3 });
    }
  }
  const keep = [];
  for (const d of w.drops) {
    d.v[1] -= 9.81 * dt;
    const to = [d.p[0] + d.v[0] * dt, d.p[1] + d.v[1] * dt, d.p[2] + d.v[2] * dt];
    const hit = raySolid(w, d.p, [to[0] - d.p[0], to[1] - d.p[1], to[2] - d.p[2]], Math.hypot(to[0] - d.p[0], to[1] - d.p[1], to[2] - d.p[2]) + w.h * 0.4);
    d.life -= dt;
    if (hit) addDecal(w, hit.p, hit.n, 0.018 + Math.random() * 0.03, 'blood');
    else if (d.life > 0 && to[1] > 0) {
      d.p = to;
      keep.push(d);
    }
  }
  w.drops = keep;
}
