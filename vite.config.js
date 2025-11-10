// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
  root: './', // raíz del proyecto
  publicDir: 'public',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: 'index.html'
    }
  },
  server: {
    port: 5173,
    open: true
  }
});
