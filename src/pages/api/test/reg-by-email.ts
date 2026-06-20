// Test-only endpoint — only active when DISABLE_RATE_LIMIT=true (dev/test env).
// Returns the most recent registration row for a given email.
// Never expose this in production.
import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';

export const GET: APIRoute = async ({ url }) => {
  if (process.env.DISABLE_RATE_LIMIT !== 'true') {
    return new Response(JSON.stringify({ error: 'Not available' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    });
  }
  const email = url.searchParams.get('email');
  if (!email) {
    return new Response(JSON.stringify({ error: 'email param required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  const row = getDb()
    .prepare('SELECT id, status, tier_id, batch_id, trip_name, source, amount_paid FROM registrations WHERE email = ? ORDER BY id DESC LIMIT 1')
    .get(email) as Record<string, any> | null;
  return new Response(JSON.stringify(row ?? { found: false }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
};
