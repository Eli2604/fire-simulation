import { livingRoomPrims, bedroomPrims, bedPrims } from './furniture.js';

const WALLS = { brick: 'brick', wood: 'wood', concrete: 'concrete' };
const ROOFS = { tiles: 'tiles', 'wood shingles': 'shingles', metal: 'steel' };
const ROOF_THICK = { tiles: 0.024, 'wood shingles': 0.012, metal: 0.0006 };
// window frames: wood (solid sections), uPVC (hollow plastic profiles), aluminium (thin walls)
const FRAMES = { wood: ['wood', 0.05, [0.92, 0.9, 0.86]], uPVC: ['plastic', 0.008, [0.95, 0.95, 0.94]], aluminium: ['aluminium', 0.003, [0.55, 0.56, 0.58]] };
// what closes the eaves: fascia boards along the roof edge and soffits under the overhang
const EAVES = { wood: ['wood', 0.022], uPVC: ['plastic', 0.004] };
const GUTTERS = { uPVC: ['plastic', 0.0025], metal: ['steel', 0.0007] };

/**
 * A house: walls of brick, wood or concrete on a slab, one to three storeys (wooden floors
 * between them, a stairwell through each), a gabled roof on rafters with tiles, wood shingles
 * or metal sheets, windows in wooden, uPVC or aluminium frames, fascia boards and soffits
 * closing the eaves with a gutter along them, a wooden front door (and a back door), and
 * furnished rooms: a living room (sofa, coffee table, bookshelf, carpet, curtains) downstairs,
 * bedrooms upstairs.
 *
 * What burns from outside: a fire next to a house (a car, a hedge, a woodpile) radiates onto
 * the wall facing it (sim/farRadiation.js). Brick and concrete do not burn, but the window
 * panes crack and fall out (sim: shatterTemp) and the curtains and furniture behind them catch
 * from the flames and the heat coming in; the wooden frames, the door, the fascia, the soffits
 * and the plastic gutter catch from the flames and the plume rising along the wall, and from
 * the eaves the fire gets into the roof. A wooden wall catches itself.
 *
 * The long walls face ±z, the front door is at +z, the back door at -z; the ridge runs along x.
 */
export default {
  label: 'House',
  params: {
    width: { value: 6, min: 3, max: 14, step: 0.1, label: 'Width X (m)' },
    depth: { value: 5, min: 3, max: 12, step: 0.1, label: 'Depth Z (m)' },
    storeys: { value: 1, min: 1, max: 3, step: 1, label: 'Storeys' },
    wallHeight: { value: 2.6, min: 2.2, max: 4, step: 0.1, label: 'Storey height (m)' },
    wallThickness: { value: 0.2, min: 0.05, max: 0.5, step: 0.01, label: 'Wall thickness (m)' },
    wallMaterial: { value: 'brick', options: Object.keys(WALLS), label: 'Walls' },
    roofMaterial: { value: 'tiles', options: Object.keys(ROOFS), label: 'Roof covering' },
    roofPitch: { value: 35, min: 10, max: 55, step: 1, label: 'Roof pitch (°)' },
    eaves: { value: 'wood', options: [...Object.keys(EAVES), 'open'], label: 'Fascia and soffits' },
    gutter: { value: 'uPVC', options: [...Object.keys(GUTTERS), 'none'], label: 'Gutter' },
    windowsPerSide: { value: 2, min: 0, max: 5, step: 1, label: 'Windows per long side' },
    windowWidth: { value: 1.0, min: 0.5, max: 2.5, step: 0.1, label: 'Window width (m)' },
    windowFrame: { value: 'wood', options: Object.keys(FRAMES), label: 'Window frames' },
    furnished: { value: true, label: 'Furnished' },
    curtains: { value: true, label: 'Curtains at the windows' },
    doorOpen: { value: false, label: 'Front door open' },
    backDoor: { value: false, label: 'Back door (wood, at -z)' },
    chimney: { value: true, label: 'Chimney' },
  },
  build(p, { h }) {
    const t = h;
    const Wd = p.width;
    const Dp = p.depth;
    const wh = p.wallHeight;
    const S = Math.max(1, Math.round(p.storeys ?? 1));
    const H = S * wh; // top of the walls
    const wt = Math.max(t, p.wallThickness);
    const wall = WALLS[p.wallMaterial];
    // real thicknesses as effective densities (see voxelizer: density)
    const thin = (m) => Math.min(1, Math.max(0.004, m / h));
    const wallD = Math.min(1, p.wallThickness / wt);
    const hx = Wd / 2;
    const hz = Dp / 2;
    const ix = hx - wt;
    const iz = hz - wt;
    const prims = [
      { shape: 'box', min: [-hx, 0, -hz], max: [hx, t, hz], material: 'concrete', density: thin(0.15) },
      { shape: 'box', min: [-hx, t, -hz], max: [hx, H, hz], material: wall, density: wallD },
    ];
    // the storeys: hollowed out, a wooden floor between them with a stairwell through it
    const stair = { x0: -ix + 0.1, x1: -ix + 1.1, z0: iz - 2.4, z1: iz - 0.2 };
    for (let k = 0; k < S; k++) {
      const yb = k * wh;
      prims.push({ shape: 'box', min: [-hx + wt, yb + t * 1.01, -hz + wt], max: [hx - wt, yb + wh, hz - wt], mode: 'carve' });
      if (k > 0) {
        prims.push(
          { shape: 'box', min: [-hx + wt, yb, -hz + wt], max: [hx - wt, yb + t, hz - wt], material: 'wood', density: thin(0.022) },
          { shape: 'box', min: [stair.x0, yb - 0.01, stair.z0], max: [stair.x1, yb + t * 1.02, stair.z1], mode: 'carve' },
        );
      }
    }
    // ceiling / attic floor (wooden boards)
    prims.push({ shape: 'box', min: [-hx, H, -hz], max: [hx, H + t, hz], material: 'wood', density: thin(0.022) });
    // roof: wooden rafters/sheathing with a covering on the outside
    const oh = 0.3;
    const pitch = (p.roofPitch * Math.PI) / 180;
    const half = hz + oh;
    const rise = half * Math.tan(pitch);
    const y0 = H + t - oh * Math.tan(pitch);
    const roofCover = ROOFS[p.roofMaterial];
    prims.push(
      { shape: 'gable', x0: -hx - oh, x1: hx + oh, y0, half, rise, shell: t * 2.2, material: 'wood', density: thin(0.03) },
      { shape: 'gable', x0: -hx - oh, x1: hx + oh, y0, half, rise, shell: t * 1.05, material: roofCover, mode: 'replace', density: thin(ROOF_THICK[p.roofMaterial]) },
      // gable end walls
      { shape: 'gable', x0: -hx, x1: -hx + wt, y0: H, half: hz, rise: hz * Math.tan(pitch), material: wall === 'brick' ? 'brick' : 'wood', mode: 'fill', density: wallD },
      { shape: 'gable', x0: hx - wt, x1: hx, y0: H, half: hz, rise: hz * Math.tan(pitch), material: wall === 'brick' ? 'brick' : 'wood', mode: 'fill', density: wallD },
    );
    // the eaves along the long sides: a soffit under the overhang from the wall out to the
    // fascia board along the roof edge, a gutter hung on the fascia
    if (EAVES[p.eaves]) {
      const [m, th] = EAVES[p.eaves];
      const ec = [0.93, 0.92, 0.88];
      for (const s of [-1, 1]) {
        const zr = [s * hz, s * (hz + oh)].sort((a, b) => a - b);
        const zf = [s * (hz + oh), s * (hz + oh + t)].sort((a, b) => a - b);
        prims.push(
          { shape: 'box', min: [-hx - oh, y0 - t, zr[0]], max: [hx + oh, y0, zr[1]], material: m, density: thin(th), color: ec, mode: 'fill' },
          { shape: 'box', min: [-hx - oh, y0 - 0.2, zf[0]], max: [hx + oh, y0 + 0.08, zf[1]], material: m, density: thin(th), color: ec },
        );
      }
    }
    if (GUTTERS[p.gutter]) {
      const [m, th] = GUTTERS[p.gutter];
      const zo = hz + oh + (EAVES[p.eaves] ? t : 0);
      for (const s of [-1, 1]) {
        const zr = [s * zo, s * (zo + 0.12)].sort((a, b) => a - b);
        prims.push({ shape: 'box', min: [-hx - oh, y0 - 0.16, zr[0]], max: [hx + oh, y0 - 0.04, zr[1]], material: m, density: thin(th), color: p.gutter === 'metal' ? [0.6, 0.6, 0.62] : [0.3, 0.3, 0.32] });
      }
    }
    if (p.chimney) {
      const cx = hx * 0.5;
      prims.push({ shape: 'box', min: [cx - 0.25, H, hz * 0.2], max: [cx + 0.25, H + rise + 0.6, hz * 0.2 + 0.5], material: 'brick' });
    }
    // windows: a hole through the wall, a frame round a glass pane in the middle
    const winW = p.windowWidth ?? 1.0;
    const [fm, fth, fcol] = FRAMES[p.windowFrame] ?? FRAMES.wood;
    const fw = Math.max(0.06, t * 0.75); // frame width
    const curtains = [];
    const windowAt = (axis, pos, side, yb) => {
      const a = yb + 0.9;
      const b = yb + 2.0;
      // (u: along the wall, n: through it)
      const box = (u0, u1, v0, v1, n0, n1, extra) =>
        axis === 'z' ? { shape: 'box', min: [u0, v0, n0], max: [u1, v1, n1], ...extra } : { shape: 'box', min: [n0, v0, u0], max: [n1, v1, u1], ...extra };
      const nc = side * ((axis === 'z' ? hz : hx) - wt / 2);
      const u0 = pos - winW / 2;
      const u1 = pos + winW / 2;
      prims.push(
        box(u0, u1, a, b, nc - wt / 2 - 0.01, nc + wt / 2 + 0.01, { mode: 'carve' }),
        box(u0, u1, a, b, nc - t / 2, nc + t / 2, { material: 'glass', density: thin(0.006) }),
      );
      const frame = { material: fm, density: thin(fth), color: fcol };
      // (on a coarse grid the frame would be all there is: the pane stands for both)
      if (winW - 2 * fw >= 2 * h) prims.push(
        box(u0, u0 + fw, a, b, nc - t / 2, nc + t / 2, frame),
        box(u1 - fw, u1, a, b, nc - t / 2, nc + t / 2, frame),
        box(u0, u1, a, a + fw, nc - t / 2, nc + t / 2, frame),
        box(u0, u1, b - fw, b, nc - t / 2, nc + t / 2, frame),
      );
      // a curtain half drawn to one side inside it (hanging over a third of the glass)
      const ni = side * ((axis === 'z' ? iz : ix) - t);
      const nn = [ni, ni - side * t * 0.8].sort((x, y) => x - y);
      curtains.push(box(u0 - 0.15, u0 + Math.max(0.3, winW * 0.35), a - 0.2, b + 0.25, nn[0], nn[1], { material: 'fabric', color: [0.8, 0.75, 0.55], density: thin(0.003) }));
    };
    const n = p.windowsPerSide;
    const dx = hx * 0.35; // front door position (at +z)
    const bdx = -hx * 0.35; // back door (at -z)
    for (let k = 0; k < S; k++) {
      const yb = k * wh;
      for (let j = 0; j < n; j++) {
        const x = -hx + (Wd * (j + 1)) / (n + 1);
        if (!(k === 0 && p.backDoor && Math.abs(x - bdx) <= 1.0)) windowAt('z', x, -1, yb);
        if (k > 0 || Math.abs(x - dx) > 1.0) windowAt('z', x, 1, yb);
      }
      if (n > 0) {
        windowAt('x', 0, -1, yb);
        windowAt('x', 0, 1, yb);
      }
    }
    const door = (x, side, open, name) => {
      const zc = side * (hz - wt / 2);
      prims.push({ shape: 'box', min: [x - 0.45, t * 1.01, zc - wt / 2 - 0.01], max: [x + 0.45, 2.05, zc + wt / 2 + 0.01], mode: 'carve' });
      if (!open) prims.push({ shape: 'box', min: [x - 0.45, t * 1.01, zc - t / 2], max: [x + 0.45, 2.05, zc + t / 2], material: 'wood', color: [0.45, 0.25, 0.15], density: thin(0.04), door: name });
    };
    door(dx, 1, p.doorOpen, 'front door');
    if (p.backDoor) door(bdx, -1, false, 'back door');

    let ignite = { p: [0, 1, 0], radius: 0.4, power: 8000 };
    if (p.furnished) {
      const f = t * 1.01; // floor top
      // downstairs the living room (a one-storey house has its bed in it too)
      const lr = livingRoomPrims({ x0: -ix, x1: ix, z0: -iz, z1: iz, f }, { h, bed: S === 1 });
      prims.push(...lr.prims);
      ignite = lr.ignite;
      // upstairs the bedrooms
      for (let k = 1; k < S; k++) {
        const fk = k * wh + t * 1.01;
        prims.push(...(k === 1 ? bedroomPrims({ x0: -ix, x1: ix, z0: -iz, z1: iz, f: fk }, { h }).prims : bedPrims(ix, -iz, fk, t)));
      }
      if (p.curtains) prims.push(...curtains);
    }
    return { prims, ignite };
  },
};
