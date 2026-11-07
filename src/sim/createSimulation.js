import { buildScene } from '../models/voxelizer.js';
import { Simulation } from './simulation.js';
import { defaultWeather } from './weather.js';

const IGNITION_SECONDS = 40;

/** Build world + simulation from a scene description and apply its ignitions. */
export function createSimulation(scene) {
  const weather = { ...defaultWeather(), ...(scene.weather ?? {}) };
  const { world, ignitions } = buildScene({ ...scene, weather });
  const sim = new Simulation(world, weather);
  for (const ig of ignitions) {
    sim.ignite(ig.p, ig.radius, ig.materials);
    // a short-lived ignition source keeps heating the spot, like a real fire start
    if (ig.power > 0) sim.addTorch(ig.p, ig.power, IGNITION_SECONDS, Math.max(world.h, ig.radius * 0.6));
  }
  return sim;
}
