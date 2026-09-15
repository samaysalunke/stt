/**
 * Money owed, aged by when it fell due.
 *
 * `total_amount − amount_paid` was computed per booking card and nowhere else,
 * so nobody could see the total, and nobody could see which balances were past
 * their due date. This ages them.
 *
 * NOT financial-year filtered, deliberately. A debt from an FY2024-25 departure
 * is still owed today; year-scoping the one view whose purpose is surfacing
 * uncollected money would be exactly backwards. The page it renders on has an FY
 * selector for the margin table; this section ignores it and says so.
 *
 * Per-registration, not per-departure. Netting a departure's balances would let
 * a traveller who overpaid cancel out one who still owes.
 */

import type Database from 'better-sqlite3';
import { getDb } from './db';
import { balanceDueDate } from './balanceDue';
import {
  COMMITTED_STATUSES,
  buildDepartureIndex,
  departureKey,
  listDepartureMeta,
  resolveDepartureKey,
  type DepartureMeta,
} from './departureFinance';
import { isHistoricalDeparture } from './registrationsView';

/**
 * Ageing bands, in days past the due date.
 *
 * Not the usual 30/60/90: the clock here is the booking cycle, not an invoice
 * cycle. The balance falls due only ~10-15 days before departure, so anything
 * reaching "31-60 days overdue" means the trip has almost certainly already run
 * and belongs under `post-departure` instead. 0-15 is the band that matters —
 * the window where a nudge still recovers the money before the group leaves.
 * Parameterised so switching to 30/60/90 for an accountant is one constant.
 */
export const AGEING_BANDS = [15, 30, 60] as const;

export type ReceivableBucketId =
  | 'post-departure'
  | 'not-yet-due'
  | 'due-soon'
  | 'overdue-0-15'
  | 'overdue-16-30'
  | 'overdue-31-60'
  | 'overdue-60-plus'
  | 'unknown-value'
  | 'no-due-date'
  | 'unlinked';

export interface ReceivableBucket {
  id: ReceivableBucketId;
  label: string;
  hint: string;
  /** Whether this band counts toward the aged total. */
  aged: boolean;
  amount: number;
  seats: number;
}

export interface ReceivableRow {
  registrationId: number;
  fullName: string;
  tripName: string;
  tripSlug: string | null;
  batchId: string | null;
  startDate: string | null;
  dueDate: string | null;
  daysOverdue: number | null;
  balance: number;
  bucket: ReceivableBucketId;
}

export interface ReceivablesView {
  rows: ReceivableRow[];
  buckets: ReceivableBucket[];
  /** Overdue plus post-departure — the money someone should be chasing. */
  agedTotal: number;
  /** Every bucket, including not-yet-due. */
  total: number;
  /** Leads holding an advance: a real follow-up, but NOT a receivable. */
  leadAdvances: { count: number; amount: number };
}

const BUCKET_META: Record<ReceivableBucketId, { label: string; hint: string; aged: boolean }> = {
  'post-departure': {
    label: 'Post-departure',
    hint: 'Likely an unrecorded payment — check the record before chasing',
    aged: true,
  },
  'overdue-60-plus': { label: 'Overdue 60+ days', hint: 'Pre-departure, badly late', aged: true },
  'overdue-31-60': { label: 'Overdue 31–60 days', hint: 'At risk', aged: true },
  'overdue-16-30': { label: 'Overdue 16–30 days', hint: 'Chase now', aged: true },
  'overdue-0-15': { label: 'Overdue up to 15 days', hint: 'Still recoverable before departure', aged: true },
  'due-soon': { label: 'Due within 7 days', hint: 'The collection queue', aged: false },
  'not-yet-due': { label: 'Not yet due', hint: 'The forward book', aged: false },
  'unknown-value': { label: 'Unknown contract value', hint: 'No trip price recorded — cannot be billed', aged: false },
  'no-due-date': { label: 'No due date', hint: 'The trip states no day count', aged: false },
  'unlinked': { label: 'Not linked to a departure', hint: 'Cannot be dated', aged: false },
};

/** Bucket order as rendered: worst first. */
const BUCKET_ORDER: ReceivableBucketId[] = [
  'post-departure', 'overdue-60-plus', 'overdue-31-60', 'overdue-16-30', 'overdue-0-15',
  'due-soon', 'not-yet-due', 'unknown-value', 'no-due-date', 'unlinked',
];

function daysBetween(fromKey: string, toKey: string): number {
  const from = Date.parse(`${fromKey}T00:00:00Z`);
  const to = Date.parse(`${toKey}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

export interface ReceivableInput {
  registrationId: number;
  fullName: string;
  tripName: string;
  tripSlug: string | null;
  batchId: string | null;
  totalAmount: number | null;
  amountPaid: number;
  createdAt: string | null;
}

/**
 * Place one booking in a bucket.
 *
 * `todayKey` and the departure are passed in so this stays pure and testable.
 */
export function bucketReceivable(
  input: ReceivableInput,
  departure: DepartureMeta | null,
  todayKey: string,
): ReceivableRow {
  const balance = Math.max(0, (Number(input.totalAmount) || 0) - (Number(input.amountPaid) || 0));
  const base = {
    registrationId: input.registrationId,
    fullName: input.fullName,
    tripName: input.tripName,
    tripSlug: input.tripSlug,
    batchId: input.batchId,
    startDate: departure?.startDate ?? null,
    balance,
  };

  // A NULL/zero trip price makes the balance 0, which would read as "fully paid"
  // when it is actually unknown. Surface it instead of letting it vanish. Never
  // fall back to the current offer price — that invents a debt nobody owes.
  if (input.totalAmount === null || Number(input.totalAmount) <= 0) {
    return { ...base, dueDate: null, daysOverdue: null, bucket: 'unknown-value' };
  }
  if (balance <= 0) return { ...base, dueDate: null, daysOverdue: null, bucket: 'not-yet-due' };
  if (!departure) return { ...base, dueDate: null, daysOverdue: null, bucket: 'unlinked' };

  // The trip has already run: categorically different from a late pre-trip
  // balance, and far more often a missing payment record than a real debtor.
  if (isHistoricalDeparture({ startDate: departure.startDate, status: departure.status }, new Date(`${todayKey}T00:00:00Z`))) {
    const dueDate = balanceDueDate(departure.startDate, departure.balanceDueRule);
    return { ...base, dueDate, daysOverdue: dueDate ? daysBetween(dueDate, todayKey) : null, bucket: 'post-departure' };
  }

  const dueDate = balanceDueDate(departure.startDate, departure.balanceDueRule);
  if (!dueDate) return { ...base, dueDate: null, daysOverdue: null, bucket: 'no-due-date' };

  let daysOverdue = daysBetween(dueDate, todayKey);

  // A "60 days before" rule on a booking made 10 days out is overdue the instant
  // it is created; without this the page would claim 50 days overdue on a
  // three-day-old booking.
  if (daysOverdue > 0 && input.createdAt) {
    const created = String(input.createdAt).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(created)) daysOverdue = Math.min(daysOverdue, Math.max(0, daysBetween(created, todayKey)));
  }

  if (daysOverdue <= 0) {
    const daysUntilDue = -daysOverdue;
    return { ...base, dueDate, daysOverdue, bucket: daysUntilDue <= 7 ? 'due-soon' : 'not-yet-due' };
  }
  const [first, second, third] = AGEING_BANDS;
  const bucket: ReceivableBucketId = daysOverdue <= first
    ? 'overdue-0-15'
    : daysOverdue <= second
      ? 'overdue-16-30'
      : daysOverdue <= third
        ? 'overdue-31-60'
        : 'overdue-60-plus';
  return { ...base, dueDate, daysOverdue, bucket };
}

export function summariseReceivables(rows: ReceivableRow[]): Omit<ReceivablesView, 'rows' | 'leadAdvances'> {
  const buckets: ReceivableBucket[] = BUCKET_ORDER.map((id) => {
    const inBucket = rows.filter((row) => row.bucket === id);
    return {
      id,
      ...BUCKET_META[id],
      amount: inBucket.reduce((sum, row) => sum + row.balance, 0),
      seats: inBucket.length,
    };
  }).filter((bucket) => bucket.seats > 0);

  return {
    buckets,
    agedTotal: buckets.filter((b) => b.aged).reduce((sum, b) => sum + b.amount, 0),
    total: buckets.reduce((sum, b) => sum + b.amount, 0),
  };
}

/** Today in the business timezone, as YYYY-MM-DD. */
export function businessToday(now = new Date(), timeZone = 'Asia/Kolkata'): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function buildReceivables(db: Database.Database = getDb(), now = new Date()): ReceivablesView {
  const todayKey = businessToday(now);
  const meta = listDepartureMeta();
  const index = buildDepartureIndex(meta);
  const byKey = new Map(meta.map((m) => [departureKey(m.tripSlug, m.batchId), m]));

  const placeholders = COMMITTED_STATUSES.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT id, full_name, trip_name, trip_slug, batch_id, total_amount, amount_paid, created_at
    FROM registrations
    WHERE status IN (${placeholders})
  `).all(...COMMITTED_STATUSES) as Array<Record<string, any>>;

  const placed = rows.map((row) => {
    const key = resolveDepartureKey(index, row.trip_slug, row.batch_id);
    return bucketReceivable(
      {
        registrationId: Number(row.id),
        fullName: String(row.full_name ?? ''),
        tripName: String(row.trip_name ?? ''),
        tripSlug: row.trip_slug ?? null,
        batchId: row.batch_id ?? null,
        totalAmount: row.total_amount === null || row.total_amount === undefined ? null : Number(row.total_amount),
        amountPaid: Number(row.amount_paid) || 0,
        createdAt: row.created_at ?? null,
      },
      key ? byKey.get(key) ?? null : null,
      todayKey,
    );
  });

  // Leads holding an advance are a real follow-up but NOT a receivable — a lead
  // has committed to nothing, and counting it would turn a sales pipeline number
  // into a balance-sheet one. Reported separately.
  const leads = db.prepare(
    "SELECT COUNT(*) AS n, COALESCE(SUM(amount_paid), 0) AS amount FROM registrations WHERE status = 'lead' AND COALESCE(amount_paid, 0) > 0",
  ).get() as { n: number; amount: number };

  const withBalance = placed.filter((row) => row.balance > 0 || row.bucket === 'unknown-value');
  return {
    rows: withBalance.sort((a, b) => BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket) || b.balance - a.balance),
    ...summariseReceivables(withBalance),
    leadAdvances: { count: Number(leads.n) || 0, amount: Number(leads.amount) || 0 },
  };
}
