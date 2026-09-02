import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import {
  SOUTH_GOA_HISTORICAL_CONFIG,
  analyzeSouthGoaCsv,
  importSouthGoaCsv,
} from '../../scripts/lib/south-goa-historical-import.mjs';

const consent = 'By signing up for this trip, I acknowledge and understand that adventure activities involve inherent risks.';
const header = ['Timestamp','What do we call you?','Email ID','WhatsApp No.','Emergency Contact','Gender','How old are you?',
  'Which city are you based out of currently?',"What’s your instagram handle?",'Why are you joining this trip?',consent,
  'What is your transport situation?','Status'];
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
const response = (email: string, transport: string, status: string) => [
  '9/1/2025 10:15:20','Test Traveller',email,'9876543210','9876543211','Female','29','Pune','@test','Adventure','Accepted',transport,status,
].map(quote).join(',');
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
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE payment_events (id TEXT PRIMARY KEY, registration_id INTEGER);
    CREATE TABLE invoice_documents (id TEXT PRIMARY KEY, registration_id INTEGER);
    CREATE TABLE telegram_notification_events (id INTEGER PRIMARY KEY, registration_id INTEGER);
    CREATE TABLE email_delivery_log (id TEXT PRIMARY KEY);
  `);
}

describe('South Goa historical import', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); schema(db); });
  afterEach(() => db.close());

  it('maps confirmed rows to fully paid using the selected package price', () => {
    const result = importSouthGoaCsv(csv(
      response('bangalore@example.com', 'Joining from Bangalore', 'Confirmed'),
      response('goa@example.com', 'Joining at Goa directly', 'Confirmed'),
    ), db);
    expect(result.counts).toMatchObject({ confirmed: 2, leads: 0 });
    expect(db.prepare('SELECT tier_id,sharing_option,total_amount,amount_paid,payment_status,status FROM registrations ORDER BY id').all()).toEqual([
      { tier_id: 'bangalore-package', sharing_option: 'From Bangalore', total_amount: 15999, amount_paid: 15999, payment_status: 'fully_paid', status: 'confirmed' },
      { tier_id: 'goa-direct', sharing_option: 'Meet in Goa', total_amount: 12999, amount_paid: 12999, payment_status: 'fully_paid', status: 'confirmed' },
    ]);
  });

  it('maps blank status to an unpaid lead and blank transport to Bangalore', () => {
    const result = importSouthGoaCsv(csv(response('lead@example.com', '', '')), db);
    expect(result.candidates[0]).toMatchObject({ status: 'lead', paymentStatus: 'unpaid', amountPaid: 0, tierId: 'bangalore-package', transportDefaulted: true });
  });

  it('rejects unknown statuses and remains same-departure idempotent', () => {
    const bad = analyzeSouthGoaCsv(csv(response('bad@example.com', 'Joining from Bangalore', 'Maybe')), db);
    expect(bad.rejected[0].reasons[0]).toContain('unknown status');
    const input = csv(response('person@example.com', 'Joining from Bangalore', 'Confirmed'));
    importSouthGoaCsv(input, db);
    const second = importSouthGoaCsv(input, db);
    expect(second.counts).toMatchObject({ toCreate: 0, skipped: 1 });
  });

  it('suppresses all outbound side effects', () => {
    const result = importSouthGoaCsv(csv(response('person@example.com', 'Joining from Bangalore', 'Confirmed')), db, SOUTH_GOA_HISTORICAL_CONFIG);
    expect(result.sideEffectsAfter).toEqual(result.sideEffectsBefore);
    expect(result.sideEffectsAfter).toEqual({ users: 0, payments: 0, documents: 0, telegram: 0, emails: 0 });
  });
});
