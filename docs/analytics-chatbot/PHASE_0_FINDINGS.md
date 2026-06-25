# Phase 0 — Discovery Findings

Owner-only admin analytics chatbot for **Seek the Thrill** (Astro SSR + better-sqlite3).
This file records the real schema, auth, and DB facts the rest of the build depends on.

## Stack

- **Framework:** Astro SSR, Node runtime. API via Astro API routes (`src/pages/api/**`).
- **DB:** SQLite via `better-sqlite3`, single connection from `src/lib/db.ts#getDb()`.
  better-sqlite3 is **synchronous** — queries cannot be interrupted mid-flight, so the turn
  deadline is enforced around LLM round-trips, not inside a query.
- **Migrations:** no migration tool. Schema is created idempotently in `db.ts#initializeSchema`
  (`CREATE TABLE IF NOT EXISTS` + guarded `ALTER TABLE` in try/catch). New analytics tables
  were added there (Phase 1) following the same pattern — no second tool introduced.
- **UUIDs:** `node:crypto.randomUUID()` (already used across the app).
- **Test scripts:** `npm run test:unit` (vitest), `npm run test:api` (`tests/run.mjs`),
  `npm run test:analytics-live` (optional real-provider smoke).

## Tables relevant to analytics

### `registrations` (booking + payment + demographics entry point)
There is **no separate leads table**; `registrations` is the single entry point. `status`
distinguishes lifecycle (`pending` | `confirmed` | `rejected`, and `lead` is referenced by
`getDepartureSummary`).

| Column | Type | PII? | Returnable |
|---|---|---|---|
| id | INTEGER PK | no | yes |
| trip_name | TEXT | no | yes |
| trip_slug | TEXT | no | yes (links to YAML trip) |
| trip_date | TEXT | no | yes |
| batch_id | TEXT | no | yes (departure id) |
| tier_id | TEXT | no | yes |
| sharing_option | TEXT | no | yes |
| status | TEXT | no | yes |
| amount_paid | INTEGER | no | yes (**revenue field**) |
| total_amount | INTEGER | no | yes |
| payment_date | TEXT | no | yes |
| payment_method | TEXT | no | yes |
| source / source_detail | TEXT | no | yes (**registration channel**) |
| gender | TEXT | no | yes (**demographics — confirmed present**) |
| age | TEXT | no | yes (stored as text; cast to INTEGER for buckets) |
| city / state / country | TEXT | no | yes |
| photo_consent / consent_at | INTEGER / DATETIME | no | yes |
| created_at / updated_at | DATETIME | no | yes |
| sharedAt | TEXT | no | yes |
| full_name | TEXT | **yes** | no |
| email | TEXT | **yes** | no (used only as a hashed/anonymised grouping key, never returned) |
| phone | TEXT | **yes** | no |
| date_of_birth | TEXT | **yes** | no |
| address / city-level pincode | TEXT | **yes (address, pincode)** | no |
| emergency_name / emergency_phone / emergency_relationship | TEXT | **yes** | no |
| dietary_notes / why_join | TEXT | **yes** | no |
| admin_notes | TEXT | **yes** | no |
| payment_screenshot_url / transaction_id | TEXT | **yes** | no |
| instagram | TEXT | **yes** | no |
| email_sent / email_error | INTEGER / TEXT | **yes (email_error)** | no |

### `users` (accounts)
Mostly PII. Returnable: `id`, `createdAt`, `lastLoginAt`, `leaderboardOptOut`, `showTripsPublicly`.
Blocked: `email`, `displayName`, `avatarUrl`, `googleId`, `username`, `homeCityLatLng`.

### `contact_submissions`, `newsletter_subscribers` (aggregate-only)
Free-text PII (`full_name`, `email`, `phone`, `subject`, `message`). Allowed only via
aggregation or the safe columns `source`, `status`, `created_at`, `subscribed_at`, `active`.

### Trips / Departures
**Not in SQLite** — they live as YAML content, read via `src/lib/trips.ts#listTrips()` and
`src/lib/tripEditor.ts#editableBooking()`. `src/lib/analytics/trips.ts` bridges them:
`slug`, `title`, `location`, `status`, and per-departure `id` (= `batch_id`), `startDate`,
`endDate`, `status`, `capacity`, `booked`. Trips/departures contain **no PII**.

## Confirmed real identifiers

- **Revenue:** `SUM(amount_paid)` where `status != 'rejected'`. (`total_amount - amount_paid`
  = outstanding balance for pending payments.)
- **Status values:** `pending`, `confirmed`, `rejected` (+ `lead` seen in departure stats).
- **Gender:** `registrations.gender`. **Age:** `registrations.age` (TEXT). **City:**
  `registrations.city`. **Source:** `registrations.source` / `source_detail`.

## Leads model decision

No separate leads table → `getConversionRate` is defined as
`confirmed registrations / all registrations` (optionally scoped by trip/departure).

## Auth & RBAC (reused, not reimplemented)

- Roles resolved in `src/middleware.ts` via `getAdminBySession(token)` →
  `locals.adminUser = { userId, email, displayName, role, tripIds }` with
  `role ∈ {'owner','ops','trip_lead'}` (`user_roles.role` CHECK constraint in `db.ts`).
- Owner-only gate added to the existing `ownerOnly` list in middleware for
  `/admin/analytics` (page → redirect to `/admin`) and `/api/admin/analytics` (API → 403),
  with 401 for missing/invalid session. The API route re-checks `role === 'owner'` (defence
  in depth). Nav item rendered only for owners in `AdminLayout.astro` (`ownerNavItems`).

## DB access + read-only plan

All analytics SQL goes through `getDb().prepare(...).all(...)` with **parameterised** values.
better-sqlite3 has no separate read-only role; read-only is enforced by construction:
- Named resolvers build SQL from constants + bound params; a mutation-keyword regex guards
  every resolver query (`tools.ts#all`).
- The escape hatch never accepts SQL text — it compiles a structured object to parameterised
  SQL, then re-parses it with `node-sql-parser` and asserts a single `SELECT` statement.

## PII Whitelist (final, real column names)

**Allowed — registrations:** `id`, `trip_name`, `trip_slug`, `trip_date`, `batch_id`,
`tier_id`, `sharing_option`, `status`, `amount_paid`, `total_amount`, `payment_date`,
`payment_method`, `created_at`, `updated_at`, `source`, `source_detail`, `gender`, `age`,
`city`, `state`, `country`, `photo_consent`, `consent_at`, `sharedAt`.

**Allowed — users:** `id`, `createdAt`, `lastLoginAt`, `leaderboardOptOut`, `showTripsPublicly`.

**Allowed — contact_submissions / newsletter_subscribers:** aggregates, plus `source`,
`status`, `created_at`, `subscribed_at`, `active`.

**Allowed — trips / departures:** all (no PII).

**Always blocked (any tier):** `full_name`, `email`, `phone`, `address`, `pincode`,
`emergency_name`, `emergency_phone`, `emergency_relationship`, `date_of_birth`,
`dietary_notes`, `why_join`, `admin_notes`, `payment_screenshot_url`, `transaction_id`,
`instagram`, `email_error`, `displayName`, `avatarUrl`, `googleId`, `username`,
`homeCityLatLng`, `message`, `subject`, `unsubscribe_token`, plus any column containing
`password`/`token` or suffixed `_raw` / `_private`. Source of truth: `analytics/schema.ts`.
