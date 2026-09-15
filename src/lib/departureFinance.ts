/**
 * Per-departure profit margin: the outbound half of the books.
 *
 * Everything else in this codebase measures money coming IN. This module joins
 * that against what a departure COST to run and produces a margin.
 *
 * Shape follows adminDashboard.ts: pure compute functions (exported, unit
 * tested, no DB) plus thin DB wrappers at the bottom. A departure is a YAML
 * batch, so the join key is (trip_slug, batch_id) and the canonical departure
 * list comes from the content layer, not from SQL.
 *
 * THREE TRAPS this module exists to avoid — see the notes at each derivation:
 *   (a) `amount_refunded` must never be subtracted; `amount_paid` is already net.
 *   (b) a `lead` can carry an advance, so it must not offset contracted revenue.
 *   (c) a cancelled booking that forfeited its advance kept real cash.
 *
 * There is no version history for costs: audit_log is the record, and a delete
 * writes the whole prior row into previousValue, so the audit log is the undo.
 */

import type Database from 'better-sqlite3';
import { getDb } from './db';
import { listTrips } from './trips';
import { editableBooking } from './tripEditor';
import { resolveTripSlugAlias } from './tripSlugAliases';
import { isTripDeleted } from './tripDeletions';
import { NON_REVENUE_STATUSES, isHistoricalDeparture } from './registrationsView';
import { financialYearStartForDate } from './adminDashboard';

/** Statuses that represent a seat someone has committed to and owes money on. */
export const COMMITTED_STATUSES = ['pending', 'confirmed'] as const;
/** Statuses whose money was collected and then cancelled — kept or refunded. */
export const CANCELLED_STATUSES = ['cancelled', 'rejected'] as const;

/** Rupee bound on any single stored amount. A fat-fingered paste must not become a headline. */
export const MAX_RUPEES = 1_000_000_000;
export const MAX_LABEL_LENGTH = 80;

// ── Types ────────────────────────────────────────────────────────────────────

export interface DepartureCostItem {
  id: number;
  label: string;
  amount: number;
}

export interface DepartureCostBreakdown {
  /** A base row exists OR at least one line item exists. NOT `total > 0`. */
  costed: boolean;
  hasBaseRow: boolean;
  /** 0 when no base row — read `hasBaseRow` to tell that apart from a real zero. */
  base: number;
  items: DepartureCostItem[];
  itemsTotal: number;
  total: number;
  note: string | null;
  updatedAt: string | null;
  updatedByEmail: string | null;
}

/** One row out of the aggregate in {@link REG_AGGREGATE_SQL}. */
export interface RegAggregate {
  seats: number;
  committedSeats: number;
  confirmedSeats: number;
  leadSeats: number;
  cancelledSeats: number;
  collected: number;
  collectedCommitted: number;
  contracted: number;
  contractedUnknownSeats: number;
  retained: number;
  refundedGross: number;
}

export interface DepartureMeta {
  tripSlug: string;
  tripName: string;
  batchId: string;
  startDate: string;
  endDate: string;
  status: string;
  /** Lowest current offer price, for the zero-booking break-even fallback. */
  lowestOfferPrice: number | null;
  capacity: number | null;
}

export interface DepartureFinance extends DepartureMeta {
  historical: boolean;
  financialYearStart: number | null;

  seats: number;
  committedSeats: number;
  confirmedSeats: number;
  leadSeats: number;
  cancelledSeats: number;

  /** SUM(amount_paid) over live statuses. ALREADY net of refunds. */
  collected: number;
  /** Same, but pending+confirmed only. The figure `stillToCollect` nets against. */
  collectedCommitted: number;
  leadAdvances: number;
  contracted: number;
  contractedUnknownSeats: number;
  stillToCollect: number;
  overCollected: number;
  /** Cash kept from cancelled bookings (forfeited advances). Real money. */
  retained: number;
  /** SUM(amount_refunded). INFORMATIONAL ONLY — never enters arithmetic. */
  refundedGross: number;

  cost: DepartureCostBreakdown;
  /** null when the departure is not costed — never 0. */
  margin: number | null;
  /** null when not costed, or when collected <= 0. Never 0, -100 or -Infinity. */
  marginPct: number | null;
  marginIncludingRetained: number | null;
  avgContractedSeatPrice: number | null;
  breakEvenSeats: number | null;
  breakEvenSeatsRemaining: number | null;
}

export interface OrphanCost {
  tripSlug: string;
  batchId: string;
  cost: DepartureCostBreakdown;
  /** `trip-deleted` is retained deliberately; only `batch-missing` offers a purge. */
  reason: 'trip-deleted' | 'batch-missing';
}

export interface FinanceTotals {
  collected: number;
  retained: number;
  contracted: number;
  stillToCollect: number;
  cost: number;
  margin: number;
  marginPct: number | null;
  seats: number;
  costedDepartures: number;
  uncostedDepartures: number;
}

export interface FinanceRollup {
  departures: DepartureFinance[];
  orphanCosts: OrphanCost[];
  /** Registrations whose batch_id matches no departure. Keeps the books reconciled. */
  unallocated: { rows: number; seats: number; collected: number };
  totals: FinanceTotals;
}

// ── Validation ───────────────────────────────────────────────────────────────

/**
 * Whole rupees. Rounds rather than rejecting fractions — this is an owner typing
 * into a number input, and parseEditorBooking already rounds prices the same way.
 * Callers MUST echo the rounded value back so what is stored is what is shown.
 */
export function parseRupees(
  value: unknown,
  { min = -MAX_RUPEES, allowZero = true }: { min?: number; allowZero?: boolean } = {},
): number | null {
  if (value === null || value === undefined || value === '') return null;
  const raw = typeof value === 'number' ? value : Number(String(value).trim().replace(/,/g, ''));
  if (!Number.isFinite(raw)) return null;
  if (Math.abs(raw) > MAX_RUPEES) return null;
  const rounded = Math.round(raw);
  if (rounded < min) return null;
  if (!allowZero && rounded === 0) return null;
  return rounded;
}

export function parseItemLabel(value: unknown): string | null {
  const label = String(value ?? '').trim();
  if (!label || label.length > MAX_LABEL_LENGTH) return null;
  return label;
}

// ── Pure computation ─────────────────────────────────────────────────────────

export const EMPTY_AGGREGATE: RegAggregate = {
  seats: 0, committedSeats: 0, confirmedSeats: 0, leadSeats: 0, cancelledSeats: 0,
  collected: 0, collectedCommitted: 0, contracted: 0, contractedUnknownSeats: 0,
  retained: 0, refundedGross: 0,
};

export interface BaseCostRow {
  base_amount: number;
  note: string | null;
  updated_at: string | null;
  updated_by_email: string | null;
}

export interface CostItemRow {
  id: number;
  label: string;
  amount: number;
  sort_order?: number;
}

export function costBreakdown(base: BaseCostRow | null, itemRows: CostItemRow[] = []): DepartureCostBreakdown {
  const items = [...itemRows]
    .sort((a, b) => (Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)) || (Number(a.id) - Number(b.id)))
    .map((row) => ({ id: Number(row.id), label: String(row.label), amount: Number(row.amount) || 0 }));
  const itemsTotal = items.reduce((sum, item) => sum + item.amount, 0);
  const baseAmount = base ? Number(base.base_amount) || 0 : 0;
  return {
    // Row existence, not `total > 0`: a comped departure costed at an explicit
    // zero is a real state and earns a real 100% margin. "No row" is not that.
    costed: !!base || items.length > 0,
    hasBaseRow: !!base,
    base: baseAmount,
    items,
    itemsTotal,
    total: baseAmount + itemsTotal,
    note: base?.note ?? null,
    updatedAt: base?.updated_at ?? null,
    updatedByEmail: base?.updated_by_email ?? null,
  };
}

export function computeDepartureFinance(
  meta: DepartureMeta,
  agg: RegAggregate,
  cost: DepartureCostBreakdown,
  today = new Date(),
): DepartureFinance {
  // (b) `collected` spans every live status, which includes `lead` — and a lead
  // can carry a recorded advance. Netting that against `contracted` (which
  // counts committed seats only) would let a lead's advance silently cancel out
  // a confirmed traveller's outstanding balance. Use collectedCommitted.
  const stillToCollect = Math.max(0, agg.contracted - agg.collectedCommitted);
  const overCollected = Math.max(0, agg.collectedCommitted - agg.contracted);

  const margin = cost.costed ? agg.collected - cost.total : null;
  // Margin ON REVENUE, not markup on cost. Null — never 0, -100 or -Infinity —
  // when there is no revenue to take a percentage of.
  const marginPct = margin === null || agg.collected <= 0 ? null : (margin / agg.collected) * 100;

  // (c) Cancelled-but-kept cash is real money against a real cost, but
  // `cancelled` is a non-revenue status everywhere else. Keep `collected`
  // consistent with the rest of the admin and surface the difference instead.
  const marginIncludingRetained = cost.costed ? agg.collected + agg.retained - cost.total : null;

  const pricedSeats = agg.committedSeats - agg.contractedUnknownSeats;
  const avgContractedSeatPrice = pricedSeats > 0 && agg.contracted > 0
    ? agg.contracted / pricedSeats
    // Conservative fallback for a departure with no priced bookings yet: the
    // lowest current offer, which needs the most seats to break even.
    : (meta.lowestOfferPrice && meta.lowestOfferPrice > 0 ? meta.lowestOfferPrice : null);

  // Break-even uses contracted price, not cash collected: a sold seat is
  // expected to pay in full.
  const breakEvenSeats = cost.costed && avgContractedSeatPrice && avgContractedSeatPrice > 0
    ? Math.max(0, Math.ceil(cost.total / avgContractedSeatPrice))
    : null;

  return {
    ...meta,
    historical: isHistoricalDeparture({ startDate: meta.startDate, status: meta.status }, today),
    financialYearStart: financialYearStartForDate(meta.startDate),

    seats: agg.seats,
    committedSeats: agg.committedSeats,
    confirmedSeats: agg.confirmedSeats,
    leadSeats: agg.leadSeats,
    cancelledSeats: agg.cancelledSeats,

    collected: agg.collected,
    collectedCommitted: agg.collectedCommitted,
    leadAdvances: agg.collected - agg.collectedCommitted,
    contracted: agg.contracted,
    contractedUnknownSeats: agg.contractedUnknownSeats,
    stillToCollect,
    overCollected,
    retained: agg.retained,
    refundedGross: agg.refundedGross,

    cost,
    margin,
    marginPct,
    marginIncludingRetained,
    avgContractedSeatPrice,
    breakEvenSeats,
    breakEvenSeatsRemaining: breakEvenSeats === null ? null : Math.max(0, breakEvenSeats - agg.committedSeats),
  };
}

export function rollUp(
  departures: DepartureFinance[],
  unallocated: FinanceRollup['unallocated'] = { rows: 0, seats: 0, collected: 0 },
): FinanceTotals {
  const costed = departures.filter((d) => d.cost.costed);
  // Uncosted departures are excluded from the margin lines entirely. Including
  // them would overstate profit by the whole unrecorded cost base.
  const collectedCosted = costed.reduce((sum, d) => sum + d.collected, 0);
  const cost = costed.reduce((sum, d) => sum + d.cost.total, 0);
  const margin = collectedCosted - cost;
  return {
    collected: departures.reduce((sum, d) => sum + d.collected, 0) + unallocated.collected,
    retained: departures.reduce((sum, d) => sum + d.retained, 0),
    contracted: departures.reduce((sum, d) => sum + d.contracted, 0),
    stillToCollect: departures.reduce((sum, d) => sum + d.stillToCollect, 0),
    cost,
    margin,
    marginPct: collectedCosted > 0 ? (margin / collectedCosted) * 100 : null,
    seats: departures.reduce((sum, d) => sum + d.seats, 0) + unallocated.seats,
    costedDepartures: costed.length,
    uncostedDepartures: departures.length - costed.length,
  };
}

// ── SQL ──────────────────────────────────────────────────────────────────────

/** Composite lookup key. `batch_id` alone can collide across trips. */
export function departureKey(tripSlug: string, batchId: string): string {
  return `${tripSlug} ${batchId}`;
}

/**
 * Build the registration aggregate SQL. The non-revenue status list is expanded
 * FROM the shared constant rather than retyped, so this cannot drift from the
 * definition every other screen uses.
 */
export function buildRegAggregateSql(): { sql: string; params: string[] } {
  const live = NON_REVENUE_STATUSES.map(() => '?').join(',');
  const committed = COMMITTED_STATUSES.map(() => '?').join(',');
  const cancelled = CANCELLED_STATUSES.map(() => '?').join(',');
  const sql = `
    SELECT trip_slug, batch_id,
      SUM(CASE WHEN status NOT IN (${live}) THEN 1 ELSE 0 END)                        AS seats,
      SUM(CASE WHEN status IN (${committed}) THEN 1 ELSE 0 END)                       AS committedSeats,
      SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END)                           AS confirmedSeats,
      SUM(CASE WHEN status = 'lead' THEN 1 ELSE 0 END)                                AS leadSeats,
      SUM(CASE WHEN status IN (${cancelled}) THEN 1 ELSE 0 END)                       AS cancelledSeats,
      SUM(CASE WHEN status NOT IN (${live}) THEN COALESCE(amount_paid, 0) ELSE 0 END) AS collected,
      SUM(CASE WHEN status IN (${committed}) THEN COALESCE(amount_paid, 0) ELSE 0 END)  AS collectedCommitted,
      SUM(CASE WHEN status IN (${committed}) THEN COALESCE(total_amount, 0) ELSE 0 END) AS contracted,
      SUM(CASE WHEN status IN (${committed}) AND COALESCE(total_amount, 0) <= 0
               THEN 1 ELSE 0 END)                                                     AS contractedUnknownSeats,
      SUM(CASE WHEN status IN (${cancelled}) THEN COALESCE(amount_paid, 0) ELSE 0 END)  AS retained,
      SUM(COALESCE(amount_refunded, 0))                                               AS refundedGross
    FROM registrations
    GROUP BY trip_slug, batch_id
  `;
  const params = [
    ...NON_REVENUE_STATUSES, ...COMMITTED_STATUSES, ...CANCELLED_STATUSES,
    ...NON_REVENUE_STATUSES, ...COMMITTED_STATUSES, ...COMMITTED_STATUSES,
    ...COMMITTED_STATUSES, ...CANCELLED_STATUSES,
  ] as string[];
  return { sql, params };
}

// ── DB wrappers ──────────────────────────────────────────────────────────────

/** Canonical departure list, straight from trip YAML. */
export function listDepartureMeta(): DepartureMeta[] {
  const out: DepartureMeta[] = [];
  for (const trip of listTrips()) {
    const tripSlug = String(trip.slug);
    const tripName = String(trip.title || trip.name || tripSlug);
    const { editorDepartures } = editableBooking(trip);
    for (const departure of editorDepartures) {
      if (!departure.id) continue;
      const offers = Array.isArray(departure.offers) ? departure.offers : [];
      const prices = offers.map((o) => Number(o.price)).filter((p) => Number.isFinite(p) && p > 0);
      const metered = offers.length > 0 && offers.every((o) => o.cap != null);
      out.push({
        tripSlug,
        tripName,
        batchId: String(departure.id),
        startDate: String(departure.startDate || ''),
        endDate: String(departure.endDate || departure.startDate || ''),
        status: String(departure.status || 'booking-open'),
        lowestOfferPrice: prices.length ? Math.min(...prices) : null,
        capacity: metered ? offers.reduce((sum, o) => sum + Number(o.cap || 0), 0) : null,
      });
    }
  }
  return out;
}

export function readCostRows(db: Database.Database = getDb()) {
  const base = db.prepare(
    'SELECT trip_slug, batch_id, base_amount, note, updated_at, updated_by_email FROM departure_costs',
  ).all() as Array<BaseCostRow & { trip_slug: string; batch_id: string }>;
  const items = db.prepare(
    'SELECT id, trip_slug, batch_id, label, amount, sort_order FROM departure_cost_items',
  ).all() as Array<CostItemRow & { trip_slug: string; batch_id: string }>;

  const baseByKey = new Map<string, BaseCostRow>();
  for (const row of base) baseByKey.set(departureKey(row.trip_slug, row.batch_id), row);
  const itemsByKey = new Map<string, CostItemRow[]>();
  for (const row of items) {
    const key = departureKey(row.trip_slug, row.batch_id);
    const list = itemsByKey.get(key) ?? [];
    list.push(row);
    itemsByKey.set(key, list);
  }
  return { baseByKey, itemsByKey };
}

/** Cost breakdown for a single departure. */
export function readDepartureCost(
  tripSlug: string,
  batchId: string,
  db: Database.Database = getDb(),
): DepartureCostBreakdown {
  const base = db.prepare(
    'SELECT base_amount, note, updated_at, updated_by_email FROM departure_costs WHERE trip_slug = ? AND batch_id = ?',
  ).get(tripSlug, batchId) as BaseCostRow | undefined;
  const items = db.prepare(
    'SELECT id, label, amount, sort_order FROM departure_cost_items WHERE trip_slug = ? AND batch_id = ? ORDER BY sort_order, id',
  ).all(tripSlug, batchId) as CostItemRow[];
  return costBreakdown(base ?? null, items);
}

/** Full finance view. One registration aggregate, one content read, two cost reads. */
export function buildFinanceRollup(db: Database.Database = getDb(), today = new Date()): FinanceRollup {
  const { sql, params } = buildRegAggregateSql();
  const rows = db.prepare(sql).all(...params) as Array<RegAggregate & { trip_slug: string | null; batch_id: string | null }>;

  const meta = listDepartureMeta();
  const knownKeys = new Set(meta.map((m) => departureKey(m.tripSlug, m.batchId)));
  // Legacy rows carry a NULL trip_slug, so a bare-batch_id index is the fallback.
  const keyByBatch = new Map<string, string[]>();
  for (const m of meta) {
    const list = keyByBatch.get(m.batchId) ?? [];
    list.push(departureKey(m.tripSlug, m.batchId));
    keyByBatch.set(m.batchId, list);
  }

  const aggByKey = new Map<string, RegAggregate>();
  const unallocated = { rows: 0, seats: 0, collected: 0 };

  const addAgg = (key: string, row: RegAggregate) => {
    const prior = aggByKey.get(key);
    if (!prior) { aggByKey.set(key, { ...row }); return; }
    for (const field of Object.keys(EMPTY_AGGREGATE) as Array<keyof RegAggregate>) {
      prior[field] += row[field];
    }
  };

  for (const row of rows) {
    const batchId = String(row.batch_id ?? '').trim();
    if (!batchId) { collectUnallocated(unallocated, row); continue; }
    const rawSlug = String(row.trip_slug ?? '').trim();
    // A renamed trip leaves its registrations on the old slug forever
    // (api/admin/trips/update.ts records an alias but never rewrites them).
    const slug = rawSlug ? (resolveTripSlugAlias(rawSlug) ?? rawSlug) : '';
    const composite = slug ? departureKey(slug, batchId) : '';

    if (composite && knownKeys.has(composite)) { addAgg(composite, row); continue; }
    // No slug (legacy) or the slug no longer names a trip: fall back to the
    // batch id, but only when it identifies exactly one departure — otherwise
    // two trips sharing a generated batch id would pool each other's money.
    const candidates = keyByBatch.get(batchId) ?? [];
    if (candidates.length === 1) addAgg(candidates[0], row);
    else collectUnallocated(unallocated, row);
  }

  const { baseByKey, itemsByKey } = readCostRows(db);

  const departures = meta.map((m) => {
    const key = departureKey(m.tripSlug, m.batchId);
    return computeDepartureFinance(
      m,
      aggByKey.get(key) ?? EMPTY_AGGREGATE,
      costBreakdown(baseByKey.get(key) ?? null, itemsByKey.get(key) ?? []),
      today,
    );
  });

  const orphanCosts: OrphanCost[] = [];
  const orphanKeys = new Set<string>([...baseByKey.keys(), ...itemsByKey.keys()].filter((k) => !knownKeys.has(k)));
  for (const key of orphanKeys) {
    const [tripSlug, batchId] = key.split(' ');
    orphanCosts.push({
      tripSlug,
      batchId,
      cost: costBreakdown(baseByKey.get(key) ?? null, itemsByKey.get(key) ?? []),
      // A soft-deleted trip is hidden from listTrips() but may be restored, so
      // its costs are kept deliberately and must not offer a purge button.
      reason: isTripDeleted(tripSlug) ? 'trip-deleted' : 'batch-missing',
    });
  }
  orphanCosts.sort((a, b) => a.tripSlug.localeCompare(b.tripSlug) || a.batchId.localeCompare(b.batchId));

  return { departures, orphanCosts, unallocated, totals: rollUp(departures, unallocated) };
}

function collectUnallocated(target: { rows: number; seats: number; collected: number }, row: RegAggregate) {
  if (row.seats === 0 && row.collected === 0) return;
  target.rows += 1;
  target.seats += row.seats;
  target.collected += row.collected;
}
