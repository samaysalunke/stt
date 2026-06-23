import type { APIRoute } from 'astro';
import { INDEXNOW_KEY } from '../lib/indexnow';

export const prerender = false;

// Serves the IndexNow ownership key at /<key>.txt. Only the real key resolves;
// anything else 404s, so this route never reveals the secret or shadows assets.
export const GET: APIRoute = ({ params }) => {
  if (!INDEXNOW_KEY || params.key !== INDEXNOW_KEY) {
    return new Response('Not Found', { status: 404 });
  }
  return new Response(INDEXNOW_KEY, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
