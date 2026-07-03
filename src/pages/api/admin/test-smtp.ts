import type { APIRoute } from 'astro';
import net from 'node:net';
import {
  getTransporter,
  isEmailConfigured,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  ADMIN_EMAIL,
} from '../../../lib/emailTransport';

// Raw TCP reachability probe — bypasses TLS/auth to isolate egress blocks.
function probe(host: string, port: number, timeout = 8000): Promise<string> {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = net.connect({ host, port, family: 4 });
    const done = (result: string) => {
      socket.destroy();
      resolve(`${result} (${Date.now() - start}ms)`);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => done('open'));
    socket.once('timeout', () => done('TIMEOUT'));
    socket.once('error', (e: any) => done(`error:${e?.code ?? e?.message}`));
  });
}

// Admin-gated (see middleware). Verifies SMTP connect + auth without sending.
// ?to=addr sends a real test email. ?probe=1 runs raw TCP egress checks.
export const GET: APIRoute = async ({ url }) => {
  const config = {
    build: 'smtp-probe-1',
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

  if (url.searchParams.get('probe')) {
    const host = SMTP_HOST || 'smtp.gmail.com';
    const [p587, p465, p2525, p443] = await Promise.all([
      probe(host, 587),
      probe(host, 465),
      probe(host, 2525),
      probe(host, 443), // control: 443 is never blocked; proves egress works at all
    ]);
    return json({ config, probe: { host, '587': p587, '465': p465, '2525': p2525, '443(control)': p443 } });
  }

  if (!config.configured) {
    return json({ ok: false, config, error: 'SMTP env vars missing (SMTP_HOST/SMTP_USER/SMTP_PASS)' }, 503);
  }

  const transporter = await getTransporter();
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
