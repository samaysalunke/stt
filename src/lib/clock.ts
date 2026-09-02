/**
 * Server-side "now", overridable for tests.
 *
 * Every public route derives what it renders from the calendar: a departure
 * whose start date has passed drops out of `upcomingBatches`, which moves the
 * trip to "no upcoming dates", which restyles its card and reorders the listing.
 * So a visual baseline that contains a trip listing is only valid until the next
 * departure date passes — three of them fall inside the eighteen days after
 * 2026-09-02 — and it fails on that date with no code change behind it.
 *
 * That is not something a pixel tolerance can absorb (the diff is a whole card),
 * so the clock gets pinned instead. `TEST_NOW` is an ISO instant; the visual
 * Playwright project sets it on its own dev server.
 *
 * Ignored when NODE_ENV is production, so a stray value in a deployed
 * environment cannot freeze the real site's calendar. This mirrors the guard on
 * `ALLOW_TEST_CONTENT` in trips.ts.
 */
export function now(): number {
  const override = process.env.TEST_NOW;
  if (override && process.env.NODE_ENV !== 'production') {
    const parsed = Date.parse(override);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

/** `now()` truncated to local midnight — the comparison point for departures. */
export function todayStart(): Date {
  const d = new Date(now());
  d.setHours(0, 0, 0, 0);
  return d;
}
