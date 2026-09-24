import type { APIRoute } from 'astro';
import { getDb } from '../../../../lib/db';
import { requireRole } from '../../../../lib/requireRole';
import { jsonOk as json } from '../../../../lib/apiResponse';

/**
 * Clear a traveller's "I've paid my balance" report.
 *
 * Recording the payment settles it on its own (the balance reaches zero and the
 * flag stops showing), but a mistaken or duplicate claim would otherwise sit at
 * the top of the finance queue forever. Touches only the two claim columns —
 * never the ledger.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const denied = requireRole(locals, ['owner', 'ops']);
  if (denied) return denied;

  try {
    const body = await request.json();
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return json({ success: false, error: 'Invalid registration ID.' }, 400);
    }

    const res = getDb().prepare(`
      UPDATE registrations
         SET balance_reported_at = NULL, balance_payment_screenshot_url = NULL
       WHERE id = ? AND balance_reported_at IS NOT NULL
    `).run(id);

    return json({ success: res.changes > 0 });
  } catch (err) {
    console.error('[registrations/balance-report]', err);
    return json({ success: false, error: 'Server error.' }, 500);
  }
};
