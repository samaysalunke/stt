import type { APIRoute } from 'astro';
import { getDb } from '../../../../lib/db';
import { readTrip, resolveBooking } from '../../../../lib/content';
import { requireRole } from '../../../../lib/requireRole';
import { logAction } from '../../../../lib/audit';
import { sendWishlistOpened } from '../../../../lib/emailTemplates';
import { formatDateIN } from '../../../../lib/utils';

export const prerender = false;

/**
 * Email every wishlister for a now-bookable departure that a departure has opened.
 * Idempotent: only rows with wishlist_notified_at IS NULL are contacted, and each
 * is stamped on success. owner/ops only.
 */
export const POST: APIRoute = async ({ request, locals, clientAddress }) => {
  const denied = requireRole(locals, ['owner', 'ops']);
  if (denied) return denied;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ success: false, error: 'Invalid body.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const tripSlug = String(body.tripSlug ?? '').trim();
  const batchId = String(body.batchId ?? '').trim();
  const trip = tripSlug ? readTrip(tripSlug) : null;
  if (!trip || !batchId) {
    return new Response(JSON.stringify({ success: false, error: 'Trip or departure not found.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  const departure = resolveBooking(trip).departures.find((d) => d.id === batchId);
  if (!departure) {
    return new Response(JSON.stringify({ success: false, error: 'Departure not found.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
  if (departure.comingSoon) {
    return new Response(JSON.stringify({ success: false, error: 'This departure is still coming-soon — open it for booking first.' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
  }

  const db = getDb();
  const rows = db.prepare(`
    SELECT id, full_name, email FROM registrations
    WHERE trip_slug = ? AND batch_id = ? AND status = 'wishlist' AND wishlist_notified_at IS NULL
  `).all(tripSlug, batchId) as Array<{ id: number; full_name: string; email: string }>;

  const tripName = String(trip.title || trip.name || tripSlug);
  const startDate = formatDateIN(departure.startDate);
  const endDate = formatDateIN(departure.endDate);
  const stamp = db.prepare('UPDATE registrations SET wishlist_notified_at = CURRENT_TIMESTAMP WHERE id = ?');

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await sendWishlistOpened({
        firstName: (row.full_name || '').split(' ')[0],
        email: row.email,
        tripName,
        tripSlug,
        batchId,
        startDate,
        endDate,
      });
      stamp.run(row.id);
      sent++;
    } catch (err) {
      console.error('[wishlist/notify] send failed for', row.email, err);
      failed++;
    }
  }

  logAction({
    actorUserId: locals.adminUser?.userId ?? null,
    actorEmail: locals.adminUser?.email ?? null,
    actorRole: locals.adminUser?.role ?? null,
    action: 'wishlist.notified',
    targetType: 'departure',
    targetId: batchId,
    newValue: { tripSlug, sent, failed },
    ipAddress: clientAddress,
  });

  return new Response(JSON.stringify({ success: true, sent, failed }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
