import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { getDb } from './db';

export type TelegramEventType = 'lead' | 'pending' | 'confirmed';
export type TelegramDeliveryState = 'queued' | 'dispatching' | 'retry_wait' | 'sent' | 'uncertain' | 'failed';

type RegistrationSnapshot = {
  id: number;
  full_name: string;
  email: string;
  phone: string;
  age: string | null;
  gender: string | null;
  trip_name: string;
  trip_date: string | null;
  payment_screenshot_url: string | null;
  amount_paid: number | null;
};

export type ClaimedTelegramEvent = {
  id: number;
  registration_id: number;
  event_type: TelegramEventType;
  attempts: number;
  event_at: string;
};

const MAX_ATTEMPTS = 3;
const API_ROOT = 'https://api.telegram.org';
const DATA_DIR = () => process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const token = () => String((import.meta.env as any).TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '').trim();
const chatId = () => String((import.meta.env as any).TELEGRAM_ADMIN_CHAT_ID || process.env.TELEGRAM_ADMIN_CHAT_ID || '').trim();

export function telegramConfigured(): boolean {
  return Boolean(token() && chatId());
}

export function formatIndiaTimestamp(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(`${value}${/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? '' : 'Z'}`);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const formatted = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(date);
  return `${formatted} IST`;
}

const clean = (value: unknown) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
const field = (value: unknown, max: number) => clean(value).slice(0, max);

export function formatTelegramMessage(
  eventType: TelegramEventType,
  registration: RegistrationSnapshot,
  imageUnavailable = false,
): string {
  const heading: Record<TelegramEventType, string> = {
    lead: 'NEW BOOKING LEAD',
    pending: 'BOOKING PAYMENT PENDING',
    confirmed: 'BOOKING CONFIRMED',
  };
  const lines = [
    heading[eventType],
    `Booking ID: ${registration.id}`,
    `Name: ${field(registration.full_name, 120)}`,
    `Email: ${field(registration.email, 254)}`,
    `Phone: ${field(registration.phone, 40)}`,
    `Age: ${field(registration.age, 20) || 'Not specified'}`,
    `Gender: ${field(registration.gender, 40) || 'Not specified'}`,
    `Trip: ${field(registration.trip_name, 180)}`,
    `Trip date: ${field(registration.trip_date, 120) || 'Not specified'}`,
  ];
  const paid = Number(registration.amount_paid) || 0;
  if (eventType === 'confirmed' && paid > 0) lines.push(`Amount paid: ₹${paid.toLocaleString('en-IN')}`);
  if (imageUnavailable) lines.push('', 'IMAGE UNAVAILABLE');
  // Telegram media captions are limited to 1024 characters. Preserve room for
  // all operational fields even if legacy customer data is unexpectedly long.
  return lines.join('\n').slice(0, eventType !== 'lead' && !imageUnavailable ? 1000 : 4000);
}

export function enqueueTelegramEvent(
  db: Database.Database,
  registrationId: number,
  eventType: TelegramEventType,
): boolean {
  const result = db.prepare(`
    INSERT OR IGNORE INTO telegram_notification_events (registration_id, event_type)
    VALUES (?, ?)
  `).run(registrationId, eventType);
  return result.changes === 1;
}

export function resolveLocalPaymentUpload(reference: string | null | undefined):
  | { ok: true; path: string; filename: string; kind: 'photo' | 'document'; mime: string; data: Buffer }
  | { ok: false; reason: 'missing_reference' | 'invalid_reference' | 'unreadable' } {
  if (!reference) return { ok: false, reason: 'missing_reference' };
  const match = /^\/api\/uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|jpeg|png|pdf))$/i.exec(reference);
  if (!match) return { ok: false, reason: 'invalid_reference' };
  const filename = match[1];
  const uploads = path.resolve(DATA_DIR(), 'uploads');
  const filePath = path.resolve(uploads, filename);
  if (path.dirname(filePath) !== uploads) return { ok: false, reason: 'invalid_reference' };
  let data: Buffer;
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) return { ok: false, reason: 'unreadable' };
    fs.accessSync(filePath, fs.constants.R_OK);
    data = fs.readFileSync(filePath);
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  const ext = path.extname(filename).toLowerCase();
  return {
    ok: true, path: filePath, filename,
    kind: ext === '.pdf' ? 'document' : 'photo',
    mime: ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : 'image/jpeg', data,
  };
}

class TelegramResponseError extends Error {
  constructor(public status: number, public description: string, public retryAfter?: number) {
    super(`Telegram rejected the request (${status})`);
  }
}

async function telegramRequest(method: string, body: URLSearchParams | FormData): Promise<string> {
  const response = await fetch(`${API_ROOT}/bot${token()}/${method}`, {
    method: 'POST', body, signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok || payload.ok !== true) {
    throw new TelegramResponseError(
      response.status,
      clean(payload.description || 'Telegram API rejection').slice(0, 240),
      Number(payload.parameters?.retry_after) || undefined,
    );
  }
  return String(payload.result?.message_id ?? '');
}

async function sendText(text: string): Promise<string> {
  return telegramRequest('sendMessage', new URLSearchParams({ chat_id: chatId(), text }));
}

async function sendFile(method: 'sendPhoto' | 'sendDocument', field: 'photo' | 'document', file: ReturnType<typeof resolveLocalPaymentUpload> & { ok: true }, caption: string): Promise<string> {
  const form = new FormData();
  form.set('chat_id', chatId());
  form.set('caption', caption.slice(0, 1024));
  form.set(field, new Blob([new Uint8Array(file.data)], { type: file.mime }), file.filename);
  return telegramRequest(method, form);
}

function unsupportedPhoto(error: unknown): boolean {
  if (!(error instanceof TelegramResponseError) || error.status !== 400) return false;
  return /photo_invalid|image_process_failed|wrong (?:file|type)|unsupported|invalid dimensions|failed to process/i.test(error.description);
}

function safeError(error: unknown): string {
  if (error instanceof TelegramResponseError) {
    const redacted = error.description
      .replaceAll(token(), '[redacted]')
      .replaceAll(chatId(), '[redacted]');
    return `telegram_http_${error.status}: ${redacted}`.slice(0, 300);
  }
  const name = clean((error as any)?.name || 'network_error');
  return `no_telegram_response: ${name}`.slice(0, 300);
}

function claimOne(db: Database.Database, registrationId: number, eventType: TelegramEventType): ClaimedTelegramEvent | null {
  return db.transaction(() => {
    const row = db.prepare(`
      SELECT id, registration_id, event_type, attempts, event_at
      FROM telegram_notification_events
      WHERE registration_id=? AND event_type=? AND attempts<?
        AND (status='queued' OR (status='retry_wait' AND (next_attempt_at IS NULL OR next_attempt_at<=CURRENT_TIMESTAMP)))
    `).get(registrationId, eventType, MAX_ATTEMPTS) as ClaimedTelegramEvent | undefined;
    if (!row) return null;
    const changed = db.prepare(`
      UPDATE telegram_notification_events
      SET status='dispatching', attempts=attempts+1, updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND status IN ('queued','retry_wait')
    `).run(row.id).changes;
    return changed ? { ...row, attempts: row.attempts + 1 } : null;
  })();
}

export function claimTelegramEvents(db: Database.Database, limit = 10): ClaimedTelegramEvent[] {
  const bounded = Math.max(0, Math.min(10, Math.trunc(limit)));
  return db.transaction(() => {
    const rows = db.prepare(`
      SELECT id, registration_id, event_type, attempts, event_at
      FROM telegram_notification_events
      WHERE attempts<? AND (status='queued' OR (status='retry_wait' AND (next_attempt_at IS NULL OR next_attempt_at<=CURRENT_TIMESTAMP)))
      ORDER BY created_at, id LIMIT ?
    `).all(MAX_ATTEMPTS, bounded) as ClaimedTelegramEvent[];
    const claimed: ClaimedTelegramEvent[] = [];
    const update = db.prepare(`UPDATE telegram_notification_events SET status='dispatching', attempts=attempts+1, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('queued','retry_wait')`);
    for (const row of rows) if (update.run(row.id).changes) claimed.push({ ...row, attempts: row.attempts + 1 });
    return claimed;
  })();
}

export async function deliverClaimedTelegramEvent(db: Database.Database, event: ClaimedTelegramEvent): Promise<TelegramDeliveryState> {
  const registration = db.prepare(`
    SELECT id, full_name, email, phone, age, gender, trip_name, trip_date, payment_screenshot_url, amount_paid
    FROM registrations WHERE id=?
  `).get(event.registration_id) as RegistrationSnapshot | undefined;
  if (!registration) {
    db.prepare(`UPDATE telegram_notification_events SET status='failed', last_error='registration_missing', completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(event.id);
    return 'failed';
  }

  let warning: string | null = null;
  try {
    let messageId: string;
    if (event.event_type === 'lead') {
      messageId = await sendText(formatTelegramMessage('lead', registration));
    } else {
      const upload = resolveLocalPaymentUpload(registration.payment_screenshot_url);
      if (!upload.ok) {
        warning = `image_unavailable: ${upload.reason}`;
        messageId = await sendText(formatTelegramMessage(event.event_type, registration, true));
      } else {
        const caption = formatTelegramMessage(event.event_type, registration);
        if (upload.kind === 'document') {
          messageId = await sendFile('sendDocument', 'document', upload, caption);
        } else {
          try {
            messageId = await sendFile('sendPhoto', 'photo', upload, caption);
          } catch (error) {
            if (!unsupportedPhoto(error)) throw error;
            messageId = await sendFile('sendDocument', 'document', upload, caption);
          }
        }
      }
    }
    db.prepare(`
      UPDATE telegram_notification_events SET status='sent', telegram_message_id=?, last_error=?,
        next_attempt_at=NULL, completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?
    `).run(messageId || null, warning, event.id);
    return 'sent';
  } catch (error) {
    const definite = error instanceof TelegramResponseError;
    const retryable = definite && (error.status === 429 || error.status >= 500);
    const state: TelegramDeliveryState = !definite ? 'uncertain' : retryable && event.attempts < MAX_ATTEMPTS ? 'retry_wait' : 'failed';
    const retrySeconds = error instanceof TelegramResponseError && error.retryAfter
      ? Math.min(300, Math.max(5, error.retryAfter)) : Math.min(300, 30 * (2 ** (event.attempts - 1)));
    db.prepare(`
      UPDATE telegram_notification_events SET status=?, last_error=?,
        next_attempt_at=CASE WHEN ?='retry_wait' THEN datetime('now', '+' || ? || ' seconds') ELSE NULL END,
        completed_at=CASE WHEN ? IN ('failed','uncertain') THEN CURRENT_TIMESTAMP ELSE NULL END,
        updated_at=CURRENT_TIMESTAMP WHERE id=?
    `).run(state, safeError(error), state, retrySeconds, state, event.id);
    return state;
  }
}

export async function dispatchTelegramEvent(registrationId: number, eventType: TelegramEventType): Promise<TelegramDeliveryState | 'not_claimed' | 'not_configured'> {
  if (!telegramConfigured()) return 'not_configured';
  const db = getDb();
  const event = claimOne(db, registrationId, eventType);
  return event ? deliverClaimedTelegramEvent(db, event) : 'not_claimed';
}

export async function processClaimedTelegramEvent(event: ClaimedTelegramEvent): Promise<TelegramDeliveryState> {
  return deliverClaimedTelegramEvent(getDb(), event);
}

export async function sendTestNotification(): Promise<{ configured: boolean; messageId?: string }> {
  if (!telegramConfigured()) return { configured: false };
  const messageId = await sendText(`Seek the Thrill Telegram notifications are configured.\nTest time: ${formatIndiaTimestamp(new Date())}`);
  return { configured: true, messageId };
}
