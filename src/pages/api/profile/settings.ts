import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';
import { setUsername } from '../../../lib/usernames';

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

  const db = getDb();

  if (body.action === 'setUsername') {
    const result = setUsername(user.id, (body.username ?? '').toString().trim().toLowerCase());
    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (body.action === 'setLeaderboard') {
    const val = body.value ? 0 : 1; // value=true means OPT-IN (optOut=0)
    db.prepare('UPDATE users SET leaderboardOptOut = ? WHERE id = ?').run(val, user.id);
    if (val === 1) {
      // opted out — remove from leaderboard cache
      db.prepare('DELETE FROM leaderboard_cache WHERE userId = ?').run(user.id);
    }
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (body.action === 'setShowTrips') {
    const val = body.value ? 1 : 0;
    db.prepare('UPDATE users SET showTripsPublicly = ? WHERE id = ?').run(val, user.id);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ success: false, error: 'Unknown action.' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
};
