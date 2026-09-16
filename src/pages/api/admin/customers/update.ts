import type { APIRoute } from 'astro';
import { getDb } from '../../../../lib/db';
import { logAction } from '../../../../lib/audit';
import { sanitizeInput } from '../../../../lib/utils';
import { normalizeIndiaState } from '../../../../lib/indiaStates';
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
    // One spelling per state, as everywhere else it is written. An unrecognised
    // value is refused rather than stored as noise — the invoice address and
    // the leaderboard both read this column.
    const stateSent = body.state !== undefined && body.state !== null;
    const rawState = stateSent ? sanitizeInput(body.state) : '';
    const state = rawState ? normalizeIndiaState(rawState) : null;

    if (!email || !fullName || !phone) {
      return json({ success: false, error: 'Name and phone are required.' }, 400);
    }
    if (rawState && !state) {
      return json({ success: false, error: `Unrecognised state: ${rawState}` }, 400);
    }

    const db = getDb();

    // Snapshot the current identity (from the most recent registration) for the audit log.
    const previous = db.prepare(
      `SELECT full_name, phone, city, state FROM registrations
       WHERE lower(trim(email)) = lower(trim(?)) ORDER BY created_at DESC LIMIT 1`
    ).get(email) as Record<string, any> | undefined;

    if (!previous) {
      return json({ success: false, error: 'Customer not found.' }, 404);
    }

    // Apply across every registration for this email so the customer's info stays consistent.
    // Absent means "leave it"; sent-but-blank is an explicit clear.
    const result = stateSent
      ? db.prepare(
          `UPDATE registrations SET full_name = ?, phone = ?, city = ?, state = ?, updated_at = CURRENT_TIMESTAMP
           WHERE lower(trim(email)) = lower(trim(?))`
        ).run(fullName, phone, city || null, state, email)
      : db.prepare(
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
      previousValue: { full_name: previous.full_name, phone: previous.phone, city: previous.city, state: previous.state },
      newValue: { full_name: fullName, phone, city: city || null, ...(stateSent ? { state } : {}) },
    });

    return json({ success: true, updated: result.changes });
  } catch (err) {
    console.error('[customers/update]', err);
    return json({ success: false, error: 'Server error.' }, 500);
  }
};
