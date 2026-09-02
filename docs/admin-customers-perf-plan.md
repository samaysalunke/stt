# Plan: fix `/admin/customers/` prod crash

## Context

`https://www.seekthethrill.in/admin/customers/` 500s / times out on prod, and its
in-page search freezes the tab.

**Root cause — verified with `EXPLAIN QUERY PLAN` + timing on the local DB:**

1. `customers.astro:50-52` does
   `LEFT JOIN users u ON lower(trim(u.email)) = lower(trim(r.email))` with **no
   index on `users(lower(trim(email)))`** → plan shows `SCAN u LEFT-JOIN`: a full
   users-table scan per registration row. `audit_log` is queried by
   `targetType`/`targetId` (`:132-136`) with no matching index → full scan too.
   better-sqlite3 is synchronous, so this blocks the Node event loop → gateway
   timeout. Local (813 regs / 2515 users): **0.495 s**. Adding both indexes:
   **0.495 s → 0.010 s**, plan flips to `SEARCH u USING INDEX users_email_lower`.
   Prod data is larger, so the real page is far past timeout.
2. The page renders **every** customer (cap 1000), each with a full detail
   drawer. `tests/e2e/visual.spec.ts:157-160` independently documents the result:
   *"the dev DB holds 612 customers — `/admin/customers` is a 95,000px-tall page
   whose full-page PNG is 7.4MB and which never settles."*
3. Client `applyFilters` (`:545-568`) walks all ~1000 rows per keystroke toggling
   `style.display` → reflow storm → tab lock.

**Decisions (confirmed):** full rework · GET-form search mirroring
`/admin/email-logs` · indexes ship via normal redeploy.

---

## Review of the first draft of this plan — 7/10, superseded

Seven defects, found by checking the code instead of trusting memory. Recorded
because the corrected design below exists to avoid them.

1. **False claim about the CSV writer.** v1 said extra columns were "harmless to
   the CSV (its `toCSV` selects its own set)". It does not:
   `export.ts:5-7` is `const headers = Object.keys(rows[0])` over a `SELECT *`.
   Confirmed against the built query: a `SELECT *` over the widened aggregation
   leaks exactly `avatarUrl, leaderboardOptOut, showTripsPublicly,
   account_created_at, lastLoginAt` into the customers CSV people already
   download. Pinning `EXPORT_COLUMNS` holds the header at its original 19
   columns, verified identical in name and order.
2. **Would have injected a correctness bug into the export.** v1 folded
   `customers.astro`'s `LEFT JOIN user_roles` into the shared CTE. That join
   multiplies rows before `GROUP BY`, so a user with 2+ roles inflates
   `COUNT(*)`/`SUM(...)` → corrupts `total_regs`, `total_paid`, and the `repeat` /
   `unpaid` filters. `export.ts` is **correct today** precisely because it has no
   such join. (The page has the bug now; latent locally — every user has ≤1 role.)
3. **Pagination ordered on a non-unique key.** v1 kept `ORDER BY last_reg_at
   DESC` with no tiebreaker. Measured on the local DB: 813 customers span only
   **296 distinct `last_reg_at` values, up to 6 customers sharing one timestamp**
   (bulk importers stamp identical times), so `LIMIT/OFFSET` paging was resting
   on an order SQLite does not guarantee.

   **Correction after implementing:** paging all 17 pages with and without the
   tiebreaker both returned 813/813 unique emails — SQLite ordered the ties
   consistently here, so this was never reproduced as a live skip/duplicate. The
   `email` tiebreaker is retained as a guarantee, not as a fix for an observed
   fault. It matters most where the risk actually lives: page N and page N+1 are
   separate requests, with writes possible in between.
4. **Case-handling mismatch.** v1 copied `email-logs`' `.trim().slice(0,200)`,
   but `export.ts:93` uses `.trim().toLowerCase().slice(0,200)` and the SQL
   lowercases both sides. Page and CSV would disagree on an uppercase term.
5. **Missed a test that this change breaks by definition.**
   `tests/e2e/visual.spec.ts:393` snapshots `/admin/customers`. v1 asserted the
   suites would be green.
6. **Left the module's API undecided** ("call twice — or one call, preferred").
7. **Hand-waved added cost.** v1 adds count + stats passes over the same CTE per
   page load and called it "cheap with the index" without a fast path.

---

## Current repo state (hotfix already on disk, uncommitted)

- `src/lib/db.ts:154-161` — already has
  `CREATE INDEX IF NOT EXISTS users_email_lower ON users(lower(trim(email)))` and
  `CREATE INDEX IF NOT EXISTS audit_log_target ON audit_log(targetType, targetId)`
  inside `initializeSchema()`. **Keep, unchanged.**
- `src/pages/admin/customers.astro:570-576` — a 200 ms search debounce. The
  rework **deletes** it along with the rest of the client filter.
- Local `data/seekthethrill.db` — both indexes created by hand during
  investigation; identical to the migration, harmless.
- `git diff --stat`: `db.ts` +5, `customers.astro` +8.

## Mechanics established by exploration

- **Migrations:** no runner. `initializeSchema()` fires lazily on the first
  `getDb()` per process; every `CREATE INDEX IF NOT EXISTS` re-runs each boot and
  is idempotent. A redeploy applies the indexes on the first DB-touching request.
- **Deploy:** no `.github/`, no CI, no `railway.*`/Dockerfile. Railway Nixpacks
  (`npm run build` → `npm start`) off its GitHub integration. DB persists via a
  dashboard-mounted Volume + `DATA_DIR`; replicas pinned to 1.
- **Pagination precedent:** `email-logs.astro:25-63,128-135,159-185,242-248` —
  `PAGE_SIZE = 50`, params off `Astro.url.searchParams`, `SELECT COUNT(*)` →
  clamp `page` → `LIMIT ? OFFSET ?`, `<form method="GET">`, `pageHref(n)`. Note
  it uses a tiebreaker: `ORDER BY datetime(created_at) DESC, rowid DESC`.
- **The duplicated SQL** lives inline in exactly two places, already drifting:
  `customers.astro:24-57` (`LIMIT 1001`, roles join, account columns) and
  `export.ts:111-140` (no LIMIT, has `wishlist`/`cancelled`/`total_refunded`,
  already supports `?q` + `?customer_type`, `likeTerm()` at `:19-21`).

---

## Changes

### 0. Save this document into the repo
Write this plan to **`docs/admin-customers-perf-plan.md`**, matching the existing
`docs/admin-registrations-rework-plan.md` convention, and commit it with the
change.

### 1. `src/lib/db.ts` — no change
Indexes already present; they ship on the next redeploy.

### 2. New `src/lib/customersView.ts` — shared **query builder**, not a shared result

The key design correction: the module returns **SQL fragments**, and each caller
supplies its own explicit column projection. That is what keeps the CSV schema
byte-identical while letting the page select more.

```ts
export const CUSTOMER_TYPES = ['has-account','no-account','repeat',
                               'confirmed','pending','unpaid'] as const;

export function buildCustomerQuery(adminUser, { q, customerType }): {
  cte: string;        // `WITH customers AS ( ... )`
  where: string;      // '' | `WHERE ...`
  params: unknown[];  // batchParams ++ filterParams, in bind order
}
```

- Move `likeTerm()` here from `export.ts:19-21`.
- **CTE body = today's `export.ts:112-138` verbatim** — same columns, same order,
  and **no `user_roles` join** (defect 2). This is the correctness baseline.
- `q` → the 5-column `LIKE ? ESCAPE '\'` clause from `export.ts:99-103`.
- `customerType` → the filter map from `export.ts:104-109`.
- trip_lead `batchWhere`/`batchParams` scoping lives here (`customers.astro:16-21`).
- Export the canonical sort as a constant:
  **`ORDER BY last_reg_at DESC, email ASC`** (defect 3). `email` is the `GROUP BY`
  key, so it is unique and the sort is total.
- Also export `countCustomers()` and `customerStats()` helpers over the same CTE
  (see cost note below).

Known pre-existing edge, unchanged and not introduced here: two `users` rows whose
emails differ only by case/whitespace would collide under `lower(trim())` and
multiply. Both callers have this today.

### 3. `src/pages/api/admin/export.ts` — adopt the module, pin the CSV schema

- Replace `:87-140` with `buildCustomerQuery(adminUser, { q, customerType })`.
- Execute
  `${cte} SELECT ${EXPORT_COLUMNS} FROM customers ${where} ${ORDER_BY}` —
  where `EXPORT_COLUMNS` is the **explicit list of exactly today's `SELECT *`
  columns in today's order**, replacing the `SELECT *`. This pins the CSV header
  row against future CTE additions (defect 1).
- No limit/offset — full export, as today.
- Acceptance: for the same query params, the CSV must be **byte-identical** to a
  pre-change export, modulo the now-deterministic tiebreak among equal
  `last_reg_at`. Capture a baseline CSV before touching the file.

### 4. `src/pages/admin/customers.astro` — paginate, drop the client filter

**Frontmatter**
- `PAGE_SIZE = 50`.
- `q = (searchParams.get('q') ?? '').trim().toLowerCase().slice(0, 200)` —
  `.toLowerCase()` included, matching `export.ts:93` (defect 4).
- `customer_type` validated against `CUSTOMER_TYPES`, else `''`.
- `page = Math.max(1, Number.parseInt(... ?? '1', 10) || 1)`.
- **One decided call shape** (defect 6): `buildCustomerQuery` once, then in order —
  stats pass → derive/clamp `page` → rows pass.
- Rows: `${cte} SELECT ${PAGE_COLUMNS} FROM customers ${where} ${ORDER_BY}
  LIMIT ? OFFSET ?`. `PAGE_COLUMNS` adds what the drawers need
  (`avatarUrl`, `leaderboardOptOut`, `showTripsPublicly`,
  `u.createdAt AS account_created_at`, `lastLoginAt`) — **but not `role`**.
- **`role` without row multiplication:** drop the `user_roles` join; fetch roles
  for the ≤50 `user_id`s in a separate query, exactly mirroring the existing
  `leaderboardByUserId` block at `:104-112`:
  `SELECT userId, role FROM user_roles WHERE userId IN (...)`, then pick highest
  precedence (`owner > ops > trip_lead`) in JS. This also fixes the page's
  existing count-inflation bug.
- `regsByEmail` (`:86-101`), `leaderboardByUserId` (`:104-112`) and
  `auditByEmail` (`:115-149`) keep their current logic; they now receive ≤50
  emails, so they become trivial and the `targetId IN (...)` SQL-variable-cap
  risk disappears.
- Delete `capped` and the "showing first 1 000" banner (`:73-74`, `:161`,
  `:171-175`).
- Stat chips (`:77-81`, `:178-190`) read from the stats row instead of
  `customers.filter(...)`.
- `pageHref(n)` re-serializes `q` + `customer_type` + `page`.
- Export CSV `href` built server-side from `q` + `customer_type` (no `page`),
  dropping the client `updateExportLink()`.

**Query cost — explicit (defect 7).** Each CTE pass measured ~10 ms locally with
the index. Passes per page load:
- `q` empty **and** `customer_type` empty (the common first load): **1** CTE pass
  for stats; `total` is read off the stats row; plus the rows pass. `total` may
  further short-circuit to
  `SELECT COUNT(DISTINCT lower(trim(email))) FROM registrations ${batchWhere}`.
- `customer_type` set: **one extra** COUNT pass with the type filter applied,
  because the stats row is deliberately `q`-only.
So 2–3 passes worst case, ~30 ms at local scale. Acceptable; recheck at step 8 of
verification.

**Stats semantics (deliberate).** Chips respect `q` but **ignore
`customer_type`** — the chips *are* the type categories, so filtering by them
would zero out the others. Selecting "Repeat" must leave the chips as
"within your text search, how many are confirmed / pending / unpaid / repeat".

**Markup**
- Replace the toolbar (`:192-206`) with `<form method="GET">`: `<input name="q"
  value={q}>`, `<select name="customer_type">` with `selected={}`, submit, and a
  `Clear` link to `/admin/customers/`. Classes from `email-logs.astro:159-185`.
- **The form must contain no `page` input** — submitting a new search then drops
  `page` and naturally resets to 1.
- Keep the rows + drawers (`:214-408`) as-is; they render ≤50 now.
- Remove the dead client-filter hooks on `.cust-row` (`data-name`, `-email`,
  `-phone`, `-username`, `-city`, `-confirmed`, `-pending`, `-unpaid`, `-repeat`,
  `-has-account`, `:222-232`) and the `#cust-list` / `#cust-empty` toggling.
- Empty state rendered server-side when `total === 0`.
- Pager block from `email-logs.astro:242-248`.

**`<script>` (`:451-573`)**
- **Delete:** `applyFilters`, the `searchInput`/`typeFilter` listeners, the
  debounce (`:570-576`), `updateExportLink`, `#cust-empty` handling.
- **Keep:** `toggleCustomer`, `copyText`, `toggleCustEdit`, and the
  `.cust-edit-form` submit handler POSTing to `/api/admin/customers/update` —
  all operate on the rendered slice.

### 5. `tests/e2e/visual.spec.ts` — regenerate the baseline (defect 5)

`:393` registers `{ name: 'admin-customers', path: '/admin/customers' }`. The
toolbar/pager rewrite changes that snapshot by definition → regenerate the
baseline PNG in the same commit.

Check, do not change, the `capAdminLists` heuristic (`:194-209`): it caps a
container with ≥4 same-tag/same-class children **unless the container is inside a
`<form>`**. The new `<form>` wraps only the toolbar; `#cust-list` stays outside
it, so `.cust-row` capping is unaffected, and `.stat-chips` (5 identical
children, not in a form) caps as before. Worth noting the 95,000px / 7.4MB
instability documented at `:157-160` should now be gone — but leave
`capAdminLists` in place, other admin pages still rely on it.

---

## Verification

1. Capture the **pre-change** baseline first:
   `curl` `/api/admin/export?type=customers` (authed) → save CSV.
2. `npx astro build` clean. (Pre-existing unrelated TS errors in
   `src/lib/safeMarkdown.ts` and one e2e spec — ignore.)
3. `npm run dev` → `/admin/customers/`: fast load, 50 rows, pager, no console
   errors.
4. `?q=<Name>` **with capitals** filters identically to
   `/api/admin/export?type=customers&q=<Name>` (defect 4 regression test).
5. `?customer_type=repeat` filters; `Clear` resets; submitting a new search from
   page 3 lands on page 1.
6. **Pagination stability (defect 3):** collect emails from every page at
   `PAGE_SIZE=50`, then assert the concatenation has no duplicates and its length
   equals `total`. Do this specifically against the ~6-way `last_reg_at` ties
   present in the data.
7. **CSV schema (defect 1):** diff the new unfiltered export against step 1 —
   header row must be identical, column count unchanged.
8. `EXPLAIN QUERY PLAN` on the rows query → `SEARCH u USING INDEX
   users_email_lower`, not `SCAN u`. Time all passes for one page load.
9. Expand a row → booking history, audit timeline (owner/ops), inline Edit →
   Save all still work. Confirm the role pill still renders for an admin user.
10. trip_lead login → rows scoped to their `batch_id`s; no audit timeline.
11. `npm run test:unit && npm run test:api` green; `npm run test:e2e` green after
    the baseline regeneration in step 5 of Changes.

## Deploy & rollback

- Merge to `main`; Railway auto-deploys. `initializeSchema()` creates
  `users_email_lower` + `audit_log_target` on the first DB request after boot —
  no manual migrate step.
- If prod cannot wait for the build, apply the indexes out-of-band first
  (idempotent; the later deploy is then a no-op):
  `railway run 'sqlite3 "$DATA_DIR/seekthethrill.db" "CREATE INDEX IF NOT EXISTS users_email_lower ON users(lower(trim(email))); CREATE INDEX IF NOT EXISTS audit_log_target ON audit_log(targetType, targetId);"'`
- Rollback: revert the commit, redeploy. The indexes are harmless if left behind.

## Outcome (implemented)

Measured after the change, on the local DB (812 customers):

| Check | Result |
|---|---|
| Query plan for the page's rows query | `SEARCH u USING INDEX users_email_lower` — no more `SCAN u` |
| Stats pass + rows pass, together | **6 ms** (was 495 ms for the single old query) |
| Page | 50 rows, "Page 1 of 17" |
| CSV header | 19 columns, identical names and order to the pre-change export |
| Case-insensitive search | `?q=QA+Cap` and `?q=qa+cap` → 2 customers on the page **and** 2 rows in the CSV |
| Paging all 17 pages | 813/813 unique, no duplicates, with and without the tiebreaker |
| `npm run test:unit` | 326/326 |
| `npm run test:api` | 154/154 |
| Visual baselines | `admin-customers` desktop + mobile regenerated |

Net diff across the four source files: **+132 / −199**, including the new
`src/lib/customersView.ts`.

## Out of scope

- Unbounded CSV export: `type=customers` still has no LIMIT. Fast with the index,
  but it remains the one path that materialises every customer.
- Instant type-ahead search is intentionally gone (GET-form decision). 50-row
  pages make browser Ctrl+F a usable substitute within a page.
- No prod DB backup/runbook exists (noted in `move-to-prod.md`); unrelated.
