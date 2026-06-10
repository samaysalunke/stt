# STT Feature Roadmap
**Open this file before every coding session.**
Spec sources: `rbac_spec.md` · `gamification_spec.md` · `public_profile_spec.md`
Per-feature plans: `docs/plans/rbac-plan.md` · `docs/plans/gamification-plan.md` · `docs/plans/public-profile-plan.md`

---

## Phase order

```
Phase 0  feature/auth          User social login (Google) — PREREQUISITE, not yet specced
Phase 1  feature/rbac          Close admin security hole
Phase 2  feature/gamification  Km from home · leaderboard · username
Phase 3  feature/public-profile Public profile URL · share moment · SEO
```

Each phase depends on the previous. Do not start Phase 2 before Phase 1 is merged.

---

## Phase 0 — `feature/auth` (prerequisite, needs its own spec)

Before any other phase can land, the following must exist:

- [ ] Google OAuth login for public-facing users (`/login`)
- [ ] `users` table (id, email, displayName, avatarUrl, googleId, createdAt, lastLoginAt)
- [ ] User session cookie (`userSessionToken`, separate from `adminSessionToken`)
- [ ] `/profile` page (private, auth-required): shows user's own bookings

**This spec needs to be written before building.**

### Login UI entry points (confirmed)
- **Desktop:** header top-right login button
- **Mobile:** hamburger menu item
- **Leaderboard:** blur-gate "Log in to see your rank" links to this same login flow — not a separate modal
- **Post-booking nudge (proposed, not in spec):** After the Step 3 confirmation screen (`submitted === 'pending'` or `submitted === 'lead'`), show:
  > "Track your adventures. Sign in to see your km from home and join the leaderboard."
  > [Sign in with Google →]
  This is the highest-intent conversion moment — the traveller just booked. Natural point to get them to create an account.

### Booking is always anonymous — login is never required to book

This is explicit in the specs. The existing booking flow is untouched. No `userId` is written to `registrations` at booking time.

The link between bookings and a user account is **email matching**: when a user logs in with Google using the same email they used to book, their confirmed+completed registrations are attributed to their account by joining `registrations.email = users.email`.

This means:
- `registrations` table needs **no schema change** for auth/gamification
- A user who never logs in has no profile, no leaderboard entry, no username — their bookings are just anonymous records
- A user who logs in after booking retroactively gets all their old bookings counted in stats immediately
- The `gamification_spec` edge case "booked before this field existed" is handled by this: if the email match finds bookings with no `city` geocoded, those trips are excluded from km (show `—` not `0`)

---

## Phase 1 — `feature/rbac`
**Goal:** Admin panel inaccessible without a role. Google OAuth replaces password.

### Build order
1. DB: add `users`, `user_roles`, `admin_sessions`, `audit_log` tables → `src/lib/db.ts`
2. Audit helper → `src/lib/audit.ts`
3. Google OAuth callback → `src/pages/api/admin/auth/callback.ts`
4. Replace admin login page with Google Sign In button → `src/pages/admin/login.astro`
5. Rewrite middleware: token validation + role check + idle timeout → `src/middleware.ts`
6. Wire audit logging into all existing write API endpoints
7. Role management UI → `src/pages/admin/settings/roles.astro` + `src/pages/api/admin/roles.ts`
8. Audit log viewer → `src/pages/admin/audit.astro`
9. Scope `trip_lead` participant view → `src/pages/admin/registrations/index.astro`
10. Tests → E2E + integration

### Done when
- [ ] Unauthenticated `/admin` → 302 to `/admin/login`
- [ ] No-role user → "You don't have access" page
- [ ] `ops` blocked from `/admin/trips/new`
- [ ] `trip_lead` sees only assigned trips
- [ ] Owner can add/remove roles; cannot remove last owner
- [ ] Every write action in audit log
- [ ] Session expires 8h; idle timeout 2h
- [ ] All 55 existing E2E tests pass

---

## Phase 2 — `feature/gamification`
**Goal:** Users have stats. Leaderboard page live. Usernames generated.

### Build order
1. DB: extend `users` (username, leaderboardOptOut, showTripsPublicly, homeCityLatLng), add `geocode_cache`, `leaderboard_cache` → `src/lib/db.ts`
2. Geocoding library → `src/lib/geocode.ts`
3. Run `scripts/geocode-trips.ts` to backfill `latLng` on all trip YAMLs
4. Stats calculation → `src/lib/stats.ts` (`kmsFromHome`, `daysOutdoors`, `destinationsCount`, `recalculateLeaderboard`)
5. Username system → `src/lib/usernames.ts`
6. Hook home-city geocoding into `src/pages/api/register.ts` (non-blocking)
7. Hook `recalculateLeaderboard()` into booking confirmation path
8. Leaderboard page → `src/pages/leaderboard.astro`
9. Opt-out toggle in profile settings
10. Tests

### Done when
- [ ] `haversineKm` unit test passes for known city pair
- [ ] `kmsFromHome` returns null when no home city
- [ ] Geocoding failure does not block booking
- [ ] Geocode cache prevents duplicate API calls
- [ ] `generateUsername` handles collisions and reserved words
- [ ] One username change allowed; second blocked
- [ ] Leaderboard: opted-out user absent from all tabs
- [ ] Leaderboard: unauth blur on bottom rows
- [ ] Logged-in user outside top 20 sees pinned row
- [ ] All 55 existing E2E tests pass

---

## Phase 3 — `feature/public-profile`
**Goal:** Public URL exists. Share moment works. SEO ready.

### Build order
1. DB: add `username_redirects`, `trip_share_prompts` → `src/lib/db.ts`
2. Destinations data → `src/lib/destinations.ts`
3. India SVG map component → `src/components/IndiaMap.tsx`
4. Public profile API (strips private fields) → `src/pages/api/u/[username].ts`
5. Username redirect middleware → `src/middleware.ts`
6. Public profile page with SEO → `src/pages/u/[username].astro`
7. Share moment banner + API → `src/pages/profile.astro` + `src/pages/api/user/share-prompt/[tripSlug].ts`
8. Username change flow + redirect row creation
9. Tests

### Done when
- [ ] GET `/u/valid-username` → 200; GET `/u/nonexistent` → 404
- [ ] API never returns email, phone, fullName, city (automated assertion)
- [ ] API never returns lead/pending bookings
- [ ] `showTripsPublicly = false` → trips array empty
- [ ] `leaderboardOptOut = true` → rank is null
- [ ] OG meta tags correct
- [ ] Old username 301 within 90 days; 404 after
- [ ] Share banner shows once; dismissed → never re-appears
- [ ] India map loads with zero external network requests
- [ ] All 55 existing E2E tests pass

---

## Cross-phase constraints

- **Never geocode at render time.** Only at booking confirmation or trip import.
- **Privacy is server-enforced.** Public profile API strips fields in the response handler — the frontend never receives them.
- **Admin sessions are separate from user sessions.** Two distinct cookies, never interchangeable.
- **Existing 55 tests must pass after every phase.** Run `npm run test:e2e` before merging.

---

## Open decisions

| # | Decision | Notes |
|---|----------|-------|
| 1 | ~~Is social login required to book?~~ | **Resolved: No. Booking is always anonymous. Link via email match.** |
| 2 | ~~Where does user-facing login UI live?~~ | **Resolved: header top-right (desktop) + hamburger menu (mobile). Leaderboard blur-gate links to same flow.** |
| 3 | OG image: branded generated card vs. STT default? | Spec says default for v1, generated card for v2 |
| 4 | Leaderboard: separate page `/leaderboard` or embedded on home? | Spec says separate page |
| 5 | India SVG: which destinations are hardcoded for v1? | Derive from existing trip YAMLs |

---

## New tables summary (all phases)

| Table | Phase | Purpose |
|-------|-------|---------|
| `users` | 0/1 | Identity, social login, preferences |
| `user_roles` | 1 | Admin role assignments |
| `admin_sessions` | 1 | Admin session tokens (separate from user) |
| `audit_log` | 1 | Immutable write history |
| `geocode_cache` | 2 | Nominatim results, avoid re-querying |
| `leaderboard_cache` | 2 | Pre-computed ranks per metric |
| `username_redirects` | 3 | 301 redirect when username changes |
| `trip_share_prompts` | 3 | Track which completed trips have been shared |
