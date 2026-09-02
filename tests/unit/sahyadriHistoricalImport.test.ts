import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import {
  analyzeSahyadriCsv,
  importSahyadriCsv,
  sahyadriConfig,
} from '../../scripts/lib/sahyadri-historical-import.mjs';

const consent = 'By signing up for this trip, I acknowledge and understand that adventure activities involve inherent risks.';
const header = ['Timestamp','What do we call you?','Email ID','WhatsApp No.','Emergency Contact','Gender','How old are you?',
  'Which city are you based out of currently?',"What’s your instagram handle?",'Why are you joining this trip?',consent,'Status'];
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
const response = (email: string, status: string, accepted = 'Accepted') => [
  '6/20/2025 10:15:20','Test Traveller',email,'9876543210','9876543211','Female','29','Mumbai','@test','Adventure',accepted,status,
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
    CREATE TABLE payment_events (id TEXT PRIMARY KEY);
    CREATE TABLE invoice_documents (id TEXT PRIMARY KEY);
    CREATE TABLE telegram_notification_events (id INTEGER PRIMARY KEY);
    CREATE TABLE email_delivery_log (id TEXT PRIMARY KEY);
  `);
}

describe('Sahyadri historical import', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); schema(db); });
  afterEach(() => db.close());

  it('maps the two dates to separate departures at the historical price', () => {
    expect(sahyadriConfig('2025-07-25')).toMatchObject({ batchId: 'sahyadri-2025-07-25', totalAmount: 13999 });
    expect(sahyadriConfig('2025-08-01')).toMatchObject({ batchId: 'sahyadri-2025-08-01', totalAmount: 13999 });
  });

  it('maps confirmed and blank statuses without side effects', () => {
    const result = importSahyadriCsv(csv(
      response('confirmed@example.com', 'Confirmed'),
      response('lead@example.com', ''),
    ), db, '2025-07-25');
    expect(result.counts).toMatchObject({ confirmed: 1, leads: 1, toCreate: 2 });
    expect(db.prepare('SELECT tier_id,total_amount,amount_paid,payment_status,status FROM registrations ORDER BY id').all()).toEqual([
      { tier_id: 'standard', total_amount: 13999, amount_paid: 13999, payment_status: 'fully_paid', status: 'confirmed' },
      { tier_id: 'standard', total_amount: 13999, amount_paid: 0, payment_status: 'unpaid', status: 'lead' },
    ]);
    expect(result.sideEffectsAfter).toEqual(result.sideEffectsBefore);
  });

  it('allows one traveller on both departures but remains idempotent within each', () => {
    const input = csv(response('repeat@example.com', 'Confirmed'));
    importSahyadriCsv(input, db, '2025-07-25');
    expect(analyzeSahyadriCsv(input, db, '2025-08-01').counts.toCreate).toBe(1);
    expect(analyzeSahyadriCsv(input, db, '2025-07-25').counts).toMatchObject({ toCreate: 0, skipped: 1 });
  });

  it('retains a historical response with no consent evidence without inventing consent', () => {
    const result = importSahyadriCsv(csv(response('legacy@example.com', 'Confirmed', '')), db, '2025-07-25');
    expect(result.candidates[0]).toMatchObject({ missingConsent: true, consentAt: null });
    expect(db.prepare('SELECT consent_at FROM registrations').get()).toEqual({ consent_at: null });
  });
});
