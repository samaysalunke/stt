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
