import { getDb } from '../db';

export interface ColumnInfo {
  table: string;
  column: string;
  type: string;
  pii: boolean;
  returnable: boolean;
}

export const REGISTRATION_ALLOWED = new Set([
  'id',
  'trip_name',
  'trip_slug',
  'trip_date',
  'batch_id',
  'tier_id',
  'sharing_option',
  'status',
  'payment_status',
  'amount_paid',
  'amount_refunded',
  'total_amount',
  'payment_date',
  'payment_method',
  'created_at',
  'updated_at',
  'source',
  'source_detail',
  'gender',
  'age',
  'city',
  'state',
  'country',
  'photo_consent',
  'consent_at',
  'sharedAt',
]);

export const USER_ALLOWED = new Set([
  'id',
  'createdAt',
  'lastLoginAt',
  'leaderboardOptOut',
  'showTripsPublicly',
]);

export const AGGREGATE_ONLY_ALLOWED = new Set([
  'source',
  'status',
  'created_at',
  'subscribed_at',
  'active',
]);

const ALWAYS_BLOCKED = [
  'full_name',
  'email',
  'phone',
  'address',
  'pincode',
  'emergency_name',
  'emergency_phone',
  'emergency_relationship',
  'date_of_birth',
  'dietary_notes',
  'why_join',
  'admin_notes',
  'payment_screenshot_url',
  'transaction_id',
  'instagram',
  'email_error',
  'displayName',
  'avatarUrl',
  'googleId',
  'username',
  'homeCityLatLng',
  'unsubscribe_token',
  'message',
  'subject',
];

export const BLOCKED_COLUMN_NAMES = new Set(ALWAYS_BLOCKED);

export function isBlockedColumn(column: string): boolean {
  const c = column.toLowerCase();
  return (
    BLOCKED_COLUMN_NAMES.has(column) ||
    c.includes('password') ||
    c.includes('token') ||
    c.endsWith('_raw') ||
    c.endsWith('_private')
  );
}

export function isReturnableColumn(table: string, column: string, aggregation?: string): boolean {
  if (isBlockedColumn(column)) return false;
  if (table === 'registrations') return REGISTRATION_ALLOWED.has(column);
  if (table === 'users') return USER_ALLOWED.has(column);
  if (table === 'contact_submissions' || table === 'newsletter_subscribers') {
    return !!aggregation || AGGREGATE_ONLY_ALLOWED.has(column);
  }
  return false;
}

export function getLiveSchema(): Record<string, ColumnInfo[]> {
  const db = getDb();
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string }>;
  const out: Record<string, ColumnInfo[]> = {};
  for (const { name } of tables) {
    const rows = db.prepare(`PRAGMA table_info(${quoteIdentifier(name)})`).all() as Array<{ name: string; type: string }>;
    out[name] = rows.map((row) => ({
      table: name,
      column: row.name,
      type: row.type,
      pii: isBlockedColumn(row.name),
      returnable: isReturnableColumn(name, row.name),
    }));
  }
  return out;
}

export function getAnalyticsSchemaSummary(): string {
  const schema = getLiveSchema();
  const lines: string[] = [];
  for (const table of ['registrations', 'users', 'contact_submissions', 'newsletter_subscribers']) {
    const cols = schema[table] ?? [];
    lines.push(`${table}: ${cols.map((c) => `${c.column} ${c.type}${c.returnable ? '' : ' restricted'}`).join(', ')}`);
  }
  lines.push('trips/departures: YAML metadata via trip_slug and batch_id; fields include slug, title, location, batches.id, batches.startDate, batches.endDate, batches.status, offers.price/cap/booked.');
  return lines.join('\n');
}

export function assertKnownField(table: string, column: string): void {
  const schema = getLiveSchema();
  if (!schema[table]) throw new Error(`Query references unknown field: ${table}`);
  if (!schema[table].some((c) => c.column === column)) {
    throw new Error(`Query references unknown field: ${table}.${column}`);
  }
}

export function stripBlockedRows(columns: string[], rows: unknown[][]): { columns: string[]; rows: unknown[][]; stripped: boolean } {
  const keep = columns.map((column, index) => ({ column, index })).filter(({ column }) => !isBlockedColumn(column));
  return {
    columns: keep.map((k) => k.column),
    rows: rows.map((row) => keep.map((k) => row[k.index])),
    stripped: keep.length !== columns.length,
  };
}

export function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) throw new Error(`Unsafe identifier: ${identifier}`);
  return `"${identifier}"`;
}
