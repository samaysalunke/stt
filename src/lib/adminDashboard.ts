import type Database from 'better-sqlite3';

export interface BookingGrowthDay {
  key: string;
  label: string;
  count: number;
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
