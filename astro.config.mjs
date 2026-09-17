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
  // The shared public stylesheet was the last thing blocking first paint: 69 KiB
  // (13.1 KiB gz) fetched before a single pixel, on every page. Splitting it per
  // route was the obvious move and turns out to be worthless — coverage on `/`
  // and `/trips/` is 85%, so there is barely any per-page dead weight to split
  // off. Inlining removes the round trip instead, and measured on an emulated
  // mid-tier mobile connection that is FCP 804→424 ms on `/`, 816→408 ms on
  // `/trips/`, 824→404 ms on a trip page. Full-page screenshots are identical
  // byte for byte.
  //
  // The cost lands on repeat navigations: public HTML is `max-age=0, s-maxage`
  // (see src/middleware.ts), so the browser refetches it every time and now
  // carries the CSS along instead of reusing a cached immutable file — roughly
  // +70 ms per subsequent pageview against ~400 ms saved on entry. Worth it
  // while traffic is mostly first-visit landings; revisit if pages-per-session
  // climbs.
  //
  // This is global, so admin pages inline their own 73 KiB (13.4 KiB gz) sheet
  // too. Uncached, but admin HTML is `private, no-cache` anyway and the audience
  // is a handful of people.
  build: { inlineStylesheets: 'always' },
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
