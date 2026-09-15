# Telegram two-way booking actions — plan

## Context

`src/lib/telegram.ts` is one-way: a booking entering `lead` / `pending` /
`confirmed` enqueues a row in `telegram_notification_events` and a worker posts
it to the ops group. Nothing comes back.

The ask: let ops change **booking status** and **payment status** from the group
message itself, one tap, without opening the admin UI.

## What the codebase makes hard (verified 2026-09-15)

Four findings that shape the design. The first two are pre-existing defects that
this feature forces into the open rather than creates.

**1. The status↔payment matrix is enforced only in the browser.**
`/api/admin/registrations/payment` checks the actor's role and nothing else — it
never reads `registrations.status`. The sole guard is `planUpdate` in
`src/pages/admin/registrations/[slug].astro:455`, whose own comment says so:

> the payment endpoint does not check status itself

A Telegram button hitting that endpoint bypasses the only thing standing between
"Fully paid" and a cancelled booking.

**2. The status write has no compare-and-swap.**
`src/pages/api/admin/update-registration.ts:46` reads the row, runs
`assertTransition` against that snapshot, then writes in a *later* transaction.
One operator behind a confirm dialog rarely races. A group chat where several ops
see the same new-booking ping is the opposite: two taps on `Confirm` both pass
the guard, both call `adjustBookingCount(+1)` (a seat double-counted in the trip
YAML) and both call `recordPayment` under different `requestId`s, so the
idempotency key does not collapse them. `claimOne` in `src/lib/telegram.ts:170`
already demonstrates the fix this file needs.

**3. Two endpoints, three idempotency namespaces.** Status transitions go to
`update-registration` (`registration-confirm:<requestId>:<id>`); payment-only
moves and standalone refunds go to `registrations/payment`
(`admin-payment:…`, `admin-refund:…`). Any Telegram-side `requestId` has to flow
into whichever one the action resolves to.

**4. The admin page script cannot import shared code.** It is
`<script define:vars={…}>`, which Astro renders `is:inline` — confirmed in the
build output, where `planUpdate` appears as a raw string inside the server
module. That is why `PAYMENT_OPTIONS`, `REG_STATUS_COLORS` and friends are
threaded through `define:vars` rather than imported. Any plan that says "browser
and server share one planner module" is wrong unless it first de-inlines a
~400-line script. This plan does not.

## Audit result — and what it changed

`scripts/audit-payment-matrix.sql`, run against the visual-test fixture (the dev
DB holds zero registrations; **check A must be re-run against production before
Phase 0 ships**). Even 8 synthetic rows produce two rejections:

| status | payment_status | n | verdict |
|---|---|---|---|
| `rejected` | `unpaid` | 1 | REJECT by PAYMENT_OPTIONS |
| `wishlist` | `unpaid` | 1 | REJECT (no payment control) |

Neither is bad data. `PAYMENT_OPTIONS.wishlist` is `[]`, so *every* wishlist row
fails a membership test — including the `unpaid` that is the only sane value for
it. `PAYMENT_OPTIONS.rejected` lists only refund states, so a legacy declined
lead carrying `unpaid` fails too.

**So the guard cannot be a `PAYMENT_OPTIONS[status].includes(target)` membership
test** — it would reject rows on their own current value.

The first implementation nonetheless tried a lenient version of exactly that
(permit the current value, constrain changes). The API suite killed it:

- **TC-215** (`tests/api/admin-registrations.test.mjs:241`) pays a `pending`
  booking in full and *then* confirms it, asserting `fully_paid` — but
  `PAYMENT_OPTIONS.pending` is `['unpaid','advance_paid']`.
- `registration-refund.test.mjs:39` asserts the refusal message for a refund on
  a live row matches `/cancelled/i`; a matrix guard fired first with different
  wording.

Two independent sources now say the same thing: **`PAYMENT_OPTIONS` describes
what the select offers, not what the system permits.** It is not an
authorization rule and must not be used as one.

The invariant that actually has to hold is narrower — *money moves only on live
bookings*:

```
lead | pending | confirmed   → payments may be recorded or reversed
cancelled | rejected         → settle through the refund path
wishlist                     → no money at all
```

That is `assertPaymentActionAllowed(status)`, and refunds keep their existing,
better-worded check inside `recordRefund`.

## Plan

### Phase 0 — close the gap (prerequisite) — **DONE**

- `assertPaymentActionAllowed(status)` in `registrationStatus.ts`, enforced in
  `registrations/payment.ts` per row, so one bad row in a bulk selection fails
  alone. Refunds excluded — `recordRefund` already requires `cancelled`.
- Compare-and-swap on the status write in `update-registration.ts`:
  `WHERE id=? AND COALESCE(status,'pending')=?` against the observed
  `prevStatus`; zero `.changes` returns 409 before any ledger write. `COALESCE`
  because `status` is nullable (`status TEXT DEFAULT 'pending'`) and
  `status = 'pending'` never matches NULL.
- `payment.ts` aligned onto `requireRole(['owner','ops'])` — same policy as
  before, now expressed like every other mutating admin route.
- Coverage in `tests/unit/registrationStatus.test.ts`, including a regression
  test pinning the guard as deliberately wider than `PAYMENT_OPTIONS`.

Verified: 363 unit + 164 API tests pass.

The client `planUpdate` stays as-is, demoted from "the guard" to pre-flight UX.

### Phase 1 — extractions — **DONE**

`applyStatusChange()` in `src/lib/registrationStatusChange.ts` and
`applyPaymentChange()` in `src/lib/registrationPaymentChange.ts`. Both take an
explicit `actor: { userId?, email?, role? }` instead of reading `locals`, so a
non-HTTP caller runs the same guards rather than growing a second copy of them.

The two routes are now wrappers: `update-registration.ts` 364 → 41 lines,
`registrations/payment.ts` 164 → 54. They keep exactly the request-level
concerns they had — auth, validating shared fields once, and shaping responses.

Error handling differs by endpoint contract, deliberately:

- `applyStatusChange` returns `{ ok: false, status, error }`, because the route
  answers with that HTTP status and message directly.
- `applyPaymentChange` throws, because the route answers 200 with a mixed
  `results` array and turns each throw into one failed entry.

Verified as a *move*, not a rewrite: diffing the old handler bodies against the
extracted modules leaves only the intended `body.` → `input.` /
`locals.adminUser` → `actor` renames, the `Response` → result-value returns, one
hoisted `hasOverride`, and shorthand property notation. No logic changed.

363 unit + 164 API tests pass.

### Phase 2 — identity — **DONE**

`telegram_admin_links`, `telegram_link_tokens`, `telegram_updates_seen` in
`db.ts`; `src/lib/telegramLink.ts`; `POST/GET /api/admin/telegram-link`; a
Telegram section in `settings.astro`.

Connecting is self-service and cannot be done on someone else's behalf — the
token round-trip is what proves the person holding the admin session also
controls that Telegram account. Tokens are SHA-256 hashed at rest (the plaintext
exists only in the `t.me` URL), single-use via a compare-and-swap on
`consumed_at`, 10-minute TTL, and minting a new one invalidates any outstanding
URL.

The role is **not** stored on the link. It is read from `user_roles` on every
tap, so removing someone in `/admin/settings/roles` stops their buttons working
immediately, with no second revocation step to forget.

### Phase 3 — webhook — **DONE**

`POST /api/telegram/webhook`. Three independent gates, all required, all covered
by `tests/unit/telegramWebhook.test.ts`:

1. `X-Telegram-Bot-Api-Secret-Token`, constant-time — its own secret, not the
   bot token, which already authenticates the retry worker.
2. `callback_query.message.chat.id` must be the configured ops group.
3. `callback_query.from.id` → link → `user_roles`, owner/ops only.

`callback_data` is not a fourth gate: the client echoes it, so a modified client
can send any payload for a message it can see. It is parsed, then re-validated
through `assertTransition` / `assertPaymentActionAllowed` like any other caller.

The endpoint always answers 200 — a non-2xx makes Telegram redeliver, and
redelivering a state change is worse than dropping one. `telegram_updates_seen`
claims each `update_id` before anything acts on it, and
`requestId = telegram:<chat>:<message>:<verb>:<arg>` makes a double-tap replay
into the existing idempotency key rather than write a second payment event.

**Acknowledgement ordering, corrected.** The plan said answer first, then work.
That is wrong: Telegram permits exactly one answer per callback query, so
spending it on "Working…" leaves no way to say *why* something was refused — and
the refusal is the case that most needs reading ("This tier is now full
(12/12 confirmed)"). The work runs first and the answer carries the outcome. The
cost is latency on the confirm path, which awaits Zoho; if the query expires the
answer is swallowed and the refreshed message still shows the result.

### Phase 4 — keyboards — **DONE**

Attached in `deliverClaimedTelegramEvent`, and only when
`TELEGRAM_WEBHOOK_SECRET` is set — without a webhook nothing could act on a
button, so shipping one would be a dead control in the ops group.

**Derived from the guards, not from the shape of the matrix.** The first cut
asked whether `TRANSITIONS[from][to]` existed, which put two buttons on every
cancelled booking that could only ever error: `cancelled → lead` and
`cancelled → pending` are both present and both refuse unconditionally with
"Re-instate via Confirm for a cancelled booking". `keyboardFor` now calls
`assertTransition` with the row's real `amount_paid` / `total_amount`, so a
booking with no trip price is not offered Confirm, and a lead already carrying an
advance is not offered Pending. `assertTransition` treats `from === to` as a
no-op success, so same-status moves are excluded explicitly.

```
lead       [→ Pending] [Confirm ▸] [Cancel ▸] [Open in admin ↗]
pending                [Confirm ▸] [Cancel ▸] [Open in admin ↗]
confirmed  [Mark fully paid]       [Cancel ▸] [Open in admin ↗]   ← while advance_paid
```

`Confirm ▸` → `[Advance paid] [Fully paid] [← Back]`; `Cancel ▸` →
`[Cancel · no refund] [Cancel · full refund] [← Back]`. Partial refunds need an
amount no button can carry, so they keep the `Open in admin ↗` route.

After a successful action every message for that booking is refreshed, not just
the one tapped: confirming from the `pending` message posts a fresh `confirmed`
notification, and the older messages would otherwise keep the keyboard they were
sent with. Content edits are best-effort and fall back to swapping just the
keyboard, which works for photo and text messages alike.

## Deploying

1. Set `TELEGRAM_WEBHOOK_SECRET` (long random) and `TELEGRAM_BOT_USERNAME`.
2. Deploy. Until the webhook is registered the bot stays one-way and no buttons
   are attached.
3. `node scripts/telegram-webhook.mjs set` — **after** the deploy. Registering
   against a URL that 404s leaves the group with buttons that do nothing.
   `… info` shows the current registration.
4. Each admin connects their own account in Admin → Settings → Telegram.

Keep BotFather privacy mode **on**: callback queries arrive regardless, and the
bot never sees group chat text.

## Still open

- **Check A of `scripts/audit-payment-matrix.sql` has only run against the
  8-row visual-test fixture.** The dev DB holds zero registrations. Run it on the
  Railway volume before relying on the Phase 0 guard in production.
- The webhook's authorization matrix is proven as a unit, not end-to-end: doing
  it live would need a real bot token in the shared test server's environment,
  which would make `telegram-notifications.test.mjs` dial api.telegram.org. The
  API suite proves routing, middleware pass-through and the 401.

## Out of scope

Porting `planUpdate` server-side (blocked on finding 4, and unnecessary once the
server guards independently); partial refunds by button; a Telegram Mini App to
land `Open in admin ↗` already authenticated.
