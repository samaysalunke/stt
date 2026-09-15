import { randomUUID } from 'node:crypto';
import type { APIRoute } from 'astro';
import { jsonOk as json } from '../../../../lib/apiResponse';
import { sanitizePaymentMethod, validReceivedAt } from '../../../../lib/paymentLedger';
import { requireRole } from '../../../../lib/requireRole';
import { applyPaymentChange, PAYMENT_ACTIONS } from '../../../../lib/registrationPaymentChange';

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    // Same policy as before (owner + ops), expressed through the shared guard
    // so this endpoint reads like every other mutating admin route.
    const denied = requireRole(locals, ['owner', 'ops']);
    if (denied) return denied;
    // requireRole guarantees a session; the assertion only narrows for TypeScript.
    const admin = locals.adminUser!;
    const body = await request.json();
    const action = String(body.action || 'record');
    const ids: number[] = Array.isArray(body.ids)
      ? [...new Set(body.ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0))]
          .map(Number)
      : [];
    if (!ids.length || !(PAYMENT_ACTIONS as readonly string[]).includes(action)) return json({ success: false, error: 'Invalid payment action or registration IDs.' }, 400);
    if (ids.length > 500) return json({ success: false, error: 'Too many registrations (max 500).' }, 400);

    const receivedAt = String(body.receivedAt || body.received_at || new Date().toISOString());
    const method = sanitizePaymentMethod(body.method || body.paymentMethod || (action === 'unpaid' ? 'other' : 'bank_transfer'));
    if (!validReceivedAt(receivedAt)) return json({ success: false, error: 'Received date is invalid or in the future.' }, 400);
    if (action !== 'unpaid' && !method) return json({ success: false, error: 'Choose a valid payment method.' }, 400);
    const refundKind = action === 'refund' ? String(body.refundKind || '') : '';
    if (action === 'refund' && refundKind !== 'partial' && refundKind !== 'full') return json({ success: false, error: 'Refund kind must be "partial" or "full".' }, 400);
    const requestedAmount = body.amount === undefined || body.amount === null || body.amount === '' ? null : Number(body.amount);
    if (requestedAmount !== null && (!Number.isInteger(requestedAmount) || requestedAmount <= 0)) return json({ success: false, error: 'Amount must be a positive whole rupee value.' }, 400);

    const requestId = String(body.requestId || randomUUID());
    const actor = { userId: admin.userId, email: admin.email, role: admin.role };
    const results: Record<string, any>[] = [];
    for (const id of ids) {
      try {
        results.push(await applyPaymentChange({
          id, action, requestedAmount, receivedAt, method, refundKind, requestId,
          transactionReference: body.transactionReference,
          transactionReferenceAlt: body.transaction_reference,
          bulk: ids.length > 1,
        }, actor));
      } catch (error: any) {
        results.push({ id, success: false, error: String(error?.message || error) });
      }
    }
    return json({ success: true, results, succeeded: results.filter((r) => r.success).length, failed: results.filter((r) => !r.success).length });
  } catch (err) {
    console.error('[registrations/payment]', err);
    return json({ success: false, error: 'Server error.' }, 500);
  }
};
