# Runbook — merging `rejected` into `cancelled`, and adding `no_refund`

One-time data migration that runs automatically on first boot after deploy, in
`src/lib/db.ts` beside the other schema migrations. This document records what it
touches, the exact production rows it will change, and how to undo it.

## What the migration does

```sql
-- 1. Stamp the money outcome on terminal bookings that kept the traveller's payment.
UPDATE registrations
   SET payment_status = 'no_refund'
 WHERE status IN ('cancelled', 'rejected')
   AND amount_paid > 0
   AND COALESCE(amount_refunded, 0) <= 0
   AND payment_status NOT IN ('partial_refund', 'full_refund', 'no_refund');

-- 2. Merge the retired status.
UPDATE registrations SET status = 'cancelled' WHERE status = 'rejected';
```

Order matters: (1) runs first so a row arriving from `rejected` is treated the
same as one already `cancelled`. Both are idempotent — a second boot matches
nothing.

### What it does NOT touch

- `amount_paid`, `amount_refunded`, `total_amount` — no money column is written.
- `payment_events` — the ledger is untouched, so every refund and payment keeps
  its history.
- Trips: trip status lives in content YAML, and `bookedSpots` only moves through
  `adjustBookingCount()` on a live transition. No seat counter changes.
- Revenue and analytics: every query already excludes both `rejected` and
  `cancelled`, so moving a row between two excluded statuses changes no figure.
- Rows already at `partial_refund` or `full_refund` — excluded three ways over
  (`amount_paid > 0` fails, `amount_refunded <= 0` fails, and the
  `payment_status NOT IN` guard fails).
- No emails are sent. It is a silent `UPDATE` at boot.

## Production rows affected

Captured read-only from the production volume on 2026-09-03, before deploy.
**Five rows out of 735.**

| id | status before | payment_status before | amount_paid | amount_refunded | becomes |
|----|---------------|----------------------|-------------|-----------------|---------|
| 1 | `rejected` | `unpaid` | 0 | 0 | `cancelled` / `unpaid` |
| 2 | `rejected` | `unpaid` | 0 | 0 | `cancelled` / `unpaid` |
| 3 | `rejected` | `unpaid` | 0 | 0 | `cancelled` / `unpaid` |
| 4 | `rejected` | `unpaid` | 0 | 0 | `cancelled` / `unpaid` |
| 485 | `cancelled` | `advance_paid` | 10000 | 0 | `cancelled` / `no_refund` |

The two genuinely refunded bookings — `#520` (₹43,000) and `#540` (₹10,000) —
are already at `full_refund` and are **not** touched.

## Rollback

Because the affected set is small and its prior state is recorded above, the
undo is literal — a volume restore is not required.

```sql
UPDATE registrations SET status = 'rejected' WHERE id IN (1, 2, 3, 4);
UPDATE registrations SET payment_status = 'advance_paid' WHERE id = 485;
```

Reverting the *data* is not enough on its own: the application code no longer
offers `rejected` as a settable status, so also redeploy the previous build if
you need the old behaviour back.

Verify before and after with:

```sql
SELECT status, payment_status, COUNT(*) n FROM registrations GROUP BY 1, 2 ORDER BY n DESC;
```

Reading production directly:

```
railway ssh "node -e \"const p=(process.env.DATA_DIR||process.cwd()+'/data')+'/seekthethrill.db'; const d=require('better-sqlite3')(p,{readonly:true}); console.log(JSON.stringify(d.prepare('SELECT status,payment_status,COUNT(*) n FROM registrations GROUP BY 1,2 ORDER BY n DESC').all()));\""
```

## Pre-deploy checklist

1. Back up the Railway volume. The migration is small and reversible, but it is
   still an unattended write to production data.
2. Re-run the affected-rows query above — if the counts have drifted from the
   five rows recorded here, re-capture the prior state before deploying, because
   the rollback statements are keyed to specific ids.
3. Deploy. The migration runs on first boot.
4. Confirm: `SELECT COUNT(*) FROM registrations WHERE status='rejected'` returns
   0, and `#520` / `#540` still read `full_refund`.

## Traveller-visible changes

- A registration that was `rejected` now reads **"Cancelled"** on the traveller's
  profile page instead of "Not confirmed" (`profileTrips.ts` label map). No
  notification is sent; it changes quietly the next time they look.
- The decline email is unchanged in *who receives it*: cancelling a booking that
  was never confirmed and paid nothing still sends `registration-rejected`
  ("we're unable to confirm your spot"), and only a real booking — confirmed, or
  with money against it — gets `registration-cancelled` with its refund line.
  Covered by TC-215e and TC-215f.
