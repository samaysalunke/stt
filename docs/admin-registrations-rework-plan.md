# Admin registrations — UI cleanup + status / payment_status / refund rework

## Context

The admin trip-registrations screens (`/admin/registrations/[slug]` list + the inline
"View details" panel in `src/components/admin/RegistrationCard.astro`) have two problems:

1. **Visual / UX defects** — stat-card grid renders 7 cards in a `repeat(6)` CSS grid so Revenue
   is orphaned on its own row; `.payment-badge` has **no CSS rule anywhere** so it paints as a
   hard-edged pink rectangle; the raw departure slug (`south-goa-2026-09-10`) is printed in the
   UI; the "View details" panel is a flat 22-field key/value dump that repeats the row header and
   shows `—` for roughly half its rows; the bulk-action bar is always fully expanded; the Zoho
   accounting block shows raw jargon ("Not issued · failed", "Missing state").

2. **Model gaps vs. how the business runs** — no `cancelled` status, no stored payment status, no
   refund concept. The team needs: auto `lead`/`pending` on signup (already works), an admin
   confirm flow that *forces* a payment status + amount, an invoice attached to the confirmation
   email (Zoho Books is **live in production** and already auto-generates + attaches the PDF), a
   `cancelled` status that frees the seat and can record a refund, and a cancellation email.

Two phases. Phase 1 = presentation only (no API/DB/email), ships and verifies alone.
Phase 2 = data-model + workflow.

## Locked decisions & policy calls

| Topic | Decision |
|---|---|
| Invoice engine | Existing **Zoho Books** pipeline (live in prod). `processZohoDocument` already creates the doc, downloads the PDF, attaches it to the confirmation email. No new PDF generator. |
| Advance invoice content | Append `Trip total ₹X · Advance received ₹Y · Balance due before departure ₹Z` to the advance document's `notes` in `zohoBooks.ts` `createDocument` (Y = the `amount` arg, X = `snapshot.totalAmount` — both already in scope; Z = X−Y). No signature change, no new doc type, zero-balance assertion unchanged, existing "pay balance later → final invoice applies the retainer" flow untouched. Assumes the Zoho retainer template renders the notes block (default; one toggle in Zoho settings otherwise). |
| Payment status | New **stored column** `registrations.payment_status`; authoritative for every admin label, the email `kind`, and the "Balance due" line. |
| Refund tracking | New column `registrations.amount_refunded`; ledger keeps the negative event. |
| `cancelled` | Frees the seat; refund is **optional** and may be supplied **in the same request**; sends a cancellation email that reflects the actual refund. |
| Refund statuses | `partial_refund` / `full_refund` only valid while `status = 'cancelled'`. |
| Recording a refund | Two entry points, one shared `recordRefund()` helper: (a) bundled in the `→ cancelled` request; (b) standalone `payment.ts action:'refund'` for a booking already `cancelled` (no email — the cancellation mail already went; audit records it). |
| `cancelled → confirmed` | **Allowed** (re-instatement). Fresh payment (requestId-scoped key); seat +1 fires (`prev` is `cancelled`, standard `prev≠confirmed` guard); `amount_refunded` reset to 0 (history stays in `payment_events`; audit captures the pre-reset value). |
| `rejected → lead / pending / confirmed` | **Allowed** (undo a mis-reject). `rejected` rows always have `amount_paid = 0`. |
| `confirmed → rejected` | **Blocked.** Voiding a confirmed booking goes through `cancelled`. |
| Reject a screenshot'd booking | **Allowed** while `amount_paid = 0`. Only money blocks a downgrade. |
| Admin create / import of a `confirmed` row | **Derives** `payment_status` from the amount `createRegistration` records (`>= total` → `fully_paid`, else `advance_paid`). The mandatory advance/full **picker applies only to the status-*change*-to-confirmed action** in the detail panel / bulk bar. |
| Bulk confirm | Admin picks advance-vs-full only; **amount computed per row**. A row whose advance/total is already covered by a prior payment is a no-op success (status flips, no new event). A row with no advance configured and nothing paid **fails that row** (2f Pre-flight B). Manual amount = single-row only. |
| Missing `total_amount` on confirm | Confirming `advance_paid`/`fully_paid` requires `total_amount` to be a positive integer → else 400 "Set the trip price on this registration before confirming." |
| No-op confirm & Zoho | A no-op confirm (nothing new to record) does **not** enqueue a Zoho doc. For an older paid booking that lacks one, use the card's existing **Generate document** action (`ensureDocument`). |
| Confirm email | Keep the one branched template (`sendRegistrationPaymentConfirmed`). Happy path: Zoho worker sends it with the PDF. Safety net: if `processZohoDocument` throws on the first attempt during the confirm request, send the no-attachment branded email inline immediately (closes the "silent until the 3rd Zoho failure" gap). |
| Revenue vs `cancelled` | Revenue **excludes `cancelled` from the moment of cancellation**, regardless of any refund (mirrors the existing `rejected` treatment). Explicit finance-policy call. |
| Auth | `update-registration.ts` stays owner/ops only; `trip_lead` cannot confirm/cancel. Unchanged. |
| Concurrency | Unchanged posture. Second concurrent confirm: `recordPayment` trips the existing `nextAmount > total` guard and 400s. A double-submitted cancel is a no-op (the `newStatus !== prevStatus` guard, `update-registration.ts:94`). |
| `wishlist` | Untouched. `wishlist → lead/pending` is the **public** `register.ts` path (a direct SQL UPDATE), not governed by `assertTransition`. |

## Non-goals / accepted limitations

- Refunds do not create Zoho credit notes — manual in Zoho (`docs/zoho-books-rollout.md:29`).
- Legacy rows with `total_amount IS NULL` + a real full payment backfill to `advance_paid`; ops
  corrects individually. Editing `total_amount` from the admin is a later extension (the 400 is the MVP).
- If `update-registration`'s `→ cancelled` crashes after the status write but before `recordRefund`
  (made unlikely by pre-validation), the row is `cancelled` with no refund recorded — recover via
  the standalone `payment.ts action:'refund'`.
- `wishlist` subsystem and the public booking form's happy path are untouched.
- Re-signup after `cancelled` creates a new registration row (same as today's `rejected`).

---

## PHASE 1 — presentation only (no logic change)

Files: `src/pages/admin/registrations/[slug].astro`, `src/components/admin/RegistrationCard.astro`,
`src/pages/admin/registrations.astro` (stat-grid parity only). No API / DB / email / test-logic change.

### List page (`[slug].astro`)

1. **Stat-card grid** — `.stats-grid{grid-template-columns:repeat(6,minmax(0,1fr))}` (line ~197) →
   `repeat(auto-fit,minmax(150px,1fr))`. `border-left:3px solid var(--color-coral)` on the Revenue
   card. **Same change in `registrations.astro:64`** (currently `repeat(7)`) so the index grid
   absorbs the 8th card later. (Phase 1 adds no card.)
2. **`.payment-badge` pink rectangle** — add, in `RegistrationCard.astro <style>`, a rule mirroring
   `.status-badge`: `display:inline-block;padding:.2rem .6rem;border-radius:9999px;font-size:.72rem;font-weight:700`.
3. **Raw slug in departure sub-line** — `[slug].astro:158`: drop the `` ` · ${dep.id}` `` suffix,
   keep only the humanized `dep.status`. `data-departure-id={dep.id}` (line 152) stays.
4. **Badge casing** — `text-transform:capitalize` on `.status-badge`.
5. **`updateStats()` stale-Wishlist bug (pre-existing)** — `[slug].astro:440,443`: add the
   `Wishlist` key to `vals` and `statColors`.
6. **`badgeStyle()` JS (pre-existing)** — `[slug].astro:224` has no `wishlist` branch. Add it.
7. **Bulk bar collapse** — keep "Select all" + "N selected" always visible; wrap the two action
   groups in a container that is `hidden` until `selected.length > 0` (toggle in `selectionUI()`,
   line 414). Add "Status" / "Payment" group labels. No handler/endpoint change.
8. **Screenshot chip on the row** — `RegistrationCard.astro:26`: when `r.payment_screenshot_url`
   is set, render a 📎 "Screenshot" chip beside the status badge.

### Detail panel (`RegistrationCard.astro` lines 37-116)

9. **Regroup the flat field array (lines 42-51) into labelled sub-sections.** Grouping + labelling
   + empty-hiding only. Helper `field(label, value)` returns `null` when the value is `null`,
   `undefined`, `''`, or the literal `—`.
   - **Traveller** — Age, Gender, City, State, Instagram, Emergency name, Emergency phone, Why joining
   - **Trip & payment** — Occupancy, **Trip price** (rename "Total (selected)"), Amount paid,
     **Balance due** — `r.total_amount != null ? formatINR(Math.max(0, r.total_amount − r.amount_paid)) : null`
   - **Attribution** — collapsed `<details>`, only if any value present: First/Latest touch,
     First/Latest landing page, **Departure ref** (rename "Batch ID")
10. **Remove ONLY the unconditional header dupes from the grid** — Full Name, Email, Phone. Keep
    Applied / Updated / Amount paid / Occupancy (the summary row hides "Amount paid" for
    `status==='wishlist'`). Status-aware dedup deferred to Phase 2.
11. **Payment screenshot** — inline lazy `<img style="max-height:120px;border-radius:8px">` inside
    the existing link, replacing the bare text link (line 53).
12. **Zoho block (lines 94-109)** — visual tidy only: compact line per document, humanized status
    words, keep Retry / Refresh / Open-in-Zoho.

### Phase 1 verification

- `npm run dev` → `/admin/registrations/<active-slug>`: cards flow, Revenue accented; badge is a
  pill; no slug in the sub-line; expanded row → 3 labelled sections, no `—` spam, no repeats, no
  `₹NaN`; screenshot row shows chip + thumbnail; bulk controls hidden until selection; wishlist row
  still shows its dates.
- `npm run test:unit && npm run test:api` stay green.

---

## PHASE 2 — status, payment_status, refunds, cancelled, invoice/email

### 2a. Transition matrix — authoritative; encode in `registrationStatus.ts` as `TRANSITIONS` + `assertTransition(from, to, ctx)`

`ctx = { amountPaid, totalAmount, requestedPaymentStatus }` — `requestedPaymentStatus` is the
target from `body.payment_status`; `amountPaid`/`totalAmount` are the current row's. Governs the
**admin** endpoint only. Anything not listed → 400.

| from | to | guard | effects |
|---|---|---|---|
| lead / pending | confirmed | `requestedPaymentStatus ∈ {advance_paid, fully_paid}`; `totalAmount > 0` | seat +1 (if `prev≠confirmed`); resolve amount (2f); record payment or legit no-op; `documentType` per status; Zoho worker issues + emails PDF; set `payment_status` |
| lead / pending | rejected | `amountPaid = 0` | `payment_status='unpaid'`; rejected email |
| lead ↔ pending | either way | `amountPaid = 0` | `payment_status='unpaid'`; no email |
| rejected | lead / pending | — | `payment_status='unpaid'`; no email |
| rejected | confirmed | as "lead/pending → confirmed" | " |
| confirmed | cancelled | — | seat −1; optional bundled refund (2f); cancellation email w/ real refund info |
| pending | cancelled | — | no seat change; optional bundled refund; cancellation email |
| cancelled | confirmed | `requestedPaymentStatus ∈ {advance_paid, fully_paid}`; `totalAmount > 0` | seat +1; **fresh** payment event; `amount_refunded → 0`; branded email (plain if the invoice doc is already `emailed`) |
| cancelled | lead / pending / rejected | blocked | "Re-instate via Confirm, or leave cancelled." |
| confirmed | rejected | blocked | "Use Cancel to void a confirmed booking." |
| lead | cancelled | blocked | "Use Reject for a lead that won't proceed." |
| any | same status | no-op | — |
| * | lead / pending / rejected while `amountPaid > 0` | blocked | "Cancel and record any refund first." |

### 2b. Schema (`src/lib/db.ts`, migration block, same `try{ db.exec('ALTER …') }catch{}` idiom)

```
ALTER TABLE registrations ADD COLUMN payment_status TEXT DEFAULT 'unpaid';
ALTER TABLE registrations ADD COLUMN amount_refunded INTEGER DEFAULT 0;
```
Backfill (idempotent, guarded, immediately after):
```
UPDATE registrations
   SET payment_status = CASE
     WHEN amount_paid <= 0 THEN 'unpaid'
     WHEN total_amount IS NOT NULL AND total_amount > 0 AND amount_paid >= total_amount THEN 'fully_paid'
     ELSE 'advance_paid' END
 WHERE amount_paid > 0 AND payment_status = 'unpaid';
```
No CHECK constraint (SQLite cannot add one to `registrations`; `status` has none today). `payment_events`
**reuses `event_type='reversal'`** for refunds → no CHECK migration there.

### 2c. Single source of truth — new `src/lib/registrationStatus.ts`

- `REG_STATUSES`, `ADMIN_SETTABLE_STATUSES = ['lead','pending','confirmed','rejected','cancelled']`
- `PAYMENT_STATUSES = ['unpaid','advance_paid','fully_paid','partial_refund','full_refund']`
- `REFUND_PAYMENT_STATUSES = ['partial_refund','full_refund']`
- `TRANSITIONS` + `assertTransition(from, to, { amountPaid, totalAmount, requestedPaymentStatus })`
- `REG_STATUS_COLORS` / `PAYMENT_STATUS_COLORS` + `regStatusStyle()` / `paymentStatusLabel()`.
  `regStatusStyle()` **moved here from `utils.ts:75`**, gains `cancelled` (slate). `[slug].astro`
  client `<script>` gets `REG_STATUS_COLORS` via `define:vars`; its `badgeStyle()` (line 224)
  becomes a **map lookup**, deleting the parallel hardcoded colour fn so server/client cannot drift.
- `derivePaymentStatus(reg)` — backfill helper + **`import.meta.env.DEV`-guarded** post-write
  assertion (`console.warn` on mismatch; skipped when the stored value is a refund state).

`payment_status` (stored) is authoritative for every admin label, the email `kind`, and the
"Balance due" line. `paymentState()` in `src/lib/payment.ts` is **effectively retired** — deleted
from `RegistrationCard.astro:9-10`; kept only because `payment.ts` still returns `state` in
`results[]` (API back-compat, TC-215) and its unit test covers the pure fn.

Every writer sets `payment_status` in the same `UPDATE` that moves `amount_paid`:
`update-registration.ts`, `registrations/payment.ts`, and `registrationWrite.ts`
`createRegistration` — which sets it **after** its confirmed-path `recordPayment`, deriving
`fully_paid` vs `advance_paid` from the recorded amount vs `input.total_amount` (`unpaid` for a
non-confirmed create).

### 2d. `recordRefund()` — shared helper (in `src/lib/paymentLedger.ts`)

`recordRefund({ registrationId, amount, refundKind: 'partial'|'full', receivedAt, method, transactionReference, requestId, actorUserId, actorEmail })`:

- Loads the row; **throws** unless `status === 'cancelled'`.
- `full`: `amount` must equal current `amount_paid`. `partial`: `0 < amount < amount_paid`. Else throw.
- One call: `recordPayment({ amount: -amount, eventType: 'reversal', refund: true,
  setPaymentStatus: refundKind === 'full' ? 'full_refund' : 'partial_refund',
  idempotencyKey: `admin-refund:${requestId}:${registrationId}`, documentType: undefined })`.
  `recordPayment` writes the `payment_status` column **inside its own existing immediate
  transaction** (2e), so the ledger event, `amount_paid`, `amount_refunded`, and `payment_status`
  all commit atomically — no nested/savepoint transaction needed.
- Audit `booking.payment_refunded`, `previousValue`/`newValue` = `{ amount_paid, amount_refunded, payment_status }`.
- Returns `{ amountPaid, amountRefunded, paymentStatus, duplicate }`. On `duplicate` (same
  `requestId` replay) it still re-applies the `payment_status` UPDATE (idempotent) and skips the email.

Callers: `update-registration.ts` `→ cancelled` (bundled) and `payment.ts action:'refund'` (standalone).

### 2e. `recordPayment` (`src/lib/paymentLedger.ts`)

- `PaymentInput` gains `refund?: boolean` and `setPaymentStatus?: PaymentStatus`. Both are applied
  **inside the existing `db.transaction(…).immediate()`** (line 84-128): when `refund`, the
  `UPDATE registrations …` (line 118) also does `amount_refunded = amount_refunded + <abs(amount)>`;
  when `setPaymentStatus` is present, the same `UPDATE` also sets `payment_status = ?`. So the
  ledger row, `amount_paid`, `amount_refunded`, and `payment_status` are one atomic write — every
  caller (`update-registration.ts` confirm, `payment.ts` all branches, `recordRefund`) passes
  `setPaymentStatus` and needs no separate `UPDATE` or wrapping transaction. Bulk "unpaid"
  reversal passes `setPaymentStatus:'unpaid'`, not `refund`.
- On the idempotency-duplicate short-circuit (line 87-94), still apply `setPaymentStatus` if given
  (a cheap idempotent `UPDATE`) so a replayed request converges the column.
- `nextAmount < 0` guard (line 102) blocks over-refund; `full_refund` → `nextAmount = 0` OK.
- **Request-scoped idempotency keys everywhere**: `update-registration.ts` confirm changes the
  fixed `registration-confirmed:${id}` → `registration-confirm:${requestId}:${id}`; the client
  confirm + bulk handlers send `requestId = crypto.randomUUID()`. Fixes
  confirm → cancel → re-confirm recording nothing.

### 2f. Status-change API (`src/pages/api/admin/update-registration.ts`)

- Import `ADMIN_SETTABLE_STATUSES` + `assertTransition`; replace `VALID_STATUSES` + the ad-hoc
  `if` checks with `assertTransition(prevStatus, newStatus, { amountPaid, totalAmount, requestedPaymentStatus })`.
- Read `body.payment_status`, `body.amount`, `body.requestId`, `body.receivedAt/method/transactionReference`,
  and optional `body.refund = { kind, amount, receivedAt?, method?, transactionReference? }` (only
  honoured on `→ cancelled`).
- **All validation is pre-flight (before any DB write):** the confirm guards below, and — when
  `newStatus === 'cancelled'` and `body.refund` is present — validate `refund.kind` and
  `refund.amount` against the current `amount_paid` (`full` == `amount_paid`; `partial` in
  `1 .. amount_paid−1`), else 400.
- `→ confirmed` (from lead / pending / rejected / cancelled):
  - `payment_status` must be `advance_paid` | `fully_paid` (else 400).
  - Compute `configuredAdvance = tripAdvanceAmountBySlug(slug)` once.
  - **Pre-flight A** — `total_amount` a positive integer, else 400 "Set the trip price … before confirming."
  - **Pre-flight B** — `advance_paid` with `configuredAdvance <= 0` **and** `amount_paid === 0` →
    400 "This trip has no advance amount configured — set paymentAmount, or record a custom amount."
  - Amount: `fully_paid` → `total_amount − amount_paid`; `advance_paid` → `min(configuredAdvance, total) − amount_paid`;
    single-row `body.amount` override: `fully_paid` must equal the computed remaining (or 400),
    `advance_paid` allowed in `1 .. (total − amount_paid)`.
  - **Resolved amount `0` → legit no-op** (already covered by prior payments): skip `recordPayment`,
    set `status` + `payment_status`. Applies to **both** `advance_paid` (advance already paid) and
    `fully_paid` (`amount_paid >= total_amount`). Pre-flight B already rejects the "0 because no
    config" case.
  - Else `recordPayment({ …, documentType: payment_status==='fully_paid' ? 'final' : 'advance',
    idempotencyKey:`registration-confirm:${requestId}:${id}` })` → enqueues the Zoho doc + fires
    `processZohoDocument`. **If that throws synchronously** (e.g. "Missing state"), send
    `sendRegistrationPaymentConfirmed` **inline, no attachment**, immediately.
  - `recordPayment` carries `setPaymentStatus: <advance_paid|fully_paid>` so the column commits
    with the ledger row (2e). The `status` (+ `amount_refunded = 0` on `cancelled → confirmed`)
    `UPDATE` is a separate statement; on a mid-way crash the row would be non-`confirmed` with the
    payment already recorded — the same request replayed converges it (idempotency-duplicate path
    re-applies `setPaymentStatus`, then the `status` UPDATE runs). No wrapping transaction needed.
  - On the **no-op** branch (resolved amount 0), `recordPayment` isn't called — set `status` +
    `payment_status` in one direct `UPDATE`.
  - Seat +1 only when `prevStatus !== 'confirmed'`.
- `→ cancelled`:
  - Seat −1 via the existing `prevStatus==='confirmed' && newStatus!=='confirmed'` branch.
  - `UPDATE … SET status='cancelled', status_changed_at=…`.
  - If `body.refund` present → `recordRefund({ …, requestId })` (already pre-validated).
  - `sendRegistrationCancelled({ …, refundKind: body.refund?.kind ?? 'none', refundAmount: body.refund?.amount ?? 0 })`
    — after the refund is recorded, so the email carries the real numbers.
- Audit: `previousValue` extended to `{ status, payment_status, amount_paid, amount_refunded }`;
  `newValue.payment` → `{ payment_status, amount_paid, amount_refunded }`.

### 2g. Payment endpoint (`src/pages/api/admin/registrations/payment.ts`)

- Add `action:'refund'` (`['record','unpaid','advance','full','refund']`). Handle it in its **own
  branch, before** the `advance`/`isAdvance`/`isFull` math, and add `refund` to the
  `!['unpaid','refund'].includes(action)` exception on the `total_amount` "Valid total amount is
  required" check (line 40). The branch just calls `recordRefund({ registrationId:id, amount,
  refundKind: body.refundKind, receivedAt, method, transactionReference, requestId,
  actorUserId, actorEmail })`. **No cancellation email** (already sent). Row must be `cancelled`
  (enforced inside `recordRefund`).
- Every other branch passes `setPaymentStatus` to `recordPayment` (2e): `advance`/`record`
  landing below total → `advance_paid`; `full`/balance where `nextAmount === total` → `fully_paid`;
  `unpaid` → `unpaid`.
- Keep returning `state` (derived) in `results[]` for API back-compat; add `payment_status` alongside.
- The disabled-mode inline email branch (lines 70-82) stays behind its `zohoMode()==='disabled'`
  guard as a local/dev safety net.

### 2h. Card admin actions (`src/components/admin/RegistrationCard.astro` + `[slug].astro` bulk)

- Per-row status buttons (`RegistrationCard.astro:59`): add `cancelled`; **no `wishlist`**. Disable
  targets `assertTransition` rejects for the current row (server passes the allowed set; the API
  still 400s + toasts as a backstop).
- Payment badge: from stored `r.payment_status` via `paymentStatusLabel` + `PAYMENT_STATUS_COLORS`.
- Confirm `<details>` (lines 61-78): kind `<select>` **required**, options `advance_paid` /
  `fully_paid` only (drop `custom` / `none`). Amount editable for `advance_paid`, read-only
  (= remaining) for `fully_paid`. POST → `{ status:'confirmed', payment_status:<value>, amount?, receivedAt, method, transactionReference, requestId }`.
- **Cancel `<details>`** (shown while `status ∈ {pending,confirmed}` — a `lead` is Rejected, not
  cancelled): `refundKind` (`none` / `partial` / `full`) + amount (shown & required only when not
  `none`) + date + method + reference. The refund fields are hidden entirely when
  `r.amount_paid = 0` (nothing to refund — e.g. cancelling a `pending`). Submit → **one** POST to
  `update-registration`:
  `{ status:'cancelled', requestId, refund: refundKind==='none' ? undefined : { kind:refundKind, amount, receivedAt, method, transactionReference } }`.
- **"Record refund" `<details>`** (shown while `status==='cancelled'` and `payment_status ∉ REFUND_PAYMENT_STATUSES`):
  same fields, POST → `registrations/payment { action:'refund', refundKind, amount, receivedAt, method, transactionReference, requestId }`.
- Show `Refunded ₹Y` beside `Amount paid` when `amount_refunded > 0`.
- Zoho block: when `last_error` matches `/state|billing name/i`, replace the raw text with
  "Add the traveller's state, then Retry" + an inline `state` input wired to 2j.
- **Bulk bar** (`[slug].astro`): `#bulk-confirm-kind` (line 139) option values →
  `advance_paid` / `fully_paid`; `#apply-bulk-status` (514-535) sends, per `confirmed` row,
  `{ status:'confirmed', payment_status:<#bulk-confirm-kind value>, requestId:<uuid per row> }`,
  **no `amount`**; a row failing a pre-flight is reported in the per-row results without aborting.

### 2i. Advance-invoice content (`src/lib/zohoBooks.ts` `createDocument`, lines 106-127)

For `type === 'advance'` only, put the balance line in **both** the `notes` string **and** the
`line_items[0].description` (`createDocument` already sets both fields; Zoho's default retainer
template renders at least one):
`Trip total: ₹{snapshot.totalAmount} · Advance received: ₹{amount} · Balance due before departure: ₹{snapshot.totalAmount - amount}`.
No signature change. `type === 'final'` unchanged.

**Contingency** — if a spot-check shows the retainer PDF renders neither field, switch the
`advance_paid` path to `documentType: 'final'` and change the final-path zero-balance assertion
(`Math.abs(invoice.balance) <= 0.01`) to `Math.abs(invoice.balance - (totalAmount - amountPaidSoFar)) <= 0.01`.
One document type, the invoice PDF then always shows price / paid / balance. Kept as a fallback,
not the default, because it touches the assertion and the retainer→final application flow.

### 2j. Demographic patch endpoint (`state` fix)

New `PATCH /api/admin/registrations/fields` (owner/ops): `{ id, patch:{ state?, city?, pincode? } }`,
whitelisted keys, trim + length-cap, `UPDATE registrations SET … updated_at=CURRENT_TIMESTAMP`,
audit `booking.fields_patched`. Wired from the card's inline `state` input. ~40 lines + one test.

### 2k. Blast radius — treat `cancelled` like `rejected` (excluded from revenue, own count)

- `src/lib/registrationsView.ts`: `RegStats` interface (33) + `regStats()` (53) add `cancelled`;
  `RegistrationsView.totals` follows; revenue filter (~167) →
  `status NOT IN ('rejected','wishlist','cancelled')`.
- `[slug].astro`: revenue filters (32, 49); `depStatsMap`/`allDepStats` literals (46-53); stat-card
  array (75); `updateStats` `vals`/`statColors` (443/440); `badgeStyle()` (224, map lookup);
  `#filter-status` `<option>`s (122) → **add `cancelled`, keep `wishlist`**; `#bulk-status`
  `<option>`s (138) → **add `cancelled`, no `wishlist`**; per-departure summary badges (163-167).
- `src/pages/admin/registrations.astro`: stat grid (8th card flows via Phase-1 auto-fit) +
  per-card badges.
- `src/pages/admin/index.astro`: `paidRegs` / revenue filters (10-15).
- `src/lib/analytics/{tools.ts,prompt.ts,schema.ts}`: every "≠ rejected" revenue rule →
  "NOT IN ('rejected','cancelled')"; add `payment_status`, `amount_refunded` to
  `REGISTRATION_ALLOWED` + the schema description text.
- `src/pages/api/admin/export.ts`: add a `cancelled` bucket to the customers-CSV sums.
- **`src/components/BookingCheckout.tsx`**: status prop type (43) add `'cancelled'`; resume path
  (420-424) shows "this booking was cancelled — start a new registration"; e2e case added.
- `src/lib/stats.ts`, `src/lib/adminDashboard.ts`, `scripts/reconcile-booked.mjs`: filter
  `status='confirmed'` → `cancelled` auto-excluded; leaderboard recalc already fires on
  `prevStatus==='confirmed'` transitions. **Verify, no change expected.**
- `create.ts` / `import.ts` status lists unchanged; both run through `createRegistration`, which
  now derives `payment_status` for `confirmed` rows.
- `findOrCreateLead` (`register.ts:32-38`) — re-signup after `cancelled` creates a new row. Accepted.

### 2l. Emails (`src/lib/emailTemplates.ts` + `src/lib/email.ts` barrel)

- **New** `sendRegistrationCancelled({ full_name, email, trip_name, trip_date?, refundKind, refundAmount })`
  — subject `Booking Cancelled — <trip> | Seek the Thrill`; body: cancellation confirmation +
  refund line (`₹X refunded` / `Partial refund of ₹X processed` / `No refund is due per the
  cancellation policy`); `trip_date` optional. Template id `registration-cancelled`. Add
  `'registration-cancelled': 'Booking cancelled'` to `templateLabels` in `email-logs.astro:92`.
- `sendRegistrationPaymentConfirmed` unchanged — caller passes
  `kind: payment_status === 'fully_paid' ? 'full' : 'advance'`.
- `sendRegistrationPaymentPending` (lead) / `sendRegistrationPaymentReceived` (image attached) —
  **no change**; already fire correctly in `register.ts` (204, 272).

### 2m. Tests

- `tests/api/registration-status.test.mjs`: confirm without `payment_status` → 400; confirm
  `advance_paid` on a trip with a configured advance → `status='confirmed'`,
  `payment_status='advance_paid'`, `amount_paid>0`, `payment_events` row exists; confirm
  `advance_paid` on a trip with no `paymentAmount` and nothing paid → 400; confirm with
  `total_amount` NULL → 400; `fully_paid` on an already-fully-paid row → `confirmed` +
  `payment_status='fully_paid'` with **no new** `payment_events` row; `fully_paid` with a wrong
  `amount` override → 400; confirmed → `lead` while paid → 400; confirmed → `rejected` → 400;
  `rejected → confirmed` → 200; confirmed → `cancelled` (no refund) → `bookedSpots` −1,
  `payment_status` unchanged, cancellation email logged with "No refund"; confirmed → `cancelled`
  **with** `refund:{kind:'full',amount:<paid>}` → `amount_paid=0`, `amount_refunded=<paid>`,
  `payment_status='full_refund'`, cancellation email logged with "₹X refunded"; `cancelled →
  confirmed` → **fresh** event id, seat back to +1, `amount_refunded` reset to 0.
- New `tests/api/registration-refund.test.mjs` (**add `registration-refund` to the `TEST_FILES`
  array in `tests/run.mjs`** or it won't run): standalone `action:'refund'` on a non-cancelled row
  → fail; on a cancelled row with `total_amount` NULL → works; duplicate `requestId` →
  `duplicate:true`, no double-decrement; `partial` with `amount >= amount_paid` → 400.
- `tests/api/admin-registrations.test.mjs`: **TC-202** → assert `payment_status==='advance_paid'`;
  **TC-211 / TC-212** (import `confirmed` rows) → assert derived `payment_status`; **TC-215** →
  confirm call passes `payment_status`, assert the column value **and** `results[0].state` present.
- `tests/unit/payment.test.ts`: keep `paymentState`; add `paymentStatusLabel` + one
  `assertTransition` case per matrix cell.
- `tests/unit/paymentLedger.test.ts`: `refund:true` bumps `amount_refunded`; plain `reversal` does
  not; `setPaymentStatus` writes the column in the same transaction and is re-applied on an
  idempotency-duplicate replay; `recordRefund` throws on a non-cancelled row; `full` refund must
  equal `amount_paid`.
- `tests/unit/analytics.test.ts`: add a `cancelled` fixture; assert revenue + lead/confirmed
  aggregations exclude it.
- `tests/e2e/registration.spec.ts`: returning traveller with a `cancelled` reg sees the
  "start a new registration" state.
- Grep `tests/` for `regStats(` / `RegStats` — update any exact-shape assertion for the `cancelled` key.

### Phase 2 verification

- Fresh `npm run dev` (migration auto-runs on first `getDb()`); `sqlite3 data/seekthethrill.db
  '.schema registrations'` shows the two new columns; spot-check backfill on an `advance_paid` row
  and a `fully_paid` one.
- UI end-to-end: signup w/o screenshot → `lead` + "complete payment" email; resume + screenshot →
  `pending` + "received" email. Confirm `advance_paid` → row `confirmed` /
  `payment_status=advance_paid`, `invoice_documents` `queued→emailed`, traveller email carries the
  Zoho PDF whose notes read "Trip total … · Advance received … · Balance due …". Confirm another
  `fully_paid` → final invoice, "paid in full". Force "Missing state" → customer still got an
  inline confirmation; card shows the hint + inline `state` field; patch → Retry → `emailed`.
  Cancel a confirmed row **with a full refund in the same dialog** → seat −1, `amount_refunded`
  set, `payment_status=full_refund`, cancellation email says "₹X refunded". Cancel another with no
  refund → email says "No refund is due"; later use "Record refund" on that cancelled row →
  `payment_status` updates, no second email. `cancelled → lead` → 400. `cancelled → confirmed` →
  new payment event, seat back, `amount_refunded` 0. `rejected → confirmed` → works.
- Bulk: 3 rows of different prices → `advance_paid` → each records that trip's configured advance;
  an already-covered row flips with no new event; a no-advance-configured row reports a per-row
  failure; 2 rows → `fully_paid` → each records its own `total − paid`; a capacity-full row reports
  a per-row failure without aborting.
- `npm run test` (unit + api + e2e) green.

## Rollout

1. Ship Phase 1; verify visually + green unit/api tests.
2. Ship Phase 2 as one release. Schema changes are additive; rows backfilled; no destructive
   migration; `payment_events` structurally unchanged. The migration runs on boot; old serialized
   code paths keep working (they ignore the new columns) until the new build is live.
