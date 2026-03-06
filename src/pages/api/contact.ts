import type { APIRoute } from 'astro';
import { getDb } from '../../lib/db';
import { sendContactConfirmation, sendAdminContactNotification } from '../../lib/email';
import { sanitizeInput, isValidEmail } from '../../lib/utils';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();

    // Honeypot check
    if (body._honey) {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const fullName = sanitizeInput(body.fullName);
    const email = sanitizeInput(body.email);
    const subject = sanitizeInput(body.subject);
    const message = sanitizeInput(body.message);
    const phone = sanitizeInput(body.phone);
    const source = sanitizeInput(body.source);

    if (!fullName || !email || !subject || !message) {
      return new Response(JSON.stringify({ success: false, error: 'Please fill in all required fields.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!isValidEmail(email)) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid email address.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const db = getDb();
    db.prepare(`
      INSERT INTO contact_submissions (full_name, email, phone, subject, message, source)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(fullName, email, phone, subject, message, source);

    sendContactConfirmation(fullName, email, message).catch(console.error);
    sendAdminContactNotification({ full_name: fullName, email, phone, subject, message, source }).catch(console.error);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[Contact API Error]', err);
    return new Response(JSON.stringify({ success: false, error: 'Server error. Please try again.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
