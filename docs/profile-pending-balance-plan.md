# Profile: surface the pending amount, stop pushing confirmed travellers back into booking

## Context

On `/profile`, a traveller with money still owed cannot see it, and the loudest control on
every card sends them into the sales funnel for a trip they have already booked.

Two distinct defects, from the screenshot and confirmed in code:

1. **The pending amount is computed and then hidden.** `profileTrips.ts:191` already derives
   `balance = max(0, total_amount − amount_paid)`, and `ProfileTripCard.astro:35` renders it as
   "Remaining balance" — but only inside the collapsed `<details>` labelled "Booking and
   traveller details". The summary row shows a grey `Advance paid` chip and no number. The
   payment chip has no per-status colour on this card either (`.badge` base at
   `ProfileTripCard.astro:41` is always muted), so "Unpaid" and "Fully paid" render identically.

2. **"View trip" is a filled button that re-enters the booking flow.** For a `confirmed`
   booking, `ProfileTripCard.astro:8` links to `/trips/{slug}/`, which renders the full sales
   `BookingPanel` (`[slug].astro:642`) plus a fixed mobile sticky "Book now" bar
   (`[slug].astro:741-745`) — with no knowledge that the viewer already holds a booking. It gets
   the same `.card-action` filled treatment as the genuinely actionable "Continue booking", so
   the passive link outranks the money action.

   Worse than cosmetic: that sticky bar links to `/trips/{slug}/book` with **no `?batch=`**, and
   `book.astro:35-37` then picks the *first non-sold-out* departure. A traveller confirmed on
   batch B lands in a fresh registration flow for batch A.

Intended outcome: the profile card tells a traveller exactly what they owe and by when, gives
them a way to pay it, and demotes "view trip" to a quiet link that no longer dumps a confirmed
traveller onto a sales page.

### Decisions taken (confirmed with the user)

- Show **amount + due date** on the card, with an overdue treatment.
- **Demote the link *and* suppress the booking panel** on `/trips/[slug]` for someone already booked.
- "Pay balance" **shows UPI / bank details and accepts an optional screenshot**, mirroring the
  booking flow. The upload is **not mandatory**.

### Constraints that shape the design

- **No payment gateway exists.** Payment is manual UPI / bank transfer + a screenshot reviewed by
  hand (`BookingCheckout.tsx:878`, `:1037-1133`). Nothing here can charge a card.
- **`registrations.amount_paid` is a projection over the append-only `payment_events` ledger**
  (`db.ts:370-388`). It is maintained *only* by `paymentLedger.recordPayment()`. A traveller
  submitting a screenshot is a *claim*, not a payment — this change must **never** write
  `amount_paid` or `payment_status`. Admin confirms the money through the existing ledger path.
- `/api/register` cannot be reused: it forces `status='pending'`, overwrites
  `payment_screenshot_url`, and early-returns for anyone already confirmed (`register.ts:186-188`).
- `balanceDue.ts` is **deliberately dependency-free** (bundled into the client `BookingCheckout`
  island — see its header comment). Do not add `fs`/`better-sqlite3` to its graph. Pure date
  helpers may be added to it; nothing else.
- A `null` or `<= 0` `total_amount` must render as *unknown*, never as "₹0 pending" or "fully
  paid". `receivables.ts:150-152` makes exactly this point ("never fall back to the current offer
  price — that invents a debt nobody owes").
- **Public profiles stay safe for free.** `shapePublicTrips()` (`profileTrips.ts:254-267`) is an
  explicit allow-list mapping five named fields, so new fields on `ProfileTripRecord` cannot leak
  onto `/u/[username]`. Do not change that function; confirm the allow-list shape still holds
  after editing the interface.

### Phasing

**Phase 1 is display-only and ships alone**: no schema change, no new route, no new endpoint. It
fixes everything that was actually reported. **Phase 2** adds the payment-claim feature. Keeping a
migration and a public POST endpoint out of a UI change is the point of the split.

In Phase 1, "Pay balance" points at the existing WhatsApp support link prefilled with the trip
name and amount — an **interim**, replaced in Phase 2 by `/profile/pay/{id}`. Flagged so the
weaker CTA is a deliberate staging choice, not a quiet downgrade of the decision above.

---

# Phase 1 — show the money, fix the hierarchy

### 1.1 Share the overdue maths instead of copying it

**`src/lib/balanceDue.ts`** (dependency-free — keep it that way) — add two pure helpers:

- `daysBetweenDates(fromKey: string, toKey: string): number` — lift the local `daysBetween` from
  `receivables.ts:104-108` verbatim (UTC-parsed `YYYY-MM-DD`).
- `overdueDays({ dueDate, todayKey, createdAt }): number | null` — the clamped calculation
  currently inlined at `receivables.ts:168-176`, including the `created_at` clamp:

  ```ts
  // A "60 days before" rule on a booking made 10 days out is overdue the instant
  // it is created; without this the page would claim 50 days overdue on a
  // three-day-old booking.
  ```

  **This clamp is the whole reason for the extraction.** Computing `daysOverdue` raw would tell a
  traveller who booked three days ago for a trip next week that they are "50 days late" — on the
  exact number meant to create urgency.

**`src/lib/receivables.ts`** — replace `daysBetween` and lines 168-176 with calls to the new
helpers. **Behaviour-preserving refactor**: `tests/unit/receivables.test.ts` must pass
**unchanged**. Do not adjust a receivables assertion to make the refactor fit; if one fails, the
extraction is wrong.

**`src/lib/trips.ts`** — extract the rule read inlined at `:528-531` into
`export function resolveBalanceDueRule(trip): string` (returns `trip.balanceDueRule` when a
non-empty string, else `DEFAULT_BALANCE_RULE`) and call it from `resolveBooking()`. Avoids calling
the much heavier `resolveBooking()` from the profile path while keeping one source of truth.
`tests/unit/resolveBooking.test.ts` must pass unchanged.

### 1.2 Carry the due date onto the profile record

**`src/lib/profileTrips.ts`** — in `resolved()` (`:140-205`), which already loads `safeTrip()` and
the matched `batch`, add to `details`:

- `balanceDueDate: string | null` — `balanceDueDate(indiaDateOnly(batch?.startDate), resolveBalanceDueRule(trip))`,
  reusing `balanceDue.ts:49`. The *same* helper the checkout (`BookingCheckout.tsx:820`) and admin
  receivables (`receivables.ts:161,165`) call, so all three surfaces agree on the date.

  **Use the matched batch's `startDate` only — not the record's `startDate`.** The record's
  `startDate` (`:147`) falls back to `trip_date` and then to `created_at` when no batch matches.
  Feeding that fallback in would invent a due date of "15 days before the day you booked": overdue
  from creation, rendered as "N days late" against a deadline that never existed. Receivables puts
  the same booking in `unlinked` with no date; the traveller surface must agree (no batch → no
  due date, amount only).
- `balanceDueRule: string` — for the "· 15 days before trip" sub-label, matching the checkout's
  `balanceDueText` wording at `BookingCheckout.tsx:821-823`.
- `daysOverdue: number | null` — via the new `overdueDays()`, passing `row.created_at` (already
  selected in `profile.astro:19-25` and present on `ProfileRegistrationRow`) and `todayInIndia()`
  (already in this module, `:119`). Negative/zero = not yet due.

Extend the `ProfileTripRecord` interface (`:39-73`) accordingly.

Also add `balanceActionable: boolean` — true only when
`status === 'confirmed' && balance != null && balance > 0 && period !== 'completed'`. Keeps the "who may pay" rule in the
shaping layer next to the money rather than spread through markup. Deliberately excludes:
- `lead` → already gets "Continue booking" into the advance checkout;
- `pending` → payment is under review; a pay CTA would invite a double payment;
- `cancelled`/`rejected` → settled through the refund path;
- `period === 'completed'` → the trip has run. Receivables treats a post-departure balance as "far
  more often a missing payment record than a real debtor" (`receivables.ts:158-159`); a filled
  "Pay balance · 40 days late" on a finished trip in the traveller's history is the wrong message.
  History cards also omit the "late" label — they may still show the amount.

### 1.3 Rebuild the card summary

**`src/components/ProfileTripCard.astro`**

- Replace the local `money()` (`:4`) with the canonical `formatINR` from `src/lib/utils.ts:76`
  (three copies of this formatter exist today). Keep a `'Not recorded'` null branch for the
  `<details>` grid, which needs it. Amounts are `INTEGER` in SQLite, so `formatINR`'s rounding is
  a no-op here.
- Colour the payment chip with the shared `paymentStatusStyle()` from
  `registrationStatus.ts:204`, as `admin/RegistrationCard.astro:157` already does — so "Unpaid"
  stops looking like "Fully paid". (The status chip's hardcoded `.status-*` classes at `:42`
  duplicate `REG_STATUS_COLORS`; leave that alone, out of scope.)
- When `status` is `confirmed` or `pending` and `balance != null && balance > 0`, render a balance
  row above the CTA (not for a `lead` — their next payment is the advance, and calling the full
  price a "balance" overstates what they owe):

  ```
  ₹24,000 balance
  due by 18 Sept 2026 · 15 days before trip
  ```

  `daysOverdue > 0` → warning glyph and `· N days late`, using the existing
  `--color-warning-surface` / `--color-warning-ink` tokens (`--color-caution-*` for
  due-soon). `balance == null` → render nothing in the summary; the `<details>` grid already says
  "Not recorded". `balanceDueDate == null` (rule doesn't parse) → show the amount and fall back to
  the raw rule text without a date, exactly as `BookingCheckout.tsx:822` does.

- **CTA hierarchy — one filled `.card-action` per card, and it must be the money action:**
  - `balanceActionable` → filled **"Pay balance"**. Phase 1: the WhatsApp link already on
    `profile.astro` (`settings.whatsappLink`), prefilled with trip name + amount. Phase 2 swaps
    the href for `/profile/pay/{record.id}`.
  - `status === 'lead' && bookable` → filled **"Continue booking"** (unchanged)
  - `status === 'wishlist' && tripExists && tripSlug` → filled **"View trip"** (unchanged). For a
    wishlisted trip the trip page *is* the next step, and that viewer holds no booking, so the
    panel still renders for them.
  - otherwise → no filled button
  - For every other status, "View trip" becomes a **quiet text link** ("View trip page") whenever
    `tripExists && tripSlug`, alongside the existing "Booking and traveller details" summary.
  - Build the prefilled WhatsApp href with `URL` / `searchParams.set('text', …)`, not string
    concatenation — `whatsappLink` is editable in settings and may already carry a query.
  - The `supportHref` "Contact support" fallback stays for `pending` / no-slug cases, but as the
    quiet link rather than a filled button.

### 1.4 Make the trip page aware of an existing booking

**`src/pages/trips/[slug].astro`** (already `prerender = false`, already reads `Astro.locals.user`
at `:143`)

- When signed in, look up the viewer's bookings for this trip:
  ```sql
  SELECT id, batch_id, status, total_amount, amount_paid
    FROM registrations
   WHERE lower(trim(email)) = lower(trim(?)) AND trip_slug = ?
     AND status IN ('pending','confirmed')
   ORDER BY created_at DESC
  ```
  Match the `lower(trim(...))` comparison used in `profile.astro:19-25`. The predicate is covered
  by `registrations_email_lower` (`db.ts:155`).

  **Only a booking on a departure that has not ended counts.** Without a date filter, anyone who
  did this trip last year would never see the booking panel again. Resolve each row's `batch_id`
  against `trip.batches` in code and keep the first whose `endDate` (or `startDate`) is
  `>= todayInIndia()`; a row whose batch cannot be matched does not count.

  The "You're booked" card also carries a quiet **"Book another date"** link to
  `?another=1#booking-panel` (the page has no `#dates` anchor — the departure list lives inside
  `BookingPanel`, so the param re-renders the normal panel and sticky bar), so a
  booked traveller can still book a second departure (a friend, a later date) — suppressing the
  panel must not make that impossible.

  *Perf note, given the recent LCP work on this route:* one indexed server-side query, signed-in
  users only, off the critical render path, no new client bytes.

  *Cache note:* this makes the page per-user. That is safe **only** because the middleware
  already sends `private, no-cache` for any request carrying a session cookie
  (`middleware.ts:162-165`), so the CDN never stores a signed-in render. That rule now protects
  booking data on this route, not just the header avatar — do not loosen it.

- Add a third branch to the `showBookingPanel` ternary at `:642`: when a booking exists, render a
  **"You're booked on this departure"** card in place of `<BookingPanel>` — departure dates, the
  payment chip, balance if any, and a link to `/profile?tab=trips`.
- Gate the mobile sticky bar at `:741` on `showBookingPanel && !existingBooking`.

  **Do not touch the observer script at `:804-845`.** It is already null-guarded at both ends —
  `const observer = stickyBar ? … : null` (`:820-828`) and `if (!observer || !stickyBar) return`
  (`:833`) — so when the bar isn't rendered, nothing runs. The `else` branch at `:839` that keeps
  the bar up for a sold-out panel is unreachable in that case and needs no change.

This also closes the wrong-batch hole: a confirmed traveller can no longer reach
`/trips/{slug}/book` without a `?batch=` from this page.

### Phase 1 verification

**Unit** — `npm run test:unit`
- `tests/unit/receivables.test.ts` and `tests/unit/resolveBooking.test.ts` pass **unchanged** (the
  two refactors are behaviour-preserving).
- Extend `tests/unit/balanceDue.test.ts`: `overdueDays()` clamps by `createdAt` — a booking created
  3 days ago against a due date 50 days past returns **3, not 50**; returns `null` for a null due
  date; `<= 0` before the due date. Existing anchored-regex assertions stay untouched.
- Extend `tests/unit/profileTrips.test.ts`: due date for a `"15 days before trip"` rule;
  `balance == null` when `total_amount` is null or `0` (must not become `₹0`);
  `balanceDueDate == null` when the rule doesn't parse; **`balanceDueDate == null` when the
  `batch_id` matches no batch** (even though the record's `startDate` falls back to `created_at`);
  `balanceActionable` false for `lead`, `pending`, `cancelled`, and for a `confirmed` booking whose
  trip is `completed`; true for an upcoming `confirmed` with a balance.
- Assert `shapePublicTrips()` still emits exactly its five fields after the interface change.

**Manual** — `npm run dev`, signed in as a user with a `confirmed` + `advance_paid` booking
- Card shows amount + due date; exactly one filled button, reading "Pay balance".
- Set a batch `startDate` in the near past to exercise "N days late" — and set one with a recent
  `created_at` to confirm the clamp holds.
- "View trip page" → **no** `BookingPanel`, **no** sticky "Book now" bar at ≤1024px, "You're
  booked" card renders instead. Check the console is clean (the observer should no-op).
- Regression: a `lead` card still shows "Continue booking" → `/trips/{slug}/book?batch=…`; a
  fully-paid card shows no balance row and no filled button; a wishlist card still shows a filled
  "View trip".
- A user whose only booking on the trip is a **past** departure sees the normal `BookingPanel`.
- The "You're booked" card's "Book another date" link reaches the dates section.

---

# Phase 2 — let them actually pay it

### 2.1 Record the claim, never the money

**`src/lib/db.ts`** — two nullable columns on `registrations`, via the existing `ALTER TABLE`
pattern used for `total_amount` (`:100`) and `amount_refunded` / `payment_status` (`:181-182`):
- `balance_reported_at TEXT`
- `balance_payment_screenshot_url TEXT`

A **separate** column, not a reuse of `payment_screenshot_url` — that holds the advance proof, and
overwriting it would destroy the evidence for the first payment.

**New: `src/pages/api/profile/report-balance-payment.ts`** (sibling of the existing
`settings.ts` / `share-dismiss.ts`)
- POST, auth required, `rateLimit()` from `src/lib/rateLimit.ts` as `/api/upload` does.
- Body: `{ registrationId: number, screenshotUrl?: string }`.
- Re-verify ownership by email and re-check `status === 'confirmed'` and balance `> 0`
  **server-side**. Never trust the page's gating.
- Validate `screenshotUrl` against the same `/api/uploads/<uuid>.(jpg|jpeg|png|pdf)` shape
  `resolveLocalPaymentUpload()` enforces (`telegram.ts:157`) rather than storing an arbitrary string.
- **Idempotency:** `balance_reported_at = COALESCE(balance_reported_at, CURRENT_TIMESTAMP)` so a
  resubmission keeps the original claim date — that date is what tells admin how long someone has
  been waiting. The screenshot URL *does* overwrite.
- Writes **only** those two columns. **Never `amount_paid`, `payment_status`, `status`, or
  `payment_events`.**

### 2.2 The pay-balance page

**New: `src/pages/profile/pay/[id].astro`** (`export const prerender = false`) — under the profile,
so it is unambiguously account surface, not sales surface. `profile.astro` + `profile/pay/[id].astro`
mirrors the existing `trips/[slug].astro` + `trips/[slug]/book.astro`, so the route shape is fine.

- Require `Astro.locals.user`; redirect to `/login` otherwise.
- Load the registration by `id` **and** owner email — a mismatch 404s. Ownership enforced
  server-side, never by the id alone.
- 404/redirect unless `status === 'confirmed'`, `total_amount > 0`, `amount_paid < total_amount`.
- Render trip name + dates, **amount due** (`formatINR`), **due date** with overdue state, then the
  **UPI / bank details** from `readSiteSettings()` — `upiId`, `bankAccountName`,
  `bankAccountNumber`, `bankBranch`, `bankIfsc` — with copy buttons. Mirror the UPI/bank tab
  treatment of `BookingCheckout.tsx:1037-1133`; `profile.astro` already calls `readSiteSettings()`
  and has a working `copyText()` helper to model.
- **Optional** screenshot upload: file input posting to the existing generic `POST /api/upload`
  (`src/pages/api/upload.ts` — takes a `File`, returns `{ url }`, already rate-limited), then a
  submit that posts the returned URL. Submitting **without** a file must succeed — label it
  "Attach a screenshot (optional)".
- Terminal state after submit: "We'll confirm within 24 hours", echoing
  `BookingCheckout.tsx:836,873`.

### 2.3 Close the loop on the traveller's own card

Without this the traveller submits and sees no change — still a filled "Pay balance", inviting a
second payment. That is the same failure `balanceActionable` avoids for `pending`.

- Add `balance_reported_at` to `profile.astro`'s `SELECT` (`:19-25`) and to
  `ProfileRegistrationRow`; carry `balanceReportedAt` onto `ProfileTripRecord`.
- In `ProfileTripCard.astro`, when it is set and the balance is still outstanding, replace the
  filled CTA with a quiet **"Balance payment reported — under review"** chip (same register as
  `travellerStatusLabel`'s "Payment under review"), plus a small text link back to
  `/profile/pay/{id}` to resend.
- Swap the Phase 1 WhatsApp href for `/profile/pay/{record.id}`.

### 2.4 Give admin somewhere to act on it

A claim nobody sees is worse than no claim.

- **`src/components/admin/RegistrationCard.astro`** — show "Balance payment reported <date>" with
  a link to the screenshot when `balance_reported_at` is set and the balance is outstanding. It
  already renders `Balance due` at `:104-106`.
- **`src/pages/admin/finance.astro`** — flag reported rows in the receivables table (`:297-356`).
  Rows already carry `registrationId`; add `balance_reported_at` to the `SELECT` in
  `buildReceivables()` (`receivables.ts:233-240`) and to `ReceivableRow`. A reported-but-unconfirmed
  balance is the top of the collection queue.
- **A "clear report" action.** Recording the payment clears the flag naturally (balance → 0), but a
  mistaken claim would otherwise sit in the finance queue forever. One admin action nulling both
  columns, alongside the existing payment controls in
  `src/pages/admin/registrations/[slug].astro:487-525`.

**Explicitly out of scope:** a Telegram notification for this event. `TelegramEventType` is
`'lead' | 'pending' | 'confirmed'` (`telegram.ts:8`) and the queue table has a
`CHECK(event_type IN (...))` constraint (`db.ts:428`) requiring a table rebuild to extend. Worth
doing — recorded here so it isn't silently dropped.

### Phase 2 verification

**API** — `npm run test:api`. ⚠ Per project memory, a stray dev server holding the DB yields
177/20; a clean run is 197/0. **Stop any running server first.**
- Rejects unauthenticated; rejects another user's `registrationId`; rejects `lead` / `pending` /
  `cancelled` rows; rejects a malformed `screenshotUrl`.
- **Succeeds with no `screenshotUrl`.**
- Asserts `amount_paid`, `payment_status` and `status` are byte-identical before and after.
- A second POST leaves `balance_reported_at` at its original value and updates the screenshot.

**Manual**
- `/profile/pay/{id}` → copy buttons work; submit **without** a screenshot succeeds; submit with one
  lands the URL in `balance_payment_screenshot_url`.
- Return to `/profile` → the card shows "reported — under review", not a filled "Pay balance".
- Confirm in `data/*.db` that `amount_paid` did not move.
- `/admin/finance` and the registration card show the claim; "clear report" nulls both columns and
  removes the flag.
- Another signed-in user hitting `/profile/pay/{that id}` gets a 404.

---

## Critical files

| File | Phase | Change |
|---|---|---|
| `src/lib/balanceDue.ts` | 1 | `daysBetweenDates()`, `overdueDays()` — pure, no new deps |
| `src/lib/receivables.ts` | 1 | call the shared helpers (behaviour-preserving) |
| `src/lib/trips.ts` | 1 | extract `resolveBalanceDueRule()` |
| `src/lib/profileTrips.ts` | 1 | due date / rule / `daysOverdue` / `balanceActionable` on the record |
| `src/components/ProfileTripCard.astro` | 1 · 2 | balance row, CTA hierarchy, demote "View trip", `formatINR`, coloured chip · reported state |
| `src/pages/trips/[slug].astro` | 1 | existing-booking lookup; suppress `BookingPanel` + sticky bar |
| `src/lib/db.ts` | 2 | two nullable columns |
| `src/pages/api/profile/report-balance-payment.ts` | 2 | **new** — records the claim only |
| `src/pages/profile/pay/[id].astro` | 2 | **new** — amount, due date, UPI/bank, optional upload |
| `src/pages/admin/finance.astro`, `admin/RegistrationCard.astro`, `admin/registrations/[slug].astro` | 2 | surface + clear claims |

## Reuse (do not reimplement)

- `balanceDueDate()` / `parseBalanceDueDays()` — `src/lib/balanceDue.ts:33,49`
- `formatINR()` — `src/lib/utils.ts:76`
- `paymentStatusStyle()` / `paymentStatusLabel()` — `src/lib/registrationStatus.ts:191,204`
- `todayInIndia()` / `indiaDateOnly()` — `src/lib/profileTrips.ts:113,98`
- `POST /api/upload` — `src/pages/api/upload.ts` (generic, rate-limited)
- `readSiteSettings()` — UPI/bank fields, as wired at `book.astro:127-131`
- `rateLimit()` — `src/lib/rateLimit.ts`
- UPI/bank markup + copy buttons — `BookingCheckout.tsx:1037-1133`
- `copyText()` inline helper — `profile.astro` script block
