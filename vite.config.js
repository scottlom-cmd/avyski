import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    host: true,
    port: 5173
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});
