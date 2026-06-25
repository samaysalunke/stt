// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import react from '@astrojs/react';
import node from '@astrojs/node';

// https://astro.build/config
export default defineConfig({
  site: process.env.SITE_URL ?? 'https://seekthethrill.in',
  output: 'server',
  // Reject cross-origin form/multipart POSTs (CSRF). Astro enforces this only for
  // browser-sendable content types, so same-origin forms and JSON API calls pass.
  security: { checkOrigin: true },
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      exclude: ['better-sqlite3'],
    },
    build: {
      rollupOptions: {
        external: ['better-sqlite3'],
      },
    },
  },
  adapter: node({ mode: 'standalone' }),
  integrations: [react()],
});
