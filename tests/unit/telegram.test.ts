import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  claimTelegramEvents,
  deliverClaimedTelegramEvent,
  enqueueTelegramEvent,
  formatIndiaTimestamp,
  formatTelegramMessage,
  resolveLocalPaymentUpload,
  sendTestNotification,
} from '../../src/lib/telegram';

function database() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE registrations (
      id INTEGER PRIMARY KEY, full_name TEXT, email TEXT, phone TEXT,
      trip_name TEXT, trip_date TEXT, payment_screenshot_url TEXT, amount_paid INTEGER
    );
    CREATE TABLE telegram_notification_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      registration_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      telegram_message_id TEXT,
      last_error TEXT,
      next_attempt_at DATETIME,
      event_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      UNIQUE(registration_id, event_type)
    );
  `);
  return db;
}

function seed(db: Database.Database, proof: string | null = null, amount = 0) {
  db.prepare(`INSERT INTO registrations VALUES (1, 'Asha Rao', 'asha@example.com', '9876543210', 'Ladakh', '1 Sep – 8 Sep 2026', ?, ?)`).run(proof, amount);
}

function response(status: number, body: any) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-telegram-'));
  fs.mkdirSync(path.join(tempDir, 'uploads'));
  process.env.DATA_DIR = tempDir;
  process.env.TELEGRAM_BOT_TOKEN = 'test-secret-token';
  process.env.TELEGRAM_ADMIN_CHAT_ID = '-100123';
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_ADMIN_CHAT_ID;
  delete process.env.DATA_DIR;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('Telegram formatting and upload confinement', () => {
  it('formats India time and includes only a positive cumulative paid amount', () => {
    expect(formatIndiaTimestamp('2026-08-29 12:00:00')).toMatch(/05:30 pm IST/i);
    const base = { id: 42, full_name: 'Asha', email: 'a@example.com', phone: '9', trip_name: 'Ladakh', trip_date: 'Sep', payment_screenshot_url: null, amount_paid: 0 };
    expect(formatTelegramMessage('lead', base, '2026-08-29 12:00:00')).toContain('NEW BOOKING LEAD');
    expect(formatTelegramMessage('pending', base, '2026-08-29 12:00:00')).toContain('BOOKING PAYMENT PENDING');
    expect(formatTelegramMessage('confirmed', base, '2026-08-29 12:00:00')).not.toContain('Amount paid');
    expect(formatTelegramMessage('confirmed', { ...base, amount_paid: 12500 }, '2026-08-29 12:00:00')).toContain('Amount paid: ₹12,500');
  });

  it('accepts only generated local JPG/PNG/PDF references', () => {
    const filename = '123e4567-e89b-42d3-a456-426614174000.png';
    fs.writeFileSync(path.join(tempDir, 'uploads', filename), 'png');
    expect(resolveLocalPaymentUpload(`/api/uploads/${filename}`)).toMatchObject({ ok: true, kind: 'photo' });
    expect(resolveLocalPaymentUpload('https://example.com/proof.png')).toEqual({ ok: false, reason: 'invalid_reference' });
    expect(resolveLocalPaymentUpload('/api/uploads/../secret.pdf')).toEqual({ ok: false, reason: 'invalid_reference' });
    expect(resolveLocalPaymentUpload('/api/uploads/123e4567-e89b-42d3-a456-426614174000.pdf')).toEqual({ ok: false, reason: 'unreadable' });
  });
});

describe('Telegram outbox and delivery policy', () => {
  it('is unique per registration/event and atomically claims at most once', () => {
    const db = database();
    seed(db);
    expect(enqueueTelegramEvent(db, 1, 'lead')).toBe(true);
    expect(enqueueTelegramEvent(db, 1, 'lead')).toBe(false);
    expect(enqueueTelegramEvent(db, 1, 'pending')).toBe(true);
    expect(enqueueTelegramEvent(db, 1, 'confirmed')).toBe(true);
    expect(claimTelegramEvents(db, 10)).toHaveLength(3);
    expect(claimTelegramEvents(db, 10)).toHaveLength(0);
    expect(db.prepare(`SELECT DISTINCT status FROM telegram_notification_events`).all()).toEqual([{ status: 'dispatching' }]);
    db.close();
  });

  it('sends leads as text and persists the returned message ID', async () => {
    const db = database(); seed(db); enqueueTelegramEvent(db, 1, 'lead');
    const fetchMock = vi.fn().mockResolvedValue(response(200, { ok: true, result: { message_id: 77 } }));
    vi.stubGlobal('fetch', fetchMock);
    const [event] = claimTelegramEvents(db);
    expect(await deliverClaimedTelegramEvent(db, event)).toBe('sent');
    expect(fetchMock.mock.calls[0][0]).toContain('/sendMessage');
    expect(db.prepare(`SELECT status, telegram_message_id FROM telegram_notification_events`).get()).toEqual({ status: 'sent', telegram_message_id: '77' });
    db.close();
  });

  it('sends pending payment proof as a photo with the pending caption', async () => {
    const photo = '123e4567-e89b-42d3-a456-426614174000.jpg';
    fs.writeFileSync(path.join(tempDir, 'uploads', photo), 'jpg');
    const db = database(); seed(db, `/api/uploads/${photo}`); enqueueTelegramEvent(db, 1, 'pending');
    const fetchMock = vi.fn().mockResolvedValue(response(200, { ok: true, result: { message_id: 78 } }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await deliverClaimedTelegramEvent(db, claimTelegramEvents(db)[0])).toBe('sent');
    expect(fetchMock.mock.calls[0][0]).toContain('/sendPhoto');
    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect(body.get('caption')).toContain('BOOKING PAYMENT PENDING');
    db.close();
  });

  it('uses documents for PDFs and falls back from unsupported photos', async () => {
    const photo = '123e4567-e89b-42d3-a456-426614174000.jpg';
    fs.writeFileSync(path.join(tempDir, 'uploads', photo), 'jpg');
    const db = database(); seed(db, `/api/uploads/${photo}`, 1000); enqueueTelegramEvent(db, 1, 'confirmed');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(400, { ok: false, description: 'PHOTO_INVALID_DIMENSIONS' }))
      .mockResolvedValueOnce(response(200, { ok: true, result: { message_id: 88 } }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await deliverClaimedTelegramEvent(db, claimTelegramEvents(db)[0])).toBe('sent');
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      expect.stringContaining('/sendPhoto'), expect.stringContaining('/sendDocument'),
    ]);
    db.close();
  });

  it('sends a PDF directly as a document', async () => {
    const pdf = '123e4567-e89b-42d3-a456-426614174000.pdf';
    fs.writeFileSync(path.join(tempDir, 'uploads', pdf), '%PDF');
    const db = database(); seed(db, `/api/uploads/${pdf}`, 1000); enqueueTelegramEvent(db, 1, 'confirmed');
    const fetchMock = vi.fn().mockResolvedValue(response(200, { ok: true, result: { message_id: 89 } }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await deliverClaimedTelegramEvent(db, claimTelegramEvents(db)[0])).toBe('sent');
    expect(fetchMock.mock.calls[0][0]).toContain('/sendDocument');
    db.close();
  });

  it('sends IMAGE UNAVAILABLE and logs why when a proof cannot be read', async () => {
    const db = database(); seed(db, '/api/uploads/123e4567-e89b-42d3-a456-426614174000.pdf', 500); enqueueTelegramEvent(db, 1, 'confirmed');
    const fetchMock = vi.fn().mockResolvedValue(response(200, { ok: true, result: { message_id: 9 } }));
    vi.stubGlobal('fetch', fetchMock);
    await deliverClaimedTelegramEvent(db, claimTelegramEvents(db)[0]);
    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get('text')).toContain('IMAGE UNAVAILABLE');
    expect(db.prepare(`SELECT status, last_error FROM telegram_notification_events`).get()).toEqual({ status: 'sent', last_error: 'image_unavailable: unreadable' });
    db.close();
  });

  it('retries definite 429/5xx, fails at attempt three, and never retries ambiguous timeouts', async () => {
    const db = database(); seed(db); enqueueTelegramEvent(db, 1, 'lead');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(429, { ok: false, description: 'Too Many Requests', parameters: { retry_after: 1 } })));
    expect(await deliverClaimedTelegramEvent(db, claimTelegramEvents(db)[0])).toBe('retry_wait');
    db.prepare(`UPDATE telegram_notification_events SET status='retry_wait', next_attempt_at=NULL, attempts=2`).run();
    expect(await deliverClaimedTelegramEvent(db, claimTelegramEvents(db)[0])).toBe('failed');

    db.prepare(`DELETE FROM telegram_notification_events`).run();
    enqueueTelegramEvent(db, 1, 'confirmed');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Object.assign(new Error('secret network detail'), { name: 'TimeoutError' })));
    expect(await deliverClaimedTelegramEvent(db, claimTelegramEvents(db)[0])).toBe('uncertain');
    expect(claimTelegramEvents(db)).toHaveLength(0);
    expect(String((db.prepare(`SELECT last_error FROM telegram_notification_events`).get() as any).last_error)).not.toContain('secret network detail');
    db.close();
  });

  it('retries a definite 5xx but fails a non-retryable 4xx', async () => {
    const db = database(); seed(db); enqueueTelegramEvent(db, 1, 'lead');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(503, { ok: false, description: 'Service unavailable' })));
    expect(await deliverClaimedTelegramEvent(db, claimTelegramEvents(db)[0])).toBe('retry_wait');
    db.prepare(`DELETE FROM telegram_notification_events`).run();
    enqueueTelegramEvent(db, 1, 'confirmed');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(403, { ok: false, description: 'Forbidden' })));
    expect(await deliverClaimedTelegramEvent(db, claimTelegramEvents(db)[0])).toBe('failed');
    db.close();
  });

  it('redacts configuration and returns only the test message ID', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(200, { ok: true, result: { message_id: 123 } })));
    await expect(sendTestNotification()).resolves.toEqual({ configured: true, messageId: '123' });
    delete process.env.TELEGRAM_BOT_TOKEN;
    await expect(sendTestNotification()).resolves.toEqual({ configured: false });
  });
});
