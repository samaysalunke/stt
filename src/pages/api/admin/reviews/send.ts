import type { APIRoute } from 'astro';
import { requireRole } from '../../../../lib/requireRole';
import { pendingForDeparture, sendReviewRequest } from '../../../../lib/tripReviews';
import { logAction } from '../../../../lib/audit';

export const prerender = false;

/**
 * POST /api/admin/reviews/send — email the review link now to one departure's
 * confirmed travellers who have not had it. For departures outside the
 * automatic window (e.g. ones that ended before reviews existed). Owner/ops.
 * Each traveller is claimed before sending, so a double press can't send twice.
 */
export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const denied = requireRole(locals, ['owner', 'ops']);
  if (denied) return denied;
  const form = await request.formData().catch(() => null);
  const slug = String(form?.get('trip') ?? '');
  const batchId = String(form?.get('batch') ?? '');
  const back = (sent: number) => redirect(`/admin/reviews?trip=${encodeURIComponent(slug)}&batch=${encodeURIComponent(batchId)}&sent=${sent}`, 303);
  if (!slug || !batchId) return redirect('/admin/reviews', 303);

  let sent = 0;
  for (const row of pendingForDeparture(slug, batchId)) if (await sendReviewRequest(row)) sent++;
  logAction({
    actorUserId: locals.adminUser?.userId,
    actorEmail: locals.adminUser?.email,
    actorRole: locals.adminUser?.role,
    action: 'trip_reviews.request_sent',
    targetType: 'departure',
    targetId: `${slug}:${batchId}`,
    newValue: { sent },
  });
  return back(sent);
};
