/**
 * Force generators: functions (body, dt, world) called every substep for every awake dynamic body
 * (world.addForceGenerator) or for one body (body.forceGenerators.push), that apply forces with
 * body.applyForce(f, point).
 *
 *   buoyancy({ level, density = 1000, drag = 2, samples = 3, filter })
 *       Archimedes over sample points of the body's volume (shape.samples(): a voxel set its
 *       voxels; other shapes a 3×3×3 grid inside them): a point under the surface level(x, z, y)
 *       (→ the water's surface height there, or −Infinity: no water) is pushed up by
 *       ρ·g·(its volume × how much of it is under), at the point (so a body rights itself, and a
 *       plank floats flat), and dragged by the water (drag · ρ · submerged volume · its velocity:
 *       it does not bob for ever). Floating debris, crates in a pond, a boat's hull.
 *   waterLevelOfWorld(world, opts)  level() for a sim World: the top of the column of water voxels
 *       at the point (and a world's open sea, world.sea.level).
 */
import { MAT } from '../sim/materials.js';

export function buoyancy({ level, density = 1000, drag = 2, samples = 3, filter = null, g = 9.81 } = {}) {
  return (body, dt) => {
    if (body.buoyant === false || (filter && !filter(body))) return;
    let S = body._buoy;
    if (!S || S.shape !== body.shape) {
      const pts = body.shape.samples(samples).map((s) => ({ p: [s.p[0] + body.shapeOffset[0], s.p[1] + body.shapeOffset[1], s.p[2] + body.shapeOffset[2]], vol: s.vol, half: Math.cbrt(s.vol) / 2 }));
      S = body._buoy = { shape: body.shape, pts };
    }
    let wet = 0;
    const x = [0, 0, 0], v = [0, 0, 0];
    for (const s of S.pts) {
      body.toWorld(s.p, x);
      const top = level(x[0], x[2], x[1]);
      if (!(top > x[1] - s.half)) continue;
      const f = Math.min(1, (top - (x[1] - s.half)) / (2 * s.half));
      const V = s.vol * f;
      wet += V;
      body.velocityAt(x, v);
      const k = drag * density * V;
      body.applyForce([-k * v[0], density * g * V - k * v[1], -k * v[2]], x);
    }
    body.submerged = wet;
  };
}

/** The water level at (x, z) near height y in a sim World (water voxels, or the open sea). */
export function waterLevelOfWorld(w, { water = MAT.water } = {}) {
  const { nx, ny, nz, h } = w;
  return (x, z, y) => {
    const ix = Math.floor(x / h), iz = Math.floor(z / h);
    let top = -Infinity;
    if (w.sea && Number.isFinite(w.sea.level)) top = w.sea.level;
    if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) return top;
    let iy = Math.floor(y / h);
    const at = (j) => j >= 0 && j < ny && w.mat[ix + nx * (j + ny * iz)] === water;
    if (!at(iy)) {
      if (at(iy - 1)) return Math.max(top, iy * h);
      return top;
    }
    while (at(iy + 1)) iy++;
    return Math.max(top, (iy + 1) * h);
  };
}
