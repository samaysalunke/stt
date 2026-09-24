/**
 * When the balance on a booking falls due.
 *
 * A trip states the rule as free text (`balanceDueRule: "10 days before trip"`).
 * The traveller is shown a real date derived from it during checkout, and the
 * admin receivables ageing buckets balances by the same date — so the two must
 * agree, and the derivation lives here rather than in either caller.
 *
 * DEPENDENCY-FREE ON PURPOSE. This module is bundled into the BookingCheckout
 * React island; a single `fs` or `better-sqlite3` import anywhere in its graph
 * would break the client build. Do not add one, and do not merge this into
 * policyDates.ts (which is server-rendered today but under no such constraint).
 */

/** The rule applied when a trip does not state one. */
export const DEFAULT_BALANCE_RULE = '15 days before trip';

/**
 * Days before departure that the balance falls due, or null when the rule does
 * not lead with a day count.
 *
 * The pattern is ANCHORED, and deliberately so: it was lifted unchanged from the
 * checkout that already shows travellers a due date, so loosening it here would
 * change what customers are told. `"10 days before departure"` parses;
 * `"Balance due 15 days before"` does not. Widen it only as a separate,
 * deliberate change — `tests/unit/balanceDue.test.ts` pins both cases.
 */
export function parseBalanceDueDays(rule: unknown): number | null {
  const match = /^(\d+)\s*days?\s*before/i.exec(String(rule ?? '').trim());
  if (!match) return null;
  const days = parseInt(match[1], 10);
  return Number.isFinite(days) ? days : null;
}

/**
 * The date the balance falls due: `startDate − N days`, as `YYYY-MM-DD`.
 *
 * FIXES AN OFF-BY-ONE the lifted code had. The original parsed `startDate` as
 * LOCAL midnight (`new Date(s + 'T00:00:00')`) and then serialised the result
 * with `toISOString()`, which is UTC — so in any timezone ahead of UTC the date
 * rolled back a day. Every traveller in IST was shown a balance-due date one day
 * early (27 Jun − 15 days rendered as 11 Jun, not 12 Jun). Everything here is UTC
 * end to end, matching how the rest of the codebase handles date-only values
 * (see adminDashboard.ts, departureSummary.ts).
 * Null when the rule does not parse or the start date is unusable — callers
 * must surface that as "no due date" rather than inventing one, or a booking
 * gets reported overdue on a rule that never said so.
 */
export function balanceDueDate(startDate: unknown, rule: unknown): string | null {
  const days = parseBalanceDueDays(rule);
  if (days === null) return null;
  const start = String(startDate ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  const date = new Date(`${start}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/** Whole days from one `YYYY-MM-DD` to another, both read as UTC midnight. */
export function daysBetweenDates(fromKey: string, toKey: string): number {
  const from = Date.parse(`${fromKey}T00:00:00Z`);
  const to = Date.parse(`${toKey}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

/**
 * Days past the due date as of `todayKey` — negative or zero while not yet due,
 * null when there is no due date.
 *
 * Shared by the admin receivables ageing and the traveller's own profile card,
 * so the number a traveller is shown and the one admin chases agree.
 */
export function overdueDays({ dueDate, todayKey, createdAt }: {
  dueDate: string | null;
  todayKey: string;
  createdAt?: string | null;
}): number | null {
  if (!dueDate) return null;
  let days = daysBetweenDates(dueDate, todayKey);

  // A "60 days before" rule on a booking made 10 days out is overdue the instant
  // it is created; without this the page would claim 50 days overdue on a
  // three-day-old booking.
  if (days > 0 && createdAt) {
    const created = String(createdAt).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(created)) days = Math.min(days, Math.max(0, daysBetweenDates(created, todayKey)));
  }
  return days;
}
