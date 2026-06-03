# Seek the Thrill — QA Test Plan

**Site:** seekthethrill.in (local: http://localhost:4323)  
**Stack:** Astro 5 + Node adapter, SQLite, file-based YAML content  
**Test env:** dev server, password `changeme`

---

## How to read this document

Each test case follows this format:

> **TC-XXX** — Description  
> Steps | Expected | Notes

`[ ]` = not yet tested  `[x]` = passed  `[!]` = failed / needs fix

---

## 1. Public — Homepage (`/`)

| # | Test | Steps | Expected |
|---|------|-------|----------|
| `[ ]` TC-001 | Page loads | Navigate to `/` | 200, hero visible, no console errors |
| `[ ]` TC-002 | Trip cards render | Check trips section | Cards show name, price, date, location |
| `[ ]` TC-003 | "Book Now" CTA links correctly | Click any trip card | Goes to `/trips/[slug]` |
| `[ ]` TC-004 | Newsletter signup — valid email | Enter email, submit | Success message, no redirect |
| `[ ]` TC-005 | Newsletter signup — invalid email | Enter `notanemail`, submit | Inline error shown |
| `[ ]` TC-006 | Newsletter signup — duplicate email | Subscribe same email twice | No error thrown (idempotent) |
| `[ ]` TC-007 | Mobile layout | Resize to 375px | No overflow, readable font sizes |

---

## 2. Public — Trips Listing (`/trips`)

| # | Test | Steps | Expected |
|---|------|-------|----------|
| `[ ]` TC-010 | Page loads with all trips | Navigate to `/trips` | All non-draft trips visible |
| `[ ]` TC-011 | Draft trips hidden | Check trip with `status: draft` | Not shown on public listing |
| `[ ]` TC-012 | Sold-out badge | Trip with `status: sold-out` | Badge visible, "Book" CTA disabled/hidden |
| `[ ]` TC-013 | Card data accuracy | Compare card to YAML | Name, price, dates, duration match |

---

## 3. Public — Trip Detail (`/trips/[slug]`)

| # | Test | Steps | Expected |
|---|------|-------|----------|
| `[ ]` TC-020 | Page loads | Navigate to `/trips/spiti-valley-adventure` | 200, all sections visible |
| `[ ]` TC-021 | Itinerary accordion | Click a day row | Expands with activities, meals, notes |
| `[ ]` TC-022 | All itinerary days present | Count accordion rows | Matches YAML `itinerary` length |
| `[ ]` TC-023 | Included / not included lists | Scroll to section | Items match YAML |
| `[ ]` TC-024 | Packing list visible | Scroll to section | Items match YAML |
| `[ ]` TC-025 | Invalid slug | Navigate to `/trips/nonexistent` | 404 page |
| `[ ]` TC-026 | Draft trip URL direct access | Navigate to draft trip URL | 404 or redirect (not publicly served) |

### Registration form (embedded on trip detail)

| # | Test | Steps | Expected |
|---|------|-------|----------|
| `[ ]` TC-030 | Happy path submission | Fill all fields, submit | `{"success":true}`, thank-you redirect |
| `[ ]` TC-031 | Missing required field | Omit `fullName`, submit | Error `Missing required field: fullName` |
| `[ ]` TC-032 | Invalid email | Enter `bad@`, submit | Error `Invalid email address.` |
| `[ ]` TC-033 | Invalid phone | Enter `abc`, submit | Error `Invalid phone number.` |
| `[ ]` TC-034 | Sold-out trip | Trip `status: sold-out`, submit | Error `This trip is sold out.` |
| `[ ]` TC-035 | Honeypot filled | Set `_honey` field, submit | 400 `Invalid submission.` (silent to bots) |
| `[ ]` TC-036 | Rate limit | Submit 6× from same IP in 1 hr | 429 after 5th request |
| `[ ]` TC-037 | DB row created | Submit valid form, check admin | Registration appears in `/admin/registrations` |
| `[ ]` TC-038 | Confirmation email triggered | Submit valid form | No server error (email fire-and-forget) |

---

## 4. Public — Contact Page (`/contact`)

| # | Test | Steps | Expected |
|---|------|-------|----------|
| `[ ]` TC-040 | Happy path | Fill name, email, subject, message; submit | Success message shown |
| `[ ]` TC-041 | Missing field | Omit subject, submit | Error `Please fill in all required fields.` |
| `[ ]` TC-042 | Invalid email | Enter `foo`, submit | Error `Invalid email address.` |
| `[ ]` TC-043 | Honeypot | Fill `_honey`, submit | Returns 200 silently (spam mitigation) |
| `[ ]` TC-044 | Rate limit | 11 requests in 1 hr | 429 on 11th |
| `[ ]` TC-045 | DB row created | Submit, check admin contacts | Submission appears in `/admin/contacts` |

---

## 5. Public — Photo Vault (`/photo-vault`, `/photo-vault/[slug]`)

| # | Test | Steps | Expected |
|---|------|-------|----------|
| `[ ]` TC-050 | Listing loads | Navigate to `/photo-vault` | Albums displayed with cover images |
| `[ ]` TC-051 | Album detail | Click an album | `/photo-vault/[slug]` loads, photos visible |
| `[ ]` TC-052 | Invalid album slug | Navigate to `/photo-vault/fake` | 404 |

---

## 6. Public — Static Pages

| # | Test | Steps | Expected |
|---|------|-------|----------|
| `[ ]` TC-060 | About page | `/about` | 200, content visible |
| `[ ]` TC-061 | FAQ page | `/faq` | 200, questions expand/collapse |
| `[ ]` TC-062 | Privacy page | `/privacy` | 200 |
| `[ ]` TC-063 | Terms page | `/terms` | 200 |
| `[ ]` TC-064 | Thank you page | `/thank-you` | 200 |
| `[ ]` TC-065 | 404 page | `/does-not-exist` | Custom 404, not blank white page |
| `[ ]` TC-066 | Sitemap | `/sitemap.xml` | Valid XML, includes trip URLs |

---

## 7. Admin — Authentication

| # | Test | Steps | Expected |
|---|------|-------|----------|
| `[ ]` TC-070 | Correct password | POST `/api/admin/login` with correct pw | Cookie set, redirect to `/admin/registrations` |
| `[ ]` TC-071 | Wrong password | POST with wrong pw | Redirect to `/admin/login?error=1` |
| `[ ]` TC-072 | Empty password | Submit blank form | Redirect to `?error=1` |
| `[ ]` TC-073 | Rate limit | 11 login attempts in 1 hr | 10 allowed, 11th redirects to `?error=1` |
| `[ ]` TC-074 | Unauthenticated admin access | Navigate to `/admin/trips` without cookie | Redirect to `/admin/login` |
| `[ ]` TC-075 | Logout | Click logout | Cookie cleared, redirect to login |
| `[ ]` TC-076 | Session persistence | Login, close browser, reopen | Still logged in (7-day maxAge) |

---

## 8. Admin — Trips List (`/admin/trips`)

| # | Test | Steps | Expected |
|---|------|-------|----------|
| `[ ]` TC-080 | Trips listed | Load page | All trips shown with status badges |
| `[ ]` TC-081 | Create new trip | Click "New Trip", fill name, submit | Redirects to edit page, trip file created |
| `[ ]` TC-082 | Duplicate trip | Click duplicate on a trip | New trip created with "-copy" slug |
| `[ ]` TC-083 | Delete trip | Click delete, confirm | Trip removed, gone from listing |
| `[ ]` TC-084 | Status quick-change | Toggle status dropdown inline | Status updates without full page reload |

---

## 9. Admin — Trip Edit (`/admin/trips/[slug]`)

### Tab: Basics

| # | Test | Steps | Expected |
|---|------|-------|----------|
| `[ ]` TC-090 | All fields populated | Open edit for existing trip | Values match YAML file |
| `[ ]` TC-091 | Save unchanged | Click Save Changes | Redirects back, no data corrupted |
| `[ ]` TC-092 | Change trip name | Edit name, save | YAML name field updated |
| `[ ]` TC-093 | Change slug | Enter new slug, save | File renamed, old slug 404s, new slug works |
| `[ ]` TC-094 | Tab hash in URL | Click Itinerary tab | URL becomes `#itinerary` |
| `[ ]` TC-095 | Tab restored on reload | Reload at `#itinerary` | Itinerary tab active on load |

### Tab: Content

| # | Test | Steps | Expected |
|---|------|-------|----------|
| `[ ]` TC-100 | Short description char count | Type in short description | Counter updates live, max 200 |
| `[ ]` TC-101 | Add highlight | Click "+ Add Highlight", type value, save | New item in YAML `highlights` array |
| `[ ]` TC-102 | Remove highlight | Click ✕ on a highlight, save | Item removed from YAML |
| `[ ]` TC-103 | Add inclusion | Click "+ Add Inclusion" | Item added |
| `[ ]` TC-104 | Add exclusion | Click "+ Add Exclusion" | Item added |
| `[ ]` TC-105 | Add packing item | Click "+ Add Item" | Item added |

### Tab: Itinerary

| # | Test | Steps | Expected |
|---|------|-------|----------|
| `[ ]` TC-110 | Existing days load | Open Spiti trip, Itinerary tab | All 7 days shown as accordion cards |
| `[ ]` TC-111 | Day count correct | Check "N days" label | Matches number of cards |
| `[ ]` TC-112 | Expand single day | Click day header | Body opens with all fields |
| `[ ]` TC-113 | Collapse single day | Click open day header | Body closes |
| `[ ]` TC-114 | Expand All | Click "Expand all" | All cards open |
| `[ ]` TC-115 | Collapse All | Click "Collapse all" | All cards closed |
| `[ ]` TC-116 | Add Day | Click "+ Add Day" | New card appended, opens, Day Title focused |
| `[ ]` TC-117 | Day number updates | Add day to 7-day trip | New card shows "8" |
| `[ ]` TC-118 | Day title in header | Type title in open card | Header text updates live |
| `[ ]` TC-119 | Accommodation in summary | Type accommodation | Summary line updates live |
| `[ ]` TC-120 | Meal checkboxes in summary | Check Breakfast + Dinner | Summary shows "B · D" |
| `[ ]` TC-121 | Move Up | Click ▲ on day 3 | Day 3 becomes day 2, all renumbered |
| `[ ]` TC-122 | Move Down | Click ▼ on day 2 | Day 2 becomes day 3 |
| `[ ]` TC-123 | Move Up disabled on first | Day 1 ▲ button | Disabled (greyed out) |
| `[ ]` TC-124 | Move Down disabled on last | Last day ▼ button | Disabled |
| `[ ]` TC-125 | Remove Day | Click "Remove Day" in open card | Card removed, remaining days renumbered |
| `[ ]` TC-126 | Save itinerary | Add day, fill title + activities, save | YAML itinerary array updated correctly |
| `[ ]` TC-127 | Meals saved correctly | Check Breakfast + Dinner, save | YAML `breakfast: true`, `dinner: true`, `lunch: false` |
| `[ ]` TC-128 | Reorder saved | Move days, save | YAML order reflects new order |

### Tab: Logistics

| # | Test | Steps | Expected |
|---|------|-------|----------|
| `[ ]` TC-130 | Fields load | Open tab | Meeting point, time, notes, cancellation policy populated |
| `[ ]` TC-131 | Save | Edit and save | Values updated in YAML |

### Tab: Payment & Media

| # | Test | Steps | Expected |
|---|------|-------|----------|
| `[ ]` TC-140 | Upload featured image | Choose valid JPG, save | Image saved, path in YAML |
| `[ ]` TC-141 | Image preview | Choose file before saving | Preview appears immediately |
| `[ ]` TC-142 | Upload QR code | Choose PNG, save | QR path saved in YAML |
| `[ ]` TC-143 | Existing image preserved | Save without choosing new file | Old image not overwritten |
| `[ ]` TC-144 | Payment fields save | Enter amounts + instructions, save | Values in YAML |

---

## 10. Admin — Registrations (`/admin/registrations`)

| # | Test | Steps | Expected |
|---|------|-------|----------|
| `[ ]` TC-150 | Registrations listed | Load page | All registrations shown with status |
| `[ ]` TC-151 | Update status | Change a registration to "confirmed" | Status updates in DB |
| `[ ]` TC-152 | Export CSV | Click export | Downloads valid CSV with all columns |

---

## 11. Admin — Contacts (`/admin/contacts`)

| # | Test | Steps | Expected |
|---|------|-------|----------|
| `[ ]` TC-160 | Contacts listed | Load page | Submissions with name, email, subject |
| `[ ]` TC-161 | Mark as resolved | Click resolve on a contact | Contact marked resolved, UI updates |

---

## 12. Admin — Newsletter (`/admin/newsletter`)

| # | Test | Steps | Expected |
|---|------|-------|----------|
| `[ ]` TC-170 | Subscribers listed | Load page | Email list shown |

---

## 13. Admin — Photo Vault (`/admin/photo-vault`)

| # | Test | Steps | Expected |
|---|------|-------|----------|
| `[ ]` TC-180 | Albums listed | Load page | Albums with cover + photo count |
| `[ ]` TC-181 | Create album | Click "New Album", fill name, submit | Album created, redirect to edit |
| `[ ]` TC-182 | Add photo to album | Upload image in album edit | Photo added, visible in album |
| `[ ]` TC-183 | Delete photo | Click delete on photo | Photo removed from album |
| `[ ]` TC-184 | Delete album | Delete album | Removed from listing |

---

## 14. Security

| # | Test | Steps | Expected |
|---|------|-------|----------|
| `[ ]` TC-190 | Admin routes require auth | GET `/admin/trips` without cookie | 302 to `/admin/login` |
| `[ ]` TC-191 | Admin APIs require auth | POST `/api/admin/trips/create` without cookie | 401 or redirect |
| `[ ]` TC-192 | XSS in trip name | Enter `<script>alert(1)</script>` as name | Escaped in HTML output, no alert fires |
| `[ ]` TC-193 | SQL injection in registration | Enter `'; DROP TABLE registrations;--` | Sanitized, DB intact (uses prepared statements) |
| `[ ]` TC-194 | Password not in response | Login with correct pw | Token is SHA-256 hash, raw password not echoed |
| `[ ]` TC-195 | Cookie flags | Inspect `admin_token` cookie | `httpOnly`, `sameSite=lax`, `secure` in prod |

---

## 15. SEO & Meta

| # | Test | Steps | Expected |
|---|------|-------|----------|
| `[ ]` TC-200 | Homepage meta | View page source | `og:title`, `og:description`, `og:image` present |
| `[ ]` TC-201 | Trip detail meta | View source on trip page | Trip-specific title and description |
| `[ ]` TC-202 | Canonical URL | View source | `<link rel="canonical">` matches public URL |
| `[ ]` TC-203 | Sitemap includes trips | GET `/sitemap.xml` | Trip URLs present |
| `[ ]` TC-204 | robots meta | View source | `<meta name="robots" content="index, follow">` |

---

## 16. Responsive / Cross-browser

| # | Test | Steps | Expected |
|---|------|-------|----------|
| `[ ]` TC-210 | Mobile homepage | 375px width | No horizontal scroll, CTA tappable |
| `[ ]` TC-211 | Mobile trip detail | 375px | Itinerary accordion works, form usable |
| `[ ]` TC-212 | Mobile admin edit | 375px | Move buttons hidden, tabs scrollable |
| `[ ]` TC-213 | Tablet (768px) | Trip listing | 2-column grid or better |
| `[ ]` TC-214 | Safari | Key flows | No CSS/JS breakage |
| `[ ]` TC-215 | Firefox | Key flows | No CSS/JS breakage |

---

## 17. Edge Cases & Error States

| # | Test | Steps | Expected |
|---|------|-------|----------|
| `[ ]` TC-220 | Trip with no itinerary | Open trip with empty `itinerary: []` | Itinerary tab shows "0 days", no crash |
| `[ ]` TC-221 | Trip with no featured image | Trip missing `featuredImage` | No broken `<img>` tag on listing/detail |
| `[ ]` TC-222 | Very long trip name | 200-char name | Truncated with ellipsis in card, not overflow |
| `[ ]` TC-223 | Empty registration DB | Fresh install | Admin pages load without crash |
| `[ ]` TC-224 | Concurrent saves | Two tabs saving same trip simultaneously | Last write wins, no corrupt YAML |

---

## Known Issues Log

| Reported | TC | Description | Status |
|----------|----|-------------|--------|
| 2026-06-03 | TC-110 | Itinerary day cards had no CSS (Astro scoped style bug) | Fixed — `<style is:global>` |
| 2026-06-03 | TC-116 | Add Day / Expand All / Remove Day buttons non-functional (IIFE scope bug) | Fixed — event listeners |

---

## Running checklist before each deploy

- [ ] TC-030 registration happy path
- [ ] TC-070 admin login
- [ ] TC-090 trip save round-trip (edit → save → re-open, data intact)
- [ ] TC-116 Add Day in itinerary
- [ ] TC-126 Save itinerary persists to YAML
- [ ] TC-001 homepage loads, no console errors
- [ ] TC-190 unauthenticated admin redirect
