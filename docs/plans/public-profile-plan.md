# Public Profile Implementation Plan
**Branch:** `feature/public-profile`
**Spec:** `public_profile_spec.md`
**Priority:** Phase 3 — build last
**Depends on:** `feature/auth` (userId, social login), `feature/gamification` (username, stats, leaderboard rank)

---

## What this builds
- Public URL: `seekthethrill.in/u/{username}` — crawlable, no auth required
- Avatar, first name, tagline, stats strip, leaderboard rank, India map pins, optional trip list, CTA
- Share moment: one-time dismissible banner after a trip completes
- SEO meta tags + OG tags
- Username change → 301 redirect for 90 days

---

## Current State (after `feature/gamification` merged)
- `users` table: id, email, displayName, avatarUrl, username, usernameChangedAt, leaderboardOptOut, showTripsPublicly
- `leaderboard_cache` table: pre-computed ranks per metric
- `src/lib/stats.ts`: `getUserStats()` ready
- No public-facing user routes exist

---

## Step 1: Username redirect table + account deletion
**File:** `src/lib/db.ts` → `initializeSchema`

```sql
CREATE TABLE IF NOT EXISTS username_redirects (
  oldUsername TEXT PRIMARY KEY,
  newUsername TEXT,                -- NULL = account deleted (show 404, not redirect)
  redirectUntil INTEGER NOT NULL   -- epoch; process until this date, 404 after
);
```

Also add `deletedAt` to users:
```sql
ALTER TABLE users ADD COLUMN deletedAt INTEGER;  -- null = active account
```

**On username change:**
1. Check `isUsernameChangeAllowed(userId)` → only once
2. Insert `(oldUsername, newUsername, redirectUntil = now + 7776000)` (90 days → 301)
3. Update `users.username` + set `usernameChangedAt = now()`

**On account deletion:**
1. Set `users.deletedAt = now()`
2. Insert `(oldUsername, newUsername = NULL, redirectUntil = now + 2592000)` (30 days)
3. After 30 days: middleware returns 404 and the username becomes claimable again

---

## Step 2: Share moment tracking
**File:** `src/lib/db.ts`

```sql
CREATE TABLE IF NOT EXISTS trip_share_prompts (
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tripSlug TEXT NOT NULL,
  completedAt INTEGER NOT NULL,  -- trip end date epoch, used for ordering (most recently completed first)
  sharedAt INTEGER,              -- null = not yet acted on; epoch = dismissed or link copied
  PRIMARY KEY (userId, tripSlug)
);
```

**Population trigger:** when a booking transitions to `confirmed` and `endDate < today`, insert `(userId, tripSlug, completedAt = endDate epoch, sharedAt = null)` if not exists. (Check on each profile page load — no background job needed.)

**Query for banner:** `WHERE sharedAt IS NULL ORDER BY completedAt DESC LIMIT 1`
(spec: "most recently completed" — not alphabetical by slug)

---

## Step 3: Public profile API
**New file:** `src/pages/api/u/[username].ts`

GET endpoint. No auth required.

Response shape (enforced server-side — never trust frontend to hide):
```typescript
{
  username: string;
  firstName: string;          // displayName.split(' ')[0]
  avatarUrl: string | null;
  tagline: string;            // "{n} trips with Seek the Thrill" or "Explorer since {year}"
  stats: {
    trips: number;
    destinations: number;
    kms: number | null;
  };
  leaderboardRank: number | null;  // null if opted out
  trips: Array<{               // empty array if showTripsPublicly = false
    name: string;
    location: string;
    status: 'upcoming' | 'ongoing' | 'completed';
  }>;
}
```

Fields NEVER returned (assert in tests):
- `email`, `phone`, `fullName`, `city`, `startDate`, `endDate`
- Bookings with status `lead` or `pending`

Returns 404 if username not found.

---

## Step 4: Username redirect middleware
**File:** `src/middleware.ts`

On requests to `/u/[username]`:
1. Check `username_redirects` WHERE `oldUsername = username AND redirectUntil > now()`
2. If found AND `newUsername IS NOT NULL`: `return Response.redirect('/u/' + row.newUsername, 301)`
3. If found AND `newUsername IS NULL` (account deleted): `return new Response(null, { status: 404 })`
4. If found but `redirectUntil` expired: `return new Response(null, { status: 404 })` (username released)
5. Otherwise: continue to page handler

Also check `users.deletedAt` in the page handler — if the account is deleted but within the 30-day grace window, the `username_redirects` row handles the 404. After 30 days, the user row may still exist but `deletedAt` is set; the page handler should treat this as 404.

---

## Step 5: Public profile page
**New file:** `src/pages/u/[username].astro`

SSR. `export const prerender = false`.

Fetches from the API endpoint above (or calls the same data-access functions directly).

### Head (SEO)
```astro
<title>{firstName}'s trips with Seek the Thrill</title>
<meta name="description" content="{trips} trips · {destinations} destinations · {kms}km from home" />
<meta property="og:title" content="{firstName} on Seek the Thrill" />
<meta property="og:description" content="{trips} trips across India with @seekthethrill_" />
<meta property="og:image" content="/og-default.jpg" />
<link rel="canonical" href="https://seekthethrill.in/u/{username}" />
```

### Page sections (in order)

**1. Avatar + name + tagline**
- `<img>` from `avatarUrl`, fallback: coral circle with first initial
- First name only (never display full name)
- Tagline below name in muted text

**2. Stats strip**
Three pill-style stat blocks: `Trips · Destinations · Km from home`
Reuse styling from existing stats components if available.

**3. Leaderboard rank**
One line: `#14 on the km from home leaderboard →` (links to `/leaderboard`)
Hidden entirely if `leaderboardRank === null`.

**4. India map (SVG)**
**New component:** `src/components/IndiaMap.tsx`
- Static SVG outline of India (inline, no external requests)
- Hardcoded destination coordinates: one `<circle>` per STT destination in `src/lib/destinations.ts`
- Filled dot = completed trip at that location; outlined = upcoming
- Props: `completedLocations: string[], upcomingLocations: string[]`
- v1: non-interactive. v2 upgrade path: swap for Leaflet when >15 destinations or international trips.

**5. Trip list** (conditional)
Only rendered if `showTripsPublicly = true`.
No dates. Columns: trip name · location · status badge.
If `showTripsPublicly = false`: section absent entirely (no locked placeholder).

**6. CTA block**
```
Travel with Seek the Thrill
[Explore trips →]   → /trips
```
Full-width, always present, matches site button style.

---

## Step 6: India map destinations data
**New file:** `src/lib/destinations.ts`

```typescript
export const STT_DESTINATIONS: Record<string, {lat: number, lng: number}> = {
  'Leh, Ladakh': { lat: 34.1526, lng: 77.5771 },
  'Kasol, Himachal Pradesh': { lat: 32.0100, lng: 77.3149 },
  // ... one entry per unique trip location
};
```

Populated once from existing trip YAMLs. `IndiaMap` component uses this to place dots.

---

## Step 7: Share moment banner (private profile)

**File:** `src/pages/profile.astro` (or wherever the private profile lives, built in `feature/auth`)

On page load:
1. Query `trip_share_prompts` WHERE `userId = ? AND sharedAt IS NULL` ORDER BY `completedAt DESC` LIMIT 1
2. If found: render dismissible banner at top of page
3. Banner: `{tripName} just wrapped. Your profile is updated.` + URL display + `[Copy link]` button
4. `[Copy link]` → JS copies `https://seekthethrill.in/u/{username}` to clipboard → POST `/api/user/share-prompt/{tripSlug}` → sets `sharedAt = now()`
5. `[×]` dismiss → same POST with `action: 'dismissed'`

**New API:** `src/pages/api/user/share-prompt/[tripSlug].ts` (POST, requires user session)

---

## Test cases — done when all pass

| # | Test | How to verify |
|---|------|---------------|
| 1 | GET `/u/valid-username` → 200 with correct firstName | Integration test |
| 2 | GET `/u/nonexistent` → 404 | Integration test |
| 3 | API response never contains `email`, `phone`, `fullName`, `city` | Automated assertion on every response field |
| 4 | API response never contains lead/pending bookings | Integration test with seeded lead booking |
| 5 | `showTripsPublicly = false` → trips array is empty | Integration test |
| 6 | `leaderboardOptOut = true` → `leaderboardRank` is null | Integration test |
| 7 | OG `<meta>` tags present and correct | Playwright: check head tags |
| 8 | `<title>` is `{firstName}'s trips with Seek the Thrill` | Playwright |
| 9 | Old username 301-redirects to new within 90 days | Integration test |
| 10 | Old username 404 after 90 days | Integration test with expired `redirectUntil` |
| 15 | Deleted account: username returns 404 within 30-day grace window | Integration test with `newUsername = NULL` row |
| 16 | Deleted account: username claimable after 30 days | Integration test with expired deletion redirect |
| 11 | Share moment banner shows once; dismissed → never re-appears | Playwright |
| 12 | Copy link → `sharedAt` is set, banner gone on next load | Playwright |
| 13 | India map renders without network requests | Playwright: intercept network, assert no external fetches |
| 14 | All 55 existing E2E tests still pass | `npm run test:e2e` |
