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

### Phase 2 — identity

```sql
telegram_admin_links   (telegram_user_id PK, user_id, telegram_username, linked_at, revoked_at)
telegram_link_tokens   (token_hash PK, user_id, expires_at, consumed_at)
telegram_updates_seen  (update_id PK, received_at)
```

A Telegram section in `settings.astro` mints a one-time
`https://t.me/<bot>?start=<token>`; `/start <token>` in DM consumes it. Hashed at
rest, single-use, 10-minute TTL. Role is resolved from `user_roles` **at tap
time**, so removing someone in `/admin/settings/roles` kills their buttons with
no separate revocation step.

### Phase 3 — webhook

`POST /api/telegram/webhook`, three independent checks, all required:

1. `X-Telegram-Bot-Api-Secret-Token`, `timingSafeEqual` — the shape
   `jobs/telegram-notifications.ts:8` already uses. New `TELEGRAM_WEBHOOK_SECRET`,
   deliberately not the bot token.
2. `callback_query.message.chat.id === TELEGRAM_ADMIN_CHAT_ID`.
3. `callback_query.from.id` → link → `user_roles`, owner/ops only.

`callback_data` is input, never authority: a modified client can send arbitrary
data for any message it can see, so it is parsed and then re-validated through
`assertTransition` / `assertPaymentChangeAllowed` regardless.

Per tap: `answerCallbackQuery` first (before the confirm path awaits
`processZohoDocument`), then plan → guard → CAS → apply, then edit **every**
message for that registration (ids are in `telegram_notification_events`) so no
stale keyboard survives. Always return 200 — a retried `update_id` must never
re-run a state change; `telegram_updates_seen` plus
`requestId = telegram:<chat_id>:<message_id>:<action>` make a double-tap replay
into the existing idempotency key.

Middleware is already clear: `/api/telegram/*` is outside the `/api/admin` gate,
CSRF fires only on form content-types, and canonicalisation is `GET`/`HEAD`-only
so a POST will not 308.

### Phase 4 — keyboards

Generated in `deliverClaimedTelegramEvent` from `TRANSITIONS` + `PAYMENT_OPTIONS`,
so a button can never offer what the server will refuse.

```
lead       [→ Pending] [Confirm ▸] [Cancel ▸] [Open ↗]
pending                [Confirm ▸] [Cancel ▸] [Open ↗]
confirmed  [Mark fully paid]       [Cancel ▸] [Open ↗]   ← only while advance_paid
```

Submenus edit in place: `Confirm ▸` → `[Advance paid] [Fully paid] [← Back]`,
`Cancel ▸` → `[No refund] [Full refund] [← Back]`. Partial refunds, custom
advance overrides and field edits are out of scope for buttons and get the
`Open ↗` URL button. BotFather privacy mode stays **on** — callback queries
arrive regardless, and the bot never sees group chat text.

## Out of scope

Porting `planUpdate` server-side (blocked on finding 4, and unnecessary once the
server guards independently); partial refunds by button; a Telegram Mini App to
land `Open ↗` already authenticated.
