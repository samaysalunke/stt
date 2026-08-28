// Test-only endpoint — returns the most recent registration row for a given email.
// Active only in dev builds OR when ENABLE_TEST_ENDPOINTS=true (test harness).
// Returns PII; never gate on the rate-limit kill switch and never enable in prod.
import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';
import { testEndpointsEnabled } from '../../../lib/testGuard';

export const GET: APIRoute = async ({ url }) => {
  if (!testEndpointsEnabled()) {
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
    .prepare('SELECT id, status, tier_id, batch_id, trip_name, source, amount_paid, payment_status, amount_refunded, total_amount FROM registrations WHERE email = ? ORDER BY id DESC LIMIT 1')
    .get(email) as Record<string, any> | null;
  return new Response(JSON.stringify(row ?? { found: false }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
};
