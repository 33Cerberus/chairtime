import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API = process.env.VITE_API_PROXY ?? 'http://localhost:4000';

// The dev server proxies the API, so the refresh cookie is same-origin in development
// exactly as it is behind a reverse proxy in production.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        // Libraries change far less often than the app, so they get their own long-lived files.
        manualChunks(id) {
          const m = id.replace(/\\/g, '/');
          if (/node_modules\/(react|react-dom|react-router|scheduler)\//.test(m)) return 'react';
          if (m.includes('node_modules/@tanstack/')) return 'query';
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: API, changeOrigin: false },
      '/uploads': { target: API, changeOrigin: false },
    },
  },
});
