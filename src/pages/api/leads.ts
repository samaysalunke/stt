import type { APIRoute } from 'astro';
import { getDb } from '../../lib/db';
import { sanitizeInput, isValidEmail, isValidPhone } from '../../lib/utils';
import { rateLimit } from '../../lib/rateLimit';
import { sendEmail, wrapEmail, escapeHtml, ADMIN_EMAIL } from '../../lib/emailTransport';

// Server-rendered endpoint (writes to sqlite) — never prerender.
export const prerender = false;

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!rateLimit(`leads:${clientAddress}`, 5, 60 * 60 * 1000)) {
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

    const badRequest = (error: string) =>
      new Response(JSON.stringify({ success: false, error }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });

    // Optional fields — stored as-is (sanitized) or null when blank.
    const phone       = sanitizeInput(body.phone) || null;
    const destination = sanitizeInput(body.destination) || null;
    const travellers  = sanitizeInput(body.travellers) || null;
    const dates       = sanitizeInput(body.dates) || null;
    const budget      = sanitizeInput(body.budget) || null;
    const message     = sanitizeInput(body.message) || null;

    // Validate optional fields only when provided (mirrors the client).
    if (phone && !isValidPhone(phone)) return badRequest('Please enter a valid phone number.');
    if (travellers && !/^\d{1,3}$/.test(travellers)) return badRequest('Number of travellers must be a number.');
    if (travellers && (Number(travellers) < 1 || Number(travellers) > 100)) {
      return badRequest('Number of travellers must be between 1 and 100.');
    }

    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO custom_itinerary_leads (
        name, email, phone, destination, travellers, dates, budget, message, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new')
    `);
    stmt.run(name, email, phone, destination, travellers, dates, budget, message);

    // Notify the team. Best-effort: the lead is already persisted, so an email
    // failure must not fail the request.
    try {
      const row = (k: string, v: string | null) =>
        v ? `<tr><td style="padding:4px 12px 4px 0;color:#6B7280;">${k}</td><td style="padding:4px 0;">${escapeHtml(v)}</td></tr>` : '';
      const html = wrapEmail(`
        <h2 style="margin:0 0 16px;font-size:18px;color:#1F2A44;">New custom-itinerary enquiry</h2>
        <table style="font-size:14px;border-collapse:collapse;">
          ${row('Name', name)}
          ${row('Email', email)}
          ${row('Phone', phone)}
          ${row('Destination', destination)}
          ${row('Travellers', travellers)}
          ${row('Dates', dates)}
          ${row('Budget', budget)}
          ${row('Message', message)}
        </table>`);
      await sendEmail(ADMIN_EMAIL, `New custom-itinerary enquiry — ${name}`, html, { template: 'custom-itinerary-admin' });
    } catch (mailErr) {
      console.error('[Leads API] team notification email failed (lead was saved):', mailErr);
    }

    // Acknowledge the submitter. Best-effort — never fails the request.
    try {
      const ack = wrapEmail(`
        <h2 style="margin:0 0 16px;font-size:18px;color:#1F2A44;">Thanks, ${escapeHtml(name)} — we’ve got your enquiry</h2>
        <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#1F2A44;">
          We’ll be in touch soon to set up your 45-minute consultation call. Nothing has been charged — this is just
          the start of the conversation.
        </p>
        <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#1F2A44;">
          If you’d like to add anything in the meantime, reply straight to this email.
        </p>
        <p style="margin:0;font-size:14px;line-height:1.6;color:#1F2A44;">— Team Seek the Thrill</p>`);
      await sendEmail(email, 'We’ve got your custom-trip enquiry — Seek the Thrill', ack, {
        template: 'custom-itinerary-acknowledgement',
      });
    } catch (mailErr) {
      console.error('[Leads API] submitter acknowledgement email failed (lead was saved):', mailErr);
    }

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
