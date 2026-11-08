import { MAT, materialId } from '../sim/materials.js';
import { World, hash3 } from '../sim/world.js';
import { MODELS, resolveParams } from './index.js';

/**
 * Primitive shapes, defined in a model's local frame (metres, y up, origin at
 * the centre of the model's footprint on the ground):
 *
 *  { shape: 'box', min: [x,y,z], max: [x,y,z] }
 *  { shape: 'cylinder', a: [x,y,z], b: [x,y,z], r }      flat-ended, any axis
 *  { shape: 'capsule', a, b, r }                          rounded ends
 *  { shape: 'sphere', c, r }
 *  { shape: 'ellipsoid', c, r: [rx,ry,rz] }
 *  { shape: 'cone', base: [x,y,z], r, height }            vertical
 *  { shape: 'gable', x0, x1, y0, half, rise, shell? }    roof prism along x
 *
 * Common options:
 *  material   material name
 *  mode       'set' (default) | 'fill' (only empty cells) | 'carve' (make empty)
 *             | 'replace' (only occupied cells)
 *  fill       0..1 probability per voxel (foliage, grass)
 *  moisture   override default moisture
 *  temp       initial temperature
 *  color      [r,g,b] 0..1 paint/tint
 *  variation  colour noise amount
 *  anchored   never falls
 */

const EPS = 1e-6;

function insideFn(p, h) {
  const minT = h * 0.72; // thin parts still produce at least one voxel line, even between voxel centres
  switch (p.shape) {
    case 'box': {
      const mn = p.min.slice();
      const mx = p.max.slice();
      for (let k = 0; k < 3; k++) {
        if (mx[k] - mn[k] < h) {
          const c = (mx[k] + mn[k]) / 2;
          mn[k] = c - h / 2;
          mx[k] = c + h / 2;
        }
      }
      return {
        bounds: [mn, mx],
        test: (x, y, z) =>
          x >= mn[0] - EPS && x <= mx[0] + EPS && y >= mn[1] - EPS && y <= mx[1] + EPS && z >= mn[2] - EPS && z <= mx[2] + EPS,
      };
    }
    case 'cylinder':
    case 'capsule': {
      const [ax, ay, az] = p.a;
      const [bx, by, bz] = p.b;
      const r = Math.max(p.r, minT);
      const dx = bx - ax;
      const dy = by - ay;
      const dz = bz - az;
      const len2 = dx * dx + dy * dy + dz * dz || EPS;
      const capsule = p.shape === 'capsule';
      return {
        bounds: [
          [Math.min(ax, bx) - r, Math.min(ay, by) - r, Math.min(az, bz) - r],
          [Math.max(ax, bx) + r, Math.max(ay, by) + r, Math.max(az, bz) + r],
        ],
        test: (x, y, z) => {
          let t = ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / len2;
          if (!capsule && (t < -EPS || t > 1 + EPS)) return false;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = ax + dx * t - x;
          const qy = ay + dy * t - y;
          const qz = az + dz * t - z;
          return qx * qx + qy * qy + qz * qz <= r * r + EPS;
        },
      };
    }
    case 'sphere': {
      const [cx, cy, cz] = p.c;
      const r = Math.max(p.r, minT);
      return {
        bounds: [
          [cx - r, cy - r, cz - r],
          [cx + r, cy + r, cz + r],
        ],
        test: (x, y, z) => (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2 <= r * r + EPS,
      };
    }
    case 'ellipsoid': {
      const [cx, cy, cz] = p.c;
      const [rx, ry, rz] = p.r.map((v) => Math.max(v, minT));
      return {
        bounds: [
          [cx - rx, cy - ry, cz - rz],
          [cx + rx, cy + ry, cz + rz],
        ],
        test: (x, y, z) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2 <= 1 + EPS,
      };
    }
    case 'cone': {
      const [bx, by, bz] = p.base;
      const { r, height } = p;
      return {
        bounds: [
          [bx - r, by, bz - r],
          [bx + r, by + height, bz + r],
        ],
        test: (x, y, z) => {
          if (y < by - EPS || y > by + height + EPS) return false;
          const rr = Math.max(r * (1 - (y - by) / height), minT * 0.5);
          return (x - bx) ** 2 + (z - bz) ** 2 <= rr * rr + EPS;
        },
      };
    }
    case 'gable': {
      const { x0, x1, y0, half, rise } = p;
      const shell = p.shell ?? 0;
      const slope = half / rise; // horizontal per vertical
      const halfAt = (y) => half - (y - y0) * slope;
      return {
        bounds: [
          [x0, y0, -half],
          [x1, y0 + rise, half],
        ],
        test: (x, y, z) => {
          if (x < x0 - EPS || x > x1 + EPS || y < y0 - EPS) return false;
          const hw = halfAt(y);
          const az = Math.abs(z);
          if (az > hw + EPS) return false;
          return !(shell > 0 && az < hw - shell && y > y0 + shell * 0.25);
        },
      };
    }
    default:
      throw new Error(`Unknown shape '${p.shape}'`);
  }
}

/**
 * Build the voxel world for a scene description:
 *  { world: { size: [x,y,z], h, ground }, weather, objects: [{ type, params, x, z, rotation }] }
 * Returns { world, ignitions: [{ p, radius, materials }], heaters }.
 */
export function buildScene(scene) {
  const ws = scene.world;
  const world = new World({ size: ws.size, h: ws.h, ambient: scene.weather?.ambient ?? 15 });
  const { nx, nz } = world;
  const ground = materialId(ws.ground ?? 'soil');
  for (let z = 0; z < nz; z++)
    for (let x = 0; x < nx; x++) world.setVoxel(world.idx(x, 0, z), ground, { anchored: true, variation: 0.12 });

  const ignitions = [];
  let spawn = null;
  scene.objects.forEach((obj, oi) => {
    const res = placeObject(world, obj, oi);
    if (obj.ignite && res.ignite) ignitions.push(res.ignite);
    spawn ??= res.spawn;
  });
  world.rebuildLists();
  return { world, ignitions, spawn };
}

/** Voxelise one scene object into the world. */
export function placeObject(world, obj, ownerIndex = -1) {
  const model = MODELS[obj.type];
  if (!model) throw new Error(`Unknown model type '${obj.type}'`);
  const params = resolveParams(model, obj.params);
  const h = world.h;
  let seed = (params.seed ?? 1) * 7919 + ownerIndex * 104729 + 17;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const built = model.build(params, { h, rng });
  // Snap the origin to a voxel centre so thin, axis aligned parts (wicks,
  // bars) map onto exactly one voxel line.
  const ox = (Math.floor((obj.x ?? world.size[0] / 2) / h) + 0.5) * h;
  const oz = (Math.floor((obj.z ?? world.size[2] / 2) / h) + 0.5) * h;
  const oy = h; // top of the ground layer
  const rot = ((obj.rotation ?? 0) * Math.PI) / 180;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const toWorld = (lx, ly, lz) => [ox + cr * lx + sr * lz, oy + ly, oz - sr * lx + cr * lz];

  // pressure vessels declared by the model (fuel tanks, gas cylinders)
  const vesselIndex = {};
  for (const [name, spec] of Object.entries(built.vessels ?? {})) {
    vesselIndex[name] = world.vessels.length;
    world.vessels.push({ ...spec, name, owner: ownerIndex, state: 'sealed' });
  }

  for (const p of built.prims) {
    const { bounds, test } = insideFn(p, h);
    // world AABB of the rotated local AABB
    let mn = [Infinity, Infinity, Infinity];
    let mx = [-Infinity, -Infinity, -Infinity];
    for (let c = 0; c < 8; c++) {
      const wp = toWorld(bounds[c & 1 ? 1 : 0][0], bounds[c & 2 ? 1 : 0][1], bounds[c & 4 ? 1 : 0][2]);
      for (let k = 0; k < 3; k++) {
        mn[k] = Math.min(mn[k], wp[k]);
        mx[k] = Math.max(mx[k], wp[k]);
      }
    }
    const x0 = Math.max(0, Math.floor(mn[0] / h) - 1);
    const x1 = Math.min(world.nx - 1, Math.ceil(mx[0] / h) + 1);
    const y0 = Math.max(1, Math.floor(mn[1] / h) - 1);
    const y1 = Math.min(world.ny - 1, Math.ceil(mx[1] / h) + 1);
    const z0 = Math.max(0, Math.floor(mn[2] / h) - 1);
    const z1 = Math.min(world.nz - 1, Math.ceil(mx[2] / h) + 1);
    const mode = p.mode ?? 'set';
    const id = mode === 'carve' ? 0 : materialId(p.material);
    const fill = p.fill ?? 1;
    const salt = Math.floor((p.seed ?? 0) * 1000) + ownerIndex * 31;
    const group = p.group ? ++world.groupCounter : 0; // one rigid panel per primitive
    const pipe = p.gasPipe ? { voxels: [], power: p.gasPipe.power ?? 150000, jetHeight: p.gasPipe.jetHeight ?? 1, failTemp: p.gasPipe.failTemp ?? 450, owner: ownerIndex } : null;
    if (pipe) world.gasPipes.push(pipe);
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          // world voxel centre -> local
          const wx = (x + 0.5) * h - ox;
          const wz = (z + 0.5) * h - oz;
          const lx = cr * wx - sr * wz;
          const lz = sr * wx + cr * wz;
          const ly = (y + 0.5) * h - oy;
          if (!test(lx, ly, lz)) continue;
          const i = world.idx(x, y, z);
          if (mode === 'fill' && world.mat[i]) continue;
          if (mode === 'replace' && !world.mat[i]) continue;
          if (fill < 1 && hash3(i * 13 + salt) > fill) continue;
          if (mode === 'carve') {
            if (world.mat[i]) world.clearVoxel(i);
            continue;
          }
          world.setVoxel(i, id, {
            moisture: p.moisture,
            temp: p.temp,
            color: p.color,
            variation: p.variation,
            anchored: p.anchored,
            density: p.density,
            group,
            paint: p.paint,
            owner: ownerIndex,
            vesselTag: p.vessel !== undefined ? (p.vesselRole === 'contents' ? -1 : 1) * (vesselIndex[p.vessel] + 1) : 0,
          });
          if (pipe) pipe.voxels.push(i);
        }
  }

  for (const ht of built.heaters ?? []) {
    world.heaters.push({ ...ht, pos: toWorld(...ht.pos), on: ht.on ?? true, owner: ownerIndex });
  }
  let ignite = null;
  if (built.ignite) {
    ignite = {
      p: toWorld(...built.ignite.p),
      radius: built.ignite.radius ?? h * 2,
      materials: built.ignite.materials ? built.ignite.materials.map((n) => MAT[n]) : null,
      power: built.ignite.power ?? 0, // W of a temporary ignition source (burning rag, fault...)
    };
  }
  // where a walk-through would start (yaw in the world frame)
  const spawn = built.spawn ? { p: toWorld(...built.spawn.p), yaw: (built.spawn.yaw ?? 0) + rot } : null;
  return { ignite, params, spawn };
}
