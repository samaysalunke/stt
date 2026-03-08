export const prerender = false;
import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';

export const POST: APIRoute = async ({ request, cookies }) => {
  // Auth check
  const token = cookies.get('admin_token')?.value;
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

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
