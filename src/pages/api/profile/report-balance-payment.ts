import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';
import { jsonOk as json } from '../../../lib/apiResponse';
import { rateLimit } from '../../../lib/rateLimit';
import { loadPayableBalance } from '../../../lib/balancePayment';
import { resolveLocalPaymentUpload } from '../../../lib/telegram';

/**
 * Record a traveller's claim that they have paid their balance.
 *
 * A claim, not a payment: this writes balance_reported_at and
 * balance_payment_screenshot_url and nothing else. amount_paid, payment_status,
 * status and payment_events are the ledger's, and admin records the money
 * there once it has actually been checked.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ success: false, error: 'Not authenticated.' }, 401);
  if (!rateLimit(`balance-report:${user.id}`, 10, 60 * 60 * 1000)) {
    return json({ success: false, error: 'Too many attempts. Please try again later.' }, 429);
  }

  let body: any;
  try { body = await request.json(); } catch { return json({ success: false, error: 'Invalid JSON.' }, 400); }

  const id = Number(body?.registrationId);
  const rawUrl = body?.screenshotUrl;
  let screenshotUrl: string | null = null;
  if (rawUrl !== undefined && rawUrl !== null && rawUrl !== '') {
    // Only a file our own upload endpoint wrote — the same shape the Telegram
    // path accepts, and the file must actually exist.
    if (typeof rawUrl !== 'string' || !resolveLocalPaymentUpload(rawUrl).ok) {
      return json({ success: false, error: 'That screenshot could not be found. Please upload it again.' }, 400);
    }
    screenshotUrl = rawUrl;
  }

  const db = getDb();
  // Re-checked here, never trusted from the page: yours, confirmed, money owing.
  const payable = loadPayableBalance(db, id, user.email);
  if (!payable) return json({ success: false, error: 'Not found.' }, 404);

  // COALESCE keeps the first claim date on a resubmission — how long someone
  // has been waiting is what admin needs to see. A new screenshot replaces the
  // old one; a resubmission without one keeps it.
  db.prepare(`
    UPDATE registrations
       SET balance_reported_at = COALESCE(balance_reported_at, CURRENT_TIMESTAMP),
           balance_payment_screenshot_url = COALESCE(?, balance_payment_screenshot_url)
     WHERE id = ?
  `).run(screenshotUrl, payable.id);

  return json({ success: true });
};
