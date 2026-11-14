/**
 * Builds the world of a place in the background (sim/prebuild.js): as createSimulation builds it,
 * off the main thread. Its typed arrays go back transferred (not copied); the rest is plain data.
 */
import { buildWorld } from './createSimulation.js';
import { packBuilt } from './prebuild.js';

self.onmessage = (e) => {
  const { id, desc } = e.data;
  try {
    const t0 = performance.now();
    const { msg, transfer } = packBuilt(buildWorld(desc));
    msg.id = id;
    msg.ms = performance.now() - t0;
    self.postMessage(msg, transfer);
  } catch (err) {
    self.postMessage({ id, error: String(err?.stack ?? err) });
  }
};
