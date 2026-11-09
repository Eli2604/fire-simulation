import { buildScene } from '../models/voxelizer.js';
import { Simulation } from './simulation.js';
import { defaultWeather } from './weather.js';
import { toggleDoor } from './doors.js';

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
    scene = { ...scene, world: z.world, objects: z.objects, view: z.view ?? scene.view };
  }
  const weather = { ...defaultWeather(), ...(scene.weather ?? {}) };
  const { world, ignitions, spawn } = buildScene({ ...scene, weather });
  const sim = new Simulation(world, weather);
  sim.spawn = spawn;
  world.doors.forEach((d, k) => d.startOpen && toggleDoor(sim, k, true));
  world.events.length = 0;
  sim.markers = [];
  const custom = scene.fireStarts?.length ? scene.fireStarts : null;
  const starts = scene.noFire
    ? []
    : custom
    ? custom.map((f) => ({ p: f.p, radius: f.radius ?? Math.max(0.25, world.h * 2), materials: null, power: f.power ?? defaultStartPower(world) }))
    : ignitions;
  for (const ig of starts) {
    sim.ignite(ig.p, ig.radius, ig.materials);
    // a short-lived ignition source keeps heating the spot, like a real fire start
    if (ig.power > 0) sim.addTorch(ig.p, ig.power, IGNITION_SECONDS, Math.max(world.h, ig.radius * 0.6));
    sim.markers.push({ p: ig.p, label: custom ? 'Fire start (yours)' : 'Fire start', kind: 'start' });
  }
  for (const ht of world.heaters) {
    if (ht.start !== undefined) sim.markers.push({ p: ht.pos, label: `${ht.label ?? 'source'} (after ${ht.start} s)`, kind: 'pending', heater: ht });
  }
  return sim;
}

/** Ignition source power scaled with the voxel size (a match is not enough for a 20 cm voxel). */
export function defaultStartPower(world) {
  return Math.round(Math.min(20000, Math.max(300, 5000 * (world.h / 0.05) ** 2)));
}
