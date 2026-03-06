// Serves uploaded images from public/images/ in production.
// (The Astro standalone server only serves files from dist/client/ by default;
//  runtime-uploaded files need this route to be accessible.)
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

export const GET: APIRoute = async ({ params }) => {
  const rel = params.path ?? '';
  const imagesDir = path.join(process.cwd(), 'public', 'images');
  const filePath = path.resolve(imagesDir, rel);

  // Prevent path traversal
  if (!filePath.startsWith(imagesDir + path.sep) && filePath !== imagesDir) {
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
