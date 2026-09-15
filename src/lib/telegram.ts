import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { getDb } from './db';
import { keyboardFor, type Menu } from './telegramKeyboard';

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
  sharing_option: string | null;
  payment_screenshot_url: string | null;
  amount_paid: number | null;
  status?: string | null;
  payment_status?: string | null;
  trip_slug?: string | null;
  total_amount?: number | null;
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

const webhookSecretValue = () => String((import.meta.env as any).TELEGRAM_WEBHOOK_SECRET || process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
const botUsernameValue = () => String((import.meta.env as any).TELEGRAM_BOT_USERNAME || process.env.TELEGRAM_BOT_USERNAME || '').trim().replace(/^@/, '');

export function telegramConfigured(): boolean {
  return Boolean(token() && chatId());
}

/** Deliberately its own secret, not the bot token — the token already authenticates the retry worker. */
export function telegramWebhookSecret(): string {
  return webhookSecretValue();
}

export function telegramBotUsername(): string {
  return botUsernameValue();
}

export function telegramAdminChatId(): string {
  return chatId();
}

/** Two-way actions need the webhook secret on top of the one-way configuration. */
export function telegramActionsConfigured(): boolean {
  return Boolean(token() && chatId() && webhookSecretValue());
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
    `Occupancy: ${field(registration.sharing_option, 120) || 'Not specified'}`,
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

async function sendText(text: string, replyMarkup?: unknown): Promise<string> {
  const params = new URLSearchParams({ chat_id: chatId(), text });
  if (replyMarkup) params.set('reply_markup', JSON.stringify(replyMarkup));
  return telegramRequest('sendMessage', params);
}

async function sendFile(method: 'sendPhoto' | 'sendDocument', field: 'photo' | 'document', file: ReturnType<typeof resolveLocalPaymentUpload> & { ok: true }, caption: string, replyMarkup?: unknown): Promise<string> {
  const form = new FormData();
  form.set('chat_id', chatId());
  form.set('caption', caption.slice(0, 1024));
  form.set(field, new Blob([new Uint8Array(file.data)], { type: file.mime }), file.filename);
  if (replyMarkup) form.set('reply_markup', JSON.stringify(replyMarkup));
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
    SELECT id, full_name, email, phone, age, gender, trip_name, trip_date, sharing_option, payment_screenshot_url,
           amount_paid, status, payment_status, trip_slug, total_amount
    FROM registrations WHERE id=?
  `).get(event.registration_id) as RegistrationSnapshot | undefined;
  if (!registration) {
    db.prepare(`UPDATE telegram_notification_events SET status='failed', last_error='registration_missing', completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(event.id);
    return 'failed';
  }

  let warning: string | null = null;
  // Two-way actions are opt-in: without a webhook secret nothing can act on a
  // button, so shipping one would be a dead control in the ops group.
  const keyboard = telegramActionsConfigured()
    ? keyboardFor({
        regId: registration.id,
        status: String(registration.status ?? 'pending'),
        tripSlug: registration.trip_slug ?? null,
        amountPaid: registration.amount_paid,
        totalAmount: registration.total_amount,
      })
    : undefined;
  try {
    let messageId: string;
    if (event.event_type === 'lead') {
      messageId = await sendText(formatTelegramMessage('lead', registration), keyboard);
    } else {
      const upload = resolveLocalPaymentUpload(registration.payment_screenshot_url);
      if (!upload.ok) {
        warning = `image_unavailable: ${upload.reason}`;
        messageId = await sendText(formatTelegramMessage(event.event_type, registration, true), keyboard);
      } else {
        const caption = formatTelegramMessage(event.event_type, registration);
        if (upload.kind === 'document') {
          messageId = await sendFile('sendDocument', 'document', upload, caption, keyboard);
        } else {
          try {
            messageId = await sendFile('sendPhoto', 'photo', upload, caption, keyboard);
          } catch (error) {
            if (!unsupportedPhoto(error)) throw error;
            messageId = await sendFile('sendDocument', 'document', upload, caption, keyboard);
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

// ── Two-way actions ────────────────────────────────────────────────────────

/**
 * Acknowledge a button tap. Must go out promptly — Telegram expires the query
 * and the tapper is left watching a spinner — so callers answer first and do the
 * work afterwards. Never throws: a failed acknowledgement must not abort a
 * change that has already been written.
 */
export async function answerCallbackQuery(callbackQueryId: string, text = '', showAlert = false): Promise<void> {
  const params = new URLSearchParams({ callback_query_id: callbackQueryId });
  if (text) params.set('text', text.slice(0, 200));
  if (showAlert) params.set('show_alert', 'true');
  try {
    await telegramRequest('answerCallbackQuery', params);
  } catch (error) {
    console.error('[Telegram answerCallbackQuery]', safeError(error));
  }
}

/** Swap the keyboard under one message, leaving its content alone. */
async function editReplyMarkup(messageId: string, replyMarkup: unknown): Promise<void> {
  await telegramRequest('editMessageReplyMarkup', new URLSearchParams({
    chat_id: chatId(), message_id: String(messageId), reply_markup: JSON.stringify(replyMarkup),
  }));
}

/** Show a submenu in place, without touching the booking. */
export async function showMenu(
  messageId: string,
  ctx: { regId: number; status: string; tripSlug?: string | null },
  menu: Menu,
): Promise<void> {
  try {
    await editReplyMarkup(messageId, keyboardFor(ctx, menu));
  } catch (error) {
    console.error('[Telegram showMenu]', safeError(error));
  }
}

/**
 * Bring every message this booking has produced back in line with its current
 * state, appending `footer` to each.
 *
 * Confirming from the `pending` message posts a fresh `confirmed` notification,
 * so a booking accumulates messages — and the older ones keep whatever keyboard
 * they were sent with. Leaving a stale `Confirm ▸` in the group is safe (the
 * transition guard and the compare-and-swap both refuse it) but reads as though
 * the booking were still unconfirmed, so every message is refreshed, not just
 * the one that was tapped.
 *
 * Content edits are best-effort: on any rejection this falls back to swapping
 * just the keyboard, which works for photo and text messages alike.
 */
export async function refreshRegistrationMessages(registrationId: number, footer?: string): Promise<void> {
  const db = getDb();
  const registration = db.prepare(`
    SELECT id, full_name, email, phone, age, gender, trip_name, trip_date, sharing_option, payment_screenshot_url,
           amount_paid, status, payment_status, trip_slug, total_amount
    FROM registrations WHERE id=?
  `).get(registrationId) as RegistrationSnapshot | undefined;
  if (!registration) return;

  const events = db.prepare(`
    SELECT event_type, telegram_message_id, last_error FROM telegram_notification_events
    WHERE registration_id=? AND status='sent' AND telegram_message_id IS NOT NULL
  `).all(registrationId) as Array<{ event_type: TelegramEventType; telegram_message_id: string; last_error: string | null }>;

  const keyboard = keyboardFor({
    regId: registration.id,
    status: String(registration.status ?? 'pending'),
    tripSlug: registration.trip_slug ?? null,
    amountPaid: registration.amount_paid,
    totalAmount: registration.total_amount,
  });

  for (const event of events) {
    const imageUnavailable = Boolean(event.last_error?.startsWith('image_unavailable'));
    // A caption exists only where a file was actually attached; everything else
    // went out as plain text.
    const hasCaption = event.event_type !== 'lead' && !imageUnavailable;
    const body = formatTelegramMessage(event.event_type, registration, imageUnavailable);
    const text = footer ? `${body}\n\n${footer}` : body;
    try {
      const params = new URLSearchParams({
        chat_id: chatId(),
        message_id: String(event.telegram_message_id),
        reply_markup: JSON.stringify(keyboard),
      });
      if (hasCaption) {
        params.set('caption', text.slice(0, 1024));
        await telegramRequest('editMessageCaption', params);
      } else {
        params.set('text', text.slice(0, 4000));
        await telegramRequest('editMessageText', params);
      }
    } catch (error) {
      // "message is not modified", a wrong caption/text guess, or a message too
      // old to edit. The keyboard is the part that must not go stale.
      try {
        await editReplyMarkup(event.telegram_message_id, keyboard);
      } catch (inner) {
        console.error('[Telegram refresh]', safeError(inner));
      }
    }
  }
}

/** Register the webhook with Telegram. Used by scripts/telegram-webhook.mjs. */
export async function setTelegramWebhook(url: string): Promise<void> {
  await telegramRequest('setWebhook', new URLSearchParams({
    url,
    secret_token: webhookSecretValue(),
    allowed_updates: JSON.stringify(['callback_query', 'message']),
    drop_pending_updates: 'true',
  }));
}

/**
 * Send to an arbitrary chat — the linking flow's direct messages.
 *
 * Distinct from the group senders above, which are pinned to
 * TELEGRAM_ADMIN_CHAT_ID so an operational notification can never be addressed
 * anywhere else. Never throws: a failed reply must not fail the webhook.
 */
export async function sendDirectMessage(chatIdValue: string | number, text: string): Promise<void> {
  try {
    await telegramRequest('sendMessage', new URLSearchParams({
      chat_id: String(chatIdValue), text: text.slice(0, 4000),
    }));
  } catch (error) {
    console.error('[Telegram DM]', safeError(error));
  }
}
