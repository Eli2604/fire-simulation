/**
 * A ready-made object from a photo scan or a detailed model (CC0, Poly Haven; loaded from
 * there: render/assets.js), simulated as voxels of its material over its outline, holding
 * its real weight (a chair of a few kilos of wood is a few voxels of low density). Its
 * voxels are hidden and render/statue.js draws the model over them: it burns, chars,
 * glows, melts and is thrown about or broken by blasts with them, its pieces flying and
 * lying as pieces of the model.
 *
 * Local frame: the model's own (Poly Haven: centred, standing on y = 0).
 */
export const ASSETS = {
  // key: Poly Haven id, material, its weight (kg), size (m: x, z, height), credit
  throne: { id: 'WoodenChair_01', mat: 'oak', kg: 30, size: [0.69, 0.66, 2.27], by: 'Jake Mobley' },
  vase: { id: 'brass_vase_02', mat: 'brass', kg: 1.2, size: [0.21, 0.21, 0.53], by: 'Rico Cilliers' },
  bench: { id: 'painted_wooden_bench', mat: 'wood', kg: 12, size: [1.16, 0.5, 0.89], by: 'Kirill Sannikov' },
  drum: { id: 'Barrel_01', mat: 'steel', kg: 18, size: [0.56, 0.56, 0.88], by: 'Jorge Camacho' },
  jerrycan: { id: 'metal_jerrycan', mat: 'steel', kg: 4, size: [0.35, 0.17, 0.46], by: 'Sean Buckley' },
  table: { id: 'WoodenTable_01', mat: 'wood', kg: 25, size: [1.8, 0.66, 0.55], by: 'Ethan Place' },
};
// densities of the materials (kg/m³): how much of its outline the material fills
const RHO = { oak: 750, wood: 500, brass: 8500, steel: 7850 };

export default {
  label: 'Ready-made object (scanned)',
  params: {
    asset: { value: 'bench', options: Object.keys(ASSETS), label: 'Object' },
    scale: { value: 1, min: 0.3, max: 3, step: 0.05, label: 'Scale' },
  },
  build(p, { h }) {
    const A = ASSETS[p.asset] ?? ASSETS.bench;
    const k = p.scale;
    // its outline, at least a voxel each way; the density spreads its weight over it
    const hx = Math.max((A.size[0] * k) / 2, h / 2);
    const hz = Math.max((A.size[1] * k) / 2, h / 2);
    const hy = Math.max(A.size[2] * k, h);
    const vol = 4 * hx * hz * hy;
    const kg = A.kg * k ** 3;
    return {
      prims: [{ shape: 'box', min: [-hx, 0, -hz], max: [hx, hy, hz], material: A.mat, density: Math.min(1, kg / (RHO[A.mat] ?? 1000) / vol), hidden: true }],
      props: [{ type: 'statueMesh', polyhaven: A.id, material: A.mat, p: [0, 0, 0], scale: k, radius: Math.max(hx, hz) + 0.6, height: hy }],
    };
  },
};
