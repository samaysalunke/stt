import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import {
  NAGALAND_HISTORICAL_CONFIG,
  analyzeHistoricalCsv,
  importHistoricalCsv,
  normalizeEmail,
} from '../../scripts/lib/historical-registration-import.mjs';

const header = [
  'Timestamp', 'What do we call you?', 'train Status', 'Reached guwahati', 'Flight issue',
  'Column 13', 'Email ID', 'WhatsApp No.', 'Emergency Contact', 'Gender', 'How old are you?',
  'Which city are you based out of currently?', 'What’s your instagram handle?',
  'Why are you joining this trip?',
  'By signing up for this trip, I acknowledge and understand that adventure activities involve inherent risks.',
];
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
const row = (overrides: Record<number, string> = {}) => {
  const values = [
    '11/2/2025 10:15:20', 'Test Traveller', '', '', '', '', ' Person@Example.COM ',
    '9876543210', '9876543211', 'Female', '29', 'Pune', '@person', 'For the experience', 'Accepted',
  ];
  for (const [index, value] of Object.entries(overrides)) values[Number(index)] = value;
  return values.map(quote).join(',');
};
const csv = (...rows: string[]) => [header.map(quote).join(','), ...rows].join('\n');

function schema(db: Database.Database) {
  db.exec(`
    CREATE TABLE registrations (
      id INTEGER PRIMARY KEY, trip_name TEXT, trip_slug TEXT, trip_date TEXT, full_name TEXT,
      email TEXT, phone TEXT, emergency_name TEXT, emergency_phone TEXT, gender TEXT, age TEXT,
      city TEXT, instagram TEXT, why_join TEXT, batch_id TEXT, tier_id TEXT, sharing_option TEXT,
      total_amount INTEGER, amount_paid INTEGER, amount_refunded INTEGER, payment_status TEXT,
      payment_date TEXT, payment_method TEXT, transaction_id TEXT, status TEXT, status_changed_at TEXT,
      source TEXT, source_detail TEXT, photo_consent INTEGER, consent_at TEXT, created_at TEXT,
      updated_at TEXT, admin_notes TEXT, email_sent INTEGER
    );
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT);
    CREATE TABLE payment_events (id TEXT PRIMARY KEY);
    CREATE TABLE invoice_documents (id TEXT PRIMARY KEY);
    CREATE TABLE telegram_notification_events (id INTEGER PRIMARY KEY);
    CREATE TABLE email_delivery_log (id TEXT PRIMARY KEY);
  `);
}

describe('historical registration import', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); schema(db); });
  afterEach(() => db.close());

  it('normalizes email and maps paid/blank status without payment metadata', () => {
    const input = csv(row({ 5: 'fully paid' }), row({ 6: 'lead@example.com' }));
    const result = importHistoricalCsv(input, db, { ...NAGALAND_HISTORICAL_CONFIG, heldRows: [] });
    expect(normalizeEmail(' Person@Example.COM ')).toBe('person@example.com');
    expect(result.counts).toMatchObject({ confirmed: 1, leads: 1, toCreate: 2 });
    expect(db.prepare('SELECT email,status,payment_status,total_amount,amount_paid,payment_date,source,created_at,consent_at FROM registrations ORDER BY id').all()).toEqual([
      { email: 'person@example.com', status: 'confirmed', payment_status: 'fully_paid', total_amount: 20500, amount_paid: 20500,
        payment_date: null, source: 'historical-google-forms', created_at: '2025-11-02 04:45:20', consent_at: '2025-11-02 04:45:20' },
      { email: 'lead@example.com', status: 'lead', payment_status: 'unpaid', total_amount: 20500, amount_paid: 0,
        payment_date: null, source: 'historical-google-forms', created_at: '2025-11-02 04:45:20', consent_at: '2025-11-02 04:45:20' },
    ]);
  });

  it('aggregates by existing email without creating or changing a user', () => {
    db.prepare("INSERT INTO users VALUES ('u1','person@example.com')").run();
    db.prepare("INSERT INTO registrations (email,trip_slug,batch_id) VALUES (' PERSON@example.com ','older-trip','older-batch')").run();
    const result = importHistoricalCsv(csv(row()), db, { ...NAGALAND_HISTORICAL_CONFIG, heldRows: [] });
    expect(result.existingCustomerMatches).toBe(1);
    expect(db.prepare('SELECT * FROM users').all()).toEqual([{ id: 'u1', email: 'person@example.com' }]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM registrations WHERE lower(trim(email))='person@example.com'").get()).toEqual({ count: 2 });
  });

  it('is idempotent for the same email, trip, and departure', () => {
    const input = csv(row());
    importHistoricalCsv(input, db, { ...NAGALAND_HISTORICAL_CONFIG, heldRows: [] });
    const second = importHistoricalCsv(input, db, { ...NAGALAND_HISTORICAL_CONFIG, heldRows: [] });
    expect(second.counts).toMatchObject({ toCreate: 0, skipped: 1 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM registrations').get()).toEqual({ count: 1 });
  });

  it('rejects invalid rows and refuses the transaction', () => {
    const input = csv(row({ 6: 'not-an-email' }));
    const preview = analyzeHistoricalCsv(input, db, { ...NAGALAND_HISTORICAL_CONFIG, heldRows: [] });
    expect(preview.rejected[0].reasons).toContain('invalid email');
    expect(() => importHistoricalCsv(input, db, { ...NAGALAND_HISTORICAL_CONFIG, heldRows: [] })).toThrow('Import refused');
    expect(db.prepare('SELECT COUNT(*) AS count FROM registrations').get()).toEqual({ count: 0 });
  });

  it('creates no email, Telegram, payment, document, or user side effects', () => {
    const result = importHistoricalCsv(csv(row({ 5: 'fully paid' })), db, { ...NAGALAND_HISTORICAL_CONFIG, heldRows: [] });
    expect(result.sideEffectsAfter).toEqual(result.sideEffectsBefore);
    expect(result.sideEffectsAfter).toEqual({ users: 0, payments: 0, documents: 0, telegram: 0, emails: 0 });
  });
});
