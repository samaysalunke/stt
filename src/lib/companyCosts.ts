/**
 * Monthly company overheads — the fixed cost base between gross margin and an
 * actual bottom line.
 *
 * `departure_costs` answers "what did this trip cost to run". Nothing answered
 * "what does the company cost to run", so every margin figure in the admin was
 * a gross one. This is the other half.
 *
 * Grain is one row per (month, category), upserted — the same shape as
 * departure_costs, and for the same reason: the editor is a grid, so the write
 * is a cell.
 *
 * ROW EXISTENCE IS LOAD-BEARING. A row holding 0 means "entered as zero"; no row
 * means "not entered yet". The P&L's completeness signal counts months with no
 * rows at all, so `upsert` must never be called for a cell left blank — use
 * `clear` instead. Same distinction as `hasBaseRow` on a departure cost.
 */

import type Database from 'better-sqlite3';
import { getDb } from './db';
import { parseRupees } from './departureFinance';

/**
 * Fixed vocabulary, held in TypeScript rather than a DB CHECK.
 *
 * Free text guarantees `Marketing` / `marketing` / `Mktg` become three
 * categories inside a quarter, which defeats the only thing a category is for.
 * A CHECK would enforce it but SQLite cannot alter one later, so adding an
 * eighth category would mean a table rebuild. This is the same trade-off
 * REG_STATUSES and PAYMENT_STATUSES already make in registrationStatus.ts.
 *
 * `other` plus the per-row note is the escape hatch.
 */
export const OVERHEAD_CATEGORIES = [
  'salaries',
  'marketing',
  'software',
  'office',
  'professional',
  'other',
] as const;

export type OverheadCategory = (typeof OVERHEAD_CATEGORIES)[number];

export const OVERHEAD_CATEGORY_LABELS: Record<OverheadCategory, string> = {
  salaries: 'Salaries',
  marketing: 'Marketing',
  software: 'Software',
  office: 'Office',
  professional: 'Professional fees',
  other: 'Other',
};

export interface CompanyCostRow {
  id: number;
  month: string;
  category: string;
  amount: number;
  note: string | null;
  updatedAt: string | null;
  updatedByEmail: string | null;
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Validate a 'YYYY-MM' key. This arrives from a client fetch, so it is checked
 * before it reaches SQL — not for injection (queries are parameterised) but
 * because a malformed month creates a permanently invisible row that silently
 * breaks every financial-year sum thereafter.
 */
export function parseMonth(value: unknown): string | null {
  const month = String(value ?? '').trim();
  return MONTH_PATTERN.test(month) ? month : null;
}

export function parseCategory(value: unknown): OverheadCategory | null {
  const category = String(value ?? '').trim().toLowerCase();
  return (OVERHEAD_CATEGORIES as readonly string[]).includes(category)
    ? (category as OverheadCategory)
    : null;
}

/**
 * Overheads may be negative — a refunded annual subscription, a credited
 * invoice. Same reasoning as a negative departure cost line item: forcing the
 * owner to shave another figure instead destroys the record of why it moved.
 */
export function parseOverheadAmount(value: unknown): number | null {
  return parseRupees(value);
}

/** The twelve 'YYYY-MM' keys of an Indian financial year, April through March. */
export function monthsInFinancialYear(fyStartYear: number): string[] {
  return Array.from({ length: 12 }, (_, index) => {
    const month = 4 + index;
    const year = month > 12 ? fyStartYear + 1 : fyStartYear;
    return `${year}-${String(month > 12 ? month - 12 : month).padStart(2, '0')}`;
  });
}

/** 'YYYY-MM' for a date, in the business timezone. */
export function monthKey(date: Date, timeZone = 'Asia/Kolkata'): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit' })
    .formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}`;
}

/**
 * Months of a financial year that have already begun, capped at today.
 *
 * A completed year expects 12; the current year expects only the months up to
 * now; a future year expects 0. Getting this wrong means the "months entered"
 * warning fires every day of the year and is therefore ignored.
 */
export function elapsedMonthsInFinancialYear(fyStartYear: number, now = new Date()): string[] {
  const current = monthKey(now);
  return monthsInFinancialYear(fyStartYear).filter((month) => month <= current);
}

export function readCompanyCosts(db: Database.Database = getDb(), months?: string[]): CompanyCostRow[] {
  const base = 'SELECT id, month, category, amount, note, updated_at, updated_by_email FROM company_costs';
  const rows = (months && months.length
    ? db.prepare(`${base} WHERE month IN (${months.map(() => '?').join(',')}) ORDER BY month, category`).all(...months)
    : db.prepare(`${base} ORDER BY month, category`).all()) as Array<Record<string, any>>;
  return rows.map((row) => ({
    id: Number(row.id),
    month: String(row.month),
    category: String(row.category),
    amount: Number(row.amount) || 0,
    note: row.note ?? null,
    updatedAt: row.updated_at ?? null,
    updatedByEmail: row.updated_by_email ?? null,
  }));
}

export function upsertCompanyCost(input: {
  month: string;
  category: OverheadCategory;
  amount: number;
  note?: string | null;
  actorEmail?: string | null;
  db?: Database.Database;
}): CompanyCostRow {
  const db = input.db ?? getDb();
  db.prepare(`
    INSERT INTO company_costs (month, category, amount, note, updated_by_email)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(month, category) DO UPDATE SET
      amount = excluded.amount,
      note = excluded.note,
      updated_at = CURRENT_TIMESTAMP,
      updated_by_email = excluded.updated_by_email
  `).run(input.month, input.category, input.amount, input.note ?? null, input.actorEmail ?? null);
  return readCompanyCosts(db, [input.month]).find((row) => row.category === input.category)!;
}

/** Remove a cell entirely, returning it to "not entered" — not to zero. */
export function clearCompanyCost(month: string, category: string, db: Database.Database = getDb()): boolean {
  return db.prepare('DELETE FROM company_costs WHERE month = ? AND category = ?').run(month, category).changes > 0;
}

/**
 * Copy every row from one month to another.
 *
 * This is the whole answer to recurring costs, deliberately instead of a
 * `repeats_monthly` flag. A recurrence rule would have to materialise virtual
 * rows for months that have none, which destroys the "no row = not entered"
 * invariant the completeness signal depends on — you could no longer tell a
 * generated row from an entered one. It also needs effective-from/to the first
 * time a salary changes mid-year. Copy-forward writes real, auditable rows the
 * owner can then edit, and costs twelve clicks a year.
 *
 * Refuses a non-empty target unless `overwrite`, so it cannot silently stamp
 * over hand-entered figures.
 */
export function copyCompanyCosts(input: {
  from: string;
  to: string;
  overwrite?: boolean;
  actorEmail?: string | null;
  db?: Database.Database;
}): { copied: number; previous: CompanyCostRow[] } {
  const db = input.db ?? getDb();
  const source = readCompanyCosts(db, [input.from]);
  if (!source.length) throw new Error(`No overheads recorded for ${input.from} to copy from.`);

  const previous = readCompanyCosts(db, [input.to]);
  if (previous.length && !input.overwrite) {
    throw new Error(`${input.to} already has overheads recorded. Re-run with overwrite to replace them.`);
  }

  const run = db.transaction(() => {
    if (input.overwrite) db.prepare('DELETE FROM company_costs WHERE month = ?').run(input.to);
    for (const row of source) {
      db.prepare(`
        INSERT INTO company_costs (month, category, amount, note, updated_by_email)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(month, category) DO UPDATE SET
          amount = excluded.amount, note = excluded.note,
          updated_at = CURRENT_TIMESTAMP, updated_by_email = excluded.updated_by_email
      `).run(input.to, row.category, row.amount, row.note, input.actorEmail ?? null);
    }
  });
  run();
  return { copied: source.length, previous };
}
