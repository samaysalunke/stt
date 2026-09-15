#!/usr/bin/env node
/**
 * The audit in scripts/audit-payment-matrix.sql, without needing a sqlite3 CLI.
 *
 * Nixpacks Node images do not ship the sqlite3 binary, so on a deployed
 * container the .sql file has nothing to run it. This uses better-sqlite3, which
 * is already a dependency, and opens the database READ-ONLY.
 *
 *   railway ssh node scripts/audit-payment-matrix.mjs
 *   DATA_DIR=./data node scripts/audit-payment-matrix.mjs
 *
 * Prints only aggregates — counts and sums grouped by status. No traveller data.
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

// A — the check that gates the Phase 0 guard. PAYMENT_OPTIONS is a UI affordance
// list, so a row landing in a REJECT bucket is not bad data; it is evidence that
// a membership test would have been the wrong guard. `assertPaymentActionAllowed`
// is narrower on purpose: money moves only on live bookings.
show('A. (status, payment_status) vs PAYMENT_OPTIONS', db.prepare(`
  SELECT status,
         COALESCE(payment_status,'(null)')  AS payment_status,
         COUNT(*)                           AS n,
         SUM(COALESCE(amount_paid,0))       AS paid,
         SUM(COALESCE(amount_refunded,0))   AS refunded,
         CASE
           WHEN status='wishlist' THEN 'REJECT (no payment control)'
           WHEN status='lead'      AND payment_status='unpaid' THEN 'ok'
           WHEN status='pending'   AND payment_status IN ('unpaid','advance_paid') THEN 'ok'
           WHEN status='confirmed' AND payment_status IN ('unpaid','advance_paid','fully_paid') THEN 'ok'
           WHEN status IN ('cancelled','rejected')
                AND payment_status IN ('no_refund','partial_refund','full_refund') THEN 'ok'
           ELSE 'REJECT by PAYMENT_OPTIONS'
         END AS verdict
  FROM registrations GROUP BY status, payment_status
  ORDER BY verdict DESC, status, payment_status
`).all());

// B — money on a status that should not carry any. These stay writable under the
// shipped guard (lead and pending are live), so this is informational.
show('B. money recorded against a non-money status', db.prepare(`
  SELECT status, COALESCE(payment_status,'(null)') AS payment_status,
         COUNT(*) AS n, SUM(amount_paid) AS paid
  FROM registrations
  WHERE COALESCE(amount_paid,0) > 0 AND status IN ('wishlist','lead','pending')
  GROUP BY status, payment_status
`).all());

// C — payment_status disagreeing with the ledger. Refund states are skipped:
// they cannot be re-derived from amount_paid.
show('C. payment_status disagrees with the ledger', db.prepare(`
  SELECT status, COALESCE(payment_status,'(null)') AS stored,
         CASE WHEN COALESCE(amount_paid,0) <= 0 THEN 'unpaid'
              WHEN total_amount > 0 AND amount_paid >= total_amount THEN 'fully_paid'
              ELSE 'advance_paid' END AS derived,
         COUNT(*) AS n
  FROM registrations
  WHERE COALESCE(payment_status,'') NOT IN ('partial_refund','full_refund','no_refund')
  GROUP BY status, stored, derived HAVING stored <> derived
`).all());

// D — Confirm needs a trip price, in the admin UI and on a Telegram button
// alike. Rows in `no_total` get no Confirm button, by design.
show('D. rows Confirm would refuse for want of a trip price', db.prepare(`
  SELECT status, COUNT(*) AS n,
         SUM(CASE WHEN COALESCE(total_amount,0) > 0 THEN 1 ELSE 0 END) AS has_total,
         SUM(CASE WHEN COALESCE(total_amount,0) <= 0 THEN 1 ELSE 0 END) AS no_total
  FROM registrations WHERE status IN ('lead','pending') GROUP BY status
`).all());

const { n } = db.prepare('SELECT COUNT(*) AS n FROM registrations').get();
console.log(`\n${n} registration(s) examined.`);
db.close();
