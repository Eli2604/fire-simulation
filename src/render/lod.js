/**
 * Level of detail, one rule for everything that is drawn: the nearer (the bigger on the screen),
 * the more detail. Plain numbers only (no three.js), so the simulation's detail patches
 * (sim/patches.js) choose with the same rules as the renderers.
 *
 *  - The measure is the size on the screen, not the distance: an object's radius over its
 *    distance times the projection (pixels per metre at 1 m, from the field of view and the
 *    height of the view), times the quality `bias` (the GUI's "Detail (LOD bias)": 2 shows
 *    everything as if it were twice as near). So zooming in, a bigger window or a narrower
 *    field of view all give more detail, as they should.
 *  - Levels: 0 is full detail; an item gives the screen sizes (px, radius) where it drops a
 *    level, largest first: [120, 40, 12] → level 0 above 120 px, 1 above 40, 2 above 12, else 3.
 *  - Hysteresis: a boundary is crossed only once the size is a margin past it (15% by default,
 *    or an explicit [in, out] pair), so nothing flickers between two levels at the boundary.
 *  - Budgets: at most N of a group at full detail at once (`budgets.character`), the biggest on
 *    the screen win (those that have it keep it until another is clearly bigger).
 *
 * `lod` is the one manager the view drives (view.render: `lod.begin` once a frame, with the
 * camera); a renderer asks it for an item's level (`lod.level(state, x, y, z, r, levels, group)`)
 * as it draws it, keeping the item's own small `state` object between frames. Nothing has to
 * be registered or removed: a budget is settled from what was asked the frame before.
 *
 * Not the voxels: the scene's voxels are drawn as one instanced mesh of their surface
 * (render/voxels.js), rebuilt only when the world changes and coloured every frame; drawing
 * far ones coarser (2×2×2 merged) would mean rebuilding it as the camera moves, and mixing the
 * colours of burning, charring and glowing voxels, for triangles that are not what costs (one
 * draw call). The smooth surface (render/surface.js) is chunked, but a coarser chunk next to a
 * fine one leaves cracks (it would need skirts or transition cells). Both are left as they are.
 */

/** Pixels per metre at 1 m of a view `heightPx` tall with a vertical field of view `fovDeg`. */
export function projection(heightPx, fovDeg) {
  return heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
}

/** The projection of the view the levels were tuned on: 800 px tall, 50° (≈858 px/m at 1 m). */
export const REF_PROJECTION = projection(800, 50);

/** An object's radius on the screen (px) at `distance` (m). */
export function screenSize(radius, distance, proj = REF_PROJECTION, bias = 1) {
  return (radius / Math.max(distance, 1e-6)) * proj * bias;
}

/**
 * The level for a screen size `size`, given the sizes `levels` where it drops a level (largest
 * first; each a number, or an [in, out] pair: finer once above `in`, coarser once below `out`)
 * and the level it is at now (`current`; -1 or undefined: none yet, no hysteresis).
 */
export function pickLevel(size, levels, current = -1, hysteresis = 0.15) {
  let lv = 0;
  for (let i = 0; i < levels.length; i++) {
    const t = levels[i];
    const [tin, tout] = Array.isArray(t) ? t : [t * (1 + hysteresis), t * (1 - hysteresis)];
    // boundary i lies between level i and level i+1: from finer (current <= i) it takes `out`
    // to cross it, from coarser (current > i) it takes `in`; with no level yet, its middle
    const edge = current < 0 || current == null ? (Array.isArray(t) ? (tin + tout) / 2 : t) : current <= i ? tout : tin;
    if (current >= 0 && current <= i ? size < edge : size <= edge) lv = i + 1;
    else break;
  }
  return lv;
}

/**
 * At most `budget` of `entries` ({ size, level }) at a level finer than `floor` (default 1:
 * full detail is level 0): the biggest win, the rest are held at `floor`. Sorts nothing in place;
 * returns the entries that kept their level.
 */
export function applyBudget(entries, budget, floor = 1) {
  if (!(budget >= 0) || budget === Infinity) return entries.slice();
  const fine = entries.filter((e) => e.level < floor).sort((a, b) => b.size - a.size);
  fine.slice(budget).forEach((e) => (e.level = floor));
  return fine.slice(0, budget);
}

/** How many frames between updates of something animated at `level` (rates: per level). */
export function updateEvery(level, rates = [1, 2, 4, 8]) {
  return rates[Math.min(rates.length - 1, Math.max(0, level))];
}

export class LodManager {
  constructor() {
    this.bias = 1; // the quality bias (GUI: "Detail (LOD bias)")
    this.hysteresis = 0.15;
    this.budgets = { character: 4 }; // at most this many at full detail at once
    this.cam = null; // the camera (world-local [x, y, z]); none: everything at full detail
    this.proj = REF_PROJECTION;
    this.frame = 0;
    this.inView = null; // (x, y, z, r) => whether a sphere is in the view (none: always)
    this.asked = {}; // group -> sizes asked this frame (for next frame's budget)
    this.cutoff = {}; // group -> the smallest size that may still have full detail
    this.stats = { asked: 0, levels: [0, 0, 0, 0, 0] };
  }

  /**
   * Once a frame, before anything is drawn: the camera (world-local position), the projection
   * (pixels per metre at 1 m: `projection(heightPx, fov)`) and optionally a test whether a
   * sphere is in view.
   */
  begin(cam, proj = REF_PROJECTION, inView = null) {
    this.frame++;
    this.cam = cam ? [cam[0], cam[1], cam[2]] : null;
    this.proj = proj;
    this.inView = inView;
    // the budgets: the Nth biggest of what was asked last frame is the cut-off for this one
    for (const [g, sizes] of Object.entries(this.asked)) {
      const n = this.budgets[g];
      sizes.sort((a, b) => b - a);
      this.cutoff[g] = n == null || sizes.length <= n ? 0 : n <= 0 ? Infinity : sizes[n - 1];
      sizes.length = 0;
    }
    this.stats.asked = 0;
    this.stats.levels.fill(0);
  }

  /** How much nearer than on the reference view things look (bias and projection): ≥ 0. */
  scale() {
    return (this.proj / REF_PROJECTION) * this.bias;
  }

  /** A distance as it counts on the reference view (for detail that thins out gradually). */
  equivalentDistance(d) {
    return d / Math.max(1e-6, this.scale());
  }

  /** The screen size (px) of a sphere at x, y, z of radius r (Infinity without a camera). */
  size(x, y, z, r) {
    const c = this.cam;
    if (!c) return Infinity;
    return screenSize(r, Math.hypot(x - c[0], y - c[1], z - c[2]), this.proj, this.bias);
  }

  /**
   * The level of an item at x, y, z with radius r (world-local, m): `levels` as for pickLevel,
   * `state` its own object, kept between frames (state.level, state.size, state.inView are
   * set), `group` the budget it counts against (none: no budget).
   */
  level(state, x, y, z, r, levels, group = null) {
    const size = this.size(x, y, z, r);
    let lv = pickLevel(size, levels, state.level ?? -1, this.hysteresis);
    if (group) {
      // full detail only for the biggest N (one that has it keeps it until another is 10% bigger)
      const rank = state.level === 0 ? size * 1.1 : size;
      (this.asked[group] ??= []).push(rank);
      if (lv === 0 && rank < (this.cutoff[group] ?? 0)) lv = 1;
    }
    state.level = lv;
    state.size = size;
    state.inView = !this.inView || !this.cam || this.inView(x, y, z, r);
    this.stats.asked++;
    this.stats.levels[Math.min(4, lv)]++;
    return lv;
  }
}

/** The one manager the view drives and the renderers ask. */
export const lod = new LodManager();
