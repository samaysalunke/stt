// Transactional email over the Resend HTTPS API (port 443). Railway blocks
// all outbound SMTP ports (25/465/587/2525 time out; only 443 is open), so
// nodemailer/SMTP can never work here — see /api/admin/test-smtp?probe=1.
//
// Env:
//   RESEND_API_KEY  — required to actually send (else emails are mock-logged).
//   EMAIL_FROM      — sender, e.g. "Seek the Thrill <notifications@seekthethrill.in>".
//                     Must be a Resend-verified domain. Until seekthethrill.in
//                     is verified, Resend's sandbox "onboarding@resend.dev" only
//                     delivers to the account owner's address.
//   ADMIN_EMAIL     — Reply-To + destination for internal notifications.

import { finishEmailLog, startEmailLog, type EmailLogMeta } from './emailLogs';

const env = (k: string) => (import.meta.env as any)[k] || process.env[k];

export const RESEND_API_KEY = env('RESEND_API_KEY');
export const EMAIL_FROM = env('EMAIL_FROM') || 'Seek the Thrill <onboarding@resend.dev>';
export const ADMIN_EMAIL = env('ADMIN_EMAIL') || 'zahra@seekthethrill.in';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export function isEmailConfigured(): boolean {
  return Boolean(RESEND_API_KEY);
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

export interface EmailAttachment {
  filename: string;
  content: string; // Base64, as required by Resend's API.
  contentType?: string;
}

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  meta: EmailLogMeta = {},
  attachments: EmailAttachment[] = [],
) {
  const logId = startEmailLog(to, subject, meta.template);
  if (!RESEND_API_KEY) {
    console.log(`[Email Mock] To: ${to}\nSubject: ${subject}\n`);
    const error = new Error('Email delivery skipped: RESEND_API_KEY is not configured');
    finishEmailLog(logId, 'skipped', { error });
    throw error;
  }
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [to],
        reply_to: ADMIN_EMAIL,
        subject,
        html,
        text: htmlToText(html),
        ...(attachments.length ? {
          attachments: attachments.map((attachment) => ({
            filename: attachment.filename,
            content: attachment.content,
            ...(attachment.contentType ? { content_type: attachment.contentType } : {}),
          })),
        } : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Resend send failed (${res.status}): ${detail}`);
    }
    const result: any = await res.json().catch(() => ({}));
    finishEmailLog(logId, 'sent', { providerId: result?.id });
    return result;
  } catch (error) {
    finishEmailLog(logId, 'failed', { error });
    throw error;
  }
}
