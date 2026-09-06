import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Add this proxy before anything else, or every request fails with a
    // cross-origin error that looks like a bug in your own code.
    proxy: {
      '/rest': { target: 'http://localhost:5678', changeOrigin: true },
      '/webhook': { target: 'http://localhost:5678', changeOrigin: true },
      '/healthz': { target: 'http://localhost:5678', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
