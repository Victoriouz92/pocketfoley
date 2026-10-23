import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Relative paths so the built app runs from any folder or sub-path (and inside native wrappers).
  base: './',
  plugins: [react(), tailwindcss()],
  // Reachable from a phone on the same Wi-Fi for testing (npm run dev / preview).
  server: { host: true },
  preview: { host: true },
});
