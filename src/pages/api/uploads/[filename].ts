import type { APIRoute } from 'astro';
import fs from 'fs';
import path from 'path';
import { UPLOADS_DIR } from '../../../lib/upload';

// Registration uploads are limited to jpg/png/pdf, but map by extension explicitly
// rather than defaulting everything to image/jpeg, so the header stays correct if
// the allow-list is ever widened.
const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
};

export const GET: APIRoute = async ({ params }) => {
  const filename = params.filename ?? '';

  // Prevent path traversal
  if (!filename || filename.includes('/') || filename.includes('..')) {
    return new Response('Not found', { status: 404 });
  }

  const filepath = path.join(UPLOADS_DIR, filename);
  if (!fs.existsSync(filepath)) {
    return new Response('Not found', { status: 404 });
  }

  const ext = path.extname(filename).toLowerCase();
  const contentType = MIME[ext] ?? 'application/octet-stream';

  const data = fs.readFileSync(filepath);
  return new Response(data, {
    status: 200,
    headers: { 'Content-Type': contentType },
  });
};
