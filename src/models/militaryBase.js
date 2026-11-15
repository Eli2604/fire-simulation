import { hexToRgb } from './util.js';
import { PLACE } from './composite.js';

/**
 * The buildings and groundwork of a military base (the camp island's complex, src/campIsland.js):
 *
 *  - hqBuilding: the headquarters, a flat-roofed concrete block (windows, a parapet, an antenna
 *    mast, air-conditioning units, a flagpole). Its inside is a place of its own (a child of type
 *    'place', models/composite.js): the office corridor with sprinklers (models/hallway.js), built
 *    only when you go in by its door (E at the door: a portal to `doorTo`).
 *  - barracks: a long single-storey hut (walls, windows, two doors that open, a gable roof).
 *  - helipad: a concrete pad with its yellow ring and the white H, lights round its edge.
 *  - guardPost: the gate: a sentry booth beside the road and a barrier arm across it (a door: E),
 *    run by sim/gates.js: drivers radio the base to have it raised, a sentry works it.
 *  - blastWall: a run of concrete T-wall panels (the perimeter).
 *  - road: a strip of tarmac (or hardstanding) laid in the ground's top layer: no step up.
 *
 * Local frames: x along the length (a road's, a wall's), z across, y up from the ground; the
 * headquarters' door is on its +z side.
 */
const thinOf = (h) => (m) => Math.min(1, Math.max(0.004, m / h));

/** The corridor with sprinklers as a place inside the headquarters (the old Hallway with sprinklers scene). */
export function hqCorridorPlace(key = 'headquarters') {
  return {
    type: PLACE,
    key,
    name: 'Headquarters: office corridor with sprinklers',
    label: 'HQ corridor (sprinklers)',
    indoor: true,
    exposure: 'indoor', // (no weather in an office corridor)
    world: { size: [17, 4.2, 7.6], h: 0.1 },
    weather: { ambient: 18, humidity: 0.5 },
    timeScale: 1,
    view: { camera: [1.2, 3.8, -1.5], walk: true },
    x: 0,
    y: 0,
    z: 0,
    // the gas pipe bursts after 20 s; the glass bulbs burst at 68 °C; the entrance door leads out ('..')
    objects: [{ type: 'hallway', params: { sprinklers: true, exitTo: '..', exitLabel: 'Door: out to the base' }, x: 9.5, z: 2 }],
  };
}

export const hqBuilding = {
  label: 'Headquarters building (its corridor a place inside)',
  params: {
    width: { value: 14, min: 6, max: 40, step: 0.5, label: 'Length along X (m)' },
    depth: { value: 8, min: 5, max: 20, step: 0.5, label: 'Depth along Z (m)' },
    height: { value: 3.6, min: 2.8, max: 8, step: 0.1, label: 'Height to the roof (m)' },
    color: { value: '#b8b29b', color: true, label: 'Wall colour' },
    doorX: { value: -3, min: -20, max: 20, step: 0.5, label: 'Door at X (m from the middle, on the +z side)' },
    doorTo: { value: 'headquarters', label: 'Place the door leads into' },
    doorLabel: { value: 'Door: into the headquarters', label: 'What the door is (its hint)' },
    flag: { value: true, label: 'Flagpole by the door' },
    mast: { value: true, label: 'Antenna mast on the roof' },
  },
  children: () => [hqCorridorPlace()],
  build(p, { h }) {
    const thin = thinOf(h);
    const W = p.width / 2;
    const D = p.depth / 2;
    const H = p.height;
    const t = Math.max(h, 0.3); // walls and roof slab
    const wall = { material: 'concrete', color: hexToRgb(p.color), variation: 0.04, anchored: true };
    const dx = Math.max(-W + 1, Math.min(W - 1, p.doorX));
    const prims = [
      // the shell, hollowed out (a floor slab, the roof slab over it)
      { shape: 'box', min: [-W, 0, -D], max: [W, H, D], ...wall },
      { shape: 'box', min: [-W + t, Math.max(h, 0.15), -D + t], max: [W - t, H - t, D - t], mode: 'carve' },
      // the parapet round the roof, a darker coping
      { shape: 'box', min: [-W, H, -D], max: [W, H + 0.6, D], ...wall },
      { shape: 'box', min: [-W + t, H, -D + t], max: [W - t, H + 0.6, D - t], mode: 'carve' },
      { shape: 'box', min: [-W, H - t, -D], max: [W, H, D], material: 'concrete', color: [0.42, 0.42, 0.4], anchored: true, mode: 'replace' },
    ];
    // windows (glass in the walls) along both long sides, one storey's worth, clear of the door
    const n = Math.max(1, Math.floor(p.width / 3));
    for (let k = 0; k < n; k++) {
      const x = -W + (p.width * (k + 0.5)) / n;
      for (const s of [-1, 1]) {
        if (s > 0 && Math.abs(x - dx) < 1.6) continue;
        prims.push({ shape: 'box', min: [x - 0.7, 1.0, s > 0 ? D - t : -D - 0.01], max: [x + 0.7, Math.min(H - 0.6, 2.3), s > 0 ? D + 0.01 : -D + t], material: 'glass', color: [0.35, 0.45, 0.5], density: thin(0.006) });
      }
    }
    for (const s of [-1, 1]) prims.push({ shape: 'box', min: [s * W - (s > 0 ? t : 0.01), 1.0, -1], max: [s * W + (s > 0 ? 0.01 : t), Math.min(H - 0.6, 2.3), 1], material: 'glass', color: [0.35, 0.45, 0.5], density: thin(0.006) });
    // the door (steel, painted), a canopy over it and a step before it
    prims.push(
      { shape: 'box', min: [dx - 0.6, 0, D - t], max: [dx + 0.6, 2.2, D + 0.01], material: 'steel', color: [0.24, 0.3, 0.22], density: thin(0.004), anchored: true },
      { shape: 'box', min: [dx - 1.3, 2.6, D], max: [dx + 1.3, 2.6 + Math.max(h, 0.15), D + 1.4], material: 'concrete', color: [0.5, 0.5, 0.48], anchored: true },
    );
    // on the roof: two air-conditioning units, the antenna mast
    prims.push(
      { shape: 'box', min: [W - 3.2, H, -D + 1.2], max: [W - 1.8, H + 1.0, -D + 2.4], material: 'steel', color: [0.7, 0.72, 0.7], density: 0.15 },
      { shape: 'box', min: [W - 5.2, H, -D + 1.2], max: [W - 3.8, H + 1.0, -D + 2.4], material: 'steel', color: [0.7, 0.72, 0.7], density: 0.15 },
    );
    if (p.mast) prims.push({ shape: 'cylinder', a: [-W + 2, H, -D + 2], b: [-W + 2, H + 7, -D + 2], r: 0.12, material: 'steel', density: thin(0.004), anchored: true });
    if (p.flag) {
      const fx = dx + 2.6;
      const fz = D + 2.2;
      prims.push(
        { shape: 'cylinder', a: [fx, 0, fz], b: [fx, 7.5, fz], r: 0.07, material: 'steel', color: [0.85, 0.85, 0.85], density: thin(0.004), anchored: true },
        { shape: 'box', min: [fx + 0.1, 6.4, fz - 0.05], max: [fx + 1.7, 7.4, fz + 0.05], material: 'fabric', color: [0.3, 0.38, 0.24], density: thin(0.001), anchored: true },
      );
    }
    return {
      prims,
      // (E at the door: into the place inside; coming out you stand before it, facing away)
      portals: p.doorTo ? [{ p: [dx, 0, D + 0.7], r: 0.9, to: p.doorTo, label: p.doorLabel, arrive: { p: [dx, 0, D + 1.9], yaw: Math.PI / 2 } }] : [],
    };
  },
};

export const barracks = {
  label: 'Barracks hut',
  params: {
    length: { value: 11, min: 4, max: 30, step: 0.5, label: 'Length along X (m)' },
    width: { value: 6, min: 3, max: 12, step: 0.5, label: 'Width along Z (m)' },
    height: { value: 2.8, min: 2.2, max: 4, step: 0.1, label: 'Wall height (m)' },
    color: { value: '#6d7350', color: true, label: 'Wall colour' },
    roofColor: { value: '#4a4f45', color: true, label: 'Roof colour' },
    doorsOpen: { value: false, label: 'Doors open' },
  },
  build(p, { h }) {
    const thin = thinOf(h);
    const L = p.length / 2;
    const Wz = p.width / 2;
    const H = p.height;
    const t = Math.max(h, 0.15);
    const walls = { material: 'wood', color: hexToRgb(p.color), variation: 0.05, moisture: 0.12, anchored: true };
    const prims = [
      { shape: 'box', min: [-L, 0, -Wz], max: [L, Math.max(h, 0.2), Wz], material: 'concrete', color: [0.55, 0.55, 0.52], anchored: true },
      { shape: 'box', min: [-L, 0, -Wz], max: [L, H, Wz], ...walls },
      { shape: 'box', min: [-L + t, Math.max(h, 0.2), -Wz + t], max: [L - t, H + 0.01, Wz - t], mode: 'carve' },
    ];
    // the gable roof: layers stepping in to the ridge (along x), overhanging the walls a little
    const rise = Math.max(0.8, p.width * 0.22);
    const layers = Math.max(2, Math.round(rise / h));
    // (a solid wedge, the loft boarded in: hollowed layer by layer it opens up where the layers
    // fall between the voxels)
    for (let k = 0; k < layers; k++) {
      const half = (Wz + 0.4) * (1 - k / layers);
      prims.push({ shape: 'box', min: [-L - 0.3, H + (rise * k) / layers, -half], max: [L + 0.3, H + (rise * (k + 1)) / layers, half], material: 'wood', color: hexToRgb(p.roofColor), variation: 0.03, moisture: 0.12, anchored: true });
    }
    // windows along both sides, doors at both ends (wood, they open: E)
    const n = Math.max(1, Math.floor(p.length / 2.8));
    for (let k = 0; k < n; k++) {
      const x = -L + (p.length * (k + 0.5)) / n;
      for (const s of [-1, 1]) prims.push({ shape: 'box', min: [x - 0.5, 1.0, s > 0 ? Wz - t : -Wz - 0.01], max: [x + 0.5, Math.min(2.0, H - 0.3), s > 0 ? Wz + 0.01 : -Wz + t], material: 'glass', density: thin(0.006) });
    }
    for (const s of [-1, 1]) {
      const x0 = s > 0 ? L - t : -L - 0.01;
      const x1 = s > 0 ? L + 0.01 : -L + t;
      prims.push(
        { shape: 'box', min: [x0, Math.max(h, 0.2), -0.5], max: [x1, 2.1, 0.5], mode: 'carve' },
        { shape: 'box', min: [x0, Math.max(h, 0.2), -0.5], max: [x1, 2.1, 0.5], material: 'wood', color: [0.42, 0.33, 0.22], density: thin(0.04), door: s > 0 ? 'barracks door (east)' : 'barracks door (west)', doorOpen: p.doorsOpen },
      );
    }
    // bunks along the inside of the walls (steel frames, mattresses)
    const bunks = Math.max(0, Math.floor((p.length - 3) / 2.2));
    for (let k = 0; k < bunks; k++) {
      const x = -L + 1.6 + k * 2.2;
      for (const s of [-1, 1]) {
        const z0 = s > 0 ? Wz - t - 0.9 : -Wz + t;
        prims.push({ shape: 'box', min: [x, Math.max(h, 0.2), z0], max: [x + 1.9, Math.max(h, 0.2) + 0.5, z0 + 0.9], material: 'foam', color: [0.35, 0.38, 0.3], density: 0.4 });
      }
    }
    return { prims };
  },
};

export const helipad = {
  label: 'Helipad (its ring, the H, lights round the ring)',
  params: {
    size: { value: 13, min: 6, max: 30, step: 0.5, label: 'Size (m, square)' },
    lights: { value: true, label: 'Lights round the ring' },
  },
  build(p, { h }) {
    const S = p.size / 2;
    const step = Math.max(h, 0.25);
    const prims = [];
    // laid in the ground's top layer (its top level with the ground): concrete, the yellow ring,
    // the white H; cell by cell
    const R0 = S * 0.62;
    const R1 = S * 0.62 + Math.max(0.5, step);
    const hw = S * 0.32; // the H: its legs at ±hw, as high as 1.3 hw
    const leg = Math.max(0.5, step * 1.5);
    for (let x = -S; x < S - 1e-9; x += step)
      for (let z = -S; z < S - 1e-9; z += step) {
        const cx = x + step / 2;
        const cz = z + step / 2;
        const r = Math.hypot(cx, cz);
        const inH = Math.abs(cz) < hw * 1.3 && (Math.abs(Math.abs(cx) - hw) < leg / 2 || (Math.abs(cx) < hw && Math.abs(cz) < leg / 2));
        const color = r > R0 && r < R1 ? [0.85, 0.7, 0.12] : inH ? [0.92, 0.92, 0.9] : [0.5, 0.5, 0.48];
        prims.push({ shape: 'box', min: [x, -h, z], max: [x + step, 0, z + step], material: 'concrete', color, variation: 0.02, anchored: true });
      }
    if (p.lights)
      // (round the ring: the touchdown area's edge lights)
      for (let k = 0; k < 8; k++) {
        const x = Math.cos((k * Math.PI) / 4 + Math.PI / 8) * (R1 + 0.35);
        const z = Math.sin((k * Math.PI) / 4 + Math.PI / 8) * (R1 + 0.35);
        prims.push({ shape: 'box', min: [x - 0.15, 0, z - 0.15], max: [x + 0.15, 0.3, z + 0.15], material: 'glass', color: [0.95, 0.75, 0.2], density: 0.3, anchored: true });
      }
    return { prims };
  },
};

export const guardPost = {
  label: 'Gate guard post (sentry booth, barrier arm)',
  params: {
    roadWidth: { value: 6, min: 3, max: 12, step: 0.5, label: 'Road width the barrier spans (m)' },
    side: { value: '-z', options: ['-z', '+z'], label: 'Booth on the side of the road' },
    barrierOpen: { value: false, label: 'Barrier up' },
    unit: { value: 'Lima', options: ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Kilo', 'Lima', 'none'], label: "Sentries' call sign (who mans it)" },
    callsign: { value: 'Base', label: 'Base call sign (the radio a driver calls)' },
    remote: { value: true, label: 'Base can raise it remotely (no sentry needed)' },
    lockdown: { value: false, label: 'Lockdown (every request denied)' },
  },
  build(p, { h }) {
    const thin = thinOf(h);
    const s = p.side === '+z' ? 1 : -1;
    const half = p.roadWidth / 2;
    const t = Math.max(h, 0.12);
    // the booth: beside the road, inside the gate (at -x), windows all round, a flat roof
    const bx = -2.6;
    const bz = s * (half + 1.6);
    const B = 1.2;
    const prims = [
      { shape: 'box', min: [bx - B, 0, bz - B], max: [bx + B, 2.5, bz + B], material: 'concrete', color: [0.62, 0.6, 0.52], anchored: true },
      { shape: 'box', min: [bx - B + t, Math.max(h, 0.1), bz - B + t], max: [bx + B - t, 2.5 - t, bz + B - t], mode: 'carve' },
      { shape: 'box', min: [bx - B - 0.3, 2.5, bz - B - 0.3], max: [bx + B + 0.3, 2.5 + Math.max(h, 0.15), bz + B + 0.3], material: 'concrete', color: [0.45, 0.45, 0.43], anchored: true },
    ];
    const pane = { material: 'glass', density: thin(0.006) };
    for (const a of [-1, 1]) prims.push({ shape: 'box', min: [a > 0 ? bx + B - t : bx - B - 0.01, 1.1, bz - 0.6], max: [a > 0 ? bx + B + 0.01 : bx - B + t, 2.1, bz + 0.6], ...pane });
    const rz = bz - s * B; // (the wall facing the road)
    prims.push({ shape: 'box', min: [bx - 0.6, 1.1, s > 0 ? rz - 0.01 : rz - t], max: [bx + 0.6, 2.1, s > 0 ? rz + t : rz + 0.01], ...pane });
    // its doorway on the side away from the road
    prims.push({ shape: 'box', min: [bx - 0.45, Math.max(h, 0.1), bz + s * (B - t) - 0.01], max: [bx + 0.45, 2.1, bz + s * B + 0.01], mode: 'carve' });
    // the barrier: its post on the booth's side, the arm (red and white) across the road; up: E
    const pz = s * (half + 0.3);
    prims.push({ shape: 'box', min: [-0.2, 0, pz - 0.2], max: [0.2, 1.1, pz + 0.2], material: 'steel', color: [0.3, 0.3, 0.3], density: 0.3, anchored: true });
    const seg = Math.max(0.5, h);
    for (let z = -half, k = 0; z < half - 1e-9; z += seg, k++) {
      prims.push({ shape: 'box', min: [-0.06, 0.9, z], max: [0.06, 1.1, Math.min(half, z + seg)], material: 'aluminium', color: k % 2 ? [0.9, 0.9, 0.88] : [0.8, 0.12, 0.1], density: thin(0.01), door: 'gate barrier', doorOpen: p.barrierOpen });
    }
    // sandbags before the booth
    prims.push({ shape: 'box', min: [bx + B + 0.2, 0, bz - 0.9], max: [bx + B + 0.8, 0.9, bz + 0.9], material: 'quarrySand', color: [0.62, 0.55, 0.4], anchored: true });
    // the gate as a thing that is run (sim/gates.js): the barrier's door, its pivot on the post and
    // its tip, the road's way through it (+x: out of the base), where a sentry works it (between
    // the sandbags and the post), who mans it, the base's call sign
    const gates = [{
      name: 'gate barrier', p: [0, 1, 0], dir: [1, 0, 0], half, pivot: [0, 1.0, pz], tip: [0, 1.0, -s * half], control: [-0.5, 0, s * (half + 0.8)], booth: [bx, 0, bz],
      unit: p.unit === 'none' ? null : p.unit, callsign: p.callsign || 'Base', remote: !!p.remote, lockdown: !!p.lockdown,
    }];
    return { prims, gates };
  },
};

export const blastWall = {
  label: 'Blast wall (concrete T-wall panels)',
  params: {
    length: { value: 8, min: 1.5, max: 80, step: 0.5, label: 'Length (m)' },
    height: { value: 2.6, min: 1, max: 5, step: 0.1, label: 'Height (m)' },
    thickness: { value: 0.4, min: 0.2, max: 1, step: 0.05, label: 'Thickness (m)' },
    panel: { value: 1.5, min: 0.5, max: 4, step: 0.1, label: 'Panel width (m)' },
  },
  build(p, { h }) {
    const L = p.length / 2;
    const T = Math.max(h, p.thickness) / 2;
    const prims = [];
    const n = Math.max(1, Math.round(p.length / p.panel));
    for (let k = 0; k < n; k++) {
      const x0 = -L + (p.length * k) / n;
      const x1 = -L + (p.length * (k + 1)) / n;
      const c = k % 2 ? 0.58 : 0.62;
      // (down into the ground a little: no gap under it where the ground falls away)
      prims.push(
        { shape: 'box', min: [x0, -0.6, -T], max: [x1, p.height, T], material: 'concrete', color: [c, c - 0.01, c - 0.05], variation: 0.03, anchored: true },
        // the T's foot
        { shape: 'box', min: [x0, -0.6, -T - 0.4], max: [x1, Math.min(0.4, p.height), T + 0.4], material: 'concrete', color: [c, c - 0.01, c - 0.05], variation: 0.03, anchored: true },
      );
    }
    return { prims };
  },
};

export const road = {
  label: 'Road / hardstanding (laid in the ground)',
  params: {
    length: { value: 8, min: 1, max: 120, step: 0.5, label: 'Length along X (m)' },
    width: { value: 5, min: 1, max: 30, step: 0.5, label: 'Width along Z (m)' },
    color: { value: '#3a3b3d', color: true, label: 'Surface colour' },
    centreLine: { value: true, label: 'Dashed centre line' },
    posts: { value: true, label: 'Marker posts at its ends' },
  },
  build(p, { h }) {
    const L = p.length / 2;
    const Wz = p.width / 2;
    // its top level with the ground's: it is the ground's top layer (no step to trip on)
    const prims = [{ shape: 'box', min: [-L, -h, -Wz], max: [L, 0, Wz], material: 'concrete', color: hexToRgb(p.color), variation: 0.03, anchored: true }];
    if (p.centreLine && p.width >= 3)
      for (let x = -L + 1; x < L - 1; x += 4)
        prims.push({ shape: 'box', min: [x, -h, -Math.max(h, 0.12) / 2], max: [Math.min(L, x + 2), 0, Math.max(h, 0.12) / 2], material: 'concrete', color: [0.9, 0.9, 0.85], anchored: true });
    if (p.posts)
      for (const a of [-1, 1])
        for (const b of [-1, 1]) prims.push({ shape: 'box', min: [a * L - 0.08, 0, b * (Wz + 0.3) - 0.08], max: [a * L + 0.08, 1.0, b * (Wz + 0.3) + 0.08], material: 'plastic', color: [0.92, 0.92, 0.9], density: 0.3, anchored: true });
    return { prims };
  },
};
