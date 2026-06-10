import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) {
    return new Response(JSON.stringify({ success: false, error: 'Not authenticated.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ success: false, error: 'Invalid JSON.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const regId = parseInt(body.registrationId);
  const action = body.action as string;

  if (!regId || !['share', 'dismiss'].includes(action)) {
    return new Response(JSON.stringify({ success: false, error: 'Invalid input.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const db = getDb();

  // Only allow updating registrations that belong to this user (by email)
  const reg = db
    .prepare('SELECT id, email FROM registrations WHERE id = ? AND status = ?')
    .get(regId, 'confirmed') as { id: number; email: string } | undefined;

  if (!reg || reg.email.toLowerCase() !== user.email.toLowerCase()) {
    return new Response(JSON.stringify({ success: false, error: 'Not found.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const sharedAt = action === 'share'
    ? new Date().toISOString()
    : 'dismissed';

  db.prepare('UPDATE registrations SET sharedAt = ? WHERE id = ?').run(sharedAt, regId);

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
