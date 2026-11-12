import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: './', // works from any sub path, e.g. GitHub Pages
  build: {
    target: 'es2020',
    rollupOptions: {
      // the simulation, and the soldier rig test page
      input: { main: resolve(import.meta.dirname, 'index.html'), rig: resolve(import.meta.dirname, 'rig.html') },
    },
  },
  worker: { format: 'es' }, // the operator sculpt runs in module workers (src/operator/sculpt.worker.js)
});
