import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { getDb } from '../../lib/db';
import { isValidEmail } from '../../lib/utils';
import { rateLimit } from '../../lib/rateLimit';
import { sendNewsletterWelcome } from '../../lib/email';

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!rateLimit(clientAddress, 5, 60 * 60 * 1000)) {
    return new Response(JSON.stringify({ success: false, error: 'Too many requests. Please try again later.' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '3600' },
    });
  }

  try {
    const body = await request.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const name  = typeof body.name === 'string'  ? body.name.trim() : null;
    const source = typeof body.source === 'string' ? body.source.trim() : null;

    if (!email || !isValidEmail(email)) {
      return new Response(JSON.stringify({ success: false, error: 'Please enter a valid email address.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const db = getDb();

    // Silently succeed for existing subscribers
    const existing = db.prepare('SELECT id FROM newsletter_subscribers WHERE email = ?').get(email);
    if (existing) {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const token = crypto.randomUUID();
    db.prepare(`
      INSERT INTO newsletter_subscribers (email, name, status, source, unsubscribe_token, active)
      VALUES (?, ?, 'active', ?, ?, 1)
    `).run(email, name, source, token);

    sendNewsletterWelcome(email, token).catch(err => console.error('[Newsletter welcome email]', err));

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
