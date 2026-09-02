// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import react from '@astrojs/react';
import node from '@astrojs/node';

// https://astro.build/config
export default defineConfig({
  // Must match src/lib/siteUrl.ts's fallback — production serves www, and two
  // different defaults meant an unset SITE_URL put Astro on the apex while
  // every canonical, feed, and JSON-LD URL used www.
  site: process.env.SITE_URL ?? 'https://www.seekthethrill.in',
  output: 'server',
  // CSRF origin checks run in src/middleware.ts so forwarded host/proto headers
  // from Railway are respected. Astro's built-in check sees the internal proxy
  // URL and rejects legitimate same-origin multipart uploads in production.
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
