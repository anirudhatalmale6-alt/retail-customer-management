import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In development the API runs as a separate process; proxying /api keeps
    // the browser on one origin so there are no CORS surprises.
    proxy: {
      '/api': { target: process.env.API_URL || 'http://127.0.0.1:4000', changeOrigin: true },
    },
  },
});
