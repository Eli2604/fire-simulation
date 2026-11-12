import { buildScene } from '../models/voxelizer.js';
import { Simulation } from './simulation.js';
import { defaultWeather } from './weather.js';
import { toggleDoor } from './doors.js';
import { initVacuum } from './vacuum.js';
import { DetailPatches } from './patches.js';
import { initSnow } from './snow.js';

const IGNITION_SECONDS = 40;

/**
 * Build world + simulation from a scene description and start its fires.
 *
 * Fire starts come from the objects marked "burning at start" (each model
 * knows a sensible spot), unless the scene has its own `fireStarts`
 * ([{ p: [x,y,z], radius, power }], chosen by clicking in the app): those
 * replace the defaults. `sim.markers` lists every fire start and pending
 * source (e.g. a gas pipe that will burst) for display.
 */
export function createSimulation(scene) {
  // a scene split into zones: build the current (or starting) zone only
  if (scene.zones && !scene.world) {
    const z = scene.zones[scene.zone ?? scene.startZone ?? Object.keys(scene.zones)[0]];
    scene = { ...scene, world: z.world, objects: z.objects, view: z.view ?? scene.view, walkStart: z.walkStart };
  }
  // the voxel size: the scene's own (each zone has its own), times a factor chosen for the
  // hardware (coarser: faster; finer: more detail, ~16x the work for half the size)
  if (scene.voxelScale && scene.voxelScale !== 1) scene = { ...scene, world: { ...scene.world, h: scene.world.h * scene.voxelScale } };
  const zoneW = scene.zones?.[scene.zone ?? scene.startZone]?.weather; // a zone can have its own (space: no wind, no rain)
  const weather = { ...defaultWeather(), ...(scene.weather ?? {}), ...(zoneW ?? {}) };
  const { world, ignitions, spawn } = buildScene({ ...scene, weather });
  world.dark = !!scene.view?.dark; // underground: a light where there should be none is noticed
  world.indoor = !!(scene.indoor ?? scene.zones?.[scene.zone ?? scene.startZone]?.indoor); // no sky over it: no snow
  if (weather.snowCover > 0) initSnow(world, weather.snowCover); // snow lying when it starts (outdoors)
  const sim = new Simulation(world, weather);
  // where the firefighter walk-through starts: chosen by the user, the scene's own, or the edge
  sim.spawn = scene.walkStart ?? spawn ?? defaultSpawn(world);
  world.doors.forEach((d, k) => d.startOpen && toggleDoor(sim, k, true));
  if (world.vacuum) initVacuum(world); // the cabin has air, space around it none
  world.events.length = 0;
  sim.markers = [];
  const custom = scene.fireStarts?.length ? scene.fireStarts : null;
  const starts = scene.noFire
    ? []
    : custom
    ? custom.map((f) => ({ p: f.p, radius: f.radius ?? Math.max(0.25, world.h * 2), materials: null, power: f.power ?? defaultStartPower(world) }))
    : ignitions;
  for (const ig of starts) {
    // on a coarse grid the model's kindling may be smaller than a voxel: widen the
    // search and accept any fuel
    if (!sim.ignite(ig.p, ig.radius, ig.materials)) sim.ignite(ig.p, Math.max(ig.radius, world.h * 1.5));
    // a short-lived ignition source keeps heating the spot, like a real fire start
    const power = ig.power > 0 ? ig.power : world.h > 0.1 ? defaultStartPower(world) : 0; // coarse grids: kindling is sub-voxel
    if (power > 0) sim.addTorch(ig.p, power, IGNITION_SECONDS, Math.max(world.h, ig.radius * 0.6));
    sim.markers.push({ p: ig.p, label: custom ? 'Fire start (yours)' : 'Fire start', kind: 'start' });
  }
  sim.markers.push(walkMarker(sim));
  // candles (and the like) that get a fine world of their own close up
  // a wall torch (a flame on a drawn torch, models/catacombs.js and others) gets its head in detail close up
  for (const ht of world.heaters) if (ht.label === 'torch' && ht.light && !ht.kind && !ht.detail) ht.detail = { type: 'torch' };
  if (world.heaters.some((ht) => ht.detail)) sim.patches = new DetailPatches(sim);
  for (const ht of world.heaters) {
    if (ht.start !== undefined) sim.markers.push({ p: ht.pos, label: `${ht.label ?? 'source'} (after ${ht.start} s)`, kind: 'pending', heater: ht });
  }
  return sim;
}

/** No start point in the scene: at the edge of the world, halfway along, on top of whatever is there. */
export function defaultSpawn(world) {
  return { p: [world.size[0] * 0.1, null, world.size[2] / 2], yaw: 0 };
}

/** Height of the floor under a walk-in start (searching down from just above its point, or from the top). */
export function spawnFloor(world, p) {
  const h = world.h;
  const from = p[1] == null ? world.size[1] : p[1] + 1.2;
  for (let y = from; y > 0; y -= h * 0.5) {
    const i = world.voxelAt(p[0], y - h * 0.25, p[2]);
    if (i >= 0 && world.mat[i]) return Math.floor((y - h * 0.25) / h) * h + h;
  }
  return h;
}

/** The marker showing where "Walk through as a firefighter" puts you. */
export function walkMarker(sim) {
  const p = sim.spawn.p;
  return { p: [p[0], spawnFloor(sim.world, p), p[2]], label: 'Walk-in start', kind: 'walk', yaw: sim.spawn.yaw ?? 0 };
}

/** Ignition source power scaled with the voxel size (a match is not enough for a 20 cm voxel). */
export function defaultStartPower(world) {
  return Math.round(Math.min(20000, Math.max(300, 5000 * (world.h / 0.05) ** 2)));
}
