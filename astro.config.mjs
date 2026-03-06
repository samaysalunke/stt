// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import keystatic from '@keystatic/astro';
import node from '@astrojs/node';

// https://astro.build/config
export default defineConfig({
  site: 'https://seekthethrill.in',
  output: 'server',
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
  integrations: [react(), sitemap(), keystatic()],
});
