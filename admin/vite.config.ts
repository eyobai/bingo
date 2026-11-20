import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Served by the backend at /admin/. In development the API is proxied to the backend on :3000.
export default defineConfig({
  base: '/admin/',
  plugins: [react(), tailwindcss()],
  server: { port: 5174, proxy: { '/api': 'http://localhost:3000' } },
});
