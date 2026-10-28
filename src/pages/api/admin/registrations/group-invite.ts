import type { APIRoute } from 'astro';
import { getDb } from '../../../../lib/db';
import { readTrip } from '../../../../lib/content';
import { departureGroupLink } from '../../../../lib/trips';
import { requireRole } from '../../../../lib/requireRole';
import { logAction } from '../../../../lib/audit';
import { sendTripGroupInvite } from '../../../../lib/emailTemplates';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * Email a departure's WhatsApp group invite link to every confirmed traveller
 * who hasn't been sent it. Idempotent: only rows with whatsapp_group_sent_at
 * IS NULL are contacted, and each is stamped on success. owner/ops only.
 */
export const POST: APIRoute = async ({ request, locals, clientAddress }) => {
  const denied = requireRole(locals, ['owner', 'ops']);
  if (denied) return denied;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: 'Invalid body.' }, 400);
  }

  const tripSlug = String(body.tripSlug ?? '').trim();
  const batchId = String(body.batchId ?? '').trim();
  const trip = tripSlug ? readTrip(tripSlug) : null;
  if (!trip || !batchId) return json({ success: false, error: 'Trip or departure not found.' }, 404);

  const groupLink = departureGroupLink({ trip_slug: tripSlug, batch_id: batchId });
  if (!groupLink) return json({ success: false, error: 'Add a WhatsApp group link to this departure first.' }, 409);

  const db = getDb();
  const rows = db.prepare(`
    SELECT id, full_name, email, trip_date FROM registrations
    WHERE trip_slug = ? AND batch_id = ? AND status = 'confirmed' AND whatsapp_group_sent_at IS NULL
  `).all(tripSlug, batchId) as Array<{ id: number; full_name: string; email: string; trip_date: string | null }>;

  const tripName = String(trip.title || trip.name || tripSlug);
  const stamp = db.prepare('UPDATE registrations SET whatsapp_group_sent_at = CURRENT_TIMESTAMP WHERE id = ?');

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await sendTripGroupInvite({
        full_name: row.full_name,
        email: row.email,
        trip_name: tripName,
        trip_date: row.trip_date ?? '',
        groupLink,
      });
      stamp.run(row.id);
      sent++;
    } catch (err) {
      console.error('[group-invite] send failed for', row.email, err);
      failed++;
    }
  }

  logAction({
    actorUserId: locals.adminUser?.userId ?? null,
    actorEmail: locals.adminUser?.email ?? null,
    actorRole: locals.adminUser?.role ?? null,
    action: 'departure.group_invite_sent',
    targetType: 'departure',
    targetId: batchId,
    newValue: { tripSlug, sent, failed },
    ipAddress: clientAddress,
  });

  return json({ success: true, sent, failed });
};
