/**
 * An island group around the simulated zones (drawn, not simulated): the floor of the
 * ocean and the other islands, in the shared sea's coordinates (metres; heights relative
 * to the sea level, negative under water).
 *
 *  - the deep ocean floor at 50–90 m, with ridges and troughs;
 *  - islands of every size: high ones with peaks and valleys, long ones, volcanic cones,
 *    low sand cays, a sunken reef ring (an atoll's); each with its fringing reef: a
 *    shallow lagoon inside a reef crest just under the surface, then the reef front
 *    falling away into the deep;
 *  - round a simulated zone (spec.zones: its box), a shelf that starts at the level of the
 *    zone's own voxel sea floor at its edge and slopes away from it: the ground under
 *    the water runs on without a seam.
 *
 * makeArchipelago(spec) → { heightAt(x, z), extent }.
 */
export function makeArchipelago(spec) {
  const islands = spec.islands ?? [];
  const zones = spec.zones ?? [];
  const seed = spec.seed ?? 7;
  const hash = (x, z) => {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + Math.imul(seed, 2147483647)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const noise = (x, z) => {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx);
    const uz = fz * fz * (3 - 2 * fz);
    const a = hash(ix, iz);
    const b = hash(ix + 1, iz);
    const c = hash(ix, iz + 1);
    const d = hash(ix + 1, iz + 1);
    return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
  };
  const fbm = (x, z, oct = 4) => {
    let s = 0;
    let a = 0.5;
    for (let k = 0; k < oct; k++) {
      s += a * noise(x, z);
      x = x * 2.03 + 17.1;
      z = z * 2.03 - 9.7;
      a *= 0.5;
    }
    return s;
  };

  function heightAt(x, z) {
    // the deep floor: ridges and troughs
    let y = -62 - 22 * fbm(x / 700, z / 700, 3) + 14 * Math.abs(noise(x / 400 + 3, z / 400) - 0.5);
    for (const I of islands) {
      const dx = x - I.c[0];
      const dz = z - I.c[1];
      const ca = Math.cos(I.rot ?? 0);
      const sa = Math.sin(I.rot ?? 0);
      const u = (dx * ca + dz * sa) / I.rx;
      const v = (-dx * sa + dz * ca) / (I.rz ?? I.rx);
      const reef = I.reef ?? 1.6;
      let rn = Math.hypot(u, v);
      if (rn > reef + 2.5) continue;
      // a ragged coast: bays and points
      rn *= 1 + 0.28 * (fbm(x / (I.rx * 0.45), z / (I.rx * 0.45), 3) - 0.5);
      let hi;
      if (rn < 1) {
        // land: from the beach up to the peak, with valleys and ridges
        const t = 1 - rn;
        const rough = 0.65 + 0.7 * fbm(x / 90, z / 90, 4);
        hi = I.peak > 0 ? 0.8 + (I.peak - 0.8) * Math.pow(t, I.cone ? 1.0 : 1.5) * rough : I.peak;
        if (I.cone && rn < 0.12) hi -= (0.12 - rn) * I.peak * 2.2; // a crater
      } else if (rn < reef) {
        // the lagoon inside the reef: a few metres of water over sand, the reef crest at its edge
        const t = (rn - 1) / (reef - 1);
        hi = -1.5 - 5 * Math.sin(Math.PI * Math.min(1, t * 1.15)) * (0.6 + 0.4 * fbm(x / 40, z / 40, 2)) + 3.8 * Math.pow(t, 6);
        hi = Math.min(hi, -0.6);
      } else {
        // the reef front: steep down to the deep floor
        hi = -0.8 - (rn - reef) * I.rx * 0.55;
      }
      if (I.peak <= 0 && rn < 1) hi = Math.min(hi, I.peak); // a sunken reef ring
      y = Math.max(y, hi);
    }
    // round a simulated zone: its own sea floor at its edge, a shelf sloping away
    for (const Z of zones) {
      const [x0, z0, x1, z1] = Z.box;
      const ex = Math.max(x0 - x, 0, x - x1);
      const ez = Math.max(z0 - z, 0, z - z1);
      const e = Math.hypot(ex, ez);
      if (Z.floor === undefined) continue;
      // (flat for the first metres, level with the voxels' floor: it covers their sides)
      const s = Math.max(0, e - 3);
      const shelf = Z.floor + 0.02 - Math.min(s, 30) * 0.12 - Math.max(0, s - 30) * 0.5 - 1.5 * (fbm(x / 30, z / 30, 2) - 0.5) * Math.min(1, s / 10);
      y = Math.max(y, Math.min(shelf, -0.5));
    }
    return y;
  }
  return { heightAt, extent: spec.extent ?? 2600 };
}
