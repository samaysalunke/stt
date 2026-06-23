import type { APIRoute } from 'astro';
import { getDb } from '../../../../lib/db';
import { logAction } from '../../../../lib/audit';
import { sanitizeInput } from '../../../../lib/utils';
import { jsonOk as json } from '../../../../lib/apiResponse';

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    if (!locals.adminUser || locals.adminUser.role === 'trip_lead') {
      return json({ success: false, error: 'Access denied' }, 403);
    }

    const body = await request.json();
    const email = sanitizeInput(body.email);
    const fullName = sanitizeInput(body.full_name);
    const phone = sanitizeInput(body.phone);
    const city = sanitizeInput(body.city);

    if (!email || !fullName || !phone) {
      return json({ success: false, error: 'Name and phone are required.' }, 400);
    }

    const db = getDb();

    // Snapshot the current identity (from the most recent registration) for the audit log.
    const previous = db.prepare(
      `SELECT full_name, phone, city FROM registrations
       WHERE lower(trim(email)) = lower(trim(?)) ORDER BY created_at DESC LIMIT 1`
    ).get(email) as Record<string, any> | undefined;

    if (!previous) {
      return json({ success: false, error: 'Customer not found.' }, 404);
    }

    // Apply across every registration for this email so the customer's info stays consistent.
    const result = db.prepare(
      `UPDATE registrations SET full_name = ?, phone = ?, city = ?, updated_at = CURRENT_TIMESTAMP
       WHERE lower(trim(email)) = lower(trim(?))`
    ).run(fullName, phone, city || null, email);

    logAction({
      actorUserId: locals.adminUser.userId,
      actorEmail: locals.adminUser.email,
      actorRole: locals.adminUser.role,
      action: 'customer.update',
      targetType: 'customer',
      targetId: email,
      previousValue: { full_name: previous.full_name, phone: previous.phone, city: previous.city },
      newValue: { full_name: fullName, phone, city: city || null },
    });

    return json({ success: true, updated: result.changes });
  } catch (err) {
    console.error('[customers/update]', err);
    return json({ success: false, error: 'Server error.' }, 500);
  }
};
