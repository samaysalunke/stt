# Public Profile + Referral
# Feature branch: feature/public-profile

---

## Depends on

- `feature/auth` — user identity, social login, userId
- `feature/gamification` — stats strip, leaderboard rank, km from home

Build after both of the above are merged.

---

## 1. Route

`seekthethrill.in/u/{username}`

Public, no auth required to view. Indexed by search engines. Canonical URL lives on the user record.

---

## 2. Page sections (top to bottom)

### Avatar + name + tagline

- Avatar from social provider (or initials circle)
- First name only (never full name on a public page)
- Tagline auto-generated: `{n} trips with Seek the Thrill` or `Explorer since {year}`

### Stats strip

Three numbers:
- Trips (confirmed + completed count)
- Destinations (unique locations)
- Km from home

Same component as the private profile. Read-only here.

### Leaderboard rank

One line: `#14 on the km from home board` — links to the full leaderboard page.
Hidden if user opted out of the leaderboard.

### Map pins (v1: static SVG of India)

Lightweight — no Leaflet, no tile provider, no API key. A static SVG outline of India with dots plotted at hardcoded lat/lng positions for each STT destination. Filled dot = completed, outlined = upcoming.

Upgrade to interactive Leaflet map in v2 when international trips exist or the destination count grows past ~15.

### Trip list (opt-in only)

Hidden by default. If user has enabled `Show my trips publicly`:
- Trip name
- Location
- Status badge (upcoming / ongoing / completed)
- No dates (protects travel schedule)

If not opted in: section is absent entirely. Do not show a locked/blurred placeholder — that's an incentive dark pattern.

### CTA

```
Travel with Seek the Thrill

[Explore trips →]
```

Full-width, always present. Links to `/trips`. This is the only action on the page.

---

## 3. The share moment (trigger for referral)

On the user's private profile page, when a trip has just transitioned to `completed` for the first time (endDate passed, booking is confirmed, and the `sharedAt` field for that trip is null):

Show a dismissible banner at the top of the private profile:

```
[Trip name] just wrapped. Your profile is updated.

seekthethrill.in/u/{username}   [Copy link]
```

On `Copy link` tap: copy URL to clipboard, mark `sharedAt = now()` for that trip so this banner never re-shows.
On dismiss (×): mark `sharedAt = dismissed`, same effect.

Only one trip surfaces this at a time (most recently completed). If multiple trips are newly completed, queue them — show one, then the next on the following visit.

---

## 4. SEO and meta tags

Public profiles should be crawlable and shareable.

```html
<title>{firstName}'s trips with Seek the Thrill</title>
<meta name="description" content="{n} trips · {destinations} destinations · {km}km from home" />
<meta property="og:title" content="{firstName} on Seek the Thrill" />
<meta property="og:description" content="{n} trips across India with @seekthethrill_" />
<meta property="og:image" content="[generated card image or STT default OG image]" />
```

OG image: use the STT default brand image for v1. A generated card (avatar + stats on a branded background) is a strong v2 — it's what makes the WhatsApp preview look good.

---

## 5. Privacy rules (enforced server-side, not just UI)

- Full name: never exposed on public profile, even in API response
- Email: never exposed
- Booking dates: never exposed unless user opts in (and even then, excluded)
- Pending / lead bookings: never exposed, ever
- `city` field from booking form: never exposed

The public profile API endpoint must strip all of the above before returning. Do not rely on the frontend to hide them.

---

## 6. Username rules

- Auto-generated from display name on first social login
- Lowercase, hyphens only, no special characters: `samay-salunke`
- Collision: append `-2`, `-3` etc.
- User can change once. After that, locked (broken links are worse than an ugly handle).
- Reserved: `admin`, `trips`, `about`, `faq`, `contact`, `u`, `api`, `profile`, `login`, `logout` — cannot be used as usernames.

---

## 7. Edge cases

1. **User deletes their account:** username is released after 30 days (so a shared link shows a graceful 404 for a month, not an immediate takeover).
2. **Profile with zero public trips and no opt-in:** the page still exists and shows the CTA. It's a valid, minimal page.
3. **Leaderboard opt-out + public profile:** profile still shows their personal stats, just no rank line.
4. **Username change:** old URL 301-redirects to new URL for 90 days, then returns 404.

---

## 8. What this is not

- Not a referral code system. No discount, no tracking parameter. The URL is the referral.
- Not a booking link for a specific trip. The CTA goes to `/trips`, not a pre-filled booking.
- Not a social network. No following, no feed, no notifications from other users' activity.
