import type { APIRoute } from 'astro';
import { requireRole } from '../../../lib/requireRole';
import { applyStatusChange } from '../../../lib/registrationStatusChange';

const bad = (error: string, status = 400) =>
  new Response(JSON.stringify({ success: false, error }), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request, locals }) => {
  // Confirming/rejecting/cancelling a booking records payment/refund + emails the
  // customer — a payment-data action, owner/ops only (matches create/import).
  const denied = requireRole(locals, ['owner', 'ops']);
  if (denied) return denied;
  try {
    const body = await request.json();
    const result = await applyStatusChange({
      id: body.id,
      status: body.status,
      adminNotes: body.admin_notes,
      requestId: body.requestId,
      paymentStatus: body.payment_status,
      amount: body.amount,
      receivedAt: body.receivedAt,
      method: body.method,
      transactionReference: body.transactionReference,
      refund: body.refund,
    }, {
      userId: locals.adminUser?.userId,
      email: locals.adminUser?.email,
      role: locals.adminUser?.role,
    });

    if (!result.ok) return bad(result.error, result.status);
    return new Response(JSON.stringify(result.noop ? { success: true, noop: true } : { success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[update-registration]', err);
    return bad('Server error.', 500);
  }
};
