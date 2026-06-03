// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import react from '@astrojs/react';
import node from '@astrojs/node';

// https://astro.build/config
export default defineConfig({
  site: process.env.SITE_URL ?? 'https://seekthethrill.in',
  output: 'server',
  security: { checkOrigin: false },
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
