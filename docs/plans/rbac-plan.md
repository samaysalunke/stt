# RBAC Implementation Plan
**Branch:** `feature/rbac`
**Spec:** `rbac_spec.md`
**Priority:** Phase 1 — build first (closes open admin security hole)
**Depends on:** `feature/auth` (Google OAuth provider setup)

---

## Problem
The admin panel (`/admin/*`) has zero authentication. Anyone with the URL can access it. This spec closes that gap and introduces scoped roles.

---

## Current State
- `src/middleware.ts` — validates a SHA256-hashed password cookie (`admin_token`)
- `src/pages/api/admin/login.ts` — issues the password cookie
- `src/pages/admin/login.astro` — password form
- No `users` table, no `user_roles` table, no audit log

---

## Step 1: Database schema additions
**File:** `src/lib/db.ts` → `initializeSchema(db)`

Add four new tables:

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  displayName TEXT,
  avatarUrl TEXT,
  googleId TEXT UNIQUE,
  createdAt INTEGER DEFAULT (unixepoch()),
  lastLoginAt INTEGER
);

CREATE TABLE IF NOT EXISTS user_roles (
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('owner','ops','trip_lead')),
  assignedBy TEXT REFERENCES users(id),
  assignedAt INTEGER DEFAULT (unixepoch()),
  tripIds TEXT DEFAULT '[]',   -- JSON array of trip slugs; only used for trip_lead
  PRIMARY KEY (userId, role)
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expiresAt INTEGER NOT NULL,
  lastActivityAt INTEGER NOT NULL,
  ipAddress TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actorUserId TEXT REFERENCES users(id),
  actorRole TEXT,
  action TEXT NOT NULL,
  targetType TEXT,
  targetId TEXT,
  previousValue TEXT,  -- JSON snapshot
  newValue TEXT,       -- JSON snapshot
  timestamp INTEGER DEFAULT (unixepoch()),
  ipAddress TEXT
);
```

---

## Step 2: Audit logging helper
**New file:** `src/lib/audit.ts`

```typescript
export function logAction(params: {
  actorUserId: string;
  actorRole: string;
  action: string;          // e.g. 'booking.confirm', 'role.assign', 'trip.edit'
  targetType: string;      // 'booking' | 'user' | 'trip' | 'role'
  targetId: string;
  previousValue?: unknown;
  newValue?: unknown;
  ipAddress?: string;
})
```

Wire into every write endpoint under `src/pages/api/admin/`:
- `booking.confirm`, `booking.reject` → `src/pages/api/admin/registrations/[id]/status.ts` (or equivalent)
- `trip.create`, `trip.edit`, `trip.delete` → `src/pages/api/admin/trips/*.ts`
- `role.assign`, `role.remove` → new `src/pages/api/admin/roles.ts`

---

## Step 3: Replace admin auth with Google OAuth

### 3a. Google OAuth callback endpoint
**New file:** `src/pages/api/admin/auth/callback.ts`
- Exchanges `code` param for Google ID token
- Fetches user profile (email, displayName, avatarUrl, googleId)
- Upserts into `users` table
- Looks up `user_roles` for this userId
- **Role found:** create `admin_sessions` row (token = `crypto.randomUUID()`, expiresAt = now + 8h, lastActivityAt = now), set `adminSessionToken` cookie (httpOnly, sameSite=lax, secure in prod), redirect to originally-requested URL
- **No role:** render error page: `You don't have access to the admin panel.`

### 3b. Admin login page
**Replace:** `src/pages/admin/login.astro`
- Remove password form
- Show Google Sign In button → links to Google OAuth URL with `redirect_uri=/api/admin/auth/callback`

### 3c. Admin logout
**Update:** `src/pages/api/admin/logout.ts`
- Delete `admin_sessions` row for current token
- Clear `adminSessionToken` cookie

### 3d. Environment variables needed
```
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
ADMIN_OAUTH_REDIRECT_URI   # https://seekthethrill.in/api/admin/auth/callback
```

---

## Step 4: Middleware rewrite
**File:** `src/middleware.ts`

Replace password-check with:
1. Read `adminSessionToken` cookie
2. Look up `admin_sessions` WHERE `token = ? AND expiresAt > now()`
3. Check `lastActivityAt` — if `now() - lastActivityAt > 7200` (2h idle): delete session, redirect to login
4. Update `lastActivityAt = now()`
5. Resolve `user_roles` for userId
6. Attach `locals.adminUser = { userId, role, tripIds }` to request context
7. Permission matrix check (see below)

### Permission matrix enforcement
```typescript
const PERMISSIONS: Record<string, ('owner' | 'ops' | 'trip_lead')[]> = {
  'GET /admin/trips':            ['owner', 'ops'],
  'POST /admin/trips':           ['owner'],
  'GET /admin/registrations':    ['owner', 'ops'],
  // ... full matrix
  'GET /admin/settings/roles':   ['owner'],
  'POST /api/admin/roles':       ['owner'],
  'GET /admin/audit':            ['owner'],
};
```

For `trip_lead` on participant-list routes: additionally check `tripId ∈ locals.adminUser.tripIds`.

---

## Step 5: Role management UI
**New file:** `src/pages/admin/settings/roles.astro` (owner only)

Page layout:
```
User              Role          Trips (if lead)    Assigned by    Actions
Zahra S.          owner         —                  —              —
Prateek S.        trip_lead     Kashmir Jun        Zahra          [Remove]
[+ Add role]
```

`+ Add role` form:
- Search existing users by name/email
- Select role
- If `trip_lead`: multi-select trip slugs
- Submit → POST `/api/admin/roles` → writes to `user_roles`, logs to `audit_log`

Constraints enforced server-side:
- Cannot remove last `owner`
- Cannot demote/remove yourself

---

## Step 6: Audit log viewer
**New file:** `src/pages/admin/audit.astro` (owner only)

Table: timestamp · actor · role · action · target · diff (expandable JSON)
Paginated, 50 per page. Read-only. No delete.

---

## Step 7: Ops flows (payment verification under RBAC)

Existing registration management pages work as-is for `ops` and `owner`.
Add `trip_lead` participant-list view — filtered server-side by `tripIds`.

Update `src/pages/admin/registrations/index.astro`:
- If role is `trip_lead`: filter registrations to only show `batch_id ∈ tripIds`
- Remove payment verification buttons for `trip_lead` (server-side, not just CSS)

**Confirm flow:**
- Booking status → `confirmed`; seat held
- Admin UI surfaces a WhatsApp click-to-message link for the traveller's phone number so ops can manually notify them

**Reject flow (spec §7):**
- Modal with reason dropdown: `Payment not found / Screenshot unclear / Other` + optional free-text field
- On confirm: booking status → `lead`; write reason to `registrations.admin_notes` (column already exists)
- Admin UI surfaces WhatsApp click-to-message link for manual notification to traveller
- Both actions logged to `audit_log`

> WhatsApp notification is manual (ops clicks the link) — not an automated API. The system surfaces the number and pre-fills a message template via a `https://wa.me/{phone}?text=...` link.

---

## Test cases — done when all pass

| # | Test | How to verify |
|---|------|---------------|
| 1 | Unauthenticated GET `/admin` → 302 to `/admin/login` | Playwright: `page.goto('/admin')`, assert URL |
| 2 | OAuth success with no role → "You don't have access" page | Integration test: mock Google callback, assert error page |
| 3 | `ops` role: GET `/admin/trips/new` → 403 | Playwright with ops session cookie |
| 4 | `trip_lead` sees only assigned trips | Playwright: `trip_lead` with tripIds=[A]; assert trip B absent |
| 5 | `owner` can add a role; appears in table | Playwright: add role, assert row |
| 6 | Cannot remove last owner | API test: DELETE last owner → 409 |
| 7 | Every write action appears in audit log | Integration: confirm booking → assert audit_log row |
| 8 | Session expires after 8h | Unit: set expiresAt = now-1, assert 302 to login |
| 9 | Idle timeout after 2h | Unit: set lastActivityAt = now-7201, assert session deleted |
| 10 | Existing 55 E2E tests still pass | `npm run test:e2e` |
