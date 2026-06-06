import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { getDb } from '../../../lib/db';
import { sendBroadcastToSubscriber } from '../../../lib/email';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const subject  = typeof body.subject   === 'string' ? body.subject.trim()   : '';
    const bodyHtml = typeof body.body_html === 'string' ? body.body_html        : '';
    const postUrl  = typeof body.post_url  === 'string' ? body.post_url.trim()  : '';

    if (!subject || !bodyHtml) {
      return new Response(JSON.stringify({ success: false, error: 'Subject and body are required.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const db = getDb();
    const subscribers = db
      .prepare("SELECT email, name, unsubscribe_token FROM newsletter_subscribers WHERE status = 'active'")
      .all() as Array<{ email: string; name: string | null; unsubscribe_token: string | null }>;

    const BATCH_SIZE = 50;
    let sent = 0;
    let failed = 0;

    for (let i = 0; i < subscribers.length; i += BATCH_SIZE) {
      const chunk = subscribers.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        chunk.map((sub) => {
          const firstName = sub.name ? sub.name.split(' ')[0] : 'there';
          return sendBroadcastToSubscriber({
            email: sub.email,
            firstName,
            subject,
            bodyHtml,
            postUrl,
            unsubscribeToken: sub.unsubscribe_token ?? '',
          });
        })
      );
      for (const r of results) {
        if (r.status === 'fulfilled') sent++;
        else { failed++; console.error('[Broadcast email failed]', r.reason); }
      }
      if (i + BATCH_SIZE < subscribers.length) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    db.prepare(
      'INSERT INTO broadcast_log (id, subject, recipient_count, status) VALUES (?, ?, ?, ?)'
    ).run(crypto.randomUUID(), subject, sent, sent === 0 && failed > 0 ? 'failed' : 'sent');

    return new Response(JSON.stringify({ success: true, sent, failed }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[send-broadcast]', err);
    return new Response(JSON.stringify({ success: false, error: 'Server error.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
