#!/usr/bin/env node
/**
 * Is the invoice pipeline actually delivering?
 *
 * Written after invoicing was found stalled for weeks with nothing reporting
 * it: every document failed pre-flight on a billing check that turned out not
 * to be required, and no scheduler was calling the retry worker, so they all
 * sat at one attempt with their backoff long elapsed. Nothing surfaced any of
 * that — the admin UI shows one booking at a time.
 *
 *   railway ssh node scripts/audit-invoice-health.mjs
 *   DATA_DIR=./data node scripts/audit-invoice-health.mjs
 *
 * Opens the database READ-ONLY and prints only aggregates. No traveller data.
 */
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'seekthethrill.db');

let db;
try {
  db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
} catch (error) {
  console.error(`Could not open ${DB_PATH}: ${error.message}`);
  process.exit(1);
}

const show = (title, rows) => {
  console.log(`\n=== ${title} ===`);
  if (!rows.length) console.log('(no rows)');
  else console.table(rows);
};

// A — the headline. Every document that is not delivered, with the error it is
// stuck on. A healthy pipeline shows nothing but transient `queued`.
show('A. final invoices not delivered', db.prepare(`
  SELECT status, mode, attempts, COUNT(*) AS n,
         MIN(created_at) AS oldest, MAX(updated_at) AS last_try,
         substr(COALESCE(last_error,''), 1, 120) AS last_error
  FROM invoice_documents
  WHERE document_type='final' AND status <> 'emailed'
  GROUP BY status, mode, attempts, substr(COALESCE(last_error,''), 1, 120)
  ORDER BY n DESC
`).all());

// B — past the retry cap. The worker's query stops at attempts<6, so these are
// invisible to it: no retry will ever be attempted and nothing says so.
// Anything here needs a hand (fix the cause, then Retry from the admin UI).
show('B. BEYOND THE RETRY CAP — needs manual attention', db.prepare(`
  SELECT id, registration_id, status, attempts, updated_at,
         substr(COALESCE(last_error,''), 1, 160) AS last_error
  FROM invoice_documents
  WHERE status='failed' AND attempts >= 6
  ORDER BY updated_at DESC
`).all());

// C — fully paid with no invoice raised at all. Restricted to rows the ledger
// knows about: 216 pre-ledger bookings (backfilled by the historical importers
// and by hand, before payment_events existed) are fully paid with no events and
// are deliberately not invoiced. Counting them here would bury every real case.
show('C. fully paid, ledger-backed, no final invoice', db.prepare(`
  SELECT r.status, COUNT(*) AS n, MIN(r.updated_at) AS oldest, MAX(r.updated_at) AS newest
  FROM registrations r
  LEFT JOIN invoice_documents d
    ON d.registration_id = r.id AND d.document_type = 'final'
  WHERE r.payment_status = 'fully_paid'
    AND d.id IS NULL
    AND EXISTS (SELECT 1 FROM payment_events e WHERE e.registration_id = r.id)
  GROUP BY r.status
`).all());

// D — the excluded set, stated rather than hidden, so the zero in C is readable.
show('D. excluded from C: pre-ledger rows with no payment events', db.prepare(`
  SELECT r.source, COUNT(*) AS n
  FROM registrations r
  LEFT JOIN invoice_documents d
    ON d.registration_id = r.id AND d.document_type = 'final'
  WHERE r.payment_status = 'fully_paid'
    AND d.id IS NULL
    AND NOT EXISTS (SELECT 1 FROM payment_events e WHERE e.registration_id = r.id)
  GROUP BY r.source
`).all());

// E — throughput, to tell "nothing is stuck" apart from "nothing is running".
show('E. delivered invoices by day (last 14)', db.prepare(`
  SELECT substr(sent_at, 1, 10) AS day, COUNT(*) AS delivered
  FROM invoice_documents
  WHERE document_type='final' AND status='emailed' AND sent_at IS NOT NULL
  GROUP BY day ORDER BY day DESC LIMIT 14
`).all());

const stuck = db.prepare(`
  SELECT COUNT(*) AS n FROM invoice_documents WHERE document_type='final' AND status <> 'emailed'
`).get().n;
const capped = db.prepare(`
  SELECT COUNT(*) AS n FROM invoice_documents WHERE status='failed' AND attempts >= 6
`).get().n;
const missing = db.prepare(`
  SELECT COUNT(*) AS n FROM registrations r
  LEFT JOIN invoice_documents d ON d.registration_id=r.id AND d.document_type='final'
  WHERE r.payment_status='fully_paid' AND d.id IS NULL
    AND EXISTS (SELECT 1 FROM payment_events e WHERE e.registration_id=r.id)
`).get().n;

console.log(`\n${stuck === 0 && capped === 0 && missing === 0 ? 'HEALTHY' : 'ATTENTION'}: ${stuck} undelivered, ${capped} past the retry cap, ${missing} fully paid with no invoice.`);
process.exit(stuck === 0 && capped === 0 && missing === 0 ? 0 : 1);
