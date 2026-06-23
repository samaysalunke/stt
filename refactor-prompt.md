# Refactoring Prompt — Seek the Thrill (v2)

## Original plan score: 5.5/10

### Why it failed:
1. **GROUP 4 fatal bug**: `inputStyle`/`labelStyle` are NOT the same across the claimed 4 files.
   - Registrations pages use: `width:100%;padding:0.55rem 0.75rem;border:1.5px solid var(--color-border);...`
   - Settings/testimonials/faqs use: `border: 1px solid rgba(245,221,215,0.8); background: var(--color-white);`
   - Implementing one constant for all would silently apply wrong styles.
2. **Stale after customers.astro was added**: 5 new local helpers (`fmt`, `fmtTs`, `fmtAudit`, `money`, `statusStyle`) not covered.
3. **GROUP 2b/2c incomplete**: Misses `RegistrationCard.astro`, `customers.astro`, unix timestamp formatters.
4. **GROUP 5 incomplete**: Misses `stats.ts::findTripSlug` and `test/cleanup.ts`.

---

## The Prompt (copy-paste into a new session)

```
Refactor the Seek the Thrill codebase for readability and maintainability.
Zero functional or UI/UX changes — every API contract, prop interface,
visual output, and user-facing behaviour must remain identical.
Run `npm run test:unit && npm run test:api` after each logical group of
changes and fix any regressions before continuing.

Work through the groups below IN ORDER. Commit after each group.

---

### GROUP 1 — Reformat minified code (pure whitespace, no logic changes)

Files:
- src/pages/api/admin/registrations/payment.ts
- src/pages/api/admin/registrations/import.ts  (dense multi-statement lines)

Rules:
- One statement per line.
- Space around operators and after commas.
- No logic, naming, or behaviour changes whatsoever.
- Keep the local `json` / `fail` helpers in place for now (extracted in Group 2).

---

### GROUP 2 — Extract duplicated utilities

#### 2a. Shared API response helpers → src/lib/apiResponse.ts
Pattern repeated in: payment.ts, import.ts, create.ts (registrations), register.ts, and others.

    export const jsonOk = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    export const jsonFail = (error: string, status = 400, extra: Record<string, unknown> = {}) =>
      jsonOk({ success: false, error, ...extra }, status);

After creating the file, replace all local json() / fail() / inline new Response(JSON.stringify(...))
calls across API routes with these imports. Delete the local copies.

#### 2b. Date formatters → src/lib/utils.ts (add new exports, do NOT remove existing formatDate)
Add these three functions. The existing formatDate / formatDateRange stay untouched.

    // For string date fields (handles null → '—', and date-only strings without T suffix)
    export function formatDateIN(d: string | null | undefined): string {
      if (!d) return '—';
      const str = d.includes('T') ? d : d + 'T00:00:00';
      return new Date(str).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    // For unix epoch integer timestamps → date only
    export function formatDateFromUnix(unix: number | null | undefined): string {
      if (!unix) return '—';
      return new Date(unix * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    // For audit log timestamps → date + time (short, no year)
    export function formatDateTimeFromUnix(unix: number): string {
      return new Date(unix * 1000).toLocaleString('en-IN', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
      });
    }

Files to update (replace local fmt / fmtDate / fmtTs / fmtAudit with imports):
- src/pages/api/register.ts (local fmtDate and fmt — both identical, replace both with formatDateIN)
- src/pages/api/admin/registrations/create.ts (local fmtDate → formatDateIN)
- src/lib/adminTripOptions.ts (local fmtDate → formatDateIN)
- src/components/BookingCheckout.tsx (local fmtDate → formatDateIN)
- src/components/BookingPanel.tsx (local fmt → formatDateIN)
- src/components/admin/RegistrationCard.astro (local fmt → formatDateIN)
- src/pages/admin/customers.astro (fmt → formatDateIN, fmtTs → formatDateFromUnix, fmtAudit → formatDateTimeFromUnix)
- src/pages/admin/audit.astro: local formatTs includes year; formatDateTimeFromUnix does NOT include year.
  These are different — keep audit.astro's local formatTs unchanged.

#### 2c. INR currency formatter → src/lib/utils.ts (add new export)
Pattern '₹' + Math.round(n ?? 0).toLocaleString('en-IN') appears as inr or money in:
- src/components/BookingCheckout.tsx
- src/components/BookingPanel.tsx
- src/pages/admin/customers.astro
- src/components/admin/RegistrationCard.astro (uses (n ?? 0) without Math.round — for integer amounts identical)

Add to utils.ts:

    export function formatINR(n: number): string {
      return '₹' + Math.round(n ?? 0).toLocaleString('en-IN');
    }

Replace local inr / money in all four files with import of formatINR. Delete local copies.
Do NOT touch the existing formatCurrency (uses Intl.NumberFormat, different output format).

#### 2d. Booking shared types → src/lib/bookingTypes.ts (new file)
BookingCheckout.tsx and BookingPanel.tsx each define their own Offer, Departure, and related
interfaces. They are semantically identical.
Extract to src/lib/bookingTypes.ts and import in both components. No prop or behaviour changes.

#### 2e. Registration status style helper → src/lib/utils.ts (add new export)
Identical function in two places:
- src/pages/admin/customers.astro: statusStyle
- src/components/admin/RegistrationCard.astro: statusStyle

Add to utils.ts:

    export function regStatusStyle(status: string): string {
      if (status === 'confirmed') return 'background:#D1FAE5;color:#065F46;';
      if (status === 'rejected')  return 'background:#FEE2E2;color:#991B1B;';
      if (status === 'lead')      return 'background:#FEF9C3;color:#78350F;';
      return 'background:#FEF3C7;color:#92400E;';
    }

Replace both local statusStyle copies. Verify badge colours are identical.

---

### GROUP 3 — Split large lib files

#### 3a. Split src/lib/content.ts (562 lines) into domain modules
Create the following files, moving functions without changing signatures or behaviour:
- src/lib/trips.ts      — trip-related functions
- src/lib/albums.ts     — album CRUD
- src/lib/settings.ts   — readSiteSettings, writeSettings (check no existing file with this name first)
- src/lib/testimonials.ts — testimonial CRUD
- src/lib/faqs.ts       — FAQ CRUD

Keep src/lib/content.ts as a re-export barrel:

    export * from './trips';
    export * from './albums';
    export * from './settings';
    export * from './testimonials';
    export * from './faqs';

All existing import { ... } from '../lib/content' calls continue to work unchanged.

#### 3b. Split src/lib/email.ts (337 lines) into transport + templates
- src/lib/emailTransport.ts  — SMTP setup, getTransporter(), sendEmail(), escapeHtml(), htmlToText(), wrapEmail()
- src/lib/emailTemplates.ts  — all send* functions (import from emailTransport.ts)

Keep src/lib/email.ts as a re-export barrel:

    export * from './emailTransport';
    export * from './emailTemplates';

---

### GROUP 4 — Admin form field style constants (TWO separate sets)

There are TWO visually distinct families of admin form styles. They must NOT be merged.

Set A — Registrations forms (full-width, high-contrast border):
- src/pages/admin/registrations/new.astro
- src/pages/admin/registrations/import.astro

Set B — Content forms (soft border, white background):
- src/pages/admin/settings.astro
- src/pages/admin/testimonials/new.astro
- src/pages/admin/testimonials/[slug].astro
- src/pages/admin/faqs/new.astro
- src/pages/admin/faqs/[slug].astro

Create src/lib/adminStyles.ts:

    // Full-width form inputs used in registration management pages
    export const ADMIN_REG_INPUT_STYLE =
      'width:100%;padding:0.55rem 0.75rem;border:1.5px solid var(--color-border);border-radius:0.5rem;font-size:0.875rem;font-family:var(--font-sans);box-sizing:border-box;';
    export const ADMIN_REG_LABEL_STYLE =
      'display:block;font-size:0.78rem;font-weight:700;color:var(--color-text-secondary);margin:0 0 0.3rem;text-transform:uppercase;letter-spacing:0.03em;';

    // Soft-styled inputs used in content management pages (settings, testimonials, FAQs)
    export const ADMIN_CONTENT_INPUT_STYLE =
      'border: 1px solid rgba(245,221,215,0.8); background: var(--color-white);';
    export const ADMIN_CONTENT_LABEL_STYLE =
      'color: var(--color-navy);';

Import ADMIN_REG_* in Set A files, ADMIN_CONTENT_* in Set B files.
Verify rendered HTML is byte-identical after replacement.

---

### GROUP 5 — Trip name lookup helper

Pattern listTrips().find((t: any) => (t.title || t.name) === tripName) appears in:
- src/lib/registrationWrite.ts (x3)
- src/pages/api/admin/update-registration.ts
- src/lib/stats.ts (as findTripSlug — same lookup, returns .slug)
- src/pages/api/test/cleanup.ts

Add to src/lib/trips.ts (after Group 3 creates it):

    export function findTripByName(tripName: string) {
      return listTrips().find((t: any) => (t.title || t.name) === tripName) ?? null;
    }

Replace:
- The 3 inline .find(...) calls in registrationWrite.ts
- The inline .find(...) in update-registration.ts
- findTripSlug in stats.ts: replace its body with return findTripByName(tripName)?.slug ?? null
- The inline .find(...) in test/cleanup.ts

---

### Safety rules (apply throughout)

1. After each group, run npm run test:unit && npm run test:api. Fix any failures before moving on.
2. Never change a function signature, exported name, prop interface, or API response shape.
3. Never change Tailwind classes, inline styles, or rendered HTML.
4. If splitting a file, always leave a re-export barrel so existing import paths keep working.
5. Do not refactor DayAccordion / ItineraryAccordion, BookingCheckout internals beyond type extraction,
   admin trip editor page (admin/trips/[slug].astro, 1216 lines), or any page layout.
6. Do not touch src/lib/payment.ts, src/lib/db.ts, src/lib/session.ts, or src/lib/admin-session.ts.
7. For GROUP 4: triple-check exact style strings match before and after — they are visually critical.
8. For GROUP 2b: audit.astro formatTs includes year — keep it local, do not replace.
```

---

## What this deliberately excludes (too risky for a pure refactor)

- **Accordion unification** — different colour schemes; merging risks visual regressions.
- **BookingCheckout/BookingPanel internals** — 740 + 381 lines of stateful React UI.
- **Admin trip editor page** (`admin/trips/[slug].astro`, 1216 lines) — heavily coupled form state.
- **Type tightening** — changing `any` can silently change runtime behaviour.
- **payStyle / payLabel in customers.astro** — different logic from payment.ts; coupling display to domain would add fragility.
