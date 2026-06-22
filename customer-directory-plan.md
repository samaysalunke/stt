# Admin Customers Directory

## Summary

- Add a new `Customers` tab in the admin side menu and a dedicated `/admin/customers` screen.
- Unified customer directory built from matching `users` + `registrations` records, keyed by `lower(trim(email))`.
- v1 is read-only: find, understand, and jump to related records — no state-changing actions.

---

## Schema changes required

**Add before any query work:**

```sql
CREATE INDEX IF NOT EXISTS registrations_email_lower ON registrations(lower(trim(email)));
CREATE INDEX IF NOT EXISTS registrations_batch_id ON registrations(batch_id);
```

Without the email index the aggregation GROUP BY does a full table scan on every page load. Add both via the existing migration pattern in `initializeSchema()` in `src/lib/db.ts`.

---

## Data model — customer aggregation

A "customer" is one row per `lower(trim(email))` derived from `registrations`. The `users` table provides account/profile metadata for those who signed in via Google.

```sql
-- Core query (owner/ops — no batch_id filter)
-- For trip_lead: append WHERE r.batch_id IN (?, ?, ...) before GROUP BY
SELECT
  lower(trim(r.email))               AS email,
  -- use the most recently submitted registration's values for identity fields
  (SELECT full_name  FROM registrations WHERE lower(trim(email)) = lower(trim(r.email)) ORDER BY created_at DESC LIMIT 1) AS full_name,
  (SELECT phone      FROM registrations WHERE lower(trim(email)) = lower(trim(r.email)) ORDER BY created_at DESC LIMIT 1) AS phone,
  (SELECT city       FROM registrations WHERE lower(trim(email)) = lower(trim(r.email)) ORDER BY created_at DESC LIMIT 1) AS city,
  COUNT(*)                           AS total_regs,
  SUM(CASE WHEN r.status = 'confirmed'  THEN 1 ELSE 0 END) AS confirmed,
  SUM(CASE WHEN r.status = 'pending'    THEN 1 ELSE 0 END) AS pending,
  SUM(CASE WHEN r.status = 'lead'       THEN 1 ELSE 0 END) AS lead,
  SUM(CASE WHEN r.status = 'rejected'   THEN 1 ELSE 0 END) AS rejected,
  SUM(COALESCE(r.amount_paid, 0))    AS total_paid,
  max(r.payment_date)                AS last_payment_date,
  max(r.created_at)                  AS last_reg_at,
  -- join users for account fields (NULL when not logged in)
  u.id                               AS user_id,
  u.displayName,
  u.avatarUrl,
  u.username,
  u.leaderboardOptOut,
  u.showTripsPublicly,
  u.createdAt                        AS account_created_at,   -- unix timestamp, use * 1000 for JS Date
  u.lastLoginAt,                                              -- unix timestamp, use * 1000 for JS Date
  -- highest-privilege role (owner > ops > trip_lead); NULL if no admin role
  CASE max(CASE ur.role
        WHEN 'owner'     THEN 3
        WHEN 'ops'       THEN 2
        WHEN 'trip_lead' THEN 1
        ELSE 0 END)
    WHEN 3 THEN 'owner'
    WHEN 2 THEN 'ops'
    WHEN 1 THEN 'trip_lead'
    ELSE NULL END                    AS role
FROM registrations r
LEFT JOIN users u       ON lower(trim(u.email)) = lower(trim(r.email))
LEFT JOIN user_roles ur ON ur.userId = u.id
-- trip_lead: add WHERE r.batch_id IN (placeholders) here, before GROUP BY
GROUP BY lower(trim(r.email))
ORDER BY last_reg_at DESC
```

**Notes:**
- `trip_slug` can be NULL on older registrations — always fall back to `trip_name` for display.
- Instagram handle lives on `registrations`, not `users` — treat it as a per-booking field, not identity.
- For customers with `leaderboard_cache` data (users who have logged in and have confirmed bookings), surface `kmsFromHome`, `daysOutdoors`, `destinationsCount` from that table to avoid recomputation.

---

## Stat chips — precise definitions

Compute these from the aggregation query above on page load:

Chips are non-exclusive (a customer can appear in multiple):

| Chip | Definition |
|------|-----------|
| Total customers | COUNT(DISTINCT lower(trim(email))) across all registrations |
| Confirmed customers | `confirmed >= 1` |
| Pending customers | `pending >= 1` |
| Unpaid customers | `total_paid = 0 AND (confirmed + pending) >= 1` |
| Repeat customers | `total_regs >= 2` (any status counts) |

"Active" is deliberately not used — too ambiguous. Use the five chips above instead.

---

## Permissions / RBAC

Follow the exact same scoping pattern already used in `registrations.astro` (lines 13–17):

```ts
const isTripLead = adminUser?.role === 'trip_lead';
const allowedBatchIds: string[] | null = isTripLead ? (adminUser?.tripIds ?? []) : null;
```

For trip leads: only show customers whose registrations have `batch_id IN (allowedBatchIds)`. If `allowedBatchIds` is empty, show no customers. Owner/ops see all.

The audit log link (see Admin Actions) is owner/ops only — hide it for trip leads.

---

## Pagination / load strategy

Full-load with client-side filter — same pattern as registrations.astro. Hard cap at 1 000 customer rows. If the aggregation returns > 1 000 customers, add a warning banner and show only the first 1 000 ordered by `last_reg_at DESC`. Add server-side pagination in v2 when the dataset grows. State this cap explicitly in the page header when triggered.

---

## UI/UX

### Top bar
- Search input: matches against `full_name`, `email`, `phone`, `username`, `city` (client-side, same pattern as registrations search).
- Filters: booking status (has confirmed / has pending / lead only), payment state (unpaid / advance / full), customer type (has account / no account / repeat).
- Five stat chips as defined above.

### Main table
Default columns: name, email, phone, username (if present), total bookings, confirmed count, latest trip, payment state, city, last activity date.
- Rows expand on click (desktop) / open drawer (mobile).
- Client-side sort on any column header.
- Each `<tr>` carries data attributes for client-side search, mirroring the registrations pattern:
  `data-name`, `data-email`, `data-phone`, `data-username`, `data-city` (all lowercase).
- Empty state: "No customers found" when the aggregation returns 0 rows or all rows are filtered out.

### Detail drawer

**Identity block:**
- Full name, email, phone, city
- Username (if present), avatar (if present — note: Google CDN URL, may expire)
- Account created date, last login (from `users.createdAt`, `users.lastLoginAt`)
- Role (highest-privilege, from `user_roles`; blank if no admin role)
- Leaderboard flags: `showTripsPublicly`, `leaderboardOptOut`

**Booking block:**
- All registrations for this email, grouped by `trip_slug` / `trip_name` (fallback when slug is null).
- Per registration: trip name, departure dates, tier/occupancy, status badge, payment badge, amount paid.
- Reuse `RegistrationCard.astro` with `readOnly={true}` — already supports this via the `readOnly` prop.

**Stats block (users with leaderboard data only):**
- km from home, days outdoors, destinations, trips count — read directly from `leaderboard_cache` where `userId` is known.

**Timeline block:**
Events are derived from fields already in `registrations` — do not fabricate anything:
- Registration submitted → `created_at`
- Consent given → `consent_at` (if not null)
- Payment recorded → `payment_date` (if not null)
- Status changes → read from `audit_log WHERE targetId IN (reg_ids)`, ordered by `createdAt DESC`, show last 10 entries

---

## Admin actions (v1, all read-only)

- **Open registration** — link to the registration's position in `/admin/registrations/` filtered by email.
- **Open public profile** — `/u/{username}` if `username` is set and `showTripsPublicly` is true.
- **Copy email / phone / username** — clipboard copy buttons inline.
- **Export filtered list to CSV** — extend the existing `/api/admin/export.ts` endpoint with `type=customers`. The handler runs the aggregation query with any active filters applied server-side and returns CSV. Do NOT build a separate export endpoint.
- **Jump to audit log for this customer** — link to `/admin/audit?email={email}`. Requires adding an `email` query-param filter to the audit page: `WHERE targetId IN (SELECT id FROM registrations WHERE lower(trim(email)) = ?)`. This join is required — `audit_log.targetId` stores registration IDs, not emails. Owner/ops only.

---

## Implementation changes

### 1. Database migrations (db.ts)
```ts
try { db.exec('CREATE INDEX IF NOT EXISTS registrations_email_lower ON registrations(lower(trim(email)))'); } catch {}
try { db.exec('CREATE INDEX IF NOT EXISTS registrations_batch_id ON registrations(batch_id)'); } catch {}
```

### 2. AdminLayout.astro
- Add `'customers'` to the `page` prop union (line 7).
- Add nav item for `/admin/customers/` with a users/group icon, positioned after Registrations.
- Visible to all roles (trip leads included, with scoped data).

### 3. src/pages/admin/customers.astro (new)
- Server-side: run aggregation query with role-based scoping.
- Render stat chips, search/filter toolbar, and customer table.
- Include `<script>` block for client-side search + filter (same pattern as registrations.astro).

### 4. src/pages/api/admin/export.ts
- Add `else if (type === 'customers')` branch.
- Run the same aggregation SQL and return flat CSV.
- Respect role scoping — apply `batch_id` filter for trip leads.

### 5. src/pages/admin/audit.astro (minor change)
- Add optional `email` query param.
- When present: `WHERE targetId IN (SELECT CAST(id AS TEXT) FROM registrations WHERE lower(trim(email)) = ?)` appended to the audit query.
- Show a banner: "Filtered to registrations for {email}" with a clear-filter link.

---

## Test plan

### Unit tests (new file: tests/unit/customerAggregation.test.ts)
- One user with multiple registrations → aggregates correctly (total, confirmed count, total_paid).
- Two registrations with same email, different casing (`User@x.com` + `user@x.com`) → treated as one customer.
- User with no registrations → does NOT appear (directory is registration-driven, not user-driven).
- Registration-only customer (no users row) → appears with null account fields.
- Repeat customer (≥ 2 regs) → counted in repeat chip.
- Unpaid confirmed customer (amount_paid = 0, status = confirmed) → counted in unpaid chip.
- Trip lead scoping: only returns customers in allowedBatchIds.

### API / integration tests (extend tests/api/)
- GET `/admin/customers` → 200 for owner, 200 for ops, 200 for trip_lead (scoped), redirect for unauthenticated.
- Export endpoint with `type=customers` → 200, CSV content-type, correct row count.
- Audit filter: GET `/admin/audit?email=x@y.com` → 200, only shows rows for that customer's registration IDs.

### Regression tests
- Existing `/admin/registrations/` page unaffected.
- Existing `/api/admin/export.ts` for `type=registrations` still works.

---

## Out of scope for v1

- Newsletter-only or contact-only records (not in registrations → not in directory).
- Editing any customer data.
- Merging duplicate customer records.
- Customer-level activity beyond what's already stored (no new event tracking).
- Server-side pagination (add in v2 if customer count exceeds cap).
