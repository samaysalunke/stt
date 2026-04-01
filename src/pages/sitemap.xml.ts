import type { APIRoute } from 'astro';
import { readdirSync } from 'fs';
import { join } from 'path';

const SITE = 'https://seekthethrill.in';

function getSlugs(contentDir: string): string[] {
  try {
    return readdirSync(contentDir)
      .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
      .map((f) => f.replace(/\.(yaml|yml)$/, ''));
  } catch {
    return [];
  }
}

function url(path: string, priority: string, changefreq: string, lastmod?: string): string {
  return `
  <url>
    <loc>${SITE}${path}</loc>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}
  </url>`;
}

export const GET: APIRoute = () => {
  const tripSlugs = getSlugs(join(process.cwd(), 'src/content/trips'));
  const albumSlugs = getSlugs(join(process.cwd(), 'src/content/albums'));

  const staticPages = [
    url('/', '1.0', 'weekly'),
    url('/trips', '0.9', 'daily'),
    url('/about', '0.6', 'monthly'),
    url('/contact', '0.6', 'monthly'),
    url('/faq', '0.6', 'monthly'),
    url('/photo-vault', '0.5', 'monthly'),
    url('/privacy', '0.3', 'yearly'),
    url('/terms', '0.3', 'yearly'),
  ];

  const tripPages = tripSlugs.map((slug) => url(`/trips/${slug}`, '0.8', 'weekly'));
  const albumPages = albumSlugs.map((slug) => url(`/photo-vault/${slug}`, '0.5', 'monthly'));

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[...staticPages, ...tripPages, ...albumPages].join('')}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
