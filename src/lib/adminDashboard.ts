import type Database from 'better-sqlite3';

export interface BookingGrowthDay {
  key: string;
  label: string;
  count: number;
}

export interface IndianFinancialYear {
  startYear: number;
  startDate: string;
  endDate: string;
  label: string;
}

const BUSINESS_TZ_OFFSET_SQL = "'+5 hours', '+30 minutes'";

function dateKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function indianFinancialYear(now = new Date()): IndianFinancialYear {
  const today = dateKeyInTimeZone(now, 'Asia/Kolkata');
  const [year, month] = today.split('-').map(Number);
  return indianFinancialYearFromStart(month >= 4 ? year : year - 1);
}

export function indianFinancialYearFromStart(startYear: number): IndianFinancialYear {
  return {
    startYear,
    startDate: `${startYear}-04-01`,
    endDate: `${startYear + 1}-03-31`,
    label: `FY ${startYear}\u2013${String(startYear + 1).slice(-2)}`,
  };
}

/** Extract the departure's first day from current ISO values and legacy display labels. */
export function departureDateKey(value: unknown): string | null {
  const text = String(value ?? '').trim();
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const display = text.match(/\b(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})\b/i);
  if (!display) return null;
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const month = months[display[2].slice(0, 3).toLowerCase()];
  return month ? `${display[3]}-${month}-${display[1].padStart(2, '0')}` : null;
}

export function financialYearStartForDate(value: unknown): number | null {
  const key = departureDateKey(value);
  if (!key) return null;
  const [year, month] = key.split('-').map(Number);
  return month >= 4 ? year : year - 1;
}

export function isDateInIndianFinancialYear(value: unknown, startYear: number): boolean {
  const key = departureDateKey(value);
  if (!key) return false;
  const financialYear = indianFinancialYearFromStart(startYear);
  return key >= financialYear.startDate && key <= financialYear.endDate;
}

function addDays(key: string, delta: number): string {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function weekdayLabel(key: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${key}T00:00:00Z`));
}

export function buildBookingGrowthWeek(
  rows: Array<{ d: string; c: number }>,
  now = new Date(),
  timeZone = 'Asia/Kolkata',
): BookingGrowthDay[] {
  const todayKey = dateKeyInTimeZone(now, timeZone);
  const rowMap = new Map(rows.map((row) => [row.d, Number(row.c) || 0]));

  return Array.from({ length: 7 }, (_, index) => {
    const key = addDays(todayKey, index - 6);
    return {
      key,
      label: weekdayLabel(key),
      count: rowMap.get(key) ?? 0,
    };
  });
}

export function getBookingGrowthWeek(db: Database.Database, now = new Date()): BookingGrowthDay[] {
  const todayKey = dateKeyInTimeZone(now, 'Asia/Kolkata');
  const startKey = addDays(todayKey, -6);
  const rows = db
    .prepare(
      `SELECT date(COALESCE(status_changed_at, created_at), ${BUSINESS_TZ_OFFSET_SQL}) AS d, COUNT(*) AS c
       FROM registrations
       WHERE status = 'confirmed'
         AND date(COALESCE(status_changed_at, created_at), ${BUSINESS_TZ_OFFSET_SQL}) BETWEEN ? AND ?
       GROUP BY date(COALESCE(status_changed_at, created_at), ${BUSINESS_TZ_OFFSET_SQL})
       ORDER BY d`,
    )
    .all(startKey, todayKey) as Array<{ d: string; c: number }>;

  return buildBookingGrowthWeek(rows, now, 'Asia/Kolkata');
}
