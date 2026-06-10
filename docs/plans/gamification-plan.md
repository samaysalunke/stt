# Gamification Implementation Plan
**Branch:** `feature/gamification`
**Spec:** `gamification_spec.md`
**Priority:** Phase 2
**Depends on:** `feature/auth` (user social login), `feature/rbac` (users table)

---

## What this builds
- **Km from home** stat: haversine sum across all confirmed+completed trips from user's home city
- **Leaderboard** page: three tabs (km / days outdoors / destinations), top 20, pinned row, blur-gate for unauth
- **Username** system: auto-generated slug, one free change, reserved word protection
- **Leaderboard opt-out** toggle

---

## Current State
- `users` table created in `feature/rbac`
- `registrations` table has `city` field (user's home city at booking time)
- Trips stored as YAML in `src/content/trips/` — no `latLng` field yet
- No geocoding, no stats calculation

---

## Step 1: Extend users table
**File:** `src/lib/db.ts` → add migration in `initializeSchema`

```sql
ALTER TABLE users ADD COLUMN username TEXT UNIQUE;
ALTER TABLE users ADD COLUMN usernameChangedAt INTEGER;   -- epoch; null = never changed
ALTER TABLE users ADD COLUMN usernameShownAt INTEGER;     -- epoch; null = onboarding banner not yet shown
ALTER TABLE users ADD COLUMN leaderboardOptOut INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN showTripsPublicly INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN homeCityLatLng TEXT;         -- display only: "lat,lng" of most recent booking city
```

Add geocode cache table:
```sql
CREATE TABLE IF NOT EXISTS geocode_cache (
  query TEXT PRIMARY KEY,     -- lowercased city/location name
  lat REAL,
  lng REAL,
  resolvedAt INTEGER DEFAULT (unixepoch())
);
```

---

## Step 2: Geocoding library
**New file:** `src/lib/geocode.ts`

### `geocodeCity(query: string): Promise<{lat: number, lng: number} | null>`
1. Normalise: lowercase, trim
2. Check `geocode_cache` — return cached result if found
3. Call Nominatim: `https://nominatim.openstreetmap.org/search?q={query}&format=json&limit=1`
4. On success: insert into `geocode_cache`, return `{lat, lng}`
5. On failure / empty result: insert `{lat: null, lng: null}` to avoid re-querying, return null
6. Rate limit: 1 request/second (Nominatim ToS); use a simple queue/delay

### `haversineKm(a: {lat:number,lng:number}, b: {lat:number,lng:number}): number`
Pure function. Standard haversine formula. Returns km as float.

---

## Step 3: Trip YAML — add `latLng` field
**File:** `src/content/trips/*.yaml`

Add to each trip YAML:
```yaml
location: "Leh, Ladakh"
latLng: "34.1526,77.5771"   # geocoded at import time, stored as "lat,lng" string
```

**Script:** `scripts/geocode-trips.ts` — reads all trip YAMLs, geocodes missing `latLng` fields, writes back.
Run once during `feature/gamification` setup; then geocode new trips at import time.

Trip import page (`src/pages/admin/trips/import.astro`): auto-geocode `location` field on import, store `latLng`.

---

## Step 4: Stats calculation
**New file:** `src/lib/stats.ts`

All stats functions take `userId` but resolve registrations via **email join**:
```sql
SELECT r.* FROM registrations r
JOIN users u ON r.email = u.email
WHERE u.id = ? AND r.status IN ('confirmed','completed')
```

### `kmsFromHome(userId: string): number | null`
```
1. Get all confirmed+completed registrations via email join (above)
2. For each registration independently:
   a. homeCityLatLng = geocodeCity(registration.city) via geocode_cache
      ← ALWAYS use the city from this specific booking, never users.homeCityLatLng
      (spec: "if user moved, use the city from each individual booking")
   b. tripLatLng = trip YAML `latLng` field
   c. If either is null: skip this trip (do not count as 0)
3. Sum haversineKm for all valid pairs
4. Round to nearest 10
5. If no valid pairs: return null (display as "—")
```

> `users.homeCityLatLng` is **display-only** (e.g. "Home: Mumbai" on profile). It is updated to the geocoded lat/lng of the most recent booking's city as a convenience. It is **never** used as input to km math.

### `daysOutdoors(userId: string): number`
Sum of `(endDate - startDate + 1)` for all confirmed+completed registrations (email join).
Read trip `startDate`/`endDate` from YAML.

### `destinationsCount(userId: string): number`
Count of distinct trip `location` values across confirmed+completed registrations (email join).

### `getUserStats(userId: string): { kms: number|null, days: number, destinations: number }`
Calls the three above. Called on profile load and leaderboard generation.

### `recalculateLeaderboard(): void`
Called in two places:
1. End of `src/pages/api/register.ts` when a booking is confirmed
2. After any trip's `location`/`latLng` is updated in `src/pages/api/admin/trips/[slug].ts` — spec edge case #5: "Trip location changes after booking: recompute that trip's km contribution on next profile load." Wiring into the trip save handler ensures the cache never goes stale after a YAML edit.
Writes pre-computed rankings to a `leaderboard_cache` table (avoids per-request full-table scan):
```sql
CREATE TABLE IF NOT EXISTS leaderboard_cache (
  userId TEXT NOT NULL,
  metric TEXT NOT NULL CHECK(metric IN ('kms','days','destinations')),
  value REAL,
  tripCount INTEGER,
  rank INTEGER,
  computedAt INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY (userId, metric)
);
```

---

## Step 5: Username system
**New file:** `src/lib/usernames.ts`

### `generateUsername(displayName: string): string`
1. Slugify: lowercase, replace spaces with hyphens, strip non-alphanumeric
2. Check against reserved words: `['admin','trips','about','faq','contact','u','api','profile','login','logout']`
3. Check `users` table for collision
4. On collision: append `-2`, `-3` etc. until unique
5. Return final username

### `isUsernameChangeAllowed(userId: string): boolean`
Returns true if `usernameChangedAt IS NULL` (never changed before).

Called on username change form submit.

### Username onboarding banner (first profile visit)
On first `/profile` load after username is generated: if `usernameShownAt IS NULL`, show a dismissible banner:
```
Your profile URL is seekthethrill.in/u/{username}   [Copy]
```
On copy or dismiss: POST `/api/user/username-seen` → sets `usernameShownAt = now()`.
This is a one-time onboarding moment, distinct from the share moment banner.

---

## Step 6: Leaderboard page
**New file:** `src/pages/leaderboard.astro`

Server-rendered. Reads from `leaderboard_cache`.

### Layout
- Three tab buttons: `Km from home` (default) · `Days outdoors` · `Destinations`
- Tab state managed client-side (React island or simple JS toggle)
- Top 20 rows: `rank · avatar · first name + last initial · stat value · trips count`
- If logged-in user is rank > 20: pin their row at bottom with separator
- If not logged in: show top 20 but blur rows 11-20 with overlay: `Log in to see your rank`

### Row component
```
#1   [avatar]   Samay S.    8,420 km    6 trips
```
Avatar: `<img>` from `users.avatarUrl`, fallback to initials circle in coral.
Last name: truncated to initial (`Salunke` → `S.`).

---

## Step 7: Opt-out toggle

In user profile settings page (to be built in `feature/auth` or alongside):
- Checkbox: `Show me on the leaderboard` (default: on)
- On toggle: PATCH `/api/user/settings` → updates `users.leaderboardOptOut`

Leaderboard query: `WHERE leaderboardOptOut = 0`

---

## Booking ↔ user link: email matching (not a FK)

**Booking is always anonymous — no login required.** `registrations` gets no `userId` column.

The link is: `registrations.email = users.email`. When a user logs in with Google using the email they booked with, all their confirmed+completed registrations are attributed automatically. No backfill needed — every stats query does the join on email.

## Step 8: Home city geocoding at booking time
**File:** `src/pages/api/register.ts`

After booking is created, geocode the submitted city (non-blocking, failure is silent):
```typescript
const latLng = await geocodeCity(form.city);
// Always cache the result for use in km calculation later
// Also update the user's display-only homeCityLatLng (most recent booking city)
if (latLng) {
  db.prepare(`
    UPDATE users SET homeCityLatLng = ? WHERE email = ?
  `).run(`${latLng.lat},${latLng.lng}`, form.email);
}
```

If no user account exists for this email yet, the geocoded result is stored in `geocode_cache`. When stats are calculated later (after the user logs in), `kmsFromHome` will hit the cache for every `registration.city` lookup — no re-geocoding needed.

Does not block registration.

---

## Test cases — done when all pass

| # | Test | How to verify |
|---|------|---------------|
| 1 | `haversineKm({lat:28.6,lng:77.2}, {lat:34.1,lng:77.6})` ≈ 617 km | Unit test |
| 2 | `kmsFromHome` returns null when no home city geocoded | Unit test with mock db |
| 3 | `kmsFromHome` excludes trips where trip has no `latLng` | Unit test |
| 4 | Geocoding failure does not throw or block registration | Integration test |
| 5 | Same city not geocoded twice (cache hit) | Unit test: spy on Nominatim call |
| 6 | `generateUsername('Samay Salunke')` → `samay-salunke` | Unit test |
| 7 | `generateUsername` on collision → `samay-salunke-2` | Unit test |
| 8 | Reserved word `admin` rejected | Unit test |
| 9 | Second username change blocked | Unit test: `usernameChangedAt` set |
| 10 | Leaderboard: opted-out user absent from all three tabs | E2E / integration |
| 11 | Leaderboard: unauth user sees blur on bottom rows | Playwright |
| 12 | Logged-in user outside top 20 sees pinned row | Playwright with seeded data |
| 13 | All 55 existing E2E tests still pass | `npm run test:e2e` |
