# Gamification — Km from Home + Leaderboard + Public Profile
# Feature branch: feature/gamification

---

## 1. Km from home stat

### What it is

A running total of straight-line distances between the user's home city and each completed trip's location, summed across all confirmed + completed bookings.

User's home city comes from the `city` field collected in Step 2 of the booking form. Trip location comes from the `location` field on the trip record (already geocoded at import time per the auth spec).

### Formula

```
kmsFromHome = sum of haversine(userHomeCityLatLng, tripLocationLatLng)
              across all confirmed + completed bookings
```

Haversine gives straight-line distance. That's intentional — it measures how far someone reached from their daily life, not route distance. Round to the nearest 10km for display.

### Why it works

It rewards commitment, not just geography. A Chennai traveller doing Ladakh racks up more km than a Delhi traveller doing the same trip. That is fair — they came further. It also means the stat grows meaningfully with every trip, which is the retention mechanic.

### Geocoding

- Geocode home cities at booking time, store `homeCityLatLng` on the user record (or derive from their most recent booking's city field).
- If two bookings have different home cities (user moved), use the city from each individual booking for that trip's contribution.
- Geocode trip locations at YAML import time. Store `latLng` on the trip record. Never geocode at render time.
- Use a free geocoding API (Nominatim / OpenStreetMap) at import/booking time. One call per unique city, cache aggressively.

---

## 2. Leaderboard

### Three boards, one toggle

Let users switch between:

1. `Km from home` — sum of haversine distances across all trips
2. `Days outdoors` — sum of `(endDate - startDate + 1)` across completed trips
3. `Destinations` — count of unique trip locations visited

Default view: `Km from home`. Most dramatic numbers, strongest conversation starter.

### What each row shows

```
Rank   Avatar   Name              Stat value   Trips count
#1     [img]    Samay S.          8,420 km      6 trips
#2     [img]    Priya M.          7,100 km      5 trips
```

- Last name truncated to initial for privacy.
- Avatar from social provider, or initials circle fallback.
- Show top 20. If the logged-in user is outside top 20, pin their row at the bottom with their actual rank.
- If unauth, show the board but blur the bottom half with a `Log in to see your rank` prompt.

### Opt-out

A toggle in the profile: `Show me on the leaderboard`. On by default. If opted out, the user's row is removed from all three boards.

### Recalculation

Recalculate on every booking confirmation. No scheduled jobs needed at this scale.

---

## 3. Public profile

### URL

`seekthethrill.in/u/{username}`

Username is auto-generated from display name on first social login (Samay Salunke → `samay-salunke`, with a numeric suffix on collision). User can change it once from their profile settings. After that it is fixed (to avoid breaking shared links).

### What's public (always visible)

- Avatar and first name only (not full name)
- Stats strip: trips · destinations · km from home
- Leaderboard rank (if opted in)
- Map pins (locations only, no trip names or dates)
- `Book a trip with STT →` CTA linking to `/trips`

### What's private by default

- Trip list (names, dates, status)
- Pending / unconfirmed bookings (always private, no opt-in)

User can opt in to making their trip list public from profile settings: `Show my trips publicly`. If enabled, the trip list appears on the public profile with trip name, location, and status badge — no dates (dates reveal travel schedule).

### The share moment

When a trip transitions to `completed` (i.e. `endDate < today` and booking is `confirmed`), the next time the user visits their profile show a one-time prompt:

```
[Trip name] is done. Your profile just updated.

[Share your profile →]   copies seekthethrill.in/u/{username} to clipboard
```

Dismiss permanently once tapped or closed. Do not show again for that trip.

This is the highest-intent moment for a share — pride of completion, fresh memory.

### CTA on public profile

`Book a trip with STT →` is the only outbound action on a public profile. It goes to `/trips`. No referral tracking code needed for v1 — the conversion is the mechanic, not the attribution.

---

## 4. Edge cases

1. **User has no home city on record** (booked before this field existed, or field was blank): exclude their bookings from km calculation. Show `—` for the stat rather than 0.
2. **Geocoding fails for a city name** (typo, village, ambiguous): store null, exclude from km total. Do not block the booking.
3. **Username collision on generation:** append `-2`, `-3` etc. Show the user their auto-generated handle on first profile visit so they know what their URL is.
4. **Opted-out user appears in another user's leaderboard screenshot:** not a product problem. Opt-out only removes from the live board.
5. **Trip location changes after booking** (rare): recompute that trip's km contribution on next profile load.

---

## 5. What this is not

- Not a points/rewards system. No currency, no redemption. Just bragging rights.
- Not a social feed. No following, no likes, no comments.
- Not a referral programme with codes or discounts. The public profile URL is the referral mechanic.

---

## Open decisions (resolved for this spec)

- Apple Sign In: no.
- Map on profile: skipped for now. Public profile shows map pins only (lightweight, no full map component needed for v1 — can be a static SVG of India with pins).
- Leaderboard opt-out: opt-out (on by default).
- Username: auto-generated, one free change.
