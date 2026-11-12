/**
 * Brass candelabra (a photo scan, CC0, Poly Haven: "brass_candleholders" by Tina): a
 * seven-branched candelabrum, a three-candle holder and a single candlestick, with their
 * candles burning. The candles are ours, not the scan's (its are cut out of it): each is a
 * candle as models/candle.js makes one in a coarse scene, a small burner drawn as a candle,
 * and close up a fine world of its own (sim/patches.js) where its wax melts and drips.
 *
 * Simulated as brass voxels: each candlestick a column holding as much metal as it has
 * (at 20 cm voxels its arms are far thinner than a voxel, so its brass is spread over the
 * column: same weight, same heat it takes). A blast throws it over or apart, a fierce fire
 * melts it (brass at ~930 °C); the flames on a part that is gone go out. Its voxels are
 * hidden and render/statue.js draws the scan over them.
 *
 * Local frame: the three stand in a row along x (the big one at +x), facing +z.
 */
// the bases of the 11 flames, in the scan's frame (read from its glTF)
const FLAMES = [
  [0.4006, 0.8011, 0], [0.5721, 0.7166, 0.0001], [0.2285, 0.7166, 0], [0.4877, 0.7219, 0.1486], [0.3122, 0.7219, -0.1494],
  [0.4865, 0.7219, -0.1509], [0.3126, 0.7239, 0.1471], [0, 0.3771, -0.0003], [-0.1062, 0.3592, -0.0003], [0.1061, 0.3586, -0.0003], [-0.4, 0.3422, -0.0003],
];
// its candles (measured on the scan): radius and length above the cup, per flame
const CANDLES = FLAMES.map((_, k) => (k < 7 ? { r: 0.012, len: 0.165 } : k < 10 ? { r: 0.009, len: 0.115 } : { r: 0.009, len: 0.13 }));
const WICK = 0.008;
// the three, in the scan's frame: centre x, half sizes, height, brass in it (kg)
const PIECES = [
  { x: 0.4, hx: 0.2, hz: 0.18, hgt: 0.81, kg: 3.0 },
  { x: 0, hx: 0.13, hz: 0.05, hgt: 0.26, kg: 1.0 },
  { x: -0.4, hx: 0.05, hz: 0.05, hgt: 0.35, kg: 0.5 },
];
let count = 0;

export default {
  label: 'Brass candelabra (scanned)',
  params: {
    scale: { value: 0.8, min: 0.3, max: 2, step: 0.05, label: 'Scale' },
    lit: { value: true, label: 'Candles burning' },
  },
  build(p, { h }) {
    const k = p.scale;
    const tag = `candelabra${++count}`;
    const prims = [];
    for (const q of PIECES) {
      // at least a voxel each way (thin brass spread over it: its density says how much)
      const hx = Math.max(q.hx * k, h / 2);
      const hz = Math.max(q.hz * k, h / 2);
      const hy = Math.max(q.hgt * k, h);
      const vol = 8 * hx * hz * (hy / 2);
      prims.push({ shape: 'box', min: [q.x * k - hx, 0, -hz], max: [q.x * k + hx, hy, hz], material: 'brass', density: Math.min(1, q.kg / 8500 / vol), color: [0.75, 0.6, 0.3], hidden: true });
    }
    // a candle in every cup: its top where the scan's was, the flame on its wick
    const heaters = FLAMES.map(([fx, fy, fz], n) => {
      const c = { height: CANDLES[n].len * k, radius: CANDLES[n].r * k };
      const params = { height: c.height, radius: c.radius, wax: 'paraffin', color: '#f4efe2', wickLength: WICK, holder: false };
      return {
        pos: [fx * k, fy * k + WICK, fz * k], power: p.lit ? 60 : 0, on: p.lit, radius: 0.008, height: 0.04, light: true, label: 'candle', kind: 'candle', tag,
        candle: { ...c, wick: WICK, color: params.color, holder: false },
        detail: { type: 'candle', params, top: c.height + WICK },
      };
    });
    // (the scan's own candles cut out of it: [x, z, from, to, r] in its frame)
    const cut = FLAMES.map(([fx, fy, fz], n) => [fx, fz, fy - CANDLES[n].len - 0.004, fy + 0.03, CANDLES[n].r + 0.005]);
    return { prims, heaters, props: [{ type: 'statueMesh', polyhaven: 'brass_candleholders', material: 'brass', p: [0, 0, 0], scale: k, hideFlames: true, cut, tag, radius: 1.2 }] };
  },
};
