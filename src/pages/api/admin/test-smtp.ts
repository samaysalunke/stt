import type { APIRoute } from 'astro';
import {
  getTransporter,
  isEmailConfigured,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  ADMIN_EMAIL,
} from '../../../lib/emailTransport';

// Admin-gated (see middleware). Verifies SMTP connect + auth without sending.
// Optional ?to=addr sends a real test email.
export const GET: APIRoute = async ({ url }) => {
  const config = {
    configured: isEmailConfigured(),
    host: SMTP_HOST ?? null,
    port: SMTP_PORT,
    user: SMTP_USER ?? null,
    replyTo: ADMIN_EMAIL,
    secure: SMTP_PORT === 465,
  };

  const json = (body: Record<string, any>, status = 200) =>
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  if (!config.configured) {
    return json({ ok: false, config, error: 'SMTP env vars missing (SMTP_HOST/SMTP_USER/SMTP_PASS)' }, 503);
  }

  const transporter = getTransporter();
  if (!transporter) {
    return json({ ok: false, config, error: 'Transporter unavailable' }, 503);
  }

  try {
    await transporter.verify();
  } catch (err: any) {
    return json({ ok: false, config, verify: false, error: String(err?.message ?? err) }, 502);
  }

  const to = url.searchParams.get('to');
  if (!to) {
    return json({ ok: true, config, verify: true, note: 'Connection + auth OK. Add ?to=addr to send a test email.' });
  }

  try {
    const info = await transporter.sendMail({
      from: `"Seek the Thrill" <${SMTP_USER}>`,
      replyTo: ADMIN_EMAIL,
      to,
      subject: 'SMTP test — Seek the Thrill',
      text: `SMTP test OK at ${new Date().toISOString()}`,
    });
    return json({ ok: true, config, verify: true, sent: true, to, messageId: info.messageId });
  } catch (err: any) {
    return json({ ok: false, config, verify: true, sent: false, to, error: String(err?.message ?? err) }, 502);
  }
};
