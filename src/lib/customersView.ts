import { getDb } from './db';
import { likeTerm } from './utils';
import type { AdminUser } from './admin-session';

/**
 * One customer = one normalised email across the `registrations` table.
 *
 * This module owns the aggregation, not its results: it hands back SQL
 * fragments and each caller supplies its own column projection. That split is
 * deliberate. `/api/admin/export` derives its CSV header row from the keys of
 * the first result object, so widening the query would silently widen the
 * download; the admin page meanwhile needs account columns the CSV must not
 * grow. Fragments let both read the same aggregation and still select
 * different things from it.
 *
 * Note what is NOT joined here: `user_roles`. That join multiplies rows before
 * the GROUP BY, so a user holding two roles double-counts their registrations
 * and payments. Callers that need a role look it up separately, per user id.
 */

export const CUSTOMER_TYPES = [
  'has-account', 'no-account', 'repeat', 'confirmed', 'pending', 'unpaid',
] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

/**
 * `last_reg_at` ties are dense — bulk importers stamp a whole CSV with one
 * timestamp — so it cannot order a paginated read on its own. `email` is the
 * GROUP BY key and therefore unique, which makes the sort total and LIMIT /
 * OFFSET stable across pages.
 */
export const CUSTOMER_ORDER_BY = 'ORDER BY last_reg_at DESC, email ASC';

/** Columns the CSV export has always had, in the order it has always had them. */
export const EXPORT_COLUMNS = [
  'email', 'full_name', 'phone', 'city',
  'total_regs', 'confirmed', 'pending', 'lead', 'wishlist', 'rejected', 'cancelled',
  'total_paid', 'total_refunded',
  'last_payment_date', 'last_reg_at', 'latest_trip',
  'user_id', 'username', 'displayName',
].join(', ');

/** Everything the export selects, plus what the admin drawers render. */
export const PAGE_COLUMNS = [
  EXPORT_COLUMNS,
  'avatarUrl', 'leaderboardOptOut', 'showTripsPublicly',
  'account_created_at', 'lastLoginAt',
].join(', ');

export type CustomerStats = {
  total: number;
  confirmed: number;
  pending: number;
  unpaid: number;
  repeat: number;
};

export type CustomerQuery = {
  /** `WITH customers AS ( ... )` — prefix for every statement below. */
  cte: string;
  /** `''` or `WHERE ...`, applied to the aggregated rows. */
  where: string;
  /** `''` or `WHERE ...`, the text search alone — see `customerStats`. */
  whereSearchOnly: string;
  /**
   * Bind order: batch scope, then search. The customer-type clauses are
   * literal SQL and bind nothing, so these params suit both `where` and
   * `whereSearchOnly`.
   */
  params: string[];
};

/**
 * @param q            free-text, already trimmed and lower-cased by the caller
 * @param customerType one of CUSTOMER_TYPES, or '' for no type filter
 */
export function buildCustomerQuery(
  adminUser: AdminUser | undefined,
  { q = '', customerType = '' }: { q?: string; customerType?: string } = {},
): CustomerQuery {
  const isTripLead = adminUser?.role === 'trip_lead';
  const allowedBatchIds: string[] | null = isTripLead ? (adminUser?.tripIds ?? []) : null;
  const batchWhere = allowedBatchIds === null
    ? ''
    : allowedBatchIds.length > 0
      ? `WHERE r.batch_id IN (${allowedBatchIds.map(() => '?').join(',')})`
      : 'WHERE 1=0';
  const batchParams: string[] = allowedBatchIds?.length ? allowedBatchIds : [];

  const searchFilters: string[] = [];
  const searchParams: string[] = [];
  if (q) {
    searchFilters.push(
      "(lower(COALESCE(full_name, '')) LIKE ? ESCAPE '\\'"
      + " OR lower(COALESCE(email, '')) LIKE ? ESCAPE '\\'"
      + " OR lower(COALESCE(phone, '')) LIKE ? ESCAPE '\\'"
      + " OR lower(COALESCE(username, '')) LIKE ? ESCAPE '\\'"
      + " OR lower(COALESCE(city, '')) LIKE ? ESCAPE '\\')",
    );
    const term = likeTerm(q);
    searchParams.push(term, term, term, term, term);
  }

  const typeFilters: string[] = [];
  if (customerType === 'has-account') typeFilters.push('user_id IS NOT NULL');
  if (customerType === 'no-account') typeFilters.push('user_id IS NULL');
  if (customerType === 'repeat') typeFilters.push('total_regs >= 2');
  if (customerType === 'confirmed') typeFilters.push('confirmed > 0');
  if (customerType === 'pending') typeFilters.push('pending > 0');
  if (customerType === 'unpaid') typeFilters.push('total_paid = 0 AND (confirmed + pending) > 0');

  const all = [...searchFilters, ...typeFilters];

  const cte = `
    WITH customers AS (
    SELECT
      lower(trim(r.email)) AS email,
      (SELECT full_name FROM registrations WHERE lower(trim(email)) = lower(trim(r.email)) ORDER BY created_at DESC LIMIT 1) AS full_name,
      (SELECT phone     FROM registrations WHERE lower(trim(email)) = lower(trim(r.email)) ORDER BY created_at DESC LIMIT 1) AS phone,
      (SELECT city      FROM registrations WHERE lower(trim(email)) = lower(trim(r.email)) ORDER BY created_at DESC LIMIT 1) AS city,
      COUNT(*) AS total_regs,
      SUM(CASE WHEN r.status='confirmed' THEN 1 ELSE 0 END) AS confirmed,
      SUM(CASE WHEN r.status='pending'   THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN r.status='lead'      THEN 1 ELSE 0 END) AS lead,
      SUM(CASE WHEN r.status='wishlist'  THEN 1 ELSE 0 END) AS wishlist,
      SUM(CASE WHEN r.status='rejected'  THEN 1 ELSE 0 END) AS rejected,
      SUM(CASE WHEN r.status='cancelled' THEN 1 ELSE 0 END) AS cancelled,
      SUM(COALESCE(r.amount_paid, 0)) AS total_paid,
      SUM(COALESCE(r.amount_refunded, 0)) AS total_refunded,
      max(r.payment_date) AS last_payment_date,
      max(r.created_at)   AS last_reg_at,
      (SELECT COALESCE(trip_slug, trip_name) FROM registrations WHERE lower(trim(email)) = lower(trim(r.email)) ORDER BY created_at DESC LIMIT 1) AS latest_trip,
      u.id AS user_id,
      u.username,
      u.displayName,
      u.avatarUrl,
      u.leaderboardOptOut,
      u.showTripsPublicly,
      u.createdAt AS account_created_at,
      u.lastLoginAt
    FROM registrations r
    LEFT JOIN users u ON lower(trim(u.email)) = lower(trim(r.email))
    ${batchWhere}
    GROUP BY lower(trim(r.email))
    )
  `;

  return {
    cte,
    where: all.length ? `WHERE ${all.join(' AND ')}` : '',
    whereSearchOnly: searchFilters.length ? `WHERE ${searchFilters.join(' AND ')}` : '',
    params: [...batchParams, ...searchParams],
  };
}

/**
 * Chip counts for the admin header.
 *
 * These respect the text search but deliberately ignore `customerType`: the
 * chips *are* the type categories, so filtering by one would zero the rest and
 * the row would stop being readable as "of what I searched, how many are X".
 */
export function customerStats(query: CustomerQuery): CustomerStats {
  const row = getDb().prepare(`
    ${query.cte}
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN confirmed > 0 THEN 1 ELSE 0 END) AS confirmed,
      SUM(CASE WHEN pending   > 0 THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN total_paid = 0 AND (confirmed + pending) > 0 THEN 1 ELSE 0 END) AS unpaid,
      SUM(CASE WHEN total_regs >= 2 THEN 1 ELSE 0 END) AS repeat_count
    FROM customers
    ${query.whereSearchOnly}
  `).get(...query.params) as Record<string, number | null>;

  return {
    total: Number(row?.total ?? 0),
    confirmed: Number(row?.confirmed ?? 0),
    pending: Number(row?.pending ?? 0),
    unpaid: Number(row?.unpaid ?? 0),
    repeat: Number(row?.repeat_count ?? 0),
  };
}

/** Matching customer count, with both filters applied. */
export function countCustomers(query: CustomerQuery): number {
  const row = getDb().prepare(`
    ${query.cte} SELECT COUNT(*) AS count FROM customers ${query.where}
  `).get(...query.params) as { count: number };
  return Number(row?.count ?? 0);
}
