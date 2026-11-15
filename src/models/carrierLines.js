/**
 * The carrier's lines (no three.js here): the whole ship round the simulated slice of its deck
 * (models/carrier.js carrierDeck; pr: its 'carrierHull' prop { hx, hz, D, draft }). Drawn by
 * render/hull.js, its body in the physics (physics/shipCore.js) from the same.
 *
 *   carrierHullEnds(pr)   where it ends along its length (its own frame): the transom, the bow
 *                         (the deck's forward edge) and the stem at the waterline
 *   carrierLines(pr)      { xStern, xBow, xStem, half(x, y), yBot(x), yTop }: its half breadth at
 *                         (x, y) and the bottom's height at x
 */

/**
 * Where the drawn ship ends, along its length (its own frame): the transom, the bow (the deck's
 * forward edge) and the stem at the waterline. The sea (render/ocean.js) takes its foam and its
 * lee from the same.
 */
export function carrierHullEnds(pr) {
  const { hx, hz } = pr;
  const B = 2 * hz;
  const len = 4.3 * B;
  const xStern = -hx - Math.max(4, Math.min(len * 0.18, (len - 2 * hx) * 0.3));
  const xBow = Math.max(xStern + len, hx + B * 0.8);
  return { xStern, xBow, xStem: xBow - 3.5 };
}

export function carrierLines(pr) {
  const hx = pr.hx;
  const hz = pr.hz;
  const D = pr.D;
  const T = pr.draft;
  // the ship's ends: about 4.3 × the beam long, the slice a little aft of amidships
  // (a slice that is most of the deck: the stern just aft of it, the bow narrowing beyond it)
  const { xStern, xBow, xStem } = carrierHullEnds(pr); // (the stem at the waterline: it rakes forward above)
  const yTop = D - 0.6;
  // half width at (x, y): the slice is the full beam; it narrows to the stem at the
  // bow (raked) and a little to the transom at the stern; flared above the waterline
  const half = (x, y) => {
    let wW;
    let wTop;
    if (x > hx) {
      const t = (x - hx) / (xStem - hx);
      wW = hz * Math.max(0, 1 - t * t);
      wTop = hz * (1 - 0.55 * Math.pow(Math.min(1, (x - hx) / (xBow - hx)), 1.6));
    } else if (x < -hx) {
      const t = (-hx - x) / (-hx - xStern);
      wW = hz * (1 - 0.18 * t);
      wTop = hz * (1 - 0.05 * t);
    } else {
      wW = hz;
      wTop = hz;
    }
    let w;
    if (y >= T) w = wW + (wTop - wW) * Math.pow((y - T) / (yTop - T), 1.4);
    else {
      // the bilge: round towards the flat bottom
      const s = Math.max(0, y / T);
      w = wW * (0.72 + 0.28 * Math.sqrt(s));
    }
    // the stem rakes forward: beyond it there is no hull at this height
    const xEnd = xStem + (xBow - xStem) * Math.max(0, y / D);
    if (x > xEnd - 0.01) return 0;
    if (x > hx) w = Math.min(w, (xEnd - x) * 1.8);
    return Math.max(0, w);
  };
  // the bottom rises towards the stern (the run) and a little at the bow
  const yBot = (x) => (x < -hx ? Math.min(1.6, ((-hx - x) / (-hx - xStern)) * 1.6) : x > xStem - 6 ? Math.min(T * 0.6, ((x - xStem + 6) / 6) * T * 0.6) : 0);
  return { xStern, xBow, xStem, half, yBot, yTop };
}
