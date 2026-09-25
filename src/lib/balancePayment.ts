/**
 * Who may report paying their balance, and on which booking.
 *
 * Shared by the pay-balance page and its endpoint so the page's gating and the
 * server's check can never disagree — the endpoint re-runs this rather than
 * trusting that the page only offered the form to the right people.
 */
import type Database from 'better-sqlite3';
import { balanceDueDate } from './balanceDue';
import { readTrip, resolveBalanceDueRule } from './content';

export interface PayableBalance {
  id: number;
  tripName: string;
  tripSlug: string | null;
  startDate: string | null;
  endDate: string | null;
  totalAmount: number;
  amountPaid: number;
  balance: number;
  balanceDueDate: string | null;
  balanceDueRule: string;
  createdAt: string | null;
  balanceReportedAt: string | null;
}

/**
 * The booking, if it belongs to `email`, is confirmed, has a known price and
 * still has money owing. Null otherwise — callers answer null with a 404 so an
 * id that is not yours looks the same as one that does not exist.
 */
export function loadPayableBalance(db: Database.Database, id: number, email: string): PayableBalance | null {
  if (!Number.isInteger(id) || id <= 0 || !email) return null;
  const row = db.prepare(`
    SELECT id, trip_name, trip_slug, batch_id, total_amount, amount_paid, created_at, balance_reported_at
      FROM registrations
     WHERE id = ? AND lower(trim(email)) = lower(trim(?)) AND status = 'confirmed'
  `).get(id, email) as Record<string, any> | undefined;
  if (!row) return null;

  // A NULL/zero price is unknown, not "nothing owed" — and never billable.
  const total = Number(row.total_amount);
  if (!Number.isFinite(total) || total <= 0) return null;
  const paid = Math.max(0, Number(row.amount_paid) || 0);
  const balance = total - paid;
  if (balance <= 0) return null;

  let trip: Record<string, any> | null = null;
  try { trip = row.trip_slug ? readTrip(row.trip_slug) : null; } catch { trip = null; }
  const batch = Array.isArray(trip?.batches)
    ? trip.batches.find((b: any) => String(b?.id) === String(row.batch_id)) : null;
  const startDate = typeof batch?.startDate === 'string' ? batch.startDate.slice(0, 10) : null;
  const endDate = typeof batch?.endDate === 'string' ? batch.endDate.slice(0, 10) : startDate;
  const rule = resolveBalanceDueRule(trip);

  return {
    id: Number(row.id),
    tripName: String(row.trip_name ?? ''),
    tripSlug: row.trip_slug ?? null,
    startDate,
    endDate,
    totalAmount: total,
    amountPaid: paid,
    balance,
    // Matched batch only, as on the profile card — never a fallback date.
    balanceDueDate: balanceDueDate(startDate, rule),
    balanceDueRule: rule,
    createdAt: row.created_at ?? null,
    balanceReportedAt: row.balance_reported_at ?? null,
  };
}
