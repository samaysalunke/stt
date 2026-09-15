-- Audit: which live rows would a server-side status↔payment_status guard reject?
--
-- Read-only. Locally:
--   sqlite3 "$DATA_DIR/seekthethrill.db" < scripts/audit-payment-matrix.sql
--
-- On a DEPLOYED container use the Node twin instead — Nixpacks Node images ship
-- no sqlite3 binary, so this file has nothing to run it there:
--   railway ssh node scripts/audit-payment-matrix.mjs
--
-- Check A is the one that matters: any row in a REJECT bucket is a row whose
-- *current* payment_status the matrix does not list for its status. The guard
-- must therefore permit a row's existing value and constrain only changes --
-- the same leniency `paymentOptionsFor(status, current)` already applies when
-- rendering the select. A guard written as a plain `PAYMENT_OPTIONS[status]`
-- membership test would make these rows uneditable.

.mode box
.headers on

SELECT '=== A. (status, payment_status) distribution vs PAYMENT_OPTIONS ===' AS check_a;
SELECT
  status,
  COALESCE(payment_status,'(null)')    AS payment_status,
  COUNT(*)                             AS n,
  SUM(COALESCE(amount_paid,0))         AS paid,
  SUM(COALESCE(amount_refunded,0))     AS refunded,
  CASE
    WHEN status='wishlist'                                                               THEN 'REJECT (no payment control)'
    WHEN status='lead'      AND payment_status='unpaid'                                  THEN 'ok'
    WHEN status='pending'   AND payment_status IN ('unpaid','advance_paid')              THEN 'ok'
    WHEN status='confirmed' AND payment_status IN ('unpaid','advance_paid','fully_paid') THEN 'ok'
    WHEN status IN ('cancelled','rejected')
         AND payment_status IN ('no_refund','partial_refund','full_refund')              THEN 'ok'
    ELSE 'REJECT by PAYMENT_OPTIONS'
  END AS verdict
FROM registrations
GROUP BY status, payment_status
ORDER BY verdict DESC, status, payment_status;

SELECT '=== B. money recorded against a non-money status ===' AS check_b;
SELECT status, COALESCE(payment_status,'(null)') AS payment_status,
       COUNT(*) AS n, SUM(amount_paid) AS paid
FROM registrations
WHERE COALESCE(amount_paid,0) > 0 AND status IN ('wishlist','lead','pending')
GROUP BY status, payment_status;

SELECT '=== C. payment_status disagrees with the ledger (refund states skipped) ===' AS check_c;
SELECT status, COALESCE(payment_status,'(null)') AS stored,
       CASE WHEN COALESCE(amount_paid,0) <= 0 THEN 'unpaid'
            WHEN total_amount > 0 AND amount_paid >= total_amount THEN 'fully_paid'
            ELSE 'advance_paid' END AS derived,
       COUNT(*) AS n
FROM registrations
WHERE COALESCE(payment_status,'') NOT IN ('partial_refund','full_refund','no_refund')
GROUP BY status, stored, derived
HAVING stored <> derived;

SELECT '=== D. rows Confirm would refuse for want of a trip price ===' AS check_d;
SELECT status, COUNT(*) AS n,
       SUM(CASE WHEN COALESCE(total_amount,0) > 0 THEN 1 ELSE 0 END) AS has_total,
       SUM(CASE WHEN COALESCE(total_amount,0) <= 0 THEN 1 ELSE 0 END) AS no_total
FROM registrations WHERE status IN ('lead','pending') GROUP BY status;
