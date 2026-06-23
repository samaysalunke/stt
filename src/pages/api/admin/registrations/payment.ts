import type { APIRoute } from 'astro';
import { getDb } from '../../../../lib/db';
import { logAction } from '../../../../lib/audit';
import { tripAdvanceAmountBySlug } from '../../../../lib/registrationWrite';
import { paymentState } from '../../../../lib/payment';
import { jsonOk as json } from '../../../../lib/apiResponse';

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    if (!locals.adminUser || locals.adminUser.role === 'trip_lead') {
      return json({ success: false, error: 'Access denied' }, 403);
    }

    const body = await request.json();
    const action = String(body.action || '');
    const ids = Array.isArray(body.ids)
      ? [...new Set(body.ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0))]
      : [];

    if (!ids.length || !['unpaid', 'advance', 'full'].includes(action)) {
      return json({ success: false, error: 'Invalid payment action or registration IDs.' }, 400);
    }
    if (ids.length > 500) {
      return json({ success: false, error: 'Too many registrations (max 500).' }, 400);
    }

    const db = getDb();
    const results: Record<string, any>[] = [];

    for (const id of ids) {
      const reg = db.prepare(
        'SELECT id, trip_slug, amount_paid, total_amount, payment_date FROM registrations WHERE id = ?'
      ).get(id) as any;

      if (!reg) {
        results.push({ id, success: false, error: 'Registration not found' });
        continue;
      }

      const total = Number(reg.total_amount);
      const previousAmount = Number(reg.amount_paid) || 0;

      if (action !== 'unpaid' && (!Number.isFinite(total) || total <= 0)) {
        results.push({ id, success: false, error: 'Valid total amount is required' });
        continue;
      }

      const advance = tripAdvanceAmountBySlug(String(reg.trip_slug || ''));
      const amount = action === 'unpaid' ? 0 : action === 'full' ? total : Math.min(advance, total);
      const paymentDate = action === 'unpaid' ? null : new Date().toISOString();

      db.prepare(
        'UPDATE registrations SET amount_paid = ?, payment_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(amount, paymentDate, id);

      const previousState = paymentState(previousAmount, total, advance);
      const newState = paymentState(amount, total, advance);

      logAction({
        actorUserId: locals.adminUser.userId,
        actorEmail: locals.adminUser.email,
        actorRole: locals.adminUser.role,
        action: 'booking.payment_updated',
        targetType: 'registration',
        targetId: String(id),
        previousValue: { amount: previousAmount, state: previousState, paymentDate: reg.payment_date },
        newValue: { amount, state: newState, paymentDate },
      });

      results.push({ id, success: true, amountPaid: amount, paymentDate, state: newState });
    }

    return json({
      success: true,
      results,
      succeeded: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
    });
  } catch (err) {
    console.error('[registrations/payment]', err);
    return json({ success: false, error: 'Server error.' }, 500);
  }
};
