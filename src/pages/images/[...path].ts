import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

// Admin-uploaded images live in CONTENT_DIR/images/ (volume-backed).
// Seed/repo images live in public/images/. Check volume first.
const CONTENT_IMAGES = path.join(
  process.env.CONTENT_DIR ?? path.join(process.cwd(), 'src', 'content'),
  'images'
);
const PUBLIC_IMAGES = path.join(process.cwd(), 'public', 'images');

export const GET: APIRoute = async ({ params }) => {
  const rel = params.path ?? '';

  // Prevent path traversal
  if (rel.includes('..')) {
    return new Response('Forbidden', { status: 403 });
  }

  // Look in volume first, then repo
  let filePath = path.join(CONTENT_IMAGES, rel);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    filePath = path.join(PUBLIC_IMAGES, rel);
  }

  // Final traversal guard after path.join resolves
  const inContent = filePath.startsWith(CONTENT_IMAGES + path.sep) || filePath === CONTENT_IMAGES;
  const inPublic = filePath.startsWith(PUBLIC_IMAGES + path.sep) || filePath === PUBLIC_IMAGES;
  if (!inContent && !inPublic) {
    return new Response('Forbidden', { status: 403 });
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return new Response('Not Found', { status: 404 });
  }

  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const contentType = MIME[ext] ?? 'application/octet-stream';
  const buffer = fs.readFileSync(filePath);

  return new Response(buffer, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
