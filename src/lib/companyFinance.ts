/**
 * Company profit and loss: departure margin, less what the company costs to run.
 *
 * A SEPARATE module from departureFinance.ts on purpose. That file has a stated
 * per-departure contract and a large test suite depending on the meaning of
 * FinanceTotals; folding whole-company overheads into it would change the
 * meaning of an exported type. The dependency runs one way only —
 * companyFinance consumes buildFinanceRollup(), never the reverse.
 *
 * ── The period rule, which is a hybrid and must be described as one ──────────
 *
 * Cash collected and direct cost are both attributed to the DEPARTURE's date;
 * overheads to their own calendar month. That is *matching*, not cash basis, and
 * the page must not claim otherwise — it will not survive contact with an
 * accountant or a bank reconciliation.
 *
 * Attributing cash by payment_events.received_at instead was rejected twice
 * over. Costs have no date of their own, so revenue would land in one financial
 * year and its entire cost in the next for every departure that sells across
 * 31 March — which, for summer Himalayan departures sold in January to March, is
 * most of them. Worse, recordRefund decrements amount_paid at the moment of
 * refund with no memory of when the original cash arrived, so a refund in FY-B
 * against an FY-A departure would leave FY-A permanently overstated with no way
 * to correct it. Under departure-date attribution the refund lands where the
 * revenue did.
 *
 * `cashReceivedInPeriod` is offered as a clearly secondary reconciliation
 * figure, never as the revenue line.
 */

import type Database from 'better-sqlite3';
import { getDb } from './db';
import {
  buildFinanceRollup,
  type DepartureFinance,
  type FinanceRollup,
} from './departureFinance';
import {
  OVERHEAD_CATEGORIES,
  elapsedMonthsInFinancialYear,
  monthKey,
  monthsInFinancialYear,
  readCompanyCosts,
  type CompanyCostRow,
  type OverheadCategory,
} from './companyCosts';
import { indianFinancialYearFromStart } from './adminDashboard';

/** Below this share of revenue coming from costed departures, percentages are withheld. */
export const COVERAGE_THRESHOLD = 0.9;

export interface OverheadLine {
  category: OverheadCategory;
  amount: number;
}

export interface PnlPeriod {
  fyStart: number | 'all';
  label: string;

  // ── Revenue (departure-matched) ──
  cashCollected: number;
  /** The subset gross margin is actually computed on. */
  cashCollectedCosted: number;
  retained: number;
  /** Reconciliation only — real bank timing. Null when the ledger is incomplete. */
  cashReceivedInPeriod: number | null;

  // ── Direct cost ──
  directCost: number;
  grossMargin: number;
  grossMarginPct: number | null;

  // ── Overheads ──
  overheads: number;
  overheadsByCategory: OverheadLine[];
  monthsInPeriod: number;
  monthsEntered: number;
  /** Overheads extrapolated to the full period. Null when nothing is entered. */
  overheadRunRate: number | null;

  // ── Net ──
  /** Never null: an em-dash reads as "broken" and the page stops being opened. */
  netProfit: number;
  netProfitAtRunRate: number | null;
  /** Withheld (null) whenever `indicative` — a confident % on a partial base is the worst output. */
  netProfitPct: number | null;
  indicative: boolean;

  // ── Integrity, surfaced rather than hidden ──
  costCoverage: number | null;
  costedDepartures: number;
  uncostedDepartures: number;
  uncostedCollected: number;
  /** Departures whose startDate will not parse — they fall out of EVERY financial year. */
  departuresWithoutFy: number;
  departuresWithoutFyCollected: number;
  unallocatedCollected: number;
  orphanCostTotal: number;
}

export interface ComputePnlOptions {
  fyStart: number | 'all';
  label: string;
  monthsInPeriod: number;
  cashReceivedInPeriod?: number | null;
}

/**
 * Pure P&L. Takes the departures ALREADY filtered to the period, the overhead
 * rows already filtered to it, and the leak figures from the rollup.
 */
export function computePnl(
  departures: DepartureFinance[],
  overheadRows: CompanyCostRow[],
  leaks: { unallocatedCollected: number; orphanCostTotal: number; allDepartures: DepartureFinance[] },
  options: ComputePnlOptions,
): PnlPeriod {
  const costed = departures.filter((d) => d.cost.costed);
  const uncosted = departures.filter((d) => !d.cost.costed);

  const cashCollected = departures.reduce((sum, d) => sum + d.collected, 0);
  const cashCollectedCosted = costed.reduce((sum, d) => sum + d.collected, 0);
  const directCost = costed.reduce((sum, d) => sum + d.cost.total, 0);
  const grossMargin = cashCollectedCosted - directCost;

  const overheads = overheadRows.reduce((sum, row) => sum + row.amount, 0);
  const monthsEntered = new Set(overheadRows.map((row) => row.month)).size;
  const overheadsByCategory: OverheadLine[] = OVERHEAD_CATEGORIES
    .map((category) => ({
      category,
      amount: overheadRows.filter((row) => row.category === category).reduce((sum, row) => sum + row.amount, 0),
    }))
    .filter((line) => line.amount !== 0);

  const overheadRunRate = monthsEntered > 0 && options.monthsInPeriod > 0
    ? Math.round((overheads / monthsEntered) * options.monthsInPeriod)
    : null;

  // Net profit is gross margin (costed departures only) less whole-company
  // overheads. That comparison is imperfect whenever coverage < 100%, which is
  // exactly what costCoverage and the "costed departures only" label exist to
  // say. It is never nulled — a rupee figure with a caveat is recoverable.
  const netProfit = grossMargin - overheads;
  const netProfitAtRunRate = overheadRunRate === null ? null : grossMargin - overheadRunRate;

  const costCoverage = cashCollected > 0 ? cashCollectedCosted / cashCollected : null;
  const monthsIncomplete = monthsEntered < options.monthsInPeriod;
  const coverageThin = costCoverage !== null && costCoverage < COVERAGE_THRESHOLD;
  const indicative = monthsIncomplete || coverageThin;

  const withoutFy = leaks.allDepartures.filter((d) => d.financialYearStart === null);

  return {
    fyStart: options.fyStart,
    label: options.label,

    cashCollected,
    cashCollectedCosted,
    retained: departures.reduce((sum, d) => sum + d.retained, 0),
    cashReceivedInPeriod: options.cashReceivedInPeriod ?? null,

    directCost,
    grossMargin,
    grossMarginPct: cashCollectedCosted > 0 ? (grossMargin / cashCollectedCosted) * 100 : null,

    overheads,
    overheadsByCategory,
    monthsInPeriod: options.monthsInPeriod,
    monthsEntered,
    overheadRunRate,

    netProfit,
    netProfitAtRunRate,
    // Withheld whenever the base is partial. A confident "23.4% net margin"
    // computed on seven months of overheads is the single most misleading thing
    // this page could emit; the rupee figure at least carries its caveat.
    netProfitPct: indicative || cashCollectedCosted <= 0 ? null : (netProfit / cashCollectedCosted) * 100,
    indicative,

    costCoverage,
    costedDepartures: costed.length,
    uncostedDepartures: uncosted.length,
    uncostedCollected: uncosted.reduce((sum, d) => sum + d.collected, 0),
    departuresWithoutFy: withoutFy.length,
    departuresWithoutFyCollected: withoutFy.reduce((sum, d) => sum + d.collected, 0),
    unallocatedCollected: leaks.unallocatedCollected,
    orphanCostTotal: leaks.orphanCostTotal,
  };
}

/**
 * Cash that actually moved in the window, from the payment ledger.
 *
 * Returns null when the ledger does not account for the amount_paid projection
 * — pre-ledger and imported historical registrations may carry a balance with
 * no events, and a reconciliation figure that silently omits them is worse than
 * no reconciliation figure. Checked rather than assumed, because it cannot be
 * verified from a development database.
 */
export function readCashReceived(
  db: Database.Database,
  window: { startDate: string; endDate: string } | null,
): number | null {
  const totals = db.prepare(`
    SELECT (SELECT COALESCE(SUM(amount_paid), 0) FROM registrations) AS projection,
           (SELECT COALESCE(SUM(amount), 0)      FROM payment_events) AS ledger
  `).get() as { projection: number; ledger: number };
  // Allow a rupee of rounding slack; anything more means history predates the ledger.
  if (Math.abs(Number(totals.projection) - Number(totals.ledger)) > 1) return null;

  const row = window
    ? db.prepare(
        "SELECT COALESCE(SUM(amount), 0) AS total FROM payment_events WHERE date(received_at) BETWEEN ? AND ?",
      ).get(window.startDate, window.endDate)
    : db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM payment_events').get();
  return Number((row as { total: number }).total) || 0;
}

/** Full P&L for a financial year, or for all time. */
export function buildPnl(
  fyStart: number | 'all',
  db: Database.Database = getDb(),
  today = new Date(),
  rollup?: FinanceRollup,
): PnlPeriod {
  const finance = rollup ?? buildFinanceRollup(db, today);
  const all = finance.departures;

  const isAll = fyStart === 'all';
  const fy = isAll ? null : indianFinancialYearFromStart(fyStart as number);

  // Reuse the financialYearStart the rollup already computed rather than
  // re-deriving it, so this page and /admin/finance cannot disagree about which
  // year a departure belongs to.
  const departures = isAll ? all : all.filter((d) => d.financialYearStart === fyStart);

  // TWO WINDOWS, deliberately different.
  //
  // `summedMonths` is every month of the period, so an overhead that has been
  // entered always counts — summing only elapsed months silently dropped
  // anything recorded ahead of time, and a future financial year showed zero
  // overheads despite having rows.
  //
  // `elapsedMonths` is what completeness is measured against: a month that has
  // not started yet cannot be "missing", or the warning fires all year.
  const summedMonths = isAll
    ? allActivityMonths(db, all, today)
    : monthsInFinancialYear(fyStart as number);
  const elapsedMonths = isAll ? summedMonths : elapsedMonthsInFinancialYear(fyStart as number, today);
  const overheadRows = summedMonths.length ? readCompanyCosts(db, summedMonths) : [];

  return computePnl(
    departures,
    overheadRows,
    {
      // Unallocated money has no departure date, so it belongs to no financial
      // year; it is only folded in on All time.
      unallocatedCollected: isAll ? finance.unallocated.collected : 0,
      orphanCostTotal: isAll ? finance.orphanCosts.reduce((sum, o) => sum + o.cost.total, 0) : 0,
      allDepartures: all,
    },
    {
      fyStart,
      label: isAll ? 'All time' : fy!.label,
      monthsInPeriod: elapsedMonths.length,
      cashReceivedInPeriod: readCashReceived(db, fy ? { startDate: fy.startDate, endDate: fy.endDate } : null),
    },
  );
}

/** Inclusive 'YYYY-MM' range. */
export function monthRange(from: string, to: string): string[] {
  if (from > to) return [];
  const out: string[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const endYear = Number(to.slice(0, 4));
  const endMonth = Number(to.slice(5, 7));
  while (year < endYear || (year === endYear && month <= endMonth)) {
    out.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return out;
}

/** Every month from the earliest recorded activity to the current one — the "All time" window. */
function allActivityMonths(db: Database.Database, departures: DepartureFinance[], today: Date): string[] {
  const earliestOverhead = (db.prepare('SELECT MIN(month) AS m FROM company_costs').get() as { m: string | null }).m;
  const departureMonths = departures
    .map((d) => String(d.startDate || '').slice(0, 7))
    .filter((m) => /^\d{4}-\d{2}$/.test(m));

  const candidates = [earliestOverhead, ...departureMonths].filter((m): m is string => !!m);
  if (!candidates.length) return [];
  return monthRange(candidates.sort()[0], monthKey(today));
}
