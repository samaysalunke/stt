import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';

const VALID_STATUSES = ['pending', 'confirmed', 'rejected'];

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const id = parseInt(body.id);
    const status = body.status?.toString();
    const adminNotes = body.admin_notes?.toString() ?? '';

    if (!id || !VALID_STATUSES.includes(status)) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid input.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    getDb()
      .prepare(
        'UPDATE registrations SET status=?, admin_notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
      )
      .run(status, adminNotes, id);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[update-registration]', err);
    return new Response(JSON.stringify({ success: false, error: 'Server error.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
