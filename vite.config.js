import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // works from any sub path, e.g. GitHub Pages
  build: { target: 'es2020' },
});
