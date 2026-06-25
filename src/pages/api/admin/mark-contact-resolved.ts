export const prerender = false;
import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';
import { requireRole } from '../../../lib/requireRole';

export const POST: APIRoute = async ({ request, locals }) => {
  const denied = requireRole(locals, ['owner', 'ops']);
  if (denied) return denied;
  try {
    const { id, status } = await request.json();
    if (!id || !['new', 'resolved'].includes(status)) {
      return new Response(JSON.stringify({ error: 'Invalid parameters' }), { status: 400 });
    }

    getDb()
      .prepare('UPDATE contact_submissions SET status = ? WHERE id = ?')
      .run(status, id);

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to update contact' }), { status: 500 });
  }
};
