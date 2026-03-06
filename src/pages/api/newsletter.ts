import type { APIRoute } from 'astro';
import { getDb } from '../../lib/db';
import { isValidEmail } from '../../lib/utils';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

    if (!email || !isValidEmail(email)) {
      return new Response(JSON.stringify({ success: false, error: 'Please enter a valid email address.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const db = getDb();
    try {
      db.prepare(`
        INSERT INTO newsletter_subscribers (email) VALUES (?)
        ON CONFLICT(email) DO UPDATE SET active = 1
      `).run(email);
    } catch {
      // Already subscribed
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[Newsletter API Error]', err);
    return new Response(JSON.stringify({ success: false, error: 'Server error.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
