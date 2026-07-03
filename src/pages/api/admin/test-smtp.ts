import type { APIRoute } from 'astro';
import {
  sendEmail,
  isEmailConfigured,
  EMAIL_FROM,
  ADMIN_EMAIL,
  RESEND_API_KEY,
} from '../../../lib/emailTransport';

// Admin-gated (see middleware). Email now goes over the Resend HTTPS API
// (Railway blocks all SMTP ports). Without ?to it reports config only;
// ?to=addr sends a real test email through Resend.
export const GET: APIRoute = async ({ url }) => {
  const config = {
    build: 'resend-1',
    provider: 'resend',
    configured: isEmailConfigured(),
    from: EMAIL_FROM,
    replyTo: ADMIN_EMAIL,
    apiKeyPresent: Boolean(RESEND_API_KEY),
  };

  const json = (body: Record<string, any>, status = 200) =>
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  if (!isEmailConfigured()) {
    return json({ ok: false, config, error: 'RESEND_API_KEY not set' }, 503);
  }

  const to = url.searchParams.get('to');
  if (!to) {
    return json({ ok: true, config, note: 'Resend configured. Add ?to=addr to send a test email.' });
  }

  try {
    const result = await sendEmail(
      to,
      'Email test — Seek the Thrill',
      `<p>Resend HTTPS delivery OK at ${new Date().toISOString()}.</p>`,
    );
    return json({ ok: true, config, sent: true, to, result });
  } catch (err: any) {
    return json({ ok: false, config, sent: false, to, error: String(err?.message ?? err) }, 502);
  }
};
