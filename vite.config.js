import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  // GitHub Pages project sites serve from /<repo>/, not /. Absolute
  // "/data/..." fetches would 404 there, so every data fetch goes through
  // dataUrl() (src/dataUrl.js), which prefixes import.meta.env.BASE_URL -
  // that env var picks up this `base` automatically in both dev (/) and
  // the Pages build (/avyski/).
  base: '/avyski/',
  server: {
    host: true,
    port: 5173
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});
