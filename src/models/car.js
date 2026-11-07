import { hexToRgb } from './util.js';

export default {
  label: 'Car',
  params: {
    length: { value: 4.2, min: 2.8, max: 5.5, step: 0.05, label: 'Length (m)' },
    width: { value: 1.8, min: 1.4, max: 2.2, step: 0.05, label: 'Width (m)' },
    height: { value: 1.45, min: 1.2, max: 2.0, step: 0.05, label: 'Height (m)' },
    bodyColor: { value: '#2f5fa8', color: true, label: 'Paint colour' },
    upholstery: { value: '#5a5d66', color: true, label: 'Seat colour' },
    fuelLiters: { value: 40, min: 0, max: 90, step: 1, label: 'Fuel (litres)' },
    tankMaterial: { value: 'plastic', options: ['plastic', 'steel'], label: 'Fuel tank' },
    igniteAt: { value: 'engine', options: ['engine', 'interior'], label: 'Fire starts in' },
  },
  build(p, { h }) {
    const t = h;
    const L = p.length;
    const W = p.width;
    const H = p.height;
    const paint = hexToRgb(p.bodyColor);
    const seat = hexToRgb(p.upholstery);
    const belt = 0.95;
    const floor = 0.28;
    const cx0 = -L * 0.3;
    const cx1 = L * 0.2;
    const inset = 0.06;
    // Real thicknesses as effective densities: a 15 cm voxel holding a 1.5 mm
    // body panel has 1% of solid steel's mass, heat capacity and fuel.
    const thin = (m) => Math.min(1, Math.max(0.004, m / h));
    const steel = { material: 'steel', color: paint, variation: 0.03, density: thin(0.0015) };
    const prims = [
      // lower body shell, opened up
      { shape: 'box', min: [-L / 2, floor, -W / 2], max: [L / 2, belt, W / 2], ...steel },
      { shape: 'box', min: [-L / 2 + t, floor + t, -W / 2 + t], max: [L / 2 - t, belt + 0.01, W / 2 - t], mode: 'carve' },
      // firewall between engine bay and cabin
      { shape: 'box', min: [cx1, floor, -W / 2], max: [cx1 + t, belt, W / 2], material: 'steel', variation: 0.03, density: thin(0.0015) },
      // grille: the engine bay breathes through the front
      { shape: 'box', min: [L / 2 - t, 0.5, -W / 2 + 0.2], max: [L / 2 + 0.01, belt - t - 0.01, W / 2 - 0.2], mode: 'carve' },
      // hood and boot lid
      { shape: 'box', min: [cx1, belt - t, -W / 2], max: [L / 2, belt, W / 2], ...steel },
      { shape: 'box', min: [-L / 2, belt - t, -W / 2], max: [cx0, belt, W / 2], ...steel },
      // glasshouse
      { shape: 'box', min: [cx0, belt, -W / 2 + inset], max: [cx1, H, W / 2 - inset], material: 'glass', variation: 0.02, density: thin(0.0045) },
      { shape: 'box', min: [cx0 + t, belt - 0.01, -W / 2 + inset + t], max: [cx1 - t, H - t, W / 2 - inset - t], mode: 'carve' },
      { shape: 'box', min: [cx0, H - t, -W / 2 + inset], max: [cx1, H, W / 2 - inset], ...steel },
    ];
    // pillars
    for (const x of [cx0, (cx0 + cx1) / 2, cx1 - t])
      for (const s of [-1, 1]) {
        const z = s * (W / 2 - inset - t / 2);
        prims.push({ shape: 'box', min: [x, belt, z - t / 2], max: [x + t, H, z + t / 2], ...steel });
      }
    // interior
    const zi = W / 2 - inset - t * 1.5;
    const up = { material: 'foam', color: seat, variation: 0.05 };
    prims.push(
      { shape: 'box', min: [cx1 - 0.35, floor + t, -zi], max: [cx1 - t, 0.75, zi], material: 'plastic', density: 0.06 }, // dashboard
      { shape: 'box', min: [cx1 - 1.0, floor + t, -zi + 0.05], max: [cx1 - 0.5, 0.55, -0.08], ...up },
      { shape: 'box', min: [cx1 - 1.0, floor + t, 0.08], max: [cx1 - 0.5, 0.55, zi - 0.05], ...up },
      { shape: 'box', min: [cx1 - 1.12, floor + t, -zi + 0.05], max: [cx1 - 0.98, 1.2, -0.08], ...up },
      { shape: 'box', min: [cx1 - 1.12, floor + t, 0.08], max: [cx1 - 0.98, 1.2, zi - 0.05], ...up },
      { shape: 'box', min: [cx0 + t, floor + t, -zi], max: [cx0 + 0.6, 0.55, zi], ...up }, // rear bench
      { shape: 'box', min: [cx0 + t, floor + t, -zi], max: [cx0 + 0.18, 1.15, zi], ...up },
      { shape: 'box', min: [cx0 + t, floor, -zi], max: [cx1 - t, floor + t * 1.01, zi], material: 'fabric', color: [0.2, 0.2, 0.22], density: thin(0.01) }, // carpet
    );
    // engine bay: aluminium block, plastic parts, battery
    prims.push(
      { shape: 'box', min: [cx1 + 0.25, floor + t, -0.35], max: [cx1 + 0.75, 0.78, 0.35], material: 'aluminium', density: 0.3 }, // cast block with cavities
      { shape: 'box', min: [cx1 + 0.8, 0.45, -0.5], max: [L / 2 - t, 0.6, 0.5], material: 'plastic', density: 0.3 }, // intake, covers, hoses
      { shape: 'box', min: [cx1 + 0.15, 0.6, 0.45], max: [cx1 + 0.45, 0.85, W / 2 - t], material: 'plastic', color: [0.1, 0.1, 0.1], density: 0.5 }, // battery
    );
    // fuel tank under the rear seat
    if (p.fuelLiters > 0) {
      const vol = p.fuelLiters / 1000;
      const lx = 0.5;
      const lz = Math.min(W * 0.7, 1.0);
      const ly = Math.max(t, vol / (lx * lz));
      const x0 = cx0 + 0.05;
      const y0 = floor + t;
      prims.push(
        { shape: 'box', min: [x0 - t, y0, -lz / 2 - t], max: [x0 + lx + t, y0 + ly + t, lz / 2 + t], material: p.tankMaterial === 'steel' ? 'steel' : 'plastic', density: thin(p.tankMaterial === 'steel' ? 0.0012 : 0.005) },
        { shape: 'box', min: [x0, y0 + t, -lz / 2], max: [x0 + lx, y0 + ly, lz / 2], material: 'gasoline' },
      );
    }
    // bumpers
    prims.push(
      { shape: 'box', min: [L / 2 - 0.12, floor, -W / 2], max: [L / 2, 0.5, W / 2], material: 'plastic', color: [0.12, 0.12, 0.13], density: 0.1 },
      { shape: 'box', min: [-L / 2, floor, -W / 2], max: [-L / 2 + 0.12, 0.5, W / 2], material: 'plastic', color: [0.12, 0.12, 0.13], density: 0.1 },
    );
    // wheels: rubber tyres on aluminium rims
    const wr = 0.33;
    for (const x of [L * 0.32, -L * 0.32])
      for (const s of [-1, 1]) {
        const zo = s * (W / 2);
        const zi2 = s * (W / 2 - 0.22);
        prims.push(
          { shape: 'cylinder', a: [x, wr, zi2], b: [x, wr, zo], r: wr, material: 'rubber', density: 0.15 }, // hollow tyre carcass
          { shape: 'cylinder', a: [x, wr, zi2], b: [x, wr, zo], r: wr * 0.6, material: 'aluminium', density: 0.1 },
        );
      }
    const ignite =
      p.igniteAt === 'engine'
        ? { p: [cx1 + 0.9, 0.7, 0], radius: 0.35, materials: ['plastic', 'rubber', 'foam'], power: 15000 }
        : { p: [cx1 - 0.75, 0.6, -0.4], radius: 0.3, materials: ['foam', 'fabric', 'plastic'], power: 8000 };
    return { prims, ignite };
  },
};
