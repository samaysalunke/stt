import type { APIRoute } from 'astro';
import fs from 'fs';
import path from 'path';
import { UPLOADS_DIR } from '../../../lib/upload';

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
  const contentType =
    ext === '.pdf' ? 'application/pdf' :
    ext === '.png' ? 'image/png' :
    'image/jpeg';

  const data = fs.readFileSync(filepath);
  return new Response(data, {
    status: 200,
    headers: { 'Content-Type': contentType },
  });
};
