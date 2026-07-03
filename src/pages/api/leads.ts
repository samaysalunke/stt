import type { APIRoute } from 'astro';
import { getDb } from '../../lib/db';
import { sanitizeInput, isValidEmail } from '../../lib/utils';
import { rateLimit } from '../../lib/rateLimit';

// Server-rendered endpoint (writes to sqlite) — never prerender.
export const prerender = false;

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!rateLimit(clientAddress, 5, 60 * 60 * 1000)) {
    return new Response(JSON.stringify({ success: false, error: 'Too many requests. Please try again later.' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '3600' },
    });
  }

  try {
    const body = await request.json();

    // Honeypot: a real user never fills this hidden field. Silently accept the
    // request (so the bot gets a 200 and moves on) but drop the submission.
    if (sanitizeInput(body._honey)) {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const name = sanitizeInput(body.name);
    const email = sanitizeInput(body.email);

    if (!name) {
      return new Response(JSON.stringify({ success: false, error: 'Please tell us your name.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!email || !isValidEmail(email)) {
      return new Response(JSON.stringify({ success: false, error: 'Please enter a valid email address.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Optional fields — stored as-is (sanitized) or null when blank.
    const phone       = sanitizeInput(body.phone) || null;
    const destination = sanitizeInput(body.destination) || null;
    const travellers  = sanitizeInput(body.travellers) || null;
    const dates       = sanitizeInput(body.dates) || null;
    const budget      = sanitizeInput(body.budget) || null;
    const message     = sanitizeInput(body.message) || null;

    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO custom_itinerary_leads (
        name, email, phone, destination, travellers, dates, budget, message, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new')
    `);
    stmt.run(name, email, phone, destination, travellers, dates, budget, message);

    // TODO(email): fire a new-lead notification to the team here once SMTP is
    // restored (see src/lib/email.ts). Deliberately NOT wired now — outbound
    // email is broken on prod, so we persist the lead and notify manually.

    return new Response(JSON.stringify({ success: true, message: 'Thanks — we’ll be in touch soon.' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[Leads API Error]', err);
    return new Response(JSON.stringify({ success: false, error: 'Server error. Please try again.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
