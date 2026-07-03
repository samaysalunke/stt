import nodemailer from 'nodemailer';
import dns from 'node:dns';

// Railway containers have no IPv6 route. Prefer IPv4 for every outbound
// DNS resolution so smtp.gmail.com (which has AAAA records) doesn't fail
// with connect ENETUNREACH on an IPv6 address.
dns.setDefaultResultOrder('ipv4first');

export const SMTP_HOST = import.meta.env.SMTP_HOST || process.env.SMTP_HOST;
export const SMTP_PORT = parseInt(import.meta.env.SMTP_PORT || process.env.SMTP_PORT || '587');
export const SMTP_USER = import.meta.env.SMTP_USER || process.env.SMTP_USER;
export const SMTP_PASS = import.meta.env.SMTP_PASS || process.env.SMTP_PASS;
export const ADMIN_EMAIL = import.meta.env.ADMIN_EMAIL || process.env.ADMIN_EMAIL || 'zahra@seekthethrill.in';

let _transporter: nodemailer.Transporter | null = null;

export function isEmailConfigured(): boolean {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

export function getTransporter() {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.warn('[Email] SMTP not configured — emails will be logged to console only.');
    return null;
  }
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      // Force IPv4: Railway containers have no IPv6 route, so an AAAA
      // record (e.g. smtp.gmail.com) fails with connect ENETUNREACH.
      family: 4,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
    });
  }
  return _transporter;
}

export function escapeHtml(str: any): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function htmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>.*?<\/style>/gis, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function wrapEmail(body: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #FDF0EC;">
  <div style="background: #E8725A; padding: 30px; border-radius: 8px 8px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 22px; font-weight: 700;">Seek the Thrill</h1>
  </div>
  <div style="background: white; padding: 32px; border-radius: 0 0 8px 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.08);">
    ${body}
    <hr style="border: none; border-top: 1px solid #F5DDD7; margin: 24px 0 0;" />
    <p style="margin: 16px 0 0; font-size: 12px; color: #9CA3AF;">Team Seek the Thrill · seekthethrill.in</p>
  </div>
</body>
</html>`;
}

export async function sendEmail(to: string, subject: string, html: string) {
  const transporter = getTransporter();
  if (!transporter) {
    console.log(`[Email Mock] To: ${to}\nSubject: ${subject}\n`);
    return;
  }
  await transporter.sendMail({
    from: `"Seek the Thrill" <${SMTP_USER}>`,
    replyTo: ADMIN_EMAIL,
    to,
    subject,
    html,
    text: htmlToText(html),
  });
}
