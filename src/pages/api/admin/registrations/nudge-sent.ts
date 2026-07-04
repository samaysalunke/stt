import type { APIRoute } from 'astro';
import { getDb } from '../../../../lib/db';
import { requireRole } from '../../../../lib/requireRole';
import { jsonOk as json } from '../../../../lib/apiResponse';

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
      SET nudge_sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'lead'
    `).run(id);

    return json({ success: res.changes > 0 });
  } catch (err) {
    console.error('[registrations/nudge-sent]', err);
    return json({ success: false, error: 'Server error.' }, 500);
  }
};
