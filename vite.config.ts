import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Local SPA. Dev: Vite on :5173 proxies /api → the Node server on :4317.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // HOST=0.0.0.0 exposes the dev server on the LAN; default localhost only.
    host: process.env.HOST === '0.0.0.0',
    proxy: { '/api': 'http://localhost:4317' },
  },
  build: { outDir: 'dist' },
});
