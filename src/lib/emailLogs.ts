import crypto from 'node:crypto';
import { getDb } from './db';

export type EmailLogStatus = 'triggered' | 'sent' | 'failed' | 'skipped';

export interface EmailLogMeta {
  template?: string;
}

export function safeEmailErrorSummary(error: unknown): string {
  return String((error as any)?.message ?? error ?? 'Unknown email error')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/re_[A-Za-z0-9_-]+/g, 're_[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

export function startEmailLog(to: string, subject: string, template = 'unspecified'): string | null {
  try {
    const id = crypto.randomUUID();
    getDb().prepare(`
      INSERT INTO email_delivery_log (id, template, recipient, subject, status)
      VALUES (?, ?, ?, ?, 'triggered')
    `).run(id, template.slice(0, 100), to.slice(0, 320), subject.slice(0, 500));
    return id;
  } catch (error) {
    console.error('[Email log start]', error);
    return null;
  }
}

export function finishEmailLog(
  id: string | null,
  status: Exclude<EmailLogStatus, 'triggered'>,
  details: { providerId?: string | null; error?: unknown } = {},
): void {
  if (!id) return;
  try {
    getDb().prepare(`
      UPDATE email_delivery_log
      SET status = ?, provider_id = ?, error_summary = ?, completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      status,
      details.providerId ? String(details.providerId).slice(0, 200) : null,
      details.error == null ? null : safeEmailErrorSummary(details.error),
      id,
    );
  } catch (error) {
    console.error('[Email log finish]', error);
  }
}
